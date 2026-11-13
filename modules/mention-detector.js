/**
 * MentionDetector - Detecta se a última mensagem de um grupo menciona o bot
 * (@telefone ou @nome) ou responde (citação) a uma mensagem dele.
 */
const MentionDetector = {
  /**
   * Extrai apenas os dígitos de um telefone/menção.
   */
  normalizarTelefone(str) {
    return (str || '').toString().replace(/\D/g, '');
  },

  _normalizarTexto(str) {
    return (str || '')
      .toString()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  },

  /**
   * @param {{texto:string, mentions:string[], autorQuote:string|null}} dados
   *   texto = texto da última mensagem; mentions = telefones extraídos do DOM;
   *   autorQuote = autor do bloco de citação (null se não há citação).
   * @param {string} mePhoneDigits Meu número (só dígitos)
   * @param {string} meNome Meu nome (opcional)
   * @returns {'mencao'|'resposta'|null}
   */
  detectar(dados, mePhoneDigits, meNome) {
    if (!dados) return null;
    const meDigits = this.normalizarTelefone(mePhoneDigits);
    const texto = dados.texto || '';

    // 1) Menção por telefone (DOM ou texto formatado)
    if (meDigits) {
      const mentions = Array.isArray(dados.mentions) ? dados.mentions : [];
      const semDdi = (n) => /^55\d{10,11}$/.test(n) ? n.slice(2) : n;
      const confere = (m) => semDdi(this.normalizarTelefone(m)) === semDdi(meDigits);
      if (mentions.some(confere)) return 'mencao';

      const re = /@[\d\s\-()+.]{8,}/g;
      const achados = texto.match(re) || [];
      if (achados.some(confere)) return 'mencao';
    }

    // 2) Menção por nome no texto (ex.: "@ZapBot me ajuda")
    if (meNome && meNome.trim()) {
      const alvo = this._normalizarTexto(meNome);
      const nome = alvo.replace(/[.*+?^\x24{}()|[\]\\]/g, '\\$&');
      const mencao = new RegExp('(?:^|[^\\p{L}\\p{N}_])@' + nome + '(?![\\p{L}\\p{N}_])', 'u');
      if (mencao.test(this._normalizarTexto(texto))) return 'mencao';
    }

    // 3) Resposta (citação) a uma mensagem do bot
    const autorQuote = (dados.autorQuote || '').toString().trim();
    if (autorQuote) {
      const autor = this._normalizarTexto(autorQuote.replace(/:\s*$/, ''));
      if (autor === 'voce' || autor === 'you') return 'resposta';
      if (meNome && meNome.trim()) {
        const alvo = this._normalizarTexto(meNome);
        if (autor === alvo) return 'resposta';
        // Comparação por palavra inteira (evita "Ana" casar com "Mariana")
        const palavrasAutor = autor.split(' ').filter(Boolean);
        const palavrasAlvo = alvo.split(' ').filter(Boolean);
        if (palavrasAutor.length && palavrasAlvo.length && palavrasAutor[0] === palavrasAlvo[0]) {
          return 'resposta';
        }
        if (palavrasAlvo.length === 1 && palavrasAutor.includes(palavrasAlvo[0])) {
          return 'resposta';
        }
      }
    }

    return null;
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MentionDetector;
}
