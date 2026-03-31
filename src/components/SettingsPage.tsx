import { useState } from "react";
import {
  BookOpen, RefreshCw, CheckCircle, AlertCircle,
  ExternalLink, Download, Shield, Info, Sparkles,
  FileText, AlignJustify, Sun,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, PdfTheme, PageLayout } from "../types";

const APP_VERSION = "0.4.0";

type NavItem = "general" | "reading" | "library" | "updates" | "privacy" | "shortcuts";

type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "upToDate" }
  | { status: "available"; version: string; url: string }
  | { status: "downloading" }
  | { status: "error" };

function openUrl(url: string) {
  import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(url)).catch(() => {});
}

const NAV: { id: NavItem; label: string }[] = [
  { id: "general",   label: "General"    },
  { id: "reading",   label: "Reading"    },
  { id: "library",   label: "Library"    },
  { id: "updates",   label: "Updates"    },
  { id: "privacy",   label: "Privacy"    },
  { id: "shortcuts", label: "Shortcuts"  },
];

// ── Root ──────────────────────────────────────────────────────────────────────

interface Props {
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
}

export default function SettingsPage({ settings, onUpdate }: Props) {
  const [active, setActive] = useState<NavItem>("general");
  const [updateState, setUpdateState] = useState<UpdateState>({ status: "idle" });

  async function checkForUpdate() {
    setUpdateState({ status: "checking" });
    try {
      const r = await invoke<{ up_to_date: boolean; latest_version: string; release_url: string }>("check_for_update");
      setUpdateState(r.up_to_date
        ? { status: "upToDate" }
        : { status: "available", version: r.latest_version, url: r.release_url });
    } catch {
      setUpdateState({ status: "error" });
    }
  }

  async function installUpdate() {
    setUpdateState({ status: "downloading" });
    try {
      await invoke("install_update");
      // app restarts automatically after install
    } catch {
      setUpdateState({ status: "error" });
    }
  }

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden", background: "var(--bg-app)" }}>

      {/* ── Left sidebar ── */}
      <div style={{
        width: 196, flexShrink: 0,
        borderRight: "1px solid var(--border-faint)",
        padding: "40px 10px 40px",
        display: "flex", flexDirection: "column",
      }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text-white)", letterSpacing: "-0.03em", marginBottom: 20, paddingLeft: 10 }}>
          Settings
        </div>
        <nav style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {NAV.map(item => {
            const isActive = active === item.id;
            return (
              <button key={item.id} onClick={() => setActive(item.id)} style={{
                width: "100%", textAlign: "left",
                padding: "7px 10px", borderRadius: 7,
                fontSize: 13, fontWeight: isActive ? 500 : 400,
                color: isActive ? "var(--text-white)" : "var(--text-dim)",
                background: isActive ? "var(--bg-active)" : "transparent",
                border: "none", cursor: "pointer",
                transition: "all var(--duration-fast) var(--ease-out)",
              }}
                onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)"; (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"; }}
                onMouseLeave={e => { if (!isActive) { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--text-dim)"; } }}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* ── Right content ── */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ maxWidth: 600, padding: "40px 48px 80px" }}>
          {active === "general"   && <GeneralPanel />}
          {active === "reading"   && <ReadingPanel settings={settings} onUpdate={onUpdate} />}
          {active === "library"   && <LibraryPanel settings={settings} onUpdate={onUpdate} />}
          {active === "updates"   && <UpdatesPanel state={updateState} onCheck={checkForUpdate} onInstall={installUpdate} />}
          {active === "privacy"   && <PrivacyPanel />}
          {active === "shortcuts" && <ShortcutsPanel />}
        </div>
      </div>
    </div>
  );
}

// ── Shared components ─────────────────────────────────────────────────────────

function PanelTitle({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-white)", letterSpacing: "-0.03em", margin: "0 0 28px" }}>{children}</h2>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", letterSpacing: "-0.01em", marginBottom: 12, paddingBottom: 10, borderBottom: "1px solid var(--border-faint)" }}>
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>{children}</div>
    </div>
  );
}

function Row({ label, sub, children }: { label: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid var(--border-faint)", gap: 16 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, lineHeight: 1.5 }}>{sub}</div>}
      </div>
      {children && <div style={{ flexShrink: 0 }}>{children}</div>}
    </div>
  );
}

function LinkBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 11px", borderRadius: 6, background: "var(--bg-raised)", border: "1px solid var(--border-faint)", color: "var(--text-dim)", fontSize: 12, fontWeight: 500, transition: "all var(--duration-fast) var(--ease-out)" }}
      onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = "var(--bg-hover)"; el.style.borderColor = "var(--border-default)"; el.style.color = "var(--text-primary)"; }}
      onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "var(--bg-raised)"; el.style.borderColor = "var(--border-faint)"; el.style.color = "var(--text-dim)"; }}
    >{children}</button>
  );
}

function InfoBox({ icon, accent, children }: { icon: React.ReactNode; accent?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 11, alignItems: "flex-start", padding: "12px 14px", marginBottom: 8, background: accent ? `${accent}0c` : "var(--bg-raised)", border: `1px solid ${accent ? `${accent}25` : "var(--border-faint)"}`, borderRadius: 9 }}>
      <div style={{ flexShrink: 0, paddingTop: 1 }}>{icon}</div>
      <p style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.65, margin: 0 }}>{children}</p>
    </div>
  );
}

// ── Toggle switch ─────────────────────────────────────────────────────────────

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        width: 40, height: 22, borderRadius: 11, border: "none",
        background: value ? "#4A9B7F" : "var(--bg-active)",
        position: "relative", cursor: "pointer", flexShrink: 0,
        transition: "background 200ms var(--ease-out)",
      }}
    >
      <div style={{
        position: "absolute", top: 2, left: value ? 20 : 2,
        width: 18, height: 18, borderRadius: "50%", background: "#fff",
        transition: "left 200ms var(--ease-out)",
        boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
      }} />
    </button>
  );
}

// ── Segmented control ─────────────────────────────────────────────────────────

function SegmentedControl<T extends string>({ options, value, onChange }: {
  options: { value: T; label: string; icon?: React.ReactNode }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 2, background: "var(--bg-active)", borderRadius: 8, padding: 2 }}>
      {options.map(opt => (
        <button key={opt.value} onClick={() => onChange(opt.value)} style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          padding: "5px 12px", borderRadius: 6, fontSize: 12, fontWeight: 500,
          background: value === opt.value ? "var(--bg-raised)" : "transparent",
          border: value === opt.value ? "1px solid var(--border-soft)" : "1px solid transparent",
          color: value === opt.value ? "var(--text-white)" : "var(--text-dim)",
          cursor: "pointer", transition: "all var(--duration-fast) var(--ease-out)",
          boxShadow: value === opt.value ? "0 1px 4px rgba(0,0,0,0.25)" : "none",
        }}>
          {opt.icon}{opt.label}
        </button>
      ))}
    </div>
  );
}

// ── General panel ─────────────────────────────────────────────────────────────

function GeneralPanel() {
  return (
    <>
      <PanelTitle>General</PanelTitle>
      <Section title="About">
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", marginBottom: 8, background: "var(--bg-raised)", borderRadius: 10, border: "1px solid var(--border-faint)" }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, flexShrink: 0, background: "var(--bg-active)", border: "1px solid var(--border-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <BookOpen size={20} color="var(--text-dim)" strokeWidth={1.5} />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-white)", letterSpacing: "-0.02em" }}>PDF Reader</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>Version {APP_VERSION} · Tauri + React</div>
          </div>
        </div>
        <Row label="Source code" sub="View the project on GitHub">
          <LinkBtn onClick={() => openUrl("https://github.com/anurag12-webster/Reader")}><ExternalLink size={11} strokeWidth={2} /> GitHub</LinkBtn>
        </Row>
        <Row label="Report a bug" sub="Open an issue on GitHub">
          <LinkBtn onClick={() => openUrl("https://github.com/anurag12-webster/Reader/issues")}><ExternalLink size={11} strokeWidth={2} /> Open issue</LinkBtn>
        </Row>
        <Row label="Release notes" sub="See what changed in each version">
          <LinkBtn onClick={() => openUrl("https://github.com/anurag12-webster/Reader/releases")}><ExternalLink size={11} strokeWidth={2} /> View all</LinkBtn>
        </Row>
      </Section>
    </>
  );
}

// ── Reading panel ─────────────────────────────────────────────────────────────

const THEME_OPTIONS: { value: PdfTheme; label: string; swatch: string }[] = [
  { value: "classic", label: "Classic", swatch: "#f5f5f5" },
  { value: "dark",    label: "Dark",    swatch: "#222222" },
  { value: "warm",    label: "Warm",    swatch: "#2e2a24" },
  { value: "blue",    label: "Blue",    swatch: "#1a2235" },
];

const LAYOUT_OPTIONS: { value: PageLayout; label: string; icon: React.ReactNode }[] = [
  { value: "single",     label: "Single",     icon: <FileText size={12} strokeWidth={1.8} /> },
  { value: "double",     label: "Double",     icon: <BookOpen size={12} strokeWidth={1.8} /> },
  { value: "continuous", label: "Continuous", icon: <AlignJustify size={12} strokeWidth={1.8} /> },
];

const ZOOM_PRESETS = [
  { label: "75%",  value: 0.75 },
  { label: "100%", value: 1.0  },
  { label: "125%", value: 1.25 },
  { label: "150%", value: 1.5  },
  { label: "175%", value: 1.75 },
  { label: "200%", value: 2.0  },
];

function ReadingPanel({ settings, onUpdate }: { settings: AppSettings; onUpdate: (p: Partial<AppSettings>) => void }) {
  return (
    <>
      <PanelTitle>Reading</PanelTitle>
      <div style={{ marginBottom: 4, fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
        These defaults apply when opening a new PDF. You can still change them per-file using the toolbar.
      </div>
      <div style={{ marginBottom: 24 }} />

      <Section title="Default layout">
        <div style={{ padding: "12px 0" }}>
          <SegmentedControl
            options={LAYOUT_OPTIONS}
            value={settings.defaultLayout}
            onChange={v => onUpdate({ defaultLayout: v })}
          />
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.5 }}>
            {settings.defaultLayout === "continuous"
              ? "All pages in one scrollable column. Great for papers and long reads."
              : settings.defaultLayout === "double"
              ? "Two pages side by side. Great for books and wide displays."
              : "One page at a time. Classic paginated reading."}
          </div>
        </div>
      </Section>

      <Section title="Default theme">
        <div style={{ padding: "12px 0", display: "flex", gap: 10 }}>
          {THEME_OPTIONS.map(t => {
            const isActive = settings.defaultTheme === t.value;
            return (
              <button key={t.value} onClick={() => onUpdate({ defaultTheme: t.value })} style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                padding: "8px 10px", borderRadius: 8, border: `1.5px solid ${isActive ? "var(--border-strong)" : "var(--border-faint)"}`,
                background: isActive ? "var(--bg-active)" : "var(--bg-raised)",
                cursor: "pointer", transition: "all var(--duration-fast) var(--ease-out)",
              }}>
                <div style={{ width: 36, height: 28, borderRadius: 5, background: t.swatch, border: "1px solid rgba(0,0,0,0.15)" }} />
                <span style={{ fontSize: 11, fontWeight: isActive ? 600 : 400, color: isActive ? "var(--text-white)" : "var(--text-dim)" }}>{t.label}</span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Default zoom">
        <div style={{ padding: "12px 0" }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {ZOOM_PRESETS.map(z => {
              const isActive = Math.abs(settings.defaultZoom - z.value) < 0.01;
              return (
                <button key={z.value} onClick={() => onUpdate({ defaultZoom: z.value })} style={{
                  padding: "5px 14px", borderRadius: 7, fontSize: 12, fontWeight: isActive ? 600 : 400,
                  background: isActive ? "var(--bg-active)" : "var(--bg-raised)",
                  border: `1px solid ${isActive ? "var(--border-strong)" : "var(--border-faint)"}`,
                  color: isActive ? "var(--text-white)" : "var(--text-dim)",
                  cursor: "pointer", transition: "all var(--duration-fast) var(--ease-out)",
                }}>
                  {z.label}
                </button>
              );
            })}
          </div>
        </div>
      </Section>
    </>
  );
}

// ── Library panel ─────────────────────────────────────────────────────────────

function LibraryPanel({ settings, onUpdate }: { settings: AppSettings; onUpdate: (p: Partial<AppSettings>) => void }) {
  return (
    <>
      <PanelTitle>Library</PanelTitle>
      <Section title="Thumbnails">
        <Row label="Show PDF thumbnails" sub="Renders first page as preview in the library. Disable for better performance on older hardware.">
          <Toggle value={settings.showThumbnails} onChange={v => onUpdate({ showThumbnails: v })} />
        </Row>
      </Section>
      <Section title="Info">
        <InfoBox icon={<Info size={13} color="var(--text-muted)" strokeWidth={2} />}>
          Thumbnails are generated using the PDFium library and cached in memory. On a slow machine, disabling them will make the library load faster.
        </InfoBox>
      </Section>
    </>
  );
}

// ── Updates panel ─────────────────────────────────────────────────────────────

function UpdatesPanel({ state, onCheck, onInstall }: { state: UpdateState; onCheck: () => void; onInstall: () => void }) {
  return (
    <>
      <PanelTitle>Updates</PanelTitle>
      <Section title="App version">
        <Row label="Current version" sub="Installed on this device">
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)", background: "var(--bg-raised)", border: "1px solid var(--border-faint)", borderRadius: 5, padding: "3px 8px" }}>
            v{APP_VERSION}
          </span>
        </Row>
      </Section>
      <Section title="Check for updates">
        <UpdateCard state={state} onCheck={onCheck} onInstall={onInstall} />
      </Section>
    </>
  );
}

function UpdateCard({ state, onCheck, onInstall }: { state: UpdateState; onCheck: () => void; onInstall: () => void }) {
  if (state.status === "available") {
    return (
      <div style={{ padding: "16px 18px", borderRadius: 10, background: "rgba(74,155,127,0.07)", border: "1px solid rgba(74,155,127,0.25)", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Sparkles size={14} color="#4A9B7F" strokeWidth={2} />
          <span style={{ fontSize: 14, fontWeight: 600, color: "#4A9B7F", letterSpacing: "-0.02em" }}>v{state.version} is available</span>
        </div>
        <p style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.65, margin: 0 }}>
          A new version is ready. Your library, annotations, and read progress are not affected.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onInstall} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 7, background: "#4A9B7F", border: "none", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "opacity var(--duration-fast)" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "0.82"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}>
            <Download size={12} strokeWidth={2.5} /> Install update
          </button>
          <button onClick={() => openUrl(state.url)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 7, background: "transparent", border: "1px solid var(--border-default)", color: "var(--text-dim)", fontSize: 12, fontWeight: 500, cursor: "pointer" }}>
            <ExternalLink size={11} strokeWidth={2} /> View release
          </button>
        </div>
      </div>
    );
  }
  if (state.status === "downloading") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderRadius: 10, background: "rgba(74,155,127,0.06)", border: "1px solid rgba(74,155,127,0.18)" }}>
        <RefreshCw size={16} color="#4A9B7F" strokeWidth={2} style={{ animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>Downloading update…</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>The app will restart automatically when done</div>
        </div>
      </div>
    );
  }
  if (state.status === "upToDate") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderRadius: 10, background: "rgba(74,155,127,0.06)", border: "1px solid rgba(74,155,127,0.18)" }}>
        <CheckCircle size={17} color="#4A9B7F" strokeWidth={2} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>You're up to date</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>v{APP_VERSION} is the latest version</div>
        </div>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "14px 16px", borderRadius: 10, background: "rgba(176,82,82,0.07)", border: "1px solid rgba(176,82,82,0.2)" }}>
        <AlertCircle size={16} color="#B05252" strokeWidth={2} style={{ flexShrink: 0, marginTop: 1 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#c87171" }}>Couldn't check for updates</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>Check your internet connection</div>
          <button onClick={onCheck} style={{ marginTop: 8, fontSize: 11, color: "var(--text-dim)", background: "none", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline" }}>Try again</button>
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderRadius: 10, background: "var(--bg-raised)", border: "1px solid var(--border-faint)" }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>Check for updates</div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>Current version: v{APP_VERSION}</div>
      </div>
      <button onClick={onCheck} disabled={state.status === "checking"} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 7, background: "var(--bg-active)", border: "1px solid var(--border-default)", color: "var(--text-primary)", fontSize: 12, fontWeight: 500, opacity: state.status === "checking" ? 0.5 : 1, cursor: state.status === "checking" ? "default" : "pointer", transition: "all var(--duration-fast) var(--ease-out)" }}
        onMouseEnter={e => { if (state.status === "checking") return; const el = e.currentTarget as HTMLElement; el.style.background = "var(--bg-hover)"; el.style.borderColor = "var(--border-strong)"; el.style.color = "var(--text-white)"; }}
        onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "var(--bg-active)"; el.style.borderColor = "var(--border-default)"; el.style.color = "var(--text-primary)"; }}>
        <RefreshCw size={11} strokeWidth={2.5} style={{ animation: state.status === "checking" ? "spin 0.8s linear infinite" : "none" }} />
        {state.status === "checking" ? "Checking…" : "Check now"}
      </button>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}

// ── Privacy panel ─────────────────────────────────────────────────────────────

function PrivacyPanel() {
  return (
    <>
      <PanelTitle>Privacy</PanelTitle>
      <Section title="Your data">
        <Row label="Data storage" sub="Annotations, read progress, bookmarks, library">
          <span style={{ fontSize: 11, color: "#4A9B7F", fontWeight: 600 }}>Local only</span>
        </Row>
        <Row label="Telemetry" sub="Analytics or crash reports sent to any server">
          <span style={{ fontSize: 11, color: "#4A9B7F", fontWeight: 600 }}>None</span>
        </Row>
        <Row label="Background network requests" sub="Requests made while the app is idle">
          <span style={{ fontSize: 11, color: "#4A9B7F", fontWeight: 600 }}>None</span>
        </Row>
        <Row label="Update checks" sub="Only when you click Check now in Updates">
          <span style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 600 }}>On demand</span>
        </Row>
      </Section>
      <Section title="Storage">
        <InfoBox icon={<Shield size={13} color="#4A9B7F" strokeWidth={2} />} accent="#4A9B7F">
          All your data lives in your system's app data directory. Nothing leaves your device unless you share a file yourself.
        </InfoBox>
        <InfoBox icon={<Info size={13} color="var(--text-muted)" strokeWidth={2} />}>
          To reset all data, delete <code style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)", background: "var(--bg-active)", padding: "1px 5px", borderRadius: 3 }}>library.json</code> from your app data folder. This removes annotations and read progress.
        </InfoBox>
      </Section>
    </>
  );
}

// ── Shortcuts panel ───────────────────────────────────────────────────────────

const SHORTCUTS: { group: string; items: { keys: string[]; label: string }[] }[] = [
  {
    group: "Navigation",
    items: [
      { keys: ["→", "↓"], label: "Next page" },
      { keys: ["←", "↑"], label: "Previous page" },
    ],
  },
  {
    group: "Zoom",
    items: [
      { keys: ["Ctrl", "+"], label: "Zoom in" },
      { keys: ["Ctrl", "−"], label: "Zoom out" },
      { keys: ["Ctrl", "0"], label: "Reset zoom to 150%" },
      { keys: ["Ctrl", "Scroll"], label: "Zoom to cursor" },
    ],
  },
  {
    group: "Scroll",
    items: [
      { keys: ["Shift", "Scroll"], label: "Scroll horizontally" },
    ],
  },
  {
    group: "Annotations",
    items: [
      { keys: ["Right-click"], label: "Delete annotation under cursor" },
    ],
  },
  {
    group: "Window",
    items: [
      { keys: ["Esc"], label: "Close settings" },
    ],
  },
];

function ShortcutsPanel() {
  return (
    <>
      <PanelTitle>Shortcuts</PanelTitle>
      {SHORTCUTS.map(group => (
        <Section key={group.group} title={group.group}>
          {group.items.map((item, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--border-faint)" }}>
              <span style={{ fontSize: 13, color: "var(--text-primary)" }}>{item.label}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {item.keys.map((k, j) => (
                  <span key={j} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <kbd style={{
                      display: "inline-block", padding: "2px 7px", borderRadius: 5,
                      background: "var(--bg-raised)", border: "1px solid var(--border-default)",
                      fontSize: 11, fontFamily: "var(--font-sans)", fontWeight: 500,
                      color: "var(--text-primary)", lineHeight: "18px",
                      boxShadow: "0 1px 0 var(--border-soft)",
                    }}>{k}</kbd>
                    {j < item.keys.length - 1 && <span style={{ fontSize: 10, color: "var(--text-muted)" }}>+</span>}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </Section>
      ))}
      <InfoBox icon={<Sun size={13} color="var(--text-muted)" strokeWidth={2} />}>
        More keyboard shortcuts coming soon. Customizable bindings are planned for a future release.
      </InfoBox>
    </>
  );
}
