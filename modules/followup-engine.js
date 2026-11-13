/**
 * FollowupEngine - Máquina de cobrança de retorno para grupos monitorados.
 * Estado: { [chaveGrupo]: { ultimaMsgBotMs, vencimentoMs, cobrancas } }.
 */
const FollowupEngine = {
  /**
   * Cria/renova o follow-up após o bot enviar uma mensagem.
   * Renovar reinicia a contagem de cobranças (novo ciclo de chamado).
   */
  criarOuRenovar(followups, chave, agoraMs, config) {
    if (!followups || !chave) return followups;
    const minutos = config.minutos || 15;
    followups[chave] = {
      ultimaMsgBotMs: agoraMs,
      vencimentoMs: agoraMs + minutos * 60000,
      cobrancas: 0
    };
    return followups;
  },

  /**
   * Avalia o estado no instante agoraMs.
   * @returns {{acao:'enviar'|'limpar'|'esperar', followups:object, mensagem:string|null}}
   */
  avaliar(followups, chave, agoraMs, houveResposta, config) {
    const minutos = config.minutos || 15;
    const maxCobrancas = config.maxCobrancas || 5;
    const mensagem = config.mensagem || '';

    const base = followups || {};

    if (!base[chave]) {
      return { acao: 'esperar', followups: base, mensagem: null };
    }

    if (houveResposta) {
      delete base[chave];
      return { acao: 'limpar', followups: base, mensagem: null };
    }

    const f = base[chave];
    if (agoraMs < f.vencimentoMs) {
      return { acao: 'esperar', followups: base, mensagem: null };
    }

    if (f.cobrancas >= maxCobrancas) {
      delete base[chave];
      return { acao: 'limpar', followups: base, mensagem: null };
    }

    f.cobrancas += 1;
    f.vencimentoMs = agoraMs + minutos * 60000;
    return { acao: 'enviar', followups: base, mensagem };
  },

  /**
   * Decide se vale a pena abrir o chat do grupo neste ciclo:
   * o vencimento chegou OU há badge de não lida (possível resposta).
   */
  deveVerificar(entrada, agoraMs, temNaoLida) {
    if (!entrada) return false;
    return agoraMs >= entrada.vencimentoMs || !!temNaoLida;
  },

  /**
   * Confirma que o chat aberto é mesmo o grupo esperado.
   * @param {{isGroup:boolean, groupId:string|null}} aberto Resultado de obterGrupoDoChatAtivo
   * @param {{groupId?:string|null}} cadastrado Grupo monitorado persistido
   * @returns {boolean}
   */
  confirmarGrupoAlvo(aberto, cadastrado) {
    if (!aberto || !aberto.isGroup) return false;
    if (cadastrado && cadastrado.groupId) {
      return String(aberto.groupId || '') === String(cadastrado.groupId);
    }
    return true;
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FollowupEngine;
}
