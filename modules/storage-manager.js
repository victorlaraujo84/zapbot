/**
 * ZapStorage - Gerenciador centralizado de armazenamento (chrome.storage.local)
 * Funciona de forma compatível e resiliente em Content Scripts, Service Worker e Side Panel.
 */
const ZapStorage = {
  // Chaves padrão e valores iniciais
  defaults: {
    ai_enabled: false,
    ai_provider: 'deepseek', // 'deepseek' (principal), 'gemini' ou 'openai'
    gemini_api_key: '',
    openai_api_key: '',
    deepseek_api_key: '',
    ai_model: 'deepseek-chat',
    system_prompt: 'Você é um assistente virtual atencioso e profissional no WhatsApp. Responda de forma clara, natural, humanizada e concisa (máximo 2 a 3 frases por mensagem). Tire dúvidas e oriente o cliente com simpatia.',
    faq_context: '',
    active_ai_list_id: 'all', // 'all' ou ID de uma lista específica
    cooldown_minutes: 10, // Pausa da IA se o usuário responder manualmente
    min_delay: 6, // Segundos mínimos entre mensagens
    max_delay: 15, // Segundos máximos entre mensagens
    lists: [
      {
        id: 'default',
        name: 'Geral',
        contacts: []
      }
    ],
    history_logs: [],
    human_interventions: {}, // { [telefone]: timestamp }
    campaign: {
      is_running: false,
      is_paused: false,
      current_index: 0,
      contacts: [],
      message_template: '',
      sent_count: 0,
      failed_count: 0
    },
    selectors: {}, // Vazio = usa SELECTORS_DEFAULTS do WADriver. Preenchido pelo editor de seletores.
    // Grupos monitorados + temporizador de cobrança (fluxo de suporte)
    monitored_groups: [], // [{ id, name, enabled, groupId }]
    me_phone: '', // Meu número (DDI) — usado para detectar @menção
    me_name: '', // Meu nome (opcional) — detecta menção por nome no texto
    followup_minutes: 15, // Cobrar retorno a cada X minutos sem resposta
    followup_max: 5, // Teto de cobranças por chamado
    followup_message: '⚠️ Só confirmando: ainda precisa de ajuda com o chamado? Aguardo seu retorno.',
    conversations: {}, // { [chave]: { messages: [{from, text, ts}], updatedAt } }
    followups: {} // { [chaveGrupo]: { ultimaMsgBotMs, vencimentoMs, cobrancas } }
  },

  /**
   * Verifica se o contexto da extensão ainda é válido
   * Evita erros de "Extension context invalidated" quando a extensão é recarregada
   */
  isContextValid() {
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime) return false;
      if (!chrome.runtime.id) return false;
      if (!chrome.storage || !chrome.storage.local) return false;
      return true;
    } catch (e) {
      return false;
    }
  },

  /**
   * Clona profundamente um valor (evita que mutações retornem como referência aos padrões).
   */
  _clone(value) {
    try {
      if (typeof structuredClone === 'function') return structuredClone(value);
    } catch (_) { /* cai para o fallback */ }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_) {
      return value;
    }
  },

  /**
   * Obtém todas as configurações mescladas com os padrões (cópias independentes)
   */
  async getSettings() {
    const clonedDefaults = ZapStorage._clone(ZapStorage.defaults);
    try {
      if (!ZapStorage.isContextValid()) {
        return clonedDefaults;
      }
      const items = await chrome.storage.local.get(clonedDefaults);
      return { ...clonedDefaults, ...(items || {}) };
    } catch (err) {
      return clonedDefaults;
    }
  },

  /**
   * Obtém uma chave específica (cópia independente do valor padrão)
   */
  async get(key) {
    const defaultVal = ZapStorage._clone(ZapStorage.defaults[key]);
    try {
      if (!ZapStorage.isContextValid()) {
        return defaultVal;
      }
      const items = await chrome.storage.local.get({ [key]: defaultVal });
      return items && items[key] !== undefined ? items[key] : defaultVal;
    } catch (err) {
      return defaultVal;
    }
  },

  /**
   * Salva uma ou mais configurações
   */
  async set(data) {
    try {
      if (!ZapStorage.isContextValid() || !data) {
        return;
      }
      await chrome.storage.local.set(data);
    } catch (err) {
      // Silencia erros de gravação em contexto invalidado
    }
  },

  /**
   * Adiciona um registro ao histórico de logs (mantém os últimos 100)
   */
  async addLog(type, phone, message, status = 'success') {
    if (!ZapStorage.isContextValid()) return null;

    try {
      const logs = (await ZapStorage.get('history_logs')) || [];
      const newLog = {
        id: Date.now().toString(),
        timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        date: new Date().toLocaleDateString('pt-BR'),
        type, // 'AI_RESPONSE', 'BULK_SEND', 'GROUP_EXTRACT', 'SYSTEM'
        phone: phone || '-',
        message: (message || '').substring(0, 180),
        status // 'success', 'warning', 'error'
      };
      logs.unshift(newLog);
      if (logs.length > 100) logs.pop();
      await ZapStorage.set({ history_logs: logs });
      return newLog;
    } catch (err) {
      console.warn('[ZapStorage] Erro ao adicionar log:', err);
      return null;
    }
  },

  /**
   * Normaliza o identificador de um contato.
   * Se houver dígitos (telefone), usa apenas os dígitos; caso contrário,
   * usa o nome em minúsculas (contatos salvos na agenda não têm telefone no título).
   */
  normalizeContactId(value) {
    const raw = (value || '').toString().trim();
    const digits = raw.replace(/\D/g, '');
    return digits || raw.toLowerCase();
  },

  /**
   * Registra intervenção humana em uma conversa (pausa IA temporariamente)
   */
  async registerHumanIntervention(phone) {
    const cleanKey = ZapStorage.normalizeContactId(phone);
    if (!cleanKey || !ZapStorage.isContextValid()) return;

    try {
      const interventions = (await ZapStorage.get('human_interventions')) || {};
      interventions[cleanKey] = Date.now();

      // Poda entradas antigas para evitar crescimento ilimitado no storage
      const chaves = Object.keys(interventions);
      if (chaves.length > 300) {
        chaves
          .sort((a, b) => interventions[a] - interventions[b])
          .slice(0, chaves.length - 300)
          .forEach((k) => delete interventions[k]);
      }

      await ZapStorage.set({ human_interventions: interventions });
    } catch (err) {
      console.warn('[ZapStorage] Erro ao registrar intervenção humana:', err);
    }
  },

  /**
   * Verifica se a IA está pausada para esse contato devido a intervenção humana
   */
  async isHumanCooldownActive(phone) {
    const cleanKey = ZapStorage.normalizeContactId(phone);
    if (!cleanKey || !ZapStorage.isContextValid()) return false;

    try {
      const settings = await ZapStorage.getSettings();
      const interventions = settings.human_interventions || {};
      const lastIntervention = interventions[cleanKey];
      if (!lastIntervention) return false;

      const cooldownMs = (settings.cooldown_minutes || 10) * 60 * 1000;
      const diff = Date.now() - lastIntervention;
      return diff < cooldownMs;
    } catch (err) {
      return false;
    }
  },

  /**
   * Normaliza um nome para comparação: sem acentos, minúsculo, sem emojis/símbolos.
   * Ex.: "~João  Silva 🚀" -> "joao silva"
   */
  _normalizeName(value) {
    return (value || '')
      .toString()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  },

  /**
   * Compara dois números de telefone já normalizados (somente dígitos).
   * Tolera: DDI (código do país), nono dígito e números salvos sem DDI.
   */
  _numerosCombinam(digitosA, digitosB) {
    if (!digitosA || !digitosB) return false;
    if (digitosA === digitosB) return true;

    // Um é sufixo do outro (tolera DDI na frente de um dos lados)
    if (digitosA.endsWith(digitosB) || digitosB.endsWith(digitosA)) return true;

    // Compara finais de 8 e 9 dígitos (tolera DDI + nono dígito)
    for (const tamanho of [8, 9]) {
      const a = digitosA.slice(-tamanho);
      const b = digitosB.slice(-tamanho);
      if (a.length === tamanho && b.length === tamanho && a === b) return true;
    }

    return false;
  },

  /**
   * Compara dois nomes já normalizados (sem acentos, minúsculos, sem símbolos).
   * Tolera: caixa/acentos, nome composto vs. abreviado, primeiro/último nome isolado.
   */
  _nomesCombinam(nomeA, nomeB) {
    const a = ZapStorage._normalizeName(nomeA);
    const b = ZapStorage._normalizeName(nomeB);
    if (!a || !b) return false;
    if (a === b) return true;

    const pa = a.split(' ').filter(Boolean);
    const pb = b.split(' ').filter(Boolean);
    if (pa.length === 0 || pb.length === 0) return false;

    // Primeiro nome igual (ex.: "João" na lista x "João Silva" no WhatsApp)
    if (pa[0].length >= 2 && pa[0] === pb[0]) return true;

    // Um lado é uma única palavra e aparece no outro (primeiro nome, último nome ou sobrenome isolado)
    if (pa.length === 1 && pa[0].length >= 2 && pb.includes(pa[0])) return true;
    if (pb.length === 1 && pb[0].length >= 2 && pa.includes(pb[0])) return true;

    // Um lado é subconjunto das palavras do outro (nome composto/abreviado)
    const menor = pa.length <= pb.length ? pa : pb;
    const maior = menor === pa ? pb : pa;
    if (menor.every((p) => p.length >= 2 && maior.includes(p))) return true;

    return false;
  },

  /**
   * Compara um identificador vindo do WhatsApp (nome ou telefone) com um contato da lista.
   * Aceita: telefone igual/sufixo, nome igual, primeiro/último nome igual ou nome contido.
   */
  _contatoCombina(identificador, contato) {
    if (!contato || contato.type === 'group') return false;

    const digitosAlvo = (identificador || '').toString().replace(/\D/g, '');
    const digitosContato = (contato.phone || '').toString().replace(/\D/g, '');

    // 1) Telefone (tolera DDI, nono dígito e número salvo sem DDI)
    if (digitosAlvo && digitosContato && ZapStorage._numerosCombinam(digitosAlvo, digitosContato)) {
      return true;
    }

    // 2) Nome (tolera acentos, caixa, ordem das palavras e nome isolado)
    return ZapStorage._nomesCombinam(identificador, contato.name);
  },

  /**
   * União de grupos a monitorar: seção "Grupos monitorados" (habilitados)
   * + contatos tipo 'group' da lista ativa (sem duplicar por groupId/nome).
   * @param {object} settings Configurações já carregadas
   * @returns {Array<{id:string,name:string,enabled:boolean,groupId?:string|null}>}
   */
  _gruposParaMonitorar(settings) {
    const grupos = [];
    const vistos = new Set();

    (settings.monitored_groups || [])
      .filter((g) => g.enabled !== false)
      .forEach((g) => {
        const chave = ((g.groupId || '') || (g.name || '')).toLowerCase();
        if (!chave || vistos.has(chave)) return;
        vistos.add(chave);
        grupos.push(g);
      });

    const activeList = (settings.lists || []).find((l) => l.id === settings.active_ai_list_id);
    ((activeList && activeList.contacts) || []).forEach((c) => {
      if (c.type !== 'group') return;
      const nome = (c.name || '').trim();
      if (!nome) return;
      const chave = ((c.groupId || '') || nome).toLowerCase();
      if (vistos.has(chave)) return;
      vistos.add(chave);
      grupos.push({
        id: 'list:' + (c.groupId || nome),
        name: nome,
        enabled: true,
        groupId: c.groupId || null,
        _naLista: true
      });
    });

    return grupos;
  },

  /**
   * Grupos monitorados habilitados (união: seção + lista ativa).
   * @returns {Promise<Array<{id:string,name:string,enabled:boolean,groupId?:string|null}>>}
   */
  async getMonitoredGroups() {
    try {
      if (!ZapStorage.isContextValid()) return [];
      const settings = await ZapStorage.getSettings();
      return ZapStorage._gruposParaMonitorar(settings);
    } catch (err) {
      return [];
    }
  },

  /**
   * Verifica se algum identificador casa com os contatos da campanha de disparo.
   */
  _encontraNaCampanha(settings, identificadores) {
    const contatosCampanha = (settings.campaign && settings.campaign.contacts) || [];
    return contatosCampanha.find((c) => identificadores.some((id) => ZapStorage._contatoCombina(id, c)));
  },

  /**
   * Autoriza (ou explica por que não autoriza) a resposta da IA para um contato.
   * @param {string|string[]} contato Nome e/ou telefone do contato (aceita vários identificadores)
   * @param {{isGroup?:boolean, groupId?:string|null}} opts `isGroup` = conversa é grupo
   * @returns {Promise<{allowed: boolean, reason: string}>}
   */
  nomesDeGrupoIguais(a, b) {
    const nome = ZapStorage._normalizeName(a);
    return !!nome && nome === ZapStorage._normalizeName(b);
  },

  normalizarIdGrupo(id) {
    return String(id || '').trim().replace(/@g\.us$/i, '');
  },

  async checkAIAuthorization(contato, opts = {}) {
    const isGroup = !!opts.isGroup;
    const groupId = opts.groupId || null;

    const identificadores = (Array.isArray(contato) ? contato : [contato])
      .map((v) => (v || '').toString().trim())
      .filter(Boolean);

    if (identificadores.length === 0) {
      return { allowed: false, reason: 'contato sem nome/telefone identificável' };
    }
    if (!ZapStorage.isContextValid()) {
      return { allowed: false, reason: 'extensão recarregada (contexto inválido)' };
    }

    try {
      const settings = await ZapStorage.getSettings();

      if (!settings.ai_enabled) {
        return { allowed: false, reason: 'IA desligada no painel' };
      }

      for (const id of identificadores) {
        if (await ZapStorage.isHumanCooldownActive(id)) {
          return { allowed: false, reason: 'em cooldown por intervenção humana' };
        }
      }

      // ── Grupos monitorados (união: seção + lista ativa) ──
      if (isGroup) {
        const grupos = ZapStorage._gruposParaMonitorar(settings);
        if (grupos.length === 0) {
          return { allowed: false, reason: 'não é um grupo monitorado' };
        }
        const alvo = ZapStorage.normalizarIdGrupo(groupId);
        const grupoEncontrado = grupos.find((g) => {
          const cadastrado = ZapStorage.normalizarIdGrupo(g.groupId);
          if (cadastrado) return alvo === cadastrado;
          return ZapStorage.nomesDeGrupoIguais(identificadores[0], g.name);
        });
        if (!grupoEncontrado) {
          return {
            allowed: false,
            reason: `não é um grupo monitorado (comparado com ${grupos.length} grupo(s))`
          };
        }
        return { allowed: true, reason: `grupo monitorado "${grupoEncontrado.name}"` };
      }

      // ── Contatos individuais ──
      if (settings.active_ai_list_id === 'all') {
        return { allowed: true, reason: 'todas as conversas' };
      }

      const activeList = (settings.lists || []).find((l) => l.id === settings.active_ai_list_id);
      if (!activeList) {
        const naCampanha = ZapStorage._encontraNaCampanha(settings, identificadores);
        if (naCampanha) {
          return { allowed: true, reason: 'campanha de disparo' };
        }
        return { allowed: false, code: 'contact_list', reason: 'a lista ativa não existe mais' };
      }

      const contatosLista = activeList.contacts || [];
      if (contatosLista.length === 0) {
        const naCampanha = ZapStorage._encontraNaCampanha(settings, identificadores);
        if (naCampanha) {
          return { allowed: true, reason: 'campanha de disparo' };
        }
        return { allowed: false, code: 'contact_list', reason: `a lista "${activeList.name}" está vazia` };
      }

      const encontrado = contatosLista.find((c) =>
        identificadores.some((id) => ZapStorage._contatoCombina(id, c))
      );
      if (encontrado) {
        return { allowed: true, reason: `lista "${activeList.name}"` };
      }

      const naCampanha = ZapStorage._encontraNaCampanha(settings, identificadores);
      if (naCampanha) {
        return { allowed: true, reason: 'campanha de disparo' };
      }

      return {
        allowed: false,
        code: 'contact_not_found',
        reason: `não encontrado na lista "${activeList.name}" (comparado com ${contatosLista.length} contato(s))`
      };
    } catch (err) {
      return { allowed: false, reason: `erro ao verificar: ${err.message}` };
    }
  },

  /**
   * Compatibilidade: true/false apenas.
   */
  async isPhoneAllowedForAI(contato) {
    const resultado = await ZapStorage.checkAIAuthorization(contato);
    return resultado.allowed;
  },

  /**
   * Atualiza um seletor CSS customizado no storage (persiste entre sessões)
   * @param {string} key Chave do seletor (ex: 'composeBox')
   * @param {string} value Novo seletor CSS
   */
  async updateSelector(key, value) {
    try {
      if (!ZapStorage.isContextValid()) return;
      const current = (await ZapStorage.get('selectors')) || {};
      current[key] = value;
      await ZapStorage.set({ selectors: current });
    } catch (err) {
      console.warn('[ZapStorage] Erro ao atualizar seletor:', err);
    }
  }
};

// Exporta globalmente para uso em Content Scripts ou Service Worker
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ZapStorage;
}
