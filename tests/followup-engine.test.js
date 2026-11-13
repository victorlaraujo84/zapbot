const { test } = require('node:test');
const assert = require('node:assert');

const FollowupEngine = require('../modules/followup-engine.js');

const cfg = { minutos: 15, maxCobrancas: 5, mensagem: 'M' };

test('criarOuRenovar cria com vencimento = agora + X min e cobrancas 0', () => {
  const f = FollowupEngine.criarOuRenovar({}, 'g:x', 1000, cfg);
  assert.strictEqual(f['g:x'].vencimentoMs, 1000 + 15 * 60000);
  assert.strictEqual(f['g:x'].cobrancas, 0);
});

test('avaliar antes do vencimento sem resposta → esperar', () => {
  const f = FollowupEngine.criarOuRenovar({}, 'g:x', 1000, cfg);
  const r = FollowupEngine.avaliar(f, 'g:x', 999, false, cfg);
  assert.strictEqual(r.acao, 'esperar');
  assert.ok(f['g:x']);
});

test('avaliar após vencimento sem resposta → enviar + reagendar', () => {
  const f = FollowupEngine.criarOuRenovar({}, 'g:x', 1000, cfg);
  const r = FollowupEngine.avaliar(f, 'g:x', 901000, false, cfg);
  assert.strictEqual(r.acao, 'enviar');
  assert.strictEqual(r.mensagem, 'M');
  assert.strictEqual(f['g:x'].cobrancas, 1);
  assert.strictEqual(f['g:x'].vencimentoMs, 901000 + 15 * 60000);
});

test('avaliar com resposta → limpar (chave removida)', () => {
  const f = FollowupEngine.criarOuRenovar({}, 'g:x', 1000, cfg);
  const r = FollowupEngine.avaliar(f, 'g:x', 5000, true, cfg);
  assert.strictEqual(r.acao, 'limpar');
  assert.strictEqual(f['g:x'], undefined);
});

test('teto de cobranças: 5º ciclo envia, 6º limpa', () => {
  let f = FollowupEngine.criarOuRenovar({}, 'g:x', 0, cfg);
  let ultimaAcao = null;
  for (let i = 0; i < 6; i++) {
    const agora = (f['g:x'] && f['g:x'].vencimentoMs) || 0;
    const r = FollowupEngine.avaliar(f, 'g:x', agora, false, cfg);
    ultimaAcao = r.acao;
    f = r.followups;
    if (i < 5) assert.strictEqual(r.acao, 'enviar', `ciclo ${i + 1}`);
  }
  assert.strictEqual(ultimaAcao, 'limpar');
  assert.strictEqual(f['g:x'], undefined);
});

test('criarOuRenovar reinicia cobranças após ciclo novo', () => {
  let f = FollowupEngine.criarOuRenovar({}, 'g:x', 1000, cfg);
  const r = FollowupEngine.avaliar(f, 'g:x', 901000, false, cfg);
  assert.strictEqual(r.followups['g:x'].cobrancas, 1);
  const f2 = FollowupEngine.criarOuRenovar(r.followups, 'g:x', 2000, cfg);
  assert.strictEqual(f2['g:x'].cobrancas, 0);
  assert.strictEqual(f2['g:x'].ultimaMsgBotMs, 2000);
});

test('avaliar sem entrada → esperar', () => {
  const r = FollowupEngine.avaliar({}, 'g:y', 1000, false, cfg);
  assert.strictEqual(r.acao, 'esperar');
});

test('deveVerificar: não vencido e sem não-lida → false', () => {
  assert.strictEqual(FollowupEngine.deveVerificar({ vencimentoMs: 900000 }, 1000, false), false);
});

test('deveVerificar: vencido → true; não vencido com badge → true', () => {
  assert.strictEqual(FollowupEngine.deveVerificar({ vencimentoMs: 900000 }, 900000, false), true);
  assert.strictEqual(FollowupEngine.deveVerificar({ vencimentoMs: 900000 }, 1000, true), true);
});

test('confirmarGrupoAlvo exige grupo e valida groupId quando conhecido', () => {
  assert.strictEqual(FollowupEngine.confirmarGrupoAlvo({ isGroup: false, groupId: null }, {}), false);
  assert.strictEqual(FollowupEngine.confirmarGrupoAlvo({ isGroup: true, groupId: '1' }, { groupId: '2' }), false);
  assert.strictEqual(FollowupEngine.confirmarGrupoAlvo({ isGroup: true, groupId: '1' }, { groupId: '1' }), true);
  assert.strictEqual(FollowupEngine.confirmarGrupoAlvo({ isGroup: true, groupId: null }, {}), true);
});
