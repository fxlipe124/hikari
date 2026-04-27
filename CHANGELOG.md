# Changelog

All notable changes to Hikari are documented here.

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and adheres to [Semantic Versioning](https://semver.org/).

## [0.1.6] — 2026-04-27

### Added

- **Delete cascade on transaction edit.** Clicking Delete on a row
  with related transactions (other parcelas of the same purchase, or
  other rows with the same merchant name) now opens the same
  BulkApply dialog used for the rename and category cascades, in
  delete mode: red action button, "Delete this + N selected" copy,
  defaults all candidates checked. With no related rows the dialog
  is skipped and the existing simple confirm runs.

### Changed

- **Skip the entire `Pagamentos e Créditos` section** on Sofisa
  imports, regardless of amount sign. Even when a payment shows up
  as a positive value (cashback, reward credits), the section is
  always money flow with the bank, never a purchase the user made.
  v0.1.5 already filtered negative amounts; this closes the gap for
  the rare positive-amount payment lines too.

## [0.1.5] — 2026-04-27

### Fixed

- **Multi-page Sofisa statements losing transactions on continuation
  pages.** Real Sofisa exports print a per-section / per-page subtotal
  ("Subtotal página 1") at the bottom of each page and a
  "(continuação)" header at the top of the next page, often without
  repeating the section header. The parser used to treat any
  subtotal-like line as a hard end-of-section, so every transaction
  on subsequent pages got dropped — statements rendered as one-page
  excerpts. Two changes:
  - "Subtotal" and "Resumo da fatura" no longer close the section
    (they're per-section recap, not end-of-doc). Only the truly final
    markers — "Total desta fatura", "Total da fatura", "Pagamento
    mínimo", "Valor mínimo" — close it.
  - "(continuação)" now restores the most recently active section if a
    running-total footer happened to close it, so even faturas that
    print "Total desta fatura" on every page footer parse correctly
    end-to-end.
  - Two new parser tests exercise both scenarios.

### Changed

- **Skip negative-amount rows on import** (Sofisa + generic parsers).
  Lines with a leading `-` on the amount column are payments and
  estornos that the bank already deducted from the bill — including
  them as transactions doubled up math the user already saw in the
  statement total. They no longer appear in the imported list.

## [0.1.4] — 2026-04-27

### Fixed

- **Password-protected PDF imports failing with `invalid input: PDF
  is encrypted; password is required`**. The backend was returning a
  generic `Invalid` error code when no password was supplied to a
  locked PDF, and the frontend only intercepted `invalid_password` —
  so the prompt never appeared and the raw error leaked into a toast.
  Both cases (no password, wrong password) now map to
  `InvalidPassword` so the existing inline-prompt flow takes over.

### Changed

- **PDF password field always visible** when at least one PDF is
  queued, instead of only revealing after the first failure. Lets
  the user pre-fill the password before clicking Continue and skip
  the failed-attempt round-trip — and clarifies (via a small hint)
  that the same password is reused for every file in a batch.

## [0.1.3] — 2026-04-27

### Added

- **Multi-select on the Transactions table.** Each row gets a
  checkbox; the header has a "select all". When at least one row is
  selected, a bulk-action bar appears above the table with two
  actions:
  - **Categorize as…** dropdown — applies the picked category (or
    "no category") to every selected row in one IPC roundtrip.
  - **Delete** — confirms then removes every selected row.
  Selection clears when the month/filter changes (rows that left the
  view are no longer relevant).

### Changed

- **Default sort** in the Transactions list flipped from newest-first
  to oldest-first, so the statement reads top-to-bottom in the
  chronological order the bank prints. The filter dialog still lets
  you flip back to newest-first.

## [0.1.2] — 2026-04-27

### Added

- **Category cascade** on transaction edit. Assigning a category to one
  row now offers to apply it to other parcelas of the same purchase and
  to other rows with the same merchant name — same UX as the existing
  rename cascade. Combined renames + categorizations show one merged
  prompt.
- **Persistent view month**. Switching between Dashboard and
  Transactions, or popping a sub-dialog and coming back, no longer
  snaps the month picker to "today". Persists for the session; resets
  on app restart / vault relock.

### Fixed

- **`[object Object]` error toast** on import failures. The IPC bridge
  surfaces errors as `{code, message}` objects and the call sites were
  passing them through `String()`. New shared helper
  `errorMessage(e)` extracts a human-readable string instead.
- **Statement-period reset on card switch in import**. Picking a
  different card no longer overwrites a month the user already
  adjusted; auto-snap only fires on the very first card pick of an
  import session.
- **Parcela rows landing in the wrong fatura.** Sofisa prints the
  *original purchase date* on every parcela of a multi-month plan
  (parcela 2/10 of an Aug 2024 purchase shows up dated `04/07` in the
  Sep statement). The ImportPreview commit was computing
  `statement_year_month` from `posted_at + closing_day`, which
  silently grouped `04/07` into the August fatura even when the row
  belonged to the September import. Now the parser's own
  `statement_year_month` (extracted from the Sofisa header `compras
  e pagamentos feitos até DD/MM/YYYY`) wins, with the closing-day
  pivot only used as a fallback for non-Sofisa or paste imports.

### Changed

- `transactions_bulk_rename` IPC merged into `transactions_bulk_update`
  with optional `description`, `merchant_clean`, and `category_id`
  patch fields — internal refactor to support the category cascade
  above.
- Multi-PDF import picker label switches to "Starting statement"
  (with a clarifying hint) when more than one file is queued, since
  each PDF carries its own header.

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

[0.1.6]: https://github.com/fxlipe124/hikari/releases/tag/v0.1.6
[0.1.5]: https://github.com/fxlipe124/hikari/releases/tag/v0.1.5
[0.1.4]: https://github.com/fxlipe124/hikari/releases/tag/v0.1.4
[0.1.3]: https://github.com/fxlipe124/hikari/releases/tag/v0.1.3
[0.1.2]: https://github.com/fxlipe124/hikari/releases/tag/v0.1.2
[0.1.1]: https://github.com/fxlipe124/hikari/releases/tag/v0.1.1
[0.1.0]: https://github.com/fxlipe124/hikari/releases/tag/v0.1.0
