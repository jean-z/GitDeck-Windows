//! GitDeck Windows：Tauri 2 壳。
//! 命令定义在 commands.rs / pty.rs（tauri::command 与 generate_handler
//! 同模块会宏重名 E0255，故拆子模块）。

mod commands;
mod pty;

use std::path::PathBuf;

/// 找 git 可执行文件：Windows 靠 PATH（Git for Windows 会注册）；
/// macOS 上 GUI 启动的 PATH 不含 Homebrew，按 GitDeck 的顺序探测。
pub(crate) fn find_git() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        for c in ["/opt/homebrew/bin/git", "/usr/local/bin/git", "/usr/bin/git"] {
            if PathBuf::from(c).exists() {
                return PathBuf::from(c);
            }
        }
        PathBuf::from("/usr/bin/git")
    }
    #[cfg(not(target_os = "macos"))]
    {
        if find_in_path("git") || find_in_path("git.exe") {
            PathBuf::from("git")
        } else {
            PathBuf::from("git") // 交给 Command 报错
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn find_in_path(name: &str) -> bool {
    let path = std::env::var("PATH").unwrap_or_default();
    let sep = if cfg!(windows) { ';' } else { ':' };
    for dir in path.split(sep) {
        let candidate = std::path::Path::new(dir).join(name);
        if candidate.exists() {
            return true;
        }
        if cfg!(windows) {
            let with_ext = std::path::Path::new(dir).join(format!("{}.exe", name));
            if with_ext.exists() {
                return true;
            }
        }
    }
    false
}

pub fn run() {
    tauri::Builder::default()
        .manage(pty::PtyState::default())
        .invoke_handler(tauri::generate_handler![
            commands::run_git,
            commands::apply_patch,
            commands::scan_repos,
            commands::read_file_text,
            commands::read_file_base64,
            commands::git_show_base64,
            commands::load_config,
            commands::save_config,
            commands::app_info,
            commands::resolve_path,
            pty::pty_create,
            pty::pty_write,
            pty::pty_resize,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
