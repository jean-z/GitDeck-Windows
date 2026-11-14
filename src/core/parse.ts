// 平移 GitDeck 的输出解析：parseStatus / parseBranchLine / parseBranches / parseLog / 日期与 message 着色

import type { BranchInfo, CommitEntry, FileChange, LogRow, RepoStatus, StatusKind } from "./types";
import { emptyStatus } from "./types";

export function parseGitDate(s: string): Date | null {
  // iso-strict（T 分隔）与 git iso（空格分隔）都兼容
  if (!s) return null;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  return null;
}

/// 相对时间：今天 14:30 / 昨天 09:12 / 周三 16:05 / 09-28 / 2025-12-01
export function relativeTime(date: Date): string {
  const cal = new Date();
  const isToday = date.toDateString() === cal.toDateString();
  const yesterday = new Date(cal); yesterday.setDate(cal.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  const hm = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const diffMs = cal.getTime() - date.getTime();
  if (isToday) return `今天 ${hm}`;
  if (isYesterday) return `昨天 ${hm}`;
  if (diffMs < 6 * 86400_000 && diffMs > 0) {
    const wk = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()];
    return `${wk} ${hm}`;
  }
  const sameYear = date.getFullYear() === cal.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return sameYear ? `${mm}-${dd} ${hm}` : `${date.getFullYear()}-${mm}-${dd}`;
}

export function fullTime(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

/// 从 "[ahead 1, behind 2]" 之类文本中提取数字
function matchInts(extra: string, keys: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const key of keys) {
    const m = extra.match(new RegExp(`${key} (\\d+)`));
    if (m) result[key] = parseInt(m[1], 10);
  }
  return result;
}

function parseBranchLine(line: string, s: RepoStatus): void {
  if (line === "HEAD (no branch)" || line.startsWith("(No branch")) {
    s.detached = true;
    s.branch = line.split(" ").pop() ?? "";
    return;
  }
  s.branch = (line.split("...")[0] ?? line).trim();
  const dotIdx = line.indexOf("...");
  if (dotIdx >= 0) {
    const rest = line.slice(dotIdx + 3);
    let upstream = rest;
    let extra = "";
    const bracket = rest.indexOf("[");
    if (bracket >= 0) {
      upstream = rest.slice(0, bracket);
      extra = rest.slice(bracket);
    }
    s.upstream = upstream.trim() || null;
    const nums = matchInts(extra, ["ahead", "behind"]);
    s.ahead = nums["ahead"] ?? 0;
    s.behind = nums["behind"] ?? 0;
  } else if (line.includes("[")) {
    const b0 = line.indexOf("[");
    const nums = matchInts(line.slice(b0), ["ahead", "behind"]);
    s.ahead = nums["ahead"] ?? 0;
    s.behind = nums["behind"] ?? 0;
  }
}

/// 平移 AppState.parseStatus（porcelain=v1 --branch）
export function parseStatus(raw: string): RepoStatus {
  const s = emptyStatus();
  for (const line of raw.split("\n")) {
    if (!line) continue;
    if (line.startsWith("## ")) {
      parseBranchLine(line.slice(3), s);
      continue;
    }
    if (line.length < 3) continue;
    const x = line[0];
    const y = line[1];
    let pathPart = line.slice(3);
    // 重命名格式: "R  old -> new"，取 new
    if (x === "R" || y === "R" || x === "C") {
      const arrow = pathPart.indexOf(" -> ");
      if (arrow >= 0) pathPart = pathPart.slice(arrow + 4);
    }
    if (pathPart.startsWith('"') && pathPart.endsWith('"')) {
      pathPart = pathPart.slice(1, -1);
    }

    if (x === "?" && y === "?") {
      s.untracked.push({ path: pathPart, staged: null, unstaged: "?", isUntracked: true });
      continue;
    }

    // 合并/变基冲突状态：UU/AA/DD/AU/UA/DU/UD
    const code = x + y;
    if (["UU", "AA", "DD", "AU", "UA", "DU", "UD"].includes(code)) {
      s.conflicted.push({ path: pathPart, staged: null, unstaged: null, conflictCode: code });
      continue;
    }

    const xKind: StatusKind | null = x === " " ? null : (x as StatusKind);
    const yKind: StatusKind | null = y === " " ? null : (y as StatusKind);
    if (xKind) s.staged.push({ path: pathPart, staged: xKind, unstaged: null });
    if (yKind) s.unstaged.push({ path: pathPart, staged: null, unstaged: yKind });
  }
  return s;
}

export function statusEquals(a: RepoStatus, b: RepoStatus): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/// 平移 parseBranches（for-each-ref "refname\tHEAD\tupstream:short\tupstream:track"）
export function parseBranches(raw: string): BranchInfo[] {
  const result: BranchInfo[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const parts = line.split("\t");
    const refname = parts[0] ?? "";
    if (!refname.startsWith("refs/heads/") && !refname.startsWith("refs/remotes/")) continue;
    if (refname.includes("/HEAD")) continue;

    const isRemote = refname.startsWith("refs/remotes/");
    const name = isRemote ? refname.slice("refs/remotes/".length) : refname.slice("refs/heads/".length);
    const isCurrent = parts.length > 1 && parts[1] === "*";
    let upstream: string | null = null;
    let ahead = 0;
    let behind = 0;
    let gone = false;
    if (parts.length > 2 && parts[2]) upstream = parts[2];
    if (parts.length > 3 && parts[3]) {
      const nums = matchInts(parts[3], ["ahead", "behind"]);
      ahead = nums["ahead"] ?? 0;
      behind = nums["behind"] ?? 0;
      gone = parts[3].includes("gone");
    }
    result.push({ name, isCurrent, isRemote, upstream, ahead, behind, gone });
  }
  return result;
}

/// graph 线条前缀着色 token（平移 LogHighlighter.graphPrefixAttr）
export function graphTokens(graph: string): { ch: string; cls: string }[] {
  return [...graph].map((ch) => ({
    ch,
    cls:
      ch === "*"
        ? "g-star"
        : ch === "|"
          ? "g-pipe"
          : ch === "\\" || ch === "/" || ch === "_"
            ? "g-corner"
            : "g-dim",
  }));
}

/// conventional commits 着色 token（平移 LogHighlighter.highlightMessage）
export function messageTokens(message: string): { text: string; cls: string }[] {
  const typeColors: Record<string, string> = {
    feat: "t-feat", fix: "t-fix", docs: "t-docs", style: "t-style",
    refactor: "t-refactor", perf: "t-perf", test: "t-test",
    chore: "t-gray", build: "t-gray", ci: "t-gray", revert: "t-revert",
  };
  for (const t of Object.keys(typeColors)) {
    // 支持 feat: / feat(scope): / feat! 三种 conventional commits 形式
    const idx = message.startsWith(`${t}:`) || message.startsWith(`${t}(`)
      ? t.length
      : message.startsWith(`${t}!`)
        ? t.length + 1
        : -1;
    if (idx < 0) continue;
    // 中间的 "(scope):" 或 "!" 用次要色
    const colon = message.indexOf(":", idx);
    if (colon < 0) continue;
    return [
      { text: message.slice(0, colon + 1), cls: typeColors[t] },
      { text: message.slice(colon + 1), cls: "t-body" },
    ];
  }
  return [{ text: message, cls: "t-body" }];
}

/// 平移 parseLog（\x1e 记录分隔、\x1f 字段分隔，graph 前缀在记录之外）
export function parseLog(raw: string): LogRow[] {
  const rows: LogRow[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const rs = line.indexOf("\u001e");
    if (rs < 0) {
      rows.push({ kind: "graph", text: line });
      continue;
    }
    const graphPrefix = line.slice(0, rs);
    const body = line.slice(rs + 1);
    const fields = body.split("\u001f");
    if (fields.length < 6 || !fields[0]) {
      rows.push({ kind: "graph", text: line });
      continue;
    }
    const date = parseGitDate(fields[3]) ?? new Date();
    const decor = fields[5].replace(/^[ ()]+|[ ()]+$/g, "");
    const refs = decor ? decor.split(", ") : [];
    // %S 原始为 refs/heads/xxx / refs/remotes/origin/xxx，去前缀便于展示
    let source = fields.length > 6 ? fields[6] : "";
    if (source.startsWith("refs/heads/")) source = source.slice("refs/heads/".length);
    else if (source.startsWith("refs/remotes/")) source = source.slice("refs/remotes/".length);
    const commit: CommitEntry = {
      id: fields[0],
      shortHash: fields[1],
      graph: graphPrefix + " ",
      author: fields[2],
      date,
      subject: fields[4],
      refs,
      source: source || undefined,
    };
    rows.push({ kind: "commit", commit });
  }
  return rows;
}

/// stash 列表解析（stash list --format="%gd%x1f%s"）
export function parseStashes(raw: string): { index: number; message: string }[] {
  const out: { index: number; message: string }[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const segs = line.split("\u001f");
    if (segs.length < 2) continue;
    const m = segs[0].match(/\{(\d+)\}/);
    if (!m) continue;
    out.push({ index: parseInt(m[1], 10), message: segs[1] });
  }
  return out;
}

export function fileChangeEquals(a: FileChange[], b: FileChange[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
