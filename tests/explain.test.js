import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as X from '../js/explain.js';

test('STYLES menutup semua 15 timeframe tanpa tumpang tindih', () => {
  const all = X.STYLES.flatMap((s) => s.tfs);
  assert.equal(all.length, 15);
  assert.equal(new Set(all).size, 15);
  for (const s of X.STYLES) assert.ok(s.tfs.includes(s.mainTf), s.id);
});

test('directionWord & strengthWord', () => {
  assert.equal(X.directionWord(20).key, 'up');
  assert.equal(X.directionWord(-20).label, 'CONDONG TURUN');
  assert.equal(X.directionWord(5).label, 'BELUM JELAS');
  assert.equal(X.directionWord(NaN).key, 'wait');
  assert.equal(X.strengthWord(60, 70).label, 'kuat');
  assert.equal(X.strengthWord(60, 30).label, 'sedang');
  assert.equal(X.strengthWord(18, 20).label, 'lemah');
  assert.equal(X.strengthWord(5, 90).level, 0);
  assert.equal(X.strengthWord(NaN, 0).level, 0);
});

test('reliabilityWord & agreement', () => {
  assert.equal(X.reliabilityWord(0), 'belum terbukti');
  assert.equal(X.reliabilityWord(0.2), 'rendah');
  assert.equal(X.reliabilityWord(0.5), 'sedang');
  assert.equal(X.reliabilityWord(0.9), 'tinggi');
  const results = { a: { final: { score: 30 } }, b: { final: { score: 20 } }, c: { final: { score: -30 } }, d: {} };
  assert.deepEqual(X.agreement(results, ['a', 'b', 'c', 'd'], 'up'), { same: 2, total: 3 });
});

test('upcomingNews & sessionNote', () => {
  const now = Date.UTC(2026, 8, 17, 10);
  const ev = [
    { title: 'CPI m/m', currency: 'USD', importance: 1, date: new Date(now + 3_600_000).toISOString() },
    { title: 'Low', currency: 'USD', importance: 0, date: new Date(now + 60_000).toISOString() },
    { title: 'Lama', currency: 'USD', importance: 1, date: new Date(now - 3_600_000).toISOString() },
  ];
  const up = X.upcomingNews(ev, now);
  assert.equal(up.length, 1);
  assert.equal(up[0].inMs, 3_600_000);
  assert.match(up[0].when, /WIB$/);
  assert.deepEqual(X.upcomingNews(undefined, now), []);
  assert.match(X.sessionNote(Date.UTC(2026, 8, 17, 14)).text, /London & New York/);
  assert.equal(X.sessionNote(Date.UTC(2026, 8, 17, 2)).ok, true);
  assert.match(X.sessionNote(Date.UTC(2026, 8, 19, 12)).text, /tutup/);
});

function snapWith({ hzScore = 30, conf = 50, tfScore = 30, aiP = 0.62, rel = 0.8, dxy = 0.4, rates = 0.3, risk = { active: false, next: null, events: [] } } = {}) {
  const results = {};
  for (const s of X.STYLES) for (const id of s.tfs) {
    results[id] = { final: { score: tfScore }, ai: { p: aiP, reliability: rel }, ctx: { dxy }, levels: { support: 4300, resistance: 4320, price: 4310 } };
  }
  return {
    results,
    summary: { horizons: X.STYLES.map((s) => ({ id: s.id, score: hzScore, confidence: conf, aiProb: aiP })) },
    global: { rates, risk },
  };
}

test('explainStyle: sinyal kompak naik dengan AI andal', () => {
  const now = Date.UTC(2026, 8, 17, 3);
  const e = X.explainStyle('intraday', snapWith(), now);
  assert.equal(e.dir.key, 'up');
  assert.match(e.sentence, /intraday .* condong naik/);
  assert.ok(e.checks.some((c) => c.ok === true && /5 dari 5 timeframe/.test(c.text)));
  assert.ok(e.checks.some((c) => /AI memperkirakan peluang naik 62%/.test(c.text) && c.ok === true));
  assert.ok(e.checks.some((c) => /Dolar AS melemah/.test(c.text)));
  assert.ok(e.checks.some((c) => /obligasi AS turun/.test(c.text)));
  assert.ok(e.checks.some((c) => /Tidak ada berita besar/.test(c.text)));
  assert.equal(e.levels.tf, '1H');
  assert.match(X.levelsSentence(e.levels), /resistance\) di 4,320\.00/);
});

test('explainStyle: AI tak andal, dolar menguat, berita besar aktif, arah belum jelas', () => {
  const now = Date.UTC(2026, 8, 17, 12, 20);
  const risk = { active: true, events: [{ currency: 'USD', title: 'CPI m/m' }], next: null };
  const e = X.explainStyle('scalp', snapWith({ hzScore: 5, tfScore: 5, rel: 0, dxy: -0.5, rates: -0.4, risk }), now);
  assert.equal(e.dir.label, 'BELUM JELAS');
  assert.match(e.sentence, /belum jelas/);
  assert.ok(e.checks.some((c) => /belum terbukti andal/.test(c.text) && c.ok === null));
  const waitReliable = X.explainStyle('scalp', snapWith({ hzScore: 5, tfScore: 5, rel: 0.9 }), now);
  assert.ok(waitReliable.checks.some((c) => /AI memperkirakan/.test(c.text) && c.ok === null), 'arah belum jelas → AI hanya info, bukan peringatan');
  const against = X.explainStyle('scalp', snapWith({ hzScore: 30, tfScore: 30, aiP: 0.3, rel: 0.9 }), now);
  assert.ok(against.checks.some((c) => /AI memperkirakan/.test(c.text) && c.ok === false), 'AI berlawanan arah → peringatan');
  assert.ok(e.checks.some((c) => /Dolar AS menguat/.test(c.text)));
  assert.ok(e.checks.some((c) => /Hati-hati: berita besar/.test(c.text) && c.ok === false));
  const next = X.explainStyle('swing', snapWith({ dxy: 0.05, rates: 0.02, risk: { active: false, events: [], next: { currency: 'USD', title: 'NFP', date: new Date(now + 30 * 60_000).toISOString() } } }), now);
  assert.ok(next.checks.some((c) => /Dolar AS sedang datar/.test(c.text)));
  assert.ok(next.checks.some((c) => /obligasi AS stabil/.test(c.text)));
  assert.ok(next.checks.some((c) => /Berita besar berikutnya: USD NFP dalam 00:30:00/.test(c.text)));
  const loading = X.explainStyle('tidak-ada', {}, now);
  assert.equal(loading.style.id, 'intraday');
  assert.match(loading.sentence, /dimuat/);
  assert.equal(X.levelsSentence(null), '');
  assert.equal(X.levelsSentence({ tf: '5m', support: NaN, resistance: NaN }), '');
});
