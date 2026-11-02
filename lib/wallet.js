// Browser-side wallet helpers: find wallets, run the Sign-In with Ethereum (EIP-4361) flow, and
// watch for the wallet changing account after sign-in. Works with any EIP-1193 provider, which is
// what MetaMask, Trust Wallet and WalletConnect all expose.
import { createWalletClient, custom, getAddress } from "viem";
import { createSiweMessage } from "viem/siwe";

const SAVED_KEY = "paldo.wallet";
const APP_NAME = "Structure Setup Scanner";

export class AuthError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = "AuthError";
    Object.assign(this, extra);
  }
}

export function loadSavedWallet() {
  try { return JSON.parse(window.localStorage.getItem(SAVED_KEY) || "null"); } catch { return null; }
}
function saveWallet(w) {
  try { window.localStorage.setItem(SAVED_KEY, JSON.stringify(w)); } catch {}
}
function clearSavedWallet() {
  try { window.localStorage.removeItem(SAVED_KEY); } catch {}
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wallets announced through EIP-6963, falling back to the single window.ethereum some wallets inject. */
export async function discoverWallets(waitMs = 350) {
  const found = new Map();
  const onAnnounce = (e) => {
    const d = e.detail;
    if (d?.info?.uuid && d.provider) {
      found.set(d.info.uuid, { id: d.info.uuid, name: d.info.name, icon: d.info.icon, rdns: d.info.rdns || null, provider: d.provider });
    }
  };
  window.addEventListener("eip6963:announceProvider", onAnnounce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  await sleep(waitMs);
  window.removeEventListener("eip6963:announceProvider", onAnnounce);

  const list = [...found.values()];
  const eth = window.ethereum;
  if (!list.length && eth) {
    const name = eth.isTrust || eth.isTrustWallet ? "Trust Wallet" : eth.isMetaMask ? "MetaMask" : "Browser wallet";
    list.push({ id: "injected", name, icon: null, rdns: null, provider: eth });
  }
  return list;
}

export function friendlyError(e) {
  if (e instanceof AuthError) return e.message;
  const code = e?.code ?? e?.cause?.code;
  const text = String(e?.shortMessage || e?.message || "");
  if (code === 4001 || /user rejected|rejected the request|denied/i.test(text)) return "You declined the request in your wallet. Nothing was signed.";
  if (code === -32002) return "Your wallet already has a request waiting. Open it and approve or reject it first.";
  if (/connection request reset|modal closed|user closed/i.test(text)) return "The WalletConnect window was closed before connecting.";
  return text || "Something went wrong talking to your wallet.";
}

async function postJson(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body: j };
}

/** Connect, sign the SIWE message and have the server verify it. Resolves to the checksummed address. */
export async function signInWithProvider(provider, saved) {
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!accounts?.length) throw new AuthError("Your wallet didn't share an account.");
  const address = getAddress(accounts[0]);

  let chainId = 1;
  try { chainId = parseInt(await provider.request({ method: "eth_chainId" }), 16) || 1; } catch {}

  const nr = await fetch("/api/auth/nonce", { cache: "no-store" });
  const nj = await nr.json().catch(() => ({}));
  if (!nr.ok || !nj.nonce) throw new AuthError(nj.error || "Couldn't start sign-in.", { status: nr.status });

  const now = new Date();
  const message = createSiweMessage({
    address,
    chainId,
    domain: window.location.host,
    nonce: nj.nonce,
    uri: window.location.origin,
    version: "1",
    statement: `Sign in to the ${APP_NAME}. This is free: it sends no transaction and moves no funds.`,
    issuedAt: now,
    expirationTime: new Date(now.getTime() + 5 * 60 * 1000),
  });
  const signature = await createWalletClient({ transport: custom(provider) }).signMessage({ account: address, message });

  const v = await postJson("/api/auth/verify", { message, signature });
  if (!v.ok) throw new AuthError(v.body.error || "Sign-in failed.", { status: v.status, address: v.body.address, reason: v.body.reason });
  saveWallet(saved);
  return address;
}

async function walletConnectProvider(projectId, showQrModal) {
  const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
  return EthereumProvider.init({
    projectId,
    chains: [1],
    optionalChains: [10, 56, 137, 8453, 42161],
    showQrModal,
    qrModalOptions: { themeMode: "dark" },
    metadata: {
      name: APP_NAME,
      description: "Crypto and forex setup scanner",
      url: window.location.origin,
      icons: [`${window.location.origin}/favicon.ico`],
    },
  });
}

export async function signInWithWalletConnect(projectId) {
  const provider = await walletConnectProvider(projectId, true);
  await provider.enable(); // opens the QR / deep-link modal unless a session already exists
  return signInWithProvider(provider, { kind: "walletconnect", projectId });
}

export function signInWithInjected(wallet) {
  return signInWithProvider(wallet.provider, { kind: "injected", rdns: wallet.rdns });
}

/**
 * After sign-in, keep an eye on the wallet. If it moves to a different account (or a WalletConnect
 * session ends), call onSwitch so the app signs out. A locked or unreachable wallet is ignored:
 * the session cookie, not the live connection, is what keeps someone signed in.
 */
export async function watchWallet(address, onSwitch) {
  const noop = () => {};
  const saved = loadSavedWallet();
  if (!saved) return noop;

  let provider = null;
  try {
    if (saved.kind === "injected") {
      const list = await discoverWallets();
      provider = (list.find((w) => saved.rdns && w.rdns === saved.rdns) || list[0])?.provider || null;
    } else if (saved.kind === "walletconnect" && saved.projectId) {
      const wc = await walletConnectProvider(saved.projectId, false);
      provider = wc.session ? wc : null;
    }
  } catch {
    return noop;
  }
  if (!provider) return noop;

  const me = address.toLowerCase();
  const onAccounts = (accs) => {
    if (Array.isArray(accs) && accs.length && String(accs[0]).toLowerCase() !== me) onSwitch("switched");
  };
  const onDisconnect = () => onSwitch("disconnected");
  provider.on?.("accountsChanged", onAccounts);
  if (saved.kind === "walletconnect") provider.on?.("disconnect", onDisconnect);

  // Silent re-check on load: eth_accounts never opens a prompt.
  try { onAccounts(await provider.request({ method: "eth_accounts" })); } catch {}

  return () => {
    provider.removeListener?.("accountsChanged", onAccounts);
    provider.removeListener?.("disconnect", onDisconnect);
  };
}

export async function signOut(reason) {
  try { await fetch("/api/auth/logout", { method: "POST" }); } catch {}
  const saved = loadSavedWallet();
  clearSavedWallet();
  if (saved?.kind === "walletconnect" && saved.projectId) {
    try {
      const p = await walletConnectProvider(saved.projectId, false);
      await Promise.race([p.disconnect(), sleep(1500)]);
    } catch {}
  }
  window.location.href = `/login${reason ? `?reason=${reason}` : ""}`;
}
