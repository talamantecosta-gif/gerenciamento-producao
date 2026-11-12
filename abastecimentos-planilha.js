/* =========================================================================
   Leitura da planilha "Abastecimentos.xlsx" (apontamentos do SGPA) → abastecimentos.json
   - 223803 - ABASTECIMENTO DO IMPLEMENTO → abastecimento do aplicador de vinhaça
   - 520 - CARREGANDO INSUMOS             → carregamento do caminhão de vinhaça
   Lê pelas colunas: Data · Hora Início · Turno · Frota · Frente · Cód. Fazenda ·
   Descrição da Operação · Tempo Duração Operação. (O nome do operador não é publicado.)
   Histórico: os dias que vierem na planilha nova substituem os mesmos dias já publicados;
   os demais dias ficam guardados.
   window.AbastPlanilha = { ler(XLSX, buf), mesclar(anterior, novo), VERSAO }
   ========================================================================= */
(function (root) {
  'use strict';
  const VERSAO = 1;
  const COLS = { d: /^data$/i, hora: /hora\s*in[ií]cio/i, t: /^turno$/i, frota: /^frota$/i, frente: /^frente$/i, faz: /fazenda/i, op: /descri[cç][aã]o\s*da\s*opera/i, dur: /dura[cç][aã]o/i };
  const OPS = [{ tipo: 'abast', rx: /^\s*223803\b|abastecimento\s+do\s+implemento/i }, { tipo: 'carreg', rx: /^\s*520\b|carregando\s+insumo/i }];
  const vazio = v => v == null || (typeof v === 'string' && /^[\s\-–—]*$/.test(v));
  function iso(v) {
    if (vazio(v)) return null;
    if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 864e5)); return d.toISOString().slice(0, 10); }
    const m = String(v).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
  }
  /** fração de dia do Excel ou "hh:mm:ss" → minutos */
  function minutos(v) {
    if (vazio(v)) return null;
    if (typeof v === 'number') return v >= 0 && v < 2 ? v * 1440 : null;
    const m = String(v).trim().match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/); return m ? +m[1] * 60 + +m[2] + (+m[3] || 0) / 60 : null;
  }
  /** "FRENTE FERTIRRIGAÇÃO 3" → "F3" (mesma chave das frentes da fertirrigação) */
  const frente = v => { const m = String(v || '').match(/(\d+)\s*$/); return m ? 'F' + m[1] : null; };

  function ler(XLSX, buf) {
    const wb = XLSX.read(buf, { type: 'array', cellDates: false });
    const nome = wb.SheetNames.find(n => /dados/i.test(n)) || wb.SheetNames[0];
    const R = XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, defval: null, raw: true });
    const hi = R.findIndex(r => r && r.some(c => typeof c === 'string' && COLS.op.test(c)));
    if (hi < 0) throw new Error('Não encontrei a coluna "Descrição da Operação" na planilha de abastecimentos.');
    const ix = {}; Object.entries(COLS).forEach(([k, rx]) => { ix[k] = R[hi].findIndex(c => typeof c === 'string' && rx.test(c.trim())); });
    const g = (r, k) => ix[k] >= 0 ? r[ix[k]] : null;
    const registros = []; let ignorados = 0;
    for (const r of R.slice(hi + 1)) {
      if (!r || vazio(g(r, 'op'))) continue;
      const op = OPS.find(o => o.rx.test(String(g(r, 'op')))); const d = iso(g(r, 'd'));
      const t = String(g(r, 't') || '').trim().toUpperCase().replace(/^TURNO\s*/, '');
      if (!op || !d || !/^[ABC]$/.test(t)) { ignorados++; continue; }
      const dur = minutos(g(r, 'dur'));
      registros.push({ d, t, tipo: op.tipo, frota: String(g(r, 'frota') ?? '').trim(), f: frente(g(r, 'frente')), faz: vazio(g(r, 'faz')) ? null : String(g(r, 'faz')).trim(), hora: minutos(g(r, 'hora')), dur: dur != null && dur > 0 && dur < 240 ? dur : null });
    }
    registros.sort((a, b) => a.d.localeCompare(b.d) || a.t.localeCompare(b.t) || (a.hora ?? -1) - (b.hora ?? -1));
    return { versao: VERSAO, gerado: new Date().toISOString(), registros, correcoes: { ignorados } };
  }
  function mesclar(anterior, novo) {
    const dias = new Set(novo.registros.map(r => r.d));
    const velhos = ((anterior && anterior.registros) || []).filter(r => !dias.has(r.d));
    return { ...novo, registros: [...velhos, ...novo.registros].sort((a, b) => a.d.localeCompare(b.d) || a.t.localeCompare(b.t) || (a.hora ?? -1) - (b.hora ?? -1)) };
  }
  const api = { ler, mesclar, VERSAO };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.AbastPlanilha = api;
})(typeof window !== 'undefined' ? window : globalThis);
