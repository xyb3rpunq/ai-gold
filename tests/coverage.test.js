// Meta-tes: setiap ekspor modul di js/ wajib disebut di salah satu berkas tes.
// app.js dan worker.js adalah perekat DOM/Worker — diverifikasi lewat render di browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const EXEMPT_MODULES = new Set(['app.js', 'worker.js']);

test('semua ekspor punya tes', () => {
  const testsText = readdirSync(new URL('tests/', root))
    .filter((f) => f.endsWith('.test.js') && f !== 'coverage.test.js')
    .map((f) => readFileSync(new URL(`tests/${f}`, root), 'utf8'))
    .join('\n');
  const missing = [];
  let total = 0;
  for (const file of readdirSync(new URL('js/', root)).filter((f) => f.endsWith('.js') && !EXEMPT_MODULES.has(f))) {
    const src = readFileSync(new URL(`js/${file}`, root), 'utf8');
    const names = [...src.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
    for (const name of names) {
      total++;
      if (!new RegExp(`\\b${name}\\b`).test(testsText)) missing.push(`${file}:${name}`);
    }
  }
  assert.ok(total > 150, `ekspor terbaca ${total}`);
  assert.deepEqual(missing, [], `ekspor tanpa tes: ${missing.join(', ')}`);
});
