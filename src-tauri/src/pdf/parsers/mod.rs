use serde::{Deserialize, Serialize};

use crate::error::AppResult;
use crate::pdf::detect::Issuer;

/// Card-level metadata that some issuers print in the statement header
/// (Sofisa Direto, for instance, includes the closing date and due date
/// at the top of every fatura). Used to suggest auto-filling the card's
/// closing_day / due_day on first import.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardMetadata {
    /// Day of month the statement closes (1..=31).
    pub closing_day: i64,
    /// Day of month the statement is due (1..=31).
    pub due_day: i64,
    /// "YYYY-MM" of the statement (the closing month).
    pub statement_year_month: String,
}

pub mod generic;
pub mod mercadopago;
pub mod nubank;
pub mod sofisa;

/// A transaction parsed from raw PDF/text but not yet committed to the DB.
/// The user reviews these in the import preview and can edit before committing.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedTransaction {
    /// ISO date of the posting (YYYY-MM-DD). Best-effort guessed from DD/MM.
    pub posted_at: String,
    /// Raw description as printed on the invoice.
    pub description: String,
    /// Suggested clean merchant name (light heuristics applied).
    pub merchant_clean: Option<String>,
    /// Amount in cents (positive). Refunds are signaled via `is_refund`.
    pub amount_cents: i64,
    pub currency: String,
    pub fx_rate: Option<f64>,
    /// `(index, total)` if this line is part of a parcelamento.
    pub installment: Option<(i64, i64)>,
    pub is_refund: bool,
    /// True when the parser detected this line in a "virtual card" section
    /// (e.g. Sofisa's `Despesas Cartão Virtual`). Lets the UI distinguish
    /// physical-card spending from virtual-card spending on the same statement.
    /// Parsers without that concept always set this to `false`.
    #[serde(default)]
    pub is_virtual_card: bool,
    /// Suggested category (filled by auto-categorization rules, never by parsers).
    #[serde(default)]
    pub category_id: Option<String>,
    /// Raw line text, useful for debugging the parser.
    pub raw: String,
}

pub fn parse(
    text: &str,
    issuer: Issuer,
    statement_year_month: Option<&str>,
    closing_day: Option<u32>,
) -> AppResult<Vec<ParsedTransaction>> {
    match issuer {
        Issuer::Sofisa => sofisa::parse(text, statement_year_month, closing_day),
        Issuer::MercadoPago => mercadopago::parse(text, statement_year_month, closing_day),
        Issuer::Nubank => nubank::parse(text, statement_year_month, closing_day),
        Issuer::Generic => generic::parse(text, statement_year_month, closing_day),
    }
}

/// Decide which calendar year a "DD/MM" row belongs to, given the statement's
/// closing month-year and the card's closing day.
///
/// Logic: a statement closing on `closing_day` of month M contains rows dated
/// (M-1, closing_day+1) through (M, closing_day). So:
///   - If MM == statement_month: year = statement_year, regardless of DD.
///   - If MM == previous_month(statement_month): year = statement_year (or
///     statement_year - 1 if the statement is in January).
///   - Else: best effort — use the supplied year fallback.
pub fn resolve_year_for_row(
    row_month: u32,
    statement_year_month: Option<&str>,
    fallback_year: u32,
) -> u32 {
    let Some(period) = statement_year_month else {
        return fallback_year;
    };
    let stmt_year: u32 = period.get(..4).and_then(|s| s.parse().ok()).unwrap_or(fallback_year);
    let stmt_month: u32 = period.get(5..7).and_then(|s| s.parse().ok()).unwrap_or(1);
    if row_month == stmt_month {
        return stmt_year;
    }
    let prev_month = if stmt_month == 1 { 12 } else { stmt_month - 1 };
    if row_month == prev_month {
        return if stmt_month == 1 { stmt_year - 1 } else { stmt_year };
    }
    stmt_year
}
