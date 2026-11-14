// 平移分支页与 stash 页

import React, { useState } from "react";
import { useStore } from "../store";
import type { BranchInfo } from "../core/types";

export function BranchesView() {
  const store = useStore();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const locals = store.branches.filter((b) => !b.isRemote);
  const remotes = store.branches.filter((b) => b.isRemote);

  const row = (b: BranchInfo) => {
    const track = b.gone
      ? "上游已删除"
      : b.ahead || b.behind ? `↑${b.ahead} ↓${b.behind}` : "";
    return (
      <div key={b.name} className="branch-row">
        <span className={`branch-name${b.isCurrent ? " current" : ""}`}>
          {b.isCurrent ? "✓ " : ""}{b.name}
          {track && <span className="track-info" style={{ marginLeft: 8 }}>{track}</span>}
          {b.upstream && <span className="track-info" style={{ marginLeft: 8 }}>→ {b.upstream}</span>}
        </span>
        {!b.isCurrent && (
          <>
            <button className="icon-btn" title="检出 git checkout" onClick={() => void store.checkoutBranch(b)}>⤵</button>
            {renaming === b.name ? (
              <>
                <input type="text" value={newName} style={{ width: 160 }}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newName.trim()) {
                      void store.renameBranch(b, newName.trim());
                      setRenaming(null);
                    }
                    if (e.key === "Escape") setRenaming(null);
                  }} />
              </>
            ) : (
              <button className="icon-btn" title="重命名 git branch -m"
                onClick={() => { setRenaming(b.name); setNewName(b.name); }}>✎</button>
            )}
            <button className="icon-btn" title="删除分支 git branch -d"
              onClick={() => void store.deleteBranch(b, false)}>🗑</button>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="simple-pane">
      <h3 style={{ marginBottom: 6 }}>本地分支（{locals.length}）</h3>
      {locals.map(row)}
      <h3 style={{ margin: "14px 0 6px" }}>远程分支（{remotes.length}）</h3>
      {remotes.map(row)}
    </div>
  );
}

export function StashView() {
  const store = useStore();
  const [msg, setMsg] = useState("");
  return (
    <div className="simple-pane">
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <input type="text" placeholder="stash 说明（可空）" style={{ flex: 1 }}
          value={msg} onChange={(e) => setMsg(e.target.value)} />
        <button className="btn primary" onClick={() => { void store.stashPush(true, msg); setMsg(""); }}>暂存全部改动</button>
      </div>
      {store.stashes.length === 0 && <div className="dim">没有 stash（git stash push 会出现在这里）</div>}
      {store.stashes.map((s) => (
        <div key={s.index} className="branch-row">
          <span className="branch-name mono">stash@{`{${s.index}}`} {s.message}</span>
          <button className="icon-btn" title="恢复并删除 stash@{n}" onClick={() => void store.stashPop(s)}>⤵ pop</button>
          <button className="icon-btn" title="恢复但保留 stash@{n}" onClick={() => void store.stashApply(s)}>⧉ apply</button>
          <button className="icon-btn" title="丢弃 stash@{n}（危险）" onClick={() => void store.stashDrop(s)}>🗑</button>
        </div>
      ))}
    </div>
  );
}
