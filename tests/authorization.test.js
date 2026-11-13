const { test } = require('node:test');
const assert = require('node:assert');

const mock = require('./helpers/chrome-mock.js');
const ZapStorage = require('../modules/storage-manager.js');

async function seed() {
  mock.reset();
  await ZapStorage.set({
    ai_enabled: true,
    active_ai_list_id: 'L1',
    lists: [
      {
        id: 'L1',
        name: 'lista',
        contacts: [
          { phone: '5521981353190', name: 'Soraggi Solor' },
          { phone: '5521987508657', name: 'Jon' }
        ]
      }
    ],
    monitored_groups: [{ id: 'g1', name: 'Grupo Suporte', enabled: true }],
    campaign: { contacts: [{ phone: '5521980995880', name: 'Soraia' }], is_running: false },
    human_interventions: {}
  });
}

test('grupo monitorado é autorizado por nome fuzzy', async () => {
  await seed();
  const r = await ZapStorage.checkAIAuthorization(['Grupo Suporte!'], { isGroup: true });
  assert.strictEqual(r.allowed, true);
  assert.match(r.reason, /grupo monitorado/);
});

test('grupo não monitorado é negado', async () => {
  await seed();
  const r = await ZapStorage.checkAIAuthorization(['Outro Grupo'], { isGroup: true });
  assert.strictEqual(r.allowed, false);
  assert.match(r.reason, /grupo monitorado/);
});

test('grupo com ID diferente é negado mesmo com nome parecido', async () => {
  await seed();
  await ZapStorage.set({ monitored_groups: [{ name: 'Suporte Norte', groupId: '123' }] });
  const result = await ZapStorage.checkAIAuthorization(['Suporte Sul', '456'], {
    isGroup: true, groupId: '456'
  });
  assert.equal(result.allowed, false);
});

test('contato fora da lista ativa mas na campanha é autorizado (caso "Soraia S2")', async () => {
  await seed();
  const r = await ZapStorage.checkAIAuthorization(['Soraia S2']);
  assert.strictEqual(r.allowed, true);
  assert.match(r.reason, /campanha/);
});

test('contato fora da lista e da campanha é negado', async () => {
  await seed();
  const r = await ZapStorage.checkAIAuthorization(['Desconhecido Silva']);
  assert.strictEqual(r.allowed, false);
});

test('ai_enabled false nega grupo e contato', async () => {
  await seed();
  await ZapStorage.set({ ai_enabled: false });
  const rg = await ZapStorage.checkAIAuthorization(['Grupo Suporte'], { isGroup: true });
  assert.strictEqual(rg.allowed, false);
  const rc = await ZapStorage.checkAIAuthorization(['Jon']);
  assert.strictEqual(rc.allowed, false);
});

test('getMonitoredGroups retorna só os habilitados', async () => {
  await seed();
  await ZapStorage.set({
    monitored_groups: [
      { id: 'g1', name: 'Grupo Suporte', enabled: true },
      { id: 'g2', name: 'Grupo Off', enabled: false }
    ]
  });
  const grupos = await ZapStorage.getMonitoredGroups();
  assert.strictEqual(grupos.length, 1);
  assert.strictEqual(grupos[0].name, 'Grupo Suporte');
});

test('getMonitoredGroups inclui contato tipo grupo da lista ativa (união)', async () => {
  await seed();
  await ZapStorage.set({
    lists: [
      {
        id: 'L1',
        name: 'lista',
        contacts: [
          { phone: '5521981353190', name: 'Soraggi Solor' },
          { phone: '', name: 'Suporte Local', type: 'group' }
        ]
      }
    ]
  });
  const grupos = await ZapStorage.getMonitoredGroups();
  const nomes = grupos.map((g) => g.name);
  assert.ok(nomes.includes('Suporte Local'));
  assert.ok(nomes.includes('Grupo Suporte'));
});

test('grupo da lista ativa autoriza quando o chat é grupo', async () => {
  await seed();
  await ZapStorage.set({
    lists: [
      {
        id: 'L1',
        name: 'lista',
        contacts: [
          { phone: '5521981353190', name: 'Soraggi Solor' },
          { phone: '', name: 'Suporte Local', type: 'group' }
        ]
      }
    ]
  });
  const r = await ZapStorage.checkAIAuthorization(['Suporte Local!'], { isGroup: true });
  assert.strictEqual(r.allowed, true);
  assert.match(r.reason, /grupo monitorado/);
});
