import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../js/tvfeed.js';

test('konstanta', () => {
  assert.equal(T.BROKERS.PEPPERSTONE, 'PEPPERSTONE:XAUUSD');
  assert.equal(T.BROKERS.OANDA, 'OANDA:XAUUSD');
  assert.match(T.TV_WS_URL, /^wss:\/\/data\.tradingview\.com\//);
  assert.ok(T.QUOTE_FIELDS.includes('bid') && T.QUOTE_FIELDS.includes('ask'));
});

test('encodeFrame ↔ decodeFrames, termasuk beberapa frame dan heartbeat', () => {
  const a = T.encodeFrame('quote_add_symbols', ['qs', 'PEPPERSTONE:XAUUSD']);
  const b = T.encodeFrame('x', [1]);
  const frames = T.decodeFrames(`${a}${b}~m~4~m~~h~7`);
  assert.equal(frames.length, 3);
  assert.deepEqual(JSON.parse(frames[0]), { m: 'quote_add_symbols', p: ['qs', 'PEPPERSTONE:XAUUSD'] });
  assert.equal(frames[2], '~h~7');
  assert.deepEqual(T.decodeFrames('rusak'), []);
  assert.deepEqual(T.decodeFrames('~m~abc~m~x'), []);
  // Karakter multibita: panjang dihitung per karakter JS, sama seperti server.
  const u = T.encodeFrame('m', ['emas ≈ ✓']);
  assert.equal(JSON.parse(T.decodeFrames(u)[0]).p[0], 'emas ≈ ✓');
});

test('barEnd per resolusi', () => {
  const t = Date.UTC(2026, 0, 31, 0);
  assert.equal(T.barEnd(t, '15'), t + 15 * 60_000 - 1);
  assert.equal(T.barEnd(t, '1D'), t + 86_400_000 - 1);
  assert.equal(T.barEnd(t, '1W'), t + 7 * 86_400_000 - 1);
  assert.equal(T.barEnd(Date.UTC(2026, 0, 1), '1M'), Date.UTC(2026, 1, 1) - 1);
});

test('parseBars & mergeBars', () => {
  const bars = T.parseBars([{ i: 1, v: [120, 2, 3, 1, 2.5, 7] }, { i: 0, v: [60, 1, 2, 0.5, 1.5] }, { v: [1, 'x', 1, 1, 1] }, { v: [180, 1, 0, 2, 1, 1] }], '1');
  assert.deepEqual(bars.map((b) => b.t), [60_000, 120_000]);
  assert.equal(bars[0].v, 0);
  assert.ok(Number.isNaN(bars[0].tb));
  const merged = T.mergeBars(bars, [{ t: 120_000, c: 9 }, { t: 180_000, c: 10 }], 2);
  assert.deepEqual(merged.map((b) => b.c), [9, 10]);
  assert.equal(T.mergeBars([], [{ t: 1 }, { t: 2 }], 1).length, 1);
});

test('interpret: timescale_update, du, qsd, error, lainnya', () => {
  const res = { cs_gold_15: '15' };
  const ts = T.interpret(JSON.stringify({ m: 'timescale_update', p: ['cs_gold_15', { s1: { s: [{ i: 0, v: [900, 1, 2, 0, 1, 5] }] } }] }), res);
  assert.equal(ts.kind, 'bars');
  assert.equal(ts.full, true);
  assert.equal(ts.bars[0].closeT, 900_000 + 15 * 60_000 - 1);
  const du = T.interpret(JSON.stringify({ m: 'du', p: ['cs_gold_15', { s1: { s: [{ i: 0, v: [900, 1, 2, 0, 1.2, 6] }] } }] }), res);
  assert.equal(du.full, false);
  const q = T.interpret(JSON.stringify({ m: 'qsd', p: ['qs', { n: 'OANDA:XAUUSD', s: 'ok', v: { lp: 4270 } }] }), res);
  assert.deepEqual(q, { kind: 'quote', symbol: 'OANDA:XAUUSD', values: { lp: 4270 } });
  assert.equal(T.interpret(JSON.stringify({ m: 'qsd', p: ['qs', { n: 'X', s: 'error' }] }), res), null);
  const err = T.interpret(JSON.stringify({ m: 'series_error', p: ['cs_gold_2', 's1', 'custom_resolution'] }), res);
  assert.equal(err.kind, 'error');
  assert.equal(T.interpret('bukan json', res), null);
  assert.equal(T.interpret(JSON.stringify({ m: 'series_loading', p: [] }), res), null);
  assert.equal(T.interpret(JSON.stringify({ m: 'du', p: ['cs', {}] }), res), null);
});

class FakeSocket {
  constructor() { this.sent = []; this.readyState = 0; }
  send(x) { this.sent.push(x); }
  open() { this.readyState = 1; this.onopen(); }
  close() { this.readyState = 3; this.onclose?.(); }
}

test('TvFeed: berlangganan saat terbuka, membalas heartbeat, meneruskan bar & quote', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const sockets = [];
  const bars = [];
  const quotes = [];
  const feed = new T.TvFeed({
    series: [{ key: 'gold_15', symbol: 'PEPPERSTONE:XAUUSD', res: '15', count: 10 }],
    quotes: ['PEPPERSTONE:XAUUSD'],
    socket: () => { const s = new FakeSocket(); sockets.push(s); return s; },
    onBars: (key, b, full) => bars.push([key, b.length, full]),
    onQuote: (sym, v) => quotes.push([sym, v.lp]),
  });
  const s = sockets[0];
  s.open();
  const methods = s.sent.map((x) => JSON.parse(T.decodeFrames(x)[0]).m);
  assert.deepEqual(methods, ['set_auth_token', 'quote_create_session', 'quote_set_fields', 'quote_add_symbols', 'chart_create_session', 'resolve_symbol', 'create_series']);
  s.onmessage({ data: '~m~4~m~~h~3' });
  assert.equal(s.sent.at(-1), '~m~4~m~~h~3');
  s.onmessage({ data: T.encodeFrame('timescale_update', ['cs_gold_15', { s1: { s: [{ i: 0, v: [900, 1, 2, 0, 1, 5] }] } }]) + T.encodeFrame('qsd', ['qs_main', { n: 'PEPPERSTONE:XAUUSD', s: 'ok', v: { lp: 4300 } }]) });
  assert.deepEqual(bars, [['gold_15', 1, true]]);
  assert.deepEqual(quotes, [['PEPPERSTONE:XAUUSD', 4300]]);
  feed.stop();
  assert.equal(feed.closed, true);
});

test('TvFeed: berhenti setelah maxFailures penolakan (origin tidak diizinkan)', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const sockets = [];
  const states = [];
  const feed = new T.TvFeed({
    series: [], quotes: [], maxFailures: 2,
    socket: () => { const s = new FakeSocket(); sockets.push(s); return s; },
    onStatus: (st) => states.push(st.state),
  });
  sockets[0].close();
  t.mock.timers.tick(1000);
  sockets[1].close();
  t.mock.timers.tick(60_000);
  assert.equal(sockets.length, 2);
  assert.ok(states.includes('rejected'));
  assert.equal(feed.closed, true);
});
