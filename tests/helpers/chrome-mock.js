/**
 * Mock em memória do chrome para testes Node (node --test).
 * Instale antes de qualquer require de módulo da extensão.
 */
const storage = new Map();

function read(keys) {
  const result = {};
  if (typeof keys === 'string') {
    result[keys] = storage.has(keys) ? storage.get(keys) : undefined;
    return result;
  }
  if (Array.isArray(keys)) {
    for (const k of keys) {
      result[k] = storage.has(k) ? storage.get(k) : undefined;
    }
    return result;
  }
  if (keys && typeof keys === 'object') {
    for (const [k, def] of Object.entries(keys)) {
      result[k] = storage.has(k) ? storage.get(k) : def;
    }
    return result;
  }
  return result;
}

global.chrome = {
  runtime: { id: 'test-extension-id' },
  storage: {
    local: {
      get(keys) {
        return Promise.resolve(read(keys));
      },
      set(obj) {
        for (const [k, v] of Object.entries(obj)) {
          storage.set(k, typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));
        }
        return Promise.resolve();
      },
      clear() {
        storage.clear();
        return Promise.resolve();
      }
    }
  }
};

module.exports = {
  reset() {
    storage.clear();
  },
  dump() {
    return Object.fromEntries(storage);
  }
};
