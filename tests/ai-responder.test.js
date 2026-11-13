const { test } = require('node:test');
const assert = require('node:assert');

require('./helpers/chrome-mock.js');
const AIResponder = require('../modules/ai-responder.js');

test('pedido atual e citação chegam como campos separados à IA', async (t) => {
  const provedor = t.mock.method(AIResponder, 'chamarDeepSeek', async () => 'ok');
  const settings = { ai_provider: 'deepseek' };
  await AIResponder.gerarResposta('@ZapBot, o que verifico?', ['Cliente: outro assunto'], settings, null,
    { autor: 'Ana', texto: 'A VPN parou após a troca de senha' });
  const [, sistema, prompt] = provedor.mock.calls[0].arguments;
  assert.match(sistema, /pedido atual/i);
  assert.match(prompt, /"pedidoAtual":"@ZapBot, o que verifico\?"/);
  assert.match(prompt, /"citacao":\{"autor":"Ana","texto":"A VPN parou após a troca de senha"\}/);
  await AIResponder.gerarResposta('@ZapBot, pode ajudar?', [], settings, null, { autor: 'Ana', texto: null });
  assert.match(provedor.mock.calls[1].arguments[1], /peça o detalhe/i);
});

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
