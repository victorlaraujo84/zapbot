/**
 * Content Script - ZapBot Pro
 * Injetado no WhatsApp Web para monitorar mensagens, controlar o disparador e auto-resposta por IA.
 */

let monitoramentoIniciado = false;
let campanhaEmAndamento = false;
let cicloDeAtendimento = null;
let comandosDeChatPendentes = 0;
let campaignState = {
  running: false,
  paused: false
};

// Map<contatoId, hashDaUltimaMensagemRespondida> — evita responder 2x a mesma msg
const mensagensRespondidas = new Map();
const gruposPendentes = new Map();
const mensagensVistas = new Map();
// Set de contatos que estão sendo processados agora — evita sobreposição de ciclos
const contatosEmProcessamento = new Set();
// Cache nome exibido no WhatsApp -> telefone real (descoberto ao abrir o chat)
const telefonesResolvidos = new Map();
// Cache dos últimos motivos de "pulo" logados por contato (evita spam de logs)
const ultimosSkipLogados = new Map();

// Inicialização após o WhatsApp Web carregar
window.addEventListener('load', () => {
  iniciarMonitoramento();
});

// Fallback caso a página já esteja carregada
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  iniciarMonitoramento();
}



async function iniciarMonitoramento() {
  if (monitoramentoIniciado) return;

  // Se o contexto da extensão ainda não está pronto, tenta de novo em 1s
  // (sem isso, a automação ficava morta até recarregar a página)
  if (!ZapStorage.isContextValid()) {
    setTimeout(iniciarMonitoramento, 1000);
    return;
  }

  monitoramentoIniciado = true;
  console.log('[ZapBot Pro] Content script inicializado no WhatsApp Web.');

  // Inicializa seletores configuráveis do storage
  if (typeof WADriver !== 'undefined' && WADriver.inicializarSeletores) {
    await WADriver.inicializarSeletores();
  }

  // Retoma a campanha caso a página tenha recarregado no meio de um disparo
  retomarCampanhaSePendente().catch(() => { });

  // Tenta injetar a barra de ferramentas no cabeçalho e cancela o timer se a extensão for recarregada
  const timerBarra = setInterval(() => {
    if (!ZapStorage.isContextValid()) {
      clearInterval(timerBarra);
      return;
    }
    injetarBarraSuperior().catch(() => { });
  }, 2000);

  // Monitora intervenção humana (digitação manual do usuário)
  monitorarIntervencaoHumana();

  // Loop proativo de varredura de chats com mensagens não lidas
  iniciarVarreduraChatsNaoLidos();
}

/**
 * Injeta a toolbar de status no cabeçalho do WhatsApp Web
 */
async function injetarBarraSuperior() {
  try {
    if (!ZapStorage.isContextValid()) return;

    const header = document.querySelector('#side header') || document.querySelector('header');
    if (!header) return;

    const settings = await ZapStorage.getSettings();
    const badgeClass = settings.ai_enabled ? 'active' : 'inactive';
    const badgeText = settings.ai_enabled ? 'IA Ativa' : 'IA Pausada';

    let toolbar = document.getElementById('zapbot-toolbar-root');

    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.id = 'zapbot-toolbar-root';
      toolbar.className = 'zapbot-injected-toolbar';

      toolbar.innerHTML = `
        <div id="zapbot-badge-status" class="zapbot-badge ${badgeClass}" title="Status do Atendente Inteligente">
          <span class="zapbot-badge-dot"></span>
          <span id="zapbot-badge-text">${badgeText}</span>
        </div>
        <button class="zapbot-btn" id="zapbot-btn-extract" title="Extrair contatos do grupo aberto">
          👥 Extrair
        </button>
      `;

      header.appendChild(toolbar);
    } else {
      // Atualiza o status a cada ciclo: ligar/desligar no painel reflete aqui
      const badge = toolbar.querySelector('#zapbot-badge-status');
      const texto = toolbar.querySelector('#zapbot-badge-text');
      if (badge) badge.className = 'zapbot-badge ' + badgeClass;
      if (texto) texto.textContent = badgeText;
    }

    // Ação de extrair contatos diretamente pelo botão injetado
    document.getElementById('zapbot-btn-extract')?.addEventListener('click', async () => {
      try {
        showToast('Iniciando rolagem e extração do grupo...', 'info');
        const contatos = await WADriver.extrairContatosGrupoAtual((qtd) => {
          showToast(`Extraindo membros... ${qtd} encontrados`, 'info');
        });
        showToast(`Extração concluída: ${contatos.length} contatos encontrados!`, 'success');

        // Salva na lista padrão (sem duplicar telefones já existentes)
        const settings = await ZapStorage.getSettings();
        const lists = settings.lists || [];
        if (lists.length > 0) {
          const contatosExistentes = new Set(
            (lists[0].contacts || []).map((c) => (c.phone || '').replace(/\D/g, ''))
          );

          const novos = [];
          contatos.forEach((c) => {
            const phone = (c.phone || c.rawPhone || '').replace(/\D/g, '');
            if (!phone || contatosExistentes.has(phone)) return;
            contatosExistentes.add(phone);
            novos.push({ phone, name: c.name || '' });
          });

          lists[0].contacts = [...(lists[0].contacts || []), ...novos];
          await ZapStorage.set({ lists });
        }

        await ZapStorage.addLog('GROUP_EXTRACT', 'Grupo Aberto', `${contatos.length} contatos extraídos.`, 'success');
      } catch (err) {
        showToast(err.message || 'Erro ao extrair grupo', 'error');
      }
    });
  } catch (err) {
    // Silencia qualquer exceção em contexto invalidado
  }
}

/**
 * Monitora digitação do atendente para ativar pausa humana temporária
 */
function monitorarIntervencaoHumana() {
  document.addEventListener('input', async (e) => {
    if (!ZapStorage.isContextValid()) return;
    // Ignora o evento sintético disparado pelo próprio bot ao enviar mensagem
    if (typeof WADriver !== 'undefined' && WADriver._enviando) return;
    const target = e.target;
    if (target && target.isContentEditable && target.closest('footer')) {
      const contatoAtivo = WADriver.obterContatoAtivo();
      if (contatoAtivo) {
        await ZapStorage.registerHumanIntervention(contatoAtivo);
      }
    }
  });
}

/**
 * Inicia o loop mestre de varredura de chats com mensagem não lida.
 * Substitui o antigo modo reativo (que só olhava o chat aberto na tela).
 */
function iniciarVarreduraChatsNaoLidos() {
  const timerVarredura = setInterval(async () => {
    if (!ZapStorage.isContextValid()) {
      clearInterval(timerVarredura);
      return;
    }

    // Evita sobreposição de ciclos de varredura
    if (cicloDeAtendimento || comandosDeChatPendentes) return;
    // Se já há contatos sendo processados, aguarda este ciclo terminar
    if (contatosEmProcessamento.size > 0) return;
    // Não interfere na campanha de disparo em massa
    if (campaignState.running) return;

    cicloDeAtendimento = (async () => {
      const settings = await ZapStorage.getSettings();
      if (!settings.ai_enabled) return;

      await varreduraChatsNaoLidos(settings);
      if (!comandosDeChatPendentes) await processarFollowups(settings);
    })();
    try {
      await cicloDeAtendimento;
    } catch (e) {
      console.warn('[ZapBot Pro] Erro no ciclo de varredura:', e);
      // Registra falhas silenciosas no Log (antes elas só apareciam no console)
      const msg = e && e.message ? e.message : String(e);
      if (DedupLog.nova(ultimosSkipLogados, 'erro-ciclo', msg.slice(0, 120))) {
        ZapStorage.addLog('SYSTEM', '-', `Erro no ciclo de varredura: ${msg}`, 'error').catch(() => {});
      }
    } finally {
      cicloDeAtendimento = null;
    }
  }, 10000); // Ciclo a cada 10 segundos
}

/**
 * Varre a lista lateral do WhatsApp procurando chats com badge de mensagem não lida.
 * Para cada um encontrado, abre o chat e aciona a IA se autorizado.
 * Fecha o chat após análise para retornar ao estado de prontidão.
 * @param {object} settings Configurações já carregadas do ZapStorage
 */
async function varreduraChatsNaoLidos(settings) {
  // Seleciona os contêineres de conversa na lista lateral usando seletor configurável
  const selectorFrame = WADriver._getSelector('chatFrame') || '[data-testid="cell-frame-container"]';
  const frames = document.querySelectorAll(selectorFrame);
  const gruposMonitorados = await ZapStorage.getMonitoredGroups();

  let naoLidasEncontradas = 0;

  for (const frame of frames) {
    if (comandosDeChatPendentes) break;
    // Verifica se este frame tem badge de não lida (badge, aria-label ou data-icon)
    const naoLida = WADriver.temMensagemNaoLida(frame);

    // Obtém o identificador do contato (nome ou telefone no título do frame)
    const tituloEl = WADriver.queryElSync('chatFrameTitle', frame) || frame.querySelector('span[title]');
    const contatoId =
      tituloEl?.getAttribute('title')?.trim() ||
      frame.getAttribute('aria-label')?.trim() ||
      frame.querySelector('span[title]')?.getAttribute('title')?.trim();

    if (!contatoId) {
      console.log('[ZapBot Pro] Item não lido sem título identificável. Pulando.', frame);
      continue;
    }

    const grupoCadastrado = gruposMonitorados.some((g) => ZapStorage.nomesDeGrupoIguais(contatoId, g.name));
    const jaAberto = grupoCadastrado && ZapStorage.nomesDeGrupoIguais(contatoId, WADriver.obterContatoAtivo());
    if (!naoLida && !jaAberto && !gruposPendentes.has(contatoId)) continue;
    const totalNaoLidas = WADriver.contarNaoLidas(frame);
    if (naoLida) naoLidasEncontradas += 1;
    // Pula se já está sendo processado neste ciclo
    if (contatosEmProcessamento.has(contatoId)) continue;

    // Autoriza pela lista ativa usando nome E telefone (se já conhecido)
    let autorizacao = await ZapStorage.checkAIAuthorization([
      contatoId,
      telefonesResolvidos.get(contatoId)
    ]);

    let abriu = false;

    // Não bateu pelo nome, mas existe uma lista ativa: abre o chat para descobrir
    // o telefone real (o título pode ser o nome da agenda) ou se é um grupo monitorado.
    if (!autorizacao.allowed && (autorizacao.code === 'contact_not_found' ||
      (grupoCadastrado && autorizacao.code === 'contact_list'))) {
      abriu = await WADriver.abrirChatDoFrame(frame, contatoId);

      if (abriu) {
        // Aguarda as mensagens renderizarem antes de detectar grupo/telefone
        await new Promise((r) => setTimeout(r, 800));

        const grupo = WADriver.obterGrupoDoChatAtivo();
        if (grupo.isGroup) {
          autorizacao = await ZapStorage.checkAIAuthorization([contatoId, grupo.groupId], {
            isGroup: true,
            groupId: grupo.groupId
          });
        } else {
          const telefone = WADriver.obterTelefoneDoChatAtivo();
          if (telefone) {
            telefonesResolvidos.set(contatoId, telefone);
            // Limita o tamanho do cache em memória
            if (telefonesResolvidos.size > 500) {
              telefonesResolvidos.delete(telefonesResolvidos.keys().next().value);
            }
            autorizacao = await ZapStorage.checkAIAuthorization([contatoId, telefone]);
          } else if (DedupLog.nova(ultimosSkipLogados, 'diag:' + contatoId, 'sem-grupo-sem-tel')) {
            // Diagnóstico: captura a "impressão digital" do DOM para identificar o formato atual
            const primeiro = document.querySelector('[data-id], [data-assigned-id]');
            const header = document.querySelector('#main header');
            await ZapStorage.addLog(
              'SYSTEM',
              contatoId,
              `Diag: primeiroId="${primeiro ? (primeiro.getAttribute('data-id') || primeiro.getAttribute('data-assigned-id') || '') : 'nenhum'}" header="${((header && header.innerText) || '').replace(/\s+/g, ' ').slice(0, 100)}"`,
              'warning'
            );
          }
        }
      }
    }

    if (!autorizacao.allowed) {
      console.log(`[ZapBot Pro] ${contatoId}: ${autorizacao.reason}. Pulando.`);
      if (DedupLog.nova(ultimosSkipLogados, contatoId, autorizacao.reason)) {
        await ZapStorage.addLog('SYSTEM', contatoId, `IA pulou: ${autorizacao.reason}`, 'warning');
      }
      if (abriu) {
        WADriver.fecharChatAtivo();
        await new Promise((r) => setTimeout(r, 600));
      }
      continue;
    }

    // Abre o chat (se ainda não foi aberto na etapa anterior) e confirma o contato
    if (!abriu) {
      abriu = await WADriver.abrirChatDoFrame(frame, contatoId);
      if (!abriu) {
        const campo = WADriver.obterCampoDigitacao();
        const headerAgora = WADriver.obterContatoAtivo();
        console.log(`[ZapBot Pro] Não foi possível abrir a conversa de ${contatoId}. Pulando.`);
        console.warn(
          `[ZapBot Pro] Diag abrir: campo=${campo ? 'sim' : 'não'} header="${headerAgora || 'null'}" alvo="${contatoId}"`
        );
        if (DedupLog.nova(ultimosSkipLogados, 'diag-abrir:' + contatoId, 'x')) {
          await ZapStorage.addLog(
            'SYSTEM',
            contatoId,
            `Diag abrir: campo=${campo ? 'sim' : 'não'} header="${headerAgora || 'null'}"`,
            'warning'
          );
        }
        continue;
      }
    }

    // Com o chat aberto, detecta se é grupo (mesmo quando a lista ativa é "todas"):
    // grupos só respondem se monitorados (e apenas sob menção/resposta ao bot)
    await new Promise((r) => setTimeout(r, 500));
    const destino = WADriver.capturarDestino(contatoId);
    if (!destino) continue;
    const grupoAtual = { ...destino.grupo, name: contatoId };
    if (grupoCadastrado && !grupoAtual.isGroup) {
      await logPulo(contatoId, 'grupo não identificado no chat ativo');
      continue;
    }
    if (grupoAtual.isGroup) {
      autorizacao = await ZapStorage.checkAIAuthorization([contatoId, grupoAtual.groupId], {
        isGroup: true,
        groupId: grupoAtual.groupId
      });
      if (!autorizacao.allowed) {
        console.log(`[ZapBot Pro] ${contatoId}: ${autorizacao.reason}. Pulando.`);
        if (DedupLog.nova(ultimosSkipLogados, contatoId, autorizacao.reason)) {
          await ZapStorage.addLog('SYSTEM', contatoId, `IA pulou: ${autorizacao.reason}`, 'warning');
        }
        WADriver.fecharChatAtivo();
        await new Promise((r) => setTimeout(r, 600));
        continue;
      }
      await registrarGroupIdMonitorado(contatoId, grupoAtual.groupId);
    }

    // Lê o histórico recente da conversa (aguarda o React renderizar as mensagens)
    if (!WADriver.destinoConfere(destino)) continue;
    const mensagens = WADriver.obterMensagensAtuais(50);
    const historico = mensagens.slice(-8).map((m) => (m.isMe ? 'Atendente: ' : 'Cliente: ') + m.texto);
    if (!historico || historico.length === 0) {
      console.log(`[ZapBot Pro] ${contatoId}: histórico vazio, não há o que responder.`);
      if (DedupLog.nova(ultimosSkipLogados, contatoId, 'histórico vazio')) {
        await ZapStorage.addLog('SYSTEM', contatoId, 'IA pulou: histórico vazio (seletor pode ter mudado)', 'warning');
      }
      WADriver.fecharChatAtivo();
      await new Promise((r) => setTimeout(r, 600));
      continue;
    }

    // Persiste as mensagens lidas na conversa (contexto durável da IA)
    const chaveConv = chaveConversa(contatoId, grupoAtual);
    const conversasAtuais = await anexarHistoricoNaConversa(chaveConv, historico);

    const ultima = mensagens.at(-1);
    let mensagem = ultima.isMe ? null : ultima;

    // Só responde se a última mensagem for do CLIENTE
    if (!grupoAtual.isGroup && !mensagem) {
      console.log(`[ZapBot Pro] ${contatoId}: última mensagem não é do cliente. Pulando.`);
      if (DedupLog.nova(ultimosSkipLogados, contatoId, 'última não é do cliente')) {
        await ZapStorage.addLog('SYSTEM', contatoId, 'IA pulou: última mensagem não identificada como do cliente', 'warning');
      }
      WADriver.fecharChatAtivo();
      await new Promise((r) => setTimeout(r, 600));
      continue;
    }

    // Em grupos monitorados, só responde se foi @mencionado ou respondido (citação)
    if (grupoAtual.isGroup) {
      const vista = mensagensVistas.get(chaveConv);
      const indice = vista ? mensagens.findIndex((m) => m.id === vista) : -1;
      const novas = indice >= 0 ? mensagens.slice(indice + 1) : naoLida ? mensagens.slice(-totalNaoLidas) : [];
      if (ultima.id) mensagensVistas.set(chaveConv, ultima.id);
      const anterior = gruposPendentes.get(contatoId);
      const fila = new Map(anterior?.chave === chaveConv ? anterior.mensagens : []);
      if (anterior && anterior.chave !== chaveConv) gruposPendentes.delete(contatoId);
      for (const m of novas) {
        if (m.isMe || !m.id || mensagensRespondidas.has(m.id) || fila.has(m.id)) continue;
        if (MentionDetector.detectar(WADriver.dadosDaMensagem(m.elemento, m.texto), settings.me_phone, settings.me_name)) {
          fila.set(m.id, { id: m.id, texto: m.texto });
        }
      }
      mensagem = fila.values().next().value;
      if (!mensagem) {
        console.log(`[ZapBot Pro] ${contatoId}: mensagem sem menção/resposta ao bot. Pulando.`);
        if (naoLida) await logPulo(contatoId, 'sem menção ou citação reconhecida nas mensagens novas');
        if (!jaAberto && WADriver.destinoConfere(destino)) WADriver.fecharChatAtivo();
        await new Promise((r) => setTimeout(r, 600));
        continue;
      }
      gruposPendentes.set(contatoId, { chave: chaveConv, mensagens: fila });
    }

    // Hash único: contato + conteúdo completo da última mensagem
    const hashMsg = mensagem.id || `${contatoId}::${mensagem.texto}`;
    if (mensagensRespondidas.has(hashMsg)) {
      console.log(`[ZapBot Pro] Mensagem de ${contatoId} já respondida. Pulando.`);
      WADriver.fecharChatAtivo();
      await new Promise((r) => setTimeout(r, 600));
      continue;
    }

    // Processa a resposta da IA para este contato
    contatosEmProcessamento.add(contatoId);
    try {
      const textoCliente = mensagem.texto;
      const contextoSalvo = ConversationStore.ultimas(conversasAtuais, chaveConv, 20);
      await processarAutoRespostaIA(contatoId, textoCliente, historico, settings, contextoSalvo, destino);
      // Registra o hash apenas após envio bem-sucedido
      mensagensRespondidas.set(hashMsg, true);
      // Em grupo monitorado, arma o temporizador de cobrança de retorno
      if (grupoAtual.isGroup) {
        const fila = gruposPendentes.get(contatoId).mensagens;
        fila.delete(hashMsg);
        if (!fila.size) gruposPendentes.delete(contatoId);
        await armarFollowupDoGrupo(grupoAtual, settings);
      }
      // Evita crescimento infinito do Map
      if (mensagensRespondidas.size > 300) {
        const chaveAntiga = mensagensRespondidas.keys().next().value;
        mensagensRespondidas.delete(chaveAntiga);
      }
    } catch (err) {
      if (err?.code === 'SEND_UNCONFIRMED' && grupoAtual.isGroup) {
        const fila = gruposPendentes.get(contatoId).mensagens;
        fila.delete(hashMsg);
        if (!fila.size) gruposPendentes.delete(contatoId);
      }
      const msgErro = (err && err.message) ? err.message : String(err);
      console.error(`[ZapBot Pro] Falha ao responder ${contatoId}:`, err);
      showToast(`❌ Falha ao responder ${contatoId}: ${msgErro}`, 'error');
      await ZapStorage.addLog('AI_RESPONSE', contatoId, `Erro ao responder: ${msgErro}`, 'error');
    } finally {
      contatosEmProcessamento.delete(contatoId);
      // Fecha a conversa ativa (simulando ESC) para retornar ao estado de monitoramento limpo
      if (!jaAberto && WADriver.destinoConfere(destino)) WADriver.fecharChatAtivo();
      await new Promise((r) => setTimeout(r, 800));
    }

    // Pequena pausa entre o processamento de contatos diferentes
    await new Promise((r) => setTimeout(r, 1500));
  }

  if (naoLidasEncontradas > 0) {
    console.log(`[ZapBot Pro] Varredura: ${naoLidasEncontradas} conversa(s) não lida(s) na lista.`);
  }
}

/**
 * Gera e envia resposta automática via IA com simulação humana
 * @param {string} contato Identificador do contato (nome/telefone)
 * @param {string} textoCliente Texto da mensagem do cliente
 * @param {string[]} historico Histórico recente da conversa
 * @param {object} settings Configurações do ZapStorage
 */
async function logPulo(contato, motivo) {
  if (DedupLog.nova(ultimosSkipLogados, contato, motivo)) {
    await ZapStorage.addLog('SYSTEM', contato, 'IA pulou: ' + motivo, 'warning');
  }
}

async function processarAutoRespostaIA(contato, textoCliente, historico, settings, contextoSalvo, destino) {
  showToast(`🤖 ZapBot: Analisando mensagem de ${contato}...`, 'info');

  // Solicita a geração da resposta ao Service Worker (que chama a API de IA)
  const response = await chrome.runtime.sendMessage({
    action: 'GENERATE_AI_RESPONSE',
    payload: {
      prompt: textoCliente,
      history: historico,
      settings,
      contextoSalvo
    }
  });

  if (!response || !response.success || !response.text) {
    throw new Error(response?.error || 'Não foi possível gerar a resposta da IA.');
  }

  const respostaGerada = response.text;

  // Simula delay humanizado de digitação baseado no tamanho da resposta (3s a 7s)
  const delaySimulado = Math.min(Math.max(respostaGerada.length * 35, 3000), 7000);
  await new Promise((r) => setTimeout(r, delaySimulado));

  // Envia a mensagem no chat ativo
  await WADriver.enviarMensagemTexto(respostaGerada, () => WADriver.destinoConfere(destino));

  await ZapStorage.addLog('AI_RESPONSE', contato, respostaGerada, 'success');
  showToast(`✅ Mensagem enviada para ${contato}!`, 'success');
}

/**
 * Chave de armazenamento de um grupo (conversas e follow-ups usam a mesma).
 */
function chaveGrupo(grupo) {
  return 'g:' + (grupo.groupId || 'n-' + ((grupo.name || '').toLowerCase()));
}

/**
 * Chave da conversa persistida: grupo usa chaveGrupo; contato usa dígitos (se >= 8) ou nome.
 */
function chaveConversa(contatoId, grupo) {
  if (grupo && grupo.isGroup) return chaveGrupo(grupo);
  const digitos = (contatoId || '').replace(/\D/g, '');
  return digitos.length >= 8 ? digitos : (contatoId || '').toLowerCase();
}

/**
 * Anexa as linhas do histórico (formato 'Cliente:/Atendente:') à conversa persistida.
 */
async function anexarHistoricoNaConversa(chave, historico) {
  try {
    const novas = (historico || []).map((linha) => {
      const ehBot = linha.startsWith('Atendente:');
      return {
        from: ehBot ? 'bot' : 'client',
        text: linha.replace(/^(Atendente|Cliente):\s*/, ''),
        ts: Date.now()
      };
    });
    let conversas = (await ZapStorage.get('conversations')) || {};
    conversas = ConversationStore.anexar(conversas, chave, novas);
    conversas = ConversationStore.podar(conversas);
    await ZapStorage.set({ conversations: conversas });
    return conversas;
  } catch (err) {
    console.warn('[ZapBot Pro] Erro ao salvar conversa:', err);
    return {};
  }
}

/**
 * Persiste o groupId no grupo monitorado (descoberto na primeira abertura do chat).
 */
async function registrarGroupIdMonitorado(nomeGrupo, groupId) {
  try {
    if (!groupId) return;
    const settings = await ZapStorage.getSettings();

    // Na seção "Grupos monitorados"
    const grupos = settings.monitored_groups || [];
    let mudouGrupos = false;
    for (const g of grupos) {
      if (!g.groupId && ZapStorage.nomesDeGrupoIguais(nomeGrupo, g.name)) {
        g.groupId = groupId;
        mudouGrupos = true;
      }
    }

    // Em contatos tipo 'group' das listas
    let mudouListas = false;
    for (const lista of settings.lists || []) {
      for (const c of lista.contacts || []) {
        if (c.type === 'group' && !c.groupId && ZapStorage.nomesDeGrupoIguais(nomeGrupo, c.name)) {
          c.groupId = groupId;
          mudouListas = true;
        }
      }
    }

    if (mudouGrupos) await ZapStorage.set({ monitored_groups: grupos });
    if (mudouListas) await ZapStorage.set({ lists: settings.lists });
  } catch (err) {
    console.warn('[ZapBot Pro] Erro ao registrar grupo monitorado:', err);
  }
}

/**
 * Arma/renova o temporizador de cobrança após o bot responder em um grupo monitorado.
 */
async function armarFollowupDoGrupo(grupo, settings) {
  try {
    const chave = chaveGrupo(grupo);
    const config = {
      minutos: settings.followup_minutes || 15,
      maxCobrancas: settings.followup_max || 5,
      mensagem: settings.followup_message || ''
    };
    let followups = (await ZapStorage.get('followups')) || {};
    followups = FollowupEngine.criarOuRenovar(followups, chave, Date.now(), config);
    await ZapStorage.set({ followups });
  } catch (err) {
    console.warn('[ZapBot Pro] Erro ao armar follow-up:', err);
  }
}

/**
 * Acha o frame da lista lateral cujo título casa (fuzzy) com o nome do grupo.
 */
function encontrarFramePorNome(nome) {
  const selectorFrame = WADriver._getSelector('chatFrame') || '[data-testid="cell-frame-container"]';
  const frames = document.querySelectorAll(selectorFrame);
  for (const frame of frames) {
    const tituloEl = WADriver.queryElSync('chatFrameTitle', frame) || frame.querySelector('span[title]');
    const titulo = (tituloEl && tituloEl.getAttribute('title') ? tituloEl.getAttribute('title') : '').trim();
    if (titulo && ZapStorage.nomesDeGrupoIguais(titulo, nome)) return frame;
  }
  return null;
}

/**
 * Processa os temporizadores de cobrança vencidos dos grupos monitorados:
 * sem resposta → envia cobrança e rearma; com resposta → limpa.
 */
async function processarFollowups(settings) {
  try {
    const grupos = await ZapStorage.getMonitoredGroups();
    if (!grupos.length) return;

    let followups = (await ZapStorage.get('followups')) || {};
    const config = {
      minutos: settings.followup_minutes || 15,
      maxCobrancas: settings.followup_max || 5,
      mensagem: settings.followup_message || ''
    };
    let mudou = false;
    const processadas = new Set();

    for (const grupo of grupos) {
      if (comandosDeChatPendentes) break;
      const chave = chaveGrupo(grupo);
      if (processadas.has(chave)) continue; // mesmo grupo na seção E na lista
      processadas.add(chave);

      const f = followups[chave];
      if (!f) continue;

      const frame = encontrarFramePorNome(grupo.name);
      if (!frame) continue; // grupo fora da lateral agora; tenta no próximo ciclo

      // Só abre o chat quando o vencimento chegou OU há badge de não lida
      // (evita "roubar" o chat aberto do usuário a cada ciclo de 10 s)
      if (!FollowupEngine.deveVerificar(f, Date.now(), WADriver.temMensagemNaoLida(frame))) continue;

      const abriu = await WADriver.abrirChatDoFrame(frame, grupo.name);
      if (!abriu) continue;

      // Confirma que o chat aberto é MESMO o grupo esperado (e o id, se já conhecido)
      const grupoAberto = WADriver.obterGrupoDoChatAtivo();
      if (!FollowupEngine.confirmarGrupoAlvo(grupoAberto, grupo)) {
        WADriver.fecharChatAtivo();
        await new Promise((r) => setTimeout(r, 600));
        continue;
      }

      await new Promise((r) => setTimeout(r, 600));
      const historico = WADriver.obterHistoricoConversaAtual(6);

      // Houve resposta = mensagem de cliente DEPOIS da última mensagem do bot
      let idxUltimoBot = -1;
      historico.forEach((l, i) => {
        if (l.startsWith('Atendente:')) idxUltimoBot = i;
      });
      const houveResposta = historico.some((l, i) => i > idxUltimoBot && l.startsWith('Cliente:'));

      const destino = WADriver.capturarDestino(grupo.name);
      if (!destino || !FollowupEngine.confirmarGrupoAlvo(destino.grupo, grupo)) continue;
      const resultado = FollowupEngine.avaliar(followups, chave, Date.now(), houveResposta, config);
      if (resultado.acao === 'enviar') {
        try {
          await WADriver.enviarMensagemTexto(resultado.mensagem, () => WADriver.destinoConfere(destino));
        } catch (erro) {
          if (erro.code !== 'SEND_UNCONFIRMED') throw erro;
          delete followups[chave];
          await ZapStorage.set({ followups });
          await ZapStorage.addLog('AI_RESPONSE', grupo.name, erro.message, 'error');
          continue;
        }
        await ZapStorage.addLog('AI_RESPONSE', grupo.name, resultado.mensagem, 'success');
        showToast(`⏰ Cobrança enviada no grupo ${grupo.name}`, 'info');
      } else if (resultado.acao === 'limpar') {
        await ZapStorage.addLog('SYSTEM', grupo.name, 'Cobrança encerrada (resposta recebida ou teto atingido).', 'success');
      }
      followups = resultado.followups;
      mudou = true;

      WADriver.fecharChatAtivo();
      await new Promise((r) => setTimeout(r, 800));
    }

    if (mudou) await ZapStorage.set({ followups });
  } catch (e) {
    console.warn('[ZapBot Pro] Erro ao processar follow-ups:', e);
  }
}

/**
 * Escuta comandos vindos do Painel Lateral (Side Panel)
 */
let filaDeComandosDeChat = Promise.resolve();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const alteraChat = ['OPEN_CHAT', 'EXTRACT_GROUP', 'START_BULK_SEND', 'RESUME_BULK_SEND'].includes(message?.action);
  let anterior;
  let liberar;
  if (alteraChat) {
    comandosDeChatPendentes++;
    anterior = filaDeComandosDeChat;
    filaDeComandosDeChat = new Promise((resolve) => { liberar = resolve; });
  }
  (async () => {
    if (alteraChat) {
      await anterior;
      await cicloDeAtendimento?.catch(() => {});
    }
    const { action, payload } = message || {};

    switch (action) {
      case 'CHECK_STATUS':
        sendResponse({ ready: true, url: window.location.href });
        break;

      case 'GET_OPEN_GROUP': {
        const nomeAberto = WADriver.obterContatoAtivo();
        if (nomeAberto && WADriver.obterGrupoDoChatAtivo().isGroup) {
          sendResponse({ success: true, name: nomeAberto });
        } else {
          sendResponse({ success: false, error: 'Nenhum chat aberto no momento.' });
        }
        break;
      }

      case 'GET_SELECTORS': {
        try {
          await WADriver.inicializarSeletores();
          const selectors = WADriver.getSelectorsDefaults();
          sendResponse({ success: true, selectors });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
        break;
      }

      case 'AUTO_DETECT_SELECTORS': {
        try {
          const defaults = typeof SELECTORS_DEFAULTS !== 'undefined' ? SELECTORS_DEFAULTS : {};
          const results = {};
          const contar = (sel) => {
            if (!sel) return 0;
            try {
              return document.querySelectorAll(sel).length;
            } catch (_) {
              return 0;
            }
          };

          for (const [key, defn] of Object.entries(defaults)) {
            // Se o seletor atual já funciona, mantém
            const currentEl = WADriver.queryElSync(key);
            if (currentEl) {
              const atual = WADriver._getSelector(key);
              results[key] = {
                found: true,
                selector: atual,
                autoDetected: false,
                count: contar(atual)
              };
              continue;
            }
            // Se falhou, pede auxílio à IA
            const novo = await WADriver._consultarIAParaSeletor(key, defn.description, document);
            if (novo && contar(novo) > 0) {
              await ZapStorage.updateSelector(key, novo);
              WADriver._customSelectors[key] = novo;
              results[key] = {
                found: true,
                selector: novo,
                autoDetected: true,
                count: contar(novo)
              };
            } else {
              results[key] = {
                found: false,
                selector: defn.value,
                autoDetected: false,
                count: contar(defn.value)
              };
            }
          }
          sendResponse({ success: true, results });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
        break;
      }

      case 'EXTRACT_GROUP': {
        try {
          const contatos = await WADriver.extrairContatosGrupoAtual((qtd) => {
            showToast(`Extraindo membros... ${qtd} encontrados`, 'info');
          });
          sendResponse({ success: true, contatos });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
        break;
      }

      case 'OPEN_CHAT': {
        const phone = (payload?.phone || '').replace(/\D/g, '');
        if (!phone) {
          sendResponse({ success: false, error: 'Telefone inválido.' });
          break;
        }

        // Responde antes de navegar: o deep link do WhatsApp recarrega a página
        sendResponse({ success: true, phone });
        await new Promise((resolve) => setTimeout(resolve, 200));
        WADriver.navegarParaConversa(phone);
        break;
      }

      case 'START_BULK_SEND': {
        await iniciarCampanha(payload);
        sendResponse({ success: true, message: 'Disparo iniciado' });
        break;
      }

      case 'PAUSE_BULK_SEND': {
        campaignState.paused = true;
        await salvarCampanha({ is_paused: true });
        sendResponse({ success: true });
        break;
      }

      case 'RESUME_BULK_SEND': {
        campaignState.paused = false;
        await salvarCampanha({ is_paused: false });
        executarFilaCampanha();
        sendResponse({ success: true });
        break;
      }

      case 'STOP_BULK_SEND': {
        campaignState.running = false;
        campaignState.paused = false;
        await salvarCampanha({ is_running: false, is_paused: false, awaiting_send: false });
        sendResponse({ success: true });
        break;
      }

      default:
        sendResponse({ success: false, error: 'Comando não reconhecido' });
    }
  })().catch((erro) => {
    sendResponse({ success: false, error: erro.message });
  }).finally(() => {
    if (alteraChat) {
      comandosDeChatPendentes--;
      liberar();
    }
  });

  return true;
});

/* =========================================================================
 * DISPARADOR EM MASSA PERSISTENTE
 * O WhatsApp Web recarrega a página ao abrir um deep link (/send?phone=...).
 * Por isso o estado da campanha é salvo no storage: ao recarregar, o content
 * script é reinjetado e retoma exatamente do contato pendente.
 * ========================================================================= */

async function lerCampanha() {
  try {
    return (await ZapStorage.get('campaign')) || {};
  } catch (_) {
    return {};
  }
}

async function salvarCampanha(patch) {
  const atual = await lerCampanha();
  const nova = { ...ZapStorage.defaults.campaign, ...atual, ...patch };
  await ZapStorage.set({ campaign: nova });
  return nova;
}

function montarMensagem(template, nome) {
  const msg = (template || '').replace(/\{\{nome\}\}/gi, nome || 'Cliente');
  return msg.replace(/\{\{saudacao\}\}/gi, obterSaudacao());
}

function notificarProgresso(index, total, phone, status, error) {
  try {
    chrome.runtime
      .sendMessage({
        action: 'CAMPAIGN_PROGRESS',
        payload: { index, total, phone, status, error }
      })
      .catch(() => { });
  } catch (_) { }
}

/**
 * Inicia uma nova campanha a partir do payload do painel.
 */
async function iniciarCampanha(payload) {
  const { contacts = [], template = '', minDelay = 8, maxDelay = 20 } = payload || {};

  const validos = (contacts || [])
    .map((c) => ({ phone: (c.phone || '').replace(/\D/g, ''), name: c.name || 'Cliente' }))
    .filter((c) => c.phone.length >= 8);

  if (validos.length === 0) {
    showToast('Nenhum contato válido para disparar.', 'error');
    return;
  }

  campaignState.running = true;
  campaignState.paused = false;

  await salvarCampanha({
    is_running: true,
    is_paused: false,
    current_index: 0,
    contacts: validos,
    message_template: template,
    min_delay: Math.max(1, parseInt(minDelay, 10) || 8),
    max_delay: Math.max(2, parseInt(maxDelay, 10) || 20),
    awaiting_send: false,
    sent_count: 0,
    failed_count: 0
  });

  showToast(`Iniciando envio para ${validos.length} contatos...`, 'info');
  executarFilaCampanha();
}

/**
 * Retoma a campanha após um recarregamento de página provocado pelo deep link.
 * Só age se havia um envio pendente (evita reiniciar campanha pausada/parada).
 */
async function retomarCampanhaSePendente() {
  const campanha = await lerCampanha();
  if (!campanha.is_running || !campanha.awaiting_send) return;

  campaignState.running = true;
  campaignState.paused = !!campanha.is_paused;

  console.log('[ZapBot Pro] Retomando campanha após recarregar a página...');
  executarFilaCampanha();
}

function executarFilaCampanha() {
  if (campanhaEmAndamento) return;

  campanhaEmAndamento = true;
  processarFilaCampanha()
    .catch((err) => console.error('[ZapBot Pro] Erro na campanha:', err))
    .finally(() => {
      campanhaEmAndamento = false;
    });
}

/**
 * Aguarda enquanto a campanha estiver pausada; revalida o estado no storage.
 */
async function aguardarFimDaPausa() {
  while (campaignState.paused && campaignState.running) {
    await new Promise((r) => setTimeout(r, 1000));
    const campanha = await lerCampanha();
    if (!campanha.is_running) {
      campaignState.running = false;
      return;
    }
    campaignState.paused = !!campanha.is_paused;
  }
}

/**
 * Delay aleatório anti-ban entre contatos.
 */
async function pausaAntiBan(campanha) {
  const min = Math.max(1, campanha.min_delay || 8);
  const max = Math.max(min, campanha.max_delay || 20);
  const segundos = Math.floor(Math.random() * (max - min + 1)) + min;

  showToast(`Aguardando ${segundos}s (Anti-Ban)...`, 'info');
  await new Promise((r) => setTimeout(r, segundos * 1000));
}

/**
 * Verifica se a última mensagem enviada pelo atendente já é igual ao texto,
 * para evitar envio duplicado após um recarregamento da página no meio do disparo.
 */
async function mensagemJaEnviada(texto) {
  try {
    const alvo = (texto || '').trim();
    if (!alvo) return false;
    const historico = WADriver.obterHistoricoConversaAtual(4);
    const doAtendente = historico.filter((l) => l.startsWith('Atendente:'));
    return doAtendente.some((l) => l.includes(alvo));
  } catch (_) {
    return false;
  }
}

/**
 * Envia a mensagem para o contato de índice informado, assumindo que a
 * conversa já está aberta (fluxo de retomada pós-recarregamento).
 * @returns {Promise<boolean>} true se enviou com sucesso
 */
async function enviarContatoDaCampanha(campanha, indice) {
  const contato = (campanha.contacts || [])[indice];
  if (!contato) return false;

  const phone = (contato.phone || '').replace(/\D/g, '');
  const nome = contato.name || 'Cliente';
  const total = (campanha.contacts || []).length;

  try {
    showToast(`Enviando [${indice + 1}/${total}] para ${nome}...`, 'info');

    // Aguarda a conversa carregar (a página acabou de recarregar)
    await WADriver.aguardarCarregamentoConversa(30000);
    await new Promise((r) => setTimeout(r, 900));

    const msg = montarMensagem(campanha.message_template, nome);

    // Evita reenvio duplicado quando a página recarregou logo após o envio
    if (await mensagemJaEnviada(msg)) {
      await ZapStorage.addLog('BULK_SEND', phone, `${msg} (já enviada — ignorada)`, 'success');
      notificarProgresso(indice, total, phone, 'success');
      return true;
    }

    await WADriver.enviarMensagemTexto(msg);

    await ZapStorage.addLog('BULK_SEND', phone, msg, 'success');
    notificarProgresso(indice, total, phone, 'success');
    return true;
  } catch (err) {
    console.warn('[ZapBot Pro] Falha ao enviar para', phone, err);
    await ZapStorage.addLog('BULK_SEND', phone, `Erro: ${err.message}`, 'error');
    notificarProgresso(indice, total, phone, 'error', err.message);
    return false;
  }
}

/**
 * Laço principal da campanha.
 */
async function processarFilaCampanha() {
  let campanha = await lerCampanha();
  if (!campanha.is_running) return;

  const total = (campanha.contacts || []).length;
  campaignState.running = true;
  campaignState.paused = !!campanha.is_paused;

  // 1) Envio pendente: a página recarregou depois de abrir a conversa
  if (campanha.awaiting_send) {
    const indice = campanha.current_index || 0;
    const sucesso = await enviarContatoDaCampanha(campanha, indice);

    campanha = await salvarCampanha({
      awaiting_send: false,
      current_index: indice + 1,
      sent_count: (campanha.sent_count || 0) + (sucesso ? 1 : 0),
      failed_count: (campanha.failed_count || 0) + (sucesso ? 0 : 1)
    });

    if (campanha.current_index >= total) return finalizarCampanha();
    await pausaAntiBan(campanha);
  }

  // 2) Laço normal: navega para o próximo contato e envia
  while (campaignState.running) {
    campanha = await lerCampanha();
    if (!campanha.is_running) {
      campaignState.running = false;
      return;
    }

    await aguardarFimDaPausa();
    if (!campaignState.running) return;

    const indice = campanha.current_index || 0;
    if (indice >= total) return finalizarCampanha();

    const contato = (campanha.contacts || [])[indice] || {};
    const phone = (contato.phone || '').replace(/\D/g, '');
    const nome = contato.name || 'Cliente';

    if (!phone) {
      campanha = await salvarCampanha({
        current_index: indice + 1,
        failed_count: (campanha.failed_count || 0) + 1
      });
      continue;
    }

    try {
      showToast(`Abrindo conversa [${indice + 1}/${total}] com ${nome}...`, 'info');

      // Marca o envio como pendente ANTES de navegar: a navegação pode recarregar a página
      await salvarCampanha({ awaiting_send: true, current_index: indice, is_running: true });

      WADriver.navegarParaConversa(phone);

      // Se o WhatsApp tratar o deep link sem recarregar, o fluxo continua daqui
      await WADriver.aguardarCarregamentoConversa(20000);
      await new Promise((r) => setTimeout(r, 900));

      const msg = montarMensagem(campanha.message_template, nome);
      await WADriver.enviarMensagemTexto(msg);

      await ZapStorage.addLog('BULK_SEND', phone, msg, 'success');
      notificarProgresso(indice, total, phone, 'success');

      campanha = await salvarCampanha({
        awaiting_send: false,
        current_index: indice + 1,
        sent_count: (campanha.sent_count || 0) + 1
      });
    } catch (err) {
      console.warn('[ZapBot Pro] Erro ao enviar para', phone, err);
      await ZapStorage.addLog('BULK_SEND', phone, `Erro: ${err.message}`, 'error');
      notificarProgresso(indice, total, phone, 'error', err.message);

      campanha = await salvarCampanha({
        awaiting_send: false,
        current_index: indice + 1,
        failed_count: (campanha.failed_count || 0) + 1
      });
    }

    if ((campanha.current_index || 0) >= total) return finalizarCampanha();
    await pausaAntiBan(campanha);
  }
}

async function finalizarCampanha() {
  campaignState.running = false;
  campaignState.paused = false;

  const campanha = await salvarCampanha({ is_running: false, is_paused: false, awaiting_send: false });

  showToast('Disparo em massa concluído!', 'success');

  try {
    chrome.runtime
      .sendMessage({
        action: 'CAMPAIGN_PROGRESS',
        payload: {
          finished: true,
          sent: campanha.sent_count || 0,
          failed: campanha.failed_count || 0
        }
      })
      .catch(() => { });
  } catch (_) { }
}

function obterSaudacao() {
  const hora = new Date().getHours();
  if (hora >= 5 && hora < 12) return 'Bom dia';
  if (hora >= 12 && hora < 18) return 'Boa tarde';
  return 'Boa noite';
}

function showToast(mensagem, tipo = 'info') {
  const toastExistente = document.querySelector('.zapbot-toast');
  if (toastExistente) toastExistente.remove();

  const toast = document.createElement('div');
  toast.className = 'zapbot-toast';

  let icone = 'ℹ️';
  if (tipo === 'success') icone = '✅';
  if (tipo === 'error') icone = '❌';

  // Mensagem escapada: nomes vindos do WhatsApp nunca viram HTML executável
  toast.innerHTML = `<span>${icone}</span><span>${TextUtils.escapeHtml(String(mensagem ?? ''))}</span>`;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 4000);
}
