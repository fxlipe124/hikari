use rusqlite::Connection;

use crate::error::AppResult;

const SCHEMA_V1: &str = r#"
CREATE TABLE IF NOT EXISTS _meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cards (
    id                TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    brand             TEXT NOT NULL,
    last4             TEXT,
    closing_day       INTEGER NOT NULL CHECK (closing_day BETWEEN 1 AND 31),
    due_day           INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31),
    color             TEXT NOT NULL DEFAULT '#64748b',
    credit_limit_cents INTEGER,
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS categories (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    icon      TEXT NOT NULL DEFAULT 'circle-dashed',
    color     TEXT NOT NULL DEFAULT '#64748b',
    parent_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
    UNIQUE (name, parent_id)
);

CREATE TABLE IF NOT EXISTS installment_groups (
    id              TEXT PRIMARY KEY,
    total_n         INTEGER NOT NULL CHECK (total_n >= 1),
    total_cents     INTEGER NOT NULL,
    first_posted_at TEXT NOT NULL,
    description     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS imports (
    id           TEXT PRIMARY KEY,
    source       TEXT NOT NULL CHECK (source IN ('pdf','paste','manual')),
    file_name    TEXT,
    imported_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    raw_hash     TEXT,
    status       TEXT NOT NULL DEFAULT 'committed',
    card_id      TEXT REFERENCES cards(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS transactions (
    id                    TEXT PRIMARY KEY,
    card_id               TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    posted_at             TEXT NOT NULL,
    description           TEXT NOT NULL,
    merchant_clean        TEXT,
    amount_cents          INTEGER NOT NULL,
    currency              TEXT NOT NULL DEFAULT 'BRL',
    fx_rate               REAL,
    category_id           TEXT REFERENCES categories(id) ON DELETE SET NULL,
    notes                 TEXT,
    installment_group_id  TEXT REFERENCES installment_groups(id) ON DELETE SET NULL,
    installment_index     INTEGER,
    installment_total     INTEGER,
    is_refund             INTEGER NOT NULL DEFAULT 0,
    source_import_id      TEXT REFERENCES imports(id) ON DELETE SET NULL,
    dedup_hash            TEXT,
    created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_tx_posted_at  ON transactions(posted_at);
CREATE INDEX IF NOT EXISTS idx_tx_card       ON transactions(card_id);
CREATE INDEX IF NOT EXISTS idx_tx_category   ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_tx_dedup      ON transactions(dedup_hash);
CREATE INDEX IF NOT EXISTS idx_tx_install    ON transactions(installment_group_id);

CREATE TABLE IF NOT EXISTS budgets (
    id          TEXT PRIMARY KEY,
    category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    year_month  TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    UNIQUE (category_id, year_month)
);

CREATE TABLE IF NOT EXISTS rules (
    id          TEXT PRIMARY KEY,
    pattern     TEXT NOT NULL,
    match_type  TEXT NOT NULL DEFAULT 'contains' CHECK (match_type IN ('contains','regex','exact')),
    category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    priority    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_rules_priority ON rules(priority DESC);
"#;

type CategorySeed = (&'static str, &'static str, &'static str, Option<&'static str>);

const DEFAULT_CATEGORIES_EN: &[CategorySeed] = &[
    ("cat-food",      "Food",            "utensils",         None),
    ("cat-delivery",  "Delivery",        "bike",             Some("cat-food")),
    ("cat-market",    "Groceries",       "shopping-cart",    Some("cat-food")),
    ("cat-restaurant","Restaurant",      "utensils-crossed", Some("cat-food")),
    ("cat-transport", "Transportation",  "car",              None),
    ("cat-fuel",      "Fuel",            "fuel",             Some("cat-transport")),
    ("cat-rideshare", "Rideshare",       "car-taxi-front",   Some("cat-transport")),
    ("cat-subs",      "Subscriptions",   "repeat",           None),
    ("cat-health",    "Health",          "heart-pulse",      None),
    ("cat-home",      "Home",            "home",             None),
    ("cat-leisure",   "Leisure",         "ticket",           None),
    ("cat-shopping",  "Shopping",        "shopping-bag",     None),
    ("cat-others",    "Other",           "circle-dashed",    None),
];

const DEFAULT_CATEGORIES_PT_BR: &[CategorySeed] = &[
    ("cat-food",      "Alimentação",     "utensils",         None),
    ("cat-delivery",  "Delivery",        "bike",             Some("cat-food")),
    ("cat-market",    "Mercado",         "shopping-cart",    Some("cat-food")),
    ("cat-restaurant","Restaurante",     "utensils-crossed", Some("cat-food")),
    ("cat-transport", "Transporte",      "car",              None),
    ("cat-fuel",      "Combustível",     "fuel",             Some("cat-transport")),
    ("cat-rideshare", "Corrida/Uber",    "car-taxi-front",   Some("cat-transport")),
    ("cat-subs",      "Assinaturas",     "repeat",           None),
    ("cat-health",    "Saúde",           "heart-pulse",      None),
    ("cat-home",      "Casa",            "home",             None),
    ("cat-leisure",   "Lazer",           "ticket",           None),
    ("cat-shopping",  "Compras",         "shopping-bag",     None),
    ("cat-others",    "Outros",          "circle-dashed",    None),
];

fn categories_for_locale(locale: &str) -> &'static [CategorySeed] {
    if locale == "pt-BR" {
        DEFAULT_CATEGORIES_PT_BR
    } else {
        DEFAULT_CATEGORIES_EN
    }
}

const DEFAULT_COLORS: &[(&str, &str)] = &[
    ("cat-food", "#ea580c"),
    ("cat-delivery", "#dc2626"),
    ("cat-market", "#16a34a"),
    ("cat-restaurant", "#f97316"),
    ("cat-transport", "#2563eb"),
    ("cat-fuel", "#1e40af"),
    ("cat-rideshare", "#1d4ed8"),
    ("cat-subs", "#9333ea"),
    ("cat-health", "#e11d48"),
    ("cat-home", "#65a30d"),
    ("cat-leisure", "#c026d3"),
    ("cat-shopping", "#0891b2"),
    ("cat-others", "#64748b"),
];

/// Starter set of common, internationally-recognized merchant patterns.
/// Intentionally small and region-neutral — a placeholder so the UI feels
/// alive on first run. Users are expected to customize this from the
/// Categories screen with rules that match their actual spending. Region-
/// specific rule packs (Brazilian merchants, US chains, EU retailers, etc.)
/// belong as community contributions in `docs/rule-packs/` rather than the
/// default seed.
const DEFAULT_RULES: &[(&str, &str, &str)] = &[
    // Rideshare
    ("uber",        "contains", "cat-rideshare"),
    ("lyft",        "contains", "cat-rideshare"),
    ("cabify",      "contains", "cat-rideshare"),
    // Delivery
    ("uber eats",   "contains", "cat-delivery"),
    ("doordash",    "contains", "cat-delivery"),
    ("deliveroo",   "contains", "cat-delivery"),
    ("grubhub",     "contains", "cat-delivery"),
    // Fuel
    ("shell",       "contains", "cat-fuel"),
    ("exxon",       "contains", "cat-fuel"),
    ("chevron",     "contains", "cat-fuel"),
    ("bp ",         "contains", "cat-fuel"),
    // Subscriptions
    ("netflix",     "contains", "cat-subs"),
    ("spotify",     "contains", "cat-subs"),
    ("disney",      "contains", "cat-subs"),
    ("hbo",         "contains", "cat-subs"),
    ("prime video", "contains", "cat-subs"),
    ("youtube prem","contains", "cat-subs"),
    ("apple.com",   "contains", "cat-subs"),
    ("microsoft",   "contains", "cat-subs"),
    // Shopping
    ("amazon",      "contains", "cat-shopping"),
    ("ebay",        "contains", "cat-shopping"),
    ("shopee",      "contains", "cat-shopping"),
    ("aliexpress",  "contains", "cat-shopping"),
];

/// Schema v3 rule expansion: adds Brazilian merchant patterns and a wider
/// international set. Kept in a separate constant from `DEFAULT_RULES` (and
/// with distinct `rule-v3-N` IDs) so existing vaults don't accidentally
/// overwrite/renumber the v1 seed rules — `INSERT OR IGNORE` on the
/// migration leaves anything already there alone.
const RULES_V3_EXTRA: &[(&str, &str, &str)] = &[
    // Rideshare extras
    ("99 ",         "contains", "cat-rideshare"),
    ("99tax",       "contains", "cat-rideshare"),
    // Delivery extras
    ("ifood",       "contains", "cat-delivery"),
    ("rappi",       "contains", "cat-delivery"),
    // Fuel extras
    ("posto ",      "contains", "cat-fuel"),
    ("abastec",     "contains", "cat-fuel"),
    ("ipiranga",    "contains", "cat-fuel"),
    ("petrobras",   "contains", "cat-fuel"),
    // Subscriptions extras
    ("globoplay",   "contains", "cat-subs"),
    // Shopping (specific brands, BR + intl)
    ("mercadolivre","contains", "cat-shopping"),
    ("mercado livre","contains", "cat-shopping"),
    ("magalu",      "contains", "cat-shopping"),
    ("magazine luiza","contains", "cat-shopping"),
    ("americanas",  "contains", "cat-shopping"),
    ("kabum",       "contains", "cat-shopping"),
    // Groceries / market
    ("supermerc",   "contains", "cat-market"),
    ("hortifrut",   "contains", "cat-market"),
    ("acougue",     "contains", "cat-market"),
    ("mercadinho",  "contains", "cat-market"),
    ("walmart",     "contains", "cat-market"),
    ("costco",      "contains", "cat-market"),
    ("whole foods", "contains", "cat-market"),
    ("trader joe",  "contains", "cat-market"),
    // Bakery / generic food
    ("padaria",     "contains", "cat-food"),
    ("padar",       "contains", "cat-food"),
    // Restaurants (BR + intl)
    ("pizzaria",    "contains", "cat-restaurant"),
    ("pizza",       "contains", "cat-restaurant"),
    ("lanchonet",   "contains", "cat-restaurant"),
    ("restaurante", "contains", "cat-restaurant"),
    ("almoco",      "contains", "cat-restaurant"),
    ("jantar",      "contains", "cat-restaurant"),
    ("subway",      "contains", "cat-restaurant"),
    ("mcdonald",    "contains", "cat-restaurant"),
    ("burger king", "contains", "cat-restaurant"),
    ("kfc",         "contains", "cat-restaurant"),
    ("starbucks",   "contains", "cat-restaurant"),
    ("forno ",      "contains", "cat-restaurant"),
    // Health (BR + intl pharmacies)
    ("farmacia",    "contains", "cat-health"),
    ("drogaria",    "contains", "cat-health"),
    ("droga ",      "contains", "cat-health"),
    ("cvs ",        "contains", "cat-health"),
    ("walgreens",   "contains", "cat-health"),
    // Leisure / sports
    ("academia",    "contains", "cat-leisure"),
    ("padel",       "contains", "cat-leisure"),
    ("lazer",       "contains", "cat-leisure"),
    ("cinema",      "contains", "cat-leisure"),
    ("ingresso",    "contains", "cat-leisure"),
    ("amc ",        "contains", "cat-leisure"),
];

/// Schema v4 rule expansion: another wave of common-word patterns,
/// heavy on Brazilian utility companies (cat-home was empty), retail
/// chains, gym networks, and digital subscriptions. `INSERT OR IGNORE`
/// on a fresh `rule-v4-N` id range keeps it idempotent and stops it
/// from clobbering anything users may have edited from v1/v3.
///
/// Patterns chosen to be specific enough to avoid bleeding across
/// categories (e.g. "comgas" → home, not the bare "gas" which would
/// hit "GASOLINA" too).
const RULES_V4_EXTRA: &[(&str, &str, &str)] = &[
    // ── cat-home: utilities, rent, telecom, taxes ───────────────────
    ("aluguel",     "contains", "cat-home"),
    ("condominio",  "contains", "cat-home"),
    ("condomínio",  "contains", "cat-home"),
    ("condom ",     "contains", "cat-home"),
    ("energia",     "contains", "cat-home"),
    ("eletropaulo", "contains", "cat-home"),
    ("enel",        "contains", "cat-home"),
    ("cemig",       "contains", "cat-home"),
    ("copel",       "contains", "cat-home"),
    ("cosern",      "contains", "cat-home"),
    ("equatorial",  "contains", "cat-home"),
    ("celpe",       "contains", "cat-home"),
    ("coelba",      "contains", "cat-home"),
    ("sabesp",      "contains", "cat-home"),
    ("sanepar",     "contains", "cat-home"),
    ("cedae",       "contains", "cat-home"),
    ("embasa",      "contains", "cat-home"),
    ("comgas",      "contains", "cat-home"),
    ("ultragaz",    "contains", "cat-home"),
    ("supergasbras","contains", "cat-home"),
    ("ipva",        "contains", "cat-home"),
    ("iptu",        "contains", "cat-home"),
    ("consorcio",   "contains", "cat-home"),
    ("consórcio",   "contains", "cat-home"),
    ("porto seguro","contains", "cat-home"),
    ("vivo fibra",  "contains", "cat-home"),
    ("claro net",   "contains", "cat-home"),
    ("oi fibra",    "contains", "cat-home"),
    ("tim live",    "contains", "cat-home"),
    ("internet",    "contains", "cat-home"),
    ("fibra",       "contains", "cat-home"),
    ("telefon",     "contains", "cat-home"),

    // ── cat-restaurant: more chains, food types, BR-specific ────────
    ("cafe",        "contains", "cat-restaurant"),
    ("café",        "contains", "cat-restaurant"),
    ("cafeteria",   "contains", "cat-restaurant"),
    ("hamburg",     "contains", "cat-restaurant"),
    ("hambúrg",     "contains", "cat-restaurant"),
    ("sushi",       "contains", "cat-restaurant"),
    ("japones",     "contains", "cat-restaurant"),
    ("japonês",     "contains", "cat-restaurant"),
    ("italian",     "contains", "cat-restaurant"),
    ("mexican",     "contains", "cat-restaurant"),
    ("comida",      "contains", "cat-restaurant"),
    ("churrasc",    "contains", "cat-restaurant"),
    ("bistr",       "contains", "cat-restaurant"),
    ("doceria",     "contains", "cat-restaurant"),
    ("sorveteria",  "contains", "cat-restaurant"),
    ("spoleto",     "contains", "cat-restaurant"),
    ("giraffas",    "contains", "cat-restaurant"),
    ("habibs",      "contains", "cat-restaurant"),
    ("bobs ",       "contains", "cat-restaurant"),

    // ── cat-market: more BR chains ──────────────────────────────────
    ("carrefour",   "contains", "cat-market"),
    ("atacad",      "contains", "cat-market"),
    ("prezunic",    "contains", "cat-market"),
    ("sams club",   "contains", "cat-market"),
    ("sendas",      "contains", "cat-market"),
    ("assai",       "contains", "cat-market"),
    ("assaí",       "contains", "cat-market"),
    ("makro",       "contains", "cat-market"),
    ("pao de acucar","contains", "cat-market"),
    ("pão de açúcar","contains", "cat-market"),
    ("hipermercado","contains", "cat-market"),

    // ── cat-shopping: more retailers ────────────────────────────────
    ("zara",        "contains", "cat-shopping"),
    ("renner",      "contains", "cat-shopping"),
    ("c&a",         "contains", "cat-shopping"),
    ("riachuelo",   "contains", "cat-shopping"),
    ("marisa",      "contains", "cat-shopping"),
    ("casas bahia", "contains", "cat-shopping"),
    ("ponto frio",  "contains", "cat-shopping"),
    ("fast shop",   "contains", "cat-shopping"),
    ("dafiti",      "contains", "cat-shopping"),
    ("netshoes",    "contains", "cat-shopping"),
    ("centauro",    "contains", "cat-shopping"),
    ("decathlon",   "contains", "cat-shopping"),
    ("nike",        "contains", "cat-shopping"),
    ("adidas",      "contains", "cat-shopping"),
    ("puma",        "contains", "cat-shopping"),
    ("lacoste",     "contains", "cat-shopping"),
    ("ikea",        "contains", "cat-shopping"),
    ("leroy merlin","contains", "cat-shopping"),
    ("telhanorte",  "contains", "cat-shopping"),
    ("cobasi",      "contains", "cat-shopping"),
    ("petz",        "contains", "cat-shopping"),
    ("petlove",     "contains", "cat-shopping"),
    ("livraria",    "contains", "cat-shopping"),
    ("fnac",        "contains", "cat-shopping"),
    ("saraiva",     "contains", "cat-shopping"),
    ("polishop",    "contains", "cat-shopping"),

    // ── cat-fuel: extras ────────────────────────────────────────────
    ("gasolina",    "contains", "cat-fuel"),
    ("etanol",      "contains", "cat-fuel"),
    ("alcool",      "contains", "cat-fuel"),
    ("álcool",      "contains", "cat-fuel"),
    ("diesel",      "contains", "cat-fuel"),
    ("combust",     "contains", "cat-fuel"),

    // ── cat-leisure: travel, gym, entertainment ─────────────────────
    ("airbnb",      "contains", "cat-leisure"),
    ("booking",     "contains", "cat-leisure"),
    ("decolar",     "contains", "cat-leisure"),
    ("latam",       "contains", "cat-leisure"),
    ("gol linhas",  "contains", "cat-leisure"),
    ("voe azul",    "contains", "cat-leisure"),
    ("hotel",       "contains", "cat-leisure"),
    ("pousada",     "contains", "cat-leisure"),
    ("resort",      "contains", "cat-leisure"),
    ("sympla",      "contains", "cat-leisure"),
    ("eventbrite",  "contains", "cat-leisure"),
    ("ingressos",   "contains", "cat-leisure"),
    ("smartfit",    "contains", "cat-leisure"),
    ("bluefit",     "contains", "cat-leisure"),
    ("gympass",     "contains", "cat-leisure"),
    ("totalpass",   "contains", "cat-leisure"),
    ("pilates",     "contains", "cat-leisure"),
    ("crossfit",    "contains", "cat-leisure"),

    // ── cat-health: clinics, more pharmacies ────────────────────────
    ("hospital",    "contains", "cat-health"),
    ("clinica",     "contains", "cat-health"),
    ("clínica",     "contains", "cat-health"),
    ("dentista",    "contains", "cat-health"),
    ("drogasil",    "contains", "cat-health"),
    ("ultrafarma",  "contains", "cat-health"),
    ("panvel",      "contains", "cat-health"),
    ("drogaraia",   "contains", "cat-health"),
    ("pacheco",     "contains", "cat-health"),
    ("consulta",    "contains", "cat-health"),
    ("exame",       "contains", "cat-health"),
    ("veterin",     "contains", "cat-health"),
    ("fisio",       "contains", "cat-health"),
    ("ortodonti",   "contains", "cat-health"),

    // ── cat-subs: digital subscriptions ─────────────────────────────
    ("paramount",   "contains", "cat-subs"),
    ("deezer",      "contains", "cat-subs"),
    ("tidal",       "contains", "cat-subs"),
    ("audible",     "contains", "cat-subs"),
    ("kindle",      "contains", "cat-subs"),
    ("dropbox",     "contains", "cat-subs"),
    ("icloud",      "contains", "cat-subs"),
    ("twitch",      "contains", "cat-subs"),
    ("patreon",     "contains", "cat-subs"),
    ("openai",      "contains", "cat-subs"),
    ("chatgpt",     "contains", "cat-subs"),
    ("claude.ai",   "contains", "cat-subs"),
    ("anthropic",   "contains", "cat-subs"),
    ("github",      "contains", "cat-subs"),
    ("vercel",      "contains", "cat-subs"),
    ("cloudflare",  "contains", "cat-subs"),
    ("canva",       "contains", "cat-subs"),
    ("figma",       "contains", "cat-subs"),
    ("notion",      "contains", "cat-subs"),
    ("adobe",       "contains", "cat-subs"),

    // ── cat-rideshare: extras ───────────────────────────────────────
    ("taxi",        "contains", "cat-rideshare"),
    ("táxi",        "contains", "cat-rideshare"),
    ("didi",        "contains", "cat-rideshare"),

    // ── cat-delivery: extras ────────────────────────────────────────
    ("zomato",      "contains", "cat-delivery"),
    ("glovo",       "contains", "cat-delivery"),
];

/// Schema v2: add `is_virtual_card` flag to transactions so the UI can
/// distinguish purchases on a Sofisa virtual card from the physical card
/// on the same statement.
const SCHEMA_V2_ALTER: &str = r#"
ALTER TABLE transactions ADD COLUMN is_virtual_card INTEGER NOT NULL DEFAULT 0;
"#;

/// Schema v5: denormalize the statement period each transaction belongs to.
/// The card's `closing_day` is a single value, but real banks (Sofisa
/// included) shift their closing date by ±1–2 days each month to dodge
/// weekends/holidays. The previous design pivoted at query time using
/// `card.closing_day`, which produced wrong groupings for any month that
/// drifted from the card's nominal closing day. By stamping the period at
/// insert time using the closing_day actually printed on that statement's
/// header (or the card default for manual entries), the filter becomes a
/// flat `WHERE statement_year_month = ?` and stays correct across drift.
const SCHEMA_V5_ALTER: &str = r#"
ALTER TABLE transactions ADD COLUMN statement_year_month TEXT;
CREATE INDEX IF NOT EXISTS idx_tx_stmt_period ON transactions(statement_year_month);
"#;

/// Best-effort backfill on v5: existing rows pick up the period implied by
/// the card's *current* closing_day. For a vault where the closing oscillated
/// per-month, the backfill is approximate; the user can either re-import the
/// affected statements (parser stamps the real per-statement value) or edit
/// the card to trigger the cascade `UPDATE` defined in repo::cards::update.
const SCHEMA_V5_BACKFILL: &str = r#"
UPDATE transactions
SET statement_year_month = (
  SELECT
    CASE WHEN CAST(SUBSTR(transactions.posted_at, 9, 2) AS INTEGER) > c.closing_day
      THEN STRFTIME('%Y-%m', DATE(SUBSTR(transactions.posted_at, 1, 10), '+1 month'))
      ELSE SUBSTR(transactions.posted_at, 1, 7)
    END
  FROM cards c WHERE c.id = transactions.card_id
)
WHERE statement_year_month IS NULL;
"#;

pub fn run(conn: &Connection, locale: &str) -> AppResult<()> {
    let current: i64 = conn
        .query_row(
            "SELECT COALESCE((SELECT CAST(value AS INTEGER) FROM _meta WHERE key='schema_version'), 0)",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    if current < 1 {
        conn.execute_batch(SCHEMA_V1)?;
        seed(conn, locale)?;
        conn.execute(
            "INSERT OR REPLACE INTO _meta(key,value) VALUES('schema_version','1')",
            [],
        )?;
    }
    if current < 2 {
        conn.execute_batch(SCHEMA_V2_ALTER)?;
        conn.execute(
            "INSERT OR REPLACE INTO _meta(key,value) VALUES('schema_version','2')",
            [],
        )?;
    }
    if current < 3 {
        // Pure data seed — no DDL. INSERT OR IGNORE leaves any user-edited
        // rule with a colliding `rule-v3-N` id alone (the IDs are unique to
        // this migration so there's no collision with the v1 `rule-seed-N`
        // batch). Existing vaults pick up the BR + extended international
        // patterns; new vaults get them via this same path on first open.
        for (i, (pattern, match_type, category_id)) in RULES_V3_EXTRA.iter().enumerate() {
            // Stay below the v1 priority floor (priorities 100..76) so the
            // hand-curated seed wins ties on overlapping patterns.
            let priority = (50i64 - i as i64).max(0);
            conn.execute(
                "INSERT OR IGNORE INTO rules (id, pattern, match_type, category_id, priority)
                 VALUES (?, ?, ?, ?, ?)",
                rusqlite::params![
                    format!("rule-v3-{}", i),
                    pattern,
                    match_type,
                    category_id,
                    priority,
                ],
            )?;
        }
        conn.execute(
            "INSERT OR REPLACE INTO _meta(key,value) VALUES('schema_version','3')",
            [],
        )?;
    }
    if current < 4 {
        // Same shape as v3 — fresh `rule-v4-N` id range, INSERT OR IGNORE,
        // priority floor below v3 so the more-specific earlier patterns
        // still win when a description matches both (e.g. "padaria" v3
        // beats v4's generic "café").
        for (i, (pattern, match_type, category_id)) in RULES_V4_EXTRA.iter().enumerate() {
            let priority = (40i64 - i as i64).max(0);
            conn.execute(
                "INSERT OR IGNORE INTO rules (id, pattern, match_type, category_id, priority)
                 VALUES (?, ?, ?, ?, ?)",
                rusqlite::params![
                    format!("rule-v4-{}", i),
                    pattern,
                    match_type,
                    category_id,
                    priority,
                ],
            )?;
        }
        conn.execute(
            "INSERT OR REPLACE INTO _meta(key,value) VALUES('schema_version','4')",
            [],
        )?;
    }
    if current < 5 {
        conn.execute_batch(SCHEMA_V5_ALTER)?;
        conn.execute_batch(SCHEMA_V5_BACKFILL)?;
        conn.execute(
            "INSERT OR REPLACE INTO _meta(key,value) VALUES('schema_version','5')",
            [],
        )?;
    }
    Ok(())
}

fn seed(conn: &Connection, locale: &str) -> AppResult<()> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM categories", [], |r| r.get(0))?;
    if count > 0 {
        return Ok(());
    }
    for (id, name, icon, parent) in categories_for_locale(locale) {
        let color = DEFAULT_COLORS
            .iter()
            .find(|(cid, _)| cid == id)
            .map(|(_, c)| *c)
            .unwrap_or("#64748b");
        conn.execute(
            "INSERT INTO categories (id,name,icon,color,parent_id) VALUES (?,?,?,?,?)",
            rusqlite::params![id, name, icon, color, parent],
        )?;
    }
    // Rules match real merchant names in the raw PDF text and stay locale-agnostic.
    for (i, (pattern, match_type, category_id)) in DEFAULT_RULES.iter().enumerate() {
        // Saturate at 0 so adding more than 100 default rules in the future
        // doesn't produce negative priorities (which would sort wrong).
        let priority = (100i64 - i as i64).max(0);
        conn.execute(
            "INSERT INTO rules (id,pattern,match_type,category_id,priority) VALUES (?,?,?,?,?)",
            rusqlite::params![
                format!("rule-seed-{}", i),
                pattern,
                match_type,
                category_id,
                priority
            ],
        )?;
    }
    Ok(())
}
