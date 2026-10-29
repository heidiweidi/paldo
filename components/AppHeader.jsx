"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import HelpContent from "@/components/HelpContent";

// Top bar shared by the scanner and journal pages. `children` is the signed-in user area, rendered on
// the server (it carries the sign-out server action) and passed in.
export default function AppHeader({ active = "scanner", children }) {
  const [open, setOpen] = useState(false);
  const menuBtn = useRef(null);
  const closeBtn = useRef(null);

  const close = useCallback(() => {
    setOpen(false);
    menuBtn.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    closeBtn.current?.focus();
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, close]);

  return (
    <>
      <header className="topbar">
        <div className="topbar-left">
          <button
            ref={menuBtn}
            type="button"
            className="menu-btn"
            aria-expanded={open}
            aria-controls="app-menu"
            onClick={() => setOpen((v) => !v)}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
            </svg>
            <span>Menu</span>
          </button>
          <div className="brand">
            Structure Setup Scanner <span>· Crypto + Forex</span>
          </div>
        </div>
        {children}
      </header>

      {open ? (
        <div className="drawer-layer">
          <div className="drawer-overlay" onClick={close} aria-hidden="true" />
          <aside id="app-menu" className="drawer" role="dialog" aria-modal="true" aria-labelledby="app-menu-title">
            <div className="drawer-head">
              <h2 id="app-menu-title">Menu</h2>
              <button ref={closeBtn} type="button" className="drawer-close" onClick={close} aria-label="Close menu">
                ✕
              </button>
            </div>
            <nav className="drawer-nav" aria-label="Pages">
              <Link href="/" className={active === "scanner" ? "on" : ""} onClick={() => setOpen(false)}>Scanner</Link>
              <Link href="/journal" className={active === "journal" ? "on" : ""} onClick={() => setOpen(false)}>📓 Journal</Link>
            </nav>
            <div className="drawer-body">
              <h3 className="drawer-section">How it works</h3>
              <HelpContent />
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
