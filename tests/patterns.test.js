import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../js/patterns.js';

// Zigzag naik: lembah & puncak makin tinggi.
function zigzag(up = true) {
  const pts = up ? [10, 20, 14, 26, 18, 32, 22] : [32, 22, 28, 16, 24, 10, 18];
  const h = [];
  const l = [];
  for (let k = 0; k < pts.length - 1; k++) {
    for (let s = 0; s < 5; s++) {
      const p = pts[k] + ((pts[k + 1] - pts[k]) * s) / 5;
      h.push(p + 0.5);
      l.push(p - 0.5);
    }
  }
  return { h, l };
}

test('swings menemukan puncak & lembah terkonfirmasi', () => {
  const { h, l } = zigzag(true);
  const sw = P.swings(h, l, 3, 3);
  assert.ok(sw.highs.length >= 2 && sw.lows.length >= 2);
  assert.ok(sw.highs.every((x) => h[x.i] === x.price));
});

test('marketStructure: HH+HL naik, LH+LL turun, data kurang netral', () => {
  const up = zigzag(true);
  assert.equal(P.marketStructure(P.swings(up.h, up.l)).trend, 1);
  const dn = zigzag(false);
  assert.equal(P.marketStructure(P.swings(dn.h, dn.l)).trend, -1);
  assert.equal(P.marketStructure({ highs: [], lows: [] }).trend, 0);
  const mixed = { highs: [{ i: 1, price: 10 }, { i: 5, price: 12 }], lows: [{ i: 3, price: 5 }, { i: 7, price: 4 }] };
  assert.equal(P.marketStructure(mixed).trend, 0);
});

test('breakOfStructure', () => {
  const sw = { highs: [{ i: 1, price: 10 }], lows: [{ i: 2, price: 5 }] };
  assert.equal(P.breakOfStructure(11, sw).dir, 1);
  assert.equal(P.breakOfStructure(4, sw).dir, -1);
  assert.equal(P.breakOfStructure(7, sw).dir, 0);
  assert.equal(P.breakOfStructure(7, { highs: [], lows: [] }).dir, 0);
});

test('candlePatterns: engulfing, hammer, doji, morning star, three soldiers', () => {
  const names = (o, h, l, c, i, atr, tr) => P.candlePatterns(o, h, l, c, i, atr, tr).map((p) => p.name);
  // Bullish engulfing
  assert.ok(names([10, 12, 11.8, 11.2], [11, 12.2, 12, 12.6], [9.8, 11.6, 11.2, 11.1], [10.5, 11.9, 11.3, 12.4], 3, 1, 0).includes('Bullish Engulfing'));
  // Bearish engulfing
  assert.ok(names([10, 10, 11.3, 12.4], [11, 11, 12, 12.6], [9, 9, 11.2, 11.1], [10, 10, 11.9, 11.2], 3, 1, 0).includes('Bearish Engulfing'));
  // Hammer (konteks turun)
  assert.ok(names([10, 10, 10, 10], [10.1, 10.1, 10.1, 10.25], [9.9, 9.9, 9.9, 8.5], [10, 10, 10, 10.2], 3, 1, -1).includes('Hammer'));
  // Doji
  assert.ok(names([10, 10, 10, 10], [11, 11, 11, 11], [9, 9, 9, 9], [10.2, 10.3, 10.1, 10.05], 3, 1, 0).includes('Doji'));
  // Morning star
  assert.ok(names([13, 13, 10.1, 10.1], [13.1, 13.1, 10.3, 12.6], [12.9, 9.9, 9.8, 10], [13, 10, 10.0, 12.5], 3, 1, -1).includes('Morning Star'));
  // Three white soldiers
  assert.ok(names([9, 10, 11, 12], [9.5, 11.1, 12.1, 13.1], [8.9, 9.9, 10.9, 11.9], [9.2, 11, 12, 13], 3, 1, 0).includes('Three White Soldiers'));
  // Three black crows
  assert.ok(names([14, 13, 12, 11], [14.1, 13.1, 12.1, 11.1], [13.9, 11.9, 10.9, 9.9], [14, 12, 11, 10], 3, 1, 0).includes('Three Black Crows'));
  // Tanpa ATR valid / indeks terlalu kecil → kosong
  assert.deepEqual(P.candlePatterns([1, 2, 3], [1, 2, 3], [1, 2, 3], [1, 2, 3], 2, NaN), []);
  assert.deepEqual(P.candlePatterns([1, 2, 3], [1, 2, 3], [1, 2, 3], [1, 2, 3], 1, 1), []);
});

test('divergence reguler & tersembunyi', () => {
  const sw = { highs: [{ i: 2, price: 10 }, { i: 8, price: 12 }], lows: [{ i: 4, price: 5 }, { i: 10, price: 4 }] };
  const osc = [];
  osc[2] = 70; osc[8] = 60; osc[4] = 30; osc[10] = 40;
  const d = P.divergence(sw, osc);
  assert.ok(d.some((x) => x.dir === -1));
  assert.ok(d.some((x) => x.dir === 1));
  const hidden = P.divergence({ highs: [{ i: 1, price: 12 }, { i: 3, price: 10 }], lows: [] }, [0, 50, 0, 60]);
  assert.ok(hidden.some((x) => x.dir === -0.5));
});

test('doublePattern: double top tembus neckline', () => {
  const sw = { highs: [{ i: 1, price: 100 }, { i: 5, price: 100.2 }], lows: [] };
  const low = [95, 99, 96, 94, 96, 99, 97];
  const high = low.map((x) => x + 1);
  assert.equal(P.doublePattern(sw, low, high, 93, 1).dir, -1);
  assert.equal(P.doublePattern(sw, low, high, 97, 1), null);
  const bot = { highs: [], lows: [{ i: 1, price: 50 }, { i: 5, price: 50.1 }] };
  const h2 = [55, 51, 56, 58, 54, 51, 53];
  assert.equal(P.doublePattern(bot, h2.map((x) => x - 1), h2, 59, 1).dir, 1);
  assert.equal(P.doublePattern(sw, low, high, 93, NaN), null);
});

test('pivotPoints klasik, fibonacci, camarilla', () => {
  const pv = P.pivotPoints(110, 90, 100);
  assert.equal(pv.classic.p, 100);
  assert.equal(pv.classic.r1, 110);
  assert.equal(pv.classic.s1, 90);
  assert.ok(Math.abs(pv.fibonacci.r1 - 107.64) < 1e-9);
  assert.ok(Math.abs(pv.camarilla.r3 - (100 + 5.5)) < 1e-9);
});

test('fibPosition & nearestLevels', () => {
  const sw = { highs: [{ i: 5, price: 200 }], lows: [{ i: 1, price: 100 }] };
  const f = P.fibPosition(sw, 150);
  assert.equal(f.legUp, true);
  assert.equal(f.retr, 0.5);
  assert.equal(P.fibPosition({ highs: [], lows: [] }, 1), null);
  const lv = P.nearestLevels({ highs: [{ price: 120 }, { price: 130 }], lows: [{ price: 90 }, { price: 80 }] }, 100);
  assert.equal(lv.resistance, 120);
  assert.equal(lv.support, 90);
  assert.ok(Number.isNaN(P.nearestLevels({ highs: [], lows: [] }, 1).support));
});
