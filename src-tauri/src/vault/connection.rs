use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::Connection;

use crate::error::{AppError, AppResult};
use crate::vault::migrations;

pub struct Vault {
    pub path: PathBuf,
    pub conn: Mutex<Connection>,
}

impl Vault {
    pub fn create(path: &Path, password: &str, locale: &str) -> AppResult<Self> {
        if password.len() < 8 {
            return Err(AppError::Invalid("password must have at least 8 characters".into()));
        }
        if path.exists() {
            return Err(AppError::VaultAlreadyExists(path.display().to_string()));
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(path)?;
        configure_cipher(&conn, password)?;

        // Sanity write — confirms cipher is configured before installing schema.
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS _bootstrap(x INTEGER); DROP TABLE _bootstrap;",
        )?;

        migrations::run(&conn, locale)?;
        conn.execute(
            "INSERT OR REPLACE INTO _meta(key,value) VALUES('created_at', strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            [],
        )?;

        Ok(Self {
            path: path.to_path_buf(),
            conn: Mutex::new(conn),
        })
    }

    pub fn open(path: &Path, password: &str) -> AppResult<Self> {
        if !path.exists() {
            return Err(AppError::VaultNotFound(path.display().to_string()));
        }

        let conn = Connection::open(path)?;
        configure_cipher(&conn, password)?;

        // Probe — wrong key produces a generic SQL error on first read of an
        // encrypted page. If this query succeeds, the password is correct.
        conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| {
            r.get::<_, i64>(0)
        })
        .map_err(|_| AppError::InvalidPassword)?;

        // Locale only affects first-time seeding; on open the schema is already
        // populated and seed() returns early.
        migrations::run(&conn, "en")?;
        Ok(Self {
            path: path.to_path_buf(),
            conn: Mutex::new(conn),
        })
    }
}

/// SQLCipher v4 defaults: PBKDF2-HMAC-SHA512 with 256k iterations, random
/// per-database salt embedded in the encrypted header. Single-file portable.
fn configure_cipher(conn: &Connection, password: &str) -> AppResult<()> {
    // Pass password as a quoted text literal so SQLCipher runs its KDF.
    let escaped = password.replace('\'', "''");
    conn.pragma_update(None, "key", format!("'{}'", escaped))?;
    conn.pragma_update(None, "cipher_page_size", 4096)?;
    conn.pragma_update(None, "kdf_iter", 256_000)?;
    conn.pragma_update(None, "cipher_hmac_algorithm", "HMAC_SHA512")?;
    conn.pragma_update(None, "cipher_kdf_algorithm", "PBKDF2_HMAC_SHA512")?;
    // SQLite leaves foreign-key enforcement off by default. The schema declares
    // FKs (transactions → cards/categories/imports/installment_groups), so make
    // them real — silently violating them was masking the missing parent row in
    // installment_groups whenever the cascade tried to attach a group_id.
    conn.pragma_update(None, "foreign_keys", "ON")?;
    Ok(())
}
