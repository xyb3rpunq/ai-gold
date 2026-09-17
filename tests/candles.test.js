import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../js/candles.js';

test('TIMEFRAMES: 15 timeframe 1m–1M berurutan dan konsisten', () => {
  const ids = C.TIMEFRAMES.map((t) => t.id);
  assert.deepEqual(ids, ['1m', '2m', '3m', '5m', '10m', '15m', '30m', '45m', '1H', '2H', '3H', '4H', '1D', '1W', '1M']);
  for (let i = 1; i < C.TIMEFRAMES.length; i++) assert.ok(C.TIMEFRAMES[i].ms > C.TIMEFRAMES[i - 1].ms);
  const horizons = C.HORIZONS.map((h) => h.id);
  for (const tf of C.TIMEFRAMES) {
    assert.ok(horizons.includes(tf.horizon));
    assert.ok(tf.weight > 0);
    assert.equal(tf.bn.length, 3);
    // 2m dan 10m wajib dirakit (TradingView tanpa login menolak resolusi itu).
    if (tf.id === '2m' || tf.id === '10m') assert.equal(tf.factor, 2);
  }
});

test('tvResolutions & baseStreams unik', () => {
  const res = C.tvResolutions();
  assert.ok(!res.includes('2') && !res.includes('10'));
  assert.equal(new Set(res).size, res.length);
  const bs = C.baseStreams();
  assert.ok(bs.perp.includes('1m') && bs.paxg.includes('1M'));
  assert.equal(new Set(bs.perp).size, bs.perp.length);
});

test('parseKline & parseWsKline', () => {
  const k = C.parseKline([1000, '1', '3', '0.5', '2', '10', 1999, '0', 5, '6']);
  assert.deepEqual(k, { t: 1000, o: 1, h: 3, l: 0.5, c: 2, v: 10, tb: 6, closeT: 1999 });
  const w = C.parseWsKline({ k: { t: 1, o: '1', h: '2', l: '0', c: '1.5', v: '4', V: '3', T: 59, x: true, i: '1m' } });
  assert.equal(w.interval, '1m');
  assert.equal(w.tb, 3);
  assert.equal(w.closed, true);
});

test('aggregate 1m → 2m sejajar epoch', () => {
  const bars = [0, 1, 2, 3].map((i) => ({ t: i * 60_000, o: i, h: i + 1, l: i - 1, c: i + 0.5, v: 1, tb: 0.5 }));
  const a = C.aggregate(bars, 120_000);
  assert.equal(a.length, 2);
  assert.deepEqual([a[0].o, a[0].h, a[0].l, a[0].c, a[0].v, a[0].tb], [0, 2, -1, 1.5, 2, 1]);
  assert.equal(a[1].closeT, 240_000 - 1);
});

test('upsert: tambah, timpa, perbarui bar lama, potong panjang', () => {
  const arr = [{ t: 1, c: 1 }, { t: 2, c: 2 }];
  C.upsert(arr, { t: 2, c: 5 });
  assert.equal(arr[1].c, 5);
  C.upsert(arr, { t: 3, c: 3 }, 2);
  assert.deepEqual(arr.map((x) => x.t), [2, 3]);
  C.upsert(arr, { t: 2, c: 9 });
  assert.equal(arr[0].c, 9);
  C.upsert(arr, { t: 0, c: 0 });
  assert.equal(arr.length, 2);
  assert.deepEqual(C.upsert([], { t: 1 }), [{ t: 1 }]);
});

test('toSeries', () => {
  const s = C.toSeries([{ t: 1, o: 2, h: 3, l: 1, c: 2.5, v: 9, tb: 4 }]);
  assert.deepEqual(s, { t: [1], o: [2], h: [3], l: [1], c: [2.5], v: [9], tb: [4] });
});

test('asofCloses & alignedReturns mencocokkan bar dengan jam buka berbeda', () => {
  const H = 3_600_000;
  const gold = [0, 1, 2, 3].map((i) => ({ t: i * H + 3 * 60_000, c: 100 + i }));
  const dxy = [0, 1, 2, 3].map((i) => ({ t: i * H, c: 50 - i }));
  assert.deepEqual(C.asofCloses(gold, dxy), [50, 49, 48, 47]);
  assert.ok(C.asofCloses(gold, dxy, 60_000).every(Number.isNaN));
  assert.ok(C.asofCloses([{ t: 5 }], []).every(Number.isNaN));
  const r = C.alignedReturns(gold, dxy, 100, H);
  assert.equal(r.a.length, 3);
  assert.ok(r.a[0] > 0 && r.b[0] < 0);
  assert.equal(C.alignedReturns(gold, dxy, 2).a.length, 2);
});

test('lastClosed & lastClosedYear', () => {
  const bars = [{ t: 0, closeT: 99, c: 1 }, { t: 100, closeT: 199, c: 2 }];
  assert.equal(C.lastClosed(bars, 150).c, 1);
  assert.equal(C.lastClosed(bars, 50), null);
  const now = Date.UTC(2026, 5, 1);
  const monthly = [0, 1, 2].map((m) => ({ t: Date.UTC(2025, m, 1), h: 10 + m, l: 5 - m, c: 7 + m }))
    .concat([{ t: Date.UTC(2026, 0, 1), h: 99, l: 1, c: 50 }]);
  assert.deepEqual(C.lastClosedYear(monthly, now), { h: 12, l: 3, c: 9 });
  assert.equal(C.lastClosedYear([], now), null);
});

test('konstanta waktu', () => {
  assert.equal(C.MIN, 60_000);
  assert.equal(C.HOUR, 3_600_000);
  assert.equal(C.DAY, 86_400_000);
});
