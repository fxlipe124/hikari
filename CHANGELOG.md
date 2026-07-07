# Changelog

All notable changes to Hikari are documented here.

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and adheres to [Semantic Versioning](https://semver.org/).

## [0.1.9] — 2026-07-07

A visual-refinement round across the whole app: the dashboard learns
to answer "how am I doing?" instead of just "what happened?", both
charts get a serious polish, and every route converges on the same
loading / empty / focus patterns. Frontend-only — no Rust file
changed, no schema migration, existing vaults open untouched.

### Added

- **Spending pace, daily average, projection, and trend on the
  Dashboard.** The month view's stat row was rebuilt around honest
  period math:
  - The **total** gains a pace badge comparing spend so far against
    the *previous statement period truncated at the same day offset*
    ("am I ahead of where I was last month?") — not against the full
    previous month, which would read as a guaranteed improvement
    until the last week. Closed periods compare total vs. total.
    A 12-month **sparkline** sits under the number, built by merging
    two cached year-summary calls (`useTrailingMonths`) so it crosses
    January without a new IPC.
  - A **daily average** stat replaces "Active cards" (that count was
    already visible in the cards panel below). In-progress periods
    show the running rate (spend ÷ days elapsed); closed periods show
    total ÷ period length. Its badge compares against the previous
    period's full-period average.
  - A **projection** stat appears only while the viewed period
    contains today and is incomplete: known spend + already-booked
    future rows (parcelas registered past today) + run-rate over the
    remaining days. Booked installments are excluded from the
    run-rate so they aren't extrapolated twice. When the period is
    closed or in the future the slot shows the Active-installments
    stat instead — a projection of a finished month would be noise.
  - The year view gets the same treatment: a **monthly average** and
    a same-point-of-year baseline (full prior statement buckets plus
    the in-progress bucket pro-rated by days elapsed). Both sides of
    the comparison count only spend actually incurred — future-dated
    parcelas booked through December don't inflate the year badge.
  - **Delta semantics are inverted on purpose:** every number in
    Hikari is an expense, so spending *more* renders red with an up
    arrow, spending *less* renders green, and a missing baseline
    (empty previous period, first month of data) renders a neutral
    dash instead of an infinite percentage.
  - The donut legend gains a compact **per-category delta** with the
    same rules, using exact per-category same-point sums while the
    month is in progress.
- **"Others" slice in the category donut.** The pie normalizes slice
  angles to whatever data it receives, so a top-6-only donut drew
  angles that didn't match the percentages printed in the legend
  whenever more than six categories had spend. The remainder is now
  aggregated into a muted, non-clickable slice — angles and legend
  finally agree. The hollow center shows the period total, and
  hovering a slice or legend row cross-highlights both sides.
- **Skeleton loading on every route.** The `.skeleton` shimmer class
  had existed since v0.1.0 without a single consumer. Dashboard,
  Transactions, Cards, Categories, and Installments now render
  layout-matching placeholders while their first fetch resolves.
- **Standardized empty states.** One `EmptyState` component (icon in
  a muted circle, title, description, optional action) replaces the
  four divergent ad-hoc layouts — and Categories, which previously
  rendered a blank void when empty, gets one too.
- **Keyboard support on transaction rows**: rows are focusable,
  Enter/Space opens the edit dialog, and the focus ring draws inset
  so the table's overflow doesn't clip it. Space on the selection
  checkbox still toggles selection.

### Changed

- **The year bar chart is responsive** — it was hard-coded at 760px
  and either overflowed or floated in the card. It now follows the
  window, gains subtle horizontal gridlines, renders the in-progress
  statement period in full accent while other months sit at 55%
  opacity, and animates in 250ms instead of the ~1.5s Recharts
  default. The Y axis reuses `formatCompact`. Both charts share one
  token-styled `ChartTooltip` instead of inline style objects; the
  bar tooltip adds a month-over-month delta.
- **Motion is now a design token.** `--default-transition-duration:
  120ms` + ease-out in the Tailwind theme, so every bare
  `transition-*` utility in the app inherits the same pace — the
  per-component `duration-[120ms]` overrides were removed as
  redundant.
- **One header layout for all six routes** (`PageHeader`): title,
  subtitle, right-aligned actions — ending the items-center vs.
  items-end drift between Dashboard/Transactions and the CRUD pages.
  The duplicated card-filter chip row was extracted into
  `CardFilterChips`.
- **Density pass on the Dashboard**: recent-transactions rows match
  the Transactions table (`py-2`), and the content sits in a single
  `px-6 py-4` wrapper.
- **Contrast tuning**: dark-mode `--fg-subtle` lifted 0.55 → 0.62
  oklch (hint text over muted surfaces was borderline), light-mode
  `--success` darkened for the new 10px delta text, and focus-visible
  outlines now also cover links, selects, and `tabindex` elements —
  the sidebar navigation had no ring at all.
- **`prefers-reduced-motion` is honored**: skeleton shimmer, dialog
  animations, and both Recharts series animations shut off.

### Fixed

- **Dialog open/close animations never ran.** `Dialog.tsx` used
  `animate-in`/`fade-in-0`/`zoom-in-[0.98]` utility classes from a
  Tailwind plugin that was never installed, so every dialog since
  v0.1.0 popped in with no motion. Replaced with first-party
  keyframes in the Tailwind 4 theme (140ms in, 100ms out).
- **"Welcome to Hikari" flashed on every unlock.** The empty-vault
  check treated still-loading queries (`undefined`) as an empty
  vault, so the onboarding card blinked before data arrived. Loading
  now renders skeletons; the welcome only appears once the vault is
  confirmed empty.
- **Donut slice angles didn't match the legend percentages** on any
  vault with more than six active categories (see the "Others" slice
  above).

### Under the hood

- New primitives: `Skeleton`, `EmptyState`, `PageHeader`,
  `DeltaBadge`, `Sparkline` (hand-rolled SVG — Recharts would be
  overkill for 12 points), `CardFilterChips`, `ChartTooltip`.
- New helpers: `shiftYearMonth` (promoted from MonthPicker) and
  `periodBounds` — the inverse of `statementPeriod`, clamped at month
  edges so a closing day past the end of a short month resolves the
  same way the Rust side buckets it.
- Every frontend sum follows the backend's sign rule (refunds stored
  positive with `is_refund=true` subtract from aggregates), and all
  period comparisons are statement-aware when a card filter is
  active.
- The whole round was reviewed by an adversarial multi-agent pass
  before release; eleven confirmed findings (year-mode pace counting
  future parcelas, Space-on-checkbox hijack, reduced-motion selectors
  that never matched, skeleton unmounting the filter chips mid-click,
  contrast misses) were fixed in the final commit.

## [0.1.8] — 2026-04-27

### Added

- **Yearly view.** A new "M / Y" toggle next to the period picker on
  Dashboard and Transactions. In year mode:
  - Dashboard shows year-total, a 12-bar bar chart of monthly spending,
    and the top categories aggregated for the whole year. Click a bar
    to drill into that month (flips the toggle back to month mode).
  - Transactions lists every row in the year (still sorted, filtered,
    and bulk-actionable like the monthly view).
  - Single-card view honors the closing-day pivot — a row dated 17/12
    with closing day 16 lands in the next year's January for that
    card's totals.
  - Backend: new `transactions_year_summary` IPC + `year` filter on
    `transactions_list`, both with the same statement-period awareness
    as the monthly endpoints.
- **Card closing-day cascade undo.** Editing a card's closing day
  cascades through every transaction's `statement_year_month`. The new
  flow snapshots each affected row's exact period before the cascade
  fires (catching values the import path had hand-stamped from a
  Sofisa header), runs the update, and pushes a HistoryOp whose undo
  replays the captured pre-state via a new
  `transactions_bulk_set_statement_periods` IPC. Redo replays the
  post-state snapshot. Toast Undo and Ctrl+Z both work.

### Changed

- **Toast "Desfazer" uses a singleton id.** Previously each undo toast
  carried the op's id, so two could coexist within the 7-second window
  — clicking the older one would silently undo the *newer* op (whatever
  was on top of the stack). Now each new call replaces the prior toast
  in place, keeping the surface honest.

## [0.1.7] — 2026-04-27

### Added

- **Undo across destructive operations.** Two surfaces feeding the same
  history stack:
  - **Toast "Desfazer" (7-second window).** Every successful destructive
    action now shows a Sonner toast with an Undo button. Click it to
    revert the action — same machinery as Ctrl+Z, just a faster path
    for the immediate-regret case.
  - **Global Ctrl+Z / Ctrl+Y.** App-wide multi-level undo/redo stack.
    Ctrl+Z (or Cmd+Z on macOS) reverts the most recent op, Ctrl+Y or
    Ctrl+Shift+Z replays it. Up to 50 ops kept; cleared on vault relock
    so the stack never carries over to a different unlock session.
    Skipped when focus is in an input/textarea so native text-editing
    undo still works.

  Operations covered: single tx delete, bulk delete, delete cascade
  (parcelas / same-name), bulk update (rename + categorize cascade),
  single tx edit save, import commit (the whole fatura rolls back at
  once via a new `transactions_remove_by_import` IPC), card delete
  (full card + every tx of that card cascade-restored), category
  delete (category + every affected tx's categoryId restored).

### Backend

- **`transactions_restore`** + **`transactions_remove_by_import`** IPCs;
  re-insert rows with their original ids (incl. `statement_year_month`
  and `source_import_id`) and bulk-drop a whole import in one shot.
- **`cards_restore`** and **`categories_restore`** preserve the
  original id so cascade-restored transactions still satisfy the FK.
- **`ImportResult.import_id`** now returned from `import_commit` so the
  frontend can stash it for undo.

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

[0.1.9]: https://github.com/fxlipe124/hikari/releases/tag/v0.1.9
[0.1.8]: https://github.com/fxlipe124/hikari/releases/tag/v0.1.8
[0.1.7]: https://github.com/fxlipe124/hikari/releases/tag/v0.1.7
[0.1.6]: https://github.com/fxlipe124/hikari/releases/tag/v0.1.6
[0.1.5]: https://github.com/fxlipe124/hikari/releases/tag/v0.1.5
[0.1.4]: https://github.com/fxlipe124/hikari/releases/tag/v0.1.4
[0.1.3]: https://github.com/fxlipe124/hikari/releases/tag/v0.1.3
[0.1.2]: https://github.com/fxlipe124/hikari/releases/tag/v0.1.2
[0.1.1]: https://github.com/fxlipe124/hikari/releases/tag/v0.1.1
[0.1.0]: https://github.com/fxlipe124/hikari/releases/tag/v0.1.0
