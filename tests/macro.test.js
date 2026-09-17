import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/macro.js';

const H = 3_600_000;

test('syntheticDxy mendekati DXY resmi dari 6 pasangan (data 16 Sep 2026)', () => {
  const q = { EURUSD: 1.14722, USDJPY: 156.136, GBPUSD: 1.3302, USDCAD: 1.3805, USDSEK: 9.8522, USDCHF: 0.8105 };
  const v = M.syntheticDxy(q);
  assert.ok(v > 95 && v < 105, `hasil ${v}`);
  assert.ok(Number.isNaN(M.syntheticDxy({ ...q, USDJPY: NaN })));
  assert.equal(Object.values(M.DXY_WEIGHTS).length, 6);
});

test('correlationFactor & goldCorrelation', () => {
  assert.equal(M.correlationFactor(0.6), 1);
  assert.equal(M.correlationFactor(-1), 0.25);
  assert.equal(M.correlationFactor(NaN), 0.6);
  assert.ok(Math.abs(M.goldCorrelation([1, 2, 3], [1, 2, 3]) - 1) < 1e-9);
});

test('dxyVote: DXY kuat → bear emas, diskalakan korelasi', () => {
  assert.ok(M.dxyVote(0.8, 0.5, 0.8) < -0.5);
  assert.ok(M.dxyVote(-0.8, -0.5, 0.8) > 0.5);
  assert.ok(Math.abs(M.dxyVote(0.8, null, -1)) < Math.abs(M.dxyVote(0.8, null, 0.8)));
  assert.equal(M.dxyVote(null, null, 1), null);
});

test('ratesVote: yield naik bear, VIX naik sedikit bull', () => {
  assert.ok(M.ratesVote({ us10yChg: 1.5, us02yChg: 1 }) < -0.5);
  assert.ok(M.ratesVote({ vixChg: 20 }) > 0.9);
  assert.equal(M.ratesVote({}), null);
  assert.equal(M.ratesVote(), null);
});

test('eventPolarity & currencyUsdSign', () => {
  assert.equal(M.eventPolarity('CPI m/m'), 1);
  assert.equal(M.eventPolarity('Unemployment Claims'), -1);
  assert.equal(M.eventPolarity('Unemployment Rate'), -1);
  assert.equal(M.eventPolarity('FOMC Press Conference'), 0);
  assert.equal(M.eventPolarity('Crude Oil Inventories'), 0);
  assert.equal(M.currencyUsdSign('USD'), 1);
  assert.ok(M.currencyUsdSign('EUR') < 0);
  assert.equal(M.currencyUsdSign('AUD'), 0);
});

test('surpriseVote: CPI panas → emas turun, klaim pengangguran naik → emas naik, meluruh', () => {
  const now = Date.UTC(2026, 8, 16, 14);
  const cpi = { title: 'CPI m/m', currency: 'USD', importance: 1, date: new Date(now - H).toISOString(), actual: 0.6, forecast: 0.3, previous: 0.2 };
  const v = M.surpriseVote(cpi, now);
  assert.ok(v.vote < -0.5);
  const later = M.surpriseVote({ ...cpi, date: new Date(now - 9 * H).toISOString() }, now);
  assert.ok(Math.abs(later.vote) < Math.abs(v.vote));
  const claims = { ...cpi, title: 'Unemployment Claims', actual: 250000, forecast: 210000, previous: 205000 };
  assert.ok(M.surpriseVote(claims, now).vote > 0);
  const eur = { ...cpi, currency: 'EUR' };
  assert.ok(M.surpriseVote(eur, now).vote > 0);
  assert.equal(M.surpriseVote({ ...cpi, actual: null }, now), null);
  assert.equal(M.surpriseVote({ ...cpi, date: new Date(now + H).toISOString() }, now), null);
  assert.equal(M.surpriseVote({ ...cpi, date: new Date(now - 50 * H).toISOString() }, now), null);
  assert.equal(M.surpriseVote({ ...cpi, title: 'FOMC Statement' }, now), null);
});

test('macroVote & newsRisk', () => {
  const now = Date.UTC(2026, 8, 16, 14);
  const ev = [
    { title: 'CPI m/m', currency: 'USD', importance: 1, date: new Date(now - H).toISOString(), actual: 0.6, forecast: 0.3, previous: 0.2 },
    { title: 'Federal Funds Rate', currency: 'USD', importance: 1, date: new Date(now + 20 * 60_000).toISOString(), actual: null, forecast: 4, previous: 3.75 },
    { title: 'GDP q/q', currency: 'NZD', importance: 1, date: new Date(now + 10 * 60_000).toISOString() },
  ];
  const mv = M.macroVote(ev, now);
  assert.ok(mv.vote < 0 && mv.items.length === 1);
  assert.equal(M.macroVote([], now).vote, null);
  const r = M.newsRisk(ev, now);
  assert.equal(r.active, true);
  assert.equal(r.factor, 0.5);
  assert.equal(r.events.length, 1);
  assert.equal(r.next.title, 'Federal Funds Rate');
  const calm = M.newsRisk(ev, now - 5 * H);
  assert.equal(calm.active, false);
  assert.equal(calm.factor, 1);
});

test('retailContrarianVote, fundingVote, cotVote', () => {
  assert.ok(M.retailContrarianVote(3.4) < -0.5);
  assert.ok(M.retailContrarianVote(0.4) > 0.5);
  assert.equal(M.retailContrarianVote(0), null);
  assert.ok(M.fundingVote(0.001) < -0.9);
  assert.equal(M.fundingVote(NaN), null);
  const hist = Array.from({ length: 40 }, (_, i) => ({ net: 1000 - i * 10 }));
  const top = M.cotVote(hist);
  assert.equal(top.percentile, 1);
  assert.ok(top.vote < 0);
  assert.equal(M.cotVote(hist.slice(0, 5)), null);
});

test('headlineScore & headlinesVote meluruh dengan umur', () => {
  assert.equal(M.headlineScore('Gold falls more than 1% after Fed hikes interest rates'), -1);
  assert.equal(M.headlineScore('Gold rises on safe-haven demand'), 1);
  assert.equal(M.headlineScore('Markets await data'), 0);
  const now = Date.UTC(2026, 8, 16, 20);
  const hv = M.headlinesVote([
    { id: 'a', title: 'Gold rises on safe-haven demand', published: (now - H) / 1000 },
    { id: 'b', title: 'Gold falls as dollar gains', published: (now - 20 * H) / 1000 },
    { id: 'c', title: 'Gold jumps', published: (now - 30 * H) / 1000 },
    { id: 'd', title: 'Neutral note', published: (now - H) / 1000 },
  ], now);
  assert.ok(hv.vote > 0);
  assert.equal(hv.scored.length, 2);
  assert.equal(M.headlinesVote([], now).vote, null);
});

test('sentimentVote menggabungkan komponen yang ada', () => {
  assert.equal(M.sentimentVote({}), null);
  assert.ok(Math.abs(M.sentimentVote({ longShort: -1 }) + 1) < 1e-9);
  const withCot = M.sentimentVote({ longShort: 0, cot: { vote: 1 }, useCot: true });
  assert.ok(withCot > 0);
  assert.equal(M.sentimentVote({ longShort: 0, cot: { vote: 1 }, useCot: false }), 0);
});
