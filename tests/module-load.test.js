const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const NOMES = [
  ['modules/storage-manager.js', 'storage-manager'],
  ['modules/mention-detector.js', 'mention-detector'],
  ['modules/conversation-store.js', 'conversation-store'],
  ['modules/followup-engine.js', 'followup-engine'],
  ['modules/text-utils.js', 'text-utils'],
  ['modules/dedup-log.js', 'dedup-log'],
  ['modules/ai-responder.js', 'ai-responder'],
  ['content/whatsapp-driver.js', 'whatsapp-driver']
];

test('módulos da extensão carregam em contexto de navegador (sem module global)', () => {
  for (const [rel, nome] of NOMES) {
    const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    const ctx = { console, window: {} };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    assert.doesNotThrow(
      () => vm.runInContext(src, ctx, { filename: nome + '.js' }),
      `${nome} lançou ao carregar (module.exports sem guard?)`
    );
  }
});

test('text-utils expõe TextUtils.escapeHtml como global de navegador', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'modules', 'text-utils.js'), 'utf8');
  const ctx = { console, window: {} };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  assert.strictEqual(vm.runInContext('typeof TextUtils', ctx), 'object');
  assert.strictEqual(vm.runInContext('typeof TextUtils.escapeHtml', ctx), 'function');
  assert.strictEqual(vm.runInContext('TextUtils.escapeHtml("<b>")', ctx), '&lt;b&gt;');
});
