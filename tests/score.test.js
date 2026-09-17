import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../js/score.js';
import { TIMEFRAMES } from '../js/candles.js';

test('label ambang putusan', () => {
  assert.equal(S.label(40).text, 'STRONG BULL');
  assert.equal(S.label(15).text, 'BULL');
  assert.equal(S.label(0).text, 'NETRAL');
  assert.equal(S.label(-20).text, 'BEAR');
  assert.equal(S.label(-40).text, 'STRONG BEAR');
  assert.equal(S.label(NaN).tone, 'na');
});

test('CONTEXT_WEIGHTS total 1', () => {
  assert.ok(Math.abs(Object.values(S.CONTEXT_WEIGHTS).reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

test('technicalScore: rata-rata tertimbang per kategori, sinyal null dikeluarkan', () => {
  const sigs = [
    { cat: 'trend', weight: 1, vote: 1 },
    { cat: 'trend', weight: 3, vote: -1 },
    { cat: 'momentum', weight: 1, vote: 0.5 },
    { cat: 'pattern', weight: 1, vote: null },
  ];
  const t = S.technicalScore(sigs);
  assert.equal(t.cats.trend.score, -50);
  assert.equal(t.cats.momentum.score, 50);
  assert.equal(t.cats.pattern.score, null);
  const expected = (0.27 * -50 + 0.18 * 50) / (0.27 + 0.18);
  assert.ok(Math.abs(t.score - expected) < 1e-9);
  assert.equal(t.coverage, 0.75);
  assert.equal(t.bulls, 2);
  assert.equal(t.bears, 1);
  assert.ok(Math.abs(t.agreement - Math.abs(1 - 3 + 0.5) / 4.5) < 1e-9);
  assert.equal(S.technicalScore([]).score, null);
});

test('finalScore: bobot AI diskalakan reliabilitas, AI tak andal tidak ikut', () => {
  const tech = { score: 50, agreement: 1, coverage: 1 };
  const noAi = S.finalScore(tech, { ai: -1, aiReliability: 0 });
  assert.equal(noAi.score, 50);
  assert.equal(noAi.components.ai, undefined);
  const withAi = S.finalScore(tech, { ai: -1, aiReliability: 1 });
  assert.ok(Math.abs(withAi.score - (100 * (0.45 * 0.5 - 0.25)) / 0.7) < 1e-9);
  const half = S.finalScore(tech, { ai: -1, aiReliability: 0.5 });
  assert.ok(Math.abs(half.components.ai.weight - 0.125 / 0.575) < 1e-9);
  const full = S.finalScore(tech, { ai: 0.5, aiReliability: 1, dxy: -0.5, rates: 0.2, macro: 0, sentiment: 1 });
  assert.ok(Math.abs(Object.values(full.components).reduce((a, c) => a + c.weight, 0) - 1) < 1e-9);
  assert.ok(full.confidence > 0 && full.confidence <= 99);
  assert.equal(S.finalScore({ score: null, agreement: 0, coverage: 0 }, {}).score, null);
  const risky = S.finalScore(tech, {}, 0.5);
  assert.ok(risky.confidence < S.finalScore(tech, {}, 1).confidence);
});

test('topReasons diurutkan dari dampak terbesar', () => {
  const r = S.topReasons([
    { id: 'a', weight: 1, vote: 0.2 },
    { id: 'b', weight: 2, vote: -0.9 },
    { id: 'c', weight: 1, vote: null },
    { id: 'd', weight: 1, vote: 0.01 },
  ], 2);
  assert.deepEqual(r.map((x) => x.id), ['b', 'a']);
});

test('aggregate: rata-rata tertimbang timeframe, horizon, probabilitas AI', () => {
  const results = {};
  for (const tf of TIMEFRAMES) {
    results[tf.id] = { final: { score: tf.horizon === 'scalp' ? 60 : -30, confidence: 50 }, ai: { p: 0.6, reliability: 1 } };
  }
  const agg = S.aggregate(results);
  const scalp = agg.horizons.find((h) => h.id === 'scalp');
  assert.ok(Math.abs(scalp.score - 60) < 1e-9);
  assert.equal(scalp.name, 'Scalping');
  assert.ok(Math.abs(agg.overall.aiProb - 0.6) < 1e-9);
  assert.equal(agg.overall.bullTfs, 4);
  assert.equal(agg.overall.bearTfs, 11);
  const empty = S.aggregate({});
  assert.equal(empty.overall.score, null);
  assert.equal(empty.overall.aiProb, null);
});
