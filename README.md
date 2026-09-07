# Vendor Stock Portal

Two related artifacts live in this repo:

1. **`vendor_stock_portal.*` + `VendorStockPortal.trex`** — a Tableau **Dashboard
   Extension**. Runs inside a Tableau dashboard, reads a worksheet's live data via
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

### Data requirements — two worksheets, looked up by name

No manual worksheet picker. The extension looks for two worksheet objects on
the dashboard by **exact name (case-insensitive)**:

| Worksheet name | Feeds | Notes |
|---|---|---|
| **`aging`** | KPI row + section **01 — Stock Aging** | Needs `CLASS_STOCK`/`AGING_TIER`/`AGING` |
| **`stock`** | section **02 — Stock by Branch** + section **03 — Stock Turnover** | Needs `BRAND`/`MCH3`/etc. for the breakdown dimensions |

Either can be missing — the corresponding section(s) just don't render (a
non-blocking error banner names which one), so a dashboard with only one of
the two still shows a partial view. If neither is found, nothing renders.

Column matching within each sheet is fuzzy — `SUM(UR_AMT)`, `ur_amt`, `UR Amt`
all match the same field:

| Field | Required | Description |
|---|---|---|
| **BRANCH** | ✅ | Branch / store name |
| **ARTICLE_ID** | ✅ | SKU code |
| **UR_AMT** (or `UR_COST_AMT`) | ✅ | Stock value |
| **UR_QTY** | ✅ | Stock quantity |
| **CLASS_STOCK** | recommended (`aging` sheet) | Class A/B/C/Dead/New/... — powers the Dead Stock KPI and class×aging chart |
| **AGING_TIER** or **AGING** (numeric days) | recommended (`aging` sheet) | Powers the aging-tier chart and the Aging&gt;180 Days KPI |
| ARTICLE_NAME_TH, BRAND, MCH3, MCH2, MCH1, MC, ITEM_FLAG | optional | Shown in the MC breakdown table (`stock` sheet) |
| IS_DC | optional | Marks distribution-center branches — enables the "Exclude DC" toggle, which filters both sheets together. Not required: a branch whose name contains the word "DC" (e.g. `DC รังสิต`) is auto-flagged even with no such column, matching the naming convention the legacy report relied on |
| VENDOR_NAME | optional | Used as the dashboard title if present (checked on the `aging` sheet first, then `stock`) |
| AVG_DAILY (average daily quantity sold) | optional (`stock` sheet) | Feeds the turnover-days figure in section 03; the section is always shown when the `stock` sheet is found — without this column, turnover just reads 0 |

If `AGING_TIER` isn't in the source, the extension buckets the numeric `AGING`
(days) column into the same 8 tiers as the legacy report
(0–60, 61–90, 91–120, 121–150, 151–180, 181–270, 271–360, >361 days).

Turnover is expressed as **days of supply** (`UR_QTY ÷ AVG_DAILY`), matching
the legacy report's definition — not a computed sales-turnover ratio, since
that requires a sales fact table the `stock` sheet doesn't have.

### Production (GitHub Pages) — current default

`VendorStockPortal.trex` points at the published GitHub Pages URL:

```
https://oui-satinee.github.io/vendor_stock/vendor_stock_portal.html
```

GitHub Pages is already enabled for this repo (Settings → Pages → branch
`main` / root). This works from any machine with Tableau Desktop — no local
server needed. In Tableau Desktop: open a workbook with vendor stock data →
build a dashboard containing that worksheet → **Objects → Extensions** → pick
`VendorStockPortal.trex`.

**No configuration step** — the extension looks for worksheet objects named
`aging` and `stock` on the dashboard (see Data requirements above) and loads
them both automatically.

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
- Two independent worksheets (`aging`, `stock`) looked up by name — each section only needs its own sheet to render; the other can be absent
- **01 — Stock Aging** (from `aging`): KPI row (total value, UR_QTY, SKU count, dead stock, aging>180d) + aging-tier bar chart + class×aging stacked bar chart with legend
- **02 — Stock by Branch** (from `stock`): bar chart (toggle UR_AMT / UR_QTY), "Exclude DC" filter when a DC flag is present, CSV export
- **03 — Stock Turnover** (from `stock`): branch/MCH3/Brand dimension-toggle chart, and an MC breakdown table with a 6-way dimension toggle (MCH3/MCH2/MCH1/MC/Brand/CLASS_STOCK) — both with CSV export. Turnover reads 0 without an `AVG_DAILY` column
- A header "Export" button producing a multi-sheet `.xls` (aging detail, branch summary, and turnover sheets, each included only when its source sheet was found)
- No configuration UI — auto-loads `aging`/`stock` by name; auto-refreshes on Tableau filter changes on any worksheet on the dashboard

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

The extension's `aging` worksheet maps to the **Stock Aging** grain above, and
`stock` maps to **Stock by Branch** (plus `AVG_DAILY` for the turnover
calculation, in place of the legacy `T_O` column). Cross-vendor rollups still
aren't wired in — that would need a third worksheet.

## License

MIT
