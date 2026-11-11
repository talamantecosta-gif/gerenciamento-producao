/* =========================================================================
   Página Aviação (aplicação aérea · plataforma TRAVICAR)
   Fonte: "Relatório do Ciclo de Operação" (relatorio-ciclo-operacao.xlsx) → aviacao.json
   Seções: Resumo · Ciclo de aplicação · Produção · Qualidade · Voo · Trabalhos
   window.Aviacao = { iniciar(dados), definir(dados), aoEntrar(), VERSAO }
   ========================================================================= */
window.Aviacao = (function () {
  'use strict';
  const VERSAO = 1;
  const ARQ = 'aviacao.json';
  const ETAPAS = [
    { k: 'tSolo', nome: 'Solo', cor: '#9AA59D', ic: 'fa-plane-arrival' },
    { k: 'tTrans', nome: 'Translado', cor: '#5E9A57', ic: 'fa-route' },
    { k: 'tBalao', nome: 'Balão', cor: '#A9C99A', ic: 'fa-rotate' },
    { k: 'tApl', nome: 'Aplicação', cor: '#1F4D2B', ic: 'fa-spray-can-sparkles' },
  ];
  // faixas de leitura dos índices da TRAVICAR (%): verde ≥ 95 · amarelo 85–95 · vermelho < 85
  const FX = { ok: 95, warn: 85 };
  const stI = v => v == null ? '' : v >= FX.ok ? 'ok' : v >= FX.warn ? 'warn' : 'bad';

  let D = null, U = null, S = null, ligado = false, montado = false, NOMES = {}, OSFAZ = {};
  const $ = s => document.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];

  /* ---------- formatos ---------- */
  const hm = m => { if (m == null || !isFinite(m)) return '—'; const t = Math.round(m), h = Math.floor(t / 60), mm = t % 60; return h ? `${h}h${String(mm).padStart(2, '0')}` : `${mm} min`; };
  const pond = (L, k) => { const v = L.filter(t => t[k] != null && t.ha > 0); const p = U.sum(v.map(t => t.ha)); return p ? U.sum(v.map(t => t[k] * t.ha)) / p : null; };
  const fazDe = t => { const f = t.faz || (t.os && OSFAZ[t.os.split(',')[0].trim()]) || null; return f; };
  const nomeFaz = t => { const f = fazDe(t); const n = (f && NOMES[f]) || t.fazNome; return f ? (n ? `${f} · ${n}` : f) : (n || 'Sem fazenda'); };
  /** card com valor em texto (tempos) no mesmo visual dos cards do painel */
  const kpiT = ({ t, ic, txt, sub = '', st = '', bar = null }) => `<div class="k${st ? ' is-' + st : ''}"><div class="k__t"><span>${t}</span><i class="fa-solid ${ic}"></i></div><div class="k__v av-tv">${txt}</div><div class="k__s">${sub}</div>${bar != null ? `<div class="k__bar"><i style="width:${Math.max(0, Math.min(100, bar * 100))}%"></i></div>` : ''}</div>`;

  /* ---------- filtro: período (Data Início) + fazenda ---------- */
  function filtro() {
    const { dBRa, addD, rangeD, esc } = U, el = $('#avFb'), F = S.f, dias = [...new Set(D.trabalhos.map(t => t.d))].sort(), min = dias[0], max = dias[dias.length - 1];
    const fz = [...new Map(D.trabalhos.map(t => [fazDe(t) || '—', nomeFaz(t)])).entries()].filter(([k]) => k !== '—').sort((a, b) => a[0].localeCompare(b[0]));
    el.innerHTML = `<div class="pv-fg pv-fg--per"><span class="pv-fl"><i class="fa-regular fa-calendar"></i>Data de início</span><div class="pv-fctl"><div class="pv-range"><input type="date" data-k="de" aria-label="De"><i class="fa-solid fa-arrow-right-long" aria-hidden="true"></i><input type="date" data-k="ate" aria-label="Até"></div><div class="pv-seg pv-pre" data-k="pre"><button type="button" data-v="7">7 dias</button><button type="button" data-v="30">30 dias</button><button type="button" data-v="mes">Mês</button><button type="button" data-v="tudo">Tudo</button></div></div></div>
      <div class="pv-fg"><span class="pv-fl"><i class="fa-solid fa-map-location-dot"></i>Fazenda</span><div class="pv-fctl"><select class="av-sel" data-k="faz"><option value="todas">Todas as fazendas</option>${fz.map(([k, n]) => `<option value="${esc(k)}">${esc(n)}</option>`).join('')}</select></div></div>
      <div class="pv-fg pv-fg--local"><div class="pv-fctl"><span class="ft-fresumo"></span><button type="button" class="pv-limpar"><i class="fa-solid fa-rotate-left"></i><span>Limpar filtros</span></button></div></div>`;
    const at = a => { if (a === '7') F.de = addD(F.ate, -6); else if (a === '30') F.de = addD(F.ate, -29); else if (a === 'mes') F.de = F.ate.slice(0, 8) + '01'; else if (a === 'tudo') { F.de = min; F.ate = max; } if (F.de < min) F.de = min; };
    el.onclick = e => { const b = e.target.closest('button'); if (!b) return; if (b.parentNode.dataset.k === 'pre') at(b.dataset.v); else if (b.classList.contains('pv-limpar')) Object.assign(F, S.padrao()); else return; tudo(); };
    el.onchange = e => { const k = e.target.dataset.k; if (!k || !e.target.value) return; F[k] = e.target.value; if (F.de > F.ate) { if (k === 'de') F.ate = F.de; else F.de = F.ate; } tudo(); };
    S.sync = () => {
      const n = rangeD(F.de, F.ate).length, a = F.de === min && F.ate === max ? 'tudo' : n === 7 ? '7' : n === 30 ? '30' : F.de === F.ate.slice(0, 8) + '01' ? 'mes' : null;
      $$('input[type=date]', el).forEach(i => { i.value = F[i.dataset.k]; i.min = min; i.max = max; });
      $$('[data-k="pre"] button', el).forEach(b => b.classList.toggle('is-on', b.dataset.v === a));
      el.querySelector('[data-k="faz"]').value = F.faz;
      const p = S.padrao(); el.querySelector('.pv-limpar').classList.toggle('is-on', F.de !== p.de || F.ate !== p.ate || F.faz !== p.faz);
      const L = sel();
      el.querySelector('.ft-fresumo').innerHTML = `<b>${dBRa(F.de)}</b> a <b>${dBRa(F.ate)}</b> · ${F.faz === 'todas' ? 'todas as fazendas' : esc(fz.find(x => x[0] === F.faz)?.[1] || F.faz)} · <b>${L.length}</b> trabalho(s)`;
    };
  }
  const sel = () => D.trabalhos.filter(t => t.d >= S.f.de && t.d <= S.f.ate && (S.f.faz === 'todas' || fazDe(t) === S.f.faz));

  /* =================== RESUMO =================== */
  function pResumo(L) {
    const { nf, pc, sum, avg, kpi, cascata, animar } = U;
    const ha = sum(L.map(t => t.ha || 0)), dias = new Set(L.map(t => t.d)).size;
    const ciclo = avg(L.map(t => t.tTot)), apl = avg(L.map(t => t.tApl)), hTot = sum(L.map(t => t.tTot || 0)) / 60;
    const ac = pond(L, 'acerto'), un = pond(L, 'unif');
    const comL = L.filter(t => t.litros != null && t.ha > 0), lit = sum(comL.map(t => t.litros)), reab = sum(L.map(t => t.reab || 0));
    const el = $('#avKpis');
    el.innerHTML = [
      kpi({ t: 'Hectares aplicados', ic: 'fa-plane', v: ha, dec: 1, un: 'ha', sub: `${L.length} trabalho(s) em ${dias} dia(s)` }),
      kpiT({ t: 'Tempo médio de Ciclo de Aplicação', ic: 'fa-stopwatch', txt: hm(ciclo), sub: L.length ? `${nf(L.length ? ha / L.length : 0, 1)} ha por trabalho` : '' }),
      kpiT({ t: 'Tempo Médio de Aplicação', ic: 'fa-spray-can-sparkles', txt: hm(apl), sub: ciclo ? `<b>${pc(apl / ciclo)}</b> do ciclo aplicando` : '', bar: ciclo ? apl / ciclo : null }),
      kpi({ t: 'Rendimento', ic: 'fa-gauge-high', v: hTot ? ha / hTot : null, dec: 1, un: 'ha/h', sub: `${nf(hTot, 1)} h de operação no período` }),
      kpi({ t: 'Índice de Acerto', ic: 'fa-crosshairs', v: ac, dec: 1, un: '%', sub: `${L.filter(t => t.acerto != null && t.acerto < FX.warn).length} trabalho(s) abaixo de ${FX.warn}%`, st: stI(ac), bar: ac == null ? null : ac / 100 }),
      kpi({ t: 'Índice de Uniformidade', ic: 'fa-grip-lines', v: un, dec: 1, un: '%', sub: `${L.filter(t => t.unif != null && t.unif < FX.warn).length} trabalho(s) abaixo de ${FX.warn}%`, st: stI(un), bar: un == null ? null : un / 100 }),
      kpi({ t: 'Consumo', ic: 'fa-gas-pump', v: comL.length ? lit : null, dec: 0, un: 'L', sub: comL.length ? `${nf(lit / sum(comL.map(t => t.ha)), 1)} L/ha · ${comL.length} de ${L.length} trabalhos informados` : 'consumo não informado no período' }),
      kpi({ t: 'Reabastecimentos', ic: 'fa-oil-can', v: reab, un: 'no período', sub: L.length ? `${nf(reab / L.length, 1)} por trabalho · ${nf(reab ? ha / reab : 0, 0)} ha por carga` : '' }),
    ].join('');
    cascata(el); animar(el);
  }

  /* =================== CICLO DE APLICAÇÃO =================== */
  function pCiclo(L) {
    const { nf, pc, avg, esc, rangeD, dBR, dBRa, linha } = U;
    const md = ETAPAS.map(e => ({ ...e, v: avg(L.map(t => t[e.k])) })), tot = md.reduce((a, e) => a + (e.v || 0), 0);
    const el = $('#avCiclo');
    if (!tot) { U.vazio(el); } else {
      el.innerHTML = `<div class="av-ct"><span>Ciclo médio</span><b>${hm(tot)}</b></div>
        <div class="av-stk">${md.map((e, i) => `<i style="--w:${e.v / tot * 100}%;--i:${i};background:${e.cor}" data-tip="${esc(`<b>${e.nome}</b><br>${hm(e.v)} por trabalho · ${pc(e.v / tot)} do ciclo`)}"><span>${e.v / tot >= .09 ? pc(e.v / tot) : ''}</span></i>`).join('')}</div>
        <div class="av-et">${md.map((e, i) => `<div class="av-e" style="--i:${i}"><span class="av-e__ic" style="background:${e.cor}"><i class="fa-solid ${e.ic}"></i></span><div><small>Tempo de ${e.nome.toLowerCase()}</small><b>${hm(e.v)}</b><em>${pc(e.v / tot)} do ciclo</em></div></div>`).join('')}</div>`;
    }
    // ciclo médio por dia
    const dias = rangeD(S.f.de, S.f.ate).filter(d => L.some(t => t.d === d));
    linha($('#avChCiclo'), dias.map(dBR), dias.map(d => avg(L.filter(t => t.d === d).map(t => t.tTot))), { nome: 'Ciclo médio', fmt: hm, h: 230 });
    const ef = dias.map(d => { const X = L.filter(t => t.d === d), a = U.sum(X.map(t => t.tApl || 0)), c = U.sum(X.map(t => t.tTot || 0)); return c ? a / c : null; });
    linha($('#avChEf'), dias.map(dBR), ef, { pct: true, nome: 'Tempo aplicando', fmt: v => pc(v), h: 230 });
  }

  /* =================== PRODUÇÃO =================== */
  function pProd(L) {
    const { nf, sum, esc, rangeD, dBR, dBRa, semana, barrasDia } = U;
    const dias = rangeD(S.f.de, S.f.ate);
    const itens = dias.map(d => { const X = L.filter(t => t.d === d), v = sum(X.map(t => t.ha || 0)); return { label: dBR(d), v, cor: '#3C7A35', tip: `<b>${dBRa(d)}</b> · ${semana(d)}<br>Aplicado: <b>${nf(v, 1)} ha</b><br>${X.length} trabalho(s)${X.length ? '<br>' + X.slice(0, 4).map(t => esc(nomeFaz(t))).join('<br>') : ''}` }; });
    const comV = itens.filter(i => i.v > 0), med = comV.length ? sum(comV.map(i => i.v)) / comV.length : null;
    barrasDia($('#avChHa'), itens, { media: med, mediaTxt: `média ${nf(med, 0)}`, h: 240 });
    const g = {}; L.forEach(t => { const n = nomeFaz(t); g[n] = g[n] || { ha: 0, n: 0, ac: [] }; g[n].ha += t.ha || 0; g[n].n++; });
    const R = Object.entries(g).sort((a, b) => b[1].ha - a[1].ha).slice(0, 12), mx = Math.max(1, ...R.map(x => x[1].ha));
    $('#avRkFaz').innerHTML = R.length ? R.map(([n, x], i) => `<div class="r" data-tip="${esc(`<b>${n}</b><br>${nf(x.ha, 1)} ha em ${x.n} trabalho(s)`)}"><span>${esc(n)}</span><div class="trk"><i style="--w:${x.ha / mx * 100}%;--i:${i}"></i></div><span class="v">${nf(x.ha, 0)} ha</span></div>`).join('') : '<div class="ft-vazio">Sem trabalhos no período.</div>';
  }

  /* =================== QUALIDADE =================== */
  function pQual(L) {
    const { nf, pc, sum, esc, rangeD, dBR, linha } = U;
    const dias = rangeD(S.f.de, S.f.ate).filter(d => L.some(t => t.d === d));
    const serie = k => dias.map(d => { const v = pond(L.filter(t => t.d === d), k); return v == null ? null : v / 100; });
    const st = v => stI(v * 100);
    linha($('#avChAc'), dias.map(dBR), serie('acerto'), { pct: true, meta: FX.ok / 100, maior: true, nome: 'Índice de acerto', fmt: v => nf(v * 100, 1) + '%', stv: st, h: 230 });
    linha($('#avChUn'), dias.map(dBR), serie('unif'), { pct: true, meta: FX.ok / 100, maior: true, nome: 'Índice de uniformidade', fmt: v => nf(v * 100, 1) + '%', stv: st, h: 230 });
    // faixas por hectare
    const fx = [{ n: `≥ ${FX.ok}%`, f: v => v >= FX.ok, c: '#2E7D32' }, { n: `${FX.warn}–${FX.ok}%`, f: v => v >= FX.warn && v < FX.ok, c: '#E0A100' }, { n: `< ${FX.warn}%`, f: v => v < FX.warn, c: '#C62828' }];
    const bloco = (k, nome) => { const V = L.filter(t => t[k] != null && t.ha > 0), T = sum(V.map(t => t.ha)); return `<div class="av-fx"><b>${nome}</b><div class="pz-st100__b">${fx.map((x, i) => { const h = sum(V.filter(t => x.f(t[k])).map(t => t.ha)); return h ? `<i style="--w:${h / T * 100}%;--i:${i};background:${x.c}" data-tip="${esc(`<b>${nome} ${x.n}</b><br>${nf(h, 1)} ha · ${pc(h / T)} da área<br>${V.filter(t => x.f(t[k])).length} trabalho(s)`)}">${h / T >= .1 ? pc(h / T) : ''}</i>` : ''; }).join('')}</div></div>`; };
    $('#avFaixas').innerHTML = L.length ? bloco('acerto', 'Acerto') + bloco('unif', 'Uniformidade') + `<div class="av-fxl">${fx.map(x => `<span><i style="background:${x.c}"></i>${x.n}</span>`).join('')}<small>% da área aplicada em cada faixa</small></div>` : '<div class="ft-vazio">Sem trabalhos no período.</div>';
    // piores trabalhos
    const piores = L.filter(t => t.acerto != null).sort((a, b) => (a.acerto + (a.unif ?? 100)) - (b.acerto + (b.unif ?? 100))).slice(0, 6);
    $('#avPiores').innerHTML = piores.length ? piores.map(t => `<div class="av-pi"><div><b>${esc(t.id)}</b><small>${U.dBRa(t.d)} · ${nf(t.ha, 1)} ha</small></div><span class="ft-tag ${stI(t.acerto)}">acerto ${nf(t.acerto)}%</span><span class="ft-tag ${stI(t.unif)}">unif. ${t.unif == null ? '—' : nf(t.unif) + '%'}</span></div>`).join('') : '<div class="ft-vazio">Sem trabalhos no período.</div>';
  }

  /* =================== VOO (altura e velocidade) =================== */
  function pVoo(L) {
    const { nf, avg, rangeD, dBR, linha, esc, pc } = U;
    const dias = rangeD(S.f.de, S.f.ate).filter(d => L.some(t => t.d === d));
    const alvo = avg(L.map(t => t.altAlvo));
    linha($('#avChAlt'), dias.map(dBR), dias.map(d => avg(L.filter(t => t.d === d).map(t => t.altReal))), { meta: alvo, nome: 'Altura realizada', fmt: v => nf(v, 1) + ' m', h: 230 });
    linha($('#avChVel'), dias.map(dBR), dias.map(d => avg(L.filter(t => t.d === d).map(t => t.vel))), { nome: 'Velocidade média', fmt: v => nf(v, 0) + ' km/h', h: 230 });
    const V = L.filter(t => t.altAlvo != null && t.altReal != null), acima = V.filter(t => t.altReal > t.altAlvo + .5).length, abaixo = V.filter(t => t.altReal < t.altAlvo - .5).length;
    $('#avAltK').innerHTML = `<div class="av-mini"><span>Altura alvo</span><b>${nf(alvo, 1)} m</b></div><div class="av-mini"><span>Altura realizada</span><b>${nf(avg(V.map(t => t.altReal)), 1)} m</b></div><div class="av-mini"><span>No alvo (±0,5 m)</span><b>${V.length ? pc((V.length - acima - abaixo) / V.length) : '—'}</b></div><div class="av-mini"><span>Acima do alvo</span><b>${acima}</b></div>`;
    $('#avVelK').innerHTML = `<div class="av-mini"><span>Velocidade média</span><b>${nf(avg(L.map(t => t.vel)), 0)} km/h</b></div><div class="av-mini"><span>Menor</span><b>${nf(Math.min(...L.filter(t => t.vel).map(t => t.vel)), 0)} km/h</b></div><div class="av-mini"><span>Maior</span><b>${nf(Math.max(...L.filter(t => t.vel).map(t => t.vel)), 0)} km/h</b></div>`;
  }

  /* =================== LEITURA AUTOMÁTICA =================== */
  function pLeitura(L) {
    const { nf, pc, avg, sum } = U, el = $('#avLeit');
    if (!L.length) { el.innerHTML = '<div class="tt"><i class="fa-solid fa-wand-magic-sparkles"></i>Leitura automática</div>Sem trabalhos no período.'; return; }
    const md = ETAPAS.map(e => ({ ...e, v: avg(L.map(t => t[e.k])) })), tot = md.reduce((a, e) => a + (e.v || 0), 0), nAp = md.filter(e => e.k !== 'tApl').sort((a, b) => b.v - a.v)[0];
    const ac = pond(L, 'acerto'), un = pond(L, 'unif'), ruins = L.filter(t => t.acerto != null && t.acerto < FX.warn);
    let tx = `Foram <b>${nf(sum(L.map(t => t.ha || 0)), 0)} ha</b> em <b>${L.length}</b> trabalho(s). Do ciclo médio de <b>${hm(tot)}</b>, só <b>${pc(md[3].v / tot)}</b> é aplicando; a maior parte fora da aplicação é <b>${nAp.nome.toLowerCase()}</b> (${hm(nAp.v)}, ${pc(nAp.v / tot)}). `;
    tx += `Acerto médio de <b>${nf(ac, 1)}%</b> e uniformidade de <b>${nf(un, 1)}%</b> (ponderados pela área)`;
    tx += ruins.length ? `; <b>${ruins.length}</b> trabalho(s) com acerto abaixo de ${FX.warn}% somam ${nf(sum(ruins.map(t => t.ha || 0)), 0)} ha. ` : '. ';
    tx += '<small>Médias dos índices ponderadas pelos hectares aplicados. Faixas: verde ≥ 95%, amarelo 85–95%, vermelho &lt; 85%.</small>';
    el.innerHTML = `<div class="tt"><i class="fa-solid fa-wand-magic-sparkles"></i>Leitura automática</div>${tx}`;
  }

  /* =================== TRABALHOS =================== */
  function pTab(L) {
    const { nf, esc, dBRa } = U, hr = s => s ? s.slice(11, 16) : '', dt = s => s ? dBRa(s.slice(0, 10)).slice(0, 5) + ' ' + hr(s) : '—';
    const X = L.slice().sort((a, b) => b.ini.localeCompare(a.ini));
    $('#avTab').innerHTML = `<table><thead><tr><th>Identificação do trabalho</th><th>Fazenda</th><th>Início</th><th>Fim</th><th class="n">Hectares</th><th class="n">Ciclo</th><th class="n">Solo</th><th class="n">Translado</th><th class="n">Balão</th><th class="n">Aplicação</th><th class="n">Reabast.</th><th class="n">Consumo</th><th class="n">Altura alvo / real.</th><th class="n">Velocidade</th><th class="n">Acerto</th><th class="n">Uniform.</th></tr></thead><tbody>${X.map(t => `<tr><td><b>${esc(t.id)}</b></td><td>${esc(nomeFaz(t))}</td><td>${dt(t.ini)}</td><td>${dt(t.fim)}</td><td class="n">${nf(t.ha, 1)}</td><td class="n">${hm(t.tTot)}</td><td class="n">${hm(t.tSolo)}</td><td class="n">${hm(t.tTrans)}</td><td class="n">${hm(t.tBalao)}</td><td class="n"><b>${hm(t.tApl)}</b></td><td class="n">${t.reab ?? '—'}</td><td class="n">${t.litros == null ? '—' : nf(t.litros, 0) + ' L'}</td><td class="n">${t.altAlvo ?? '—'} / ${t.altReal == null ? '—' : nf(t.altReal, 1)} m</td><td class="n">${t.vel == null ? '—' : nf(t.vel, 0) + ' km/h'}</td><td class="n"><span class="ft-tag ${stI(t.acerto)}">${t.acerto == null ? '—' : nf(t.acerto) + '%'}</span></td><td class="n"><span class="ft-tag ${stI(t.unif)}">${t.unif == null ? '—' : nf(t.unif) + '%'}</span></td></tr>`).join('')}</tbody></table>`;
    $('#avTabN').textContent = `${X.length} trabalho(s)`;
  }

  /* ---------- montagem ---------- */
  function tudo(semFiltro) {
    if (!semFiltro) S.sync();
    const L = sel();
    pResumo(L); pCiclo(L); pProd(L); pQual(L); pVoo(L); pLeitura(L); pTab(L);
    const fim = D.trabalhos.length ? D.trabalhos[D.trabalhos.length - 1].ini : null;
    $('#avPgData').textContent = fim ? `TRAVICAR · último trabalho em ${U.dBRa(fim.slice(0, 10))}` : 'TRAVICAR';
  }
  const visivel = () => { const pg = $('.page[data-p="avi"]'); return pg && pg.classList.contains('is-on'); };
  function nomes() {
    // nomes das fazendas e OS → fazenda vêm da planilha dos pulverizadores (cadastro), quando publicada
    NOMES = {}; OSFAZ = {};
    const P = window.Pulverizacao && Pulverizacao.dados;
    if (P) {
      [...(P.qualidade || []), ...(P.producao || []), ...(P.os || [])].forEach(x => { if (x.faz && x.fazNome) NOMES[String(x.faz)] = x.fazNome; });
      (P.os || []).forEach(o => { if (o.os && o.faz) OSFAZ[String(o.os)] = String(o.faz); });
    }
  }
  function montar() {
    U = window.Fertirrigacao.util; nomes();
    const dias = [...new Set(D.trabalhos.map(t => t.d))].sort();
    if (!dias.length) { $('#avKpis').innerHTML = '<div class="ft-vazio" style="grid-column:1/-1">O relatório não tem trabalhos.</div>'; return; }
    const padrao = () => ({ de: U.addD(dias[dias.length - 1], -29) < dias[0] ? dias[0] : U.addD(dias[dias.length - 1], -29), ate: dias[dias.length - 1], faz: 'todas' });
    if (!S) S = { f: padrao() };
    S.padrao = padrao;
    filtro();
    if (!ligado) { ligado = true; let tm; addEventListener('resize', () => { clearTimeout(tm); tm = setTimeout(() => { if (D && visivel()) tudo(); }, 220); }); }
    tudo(); montado = true;
  }
  if (window.Layout) {
    const ant = Layout.aoEntrar;
    Layout.aoEntrar = pg => { if (typeof ant === 'function') ant(pg); if (pg.dataset.p === 'avi') aoEntrar(); };
  }
  async function iniciar(dados) {
    if (!window.Fertirrigacao || !Fertirrigacao.util) return;
    if (dados) { D = dados; montar(); return; }
    try {
      const r = await fetch(ARQ, { cache: 'no-store' }); if (!r.ok) throw new Error('sem arquivo');
      D = (await Acesso.readJson(await r.json())).data; montar();
    } catch (e) { const el = $('#avKpis'); if (el) el.innerHTML = '<div class="ft-vazio" style="grid-column:1/-1">Ainda não há dados da aviação publicados. Use “Sincronizar” com o relatório da TRAVICAR na pasta.</div>'; }
  }
  function aoEntrar() { if (!D || !montado) return; nomes(); tudo(); }
  function definir(dados) { D = dados; S = null; montar(); }
  return { iniciar, definir, aoEntrar, VERSAO, ARQ, get dados() { return D; } };
})();
