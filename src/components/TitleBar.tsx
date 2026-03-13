import { getCurrentWindow } from "@tauri-apps/api/window";
import { BookOpen, Minus, Square, X, House, Plus } from "lucide-react";
import { useState } from "react";
import type { PdfFile } from "../types";

type DragStyle = React.CSSProperties & { WebkitAppRegion?: "drag" | "no-drag" };

function getAccentColor(str: string): string {
  const colors = ["#5B6AD0", "#7C5CBF", "#C2784A", "#4A9B7F", "#B05252", "#4A7AB0", "#8A6B3E", "#4D8A6B"];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

interface TitleBarProps {
  files: PdfFile[];
  activeFileId: string | null;
  onSelectFile: (id: string) => void;
  onCloseFile: (id: string) => void;
  onGoHome: () => void;
  onOpenFile: () => void;
  isHome: boolean;
}

export default function TitleBar({
  files, activeFileId, onSelectFile, onCloseFile, onGoHome, onOpenFile, isHome,
}: TitleBarProps) {
  const win = getCurrentWindow();
  const minimize = () => win.minimize();
  const toggleMax = async () => {
    if (await win.isMaximized()) await win.unmaximize();
    else await win.maximize();
  };
  const close = () => win.close();

  return (
    <div
      data-tauri-drag-region
      style={{
        height: 40, flexShrink: 0,
        background: "var(--bg-sidebar)",
        borderBottom: "1px solid var(--border-faint)",
        display: "flex", alignItems: "center",
        WebkitAppRegion: "drag",
      } as DragStyle}
    >
      {/* App icon — left anchor */}
      <div style={{
        width: 46, flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        WebkitAppRegion: "no-drag",
      } as DragStyle}>
        <div style={{
          width: 22, height: 22,
          background: "var(--bg-raised)",
          border: "1px solid var(--border-soft)",
          borderRadius: 6,
          display: "flex", alignItems: "center", justifyContent: "center",
          pointerEvents: "none",
        }}>
          <BookOpen size={11} color="var(--text-dim)" strokeWidth={2} />
        </div>
      </div>

      {/* Tab strip */}
      <div style={{
        flex: 1, display: "flex", alignItems: "center",
        gap: 2, overflow: "hidden",
        WebkitAppRegion: "no-drag",
        padding: "0 4px",
      } as DragStyle}>

        {/* Home tab */}
        <Tab
          label="Library"
          icon={<House size={11} strokeWidth={1.8} />}
          isActive={isHome}
          onClick={onGoHome}
        />

        {/* File tabs */}
        {files.map(file => (
          <Tab
            key={file.id}
            label={file.name.replace(/\.pdf$/i, "")}
            icon={
              <div style={{
                width: 12, height: 12, borderRadius: 3, flexShrink: 0,
                background: getAccentColor(file.name) + "33",
                border: `1px solid ${getAccentColor(file.name)}55`,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <span style={{ fontSize: 6, fontWeight: 700, color: getAccentColor(file.name), lineHeight: 1 }}>
                  {file.name.slice(0, 1).toUpperCase()}
                </span>
              </div>
            }
            isActive={!isHome && file.id === activeFileId}
            onClick={() => onSelectFile(file.id)}
            onClose={() => onCloseFile(file.id)}
          />
        ))}

        {/* New tab button */}
        <button
          onClick={onOpenFile}
          title="Open PDF"
          style={{
            flexShrink: 0, width: 24, height: 24, borderRadius: 6,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "var(--text-muted)", background: "transparent",
            transition: "background var(--duration-fast), color var(--duration-fast)",
            marginLeft: 2,
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)"; (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}
        >
          <Plus size={12} strokeWidth={2} />
        </button>
      </div>

      {/* Window controls */}
      <div style={{ display: "flex", flexShrink: 0, WebkitAppRegion: "no-drag" } as DragStyle}>
        {[
          { icon: <Minus size={10} strokeWidth={2.5} />, action: minimize, label: "Minimize", danger: false },
          { icon: <Square size={9} strokeWidth={2.5} />, action: toggleMax, label: "Maximize/Restore", danger: false },
          { icon: <X size={11} strokeWidth={2.5} />, action: close, label: "Close", danger: true },
        ].map((btn, i) => (
          <button
            key={i}
            onClick={btn.action}
            title={btn.label}
            style={{
              width: 46, height: 40,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "var(--text-muted)", background: "transparent",
              transition: "background var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out)",
            }}
            onMouseEnter={e => {
              const el = e.currentTarget as HTMLElement;
              el.style.background = btn.danger ? "rgba(239,68,68,0.14)" : "var(--bg-hover)";
              el.style.color = btn.danger ? "#f87171" : "var(--text-primary)";
            }}
            onMouseLeave={e => {
              const el = e.currentTarget as HTMLElement;
              el.style.background = "transparent";
              el.style.color = "var(--text-muted)";
            }}
          >
            {btn.icon}
          </button>
        ))}
      </div>
    </div>
  );
}

function Tab({
  label, icon, isActive, onClick, onClose,
}: {
  label: string;
  icon: React.ReactNode;
  isActive: boolean;
  onClick: () => void;
  onClose?: () => void;
}) {
  const [hov, setHov] = useState(false);
  const [closeHov, setCloseHov] = useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => { setHov(false); setCloseHov(false); }}
      style={{
        display: "flex", alignItems: "center", gap: 5,
        padding: "0 8px", height: 28,
        borderRadius: 6, flexShrink: 0,
        maxWidth: 160, minWidth: 60,
        background: isActive ? "var(--bg-active)" : hov ? "var(--bg-hover)" : "transparent",
        border: `1px solid ${isActive ? "var(--border-default)" : "transparent"}`,
        cursor: "pointer",
        transition: "background var(--duration-fast) var(--ease-out), border-color var(--duration-fast) var(--ease-out)",
        position: "relative",
      }}
    >
      <span style={{ flexShrink: 0, display: "flex", alignItems: "center", color: isActive ? "var(--text-primary)" : "var(--text-dim)" }}>
        {icon}
      </span>

      <span style={{
        fontSize: 12, fontWeight: isActive ? 500 : 400,
        color: isActive ? "var(--text-white)" : hov ? "var(--text-primary)" : "var(--text-dim)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        flex: 1, letterSpacing: "-0.01em",
        transition: "color var(--duration-fast)",
      }}>
        {label}
      </span>

      {onClose && (
        <button
          onClick={e => { e.stopPropagation(); onClose(); }}
          onMouseEnter={() => setCloseHov(true)}
          onMouseLeave={() => setCloseHov(false)}
          style={{
            flexShrink: 0, width: 14, height: 14, borderRadius: 3,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: closeHov ? "rgba(239,68,68,0.15)" : "transparent",
            color: closeHov ? "#f87171" : "var(--text-muted)",
            opacity: hov || isActive ? 1 : 0,
            transition: "opacity var(--duration-fast), background var(--duration-fast), color var(--duration-fast)",
          }}
        >
          <X size={9} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}
