<div align="center">

# Hikari

**光 — light on your spending.**
A local, encrypted, portable vault for credit-card statements from any
issuer.

![status](https://img.shields.io/badge/status-active_development-orange)
![tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)
![rust](https://img.shields.io/badge/Rust-stable-DEA584?logo=rust&logoColor=white)
![react](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)
![license](https://img.shields.io/badge/license-MIT-blue)

</div>

---

Hikari is a desktop app for Windows, macOS, and Linux that lets you
track spending on **any credit card from any issuer in any currency**
without sending a single byte to the internet. Every transaction lives
in a `.vault` file encrypted with your master password — you decide
where to keep it and when to take it to another machine.

The flow is simple: paste a statement (or drop the PDF), review the
auto-categorized transactions, and watch month over month where the
money goes. No cloud, no account, no subscription, no bank API keys.

> **Status:** active development. Functional for personal use, but the
> feature surface is still growing. See the [Roadmap](#roadmap).

## Contents

- [Why Hikari](#why-hikari)
- [Features](#features)
- [Stack](#stack)
- [Getting started](#getting-started)
- [Project layout](#project-layout)
- [Statement import](#statement-import)
- [Issuer plugins](#issuer-plugins)
- [Security](#security)
- [Languages](#languages)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

## Why Hikari

Traditional finance apps want your bank credentials, ask you to enable
Open Banking, or charge a monthly fee. Spreadsheets work but require
manual discipline and don't handle long installment plans well.

Hikari sits in the middle:

- **You're the sole owner of the data.** The `.vault` file is yours —
  USB stick, encrypted Dropbox, local backup, whatever you prefer.
- **Importing is trivial.** Paste statement content or drop the PDF
  (with password if it's protected). The parser identifies the layout,
  builds the rows, and applies auto-categorization. You review and
  approve.
- **Issuer-agnostic by design.** Hikari ships with a generic
  column-format parser that works on any text-formatted statement, and
  a plugin system for issuer-specific parsers when a particular layout
  needs precise handling. Drop in a parser for your bank in a single
  Rust file — see [Issuer plugins](#issuer-plugins).
- **Currency-flexible.** Transactions carry their own currency code.
  The default seed assumes BRL because that's the author's primary
  use case, but the schema and UI handle any ISO currency.
- **Truly local-first.** No server. No login. No telemetry. Works
  offline forever.

## Features

### Already works

- **Encrypted portable vault** (`.vault`) backed by SQLCipher
  (AES-256, PBKDF2-HMAC-SHA512 with 256k iterations).
- **Multiple cards** — any issuer, any brand, with closing day, due
  day, limit, and color.
- **Hierarchical categories** seeded in your locale (English by
  default, Portuguese on opt-in) plus auto-classification rules by
  merchant pattern. The seed rules are a *starter set* — add, edit,
  or remove freely from the Categories screen.
- **Transactions with installments** — every installment is recorded
  with index/total and shows up on the right month's dashboard.
- **Statement import**
  - Paste statement text from any source.
  - Drop the PDF — with password if necessary.
  - Editable preview before saving (toggle, adjust category,
    description, amount).
  - Automatic dedup by hash — re-importing the same statement does
    not duplicate.
- **Monthly dashboard** — open total, top categories, distribution by
  card, recent transactions.
- **Light / dark / system theme** with careful typography (Inter +
  Geist Mono for numerals).
- **Auto-lock** configurable (1 / 5 / 10 / 30 / 60 min of inactivity).
- **CSV export** (UTF-8 with BOM, spreadsheet-compatible).
- **Automatic backup** before each import commit (3-most-recent
  rotation), plus on-demand backup from Settings.
- **Bilingual UI** — English by default, Portuguese (BR) optional via
  Settings → Language. Easy to add more locales (drop a JSON in
  `src/locales/`).

### Under construction

See [Roadmap](#roadmap).

## Stack

- **[Tauri 2](https://tauri.app/)** — native webview + Rust backend.
  Final binary ~11 MB on Windows; very low memory footprint.
- **Frontend**: React 19 · TypeScript · Vite 7
- **UI**: Tailwind CSS 4 + Radix UI primitives + Lucide icons
- **i18n**: react-i18next with `en` / `pt-BR` locales
- **State**: TanStack Query (server state) · Zustand (UI state)
- **Persistence**: SQLite via `rusqlite` with the **SQLCipher** extension
- **PDF**: `lopdf` (decryption) + `pdf-extract` (text extraction)
- **Architecture**: pluggable statement parsers in
  `src-tauri/src/pdf/parsers/` — one file per issuer + a generic
  fallback.

## Getting started

### Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 20+ | 24 recommended |
| Rust | stable | via [rustup](https://rustup.rs) |
| C toolchain | platform-specific | macOS: Xcode CLT · Linux: gcc + libssl-dev · Windows: Visual Studio Build Tools (workload _Desktop development with C++_) + [Strawberry Perl](https://strawberryperl.com) (required to compile vendored OpenSSL) |

> **Windows:** if Smart App Control is enabled, you'll need to disable
> it (Settings → Windows Security → App & browser control → Smart App
> Control). It blocks unsigned binaries that `cargo` produces during
> compilation.

### Install

```bash
git clone https://github.com/fxlipe124/hikari.git
cd hikari
npm install
```

### Develop

```bash
npm run tauri dev
```

The first run compiles SQLCipher + OpenSSL from source (~5–10 min).
After that the cycle is seconds.

### Production build

```bash
npm run tauri build
```

Generates the native installer for the host platform under
`src-tauri/target/release/bundle/`. Bundle targets are configured in
`src-tauri/tauri.conf.json` (default: NSIS for Windows, .deb +
.AppImage for Linux, .dmg for macOS).

### First-run walkthrough

1. Open the app — you'll see the unlock screen.
2. **Create new vault** → choose a path for `my-vault.vault` → set a
   master password (minimum 8 characters). There is no recovery if you
   lose this password.
3. Go to **Cards → New card** and register your cards (any
   issuer/brand).
4. **Import statement** (top bar) → pick the card → paste text OR drop
   the PDF.
5. Review the preview → **Import N**.
6. Back to the dashboard.

## Project layout

```
hikari/
├── src/                          # React + TypeScript frontend
│   ├── routes/                   # Screens (Dashboard, Transactions, Cards, ...)
│   ├── components/               # Dialogs, AppShell, UI primitives
│   │   └── ui/                   # Button, Input, Dialog, Tabs, Select, ...
│   ├── hooks/                    # useVaultStore, useAutolock, useTheme, ...
│   ├── lib/                      # ipc, queries, mutations, i18n, formatters
│   ├── locales/                  # en.json + pt-BR.json (drop more here)
│   └── styles/globals.css        # Design tokens + Tailwind
│
├── src-tauri/                    # Rust backend
│   └── src/
│       ├── lib.rs                # Bootstrap + IPC handlers
│       ├── commands.rs           # IPC surface (vault, cards, transactions, import)
│       ├── vault/                # SQLCipher open/create + migrations + seeds
│       ├── repo/                 # Data access (cards, categories, transactions)
│       ├── pdf/
│       │   ├── extract.rs        # Decryption + text extraction
│       │   ├── detect.rs         # Issuer detection by signature
│       │   └── parsers/          # One file per issuer + a generic fallback
│       ├── categorize.rs         # Rule application for auto-category
│       ├── error.rs              # AppError serialized for the frontend
│       └── models.rs             # Shared serde structs
```

## Statement import

The flow is the same regardless of who issued the card:

1. **You paste statement text** (from a PDF, the bank's website, a
   text-extraction app, or anything else) **or drop the PDF**.
2. **The detector identifies the issuer** by comparing signatures in
   the text (issuer names, characteristic headers, URLs).
3. **The matching parser extracts** the transactions. If no specific
   parser matches, the **generic parser** kicks in (regex that picks
   up `DD/MM <description> <amount>` in column-formatted text).
4. **Auto-categorization** runs against the `rules` table (a starter
   seed of common merchant patterns, fully editable from the
   Categories screen).
5. **You review the preview**, edit anything, and confirm.
6. **Dedup** by hash of `(date + amount + description)` prevents
   duplicates on re-import.

## Issuer plugins

Each parser lives in `src-tauri/src/pdf/parsers/<issuer>.rs` and
exposes a single function:

```rust
pub fn parse(text: &str) -> AppResult<Vec<ParsedTransaction>> {
    // ...
}
```

To add support for a new issuer:

1. Create `src-tauri/src/pdf/parsers/my_issuer.rs` with a `fn parse`.
2. Register the module in `parsers/mod.rs` and add the variant to
   `pdf::Issuer`.
3. Add the detection signature in `pdf/detect.rs`.
4. Write tests in `parsers/my_issuer.rs` with a real statement
   sample.

The repository ships one specific parser as a working reference (10
unit tests covering inline-no-space installments, refund sections,
multi-page pagination, etc.). PRs are welcome for parsers covering
any other issuer worldwide.

## Security

- **Hikari uses SQLCipher** with the v4 default profile: AES-256 in CBC
  mode, PBKDF2-HMAC-SHA512 with 256 000 iterations, random salt embedded
  in page 0 of the database.
- **The master password is never written anywhere.** It only exists in
  memory during the session; locking the vault destroys the connection.
- **Auto-lock** closes the connection after N minutes of inactivity.
- **`config.json`** (recent vault paths, preferences) **contains no
  sensitive data** — only paths. It can be deleted without losing
  transactions.
- **The `.vault` file is fully portable.** Copy it to another machine,
  remember the password, you have access. Without it, not even Hikari
  can open it.
- **There is no password recovery.** If you forget the password, you
  lose the data — that's the trade-off of not trusting an external
  server.

> The chosen cryptography is robust for the "attacker with access to
> the file but needs to guess a strong password" scenario. It is not
> nation-state resistance. Use a strong password and an encrypted
> backup.

## Languages

Hikari ships with two locales out of the box:

- **English** (`en`) — default
- **Portuguese (Brazil)** (`pt-BR`) — opt-in via Settings → Language

Adding a new locale is two steps: copy `src/locales/en.json` to
`src/locales/<your-locale>.json`, translate the values, and register
the locale in `src/lib/i18n.ts` and
`src/components/LanguageToggle.tsx`. PRs welcome.

The seed category names are inserted in your active locale at
vault-create time and remain editable from the Categories screen. The
auto-categorization rules ship as a *starter set* — fully editable
from the Categories screen as you customize for your region and your
spending patterns.

## Roadmap

| Version | Focus |
|---|---|
| **0.1** _(current)_ | Vault + manual CRUD + paste/PDF import + generic parser + one reference issuer plugin + i18n + automatic backup + CSV export + cross-platform CI |
| 0.2 | More issuer plugins (community PRs welcome) · Foreign-currency line handling · Keyboard shortcuts · Command palette (⌘K) |
| 0.3 | Charts on the dashboard · Code signing on Windows + macOS notarization |
| 0.4 | Auto-updater · CSV import (re-ingest from spreadsheet) |
| Future | Companion mobile · Optional E2E sync (CRDT) |

## Contributing

Contributions are welcome, especially:

- **Issuer parsers** for banks not yet covered. See [Issuer
  plugins](#issuer-plugins).
- **Auto-categorization rules** for merchants in your region. The
  seed set is a starting point; we'd love issuer-by-issuer or
  region-by-region rule packs.
- **Translations** — currently `en` and `pt-BR`. Adding ES, FR, DE,
  etc. is two JSON files in `src/locales/`.

Before submitting a PR:

1. `npm run tauri dev` must boot cleanly.
2. `cargo test --lib` must pass.
3. `npx tsc --noEmit` must pass.
4. Clean, signed (`-S`) commit message.

## License

[MIT](LICENSE) — do whatever you want. Forks aimed at different goals
are welcome.

---

<div align="center">
<sub>Built offline. Collects nothing. No server to fail.</sub>
</div>
