'use strict';

// ── Colors ────────────────────────────────────────────────────────────────────
const T_COLOR = '#3b5bdb'; // target  (blue)
const C_COLOR = '#d97706'; // compare (orange)

// ── State ─────────────────────────────────────────────────────────────────────
let targetFile  = null;
let compareFile = null;
let chartInstances = {};
let lastResult  = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const targetZone   = document.getElementById('targetZone');
const targetInput  = document.getElementById('targetInput');
const targetInfo   = document.getElementById('targetInfo');
const targetName   = document.getElementById('targetName');
const targetMeta   = document.getElementById('targetMeta');
const targetClear  = document.getElementById('targetClear');

const compareZone  = document.getElementById('compareZone');
const compareInput = document.getElementById('compareInput');
const compareInfo  = document.getElementById('compareInfo');
const compareName  = document.getElementById('compareName');
const compareMeta  = document.getElementById('compareMeta');
const compareClear = document.getElementById('compareClear');

const analyzeBtn     = document.getElementById('analyzeBtn');
const btnIcon        = document.getElementById('btnIcon');
const btnLabel       = document.getElementById('btnLabel');
const uploadHint     = document.getElementById('uploadHint');
const errorAlert     = document.getElementById('errorAlert');
const errorText      = document.getElementById('errorText');
const resultsSection = document.getElementById('resultsSection');

// ── Drop-zone wiring ──────────────────────────────────────────────────────────
function wireZone(zone, input, setFn) {
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', e => {
    if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over');
  });
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) setFn(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', e => { if (e.target.files[0]) setFn(e.target.files[0]); });
}

wireZone(targetZone, targetInput, setTargetFile);
wireZone(compareZone, compareInput, setCompareFile);

function setTargetFile(f) {
  hideError();
  if (!f.name.toLowerCase().endsWith('.csv')) { showError('CSVファイル(.csv)を選択してください'); return; }
  targetFile = f;
  targetName.textContent = f.name;
  targetMeta.textContent = `${(f.size / 1024).toFixed(1)} KB`;
  targetInfo.classList.remove('hidden');
  targetZone.classList.add('has-file');
  updateBtn();
}

function setCompareFile(f) {
  hideError();
  if (!f.name.toLowerCase().endsWith('.csv')) { showError('CSVファイル(.csv)を選択してください'); return; }
  compareFile = f;
  compareName.textContent = f.name;
  compareMeta.textContent = `${(f.size / 1024).toFixed(1)} KB`;
  compareInfo.classList.remove('hidden');
  compareZone.classList.add('has-file');
  updateBtn();
}

targetClear.addEventListener('click', () => {
  targetFile = null;
  targetInfo.classList.add('hidden');
  targetZone.classList.remove('has-file');
  targetInput.value = '';
  updateBtn();
});

compareClear.addEventListener('click', () => {
  compareFile = null;
  compareInfo.classList.add('hidden');
  compareZone.classList.remove('has-file');
  compareInput.value = '';
  updateBtn();
});

function updateBtn() {
  const ready = !!(targetFile && compareFile);
  analyzeBtn.disabled = !ready;
  uploadHint.textContent = ready
    ? '2つのCSVが揃いました。比較分析を開始してください'
    : '2つのCSVをアップロードすると比較分析できます';
}

// ── Analyze ───────────────────────────────────────────────────────────────────
analyzeBtn.addEventListener('click', async () => {
  if (!targetFile || !compareFile) return;
  analyzeBtn.disabled  = true;
  btnIcon.innerHTML    = '<span class="spinner"></span>';
  btnLabel.textContent = '処理中...';
  hideError();

  const fd = new FormData();
  fd.append('target',  targetFile);
  fd.append('compare', compareFile);

  try {
    const res  = await fetch('/api/compare', { method: 'POST', body: fd });
    const json = await res.json();
    if (!res.ok) { showError(json.error || 'サーバーエラーが発生しました'); return; }

    lastResult = json;
    renderAll(json);
    resultsSection.classList.remove('hidden');
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    uploadHint.textContent =
      `比較完了 — 対象: ${json.rowCount.target}件 / 比較: ${json.rowCount.compare}件`;
  } catch (err) {
    showError('通信エラーが発生しました: ' + err.message);
  } finally {
    analyzeBtn.disabled  = false;
    btnIcon.textContent  = '▶';
    btnLabel.textContent = '再分析';
  }
});

// ── Render all ────────────────────────────────────────────────────────────────
function renderAll(data) {
  Object.values(chartInstances).forEach(c => c.destroy());
  chartInstances = {};
  renderSummaryTable(data.summary);
  renderMetricsGrid(data);
  renderSupplementGrid(data);
  renderChannelTable(data);
}

// ── Summary comparison table ──────────────────────────────────────────────────
const SUMMARY_ROWS = [
  { key: 'totalCost',     label: '広告費合計',   fmt: fmtYen,      deltaFmt: fmtDeltaYen, higherBetter: false },
  { key: 'totalVisitors', label: '訪問者数合計', fmt: fmtNum,      deltaFmt: fmtDeltaNum, higherBetter: true  },
  { key: 'totalCV',       label: 'CV数合計',      fmt: fmtNum,      deltaFmt: fmtDeltaNum, higherBetter: true  },
  { key: 'avgCVR',        label: '平均CVR',       fmt: v => `${v}%`, deltaFmt: fmtDeltaPct, higherBetter: true  },
  { key: 'avgCPA',        label: '平均CPA',       fmt: fmtYen,      deltaFmt: fmtDeltaYen, higherBetter: false },
  { key: 'avgCPC',        label: '平均CPC',       fmt: fmtYen,      deltaFmt: fmtDeltaYen, higherBetter: false },
];

function renderSummaryTable({ target, compare }) {
  const tbody = document.getElementById('summaryTableBody');
  tbody.innerHTML = SUMMARY_ROWS.map(row => {
    const t = target[row.key];
    const c = compare[row.key];
    const delta    = (t != null && c != null) ? t - c : null;
    const deltaPct = (delta != null && c !== 0) ? delta / c * 100 : null;
    const cls = deltaClass(delta, row.higherBetter);
    return `<tr>
      <td class="col-metric">${row.label}</td>
      <td class="col-target">${t != null ? row.fmt(t) : 'N/A'}</td>
      <td class="col-compare">${c != null ? row.fmt(c) : 'N/A'}</td>
      <td class="${cls}">${row.deltaFmt(delta)}</td>
      <td class="${cls}">${deltaPct != null ? `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}%` : '—'}</td>
    </tr>`;
  }).join('');
}

// ── Metrics grid (CPC / Imp / CPM / CPA / CTR / CVR) ─────────────────────────
const METRIC_DEFS = [
  { key: 'CPC',  label: 'CPC（クリック単価）',    fmt: fmtYen,        higherBetter: false, hasData: true  },
  { key: 'imp',  label: 'インプレッション数',      fmt: fmtNum,        higherBetter: true,  hasData: false },
  { key: 'CPM',  label: 'CPM（千回表示単価）',     fmt: fmtYen,        higherBetter: false, hasData: false },
  { key: 'CPA',  label: 'CPA（獲得単価）',         fmt: fmtYen,        higherBetter: false, hasData: true  },
  { key: 'CTR',  label: 'CTR（クリック率）',       fmt: v => `${v}%`,  higherBetter: true,  hasData: false },
  { key: 'CVR',  label: 'CVR（コンバージョン率）', fmt: v => `${v}%`,  higherBetter: true,  hasData: true  },
];

function renderMetricsGrid(data) {
  const grid = document.getElementById('metricsGrid');
  grid.innerHTML = '';
  METRIC_DEFS.forEach(def => {
    if (!def.hasData) {
      grid.insertAdjacentHTML('beforeend', noDataCardHtml(
        def.label,
        'インプレッションデータなし',
        'このCSVフォーマットにはインプレッション系データが含まれていません',
      ));
    } else {
      const canvasId = `chart_m_${def.key}`;
      grid.insertAdjacentHTML('beforeend', chartCardHtml(def, canvasId));
      buildGroupedBar(canvasId, data.channels, data.target, data.compare, def.key, def.fmt);
    }
  });
}

// ── Supplement grid (広告費 / 訪問者数 / CV数) ────────────────────────────────
const SUPP_DEFS = [
  { key: '広告費',   label: '広告費比較',   fmt: fmtYen, higherBetter: false },
  { key: '訪問者数', label: '訪問者数比較', fmt: fmtNum, higherBetter: true  },
  { key: 'CV数',     label: 'CV数比較',     fmt: fmtNum, higherBetter: true  },
];

function renderSupplementGrid(data) {
  const grid = document.getElementById('supplementGrid');
  grid.innerHTML = '';
  SUPP_DEFS.forEach(def => {
    const canvasId = `chart_s_${def.key}`;
    grid.insertAdjacentHTML('beforeend', chartCardHtml(def, canvasId));
    buildGroupedBar(canvasId, data.channels, data.target, data.compare, def.key, def.fmt);
  });
}

// ── Chart card / no-data card HTML ────────────────────────────────────────────
function chartCardHtml(def, canvasId) {
  const badge = def.higherBetter === true
    ? `<span class="chart-badge higher">高いほど良い</span>`
    : def.higherBetter === false
      ? `<span class="chart-badge lower">低いほど良い</span>`
      : '';
  return `
    <div class="chart-card">
      <div class="chart-head">
        <div>
          <div class="chart-title">${def.label}</div>
          <div class="chart-sub">チャネル別 対象データ vs 比較データ</div>
        </div>
        ${badge}
      </div>
      <div class="chart-wrap"><canvas id="${canvasId}"></canvas></div>
    </div>`;
}

function noDataCardHtml(label, badgeText, desc) {
  return `
    <div class="no-data-card">
      <div class="no-data-icon">📊</div>
      <div class="no-data-title">${label}</div>
      <span class="no-data-badge">${badgeText}</span>
      <div class="no-data-desc">${desc}</div>
    </div>`;
}

// ── Grouped bar chart ─────────────────────────────────────────────────────────
function buildGroupedBar(canvasId, channels, target, compare, metricKey, fmt) {
  const tData = channels.map(ch => target[ch]  ? target[ch][metricKey]  ?? null : null);
  const cData = channels.map(ch => compare[ch] ? compare[ch][metricKey] ?? null : null);

  const ctx = document.getElementById(canvasId).getContext('2d');
  chartInstances[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: channels,
      datasets: [
        {
          label: '対象データ',
          data: tData,
          backgroundColor: T_COLOR + 'cc',
          borderColor: T_COLOR,
          borderWidth: 1,
          borderRadius: 3,
        },
        {
          label: '比較データ',
          data: cData,
          backgroundColor: C_COLOR + 'cc',
          borderColor: C_COLOR,
          borderWidth: 1,
          borderRadius: 3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: { color: '#495057', font: { size: 10 }, padding: 12, usePointStyle: true },
        },
        tooltip: {
          backgroundColor: '#fff',
          borderColor: '#dde1e7',
          borderWidth: 1,
          titleColor: '#1c2333',
          bodyColor: '#495057',
          padding: 12,
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.raw == null ? 'N/A' : fmt(ctx.raw)}`,
          },
        },
      },
      scales: {
        x: { grid: { color: '#eaecef' }, ticks: { color: '#868e96', font: { size: 10 } } },
        y: {
          beginAtZero: true,
          grid: { color: '#eaecef' },
          ticks: { color: '#868e96', font: { size: 10 } },
        },
      },
    },
  });
}

// ── Channel detail table ──────────────────────────────────────────────────────
const CHANNEL_COLS = [
  { key: '訪問者数',      label: '訪問者数',  fmt: fmtNum,           deltaFmt: fmtDeltaNum, higherBetter: true  },
  { key: '訪問者数シェア', label: '訪シェア', fmt: v => `${v}%`,      deltaFmt: fmtDeltaPct, higherBetter: null },
  { key: 'CV数',          label: 'CV数',       fmt: fmtNum,           deltaFmt: fmtDeltaNum, higherBetter: true  },
  { key: 'CVシェア',      label: 'CVシェア',   fmt: v => `${v}%`,      deltaFmt: fmtDeltaPct, higherBetter: null },
  { key: 'CVR',           label: 'CVR',        fmt: v => `${v}%`,      deltaFmt: fmtDeltaPct, higherBetter: true  },
  { key: '広告費',         label: '広告費',     fmt: fmtYen,           deltaFmt: fmtDeltaYen, higherBetter: false },
  { key: 'CPA',           label: 'CPA',        fmt: fmtYen,           deltaFmt: fmtDeltaYen, higherBetter: false },
  { key: 'CPC',           label: 'CPC',        fmt: fmtYen,           deltaFmt: fmtDeltaYen, higherBetter: false },
];

function renderChannelTable({ channels, target, compare }) {
  const head = document.getElementById('channelHead');
  const body = document.getElementById('channelBody');

  const subHeaders = CHANNEL_COLS.map(m =>
    `<th class="sub-header-target">${m.label}</th>` +
    `<th class="sub-header-compare">${m.label}</th>` +
    `<th class="sub-header-delta">Δ${m.label}</th>`
  ).join('');

  head.innerHTML = `<tr><th>チャネル</th>${subHeaders}</tr>`;

  body.innerHTML = channels.map(ch => {
    const t = target[ch]  || {};
    const c = compare[ch] || {};
    const cells = CHANNEL_COLS.map(m => {
      const tv = t[m.key] ?? null;
      const cv = c[m.key] ?? null;
      const delta = (tv != null && cv != null) ? tv - cv : null;
      const cls = deltaClass(delta, m.higherBetter);
      return `<td>${tv != null ? m.fmt(tv) : '—'}</td>` +
             `<td>${cv != null ? m.fmt(cv) : '—'}</td>` +
             `<td class="${cls}">${m.deltaFmt(delta)}</td>`;
    }).join('');
    return `<tr><td>${esc(ch)}</td>${cells}</tr>`;
  }).join('');
}

// ── Delta helpers ─────────────────────────────────────────────────────────────
function deltaClass(delta, higherBetter) {
  if (delta == null || delta === 0 || higherBetter === null) return 'delta-neutral';
  if (delta > 0) return higherBetter ? 'delta-up-good'   : 'delta-up-bad';
  return              higherBetter ? 'delta-down-bad' : 'delta-down-good';
}

function fmtDeltaNum(v) {
  if (v == null) return '—';
  return (v >= 0 ? '+' : '') + Number(v).toLocaleString('ja-JP');
}

function fmtDeltaYen(v) {
  if (v == null) return '—';
  const abs  = Math.abs(v);
  const sign = v >= 0 ? '+¥' : '-¥';
  return sign + Number(abs).toLocaleString('ja-JP');
}

function fmtDeltaPct(v) {
  if (v == null) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}

// ── Excel Export ──────────────────────────────────────────────────────────────
document.getElementById('exportBtn').addEventListener('click', exportToExcel);

async function exportToExcel() {
  if (!lastResult) return;
  const btn = document.getElementById('exportBtn');
  btn.disabled = true;
  btn.innerHTML = '⏳ 生成中...';

  try {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Year-over-Year Comparison Dashboard';
    wb.created = new Date();

    csxBuildSummarySheet(wb, lastResult.summary);
    csxBuildChannelSheet(wb, lastResult);
    await csxBuildChartsSheet(wb);

    const buf  = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    downloadBlob(blob, `年度比較分析_${csxDateStr()}.xlsx`);
    toast('✅ Excelをダウンロードしました');
  } catch (err) {
    console.error(err);
    toast('❌ 出力に失敗しました: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '⬇ Excelで出力';
  }
}

// ─ Sheet 1: 全体サマリー比較 ───────────────────────────────────────────────────
function csxBuildSummarySheet(wb, summary) {
  const ws = wb.addWorksheet('サマリー比較', { views: [{ showGridLines: false }] });

  ws.getColumn(1).width = 18;
  ws.getColumn(2).width = 18;
  ws.getColumn(3).width = 18;
  ws.getColumn(4).width = 16;
  ws.getColumn(5).width = 12;

  // Title
  ws.mergeCells('A1:E1');
  ws.getRow(1).height = 34;
  csxCell(ws, 'A1', '年度比較分析 — 全体サマリー比較', {
    font: { bold: true, size: 15, color: { argb: 'FF1C2333' } }, align: 'left',
  });

  ws.mergeCells('A2:E2');
  ws.getRow(2).height = 16;
  csxCell(ws, 'A2', `出力日時: ${csxNowStr()}`, {
    font: { size: 9, color: { argb: 'FF868E96' } }, align: 'left',
  });

  // Column headers
  ws.getRow(4).height = 28;
  const hDefs = [
    { label: '指標',   align: 'left',   color: 'FF1C2333' },
    { label: '対象データ', align: 'center', color: 'FF3B5BDB' },
    { label: '比較データ', align: 'center', color: 'FFB45309' },
    { label: '増減',   align: 'center', color: 'FF495057' },
    { label: '変化率', align: 'center', color: 'FF495057' },
  ];
  hDefs.forEach(({ label, align, color }, i) => {
    csxCell(ws, ws.getRow(4).getCell(i + 1), label, {
      font:   { bold: true, size: 10, color: { argb: color } },
      fill:   'FFF8F9FA',
      align,
      border: {
        top:    { style: 'medium', color: { argb: 'FFDDE1E7' } },
        bottom: { style: 'medium', color: { argb: 'FFDDE1E7' } },
      },
    });
  });

  const { target: t, compare: c } = summary;
  const data = [
    { label: '広告費合計',   tk: 'totalCost',     fmt: fmtYen,      dfmt: fmtDeltaYen, hb: false },
    { label: '訪問者数合計', tk: 'totalVisitors', fmt: fmtNum,      dfmt: fmtDeltaNum, hb: true  },
    { label: 'CV数合計',     tk: 'totalCV',       fmt: fmtNum,      dfmt: fmtDeltaNum, hb: true  },
    { label: '平均CVR',      tk: 'avgCVR',        fmt: v => `${v}%`, dfmt: fmtDeltaPct, hb: true  },
    { label: '平均CPA',      tk: 'avgCPA',        fmt: fmtYen,      dfmt: fmtDeltaYen, hb: false },
    { label: '平均CPC',      tk: 'avgCPC',        fmt: fmtYen,      dfmt: fmtDeltaYen, hb: false },
  ];

  data.forEach((row, i) => {
    const rn  = 5 + i;
    const alt = i % 2 === 0 ? 'FFF8F9FA' : 'FFFFFFFF';
    ws.getRow(rn).height = 22;
    const bdr = { bottom: { style: 'thin', color: { argb: 'FFDDE1E7' } } };

    const tv     = t[row.tk];
    const cv     = c[row.tk];
    const delta  = (tv != null && cv != null) ? tv - cv : null;
    const pct    = (delta != null && cv !== 0) ? delta / cv * 100 : null;
    const dCls   = deltaClass(delta, row.hb);

    const DELTA_STYLE = {
      'delta-up-good':   { fontColor: 'FF2F9E44', fill: 'FFEBFBEE' },
      'delta-down-good': { fontColor: 'FF2F9E44', fill: 'FFEBFBEE' },
      'delta-up-bad':    { fontColor: 'FFC92A2A', fill: 'FFFFF0F0' },
      'delta-down-bad':  { fontColor: 'FFC92A2A', fill: 'FFFFF0F0' },
      'delta-neutral':   { fontColor: 'FF868E96', fill: alt },
    };
    const ds = DELTA_STYLE[dCls] || DELTA_STYLE['delta-neutral'];

    csxCell(ws, ws.getRow(rn).getCell(1), row.label, {
      font: { size: 10, color: { argb: 'FF495057' } }, fill: alt, align: 'left', indent: 1, border: bdr,
    });
    csxCell(ws, ws.getRow(rn).getCell(2), tv != null ? row.fmt(tv) : 'N/A', {
      font: { bold: true, size: 10, color: { argb: 'FF3B5BDB' } }, fill: alt, align: 'right', border: bdr,
    });
    csxCell(ws, ws.getRow(rn).getCell(3), cv != null ? row.fmt(cv) : 'N/A', {
      font: { bold: true, size: 10, color: { argb: 'FFB45309' } }, fill: alt, align: 'right', border: bdr,
    });
    csxCell(ws, ws.getRow(rn).getCell(4), row.dfmt(delta), {
      font: { bold: true, size: 10, color: { argb: ds.fontColor } }, fill: ds.fill, align: 'right', border: bdr,
    });
    csxCell(ws, ws.getRow(rn).getCell(5), pct != null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%` : '—', {
      font: { bold: true, size: 10, color: { argb: ds.fontColor } }, fill: ds.fill, align: 'right', border: bdr,
    });
  });
}

// ─ Sheet 2: チャネル別詳細比較 ─────────────────────────────────────────────────
function csxBuildChannelSheet(wb, { channels, target, compare }) {
  const ws = wb.addWorksheet('チャネル別詳細', { views: [{ showGridLines: false }] });

  const COLS = [
    { key: '訪問者数',       label: '訪問者数',  fmt: fmtNum,           dfmt: fmtDeltaNum, hb: true  },
    { key: '訪問者数シェア', label: '訪シェア',  fmt: v => `${v}%`,     dfmt: fmtDeltaPct, hb: null  },
    { key: 'CV数',           label: 'CV数',       fmt: fmtNum,           dfmt: fmtDeltaNum, hb: true  },
    { key: 'CVシェア',       label: 'CVシェア',   fmt: v => `${v}%`,     dfmt: fmtDeltaPct, hb: null  },
    { key: 'CVR',            label: 'CVR',        fmt: v => `${v}%`,     dfmt: fmtDeltaPct, hb: true  },
    { key: '広告費',         label: '広告費',     fmt: fmtYen,           dfmt: fmtDeltaYen, hb: false },
    { key: 'CPA',            label: 'CPA',        fmt: fmtYen,           dfmt: fmtDeltaYen, hb: false },
    { key: 'CPC',            label: 'CPC',        fmt: fmtYen,           dfmt: fmtDeltaYen, hb: false },
  ];

  const totalCols = 1 + COLS.length * 3;

  // Column widths
  ws.getColumn(1).width = 20;
  for (let i = 2; i <= totalCols; i++) ws.getColumn(i).width = 11;

  // Title
  ws.mergeCells(1, 1, 1, totalCols);
  ws.getRow(1).height = 34;
  csxCell(ws, 'A1', 'チャネル別詳細比較', {
    font: { bold: true, size: 15, color: { argb: 'FF1C2333' } }, align: 'left',
  });

  ws.mergeCells(2, 1, 2, totalCols);
  ws.getRow(2).height = 16;
  csxCell(ws, 'A2', `出力日時: ${csxNowStr()}`, {
    font: { size: 9, color: { argb: 'FF868E96' } }, align: 'left',
  });

  // Group header row (metric names spanning 3 cols)
  ws.mergeCells(4, 1, 5, 1); // チャネル spans 2 rows
  ws.getRow(4).height = 22;
  csxCell(ws, ws.getRow(4).getCell(1), 'チャネル', {
    font: { bold: true, size: 10, color: { argb: 'FFFFFFFF' } },
    fill: 'FF3B5BDB', align: 'center',
    border: { bottom: { style: 'medium', color: { argb: 'FF2F4AC0' } } },
  });

  COLS.forEach((col, i) => {
    const startCol = 2 + i * 3;
    ws.mergeCells(4, startCol, 4, startCol + 2);
    csxCell(ws, ws.getRow(4).getCell(startCol), col.label, {
      font:  { bold: true, size: 10, color: { argb: 'FFFFFFFF' } },
      fill:  'FF3B5BDB', align: 'center',
      border: { bottom: { style: 'thin', color: { argb: 'FF2F4AC0' } } },
    });
  });

  // Sub-header row (対象 / 比較 / 増減)
  ws.getRow(5).height = 20;
  // チャネル cell already merged above, style it
  csxCell(ws, ws.getRow(5).getCell(1), '', { fill: 'FF3B5BDB' });

  COLS.forEach((_, i) => {
    const startCol = 2 + i * 3;
    csxCell(ws, ws.getRow(5).getCell(startCol),     '対象', {
      font: { bold: true, size: 9, color: { argb: 'FF3B5BDB' } }, fill: 'FFEDF2FF', align: 'center',
      border: { bottom: { style: 'medium', color: { argb: 'FFDDE1E7' } } },
    });
    csxCell(ws, ws.getRow(5).getCell(startCol + 1), '比較', {
      font: { bold: true, size: 9, color: { argb: 'FFB45309' } }, fill: 'FFFFF3BF', align: 'center',
      border: { bottom: { style: 'medium', color: { argb: 'FFDDE1E7' } } },
    });
    csxCell(ws, ws.getRow(5).getCell(startCol + 2), '増減', {
      font: { bold: true, size: 9, italic: true, color: { argb: 'FF868E96' } }, fill: 'FFF8F9FA', align: 'center',
      border: { bottom: { style: 'medium', color: { argb: 'FFDDE1E7' } } },
    });
  });

  const DELTA_STYLE = {
    'delta-up-good':   { fontColor: 'FF2F9E44', fill: 'FFEBFBEE' },
    'delta-down-good': { fontColor: 'FF2F9E44', fill: 'FFEBFBEE' },
    'delta-up-bad':    { fontColor: 'FFC92A2A', fill: 'FFFFF0F0' },
    'delta-down-bad':  { fontColor: 'FFC92A2A', fill: 'FFFFF0F0' },
    'delta-neutral':   { fontColor: 'FF868E96', fill: null },
  };

  channels.forEach((ch, ri) => {
    const rn  = 6 + ri;
    const alt = ri % 2 === 0 ? 'FFF8F9FA' : 'FFFFFFFF';
    ws.getRow(rn).height = 20;
    const bdr = { bottom: { style: 'thin', color: { argb: 'FFDDE1E7' } } };

    csxCell(ws, ws.getRow(rn).getCell(1), ch, {
      font: { bold: true, size: 10, color: { argb: 'FF1C2333' } }, fill: alt, align: 'left', indent: 1, border: bdr,
    });

    COLS.forEach((col, i) => {
      const startCol = 2 + i * 3;
      const tv   = (target[ch]  || {})[col.key] ?? null;
      const cv   = (compare[ch] || {})[col.key] ?? null;
      const delta = (tv != null && cv != null) ? tv - cv : null;
      const dCls  = deltaClass(delta, col.hb);
      const ds    = DELTA_STYLE[dCls] || DELTA_STYLE['delta-neutral'];

      csxCell(ws, ws.getRow(rn).getCell(startCol),     tv != null ? col.fmt(tv) : '—', {
        font: { size: 10, color: { argb: 'FF3B5BDB' } }, fill: alt, align: 'right', border: bdr,
      });
      csxCell(ws, ws.getRow(rn).getCell(startCol + 1), cv != null ? col.fmt(cv) : '—', {
        font: { size: 10, color: { argb: 'FFB45309' } }, fill: alt, align: 'right', border: bdr,
      });
      csxCell(ws, ws.getRow(rn).getCell(startCol + 2), col.dfmt(delta), {
        font: { bold: true, size: 10, color: { argb: ds.fontColor } },
        fill: ds.fill || alt, align: 'right', border: bdr,
      });
    });
  });
}

// ─ Sheet 3: 比較グラフ ────────────────────────────────────────────────────────
const CSX_EXPORT_CHARTS = [
  { id: 'chart_m_CPC', label: 'CPC（クリック単価）' },
  { id: 'chart_m_CPA', label: 'CPA（獲得単価）' },
  { id: 'chart_m_CVR', label: 'CVR（コンバージョン率）' },
  { id: 'chart_s_広告費',   label: '広告費比較' },
  { id: 'chart_s_訪問者数', label: '訪問者数比較' },
  { id: 'chart_s_CV数',    label: 'CV数比較' },
];

async function csxBuildChartsSheet(wb) {
  const ws = wb.addWorksheet('比較グラフ', { views: [{ showGridLines: false }] });

  for (let c = 1; c <= 22; c++) ws.getColumn(c).width = 9;

  ws.mergeCells(1, 1, 1, 22);
  ws.getRow(1).height = 34;
  csxCell(ws, 'A1', '年度比較 — 指標グラフ', {
    font: { bold: true, size: 15, color: { argb: 'FF1C2333' } }, align: 'left',
  });

  ws.mergeCells(2, 1, 2, 22);
  ws.getRow(2).height = 16;
  csxCell(ws, 'A2', `出力日時: ${csxNowStr()}`, {
    font: { size: 9, color: { argb: 'FF868E96' } }, align: 'left',
  });

  const CHART_W  = 620;
  const CHART_H  = 300;
  const ROW_H_PT = 15;
  const IMG_ROWS = Math.ceil(CHART_H / (ROW_H_PT * 96 / 72));
  const PAIR_STRIDE = IMG_ROWS + 2;

  for (let r = 3; r <= 4 + CSX_EXPORT_CHARTS.length / 2 * PAIR_STRIDE + 2; r++) {
    ws.getRow(r).height = ROW_H_PT;
  }

  for (let p = 0; p < CSX_EXPORT_CHARTS.length; p += 2) {
    const def1 = CSX_EXPORT_CHARTS[p];
    const def2 = CSX_EXPORT_CHARTS[p + 1];
    const pair  = p / 2;

    const labelRow1 = 4 + pair * PAIR_STRIDE;
    const imgTlRow0 = labelRow1;

    ws.getRow(labelRow1).height = 22;

    csxCell(ws, ws.getRow(labelRow1).getCell(1), def1.label, {
      font: { bold: true, size: 11, color: { argb: 'FF3B5BDB' } }, align: 'left',
    });
    if (def2) {
      csxCell(ws, ws.getRow(labelRow1).getCell(12), def2.label, {
        font: { bold: true, size: 11, color: { argb: 'FF3B5BDB' } }, align: 'left',
      });
    }

    const img1 = csxChartToBase64(def1.id);
    if (img1) {
      ws.addImage(wb.addImage({ base64: img1, extension: 'png' }), {
        tl: { col: 0, row: imgTlRow0 }, ext: { width: CHART_W, height: CHART_H },
      });
    }
    if (def2) {
      const img2 = csxChartToBase64(def2.id);
      if (img2) {
        ws.addImage(wb.addImage({ base64: img2, extension: 'png' }), {
          tl: { col: 11, row: imgTlRow0 }, ext: { width: CHART_W, height: CHART_H },
        });
      }
    }
  }
}

function csxChartToBase64(canvasId) {
  const src = document.getElementById(canvasId);
  if (!src) return null;
  const tmp = document.createElement('canvas');
  tmp.width  = src.width;
  tmp.height = src.height;
  const ctx  = tmp.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, tmp.width, tmp.height);
  ctx.drawImage(src, 0, 0);
  return tmp.toDataURL('image/png').split(',')[1];
}

// ─ ExcelJS cell style helper ──────────────────────────────────────────────────
function csxCell(ws, ref, value, { font, fill, align, border, indent } = {}) {
  const cell = typeof ref === 'string' ? ws.getCell(ref) : ref;
  cell.value = value;
  if (font)   cell.font      = { size: 10, color: { argb: 'FF495057' }, ...font };
  if (fill)   cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
  if (align)  cell.alignment = { horizontal: align, vertical: 'middle', indent: indent ?? 0 };
  if (border) cell.border    = border;
}

function csxDateStr() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}
function csxNowStr() { return new Date().toLocaleString('ja-JP'); }

// ── Sample CSV download ───────────────────────────────────────────────────────
document.getElementById('sampleBtn').addEventListener('click', () => {
  const header = 'チャネル,訪問者数,訪問者数シェア,CV数,CVシェア,CVR,広告費,CPA';
  const rows = [
    'オーガニック検索,45000,45.0%,320,38.5%,0.71%,0,0',
    'リスティング広告,18000,18.0%,210,25.3%,1.17%,1800000,8571',
    'ディスプレイ広告,12000,12.0%,90,10.8%,0.75%,960000,10667',
    'SNS広告,10000,10.0%,80,9.6%,0.80%,600000,7500',
    'メールマーケティング,8000,8.0%,95,11.4%,1.19%,0,0',
    'アフィリエイト,4000,4.0%,35,4.2%,0.88%,350000,10000',
    'その他,3000,3.0%,1,0.2%,0.03%,0,0',
  ];
  const csv = '﻿' + header + '\n' + rows.join('\n');
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), 'sample_compare.csv');
  toast('📄 サンプルCSVをダウンロードしました');
});

// ── Utilities ─────────────────────────────────────────────────────────────────
function fmtYen(v) {
  if (v == null) return 'N/A';
  return '¥' + Number(v).toLocaleString('ja-JP');
}

function fmtNum(v) {
  if (v == null) return 'N/A';
  return Number(v).toLocaleString('ja-JP');
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function showError(msg) { errorText.textContent = msg; errorAlert.classList.add('show'); }
function hideError()    { errorAlert.classList.remove('show'); }

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}
