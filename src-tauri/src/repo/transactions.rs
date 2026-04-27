use rusqlite::{params, Connection};
use uuid::Uuid;

use crate::error::AppResult;
use crate::models::{
    CardSummary, CategorySummary, MonthSummary, Transaction, TransactionFilter, TransactionInput,
};

fn map_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Transaction> {
    Ok(Transaction {
        id: r.get(0)?,
        card_id: r.get(1)?,
        posted_at: r.get(2)?,
        description: r.get(3)?,
        merchant_clean: r.get(4)?,
        amount_cents: r.get(5)?,
        currency: r.get(6)?,
        fx_rate: r.get(7)?,
        category_id: r.get(8)?,
        notes: r.get(9)?,
        installment_group_id: r.get(10)?,
        installment_index: r.get(11)?,
        installment_total: r.get(12)?,
        is_refund: r.get::<_, i64>(13)? != 0,
        source_import_id: r.get(14)?,
        is_virtual_card: r.get::<_, i64>(15)? != 0,
        statement_year_month: r.get(16)?,
    })
}

const SELECT_COLS: &str = "id, card_id, posted_at, description, merchant_clean, amount_cents, currency, fx_rate, category_id, notes, installment_group_id, installment_index, installment_total, is_refund, source_import_id, is_virtual_card, statement_year_month";

pub fn list(conn: &Connection, filter: &TransactionFilter) -> AppResult<Vec<Transaction>> {
    let mut sql = format!("SELECT {} FROM transactions WHERE 1=1", SELECT_COLS);
    let mut values: Vec<rusqlite::types::Value> = Vec::new();

    if let Some(ym) = &filter.year_month {
        // When the user is scoped to a single card AND a year_month,
        // filter by the persisted statement_year_month — the column was
        // stamped at insert time using the closing_day actually printed
        // on that statement, so it's robust against banks (Sofisa) that
        // shift their closing date month-to-month.
        // For multi-card / no-card view, fall back to calendar month
        // since multiple cards have no shared statement period.
        if filter.card_id.is_some() {
            sql.push_str(" AND statement_year_month = ?");
            values.push(rusqlite::types::Value::Text(ym.clone()));
        } else {
            sql.push_str(" AND substr(posted_at, 1, 7) = ?");
            values.push(rusqlite::types::Value::Text(ym.clone()));
        }
    }
    if let Some(card) = &filter.card_id {
        sql.push_str(" AND card_id = ?");
        values.push(rusqlite::types::Value::Text(card.clone()));
    }
    if let Some(cat) = &filter.category_id {
        sql.push_str(" AND category_id = ?");
        values.push(rusqlite::types::Value::Text(cat.clone()));
    }
    if let Some(q) = &filter.query {
        let trimmed = q.trim();
        if !trimmed.is_empty() {
            sql.push_str(
                " AND (LOWER(description) LIKE ? OR LOWER(COALESCE(merchant_clean,'')) LIKE ?)",
            );
            let pat = format!("%{}%", trimmed.to_lowercase());
            values.push(rusqlite::types::Value::Text(pat.clone()));
            values.push(rusqlite::types::Value::Text(pat));
        }
    }
    sql.push_str(" ORDER BY posted_at DESC, created_at DESC");

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(values), map_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Transaction> {
    let sql = format!("SELECT {} FROM transactions WHERE id = ?", SELECT_COLS);
    let tx = conn.query_row(&sql, [id], map_row)?;
    Ok(tx)
}

pub fn create(conn: &Connection, input: &TransactionInput) -> AppResult<Transaction> {
    let id = format!("tx-{}", Uuid::new_v4());
    let dedup = compute_dedup_hash(
        &input.posted_at,
        input.amount_cents,
        &input.description,
    );
    let currency = input.currency.clone().unwrap_or_else(|| "BRL".into());
    // Resolve the statement period this row belongs to. Caller's explicit
    // value wins (import path passes the closing_day from the parsed Sofisa
    // header); otherwise we look up the card's nominal closing_day and run
    // it through the same `statement_period` helper. Stored once and never
    // recomputed at query time — see migrations.rs SCHEMA_V5_ALTER.
    let stmt_period: Option<String> = match input.statement_year_month.clone() {
        Some(s) => Some(s),
        None => conn
            .query_row(
                "SELECT closing_day FROM cards WHERE id = ?",
                [&input.card_id],
                |r| r.get::<_, i64>(0),
            )
            .ok()
            .map(|closing| statement_period(&input.posted_at, closing)),
    };
    // The transactions table has a FK on installment_group_id → installment_groups(id),
    // but the original schema's installment_groups table was never written to — so any
    // row with a non-null group_id violated the FK as soon as foreign_keys=ON. Backfill
    // the parent here. INSERT OR IGNORE so subsequent rows in the same group don't
    // collide on the PK.
    if let Some(group_id) = input.installment_group_id.as_deref() {
        let total_n = input.installment_total.unwrap_or(1).max(1);
        let total_cents = input.amount_cents.saturating_mul(total_n as i64);
        conn.execute(
            "INSERT OR IGNORE INTO installment_groups (id, total_n, total_cents, first_posted_at, description)
             VALUES (?, ?, ?, ?, ?)",
            params![group_id, total_n, total_cents, input.posted_at, input.description],
        )?;
    }
    conn.execute(
        "INSERT INTO transactions (id, card_id, posted_at, description, merchant_clean, amount_cents, currency, fx_rate, category_id, notes, installment_group_id, installment_index, installment_total, is_refund, is_virtual_card, source_import_id, dedup_hash, statement_year_month)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        params![
            id,
            input.card_id,
            input.posted_at,
            input.description,
            input.merchant_clean,
            input.amount_cents,
            currency,
            input.fx_rate,
            input.category_id,
            input.notes,
            input.installment_group_id,
            input.installment_index,
            input.installment_total,
            if input.is_refund { 1 } else { 0 },
            if input.is_virtual_card { 1 } else { 0 },
            input.source_import_id,
            dedup,
            stmt_period,
        ],
    )?;
    get(conn, &id)
}

pub fn update(conn: &Connection, id: &str, patch: &serde_json::Value) -> AppResult<Transaction> {
    let mut sets: Vec<&str> = Vec::new();
    let mut values: Vec<rusqlite::types::Value> = Vec::new();

    let str_field = |field: &str, col: &'static str, sets: &mut Vec<&'static str>, values: &mut Vec<rusqlite::types::Value>| {
        if let Some(v) = patch.get(field) {
            let stmt: &'static str = match col {
                "card_id" => "card_id = ?",
                "posted_at" => "posted_at = ?",
                "description" => "description = ?",
                "merchant_clean" => "merchant_clean = ?",
                "currency" => "currency = ?",
                "category_id" => "category_id = ?",
                "notes" => "notes = ?",
                "installment_group_id" => "installment_group_id = ?",
                "source_import_id" => "source_import_id = ?",
                _ => return,
            };
            sets.push(stmt);
            values.push(
                v.as_str()
                    .map(|s| rusqlite::types::Value::Text(s.to_string()))
                    .unwrap_or(rusqlite::types::Value::Null),
            );
        }
    };

    str_field("cardId", "card_id", &mut sets, &mut values);
    str_field("postedAt", "posted_at", &mut sets, &mut values);
    str_field("description", "description", &mut sets, &mut values);
    str_field("merchantClean", "merchant_clean", &mut sets, &mut values);
    str_field("currency", "currency", &mut sets, &mut values);
    str_field("categoryId", "category_id", &mut sets, &mut values);
    str_field("notes", "notes", &mut sets, &mut values);
    str_field("installmentGroupId", "installment_group_id", &mut sets, &mut values);
    str_field("sourceImportId", "source_import_id", &mut sets, &mut values);

    if let Some(v) = patch.get("amountCents").and_then(|v| v.as_i64()) {
        sets.push("amount_cents = ?");
        values.push(rusqlite::types::Value::Integer(v));
    }
    if let Some(v) = patch.get("fxRate").and_then(|v| v.as_f64()) {
        sets.push("fx_rate = ?");
        values.push(rusqlite::types::Value::Real(v));
    }
    if let Some(v) = patch.get("installmentIndex").and_then(|v| v.as_i64()) {
        sets.push("installment_index = ?");
        values.push(rusqlite::types::Value::Integer(v));
    }
    if let Some(v) = patch.get("installmentTotal").and_then(|v| v.as_i64()) {
        sets.push("installment_total = ?");
        values.push(rusqlite::types::Value::Integer(v));
    }
    if let Some(v) = patch.get("isRefund").and_then(|v| v.as_bool()) {
        sets.push("is_refund = ?");
        values.push(rusqlite::types::Value::Integer(if v { 1 } else { 0 }));
    }
    if let Some(v) = patch.get("isVirtualCard").and_then(|v| v.as_bool()) {
        sets.push("is_virtual_card = ?");
        values.push(rusqlite::types::Value::Integer(if v { 1 } else { 0 }));
    }

    // Same FK ceremony as create(): if the patch is attaching this row to
    // an installment group, make sure the parent row exists in
    // installment_groups before the UPDATE runs. Without this, the
    // "promote a single transaction into k/N installment" flow trips
    // SQLITE_CONSTRAINT_FOREIGNKEY on the UPDATE itself, before the
    // cascade ever gets to call create() (which does its own backfill).
    if let Some(group_val) = patch.get("installmentGroupId") {
        if let Some(group_id) = group_val.as_str() {
            let current = get(conn, id)?;
            let total_n = patch
                .get("installmentTotal")
                .and_then(|v| v.as_i64())
                .or(current.installment_total)
                .unwrap_or(1)
                .max(1);
            let amount_cents = patch
                .get("amountCents")
                .and_then(|v| v.as_i64())
                .unwrap_or(current.amount_cents);
            let posted_at = patch
                .get("postedAt")
                .and_then(|v| v.as_str())
                .map(String::from)
                .unwrap_or(current.posted_at);
            let description = patch
                .get("description")
                .and_then(|v| v.as_str())
                .map(String::from)
                .unwrap_or(current.description);
            let total_cents = amount_cents.saturating_mul(total_n);
            conn.execute(
                "INSERT OR IGNORE INTO installment_groups (id, total_n, total_cents, first_posted_at, description)
                 VALUES (?, ?, ?, ?, ?)",
                params![group_id, total_n, total_cents, posted_at, description],
            )?;
        }
    }

    if !sets.is_empty() {
        let sql = format!("UPDATE transactions SET {} WHERE id = ?", sets.join(", "));
        values.push(rusqlite::types::Value::Text(id.to_string()));
        conn.execute(&sql, rusqlite::params_from_iter(values))?;
    }
    get(conn, id)
}

pub fn remove(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute("DELETE FROM transactions WHERE id = ?", [id])?;
    Ok(())
}

/// Delete a batch of transactions in one prepared-statement loop. Used
/// by the multi-select toolbar in the Transactions page so the user
/// can clear a stack of imported test rows in one click.
pub fn bulk_remove(conn: &Connection, ids: &[String]) -> AppResult<usize> {
    if ids.is_empty() {
        return Ok(0);
    }
    let mut stmt = conn.prepare("DELETE FROM transactions WHERE id = ?")?;
    let mut count = 0usize;
    for id in ids {
        count += stmt.execute([id])?;
    }
    Ok(count)
}

/// What to apply to every row in `ids`. Each `Some` field is patched;
/// each `None` is left alone. Used by the BulkApplyDialog follow-up
/// after a single edit to propagate description/merchant_clean and/or
/// category_id to related rows (other parcelas, same-name purchases).
pub struct BulkPatch<'a> {
    pub description: Option<&'a str>,
    pub merchant_clean: Option<Option<&'a str>>,
    pub category_id: Option<Option<&'a str>>,
}

/// Bulk-apply a partial patch to a set of transactions. Single prepared
/// statement reused across rows so we don't pay a round-trip per id.
/// The SQL is built dynamically based on which fields are set so we
/// don't write `description = description` no-ops when only the category
/// is changing.
pub fn bulk_update(
    conn: &Connection,
    ids: &[String],
    patch: &BulkPatch<'_>,
) -> AppResult<usize> {
    if ids.is_empty() {
        return Ok(0);
    }
    let mut sets: Vec<&'static str> = Vec::new();
    if patch.description.is_some() {
        sets.push("description = ?");
    }
    if patch.merchant_clean.is_some() {
        sets.push("merchant_clean = ?");
    }
    if patch.category_id.is_some() {
        sets.push("category_id = ?");
    }
    if sets.is_empty() {
        return Ok(0);
    }
    let sql = format!(
        "UPDATE transactions SET {} WHERE id = ?",
        sets.join(", "),
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut count = 0usize;
    for id in ids {
        let mut binds: Vec<rusqlite::types::Value> = Vec::new();
        if let Some(d) = patch.description {
            binds.push(rusqlite::types::Value::Text(d.to_string()));
        }
        if let Some(m) = patch.merchant_clean {
            binds.push(match m {
                Some(s) => rusqlite::types::Value::Text(s.to_string()),
                None => rusqlite::types::Value::Null,
            });
        }
        if let Some(c) = patch.category_id {
            binds.push(match c {
                Some(s) => rusqlite::types::Value::Text(s.to_string()),
                None => rusqlite::types::Value::Null,
            });
        }
        binds.push(rusqlite::types::Value::Text(id.clone()));
        count += stmt.execute(rusqlite::params_from_iter(binds))?;
    }
    Ok(count)
}

pub fn month_summary(
    conn: &Connection,
    year_month: &str,
    card_id: Option<&str>,
) -> AppResult<MonthSummary> {
    // Mirror list(): when scoped to a card, filter by the persisted
    // statement_year_month column. Falls back to calendar month for
    // multi-card / no-card aggregation.
    let (period_filter, mut binds): (&str, Vec<rusqlite::types::Value>) = if card_id.is_some() {
        (
            "statement_year_month = ?",
            vec![rusqlite::types::Value::Text(year_month.to_string())],
        )
    } else {
        (
            "substr(posted_at,1,7) = ?",
            vec![rusqlite::types::Value::Text(year_month.to_string())],
        )
    };

    let card_filter = if card_id.is_some() {
        binds.push(rusqlite::types::Value::Text(card_id.unwrap().to_string()));
        " AND card_id = ?"
    } else {
        ""
    };

    let total_sql = format!(
        "SELECT COALESCE(SUM(CASE WHEN is_refund=1 THEN -amount_cents ELSE amount_cents END), 0)
         FROM transactions WHERE {}{}",
        period_filter, card_filter,
    );
    let total_cents: i64 = conn
        .query_row(
            &total_sql,
            rusqlite::params_from_iter(binds.iter()),
            |r| r.get(0),
        )
        .unwrap_or(0);

    let mut by_category: Vec<CategorySummary> = Vec::new();
    {
        let sql = format!(
            "SELECT category_id, SUM(CASE WHEN is_refund=1 THEN -amount_cents ELSE amount_cents END) AS total
             FROM transactions WHERE {}{}
             GROUP BY category_id ORDER BY total DESC",
            period_filter, card_filter,
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(binds.iter()), |r| {
            Ok(CategorySummary {
                category_id: r.get(0)?,
                total_cents: r.get(1)?,
            })
        })?;
        for r in rows {
            by_category.push(r?);
        }
    }
    by_category.sort_by(|a, b| b.total_cents.cmp(&a.total_cents));

    let mut by_card: Vec<CardSummary> = Vec::new();
    {
        let sql = format!(
            "SELECT card_id, SUM(CASE WHEN is_refund=1 THEN -amount_cents ELSE amount_cents END) AS total
             FROM transactions WHERE {}{}
             GROUP BY card_id ORDER BY total DESC",
            period_filter, card_filter,
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(binds.iter()), |r| {
            Ok(CardSummary {
                card_id: r.get(0)?,
                total_cents: r.get(1)?,
            })
        })?;
        for r in rows {
            by_card.push(r?);
        }
    }

    Ok(MonthSummary {
        total_cents,
        by_category,
        by_card,
    })
}

/// Maps an ISO date + the card's closing day to the "YYYY-MM" of the
/// statement that purchase belongs to. The statement that closes on day
/// `closing_day` of month M contains purchases dated (M-1, closing_day+1)
/// through (M, closing_day) — so anything posted *after* closing rolls
/// into the next month's statement.
///
/// Examples with `closing_day = 16`:
///   2024-08-14 → "2024-08" (before closing)
///   2024-07-17 → "2024-08" (after July's closing → August statement)
///   2024-12-17 → "2025-01" (year rolls over)
pub fn statement_period(posted_at: &str, closing_day: i64) -> String {
    let date = posted_at.get(..10).unwrap_or("2026-01-01");
    let y: i32 = date.get(..4).and_then(|s| s.parse().ok()).unwrap_or(2026);
    let m: u32 = date.get(5..7).and_then(|s| s.parse().ok()).unwrap_or(1);
    let d: u32 = date.get(8..10).and_then(|s| s.parse().ok()).unwrap_or(1);
    if (d as i64) <= closing_day {
        format!("{:04}-{:02}", y, m)
    } else {
        let (ny, nm) = if m == 12 { (y + 1, 1u32) } else { (y, m + 1) };
        format!("{:04}-{:02}", ny, nm)
    }
}

fn compute_dedup_hash(posted_at: &str, amount_cents: i64, description: &str) -> String {
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

#[cfg(test)]
mod tests {
    use super::statement_period;

    #[test]
    fn statement_period_before_closing_stays_in_same_month() {
        assert_eq!(statement_period("2024-08-14T00:00:00Z", 16), "2024-08");
        assert_eq!(statement_period("2024-08-16T00:00:00Z", 16), "2024-08");
        assert_eq!(statement_period("2024-08-01T00:00:00Z", 16), "2024-08");
    }

    #[test]
    fn statement_period_after_closing_rolls_to_next_month() {
        assert_eq!(statement_period("2024-07-17T00:00:00Z", 16), "2024-08");
        assert_eq!(statement_period("2024-07-31T00:00:00Z", 16), "2024-08");
    }

    #[test]
    fn statement_period_handles_dec_jan_rollover() {
        assert_eq!(statement_period("2024-12-17T00:00:00Z", 16), "2025-01");
        assert_eq!(statement_period("2024-12-31T00:00:00Z", 16), "2025-01");
        assert_eq!(statement_period("2024-12-15T00:00:00Z", 16), "2024-12");
    }

    #[test]
    fn statement_period_handles_short_closing_day() {
        // closing on day 1 means almost everything rolls forward
        assert_eq!(statement_period("2024-08-01T00:00:00Z", 1), "2024-08");
        assert_eq!(statement_period("2024-08-02T00:00:00Z", 1), "2024-09");
    }

    #[test]
    fn statement_period_accepts_just_yyyy_mm_dd() {
        assert_eq!(statement_period("2024-08-14", 16), "2024-08");
        assert_eq!(statement_period("2024-07-17", 16), "2024-08");
    }

    #[test]
    fn statement_period_handles_sofisa_oscillation() {
        // Sofisa: same card, but the closing pivot drifts because the
        // cut-off avoids weekends/holidays. Each statement carries its
        // own actual closing_day, so a row dated 19/09 can land in either
        // "2024-09" (if Sep closed on day 19) or "2024-10" (if Sep
        // closed on day 18 and pushed 19 into October).
        // Aug 2024 statement closed 16:
        assert_eq!(statement_period("2024-08-16", 16), "2024-08");
        assert_eq!(statement_period("2024-07-17", 16), "2024-08");
        // Sep 2024 statement closed 19 (formula = due 24 - 5 days):
        assert_eq!(statement_period("2024-09-19", 19), "2024-09");
        assert_eq!(statement_period("2024-09-20", 19), "2024-10");
        assert_eq!(statement_period("2024-08-20", 19), "2024-09");
        // Oct 2024 statement closed 20 (no holiday shift):
        assert_eq!(statement_period("2024-10-20", 20), "2024-10");
        assert_eq!(statement_period("2024-10-21", 20), "2024-11");
        assert_eq!(statement_period("2024-09-21", 20), "2024-10");
    }
}
