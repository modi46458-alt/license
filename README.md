# IndiaMART Smart Lead Intelligence

Chrome extension (Manifest V3) that will scan, score and classify leads in
IndiaMART Lead Manager. Actions on IndiaMART stay under the user's control:
automation is off by default and nothing is clicked without a policy allowing it.

## Status: v0.6.1 (event-based Auto-Click, license lock)

Working now:

- Scanner: initial scan, MutationObserver batching, per-card isolation, SPA handling
- Card detection by upward signal walk with weighted confidence (verified wrapper not yet captured)
- Extraction: title, country, lead age, breadcrumbs, quantity, strength, dosage form,
  quantity per strip, buyer products, contact availability (never values)
- Engagement: returns nulls with `verified: false` until its markup is inspected
- Every field ends in one state: `found`, `missing` (absent from the card, normal) or
  `failed` (present but unreadable). Only `failed` is logged as an extraction failure
- Two separate scores: `confidence` (how reliably present fields were read) and
  `completeness` (share of core fields present)
- Fingerprint de-duplication (LRU, 5,000 leads per tab session); a card that finishes
  rendering or changes details is reported as `LEAD_UPDATED` with the same lead id
- Popup: scanner status, counters, bounded live log (200 lines), developer diagnostics
  behind a "Show developer diagnostics" switch
- Read-only: no clicks, no contact, no network calls, nothing leaves the tab

- Normalization (`src/core/normalization`): pure, deterministic `normalizeLead()` turns each
  extracted lead into a filter-ready `NormalizedLead` (country + ISO code, canonical units,
  strength with secondary values, dosage form, tokens, lead-age minutes). Raw values are kept

- Filters (`src/core/filters`): every new or updated lead is marked MATCHED or REJECTED with
  typed reasons. See "Filters" below.

- Scoring (`src/core/scoring`): every MATCHED lead gets a 0–100 score, a priority and typed
  reasons. See "Scoring" below.

Not yet: highlighting, analytics dashboard, automation (Phases 6+).

## Filters

Pipeline: DOM → extractor → raw lead → normalizer → `NormalizedLead` → **filter engine** →
`FilterEvaluation` → scanner counters, log and popup. The engine is pure: it reads only the
normalized lead and the config, never the page, the clock or the network.

### FilterConfig (version 1, stored in `chrome.storage.sync` under `filters.config`)

| Group            | Settings                                                                        |
| ---------------- | ------------------------------------------------------------------------------- |
| Countries        | terms, mode ANY/ALL (names, aliases or ISO codes: `USA`, `United States`, `US`) |
| Product keywords | terms, mode ANY/ALL, fields: title, category, product category, buyer products  |
| Exclude keywords | terms, fields                                                                   |
| Quantity         | min, max (either optional)                                                      |
| Contact          | mobile, WhatsApp, email; mode ANY/ALL                                           |
| Lead age         | min/max minutes                                                                 |
| Logic            | AND / OR across groups                                                          |

Each term can be switched off without deleting it. Invalid or missing stored config falls back
to the defaults; an invalid config is never saved.

### ANY / ALL / AND / OR / NOT

- **ANY** (within a group): one enabled term is enough. **ALL**: every enabled term must match.
  Country ALL with more than one country can never pass, since a lead has one country.
- **AND** (across groups): every applied group must pass. **OR**: at least one must pass.
- **NOT**: excluded keywords reject the lead in both modes, even when everything else passes.
- A group that is on but has nothing selected is skipped (reported as info), not failed.
- Master switch off: every lead is MATCHED with a "filters are off" reason.

### Matching rules

- Keywords match whole words, case-insensitively, with regular plurals (`tablet` ⇄ `Tablets`,
  `box` ⇄ `boxes`). `Tablet` never matches `Tabletop`; `Personal Use` never matches
  `Personal User`. A phrase never spans two buyer products. No fuzzy matching or synonyms.
- Countries compare ISO codes when both sides have one, otherwise the cleaned name.
- Missing data is never guessed: an unknown country, a missing or range quantity
  (`10-20 Strips`), or an unconvertible lead age fails that group when it is on.
- Quantity compares numbers only; units are not converted (`1 Kg` is 1).

### Examples

`Propranolol Tablets`, United States, 30 Strip, WhatsApp + Email, default filters:
**MATCHED** — Country matched: United States; Keyword matched: Tablet (title); Quantity 30 Strip
≥ 20; Contact: WhatsApp, Email available.

`Planep 25 mg Tablet`, Saudi Arabia, 10 Strip: **REJECTED** — Country not allowed: Saudi
Arabia; Quantity 10 < minimum 20. Every failing group is reported, not only the first.

### Read-only guarantee

Filtering only labels leads in the extension's own UI. Nothing on IndiaMART is clicked,
shortlisted, hidden, contacted or sent anywhere.

## Commands

```bash
npm install
npm run validate      # typecheck + lint + tests + build
npm run build         # production build → dist/
npm run dev           # rebuild popup/worker on change (content script: npm run build:content)
npm test
```

Load in Chrome: `chrome://extensions` → Developer mode → Load unpacked → select `dist/`.
Tabs opened before installing need a reload before the page reader connects.

## Selector adapter

All IndiaMART-specific DOM knowledge lives in one file:
`src/content/selectors/indiamart-selectors.ts`. Each field is an ordered list of
strategies (primary CSS → semantic text → structural) with a confidence value.
`verified: false` marks fields whose text was observed but whose markup was not
supplied (engagement counts). The test fixture in `src/tests/fixtures` is built
from the inspected fragments; its outer `<article>` wrapper is synthetic.

When IndiaMART changes its markup: update the adapter and the fixture, run `npm test`.

Pending verification (set in the adapter once inspected, no scanner changes needed):

- `LEAD_CARD.containerSelector`: the real card wrapper
- `ENGAGEMENT.containerSelector`: the Requirements / Calls / Replies block
- `INDIAMART_PAGE.supportedPaths`: confirmed Lead Manager / Buy Leads paths

## Layout

```
public/manifest.json, icons/
src/background/      service worker + message router (no DOM)
src/content/         content script entry
  selectors/         IndiaMART adapter + generic resolver
  scanner/           lead scanner, card detector, mutation queue, metrics, log, page detector
  extraction/        lead, contact and engagement extractors
src/core/            types, parsing (quantity, strength, lead age), fingerprinting
src/popup/           React popup
src/shared/          message contract, messaging helpers, error types
src/tests/fixtures/  DOM fixtures
```

Further folders from the architecture plan are added in the phase that fills them.

## Scoring

Pipeline: `NormalizedLead` → filter engine → **MATCHED?** → yes: scoring engine → score 0–100 →
priority → reasons; no: `score: null`, priority `REJECTED`. The engine is pure (no page, clock,
network or randomness). The score measures lead quality under your rules; it is not a
confidence or a probability.

### States (never merged)

| State                          | Meaning                 | Score  |
| ------------------------------ | ----------------------- | ------ |
| REJECTED                       | failed the filters      | `null` |
| UNSCORED                       | matched, scoring is off | `null` |
| LOW / MEDIUM / HIGH / CRITICAL | matched and scored      | 0–100  |

A rejected lead is never shown or averaged as 0.

### Formula

```
points(c) = weight(c) × fraction(c)        fraction in [0, 1]
score     = round(Σ points / Σ weights × 100)
```

| Component      | Default weight | fraction                                                                  |
| -------------- | -------------- | ------------------------------------------------------------------------- |
| Country        | 25             | 1 if the filter matched the country (filter off: 1 if a country is known) |
| Quantity       | 20             | min(quantity / 100, 1); 0 if unknown or a range                           |
| WhatsApp       | 15             | 1 if available                                                            |
| Mobile         | 10             | 1 if available                                                            |
| Email          | 10             | 1 if available                                                            |
| Keyword        | 8              | 1 if the filter matched any keyword (counted once)                        |
| Category       | 5              | 1 if category or product category is present (counted once)               |
| Lead age       | 4              | ≤15 min 1 · ≤60 0.75 · ≤180 0.5 · ≤1440 0.25 · older 0                    |
| Buyer products | 3              | 1 if the buyer lists any product                                          |

Defaults total 100, so the score equals the points earned. Other totals are scaled to 0–100
(the popup says so). Points are kept to two decimals; the final score uses `Math.round`
(halves round up), so the same lead always gets the same score and priority.

Priority thresholds (configurable, must be Critical > High > Medium): Critical ≥ 90,
High ≥ 75, Medium ≥ 50, Low below 50.

Keyword and country points reuse the filter engine's result, so filtering and scoring never
disagree. Approximate lead ages (months, years) score 0 unless allowed in settings.

### Example

USA, "Propranolol Tablets", 50 Strip, WhatsApp + Email, no category or age:
+25 country, +10 quantity (50/100), +15 WhatsApp, +10 email, +8 keyword = **68, MEDIUM**.

### Settings

Stored in `chrome.storage.sync` under `scoring.config` (version 1), validated on every read;
invalid or missing settings fall back to the defaults, and invalid settings are never saved.
Saving re-scores remembered leads immediately; changing filters re-filters and re-scores.

### Limitations

- Quantity is unit-agnostic: 50 Kg and 50 Box score the same. No unit conversion.
- Buyer products score on presence, not relevance.
- Lead age is the age when the lead was read.

## Contact Buyer button (resolution only)

`src/content/automation/contact-buyer-resolver.ts` finds the Contact Buyer button for one lead
card and verifies it; it never clicks. The future action engine (Phase 8) will call it right
before a user-approved click and report `ACTION_FAILED` with `ACTION_NOT_FOUND` or
`IDENTITY_MISMATCH` whenever it refuses.

- Verified reference (kept as documentation only): `#BLCard1 > div.SLC_dflx.SLC_.pr > button > strong`.
  The card number is never used; `[id^="BLCard"]` marks the card wrapper.
- Production resolution, inside the identified card only: `div.SLC_dflx.SLC_.pr > button`
  with "Contact Buyer" text, then a text fallback (a `button` reading Contact Buyer).
- Refuses unless: the card is on the page, holds exactly one lead, still shows the expected
  title, has exactly one Contact Buyer button, the button is in this card's wrapper, visible and
  enabled.
- Developer diagnostics report found / not found / mismatch counts for every new or updated card.

## Auto-Click (Contact Buyer only): event-based

```
Logical lead identity → Lead Registry / duplicate detection
Filter evaluation     → MATCHED / REJECTED
MATCHED evaluation    → new matchEventId (never the lead id, never reused)
matchEventId          → at most one Contact Buyer action
```

- ON by default; one ON/OFF toggle; no Start, no confirmation, no score or priority threshold.
- A match event is created when the scanner evaluates a lead and the filters say MATCHED:
  a new lead, an updated lead (LEAD_UPDATED), or a lead that becomes MATCHED after a filter
  change. A duplicate DOM copy, or a DOM change that leaves the lead's data unchanged, is not
  evaluated again and creates no event. Re-applying filters does not create events for leads
  that were already MATCHED.
- The same matchEventId delivered twice → one action. Different ids → separate actions, even
  for the same lead (MATCHED → REJECTED → MATCHED clicks twice). There is no permanent
  "already contacted" rule, and a page reload evaluates leads afresh (new events).
- Events that arrive while Auto-Click is OFF, locked (license) or on standby are not queued.
- Before every click: Auto-Click ON, license ACTIVE (re-validated with the server when the last
  answer is older than 60 s), lead still on the page and still MATCHED, and the Contact Buyer
  resolver proves the button belongs to that lead (its BLCard block, its title) and is visible
  and enabled. Any failed check → no click, reason recorded.
- One click at a time; delay 500 / 750 / 1000 (default) / 1500 / 2000 ms between clicks.
  Retries only before a click (button not found yet, card re-rendering); never after one.
- STOP AUTOMATION (popup, Auto-Click tab, red bar on the page) cancels the queue and any pending
  click or retry and saves Auto-Click OFF. One IndiaMART tab clicks at a time (others stand by).
- Action records: matchEventId, lead id + fingerprint, timestamps, status, resolver result,
  error code and message.
- `click()` exists only in `contact-buyer-executor.ts` (enforced by a test).

## License (remote lock)

The license server is the authority; the extension caches the last verified answer.

- States: ACTIVE, EXPIRED, DISABLED, SUSPENDED, REVOKED, UNREGISTERED, NETWORK_ERROR.
- Central gate (`src/core/license`): `isLicenseActive()`, `getLicenseState()`,
  `requireActiveLicense()`. Scanner and Auto-Click ask it synchronously; no request per lead.
- The service worker validates at startup, on popup open, on IndiaMART page activation, when
  Auto-Click turns on, before a click (if the last answer is older than 60 s), on reconnect and
  every 5 minutes (alarm). Admin changes are also pushed over a WebSocket in real time.
- Not ACTIVE → the scanner disconnects its observer and clears its queue, Auto-Click cancels
  queued actions, the delayed next click and any retry; the gate is checked again immediately
  before each click.
- Offline: an ACTIVE license keeps working for 24 hours after the last server answer (never past
  its expiry), then locks with "LICENSE VALIDATION REQUIRED". A clock turned back voids the
  cached answer.
- Build with the server URL: `VITE_LICENSE_API_URL=https://license.example.com npm run build`
  (written into `host_permissions`). No secret is shipped in the extension.
- Server: see `server/README.md`.

## Benchmark

`npm run bench` (jsdom; compare builds on the same machine, not with Chrome numbers).
