import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as N from '../js/news.js';

test('URL sumber', () => {
  assert.match(N.FF_URL, /^https:\/\/nfs\.faireconomy\.media\//);
  assert.equal(N.headlinesUrl('TVC:GOLD'), 'https://news-headlines.tradingview.com/v2/headlines?client=web&lang=en&symbol=TVC%3AGOLD');
});

test('tickerFor memetakan event USD utama ke ticker ekonomi TradingView', () => {
  assert.equal(N.tickerFor('CPI m/m', 'USD'), 'ECONOMICS:USIRMM');
  assert.equal(N.tickerFor('Non-Farm Employment Change', 'USD'), 'ECONOMICS:USNFP');
  assert.equal(N.tickerFor('Advance GDP q/q', 'USD'), 'ECONOMICS:USGDPQQ');
  assert.equal(N.tickerFor('CPI m/m', 'CAD'), null);
  assert.equal(N.tickerFor('Something else', 'USD'), null);
  assert.ok(N.USD_TICKERS.length >= 15);
});

test('parseFFNumber', () => {
  assert.equal(N.parseFFNumber('162K'), 162000);
  assert.equal(N.parseFFNumber('-0.1%'), -0.1);
  assert.equal(N.parseFFNumber('<1.25%'), 1.25);
  assert.equal(N.parseFFNumber('1.2B'), 1.2e9);
  assert.equal(N.parseFFNumber('3-0-6'), null);
  assert.equal(N.parseFFNumber(''), null);
  assert.equal(N.parseFFNumber(undefined), null);
});

test('transformForexFactory: filter impact, parsing, urutan, ticker', () => {
  const raw = [
    { title: 'Federal Funds Rate', country: 'USD', date: '2026-09-16T14:00:00-04:00', impact: 'High', forecast: '4.00%', previous: '3.75%' },
    { title: 'CPI m/m', country: 'USD', date: '2026-09-11T08:30:00-04:00', impact: 'High', forecast: '0.3%', previous: '0.2%', actual: '0.4%' },
    { title: 'Bank Holiday', country: 'GBP', date: '2026-09-12T00:00:00-04:00', impact: 'Holiday', forecast: '', previous: '' },
    { title: 'Retail Sales m/m', country: 'USD', date: 'bukan tanggal', impact: 'Medium' },
    { title: 'Low thing', country: 'USD', date: '2026-09-12T00:00:00-04:00', impact: 'Low' },
  ];
  const ev = N.transformForexFactory(raw);
  assert.equal(ev.length, 2);
  assert.equal(ev[0].title, 'CPI m/m');
  assert.equal(ev[0].actual, 0.4);
  assert.equal(ev[0].unit, '%');
  assert.equal(ev[1].importance, 1);
  assert.equal(ev[1].date, '2026-09-16T18:00:00.000Z');
  assert.equal(ev[1].ticker, 'ECONOMICS:USINTR');
  assert.deepEqual(N.transformForexFactory(null), []);
});

test('transformHeadlines: dedupe, urut terbaru, tautan TradingView', () => {
  const a = { items: [{ id: '1', title: 'A', provider: 'reuters', published: 10, storyPath: '/news/x/' }, { id: '2', title: 'B', source: 'Reuters', published: 30 }] };
  const b = { items: [{ id: '1', title: 'A dup', published: 10 }, { id: '3', title: 'C', published: 20 }, { title: 'tanpa id' }] };
  const h = N.transformHeadlines(a, b, null);
  assert.deepEqual(h.map((x) => x.id), ['2', '3', '1']);
  assert.equal(h[2].url, 'https://www.tradingview.com/news/x/');
  assert.equal(h[0].url, null);
});

test('formatValue', () => {
  assert.equal(N.formatValue(162000), '162K');
  assert.equal(N.formatValue(1_500_000), '1.5M');
  assert.equal(N.formatValue(0.3, '%'), '0.3%');
  assert.equal(N.formatValue(54.6), '54.6');
  assert.equal(N.formatValue(null), '–');
});

test('mergeLiveActual hanya setelah rilis dan bila berbeda dari previous', () => {
  const now = Date.UTC(2026, 8, 16, 19);
  const ev = { date: new Date(now - 60_000).toISOString(), actual: null, previous: 3.75 };
  assert.equal(N.mergeLiveActual(ev, 4, now).actual, 4);
  assert.equal(N.mergeLiveActual(ev, 4, now).liveActual, true);
  assert.equal(N.mergeLiveActual(ev, 3.75, now).actual, null);
  assert.equal(N.mergeLiveActual({ ...ev, date: new Date(now + 60_000).toISOString() }, 4, now).actual, null);
  assert.equal(N.mergeLiveActual({ ...ev, actual: 3.9 }, 4, now).actual, 3.9);
  assert.equal(N.mergeLiveActual(ev, NaN, now).actual, null);
});
