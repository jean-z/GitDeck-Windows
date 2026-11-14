// 平移 GitDeck Models.swift

export interface Repo {
  name: string;
  path: string;
  isManual: boolean;
  dirty?: boolean; // 运行时状态，不持久化
}

export type StatusKind = "M" | "A" | "D" | "R" | "C" | "T" | "?";

export const STATUS_LABEL: Record<StatusKind, string> = {
  M: "修改",
  A: "新增",
  D: "删除",
  R: "重命名",
  C: "复制",
  T: "类型变更",
  "?": "未跟踪",
};

export interface FileChange {
  path: string;
  staged: StatusKind | null;
  unstaged: StatusKind | null;
  isUntracked?: boolean;
  conflictCode?: string; // UU/AA/DD/AU/UA/DU/UD
}

export function fileBadge(c: FileChange): string {
  if (c.conflictCode) return c.conflictCode;
  if (c.isUntracked) return "??";
  const s = c.staged ? (c.staged === "?" ? " " : c.staged) : " ";
  const u = c.unstaged ? (c.unstaged === "?" ? " " : c.unstaged) : " ";
  return s + u;
}

export function fileKey(c: FileChange): string {
  return `${c.path}\u0001${c.staged ?? "-"}${c.unstaged ?? "-"}`;
}

export interface RepoStatus {
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  detached: boolean;
  conflicted: FileChange[];
  staged: FileChange[];
  unstaged: FileChange[];
  untracked: FileChange[];
}

export const emptyStatus = (): RepoStatus => ({
  branch: "",
  upstream: null,
  ahead: 0,
  behind: 0,
  detached: false,
  conflicted: [],
  staged: [],
  unstaged: [],
  untracked: [],
});

export interface BranchInfo {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  gone?: boolean;
}

export interface StashEntry {
  index: number;
  message: string;
}

export interface CommitEntry {
  id: string;
  shortHash: string;
  graph: string; // 行首 graph 线条原文（渲染时着色）
  author: string;
  date: Date;
  subject: string;
  refs: string[];
  source?: string; // --source %S 去前缀
}

export type LogRow =
  | { kind: "graph"; text: string }
  | { kind: "commit"; commit: CommitEntry };

export interface CommitFile {
  status: string;
  path: string;
}

export interface IncludedCommitEntry {
  hash: string;
  subject: string;
}

export interface CommitDetail {
  fullHash: string;
  author: string;
  date: Date;
  message: string;
  files: CommitFile[];
}

export type IncludedScope = "branchCommits" | "fullHistory" | "firstParentChain";

export type ChangeLocation = "staged" | "unstaged" | "untracked" | "conflict";

export type DiffScene = "working" | "commitFile";

export type ExpandDirection = "up" | "down";

// ---- Diff 分块（平移 SyntaxHighlight.swift）----

export interface LineInfo {
  old: number | null;
  new: number | null;
  text: string; // 含 +/-/空格 前缀的原始行
}

export interface ParsedHunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  newEnd: number;
  gutterWidth: number;
  lines: string[];
  numberedLines: LineInfo[];
  patch: string; // 文件头 + 本 hunk，可 git apply
}

export interface DiffHunkDisplay {
  id: number;
  title: string;
  patch: string;
  canRollback: boolean;
  canExpand: boolean;
  aboveLimit: number;
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
  aboveOffset: number;
  numberedLines: LineInfo[];
  gutterWidth: number;
  expandAbove: number;
  expandBelow: number;
  availableAbove: number | null;
  availableBelow: number | null;
}

/** 是否有展开的上下文（计算属性，等价 Swift isExpanded） */
export function hunkIsExpanded(h: DiffHunkDisplay): boolean {
  return h.expandAbove > 0 || h.expandBelow > 0;
}

// ---- 图片对比 ----

export interface ImageDiffData {
  path: string;
  oldSrc: string | null; // base64 data URL
  newSrc: string | null;
  note?: string;
}

// ---- 配置（平移 Config）----

export interface AppConfig {
  scanDirs: string[];
  manualRepos: string[];
  hiddenRepos: string[];
  practiceMode: boolean;
  lastRepoPath?: string;
  lastTab?: string;
}

export interface CommandRecord {
  id: number;
  command: string;
  directory: string;
  exitCode: number;
  output: string;
  isDangerous: boolean;
  date: Date;
}

// ---- Toast / Confirm ----

export interface ToastMessage {
  id: number;
  text: string;
  isError: boolean;
}

export interface ConfirmRequest {
  id: number;
  title: string;
  detail: string;
  command: string;
  action: () => void;
}
