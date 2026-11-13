/**
 * Background Service Worker (Manifest V3)
 * Gerencia a abertura do Side Panel, conexões com APIs de IA e rotinas em background.
 */

// Importa os módulos no contexto do Service Worker
importScripts('../modules/storage-manager.js', '../modules/ai-responder.js');

// Configura o comportamento do clique no ícone da extensão para abrir o Side Panel
chrome.runtime.onInstalled.addListener(async () => {
  try {
    if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    }
  } catch (err) {
    console.warn('setPanelBehavior não suportado ou falhou:', err);
  }

  // Define status inicial do badge
  await atualizarBadgeStatus();
});

// Fallback para abrir o sidePanel caso o action click não tenha aberto automaticamente
chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (chrome.sidePanel && chrome.sidePanel.open) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    }
  } catch (err) {
    console.error('Erro ao abrir o painel lateral:', err);
  }
});

// Listener central de mensageria
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      const { action, payload } = message || {};

      switch (action) {
        case 'GENERATE_AI_RESPONSE': {
          const { prompt, history, settings, contextoSalvo } = payload || {};
          const resposta = await AIResponder.gerarResposta(prompt, history, settings, contextoSalvo);
          sendResponse({ success: true, text: resposta });
          break;
        }

        case 'UPDATE_BADGE': {
          await atualizarBadgeStatus();
          sendResponse({ success: true });
          break;
        }

        case 'LOG_EVENT': {
          const { type, phone, message: msg, status } = payload || {};
          const log = await ZapStorage.addLog(type, phone, msg, status);
          sendResponse({ success: true, log });
          break;
        }

        default:
          sendResponse({ success: false, error: 'Ação desconhecida no Service Worker' });
      }
    } catch (error) {
      console.error('Erro ao processar mensagem no Service Worker:', error);
      sendResponse({ success: false, error: error.message || 'Erro interno' });
    }
  })();

  // Mantém o canal aberto para resposta assíncrona
  return true;
});

/**
 * Atualiza o badge do ícone da extensão baseado no status da IA
 */
async function atualizarBadgeStatus() {
  try {
    const settings = await ZapStorage.getSettings();
    if (settings.ai_enabled) {
      await chrome.action.setBadgeText({ text: 'ON' });
      await chrome.action.setBadgeBackgroundColor({ color: '#10b981' }); // Verde Esmeralda
    } else {
      await chrome.action.setBadgeText({ text: '' });
    }
  } catch (err) {
    console.warn('Erro ao atualizar badge:', err);
  }
}
