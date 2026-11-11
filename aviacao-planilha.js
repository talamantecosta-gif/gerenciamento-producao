/* =========================================================================
   Leitura do relatório "Relatório do Ciclo de Operação" da plataforma TRAVICAR
   (aplicação aérea) → aviacao.json
   - Lê a aba "Trabalhos" pelo NOME das colunas (a ordem pode mudar na exportação).
   - Correções a cada sincronização: "-" vira vazio, tempos "hh:mm:ss" viram minutos,
     números com vírgula, índices fora de 0–100 descartados, trabalhos repetidos unificados,
     identificação "1105-PIRATININGA-OS=53299" separada em fazenda e OS.
   - Histórico: mesclar() guarda todos os trabalhos já publicados, mesmo que saiam do
     período do próximo relatório exportado.
   window.AviPlanilha = { ler(XLSX, buf), mesclar(anterior, novo), VERSAO }
   ========================================================================= */
(function (root) {
  'use strict';
  const VERSAO = 1;
  const COLS = {
    id: /identifica/i, ini: /^data\s*in[ií]cio/i, fim: /^data\s*fim/i, haPoli: /hectares\s*do\s*pol/i, ha: /hectares\s*aplicad/i,
    tTot: /tempo\s*total/i, tSolo: /tempo\s*de\s*solo/i, tTrans: /tempo\s*transl/i, tBalao: /tempo\s*de\s*bal/i, tApl: /tempo\s*de\s*aplica/i,
    reab: /reabastec/i, litros: /consumo/i, altAlvo: /altura\s*alvo/i, altReal: /altura\s*realiz/i, vel: /^velocidade\s*m[eé]dia/i,
    acerto: /[ií]ndice\s*de\s*acerto/i, unif: /[ií]ndice\s*de\s*uniform/i, aeronave: /^aeronave/i,
  };
  const vazio = v => v == null || (typeof v === 'string' && /^[\s\-–—]*$/.test(v));
  function num(v) {
    if (vazio(v)) return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    let s = String(v).trim().replace(/[^\d,.\-]/g, '');
    if (/,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s); return isFinite(n) ? n : null;
  }
  /** "02:49:35" → 169.58 min (aceita também número de dia do Excel) */
  function minutos(v) {
    if (vazio(v)) return null;
    if (typeof v === 'number') return v < 5 ? v * 1440 : null;
    const m = String(v).trim().match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/); if (!m) return null;
    return +m[1] * 60 + +m[2] + (+m[3] || 0) / 60;
  }
  /** "09/11/2026 06:17" → "2026-11-09T06:17" */
  function dataHora(v) {
    if (vazio(v)) return null;
    if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 864e5)); return d.toISOString().slice(0, 16); }
    const m = String(v).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/); if (!m) return null;
    return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T${(m[4] || '0').padStart(2, '0')}:${m[5] || '00'}`;
  }
  const titulo = s => String(s || '').toLowerCase().replace(/(^|[\s\-\/(])([a-zà-ú])/g, (a, b, c) => b + c.toUpperCase())
    .replace(/\b(De|Da|Do|Das|Dos|E)\b/g, m => m.toLowerCase()).replace(/\b([IVX]{1,4})\b/gi, m => m.toUpperCase());
  /** A identificação é digitada livre na TRAVICAR ("1105-PIRATININGA-OS=53299", "VOO 16.01.2026-1071-7",
   *  "FAZ-1032-OS52889", "2137E52766", "SAMAMBAIA 1026-OS=52391"…). Separa código da fazenda (4 dígitos),
   *  nome (quando escrito) e OS (números de 5 dígitos). */
  function identificar(id) {
    let s = String(id || '').toUpperCase().replace(/VOO\s*\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4}/g, ' ');
    const os = [...new Set((s.match(/\d{5,6}/g) || []))];
    s = s.replace(/\d{5,6}/g, ' ');
    const faz = (s.match(/(?:^|\D)([12]\d{3})(?!\d)/) || [])[1] || null;
    const nome = s.replace(/\(.*?\)/g, ' ').replace(/[^A-ZÀ-Ú ]+/g, ' ').replace(/\b(FAZ|FAZENDA|OS|VOO|CANTO)\b/g, ' ')
      .split(/\s+/).filter(w => w.length > 1 && w !== 'E').join(' ').trim();
    return { faz, fazNome: nome ? titulo(nome).replace(/\bSta\b/g, 'Santa').replace(/\bSto\b/g, 'Santo') : null, os: os.length ? os.join(', ') : null };
  }
  const pct = v => { const n = num(v); return n == null || n < 0 || n > 100 ? null : n; };

  function ler(XLSX, buf) {
    const wb = XLSX.read(buf, { type: 'array', cellDates: false });
    const nome = wb.SheetNames.find(n => /trabalho/i.test(n)) || wb.SheetNames[0];
    const R = XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, defval: null, raw: true });
    const hi = R.findIndex(r => r && r.some(c => typeof c === 'string' && COLS.id.test(c)));
    if (hi < 0) throw new Error('Não encontrei a coluna "Identificação do Trabalho" no relatório da TRAVICAR.');
    const H = R[hi], ix = {};
    Object.entries(COLS).forEach(([k, rx]) => { ix[k] = H.findIndex(c => typeof c === 'string' && rx.test(c.trim())); });
    ['id', 'ini', 'ha'].forEach(k => { if (ix[k] < 0) throw new Error(`Coluna obrigatória não encontrada no relatório: ${k}`); });
    const g = (r, k) => ix[k] >= 0 ? r[ix[k]] : null;
    const periodo = (R.slice(0, hi).find(r => r && /per[ií]odo/i.test(String(r[0]))) || [])[1] || null;
    const vistos = new Map(); let repetidos = 0, semData = 0;
    for (const r of R.slice(hi + 1)) {
      if (!r || vazio(g(r, 'id'))) continue;
      const ini = dataHora(g(r, 'ini')); if (!ini) { semData++; continue; }
      const id = String(g(r, 'id')).trim(), k = id + '|' + ini;
      if (vistos.has(k)) { repetidos++; continue; }
      const tTot = minutos(g(r, 'tTot')), tSolo = minutos(g(r, 'tSolo')), tTrans = minutos(g(r, 'tTrans')), tBalao = minutos(g(r, 'tBalao')), tApl = minutos(g(r, 'tApl'));
      const partes = [tSolo, tTrans, tBalao, tApl];
      const t = {
        k, id, ...identificar(id), aeronave: vazio(g(r, 'aeronave')) ? null : String(g(r, 'aeronave')).trim(),
        ini, fim: dataHora(g(r, 'fim')), d: ini.slice(0, 10),
        haPoli: num(g(r, 'haPoli')), ha: num(g(r, 'ha')),
        // tempo total: se faltar, soma das etapas (solo + translado + balão + aplicação)
        tTot: tTot != null ? tTot : (partes.every(x => x != null) ? partes.reduce((a, b) => a + b, 0) : null),
        tSolo, tTrans, tBalao, tApl,
        reab: num(g(r, 'reab')), litros: num(g(r, 'litros')),
        altAlvo: num(g(r, 'altAlvo')), altReal: num(g(r, 'altReal')), vel: num(g(r, 'vel')),
        acerto: pct(g(r, 'acerto')), unif: pct(g(r, 'unif')),
      };
      if (t.ha != null && t.ha < 0) t.ha = null;
      if (t.litros != null && t.litros <= 0) t.litros = null;
      if (t.vel != null && (t.vel <= 0 || t.vel > 400)) t.vel = null;
      vistos.set(k, t);
    }
    const trabalhos = [...vistos.values()].sort((a, b) => a.ini.localeCompare(b.ini));
    return { versao: VERSAO, gerado: new Date().toISOString(), periodo, trabalhos, correcoes: { repetidos, semData } };
  }

  /** Junta com o que já estava publicado: o trabalho do relatório novo substitui o antigo de mesma chave. */
  function mesclar(anterior, novo) {
    const m = new Map(); ((anterior && anterior.trabalhos) || []).forEach(t => m.set(t.k, t));
    novo.trabalhos.forEach(t => m.set(t.k, t));
    return { ...novo, trabalhos: [...m.values()].sort((a, b) => a.ini.localeCompare(b.ini)) };
  }

  const api = { ler, mesclar, identificar, minutos, VERSAO };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.AviPlanilha = api;
})(typeof window !== 'undefined' ? window : globalThis);
