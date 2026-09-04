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
    avgDaily:    ["avg_daily", "avgdaily", "avg_daily_qty", "daily_sales_qty", "avg_daily_sales"]
  };

  var TIER_LABELS_FULL = [
    "0 - 60 Days", "61 - 90 Days", "91 - 120 Days", "121 - 150 Days",
    "151 - 180 Days", "181 - 270 Days", "271 - 360 Days", ">361 Days"
  ];
  var TIER_LABELS_SHORT = ["<90d", "<180d", ">180d"];
  var TIER_COLORS = ["var(--status-good)", "var(--status-warning)", "var(--status-critical)"];
  var TIER_BOUNDS = [60, 90, 120, 150, 180, 270, 360, Infinity];
  var seqColors = ["var(--seq-1)", "var(--seq-2)", "var(--seq-3)", "var(--seq-4)", "var(--seq-5)", "var(--seq-6)", "var(--seq-7)", "var(--seq-8)"];

  function tierBucket(tierIdx) { return tierIdx <= 1 ? 0 : (tierIdx <= 4 ? 1 : 2); }

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

  function buildColumnIndex(columns) {
    var index = {};
    var used = {};
    for (var ci = 0; ci < columns.length; ci++) {
      if (used[ci]) continue;
      var names = getColName(columns[ci]);
      var candidates = [];
      names.forEach(function (raw) {
        candidates.push(raw);
        var stripped = stripAgg(raw);
        if (stripped !== raw) candidates.push(stripped);
      });
      for (var field in COLUMN_MAP) {
        if (index[field] !== undefined) continue;
        var aliases = COLUMN_MAP[field];
        var matched = false;
        for (var ai = 0; ai < aliases.length && !matched; ai++) {
          var normAlias = normalize(aliases[ai]);
          for (var ni = 0; ni < candidates.length && !matched; ni++) {
            var normCand = normalize(candidates[ni]);
            if (normCand === normAlias || normCand.indexOf(normAlias) !== -1) {
              index[field] = ci; used[ci] = true; matched = true;
            }
          }
        }
        if (used[ci]) break;
      }
    }
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

  function extractRecords(dataTable) {
    var colIndex = buildColumnIndex(dataTable.columns);
    console.log("[VendorStockPortal] columns detected:", colIndex);

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

        var tierIdx = matchTierLabel(get("agingTier"));
        if (tierIdx === -1) {
          var agingDays = get("aging");
          if (agingDays !== "") tierIdx = bucketAging(parseNumber(agingDays));
        }

        rows.push({
          vendorId:    String(get("vendorId") || ""),
          vendorName:  String(get("vendorName") || ""),
          branch:      String(get("branch") || "Unspecified"),
          articleId:   String(get("articleId") || "ROW-" + (r + 1)),
          articleName: String(get("articleName") || ""),
          brand:       String(get("brand") || ""),
          mch3:        String(get("mch3") || ""),
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
          isDC:        truthy(get("isDc")),
          avgDaily:    parseNumber(get("avgDaily"))
        });
      })();
    }
    return rows;
  }

  // ─── State ────────────────────────────────────────────────
  var S = {
    data: [],
    worksheetName: "",
    excludeDC: false,
    branchMetric: "amt",
    search: "",
    sortCol: null,
    sortDir: "asc",
    vBranchActiveDims: ["branch"],
    mcActiveDims: ["mch3"]
  };
  var unregisterFns = [];
  var VBRANCH_DIM_ORDER = ["branch", "mch3", "brand"];
  var VBRANCH_DIM_LABELS = { branch: "สาขา", mch3: "MCH3", brand: "Brand" };
  var MC_DIM_ORDER = ["mch3", "mch2", "mch1", "mc", "brand", "classStock"];
  var MC_DIM_LABELS = { mch3: "MCH3", mch2: "MCH2", mch1: "MCH1", mc: "MC", brand: "Brand", classStock: "CLASS_STOCK" };

  function activeData() {
    return S.excludeDC ? S.data.filter(function (d) { return !d.isDC; }) : S.data;
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
    if (id === "classChart") {
      var legendEl = document.getElementById("classAgingLegend");
      if (legendEl) legendEl.style.display = showingTable ? "" : "none";
    }
  });

  // ─── Aggregation ──────────────────────────────────────────
  function computeKPIs(records) {
    var totalValue = 0, totalQty = 0, deadValue = 0, aging180Value = 0;
    var skuSet = {}, branchSet = {};
    records.forEach(function (d) {
      totalValue += d.urAmt;
      totalQty += d.urQty;
      skuSet[d.articleId] = true;
      branchSet[d.branch] = true;
      if (d.classStock.toLowerCase().indexOf("dead") !== -1) deadValue += d.urAmt;
      if (d.tierIdx >= 5) aging180Value += d.urAmt;
    });
    return {
      totalValue: totalValue, totalQty: totalQty,
      sku: Object.keys(skuSet).length, branchCount: Object.keys(branchSet).length,
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

  function drawAgingChart(records) {
    var agingData = buildAgingData(records);
    var tiers = agingData.agingTiers;
    var total = agingData.totalValue || 1;
    renderBars("agingChart", tiers, {
      value: function (d) { return d.value; },
      label: function (d) { return d.tier; },
      color: function (d) { return seqColors[tiers.indexOf(d)]; },
      valueLabel: function (d) { return fmtTHB(d.value) + '<span class="sub">' + pct1(100 * d.value / total) + "</span>"; },
      tipTitle: function (d) { return "Aging: " + d.tier; },
      tipRows: function (d) { return [["Stock value", fmtTHBFull(d.value)], ["% of total", pct1(100 * d.value / total)], ["Quantity", fmtInt(d.qty)]]; }
    });
    renderTable("agingChart", ["Aging tier", "Value (THB)", "% of total", "Quantity"],
      tiers.map(function (d) { return [d.tier, fmtTHBFull(d.value), pct1(100 * d.value / total), fmtInt(d.qty)]; }));
  }

  function drawClassAgingChart(records) {
    var agingData = buildAgingData(records);
    var rows = agingData.classAging;
    var agingTotalValue = agingData.totalValue || 1;
    var max = Math.max.apply(null, rows.map(function (d) { return d.total; })) || 1;

    document.getElementById("classAgingLegend").innerHTML = TIER_LABELS_SHORT.map(function (lbl, i) {
      return '<span class="item"><span class="swatch" style="background:' + TIER_COLORS[i] + '"></span>' + lbl + "</span>";
    }).join("");

    var container = document.getElementById("classChart");
    container.innerHTML = "";
    rows.forEach(function (d) {
      var w = Math.min(Math.max((d.total / max) * 100, 0.6), 100);
      var row = document.createElement("div");
      row.className = "bar-row";
      var label = document.createElement("div"); label.className = "bar-label"; label.textContent = d.name; row.appendChild(label);
      var track = document.createElement("div"); track.className = "bar-track";
      var stack = document.createElement("div"); stack.className = "bar-stack"; stack.style.width = w + "%";
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
      if (!map[d.branch]) { map[d.branch] = { branch: d.branch, value: 0, qty: 0, skuSet: {}, isDC: false }; order.push(d.branch); }
      var b = map[d.branch];
      b.value += d.urAmt; b.qty += d.urQty; b.skuSet[d.articleId] = true;
      if (d.isDC) b.isDC = true;
    });
    return order.map(function (name) {
      var b = map[name];
      return { branch: b.branch, value: b.value, qty: b.qty, sku: Object.keys(b.skuSet).length, isDC: b.isDC };
    });
  }

  var branchChartExportState = null;

  function drawBranches(records) {
    var rows = computeBranches(records);
    var isAmt = S.branchMetric === "amt";
    var metricOf = function (d) { return isAmt ? d.value : d.qty; };
    var fmtMetric = isAmt ? fmtTHB : fmtInt;
    var fmtMetricFull = isAmt ? fmtTHBFull : fmtInt;
    rows = rows.slice().sort(function (a, b) { return metricOf(b) - metricOf(a); });
    var total = rows.reduce(function (s, d) { return s + metricOf(d); }, 0) || 1;

    document.getElementById("branchChartTitle").textContent = isAmt ? "มูลค่าสต็อกตามสาขา (UR_AMT)" : "จำนวนสต็อกตามสาขา (UR_QTY)";

    var hasDcFlag = records.some(function (d) { return d.isDC; });
    document.getElementById("excludeDcBtn").style.display = hasDcFlag ? "" : "none";

    renderBars("branchChart", rows, {
      value: metricOf,
      label: function (d) { return d.branch; },
      color: function () { return "var(--accent)"; },
      valueLabel: function (d) { return fmtMetric(metricOf(d)) + '<span class="sub">' + pct1(100 * metricOf(d) / total) + "</span>"; },
      tipTitle: function (d) { return d.branch; },
      tipRows: function (d) { return [["Value (UR_AMT)", fmtTHBFull(d.value)], ["Quantity (UR_QTY)", fmtInt(d.qty)], ["% of total shown", pct1(100 * metricOf(d) / total)], ["SKUs", fmtInt(d.sku)]]; }
    });

    var headers = ["Branch", "Value (UR_AMT)", "Quantity (UR_QTY)", "% of total shown", "SKUs"];
    var tableRows = rows.map(function (d) {
      return [d.branch + (d.isDC ? " (DC)" : ""), fmtTHBFull(d.value), fmtInt(d.qty), pct1(100 * metricOf(d) / total), fmtInt(d.sku)];
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
        var g = { value: 0, qty: 0, avgDaily: 0, isDC: false };
        dims.forEach(function (d) { g[d] = r[d]; });
        groups[key] = g; order.push(key);
      }
      groups[key].value += r.urAmt;
      groups[key].qty += r.urQty;
      groups[key].avgDaily += r.avgDaily;
      if (r.isDC) groups[key].isDC = true;
    });
    return order.map(function (k) {
      var g = groups[k];
      g.to = g.avgDaily > 0 ? g.qty / g.avgDaily : 0;
      return g;
    });
  }

  var vBranchTOExportState = null;

  function drawVendorBranchTO(records) {
    var dims = VBRANCH_DIM_ORDER.filter(function (d) { return S.vBranchActiveDims.indexOf(d) !== -1; });
    var rows = aggregateByDims(records, dims).sort(function (a, b) { return b.value - a.value; });

    document.getElementById("vBranchTOTitle").textContent = "มูลค่า จำนวน และ Turnover ตาม " + dims.map(function (d) { return VBRANCH_DIM_LABELS[d]; }).join(" และ ");

    var labelW = { 1: 168, 2: 220, 3: 280 }[dims.length] || 168;
    var labelWMobile = { 1: 108, 2: 145, 3: 180 }[dims.length] || 108;
    var chartContainer = document.getElementById("vBranchTOChart");
    chartContainer.style.setProperty("--label-w", labelW + "px");
    chartContainer.style.setProperty("--label-w-mobile", labelWMobile + "px");

    function labelOf(d) { return dims.map(function (k) { return d[k]; }).join(" · "); }

    renderBars("vBranchTOChart", rows, {
      value: function (d) { return d.value; },
      label: labelOf,
      color: function () { return "var(--accent)"; },
      valueLabel: function (d) { return fmtTHB(d.value) + '<span class="sub">' + fmtInt(d.qty) + " ชิ้น · " + fmtDays(d.to) + "</span>"; },
      tipTitle: labelOf,
      tipRows: function (d) { return [["Value (UR_AMT)", fmtTHBFull(d.value)], ["Quantity (UR_QTY)", fmtInt(d.qty)], ["Turnover (days of supply)", fmtDays(d.to)]]; }
    });

    var totalValue = 0, totalQty = 0, totalAvgDaily = 0;
    rows.forEach(function (d) { totalValue += d.value; totalQty += d.qty; totalAvgDaily += d.avgDaily; });
    var totalTurnover = totalAvgDaily > 0 ? totalQty / totalAvgDaily : 0;

    var headers = dims.map(function (d) { return VBRANCH_DIM_LABELS[d]; }).concat(["Value (THB)", "Quantity", "Turnover"]);
    var tableRows = rows.map(function (d) {
      var cells = dims.map(function (k) { return d[k] + (k === "branch" && d.isDC ? " (DC)" : ""); });
      return cells.concat([fmtTHBFull(d.value), fmtInt(d.qty), fmtDays(d.to)]);
    });
    tableRows.push(dims.map(function (d, i) { return i === 0 ? "Total" : ""; }).concat([fmtTHBFull(totalValue), fmtInt(totalQty), fmtDays(totalTurnover)]));
    renderTable("vBranchTOChart", headers, tableRows);
    vBranchTOExportState = { headers: headers, rows: tableRows };
  }

  var mcExportState = null;

  function renderMcTable(records) {
    var dims = MC_DIM_ORDER.filter(function (d) { return S.mcActiveDims.indexOf(d) !== -1; });
    var rows = aggregateByDims(records, dims).sort(function (a, b) { return b.value - a.value; });

    var totalValue = 0, totalQty = 0, totalAvgDaily = 0;
    rows.forEach(function (d) { totalValue += d.value; totalQty += d.qty; totalAvgDaily += d.avgDaily; });
    var totalTurnover = totalAvgDaily > 0 ? totalQty / totalAvgDaily : 0;

    var headers = dims.map(function (d) { return MC_DIM_LABELS[d]; }).concat(["Value (THB)", "Quantity", "Turnover"]);
    var tableRows = rows.map(function (d) {
      return dims.map(function (k) { return d[k]; }).concat([fmtTHBFull(d.value), fmtInt(d.qty), fmtDays(d.to)]);
    });
    tableRows.push(dims.map(function (d, i) { return i === 0 ? "Total" : ""; }).concat([fmtTHBFull(totalValue), fmtInt(totalQty), fmtDays(totalTurnover)]));

    var html = '<table class="data-table"><thead><tr>';
    headers.forEach(function (h) { html += "<th>" + h + "</th>"; });
    html += "</tr></thead><tbody>";
    tableRows.forEach(function (r) { html += "<tr>"; r.forEach(function (c) { html += "<td>" + c + "</td>"; }); html += "</tr>"; });
    html += "</tbody></table>";
    document.getElementById("mchFlatTableWrap").innerHTML = html;
    mcExportState = { headers: headers, rows: tableRows };
  }

  // ─── SKU detail table ───────────────────────────────────────
  function renderDetail(records) {
    var search = S.search.toLowerCase();
    var filtered = records.filter(function (d) {
      if (!search) return true;
      return (d.articleId + d.articleName + d.branch + d.brand).toLowerCase().indexOf(search) !== -1;
    });
    if (S.sortCol) {
      var col = S.sortCol, dir = S.sortDir === "asc" ? 1 : -1;
      filtered.sort(function (a, b) {
        var av = a[col], bv = b[col];
        if (typeof av === "number") return (av - bv) * dir;
        return String(av).localeCompare(String(bv)) * dir;
      });
    }
    document.getElementById("rowCount").textContent = fmtInt(filtered.length);
    var body = document.getElementById("dBody");
    body.innerHTML = "";
    filtered.slice(0, 3000).forEach(function (d) {
      var tr = document.createElement("tr");
      [d.branch, d.articleId, d.articleName, d.brand, d.mch3, d.classStock,
       d.tierIdx >= 0 ? TIER_LABELS_FULL[d.tierIdx] : "-", fmtInt(d.urQty), fmtTHB(d.urAmt)]
        .forEach(function (val) { var td = document.createElement("td"); td.textContent = val; tr.appendChild(td); });
      body.appendChild(tr);
    });
    S._filtered = filtered;
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
  function mchExportCsv() {
    if (!mcExportState) return;
    downloadCsv(mcExportState.headers, mcExportState.rows, "vendor_mc_breakdown.csv");
  }
  function exportCsv() {
    var rows = S._filtered || [];
    var headers = ["BRANCH", "ARTICLE_ID", "ARTICLE_NAME_TH", "BRAND", "MCH3", "CLASS_STOCK", "AGING_TIER", "UR_QTY", "UR_AMT"];
    var tableRows = rows.map(function (d) {
      return [d.branch, d.articleId, d.articleName, d.brand, d.mch3, d.classStock,
        d.tierIdx >= 0 ? TIER_LABELS_FULL[d.tierIdx] : "", d.urQty, d.urAmt];
    });
    downloadCsv(headers, tableRows, "vendor_stock_sku_detail.csv");
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

  function exportFullReport() {
    var records = activeData();
    if (records.length === 0) return;

    var detailHeaders = ["BRANCH", "ARTICLE_ID", "ARTICLE_NAME_TH", "BRAND", "MCH3", "MCH2", "ITEM_FLAG", "CLASS_STOCK", "AGING_TIER", "UR_QTY", "UR_AMT"];
    var detailRows = records.map(function (d) {
      return [d.branch, d.articleId, d.articleName, d.brand, d.mch3, d.mch2, d.itemFlag, d.classStock,
        d.tierIdx >= 0 ? TIER_LABELS_FULL[d.tierIdx] : "", d.urQty, d.urAmt];
    });

    var branchRows = computeBranches(records);
    var branchHeaders = ["BRANCH", "VALUE_UR_AMT", "QUANTITY_UR_QTY", "SKU_COUNT"];
    var branchXlsRows = branchRows.map(function (d) { return [d.branch, d.value, d.qty, d.sku]; });

    var sheets = xlsSheetXml("Stock detail", detailHeaders, detailRows, [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1]) +
      xlsSheetXml("Branch summary", branchHeaders, branchXlsRows, [0, 1, 1, 1]);

    var hasTurnover = records.some(function (d) { return d.avgDaily > 0; });
    if (hasTurnover) {
      var branchTO = aggregateByDims(records, ["branch"]).sort(function (a, b) { return b.value - a.value; });
      var toHeaders = ["BRANCH", "VALUE_UR_AMT", "QUANTITY_UR_QTY", "TURNOVER_DAYS"];
      var toRows = branchTO.map(function (d) { return [d.branch, d.value, d.qty, Math.round(d.to * 10) / 10]; });
      sheets += xlsSheetXml("Turnover by branch", toHeaders, toRows, [0, 1, 1, 1]);

      var mcTO = aggregateByDims(records, ["mch3"]).sort(function (a, b) { return b.value - a.value; });
      var mcHeaders = ["MCH3", "VALUE_UR_AMT", "QUANTITY_UR_QTY", "TURNOVER_DAYS"];
      var mcRows = mcTO.map(function (d) { return [d.mch3, d.value, d.qty, Math.round(d.to * 10) / 10]; });
      sheets += xlsSheetXml("Turnover by MC", mcHeaders, mcRows, [0, 1, 1, 1]);
    }

    var xml = '<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>' +
      '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet" xmlns:html="http://www.w3.org/TR/REC-html40">' +
      '<Styles><Style ss:ID="Header"><Font ss:Bold="1"/></Style></Styles>' + sheets + "</Workbook>";

    var blob = new Blob([xml], { type: "application/vnd.ms-excel" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "vendor_stock_full_export.xls";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  // ─── Master render ────────────────────────────────────────
  function updateAll() {
    var records = activeData();
    if (records.length === 0) {
      document.getElementById("dashboard").style.display = "none";
      document.getElementById("emptyState").style.display = "block";
      document.getElementById("emptyState").textContent = "No rows match the current filter/exclude-DC selection.";
      return;
    }
    document.getElementById("emptyState").style.display = "none";
    document.getElementById("dashboard").style.display = "block";

    var kpi = computeKPIs(records);
    document.getElementById("kpiValue").textContent = fmtTHB(kpi.totalValue);
    document.getElementById("kpiValueSub").textContent = "";
    document.getElementById("kpiQty").textContent = fmtInt(kpi.totalQty);
    document.getElementById("kpiSku").textContent = fmtInt(kpi.sku);
    document.getElementById("kpiDead").textContent = fmtTHB(kpi.deadValue);
    document.getElementById("kpiDeadSub").textContent = pct1(kpi.deadPct) + " of stock value";
    document.getElementById("kpiAging180").textContent = fmtTHB(kpi.aging180Value);
    document.getElementById("kpiAging180Sub").textContent = pct1(kpi.aging180Pct) + " of stock value";

    drawAgingChart(records);
    drawClassAgingChart(records);
    drawBranches(records);

    var hasTurnover = records.some(function (d) { return d.avgDaily > 0; });
    document.getElementById("turnover").style.display = hasTurnover ? "" : "none";
    if (hasTurnover) {
      drawVendorBranchTO(records);
      renderMcTable(records);
    }

    renderDetail(records);
  }

  // ─── Tableau: data loading ────────────────────────────────
  function getSelectedWorksheet() {
    var dashboard = tableau.extensions.dashboardContent.dashboard;
    var name = S.worksheetName;
    if (!name) return null;
    var worksheets = dashboard.worksheets;
    for (var i = 0; i < worksheets.length; i++) {
      if (worksheets[i].name === name) return worksheets[i];
    }
    return null;
  }

  function loadWorksheetData() {
    var ws = getSelectedWorksheet();
    if (!ws) { showError('Worksheet "' + S.worksheetName + '" not found.'); hideLoading(); return; }

    showLoading('Reading data from worksheet "' + ws.name + '"...');
    hideError();

    try {
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
              showLoading("Reading data... " + allData.length + " rows (" + (pageIndex + 1) + "/" + totalPages + " pages)");
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
        showError("This worksheet does not support the data reading API.");
        hideLoading();
        return;
      }

      dataPromise.then(function (dataTable) {
        try {
          if (!dataTable || !dataTable.columns) { showError("Could not read data — dataTable or columns is null."); hideLoading(); return; }
          var records = extractRecords(dataTable);
          if (records.length === 0) {
            showError("No usable rows found. Check that BRANCH, ARTICLE_ID, UR_AMT/UR_QTY columns exist on this worksheet.");
            hideLoading();
            return;
          }
          S.data = records;
          if (records[0].vendorName) document.getElementById("reportTitle").textContent = records[0].vendorName;
          hideError(); hideLoading();
          updateAll();
        } catch (innerErr) {
          showError("Error processing data: " + innerErr.message);
          hideLoading();
        }
      }).catch(function (err) {
        showError("Could not load data from worksheet: " + (err.message || err));
        hideLoading();
      });
    } catch (outerErr) {
      showError("Error: " + outerErr.message);
      hideLoading();
    }
  }

  function registerFilterListeners() {
    for (var i = 0; i < unregisterFns.length; i++) unregisterFns[i]();
    unregisterFns = [];
    var dashboard = tableau.extensions.dashboardContent.dashboard;
    dashboard.worksheets.forEach(function (ws) {
      var fn = function () { if (ws.name === S.worksheetName) loadWorksheetData(); };
      unregisterFns.push(ws.addEventListener(tableau.TableauEventType.FilterChanged, fn));
      unregisterFns.push(ws.addEventListener(tableau.TableauEventType.SummaryDataChanged, fn));
    });
  }

  // ─── Event wiring ─────────────────────────────────────────
  function attachEvents() {
    document.getElementById("errorCloseBtn").addEventListener("click", hideError);

    document.getElementById("loadDataBtn").addEventListener("click", function () {
      var sel = document.getElementById("worksheetSelect");
      S.worksheetName = sel.value;
      if (!S.worksheetName || S.worksheetName.indexOf("--") === 0) return;
      tableau.extensions.settings.set("worksheet", S.worksheetName);
      tableau.extensions.settings.saveAsync().then(function () {
        loadWorksheetData();
        registerFilterListeners();
      });
    });

    document.getElementById("settingsToggle").addEventListener("click", function () {
      document.getElementById("settingsBar").style.display = "flex";
    });
    document.getElementById("settingsClose").addEventListener("click", function () {
      document.getElementById("settingsBar").style.display = "none";
    });

    document.getElementById("excludeDcBtn").addEventListener("click", function () {
      S.excludeDC = !S.excludeDC;
      this.setAttribute("aria-pressed", String(S.excludeDC));
      updateAll();
    });

    document.getElementById("metricAmtBtn").addEventListener("click", function () {
      S.branchMetric = "amt";
      this.setAttribute("aria-pressed", "true"); this.classList.add("active");
      var qtyBtn = document.getElementById("metricQtyBtn");
      qtyBtn.setAttribute("aria-pressed", "false"); qtyBtn.classList.remove("active");
      drawBranches(activeData());
    });
    document.getElementById("metricQtyBtn").addEventListener("click", function () {
      S.branchMetric = "qty";
      this.setAttribute("aria-pressed", "true"); this.classList.add("active");
      var amtBtn = document.getElementById("metricAmtBtn");
      amtBtn.setAttribute("aria-pressed", "false"); amtBtn.classList.remove("active");
      drawBranches(activeData());
    });

    document.getElementById("fullExportBtn").addEventListener("click", exportFullReport);
    document.getElementById("branchChartExportBtn").addEventListener("click", branchChartExportCsv);
    document.getElementById("vBranchTOExportBtn").addEventListener("click", vBranchTOExportCsv);
    document.getElementById("mchExportBtn").addEventListener("click", mchExportCsv);
    document.getElementById("exportCsvBtn").addEventListener("click", exportCsv);

    [["vBranchDimBranch", "branch"], ["vBranchDimMch3", "mch3"], ["vBranchDimBrand", "brand"]].forEach(function (pair) {
      document.getElementById(pair[0]).addEventListener("click", function () {
        var dim = pair[1];
        var idx = S.vBranchActiveDims.indexOf(dim);
        if (idx !== -1) {
          if (S.vBranchActiveDims.length === 1) return;
          S.vBranchActiveDims.splice(idx, 1);
          this.setAttribute("aria-pressed", "false");
        } else {
          S.vBranchActiveDims.push(dim);
          this.setAttribute("aria-pressed", "true");
        }
        drawVendorBranchTO(activeData());
      });
    });

    MC_DIM_ORDER.forEach(function (dim) {
      var btnId = "mcDim" + dim.charAt(0).toUpperCase() + dim.slice(1);
      var el = document.getElementById(btnId);
      if (!el) return;
      el.addEventListener("click", function () {
        var idx = S.mcActiveDims.indexOf(dim);
        if (idx !== -1) {
          if (S.mcActiveDims.length === 1) return;
          S.mcActiveDims.splice(idx, 1);
          this.setAttribute("aria-pressed", "false");
        } else {
          S.mcActiveDims.push(dim);
          this.setAttribute("aria-pressed", "true");
        }
        renderMcTable(activeData());
      });
    });

    document.getElementById("searchBox").addEventListener("input", function () {
      S.search = this.value;
      renderDetail(activeData());
    });
    document.querySelectorAll("[data-col]").forEach(function (th) {
      th.addEventListener("click", function () {
        var col = th.dataset.col;
        if (S.sortCol === col) S.sortDir = S.sortDir === "asc" ? "desc" : "asc";
        else { S.sortCol = col; S.sortDir = "asc"; }
        renderDetail(activeData());
      });
    });
  }

  // ─── Tableau bootstrap ────────────────────────────────────
  function initializeExtension() {
    tableau.extensions.initializeAsync({ configure: function () { document.getElementById("settingsBar").style.display = "flex"; } }).then(function () {
      var dashboard = tableau.extensions.dashboardContent.dashboard;
      var sel = document.getElementById("worksheetSelect");
      dashboard.worksheets.forEach(function (ws) {
        var opt = document.createElement("option");
        opt.value = ws.name; opt.textContent = ws.name;
        sel.appendChild(opt);
      });

      var saved = tableau.extensions.settings.get("worksheet");
      if (saved) {
        sel.value = saved;
        S.worksheetName = saved;
        loadWorksheetData();
        registerFilterListeners();
      } else {
        document.getElementById("settingsBar").style.display = "flex";
      }

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
