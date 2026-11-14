// 平移 GitPanels.swift 的变更页：左侧文件分组列表（500 上限 + 溢出提示），右侧 diff 面板

import React, { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import type { ChangeLocation, FileChange } from "../core/types";
import { fileBadge, fileKey } from "../core/types";
import { HunkCard } from "./HunkCard";

const MAX_ROWS = 500;

function SectionHead({ title, count, color, action, actionTitle }: {
  title: string; count: number; color: string; action?: () => void; actionTitle?: string;
}) {
  return (
    <div className="section-head">
      <span className="section-dot" style={{ background: color }} />
      <span>{title} ({count})</span>
      <span style={{ flex: 1 }} />
      {count > 0 && action && (
        <button className="icon-btn" onClick={action} title={actionTitle ?? "全部暂存 (git add -A / -u)"}>⧉</button>
      )}
    </div>
  );
}

function OverflowNote({ total }: { total: number }) {
  if (total <= MAX_ROWS) return null;
  return (
    <div className="overflow-note">
      <span>⚠️</span>
      <span>还有 {total - MAX_ROWS} 个文件未显示（共 {total}）。数量异常通常是误 add 了构建产物或工具缓存，建议在终端按目录处理，如 git restore --staged &lt;目录&gt;</span>
    </div>
  );
}

function FileRow({ change, kind }: { change: FileChange; kind: ChangeLocation }) {
  const store = useStore();
  const active = store.selectedChangePath === change.path;
  const badge = fileBadge(change);
  const badgeColor = change.conflictCode ? "#e2a35c" : change.staged === "?" || badge === "??"
    ? "#e27474" : change.unstaged ? "#e2a35c" : "#6bd66b";
  return (
    <div className={`file-row${active ? " active" : ""}`} onClick={() => void store.loadDiff(change)}>
      <span className="file-badge" style={{ color: badgeColor }}>{badge}</span>
      <span className="file-path" title={change.path}>{change.path}</span>
      <span className="file-actions">
        {kind === "conflict" && (
          <button className="icon-btn" title="标记已解决（解决后 git add）"
            onClick={(e) => { e.stopPropagation(); void store.stage(change.path); }}>✓</button>
        )}
        {kind === "staged" && (
          <>
            <button className="icon-btn" title="取消暂存 git restore --staged"
              onClick={(e) => { e.stopPropagation(); void store.unstage(change.path); }}>−</button>
            <button className="icon-btn" title="取消跟踪 git rm --cached（不写 .gitignore）"
              onClick={(e) => { e.stopPropagation(); void store.untrackFile(change.path); }}>⊘</button>
            <button className="icon-btn" title="GitDeck 忽略（仅本列表隐藏，不改 git 文件）"
              onClick={(e) => { e.stopPropagation(); store.gitdeckIgnoreFile(change.path); }}>👁</button>
          </>
        )}
        {kind === "unstaged" && (
          <>
            <button className="icon-btn" title="暂存 git add"
              onClick={(e) => { e.stopPropagation(); void store.stage(change.path); }}>＋</button>
            <button className="icon-btn" title="丢弃修改 git restore（危险）"
              onClick={(e) => { e.stopPropagation(); void store.discard(change.path); }}>↩</button>
            <button className="icon-btn" title="GitDeck 忽略（仅本列表隐藏）"
              onClick={(e) => { e.stopPropagation(); store.gitdeckIgnoreFile(change.path); }}>👁</button>
          </>
        )}
        {kind === "untracked" && (
          <>
            <button className="icon-btn" title="暂存 git add"
              onClick={(e) => { e.stopPropagation(); void store.stage(change.path); }}>＋</button>
            <button className="icon-btn" title="删除文件 git clean -f（危险）"
              onClick={(e) => { e.stopPropagation(); void store.deleteUntrackedFile(change.path); }}>🗑</button>
          </>
        )}
      </span>
    </div>
  );
}

function FileGroup({ title, count, color, files, kind, action }: {
  title: string; count: number; color: string; files: FileChange[]; kind: ChangeLocation; action?: () => void;
}) {
  return (
    <>
      <SectionHead title={title} count={count} color={color} action={action} />
      {files.slice(0, MAX_ROWS).map((c) => <FileRow key={fileKey(c)} change={c} kind={kind} />)}
      <OverflowNote total={count} />
    </>
  );
}

function CommitBar() {
  const store = useStore();
  const [stashMsg, setStashMsg] = useState("");
  const stagedCount = store.status.staged.length;
  return (
    <div className="commit-bar">
      <textarea
        rows={2}
        placeholder="提交说明（git commit -m）"
        value={store.commitMessage}
        onChange={(e) => store.setCommitMessage(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") void store.commit(store.commitMessage, store.amend);
        }}
      />
      <div className="commit-actions">
        <button className="btn primary" disabled={!stagedCount}
          onClick={() => void store.commit(store.commitMessage, store.amend)}>提交 (Ctrl+Enter)</button>
        <label className="checkbox-label">
          <input type="checkbox" checked={store.amend} onChange={(e) => store.setAmend(e.target.checked)} />
          修补上次提交 (amend)
        </label>
        <span style={{ flex: 1 }} />
        <input type="text" placeholder="stash 说明（可空）" style={{ width: 160 }}
          value={stashMsg} onChange={(e) => setStashMsg(e.target.value)} />
        <button className="btn" title="git stash push -u" onClick={() => void store.stashPush(true, stashMsg)}>暂存到 stash</button>
      </div>
    </div>
  );
}

function ImageDiffPanel() {
  const img = useStore((s) => s.imageDiff);
  if (!img) return null;
  return (
    <div className="img-diff">
      <figure>
        {img.oldSrc ? <img src={img.oldSrc} alt="旧版" /> : <div className="dim">（无旧版）</div>}
        <figcaption>旧版 {img.note ? `· ${img.note}` : ""}</figcaption>
      </figure>
      <figure>
        {img.newSrc ? <img src={img.newSrc} alt="新版" /> : <div className="dim">（无新版）</div>}
        <figcaption>新版</figcaption>
      </figure>
    </div>
  );
}

function DiffPane() {
  const store = useStore();
  const path = store.selectedChangePath;
  if (!path) {
    return (
      <div className="diff-pane">
        <div style={{ padding: 20 }} className="dim">点击左侧文件查看 diff（对应命令 git diff -- &lt;file&gt;）</div>
      </div>
    );
  }
  const kind = store.selectedChangeKind;
  return (
    <div className="diff-pane">
      <div className="diff-head">
        <span className="diff-path">{path}</span>
        {kind === "unstaged" && (
          <button className="btn danger" onClick={() => void store.discard(path)} title="git restore -- <file>，丢弃工作区修改（危险）">回退改动</button>
        )}
        {kind === "staged" && (
          <>
            <button className="btn" onClick={() => void store.unstage(path)}>取消暂存</button>
            <button className="btn danger" onClick={() => void store.discardAllChangesOfFile(path)} title="git checkout HEAD -- <file>，丢弃已暂存+未暂存全部改动（危险）">回退全部</button>
          </>
        )}
        {kind === "untracked" && (
          <button className="btn danger" onClick={() => void store.deleteUntrackedFile(path)} title="git clean -f -- <file>，未跟踪文件删除后无法恢复（危险）">删除文件</button>
        )}
        <button className="icon-btn" title="复制 diff"
          onClick={() => { void navigator.clipboard.writeText(store.diffFullText); store.showToast("已复制完整 diff", false); }}>⧉</button>
      </div>
      {store.diffTruncatedNote && (
        <div className="truncate-banner"><span>⚠️</span><span>{store.diffTruncatedNote}</span></div>
      )}
      <div className="diff-scroll">
        {store.imageDiff ? (
          <ImageDiffPanel />
        ) : store.diffHunks.length > 0 ? (
          store.diffHunks.map((h) => <HunkCard key={h.id} hunk={h} scene="working" />)
        ) : (
          <pre className="mono" style={{ padding: 8, whiteSpace: "pre-wrap", wordBreak: "break-all", userSelect: "text", fontSize: 11 }}>{store.diffText}</pre>
        )}
      </div>
    </div>
  );
}

export function ChangesView() {
  const store = useStore();
  const s = store.status;
  const ignored = store.gitdeckIgnored;
  // 历史 commit 面板与变更页共用 store.imageDiff 通道之外，还有 commitImageDiff（见 HistoryView）
  void useRef;
  void useEffect;
  void useState;
  return (
    <div className="changes-split">
      <div className="file-pane">
        {s.conflicted.length > 0 && (
          <FileGroup title="冲突" count={s.conflicted.length} color="#e27474" files={s.conflicted} kind="conflict" />
        )}
        <FileGroup title="暂存区" count={s.staged.length} color="#6bd66b" files={s.staged} kind="staged" action={() => void store.stageAll()} />
        <FileGroup title="未暂存" count={s.unstaged.length} color="#e2a35c" files={s.unstaged} kind="unstaged" action={() => void store.stageAll()} />
        <FileGroup title="未跟踪" count={s.untracked.length} color="#e27474" files={s.untracked} kind="untracked" action={() => void store.stageAll()} />
        {ignored.length > 0 && (
          <div style={{ padding: "8px 10px" }}>
            <div className="dim" style={{ fontSize: 11, marginBottom: 4 }}>GitDeck 忽略的文件（{ignored.length}）</div>
            {ignored.map((p) => (
              <div key={p} className="file-row" onClick={() => store.gitdeckUnignore(p)} title="点击恢复显示">
                <span className="file-badge">👁</span><span className="file-path">{p}</span>
              </div>
            ))}
          </div>
        )}
        {!s.conflicted.length && !s.staged.length && !s.unstaged.length && !s.untracked.length && (
          <div style={{ textAlign: "center", padding: "40px 0" }} className="dim">✓ 工作区干净，没有待处理的变更</div>
        )}
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <DiffPane />
        <CommitBar />
      </div>
    </div>
  );
}
