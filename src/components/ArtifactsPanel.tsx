import { useEffect, useMemo, useState } from "react";
import { ExternalLink, BookOpen, Globe, FileText, Layers, X, Link, Box, Play } from "lucide-react";

// ── Brand SVG logos ───────────────────────────────────────────────────────────

function GitHubLogo({ size = 14, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

function HuggingFaceLogo({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 95 88" fill="none">
      <path d="M47.5 88C73.7 88 95 68.3 95 44S73.7 0 47.5 0 0 19.7 0 44s21.3 44 47.5 44z" fill="#FFD21E"/>
      <path d="M30.4 42.8c0 4.1-2.7 7.4-6 7.4s-6-3.3-6-7.4 2.7-7.4 6-7.4 6 3.3 6 7.4zM76.6 42.8c0 4.1-2.7 7.4-6 7.4s-6-3.3-6-7.4 2.7-7.4 6-7.4 6 3.3 6 7.4z" fill="#212121"/>
      <path d="M47.5 75c-10.5 0-19-5.4-19-12h38c0 6.6-8.5 12-19 12z" fill="#212121"/>
      <path d="M36 32c0-2.2 1.3-4 3-4s3 1.8 3 4-1.3 4-3 4-3-1.8-3-4zM53 32c0-2.2 1.3-4 3-4s3 1.8 3 4-1.3 4-3 4-3-1.8-3-4z" fill="#212121"/>
    </svg>
  );
}

function YoutubeLogo({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="5" fill="#FF0000"/>
      <polygon points="9.5,7 9.5,17 17,12" fill="white"/>
    </svg>
  );
}

function ArxivLogo({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <rect width="100" height="100" rx="12" fill="#B31B1B"/>
      <text x="50" y="68" textAnchor="middle" fill="white" fontSize="48" fontWeight="bold" fontFamily="serif">ar</text>
    </svg>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Category = "project" | "github" | "youtube" | "huggingface" | "dataset" | "paper" | "docs" | "web";

interface ParsedMeta {
  // GitHub
  owner?: string;
  repo?: string;
  // GitHub Pages / project pages
  pageOwner?: string;
  // HuggingFace
  hfType?: "model" | "space" | "dataset" | "org";
  hfId?: string;
  // arXiv
  arxivId?: string;
  // YouTube
  videoId?: string;
}

interface Artifact {
  url: string;
  label: string;
  sublabel?: string;
  category: Category;
  meta: ParsedMeta;
}

const CATEGORY_META: Record<Category, { label: string; color: string }> = {
  project:     { label: "Project Pages", color: "#a78bfa" },
  github:      { label: "GitHub",        color: "#e6edf3" },
  youtube:     { label: "YouTube",       color: "#FF4444" },
  huggingface: { label: "Hugging Face",  color: "#FFD21E" },
  dataset:     { label: "Datasets",      color: "#4A9B7F" },
  paper:       { label: "Papers",        color: "#7EB8F7" },
  docs:        { label: "Docs",          color: "#4A7AB0" },
  web:         { label: "Web",           color: "#8c8c8c" },
};

// ── arXiv title cache ─────────────────────────────────────────────────────────
const arxivTitleCache = new Map<string, string>();

async function fetchArxivTitle(arxivId: string): Promise<string | null> {
  if (arxivTitleCache.has(arxivId)) return arxivTitleCache.get(arxivId)!;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const title = await invoke<string>("fetch_arxiv_title", { arxivId });
    if (title) {
      arxivTitleCache.set(arxivId, title);
      return title;
    }
  } catch {}
  return null;
}

// ── Parsing ───────────────────────────────────────────────────────────────────

function parseArtifact(url: string): Artifact {
  const label = labelFor(url);
  const category = categorize(url);
  const meta = parseMeta(url, category);
  const sublabel = subLabelFor(url, category, meta);
  return { url, label, sublabel, category, meta };
}

function parseMeta(url: string, category: Category): ParsedMeta {
  try {
    const u = new URL(url);
    if (category === "project") {
      // owner.github.io[/repo]
      const owner = u.hostname.split(".")[0];
      const repo = u.pathname.split("/").filter(Boolean)[0];
      return { pageOwner: owner, repo };
    }
    if (category === "github") {
      const parts = u.pathname.split("/").filter(Boolean);
      return { owner: parts[0], repo: parts[1] };
    }
    if (category === "youtube") {
      // youtube.com/watch?v=ID or youtu.be/ID
      const videoId = u.searchParams.get("v") ?? (u.hostname === "youtu.be" ? u.pathname.slice(1) : undefined) ?? undefined;
      return { videoId };
    }
    if (category === "huggingface") {
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts[0] === "spaces")   return { hfType: "space",   hfId: parts.slice(1, 3).join("/") };
      if (parts[0] === "datasets") return { hfType: "dataset", hfId: parts.slice(1, 3).join("/") };
      if (parts[0] === "models" || parts.length === 0) return { hfType: "model", hfId: parts.slice(0).join("/") };
      if (parts.length === 1)      return { hfType: "org",     hfId: parts[0] };
      return { hfType: "model", hfId: parts.slice(0, 2).join("/") };
    }
    if (category === "paper") {
      const m = url.match(/(\d{4}\.\d{4,5})/);
      if (m) return { arxivId: m[1] };
    }
  } catch {}
  return {};
}

function categorize(url: string): Category {
  const u = url.toLowerCase();
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.endsWith(".github.io")) return "project";
    if (host === "youtube.com" || host === "www.youtube.com" || host === "youtu.be") return "youtube";
  } catch {}
  if (u.includes("github.com") || u.includes("gitlab.com") || u.includes("bitbucket.org")) return "github";
  if (u.includes("huggingface.co")) return "huggingface";
  if (
    u.includes("kaggle.com") || u.includes("zenodo.org") ||
    u.includes("figshare.com") || u.includes("data.gov") ||
    u.includes("openml.org") || u.includes("paperswithcode.com/dataset")
  ) return "dataset";
  if (
    u.includes("arxiv.org") || u.includes("semanticscholar.org") ||
    u.includes("scholar.google") || u.includes("aclanthology.org") ||
    u.includes("openreview.net") || u.includes("paperswithcode.com") ||
    u.includes("doi.org") || u.includes("acm.org/doi") || u.includes("ieee.org")
  ) return "paper";
  if (
    u.includes("docs.") || u.includes("/docs/") || u.includes("readthedocs.io") ||
    u.includes("developer.") || u.includes("/reference/") ||
    u.includes("pytorch.org") || u.includes("tensorflow.org") ||
    u.includes("scikit-learn.org") || u.includes("numpy.org") || u.includes("pandas.pydata.org")
  ) return "docs";
  return "web";
}


function labelFor(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    if (u.hostname.endsWith(".github.io")) {
      const owner = u.hostname.split(".")[0];
      return parts.length > 0 ? parts[0] : `${owner}.github.io`;
    }
    if (u.hostname === "youtube.com" || u.hostname === "www.youtube.com") {
      return u.searchParams.get("v") ?? u.pathname.slice(1) ?? "YouTube";
    }
    if (u.hostname === "youtu.be") {
      return u.pathname.slice(1) || "YouTube";
    }
    if (u.hostname === "github.com" || u.hostname === "gitlab.com") {
      if (parts.length >= 2) return parts[1];
      if (parts.length === 1) return parts[0];
    }
    if (u.hostname === "huggingface.co") {
      if (parts[0] === "spaces" || parts[0] === "datasets" || parts[0] === "models") {
        return parts.slice(1).join("/") || parts[0];
      }
      if (parts.length >= 2) return parts.slice(0, 2).join("/");
      return parts[0] || "huggingface.co";
    }
    if (u.hostname === "arxiv.org") {
      const m = u.pathname.match(/(\d{4}\.\d{4,5})/);
      if (m) return m[1];
    }
    const seg = parts[0];
    return seg ? `${u.hostname}/${seg}` : u.hostname;
  } catch {
    return url.slice(0, 40);
  }
}

function subLabelFor(url: string, category: Category, meta: ParsedMeta): string | undefined {
  if (category === "project") return meta.pageOwner ? `${meta.pageOwner}.github.io` : undefined;
  if (category === "github" && meta.owner) return meta.owner;
  if (category === "youtube") return "youtube.com";
  if (category === "huggingface") {
    const typeLabel = { model: "Model", space: "Space", dataset: "Dataset", org: "Organization" };
    return meta.hfType ? typeLabel[meta.hfType] : undefined;
  }
  if (category === "paper" && meta.arxivId) return `arXiv:${meta.arxivId}`;
  try {
    return new URL(url).hostname;
  } catch { return undefined; }
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ArtifactsPanel({ urls, onClose }: { urls: string[]; onClose: () => void }) {
  const [activeCategory, setActiveCategory] = useState<Category | "all">("all");

  const artifacts = useMemo(() => urls.map(parseArtifact), [urls]);

  const grouped = (Object.keys(CATEGORY_META) as Category[]).reduce((acc, cat) => {
    acc[cat] = artifacts.filter(a => a.category === cat);
    return acc;
  }, {} as Record<Category, Artifact[]>);

  const catCounts = (Object.keys(CATEGORY_META) as Category[])
    .filter(c => grouped[c].length > 0);

  const displayed = activeCategory === "all"
    ? artifacts
    : grouped[activeCategory] ?? [];

  function openUrl(url: string) {
    import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(url)).catch(() => {});
  }

  return (
    <div style={{
      width: 296, flexShrink: 0,
      borderLeft: "1px solid var(--border-faint)",
      background: "var(--bg-sidebar)",
      display: "flex", flexDirection: "column",
      overflow: "hidden",
      animation: "slideInFromRight 180ms var(--ease-out) both",
    }}>
      {/* Header */}
      <div style={{
        padding: "11px 14px",
        borderBottom: "1px solid var(--border-faint)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <Layers size={12} color="var(--text-dim)" strokeWidth={2} />
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", letterSpacing: "-0.01em" }}>
            Artifacts
          </span>
          {artifacts.length > 0 && (
            <span style={{
              fontSize: 10, fontWeight: 600, color: "var(--text-muted)",
              background: "var(--bg-active)", border: "1px solid var(--border-faint)",
              borderRadius: 4, padding: "1px 5px",
            }}>{artifacts.length}</span>
          )}
        </div>
        <button onClick={onClose} style={{
          width: 22, height: 22, borderRadius: 5,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "var(--text-muted)", background: "transparent",
          transition: "background var(--duration-fast), color var(--duration-fast)",
        }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)"; (e.currentTarget as HTMLElement).style.color = "var(--text-white)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}
        ><X size={11} strokeWidth={2.5} /></button>
      </div>

      {/* Category tabs */}
      {catCounts.length > 1 && (
        <div style={{
          padding: "8px 10px", borderBottom: "1px solid var(--border-faint)",
          display: "flex", gap: 4, flexWrap: "wrap", flexShrink: 0,
        }}>
          <TabPill active={activeCategory === "all"} onClick={() => setActiveCategory("all")} color="var(--text-dim)">
            All
          </TabPill>
          {catCounts.map(cat => (
            <TabPill key={cat} active={activeCategory === cat} onClick={() => setActiveCategory(cat)} color={CATEGORY_META[cat].color}>
              <CategoryIcon cat={cat} size={9} />
              {CATEGORY_META[cat].label}
              <span style={{ opacity: 0.6 }}>{grouped[cat].length}</span>
            </TabPill>
          ))}
        </div>
      )}

      {/* List */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0 16px" }}>
        {artifacts.length === 0 ? <EmptyMsg /> : (
          activeCategory === "all" ? (
            catCounts.map(cat => (
              <Section key={cat} cat={cat} items={grouped[cat]} onOpen={openUrl} />
            ))
          ) : (
            displayed.map((a, i) => <ArtifactCard key={i} artifact={a} onOpen={openUrl} />)
          )
        )}
      </div>
    </div>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────

function Section({ cat, items, onOpen }: { cat: Category; items: Artifact[]; onOpen: (url: string) => void }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "8px 14px 5px",
      }}>
        <CategoryIcon cat={cat} size={11} color={CATEGORY_META[cat].color} />
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase",
          color: CATEGORY_META[cat].color,
        }}>{CATEGORY_META[cat].label}</span>
        <span style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 600 }}>{items.length}</span>
      </div>
      {items.map((a, i) => <ArtifactCard key={i} artifact={a} onOpen={onOpen} />)}
    </div>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────────

function ArtifactCard({ artifact, onOpen }: { artifact: Artifact; onOpen: (url: string) => void }) {
  const [hov, setHov] = useState(false);
  const [arxivTitle, setArxivTitle] = useState<string | null>(
    artifact.meta.arxivId ? (arxivTitleCache.get(artifact.meta.arxivId) ?? null) : null
  );
  const isGitHub = artifact.category === "github" || artifact.category === "project";
  const isHF = artifact.category === "huggingface";

  useEffect(() => {
    if (artifact.meta.arxivId && !arxivTitle) {
      fetchArxivTitle(artifact.meta.arxivId).then(t => { if (t) setArxivTitle(t); });
    }
  }, [artifact.meta.arxivId]);

  const displayLabel = arxivTitle ?? artifact.label;
  const isMultiLine = !!arxivTitle;

  return (
    <div
      onClick={() => onOpen(artifact.url)}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex", alignItems: isMultiLine ? "flex-start" : "center", gap: 10,
        padding: "8px 14px",
        cursor: "pointer",
        background: hov ? "var(--bg-raised)" : "transparent",
        transition: "background var(--duration-fast) var(--ease-out)",
      }}
    >
      {/* Logo/icon */}
      <div style={{
        width: 28, height: 28, borderRadius: 7, flexShrink: 0,
        marginTop: isMultiLine ? 1 : 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: isGitHub ? "#161b22" : isHF ? "#fff8dc" : artifact.category === "youtube" ? "#1a0000" : "var(--bg-active)",
        border: `1px solid ${isGitHub ? "rgba(255,255,255,0.1)" : isHF ? "rgba(255,210,30,0.3)" : artifact.category === "youtube" ? "rgba(255,68,68,0.25)" : "var(--border-faint)"}`,
      }}>
        <CardIcon artifact={artifact} />
      </div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12, fontWeight: 500,
          color: hov ? "var(--text-white)" : "var(--text-primary)",
          letterSpacing: "-0.01em",
          lineHeight: 1.35,
          // Multi-line for paper titles, single-line truncate for others
          ...(isMultiLine ? {
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          } : {
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }),
          transition: "color var(--duration-fast) var(--ease-out)",
        } as React.CSSProperties}>
          {displayLabel}
        </div>
        {artifact.sublabel && (
          <div style={{
            fontSize: 10, color: "var(--text-muted)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            marginTop: 2, lineHeight: 1.2,
          }}>
            {artifact.sublabel}
          </div>
        )}
      </div>

      <ExternalLink size={10} strokeWidth={2}
        color={hov ? "var(--text-dim)" : "transparent"}
        style={{ flexShrink: 0, marginTop: isMultiLine ? 2 : 0, transition: "color var(--duration-fast)" }}
      />
    </div>
  );
}

function CardIcon({ artifact }: { artifact: Artifact }) {
  if (artifact.category === "project") return <GitHubLogo size={14} color={CATEGORY_META.project.color} />;
  if (artifact.category === "github") return <GitHubLogo size={14} color="#e6edf3" />;
  if (artifact.category === "youtube") return <YoutubeLogo size={16} />;
  if (artifact.category === "huggingface") return <HuggingFaceLogo size={16} />;
  if (artifact.category === "paper") {
    if (artifact.url.includes("arxiv.org")) return <ArxivLogo size={14} />;
    return <BookOpen size={12} strokeWidth={1.8} color={CATEGORY_META.paper.color} />;
  }
  if (artifact.category === "dataset") return <Box size={12} strokeWidth={1.8} color={CATEGORY_META.dataset.color} />;
  if (artifact.category === "docs") return <FileText size={12} strokeWidth={1.8} color={CATEGORY_META.docs.color} />;
  return <Globe size={12} strokeWidth={1.8} color="var(--text-muted)" />;
}

function CategoryIcon({ cat, size = 11, color }: { cat: Category; size?: number; color?: string }) {
  const c = color ?? CATEGORY_META[cat].color;
  if (cat === "project") return <GitHubLogo size={size} color={c} />;
  if (cat === "github") return <GitHubLogo size={size} color={c} />;
  if (cat === "youtube") return <Play size={size} strokeWidth={2} color={c} />;
  if (cat === "huggingface") return <HuggingFaceLogo size={size} />;
  if (cat === "paper") return <BookOpen size={size} strokeWidth={2} color={c} />;
  if (cat === "dataset") return <Box size={size} strokeWidth={2} color={c} />;
  if (cat === "docs") return <FileText size={size} strokeWidth={2} color={c} />;
  return <Globe size={size} strokeWidth={2} color={c} />;
}

// ── Misc ──────────────────────────────────────────────────────────────────────

function TabPill({ active, onClick, color, children }: {
  active: boolean; onClick: () => void; color: string; children: React.ReactNode
}) {
  return (
    <button onClick={onClick} style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "3px 8px", borderRadius: 5,
      fontSize: 10, fontWeight: 600, cursor: "pointer",
      background: active ? color + "18" : "transparent",
      border: `1px solid ${active ? color + "44" : "var(--border-faint)"}`,
      color: active ? color : "var(--text-muted)",
      transition: "all var(--duration-fast) var(--ease-out)",
    }}>
      {children}
    </button>
  );
}


function EmptyMsg() {
  return (
    <div style={{
      padding: "48px 20px", textAlign: "center",
      display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
    }}>
      <Link size={20} strokeWidth={1.5} color="var(--text-muted)" />
      <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-dim)" }}>No links found</div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6 }}>
        This PDF doesn't contain<br />any extractable URLs.
      </div>
    </div>
  );
}
