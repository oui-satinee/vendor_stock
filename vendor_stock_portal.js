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
    isDc:        ["is_dc", "isdc", "dc_flag", "dcflag"]
  };

  var TIER_LABELS = [
    "0 - 60 Days", "61 - 90 Days", "91 - 120 Days", "121 - 150 Days",
    "151 - 180 Days", "181 - 270 Days", "271 - 360 Days", ">361 Days"
  ];
  var TIER_BOUNDS = [60, 90, 120, 150, 180, 270, 360, Infinity];
  var GROUP_COLOR = ["var(--status-good)", "var(--status-warning)", "var(--status-critical)"];

  function tierGroup(tierIdx) {
    if (tierIdx <= 1) return 0; // <90d
    if (tierIdx <= 4) return 1; // <180d
    return 2;                  // >180d
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
    for (var i = 0; i < TIER_LABELS.length; i++) {
      if (norm.indexOf(TIER_LABELS[i].toLowerCase()) !== -1) return i;
    }
    return -1;
  }

  function normalize(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, "");
  }

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
              index[field] = ci;
              used[ci] = true;
              matched = true;
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
          itemFlag:    String(get("itemFlag") || ""),
          classStock:  String(get("classStock") || "Unclassified"),
          tierIdx:     tierIdx,
          urAmt:       urAmt,
          urQty:       urQty,
          reserveAmt:  parseNumber(get("reserveAmt")),
          reserveQty:  parseNumber(get("reserveQty")),
          remainAmt:   parseNumber(get("remainAmt")),
          remainQty:   parseNumber(get("remainQty")),
          isDc:        truthy(get("isDc"))
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
    sortDir: "asc"
  };
  var unregisterFns = [];

  function activeData() {
    return S.excludeDC ? S.data.filter(function (d) { return !d.isDc; }) : S.data;
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
    var html = '<div class="tt-title">' + title + '</div>';
    rows.forEach(function (r) { html += '<div class="tt-row"><span>' + r[0] + '</span><span>' + r[1] + '</span></div>'; });
    tooltip.innerHTML = html; tooltip.classList.add("show"); moveTip(evt);
  }
  function moveTip(evt) {
    var x = evt.clientX + 16, y = evt.clientY + 16, vw = window.innerWidth, vh = window.innerHeight;
    tooltip.style.left = Math.min(x, vw - 280) + "px";
    tooltip.style.top = Math.min(y, vh - 90) + "px";
  }
  function hideTip() { tooltip.classList.remove("show"); }

  function fmtTHB(n) {
    var abs = Math.abs(n);
    if (abs >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (abs >= 1e3) return (n / 1e3).toFixed(0) + "K";
    return Math.round(n).toLocaleString("en-US");
  }
  function fmtInt(n) { return Math.round(n).toLocaleString("en-US"); }
  function pct1(n) { return n.toFixed(1) + "%"; }

  function renderBars(containerId, data, opts) {
    var el = document.getElementById(containerId);
    var max = opts.max || Math.max.apply(null, data.map(opts.value)) || 1;
    el.innerHTML = "";
    data.forEach(function (d) {
      var v = opts.value(d);
      var w = Math.min(Math.max((v / max) * 100, 0.6), 100);
      var row = document.createElement("div");
      row.className = "bar-row"; row.tabIndex = 0;
      var label = document.createElement("div"); label.className = "bar-label"; label.textContent = opts.label(d); row.appendChild(label);
      var track = document.createElement("div"); track.className = "bar-track";
      var fill = document.createElement("div"); fill.className = "bar-fill"; fill.style.width = w + "%"; fill.style.background = opts.color(d);
      track.appendChild(fill); row.appendChild(track);
      var valueEl = document.createElement("div"); valueEl.className = "bar-value"; valueEl.textContent = opts.valueLabel(d); row.appendChild(valueEl);
      var tipFn = function (evt) { showTip(evt, opts.tipTitle(d), opts.tipRows(d)); };
      row.addEventListener("mouseenter", tipFn);
      row.addEventListener("mousemove", moveTip);
      row.addEventListener("mouseleave", hideTip);
      el.appendChild(row);
    });
  }

  function renderStackedBars(containerId, groups) {
    // groups: [{ name, total, segs: [{value, group}] }]
    var el = document.getElementById(containerId);
    var max = Math.max.apply(null, groups.map(function (g) { return g.total; })) || 1;
    el.innerHTML = "";
    groups.forEach(function (g) {
      var row = document.createElement("div");
      row.className = "bar-row";
      var label = document.createElement("div"); label.className = "bar-label"; label.textContent = g.name; row.appendChild(label);
      var track = document.createElement("div"); track.className = "bar-track"; track.style.display = "flex";
      var w = Math.min(Math.max((g.total / max) * 100, 0.6), 100);
      track.style.width = "100%";
      var inner = document.createElement("div");
      inner.style.display = "flex"; inner.style.width = w + "%"; inner.style.height = "100%";
      g.segs.forEach(function (s) {
        if (s.value <= 0) return;
        var seg = document.createElement("div");
        seg.style.height = "100%";
        seg.style.width = (s.value / g.total * 100) + "%";
        seg.style.background = GROUP_COLOR[s.group];
        inner.appendChild(seg);
      });
      track.appendChild(inner);
      row.appendChild(track);
      var valueEl = document.createElement("div"); valueEl.className = "bar-value"; valueEl.textContent = fmtTHB(g.total); row.appendChild(valueEl);
      el.appendChild(row);
    });
  }

  // ─── Aggregation ──────────────────────────────────────────
  function computeKPIs(records) {
    var totalValue = 0, deadValue = 0, aging180Value = 0;
    var skuSet = {}, branchSet = {};
    records.forEach(function (d) {
      totalValue += d.urAmt;
      skuSet[d.articleId] = true;
      branchSet[d.branch] = true;
      if (d.classStock.toLowerCase().indexOf("dead") !== -1) deadValue += d.urAmt;
      if (d.tierIdx >= 5) aging180Value += d.urAmt;
    });
    return {
      totalValue: totalValue,
      sku: Object.keys(skuSet).length,
      branchCount: Object.keys(branchSet).length,
      deadValue: deadValue,
      deadPct: totalValue ? deadValue / totalValue * 100 : 0,
      aging180Value: aging180Value,
      aging180Pct: totalValue ? aging180Value / totalValue * 100 : 0
    };
  }

  function computeAgingTiers(records) {
    var tiers = TIER_LABELS.map(function (t) { return { tier: t, value: 0, qty: 0 }; });
    var unclassified = 0;
    records.forEach(function (d) {
      if (d.tierIdx >= 0 && d.tierIdx < tiers.length) {
        tiers[d.tierIdx].value += d.urAmt;
        tiers[d.tierIdx].qty += d.urQty;
      } else {
        unclassified += d.urAmt;
      }
    });
    return { tiers: tiers, unclassified: unclassified };
  }

  function computeClassAging(records) {
    var classes = {};
    var order = [];
    records.forEach(function (d) {
      if (!classes[d.classStock]) { classes[d.classStock] = [0, 0, 0]; order.push(d.classStock); }
      if (d.tierIdx >= 0) classes[d.classStock][tierGroup(d.tierIdx)] += d.urAmt;
    });
    return order.sort().map(function (name) {
      var segs = classes[name];
      var total = segs[0] + segs[1] + segs[2];
      return {
        name: name, total: total,
        segs: [{ value: segs[0], group: 0 }, { value: segs[1], group: 1 }, { value: segs[2], group: 2 }]
      };
    }).filter(function (g) { return g.total > 0; });
  }

  function computeBranches(records) {
    var map = {};
    var order = [];
    records.forEach(function (d) {
      if (!map[d.branch]) { map[d.branch] = { branch: d.branch, value: 0, qty: 0, skuSet: {}, isDc: false }; order.push(d.branch); }
      var b = map[d.branch];
      b.value += d.urAmt;
      b.qty += d.urQty;
      b.skuSet[d.articleId] = true;
      if (d.isDc) b.isDc = true;
    });
    return order.map(function (name) {
      var b = map[name];
      return { branch: b.branch, value: b.value, qty: b.qty, sku: Object.keys(b.skuSet).length, isDc: b.isDc };
    }).sort(function (a, b) { return b.value - a.value; });
  }

  // ─── Render ───────────────────────────────────────────────
  function updateAll() {
    var records = activeData();
    if (records.length === 0) {
      document.getElementById("dashboard").style.display = "none";
      document.getElementById("emptyState").style.display = "block";
      document.getElementById("emptyState").textContent = "No rows match the current filter/exclude-DC selection.";
      return;
    }
    document.getElementById("emptyState").style.display = "none";
    document.getElementById("dashboard").style.display = "";

    var kpi = computeKPIs(records);
    document.getElementById("kpiValue").textContent = fmtTHB(kpi.totalValue);
    document.getElementById("kpiSku").textContent = fmtInt(kpi.sku);
    document.getElementById("kpiBranches").textContent = fmtInt(kpi.branchCount);
    document.getElementById("kpiDead").textContent = fmtTHB(kpi.deadValue);
    document.getElementById("kpiDeadSub").textContent = pct1(kpi.deadPct) + " of stock value";
    document.getElementById("kpiAging180").textContent = fmtTHB(kpi.aging180Value);
    document.getElementById("kpiAging180Sub").textContent = pct1(kpi.aging180Pct) + " of stock value";

    var agingData = computeAgingTiers(records).tiers;
    var agingTotal = agingData.reduce(function (s, d) { return s + d.value; }, 0) || 1;
    renderBars("agingChart", agingData, {
      label: function (d) { return d.tier; },
      value: function (d) { return d.value; },
      color: function (d) { return GROUP_COLOR[tierGroup(agingData.indexOf(d))]; },
      valueLabel: function (d) { return fmtTHB(d.value) + " " + pct1(d.value / agingTotal * 100); },
      tipTitle: function (d) { return d.tier; },
      tipRows: function (d) { return [["Value", fmtTHB(d.value)], ["Qty", fmtInt(d.qty)]]; }
    });

    renderStackedBars("classAgingChart", computeClassAging(records));

    var branchData = computeBranches(records);
    var hasDcFlag = records.some(function (d) { return d.isDc; });
    document.getElementById("excludeDcBtn").style.display = hasDcFlag ? "" : "none";
    var branchTotal = branchData.reduce(function (s, d) { return s + (S.branchMetric === "amt" ? d.value : d.qty); }, 0) || 1;
    renderBars("branchChart", branchData, {
      label: function (d) { return d.branch + (d.isDc ? " (DC)" : ""); },
      value: function (d) { return S.branchMetric === "amt" ? d.value : d.qty; },
      color: function () { return "var(--accent)"; },
      valueLabel: function (d) {
        var v = S.branchMetric === "amt" ? d.value : d.qty;
        return (S.branchMetric === "amt" ? fmtTHB(v) : fmtInt(v)) + " " + pct1(v / branchTotal * 100);
      },
      tipTitle: function (d) { return d.branch; },
      tipRows: function (d) { return [["UR_AMT", fmtTHB(d.value)], ["UR_QTY", fmtInt(d.qty)], ["SKU", fmtInt(d.sku)]]; }
    });

    renderDetail(records);
  }

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

    document.getElementById("rowCount").textContent =
      filtered.length > 3000 ? ("Showing first 3,000 of " + fmtInt(filtered.length) + " filtered rows") : (fmtInt(filtered.length) + " rows");

    var body = document.getElementById("dBody");
    body.innerHTML = "";
    filtered.slice(0, 3000).forEach(function (d) {
      var tr = document.createElement("tr");
      [d.branch, d.articleId, d.articleName, d.brand, d.mch3, d.classStock,
       d.tierIdx >= 0 ? TIER_LABELS[d.tierIdx] : "-", fmtInt(d.urQty), fmtTHB(d.urAmt)]
        .forEach(function (val) {
          var td = document.createElement("td");
          td.textContent = val;
          tr.appendChild(td);
        });
      body.appendChild(tr);
    });

    S._filtered = filtered;
  }

  function exportCsv() {
    var rows = S._filtered || [];
    var headers = ["BRANCH", "ARTICLE_ID", "ARTICLE_NAME_TH", "BRAND", "MCH3", "CLASS_STOCK", "AGING_TIER", "UR_QTY", "UR_AMT"];
    var lines = [headers.join(",")];
    rows.forEach(function (d) {
      var line = [d.branch, d.articleId, d.articleName, d.brand, d.mch3, d.classStock,
        d.tierIdx >= 0 ? TIER_LABELS[d.tierIdx] : "", d.urQty, d.urAmt]
        .map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(",");
      lines.push(line);
    });
    var blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "vendor_stock_sku_export_" + new Date().toISOString().slice(0, 10) + ".csv";
    a.click();
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
    if (!ws) {
      showError('Worksheet "' + S.worksheetName + '" not found.');
      hideLoading();
      return;
    }

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
          if (!dataTable || !dataTable.columns) {
            showError("Could not read data — dataTable or columns is null.");
            hideLoading();
            return;
          }
          var records = extractRecords(dataTable);
          if (records.length === 0) {
            showError("No usable rows found. Check that BRANCH, ARTICLE_ID, UR_AMT/UR_QTY columns exist on this worksheet.");
            hideLoading();
            return;
          }
          S.data = records;
          if (records[0].vendorName) {
            document.getElementById("reportTitle").textContent = records[0].vendorName;
          }
          hideError();
          hideLoading();
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
      var fn = function () {
        if (ws.name === S.worksheetName) loadWorksheetData();
      };
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
      this.setAttribute("aria-pressed", "true");
      document.getElementById("metricQtyBtn").setAttribute("aria-pressed", "false");
      updateAll();
    });
    document.getElementById("metricQtyBtn").addEventListener("click", function () {
      S.branchMetric = "qty";
      this.setAttribute("aria-pressed", "true");
      document.getElementById("metricAmtBtn").setAttribute("aria-pressed", "false");
      updateAll();
    });

    document.getElementById("exportCsvBtn").addEventListener("click", exportCsv);
    document.getElementById("searchBox").addEventListener("input", function () {
      S.search = this.value;
      renderDetail(activeData());
    });
    document.querySelectorAll(".d-table th[data-col]").forEach(function (th) {
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
        opt.value = ws.name;
        opt.textContent = ws.name;
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
