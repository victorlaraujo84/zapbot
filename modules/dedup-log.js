/**
 * DedupLog - Registra um motivo de log uma única vez por chave (evita spam).
 */
const DedupLog = {
  /**
   * Retorna true se o par (chave, motivo) é novo (e registra); false se já visto.
   * @param {Map} mapa
   * @param {string} chave
   * @param {string} motivo
   * @returns {boolean}
   */
  nova(mapa, chave, motivo) {
    if (!mapa) return false;
    if (mapa.get(chave) === motivo) return false;
    mapa.set(chave, motivo);
    return true;
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DedupLog;
}
