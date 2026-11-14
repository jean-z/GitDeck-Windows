//! Tauri commands：git 执行 / 补丁应用 / 仓库扫描 / 文件读取 / 配置持久化。
//! 平移 GitDeck GitCommander.swift 与 RepoStore.swift 的关键约定。

use crate::find_git;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::Serialize;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;
use tauri::AppHandle;

/// git 命令执行结果（对应 GitCommander.run：stdout/stderr 分开返回）
#[derive(Serialize, Clone)]
pub struct GitResult {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
}

/// 组装 git 命令（平移 GitCommander.run 的关键约定）：
/// - `-c core.quotepath=false` 中文文件名正常显示
/// - 禁止交互式凭据提示，防挂死（Windows 没有 /bin/echo，跳过 GIT_ASKPASS）
fn build_git_command(args: &[String], cwd: Option<&str>) -> Command {
    let git = find_git();
    let mut cmd = Command::new(git);
    cmd.arg("-c").arg("core.quotepath=false");
    cmd.args(args);
    cmd.env("LC_ALL", "en_US.UTF-8");
    cmd.env("LANG", "en_US.UTF-8");
    cmd.env("GIT_TERMINAL_PROMPT", "0");
    #[cfg(not(windows))]
    {
        cmd.env("GIT_ASKPASS", "/bin/echo");
        cmd.env("SSH_ASKPASS_REQUIRE", "never");
    }
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.stdin(Stdio::null());
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    cmd
}

fn collect_output(cmd: &mut Command, timeout_ms: u64) -> GitResult {
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return GitResult {
                code: -1,
                stdout: String::new(),
                stderr: format!("无法启动命令: {}", e),
                timed_out: false,
            }
        }
    };

    // stdout/stderr 各开一个读线程，避免管道写满互相阻塞
    let mut stdout_pipe = child.stdout.take().unwrap();
    let mut stderr_pipe = child.stderr.take().unwrap();
    let out_handle = thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout_pipe.read_to_end(&mut buf);
        buf
    });
    let err_handle = thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stderr_pipe.read_to_end(&mut buf);
        buf
    });

    // 带超时的 wait（GitCommander.waitUntilExitOrTimeout 的等价物）
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let status = child.wait();
        let _ = tx.send(status);
    });
    let timed_out = rx.recv_timeout(Duration::from_millis(timeout_ms)).is_err();

    let stdout = String::from_utf8_lossy(&out_handle.join().unwrap_or_default()).into_owned();
    let stderr = String::from_utf8_lossy(&err_handle.join().unwrap_or_default()).into_owned();

    if timed_out {
        return GitResult {
            code: -2,
            stdout,
            stderr: format!("命令超时（{}s）已终止: {}", timeout_ms / 1000, stderr),
            timed_out: true,
        };
    }
    GitResult {
        code: rx.try_recv().ok().and_then(|r| r.ok()).and_then(|s| s.code()).unwrap_or(-1),
        stdout,
        stderr,
        timed_out: false,
    }
}

#[tauri::command]
pub fn run_git(args: Vec<String>, cwd: Option<String>, timeout_ms: Option<u64>) -> GitResult {
    let full_args: Vec<String> = args.into_iter().filter(|a| a != "git").collect();
    if full_args.is_empty() {
        return GitResult {
            code: -1,
            stdout: String::new(),
            stderr: "空命令".into(),
            timed_out: false,
        };
    }
    let mut cmd = build_git_command(&full_args, cwd.as_deref());
    collect_output(&mut cmd, timeout_ms.unwrap_or(120_000))
}

/// 把补丁文本写临时文件 → git apply（reverse=-R / cached=--cached / recount 恒开）。
/// 行级回退与块回滚共用（对应 GitDeck applyPatchFile）
#[tauri::command]
pub fn apply_patch(patch: String, cwd: String, reverse: bool, cached: bool) -> GitResult {
    let tmp = std::env::temp_dir().join(format!("gitdeck-{}.patch", std::process::id()));
    if let Err(e) = std::fs::write(&tmp, patch.as_bytes()) {
        return GitResult {
            code: -1,
            stdout: String::new(),
            stderr: format!("写入补丁文件失败: {}", e),
            timed_out: false,
        };
    }
    let mut args: Vec<String> = vec!["apply".into()];
    if reverse {
        args.push("-R".into());
    }
    args.push("--recount".into());
    if cached {
        args.push("--cached".into());
    }
    args.push(tmp.to_string_lossy().into_owned());
    let mut cmd = build_git_command(&args, Some(cwd.as_str()));
    let result = collect_output(&mut cmd, 60_000);
    let _ = std::fs::remove_file(&tmp);
    result
}

#[derive(Serialize, Clone)]
pub struct RepoEntry {
    pub name: String,
    pub path: String,
    pub is_manual: bool,
}

/// 扫描目录下的 git 仓库（深度 1，跳过点开头目录），加手动添加的仓库，过滤隐藏
/// （平移 RepoStore.discoverRepos）
#[tauri::command]
pub fn scan_repos(scan_dirs: Vec<String>, manual: Vec<String>, hidden: Vec<String>) -> Vec<RepoEntry> {
    let mut repos: Vec<RepoEntry> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    for dir in &scan_dirs {
        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        let mut names: Vec<PathBuf> = entries
            .filter_map(|e| e.ok())
            .filter(|e| !e.file_name().to_string_lossy().starts_with('.'))
            .map(|e| e.path())
            .collect();
        names.sort();
        for full in names {
            if !full.is_dir() || !full.join(".git").exists() {
                continue;
            }
            // .git 为目录（普通仓库）或文件（worktree/submodule）都算
            let path_str = full.to_string_lossy().into_owned();
            if seen.contains(&path_str) {
                continue;
            }
            let name = full.file_name().unwrap_or_default().to_string_lossy().into_owned();
            seen.push(path_str.clone());
            repos.push(RepoEntry { name, path: path_str, is_manual: false });
        }
    }
    for path in manual {
        if seen.contains(&path) {
            continue;
        }
        let name = Path::new(&path)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        seen.push(path.clone());
        repos.push(RepoEntry { name, path, is_manual: true });
    }
    repos.retain(|r| !hidden.contains(&r.path));
    repos
}

/// 读工作区文本文件（untracked 预览 / 冲突文件内容）
#[tauri::command]
pub fn read_file_text(path: String, max_lines: Option<usize>) -> Result<String, String> {
    let content = std::fs::read(&path).map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&content).into_owned();
    match max_lines {
        Some(n) => Ok(text.split('\n').take(n).collect::<Vec<_>>().join("\n")),
        None => Ok(text),
    }
}

/// 读文件 bytes 转 base64（图片 diff：工作区文件）
#[tauri::command]
pub fn read_file_base64(path: String) -> Result<String, String> {
    let data = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(B64.encode(data))
}

/// git show <rev>:<file> 的二进制内容转 base64（图片 diff 旧版）
#[tauri::command]
pub fn git_show_base64(rev_path: String, cwd: String) -> Result<String, String> {
    let args = vec!["show".to_string(), rev_path];
    let mut cmd = build_git_command(&args, Some(cwd.as_str()));
    let r = collect_output(&mut cmd, 30_000);
    if r.code != 0 || r.stdout.is_empty() {
        return Err(r.stderr);
    }
    Ok(B64.encode(r.stdout.as_bytes()))
}

/// 配置持久化：~/.gitdeck/config.json（平移 RepoStore）
#[tauri::command]
pub fn load_config() -> Result<String, String> {
    let dir = config_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    match std::fs::read_to_string(dir.join("config.json")) {
        Ok(s) => Ok(s),
        Err(_) => Ok("{}".into()),
    }
}

#[tauri::command]
pub fn save_config(content: String) -> Result<(), String> {
    let dir = config_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("config.json"), content).map_err(|e| e.to_string())
}

fn config_dir() -> PathBuf {
    if let Some(home) = dirs_home() {
        return home.join(".gitdeck");
    }
    std::env::temp_dir().join(".gitdeck")
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .ok()
        .map(PathBuf::from)
}

/// 展开 ~（手动添加仓库 / 扫描目录用）
#[tauri::command]
pub fn resolve_path(raw: String) -> String {
    let home = dirs_home().unwrap_or_default();
    let expanded = raw.replacen("~", &home.to_string_lossy(), 1);
    Path::new(&expanded).components().collect::<PathBuf>().to_string_lossy().into_owned()
}

#[tauri::command]
pub fn app_info() -> serde_json::Value {
    serde_json::json!({
        "os": if cfg!(windows) { "windows" } else if cfg!(target_os = "macos") { "macos" } else { "other" },
        "version": env!("CARGO_PKG_VERSION"),
    })
}

// AppHandle 保留（后续事件推送扩展用），避免未使用告警
#[allow(unused)]
fn _keep_apphandle(_: AppHandle) {}
