const { test } = require('node:test');
const assert = require('node:assert');

require('./helpers/chrome-mock.js');
const ZapStorage = require('../modules/storage-manager.js');

test('defaults tem chaves de grupo e follow-up', () => {
  assert.strictEqual(ZapStorage.defaults.followup_minutes, 15);
  assert.strictEqual(ZapStorage.defaults.followup_max, 5);
  assert.deepStrictEqual(ZapStorage.defaults.monitored_groups, []);
  assert.ok(typeof ZapStorage.defaults.followup_message === 'string');
  assert.ok(ZapStorage.defaults.followup_message.length > 0);
  assert.deepStrictEqual(ZapStorage.defaults.conversations, {});
  assert.deepStrictEqual(ZapStorage.defaults.followups, {});
  assert.strictEqual(ZapStorage.defaults.me_phone, '');
  assert.strictEqual(ZapStorage.defaults.me_name, '');
});
