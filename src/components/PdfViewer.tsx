import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";
import "pdfjs-dist/web/pdf_viewer.css";
import { PdfTheme, Annotation, OutlineItem } from "../types";
import { AnnotationTool } from "./Toolbar";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

// CSS filter applied to the canvas — instant, no re-render
const THEME_FILTER: Record<PdfTheme, string> = {
  classic: "none",
  dark:    "invert(1) hue-rotate(180deg)",
  // Warm: Claude-style dark charcoal — invert then push warm brown-gray tones
  warm:    "invert(1) hue-rotate(180deg) sepia(25%) saturate(0.85) brightness(0.82)",
  // Blue: dark navy — invert then hue-shift toward blue
  blue:    "invert(1) hue-rotate(190deg) saturate(1.1) brightness(0.78)",
};

// Smooth CSS transition on filter change
const FILTER_TRANSITION = "filter 0.22s cubic-bezier(0.16,1,0.3,1)";

interface DrawRect { startX: number; startY: number; endX: number; endY: number; }

interface PdfViewerProps {
  filePath: string;
  currentPage: number;
  zoom: number;
  theme: PdfTheme;
  activeTool: AnnotationTool;
  pageLayout: "single" | "double";
  rotation: number;
  annotations: Annotation[];
  onTotalPages: (n: number) => void;
  onAddAnnotation: (a: Annotation) => void;
  onDeleteAnnotation: (id: string) => void;
  onZoomChange: (zoom: number) => void;
  onOutlineLoad: (outline: OutlineItem[]) => void;
}

export default function PdfViewer({
  filePath, currentPage, zoom, theme, activeTool, pageLayout, rotation,
  annotations, onTotalPages, onAddAnnotation, onDeleteAnnotation, onZoomChange, onOutlineLoad,
}: PdfViewerProps) {
  const canvasRef     = useRef<HTMLCanvasElement>(null);
  const overlayRef    = useRef<HTMLCanvasElement>(null);
  const textLayerRef  = useRef<HTMLDivElement>(null);
  const canvas2Ref    = useRef<HTMLCanvasElement>(null);
  const overlay2Ref   = useRef<HTMLCanvasElement>(null);
  const containerRef  = useRef<HTMLDivElement>(null);
  const pdfRef        = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  const zoomRef       = useRef(zoom);
  const prevPageRef   = useRef(currentPage);
  const zoomAnchorRef = useRef<{ cursorX: number; cursorY: number; scrollX: number; scrollY: number; fromZoom: number } | null>(null);
  const pageWrapRef   = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded]       = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const drawRectRef   = useRef<DrawRect | null>(null);
  const [notePrompt, setNotePrompt] = useState<{ x: number; y: number; pageX: number; pageY: number } | null>(null);
  const [noteText, setNoteText]   = useState("");
  const [hoveredNote, setHoveredNote] = useState<{ x: number; y: number; text: string } | null>(null);

  // Keep zoomRef in sync for wheel handler
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  // After zoom re-render, correct scroll so the cursor point stays fixed
  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    const el = containerRef.current;
    if (!anchor || !el) return;
    zoomAnchorRef.current = null;
    const ratio = zoom / anchor.fromZoom;
    // Point under cursor in content space: anchor.scrollX + anchor.cursorX
    // After scale, that content point is now at: (anchor.scrollX + anchor.cursorX) * ratio
    // We want that point to still appear at anchor.cursorX from the left edge
    el.scrollLeft = (anchor.scrollX + anchor.cursorX) * ratio - anchor.cursorX;
    el.scrollTop  = (anchor.scrollY + anchor.cursorY) * ratio - anchor.cursorY;
  }, [zoom]);

  // Imperatively trigger slide animation — no remount, no flash
  useEffect(() => {
    if (prevPageRef.current === currentPage) return;
    const dir = currentPage > prevPageRef.current ? "slideInRight" : "slideInLeft";
    prevPageRef.current = currentPage;
    const el = pageWrapRef.current;
    if (!el) return;
    el.style.animation = "none";
    // Force reflow so the browser registers the reset before applying the new animation
    void el.offsetWidth;
    el.style.animation = `${dir} 0.3s cubic-bezier(0.16,1,0.3,1) both`;
  }, [currentPage]);

  // Apply theme filter instantly whenever it changes — no re-render
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) { canvas.style.transition = FILTER_TRANSITION; canvas.style.filter = THEME_FILTER[theme]; }
    const canvas2 = canvas2Ref.current;
    if (canvas2) { canvas2.style.transition = FILTER_TRANSITION; canvas2.style.filter = THEME_FILTER[theme]; }
  }, [theme]);

  // Ctrl+scroll = zoom-to-cursor, Shift+scroll = horizontal scroll
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const c = el; // capture non-null for closure
    function onWheel(e: WheelEvent) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        const next = Math.min(4, Math.max(0.25, zoomRef.current + delta));
        const rect = c.getBoundingClientRect();
        zoomAnchorRef.current = {
          cursorX: e.clientX - rect.left,
          cursorY: e.clientY - rect.top,
          scrollX: c.scrollLeft,
          scrollY: c.scrollTop,
          fromZoom: zoomRef.current,
        };
        onZoomChange(next);
      } else if (e.shiftKey) {
        e.preventDefault();
        // Use deltaX if already horizontal (trackpad), else deltaY (mouse wheel + shift)
        c.scrollLeft += e.deltaX !== 0 ? e.deltaX : e.deltaY;
      }
    }
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, [onZoomChange]);

  // Load PDF
  useEffect(() => {
    setLoaded(false);
    pdfRef.current = null;
    let cancelled = false;
    pdfjsLib.getDocument({ url: filePath }).promise
      .then(async pdf => {
        if (cancelled) return;
        pdfRef.current = pdf;
        onTotalPages(pdf.numPages);
        setLoaded(true);
        try {
          const raw = await pdf.getOutline();
          if (!cancelled && raw) onOutlineLoad(raw as OutlineItem[]);
        } catch { /* no outline */ }
      })
      .catch(e => console.error("PDF load error:", e));
    return () => { cancelled = true; };
  }, [filePath]);

  const drawAnnotations = useCallback((overlay: HTMLCanvasElement, page: number) => {
    const ctx = overlay.getContext("2d")!;
    const z = zoomRef.current;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    annotations.filter(a => a.page === page).forEach(a => {
      // Stored coords are in zoom=1 page-space; scale to current canvas pixels
      const ax = a.x * z, ay = a.y * z, aw = a.width * z, ah = a.height * z;
      if (a.type === "highlight") {
        ctx.fillStyle = a.color; ctx.globalAlpha = 0.35;
        ctx.fillRect(ax, ay, aw, ah); ctx.globalAlpha = 1;
      } else if (a.type === "underline") {
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = a.color;
        ctx.fillRect(ax, ay, aw, ah);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = a.color;
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(ax, ay + ah);
        ctx.lineTo(ax + aw, ay + ah);
        ctx.stroke();
      } else if (a.type === "note") {
        const s = 20;
        const x = ax, y = ay;
        ctx.shadowColor = "rgba(0,0,0,0.35)";
        ctx.shadowBlur = 6;
        ctx.shadowOffsetY = 2;
        ctx.fillStyle = "#f5c842";
        ctx.beginPath();
        ctx.roundRect(x, y, s, s, 4);
        ctx.fill();
        ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
        ctx.strokeStyle = "rgba(0,0,0,0.4)"; ctx.lineWidth = 1.5; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(x + 4, y + 7); ctx.lineTo(x + s - 4, y + 7); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + 4, y + 11); ctx.lineTo(x + s - 4, y + 11); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + 4, y + 15); ctx.lineTo(x + s - 8, y + 15); ctx.stroke();
        ctx.strokeStyle = "rgba(0,0,0,0.2)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.roundRect(x, y, s, s, 4); ctx.stroke();
      }
    });
  }, [annotations]);

  // Render page(s) — theme and rotation handled here, theme also via filter effect
  useEffect(() => {
    if (!loaded) return;
    const pdf = pdfRef.current;
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!pdf || !canvas || !overlay) return;

    if (renderTaskRef.current) { renderTaskRef.current.cancel(); renderTaskRef.current = null; }

    let cancelled = false;
    (async () => {
      try {
        // Render primary page
        const page     = await pdf.getPage(currentPage);
        if (cancelled) return;
        const viewport = page.getViewport({ scale: zoom, rotation });
        const ctx      = canvas.getContext("2d")!;

        canvas.width  = viewport.width;
        canvas.height = viewport.height;
        canvas.style.filter = THEME_FILTER[theme];

        overlay.width  = viewport.width;
        overlay.height = viewport.height;

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, viewport.width, viewport.height);

        const task = page.render({ canvasContext: ctx, viewport, canvas });
        renderTaskRef.current = task;
        await task.promise;
        if (cancelled) return;
        drawAnnotations(overlay, currentPage);

        // Text layer for native text selection
        const textDiv = textLayerRef.current;
        if (textDiv) {
          textDiv.innerHTML = "";
          // pdf.js TextLayer uses CSS var --total-scale-factor for span sizing
          const dpr = window.devicePixelRatio || 1;
          textDiv.style.setProperty("--total-scale-factor", String(zoom * dpr));
          textDiv.style.width  = viewport.width  + "px";
          textDiv.style.height = viewport.height + "px";
          const textLayer = new pdfjsLib.TextLayer({
            textContentSource: page.streamTextContent(),
            container: textDiv,
            viewport,
          });
          await textLayer.render();
        }

        // Render second page if double layout and page exists
        const canvas2 = canvas2Ref.current;
        const overlay2 = overlay2Ref.current;
        const nextPage = currentPage + 1;
        if (pageLayout === "double" && canvas2 && overlay2 && nextPage <= pdf.numPages) {
          const page2    = await pdf.getPage(nextPage);
          if (cancelled) return;
          const vp2      = page2.getViewport({ scale: zoom, rotation });
          const ctx2     = canvas2.getContext("2d")!;
          canvas2.width  = vp2.width;
          canvas2.height = vp2.height;
          canvas2.style.filter = THEME_FILTER[theme];
          overlay2.width  = vp2.width;
          overlay2.height = vp2.height;
          ctx2.fillStyle = "#ffffff";
          ctx2.fillRect(0, 0, vp2.width, vp2.height);
          await page2.render({ canvasContext: ctx2, viewport: vp2, canvas: canvas2 }).promise;
          if (cancelled) return;
          drawAnnotations(overlay2, nextPage);
        } else if (canvas2 && overlay2) {
          // Clear second canvas when not used
          canvas2.width = 0; canvas2.height = 0;
          overlay2.width = 0; overlay2.height = 0;
        }
      } catch (e: unknown) {
        if ((e as { name?: string }).name !== "RenderingCancelledException")
          console.error("Render error:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [loaded, currentPage, zoom, rotation, pageLayout, drawAnnotations]); // theme intentionally excluded

  function getCanvasPos(e: React.MouseEvent) {
    const canvas = canvasRef.current!;
    const rect   = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top)  * (canvas.height / rect.height),
    };
  }

  function onMouseDown(e: React.MouseEvent) {
    if (activeTool === "select") return;
    if (activeTool === "note") {
      const pos = getCanvasPos(e);
      const z = zoomRef.current;
      // Don't create a new note if clicking on an existing note icon
      const onExisting = annotations.some(a => a.page === currentPage && a.type === "note"
        && pos.x >= a.x * z && pos.x <= a.x * z + 22 && pos.y >= a.y * z && pos.y <= a.y * z + 22);
      if (onExisting) return;
      const rect = canvasRef.current!.getBoundingClientRect();
      setNotePrompt({ x: e.clientX - rect.left + 12, y: e.clientY - rect.top + 12, pageX: pos.x, pageY: pos.y });
      return;
    }
    setIsDrawing(true);
    const pos = getCanvasPos(e);
    drawRectRef.current = { startX: pos.x, startY: pos.y, endX: pos.x, endY: pos.y };
  }

  function onMouseMove(e: React.MouseEvent) {
    // While drawing: update live preview
    if (isDrawing && drawRectRef.current) {
      const pos = getCanvasPos(e);
      drawRectRef.current.endX = pos.x;
      drawRectRef.current.endY = pos.y;
      const overlay = overlayRef.current!;
      const ctx = overlay.getContext("2d")!;
      drawAnnotations(overlay, currentPage);
      const r = drawRectRef.current;
      const x = Math.min(r.startX, r.endX), y = Math.min(r.startY, r.endY);
      const w = Math.abs(r.endX - r.startX), h = Math.abs(r.endY - r.startY);
      if (activeTool === "highlight") {
        ctx.fillStyle = "#f5c842"; ctx.globalAlpha = 0.4;
        ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1;
      } else if (activeTool === "underline") {
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = "#60a5fa";
        ctx.fillRect(x, y, w, h);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "#60a5fa"; ctx.lineWidth = 2; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x + w, y + h); ctx.stroke();
      }
      return;
    }
    // Hover over a note — show its text (any tool mode)
    {
      const pos = getCanvasPos(e);
      const z = zoomRef.current;
      const note = annotations.find(a => a.page === currentPage && a.type === "note"
        && pos.x >= a.x * z && pos.x <= a.x * z + 22
        && pos.y >= a.y * z && pos.y <= a.y * z + 22
        && a.text);
      if (note) {
        const canvas = canvasRef.current!;
        const rect = canvas.getBoundingClientRect();
        setHoveredNote({ x: e.clientX - rect.left + 14, y: e.clientY - rect.top + 14, text: note.text! });
      } else {
        setHoveredNote(null);
      }
    }
  }

  function onMouseUp(e: React.MouseEvent) {
    if (!isDrawing || !drawRectRef.current) return;
    setIsDrawing(false);
    const pos = getCanvasPos(e);
    const r   = drawRectRef.current;
    const x   = Math.min(r.startX, pos.x), y = Math.min(r.startY, pos.y);
    const w   = Math.abs(pos.x - r.startX), h = Math.abs(pos.y - r.startY);
    drawRectRef.current = null;
    if (w < 5 && h < 5) return;
    const z = zoomRef.current;
    onAddAnnotation({
      id: crypto.randomUUID(),
      type: activeTool as "highlight" | "underline",
      page: currentPage,
      x: x / z, y: y / z, width: w / z, height: Math.max(h, 12) / z,
      color: activeTool === "highlight" ? "#f5c842" : "#60a5fa",
    });
  }

  function onContextMenu(e: React.MouseEvent) {
    const pos = getCanvasPos(e);
    const z = zoomRef.current;
    const hit = annotations.find(a => a.page === currentPage
      && pos.x >= a.x * z && pos.x <= (a.x + a.width) * z
      && pos.y >= a.y * z && pos.y <= (a.y + a.height) * z);
    if (hit) {
      e.preventDefault();
      onDeleteAnnotation(hit.id);
    }
  }

  function submitNote() {
    if (!notePrompt) return;
    const z = zoomRef.current;
    onAddAnnotation({
      id: crypto.randomUUID(), type: "note",
      page: currentPage,
      x: notePrompt.pageX / z, y: notePrompt.pageY / z,
      width: 22 / z, height: 22 / z,
      color: "#f5c842", text: noteText,
    });
    setNotePrompt(null); setNoteText("");
  }

  return (
    <div ref={containerRef} style={{
      width: "100%", height: "100%",
      overflowY: "auto", overflowX: "auto",
      background: "var(--bg-app)",
      // No justify-content here — that clips scrollable content on the left
    }}>
      {/* Inner wrapper centers content via margin:auto but allows full scroll range */}
      <div style={{ display: "flex", justifyContent: "center", alignItems: "flex-start", minWidth: "max-content", padding: "40px 24px 96px" }}>
      <div
        ref={pageWrapRef}
        style={{ display: "flex", gap: 16, alignItems: "flex-start", flexShrink: 0 }}
      >

        {/* Page 1 */}
        <div style={{ position: "relative", display: "inline-block", flexShrink: 0 }}>
          {/* Loading */}
          {!loaded && (
            <div style={{
              width: 640, height: 840,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "var(--text-muted)", fontSize: 13,
            }}>
              Loading…
            </div>
          )}
          <canvas
            ref={canvasRef}
            style={{
              display: loaded ? "block" : "none",
              border: "1px solid rgba(255,255,255,0.18)",
              borderRadius: 3,
              boxShadow: "0 2px 20px rgba(0,0,0,0.5)",
              filter: THEME_FILTER[theme],
              transition: FILTER_TRANSITION,
            }}
          />
          {/* Text layer — transparent, sits over canvas for native text selection */}
          <div
            ref={textLayerRef}
            className="textLayer"
            style={{
              position: "absolute", top: 0, left: 0,
              display: loaded && activeTool === "select" ? "block" : "none",
              pointerEvents: activeTool === "select" ? "auto" : "none",
              userSelect: "text",
            }}
            onMouseMove={onMouseMove}
            onMouseLeave={() => setHoveredNote(null)}
          />
          <canvas
            ref={overlayRef}
            style={{
              position: "absolute", top: 0, left: 0,
              width: "100%", height: "100%",
              display: loaded ? "block" : "none",
              cursor: activeTool === "select" ? (hoveredNote ? "default" : "default") : "crosshair",
              pointerEvents: activeTool === "select" ? "none" : "auto",
            }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onContextMenu={onContextMenu}
            onMouseLeave={() => setHoveredNote(null)}
          />

        {/* Note popup */}
        {notePrompt && (
          <NotePopup
            x={notePrompt.x}
            y={notePrompt.y}
            text={noteText}
            onChange={setNoteText}
            onSubmit={submitNote}
            onCancel={() => { setNotePrompt(null); setNoteText(""); }}
          />
        )}

        {/* Note hover tooltip */}
        {hoveredNote && (
          <div style={{
            position: "absolute",
            left: hoveredNote.x, top: hoveredNote.y,
            maxWidth: 220,
            background: "rgba(18,18,18,0.95)",
            border: "1px solid rgba(245,200,66,0.3)",
            borderLeft: "3px solid #f5c842",
            borderRadius: 8,
            padding: "7px 10px",
            fontSize: 12, lineHeight: 1.5,
            color: "var(--text-primary)",
            pointerEvents: "none",
            zIndex: 70,
            boxShadow: "0 6px 20px rgba(0,0,0,0.5)",
            animation: "pageEnter 0.12s var(--ease-out) both",
            whiteSpace: "pre-wrap", wordBreak: "break-word",
          }}>
            {hoveredNote.text}
          </div>
        )}
        </div>{/* end page-1 wrapper */}

        {/* Page 2 — double layout only */}
        {pageLayout === "double" && (
          <div style={{ position: "relative", display: "inline-block", flexShrink: 0 }}>
            <canvas
              ref={canvas2Ref}
              style={{
                display: loaded ? "block" : "none",
                border: "1px solid rgba(255,255,255,0.18)",
                borderRadius: 3,
                boxShadow: "0 2px 20px rgba(0,0,0,0.5)",
                filter: THEME_FILTER[theme],
                transition: FILTER_TRANSITION,
              }}
            />
            <canvas
              ref={overlay2Ref}
              style={{
                position: "absolute", top: 0, left: 0,
                width: "100%", height: "100%",
                display: loaded ? "block" : "none",
                cursor: activeTool === "select" ? "default" : "crosshair",
              }}
            />
          </div>
        )}
      </div>{/* end flex row */}
      </div>{/* end centering wrapper */}
    </div>
  );
}

// ── Note popup ────────────────────────────────────────────────────────────────

function NotePopup({ x, y, text, onChange, onSubmit, onCancel }: {
  x: number; y: number;
  text: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const W = 240, H = 148;
  const ref = useRef<HTMLDivElement>(null);

  // Clamp to keep popup inside canvas
  const [pos, setPos] = useState({ left: x + 14, top: y + 14 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const parent = el.parentElement;
    if (!parent) return;
    const pr = parent.getBoundingClientRect();
    let left = x + 14, top = y + 14;
    if (left + W > pr.width - 8)  left = x - W - 8;
    if (top  + H > pr.height - 8) top  = y - H - 8;
    setPos({ left: Math.max(4, left), top: Math.max(4, top) });
  }, [x, y]);

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        left: pos.left, top: pos.top,
        width: W,
        background: "var(--bg-raised)",
        border: "1px solid var(--border-default)",
        borderRadius: 12, padding: "12px 12px 10px",
        zIndex: 60,
        boxShadow: "0 12px 40px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.3)",
        animation: "pageEnter 0.16s var(--ease-out) both",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 9 }}>
        <div style={{
          width: 18, height: 18, borderRadius: 4, background: "#f5c842",
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <rect x="1" y="2" width="8" height="1.2" rx="0.6" fill="rgba(0,0,0,0.5)"/>
            <rect x="1" y="4.4" width="8" height="1.2" rx="0.6" fill="rgba(0,0,0,0.5)"/>
            <rect x="1" y="6.8" width="5" height="1.2" rx="0.6" fill="rgba(0,0,0,0.5)"/>
          </svg>
        </div>
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-dim)", letterSpacing: "-0.01em" }}>
          Add note
        </span>
      </div>

      {/* Textarea */}
      <textarea
        autoFocus
        value={text}
        placeholder="Type your note…"
        onChange={e => onChange(e.target.value)}
        rows={3}
        style={{
          width: "100%", fontSize: 12.5, borderRadius: 7, padding: "7px 9px",
          background: "var(--bg-active)",
          border: "1px solid var(--border-soft)",
          color: "var(--text-primary)", outline: "none", resize: "none",
          fontFamily: "var(--font-sans)", lineHeight: 1.55,
          boxSizing: "border-box",
          transition: "border-color var(--duration-fast)",
        }}
        onFocus={e => (e.currentTarget.style.borderColor = "var(--border-strong)")}
        onBlur={e => (e.currentTarget.style.borderColor = "var(--border-soft)")}
        onKeyDown={e => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit(); }
          if (e.key === "Escape") onCancel();
        }}
      />

      {/* Actions */}
      <div style={{ display: "flex", gap: 6, marginTop: 8, justifyContent: "flex-end" }}>
        <button
          onClick={onCancel}
          style={{
            fontSize: 11.5, padding: "4px 11px", borderRadius: 6,
            border: "1px solid var(--border-soft)", color: "var(--text-dim)",
            transition: "all var(--duration-fast) var(--ease-out)",
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border-strong)"; (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border-soft)"; (e.currentTarget as HTMLElement).style.color = "var(--text-dim)"; }}
        >
          Cancel
        </button>
        <button
          onClick={onSubmit}
          style={{
            fontSize: 11.5, padding: "4px 11px", borderRadius: 6, fontWeight: 600,
            background: "#f5c842", color: "#1a1200",
            transition: "opacity var(--duration-fast) var(--ease-out)",
          }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = "0.85"}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = "1"}
        >
          Save note
        </button>
      </div>
    </div>
  );
}
