// git 执行层：invoke Rust 命令（平移 GitCommander 的调用约定）。
// 约定 args 不带 "git" 前缀（Rust 侧会去掉并追加 -c core.quotepath=false）。

import { invoke } from "@tauri-apps/api/core";

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
  timed_out: boolean;
}

export async function runGitRaw(args: string[], cwd: string, timeoutMs = 120000): Promise<GitResult> {
  return invoke<GitResult>("run_git", { args, cwd, timeoutMs });
}

/// 静默执行（返回 stdout，仅 code===0 时由调用方守卫）
export async function runGit(args: string[], cwd: string, timeoutMs = 120000): Promise<{ code: number; out: string; stderr: string }> {
  const r = await runGitRaw(args, cwd, timeoutMs);
  return { code: r.code, out: r.stdout, stderr: r.stderr };
}

/// 应用补丁（行级回退/块回滚共用；reverse=-R、cached=--cached、recount 恒开）
export async function applyPatch(patch: string, cwd: string, reverse: boolean, cached: boolean): Promise<GitResult> {
  return invoke<GitResult>("apply_patch", { patch, cwd, reverse, cached });
}

export async function readTextFile(path: string, maxLines?: number): Promise<string> {
  return invoke<string>("read_file_text", { path, maxLines: maxLines ?? null });
}

export async function readFileBase64(path: string): Promise<string> {
  return invoke<string>("read_file_base64", { path });
}

export async function gitShowBase64(revPath: string, cwd: string): Promise<string | null> {
  try {
    return await invoke<string>("git_show_base64", { revPath, cwd });
  } catch {
    return null;
  }
}

export async function loadConfig(): Promise<string> {
  return invoke<string>("load_config");
}

export async function saveConfig(content: string): Promise<void> {
  await invoke("save_config", { content });
}

export async function scanRepos(scanDirs: string[], manual: string[], hidden: string[]) {
  return invoke<{ name: string; path: string; is_manual: boolean }[]>("scan_repos", {
    scanDirs,
    manual,
    hidden,
  });
}

export async function resolvePath(raw: string): Promise<string> {
  return invoke<string>("resolve_path", { raw });
}

export async function pathExists(path: string): Promise<boolean> {
  return invoke<boolean>("path_exists", { path });
}
