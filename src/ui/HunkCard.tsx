// 平移 HunkCardView.swift：diff 块卡片（标题栏 + 上/下展开条 + 逐行渲染 + 行级回退按钮 + 回滚区块）
// 展开条仿 GitLab MR：点一次铺 20 行，可连续点直到文件边界；展开区铺淡蓝底色。
// 超大块（>800 行）退回整块渲染，行级回退交给「回滚区块」。

import React from "react";
import type { DiffHunkDisplay, ExpandDirection, DiffScene, LineInfo } from "../core/types";
import { hunkIsExpanded } from "../core/types";
import { useStore } from "../store";

const MAX_INTERACTIVE_LINES = 800;

function lineClass(info: LineInfo): string {
  const t = info.text;
  const trimmed = t.trim();
  if (trimmed.startsWith("<<<<<<<") || trimmed === "=======" || trimmed.startsWith(">>>>>>>") || trimmed.startsWith("|||||||")) return "line-conflict";
  if (t.startsWith("+++") || t.startsWith("---")) return "line-meta";
  if (t.startsWith("diff --git") || t.startsWith("index ") || t.startsWith("new file") || t.startsWith("deleted file") || t.startsWith("rename ") || t.startsWith("similarity ") || t.startsWith("old mode") || t.startsWith("new mode")) return "line-meta";
  if (t.startsWith("@@")) return "line-hunkhead";
  if (t.startsWith("+")) return "line-add";
  if (t.startsWith("-")) return "line-del";
  return "line-ctx";
}

function LineRow({ info, width, expanded, canRevert, onRevert }: {
  info: LineInfo;
  width: number;
  expanded: boolean;
  canRevert: boolean;
  onRevert?: () => void;
}) {
  const marker = info.text[0];
  const isChange = marker === "+" || marker === "-";
  const pad = (n: number | null) => (n === null ? " ".repeat(width) : String(n).padStart(width, " "));
  const cls = lineClass(info);
  return (
    <div className={`hunk-line ${cls}${expanded ? " line-expanded" : ""}`}>
      <span className="gutter">{pad(info.old)} {pad(info.new)}{"  "}</span>
      <span className="code">{info.text}</span>
      {isChange && canRevert && onRevert ? (
        <button
          className={`revert-btn ${marker === "+" ? "add" : "del"}`}
          onClick={onRevert}
          title={marker === "+" ? "回退此行：删除这行新增" : "回退此行：恢复这行被删除的内容"}
        >↩</button>
      ) : (
        <span style={{ width: 18, flex: "none" }} />
      )}
    </div>
  );
}

function ExpandBar({ up, hunk, onExpand }: { up: boolean; hunk: DiffHunkDisplay; onExpand: (d: ExpandDirection) => void }) {
  const expanded = up ? hunk.expandAbove : hunk.expandBelow;
  const available = up ? hunk.availableAbove : hunk.availableBelow;
  const exhausted = available !== null ? expanded >= available : false;
  const count = available !== null ? Math.min(20, Math.max(0, available - expanded)) : 20;
  if (exhausted) {
    return (
      <div className="expand-bar">
        <span className="exhausted">{up ? "↑ 已到文件顶部" : "↓ 已到文件底部"}</span>
      </div>
    );
  }
  return (
    <div className="expand-bar">
      <button className="ebtn" onClick={() => onExpand(up ? "up" : "down")}
        title="未改动的上下文代码，展开区有淡蓝底色；可连续点击直到边界">
        {up ? "↑" : "↓"} 展开{up ? "上方" : "下方"} {count} 行
      </button>
    </div>
  );
}

export function HunkCard({ hunk, scene }: { hunk: DiffHunkDisplay; scene: DiffScene }) {
  const store = useStore();
  const oldLines = scene === "working" ? store.workingOldLines : store.commitOldLines;
  const canInteractive = hunk.numberedLines.length <= MAX_INTERACTIVE_LINES;

  const lines = canInteractive && oldLines
    ? (() => {
        // 已拉取旧版内容时，展开区可实时渲染
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
        return { infos, width: Math.max(hunk.gutterWidth, ...infos.flatMap((i) => [i.old, i.new].filter((n): n is number => n !== null).map((n) => String(n).length))) };
      })()
    : null;

  return (
    <div className="hunk-card">
      <div className="hunk-titlebar">
        <span className="hunk-title">{hunk.title}</span>
        {hunkIsExpanded(hunk) && (
          <button className="pill-btn blue" onClick={() => store.collapseExpandContext(hunk, scene)}
            title="恢复原始 diff，去掉展开的上下文">收起上下文</button>
        )}
        {hunk.canRollback && scene === "working" && (
          <button className="pill-btn orange" onClick={() => void store.rollbackHunk(hunk)}
            title="git apply -R：仅反向应用这个区块的改动，其他改动保留">回滚区块</button>
        )}
        {hunk.canRollback && scene === "commitFile" && (
          <button className="pill-btn orange" onClick={() => void store.rollbackCommitHunk(hunk)}
            title="git apply -R：从当前代码中撤销这个区块的改动">回滚区块</button>
        )}
      </div>
      {hunk.canExpand && <ExpandBar up hunk={hunk} onExpand={(d) => void store.toggleExpandContext(hunk, d, scene)} />}
      <div className="hunk-body">
        {lines ? (
          lines.infos.map((info, i) => (
            <LineRow
              key={i}
              info={info}
              width={lines.width}
              expanded={i < hunk.expandAbove || i >= lines.infos.length - hunk.expandBelow}
              canRevert={hunk.canRollback && info.text[0] !== undefined && "+-".includes(info.text[0])}
              onRevert={() => void store.revertLine(hunk, i, scene)}
            />
          ))
        ) : canInteractive ? (
          hunk.numberedLines.map((info, i) => (
            <LineRow key={i} info={info} width={hunk.gutterWidth} expanded={false}
              canRevert={hunk.canRollback && "+-".includes(info.text[0])}
              onRevert={() => void store.revertLine(hunk, i, scene)} />
          ))
        ) : (
          hunk.numberedLines.map((info, i) => (
            <div key={i} className={`hunk-line ${lineClass(info)}`} style={{ cursor: "default" }}>
              <span className="gutter">{(info.old ?? "").toString().padStart(hunk.gutterWidth)} {(info.new ?? "").toString().padStart(hunk.gutterWidth)}{"  "}</span>
              <span className="code">{info.text}</span>
            </div>
          ))
        )}
      </div>
      {hunk.canExpand && <ExpandBar up={false} hunk={hunk} onExpand={(d) => void store.toggleExpandContext(hunk, d, scene)} />}
    </div>
  );
}
