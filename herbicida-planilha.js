/* =========================================================================
   Leitura da "FO.SA.23 - Matriz de Herbicida" → herbicida.json
   Abas usadas (só elas são lidas):
   - "I - Locais de produção 2007" (+ "II - Quebra-Lombo 2136" e "III - Dessecação 2041"): por talhão, área planejada (P), a realizar (A),
     disponível (AA), realizada (R), data planejada (DP) e data realizada (DR) de cada operação.
   - "Resumo": fila de aplicação por frente (seq., operação, fazenda, talhões, área, entrada/saída)
     e a legenda frente → equipamento.
   - "O.S": ordens de serviço do PIMS (OS × talhão × insumo, situação A/F, emissão, dose).
   - "Apontamento 2026": área apontada por operação, fazenda, talhão e dia → realizado de cada OS
     (apontamentos do mesmo talhão e operação a partir da emissão, limitado à área do talhão).
   - "Operações Pivot": frente de cada OS e nome da fazenda. Insumos: "Insumos - PIMS",
     "Herbicidas Cadastrados" e "Depara Cod Insumo" (código → nome do produto); recursos da OS
     (calda pronta, autopropelido, trator…) pelos códigos curtos da aba "Qualificadores".
   O código do responsável da OS não é publicado.
   Saída enxuta: totais e áreas por dia (esperado × realizado) de cada operação,
   e a fila das próximas aplicações. Nenhum nome de pessoa.
   window.HerbPlanilha = { ler(XLSX, buf), mesclar(anterior, novo), VERSAO, OPS }
   ========================================================================= */
(function (root) {
  'use strict';
  const VERSAO = 2;
  // operações acompanhadas: código → nome e aba de onde vêm (as demais abas da matriz seguem o mesmo padrão de colunas)
  const OPS = { '2007': '1ª aplicação de herbicida', '2242': '1ª bordadura', '2111': 'Catação química', '2260': '2ª bordadura', '2201': '2ª aplicação de herbicida', '2175': 'Extensor de residual', '2075': 'Inseticida pingente', '2041': 'Dessecação', '2136': 'Quebra-lombo' };
  const ABA_OP = { '2041': /^iii - dessecacao/, '2136': /^ii - quebra-lombo/ };
  const NOMES_OP = { '2007': '1ª Aplic. de Herbicida', '2242': '1ª Bordadura', '2201': '2ª Aplic. de Herbicida', '2111': 'Catação Química', '2260': '2ª Bordadura', '2175': '2ª Aplic. Herbicida (Pingente)', '2075': 'Aplic. Inseticida Pingente', '2041': 'Dessecação', '2136': 'Quebra-Lombo', '2220': 'Catação Química (cód. antigo)' };
  const semAc = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const vazio = v => v == null || (typeof v === 'string' && !v.trim());
  const num = v => typeof v === 'number' && isFinite(v) ? v : (typeof v === 'string' && /^-?[\d.,]+$/.test(v.trim()) ? parseFloat(v.replace(/\./g, '').replace(',', '.')) : null);
  const dia = v => typeof v === 'number' && v > 30000 && v < 80000 ? new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10) : null;
  const hora = v => typeof v === 'number' && v > 30000 && v < 80000 ? new Date(Math.round((v - 25569) * 864e5 / 6e4) * 6e4).toISOString().slice(0, 16).replace('T', ' ') : null;
  const titulo = s => s.toLowerCase().replace(/(^|[\s(])([a-zà-ú])/g, (a, b, c) => b + c.toUpperCase()).replace(/\bHp\b/g, 'HP');
  const aba = (wb, rx) => { const k = wb.SheetNames.find(n => rx.test(semAc(n))); return k ? wb.Sheets[k] : null; };
  const linhas = (XLSX, ws) => XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  const r1 = v => Math.round(v * 100) / 100;
  const addD = (d, n) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

  function matriz(XLSX, ws, lista) {
    const R = linhas(XLSX, ws), hi = R.findIndex(r => r && r.some(c => semAc(c) === 'fazenda') && r.some(c => lista.includes(String(c ?? '').trim())));
    if (hi < 0) throw new Error('Não encontrei o cabeçalho das operações na aba de locais de produção.');
    const H = R[hi].map(c => String(c ?? '').trim()), col = n => H.indexOf(n), cFaz = H.findIndex(h => semAc(h) === 'fazenda');
    const out = {};
    for (const op of lista) {
      const c = { flag: col(op), P: col(op + 'P'), A: col(op + 'A'), AA: col(op + 'AA'), R: col(op + 'R'), DP: col(op + 'DP'), DR: col(op + 'DR'), OSS: col(op + 'OSS') };
      if (c.flag < 0 || c.R < 0) continue;
      const o = { nome: OPS[op], tot: 0, r: 0, a: 0, aa: 0, n: 0, fin: 0, semData: 0, esp: {}, real: {} };
      for (const r of R.slice(hi + 1)) {
        if (!r || vazio(r[cFaz]) || vazio(r[c.flag])) continue;
        const v = k => c[k] >= 0 ? num(r[c[k]]) || 0 : 0;
        const tot = c.P >= 0 ? v('P') : v('A') + v('R'); // 2242 não tem coluna P: total = a realizar + realizado
        if (tot <= 0 && v('R') <= 0) continue;
        o.n++; o.tot += tot; o.r += v('R'); o.a += v('A'); o.aa += Math.max(0, v('AA'));
        if (c.OSS >= 0 && String(r[c.OSS] ?? '').trim().toUpperCase() === 'F') o.fin++;
        const dp = c.DP >= 0 ? dia(r[c.DP]) : null; if (dp) o.esp[dp] = (o.esp[dp] || 0) + tot; else o.semData += tot;
        const dr = c.DR >= 0 ? dia(r[c.DR]) : null; if (dr && v('R') > 0) o.real[dr] = (o.real[dr] || 0) + v('R');
      }
      ['tot', 'r', 'a', 'aa', 'semData'].forEach(k => o[k] = r1(o[k]));
      ['esp', 'real'].forEach(k => Object.keys(o[k]).forEach(d => o[k][d] = r1(o[k][d])));
      out[op] = o;
    }
    return out;
  }

  function fila(XLSX, ws) {
    if (!ws) return { fila: [], frentes: {} };
    const R = linhas(XLSX, ws), hi = R.findIndex(r => r && semAc(r[0]) === 'frente' && r.some(c => semAc(c) === 'talhao'));
    if (hi < 0) return { fila: [], frentes: {} };
    const H = R[hi].map(semAc), col = rx => H.findIndex(h => rx.test(h));
    const ix = { f: 0, s: col(/^seq/), op: col(/^op\.?$/), nome: col(/^operacao$/), os: col(/ordem de servico/), faz: col(/^fazenda$/), tal: col(/^talhao$/), ha: col(/^area$/), ent: col(/data entrada/), sai: col(/data saida/), leg: col(/^legenda$/) };
    const frentes = {}, L = [];
    for (const r of R.slice(hi + 1)) {
      if (!r) continue;
      if (ix.leg >= 0 && /^frente\s*\d+/i.test(String(r[ix.leg] ?? '')) && !vazio(r[ix.leg + 1])) frentes[String(r[ix.leg]).match(/\d+/)[0]] = String(r[ix.leg + 1]).trim();
      const f = num(r[ix.f]), ha = num(r[ix.ha]) || 0;
      if (f == null || ha <= 0) continue; // AJUSTE, CANCELAR, REALIZADO… e linhas sem área disponível ficam de fora
      L.push({ f: String(f), s: num(r[ix.s]), op: String(r[ix.op] ?? '').trim(), nome: String(r[ix.nome] ?? '').trim(), os: vazio(r[ix.os]) ? null : String(r[ix.os]).trim(), faz: String(r[ix.faz] ?? '').trim(), tal: String(r[ix.tal] ?? '').trim(), ha: r1(ha), ent: hora(r[ix.ent]), sai: hora(r[ix.sai]) });
    }
    return { fila: L, frentes };
  }

  const objs = (XLSX, ws) => ws ? XLSX.utils.sheet_to_json(ws, { defval: null, raw: true }) : [];
  const campo = (r, rx) => { const k = Object.keys(r).find(k => rx.test(semAc(k))); return k ? r[k] : null; };
  const cod = v => String(v ?? '').trim().replace(/\.0+$/, '');
  function ordens(XLSX, wb) {
    const ws = aba(wb, /^o\.?s$/); if (!ws) return [];
    // nomes dos insumos (código novo e antigo)
    const nomes = {}, recursos = {};
    objs(XLSX, aba(wb, /^insumos - pims$/)).forEach(r => { const c = cod(campo(r, /^cd_insumo$/)), n = campo(r, /^de_insumo$/); if (c && n) nomes[c] = String(n).trim(); });
    objs(XLSX, aba(wb, /^herbicidas cadastrados$/)).forEach(r => { const c = cod(campo(r, /^cd_insumo$/)), a = cod(campo(r, /^cod antigo$/)), n = campo(r, /^de_insumo$/); if (n) { if (c) nomes[c] = nomes[c] || String(n).trim(); if (a) nomes[a] = nomes[a] || String(n).trim(); } });
    const wq = aba(wb, /^qualificadores$/); if (wq) linhas(XLSX, wq).forEach(r => r && r.forEach((v, j) => { if (typeof v === 'number' && v >= 1000 && v < 100000 && r[j + 1] === v && typeof r[j + 2] === 'string' && r[j + 2].trim()) recursos[cod(v)] = recursos[cod(v)] || r[j + 2].trim(); }));
    const wd = aba(wb, /^depara cod insumo$/); if (wd) linhas(XLSX, wd).forEach(r => { if (!r || typeof r[0] !== 'number' || !r[1]) return; const n = String(r[1]).trim(); nomes[cod(r[0])] = nomes[cod(r[0])] || n; if (r[2] != null) nomes[cod(r[2])] = nomes[cod(r[2])] || n; });
    // pivot: frente e nome da fazenda
    const frenteOS = {}, nomeFaz = {}, opNome = {};
    objs(XLSX, aba(wb, /^operacoes pivot$/)).forEach(r => {
      const fz = String(r.Fazenda ?? ''), m = fz.match(/^(\d+)-(.*)$/); if (m) nomeFaz[m[1]] = m[2].trim();
      const os = cod(r.OS), f = num(r.F); if (os && f != null && !frenteOS[os]) frenteOS[os] = String(f);
      if (r.Descrição && r.Cod_Ano) opNome[cod(r.Cod_Ano)] = String(r.Descrição).trim();
    });
    // apontamentos por operação|fazenda|talhão
    const ap = {};
    objs(XLSX, aba(wb, /^apontamento/)).forEach(r => { const d = dia(r.DATA), q = num(r.QUANTIDADE); if (!d || !q) return; const k = `${cod(r.OPERACAO)}|${cod(r.CODIGO)}|${cod(r.TALHAO)}`; (ap[k] = ap[k] || []).push([d, q]); });
    const g = {};
    objs(XLSX, ws).forEach(r => {
      const n = cod(campo(r, /^n.? os$/)); if (!n) return;
      const o = g[n] = g[n] || { os: n, op: cod(campo(r, /^operacao$/)), sit: String(campo(r, /^situacao/) ?? '').trim().toUpperCase(), em: dia(campo(r, /^dt_emissao/)), faz: cod(campo(r, /^codigo$/)), tal: {}, prod: {}, rec: {} };
      const t = cod(campo(r, /^talhao$/)), fz = cod(campo(r, /^codigo$/)), a = num(campo(r, /^area$/)) || 0;
      o.tal[fz + '|' + t] = a;
      const pc = cod(campo(r, /^recurso$/));
      if (pc && +pc < 100000) o.rec[pc] = 1; // recurso operacional (calda pronta, autopropelido, trator…)
      else if (pc) { const p = o.prod[pc] = o.prod[pc] || { d: num(campo(r, /^dose$/)), q: 0 }; p.q += num(campo(r, /^total$/)) || 0; }
      if (o.sit !== 'A' && String(campo(r, /^situacao/) ?? '').trim().toUpperCase() === 'A') o.sit = 'A';
    });
    // cada apontamento vai para a OS do mesmo talhão e operação emitida por último até 7 dias depois dele
    // (a OS às vezes é emitida depois que a frente já começou); apontamento sem OS nessa janela não entra
    const osDoTal = {};
    Object.values(g).forEach(o => Object.keys(o.tal).forEach(k => (osDoTal[`${o.op}|${k}`] = osDoTal[`${o.op}|${k}`] || []).push(o)));
    const realTal = {}, ultOS = {};
    Object.entries(osDoTal).forEach(([k, L]) => {
      L.sort((a, b) => String(a.em).localeCompare(String(b.em)));
      (ap[k] || []).forEach(([d, q]) => {
        const lim = addD(d, 7); let o = null; L.forEach(x => { if (x.em && x.em <= lim) o = x; }); if (!o) return;
        const kk = o.os + '|' + k.split('|').slice(1).join('|'); realTal[kk] = (realTal[kk] || 0) + q; if (!ultOS[o.os] || d > ultOS[o.os]) ultOS[o.os] = d;
      });
    });
    return Object.values(g).map(o => {
      const tal = Object.entries(o.tal), area = tal.reduce((s, [, a]) => s + a, 0);
      const real = tal.reduce((s, [k, a]) => s + Math.min(realTal[o.os + '|' + k] || 0, a * 1.2), 0), ult = ultOS[o.os] || null;
      const fazs = [...new Set(tal.map(([k]) => k.split('|')[0]))];
      const talTxt = fazs.length > 1 ? fazs.map(fz => fz + ': ' + tal.filter(([k]) => k.startsWith(fz + '|')).map(([k]) => k.split('|')[1]).sort((a, b) => a - b).join('-')).join(' · ') : tal.map(([k]) => k.split('|')[1]).sort((a, b) => a - b).join('-');
      return { os: o.os, op: o.op, opNome: opNome[o.op] || NOMES_OP[o.op] || null, sit: o.sit === 'F' ? 'F' : 'A', em: o.em, faz: fazs[0], fazNome: nomeFaz[fazs[0]] || null, nFaz: fazs.length, tal: talTxt, nTal: tal.length, area: r1(area), real: r1(real), ult, f: frenteOS[o.os] || null,
        rec: Object.keys(o.rec).map(c => recursos[c] || null).filter(Boolean).map(titulo),
        prod: Object.entries(o.prod).map(([c, p]) => ({ n: nomes[c] || 'Insumo ' + c, d: p.d, q: r1(p.q) })) };
    }).sort((a, b) => String(b.em).localeCompare(String(a.em)));
  }

  function ler(XLSX, buf) {
    const wb = XLSX.read(buf, { type: 'array', cellDates: false, sheets: ['I - Locais de produção 2007', 'II - Quebra-Lombo 2136', 'III - Dessecação 2041', 'Resumo', 'O.S', 'Apontamento 2026', 'Operações Pivot', 'Insumos - PIMS', 'Herbicidas Cadastrados', 'Depara Cod Insumo', 'Qualificadores'] });
    const wm = aba(wb, /^i - locais de producao/); if (!wm) throw new Error('Não encontrei a aba "I - Locais de produção 2007".');
    const ops = matriz(XLSX, wm, Object.keys(OPS).filter(k => !ABA_OP[k]));
    const q = fila(XLSX, aba(wb, /^resumo$/));
    if (!ops['2007']) throw new Error('A aba "I - Locais de produção 2007" não tem as colunas da operação 2007.');
    Object.entries(ABA_OP).forEach(([k, rx]) => { const w = aba(wb, rx); if (w) try { Object.assign(ops, matriz(XLSX, w, [k])); } catch (e) { /* aba fora do padrão: operação fica de fora */ } });
    return { versao: VERSAO, gerado: new Date().toISOString(), ops, fila: q.fila, frentes: q.frentes, os: ordens(XLSX, wb) };
  }
  /** A matriz já traz a safra inteira: o arquivo novo substitui o anterior. */
  function mesclar(anterior, novo) { return novo; }

  const api = { ler, mesclar, VERSAO, OPS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.HerbPlanilha = api;
})(typeof window !== 'undefined' ? window : globalThis);
