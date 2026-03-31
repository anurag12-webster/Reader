import { useEffect, useRef, useState, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { Search, X, ChevronUp, ChevronDown, Clock } from "lucide-react";
import Tooltip from "./Tooltip";

// Text cache: filePath → page texts. Capped at MAX_CACHE_PAGES total pages across all files.
const MAX_CACHE_PAGES = 2000;
const textCache = new Map<string, string[]>(); // filePath → array of page texts (0-indexed)
let cachedPageCount = 0;

function evictCacheIfNeeded(newPages: number) {
  while (cachedPageCount + newPages > MAX_CACHE_PAGES && textCache.size > 0) {
    const oldestKey = textCache.keys().next().value!;
    cachedPageCount -= textCache.get(oldestKey)!.length;
    textCache.delete(oldestKey);
  }
}

export interface SearchMatch {
  page: number;
  snippet: string;
  matchIndex: number;
}

interface PageGroup {
  page: number;
  matches: SearchMatch[];
}

interface PdfSearchProps {
  filePath: string;
  totalPages: number;
  onJumpToPage: (page: number) => void;
  onQueryChange: (q: string) => void;
  onClose: () => void;
}

const HISTORY_KEY = "pdf-search-history";
const MAX_HISTORY = 8;

function loadHistory(): string[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]"); } catch { return []; }
}
function saveHistory(q: string) {
  const prev = loadHistory().filter(h => h !== q);
  localStorage.setItem(HISTORY_KEY, JSON.stringify([q, ...prev].slice(0, MAX_HISTORY)));
}

export default function PdfSearch({ filePath, totalPages, onJumpToPage, onQueryChange, onClose }: PdfSearchProps) {
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [current, setCurrent] = useState(0);
  const [searching, setSearching] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<string[]>(loadHistory);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    pdfjsLib.getDocument(filePath).promise.then(doc => { pdfRef.current = doc; }).catch(() => {});
    return () => { pdfRef.current?.destroy(); pdfRef.current = null; };
  }, [filePath]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "Enter" && matches.length > 0 && document.activeElement === inputRef.current) {
        e.preventDefault();
        if (e.shiftKey) goToPrev(); else goToNext();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [matches, current]);

  const doSearch = useCallback(async (q: string, cs: boolean, ww: boolean) => {
    if (!pdfRef.current || q.trim().length < 2) { setMatches([]); setSearching(false); return; }
    setSearching(true);
    cancelRef.current = false;
    const doc = pdfRef.current;
    const found: SearchMatch[] = [];
    let idx = 0;

    // Build page text cache for this file if not already cached
    const cached = textCache.get(filePath);
    if (!cached) {
      evictCacheIfNeeded(totalPages);
      const pages: string[] = new Array(totalPages).fill("");
      for (let p = 1; p <= totalPages; p++) {
        if (cancelRef.current) break;
        try {
          const page = await doc.getPage(p);
          const content = await page.getTextContent();
          pages[p - 1] = content.items.map((item: any) => item.str).join(" ");
          page.cleanup();
        } catch {}
      }
      if (!cancelRef.current) {
        textCache.set(filePath, pages);
        cachedPageCount += pages.length;
      }
    }

    const pageTexts = textCache.get(filePath) ?? [];

    for (let p = 1; p <= totalPages; p++) {
      if (cancelRef.current) break;
      const text = pageTexts[p - 1] ?? "";
      if (!text) continue;
      const searchText = cs ? text : text.toLowerCase();
      const searchQ = cs ? q : q.toLowerCase();
      const re = ww ? new RegExp(`\\b${searchQ.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, cs ? "g" : "gi") : null;

      if (re) {
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
          const pos = m.index;
          const start = Math.max(0, pos - 50);
          const end = Math.min(text.length, pos + q.length + 50);
          const snippet = (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
          found.push({ page: p, snippet, matchIndex: idx++ });
        }
      } else {
        let pos = 0;
        while ((pos = searchText.indexOf(searchQ, pos)) !== -1) {
          const start = Math.max(0, pos - 50);
          const end = Math.min(text.length, pos + q.length + 50);
          const snippet = (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
          found.push({ page: p, snippet, matchIndex: idx++ });
          pos += searchQ.length;
        }
      }
    }

    if (!cancelRef.current) {
      setMatches(found);
      setCurrent(0);
      if (found.length > 0) onJumpToPage(found[0].page);
      if (found.length > 0) { saveHistory(q); setHistory(loadHistory()); }
    }
    setSearching(false);
  }, [totalPages, onJumpToPage]);

  function triggerSearch(q: string, cs: boolean, ww: boolean) {
    cancelRef.current = true;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 2) { setMatches([]); return; }
    debounceRef.current = setTimeout(() => doSearch(q, cs, ww), 350);
  }

  function handleQueryChange(q: string) {
    setQuery(q);
    onQueryChange(q);
    setShowHistory(q.length === 0);
    triggerSearch(q, caseSensitive, wholeWord);
  }

  function toggleCase() {
    const next = !caseSensitive;
    setCaseSensitive(next);
    triggerSearch(query, next, wholeWord);
  }

  function toggleWholeWord() {
    const next = !wholeWord;
    setWholeWord(next);
    triggerSearch(query, caseSensitive, next);
  }

  function pickHistory(h: string) {
    setQuery(h);
    onQueryChange(h);
    setShowHistory(false);
    triggerSearch(h, caseSensitive, wholeWord);
    inputRef.current?.focus();
  }

  function goToNext() {
    if (matches.length === 0) return;
    const next = (current + 1) % matches.length;
    setCurrent(next);
    onJumpToPage(matches[next].page);
    scrollMatchIntoView(next);
  }

  function goToPrev() {
    if (matches.length === 0) return;
    const prev = (current - 1 + matches.length) % matches.length;
    setCurrent(prev);
    onJumpToPage(matches[prev].page);
    scrollMatchIntoView(prev);
  }

  function scrollMatchIntoView(idx: number) {
    const el = listRef.current?.querySelector(`[data-idx="${idx}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  // Group matches by page
  const pageGroups: PageGroup[] = [];
  for (const m of matches) {
    const last = pageGroups[pageGroups.length - 1];
    if (last && last.page === m.page) last.matches.push(m);
    else pageGroups.push({ page: m.page, matches: [m] });
  }

  const hasResults = matches.length > 0;
  const isEmpty = query.trim().length >= 2 && !searching && matches.length === 0;
  const showHistoryDropdown = showHistory && history.length > 0 && !hasResults && !searching;

  return (
    <div
      style={{
        position: "absolute",
        top: 16, left: 0, right: 0,
        marginLeft: "auto", marginRight: "auto",
        zIndex: 100,
        width: 460,
        background: "var(--bg-raised)",
        border: "1px solid var(--border-default)",
        borderRadius: 12,
        boxShadow: "0 8px 32px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.3)",
        overflow: "hidden",
        animation: "pageEnter 0.18s cubic-bezier(0.16,1,0.3,1) both",
      }}
    >
      {/* ── Input row ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 10px", borderBottom: hasResults || isEmpty || showHistoryDropdown ? "1px solid var(--border-faint)" : "none" }}>
        <Search size={13} color="var(--text-dim)" strokeWidth={2} style={{ flexShrink: 0, marginLeft: 2 }} />
        <input
          ref={inputRef}
          value={query}
          onChange={e => handleQueryChange(e.target.value)}
          onFocus={() => { if (query.length === 0) setShowHistory(true); }}
          onBlur={() => setTimeout(() => setShowHistory(false), 150)}
          placeholder="Search in document…"
          style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontSize: 13, color: "var(--text-white)", fontFamily: "inherit" }}
        />

        {/* Case sensitive toggle */}
        <Tooltip label="Case sensitive">
          <button
            onClick={toggleCase}
            style={{ ...toggleBtnStyle, background: caseSensitive ? "rgba(107,140,255,0.2)" : "transparent", color: caseSensitive ? "#6b8cff" : "var(--text-dim)", border: `1px solid ${caseSensitive ? "rgba(107,140,255,0.4)" : "transparent"}` }}
          >
            Aa
          </button>
        </Tooltip>

        {/* Whole word toggle */}
        <Tooltip label="Whole word only">
          <button
            onClick={toggleWholeWord}
            style={{ ...toggleBtnStyle, background: wholeWord ? "rgba(107,140,255,0.2)" : "transparent", color: wholeWord ? "#6b8cff" : "var(--text-dim)", border: `1px solid ${wholeWord ? "rgba(107,140,255,0.4)" : "transparent"}`, fontFamily: "serif", fontStyle: "italic" }}
          >
            W
          </button>
        </Tooltip>

        <div style={{ width: 1, height: 14, background: "var(--border-faint)", flexShrink: 0 }} />

        {/* Match counter */}
        {hasResults && (
          <span style={{ fontSize: 11, color: "var(--text-dim)", whiteSpace: "nowrap", flexShrink: 0 }}>
            {current + 1}/{matches.length}
          </span>
        )}
        {searching && <span style={{ fontSize: 11, color: "var(--text-dim)", flexShrink: 0 }}>searching…</span>}

        {hasResults && (
          <>
            <Tooltip label="Previous (Shift+Enter)">
              <button onClick={goToPrev} style={navBtnStyle}><ChevronUp size={12} strokeWidth={2.5} /></button>
            </Tooltip>
            <Tooltip label="Next (Enter)">
              <button onClick={goToNext} style={navBtnStyle}><ChevronDown size={12} strokeWidth={2.5} /></button>
            </Tooltip>
          </>
        )}
        <Tooltip label="Close (Esc)">
          <button onClick={onClose} style={navBtnStyle}><X size={12} strokeWidth={2.5} /></button>
        </Tooltip>
      </div>

      {/* ── Search history dropdown ── */}
      {showHistoryDropdown && (
        <div style={{ padding: "4px 0" }}>
          <div style={{ padding: "4px 12px 2px", fontSize: 10, fontWeight: 600, color: "var(--text-dim)", letterSpacing: "0.06em", display: "flex", alignItems: "center", gap: 5 }}>
            <Clock size={10} /> RECENT
          </div>
          {history.map((h, i) => (
            <div
              key={i}
              onMouseDown={() => pickHistory(h)}
              style={{ padding: "6px 12px", fontSize: 12, color: "var(--text-primary)", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}
            >
              <Search size={10} color="var(--text-dim)" strokeWidth={2} style={{ flexShrink: 0 }} />
              {h}
            </div>
          ))}
        </div>
      )}

      {/* ── No results ── */}
      {isEmpty && (
        <div style={{ padding: "10px 14px", fontSize: 12, color: "var(--text-dim)" }}>
          No results for "{query}"
          {(caseSensitive || wholeWord) && (
            <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>
              ({[caseSensitive && "case sensitive", wholeWord && "whole word"].filter(Boolean).join(", ")})
            </span>
          )}
        </div>
      )}

      {/* ── Results grouped by page ── */}
      {hasResults && (
        <div ref={listRef} style={{ maxHeight: 300, overflowY: "auto", padding: "4px 0" }}>
          {pageGroups.map(group => (
            <div key={group.page}>
              {/* Page header */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 12px 3px", position: "sticky", top: 0, background: "var(--bg-raised)", zIndex: 1 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-dim)", letterSpacing: "0.06em" }}>PAGE {group.page}</span>
                <div style={{ flex: 1, height: 1, background: "var(--border-faint)" }} />
                <span style={{
                  fontSize: 9, fontWeight: 600, padding: "1px 6px", borderRadius: 10,
                  background: "rgba(107,140,255,0.15)", color: "#6b8cff",
                }}>
                  {group.matches.length} {group.matches.length === 1 ? "match" : "matches"}
                </span>
              </div>

              {/* Snippets */}
              {group.matches.map((m) => (
                <div
                  key={m.matchIndex}
                  data-idx={m.matchIndex}
                  onClick={() => { setCurrent(m.matchIndex); onJumpToPage(m.page); }}
                  style={{
                    padding: "5px 14px 5px 12px",
                    cursor: "pointer",
                    background: m.matchIndex === current ? "var(--bg-active)" : "transparent",
                    borderLeft: m.matchIndex === current ? "2px solid #6b8cff" : "2px solid transparent",
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={e => { if (m.matchIndex !== current) (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)"; }}
                  onMouseLeave={e => { if (m.matchIndex !== current) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                >
                  <div style={{ fontSize: 12, color: "var(--text-primary)", lineHeight: 1.5, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" } as React.CSSProperties}>
                    <HighlightedSnippet text={m.snippet} query={query} caseSensitive={caseSensitive} />
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const navBtnStyle: React.CSSProperties = {
  width: 22, height: 22, borderRadius: 5, flexShrink: 0,
  display: "flex", alignItems: "center", justifyContent: "center",
  background: "transparent", border: "none",
  color: "var(--text-dim)", cursor: "pointer",
};

const toggleBtnStyle: React.CSSProperties = {
  height: 22, padding: "0 6px", borderRadius: 5, flexShrink: 0,
  display: "flex", alignItems: "center", justifyContent: "center",
  fontSize: 11, fontWeight: 600, cursor: "pointer",
  letterSpacing: "0.01em",
};

function HighlightedSnippet({ text, query, caseSensitive }: { text: string; query: string; caseSensitive: boolean }) {
  if (!query.trim()) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  const searchText = caseSensitive ? text : text.toLowerCase();
  const searchQ = caseSensitive ? query : query.toLowerCase();
  let remaining = text;
  let searchRemaining = searchText;
  let key = 0;
  while (remaining.length > 0) {
    const idx = searchRemaining.indexOf(searchQ);
    if (idx === -1) { parts.push(remaining); break; }
    if (idx > 0) parts.push(remaining.slice(0, idx));
    parts.push(
      <mark key={key++} style={{ background: "rgba(107,140,255,0.35)", color: "var(--text-white)", borderRadius: 2, padding: "0 1px" }}>
        {remaining.slice(idx, idx + query.length)}
      </mark>
    );
    remaining = remaining.slice(idx + query.length);
    searchRemaining = searchRemaining.slice(idx + searchQ.length);
  }
  return <>{parts}</>;
}
