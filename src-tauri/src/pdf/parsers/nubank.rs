use crate::error::AppResult;
use crate::pdf::parsers::{generic, ParsedTransaction};

/// Nubank invoice layout — priority 3 parser.
/// Placeholder delegating to the generic regex parser. Refine with samples.
pub fn parse(
    text: &str,
    statement_year_month: Option<&str>,
    closing_day: Option<u32>,
) -> AppResult<Vec<ParsedTransaction>> {
    generic::parse(text, statement_year_month, closing_day)
}
