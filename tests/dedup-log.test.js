const { test } = require('node:test');
const assert = require('node:assert');

const DedupLog = require('../modules/dedup-log.js');

test('nova registra motivo uma única vez por chave', () => {
  const mapa = new Map();
  assert.strictEqual(DedupLog.nova(mapa, 'a', 'm1'), true);
  assert.strictEqual(DedupLog.nova(mapa, 'a', 'm1'), false);
  assert.strictEqual(DedupLog.nova(mapa, 'a', 'm2'), true);
  assert.strictEqual(DedupLog.nova(mapa, 'b', 'm1'), true);
});
