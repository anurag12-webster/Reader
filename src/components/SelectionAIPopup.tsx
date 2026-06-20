import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import {
  Send, Copy, RotateCcw, RefreshCw, AlertCircle,
  Zap, BookOpen, Languages, FlaskConical, X,
} from "lucide-react";
import Tooltip from "./Tooltip";
import SafeMarkdown, { aiMdStyles } from "./ai/MarkdownRenderer";
import RadarLoader, { radarKeyframes } from "./ai/RadarLoader";
import ModelSelector from "./ai/ModelSelector";
import { checkOllama, streamChat } from "./ai/ollama";
import type { OllamaStatus } from "./ai/ollama";
import { iconBtnStyle, pillBtnStyle } from "../ui";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SelectionAIPopupProps {
  selectedText: string;
  anchorRect: DOMRect;
  onClose: () => void;
  translateLanguage?: string;
}

interface Message { role: "user" | "assistant"; content: string; action?: string; }

// ── Quick actions ─────────────────────────────────────────────────────────────

const QUICK_ACTIONS: { label: string; icon: React.ReactNode; prompt: string }[] = [
  {
    label: "TL;DR",
    icon: <Zap size={11} strokeWidth={2} />,
    prompt: "Give a single-sentence summary of the following text. Be brutally concise — one sentence, no fluff, no intro like 'This text says'. Just the summary:",
  },
  {
    label: "Explain",
    icon: <BookOpen size={11} strokeWidth={2} />,
    prompt: "Explain the following text to someone unfamiliar with the topic. Break down any technical terms, clarify the core idea, and use plain language. Be thorough but concise:",
  },
  {
    label: "Translate",
    icon: <Languages size={11} strokeWidth={2} />,
    prompt: "", // filled dynamically from translateLanguage prop
  },
  {
    label: "Simplify",
    icon: <FlaskConical size={11} strokeWidth={2} />,
    prompt: "Rewrite the following text at a high school reading level. Remove all jargon, acronyms, and complex sentence structures. Keep the meaning identical but make it easy to read:",
  },
];

const SYSTEM_PROMPT =
  "You are a helpful reading assistant. The user has selected text from a PDF. Be concise and clear. " +
  "IMPORTANT: Always render mathematical expressions using LaTeX syntax — inline math with $...$ and display/block math with $$...$$. " +
  "Never write math as plain text or in code blocks.";

const POPUP_W = 460;

// ── Component ─────────────────────────────────────────────────────────────────

export default function SelectionAIPopup({
  selectedText, anchorRect, onClose, translateLanguage = "English",
}: SelectionAIPopupProps) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [error, setError] = useState(false);
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0, flip: false });
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus>("loading");

  const popupRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const responseRef = useRef<HTMLDivElement>(null);
  const modelBtnRef = useRef<HTMLButtonElement>(null);
  const savedRangeRef = useRef<Range | null>(null);
  // Refs to avoid stale closures in async callbacks
  const messagesRef = useRef<Message[]>([]);
  const lastQuestionRef = useRef<{ question: string; actionLabel?: string } | null>(null);

  // ── Positioning ────────────────────────────────────────────────────────────

  const reposition = useCallback(() => {
    const el = popupRef.current;
    if (!el) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const popupH = el.getBoundingClientRect().height;
    const GAP = 12;
    let x = anchorRect.left + anchorRect.width / 2 - POPUP_W / 2;
    x = Math.max(8, Math.min(x, vw - POPUP_W - 8));
    let y = anchorRect.top - popupH - GAP;
    const flip = y < 8;
    if (flip) y = anchorRect.bottom + GAP;
    y = Math.max(8, Math.min(y, vh - popupH - 8));
    setPos({ x, y, flip });
  }, [anchorRect]);

  // Initial position after first paint
  useEffect(() => {
    const id = requestAnimationFrame(reposition);
    return () => cancelAnimationFrame(id);
  }, [reposition]);

  // Reposition whenever popup size changes (streaming text, status changes, etc.)
  useEffect(() => {
    if (!popupRef.current) return;
    const observer = new ResizeObserver(() => reposition());
    observer.observe(popupRef.current);
    return () => observer.disconnect();
  }, [reposition]);

  // ── Ollama ─────────────────────────────────────────────────────────────────

  const loadModels = useCallback(async () => {
    const result = await checkOllama();
    setOllamaStatus(result.status);
    if (result.status === "ready") {
      setModels(result.models);
      if (result.models.length > 0) setModel(m => m || result.models[0]);
    }
    return result.status;
  }, []);

  useEffect(() => { loadModels(); }, []);

  const handleStartOllama = async () => {
    setOllamaStatus("starting");
    const launched = await invoke<boolean>("start_ollama").catch(() => false);
    if (!launched) { setOllamaStatus("not_installed"); return; }
    for (let i = 0; i < 16; i++) {
      await new Promise(r => setTimeout(r, 500));
      const result = await checkOllama();
      if (result.status === "ready") {
        setOllamaStatus("ready");
        setModels(result.models);
        if (result.models.length > 0) setModel(m => m || result.models[0]);
        return;
      }
    }
    setOllamaStatus("not_running");
  };

  // ── Selection preservation ─────────────────────────────────────────────────

  // Save the PDF text selection range on mount before focus is stolen
  useEffect(() => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
  }, []);

  // Focus input once ready, then restore the PDF highlight
  useEffect(() => {
    if (ollamaStatus !== "ready") return;
    inputRef.current?.focus();
    const range = savedRangeRef.current;
    if (range) {
      const sel = window.getSelection();
      if (sel) { sel.removeAllRanges(); sel.addRange(range); }
    }
  }, [ollamaStatus]);

  // ── Global event handlers ──────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    function onDown(e: MouseEvent) {
      if (!popupRef.current) return;
      const target = e.target as Node;
      if (popupRef.current.contains(target)) return;
      if (modelBtnRef.current?.contains(target)) return;
      if ((target as HTMLElement).closest?.("[data-model-dropdown]")) return;
      onClose();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  // Auto-scroll response area while streaming
  useEffect(() => {
    if (streaming && responseRef.current) {
      responseRef.current.scrollTop = responseRef.current.scrollHeight;
    }
  }, [streamingText, streaming]);

  // ── Send ───────────────────────────────────────────────────────────────────

  const send = useCallback(async (overridePrompt?: string, actionLabel?: string) => {
    const question = (overridePrompt ?? input).trim();
    if (!question || !model || streaming) return;
    setInput("");
    setError(false);
    setStreaming(true);
    setStreamingText("");
    lastQuestionRef.current = { question, actionLabel };

    const userMsg: Message = { role: "user", content: question, action: actionLabel };
    const prevMessages = messagesRef.current;
    messagesRef.current = [...prevMessages, userMsg];
    setMessages(messagesRef.current);

    abortRef.current = new AbortController();
    try {
      const history = prevMessages.map(m => ({ role: m.role, content: m.content }));
      const acc = await streamChat({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...history,
          { role: "user", content: `${question}\n\n---\n${selectedText.slice(0, 3000)}` },
        ],
        signal: abortRef.current.signal,
        onChunk: setStreamingText,
      });
      const assistantMsg: Message = { role: "assistant", content: acc };
      messagesRef.current = [...messagesRef.current, assistantMsg];
      setMessages(messagesRef.current);
      setStreamingText("");
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== "AbortError") setError(true);
      messagesRef.current = messagesRef.current.slice(0, -1);
      setMessages(messagesRef.current);
    } finally {
      setStreaming(false);
    }
  }, [input, model, streaming, selectedText]);

  const stop = () => { abortRef.current?.abort(); setStreaming(false); setStreamingText(""); };

  const copyResponse = () => {
    const last = [...messages].reverse().find(m => m.role === "assistant");
    if (last) navigator.clipboard.writeText(last.content);
  };

  const reset = () => {
    messagesRef.current = [];
    setMessages([]);
    setStreamingText("");
    setError(false);
    setInput("");
    lastQuestionRef.current = null;
    inputRef.current?.focus();
  };

  const retry = () => {
    setError(false);
    const last = lastQuestionRef.current;
    if (last) send(last.question, last.actionLabel);
  };

  // ── Derived state ──────────────────────────────────────────────────────────

  const isReady = ollamaStatus === "ready" && models.length > 0;
  const hasMessages = messages.length > 0 || streaming;
  const lastAssistant = [...messages].reverse().find(m => m.role === "assistant");
  const activeAction = [...messages].reverse().find(m => m.role === "user" && m.action)?.action ?? null;
  const transformOrigin = pos.flip ? "top center" : "bottom center";

  // ── Render ─────────────────────────────────────────────────────────────────

  return createPortal(
    <div
      ref={popupRef}
      style={{
        position: "fixed", left: pos.x, top: pos.y, width: POPUP_W,
        zIndex: 99999,
        background: "var(--bg-raised)",
        border: "1px solid var(--border-default)",
        borderRadius: 12,
        boxShadow: "0 8px 32px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.3)",
        overflow: "visible",
        fontFamily: "var(--font-sans)",
        animation: "aiPopupIn 0.18s cubic-bezier(0.16,1,0.3,1) both",
        transformOrigin,
      }}
    >
      <style>{`
        @keyframes aiPopupIn {
          from { opacity: 0; transform: scale(0.96) translateY(${pos.flip ? "-" : ""}5px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes ai-spin { to { transform: rotate(360deg) } }
        ${radarKeyframes}
        ${aiMdStyles}
      `}</style>

      <div style={{ borderRadius: 12, overflow: "hidden" }}>

        {/* ── Close button when not ready ── */}
        {!isReady && (
          <div style={{ display: "flex", justifyContent: "flex-end", padding: "6px 8px 0" }}>
            <button onClick={onClose} style={iconBtnStyle}><X size={11} strokeWidth={2.5} /></button>
          </div>
        )}

        {/* ── Quick action chips ── */}
        {isReady && (
          <div style={{
            display: "flex", alignItems: "center", gap: 4, padding: "7px 8px 7px 10px",
            borderBottom: "1px solid var(--border-faint)",
          }}>
            {QUICK_ACTIONS.map(action => {
              const isActive = action.label === activeAction;
              const prompt = action.label === "Translate"
                ? `Translate the following text to ${translateLanguage}. Output only the translation, no explanations:`
                : action.prompt;
              return (
                <Tooltip key={action.label} label={action.label}>
                  <button
                    onClick={() => send(prompt, action.label)}
                    style={{
                      height: 26, borderRadius: 6, padding: isActive ? "0 8px 0 6px" : "0",
                      width: isActive ? "auto" : 26,
                      display: "flex", alignItems: "center", gap: 5, justifyContent: "center",
                      background: isActive ? "var(--bg-active)" : "transparent",
                      border: `1px solid ${isActive ? "var(--border-default)" : "transparent"}`,
                      color: isActive ? "var(--text-primary)" : "var(--text-dim)",
                      cursor: "pointer", transition: "all 120ms", flexShrink: 0,
                    }}
                    onMouseEnter={e => {
                      if (!isActive) {
                        const el = e.currentTarget as HTMLElement;
                        el.style.background = "var(--bg-active)";
                        el.style.borderColor = "var(--border-faint)";
                        el.style.color = "var(--text-primary)";
                      }
                    }}
                    onMouseLeave={e => {
                      if (!isActive) {
                        const el = e.currentTarget as HTMLElement;
                        el.style.background = "transparent";
                        el.style.borderColor = "transparent";
                        el.style.color = "var(--text-dim)";
                      }
                    }}
                  >
                    {action.icon}
                    {isActive && <span style={{ fontSize: 10.5, fontWeight: 500 }}>{action.label}</span>}
                  </button>
                </Tooltip>
              );
            })}
            <span style={{ flex: 1 }} />
            <button onClick={onClose} style={iconBtnStyle}><X size={11} strokeWidth={2.5} /></button>
          </div>
        )}

        {/* ── Chat thread ── */}
        {hasMessages && !error && (
          <div
            ref={responseRef}
            style={{
              padding: "8px 14px",
              fontSize: 12.5, color: "var(--text-primary)", lineHeight: 1.75,
              wordBreak: "break-word",
              maxHeight: 280, overflowY: "auto",
              display: "flex", flexDirection: "column", gap: 12,
            }}
          >
            {messages.map((msg, i) => (
              <div key={i}>
                {msg.role === "user" ? (
                  !msg.action && (
                    <div style={{ marginBottom: 4 }}>
                      <span style={{ fontSize: 11.5, color: "var(--text-dim)", fontStyle: "italic" }}>
                        {msg.content.slice(0, 60)}{msg.content.length > 60 ? "…" : ""}
                      </span>
                    </div>
                  )
                ) : (
                  <div className="ai-md">
                    <SafeMarkdown>{msg.content}</SafeMarkdown>
                  </div>
                )}
                {i < messages.length - 1 && msg.role === "assistant" && (
                  <div style={{ height: 1, background: "var(--border-faint)", margin: "8px 0 0" }} />
                )}
              </div>
            ))}

            {streaming && !streamingText && (
              <div style={{ padding: "4px 2px" }}><RadarLoader /></div>
            )}
            {streaming && streamingText && (
              <div className="ai-md"><SafeMarkdown>{streamingText}</SafeMarkdown></div>
            )}
          </div>
        )}

        {/* ── Error ── */}
        {error && (
          <div style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 8 }}>
            <AlertCircle size={13} strokeWidth={1.5} color="#f87171" />
            <span style={{ fontSize: 11, color: "var(--text-muted)", flex: 1 }}>Request failed. Is Ollama still running?</span>
            <button onClick={retry} style={pillBtnStyle}>
              <RefreshCw size={10} strokeWidth={2} /> Retry
            </button>
          </div>
        )}

        {/* ── Ollama not installed ── */}
        {ollamaStatus === "not_installed" && (
          <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <AlertCircle size={13} strokeWidth={1.5} color="var(--text-dim)" />
              <span style={{ fontSize: 12, color: "var(--text-primary)", fontWeight: 500 }}>Install Ollama to use AI</span>
            </div>
            <span style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6 }}>
              Ollama runs AI models locally. Install it, then pull a model:
            </span>
            <code style={codeStyle}>curl -fsSL https://ollama.com/install.sh | sh</code>
            <code style={codeStyle}>ollama pull llama3.2</code>
            <button onClick={() => loadModels()} style={{ ...pillBtnStyle, alignSelf: "flex-end" }}>
              <RefreshCw size={10} strokeWidth={2} /> Retry
            </button>
          </div>
        )}

        {/* ── Ollama not running ── */}
        {ollamaStatus === "not_running" && (
          <div style={{ padding: "18px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#f5c842", flexShrink: 0 }} />
              <span style={{ fontSize: 12.5, color: "var(--text-primary)", fontWeight: 500 }}>Ollama isn't running</span>
            </div>
            <span style={{ fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.65 }}>
              Start it below or run{" "}
              <code style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--text-dim)", background: "rgba(255,255,255,0.05)", padding: "1px 5px", borderRadius: 4 }}>
                ollama serve
              </code>{" "}
              in your terminal.
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={handleStartOllama} style={{
                flex: 1, padding: "7px 0", borderRadius: 7, fontSize: 11.5, fontWeight: 500,
                background: "rgba(74,155,127,0.12)", border: "1px solid rgba(74,155,127,0.25)", color: "#4A9B7F",
                cursor: "pointer", transition: "all 120ms",
              }}>
                Start Ollama
              </button>
              <button onClick={() => loadModels()} style={{
                padding: "7px 14px", borderRadius: 7, fontSize: 11.5,
                background: "var(--bg-active)", border: "1px solid var(--border-faint)", color: "var(--text-dim)",
                cursor: "pointer", display: "flex", alignItems: "center", gap: 5, transition: "all 120ms",
              }}>
                <RefreshCw size={10} strokeWidth={2} /> Retry
              </button>
            </div>
          </div>
        )}

        {/* ── Starting ── */}
        {ollamaStatus === "starting" && (
          <div style={{ padding: "18px 16px", display: "flex", alignItems: "center", gap: 10 }}>
            <RefreshCw size={12} strokeWidth={2} color="var(--text-muted)"
              style={{ animation: "ai-spin 0.8s linear infinite", flexShrink: 0 }} />
            <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>Starting Ollama…</span>
          </div>
        )}

        {/* ── No models ── */}
        {ollamaStatus === "ready" && models.length === 0 && (
          <div style={{ padding: "18px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={{ fontSize: 12.5, color: "var(--text-primary)", fontWeight: 500 }}>No models found</span>
            <code style={codeStyle}>ollama pull llama3.2</code>
            <button onClick={() => loadModels()} style={{ ...pillBtnStyle, alignSelf: "flex-end" }}>
              <RefreshCw size={10} strokeWidth={2} /> Retry
            </button>
          </div>
        )}

        {/* ── Composer row ── */}
        {isReady && (
          <div style={{
            display: "flex", alignItems: "center", gap: 6, padding: "8px 10px",
            borderTop: hasMessages || error ? "1px solid var(--border-faint)" : "none",
          }}>
            <input
              ref={inputRef}
              value={input}
              onFocus={() => {
                const sel = window.getSelection();
                sel?.removeAllRanges();
              }}
              onBlur={() => {
                const range = savedRangeRef.current;
                if (!range) return;
              
                const sel = window.getSelection();
                if (!sel) return;
              
                sel.removeAllRanges();
                sel.addRange(range);
              }}
              onChange={e => {
                setInput(e.target.value);
              }}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Ask anything about the selection…"
              disabled={streaming}
              style={{
                flex: 1, background: "transparent", border: "none", outline: "none",
                fontSize: 12.5, color: "var(--text-white)", fontFamily: "inherit",
                userSelect: "text", caretColor: "var(--text-white)",
              }}
            />

            {!streaming && lastAssistant && (
              <>
                <button onClick={copyResponse} style={iconBtnStyle} title="Copy response">
                  <Copy size={12} strokeWidth={2} />
                </button>
                <button onClick={reset} style={iconBtnStyle} title="Ask again">
                  <RotateCcw size={12} strokeWidth={2} />
                </button>
              </>
            )}

            <div style={{ width: 1, height: 14, background: "var(--border-faint)", flexShrink: 0 }} />

            <ModelSelector
              model={model} models={models}
              open={showModelMenu}
              onToggle={() => setShowModelMenu(v => !v)}
              onSelect={m => { setModel(m); setShowModelMenu(false); }}
              btnRef={modelBtnRef}
            />

            <button
              onClick={streaming ? stop : () => send()}
              style={{
                width: 22, height: 22, borderRadius: 5, flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: streaming ? "rgba(239,68,68,0.12)" : (input.trim() ? "var(--bg-active)" : "transparent"),
                border: `1px solid ${streaming ? "rgba(239,68,68,0.25)" : (input.trim() ? "var(--border-default)" : "transparent")}`,
                color: streaming ? "#f87171" : (input.trim() ? "var(--text-white)" : "var(--text-muted)"),
                cursor: streaming || input.trim() ? "pointer" : "default",
                transition: "all 120ms",
              }}
            >
              {streaming
                ? <div style={{ width: 7, height: 7, background: "currentColor", borderRadius: 1 }} />
                : <Send size={11} strokeWidth={2} />
              }
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// ── Shared inline styles ──────────────────────────────────────────────────────

const codeStyle: React.CSSProperties = {
  display: "block", fontFamily: "var(--font-mono)", fontSize: 11,
  background: "var(--bg-active)", border: "1px solid var(--border-faint)",
  borderRadius: 5, padding: "4px 8px", color: "var(--text-dim)",
};
