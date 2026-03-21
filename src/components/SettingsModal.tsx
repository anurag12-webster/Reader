import { useState, useEffect, useRef } from "react";
import { X, RefreshCw, CheckCircle, AlertCircle, ExternalLink, BookOpen, Info, Download } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

const APP_VERSION = "0.1.5";

type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "upToDate" }
  | { status: "available"; version: string; url: string }
  | { status: "error"; message: string };

function openUrl(url: string) {
  import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(url)).catch(() => {});
}

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const [updateState, setUpdateState] = useState<UpdateState>({ status: "idle" });
  const overlayRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Close on backdrop click
  function onOverlayClick(e: React.MouseEvent) {
    if (e.target === overlayRef.current) onClose();
  }

  async function checkForUpdate() {
    setUpdateState({ status: "checking" });
    try {
      const result = await invoke<{ up_to_date: boolean; latest_version: string; release_url: string }>(
        "check_for_update"
      );
      if (result.up_to_date) {
        setUpdateState({ status: "upToDate" });
      } else {
        setUpdateState({ status: "available", version: result.latest_version, url: result.release_url });
      }
    } catch (e) {
      setUpdateState({ status: "error", message: String(e) });
    }
  }

  return (
    <div
      ref={overlayRef}
      onClick={onOverlayClick}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        animation: "fadeIn 120ms var(--ease-out) both",
      }}
    >
      <div style={{
        width: 440, maxHeight: "80vh",
        background: "var(--bg-sidebar)",
        border: "1px solid var(--border-soft)",
        borderRadius: 14,
        display: "flex", flexDirection: "column",
        boxShadow: "0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)",
        animation: "modalIn 180ms var(--ease-out) both",
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 20px",
          borderBottom: "1px solid var(--border-faint)",
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-white)", letterSpacing: "-0.02em" }}>
            Settings
          </span>
          <button
            onClick={onClose}
            style={{
              width: 26, height: 26, borderRadius: 6,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "var(--text-muted)", background: "transparent",
              transition: "background var(--duration-fast), color var(--duration-fast)",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)"; (e.currentTarget as HTMLElement).style.color = "var(--text-white)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}
          >
            <X size={13} strokeWidth={2.5} />
          </button>
        </div>

        {/* Body */}
        <div style={{ overflowY: "auto", flex: 1, padding: "8px 0 16px" }}>

          {/* About section */}
          <Section label="About">
            <div style={{
              display: "flex", alignItems: "center", gap: 14,
              padding: "14px 20px",
              background: "var(--bg-raised)",
              borderRadius: 10, margin: "0 16px",
              border: "1px solid var(--border-faint)",
            }}>
              <div style={{
                width: 44, height: 44, borderRadius: 10, flexShrink: 0,
                background: "var(--bg-active)",
                border: "1px solid var(--border-soft)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <BookOpen size={20} color="var(--text-dim)" strokeWidth={1.6} />
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-white)", letterSpacing: "-0.02em" }}>
                  PDF Reader
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                  Version {APP_VERSION}
                </div>
              </div>
            </div>

            <Row
              label="Source code"
              action={
                <IconButton icon={<ExternalLink size={11} strokeWidth={2} />} onClick={() => openUrl("https://github.com/anurag12-webster/Reader")}>
                  GitHub
                </IconButton>
              }
            />
            <Row
              label="Report a bug"
              action={
                <IconButton icon={<ExternalLink size={11} strokeWidth={2} />} onClick={() => openUrl("https://github.com/anurag12-webster/Reader/issues")}>
                  Open issue
                </IconButton>
              }
            />
          </Section>

          {/* Updates section */}
          <Section label="Updates">
            <div style={{ padding: "4px 20px 8px" }}>
              <UpdateRow state={updateState} onCheck={checkForUpdate} />
            </div>
          </Section>

          {/* Data section */}
          <Section label="Your data">
            <InfoRow icon={<Info size={11} strokeWidth={2} color="var(--text-muted)" />}>
              All annotations, read progress, and library data are stored locally on your device. Nothing is uploaded anywhere.
            </InfoRow>
          </Section>

        </div>
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes modalIn { from { opacity: 0; transform: scale(0.96) translateY(6px) } to { opacity: 1; transform: scale(1) translateY(0) } }
      `}</style>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 20 }}>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
        color: "var(--text-muted)", padding: "0 20px 8px",
      }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function Row({ label, action }: { label: string; action: React.ReactNode }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "9px 20px",
    }}>
      <span style={{ fontSize: 13, color: "var(--text-primary)" }}>{label}</span>
      {action}
    </div>
  );
}

function IconButton({ icon, onClick, children }: { icon: React.ReactNode; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        padding: "5px 10px", borderRadius: 6,
        background: "var(--bg-raised)", border: "1px solid var(--border-faint)",
        color: "var(--text-dim)", fontSize: 12, fontWeight: 500,
        transition: "all var(--duration-fast) var(--ease-out)",
      }}
      onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = "var(--bg-hover)"; el.style.borderColor = "var(--border-default)"; el.style.color = "var(--text-primary)"; }}
      onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "var(--bg-raised)"; el.style.borderColor = "var(--border-faint)"; el.style.color = "var(--text-dim)"; }}
    >
      {icon}
      {children}
    </button>
  );
}

function InfoRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{
      display: "flex", gap: 10, alignItems: "flex-start",
      padding: "10px 20px",
      margin: "0 16px",
      background: "var(--bg-raised)",
      border: "1px solid var(--border-faint)",
      borderRadius: 8,
    }}>
      <div style={{ paddingTop: 2, flexShrink: 0 }}>{icon}</div>
      <span style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>{children}</span>
    </div>
  );
}

function UpdateRow({ state, onCheck }: { state: UpdateState; onCheck: () => void }) {
  if (state.status === "available") {
    return (
      <div style={{
        background: "rgba(74,155,127,0.08)",
        border: "1px solid rgba(74,155,127,0.25)",
        borderRadius: 10, padding: "14px 16px",
        display: "flex", flexDirection: "column", gap: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Download size={14} color="#4A9B7F" strokeWidth={2} />
          <span style={{ fontSize: 13, fontWeight: 600, color: "#4A9B7F" }}>
            v{state.version} is available
          </span>
        </div>
        <p style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5, margin: 0 }}>
          A new version of PDF Reader is ready to download. Your library, annotations, and read progress will not be affected.
        </p>
        <button
          onClick={() => openUrl(state.url)}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6, alignSelf: "flex-start",
            padding: "7px 14px", borderRadius: 7,
            background: "#4A9B7F22", border: "1px solid #4A9B7F55",
            color: "#4A9B7F", fontSize: 12, fontWeight: 600,
            transition: "all var(--duration-fast) var(--ease-out)",
          }}
          onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = "#4A9B7F33"; el.style.borderColor = "#4A9B7F88"; }}
          onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "#4A9B7F22"; el.style.borderColor = "#4A9B7F55"; }}
        >
          <Download size={11} strokeWidth={2.5} />
          Download on GitHub
        </button>
      </div>
    );
  }

  if (state.status === "upToDate") {
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "12px 16px",
        background: "var(--bg-raised)", border: "1px solid var(--border-faint)",
        borderRadius: 10,
      }}>
        <CheckCircle size={16} color="#4A9B7F" strokeWidth={2} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>You're up to date</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>v{APP_VERSION} is the latest version</div>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div style={{
        display: "flex", alignItems: "flex-start", gap: 10,
        padding: "12px 16px",
        background: "rgba(176,82,82,0.08)", border: "1px solid rgba(176,82,82,0.2)",
        borderRadius: 10,
      }}>
        <AlertCircle size={15} color="#B05252" strokeWidth={2} style={{ flexShrink: 0, marginTop: 1 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: "#c87171" }}>Couldn't check for updates</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>Check your internet connection</div>
          <button
            onClick={onCheck}
            style={{
              marginTop: 8, fontSize: 11, color: "var(--text-dim)",
              background: "transparent", border: "none", padding: 0,
              cursor: "pointer", textDecoration: "underline",
            }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  // idle or checking
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "12px 16px",
      background: "var(--bg-raised)", border: "1px solid var(--border-faint)",
      borderRadius: 10,
    }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>Check for updates</div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>Current version: v{APP_VERSION}</div>
      </div>
      <button
        onClick={onCheck}
        disabled={state.status === "checking"}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "7px 12px", borderRadius: 7,
          background: "var(--bg-active)", border: "1px solid var(--border-default)",
          color: "var(--text-primary)", fontSize: 12, fontWeight: 500,
          transition: "all var(--duration-fast) var(--ease-out)",
          opacity: state.status === "checking" ? 0.5 : 1,
          cursor: state.status === "checking" ? "default" : "pointer",
        }}
        onMouseEnter={e => {
          if (state.status === "checking") return;
          const el = e.currentTarget as HTMLElement;
          el.style.background = "var(--bg-hover)"; el.style.borderColor = "var(--border-strong)"; el.style.color = "var(--text-white)";
        }}
        onMouseLeave={e => {
          const el = e.currentTarget as HTMLElement;
          el.style.background = "var(--bg-active)"; el.style.borderColor = "var(--border-default)"; el.style.color = "var(--text-primary)";
        }}
      >
        <RefreshCw size={11} strokeWidth={2.5} style={{ animation: state.status === "checking" ? "spin 1s linear infinite" : "none" }} />
        {state.status === "checking" ? "Checking…" : "Check now"}
      </button>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}
