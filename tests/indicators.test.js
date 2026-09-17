import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as I from '../js/indicators.js';
import { makeCandles, series, near } from './helpers.js';

const ramp = (n, a = 1) => Array.from({ length: n }, (_, i) => a + i);

test('nans, clamp, last', () => {
  assert.equal(I.nans(3).length, 3);
  assert.ok(I.nans(2).every(Number.isNaN));
  assert.equal(I.clamp(5), 1);
  assert.equal(I.clamp(-5), -1);
  assert.equal(I.clamp(0.3), 0.3);
  assert.ok(Number.isNaN(I.clamp(NaN)));
  assert.equal(I.last([1, 2, 3]), 3);
  assert.equal(I.last([1, 2, 3], 1), 2);
});

test('sma pada deret sederhana', () => {
  const r = I.sma([1, 2, 3, 4, 5], 3);
  assert.ok(Number.isNaN(r[1]));
  assert.deepEqual(r.slice(2), [2, 3, 4]);
});

test('ema dan rma dibenih SMA', () => {
  const e = I.ema([1, 2, 3, 4, 5], 3);
  assert.ok(Number.isNaN(e[1]));
  assert.ok(near(e[2], 2) && near(e[3], 3) && near(e[4], 4));
  const r = I.rma([1, 2, 3, 4, 5], 3);
  assert.ok(near(r[3], 4 / 3 + (2 * 2) / 3));
  assert.ok(near(r[4], 5 / 3 + (r[3] * 2) / 3));
  // NaN di depan dilewati, NaN di tengah membawa nilai sebelumnya.
  const e2 = I.ema([NaN, NaN, 1, 2, 3, NaN, 5], 3);
  assert.ok(near(e2[4], 2));
  assert.ok(near(e2[5], 2));
});

test('wma dan hma (hma tanpa lag pada garis lurus)', () => {
  assert.ok(near(I.wma([1, 2, 3], 3)[2], 14 / 6));
  const h = I.hma(ramp(40), 4);
  assert.ok(near(h[39], 40, 1e-9));
});

test('vwma memberi bobot volume', () => {
  const r = I.vwma([10, 20], [1, 3], 2);
  assert.ok(near(r[1], (10 + 60) / 4));
});

test('stdev populasi, highest, lowest', () => {
  assert.ok(near(I.stdev([2, 4, 4, 4, 5, 5, 7, 9], 8)[7], 2));
  assert.deepEqual(I.highest([1, 3, 2, 5], 2).slice(1), [3, 3, 5]);
  assert.deepEqual(I.lowest([4, 3, 5, 1], 2).slice(1), [3, 3, 1]);
});

test('rsi: naik terus 100, turun terus 0, sama dengan Wilder naif', () => {
  assert.equal(I.last(I.rsi(ramp(30))), 100);
  assert.equal(I.last(I.rsi(ramp(30).reverse())), 0);
  const c = series(makeCandles(80, { seed: 3 })).c;
  const n = 14;
  let up = 0;
  let dn = 0;
  for (let i = 1; i <= n; i++) {
    const d = c[i] - c[i - 1];
    up += Math.max(d, 0);
    dn += Math.max(-d, 0);
  }
  up /= n;
  dn /= n;
  for (let i = n + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    up = (up * (n - 1) + Math.max(d, 0)) / n;
    dn = (dn * (n - 1) + Math.max(-d, 0)) / n;
  }
  assert.ok(near(I.last(I.rsi(c, n)), 100 - 100 / (1 + up / dn), 1e-9));
});

test('macd = ema12 − ema26, hist = line − signal', () => {
  const c = series(makeCandles(120, { seed: 4 })).c;
  const m = I.macd(c);
  const line = I.last(I.ema(c, 12)) - I.last(I.ema(c, 26));
  assert.ok(near(I.last(m.line), line));
  assert.ok(near(I.last(m.hist), I.last(m.line) - I.last(m.signal)));
});

test('stoch & stochRsi', () => {
  const h = ramp(20, 2);
  const l = ramp(20, 0);
  const s = I.stoch(h, l, h, 14, 1, 1);
  assert.equal(I.last(s.k), 100);
  const flat = I.stoch([5, 5, 5], [5, 5, 5], [5, 5, 5], 2, 1, 1);
  assert.equal(I.last(flat.k), 50);
  const sr = I.stochRsi(series(makeCandles(80, { seed: 5 })).c);
  const k = I.last(sr.k);
  assert.ok(k >= 0 && k <= 100);
});

test('cci, williamsR, roc, momentum', () => {
  assert.equal(I.last(I.cci([5, 5, 5, 5], [5, 5, 5, 5], [5, 5, 5, 5], 3)), 0);
  assert.equal(I.last(I.williamsR([3, 4], [1, 2], [3, 4], 2)), 0);
  assert.equal(I.last(I.williamsR([3, 4], [1, 2], [1, 1], 2)), -100);
  assert.ok(near(I.last(I.roc([100, 110], 1)), 10));
  assert.equal(I.last(I.momentum([1, 4, 9], 2)), 8);
});

test('trueRange memperhitungkan gap, atr = rma(tr)', () => {
  const tr = I.trueRange([10, 20], [8, 18], [9, 19]);
  assert.equal(tr[0], 2);
  assert.equal(tr[1], 11);
  const k = series(makeCandles(50, { seed: 6 }));
  assert.ok(near(I.last(I.atr(k.h, k.l, k.c, 14)), I.last(I.rma(I.trueRange(k.h, k.l, k.c), 14))));
});

test('dmi pada trend naik: +DI > −DI dan ADX tinggi', () => {
  const h = ramp(60, 11);
  const l = ramp(60, 9);
  const d = I.dmi(h, l, ramp(60, 10));
  assert.ok(I.last(d.plus) > I.last(d.minus));
  assert.ok(I.last(d.adx) > 50);
});

test('aroon: high baru di bar terakhir → up 100', () => {
  const a = I.aroon(ramp(30), ramp(30), 25);
  assert.equal(I.last(a.up), 100);
  assert.equal(I.last(a.down), 0);
});

test('bollinger, keltner, donchian', () => {
  const b = I.bollinger([5, 5, 5, 5], 3, 2);
  assert.equal(I.last(b.percentB), 0.5);
  assert.equal(I.last(b.width), 0);
  const k = series(makeCandles(40, { seed: 7 }));
  const kc = I.keltner(k.h, k.l, k.c, 20, 2);
  assert.ok(near(I.last(kc.upper) - I.last(kc.basis), I.last(kc.basis) - I.last(kc.lower)));
  const dc = I.donchian([3, 5, 4], [1, 2, 0], 3);
  assert.equal(I.last(dc.mid), 2.5);
});

test('ichimoku: tenkan = tengah 9 bar, awan digeser displacement−1', () => {
  const k = series(makeCandles(120, { seed: 8 }));
  const ich = I.ichimoku(k.h, k.l);
  const i = 100;
  const hh = Math.max(...k.h.slice(i - 8, i + 1));
  const ll = Math.min(...k.l.slice(i - 8, i + 1));
  assert.ok(near(ich.tenkan[i], (hh + ll) / 2));
  assert.ok(near(ich.cloudA[i], ich.leadA[i - 25]));
  assert.equal(ich.lag, 25);
});

test('supertrend & psar mengikuti arah trend', () => {
  const up = makeCandles(80, { seed: 9, drift: 3, vol: 0.5 });
  const dn = makeCandles(80, { seed: 9, drift: -3, vol: 0.5 });
  const su = series(up);
  const sd = series(dn);
  assert.equal(I.last(I.supertrend(su.h, su.l, su.c).dir), 1);
  assert.equal(I.last(I.supertrend(sd.h, sd.l, sd.c).dir), -1);
  assert.equal(I.last(I.psar(su.h, su.l).dir), 1);
  assert.equal(I.last(I.psar(sd.h, sd.l).dir), -1);
  assert.equal(I.psar([1], [1]).sar.length, 1);
});

test('obv, mfi, cmf', () => {
  assert.deepEqual(I.obv([1, 2, 1, 1], [10, 5, 3, 7]), [0, 5, 2, 2]);
  const r = ramp(20);
  assert.equal(I.last(I.mfi(r, r, r, r.map(() => 10), 14)), 100);
  assert.equal(I.last(I.cmf([2, 2], [1, 1], [2, 2], [5, 5], 2)), 1);
});

test('vwap ter-anchor + band', () => {
  const t = [0, 1, 2, 3];
  const v = I.vwap(t, [11, 13, 11, 13], [9, 11, 9, 11], [10, 12, 10, 12], [1, 1, 1, 1], (x) => (x < 2 ? 0 : 1));
  assert.ok(near(v.vwap[1], 11));
  assert.ok(near(v.vwap[2], 10));
  assert.ok(near(v.sd[1], 1));
  assert.ok(near(v.upper1[1] - v.vwap[1], 1) && near(v.vwap[1] - v.lower2[1], 2));
  const zero = I.vwap([0], [2], [1], [1.5], [0]);
  assert.ok(near(zero.vwap[0], 1.5));
});

test('adl, chaikinOsc, pvt, forceIndex', () => {
  assert.deepEqual(I.adl([2, 2], [1, 1], [2, 1], [10, 10]), [10, 0]);
  const k = series(makeCandles(60, { seed: 10 }));
  const a = I.adl(k.h, k.l, k.c, k.v);
  assert.ok(near(I.last(I.chaikinOsc(k.h, k.l, k.c, k.v)), I.last(I.ema(a, 3)) - I.last(I.ema(a, 10))));
  assert.ok(near(I.pvt([100, 110], [0, 50])[1], 5));
  const raw = k.c.map((c, i) => (i ? (c - k.c[i - 1]) * k.v[i] : NaN));
  assert.ok(near(I.last(I.forceIndex(k.c, k.v, 13)), I.last(I.ema(raw, 13))));
});

test('easeOfMovement, klinger, volumeIndexes', () => {
  const e = I.easeOfMovement([10, 12], [8, 10], [100, 200], 1, 10000);
  assert.ok(near(e[1], (10000 * 2 * 2) / 200));
  const up = makeCandles(120, { seed: 11, drift: 2, vol: 0.5 });
  const s = series(up);
  const kv = I.klinger(s.h, s.l, s.c, s.v);
  assert.ok(Number.isFinite(I.last(kv.kvo)) && Number.isFinite(I.last(kv.signal)));
  const vi = I.volumeIndexes([100, 110, 121], [10, 5, 20]);
  assert.ok(near(vi.nvi[1], 1100) && near(vi.pvi[1], 1000));
  assert.ok(near(vi.pvi[2], 1100) && near(vi.nvi[2], 1100));
  assert.deepEqual(I.volumeIndexes([], []).nvi, []);
});

test('volumeOsc, relativeVolume, twiggsMoneyFlow', () => {
  assert.equal(I.last(I.volumeOsc(Array(20).fill(50))), 0);
  const v = Array(21).fill(10);
  v[20] = 30;
  assert.ok(near(I.last(I.relativeVolume(v, 20)), 3));
  const n = 30;
  const tw = I.twiggsMoneyFlow(ramp(n, 2), ramp(n, 0), ramp(n, 2), Array(n).fill(1), 5);
  assert.ok(I.last(tw) > 0.5);
});

test('cvd: taker delta asli vs estimasi', () => {
  const exact = I.cvd([1, 1], [2, 2], [0, 0], [2, 2], [10, 10], [7, 8]);
  assert.deepEqual([...exact], [4, 10]);
  assert.equal(exact.exact, true);
  const est = I.cvd([1], [2], [0], [2], [10]);
  assert.equal(est[0], 10);
  assert.equal(est.exact, false);
});

test('volumeProfile: POC di harga bervolume terbesar, value area memuat POC', () => {
  const h = [101, 101, 101, 110];
  const l = [100, 100, 100, 109];
  const vp = I.volumeProfile(h, l, h, [100, 100, 100, 5], 10, 20);
  assert.ok(vp.poc >= 100 && vp.poc <= 101);
  assert.ok(vp.val <= vp.poc && vp.vah >= vp.poc);
  assert.equal(I.volumeProfile([1], [1], [1], [1]), null);
  assert.equal(I.volumeProfile([2, 3], [1, 2], [2, 3], [0, 0]), null);
});

test('awesome, ultimate, linregSlope, heikinAshi, pearson', () => {
  assert.equal(I.last(I.awesome(Array(40).fill(5), Array(40).fill(5))), 0);
  const r = ramp(40);
  assert.ok(near(I.last(I.ultimate(r.map((x) => x + 1), r.map((x) => x - 1), r.map((x) => x + 1))), 100));
  assert.ok(near(I.last(I.linregSlope(r, 20)), 1));
  const ha = I.heikinAshi([10, 12], [14, 15], [9, 11], [12, 14]);
  assert.ok(near(ha.close[0], 11.25) && near(ha.open[0], 11) && near(ha.open[1], (11 + 11.25) / 2));
  assert.ok(near(I.pearson([1, 2, 3], [2, 4, 6]), 1));
  assert.ok(near(I.pearson([1, 2, 3], [3, 2, 1]), -1));
  assert.ok(Number.isNaN(I.pearson([1, 1, 1], [1, 2, 3])));
  assert.ok(Number.isNaN(I.pearson([1], [1])));
});
