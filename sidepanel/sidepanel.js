/**
 * Side Panel Controller - ZapBot Pro
 * Gerencia a interface, abas, conexões com WhatsApp Web e controle de campanhas e IA.
 */

let extractedContactsCache = [];
let bulkContactsQueue = [];
let expandedLists = new Set(); // IDs das listas abertas no accordion

const SELECTORS_DEFAULTS = {
  unreadBadge: { value: '[data-testid="icon-unread-count"]', description: 'Badge de mensagem não lida' },
  chatFrame: { value: '[data-testid="cell-frame-container"]', description: 'Container da conversa lateral' },
  chatFrameTitle: { value: '[data-testid="cell-frame-title"] span[title]', description: 'Título da conversa' },
  composeBox: { value: '[data-testid="conversation-compose-box-input"]', description: 'Caixa de texto de digitação' },
  sendButton: { value: 'footer span[data-testid="wds-ic-send-filled"]', description: 'Botão de enviar mensagem' },
  messageHistory: { value: 'div[data-pre-plain-text]', description: 'Balões de mensagem' },
  messageText: { value: 'span.selectable-text', description: 'Texto da mensagem' },
  activeContactHeader: { value: '#main header span[title]', description: 'Nome/tel do contato ativo' }
};

// Modelos disponíveis por provedor (DeepSeek é o principal)
const AI_MODELS = {
  deepseek: [
    { value: 'deepseek-chat', label: 'DeepSeek V3 (deepseek-chat)' },
    { value: 'deepseek-reasoner', label: 'DeepSeek R1 (deepseek-reasoner)' }
  ],
  gemini: [
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (legado)' }
  ],
  openai: [
    { value: 'gpt-4o-mini', label: 'GPT-4o mini' },
    { value: 'gpt-4o', label: 'GPT-4o' }
  ]
};

document.addEventListener('DOMContentLoaded', async () => {
  inicializarAbas();
  await carregarConfiguracoesIA();
  await carregarGruposMonitorados();
  await verificarConexaoWhatsApp();
  await carregarListas();
  await carregarLogs();
  await carregarConfiguracoesSeletores();
  configurarEventosDisparador();
  configurarEventosExtrator();
  configurarEventosListas();
  configurarEventosSeletores();
  configurarEventosGrupos();

  // Atualiza logs a cada 5 segundos
  setInterval(carregarLogs, 5000);
  setInterval(verificarConexaoWhatsApp, 8000);
});

/**
 * 1. NAVEGAÇÃO ENTRE ABAS
 */
function inicializarAbas() {
  const tabs = document.querySelectorAll('.nav-tab');
  const panes = document.querySelectorAll('.tab-pane');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      panes.forEach((p) => p.classList.remove('active'));

      tab.classList.add('active');
      const targetId = tab.getAttribute('data-tab');
      document.getElementById(targetId)?.classList.add('active');
    });
  });
}

/**
 * 2. VERIFICAÇÃO DE CONEXÃO COM O WHATSAPP WEB
 */
async function verificarConexaoWhatsApp() {
  const dot = document.getElementById('wa-connection-dot');
  const text = document.getElementById('wa-connection-text');

  try {
    const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
    if (tabs.length === 0) {
      dot.className = 'status-indicator offline';
      text.innerText = 'Abra o WhatsApp Web';
      return null;
    }

    const tab = tabs[0];
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'CHECK_STATUS' }).catch(() => null);

    if (response && response.ready) {
      dot.className = 'status-indicator online';
      text.innerText = 'WhatsApp Conectado';
      return tab;
    } else {
      dot.className = 'status-indicator';
      text.innerText = 'WhatsApp Carregando...';
      return null;
    }
  } catch (err) {
    dot.className = 'status-indicator offline';
    text.innerText = 'Desconectado';
    return null;
  }
}

/**
 * 3. CONFIGURAÇÕES DA IA
 */
async function carregarConfiguracoesIA() {
  const settings = await ZapStorage.getSettings();

  const toggle = document.getElementById('ai-master-toggle');
  const provider = document.getElementById('ai-provider');
  const model = document.getElementById('ai-model');
  const geminiKey = document.getElementById('gemini-key');
  const openaiKey = document.getElementById('openai-key');
  const deepseekKey = document.getElementById('deepseek-key');
  const prompt = document.getElementById('ai-prompt');
  const faq = document.getElementById('ai-faq');
  const cooldown = document.getElementById('ai-cooldown');
  const targetList = document.getElementById('ai-target-list');

  toggle.checked = !!settings.ai_enabled;
  provider.value = settings.ai_provider || 'deepseek';
  geminiKey.value = settings.gemini_api_key || '';
  openaiKey.value = settings.openai_api_key || '';
  deepseekKey.value = settings.deepseek_api_key || '';
  prompt.value = settings.system_prompt || '';
  faq.value = settings.faq_context || '';
  cooldown.value = settings.cooldown_minutes || 10;

  atualizarOpcoesModelo(provider.value, settings.ai_model);
  atualizarVisibilidadeCamposProvedor(provider.value);

  provider.addEventListener('change', () => {
    atualizarOpcoesModelo(provider.value);
    atualizarVisibilidadeCamposProvedor(provider.value);
  });

  // Salvar configurações
  document.getElementById('btn-save-ai').addEventListener('click', async () => {
    await ZapStorage.set({
      ai_enabled: toggle.checked,
      ai_provider: provider.value,
      ai_model: model.value,
      gemini_api_key: geminiKey.value.trim(),
      openai_api_key: openaiKey.value.trim(),
      deepseek_api_key: deepseekKey.value.trim(),
      system_prompt: prompt.value.trim(),
      faq_context: faq.value.trim(),
      cooldown_minutes: parseInt(cooldown.value, 10) || 10,
      active_ai_list_id: targetList.value
    });

    await chrome.runtime.sendMessage({ action: 'UPDATE_BADGE' });
    showSidepanelToast('Configurações da IA salvas com sucesso!', 'success');
  });

  // Toggle direto no switch mestre
  toggle.addEventListener('change', async () => {
    await ZapStorage.set({ ai_enabled: toggle.checked });
    await chrome.runtime.sendMessage({ action: 'UPDATE_BADGE' });
    showSidepanelToast(toggle.checked ? 'IA Ativada no WhatsApp!' : 'IA Pausada.', 'info');
  });
}

function atualizarVisibilidadeCamposProvedor(provedor) {
  const geminiGroup = document.getElementById('group-gemini-key');
  const openaiGroup = document.getElementById('group-openai-key');
  const deepseekGroup = document.getElementById('group-deepseek-key');

  if (geminiGroup) geminiGroup.classList.toggle('hidden', provedor !== 'gemini');
  if (openaiGroup) openaiGroup.classList.toggle('hidden', provedor !== 'openai');
  if (deepseekGroup) deepseekGroup.classList.toggle('hidden', provedor !== 'deepseek');
}

function atualizarOpcoesModelo(provedor, valorSelecionado = '') {
  const select = document.getElementById('ai-model');
  if (!select) return;

  const modelos = AI_MODELS[provedor] || AI_MODELS.deepseek;
  select.innerHTML = '';
  modelos.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m.value;
    opt.textContent = m.label;
    select.appendChild(opt);
  });

  // Mantém o modelo salvo se existir nas opções; senão usa o primeiro
  if (valorSelecionado && modelos.some((m) => m.value === valorSelecionado)) {
    select.value = valorSelecionado;
  } else {
    select.value = modelos[0].value;
  }
}

/**
 * 4. DISPARADOR EM MASSA
 */
function configurarEventosDisparador() {
  const minSlider = document.getElementById('min-delay-slider');
  const maxSlider = document.getElementById('max-delay-slider');
  const minVal = document.getElementById('min-delay-val');
  const maxVal = document.getElementById('max-delay-val');
  const msgInput = document.getElementById('bulk-message-text');
  const csvInput = document.getElementById('bulk-csv-input');
  const listSelect = document.getElementById('bulk-list-select');

  minSlider.addEventListener('input', () => {
    if (parseInt(minSlider.value) >= parseInt(maxSlider.value)) {
      maxSlider.value = parseInt(minSlider.value) + 2;
      maxVal.innerText = `${maxSlider.value}s`;
    }
    minVal.innerText = `${minSlider.value}s`;
  });

  maxSlider.addEventListener('input', () => {
    if (parseInt(maxSlider.value) <= parseInt(minSlider.value)) {
      minSlider.value = Math.max(4, parseInt(maxSlider.value) - 2);
      minVal.innerText = `${minSlider.value}s`;
    }
    maxVal.innerText = `${maxSlider.value}s`;
  });

  // Persiste os delays no storage para reutilizar nas próximas sessões
  const persistDelays = () => {
    ZapStorage.set({
      min_delay: parseInt(minSlider.value, 10),
      max_delay: parseInt(maxSlider.value, 10)
    });
  };
  minSlider.addEventListener('change', persistDelays);
  maxSlider.addEventListener('change', persistDelays);

  // Restaura os delays salvos
  (async () => {
    const settings = await ZapStorage.getSettings();
    minSlider.value = settings.min_delay || 6;
    maxSlider.value = settings.max_delay || 15;
    minVal.innerText = `${minSlider.value}s`;
    maxVal.innerText = `${maxSlider.value}s`;
  })();

  // Botões de tags dinâmicas
  document.querySelectorAll('.tag-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tag = btn.getAttribute('data-tag');
      inserirTextoNaPosicao(msgInput, tag);
    });
  });

  // Leitura de CSV
  csvInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      const lines = text.split(/\r?\n/);
      const contacts = [];

      lines.forEach((line) => {
        if (!line.trim()) return;
        const parts = line.split(/[,;\t]/);
        const phone = parts[0]?.replace(/\D/g, '');
        const name = parts[1]?.trim() || `Contato (${phone.slice(-4)})`;
        if (phone && phone.length >= 8) {
          contacts.push({ phone, name });
        }
      });

      bulkContactsQueue = contacts;
      document.getElementById('contacts-loaded-count').innerText = `${contacts.length} contatos carregados via CSV`;
      showSidepanelToast(`${contacts.length} contatos carregados com sucesso!`, 'success');
    };
    reader.readAsText(file);
  });

  // Seleção de lista salva
  listSelect.addEventListener('change', async () => {
    const listId = listSelect.value;
    if (!listId) return;

    const settings = await ZapStorage.getSettings();
    const lista = (settings.lists || []).find((l) => l.id === listId);
    if (lista && lista.contacts) {
      // Grupos não entram no disparador (deep link não funciona para grupo)
      bulkContactsQueue = (lista.contacts || []).filter((c) => c.type !== 'group');
      document.getElementById('contacts-loaded-count').innerText = `${lista.contacts.length} contatos carregados da lista "${lista.name}"`;
    }
  });

  // Botão Iniciar Disparos
  document.getElementById('btn-start-bulk').addEventListener('click', async () => {
    if (bulkContactsQueue.length === 0) {
      showSidepanelToast('Carregue contatos via CSV ou selecione uma lista.', 'error');
      return;
    }

    const template = msgInput.value.trim();
    if (!template) {
      showSidepanelToast('Digite uma mensagem para a campanha.', 'error');
      return;
    }

    const tab = await verificarConexaoWhatsApp();
    if (!tab) {
      showSidepanelToast('Abra o WhatsApp Web antes de iniciar os disparos.', 'error');
      return;
    }

    document.getElementById('btn-start-bulk').disabled = true;
    document.getElementById('btn-pause-bulk').disabled = false;
    document.getElementById('btn-stop-bulk').disabled = false;

    const progressBox = document.getElementById('campaign-progress-box');
    const progressBar = document.getElementById('campaign-progress-bar');
    const progressText = document.getElementById('campaign-progress-text');
    progressBox.classList.remove('hidden');
    progressBar.style.width = '0%';
    progressText.innerText = `0 de ${bulkContactsQueue.length} enviados`;

    try {
      await chrome.tabs.sendMessage(tab.id, {
        action: 'START_BULK_SEND',
        payload: {
          contacts: bulkContactsQueue,
          template,
          minDelay: parseInt(minSlider.value),
          maxDelay: parseInt(maxSlider.value)
        }
      });
    } catch (err) {
      document.getElementById('btn-start-bulk').disabled = false;
      document.getElementById('btn-pause-bulk').disabled = true;
      document.getElementById('btn-stop-bulk').disabled = true;
      showSidepanelToast('Não foi possível iniciar o disparo. Recarregue o WhatsApp Web.', 'error');
      return;
    }

    showSidepanelToast('Disparador iniciado no WhatsApp Web!', 'success');
  });

  // Pausar / Retomar (botão alterna conforme o estado da campanha)
  document.getElementById('btn-pause-bulk').addEventListener('click', async () => {
    const tab = await verificarConexaoWhatsApp();
    if (!tab) return;

    const btn = document.getElementById('btn-pause-bulk');
    const campanha = (await ZapStorage.get('campaign')) || {};
    const estaPausada = !!campanha.is_paused;

    if (estaPausada) {
      await chrome.tabs.sendMessage(tab.id, { action: 'RESUME_BULK_SEND' }).catch(() => null);
      btn.innerText = '⏸ Pausar';
      showSidepanelToast('Disparos retomados.', 'info');
    } else {
      await chrome.tabs.sendMessage(tab.id, { action: 'PAUSE_BULK_SEND' }).catch(() => null);
      btn.innerText = '▶ Retomar';
      showSidepanelToast('Disparos pausados.', 'info');
    }
  });

  // Parar
  document.getElementById('btn-stop-bulk').addEventListener('click', async () => {
    const tab = await verificarConexaoWhatsApp();
    if (tab) {
      await chrome.tabs.sendMessage(tab.id, { action: 'STOP_BULK_SEND' });
      document.getElementById('btn-start-bulk').disabled = false;
      document.getElementById('btn-pause-bulk').disabled = true;
      document.getElementById('btn-stop-bulk').disabled = true;
      showSidepanelToast('Disparos interrompidos.', 'info');
    }
  });
}

// Escuta atualizações de progresso vindas do content script
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'CAMPAIGN_PROGRESS') {
    const { index, total, status, finished, sent, failed } = message.payload || {};
    const progressBar = document.getElementById('campaign-progress-bar');
    const progressText = document.getElementById('campaign-progress-text');

    if (finished) {
      progressBar.style.width = '100%';
      progressText.innerText = `Concluído: ${sent || 0} enviados, ${failed || 0} falhas`;
      document.getElementById('btn-start-bulk').disabled = false;
      document.getElementById('btn-pause-bulk').disabled = true;
      document.getElementById('btn-pause-bulk').innerText = '⏸ Pausar';
      document.getElementById('btn-stop-bulk').disabled = true;
      return;
    }

    const pct = Math.round(((index + 1) / total) * 100);
    progressBar.style.width = `${pct}%`;
    progressText.innerText = `${index + 1} de ${total} processados (${pct}%)`;

    if (index + 1 >= total) {
      document.getElementById('btn-start-bulk').disabled = false;
      document.getElementById('btn-pause-bulk').disabled = true;
      document.getElementById('btn-stop-bulk').disabled = true;
    }
  }
});

/**
 * 5. EXTRATOR DE GRUPOS
 */
function configurarEventosExtrator() {
  const btnExtract = document.getElementById('btn-extract-group');
  const btnDownload = document.getElementById('btn-download-csv');
  const btnSaveList = document.getElementById('btn-save-as-list');
  const tbody = document.getElementById('extracted-table-body');
  const counter = document.getElementById('extracted-count');

  btnExtract.addEventListener('click', async () => {
    const tab = await verificarConexaoWhatsApp();
    if (!tab) {
      showSidepanelToast('Abra o WhatsApp Web e acesse um grupo primeiro.', 'error');
      return;
    }

    btnExtract.disabled = true;
    btnExtract.innerText = 'Extraindo... aguarde';

    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'EXTRACT_GROUP' });
      if (response && response.success && response.contatos) {
        extractedContactsCache = response.contatos;
        counter.innerText = extractedContactsCache.length;

        tbody.innerHTML = '';
        extractedContactsCache.forEach((c, i) => {
          const row = document.createElement('tr');
          const adminBadge = c.admin
            ? '<span class="tag-btn" style="background:#059669;color:#fff;">Admin</span>'
            : '<span style="color:#64748b;">Membro</span>';
          row.innerHTML = `
            <td>${i + 1}</td>
            <td><b>${escapeHtml(c.phone || c.rawPhone || '-')}</b></td>
            <td>${escapeHtml(c.name || '-')}</td>
            <td>${adminBadge}</td>
          `;
          tbody.appendChild(row);
        });

        btnDownload.disabled = false;
        btnSaveList.disabled = false;
        showSidepanelToast(`${extractedContactsCache.length} contatos extraídos!`, 'success');
      } else {
        throw new Error(response?.error || 'Falha ao extrair contatos do grupo.');
      }
    } catch (err) {
      showSidepanelToast(err.message, 'error');
    } finally {
      btnExtract.disabled = false;
      btnExtract.innerText = '⚡ Extrair Participantes do Grupo Aberto';
    }
  });

  // Baixar CSV
  btnDownload.addEventListener('click', () => {
    if (extractedContactsCache.length === 0) return;
    let csv = 'telefone,nome,funcao\n';
    extractedContactsCache.forEach((c) => {
      const tel = c.phone || c.rawPhone || '';
      const funcao = c.admin || 'Membro';
      csv += `${csvCell(tel)},${csvCell(c.name)},${csvCell(funcao)}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `contatos_grupo_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showSidepanelToast('Arquivo CSV baixado!', 'success');
  });

  // Salvar na Lista
  btnSaveList.addEventListener('click', async () => {
    if (extractedContactsCache.length === 0) return;
    const nome = prompt('Digite o nome da nova lista:', `Grupo Extraído ${new Date().toLocaleDateString('pt-BR')}`);
    if (!nome) return;

    const settings = await ZapStorage.getSettings();
    const lists = settings.lists || [];
    const novaLista = {
      id: `list_${Date.now()}`,
      name: nome.trim(),
      contacts: extractedContactsCache
    };

    lists.push(novaLista);
    await ZapStorage.set({ lists });
    await carregarListas();
    showSidepanelToast(`Lista "${novaLista.name}" criada com ${extractedContactsCache.length} contatos!`, 'success');
  });
}

/**
 * 6. GERENCIADOR DE LISTAS
 */
async function carregarListas() {
  const settings = await ZapStorage.getSettings();
  const lists = settings.lists || [];

  // Atualiza selects
  const aiListSelect = document.getElementById('ai-target-list');
  const bulkListSelect = document.getElementById('bulk-list-select');

  aiListSelect.innerHTML = '<option value="all">Todas as conversas (Geral)</option>';
  bulkListSelect.innerHTML = '<option value="">Selecione uma lista...</option>';

  lists.forEach((l) => {
    const count = l.contacts ? l.contacts.length : 0;
    aiListSelect.innerHTML += `<option value="${l.id}">${l.name} (${count} contatos)</option>`;
    bulkListSelect.innerHTML += `<option value="${l.id}">${l.name} (${count} contatos)</option>`;
  });

  if (settings.active_ai_list_id) {
    aiListSelect.value = settings.active_ai_list_id;
  }

  // Renderiza cards de listas (accordion com contatos editáveis)
  const container = document.getElementById('lists-container');
  container.innerHTML = '';

  if (lists.length === 0) {
    container.innerHTML = '<div class="empty-state">Nenhuma lista criada ainda.</div>';
    return;
  }

  lists.forEach((l) => {
    const aberta = expandedLists.has(l.id);
    const contatos = l.contacts || [];

    const linhas = contatos
      .map((c) => {
        const phone = normalizarTelefone(c.phone);
        const ehGrupo = c.type === 'group';
        const chave = ehGrupo ? 'g:' + (c.name || '') : phone;
        return `
          <div class="contact-row">
            ${ehGrupo
              ? '<span class="tag-btn" style="background:#0e7490;color:#fff;cursor:default;font-size:9px;">GRUPO</span>'
              : `<input type="checkbox" class="contact-check" data-phone="${phone}" data-name="${encodeURIComponent(c.name || '')}">`}
            <div class="contact-info">
              <span class="contact-name">${escapeHtml(c.name || 'Sem nome')}</span>
              <span class="contact-phone">${ehGrupo ? 'grupo monitorado via lista' : formatarTelefone(phone)}</span>
            </div>
            ${ehGrupo
              ? ''
              : `<button class="btn btn-sm btn-secondary btn-open-chat" data-phone="${phone}" title="Abrir conversa no WhatsApp">💬</button>`}
            <button class="btn btn-sm btn-danger btn-del-contact" data-chave="${chave}" data-tipo="${ehGrupo ? 'group' : 'contact'}" title="Remover">✕</button>
          </div>
        `;
      })
      .join('');

    const card = document.createElement('div');
    card.className = 'list-item-card list-item-block';
    card.dataset.listId = l.id;
    card.innerHTML = `
      <div class="list-item-header">
        <div class="list-item-info">
          <span class="list-item-name">${escapeHtml(l.name)}</span>
          <span class="list-item-count">${contatos.length} contatos</span>
        </div>
        <div class="list-item-actions">
          <button class="btn btn-sm btn-secondary btn-toggle-list">${aberta ? 'Ocultar' : 'Contatos'}</button>
          <button class="btn btn-sm btn-danger btn-del-list">Excluir</button>
        </div>
      </div>
      <div class="list-contacts ${aberta ? '' : 'hidden'}">
        <div class="inline-form contact-add-form">
          <select class="form-input contact-type-select" title="Tipo de contato">
            <option value="contact">📱 Contato</option>
            <option value="group">👥 Grupo</option>
          </select>
          <input type="tel" class="form-input contact-phone-input" placeholder="5511999999999">
          <input type="text" class="form-input contact-name-input" placeholder="Nome">
          <button class="btn btn-sm btn-primary btn-add-contact" title="Adicionar">+</button>
        </div>
        <small class="form-hint">Contato: DDI + DDD + número. Grupo: informe apenas o nome (monitorado pela IA — menção/resposta + cobrança).</small>
        <div class="contact-select-bar">
          <label class="contact-select-all-label">
            <input type="checkbox" class="contact-select-all"> Todos
          </label>
          <button class="btn btn-sm btn-success btn-use-selected">Usar no disparador</button>
        </div>
        <div class="contact-rows">
          ${linhas || '<div class="empty-state">Nenhum contato nesta lista.</div>'}
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

function configurarEventosListas() {
  document.getElementById('btn-create-list').addEventListener('click', async () => {
    const input = document.getElementById('new-list-name');
    const nome = input.value.trim();
    if (!nome) return;

    const settings = await ZapStorage.getSettings();
    const lists = settings.lists || [];
    lists.push({
      id: `list_${Date.now()}`,
      name: nome,
      contacts: []
    });

    await ZapStorage.set({ lists });
    input.value = '';

    const criada = lists[lists.length - 1];
    expandedLists.add(criada.id);

    await carregarListas();
    showSidepanelToast(`Lista "${nome}" criada!`, 'success');
  });

  const container = document.getElementById('lists-container');
  if (!container) return;

  // Delegação: os cards são recriados a cada carregarListas()
  container.addEventListener('click', async (e) => {
    const card = e.target.closest('.list-item-card');
    if (!card) return;

    const listId = card.dataset.listId;

    if (e.target.closest('.btn-toggle-list')) {
      if (expandedLists.has(listId)) expandedLists.delete(listId);
      else expandedLists.add(listId);
      await carregarListas();
      return;
    }

    if (e.target.closest('.btn-del-list')) {
      if (!confirm('Tem certeza que deseja excluir esta lista?')) return;

      const settings = await ZapStorage.getSettings();
      const lists = (settings.lists || []).filter((l) => l.id !== listId);
      await ZapStorage.set({ lists });
      expandedLists.delete(listId);
      await carregarListas();
      showSidepanelToast('Lista excluída.', 'info');
      return;
    }

    if (e.target.closest('.btn-add-contact')) {
      await adicionarContatoNaLista(card, listId);
      return;
    }

    const btnDelContact = e.target.closest('.btn-del-contact');
    if (btnDelContact) {
      await removerContatoDaLista(listId, btnDelContact.dataset.chave, btnDelContact.dataset.tipo);
      return;
    }

    const btnOpen = e.target.closest('.btn-open-chat');
    if (btnOpen) {
      await abrirConversaDoContato(btnOpen.dataset.phone);
      return;
    }

    if (e.target.closest('.btn-use-selected')) {
      usarSelecionadosNoDisparador(card);
    }
  });

  // Enter no campo de telefone adiciona o contato
  container.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    if (!e.target.closest('.contact-phone-input')) return;

    const card = e.target.closest('.list-item-card');
    if (!card) return;

    e.preventDefault();
    await adicionarContatoNaLista(card, card.dataset.listId);
  });

  // "Selecionar todos"
  container.addEventListener('change', (e) => {
    const selectAll = e.target.closest('.contact-select-all');
    if (!selectAll) return;

    const card = selectAll.closest('.list-item-card');
    card.querySelectorAll('.contact-check').forEach((cb) => {
      cb.checked = selectAll.checked;
    });
  });
}

/* =========================================================================
 * Ações de contatos das listas
 * ========================================================================= */

function normalizarTelefone(valor) {
  return (valor || '').replace(/\D/g, '');
}

function formatarTelefone(telefone) {
  const digits = normalizarTelefone(telefone);
  return digits ? `+${digits}` : '';
}

async function adicionarContatoNaLista(card, listId) {
  const phoneInput = card.querySelector('.contact-phone-input');
  const nameInput = card.querySelector('.contact-name-input');
  const typeSelect = card.querySelector('.contact-type-select');

  const tipo = typeSelect && typeSelect.value === 'group' ? 'group' : 'contact';
  const phone = normalizarTelefone(phoneInput?.value);
  const name = (nameInput?.value || '').trim();

  if (tipo === 'group') {
    if (!name) {
      showSidepanelToast('Informe o nome do grupo.', 'error');
      return;
    }
  } else if (phone.length < 10 || phone.length > 15) {
    showSidepanelToast('Telefone inválido. Use DDI + DDD + número (ex: 5511999999999).', 'error');
    return;
  }

  const settings = await ZapStorage.getSettings();
  const lists = settings.lists || [];
  const lista = lists.find((l) => l.id === listId);
  if (!lista) return;

  lista.contacts = lista.contacts || [];

  const jaExiste =
    tipo === 'group'
      ? lista.contacts.some((c) => c.type === 'group' && ZapStorage._nomesCombinam(c.name, name))
      : lista.contacts.some((c) => normalizarTelefone(c.phone) === phone);

  if (jaExiste) {
    showSidepanelToast(tipo === 'group' ? 'Esse grupo já está na lista.' : 'Esse telefone já está na lista.', 'info');
    return;
  }

  lista.contacts.push(tipo === 'group' ? { phone: '', name, type: 'group', groupId: null } : { phone, name });
  await ZapStorage.set({ lists });
  await carregarListas();
  showSidepanelToast(tipo === 'group' ? 'Grupo adicionado à lista.' : 'Contato adicionado.', 'success');
}

async function removerContatoDaLista(listId, chave, tipo) {
  const settings = await ZapStorage.getSettings();
  const lists = settings.lists || [];
  const lista = lists.find((l) => l.id === listId);
  if (!lista) return;

  lista.contacts = (lista.contacts || []).filter((c) => {
    if (tipo === 'group') {
      return !(c.type === 'group' && (c.name || '') === String(chave || '').replace(/^g:/, ''));
    }
    return normalizarTelefone(c.phone) !== normalizarTelefone(chave);
  });
  await ZapStorage.set({ lists });
  await carregarListas();
  showSidepanelToast('Contato removido.', 'info');
}

async function abrirConversaDoContato(phone) {
  const alvo = normalizarTelefone(phone);
  if (!alvo) return;

  const tab = await verificarConexaoWhatsApp();
  if (!tab) {
    showSidepanelToast('Abra o WhatsApp Web para iniciar a conversa.', 'error');
    return;
  }

  await chrome.tabs
    .sendMessage(tab.id, { action: 'OPEN_CHAT', payload: { phone: alvo } })
    .catch(() => null);

  showSidepanelToast('Abrindo conversa no WhatsApp...', 'info');
}

function usarSelecionadosNoDisparador(card) {
  const selecionados = Array.from(card.querySelectorAll('.contact-check'))
    .filter((cb) => cb.checked)
    .map((cb) => ({
      phone: cb.dataset.phone,
      name: decodeURIComponent(cb.dataset.name || '')
    }));

  if (selecionados.length === 0) {
    showSidepanelToast('Selecione ao menos um contato.', 'error');
    return;
  }

  bulkContactsQueue = selecionados;

  const contador = document.getElementById('contacts-loaded-count');
  if (contador) contador.innerText = `${selecionados.length} contatos selecionados da lista`;

  // Alterna para a aba do disparador
  document.querySelectorAll('.nav-tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === 'tab-bulk');
  });
  document.querySelectorAll('.tab-pane').forEach((p) => {
    p.classList.toggle('active', p.id === 'tab-bulk');
  });

  showSidepanelToast(`${selecionados.length} contatos carregados no disparador.`, 'success');
}

/**
 * 7. LOGS E HISTÓRICO
 */
async function carregarLogs() {
  const logs = (await ZapStorage.get('history_logs')) || [];
  const container = document.getElementById('logs-container');

  if (logs.length === 0) {
    container.innerHTML = '<div class="empty-state">Nenhuma atividade registrada ainda.</div>';
    return;
  }

  container.innerHTML = '';
  logs.slice(0, 50).forEach((l) => {
    const item = document.createElement('div');
    item.className = 'log-item';
    item.innerHTML = `
      <div class="log-header">
        <span class="log-type ${l.status}">${escapeHtml(l.type)} - ${escapeHtml(l.phone)}</span>
        <span>${escapeHtml(l.timestamp)}</span>
      </div>
      <div class="log-msg">${escapeHtml(l.message)}</div>
    `;
    container.appendChild(item);
  });

  document.getElementById('btn-clear-logs').onclick = async () => {
    await ZapStorage.set({ history_logs: [] });
    await carregarLogs();
    showSidepanelToast('Logs limpos.', 'info');
  };
}

/**
 * Funções Auxiliares
 */
function inserirTextoNaPosicao(textarea, texto) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const val = textarea.value;
  textarea.value = val.substring(0, start) + texto + val.substring(end);
  textarea.focus();
  textarea.selectionStart = textarea.selectionEnd = start + texto.length;
}

function showSidepanelToast(mensagem, tipo = 'info') {
  const toast = document.getElementById('sidepanel-toast');
  toast.innerText = mensagem;
  toast.classList.remove('hidden');

  if (tipo === 'success') toast.style.borderLeftColor = 'var(--primary)';
  else if (tipo === 'error') toast.style.borderLeftColor = 'var(--danger)';
  else toast.style.borderLeftColor = '#38bdf8';

  setTimeout(() => {
    toast.classList.add('hidden');
  }, 3500);
}

function escapeHtml(string) {
  const el = document.createElement('div');
  el.innerText = string;
  return el.innerHTML;
}

function csvCell(value) {
  let str = (value === null || value === undefined) ? '' : String(value);
  // Previne injeção de fórmula (Excel/Sheets interpretam células iniciadas por = + - @ ou tab)
  if (/^[=+\-@\t]/.test(str)) {
    str = "'" + str;
  }
  // Escapa aspas e envolve em aspas quando há vírgula, aspas ou quebra de linha
  if (/[",\n\r]/.test(str)) {
    str = '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * 8. CONFIGURAÇÕES & SELETORES DOM
 */
const SELECTOR_KEYS = [
  'unreadBadge',
  'chatFrame',
  'chatFrameTitle',
  'composeBox',
  'sendButton',
  'messageHistory',
  'messageText',
  'activeContactHeader'
];

const SELECTOR_LABELS = {
  unreadBadge: 'Badge de não lidas',
  chatFrame: 'Container da conversa',
  chatFrameTitle: 'Título na lista lateral',
  composeBox: 'Caixa de digitação',
  sendButton: 'Botão enviar',
  messageHistory: 'Balões de mensagem',
  messageText: 'Texto da mensagem',
  activeContactHeader: 'Contato ativo (topo)'
};

/**
 * Garante que cada campo de seletor tenha um badge de status ao lado.
 */
function garantirStatusSelector(key) {
  const input = document.getElementById(`sel-${key}`);
  if (!input) return null;

  let badge = document.querySelector(`[data-selector-status="${key}"]`);
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'selector-status pending';
    badge.dataset.selectorStatus = key;
    input.insertAdjacentElement('afterend', badge);
  }
  return badge;
}

/**
 * Renderiza o status (ativo / não encontrado / corrigido via IA) de cada seletor.
 * @param {object|null} results Retorno de AUTO_DETECT_SELECTORS. Sem results = limpa para "não verificado".
 */
function renderSelectorStatuses(results) {
  let encontrados = 0;
  let total = 0;

  SELECTOR_KEYS.forEach((key) => {
    const badge = garantirStatusSelector(key);
    if (!badge) return;

    const label = SELECTOR_LABELS[key] || key;
    const r = results ? results[key] : null;
    let estado = 'pending';
    let texto = '⚪ Não verificado';

    if (r) {
      total += 1;
      if (r.found) {
        encontrados += 1;
        estado = 'active';
        texto = r.autoDetected ? '✅ Ativo (corrigido via IA)' : '✅ Ativo';
      } else {
        estado = 'inactive';
        texto = '❌ Não encontrado';
      }
      badge.title = `${label}\n${r.selector || ''}${r.count != null ? `\n${r.count} elemento(s) no DOM` : ''}`;
    } else {
      badge.title = `${label} — clique em Auto-detectar para verificar`;
    }

    badge.className = `selector-status ${estado}`;
    badge.innerText = texto;
  });

  // Painel-resumo com a lista completa
  const btnAuto = document.getElementById('btn-auto-detect-selectors');
  const card = btnAuto?.closest('.card');
  if (!card) return;

  let resumo = document.getElementById('selector-status-summary');
  if (!resumo) {
    resumo = document.createElement('div');
    resumo.id = 'selector-status-summary';
    resumo.className = 'selector-status-summary';
    (btnAuto.closest('.campaign-actions') || btnAuto).insertAdjacentElement('beforebegin', resumo);
  }

  if (!results) {
    resumo.classList.add('hidden');
    resumo.innerHTML = '';
    return;
  }

  resumo.classList.remove('hidden');
  const linhas = SELECTOR_KEYS.map((key) => {
    const r = results[key];
    const label = escapeHtml(SELECTOR_LABELS[key] || key);
    const ok = !!r?.found;
    const detalhe = r?.found
      ? (r.autoDetected ? 'Ativo (IA)' : 'Ativo')
      : 'Não encontrado';
    return `<div class="selector-status-row">
      <span class="selector-status-name">${ok ? '✅' : '❌'} ${label}</span>
      <span class="selector-status-value ${ok ? 'ok' : 'fail'}">${detalhe}</span>
    </div>`;
  }).join('');

  resumo.innerHTML = `
    <div class="selector-status-summary-title">
      Resultado da detecção: ${encontrados}/${total} ativos
    </div>
    ${linhas}
  `;
}

/**
 * Preenche os campos de seletores com os valores efetivos (customizados ou padrão).
 * Consulta o content script quando o WhatsApp Web está disponível.
 */
async function carregarConfiguracoesSeletores() {
  let selectors = {};

  try {
    const tab = await verificarConexaoWhatsApp();
    if (tab) {
      const response = await chrome.tabs
        .sendMessage(tab.id, { action: 'GET_SELECTORS' })
        .catch(() => null);
      if (response && response.success) {
        selectors = response.selectors || {};
      }
    }
  } catch (_) {
    // Sem WhatsApp Web aberto: usa apenas os padrões locais
  }

  SELECTOR_KEYS.forEach((key) => {
    const input = document.getElementById(`sel-${key}`);
    if (!input) return;

    const entrada = selectors[key];
    const valor = (entrada && entrada.value) || SELECTORS_DEFAULTS[key]?.value || '';
    input.value = valor;
    input.placeholder = SELECTORS_DEFAULTS[key]?.value || '';
  });

  // Mostra os badges ainda não verificados (não apaga um resultado já exibido)
  renderSelectorStatuses(window.__lastSelectorResults || null);
}

/**
 * Liga os botões de salvar, restaurar padrões e auto-detectar seletores.
 */
function configurarEventosSeletores() {
  const btnSave = document.getElementById('btn-save-selectors');
  const btnReset = document.getElementById('btn-reset-selectors');
  const btnAuto = document.getElementById('btn-auto-detect-selectors');

  // Salvar seletores customizados (apenas os que diferem do padrão)
  btnSave?.addEventListener('click', async () => {
    const custom = {};

    SELECTOR_KEYS.forEach((key) => {
      const input = document.getElementById(`sel-${key}`);
      const value = input?.value.trim();
      if (value && value !== SELECTORS_DEFAULTS[key]?.value) {
        custom[key] = value;
      }
    });

    await ZapStorage.set({ selectors: custom });

    // Recarrega a cache de seletores no content script (GET_SELECTORS já reinicializa o driver)
    await carregarConfiguracoesSeletores();

    showSidepanelToast('Seletores salvos com sucesso!', 'success');
  });

  // Restaurar padrões
  btnReset?.addEventListener('click', async () => {
    await ZapStorage.set({ selectors: {} });

    SELECTOR_KEYS.forEach((key) => {
      const input = document.getElementById(`sel-${key}`);
      if (input) input.value = SELECTORS_DEFAULTS[key]?.value || '';
    });

    showSidepanelToast('Seletores restaurados para o padrão.', 'info');
  });

  // Auto-detectar com IA (delegado ao content script no WhatsApp Web)
  btnAuto?.addEventListener('click', async () => {
    const tab = await verificarConexaoWhatsApp();
    if (!tab) {
      showSidepanelToast('Abra o WhatsApp Web para auto-detectar os seletores.', 'error');
      return;
    }

    btnAuto.disabled = true;
    const textoOriginal = btnAuto.innerText;
    btnAuto.innerText = 'Detectando...';

    try {
      const response = await chrome.tabs
        .sendMessage(tab.id, { action: 'AUTO_DETECT_SELECTORS' })
        .catch(() => null);

      if (!response || !response.success) {
        throw new Error(response?.error || 'Falha ao auto-detectar seletores.');
      }

      const resultados = Object.values(response.results || {});
      const encontrados = resultados.filter((r) => r.found).length;
      const autoDetectados = resultados.filter((r) => r.autoDetected).length;

      window.__lastSelectorResults = response.results || null;
      await carregarConfiguracoesSeletores();
      renderSelectorStatuses(response.results || null);

      const falharam = resultados.filter((r) => !r.found).length;
      showSidepanelToast(
        `${encontrados}/${resultados.length} seletores ativos (${autoDetectados} via IA)` +
        (falharam ? ` — ${falharam} não encontrado(s).` : '.'),
        falharam ? 'info' : 'success'
      );
    } catch (err) {
      showSidepanelToast(err.message || 'Erro ao auto-detectar seletores.', 'error');
    } finally {
      btnAuto.disabled = false;
      btnAuto.innerText = textoOriginal;
    }
  });
}

/**
 * 9. GRUPOS MONITORADOS + TEMPORIZADOR DE COBRANÇA
 */
async function carregarGruposMonitorados() {
  const settings = await ZapStorage.getSettings();

  const mePhone = document.getElementById('me-phone-input');
  const meName = document.getElementById('me-name-input');
  const minutos = document.getElementById('followup-minutes-input');
  const max = document.getElementById('followup-max-input');
  const mensagem = document.getElementById('followup-message-input');

  if (mePhone) mePhone.value = settings.me_phone || '';
  if (meName) meName.value = settings.me_name || '';
  if (minutos) minutos.value = settings.followup_minutes || 15;
  if (max) max.value = settings.followup_max || 5;
  if (mensagem) mensagem.value = settings.followup_message || '';

  renderGruposMonitorados(settings.monitored_groups || []);
}

function renderGruposMonitorados(grupos) {
  const container = document.getElementById('monitored-groups-list');
  if (!container) return;
  container.innerHTML = '';

  if (!grupos || grupos.length === 0) {
    container.innerHTML = '<div class="empty-state">Nenhum grupo cadastrado.</div>';
    return;
  }

  grupos.forEach((g) => {
    const row = document.createElement('div');
    row.className = 'list-item-card list-item-block';
    row.dataset.groupId = g.id;
    row.innerHTML = `
      <div class="list-item-header">
        <div class="list-item-info">
          <span class="list-item-name">${escapeHtml(g.name)}</span>
          <span class="list-item-count">${g.groupId ? 'id detectado' : 'sem id ainda'}</span>
        </div>
        <div class="list-item-actions">
          <label class="contact-select-all-label">
            <input type="checkbox" class="monitored-group-toggle" ${g.enabled !== false ? 'checked' : ''}> monitorar
          </label>
          <button class="btn btn-sm btn-danger btn-del-monitored-group" title="Remover grupo">✕</button>
        </div>
      </div>
    `;
    container.appendChild(row);
  });
}

function configurarEventosGrupos() {
  const container = document.getElementById('monitored-groups-list');
  const input = document.getElementById('monitored-group-name');
  const btnAdd = document.getElementById('btn-add-monitored-group');
  const btnUseOpen = document.getElementById('btn-use-open-group');
  const btnSave = document.getElementById('btn-save-groups');

  async function persistir(grupos) {
    await ZapStorage.set({ monitored_groups: grupos });
    renderGruposMonitorados(grupos);
  }

  async function adicionarGrupo(nome) {
    const limpo = (nome || '').trim();
    if (!limpo) {
      showSidepanelToast('Informe o nome do grupo.', 'error');
      return false;
    }
    const settings = await ZapStorage.getSettings();
    const grupos = settings.monitored_groups || [];
    const jaExiste = grupos.some((g) => ZapStorage._nomesCombinam(g.name, limpo));
    if (jaExiste) {
      showSidepanelToast(`"${limpo}" já está cadastrado.`, 'info');
      return false;
    }
    grupos.push({ id: 'g_' + Date.now(), name: limpo, enabled: true, groupId: null });
    await persistir(grupos);
    showSidepanelToast(`Grupo "${limpo}" cadastrado!`, 'success');
    return true;
  }

  btnAdd?.addEventListener('click', async () => {
    const ok = await adicionarGrupo(input && input.value);
    if (ok && input) input.value = '';
  });

  btnUseOpen?.addEventListener('click', async () => {
    const tab = await verificarConexaoWhatsApp();
    if (!tab) {
      showSidepanelToast('Abra o WhatsApp Web e deixe o grupo aberto.', 'error');
      return;
    }
    try {
      const response = await chrome.tabs
        .sendMessage(tab.id, { action: 'GET_OPEN_GROUP' })
        .catch(() => null);
      if (response && response.success && response.name) {
        await adicionarGrupo(response.name);
      } else {
        showSidepanelToast('Abra o grupo no WhatsApp Web e tente de novo.', 'error');
      }
    } catch (err) {
      showSidepanelToast('Erro ao obter o grupo aberto.', 'error');
    }
  });

  container?.addEventListener('click', async (e) => {
    const btnDel = e.target.closest('.btn-del-monitored-group');
    if (!btnDel) return;
    const row = btnDel.closest('[data-group-id]');
    const id = row && row.dataset.groupId;
    const settings = await ZapStorage.getSettings();
    const grupos = (settings.monitored_groups || []).filter((g) => g.id !== id);
    await persistir(grupos);
    showSidepanelToast('Grupo removido.', 'info');
  });

  container?.addEventListener('change', async (e) => {
    const toggle = e.target.closest('.monitored-group-toggle');
    if (!toggle) return;
    const row = toggle.closest('[data-group-id]');
    const id = row && row.dataset.groupId;
    const settings = await ZapStorage.getSettings();
    const grupos = settings.monitored_groups || [];
    const grupo = grupos.find((g) => g.id === id);
    if (!grupo) return;
    grupo.enabled = toggle.checked;
    await persistir(grupos);
    showSidepanelToast(
      grupo.enabled ? `Monitorando "${grupo.name}".` : `Monitoramento de "${grupo.name}" pausado.`,
      'info'
    );
  });

  btnSave?.addEventListener('click', async () => {
    const minutos = parseInt(document.getElementById('followup-minutes-input').value, 10);
    const max = parseInt(document.getElementById('followup-max-input').value, 10);
    await ZapStorage.set({
      me_phone: document.getElementById('me-phone-input').value.trim(),
      me_name: document.getElementById('me-name-input').value.trim(),
      followup_minutes: Math.min(240, Math.max(1, minutos || 15)),
      followup_max: Math.min(50, Math.max(1, max || 5)),
      followup_message: document.getElementById('followup-message-input').value.trim()
    });
    showSidepanelToast('Grupos e temporizador salvos!', 'success');
  });
}
