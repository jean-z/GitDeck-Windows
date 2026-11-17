// 平移 GitDeck AppState.swift：全局状态 + 动作。
// 事件式刷新约定保持一致：git 操作完成 / 终端回车 → 刷新当前视图。

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import {
  applyPatch,
  gitShowBase64,
  loadConfig,
  pathExists,
  readTextFile,
  readFileBase64,
  runGit,
  saveConfig,
  scanRepos,
} from "./core/git";
import {
  isImageFile,
  makeHunkDisplay,
  oldPathFromRawDiff,
  parseDiffHunks,
  rebuildExpanded,
  workingLinePatch,
} from "./core/diff";
import { parseBranches, parseLog, parseStashes, parseStatus, statusEquals } from "./core/parse";
import type {
  AppConfig,
  BranchInfo,
  ChangeLocation,
  CommitDetail,
  CommitEntry,
  CommitFile,
  CommandRecord,
  ConfirmRequest,
  DiffHunkDisplay,
  DiffScene,
  ExpandDirection,
  FileChange,
  ImageDiffData,
  IncludedCommitEntry,
  IncludedScope,
  LogRow,
  Repo,
  RepoStatus,
  StashEntry,
  ToastMessage,
} from "./core/types";
import { emptyStatus } from "./core/types";

const MAX_DIFF_LINES = 3000;

const DEFAULT_CONFIG: AppConfig = {
  scanDirs: [],
  manualRepos: [],
  hiddenRepos: [],
  practiceMode: false,
};

interface GitActionOpts {
  args?: string[];
  patch?: { text: string; reverse: boolean; cached: boolean };
  dangerous?: boolean;
  confirmTitle?: string;
  confirmDetail?: string;
  completion?: () => void;
}

interface AppStateStore {
  repos: Repo[];
  config: AppConfig;
  selectedRepoPath: string | null;
  status: RepoStatus;
  gitdeckIgnored: string[];
  diffText: string;
  diffFullText: string;
  diffTruncatedNote: string | null;
  diffHunks: DiffHunkDisplay[];
  imageDiff: ImageDiffData | null;
  selectedChangePath: string | null;
  selectedChangeKind: ChangeLocation | null;
  workingDiffIsCached: boolean;
  workingOldLines: string[] | null;
  commitOldLines: string[] | null;
  diffRequestSeq: number;
  commitMessage: string;
  amend: boolean;
  commitRows: LogRow[];
  logFilterText: string;
  logAuthorFilter: string | null;
  logBranchFilter: string | null;
  logFirstParentOnly: boolean;
  selectedCommit: CommitEntry | null;
  commitDetail: CommitDetail | null;
  commitFileHunks: DiffHunkDisplay[];
  commitFileOldPath: string | null;
  commitPreviewPath: string | null;
  commitImageDiff: ImageDiffData | null;
  selectedCommitIsMerge: boolean;
  selectedCommitFirstParent: string | null;
  includedScope: IncludedScope;
  includedCommits: IncludedCommitEntry[];
  expandedIncludedHash: string | null;
  includedHunks: DiffHunkDisplay[];
  includedLoading: boolean;
  branches: BranchInfo[];
  stashes: StashEntry[];
  currentTab: "changes" | "history" | "branches" | "stash";
  records: CommandRecord[];
  practiceMode: boolean;
  toasts: ToastMessage[];
  pendingConfirm: ConfirmRequest | null;
  lastAutoFollowedBranch: string;
  terminalReady: boolean;
  cwdInTerminal: string | null;

  init: () => Promise<void>;
  patchConfig: (patch: Partial<AppConfig>) => Promise<void>;
  reloadRepos: () => Promise<void>;
  selectRepo: (path: string) => Promise<void>;
  setTab: (t: AppStateStore["currentTab"]) => void;
  refreshAll: () => Promise<void>;
  refreshForCurrentTab: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  refreshBranches: () => Promise<void>;
  refreshStashes: () => Promise<void>;
  refreshLog: () => Promise<void>;
  setLogFilter: (text: string, author: string | null, branch: string | null, firstParentOnly: boolean) => Promise<void>;
  selectCommit: (c: CommitEntry) => Promise<void>;
  loadIncludedCommits: (hash: string, firstParent: string | null) => Promise<void>;
  loadCommitImageDiff: (f: CommitFile) => Promise<void>;
  loadCommitFileDiff: (f: CommitFile) => Promise<void>;
  applyExpand: (hunk: DiffHunkDisplay, direction: ExpandDirection, scene: DiffScene, oldLines: string[]) => void;
  applyIfSamePatch: (hunk: DiffHunkDisplay, scene: DiffScene) => void;
  loadDiffForCurrentSelection: () => Promise<void>;
  setIncludedScope: (s: IncludedScope) => Promise<void>;
  toggleIncludedCommit: (hash: string) => Promise<void>;
  selectCommitFile: (f: CommitFile) => Promise<void>;
  reloadCommitFileDiff: () => Promise<void>;
  loadDiff: (change: FileChange) => Promise<void>;
  clearDiffPanel: () => void;
  toggleExpandContext: (hunk: DiffHunkDisplay, direction: ExpandDirection, scene: DiffScene) => Promise<void>;
  collapseExpandContext: (hunk: DiffHunkDisplay, scene: DiffScene) => void;
  revertLine: (hunk: DiffHunkDisplay, displayIndex: number, scene: DiffScene) => Promise<void>;
  rollbackHunk: (hunk: DiffHunkDisplay) => Promise<void>;
  rollbackCommitHunk: (hunk: DiffHunkDisplay) => Promise<void>;
  gitAction: (opts: GitActionOpts) => Promise<void>;
  stage: (path: string) => Promise<void>;
  unstage: (path: string) => Promise<void>;
  stageAll: () => Promise<void>;
  discard: (path: string) => Promise<void>;
  discardAllChangesOfFile: (path: string) => Promise<void>;
  deleteUntrackedFile: (path: string) => Promise<void>;
  untrackFile: (path: string) => Promise<void>;
  gitdeckIgnoreFile: (path: string) => void;
  gitdeckUnignore: (path: string) => void;
  commit: (message: string, amend: boolean) => Promise<void>;
  stashPush: (includeUntracked: boolean, message: string) => Promise<void>;
  stashPop: (s: StashEntry) => Promise<void>;
  stashApply: (s: StashEntry) => Promise<void>;
  stashDrop: (s: StashEntry) => Promise<void>;
  checkoutBranch: (b: BranchInfo) => Promise<void>;
  deleteBranch: (b: BranchInfo, force: boolean) => Promise<void>;
  renameBranch: (b: BranchInfo, newName: string) => Promise<void>;
  showToast: (text: string, isError: boolean) => void;
  setConfirm: (r: ConfirmRequest | null) => void;
  setCommitMessage: (m: string) => void;
  setAmend: (v: boolean) => void;
  setPracticeMode: (on: boolean) => Promise<void>;
  onTerminalReturn: () => void;
  cdTerminal: (path: string) => Promise<void>;
  setTerminalReady: (v: boolean) => void;
  addScanDir: (path: string) => Promise<void>;
  removeScanDir: (path: string) => Promise<void>;
  addManualRepo: (path: string) => Promise<void>;
  hideRepo: (path: string) => Promise<void>;
  deleteBranchWithRemote: (b: BranchInfo) => Promise<void>;
  deleteRemoteBranch: (b: BranchInfo) => Promise<void>;
  pull: () => Promise<void>;
  push: () => Promise<void>;
  fetchAll: () => Promise<void>;
}

let seq = 1;
const DANGEROUS_FLAGS = new Set(["--force", "--hard", "-D", "reset", "clean", "--force-with-lease", "push"]);

function isDangerousArgs(args: string[]): boolean {
  const filtered = args.filter((a) => a !== "push");
  if (args.includes("push") && args.some((a) => a.startsWith("--force") || a === "-f")) return true;
  return filtered.some((a) => DANGEROUS_FLAGS.has(a));
}

function quoteShell(p: string): string {
  if (/^[\w\-./=@+,:]+$/.test(p)) return p;
  return "'" + p.replace(/'/g, "'\\''") + "'";
}

function sceneKey(s: AppStateStore, scene: DiffScene): string | null {
  if (scene === "working") return s.selectedChangePath;
  return s.commitPreviewPath ? `${s.commitPreviewPath}|${s.selectedCommit?.id ?? ""}` : null;
}

export const useStore = create<AppStateStore>((set, get) => ({
  repos: [],
  config: { ...DEFAULT_CONFIG },
  selectedRepoPath: null,
  status: emptyStatus(),
  gitdeckIgnored: [],
  diffText: "",
  diffFullText: "",
  diffTruncatedNote: null,
  diffHunks: [],
  imageDiff: null,
  selectedChangePath: null,
  selectedChangeKind: null,
  workingDiffIsCached: false,
  workingOldLines: null,
  commitOldLines: null,
  diffRequestSeq: 0,
  commitMessage: "",
  amend: false,
  commitRows: [],
  logFilterText: "",
  logAuthorFilter: null,
  logBranchFilter: null,
  logFirstParentOnly: false,
  selectedCommit: null,
  commitDetail: null,
  commitFileHunks: [],
  commitFileOldPath: null,
  commitPreviewPath: null,
  commitImageDiff: null,
  selectedCommitIsMerge: false,
  selectedCommitFirstParent: null,
  includedScope: "branchCommits",
  includedCommits: [],
  expandedIncludedHash: null,
  includedHunks: [],
  includedLoading: false,
  branches: [],
  stashes: [],
  currentTab: "changes",
  records: [],
  practiceMode: false,
  toasts: [],
  pendingConfirm: null,
  lastAutoFollowedBranch: "",
  terminalReady: false,
  cwdInTerminal: null,

  async init() {
    let cfg: AppConfig = { ...DEFAULT_CONFIG };
    try {
      const raw = await loadConfig();
      const parsed = JSON.parse(raw) as Partial<AppConfig>;
      cfg = { ...DEFAULT_CONFIG, ...parsed };
      if (!cfg.scanDirs.length) {
        const home = await invoke<string>("resolve_path", { raw: "~" });
        const react = home + "/React";
        let exists = false;
        try { await readTextFile(react + "/."); exists = true; } catch { exists = false; }
        cfg.scanDirs = [exists ? react : home];
        await saveConfig(JSON.stringify(cfg, null, 2));
      }
    } catch {
      cfg = { ...DEFAULT_CONFIG };
    }
    set({ config: cfg, practiceMode: cfg.practiceMode, currentTab: (cfg.lastTab as AppStateStore["currentTab"]) || "changes" });
    await get().reloadRepos();
    if (cfg.lastRepoPath) await get().selectRepo(cfg.lastRepoPath);
  },

  async patchConfig(patch) {
    const next = { ...get().config, ...patch };
    set({ config: next, practiceMode: next.practiceMode });
    await saveConfig(JSON.stringify(next, null, 2));
  },

  async reloadRepos() {
    const cfg = get().config;
    const entries = await scanRepos(cfg.scanDirs, cfg.manualRepos, cfg.hiddenRepos);
    const repos: Repo[] = entries.map((e) => ({ name: e.name, path: e.path, isManual: e.is_manual }));
    set({ repos });
    for (const r of repos) {
      runGit(["status", "--porcelain"], r.path, 10000).then(({ code, out }) => {
        if (code !== 0) return;
        const dirty = out.trim().length > 0;
        const cur = get().repos;
        const target = cur.find((x) => x.path === r.path);
        if (target && target.dirty !== dirty) {
          set({ repos: cur.map((x) => (x.path === r.path ? { ...x, dirty } : x)) });
        }
      });
    }
  },

  async selectRepo(path) {
    set({
      selectedRepoPath: path,
      status: emptyStatus(),
      diffText: "", diffFullText: "", diffTruncatedNote: null,
      diffHunks: [], imageDiff: null,
      selectedChangePath: null, selectedChangeKind: null, workingOldLines: null, workingDiffIsCached: false,
      commitRows: [], selectedCommit: null, commitDetail: null, commitFileHunks: [], commitPreviewPath: null,
      commitImageDiff: null, commitOldLines: null, commitFileOldPath: null,
      branches: [], stashes: [], includedCommits: [], expandedIncludedHash: null, includedHunks: [],
      lastAutoFollowedBranch: "", cwdInTerminal: null,
      gitdeckIgnored: JSON.parse(localStorage.getItem(`gitdeck.ignore.${path}`) ?? "[]"),
    });
    await get().patchConfig({ lastRepoPath: path });
    await get().cdTerminal(path);
    await get().refreshAll();
  },

  async setTab(t) {
    if (get().currentTab === t) return;
    set({ currentTab: t });
    await get().patchConfig({ lastTab: t });
    await get().refreshForCurrentTab();
  },

  async refreshAll() {
    await get().refreshStatus();
    await get().refreshForCurrentTab();
  },

  async refreshForCurrentTab() {
    const tab = get().currentTab;
    if (tab === "changes") { await get().refreshStatus(); await get().refreshBranches(); }
    else if (tab === "history") await get().refreshLog();
    else if (tab === "branches") await get().refreshBranches();
    else if (tab === "stash") await get().refreshStashes();
  },

  async refreshStatus() {
    const repo = get().selectedRepoPath;
    if (!repo) return;
    const { code, out } = await runGit(["status", "--porcelain=v1", "--branch"], repo);
    if (code !== 0) return;
    let newStatus = parseStatus(out);
    const ignored = get().gitdeckIgnored;
    if (ignored.length) {
      const f = (arr: FileChange[]) => arr.filter((c) => !ignored.includes(c.path));
      newStatus = { ...newStatus, conflicted: f(newStatus.conflicted), staged: f(newStatus.staged), unstaged: f(newStatus.unstaged), untracked: f(newStatus.untracked) };
    }
    if (statusEquals(newStatus, get().status)) return;
    set({ status: newStatus });
    // 当前分支变化时，历史筛选自动跟随（切换仓库 / checkout / 终端 checkout 均覆盖）
    const s = get();
    if (newStatus.branch && !newStatus.detached && newStatus.branch !== s.lastAutoFollowedBranch) {
      set({ lastAutoFollowedBranch: newStatus.branch });
      if (s.logBranchFilter !== newStatus.branch) {
        set({ logBranchFilter: newStatus.branch });
        if (s.currentTab === "history") void get().refreshLog();
      }
    }
    // 列表变化后选中文件可能已不在变更列表：清空面板
    const path = s.selectedChangePath;
    if (path) {
      const stillThere =
        newStatus.staged.some((c) => c.path === path) ||
        newStatus.unstaged.some((c) => c.path === path) ||
        newStatus.untracked.some((c) => c.path === path);
      if (!stillThere) get().clearDiffPanel();
    }
  },

  async refreshBranches() {
    const repo = get().selectedRepoPath;
    if (!repo) return;
    const fmt = "%(refname)%09%(HEAD)%09%(upstream:short)%09%(upstream:track)";
    const { code, out } = await runGit(["for-each-ref", `--format=${fmt}`, "refs/heads", "refs/remotes"], repo);
    if (code !== 0) return;
    const newBranches = parseBranches(out);
    if (JSON.stringify(newBranches) !== JSON.stringify(get().branches)) set({ branches: newBranches });
  },

  async refreshStashes() {
    const repo = get().selectedRepoPath;
    if (!repo) return;
    const { code, out } = await runGit(["stash", "list", "--format=%gd%x1f%s"], repo);
    set({ stashes: code === 0 ? parseStashes(out) : [] });
  },

  async refreshLog() {
    const repo = get().selectedRepoPath;
    if (!repo) return;
    const s = get();
    const args = ["log", "--graph", "--source", "--date-order", "-n", "300",
      "--date=iso-strict-local", "--pretty=format:%x1e%H%x1f%h%x1f%an%x1f%cd%x1f%s%x1f%d%x1f%S%x1e"];
    if (s.logFirstParentOnly) args.splice(2, 0, "--first-parent");
    args.push(s.logBranchFilter ?? "--all");
    const { code, out, stderr } = await runGit(args, repo);
    if (s.selectedRepoPath !== repo) return;
    if (code !== 0) {
      set({ commitRows: [{ kind: "graph", text: `git log 失败：${stderr.slice(0, 160)}` }] });
      return;
    }
    set({ commitRows: parseLog(out) });
  },

  async setLogFilter(text, author, branch, firstParentOnly) {
    const prev = get();
    const changed = prev.logFilterText !== text || prev.logAuthorFilter !== author || prev.logBranchFilter !== branch || prev.logFirstParentOnly !== firstParentOnly;
    set({ logFilterText: text, logAuthorFilter: author, logBranchFilter: branch, logFirstParentOnly: firstParentOnly });
    if (changed && get().currentTab === "history") await get().refreshLog();
  },

  // ---- 提交详情 ----
  async selectCommit(c) {
    if (get().selectedCommit?.id === c.id) {
      set({
        selectedCommit: null, commitDetail: null, commitFileHunks: [], commitPreviewPath: null,
        selectedCommitIsMerge: false, selectedCommitFirstParent: null,
        includedCommits: [], expandedIncludedHash: null, includedHunks: [], commitImageDiff: null, commitOldLines: null,
      });
      return;
    }
    const repo = get().selectedRepoPath;
    if (!repo) return;
    const hash = c.id;
    set({
      selectedCommit: c, commitDetail: null, commitFileHunks: [], commitPreviewPath: null,
      selectedCommitIsMerge: false, selectedCommitFirstParent: null, commitImageDiff: null, commitOldLines: null, commitFileOldPath: null,
      includedCommits: [], expandedIncludedHash: null, includedHunks: [], includedLoading: false,
    });

    // 先查父提交数量：merge commit 的 diff 要和第一父提交比较，否则看不到合并带来的改动
    const { code, out: parentsOut } = await runGit(["rev-list", "--parents", "-n", "1", hash], repo);
    if (code !== 0 || get().selectedCommit?.id !== hash) return;
    const parts = parentsOut.trim().split(" ").filter(Boolean);
    const isMerge = parts.length >= 3;
    const firstParent = parts.length >= 2 ? parts[1] : null;
    set({ selectedCommitIsMerge: isMerge, selectedCommitFirstParent: firstParent });

    const r2 = await runGit(["show", "-s", "--date=iso-strict-local", "--format=%H%x1f%an%x1f%cd%x1f%B", hash], repo);
    if (r2.code !== 0 || get().selectedCommit?.id !== hash) return;
    const f = r2.out.split("\u001f");
    const message = f.length >= 4 ? f[3].trim() : c.subject;
    const fullHash = f[0] ?? hash;
    const author = f.length >= 2 ? f[1] : c.author;
    const date = f.length >= 3 ? (new Date(f[2]) || c.date) : c.date;

    const nameStatusArgs = isMerge && firstParent
      ? ["diff-tree", "-r", "--name-status", firstParent, hash]
      : ["diff-tree", "--no-commit-id", "-r", "--name-status", hash];
    const r3 = await runGit(nameStatusArgs, repo);
    if (r3.code !== 0 || get().selectedCommit?.id !== hash) return;
    const files: CommitFile[] = [];
    for (const line of r3.out.split("\n")) {
      if (!line) continue;
      const segs = line.split("\t");
      if (segs.length < 2) continue;
      // 重命名格式 "R100\told\tnew"，取新路径
      files.push({ status: segs[0][0] ?? "", path: segs.length > 2 ? segs[2] : segs[1] });
    }
    set({ commitDetail: { fullHash, author, date, message, files } });
    if (isMerge) await get().loadIncludedCommits(hash, firstParent);
  },

  async loadIncludedCommits(hash, firstParent) {
    const repo = get().selectedRepoPath;
    if (!repo) return;
    const scope = get().includedScope;
    const args =
      scope === "branchCommits"
        ? ["log", "--format=%h%x1f%s", "--no-merges", "--first-parent", `${hash}^2`, "--not", `${hash}^1`]
        : scope === "fullHistory"
          ? ["log", "--format=%h%x1f%s", "--no-merges", `${firstParent}..${hash}`]
          : ["log", "--format=%h%x1f%s", "--first-parent", "-n", "300", hash];
    const { code, out } = await runGit(args, repo);
    if (code !== 0 || get().selectedCommit?.id !== hash) return;
    const entries = out
      .trim()
      .split("\n")
      .filter(Boolean)
      .slice(0, 50)
      .map((line) => {
        const segs = line.split("\u001f");
        return segs.length >= 2 ? { hash: segs[0], subject: segs[1] } : null;
      })
      .filter(Boolean) as IncludedCommitEntry[];
    set({ includedCommits: entries });
  },

  async setIncludedScope(scope) {
    if (get().includedScope === scope) return;
    const hash = get().selectedCommit?.id;
    set({ includedScope: scope, expandedIncludedHash: null, includedHunks: [], includedLoading: false });
    if (get().selectedCommitIsMerge && hash) await get().loadIncludedCommits(hash, get().selectedCommitFirstParent);
  },

  async toggleIncludedCommit(entryHash) {
    if (get().expandedIncludedHash === entryHash) {
      set({ expandedIncludedHash: null, includedHunks: [], includedLoading: false });
      return;
    }
    const repo = get().selectedRepoPath;
    if (!repo || !get().selectedCommit) return;
    set({ expandedIncludedHash: entryHash, includedHunks: [], includedLoading: true });
    const { code, out } = await runGit(["show", "--format=", "--unified=3", entryHash], repo);
    if (code !== 0 || get().expandedIncludedHash !== entryHash) return;
    const raw = out || "（无差异）";
    const parsed = parseDiffHunks(raw);
    // 多文件 diff 无法按块定位旧文件：不支持展开上下文、不支持回滚
    const hunks = parsed.hunks.map((h, idx) =>
      makeHunkDisplay(idx, h, `${h.header}（${h.lines.length} 行）`, false, false),
    );
    if (get().expandedIncludedHash !== entryHash) return;
    set({ includedHunks: hunks, includedLoading: false });
  },

  async selectCommitFile(f) {
    if (get().commitPreviewPath === f.path) {
      set({ commitPreviewPath: null, commitFileHunks: [], commitOldLines: null, commitFileOldPath: null, commitImageDiff: null });
      return;
    }
    set({ commitPreviewPath: f.path, commitFileHunks: [], commitOldLines: null, commitFileOldPath: null, commitImageDiff: null });
    if (isImageFile(f.path)) {
      await get().loadCommitImageDiff(f);
      return;
    }
    await get().loadCommitFileDiff(f);
  },

  async reloadCommitFileDiff() {
    const s = get();
    const f = s.commitDetail?.files.find((x) => x.path === s.commitPreviewPath);
    if (!f) return;
    set({ commitFileHunks: [], commitOldLines: null, commitImageDiff: null });
    if (isImageFile(f.path)) await get().loadCommitImageDiff(f);
    else await get().loadCommitFileDiff(f);
  },

  async loadCommitImageDiff(f) {
    const s = get();
    const repo = s.selectedRepoPath;
    const commit = s.selectedCommit;
    if (!repo || !commit) return;
    const hash = commit.id;
    const oldData = f.status === "A" ? null : await gitShowBase64(`${hash}^:${f.path}`, repo);
    const newData = f.status === "D" ? null : await gitShowBase64(`${hash}:${f.path}`, repo);
    if (get().selectedCommit?.id !== hash || get().commitPreviewPath !== f.path) return;
    const note = f.status === "A" ? "新增文件，只显示新版"
      : f.status === "D" ? "文件已删除，只显示旧版"
      : oldData === null ? "旧版内容获取不到（可能是初始提交）"
      : undefined;
    set({
      commitFileHunks: [],
      commitImageDiff: {
        path: f.path,
        oldSrc: oldData ? `data:image/png;base64,${oldData}` : null,
        newSrc: newData ? `data:image/png;base64,${newData}` : null,
        note,
      },
    });
  },

  async loadCommitFileDiff(f) {
    const s = get();
    const repo = s.selectedRepoPath;
    const commit = s.selectedCommit;
    if (!repo || !commit) return;
    const hash = commit.id;
    const showArgs = s.selectedCommitIsMerge && s.selectedCommitFirstParent
      ? ["diff", s.selectedCommitFirstParent, hash, "--unified=3", "--", f.path]
      : ["show", "--format=", "--unified=3", hash, "--", f.path];
    const { code, out } = await runGit(showArgs, repo);
    if (code !== 0 || get().selectedCommit?.id !== hash || get().commitPreviewPath !== f.path) return;
    const raw = out || "（无差异：合并提交或空提交）";
    const parsed = parseDiffHunks(raw);
    const oldPath = oldPathFromRawDiff(raw);
    const hunks = parsed.hunks.map((h, idx) =>
      makeHunkDisplay(idx, h, `块 ${idx + 1}：行 ${h.oldStart}-${h.oldStart + Math.max(h.oldCount - 1, 0)}`, true, true),
    );
    if (get().selectedCommit?.id !== hash || get().commitPreviewPath !== f.path) return;
    set({ commitFileHunks: hunks, commitFileOldPath: oldPath });
  },

  // ---- 变更页 ----
  async loadDiff(change) {
    const repo = get().selectedRepoPath;
    if (!repo) return;
    const seq = get().diffRequestSeq + 1;
    set({
      diffRequestSeq: seq,
      selectedChangePath: change.path,
      selectedChangeKind: change.isUntracked ? "untracked" : change.staged ? "staged" : "unstaged",
      workingOldLines: null,
      imageDiff: null,
    });
    const path = change.path;

    const setDiff = (rawText: string, isCached: boolean) => {
      const cur = get();
      if (cur.diffRequestSeq !== seq || cur.selectedChangePath !== path) return;
      let text = rawText;
      let note: string | null = null;
      const lines = rawText.split("\n");
      if (lines.length > MAX_DIFF_LINES) {
        text = lines.slice(0, MAX_DIFF_LINES).join("\n") + "\n";
        note = `diff 共 ${lines.length} 行，仅渲染前 ${MAX_DIFF_LINES} 行以保证界面流畅。完整内容请用「复制 diff」或终端 git diff 查看。`;
      }
      const parsed = parseDiffHunks(text);
      const kindNow = get().selectedChangeKind;
      const hunks = parsed.hunks.map((h, idx) =>
        makeHunkDisplay(idx, h, `块 ${idx + 1}：行 ${h.oldStart}-${h.oldStart + Math.max(h.oldCount - 1, 0)}`,
          kindNow === "unstaged" || kindNow === "staged", true),
      );
      set({ diffText: text, diffFullText: rawText, diffTruncatedNote: note, diffHunks: hunks, workingDiffIsCached: isCached });
    };

    // 合并冲突中的文件：直接展示工作区内容（冲突标记会高亮），git diff 对 unmerged path 无输出
    if (change.conflictCode) {
      let content = "（无法读取文件内容）";
      try { content = await readTextFile(`${repo}/${path}`, 600); } catch { /* keep */ }
      setDiff("冲突标记说明：<<<<<<< 当前分支的改动 | ======= 分隔 | >>>>>>> 对方分支的改动\n解决后：git add <文件> → git merge --continue\n\n" + content, false);
      return;
    }

    // 图片文件：渲染 before/after，不走文本 diff
    if (isImageFile(path)) {
      const isUntracked = change.isUntracked ?? false;
      const oldB64 = isUntracked ? null : (await gitShowBase64(`HEAD:${path}`, repo)) ?? (await gitShowBase64(`:${path}`, repo));
      let newB64: string | null = null;
      let deleted = false;
      try { newB64 = await readFileBase64(`${repo}/${path}`); } catch { deleted = true; }
      if (get().diffRequestSeq !== seq || get().selectedChangePath !== path) return;
      set({
        diffText: "", diffFullText: "", diffTruncatedNote: null, diffHunks: [],
        imageDiff: {
          path,
          oldSrc: oldB64 ? `data:image/png;base64,${oldB64}` : null,
          newSrc: newB64 ? `data:image/png;base64,${newB64}` : null,
          note: deleted ? "文件已删除，只显示旧版" : undefined,
        },
      });
      return;
    }

    const untracked = change.isUntracked ?? false;
    const r1 = await runGit(["diff", "--unified=3", "--", path], repo);
    if (r1.code !== 0 || get().selectedChangePath !== path || get().diffRequestSeq !== seq) return;
    if (untracked) {
      let content = "（无法读取文件内容）";
      try { content = await readTextFile(`${repo}/${path}`, 400); } catch { /* keep */ }
      setDiff("新文件:\n" + content, false);
    } else if (!r1.out.trim()) {
      setDiff("（暂存的变更，无工作区 diff）", false);
      const r2 = await runGit(["diff", "--cached", "--unified=3", "--", path], repo);
      if (r2.code !== 0 || get().selectedChangePath !== path || get().diffRequestSeq !== seq) return;
      if (!r2.out.trim()) {
        setDiff("（无差异，可能为模式变更）", false);
      } else {
        // 面板显示的是暂存 diff：展开上下文的旧版取 HEAD（rename 用 diff 头里的旧路径）
        setDiff(r2.out, true);
      }
    } else {
      // 面板显示的是未暂存 diff：旧侧是 index
      setDiff(r1.out, false);
    }
  },

  clearDiffPanel() {
    const seq = get().diffRequestSeq + 1;
    set({
      diffRequestSeq: seq,
      selectedChangePath: null,
      selectedChangeKind: null,
      diffText: "", diffFullText: "", diffTruncatedNote: null,
      diffHunks: [], imageDiff: null, workingOldLines: null,
    });
  },

  // ---- 上下文展开（GitLab MR 式） ----
  async toggleExpandContext(hunk, direction, scene) {
    const repo = get().selectedRepoPath;
    if (!hunk.canExpand || !repo) return;
    const oldLines = scene === "working" ? get().workingOldLines : get().commitOldLines;
    if (oldLines) {
      get().applyExpand(hunk, direction, scene, oldLines);
      return;
    }
    // 旧版本 rev 解析：工作区未暂存 diff 旧侧是 index，暂存 fallback 是 HEAD，提交详情是父提交
    const s = get();
    let revPath: string | null = null;
    if (scene === "working") {
      const path = s.selectedChangePath;
      if (!path) return;
      revPath = s.workingDiffIsCached ? `HEAD:${path}` : `:${path}`;
    } else {
      const path = s.commitPreviewPath;
      const hash = s.selectedCommit?.id;
      if (!path || !hash) return;
      const parent = s.selectedCommitIsMerge ? (s.selectedCommitFirstParent ?? `${hash}~1`) : `${hash}~1`;
      revPath = `${parent}:${s.commitFileOldPath ?? path}`;
    }
    if (!revPath) return;
    const selectionKey = sceneKey(get(), scene);
    if (!selectionKey) return;
    const { code, out, stderr } = await runGit(["show", revPath], repo, 30000);
    if (sceneKey(get(), scene) !== selectionKey) return;
    if (code !== 0) {
      get().showToast(`读取旧版本内容失败：git show ${revPath}\n${stderr}`, true);
      return;
    }
    const lines = out.split("\n");
    if (lines.length && lines[lines.length - 1] === "") lines.pop(); // 末尾换行产生的空元素不是一行
    if (scene === "working") set({ workingOldLines: lines });
    else set({ commitOldLines: lines });
    get().applyExpand(hunk, direction, scene, lines);
  },

  collapseExpandContext(hunk, scene) {
    get().applyIfSamePatch({ ...hunk, expandAbove: 0, expandBelow: 0 }, scene);
  },

  applyExpand(hunk, direction, scene, oldLines) {
    const apply = (arr: DiffHunkDisplay[]): { arr: DiffHunkDisplay[]; toast?: string } => {
      const i = arr.findIndex((x) => x.id === hunk.id && x.patch === hunk.patch);
      if (i < 0) return { arr };
      const { hunk: updated, grew } = rebuildExpanded(hunk, direction, oldLines, arr, i);
      if (!grew) {
        return { arr, toast: direction === "up" ? "上方没有更多上下文（已到文件顶部或相邻块）" : "下方没有更多上下文（已到文件底部或相邻块）" };
      }
      const next = [...arr];
      next[i] = updated;
      return { arr: next };
    };
    if (scene === "working") {
      const r = apply(get().diffHunks);
      set({ diffHunks: r.arr });
      if (r.toast) get().showToast(r.toast, false);
    } else {
      const r = apply(get().commitFileHunks);
      set({ commitFileHunks: r.arr });
      if (r.toast) get().showToast(r.toast, false);
    }
  },

  applyIfSamePatch(hunk, scene) {
    if (scene === "working") {
      const arr = [...get().diffHunks];
      const i = arr.findIndex((x) => x.id === hunk.id && x.patch === hunk.patch);
      if (i >= 0) { arr[i] = hunk; set({ diffHunks: arr }); }
    } else {
      const arr = [...get().commitFileHunks];
      const i = arr.findIndex((x) => x.id === hunk.id && x.patch === hunk.patch);
      if (i >= 0) { arr[i] = hunk; set({ commitFileHunks: arr }); }
    }
  },

  // ---- 行级 / 块级回滚 ----
  async revertLine(hunk, displayIndex, scene) {
    const rawIndex = displayIndex - hunk.expandAbove;
    if (rawIndex < 0 || rawIndex >= hunk.numberedLines.length) return;
    const target = hunk.numberedLines[rawIndex];
    const marker = target.text[0];
    if (marker !== "+" && marker !== "-") return;
    const repo = get().selectedRepoPath;
    if (!repo) return;
    const patch = workingLinePatch(hunk.numberedLines, hunk.patch, rawIndex);
    if (!patch) {
      get().showToast("该行缺少可定位的上下文，请用「回滚区块」或在终端处理", true);
      return;
    }
    const lineNo = String((marker === "+" ? target.new : target.old) ?? "?");
    const content = target.text.slice(1);
    const preview = content.length > 80 ? content.slice(0, 80) + "…" : content;

    if (scene === "working") {
      if (get().selectedChangeKind !== "unstaged" && get().selectedChangeKind !== "staged") return;
      const useCached = get().workingDiffIsCached;
      await get().gitAction({
        args: ["apply", "--recount", ...(useCached ? ["--cached"] : []), "patch"],
        patch: { text: patch, reverse: false, cached: useCached },
        dangerous: true,
        confirmTitle: `回滚「第 ${lineNo} 行」？`,
        confirmDetail: marker === "+"
          ? `将删除这一行新增：\n${preview}\n\n仅影响此行，其他改动保留。`
          : `将恢复被删除的这一行：\n${preview}\n\n仅影响此行，其他改动保留。`,
        completion: () => { void get().loadDiffForCurrentSelection(); },
      });
    } else {
      const commit = get().selectedCommit;
      if (!commit) return;
      await get().gitAction({
        args: ["apply", "--recount", "patch"],
        patch: { text: patch, reverse: false, cached: false },
        dangerous: true,
        confirmTitle: `回滚「第 ${lineNo} 行」？`,
        confirmDetail: `将把提交 ${commit.id.slice(0, 7)} 对这一行的改动从当前代码中撤销：\n${preview}\n\n若该处代码在后续提交中又被修改，应用会失败，需在终端处理。`,
        completion: () => { void get().reloadCommitFileDiff(); },
      });
    }
  },

  async rollbackHunk(hunk) {
    if (get().selectedChangeKind !== "unstaged" && get().selectedChangeKind !== "staged") return;
    const useCached = get().workingDiffIsCached;
    await get().gitAction({
      args: ["apply", "-R", "--recount", ...(useCached ? ["--cached"] : []), "patch"],
      patch: { text: hunk.patch, reverse: true, cached: useCached },
      dangerous: true,
      confirmTitle: `回滚「${hunk.title}」？`,
      confirmDetail: "将反向应用该区块的改动。仅影响此区块内的行，其他改动保留。",
      completion: () => { void get().loadDiffForCurrentSelection(); },
    });
  },

  async rollbackCommitHunk(hunk) {
    const commit = get().selectedCommit;
    if (!commit) return;
    await get().gitAction({
      args: ["apply", "-R", "--recount", "patch"],
      patch: { text: hunk.patch, reverse: true, cached: false },
      dangerous: true,
      confirmTitle: `回滚「${hunk.title}」？`,
      confirmDetail: `将把提交 ${commit.id.slice(0, 7)} 中该区块的改动从当前代码中撤销。若该处代码之后又被修改过，应用会失败，需在终端解决。`,
      completion: () => { void get().reloadCommitFileDiff(); },
    });
  },

  // ---- 用户 git 操作入口 ----
  // 练习模式：只复制命令不执行；dangerous/confirm 弹确认；patch 走临时补丁文件。
  // 命令提示栏记录每次执行（含真实退出码与输出，危险命令标红）
  async gitAction(opts) {
    const repo = get().selectedRepoPath;
    if (!repo) return;
    const command = "git " + (opts.args ?? []).map(quoteShell).join(" ");
    const record: CommandRecord = {
      id: seq++,
      command,
      directory: repo,
      exitCode: 0,
      output: "",
      isDangerous: opts.dangerous ?? (opts.args ? isDangerousArgs(opts.args) : false),
      date: new Date(),
    };
    set({ records: [record, ...get().records].slice(0, 50) });

    if (get().practiceMode) {
      try { await navigator.clipboard.writeText(command); } catch { /* 剪贴板不可用静默 */ }
      const dangerTip = (opts.dangerous || opts.confirmTitle) ? "\n⚠️ 这是危险命令，确认影响后再在终端亲手敲" : "";
      get().showToast(`🎓 已复制「${command}」，去下方终端亲手敲${dangerTip}`, false);
      opts.completion?.();
      return;
    }

    const act = async () => {
      let code = 0;
      let output = "";
      if (opts.patch) {
        const r = await applyPatch(opts.patch.text, repo, opts.patch.reverse, opts.patch.cached);
        code = r.code; output = (r.stderr || r.stdout).trim();
      } else if (opts.args) {
        const r = await runGit(opts.args, repo);
        code = r.code; output = (r.stderr || r.out).trim();
      }
      set({ records: get().records.map((x) => (x.id === record.id ? { ...x, exitCode: code, output: output.slice(0, 400) } : x)) });
      if (code !== 0) get().showToast(`命令失败（exit ${code}）：${output || command}`, true);
      opts.completion?.();
      void get().refreshStatus();
      void get().refreshForCurrentTab();
    };

    if (opts.confirmTitle) {
      set({
        pendingConfirm: {
          id: seq++,
          title: opts.confirmTitle,
          detail: opts.confirmDetail ?? "",
          command,
          action: () => { void act(); },
        },
      });
      return;
    }
    await act();
  },

  async loadDiffForCurrentSelection() {
    const s = get();
    const path = s.selectedChangePath;
    const repo = s.selectedRepoPath;
    if (!path || !repo) return;
    await get().refreshStatus();
    const st = get().status;
    const c =
      st.staged.find((x) => x.path === path) ??
      st.unstaged.find((x) => x.path === path) ??
      st.untracked.find((x) => x.path === path);
    if (c) await get().loadDiff(c);
    else get().clearDiffPanel();
  },

  // ---- 常用操作 ----
  async stage(path) { await get().gitAction({ args: ["add", "--", path] }); },
  async unstage(path) { await get().gitAction({ args: ["restore", "--staged", "--", path] }); },
  async stageAll() { await get().gitAction({ args: ["add", "-A"] }); },
  async discard(path) {
    await get().gitAction({
      args: ["restore", "--", path],
      dangerous: true,
      confirmTitle: "回退改动？",
      confirmDetail: `git restore -- ${path}，丢弃工作区修改（危险，不可恢复）`,
      completion: () => { void get().loadDiffForCurrentSelection(); },
    });
  },
  async discardAllChangesOfFile(path) {
    await get().gitAction({
      args: ["checkout", "HEAD", "--", path],
      dangerous: true,
      confirmTitle: "回退全部？",
      confirmDetail: `git checkout HEAD -- ${path}，丢弃已暂存+未暂存全部改动（危险）`,
      completion: () => { void get().loadDiffForCurrentSelection(); },
    });
  },
  async deleteUntrackedFile(path) {
    await get().gitAction({
      args: ["clean", "-f", "--", path],
      dangerous: true,
      confirmTitle: "删除文件？",
      confirmDetail: `git clean -f -- ${path}，未跟踪文件删除后无法恢复（危险）`,
      completion: () => { void get().loadDiffForCurrentSelection(); },
    });
  },
  async untrackFile(path) {
    await get().gitAction({
      args: ["rm", "--cached", path],
      dangerous: true,
      confirmTitle: "取消跟踪？",
      confirmDetail: "git rm --cached：文件保留在磁盘、从版本库移除；之后会以「未跟踪」回到列表",
    });
  },
  gitdeckIgnoreFile(path) {
    const repo = get().selectedRepoPath;
    if (!repo) return;
    const key = `gitdeck.ignore.${repo}`;
    const cur: string[] = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (cur.includes(path)) return;
    cur.push(path);
    localStorage.setItem(key, JSON.stringify(cur));
    set({ gitdeckIgnored: cur });
    void get().refreshStatus();
  },
  gitdeckUnignore(path) {
    const repo = get().selectedRepoPath;
    if (!repo) return;
    const key = `gitdeck.ignore.${repo}`;
    const cur: string[] = JSON.parse(localStorage.getItem(key) ?? "[]").filter((p: string) => p !== path);
    localStorage.setItem(key, JSON.stringify(cur));
    set({ gitdeckIgnored: cur });
    void get().refreshStatus();
  },
  async commit(message, amend) {
    if (!message.trim() && !amend) {
      get().showToast("请填写提交说明", true);
      return;
    }
    const args = amend ? ["commit", "--amend", "-m", message] : ["commit", "-m", message];
    await get().gitAction({
      args,
      completion: () => {
        set({ commitMessage: "", amend: false });
        void get().refreshStatus();
      },
    });
  },
  async stashPush(includeUntracked, message) {
    const args = ["stash", "push", ...(includeUntracked ? ["-u"] : []), ...(message ? ["-m", message] : [])];
    await get().gitAction({ args, completion: () => { void get().refreshStashes(); void get().refreshStatus(); } });
  },
  async stashPop(s) { await get().gitAction({ args: ["stash", "pop", `stash@{${s.index}}`], completion: () => { void get().refreshStashes(); void get().refreshStatus(); } }); },
  async stashApply(s) { await get().gitAction({ args: ["stash", "apply", `stash@{${s.index}}`], completion: () => { void get().refreshStashes(); void get().refreshStatus(); } }); },
  async stashDrop(s) {
    await get().gitAction({
      args: ["stash", "drop", `stash@{${s.index}}`],
      dangerous: true,
      confirmTitle: "丢弃 stash？",
      confirmDetail: "丢弃后无法恢复（危险）",
      completion: () => { void get().refreshStashes(); },
    });
  },
  async checkoutBranch(b) { await get().gitAction({ args: ["checkout", b.name] }); },
  async deleteBranch(b, force) {
    await get().gitAction({
      args: ["branch", force ? "-D" : "-d", b.name],
      dangerous: true,
      confirmTitle: `删除分支 ${b.name}？`,
      confirmDetail: force ? "-D 强制删除（即使未合并）。如需温和删除请用 git branch -d。" : "",
    });
  },
  // 删除本地分支并同步删除其远端：第一步 branch -d（未合并保护，失败即中止），
  // 第二步 push <remote> --delete。completion 里用 records[0].exitCode 判断第一步成败。
  async deleteBranchWithRemote(b) {
    if (!b.upstream) return;
    const remote = b.upstream.split("/")[0];
    const short = b.upstream.slice(remote.length + 1);
    await get().gitAction({
      args: ["branch", "-d", b.name],
      dangerous: true,
      confirmTitle: `删除本地分支 ${b.name} 并同步删除远端 ${b.upstream}？`,
      confirmDetail: `第一步：git branch -d ${b.name}（未合并会被拒绝并中止）\n第二步：git push ${remote} --delete ${short}（远端删除后无法恢复）`,
      completion: () => {
        const rec = get().records[0];
        if (!rec || rec.exitCode !== 0) return; // 本地删除失败（如未合并），不继续删远端
        void get().gitAction({
          args: ["push", remote, "--delete", short],
          completion: () => {
            void get().refreshBranches();
            void get().refreshStatus();
          },
        });
      },
    });
  },
  // 直接删除远端分支（b.name 形如 origin/feature/x）
  async deleteRemoteBranch(b) {
    const i = b.name.indexOf("/");
    const remote = b.name.slice(0, i);
    const short = b.name.slice(i + 1);
    await get().gitAction({
      args: ["push", remote, "--delete", short],
      dangerous: true,
      confirmTitle: `删除远端分支 ${b.name}？`,
      confirmDetail: `git push ${remote} --delete ${short}（远端删除后无法恢复；本地同名分支不受影响）`,
      completion: () => {
        void get().refreshBranches();
      },
    });
  },

  // ---- 顶栏快捷同步 ----
  // completion 里用 records[0].exitCode 判断成败,补一个成功 toast
  async pull() {
    const s = get();
    if (!s.selectedRepoPath || !s.status.branch || s.status.detached) {
      s.showToast("当前不在分支上，无法拉取", true);
      return;
    }
    const upstream = s.branches.find((b) => b.isCurrent)?.upstream;
    if (!upstream) {
      s.showToast("当前分支没有上游，请先「推送」建立跟踪", true);
      return;
    }
    await s.gitAction({
      args: ["pull"],
      completion: () => {
        if (get().records[0]?.exitCode === 0) get().showToast(`已拉取 ${upstream}`, false);
        void get().refreshAll();
      },
    });
  },
  async push() {
    const s = get();
    if (!s.selectedRepoPath || !s.status.branch || s.status.detached) {
      s.showToast("当前不在分支上，无法推送", true);
      return;
    }
    const cur = s.branches.find((b) => b.isCurrent);
    // 无上游的新分支:首次推送带 -u 建立跟踪
    const args = cur?.upstream ? ["push"] : ["push", "-u", "origin", s.status.branch];
    await s.gitAction({
      args,
      completion: () => {
        if (get().records[0]?.exitCode === 0) get().showToast(cur?.upstream ? "已推送到远端" : `已推送并建立跟踪 origin/${s.status.branch}`, false);
        void get().refreshAll();
      },
    });
  },
  async fetchAll() {
    const s = get();
    if (!s.selectedRepoPath) return;
    await s.gitAction({
      args: ["fetch", "--all"],
      completion: () => {
        if (get().records[0]?.exitCode === 0) get().showToast("已获取远端最新信息", false);
        void get().refreshAll();
      },
    });
  },
  async renameBranch(b, newName) { await get().gitAction({ args: ["branch", "-m", b.name, newName] }); },

  // ---- Toast / Confirm ----
  showToast(text, isError) {
    const id = seq++;
    set({ toasts: [...get().toasts, { id, text, isError }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), isError ? 6000 : 3000);
  },
  setConfirm(r) { set({ pendingConfirm: r }); },
  setCommitMessage(m) { set({ commitMessage: m }); },
  setAmend(v) { set({ amend: v }); },
  setPracticeMode(on) { return get().patchConfig({ practiceMode: on }); },

  // ---- 终端联动 ----
  onTerminalReturn() {
    // 平移 scheduleEventRefresh：静默 0.8s 刷一次（快命令已完成），3s 补刷（慢命令兜底）
    const fire = () => {
      void get().refreshStatus();
      void get().refreshForCurrentTab();
    };
    setTimeout(fire, 800);
    setTimeout(fire, 3800);
  },
  async cdTerminal(path) {
    const s = get();
    // 未就绪时不写也不记录:避免"记录了却没写入"被去重拦掉,
    // 终端就绪时 TerminalPane 会用当前 selectedRepoPath 主动补发一次
    if (!s.terminalReady) return;
    if (s.cwdInTerminal === path) return;
    // 用 ; 而不是 &&:Windows PowerShell 5.1 不支持 && 分隔符;
    // 结尾用 \r(回车)而不是 \n——ConPTY/PSReadLine 里 \n 只换行不执行
    await invoke("pty_write", { data: `cd ${quoteShell(path)}; clear\r` });
    set({ cwdInTerminal: path });
  },
  setTerminalReady(v) { set({ terminalReady: v }); },
  async addScanDir(path) {
    const resolved = await resolvePathSafe(path);
    const dirs = get().config.scanDirs;
    if (dirs.includes(resolved)) {
      get().showToast("该目录已在扫描列表中", false);
      return;
    }
    let exists = true;
    try { exists = await pathExists(resolved); } catch { exists = true; }
    if (!exists) {
      get().showToast(`目录不存在：${resolved}`, true);
      return;
    }
    await get().patchConfig({ scanDirs: [...dirs, resolved] });
    await get().reloadRepos();
    get().showToast(`已添加扫描目录：${resolved}`, false);
  },
  async removeScanDir(path) {
    await get().patchConfig({ scanDirs: get().config.scanDirs.filter((d) => d !== path) });
    await get().reloadRepos();
  },
  async addManualRepo(path) {
    const resolved = await resolvePathSafe(path);
    if (!resolved) return;
    if (get().config.manualRepos.includes(resolved) || get().repos.some((r) => r.path === resolved)) {
      get().showToast("该仓库已在列表中", false);
      return;
    }
    let isRepo = true;
    try { isRepo = await pathExists(`${resolved}/.git`); } catch { isRepo = true; }
    if (!isRepo) {
      get().showToast(`该目录不是 git 仓库（未找到 .git）：${resolved}`, true);
      return;
    }
    await get().patchConfig({ manualRepos: [...get().config.manualRepos, resolved] });
    await get().reloadRepos();
    get().showToast(`已添加仓库：${resolved}`, false);
  },
  async hideRepo(path) {
    await get().patchConfig({ hiddenRepos: [...get().config.hiddenRepos, path] });
    await get().reloadRepos();
  },
}));

async function resolvePathSafe(p: string): Promise<string> {
  try {
    return await invoke<string>("resolve_path", { raw: p });
  } catch {
    return p;
  }
}
