use std::path::PathBuf;

use chrono::Utc;
use rusqlite::OptionalExtension;
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::models::{
    Card, CardInput, Category, CategoryInput, MonthSummary, RecentVault, Transaction,
    TransactionFilter, TransactionInput, VaultStatus, YearSummary,
};
use crate::pdf;
use crate::repo;
use crate::state::AppState;
use crate::vault::Vault;

fn with_conn<F, R>(state: &AppState, f: F) -> AppResult<R>
where
    F: FnOnce(&rusqlite::Connection) -> AppResult<R>,
{
    let guard = state.vault.lock().map_err(|_| AppError::Internal("vault mutex poisoned".into()))?;
    let vault = guard.as_ref().ok_or(AppError::VaultLocked)?;
    let conn = vault.conn.lock().map_err(|_| AppError::Internal("connection mutex poisoned".into()))?;
    f(&conn)
}

#[tauri::command]
pub fn vault_create(
    state: State<AppState>,
    path: String,
    password: String,
    locale: Option<String>,
) -> AppResult<()> {
    let locale = locale.as_deref().unwrap_or("en");
    let v = Vault::create(&PathBuf::from(&path), &password, locale)?;
    let mut guard = state.vault.lock().map_err(|_| AppError::Internal("vault mutex poisoned".into()))?;
    *guard = Some(v);
    Ok(())
}

#[tauri::command]
pub fn vault_open(state: State<AppState>, path: String, password: String) -> AppResult<VaultStatus> {
    let v = Vault::open(&PathBuf::from(&path), &password)?;
    let mut guard = state.vault.lock().map_err(|_| AppError::Internal("vault mutex poisoned".into()))?;
    *guard = Some(v);
    let path = guard.as_ref().unwrap().path.display().to_string();
    Ok(VaultStatus::Unlocked {
        path,
        opened_at: Utc::now().to_rfc3339(),
    })
}

#[tauri::command]
pub fn vault_lock(state: State<AppState>) -> AppResult<()> {
    let mut guard = state.vault.lock().map_err(|_| AppError::Internal("vault mutex poisoned".into()))?;
    *guard = None;
    Ok(())
}

#[tauri::command]
pub fn vault_status(state: State<AppState>) -> AppResult<VaultStatus> {
    let guard = state.vault.lock().map_err(|_| AppError::Internal("vault mutex poisoned".into()))?;
    Ok(match guard.as_ref() {
        Some(v) => VaultStatus::Unlocked {
            path: v.path.display().to_string(),
            opened_at: Utc::now().to_rfc3339(),
        },
        None => VaultStatus::Locked { path: None },
    })
}

#[tauri::command]
pub fn vault_recent() -> AppResult<Vec<RecentVault>> {
    Ok(Vec::new())
}

#[tauri::command]
pub fn cards_list(state: State<AppState>) -> AppResult<Vec<Card>> {
    with_conn(&state, |c| repo::cards::list(c))
}

#[tauri::command]
pub fn cards_create(state: State<AppState>, input: CardInput) -> AppResult<Card> {
    with_conn(&state, |c| repo::cards::create(c, &input))
}

#[tauri::command]
pub fn cards_update(state: State<AppState>, id: String, patch: serde_json::Value) -> AppResult<Card> {
    with_conn(&state, |c| repo::cards::update(c, &id, &patch))
}

#[tauri::command]
pub fn cards_remove(state: State<AppState>, id: String) -> AppResult<()> {
    with_conn(&state, |c| repo::cards::remove(c, &id))
}

#[tauri::command]
pub fn categories_list(state: State<AppState>) -> AppResult<Vec<Category>> {
    with_conn(&state, |c| repo::categories::list(c))
}

#[tauri::command]
pub fn categories_create(state: State<AppState>, input: CategoryInput) -> AppResult<Category> {
    with_conn(&state, |c| repo::categories::create(c, &input))
}

#[tauri::command]
pub fn categories_update(state: State<AppState>, id: String, patch: serde_json::Value) -> AppResult<Category> {
    with_conn(&state, |c| repo::categories::update(c, &id, &patch))
}

#[tauri::command]
pub fn categories_remove(state: State<AppState>, id: String) -> AppResult<()> {
    with_conn(&state, |c| repo::categories::remove(c, &id))
}

#[tauri::command]
pub fn transactions_list(state: State<AppState>, filter: Option<TransactionFilter>) -> AppResult<Vec<Transaction>> {
    let f = filter.unwrap_or_default();
    with_conn(&state, |c| repo::transactions::list(c, &f))
}

#[tauri::command]
pub fn transactions_create(state: State<AppState>, input: TransactionInput) -> AppResult<Transaction> {
    with_conn(&state, |c| repo::transactions::create(c, &input))
}

#[tauri::command]
pub fn transactions_update(state: State<AppState>, id: String, patch: serde_json::Value) -> AppResult<Transaction> {
    with_conn(&state, |c| repo::transactions::update(c, &id, &patch))
}

#[tauri::command]
pub fn transactions_remove(state: State<AppState>, id: String) -> AppResult<()> {
    with_conn(&state, |c| repo::transactions::remove(c, &id))
}

#[tauri::command]
pub fn transactions_restore(
    state: State<AppState>,
    rows: Vec<Transaction>,
) -> AppResult<usize> {
    with_conn(&state, |c| repo::transactions::restore(c, &rows))
}

#[tauri::command]
pub fn transactions_remove_by_import(
    state: State<AppState>,
    import_id: String,
) -> AppResult<usize> {
    with_conn(&state, |c| repo::transactions::remove_by_import(c, &import_id))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatementPeriodPatchInput {
    pub id: String,
    pub statement_year_month: Option<String>,
}

#[tauri::command]
pub fn transactions_bulk_set_statement_periods(
    state: State<AppState>,
    patches: Vec<StatementPeriodPatchInput>,
) -> AppResult<usize> {
    with_conn(&state, |c| {
        let refs: Vec<repo::transactions::StatementPeriodPatch> = patches
            .iter()
            .map(|p| repo::transactions::StatementPeriodPatch {
                id: &p.id,
                statement_year_month: p.statement_year_month.as_deref(),
            })
            .collect();
        repo::transactions::bulk_set_statement_periods(c, &refs)
    })
}

#[tauri::command]
pub fn cards_restore(state: State<AppState>, card: Card) -> AppResult<Card> {
    with_conn(&state, |c| repo::cards::restore(c, &card))
}

#[tauri::command]
pub fn categories_restore(
    state: State<AppState>,
    category: Category,
) -> AppResult<Category> {
    with_conn(&state, |c| repo::categories::restore(c, &category))
}

#[derive(serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BulkPatchInput {
    /// `Some(s)` rename to s; `None` leave description alone.
    #[serde(default)]
    pub description: Option<String>,
    /// `Some(Some(s))` set merchant_clean to s; `Some(None)` clear it;
    /// `None` (the field absent) leave it alone. Mirror the semantics for
    /// category_id below.
    #[serde(default, deserialize_with = "deserialize_explicit_option")]
    pub merchant_clean: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_explicit_option")]
    pub category_id: Option<Option<String>>,
}

/// Lets us tell apart "field absent" from "field present and null" in a
/// JSON patch. serde-json's default `Option<T>` flattens both to None.
fn deserialize_explicit_option<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de>,
{
    use serde::Deserialize;
    Option::<T>::deserialize(deserializer).map(Some)
}

#[tauri::command]
pub fn transactions_bulk_update(
    state: State<AppState>,
    ids: Vec<String>,
    patch: BulkPatchInput,
) -> AppResult<usize> {
    with_conn(&state, |c| {
        let bp = repo::transactions::BulkPatch {
            description: patch.description.as_deref(),
            merchant_clean: patch.merchant_clean.as_ref().map(|o| o.as_deref()),
            category_id: patch.category_id.as_ref().map(|o| o.as_deref()),
        };
        repo::transactions::bulk_update(c, &ids, &bp)
    })
}

#[tauri::command]
pub fn transactions_bulk_remove(
    state: State<AppState>,
    ids: Vec<String>,
) -> AppResult<usize> {
    with_conn(&state, |c| repo::transactions::bulk_remove(c, &ids))
}

#[tauri::command]
pub fn transactions_month_summary(
    state: State<AppState>,
    year_month: String,
    card_id: Option<String>,
) -> AppResult<MonthSummary> {
    with_conn(&state, |c| {
        repo::transactions::month_summary(c, &year_month, card_id.as_deref())
    })
}

#[tauri::command]
pub fn transactions_year_summary(
    state: State<AppState>,
    year: String,
    card_id: Option<String>,
) -> AppResult<YearSummary> {
    with_conn(&state, |c| {
        repo::transactions::year_summary(c, &year, card_id.as_deref())
    })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub issuer: pdf::Issuer,
    pub transactions: Vec<pdf::ParsedTransaction>,
    /// Sofisa-style card-level metadata (closing/due day) when the parser
    /// detects a recognizable header. Other issuers leave this `None` for
    /// now — the UI then just hides the suggestion banner.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub card_metadata: Option<pdf::CardMetadata>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRow {
    pub posted_at: String,
    pub description: String,
    pub merchant_clean: Option<String>,
    pub amount_cents: i64,
    pub currency: Option<String>,
    pub category_id: Option<String>,
    pub installment_index: Option<i64>,
    pub installment_total: Option<i64>,
    #[serde(default)]
    pub is_refund: bool,
    #[serde(default)]
    pub is_virtual_card: bool,
    /// Frontend-computed statement period for this row. None falls back
    /// to the card's nominal closing_day inside `import_commit` so that
    /// non-Sofisa imports (where the parser has no header to read) still
    /// land on a sensible statement.
    #[serde(default)]
    pub statement_year_month: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub inserted: usize,
    pub skipped: usize,
    pub total: usize,
    /// Stamped on every row of this import; the undo flow uses it with
    /// `transactions_remove_by_import` to roll the whole fatura back in
    /// one shot.
    pub import_id: String,
}

#[tauri::command]
pub fn import_extract_pdf(path: String, password: Option<String>) -> AppResult<String> {
    pdf::extract_text(&PathBuf::from(&path), password.as_deref())
}

#[tauri::command]
pub fn import_parse(
    state: State<AppState>,
    text: String,
    issuer_hint: Option<pdf::Issuer>,
    reference_year_month: Option<String>,
    card_id: Option<String>,
) -> AppResult<ImportPreview> {
    let issuer = issuer_hint.unwrap_or_else(|| pdf::detect_issuer(&text));

    // Resolve the card's closing_day so the parser can disambiguate DD/MM
    // rows around the closing pivot (Aug statement closing on day 16
    // contains rows from 17/07 to 16/08; without closing_day we'd guess
    // the wrong year on a Dec→Jan rollover).
    let closing_day: Option<u32> = match card_id {
        Some(ref cid) => {
            let guard = state.vault.lock().map_err(|_| AppError::Internal("vault mutex poisoned".into()))?;
            let v = guard.as_ref();
            v.and_then(|v| {
                v.conn.lock().ok().and_then(|c| {
                    c.query_row(
                        "SELECT closing_day FROM cards WHERE id = ?",
                        [cid],
                        |r| r.get::<_, i64>(0),
                    )
                    .ok()
                    .map(|d| d as u32)
                })
            })
        }
        None => None,
    };

    let mut transactions = pdf::parse(&text, issuer, reference_year_month.as_deref(), closing_day)?;
    // Best-effort auto-categorization. Skipped silently if vault is locked
    // (allows previewing parser output before unlocking, e.g. for testing).
    if let Ok(guard) = state.vault.lock() {
        if let Some(vault) = guard.as_ref() {
            if let Ok(conn) = vault.conn.lock() {
                let _ = crate::categorize::apply_rules(&conn, &mut transactions);
            }
        }
    }
    // Sofisa is the only issuer that prints a structured card-metadata
    // header today. Other issuers stay `None`; the UI hides the banner.
    let card_metadata = match issuer {
        pdf::Issuer::Sofisa => pdf::extract_sofisa_metadata(&text),
        _ => None,
    };
    Ok(ImportPreview {
        issuer,
        transactions,
        card_metadata,
    })
}

#[tauri::command]
pub fn import_commit(
    state: State<AppState>,
    card_id: String,
    rows: Vec<ImportRow>,
) -> AppResult<ImportResult> {
    let total = rows.len();
    let import_id = format!("imp-{}", uuid::Uuid::new_v4());

    let guard = state.vault.lock().map_err(|_| AppError::Internal("vault mutex poisoned".into()))?;
    let vault = guard.as_ref().ok_or(AppError::VaultLocked)?;
    let conn = vault.conn.lock().map_err(|_| AppError::Internal("connection mutex poisoned".into()))?;

    // Snapshot the vault file BEFORE we start writing. Holding both locks here
    // means no other command can touch the connection while we copy, so the
    // file on disk is in a consistent between-transactions state.
    if let Err(e) = crate::vault::backup::create_backup(&vault.path) {
        eprintln!("backup failed before import (continuing): {}", e);
    }

    // All inserts run inside a single SQLite transaction — if any row fails,
    // the imports record and any partial transactions roll back automatically
    // when `tx` is dropped without `commit()`. Prevents the "imports row says
    // 100 inserted but only 50 actually landed" inconsistency.
    let result: AppResult<ImportResult> = (|| {
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO imports (id, source, file_name, raw_hash, status, card_id)
             VALUES (?, 'paste', NULL, NULL, 'committed', ?)",
            rusqlite::params![import_id, card_id],
        )?;

        let mut inserted = 0usize;
        let mut skipped = 0usize;
        for row in rows {
            let dedup = compute_dedup(&row.posted_at, row.amount_cents, &row.description);
            // Skip only if a row with this hash exists OUTSIDE the current
            // import — i.e. from a previous import or a manual entry. Two
            // identical lines in the same statement (e.g. two PADEL games
            // at R$ 12,00 on the same day) are genuinely separate
            // purchases, not duplicates, and previously the second one was
            // silently dropped because it matched the first one we'd just
            // inserted in this same transaction.
            let exists: i64 = tx.query_row(
                "SELECT COUNT(*) FROM transactions
                 WHERE dedup_hash = ?
                   AND COALESCE(source_import_id, '') != ?",
                rusqlite::params![&dedup, &import_id],
                |r| r.get(0),
            )?;
            if exists > 0 {
                skipped += 1;
                continue;
            }
            let id = format!("tx-{}", uuid::Uuid::new_v4());
            let currency = row.currency.unwrap_or_else(|| "BRL".into());
            // Tag installment rows with a group_id so the Installments page
            // and the active-installments stat recognize them as one
            // purchase. When importing successive statements of the same
            // card, reuse an existing group_id if there's already a row with
            // the same description+total — otherwise the same Amazon 1/6
            // and 2/6 land in different groups and the UI counts each
            // statement as a brand-new installment plan.
            let installment_group_id: Option<String> = if row.installment_total.is_some() {
                let existing: Option<String> = tx
                    .query_row(
                        "SELECT installment_group_id FROM transactions
                         WHERE card_id = ?1
                           AND installment_total = ?2
                           AND installment_group_id IS NOT NULL
                           AND (
                             description = ?3
                             OR (merchant_clean IS NOT NULL AND ?4 IS NOT NULL AND merchant_clean = ?4)
                           )
                         LIMIT 1",
                        rusqlite::params![
                            card_id,
                            row.installment_total,
                            row.description,
                            row.merchant_clean,
                        ],
                        |r| r.get(0),
                    )
                    .optional()?;
                Some(existing.unwrap_or_else(|| format!("grp-{}", uuid::Uuid::new_v4())))
            } else {
                None
            };
            // Backfill the FK parent in installment_groups. The schema requires it
            // even though the table is otherwise unused; INSERT OR IGNORE keeps the
            // 2nd..Nth rows of the same group from re-inserting.
            if let Some(ref gid) = installment_group_id {
                let total_n = row.installment_total.unwrap_or(1).max(1);
                let total_cents = row.amount_cents.saturating_mul(total_n as i64);
                tx.execute(
                    "INSERT OR IGNORE INTO installment_groups (id, total_n, total_cents, first_posted_at, description)
                     VALUES (?, ?, ?, ?, ?)",
                    rusqlite::params![gid, total_n, total_cents, row.posted_at, row.description],
                )?;
            }
            // Resolve statement period: caller-supplied (frontend computed it
            // using the closing_day printed on the parsed Sofisa header) wins;
            // otherwise fall back to the card's nominal closing_day so non-
            // Sofisa imports still land somewhere.
            let stmt_period: Option<String> = match row.statement_year_month.clone() {
                Some(s) => Some(s),
                None => tx
                    .query_row(
                        "SELECT closing_day FROM cards WHERE id = ?",
                        [&card_id],
                        |r| r.get::<_, i64>(0),
                    )
                    .ok()
                    .map(|closing| {
                        crate::repo::transactions::statement_period(&row.posted_at, closing)
                    }),
            };
            tx.execute(
                "INSERT INTO transactions (id, card_id, posted_at, description, merchant_clean, amount_cents, currency, category_id, installment_group_id, installment_index, installment_total, is_refund, is_virtual_card, source_import_id, dedup_hash, statement_year_month)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                rusqlite::params![
                    id,
                    card_id,
                    row.posted_at,
                    row.description,
                    row.merchant_clean,
                    row.amount_cents,
                    currency,
                    row.category_id,
                    installment_group_id,
                    row.installment_index,
                    row.installment_total,
                    if row.is_refund { 1 } else { 0 },
                    if row.is_virtual_card { 1 } else { 0 },
                    import_id,
                    dedup,
                    stmt_period,
                ],
            )?;
            inserted += 1;
        }
        let summary = ImportResult {
            inserted,
            skipped,
            total,
            import_id: import_id.clone(),
        };
        tx.commit()?;
        Ok(summary)
    })();

    result
}

#[tauri::command]
pub fn export_csv(
    state: State<AppState>,
    path: String,
    year_month: Option<String>,
) -> AppResult<usize> {
    use std::fs::File;
    use std::io::{BufWriter, Write};

    with_conn(&state, |conn| {
        let mut stmt = conn.prepare(
            "SELECT t.posted_at, c.name, t.description, t.merchant_clean, cat.name,
                    t.amount_cents, t.is_refund, t.installment_index, t.installment_total
             FROM transactions t
             JOIN cards c ON c.id = t.card_id
             LEFT JOIN categories cat ON cat.id = t.category_id
             WHERE (?1 IS NULL OR substr(t.posted_at,1,7) = ?1)
             ORDER BY t.posted_at DESC, t.id DESC",
        )?;

        let rows = stmt.query_map(rusqlite::params![year_month], |r| {
            Ok(CsvRow {
                posted_at: r.get(0)?,
                card_name: r.get(1)?,
                description: r.get(2)?,
                merchant_clean: r.get(3)?,
                category_name: r.get(4)?,
                amount_cents: r.get(5)?,
                is_refund: r.get(6)?,
                installment_index: r.get(7)?,
                installment_total: r.get(8)?,
            })
        })?;

        let file = File::create(&path)?;
        let mut w = BufWriter::new(file);
        // UTF-8 BOM so Excel BR shows accents correctly.
        w.write_all(&[0xEF, 0xBB, 0xBF])?;
        writeln!(
            w,
            "Date;Card;Description;Merchant;Category;Amount;Installment;Refund"
        )?;

        let mut count = 0;
        for row in rows {
            let r = row?;
            // Integer math avoids the f64 -> i64 round-trip losing precision
            // for very large cents values (>2^53).
            let abs = r.amount_cents.abs();
            let sign = if r.amount_cents < 0 { "-" } else { "" };
            let amount = format!("{}{},{:02}", sign, abs / 100, abs % 100);
            let installment = match (r.installment_index, r.installment_total) {
                (Some(i), Some(t)) => format!("{}/{}", i, t),
                _ => String::new(),
            };
            let refund = if r.is_refund { "Yes" } else { "No" };
            let date = r.posted_at.split('T').next().unwrap_or(&r.posted_at);
            writeln!(
                w,
                "{};{};{};{};{};{};{};{}",
                date,
                escape_csv(&r.card_name),
                escape_csv(&r.description),
                escape_csv(r.merchant_clean.as_deref().unwrap_or("")),
                escape_csv(r.category_name.as_deref().unwrap_or("")),
                amount,
                installment,
                refund,
            )?;
            count += 1;
        }
        w.flush()?;
        Ok(count)
    })
}

struct CsvRow {
    posted_at: String,
    card_name: String,
    description: String,
    merchant_clean: Option<String>,
    category_name: Option<String>,
    amount_cents: i64,
    is_refund: bool,
    installment_index: Option<i64>,
    installment_total: Option<i64>,
}

fn escape_csv(s: &str) -> String {
    if s.contains(';') || s.contains('"') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

#[tauri::command]
pub fn vault_backup_now(state: State<AppState>) -> AppResult<String> {
    let guard = state.vault.lock().map_err(|_| AppError::Internal("vault mutex poisoned".into()))?;
    let vault = guard.as_ref().ok_or(AppError::VaultLocked)?;
    let _conn_lock = vault.conn.lock().map_err(|_| AppError::Internal("connection mutex poisoned".into()))?;
    let path = crate::vault::backup::create_backup(&vault.path)?;
    Ok(path.display().to_string())
}

fn compute_dedup(posted_at: &str, amount_cents: i64, description: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let normalized: String = description
        .to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect();
    let mut hasher = DefaultHasher::new();
    posted_at.hash(&mut hasher);
    amount_cents.hash(&mut hasher);
    normalized.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}
