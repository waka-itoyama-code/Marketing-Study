'use strict';

// ── Chart color palette ───────────────────────────────────────────────────────
const PALETTE = [
  '#3b5bdb','#7048e8','#0ca678','#f59f00',
  '#e64980','#1971c2','#d9480f','#2b8a3e',
];

// ── Chart definitions ─────────────────────────────────────────────────────────
const CHART_DEFS = [
  { key: 'imp',  label: 'インプレッション',   unit: 'imp', higherBetter: true,  desc: 'imp数・降順',           fmt: fmtNum },
  { key: 'CPC',  label: 'CPC（クリック単価）', unit: '円',  higherBetter: false, desc: '1クリックあたりコスト', fmt: fmtYen },
  { key: 'CPM',  label: 'CPM（1,000imp単価）', unit: '円',  higherBetter: false, desc: '1,000impあたりコスト',  fmt: fmtYen },
  { key: 'CPA',  label: 'CPA（獲得単価）',     unit: '円',  higherBetter: false, desc: '1CV獲得あたりコスト',   fmt: fmtYen },
  { key: 'CTR',  label: 'CTR（クリック率）',   unit: '%',   higherBetter: true,  desc: 'クリックスルーレート',  fmt: v => `${v}%` },
  { key: 'CVR',  label: 'CVR（転換率）',       unit: '%',   higherBetter: true,  desc: 'コンバージョン率',      fmt: v => `${v}%` },
];

// ── State ─────────────────────────────────────────────────────────────────────
let currentFile  = null;
let metricsData  = [];
let summaryData  = {};
let chartInstances = {};

// ── DOM refs ──────────────────────────────────────────────────────────────────
const dropZone       = document.getElementById('dropZone');
const fileInput      = document.getElementById('fileInput');
const fileInfoEl     = document.getElementById('fileInfo');
const fileNameEl     = document.getElementById('fileName');
const fileMetaEl     = document.getElementById('fileMeta');
const fileClearBtn   = document.getElementById('fileClearBtn');
const errorAlert     = document.getElementById('errorAlert');
const errorText      = document.getElementById('errorText');
const analyzeBtn     = document.getElementById('analyzeBtn');
const btnIcon        = document.getElementById('btnIcon');
const btnLabel       = document.getElementById('btnLabel');
const uploadHint     = document.getElementById('uploadHint');
const resultsSection = document.getElementById('resultsSection');
const summaryCards   = document.getElementById('summaryCards');
const resultsBody    = document.getElementById('resultsBody');
const chartsGrid     = document.getElementById('chartsGrid');

// ── Drag & Drop ───────────────────────────────────────────────────────────────
dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', e => {
  if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drag-over');
});
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f) setFile(f);
});
fileInput.addEventListener('change', e => {
  if (e.target.files[0]) setFile(e.target.files[0]);
});

function setFile(f) {
  hideError();
  if (!f.name.toLowerCase().endsWith('.csv')) {
    showError('CSVファイル(.csv)を選択してください');
    return;
  }
  currentFile = f;
  fileNameEl.textContent = f.name;
  fileMetaEl.textContent = `${(f.size / 1024).toFixed(1)} KB`;
  fileInfoEl.classList.add('show');
  dropZone.classList.add('has-file');
  analyzeBtn.disabled = false;
  uploadHint.textContent = 'ファイルを読み込みました。分析を開始してください';
}

fileClearBtn.addEventListener('click', clearFile);
function clearFile() {
  currentFile = null;
  metricsData = [];
  summaryData = {};
  fileInfoEl.classList.remove('show');
  dropZone.classList.remove('has-file');
  hideError();
  analyzeBtn.disabled = true;
  btnLabel.textContent = '分析開始';
  btnIcon.textContent  = '▶';
  uploadHint.textContent = 'CSVをアップロードすると分析できます';
  resultsSection.classList.add('hidden');
  fileInput.value = '';
}

// ── Analyze ───────────────────────────────────────────────────────────────────
analyzeBtn.addEventListener('click', async () => {
  if (!currentFile) return;
  analyzeBtn.disabled = true;
  btnIcon.innerHTML = '<span class="spinner"></span>';
  btnLabel.textContent = '分析中...';
  hideError();

  const fd = new FormData();
  fd.append('file', currentFile);

  try {
    const res  = await fetch('/api/analyze', { method: 'POST', body: fd });
    const json = await res.json();
    if (!res.ok) { showError(json.error || 'サーバーエラーが発生しました'); return; }

    metricsData = json.metrics;
    summaryData = json.summary;

    renderSummary(json.summary);
    renderTable(json.metrics);
    renderCharts(json.metrics);

    resultsSection.classList.remove('hidden');
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    uploadHint.textContent = `分析完了 — ${json.rowCount} 件`;
  } catch (err) {
    showError('通信エラーが発生しました: ' + err.message);
  } finally {
    analyzeBtn.disabled = false;
    btnIcon.textContent  = '▶';
    btnLabel.textContent = '再分析';
  }
});

// ── Summary cards ─────────────────────────────────────────────────────────────
function renderSummary(s) {
  const cards = [
    { label: '総広告費',           value: fmtYen(s.totalCost),   unit: '' },
    { label: '総インプレッション',  value: fmtNum(s.totalImp),    unit: 'imp' },
    { label: '総クリック数',        value: fmtNum(s.totalClicks), unit: 'clicks' },
    { label: '総CV数',              value: fmtNum(s.totalCV),     unit: 'conversions' },
    { label: '平均CPC',             value: s.avgCPC  != null ? fmtYen(s.avgCPC)   : 'N/A', unit: 'per click' },
    { label: '平均CPM',             value: s.avgCPM  != null ? fmtYen(s.avgCPM)   : 'N/A', unit: 'per 1,000 imp' },
    { label: '平均CPA',             value: s.avgCPA  != null ? fmtYen(s.avgCPA)   : 'N/A', unit: 'per acquisition' },
    { label: '平均CTR',             value: s.avgCTR  != null ? `${s.avgCTR}%`     : 'N/A', unit: 'click through rate' },
    { label: '平均CVR',             value: s.avgCVR  != null ? `${s.avgCVR}%`     : 'N/A', unit: 'conversion rate' },
  ];
  summaryCards.innerHTML = cards.map(c => `
    <div class="scard">
      <div class="scard-label">${c.label}</div>
      <div class="scard-value">${esc(c.value)}</div>
      <div class="scard-unit">${c.unit}</div>
    </div>
  `).join('');
}

// ── Table ─────────────────────────────────────────────────────────────────────
const METRIC_COLS = [
  { key: 'CPC', higherBetter: false },
  { key: 'CPM', higherBetter: false },
  { key: 'CPA', higherBetter: false },
  { key: 'CTR', higherBetter: true  },
  { key: 'CVR', higherBetter: true  },
];

function renderTable(data) {
  const rankMaps = {};
  METRIC_COLS.forEach(({ key, higherBetter }) => {
    rankMaps[key] = { vals: data.map(d => d[key]).filter(v => v != null), higherBetter };
  });
  resultsBody.innerHTML = data.map(d => {
    const metricCells = METRIC_COLS.map(({ key }) => {
      const v = d[key];
      if (v == null) return `<td class="cell-null">—</td>`;
      const cls = rankClass(v, rankMaps[key].vals, rankMaps[key].higherBetter);
      const txt = (key === 'CTR' || key === 'CVR') ? `${v}%` : fmtYen(v);
      return `<td class="${cls}">${txt}</td>`;
    });
    return `<tr>
      <td><span class="badge badge-type">${esc(d.adType)}</span></td>
      <td><span class="badge badge-media">${esc(d.adMedia)}</span></td>
      <td>${fmtYen(d.cost)}</td>
      <td>${fmtNum(d.imp)}</td>
      <td>${fmtNum(d.clicks)}</td>
      <td>${fmtNum(d.cv)}</td>
      ${metricCells.join('')}
    </tr>`;
  }).join('');
}

function rankClass(v, all, higherBetter) {
  if (all.length < 2) return '';
  const sorted = [...all].sort((a, b) => a - b);
  const r = sorted.indexOf(v) / (sorted.length - 1);
  return (higherBetter ? r >= 0.66 : r <= 0.33) ? 'cell-good'
       : (higherBetter ? r <= 0.33 : r >= 0.66) ? 'cell-bad'
       : 'cell-mid';
}

// ── Charts ────────────────────────────────────────────────────────────────────
function renderCharts(data) {
  Object.values(chartInstances).forEach(c => c.destroy());
  chartInstances = {};
  chartsGrid.innerHTML = '';

  CHART_DEFS.forEach(def => {
    const valid  = data.filter(d => d[def.key] != null);
    if (!valid.length) return;
    const sorted = [...valid].sort((a, b) => b[def.key] - a[def.key]);
    const labels = sorted.map(d => `${d.adType} / ${d.adMedia}`);
    const values = sorted.map(d => d[def.key]);
    const bgClrs = sorted.map((_, i) => PALETTE[i % PALETTE.length] + '28');
    const bdClrs = sorted.map((_, i) => PALETTE[i % PALETTE.length]);

    chartsGrid.insertAdjacentHTML('beforeend', `
      <div class="chart-card">
        <div class="chart-head">
          <div>
            <div class="chart-title">${def.label}</div>
            <div class="chart-sub">${def.desc}</div>
          </div>
          <span class="chart-badge ${def.higherBetter ? 'higher' : 'lower'}">
            ${def.higherBetter ? '高いほど良い' : '低いほど良い'}
          </span>
        </div>
        <div class="chart-wrap"><canvas id="chart_${def.key}"></canvas></div>
      </div>
    `);

    const ctx = document.getElementById(`chart_${def.key}`).getContext('2d');
    chartInstances[def.key] = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets: [{ label: def.label, data: values, backgroundColor: bgClrs, borderColor: bdClrs, borderWidth: 1.5, borderRadius: 6, borderSkipped: false }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#fff', borderColor: '#dde1e7', borderWidth: 1,
            titleColor: '#1c2333', bodyColor: '#495057', padding: 12,
            callbacks: { label: ctx => ` ${def.fmt(ctx.raw)}` }
          }
        },
        scales: {
          x: { grid: { color: '#eaecef' }, ticks: { color: '#868e96', font: { size: 10 }, maxRotation: 20, callback(val) { const l = this.getLabelForValue(val); return l.length > 14 ? l.slice(0,13)+'…' : l; } } },
          y: { grid: { color: '#eaecef' }, ticks: { color: '#868e96', font: { size: 10 }, callback: v => def.fmt(v) }, beginAtZero: true }
        }
      }
    });
  });
}

// ── Excel Export ──────────────────────────────────────────────────────────────
document.getElementById('exportBtn').addEventListener('click', exportToExcel);

async function exportToExcel() {
  if (!metricsData.length) return;

  const btn = document.getElementById('exportBtn');
  btn.disabled = true;
  btn.innerHTML = '⏳ 生成中...';

  try {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Ad Analysis Dashboard';
    wb.created = new Date();

    buildSummarySheet(wb);
    buildPerfSheet(wb);
    await buildChartsSheet(wb);

    const buf  = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    downloadBlob(blob, `広告分析_${dateStr()}.xlsx`);
    toast('✅ Excelをダウンロードしました');
  } catch (err) {
    console.error(err);
    toast('❌ 出力に失敗しました: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '⬇ Excelで出力';
  }
}

// ─ Sheet 1: 分析結果 ──────────────────────────────────────────────────────────
function buildSummarySheet(wb) {
  const ws = wb.addWorksheet('分析結果', { views: [{ showGridLines: false }] });

  ws.getColumn(1).width = 26;
  ws.getColumn(2).width = 22;

  // Title
  ws.mergeCells('A1:B1');
  ws.getRow(1).height = 34;
  xCell(ws, 'A1', 'インターネット広告分析 — 分析結果', {
    font: { bold: true, size: 15, color: { argb: 'FF1C2333' } },
    align: 'left',
  });

  // Date
  ws.mergeCells('A2:B2');
  ws.getRow(2).height = 16;
  xCell(ws, 'A2', `出力日時: ${nowStr()}`, {
    font: { size: 9, color: { argb: 'FF868E96' } }, align: 'left',
  });

  // Header
  ws.getRow(4).height = 26;
  ['指標', '値'].forEach((h, i) => {
    xCell(ws, ws.getRow(4).getCell(i + 1), h, {
      font:   { bold: true, size: 10, color: { argb: 'FFFFFFFF' } },
      fill:   'FF3B5BDB',
      align:  'center',
      border: { bottom: { style: 'thin', color: { argb: 'FF2F4AC0' } } },
    });
  });

  const s = summaryData;
  const rows = [
    ['総広告費',           fmtYen(s.totalCost)],
    ['総インプレッション',  fmtNum(s.totalImp)  + ' imp'],
    ['総クリック数',        fmtNum(s.totalClicks)+ ' clicks'],
    ['総CV数',              fmtNum(s.totalCV)    + ' CV'],
    ['平均CPC',             s.avgCPC  != null ? fmtYen(s.avgCPC)   : 'N/A'],
    ['平均CPM',             s.avgCPM  != null ? fmtYen(s.avgCPM)   : 'N/A'],
    ['平均CPA',             s.avgCPA  != null ? fmtYen(s.avgCPA)   : 'N/A'],
    ['平均CTR',             s.avgCTR  != null ? `${s.avgCTR}%`     : 'N/A'],
    ['平均CVR',             s.avgCVR  != null ? `${s.avgCVR}%`     : 'N/A'],
  ];

  rows.forEach(([label, value], i) => {
    const rn  = 5 + i;
    const alt = i % 2 === 0 ? 'FFF8F9FA' : 'FFFFFFFF';
    ws.getRow(rn).height = 22;

    xCell(ws, ws.getRow(rn).getCell(1), label, {
      font: { size: 10, color: { argb: 'FF495057' } }, fill: alt, align: 'left', indent: 1,
      border: { bottom: { style: 'thin', color: { argb: 'FFDDE1E7' } } },
    });
    xCell(ws, ws.getRow(rn).getCell(2), value, {
      font: { bold: true, size: 11, color: { argb: 'FF1C2333' } }, fill: alt, align: 'right',
      border: { bottom: { style: 'thin', color: { argb: 'FFDDE1E7' } } },
    });
  });
}

// ─ Sheet 2: 広告別パフォーマンス詳細 ────────────────────────────────────────
function buildPerfSheet(wb) {
  const ws = wb.addWorksheet('広告別パフォーマンス詳細', { views: [{ showGridLines: false }] });

  const cols = [
    { header: '広告種別',  width: 15 }, { header: '広告媒体',  width: 13 },
    { header: '広告費',    width: 14 }, { header: 'Imp数',     width: 14 },
    { header: 'クリック数', width: 12 }, { header: 'CV数',     width: 10 },
    { header: 'CPC（円）', width: 12 }, { header: 'CPM（円）', width: 12 },
    { header: 'CPA（円）', width: 12 }, { header: 'CTR（%）',  width: 10 },
    { header: 'CVR（%）',  width: 10 },
  ];
  cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });

  // Title
  ws.mergeCells(1, 1, 1, cols.length);
  ws.getRow(1).height = 34;
  xCell(ws, 'A1', '広告別パフォーマンス詳細', {
    font: { bold: true, size: 15, color: { argb: 'FF1C2333' } }, align: 'left',
  });

  // Date
  ws.mergeCells(2, 1, 2, cols.length);
  ws.getRow(2).height = 16;
  xCell(ws, 'A2', `出力日時: ${nowStr()}`, {
    font: { size: 9, color: { argb: 'FF868E96' } }, align: 'left',
  });

  // Legend
  ws.mergeCells(3, 1, 3, cols.length);
  ws.getRow(3).height = 16;
  xCell(ws, 'A3', '● 優良（上位）  ● 中位  ● 要改善（下位）　※各指標の相対ランクを色で表示', {
    font: { size: 8, color: { argb: 'FF868E96' } }, align: 'left',
  });

  // Header
  ws.getRow(5).height = 28;
  cols.forEach((c, i) => {
    xCell(ws, ws.getRow(5).getCell(i + 1), c.header, {
      font:   { bold: true, size: 10, color: { argb: 'FFFFFFFF' } },
      fill:   'FF3B5BDB',
      align:  'center',
      border: {
        bottom: { style: 'medium', color: { argb: 'FF2F4AC0' } },
        right:  i < cols.length - 1 ? { style: 'thin', color: { argb: 'FF2F4AC0' } } : undefined,
      },
    });
  });

  // Rank color maps
  const METRIC_KEYS = [
    { key: 'CPC', higherBetter: false, col: 7 },
    { key: 'CPM', higherBetter: false, col: 8 },
    { key: 'CPA', higherBetter: false, col: 9 },
    { key: 'CTR', higherBetter: true,  col: 10 },
    { key: 'CVR', higherBetter: true,  col: 11 },
  ];
  const rankMaps = {};
  METRIC_KEYS.forEach(({ key, higherBetter }) => {
    rankMaps[key] = { vals: metricsData.map(d => d[key]).filter(v => v != null), higherBetter };
  });

  const RANK_STYLE = {
    'cell-good': { fill: 'FFEBFBEE', fontColor: 'FF2F9E44' },
    'cell-mid':  { fill: 'FFFFF8E1', fontColor: 'FFD9820A' },
    'cell-bad':  { fill: 'FFFFF0F0', fontColor: 'FFC92A2A' },
  };

  metricsData.forEach((d, i) => {
    const rn  = 6 + i;
    const alt = i % 2 === 0 ? 'FFF8F9FA' : 'FFFFFFFF';
    ws.getRow(rn).height = 22;
    const bdr = { bottom: { style: 'thin', color: { argb: 'FFDDE1E7' } } };

    const base = (colIdx, value, align = 'right') => {
      xCell(ws, ws.getRow(rn).getCell(colIdx), value, {
        font: { size: 10, color: { argb: 'FF495057' } }, fill: alt, align, border: bdr,
        indent: align === 'left' ? 1 : 0,
      });
    };

    base(1, d.adType,         'left');
    base(2, d.adMedia,        'left');
    base(3, fmtYen(d.cost));
    base(4, fmtNum(d.imp));
    base(5, fmtNum(d.clicks));
    base(6, fmtNum(d.cv));

    METRIC_KEYS.forEach(({ key, col }) => {
      const v = d[key];
      if (v == null) { base(col, '—', 'center'); return; }
      const cls = rankClass(v, rankMaps[key].vals, rankMaps[key].higherBetter);
      const rs  = RANK_STYLE[cls] || {};
      const txt = (key === 'CTR' || key === 'CVR') ? `${v}%` : fmtYen(v);
      xCell(ws, ws.getRow(rn).getCell(col), txt, {
        font:   { bold: true, size: 10, color: { argb: rs.fontColor || 'FF495057' } },
        fill:   rs.fill || alt,
        align:  'right',
        border: bdr,
      });
    });
  });
}

// ─ Sheet 3: 指標グラフ ────────────────────────────────────────────────────────
async function buildChartsSheet(wb) {
  const ws = wb.addWorksheet('指標グラフ', { views: [{ showGridLines: false }] });

  // Column widths: 22 columns × 9 chars ≈ 68px each
  for (let c = 1; c <= 22; c++) ws.getColumn(c).width = 9;

  // Title
  ws.mergeCells(1, 1, 1, 22);
  ws.getRow(1).height = 34;
  xCell(ws, 'A1', '広告費降順による各指標グラフ', {
    font: { bold: true, size: 15, color: { argb: 'FF1C2333' } }, align: 'left',
  });

  // Date
  ws.mergeCells(2, 1, 2, 22);
  ws.getRow(2).height = 16;
  xCell(ws, 'A2', `出力日時: ${nowStr()}`, {
    font: { size: 9, color: { argb: 'FF868E96' } }, align: 'left',
  });

  // Layout constants
  const CHART_W   = 620;  // px  ← image width per chart
  const CHART_H   = 300;  // px  ← image height per chart
  const ROW_H_PT  = 15;   // pt  ← each row height (default ≈ 20px at 96 DPI)
  const IMG_ROWS  = Math.ceil(CHART_H / (ROW_H_PT * 96 / 72)); // ≈15 rows
  const PAIR_STRIDE = IMG_ROWS + 2; // label + image rows + gap

  // Pre-set row heights so images don't overlap text
  for (let r = 3; r <= 4 + CHART_DEFS.length / 2 * PAIR_STRIDE + 2; r++) {
    ws.getRow(r).height = ROW_H_PT;
  }

  // Render each pair (2 charts per row)
  for (let p = 0; p < CHART_DEFS.length; p += 2) {
    const def1 = CHART_DEFS[p];
    const def2 = CHART_DEFS[p + 1];
    const pairIndex = p / 2;

    // 1-indexed row for this pair's label
    const labelRow1 = 4 + pairIndex * PAIR_STRIDE;
    // 0-indexed row for image tl (image starts 1 row after label)
    const imgTlRow0 = labelRow1; // coincides numerically: label 1-idx == image tl 0-idx

    ws.getRow(labelRow1).height = 22;

    // Label cells
    xCell(ws, ws.getRow(labelRow1).getCell(1), def1.label, {
      font: { bold: true, size: 11, color: { argb: 'FF3B5BDB' } }, align: 'left',
    });
    if (def2) {
      xCell(ws, ws.getRow(labelRow1).getCell(12), def2.label, {
        font: { bold: true, size: 11, color: { argb: 'FF3B5BDB' } }, align: 'left',
      });
    }

    // Embed chart 1
    const img1 = chartToBase64(def1.key);
    if (img1) {
      ws.addImage(wb.addImage({ base64: img1, extension: 'png' }), {
        tl:  { col: 0,  row: imgTlRow0 },
        ext: { width: CHART_W, height: CHART_H },
      });
    }

    // Embed chart 2
    if (def2) {
      const img2 = chartToBase64(def2.key);
      if (img2) {
        ws.addImage(wb.addImage({ base64: img2, extension: 'png' }), {
          tl:  { col: 11, row: imgTlRow0 },
          ext: { width: CHART_W, height: CHART_H },
        });
      }
    }
  }
}

// Capture a Chart.js canvas with white background
function chartToBase64(key) {
  const src = document.getElementById(`chart_${key}`);
  if (!src) return null;
  const tmp = document.createElement('canvas');
  tmp.width  = src.width;
  tmp.height = src.height;
  const ctx = tmp.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, tmp.width, tmp.height);
  ctx.drawImage(src, 0, 0);
  return tmp.toDataURL('image/png').split(',')[1];
}

// ── Sample CSV ────────────────────────────────────────────────────────────────
document.getElementById('sampleBtn').addEventListener('click', () => {
  const csv = `﻿広告種別,広告媒体,Imp数,クリック数,CV数,課金,広告費
ディスプレイ,Google,500000,2500,50,CPC課金,200000
リスティング,Google,200000,8000,120,CPC課金,400000
SNS広告,Facebook,800000,4000,30,CPC課金,180000
動画広告,YouTube,1200000,6000,80,CPM課金,320000
SNS広告,Instagram,600000,3000,45,CPC課金,150000
リスティング,Yahoo!,150000,5000,90,CPC課金,250000
ディスプレイ,Yahoo!,400000,1800,25,CPM課金,100000
動画広告,TikTok,2000000,10000,60,CPM課金,300000`;
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), 'sample_ad_data.csv');
  toast('📄 サンプルCSVをダウンロードしました');
});

// ── ExcelJS cell style helper ─────────────────────────────────────────────────
function xCell(ws, ref, value, { font, fill, align, border, indent } = {}) {
  const cell = typeof ref === 'string' ? ws.getCell(ref) : ref;
  cell.value = value;
  if (font)   cell.font      = { size: 10, color: { argb: 'FF495057' }, ...font };
  if (fill)   cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
  if (align)  cell.alignment = { horizontal: align, vertical: 'middle', indent: indent ?? 0 };
  if (border) cell.border    = border;
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function fmtYen(v) {
  if (v == null) return '—';
  return '¥' + Number(v).toLocaleString('ja-JP');
}
function fmtNum(v) {
  if (v == null) return '—';
  return Number(v).toLocaleString('ja-JP');
}
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function dateStr() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}
function nowStr() {
  return new Date().toLocaleString('ja-JP');
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
