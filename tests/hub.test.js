import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as HubMod from '../js/hub.js';
import { tvResolutions } from '../js/candles.js';
import { makeCandles } from './helpers.js';

const { DataHub, seriesPlan, chooseSource, tvAllowedHost, QUOTE_SYMBOLS } = HubMod;

test('tvAllowedHost hanya localhost (sesuai whitelist TradingView)', () => {
  assert.equal(tvAllowedHost('localhost'), true);
  assert.equal(tvAllowedHost('127.0.0.1'), false);
  assert.equal(tvAllowedHost('xyb3rpunq.github.io'), false);
});

test('seriesPlan: emas + DXY untuk setiap resolusi', () => {
  const plan = seriesPlan('OANDA');
  assert.equal(plan.length, tvResolutions().length * 2);
  assert.ok(plan.some((p) => p.symbol === 'OANDA:XAUUSD' && p.res === '1M' && p.count === 500));
  assert.ok(plan.filter((p) => p.symbol === 'TVC:DXY').every((p) => p.count === 400));
  assert.equal(seriesPlan('TIDAK_ADA')[0].symbol, 'PEPPERSTONE:XAUUSD');
  assert.ok(QUOTE_SYMBOLS.includes('TVC:DXY'));
});

test('chooseSource', () => {
  const full = { gold: Object.fromEntries(tvResolutions().map((r) => [r, makeCandles(60)])) };
  assert.equal(chooseSource(full, {}), 'tv');
  assert.equal(chooseSource({ gold: {} }, { perp: true, paxg: true }), 'binance');
  assert.equal(chooseSource({ gold: {} }, {}), null);
  assert.equal(chooseSource({ gold: { 1: makeCandles(60) } }, {}), 'tv');
});

test('DataHub web publik: tanpa TradingView, tick Binance dijangkarkan ke broker', () => {
  const out = [];
  const hub = new DataHub((m) => out.push(m), { hostname: 'xyb3rpunq.github.io', now: () => 1_000_000 });
  assert.equal(hub.tvMode, false);
  hub.startTv();
  assert.equal(hub.tv, null);
  hub.loaded.perp = true;
  hub.source = 'binance';
  hub.lastPrice.perp = 4310;
  hub.lastPrice.paxg = 4305;
  hub.anchorToBroker({ brokers: { PEPPERSTONE: { bid: 4299.9, ask: 4300.1, close: 4300 } } });
  assert.ok(Math.abs(hub.market.basis.perp - 10) < 1e-9);
  assert.equal(hub.market.brokerQuote.ref, 4300);
  hub.lastPrice.perp = 4312;
  hub.anchorToBroker({ brokers: { PEPPERSTONE: { bid: 4301.9, ask: 4302.1 } } });
  assert.ok(Math.abs(hub.market.accuracy.last) < 1e-9);
  hub.anchorToBroker({ brokers: {} });
  hub.onWs('perp', JSON.stringify({ data: { e: 'aggTrade', E: 999_900, p: '4315' } }));
  const tick = out.find((m) => m.type === 'tick');
  assert.ok(Math.abs(tick.price - (4315 - hub.market.basis.perp)) < 1e-9);
  assert.ok(Math.abs(tick.ask - tick.bid - 0.2) < 1e-9);
  assert.equal(hub.status.ws_perp.latency, 100);
  hub.onWs('perp', 'bukan json');
  hub.onWs('paxg', JSON.stringify({ data: { e: 'aggTrade', p: '1' } }));
});

test('DataHub: kline Binance di-upsert, broker diganti membersihkan cache AI', () => {
  const hub = new DataHub(() => {}, { hostname: 'example.com' });
  hub.loaded.perp = true;
  hub.store.perp['1m'] = makeCandles(3);
  const last = hub.store.perp['1m'].at(-1);
  hub.onWs('perp', JSON.stringify({ data: { e: 'kline', E: 1, k: { t: last.t, o: '1', h: '2', l: '0.5', c: '1.5', v: '9', V: '4', T: last.closeT, x: false, i: '1m' } } }));
  assert.equal(hub.store.perp['1m'].at(-1).c, 1.5);
  assert.equal(hub.lastPrice.perp, 1.5);
  hub.aiCache.set('x', {});
  hub.setBroker('OANDA');
  assert.equal(hub.broker, 'OANDA');
  assert.equal(hub.aiCache.size, 0);
  hub.setBroker('TIDAK_ADA');
  assert.equal(hub.broker, 'OANDA');
  hub.select('4H');
  assert.equal(hub.selected, '4H');
  hub.select('99m');
  assert.equal(hub.selected, '4H');
});

test('DataHub mode lokal: bar & quote TradingView', () => {
  const out = [];
  let t = 5_000_000;
  const hub = new DataHub((m) => out.push(m), { hostname: 'localhost', now: () => t });
  assert.equal(hub.tvMode, true);
  hub.onTvBars('gold_15', makeCandles(5, { stepMs: 900_000 }), true);
  hub.onTvBars('gold_15', makeCandles(2, { stepMs: 900_000, start: 5000 }), false);
  assert.equal(hub.store.gold['15'].length, 5);
  hub.onTvBars('dxy_15', makeCandles(3), true);
  assert.equal(hub.store.dxy['15'].length, 3);
  hub.onTvBars(undefined, [], true);
  hub.lastPrice.perp = 4310;
  hub.onTvQuote('PEPPERSTONE:XAUUSD', { lp: 4300, bid: 4299.9, ask: 4300.1, lp_time: 4_999 }, 'PEPPERSTONE:XAUUSD');
  assert.equal(out.at(-1).type, 'tick');
  assert.equal(out.at(-1).price, 4300);
  assert.equal(hub.status.tv_quote.latency, 1000);
  assert.equal(hub.market.basis.perp, 10);
  t += 500;
  hub.onTvQuote('PEPPERSTONE:XAUUSD', { bid: 4300 }, 'PEPPERSTONE:XAUUSD');
  assert.equal(hub.status.tv_quote.latency, 1000, 'latensi tidak dihitung ulang tanpa lp_time baru');
  hub.onTvQuote('TVC:DXY', { lp: 100.3, chp: 0.2 }, 'PEPPERSTONE:XAUUSD');
  assert.equal(hub.market.quotes['TVC:DXY'].chp, 0.2);
});

test('DataHub.snapshot & guard', async () => {
  const hub = new DataHub(() => {}, { hostname: 'example.com', now: () => Date.UTC(2026, 8, 17) });
  const empty = hub.snapshot();
  assert.equal(empty.source, null);
  assert.equal(empty.summary, null);
  const store = hub.store;
  store.perp['1m'] = makeCandles(400, { t0: Date.UTC(2026, 8, 16, 17) });
  hub.loaded.perp = true;
  hub.loaded.paxg = true;
  const snap = hub.snapshot();
  assert.equal(snap.source, 'binance');
  assert.equal(snap.type, 'snapshot');
  assert.ok(snap.results['15m'].error);
  assert.equal(snap.tvMode, false);
  const ok = await hub.guard('x', async () => 5);
  assert.equal(ok, 5);
  assert.equal(hub.status.x.ok, true);
  await hub.guard('y', async () => { throw new Error('gagal'); });
  assert.equal(hub.status.y.ok, false);
  assert.equal(hub.status.y.error, 'gagal');
  hub.setStatus('z', { a: 1 });
  hub.setStatus('z', { b: 2 });
  assert.deepEqual(hub.status.z, { a: 1, b: 2 });
});

test('DataHub: pemuatan & polling jaringan dengan fetch tiruan', async (t) => {
  const kline = (i) => [i * 60_000, '4300', '4301', '4299', '4300.5', '10', i * 60_000 + 59_999, '0', 3, '6'];
  t.mock.method(globalThis, 'fetch', async (url) => {
    const body = (x) => new Response(JSON.stringify(x), { status: 200 });
    if (url.includes('/klines')) return body(Array.from({ length: 5 }, (_, i) => kline(i)));
    if (url.includes('scanner.tradingview.com')) {
      const r = Array(10).fill(null);
      return body({ data: [{ s: 'OANDA:XAUUSD', d: [4300, 0.1, 'streaming', 4299.8, 4300.2, ...r] }, { s: 'PEPPERSTONE:XAUUSD', d: [4300.1, 0.1, 'streaming', 4300, 4300.2, ...r] }] });
    }
    if (url.includes('globalLongShortAccountRatio')) return body([{ longShortRatio: '3.4', longAccount: '0.77' }]);
    if (url.includes('premiumIndex')) return body({ lastFundingRate: '0.0001', nextFundingTime: 1 });
    if (url.includes('openInterest')) return body({ openInterest: '1000' });
    if (url.includes('news.json')) return body({ generatedAt: 'x', events: [{ ticker: 'ECONOMICS:USINTR', importance: 1 }, { ticker: null, importance: 1 }], headlines: [] });
    if (url.includes('cftc.gov')) return body([{ report_date_as_yyyy_mm_dd: '2026-09-08T00:00:00.000', m_money_positions_long_all: '10', m_money_positions_short_all: '4' }]);
    return new Response('x', { status: 404 });
  });
  const hub = new DataHub(() => {}, { hostname: 'example.com' });
  await hub.loadKlines('perp');
  assert.equal(hub.loaded.perp, true);
  assert.equal(hub.lastPrice.perp, 4300.5);
  await hub.loadEur();
  assert.equal(hub.loaded.eur, true);
  hub.source = 'binance';
  await hub.pollScanner();
  assert.equal(hub.market.scanner.brokers.PEPPERSTONE.bid, 4300);
  assert.ok(Number.isFinite(hub.market.basis.perp));
  await hub.pollSentiment();
  assert.equal(hub.market.sentiment.longShort, 3.4);
  await hub.pollNews();
  assert.deepEqual(hub.econTickers, ['ECONOMICS:USINTR']);
  await hub.pollCot();
  assert.equal(hub.market.cot[0].net, 6);
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
  await assert.rejects(hub.pollScanner(), /XAUUSD tidak ada/);
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ events: 'x' }), { status: 200 }));
  await assert.rejects(hub.pollNews(), /tidak valid/);
});

test('DataHub: cadangan PAXG intraday saat perp dibatasi', async (t) => {
  const kline = (i) => [i * 60_000, '4300', '4301', '4299', '4300.5', '10', i * 60_000 + 59_999, '0', 3, '6'];
  const requested = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    requested.push(url);
    return new Response(JSON.stringify(Array.from({ length: 5 }, (_, i) => kline(i))), { status: 200 });
  });
  const origWs = globalThis.WebSocket;
  const sockets = [];
  globalThis.WebSocket = class { constructor(u) { this.url = u; sockets.push(this); } send() {} close() {} };
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  try {
    const out = [];
    const hub = new DataHub((m) => out.push(m), { hostname: 'example.com', now: () => 5_000_000 });
    assert.equal(hub.primaryFeed(), 'paxg');
    hub.loaded.paxg = true;
    await hub.enablePaxgFallback();
    assert.equal(hub.loaded.paxgIntraday, true);
    assert.ok(requested.every((u) => u.includes('api.binance.com') && u.includes('PAXGUSDT')));
    assert.ok(hub.store.paxg['1m'] && hub.store.paxg['4h']);
    assert.match(sockets[0].url, /paxgusdt@kline_1m/);
    assert.equal(chooseSource({ gold: {} }, hub.loaded), 'binance');
    await hub.enablePaxgFallback();
    assert.equal(sockets.length, 1, 'tidak mengaktifkan cadangan dua kali');
    await hub.enablePaxgFallbackReload(['1m']);
    hub.source = 'binance';
    hub.market.basis.paxg = 2;
    hub.market.brokerQuote = { bid: 4298, ask: 4298.4 };
    const last = hub.store.paxg['1m'].at(-1);
    hub.onWs('paxg', JSON.stringify({ data: { e: 'kline', E: 4_999_950, k: { t: last.t, o: '4300', h: '4302', l: '4299', c: '4301', v: '5', V: '2', T: last.closeT, x: false, i: '1m' } } }));
    const tick = out.find((m) => m.type === 'tick');
    assert.equal(tick.source, 'paxg');
    assert.ok(Math.abs(tick.price - 4299) < 1e-9);
    hub.loaded.perp = true;
    assert.equal(hub.primaryFeed(), 'perp');
  } finally {
    globalThis.WebSocket = origWs;
  }
});
