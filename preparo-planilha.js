/* =========================================================================
   Leitura da planilha "Informativo Operacional Agrícola" (respostas do Forms) → preparo.json
   Abas usadas: Form1 (apontamentos), Fazendas (código → nome) e Resumo Diário (só a data de
   início da safra, V1). Sem meta: o Dimensionamento não é usado no painel.
   Correções feitas a cada sincronização:
   - Operação: o Forms novo grava em "Operação1" e o antigo em "Operação" → junta as duas
     (o Resumo Diário da planilha soma pela coluna errada e mostra códigos de fazenda como hectares).
   - Nomes de operação padronizados (maiúsculas, acentos, espaços: "aplic inseticida",
     "Catação quimica manual", "Reforço carreador"…).
   - Apontamento repetido (mesmo dia, turno, operação, fazenda, área e colaborador) conta uma vez.
   - Área muito acima do normal da operação (mais de 5× o p95, ex.: 6.207 ha de maturador)
     não entra nos totais e vai para a lista "Para conferir".
   - Data depois do envio do formulário, turno vazio e fazenda sem cadastro também vão para a lista.
   - O nome do colaborador não é publicado.
   window.PrepPlanilha = { ler(XLSX, buf), mesclar(anterior, novo), VERSAO }
   ========================================================================= */
(function (root) {
  'use strict';
  const VERSAO = 2;
  const semAc = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const vazio = v => v == null || (typeof v === 'string' && !v.trim());
  const iso = v => {
    if (vazio(v)) return null;
    if (typeof v === 'number') return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10);
    const m = String(v).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
  };
  const num = v => { if (vazio(v)) return null; if (typeof v === 'number') return isFinite(v) ? v : null; let s = String(v).trim().replace(/[^\d,.\-]/g, ''); if (/,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); const n = parseFloat(s); return isFinite(n) ? n : null; };
  /* nome padrão de cada operação (chave = nome sem acento/maiúscula) */
  const CANON = {
    'aracao': 'Aração', 'corretivo': 'Corretivo', 'corretivo cana soca': 'Corretivo Cana Soca', 'corte de soqueira': 'Corte de Soqueira',
    'fertirrigacao': 'Fertirrigação', 'herbicida': 'Herbicida', 'adubacao': 'Adubação', 'quebra-lombo': 'Quebra-Lombo', 'quebra lombo': 'Quebra-Lombo',
    'maturador': 'Maturador', 'pre maturador': 'Pré-Maturador', 'pre-maturador': 'Pré-Maturador', 'dessecacao': 'Dessecação', 'inibidor': 'Inibidor',
    'aplicacao foliar v0': 'Aplicação Foliar V0', '1° aplicacao foliar': '1ª Aplicação Foliar', '2° aplicacao foliar': '2ª Aplicação Foliar', '3° aplicacao foliar': '3ª Aplicação Foliar',
    '1º aplicacao foliar': '1ª Aplicação Foliar', '2º aplicacao foliar': '2ª Aplicação Foliar', '3º aplicacao foliar': '3ª Aplicação Foliar',
    'reforco carreador': 'Reforço Carreador', 'reforco de carreador': 'Reforço Carreador', 'reforco de bordadura': 'Reforço Bordadura', 'reforco bordadura': 'Reforço Bordadura',
    'catacao quimica manual': 'Catação Química Manual', 'catacao quimica tratorizada': 'Catação Química Tratorizada',
    'aplicacao inseticida': 'Aplicação Inseticida', 'aplic inseticida': 'Aplicação Inseticida', 'pre seca': 'Pré-Seca', 'pre-seca': 'Pré-Seca',
    'canterizador': 'Canteirizador', 'canteirizador': 'Canteirizador', 'plantio de blend': 'Plantio de Blend',
  };
  const titulo = s => String(s).toLowerCase().replace(/(^|[\s\-])([a-zà-ú])/g, (a, b, c) => b + c.toUpperCase()).replace(/\b(De|Da|Do|E)\b/g, m => m.toLowerCase());
  const operacao = v => { const k = semAc(v); return k ? (CANON[k] || titulo(String(v).trim())) : null; };
  const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  const aba = (wb, rx) => { const k = wb.SheetNames.find(n => rx.test(semAc(n))); return k ? wb.Sheets[k] : null; };
  const linhas = (XLSX, ws) => XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });

  /** Dimensionamento: bloco "frota × rendimento" (3º bloco, linha TOTAL no fim) → meta[operação][mês 1-12][quinzena 1|2] */
  function lerMeta(XLSX, wb) {
    const ws = aba(wb, /^dimensionamento$/); if (!ws) return {};
    const R = linhas(XLSX, ws), blocos = [];
    R.forEach((r, i) => { if (r && /dimensionamento de frota/i.test(String(r[0] || ''))) blocos.push(i); });
    const ini = blocos[2] != null ? blocos[2] : blocos[blocos.length - 1]; if (ini == null) return {};
    const cab = R[ini + 1] || [], meta = {};
    for (let i = ini + 2; i < R.length; i++) {
      const r = R[i]; if (!r || vazio(r[0])) continue; if (/total/i.test(r[0])) break;
      const op = operacao(r[0]); meta[op] = {};
      cab.forEach((c, j) => { const m = String(c || '').match(/M(\d{2})Q([12])/i); if (!m) return; const v = num(r[j]); if (v) (meta[op][+m[1]] = meta[op][+m[1]] || {})[m[2]] = v; });
    }
    return meta;
  }

  function ler(XLSX, buf) {
    const wb = XLSX.read(buf, { type: 'array', cellDates: false });
    const wf = aba(wb, /^form1$/) || aba(wb, /form/); if (!wf) throw new Error('Não encontrei a aba Form1 (respostas do formulário).');
    // fazendas
    const faz = {}; const wz = aba(wb, /^fazendas$/) || aba(wb, /^consulta1$/);
    if (wz) linhas(XLSX, wz).forEach(r => { if (r && r[0] != null && /^\d+$/.test(String(r[0]).trim()) && r[1]) faz[String(r[0]).trim()] = String(r[1]).trim(); });
    // início da safra (Resumo Diário V1)
    let safra = null; const wr = aba(wb, /^resumo diario$/); if (wr && wr.V1) safra = iso(wr.V1.v);
    const R = linhas(XLSX, wf), hi = R.findIndex(r => r && r.some(c => /area realizada/.test(semAc(c))));
    if (hi < 0) throw new Error('Não encontrei a coluna "Área Realizada (ha)" na aba Form1.');
    const H = R[hi].map(semAc), col = rx => H.findIndex(h => rx.test(h));
    const ix = { id: col(/^id$/), envio: col(/hora de conclusao/), d: col(/^data$/), t: col(/^turno$/), op1: col(/^operacao1$/), op: col(/^operacao$/), cod: col(/codigo da fazenda/), ha: col(/area realizada/), obs: col(/observa/) };
    const brutos = [];
    for (const r of R.slice(hi + 1)) {
      if (!r) continue; const d = iso(r[ix.d]); if (!d) continue;
      const op = operacao(ix.op1 >= 0 && !vazio(r[ix.op1]) ? r[ix.op1] : r[ix.op]); if (!op) continue;
      const cod = vazio(r[ix.cod]) ? null : String(r[ix.cod]).trim().replace(/\.0+$/, '');
      const t = String(r[ix.t] || '').trim().toUpperCase();
      const envio = ix.envio >= 0 && typeof r[ix.envio] === 'number' ? iso(r[ix.envio]) : null;
      brutos.push({ d, t: /^(A|B|C|ADM)$/.test(t) ? t : '—', op, cod, ha: num(r[ix.ha]) ?? 0, obs: vazio(r[ix.obs]) ? null : String(r[ix.obs]).trim(), envio, _q: semAc(r[11] || '') });
    }
    // repetidos
    const vistos = new Set(), conferir = []; let repetidos = 0; const L = [];
    brutos.forEach(b => { const k = [b.d, b.t, b.op, b.cod, b.ha, b._q].join('|'); if (vistos.has(k)) { repetidos++; return; } vistos.add(k); L.push(b); });
    // área fora do normal (por operação)
    const p95 = {}; const g = {}; L.forEach(b => (g[b.op] = g[b.op] || []).push(b.ha)); Object.entries(g).forEach(([o, v]) => { v.sort((a, b) => a - b); p95[o] = v[Math.floor(v.length * .95)] || 0; });
    const regs = [];
    L.forEach(b => {
      const nome = b.cod ? faz[b.cod] || null : null, x = { d: b.d, t: b.t, op: b.op, cod: b.cod, faz: nome, ha: b.ha, obs: b.obs };
      const lim = Math.max(50, p95[b.op] * 5);
      if (b.ha > lim) { conferir.push({ ...x, motivo: `área ${b.ha.toLocaleString('pt-BR')} ha muito acima do normal da operação (até ~${Math.round(p95[b.op])} ha) — fora dos totais` }); return; }
      if (b.ha < 0) { conferir.push({ ...x, motivo: 'área negativa — fora dos totais' }); return; }
      if (b.envio && b.d > b.envio) conferir.push({ ...x, motivo: `data do apontamento depois do envio do formulário (${b.envio.split('-').reverse().join('/')})` });
      if (b.t === '—') conferir.push({ ...x, motivo: 'turno não informado' });
      if (b.cod && !nome) conferir.push({ ...x, motivo: `fazenda ${b.cod} não está no cadastro` });
      regs.push(x);
    });
    regs.sort((a, b) => a.d.localeCompare(b.d) || a.op.localeCompare(b.op));
    return { versao: VERSAO, gerado: new Date().toISOString(), safra, meta: {}, registros: regs, conferir, correcoes: { repetidos, foraTotais: conferir.filter(c => /fora dos totais/.test(c.motivo)).length } };
  }

  /** A planilha já traz todo o histórico do Forms: o arquivo novo substitui o anterior. */
  function mesclar(anterior, novo) { return novo; }

  const api = { ler, mesclar, operacao, VERSAO, MESES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PrepPlanilha = api;
})(typeof window !== 'undefined' ? window : globalThis);
