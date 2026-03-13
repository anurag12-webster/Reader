import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  FileText, Plus, ArrowRight, X, Clock, FolderOpen, Folder as FolderIcon,
  Check, ChevronDown, ChevronRight, MoreHorizontal, Edit2, Trash2,
  CheckCircle, Circle, FolderPlus, ArrowUpRight,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { Folder, LibraryStore } from "../types";

// Module-level drag state — WebView2 on Windows doesn't support custom dataTransfer types
let _draggedPdfPath: string | null = null;

// ── Types ─────────────────────────────────────────────────────────────────────

interface RecentFile {
  path: string;
  name: string;
  openedAt: number;
}

interface OpenFile {
  id: string;
  name: string;
  path: string;
  totalPages?: number;
}

interface EmptyStateProps {
  onOpenFile: () => void;
  onOpenPath: (path: string, name: string) => void;
  openFiles?: OpenFile[];
  onResumeFile?: (id: string) => void;
  /** path → read page numbers, from library */
  readPages?: Record<string, number[]>;
  /** path → total pages, from open files */
  fileTotalPages?: Record<string, number>;
}

// ── Tauri helpers ─────────────────────────────────────────────────────────────

export async function addRecentFile(path: string, name: string) {
  await invoke("add_recent", { path, name }).catch(() => {});
}

async function getRecentFiles(): Promise<RecentFile[]> {
  return invoke<RecentFile[]>("get_recents").catch(() => []);
}

async function removeRecentFile(path: string) {
  await invoke("remove_recent", { path }).catch(() => {});
}

async function getLibrary(): Promise<LibraryStore> {
  return invoke<LibraryStore>("get_library").catch(() => ({ completedPaths: [], folders: [], readPages: {}, annotations: {} }));
}

async function saveLibrary(store: LibraryStore) {
  await invoke("save_library", { store }).catch(() => {});
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  const hrs  = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1)   return "Just now";
  if (mins < 60)  return `${mins}m ago`;
  if (hrs  < 24)  return `${hrs}h ago`;
  if (days === 1) return "Yesterday";
  if (days < 30)  return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function getAccentColor(str: string): string {
  const colors = [
    "#5B6AD0", "#7C5CBF", "#C2784A", "#4A9B7F",
    "#B05252", "#4A7AB0", "#8A6B3E", "#4D8A6B",
  ];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function getFolderColor(str: string): string {
  const colors = ["#5B6AD0", "#7C5CBF", "#C2784A", "#4A9B7F", "#4A7AB0", "#B05252"];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

// ── Thumbnail ─────────────────────────────────────────────────────────────────

const thumbCache = new Map<string, string>();
const thumbInFlight = new Map<string, Promise<string | null>>();

async function renderThumb(path: string, width: number): Promise<string | null> {
  const key = `${path}::${width}`;
  if (thumbCache.has(key)) return thumbCache.get(key)!;
  if (thumbInFlight.has(key)) return thumbInFlight.get(key)!;
  const promise = invoke<string>("get_thumbnail", { path, width })
    .then(url => { thumbCache.set(key, url); return url; })
    .catch(() => null)
    .finally(() => thumbInFlight.delete(key));
  thumbInFlight.set(key, promise);
  return promise;
}

function PdfThumbnail({ path, accent, width = 64, height = 84 }: { path: string; accent: string; width?: number; height?: number }) {
  const key = `${path}::${width}`;
  const [dataUrl, setDataUrl] = useState<string | null>(thumbCache.get(key) ?? null);

  useEffect(() => {
    if (dataUrl || !path) return;
    let cancelled = false;
    renderThumb(path, width).then(url => { if (!cancelled && url) setDataUrl(url); });
    return () => { cancelled = true; };
  }, [path, width]);

  return (
    <div style={{
      width, height, borderRadius: 5, flexShrink: 0,
      background: dataUrl ? "transparent" : accent + "14",
      border: `1px solid ${dataUrl ? "rgba(255,255,255,0.12)" : accent + "28"}`,
      overflow: "hidden", position: "relative",
      display: "flex", alignItems: "center", justifyContent: "center",
      boxShadow: dataUrl ? "0 2px 12px rgba(0,0,0,0.4)" : "none",
      transition: "box-shadow 0.2s ease",
    }}>
      {dataUrl ? (
        <img src={dataUrl} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top", display: "block" }} />
      ) : (
        <div style={{ width: "60%", height: "70%", display: "flex", flexDirection: "column", gap: 3, justifyContent: "center" }}>
          {[1, 0.6, 0.8, 0.5].map((w, i) => (
            <div key={i} style={{ height: 2, borderRadius: 1, background: accent + "40", width: `${w * 100}%` }} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Context Menu ──────────────────────────────────────────────────────────────

interface MenuItem {
  label?: string;
  icon?: React.ReactNode;
  danger?: boolean;
  separator?: boolean;
  onClick?: () => void;
}

function ContextMenu({ x, y, items, onClose }: {
  x: number; y: number; items: MenuItem[]; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Flip if too close to edge
  const menuWidth = 192;
  const menuHeight = items.length * 32 + 8;
  const finalX = x + menuWidth > window.innerWidth - 8 ? x - menuWidth : x;
  const finalY = y + menuHeight > window.innerHeight - 8 ? y - menuHeight : y;

  return createPortal(
    <div
      ref={ref}
      style={{
        position: "fixed", left: finalX, top: finalY,
        width: menuWidth, zIndex: 9999,
        background: "#1e1e1e",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 10,
        padding: "4px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.4)",
        animation: "ctxMenuIn 120ms var(--ease-out) both",
      }}
    >
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} style={{ height: 1, background: "rgba(255,255,255,0.07)", margin: "3px 4px" }} />
        ) : (
          <button
            key={i}
            onClick={() => { item.onClick?.(); onClose(); }}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 8,
              padding: "6px 10px",
              borderRadius: 6, border: "none", background: "transparent",
              color: item.danger ? "#f87171" : "var(--text-primary)",
              fontSize: 12, fontWeight: 450, letterSpacing: "-0.01em",
              cursor: "pointer", textAlign: "left",
              transition: "background 80ms, color 80ms",
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = item.danger ? "rgba(239,68,68,0.12)" : "var(--bg-active)";
              if (!item.danger) (e.currentTarget as HTMLElement).style.color = "var(--text-white)";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
              (e.currentTarget as HTMLElement).style.color = item.danger ? "#f87171" : "var(--text-primary)";
            }}
          >
            {item.icon && <span style={{ opacity: 0.7, display: "flex" }}>{item.icon}</span>}
            {item.label}
          </button>
        )
      )}
    </div>,
    document.body
  );
}

// ── Progress Ring ─────────────────────────────────────────────────────────────

function ProgressRing({ read, total, size = 28 }: { read: number; total: number; size?: number }) {
  if (!total) return null;
  const pct = Math.min(read / total, 1);
  const r = (size - 4) / 2;
  const circ = 2 * Math.PI * r;
  const dash = pct * circ;
  const color = pct >= 1 ? "#4A9B7F" : "#5B6AD0";
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={2} />
      <circle
        cx={size/2} cy={size/2} r={r} fill="none"
        stroke={color} strokeWidth={2}
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`}
        style={{ transition: "stroke-dasharray 0.4s var(--ease-out)" }}
      />
      <text x={size/2} y={size/2 + 3.5} textAnchor="middle"
        fill={color} fontSize={size < 30 ? 7 : 8} fontWeight={700}
        fontFamily="var(--font-sans)">
        {pct >= 1 ? "✓" : `${Math.round(pct * 100)}%`}
      </text>
    </svg>
  );
}

// ── Section Label ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 600, color: "var(--text-muted)",
      letterSpacing: "0.08em", textTransform: "uppercase",
      marginBottom: 8, paddingBottom: 8,
      borderBottom: "1px solid var(--border-faint)",
    }}>
      {children}
    </div>
  );
}

// ── Folder Card ───────────────────────────────────────────────────────────────

function FolderCard({
  folder, onOpen, onRename, onDelete, onDrop, isDragOver, setDragOver,
}: {
  folder: Folder;
  onOpen: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onDrop: (path: string) => void;
  isDragOver: boolean;
  setDragOver: (v: boolean) => void;
}) {
  const [hov, setHov] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState(folder.name);
  const [dropped, setDropped] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);
  const accent = getFolderColor(folder.id);
  const count = folder.filePaths.length;

  useEffect(() => { if (renaming) inputRef.current?.select(); }, [renaming]);

  function commitRename() {
    const v = renameVal.trim();
    if (v && v !== folder.name) onRename(v);
    else setRenameVal(folder.name);
    setRenaming(false);
  }

  function handleDragEnter(e: React.DragEvent) {
    if (!_draggedPdfPath) return;
    e.preventDefault(); e.stopPropagation();
    dragCounter.current += 1;
    if (dragCounter.current === 1) setDragOver(true);
  }

  function handleDragOver(e: React.DragEvent) {
    if (!_draggedPdfPath) return;
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault(); e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) setDragOver(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); e.stopPropagation();
    dragCounter.current = 0;
    setDragOver(false);
    const path = _draggedPdfPath ?? e.dataTransfer.getData("text/plain");
    _draggedPdfPath = null;
    if (path) {
      onDrop(path);
      setDropped(true);
      setTimeout(() => setDropped(false), 600);
    }
  }

  return (
    <>
      <div
        onClick={onOpen}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }); }}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{
          position: "relative",
          padding: "14px",
          background: isDragOver ? accent + "18" : hov ? "var(--bg-raised)" : "transparent",
          border: `1px solid ${isDragOver ? accent + "88" : dropped ? accent + "66" : hov ? "var(--border-default)" : "var(--border-faint)"}`,
          borderRadius: 10,
          cursor: "pointer",
          transition: "background var(--duration-fast) var(--ease-out), border-color var(--duration-fast) var(--ease-out), transform 120ms var(--ease-spring)",
          transform: isDragOver ? "scale(1.02)" : dropped ? "scale(0.98)" : "scale(1)",
          display: "flex", flexDirection: "column", gap: 10,
        }}
      >
        {/* Folder icon area */}
        <div style={{
          width: 48, height: 40,
          display: "flex", alignItems: "center", justifyContent: "center",
          position: "relative",
        }}>
          {isDragOver ? (
            <FolderOpen size={36} color={accent} strokeWidth={1.5} />
          ) : (
            <FolderIcon size={36} color={accent} strokeWidth={1.5} />
          )}
          {count > 0 && (
            <div style={{
              position: "absolute", bottom: -2, right: -2,
              width: 16, height: 16, borderRadius: "50%",
              background: accent, display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 9, fontWeight: 700, color: "#fff",
            }}>{count > 9 ? "9+" : count}</div>
          )}
        </div>

        {/* Name */}
        {renaming ? (
          <input
            ref={inputRef}
            value={renameVal}
            onClick={e => e.stopPropagation()}
            onChange={e => setRenameVal(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") { setRenameVal(folder.name); setRenaming(false); }
              e.stopPropagation();
            }}
            style={{
              background: "var(--bg-input)", border: "1px solid var(--border-default)",
              borderRadius: 4, color: "var(--text-white)", fontSize: 12, fontWeight: 500,
              padding: "2px 5px", width: "100%", outline: "none",
              fontFamily: "var(--font-sans)",
            }}
          />
        ) : (
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: 12, fontWeight: 500, color: "var(--text-white)",
              letterSpacing: "-0.02em", lineHeight: 1.4,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{folder.name}</div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
              {count === 0 ? "Empty" : `${count} paper${count !== 1 ? "s" : ""}`}
            </div>
          </div>
        )}

        {/* Drop hint */}
        {isDragOver && (
          <div style={{
            position: "absolute", inset: 0, borderRadius: 10,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: accent + "10", pointerEvents: "none",
          }}>
            <span style={{ fontSize: 11, color: accent, fontWeight: 600 }}>Drop here</span>
          </div>
        )}
      </div>

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x} y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={[
            { label: "Open folder", icon: <FolderOpen size={12} />, onClick: onOpen },
            { label: "Rename", icon: <Edit2 size={12} />, onClick: () => { setRenaming(true); setRenameVal(folder.name); } },
            { separator: true },
            { label: "Delete folder", icon: <Trash2 size={12} />, danger: true, onClick: onDelete },
          ]}
        />
      )}
    </>
  );
}

// ── PDF Grid Card ─────────────────────────────────────────────────────────────

function PdfCard({
  file, index, isCompleted, folders, readPages, totalPages, onOpen, onToggleCompleted, onRemove, onMoveToFolder, onRemoveFromFolder,
  inFolder = false,
}: {
  file: RecentFile;
  index: number;
  isCompleted: boolean;
  folders: Folder[];
  readPages: number[];
  totalPages: number;
  onOpen: () => void;
  onToggleCompleted: () => void;
  onRemove: () => void;
  onMoveToFolder: (folderId: string) => void;
  onRemoveFromFolder?: () => void;
  inFolder?: boolean;
}) {
  const [hov, setHov] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const accent = getAccentColor(file.name);

  const menuItems: MenuItem[] = [
    { label: "Open", icon: <ArrowUpRight size={12} />, onClick: onOpen },
    { separator: true },
    {
      label: isCompleted ? "Unmark as completed" : "Mark as completed",
      icon: isCompleted ? <Circle size={12} /> : <CheckCircle size={12} />,
      onClick: onToggleCompleted,
    },
    ...(inFolder && onRemoveFromFolder
      ? [{ separator: true } as MenuItem, { label: "Remove from folder", icon: <FolderIcon size={12} />, onClick: onRemoveFromFolder }]
      : folders.length > 0
        ? [{
            separator: true,
          } as MenuItem, ...folders.map(f => ({
            label: `Move to "${f.name}"`,
            icon: <FolderIcon size={12} />,
            onClick: () => onMoveToFolder(f.id),
          }))]
        : []
    ),
    { separator: true },
    { label: "Remove from library", icon: <Trash2 size={12} />, danger: true, onClick: onRemove },
  ];

  return (
    <>
      <div
        onClick={onOpen}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }); }}
        draggable
        onDragStart={e => {
          _draggedPdfPath = file.path;
          e.dataTransfer.setData("text/plain", file.path);
          e.dataTransfer.effectAllowed = "move";
          setDragging(true);
        }}
        onDragEnd={() => { _draggedPdfPath = null; setDragging(false); }}
        style={{
          position: "relative",
          padding: "16px",
          background: hov ? "var(--bg-raised)" : "transparent",
          border: `1px solid ${hov ? "var(--border-default)" : "var(--border-faint)"}`,
          borderRadius: 10, cursor: "pointer",
          transition: "background var(--duration-fast) var(--ease-out), border-color var(--duration-fast) var(--ease-out), opacity 150ms, transform 150ms",
          display: "flex", flexDirection: "column", gap: 12,
          opacity: dragging ? 0.4 : isCompleted ? 0.55 : 1,
          transform: dragging ? "scale(0.97)" : "scale(1)",
          animation: `rowEnter var(--duration-base) var(--ease-out) ${index * 20}ms both`,
        }}
      >
        {/* Context menu button */}
        <button
          onClick={e => { e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY }); }}
          style={{
            position: "absolute", top: 8, right: 8,
            width: 22, height: 22, borderRadius: 5,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "var(--text-muted)",
            opacity: hov ? 1 : 0,
            transition: "opacity var(--duration-fast), background var(--duration-fast), color var(--duration-fast)",
            background: "transparent",
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.background = "var(--bg-active)";
            (e.currentTarget as HTMLElement).style.color = "var(--text-white)";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.background = "transparent";
            (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
          }}
        >
          <MoreHorizontal size={11} strokeWidth={2} />
        </button>

        {/* Completed badge */}
        {isCompleted && (
          <div style={{
            position: "absolute", top: 8, left: 8,
            display: "flex", alignItems: "center", gap: 3,
            padding: "2px 6px", borderRadius: 4,
            background: "rgba(74,155,127,0.15)",
            border: "1px solid rgba(74,155,127,0.3)",
          }}>
            <Check size={8} strokeWidth={2.5} color="#4A9B7F" />
            <span style={{ fontSize: 9, fontWeight: 600, color: "#4A9B7F", letterSpacing: "0.04em" }}>DONE</span>
          </div>
        )}

        <PdfThumbnail path={file.path} accent={accent} />

        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: 12, fontWeight: 500,
            color: isCompleted ? "var(--text-dim)" : "var(--text-white)",
            letterSpacing: "-0.02em", lineHeight: 1.4, marginBottom: 4,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            textDecoration: isCompleted ? "line-through" : "none",
          } as React.CSSProperties}>
            {file.name.replace(/\.pdf$/i, "")}
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--text-muted)" }}>
              <Clock size={9} strokeWidth={2} />
              {timeAgo(file.openedAt)}
            </div>
            {totalPages > 0 && readPages.length > 0 && !isCompleted && (
              <ProgressRing read={readPages.length} total={totalPages} size={26} />
            )}
          </div>
        </div>
      </div>

      {ctxMenu && (
        <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={menuItems} onClose={() => setCtxMenu(null)} />
      )}
    </>
  );
}

// ── Folder View (expanded) ────────────────────────────────────────────────────

function FolderView({
  folder, recents, library, onBack, onOpen, onToggleCompleted, onRemove, onRemoveFromFolder, folders, allReadPages, fileTotalPages,
}: {
  folder: Folder;
  recents: RecentFile[];
  library: LibraryStore;
  onBack: () => void;
  onOpen: (path: string, name: string) => void;
  onToggleCompleted: (path: string) => void;
  onRemove: (path: string) => void;
  onRemoveFromFolder: (path: string) => void;
  folders: Folder[];
  allReadPages: Record<string, number[]>;
  fileTotalPages: Record<string, number>;
}) {
  const completedSet = new Set(library.completedPaths);
  const files = folder.filePaths
    .map(p => recents.find(r => r.path === p))
    .filter(Boolean) as RecentFile[];
  const accent = getFolderColor(folder.id);

  return (
    <div style={{ animation: "pageEnter 200ms var(--ease-out) both" }}>
      {/* Breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 24 }}>
        <button
          onClick={onBack}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            fontSize: 12, fontWeight: 500, color: "var(--text-dim)",
            background: "transparent", border: "none", cursor: "pointer", padding: "4px 0",
            transition: "color var(--duration-fast)",
          }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--text-white)"}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--text-dim)"}
        >
          <ChevronRight size={12} strokeWidth={2} style={{ transform: "rotate(180deg)" }} />
          Library
        </button>
        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>/</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <FolderOpen size={14} color={accent} strokeWidth={1.8} />
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-white)" }}>{folder.name}</span>
        </div>
      </div>

      {files.length === 0 ? (
        <div style={{ padding: "40px 0", textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
          Drag PDFs here to add them to this folder.
        </div>
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
          gap: 8,
        }}>
          {files.map((file, i) => (
            <PdfCard
              key={file.path}
              file={file}
              index={i}
              isCompleted={completedSet.has(file.path)}
              folders={folders.filter(f => f.id !== folder.id)}
              readPages={allReadPages[file.path] ?? []}
              totalPages={fileTotalPages[file.path] ?? 0}
              onOpen={() => onOpen(file.path, file.name)}
              onToggleCompleted={() => onToggleCompleted(file.path)}
              onRemove={() => onRemove(file.path)}
              onMoveToFolder={() => {}}
              onRemoveFromFolder={() => onRemoveFromFolder(file.path)}
              inFolder
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Completed Section ─────────────────────────────────────────────────────────

function CompletedSection({
  recents, completedPaths, onOpen, onToggleCompleted, onRemove,
}: {
  recents: RecentFile[];
  completedPaths: string[];
  onOpen: (path: string, name: string) => void;
  onToggleCompleted: (path: string) => void;
  onRemove: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [hovRow, setHovRow] = useState<string | null>(null);
  const completedFiles = completedPaths
    .map(p => recents.find(r => r.path === p))
    .filter(Boolean) as RecentFile[];

  if (completedFiles.length === 0) return null;

  return (
    <div style={{ marginTop: 40, animation: "pageEnter var(--duration-slow) var(--ease-out) 120ms both" }}>
      <button
        onClick={() => setExpanded(v => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 8, width: "100%",
          fontSize: 11, fontWeight: 600, color: "var(--text-muted)",
          letterSpacing: "0.08em", textTransform: "uppercase",
          background: "transparent", border: "none", borderBottom: "1px solid var(--border-faint)",
          paddingBottom: 8, marginBottom: expanded ? 12 : 0,
          cursor: "pointer", transition: "color var(--duration-fast)",
        }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--text-dim)"}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"}
      >
        <Check size={11} strokeWidth={2.5} />
        Completed
        <span style={{
          padding: "1px 5px", borderRadius: 4,
          background: "var(--bg-active)", fontSize: 10, fontWeight: 600,
          color: "var(--text-muted)", letterSpacing: 0,
        }}>{completedFiles.length}</span>
        <ChevronDown
          size={11} strokeWidth={2}
          style={{ marginLeft: "auto", transform: expanded ? "rotate(0)" : "rotate(-90deg)", transition: "transform 200ms var(--ease-out)" }}
        />
      </button>

      {expanded && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {completedFiles.map(file => {
            const isHov = hovRow === file.path;
            const accent = getAccentColor(file.name);
            return (
              <div
                key={file.path}
                onClick={() => onOpen(file.path, file.name)}
                onMouseEnter={() => setHovRow(file.path)}
                onMouseLeave={() => setHovRow(null)}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 10px", borderRadius: 7,
                  background: isHov ? "var(--bg-raised)" : "transparent",
                  cursor: "pointer",
                  transition: "background var(--duration-fast)",
                }}
              >
                <Check size={12} strokeWidth={2.5} color="#4A9B7F" style={{ flexShrink: 0 }} />
                <div style={{ width: 20, height: 26, borderRadius: 3, flexShrink: 0, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <PdfThumbnail path={file.path} accent={accent} width={20} height={26} />
                </div>
                <span style={{
                  flex: 1, fontSize: 12, fontWeight: 450, color: "var(--text-muted)",
                  textDecoration: "line-through", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  letterSpacing: "-0.01em",
                }}>
                  {file.name.replace(/\.pdf$/i, "")}
                </span>
                <div style={{ display: "flex", gap: 4, opacity: isHov ? 1 : 0, transition: "opacity var(--duration-fast)" }}>
                  <button
                    onClick={e => { e.stopPropagation(); onToggleCompleted(file.path); }}
                    title="Unmark"
                    style={{ padding: "3px 6px", borderRadius: 4, background: "var(--bg-active)", border: "1px solid var(--border-faint)", color: "var(--text-dim)", fontSize: 10, cursor: "pointer" }}
                  >
                    Unmark
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); onRemove(file.path); }}
                    title="Remove"
                    style={{ width: 22, height: 22, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#f87171"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}
                  >
                    <X size={10} strokeWidth={2.5} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main EmptyState ───────────────────────────────────────────────────────────

export default function EmptyState({ onOpenFile, onOpenPath, openFiles = [], onResumeFile, readPages: extReadPages, fileTotalPages = {} }: EmptyStateProps) {
  const [recents, setRecents] = useState<RecentFile[]>([]);
  const [library, setLibrary] = useState<LibraryStore>({ completedPaths: [], folders: [], readPages: {}, annotations: {} });
  const [draggingFile, setDraggingFile] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);

  useEffect(() => {
    getRecentFiles().then(setRecents);
    getLibrary().then(setLibrary);
  }, []);

  const updateLibrary = useCallback((updated: LibraryStore) => {
    setLibrary(updated);
    saveLibrary(updated);
  }, []);

  // Merge external readPages (from App, already persisted) with library.readPages
  const allReadPages: Record<string, number[]> = { ...(library.readPages ?? {}), ...(extReadPages ?? {}) };

  // ── Library mutations ──

  function toggleCompleted(path: string) {
    const isCompleted = library.completedPaths.includes(path);
    updateLibrary({
      ...library,
      completedPaths: isCompleted
        ? library.completedPaths.filter(p => p !== path)
        : [...library.completedPaths, path],
    });
  }

  async function removeRecent(path: string) {
    await removeRecentFile(path);
    const updated = await getRecentFiles();
    setRecents(updated);
    // Also clean from library
    updateLibrary({
      ...library,
      completedPaths: library.completedPaths.filter(p => p !== path),
      folders: library.folders.map(f => ({ ...f, filePaths: f.filePaths.filter(fp => fp !== path) })),
    });
  }

  function createFolder() {
    const id = crypto.randomUUID();
    const now = Date.now();
    const newFolder: Folder = { id, name: "New Folder", createdAt: now, filePaths: [] };
    updateLibrary({ ...library, folders: [...library.folders, newFolder] });
    return id;
  }

  function renameFolder(id: string, name: string) {
    updateLibrary({
      ...library,
      folders: library.folders.map(f => f.id === id ? { ...f, name } : f),
    });
  }

  function deleteFolder(id: string) {
    updateLibrary({ ...library, folders: library.folders.filter(f => f.id !== id) });
    if (openFolderId === id) setOpenFolderId(null);
  }

  function moveToFolder(path: string, folderId: string) {
    updateLibrary({
      ...library,
      folders: library.folders.map(f => {
        if (f.id === folderId) {
          return f.filePaths.includes(path) ? f : { ...f, filePaths: [...f.filePaths, path] };
        }
        return f;
      }),
    });
  }

  function removeFromFolder(path: string, folderId: string) {
    updateLibrary({
      ...library,
      folders: library.folders.map(f =>
        f.id === folderId ? { ...f, filePaths: f.filePaths.filter(p => p !== path) } : f
      ),
    });
  }

  // ── Drag-over the whole page (for dropping PDF files to open) ──
  function onDragOver(e: React.DragEvent) {
    if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDraggingFile(true); }
  }
  function onDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDraggingFile(false);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDraggingFile(false);
    const file = e.dataTransfer.files[0];
    if (file?.name.toLowerCase().endsWith(".pdf")) onOpenFile();
  }

  const completedSet = new Set(library.completedPaths);
  const hasRecents = recents.length > 0;
  const hasContent = hasRecents || openFiles.length > 0 || library.folders.length > 0;

  // Non-completed recents not in any folder that's the "main" grid items
  const activeRecents = recents.filter(r => !completedSet.has(r.path));

  const openFolder = library.folders.find(f => f.id === openFolderId) ?? null;

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{ flex: 1, display: "flex", flexDirection: "column", background: "var(--bg-app)", overflow: "hidden", position: "relative" }}
    >
      {/* File drop ring */}
      {draggingFile && (
        <div style={{
          position: "absolute", inset: 6, zIndex: 50,
          border: "1.5px dashed rgba(255,255,255,0.25)", borderRadius: 14, pointerEvents: "none",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <span style={{ fontSize: 13, color: "var(--text-dim)", fontWeight: 500, letterSpacing: "-0.01em" }}>
            Drop PDF to open
          </span>
        </div>
      )}

      {hasContent ? (
        <div style={{
          flex: 1, overflowY: "auto", position: "relative", zIndex: 1,
          padding: "40px 48px 56px",
          display: "flex", flexDirection: "column", gap: 0,
        }}>

          {/* Header */}
          <div style={{
            display: "flex", alignItems: "flex-end", justifyContent: "space-between",
            marginBottom: 40,
            animation: "pageEnter var(--duration-slow) var(--ease-out) both",
          }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>
                Library
              </div>
              <h1 style={{ fontSize: 30, fontWeight: 700, color: "var(--text-white)", letterSpacing: "-0.04em", lineHeight: 1, margin: 0, fontFamily: "var(--font-sans)" }}>
                {openFolder ? openFolder.name : openFiles.length > 0 ? "Continue reading" : "Recent"}
              </h1>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              {!openFolder && (
                <button
                  onClick={createFolder}
                  title="New folder"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "8px 14px",
                    background: "var(--bg-raised)", border: "1px solid var(--border-faint)",
                    color: "var(--text-dim)", borderRadius: 8,
                    fontSize: 12, fontWeight: 500, letterSpacing: "-0.01em",
                    transition: "all var(--duration-fast) var(--ease-out)", cursor: "pointer",
                  }}
                  onMouseEnter={e => {
                    const el = e.currentTarget as HTMLElement;
                    el.style.background = "var(--bg-hover)"; el.style.borderColor = "var(--border-default)"; el.style.color = "var(--text-primary)";
                  }}
                  onMouseLeave={e => {
                    const el = e.currentTarget as HTMLElement;
                    el.style.background = "var(--bg-raised)"; el.style.borderColor = "var(--border-faint)"; el.style.color = "var(--text-dim)";
                  }}
                >
                  <FolderPlus size={12} strokeWidth={2} />
                  New Folder
                </button>
              )}
              <button
                onClick={onOpenFile}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "8px 16px",
                  background: "var(--bg-raised)", border: "1px solid var(--border-default)",
                  color: "var(--text-primary)", borderRadius: 8,
                  fontSize: 12, fontWeight: 500, letterSpacing: "-0.01em",
                  transition: "all var(--duration-fast) var(--ease-out)", cursor: "pointer",
                }}
                onMouseEnter={e => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.background = "var(--bg-hover)"; el.style.borderColor = "var(--border-strong)"; el.style.color = "var(--text-white)";
                }}
                onMouseLeave={e => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.background = "var(--bg-raised)"; el.style.borderColor = "var(--border-default)"; el.style.color = "var(--text-primary)";
                }}
              >
                <Plus size={12} strokeWidth={2.2} />
                Open PDF
              </button>
            </div>
          </div>

          {/* Folder view */}
          {openFolder ? (
            <FolderView
              folder={openFolder}
              recents={recents}
              library={library}
              folders={library.folders}
              allReadPages={allReadPages}
              fileTotalPages={fileTotalPages}
              onBack={() => setOpenFolderId(null)}
              onOpen={onOpenPath}
              onToggleCompleted={toggleCompleted}
              onRemove={removeRecent}
              onRemoveFromFolder={path => removeFromFolder(path, openFolder.id)}
            />
          ) : (
            <>
              {/* Open now */}
              {openFiles.length > 0 && (
                <div style={{ marginBottom: 40, animation: "pageEnter var(--duration-slow) var(--ease-out) 40ms both" }}>
                  <SectionLabel>Open now</SectionLabel>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 4 }}>
                    {openFiles.slice(0, 2).map(f => {
                      const accent = getAccentColor(f.name);
                      const isHov = hoveredId === f.id;
                      return (
                        <div
                          key={f.id}
                          onClick={() => onResumeFile?.(f.id)}
                          onMouseEnter={() => setHoveredId(f.id)}
                          onMouseLeave={() => setHoveredId(null)}
                          style={{
                            display: "flex", alignItems: "center", gap: 12,
                            padding: "10px 14px", borderRadius: 8,
                            background: isHov ? "var(--bg-hover)" : "var(--bg-raised)",
                            border: `1px solid ${isHov ? "var(--border-default)" : "var(--border-faint)"}`,
                            cursor: "pointer",
                            transition: "background var(--duration-fast) var(--ease-out), border-color var(--duration-fast) var(--ease-out)",
                          }}
                        >
                          <div style={{
                            width: 30, height: 38, borderRadius: 4, flexShrink: 0,
                            background: accent + "22", border: `1px solid ${accent}40`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}>
                            <span style={{ fontSize: 9, fontWeight: 700, color: accent, letterSpacing: "0.03em" }}>
                              {f.name.replace(/\.pdf$/i, "").slice(0, 2).toUpperCase()}
                            </span>
                          </div>
                          <span style={{
                            flex: 1, fontSize: 13, fontWeight: 500, color: "var(--text-white)",
                            letterSpacing: "-0.02em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>
                            {f.name.replace(/\.pdf$/i, "")}
                          </span>
                          {f.totalPages && f.totalPages > 0 && (allReadPages[f.path]?.length ?? 0) > 0 && (
                            <ProgressRing
                              read={allReadPages[f.path]?.length ?? 0}
                              total={f.totalPages}
                              size={30}
                            />
                          )}
                          <div style={{
                            display: "inline-flex", alignItems: "center", gap: 5,
                            padding: "5px 10px", borderRadius: 6,
                            background: isHov ? "var(--bg-active)" : "transparent",
                            border: `1px solid ${isHov ? "var(--border-soft)" : "transparent"}`,
                            fontSize: 12, fontWeight: 500, flexShrink: 0,
                            color: isHov ? "var(--text-white)" : "var(--text-dim)",
                            transition: "all var(--duration-fast) var(--ease-out)",
                          }}>
                            Resume <ArrowRight size={11} strokeWidth={2} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Folders + Recent grid combined */}
              {(library.folders.length > 0 || activeRecents.length > 0) && (
                <div style={{ animation: "pageEnter var(--duration-slow) var(--ease-out) 80ms both" }}>
                  {openFiles.length > 0 && <SectionLabel>Library</SectionLabel>}
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
                    gap: 8, marginTop: 4,
                  }}>
                    {/* Folder cards first */}
                    {library.folders.map(folder => (
                      <FolderCard
                        key={folder.id}
                        folder={folder}
                        onOpen={() => setOpenFolderId(folder.id)}
                        onRename={name => renameFolder(folder.id, name)}
                        onDelete={() => deleteFolder(folder.id)}
                        onDrop={path => moveToFolder(path, folder.id)}
                        isDragOver={dragOverFolderId === folder.id}
                        setDragOver={v => setDragOverFolderId(v ? folder.id : null)}
                      />
                    ))}

                    {/* PDF cards */}
                    {activeRecents.map((file, i) => (
                      <PdfCard
                        key={file.path}
                        file={file}
                        index={i}
                        isCompleted={false}
                        folders={library.folders}
                        readPages={allReadPages[file.path] ?? []}
                        totalPages={fileTotalPages[file.path] ?? 0}
                        onOpen={() => onOpenPath(file.path, file.name)}
                        onToggleCompleted={() => toggleCompleted(file.path)}
                        onRemove={() => removeRecent(file.path)}
                        onMoveToFolder={folderId => moveToFolder(file.path, folderId)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Completed section */}
              <CompletedSection
                recents={recents}
                completedPaths={library.completedPaths}
                onOpen={onOpenPath}
                onToggleCompleted={toggleCompleted}
                onRemove={removeRecent}
              />
            </>
          )}
        </div>
      ) : (
        /* Empty / first run */
        <div style={{
          flex: 1, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          animation: "pageEnter var(--duration-slow) var(--ease-out) both",
        }}>
          <div style={{ textAlign: "center", maxWidth: 300 }}>
            <div style={{
              width: 52, height: 52, borderRadius: 14,
              background: "var(--bg-raised)", border: "1px solid var(--border-default)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 24px",
            }}>
              <FileText size={22} strokeWidth={1.5} color="var(--text-dim)" />
            </div>
            <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--text-white)", letterSpacing: "-0.04em", lineHeight: 1.15, marginBottom: 10 }}>
              Open a PDF<br />to start reading.
            </h1>
            <p style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.65, letterSpacing: "-0.01em", marginBottom: 28 }}>
              Themes, annotations, outline<br />navigation, and text selection.
            </p>
            <button
              onClick={onOpenFile}
              style={{
                display: "inline-flex", alignItems: "center", gap: 7,
                padding: "10px 20px",
                background: "var(--bg-raised)", border: "1px solid var(--border-default)",
                color: "var(--text-primary)", borderRadius: 9, fontSize: 13, fontWeight: 500,
                letterSpacing: "-0.01em", transition: "all var(--duration-fast) var(--ease-out)", cursor: "pointer",
              }}
              onMouseEnter={e => {
                const el = e.currentTarget as HTMLElement;
                el.style.background = "var(--bg-hover)"; el.style.borderColor = "var(--border-strong)"; el.style.color = "var(--text-white)";
              }}
              onMouseLeave={e => {
                const el = e.currentTarget as HTMLElement;
                el.style.background = "var(--bg-raised)"; el.style.borderColor = "var(--border-default)"; el.style.color = "var(--text-primary)";
              }}
            >
              <Plus size={13} strokeWidth={2.2} />
              Open PDF
            </button>
            <div style={{ marginTop: 18, fontSize: 11, color: "var(--text-muted)", letterSpacing: "-0.01em" }}>
              or drag & drop a file anywhere
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
