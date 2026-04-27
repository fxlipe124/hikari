use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Card {
    pub id: String,
    pub name: String,
    pub brand: String,
    pub last4: Option<String>,
    pub closing_day: i64,
    pub due_day: i64,
    pub color: String,
    pub credit_limit_cents: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardInput {
    pub name: String,
    pub brand: String,
    pub last4: Option<String>,
    pub closing_day: i64,
    pub due_day: i64,
    pub color: String,
    pub credit_limit_cents: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub color: String,
    pub parent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryInput {
    pub name: String,
    pub icon: String,
    pub color: String,
    pub parent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transaction {
    pub id: String,
    pub card_id: String,
    pub posted_at: String,
    pub description: String,
    pub merchant_clean: Option<String>,
    pub amount_cents: i64,
    pub currency: String,
    pub fx_rate: Option<f64>,
    pub category_id: Option<String>,
    pub notes: Option<String>,
    pub installment_group_id: Option<String>,
    pub installment_index: Option<i64>,
    pub installment_total: Option<i64>,
    pub is_refund: bool,
    pub is_virtual_card: bool,
    pub source_import_id: Option<String>,
    /// Denormalized statement period ("YYYY-MM") this row belongs to,
    /// pinned at insert time using the closing_day in effect for the
    /// originating statement (or the card default for manual entries).
    /// See migrations.rs SCHEMA_V5_ALTER for the rationale.
    pub statement_year_month: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionInput {
    pub card_id: String,
    pub posted_at: String,
    pub description: String,
    pub merchant_clean: Option<String>,
    pub amount_cents: i64,
    pub currency: Option<String>,
    pub fx_rate: Option<f64>,
    pub category_id: Option<String>,
    pub notes: Option<String>,
    pub installment_group_id: Option<String>,
    pub installment_index: Option<i64>,
    pub installment_total: Option<i64>,
    #[serde(default)]
    pub is_refund: bool,
    #[serde(default)]
    pub is_virtual_card: bool,
    pub source_import_id: Option<String>,
    /// Optional override. When None, `repo::transactions::create` falls
    /// back to computing it via the card's current closing_day.
    #[serde(default)]
    pub statement_year_month: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionFilter {
    pub year_month: Option<String>,
    /// "YYYY" — fetch every row whose statement period (or posted_at, when
    /// no card is selected) sits in this calendar year. Mutually exclusive
    /// with `year_month`; if both are set, `year_month` wins.
    pub year: Option<String>,
    pub card_id: Option<String>,
    pub category_id: Option<String>,
    pub query: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum VaultStatus {
    Locked { path: Option<String> },
    Unlocked { path: String, opened_at: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentVault {
    pub path: String,
    pub name: String,
    pub last_opened_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategorySummary {
    pub category_id: Option<String>,
    pub total_cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardSummary {
    pub card_id: String,
    pub total_cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthSummary {
    pub total_cents: i64,
    pub by_category: Vec<CategorySummary>,
    pub by_card: Vec<CardSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthBucket {
    /// "YYYY-MM" — same shape as the monthly views use elsewhere.
    pub year_month: String,
    pub total_cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YearSummary {
    pub total_cents: i64,
    /// 12 entries — one per month, January→December. Months with no
    /// activity still show up with `total_cents = 0` so the bar chart on
    /// the Dashboard has a stable axis instead of jumping over gaps.
    pub by_month: Vec<MonthBucket>,
    pub by_category: Vec<CategorySummary>,
    pub by_card: Vec<CardSummary>,
}
