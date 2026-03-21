import {
  ZoomIn, ZoomOut, ChevronLeft, ChevronRight,
  Highlighter, Underline, StickyNote, MousePointer,
  RotateCcw, RotateCw, BookOpen, FileText as FileSingle, AlignJustify,
} from "lucide-react";

import { PdfTheme, PageLayout } from "../types";
export type { PageLayout };
import { useState, useEffect } from "react";
import Tooltip from "./Tooltip";

export type AnnotationTool = "select" | "highlight" | "underline" | "note";

interface ToolbarProps {
  currentPage: number;
  totalPages: number;
  zoom: number;
  theme: PdfTheme;
  activeTool: AnnotationTool;
  pageLayout: PageLayout;
  rotation: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onPageInput: (page: number) => void;
  onThemeChange: (theme: PdfTheme) => void;
  onToolChange: (tool: AnnotationTool) => void;
  onPageLayoutChange: (layout: PageLayout) => void;
  onRotate: (deg: number) => void;
}

const THEMES: { id: PdfTheme; label: string; swatch: string; swatchBorder: string }[] = [
  { id: "classic", label: "Classic", swatch: "#f5f5f5",  swatchBorder: "rgba(0,0,0,0.15)" },
  { id: "dark",    label: "Dark",    swatch: "#222222",  swatchBorder: "rgba(255,255,255,0.18)" },
  { id: "warm",    label: "Warm",    swatch: "#2e2a24",  swatchBorder: "rgba(255,255,255,0.12)" },
  { id: "blue",    label: "Blue",    swatch: "#1a2235",  swatchBorder: "rgba(255,255,255,0.12)" },
];

const TOOLS: { id: AnnotationTool; icon: React.ReactNode; tip: string }[] = [
  { id: "select",    icon: <MousePointer size={13} strokeWidth={1.8} />, tip: "Select" },
  { id: "highlight", icon: <Highlighter  size={13} strokeWidth={1.8} />, tip: "Highlight" },
  { id: "underline", icon: <Underline    size={13} strokeWidth={1.8} />, tip: "Underline" },
  { id: "note",      icon: <StickyNote   size={13} strokeWidth={1.8} />, tip: "Add Note" },
];

const T = "background var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out), border-color var(--duration-fast) var(--ease-out)";

function Sep() {
  return <div style={{ width: 1, height: 18, background: "rgba(255,255,255,0.08)", flexShrink: 0, margin: "0 4px" }} />;
}

function Btn({ onClick, disabled = false, active = false, children, tip }: {
  onClick?: () => void; disabled?: boolean; active?: boolean; children: React.ReactNode; tip: string;
}) {
  const btn = (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 34, height: 34, borderRadius: 8, flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: active ? "rgba(255,255,255,0.12)" : "transparent",
        color: disabled ? "rgba(255,255,255,0.2)" : active ? "#fff" : "rgba(255,255,255,0.55)",
        border: active ? "1px solid rgba(255,255,255,0.15)" : "1px solid transparent",
        transition: T,
      }}
      onMouseEnter={e => {
        if (!disabled && !active) {
          (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.08)";
          (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.85)";
        }
      }}
      onMouseLeave={e => {
        if (!active) {
          (e.currentTarget as HTMLElement).style.background = "transparent";
          (e.currentTarget as HTMLElement).style.color = disabled ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.55)";
        }
      }}
    >
      {children}
    </button>
  );
  return disabled ? btn : <Tooltip label={tip}>{btn}</Tooltip>;
}

export default function Toolbar({
  currentPage, totalPages, zoom, theme, activeTool, pageLayout, rotation,
  onZoomIn, onZoomOut, onZoomReset,
  onPrevPage, onNextPage, onPageInput,
  onThemeChange, onToolChange, onPageLayoutChange, onRotate,
}: ToolbarProps) {
  const [pageVal, setPageVal] = useState(String(currentPage));
  useEffect(() => { setPageVal(String(currentPage)); }, [currentPage]);

  function commitPage() {
    const v = parseInt(pageVal);
    if (!isNaN(v) && v >= 1 && v <= totalPages) onPageInput(v);
    else setPageVal(String(currentPage));
  }

  return (
    <div style={{
      position: "absolute",
      bottom: 24,
      left: "50%",
      transform: "translateX(-50%)",
      zIndex: 100,
      pointerEvents: "none",
    }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 3,
        padding: "8px 14px",
        background: "rgba(18,18,18,0.88)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        border: "1px solid rgba(255,255,255,0.22)",
        borderRadius: 14,
        boxShadow: "0 8px 32px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.06) inset",
        pointerEvents: "all",
        whiteSpace: "nowrap",
      }}>

        {/* Annotation tools */}
        {TOOLS.map(tool => (
          <Btn
            key={tool.id}
            active={activeTool === tool.id}
            onClick={() => onToolChange(tool.id)}
            tip={tool.tip}
          >
            {tool.icon}
          </Btn>
        ))}

        <Sep />

        {/* Page navigation */}
        <Btn onClick={onPrevPage} disabled={currentPage <= 1} tip="Previous page">
          <ChevronLeft size={13} strokeWidth={2} />
        </Btn>

        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <input
            type="number"
            value={pageVal}
            min={1} max={totalPages}
            onChange={e => setPageVal(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { commitPage(); (e.target as HTMLInputElement).blur(); } }}
            style={{
              width: 34, height: 26,
              textAlign: "center",
              background: "rgba(255,255,255,0.07)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 6,
              color: "#e0e0e0",
              fontSize: 12, fontWeight: 500,
              outline: "none",
              fontFamily: "var(--font-mono)",
              transition: "border-color var(--duration-fast) var(--ease-out)",
            }}
            onFocus={e => (e.target.style.borderColor = "rgba(255,255,255,0.28)")}
            onBlur={e => { (e.target as HTMLInputElement).style.borderColor = "rgba(255,255,255,0.12)"; commitPage(); }}
          />
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.28)", fontFamily: "var(--font-mono)" }}>
            / {totalPages}
          </span>
        </div>

        <Btn onClick={onNextPage} disabled={currentPage >= totalPages} tip="Next page">
          <ChevronRight size={13} strokeWidth={2} />
        </Btn>

        <Sep />

        {/* Zoom */}
        <Btn onClick={onZoomOut} tip="Zoom out">
          <ZoomOut size={13} strokeWidth={1.8} />
        </Btn>

        <Tooltip label="Reset zoom">
          <button
            onClick={onZoomReset}
            style={{
              height: 26, padding: "0 8px",
              background: "rgba(255,255,255,0.07)",
              border: "1px solid rgba(255,255,255,0.10)",
              borderRadius: 6,
              fontSize: 11, fontWeight: 500,
              color: "rgba(255,255,255,0.45)",
              fontFamily: "var(--font-mono)",
              transition: T,
              whiteSpace: "nowrap",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.22)"; (e.currentTarget as HTMLElement).style.color = "#fff"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.10)"; (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.45)"; }}
          >
            {Math.round(zoom * 100)}%
          </button>
        </Tooltip>

        <Btn onClick={onZoomIn} tip="Zoom in">
          <ZoomIn size={13} strokeWidth={1.8} />
        </Btn>

        <Sep />

        {/* Page layout */}
        <Btn active={pageLayout === "single"} onClick={() => onPageLayoutChange("single")} tip="Single page">
          <FileSingle size={13} strokeWidth={1.8} />
        </Btn>
        <Btn active={pageLayout === "double"} onClick={() => onPageLayoutChange("double")} tip="Two pages">
          <BookOpen size={13} strokeWidth={1.8} />
        </Btn>
        <Btn active={pageLayout === "continuous"} onClick={() => onPageLayoutChange("continuous")} tip="Continuous scroll">
          <AlignJustify size={13} strokeWidth={1.8} />
        </Btn>

        <Sep />

        {/* Rotate */}
        <Btn onClick={() => onRotate((rotation - 90 + 360) % 360)} tip="Rotate left">
          <RotateCcw size={13} strokeWidth={1.8} />
        </Btn>
        <Btn onClick={() => onRotate((rotation + 90) % 360)} tip="Rotate right">
          <RotateCw size={13} strokeWidth={1.8} />
        </Btn>

        <Sep />

        {/* Theme swatches — just circles, no labels */}
        {THEMES.map(t => {
          const isActive = theme === t.id;
          return (
            <Tooltip key={t.id} label={t.label}>
              <button
                onClick={() => onThemeChange(t.id)}
                style={{
                  width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: isActive ? "rgba(255,255,255,0.10)" : "transparent",
                  border: isActive ? "1px solid rgba(255,255,255,0.18)" : "1px solid transparent",
                  transition: T,
                }}
                onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)"; }}
                onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <div style={{
                  width: 11, height: 11, borderRadius: "50%",
                  background: t.swatch,
                  border: `1.5px solid ${t.swatchBorder}`,
                  boxShadow: isActive ? "0 0 0 2px rgba(255,255,255,0.25)" : "none",
                  transition: "box-shadow var(--duration-fast) var(--ease-out)",
                }} />
              </button>
            </Tooltip>
          );
        })}

      </div>
    </div>
  );
}
