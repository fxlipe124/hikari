use std::collections::HashMap;

use chrono::NaiveDate;
use once_cell::sync::Lazy;
use regex::Regex;

use crate::error::AppResult;
use crate::pdf::parsers::{resolve_year_for_row, ParsedTransaction};

/// Matches lines like:
///   "12/03  IFOOD *PIZZARIA  87,90"
///   "12/03/2025  POSTO IPIRANGA  220,00"
///   "12 MAR  AMAZON BR - Parcela 2/6  159,80"
///
/// Capture groups: (date, description, amount).
static LINE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?m)^\s*(?P<date>\d{1,2}[/\-\s][A-Za-zçÇ]{3,9}|\d{1,2}/\d{1,2}(?:/\d{2,4})?)\s+(?P<desc>.{3,80}?)\s+(?P<amount>-?R?\$?\s?\d{1,3}(?:\.\d{3})*,\d{2})\s*$",
    )
    .expect("regex compile")
});

static INSTALLMENT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)parcela\s*(\d+)\s*/\s*(\d+)|(\d+)\s*de\s*(\d+)").expect("regex compile")
});

/// Full `DD/MM/YYYY` (or `DD-MM-YYYY`, `DD.MM.YYYY`) somewhere in the text.
static FULL_DATE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\b\d{1,2}[/\-\.]\d{1,2}[/\-\.](20\d{2})\b").expect("regex compile")
});

/// Bare `MM/YYYY` markers commonly used in statement headers
/// (e.g. "Período: 07/2024").
static MONTH_YEAR_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\b(?:0?[1-9]|1[0-2])[/\-\.](20\d{2})\b").expect("regex compile")
});

pub fn parse(
    text: &str,
    statement_year_month: Option<&str>,
    _closing_day: Option<u32>,
) -> AppResult<Vec<ParsedTransaction>> {
    // Year priority: explicit statement period > auto-detected from text > clock.
    let fallback_year = statement_year_month
        .and_then(|p| p.get(..4).and_then(|s| s.parse::<u32>().ok()))
        .or_else(|| extract_year_hint(text))
        .unwrap_or_else(|| chrono::Utc::now().year_naive());
    Ok(LINE_RE
        .captures_iter(text)
        .filter_map(|caps| parse_line(caps, fallback_year, statement_year_month))
        .collect())
}

fn parse_line(
    caps: regex::Captures,
    fallback_year: u32,
    statement_year_month: Option<&str>,
) -> Option<ParsedTransaction> {
    let date_raw = caps.name("date")?.as_str();
    let desc = caps.name("desc")?.as_str().trim().to_string();
    let amount_raw = caps.name("amount")?.as_str();

    let posted_at = normalize_date(date_raw, fallback_year, statement_year_month)?;
    let amount_cents = parse_brl_to_cents(amount_raw)?;

    // Skip rows whose amount column starts with `-`. Same rule as the
    // Sofisa parser — these are payments / credits the bank already
    // deducted, not purchases the user made.
    if amount_cents < 0 {
        return None;
    }

    let installment = INSTALLMENT_RE.captures(&desc).and_then(|c| {
        let (a, b) = if let (Some(a), Some(b)) = (c.get(1), c.get(2)) {
            (a, b)
        } else if let (Some(a), Some(b)) = (c.get(3), c.get(4)) {
            (a, b)
        } else {
            return None;
        };
        Some((
            a.as_str().parse::<i64>().ok()?,
            b.as_str().parse::<i64>().ok()?,
        ))
    });

    let is_refund = amount_cents < 0
        || desc.to_lowercase().contains("estorno")
        || desc.to_lowercase().contains("crédito")
        || desc.to_lowercase().contains("credito");

    Some(ParsedTransaction {
        posted_at,
        description: desc.clone(),
        merchant_clean: clean_merchant(&desc),
        amount_cents: amount_cents.abs(),
        currency: "BRL".into(),
        fx_rate: None,
        installment,
        is_refund,
        is_virtual_card: false,
        category_id: None,
        raw: caps.get(0)?.as_str().to_string(),
    })
}

pub fn parse_brl_to_cents(raw: &str) -> Option<i64> {
    let cleaned: String = raw
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == ',' || *c == '.' || *c == '-')
        .collect();
    let negative = cleaned.starts_with('-');
    let body = cleaned.trim_start_matches('-').replace('.', "").replace(',', ".");
    let n: f64 = body.parse().ok()?;
    // Reject NaN, Inf, and absurd magnitudes to avoid undefined behavior on the
    // f64 -> i64 cast and to keep a malicious PDF from poisoning the DB with a
    // junk amount that survived the regex.
    if !n.is_finite() || n.abs() > 1e14 {
        return None;
    }
    let cents = (n * 100.0).round() as i64;
    Some(if negative { -cents } else { cents })
}

const MONTH_PT: &[(&str, u32)] = &[
    ("jan", 1), ("fev", 2), ("mar", 3), ("abr", 4), ("mai", 5), ("jun", 6),
    ("jul", 7), ("ago", 8), ("set", 9), ("out", 10), ("nov", 11), ("dez", 12),
];

/// Try to find an explicit year in the raw PDF text. Statements typically have
/// a vencimento line ("Vencimento 25/08/2024") or a period header ("07/2024")
/// — pick whichever year appears most often. Returns None if nothing in the
/// 2000–2099 range is found, so callers can fall back to the system clock.
pub fn extract_year_hint(text: &str) -> Option<u32> {
    let mut counts: HashMap<u32, usize> = HashMap::new();
    for re in [&*FULL_DATE_RE, &*MONTH_YEAR_RE] {
        for caps in re.captures_iter(text) {
            if let Some(y) = caps.get(1).and_then(|m| m.as_str().parse::<u32>().ok()) {
                if (2000..=2099).contains(&y) {
                    *counts.entry(y).or_insert(0) += 1;
                }
            }
        }
    }
    counts.into_iter().max_by_key(|(_, c)| *c).map(|(y, _)| y)
}

pub fn normalize_date(
    raw: &str,
    fallback_year: u32,
    statement_year_month: Option<&str>,
) -> Option<String> {
    let t = raw.trim().to_lowercase();

    // Numeric formats: DD/MM, DD/MM/YY, DD/MM/YYYY
    if let Some(date) = parse_numeric_date(&t, fallback_year, statement_year_month) {
        return Some(date);
    }
    // PT-BR month abbrev: "12 MAR", "12-MAR", "12/MAR"
    let parts: Vec<&str> = t.split(|c: char| c == ' ' || c == '/' || c == '-').collect();
    if parts.len() >= 2 {
        let day: u32 = parts[0].parse().ok()?;
        let month_str = parts[1].trim_start_matches(|c: char| !c.is_alphabetic());
        let mon = MONTH_PT.iter().find(|(p, _)| month_str.starts_with(p))?.1;
        let year = if parts.len() >= 3 {
            let y: u32 = parts[2].parse().ok()?;
            if y < 100 { 2000 + y } else { y }
        } else {
            // Without an explicit year, route through the statement-period
            // resolver so that DD-MM rows in a Jan statement (closing pivot)
            // can land on Dec of the previous year when MM is December.
            resolve_year_for_row(mon, statement_year_month, fallback_year)
        };
        // Reject impossible day/month combinations (Feb 30, Apr 31, etc.).
        NaiveDate::from_ymd_opt(year as i32, mon, day)?;
        return Some(format!("{:04}-{:02}-{:02}", year, mon, day));
    }
    None
}

fn parse_numeric_date(
    t: &str,
    fallback_year: u32,
    statement_year_month: Option<&str>,
) -> Option<String> {
    let parts: Vec<&str> = t.split('/').collect();
    if parts.len() < 2 {
        return None;
    }
    let day: u32 = parts[0].parse().ok()?;
    let mon: u32 = parts[1].parse().ok()?;
    let year: u32 = if parts.len() >= 3 {
        let y: u32 = parts[2].parse().ok()?;
        if y < 100 { 2000 + y } else { y }
    } else {
        // Without an explicit year, route through the statement-period
        // resolver so that DD-MM rows in a Jan statement (closing pivot)
        // can land on Dec of the previous year when MM is December.
        resolve_year_for_row(mon, statement_year_month, fallback_year)
    };
    // Reject impossible day/month combinations (Feb 30, Apr 31, etc.).
    NaiveDate::from_ymd_opt(year as i32, mon, day)?;
    Some(format!("{:04}-{:02}-{:02}", year, mon, day))
}

trait YearOnly {
    fn year_naive(&self) -> u32;
}
impl<Tz: chrono::TimeZone> YearOnly for chrono::DateTime<Tz> {
    fn year_naive(&self) -> u32 {
        use chrono::Datelike;
        self.year() as u32
    }
}

fn clean_merchant(desc: &str) -> Option<String> {
    let cleaned = desc
        .split(" - Parcela")
        .next()
        .unwrap_or(desc)
        .replace("PAG*", "")
        .replace("PIX ", "")
        .trim()
        .to_string();
    if cleaned.is_empty() || cleaned == desc {
        None
    } else {
        Some(cleaned)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_year_hint_full_date() {
        let text = "Vencimento: 25/08/2024\nDespesas Cartão - 1234 R$ 666,99";
        assert_eq!(extract_year_hint(text), Some(2024));
    }

    #[test]
    fn extract_year_hint_picks_most_frequent() {
        let text = "Header 01/01/2023\n12/07/2024\n13/07/2024\n14/07/2024";
        assert_eq!(extract_year_hint(text), Some(2024));
    }

    #[test]
    fn extract_year_hint_returns_none_if_absent() {
        let text = "Nothing about years here, just 12/07 and 13/07 dates";
        assert_eq!(extract_year_hint(text), None);
    }

    #[test]
    fn extract_year_hint_picks_up_month_year_marker() {
        let text = "Período: 07/2024\nValor mínimo: 100,00";
        assert_eq!(extract_year_hint(text), Some(2024));
    }

    #[test]
    fn normalize_date_uses_default_year_for_dd_mm() {
        // "12/07" alone — must use the supplied default year, not chrono::now().
        assert_eq!(normalize_date("12/07", 2024, None), Some("2024-07-12".into()));
        assert_eq!(normalize_date("12/07", 2026, None), Some("2026-07-12".into()));
    }

    #[test]
    fn normalize_date_explicit_year_wins() {
        // Explicit year in the input takes precedence over the default.
        assert_eq!(normalize_date("12/07/2023", 2026, None), Some("2023-07-12".into()));
    }

    #[test]
    fn normalize_date_rejects_invalid_combinations() {
        assert_eq!(normalize_date("30/02", 2024, None), None); // Feb 30
        assert_eq!(normalize_date("31/04", 2024, None), None); // Apr 31
    }

    #[test]
    fn normalize_date_resolves_year_via_statement_period() {
        // Statement Aug 2024 (closing 16): row "17/07" should land on July
        // 2024 (the day after July's closing); "14/08" stays in August 2024.
        assert_eq!(
            normalize_date("17/07", 2024, Some("2024-08")),
            Some("2024-07-17".into()),
        );
        assert_eq!(
            normalize_date("14/08", 2024, Some("2024-08")),
            Some("2024-08-14".into()),
        );
    }

    #[test]
    fn normalize_date_handles_dec_jan_rollover() {
        // Statement Jan 2025: row "17/12" must roll back to 2024-12-17.
        assert_eq!(
            normalize_date("17/12", 2025, Some("2025-01")),
            Some("2024-12-17".into()),
        );
        assert_eq!(
            normalize_date("14/01", 2025, Some("2025-01")),
            Some("2025-01-14".into()),
        );
    }
}
