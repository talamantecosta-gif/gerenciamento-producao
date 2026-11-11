/* =========================================================================
   Leitor da planilha "Pulverizadores.xlsx" (página Pulverização)
   -------------------------------------------------------------------------
   Abas lidas: TABELAS (status da frota), IOA PULVE (produção oficial),
   Qualidade da Aplicação, BASE QUALIDADE, Ordem de Serviço, Nível Caminhões,
   PARAMETRO, Fazendas e PAINEL GERENCIAL (turno / início das operações).
   Os cálculos são refeitos aqui a partir dos dados digitados, corrigindo os
   erros da planilha a cada sincronização:
     • condição da aplicação lida na matriz pelo cabeçalho real (°C e UR) e
       com o limite de vento do PARAMETRO;
     • status e alertas das OS na linha certa, com tolerância de 10%;
     • totais de produção somados por dia/frota/turno (sem #REF!);
     • contagens do status somadas da TABELAS (sem valores digitados por cima);
     • nível dos caminhões com litros atuais (não a capacidade).
   PulvPlanilha.ler(XLSX, arrayBuffer) → dados · PulvPlanilha.mesclar(ant, novo)
   ========================================================================= */
(function (root) {
  'use strict';
  const VERSAO = 1;
  const META_HA_DIA = 150;          // meta da frente de pulverização (total do dia)
  const TOL_AREA = .10;             // OS: realizado acima de 110% da área → verificar
  const IDADE_MAX = 7;              // OS em aberto há mais de 7 dias → alerta

  const semAc = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const txt = v => v == null ? '' : String(v).replace(/\s+/g, ' ').trim();
  const iso = v => {
    if (v instanceof Date && !isNaN(v)) return new Date(v.getTime() + 12 * 3600e3).toISOString().slice(0, 10);
    if (typeof v === 'number' && v > 30000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 864e5).toISOString().slice(0, 10);
    return null;
  };
  /** número escrito de qualquer jeito: "31,6 °C", "20.3°C", "45%", "3,5 km/h" */
  const num = v => {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    const m = String(v).replace(/\s/g, '').match(/-?\d+(?:[.,]\d+)?/);
    return m ? parseFloat(m[0].replace(',', '.')) : null;
  };
  /** hora (fração do dia, Date ou "15:57") → minutos */
  const minutos = v => {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return Math.round((v % 1) * 1440);
    if (v instanceof Date) return v.getUTCHours() * 60 + v.getUTCMinutes();
    const m = String(v).match(/(\d{1,2})[:h](\d{2})/); return m ? +m[1] * 60 + +m[2] : null;
  };
  const turnoHora = h => h == null ? null : (h >= 7 && h < 15 ? 'A' : h >= 15 && h < 23 ? 'B' : 'C');

  const aba = (wb, nome) => { const k = wb.SheetNames.find(n => semAc(n) === semAc(nome)); return k ? wb.Sheets[k] : null; };
  const linhas = (XLSX, ws) => ws ? XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) : [];
  const cel = (ws, a) => ws && ws[a] ? ws[a].v : null;

  /* ---------- Fazendas: nomes de fazenda e de operação ---------- */
  function lerCadastros(XLSX, ws) {
    const faz = {}, ops = {};
    linhas(XLSX, ws).slice(1).forEach(r => {
      if (r[0] != null && r[1] != null && !faz[String(r[0]).trim()]) faz[String(r[0]).trim()] = tituloFaz(txt(r[1]));
      if (r[7] != null && r[8] != null) ops[String(r[7]).trim()] = txt(r[8]);
    });
    return { faz, ops };
  }
  const tituloFaz = t => t.replace(/^FAZ(ENDA)?\.?\s+/i, 'FAZ. ').toLocaleLowerCase('pt-BR').split(' ').map((w, i) => /^(i|ii|iii|iv|v|vi)$/.test(w) ? w.toUpperCase() : i && /^(do|da|de|dos|das|e)$/.test(w) ? w : w.charAt(0).toLocaleUpperCase('pt-BR') + w.slice(1)).join(' ');
  const tituloOp = s => s ? s.toLowerCase().replace(/(^|\s)\S/g, m => m.toUpperCase()).replace(/\b(De|Da|Do|E|Ou)\b/g, m => m.toLowerCase()).replace(/Aplicacao/g, 'Aplicação').replace(/Pulverizacao/g, 'Pulverização').replace(/Operacao/g, 'Operação') : '';

  /* ---------- PARAMETRO ---------- */
  function lerParametros(ws) {
    const v = a => num(cel(ws, a));
    return { ventoMax: v('C5') ?? 11, tanquePulv: v('C11') ?? 3000, caldaPipa: v('C12') ?? 15000, vazao: v('C13') ?? 150, pctConcluida: v('C16') ?? 1 };
  }

  /* ---------- BASE QUALIDADE: matriz UR (linhas) × temperatura (colunas) ---------- */
  function lerMatriz(XLSX, ws) {
    const R = linhas(XLSX, ws);
    let hi = R.findIndex(r => r && r.filter(x => typeof x === 'number').length >= 6);
    if (hi < 0) return null;
    const temps = [], cols = [];
    R[hi].forEach((x, j) => { if (typeof x === 'number') { temps.push(x); cols.push(j); } });
    const urs = [], cod = [];
    for (let i = hi + 1; i < R.length; i++) {
      const r = R[i] || [], u = num(r[0]);
      if (u == null) continue;
      const lin = cols.map(j => txt(r[j]).toUpperCase());
      if (!lin.some(c => /^(CI|PE|SD)$/.test(c))) continue;
      urs.push(u); cod.push(lin);
    }
    return urs.length ? { temps, urs, cod } : null;
  }
  const NOME_COND = { CI: 'Condição ideal', PE: 'Perda de eficiência', SD: 'Muito desfavorável' };
  /** Condição pela faixa real do cabeçalho: maior °C ≤ temperatura e maior UR ≤ umidade. Vento acima do limite → SD. */
  function condicao(M, t, ur, vento, ventoMax) {
    if (t == null || ur == null) return null;
    if (vento != null && vento > ventoMax) return 'SD';
    if (!M) return null;
    let j = 0, bt = -Infinity; M.temps.forEach((x, k) => { if (t >= x && x > bt) { bt = x; j = k; } });
    let i = -1, bu = -Infinity; M.urs.forEach((x, k) => { if (ur >= x && x > bu) { bu = x; i = k; } });
    if (i < 0) { let mn = Infinity; M.urs.forEach((x, k) => { if (x < mn) { mn = x; i = k; } }); } // abaixo da menor faixa → usa a menor
    const c = M.cod[i] && M.cod[i][j];
    return /^(CI|PE|SD)$/.test(c) ? c : null;
  }

  /* ---------- TABELAS: status da frota ---------- */
  const STATUS = s => { const x = semAc(s); if (!x) return 'Sem status'; if (/rodando|operando|trabalhando/.test(x)) return 'Rodando'; if (/manut|mecan/.test(x)) return 'Manutenção'; if (/operador/.test(x)) return 'Falta operador'; if (/parad|inoperante/.test(x)) return 'Parado'; return txt(s); };
  function lerStatus(XLSX, ws, painel) {
    const R = linhas(XLSX, ws), frota = [];
    for (let i = 1; i < R.length; i++) {
      const r = R[i] || []; if (r[0] == null || txt(r[0]) === '') continue;
      frota.push({ frota: txt(r[0]).replace(/^(\w)/, m => m.toUpperCase()), frente: txt(r[1]).toUpperCase() || 'SEM FRENTE', status: STATUS(r[2]), motivo: txt(r[3]) || null });
    }
    // turno, informante e início das operações (PAINEL GERENCIAL)
    const inicio = {}; let turno = null, por = null;
    if (painel) {
      turno = txt(cel(painel, 'F3')) || null; por = txt(cel(painel, 'I3')) || null;
      for (let r = 10; r <= 18; r++) { const f = txt(cel(painel, 'B' + r)).toUpperCase(), h = cel(painel, 'I' + r); if (f && h != null && h !== '') { const m = minutos(h); if (m != null) inicio[f] = String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); } }
    }
    return { turno, informadoPor: por, inicio, frota };
  }

  /* ---------- IOA PULVE: produção oficial (ha por frota e turno) ---------- */
  function lerProducao(XLSX, ws, cad) {
    const R = linhas(XLSX, ws), out = [];
    const hdr = R.findIndex(r => r && r.some(c => semAc(c) === 'data') && r.some(c => semAc(c) === 'frota'));
    const h = (R[hdr] || []).map(semAc), col = n => h.indexOf(n);
    const cD = col('data'), cF = col('frota'), cO = col('op'), cZ = h.findIndex(x => x.startsWith('faz')), tur = [['A', col('a')], ['B', col('b')], ['C', col('c')], ['ADM', col('adm')]].filter(x => x[1] >= 0);
    for (let i = hdr + 1; i < R.length; i++) {
      const r = R[i] || [], d = iso(r[cD]), fr = txt(r[cF]); if (!d || !fr) continue;
      const op = txt(r[cO]), faz = txt(r[cZ]);
      tur.forEach(([t, j]) => { const v = num(r[j]); if (v == null) return; out.push({ d, eq: fr, t, ha: v, op, opNome: tituloOp(cad.ops[op] || ''), faz, fazNome: faz.split('/').map(c => cad.faz[c.trim()] || c.trim()).join(' / ') }); });
    }
    return out;
  }

  /* ---------- Qualidade da Aplicação ---------- */
  function lerQualidade(XLSX, ws, M, P, cad) {
    const R = linhas(XLSX, ws), out = [];
    const hdr = R.findIndex(r => r && semAc(r[0]) === 'data');
    for (let i = hdr + 1; i < R.length; i++) {
      const r = R[i] || [], d = iso(r[0]); if (!d) continue;
      const t = num(r[8]), v = num(r[9]); let ur = num(r[10]);
      if (ur != null && ur <= 1.5 && typeof r[10] === 'number') ur *= 100;
      const ini = minutos(r[6]), fim = minutos(r[7]);
      let carr = ini != null && fim != null ? fim - ini : null; if (carr != null && carr < 0) carr += 1440; if (carr != null && carr > 240) carr = null;
      const tt = txt(r[13]).toUpperCase(), hora = ini != null ? Math.floor(ini / 60) : null;
      const c = condicao(M, t, ur, v, P.ventoMax), op = txt(r[15]);
      out.push({ d, faz: txt(r[1]), fazNome: cad.faz[txt(r[1])] || '', talhao: txt(r[2]), area: num(r[3]), aplicada: num(r[11]), eq: txt(r[4]), operador: txt(r[5]), hora, carr, t, ur, vento: v, turno: /^(A|B|C|ADM)$/.test(tt) ? tt : turnoHora(hora), op, opNome: tituloOp(cad.ops[op] || ''), cond: c, obs: txt(r[20]) || null });
    }
    return out;
  }

  /* ---------- Ordem de Serviço (status e alertas recalculados) ---------- */
  function lerOS(XLSX, ws, P, cad) {
    const R = linhas(XLSX, ws), out = [];
    const hdr = R.findIndex(r => r && semAc(r[0]) === 'os');
    for (let i = hdr + 1; i < R.length; i++) {
      const r = R[i] || []; if (r[0] == null || txt(r[0]) === '') continue;
      const area = num(r[7]); if (area == null) continue;
      const real = num(r[8]) || 0, faz = txt(r[4]), op = txt(r[1]), p = area ? real / area : 0;
      out.push({ os: txt(r[0]), op, opNome: tituloOp(cad.ops[op] || ''), abertura: iso(r[2]), eq: txt(r[3]).replace(/\s+/g, ''), faz, fazNome: cad.faz[faz] || txt(r[5]), talhoes: txt(r[6]), area, real, mapa: !!txt(r[13]), p,
        status: real === 0 ? 'Não iniciada' : p >= P.pctConcluida - 1e-9 ? 'Concluída' : 'Em andamento' });
    }
    return out;
  }

  /* ---------- Nível Caminhões ---------- */
  function lerNivel(XLSX, ws) {
    if (!ws) return null;
    const crit = num(cel(ws, 'B5')) ?? .3, aten = num(cel(ws, 'B6')) ?? .6, cam = [];
    const R = linhas(XLSX, ws), hdr = R.findIndex(r => r && semAc(r[0]) === 'caminhao');
    for (let i = hdr + 1; i < R.length; i++) {
      const r = R[i] || []; if (r[0] == null || txt(r[0]) === '' || /mensagem/i.test(txt(r[0]))) { if (r[0] != null && /mensagem/i.test(txt(r[0]))) break; continue; }
      const cap = num(r[1]), lit = num(r[2]); if (!cap) continue;
      const p = lit == null ? null : Math.max(0, Math.min(1, lit / cap));
      cam.push({ caminhao: txt(r[0]), capacidade: cap, litros: lit, conteudo: txt(r[3]), p, status: p == null ? null : p < crit ? 'bad' : p < aten ? 'warn' : 'ok' });
    }
    return { data: iso(cel(ws, 'B3')), turno: txt(cel(ws, 'B4')) || null, limites: { critico: crit, atencao: aten }, caminhoes: cam };
  }

  function ler(XLSX, buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const wb = XLSX.read(u8, { type: 'array', cellDates: false });
    const falta = ['TABELAS', 'IOA PULVE', 'Qualidade da Aplicação', 'Ordem de Serviço'].filter(n => !aba(wb, n));
    if (falta.length) throw new Error('A planilha não tem as abas: ' + falta.join(', '));
    const cad = lerCadastros(XLSX, aba(wb, 'Fazendas')), P = lerParametros(aba(wb, 'PARAMETRO')), M = lerMatriz(XLSX, aba(wb, 'BASE QUALIDADE'));
    const hoje = iso(cel(aba(wb, 'Nível Caminhões'), 'B3')) || iso(cel(aba(wb, 'PAINEL GERENCIAL'), 'C3')) || new Date().toISOString().slice(0, 10);
    const status = { data: hoje, ...lerStatus(XLSX, aba(wb, 'TABELAS'), aba(wb, 'PAINEL GERENCIAL')) };
    const nivel = lerNivel(XLSX, aba(wb, 'Nível Caminhões'));
    const novo = {
      versao: VERSAO, geradoEm: new Date().toISOString(),
      parametros: { ...P, metaHaDia: META_HA_DIA, tolArea: TOL_AREA, idadeMax: IDADE_MAX }, matriz: M,
      status, nivel,
      producao: lerProducao(XLSX, aba(wb, 'IOA PULVE'), cad),
      qualidade: lerQualidade(XLSX, aba(wb, 'Qualidade da Aplicação'), M, P, cad),
      os: lerOS(XLSX, aba(wb, 'Ordem de Serviço'), P, cad),
      historico: { status: {}, nivel: {} },
    };
    return mesclar(null, novo);
  }
  /** Mantém o histórico do status da frota e do nível dos caminhões (a planilha guarda só o momento atual). */
  function mesclar(anterior, novo) {
    const h = anterior && anterior.historico ? JSON.parse(JSON.stringify(anterior.historico)) : { status: {}, nivel: {} };
    if (novo.status && novo.status.data) h.status[novo.status.data] = { turno: novo.status.turno, frota: novo.status.frota };
    if (novo.nivel && novo.nivel.data) h.nivel[novo.nivel.data + '|' + (novo.nivel.turno || '-')] = novo.nivel.caminhoes;
    return { ...novo, historico: h };
  }

  const api = { ler, mesclar, condicao, NOME_COND, VERSAO };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PulvPlanilha = api;
})(typeof window !== 'undefined' ? window : globalThis);
