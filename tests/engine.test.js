import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';
import { TIMEFRAMES, tvResolutions, aggregate, MIN, HOUR, DAY } from '../js/candles.js';
import { makeCandles } from './helpers.js';

const RES_MS = { 1: MIN, 3: 3 * MIN, 5: 5 * MIN, 15: 15 * MIN, 30: 30 * MIN, 45: 45 * MIN, 60: HOUR, 120: 2 * HOUR, 180: 3 * HOUR, 240: 4 * HOUR, '1D': DAY, '1W': 7 * DAY, '1M': 30 * DAY };

// Store sintetis: emas & DXY bergerak berlawanan pada setiap resolusi.
function syntheticStore() {
  const store = { gold: {}, dxy: {}, perp: {}, paxg: {}, eur: {} };
  for (const res of tvResolutions()) {
    const step = RES_MS[res];
    const n = res === '1M' ? 200 : 400;
    const t0 = Date.UTC(2026, 8, 17) - n * step;
    const gold = makeCandles(n, { seed: 100 + step / MIN, stepMs: step, t0, vol: 2, phi: 0.3 });
    store.gold[res] = gold;
    store.dxy[res] = gold.map((b, i) => ({ ...b, t: b.t - 5 * MIN, c: 200 - b.c / 40 + (i % 2) * 0.001, o: 200 - b.o / 40, h: 200 - b.l / 40, l: 200 - b.h / 40 }));
  }
  for (const tf of TIMEFRAMES) {
    const [feed, interval] = tf.bn;
    const step = { '1m': MIN, '3m': 3 * MIN, '5m': 5 * MIN, '15m': 15 * MIN, '30m': 30 * MIN, '1h': HOUR, '2h': 2 * HOUR, '4h': 4 * HOUR, '1d': DAY, '1w': 7 * DAY, '1M': 30 * DAY }[interval];
    if (store[feed][interval]) continue;
    const n = 300;
    store[feed][interval] = makeCandles(n, { seed: 500 + step / MIN, stepMs: step, t0: Date.UTC(2026, 8, 17) - n * step, start: 4010 });
    store.eur[interval] = store[feed][interval].map((b) => ({ ...b, c: b.c / 3700 }));
  }
  return store;
}

const market = {
  broker: 'PEPPERSTONE',
  scanner: { gold: { ratings: { 1: 0.2, 5: 0.3, 15: -0.1, '': -0.4 } }, dxy: { ratings: { 15: 0.5, '': 0.4 }, change: 0.3 }, us10y: { change: 0.5 }, fx: { EURUSD: 1.15, USDJPY: 156, GBPUSD: 1.33, USDCAD: 1.38, USDSEK: 9.85, USDCHF: 0.81 }, econ: {} },
  quotes: { 'TVC:DXY': { chp: 0.6 } },
  sentiment: { longShort: 3, funding: 0.0002 },
  cot: Array.from({ length: 30 }, (_, i) => ({ net: 100000 - i * 1000 })),
  news: { events: [], headlines: [] },
  basis: { perp: 7, paxg: 5 },
};

test('candlesFor, flowCandlesFor, fxFor', () => {
  const store = syntheticStore();
  const tf2 = TIMEFRAMES.find((t) => t.id === '2m');
  assert.equal(E.candlesFor(tf2, store, 'tv').length, aggregate(store.gold['1'], 2 * MIN).length);
  assert.equal(E.candlesFor(tf2, store, 'binance').length, aggregate(store.perp['1m'], 2 * MIN).length);
  assert.equal(E.flowCandlesFor(TIMEFRAMES[0], store), store.perp['1m']);
  assert.deepEqual(E.candlesFor(TIMEFRAMES[0], {}, 'tv'), []);
  assert.equal(E.fxFor(TIMEFRAMES[0], store, 'tv').label, 'DXY');
  assert.equal(E.fxFor(TIMEFRAMES[0], store, 'tv').sign, -1);
  assert.equal(E.fxFor(TIMEFRAMES[0], { dxy: {}, eur: store.eur }, 'tv').label, 'EURUSD');
  assert.equal(E.fxFor(TIMEFRAMES[0], store, 'binance').sign, 1);
});

test('pivotSourceFor memakai periode di atasnya', () => {
  const store = syntheticStore();
  const now = Date.UTC(2026, 8, 17);
  const p15 = E.pivotSourceFor(TIMEFRAMES.find((t) => t.id === '15m'), store, now, 'tv');
  assert.ok(p15 && Number.isFinite(p15.h));
  assert.ok(E.pivotSourceFor(TIMEFRAMES.find((t) => t.id === '1D'), store, now, 'tv'));
  assert.ok(E.pivotSourceFor(TIMEFRAMES.find((t) => t.id === '1W'), store, now, 'binance'));
  assert.ok(E.pivotSourceFor(TIMEFRAMES.find((t) => t.id === '1M'), store, now, 'tv'));
});

test('updateBasis, avgRating, riskFactorFor, changePct', () => {
  assert.equal(E.updateBasis(NaN, 105, 100), 5);
  assert.ok(Math.abs(E.updateBasis(5, 110, 100, 0.5) - 7.5) < 1e-9);
  assert.equal(E.updateBasis(3, NaN, 100), 3);
  assert.equal(E.avgRating({ a: 0.2, b: 0.4 }, ['a', 'b']), 0.30000000000000004);
  assert.equal(E.avgRating({}, ['a']), null);
  assert.equal(E.riskFactorFor({ ms: MIN }, 0.5), 0.5);
  assert.ok(Math.abs(E.riskFactorFor({ ms: 4 * HOUR }, 0.25) - 0.5) < 1e-9);
  assert.equal(E.riskFactorFor({ ms: 7 * DAY }, 0.5), 1);
  assert.equal(E.changePct(market, 'TVC:DXY', 'dxy'), 0.6);
  assert.equal(E.changePct(market, 'TVC:US10Y', 'us10y'), 0.5);
});

test('globalContext merangkum konteks makro', () => {
  const g = E.globalContext(market, Date.UTC(2026, 8, 17));
  assert.ok(g.rates < 0);
  assert.equal(g.dxyChange, 0.6);
  assert.ok(g.longShort < 0);
  assert.ok(g.cot && g.cot.percentile === 1);
  assert.ok(g.syntheticDxy > 90 && g.syntheticDxy < 110);
  assert.equal(g.risk.active, false);
});

test('ensureModel: melatih sekali per bar tutup dan menghormati anggaran', () => {
  const cache = new Map();
  const s = { t: [1, 2, 3], c: [1, 2, 3] };
  const budget = { left: 1 };
  const rows = [null, null, null];
  const m1 = E.ensureModel(cache, 'k', rows, s, budget, 10);
  assert.match(m1.error, /sampel/);
  assert.equal(budget.left, 0);
  assert.equal(E.ensureModel(cache, 'k', rows, s, budget, 11), m1);
  assert.equal(E.ensureModel(cache, 'other', rows, s, budget, 12), null);
  const s2 = { t: [1, 2, 3, 4], c: [1, 2, 3, 4] };
  assert.equal(E.ensureModel(cache, 'k', [null, null, null, null], s2, { left: 0 }, 13), m1);
});

test('computeAll (mode broker): semua timeframe terisi, AI dilatih, anti-DXY positif', () => {
  const store = syntheticStore();
  const cache = new Map();
  const now = Date.UTC(2026, 8, 17);
  const out = E.computeAll(store, market, now, { source: 'tv', aiCache: cache, maxTrain: Infinity, selected: '15m' });
  for (const tf of TIMEFRAMES) {
    const r = out.results[tf.id];
    assert.ok(!r.error, `${tf.id}: ${r.error}`);
    assert.ok(Number.isFinite(r.final.score), tf.id);
    assert.ok(r.final.score >= -100 && r.final.score <= 100);
    assert.equal(r.source, 'tv');
    assert.equal(r.meta.flow, 'volume asli Binance');
  }
  assert.ok(out.results['15m'].ctx.corr > 0.5, `anti-korelasi ${out.results['15m'].ctx.corr}`);
  assert.ok(out.results['4H'].ctx.corr > 0.5, 'as-of match bekerja walau jam buka DXY beda 5 menit');
  assert.ok(out.results['15m'].ai && Number.isFinite(out.results['15m'].ai.p));
  assert.ok(out.results['15m'].ind && out.results['15m'].series);
  assert.equal(out.results['1m'].ind, undefined);
  assert.ok(Number.isFinite(out.summary.overall.score));
  assert.ok(cache.size >= 13);
  const chart = E.chartPayload(out.results['15m'], 50);
  assert.equal(chart.bars.length, 50);
  assert.equal(chart.lines.hma9.length, 50);
  assert.ok(chart.profile && Number.isFinite(chart.profile.poc));
  assert.equal(E.chartPayload(out.results['1m']), null);
});

test('computeAll (mode web publik): level dikonversi dengan basis, anggaran latih dibatasi', () => {
  const store = syntheticStore();
  const cache = new Map();
  const out = E.computeAll(store, market, Date.UTC(2026, 8, 17), { source: 'binance', aiCache: cache, maxTrain: 2, selected: '1m' });
  const r = out.results['1m'];
  assert.equal(r.basis, 7);
  assert.ok(Math.abs(r.levels.price - (store.perp['1m'].at(-1).c - 7)) < 1e-9);
  assert.equal(cache.size, 2);
  assert.ok(out.results['1m'].ai || out.results['1m'].aiError);
  const chart = E.chartPayload(r, 20);
  assert.ok(Math.abs(chart.bars.at(-1).c - (store.perp['1m'].at(-1).c - 7)) < 1e-9);
  const empty = E.computeAll({}, market, Date.UTC(2026, 8, 17), { source: 'tv' });
  assert.match(empty.results['1m'].error, /belum cukup/);
});

test('computeTimeframe menangkap data kurang', () => {
  const r = E.computeTimeframe(TIMEFRAMES[0], { gold: { 1: makeCandles(10) } }, market, E.globalContext(market, 0), 0, { source: 'tv' });
  assert.match(r.error, /belum cukup/);
});

test('binanceFeedFor: perp bila ada, PAXG sebagai cadangan intraday', () => {
  const tf = TIMEFRAMES.find((t) => t.id === '5m');
  const withPerp = { perp: { '5m': makeCandles(40) }, paxg: { '5m': makeCandles(40) } };
  assert.equal(E.binanceFeedFor(tf, withPerp), 'perp');
  const fallback = { perp: {}, paxg: { '5m': makeCandles(40, { start: 4100 }) } };
  assert.equal(E.binanceFeedFor(tf, fallback), 'paxg');
  assert.equal(E.candlesFor(tf, fallback, 'binance')[0].o, 4100);
  assert.equal(E.binanceFeedFor(tf, { perp: {}, paxg: {} }), 'perp');
  assert.equal(E.binanceFeedFor(TIMEFRAMES.find((t) => t.id === '1D'), fallback), 'paxg');
  const store = { perp: {}, paxg: {}, eur: {} };
  for (const t of TIMEFRAMES) store.paxg[t.bn[1]] = makeCandles(300, { stepMs: t.ms, t0: Date.UTC(2026, 0, 1), start: 4100 });
  const r = E.computeTimeframe(tf, store, { ...market, basis: { perp: 99, paxg: 3 } }, E.globalContext(market, 0), Date.UTC(2026, 8, 17), { source: 'binance' });
  assert.equal(r.basis, 3, 'basis mengikuti feed yang benar-benar dipakai');
});
