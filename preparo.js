/* =========================================================================
   Página Preparo de Solo (Informativo Operacional Agrícola · Forms)
   Fonte: "Informativo Operacional Agrícola.xlsm" → preparo.json
   Filtros: data · operação · código da fazenda · turno
   Seções: Resumo · Produção · Operações · Turnos ·
           Informativo do dia (imagem) · Apontamentos (sem meta, sem nome de colaborador)
   window.Preparo = { iniciar(dados), definir(dados), aoEntrar(), VERSAO }
   ========================================================================= */
window.Preparo = (function () {
  'use strict';
  const VERSAO = 1;
  const ARQ = 'preparo.json';
  const TURNOS = ['A', 'B', 'C', 'ADM'];
  const TCOR = { A: '#3C7A35', B: '#5E9A57', C: '#1F4D2B', ADM: '#A9C99A', '—': '#C9D0C5' };
  const PAL = ['#2E6B34', '#2a78d6', '#C98A00', '#8C5A3C', '#6B4FA0', '#C2185B', '#2E9A8A', '#7FA33A', '#D9622B', '#5A8FD6', '#8A8F86', '#B5487A', '#4E7D63', '#A47A3C', '#3D5A99', '#9C6FB8'];

  // grupos de operação (para o filtro): o Forms mistura preparo, tratos e aplicações ADM/aéreas
  const GRUPOS = [
    { nome: 'Preparo de Solo', rx: /^(ara[cç][aã]o|quebra|corte de soqueira|corretivo|canteiriz|plantio)/i },
    { nome: 'Tratos Culturais', rx: /^(herbicida|aduba|fertirriga|cata[cç][aã]o|refor[cç]o|desseca)/i },
    { nome: 'Aplicações ADM / aéreas', rx: /(foliar|maturador|inibidor|inseticida|pr[eé]-seca)/i },
  ];
  const grupoDe = op => (GRUPOS.find(g => g.rx.test(op)) || { nome: 'Outras' }).nome;
  let D = null, U = null, S = null, ligado = false, montado = false, OPC = {};
  const $ = s => document.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const corOp = op => OPC[op] || '#9AA59D';
  const nomeFaz = r => r.cod ? (r.faz ? `${r.cod} · ${r.faz.replace(/^Fazenda\s+/i, '')}` : r.cod) : 'Sem fazenda';

  /* ---------- meta: Dimensionamento (frota × rendimento) por operação, mês e quinzena; domingo sem meta ---------- */
  function metaDia(op, d) {
    const M = D.meta || {}, m = M[op]; if (!m) return null;
    const dt = new Date(d + 'T12:00:00Z'); if (dt.getUTCDay() === 0) return 0;
    const q = dt.getUTCDate() <= 15 ? '1' : '2', mm = m[dt.getUTCMonth() + 1];
    return mm ? (mm[q] ?? mm['1'] ?? null) : null;
  }
  const opsComMeta = () => Object.keys(D.meta || {});
  /** meta do recorte num dia: soma das operações filtradas que têm meta (dividida pelos turnos se filtrar turno) */
  const inOp = op => S.f.op === 'todas' || op === S.f.op || (S.f.op.startsWith('g:') && grupoDe(op) === S.f.op.slice(2));
  function metaRecorte(d) {
    const ops = opsComMeta().filter(inOp);
    if (!ops.length || S.f.faz !== 'todas') return null;
    let m = 0, tem = false; ops.forEach(o => { const v = metaDia(o, d); if (v != null) { m += v; tem = true; } });
    if (!tem) return null;
    return S.f.t === 'todos' ? m : null;
  }

  /* ---------- filtros ---------- */
  const sel = (o = {}) => D.registros.filter(r => r.d >= (o.de || S.f.de) && r.d <= (o.ate || S.f.ate) && inOp(r.op) && (S.f.faz === 'todas' || r.cod === S.f.faz) && (S.f.t === 'todos' || r.t === S.f.t));
  function filtro() {
    const { dBRa, addD, rangeD, esc, mover } = U, el = $('#ppFb'), F = S.f, dias = [...new Set(D.registros.map(r => r.d))].sort(), min = dias[0], max = dias[dias.length - 1];
    const ops = [...new Set(D.registros.map(r => r.op))].sort((a, b) => S.tot[b] - S.tot[a]);
    const fz = [...new Map(D.registros.filter(r => r.cod).map(r => [r.cod, nomeFaz(r)])).entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR', { numeric: true }));
    el.innerHTML = `<div class="pv-fg pv-fg--per"><span class="pv-fl"><i class="fa-regular fa-calendar"></i>Data</span><div class="pv-fctl"><div class="pv-range"><input type="date" data-k="de" aria-label="De"><i class="fa-solid fa-arrow-right-long" aria-hidden="true"></i><input type="date" data-k="ate" aria-label="Até"></div><div class="pv-seg pv-pre" data-k="pre"><button type="button" data-v="7">7 dias</button><button type="button" data-v="30">30 dias</button><button type="button" data-v="mes">Mês</button><button type="button" data-v="safra">Safra</button><button type="button" data-v="tudo">Tudo</button></div></div></div>
      <div class="pv-fg"><span class="pv-fl"><i class="fa-solid fa-tractor"></i>Operação</span><div class="pv-fctl"><select class="pp-sel" data-k="op"><option value="todas">Todas as operações</option>${[...GRUPOS.map(g => g.nome), 'Outras'].filter(g => ops.some(o => grupoDe(o) === g)).map(g => `<optgroup label="${esc(g)}"><option value="g:${esc(g)}">${esc(g)} · todas</option>${ops.filter(o => grupoDe(o) === g).map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}</optgroup>`).join('')}</select></div></div>
      <div class="pv-fg"><span class="pv-fl"><i class="fa-solid fa-map-location-dot"></i>Código da fazenda</span><div class="pv-fctl"><select class="pp-sel" data-k="faz"><option value="todas">Todas as fazendas</option>${fz.map(([k, n]) => `<option value="${esc(k)}">${esc(n)}</option>`).join('')}</select></div></div>
      <div class="pv-fg"><span class="pv-fl"><i class="fa-regular fa-clock"></i>Turno</span><div class="pv-seg" data-k="t"><span class="ind"></span>${['todos', ...TURNOS].map(t => `<button type="button" data-v="${t}">${t === 'todos' ? 'Todos' : t}</button>`).join('')}</div></div>
      <div class="pv-fg pv-fg--local"><div class="pv-fctl"><span class="ft-fresumo"></span><button type="button" class="pv-limpar"><i class="fa-solid fa-rotate-left"></i><span>Limpar filtros</span></button></div></div>`;
    const at = a => { if (a === '7') F.de = addD(F.ate, -6); else if (a === '30') F.de = addD(F.ate, -29); else if (a === 'mes') F.de = F.ate.slice(0, 8) + '01'; else if (a === 'safra') { F.de = D.safra || min; F.ate = max; } else if (a === 'tudo') { F.de = min; F.ate = max; } if (F.de < min) F.de = min; };
    el.onclick = e => { const b = e.target.closest('button'); if (!b) return; const k = b.parentNode.dataset.k; if (k === 'pre') at(b.dataset.v); else if (k === 't') F.t = b.dataset.v; else if (b.classList.contains('pv-limpar')) Object.assign(F, S.padrao()); else return; tudo(); };
    el.onchange = e => { const k = e.target.dataset.k; if (!k || !e.target.value) return; F[k] = e.target.value; if (F.de > F.ate) { if (k === 'de') F.ate = F.de; else F.de = F.ate; } tudo(); };
    S.sync = ja => {
      const n = rangeD(F.de, F.ate).length, a = F.de === min && F.ate === max ? 'tudo' : F.de === (D.safra || min) && F.ate === max ? 'safra' : n === 7 ? '7' : n === 30 ? '30' : F.de === F.ate.slice(0, 8) + '01' ? 'mes' : null;
      $$('input[type=date]', el).forEach(i => { i.value = F[i.dataset.k]; i.min = min; i.max = max; });
      $$('[data-k="pre"] button', el).forEach(b => b.classList.toggle('is-on', b.dataset.v === a));
      el.querySelector('[data-k="op"]').value = F.op; el.querySelector('[data-k="faz"]').value = F.faz;
      mover(el.querySelector('[data-k="t"]'), el.querySelector(`[data-k="t"] button[data-v="${F.t}"]`), ja);
      const p = S.padrao(); el.querySelector('.pv-limpar').classList.toggle('is-on', ['de', 'ate', 'op', 'faz', 't'].some(k => F[k] !== p[k]));
      el.querySelector('.ft-fresumo').innerHTML = `<b>${dBRa(F.de)}</b> a <b>${dBRa(F.ate)}</b> · ${F.op === 'todas' ? 'todas as operações' : esc(F.op.replace(/^g:/, ''))} · ${F.faz === 'todas' ? 'todas as fazendas' : 'fazenda ' + esc(F.faz)} · ${F.t === 'todos' ? 'todos os turnos' : 'turno ' + F.t}`;
    };
  }

  /* =================== RESUMO =================== */
  function pResumo(L) {
    const { nf, pc, sum, kpi, cascata, animar, dBR, rangeD, esc } = U;
    const ha = sum(L.map(r => r.ha)), dias = [...new Set(L.filter(r => r.ha > 0).map(r => r.d))].sort();
    const comMeta = rangeD(S.f.de, S.f.ate).map(d => ({ d, m: metaRecorte(d), r: sum(L.filter(r => r.d === d && D.meta[r.op]).map(r => r.ha)) })).filter(x => x.m != null);
    const R = sum(comMeta.map(x => x.r)), M = sum(comMeta.map(x => x.m)), q = M ? R / M : null;
    const ult = dias[dias.length - 1], rU = ult ? sum(L.filter(r => r.d === ult).map(r => r.ha)) : null, rUm = ult ? sum(L.filter(r => r.d === ult && D.meta[r.op]).map(r => r.ha)) : 0, mU = ult ? metaRecorte(ult) : null;
    const ini = D.safra || D.registros[0].d, AS = sum(sel({ de: ini, ate: S.f.ate }).map(r => r.ha));
    const ops = {}; L.forEach(r => ops[r.op] = (ops[r.op] || 0) + r.ha); const topOp = Object.entries(ops).sort((a, b) => b[1] - a[1])[0];
    const fz = {}; L.forEach(r => { if (r.cod) fz[nomeFaz(r)] = (fz[nomeFaz(r)] || 0) + r.ha; }); const topF = Object.entries(fz).sort((a, b) => b[1] - a[1])[0];
    const zeros = L.filter(r => !r.ha), mot = {}; zeros.forEach(r => { const m = (r.obs || 'sem observação').toLowerCase().replace(/\s+$/, ''); mot[m] = (mot[m] || 0) + 1; }); const topM = Object.entries(mot).sort((a, b) => b[1] - a[1])[0];
    const st = p => p == null ? '' : p >= 1 ? 'ok' : p >= .9 ? 'warn' : 'bad';
    const pd = {}; L.forEach(r => pd[r.d] = (pd[r.d] || 0) + r.ha); const maior = Object.entries(pd).sort((a, b) => b[1] - a[1])[0];
    const el = $('#ppKpis');
    el.innerHTML = [
      kpi({ t: 'Área realizada', ic: 'fa-tractor', v: ha, dec: 1, un: 'ha', sub: `${L.length} apontamento(s) em ${dias.length} dia(s)` }),
      kpi({ t: 'Média por dia', ic: 'fa-calendar-day', v: dias.length ? ha / dias.length : null, dec: 1, un: 'ha/dia', sub: 'dias com produção' }),
      kpi({ t: maior ? `Maior dia · ${dBR(maior[0])}` : 'Maior dia', ic: 'fa-trophy', v: maior ? maior[1] : null, dec: 1, un: 'ha', sub: maior && dias.length ? `${pc(maior[1] / (ha / dias.length) - 1)} acima da média` : '' }),
      kpi({ t: ult ? `Último dia · ${dBR(ult)}` : 'Último dia', ic: 'fa-clock-rotate-left', v: rU, dec: 1, un: 'ha', sub: ult ? `${new Set(L.filter(r => r.d === ult).map(r => r.op)).size} operação(ões) · ${new Set(L.filter(r => r.d === ult).map(r => r.cod)).size} fazenda(s)` : '' }),
      kpi({ t: 'Acumulado da safra', ic: 'fa-layer-group', v: AS, dec: 0, un: 'ha', sub: `desde ${U.dBRa(ini)}` }),
      kpi({ t: 'Operações', ic: 'fa-list-check', v: Object.keys(ops).length, sub: topOp ? `mais área: <b>${esc(topOp[0])}</b>` : '' }),
      kpi({ t: 'Fazendas atendidas', ic: 'fa-map-location-dot', v: Object.keys(fz).length, sub: topF ? `mais área: <b>${esc(topF[0])}</b>` : '' }),
      kpi({ t: 'Apontamentos sem área', ic: 'fa-circle-pause', v: zeros.length, sub: topM ? `motivo mais comum: <b>${esc(topM[0])}</b>` : 'nenhum no período', st: zeros.length ? 'warn' : 'ok' }),
    ].join('');
    cascata(el); animar(el);
  }

  /* =================== PRODUÇÃO × META =================== */
  function pProd(L) {
    const { nf, pc, sum, esc, rangeD, dBR, dBRa, semana, barrasDia, COR, W, vazio } = U;
    const dias = rangeD(S.f.de, S.f.ate), st = p => p == null ? 'nd' : p >= 1 ? 'ok' : p >= .9 ? 'warn' : 'bad';
    const itens = dias.map(d => {
      const X = L.filter(r => r.d === d), v = sum(X.map(r => r.ha)), m = metaRecorte(d), vm = sum(X.filter(r => D.meta[r.op]).map(r => r.ha)), p = m ? vm / m : null;
      const ops = {}; X.forEach(r => ops[r.op] = (ops[r.op] || 0) + r.ha);
      return { label: dBR(d), d, v, m: m || null, cor: m ? COR[st(p)] : '#3C7A35', tip: `<b>${dBRa(d)}</b> · ${semana(d)}<br>Realizado: <b>${nf(v, 1)} ha</b>${m ? `<br>Operações com meta: ${nf(vm, 1)} de ${nf(m, 0)} ha · <b>${pc(p)}</b>` : ''}${Object.keys(ops).length ? '<br>' + Object.entries(ops).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([o, h]) => `${esc(o)}: ${nf(h, 1)} ha`).join('<br>') : ''}` };
    });
    const com = itens.filter(i => i.v > 0), med = com.length ? sum(com.map(i => i.v)) / com.length : null;
    barrasDia($('#ppChDia'), itens, { media: med, mediaTxt: `média ${nf(med, 0)}`, h: 250, click: it => abrirInfo(it.d) });
  }

  /* =================== OPERAÇÕES =================== */
  function pOps(L) {
    const { nf, pc, sum, esc, rangeD, spark } = U, dias = rangeD(S.f.de, S.f.ate), tot = sum(L.map(r => r.ha)) || 1;
    const g = {}; L.forEach(r => (g[r.op] = g[r.op] || []).push(r));
    const ops = Object.entries(g).map(([op, X]) => {
      const ha = sum(X.map(r => r.ha)); let m = null;
      if (D.meta[op] && S.f.faz === 'todas' && S.f.t === 'todos') m = sum(dias.map(d => metaDia(op, d) || 0)) || null;
      return { op, ha, m, n: X.length, faz: new Set(X.map(r => r.cod)).size, serie: dias.map(d => sum(X.filter(r => r.d === d).map(r => r.ha))) };
    }).sort((a, b) => b.ha - a.ha);
    $('#ppOps').innerHTML = ops.length ? ops.map((o, i) => { const q = o.m ? o.ha / o.m : null, stc = q == null ? '' : q >= 1 ? 'ok' : q >= .9 ? 'warn' : 'bad';
      return `<button type="button" class="pp-op${S.f.op === o.op ? ' is-on' : ''}" data-op="${esc(o.op)}" style="--c:${corOp(o.op)};--i:${i}">
        <div class="pp-op__h"><span class="pp-op__dot"></span><b>${esc(o.op)}</b><small>${pc(o.ha / tot)}</small></div>
        <div class="pp-op__v"><b>${nf(o.ha, o.ha < 100 ? 1 : 0)}</b><span>ha</span>${q != null ? `<span class="ft-tag ${stc}">${pc(q)} da meta</span>` : ''}</div>
        ${q != null ? `<div class="pp-op__bar"><i style="--w:${Math.min(100, q * 100)}%"></i></div>` : ''}
        <div class="pp-op__s">${spark(o.serie, null, 200, 30, corOp(o.op))}</div>
        <small class="pp-op__f">${o.n} apontamento(s) · ${o.faz} fazenda(s)${o.m ? ` · meta ${nf(o.m, 0)} ha` : ''}</small></button>`; }).join('') : '<div class="ft-vazio">Sem apontamentos no recorte.</div>';
  }

  /* =================== TURNOS =================== */
  function pTurnos(L) {
    const { nf, pc, sum, esc, grupos } = U;
    const tot = sum(L.map(r => r.ha)) || 1, tus = TURNOS.filter(t => L.some(r => r.t === t));
    $('#ppTurnoBar').innerHTML = `<div class="pp-tb">${tus.map((t, i) => { const v = sum(L.filter(r => r.t === t).map(r => r.ha)); return v ? `<i style="--w:${v / tot * 100}%;--i:${i};background:${TCOR[t]}" data-tip="${esc(`<b>Turno ${t}</b><br>${nf(v, 1)} ha · ${pc(v / tot)}`)}"><span>${t} · ${pc(v / tot)}</span></i>` : ''; }).join('')}</div>`;
    const g = {}; L.forEach(r => g[r.op] = (g[r.op] || 0) + r.ha);
    const ops = Object.entries(g).sort((a, b) => b[1] - a[1]).slice(0, 8).map(x => x[0]);
    grupos($('#ppChTurno'), ops.map(o => ({ label: o.length > 20 ? o.slice(0, 19) + '…' : o, v: tus.map(t => sum(L.filter(r => r.op === o && r.t === t).map(r => r.ha))) })), tus.map(t => ({ nome: 'Turno ' + t, curto: t, cor: TCOR[t] })), { un: 'ha', h: 250 });
  }

  /* =================== INFORMATIVO DO DIA (imagem para o grupo) =================== */
  function abrirInfo(d) { S.info = d; pInfo(); $('#ppInfo').scrollIntoView({ behavior: U.semMov() ? 'auto' : 'smooth', block: 'start' }); }
  function pInfo() {
    const { nf, pc, sum, esc, dBRa, semana } = U, dias = [...new Set(D.registros.map(r => r.d))].sort();
    if (!S.info || !dias.includes(S.info)) S.info = dias[dias.length - 1];
    const d = S.info, X = D.registros.filter(r => r.d === d), ini = D.safra || dias[0];
    $('#ppInfoDia').value = d; $('#ppInfoDia').min = dias[0]; $('#ppInfoDia').max = dias[dias.length - 1];
    const ops = {}; X.forEach(r => ops[r.op] = (ops[r.op] || 0) + r.ha);
    const L = Object.entries(ops).sort((a, b) => b[1] - a[1]), tot = sum(X.map(r => r.ha));
    const acum = (op, cod) => sum(D.registros.filter(r => r.op === op && r.cod === cod && r.d >= ini && r.d <= d).map(r => r.ha));
    const det = {}; X.forEach(r => { const k = [r.op, r.t, r.cod].join('|'); det[k] = det[k] || { ...r, ha: 0, obs: [] }; det[k].ha += r.ha; if (r.obs) det[k].obs.push(r.obs); });
    const lin = Object.values(det).sort((a, b) => a.op.localeCompare(b.op) || TURNOS.indexOf(a.t) - TURNOS.indexOf(b.t));
    $('#ppCard').innerHTML = `<div class="fc-head"><div class="fc-logo"><img src="logo.png" alt="Bioenergética Aroeira"></div><div class="fc-tt"><h3>Informativo Operacional</h3><p>Preparo de solo e tratos · COA Bioenergética Aroeira</p></div><div class="fc-data"><b>${dBRa(d)}</b><span>${semana(d)}</span></div></div>
      <div class="pp-ic__top"><div class="pp-ic__tot"><small>Produção do dia</small><b>${nf(tot, 1)}<span> ha</span></b><em>${X.length} apontamento(s)</em></div>
        <div class="pp-ic__ops">${L.map(([o, h]) => { const m = metaDia(o, d); return `<div class="pp-ic__op" style="--c:${corOp(o)}"><span>${esc(o)}</span><b>${nf(h, 1)} ha</b>${m ? `<em class="${h >= m ? 'ok' : h >= m * .9 ? 'warn' : 'bad'}">${pc(h / m)} de ${nf(m, 0)}</em>` : '<em></em>'}</div>`; }).join('')}</div></div>
      <div class="fc-sec"><h4>Detalhamento</h4><table class="fc-mx pp-ic__tb"><thead><tr><th>Operação</th><th>Turno</th><th>Fazenda</th><th class="n">Produção dia</th><th class="n">Acumulado safra</th></tr></thead><tbody>
        ${lin.map(r => `<tr><th><span class="pp-op__dot" style="--c:${corOp(r.op)}"></span>${esc(r.op)}</th><td>${r.t}</td><td>${esc(nomeFaz(r))}</td><td class="n"><b>${r.ha ? nf(r.ha, 1) + ' ha' : '—'}</b>${!r.ha && r.obs.length ? `<small>${esc(r.obs[0])}</small>` : ''}</td><td class="n">${nf(acum(r.op, r.cod), 1)} ha</td></tr>`).join('')}
        <tr class="acum"><th>Total</th><td></td><td></td><td class="n"><b>${nf(tot, 1)} ha</b></td><td></td></tr></tbody></table></div>
      <div class="fc-foot"><span>Gerenciamento Produção · acumulado desde ${dBRa(ini)}</span><span>© Talamante</span></div>`;
  }
  async function imagem() {
    if (!window.html2canvas) { U.toast('Gerador de imagem indisponível — verifique a internet.'); return null; }
    const c = $('#ppCard'); c.classList.add('ft-captura');
    try { return await html2canvas(c, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false, windowWidth: 1280 }); } finally { c.classList.remove('ft-captura'); }
  }

  /* =================== PARA CONFERIR · OBSERVAÇÕES · APONTAMENTOS =================== */
  function pConf(L) {
    const { esc, nf, dBRa } = U;
    const O = L.filter(r => r.obs).slice().reverse().slice(0, 30);
    $('#ppObs').innerHTML = O.length ? O.map(r => `<div class="pp-ob"><span>${dBRa(r.d).slice(0, 5)} · ${r.t}</span><div><b>${esc(r.op)} · ${esc(nomeFaz(r))}${r.ha ? ` · ${nf(r.ha, 1)} ha` : ' · sem área'}</b><small>${esc(r.obs)}</small></div></div>`).join('') : '<div class="ft-vazio">Sem observações no recorte.</div>';
    const T = L.slice().sort((a, b) => b.d.localeCompare(a.d) || a.op.localeCompare(b.op)), N = 300;
    $('#ppTab').innerHTML = `<table><thead><tr><th>Data</th><th>Turno</th><th>Operação</th><th>Código</th><th>Fazenda</th><th class="n">Área (ha)</th><th>Observação</th></tr></thead><tbody>${T.slice(0, N).map(r => `<tr><td>${dBRa(r.d)}</td><td>${r.t}</td><td><span class="pp-op__dot" style="--c:${corOp(r.op)}"></span>${esc(r.op)}</td><td>${esc(r.cod || '—')}</td><td>${esc((r.faz || '').replace(/^Fazenda\s+/i, '') || '—')}</td><td class="n"><b>${r.ha ? nf(r.ha, 1) : '—'}</b></td><td class="pp-tab__o">${esc(r.obs || '')}</td></tr>`).join('')}</tbody></table>`;
    $('#ppTabN').textContent = T.length > N ? `${N} mais recentes de ${T.length}` : `${T.length} apontamento(s)`;
  }

  /* ---------- montagem ---------- */
  function tudo() {
    S.sync();
    const L = sel();
    pResumo(L); pProd(L); pOps(L); pTurnos(L); pConf(L);
    const ult = D.registros[D.registros.length - 1];
    $('#ppPgData').textContent = `Informativo Operacional Agrícola · último apontamento em ${U.dBRa(ult.d)}`;
  }
  const visivel = () => { const pg = $('.page[data-p="prep"]'); return pg && pg.classList.contains('is-on'); };
  function ligar() {
    if (ligado) return; ligado = true;
    $('#ppOps').onclick = e => { const b = e.target.closest('[data-op]'); if (!b) return; S.f.op = S.f.op === b.dataset.op ? 'todas' : b.dataset.op; tudo(); };
    const dias = () => [...new Set(D.registros.map(r => r.d))].sort();
    $('#ppInfoNav').onclick = e => { const b = e.target.closest('button[data-n]'); if (!b) return; const L = dias(), i = L.indexOf(S.info) + +b.dataset.n; if (L[i]) { S.info = L[i]; pInfo(); } };
    $('#ppInfoDia').onchange = e => { const L = dias(), v = e.target.value; S.info = L.filter(d => d <= v).pop() || L[0]; pInfo(); };
    $('#ppBaixar').onclick = async () => { const c = await imagem(); if (!c) return; const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = `informativo-operacional-${S.info}.png`; a.click(); U.toast('Imagem baixada.'); };
    $('#ppCopiar').onclick = async () => { try { const c = await imagem(); if (!c) return; const blob = await new Promise(r => c.toBlob(r, 'image/png')); await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); U.toast('Imagem copiada — é só colar no grupo.'); } catch (e) { U.toast('Não foi possível copiar. Use “Baixar imagem”.'); } };
    let tm; addEventListener('resize', () => { clearTimeout(tm); tm = setTimeout(() => { if (D && visivel()) tudo(); }, 220); });
  }
  function montar() {
    U = window.Fertirrigacao.util;
    if (!D.registros || !D.registros.length) { $('#ppKpis').innerHTML = '<div class="ft-vazio" style="grid-column:1/-1">A planilha não tem apontamentos.</div>'; return; }
    const tot = {}; D.registros.forEach(r => tot[r.op] = (tot[r.op] || 0) + r.ha);
    OPC = {}; Object.entries(tot).sort((a, b) => b[1] - a[1]).forEach(([o], i) => OPC[o] = i < PAL.length ? PAL[i] : `hsl(${Math.round(i * 137.5) % 360} 45% 45%)`);
    const dias = [...new Set(D.registros.map(r => r.d))].sort(), max = dias[dias.length - 1];
    const padrao = () => ({ de: U.addD(max, -29) < dias[0] ? dias[0] : U.addD(max, -29), ate: max, op: 'todas', faz: 'todas', t: 'todos' });
    if (!S) S = { f: padrao(), info: null };
    S.padrao = padrao; S.tot = tot;
    filtro(); ligar(); tudo(); pInfo(); montado = true;
  }
  if (window.Layout) {
    const ant = Layout.aoEntrar;
    Layout.aoEntrar = pg => { if (typeof ant === 'function') ant(pg); if (pg.dataset.p === 'prep') aoEntrar(); };
  }
  async function iniciar(dados) {
    if (!window.Fertirrigacao || !Fertirrigacao.util) return;
    if (dados) { D = dados; montar(); return; }
    try {
      const r = await fetch(ARQ, { cache: 'no-store' }); if (!r.ok) throw new Error('sem arquivo');
      D = (await Acesso.readJson(await r.json())).data; montar();
    } catch (e) { const el = $('#ppKpis'); if (el) el.innerHTML = '<div class="ft-vazio" style="grid-column:1/-1">Ainda não há dados do preparo de solo publicados. Use “Sincronizar” com a planilha Informativo Operacional Agrícola na pasta.</div>'; }
  }
  function aoEntrar() { if (!D || !montado) return; tudo(); pInfo(); requestAnimationFrame(() => S.sync(true)); }
  function definir(dados) { D = dados; S = null; montar(); }
  return { iniciar, definir, aoEntrar, VERSAO, ARQ, get dados() { return D; } };
})();
