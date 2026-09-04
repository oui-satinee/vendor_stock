# Vendor Stock Portal

Two related artifacts live in this repo:

1. **`vendor_stock_portal.*` + `VendorStockPortal.trex`** — a Tableau **Dashboard
   Extension**. Runs inside a Tableau dashboard, reads a worksheet's live data via
   the Extensions API, and renders the same look as `analytics_report.html`
   (dark header bar, KPI tiles, numbered sections, chart/table toggle per card)
   — KPIs, aging charts, branch breakdown, stock turnover, and a SKU detail
   table, all computed from live data. This is the one to use if you want the
   dashboard wired to a real Tableau data source.
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

### Data requirements

Point it at a worksheet containing SKU/branch-level stock rows with these
columns (name matching is fuzzy — `SUM(UR_AMT)`, `ur_amt`, `UR Amt` all match):

| Field | Required | Description |
|---|---|---|
| **BRANCH** | ✅ | Branch / store name |
| **ARTICLE_ID** | ✅ | SKU code |
| **UR_AMT** (or `UR_COST_AMT`) | ✅ | Stock value |
| **UR_QTY** | ✅ | Stock quantity |
| **CLASS_STOCK** | recommended | Class A/B/C/Dead/New/... — powers the Dead Stock KPI and class×aging chart |
| **AGING_TIER** or **AGING** (numeric days) | recommended | Powers the aging-tier chart and the Aging&gt;180 Days KPI |
| ARTICLE_NAME_TH, BRAND, MCH3, MCH2, MCH1, MC, ITEM_FLAG | optional | Shown in the SKU detail table / MC breakdown table |
| IS_DC | optional | Marks distribution-center branches — enables the "Exclude DC" toggle |
| VENDOR_NAME | optional | Used as the dashboard title if present |
| AVG_DAILY (average daily quantity sold) | optional | Enables the whole **Stock Turnover** section (branch/MCH3/Brand chart + MC breakdown table); section is hidden entirely if this column isn't present |

If `AGING_TIER` isn't in the source, the extension buckets the numeric `AGING`
(days) column into the same 8 tiers as the legacy report
(0–60, 61–90, 91–120, 121–150, 151–180, 181–270, 271–360, >361 days).

Turnover is expressed as **days of supply** (`UR_QTY ÷ AVG_DAILY`), matching
the legacy report's definition — not a computed sales-turnover ratio, since
that requires a sales fact table this single worksheet doesn't have.

### Production (GitHub Pages) — current default

`VendorStockPortal.trex` points at the published GitHub Pages URL:

```
https://oui-satinee.github.io/vendor_stock/vendor_stock_portal.html
```

GitHub Pages is already enabled for this repo (Settings → Pages → branch
`main` / root). This works from any machine with Tableau Desktop — no local
server needed. In Tableau Desktop: open a workbook with vendor stock data →
build a dashboard containing that worksheet → **Objects → Extensions** → pick
`VendorStockPortal.trex` → in the extension's **Settings** panel, select the
worksheet and click **Load data**.

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
- **01 — Stock Aging**: KPI row (total value, UR_QTY, SKU count, dead stock, aging>180d) + aging-tier bar chart + class×aging stacked bar chart with legend
- **02 — Stock by Branch**: bar chart (toggle UR_AMT / UR_QTY), "Exclude DC" filter when a DC flag is present, CSV export
- **03 — Stock Turnover** (only shown when `AVG_DAILY` is present): branch/MCH3/Brand dimension-toggle chart, and an MC breakdown table with a 6-way dimension toggle (MCH3/MCH2/MCH1/MC/Brand/CLASS_STOCK) — both with CSV export
- **04 — SKU Detail**: searchable/sortable table with CSV export
- A header "Export" button producing a multi-sheet `.xls` (stock detail, branch summary, and turnover sheets when available) — same approach as the legacy report's full export
- Auto-refresh on Tableau filter changes; worksheet selection persists in the workbook

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

The extension currently reads the **Stock Aging** grain (the richest single
table); turnover (`T_O`) and cross-vendor rollups aren't wired in yet since they
need a second worksheet/table.

## License

MIT
