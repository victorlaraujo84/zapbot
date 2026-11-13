const { test } = require('node:test');
const assert = require('node:assert');

const { escapeHtml } = require('../modules/text-utils.js');

test('escapeHtml neutraliza tags e entidades', () => {
  assert.strictEqual(
    escapeHtml('<img src=x onerror=alert(1)>'),
    '&lt;img src=x onerror=alert(1)&gt;'
  );
  assert.strictEqual(escapeHtml('a & b "c" \'d\''), 'a &amp; b &quot;c&quot; &#39;d&#39;');
  assert.strictEqual(escapeHtml(''), '');
});
