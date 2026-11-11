/* =========================================================================
   Página Pulverização (painel Gerenciamento Produção)
   Fonte: planilha "Pulverizadores.xlsx" → pulverizacao.json (criptografado)
   Seções: Resumo · Status da frota (+ imagem para o grupo) · Caminhões ·
   Produção (IOA PULVE, meta 150 ha/dia por pulverizador) · Qualidade da
   aplicação · Ordens de serviço.
   window.Pulverizacao = { iniciar(), definir(dados), aoEntrar(), VERSAO }
   ========================================================================= */
window.Pulverizacao = (function () {
  'use strict';
  const VERSAO = 1;
  const ARQ = 'pulverizacao.json';
  const ORDEM_FRENTES = ['PULVERIZADOR', 'HERBICAT', 'CALDA PRONTA', 'CORTE DE SOQUEIRA', 'AVIAÇÃO', 'BASE'];
  const ST_COR = { 'Rodando': 'ok', 'Parado': 'warn', 'Falta operador': 'warn', 'Manutenção': 'bad', 'Sem status': 'nd' };
  const CCOR = { CI: '#2E7D32', PE: '#E0A100', SD: '#C62828' };
  const CNOME = { CI: 'Condição ideal', PE: 'Perda de eficiência', SD: 'Muito desfavorável' };
  const TURNOS = ['A', 'B', 'C', 'ADM'];

  let D = null, U = null, S = null, ligado = false, montado = false;
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
  function frentesStatus() {
    const g = {}; (D.status.frota || []).forEach(x => (g[x.frente] = g[x.frente] || []).push(x));
    return Object.keys(g).sort((a, b) => { const ia = ORDEM_FRENTES.indexOf(a), ib = ORDEM_FRENTES.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b, 'pt-BR'); }).map(f => ({ frente: f, itens: g[f] }));
  }
  // meta da frente: 150 ha/dia no total; filtrando um pulverizador, a meta é dividida entre os que apontaram no dia
  const metaDia = (d, eqs) => { const todos = new Set(D.producao.filter(p => p.d === d).map(p => p.eq)); if (!todos.size) return 0; if (!eqs) return D.parametros.metaHaDia; const n = [...todos].filter(e => eqs.includes(e)).length; return n ? D.parametros.metaHaDia * n / todos.size : 0; };
  function pResumo() {
    const { nf, pc, dBR, dBRa, sum, kpi, cascata, animar, addD } = U;
    const fr = D.status.frota || [], tot = fr.length, rod = fr.filter(x => x.status === 'Rodando').length, par = fr.filter(x => /Parado|Falta/.test(x.status)), man = fr.filter(x => x.status === 'Manutenção');
    const motP = {}; par.forEach(x => { const m = x.motivo || 'sem motivo'; motP[m] = (motP[m] || 0) + 1; });
    const topP = Object.entries(motP).sort((a, b) => b[1] - a[1])[0];
    const dias = [...new Set(D.producao.map(p => p.d))].sort(), hoje = D.status.data || dias[dias.length - 1];
    const d1 = dias.filter(d => d < hoje).pop() || dias[dias.length - 1];
    const r1 = sum(D.producao.filter(p => p.d === d1).map(p => p.ha)), m1 = metaDia(d1), q1 = m1 ? r1 / m1 : null;
    const mes = (d1 || '').slice(0, 7), pm = D.producao.filter(p => p.d.startsWith(mes)), rm = sum(pm.map(p => p.ha)), dm = new Set(pm.map(p => p.d)).size;
    const abertas = D.os.filter(o => o.status !== 'Concluída'), falt = sum(abertas.map(o => Math.max(0, o.area - o.real)));
    const fimQ = D.qualidade.map(q => q.d).sort().pop(), q30 = D.qualidade.filter(q => q.d > addD(fimQ, -30) && q.cond), ci = q30.filter(q => q.cond === 'CI').length, sd = q30.filter(q => q.cond === 'SD').length;
    const st = p => p == null ? '' : p >= 1 ? 'ok' : p >= .9 ? 'warn' : 'bad';
    const el = $('#pzKpis');
    el.innerHTML = [
      kpi({ t: 'Equipamentos rodando', ic: 'fa-play', v: rod, un: `de ${tot}`, sub: `<b>${pc(tot ? rod / tot : null)}</b> em operação`, st: tot ? (rod / tot >= .7 ? 'ok' : rod / tot >= .4 ? 'warn' : 'bad') : '', bar: tot ? rod / tot : null }),
      kpi({ t: 'Parados', ic: 'fa-circle-pause', v: par.length, sub: topP ? `mais comum: <b>${U.esc(topP[0].toLowerCase())}</b>` : 'nenhum parado', st: par.length ? 'warn' : 'ok' }),
      kpi({ t: 'Em manutenção', ic: 'fa-screwdriver-wrench', v: man.length, sub: man.length ? U.esc(man.slice(0, 4).map(x => x.frota).join(', ')) + (man.length > 4 ? '…' : '') : 'nenhum', st: man.length ? 'bad' : 'ok' }),
      kpi({ t: `Produção · ${dBR(d1)}`, ic: 'fa-spray-can-sparkles', v: r1, dec: 1, un: 'ha', sub: `meta ${nf(m1)} ha/dia da frente` }),
      kpi({ t: `Atingimento · ${dBR(d1)}`, ic: 'fa-bullseye', v: q1 == null ? null : q1 * 100, dec: 1, un: '%', sub: q1 == null ? '' : `diferença de <b>${U.nfs(r1 - m1, 1)} ha</b>`, st: st(q1), bar: q1, mk: q1 ? Math.min(1, 1 / Math.max(1, q1)) : null }),
      kpi({ t: 'Produção no mês', ic: 'fa-calendar-check', v: rm, dec: 1, un: 'ha', sub: dm ? `${dm} dia(s) · média ${nf(rm / dm, 1)} ha/dia` : '' }),
      kpi({ t: 'OS em aberto', ic: 'fa-clipboard-list', v: abertas.length, sub: `<b>${nf(falt, 1)} ha</b> faltando aplicar`, attrs: 'data-ir="pzOS" style="cursor:pointer"' }),
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

  /* =================== CAMINHÕES (nível dos tanques) =================== */
  function pCaminhoes() {
    const { nf, pc, esc, dBRa } = U;
    const N = D.nivel, el = $('#pzTanques');
    $('#pzNivData').textContent = N ? `${dBRa(N.data)}${N.turno ? ' · turno ' + N.turno : ''}` : '';
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
    const N = D.nivel, card = $('#pzCard');
    card.innerHTML = `<div class="fc-head"><div class="fc-logo"><img src="logo.png" alt="Bioenergética Aroeira"></div><div class="fc-tt"><h3>Status · Pulverização</h3><p>Defensivos agrícolas · COA Bioenergética Aroeira</p></div><div class="fc-data"><b>${dBRa(D.status.data)}</b><span>${semana(D.status.data)}${D.status.turno ? ' · ' + esc(D.status.turno) : ''}</span></div></div>
      ${frentesStatus().map(g => `<div class="fc-sec"><h4>${esc(g.frente)}${(D.status.inicio || {})[g.frente] ? ' · início ' + D.status.inicio[g.frente] : ''}</h4><div class="pz-cl">${g.itens.map(x => `<div class="pz-ci ${ST_COR[x.status] || 'nd'}"><span class="pz-dot"></span><b>${esc(x.frota)}</b><span>${esc(x.status)}${x.motivo ? ' · ' + esc(x.motivo.toLowerCase()) : ''}</span></div>`).join('')}</div></div>`).join('')}
      ${N && N.caminhoes.length ? `<div class="fc-sec"><h4>Nível dos caminhões${N.turno ? ' · turno ' + esc(N.turno) : ''}</h4>${N.caminhoes.map(c => `<div class="pz-cn"><b>${esc(c.caminhao)}</b><div class="fc-trk"><i style="--w:${(c.p || 0) * 100}%;background:${{ ok: '#2a78d6', warn: '#E0A100', bad: '#C62828' }[c.status] || '#9AA59D'}"></i></div><span>${pc(c.p)} · ${nf(c.litros)} L ${esc(c.conteudo || '')}</span></div>`).join('')}</div>` : ''}
      <div class="fc-foot"><span>Gerenciamento Produção · ${new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}${D.status.informadoPor ? ' · informado por ' + esc(D.status.informadoPor) : ''}</span><span>© Talamante</span></div>`;
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
          ['SD', 'PE', 'CI'].forEach(k => { const f = L.filter(q => q.cond === k).length / L.length; if (!f) return; s += `<rect class="ftb" style="--i:${i}" x="${x}" y="${y(acc + f)}" width="${bwi}" height="${y(acc) - y(acc + f)}" fill="${CCOR[k]}" opacity="${.35 + .65 * L.length / mx}" data-tip="${esc(`<b>${String(h).padStart(2, '0')}h</b> · ${L.length} aplicações<br>${CNOME.CI}: ${pc(L.filter(q => q.cond === 'CI').length / L.length)}<br>${CNOME.PE}: ${pc(L.filter(q => q.cond === 'PE').length / L.length)}<br>${CNOME.SD}: ${pc(L.filter(q => q.cond === 'SD').length / L.length)}`)}"/>`; acc += f; });
          const ci = L.filter(q => q.cond === 'CI').length / L.length;
          if (bwi >= 18) s += `<text class="lb fade" x="${x + bwi / 2}" y="${pt - 6}" text-anchor="middle" style="font-size:10px">${Math.round(ci * 100)}</text>`;
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

  /* =================== ORDENS DE SERVIÇO =================== */
  function pOS() {
    const { nf, pc, esc, dBR, sum, kpi, cascata, animar } = U;
    const P = D.parametros, hoje = D.status.data || new Date().toISOString().slice(0, 10);
    const dd = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 864e5);
    const L = D.os.map(o => {
      const falt = Math.max(0, o.area - o.real), idade = o.abertura && o.status !== 'Concluída' ? dd(o.abertura, hoje) : null, al = [];
      if (o.real > o.area * (1 + P.tolArea)) al.push('Verificar área realizada');
      if (idade != null && idade > P.idadeMax) al.push(`Em aberto há ${idade} dias`);
      if (!o.op) al.push('Sem operação');
      if (o.status !== 'Concluída' && !o.mapa) al.push('Mapa não enviado');
      return { ...o, falt, idade, al, prev: o.status === 'Concluída' ? null : falt / P.metaHaDia };
    });
    const ab = L.filter(o => o.status !== 'Concluída'), falt = sum(ab.map(o => o.falt));
    const kp = $('#pzOSK');
    kp.innerHTML = [
      kpi({ t: 'Em andamento', ic: 'fa-spinner', v: L.filter(o => o.status === 'Em andamento').length, sub: 'OS com aplicação iniciada' }),
      kpi({ t: 'Não iniciadas', ic: 'fa-hourglass-start', v: L.filter(o => o.status === 'Não iniciada').length, sub: `${L.filter(o => o.status === 'Concluída').length} concluídas no total` }),
      kpi({ t: 'Área faltante', ic: 'fa-map', v: falt, dec: 1, un: 'ha', sub: `${nf(sum(ab.map(o => o.area)), 0)} ha em OS abertas` }),
      kpi({ t: 'Carteira', ic: 'fa-calendar-days', v: falt / P.metaHaDia, dec: 1, un: 'dias', sub: `no ritmo da meta de ${nf(P.metaHaDia)} ha/dia` }),
      kpi({ t: 'OS com alerta', ic: 'fa-triangle-exclamation', v: ab.filter(o => o.al.length).length, sub: 'abertas há muito tempo, sem mapa ou sem operação', st: ab.some(o => o.al.length) ? 'warn' : 'ok' }),
    ].join(''); cascata(kp); animar(kp);
    const mostra = S.osTodas ? L : ab;
    const ord = { 'Em andamento': 0, 'Não iniciada': 1, 'Concluída': 2 };
    mostra.sort((a, b) => b.al.length - a.al.length || ord[a.status] - ord[b.status] || String(a.abertura).localeCompare(String(b.abertura)));
    const stc = { 'Concluída': 'ok', 'Em andamento': 'warn', 'Não iniciada': 'bad' };
    $('#pzOSTab').innerHTML = `<table><thead><tr><th>OS</th><th>Operação</th><th>Pulv.</th><th>Fazenda</th><th>Talhões</th><th class="n">Área</th><th>Progresso</th><th>Status</th><th class="n">Idade</th><th class="n">Previsão</th><th>Alerta</th></tr></thead><tbody>${mostra.map(o => `<tr><td><b>${esc(o.os)}</b></td><td>${esc(o.opNome || o.op || '—')}</td><td>${esc(o.eq)}</td><td>${esc(o.fazNome || o.faz)}</td><td class="pz-tal" title="${esc(o.talhoes)}">${esc(o.talhoes)}</td><td class="n">${nf(o.area, 1)}</td><td><div class="pz-prog"><div class="trk"><i style="--w:${Math.min(100, o.p * 100)}%;background:${o.p >= 1 ? '#2E7D32' : '#3C7A35'}"></i></div><span>${pc(o.p)}</span></div></td><td><span class="ft-tag ${stc[o.status]}">${o.status}</span></td><td class="n">${o.idade == null ? '—' : o.idade + ' d'}</td><td class="n">${o.prev == null ? '—' : nf(o.prev, 1) + ' d'}</td><td>${o.al.map(a => `<span class="pz-al">${esc(a)}</span>`).join('')}</td></tr>`).join('')}</tbody></table>`;
    U.mover($('#pzOSFiltro'), $(`#pzOSFiltro button[data-v="${S.osTodas ? 'todas' : 'abertas'}"]`), true);
  }

  /* ---------- montagem ---------- */
  function ligar() {
    if (ligado) return; ligado = true;
    $('#pzOSFiltro').onclick = e => { const b = e.target.closest('button'); if (b) { S.osTodas = b.dataset.v === 'todas'; pOS(); } };
    $('#pzBaixar').onclick = async () => { const c = await imagem(); if (!c) return; const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = `status-pulverizacao-${D.status.data}.png`; a.click(); U.toast('Imagem baixada.'); };
    $('#pzCopiar').onclick = async () => { try { const c = await imagem(); if (!c) return; const blob = await new Promise(r => c.toBlob(r, 'image/png')); await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); U.toast('Imagem copiada — é só colar no grupo.'); } catch (e) { U.toast('Não foi possível copiar. Use “Baixar imagem”.'); } };
    let tm; addEventListener('resize', () => { clearTimeout(tm); tm = setTimeout(() => { if (D && visivel()) { pProd(); pQual(); } }, 220); });
  }
  const visivel = () => { const pg = $('.page[data-p="pulv"]'); return pg && pg.classList.contains('is-on'); };
  function montar() {
    U = window.Fertirrigacao.util;
    const dP = [...new Set(D.producao.map(p => p.d))].sort(), dQ = [...new Set(D.qualidade.map(q => q.d))].sort();
    const eqP = [...new Set(D.producao.map(p => p.eq))].sort(), eqQ = [...new Set(D.qualidade.map(q => q.eq))].sort();
    const tP = TURNOS.filter(t => D.producao.some(p => p.t === t)), tQ = TURNOS.filter(t => D.qualidade.some(q => q.turno === t));
    const padP = () => ({ de: dP[0], ate: dP[dP.length - 1], t: 'todos', eq: 'todos' });
    const padQ = () => ({ de: U.addD(dQ[dQ.length - 1], -29), ate: dQ[dQ.length - 1], t: 'todos', eq: 'todos' });
    if (!S) S = { p: padP(), q: padQ(), osTodas: false };
    S.fbP = filtro($('#pzFbProd'), S.p, { turnos: tP, frotas: eqP, min: dP[0], max: dP[dP.length - 1], padrao: padP, cb: pProd });
    S.fbQ = filtro($('#pzFbQual'), S.q, { turnos: tQ, frotas: eqQ, min: dQ[0], max: dQ[dQ.length - 1], padrao: padQ, cb: pQual });
    ligar();
    pResumo(); pFrota(); pCaminhoes(); pCard(); pProd(); pQual(); pOS();
    montado = true;
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
  async function iniciar(dados) {
    if (!window.Fertirrigacao || !Fertirrigacao.util) return;
    if (dados) { D = dados; montar(); return; }
    try {
      const r = await fetch(ARQ, { cache: 'no-store' }); if (!r.ok) throw new Error('sem arquivo');
      D = (await Acesso.readJson(await r.json())).data; montar();
    } catch (e) { const el = $('#pzKpis'); if (el) el.innerHTML = '<div class="ft-vazio" style="grid-column:1/-1">Ainda não há dados da pulverização publicados. Use “Sincronizar”.</div>'; }
  }
  /** chamado quando a página aparece: redesenha os gráficos na largura certa e refaz as animações */
  function aoEntrar() { if (!D || !montado) return; pResumo(); pFrota(); pCaminhoes(); pProd(); pQual(); requestAnimationFrame(() => { S.fbP.sync(true); S.fbQ.sync(true); U.mover($('#pzOSFiltro'), $(`#pzOSFiltro button[data-v="${S.osTodas ? 'todas' : 'abertas'}"]`), true); }); }
  function definir(dados) { D = dados; S = null; montar(); }
  return { iniciar, definir, aoEntrar, VERSAO, ARQ, get dados() { return D; } };
})();
