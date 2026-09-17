// UI AI GOLD v2: menerima snapshot dari worker lalu memperbarui DOM. Komponen berat (gauge, ring, tile,
// horizon) dibuat sekali lalu diperbarui per atribut supaya transisi CSS berjalan. Tidak ada logika skor di sini.
import { TIMEFRAMES } from './candles.js';
import { CATEGORIES, tvLabel } from './signals.js';
import { CONTEXT_WEIGHTS } from './score.js';
import { currencyUsdSign, surpriseVote } from './macro.js';
import { formatValue } from './news.js';
import * as U from './ui.js';
import * as X from './explain.js';

const $ = (id) => document.getElementById(id);
const fin = Number.isFinite;
const TF_IDS = TIMEFRAMES.map((t) => t.id);

const OVERLAYS = [
  ['hma9', 'Hull MA 9', '#22d3ee'],
  ['hma21', 'Hull MA 21', '#a78bfa'],
  ['sma20', 'SMA 20', '#facc15'],
  ['sma50', 'SMA 50', '#fb923c'],
  ['sma200', 'SMA 200', '#f472b6'],
  ['vwap', 'VWAP ±1σ', '#60a5fa'],
  ['supertrend', 'SuperTrend', '#f5c451'],
  ['profile', 'POC / Value Area', '#e879f9'],
  ['sr', 'Support / Resistance', '#94a3b8'],
  ['volume', 'Volume', '#64748b'],
];

function load(key, fallback) {
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

// Mode Pemula menampilkan chart yang bersih: tren (SMA 50) dan batas atas/bawah saja.
const SIMPLE_OVERLAYS = { sma50: true, sr: true };

const state = {
  mode: load('mode', 'simple') === 'pro' ? 'pro' : 'simple',
  style: X.STYLES.some((st) => st.id === load('style', 'intraday')) ? load('style', 'intraday') : 'intraday',
  snap: null,
  selected: readSelected(),
  broker: load('broker', 'PEPPERSTONE'),
  overlays: { hma9: true, hma21: true, sma20: false, sma50: true, sma200: true, vwap: true, supertrend: false, profile: true, sr: true, volume: true, ...load('overlays', {}) },
  filter: 'all',
  query: '',
  lastPrice: NaN,
  ticks: [],
  hashes: {},
  hover: null,
  verdicts: null,
  horizonLabels: null,
  overallLabel: null,
  activity: [],
  drawQueued: false,
  colors: null,
  // Grup sinyal terbuka: semua di desktop, tertutup di HP supaya halaman tidak memanjang.
  openCats: new Set(matchMedia('(max-width: 760px)').matches ? [] : Object.keys(CATEGORIES)),
};

function readSelected() {
  const fromHash = decodeURIComponent(location.hash.replace('#tf-', ''));
  if (TF_IDS.includes(fromHash)) return fromHash;
  const saved = load('tf', '15m');
  return TF_IDS.includes(saved) ? saved : '15m';
}

// Hindari menulis ulang DOM yang isinya tidak berubah (hover, fokus & scroll tetap stabil).
function setHtml(el, html) {
  if (!el || state.hashes[el.id] === html) return;
  state.hashes[el.id] = html;
  el.innerHTML = html;
}
function setText(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}

function cssColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (k) => cs.getPropertyValue(k).trim();
  return { up: v('--sbull'), down: v('--sbear'), text: v('--text'), text2: v('--text-2'), text3: v('--text-3'), border: v('--border-2'), bg: v('--bg'), surface: v('--surface-1'), gold: v('--gold') };
}

// ---------------------------------------------------------------- sumber data
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

function select(tf, { focus = false } = {}) {
  if (!TF_IDS.includes(tf)) return;
  if (state.selected !== tf) {
    state.selected = tf;
    state.hover = null;
    save('tf', tf);
    history.replaceState(null, '', `#tf-${tf}`);
    post({ type: 'select', tf });
  }
  if (state.snap) {
    renderTfTabs(state.snap);
    if (state.mode === 'pro') {
      renderTiles(state.snap);
      renderSelected(state.snap);
      renderAiTable(state.snap);
      renderMatrix(state.snap);
    } else {
      setText($('chart-title'), `${state.selected} · ${state.snap.brokerSymbol || ''}`);
      queueDraw();
    }
  }
  if (focus) $(`tile-${tf}`)?.focus();
}

function setBroker(broker) {
  if (state.broker === broker) return;
  state.broker = broker;
  save('broker', broker);
  state.lastPrice = NaN;
  state.ticks = [];
  post({ type: 'broker', broker });
  renderBrokerSeg();
}

function applyMode(mode) {
  state.mode = mode === 'pro' ? 'pro' : 'simple';
  save('mode', state.mode);
  document.body.classList.toggle('mode-simple', state.mode === 'simple');
  document.body.classList.toggle('mode-pro', state.mode === 'pro');
  document.querySelectorAll('#mode-seg button').forEach((b) => {
    const on = b.dataset.setMode === state.mode;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  });
  const first = document.querySelector(`#sections-nav a[data-mode="${state.mode}"]`) || document.querySelector('#sections-nav a');
  document.querySelectorAll('#sections-nav a').forEach((a) => a.classList.toggle('on', a === first));
  state.hashes = {};
  if (state.mode === 'simple') {
    const style = X.STYLES.find((st) => st.id === state.style);
    if (style) select(style.mainTf);
  }
  if (state.snap) onSnapshot(state.snap);
  queueDraw();
}

function setStyle(styleId, { syncChart = true } = {}) {
  const style = X.STYLES.find((st) => st.id === styleId);
  if (!style) return;
  state.style = style.id;
  save('style', style.id);
  document.querySelectorAll('#style-picker .style-btn').forEach((b) => {
    const on = b.dataset.style === style.id;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  });
  // Di Mode Pemula chart ikut timeframe utama gaya yang dipilih; pilihan TF di Mode Pro tidak diganggu.
  if (syncChart) select(style.mainTf);
  if (state.snap) renderPemula(state.snap);
}

function activeOverlays() {
  return state.mode === 'simple' ? SIMPLE_OVERLAYS : state.overlays;
}

function renderBrokerSeg() {
  document.querySelectorAll('#broker-seg button').forEach((b) => {
    const on = b.dataset.broker === state.broker;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  });
}

// ---------------------------------------------------------------- tick
// Kilatan warna singkat saat harga berubah, lalu kembali ke warna normal.
function flash(el, up) {
  if (!el) return;
  el.classList.remove('flash-up', 'flash-down');
  void el.offsetWidth;
  el.classList.add(up ? 'flash-up' : 'flash-down');
  clearTimeout(el._flashTimer);
  el._flashTimer = setTimeout(() => el.classList.remove('flash-up', 'flash-down'), 700);
}

function onTick(msg) {
  if (!fin(msg.price)) return;
  const el = $('price-last');
  if (fin(state.lastPrice) && msg.price !== state.lastPrice) {
    flash(el, msg.price > state.lastPrice);
    if (state.mode === 'simple') flash($('s-price'), msg.price > state.lastPrice);
  }
  state.lastPrice = msg.price;
  setText(el, U.fmt(msg.price, 2));
  if (state.mode === 'simple') setText($('s-price'), U.fmt(msg.price, 2));
  if (fin(msg.bid) && fin(msg.ask)) {
    setText($('price-bid'), U.fmt(msg.bid, 2));
    setText($('price-ask'), U.fmt(msg.ask, 2));
    setText($('price-spread'), U.fmt(msg.ask - msg.bid, 2));
  }
  state.ticks.push(msg.price);
  if (state.ticks.length > 240) state.ticks.shift();
  updateDayMarker(msg.price);
  const chart = state.snap?.chart;
  if (chart?.bars?.length && state.snap.selected === state.selected) {
    const last = chart.bars[chart.bars.length - 1];
    last.c = msg.price;
    last.h = Math.max(last.h, msg.price);
    last.l = Math.min(last.l, msg.price);
  }
  queueDraw();
}

function queueDraw() {
  if (state.drawQueued) return;
  state.drawQueued = true;
  requestAnimationFrame(() => {
    state.drawQueued = false;
    const sparkColor = state.ticks.length > 1 && state.ticks.at(-1) < state.ticks[0] ? 'var(--bear)' : 'var(--bull)';
    const spark = $(state.mode === 'simple' ? 's-spark' : 'tick-spark');
    spark.style.color = sparkColor;
    spark.innerHTML = U.sparklineSvg(state.ticks, { width: 300, height: 46, area: true, dot: true });
    drawChart();
  });
}

// ---------------------------------------------------------------- snapshot
function onSnapshot(snap) {
  state.snap = snap;
  renderMode(snap);
  renderPrice(snap);
  renderFeeds();
  if (!snap.summary) return;
  renderRisk(snap);
  renderTfTabs(snap);
  if (state.mode === 'simple') {
    // Mode Pemula: bagian Pro tersembunyi tidak dirender sama sekali (lebih ringan).
    renderPemula(snap);
    setText($('chart-title'), `${state.selected} · ${snap.brokerSymbol || ''}`);
    queueDraw();
  } else {
    renderVerdict(snap);
    renderHorizons(snap);
    renderTiles(snap);
    renderSelected(snap);
    renderAiTable(snap);
    renderMatrix(snap);
    renderIntermarket(snap);
    renderCalendar(snap);
    renderSentiment(snap);
    renderHeadlines(snap);
  }
  trackChanges(snap);
  setText($('footer-perf'), `hitung ${snap.computeMs.toFixed(0)} ms · ${snap.aiModels} model AI · ${TIMEFRAMES.length} timeframe`);
}

function renderMode(snap) {
  const el = $('mode-strip');
  const acc = snap.market.accuracy;
  if (snap.source === 'tv') {
    setHtml(el, `<b>Mode broker realtime</b> · candle &amp; tick langsung <code>${U.esc(snap.brokerSymbol)}</code> dari TradingView, identik dengan chart TradingView lo.`);
  } else if (snap.source === 'binance') {
    const feedName = snap.status.rest_perp?.ok ? 'Binance XAUUSDT' : 'Binance PAXGUSDT (cadangan)';
    setHtml(el, `<b>Mode web publik</b> · tick ${feedName} dijangkarkan ke <code>${U.esc(snap.brokerSymbol)}</code>${acc ? ` · selisih rata-rata <b>±$${U.fmt(acc.mae, 2)}</b>` : ''}. Candle broker persis: jalankan <code>start-ai-gold.bat</code>.`);
  } else {
    setHtml(el, 'Memuat riwayat candle dan melatih AI…');
  }
  setText($('feeds-mode'), snap.source === 'tv' ? 'mode broker realtime' : snap.source === 'binance' ? 'mode web publik' : 'memuat');
}

function renderPrice(snap) {
  const q = snap.market.quotes?.[snap.brokerSymbol];
  const bq = snap.market.brokerQuote;
  setText($('price-symbol'), snap.brokerSymbol || 'XAU/USD');
  if (!fin(state.lastPrice)) {
    const p = fin(q?.lp) ? q.lp : bq?.ref;
    if (fin(p)) setText($('price-last'), U.fmt(p, 2));
  }
  const chp = fin(q?.chp) ? q.chp : snap.market.scanner?.brokers?.[snap.broker]?.change;
  const chg = $('price-chg');
  if (fin(chp)) {
    setText(chg, U.fmtPct(chp));
    chg.className = `price-chg ${chp >= 0 ? 'pos' : 'neg'}`;
  }
  const dr = snap.market.dayRange;
  state.dayRange = dr;
  setText($('dr-low'), dr ? U.fmt(dr.lo) : '–');
  setText($('dr-high'), dr ? U.fmt(dr.hi) : '–');
  updateDayMarker(fin(state.lastPrice) ? state.lastPrice : q?.lp ?? bq?.ref);

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
    tk('WTI · tunda', 'NYMEX:CL1!', 'oil', 2),
  ].join(''));
}

function updateDayMarker(price) {
  const dr = state.dayRange;
  const pos = dr ? U.rangePosition(dr.lo, dr.hi, price) : NaN;
  const m = $('dr-marker');
  if (m && fin(pos)) m.style.left = `${(pos * 100).toFixed(2)}%`;
}

function renderVerdict(snap) {
  const o = snap.summary.overall;
  const gauge = $('gauge');
  if (!gauge.querySelector('svg')) gauge.innerHTML = U.gaugeSvg(o.score);
  const needle = gauge.querySelector('.gauge-needle-g');
  needle.style.transform = `rotate(${U.needleAngle(o.score).toFixed(2)}deg)`;
  gauge.querySelector('svg').setAttribute('aria-label', `Skor gabungan ${fin(o.score) ? o.score.toFixed(0) : 'belum tersedia'}`);

  const ringBox = $('ai-ring');
  if (!ringBox.querySelector('svg')) ringBox.innerHTML = U.probRing(o.aiProb);
  const d = U.ringDash(o.aiProb);
  const val = ringBox.querySelector('.ring-val');
  val.setAttribute('stroke-dashoffset', d.offset.toFixed(2));
  val.setAttribute('stroke', d.color);
  setText(ringBox.querySelector('.ring-num'), fin(o.aiProb) ? `${Math.round(o.aiProb * 100)}%` : '–');

  const lbl = $('verdict-label');
  setText(lbl, o.label.text);
  lbl.className = `verdict-label tone-${o.label.tone}`;
  setText($('verdict-score'), U.fmtSigned(o.score, 1));
  $('verdict-score').style.color = U.scoreColor(o.score);
  setText($('verdict-conf'), `${o.confidence}%`);
  const total = o.bullTfs + o.neutralTfs + o.bearTfs || 1;
  const bars = document.querySelectorAll('#consensus .consensus-bar i');
  [o.bullTfs, o.neutralTfs, o.bearTfs].forEach((n, i) => { bars[i].style.width = `${(n / total) * 100}%`; });
  setHtml($('tf-count'), `<span><b class="t-bull">${o.bullTfs}</b> bull</span><span><b>${o.neutralTfs}</b> netral</span><span><b class="t-bear">${o.bearTfs}</b> bear</span>`);
  document.title = `${o.label.text} ${U.fmtSigned(o.score, 0)} · AI GOLD`;
}

function renderHorizons(snap) {
  const box = $('horizons');
  if (!box.querySelector('.hz')) {
    box.innerHTML = snap.summary.horizons.map((h) => `
      <div class="hz" id="hz-${h.id}">
        <div class="hz-top"><span class="hz-name">${U.esc(h.name)}</span><span class="hz-hint">${U.esc(h.hint)}</span></div>
        <div class="hz-label">–</div>
        <div class="hz-bar"><i style="left:50%"></i></div>
        <div class="hz-foot"><span class="hz-score">–</span><span class="hz-ai">–</span></div>
      </div>`).join('');
  }
  for (const h of snap.summary.horizons) {
    const el = $(`hz-${h.id}`);
    if (!el) continue;
    const label = el.querySelector('.hz-label');
    setText(label, `${U.arrow(h.score)} ${h.label.text}`);
    label.className = `hz-label tone-${h.label.tone}`;
    el.querySelector('.hz-bar i').style.left = `${fin(h.score) ? (h.score + 100) / 2 : 50}%`;
    setText(el.querySelector('.hz-score'), `skor ${U.fmtSigned(h.score, 0)} · ${h.confidence}%`);
    setText(el.querySelector('.hz-ai'), `AI ${U.pct(h.aiProb, 0)}`);
  }
}

function renderRisk(snap) {
  const r = snap.global.risk;
  const el = $('risk-banner');
  if (!r.active) { el.hidden = true; return; }
  el.hidden = false;
  const list = r.events.map((e) => `${U.esc(e.currency)} ${U.esc(e.title)} (${U.wib(Date.parse(e.date))} WIB)`).join(', ');
  setHtml(el, state.mode === 'simple'
    ? `⚠️ <b>Berita besar sedang/akan rilis:</b> ${list}. Harga bisa melompat tiba-tiba dan biaya spread melebar — pemula sebaiknya menunggu sampai reda.`
    : `⚠️ <b>Zona news high impact</b> — ${list}. Keyakinan TF ≤1H dipotong 50%. Spread &amp; slippage biasanya melebar.`);
}

// ---------------------------------------------------------------- Mode Pemula
function dirColor(key) {
  return key === 'up' ? 'var(--bull)' : key === 'down' ? 'var(--bear)' : 'var(--gold-2)';
}

function renderPemula(snap) {
  const now = Date.now();
  const q = snap.market.quotes?.[snap.brokerSymbol];
  const bq = snap.market.brokerQuote;
  setText($('s-symbol'), snap.brokerSymbol || 'XAU/USD');
  if (!fin(state.lastPrice)) {
    const p = fin(q?.lp) ? q.lp : bq?.ref;
    if (fin(p)) setText($('s-price'), U.fmt(p, 2));
  }
  const chp = fin(q?.chp) ? q.chp : snap.market.scanner?.brokers?.[snap.broker]?.change;
  const chg = $('s-chg');
  if (fin(chp)) {
    setText(chg, `${U.fmtPct(chp)} hari ini`);
    chg.className = `price-chg ${chp >= 0 ? 'pos' : 'neg'}`;
  }
  const dr = snap.market.dayRange;
  setText($('s-sub'), dr ? `Hari ini bergerak antara ${U.fmt(dr.lo)} dan ${U.fmt(dr.hi)} · dolar AS per troy ounce` : 'Dolar AS per troy ounce · diperbarui realtime');

  const e = X.explainStyle(state.style, snap, now);
  setText($('s-eyebrow'), `Kondisi untuk ${e.style.name.toLowerCase()} · ${e.style.hint}`);
  const dirEl = $('s-dir');
  setText(dirEl, e.dir.label);
  dirEl.className = `lux-dir dir-${e.dir.key}`;
  const bars = $('s-strength').querySelectorAll('i');
  bars.forEach((b, i) => {
    b.classList.toggle('on', i < e.strength.level);
    b.style.setProperty('--c', dirColor(e.dir.key));
  });
  setText($('s-strength').querySelector('span'), `sinyal ${e.strength.label}`);
  setText($('s-sentence'), e.sentence);

  for (const st of X.STYLES) {
    const hz = snap.summary.horizons.find((h) => h.id === st.id);
    const d = X.directionWord(hz?.score);
    const el = $(`sb-${st.id}`);
    setText(el, d.key === 'wait' ? '● Belum jelas' : d.key === 'up' ? '▲ Condong naik' : '▼ Condong turun');
    el.style.color = dirColor(d.key);
  }

  const icon = (ok) => (ok === true ? '<span class="check-ico ok" aria-label="mendukung">✓</span>' : ok === false ? '<span class="check-ico bad" aria-label="perhatian">!</span>' : '<span class="check-ico info" aria-label="info">i</span>');
  setHtml($('s-checks'), e.checks.map((c) => `<li>${icon(c.ok)}<span>${U.esc(c.text)}</span></li>`).join(''));

  const lv = e.levels;
  setText($('s-level-tf'), lv ? `timeframe ${lv.tf}` : '–');
  const price = fin(state.lastPrice) ? state.lastPrice : lv?.price;
  setHtml($('s-ladder'), lv ? `
    <div class="rung res"><span>Batas atas terdekat<small>resistance · harga sering tertahan</small></span><b>${U.fmt(lv.resistance)}</b></div>
    <div class="rung now"><span>Harga sekarang<small>${fin(lv.resistance) && fin(price) ? `${U.fmt(lv.resistance - price)} ke atas` : ''}${fin(lv.support) && fin(price) ? ` · ${U.fmt(price - lv.support)} ke bawah` : ''}</small></span><b>${U.fmt(price)}</b></div>
    <div class="rung sup"><span>Batas bawah terdekat<small>support · harga sering tertahan</small></span><b>${U.fmt(lv.support)}</b></div>` : '<div class="empty">Memuat level…</div>');
  setText($('s-levels-note'), X.levelsSentence(lv));

  const news = X.upcomingNews(snap.global.events, now, 3);
  setHtml($('s-news'), news.length ? news.map((n) => `<li class="${n.inMs < 30 * 60_000 ? 'soon' : ''}"><div>${U.esc(n.currency)} · ${U.esc(n.title)}<small>${U.esc(n.when)}</small></div><span class="cd" data-countdown="${n.at}">${U.countdown(n.inMs)}</span></li>`).join('')
    : '<li class="empty">Tidak ada berita besar terjadwal minggu ini.</li>');
}

// ---------------------------------------------------------------- timeframe tiles & tabs
function renderTiles(snap) {
  const strip = $('heatmap');
  if (!strip.querySelector('.tile')) {
    strip.innerHTML = TF_IDS.map((id) => `
      <button type="button" class="tile" role="tab" id="tile-${id}" data-tf="${id}" aria-selected="false" tabindex="-1">
        <span class="tf">${id}</span><span class="sc">…</span><span class="lb">MEMUAT</span>
        <span class="aibar"><i style="width:0"></i></span><span class="aiv">AI –</span>
      </button>`).join('');
  }
  for (const id of TF_IDS) {
    const r = snap.results[id];
    const el = $(`tile-${id}`);
    const sel = id === state.selected;
    el.classList.toggle('sel', sel);
    el.setAttribute('aria-selected', String(sel));
    el.tabIndex = sel ? 0 : -1;
    const f = r?.final;
    if (!f || r.error) {
      el.classList.add('err');
      el.title = r?.error || 'memuat';
      continue;
    }
    el.classList.remove('err');
    el.style.setProperty('--fill', U.scoreFill(f.score, 0.42));
    el.style.setProperty('--edge', U.scoreFill(f.score, 0.75));
    const sc = el.querySelector('.sc');
    setText(sc, U.fmtSigned(f.score, 0));
    sc.style.color = U.scoreColor(f.score);
    const lb = el.querySelector('.lb');
    setText(lb, U.shortLabel(f.score));
    lb.style.color = U.scoreColor(f.score);
    el.querySelector('.aibar i').style.width = r.ai ? `${Math.round(r.ai.p * 100)}%` : '0';
    setText(el.querySelector('.aiv'), `AI ${r.ai ? U.pct(r.ai.p, 0) : '…'}`);
    el.title = `${id}: ${f.label.text} · skor ${U.fmtSigned(f.score, 1)} · keyakinan ${f.confidence}%`;
    el.setAttribute('aria-label', `${id} ${f.label.text}, skor ${U.fmtSigned(f.score, 0)}`);
  }
}

function renderTfTabs(snap) {
  setHtml($('tf-tabs'), TF_IDS.map((id) => {
    const s = snap.results[id]?.final?.score;
    const on = id === state.selected;
    return `<button type="button" class="tf-tab${on ? ' on' : ''}" role="tab" aria-selected="${on}" data-tf="${id}" style="--c:${U.scoreColor(s)}">${id}</button>`;
  }).join(''));
}

// ---------------------------------------------------------------- timeframe terpilih
function renderSelected(snap) {
  const r = snap.results[state.selected];
  setText($('chart-title'), `${state.selected} · ${snap.brokerSymbol || ''}`);
  queueDraw();
  if (!r || r.error) {
    setHtml($('components'), `<div class="empty">${U.esc(r?.error || 'Memuat data…')}</div>`);
    return;
  }
  const f = r.final;
  $('breakdown-title').innerHTML = `Anatomi Skor ${state.selected} · <span class="tone-${f.label.tone}">${f.label.text}</span>`;
  setText($('breakdown-meta'), `${r.tech.bulls} bull · ${r.tech.bears} bear · ${r.tech.neutral} netral`);
  const lv = r.levels;
  setHtml($('detail-strip'), [
    ['Skor', U.fmtSigned(f.score, 1), U.scoreColor(f.score)],
    ['Keyakinan', `${f.confidence}%`],
    ['Resistance', U.fmt(lv.resistance), 'var(--bear)'],
    ['Support', U.fmt(lv.support), 'var(--bull)'],
    [`VWAP ${r.meta.anchor}`, U.fmt(lv.vwap), '#93c5fd'],
    ['POC', U.fmt(lv.poc), '#f0abfc'],
  ].map(([k, v, c]) => `<div class="ds"><span>${k}</span><b${c ? ` style="color:${c}"` : ''}>${v}</b></div>`).join(''));

  setHtml($('radar'), U.radarSvg(r.tech.cats));
  const names = { technical: 'Teknikal', ai: 'AI', dxy: 'DXY', rates: 'Yield/VIX', macro: 'News', sentiment: 'Sentimen' };
  setHtml($('components'), Object.keys(CONTEXT_WEIGHTS).map((k) => {
    const c = f.components[k];
    const note = k === 'ai' ? (r.ai ? `reliabilitas ${U.pct(r.ai.reliability, 0)}` : U.esc(r.aiError || 'belum')) : k === 'dxy' && fin(r.ctx.dxyRating) ? `DXY ${tvLabel(r.ctx.dxyRating)}` : '';
    return `<div class="comp"><span>${names[k]}</span>${U.voteBar(c?.vote)}<b style="color:${U.scoreColor((c?.vote ?? NaN) * 100)}">${c ? U.fmtSigned(c.vote * 100, 0) : '–'}</b>
      <small>bobot ${c ? Math.round(c.weight * 100) : 0}%${note ? ` · ${note}` : ''}</small></div>`;
  }).join(''));
  setHtml($('reasons'), r.reasons.map((s) => `<div class="reason" style="--c:${U.scoreColor(s.vote * 100)}"><b style="color:${U.scoreColor(s.vote * 100)}">${s.vote > 0 ? '▲' : '▼'} ${U.esc(s.name)}</b><span>${U.esc(s.detail)}</span></div>`).join(''));
  renderBrain(r);
  renderSignals(r);
}

function renderBrain(r) {
  const ai = r.ai;
  $('brain-title').innerHTML = `<svg class="ico" aria-hidden="true"><use href="#i-brain"/></svg>Otak AI · ${r.tf.id}`;
  if (!ai) {
    setText($('brain-meta'), '');
    setHtml($('brain'), `<div class="brain-note">${U.esc(r.aiError === 'antre pelatihan' ? 'AI sedang belajar dari riwayat candle timeframe ini…' : `AI belum aktif: ${r.aiError || 'memuat'}`)}</div>`);
    return;
  }
  const o = ai.oos;
  setText($('brain-meta'), `${ai.samples} sampel · target ${ai.H} bar`);
  const model = (name, p, m) => `<div class="model"><span>${name}</span><b style="color:${U.scoreColor((p - 0.5) * 200)}">${U.pct(p, 0)}</b><small>uji ${U.pct(m?.accuracy, 1)}</small></div>`;
  const maxImpact = Math.max(0.01, ...ai.contributions.map((c) => Math.abs(c.impact)));
  const relPct = Math.round(ai.reliability * 100);
  const weightNow = r.final.components.ai ? Math.round(r.final.components.ai.weight * 100) : 0;
  setHtml($('brain'), `
    <div class="prob-big">
      <div class="prob-row"><span class="pct" style="color:${U.scoreColor((ai.p - 0.5) * 200)}">${U.pct(ai.p, 0)}</span><span class="cap">peluang naik<br>${ai.H} bar ke depan</span></div>
      <div class="pbar"><i style="left:${(ai.p * 100).toFixed(1)}%"></i></div>
      <div class="pbar-scale"><span>turun</span><span>50%</span><span>naik</span></div>
    </div>
    <div class="models">${model('Logistic', ai.pLogit, o.logit)}${model('k-NN analog', ai.pKnn, o.knn)}${model('Ensembel', ai.p, o.ensemble)}</div>
    <div class="rel"><span>Reliabilitas</span><div class="meter"><i style="width:${relPct}%"></i></div><b class="mono">${relPct}%</b></div>
    <p class="brain-note">Uji ${o.ensemble.n} bar terbaru: akurasi <b>${U.pct(o.ensemble.accuracy)}</b> vs tebakan mayoritas ${U.pct(o.ensemble.majority)} · Brier skill <b>${U.fmtSigned(o.ensemble.bss * 100, 1)}%</b>${fin(o.ensemble.confAccuracy) ? ` · saat yakin: <b>${U.pct(o.ensemble.confAccuracy)}</b> dari ${o.ensemble.confN}` : ''}. Bobot AI di skor ${r.tf.id}: <b>${weightNow}%</b>.</p>
    <div>
      <h4>Yang mendorong AI sekarang</h4>
      ${ai.contributions.map((c) => `<div class="contrib"><span title="${U.esc(c.name)}">${U.esc(c.name)}</span>${U.voteBar(c.impact / maxImpact)}<b style="color:${U.scoreColor((c.impact / maxImpact) * 100)}">${U.fmtSigned(c.impact, 2)}</b></div>`).join('')}
    </div>
    <div>
      <h4>Analog pasar · ${U.pct(ai.analogUpShare, 0)} naik · rata-rata ${U.fmtSigned(ai.analogAvgFwdPct, 2)}%</h4>
      <div class="analogs">${ai.analogs.map((a) => `<span class="analog ${a.up ? 'up' : 'dn'}">${a.t ? U.wib(a.t, true) : '–'} ${a.up ? '▲' : '▼'} ${U.fmtSigned(a.fwd * 100, 2)}%</span>`).join('')}</div>
    </div>`);
}

function renderSignals(r) {
  setText($('signals-title'), `Semua Sinyal · ${r.tf.id} (${r.signals.length})`);
  const q = state.query.trim().toLowerCase();
  const keep = (s) => (state.filter === 'all' || (state.filter === 'bull' ? s.vote > 0.05 : s.vote !== null && s.vote < -0.05))
    && (!q || `${s.name} ${s.detail}`.toLowerCase().includes(q));
  const html = Object.entries(CATEGORIES).map(([id, meta]) => {
    const list = r.signals.filter((s) => s.cat === id && keep(s));
    if (!list.length && (state.filter !== 'all' || q)) return '';
    const cs = r.tech.cats[id]?.score;
    const open = state.openCats.has(id) || q || state.filter !== 'all';
    return `<details class="sig-group" data-cat="${id}"${open ? ' open' : ''}><summary><h4>${meta.label}<small>${Math.round(meta.weight * 100)}% · ${list.length} sinyal</small></h4><span class="score-chip" style="--fill:${U.scoreFill(cs, 0.4)};--fg:${U.scoreColor(cs)}">${U.fmtSigned(cs, 0)}</span></summary>
      ${list.map((s) => `<div class="sig${s.vote === null ? ' off' : ''}"><div class="nm"><b>${U.esc(s.name)}</b><small>${U.esc(s.detail)}</small></div>${U.voteBar(s.vote)}<span class="v" style="color:${U.scoreColor((s.vote ?? NaN) * 100)}">${s.vote === null ? 'n/a' : U.fmtSigned(s.vote * 100, 0)}</span></div>`).join('') || '<div class="empty">—</div>'}
    </details>`;
  }).join('');
  setHtml($('signals'), html || '<div class="empty">Tidak ada sinyal yang cocok dengan pencarian.</div>');
}

function cellHtml(v) {
  return `<span class="cell" style="--fill:${U.scoreFill(v, 0.42)};--fg:${U.scoreColor(v)}">${fin(v) ? U.fmtSigned(v, 0) : '–'}</span>`;
}

function renderAiTable(snap) {
  const rows = TF_IDS.map((id) => {
    const r = snap.results[id];
    const ai = r?.ai;
    const sel = id === state.selected ? ' class="sel"' : '';
    if (!ai) return `<tr data-tf="${id}"${sel}><td class="tfc">${id}</td><td colspan="6" class="muted">${U.esc(r?.aiError || r?.error || 'memuat')}</td></tr>`;
    const e = ai.oos.ensemble;
    return `<tr data-tf="${id}"${sel}>
      <td class="tfc">${id}</td>
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

function renderMatrix(snap) {
  const cats = Object.keys(CATEGORIES);
  const head = `<thead><tr><th>TF</th><th>Putusan</th><th>Skor</th><th>Yakin</th><th>AI</th>${cats.map((c) => `<th>${CATEGORIES[c].label}</th>`).join('')}<th>DXY</th><th>Anti-DXY</th><th>RSI</th><th>VWAP</th><th>Support</th><th>Resistance</th></tr></thead>`;
  const rows = TF_IDS.map((id) => {
    const r = snap.results[id];
    const sel = id === state.selected ? ' class="sel"' : '';
    if (!r || r.error) return `<tr data-tf="${id}"${sel}><td class="tfc">${id}</td><td colspan="${cats.length + 11}" class="muted">${U.esc(r?.error || 'memuat…')}</td></tr>`;
    const f = r.final;
    return `<tr data-tf="${id}"${sel}>
      <td class="tfc">${id}</td>
      <td class="lbl tone-${f.label.tone}">${U.arrow(f.score)} ${f.label.text}</td>
      <td><span class="scorebar">${U.voteBar(f.score / 100)}</span>${U.fmtSigned(f.score, 0)}</td>
      <td>${f.confidence}%</td>
      <td>${r.ai ? U.pct(r.ai.p, 0) : '…'}</td>
      ${cats.map((c) => `<td>${cellHtml(r.tech.cats[c]?.score)}</td>`).join('')}
      <td>${cellHtml((r.ctx.dxy ?? NaN) * 100)}</td>
      <td>${fin(r.ctx.corr) ? r.ctx.corr.toFixed(2) : '–'}</td>
      <td>${U.fmt(r.meta.rsi, 1)}</td>
      <td>${U.fmt(r.levels.vwap)}</td>
      <td class="pos">${U.fmt(r.levels.support)}</td>
      <td class="neg">${U.fmt(r.levels.resistance)}</td>
    </tr>`;
  }).join('');
  setHtml($('matrix'), `${head}<tbody>${rows}</tbody>`);
}

// ---------------------------------------------------------------- konteks
function renderIntermarket(snap) {
  const sc = snap.market.scanner;
  const dxy = snap.market.quotes?.['TVC:DXY']?.lp ?? sc?.dxy?.close;
  setText($('dxy-meta'), fin(dxy) ? `DXY ${U.fmt(dxy, 3)} · sintetis ${U.fmt(snap.global.syntheticDxy, 3)}` : '');
  const dr1d = sc?.dxy?.ratings?.[''];
  const top = `<div class="im-top">
    <div class="tk"><span>Arah DXY harian</span><b style="color:${U.scoreColor(-(dr1d ?? NaN) * 100)}">${tvLabel(dr1d)}</b><em>${fin(dr1d) ? (dr1d > 0 ? 'menekan emas' : dr1d < 0 ? 'mendukung emas' : 'netral') : ''}</em></div>
    <div class="tk"><span>Yield &amp; VIX → emas</span><b style="color:${U.scoreColor((snap.global.rates ?? NaN) * 100)}">${U.fmtSigned((snap.global.rates ?? NaN) * 100, 0)}</b><em>${(snap.global.rates ?? 0) < 0 ? 'yield naik' : 'yield turun'}</em></div>
  </div>`;
  const fxLabel = Object.values(snap.results).find((r) => r?.ctx?.fxLabel)?.ctx.fxLabel || 'DXY';
  const rows = TF_IDS.map((id) => {
    const r = snap.results[id];
    if (!r || r.error) return '';
    const dr = r.ctx.dxyRating;
    return `<div class="corr-row"><b>${id}</b>
      <div class="mini">${U.voteBar(fin(dr) ? -dr : NaN)}<em style="color:${U.scoreColor(-(dr ?? NaN) * 100)}">${fin(dr) ? U.fmtSigned(-dr * 100, 0) : '–'}</em></div>
      <div class="mini">${U.voteBar(r.ctx.corr)}<em>${fin(r.ctx.corr) ? r.ctx.corr.toFixed(2) : '–'}</em></div></div>`;
  }).join('');
  setHtml($('intermarket'), `${top}<div class="corr-head"><span>TF</span><span>Efek DXY ke emas</span><span>Anti-korelasi ${fxLabel === 'DXY' ? 'DXY' : 'dolar'}</span></div>${rows}
    <p class="sent-note">DXY menguat menekan emas. Anti-korelasi positif = emas sedang bergerak berlawanan dengan dolar di timeframe itu; makin kecil, makin kecil bobot DXY di skor.</p>`);
}

function renderCalendar(snap) {
  const now = Date.now();
  const events = snap.global.events.filter((e) => e.importance >= 1 && currencyUsdSign(e.currency));
  const gen = snap.market.newsGeneratedAt;
  const age = gen ? now - Date.parse(gen) : NaN;
  const meta = $('news-meta');
  setText(meta, fin(age) ? `${age > 3_600_000 ? 'tertunda · ' : 'diperbarui '}${U.timeAgo(age)} lalu` : 'belum tersedia');
  meta.style.color = fin(age) && age > 3_600_000 ? 'var(--gold-2)' : '';
  if (!events.length) {
    setHtml($('calendar'), '<div class="empty">Kalender belum termuat (diperbarui GitHub Actions tiap ±15 menit).</div>');
    return;
  }
  const upcoming = events.filter((e) => Date.parse(e.date) > now - 15 * 60_000).slice(0, 10);
  const past = events.filter((e) => Date.parse(e.date) <= now - 15 * 60_000).reverse().slice(0, 10);
  const row = (e, future) => {
    const t = Date.parse(e.date);
    const sv = surpriseVote(e, now);
    const soon = future && t - now < 30 * 60_000;
    const impact = sv
      ? `<span style="color:${U.scoreColor(sv.vote * 100)}">${sv.vote > 0.02 ? '▲ emas' : sv.vote < -0.02 ? '▼ emas' : '≈ sesuai'}</span>`
      : future ? `<span data-countdown="${t}" style="color:${soon ? 'var(--bear)' : 'var(--text-2)'}">${U.countdown(t - now)}</span>` : '<span class="muted">–</span>';
    return `<div class="ev${soon ? ' soon' : ''}"><div class="when"><b>${U.wib(t)}</b>${U.wib(t, true).split(' ').slice(0, 2).join(' ')}</div>
      <div class="ttl"><b><span class="flag">${U.esc(e.currency)}</span>${U.esc(e.title)}</b>
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
  const vote = (v) => `<b style="color:${U.scoreColor((v ?? NaN) * 100)}">${U.fmtSigned((v ?? NaN) * 100, 0)}</b>`;
  setHtml($('sentiment'), `
    <div class="sent-block"><h4>Akun Binance XAUUSDT <b>L/S ${U.fmt(s.longShort, 2)}</b></h4>${lsBar}
      <p class="sent-note">Kontrarian: mayoritas ritel long = bahan bakar turun. Suara ke emas ${vote(g.longShort)}</p></div>
    <div class="sent-block"><h4>Funding rate <b>${fin(s.funding) ? `${(s.funding * 100).toFixed(4)}%` : '–'}</b></h4>
      <p class="sent-note">Open interest ${U.fmt(s.openInterest, 0)} · suara ${vote(g.funding)}</p></div>
    <div class="sent-block"><h4>COT managed money <b>${cot ? U.fmt(cot.net, 0) : '–'}</b></h4>
      ${U.sparklineSvg(hist, { width: 300, height: 44, area: true, dot: true })}
      <p class="sent-note">${cot ? `Persentil 3 tahun ${Math.round(cot.percentile * 100)} · ${U.esc(snap.market.cotLatest?.date || '')} · dipakai untuk 1D–1M` : 'Memuat data CFTC…'}</p></div>
    <div class="sent-block"><h4>Nada headline 24 jam ${vote(g.headlines.vote)}</h4>
      <p class="sent-note">${g.headlines.scored.length} headline bernada dari leksikon emas/dolar/yield.</p></div>`);
}

function renderHeadlines(snap) {
  const now = Date.now();
  const scored = new Map(snap.global.headlines.scored.map((h) => [h.id, h.score]));
  const list = (snap.market.headlines || []).slice(0, 20);
  setText($('headline-meta'), list.length ? `${list.length} terbaru` : '');
  setHtml($('headlines'), list.length ? list.map((h) => {
    const sc = scored.get(h.id);
    const safeUrl = h.url && /^https:\/\/www\.tradingview\.com\//.test(h.url) ? h.url : null;
    return `<div class="hl"><i style="background:${fin(sc) ? U.scoreColor(sc * 100) : 'var(--neutral-2)'}"></i><div>
      ${safeUrl ? `<a href="${U.esc(safeUrl)}" target="_blank" rel="noopener">${U.esc(h.title)}</a>` : `<span>${U.esc(h.title)}</span>`}
      <small>${U.esc(h.source)} · ${U.timeAgo(now - h.published * 1000)} lalu</small></div></div>`;
  }).join('') : '<div class="empty">Headline belum termuat.</div>');
}

// ---------------------------------------------------------------- perubahan sinyal, notifikasi, favicon
function trackChanges(snap) {
  const now = Date.now();
  const { next, events } = U.diffVerdicts(state.verdicts, snap.results, TF_IDS, now);
  state.verdicts = { ...(state.verdicts || {}), ...next };
  if (events.length) {
    state.activity = [...events.reverse(), ...state.activity].slice(0, 40);
    renderActivity();
  }
  const o = snap.summary.overall;
  if (state.overallLabel && U.direction(state.overallLabel) !== U.direction(o.label.text)) {
    toast(`Putusan gabungan: <b>${U.esc(state.overallLabel)}</b> → <b style="color:${U.scoreColor(o.score)}">${U.esc(o.label.text)}</b>`, o.score);
    setText($('live-announcer'), `Putusan gabungan berubah menjadi ${o.label.text}`);
  }
  if (state.overallLabel !== o.label.text) setFavicon(o.label.tone);
  state.overallLabel = o.label.text;
  const hz = Object.fromEntries(snap.summary.horizons.map((h) => [h.id, h]));
  if (state.horizonLabels) {
    for (const h of Object.values(hz)) {
      const prev = state.horizonLabels[h.id];
      if (prev && U.direction(prev) !== U.direction(h.label.text)) toast(`${U.esc(h.name)}: <b>${U.esc(prev)}</b> → <b style="color:${U.scoreColor(h.score)}">${U.esc(h.label.text)}</b>`, h.score);
    }
  }
  state.horizonLabels = Object.fromEntries(Object.values(hz).map((h) => [h.id, h.label.text]));
}

function renderActivity() {
  setHtml($('activity'), state.activity.map((e) => `<li class="act">
    <time>${U.wib(e.at)}</time><span class="tfb">${e.tf}</span>
    <span class="chg">${U.esc(e.from)}<em>→</em><span style="color:${U.scoreColor(e.score)}">${U.esc(e.to)}</span></span>
    <span class="sc" style="color:${U.scoreColor(e.score)}">${U.fmtSigned(e.score, 0)}</span></li>`).join(''));
  setText($('activity-meta'), `${state.activity.length} perubahan arah sejak dibuka`);
}

function toast(html, score) {
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.style.setProperty('--c', U.scoreColor(score));
  el.innerHTML = `<span class="t-ico">${U.arrow(score)}</span><div>${html}</div><button type="button" aria-label="Tutup">×</button>`;
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 300); };
  el.querySelector('button').addEventListener('click', close);
  box.prepend(el);
  while (box.children.length > 3) box.lastElementChild.remove();
  setTimeout(close, 7000);
}

function setFavicon(tone) {
  const link = $('favicon');
  if (link) link.href = `data:image/svg+xml,${encodeURIComponent(U.faviconSvg(tone))}`;
}

// ---------------------------------------------------------------- status feed
function feedList(snap) {
  const tv = snap?.tvMode;
  return [
    ...(tv ? [['tv', 'TradingView candle broker + DXY', 90_000], ['tv_quote', 'TradingView tick broker', 20_000]] : []),
    ['scanner', 'TradingView scanner (quote, rating, data ekonomi)', 30_000],
    ['ws_perp', 'Binance XAUUSDT (WebSocket, volume asli)', 20_000],
    ['ws_paxg', 'Binance PAXGUSDT (WebSocket)', 180_000],
    ['rest_perp', 'Riwayat candle Binance perp', 3_600_000],
    ['rest_paxg', 'Riwayat candle PAXG', 3_600_000],
    ...(tv ? [] : [['rest_eur', 'EURUSDT (proksi DXY)', 600_000], ['rest_paxg_intraday', 'Cadangan PAXGUSDT intraday', Infinity]]),
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
  const tickAge = snap?.source === 'tv' ? st.tv_quote?.at : st.ws_perp?.at;
  setText($('feeds-summary'), worst === 'up' ? `Live${fin(tickAge) ? ` · tick ${U.timeAgo(now - tickAge)}` : ''}` : worst === 'down' ? 'Feed bermasalah' : 'Menyambung…');
  $('feeds-btn').setAttribute('aria-label', `Status feed: ${worst === 'up' ? 'live' : worst === 'down' ? 'bermasalah' : 'menyambung'}`);
  if ($('feeds-panel').hidden) return;
  $('feeds-list').innerHTML = feeds.map(([k, name], i) => {
    const s = st[k] || {};
    const age = fin(s.at) ? `${U.timeAgo(now - s.at)} lalu` : 'belum';
    return `<div class="feed-row"><span class="dot ${levels[i]}"></span><div>${name}<small>${s.error ? `<span class="err">${U.esc(s.error)}</span>` : age}${fin(s.latency) ? ` · latensi ${s.latency} ms` : ''}</small></div><span class="muted">${U.esc(s.state || '')}</span></div>`;
  }).join('');
}

// ---------------------------------------------------------------- chart
function renderOverlayMenu() {
  $('overlays').innerHTML = OVERLAYS.map(([k, label, color]) => `<label class="ov" style="--c:${color}"><input type="checkbox" data-ov="${k}"${state.overlays[k] ? ' checked' : ''}>${label}<i></i></label>`).join('');
}

function updateCountdown(now) {
  const bars = state.snap?.chart?.bars;
  const tf = TIMEFRAMES.find((t) => t.id === state.selected);
  const el = $('bar-countdown');
  if (!bars?.length || !tf || state.snap.selected !== state.selected) { setText(el, '–'); return; }
  const closeAt = U.barCloseAt(bars.at(-1).t, tf.id, tf.ms);
  const left = closeAt - now;
  setText(el, left > 0 ? `tutup ${U.countdown(left)}` : 'menunggu bar baru');
}

function drawChart() {
  const snap = state.snap;
  const canvas = $('chart');
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  const C = state.colors || (state.colors = cssColors());
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
    ctx.fillStyle = C.text3;
    ctx.font = '13px Inter, sans-serif';
    ctx.fillText('Memuat candle…', 16, 40);
    setHtml($('chart-legend'), '');
    return;
  }
  const r = snap.results[state.selected];
  const ov = activeOverlays();
  const lines = chart.lines;
  const padR = 78;
  const padB = 24;
  const plotW = w - padR;
  const plotH = h - padB;
  const volH = ov.volume ? plotH * 0.16 : 0;
  const priceH = plotH - volH - 6;

  let lo = Math.min(...bars.map((b) => b.l));
  let hi = Math.max(...bars.map((b) => b.h));
  const span0 = hi - lo;
  const levels = [];
  if (ov.sr && r?.levels) { levels.push([r.levels.resistance, C.down, [6, 4], 'R']); levels.push([r.levels.support, C.up, [6, 4], 'S']); }
  if (ov.profile && chart.profile) {
    levels.push([chart.profile.poc, '#e879f9', [2, 3], 'POC']);
    levels.push([chart.profile.vah, 'rgba(232,121,249,.55)', [2, 5], 'VAH']);
    levels.push([chart.profile.val, 'rgba(232,121,249,.55)', [2, 5], 'VAL']);
  }
  for (const [v] of levels) if (fin(v) && v > lo - span0 * 0.3 && v < hi + span0 * 0.3) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const pad = (hi - lo) * 0.06 || 1;
  lo -= pad;
  hi += pad;
  const y = (p) => 8 + priceH - ((p - lo) / (hi - lo)) * priceH;
  const yToPrice = (yy) => lo + ((8 + priceH - yy) / priceH) * (hi - lo);
  const step = plotW / bars.length;
  const bw = Math.max(1, Math.min(14, step * 0.64));
  const xAt = (i) => i * step + step / 2;
  const last = bars[bars.length - 1];
  const lastY = y(last.c);

  // Grid & sumbu harga (label yang bertabrakan dengan label harga terakhir dilewati).
  ctx.font = '600 11px "JetBrains Mono", monospace';
  ctx.lineWidth = 1;
  const ticks = 6;
  for (let i = 0; i <= ticks; i++) {
    const p = lo + ((hi - lo) * i) / ticks;
    const yy = Math.round(y(p)) + 0.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.045)';
    ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(plotW, yy); ctx.stroke();
    if (Math.abs(yy - lastY) > 16) {
      ctx.fillStyle = C.text3;
      ctx.fillText(U.fmt(p, 2), plotW + 8, yy + 4);
    }
  }
  const dated = ['1D', '1W', '1M'].includes(state.selected);
  const labelEvery = Math.max(1, Math.ceil(bars.length / Math.max(3, Math.floor(plotW / 110))));
  ctx.fillStyle = C.text3;
  bars.forEach((b, i) => {
    if (i % labelEvery !== 0) return;
    const x = xAt(i);
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, 8); ctx.lineTo(Math.round(x) + 0.5, plotH); ctx.stroke();
    const text = dated ? U.wib(b.t, true).split(' ')[1] : U.wib(b.t);
    const tw = ctx.measureText(text).width;
    ctx.fillText(text, Math.max(2, Math.min(plotW - tw - 2, x - tw / 2)), h - 7);
  });

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, plotW, plotH);
  ctx.clip();

  if (ov.volume) {
    const maxV = Math.max(...bars.map((b) => b.v || 0)) || 1;
    bars.forEach((b, i) => {
      const vh = ((b.v || 0) / maxV) * volH;
      ctx.fillStyle = b.c >= b.o ? 'rgba(34,197,94,0.28)' : 'rgba(239,68,68,0.28)';
      ctx.fillRect(xAt(i) - bw / 2, plotH - vh, bw, vh);
    });
  }

  if (ov.vwap && lines.vwapUp) {
    ctx.fillStyle = 'rgba(96,165,250,0.07)';
    ctx.beginPath();
    let started = false;
    lines.vwapUp.forEach((v, i) => { if (v === null) return; if (!started) { ctx.moveTo(xAt(i), y(v)); started = true; } else ctx.lineTo(xAt(i), y(v)); });
    for (let i = lines.vwapDn.length - 1; i >= 0; i--) { const v = lines.vwapDn[i]; if (v !== null) ctx.lineTo(xAt(i), y(v)); }
    ctx.closePath();
    ctx.fill();
  }

  bars.forEach((b, i) => {
    const x = xAt(i);
    const col = b.c >= b.o ? C.up : C.down;
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, y(b.h)); ctx.lineTo(Math.round(x) + 0.5, y(b.l)); ctx.stroke();
    ctx.fillRect(x - bw / 2, y(Math.max(b.o, b.c)), bw, Math.max(1, Math.abs(y(b.o) - y(b.c))));
  });

  const path = (arr, color, width = 1.6, dash = [], colorBySlope = false) => {
    if (!arr) return;
    ctx.setLineDash(dash);
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    for (let i = 1; i < arr.length; i++) {
      const a = arr[i - 1];
      const b = arr[i];
      if (a === null || b === null) continue;
      ctx.strokeStyle = colorBySlope ? (b >= a ? C.up : C.down) : color;
      ctx.beginPath(); ctx.moveTo(xAt(i - 1), y(a)); ctx.lineTo(xAt(i), y(b)); ctx.stroke();
    }
    ctx.setLineDash([]);
  };
  if (ov.sma200) path(lines.sma200, '#f472b6', 1.6);
  if (ov.sma50) path(lines.sma50, '#fb923c', 1.4);
  if (ov.sma20) path(lines.sma20, '#facc15', 1.2);
  if (ov.vwap) { path(lines.vwap, '#60a5fa', 1.8); path(lines.vwapUp, 'rgba(96,165,250,.55)', 1, [4, 3]); path(lines.vwapDn, 'rgba(96,165,250,.55)', 1, [4, 3]); }
  if (ov.supertrend) path(lines.supertrend, '#f5c451', 1.4, [1, 2]);
  if (ov.hma21) path(lines.hma21, '#a78bfa', 1.8);
  if (ov.hma9) path(lines.hma9, '#22d3ee', 2.2, [], true);

  ctx.font = '600 11px "JetBrains Mono", monospace';
  const usedY = [lastY];
  for (const [v, color, dash, name] of levels) {
    if (!fin(v) || v < lo || v > hi) continue;
    const yy = Math.round(y(v)) + 0.5;
    ctx.setLineDash(dash);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(plotW, yy); ctx.stroke();
    ctx.setLineDash([]);
    // Label yang terlalu dekat dengan label lain dilewati; garisnya tetap tergambar.
    if (usedY.some((u) => Math.abs(u - yy) < 14)) continue;
    usedY.push(yy);
    ctx.fillStyle = color;
    const text = `${name} ${U.fmt(v, 2)}`;
    ctx.fillText(text, plotW - ctx.measureText(text).width - 8, yy - 5);
  }

  // Garis harga terakhir.
  ctx.setLineDash([2, 3]);
  ctx.strokeStyle = last.c >= last.o ? 'rgba(34,197,94,.6)' : 'rgba(239,68,68,.6)';
  ctx.beginPath(); ctx.moveTo(0, Math.round(lastY) + 0.5); ctx.lineTo(plotW, Math.round(lastY) + 0.5); ctx.stroke();
  ctx.setLineDash([]);

  // Crosshair.
  const hv = state.hover;
  if (hv && hv.i >= 0 && hv.i < bars.length) {
    ctx.strokeStyle = 'rgba(238,242,248,.35)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(Math.round(xAt(hv.i)) + 0.5, 0); ctx.lineTo(Math.round(xAt(hv.i)) + 0.5, plotH); ctx.stroke();
    if (hv.y > 8 && hv.y < 8 + priceH) { ctx.beginPath(); ctx.moveTo(0, Math.round(hv.y) + 0.5); ctx.lineTo(plotW, Math.round(hv.y) + 0.5); ctx.stroke(); }
    ctx.setLineDash([]);
  }
  ctx.restore();

  const tag = (yy, text, bg, fg) => {
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(plotW + 2, yy - 10, padR - 4, 20, 5) : ctx.rect(plotW + 2, yy - 10, padR - 4, 20);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.font = '700 11px "JetBrains Mono", monospace';
    ctx.fillText(text, plotW + 7, yy + 4);
  };
  tag(lastY, U.fmt(last.c, 2), last.c >= last.o ? C.up : C.down, C.bg);
  if (hv && hv.y > 8 && hv.y < 8 + priceH) tag(hv.y, U.fmt(yToPrice(hv.y), 2), C.text, C.bg);
  if (hv && hv.i >= 0 && hv.i < bars.length) {
    const label = dated ? U.wib(bars[hv.i].t, true) : U.wib(bars[hv.i].t, true);
    const tw = ctx.measureText(label).width + 12;
    const tx = Math.max(0, Math.min(plotW - tw, xAt(hv.i) - tw / 2));
    ctx.fillStyle = C.text;
    ctx.fillRect(tx, h - 20, tw, 18);
    ctx.fillStyle = C.bg;
    ctx.fillText(label, tx + 6, h - 7);
  }

  // Legend OHLC + nilai overlay untuk bar yang ditunjuk (atau bar terakhir).
  const i = hv && hv.i >= 0 && hv.i < bars.length ? hv.i : bars.length - 1;
  const b = bars[i];
  const up = b.c >= b.o;
  const val = (k) => (lines[k]?.[i] != null ? U.fmt(lines[k][i], 2) : '–');
  const item = (k, name, color) => (ov[k] ? `<span><i class="lg-i" style="background:${color}"></i>${name} <b>${val(k)}</b></span>` : '');
  setHtml($('chart-legend'), `<span style="color:${up ? 'var(--bull)' : 'var(--bear)'}">O <b>${U.fmt(b.o)}</b> H <b>${U.fmt(b.h)}</b> L <b>${U.fmt(b.l)}</b> C <b>${U.fmt(b.c)}</b></span>
    ${item('hma9', 'Hull9', '#22d3ee')}${item('hma21', 'Hull21', '#a78bfa')}${item('sma50', 'SMA50', '#fb923c')}${item('sma200', 'SMA200', '#f472b6')}${item('vwap', 'VWAP', '#60a5fa')}`);
}

// ---------------------------------------------------------------- latar debu emas
// Partikel emas yang melayang pelan; tanpa garis antar-titik (O(n)), berhenti saat tab tidak terlihat.
function goldDust() {
  const canvas = $('bg-dust');
  if (!canvas || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ctx = canvas.getContext('2d');
  let parts = [];
  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.min(70, Math.round((innerWidth * innerHeight) / 22000));
    parts = Array.from({ length: count }, () => ({
      x: Math.random() * innerWidth, y: Math.random() * innerHeight,
      r: 0.4 + Math.random() * 1.6, vy: -(0.05 + Math.random() * 0.22), vx: (Math.random() - 0.5) * 0.08,
      a: 0.15 + Math.random() * 0.5, tw: Math.random() * Math.PI * 2,
    }));
  };
  resize();
  addEventListener('resize', resize);
  const frame = () => {
    if (document.hidden) { setTimeout(() => requestAnimationFrame(frame), 1000); return; }
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.tw += 0.03;
      if (p.y < -4) { p.y = innerHeight + 4; p.x = Math.random() * innerWidth; }
      const alpha = p.a * (0.6 + 0.4 * Math.sin(p.tw));
      ctx.fillStyle = `rgba(243, 220, 138, ${alpha.toFixed(3)})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      if (p.r > 1.5) {
        ctx.fillStyle = `rgba(212, 175, 55, ${(alpha * 0.25).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 3, 0, Math.PI * 2); ctx.fill();
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- navigasi & event
function scrollSpy() {
  const links = [...document.querySelectorAll('#sections-nav a')];
  const sections = links.map((a) => document.querySelector(a.getAttribute('href'))).filter(Boolean);
  // Simpan status semua section; callback hanya berisi entri yang BERUBAH, jadi jangan diputuskan dari situ saja.
  const inView = new Map();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) inView.set(e.target.id, e.isIntersecting);
    const current = sections.find((s) => inView.get(s.id));
    if (!current) return;
    links.forEach((a) => {
      const on = a.getAttribute('href') === `#${current.id}`;
      a.classList.toggle('on', on);
      if (on) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current');
    });
  }, { rootMargin: '-15% 0px -70% 0px' });
  sections.forEach((s) => io.observe(s));
}

function bind() {
  document.addEventListener('click', (e) => {
    const tfEl = e.target.closest('[data-tf]');
    if (tfEl) select(tfEl.dataset.tf);
    const seg = e.target.closest('#signal-filter button');
    if (seg) {
      state.filter = seg.dataset.f;
      document.querySelectorAll('#signal-filter button').forEach((b) => { b.classList.toggle('on', b === seg); b.setAttribute('aria-checked', String(b === seg)); });
      const r = state.snap?.results[state.selected];
      if (r?.signals) renderSignals(r);
    }
    const groupSummary = e.target.closest('.sig-group > summary');
    if (groupSummary) {
      const cat = groupSummary.parentElement.dataset.cat;
      // Status disimpan sebelum browser membalik atribut open, supaya render berikutnya tidak menutupnya lagi.
      if (groupSummary.parentElement.open) state.openCats.delete(cat); else state.openCats.add(cat);
      delete state.hashes.signals;
    }
    const modeBtn = e.target.closest('[data-set-mode]');
    if (modeBtn) {
      applyMode(modeBtn.dataset.setMode);
      if (modeBtn.classList.contains('btn-gold')) window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    const styleBtn = e.target.closest('#style-picker .style-btn');
    if (styleBtn) setStyle(styleBtn.dataset.style);
    const br = e.target.closest('#broker-seg button');
    if (br) setBroker(br.dataset.broker);
    const panel = $('feeds-panel');
    if (e.target.closest('#feeds-btn')) {
      panel.hidden = !panel.hidden;
      $('feeds-btn').setAttribute('aria-expanded', String(!panel.hidden));
      renderFeeds();
    } else if (!panel.hidden && !e.target.closest('#feeds-panel')) {
      panel.hidden = true;
      $('feeds-btn').setAttribute('aria-expanded', 'false');
    }
    const menu = $('overlay-menu');
    if (menu.open && !e.target.closest('#overlay-menu')) menu.open = false;
  });
  $('overlays').addEventListener('change', (e) => {
    const k = e.target.dataset.ov;
    if (!k) return;
    state.overlays[k] = e.target.checked;
    save('overlays', state.overlays);
    queueDraw();
  });
  $('signal-search').addEventListener('input', (e) => {
    state.query = e.target.value;
    const r = state.snap?.results[state.selected];
    if (r?.signals) renderSignals(r);
  });
  $('heatmap').addEventListener('keydown', (e) => {
    const idx = TF_IDS.indexOf(state.selected);
    const map = { ArrowRight: idx + 1, ArrowDown: idx + 1, ArrowLeft: idx - 1, ArrowUp: idx - 1, Home: 0, End: TF_IDS.length - 1 };
    if (!(e.key in map)) return;
    e.preventDefault();
    select(TF_IDS[Math.max(0, Math.min(TF_IDS.length - 1, map[e.key]))], { focus: true });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    $('feeds-panel').hidden = true;
    $('feeds-btn').setAttribute('aria-expanded', 'false');
    $('overlay-menu').open = false;
  });
  addEventListener('hashchange', () => {
    const tf = decodeURIComponent(location.hash.replace('#tf-', ''));
    if (TF_IDS.includes(tf)) select(tf);
  });
  const canvas = $('chart');
  const hover = (e) => {
    const bars = state.snap?.chart?.bars;
    if (!bars?.length) return;
    const rect = canvas.getBoundingClientRect();
    const plotW = rect.width - 78;
    const x = e.clientX - rect.left;
    const i = Math.floor((x / plotW) * bars.length);
    state.hover = x >= 0 && x <= plotW ? { i, y: e.clientY - rect.top } : null;
    queueDraw();
  };
  canvas.addEventListener('pointermove', hover);
  canvas.addEventListener('pointerdown', hover);
  canvas.addEventListener('pointerleave', () => { state.hover = null; queueDraw(); });
  new ResizeObserver(() => queueDraw()).observe(canvas);
  const tick = () => {
    const now = Date.now();
    setText($('clock-wib'), new Date(now + 7 * 3_600_000).toISOString().slice(11, 19));
    document.querySelectorAll('[data-countdown]').forEach((el) => setText(el, U.countdown(Number(el.dataset.countdown) - now)));
    updateCountdown(now);
    if (state.snap) renderFeeds();
  };
  tick();
  setInterval(tick, 1000);
}

applyMode(state.mode);
setStyle(state.style, { syncChart: state.mode === 'simple' });
renderBrokerSeg();
renderOverlayMenu();
bind();
scrollSpy();
goldDust();
startData();
