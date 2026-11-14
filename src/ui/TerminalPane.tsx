// 内嵌终端：xterm.js + Rust pty（Windows ConPTY）。
// 平移 TerminalController 的关键约定：
// - 整个 App 生命周期只有一个 shell 实例
// - 回车只旁观（onData 监听输入流），不拦截不修改
// - 回车后 0.8s / 3.5s 双次刷新（快命令完成 + 慢命令兜底）
// - 切仓库自动 cd && clear

import React, { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useStore } from "../store";

export function TerminalPane() {
  const bodyRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const store = useStore();
  const cwd = store.selectedRepoPath;
  const readyRef = useRef(false);

  useEffect(() => {
    if (!bodyRef.current || termRef.current) return;
    const term = new Terminal({
      fontSize: 13,
      fontFamily: '"Cascadia Code", "JetBrains Mono", Consolas, "SF Mono", monospace',
      theme: {
        background: "#1a1b1f",
        foreground: "#d9dbde",
        cursor: "#4d8fdb",
        selectionBackground: "#4d8fdb55",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(bodyRef.current);
    termRef.current = term;
    fit.fit();
    term.onData(async (data) => {
      if (!readyRef.current) return;
      await invoke("pty_write", { data });
      // 回车 = 可能执行了命令 → 节流刷新（平移 scheduleEventRefresh）
      if (data === "\r" || data === "\n") store.onTerminalReturn();
    });
    const resize = () => {
      fit.fit();
      if (readyRef.current) {
        void invoke("pty_resize", { rows: term.rows, cols: term.cols });
      }
    };
    window.addEventListener("resize", resize);
    const ro = new ResizeObserver(resize);
    if (bodyRef.current) ro.observe(bodyRef.current);

    let unlisten1: (() => void) | null = null;
    let unlisten2: (() => void) | null = null;
    (async () => {
      unlisten1 = await listen<string>("pty-data", (ev) => {
        const bytes = Uint8Array.from(atob(ev.payload), (c) => c.charCodeAt(0));
        term.write(bytes);
      });
      unlisten2 = await listen("pty-exit", () => {
        term.writeln("\x1b[31mshell 已退出\x1b[0m");
      });
      // 启动 pty（默认 shell；首个仓库目录）
      await invoke("pty_create", { start: { cwd: cwd ?? null } });
      readyRef.current = true;
      store.setTerminalReady(true);
      // shell 就绪欢迎语（平移 GitDeck 的欢迎信息）
      term.write('echo "GitDeck 终端就绪 👋  git 命令直接在这里练"\r');
      if (cwd) await store.cdTerminal(cwd);
    })();

    return () => {
      window.removeEventListener("resize", resize);
      ro.disconnect();
      unlisten1?.();
      unlisten2?.();
      term.dispose();
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 切仓库自动 cd（GitDeck：termView.send("cd path && clear\n")）
  useEffect(() => {
    if (readyRef.current && cwd) void store.cdTerminal(cwd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd]);

  // 最近命令提示栏
  const lastCmd = store.records[0];
  return (
    <div className="term-pane">
      <div className="term-head"
        onClick={() => { if (lastCmd) void navigator.clipboard.writeText(lastCmd.command); }}
        title="点击复制命令；终端里按回车执行命令后，面板会自动刷新">
        <span>终端</span>
        {lastCmd && (
          <span className="cmd-bar" style={{ border: "none", background: "none", padding: 0 }}>
            <span className={`cmd-text${lastCmd.isDangerous ? " cmd-danger" : ""}`}>
              {lastCmd.command}{lastCmd.exitCode !== 0 ? ` （exit ${lastCmd.exitCode}）` : ""}
            </span>
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span>⌘K 聚焦</span>
      </div>
      <div className="term-body" ref={bodyRef} onClick={() => termRef.current?.focus()} />
    </div>
  );
}
