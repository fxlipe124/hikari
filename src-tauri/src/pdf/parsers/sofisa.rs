use once_cell::sync::Lazy;
use regex::Regex;

use crate::error::AppResult;
use crate::pdf::parsers::{generic, CardMetadata, ParsedTransaction};

/// Sofisa Direto invoice layout — priority parser.
///
/// Observed structure of a real fatura:
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

pub fn parse(
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

    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }

        // Section transitions. Order matters: REFUND first, then VIRTUAL
        // (substring of the generic expense header), then the generic header.
        if REFUND_HEADER.is_match(line) {
            section = Section::Refund;
            continue;
        }
        if EXPENSE_VIRTUAL_HEADER.is_match(line) {
            section = Section::ExpenseVirtual;
            continue;
        }
        if EXPENSE_HEADER.is_match(line) {
            section = Section::Expense;
            continue;
        }
        if COLUMN_HEADER.is_match(line) {
            continue;
        }

        // Footer markers close any active section.
        let lower = line.to_lowercase();
        if lower.contains("total desta fatura")
            || lower.contains("total da fatura")
            || lower.contains("valor m\u{ED}nimo")
            || lower.contains("valor minimo")
            || lower.contains("pagamento m\u{ED}nimo")
            || lower.contains("pagamento minimo")
            || lower.starts_with("subtotal")
            || lower.starts_with("resumo da fatura")
        {
            section = Section::None;
            continue;
        }

        // Pagination + continuation noise — skip without changing section.
        if lower.starts_with("p\u{E1}gina ")
            || lower.starts_with("pagina ")
            || lower.contains("(continua\u{E7}\u{E3}o)")
            || lower.contains("(continuacao)")
            || lower.contains("n\u{E3}o houve movimenta")
            || lower.contains("nao houve movimenta")
        {
            continue;
        }

        if section == Section::None {
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
    fn parses_refund_section() {
        // Real fatura includes a "Pagamentos e Créditos" section before
        // "Despesas Cartão". Its lines are payments/estornos — must be flagged
        // as is_refund and stored as positive amounts.
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
        assert_eq!(txs.len(), 3);

        assert!(txs[0].is_refund);
        assert_eq!(txs[0].amount_cents, 123456);
        assert!(txs[0].description.contains("PAG. EFETUADO"));
        assert!(txs[0].installment.is_none(), "refund must not parse parcela");

        assert!(txs[1].is_refund);
        assert_eq!(txs[1].amount_cents, 8990);

        assert!(!txs[2].is_refund);
        assert_eq!(txs[2].description, "PADARIA");
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
}
