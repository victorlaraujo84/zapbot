/**
 * WADriver - Driver resiliente de automação para a interface do WhatsApp Web
 * Utiliza seletores configuráveis com fallback automático (incluindo IA) para garantir
 * estabilidade mesmo após atualizações do WhatsApp Web.
 */

/**
 * Mapa de seletores CSS padrão, com descrições para fallback de IA e seletores alternativos.
 * Todos os valores aqui podem ser sobrescritos via chrome.storage.local (chave: 'selectors').
 */
const SELECTORS_DEFAULTS = {
  unreadBadge: {
    value: '[data-testid="icon-unread-count"]',
    description: 'Bolinha/badge de mensagem não lida na lista lateral de conversas',
    fallbacks: [
      'span[data-icon="unread-count"]',
      '[aria-label*="não lida"]',
      '[aria-label*="unread"]',
      '[aria-label*="não lido"]',
      '#pane-side span[data-testid="icon-unread-count"]'
    ]
  },
  chatFrame: {
    value: '[data-testid="cell-frame-container"]',
    description: 'Container clicável de cada item de conversa na lista lateral',
    fallbacks: ['#pane-side div[role="listitem"]', '#pane-side div[tabindex="-1"]']
  },
  chatFrameTitle: {
    value: '[data-testid="cell-frame-title"] span[title]',
    description: 'Elemento com o nome ou telefone de um item na lista lateral de conversas',
    fallbacks: ['[role="gridcell"] span[title]', '[data-testid="cell-frame-container"] span[title]']
  },
  composeBox: {
    value: '[data-testid="conversation-compose-box-input"]',
    description: 'Caixa de texto editável para digitar mensagem no chat aberto (rodapé)',
    fallbacks: [
      'footer [contenteditable="true"][data-tab="10"]',
      '#main footer div[role="textbox"]',
      'footer [contenteditable="true"]'
    ]
  },
  sendButton: {
    value: 'footer span[data-testid="wds-ic-send-filled"]',
    description: 'Botão de enviar mensagem no rodapé do chat ativo',
    fallbacks: [
      'footer button[aria-label="Enviar"]',
      'footer button[aria-label="Send"]',
      'footer [data-icon="send"]',
      'footer [data-testid="send"]',
      'footer [data-icon="wds-ic-send-filled"]'
    ]
  },
  messageHistory: {
    value: 'div[data-pre-plain-text]',
    description: 'Balões de mensagem no chat aberto (contém atributo data-pre-plain-text com metadados)',
    fallbacks: ['#main div[role="row"] .selectable-text', '#main [data-id]']
  },
  messageText: {
    value: 'span.selectable-text',
    description: 'Texto selecionável dentro de um balão de mensagem no chat',
    fallbacks: ['span[data-testid="selectable-text"]', 'span[dir="ltr"].copyable-text']
  },
  activeContactHeader: {
    value: '#main header span[title]',
    description: 'Nome ou telefone do contato no cabeçalho do chat aberto',
    fallbacks: ['#main header h2', '#main header [role="button"] span[title]']
  },
  mentionEl: {
    value: 'span[data-mention]',
    description: 'Elemento de @menção dentro de uma mensagem (atributo data-mention com o telefone)',
    fallbacks: ['[data-mention]']
  },
  quotedMessage: {
    value: '[data-testid="quoted-message"]',
    description: 'Bloco de mensagem citada (quote) dentro de um balão',
    fallbacks: ['div[role="button"] span[title]']
  }
};

const WADriver = {
  // Cache local dos seletores customizados (lido do storage na inicialização)
  _customSelectors: {},
  // Flag para sinalizar que o próprio bot está digitando (evita registrar "intervenção humana")
  _enviando: false,

  /**
   * Inicializa WADriver carregando os seletores customizados do storage.
   * Deve ser chamado no início do content script.
   */
  async inicializarSeletores() {
    try {
      if (ZapStorage.isContextValid()) {
        const customSels = await ZapStorage.get('selectors');
        WADriver._customSelectors = customSels || {};
        console.log('[WADriver] Seletores inicializados:', WADriver._customSelectors);
      }
    } catch (_) { }
  },

  /**
   * Retorna o seletor efetivo para uma chave (override do storage > valor padrão)
   * @param {string} key Chave do seletor
   */
  _getSelector(key) {
    return WADriver._customSelectors[key] || SELECTORS_DEFAULTS[key]?.value;
  },

  /**
   * Faz querySelector com fallback em múltiplos níveis:
   *   1. Seletor customizado (override do storage)
   *   2. Seletor padrão do SELECTORS_DEFAULTS
   *   3. Lista de fallbacks alternativos
   *   4. Fallback via IA (apenas se tryAIFallback=true)
   *
   * @param {string} key Chave do seletor (ex: 'composeBox')
   * @param {Element|Document} scope Elemento raiz (default: document)
   * @param {boolean} tryAIFallback Se verdadeiro, consulta a IA quando tudo falhar
   * @returns {Element|null}
   */
  async queryEl(key, scope = document, tryAIFallback = false) {
    const defn = SELECTORS_DEFAULTS[key];
    if (!defn) return null;

    // Nível 1: Seletor principal (customizado ou padrão)
    const mainSel = WADriver._getSelector(key);
    if (mainSel) {
      const el = scope.querySelector(mainSel);
      if (el) return el;
    }

    // Nível 2: Fallbacks alternativos
    for (const fb of (defn.fallbacks || [])) {
      const el = scope.querySelector(fb);
      if (el) return el;
    }

    // Nível 3: Fallback via IA (opcional)
    if (tryAIFallback && ZapStorage.isContextValid()) {
      console.warn(`[WADriver] Todos os seletores para "${key}" falharam. Consultando IA...`);
      const novoSeletor = await WADriver._consultarIAParaSeletor(key, defn.description, scope);
      if (novoSeletor) {
        await ZapStorage.updateSelector(key, novoSeletor);
        WADriver._customSelectors[key] = novoSeletor;
        console.log(`[WADriver] IA encontrou novo seletor para "${key}": ${novoSeletor}`);
        return scope.querySelector(novoSeletor);
      }
    }

    return null;
  },

  /**
   * queryEl síncrono — sem fallback de IA, sem await. Útil para leituras não-críticas.
   * @param {string} key Chave do seletor
   * @param {Element|Document} scope Elemento raiz
   * @returns {Element|null}
   */
  queryElSync(key, scope = document) {
    const defn = SELECTORS_DEFAULTS[key];
    if (!defn) return null;

    const mainSel = WADriver._getSelector(key);
    if (mainSel) {
      const el = scope.querySelector(mainSel);
      if (el) return el;
    }

    for (const fb of (defn.fallbacks || [])) {
      const el = scope.querySelector(fb);
      if (el) return el;
    }

    return null;
  },

  /**
   * Verifica se um item da lista lateral tem mensagem não lida.
   * Considera o badge, o aria-label da linha e o título do item.
   * @param {Element} frame Container da conversa na lista lateral
   * @returns {boolean}
   */
  temMensagemNaoLida(frame) {
    if (!frame) return false;

    // 1. Badge configurado (com fallbacks)
    if (WADriver.queryElSync('unreadBadge', frame)) return true;

    // 2. aria-label da própria linha (ex.: "João, 2 mensagens não lidas")
    const row = frame.closest('[role="listitem"]') || frame;
    const aria = `${row.getAttribute('aria-label') || ''} ${frame.getAttribute('aria-label') || ''}`;
    if (/n[ãa]o\s+lida|unread/i.test(aria)) return true;

    // 3. Qualquer descendente marcado como não lido
    if (frame.querySelector('[aria-label*="não lida"], [aria-label*="unread"], [data-icon="unread-count"], [data-icon="unread"]')) {
      return true;
    }

    return false;
  },

  /**
   * Abre o chat de um item da lista lateral e confirma que ele realmente abriu.
   * O clique é feito na linha interativa (role=listitem) e, se preciso, no título.
   * @param {Element} frame Container da conversa
   * @param {string} contatoId Nome ou telefone esperado no cabeçalho
   * @param {number} timeout Tempo máximo de espera em ms
   * @returns {Promise<boolean>}
   */
  async abrirChatDoFrame(frame, contatoId = '', timeout = 6000) {
    if (!frame) return false;

    // Alvos de clique em ordem de preferência (item da lista, título, frame, célula)
    const alvos = [
      frame.closest('[role="listitem"]'),
      frame.querySelector('span[title]'),
      frame,
      frame.closest('[tabindex="-1"]')
    ].filter(Boolean);

    const clicar = (el) => {
      if (!el) return;
      try {
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      } catch (_) { }
      try { el.click(); } catch (_) { }
    };

    const inicio = Date.now();
    let indice = 0;
    while (Date.now() - inicio < timeout) {
      const campo = WADriver.queryElSync('composeBox');
      if (campo && (!contatoId || WADriver.capturarDestino(contatoId))) return true;

      // Dá tempo para o WhatsApp atualizar o cabeçalho após cada clique.
      clicar(alvos[indice++ % alvos.length]);
      await new Promise((r) => setTimeout(r, 400));
    }

    return false;
  },

  /**
   * Sanitiza o HTML do WhatsApp antes de enviá-lo para a IA (detecção de seletores).
   * Remove texto de mensagens e atributos com dados pessoais (telefones, nomes),
   * preservando apenas a estrutura necessária (data-testid, role, aria-label).
   */
  _sanitizarHtmlParaIA(scope) {
    try {
      const raiz = (scope instanceof Document ? scope.body : scope) || document.body;
      if (!raiz) return '';

      const clone = raiz.cloneNode(true);
      const removerAttrs = ['data-id', 'data-pre-plain-text', 'href', 'src', 'style'];
      const redactarAttrs = ['title', 'aria-label'];

      const percorrer = (node) => {
        for (let i = node.childNodes.length - 1; i >= 0; i--) {
          const child = node.childNodes[i];
          if (child.nodeType === 3) {
            // Remove conteúdo textual (mensagens, nomes, telefones)
            child.textContent = '';
          } else if (child.nodeType === 1) {
            removerAttrs.forEach((a) => child.removeAttribute(a));
            redactarAttrs.forEach((a) => {
              if (child.hasAttribute(a)) child.setAttribute(a, 'X');
            });
            percorrer(child);
          }
        }
      };
      percorrer(clone);

      return (clone.innerHTML || '').substring(0, 12000);
    } catch (_) {
      return '';
    }
  },

  /**
   * Consulta a IA para encontrar o seletor correto quando os atuais falham.
   * Reutiliza o handler GENERATE_AI_RESPONSE do Service Worker.
   * @param {string} key Chave interna do seletor
   * @param {string} description Descrição do elemento para o prompt da IA
   * @param {Element|Document} scope Escopo para capturar o HTML
   * @returns {string|null} Novo seletor CSS ou null se não encontrado
   */
  async _consultarIAParaSeletor(key, description, scope = document) {
    try {
      if (!ZapStorage.isContextValid()) return null;

      // Captura um trecho sanitizado do HTML (sem texto de mensagens nem PII) para a IA
      const htmlTrecho = WADriver._sanitizarHtmlParaIA(scope);

      const prompt = `Você é um especialista em automação web. Analise o HTML abaixo (trecho do WhatsApp Web) e retorne APENAS um seletor CSS válido para localizar: "${description}".

REGRAS IMPORTANTES:
- Prefira seletores com data-testid ou aria-label (mais estáveis)
- Evite seletores com classes como "x78zum5" (são geradas dinamicamente)
- Retorne SOMENTE o seletor, sem explicação, sem markdown, sem aspas extras
- Se não conseguir identificar com certeza, retorne exatamente: NULL

HTML:
${htmlTrecho}`;

      const settings = await ZapStorage.getSettings();
      const response = await chrome.runtime.sendMessage({
        action: 'GENERATE_AI_RESPONSE',
        payload: { prompt, history: [], settings }
      });

      const resultado = (response?.text || '').trim();
      if (!resultado || resultado === 'NULL' || resultado.length > 300) return null;

      // Valida se o seletor realmente encontra um elemento no DOM
      try {
        const testEl = document.querySelector(resultado);
        return testEl ? resultado : null;
      } catch (_) {
        return null;
      }
    } catch (e) {
      console.warn('[WADriver] Erro no fallback de IA para seletor:', e);
      return null;
    }
  },

  /**
   * Retorna o mapa de seletores padrão (para exibição no editor do Side Panel)
   */
  getSelectorsDefaults() {
    const result = {};
    for (const [key, defn] of Object.entries(SELECTORS_DEFAULTS)) {
      result[key] = {
        value: WADriver._customSelectors[key] || defn.value,
        description: defn.description,
        isCustom: !!WADriver._customSelectors[key]
      };
    }
    return result;
  },

  // ─────────────────────────────────────────────────────────────────────────
  // MÉTODOS DE AUTOMAÇÃO
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Abre uma conversa pelo número de telefone
   * @param {string} telefone Número com código do país (ex: 5511999999999)
   */
  async abrirConversa(telefone) {
    const limpo = (telefone || '').replace(/\D/g, '');
    if (!limpo) throw new Error('Número de telefone inválido.');

    // Se a conversa desse número já está aberta, não força navegação
    const jaAberta = WADriver.queryElSync('composeBox') && window.location.href.includes(limpo);
    if (jaAberta) return WADriver.queryElSync('composeBox');

    WADriver.navegarParaConversa(limpo);

    // Se o WhatsApp tratar o deep link sem recarregar, aguarda o campo de digitação.
    // Se recarregar, o content script é reinjetado e a campanha retoma pelo storage.
    return await this.aguardarCarregamentoConversa(15000);
  },

  /**
   * Navega para a conversa de um telefone usando o deep link do WhatsApp Web.
   * ATENÇÃO: essa navegação recarrega a página e reinicia o content script.
   * @param {string} telefone Número com DDI (somente dígitos)
   * @returns {string} URL de destino
   */
  navegarParaConversa(telefone) {
    const limpo = (telefone || '').replace(/\D/g, '');
    if (!limpo || limpo.length < 8) {
      throw new Error('Número de telefone inválido. Use DDI + DDD + número (ex: 5511999999999).');
    }

    const url = `https://web.whatsapp.com/send?phone=${limpo}`;
    window.location.assign(url);
    return url;
  },

  /**
   * Aguarda o campo de digitação estar pronto ou detecta número inválido
   */
  aguardarCarregamentoConversa(timeout = 15000) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      const interval = setInterval(async () => {
        // Verifica modal de número inválido
        const modalInvalido =
          document.querySelector('[data-animate-modal-popup="true"]') ||
          document.querySelector('div[role="dialog"]');
        if (modalInvalido) {
          const textoModal = modalInvalido.innerText || '';
          if (
            textoModal.includes('inválido') ||
            textoModal.includes('invalid') ||
            textoModal.includes('não cadastrado')
          ) {
            clearInterval(interval);
            const btnOk = modalInvalido.querySelector('button');
            if (btnOk) btnOk.click();
            return reject(new Error('Número não possui conta no WhatsApp ou é inválido.'));
          }
        }

        // Verifica se o campo de digitação está disponível
        const inputMsg = WADriver.queryElSync('composeBox');
        if (inputMsg) {
          clearInterval(interval);
          return resolve(inputMsg);
        }

        if (Date.now() - startTime > timeout) {
          clearInterval(interval);
          reject(new Error('Tempo limite esgotado ao tentar abrir a conversa.'));
        }
      }, 500);
    });
  },

  /**
   * Obtém o elemento de digitação de mensagem ativo (síncrono, sem IA)
   */
  obterCampoDigitacao() {
    return WADriver.queryElSync('composeBox');
  },

  /**
   * Digita e envia uma mensagem de texto com simulação de digitação humana
   * @param {string} texto Mensagem a ser enviada
   */
  async enviarMensagemTexto(texto, conferirDestino) {
    if (!texto) return;

    const verificar = () => {
      if (conferirDestino && !conferirDestino()) throw new Error('O chat ativo mudou. Envio cancelado.');
    };
    WADriver._enviando = true;
    try {
      verificar();
      // Tenta obter a caixa com fallback de IA se necessário
      const main = conferirDestino ? document.querySelector('#main') : document;
      const inputMsg = main && await WADriver.queryEl('composeBox', main, !conferirDestino);
      if (!inputMsg) {
        throw new Error('Campo de digitação do WhatsApp não foi encontrado.');
      }

      verificar();
      if (conferirDestino && inputMsg.textContent.trim()) throw new Error('O chat contém um rascunho.');
      const anteriores = new Set(conferirDestino ? WADriver.baloesDeSaida().map(({ chave }) => chave) : []);
      inputMsg.focus();

      // Insere o texto preservando quebras de linha e acentos
      const inserido = document.execCommand('insertText', false, texto);
      if (conferirDestino && !inserido && !WADriver.textosDeEnvioIguais(inputMsg.innerText || inputMsg.textContent, texto)) {
        throw new Error('O WhatsApp não aceitou o texto no campo de digitação.');
      }

      // Dispara eventos sintéticos para sincronizar estado React do WhatsApp
      inputMsg.dispatchEvent(new InputEvent('input', { bubbles: true }));
      inputMsg.dispatchEvent(new Event('change', { bubbles: true }));

      // Aguarda o botão de enviar aparecer
      await new Promise((r) => setTimeout(r, 600));

      // Localiza o botão Enviar (com fallback de IA)
      let btnSend;
      if (conferirDestino) {
        const prazoBotao = Date.now() + 2500;
        do {
          verificar();
          const alvo = WADriver.queryElSync('sendButton', main);
          btnSend = alvo?.closest('button, [role="button"]');
          if (btnSend && !btnSend.disabled && btnSend.getAttribute('aria-disabled') !== 'true') break;
          btnSend = null;
          await new Promise((r) => setTimeout(r, 150));
        } while (Date.now() < prazoBotao);
        if (!btnSend) throw new Error('O botão Enviar do chat não ficou disponível. Verifique o rascunho no WhatsApp.');
      } else {
        btnSend = await WADriver.queryEl('sendButton', document, true);
      }

      verificar();
      if (!inputMsg.isConnected) throw new Error('Campo de digitação foi substituído.');
      if (conferirDestino && !WADriver.textosDeEnvioIguais(inputMsg.innerText || inputMsg.textContent, texto)) {
        throw new Error('O texto do campo de digitação mudou. Envio cancelado.');
      }
      if (btnSend) {
        // Se encontrou o ícone, sobe até o botão pai
        const btn = btnSend.closest('button') || btnSend;
        btn.click();
      } else {
        // Fallback: simula Enter no teclado
        inputMsg.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true
          })
        );
      }

      if (!conferirDestino) {
        await new Promise((r) => setTimeout(r, 500));
        return;
      }
      const prazo = Date.now() + 10000;
      while (Date.now() < prazo) {
        verificar();
        if (WADriver.mensagemDeSaidaConfirmada(texto, anteriores)) return;
        await new Promise((r) => setTimeout(r, 200));
      }
      const rascunho = WADriver.textosDeEnvioIguais(inputMsg.innerText || inputMsg.textContent, texto);
      const erro = new Error(rascunho
        ? 'O texto permaneceu no campo após clicar em Enviar. Confira o rascunho.'
        : 'O campo foi limpo, mas a mensagem de saída não foi localizada. Confira a conversa antes de reenviar.');
      erro.code = 'SEND_UNCONFIRMED';
      throw erro;
    } finally {
      WADriver._enviando = false;
    }
  },

  baloesDeSaida() {
    const main = document.querySelector('#main');
    if (!main) return [];
    return [...main.querySelectorAll('.message-out, [data-id^="true_"], [data-assigned-id^="true_"]')]
      .map((elemento) => ({
        elemento,
        chave: elemento.getAttribute('data-id') || elemento.getAttribute('data-assigned-id') || elemento
      }));
  },

  textosDeEnvioIguais(a, b) {
    const normalizar = (valor) => (valor || '').normalize('NFC').replace(/\s+/g, ' ').trim();
    return normalizar(a) === normalizar(b);
  },

  mensagemDeSaidaConfirmada(texto, anteriores) {
    const seletor = WADriver._getSelector('messageText') || 'span.selectable-text';
    return WADriver.baloesDeSaida().some(({ elemento, chave }) => {
      if (anteriores.has(chave)) return false;
      const corpo = elemento.querySelector(seletor) ||
        elemento.querySelector('[data-testid="selectable-text"], .selectable-text, .copyable-text');
      return !!corpo && WADriver.textosDeEnvioIguais(corpo.innerText || corpo.textContent, texto);
    });
  },

  /**
   * Obtém o número ou nome do contato da conversa atualmente ativa
   */
  obterContatoAtivo() {
    return WADriver.tituloDoCabecalho(document.querySelector('#main header'));
  },

  tituloDoCabecalho(header) {
    if (!header) return null;
    // O atributo title pode pertencer ao subtítulo com os participantes.
    const linhas = (header.innerText || '').split('\n').map((linha) => linha.trim());
    return linhas.find(Boolean) || null;
  },

  capturarDestino(nome) {
    const header = document.querySelector('#main header');
    const titulo = WADriver.tituloDoCabecalho(header);
    if (!titulo || titulo.normalize('NFC') !== nome.trim().normalize('NFC')) return null;
    const grupo = WADriver.obterGrupoDoChatAtivo();
    return { header, nome, grupo, telefone: grupo.isGroup ? null : WADriver.obterTelefoneDoChatAtivo() };
  },

  destinoConfere(destino) {
    if (!destino) return false;
    const atual = WADriver.capturarDestino(destino.nome);
    return !!atual && atual.header === destino.header &&
      atual.grupo.isGroup === destino.grupo.isGroup &&
      atual.grupo.groupId === destino.grupo.groupId && atual.telefone === destino.telefone;
  },

  contarNaoLidas(frame) {
    const badge = WADriver.queryElSync('unreadBadge', frame);
    const texto = badge?.textContent?.trim() || badge?.getAttribute('aria-label') || '';
    const total = Number(texto.match(/\d+/)?.[0]);
    return Number.isInteger(total) && total > 0 ? Math.min(total, 50) : 1;
  },

  /**
   * Descobre o telefone real do chat aberto (mesmo quando o título é o nome da agenda).
   * Usa o data-id das mensagens: "false_5511999999999@c.us_XXXX".
   * @returns {string|null} Somente dígitos, ou null se não for possível identificar
   */
  obterTelefoneDoChatAtivo() {
    try {
      const mainChat = document.querySelector('#main');
      if (!mainChat) return null;

      const elementos = mainChat.querySelectorAll('[data-id]');

      // 1) data-id no formato clássico: false_5511999999999@c.us_<hash>
      for (const el of elementos) {
        const id = el.getAttribute('data-id') || '';
        const match = id.match(/(\d{8,15})@(?:c\.us|s\.whatsapp\.net)/);
        if (match) return match[1];
      }

      // 2) data-id com domínio inesperado: extrai os dígitos antes do '@'
      for (const el of elementos) {
        const id = el.getAttribute('data-id') || '';
        const antesDoAt = id.split('@')[0] || '';
        const digitos = antesDoAt.replace(/\D/g, '');
        if (digitos.length >= 8 && digitos.length <= 15) return digitos;
      }

      // 3) Fallback: cabeçalho já exibindo o telefone
      const header = WADriver.obterContatoAtivo() || '';
      const digitos = header.replace(/\D/g, '');
      return digitos.length >= 10 ? digitos : null;
    } catch (_) {
      return null;
    }
  },

  /**
   * Extrai o id de grupo de um data-id de mensagem (puro, testável).
   * @param {string} dataId Ex.: 'false_12036301234567890@g.us_ABC' (aceita id antigo com hífen)
   * @returns {{groupId:string}|null}
   */
  parseDataIdGrupo(dataId) {
    const match = (dataId || '').match(/([\d-]{8,})@g\.us/);
    return match ? { groupId: match[1] } : null;
  },

  /**
   * Varre uma lista de valores de atributos procurando id de grupo (puro, testável).
   * @param {string[]} valores Ex.: valores de data-id/data-assigned-id
   * @returns {{groupId:string}|null}
   */
  extrairGrupoDeAtributos(valores) {
    if (!Array.isArray(valores)) return null;
    for (const v of valores) {
      const parsed = WADriver.parseDataIdGrupo(String(v || ''));
      if (parsed) return parsed;
    }
    return null;
  },

  /**
   * Heurística: o subtítulo do cabeçalho indica grupo?
   * (grupos mostram lista de membros separada por vírgula ou "N participantes")
   */
  subtituloIndicaGrupo(subtitulo) {
    const s = (subtitulo || '').toString();
    return /participante|membro/i.test(s) || s.includes(',');
  },

  /**
   * Detecta se o chat aberto é um grupo e devolve o id do grupo.
   * Sinais do chat ativo: ID com @g.us, botão de dados do grupo ou
   * subtítulo com participantes.
   * @returns {{isGroup:boolean, groupId:string|null}}
   */
  obterGrupoDoChatAtivo() {
    try {
      const mainChat = document.querySelector('#main');

      if (mainChat) {
        const valores = [];
        mainChat.querySelectorAll('[data-id], [data-assigned-id]').forEach((el) => {
          valores.push(el.getAttribute('data-id'));
          valores.push(el.getAttribute('data-assigned-id'));
        });
        const noChat = WADriver.extrairGrupoDeAtributos(valores);
        if (noChat) return { isGroup: true, groupId: noChat.groupId };

        // Cabeçalho com lista de membros/contagem → grupo (id desconhecido)
        const header = mainChat.querySelector('header');
        const botao = header?.querySelector('[data-testid="conversation-info-header-button"]');
        const rotulos = [botao?.getAttribute('aria-label'), botao?.getAttribute('title')];
        if (rotulos.some((rotulo) => /^(dados do grupo|informações do grupo|group info)$/i.test((rotulo || '').trim()))) {
          return { isGroup: true, groupId: null };
        }
        if (header && WADriver.subtituloIndicaGrupo((header.innerText || '').split('\n').filter((linha) => linha.trim()).slice(1).join('\n'))) {
          return { isGroup: true, groupId: null };
        }
      }

      return { isGroup: false, groupId: null };
    } catch (_) {
      return { isGroup: false, groupId: null };
    }
  },

  /**
   * Coleta os dados da última mensagem visível do chat aberto:
   * texto, menções (@telefone) e autor da citação (quote), se houver.
   * @returns {{texto:string, mentions:string[], autorQuote:string|null}|null}
   */
  dadosDaMensagem(ultima, texto) {
    // Menções (@) no DOM: atributo data-mention contém o telefone do mencionado
    const mentions = [];
    const selMention = WADriver._getSelector('mentionEl') || 'span[data-mention]';
    try {
      ultima.querySelectorAll(selMention).forEach((m) => {
        const bruto = m.getAttribute('data-mention') || '';
        const digitos =
          typeof MentionDetector !== 'undefined' && MentionDetector.normalizarTelefone
            ? MentionDetector.normalizarTelefone(bruto)
            : bruto.replace(/\D/g, '');
        if (digitos && !mentions.includes(digitos)) mentions.push(digitos);
      });
    } catch (_) { /* seletor inválido: ignora */ }

    // Citação (quote): autor é a primeira linha do bloco citado
    let autorQuote = null;
    const selQuote = WADriver._getSelector('quotedMessage') || '[data-testid="quoted-message"]';
    try {
      const quoteEl = ultima.querySelector(selQuote);
      if (quoteEl && quoteEl.innerText) {
        autorQuote = quoteEl.innerText.split('\n')[0].trim() || null;
      }
    } catch (_) { /* seletor inválido: ignora */ }

    return { texto, mentions, autorQuote };
  },

  /**
   * Fecha o chat atualmente aberto simulando a tecla Escape.
   * Equivalente ao Keys.ESCAPE do bot Python original.
   */
  fecharChatAtivo() {
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        keyCode: 27,
        which: 27,
        bubbles: true
      })
    );
  },

  /**
   * Lê as últimas mensagens da conversa ativa para alimentar o contexto da IA
   * @param {number} limite Quantidade máxima de mensagens a retornar
   */
  obterMensagensAtuais(limite = 8) {
    try {
      const mainChat = document.querySelector('#main');
      if (!mainChat) return [];

      const selectorMsg = WADriver._getSelector('messageHistory') || 'div[data-pre-plain-text]';
      const selectorTxt = WADriver._getSelector('messageText') || 'span.selectable-text';

      // 1) Seletor configurado; 2) estrutura atual do WhatsApp (balões message-in/out);
      // 3) último recurso: linhas com data-id.
      let elementos = mainChat.querySelectorAll(selectorMsg);
      if (!elementos.length) {
        elementos = mainChat.querySelectorAll('div.message-in, div.message-out');
      }
      if (!elementos.length) {
        elementos = mainChat.querySelectorAll('[data-id]');
      }

      const historico = [];

      elementos.forEach((el) => {
        const textoEl =
          el.querySelector(selectorTxt) ||
          el.querySelector('.selectable-text, .copyable-text') ||
          el;
        const textoMsg = textoEl && textoEl.innerText ? textoEl.innerText.trim() : '';
        if (!textoMsg) return;

        const metadata = el.getAttribute('data-pre-plain-text') || '';
        const dataId = el.closest('[data-id]')?.getAttribute('data-id') || '';
        // "true_..." no data-id = mensagem enviada por mim; message-out também indica saída
        const isMe =
          metadata.includes('Você:') ||
          metadata.includes('You:') ||
          el.classList.contains('message-out') ||
          !!el.closest('.message-out') ||
          dataId.startsWith('true_');

        historico.push({ id: dataId, isMe, texto: textoMsg, elemento: el });
      });

      return historico.slice(-limite);
    } catch (err) {
      console.warn('[WADriver] Erro ao obter histórico da conversa:', err);
      return [];
    }
  },

  /**
   * Extrai todos os participantes do grupo aberto no momento usando auto-scroll virtualizado.
   * Suporta grupos grandes (centenas de membros) e contatos salvos com nome na agenda.
   * @param {Function} onProgress Callback para notificar a quantidade parcial de contatos encontrados
   */
  obterHistoricoConversaAtual(limite = 8) {
    return WADriver.obterMensagensAtuais(limite).map((m) => m.isMe ? 'Atendente: ' + m.texto : 'Cliente: ' + m.texto);
  },

  async extrairContatosGrupoAtual(onProgress = null) {
    const mainHeader = document.querySelector('#main header');
    if (!mainHeader) {
      throw new Error('Nenhuma conversa ou grupo está aberto no momento.');
    }

    // Abre a barra lateral de detalhes do grupo se não estiver aberta
    const drawerAberto =
      document.querySelector('[data-testid="group-info-drawer"]') ||
      document.querySelector('[data-icon="x"]');
    if (!drawerAberto) {
      const btnDetalhes = mainHeader.querySelector('[role="button"]') || mainHeader;
      btnDetalhes.click();
      await new Promise((r) => setTimeout(r, 1200));
    }

    const contatosMap = new Map();
    const selectorFrame = WADriver._getSelector('chatFrame') || '[data-testid="cell-frame-container"]';
    const selectorTitle = WADriver._getSelector('chatFrameTitle') || '[data-testid="cell-frame-title"] span[title]';

    const coletar = () => {
      document.querySelectorAll(selectorFrame).forEach((el) => {
        const titulo = el.querySelector(selectorTitle);
        const tel = titulo?.getAttribute('title')?.trim();
        if (!tel || tel === 'Você' || tel === 'You') return;

        const detalhe = el.querySelector('[data-testid="cell-frame-primary-detail"]');
        const admin = detalhe?.textContent?.includes('Admin') ? 'Admin do grupo' : '';

        // Número secundário (contatos com nome salvo mostram o telefone em aria-colindex=1)
        const sec = el.querySelector('[role="gridcell"][aria-colindex="1"] span[dir="auto"]');
        const telSecundario = sec?.textContent?.trim() || '';

        let numeroLimpo = '';
        let nomeFinal = '';

        if (telSecundario) {
          numeroLimpo = telSecundario.replace(/\D/g, '');
          nomeFinal = tel.replace(/^~\s*/, '');
        } else {
          numeroLimpo = tel.replace(/\D/g, '');
          nomeFinal = tel.startsWith('~')
            ? tel.replace(/^~\s*/, '')
            : numeroLimpo
              ? `Contato (${numeroLimpo.slice(-4)})`
              : tel;
        }

        const key = numeroLimpo || tel;
        if (key && !contatosMap.has(key)) {
          contatosMap.set(key, {
            phone: numeroLimpo,
            name: nomeFinal || tel,
            admin: admin || '',
            rawPhone: tel,
            secondaryPhone: telSecundario
          });
        }
      });
    };

    // Identifica o container com scroll da lista de membros (prefere o que realmente rola)
    const encontrarScroller = () => {
      const ehRolavel = (el) => el && el.scrollHeight > el.clientHeight + 20;
      const candidatos = [
        document.querySelector('div[data-testid="group-info-drawer"] div[tabindex="-1"]'),
        document.querySelector('section [tabindex="-1"]'),
        document.querySelector('#app div[tabindex="-1"]'),
        document.querySelector('div[data-testid="group-info-drawer"]')
      ];
      for (const el of candidatos) {
        if (ehRolavel(el)) return el;
      }
      return window;
    };

    let tentativas = 0;
    let ultimoTotal = 0;
    let semNovosRounds = 0;

    while (tentativas < 60) {
      tentativas++;
      coletar();

      if (onProgress && typeof onProgress === 'function') {
        onProgress(contatosMap.size);
      }

      const scroller = encontrarScroller();
      if (scroller && scroller !== window) {
        scroller.scrollTop = scroller.scrollHeight;
      } else {
        window.scrollBy(0, 800);
      }

      await new Promise((r) => setTimeout(r, 400));

      if (contatosMap.size === ultimoTotal) {
        semNovosRounds++;
        if (semNovosRounds >= 6) break; // Fim da lista
      } else {
        semNovosRounds = 0;
        ultimoTotal = contatosMap.size;
      }
    }

    const resultado = Array.from(contatosMap.values());
    if (resultado.length === 0) {
      throw new Error(
        'Não foi possível extrair contatos. Verifique se o chat aberto é um grupo e se a lista de membros está visível.'
      );
    }

    return resultado;
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WADriver, SELECTORS_DEFAULTS };
}
