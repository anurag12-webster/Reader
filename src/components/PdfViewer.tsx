import { useEffect, useLayoutEffect, useRef, useState, useCallback, memo, Component } from "react";
import type { ReactNode } from "react";
import * as pdfjsLib from "pdfjs-dist";
import "pdfjs-dist/web/pdf_viewer.css";
import { PdfTheme, PageLayout, Annotation, OutlineItem } from "../types";
import { AnnotationTool } from "./Toolbar";
import SelectionAIPopup from "./SelectionAIPopup";

class ErrorBoundary extends Component<{ children: ReactNode; onError?: () => void }, { err: boolean }> {
  state = { err: false };
  static getDerivedStateFromError() { return { err: true }; }
  componentDidCatch() { this.props.onError?.(); }
  render() { return this.state.err ? null : this.props.children; }
}

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

// ── Search highlight helpers ───────────────────────────────────────────────────

function highlightTextLayer(container: HTMLDivElement, query: string) {
  const lower = query.toLowerCase();
  const spans = Array.from(container.querySelectorAll("span")) as HTMLSpanElement[];
  for (const span of spans) {
    if (span.classList.contains("pdf-search-highlight")) continue;
    const text = span.textContent ?? "";
    const idx = text.toLowerCase().indexOf(lower);
    if (idx === -1) continue;
    const before = text.slice(0, idx);
    const match = text.slice(idx, idx + lower.length);
    const after = text.slice(idx + lower.length);
    span.innerHTML = "";
    if (before) span.appendChild(document.createTextNode(before));
    const mark = document.createElement("mark");
    mark.className = "pdf-search-highlight";
    mark.textContent = match;
    mark.style.cssText = "background:rgba(250,200,60,0.55);color:inherit;border-radius:2px;padding:0;";
    span.appendChild(mark);
    if (after) span.appendChild(document.createTextNode(after));
  }
}

function clearTextLayerHighlights(container: HTMLDivElement) {
  const marks = Array.from(container.querySelectorAll("mark.pdf-search-highlight"));
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (parent) {
      parent.replaceChild(document.createTextNode(mark.textContent ?? ""), mark);
      (parent as HTMLElement).normalize();
    }
  }
}

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
  highlightColor: string;
  pageLayout: PageLayout;
  rotation: number;
  annotations: Annotation[];
  searchQuery?: string;
  onTotalPages: (n: number) => void;
  onAddAnnotation: (a: Annotation) => void;
  onDeleteAnnotation: (id: string) => void;
  onZoomChange: (zoom: number) => void;
  onOutlineLoad: (outline: OutlineItem[]) => void;
  onPageChange?: (page: number) => void;
  translateLanguage?: string;
}

export default function PdfViewer({
  filePath, currentPage, zoom, theme, activeTool, highlightColor, pageLayout, rotation,
  annotations, searchQuery, onTotalPages, onAddAnnotation, onDeleteAnnotation, onZoomChange, onOutlineLoad, onPageChange, translateLanguage,
}: PdfViewerProps) {
  // Continuous scroll mode rendered separately
  if (pageLayout === "continuous") {
    return (
      <ContinuousViewer
        filePath={filePath} currentPage={currentPage} zoom={zoom} theme={theme}
        activeTool={activeTool} highlightColor={highlightColor} rotation={rotation} annotations={annotations}
        onTotalPages={onTotalPages} onAddAnnotation={onAddAnnotation}
        onDeleteAnnotation={onDeleteAnnotation} onZoomChange={onZoomChange}
        onOutlineLoad={onOutlineLoad} onPageChange={onPageChange}
        translateLanguage={translateLanguage}
      />
    );
  }
  const canvasRef     = useRef<HTMLCanvasElement>(null);
  const overlayRef    = useRef<HTMLCanvasElement>(null);
  const textLayerRef  = useRef<HTMLDivElement>(null);
  const canvas2Ref    = useRef<HTMLCanvasElement>(null);
  const overlay2Ref   = useRef<HTMLCanvasElement>(null);
  const textLayer2Ref = useRef<HTMLDivElement>(null); // ref to render text layer for the right page in two-page layout
  const containerRef  = useRef<HTMLDivElement>(null);
  const pdfRef        = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  const zoomRef         = useRef(zoom);
  const prevPageRef     = useRef(currentPage);
  const zoomAnchorRef   = useRef<{ cursorX: number; cursorY: number; scrollX: number; scrollY: number; fromZoom: number } | null>(null);
  const pageWrapRef     = useRef<HTMLDivElement>(null);
  const pendingZoomRef  = useRef(zoom);
  const zoomTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isGesturingRef  = useRef(false);
  const [loaded, setLoaded]       = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const drawRectRef   = useRef<DrawRect | null>(null);
  const rafRef        = useRef<number | null>(null);
  const drawingPageRef = useRef(0); // tracks which page a draw gesture started on
  const [notePrompt, setNotePrompt] = useState<{ x: number; y: number; pageX: number; pageY: number; page: number } | null>(null); 
  const [noteText, setNoteText]   = useState("");
  const [hoveredNote, setHoveredNote] = useState<{ x: number; y: number; text: string; page: number } | null>(null);
  const [aiPopup, setAiPopup] = useState<{ text: string; rect: DOMRect } | null>(null);

  // Keep refs in sync; don't overwrite pendingZoom mid-gesture (that's the scroll-accumulated value)
  useEffect(() => {
    zoomRef.current = zoom;
    if (!isGesturingRef.current) pendingZoomRef.current = zoom;
  }, [zoom]);

  // After zoom re-render: remove CSS scale (canvas is now at correct resolution) + fix scroll position
  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    const el = containerRef.current;
    const wrap = pageWrapRef.current;
    // Clear the visual scale now that the canvas has re-rendered at correct size
    if (wrap) wrap.style.transform = "";
    isGesturingRef.current = false;
    if (!anchor || !el) return;
    zoomAnchorRef.current = null;
    const ratio = zoom / anchor.fromZoom;
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

  // Re-apply search highlights when query changes (page already rendered)
  useEffect(() => {
    const textDiv = textLayerRef.current;
    if (textDiv) {
      clearTextLayerHighlights(textDiv);
      if (searchQuery && searchQuery.trim().length >= 2) highlightTextLayer(textDiv, searchQuery);
    }
    const textDiv2 = textLayer2Ref.current;
    if (textDiv2) {
      clearTextLayerHighlights(textDiv2);
      if (searchQuery && searchQuery.trim().length >= 2) highlightTextLayer(textDiv2, searchQuery);
    }
  }, [searchQuery]);

  // Ctrl+scroll: CSS scale gives instant visual feedback; debounce commits real zoom after gesture ends
  useEffect(() => {
    const el = containerRef.current;
    const wrap = pageWrapRef.current;
    if (!el) return;
    const container = el;
    const lastCursor = { x: 0, y: 0 };
    function onWheel(e: WheelEvent) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const step = e.deltaMode === 1 ? 0.08 : e.deltaY * 0.0008;
        const next = Math.min(4, Math.max(0.25, pendingZoomRef.current - step));
        pendingZoomRef.current = next;
        lastCursor.x = e.clientX;
        lastCursor.y = e.clientY;
        isGesturingRef.current = true;
        // Instant: CSS scale the wrapper (GPU, no canvas repaint)
        if (wrap) wrap.style.transform = `scale(${next / zoomRef.current})`;
        // Commit: after scrolling stops, do the real render once
        if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current);
        zoomTimerRef.current = setTimeout(() => {
          const rect = container.getBoundingClientRect();
          zoomAnchorRef.current = {
            cursorX: lastCursor.x - rect.left,
            cursorY: lastCursor.y - rect.top,
            scrollX: container.scrollLeft,
            scrollY: container.scrollTop,
            fromZoom: zoomRef.current,
          };
          onZoomChange(pendingZoomRef.current);
          // scale cleared in useLayoutEffect after canvas re-renders
        }, 120);
      } else if (e.shiftKey) {
        e.preventDefault();
        container.scrollLeft += e.deltaX !== 0 ? e.deltaX : e.deltaY;
      }
    }
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", onWheel);
      if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current);
    };
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

  const annotationsRef = useRef(annotations);
  useEffect(() => { annotationsRef.current = annotations; }, [annotations]);

  const drawAnnotations = useCallback((overlay: HTMLCanvasElement, page: number) => {
    const ctx = overlay.getContext("2d")!;
    const z = zoomRef.current;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    annotationsRef.current.filter(a => a.page === page).forEach(a => {
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
  }, []); // reads annotationsRef — never stale, no deps needed

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

        // Text layer for native text selection + search highlighting
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
          if (searchQuery && searchQuery.trim().length >= 2) {
            highlightTextLayer(textDiv, searchQuery);
          }
        }

        // Render second page if double layout and page exists
        const canvas2 = canvas2Ref.current;
        const overlay2 = overlay2Ref.current;
        const textDiv2 = textLayer2Ref.current;
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

          // Text layer for page 2
          if (textDiv2) {
            textDiv2.innerHTML = "";
            const dpr = window.devicePixelRatio || 1;
            textDiv2.style.setProperty("--total-scale-factor", String(zoom * dpr));
            textDiv2.style.width  = vp2.width  + "px";
            textDiv2.style.height = vp2.height + "px";
            const textLayer2 = new pdfjsLib.TextLayer({
              textContentSource: page2.streamTextContent(),
              container: textDiv2,
              viewport: vp2,
            });
            await textLayer2.render();
            if (searchQuery && searchQuery.trim().length >= 2) {
              highlightTextLayer(textDiv2, searchQuery);
            }
          }
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
  }, [loaded, currentPage, zoom, rotation, pageLayout]); // drawAnnotations stable (reads ref); theme intentionally excluded

  // Compute coordinates relative to any canvas
  function getCanvasPosFor(canvas: HTMLCanvasElement, e: React.MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top)  * (canvas.height / rect.height),
    };
  }
  function getCanvasPos(e: React.MouseEvent) {
    return getCanvasPosFor(canvasRef.current!, e);
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
      setNotePrompt({ x: e.clientX - rect.left + 12, y: e.clientY - rect.top + 12, pageX: pos.x, pageY: pos.y, page: currentPage });
      return;
    }
    setIsDrawing(true);
    drawingPageRef.current = currentPage;
    const pos = getCanvasPos(e);
    drawRectRef.current = { startX: pos.x, startY: pos.y, endX: pos.x, endY: pos.y };
  }

  function onMouseMove(e: React.MouseEvent) {
    // While drawing: update live preview, throttled to one rAF per frame
    if (isDrawing && drawRectRef.current) {
      const pos = getCanvasPos(e);
      drawRectRef.current.endX = pos.x;
      drawRectRef.current.endY = pos.y;
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          const overlay = overlayRef.current;
          if (!overlay || !drawRectRef.current) return;
          const ctx = overlay.getContext("2d")!;
          drawAnnotations(overlay, currentPage);
          const r = drawRectRef.current;
          const x = Math.min(r.startX, r.endX), y = Math.min(r.startY, r.endY);
          const w = Math.abs(r.endX - r.startX), h = Math.abs(r.endY - r.startY);
          if (activeTool === "highlight") {
            ctx.fillStyle = highlightColor; ctx.globalAlpha = 0.4;
            ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1;
          } else if (activeTool === "underline") {
            ctx.globalAlpha = 0.12; ctx.fillStyle = "#60a5fa";
            ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1;
            ctx.strokeStyle = "#60a5fa"; ctx.lineWidth = 2; ctx.lineCap = "round";
            ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x + w, y + h); ctx.stroke();
          }
        });
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
        setHoveredNote({ x: e.clientX - rect.left + 14, y: e.clientY - rect.top + 14, text: note.text!, page: currentPage });
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
    const page = drawingPageRef.current;
    onAddAnnotation({
      id: crypto.randomUUID(),
      type: activeTool as "highlight" | "underline",
      page,
      x: x / z, y: y / z, width: w / z, height: Math.max(h, 12) / z,
      color: activeTool === "highlight" ? highlightColor : "#60a5fa",
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
      page: notePrompt.page,
      x: notePrompt.pageX / z, y: notePrompt.pageY / z,
      width: 22 / z, height: 22 / z,
      color: "#f5c842", text: noteText,
    });
    setNotePrompt(null); setNoteText("");
  }

  // ── Page 2 event handlerss ──────────────────────────────────────────────────
  function onMouseDown2(e: React.MouseEvent) {
    const canvas2 = canvas2Ref.current!;
    if (canvas2.width === 0) return; // last page guard to handle when there's no next pagee 
    const nextPage = currentPage + 1;
    if (activeTool === "select") return;
    if (activeTool === "note") {
      const pos = getCanvasPosFor(canvas2, e);
      const z = zoomRef.current;
      const onExisting = annotations.some(a => a.page === nextPage && a.type === "note"
        && pos.x >= a.x * z && pos.x <= a.x * z + 22 && pos.y >= a.y * z && pos.y <= a.y * z + 22);
      if (onExisting) return;
      const rect = canvas2.getBoundingClientRect();
      setNotePrompt({ x: e.clientX - rect.left + 12, y: e.clientY - rect.top + 12, pageX: pos.x, pageY: pos.y, page: nextPage });
      return;
    }
    setIsDrawing(true);
    drawingPageRef.current = nextPage;
    const pos = getCanvasPosFor(canvas2, e);
    drawRectRef.current = { startX: pos.x, startY: pos.y, endX: pos.x, endY: pos.y };
  }

  function onMouseMove2(e: React.MouseEvent) {
    const nextPage = currentPage + 1;
    const canvas2 = canvas2Ref.current!;
    if (canvas2.width === 0) return;
    // While drawing: update live preview, throttled to one rAF per frame
    if (isDrawing && drawRectRef.current) {
      const pos = getCanvasPosFor(canvas2, e);
      drawRectRef.current.endX = pos.x;
      drawRectRef.current.endY = pos.y;
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          const overlay = overlay2Ref.current;
          if (!overlay || !drawRectRef.current) return;
          const ctx = overlay.getContext("2d")!;
          drawAnnotations(overlay, nextPage);
          const r = drawRectRef.current;
          const x = Math.min(r.startX, r.endX), y = Math.min(r.startY, r.endY);
          const w = Math.abs(r.endX - r.startX), h = Math.abs(r.endY - r.startY);
          if (activeTool === "highlight") {
            ctx.fillStyle = highlightColor; ctx.globalAlpha = 0.4;
            ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1;
          } else if (activeTool === "underline") {
            ctx.globalAlpha = 0.12; ctx.fillStyle = "#60a5fa";
            ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1;
            ctx.strokeStyle = "#60a5fa"; ctx.lineWidth = 2; ctx.lineCap = "round";
            ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x + w, y + h); ctx.stroke();
          }
        });
      }
      return;
    }
    // Hover over a note — show its text (any tool mode)
    {
      const pos = getCanvasPosFor(canvas2, e);
      const z = zoomRef.current;
      const note = annotations.find(a => a.page === nextPage && a.type === "note"
        && pos.x >= a.x * z && pos.x <= a.x * z + 22
        && pos.y >= a.y * z && pos.y <= a.y * z + 22
        && a.text);
      if (note) {
        const rect = canvas2.getBoundingClientRect();
        setHoveredNote({ x: e.clientX - rect.left + 14, y: e.clientY - rect.top + 14, text: note.text!, page: nextPage });
      } else {
        setHoveredNote(null);
      }
    }
  }

  function onMouseUp2(e: React.MouseEvent) {
    if (!isDrawing || !drawRectRef.current) return;
    const canvas2 = canvas2Ref.current!;
    if (canvas2.width === 0) return;
    setIsDrawing(false);
    const pos = getCanvasPosFor(canvas2, e);
    const r   = drawRectRef.current;
    const x   = Math.min(r.startX, pos.x), y = Math.min(r.startY, pos.y);
    const w   = Math.abs(pos.x - r.startX), h = Math.abs(pos.y - r.startY);
    drawRectRef.current = null;
    if (w < 5 && h < 5) return;
    const z = zoomRef.current;
    const page = drawingPageRef.current;
    onAddAnnotation({
      id: crypto.randomUUID(),
      type: activeTool as "highlight" | "underline",
      page,
      x: x / z, y: y / z, width: w / z, height: Math.max(h, 12) / z,
      color: activeTool === "highlight" ? highlightColor : "#60a5fa",
    });
  }

  function onContextMenu2(e: React.MouseEvent) {
    const canvas2 = canvas2Ref.current!;
    if (canvas2.width === 0) return;
    const nextPage = currentPage + 1;
    const pos = getCanvasPosFor(canvas2, e);
    const z = zoomRef.current;
    const hit = annotations.find(a => a.page === nextPage
      && pos.x >= a.x * z && pos.x <= (a.x + a.width) * z
      && pos.y >= a.y * z && pos.y <= (a.y + a.height) * z);
    if (hit) {
      e.preventDefault();
      onDeleteAnnotation(hit.id);
    }
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
              display: loaded && (activeTool === "select" || !!searchQuery) ? "block" : "none",
              pointerEvents: activeTool === "select" ? "auto" : "none",
              userSelect: "text",
            }}
            onMouseMove={onMouseMove}
            onMouseLeave={() => setHoveredNote(null)}
            onMouseUp={() => {
              if (activeTool !== "select") return;
              setTimeout(() => {
                const sel = window.getSelection();
                const text = sel?.toString().trim() ?? "";
                if (!text || !sel?.rangeCount) return;
                const rect = sel.getRangeAt(0).getBoundingClientRect();
                if (rect.width === 0 && rect.height === 0) return;
                setAiPopup({ text, rect });
              }, 10);
            }}
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

        {/* Note popup (page 1) */}
        {notePrompt && notePrompt.page === currentPage && (
          <NotePopup
            x={notePrompt.x}
            y={notePrompt.y}
            text={noteText}
            onChange={setNoteText}
            onSubmit={submitNote}
            onCancel={() => { setNotePrompt(null); setNoteText(""); }}
          />
        )}

        {/* Note hover tooltip (page 1) */}
        {hoveredNote && hoveredNote.page === currentPage && (
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
            {/* Text layer for page 2 */}
            <div
              ref={textLayer2Ref}
              className="textLayer"
              style={{
                position: "absolute", top: 0, left: 0,
                display: loaded && (activeTool === "select" || !!searchQuery) ? "block" : "none",
                pointerEvents: activeTool === "select" ? "auto" : "none",
                userSelect: "text",
              }}
              onMouseMove={onMouseMove2}
              onMouseLeave={() => setHoveredNote(null)}
              onMouseUp={() => {
                if (activeTool !== "select") return;
                setTimeout(() => {
                  const sel = window.getSelection();
                  const text = sel?.toString().trim() ?? "";
                  if (!text || !sel?.rangeCount) return;
                  const rect = sel.getRangeAt(0).getBoundingClientRect();
                  if (rect.width === 0 && rect.height === 0) return;
                  setAiPopup({ text, rect });
                }, 10);
              }}
            />
            <canvas
              ref={overlay2Ref}
              style={{
                position: "absolute", top: 0, left: 0,
                width: "100%", height: "100%",
                display: loaded ? "block" : "none",
                cursor: activeTool === "select" ? "default" : "crosshair",
                pointerEvents: activeTool === "select" ? "none" : "auto",
              }}
              onMouseDown={onMouseDown2}
              onMouseMove={onMouseMove2}
              onMouseUp={onMouseUp2}
              onContextMenu={onContextMenu2}
              onMouseLeave={() => setHoveredNote(null)}
            />

            {/* Note popup (page 2) */}
            {notePrompt && notePrompt.page === currentPage + 1 && (
              <NotePopup
                x={notePrompt.x}
                y={notePrompt.y}
                text={noteText}
                onChange={setNoteText}
                onSubmit={submitNote}
                onCancel={() => { setNotePrompt(null); setNoteText(""); }}
              />
            )}

            {/* Note hover tooltip (page 2) */}
            {hoveredNote && hoveredNote.page === currentPage + 1 && (
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
          </div>
        )}
      </div>{/* end flex row */}
      </div>{/* end centering wrapper */}

      {aiPopup && (
        <ErrorBoundary onError={() => setAiPopup(null)}>
        <SelectionAIPopup
          selectedText={aiPopup.text}
          anchorRect={aiPopup.rect}
          onClose={() => setAiPopup(null)}
          translateLanguage={translateLanguage}
        />
        </ErrorBoundary>
      )}
    </div>
  );
}

// ── Continuous scroll viewer ──────────────────────────────────────────────────

interface ContinuousProps {
  filePath: string; currentPage: number; zoom: number; theme: PdfTheme;
  activeTool: AnnotationTool; highlightColor: string; rotation: number; annotations: Annotation[];
  onTotalPages: (n: number) => void; onAddAnnotation: (a: Annotation) => void;
  onDeleteAnnotation: (id: string) => void; onZoomChange: (zoom: number) => void;
  onOutlineLoad: (outline: OutlineItem[]) => void; onPageChange?: (page: number) => void;
  translateLanguage?: string;
}

function ContinuousViewer({
  filePath, currentPage, zoom, theme, activeTool, highlightColor, rotation, annotations,
  onTotalPages, onAddAnnotation, onDeleteAnnotation, onZoomChange, onOutlineLoad, onPageChange, translateLanguage,
}: ContinuousProps) {
  const containerRef   = useRef<HTMLDivElement>(null);
  const contentRef     = useRef<HTMLDivElement>(null);
  const pdfRef         = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const zoomRef        = useRef(zoom);
  const zoomAnchorRef  = useRef<{ cursorX: number; cursorY: number; scrollX: number; scrollY: number; fromZoom: number } | null>(null);
  const pendingZoomRef = useRef(zoom);
  const zoomTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isGesturingRef = useRef(false);
  const [totalPages, setTotalPages] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [aiPopup, setAiPopup] = useState<{ text: string; rect: DOMRect } | null>(null);
  // Track which page canvases are rendered
  const pageRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  // Suppresses IntersectionObserver callbacks while a programmatic scroll is in flight
  const suppressObserverRef = useRef(false);
  const suppressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    zoomRef.current = zoom;
    if (!isGesturingRef.current) pendingZoomRef.current = zoom;
  }, [zoom]);

  // Zoom-to-cursor for continuous mode
  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    const el = containerRef.current;
    const wrap = contentRef.current;
    if (wrap) wrap.style.transform = "";
    isGesturingRef.current = false;
    if (!anchor || !el) return;
    zoomAnchorRef.current = null;
    const ratio = zoom / anchor.fromZoom;
    el.scrollLeft = (anchor.scrollX + anchor.cursorX) * ratio - anchor.cursorX;
    el.scrollTop  = (anchor.scrollY + anchor.cursorY) * ratio - anchor.cursorY;
  }, [zoom]);

  // Ctrl+scroll: CSS scale for instant feedback, debounce commits real zoom
  useEffect(() => {
    const el = containerRef.current;
    const wrap = contentRef.current;
    if (!el) return;
    const container = el;
    const lastCursor = { x: 0, y: 0 };
    function onWheel(e: WheelEvent) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const step = e.deltaMode === 1 ? 0.08 : e.deltaY * 0.0008;
        const next = Math.min(4, Math.max(0.25, pendingZoomRef.current - step));
        pendingZoomRef.current = next;
        lastCursor.x = e.clientX;
        lastCursor.y = e.clientY;
        isGesturingRef.current = true;
        if (wrap) wrap.style.transform = `scale(${next / zoomRef.current})`;
        if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current);
        zoomTimerRef.current = setTimeout(() => {
          const rect = container.getBoundingClientRect();
          zoomAnchorRef.current = { cursorX: lastCursor.x - rect.left, cursorY: lastCursor.y - rect.top, scrollX: container.scrollLeft, scrollY: container.scrollTop, fromZoom: zoomRef.current };
          onZoomChange(pendingZoomRef.current);
        }, 120);
      } else if (e.shiftKey) {
        e.preventDefault();
        container.scrollLeft += e.deltaX !== 0 ? e.deltaX : e.deltaY;
      }
    }
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => { container.removeEventListener("wheel", onWheel); if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current); };
  }, [onZoomChange]);

  // Load PDF
  useEffect(() => {
    setLoaded(false); setTotalPages(0); pdfRef.current = null;
    pageRefs.current.clear();
    suppressObserverRef.current = false;
    let cancelled = false;
    pdfjsLib.getDocument({ url: filePath }).promise.then(async pdf => {
      if (cancelled) return;
      pdfRef.current = pdf;
      setTotalPages(pdf.numPages);
      onTotalPages(pdf.numPages);
      setLoaded(true);
      try {
        const raw = await pdf.getOutline();
        if (!cancelled && raw) onOutlineLoad(raw as OutlineItem[]);
      } catch { /* no outline */ }
    }).catch(e => console.error("PDF load:", e));
    return () => { cancelled = true; };
  }, [filePath]);

  // Scroll to page on any currentPage change (outline click, page input, keyboard, initial load).
  // Suppress IntersectionObserver callbacks during the scroll so they don't fight each other.
  useEffect(() => {
    if (!loaded) return;
    const canvas = pageRefs.current.get(currentPage);
    if (!canvas) return;
    suppressObserverRef.current = true;
    canvas.scrollIntoView({ behavior: "smooth", block: "start" });
    // Unsuppress after scroll animation completes (~700ms for smooth scroll)
    if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current);
    suppressTimerRef.current = setTimeout(() => { suppressObserverRef.current = false; }, 700);
  }, [loaded, currentPage]); // eslint-disable-line react-hooks/exhaustive-deps

  // IntersectionObserver — report which page is most visible
  useEffect(() => {
    if (!loaded || !containerRef.current) return;
    const io = new IntersectionObserver(entries => {
      let bestPage = -1;
      let bestRatio = -1;
      entries.forEach(entry => {
        const page = Number((entry.target as HTMLElement).dataset.page);
        if (entry.intersectionRatio > bestRatio) { bestRatio = entry.intersectionRatio; bestPage = page; }
      });
      if (bestPage >= 0 && onPageChange && !suppressObserverRef.current) {
        onPageChange(bestPage);
      }
    }, { root: containerRef.current, threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] });

    // Observe all page canvases
    pageRefs.current.forEach((canvas, page) => {
      (canvas as HTMLElement).dataset.page = String(page);
      io.observe(canvas);
    });
    return () => io.disconnect();
  }, [loaded, totalPages, onPageChange]);

  // Stable callbacks so ContinuousPage memo is effective
  const handleMount = useCallback((pageNum: number, canvas: HTMLCanvasElement) => {
    pageRefs.current.set(pageNum, canvas);
  }, []);
  const handleSelectionMouseUp = useCallback((text: string, rect: DOMRect) => {
    setAiPopup({ text, rect });
  }, []);

  if (!loaded) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 13 }}>
        Loading…
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", overflowY: "auto", overflowX: "auto", background: "var(--bg-app)" }}>
      <div ref={contentRef} style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "40px 24px 96px", gap: 16, transformOrigin: "top center", minWidth: "100%" }}>
        {Array.from({ length: totalPages }, (_, i) => i + 1).map(pageNum => (
            <ContinuousPage
              key={`${filePath}-${pageNum}`}
              pageNum={pageNum}
              pdf={pdfRef.current!}
              zoom={zoom}
              theme={theme}
              rotation={rotation}
              activeTool={activeTool}
              highlightColor={highlightColor}
              annotations={annotations}
              onAddAnnotation={onAddAnnotation}
              onDeleteAnnotation={onDeleteAnnotation}
              onMount={canvas => handleMount(pageNum, canvas)}
              onSelectionMouseUp={handleSelectionMouseUp}
            />
        ))}
      </div>

      {aiPopup && (
        <ErrorBoundary onError={() => setAiPopup(null)}>
        <SelectionAIPopup
          selectedText={aiPopup.text}
          anchorRect={aiPopup.rect}
          onClose={() => setAiPopup(null)}
          translateLanguage={translateLanguage}
        />
        </ErrorBoundary>
      )}
    </div>
  );
}

const ContinuousPage = memo(function ContinuousPage({
  pageNum, pdf, zoom, theme, rotation, activeTool, highlightColor, annotations,
  onAddAnnotation, onDeleteAnnotation, onMount, onSelectionMouseUp,
}: {
  pageNum: number; pdf: pdfjsLib.PDFDocumentProxy; zoom: number; theme: PdfTheme;
  rotation: number; activeTool: AnnotationTool; highlightColor: string; annotations: Annotation[];
  onAddAnnotation: (a: Annotation) => void; onDeleteAnnotation: (id: string) => void;
  onMount: (canvas: HTMLCanvasElement) => void;
  onSelectionMouseUp?: (text: string, rect: DOMRect) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  const zoomRef = useRef(zoom);
  const isDrawing = useRef(false);
  const drawRectRef = useRef<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const annotationsRef = useRef(annotations);

  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { annotationsRef.current = annotations; }, [annotations]);

  // Register canvas with parent for scrolling/observation
  useEffect(() => { if (canvasRef.current) onMount(canvasRef.current); }, []);

  // Draw annotations
  const drawAnnotations = useCallback((overlay: HTMLCanvasElement) => {
    const ctx = overlay.getContext("2d")!;
    const z = zoomRef.current;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    annotationsRef.current.filter(a => a.page === pageNum).forEach(a => {
      const ax = a.x * z, ay = a.y * z, aw = a.width * z, ah = a.height * z;
      if (a.type === "highlight") {
        ctx.fillStyle = a.color; ctx.globalAlpha = 0.35;
        ctx.fillRect(ax, ay, aw, ah); ctx.globalAlpha = 1;
      } else if (a.type === "underline") {
        ctx.globalAlpha = 0.12; ctx.fillStyle = a.color;
        ctx.fillRect(ax, ay, aw, ah); ctx.globalAlpha = 1;
        ctx.strokeStyle = a.color; ctx.lineWidth = 2; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(ax, ay + ah); ctx.lineTo(ax + aw, ay + ah); ctx.stroke();
      } else if (a.type === "note") {
        const s = 20;
        ctx.shadowColor = "rgba(0,0,0,0.35)"; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
        ctx.fillStyle = "#f5c842"; ctx.beginPath(); ctx.roundRect(ax, ay, s, s, 4); ctx.fill();
        ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      }
    });
  }, [pageNum]); // reads annotationsRef — stable, no annotation dep needed

  // Render page
  useEffect(() => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay || !pdf) return;
    if (renderTaskRef.current) { renderTaskRef.current.cancel(); renderTaskRef.current = null; }
    let cancelled = false;
    (async () => {
      try {
        const page = await pdf.getPage(pageNum);
        if (cancelled) return;
        const vp = page.getViewport({ scale: zoom, rotation });
        const ctx = canvas.getContext("2d")!;
        canvas.width = vp.width; canvas.height = vp.height;
        canvas.style.filter = THEME_FILTER[theme];
        overlay.width = vp.width; overlay.height = vp.height;
        ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, vp.width, vp.height);
        const task = page.render({ canvasContext: ctx, viewport: vp, canvas });
        renderTaskRef.current = task;
        await task.promise;
        if (cancelled) return;
        drawAnnotations(overlay);

        // Render text layer for selection
        const textLayer = textLayerRef.current;
        if (textLayer) {
          textLayer.innerHTML = "";
          const dpr = window.devicePixelRatio || 1;
          textLayer.style.setProperty("--total-scale-factor", String(zoom * dpr));
          textLayer.style.width  = vp.width + "px";
          textLayer.style.height = vp.height + "px";
          const tl = new pdfjsLib.TextLayer({ textContentSource: page.streamTextContent(), container: textLayer, viewport: vp });
          if (!cancelled) await tl.render();
        }
      } catch (e: unknown) {
        if ((e as { name?: string }).name !== "RenderingCancelledException") console.error("Render:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [pdf, pageNum, zoom, rotation, theme]); // drawAnnotations stable (reads ref)

  function getPos(e: React.MouseEvent) {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  }

  function onMouseDown(e: React.MouseEvent) {
    if (activeTool === "select" || activeTool === "note") return;
    isDrawing.current = true;
    const pos = getPos(e);
    drawRectRef.current = { startX: pos.x, startY: pos.y, endX: pos.x, endY: pos.y };
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!isDrawing.current || !drawRectRef.current || !overlayRef.current) return;
    const pos = getPos(e);
    drawRectRef.current.endX = pos.x; drawRectRef.current.endY = pos.y;
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const overlay = overlayRef.current;
        if (!overlay || !drawRectRef.current) return;
        const ctx = overlay.getContext("2d")!;
        drawAnnotations(overlay);
        const r = drawRectRef.current;
        const x = Math.min(r.startX, r.endX), y = Math.min(r.startY, r.endY);
        const w = Math.abs(r.endX - r.startX), h = Math.abs(r.endY - r.startY);
        if (activeTool === "highlight") { ctx.fillStyle = highlightColor; ctx.globalAlpha = 0.4; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1; }
        else if (activeTool === "underline") {
          ctx.globalAlpha = 0.12; ctx.fillStyle = "#60a5fa"; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1;
          ctx.strokeStyle = "#60a5fa"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x + w, y + h); ctx.stroke();
        }
      });
    }
  }

  function onMouseUp(e: React.MouseEvent) {
    if (!isDrawing.current || !drawRectRef.current) return;
    isDrawing.current = false;
    const pos = getPos(e);
    const r = drawRectRef.current;
    const x = Math.min(r.startX, pos.x), y = Math.min(r.startY, pos.y);
    const w = Math.abs(pos.x - r.startX), h = Math.abs(pos.y - r.startY);
    drawRectRef.current = null;
    if (w < 5 && h < 5) return;
    const z = zoomRef.current;
    onAddAnnotation({ id: crypto.randomUUID(), type: activeTool as "highlight" | "underline", page: pageNum, x: x / z, y: y / z, width: w / z, height: Math.max(h, 12) / z, color: activeTool === "highlight" ? highlightColor : "#60a5fa" });
  }

  function onContextMenu(e: React.MouseEvent) {
    const pos = getPos(e);
    const z = zoomRef.current;
    const hit = annotations.find(a => a.page === pageNum && pos.x >= a.x * z && pos.x <= (a.x + a.width) * z && pos.y >= a.y * z && pos.y <= (a.y + a.height) * z);
    if (hit) { e.preventDefault(); onDeleteAnnotation(hit.id); }
  }

  return (
    <div style={{ position: "relative", display: "inline-block", flexShrink: 0 }}>
      <canvas ref={canvasRef} data-page={pageNum} style={{ display: "block", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 3, boxShadow: "0 2px 20px rgba(0,0,0,0.5)", filter: THEME_FILTER[theme], transition: FILTER_TRANSITION }} />
      <canvas ref={overlayRef} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", cursor: activeTool === "select" ? "default" : "crosshair", pointerEvents: activeTool === "select" ? "none" : "auto" }}
        onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onContextMenu={onContextMenu}
      />
      <div
        ref={textLayerRef}
        className="textLayer"
        style={{
          position: "absolute", top: 0, left: 0,
          pointerEvents: activeTool === "select" ? "auto" : "none",
          userSelect: activeTool === "select" ? "text" : "none",
          overflow: "hidden",
        }}
        onMouseUp={() => {
          if (activeTool !== "select" || !onSelectionMouseUp) return;
          setTimeout(() => {
            const sel = window.getSelection();
            const text = sel?.toString().trim() ?? "";
            if (!text || !sel?.rangeCount) return;
            const rect = sel.getRangeAt(0).getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return;
            onSelectionMouseUp(text, rect);
          }, 10);
        }}
      />
    </div>
  );
}); // end memo(ContinuousPage)

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
