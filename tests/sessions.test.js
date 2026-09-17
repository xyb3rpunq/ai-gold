import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../js/sessions.js';

const H = 3_600_000;

test('nyOffsetHours mengikuti DST AS 2026 (8 Mar – 1 Nov)', () => {
  assert.equal(S.nyOffsetHours(Date.UTC(2026, 0, 15)), -5);
  assert.equal(S.nyOffsetHours(Date.UTC(2026, 2, 8, 6, 59)), -5);
  assert.equal(S.nyOffsetHours(Date.UTC(2026, 2, 8, 7, 0)), -4);
  assert.equal(S.nyOffsetHours(Date.UTC(2026, 6, 1)), -4);
  assert.equal(S.nyOffsetHours(Date.UTC(2026, 10, 1, 5, 59)), -4);
  assert.equal(S.nyOffsetHours(Date.UTC(2026, 10, 1, 6, 0)), -5);
});

test('sessionDay berganti tepat 17:00 New York', () => {
  // Musim panas: 17:00 NY = 21:00 UTC
  const summer = Date.UTC(2026, 8, 16, 21, 0);
  assert.equal(S.sessionDay(summer) - S.sessionDay(summer - 1), 1);
  assert.equal(S.sessionDay(summer + H) , S.sessionDay(summer));
  // Musim dingin: 17:00 NY = 22:00 UTC
  const winter = Date.UTC(2026, 11, 16, 22, 0);
  assert.equal(S.sessionDay(winter) - S.sessionDay(winter - 1), 1);
  assert.equal(S.sessionDay(Date.UTC(2026, 11, 16, 21, 30)), S.sessionDay(winter - 1));
});

test('sessionWeek dimulai Minggu 17:00 NY', () => {
  const sundayOpen = Date.UTC(2026, 8, 13, 21, 0); // Minggu 13 Sep 2026, 17:00 EDT
  assert.equal(S.sessionWeek(sundayOpen) - S.sessionWeek(sundayOpen - 1), 1);
  assert.equal(S.sessionWeek(Date.UTC(2026, 8, 18, 12)), S.sessionWeek(sundayOpen));
});

test('sessionMonth, sessionQuarter, sessionYear', () => {
  const lateAug31 = Date.UTC(2026, 7, 31, 22, 0); // setelah 17:00 NY → sudah sesi 1 Sep
  assert.equal(S.sessionMonth(lateAug31), 2026 * 12 + 8);
  assert.equal(S.sessionQuarter(Date.UTC(2026, 4, 5)), Math.floor((2026 * 12 + 4) / 3));
  assert.equal(S.sessionYear(Date.UTC(2026, 4, 5)), 2026);
});

test('vwapAnchorFor per timeframe', () => {
  assert.equal(S.vwapAnchorFor({ id: '15m', ms: 15 * 60_000 }).label, 'Sesi');
  assert.equal(S.vwapAnchorFor({ id: '4H', ms: 4 * H }).label, 'Mingguan');
  assert.equal(S.vwapAnchorFor({ id: '1D', ms: 24 * H }).label, 'Bulanan');
  assert.equal(S.vwapAnchorFor({ id: '1W', ms: 7 * 24 * H }).label, 'Kuartal');
  assert.equal(S.vwapAnchorFor({ id: '1M', ms: 30 * 24 * H }).label, 'Tahunan');
  assert.equal(typeof S.vwapAnchorFor({ id: '1m', ms: 60_000 }).key, 'function');
});
