// 平移 GitDeck SyntaxHighlight.swift 的 diff 解析 / 上下文展开 / 行级回退补丁构造。
// 三个核心算法与 Swift 版逐条对应，且经过真实 git 仓库端到端验证：
// 1. parseDiffHunks：unified diff → hunk 卡片数据（含双侧行号与可回滚补丁）
// 2. rebuildExpanded：GitLab MR 式上下文展开（±20 行，相邻块去重，文件边界截断）
// 3. workingLinePatch：行级回退的正向补丁（不能用 git apply -R：-R 要求 - 行
//    内容已存在于文件中，「恢复被删除的行」必失败；正向补丁以当前状态为旧侧，
//    - 行在当前文件本就不存在，跳过后素材天然连续）

import type { DiffHunkDisplay, LineInfo, ParsedHunk } from "./types";

/// 从 hunk header 解析某一侧（"-" 旧 / "+" 新）的起始行与行数。
/// 单行区间省略 ",count"（@@ -5 +5 @@）按 1 行处理；解析失败按 0/0。
export function parseHunkSide(header: string, marker: "-" | "+"): { start: number; count: number } {
  const idx = header.indexOf(marker);
  if (idx < 0) return { start: 0, count: 0 };
  let rest = header.slice(idx + 1);
  const digits = rest.match(/^\d+/);
  if (!digits) return { start: 0, count: 0 };
  const start = parseInt(digits[0], 10);
  rest = rest.slice(digits[0].length);
  let count = 1;
  if (rest.startsWith(",")) {
    const c = rest.slice(1).match(/^\d+/);
    if (c) count = parseInt(c[0], 10);
  }
  return { start, count };
}

/// 从 diff 原文的文件头提取 "--- a/old" 的旧路径（rename 时与 +++ 侧不同），
/// 供展开上下文时读取旧版本内容；/dev/null（新文件）或解析失败返回 null
export function oldPathFromRawDiff(raw: string): string | null {
  for (const line of raw.split("\n")) {
    if (line.startsWith("@@")) break; // 文件头结束，正文里也可能有 "--- " 开头的行
    if (!line.startsWith("--- ")) continue;
    let p = line.slice(4).trim();
    p = p.split("\t")[0]; // 去掉可能携带的时间戳
    if (p === "/dev/null") return null;
    if (p.startsWith('"') && p.endsWith('"') && p.length >= 2) p = p.slice(1, -1);
    if (p.startsWith("a/")) p = p.slice(2);
    return p || null;
  }
  return null;
}

function fileHeaderOf(patch: string): string[] {
  // prefix 语义：收集第一个 @@ 之前的行（hunk 正文不以 @@ 开头的行不算文件头）
  const out: string[] = [];
  for (const line of patch.split("\n")) {
    if (line.startsWith("@@")) break;
    out.push(line);
  }
  return out;
}

function gutterWidthOf(infos: LineInfo[]): number {
  let w = 0;
  for (const i of infos) {
    if (i.old !== null) w = Math.max(w, String(i.old).length);
    if (i.new !== null) w = Math.max(w, String(i.new).length);
  }
  return w || 2;
}

/// 把 unified diff 切成 hunk：文件头单独保留（构造单 hunk 补丁用），每块行带双侧行号
export function parseDiffHunks(raw: string): { fileHeader: string; hunks: ParsedHunk[] } {
  const headerLines: string[] = [];
  const rawHunks: { header: string; lines: string[] }[] = [];
  let current: { header: string; lines: string[] } | null = null;

  for (const line of raw.split("\n")) {
    if (line.startsWith("@@")) {
      if (current) rawHunks.push(current);
      current = { header: line, lines: [] };
    } else if (current) {
      current.lines.push(line);
    } else if (line !== "") {
      headerLines.push(line);
    }
  }
  if (current) rawHunks.push(current);

  const fileHeader = headerLines.join("\n");
  const hunks = rawHunks.map((h) => {
    // 整段 diff 末尾的 "\n" 被 split 成空元素挂在最后一个 hunk 上，它不是 diff 行
    let lines = h.lines;
    if (lines.length && lines[lines.length - 1] === "") lines = lines.slice(0, -1);
    const oldSide = parseHunkSide(h.header, "-");
    const newSide = parseHunkSide(h.header, "+");
    const oldStart = oldSide.start;
    const oldCount = oldSide.count;
    const newStart = newSide.start;
    const newCount = newSide.count;
    const oldEnd = oldStart + Math.max(oldCount - 1, 0);
    const newEnd = newStart + Math.max(newCount - 1, 0);
    const width = Math.max(
      String(Math.max(oldEnd, 1)).length,
      String(Math.max(newEnd, 1)).length,
    );
    const numbered: LineInfo[] = [];
    let oldLine = oldStart;
    let newLine = newStart;
    for (const l of lines) {
      // 逐行推算两侧行号：+ 行只有新号，- 行只有旧号，上下文双号同进，"\ No newline" 不占行号
      let showOld: number | null = null;
      let showNew: number | null = null;
      switch (l[0]) {
        case "+":
          showNew = newLine; newLine += 1;
          break;
        case "-":
          showOld = oldLine; oldLine += 1;
          break;
        case "\\":
          break;
        default:
          showOld = oldLine; oldLine += 1;
          showNew = newLine; newLine += 1;
      }
      numbered.push({ old: showOld, new: showNew, text: l });
    }
    // git apply 要求补丁以换行结尾，否则报 corrupt patch
    const patch = [...headerLines, h.header, ...lines].join("\n") + "\n";
    return {
      header: h.header,
      oldStart,
      oldCount,
      newStart,
      newCount,
      newEnd,
      gutterWidth: width,
      lines,
      numberedLines: numbered,
      patch,
    };
  });
  return { fileHeader, hunks };
}

/// 等价 Swift DiffHunkDisplay.init(from:)
export function makeHunkDisplay(
  id: number,
  parsed: ParsedHunk,
  title: string,
  canRollback: boolean,
  allowExpand: boolean,
): DiffHunkDisplay {
  return {
    id,
    title,
    patch: parsed.patch,
    canRollback,
    canExpand: allowExpand && parsed.oldStart >= 1,
    aboveLimit: parsed.oldCount > 0 ? parsed.oldStart - 1 : parsed.oldStart,
    oldStart: parsed.oldStart,
    oldEnd: parsed.oldStart + Math.max(parsed.oldCount - 1, 0),
    newStart: parsed.newStart,
    newEnd: parsed.newEnd,
    aboveOffset:
      parsed.newStart - parsed.oldStart +
      (parsed.oldCount > 0 ? 0 : -1) +
      (parsed.newCount > 0 ? 0 : 1),
    numberedLines: parsed.numberedLines,
    gutterWidth: parsed.gutterWidth,
    expandAbove: 0,
    expandBelow: 0,
    availableAbove: null,
    availableBelow: null,
  };
}

/// 渲染行合成：原始块行 + 展开的上下文（与 Swift rebuildExpanded 的 infos 一致）
export function displayLines(hunk: DiffHunkDisplay, oldLines: string[]): LineInfo[] {
  const infos: LineInfo[] = [];
  if (hunk.expandAbove > 0) {
    for (let j = hunk.aboveLimit - hunk.expandAbove + 1; j <= hunk.aboveLimit; j++) {
      if (j < 1 || j > oldLines.length) continue;
      infos.push({ old: j, new: j + hunk.aboveOffset, text: " " + oldLines[j - 1] });
    }
  }
  infos.push(...hunk.numberedLines);
  for (let k = 0; k < hunk.expandBelow; k++) {
    const j = hunk.oldEnd + 1 + k;
    if (j > oldLines.length) break;
    infos.push({ old: j, new: j + (hunk.newEnd - hunk.oldEnd), text: " " + oldLines[j - 1] });
  }
  return infos;
}

/// 按累计目标展开 ±20 行：上/下独立累计，相邻块已铺的间隙行不重复，文件边界截断。
/// 返回新块与本次是否真的多展开了（平移 AppState.rebuildExpanded）
export function rebuildExpanded(
  hunk: DiffHunkDisplay,
  direction: "up" | "down",
  oldLines: string[],
  neighbors: DiffHunkDisplay[],
  index: number,
): { hunk: DiffHunkDisplay; grew: boolean } {
  const prevEnd = index > 0 ? neighbors[index - 1].oldEnd : 0;
  const prevCovered =
    index > 0 && neighbors[index - 1].expandBelow > 0
      ? Math.min(prevEnd + neighbors[index - 1].expandBelow, hunk.aboveLimit)
      : prevEnd;
  const availAbove = Math.max(0, hunk.aboveLimit - prevCovered);
  const nextLimit = index < neighbors.length - 1 ? neighbors[index + 1].aboveLimit : oldLines.length;
  const nextCoveredStart =
    index < neighbors.length - 1 && neighbors[index + 1].expandAbove > 0
      ? Math.max(neighbors[index + 1].aboveLimit - neighbors[index + 1].expandAbove + 1, hunk.oldEnd + 1)
      : nextLimit + 1;
  const availBelow = Math.max(0, nextCoveredStart - 1 - hunk.oldEnd);

  let targetAbove = hunk.expandAbove;
  let targetBelow = hunk.expandBelow;
  if (direction === "up") targetAbove = Math.max(hunk.expandAbove, Math.min(hunk.expandAbove + 20, availAbove));
  else targetBelow = Math.max(hunk.expandBelow, Math.min(hunk.expandBelow + 20, availBelow));
  const grew = targetAbove !== hunk.expandAbove || targetBelow !== hunk.expandBelow;

  const updated: DiffHunkDisplay = {
    ...hunk,
    expandAbove: targetAbove,
    expandBelow: targetBelow,
    availableAbove: availAbove,
    availableBelow: availBelow,
  };
  return { hunk: updated, grew };
}

function escapePatchLine(line: string): string {
  // 补丁文件原样写（UTF-8），无需转义
  return line;
}

/// 工作区行级回退的正向补丁：旧侧 = 当前状态（工作区或 index），新侧 = 回退掉这一行之后。
/// 素材 = hunk 内"存在于当前版本"的行（上下文行与 + 行）；- 行在当前版本本来就不存在，
/// 跳过后素材在当前文件里天然连续，git apply 能稳定定位。目标 + 行转为删除行、- 行转为插入行。
/// （平移 AppState.workingLinePatch，签名接收纯数据便于单测）
export function workingLinePatch(
  lines: LineInfo[],
  patch: string,
  rawIndex: number,
): string | null {
  if (rawIndex < 0 || rawIndex >= lines.length) return null;
  const target = lines[rawIndex];
  const marker = target.text[0];
  if (marker !== "+" && marker !== "-") return null;
  const isAdd = marker === "+";

  // 窗口：目标行 + 两侧各最多 3 个当前侧素材行（上下文行 / + 行）。
  // - 行与 "\ No newline" 行不算素材也不中断收集（它们不在当前版本里，跳过后素材仍连续）
  const window = new Set<number>([rawIndex]);
  const collect = (step: number) => {
    let i = rawIndex + step;
    let taken = 0;
    while (i >= 0 && i < lines.length && taken < 3) {
      const first = lines[i].text[0];
      if (first === "-" || first === "\\") { i += step; continue; }
      if ((first === " " || first === "+") && lines[i].new !== null) {
        window.add(i);
        taken += 1;
        i += step;
      } else break;
    }
  };
  collect(-1);
  collect(1);
  // "\ No newline at end of file" 跟随其修饰行：修饰行入选补丁则标记一并带上
  lines.forEach((l, i) => {
    if (l.text.startsWith("\\") && window.has(i - 1)) window.add(i);
  });

  // 补丁正文（按文件顺序）：
  //   上下文行 ' x' → ' x'（当前、新两侧都有）
  //   + 行：目标 → '-x'（当前有、回退后无）；非目标 → ' x'（当前版本里的普通行）
  //   - 行：目标 → '+x'（当前无、回退后有）；非目标不在窗口
  //   "\ No newline" 行原样，不计数
  const body: string[] = [];
  let curCount = 0;
  let nextCount = 0;
  const sorted = [...window].sort((a, b) => a - b);
  for (const i of sorted) {
    const t = lines[i].text;
    switch (t[0]) {
      case "\\":
        body.push(escapePatchLine(t));
        break;
      case "+":
        if (i === rawIndex) {
          body.push("-" + t.slice(1));
          curCount += 1;
        } else {
          body.push(" " + t.slice(1));
          curCount += 1;
          nextCount += 1;
        }
        break;
      case "-":
        if (i === rawIndex) {
          body.push("+" + t.slice(1));
          nextCount += 1;
        }
        break;
      default:
        body.push(escapePatchLine(t));
        curCount += 1;
        nextCount += 1;
    }
  }
  // 两侧都要有行（零上下文补丁 git apply 默认拒绝），至少一侧为空就交给块回滚
  if (curCount <= 0 || nextCount <= 0) return null;
  // 当前侧起始行号 = 窗口第一个普通行的 new 号（- 行没有 new 号，被跳过）
  const start = sorted
    .filter((i) => !lines[i].text.startsWith("\\"))
    .map((i) => lines[i].new)
    .find((n) => n !== null);
  if (start === undefined || start === null) return null;

  const out = fileHeaderOf(patch);
  out.push(`@@ -${start},${curCount} +${start},${nextCount} @@`);
  out.push(...body);
  return out.join("\n") + "\n";
}

/// 是否图片文件（平移 GitCommander.isImageFile）
export function isImageFile(path: string): boolean {
  const ext = (path.split(".").pop() ?? "").toLowerCase();
  return ["png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff", "tif", "icns", "heic", "svg"].includes(ext);
}
