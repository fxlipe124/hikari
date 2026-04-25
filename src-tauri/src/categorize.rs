use rusqlite::Connection;

use crate::error::AppResult;
use crate::pdf::ParsedTransaction;

#[derive(Debug)]
struct Rule {
    pattern_lower: String,
    match_type: String,
    category_id: String,
}

/// Apply seed + user-defined categorization rules in priority order.
/// Mutates each transaction's `category_id` only if currently `None`.
pub fn apply_rules(conn: &Connection, txs: &mut [ParsedTransaction]) -> AppResult<()> {
    let rules = load_rules(conn)?;
    if rules.is_empty() {
        return Ok(());
    }

    for tx in txs.iter_mut() {
        if tx.category_id.is_some() {
            continue;
        }
        let haystack = tx
            .merchant_clean
            .as_ref()
            .map(String::as_str)
            .unwrap_or(&tx.description)
            .to_lowercase();

        for r in &rules {
            let hit = match r.match_type.as_str() {
                "exact" => haystack == r.pattern_lower,
                "regex" => match regex::Regex::new(&r.pattern_lower) {
                    Ok(re) => re.is_match(&haystack),
                    Err(e) => {
                        eprintln!(
                            "categorize: invalid regex rule (category={}): {}",
                            r.category_id, e
                        );
                        false
                    }
                },
                _ => haystack.contains(&r.pattern_lower),
            };
            if hit {
                tx.category_id = Some(r.category_id.clone());
                break;
            }
        }
    }
    Ok(())
}

fn load_rules(conn: &Connection) -> AppResult<Vec<Rule>> {
    let mut stmt = conn.prepare(
        "SELECT pattern, match_type, category_id
         FROM rules
         ORDER BY priority DESC, rowid",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Rule {
                pattern_lower: r.get::<_, String>(0)?.to_lowercase(),
                match_type: r.get(1)?,
                category_id: r.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}
