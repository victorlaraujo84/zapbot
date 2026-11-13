/**
 * ConversationStore - Armazena conversas por contato/grupo com dedup e poda.
 * Funções puras: recebem e devolvem o objeto `conversas` (chave -> entrada).
 */
const ConversationStore = {
  /**
   * Anexa mensagens novas a uma conversa, sem duplicar.
   * @param {object} conversas { [chave]: { messages: [{from,text,ts}], updatedAt } }
   * @param {string} chave
   * @param {Array<{from:'client'|'bot', text:string, ts:number}>} novas
   * @returns {object} conversas (mutado)
   */
  anexar(conversas, chave, novas) {
    if (!conversas || !chave || !Array.isArray(novas) || novas.length === 0) return conversas;

    const limpas = [];
    for (const nova of novas) {
      if (!nova || typeof nova.text !== 'string') continue;
      const texto = nova.text.trim();
      if (!texto) continue;
      limpas.push({ from: nova.from === 'bot' ? 'bot' : 'client', text: texto, ts: nova.ts || 0 });
    }
    if (limpas.length === 0) return conversas;

    const entrada = conversas[chave] || { messages: [], updatedAt: 0 };
    const guardadas = entrada.messages;

    // Maior sobreposição: sufixo das guardadas == prefixo das novas (por from+text).
    // Necessário porque varreduras repetidas releem a mesma janela com ts novo.
    let sobreposicao = 0;
    const maxSobre = Math.min(guardadas.length, limpas.length);
    for (let k = maxSobre; k > 0; k--) {
      const sufixo = guardadas.slice(-k);
      const prefixo = limpas.slice(0, k);
      const igual = sufixo.every((m, i) => m.from === prefixo[i].from && m.text === prefixo[i].text);
      if (igual) {
        sobreposicao = k;
        break;
      }
    }

    const aAdicionar = limpas.slice(sobreposicao);
    if (aAdicionar.length === 0) return conversas;

    entrada.messages = guardadas.concat(aAdicionar);
    for (const m of aAdicionar) {
      if (m.ts > entrada.updatedAt) entrada.updatedAt = m.ts;
    }
    conversas[chave] = entrada;
    return conversas;
  },

  /**
   * Poda o store: máx. mensagens por conversa e máx. conversas (mais antigas saem).
   * @param {object} conversas
   * @param {{maxMsgs?:number, maxConversas?:number}} opts
   * @returns {object} conversas (mutado)
   */
  podar(conversas, opts = {}) {
    if (!conversas) return conversas;
    const maxMsgs = opts.maxMsgs || 30;
    const maxConversas = opts.maxConversas || 200;

    for (const chave of Object.keys(conversas)) {
      const entrada = conversas[chave];
      if (entrada && entrada.messages && entrada.messages.length > maxMsgs) {
        entrada.messages = entrada.messages.slice(-maxMsgs);
      }
    }

    const chaves = Object.keys(conversas);
    if (chaves.length > maxConversas) {
      chaves
        .sort((a, b) => (conversas[a].updatedAt || 0) - (conversas[b].updatedAt || 0))
        .slice(0, chaves.length - maxConversas)
        .forEach((k) => delete conversas[k]);
    }

    return conversas;
  },

  /**
   * Últimas n mensagens formatadas para o prompt da IA.
   * @param {object} conversas
   * @param {string} chave
   * @param {number} n
   * @returns {string[]} ['Cliente: ...', 'Atendente: ...']
   */
  ultimas(conversas, chave, n = 20) {
    const entrada = conversas && conversas[chave];
    if (!entrada || !entrada.messages || !entrada.messages.length) return [];
    return entrada.messages
      .slice(-n)
      .map((m) => `${m.from === 'bot' ? 'Atendente' : 'Cliente'}: ${m.text}`);
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ConversationStore;
}
