import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as U from '../js/ui.js';

// Kontras WCAG antara warna hsl()/rgb() dan permukaan kartu gelap (#0d1118).
function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((x) => x * 255);
}
// Permukaan kartu tema luxury: hitam hangat #13110d.
function contrast(hsl, bg = [19, 17, 13]) {
  const [h, s, l] = hsl.match(/[\d.]+/g).map(Number);
  const lum = (rgb) => {
    const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const a = lum(hslToRgb(h, s, l));
  const b = lum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test('esc, fmt, fmtSigned tanpa −0, fmtPct, pct', () => {
  assert.equal(U.esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(U.esc(null), '');
  assert.equal(U.fmt(4301.931), '4,301.93');
  assert.equal(U.fmt(NaN), '–');
  assert.equal(U.fmtSigned(-0.04, 1), '0.0');
  assert.equal(U.fmtSigned(-0.4, 0), '0');
  assert.equal(U.fmtSigned(12.34, 1), '+12.3');
  assert.equal(U.fmtSigned(-5, 0), '−5');
  assert.equal(U.fmtPct(0.9), '+0.90%');
  assert.equal(U.fmtPct(null), '–');
  assert.equal(U.pct(0.571), '57.1%');
  assert.equal(U.pct(NaN), '–');
});

test('scoreColor selalu lolos kontras AA di permukaan gelap untuk semua skor', () => {
  for (let s = -100; s <= 100; s += 5) {
    const c = U.scoreColor(s);
    assert.ok(contrast(c) >= 4.5, `skor ${s} → ${c} kontras ${contrast(c).toFixed(2)}`);
  }
  assert.ok(contrast(U.scoreColor(NaN)) >= 4.5);
  assert.match(U.scoreColor(80), /^hsl\(158/);
  assert.match(U.scoreColor(-80), /^hsl\(350/);
  assert.equal(U.scoreColor(5), U.scoreColor(-5), 'skor lemah netral, bukan cokelat');
});

test('scoreFill: intensitas mengikuti kekuatan skor', () => {
  const alpha = (s) => Number(s.match(/([\d.]+)\)$/)[1]);
  assert.ok(alpha(U.scoreFill(90)) > alpha(U.scoreFill(30)));
  assert.match(U.scoreFill(60), /16, 185, 129/);
  assert.match(U.scoreFill(-60), /225, 29, 72/);
  assert.match(U.scoreFill(3), /212, 175, 55/);
  assert.match(U.scoreFill(NaN), /0\.08/);
});

test('toneOf, arrow, shortLabel', () => {
  assert.deepEqual([50, 20, 0, -20, -50, NaN].map(U.toneOf), ['sbull', 'bull', 'neutral', 'bear', 'sbear', 'na']);
  assert.deepEqual([50, 20, 0, -20, -50, NaN].map(U.arrow), ['⬆', '↗', '→', '↘', '⬇', '·']);
  assert.deepEqual([50, 20, 0, -20, -50, NaN].map(U.shortLabel), ['S.BULL', 'BULL', 'NETRAL', 'BEAR', 'S.BEAR', '…']);
});

test('timeAgo, countdown, wib', () => {
  assert.equal(U.timeAgo(5000), '5 dtk');
  assert.equal(U.timeAgo(5 * 60_000), '5 mnt');
  assert.equal(U.timeAgo(3 * 3_600_000), '3 jam');
  assert.equal(U.timeAgo(72 * 3_600_000), '3 hari');
  assert.equal(U.timeAgo(-1), '–');
  assert.equal(U.countdown(3_723_000), '01:02:03');
  assert.equal(U.countdown(-61_000), '−00:01:01');
  assert.equal(U.countdown(90_000_000), '1h 01:00');
  assert.equal(U.countdown(NaN), '–');
  const t = Date.UTC(2026, 8, 16, 18, 0);
  assert.equal(U.wib(t), '01:00');
  assert.equal(U.wib(t, true), 'Kam 17/09 01:00');
});

test('sessionsAt: sesi aktif dan akhir pekan tutup', () => {
  const ny = U.sessionsAt(Date.UTC(2026, 8, 16, 14));
  assert.equal(ny.find((s) => s.id === 'newyork').open, true);
  assert.equal(ny.find((s) => s.id === 'london').open, true);
  assert.equal(ny.find((s) => s.id === 'tokyo').open, false);
  const syd = U.sessionsAt(Date.UTC(2026, 8, 16, 23));
  assert.equal(syd.find((s) => s.id === 'sydney').open, true);
  assert.ok(U.sessionsAt(Date.UTC(2026, 8, 19, 12)).every((s) => !s.open));
  assert.equal(U.SESSIONS.length, 4);
});

test('barCloseAt mengikuti jam buka bar broker', () => {
  const t = Date.UTC(2026, 8, 16, 22, 0);
  assert.equal(U.barCloseAt(t, '4H', 4 * 3_600_000), Date.UTC(2026, 8, 17, 2, 0));
  assert.equal(U.barCloseAt(Date.UTC(2026, 7, 31, 22), '1M', 0), Date.UTC(2026, 9, 1, 22));
  assert.ok(Number.isNaN(U.barCloseAt(NaN, '1m', 60_000)));
});

test('needleAngle & gaugeSvg (jarum diputar lewat CSS)', () => {
  assert.equal(U.needleAngle(-100), 0);
  assert.equal(U.needleAngle(0), 90);
  assert.equal(U.needleAngle(100), 180);
  assert.equal(U.needleAngle(500), 180);
  assert.equal(U.needleAngle(NaN), 90);
  const svg = U.gaugeSvg(35);
  assert.match(svg, /aria-label="Skor gabungan 35"/);
  assert.match(svg, /rotate\(121\.50deg\)/);
  assert.match(U.gaugeSvg(NaN), /belum tersedia/);
});

test('ringDash & probRing', () => {
  const d = U.ringDash(0.25, 120, 10);
  assert.ok(Math.abs(d.offset - d.c * 0.75) < 1e-9);
  assert.equal(U.ringDash(NaN).offset, U.ringDash(NaN).c);
  assert.match(U.probRing(0.43), />43%</);
  assert.match(U.probRing(NaN), />–</);
});

test('radarSvg, sparklineSvg, voteBar, rangePosition', () => {
  const radar = U.radarSvg({ a: { label: 'Trend', score: 40 }, b: { label: '<x>', score: null }, c: { label: 'Mom', score: -20 } });
  assert.match(radar, /&lt;x&gt;/);
  assert.match(radar, /radar-spoke/);
  assert.match(U.radarSvg({ a: { label: 'A', score: null } }), /polygon/);
  assert.equal(U.sparklineSvg([1]), '');
  assert.match(U.sparklineSvg([1, 3, 2]), /polyline/);
  assert.match(U.sparklineSvg([1, 3, 2], { area: true, dot: true }), /polygon[\s\S]*circle/);
  assert.match(U.voteBar(0.5), /left:50%;width:25.0%/);
  assert.match(U.voteBar(-0.5), /left:25.0%;width:25.0%/);
  assert.match(U.voteBar(3), /width:50.0%/);
  assert.match(U.voteBar(null), /vbar-na/);
  assert.equal(U.rangePosition(10, 20, 15), 0.5);
  assert.equal(U.rangePosition(10, 20, 30), 1);
  assert.ok(Number.isNaN(U.rangePosition(20, 10, 15)));
});

test('direction menyatukan kekuatan label', () => {
  assert.equal(U.direction('STRONG BULL'), 'bull');
  assert.equal(U.direction('BULL'), 'bull');
  assert.equal(U.direction('STRONG BEAR'), 'bear');
  assert.equal(U.direction('NETRAL'), 'neutral');
  assert.equal(U.direction(undefined), 'neutral');
});

test('diffVerdicts mencatat perubahan arah, bukan perubahan kekuatan', () => {
  const r = (score, text) => ({ final: { score, label: { text } } });
  const first = U.diffVerdicts(null, { '1m': r(20, 'BULL'), '5m': r(0, 'NETRAL') }, ['1m', '5m', '1H'], 1);
  assert.deepEqual(first.events, []);
  assert.deepEqual(first.next, { '1m': 'BULL', '5m': 'NETRAL' });
  const second = U.diffVerdicts(first.next, { '1m': r(-20, 'BEAR'), '5m': r(1, 'NETRAL'), '1H': r(50, 'STRONG BULL') }, ['1m', '5m', '1H'], 2);
  assert.deepEqual(second.events, [{ tf: '1m', from: 'BULL', to: 'BEAR', score: -20, at: 2 }]);
  assert.equal(second.next['1H'], 'STRONG BULL');
  const strength = U.diffVerdicts({ '1m': 'BULL' }, { '1m': r(45, 'STRONG BULL') }, ['1m'], 4);
  assert.deepEqual(strength.events, [], 'BULL → STRONG BULL bukan perubahan arah');
  assert.deepEqual(U.diffVerdicts({}, { x: { final: { score: NaN } } }, ['x'], 3).next, {});
});

test('faviconSvg & statusLevel', () => {
  assert.match(U.faviconSvg('sbull'), /#10b981/);
  assert.match(U.faviconSvg('tidak-ada'), /fill="#d4af37"/);
  assert.equal(U.statusLevel(null, 0, 10), 'wait');
  assert.equal(U.statusLevel({ ok: false }, 0, 10), 'down');
  assert.equal(U.statusLevel({ ok: true, at: 0 }, 100, 10), 'stale');
  assert.equal(U.statusLevel({ ok: true, at: 95 }, 100, 10), 'up');
  assert.equal(U.statusLevel({ state: 'open' }, 100, 10), 'wait');
});
