use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Issuer {
    Sofisa,
    MercadoPago,
    Nubank,
    Generic,
}

/// Sofisa masks the card number as `4563**.******.0656` on its Visa
/// template. The dotted `**.******.` mask is distinctive enough to fingerprint
/// Sofisa even on a pasted excerpt that doesn't include the bank's name
/// banner (the classic Mastercard PDF carries "Sofisa" branding; the Visa
/// table body may not).
static SOFISA_MASKED_CARD: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\d{4}\*\*\.\*{6}\.\d{4}").unwrap());

pub fn detect_issuer(text: &str) -> Issuer {
    let lower = text.to_lowercase();
    if lower.contains("banco sofisa")
        || lower.contains("sofisa direto")
        || SOFISA_MASKED_CARD.is_match(text)
    {
        return Issuer::Sofisa;
    }
    if lower.contains("mercadopago.com") || lower.contains("mercado pago") {
        return Issuer::MercadoPago;
    }
    if lower.contains("nu pagamentos") || lower.contains("nubank.com.br") || lower.contains(" nubank") {
        return Issuer::Nubank;
    }
    Issuer::Generic
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_sofisa_by_name() {
        assert_eq!(detect_issuer("Banco Sofisa S.A."), Issuer::Sofisa);
        assert_eq!(detect_issuer("Fatura Sofisa Direto"), Issuer::Sofisa);
    }

    #[test]
    fn detects_sofisa_visa_by_masked_card() {
        // A Visa-template excerpt with no bank-name banner still fingerprints
        // as Sofisa via the distinctive `4563**.******.0656` card mask.
        let text = "FELIPE DA SILVA SAURO\n4563**.******.0656\nCompra a Vista IFOOD\n";
        assert_eq!(detect_issuer(text), Issuer::Sofisa);
    }

    #[test]
    fn generic_when_no_signature() {
        assert_eq!(detect_issuer("Some random statement 12/03 STORE 10,00"), Issuer::Generic);
    }
}
