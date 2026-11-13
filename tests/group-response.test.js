const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const MentionDetector = require('../modules/mention-detector');
const { WADriver } = require('../content/whatsapp-driver');

test('confirma balão de saída renderizado sem data-pre-plain-text e com quebras diferentes', (t) => {
  const texto = { innerText: 'Olá!\nTudo bem?\u00a0' };
  const balão = {
    getAttribute: (nome) => nome === 'data-id' ? 'true_123@g.us_msg' : null,
    querySelector: () => texto
  };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    value: { querySelector: () => ({ querySelectorAll: () => [balão] }) }, configurable: true
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor);
    else delete globalThis.document;
  });
  const chave = 'true_123@g.us_msg';
  assert.equal(WADriver.mensagemDeSaidaConfirmada('Olá!\r\n\r\nTudo bem?', new Set()), true);
  assert.equal(WADriver.mensagemDeSaidaConfirmada('Olá!\r\nTudo bem?', new Set([chave])), false);
});

test('identifica grupo pelo botão Dados do grupo sem ID nem subtítulo', (t) => {
  const botao = { getAttribute: (nome) => nome === 'aria-label' ? 'Dados do grupo' : null };
  const header = {
    innerText: 'TESTE',
    querySelector: (seletor) => seletor === '[data-testid="conversation-info-header-button"]' ? botao : null
  };
  const main = { querySelector: () => header, querySelectorAll: () => [] };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    value: { querySelector: (seletor) => seletor === '#main' ? main : header }, configurable: true
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor);
    else delete globalThis.document;
  });
  assert.deepEqual(WADriver.capturarDestino('TESTE')?.grupo, { isGroup: true, groupId: null });
});

test('identifica o título visível do grupo quando apenas os participantes têm atributo title', (t) => {
  const header = {
    innerText: 'TESTE\nParticipante, Você',
    querySelectorAll: () => [{ getAttribute: () => 'Participante, Você' }]
  };
  t.mock.method(WADriver, 'obterGrupoDoChatAtivo', () => ({ isGroup: true, groupId: '123' }));
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    value: { querySelector: () => header }, configurable: true
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor);
    else delete globalThis.document;
  });

  assert.equal(WADriver.obterContatoAtivo(), 'TESTE');
  assert.equal(WADriver.capturarDestino('TESTE')?.grupo.groupId, '123');
  assert.equal(WADriver.capturarDestino('Participante, Você'), null);
});

test('troca de chat durante a preparação impede o clique de envio', async (t) => {
  let verificacoes = 0;
  let cliques = 0;
  const input = {
    textContent: '', isConnected: true, focus() {}, dispatchEvent() {}
  };
  const btn = { closest: () => null, click: () => cliques++ };
  t.mock.method(WADriver, 'queryEl', async (key) => key === 'composeBox' ? input : btn);
  t.mock.method(WADriver, 'obterMensagensAtuais', () => []);
  const globals = { document: { execCommand() {}, querySelector: () => null }, InputEvent: class {} };
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

test('comando do painel espera o atendimento terminar antes de abrir outro chat', async () => {
  let listener;
  let finalizar;
  const eventos = [];
  const ctx = vm.createContext({
    window: { addEventListener() {} },
    document: {},
    chrome: { runtime: { onMessage: { addListener: (fn) => { listener = fn; } } } },
    setTimeout: (fn) => fn(),
    WADriver: { navegarParaConversa: () => eventos.push('abriu') },
    atendimento: new Promise((resolve) => { finalizar = resolve; })
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../content/content.js'), 'utf8'), ctx);
  vm.runInContext('cicloDeAtendimento = atendimento', ctx);
  listener({ action: 'OPEN_CHAT', payload: { phone: '5511999999999' } }, {}, () => {});
  await new Promise(setImmediate);
  assert.deepEqual(eventos, []);
  finalizar();
  await new Promise(setImmediate);
  assert.deepEqual(eventos, ['abriu']);
});
