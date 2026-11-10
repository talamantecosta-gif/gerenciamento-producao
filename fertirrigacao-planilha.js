/* =========================================================================
   Leitor da planilha "Acompanhamento 2026.xlsm" (Fertirrigação Localizada)
   -------------------------------------------------------------------------
   Lê só as abas usadas no painel: PAINEL, DIMENSIONAMENTO DIÁRIO,
   FECHAMENTO DE TURNO, PRODUÇÃO TURNO e BASE DE DADOS.
   Roda no navegador (botão Sincronizar) e no Node (testes), com SheetJS.
   FertPlanilha.ler(XLSX, arrayBuffer)  → dados do painel
   FertPlanilha.mesclar(anterior, novo) → mantém o histórico de cotas, do
   PAINEL e do fechamento, dia a dia (a planilha guarda só o dia atual).
   ========================================================================= */
(function (root) {
  'use strict';
  const VERSAO = 1;
  const FRENTES = ['F3', 'F4', 'F5', 'F6'];

  const semAc = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const iso = d => {
    if (d instanceof Date && !isNaN(d)) { const z = new Date(d.getTime() + 12 * 3600e3); return z.toISOString().slice(0, 10); }
    if (typeof d === 'number' && d > 30000 && d < 80000) { const z = new Date(Date.UTC(1899, 11, 30) + Math.round(d) * 864e5); return z.toISOString().slice(0, 10); }
    return null;
  };
  const num = v => {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    const s = String(v).trim().replace(/\s/g, '');
    if (!/^-?[\d.,]+$/.test(s)) return null;
    const n = parseFloat(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
    return isFinite(n) ? n : null;
  };
  const frac = v => { let n = num(v); if (n == null) return null; if (n > 1.5) n /= 100; return n >= 0 && n <= 1 ? n : null; };
  /** "FAZ DO CAFÉ" → "Faz. do Café" */
  const titulo = t => t.replace(/^FAZ(ENDA)?\.?\s+/i, 'FAZ. ').toLocaleLowerCase('pt-BR').split(' ').map((w, i) => i && /^(do|da|de|dos|das|e)$/.test(w) ? w : w.charAt(0).toLocaleUpperCase('pt-BR') + w.slice(1)).join(' ');
  const frente = v => { const m = String(v ?? '').match(/(\d+)/); return m ? 'F' + (+m[1]) : null; };
  const txt = v => v == null ? '' : String(v).replace(/\s+/g, ' ').trim();

  /* motivos e ofensores escritos à mão → categorias */
  const REGRAS = [
    [/clima|chuva|climat/, 'Fatores climáticos'],
    [/conectiv|offline|sinal/, 'Sem conectividade'],
    [/operador|motorista/, 'Falta de operador'],
    [/borrach|pneu/, 'Borracheiro / pneu'],
    [/mecan|manut|peca|quebr|eletric|oficina/, 'Manutenção'],
    [/abastecim/, 'Abastecimento do implemento'],
    [/insumo|vinhaca|carregamento|descarreg|calda/, 'Aguardando insumos'],
    [/mudanca/, 'Mudança de área'],
    [/refeic/, 'Refeição'],
    [/embuch|encalh|atolad/, 'Embuchamento / encalhe'],
    [/ordem|\bos\b|programa/, 'Aguardando ordens'],
    [/interdit|trajeto/, 'Trajeto interditado'],
  ];
  const motivo = t => { const s = semAc(t); if (!s || s === '0' || s === '-') return null; for (const [rx, n] of REGRAS) if (rx.test(s)) return n; return 'Outros'; };

  /* ---------- acesso às abas ---------- */
  const aba = (wb, nome) => { const k = wb.SheetNames.find(n => semAc(n) === semAc(nome)); return k ? wb.Sheets[k] : null; };
  const cel = (ws, a) => { const c = ws && ws[a]; return c ? (c.v instanceof Date ? c.v : c.v) : null; };

  /* ---------- cor vermelha da fonte (equipamento em manutenção) ---------- */
  const dec = u8 => (typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8').decode(u8) : Buffer.from(u8).toString('utf8'));
  const arquivo = (cfb, caminho) => { const i = cfb.FullPaths.findIndex(p => p.replace(/\\/g, '/').toLowerCase().endsWith('/' + caminho.toLowerCase()) || p.toLowerCase() === caminho.toLowerCase()); return i >= 0 && cfb.FileIndex[i].content ? dec(cfb.FileIndex[i].content) : ''; };
  const ehVermelho = xml => { const m = /<color[^>]*rgb="([0-9A-Fa-f]{6,8})"/.exec(xml || ''); if (!m) return false; const h = m[1].slice(-6), r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16); return r >= 0xB0 && g <= 0x50 && b <= 0x50; };
  function coresAba(XLSX, buf, nomeAba) {
    try {
      const cfb = XLSX.CFB.read(buf instanceof Uint8Array ? buf : new Uint8Array(buf), { type: 'array' });
      const wbx = arquivo(cfb, 'xl/workbook.xml'), rels = arquivo(cfb, 'xl/_rels/workbook.xml.rels');
      const sh = [...wbx.matchAll(/<sheet\b[^>]*>/g)].map(m => ({ nome: (/name="([^"]*)"/.exec(m[0]) || [])[1], rid: (/r:id="([^"]*)"/.exec(m[0]) || [])[1] }))
        .find(s => semAc(s.nome.replace(/&amp;/g, '&')) === semAc(nomeAba));
      if (!sh) return {};
      const alvo = (new RegExp(`<Relationship[^>]*Id="${sh.rid}"[^>]*Target="([^"]*)"`).exec(rels) || new RegExp(`<Relationship[^>]*Target="([^"]*)"[^>]*Id="${sh.rid}"`).exec(rels) || [])[1];
      if (!alvo) return {};
      const xml = arquivo(cfb, 'xl/' + alvo.replace(/^\/?xl\//, ''));
      const st = arquivo(cfb, 'xl/styles.xml');
      const fontes = ((/<fonts[^>]*>([\s\S]*?)<\/fonts>/.exec(st) || [])[1] || '').match(/<font\b[\s\S]*?<\/font>|<font\/>/g) || [];
      const xfs = (((/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(st) || [])[1] || '').match(/<xf\b[^>]*\/?>/g) || []).map(x => +((/fontId="(\d+)"/.exec(x) || [])[1] || 0));
      const ss = ((arquivo(cfb, 'xl/sharedStrings.xml').match(/<si>[\s\S]*?<\/si>/g)) || []);
      const out = {};
      for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const [, ref, at, corpo = ''] = m;
        const s = +((/\bs="(\d+)"/.exec(at) || [])[1] || 0);
        const inteira = ehVermelho(fontes[xfs[s]]);
        let partes = [];
        if (/t="s"/.test(at)) {
          const si = ss[+((/<v>(\d+)<\/v>/.exec(corpo) || [])[1])] || '';
          partes = (si.match(/<r>[\s\S]*?<\/r>/g) || []).filter(r => ehVermelho(r)).map(r => ((/<t[^>]*>([\s\S]*?)<\/t>/.exec(r) || [])[1] || ''));
        }
        if (inteira || partes.length) out[ref] = { inteira, partes };
      }
      return out;
    } catch (e) { return {}; }
  }

  /* ---------- PAINEL ---------- */
  const COL_PAINEL = { F3: ['B', 'C'], F4: ['E', 'F'], F5: ['H', 'I'], F6: ['K', 'L'] };
  function equipamento(s, cor) {
    const t = txt(s); if (!t) return null;
    const verm = c => !!cor && (cor.inteira || cor.partes.some(p => p.includes(c)));
    const ap = /(TRATOR|GRUNNER)\s*-\s*(\d+)\s*\(\s*(\d+)\s*\)/i.exec(t);
    if (ap) return { tipo: 'aplicador', modelo: ap[1][0] + ap[1].slice(1).toLowerCase(), frota: ap[2], implemento: ap[3], alerta: verm(ap[2]) || verm(ap[3]), alertas: [ap[2], ap[3]].filter(verm) };
    const cods = t.match(/\d{5,6}/g) || [];
    if (!cods.length) return { tipo: 'nota', texto: t };
    const cav = cods[0].startsWith('3') ? cods[0] : null;
    const trelas = cav ? cods.slice(1) : cods;
    return { tipo: 'conjunto', cavalo: cav, trelas, alerta: cods.some(verm), alertas: cods.filter(verm) };
  }
  function lerPainel(ws, cores) {
    const out = {};
    FRENTES.forEach(f => {
      const [a, b] = COL_PAINEL[f];
      const v = r => cel(ws, b + r);
      const eq = [];
      for (let r = 16; r <= 25; r++) { const e = equipamento(cel(ws, a + r), cores[a + r]); if (e) eq.push(e); }
      out[f] = {
        codigo: txt(cel(ws, a + 4)), fazenda: titulo(txt(v(4))),
        lamina: num(v(5)), velocidade: num(v(6)), bateVolta: txt(v(7)) === '0' ? null : txt(v(7)) || null,
        carregamento: txt(v(8)), raio: num(v(9)), os: txt(v(10)), talhoes: txt(v(11)), necCaminhoes: num(v(12)), operacao: txt(v(13)),
        aplicadores: eq.filter(e => e.tipo === 'aplicador'), conjuntos: eq.filter(e => e.tipo === 'conjunto'), notas: eq.filter(e => e.tipo === 'nota').map(e => e.texto),
      };
    });
    return out;
  }

  /* ---------- DIMENSIONAMENTO DIÁRIO (só a cota do dia) ---------- */
  function lerCota(ws) {
    const esq = { F3: 'B', F4: 'C', F5: 'D', F6: 'E' }, dir = { F3: 'H', F4: 'I', F5: 'J', F6: 'K' };
    const fr = {};
    FRENTES.forEach(f => {
      const a = esq[f], b = dir[f], n = c => num(cel(ws, c));
      const frotaTotal = n(b + 27) || 0, bateVolta = n(b + 18) || 0;
      fr[f] = {
        lamina: n(a + 4), potencial: n(a + 20), possivel: n(a + 21),
        necFrota: n(b + 26), frotaTotal, bateVolta, ncConjuntos: n(b + 29), conjuntosTem: frotaTotal + bateVolta,
        raio: n(b + 11), frotaOperando: n(b + 17),
      };
    });
    return { data: iso(cel(ws, 'A3')), frentes: fr };
  }

  /* ---------- FECHAMENTO DE TURNO (dados digitados no fechamento) ---------- */
  function lerFechamento(ws) {
    const linhas = { A: 8, B: 10, C: 12 }, taxa = { F3: 'E', F4: 'F', F5: 'G', F6: 'H' }, dim = { F3: 'I', F4: 'J', F5: 'K', F6: 'L' };
    const turnos = {};
    Object.entries(linhas).forEach(([t, r]) => { turnos[t] = { aplicadores: num(cel(ws, 'C' + r)), caminhoes: num(cel(ws, 'D' + r)), taxa: Object.fromEntries(FRENTES.map(f => [f, num(cel(ws, taxa[f] + r))])) }; });
    return { data: iso(cel(ws, 'AB3')), dimensionado: Object.fromEntries(FRENTES.map(f => [f, num(cel(ws, dim[f] + 16))])), turnos, observacao: txt(cel(ws, 'C20')) || null };
  }

  /* ---------- PRODUÇÃO TURNO ---------- */
  function lerProducao(ws, XLSX) {
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    const out = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i], d = iso(r[0]); if (!d || !r[2]) continue;
      const bruto = r[6], obs = txt(r[7]);
      const traco = typeof bruto === 'string' && bruto.trim() === '-';
      const ha = traco ? 0 : num(bruto);
      const semProd = traco || ha === 0;
      out.push({
        d, t: txt(r[1]).toUpperCase(), f: frente(r[2]), eq: num(r[3]), cod: num(r[4]),
        faz: txt(r[5]), ha: ha == null ? 0 : Math.round(ha * 100) / 100, semProd,
        motivo: semProd ? (motivo(obs) || 'Não informado') : null, obs: obs && obs !== '0' ? obs : null,
      });
    }
    return out;
  }

  /* ---------- BASE DE DADOS (SGPA) ---------- */
  function lerSgpa(ws, XLSX) {
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    const out = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i], d = iso(r[0]); if (!d || !r[1]) continue;
      const of = []; txt(r[10]).split('/').forEach(p => { const m = motivo(p); if (m && !of.includes(m)) of.push(m); });
      const vel = num(r[7]);
      out.push({ d, f: frente(r[1]), t: txt(r[2]).toUpperCase(), prod: frac(r[3]), manut: frac(r[4]), ins: frac(r[5]), motor: frac(r[6]), vel: vel > 0 && vel <= 15 ? vel : null, pil: frac(r[8]), ofTxt: txt(r[10]), of });
    }
    return out;
  }

  function ler(XLSX, buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const wb = XLSX.read(u8, { type: 'array', cellDates: true });
    const falta = ['PAINEL', 'DIMENSIONAMENTO DIÁRIO', 'FECHAMENTO DE TURNO', 'PRODUÇÃO TURNO', 'BASE DE DADOS'].filter(n => !aba(wb, n));
    if (falta.length) throw new Error('A planilha não tem as abas: ' + falta.join(', '));
    const cores = coresAba(XLSX, u8, 'PAINEL');
    const cota = lerCota(aba(wb, 'DIMENSIONAMENTO DIÁRIO'));
    const fech = lerFechamento(aba(wb, 'FECHAMENTO DE TURNO'));
    const painel = { data: cota.data, frentes: lerPainel(aba(wb, 'PAINEL'), cores) };
    const novo = {
      versao: VERSAO, geradoEm: new Date().toISOString(), frentes: FRENTES.slice(),
      painel, cota, fechamento: fech,
      producao: lerProducao(aba(wb, 'PRODUÇÃO TURNO'), XLSX), sgpa: lerSgpa(aba(wb, 'BASE DE DADOS'), XLSX),
      historico: { cotas: {}, painel: {}, fechamento: {} },
    };
    return mesclar(null, novo);
  }

  /** Junta o histórico já publicado com a leitura nova (o dia da planilha substitui o mesmo dia). */
  function mesclar(anterior, novo) {
    const h = anterior && anterior.historico ? JSON.parse(JSON.stringify(anterior.historico)) : { cotas: {}, painel: {}, fechamento: {} };
    if (novo.cota && novo.cota.data) h.cotas[novo.cota.data] = { fonte: 'dimensionamento', frentes: novo.cota.frentes };
    if (novo.fechamento && novo.fechamento.data) {
      const d = novo.fechamento.data;
      if (!h.cotas[d] || h.cotas[d].fonte !== 'dimensionamento') h.cotas[d] = { fonte: 'fechamento', frentes: Object.fromEntries(FRENTES.map(f => [f, { potencial: novo.fechamento.dimensionado[f] }])) };
      h.fechamento[d] = { dimensionado: novo.fechamento.dimensionado, turnos: novo.fechamento.turnos };
    }
    if (novo.painel && novo.painel.data) h.painel[novo.painel.data] = novo.painel.frentes;
    return { ...novo, historico: h };
  }

  const api = { ler, mesclar, motivo, VERSAO };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FertPlanilha = api;
})(typeof window !== 'undefined' ? window : globalThis);
