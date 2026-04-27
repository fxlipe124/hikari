use rusqlite::{params, Connection};
use uuid::Uuid;

use crate::error::AppResult;
use crate::models::{Category, CategoryInput};

pub fn list(conn: &Connection) -> AppResult<Vec<Category>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, icon, color, parent_id
         FROM categories
         ORDER BY parent_id IS NOT NULL, name COLLATE NOCASE",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Category {
                id: r.get(0)?,
                name: r.get(1)?,
                icon: r.get(2)?,
                color: r.get(3)?,
                parent_id: r.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn create(conn: &Connection, input: &CategoryInput) -> AppResult<Category> {
    let id = format!("cat-{}", Uuid::new_v4());
    conn.execute(
        "INSERT INTO categories (id, name, icon, color, parent_id) VALUES (?, ?, ?, ?, ?)",
        params![id, input.name, input.icon, input.color, input.parent_id],
    )?;
    Ok(Category {
        id,
        name: input.name.clone(),
        icon: input.icon.clone(),
        color: input.color.clone(),
        parent_id: input.parent_id.clone(),
    })
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Category> {
    let cat = conn.query_row(
        "SELECT id, name, icon, color, parent_id FROM categories WHERE id = ?",
        [id],
        |r| {
            Ok(Category {
                id: r.get(0)?,
                name: r.get(1)?,
                icon: r.get(2)?,
                color: r.get(3)?,
                parent_id: r.get(4)?,
            })
        },
    )?;
    Ok(cat)
}

pub fn update(conn: &Connection, id: &str, patch: &serde_json::Value) -> AppResult<Category> {
    let mut sets: Vec<&str> = Vec::new();
    let mut values: Vec<rusqlite::types::Value> = Vec::new();

    if let Some(v) = patch.get("name").and_then(|v| v.as_str()) {
        sets.push("name = ?");
        values.push(rusqlite::types::Value::Text(v.to_string()));
    }
    if let Some(v) = patch.get("icon").and_then(|v| v.as_str()) {
        sets.push("icon = ?");
        values.push(rusqlite::types::Value::Text(v.to_string()));
    }
    if let Some(v) = patch.get("color").and_then(|v| v.as_str()) {
        sets.push("color = ?");
        values.push(rusqlite::types::Value::Text(v.to_string()));
    }
    if let Some(v) = patch.get("parentId") {
        sets.push("parent_id = ?");
        values.push(
            v.as_str()
                .map(|s| rusqlite::types::Value::Text(s.to_string()))
                .unwrap_or(rusqlite::types::Value::Null),
        );
    }

    if !sets.is_empty() {
        let sql = format!("UPDATE categories SET {} WHERE id = ?", sets.join(", "));
        values.push(rusqlite::types::Value::Text(id.to_string()));
        conn.execute(&sql, rusqlite::params_from_iter(values))?;
    }

    get(conn, id)
}

pub fn remove(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute("DELETE FROM categories WHERE id = ?", [id])?;
    Ok(())
}

/// Re-insert a category with its original id. Used by the undo flow after a
/// `categories_remove` so the bulk_update that re-attaches transactions to
/// this category points at the same id the user remembers.
pub fn restore(conn: &Connection, category: &Category) -> AppResult<Category> {
    conn.execute(
        "INSERT INTO categories (id, name, icon, color, parent_id) VALUES (?, ?, ?, ?, ?)",
        params![
            category.id,
            category.name,
            category.icon,
            category.color,
            category.parent_id,
        ],
    )?;
    Ok(category.clone())
}
