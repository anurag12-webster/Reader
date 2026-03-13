import { useState, useCallback, useEffect, useRef } from "react";
import { Layers, CheckCircle, Circle } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import type { PdfFile, PdfTheme, Annotation, OutlineItem, LibraryStore } from "./types";
import { AnnotationTool, PageLayout } from "./components/Toolbar";
import TitleBar from "./components/TitleBar";
import Sidebar from "./components/Sidebar";
import Toolbar from "./components/Toolbar";
import PdfViewer from "./components/PdfViewer";
import EmptyState, { addRecentFile } from "./components/EmptyState";
import ArtifactsPanel from "./components/ArtifactsPanel";

interface OpenedPdf { data: string; title: string | null; urls: string[]; }

function ArtifactsToggle({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Artifacts — links, repos, datasets"
      style={{
        position: "absolute", top: 12, right: 12, zIndex: 10,
        width: 32, height: 32, borderRadius: 8,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: active ? "var(--bg-active)" : "var(--bg-raised)",
        border: `1px solid ${active ? "var(--border-default)" : "var(--border-faint)"}`,
        color: active ? "var(--text-white)" : "var(--text-dim)",
        cursor: "pointer",
        transition: "all var(--duration-fast) var(--ease-out)",
      }}
      onMouseEnter={e => {
        if (!active) {
          (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)";
          (e.currentTarget as HTMLElement).style.borderColor = "var(--border-default)";
          (e.currentTarget as HTMLElement).style.color = "var(--text-primary)";
        }
      }}
      onMouseLeave={e => {
        if (!active) {
          (e.currentTarget as HTMLElement).style.background = "var(--bg-raised)";
          (e.currentTarget as HTMLElement).style.borderColor = "var(--border-faint)";
          (e.currentTarget as HTMLElement).style.color = "var(--text-dim)";
        }
      }}
    >
      <Layers size={13} strokeWidth={1.8} />
    </button>
  );
}

export default function App() {
  const [files, setFiles] = useState<PdfFile[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [showHome, setShowHome] = useState(true);
  const [activeTool, setActiveTool] = useState<AnnotationTool>("select");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  const [readPages, setReadPages] = useState<Record<string, number[]>>({});
  const libraryRef = useRef<LibraryStore | null>(null);

  const activeFile = files.find((f) => f.id === activeFileId) ?? null;
  const isHome = showHome || !activeFileId;
  const fileTotalPages: Record<string, number> = {};
  for (const f of files) fileTotalPages[f.diskPath] = f.totalPages;

  // Load library once on mount; keep a ref so saves can merge without re-fetching
  useEffect(() => {
    invoke<LibraryStore>("get_library").then(lib => {
      libraryRef.current = lib;
      if (lib.readPages && Object.keys(lib.readPages).length > 0) {
        setReadPages(lib.readPages);
      }
    }).catch(() => {});
  }, []);

  function togglePageRead(filePath: string, page: number) {
    setReadPages(prev => {
      const pages = prev[filePath] ?? [];
      const next = pages.includes(page)
        ? pages.filter(p => p !== page)
        : [...pages, page].sort((a, b) => a - b);
      const updated = { ...prev, [filePath]: next };
      if (libraryRef.current) {
        const store = { ...libraryRef.current, readPages: updated };
        libraryRef.current = store;
        invoke("save_library", { store }).catch(() => {});
      }
      return updated;
    });
  }

  useEffect(() => { setArtifactsOpen(false); }, [activeFileId, showHome]);

  const selectFile = useCallback((id: string) => {
    setActiveFileId(id);
    setShowHome(false);
  }, []);

  const goHome = useCallback(() => setShowHome(true), []);

  async function loadPdfFromPath(diskPath: string, fallbackName: string): Promise<{ blobUrl: string; name: string; urls: string[] }> {
    const { data, title, urls } = await invoke<OpenedPdf>("open_pdf", { path: diskPath });
    const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    const blobUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const name = title ?? fallbackName;
    return { blobUrl, name, urls };
  }

  const openFile = useCallback(async () => {
    try {
      const selected = await open({ multiple: true, filters: [{ name: "PDF Files", extensions: ["pdf"] }] });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      if (paths.length === 0) return;

      const loaded = await Promise.all(paths.map(async diskPath => {
        const fallbackName = diskPath.split(/[\\/]/).pop() ?? diskPath;
        const { blobUrl, name, urls } = await loadPdfFromPath(diskPath, fallbackName.replace(/\.pdf$/i, ""));
        const id = crypto.randomUUID();
        await addRecentFile(diskPath, name);
        const savedAnns = libraryRef.current?.annotations?.[diskPath] ?? [];
        return { id, name, blobUrl, diskPath, urls, savedAnns };
      }));

      setFiles(prev => [...prev, ...loaded.map(({ id, name, blobUrl, diskPath, urls, savedAnns }) => ({
        id, name, path: blobUrl, diskPath,
        totalPages: 1, currentPage: 1,
        zoom: 1.5, theme: "classic" as const, pageLayout: "single" as const, rotation: 0,
        annotations: savedAnns, outline: [], artifactUrls: urls,
      }))]);
      const lastId = loaded[loaded.length - 1]?.id;
      if (lastId) { setActiveFileId(lastId); setShowHome(false); }
    } catch (e) {
      console.error("Failed to open file:", e);
    }
  }, []);

  const updateFile = useCallback((id: string, patch: Partial<PdfFile>) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f));
  }, []);

  const closeFile = useCallback((id: string) => {
    const file = files.find(f => f.id === id);
    if (file) URL.revokeObjectURL(file.path);
    setFiles(prev => prev.filter(f => f.id !== id));
    if (activeFileId === id) {
      const remaining = files.filter(f => f.id !== id);
      if (remaining.length > 0) {
        setActiveFileId(remaining[remaining.length - 1].id);
        setShowHome(false);
      } else {
        setActiveFileId(null);
        setShowHome(true);
      }
    }
  }, [activeFileId, files]);

  const openFromPath = useCallback(async (filePath: string, name: string) => {
    try {
      const existing = files.find(f => f.name === name);
      if (existing) { selectFile(existing.id); return; }

      const { blobUrl, name: resolvedName, urls } = await loadPdfFromPath(filePath, name.replace(/\.pdf$/i, ""));
      const id = crypto.randomUUID();
      const savedAnns = libraryRef.current?.annotations?.[filePath] ?? [];

      await addRecentFile(filePath, resolvedName);
      setFiles(prev => [...prev, {
        id, name: resolvedName, path: blobUrl, diskPath: filePath,
        totalPages: 1, currentPage: 1,
        zoom: 1.5, theme: "classic", pageLayout: "single", rotation: 0,
        annotations: savedAnns, outline: [], artifactUrls: urls,
      }]);
      setActiveFileId(id);
      setShowHome(false);
    } catch (e) {
      console.error("Failed to open recent file:", e);
    }
  }, [files, selectFile]);

  function persistAnnotations(diskPath: string, anns: Annotation[]) {
    if (!libraryRef.current) return;
    const store = {
      ...libraryRef.current,
      annotations: { ...(libraryRef.current.annotations ?? {}), [diskPath]: anns },
    };
    libraryRef.current = store;
    invoke("save_library", { store }).catch(() => {});
  }

  const addAnnotation = useCallback((ann: Annotation) => {
    if (!activeFileId || !activeFile) return;
    const anns = [...activeFile.annotations, ann];
    updateFile(activeFileId, { annotations: anns });
    persistAnnotations(activeFile.diskPath, anns);
  }, [activeFileId, activeFile, updateFile]);

  const deleteAnnotation = useCallback((id: string) => {
    if (!activeFileId || !activeFile) return;
    const anns = activeFile.annotations.filter(a => a.id !== id);
    updateFile(activeFileId, { annotations: anns });
    persistAnnotations(activeFile.diskPath, anns);
  }, [activeFileId, activeFile, updateFile]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isHome || !activeFileId || !activeFile) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag !== "INPUT" && tag !== "TEXTAREA") {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          if (activeFile.currentPage < activeFile.totalPages)
            updateFile(activeFileId, { currentPage: activeFile.currentPage + 1 });
          return;
        }
        if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          if (activeFile.currentPage > 1)
            updateFile(activeFileId, { currentPage: activeFile.currentPage - 1 });
          return;
        }
      }
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        updateFile(activeFileId, { zoom: Math.min(activeFile.zoom + 0.15, 4) });
      } else if (e.key === "-") {
        e.preventDefault();
        updateFile(activeFileId, { zoom: Math.max(activeFile.zoom - 0.15, 0.25) });
      } else if (e.key === "0") {
        e.preventDefault();
        updateFile(activeFileId, { zoom: 1.5 });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isHome, activeFileId, activeFile, updateFile]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", width: "100vw", overflow: "hidden", background: "var(--bg-app)" }}>
      <TitleBar
        files={files}
        activeFileId={activeFileId}
        onSelectFile={selectFile}
        onCloseFile={closeFile}
        onGoHome={goHome}
        onOpenFile={openFile}
        isHome={isHome}
      />

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {!isHome && activeFile && (
          <Sidebar
            activeFile={activeFile}
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed(v => !v)}
            onOpenFile={openFile}
            onPageJump={page => activeFileId && updateFile(activeFileId, { currentPage: page })}
          />
        )}

        <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, overflow: "hidden" }}>
          {isHome ? (
            <EmptyState
              onOpenFile={openFile}
              onOpenPath={openFromPath}
              openFiles={files.map(f => ({ id: f.id, name: f.name, path: f.diskPath, totalPages: f.totalPages }))}
              readPages={readPages}
              fileTotalPages={fileTotalPages}
              onResumeFile={selectFile}
            />
          ) : activeFile ? (
            <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
              <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
                <ArtifactsToggle active={artifactsOpen} onClick={() => setArtifactsOpen(v => !v)} />

                {/* Mark page read */}
                {(() => {
                  const isRead = (readPages[activeFile.diskPath] ?? []).includes(activeFile.currentPage);
                  return (
                    <button
                      onClick={() => togglePageRead(activeFile.diskPath, activeFile.currentPage)}
                      title={isRead ? "Unmark page as read" : "Mark page as read"}
                      style={{
                        position: "absolute", top: 52, right: 12, zIndex: 10,
                        width: 32, height: 32, borderRadius: 8,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: isRead ? "var(--bg-active)" : "var(--bg-raised)",
                        border: `1px solid ${isRead ? "var(--border-default)" : "var(--border-faint)"}`,
                        color: isRead ? "#4A9B7F" : "var(--text-dim)",
                        cursor: "pointer",
                        transition: "all var(--duration-fast) var(--ease-out)",
                      }}
                      onMouseEnter={e => {
                        if (!isRead) {
                          (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)";
                          (e.currentTarget as HTMLElement).style.borderColor = "var(--border-default)";
                          (e.currentTarget as HTMLElement).style.color = "var(--text-primary)";
                        }
                      }}
                      onMouseLeave={e => {
                        if (!isRead) {
                          (e.currentTarget as HTMLElement).style.background = "var(--bg-raised)";
                          (e.currentTarget as HTMLElement).style.borderColor = "var(--border-faint)";
                          (e.currentTarget as HTMLElement).style.color = "var(--text-dim)";
                        }
                      }}
                    >
                      {isRead ? <CheckCircle size={13} strokeWidth={2} /> : <Circle size={13} strokeWidth={1.8} />}
                    </button>
                  );
                })()}

                <PdfViewer
                  key={activeFile.id}
                  filePath={activeFile.path}
                  currentPage={activeFile.currentPage}
                  zoom={activeFile.zoom}
                  theme={activeFile.theme}
                  activeTool={activeTool}
                  pageLayout={activeFile.pageLayout}
                  rotation={activeFile.rotation}
                  annotations={activeFile.annotations}
                  onTotalPages={n => updateFile(activeFile.id, { totalPages: n })}
                  onAddAnnotation={addAnnotation}
                  onDeleteAnnotation={deleteAnnotation}
                  onZoomChange={z => updateFile(activeFile.id, { zoom: z })}
                  onOutlineLoad={(outline: OutlineItem[]) => updateFile(activeFile.id, { outline })}
                />
                <Toolbar
                  currentPage={activeFile.currentPage}
                  totalPages={activeFile.totalPages}
                  zoom={activeFile.zoom}
                  theme={activeFile.theme}
                  activeTool={activeTool}
                  pageLayout={activeFile.pageLayout}
                  rotation={activeFile.rotation}
                  onZoomIn={() => updateFile(activeFile.id, { zoom: Math.min(activeFile.zoom + 0.15, 4) })}
                  onZoomOut={() => updateFile(activeFile.id, { zoom: Math.max(activeFile.zoom - 0.15, 0.25) })}
                  onZoomReset={() => updateFile(activeFile.id, { zoom: 1.5 })}
                  onPrevPage={() => updateFile(activeFile.id, { currentPage: Math.max(activeFile.currentPage - 1, 1) })}
                  onNextPage={() => updateFile(activeFile.id, { currentPage: Math.min(activeFile.currentPage + 1, activeFile.totalPages) })}
                  onPageInput={page => updateFile(activeFile.id, { currentPage: page })}
                  onThemeChange={(theme: PdfTheme) => updateFile(activeFile.id, { theme })}
                  onToolChange={setActiveTool}
                  onPageLayoutChange={(pageLayout: PageLayout) => updateFile(activeFile.id, { pageLayout })}
                  onRotate={rotation => updateFile(activeFile.id, { rotation })}
                />
              </div>
              {artifactsOpen && (
                <ArtifactsPanel urls={activeFile.artifactUrls} onClose={() => setArtifactsOpen(false)} />
              )}
            </div>
          ) : (
            <EmptyState
              onOpenFile={openFile}
              onOpenPath={openFromPath}
              openFiles={files.map(f => ({ id: f.id, name: f.name, path: f.diskPath, totalPages: f.totalPages }))}
              readPages={readPages}
              fileTotalPages={fileTotalPages}
              onResumeFile={selectFile}
            />
          )}
        </div>
      </div>
    </div>
  );
}
