const { test } = require('node:test');
const assert = require('node:assert');

const MentionDetector = require('../modules/mention-detector.js');

test('nome exige arroba e aceita pontuação', () => {
  assert.equal(MentionDetector.detectar({ texto: '@ZapBot, ajuda' }, '', 'ZapBot'), 'mencao');
  assert.equal(MentionDetector.detectar({ texto: 'Oi ZapBot' }, '', 'ZapBot'), null);
});

test('menção numérica brasileira aceita ausência do DDI', () => {
  assert.equal(MentionDetector.detectar({ texto: '@11999999999' }, '5511999999999', ''), 'mencao');
});

test('detecta menção via lista de mentions do DOM', () => {
  const r = MentionDetector.detectar({ texto: 'oi', mentions: ['5521981353190'], autorQuote: null }, '5521981353190', '');
  assert.strictEqual(r, 'mencao');
});

test('detecta menção com telefone formatado no texto', () => {
  const r = MentionDetector.detectar({ texto: '@+55 21 98135-3190 socorro', mentions: [], autorQuote: null }, '5521981353190', '');
  assert.strictEqual(r, 'mencao');
});

test('detecta menção por nome no texto (caixa/acento)', () => {
  const r = MentionDetector.detectar({ texto: '@ZapBot me ajuda', mentions: [], autorQuote: null }, '', 'ZapBot');
  assert.strictEqual(r, 'mencao');
});

test('detecta resposta por citação com "Você"', () => {
  const r = MentionDetector.detectar({ texto: 'ok', mentions: [], autorQuote: 'Você' }, '', '');
  assert.strictEqual(r, 'resposta');
});

test('detecta resposta por citação com o nome do bot', () => {
  const r = MentionDetector.detectar({ texto: 'ok', mentions: [], autorQuote: 'Meu Nome' }, '', 'Meu Nome');
  assert.strictEqual(r, 'resposta');
});

test('retorna null sem menção nem resposta', () => {
  const r = MentionDetector.detectar({ texto: 'bom dia', mentions: [], autorQuote: null }, '5521981353190', '');
  assert.strictEqual(r, null);
});

test('citação de "Mariana" não conta como resposta para o bot "Ana"', () => {
  const r = MentionDetector.detectar({ texto: 'ok', mentions: [], autorQuote: 'Mariana' }, '', 'Ana');
  assert.strictEqual(r, null);
});

test('normalizarTelefone extrai só dígitos', () => {
  assert.strictEqual(MentionDetector.normalizarTelefone('+55 (21) 98135-3190'), '5521981353190');
  assert.strictEqual(MentionDetector.normalizarTelefone('5521981353190@c.us'), '5521981353190');
});
