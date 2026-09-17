import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as U from '../js/ui.js';

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

test('scoreColor, toneOf, arrow', () => {
  assert.match(U.scoreColor(100), /^hsl\(142/);
  assert.match(U.scoreColor(-100), /^hsl\(0/);
  assert.equal(U.scoreColor(NaN), 'hsl(220 8% 45%)');
  assert.equal(U.toneOf(50), 'sbull');
  assert.equal(U.toneOf(20), 'bull');
  assert.equal(U.toneOf(0), 'neutral');
  assert.equal(U.toneOf(-20), 'bear');
  assert.equal(U.toneOf(-50), 'sbear');
  assert.equal(U.toneOf(NaN), 'na');
  assert.deepEqual([50, 20, 0, -20, -50, NaN].map(U.arrow), ['⬆', '↗', '→', '↘', '⬇', '·']);
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

test('gaugeSvg, radarSvg, sparklineSvg, voteBar, probRing', () => {
  assert.match(U.gaugeSvg(35), /aria-label="Skor 35"/);
  assert.match(U.gaugeSvg(NaN), /opacity="0.25"/);
  const radar = U.radarSvg({ a: { label: 'Trend', score: 40 }, b: { label: '<x>', score: null }, c: { label: 'Mom', score: -20 } });
  assert.match(radar, /&lt;x&gt;/);
  assert.equal(U.sparklineSvg([1]), '');
  assert.match(U.sparklineSvg([1, 3, 2]), /polyline/);
  assert.match(U.voteBar(0.5), /left:50%;width:25.0%/);
  assert.match(U.voteBar(-0.5), /left:25.0%;width:25.0%/);
  assert.match(U.voteBar(null), /vbar-na/);
  assert.match(U.probRing(0.43), /43%/);
  assert.match(U.probRing(NaN), />–</);
});

test('statusLevel', () => {
  assert.equal(U.statusLevel(null, 0, 10), 'wait');
  assert.equal(U.statusLevel({ ok: false }, 0, 10), 'down');
  assert.equal(U.statusLevel({ ok: true, at: 0 }, 100, 10), 'stale');
  assert.equal(U.statusLevel({ ok: true, at: 95 }, 100, 10), 'up');
  assert.equal(U.statusLevel({ state: 'open' }, 100, 10), 'wait');
});
