import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../js/signals.js';
import { technicalScore } from '../js/score.js';
import { makeCandles, series } from './helpers.js';

test('CATEGORIES berbobot total 1', () => {
  const sum = Object.values(G.CATEGORIES).reduce((a, c) => a + c.weight, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
});

test('oscVote, tvConsensus, tvLabel', () => {
  assert.equal(G.oscVote(70, 50, 20), 1);
  assert.equal(G.oscVote(40, 50, 20), -0.5);
  assert.equal(G.oscVote(NaN, 50, 20), null);
  assert.equal(G.tvConsensus({ 5: 0.4, 15: 0.2 }, ['5', '15']), 0.30000000000000004);
  assert.equal(G.tvConsensus(null, ['5']), null);
  assert.equal(G.tvConsensus({}, ['5']), null);
  assert.equal(G.tvLabel(0.6), 'Strong Buy');
  assert.equal(G.tvLabel(0.2), 'Buy');
  assert.equal(G.tvLabel(0), 'Neutral');
  assert.equal(G.tvLabel(-0.2), 'Sell');
  assert.equal(G.tvLabel(-0.7), 'Strong Sell');
  assert.equal(G.tvLabel(NaN), 'n/a');
});

test('normSlope & zLast', () => {
  const up = Array.from({ length: 30 }, (_, i) => i);
  assert.ok(G.normSlope(up).at(-1) > 0.9);
  assert.equal(G.normSlope(Array(30).fill(3)).at(-1), 0);
  assert.equal(G.zLast([1, 2, NaN]), null);
  assert.ok(G.zLast(Array.from({ length: 60 }, (_, i) => (i % 2 ? 1 : -1))) !== null);
});

test('computeVolumeSet & computeIndicatorSet menghasilkan seri sepanjang data', () => {
  const s = series(makeCandles(300, { seed: 21 }));
  const vs = G.computeVolumeSet(s);
  for (const key of ['obv', 'adl', 'chaikin', 'cmf', 'twiggs', 'mfi', 'force', 'eom', 'nvi', 'pvi', 'volOsc', 'rvol', 'cvd', 'taker']) {
    assert.equal(vs[key].length, 300, key);
  }
  assert.equal(vs.cvdExact, true);
  const ind = G.computeIndicatorSet(s, { anchor: { key: (t) => Math.floor(t / 86_400_000) } });
  for (const key of ['atr', 'ema200', 'sma200', 'hma9', 'hma21', 'rsi']) assert.equal(ind[key].length, 300, key);
  assert.ok(ind.profile && Number.isFinite(ind.profile.poc));
  assert.equal(ind.vwap.vwap.length, 300);
});

test('evaluate: trend naik → trend & momentum bull, semua vote dalam [-1, 1]', () => {
  const s = series(makeCandles(400, { seed: 22, drift: 1.5, vol: 1 }));
  const ev = G.evaluate(s, { intraday: true, pivotSource: { h: 4100, l: 3900, c: 4000 }, tvRatings: { 15: 0.5 }, tvKeys: ['15'], anchorLabel: 'Sesi' });
  const ids = ev.signals.map((x) => x.id);
  for (const id of ['ema_stack', 'sma_stack', 'sma_cross', 'hull', 'hull_turn', 'vwap', 'vwap_slope', 'vwma', 'vprofile', 'obv', 'adl', 'chaikin', 'cmf', 'twiggs', 'mfi', 'pvt', 'force', 'eom', 'klinger', 'nvi_pvi', 'volosc', 'rvol', 'cvd', 'taker', 'pivot', 'tradingview', 'candles', 'divergence', 'double', 'fib', 'structure', 'bos']) {
    assert.ok(ids.includes(id), `sinyal ${id} ada`);
  }
  for (const x of ev.signals) assert.ok(x.vote === null || (x.vote >= -1 && x.vote <= 1), x.id);
  const tech = technicalScore(ev.signals);
  assert.ok(tech.cats.trend.score > 30);
  assert.ok(tech.cats.momentum.score > 0);
  assert.equal(ev.signals.find((x) => x.id === 'tradingview').vote, 0.5);
  assert.ok(Number.isFinite(ev.levels.vwap) && Number.isFinite(ev.levels.poc));
});

test('evaluate: trend turun → skor teknikal negatif', () => {
  const s = series(makeCandles(400, { seed: 23, drift: -1.5, vol: 1 }));
  const tech = technicalScore(G.evaluate(s, { intraday: false }).signals);
  assert.ok(tech.score < -20);
});

test('evaluate: flow Binance menggantikan tick volume, data < 30 bar kosong', () => {
  const s = series(makeCandles(300, { seed: 24, withTaker: false }));
  const flowS = series(makeCandles(300, { seed: 25 }));
  const ev = G.evaluate(s, { flow: { series: flowS, set: G.computeVolumeSet(flowS), label: 'volume asli Binance' } });
  assert.ok(ev.signals.find((x) => x.id === 'obv').detail.includes('volume asli Binance'));
  assert.equal(ev.signals.find((x) => x.id === 'cvd').name, 'CVD (taker delta asli)');
  const noFlow = G.evaluate(s, {});
  assert.equal(noFlow.signals.find((x) => x.id === 'cvd').name, 'CVD (estimasi)');
  assert.equal(noFlow.signals.some((x) => x.id === 'taker'), false);
  assert.deepEqual(G.evaluate(series(makeCandles(10)), {}).signals, []);
});
