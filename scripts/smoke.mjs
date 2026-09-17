// Uji asap dengan data sungguhan: TradingView (broker + DXY) + Binance + scanner,
// lalu hitung semua timeframe termasuk pelatihan AI, dan ukur waktunya.
import { baseStreams, TIMEFRAMES } from '../js/candles.js';
import { klineUrl, parseKlines, scannerRequest, parseScanner, COT_URL, parseCot } from '../js/feeds.js';
import { TvFeed, BROKERS, mergeBars } from '../js/tvfeed.js';
import { seriesPlan, QUOTE_SYMBOLS } from '../js/hub.js';
import { computeAll } from '../js/engine.js';

const broker = process.argv[2] || 'PEPPERSTONE';
const get = async (url, init) => {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
};

const store = { gold: {}, dxy: {}, perp: {}, paxg: {}, eur: {} };
const quotes = {};
const errors = [];
const plan = seriesPlan(broker);
await new Promise((resolve) => {
  const feed = new TvFeed({
    // Node tidak mengirim Origin; simulasikan mode lokal (localhost) yang memang diizinkan TradingView.
    socket: (url) => new WebSocket(url, { headers: { Origin: 'http://localhost' } }),
    series: plan,
    quotes: [BROKERS[broker], ...QUOTE_SYMBOLS],
    onBars: (key, bars) => {
      const [kind, res] = key.split('_');
      const bucket = kind === 'gold' ? store.gold : store.dxy;
      bucket[res] = mergeBars(bucket[res] || [], bars);
      if (Object.keys(store.gold).length + Object.keys(store.dxy).length >= plan.length) setTimeout(() => { feed.stop(); resolve(); }, 1500);
    },
    onQuote: (sym, v) => { quotes[sym] = { ...(quotes[sym] || {}), ...v }; },
    onStatus: (st) => { if (st.state === 'error') errors.push(st.error); },
  });
  setTimeout(() => { feed.stop(); resolve(); }, 20000);
});
console.log('TV series:', Object.fromEntries(Object.entries(store.gold).map(([k, v]) => [k, v.length])), 'dxy', Object.keys(store.dxy).length, 'errors', errors.length);
console.log('quote', BROKERS[broker], quotes[BROKERS[broker]], 'DXY', quotes['TVC:DXY']?.lp);

const jobs = [];
for (const [feed, intervals] of Object.entries(baseStreams())) {
  for (const iv of intervals) jobs.push(get(klineUrl(feed, iv)).then((raw) => { store[feed][iv] = parseKlines(raw); }));
}
const scannerJson = await get('https://scanner.tradingview.com/global/scan', {
  method: 'POST', headers: { Origin: 'https://xyb3rpunq.github.io' }, body: JSON.stringify(scannerRequest()),
});
await Promise.all(jobs);
const market = {
  broker, scanner: parseScanner(scannerJson), quotes, cot: parseCot(await get(COT_URL)),
  sentiment: { longShort: 3.4, funding: 0.00016 }, news: { events: [], headlines: [] }, basis: {},
};

const aiCache = new Map();
let t0 = performance.now();
const out = computeAll(store, market, Date.now(), { source: 'tv', aiCache, maxTrain: Infinity, selected: '15m' });
const coldMs = performance.now() - t0;
t0 = performance.now();
computeAll(store, market, Date.now(), { source: 'tv', aiCache, maxTrain: Infinity, selected: '15m' });
const warmMs = performance.now() - t0;

const pct = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '–');
for (const tf of TIMEFRAMES) {
  const r = out.results[tf.id];
  if (r.error) { console.log(tf.id, 'ERROR', r.error); continue; }
  const c = r.tech.cats;
  const ai = r.ai;
  console.log(
    tf.id.padEnd(4), String(r.bars).padStart(5), r.final.label.text.padEnd(12), r.final.score.toFixed(1).padStart(6), `conf ${r.final.confidence}`,
    `T${c.trend.score?.toFixed(0)} M${c.momentum.score?.toFixed(0)} V${c.volume.score?.toFixed(0)} S${c.structure.score?.toFixed(0)} TV${c.consensus.score?.toFixed(0)}`,
    `| AI p=${pct(ai?.p)} rel=${ai?.reliability?.toFixed(2)} oosAcc=${pct(ai?.oos?.ensemble?.accuracy)} bss=${ai?.oos?.ensemble?.bss?.toFixed(3)} n=${ai?.testN} ${r.aiError || ''}`,
    `| antiDXY corr ${r.ctx.corr?.toFixed(2)} | ${r.meta.flow}`,
  );
}
console.log('overall', out.summary.overall);
console.log(`compute cold ${coldMs.toFixed(0)} ms (latih ${aiCache.size} model), warm ${warmMs.toFixed(0)} ms`);
const sel = out.results['15m'];
console.log('15m signals', sel.signals.length, sel.signals.filter((x) => x.cat === 'volume').map((x) => `${x.id}:${x.vote?.toFixed(2)}`).join(' '));
console.log('15m levels', sel.levels, 'AI top', sel.ai?.contributions?.slice(0, 3));
process.exit(0);
