import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as AI from '../js/ai.js';
import { computeIndicatorSet } from '../js/signals.js';
import { makeCandles, series, rng, gauss } from './helpers.js';

test('FEATURES sejajar dengan baris matriks fitur', () => {
  const s = series(makeCandles(300, { seed: 31 }));
  const ind = computeIndicatorSet(s);
  const fm = AI.featureMatrix(s, ind, { candles: [], sign: 1 }, true);
  const row = fm.rows.find(Boolean);
  assert.equal(row.length, AI.FEATURES.length);
  assert.equal(fm.rows[0], null);
  assert.ok(fm.rows.at(-1).every(Number.isFinite));
  assert.equal(new Set(AI.FEATURES.map((f) => f[0])).size, AI.FEATURES.length);
  const daily = AI.featureMatrix(s, ind, undefined, false).rows.at(-1);
  assert.equal(daily.at(-1), 0);
  assert.equal(daily.at(-2), 0);
});

test('fxReturns selaras as-of dan menghormati toleransi', () => {
  const times = [0, 60, 120, 180, 240, 300, 360].map((x) => x * 1000);
  const fx = times.map((t, i) => ({ t: t - 5000, c: 100 + i }));
  const r = AI.fxReturns(times, fx, 5, 10_000);
  assert.ok(Number.isNaN(r[4]));
  assert.ok(Math.abs(r[5] - Math.log(105 / 100)) < 1e-12);
  assert.ok(AI.fxReturns(times, fx, 5, 1000).every(Number.isNaN));
});

test('buildDataset tidak memakai bar live dan H bar terakhir', () => {
  const rows = Array.from({ length: 20 }, (_, i) => (i < 2 ? null : [i]));
  const close = Array.from({ length: 20 }, (_, i) => 100 + (i % 3));
  const ds = AI.buildDataset(rows, close, 5);
  assert.equal(ds.idx.at(-1), 20 - 2 - 5);
  assert.equal(ds.idx[0], 2);
  assert.equal(ds.X.length, ds.y.length);
  assert.ok(ds.y.every((v) => v === 0 || v === 1));
});

test('fitScaler, scale (dengan clip), sigmoid', () => {
  const sc = AI.fitScaler([[1, 5], [3, 5]]);
  assert.deepEqual(sc.mean, [2, 5]);
  assert.deepEqual(sc.std, [1, 1]);
  assert.deepEqual(AI.scale([3, 5], sc), [1, 0]);
  assert.equal(AI.scale([100, 5], sc)[0], 5);
  assert.equal(AI.sigmoid(0), 0.5);
  assert.ok(AI.sigmoid(1000) <= 1 && AI.sigmoid(-1000) >= 0);
});

test('solve menyelesaikan sistem linear dan menolak matriks singular', () => {
  const x = AI.solve([[2, 1, -1], [-3, -1, 2], [-2, 1, 2]], [8, -11, -3]);
  [2, 3, -1].forEach((v, i) => assert.ok(Math.abs(x[i] - v) < 1e-9));
  assert.equal(AI.solve([[1, 2], [2, 4]], [1, 2]), null);
});

test('trainLogistic mempelajari aturan yang dapat dipisahkan', () => {
  const rand = rng(7);
  const X = [];
  const y = [];
  for (let i = 0; i < 400; i++) {
    const a = gauss(rand);
    const b = gauss(rand);
    X.push([a, b]);
    y.push(2 * a - b + 0.3 * gauss(rand) > 0 ? 1 : 0);
  }
  const m = AI.trainLogistic(X, y);
  assert.ok(m.w[1] > 0 && m.w[2] < 0);
  const acc = X.filter((x, i) => (AI.predictLogistic(m, x) > 0.5 ? 1 : 0) === y[i]).length / X.length;
  assert.ok(acc > 0.9, `akurasi ${acc}`);
});

test('knnPredict, brier, metrics, reliability', () => {
  const Xs = [[0], [0.1], [5], [5.1]];
  const y = [1, 1, 0, 0];
  const fwd = [0.01, 0.02, -0.01, -0.02];
  const k = AI.knnPredict(Xs, y, fwd, [0.05], 2);
  assert.ok(k.p > 0.6);
  assert.ok(k.avgFwd > 0);
  assert.deepEqual(k.neighbors.sort(), [0, 1]);
  assert.equal(AI.brier([1, 0], [1, 0]), 0);
  const m = AI.metrics([0.9, 0.8, 0.2, 0.55], [1, 1, 0, 0], 0.5);
  assert.equal(m.accuracy, 0.75);
  assert.equal(m.confN, 3);
  assert.equal(m.confAccuracy, 1);
  assert.ok(m.bss > 0);
  assert.equal(AI.metrics([], [], 0.5), null);
  assert.equal(AI.reliability(null), 0);
  assert.equal(AI.reliability({ n: 10, bss: 1, accuracy: 1, majority: 0.5 }), 0);
  assert.equal(AI.reliability({ n: 100, bss: 0.03, accuracy: 0.5, majority: 0.5 }), 1);
  assert.equal(AI.reliability({ n: 100, bss: -0.1, accuracy: 0.45, majority: 0.55 }), 0);
});

test('trainModel: menemukan skill pada data berpola, tidak mengarang skill pada random walk', () => {
  // Return berautokorelasi kuat → arah 5 bar ke depan bisa diprediksi dari momentum.
  const trending = series(makeCandles(1500, { seed: 41, phi: 0.8, vol: 1 }));
  const indT = computeIndicatorSet(trending);
  const mT = AI.trainModel(AI.featureMatrix(trending, indT).rows, trending.c);
  assert.ok(!mT.error);
  assert.ok(mT.oos.ensemble.accuracy > 0.6, `akurasi berpola ${mT.oos.ensemble.accuracy}`);
  assert.ok(mT.reliability > 0.5);
  assert.ok(Math.abs(mT.mix.logit + mT.mix.knn - 1) < 1e-9);

  const walk = series(makeCandles(1500, { seed: 42, phi: 0, vol: 1 }));
  const indW = computeIndicatorSet(walk);
  const mW = AI.trainModel(AI.featureMatrix(walk, indW).rows, walk.c);
  assert.ok(mW.oos.ensemble.accuracy < 0.58, `akurasi random walk ${mW.oos.ensemble.accuracy}`);
  assert.ok(mW.reliability < mT.reliability);

  const small = AI.trainModel(AI.featureMatrix(trending, indT).rows.slice(0, 100), trending.c.slice(0, 100));
  assert.match(small.error, /sampel/);
});

test('predict: probabilitas, kontribusi fitur, analog', () => {
  const s = series(makeCandles(1200, { seed: 43, phi: 0.6, vol: 1 }));
  const ind = computeIndicatorSet(s);
  const fm = AI.featureMatrix(s, ind);
  const model = AI.trainModel(fm.rows, s.c);
  const p = AI.predict(model, fm.rows.at(-1), s.t);
  assert.ok(p.p > 0 && p.p < 1);
  assert.ok(p.vote >= -1 && p.vote <= 1);
  assert.equal(p.contributions.length, 6);
  assert.equal(p.importance.length, 8);
  assert.equal(p.analogs.length, 5);
  assert.ok(p.analogs.every((a) => Number.isFinite(a.t)));
  assert.ok(p.analogUpShare >= 0 && p.analogUpShare <= 1);
  assert.equal(AI.predict(null, fm.rows.at(-1)), null);
  assert.equal(AI.predict({ error: 'x' }, fm.rows.at(-1)), null);
  assert.equal(AI.predict(model, null), null);
  assert.equal(AI.HORIZON_BARS, 5);
  assert.equal(AI.MIN_SAMPLES, 150);
});
