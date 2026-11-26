/* =========================================================================
   Leitura da "Sequência Aplicação Aérea" → pistaaerea.json
   Cada aba é uma pista de voo (Pirapitinga, Tupaciguara, Café, Planalto, Drone…) com as colunas
   OS · FAZENDA · HA · OPERAÇÃO · Data abertura da OS. A aba "Resumo" NÃO é usada: os totais
   são recalculados a partir das abas das pistas (o Resumo da planilha costuma ficar desatualizado).
   O nome da pista vem do nome da aba (o título dentro da aba pode estar copiado de outra pista).
   Uma linha pode ter mais de uma OS ("53529, 53530"): cada número vira uma OS ligada à pista.
   window.PistaAereaPlanilha = { ler(XLSX, buf), mesclar(anterior, novo), VERSAO }
   ========================================================================= */
(function (root) {
  'use strict';
  const VERSAO = 1;
  const semAc = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const vazio = v => v == null || (typeof v === 'string' && !v.trim());
  const num = v => typeof v === 'number' && isFinite(v) ? v : (typeof v === 'string' && /^-?[\d.,]+$/.test(v.trim()) ? parseFloat(v.replace(/\./g, '').replace(',', '.')) : null);
  const dia = v => {
    if (typeof v === 'number' && v > 30000 && v < 80000) return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10);
    const m = String(v ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
  };
  const titulo = s => String(s).toLowerCase().replace(/(^|[\s(\-])([a-zà-ú])/g, (a, b, c) => b + c.toUpperCase()).replace(/\b(De|Da|Do|Dos|Das|E)\b/g, m => m.toLowerCase()).replace(/\b(Ii|Iii|Iv|Vi|Vii)\b/g, m => m.toUpperCase());

  function ler(XLSX, buf) {
    const wb = XLSX.read(buf, { type: 'array', cellDates: false });
    const pistas = [];
    for (const nome of wb.SheetNames) {
      if (/^resumo/.test(semAc(nome))) continue;
      const R = XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, defval: null, raw: true });
      const hi = R.findIndex(r => r && semAc(r[0]) === 'os' && r.some(c => /fazenda/.test(semAc(c))));
      if (hi < 0) continue;
      const H = R[hi].map(semAc), c = rx => H.findIndex(h => rx.test(h));
      const ix = { os: 0, faz: c(/fazenda/), ha: c(/^ha$|area/), op: c(/operacao/), em: c(/abertura|emiss|data/) };
      const itens = [];
      for (const r of R.slice(hi + 1)) {
        if (!r || vazio(r[ix.os])) continue;
        const oss = String(r[ix.os]).split(/[^\d]+/).filter(x => /^\d{4,7}$/.test(x)); if (!oss.length) continue;
        const fz = String(r[ix.faz] ?? '').trim(), m = fz.match(/^(\d+)\s*-\s*(.*)$/);
        const opTxt = ix.op >= 0 ? String(r[ix.op] ?? '').trim() : '', mo = opTxt.match(/^(\d{3,5})\s*-\s*(.*)$/);
        itens.push({ os: oss, faz: m ? m[1] : null, fazNome: titulo((m ? m[2] : fz).replace(/^fazenda\s+/i, '').trim()), ha: Math.round((num(r[ix.ha]) || 0) * 100) / 100, op: mo ? mo[1] : null, opNome: mo ? mo[2].replace(/^\(T\)\s*/, '').trim() : null, em: ix.em >= 0 ? dia(r[ix.em]) : null });
      }
      if (itens.length) pistas.push({ nome: titulo(nome.trim()), itens });
    }
    if (!pistas.length) throw new Error('Não encontrei nenhuma aba de pista com as colunas OS, FAZENDA e HA.');
    return { versao: VERSAO, gerado: new Date().toISOString(), pistas };
  }
  /** A planilha é a sequência atual por pista: o arquivo novo substitui o anterior. */
  function mesclar(anterior, novo) { return novo; }

  const api = { ler, mesclar, VERSAO };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PistaAereaPlanilha = api;
})(typeof window !== 'undefined' ? window : globalThis);
