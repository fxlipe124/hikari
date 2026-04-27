use rusqlite::{params, Connection};
use uuid::Uuid;

use crate::error::AppResult;
use crate::models::{
    CardSummary, CategorySummary, MonthBucket, MonthSummary, Transaction, TransactionFilter,
    TransactionInput, YearSummary,
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
    } else if let Some(year) = &filter.year {
        // Yearly view: prefix-match on the same column the month case uses,
        // so single-card view stays statement-period-aware (a row dated
        // 17/12/2024 with closing day 16 lands in 2025-01 — the yearly view
        // must honor that and put it in 2025, not 2024).
        if filter.card_id.is_some() {
            sql.push_str(" AND substr(statement_year_month, 1, 4) = ?");
            values.push(rusqlite::types::Value::Text(year.clone()));
        } else {
            sql.push_str(" AND substr(posted_at, 1, 4) = ?");
            values.push(rusqlite::types::Value::Text(year.clone()));
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

/// Re-insert a previously-deleted batch of rows with their original IDs and
/// payloads. Used by the undo flow: capture the full Transaction list before
/// `remove`/`bulk_remove`, then call this to bring them back. dedup_hash is
/// recomputed (SQL forbids reading dropped values), but every other column —
/// including statement_year_month and source_import_id — is preserved verbatim
/// so the restored row joins back to its original import / installment group.
pub fn restore(conn: &Connection, rows: &[Transaction]) -> AppResult<usize> {
    if rows.is_empty() {
        return Ok(0);
    }
    let mut count = 0usize;
    for row in rows {
        if let Some(group_id) = row.installment_group_id.as_deref() {
            let total_n = row.installment_total.unwrap_or(1).max(1);
            let total_cents = row.amount_cents.saturating_mul(total_n);
            conn.execute(
                "INSERT OR IGNORE INTO installment_groups (id, total_n, total_cents, first_posted_at, description)
                 VALUES (?, ?, ?, ?, ?)",
                params![group_id, total_n, total_cents, row.posted_at, row.description],
            )?;
        }
        let dedup = compute_dedup_hash(&row.posted_at, row.amount_cents, &row.description);
        conn.execute(
            "INSERT INTO transactions (id, card_id, posted_at, description, merchant_clean, amount_cents, currency, fx_rate, category_id, notes, installment_group_id, installment_index, installment_total, is_refund, is_virtual_card, source_import_id, dedup_hash, statement_year_month)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            params![
                row.id,
                row.card_id,
                row.posted_at,
                row.description,
                row.merchant_clean,
                row.amount_cents,
                row.currency,
                row.fx_rate,
                row.category_id,
                row.notes,
                row.installment_group_id,
                row.installment_index,
                row.installment_total,
                if row.is_refund { 1 } else { 0 },
                if row.is_virtual_card { 1 } else { 0 },
                row.source_import_id,
                dedup,
                row.statement_year_month,
            ],
        )?;
        count += 1;
    }
    Ok(count)
}

/// Delete every row tagged with the given source_import_id. The natural undo
/// for an `import_commit`: a single import id rolls back the whole fatura
/// without the frontend having to track every inserted row.
pub fn remove_by_import(conn: &Connection, import_id: &str) -> AppResult<usize> {
    let count = conn.execute(
        "DELETE FROM transactions WHERE source_import_id = ?",
        [import_id],
    )?;
    Ok(count)
}

/// Restore exact statement_year_month values per id in one prepared-statement
/// loop. Used by the closing-day cascade undo: capture the before-state on
/// the frontend, run the cascade (which re-derives every row from
/// posted_at + closing_day), then on undo replay the captured periods to
/// preserve any value the import path had hand-stamped from the parsed
/// Sofisa header. Without this, undo would re-derive too and silently
/// re-clobber Sofisa-stamped rows. `None` writes SQL NULL.
pub struct StatementPeriodPatch<'a> {
    pub id: &'a str,
    pub statement_year_month: Option<&'a str>,
}

pub fn bulk_set_statement_periods(
    conn: &Connection,
    patches: &[StatementPeriodPatch<'_>],
) -> AppResult<usize> {
    if patches.is_empty() {
        return Ok(0);
    }
    let mut stmt = conn.prepare(
        "UPDATE transactions SET statement_year_month = ? WHERE id = ?",
    )?;
    let mut count = 0usize;
    for p in patches {
        let ym_value: rusqlite::types::Value = match p.statement_year_month {
            Some(s) => rusqlite::types::Value::Text(s.to_string()),
            None => rusqlite::types::Value::Null,
        };
        count += stmt.execute(rusqlite::params![ym_value, p.id])?;
    }
    Ok(count)
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

/// Yearly aggregate: total + per-month bucket + per-category + per-card.
/// Single-card view groups by the persisted statement_year_month so the
/// month buckets honor the closing-day pivot (a 17/12 row with closing
/// day 16 lands in 2025-01). Multi-card view falls back to calendar
/// `posted_at` since there's no shared statement period across cards.
pub fn year_summary(
    conn: &Connection,
    year: &str,
    card_id: Option<&str>,
) -> AppResult<YearSummary> {
    let (year_filter, period_expr, mut binds): (&str, &str, Vec<rusqlite::types::Value>) =
        if card_id.is_some() {
            (
                "substr(statement_year_month, 1, 4) = ?",
                "statement_year_month",
                vec![rusqlite::types::Value::Text(year.to_string())],
            )
        } else {
            (
                "substr(posted_at, 1, 4) = ?",
                "substr(posted_at, 1, 7)",
                vec![rusqlite::types::Value::Text(year.to_string())],
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
        year_filter, card_filter,
    );
    let total_cents: i64 = conn
        .query_row(
            &total_sql,
            rusqlite::params_from_iter(binds.iter()),
            |r| r.get(0),
        )
        .unwrap_or(0);

    // Per-month bucket. Pull what's actually in the DB; we'll fill missing
    // months with zeros below so the bar chart axis stays stable.
    let mut counts: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    {
        let sql = format!(
            "SELECT {} AS ym, SUM(CASE WHEN is_refund=1 THEN -amount_cents ELSE amount_cents END)
             FROM transactions WHERE {}{}
             GROUP BY ym",
            period_expr, year_filter, card_filter,
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(binds.iter()), |r| {
            Ok((r.get::<_, Option<String>>(0)?, r.get::<_, i64>(1)?))
        })?;
        for r in rows {
            let (ym, sum) = r?;
            if let Some(ym) = ym {
                counts.insert(ym, sum);
            }
        }
    }
    let mut by_month: Vec<MonthBucket> = (1..=12u32)
        .map(|m| {
            let key = format!("{}-{:02}", year, m);
            let total = counts.remove(&key).unwrap_or(0);
            MonthBucket {
                year_month: key,
                total_cents: total,
            }
        })
        .collect();
    // Carry over any straggler months that don't fit the YYYY-MM mold —
    // shouldn't happen with normal data but worth surfacing rather than
    // silently dropping.
    for (year_month, total_cents) in counts {
        by_month.push(MonthBucket {
            year_month,
            total_cents,
        });
    }

    let mut by_category: Vec<CategorySummary> = Vec::new();
    {
        let sql = format!(
            "SELECT category_id, SUM(CASE WHEN is_refund=1 THEN -amount_cents ELSE amount_cents END) AS total
             FROM transactions WHERE {}{}
             GROUP BY category_id ORDER BY total DESC",
            year_filter, card_filter,
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
            year_filter, card_filter,
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

    Ok(YearSummary {
        total_cents,
        by_month,
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
    use super::*;
    use crate::models::{Transaction, TransactionInput};
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        crate::vault::migrations::run(&conn, "en").unwrap();
        // Need at least one card for the FK to point at.
        conn.execute(
            "INSERT INTO cards (id, name, brand, closing_day, due_day) VALUES ('card-test', 'Test', 'visa', 16, 24)",
            [],
        )
        .unwrap();
        conn
    }

    fn make_input() -> TransactionInput {
        TransactionInput {
            card_id: "card-test".into(),
            posted_at: "2024-08-15T00:00:00Z".into(),
            description: "Coffee shop".into(),
            merchant_clean: Some("Coffee".into()),
            amount_cents: 1500,
            currency: Some("BRL".into()),
            fx_rate: None,
            category_id: None,
            notes: Some("Tasty".into()),
            installment_group_id: None,
            installment_index: None,
            installment_total: None,
            is_refund: false,
            is_virtual_card: false,
            source_import_id: None,
            statement_year_month: Some("2024-08".into()),
        }
    }

    #[test]
    fn restore_round_trip_preserves_id_and_period() {
        let conn = setup_test_db();
        let created = create(&conn, &make_input()).unwrap();
        let original_id = created.id.clone();
        let original_ym = created.statement_year_month.clone();

        // Snapshot, delete, restore.
        let snapshot: Vec<Transaction> = vec![created.clone()];
        remove(&conn, &original_id).unwrap();
        let restored_count = restore(&conn, &snapshot).unwrap();
        assert_eq!(restored_count, 1);

        let fetched = get(&conn, &original_id).unwrap();
        assert_eq!(fetched.id, original_id);
        assert_eq!(fetched.statement_year_month, original_ym);
        assert_eq!(fetched.description, "Coffee shop");
        assert_eq!(fetched.amount_cents, 1500);
        assert_eq!(fetched.notes.as_deref(), Some("Tasty"));
    }

    #[test]
    fn bulk_set_statement_periods_writes_each_id() {
        let conn = setup_test_db();
        let a = create(&conn, &make_input()).unwrap();
        let mut input_b = make_input();
        input_b.description = "Other".into();
        input_b.statement_year_month = Some("2024-09".into());
        let b = create(&conn, &input_b).unwrap();

        let patches = vec![
            StatementPeriodPatch {
                id: &a.id,
                statement_year_month: Some("2024-12"),
            },
            StatementPeriodPatch {
                id: &b.id,
                statement_year_month: None,
            },
        ];
        let count = bulk_set_statement_periods(&conn, &patches).unwrap();
        assert_eq!(count, 2);

        assert_eq!(get(&conn, &a.id).unwrap().statement_year_month.as_deref(), Some("2024-12"));
        assert_eq!(get(&conn, &b.id).unwrap().statement_year_month, None);
    }

    #[test]
    fn year_filter_lists_every_month_of_the_year() {
        let conn = setup_test_db();
        // Three rows: two in 2024, one in 2025.
        let mut a = make_input();
        a.posted_at = "2024-03-15T00:00:00Z".into();
        a.statement_year_month = Some("2024-03".into());
        a.description = "Mar 2024".into();
        let mut b = make_input();
        b.posted_at = "2024-11-02T00:00:00Z".into();
        b.statement_year_month = Some("2024-11".into());
        b.description = "Nov 2024".into();
        let mut c = make_input();
        c.posted_at = "2025-01-10T00:00:00Z".into();
        c.statement_year_month = Some("2025-01".into());
        c.description = "Jan 2025".into();
        create(&conn, &a).unwrap();
        create(&conn, &b).unwrap();
        create(&conn, &c).unwrap();

        let mut filter = TransactionFilter::default();
        filter.year = Some("2024".into());
        filter.card_id = Some("card-test".into());
        let rows = list(&conn, &filter).unwrap();
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().any(|r| r.description == "Mar 2024"));
        assert!(rows.iter().any(|r| r.description == "Nov 2024"));
    }

    #[test]
    fn year_summary_buckets_by_month_and_pads_zeros() {
        let conn = setup_test_db();
        let mut a = make_input();
        a.posted_at = "2024-03-15T00:00:00Z".into();
        a.statement_year_month = Some("2024-03".into());
        a.amount_cents = 1000;
        let mut b = make_input();
        b.posted_at = "2024-03-20T00:00:00Z".into();
        b.statement_year_month = Some("2024-03".into());
        b.description = "Other March".into();
        b.amount_cents = 500;
        let mut c = make_input();
        c.posted_at = "2024-11-02T00:00:00Z".into();
        c.statement_year_month = Some("2024-11".into());
        c.description = "Nov".into();
        c.amount_cents = 2500;
        create(&conn, &a).unwrap();
        create(&conn, &b).unwrap();
        create(&conn, &c).unwrap();

        let summary = year_summary(&conn, "2024", Some("card-test")).unwrap();
        assert_eq!(summary.total_cents, 1000 + 500 + 2500);
        // 12 months always returned, in order.
        assert_eq!(summary.by_month.len(), 12);
        assert_eq!(summary.by_month[2].year_month, "2024-03");
        assert_eq!(summary.by_month[2].total_cents, 1500);
        assert_eq!(summary.by_month[10].year_month, "2024-11");
        assert_eq!(summary.by_month[10].total_cents, 2500);
        // April through October all zero (no activity).
        for i in 3..10 {
            assert_eq!(summary.by_month[i].total_cents, 0);
        }
    }

    #[test]
    fn remove_by_import_only_nukes_matching_rows() {
        let conn = setup_test_db();
        // Pretend two separate imports landed two rows each.
        conn.execute(
            "INSERT INTO imports (id, source, status, card_id) VALUES ('imp-A', 'paste', 'committed', 'card-test')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO imports (id, source, status, card_id) VALUES ('imp-B', 'paste', 'committed', 'card-test')",
            [],
        ).unwrap();

        let mut a1 = make_input();
        a1.source_import_id = Some("imp-A".into());
        a1.description = "From A 1".into();
        let mut a2 = make_input();
        a2.source_import_id = Some("imp-A".into());
        a2.description = "From A 2".into();
        let mut b1 = make_input();
        b1.source_import_id = Some("imp-B".into());
        b1.description = "From B 1".into();

        create(&conn, &a1).unwrap();
        create(&conn, &a2).unwrap();
        create(&conn, &b1).unwrap();

        let removed = remove_by_import(&conn, "imp-A").unwrap();
        assert_eq!(removed, 2);

        // Only B should survive.
        let f = TransactionFilter::default();
        let remaining = list(&conn, &f).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].source_import_id.as_deref(), Some("imp-B"));
        assert_eq!(remaining[0].description, "From B 1");
    }


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
