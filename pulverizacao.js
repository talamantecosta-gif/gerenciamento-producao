/* =========================================================================
   Página Pulverização (painel Gerenciamento Produção)
   Fonte: planilha "Pulverizadores.xlsx" → pulverizacao.json (criptografado)
   Seções: Resumo · Status da frota (+ imagem para o grupo) · Caminhões ·
   Produção (IOA PULVE, meta 150 ha/dia por pulverizador) · Qualidade da
   aplicação · Planejamento de herbicidas (herbicida.json, Matriz FO.SA.23:
   esperado × realizado acumulado de cada operação e de todas somadas, fila das próximas aplicações e
   ordens de serviço com o apontado de cada uma).
   window.Pulverizacao = { iniciar(), definir(dados), aoEntrar(), VERSAO }
   ========================================================================= */
window.Pulverizacao = (function () {
  'use strict';
  const VERSAO = 3;
  const ARQ = 'pulverizacao.json', ARQ_HERB = 'herbicida.json';
  const ORDEM_FRENTES = ['PULVERIZADOR', 'HERBICAT', 'CALDA PRONTA', 'CORTE DE SOQUEIRA', 'AVIAÇÃO', 'BASE'];
  const ST_COR = { 'Rodando': 'ok', 'Parado': 'warn', 'Falta operador': 'warn', 'Manutenção': 'bad', 'Sem status': 'nd' };
  const CCOR = { CI: '#2E7D32', PE: '#E0A100', SD: '#C62828' };
  const CNOME = { CI: 'Condição ideal', PE: 'Perda de eficiência', SD: 'Muito desfavorável' };
  const TURNOS = ['A', 'B', 'C', 'ADM'];

  let D = null, H = null, U = null, S = null, ligado = false, montado = false;
  const $ = s => document.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];

  /* ---------- filtro genérico (período · turno · frota) ---------- */
  function filtro(el, F, o) {
    const { nf, dBRa, addD, rangeD, mover } = U;
    el.innerHTML = `<div class="pv-fg pv-fg--per"><span class="pv-fl"><i class="fa-regular fa-calendar"></i>Período</span><div class="pv-fctl"><div class="pv-range"><input type="date" data-k="de" aria-label="De"><i class="fa-solid fa-arrow-right-long" aria-hidden="true"></i><input type="date" data-k="ate" aria-label="Até"></div><div class="pv-seg pv-pre" data-k="pre"><button type="button" data-v="7">7 dias</button><button type="button" data-v="30">30 dias</button><button type="button" data-v="mes">Mês</button><button type="button" data-v="tudo">Tudo</button></div></div></div>
      <div class="pv-fg"><span class="pv-fl"><i class="fa-regular fa-clock"></i>Turno</span><div class="pv-seg" data-k="t"><span class="ind"></span>${['todos', ...o.turnos].map(t => `<button type="button" data-v="${t}">${t === 'todos' ? 'Todos' : t}</button>`).join('')}</div></div>
      <div class="pv-fg"><span class="pv-fl"><i class="fa-solid fa-tractor"></i>Pulverizador</span><div class="pv-seg" data-k="eq"><span class="ind"></span>${['todos', ...o.frotas].map(f => `<button type="button" data-v="${f}">${f === 'todos' ? 'Todos' : f}</button>`).join('')}</div></div>
      <div class="pv-fg pv-fg--local"><div class="pv-fctl"><span class="ft-fresumo"></span><button type="button" class="pv-limpar"><i class="fa-solid fa-rotate-left"></i><span>Limpar filtros</span></button></div></div>`;
    const at = a => { if (a === '7') F.de = addD(F.ate, -6); else if (a === '30') F.de = addD(F.ate, -29); else if (a === 'mes') F.de = F.ate.slice(0, 8) + '01'; else if (a === 'tudo') { F.de = o.min; F.ate = o.max; } if (F.de < o.min) F.de = o.min; };
    el.onclick = e => {
      const b = e.target.closest('button'); if (!b) return; const k = b.parentNode.dataset.k;
      if (k === 'pre') at(b.dataset.v); else if (k === 't') F.t = b.dataset.v; else if (k === 'eq') F.eq = b.dataset.v;
      else if (b.classList.contains('pv-limpar')) Object.assign(F, o.padrao()); else return;
      o.cb();
    };
    el.onchange = e => { const k = e.target.dataset.k; if (!k || !e.target.value) return; F[k] = e.target.value; if (F.de > F.ate) { if (k === 'de') F.ate = F.de; else F.de = F.ate; } o.cb(); };
    return {
      sync(ja) {
        const n = rangeD(F.de, F.ate).length, a = F.de === o.min && F.ate === o.max ? 'tudo' : n === 7 ? '7' : n === 30 ? '30' : F.de === F.ate.slice(0, 8) + '01' ? 'mes' : null;
        $$('input[type=date]', el).forEach(i => { i.value = F[i.dataset.k]; i.min = o.min; i.max = o.max; });
        $$('[data-k="pre"] button', el).forEach(b => b.classList.toggle('is-on', b.dataset.v === a));
        mover(el.querySelector('[data-k="t"]'), el.querySelector(`[data-k="t"] button[data-v="${F.t}"]`), ja);
        mover(el.querySelector('[data-k="eq"]'), el.querySelector(`[data-k="eq"] button[data-v="${F.eq}"]`), ja);
        const p = o.padrao(); el.querySelector('.pv-limpar').classList.toggle('is-on', F.de !== p.de || F.ate !== p.ate || F.t !== p.t || F.eq !== p.eq);
        el.querySelector('.ft-fresumo').innerHTML = `<b>${dBRa(F.de)}</b> a <b>${dBRa(F.ate)}</b> · ${F.eq === 'todos' ? 'todos os pulverizadores' : 'pulverizador ' + F.eq} · ${F.t === 'todos' ? 'todos os turnos' : 'turno ' + F.t}`;
      },
    };
  }

  /* =================== RESUMO =================== */
  function frentesStatus(frota) {
    const g = {}; (frota || D.status.frota || []).forEach(x => (g[x.frente] = g[x.frente] || []).push(x));
    return Object.keys(g).sort((a, b) => { const ia = ORDEM_FRENTES.indexOf(a), ib = ORDEM_FRENTES.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b, 'pt-BR'); }).map(f => ({ frente: f, itens: g[f] }));
  }
  // meta da frente: 150 ha/dia no total; filtrando um pulverizador, a meta é dividida entre os que apontaram no dia
  const metaDia = (d, eqs) => { const todos = new Set(D.producao.filter(p => p.d === d).map(p => p.eq)); if (!todos.size) return 0; if (!eqs) return D.parametros.metaHaDia; const n = [...todos].filter(e => eqs.includes(e)).length; return n ? D.parametros.metaHaDia * n / todos.size : 0; };
  function pResumo() {
    const { nf, pc, dBR, dBRa, sum, kpi, cascata, animar, addD } = U;
    const dias = [...new Set(D.producao.map(p => p.d))].sort(), hoje = D.status.data || dias[dias.length - 1];
    const d1 = dias.filter(d => d < hoje).pop() || dias[dias.length - 1];
    const r1 = sum(D.producao.filter(p => p.d === d1).map(p => p.ha)), m1 = metaDia(d1), q1 = m1 ? r1 / m1 : null;
    const mes = (d1 || '').slice(0, 7), pm = D.producao.filter(p => p.d.startsWith(mes)), rm = sum(pm.map(p => p.ha)), dm = new Set(pm.map(p => p.d)).size;
    const fimQ = D.qualidade.map(q => q.d).sort().pop(), q30 = D.qualidade.filter(q => q.d > addD(fimQ, -30) && q.cond), ci = q30.filter(q => q.cond === 'CI').length, sd = q30.filter(q => q.cond === 'SD').length;
    const st = p => p == null ? '' : p >= 1 ? 'ok' : p >= .9 ? 'warn' : 'bad';
    const el = $('#pzKpis');
    el.innerHTML = [
      kpi({ t: `Produção · ${dBR(d1)}`, ic: 'fa-spray-can-sparkles', v: r1, dec: 1, un: 'ha', sub: `meta ${nf(m1)} ha/dia da frente` }),
      kpi({ t: `Atingimento · ${dBR(d1)}`, ic: 'fa-bullseye', v: q1 == null ? null : q1 * 100, dec: 1, un: '%', sub: q1 == null ? '' : `diferença de <b>${U.nfs(r1 - m1, 1)} ha</b>`, st: st(q1), bar: q1, mk: q1 ? Math.min(1, 1 / Math.max(1, q1)) : null }),
      kpi({ t: 'Produção no mês', ic: 'fa-calendar-check', v: rm, dec: 1, un: 'ha', sub: dm ? `${dm} dia(s) · média ${nf(rm / dm, 1)} ha/dia` : '' }),
      kpi({ t: 'Condição ideal · 30 dias', ic: 'fa-cloud-sun', v: q30.length ? ci / q30.length * 100 : null, dec: 0, un: '%', sub: q30.length ? `${pc(sd / q30.length)} das aplicações muito desfavoráveis` : '', st: q30.length ? (ci / q30.length >= .8 ? 'ok' : ci / q30.length >= .6 ? 'warn' : 'bad') : '', bar: q30.length ? ci / q30.length : null, attrs: 'data-ir="pzQualidade" style="cursor:pointer"' }),
    ].join('');
    cascata(el); animar(el);
    el.onclick = e => { const k = e.target.closest('[data-ir]'); if (k) $('#' + k.dataset.ir).scrollIntoView({ behavior: U.semMov() ? 'auto' : 'smooth', block: 'start' }); };
    $('#pzPgData').textContent = `Status de ${dBRa(D.status.data)}${D.status.turno ? ' · ' + D.status.turno : ''}${D.status.informadoPor ? ' · informado por ' + D.status.informadoPor : ''}`;
  }

  /* =================== STATUS DA FROTA =================== */
  function pFrota() {
    const { esc, cascata } = U;
    const el = $('#pzFrota');
    el.innerHTML = frentesStatus().map(g => {
      const rod = g.itens.filter(x => x.status === 'Rodando').length, ini = (D.status.inicio || {})[g.frente];
      return `<article class="pz-fr"><header><div><b>${esc(g.frente.charAt(0) + g.frente.slice(1).toLowerCase())}</b><small>${ini ? `início das operações ${ini}` : '&nbsp;'}</small></div><span class="ft-tag ${rod === g.itens.length ? 'ok' : rod ? 'warn' : 'bad'}">${rod} de ${g.itens.length} rodando</span></header>
        <div class="pz-eqs">${g.itens.map(x => `<div class="pz-eq ${ST_COR[x.status] || 'nd'}"><span class="pz-dot"></span><b>${esc(x.frota)}</b><span class="pz-st">${esc(x.status)}</span><span class="pz-mot">${esc(x.motivo || '')}</span></div>`).join('')}</div></article>`;
    }).join('') || '<div class="ft-vazio">Sem status informado na aba TABELAS.</div>';
    cascata(el);
  }

  /* =================== HISTÓRICO (registro por dia + turno) =================== */
  function regs() {
    const H = (D.historico && D.historico.registros) || {}, L = { ...H };
    const k = D.status.data + '|' + (D.status.turno || '-');
    if (!L[k]) L[k] = { data: D.status.data, turno: D.status.turno, informadoPor: D.status.informadoPor, inicio: D.status.inicio || {}, frota: D.status.frota || [], nivel: D.nivel };
    return Object.keys(L).sort().map(k => ({ k, ...L[k] }));
  }
  const regAtual = () => { const L = regs(); return L.find(r => r.k === S.reg) || L[L.length - 1]; };
  function pRegNav() {
    const L = regs(), R = regAtual(), i = L.findIndex(r => r.k === R.k);
    $$('.pz-reg').forEach(n => {
      const sel = n.querySelector('select');
      sel.innerHTML = L.slice().reverse().map(r => `<option value="${U.esc(r.k)}">${U.dBRa(r.data)}${r.turno ? ' · ' + U.esc(r.turno) : ''}</option>`).join('');
      sel.value = R.k;
      n.querySelector('[data-n="-1"]').disabled = i <= 0;
      n.querySelector('[data-n="1"]').disabled = i >= L.length - 1;
    });
  }
  function irReg(k) { S.reg = k; pRegNav(); pCaminhoes(); pCard(); }

  /* =================== CAMINHÕES (nível dos tanques) =================== */
  function pCaminhoes() {
    const { nf, pc, esc } = U;
    const R = regAtual(), N = R.nivel, el = $('#pzTanques');
    $('#pzNivData').textContent = N ? `leitura do turno ${N.turno || '—'}${R.informadoPor ? ' · informado por ' + R.informadoPor : ''}` : '';
    if (!N || !N.caminhoes.length) { el.innerHTML = '<div class="ft-vazio">Sem leitura dos caminhões.</div>'; return; }
    el.innerHTML = N.caminhoes.map((c, i) => {
      const p = c.p || 0, cor = { ok: '#2a78d6', warn: '#E0A100', bad: '#C62828' }[c.status] || '#9AA59D';
      return `<div class="pz-tq" style="--i:${i}">
        <svg viewBox="0 0 120 150" class="pz-tq__svg" aria-hidden="true"><defs><clipPath id="tq${i}"><rect x="12" y="10" width="96" height="130" rx="16"/></clipPath></defs>
          <rect x="12" y="10" width="96" height="130" rx="16" fill="#F1F5EE" stroke="#D8DED3" stroke-width="2"/>
          <g clip-path="url(#tq${i})"><g class="pz-agua" style="--y:${(1 - p) * 130}px"><path d="M-40 0 q20 -6 40 0 t40 0 t40 0 t40 0 t40 0 t40 0 V200 H-40 Z" fill="${cor}" opacity=".85" class="pz-onda" transform="translate(0,10)"/></g></g>
          ${[.25, .5, .75].map(t => `<line x1="12" x2="22" y1="${10 + 130 * (1 - t)}" y2="${10 + 130 * (1 - t)}" stroke="#B9C4B5"/>`).join('')}
        </svg>
        <div class="pz-tq__info"><b>${esc(c.caminhao)}</b><span class="pz-tq__p" style="color:${cor}">${pc(c.p)}</span><small>${nf(c.litros)} de ${nf(c.capacidade)} L · ${esc(c.conteudo || '')}</small><span class="ft-tag ${c.status || ''}">${c.status === 'bad' ? 'crítico' : c.status === 'warn' ? 'atenção' : 'ok'}</span></div>
      </div>`;
    }).join('');
    requestAnimationFrame(() => requestAnimationFrame(() => $$('.pz-agua', el).forEach(g => g.classList.add('on'))));
  }

  /* =================== IMAGEM PARA O GRUPO =================== */
  function pCard() {
    const { esc, pc, nf, dBRa, semana } = U;
    const R = regAtual(), N = R.nivel, card = $('#pzCard'), ini = R.inicio || {};
    card.innerHTML = `<div class="fc-head"><div class="fc-logo"><img src="logo.png" alt="Bioenergética Aroeira"></div><div class="fc-tt"><h3>Status · Pulverização</h3><p>Defensivos agrícolas · COA Bioenergética Aroeira</p></div><div class="fc-data"><b>${dBRa(R.data)}</b><span>${semana(R.data)}${R.turno ? ' · ' + esc(R.turno) : ''}</span></div></div>
      ${frentesStatus(R.frota).map(g => `<div class="fc-sec"><h4>${esc(g.frente)}${ini[g.frente] ? ' · início ' + ini[g.frente] : ''}</h4><div class="pz-cl">${g.itens.map(x => `<div class="pz-ci ${ST_COR[x.status] || 'nd'}"><span class="pz-dot"></span><b>${esc(x.frota)}</b><span>${esc(x.status)}${x.motivo ? ' · ' + esc(x.motivo.toLowerCase()) : ''}</span></div>`).join('')}</div></div>`).join('')}
      ${N && N.caminhoes.length ? `<div class="fc-sec"><h4>Nível dos caminhões${N.turno ? ' · turno ' + esc(N.turno) : ''}</h4>${N.caminhoes.map(c => `<div class="pz-cn"><b>${esc(c.caminhao)}</b><div class="fc-trk"><i style="--w:${(c.p || 0) * 100}%;background:${{ ok: '#2a78d6', warn: '#E0A100', bad: '#C62828' }[c.status] || '#9AA59D'}"></i></div><span>${pc(c.p)} · ${nf(c.litros)} L ${esc(c.conteudo || '')}</span></div>`).join('')}</div>` : ''}
      <div class="fc-foot"><span>Gerenciamento Produção · ${new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}${R.informadoPor ? ' · informado por ' + esc(R.informadoPor) : ''}</span><span>© Talamante</span></div>`;
  }
  async function imagem() {
    if (!window.html2canvas) { U.toast('Gerador de imagem indisponível — verifique a internet.'); return null; }
    const card = $('#pzCard'); card.classList.add('ft-captura');
    try { return await html2canvas(card, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false, windowWidth: 1280 }); } finally { card.classList.remove('ft-captura'); }
  }

  /* =================== PRODUÇÃO (IOA PULVE) =================== */
  function pProd() {
    const { nf, nfs, pc, dBR, dBRa, rangeD, sum, kpi, cascata, animar, barrasDia, grupos, semana, COR, esc } = U;
    const F = S.p; S.fbP.sync();
    const inT = t => F.t === 'todos' || t === F.t, inE = e => F.eq === 'todos' || e === F.eq;
    const P = D.producao.filter(p => p.d >= F.de && p.d <= F.ate && inT(p.t) && inE(p.eq));
    const dias = rangeD(F.de, F.ate), eqs = F.eq === 'todos' ? null : [F.eq];
    const fT = F.t === 'todos' ? 1 : 1 / Math.max(1, new Set(D.producao.map(p => p.t)).size); // meta do turno = meta do dia ÷ turnos usados
    const serie = dias.map(d => { const r = sum(P.filter(p => p.d === d).map(p => p.ha)), m = metaDia(d, eqs) * fT; return { d, r, m: m || null }; }).filter(x => x.m != null);
    const R = sum(serie.map(x => x.r)), M = sum(serie.map(x => x.m)), q = M ? R / M : null, ok = serie.filter(x => x.r >= x.m).length;
    const st = p => p == null ? '' : p >= 1 ? 'ok' : p >= .9 ? 'warn' : 'bad';
    const kp = $('#pzProdK');
    kp.innerHTML = [
      kpi({ t: 'Realizado', ic: 'fa-spray-can-sparkles', v: R, dec: 1, un: 'ha', sub: `${serie.length} dia(s) com apontamento` }),
      kpi({ t: 'Atingimento da meta', ic: 'fa-bullseye', v: q == null ? null : q * 100, dec: 1, un: '%', sub: `${nf(R, 1)} de ${nf(M, 0)} ha`, st: st(q), bar: q, mk: q ? Math.min(1, 1 / Math.max(1, q)) : null }),
      kpi({ t: 'Média por dia', ic: 'fa-calendar-day', v: serie.length ? R / serie.length : null, dec: 1, un: 'ha/dia', sub: serie.length ? `meta média ${nf(M / serie.length, 0)} ha/dia` : '' }),
      kpi({ t: 'Dias na meta', ic: 'fa-flag-checkered', v: ok, un: `de ${serie.length}`, sub: `${serie.filter(x => x.r < x.m * .5).length} dia(s) abaixo da metade da meta`, st: serie.length ? (ok / serie.length >= .8 ? 'ok' : ok / serie.length >= .5 ? 'warn' : 'bad') : '' }),
    ].join(''); cascata(kp); animar(kp);
    const itens = serie.map(x => { const p = x.m ? x.r / x.m : null; return { label: dBR(x.d), d: x.d, v: x.r, m: x.m, cor: COR[st(p) || 'nd'], tip: `<b>${dBRa(x.d)}</b> · ${semana(x.d)}<br>Realizado: <b>${nf(x.r, 1)} ha</b><br>Meta: ${nf(x.m, 0)} ha · <b>${pc(p)}</b>` }; });
    const med = itens.length ? R / itens.length : null;
    barrasDia($('#pzChProd'), itens, { media: med, mediaTxt: `média ${nf(med, 0)}`, h: 240 });
    const frotas = [...new Set(D.producao.map(p => p.eq))].sort().filter(inE), tus = TURNOS.filter(t => D.producao.some(p => p.t === t) && inT(t));
    grupos($('#pzChTurno'), frotas.map(e => ({ label: e, v: tus.map(t => sum(P.filter(p => p.eq === e && p.t === t).map(p => p.ha))) })),
      tus.map((t, i) => ({ nome: 'Turno ' + t, curto: t, cor: ['#3C7A35', '#5E9A57', '#1F4D2B', '#A9C99A'][i] })), { un: 'ha', h: 240 });
    const op = {}; P.forEach(p => { const k = p.opNome || ('Operação ' + p.op); op[k] = (op[k] || 0) + p.ha; });
    const ops = Object.entries(op).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]), mo = Math.max(1, ...ops.map(x => x[1]));
    $('#pzRkOp').innerHTML = ops.length ? ops.map(([n, v], i) => `<div class="r"><span>${esc(n)}</span><div class="trk"><i style="--w:${v / mo * 100}%;--i:${i}"></i></div><span class="v">${nf(v, 0)} ha</span></div>`).join('') : '<div class="ft-vazio">Sem produção no período.</div>';
  }

  /* =================== QUALIDADE DA APLICAÇÃO =================== */
  function pQual() {
    const { nf, pc, sum, avg, kpi, cascata, animar, esc, vazio, W } = U;
    const F = S.q; S.fbQ.sync();
    const Q = D.qualidade.filter(q => q.d >= F.de && q.d <= F.ate && (F.t === 'todos' || q.turno === F.t) && (F.eq === 'todos' || q.eq === F.eq) && q.cond);
    const n = Q.length, c = k => Q.filter(q => q.cond === k).length;
    const kp = $('#pzQualK');
    kp.innerHTML = [
      kpi({ t: CNOME.CI, ic: 'fa-sun', v: n ? c('CI') / n * 100 : null, dec: 0, un: '%', sub: `${c('CI')} de ${n} aplicações`, st: 'ok', bar: n ? c('CI') / n : null }),
      kpi({ t: CNOME.PE, ic: 'fa-cloud-sun', v: n ? c('PE') / n * 100 : null, dec: 0, un: '%', sub: `${c('PE')} aplicações`, st: 'warn', bar: n ? c('PE') / n : null }),
      kpi({ t: CNOME.SD, ic: 'fa-wind', v: n ? c('SD') / n * 100 : null, dec: 0, un: '%', sub: `${Q.filter(q => q.vento > D.parametros.ventoMax).length} por vento acima de ${nf(D.parametros.ventoMax)} km/h`, st: 'bad', bar: n ? c('SD') / n : null }),
      kpi({ t: 'Tempo de carregamento', ic: 'fa-gas-pump', v: avg(Q.map(q => q.carr)), dec: 0, un: 'min', sub: 'média por abastecimento' }),
    ].join(''); cascata(kp); animar(kp);
    // por hora do dia: barras empilhadas em %
    const el = $('#pzChHora');
    const hs = [...Array(24).keys()].map(i => (i + 7) % 24), por = h => Q.filter(q => q.hora === h);
    if (!n) vazio(el); else {
      const w = W(el), H = 230, pl = 40, pr = 10, pt = 22, pb = 26, bw = (w - pl - pr) / 24, y = v => pt + (H - pt - pb) * (1 - v);
      let s = `<svg viewBox="0 0 ${w} ${H}" width="${w}" height="${H}">`;
      [0, .25, .5, .75, 1].forEach(v => s += `<line x1="${pl}" x2="${w - pr}" y1="${y(v)}" y2="${y(v)}" stroke="#EEF1EC"/><text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end">${pc(v)}</text>`);
      const mx = Math.max(1, ...hs.map(h => por(h).length));
      hs.forEach((h, i) => {
        const L = por(h), x = pl + i * bw + 2, bwi = Math.max(2, bw - 4);
        if (L.length) {
          let acc = 0;
          const haH = sum(L.map(q => q.aplicada || 0)), fx = (k, d, un) => { const v = avg(L.map(q => q[k]).filter(v => v != null)); return v == null ? '—' : nf(v, d) + un; };
          const tipH = esc(`<b>${String(h).padStart(2, '0')}h</b> · ${L.length} aplicaç${L.length > 1 ? 'ões' : 'ão'}<br>Área aplicada: <b>${nf(haH, 1)} ha</b><br>Temperatura: <b>${fx('t', 1, ' °C')}</b><br>Vento: <b>${fx('vento', 1, ' km/h')}</b><br>Umidade: <b>${fx('ur', 0, '%')}</b>`);
          ['SD', 'PE', 'CI'].forEach(k => { const f = L.filter(q => q.cond === k).length / L.length; if (!f) return; s += `<rect class="ftb" style="--i:${i}" x="${x}" y="${y(acc + f)}" width="${bwi}" height="${y(acc) - y(acc + f)}" fill="${CCOR[k]}" opacity="${.35 + .65 * L.length / mx}" data-tip="${tipH}"/>`; acc += f; });
          if (bwi >= 18) s += `<text class="lb fade" x="${x + bwi / 2}" y="${pt - 6}" text-anchor="middle" style="font-size:10px">${nf(haH, haH < 10 ? 1 : 0)}</text>`;
        }
        if (i % 2 === 0) s += `<text x="${x + bwi / 2}" y="${H - 8}" text-anchor="middle">${String(h).padStart(2, '0')}h</text>`;
      });
      el.innerHTML = s + '</svg>';
    }
    // temperatura × umidade sobre a matriz da BASE QUALIDADE
    const sc = $('#pzChMatriz'), M = D.matriz;
    if (!n || !M) vazio(sc); else {
      const w = W(sc), H = 280, pl = 44, pr = 12, pt = 10, pb = 30;
      const tMin = M.temps[0], tMax = M.temps[M.temps.length - 1] + (M.temps[1] - M.temps[0]), uMin = Math.min(...M.urs), uMax = 100;
      const x = t => pl + (w - pl - pr) * (Math.min(tMax, Math.max(tMin, t)) - tMin) / (tMax - tMin), y = u => pt + (H - pt - pb) * (1 - (Math.min(uMax, Math.max(uMin, u)) - uMin) / (uMax - uMin));
      let s = `<svg viewBox="0 0 ${w} ${H}" width="${w}" height="${H}">`;
      const urs = M.urs.slice().sort((a, b) => a - b);
      M.urs.forEach((u, i) => { const u2 = urs[urs.indexOf(u) + 1] ?? (u + 10); M.temps.forEach((t, j) => { const t2 = M.temps[j + 1] ?? tMax, k = M.cod[i][j]; if (!CCOR[k]) return; s += `<rect class="fade" x="${x(t)}" y="${y(Math.min(u2, uMax))}" width="${x(t2) - x(t)}" height="${y(u) - y(Math.min(u2, uMax))}" fill="${CCOR[k]}" opacity=".10"/>`; }); });
      M.temps.forEach(t => s += `<text x="${x(t)}" y="${H - 10}" text-anchor="middle">${nf(t)}°</text>`);
      urs.forEach(u => s += `<text x="${pl - 6}" y="${y(u) + 4}" text-anchor="end">${nf(u)}%</text>`);
      Q.forEach((q, i) => { if (q.t == null || q.ur == null) return; const vt = q.vento > D.parametros.ventoMax; s += `<circle class="fade" cx="${x(q.t) + ((i * 37) % 7 - 3)}" cy="${y(q.ur) + ((i * 53) % 7 - 3)}" r="${vt ? 4.5 : 3.6}" fill="${vt ? '#fff' : CCOR[q.cond]}" stroke="${CCOR[q.cond]}" stroke-width="${vt ? 2 : 0}" opacity=".85" data-tip="${esc(`<b>${U.dBR(q.d)} ${q.hora != null ? String(q.hora).padStart(2, '0') + 'h' : ''}</b> · ${q.eq}<br>${nf(q.t, 1)} °C · UR ${nf(q.ur)}% · vento ${nf(q.vento, 1)} km/h<br><b>${CNOME[q.cond]}</b>${vt ? ' (vento)' : ''}<br>${esc(q.fazNome || q.faz)} · talhão ${esc(q.talhao)}`)}"/>`; });
      sc.innerHTML = s + '</svg>';
    }
    // por pulverizador: barras 100% empilhadas
    const pf = $('#pzQualFrota'), eqs = [...new Set(Q.map(q => q.eq))].sort();
    pf.innerHTML = eqs.map((e, i) => { const L = Q.filter(q => q.eq === e); return `<div class="pz-st100"><b>${esc(e)}</b><div class="pz-st100__b">${['CI', 'PE', 'SD'].map(k => { const f = L.filter(q => q.cond === k).length / L.length; return f ? `<i style="--w:${f * 100}%;--i:${i};background:${CCOR[k]}" data-tip="${esc(`<b>${e}</b> · ${CNOME[k]}: ${pc(f)}`)}">${f >= .12 ? Math.round(f * 100) + '%' : ''}</i>` : ''; }).join('')}</div><small>${L.length} aplic.</small></div>`; }).join('') || '<div class="ft-vazio">Sem aplicações no recorte.</div>';
    // leitura
    const melhores = hs.map(h => ({ h, L: por(h) })).filter(x => x.L.length >= 5).map(x => ({ h: x.h, ci: x.L.filter(q => q.cond === 'CI').length / x.L.length, n: x.L.length })).sort((a, b) => b.ci - a.ci);
    const piores = melhores.slice().reverse();
    let tx = !n ? 'Sem aplicações no recorte.' : `Das <b>${n}</b> aplicações, <b>${pc(c('CI') / n)}</b> foram em condição ideal e <b>${pc(c('SD') / n)}</b> em situação muito desfavorável. `;
    if (melhores.length > 2) tx += `Melhor janela: <b>${melhores.slice(0, 3).map(x => String(x.h).padStart(2, '0') + 'h').join(', ')}</b> (${pc(melhores[0].ci)} ideal). Evitar: <b>${piores.slice(0, 2).map(x => String(x.h).padStart(2, '0') + 'h').join(' e ')}</b> (${pc(piores[0].ci)} ideal). `;
    tx += '<small>Condição calculada pela matriz da BASE QUALIDADE (faixas de temperatura e umidade do cabeçalho) e vento acima do limite do PARAMETRO.</small>';
    $('#pzQualLeit').innerHTML = `<div class="tt"><i class="fa-solid fa-wand-magic-sparkles"></i>Leitura automática</div>${tx}`;
  }

  /* =================== PLANEJAMENTO DE HERBICIDAS (Matriz FO.SA.23) =================== */
  const OPCOR = { '2007': '#1F4D2B', '2242': '#3C7A35', '2260': '#2B7A78', '2111': '#B07A00', '2075': '#2a6fb0', '2175': '#7A4FB0', '2201': '#5E9A57', '2136': '#8A5A2B', '2041': '#C25E2E', todas: '#18301F' };
  const OPORDEM = ['2136', '2007', '2242', '2111', '2260', '2175', '2201', '2041', '2075'];
  const OPCURTO = { '2136': 'Quebra-lombo', '2007': '1ª aplicação', '2242': '1ª bordadura', '2111': 'Catação química', '2260': '2ª bordadura', '2175': 'Extensor de residual', '2201': '2ª aplicação', '2041': 'Dessecação', '2075': 'Inseticida pingente' };
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const hojeH = () => (H.gerado || new Date().toISOString()).slice(0, 10);
  const acum = (mapa, ate) => Object.entries(mapa || {}).reduce((a, [d, v]) => a + (d <= ate ? v : 0), 0);
  const fimMes = m => { const [y, mm] = m.split('-').map(Number); return new Date(Date.UTC(y, mm, 0)).toISOString().slice(0, 10); };
  const mLabel = m => MESES[+m.slice(5) - 1] + (m.slice(5) === '01' ? '/' + m.slice(2, 4) : '');
  /** operações com área na matriz; "todas" = soma de tudo que tinha que fazer × tudo que foi feito */
  function herbOps() {
    const L = OPORDEM.filter(k => H.ops[k] && H.ops[k].tot > 0).map(k => ({ ...H.ops[k], k, curto: OPCURTO[k] || H.ops[k].nome }));
    const soma = { k: 'todas', curto: 'Todas as operações', nome: 'Todas as operações', tot: 0, r: 0, a: 0, aa: 0, n: 0, semData: 0, esp: {}, real: {} };
    L.forEach(o => { ['tot', 'r', 'a', 'aa', 'n', 'semData'].forEach(c => soma[c] += o[c] || 0); ['esp', 'real'].forEach(c => Object.entries(o[c]).forEach(([d, v]) => soma[c][d] = (soma[c][d] || 0) + v)); });
    return [soma, ...L];
  }
  // curva monotônica: suave, sem passar acima/abaixo dos pontos
  function suave(P) {
    if (P.length < 2) return P.length ? `M${P[0][0]} ${P[0][1]}` : '';
    const n = P.length, dx = [], m = [], t = [];
    for (let i = 0; i < n - 1; i++) { dx[i] = P[i + 1][0] - P[i][0]; m[i] = (P[i + 1][1] - P[i][1]) / dx[i]; }
    t[0] = m[0]; t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : 3 * (dx[i - 1] + dx[i]) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
    let d = `M${P[0][0].toFixed(1)} ${P[0][1].toFixed(1)}`;
    for (let i = 0; i < n - 1; i++) { const h = dx[i] / 3; d += ` C${(P[i][0] + h).toFixed(1)} ${(P[i][1] + h * t[i]).toFixed(1)} ${(P[i + 1][0] - h).toFixed(1)} ${(P[i + 1][1] - h * t[i + 1]).toFixed(1)} ${P[i + 1][0].toFixed(1)} ${P[i + 1][1].toFixed(1)}`; }
    return d;
  }
  /** Curva acumulada por mês: realizado (linha cheia + área) × esperado (tracejada); faixa clara = meses ainda previstos. */
  function curvaA(el, o) {
    const { nf, pc, esc, nfs, W, passoBom } = U, h = hojeH(), hm = h.slice(0, 7), c = OPCOR[o.k] || '#1F4D2B';
    const ds = [...Object.keys(o.esp), ...Object.keys(o.real), h].sort(); const M = [];
    let [y, m] = ds[0].slice(0, 7).split('-').map(Number); const ult = ds[ds.length - 1].slice(0, 7);
    while (true) { const k = `${y}-${String(m).padStart(2, '0')}`; M.push(k); if (k >= ult) break; if (++m > 12) { m = 1; y++; } }
    const S = M.map(k => { const ate = k === hm ? h : fimMes(k); return { m: k, e: acum(o.esp, ate), r: k <= hm ? acum(o.real, ate) : null }; });
    const w = W(el), estreito = w < 560, Hh = estreito ? 260 : 300, pl = estreito ? 46 : 58, pr = estreito ? 12 : 128, pt = 24, pb = 34, n = M.length, ih = Math.max(0, M.indexOf(hm));
    const top = Math.max(o.tot, ...S.map(p => p.e)), passo = passoBom(top / 4), mx = top * 1.08;
    const X = i => pl + i * (w - pl - pr) / Math.max(1, n - 1), Y = v => pt + (Hh - pt - pb) * (1 - v / mx);
    let s = `<svg viewBox="0 0 ${w} ${Hh}" width="${w}" height="${Hh}" role="img" aria-label="Esperado × realizado acumulado · ${esc(o.nome)}"><defs><linearGradient id="hbA${o.k}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity=".28"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></linearGradient></defs>`;
    for (let v = 0; v <= top + 1e-9; v += passo) s += `<line x1="${pl}" x2="${w - pr}" y1="${Y(v)}" y2="${Y(v)}" stroke="#EEF1EC"/><text x="${pl - 8}" y="${Y(v) + 4}" text-anchor="end">${nf(v, 0)}</text>`;
    const pX = Math.max(1, Math.ceil(n / Math.floor((w - pl - pr) / 44)));
    S.forEach((p, i) => { if (i === ih || ((i % pX === 0 || i === n - 1) && Math.abs(X(i) - X(ih)) > 34)) s += `<text x="${X(i)}" y="${Hh - 10}" text-anchor="middle"${i === ih ? ' style="fill:#18301F;font-weight:800"' : ''}>${mLabel(p.m)}</text>`; });
    if (ih < n - 1) s += `<rect class="fade" x="${X(ih)}" y="${pt}" width="${X(n - 1) - X(ih)}" height="${Hh - pt - pb}" fill="#F4F7F2"/>${estreito ? '' : `<text class="fade" x="${X(ih) + 8}" y="${pt + 14}" style="font-weight:700">previsto</text>`}`;
    s += `<line class="fade" x1="${pl}" x2="${w - pr}" y1="${Y(o.tot)}" y2="${Y(o.tot)}" stroke="#18301F" stroke-opacity=".35" stroke-dasharray="2 4"/><text class="fade" x="${pl + 6}" y="${Y(o.tot) - 6}">área total ${nf(o.tot, 0)} ha</text>`;
    const pE = S.map((p, i) => [X(i), Y(p.e)]), pR = S.filter(p => p.r != null).map((p, i) => [X(i), Y(p.r)]);
    if (pR.length > 1) s += `<path class="fade" d="${suave(pR)} L${pR[pR.length - 1][0].toFixed(1)} ${Y(0)} L${pR[0][0].toFixed(1)} ${Y(0)} Z" fill="url(#hbA${o.k})"/>`;
    s += `<path class="hb-in" d="${suave(pE)}" fill="none" stroke="#9AA59D" stroke-width="2.2" stroke-dasharray="7 5" stroke-linecap="round"/>`;
    if (pR.length > 1) s += `<path class="hb-draw" pathLength="1" d="${suave(pR)}" fill="none" stroke="${c}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>`;
    pR.forEach((q, i) => s += `<circle class="hb-in" cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="${i === pR.length - 1 ? 6 : 3.6}" fill="${i === pR.length - 1 ? c : '#fff'}" stroke="${c}" stroke-width="2.4" style="--i:${i}"/>`);
    const eh = S[ih].e, rh = S[ih].r ?? 0;
    s += `<circle class="hb-in" cx="${X(ih)}" cy="${Y(eh)}" r="5" fill="#fff" stroke="#9AA59D" stroke-width="2.4"/>`;
    const pil = (yy, txt, cor) => { const pw = txt.length * 6.6 + 20, x0 = estreito ? X(ih) - 12 - pw : X(ih) + 12; return `<g class="hb-in"><rect x="${x0}" y="${yy - 12}" width="${pw}" height="24" rx="12" fill="${cor}"/><text x="${x0 + pw / 2}" y="${yy + 4}" text-anchor="middle" style="fill:#fff;font-weight:800;font-size:11px">${txt}</text></g>`; };
    let yr = Y(rh), ye = Y(eh); if (estreito) { ye = Math.min(ye, yr) - 30; yr = ye + 28; } else if (Math.abs(yr - ye) < 28) { const md = (yr + ye) / 2, up = yr > ye; yr = md + (up ? 14 : -14); ye = md + (up ? -14 : 14); }
    s += pil(ye, `esperado ${nf(eh, 0)}`, '#8C9A90') + pil(yr, `realizado ${nf(rh, 0)}`, c);
    if (ih < n - 1 && !estreito) s += `<text class="fade" x="${w - pr + 8}" y="${Y(S[n - 1].e) + 4}">fim ${nf(S[n - 1].e, 0)}</text>`;
    // dica por mês
    const cw = (w - pl - pr) / Math.max(1, n - 1);
    S.forEach((p, i) => s += `<rect x="${X(i) - cw / 2}" y="${pt}" width="${cw}" height="${Hh - pt - pb}" fill="transparent" data-tip="${esc(`<b>${mLabel(p.m)}${p.m.slice(5) !== '01' ? '/' + p.m.slice(0, 4) : ''}</b>${i === ih ? ' · até hoje' : ''}<br>Esperado: <b>${nf(p.e, 0)} ha</b> (${pc(p.e / o.tot)})${p.r != null ? `<br>Realizado: <b>${nf(p.r, 0)} ha</b> (${pc(p.r / o.tot)})<br>Diferença: <b>${nfs(p.r - p.e, 0)} ha</b>` : ''}`)}"/>`);
    el.innerHTML = s + '</svg>';
    return { eh, rh };
  }
  /** soGrafico: troca de operação nos botões → redesenha só o cartão (fila e OS ficam como estão) */
  function pHerb(soGrafico) {
    const { nf, pc, esc, dBRa, nfs } = U, el = $('#hbOps');
    if (!H || !H.ops) { el.innerHTML = '<div class="ft-vazio">Ainda não há dados da Matriz de Herbicida publicados. Use “Sincronizar”.</div>'; $('#hbFila').innerHTML = ''; pOS(); return; }
    $('#hbData').textContent = `posição de ${dBRa(hojeH())} · Matriz FO.SA.23`;
    const L = herbOps(); if (!L.some(o => o.k === S.hbOp)) S.hbOp = 'todas';
    const o = L.find(x => x.k === S.hbOp), c = OPCOR[o.k];
    el.innerHTML = `<article class="card hb-card" style="--c:${c}">
      <div class="hb-chips" role="tablist" aria-label="Operação">${L.map(x => `<button type="button" role="tab" aria-selected="${x.k === o.k}" class="hb-opc${x.k === o.k ? ' is-on' : ''}" data-k="${x.k}" style="--c:${OPCOR[x.k]}">${x.k === 'todas' ? '<i class="fa-solid fa-layer-group"></i>' : `<b>${x.k}</b>`}${esc(x.curto)}</button>`).join('')}</div>
      <div class="hb-nums" id="hbNums"></div>
      <div class="hb-leg2"><span><i></i>Realizado acumulado</span><span><i class="e"></i>Esperado acumulado</span></div>
      <div class="ft-chart hb-ch" id="hbCh"></div>
      <footer class="hb-rod" id="hbRod"></footer></article>`;
    const x = curvaA($('#hbCh'), o), ad = x.eh ? o.r / x.eh : null, st = ad == null ? '' : ad >= .97 ? 'ok' : ad >= .85 ? 'warn' : 'bad', dif = o.r - x.eh;
    $('#hbNums').innerHTML = `
      <div><small>Área total</small><b>${nf(o.tot, 0)}<em>ha</em></b><span>${o.k === 'todas' ? `${L.length - 1} operações somadas` : o.semData ? nf(o.semData, 0) + ' ha sem data planejada' : nf(o.n) + ' talhões'}</span></div>
      <div><small>Esperado até hoje</small><b>${nf(x.eh, 0)}<em>ha</em></b><span>${pc(x.eh / o.tot)} da área total</span></div>
      <div class="is-r"><small>Realizado (apontado)</small><b>${nf(o.r, 0)}<em>ha</em></b><span>${pc(o.r / o.tot)} da área total</span></div>
      <div><small>Saldo a realizar</small><b>${nf(Math.max(0, o.tot - o.r), 0)}<em>ha</em></b><span>${nf(o.aa, 0)} ha liberados para aplicar</span></div>`;
    $('#hbRod').innerHTML = `<b>${pc(o.r / o.tot)}</b> da área realizada · aderência <span class="ft-tag ${st}" title="realizado ÷ esperado até hoje">${pc(ad)}</span> · <b class="${dif < 0 ? 'neg' : 'pos'}">${nfs(dif, 0)} ha</b> contra o esperado${o.k === 'todas' ? '<small>soma das operações da matriz: o que tinha que ser feito até hoje × o que foi feito</small>' : ''}`;
    if (!soGrafico) { pFila(); pOS(); }
  }
  /** Fila das próximas aplicações (aba Resumo): uma coluna por frente, na ordem da sequência. */
  function pFila() {
    const { nf, esc, dBR, sum } = U, el = $('#hbFila'), F = H.fila || [];
    const fr = [...new Set(F.map(x => x.f))].sort((a, b) => a - b);
    if (!fr.length) { el.innerHTML = '<div class="ft-vazio">Sem aplicações na fila do Resumo.</div>'; return; }
    const hm = s => s ? `${dBR(s.slice(0, 10))} ${s.slice(11, 16)}` : '—';
    el.innerHTML = fr.map((f, i) => {
      const L = F.filter(x => x.f === f).sort((a, b) => (a.s ?? 0) - (b.s ?? 0) || String(a.ent).localeCompare(String(b.ent))), aberto = S.filaAberta === f, mostra = aberto ? L : L.slice(0, 5);
      const ops = {}; L.forEach(x => ops[x.op] = (ops[x.op] || 0) + x.ha);
      return `<article class="hb-fr" style="--i:${i}"><header><div><b>Frente ${esc(f)}</b><small>${esc(H.frentes[f] || '')}</small></div><div class="hb-fr__t"><b>${nf(sum(L.map(x => x.ha)), 1)} ha</b><small>${L.length} na fila${L[L.length - 1].sai ? ' · até ' + dBR(L[L.length - 1].sai.slice(0, 10)) : ''}</small></div></header>
        <div class="hb-mix">${Object.entries(ops).sort((a, b) => b[1] - a[1]).map(([o, v]) => `<i style="--w:${v / sum(L.map(x => x.ha)) * 100}%;background:${OPCOR[o] || '#9AA59D'}" data-tip="${esc(`<b>${o}</b> · ${nf(v, 1)} ha`)}"></i>`).join('')}</div>
        <ol>${mostra.map((x, j) => `<li style="--c:${OPCOR[x.op] || '#9AA59D'}"><span class="hb-seq">${nf(x.s, Number.isInteger(x.s) ? 0 : 1)}</span><div class="hb-it"><div class="hb-it__l1"><span class="hb-chip" title="${esc(x.nome)}">${esc(x.op)}</span><b title="${esc(x.faz)}">${esc(x.faz.replace(/^\d+-/, '').replace(/^Fazenda\s+/i, ''))}</b><span class="hb-ha">${nf(x.ha, 1)} ha</span></div><div class="hb-it__l2"><span>${esc(x.nome)}</span><span>${esc(x.faz.match(/^\d+/)?.[0] || '')}${x.tal ? ' · talhões ' + esc(x.tal) : ''}</span>${j === 0 ? '<span class="hb-ent">agora</span>' : x.ent ? `<span class="hb-ent">${hm(x.ent)}</span>` : ''}</div></div></li>`).join('')}</ol>
        ${L.length > 5 ? `<button type="button" class="hb-mais" data-f="${esc(f)}">${aberto ? 'Mostrar menos' : `Ver todas (+${L.length - 5})`}</button>` : ''}</article>`;
    }).join('');
    U.cascata(el);
  }

  /* =================== ORDENS DE SERVIÇO (Matriz: abas O.S + Apontamento 2026) =================== */
  const OS_LIM = { velha: 30, muitoVelha: 60, parada: 10 };
  const ddias = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 864e5);
  function osLista() {
    const h = hojeH();
    return (H.os || []).map(o => {
      const p = o.area ? Math.min(1.2, o.real / o.area) : 0, aberta = o.sit === 'A', idade = o.em ? ddias(o.em, h) : null, al = [];
      if (aberta) {
        if (p >= .98) al.push(['ok', 'Apontada 100% · finalizar OS']);
        if (!o.real && idade > 7) al.push(['warn', 'Sem apontamento']);
        else if (o.real && o.ult && p < .98 && ddias(o.ult, h) > OS_LIM.parada) al.push(['warn', `Parada há ${ddias(o.ult, h)} dias`]);
      }
      if (o.real > o.area * 1.05) al.push(['bad', 'Apontado acima da área']);
      const peso = al.reduce((s, a) => s + (a[0] === 'bad' ? 3 : a[0] === 'warn' ? 2 : 1), 0) + (aberta && idade > OS_LIM.velha ? 2 : 0);
      return { ...o, p, aberta, idade, al, peso };
    });
  }
  function pOS() {
    const { nf, pc, esc, dBR, dBRa, sum, avg, kpi, cascata, animar } = U;
    const sec = $('#pzOS'); if (!H || !H.os) { sec.hidden = true; return; } sec.hidden = false;
    const T = osLista(), A = T.filter(o => o.aberta), meta = (D && D.parametros && D.parametros.metaHaDia) || 150;
    const falt = sum(A.map(o => Math.max(0, o.area - o.real))), semAp = A.filter(o => !o.real), idM = avg(A.map(o => o.idade)), velha = A.slice().sort((a, b) => b.idade - a.idade)[0];
    const kp = $('#osK');
    kp.innerHTML = [
      kpi({ t: 'OS abertas', ic: 'fa-folder-open', v: A.length, sub: `${nf(sum(A.map(o => o.area)), 0)} ha emitidos · ${T.length - A.length} finalizadas` }),
      kpi({ t: 'Sem apontamento', ic: 'fa-circle-pause', v: semAp.length, un: `de ${A.length}`, sub: `${nf(sum(semAp.map(o => o.area)), 0)} ha emitidos e não iniciados`, st: semAp.length / Math.max(1, A.length) > .5 ? 'bad' : semAp.length ? 'warn' : 'ok', bar: A.length ? semAp.length / A.length : null }),
      kpi({ t: 'Área faltante', ic: 'fa-map', v: falt, dec: 0, un: 'ha', sub: `${nf(falt / meta, 1)} dias no ritmo de ${nf(meta)} ha/dia` }),
      kpi({ t: 'Idade média', ic: 'fa-hourglass-half', v: idM, dec: 0, un: 'dias', sub: velha ? `mais antiga: OS ${esc(velha.os)} · ${velha.idade} dias` : '', st: idM == null ? '' : idM > OS_LIM.velha ? 'bad' : idM > 15 ? 'warn' : 'ok' }),
      kpi({ t: `Abertas há +${OS_LIM.velha} dias`, ic: 'fa-triangle-exclamation', v: A.filter(o => o.idade > OS_LIM.velha).length, un: `de ${A.length}`, sub: `${A.filter(o => o.al.some(a => a[0] === 'ok')).length} apontada(s) 100% para finalizar`, st: A.some(o => o.idade > OS_LIM.muitoVelha) ? 'bad' : A.some(o => o.idade > OS_LIM.velha) ? 'warn' : 'ok', bar: A.length ? A.filter(o => o.idade > OS_LIM.velha).length / A.length : null }),
    ].join(''); cascata(kp); animar(kp);
    // abertas por operação (área emitida × apontada) — clique filtra
    const ops = [...new Set(A.map(o => o.op))].map(op => { const L = A.filter(o => o.op === op); return { op, nome: L[0].opNome || 'Operação ' + op, n: L.length, area: sum(L.map(o => o.area)), real: sum(L.map(o => Math.min(o.real, o.area))) }; }).sort((a, b) => b.area - a.area);
    const mx = Math.max(1, ...ops.map(o => o.area));
    $('#osOps').innerHTML = ops.map((o, i) => `<button type="button" class="os-op${S.osOp === o.op ? ' is-on' : ''}" data-op="${esc(o.op)}" style="--i:${i};--c:${OPCOR[o.op] || '#9AA59D'}"><span class="hb-chip">${esc(o.op)}</span><span class="os-op__n">${esc(o.nome)}<small>${o.n} OS</small></span><span class="os-op__b"><i style="--w:${o.area / mx * 100}%"><em style="--w:${o.area ? o.real / o.area * 100 : 0}%"></em></i></span><b>${nf(o.area, 0)} ha</b><small class="os-op__p">${pc(o.area ? o.real / o.area : 0)} apont.</small></button>`).join('') || '<div class="ft-vazio">Nenhuma OS aberta.</div>';
    // idade das abertas
    const fx = [['até 15 dias', o => o.idade <= 15, 'ok'], ['16 a 30', o => o.idade > 15 && o.idade <= 30, 'warn'], ['31 a 60', o => o.idade > 30 && o.idade <= 60, 'bad'], ['mais de 60', o => o.idade > 60, 'bad']];
    const fv = fx.map(([n, f, c]) => { const L = A.filter(f); return { n, c, q: L.length, ha: sum(L.map(o => o.area)) }; }), fm = Math.max(1, ...fv.map(x => x.q));
    $('#osIdade').innerHTML = fv.map((x, i) => `<div class="os-id ${x.c}${x.n === 'mais de 60' ? ' is-max' : ''}" style="--i:${i}"><b>${x.q}</b><div class="os-id__b"><i style="--h:${x.q / fm * 100}%"></i></div><span>${x.n}</span><small>${nf(x.ha, 0)} ha</small></div>`).join('');
    // tabela
    const vis = S.osVer === 'todas' ? T : S.osVer === 'fin' ? T.filter(o => !o.aberta) : A;
    const L = vis.filter(o => !S.osOp || o.op === S.osOp).sort((a, b) => S.osVer === 'abertas' ? b.peso - a.peso || b.idade - a.idade : String(b.em).localeCompare(String(a.em)));
    $('#osN').textContent = `${L.length} OS${S.osOp ? ' · operação ' + S.osOp : ''}`;
    const stc = o => o.aberta ? (o.real ? ['warn', 'Em andamento'] : ['bad', 'Não iniciada']) : ['ok', 'Finalizada'];
    const idc = o => !o.aberta ? '' : o.idade > OS_LIM.muitoVelha ? 'bad' : o.idade > OS_LIM.velha ? 'warn' : 'ok';
    $('#osTab').innerHTML = `<table><thead><tr><th>OS</th><th>Operação</th><th>Fazenda</th><th>Talhões</th><th class="n">Área</th><th>Apontado</th><th>Status</th><th class="n">Emitida</th><th class="n">Idade</th><th class="n">Últ. apont.</th><th>Alerta</th></tr></thead><tbody>${L.slice(0, S.osMais ? 9999 : 60).map((o, i) => { const [sc, sn] = stc(o); return `<tr class="os-tr${S.osAb === o.os ? ' is-on' : ''}" data-os="${esc(o.os)}" style="--i:${Math.min(i, 24)};--c:${OPCOR[o.op] || '#9AA59D'}"><td><b>${esc(o.os)}</b></td><td><span class="hb-chip">${esc(o.op)}</span> <span class="os-opn">${esc(o.opNome || '')}</span></td><td>${esc(o.fazNome || o.faz)}${o.nFaz > 1 ? ` <small class="os-mais">+${o.nFaz - 1}</small>` : ''}<small class="os-cod">${esc(o.faz)}</small></td><td class="os-tal" title="${esc(o.tal)}">${esc(o.tal)}</td><td class="n">${nf(o.area, 1)}</td><td><div class="pz-prog"><div class="trk"><i style="--w:${Math.min(100, o.p * 100)}%;background:var(--c)"></i></div><span>${pc(o.p)}</span></div></td><td><span class="ft-tag ${sc}">${sn}</span></td><td class="n">${o.em ? dBR(o.em) : '—'}</td><td class="n">${o.idade == null ? '—' : `<span class="os-age ${o.aberta ? idc(o) : ''}">${o.idade} d</span>`}</td><td class="n">${o.ult ? dBR(o.ult) : '—'}</td><td>${o.al.map(a => `<span class="os-al ${a[0]}">${esc(a[1])}</span>`).join('')}</td></tr>${S.osAb === o.os ? `<tr class="os-det"><td colspan="11"><div class="os-det__g"><div><small>Talhões (${o.nTal})</small><p>${esc(o.tal)}</p></div><div><small>Recursos</small><p>${o.rec && o.rec.length ? o.rec.map(esc).join(' · ') : '—'}${o.f ? ` · Frente ${esc(o.f)}${H.frentes && H.frentes[o.f] ? ' (' + esc(H.frentes[o.f]) + ')' : ''}` : ''}</p></div><div class="os-det__p"><small>Produtos da OS</small>${o.prod.length ? `<table><thead><tr><th>Produto</th><th class="n">Dose/ha</th><th class="n">Total</th></tr></thead><tbody>${o.prod.map(p => `<tr><td>${esc(p.n)}</td><td class="n">${p.d == null ? '—' : nf(p.d, p.d < 1 ? 3 : 2)}</td><td class="n">${nf(p.q, 1)}</td></tr>`).join('')}</tbody></table>` : '<p>—</p>'}</div></div></td></tr>` : ''}`; }).join('')}</tbody></table>${L.length > 60 && !S.osMais ? `<button type="button" class="hb-mais" data-osmais="1">Ver todas (+${L.length - 60})</button>` : ''}`;
    U.mover($('#osVer'), $(`#osVer button[data-v="${S.osVer}"]`), true);
  }

  /* ---------- montagem ---------- */
  function ligar() {
    if (ligado) return; ligado = true;
    $('#hbOps').onclick = e => { const b = e.target.closest('.hb-opc'); if (b && b.dataset.k !== S.hbOp) { S.hbOp = b.dataset.k; pHerb(true); } };
    $('#osVer').onclick = e => { const b = e.target.closest('button'); if (b) { S.osVer = b.dataset.v; S.osMais = false; pOS(); } };
    $('#osOps').onclick = e => { const b = e.target.closest('.os-op'); if (b) { S.osOp = S.osOp === b.dataset.op ? null : b.dataset.op; pOS(); } };
    $('#osTab').onclick = e => { if (e.target.closest('[data-osmais]')) { S.osMais = true; pOS(); return; } const r = e.target.closest('tr.os-tr'); if (r) { S.osAb = S.osAb === r.dataset.os ? null : r.dataset.os; pOS(); } };
    $('#hbFila').onclick = e => { const b = e.target.closest('.hb-mais'); if (b) { S.filaAberta = S.filaAberta === b.dataset.f ? null : b.dataset.f; pFila(); } };
    $('#pzBaixar').onclick = async () => { const c = await imagem(); if (!c) return; const a = document.createElement('a'); a.href = c.toDataURL('image/png'); const R = regAtual(); a.download = `status-pulverizacao-${R.data}${R.turno ? '-' + R.turno.replace(/\W+/g, '') : ''}.png`; a.click(); U.toast('Imagem baixada.'); };
    $('#pzCopiar').onclick = async () => { try { const c = await imagem(); if (!c) return; const blob = await new Promise(r => c.toBlob(r, 'image/png')); await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); U.toast('Imagem copiada — é só colar no grupo.'); } catch (e) { U.toast('Não foi possível copiar. Use “Baixar imagem”.'); } };
    $$('.pz-reg').forEach(n => {
      n.querySelector('select').onchange = e => irReg(e.target.value);
      n.onclick = e => { const b = e.target.closest('button[data-n]'); if (!b) return; const L = regs(), k = regAtual().k, i = L.findIndex(r => r.k === k) + +b.dataset.n; if (L[i]) irReg(L[i].k); };
    });
    let tm; addEventListener('resize', () => { clearTimeout(tm); tm = setTimeout(() => { if (D && visivel()) { pProd(); pQual(); if (H && H.ops) pHerb(true); } }, 220); });
  }
  const visivel = () => { const pg = $('.page[data-p="pulv"]'); return pg && pg.classList.contains('is-on'); };
  function montar() {
    U = window.Fertirrigacao.util;
    const dP = [...new Set(D.producao.map(p => p.d))].sort(), dQ = [...new Set(D.qualidade.map(q => q.d))].sort();
    const eqP = [...new Set(D.producao.map(p => p.eq))].sort(), eqQ = [...new Set(D.qualidade.map(q => q.eq))].sort();
    const tP = TURNOS.filter(t => D.producao.some(p => p.t === t)), tQ = TURNOS.filter(t => D.qualidade.some(q => q.turno === t));
    const padP = () => ({ de: dP[0], ate: dP[dP.length - 1], t: 'todos', eq: 'todos' });
    const padQ = () => ({ de: U.addD(dQ[dQ.length - 1], -29), ate: dQ[dQ.length - 1], t: 'todos', eq: 'todos' });
    if (!S) S = { p: padP(), q: padQ(), hbOp: 'todas', filaAberta: null, osVer: 'abertas', osOp: null, osAb: null, osMais: false };
    S.fbP = filtro($('#pzFbProd'), S.p, { turnos: tP, frotas: eqP, min: dP[0], max: dP[dP.length - 1], padrao: padP, cb: pProd });
    S.fbQ = filtro($('#pzFbQual'), S.q, { turnos: tQ, frotas: eqQ, min: dQ[0], max: dQ[dQ.length - 1], padrao: padQ, cb: pQual });
    ligar();
    pResumo(); pFrota(); pRegNav(); pCaminhoes(); pCard(); pProd(); pQual(); pHerb();
    montado = true;
    if (window.Aviacao && Aviacao.dados) Aviacao.aoEntrar(); // nomes das fazendas da aviação vêm do cadastro da pulverização
  }
  // gancho de troca de página: gráficos desenhados com a página oculta ficam estreitos → redesenha ao entrar
  if (window.Layout) {
    const ant = Layout.aoEntrar;
    Layout.aoEntrar = pg => {
      if (typeof ant === 'function') ant(pg);
      if (pg.dataset.p === 'pulv') aoEntrar();
      else if (pg.dataset.p === 'fert') dispatchEvent(new Event('resize'));
    };
  }
  /** herbicida.json (Matriz FO.SA.23) é carregado à parte: a página funciona com ou sem ele */
  async function carregarHerb(dados) {
    if (dados) H = dados; else try { const r = await fetch(ARQ_HERB, { cache: 'no-store' }); if (r.ok) H = (await Acesso.readJson(await r.json())).data; } catch (e) { /* sem arquivo ainda */ }
    if (montado) pHerb();
  }
  function definirHerb(dados) { H = dados; if (montado) pHerb(); }
  async function iniciar(dados, herb) {
    if (!window.Fertirrigacao || !Fertirrigacao.util) return;
    carregarHerb(herb);
    if (dados) { D = dados; montar(); return; }
    try {
      const r = await fetch(ARQ, { cache: 'no-store' }); if (!r.ok) throw new Error('sem arquivo');
      D = (await Acesso.readJson(await r.json())).data; montar();
    } catch (e) { const el = $('#pzKpis'); if (el) el.innerHTML = '<div class="ft-vazio" style="grid-column:1/-1">Ainda não há dados da pulverização publicados. Use “Sincronizar”.</div>'; }
  }
  /** chamado quando a página aparece: redesenha os gráficos na largura certa e refaz as animações */
  function aoEntrar() { if (!D || !montado) return; pResumo(); pFrota(); pCaminhoes(); pProd(); pQual(); pHerb(); requestAnimationFrame(() => { S.fbP.sync(true); S.fbQ.sync(true); if (H && H.os) U.mover($('#osVer'), $(`#osVer button[data-v="${S.osVer}"]`), true); }); }
  function definir(dados) { D = dados; S = null; montar(); }
  return { iniciar, definir, definirHerb, aoEntrar, VERSAO, ARQ, ARQ_HERB, get dados() { return D; }, get herb() { return H; } };
})();
