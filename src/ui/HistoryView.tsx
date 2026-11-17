// 平移 GitPanels.swift 的历史页：graph 列表（筛选）+ 提交详情（文件清单 + hunk 卡全套交互 + merge included）

import React, { useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { fullTime, graphTokens, messageTokens, relativeTime } from "../core/parse";
import type { BranchInfo, CommitEntry } from "../core/types";
import { HunkCard } from "./HunkCard";

function GraphPrefix({ text }: { text: string }) {
  return (
    <span className="log-graph">
      {graphTokens(text).map((t, i) => <span key={i} className={t.cls}>{t.ch}</span>)}
    </span>
  );
}

function Subject({ text }: { text: string }) {
  return (
    <span>
      {messageTokens(text).map((t, i) => <span key={i} className={t.cls}>{t.text}</span>)}
    </span>
  );
}

function CommitRow({ c, active }: { c: CommitEntry; active: boolean }) {
  const store = useStore();
  return (
    <div className={`log-row commit-row${active ? " active" : ""}`} onClick={() => void store.selectCommit(c)}>
      <GraphPrefix text={c.graph} />
      <span className="log-hash">{c.shortHash}</span>
      <span className="log-refs">
        {c.refs.map((r) => (
          <span key={r} className={`ref-capsule${r.startsWith("origin/") || r.startsWith("tag:") ? " remote" : ""}`}>
            {r.startsWith("tag:") ? r : r.replace(/^HEAD -> /, "")}
          </span>
        ))}
      </span>
      <Subject text={c.subject} />
      <span style={{ flex: 1 }} />
      <span className="log-time">{relativeTime(c.date)}</span>
      <span className="log-author">{c.author}</span>
      {c.source && <span className="dim">[{c.source}]</span>}
    </div>
  );
}

function CommitDetailPane() {
  const store = useStore();
  const d = store.commitDetail;
  const c = store.selectedCommit;
  if (!c) return <div style={{ padding: 20 }} className="dim">点击左侧提交查看详情</div>;
  if (!d) return <div style={{ padding: 20 }} className="dim">加载提交详情…</div>;
  return (
    <div className="commit-detail">
      <div className="commit-meta">
        {d.fullHash.slice(0, 7)} · {d.author} · {fullTime(d.date)}
        {store.selectedCommitIsMerge && " · merge 提交（与第一父比较）"}
      </div>
      <div className="commit-msg">{d.message}</div>

      {store.selectedCommitIsMerge && (
        <>
          <div style={{ fontSize: 11, fontWeight: 600, margin: "8px 0 4px" }}>被合入的提交（{store.includedCommits.length}）</div>
          <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
            <button className={`pill-btn${store.includedScope === "branchCommits" ? " blue" : ""}`}
              onClick={() => void store.setIncludedScope("branchCommits")}>分支自己的提交</button>
            <button className={`pill-btn${store.includedScope === "fullHistory" ? " blue" : ""}`}
              onClick={() => void store.setIncludedScope("fullHistory")}>全部引入历史</button>
            <button className={`pill-btn${store.includedScope === "firstParentChain" ? " blue" : ""}`}
              onClick={() => void store.setIncludedScope("firstParentChain")}>主线视角</button>
          </div>
          {store.includedCommits.map((e) => (
            <div key={e.hash}
              className={`included-row${store.expandedIncludedHash === e.hash ? " active" : ""}`}
              onClick={() => void store.toggleIncludedCommit(e.hash)}>
              <span className="log-hash">{e.hash}</span><span>{e.subject}</span>
            </div>
          ))}
          {store.includedLoading && <div className="dim" style={{ fontSize: 11, padding: "6px 8px" }}>加载该提交的改动…</div>}
          {store.includedHunks.map((h) => <HunkCard key={h.id} hunk={h} scene="commitFile" />)}
        </>
      )}

      <div style={{ fontSize: 11, fontWeight: 600, margin: "8px 0 4px" }}>改动的文件（{d.files.length}）</div>
      {d.files.length === 0 && <div className="dim">（初始提交，没有可对比的父版本）</div>}
      {d.files.map((f) => {
        const active = store.commitPreviewPath === f.path;
        return (
          <div key={`${f.status}\u0001${f.path}`} className={`file-row${active ? " active" : ""}`}
            onClick={() => void store.selectCommitFile(f)}>
            <span className="file-badge" style={{ color: f.status === "A" ? "#6bd66b" : f.status === "D" ? "#e27474" : "#e2a35c" }}>{f.status}</span>
            <span className="file-path">{f.path}</span>
          </div>
        );
      })}

      {store.commitImageDiff && (
        <div className="img-diff">
          <figure>
            {store.commitImageDiff.oldSrc ? <img src={store.commitImageDiff.oldSrc} alt="旧版" /> : <div className="dim">（无旧版）</div>}
            <figcaption>旧版 {store.commitImageDiff.note ? `· ${store.commitImageDiff.note}` : ""}</figcaption>
          </figure>
          <figure>
            {store.commitImageDiff.newSrc ? <img src={store.commitImageDiff.newSrc} alt="新版" /> : <div className="dim">（无新版）</div>}
            <figcaption>新版</figcaption>
          </figure>
        </div>
      )}

      {!store.commitImageDiff && store.commitFileHunks.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {store.commitFileHunks.map((h) => <HunkCard key={h.id} hunk={h} scene="commitFile" />)}
        </div>
      )}
    </div>
  );
}

export function HistoryView() {
  const store = useStore();
  const [filterDraft, setFilterDraft] = useState("");
  const [authorDraft, setAuthorDraft] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [branchSearch, setBranchSearch] = useState("");
  // 左右分栏可拖拽:宽度百分比记 localStorage(25%~75%),默认 46%
  const splitRef = useRef<HTMLDivElement>(null);
  const [logWidth, setLogWidth] = useState(() => {
    const v = Number(localStorage.getItem("gitdeck.logWidth"));
    return v >= 25 && v <= 75 ? v : 46;
  });
  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const rect = splitRef.current?.getBoundingClientRect();
    if (!rect) return;
    const onMove = (ev: MouseEvent) => {
      const pct = Math.min(75, Math.max(25, ((ev.clientX - rect.left) / rect.width) * 100));
      setLogWidth(Math.round(pct * 10) / 10);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setLogWidth((w) => { localStorage.setItem("gitdeck.logWidth", String(w)); return w; });
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  const rows = useMemo(() => {
    const kw = store.logFilterText.trim().toLowerCase();
    const author = store.logAuthorFilter?.toLowerCase() ?? "";
    return store.commitRows.filter((row) => {
      if (row.kind !== "commit") return true;
      if (kw) {
        const hit = row.commit.subject.toLowerCase().includes(kw)
          || row.commit.id.toLowerCase().includes(kw)
          || row.commit.author.toLowerCase().includes(kw);
        if (!hit) return false;
      }
      if (author && !row.commit.author.toLowerCase().includes(author)) return false;
      return true;
    });
  }, [store.commitRows, store.logFilterText, store.logAuthorFilter]);

  // 分支筛选:默认收起,点击展开分组+搜索面板(分支多时不再一次性全量倒出)
  const q = branchSearch.trim().toLowerCase();
  const hit = (name: string) => !q || name.toLowerCase().includes(q);
  const pickerLocals = store.branches.filter((b) => !b.isRemote && hit(b.name));
  const pickerRemotes = store.branches.filter((b) => b.isRemote && hit(b.name));
  const applyBranch = (name: string | null) => {
    void store.setLogFilter(store.logFilterText, store.logAuthorFilter, name, store.logFirstParentOnly);
    setPickerOpen(false);
    setBranchSearch("");
  };
  const branchRow = (b: BranchInfo) => (
    <div key={b.name} className={`bp-row${store.logBranchFilter === b.name ? " active" : ""}`}
      onClick={() => applyBranch(b.name)}>
      <span>{b.isCurrent ? "✓ " : ""}{b.name}</span>
      {b.upstream && <span className="dim" style={{ fontSize: 11 }}>→ {b.upstream}</span>}
    </div>
  );

  return (
    <div className="history-split" ref={splitRef}>
      <div className="log-pane" style={{ width: `${logWidth}%` }}>
        <div className="log-filters">
          <input type="text" placeholder="说明 / hash / 作者" style={{ flex: 2, minWidth: 120 }}
            value={filterDraft}
            onChange={(e) => setFilterDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void store.setLogFilter(filterDraft, authorDraft || null, store.logBranchFilter, store.logFirstParentOnly); }}
          />
          <input type="text" placeholder="作者" style={{ flex: 1, minWidth: 70 }}
            value={authorDraft}
            onChange={(e) => setAuthorDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void store.setLogFilter(filterDraft, authorDraft || null, store.logBranchFilter, store.logFirstParentOnly); }}
          />
          <div style={{ position: "relative" }}>
            <button className="btn" title="按分支筛选（点击展开）"
              onClick={() => setPickerOpen(!pickerOpen)}>
              分支: {store.logBranchFilter ?? "全部"} ▾
            </button>
            {pickerOpen && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 25 }} onClick={() => setPickerOpen(false)} />
                <div className="branch-picker" style={{ zIndex: 30 }}>
                  <input type="text" placeholder="搜索分支…" autoFocus
                    value={branchSearch} onChange={(e) => setBranchSearch(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Escape") setPickerOpen(false); }} />
                  <div className={`bp-row${!store.logBranchFilter ? " active" : ""}`}
                    onClick={() => applyBranch(null)}>
                    <span>全部分支（--all）</span>
                  </div>
                  {pickerLocals.length > 0 && <div className="bp-group">本地分支（{pickerLocals.length}）</div>}
                  {pickerLocals.map(branchRow)}
                  {pickerRemotes.length > 0 && <div className="bp-group">远程分支（{pickerRemotes.length}）</div>}
                  {pickerRemotes.map(branchRow)}
                  {pickerLocals.length + pickerRemotes.length === 0 && (
                    <div className="dim" style={{ padding: "4px 8px" }}>没有匹配「{branchSearch.trim()}」的分支</div>
                  )}
                </div>
              </>
            )}
          </div>
          <label className="checkbox-label" title="每个 merge 只显示一条，不展开被合分支内部">
            <input type="checkbox" checked={store.logFirstParentOnly}
              onChange={(e) => void store.setLogFilter(store.logFilterText, store.logAuthorFilter, store.logBranchFilter, e.target.checked)} />
            仅第一父级
          </label>
        </div>
        <div className="log-list">
          {rows.map((row, i) =>
            row.kind === "graph" ? (
              <div key={i} className="log-row"><GraphPrefix text={row.text} /></div>
            ) : (
              <CommitRow key={row.commit.id + i} c={row.commit} active={store.selectedCommit?.id === row.commit.id} />
            ),
          )}
        </div>
      </div>
      <div className="split-handle" onMouseDown={startDrag} title="拖动调整左右宽度" />
      <CommitDetailPane />
    </div>
  );
}
