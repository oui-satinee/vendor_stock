# Vendor Stock Portal — display template

`vendor-stock-portal-template.html` is the UI/layout structure of the Vendor Stock
Portal dashboard, with all real business data stripped out and replaced by small
placeholder rows. Open it directly in a browser — no build step, no external
script dependency.

The two JS objects `vendorProfile` and `companyProfile` (near the top of the
`<script>` block) are the only things that need to be replaced with a real data
feed. Everything else (CSS, charts, tables, CSV/XLS export) is generic and reads
from those two objects.

## Data contract

Two grains of data feed this dashboard:

- **`vendorProfile`** — single vendor, SKU/branch-level detail
- **`companyProfile`** — portfolio rollup across all vendors

| Object key | Shape | Source columns |
|---|---|---|
| `exportStockByBranch` | array of arrays | `BRANCH, ARTICLE_ID, ARTICLE_NAME_TH, MCH3, ITEM_FLAG, UR_QTY, UR_COST_AMT` |
| `exportStockAging` | array of arrays | `BRANCH, ARTICLE_ID, ARTICLE_NAME_TH, BRAND, MCH3, MCH2, TILE_SIZE, ITEM_FLAG, AGING_TIER, CLASS_STOCK, AGING, UR_AMT, UR_QTY, RESERVE_AMT, RESERVE_QTY, REMAIN_AMT, REMAIN_QTY` |
| `exportTurnover` | array of arrays | `BRANCH, MCH3, UR_QTY, T_O, UR_QTY_DEAD, PCT_DEAD, T_O_VENDOR` |
| `exportTurnoverBrand` | array of arrays | `MCH3, BRAND, CLASS_STOCK, UR_QTY, T_O, T_O_BRAND` |
| `mcDimTO`, `branchMchBrandTO`, `branches`, `classStock`, `agingLeaves` | arrays of objects | pre-aggregated rollups derived from the tables above |
| `companyProfile.deadVendors`, `.slowVendors`, `.branches`, `.agingTiers`, `.classStock` | arrays of objects | same rollups, aggregated across all vendors |

See the full field list and recommended Tableau data-source design in the
project chat / data dictionary shared alongside this repo.
