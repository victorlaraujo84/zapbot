const { test } = require('node:test');
const assert = require('node:assert');

require('./helpers/chrome-mock.js');
const AIResponder = require('../modules/ai-responder.js');

test('usa contexto salvo no lugar do histórico do DOM', async () => {
  let corpoEnviado = null;
  global.fetch = async (url, opts) => {
    corpoEnviado = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'resposta ok' } }] }) };
  };

  const settings = {
    ai_provider: 'deepseek',
    deepseek_api_key: 'k',
    ai_model: 'deepseek-chat',
    system_prompt: '',
    faq_context: ''
  };

  const r = await AIResponder.gerarResposta(
    'oi',
    ['Cliente: velho'],
    settings,
    ['Cliente: salvo1', 'Atendente: salvo2']
  );

  assert.strictEqual(r, 'resposta ok');
  const userContent = corpoEnviado.messages.find((m) => m.role === 'user').content;
  assert.ok(userContent.includes('salvo1'), 'deve conter mensagens salvas');
  assert.ok(!userContent.includes('velho'), 'não deve usar o histórico do DOM');
});

test('sem contexto salvo usa o histórico do DOM (comportamento atual)', async () => {
  let corpoEnviado = null;
  global.fetch = async (url, opts) => {
    corpoEnviado = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
  };

  const settings = {
    ai_provider: 'deepseek',
    deepseek_api_key: 'k',
    ai_model: 'deepseek-chat',
    system_prompt: '',
    faq_context: ''
  };

  await AIResponder.gerarResposta('oi', ['Cliente: dom'], settings, null);
  const userContent = corpoEnviado.messages.find((m) => m.role === 'user').content;
  assert.ok(userContent.includes('dom'));
});
