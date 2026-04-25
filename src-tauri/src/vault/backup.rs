use std::fs;
use std::path::{Path, PathBuf};

use chrono::Local;

use crate::error::AppResult;

/// Number of timestamped backups kept on disk. Older ones are deleted on each
/// new backup so the directory doesn't accumulate clutter.
const RETAIN: usize = 3;

/// Take a bit-for-bit copy of the encrypted vault file.
///
/// The copy preserves SQLCipher encryption — the backup file opens with the
/// **same master password** as the source. To restore, just rename the `.bak`
/// back to `.vault` and open it from the unlock screen.
///
/// The caller is expected to hold the vault's connection lock while invoking
/// this function so no transaction is in flight during the copy. Without that
/// guarantee, a backup taken mid-write can land in an inconsistent state.
pub fn create_backup(vault_path: &Path) -> AppResult<PathBuf> {
    let backup_path = next_backup_path(vault_path);
    fs::copy(vault_path, &backup_path)?;
    rotate_backups(vault_path)?;
    Ok(backup_path)
}

/// `<vault_filename>.bak.<YYYYMMDD-HHMMSS>` next to the vault.
fn next_backup_path(vault_path: &Path) -> PathBuf {
    let timestamp = Local::now().format("%Y%m%d-%H%M%S").to_string();
    let parent = vault_path.parent().unwrap_or_else(|| Path::new("."));
    let file_name = vault_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("vault");
    parent.join(format!("{}.bak.{}", file_name, timestamp))
}

fn rotate_backups(vault_path: &Path) -> AppResult<()> {
    let parent = vault_path.parent().unwrap_or_else(|| Path::new("."));
    let file_name = vault_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("vault");
    let prefix = format!("{}.bak.", file_name);

    let mut backups: Vec<PathBuf> = fs::read_dir(parent)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with(&prefix))
                .unwrap_or(false)
        })
        .collect();

    // Lexicographic sort works because the timestamp suffix is fixed-width.
    backups.sort();
    if backups.len() > RETAIN {
        for old in &backups[..backups.len() - RETAIN] {
            if let Err(e) = fs::remove_file(old) {
                eprintln!(
                    "backup rotation: failed to delete {}: {}",
                    old.display(),
                    e
                );
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rotate_keeps_only_retain_most_recent() {
        let dir = tempfile::tempdir().unwrap();
        let vault = dir.path().join("test.vault");
        fs::write(&vault, b"original").unwrap();

        // Create RETAIN+2 dummy backups with monotonically increasing timestamps.
        for i in 0..(RETAIN + 2) {
            let p = dir
                .path()
                .join(format!("test.vault.bak.2026{:02}01-120000", i + 1));
            fs::write(&p, format!("backup {}", i)).unwrap();
        }
        rotate_backups(&vault).unwrap();

        let remaining: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().into_string().unwrap())
            .filter(|n| n.starts_with("test.vault.bak."))
            .collect();
        assert_eq!(remaining.len(), RETAIN);
    }
}
