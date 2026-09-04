# Vendor Stock Portal

Two related artifacts live in this repo:

1. **`vendor_stock_portal.*` + `VendorStockPortal.trex`** — a Tableau **Dashboard
   Extension**. Runs inside a Tableau dashboard, reads a worksheet's live data via
   the Extensions API, and renders KPIs / aging charts / branch breakdown / SKU
   detail table from it. This is the one to use if you want the dashboard wired
   to a real Tableau data source.
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
| ARTICLE_NAME_TH, BRAND, MCH3, MCH2, MCH1, ITEM_FLAG | optional | Shown in the SKU detail table |
| IS_DC | optional | Marks distribution-center branches — enables the "Exclude DC" toggle |
| VENDOR_NAME | optional | Used as the dashboard title if present |

If `AGING_TIER` isn't in the source, the extension buckets the numeric `AGING`
(days) column into the same 8 tiers as the legacy report
(0–60, 61–90, 91–120, 121–150, 151–180, 181–270, 271–360, >361 days).

### Development (localhost)

1. Serve this folder locally:
   ```bash
   npx http-server -p 8765 --cors
   ```
2. `VendorStockPortal.trex` already points at `http://localhost:8765/vendor_stock_portal.html` — no edits needed for local testing.
3. In Tableau Desktop: open a workbook with vendor stock data → build a dashboard containing that worksheet → **Objects → Extensions** → pick `VendorStockPortal.trex`.
4. In the extension's **Settings** panel, select the worksheet and click **Load data**.

### Production (GitHub Pages)

1. Enable GitHub Pages for this repo (Settings → Pages → branch `main` / root).
2. Edit the `<url>` in `VendorStockPortal.trex` to the published Pages URL, e.g.
   ```
   https://oui-satinee.github.io/vendor_stock/vendor_stock_portal.html
   ```
3. Re-import the updated `.trex` into the dashboard.

### Features

- Column auto-detect — no manual field mapping
- KPIs: total stock value, SKU count, branch count, dead stock value/%, aging>180 days value/%
- Aging-tier bar chart + class×aging stacked bar chart
- Stock-by-branch chart (toggle UR_AMT / UR_QTY), with an "Exclude DC" filter when a DC flag is present
- Searchable/sortable SKU detail table with CSV export
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
