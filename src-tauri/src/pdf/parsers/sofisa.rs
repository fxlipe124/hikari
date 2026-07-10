use once_cell::sync::Lazy;
use regex::Regex;

use crate::error::AppResult;
use crate::pdf::parsers::{generic, CardMetadata, ParsedTransaction};

/// Sofisa Direto invoice layout — priority parser.
///
/// Sofisa ships at least two visibly different PDF templates. `parse`
/// detects which one it's looking at and dispatches to `parse_classic`
/// (Mastercard-style, documented below) or `parse_visa` (Visa-style, see
/// its own doc comment further down).
pub fn parse(
    text: &str,
    statement_year_month: Option<&str>,
    closing_day: Option<u32>,
) -> AppResult<Vec<ParsedTransaction>> {
    if is_visa_layout(text) {
        return parse_visa(text);
    }
    parse_classic(text, statement_year_month, closing_day)
}

/// Observed structure of a real fatura (Mastercard-style template):
///
/// ```text
/// Detalhamento da Fatura
///
/// Pagamentos e Créditos
/// Data Transações Moeda Original Valor (R$)
/// 23/06 PAG. EFETUADO REF. FAT. ANT. -1.234,56
/// 05/07 ESTORNO COMPRA AMAZON -89,90
///
/// Despesas Cartão - 1233  R$ 666,99
/// Data Transações Moeda Original Valor (R$)
/// 12/07 PADARIA 45,80
/// ...
///
/// Despesas Cartão Virtual - 1234  R$ 77,55
/// Data Transações Moeda Original Valor (R$)
/// 04/07 MERCADO01/10 25,33
/// ...
///
/// Total desta fatura  R$ 4.567,89
/// Pagamento mínimo  R$ 456,79
/// ```
///
/// Quirks the parser must handle:
/// - **Inline parcela without space**: `MERCADO01/10` means description
///   "MERCADO", parcela 1 of 10. Must peel `\d{2}/\d{2}` off the end.
/// - **Refund section**: `Pagamentos e Créditos` lists payments/estornos.
///   Lines there have negative amounts and must be flagged as `is_refund`
///   regardless of keyword.
/// - **Virtual card section**: `Despesas Cartão Virtual` is a separate
///   section from `Despesas Cartão`. Lines under it must be flagged
///   `is_virtual_card=true` so the UI can show a badge / let the user
///   filter virtual purchases.
/// - **Continuation pages**: `Detalhamento da Fatura (continuação)` and
///   `Página X de Y` headers appear when the invoice spans multiple pages.
///   Must be skipped without resetting section context.
/// - **Empty section**: when a card had no transactions, Sofisa prints
///   `Não houve movimentação no período` instead of a tx list.
static REFUND_HEADER: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)Pagamentos\s+e\s+Cr(?:é|e)ditos").unwrap()
});

/// Matches *only* "Despesas Cartão Virtual - <last4>". Must be checked BEFORE
/// the generic expense header so the substring "Despesas Cartão" doesn't win.
static EXPENSE_VIRTUAL_HEADER: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)Despesas\s+Cart(?:ã|a)o\s+Virtual\s*-\s*(\d{3,5})").unwrap()
});

/// Matches "Despesas Cartão - <last4>" and "Despesas Cartão Adicional - <last4>".
/// (Virtual-section regex already ran by the time this is checked.)
static EXPENSE_HEADER: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)Despesas\s+Cart(?:ã|a)o(?:\s+Adicional)?\s*-\s*(\d{3,5})").unwrap()
});

static COLUMN_HEADER: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^\s*Data\s+Transa(?:ç|c)(?:õ|o)es").unwrap()
});

/// `DD/MM` (year missing) or `DD/MM/YYYY`, then description, then BR-formatted amount.
/// `\s+` tolerates multiple spaces / tabs / NBSP that `pdf-extract` injects.
static TX_LINE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"^(?P<date>\d{2}/\d{2}(?:/\d{2,4})?)\s+(?P<rest>.+?)\s+(?P<amount>-?\d{1,3}(?:\.\d{3})*,\d{2})\s*$",
    )
    .unwrap()
});

/// Trailing inline parcela, e.g. `MERCADO01/10`. No leading space required.
static INLINE_PARCELA: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^(?P<desc>.+?)(?P<idx>\d{2})/(?P<total>\d{2})$").unwrap()
});

/// Statement closing date — e.g. "as compras e pagamentos feitos até
/// 16/08/2024". The day = closing_day; the month/year = statement period.
static CLOSING_HEADER: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)compras\s+e\s+pagamentos\s+feitos\s+at[ée]\s+(\d{2})/(\d{2})/(\d{4})",
    )
    .unwrap()
});

/// Statement due date — e.g. "Vencimento 25/08/2024". The day = due_day.
static DUE_HEADER: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)Vencimento\s+(\d{2})/(\d{2})/(\d{4})").unwrap()
});

#[derive(Clone, Copy, PartialEq, Eq)]
enum Section {
    None,
    /// Regular expense section — `is_refund` decided per-line, `is_virtual_card=false`.
    Expense,
    /// Virtual card expense section — same parsing as Expense but rows get
    /// `is_virtual_card=true`.
    ExpenseVirtual,
    /// Pagamentos e Créditos — every line is a refund/payment.
    Refund,
}

fn parse_classic(
    text: &str,
    statement_year_month: Option<&str>,
    _closing_day: Option<u32>,
) -> AppResult<Vec<ParsedTransaction>> {
    // Sofisa statements typically don't print the year on transaction rows
    // (only "DD/MM"). The statement_year_month + closing_day pivot is the
    // most reliable source — fallback chain: explicit period > year hint
    // scanned from the text > system clock.
    let fallback_year = statement_year_month
        .and_then(|p| p.get(..4).and_then(|s| s.parse::<u32>().ok()))
        .or_else(|| generic::extract_year_hint(text))
        .unwrap_or_else(year_now);

    let mut out: Vec<ParsedTransaction> = Vec::new();
    let mut section = Section::None;
    // Remember the most recent expense/refund section in case a per-page
    // subtotal or running-total footer closes the section mid-statement.
    // When the next page's "(continuação)" marker appears, we restore it
    // so that transactions resuming without a fresh header still parse.
    let mut last_active_section = Section::None;
    // Last4 of the card whose section we're currently in — the expense
    // headers ("Despesas Cartão - 1234") carry it, so rows can be routed
    // to the matching registered card (e.g. an "Adicional" card with a
    // different number listed on the same fatura).
    let mut current_last4: Option<String> = None;

    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }

        // Section transitions. Order matters: REFUND first, then VIRTUAL
        // (substring of the generic expense header), then the generic header.
        if REFUND_HEADER.is_match(line) {
            section = Section::Refund;
            last_active_section = section;
            continue;
        }
        if let Some(c) = EXPENSE_VIRTUAL_HEADER.captures(line) {
            section = Section::ExpenseVirtual;
            last_active_section = section;
            current_last4 = c.get(1).map(|m| m.as_str().to_string());
            continue;
        }
        if let Some(c) = EXPENSE_HEADER.captures(line) {
            section = Section::Expense;
            last_active_section = section;
            current_last4 = c.get(1).map(|m| m.as_str().to_string());
            continue;
        }
        if COLUMN_HEADER.is_match(line) {
            continue;
        }

        // True end-of-statement markers. We deliberately do NOT close on
        // "Subtotal" or "Resumo da fatura" because Sofisa prints those
        // mid-document (per-section recap, page running total, etc.) and
        // closing would drop every transaction on the next page when the
        // section header isn't repeated.
        let lower = line.to_lowercase();
        if lower.contains("total desta fatura")
            || lower.contains("total da fatura")
            || lower.contains("valor m\u{ED}nimo")
            || lower.contains("valor minimo")
            || lower.contains("pagamento m\u{ED}nimo")
            || lower.contains("pagamento minimo")
        {
            section = Section::None;
            // Intentionally don't update last_active_section here — these
            // markers really are end-of-doc, not page boundaries.
            continue;
        }

        // Pagination + continuation noise — skip without changing section.
        // When "(continuação)" arrives and the section was closed by an
        // earlier footer line on the previous page, restore it so the
        // following rows aren't dropped just because a header wasn't
        // repeated on the new page.
        if lower.contains("(continua\u{E7}\u{E3}o)") || lower.contains("(continuacao)") {
            if section == Section::None && last_active_section != Section::None {
                section = last_active_section;
            }
            continue;
        }
        if lower.starts_with("p\u{E1}gina ")
            || lower.starts_with("pagina ")
            || lower.contains("n\u{E3}o houve movimenta")
            || lower.contains("nao houve movimenta")
        {
            continue;
        }

        if section == Section::None {
            continue;
        }

        // The "Pagamentos e Créditos" section is exclusively payments
        // (PAG. EFETUADO) and estornos — money flow with the bank, not
        // purchases the user made. Skip it wholesale instead of relying
        // on the negative-amount check below, since some statements
        // print credits as positive values (cashback, reward credits).
        if section == Section::Refund {
            continue;
        }

        let caps = match TX_LINE.captures(line) {
            Some(c) => c,
            None => continue,
        };
        let date_raw = &caps["date"];
        let rest = caps["rest"].trim();
        let amount_raw = &caps["amount"];

        let posted_at = match generic::normalize_date(date_raw, fallback_year, statement_year_month) {
            Some(d) => d,
            None => continue,
        };
        let amount_cents = match generic::parse_brl_to_cents(amount_raw) {
            Some(v) => v,
            None => continue,
        };

        // Defense in depth: even within an expense section, a leading
        // "-" on the amount column means an estorno that the bank
        // already deducted. Skip per user rule: "se tem um símbolo de
        // - do lado do preço não devemos incluir na fatura".
        if amount_cents < 0 {
            continue;
        }

        // Refunds get no parcela parsing — payments aren't installments and
        // their descriptions ("PAG. EFETUADO REF. FAT. ANT.") sometimes end
        // in date-shaped digits that would false-match.
        let (desc, installment) = if section == Section::Refund {
            (rest.to_string(), None)
        } else {
            peel_inline_parcela(rest)
        };

        let lower_desc = desc.to_lowercase();
        let is_refund = section == Section::Refund
            || amount_cents < 0
            || lower_desc.contains("estorno")
            || lower_desc.contains("cr\u{E9}dito")
            || lower_desc.contains("credito")
            || lower_desc.contains("pag. efetuado")
            || lower_desc.contains("pagamento on line")
            || lower_desc.contains("pagamento on-line");

        out.push(ParsedTransaction {
            posted_at,
            description: desc.clone(),
            merchant_clean: clean_merchant(&desc),
            amount_cents: amount_cents.abs(),
            currency: "BRL".into(),
            fx_rate: None,
            installment,
            is_refund,
            is_virtual_card: section == Section::ExpenseVirtual,
            last4: current_last4.clone(),
            category_id: None,
            raw: line.to_string(),
        });
    }
    Ok(out)
}

fn year_now() -> u32 {
    use chrono::Datelike;
    chrono::Utc::now().year() as u32
}

/// Pull the card-level metadata Sofisa prints near the top of every fatura.
/// Both regexes are loose enough to survive `pdf-extract` whitespace noise
/// (multiple spaces, NBSPs, line wraps inside the regex's `\s+` window).
/// Returns None if either header is missing — partial metadata is more
/// confusing than useful (a banner that says "closing day 16, due day —"
/// makes the user wonder if the parser is broken).
pub fn extract_card_metadata(text: &str) -> Option<CardMetadata> {
    let closing = CLOSING_HEADER.captures(text)?;
    let due = DUE_HEADER.captures(text)?;
    let closing_day: i64 = closing.get(1)?.as_str().parse().ok()?;
    let closing_month: u32 = closing.get(2)?.as_str().parse().ok()?;
    let closing_year: u32 = closing.get(3)?.as_str().parse().ok()?;
    let due_day: i64 = due.get(1)?.as_str().parse().ok()?;
    if !(1..=31).contains(&closing_day) || !(1..=31).contains(&due_day) {
        return None;
    }
    if !(1..=12).contains(&closing_month) {
        return None;
    }
    Some(CardMetadata {
        closing_day,
        due_day,
        statement_year_month: format!("{:04}-{:02}", closing_year, closing_month),
    })
}

fn peel_inline_parcela(rest: &str) -> (String, Option<(i64, i64)>) {
    let trimmed = rest.trim();
    if let Some(c) = INLINE_PARCELA.captures(trimmed) {
        let idx: i64 = c["idx"].parse().unwrap_or(0);
        let total: i64 = c["total"].parse().unwrap_or(0);
        // Sanity: parcela total must be 1..=99 and idx must be 1..=total.
        // Reject otherwise so dates/codes inside descriptions don't false-match.
        if (1..=99).contains(&total) && (1..=total).contains(&idx) {
            let desc = c["desc"].trim().to_string();
            if !desc.is_empty() {
                return (desc, Some((idx, total)));
            }
        }
    }
    (trimmed.to_string(), None)
}

fn clean_merchant(desc: &str) -> Option<String> {
    let s = desc.trim();
    if s.is_empty() {
        return None;
    }
    Some(s.to_string())
}

// ---------------------------------------------------------------------------
// Visa-card template
// ---------------------------------------------------------------------------
//
// Sofisa's Visa statement is a different animal from the classic Mastercard
// one. `pdf-extract` reads it column-by-column, so a printed table row is
// scattered across the text stream as three separate runs: first every date
// in the band, then every description, then every Real amount. Example of
// one band as it arrives:
//
// ```text
// 05/01/26
// 05/01/26
// Compra a Vista IFD*LPX COMERCIO DE AL
// Compra a Vista SHEIN  *JIANGHUA CHEN
// 98,49
// 166,89
// ```
//
// which is really two rows: (05/01/26, LPX…, 98,49) and (05/01/26, SHEIN…,
// 166,89). We reassemble by collecting the runs and zipping them by index.
// Distinct fingerprints vs the classic layout: the masked card number
// (`4563**.******.0656`) and the "Compra a Vista" transaction-type prefix,
// neither of which the Mastercard template ever prints.

/// Masked card number, e.g. `4563**.******.0656` — BIN, masked middle, and a
/// captured last4 group.
static VISA_CARD_NUMBER: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\d{4}\*\*\.\*{6}\.(\d{4})").unwrap());

/// A lone Real amount cell: "98,49", " 8,26", "1.872,68", "- 8,27".
static VISA_AMOUNT: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^-?\s*\d{1,3}(?:\.\d{3})*,\d{2}$").unwrap());

/// A lone date cell: DD/MM/YY or DD/MM/YYYY.
static VISA_DATE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^\d{2}/\d{2}/\d{2,4}$").unwrap());

/// Trailing installment marker: "Parc.2/3", "Parc. 2/3", "Parcela 2 de 3".
static VISA_PARCELA: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)parc(?:ela)?\.?\s*(\d{1,2})\s*(?:/|de)\s*(\d{1,2})\s*$").unwrap());

/// Header/summary lines that must never be mistaken for a description.
/// Matched case-insensitively as a trimmed prefix, so "Valor em Real- 8,27"
/// (a header pdf-extract glued to a payment amount) is skipped wholesale —
/// which is fine, that row is a payment we'd exclude anyway.
const VISA_NOISE_PREFIXES: &[&str] = &[
    "data",
    "descricao",
    "descrição",
    "valor original",
    "valor equivalente",
    "em dólar",
    "em dolar",
    "taxa da conversão",
    "taxa da conversao",
    "(na data do gasto)",
    "valor em real",
    "fechamento da próxima fatura",
    "fechamento da proxima fatura",
    "valor total da fatura",
    "saldo total consolidado",
    "compras parceladas com e sem juros",
    "total a pagar",
    "demais encargos",
    "limite",
    "vencimento",
    "r$",
];

/// True when the text looks like the Sofisa Visa template rather than the
/// classic Mastercard one.
pub fn is_visa_layout(text: &str) -> bool {
    VISA_CARD_NUMBER.is_match(text) && text.to_lowercase().contains("valor em real")
}

#[derive(Clone, Copy, PartialEq)]
enum VisaKind {
    Date,
    Amount,
    Desc,
    Skip,
}

fn classify_visa(line: &str) -> VisaKind {
    let t = line.trim();
    if t.is_empty() {
        return VisaKind::Skip;
    }
    if VISA_DATE.is_match(t) {
        return VisaKind::Date;
    }
    if VISA_AMOUNT.is_match(t) {
        return VisaKind::Amount;
    }
    let lower = t.to_lowercase();
    if VISA_NOISE_PREFIXES.iter().any(|p| lower.starts_with(p)) {
        return VisaKind::Skip;
    }
    VisaKind::Desc
}

#[derive(Default)]
struct VisaBand {
    dates: Vec<String>,
    descs: Vec<String>,
    amounts: Vec<String>,
}

fn parse_visa(text: &str) -> AppResult<Vec<ParsedTransaction>> {
    let lines: Vec<&str> = text.lines().collect();
    let mut out: Vec<ParsedTransaction> = Vec::new();
    let mut band = VisaBand::default();
    // Which run we're filling: 0 = dates, 1 = descs, 2 = amounts. A band is
    // always dates+ descs+ amounts+ in that order, so a Date after we've
    // started descs/amounts marks the next band.
    let mut phase = 0u8;
    // Last4 of the card block we're inside, stamped on every row so the
    // import flow can route each to its matching registered card.
    let mut current_last4: Option<String> = None;

    for (i, raw) in lines.iter().enumerate() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }

        // Card boundary: the masked card number is a delimiter, and the
        // cardholder-name line printed right before it is too. Flush the
        // in-flight band so rows never straddle two cards, then switch to
        // the new card's last4.
        if let Some(c) = VISA_CARD_NUMBER.captures(line) {
            emit_visa_band(&band, current_last4.as_deref(), &mut out);
            band = VisaBand::default();
            current_last4 = c.get(1).map(|m| m.as_str().to_string());
            phase = 0;
            continue;
        }
        if i + 1 < lines.len() && VISA_CARD_NUMBER.is_match(lines[i + 1].trim()) {
            continue; // cardholder name line
        }

        match classify_visa(line) {
            VisaKind::Skip => continue,
            VisaKind::Date => {
                if phase != 0 {
                    emit_visa_band(&band, &mut out);
                    band = VisaBand::default();
                    phase = 0;
                }
                band.dates.push(line.to_string());
            }
            VisaKind::Desc => {
                // A description after an amount run also starts a new band
                // (defensive — the real layout separates bands with dates).
                if phase == 2 {
                    emit_visa_band(&band, &mut out);
                    band = VisaBand::default();
                    phase = 0;
                }
                phase = 1;
                band.descs.push(line.to_string());
            }
            VisaKind::Amount => {
                phase = 2;
                band.amounts.push(line.to_string());
            }
        }
    }
    emit_visa_band(&band, current_last4.as_deref(), &mut out);
    Ok(out)
}

/// Zip a band's parallel runs into transactions. Extra amounts beyond the
/// description count (e.g. the invoice total that lands in the last band's
/// amount run) are ignored because we only take `min(len)` rows.
fn emit_visa_band(band: &VisaBand, last4: Option<&str>, out: &mut Vec<ParsedTransaction>) {
    let n = band.dates.len().min(band.descs.len()).min(band.amounts.len());
    for i in 0..n {
        let date_raw = &band.dates[i];
        let desc_raw = &band.descs[i];
        let amount_raw = &band.amounts[i];

        let posted_at = match generic::normalize_date(date_raw, year_now(), None) {
            Some(d) => d,
            None => continue,
        };
        let amount_cents = match generic::parse_brl_to_cents(amount_raw) {
            Some(v) => v,
            None => continue,
        };
        // Negative = a payment/estorno the bank already deducted. Skip, same
        // rule as the classic parser's "Pagamentos e Créditos" handling.
        if amount_cents < 0 {
            continue;
        }

        let (desc, installment) = peel_visa_desc(desc_raw);
        let lower = desc.to_lowercase();
        // Payments and credits that print as positive values (bill payment
        // via Pix, cashback) are money flow with the bank, not purchases.
        if lower.contains("baixa pagamento")
            || lower.contains("pagamento fatura")
            || lower.contains("pagamento via pix")
            || lower.contains("estorno")
            || lower.contains("cr\u{E9}dito")
            || lower.contains("credito")
        {
            continue;
        }

        out.push(ParsedTransaction {
            posted_at,
            description: desc.clone(),
            merchant_clean: clean_merchant(&desc),
            amount_cents: amount_cents.abs(),
            currency: "BRL".into(),
            fx_rate: None,
            installment,
            is_refund: false,
            is_virtual_card: false,
            last4: last4.map(|s| s.to_string()),
            category_id: None,
            raw: format!("{date_raw}  {desc_raw}  {amount_raw}"),
        });
    }
}

/// Strip the "Compra a Vista"/"Compra Parcelada" transaction-type prefix and
/// peel a trailing "Parc.N/M" installment marker off a Visa description.
fn peel_visa_desc(raw: &str) -> (String, Option<(i64, i64)>) {
    let mut s = raw.trim();
    for prefix in ["Compra a Vista", "Compra à Vista", "Compra Parcelada"] {
        if let Some(rest) = s.strip_prefix(prefix) {
            s = rest.trim_start();
            break;
        }
    }

    let mut installment = None;
    let mut desc = s.to_string();
    if let Some(c) = VISA_PARCELA.captures(s) {
        let idx: i64 = c[1].parse().unwrap_or(0);
        let total: i64 = c[2].parse().unwrap_or(0);
        if (1..=99).contains(&total) && (1..=total).contains(&idx) {
            let m = c.get(0).unwrap();
            desc = s[..m.start()].trim().to_string();
            installment = Some((idx, total));
        }
    }

    // Collapse the double spaces pdf-extract sprinkles between tokens
    // ("SHEIN  *JIANGHUA" -> "SHEIN *JIANGHUA").
    let desc = desc.split_whitespace().collect::<Vec<_>>().join(" ");
    (desc, installment)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_card_metadata_from_real_header() {
        let text = "as compras e pagamentos feitos até 16/08/2024 com o seu cartão SOFISA\n\
                    Vencimento 25/08/2024\n\
                    Melhor dia para compra 17/08/2024\n";
        let m = extract_card_metadata(text).expect("metadata extracted");
        assert_eq!(m.closing_day, 16);
        assert_eq!(m.due_day, 25);
        assert_eq!(m.statement_year_month, "2024-08");
    }

    #[test]
    fn extract_card_metadata_returns_none_on_partial_header() {
        // Only Vencimento, no closing line — banner would be misleading.
        let text = "Vencimento 25/08/2024\n";
        assert!(extract_card_metadata(text).is_none());
    }

    #[test]
    fn extract_card_metadata_rejects_invalid_days() {
        let text = "as compras e pagamentos feitos até 99/08/2024\nVencimento 25/08/2024\n";
        assert!(extract_card_metadata(text).is_none());
    }

    const SAMPLE_BASE: &str = r#"Detalhamento da Fatura
Despesas Cartão - 1234 R$ 666,99
Data Transações Moeda Original Valor (R$)
12/07 PADARIA 45,80
13/07 PADARIA 45,80
14/07 PADARIA 45,80
15/07 PADARIA 45,80
Despesas Cartão Virtual - 1234 R$ 77,55
Data Transações Moeda Original Valor (R$)
04/07 MERCADO01/10 25,33
05/07 MERCADO 25,33
06/07 MERCADO 25,33
"#;

    #[test]
    fn parses_sofisa_sample() {
        let txs = parse(SAMPLE_BASE, None, None).unwrap();
        assert_eq!(txs.len(), 7, "expected 7 transactions");

        // First section: 4× PADARIA, no parcela, physical card.
        for t in &txs[0..4] {
            assert_eq!(t.description, "PADARIA");
            assert_eq!(t.amount_cents, 4580);
            assert!(t.installment.is_none());
            assert!(!t.is_refund);
            assert!(!t.is_virtual_card);
        }

        // Virtual section: parceled MERCADO + 2× single — all flagged virtual.
        assert_eq!(txs[4].description, "MERCADO");
        assert_eq!(txs[4].amount_cents, 2533);
        assert_eq!(txs[4].installment, Some((1, 10)));
        assert!(txs[4].is_virtual_card);

        for t in &txs[5..7] {
            assert_eq!(t.description, "MERCADO");
            assert_eq!(t.amount_cents, 2533);
            assert!(t.installment.is_none());
            assert!(t.is_virtual_card);
        }
    }

    #[test]
    fn rejects_implausible_inline_parcela() {
        let (desc, p) = peel_inline_parcela("MARCO00/00");
        assert_eq!(desc, "MARCO00/00");
        assert!(p.is_none());

        let (desc, p) = peel_inline_parcela("STORE99/01");
        assert_eq!(desc, "STORE99/01");
        assert!(p.is_none(), "idx > total must be rejected");
    }

    #[test]
    fn accepts_valid_inline_parcela() {
        let (desc, p) = peel_inline_parcela("MERCADO01/10");
        assert_eq!(desc, "MERCADO");
        assert_eq!(p, Some((1, 10)));

        let (desc, p) = peel_inline_parcela("DELL BRASIL 03/12");
        assert_eq!(desc, "DELL BRASIL");
        assert_eq!(p, Some((3, 12)));
    }

    #[test]
    fn skips_negative_amount_rows() {
        // The "Pagamentos e Créditos" section lists payments/estornos
        // that the bank already deducted from the bill. Per user
        // preference these don't belong in the transactions list — the
        // negative-amount filter drops them so only purchases survive.
        let text = r#"Detalhamento da Fatura
Pagamentos e Créditos
Data Transações Moeda Original Valor (R$)
23/06 PAG. EFETUADO REF. FAT. ANT. -1.234,56
05/07 ESTORNO COMPRA AMAZON -89,90
Despesas Cartão - 1234 R$ 666,99
Data Transações Moeda Original Valor (R$)
12/07 PADARIA 45,80
"#;
        let txs = parse(text, None, None).unwrap();
        assert_eq!(txs.len(), 1, "negative-amount rows must be filtered out");
        assert_eq!(txs[0].description, "PADARIA");
        assert!(!txs[0].is_refund);
    }

    #[test]
    fn skips_pagination_and_continuation() {
        // Multi-page faturas repeat the column header and emit "Página X de Y"
        // and "(continuação)". None of these should produce transactions or
        // close the active section.
        let text = r#"Despesas Cartão - 1234 R$ 666,99
Data Transações Moeda Original Valor (R$)
12/07 PADARIA 45,80
Página 2 de 5
Detalhamento da Fatura (continuação)
Data Transações Moeda Original Valor (R$)
13/07 PADARIA 45,80
"#;
        let txs = parse(text, None, None).unwrap();
        assert_eq!(txs.len(), 2, "both PADARIA lines must parse across page break");
    }

    #[test]
    fn skips_empty_section_message() {
        let text = r#"Despesas Cartão Virtual - 1234 R$ 0,00
Data Transações Moeda Original Valor (R$)
Não houve movimentação no período
Despesas Cartão - 1234 R$ 45,80
Data Transações Moeda Original Valor (R$)
12/07 PADARIA 45,80
"#;
        let txs = parse(text, None, None).unwrap();
        assert_eq!(txs.len(), 1);
        assert_eq!(txs[0].description, "PADARIA");
        assert!(!txs[0].is_virtual_card);
    }

    #[test]
    fn subtotal_does_not_close_across_page_break() {
        // Real Sofisa multi-page exports often print a running per-page
        // subtotal at the bottom of each page and skip the section header
        // on the continuation page (just shows "(continuação)"). The
        // parser must keep the section live so the rows on page 2 still
        // get associated with the right card.
        let text = r#"Despesas Cartão - 1234 R$ 666,99
Data Transações Moeda Original Valor (R$)
12/07 PADARIA 45,80
13/07 PADARIA 45,80
Subtotal página 1 R$ 91,60
Página 2 de 5
Detalhamento da Fatura (continuação)
14/07 PADARIA 45,80
15/07 PADARIA 45,80
"#;
        let txs = parse(text, None, None).unwrap();
        assert_eq!(
            txs.len(),
            4,
            "all four PADARIA rows must parse — subtotal on a page break must not drop the next page",
        );
    }

    #[test]
    fn continuation_restores_section_after_total_footer() {
        // Defensive case: even when a page footer prints "Total desta
        // fatura R$ X" (running totals), the next page's "(continuação)"
        // restores the previous section so we don't lose every row.
        let text = r#"Despesas Cartão - 1234 R$ 666,99
Data Transações Moeda Original Valor (R$)
12/07 PADARIA 45,80
Total desta fatura R$ 45,80
Página 2 de 3
Detalhamento da Fatura (continuação)
13/07 PADARIA 45,80
"#;
        let txs = parse(text, None, None).unwrap();
        assert_eq!(
            txs.len(),
            2,
            "(continuação) must restore the previous section after a running total footer",
        );
    }

    #[test]
    fn footer_closes_section() {
        // After "Total desta fatura", any line that looks tx-shaped should
        // be ignored (e.g. summary lines that happen to start with a date).
        let text = r#"Despesas Cartão - 1234 R$ 45,80
Data Transações Moeda Original Valor (R$)
12/07 PADARIA 45,80
Total desta fatura R$ 45,80
13/07 ALGO 10,00
"#;
        let txs = parse(text, None, None).unwrap();
        assert_eq!(txs.len(), 1, "post-total lines must be ignored");
    }

    #[test]
    fn tolerates_extra_whitespace() {
        // pdf-extract sometimes emits multiple spaces between tokens.
        let text = "Despesas Cartão - 1234 R$ 100,00\n\
                    Data Transações Moeda Original Valor (R$)\n\
                    12/07     CAFETERIA DA ESQUINA      12,50\n";
        let txs = parse(text, None, None).unwrap();
        assert_eq!(txs.len(), 1);
        assert_eq!(txs[0].description, "CAFETERIA DA ESQUINA");
        assert_eq!(txs[0].amount_cents, 1250);
    }

    #[test]
    fn additional_card_section_recognized() {
        // Statements that include a dependent's additional card also use
        // "Despesas Cartão Adicional - <last4>".
        let text = r#"Despesas Cartão Adicional - 9876 R$ 50,00
Data Transações Moeda Original Valor (R$)
12/07 LIVRARIA 50,00
"#;
        let txs = parse(text, None, None).unwrap();
        assert_eq!(txs.len(), 1);
        assert_eq!(txs[0].description, "LIVRARIA");
        assert!(!txs[0].is_virtual_card);
    }

    #[test]
    fn keyword_refund_in_expense_section() {
        // "ESTORNO COMPRA X" can also appear inside the Despesas Cartão section.
        // Even with a positive amount, the keyword forces is_refund=true.
        let text = r#"Despesas Cartão - 1234 R$ 0,00
Data Transações Moeda Original Valor (R$)
12/07 ESTORNO COMPRA NETFLIX 25,99
13/07 PADARIA 45,80
"#;
        let txs = parse(text, None, None).unwrap();
        assert_eq!(txs.len(), 2);
        assert!(txs[0].is_refund);
        assert!(!txs[1].is_refund);
    }

    #[test]
    fn parse_with_explicit_year_override() {
        // No year anywhere in the text — explicit override is the only signal.
        let text = r#"Despesas Cartão - 1234 R$ 45,80
Data Transações Moeda Original Valor (R$)
12/07 PADARIA 45,80
"#;
        let txs = parse(text, Some("2022-01"), None).unwrap();
        assert_eq!(txs[0].posted_at, "2022-07-12");

        // Even when the text has a Vencimento line, the user override wins.
        let text2 = r#"Vencimento: 25/08/2024
Despesas Cartão - 1234 R$ 45,80
Data Transações Moeda Original Valor (R$)
12/07 PADARIA 45,80
"#;
        let txs2 = parse(text2, Some("2026-01"), None).unwrap();
        assert_eq!(
            txs2[0].posted_at, "2026-07-12",
            "explicit override must beat the auto-detected vencimento year"
        );
    }

    #[test]
    fn sample_with_virtual_section_and_year_hint() {
        // Real-world Sofisa sample: physical-card last4 differs from virtual,
        // and a "Vencimento DD/MM/YYYY" header pins down the year of the
        // bare DD/MM dates in the rows.
        let text = r#"Detalhamento da Fatura
Vencimento: 25/08/2024
Despesas Cartão - 1233 R$ 660,99
Data Transações Moeda Original Valor (R$)
12/07 PADARIA 45,80
12/07 supermercado 82,10
12/07 PAG*Bar 80,00
12/07 restaurante R 97,92
13/07 SUPERMERCADOS 179,07
13/07 frango 33,10
14/07 FORNO PIZZARIA 74,00
14/07 CERVEJARIA LTDA 12,00
14/07 CERVEJARIA LTDA 12,00
14/07 CERVEJA 45,00
Despesas Cartão Virtual - 1234 R$ 74,51
Data Transações Moeda Original Valor (R$)
04/07 MERCADOLIVRE*MERCA01/10 25,33
13/07 ABASTEC*abastece ai 49,18
"#;
        let txs = parse(text, None, None).unwrap();
        assert_eq!(txs.len(), 12);

        // First 10 rows came from the physical-card section.
        for t in &txs[0..10] {
            assert!(!t.is_virtual_card, "physical row leaked virtual flag");
            assert!(t.posted_at.starts_with("2024-07"), "year hint missed: {}", t.posted_at);
        }

        // Last 2 rows are virtual.
        assert!(txs[10].is_virtual_card);
        assert_eq!(txs[10].description, "MERCADOLIVRE*MERCA");
        assert_eq!(txs[10].installment, Some((1, 10)));
        assert!(txs[10].posted_at.starts_with("2024-07"));

        assert!(txs[11].is_virtual_card);
        assert_eq!(txs[11].description, "ABASTEC*abastece ai");
        assert!(txs[11].posted_at.starts_with("2024-07"));
    }

    // Real Sofisa Visa fatura excerpt (two cards, column-jumbled by
    // pdf-extract). The invoice total printed at the bottom is R$ 1.872,68.
    const VISA_SAMPLE: &str = "FELIPE DA SILVA SAURO\n\
4563**.******.0656\n\
Data\n\
05/12/25\n\
Descricao\n\
STEAM Parc.2/3\n\
Fechamento da pr\u{F3}xima fatura 20/02/2026\n\
Valor Original\n\
Valor Equivalente\n\
em D\u{F3}lar US$\n\
Taxa da Convers\u{E3}o R$\n\
(na data do gasto)\n\
Valor em Real\n\
 8,26\n\
05/01/26\n\
05/01/26\n\
Compra a Vista IFD*LPX COMERCIO DE AL\n\
Compra a Vista SHEIN  *JIANGHUA CHEN\n\
98,49\n\
166,89\n\
FELIPE DA SILVA SAURO\n\
4563**.******.1395\n\
Data\n\
25/12/25\n\
Descricao\n\
Baixa Pagamento Fatura Via Pix\n\
Valor Original\n\
Valor Equivalente\n\
em D\u{F3}lar US$\n\
Taxa da Convers\u{E3}o R$\n\
(na data do gasto)\n\
Valor em Real- 8,27\n\
11/01/26\n\
11/01/26\n\
Compra a Vista ABASTEC*ABASTECE AI\n\
Compra a Vista ELIANI LEVINSKI 000572080\n\
90,00\n\
 5,00\n\
11/01/26\n\
11/01/26\n\
Compra a Vista IFD*ELIANI LEVINSKI ORTIZ\n\
Compra a Vista IFOOD\n\
60,99\n\
 7,95\n\
12/01/26\n\
12/01/26\n\
Compra a Vista JIM.COM* 20816760 ANDERSS\n\
Compra a Vista AGA265\n\
400,00\n\
23,00\n\
14/01/26\n\
15/01/26\n\
Compra a Vista SUPERMERCADOS TISCHLER\n\
Compra a Vista SUPERMERCADOS TISCHLER\n\
93,75\n\
18,07\n\
16/01/26\n\
16/01/26\n\
Compra a Vista MINIKALZONE\n\
Compra a Vista JIM.COM* 20816760 ANDERSS\n\
39,90\n\
624,00\n\
16/01/26\n\
16/01/26\n\
Compra a Vista MANLI BIJUS\n\
Compra a Vista IFD*RAUL MENDES DA MOTTA\n\
20,00\n\
182,59\n\
17/01/26\n\
Compra a Vista SUPERMERCADOS\n\
VALOR TOTAL DA FATURA\n\
Saldo total consolidado de obriga\u{E7}\u{F5}es futuras\n\
Compras Parceladas COM e SEM Juros; Opera\u{E7}\u{F5}es de Cr\u{E9}dito e Tarifas\n\
33,79\n\
1.872,68\n\
Total a pagar (R$)\n\
R$ 1.872,68\n\
Demais encargos que poder\u{E3}o ser cobrados:\n";

    #[test]
    fn visa_layout_is_detected() {
        assert!(is_visa_layout(VISA_SAMPLE));
        // Classic Mastercard sample must NOT be mistaken for the Visa layout.
        assert!(!is_visa_layout(SAMPLE_BASE));
    }

    #[test]
    fn parses_visa_fatura() {
        let txs = parse(VISA_SAMPLE, None, None).unwrap();

        // 16 purchases: 3 on card 0656, 13 on card 1395. The Pix bill
        // payment and the invoice-total line are both excluded.
        assert_eq!(txs.len(), 16, "expected 16 purchases");

        // No payment/credit rows leaked in.
        assert!(
            !txs.iter().any(|t| t.description.to_lowercase().contains("pagamento")),
            "the Pix bill payment must be excluded",
        );

        // First row: STEAM installment 2/3, R$ 8,26, dated with the 2-digit
        // year, tagged with the first card's last4.
        assert_eq!(txs[0].description, "STEAM");
        assert_eq!(txs[0].amount_cents, 826);
        assert_eq!(txs[0].installment, Some((2, 3)));
        assert_eq!(txs[0].posted_at, "2025-12-05");
        assert_eq!(txs[0].last4.as_deref(), Some("0656"));
        assert!(!txs[0].is_refund);

        // The three cards-0656 rows carry 0656; everything after the second
        // card block carries 1395.
        assert_eq!(txs[2].last4.as_deref(), Some("0656"));
        assert_eq!(txs[3].last4.as_deref(), Some("1395"));
        assert!(
            txs[3..].iter().all(|t| t.last4.as_deref() == Some("1395")),
            "every row after the second card header must be tagged 1395",
        );

        // "Compra a Vista" prefix stripped; double spaces collapsed.
        assert_eq!(txs[1].description, "IFD*LPX COMERCIO DE AL");
        assert_eq!(txs[1].amount_cents, 9849);
        assert_eq!(txs[1].posted_at, "2026-01-05");
        assert_eq!(txs[2].description, "SHEIN *JIANGHUA CHEN");
        assert_eq!(txs[2].amount_cents, 16689);

        // First row of the second card.
        assert_eq!(txs[3].description, "ABASTEC*ABASTECE AI");
        assert_eq!(txs[3].amount_cents, 9000);
        assert_eq!(txs[3].posted_at, "2026-01-11");

        // Last row: SUPERMERCADOS R$ 33,79 — the 1.872,68 total right after it
        // in the amount column must not become a phantom transaction.
        let last = txs.last().unwrap();
        assert_eq!(last.description, "SUPERMERCADOS");
        assert_eq!(last.amount_cents, 3379);
        assert_eq!(last.posted_at, "2026-01-17");

        // The whole thing must reconcile to the printed invoice total.
        let sum: i64 = txs.iter().map(|t| t.amount_cents).sum();
        assert_eq!(sum, 187268, "sum of purchases must equal R$ 1.872,68");
    }

    #[test]
    fn peel_visa_desc_handles_prefix_and_parcela() {
        let (d, p) = peel_visa_desc("Compra a Vista SHEIN  *JIANGHUA CHEN");
        assert_eq!(d, "SHEIN *JIANGHUA CHEN");
        assert!(p.is_none());

        let (d, p) = peel_visa_desc("STEAM Parc.2/3");
        assert_eq!(d, "STEAM");
        assert_eq!(p, Some((2, 3)));

        // A merchant code ending in digits must not false-match as a parcela.
        let (d, p) = peel_visa_desc("Compra a Vista ELIANI LEVINSKI 000572080");
        assert_eq!(d, "ELIANI LEVINSKI 000572080");
        assert!(p.is_none());
    }
}
