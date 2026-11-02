"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { SYNCED_EVENT } from "@/lib/sync";
import {
  loadJournal, addJournalEntry, updateJournalEntry, removeJournalEntry,
  newManualEntry, JOURNAL_STATUSES, realizedR, journalStats,
} from "@/lib/journal";

const GRADE_CLS = { "A+": "grade-aplus", A: "grade-a", B: "grade-b" };

function fmt(n) {
  if (n == null || isNaN(n)) return "—";
  const abs = Math.abs(n);
  const dp = abs >= 100 ? 2 : abs >= 1 ? 4 : 6;
  return n.toLocaleString(undefined, { minimumFractionDigits: dp > 4 ? 2 : dp, maximumFractionDigits: dp });
}

function fmtR(r) {
  if (r == null) return "—";
  return `${r > 0 ? "+" : ""}${r.toFixed(2)}R`;
}

const BLANK_FORM = {
  symbol: "", mkt: "crypto", direction: "long", pairing: "A", grade: "",
  entry: "", stop: "", tp1: "", tp2: "", notes: "",
};

// Trades you actually took — separate from what the scanner flags as valid.
// Quick-add buttons on the scanner/asset pages snapshot a live Strat#5 setup
// in here (see newEntryFromSetup in lib/journal.js); this page also lets you
// log anything taken off-plan and mark outcomes as they happen. Everything
// lives in this browser's localStorage and is copied to your wallet's KV record when sync is available — see lib/journal.js and lib/sync.js.
export default function Journal() {
  const [entries, setEntries] = useState([]);
  const [ready, setReady] = useState(false); // load after mount to avoid a hydration mismatch
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(BLANK_FORM);

  useEffect(() => {
    setEntries(loadJournal());
    setReady(true);
    // The per-wallet sync updates localStorage after the page has loaded; re-read when it does.
    const reload = () => setEntries(loadJournal());
    window.addEventListener(SYNCED_EVENT, reload);
    return () => window.removeEventListener(SYNCED_EVENT, reload);
  }, []);

  const stats = useMemo(() => journalStats(entries), [entries]);
  const setField = (patch) => setForm((f) => ({ ...f, ...patch }));

  const submit = (e) => {
    e.preventDefault();
    if (!form.symbol.trim()) return;
    const entry = newManualEntry({
      symbol: form.symbol.trim().toUpperCase(),
      mkt: form.mkt,
      direction: form.direction || null,
      pairing: form.pairing || null,
      grade: form.grade || null,
      entry: form.entry === "" ? null : Number(form.entry),
      stop: form.stop === "" ? null : Number(form.stop),
      tp1: form.tp1 === "" ? null : Number(form.tp1),
      tp2: form.tp2 === "" ? null : Number(form.tp2),
      notes: form.notes,
    });
    setEntries(addJournalEntry(entry));
    setForm(BLANK_FORM);
    setFormOpen(false);
  };

  const setStatus = (id, status) => setEntries(updateJournalEntry(id, { status }));
  const setExitPrice = (id, val) => setEntries(updateJournalEntry(id, { exitPrice: val === "" ? null : Number(val) }));
  const setNotes = (id, notes) => setEntries(updateJournalEntry(id, { notes }));
  const remove = (id) => {
    if (typeof window !== "undefined" && !window.confirm("Delete this journal entry?")) return;
    setEntries(removeJournalEntry(id));
  };

  return (
    <div className="wrap">
      <div className="detail-head">
        <Link href="/" className="back">← Back to scanner</Link>
        <span className="filter-title" style={{ marginLeft: "auto" }}>📓 Trade Journal</span>
      </div>

      <div className="cards">
        <div className="card">
          <div className="k">Logged trades</div>
          <div className="v">{stats.total}<small> · {stats.open} open</small></div>
        </div>
        <div className="card">
          <div className="k">Win rate (closed)</div>
          <div className="v">
            {stats.winRatePct != null ? `${stats.winRatePct.toFixed(0)}%` : "—"}
            <small> · {stats.wins}W / {stats.losses}L{stats.flat ? ` / ${stats.flat} BE` : ""}</small>
          </div>
        </div>
        <div className="card">
          <div className="k">Total R (closed)</div>
          <div className="v" style={{ color: stats.totalR > 0 ? "var(--long)" : stats.totalR < 0 ? "var(--short)" : undefined }}>
            {stats.closedCount ? fmtR(stats.totalR) : "—"}
          </div>
        </div>
        <div className="card">
          <div className="k">Average R / trade</div>
          <div className="v">{fmtR(stats.avgR)}</div>
        </div>
      </div>

      <div className="notice" style={{ marginBottom: 12 }}>
        This is your own record of trades you actually took — separate from what the scanner flags as a valid setup. Click <b>📓 Log trade</b> on any ready {" "}
        Strat#5 row (scanner or asset page) to snapshot it here, or add one manually below. Mark the outcome once you know it — realized R updates automatically. R for TP1/TP2/breakeven assumes the standard scale-out (half at TP1, half runs); a manual close computes R from your own exit price. Stored in this browser only — it won't follow you to another device.
      </div>

      <div style={{ marginBottom: 14 }}>
        <button className="btn primary" onClick={() => setFormOpen((v) => !v)}>
          {formOpen ? "Cancel" : "+ Add trade"}
        </button>
      </div>

      {formOpen ? (
        <form className="filterbar" onSubmit={submit} style={{ marginBottom: 18 }}>
          <div className="filter-row" style={{ marginBottom: 10 }}>
            <input className="journal-input" style={{ width: 110 }} placeholder="Symbol" value={form.symbol} onChange={(e) => setField({ symbol: e.target.value })} required />
            <select value={form.mkt} onChange={(e) => setField({ mkt: e.target.value })}>
              <option value="crypto">Crypto</option>
              <option value="forex">Forex/Gold</option>
            </select>
            <select value={form.direction} onChange={(e) => setField({ direction: e.target.value })}>
              <option value="long">Long</option>
              <option value="short">Short</option>
            </select>
            <select value={form.pairing} onChange={(e) => setField({ pairing: e.target.value })}>
              <option value="A">4H → 15m</option>
              <option value="B">1H → 5m</option>
              <option value="">Pairing —</option>
            </select>
            <select value={form.grade} onChange={(e) => setField({ grade: e.target.value })}>
              <option value="">Grade —</option>
              <option value="A+">A+</option>
              <option value="A">A</option>
              <option value="B">B</option>
            </select>
          </div>
          <div className="filter-row" style={{ marginBottom: 10 }}>
            <input className="journal-input" style={{ width: 120 }} type="number" step="any" placeholder="Entry" value={form.entry} onChange={(e) => setField({ entry: e.target.value })} />
            <input className="journal-input" style={{ width: 120 }} type="number" step="any" placeholder="Stop" value={form.stop} onChange={(e) => setField({ stop: e.target.value })} />
            <input className="journal-input" style={{ width: 120 }} type="number" step="any" placeholder="TP1" value={form.tp1} onChange={(e) => setField({ tp1: e.target.value })} />
            <input className="journal-input" style={{ width: 120 }} type="number" step="any" placeholder="TP2" value={form.tp2} onChange={(e) => setField({ tp2: e.target.value })} />
          </div>
          <div className="filter-row">
            <input className="journal-input" style={{ width: "100%", maxWidth: 520, flex: 1 }} placeholder="Notes — why you took it, how it played out…" value={form.notes} onChange={(e) => setField({ notes: e.target.value })} />
            <button className="btn primary" type="submit">Save trade</button>
          </div>
        </form>
      ) : null}

      <div className="tblwrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Asset</th>
              <th>Dir</th>
              <th>Pairing</th>
              <th>Grade</th>
              <th>Entry</th>
              <th>Stop</th>
              <th>TP1</th>
              <th>TP2</th>
              <th>Outcome</th>
              <th>R</th>
              <th>Notes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {!ready ? (
              <tr><td colSpan={13} className="empty">Loading journal…</td></tr>
            ) : entries.length === 0 ? (
              <tr><td colSpan={13} className="empty">No trades logged yet — click 📓 Log trade on a ready setup, or add one manually above.</td></tr>
            ) : (
              entries.map((e) => {
                const r = realizedR(e);
                return (
                  <tr key={e.id}>
                    <td className="num" style={{ whiteSpace: "nowrap" }}>{new Date(e.createdAt).toLocaleDateString()}</td>
                    <td className="left">
                      <span className="sym">{e.symbol}</span>
                      <span className="mk">{e.mkt === "crypto" ? "CRYPTO" : "FX"}</span>
                      {e.source === "manual" ? <span className="filter-tag" style={{ marginLeft: 6 }}>manual</span> : null}
                    </td>
                    <td>{e.direction === "long" ? <span className="pill long">▲</span> : e.direction === "short" ? <span className="pill short">▼</span> : "—"}</td>
                    <td>{e.pairing === "A" ? "4H/15m" : e.pairing === "B" ? "1H/5m" : "—"}</td>
                    <td>{e.grade ? <span className={`grade ${GRADE_CLS[e.grade] || ""}`}>{e.grade}</span> : "—"}</td>
                    <td className="num">{fmt(e.entry)}</td>
                    <td className="num" style={{ color: "var(--short)" }}>{fmt(e.stop)}</td>
                    <td className="num" style={{ color: "var(--long)" }}>{fmt(e.tp1)}</td>
                    <td className="num" style={{ color: "var(--long)", opacity: 0.75 }}>{fmt(e.tp2)}</td>
                    <td>
                      <select value={e.status} onChange={(ev) => setStatus(e.id, ev.target.value)}>
                        {Object.entries(JOURNAL_STATUSES).map(([k, v]) => (
                          <option key={k} value={k}>{v.label}</option>
                        ))}
                      </select>
                      {e.status === "closed_manual" ? (
                        <input
                          className="journal-input"
                          style={{ width: 90, marginTop: 6, display: "block" }}
                          type="number"
                          step="any"
                          placeholder="Exit price"
                          defaultValue={e.exitPrice ?? ""}
                          onBlur={(ev) => setExitPrice(e.id, ev.target.value)}
                        />
                      ) : null}
                    </td>
                    <td className="num" style={{ color: r == null ? undefined : r > 0 ? "var(--long)" : r < 0 ? "var(--short)" : undefined }}>
                      {fmtR(r)}
                    </td>
                    <td>
                      <input
                        className="journal-input"
                        style={{ width: 160 }}
                        defaultValue={e.notes}
                        placeholder="notes…"
                        onBlur={(ev) => setNotes(e.id, ev.target.value)}
                      />
                    </td>
                    <td>
                      <button className="btn" style={{ padding: "3px 8px", fontSize: 12 }} onClick={() => remove(e.id)} title="Delete entry">🗑</button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
