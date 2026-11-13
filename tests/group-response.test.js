const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const MentionDetector = require('../modules/mention-detector');
const { WADriver } = require('../content/whatsapp-driver');

test('troca de chat durante a preparação impede o clique de envio', async (t) => {
  let verificacoes = 0;
  let cliques = 0;
  const input = {
    textContent: '', isConnected: true, focus() {}, dispatchEvent() {}
  };
  const btn = { closest: () => null, click: () => cliques++ };
  t.mock.method(WADriver, 'queryEl', async (key) => key === 'composeBox' ? input : btn);
  t.mock.method(WADriver, 'obterMensagensAtuais', () => []);
  const globals = { document: { execCommand() {} }, InputEvent: class {} };
  for (const [key, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true });
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    });
  }
  await assert.rejects(WADriver.enviarMensagemTexto('Resposta', () => ++verificacoes < 3), /chat ativo mudou/);
  assert.equal(cliques, 0);
});

test('grupo monitorado com lista vazia responde à menção anterior e tenta novamente sem badge', async () => {
  let unread = true;
  let attempts = 0;
  const sent = [];
  const title = { getAttribute: () => 'Grupo Suporte' };
  const messages = [
    { id: 'm1', texto: '@ZapBot, ajuda', isMe: false },
    { id: 'm2', texto: 'Outra mensagem', isMe: false }
  ];
  const ctx = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    window: { addEventListener() {} },
    document: { querySelectorAll: () => [title], addEventListener() {} },
    chrome: { runtime: { onMessage: { addListener() {} } } },
    setTimeout: (fn) => fn(),
    MentionDetector,
    DedupLog: { nova: () => true },
    ConversationStore: { ultimas: () => [] },
    ZapStorage: {
      getMonitoredGroups: async () => [{ name: 'Grupo Suporte' }],
      nomesDeGrupoIguais: (a, b) => a === b,
      checkAIAuthorization: async (_, opts) => opts?.isGroup
        ? { allowed: true }
        : { allowed: false, code: 'contact_list', reason: 'lista vazia' },
      getSettings: async () => ({}),
      addLog: async () => {}
    },
    WADriver: {
      _getSelector: () => null,
      queryElSync: () => title,
      temMensagemNaoLida: () => unread,
      contarNaoLidas: () => 2,
      abrirChatDoFrame: async () => { unread = false; return true; },
      obterContatoAtivo: () => null,
      obterGrupoDoChatAtivo: () => ({ isGroup: true, groupId: '123' }),
      capturarDestino: () => ({ grupo: { isGroup: true, groupId: '123' } }),
      destinoConfere: () => true,
      obterMensagensAtuais: () => messages,
      dadosDaMensagem: (_, texto) => ({ texto }),
      fecharChatAtivo() {}
    },
    send: async (texto) => {
      if (++attempts === 1) throw new Error('falha temporária');
      sent.push(texto);
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../content/content.js'), 'utf8'), ctx);
  vm.runInContext(`
    showToast = () => {};
    anexarHistoricoNaConversa = async () => ({});
    armarFollowupDoGrupo = async () => {};
    processarAutoRespostaIA = (_, texto) => send(texto);
  `, ctx);
  for (let i = 0; i < 3; i++) {
    await vm.runInContext("varreduraChatsNaoLidos({ me_name: 'ZapBot' })", ctx);
  }
  assert.equal(attempts, 2);
  assert.deepEqual(sent, ['@ZapBot, ajuda']);
});
