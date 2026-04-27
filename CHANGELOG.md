# Changelog

All notable changes to Hikari are documented here.

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and adheres to [Semantic Versioning](https://semver.org/).

## [0.1.1] — 2026-04-27

First incremental release on top of the sealed `v0.1.0`.

### Added

- **Multi-PDF batch import**: drop several statements onto the import
  dialog or pick them all at once from the native picker. Each PDF is
  parsed with its own header (closing day, due day) so statements with
  different cuts land on the right month automatically — no more
  re-importing one fatura at a time when catching up on a year of
  history.
- **Rename cascade**: renaming a transaction now offers to apply the
  same name to its other parcelas and to other purchases that share
  the previous name. Each candidate row gets a checkbox so you can
  partially apply.

### Fixed

- **Date display off-by-one**: a transaction stored as
  `2024-08-15T00:00:00Z` showed up as "14 ago" in the list because the
  formatter passed the ISO string through `new Date()`, which converts
  the UTC midnight to 21:00 of the previous day in any timezone west
  of UTC. The formatter now reads the calendar date directly from the
  string instead of round-tripping through a tz-aware Date.

## [0.1.0] — 2026-04-25

First public release. Local-first credit-card statement vault, fully
offline, with paste-and-PDF import for any issuer.

### Added

- **Encrypted vault** using SQLCipher v4 (AES-256-CBC,
  PBKDF2-HMAC-SHA512 with 256k iterations). Single portable `.vault`
  file; master password is never persisted to disk.
- **Auto-lock** on inactivity, configurable in Settings (1 / 5 / 10 /
  30 / 60 min).
- **Manual CRUD** for transactions, cards, and categories via modal
  dialogs.
- **Statement import pipeline** end-to-end:
  - Paste text or drop a password-protected PDF (decryption via
    `lopdf`).
  - Issuer detection by substring signature.
  - **Plugin parser system**: one file per issuer in
    `src-tauri/src/pdf/parsers/` plus a generic column-format
    fallback for any text-formatted statement.
  - Editable preview before commit.
  - Auto-categorization via a starter rule set, fully editable from
    the Categories screen.
  - Automatic dedup by hash of `(date + amount + description)`.
- **Reference issuer parser** with 10 unit tests covering:
  - Multiple sections per statement (e.g. physical and virtual cards
    as separate blocks).
  - Inline-no-space installment markers.
  - Refund / payment-credit sections.
  - Multi-page pagination and continuation lines.
  - Empty-section messages.
  - Section footer closing behavior.
  - Whitespace tolerance.
- **Automatic backup** before each `import_commit`, with rotation of
  the 3 most recent. On-demand backup also available from Settings.
- **CSV export** (UTF-8 with BOM) for the current month or all
  transactions.
- **Toast notifications** via Sonner with translated IPC errors.
- **Empty states** on Dashboard and Transactions screens.
- **Dark / light / system theme** with careful typography (Inter +
  Geist Mono).
- **Bilingual UI**: English by default, Portuguese (Brazil) opt-in via
  Settings → Language. Locale choice persists across sessions and
  controls seeded category names at vault-create time.

### Infrastructure

- **Cross-platform CI** (Ubuntu / Windows / macOS) on every push and
  PR: `cargo test --lib` plus `npx tsc --noEmit`.
- **Release workflow** with a 4-target matrix (Linux, Windows,
  macos-arm, macos-intel) via `tauri-action`. Triggered by `v*` tags
  or manual dispatch.
- **Bundle targets**: NSIS for Windows, `.deb` + `.AppImage` for
  Linux, `.dmg` for macOS — 5 installers total per release.

### Known limitations

- Only one issuer-specific parser ships in this release; the generic
  fallback handles other issuers via column-format heuristics. PRs
  for additional issuer plugins are welcome.
- Foreign-currency lines (with FX conversion + IOF or equivalent
  fees) on the reference issuer parser are not yet covered.
- Builds are not code-signed (Windows displays "unverified publisher";
  macOS requires a right-click → Open on first launch and Apple
  Developer notarization for a signed bundle).
- No auto-updater. Releases are manual downloads from GitHub Releases.

[0.1.1]: https://github.com/fxlipe124/hikari/releases/tag/v0.1.1
[0.1.0]: https://github.com/fxlipe124/hikari/releases/tag/v0.1.0
