const { test } = require('node:test');
const assert = require('node:assert');

require('./helpers/chrome-mock.js');
const ZapStorage = require('../modules/storage-manager.js');

test('_numerosCombinam tolera DDI e fim de dígitos', () => {
  assert.strictEqual(ZapStorage._numerosCombinam('5511981353190', '11981353190'), true);
  assert.strictEqual(ZapStorage._numerosCombinam('5511981353190', '981353190'), true);
  assert.strictEqual(ZapStorage._numerosCombinam('5511981353190', '5511987654321'), false);
  assert.strictEqual(ZapStorage._numerosCombinam('', '11981353190'), false);
});

test('_nomesCombinam casa primeiro nome (caso real "Soraia S2" x "Soraia")', () => {
  assert.strictEqual(ZapStorage._nomesCombinam('Soraia S2', 'Soraia'), true);
});

test('_nomesCombinam ignora caixa, acento e emoji', () => {
  assert.strictEqual(ZapStorage._nomesCombinam('Grupo 59 Vitrine', 'grupo 59 vitrine'), true);
  assert.strictEqual(ZapStorage._nomesCombinam('PromoHub - Baby #34 👶🏻', 'promohub baby 34'), true);
});

test('_nomesCombinam não confunde pessoas diferentes com o mesmo sobrenome', () => {
  assert.strictEqual(ZapStorage._nomesCombinam('João Silva', 'Maria Silva'), false);
});

test('_nomesCombinam aceita sobrenome isolado na lista', () => {
  assert.strictEqual(ZapStorage._nomesCombinam('João Silva', 'Silva'), true);
});
