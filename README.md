# GitDeck for Windows

GitDeck（macOS 版）的 Windows 实现：Tauri 2 + React + TypeScript。
git 内核逻辑（diff 解析 / 上下文展开 / 行级回退补丁）从 Swift 版逐条平移，
算法经过真实 git 仓库端到端验证，行为与 macOS 版一致。

## 功能

- 仓库侧栏：扫描目录发现仓库（深度 1）+ 手动添加 + 隐藏 + dirty 圆点
- 变更页：冲突/暂存/未暂存/未跟踪四分组，diff 分块卡片
  - **上下文展开**（GitLab MR 式）：块上/下各展开 20 行，可连续点直到文件边界，展开区淡蓝底色
  - **行级回退**（GitLab/VS Code 式）：每行 +/- 行尾 ↩ 按钮，只撤销这一行
  - 块级回滚（git apply -R）、图片 before/after 对比、巨型 diff 截断保护（3000 行）
- 历史页：`--graph` 彩色提交列表、关键字/作者/分支/仅第一父级筛选、提交详情、
  merge 提交的被合入提交三种口径（分支自己 / 全部引入历史 / 主线视角）
- 分支页：检出 / 重命名 / 删除（-d，未合并保护）；Stash 页：push/pop/apply/drop
- 内嵌终端：xterm.js + ConPTY（portable-pty），PowerShell；切仓库自动 cd
- 🎓 练习模式：所有操作只复制 git 命令不执行（与 macOS 版一致）
- 事件式刷新：终端里敲完 git 命令回车，面板自动跟随（0.8s / 3.5s 双次兜底）

## 开发（本机 macOS 也能跑）

```bash
npm install          # 卡公司源可加 --registry=https://registry.npmmirror.com
npm run tauri dev    # 需要 Rust（rustup）+ Node ≥16
```

依赖系统 git（PATH 里能找到 `git`）。

## 构建 Windows 安装包

Windows 包需在 Windows 环境构建（推送后 GitHub Actions 自动出包，见
`.github/workflows/windows.yml`，产物在 Actions Artifacts）：

```bash
npm run tauri build          # 在 Windows 上执行，产出 NSIS 安装包
```

## 与 macOS 版的架构对应

| macOS 版（Swift） | Windows 版 |
|---|---|
| GitCommander（spawn git） | `src-tauri/src/commands.rs`（run_git/apply_patch） |
| SyntaxHighlight.parseDiffHunks / 展开算法 / workingLinePatch | `src/core/diff.ts`（逐条平移，已端到端验证） |
| AppState.parseStatus / parseBranches / parseLog | `src/core/parse.ts` |
| AppState.swift（zustand 不可用时的…） | `src/store.ts`（zustand） |
| SwiftUI 视图 | `src/ui/*.tsx` |
| SwiftTerm 终端 + 回车事件刷新 | xterm.js + ConPTY（`src-tauri/src/pty.rs`） |

已知差异：行级回退在两版都用「正向补丁」方案（不能用 `git apply -R`：
-R 要求 - 行内容已存在于文件中，恢复删除行必失败——实验验证过的结论）。

配置持久化：`~/.gitdeck/config.json` + localStorage（GitDeck 忽略列表）。
