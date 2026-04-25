use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Issuer {
    Sofisa,
    MercadoPago,
    Nubank,
    Generic,
}

pub fn detect_issuer(text: &str) -> Issuer {
    let lower = text.to_lowercase();
    if lower.contains("banco sofisa") || lower.contains("sofisa direto") {
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
