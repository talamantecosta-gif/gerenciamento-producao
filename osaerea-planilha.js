/* =========================================================================
   Leitura da "FO.SA.21 - Protocolo de Entrega de OS" → osaerea.json
   Abas usadas (só elas são lidas):
   - "Ordem de servico": OS abertas do PIMS por talhão (operação, área, emissão, início e fim previstos).
     Ficam só as operações aéreas (nome com "aérea": 1188, 1141, 1210, 1220…); drone fica de fora.
   - "Fazendas": estágio de corte, variedade e data da última colheita de cada talhão.
   - "Pagina 1": OS do último protocolo de entrega e a data de recebimento.
   NÃO são lidas: Fornecedores, Prestador de Serviço, Centro de custos (têm CPF, telefone e nomes),
   nem o responsável pelo protocolo e o código do funcionário da OS (LGPD).
   window.OsAereaPlanilha = { ler(XLSX, buf), mesclar(anterior, novo), VERSAO, FAIXAS }
   ========================================================================= */
(function (root) {
  'use strict';
  const VERSAO = 1;
  // idade da cana na aplicação: meses desde a última colheita do talhão
  const FAIXAS = [[0, 3, 'até 3'], [3, 5, '3 a 5'], [5, 7, '5 a 7'], [7, 9, '7 a 9'], [9, 12, '9 a 12'], [12, 999, '12 ou mais']];
  const semAc = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const vazio = v => v == null || (typeof v === 'string' && !v.trim());
  const num = v => typeof v === 'number' && isFinite(v) ? v : (typeof v === 'string' && /^-?[\d.,]+$/.test(v.trim()) ? parseFloat(v.replace(/\./g, '').replace(',', '.')) : null);
  const dia = v => typeof v === 'number' && v > 30000 && v < 80000 ? new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10) : null;
  const cod = v => String(v ?? '').trim().replace(/\.0+$/, '');
  const r2 = v => Math.round(v * 100) / 100;
  const aba = (wb, rx) => { const k = wb.SheetNames.find(n => rx.test(semAc(n))); return k ? wb.Sheets[k] : null; };
  const campo = (r, rx) => { const k = Object.keys(r).find(k => rx.test(semAc(k))); return k ? r[k] : null; };
  const titulo = s => String(s).toLowerCase().replace(/(^|[\s(\-])([a-zà-ú])/g, (a, b, c) => b + c.toUpperCase()).replace(/\b(De|Da|Do|Dos|Das|E)\b/g, m => m.toLowerCase()).replace(/\b(Ii|Iii|Iv|Vi|Vii)\b/g, m => m.toUpperCase());

  function ler(XLSX, buf) {
    const wb = XLSX.read(buf, { type: 'array', cellDates: false, sheets: ['Ordem de servico', 'Fazendas', 'Pagina 1'] });
    const wo = aba(wb, /^ordem de servico$/); if (!wo) throw new Error('Não encontrei a aba "Ordem de servico".');
    // talhões (aba Fazendas: cabeçalho na 2ª linha)
    const tal = {}, wf = aba(wb, /^fazendas$/);
    if (wf) {
      const R = XLSX.utils.sheet_to_json(wf, { header: 1, defval: null, raw: true }), hi = R.findIndex(r => r && r.some(c => semAc(c) === 'estagio'));
      if (hi >= 0) {
        const H = R[hi].map(semAc), c = rx => H.findIndex(h => rx.test(h));
        const ix = { k: c(/^concatenado$/), faz: c(/^codigo$/), t: c(/^talhao$/), ult: c(/^ultima ocorrencia$/), est: c(/^estagio$/), vari: c(/^variedade$/) };
        R.slice(hi + 1).forEach(r => { if (!r) return; const k = ix.k >= 0 && !vazio(r[ix.k]) ? cod(r[ix.k]) : cod(r[ix.faz]) + cod(r[ix.t]); tal[k] = { ult: num(r[ix.ult]), est: vazio(r[ix.est]) ? null : String(r[ix.est]).trim(), vari: vazio(r[ix.vari]) ? null : String(r[ix.vari]).trim() }; });
      }
    }
    // OS aéreas
    const g = {};
    XLSX.utils.sheet_to_json(wo, { defval: null, raw: true }).forEach(r => {
      const nomeOp = String(campo(r, /^operacao$/) ?? ''), n = semAc(nomeOp);
      if (!/aere/.test(n) || /drone|dro\(|aereadro/.test(n)) return;
      const os = cod(campo(r, /^no_os$/)); if (!os) return;
      const sit = String(campo(r, /^fg_situacao$/) ?? 'A').trim().toUpperCase(); if (sit && sit !== 'A') return; // só abertas
      const faz = cod(campo(r, /^cd_upnivel1$/)), t = cod(campo(r, /^cd_upnivel3$/)), ha = num(campo(r, /qt_area/)) || 0, ini = campo(r, /^dt_ini_prev$/);
      const o = g[os] = g[os] || { os, op: cod(campo(r, /^cd_operacao$/)), opNome: nomeOp.replace(/^\d+-\s*/, '').replace(/^\(T\)\s*/, '').trim(), em: dia(campo(r, /^dt_emissao_os$/)), ini: dia(ini), fim: dia(campo(r, /^dt_fim_prev$/)), faz, fazNome: titulo(String(campo(r, /^fazenda$/) ?? '').replace(/^\d+-\s*/, '').replace(/^fazenda\s+/i, '').trim()), tal: [], ha: 0, est: {}, vari: {}, idade: FAIXAS.map(() => 0) };
      o.tal.push(t); o.ha += ha;
      const x = tal[cod(campo(r, /^concat$/)) || faz + t]; if (!x) return;
      if (x.est) o.est[x.est] = (o.est[x.est] || 0) + ha;
      if (x.vari) o.vari[x.vari] = (o.vari[x.vari] || 0) + ha;
      if (x.ult && typeof ini === 'number') { const m = (ini - x.ult) / 30.44, i = FAIXAS.findIndex(([a, b]) => m >= a && m < b); if (i >= 0) o.idade[i] += ha; }
    });
    const os = Object.values(g).map(o => ({ ...o, ha: r2(o.ha), tal: [...new Set(o.tal)].sort((a, b) => (+a || 0) - (+b || 0)).join('-'), est: Object.fromEntries(Object.entries(o.est).map(([k, v]) => [k, r2(v)])), vari: Object.fromEntries(Object.entries(o.vari).map(([k, v]) => [k, r2(v)])), idade: o.idade.map(r2) }))
      .sort((a, b) => String(a.fim).localeCompare(String(b.fim)) || b.ha - a.ha);
    if (!os.length) throw new Error('A aba "Ordem de servico" não tem OS aéreas abertas.');
    // último protocolo (Pagina 1): OS da coluna B e data de recebimento
    let protocolo = null; const wp = aba(wb, /^pagina 1$/);
    if (wp) {
      const R = XLSX.utils.sheet_to_json(wp, { header: 1, defval: null, raw: true });
      let data = null; R.slice(0, 6).forEach(r => (r || []).forEach((c, j) => { if (/data recebimento/.test(semAc(c)) && dia(r[j + 1])) data = dia(r[j + 1]); }));
      const hi = R.findIndex(r => r && r.some(c => semAc(c) === 'o.s'));
      const lista = hi < 0 ? [] : R.slice(hi + 1).map(r => r && cod(r[1])).filter(v => /^\d{4,7}$/.test(v));
      if (lista.length) protocolo = { data, os: [...new Set(lista)] };
    }
    return { versao: VERSAO, gerado: new Date().toISOString(), os, protocolo };
  }
  /** A planilha é a foto da carteira aberta: o arquivo novo substitui o anterior. */
  function mesclar(anterior, novo) { return novo; }

  const api = { ler, mesclar, VERSAO, FAIXAS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.OsAereaPlanilha = api;
})(typeof window !== 'undefined' ? window : globalThis);
