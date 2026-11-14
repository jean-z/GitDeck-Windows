//! 内嵌终端：portable-pty（Windows = ConPTY，macOS/Linux = 原生 pty）。
//! 前端 xterm.js 通过 invoke 写入、监听 `pty-data` 事件读取输出；
//! 二进制按 base64 传输，避免 UTF-8 多字节被事件边界截断后解码出错。
//! （平移 GitDeck 的 SwiftTerm 终端：整 App 一个 shell 实例，切仓库时发 cd 命令）

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Deserialize;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

#[derive(Default)]
pub struct PtyState {
    pub master: Arc<Mutex<Option<Box<dyn portable_pty::MasterPty + Send>>>>,
    pub writer: Arc<Mutex<Option<Box<dyn Write + Send>>>>,
}

#[derive(Deserialize)]
pub struct PtyStart {
    pub cwd: Option<String>,
}

#[tauri::command]
pub fn pty_create(app: AppHandle, state: tauri::State<PtyState>, start: PtyStart) -> Result<(), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 30,
            cols: 110,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    // Windows: PowerShell；macOS/Linux: 用户默认 login shell（与外部终端 PATH/别名一致）
    let (shell, arg): (String, Option<String>) = if cfg!(windows) {
        ("powershell.exe".into(), Some("-NoLogo".into()))
    } else {
        (
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into()),
            Some("-l".into()),
        )
    };
    let mut cmd = CommandBuilder::new(shell.clone());
    if let Some(a) = &arg {
        cmd.arg(a);
    }
    if let Some(cwd) = &start.cwd {
        cmd.cwd(cwd);
    }
    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave); // 关闭子端，避免父进程持有导致 EOF 不触发

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    *state.writer.lock().unwrap() = Some(writer);
    *state.master.lock().unwrap() = Some(pair.master);

    // 输出线程：读 pty → base64 → 事件推给前端
    let app_out = app.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let payload = B64.encode(&buf[..n]);
                    let _ = app_out.emit("pty-data", payload);
                }
            }
        }
        let _ = app_out.emit("pty-exit", ());
    });

    // 等待 shell 退出的看门狗（目前仅保证进程不僵死）
    std::thread::spawn(move || {
        let _ = child.wait();
    });

    Ok(())
}

#[tauri::command]
pub fn pty_write(state: tauri::State<PtyState>, data: String) -> Result<(), String> {
    let mut w = state.writer.lock().unwrap();
    if let Some(w) = w.as_mut() {
        // 前端发 UTF-8 文本（xterm onData），直接写 bytes
        w.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        w.flush().map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("终端未启动".into())
    }
}

#[tauri::command]
pub fn pty_resize(state: tauri::State<PtyState>, rows: u16, cols: u16) -> Result<(), String> {
    if let Some(master) = state.master.lock().unwrap().as_ref() {
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
