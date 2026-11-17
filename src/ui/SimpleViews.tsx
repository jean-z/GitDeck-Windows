// 平移分支页与 stash 页

import React, { useEffect, useState } from "react";
import { useStore } from "../store";
import { runGit } from "../core/git";
import type { BranchInfo } from "../core/types";

export function BranchesView() {
  const store = useStore();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [query, setQuery] = useState("");
  const [mergeInProgress, setMergeInProgress] = useState(false);

  // 合并进行中检测（.git/MERGE_HEAD 存在）：状态每次刷新都复检
  const repo = store.selectedRepoPath;
  useEffect(() => {
    if (!repo) { setMergeInProgress(false); return; }
    let alive = true;
    void runGit(["rev-parse", "-q", "--verify", "MERGE_HEAD"], repo).then(({ code }) => {
      if (alive) setMergeInProgress(code === 0);
    });
    return () => { alive = false; };
  }, [repo, store.status]);

  const doMerge = (b: BranchInfo) => {
    void store.gitAction({
      args: ["merge", b.name],
      dangerous: true,
      confirmTitle: `合并「${b.name}」到当前分支？`,
      confirmDetail: `git merge ${b.name}\n当前分支：${store.status.branch || "?"}\n若产生冲突：变更页会列出冲突文件，解决后走正常暂存提交；也可点「中止合并」整体回退。`,
    });
  };

  const abortMerge = () => {
    void store.gitAction({
      args: ["merge", "--abort"],
      dangerous: true,
      confirmTitle: "中止当前合并？",
      confirmDetail: "git merge --abort：放弃本次合并，回到合并前的状态（未提交的合并改动会被丢弃）。",
    });
  };
  // 即时过滤:匹配分支名或上游名,不区分大小写;搜索时空分组隐藏、标题显示 命中/总数
  const q = query.trim().toLowerCase();
  const match = (b: BranchInfo) =>
    !q || b.name.toLowerCase().includes(q) || (b.upstream ?? "").toLowerCase().includes(q);
  const allLocals = store.branches.filter((b) => !b.isRemote);
  const allRemotes = store.branches.filter((b) => b.isRemote);
  const locals = allLocals.filter(match);
  const remotes = allRemotes.filter(match);

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
            <button className="icon-btn" title="合并到当前分支 git merge" onClick={() => doMerge(b)}>⑂</button>
            <button className="icon-btn" title="检出 git checkout" onClick={() => void store.checkoutBranch(b)}>⤵</button>
            {!b.isRemote && (renaming === b.name ? (
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
            ))}
            {b.isRemote ? (
              <button className="icon-btn" title="删除远端分支（git push origin --delete，不可恢复）"
                onClick={() => void store.deleteRemoteBranch(b)}>🗑</button>
            ) : (
              <>
                <button className="icon-btn" title="删除本地分支 git branch -d（远端保留）"
                  onClick={() => void store.deleteBranch(b, false)}>🗑</button>
                {b.upstream && (
                  <button className="icon-btn" title={`删除本地并同步删除远端 ${b.upstream}（不可恢复）`}
                    onClick={() => void store.deleteBranchWithRemote(b)}>🌐</button>
                )}
              </>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="simple-pane">
      <input type="text" placeholder="搜索分支（名称/上游名，不区分大小写）"
        style={{ width: "100%", marginBottom: 10 }}
        value={query} onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); }} />
      {mergeInProgress && (
        <div className="branch-row" style={{ background: "rgba(226,116,116,.12)", borderRadius: 6, padding: "4px 8px", marginBottom: 6 }}>
          <span style={{ color: "var(--red)", fontSize: 12 }}>⚠ 合并进行中（存在未解决的冲突）</span>
          <button className="icon-btn" title="git merge --abort" onClick={abortMerge}>✕ 中止合并</button>
        </div>
      )}
      {q && locals.length + remotes.length === 0 && (
        <div className="dim">没有匹配「{query.trim()}」的分支</div>
      )}
      {(locals.length > 0 || !q) && (
        <>
          <h3 style={{ marginBottom: 6 }}>本地分支（{q ? `${locals.length}/${allLocals.length}` : allLocals.length}）</h3>
          {locals.map(row)}
        </>
      )}
      {(remotes.length > 0 || !q) && (
        <>
          <h3 style={{ margin: "14px 0 6px" }}>远程分支（{q ? `${remotes.length}/${allRemotes.length}` : allRemotes.length}）</h3>
          {remotes.map(row)}
        </>
      )}
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
