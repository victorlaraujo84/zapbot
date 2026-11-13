const { test } = require('node:test');
const assert = require('node:assert');

const { WADriver } = require('../content/whatsapp-driver.js');

test('parseDataIdGrupo extrai o id de data-id de grupo', () => {
  assert.deepStrictEqual(WADriver.parseDataIdGrupo('false_12036301234567890@g.us_ABC'), { groupId: '12036301234567890' });
});

test('parseDataIdGrupo retorna null para chat individual', () => {
  assert.strictEqual(WADriver.parseDataIdGrupo('true_5511981353190@c.us_X'), null);
});

test('parseDataIdGrupo retorna null para vazio', () => {
  assert.strictEqual(WADriver.parseDataIdGrupo(''), null);
});

test('parseDataIdGrupo aceita id de grupo antigo com hífen', () => {
  assert.deepStrictEqual(WADriver.parseDataIdGrupo('false_123456789-123456@g.us_X'), {
    groupId: '123456789-123456'
  });
});

test('extrairGrupoDeAtributos acha @g.us entre vários atributos', () => {
  assert.deepStrictEqual(
    WADriver.extrairGrupoDeAtributos(['false_5511@c.us_X', 'false_12036301234567890@g.us_Y']),
    { groupId: '12036301234567890' }
  );
});

test('extrairGrupoDeAtributos retorna null sem grupo', () => {
  assert.strictEqual(WADriver.extrairGrupoDeAtributos(['true_5511@c.us_X', '']), null);
  assert.strictEqual(WADriver.extrairGrupoDeAtributos([]), null);
});

test('subtituloIndicaGrupo detecta lista de membros e contagem', () => {
  assert.strictEqual(WADriver.subtituloIndicaGrupo('João, Maria, Pedro'), true);
  assert.strictEqual(WADriver.subtituloIndicaGrupo('5 participantes'), true);
  assert.strictEqual(WADriver.subtituloIndicaGrupo('online'), false);
});
