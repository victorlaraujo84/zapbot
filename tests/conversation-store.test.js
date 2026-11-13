const { test } = require('node:test');
const assert = require('node:assert');

const ConversationStore = require('../modules/conversation-store.js');

test('anexar não duplica a mesma mensagem (text+ts)', () => {
  const c = {};
  ConversationStore.anexar(c, 'a', [{ from: 'client', text: 'oi', ts: 1000 }]);
  ConversationStore.anexar(c, 'a', [{ from: 'client', text: 'oi', ts: 1000 }]);
  assert.strictEqual(c.a.messages.length, 1);
});

test('anexar preserva ordem e atualiza updatedAt', () => {
  const c = {};
  ConversationStore.anexar(c, 'a', [{ from: 'client', text: 'x', ts: 1 }]);
  ConversationStore.anexar(c, 'a', [{ from: 'bot', text: 'y', ts: 2 }]);
  assert.deepStrictEqual(c.a.messages.map((m) => m.text), ['x', 'y']);
  assert.strictEqual(c.a.updatedAt, 2);
});

test('podar mantém só as 30 últimas mensagens por conversa', () => {
  const c = {};
  const muitas = Array.from({ length: 35 }, (_, i) => ({ from: 'client', text: `m${i}`, ts: i }));
  ConversationStore.anexar(c, 'a', muitas);
  ConversationStore.podar(c, { maxMsgs: 30, maxConversas: 200 });
  assert.strictEqual(c.a.messages.length, 30);
  assert.strictEqual(c.a.messages[0].text, 'm5');
  assert.strictEqual(c.a.messages[29].text, 'm34');
});

test('podar remove a conversa mais antiga acima do limite', () => {
  const c = {
    velha: { messages: [{ from: 'client', text: 'v', ts: 1 }], updatedAt: 1 },
    nova: { messages: [{ from: 'client', text: 'n', ts: 2 }], updatedAt: 2 }
  };
  ConversationStore.podar(c, { maxMsgs: 30, maxConversas: 1 });
  assert.strictEqual(c.velha, undefined);
  assert.ok(c.nova);
});

test('ultimas retorna as últimas n formatadas em ordem cronológica', () => {
  const c = {};
  ConversationStore.anexar(c, 'a', [
    { from: 'client', text: 'x', ts: 1 },
    { from: 'bot', text: 'y', ts: 2 },
    { from: 'client', text: 'z', ts: 3 }
  ]);
  const r = ConversationStore.ultimas(c, 'a', 2);
  assert.deepStrictEqual(r, ['Atendente: y', 'Cliente: z']);
});

test('anexar sem novas mensagens não altera nada', () => {
  const c = {};
  ConversationStore.anexar(c, 'a', []);
  assert.strictEqual(c.a, undefined);
});

test('anexar janelas sobrepostas (nova varredura, ts novo) não duplica', () => {
  const c = {};
  ConversationStore.anexar(c, 'a', [
    { from: 'client', text: 'x', ts: 1 },
    { from: 'bot', text: 'y', ts: 2 }
  ]);
  // Nova varredura: mesmas mensagens com ts atual + uma nova
  ConversationStore.anexar(c, 'a', [
    { from: 'client', text: 'x', ts: 100 },
    { from: 'bot', text: 'y', ts: 101 },
    { from: 'client', text: 'z', ts: 102 }
  ]);
  assert.deepStrictEqual(c.a.messages.map((m) => m.text), ['x', 'y', 'z']);
  assert.strictEqual(c.a.messages.length, 3);
});
