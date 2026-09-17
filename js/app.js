// UI AI GOLD: menerima snapshot dari worker lalu menggambar semua panel. Tidak ada logika skor di sini.
import { TIMEFRAMES } from './candles.js';
import { CATEGORIES, tvLabel } from './signals.js';
import { CONTEXT_WEIGHTS } from './score.js';
import { currencyUsdSign, surpriseVote } from './macro.js';
import { formatValue } from './news.js';
import * as U from './ui.js';

const $ = (id) => document.getElementById(id);
const fin = Number.isFinite;

const OVERLAYS = [
  ['hma9', 'Hull 9', '#22d3ee'],
  ['hma21', 'Hull 21', '#a78bfa'],
  ['sma20', 'SMA 20', '#facc15'],
  ['sma50', 'SMA 50', '#fb923c'],
  ['sma200', 'SMA 200', '#f472b6'],
  ['vwap', 'VWAP ±1σ', '#60a5fa'],
  ['supertrend', 'SuperTrend', '#f2c14e'],
  ['profile', 'POC/VA', '#e879f9'],
  ['sr', 'S/R', '#94a3b8'],
];

function store(key, fallback) {
  try {
    const v = localStorage.getItem(`aigold.${key}`);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try { localStorage.setItem(`aigold.${key}`, JSON.stringify(value)); } catch { /* penyimpanan diblokir */ }
}

const state = {
  snap: null,
  selected: readSelected(),
  broker: store('broker', 'PEPPERSTONE'),
  overlays: store('overlays', { hma9: true, hma21: true, sma20: false, sma50: true, sma200: true, vwap: true, supertrend: false, profile: true, sr: true }),
  filter: 'all',
  lastPrice: NaN,
  hashes: {},
  hover: null,
};

function readSelected() {
  const fromHash = decodeURIComponent(location.hash.replace('#', ''));
  if (TIMEFRAMES.some((t) => t.id === fromHash)) return fromHash;
  const saved = store('tf', '15m');
  return TIMEFRAMES.some((t) => t.id === saved) ? saved : '15m';
}

// Hindari menulis ulang DOM yang isinya tidak berubah (hover & scroll tetap stabil).
function setHtml(el, html) {
  if (!el || state.hashes[el.id] === html) return;
  state.hashes[el.id] = html;
  el.innerHTML = html;
}

// ---------------- sumber data ----------------
let post = () => {};

async function startData() {
  const onMessage = (msg) => {
    if (msg.type === 'tick') onTick(msg);
    else if (msg.type === 'snapshot') onSnapshot(msg);
  };
  try {
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => onMessage(e.data);
    worker.onerror = (e) => console.error('worker error', e.message);
    post = (m) => worker.postMessage(m);
  } catch (err) {
    console.warn('Module worker tidak didukung, jalan di main thread', err);
    const { DataHub } = await import('./hub.js');
    const hub = new DataHub(onMessage);
    post = (m) => {
      if (m.type === 'select') hub.select(m.tf);
      if (m.type === 'broker') hub.setBroker(m.broker);
    };
    hub.start();
  }
  post({ type: 'broker', broker: state.broker });
  post({ type: 'select', tf: state.selected });
}

function select(tf) {
  if (state.selected === tf) return;
  state.selected = tf;
  save('tf', tf);
  history.replaceState(null, '', `#${tf}`);
  post({ type: 'select', tf });
  if (state.snap) renderSelected(state.snap);
}

function setBroker(broker) {
  if (state.broker === broker) return;
  state.broker = broker;
  save('broker', broker);
  state.lastPrice = NaN;
  post({ type: 'broker', broker });
  renderBrokerSeg();
}

function renderBrokerSeg() {
  document.querySelectorAll('#broker-seg button').forEach((b) => {
    const on = b.dataset.broker === state.broker;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  });
}

// ---------------- tick ----------------
function onTick(msg) {
  if (!fin(msg.price)) return;
  const el = $('price-last');
  if (fin(state.lastPrice) && msg.price !== state.lastPrice) {
    el.classList.remove('flash-up', 'flash-down');
    void el.offsetWidth;
    el.classList.add(msg.price > state.lastPrice ? 'flash-up' : 'flash-down');
  }
  state.lastPrice = msg.price;
  el.textContent = U.fmt(msg.price, 2);
  if (fin(msg.bid) && fin(msg.ask)) {
    $('price-bid').textContent = U.fmt(msg.bid, 2);
    $('price-ask').textContent = U.fmt(msg.ask, 2);
    $('price-spread').textContent = U.fmt(msg.ask - msg.bid, 2);
  }
  const chart = state.snap?.chart;
  if (chart?.bars?.length && state.snap.selected === state.selected) {
    const last = chart.bars[chart.bars.length - 1];
    last.c = msg.price;
    last.h = Math.max(last.h, msg.price);
    last.l = Math.min(last.l, msg.price);
    drawChart();
  }
}

// ---------------- snapshot ----------------
function onSnapshot(snap) {
  state.snap = snap;
  renderMode(snap);
  renderPrice(snap);
  renderFeeds();
  if (!snap.summary) return;
  renderVerdict(snap);
  renderHorizons(snap);
  renderRisk(snap);
  renderSelected(snap);
  renderAiTable(snap);
  renderMatrix(snap);
  renderIntermarket(snap);
  renderCalendar(snap);
  renderSentiment(snap);
  renderHeadlines(snap);
  $('footer-perf').textContent = `hitung ${snap.computeMs.toFixed(0)} ms · ${snap.aiModels} model AI · ${TIMEFRAMES.length} TF`;
}

function renderMode(snap) {
  const el = $('mode-strip');
  const acc = snap.market.accuracy;
  if (snap.source === 'tv') {
    el.hidden = false;
    setHtml(el, `🟢 <b>Mode broker realtime</b> — candle &amp; tick langsung <code>${U.esc(snap.brokerSymbol)}</code> dari TradingView, identik dengan chart TradingView lo.`);
  } else if (snap.source === 'binance') {
    el.hidden = false;
    const feedName = snap.status.rest_perp?.ok ? 'Binance XAUUSDT' : 'Binance PAXGUSDT (cadangan)';
    setHtml(el, `🟣 <b>Mode web publik</b> — tick ${feedName} dijangkarkan ke bid/ask <code>${U.esc(snap.brokerSymbol)}</code>${acc ? ` · selisih rata-rata <b>±$${U.fmt(acc.mae, 2)}</b>` : ''}. Untuk candle broker persis, jalankan lokal: <code>start-ai-gold.bat</code> lalu buka <code>http://localhost:8787</code>.`);
  } else {
    el.hidden = false;
    setHtml(el, '⏳ Memuat riwayat candle dan melatih AI…');
  }
}

function renderPrice(snap) {
  const q = snap.market.quotes?.[snap.brokerSymbol];
  const bq = snap.market.brokerQuote;
  $('price-symbol').textContent = snap.brokerSymbol || 'XAU/USD';
  if (!fin(state.lastPrice)) {
    const p = fin(q?.lp) ? q.lp : bq?.ref;
    if (fin(p)) $('price-last').textContent = U.fmt(p, 2);
  }
  const chp = fin(q?.chp) ? q.chp : snap.market.scanner?.brokers?.[snap.broker]?.change;
  const chg = $('price-chg');
  if (fin(chp)) {
    chg.textContent = U.fmtPct(chp);
    chg.className = `price-chg ${chp >= 0 ? 'pos' : 'neg'}`;
  }
  if (snap.source === 'tv' && q) {
    $('price-sub').innerHTML = `High ${U.fmt(q.high_price)} · Low ${U.fmt(q.low_price)} · Open ${U.fmt(q.open_price)} · feed TradingView ${snap.status.tv_quote?.latency != null ? `(${snap.status.tv_quote.latency} ms)` : ''}`;
  } else if (bq) {
    $('price-sub').innerHTML = `Scanner ${U.esc(snap.broker)}: bid ${U.fmt(bq.bid)} / ask ${U.fmt(bq.ask)} · Binance ${U.fmt(snap.market.perp)} · basis ${U.fmtSigned(snap.market.basis?.perp, 2)}`;
  }
  const sc = snap.market.scanner;
  const quotes = snap.market.quotes || {};
  const tk = (name, sym, key, d, suffix = '') => {
    const lq = quotes[sym];
    const close = fin(lq?.lp) ? lq.lp : sc?.[key]?.close;
    const c = fin(lq?.chp) ? lq.chp : sc?.[key]?.change;
    return `<div class="tk"><span>${name}</span><b>${fin(close) ? U.fmt(close, d) + suffix : '–'}</b><em class="${c >= 0 ? 'pos' : 'neg'}">${U.fmtPct(c)}</em></div>`;
  };
  setHtml($('tickers'), [
    tk('DXY', 'TVC:DXY', 'dxy', 3),
    tk('US10Y', 'TVC:US10Y', 'us10y', 3, '%'),
    tk('US02Y', 'TVC:US02Y', 'us02y', 3, '%'),
    tk('VIX', 'TVC:VIX', 'vix', 2),
    tk('Silver', 'TVC:SILVER', 'silver', 3),
    tk('WTI (tunda)', 'NYMEX:CL1!', 'oil', 2),
  ].join(''));
}

function renderVerdict(snap) {
  const o = snap.summary.overall;
  setHtml($('gauge'), U.gaugeSvg(o.score));
  setHtml($('ai-ring'), U.probRing(o.aiProb));
  const lbl = $('verdict-label');
  lbl.textContent = o.label.text;
  lbl.className = `verdict-label tone-${o.label.tone}`;
  $('verdict-score').textContent = U.fmtSigned(o.score, 1);
  $('verdict-conf').textContent = `${o.confidence}%`;
  setHtml($('tf-count'), `<span class="chip bull">${o.bullTfs} TF bull</span><span class="chip neutral">${o.neutralTfs} netral</span><span class="chip bear">${o.bearTfs} TF bear</span>`);
  document.title = `${o.label.text} ${U.fmtSigned(o.score, 0)} · AI GOLD`;
}

function renderHorizons(snap) {
  setHtml($('horizons'), snap.summary.horizons.map((h) => `
    <div class="hz">
      <div class="hz-name">${U.esc(h.name)}<small>${U.esc(h.hint)}</small></div>
      <div class="hz-label tone-${h.label.tone}">${U.arrow(h.score)} ${h.label.text}</div>
      <div class="hz-bar"><i style="left:${fin(h.score) ? (h.score + 100) / 2 : 50}%"></i></div>
      <div class="hz-foot"><span>skor ${U.fmtSigned(h.score, 1)}</span><span>AI naik ${U.pct(h.aiProb, 0)}</span><span>yakin ${h.confidence}%</span></div>
    </div>`).join(''));
}

function renderRisk(snap) {
  const r = snap.global.risk;
  const el = $('risk-banner');
  if (!r.active) { el.hidden = true; return; }
  el.hidden = false;
  setHtml(el, `⚠️ <b>Zona news high impact</b> — ${r.events.map((e) => `${U.esc(e.currency)} ${U.esc(e.title)} (${U.wib(Date.parse(e.date))} WIB)`).join(', ')}. Keyakinan TF ≤1H dipotong 50%. Spread &amp; slippage biasanya melebar.`);
}

function tileHtml(r, selected) {
  const f = r.final;
  const sel = r.tf.id === selected ? ' sel' : '';
  if (!f || r.error) {
    return `<button class="tile err${sel}" data-tf="${r.tf.id}" role="tab" title="${U.esc(r.error || '')}"><div class="tf">${r.tf.id}</div><div class="ar">·</div><div class="sc">…</div><div class="lb">MEMUAT</div></button>`;
  }
  return `<button class="tile${sel}" data-tf="${r.tf.id}" role="tab" aria-selected="${r.tf.id === selected}" style="--c:${U.scoreColor(f.score)}" title="${f.label.text} · keyakinan ${f.confidence}%">
    <div class="tf">${r.tf.id}</div><div class="ar">${U.arrow(f.score)}</div><div class="sc">${U.fmtSigned(f.score, 0)}</div><div class="lb">${f.label.text}</div>
    <span class="ai">AI ${r.ai ? U.pct(r.ai.p, 0) : '…'}</span></button>`;
}

function renderSelected(snap) {
  setHtml($('heatmap'), TIMEFRAMES.map((tf) => tileHtml(snap.results[tf.id] || { tf, error: 'memuat' }, state.selected)).join(''));
  const r = snap.results[state.selected];
  $('chart-title').textContent = `Chart ${state.selected} · ${snap.brokerSymbol || ''}`;
  drawChart();
  if (!r || r.error) {
    setHtml($('components'), `<div class="empty">${U.esc(r?.error || 'Memuat data…')}</div>`);
    return;
  }
  const f = r.final;
  $('breakdown-title').innerHTML = `Anatomi Skor ${state.selected} · <span class="tone-${f.label.tone}">${f.label.text}</span>`;
  $('breakdown-meta').textContent = `${r.tech.bulls} bull · ${r.tech.bears} bear · ${r.tech.neutral} netral`;
  const lv = r.levels;
  setHtml($('detail-strip'), [
    ['Skor', U.fmtSigned(f.score, 1)],
    ['Keyakinan', `${f.confidence}%`],
    ['Resistance', U.fmt(lv.resistance)],
    ['Support', U.fmt(lv.support)],
    [`VWAP ${r.meta.anchor}`, U.fmt(lv.vwap)],
    ['POC', U.fmt(lv.poc)],
  ].map(([k, v]) => `<div class="ds"><span>${k}</span><b>${v}</b></div>`).join(''));

  setHtml($('radar'), U.radarSvg(r.tech.cats));
  const names = { technical: 'Teknikal', ai: 'AI', dxy: 'DXY', rates: 'Yield/VIX', macro: 'News', sentiment: 'Sentimen' };
  setHtml($('components'), Object.keys(CONTEXT_WEIGHTS).map((k) => {
    const c = f.components[k];
    const note = k === 'ai' ? (r.ai ? `reliabilitas ${U.pct(r.ai.reliability, 0)}` : U.esc(r.aiError || 'belum')) : k === 'dxy' && fin(r.ctx.dxyRating) ? `DXY ${tvLabel(r.ctx.dxyRating)}` : '';
    return `<div class="comp"><span>${names[k]}</span>${U.voteBar(c?.vote)}<b style="color:${U.scoreColor((c?.vote ?? NaN) * 100)}">${c ? U.fmtSigned(c.vote * 100, 0) : '–'}</b>
      <small>bobot ${c ? Math.round(c.weight * 100) : 0}%${note ? ` · ${note}` : ''}</small></div>`;
  }).join(''));
  setHtml($('reasons'), r.reasons.map((s) => `<div class="reason" style="--c:${U.scoreColor(s.vote * 100)}"><b>${s.vote > 0 ? '▲' : '▼'} ${U.esc(s.name)}</b><span>${U.esc(s.detail)}</span></div>`).join(''));
  renderBrain(r);
  renderSignals(r);
}

function renderBrain(r) {
  const ai = r.ai;
  $('brain-title').innerHTML = `Otak AI · ${r.tf.id}`;
  if (!ai) {
    $('brain-meta').textContent = '';
    setHtml($('brain'), `<div class="empty skeleton">${U.esc(r.aiError === 'antre pelatihan' ? 'AI sedang belajar dari riwayat candle timeframe ini…' : `AI belum aktif: ${r.aiError || 'memuat'}`)}</div>`);
    return;
  }
  const o = ai.oos;
  const H = ai.H;
  $('brain-meta').textContent = `${ai.samples} sampel · target ${H} bar ke depan`;
  const model = (name, p, m) => `<div class="model"><span>${name}</span><b style="color:${U.scoreColor((p - 0.5) * 200)}">${U.pct(p, 0)}</b><small>akurasi uji ${U.pct(m?.accuracy, 1)}</small></div>`;
  const maxImpact = Math.max(0.01, ...ai.contributions.map((c) => Math.abs(c.impact)));
  const relPct = Math.round(ai.reliability * 100);
  const weightNow = r.final.components.ai ? Math.round(r.final.components.ai.weight * 100) : 0;
  setHtml($('brain'), `
    <div class="prob-big">
      <div class="pct" style="color:${U.scoreColor((ai.p - 0.5) * 200)}">${U.pct(ai.p, 0)}<small>PELUANG NAIK ${H} BAR</small></div>
      <div><div class="pbar"><i style="left:${(ai.p * 100).toFixed(1)}%"></i><em style="left:0">turun</em><em style="left:46%">50%</em><em style="right:0">naik</em></div></div>
    </div>
    <div class="models">
      ${model('Logistic', ai.pLogit, o.logit)}
      ${model('k-NN analog', ai.pKnn, o.knn)}
      ${model('Ensembel', ai.p, o.ensemble)}
    </div>
    <div class="rel"><span>Reliabilitas</span><div class="meter"><i style="width:${relPct}%"></i></div><b class="mono">${relPct}%</b></div>
    <div class="brain-note">Uji out-of-sample ${o.ensemble.n} bar terbaru: akurasi <b>${U.pct(o.ensemble.accuracy)}</b> vs tebakan mayoritas ${U.pct(o.ensemble.majority)} · Brier skill <b>${U.fmtSigned(o.ensemble.bss * 100, 1)}%</b>${fin(o.ensemble.confAccuracy) ? ` · saat yakin (≥60/40): ${U.pct(o.ensemble.confAccuracy)} dari ${o.ensemble.confN}` : ''}. Bobot AI di skor ${state.selected} sekarang: <b>${weightNow}%</b>.</div>
    <div>
      <h3>Yang mendorong AI sekarang</h3>
      ${ai.contributions.map((c) => `<div class="contrib"><span title="${U.esc(c.name)}">${U.esc(c.name)}</span>${U.voteBar(c.impact / maxImpact)}<b style="color:${U.scoreColor((c.impact / maxImpact) * 100)}">${U.fmtSigned(c.impact, 2)}</b></div>`).join('')}
    </div>
    <div>
      <h3>Analog pasar paling mirip · ${U.pct(ai.analogUpShare, 0)} naik · rata-rata ${U.fmtSigned(ai.analogAvgFwdPct, 2)}%</h3>
      <div class="analogs">${ai.analogs.map((a) => `<span class="analog ${a.up ? 'up' : 'dn'}">${a.t ? U.wib(a.t, true) : '–'} ${a.up ? '▲' : '▼'} ${U.fmtSigned(a.fwd * 100, 2)}%</span>`).join('')}</div>
    </div>`);
}

function renderAiTable(snap) {
  const rows = TIMEFRAMES.map((tf) => {
    const r = snap.results[tf.id];
    const ai = r?.ai;
    if (!ai) return `<tr data-tf="${tf.id}" class="${tf.id === state.selected ? 'sel' : ''}"><td class="tfc">${tf.id}</td><td colspan="6" class="muted">${U.esc(r?.aiError || r?.error || 'memuat')}</td></tr>`;
    const e = ai.oos.ensemble;
    return `<tr data-tf="${tf.id}" class="${tf.id === state.selected ? 'sel' : ''}">
      <td class="tfc">${tf.id}</td>
      <td style="color:${U.scoreColor((ai.p - 0.5) * 200)}">${U.pct(ai.p, 0)}</td>
      <td>${U.pct(e.accuracy)}</td>
      <td style="color:${e.bss > 0 ? 'var(--bull)' : 'var(--bear)'}">${U.fmtSigned(e.bss * 100, 1)}%</td>
      <td><span class="mini-meter"><i style="width:${Math.round(ai.reliability * 100)}%"></i></span>${Math.round(ai.reliability * 100)}%</td>
      <td>${ai.testN}/${ai.samples}</td>
      <td class="muted">${U.esc(ai.importance.slice(0, 2).map((x) => x.name).join(', '))}</td>
    </tr>`;
  }).join('');
  setHtml($('ai-table'), `<thead><tr><th>TF</th><th>P(naik)</th><th>Akurasi uji</th><th>Brier skill</th><th>Reliabilitas</th><th>Uji/sampel</th><th>Fitur terpenting</th></tr></thead><tbody>${rows}</tbody>`);
}

function renderSignals(r) {
  $('signals-title').textContent = `Semua Sinyal ${r.tf.id} (${r.signals.length})`;
  const keep = (s) => state.filter === 'all' || (state.filter === 'bull' ? s.vote > 0.05 : s.vote !== null && s.vote < -0.05);
  setHtml($('signals'), Object.entries(CATEGORIES).map(([id, meta]) => {
    const list = r.signals.filter((s) => s.cat === id && keep(s));
    const cs = r.tech.cats[id]?.score;
    if (!list.length && state.filter !== 'all') return '';
    return `<div class="sig-group"><h3>${meta.label} · ${Math.round(meta.weight * 100)}%<b style="color:${U.scoreColor(cs)}">${U.fmtSigned(cs, 0)}</b></h3>
      ${list.map((s) => `<div class="sig${s.vote === null ? ' off' : ''}"><div class="nm"><b>${U.esc(s.name)}</b><small>${U.esc(s.detail)}</small></div>${U.voteBar(s.vote)}<span class="v" style="color:${U.scoreColor((s.vote ?? NaN) * 100)}">${s.vote === null ? 'n/a' : U.fmtSigned(s.vote * 100, 0)}</span></div>`).join('') || '<div class="empty">—</div>'}
    </div>`;
  }).join(''));
}

function renderMatrix(snap) {
  const cats = Object.keys(CATEGORIES);
  const head = `<thead><tr><th>TF</th><th>Putusan</th><th>Skor</th><th>Yakin</th><th>AI</th>${cats.map((c) => `<th>${CATEGORIES[c].label}</th>`).join('')}<th>DXY</th><th>Anti-DXY</th><th>RSI</th><th>VWAP</th><th>Support</th><th>Resistance</th></tr></thead>`;
  const cell = (v) => `<span class="cell" style="background:${U.scoreColor(v)}">${fin(v) ? Math.round(v) : '–'}</span>`;
  const rows = TIMEFRAMES.map((tf) => {
    const r = snap.results[tf.id];
    if (!r || r.error) return `<tr data-tf="${tf.id}"><td class="tfc">${tf.id}</td><td colspan="${cats.length + 11}" class="muted">${U.esc(r?.error || 'memuat…')}</td></tr>`;
    const f = r.final;
    return `<tr data-tf="${tf.id}" class="${tf.id === state.selected ? 'sel' : ''}">
      <td class="tfc">${tf.id}</td>
      <td class="lbl tone-${f.label.tone}">${U.arrow(f.score)} ${f.label.text}</td>
      <td><span class="scorebar">${U.voteBar(f.score / 100)}</span>${U.fmtSigned(f.score, 0)}</td>
      <td>${f.confidence}%</td>
      <td>${r.ai ? U.pct(r.ai.p, 0) : '…'}</td>
      ${cats.map((c) => `<td>${cell(r.tech.cats[c]?.score)}</td>`).join('')}
      <td>${cell((r.ctx.dxy ?? NaN) * 100)}</td>
      <td>${fin(r.ctx.corr) ? r.ctx.corr.toFixed(2) : '–'}</td>
      <td>${U.fmt(r.meta.rsi, 1)}</td>
      <td>${U.fmt(r.levels.vwap)}</td>
      <td class="pos">${U.fmt(r.levels.support)}</td>
      <td class="neg">${U.fmt(r.levels.resistance)}</td>
    </tr>`;
  }).join('');
  setHtml($('matrix'), `${head}<tbody>${rows}</tbody>`);
}

function renderIntermarket(snap) {
  const sc = snap.market.scanner;
  const dxy = snap.market.quotes?.['TVC:DXY']?.lp ?? sc?.dxy?.close;
  $('dxy-meta').textContent = fin(dxy) ? `DXY ${U.fmt(dxy, 3)} · sintetis ${U.fmt(snap.global.syntheticDxy, 3)}` : '';
  const top = `<div class="im-top">
    <div class="tk"><span>Arah DXY (TV 1D)</span><b class="${(sc?.dxy?.ratings?.[''] ?? 0) >= 0 ? 'neg' : 'pos'}">${tvLabel(sc?.dxy?.ratings?.[''])}</b></div>
    <div class="tk"><span>Yield/VIX → emas</span><b style="color:${U.scoreColor((snap.global.rates ?? NaN) * 100)}">${U.fmtSigned((snap.global.rates ?? NaN) * 100, 0)}</b></div>
  </div>`;
  const rows = TIMEFRAMES.map((tf) => {
    const r = snap.results[tf.id];
    if (!r || r.error) return '';
    const dr = r.ctx.dxyRating;
    return `<div class="corr-row"><b>${tf.id}</b>
      <div class="mini">${U.voteBar(fin(dr) ? -dr : NaN)}<em style="color:${U.scoreColor(-(dr ?? NaN) * 100)}">${fin(dr) ? U.fmtSigned(-dr * 100, 0) : '–'}</em></div>
      <div class="mini">${U.voteBar(r.ctx.corr)}<em>${fin(r.ctx.corr) ? r.ctx.corr.toFixed(2) : '–'}</em></div></div>`;
  }).join('');
  const fxLabel = Object.values(snap.results).find((r) => r?.ctx?.fxLabel)?.ctx.fxLabel || 'DXY';
  setHtml($('intermarket'), `${top}<div class="corr-row"><span class="h">TF</span><span class="h">Efek DXY ke emas (−tekan … +dukung)</span><span class="h">Anti-korelasi emas~${fxLabel === 'DXY' ? 'DXY' : 'dolar (EURUSD)'}</span></div>${rows}
    <p class="sent-note">DXY menguat = tekanan ke emas. Anti-korelasi positif berarti emas sedang bergerak berlawanan dengan dolar di timeframe itu; makin kecil, makin kecil bobot DXY di skor.</p>`);
}

function renderCalendar(snap) {
  const now = Date.now();
  const events = snap.global.events.filter((e) => e.importance >= 1 && currencyUsdSign(e.currency));
  const gen = snap.market.newsGeneratedAt;
  $('news-meta').textContent = gen ? `kalender ${U.timeAgo(now - Date.parse(gen))} lalu` : 'kalender belum tersedia';
  if (!events.length) {
    setHtml($('calendar'), '<div class="empty">Kalender belum termuat (diperbarui GitHub Actions tiap ±15 menit).</div>');
    return;
  }
  const upcoming = events.filter((e) => Date.parse(e.date) > now - 15 * 60_000).slice(0, 12);
  const past = events.filter((e) => Date.parse(e.date) <= now - 15 * 60_000).reverse().slice(0, 12);
  const row = (e, future) => {
    const t = Date.parse(e.date);
    const sv = surpriseVote(e, now);
    const impact = sv
      ? `<span style="color:${U.scoreColor(sv.vote * 100)}">${sv.vote > 0.02 ? '▲ emas' : sv.vote < -0.02 ? '▼ emas' : '≈ sesuai'}</span>`
      : future ? `<span class="mono" data-countdown="${t}">${U.countdown(t - now)}</span>` : '<span class="muted">–</span>';
    return `<div class="ev hi"><div class="when"><b>${U.wib(t)}</b>${U.wib(t, true).split(' ').slice(0, 2).join(' ')}</div>
      <div class="ttl"><b><span class="flag hi">${U.esc(e.currency)}</span>${U.esc(e.title)}</b>
      <small>A ${formatValue(e.actual, e.unit)}${e.liveActual ? ' ⚡' : ''} · F ${formatValue(e.forecast, e.unit)} · P ${formatValue(e.previous, e.unit)}</small></div>
      <div class="imp">${impact}</div></div>`;
  };
  setHtml($('calendar'), `<div class="cal-sec">Akan datang</div>${upcoming.map((e) => row(e, true)).join('') || '<div class="empty">Tidak ada event high impact terjadwal</div>'}
    <div class="cal-sec">Sudah rilis</div>${past.map((e) => row(e, false)).join('') || '<div class="empty">–</div>'}`);
}

function renderSentiment(snap) {
  const s = snap.market.sentiment || {};
  const g = snap.global;
  const longPct = fin(s.longPct) ? s.longPct * 100 : NaN;
  const cot = g.cot;
  const hist = (snap.market.cotHistory || []).slice().reverse().map((x) => x.net);
  const lsBar = fin(longPct)
    ? `<div class="ls-bar"><div class="ls-long" style="width:${longPct}%">${U.fmt(longPct, 1)}% L</div><div class="ls-short" style="width:${100 - longPct}%">${U.fmt(100 - longPct, 1)}% S</div></div>`
    : `<div class="empty">${U.esc(snap.status.sentiment?.error || 'Memuat posisi Binance…')}</div>`;
  setHtml($('sentiment'), `
    <div class="sent-block"><h3>Akun Binance XAUUSDT <b>L/S ${U.fmt(s.longShort, 2)}</b></h3>
      ${lsBar}
      <div class="sent-note">Kontrarian: mayoritas ritel long = bahan bakar turun. Suara <b style="color:${U.scoreColor((g.longShort ?? NaN) * 100)}">${U.fmtSigned((g.longShort ?? NaN) * 100, 0)}</b></div></div>
    <div class="sent-block"><h3>Funding rate <b>${fin(s.funding) ? `${(s.funding * 100).toFixed(4)}%` : '–'}</b></h3>
      <div class="sent-note">Open interest ${U.fmt(s.openInterest, 0)} · suara <b style="color:${U.scoreColor((g.funding ?? NaN) * 100)}">${U.fmtSigned((g.funding ?? NaN) * 100, 0)}</b></div></div>
    <div class="sent-block"><h3>COT managed money <b>${cot ? U.fmt(cot.net, 0) : '–'}</b></h3>
      ${U.sparklineSvg(hist)}
      <div class="sent-note">${cot ? `Persentil 3 tahun ${Math.round(cot.percentile * 100)} · ${U.esc(snap.market.cotLatest?.date || '')} · dipakai untuk 1D–1M` : 'Memuat data CFTC…'}</div></div>
    <div class="sent-block"><h3>Nada headline 24 jam <b style="color:${U.scoreColor((g.headlines.vote ?? NaN) * 100)}">${U.fmtSigned((g.headlines.vote ?? NaN) * 100, 0)}</b></h3>
      <div class="sent-note">${g.headlines.scored.length} headline bernada dari leksikon emas/dolar/yield.</div></div>`);
}

function renderHeadlines(snap) {
  const now = Date.now();
  const scored = new Map(snap.global.headlines.scored.map((h) => [h.id, h.score]));
  const list = (snap.market.headlines || []).slice(0, 20);
  $('headline-meta').textContent = list.length ? `${list.length} terbaru` : '';
  setHtml($('headlines'), list.length ? list.map((h) => {
    const sc = scored.get(h.id);
    const safeUrl = h.url && /^https:\/\/www\.tradingview\.com\//.test(h.url) ? h.url : null;
    return `<div class="hl"><i style="background:${fin(sc) ? U.scoreColor(sc * 100) : 'var(--neutral)'}"></i>
      ${safeUrl ? `<a href="${U.esc(safeUrl)}" target="_blank" rel="noopener">${U.esc(h.title)}</a>` : `<span>${U.esc(h.title)}</span>`}
      <small>${U.esc(h.source)} · ${U.timeAgo(now - h.published * 1000)}</small></div>`;
  }).join('') : '<div class="empty">Headline belum termuat.</div>');
}

// ---------------- status feed ----------------
function feedList(snap) {
  const tv = snap?.tvMode;
  return [
    ...(tv ? [['tv', 'TradingView candle broker + DXY', 90_000], ['tv_quote', 'TradingView tick broker', 20_000]] : []),
    ['scanner', 'TradingView scanner (quote broker, rating, data ekonomi)', 30_000],
    ['ws_perp', 'Binance XAUUSDT (WebSocket, volume asli)', 20_000],
    ['ws_paxg', 'Binance PAXGUSDT (WebSocket)', 180_000],
    ['rest_perp', 'Riwayat candle Binance perp', 3_600_000],
    ['rest_paxg', 'Riwayat candle PAXG', 3_600_000],
    ...(tv ? [] : [['rest_eur', 'EURUSDT (proksi DXY)', 600_000], ['rest_paxg_intraday', 'Cadangan PAXGUSDT intraday (bila perp dibatasi)', Infinity]]),
    ['sentiment', 'Sentimen Binance', 180_000],
    ['news', 'Kalender & headline', 1_800_000],
    ['cot', 'CFTC COT', 86_400_000],
    ['engine', 'Mesin skor + AI', 15_000],
  ];
}

function renderFeeds() {
  const snap = state.snap;
  const st = snap?.status || {};
  const now = Date.now();
  const feeds = feedList(snap);
  const levels = feeds.map(([k, , stale]) => U.statusLevel(st[k], now, stale));
  const coreKeys = snap?.source === 'tv' ? ['tv', 'tv_quote', 'engine'] : ['scanner', 'ws_perp', 'engine'];
  const core = feeds.map(([k], i) => (coreKeys.includes(k) ? levels[i] : null)).filter(Boolean);
  const worst = core.includes('down') ? 'down' : core.includes('stale') || core.includes('wait') ? 'stale' : 'up';
  $('feeds-dot').className = `dot ${worst}`;
  const lat = snap?.source === 'tv' ? st.tv_quote?.latency : st.ws_perp?.latency;
  $('feeds-summary').textContent = worst === 'up' ? `Live${fin(lat) ? ` · ${lat} ms` : ''}` : worst === 'down' ? 'Feed bermasalah' : 'Menyambung…';
  $('feeds-panel').innerHTML = feeds.map(([k, name], i) => {
    const s = st[k] || {};
    const age = fin(s.at) ? `${U.timeAgo(now - s.at)} lalu` : 'belum';
    return `<div class="feed-row"><span class="dot ${levels[i]}"></span><div>${name}<small>${s.error ? `<span class="err">${U.esc(s.error)}</span>` : age}${fin(s.latency) ? ` · latensi ${s.latency} ms` : ''}</small></div><span class="muted">${U.esc(s.state || '')}</span></div>`;
  }).join('');
}

// ---------------- chart ----------------
function renderOverlayChips() {
  setHtml($('overlays'), OVERLAYS.map(([k, label, color]) => `<button class="ov${state.overlays[k] ? ' on' : ''}" data-ov="${k}" style="--c:${color}" aria-pressed="${!!state.overlays[k]}"><i></i>${label}</button>`).join(''));
}

function drawChart() {
  const snap = state.snap;
  const canvas = $('chart');
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const chart = snap?.selected === state.selected ? snap.chart : null;
  const bars = chart?.bars;
  if (!bars?.length) {
    ctx.fillStyle = '#5b6477';
    ctx.font = '13px Inter, sans-serif';
    ctx.fillText('Memuat candle…', 16, 24);
    return;
  }
  const r = snap.results[state.selected];
  const ov = state.overlays;
  const padR = 72;
  const padB = 22;
  const plotW = w - padR;
  const plotH = h - padB;
  const lines = chart.lines;
  let lo = Math.min(...bars.map((b) => b.l));
  let hi = Math.max(...bars.map((b) => b.h));
  const span0 = hi - lo;
  const include = (v) => { if (fin(v) && v > lo - span0 * 0.3 && v < hi + span0 * 0.3) { lo = Math.min(lo, v); hi = Math.max(hi, v); } };
  const levels = [];
  if (ov.sr && r?.levels) { levels.push([r.levels.resistance, '#e5383b', [6, 4], 'R']); levels.push([r.levels.support, '#16c26b', [6, 4], 'S']); }
  if (ov.profile && chart.profile) {
    levels.push([chart.profile.poc, '#e879f9', [2, 3], 'POC']);
    levels.push([chart.profile.vah, 'rgba(232,121,249,.45)', [2, 5], 'VAH']);
    levels.push([chart.profile.val, 'rgba(232,121,249,.45)', [2, 5], 'VAL']);
  }
  levels.forEach(([v]) => include(v));
  const pad = (hi - lo) * 0.06 || 1;
  lo -= pad;
  hi += pad;
  const y = (p) => plotH - ((p - lo) / (hi - lo)) * plotH;
  const step = plotW / bars.length;
  const bw = Math.max(1, step * 0.62);
  const xAt = (i) => i * step + step / 2;

  ctx.lineWidth = 1;
  ctx.font = '10px "JetBrains Mono", monospace';
  for (let i = 0; i <= 5; i++) {
    const p = lo + ((hi - lo) * i) / 5;
    const yy = Math.round(y(p)) + 0.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(plotW, yy); ctx.stroke();
    ctx.fillStyle = '#5b6477';
    ctx.fillText(U.fmt(p, 2), plotW + 6, yy + 3);
  }
  const dated = ['1D', '1W', '1M'].includes(state.selected);
  const labelEvery = Math.ceil(bars.length / 6);
  bars.forEach((b, i) => { if (i % labelEvery === 0) ctx.fillText(dated ? U.wib(b.t, true).split(' ')[1] : U.wib(b.t), i * step + 2, h - 6); });

  // Pita VWAP ±1σ di belakang candle.
  if (ov.vwap && lines.vwapUp) {
    ctx.fillStyle = 'rgba(96,165,250,0.07)';
    ctx.beginPath();
    let started = false;
    lines.vwapUp.forEach((v, i) => { if (v === null) return; const yy = y(v); if (!started) { ctx.moveTo(xAt(i), yy); started = true; } else ctx.lineTo(xAt(i), yy); });
    for (let i = lines.vwapDn.length - 1; i >= 0; i--) { const v = lines.vwapDn[i]; if (v !== null) ctx.lineTo(xAt(i), y(v)); }
    ctx.closePath();
    ctx.fill();
  }

  bars.forEach((b, i) => {
    const x = xAt(i);
    const col = b.c >= b.o ? '#16c26b' : '#e5383b';
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, y(b.h)); ctx.lineTo(Math.round(x) + 0.5, y(b.l)); ctx.stroke();
    ctx.fillRect(x - bw / 2, y(Math.max(b.o, b.c)), bw, Math.max(1, Math.abs(y(b.o) - y(b.c))));
  });

  const path = (arr, color, width = 1.6, dash = [], colorBySlope = false) => {
    if (!arr) return;
    ctx.setLineDash(dash);
    ctx.lineWidth = width;
    for (let i = 1; i < arr.length; i++) {
      const a = arr[i - 1];
      const b = arr[i];
      if (a === null || b === null) continue;
      ctx.strokeStyle = colorBySlope ? (b >= a ? '#16c26b' : '#e5383b') : color;
      ctx.beginPath(); ctx.moveTo(xAt(i - 1), y(a)); ctx.lineTo(xAt(i), y(b)); ctx.stroke();
    }
    ctx.setLineDash([]);
  };
  if (ov.sma200) path(lines.sma200, '#f472b6', 1.6);
  if (ov.sma50) path(lines.sma50, '#fb923c', 1.4);
  if (ov.sma20) path(lines.sma20, '#facc15', 1.2);
  if (ov.vwap) { path(lines.vwap, '#60a5fa', 1.8); path(lines.vwapUp, 'rgba(96,165,250,.6)', 1, [4, 3]); path(lines.vwapDn, 'rgba(96,165,250,.6)', 1, [4, 3]); }
  if (ov.supertrend) path(lines.supertrend, '#f2c14e', 1.4, [1, 2]);
  if (ov.hma21) path(lines.hma21, '#a78bfa', 1.8);
  if (ov.hma9) path(lines.hma9, '#22d3ee', 2.2, [], true);

  for (const [v, color, dash, name] of levels) {
    if (!fin(v) || v < lo || v > hi) continue;
    const yy = Math.round(y(v)) + 0.5;
    ctx.setLineDash(dash);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(plotW, yy); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillText(`${name} ${U.fmt(v, 2)}`, 4, yy - 4);
  }

  const last = bars[bars.length - 1];
  const ly = y(last.c);
  ctx.fillStyle = last.c >= last.o ? '#16c26b' : '#e5383b';
  ctx.fillRect(plotW + 1, ly - 9, padR - 2, 18);
  ctx.fillStyle = '#07090d';
  ctx.font = 'bold 11px "JetBrains Mono", monospace';
  ctx.fillText(U.fmt(last.c, 2), plotW + 5, ly + 4);

  if (state.hover !== null && state.hover >= 0 && state.hover < bars.length) {
    const i = state.hover;
    const b = bars[i];
    ctx.strokeStyle = 'rgba(255,255,255,.25)';
    ctx.beginPath(); ctx.moveTo(Math.round(xAt(i)) + 0.5, 0); ctx.lineTo(Math.round(xAt(i)) + 0.5, plotH); ctx.stroke();
    const val = (k) => (lines[k]?.[i] != null ? U.fmt(lines[k][i], 2) : '–');
    const tip = $('chart-tip');
    tip.hidden = false;
    tip.textContent = `${U.wib(b.t, true)} WIB\nO ${U.fmt(b.o)}  H ${U.fmt(b.h)}\nL ${U.fmt(b.l)}  C ${U.fmt(b.c)}\nHull9 ${val('hma9')}  Hull21 ${val('hma21')}\nSMA50 ${val('sma50')}  SMA200 ${val('sma200')}\nVWAP ${val('vwap')}`;
  } else {
    $('chart-tip').hidden = true;
  }
}

// ---------------- latar jaringan saraf ----------------
function neuralBackground() {
  const canvas = $('bg-net');
  if (!canvas || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ctx = canvas.getContext('2d');
  let nodes = [];
  const resize = () => {
    canvas.width = innerWidth;
    canvas.height = innerHeight;
    const count = Math.min(60, Math.round((innerWidth * innerHeight) / 30000));
    nodes = Array.from({ length: count }, () => ({ x: Math.random() * innerWidth, y: Math.random() * innerHeight, vx: (Math.random() - 0.5) * 0.25, vy: (Math.random() - 0.5) * 0.25 }));
  };
  resize();
  addEventListener('resize', resize);
  const tick = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const n of nodes) {
      n.x += n.vx; n.y += n.vy;
      if (n.x < 0 || n.x > canvas.width) n.vx *= -1;
      if (n.y < 0 || n.y > canvas.height) n.vy *= -1;
    }
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
        if (d < 140) {
          ctx.strokeStyle = `rgba(167,139,250,${(1 - d / 140) * 0.25})`;
          ctx.beginPath(); ctx.moveTo(nodes[i].x, nodes[i].y); ctx.lineTo(nodes[j].x, nodes[j].y); ctx.stroke();
        }
      }
      ctx.fillStyle = 'rgba(242,193,78,.5)';
      ctx.beginPath(); ctx.arc(nodes[i].x, nodes[i].y, 1.6, 0, Math.PI * 2); ctx.fill();
    }
    if (!document.hidden) requestAnimationFrame(tick);
    else setTimeout(() => requestAnimationFrame(tick), 1000);
  };
  requestAnimationFrame(tick);
}

// ---------------- event ----------------
function bind() {
  document.addEventListener('click', (e) => {
    const tfEl = e.target.closest('[data-tf]');
    if (tfEl) select(tfEl.dataset.tf);
    const seg = e.target.closest('#signal-filter button');
    if (seg) {
      state.filter = seg.dataset.f;
      document.querySelectorAll('#signal-filter button').forEach((b) => b.classList.toggle('on', b === seg));
      const r = state.snap?.results[state.selected];
      if (r?.signals) renderSignals(r);
    }
    const br = e.target.closest('#broker-seg button');
    if (br) setBroker(br.dataset.broker);
    const ovEl = e.target.closest('[data-ov]');
    if (ovEl) {
      state.overlays[ovEl.dataset.ov] = !state.overlays[ovEl.dataset.ov];
      save('overlays', state.overlays);
      renderOverlayChips();
      drawChart();
    }
  });
  $('feeds-btn').addEventListener('click', () => {
    const panel = $('feeds-panel');
    panel.hidden = !panel.hidden;
    $('feeds-btn').setAttribute('aria-expanded', String(!panel.hidden));
  });
  addEventListener('hashchange', () => {
    const tf = decodeURIComponent(location.hash.replace('#', ''));
    if (TIMEFRAMES.some((t) => t.id === tf)) select(tf);
  });
  const canvas = $('chart');
  canvas.addEventListener('mousemove', (e) => {
    const bars = state.snap?.chart?.bars;
    if (!bars?.length) return;
    const rect = canvas.getBoundingClientRect();
    const plotW = rect.width - 72;
    const i = Math.floor(((e.clientX - rect.left) / plotW) * bars.length);
    state.hover = i >= 0 && i < bars.length ? i : null;
    drawChart();
  });
  canvas.addEventListener('mouseleave', () => { state.hover = null; drawChart(); });
  new ResizeObserver(() => drawChart()).observe(canvas);
  setInterval(() => {
    const now = Date.now();
    $('clock-wib').textContent = new Date(now + 7 * 3_600_000).toISOString().slice(11, 19);
    setHtml($('sessions'), U.sessionsAt(now).map((s) => `<span class="sess${s.open ? ' open' : ''}">${s.label}</span>`).join(''));
    document.querySelectorAll('[data-countdown]').forEach((el) => { el.textContent = U.countdown(Number(el.dataset.countdown) - now); });
    if (state.snap) renderFeeds();
  }, 1000);
}

renderBrokerSeg();
renderOverlayChips();
bind();
neuralBackground();
startData();
