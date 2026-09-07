# Vendor Stock Portal

Two related artifacts live in this repo:

1. **`vendor_stock_portal.*` + `VendorStockPortal.trex`** — a Tableau **Dashboard
   Extension**. Runs inside a Tableau dashboard, reads worksheet data live via
   the Extensions API, and renders the same look as `analytics_report.html`
   (dark header bar, KPI tiles, numbered sections, chart/table toggle per card)
   — KPIs, aging charts, branch breakdown, and stock turnover, all computed
   from live data. This is the one to use if you want the dashboard wired to
   a real Tableau data source.
2. **`vendor-stock-portal-template.html`** — a static, standalone HTML mockup of
   the same layout with placeholder data. Useful for showing the visual design
   without opening Tableau.

## Tableau Dashboard Extension — setup

### File layout

```
VendorStockPortal.trex             # extension manifest
vendor_stock_portal.html           # extension UI (HTML + CSS)
vendor_stock_portal.js             # extension logic (IIFE)
tableau.extensions.1.latest.js     # Tableau Extensions API (local copy)
```

### Data requirements — four worksheets, looked up by name

No manual worksheet picker. The extension looks for worksheet objects on the
dashboard by **exact name (case-insensitive)** — two "summary" sheets that
drive the on-screen dashboard, and two "detail" sheets used only for the
full-export download:

| Worksheet name | Role | Grain |
|---|---|---|
| **`aging`** | Feeds the KPI row + section **01 — Stock Aging** | **Pre-aggregated summary** — no `ARTICLE_ID` needed. Recommended grain: `CLASS_STOCK × AGING_TIER` (or `× BRANCH` too, if you want it) |
| **`stock`** | Feeds section **02 — Stock by Branch** + section **03 — Stock Turnover** | **Pre-aggregated summary** — no `ARTICLE_ID` needed. Recommended grain: `BRANCH × MCH3 × BRAND` |
| **`aging_detail`** | Only read when the header **Export** button is clicked | Full SKU-level detail (one row per `BRANCH × ARTICLE_ID`) |
| **`stock_detail`** | Only read when the header **Export** button is clicked | Full SKU-level detail (one row per `BRANCH × ARTICLE_ID`) |

Why split summary/detail: the two **summary** sheets are what loads every time
the dashboard opens or a Tableau filter changes, so keeping them pre-aggregated
(few rows, no SKU grain) makes that fast. The **detail** sheets carry the full
SKU-level data and are only pulled on demand when you click Export — they're
never loaded just to render the charts.

Any of the four can be missing independently:
- Missing `aging` and/or `stock` → the corresponding on-screen section(s) just
  don't render (non-blocking error banner names which one). If both are
  missing, nothing renders.
- Missing `aging_detail` and/or `stock_detail` → clicking Export skips that
  part of the workbook (or shows an error if neither exists), but the
  dashboard itself is unaffected — these sheets are never touched otherwise.

Column matching within each sheet is fuzzy — `SUM(UR_AMT)`, `ur_amt`, `UR Amt`
all match the same field:

| Field | Required | Description |
|---|---|---|
| **BRANCH** | ✅ (except a branch-less `aging` summary) | Branch / store name |
| **ARTICLE_ID** | ✅ on the `_detail` sheets only | SKU code — omit entirely on the summary sheets |
| **UR_AMT** (or `UR_COST_AMT`) | ✅ | Stock value |
| **UR_QTY** | ✅ | Stock quantity |
| **CLASS_STOCK** | recommended (`aging`) | Class A/B/C/Dead/New/... — powers the Dead Stock KPI and class×aging chart |
| **AGING_TIER** or **AGING** (numeric days) | recommended (`aging`) | Powers the aging-tier chart and the Aging&gt;180 Days KPI |
| **SKU_COUNT** (or `DISTINCT_SKU`, a `COUNTD(ARTICLE_ID)` calculated field) | recommended on `aging`/`stock` (the summary sheets) | Since a pre-aggregated summary has no `ARTICLE_ID`, this feeds the "SKU Count" KPI and each branch's SKU count. Falls back to counting distinct `ARTICLE_ID` when absent (i.e. on the `_detail` sheets, or if you point a full-grain sheet at `aging`/`stock` directly). **Caveat:** summing this per group over-counts a SKU that appears in multiple groups (e.g. the same article in several branches) — acceptable for a KPI, not a substitute for a true portfolio-wide distinct count |
| ARTICLE_NAME_TH, BRAND, MCH3, MCH2, MCH1, MC, ITEM_FLAG | optional | Shown in the MC breakdown table / full export |
| IS_DC | optional | Marks distribution-center branches — enables the "Exclude DC" toggle, which filters all four sheets together. Not required: a branch whose name contains the word "DC" (e.g. `DC รังสิต`) is auto-flagged even with no such column |
| VENDOR_NAME | optional | Used as the dashboard title if present (checked on `aging` first, then `stock`) |
| **T_O** (or `T_O_VENDOR`/`T_O_BRAND`) — preferred — or **AVG_DAILY** (average daily quantity sold) | optional (`stock`) | Feeds the turnover-days figure in section 03; the section is always shown when `stock` is found — without either column, turnover just reads 0 |

If `AGING_TIER` isn't in the source, the extension buckets the numeric `AGING`
(days) column into the same 8 tiers as the legacy report
(0–60, 61–90, 91–120, 121–150, 151–180, 181–270, 271–360, >361 days).

Turnover is expressed as **days of supply**. If the sheet has a direct
`T_O`-style column (matching the legacy report's own turnover column), that
value is used as-is per row, and rows are combined with a qty-weighted
aggregation when grouped (`sum(qty) ÷ sum(qty/T_O)`, so a group's turnover
isn't just a naive average of its rows' T_O values). Without a `T_O` column,
it falls back to computing `UR_QTY ÷ AVG_DAILY` instead.

### Production (GitHub Pages) — current default

`VendorStockPortal.trex` points at the published GitHub Pages URL:

```
https://oui-satinee.github.io/vendor_stock/vendor_stock_portal.html
```

GitHub Pages is already enabled for this repo (Settings → Pages → branch
`main` / root). This works from any machine with Tableau Desktop — no local
server needed. In Tableau Desktop: open a workbook with vendor stock data →
build a dashboard containing worksheets named `aging`/`stock` (and
`aging_detail`/`stock_detail` if you want the full export to work) →
**Objects → Extensions** → pick `VendorStockPortal.trex`.

**No configuration step** — the extension finds the worksheets by name (see
Data requirements above) and loads them automatically.

**Caveat:** every push to `main` updates the live Pages URL (usually within a
minute). Re-adding the extension always fetches the latest version — there's
no version pinning.

### Development (localhost)

To iterate on the extension itself without publishing every change:

1. Serve this folder locally:
   ```bash
   npx http-server -p 8765 --cors
   ```
2. Temporarily edit the `<url>` in `VendorStockPortal.trex` back to
   `http://localhost:8765/vendor_stock_portal.html`.
3. Re-import the `.trex` into the dashboard, iterate, then revert the URL to
   the GitHub Pages one (and push) when done.

### Features

Visual design and section layout match `analytics_report.html` exactly (same
CSS, same "01 — Stock Aging" / "02 — Stock by Branch" / "03 — Stock Turnover"
section-kicker style, same chart-card "View table" toggle, same tooltip):

- Column auto-detect — no manual field mapping
- Four worksheets (`aging`, `stock`, `aging_detail`, `stock_detail`) looked up by name — each is independent, so any can be absent without breaking the others
- **01 — Stock Aging** (from `aging` summary): KPI row (total value, UR_QTY, SKU count, dead stock, aging>180d) + aging-tier bar chart + class×aging stacked bar chart with legend
- **02 — Stock by Branch** (from `stock` summary): bar chart (toggle UR_AMT / UR_QTY), "Exclude DC" filter when a DC flag is present, CSV export
- **03 — Stock Turnover** (from `stock` summary): branch/MCH3/Brand dimension-toggle chart, and an MC breakdown table with a 6-way dimension toggle (MCH3/MCH2/MCH1/MC/Brand/CLASS_STOCK) — both with CSV export. Turnover reads 0 without a `T_O` or `AVG_DAILY` column
- A header "Export" button that lazily loads `aging_detail`/`stock_detail` (only on click, never for the on-screen charts) and produces a multi-sheet `.xls` (SKU-level aging detail, branch summary, and turnover sheets, each included only when its source sheet was found)
- No configuration UI — auto-loads the named worksheets; auto-refreshes on Tableau filter changes on any worksheet on the dashboard

## Data dictionary (legacy report → Tableau data source)

The original hardcoded dashboard (`vendor-stock-portal-template.html`'s data
shape) pulled from these underlying tables — useful as a reference when building
the Tableau data source that feeds the extension above:

| Table | Grain | Columns |
|---|---|---|
| Stock by Branch | SKU × branch (snapshot) | `VENDOR_ID, VENDOR_NAME, BRANCH, ARTICLE_ID, ARTICLE_NAME_TH, MCH3, ITEM_FLAG, UR_QTY, UR_COST_AMT` |
| Stock Aging | SKU × branch × aging tier | `VENDOR_ID, VENDOR_NAME, BRANCH, ARTICLE_ID, ARTICLE_NAME_TH, BRAND, MCH3, MCH2, TILE_SIZE, ITEM_FLAG, AGING_TIER, CLASS_STOCK, AGING, UR_AMT, UR_QTY, RESERVE_AMT, RESERVE_QTY, REMAIN_AMT, REMAIN_QTY` |
| Turnover by Branch | branch × MCH3 | `VENDOR_ID, VENDOR_NAME, BRANCH, MCH3, UR_QTY, T_O, UR_QTY_DEAD, PCT_DEAD, T_O_VENDOR` |
| Turnover by Brand | MCH3 × brand × class | `VENDOR_ID, VENDOR_NAME, MCH3, BRAND, CLASS_STOCK, UR_QTY, T_O, T_O_BRAND` |

The extension's `aging_detail`/`aging` map to the **Stock Aging** grain above
(the detail sheet at full SKU grain, the summary sheet pre-aggregated from
it), and `stock_detail`/`stock` map to **Stock by Branch** plus the legacy
`T_O` column for turnover. Cross-vendor rollups still aren't wired in — that
would need a fifth worksheet.

## License

MIT
