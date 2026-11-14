// 侧栏：仓库列表（扫描目录发现 + 手动添加 + 隐藏）+ 练习模式开关

import React, { useState } from "react";
import { useStore } from "../store";

export function Sidebar() {
  const store = useStore();
  const [mgrOpen, setMgrOpen] = useState(false);
  const [newDir, setNewDir] = useState("");
  const [newRepo, setNewRepo] = useState("");

  return (
    <div className="sidebar">
      <h3>仓库</h3>
      <div className="repo-list">
        {store.repos.map((r) => (
          <div key={r.path}
            className={`repo-row${store.selectedRepoPath === r.path ? " active" : ""}`}
            onClick={() => void store.selectRepo(r.path)}
            title={r.path}>
            <span className={`repo-dot${r.dirty ? " dirty" : ""}`} />
            <span className="repo-name">{r.name}</span>
            <span className="file-actions">
              <button className="icon-btn" title="从列表隐藏（不删仓库）"
                onClick={(e) => { e.stopPropagation(); void store.hideRepo(r.path); }}>✕</button>
            </span>
          </div>
        ))}
      </div>
      <div className="sidebar-foot">
        <label className="checkbox-label" title="练习模式：所有操作只复制 git 命令，不真正执行">
          <input type="checkbox" checked={store.practiceMode}
            onChange={(e) => void store.setPracticeMode(e.target.checked)} />
          🎓 练习模式
        </label>
        <button className="btn" onClick={() => setMgrOpen(!mgrOpen)}>管理扫描目录…</button>
        {mgrOpen && (
          <div className="repo-mgr">
            {store.config.scanDirs.map((d) => (
              <div key={d} className="branch-row" style={{ fontSize: 11 }}>
                <span className="branch-name" title={d}>{d}</span>
                <button className="icon-btn" onClick={() => void store.removeScanDir(d)}>✕</button>
              </div>
            ))}
            <input type="text" placeholder="新增扫描目录（~ 可用）"
              value={newDir} onChange={(e) => setNewDir(e.target.value)} />
            <div className="mgr-btns">
              <button className="btn" onClick={() => { if (newDir.trim()) { void store.addScanDir(newDir.trim()); setNewDir(""); } }}>添加目录</button>
            </div>
            <input type="text" placeholder="手动添加仓库路径" style={{ marginTop: 6 }}
              value={newRepo} onChange={(e) => setNewRepo(e.target.value)} />
            <div className="mgr-btns">
              <button className="btn" onClick={() => { if (newRepo.trim()) { void store.addManualRepo(newRepo.trim()); setNewRepo(""); } }}>添加仓库</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
