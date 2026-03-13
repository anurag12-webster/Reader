export type PdfTheme = "classic" | "dark" | "warm" | "blue";

export interface OutlineItem {
  title: string;
  dest: string | Array<unknown> | null;
  items: OutlineItem[];
}

export interface Annotation {
  id: string;
  type: "highlight" | "underline" | "note";
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  text?: string;
}

export interface PdfFile {
  id: string;
  name: string;
  path: string;
  diskPath: string;
  totalPages: number;
  currentPage: number;
  zoom: number;
  theme: PdfTheme;
  pageLayout: "single" | "double";
  rotation: number;
  annotations: Annotation[];
  outline: OutlineItem[];
  artifactUrls: string[];
}

export interface AppState {
  files: PdfFile[];
  activeFileId: string | null;
}

export interface Folder {
  id: string;
  name: string;
  createdAt: number;
  filePaths: string[];
}

export interface LibraryStore {
  completedPaths: string[];
  folders: Folder[];
  /** path → set of 1-based page numbers marked as read */
  readPages: Record<string, number[]>;
  /** disk path → annotations */
  annotations: Record<string, Annotation[]>;
}
