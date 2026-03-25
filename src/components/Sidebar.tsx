import { Plus, FolderOpen, PanelLeftClose, PanelLeftOpen, ChevronRight } from "lucide-react";
import { PdfFile, OutlineItem } from "../types";
import { useState, useEffect } from "react";
import * as pdfjsLib from "pdfjs-dist";

interface SidebarProps {
  activeFile: PdfFile | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenFile: () => void;
  onPageJump: (page: number) => void;
}

async function resolveDestPage(pdf: pdfjsLib.PDFDocumentProxy, dest: OutlineItem["dest"]): Promise<number | null> {
  // Rust-generated outline uses "__p__N" to encode 1-based page numbers directly
  if (typeof dest === "string" && dest.startsWith("__p__")) {
    return parseInt(dest.slice(5), 10);
  }
  try {
    let resolved: unknown[] | null = null;
    if (typeof dest === "string") {
      resolved = await pdf.getDestination(dest);
    } else if (Array.isArray(dest)) {
      resolved = dest as unknown[];
    }
    if (!resolved || !resolved[0]) return null;
    const ref = resolved[0] as { num: number; gen: number };
    const pageIndex = await pdf.getPageIndex(ref);
    return pageIndex + 1;
  } catch {
    return null;
  }
}

function OutlineNode({
  item, depth, pdfDoc, onPageJump, currentPage,
}: {
  item: OutlineItem;
  depth: number;
  pdfDoc: pdfjsLib.PDFDocumentProxy | null;
  onPageJump: (page: number) => void;
  currentPage: number;
}) {
  const [open, setOpen] = useState(depth === 0);

  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (item.items?.length) setOpen(v => !v);
    if (!pdfDoc || item.dest == null) return;
    const page = await resolveDestPage(pdfDoc, item.dest);
    if (page != null) onPageJump(page);
  }

  return (
    <div>
      <div
        onClick={handleClick}
        style={{
          display: "flex", alignItems: "center", gap: 5,
          padding: `4px 8px 4px ${12 + depth * 12}px`,
          borderRadius: 6,
          cursor: "pointer",
          marginBottom: 1,
          transition: "background var(--duration-fast) var(--ease-out)",
        }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)"}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}
      >
        {item.items?.length > 0 && (
          <ChevronRight
            size={10}
            strokeWidth={2}
            style={{
              flexShrink: 0,
              color: "var(--text-muted)",
              transform: open ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform var(--duration-fast) var(--ease-out)",
            }}
          />
        )}
        {(!item.items?.length) && (
          <div style={{ width: 10, flexShrink: 0 }} />
        )}
        <span style={{
          fontSize: 12,
          color: depth === 0 ? "var(--text-primary)" : "var(--text-dim)",
          fontWeight: depth === 0 ? 500 : 400,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          letterSpacing: "-0.01em",
          lineHeight: 1.4,
        }}>
          {item.title}
        </span>
      </div>
      {open && item.items?.map((child, i) => (
        <OutlineNode
          key={i}
          item={child}
          depth={depth + 1}
          pdfDoc={pdfDoc}
          onPageJump={onPageJump}
          currentPage={currentPage}
        />
      ))}
    </div>
  );
}

export default function Sidebar({
  activeFile, collapsed, onToggleCollapse, onOpenFile, onPageJump,
}: SidebarProps) {

  // Load pdf doc proxy for destination resolution
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  useEffect(() => {
    if (!activeFile) { setPdfDoc(null); return; }
    let cancelled = false;
    pdfjsLib.getDocument({ url: activeFile.path }).promise
      .then(doc => { if (!cancelled) setPdfDoc(doc); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeFile?.id]);

  const hasOutline = activeFile && activeFile.outline.length > 0;

  return (
    <aside style={{
      width: collapsed ? 40 : 216,
      flexShrink: 0,
      background: "var(--bg-sidebar)",
      borderRight: "1px solid var(--border-faint)",
      display: "flex",
      flexDirection: "column",
      height: "100%",
      overflow: "hidden",
      transition: "width var(--duration-base) var(--ease-out)",
    }}>

      {/* Header row */}
      <div style={{ padding: "10px 8px 6px", display: "flex", gap: 4, alignItems: "center" }}>
        <button
          onClick={onToggleCollapse}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          style={{
            flexShrink: 0, width: 26, height: 26, borderRadius: 6,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "var(--text-dim)",
            transition: "background var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out)",
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)"; (e.currentTarget as HTMLElement).style.color = "var(--text-white)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--text-dim)"; }}
        >
          {collapsed ? <PanelLeftOpen size={13} strokeWidth={1.8} /> : <PanelLeftClose size={13} strokeWidth={1.8} />}
        </button>


        {!collapsed && !activeFile && (
          <button
            onClick={onOpenFile}
            style={{
              flex: 1, padding: "5px 10px",
              background: "var(--bg-raised)",
              border: "1px solid var(--border-default)",
              color: "var(--text-primary)",
              borderRadius: 7, fontSize: 12, fontWeight: 500,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
              transition: "background var(--duration-fast) var(--ease-out), border-color var(--duration-fast) var(--ease-out)",
              letterSpacing: "-0.01em",
            } as React.CSSProperties}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)"; (e.currentTarget as HTMLElement).style.borderColor = "var(--border-strong)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "var(--bg-raised)"; (e.currentTarget as HTMLElement).style.borderColor = "var(--border-default)"; }}
          >
            <Plus size={11} strokeWidth={2.5} />
            Open PDF
          </button>
        )}

        {!collapsed && activeFile && (
          <button
            onClick={onOpenFile}
            title="Open PDF"
            style={{
              marginLeft: "auto", width: 26, height: 26, borderRadius: 6, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "var(--text-muted)",
              transition: "background var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out)",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)"; (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}
          >
            <Plus size={13} strokeWidth={2} />
          </button>
        )}
      </div>

      {/* Content */}
      {!collapsed && (
        <div style={{ flex: 1, overflowY: "auto", padding: "4px 8px 12px" }}>

          {/* Outline */}
          {activeFile ? (
            <>
              <div style={{
                padding: "4px 8px 8px",
                fontSize: 11, fontWeight: 600,
                color: "var(--text-dim)",
                letterSpacing: "-0.01em",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {activeFile.name.replace(/\.pdf$/i, "")}
              </div>

              {hasOutline ? (
                activeFile.outline.map((item, i) => (
                  <OutlineNode
                    key={i}
                    item={item}
                    depth={0}
                    pdfDoc={pdfDoc}
                    onPageJump={onPageJump}
                    currentPage={activeFile.currentPage}
                  />
                ))
              ) : (
                <div style={{ padding: "16px 8px", fontSize: 11, color: "var(--text-muted)", textAlign: "center", lineHeight: 1.6 }}>
                  No outline available
                </div>
              )}
            </>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "24px 16px", gap: 8 }}>
              <div style={{ width: 32, height: 32, background: "var(--bg-raised)", border: "1px solid var(--border-faint)", borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <FolderOpen size={14} color="var(--text-muted)" strokeWidth={1.5} />
              </div>
              <span style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", lineHeight: 1.5 }}>
                No file open
              </span>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
