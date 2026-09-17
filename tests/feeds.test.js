import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../js/feeds.js';

test('konstanta & URL', () => {
  assert.equal(F.PERP_SYMBOL, 'XAUUSDT');
  assert.equal(F.PAXG_SYMBOL, 'PAXGUSDT');
  assert.equal(F.EUR_SYMBOL, 'EURUSDT');
  assert.equal(F.TV_TFS.length, 10);
  assert.ok(F.SCANNER_TICKERS.pepperstone === 'PEPPERSTONE:XAUUSD');
  assert.match(F.NEWS_URL, /raw\.githubusercontent\.com\/xyb3rpunq\/ai-gold\/data\/news\.json$/);
  assert.match(F.COT_URL, /088691/);
  assert.match(F.klineUrl('perp', '1m'), /fapi\.binance\.com.*limit=1000$/);
  assert.match(F.klineUrl('paxg', '1d'), /api\.binance\.com.*PAXGUSDT.*limit=1000$/);
  assert.match(F.klineUrl('eur', '5m', 50), /EURUSDT.*limit=50$/);
});

test('wsUrl memakai endpoint /market/stream untuk futures + aggTrade', () => {
  const u = F.wsUrl('perp', ['1m', '5m']);
  assert.equal(u, 'wss://fstream.binance.com/market/stream?streams=xauusdt@aggTrade/xauusdt@kline_1m/xauusdt@kline_5m');
  assert.equal(F.wsUrl('paxg', ['1d']), 'wss://stream.binance.com:9443/stream?streams=paxgusdt@kline_1d');
});

test('ratingColumns, scannerRequest, parseScanner', () => {
  const cols = F.ratingColumns();
  assert.equal(cols[7], 'Recommend.All');
  assert.equal(cols[0], 'Recommend.All|1');
  const req = F.scannerRequest(['ECONOMICS:USINTR']);
  assert.ok(req.symbols.tickers.includes('ECONOMICS:USINTR'));
  assert.deepEqual(req.columns.slice(0, 5), ['close', 'change', 'update_mode', 'bid', 'ask']);
  const ratings = F.TV_TFS.map((_, i) => (i === 7 ? -0.5 : null));
  const json = { data: [
    { s: 'OANDA:XAUUSD', d: [4270, -0.5, 'streaming', 4269.9, 4270.4, ...ratings] },
    { s: 'PEPPERSTONE:XAUUSD', d: [4271, -0.4, 'streaming', 4270.8, 4271.0, ...ratings] },
    { s: 'TVC:DXY', d: [100.2, 0.6, 'streaming', null, null, ...ratings] },
    { s: 'OANDA:EURUSD', d: [1.147, -0.6, 'streaming', null, null, ...ratings] },
    { s: 'ECONOMICS:USINTR', d: [4, 6.6, 'streaming', null, null, ...ratings] },
  ] };
  const sc = F.parseScanner(json);
  assert.equal(sc.gold.close, 4270);
  assert.equal(sc.gold.ratings[''], -0.5);
  assert.equal(sc.brokers.PEPPERSTONE.bid, 4270.8);
  assert.equal(sc.fx.EURUSD, 1.147);
  assert.equal(sc.econ['ECONOMICS:USINTR'], 4);
  assert.equal(F.parseScanner(null).gold, null);
});

test('brokerRef: mid bid/ask, jatuh ke close', () => {
  assert.equal(F.brokerRef({ bid: 10, ask: 12, close: 5 }), 11);
  assert.equal(F.brokerRef({ bid: 12, ask: 10, close: 5 }), 5);
  assert.ok(Number.isNaN(F.brokerRef(null)));
  assert.ok(Number.isNaN(F.brokerRef({})));
});

test('parseCot, parseKlines, parseStreamMessage', () => {
  const cot = F.parseCot([{ report_date_as_yyyy_mm_dd: '2026-09-08T00:00:00.000', m_money_positions_long_all: '145804', m_money_positions_short_all: '10832', open_interest_all: '500000' }, { bad: 1 }]);
  assert.equal(cot.length, 1);
  assert.equal(cot[0].net, 134972);
  assert.equal(cot[0].date, '2026-09-08');
  assert.deepEqual(F.parseCot(null), []);
  const k = F.parseKlines([[0, '1', '2', '0.5', '1.5', '10', 59, '0', 1, '4'], [60, 'x', '2', '1', '1', '1', 119, '0', 1, '1'], [120, '1', '0.5', '2', '1', '1', 179, '0', 1, '1']]);
  assert.equal(k.length, 1);
  assert.throws(() => F.parseKlines({}), /bukan array/);
  assert.throws(() => F.parseKlines([]), /kosong/);
  const kl = F.parseStreamMessage(JSON.stringify({ stream: 'x', data: { e: 'kline', E: 5, k: { t: 0, o: '1', h: '2', l: '0', c: '1', v: '3', V: '1', T: 59, x: false, i: '1m' } } }));
  assert.equal(kl.kind, 'kline');
  assert.equal(kl.eventTime, 5);
  const tr = F.parseStreamMessage(JSON.stringify({ data: { e: 'aggTrade', E: 9, p: '4280.5' } }));
  assert.deepEqual(tr, { kind: 'trade', price: 4280.5, eventTime: 9 });
  assert.equal(F.parseStreamMessage(JSON.stringify({ e: 'other' })), null);
});

test('retryAfterMs & fetchJson menghormati 429/418', async (t) => {
  assert.equal(F.retryAfterMs(429, '30', 1000), 31_000);
  assert.equal(F.retryAfterMs(418, null, 0), 180_000);
  assert.equal(F.retryAfterMs(429, 'abc', 0), 60_000);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls++;
    if (url.includes('ok')) return new Response(JSON.stringify({ a: 1 }), { status: 200 });
    if (url.includes('bad')) return new Response('x', { status: 500 });
    return new Response('x', { status: 429, headers: { 'retry-after': '60' } });
  });
  assert.deepEqual(await F.fetchJson('https://ok.example/x'), { a: 1 });
  await assert.rejects(F.fetchJson('https://bad.example/x'), /HTTP 500/);
  await assert.rejects(F.fetchJson('https://limited.example/x'), /429/);
  const before = calls;
  await assert.rejects(F.fetchJson('https://limited.example/y'), /menunggu batas rate/);
  assert.equal(calls, before, 'host yang dibatasi tidak dihubungi lagi');
  F.backoffUntil.clear();
});

class FakeWs {
  static all = [];
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; FakeWs.all.push(this); }
  send(x) { this.sent.push(x); }
  open() { this.readyState = 1; this.onopen?.(); }
  message(data) { this.onmessage?.({ data }); }
  close() { this.readyState = 3; this.onclose?.(); }
}

test('LiveSocket: onOpen menandai sambungan ulang, reconnect setelah putus', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const orig = globalThis.WebSocket;
  globalThis.WebSocket = FakeWs;
  FakeWs.all = [];
  const opens = [];
  const msgs = [];
  const statuses = [];
  try {
    const sock = new F.LiveSocket('wss://x', { onMessage: (m) => msgs.push(m), onOpen: (o) => opens.push(o.reconnect), onStatus: (s) => statuses.push(s), silenceMs: 10_000 });
    FakeWs.all[0].open();
    FakeWs.all[0].message('hai');
    assert.deepEqual(msgs, ['hai']);
    FakeWs.all[0].close();
    t.mock.timers.tick(600);
    assert.equal(FakeWs.all.length, 2);
    FakeWs.all[1].open();
    assert.deepEqual(opens, [false, true]);
    // Watchdog menutup sambungan yang diam terlalu lama.
    t.mock.timers.tick(16_000);
    assert.ok(statuses.includes('closed'));
    assert.ok(sock instanceof F.LiveSocket);
  } finally {
    globalThis.WebSocket = orig;
  }
});
