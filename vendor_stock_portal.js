// ═══════════════════════════════════════════════════════════════
// Vendor Stock Portal — Tableau Dashboard Extension
// vendor_stock_portal.js
// ═══════════════════════════════════════════════════════════════

(function () {
  "use strict";

  /* global tableau */

  // ─── Column Auto-Detect ───────────────────────────────────
  var COLUMN_MAP = {
    vendorId:    ["vendor_id", "vendorid"],
    vendorName:  ["vendor_name", "vendorname"],
    branch:      ["branch", "branch_name"],
    articleId:   ["article_id", "articleid", "sku", "sku_id", "item_code", "itemcode"],
    articleName: ["article_name_th", "article_name", "articlename", "product_name", "item_name", "description"],
    brand:       ["brand", "brand_name"],
    mch3:        ["mch3", "category"],
    mch2:        ["mch2"],
    mch1:        ["mch1"],
    mc:          ["mc", "item_group"],
    itemFlag:    ["item_flag", "itemflag"],
    classStock:  ["class_stock", "classstock", "class"],
    agingTier:   ["aging_tier", "agingtier"],
    aging:       ["aging", "aging_days", "agingdays"],
    urAmt:       ["ur_amt", "uramt", "ur_cost_amt", "urcostamt", "stock_value", "stockvalue"],
    urQty:       ["ur_qty", "urqty", "quantity", "qty"],
    reserveAmt:  ["reserve_amt", "reserveamt"],
    reserveQty:  ["reserve_qty", "reserveqty"],
    remainAmt:   ["remain_amt", "remainamt"],
    remainQty:   ["remain_qty", "remainqty"],
    isDc:        ["is_dc", "isdc", "dc_flag", "dcflag"],
    avgDaily:    ["avg_daily", "avgdaily", "avg_daily_qty", "daily_sales_qty", "avg_daily_sales"],
    turnoverDays: ["t_o_vendor", "t_o_brand", "t_o", "turnover_days"],
    skuCount:    ["sku_count", "skucount", "distinct_sku", "distinct_article_id", "countd_article_id", "article_count"],
    populationDate: ["population_date", "populationdate"],
    urQtyDead:   ["ur_qty_dead", "urqtydead"],
    tileSize:    ["tile_size", "tilesize"],
    salesQty:    ["sales_qty", "salesqty"]
  };

  var TIER_LABELS_FULL = [
    "0 - 60 Days", "61 - 90 Days", "91 - 120 Days", "121 - 150 Days",
    "151 - 180 Days", "181 - 270 Days", "271 - 360 Days", ">361 Days"
  ];
  var TIER_LABELS_SHORT = ["<90d", "<180d", ">180d"];
  var TIER_COLORS = ["var(--status-good)", "var(--status-warning)", "var(--status-critical)"];
  var TIER_BOUNDS = [60, 90, 120, 150, 180, 270, 360, Infinity];

  function tierBucket(tierIdx) { return tierIdx <= 1 ? 0 : (tierIdx <= 4 ? 1 : 2); }

  // Turnover-speed status coloring for section 02's per-branch badge —
  // <=180d normal, <=250d moderate, >250d high-risk. Section 03's two
  // turnover bar charts do NOT use this (see seqBlueByRank below); this
  // bucketing only still backs the standalone pill badge in the branch list.
  var TURNOVER_BADGE_CLASS = ["good", "warning", "critical"];
  function turnoverBucket(days) {
    if (!days || days <= 0) return 0;
    if (days <= 180) return 0;
    if (days <= 250) return 1;
    return 2;
  }

  // Sequential blue ramp (dark -> light) for section 03's "Turnover ตาม
  // สาขา" and "Turnover ตาม Brand" bar lists — encodes RANK within the
  // currently displayed (sorted, possibly filtered) list, not a status
  // threshold: the slowest-turnover row is darkest, fading to the lightest
  // step for the fastest. Deliberately no amber/red in these two boxes.
  var SEQ_COLORS_DARK_TO_LIGHT = ["var(--seq-8)", "var(--seq-7)", "var(--seq-6)", "var(--seq-5)", "var(--seq-4)", "var(--seq-3)", "var(--seq-2)", "var(--seq-1)"];
  function seqBlueByRank(index, total) {
    if (total <= 1) return SEQ_COLORS_DARK_TO_LIGHT[0];
    var step = index / (total - 1);
    return SEQ_COLORS_DARK_TO_LIGHT[Math.round(step * (SEQ_COLORS_DARK_TO_LIGHT.length - 1))];
  }

  // "Turnover ตาม MC (Top 10)" operates on a much larger day-count scale
  // (slow-moving long-tail SKUs, often thousands of days) and its own
  // thresholds — unrelated to the two functions above. Below 500 days it's
  // a neutral/plain pill, not a "good" green one.
  function mcTurnoverBadgeClass(days) {
    if (days > 1000) return "critical";
    if (days > 500) return "warning";
    return "neutral";
  }

  function bucketAging(days) {
    for (var i = 0; i < TIER_BOUNDS.length; i++) {
      if (days <= TIER_BOUNDS[i]) return i;
    }
    return TIER_BOUNDS.length - 1;
  }

  function matchTierLabel(text) {
    if (!text) return -1;
    var norm = String(text).toLowerCase();
    for (var i = 0; i < TIER_LABELS_FULL.length; i++) {
      if (norm.indexOf(TIER_LABELS_FULL[i].toLowerCase()) !== -1) return i;
    }
    return -1;
  }

  function normalize(name) { return name.toLowerCase().replace(/[^a-z0-9]/g, ""); }

  function stripAgg(fieldName) {
    var m = fieldName.match(/^(?:SUM|AVG|MIN|MAX|COUNT|CNT|ATTR|AGG)\s*\(\s*(.+?)\s*\)$/i);
    return m ? m[1] : fieldName;
  }

  function getColName(col) {
    var names = [];
    if (col.getFieldName) {
      try { var fn = col.getFieldName(); if (fn) names.push(fn); } catch (e) {}
    }
    if (col.fieldCaption) names.push(col.fieldCaption);
    if (col.fieldName) names.push(col.fieldName);
    return names;
  }

  // Two passes so a short alias (e.g. "branch") can never steal a column
  // that's an exact match for a *different* field (e.g. "BRANCH_ID" vs the
  // real "BRANCH" column) just because it happened to be checked first —
  // every exact match across every field is settled before any field falls
  // back to a fuzzy substring match.
  function buildColumnIndex(columns) {
    var index = {};
    var usedCols = {};

    var colCandidates = columns.map(function (col) {
      var names = getColName(col);
      var candidates = [];
      names.forEach(function (raw) {
        candidates.push(normalize(raw));
        var stripped = stripAgg(raw);
        if (stripped !== raw) candidates.push(normalize(stripped));
      });
      return candidates;
    });

    function pass(exactOnly) {
      for (var field in COLUMN_MAP) {
        if (index[field] !== undefined) continue;
        var normAliases = COLUMN_MAP[field].map(normalize);
        for (var ci = 0; ci < columns.length; ci++) {
          if (usedCols[ci]) continue;
          var isMatch = colCandidates[ci].some(function (normCand) {
            return normAliases.some(function (normAlias) {
              return exactOnly ? normCand === normAlias : normCand.indexOf(normAlias) !== -1;
            });
          });
          if (isMatch) { index[field] = ci; usedCols[ci] = true; break; }
        }
      }
    }

    pass(true);
    pass(false);
    return index;
  }

  function parseNumber(val) {
    if (val === null || val === undefined) return 0;
    var n = typeof val === "number" ? val : parseFloat(String(val).replace(/[,$]/g, ""));
    return isNaN(n) ? 0 : n;
  }

  function truthy(val) {
    if (typeof val === "boolean") return val;
    var s = String(val || "").toLowerCase();
    return s === "true" || s === "1" || s === "y" || s === "yes";
  }

  function extractRecords(dataTable, diagOut) {
    var colIndex = buildColumnIndex(dataTable.columns);
    console.log("[VendorStockPortal] columns detected:", colIndex);
    if (diagOut) {
      diagOut.colIndex = colIndex;
      // Every raw column name Tableau actually returned for this worksheet,
      // matched or not — the ground truth for whether a field like
      // AGING_TIER is really absent from the data, versus present but
      // unmatched by buildColumnIndex for some other reason.
      diagOut.rawColumnNames = dataTable.columns.map(function (col) {
        return getColName(col).join("/") || "(unnamed)";
      });
    }

    var rows = [];
    var data = dataTable.data;

    for (var r = 0; r < data.length; r++) {
      var row = data[r];
      (function () {
        function get(field) {
          var ci = colIndex[field];
          if (ci === undefined) return "";
          var cell = row[ci];
          if (!cell) return "";
          return cell.nativeValue !== undefined ? cell.nativeValue : (cell.value !== undefined ? cell.value : "");
        }

        var urAmt = parseNumber(get("urAmt"));
        var urQty = parseNumber(get("urQty"));
        if (urAmt === 0 && urQty === 0) return;

        var agingDaysRaw = get("aging");
        var tierIdx = matchTierLabel(get("agingTier"));
        if (tierIdx === -1 && agingDaysRaw !== "") tierIdx = bucketAging(parseNumber(agingDaysRaw));

        var branch = String(get("branch") || "Unspecified");
        // Most source systems don't carry an explicit DC flag column — DC
        // branches are conventionally named with a "DC" prefix/word instead.
        var isDC = truthy(get("isDc")) || /\bDC\b/i.test(branch);

        // Turnover: prefer a direct T_O (days of supply) column when present,
        // back-deriving the equivalent average-daily-quantity from it so the
        // existing qty-weighted aggregation (sum(qty)/sum(avgDaily)) still
        // applies unchanged. Falls back to a raw AVG_DAILY column otherwise.
        var turnoverDays = parseNumber(get("turnoverDays"));
        var avgDaily = turnoverDays > 0 ? (urQty / turnoverDays) : parseNumber(get("avgDaily"));

        rows.push({
          vendorId:    String(get("vendorId") || ""),
          vendorName:  String(get("vendorName") || ""),
          branch:      branch,
          articleId:   String(get("articleId") || "ROW-" + (r + 1)),
          articleName: String(get("articleName") || ""),
          brand:       String(get("brand") || ""),
          mch3:        String(get("mch3") || ""),
          tileSize:    String(get("tileSize") || ""),
          mch2:        String(get("mch2") || ""),
          mch1:        String(get("mch1") || ""),
          mc:          String(get("mc") || ""),
          itemFlag:    String(get("itemFlag") || ""),
          classStock:  String(get("classStock") || "Unclassified"),
          tierIdx:     tierIdx,
          urAmt:       urAmt,
          urQty:       urQty,
          reserveAmt:  parseNumber(get("reserveAmt")),
          reserveQty:  parseNumber(get("reserveQty")),
          remainAmt:   parseNumber(get("remainAmt")),
          remainQty:   parseNumber(get("remainQty")),
          isDC:        isDC,
          avgDaily:    avgDaily,
          // Only meaningful when the sheet is a pre-aggregated summary
          // (no ARTICLE_ID) and carries its own distinct-SKU-count measure
          // per group; 0 otherwise, in which case distinct articleId
          // counting below is used instead.
          skuCount:    parseNumber(get("skuCount")),
          populationDate: get("populationDate"),
          urQtyDead:   parseNumber(get("urQtyDead")),
          agingDays:   parseNumber(agingDaysRaw),
          turnoverDays: turnoverDays,
          salesQty:    parseNumber(get("salesQty"))
        });
      })();
    }
    return rows;
  }

  // ─── State ────────────────────────────────────────────────
  // Four worksheets, looked up by exact name. The two "summary" sheets
  // drive the on-screen dashboard and are expected to already be
  // pre-aggregated in Tableau (no ARTICLE_ID) for fast loading: "aging"
  // feeds section 01 (Stock Aging) + the KPI row, "stock" feeds sections
  // 02 (Stock by Branch) and 03 (Stock Turnover). The two "detail" sheets
  // are full SKU-level data, read only when the header Export button is
  // clicked, and used solely to build the downloaded .xls.
  var AGING_SHEET_NAME = "aging";
  var AGING_DETAIL_SHEET_NAME = "aging_detail";
  var TURNOVER_BY_BRANCH_SHEET_NAME = "turnover_by_branch";
  var TURNOVER_BRAND_SHEET_NAME = "turnover_brand";
  var TURNOVER_SHEET_NAME = "turnover";
  var TURNOVER_MC_SHEET_NAME = "turnover_mc";
  var STOCK_BRANCH_SHEET_NAME = "stock_branch";

  var S = {
    agingData: [],
    turnoverByBranchData: [],
    turnoverBrandData: [],
    turnoverData: [],
    turnoverMcData: [],
    agingDetailData: [],
    branchMetric: "amt",
    // Exclude-DC used to be one global header toggle; now it's two
    // independent per-box toggles over the same turnover_by_branch data.
    branchExcludeDC: false,
    vBranchTOExcludeDC: false,
    brandTOFilter: "ALL"
  };
  var unregisterFns = [];

  function activeAgingData() {
    return S.agingData;
  }
  function activeTurnoverByBranchDataForValue() {
    return S.branchExcludeDC ? S.turnoverByBranchData.filter(function (d) { return !d.isDC; }) : S.turnoverByBranchData;
  }
  function activeTurnoverByBranchDataForTurnover() {
    return S.vBranchTOExcludeDC ? S.turnoverByBranchData.filter(function (d) { return !d.isDC; }) : S.turnoverByBranchData;
  }
  function activeTurnoverBrandData() {
    return S.turnoverBrandData;
  }
  function activeTurnoverData() {
    return S.turnoverData;
  }

  // ─── Formatting ───────────────────────────────────────────
  function fmtInt(n) { return Math.round(n).toLocaleString("en-US"); }
  function fmtTHB(n) {
    var abs = Math.abs(n);
    if (abs >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (abs >= 1e3) return (n / 1e3).toFixed(0) + "K";
    return fmtInt(n);
  }
  function fmtTHBFull(n) { return fmtInt(n); }
  function pct1(n) { return n.toFixed(1) + "%"; }
  function fmtDays(days) {
    if (!days || days <= 0) return "0";
    if (days >= 1000) return (days / 1000).toFixed(1) + "K วัน";
    if (days < 10) return days.toFixed(1) + " วัน";
    return Math.round(days) + " วัน";
  }
  // The header's Snapshot Date reflects "Population Date" from the aging
  // data itself (when Tableau's field returns one), not the viewer's local
  // clock — falls back to "" (caller uses today's date) if unparseable.
  function formatSnapshotDate(raw) {
    if (!raw) return "";
    var d = raw instanceof Date ? raw : new Date(raw);
    return isNaN(d.getTime()) ? String(raw) : d.toISOString().slice(0, 10);
  }

  // ─── UI helpers ───────────────────────────────────────────
  function showLoading(msg) {
    document.getElementById("loadingOverlay").style.display = "block";
    document.getElementById("loadingText").textContent = msg || "กำลังโหลดข้อมูลจาก Tableau...";
  }
  function hideLoading() { document.getElementById("loadingOverlay").style.display = "none"; }
  function showError(msg) {
    document.getElementById("errorBanner").style.display = "block";
    document.getElementById("errorText").textContent = msg;
  }
  function hideError() { document.getElementById("errorBanner").style.display = "none"; }

  var tooltip = document.getElementById("tooltip");
  function showTip(evt, title, rows) {
    var html = '<div class="tt-title">' + title + "</div>";
    rows.forEach(function (r) { html += '<div class="tt-row"><span>' + r[0] + "</span><span>" + r[1] + "</span></div>"; });
    tooltip.innerHTML = html; tooltip.classList.add("show"); moveTip(evt);
  }
  function moveTip(evt) {
    var x = evt.clientX + 16, y = evt.clientY + 16, vw = window.innerWidth, vh = window.innerHeight;
    tooltip.style.left = Math.min(x, vw - 280) + "px";
    tooltip.style.top = Math.min(y, vh - 90) + "px";
  }
  function hideTip() { tooltip.classList.remove("show"); }

  function renderBars(containerId, data, opts) {
    var el = document.getElementById(containerId);
    var max = opts.max || Math.max.apply(null, data.map(opts.value)) || 1;
    el.innerHTML = "";
    data.forEach(function (d) {
      var v = opts.value(d);
      var w = Math.min(Math.max((v / max) * 100, 0.6), 100);
      var row = document.createElement("div");
      row.className = "bar-row"; row.tabIndex = 0;
      var label = document.createElement("div"); label.className = "bar-label"; label.innerHTML = opts.label(d); row.appendChild(label);
      var track = document.createElement("div"); track.className = "bar-track";
      var fill = document.createElement("div"); fill.className = "bar-fill"; fill.style.width = w + "%"; fill.style.background = opts.color(d);
      track.appendChild(fill); row.appendChild(track);
      var valueEl = document.createElement("div"); valueEl.className = "bar-value"; valueEl.innerHTML = opts.valueLabel(d); row.appendChild(valueEl);
      var tipFn = function (evt) { showTip(evt, opts.tipTitle(d), opts.tipRows(d)); };
      row.addEventListener("mouseenter", tipFn);
      row.addEventListener("mousemove", moveTip);
      row.addEventListener("mouseleave", hideTip);
      row.addEventListener("focus", function (evt) { showTip(evt, opts.tipTitle(d), opts.tipRows(d)); });
      row.addEventListener("blur", hideTip);
      el.appendChild(row);
    });
  }

  function renderTable(containerId, headers, rows) {
    var el = document.getElementById(containerId + "-table");
    if (!el) return;
    var html = '<table class="data-table"><thead><tr>';
    headers.forEach(function (h) { html += "<th>" + h + "</th>"; });
    html += "</tr></thead><tbody>";
    rows.forEach(function (r) { html += "<tr>"; r.forEach(function (c) { html += "<td>" + c + "</td>"; }); html += "</tr>"; });
    html += "</tbody></table>";
    el.innerHTML = html;
  }

  document.body.addEventListener("click", function (evt) {
    var btn = evt.target.closest ? evt.target.closest("[data-toggle-table]") : null;
    if (!btn) return;
    var id = btn.getAttribute("data-toggle-table");
    var chartEl = document.getElementById(id), tableEl = document.getElementById(id + "-table");
    if (!chartEl || !tableEl) return;
    var showingTable = !tableEl.hidden;
    tableEl.hidden = showingTable;
    chartEl.style.display = showingTable ? "" : "none";
    btn.textContent = showingTable ? "View table" : "View chart";
    btn.setAttribute("aria-pressed", String(!showingTable));
  });

  // ─── Aggregation ──────────────────────────────────────────
  // Distinct SKU count: a true per-articleId set when the sheet is at SKU
  // grain, or a sum of a pre-aggregated SKU_COUNT measure when it's a
  // rolled-up summary (no ARTICLE_ID) — the latter can over-count SKUs that
  // span multiple groups (e.g. the same article in several branches), which
  // is an accepted trade-off for the faster-loading pre-aggregated sheet.
  function countSkus(records) {
    var skuCountSum = 0, skuSet = {};
    records.forEach(function (d) {
      skuCountSum += d.skuCount;
      skuSet[d.articleId] = true;
    });
    return skuCountSum > 0 ? skuCountSum : Object.keys(skuSet).length;
  }

  // Total Stock Value / UR_QTY / SKU Count / Dead Stock Value come from
  // "turnover" — Aging > 180 Days is the one KPI that genuinely needs
  // AGING_TIER, so it alone still comes from "aging"'s tierIdx.
  // SKU Count and Dead Stock Value read agingDetailRecords ("aging_detail")
  // rather than turnoverRecords ("turnover") — "turnover" doesn't carry
  // CLASS_STOCK/ARTICLE_ID via the Extensions API even when confirmed
  // present in Tableau itself, so it can't answer either reliably.
  function computeKPIs(turnoverRecords, agingRecords, agingDetailRecords) {
    var totalValue = 0, totalQty = 0;
    turnoverRecords.forEach(function (d) {
      totalValue += d.urAmt;
      totalQty += d.urQty;
    });
    var deadValue = 0;
    agingDetailRecords.forEach(function (d) {
      if (d.classStock.toLowerCase().indexOf("dead") !== -1) deadValue += d.urAmt;
    });
    var aging180Value = 0;
    agingRecords.forEach(function (d) { if (d.tierIdx >= 5) aging180Value += d.urAmt; });
    return {
      totalValue: totalValue, totalQty: totalQty,
      sku: countSkus(agingDetailRecords),
      deadValue: deadValue, deadPct: totalValue ? deadValue / totalValue * 100 : 0,
      aging180Value: aging180Value, aging180Pct: totalValue ? aging180Value / totalValue * 100 : 0
    };
  }

  function buildAgingData(records) {
    var totalValue = 0;
    var classMap = {};
    var classOrder = [];
    var tierTotals = TIER_LABELS_FULL.map(function () { return { value: 0, qty: 0 }; });
    records.forEach(function (d) {
      totalValue += d.urAmt;
      if (!classMap[d.classStock]) { classMap[d.classStock] = { total: 0, tiers: [0, 0, 0] }; classOrder.push(d.classStock); }
      if (d.tierIdx >= 0) {
        var bucket = tierBucket(d.tierIdx);
        classMap[d.classStock].total += d.urAmt;
        classMap[d.classStock].tiers[bucket] += d.urAmt;
        tierTotals[d.tierIdx].value += d.urAmt;
        tierTotals[d.tierIdx].qty += d.urQty;
      }
    });
    var classAging = classOrder.sort().map(function (name) {
      return { name: name, total: classMap[name].total, tiers: classMap[name].tiers };
    }).filter(function (c) { return c.total > 0; });
    var agingTiers = TIER_LABELS_FULL.map(function (lbl, i) { return { tier: lbl, value: tierTotals[i].value, qty: tierTotals[i].qty }; });
    return { classAging: classAging, agingTiers: agingTiers, totalValue: totalValue };
  }

  function renderTierLegend(elId) {
    var el = document.getElementById(elId);
    if (!el) return;
    el.innerHTML = TIER_LABELS_SHORT.map(function (lbl, i) {
      return '<span class="item"><span class="swatch" style="background:' + TIER_COLORS[i] + '"></span>' + lbl + "</span>";
    }).join("");
  }

  function drawAgingChart(records) {
    var agingData = buildAgingData(records);
    var tiers = agingData.agingTiers;
    var total = agingData.totalValue || 1;
    renderBars("agingChart", tiers, {
      value: function (d) { return d.value; },
      label: function (d) { return d.tier; },
      color: function (d) { return TIER_COLORS[tierBucket(tiers.indexOf(d))]; },
      valueLabel: function (d) { return fmtTHB(d.value) + '<span class="sub">' + pct1(100 * d.value / total) + "</span>"; },
      tipTitle: function (d) { return "Aging: " + d.tier; },
      tipRows: function (d) { return [["Stock value", fmtTHBFull(d.value)], ["% of total", pct1(100 * d.value / total)], ["Quantity", fmtInt(d.qty)]]; }
    });
    renderTable("agingChart", ["Aging tier", "Value (THB)", "% of total", "Quantity"],
      tiers.map(function (d) { return [d.tier, fmtTHBFull(d.value), pct1(100 * d.value / total), fmtInt(d.qty)]; }));
  }

  function drawClassAgingChart(records) {
    renderTierLegend("classAgingLegend");
    var agingData = buildAgingData(records);
    var rows = agingData.classAging;
    var agingTotalValue = agingData.totalValue || 1;

    var container = document.getElementById("classChart");
    container.innerHTML = "";
    rows.forEach(function (d) {
      var row = document.createElement("div");
      row.className = "bar-row";
      var label = document.createElement("div"); label.className = "bar-label"; label.textContent = d.name; row.appendChild(label);
      var track = document.createElement("div"); track.className = "bar-track";
      // Always full width — this is a 100%-stacked bar showing each class's
      // own tier composition, not a magnitude comparison across classes
      // (that comparison already lives in the Value/% column to the right).
      var stack = document.createElement("div"); stack.className = "bar-stack"; stack.style.width = "100%";
      d.tiers.forEach(function (v, i) {
        if (v <= 0) return;
        var segPct = v / d.total * 100;
        var seg = document.createElement("div");
        seg.className = "bar-seg";
        seg.style.width = segPct + "%";
        seg.style.background = TIER_COLORS[i];
        if (segPct >= 20) {
          seg.style.display = "flex"; seg.style.alignItems = "center"; seg.style.justifyContent = "center";
          seg.style.color = i === 1 ? "var(--text-primary)" : "#fff";
          seg.style.fontSize = "10px"; seg.style.fontWeight = "600";
          seg.textContent = Math.round(segPct) + "%";
        }
        var tipFn = function (evt) {
          showTip(evt, d.name + " — " + TIER_LABELS_SHORT[i], [["Stock value", fmtInt(v)], ["% of this class", pct1(100 * v / d.total)]]);
        };
        seg.addEventListener("mouseenter", tipFn);
        seg.addEventListener("mousemove", moveTip);
        seg.addEventListener("mouseleave", hideTip);
        stack.appendChild(seg);
      });
      track.appendChild(stack); row.appendChild(track);
      var valueEl = document.createElement("div"); valueEl.className = "bar-value";
      valueEl.innerHTML = fmtTHB(d.total) + '<span class="sub">' + pct1(100 * d.total / agingTotalValue) + "</span>";
      row.appendChild(valueEl);
      container.appendChild(row);
    });

    var headers = ["Class"].concat(TIER_LABELS_SHORT).concat(["Total"]);
    renderTable("classChart", headers, rows.map(function (d) {
      var cells = d.tiers.map(function (v) { return v > 0 ? fmtInt(v) : ""; });
      return [d.name].concat(cells).concat([fmtInt(d.total)]);
    }));
  }

  function computeBranches(records) {
    var map = {}, order = [];
    records.forEach(function (d) {
      if (!map[d.branch]) { map[d.branch] = { branch: d.branch, value: 0, qty: 0, skuSet: {}, skuCountSum: 0, isDC: false, toRawSum: 0, toRawCount: 0 }; order.push(d.branch); }
      var b = map[d.branch];
      b.value += d.urAmt; b.qty += d.urQty; b.skuSet[d.articleId] = true; b.skuCountSum += d.skuCount;
      if (d.isDC) b.isDC = true;
      if (d.turnoverDays > 0) { b.toRawSum += d.turnoverDays; b.toRawCount++; }
    });
    return order.map(function (name) {
      var b = map[name];
      var sku = b.skuCountSum > 0 ? b.skuCountSum : Object.keys(b.skuSet).length;
      return { branch: b.branch, value: b.value, qty: b.qty, sku: sku, isDC: b.isDC, toRaw: b.toRawCount > 0 ? b.toRawSum / b.toRawCount : 0 };
    });
  }

  var branchChartExportState = null;

  function drawBranches(records) {
    var rows = computeBranches(records);
    var isAmt = S.branchMetric === "amt";
    var metricOf = function (d) { return isAmt ? d.value : d.qty; };
    var fmtMetric = isAmt ? fmtTHB : fmtInt;
    var total = rows.reduce(function (s, d) { return s + metricOf(d); }, 0) || 1;
    var max = Math.max.apply(null, rows.map(metricOf)) || 1;

    document.getElementById("branchChartTitle").textContent = isAmt ? "มูลค่าสต็อกตามสาขา (UR_AMT)" : "จำนวนสต็อกตามสาขา (UR_QTY)";

    var sortedRows = rows.slice().sort(function (a, b) { return metricOf(b) - metricOf(a); });

    var listEl = document.getElementById("branchChart");
    listEl.innerHTML = "";
    sortedRows.forEach(function (d, i) {
      var v = metricOf(d);
      var w = Math.min(Math.max((v / max) * 100, 0.6), 100);
      var bucket = turnoverBucket(d.toRaw);

      var row = document.createElement("div");
      row.className = "rank-row"; row.tabIndex = 0;

      var num = document.createElement("div"); num.className = "rank-num"; num.textContent = String(i + 1); row.appendChild(num);

      var name = document.createElement("div"); name.className = "rank-name";
      name.innerHTML = d.branch + (d.isDC ? ' <span class="tag">DC</span>' : "");
      row.appendChild(name);

      var track = document.createElement("div"); track.className = "bar-track";
      var fill = document.createElement("div"); fill.className = "bar-fill"; fill.style.width = w + "%"; fill.style.background = "var(--accent)";
      track.appendChild(fill); row.appendChild(track);

      var meta = document.createElement("div"); meta.className = "rank-meta";
      meta.innerHTML = '<span class="rank-value">' + fmtMetric(v) + '</span><span class="rank-pct">' + pct1(100 * v / total) + "</span>" +
        (d.toRaw > 0 ? '<span class="turnover-badge ' + TURNOVER_BADGE_CLASS[bucket] + '">' + fmtDays(d.toRaw) + "</span>" : "");
      row.appendChild(meta);

      var tipFn = function (evt) {
        showTip(evt, d.branch, [["Value (UR_AMT)", fmtTHBFull(d.value)], ["Quantity (UR_QTY)", fmtInt(d.qty)], ["% of total", pct1(100 * v / total)], ["SKUs", fmtInt(d.sku)], ["Turnover", d.toRaw > 0 ? fmtDays(d.toRaw) : "–"]]);
      };
      row.addEventListener("mouseenter", tipFn);
      row.addEventListener("mousemove", moveTip);
      row.addEventListener("mouseleave", hideTip);
      row.addEventListener("focus", tipFn);
      row.addEventListener("blur", hideTip);

      listEl.appendChild(row);
    });

    var headers = ["Branch", "Value (UR_AMT)", "Quantity (UR_QTY)", "% of total shown", "SKUs", "Turnover"];
    var tableRows = sortedRows.map(function (d) {
      return [d.branch + (d.isDC ? " (DC)" : ""), fmtTHBFull(d.value), fmtInt(d.qty), pct1(100 * metricOf(d) / total), fmtInt(d.sku), d.toRaw > 0 ? fmtDays(d.toRaw) : ""];
    });
    renderTable("branchChart", headers, tableRows);
    branchChartExportState = { headers: headers, rows: tableRows };
  }

  // ─── Generic multi-dimension aggregation (Turnover) ────────
  function aggregateByDims(records, dims) {
    var groups = {}, order = [];
    records.forEach(function (r) {
      var key = dims.map(function (d) { return r[d]; }).join("");
      if (!groups[key]) {
        var g = { value: 0, qty: 0, avgDaily: 0, qtyDead: 0, isDC: false, salesQtySum: 0, toRawSum: 0, toRawCount: 0 };
        dims.forEach(function (d) { g[d] = r[d]; });
        groups[key] = g; order.push(key);
      }
      groups[key].value += r.urAmt;
      groups[key].qty += r.urQty;
      groups[key].avgDaily += r.avgDaily;
      groups[key].qtyDead += r.urQtyDead;
      if (r.isDC) groups[key].isDC = true;
      groups[key].salesQtySum += r.salesQty;
      // Straight average of the raw T_O column — used wherever the data
      // source's own T_O value must be shown as-is instead of being
      // re-derived from qty/avgDaily or the sales_qty formula below.
      if (r.turnoverDays > 0) { groups[key].toRawSum += r.turnoverDays; groups[key].toRawCount++; }
    });
    return order.map(function (k) {
      var g = groups[k];
      g.to = g.avgDaily > 0 ? g.qty / g.avgDaily : 0;
      // Days of supply per SUM([UR QTY]) / (SUM([sales_qty]) / 90) — a
      // 90-day sales rate, computed at whatever grain `dims` groups by
      // (e.g. sum of UR_QTY and sales_qty across just BRANCH+MCH3).
      g.toFormula = g.salesQtySum > 0 ? g.qty / (g.salesQtySum / 90) : 0;
      g.toRaw = g.toRawCount > 0 ? g.toRawSum / g.toRawCount : 0;
      return g;
    });
  }

  var vBranchTOExportState = null;

  // "Turnover ตาม Brand" is pinned to whatever height "Turnover ตาม สาขา"
  // naturally renders at, so the two cards always line up — its own list
  // (#brandTOChart, "flex:1; overflow-y:auto" in CSS) scrolls internally
  // instead of growing the card past that height. Reading offsetHeight
  // forces the browser to flush layout first, so this always reflects the
  // just-rendered DOM, not a stale value. Called from the end of both
  // draw functions below, since either one redrawing alone (the per-box
  // "ไม่รวม DC" toggle, a brand tab click) can change which height applies.
  function syncTurnoverCardHeights() {
    var branchCard = document.getElementById("vBranchTOCard");
    var brandCard = document.getElementById("brandTOCard");
    var branchList = document.getElementById("vBranchTOChart");
    if (!branchCard || !brandCard || !branchList) return;
    brandCard.style.height = branchList.children.length > 0 ? branchCard.offsetHeight + "px" : "";
  }

  // Fixed to one row per branch, reading T_O as-is from a dedicated
  // "turnover_by_branch" sheet — no dims toggle, no re-derivation.
  function drawVendorBranchTO(records) {
    var rows = aggregateByDims(records, ["branch"]).sort(function (a, b) { return b.toRaw - a.toRaw; });

    renderBars("vBranchTOChart", rows, {
      value: function (d) { return d.toRaw; },
      label: function (d) { return d.branch; },
      color: function (d) { return seqBlueByRank(rows.indexOf(d), rows.length); },
      valueLabel: function (d) {
        return fmtDays(d.toRaw) + '<span class="sub">' + fmtTHB(d.value) + " · " + fmtInt(d.qty) + " ชิ้น</span>";
      },
      tipTitle: function (d) { return d.branch; },
      tipRows: function (d) { return [["Turnover (T_O)", fmtDays(d.toRaw)], ["Value (UR_AMT)", fmtTHBFull(d.value)], ["Quantity (UR_QTY)", fmtInt(d.qty)]]; }
    });

    var totalValue = 0, totalQty = 0, totalToRawSum = 0, totalToRawCount = 0;
    rows.forEach(function (d) { totalValue += d.value; totalQty += d.qty; });
    records.forEach(function (d) { if (d.turnoverDays > 0) { totalToRawSum += d.turnoverDays; totalToRawCount++; } });
    var totalTurnover = totalToRawCount > 0 ? totalToRawSum / totalToRawCount : 0;

    var headers = ["สาขา", "Value (THB)", "Quantity", "Turnover"];
    var tableRows = rows.map(function (d) {
      return [d.branch + (d.isDC ? " (DC)" : ""), fmtTHBFull(d.value), fmtInt(d.qty), fmtDays(d.toRaw)];
    });
    tableRows.push(["Total", fmtTHBFull(totalValue), fmtInt(totalQty), fmtDays(totalTurnover)]);
    renderTable("vBranchTOChart", headers, tableRows);
    vBranchTOExportState = { headers: headers, rows: tableRows };
    syncTurnoverCardHeights();
  }

  var brandTOExportState = null;

  function renderBrandTabs(brands) {
    var el = document.getElementById("brandTOFilterTabs");
    if (!el) return;
    var options = ["ALL"].concat(brands);
    el.innerHTML = options.map(function (b) {
      var active = S.brandTOFilter === b;
      return '<button type="button" data-brand="' + b.replace(/"/g, "&quot;") + '"' + (active ? ' class="active" aria-pressed="true"' : ' aria-pressed="false"') + ">" + b + "</button>";
    }).join("");
    Array.prototype.forEach.call(el.querySelectorAll("button"), function (btn) {
      btn.addEventListener("click", function () {
        S.brandTOFilter = btn.getAttribute("data-brand");
        drawTurnoverByBrand(activeTurnoverBrandData());
      });
    });
  }

  // Fixed to one row per brand, reading T_O as-is from a dedicated
  // "turnover_brand" sheet — mirrors drawVendorBranchTO above. The brand tab
  // filter and free-text search both narrow what's rendered without
  // reshaping the tab list itself (always built from the full unfiltered set).
  function drawTurnoverByBrand(records) {
    var dims = ["mch3", "brand", "classStock"];

    var brandSet = {};
    records.forEach(function (d) { if (d.brand) brandSet[d.brand] = true; });
    renderBrandTabs(Object.keys(brandSet).sort());

    var filtered = S.brandTOFilter === "ALL" ? records : records.filter(function (d) { return d.brand === S.brandTOFilter; });
    var rows = aggregateByDims(filtered, dims).sort(function (a, b) { return b.toRaw - a.toRaw; });

    function labelOf(d) { return dims.map(function (k) { return d[k]; }).join(" · "); }

    // Three dims joined ("MCH3 · Brand · CLASS_STOCK") need a much wider
    // label column than the default — narrows the bar track itself so the
    // text isn't ellipsized, same widths the old dims-toggle chart used
    // for a 3-dim combo.
    var chartContainer = document.getElementById("brandTOChart");
    chartContainer.style.setProperty("--label-w", "260px");
    chartContainer.style.setProperty("--label-w-mobile", "170px");

    renderBars("brandTOChart", rows, {
      value: function (d) { return d.toRaw; },
      label: labelOf,
      color: function (d) { return seqBlueByRank(rows.indexOf(d), rows.length); },
      valueLabel: function (d) {
        return fmtDays(d.toRaw) + '<span class="sub">' + fmtTHB(d.value) + " · " + fmtInt(d.qty) + " ชิ้น</span>";
      },
      tipTitle: labelOf,
      tipRows: function (d) { return [["Turnover (T_O)", fmtDays(d.toRaw)], ["Value (UR_AMT)", fmtTHBFull(d.value)], ["Quantity (UR_QTY)", fmtInt(d.qty)]]; }
    });

    var totalValue = 0, totalQty = 0, totalToRawSum = 0, totalToRawCount = 0;
    rows.forEach(function (d) { totalValue += d.value; totalQty += d.qty; });
    filtered.forEach(function (d) { if (d.turnoverDays > 0) { totalToRawSum += d.turnoverDays; totalToRawCount++; } });
    var totalTurnover = totalToRawCount > 0 ? totalToRawSum / totalToRawCount : 0;

    var headers = ["MCH3", "Brand", "CLASS_STOCK", "Value (THB)", "Quantity", "Turnover"];
    var tableRows = rows.map(function (d) {
      return [d.mch3, d.brand, d.classStock, fmtTHBFull(d.value), fmtInt(d.qty), fmtDays(d.toRaw)];
    });
    tableRows.push(["Total", "", "", fmtTHBFull(totalValue), fmtInt(totalQty), fmtDays(totalTurnover)]);
    renderTable("brandTOChart", headers, tableRows);
    brandTOExportState = { headers: headers, rows: tableRows };
    syncTurnoverCardHeights();
  }

  function brandTOExportCsv() {
    if (!brandTOExportState) return;
    downloadCsv(brandTOExportState.headers, brandTOExportState.rows, "vendor_turnover_by_brand.csv");
  }

  var mcTop10ExportState = null;

  // Fixed columns (no dims toggle), sourced from a dedicated "turnover_mc"
  // sheet with its own T_O — top 10 rows by that T_O, descending.
  function drawTurnoverMcTop10(records) {
    var rows = aggregateByDims(records, ["mch3", "mch2", "mch1", "mc"])
      .sort(function (a, b) { return b.toRaw - a.toRaw; })
      .slice(0, 10);

    var headers = ["MCH3", "MCH2", "MCH1", "MC", "UR_QTY", "UR_AMT", "TURNOVER"];
    var tableRows = rows.map(function (d) {
      return [d.mch3, d.mch2, d.mch1, d.mc, fmtInt(d.qty), fmtTHBFull(d.value), fmtDays(d.toRaw)];
    });

    var html = '<table class="data-table"><thead><tr>';
    headers.forEach(function (h) { html += "<th>" + h + "</th>"; });
    html += "</tr></thead><tbody>";
    rows.forEach(function (d) {
      html += "<tr><td>" + d.mch3 + "</td><td>" + d.mch2 + "</td><td>" + d.mch1 + "</td><td>" + d.mc + "</td><td>" +
        fmtInt(d.qty) + "</td><td>" + fmtTHBFull(d.value) + '</td><td><span class="turnover-badge ' +
        mcTurnoverBadgeClass(d.toRaw) + '">' + fmtDays(d.toRaw) + "</span></td></tr>";
    });
    html += "</tbody></table>";
    document.getElementById("mchFlatTableWrap").innerHTML = html;
    mcTop10ExportState = { headers: headers, rows: tableRows };
  }

  // ─── CSV / XLS export ───────────────────────────────────────
  function csvEscape(v) {
    v = String(v);
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function downloadCsv(headers, rows, filename) {
    var csv = "﻿" + [headers].concat(rows).map(function (row) { return row.map(csvEscape).join(","); }).join("\r\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }
  function branchChartExportCsv() {
    if (!branchChartExportState) return;
    downloadCsv(branchChartExportState.headers, branchChartExportState.rows, "vendor_stock_by_branch.csv");
  }
  function vBranchTOExportCsv() {
    if (!vBranchTOExportState) return;
    downloadCsv(vBranchTOExportState.headers, vBranchTOExportState.rows, "vendor_branch_turnover.csv");
  }
  function mcTop10ExportCsv() {
    if (!mcTop10ExportState) return;
    downloadCsv(mcTop10ExportState.headers, mcTop10ExportState.rows, "vendor_turnover_by_mc_top10.csv");
  }
  function xmlEscape(v) { return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function xlsSheetXml(name, headers, rows, numericFlags) {
    var xml = '<Worksheet ss:Name="' + xmlEscape(name) + '"><Table>';
    xml += "<Row>" + headers.map(function (h) { return '<Cell ss:StyleID="Header"><Data ss:Type="String">' + xmlEscape(h) + "</Data></Cell>"; }).join("") + "</Row>";
    rows.forEach(function (row) {
      xml += "<Row>" + row.map(function (v, i) {
        var type = numericFlags[i] ? "Number" : "String";
        return '<Cell><Data ss:Type="' + type + '">' + xmlEscape(v) + "</Data></Cell>";
      }).join("") + "</Row>";
    });
    xml += "</Table></Worksheet>";
    return xml;
  }

  // The full export reads the two DETAIL worksheets fresh, on demand — they
  // are never loaded as part of the normal dashboard render, only here, so
  // opening the dashboard stays fast even when detail is large.
  function exportFullReport() {
    showLoading("กำลังโหลดข้อมูลสำหรับ export...");
    hideError();

    var agingDetailWs = findWorksheetByName(AGING_DETAIL_SHEET_NAME);
    var stockBranchWs = findWorksheetByName(STOCK_BRANCH_SHEET_NAME);
    var turnoverWs = findWorksheetByName(TURNOVER_SHEET_NAME);
    var turnoverBrandWs = findWorksheetByName(TURNOVER_BRAND_SHEET_NAME);
    var agingDetailDiag = {};

    Promise.all([readWorksheetRecords(agingDetailWs, agingDetailDiag), readWorksheetRecords(stockBranchWs)]).then(function (results) {
      var stockRecords = results[1];
      var summaryAgingRecords = results[0];
      // "turnover"/"turnover_brand" are already loaded eagerly (they also
      // feed the on-screen boxes) — reuse rather than re-fetching.
      var turnoverRecords = activeTurnoverData();
      var turnoverBrandRecords = activeTurnoverBrandData();

      function buildTierWarning(records, sourceLabel) {
        var resolved = tierResolvedCount(records);
        if (records.length === 0 || resolved === records.length) return "";
        return "AGING_TIER resolved on " + resolved + " of " + records.length + " exported rows (source: " + sourceLabel + "). " +
          "Raw columns Tableau returned for \"" + AGING_DETAIL_SHEET_NAME + "\": " +
          (agingDetailDiag.rawColumnNames ? agingDetailDiag.rawColumnNames.join(" | ") : "(none)") + ".";
      }

      function finishExport(agingRecords, tierWarning) {
        hideLoading();

        var missing = [];
        if (!agingDetailWs) missing.push('"' + AGING_DETAIL_SHEET_NAME + '"');
        if (!stockBranchWs) missing.push('"' + STOCK_BRANCH_SHEET_NAME + '"');
        if (!turnoverWs) missing.push('"' + TURNOVER_SHEET_NAME + '"');
        if (!turnoverBrandWs) missing.push('"' + TURNOVER_BRAND_SHEET_NAME + '"');

        if (agingRecords.length === 0 && stockRecords.length === 0 && turnoverRecords.length === 0 && turnoverBrandRecords.length === 0) {
          showError("Export needs at least one of the worksheets named " +
            '"' + AGING_DETAIL_SHEET_NAME + '", "' + STOCK_BRANCH_SHEET_NAME + '", "' + TURNOVER_SHEET_NAME + '", "' +
            TURNOVER_BRAND_SHEET_NAME + '" — none were found.');
          return;
        }

        var sheets = "";

        if (agingRecords.length > 0) {
          var detailHeaders = ["VENDOR_ID", "VENDOR_NAME", "BRANCH", "ARTICLE_ID", "ARTICLE_NAME_TH", "BRAND", "MCH3", "TILE_SIZE", "MCH2", "ITEM_FLAG", "CLASS_STOCK", "AGING_TIER", "AGING", "UR_QTY", "UR_AMT", "POPULATION_DATE"];
          var detailRows = agingRecords.map(function (d) {
            return [d.vendorId, d.vendorName, d.branch, d.articleId, d.articleName, d.brand, d.mch3, d.tileSize, d.mch2, d.itemFlag, d.classStock,
              d.tierIdx >= 0 ? TIER_LABELS_FULL[d.tierIdx] : "", d.agingDays, d.urQty, d.urAmt, formatSnapshotDate(d.populationDate)];
          });
          sheets += xlsSheetXml("Stock aging", detailHeaders, detailRows, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0]);
        }

        if (stockRecords.length > 0) {
          var stockByBranchHeaders = ["VENDOR_ID", "VENDOR_NAME", "BRANCH", "MCH3", "ARTICLE_ID", "ARTICLE_NAME_TH", "ITEM_FLAG", "UR_QTY", "UR_AMT", "POPULATION_DATE"];
          var stockByBranchRows = stockRecords.map(function (d) {
            return [d.vendorId, d.vendorName, d.branch, d.mch3, d.articleId, d.articleName, d.itemFlag,
              d.urQty, d.urAmt, formatSnapshotDate(d.populationDate)];
          });
          sheets += xlsSheetXml("Stock by branch", stockByBranchHeaders, stockByBranchRows, [0, 0, 0, 0, 0, 0, 0, 1, 1, 0]);
        }

        if (turnoverRecords.length > 0) {
          var turnoverSnapshotDate = formatSnapshotDate(turnoverRecords[0].populationDate);
          var turnoverVendorId = turnoverRecords[0].vendorId, turnoverVendorName = turnoverRecords[0].vendorName;
          var branchTO = aggregateByDims(turnoverRecords, ["branch", "mch3"]).sort(function (a, b) { return b.toRaw - a.toRaw; });
          var toHeaders = ["VENDOR_ID", "VENDOR_NAME", "BRANCH", "MCH3", "UR_QTY", "UR_AMT", "T_O", "UR_QTY_DEAD", "POPULATION_DATE"];
          var toRows = branchTO.map(function (d) {
            return [turnoverVendorId, turnoverVendorName, d.branch, d.mch3, d.qty, d.value, Math.round(d.toRaw * 10) / 10, d.qtyDead, turnoverSnapshotDate];
          });
          sheets += xlsSheetXml("Turnover", toHeaders, toRows, [0, 0, 0, 0, 1, 1, 1, 1, 0]);
        }

        if (turnoverBrandRecords.length > 0) {
          var brandSnapshotDate = formatSnapshotDate(turnoverBrandRecords[0].populationDate);
          var brandVendorId = turnoverBrandRecords[0].vendorId, brandVendorName = turnoverBrandRecords[0].vendorName;
          var brandTO = aggregateByDims(turnoverBrandRecords, ["mch3", "brand", "classStock"]).sort(function (a, b) { return b.toRaw - a.toRaw; });
          var brandHeaders = ["VENDOR_ID", "VENDOR_NAME", "MCH3", "BRAND", "CLASS_STOCK", "UR_QTY", "UR_AMT", "T_O", "POPULATION_DATE"];
          var brandRows = brandTO.map(function (d) {
            return [brandVendorId, brandVendorName, d.mch3, d.brand, d.classStock, d.qty, d.value, Math.round(d.toRaw * 10) / 10, brandSnapshotDate];
          });
          sheets += xlsSheetXml("Turnover by BRAND", brandHeaders, brandRows, [0, 0, 0, 0, 0, 1, 1, 1, 0]);
        }

        var xml = '<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>' +
          '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet" xmlns:html="http://www.w3.org/TR/REC-html40">' +
          '<Styles><Style ss:ID="Header"><Font ss:Bold="1"/></Style></Styles>' + sheets + "</Workbook>";

        var blob = new Blob([xml], { type: "application/vnd.ms-excel" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = "vendor_stock_full_export.xls";
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(a.href);

        if (missing.length) {
          showError("Export completed, but worksheet(s) not found: " + missing.join(", ") +
            " — that part of the export was skipped.");
        } else if (tierWarning) {
          showError("Export completed, but not every row could show an aging tier. " + tierWarning);
        }
      }

      // AGING_TIER has repeatedly come back unresolved via the summary API
      // even on sheets confirmed to carry it as a plain, un-blended field —
      // if that happened here too, try reading straight from the
      // underlying table(s) before giving up.
      if (tierResolvedCount(summaryAgingRecords) > 0 || summaryAgingRecords.length === 0) {
        finishExport(summaryAgingRecords, buildTierWarning(summaryAgingRecords, AGING_DETAIL_SHEET_NAME));
        return;
      }

      readUnderlyingAgingRecords(agingDetailWs, agingDetailDiag).then(function (underlyingRecords) {
        if (tierResolvedCount(underlyingRecords) > 0) {
          finishExport(underlyingRecords, buildTierWarning(underlyingRecords, AGING_DETAIL_SHEET_NAME + " (underlying table)"));
        } else {
          finishExport(summaryAgingRecords, "AGING_TIER resolved on 0 of " + summaryAgingRecords.length +
            " exported rows, and reading the underlying table(s) directly didn't help either. Underlying tables tried: " +
            (agingDetailDiag.underlyingAttempts ? agingDetailDiag.underlyingAttempts.join(" || ") : "(none)") + ".");
        }
      });
    }).catch(function (err) {
      hideLoading();
      showError("Could not load data for export: " + (err.message || err));
    });
  }

  // ─── Master render ────────────────────────────────────────
  function updateAll() {
    var agingRecords = activeAgingData();
    var turnoverByBranchRecordsForValue = activeTurnoverByBranchDataForValue();
    var turnoverByBranchRecordsForTurnover = activeTurnoverByBranchDataForTurnover();
    var turnoverBrandRecords = activeTurnoverBrandData();
    var turnoverRecords = activeTurnoverData();
    var turnoverMcRecords = S.turnoverMcData;
    var hasAging = agingRecords.length > 0;
    var hasTurnoverByBranch = S.turnoverByBranchData.length > 0;
    var hasTurnoverBrand = turnoverBrandRecords.length > 0;
    var hasTurnover = turnoverRecords.length > 0;
    var hasTurnoverMc = turnoverMcRecords.length > 0;

    if (!hasAging && !hasTurnoverByBranch && !hasTurnoverBrand && !hasTurnover && !hasTurnoverMc) {
      document.getElementById("dashboard").style.display = "none";
      document.getElementById("emptyState").style.display = "block";
      document.getElementById("emptyState").textContent =
        'No data available. Add worksheets named "' + AGING_SHEET_NAME + '", "' + TURNOVER_SHEET_NAME + '", "' + TURNOVER_BY_BRANCH_SHEET_NAME +
        '", "' + TURNOVER_BRAND_SHEET_NAME + '" and/or "' + TURNOVER_MC_SHEET_NAME + '" to this dashboard.';
      return;
    }
    document.getElementById("emptyState").style.display = "none";
    document.getElementById("dashboard").style.display = "block";

    // Both per-box "Exclude DC" toggles operate on the same
    // turnover_by_branch data, so they share one visibility check.
    var hasDcFlag = S.turnoverByBranchData.some(function (d) { return d.isDC; });
    document.getElementById("branchExcludeDcBtn").style.display = hasDcFlag ? "" : "none";
    document.getElementById("vBranchTOExcludeDcBtn").style.display = hasDcFlag ? "" : "none";

    document.getElementById("aging").style.display = hasAging ? "" : "none";
    if (hasAging) {
      drawAgingChart(agingRecords);
      drawClassAgingChart(agingRecords);
    }

    document.getElementById("kpi").style.display = (hasTurnover || hasAging) ? "" : "none";
    if (hasTurnover || hasAging) {
      var kpi = computeKPIs(turnoverRecords, agingRecords, S.agingDetailData);
      document.getElementById("kpiValue").textContent = fmtTHB(kpi.totalValue);
      document.getElementById("kpiValueSub").textContent = "";
      document.getElementById("kpiQty").textContent = fmtInt(kpi.totalQty);
      document.getElementById("kpiSku").textContent = fmtInt(kpi.sku);
      document.getElementById("kpiDead").textContent = fmtTHB(kpi.deadValue);
      document.getElementById("kpiDeadSub").textContent = pct1(kpi.deadPct) + " of stock value";
      document.getElementById("kpiAging180").textContent = fmtTHB(kpi.aging180Value);
      document.getElementById("kpiAging180Sub").textContent = pct1(kpi.aging180Pct) + " of stock value";
    }

    document.getElementById("branch").style.display = hasTurnoverByBranch ? "" : "none";
    if (hasTurnoverByBranch) drawBranches(turnoverByBranchRecordsForValue);

    document.getElementById("turnover").style.display = (hasTurnoverByBranch || hasTurnoverBrand || hasTurnoverMc) ? "" : "none";
    if (hasTurnoverByBranch) drawVendorBranchTO(turnoverByBranchRecordsForTurnover);
    if (hasTurnoverBrand) drawTurnoverByBrand(turnoverBrandRecords);
    if (hasTurnoverMc) drawTurnoverMcTop10(turnoverMcRecords);
  }

  // ─── Tableau: data loading ────────────────────────────────
  // Two fixed worksheet names, looked up by exact name (case-insensitive):
  // "aging" for section 01, "stock" for sections 02-03. No manual picker.
  // Exact match (case-sensitive) wins first — if two worksheet tabs happen
  // to normalize to the same name (e.g. "Aging" and "aging"), grabbing
  // whichever the API happens to list first would be a silent, hard-to-spot
  // wrong pick. Only falls back to case-insensitive when there's no exact
  // spelling match at all.
  function findWorksheetByName(name) {
    var worksheets = tableau.extensions.dashboardContent.dashboard.worksheets;
    for (var i = 0; i < worksheets.length; i++) {
      if (worksheets[i].name.trim() === name) return worksheets[i];
    }
    var target = name.trim().toLowerCase();
    for (var j = 0; j < worksheets.length; j++) {
      if (worksheets[j].name.trim().toLowerCase() === target) return worksheets[j];
    }
    return null;
  }

  // Reads all rows from one worksheet and resolves with extracted records.
  // Resolves to [] (rather than rejecting) when the worksheet is missing or
  // empty, so loading one sheet never blocks the other.
  function readWorksheetRecords(ws, diagOut) {
    if (!ws) { if (diagOut) diagOut.found = false; return Promise.resolve([]); }
    if (diagOut) diagOut.found = true;

    var dataPromise;
    if (typeof ws.getSummaryDataReaderAsync === "function") {
      dataPromise = ws.getSummaryDataReaderAsync().then(function (reader) {
        var allData = [];
        var allColumns = null;
        var totalPages = reader.totalPageCount;
        function readPage(pageIndex) {
          return reader.getPageAsync(pageIndex).then(function (pageData) {
            if (!allColumns && pageData.columns) allColumns = pageData.columns;
            if (pageData && pageData.data) {
              for (var i = 0; i < pageData.data.length; i++) allData.push(pageData.data[i]);
            }
            showLoading('Reading "' + ws.name + '"... ' + allData.length + " rows (" + (pageIndex + 1) + "/" + totalPages + " pages)");
            if (pageIndex + 1 < totalPages) return readPage(pageIndex + 1);
            return { columns: allColumns, data: allData };
          });
        }
        return readPage(0).then(function (result) {
          return reader.releaseAsync().then(function () { return result; });
        });
      });
    } else if (typeof ws.getSummaryDataAsync === "function") {
      dataPromise = ws.getSummaryDataAsync().then(function (dataTable) {
        return { columns: dataTable.columns, data: dataTable.data };
      });
    } else {
      return Promise.reject(new Error('Worksheet "' + ws.name + '" does not support the data reading API.'));
    }

    return dataPromise.then(function (dataTable) {
      if (!dataTable || !dataTable.columns) { if (diagOut) diagOut.rawRows = 0; return []; }
      if (diagOut) diagOut.rawRows = dataTable.data.length;
      var records = extractRecords(dataTable, diagOut);
      if (diagOut) diagOut.extractedRows = records.length;
      return records;
    });
  }

  function tierResolvedCount(records) {
    var n = 0;
    for (var i = 0; i < records.length; i++) if (records[i].tierIdx >= 0) n++;
    return n;
  }

  // True when a sheet has rows but not one of them resolved an aging tier —
  // AGING_TIER has been confirmed, across this codebase's debugging
  // history, to sometimes be dropped by the Extensions API's summary-data
  // calls even when it's a plain (non-table-calc) calculated field living
  // in the sheet's own primary, un-blended data source and rendering fine
  // in Tableau Desktop. The exact mechanism is unconfirmed; this only
  // detects the symptom so callers can try a more direct read.
  function agingTierTotallyUnresolved(records) {
    return records.length > 0 && tierResolvedCount(records) === 0;
  }

  // Last-resort read: bypass the worksheet's visual summary aggregation
  // entirely and pull rows straight from its underlying data-source
  // table(s) with every column included, not just the ones on a shelf.
  // Tried only after getSummaryDataAsync/getSummaryDataReaderAsync have
  // already failed to surface AGING_TIER, since it's heavier (no
  // view-level filtering/aggregation) and there's no guarantee a given
  // underlying table also carries the value/qty columns needed to keep a
  // row (extractRecords drops rows where both are 0) — diagOut.underlying*
  // records what was tried either way, for the diagnostic panel/export
  // warning to report even when this comes up empty.
  // Generic version of the underlying-table fallback: pick whichever
  // logical table behind `ws` scores highest under an arbitrary field
  // resolution metric, not just AGING_TIER — the same "field visible in
  // Tableau but missing from getSummaryDataAsync" symptom has since shown
  // up on BRANCH (turnover_by_branch) and BRAND/CLASS_STOCK
  // (turnover_brand) too, so every eagerly-loaded custom sheet may need
  // this same rescue.
  function readUnderlyingRecordsScored(ws, scoreFn, diagOut) {
    if (!ws || typeof ws.getUnderlyingTablesAsync !== "function") return Promise.resolve([]);
    return ws.getUnderlyingTablesAsync().then(function (tables) {
      return Promise.all(tables.map(function (t) {
        return ws.getUnderlyingTableDataAsync(t.id, { includeAllColumns: true }).then(function (dataTable) {
          var tableDiag = {};
          var records = extractRecords(dataTable, tableDiag);
          return { table: t, records: records, diag: tableDiag };
        }).catch(function (err) {
          return { table: t, records: [], diag: { error: err.message || String(err) } };
        });
      }));
    }).then(function (perTable) {
      if (diagOut) {
        diagOut.underlyingAttempts = perTable.map(function (r) {
          return (r.table.caption || r.table.id) + ": " + r.records.length + " rows, raw columns: " +
            (r.diag.rawColumnNames ? r.diag.rawColumnNames.join(" | ") : (r.diag.error || "(none)"));
        });
      }
      var best = [], bestScore = -1;
      perTable.forEach(function (r) {
        var score = scoreFn(r.records);
        if (score > bestScore) { bestScore = score; best = r.records; }
      });
      return best;
    }).catch(function () { return []; });
  }

  function readUnderlyingAgingRecords(ws, diagOut) {
    return readUnderlyingRecordsScored(ws, tierResolvedCount, diagOut);
  }

  // How many records actually resolved a given field, instead of falling
  // back to extractRecords' own placeholder default for it.
  function fieldResolvedCount(records, field, placeholder) {
    var n = 0;
    for (var i = 0; i < records.length; i++) if (records[i][field] !== placeholder) n++;
    return n;
  }

  // If `records` came back with a field totally unresolved (every row
  // still on extractRecords' placeholder default), retry via the
  // worksheet's underlying table(s) and use that instead when it's
  // actually better — otherwise keep the original (already-empty-of-that-
  // field) records rather than losing rows for no gain.
  function withFieldFallback(ws, records, field, placeholder) {
    if (records.length === 0 || fieldResolvedCount(records, field, placeholder) > 0) return Promise.resolve(records);
    return readUnderlyingRecordsScored(ws, function (recs) { return fieldResolvedCount(recs, field, placeholder); }).then(function (underlying) {
      return fieldResolvedCount(underlying, field, placeholder) > 0 ? underlying : records;
    });
  }

  // Summary of what each summary sheet actually produced — worksheet
  // found?, raw Tableau row count, how many rows survived extraction, which
  // fields got column-mapped, and any fallback used. Always hidden (its
  // container's CSS is display:none) per user request, even while a
  // fallback is active — still populated every load, so it stays
  // inspectable via dev tools (or by re-adding el.style.display = "block"
  // below) if a similar "field visible in Tableau, missing via the
  // Extensions API" issue needs revisiting.
  function renderDiagInfo(agingDiag, turnoverDiag) {
    function line(name, diag) {
      if (!diag.found) return name + ": worksheet not found";
      var cols = diag.colIndex ? Object.keys(diag.colIndex).sort().join(", ") : "(none)";
      var raw = diag.rawColumnNames ? diag.rawColumnNames.join(" | ") : "(none)";
      var out = name + ": found, " + (diag.rawRows || 0) + " raw rows -> " + (diag.extractedRows || 0) +
        " usable rows\n  mapped fields: " + (cols || "(none)") +
        "\n  RAW column names from Tableau: " + raw;
      if (diag.fallback) out += "\n  " + diag.fallback;
      return out;
    }
    var allNames = tableau.extensions.dashboardContent.dashboard.worksheets.map(function (ws) {
      return '"' + ws.name + '"';
    }).join(", ");
    var el = document.getElementById("diagInfo");
    el.textContent = "all worksheets on this dashboard: " + allNames + "\n" +
      line(AGING_SHEET_NAME, agingDiag) + "\n" + line(TURNOVER_SHEET_NAME, turnoverDiag);
  }

  function loadAllData() {
    showLoading("กำลังโหลดข้อมูลจาก Tableau...");
    hideError();

    var agingWs = findWorksheetByName(AGING_SHEET_NAME);
    var agingDetailWs = findWorksheetByName(AGING_DETAIL_SHEET_NAME);
    var turnoverByBranchWs = findWorksheetByName(TURNOVER_BY_BRANCH_SHEET_NAME);
    var turnoverBrandWs = findWorksheetByName(TURNOVER_BRAND_SHEET_NAME);
    var turnoverWs = findWorksheetByName(TURNOVER_SHEET_NAME);
    var turnoverMcWs = findWorksheetByName(TURNOVER_MC_SHEET_NAME);
    var agingDiag = {}, turnoverDiag = {}, agingDetailDiag = {};

    // aging_detail is now loaded eagerly (not just lazily on Export) — the
    // KPI row's SKU Count and Dead Stock Value read it directly, since
    // "turnover" doesn't carry CLASS_STOCK/ARTICLE_ID via the Extensions
    // API even when confirmed present in Tableau itself. Also reused below
    // as the AGING_TIER fallback candidate instead of a separate fetch.
    Promise.all([
      readWorksheetRecords(agingWs, agingDiag),
      readWorksheetRecords(agingDetailWs, agingDetailDiag),
      readWorksheetRecords(turnoverByBranchWs),
      readWorksheetRecords(turnoverBrandWs),
      readWorksheetRecords(turnoverWs, turnoverDiag),
      readWorksheetRecords(turnoverMcWs)
    ]).then(function (results) {
      var agingRecords = results[0];
      S.agingDetailData = results[1];
      S.turnoverByBranchData = results[2];
      S.turnoverBrandData = results[3];
      S.turnoverData = results[4];
      S.turnoverMcData = results[5];

      // BRANCH on turnover_by_branch and BRAND on turnover_brand have both
      // shown the same "confirmed present in Tableau, absent from
      // getSummaryDataAsync" symptom as AGING_TIER/CLASS_STOCK — retry via
      // each sheet's underlying table(s) when that happens. aging_detail's
      // own CLASS_STOCK gets the same check here — independent of whatever
      // happens with "aging"'s own AGING_TIER below, since SKU Count/Dead
      // Stock Value need aging_detail's CLASS_STOCK/ARTICLE_ID regardless
      // of whether "aging" itself ever needs aging_detail as a fallback.
      return Promise.all([
        withFieldFallback(turnoverByBranchWs, S.turnoverByBranchData, "branch", "Unspecified"),
        withFieldFallback(turnoverBrandWs, S.turnoverBrandData, "brand", ""),
        withFieldFallback(agingDetailWs, S.agingDetailData, "classStock", "Unclassified"),
        withFieldFallback(turnoverWs, S.turnoverData, "branch", "Unspecified")
      ]).then(function (fixed) {
        S.turnoverByBranchData = fixed[0];
        S.turnoverBrandData = fixed[1];
        S.agingDetailData = fixed[2];
        S.turnoverData = fixed[3];
        return continueLoad();
      });

      function continueLoad() {
        function finish() {
          S.agingData = agingRecords;
          renderDiagInfo(agingDiag, turnoverDiag);

          var titleSource = S.agingData[0] || S.turnoverData[0] || S.turnoverByBranchData[0] || S.turnoverMcData[0];
          if (titleSource && titleSource.vendorName) document.getElementById("reportTitle").textContent = titleSource.vendorName;
          document.getElementById("metaSnapshot").textContent =
            formatSnapshotDate(titleSource && titleSource.populationDate) || new Date().toISOString().slice(0, 10);

          var missing = [];
          if (!agingWs) missing.push('"' + AGING_SHEET_NAME + '"');
          if (!agingDetailWs) missing.push('"' + AGING_DETAIL_SHEET_NAME + '"');
          if (!turnoverByBranchWs) missing.push('"' + TURNOVER_BY_BRANCH_SHEET_NAME + '"');
          if (!turnoverBrandWs) missing.push('"' + TURNOVER_BRAND_SHEET_NAME + '"');
          if (!turnoverWs) missing.push('"' + TURNOVER_SHEET_NAME + '"');
          if (!turnoverMcWs) missing.push('"' + TURNOVER_MC_SHEET_NAME + '"');

          // Found the worksheet, but it produced zero usable rows — different
          // problem than "not found", and silent otherwise, so call it out
          // explicitly instead of just showing an empty section.
          var empty = [];
          if (agingWs && S.agingData.length === 0) empty.push('"' + AGING_SHEET_NAME + '"');
          if (agingDetailWs && S.agingDetailData.length === 0) empty.push('"' + AGING_DETAIL_SHEET_NAME + '"');
          if (turnoverByBranchWs && S.turnoverByBranchData.length === 0) empty.push('"' + TURNOVER_BY_BRANCH_SHEET_NAME + '"');
          if (turnoverBrandWs && S.turnoverBrandData.length === 0) empty.push('"' + TURNOVER_BRAND_SHEET_NAME + '"');
          if (turnoverWs && S.turnoverData.length === 0) empty.push('"' + TURNOVER_SHEET_NAME + '"');
          if (turnoverMcWs && S.turnoverMcData.length === 0) empty.push('"' + TURNOVER_MC_SHEET_NAME + '"');

          hideLoading();
          if (missing.length) {
            showError("Worksheet(s) not found on this dashboard: " + missing.join(", ") +
              ". Add a worksheet object named exactly that (case-insensitive) — " +
              '"' + AGING_SHEET_NAME + '" feeds section 01\'s charts, "' + AGING_DETAIL_SHEET_NAME +
              '" feeds the KPI row\'s SKU Count/Dead Stock Value (and Aging > 180 Days as a fallback), "' + TURNOVER_SHEET_NAME +
              '" feeds the rest of the KPI row, "' + TURNOVER_BY_BRANCH_SHEET_NAME + '"/"' + TURNOVER_BRAND_SHEET_NAME +
              '" feed section 02-03, "' + TURNOVER_MC_SHEET_NAME + '" feeds the Turnover-by-MC (Top10) table.');
          } else if (empty.length) {
            showError("Worksheet(s) found but produced no usable rows: " + empty.join(", ") +
              ". Every row needs UR_AMT or UR_QTY to be non-zero — check that those fields are actually " +
              "placed on the worksheet (on the Marks card, e.g. as Detail), not just present in the data " +
              "source. Open the browser dev console for a \"[VendorStockPortal] columns detected\" log " +
              "showing exactly which columns were matched.");
          } else {
            hideError();
          }
          updateAll();
        }

        // "aging" produced rows but not one of them has a resolvable tier —
        // aging_detail is already loaded above, so try it directly first,
        // then, if that's no better, read straight from its underlying
        // table(s), bypassing summary aggregation entirely.
        if (!agingTierTotallyUnresolved(agingRecords)) { finish(); return; }

        if (tierResolvedCount(S.agingDetailData) > 0) {
          agingDiag.fallback = 'AGING_TIER unresolved on every row of "' + AGING_SHEET_NAME + '" — used "' + AGING_DETAIL_SHEET_NAME +
            '" instead (' + tierResolvedCount(S.agingDetailData) + " of " + S.agingDetailData.length + " rows resolved a tier).";
          agingRecords = S.agingDetailData;
          finish();
          return;
        }

        readUnderlyingAgingRecords(agingDetailWs, agingDetailDiag).then(function (underlyingRecords) {
          if (tierResolvedCount(underlyingRecords) > 0) {
            agingDiag.fallback = 'AGING_TIER unresolved via getSummaryDataAsync on every sheet tried — used underlying table data for "' +
              AGING_DETAIL_SHEET_NAME + '" instead (' + tierResolvedCount(underlyingRecords) + " of " + underlyingRecords.length + " rows resolved a tier).";
            agingRecords = underlyingRecords;
            // The plain summary read of aging_detail was the total-loss one
            // that triggered this branch — SKU Count/Dead Stock Value would
            // otherwise keep reading that same field-poor data even though
            // the underlying-table read just proved richer.
            S.agingDetailData = underlyingRecords;
          } else {
            agingDiag.fallback = 'AGING_TIER never resolved — tried "' + AGING_SHEET_NAME + '", "' + AGING_DETAIL_SHEET_NAME +
              '" (summary), and its underlying table(s) directly. Underlying tables tried: ' +
              (agingDetailDiag.underlyingAttempts ? agingDetailDiag.underlyingAttempts.join(" || ") : "(none)") + ".";
          }
          finish();
        });
      }
    }).catch(function (err) {
      showError("Could not load data from Tableau: " + (err.message || err));
      hideLoading();
    });
  }

  function registerFilterListeners() {
    for (var i = 0; i < unregisterFns.length; i++) unregisterFns[i]();
    unregisterFns = [];
    var dashboard = tableau.extensions.dashboardContent.dashboard;
    dashboard.worksheets.forEach(function (ws) {
      var fn = function () { loadAllData(); };
      unregisterFns.push(ws.addEventListener(tableau.TableauEventType.FilterChanged, fn));
      unregisterFns.push(ws.addEventListener(tableau.TableauEventType.SummaryDataChanged, fn));
    });
  }

  // ─── Event wiring ─────────────────────────────────────────
  function attachEvents() {
    document.getElementById("errorCloseBtn").addEventListener("click", hideError);

    document.getElementById("branchExcludeDcBtn").addEventListener("click", function () {
      S.branchExcludeDC = !S.branchExcludeDC;
      this.setAttribute("aria-pressed", String(S.branchExcludeDC));
      drawBranches(activeTurnoverByBranchDataForValue());
    });
    document.getElementById("vBranchTOExcludeDcBtn").addEventListener("click", function () {
      S.vBranchTOExcludeDC = !S.vBranchTOExcludeDC;
      this.setAttribute("aria-pressed", String(S.vBranchTOExcludeDC));
      drawVendorBranchTO(activeTurnoverByBranchDataForTurnover());
    });

    document.getElementById("metricAmtBtn").addEventListener("click", function () {
      S.branchMetric = "amt";
      this.setAttribute("aria-pressed", "true"); this.classList.add("active");
      var qtyBtn = document.getElementById("metricQtyBtn");
      qtyBtn.setAttribute("aria-pressed", "false"); qtyBtn.classList.remove("active");
      drawBranches(activeTurnoverByBranchDataForValue());
    });
    document.getElementById("metricQtyBtn").addEventListener("click", function () {
      S.branchMetric = "qty";
      this.setAttribute("aria-pressed", "true"); this.classList.add("active");
      var amtBtn = document.getElementById("metricAmtBtn");
      amtBtn.setAttribute("aria-pressed", "false"); amtBtn.classList.remove("active");
      drawBranches(activeTurnoverByBranchDataForValue());
    });

    document.getElementById("fullExportBtn").addEventListener("click", exportFullReport);
    document.getElementById("branchChartExportBtn").addEventListener("click", branchChartExportCsv);
    document.getElementById("vBranchTOExportBtn").addEventListener("click", vBranchTOExportCsv);
    document.getElementById("brandTOExportBtn").addEventListener("click", brandTOExportCsv);
    document.getElementById("mcTop10ExportBtn").addEventListener("click", mcTop10ExportCsv);
  }

  // ─── Tableau bootstrap ────────────────────────────────────
  function initializeExtension() {
    tableau.extensions.initializeAsync().then(function () {
      loadAllData();
      registerFilterListeners();
      attachEvents();
    }).catch(function (err) {
      console.error("Tableau init failed:", err);
      var msg = (err && err.message) || String(err);
      if (msg.indexOf("not running inside") !== -1) {
        showError("This page is a Tableau Dashboard Extension — it only runs inside Tableau, not as a standalone webpage. Open it via Objects → Extensions → VendorStockPortal.trex on a Tableau dashboard.");
      } else {
        showError("Could not connect to Tableau: " + msg);
      }
    });
  }

  document.addEventListener("DOMContentLoaded", initializeExtension);
})();
