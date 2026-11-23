/* =========================================================================
   Aviação · Ordens de serviço aéreas (FO.SA.21 · Protocolo de Entrega de OS) → osaerea.json
   Carteira aberta, prazos × capacidade de voo (ritmo do TRAVICAR), carteira por operação,
   idade da cana na aplicação, estágio de corte e sequência das OS.
   O TRAVICAR (Aviacao.dados) entra para: ritmo de voo e OS já voadas (número da OS na identificação).
   window.AviOS = { iniciar(dados), definir(dados), aoEntrar(), VERSAO, ARQ }
   ========================================================================= */
window.AviOS = (function () {
  'use strict';
  const VERSAO = 1, ARQ = 'osaerea.json';
  const COR = { '1188': '#1F4D2B', '1141': '#2a6fb0', '1210': '#5E9A57', '1220': '#B07A00' };
  const CURTO = { '1188': '1ª Aplic. Aérea Foliar', '1141': 'Aérea Amin/outros', '1210': '2ª Aplic. Aérea Foliar', '1220': 'Aérea Inseticida' };
  const FAIXAS = ['até 3', '3–5', '5–7', '7–9', '9–12', '12+'];
  const EST = ['ADEF', '18MC', '12MC', '12IN', '12IF', '18MF', '2ºC', '3ºC', '4ºC', '5ºC', '6ºC', '7ºC', '8ºC', '9ºC', '10ºC', '11ºC', '12ºC', '>12º', 'REF', 'EXP'];
  const ESTN = { ADEF: 'A def.', '18MC': 'P18', '12MC': 'P12', '12IN': 'P12i', '12IF': 'P12f', '18MF': 'P18f' };
  const ESTL = { ADEF: 'A definir', '18MC': 'Cana planta 18 meses', '12MC': 'Cana planta 12 meses', '12IN': 'Cana planta 12 meses (inverno)', '12IF': 'Cana planta 12 meses (12IF)', '18MF': 'Cana planta 18 meses (18MF)' };
  const PRAZO_ALERTA = 7; // dias: "vence em breve"
  let D = null, U = null, S = { ver: 'abertas', op: null, ab: null, mais: false }, montado = false, ligado = false;
  const $ = s => document.querySelector(s);
  const cor = op => COR[op] || '#9AA59D', curto = o => CURTO[o.op] || o.opNome;
  const dd = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 864e5);
  const hoje = () => (D.gerado || new Date().toISOString()).slice(0, 10);
  const topo = m => Object.entries(m || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  /** cruza com o TRAVICAR: ritmo (ha/dia nas últimas 2 semanas com dado) e hectares voados por OS */
  function travicar() {
    const T = (window.Aviacao && Aviacao.dados && Aviacao.dados.trabalhos) || [];
    if (!T.length) return { ok: false, ritmo: null, voado: {}, ult: null };
    const ult = T.map(t => t.d).sort().pop(), ini = U.addD(ult, -13);
    const ritmo = U.sum(T.filter(t => t.d >= ini).map(t => t.ha || 0)) / 14;
    const area = {}; D.os.forEach(o => area[o.os] = o.ha);
    const voado = {};
    T.forEach(t => { if (!t.os) return; const L = t.os.split(/\s*,\s*/).filter(x => area[x] != null); if (!L.length) return; const tot = U.sum(L.map(x => area[x])) || L.length; L.forEach(x => voado[x] = (voado[x] || 0) + (t.ha || 0) * (area[x] || 1) / tot); });
    return { ok: true, ritmo, voado, ult };
  }
  function lista() {
    const h = hoje(), T = travicar(), prot = new Set((D.protocolo && D.protocolo.os) || []);
    // talhão (sem o 500, carreador) em mais de uma OS aberta da mesma operação
    const vis = {}; D.os.forEach(o => o.tal.split('-').filter(t => t && t !== '500').forEach(t => (vis[`${o.op}|${o.faz}|${t}`] = vis[`${o.op}|${o.faz}|${t}`] || new Set()).add(o.os)));
    const rep = {}; Object.values(vis).filter(s => s.size > 1).forEach(s => s.forEach(x => (rep[x] = rep[x] || new Set(), s.forEach(y => y !== x && rep[x].add(y)))));
    const L = D.os.map(o => {
      const prazo = o.fim ? dd(h, o.fim) : null, voado = T.voado[o.os] || 0, pv = o.ha ? voado / o.ha : 0;
      const st = prazo == null ? 'nd' : prazo < 0 ? 'bad' : prazo <= PRAZO_ALERTA ? 'warn' : 'ok';
      return { ...o, prazo, st, voado, pv, prot: prot.has(o.os), rep: rep[o.os] ? [...rep[o.os]] : [] };
    });
    return { L, T, h };
  }

  /* ---------- cards ---------- */
  function pKpis(X) {
    const { nf, sum, kpi, cascata, animar, dBRa } = U, { L, T } = X, tot = sum(L.map(o => o.ha)), venc = L.filter(o => o.st === 'bad'), prox = L.filter(o => o.st === 'warn');
    const conf = L.filter(o => o.pv >= .9 || o.rep.length), voadas = L.filter(o => o.pv >= .9).length, reps = L.filter(o => o.rep.length).length;
    const P = D.protocolo, pL = P ? L.filter(o => o.prot) : [];
    const el = $('#aoK');
    el.innerHTML = [
      kpi({ t: 'Carteira aérea aberta', ic: 'fa-plane', v: tot, dec: 0, un: 'ha', sub: `${L.length} OS · ${new Set(L.map(o => o.faz)).size} fazendas` }),
      kpi({ t: 'OS vencidas', ic: 'fa-calendar-xmark', v: venc.length, un: `de ${L.length}`, sub: `${nf(sum(venc.map(o => o.ha)), 0)} ha com prazo já passado · ${prox.length} vencem em ${PRAZO_ALERTA} dias`, st: venc.length ? 'bad' : prox.length ? 'warn' : 'ok', bar: L.length ? venc.length / L.length : null }),
      T.ok && T.ritmo ? kpi({ t: 'Dias de carteira', ic: 'fa-hourglass-half', v: tot / T.ritmo, dec: 0, un: 'dias', sub: `no ritmo do TRAVICAR: ${nf(T.ritmo, 0)} ha/dia nas 2 semanas até ${dBRa(T.ult)}` })
        : kpi({ t: 'Dias de carteira', ic: 'fa-hourglass-half', v: null, sub: 'publique o relatório da TRAVICAR para calcular' }),
      P ? kpi({ t: 'Último protocolo', ic: 'fa-file-signature', v: P.os.length, un: 'OS', sub: `${P.data ? 'entregue em ' + dBRa(P.data) + ' · ' : ''}${nf(sum(pL.map(o => o.ha)), 0)} ha abertos` })
        : kpi({ t: 'Último protocolo', ic: 'fa-file-signature', v: null, sub: 'sem protocolo na aba Pagina 1' }),
      kpi({ t: 'Para conferir', ic: 'fa-circle-exclamation', v: conf.length, un: 'OS', sub: `${voadas} já voada(s) no TRAVICAR e abertas · ${reps} com talhão em outra OS`, st: conf.length ? 'warn' : 'ok' }),
    ].join('');
    cascata(el); animar(el);
  }

  /* ---------- prazo × capacidade (acumulado) ---------- */
  function pPrazo(X) {
    const { nf, dBR, dBRa, addD, sum, W, passoBom, esc } = U, { L, T, h } = X, el = $('#aoPrazo'), tot = sum(L.map(o => o.ha));
    const fins = L.map(o => o.fim).filter(Boolean).sort(); if (!fins.length) { U.vazio(el); return; }
    const d0 = addD(h, -14) < fins[0] ? addD(h, -14) : (fins[0] < addD(h, -45) ? addD(h, -45) : fins[0]), d1 = [fins[fins.length - 1], addD(h, 14)].sort().pop();
    const n = dd(d0, d1) + 1, dias = Array.from({ length: n }, (_, i) => addD(d0, i)), porDia = {};
    L.forEach(o => { if (!o.fim) return; const k = o.fim < d0 ? d0 : o.fim; porDia[k] = (porDia[k] || 0) + o.ha; });
    let acc = 0; const dem = dias.map(d => (acc += porDia[d] || 0));
    const cap = T.ok && T.ritmo ? dias.map(d => d < h ? null : T.ritmo * (dd(h, d) + 1)) : dias.map(() => null);
    const w = W(el), estreito = w < 560, Hh = estreito ? 250 : 290, pl = estreito ? 44 : 56, pr = estreito ? 14 : 24, pt = 24, pb = 32;
    const top = Math.max(tot, ...cap.filter(v => v != null).map(v => Math.min(v, tot * 1.1))), mx = top * 1.08, passo = passoBom(top / 4);
    const X0 = i => pl + i * (w - pl - pr) / Math.max(1, n - 1), Y = v => pt + (Hh - pt - pb) * (1 - Math.min(v, mx) / mx), ih = Math.max(0, dias.indexOf(h));
    const path = P => P.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
    let s = `<svg viewBox="0 0 ${w} ${Hh}" width="${w}" height="${Hh}" role="img" aria-label="Área com prazo vencido acumulada e capacidade de voo"><defs><linearGradient id="aoGP" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#C62828" stop-opacity=".16"/><stop offset="1" stop-color="#C62828" stop-opacity="0"/></linearGradient></defs>`;
    for (let v = 0; v <= top + 1e-9; v += passo) s += `<line x1="${pl}" x2="${w - pr}" y1="${Y(v)}" y2="${Y(v)}" stroke="#EEF1EC"/><text x="${pl - 8}" y="${Y(v) + 4}" text-anchor="end">${nf(v, 0)}</text>`;
    const pX = Math.max(7, Math.ceil(n / Math.floor((w - pl - pr) / 50)));
    dias.forEach((d, i) => { if ((i % pX === 0 || i === n - 1) && Math.abs(X0(i) - X0(ih)) > 30) s += `<text x="${X0(i)}" y="${Hh - 10}" text-anchor="middle">${dBR(d)}</text>`; });
    s += `<text x="${X0(ih)}" y="${Hh - 10}" text-anchor="middle" style="fill:#18301F;font-weight:800">hoje</text>`;
    s += `<rect class="fade" x="${pl}" y="${pt}" width="${Math.max(0, X0(ih) - pl)}" height="${Hh - pt - pb}" fill="#FBEFEF"/>${estreito ? '' : `<text class="fade" x="${pl + 8}" y="${pt + 14}" style="font-weight:700;fill:#C62828">prazo já passou</text>`}`;
    s += `<line class="fade" x1="${pl}" x2="${w - pr}" y1="${Y(tot)}" y2="${Y(tot)}" stroke="#18301F" stroke-opacity=".35" stroke-dasharray="2 4"/><text class="fade" x="${w - pr}" y="${Y(tot) - 6}" text-anchor="end">carteira ${nf(tot, 0)} ha</text>`;
    const pD = dem.map((v, i) => [X0(i), Y(v)]), pC = cap.map((v, i) => v == null ? null : [X0(i), Y(v)]).filter(Boolean);
    s += `<path class="fade" d="${path(pD)} L${X0(n - 1)} ${Y(0)} L${X0(0)} ${Y(0)} Z" fill="url(#aoGP)"/><path class="hb-draw" pathLength="1" d="${path(pD)}" fill="none" stroke="#C62828" stroke-width="3" stroke-linejoin="round"/>`;
    if (pC.length > 1) s += `<path class="hb-in" d="${path(pC)}" fill="none" stroke="#2a6fb0" stroke-width="2.4" stroke-dasharray="7 5"/>`;
    s += `<line x1="${X0(ih)}" x2="${X0(ih)}" y1="${pt}" y2="${Hh - pb}" stroke="#18301F" stroke-opacity=".4"/>`;
    const tv = `${nf(dem[ih], 0)} ha vencidos`, tw = tv.length * 6.4 + 18, tx = Math.max(pl + 2, X0(ih) - tw - 10);
    if (dem[ih] > 0) s += `<g class="hb-in"><rect x="${tx}" y="${Y(dem[ih]) - 34}" width="${tw}" height="24" rx="12" fill="#C62828"/><text x="${tx + tw / 2}" y="${Y(dem[ih]) - 18}" text-anchor="middle" style="fill:#fff;font-weight:800;font-size:11px">${tv}</text></g>`;
    const i7 = dias.indexOf(addD(h, PRAZO_ALERTA));
    if (i7 > 0) s += `<circle class="hb-in" cx="${X0(i7)}" cy="${Y(dem[i7])}" r="5" fill="#C62828" stroke="#fff" stroke-width="2"/>${cap[i7] != null ? `<circle class="hb-in" cx="${X0(i7)}" cy="${Y(cap[i7])}" r="5" fill="#2a6fb0" stroke="#fff" stroke-width="2"/>` : ''}`;
    const cw = (w - pl - pr) / Math.max(1, n - 1);
    dias.forEach((d, i) => s += `<rect x="${X0(i) - cw / 2}" y="${pt}" width="${cw}" height="${Hh - pt - pb}" fill="transparent" data-tip="${esc(`<b>${dBRa(d)}</b><br>Área com prazo até o dia: <b>${nf(dem[i], 0)} ha</b>${cap[i] != null ? `<br>Capacidade de voo até o dia: <b>${nf(cap[i], 0)} ha</b>` : ''}`)}"/>`);
    el.innerHTML = s + '</svg>';
    const iC = dem.findIndex((v, i) => i > ih && cap[i] != null && v > cap[i]);
    $('#aoPrazoLeg').innerHTML = `<span><i style="background:#C62828"></i>Área com prazo vencido até a data</span>${T.ok ? '<span><i style="background:#2a6fb0"></i>Capacidade no ritmo do TRAVICAR</span>' : ''}<span class="ao-leg__r">${i7 > 0 ? `em ${PRAZO_ALERTA} dias: <b>${nf(dem[i7], 0)} ha</b> com prazo${cap[i7] != null ? ` × <b>${nf(cap[i7], 0)} ha</b> de capacidade` : ''}` : ''}${iC > 0 ? ` · a partir de <b>${dBR(dias[iC])}</b> o prazo passa a capacidade` : ''}</span>`;
  }

  /* ---------- carteira por operação ---------- */
  function pOps(X) {
    const { nf, sum, esc } = U, { L } = X;
    const ops = [...new Set(L.map(o => o.op))].map(op => { const A = L.filter(o => o.op === op); return { op, nome: curto(A[0]), n: A.length, ha: sum(A.map(o => o.ha)), b: sum(A.filter(o => o.st === 'bad').map(o => o.ha)), w: sum(A.filter(o => o.st === 'warn').map(o => o.ha)) }; }).sort((a, b) => b.ha - a.ha);
    const mx = Math.max(1, ...ops.map(o => o.ha));
    $('#aoOps').innerHTML = ops.map((o, i) => `<button type="button" class="ao-op${S.op === o.op ? ' is-on' : ''}" data-op="${esc(o.op)}" style="--i:${i};--c:${cor(o.op)}"><span class="hb-chip">${esc(o.op)}</span><span class="ao-op__n">${esc(o.nome)}<small>${o.n} OS</small></span><span class="ao-op__b"><i style="--w:${o.ha / mx * 100}%"><em class="ok" style="width:${(o.ha - o.b - o.w) / o.ha * 100}%"></em><em class="warn" style="width:${o.w / o.ha * 100}%"></em><em class="bad" style="width:${o.b / o.ha * 100}%"></em></i></span><b>${nf(o.ha, 0)} ha</b></button>`).join('')
      + `<div class="ao-leg"><span><i class="ok"></i>no prazo</span><span><i class="warn"></i>vence em até ${PRAZO_ALERTA} dias</span><span><i class="bad"></i>vencida</span><span class="ao-leg__r">clique para filtrar a lista</span></div>`;
  }

  /* ---------- idade da cana e estágio ---------- */
  function pIdade(X) {
    const { nf, sum, esc } = U, { L } = X, ks = [...new Set(L.map(o => o.op))].sort((a, b) => sum(L.filter(o => o.op === b).map(o => o.ha)) - sum(L.filter(o => o.op === a).map(o => o.ha)));
    const g = ks.map(k => FAIXAS.map((_, j) => sum(L.filter(o => o.op === k).map(o => (o.idade || [])[j] || 0))));
    const mx = Math.max(1, ...g.flat());
    $('#aoIdade').innerHTML = `<div class="ao-id">${FAIXAS.map((f, j) => `<div class="ao-id__c" style="--i:${j}"><div class="ao-id__bs">${ks.map((k, i) => `<i style="--h:${g[i][j] / mx * 100}%;background:${cor(k)}" data-tip="${esc(`<b>${f} meses desde a colheita</b><br>${curto({ op: k, opNome: k })}: <b>${nf(g[i][j], 0)} ha</b>`)}"></i>`).join('')}</div><span>${f}</span></div>`).join('')}</div>
      <div class="ao-leg">${ks.map(k => `<span><i style="background:${cor(k)}"></i>${esc(CURTO[k] || k)}</span>`).join('')}<span class="ao-leg__r">meses desde a última colheita</span></div>`;
    const E = {}; L.forEach(o => Object.entries(o.est || {}).forEach(([k, v]) => E[k] = (E[k] || 0) + v));
    const ord = [...EST.filter(k => E[k] > .5), ...Object.keys(E).filter(k => !EST.includes(k) && E[k] > .5)], me = Math.max(1, ...ord.map(k => E[k])), tot = sum(Object.values(E));
    $('#aoEst').innerHTML = ord.length ? `<div class="ao-es">${ord.map((k, i) => `<div class="ao-es__c" style="--i:${i}" data-tip="${esc(`<b>${ESTL[k] || k}</b><br>${nf(E[k], 0)} ha · ${U.pc(E[k] / tot)} da carteira`)}"><b>${nf(E[k], 0)}</b><div class="ao-es__b"><i style="--h:${E[k] / me * 100}%"></i></div><span>${esc(ESTN[k] || k)}</span></div>`).join('')}</div>` : '<div class="ft-vazio">Sem estágio (aba Fazendas).</div>';
  }

  /* ---------- sequência de OS ---------- */
  function pTab(X) {
    const { nf, pc, esc, dBR } = U, { L } = X;
    const vis = (S.ver === 'conferir' ? L.filter(o => o.pv >= .9 || o.rep.length) : S.ver === 'vencidas' ? L.filter(o => o.st === 'bad') : L).filter(o => !S.op || o.op === S.op);
    const R = vis.slice().sort((a, b) => String(a.fim).localeCompare(String(b.fim)) || b.ha - a.ha);
    $('#aoTabN').textContent = `${R.length} OS${S.op ? ' · operação ' + S.op : ''} · ordenadas pelo prazo`;
    const sit = o => [o.pv >= .9 ? '<span class="os-al ok">Voada · fechar OS</span>' : '', o.rep.length ? `<span class="os-al" title="Talhões também na OS ${esc(o.rep.join(', '))}">Talhão em outra OS</span>` : '', o.st === 'bad' ? `<span class="os-al bad">Vencida há ${-o.prazo} d</span>` : o.st === 'warn' ? `<span class="os-al">Vence em ${o.prazo} d</span>` : ''].join('');
    const lim = S.mais ? 9999 : 40;
    $('#aoTab').innerHTML = `<table><thead><tr><th>OS</th><th>Operação</th><th>Fazenda</th><th>Talhões</th><th class="n">Área</th><th>Voado</th><th class="n">Emitida</th><th class="n">Início prev.</th><th class="n">Prazo</th><th>Situação</th><th>Estágio · variedade</th></tr></thead><tbody>${R.slice(0, lim).map((o, i) => `<tr class="os-tr${S.ab === o.os ? ' is-on' : ''}" data-os="${esc(o.os)}" style="--i:${Math.min(i, 24)};--c:${cor(o.op)}"><td><b>${esc(o.os)}</b>${o.prot ? '<small class="os-cod">últ. protocolo</small>' : ''}</td><td><span class="hb-chip">${esc(o.op)}</span> <span class="os-opn">${esc(curto(o))}</span></td><td>${esc(o.fazNome)}<small class="os-cod">${esc(o.faz)}</small></td><td class="os-tal" title="${esc(o.tal)}">${esc(o.tal)}</td><td class="n">${nf(o.ha, 1)}</td><td>${o.voado ? `<div class="pz-prog"><div class="trk"><i style="--w:${Math.min(100, o.pv * 100)}%;background:var(--c)"></i></div><span>${pc(o.pv)}</span></div>` : '<span class="ao-mut">—</span>'}</td><td class="n">${dBR(o.em)}</td><td class="n">${dBR(o.ini)}</td><td class="n"><span class="os-age ${o.st === 'nd' ? '' : o.st}">${o.fim ? dBR(o.fim) : '—'}</span></td><td>${sit(o)}</td><td class="ao-mut">${esc(ESTL[topo(o.est)] ? ESTN[topo(o.est)] : topo(o.est) || '—')} · ${esc(topo(o.vari) || '—')}</td></tr>${S.ab === o.os ? `<tr class="os-det"><td colspan="11"><div class="os-det__g"><div><small>Talhões</small><p>${esc(o.tal)}</p></div><div><small>Estágio de corte</small><p>${Object.entries(o.est || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(ESTL[k] || k)} · ${nf(v, 1)} ha`).join('<br>') || '—'}</p></div><div><small>Variedade · voado no TRAVICAR</small><p>${Object.entries(o.vari || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(k)} · ${nf(v, 1)} ha`).join('<br>') || '—'}</p><p style="margin-top:6px">${o.voado ? `<b>${nf(o.voado, 1)} ha</b> voados (${pc(o.pv)})` : 'sem voo com esta OS no TRAVICAR'}${o.rep.length ? `<br>Talhões também na OS ${esc(o.rep.join(', '))}` : ''}</p></div></div></td></tr>` : ''}`).join('')}</tbody></table>${R.length > lim ? `<button type="button" class="hb-mais" data-mais="1">Ver todas (+${R.length - lim})</button>` : ''}`;
    U.mover($('#aoVer'), $(`#aoVer button[data-v="${S.ver}"]`), true);
  }

  function tudo() {
    if (!D || !D.os) return;
    const X = lista();
    $('#aoData').textContent = `FO.SA.21 · posição de ${U.dBRa(X.h)}`;
    pKpis(X); pPrazo(X); pOps(X); pIdade(X); pTab(X);
  }
  const visivel = () => { const pg = $('.page[data-p="avi"]'); return pg && pg.classList.contains('is-on'); };
  function montar() {
    U = window.Fertirrigacao.util;
    const sec = $('#avOS'); if (!sec) return;
    if (!D || !D.os) { sec.hidden = false; $('#aoK').innerHTML = '<div class="ft-vazio" style="grid-column:1/-1">Ainda não há OS aéreas publicadas. Use “Sincronizar” com a planilha FO.SA.21 (Protocolo de Entrega de OS) na pasta.</div>'; return; }
    sec.hidden = false;
    if (!ligado) {
      ligado = true;
      $('#aoOps').onclick = e => { const b = e.target.closest('.ao-op'); if (b) { S.op = S.op === b.dataset.op ? null : b.dataset.op; tudo(); } };
      $('#aoVer').onclick = e => { const b = e.target.closest('button'); if (b) { S.ver = b.dataset.v; S.mais = false; tudo(); } };
      $('#aoTab').onclick = e => { if (e.target.closest('[data-mais]')) { S.mais = true; pTab(lista()); return; } const r = e.target.closest('tr.os-tr'); if (r) { S.ab = S.ab === r.dataset.os ? null : r.dataset.os; pTab(lista()); } };
      let tm; addEventListener('resize', () => { clearTimeout(tm); tm = setTimeout(() => { if (D && visivel()) pPrazo(lista()); }, 220); });
    }
    tudo(); montado = true;
  }
  if (window.Layout) {
    const ant = Layout.aoEntrar;
    Layout.aoEntrar = pg => { if (typeof ant === 'function') ant(pg); if (pg.dataset.p === 'avi') aoEntrar(); };
  }
  async function iniciar(dados) {
    if (!window.Fertirrigacao || !Fertirrigacao.util) return;
    if (dados) { D = dados; montar(); return; }
    try { const r = await fetch(ARQ, { cache: 'no-store' }); if (r.ok) D = (await Acesso.readJson(await r.json())).data; } catch (e) { /* ainda sem arquivo */ }
    montar();
  }
  function aoEntrar() { if (D && montado) tudo(); }
  function definir(dados) { D = dados; montar(); }
  return { iniciar, definir, aoEntrar, VERSAO, ARQ, get dados() { return D; } };
})();
