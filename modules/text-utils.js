/**
 * TextUtils - Helpers de texto seguros para o content script.
 */
const TextUtils = {
  /**
   * Escapa texto para inserção segura em HTML.
   * @param {*} str
   * @returns {string}
   */
  escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TextUtils;
}
