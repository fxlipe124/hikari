use rusqlite::{params, Connection};
use uuid::Uuid;

use crate::error::AppResult;
use crate::models::{Card, CardInput};

pub fn list(conn: &Connection) -> AppResult<Vec<Card>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, brand, last4, closing_day, due_day, color, credit_limit_cents
         FROM cards ORDER BY name COLLATE NOCASE",
    )?;
    let rows = stmt
        .query_map([], map_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn create(conn: &Connection, input: &CardInput) -> AppResult<Card> {
    let id = format!("card-{}", Uuid::new_v4());
    conn.execute(
        "INSERT INTO cards (id, name, brand, last4, closing_day, due_day, color, credit_limit_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            id,
            input.name,
            input.brand,
            input.last4,
            input.closing_day,
            input.due_day,
            input.color,
            input.credit_limit_cents,
        ],
    )?;
    Ok(Card {
        id,
        name: input.name.clone(),
        brand: input.brand.clone(),
        last4: input.last4.clone(),
        closing_day: input.closing_day,
        due_day: input.due_day,
        color: input.color.clone(),
        credit_limit_cents: input.credit_limit_cents,
    })
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Card> {
    let card = conn.query_row(
        "SELECT id, name, brand, last4, closing_day, due_day, color, credit_limit_cents
         FROM cards WHERE id = ?",
        [id],
        map_row,
    )?;
    Ok(card)
}

pub fn update(conn: &Connection, id: &str, patch: &serde_json::Value) -> AppResult<Card> {
    let mut sets: Vec<&'static str> = Vec::new();
    let mut values: Vec<rusqlite::types::Value> = Vec::new();

    if let Some(v) = patch.get("name").and_then(|v| v.as_str()) {
        sets.push("name = ?");
        values.push(rusqlite::types::Value::Text(v.to_string()));
    }
    if let Some(v) = patch.get("brand").and_then(|v| v.as_str()) {
        sets.push("brand = ?");
        values.push(rusqlite::types::Value::Text(v.to_string()));
    }
    if let Some(v) = patch.get("last4") {
        sets.push("last4 = ?");
        values.push(
            v.as_str()
                .map(|s| rusqlite::types::Value::Text(s.to_string()))
                .unwrap_or(rusqlite::types::Value::Null),
        );
    }
    if let Some(v) = patch.get("closingDay").and_then(|v| v.as_i64()) {
        sets.push("closing_day = ?");
        values.push(rusqlite::types::Value::Integer(v));
    }
    if let Some(v) = patch.get("dueDay").and_then(|v| v.as_i64()) {
        sets.push("due_day = ?");
        values.push(rusqlite::types::Value::Integer(v));
    }
    if let Some(v) = patch.get("color").and_then(|v| v.as_str()) {
        sets.push("color = ?");
        values.push(rusqlite::types::Value::Text(v.to_string()));
    }
    if let Some(v) = patch.get("creditLimitCents") {
        sets.push("credit_limit_cents = ?");
        values.push(
            v.as_i64()
                .map(rusqlite::types::Value::Integer)
                .unwrap_or(rusqlite::types::Value::Null),
        );
    }

    if !sets.is_empty() {
        let sql = format!("UPDATE cards SET {} WHERE id = ?", sets.join(", "));
        values.push(rusqlite::types::Value::Text(id.to_string()));
        conn.execute(&sql, rusqlite::params_from_iter(values))?;
    }

    // Optional cascade: when the patch flips closing_day, the user usually
    // wants the existing transactions of this card to follow the new
    // grouping. Caller signals intent via `recomputeStatements: true` in the
    // patch payload — without that flag we leave statement_year_month
    // untouched (preserves accurate per-statement values that the import
    // path may have stamped from each Sofisa header).
    let recompute = patch
        .get("recomputeStatements")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if recompute {
        let new_closing: i64 = conn.query_row(
            "SELECT closing_day FROM cards WHERE id = ?",
            [id],
            |r| r.get(0),
        )?;
        conn.execute(
            "UPDATE transactions
             SET statement_year_month = (
               CASE WHEN CAST(SUBSTR(posted_at, 9, 2) AS INTEGER) > ?
                 THEN STRFTIME('%Y-%m', DATE(SUBSTR(posted_at, 1, 10), '+1 month'))
                 ELSE SUBSTR(posted_at, 1, 7)
               END
             )
             WHERE card_id = ?",
            params![new_closing, id],
        )?;
    }

    get(conn, id)
}


pub fn remove(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute("DELETE FROM cards WHERE id = ?", [id])?;
    Ok(())
}

fn map_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Card> {
    Ok(Card {
        id: r.get(0)?,
        name: r.get(1)?,
        brand: r.get(2)?,
        last4: r.get(3)?,
        closing_day: r.get(4)?,
        due_day: r.get(5)?,
        color: r.get(6)?,
        credit_limit_cents: r.get(7)?,
    })
}
