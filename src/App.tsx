// 主布局：侧栏 + Tab 内容 + 命令提示栏 + 终端 + Toast/确认弹窗

import React, { useEffect } from "react";
import { useStore } from "./store";
import { Sidebar } from "./ui/Sidebar";
import { ChangesView } from "./ui/ChangesView";
import { HistoryView } from "./ui/HistoryView";
import { BranchesView, StashView } from "./ui/SimpleViews";
import { TerminalPane } from "./ui/TerminalPane";

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  if (!toasts.length) return null;
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast${t.isError ? " error" : ""}`}>{t.text}</div>
      ))}
    </div>
  );
}

function ConfirmDialog() {
  const confirm = useStore((s) => s.pendingConfirm);
  const setConfirm = useStore((s) => s.setConfirm);
  if (!confirm) return null;
  return (
    <div className="confirm-mask" onClick={() => setConfirm(null)}>
      <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
        <h4>{confirm.title}</h4>
        <div className="confirm-detail">{confirm.detail}</div>
        <div className="confirm-cmd">{confirm.command}</div>
        <div className="confirm-actions">
          <button className="btn" onClick={() => setConfirm(null)}>取消</button>
          <button className="btn danger" onClick={() => { setConfirm(null); confirm.action(); }}>执行</button>
        </div>
      </div>
    </div>
  );
}

export function App() {
  const store = useStore();
  useEffect(() => { void store.init(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const branch = store.status;
  const total = branch.conflicted.length + branch.staged.length + branch.unstaged.length + branch.untracked.length;
  const tabs: { key: typeof store.currentTab; label: string }[] = [
    { key: "changes", label: total ? `变更 (${total})` : "变更" },
    { key: "history", label: "历史" },
    { key: "branches", label: "分支" },
    { key: "stash", label: "Stash" },
  ];
  return (
    <div id="app">
      <div className="app-main">
        <Sidebar />
        <div className="content">
          <div className="content-tabs">
            {tabs.map((t) => (
              <button key={t.key} className={`tab-btn${store.currentTab === t.key ? " active" : ""}`}
                onClick={() => void store.setTab(t.key)}>{t.label}</button>
            ))}
            <span style={{ flex: 1 }} />
            <div className="dim" style={{ fontSize: 11, alignSelf: "center" }}>
              {store.selectedRepoPath ? (
                branch.detached ? `· detached ${branch.branch}` : `${branch.branch}${branch.ahead ? ` ↑${branch.ahead}` : ""}${branch.behind ? ` ↓${branch.behind}` : ""}`
              ) : "未选择仓库"}
            </div>
            {/* 快捷同步:平铺按钮,免下拉 */}
            <button className="btn" title="git pull" disabled={!store.selectedRepoPath}
              onClick={() => void store.pull()}>⬇ 拉取</button>
            <button className="btn" title="git push（新分支首次自动 -u 建立跟踪）" disabled={!store.selectedRepoPath}
              onClick={() => void store.push()}>⬆ 推送</button>
            <button className="btn" title="git fetch --all" disabled={!store.selectedRepoPath}
              onClick={() => void store.fetchAll()}>⤓ 获取</button>
          </div>
          <div className="tab-body">
            {store.currentTab === "changes" && <ChangesView />}
            {store.currentTab === "history" && <HistoryView />}
            {store.currentTab === "branches" && <BranchesView />}
            {store.currentTab === "stash" && <StashView />}
          </div>
          <TerminalPane />
        </div>
      </div>
      <Toasts />
      <ConfirmDialog />
    </div>
  );
}
