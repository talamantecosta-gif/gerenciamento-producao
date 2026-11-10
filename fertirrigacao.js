/* =========================================================================
   Página Fertirrigação Localizada (painel Gerenciamento Produção)
   Fonte: planilha "Acompanhamento 2026" → fertirrigacao.json (criptografado)
   Seções: Resumo · Frentes (PAINEL) · Cota do dia (DIMENSIONAMENTO) ·
   Fechamento de turno (imagem para o grupo) · Produção · Variáveis operacionais
   window.Fertirrigacao = { iniciar(), definir(dados), VERSAO, dados }
   ========================================================================= */
window.Fertirrigacao = (function () {
  'use strict';
  const VERSAO = 2;
  const ARQ = 'fertirrigacao.json';
  const SAFRA_INI = '2026-04-01';
  const TU = ['A', 'B', 'C'];
  const COR = { ok: '#2E7D32', warn: '#E0A100', bad: '#C62828', nd: '#C9D0C5' };
  const IND = {
    prod: { nome: 'Tempo produtivo', curto: 'Produtivo', ic: 'fa-play', meta: .58, maior: true, pct: true },
    manut: { nome: 'Manutenção', curto: 'Manutenção', ic: 'fa-screwdriver-wrench', meta: .15, maior: false, pct: true },
    ins: { nome: 'Aguardando insumos', curto: 'Ag. insumos', ic: 'fa-hourglass-half', meta: .06, maior: false, pct: true },
    motor: { nome: 'Eficiência motor', curto: 'Ef. motor', ic: 'fa-gears', meta: .85, maior: true, pct: true },
    vel: { nome: 'Velocidade de aplicação', curto: 'Velocidade', ic: 'fa-gauge-high', meta: null, maior: true, pct: false, un: 'km/h' },
    pil: { nome: 'Piloto automático', curto: 'Piloto', ic: 'fa-location-crosshairs', meta: null, maior: true, pct: true },
  };

  let D = null, FR = [], IX = {}, S = null, ligado = false;

  /* ---------- utilidades ---------- */
  const $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const semMov = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const nf = (v, d = 0) => v == null || !isFinite(v) ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }).replace('-', '−');
  const nfs = (v, d = 0) => v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : '') + nf(v, d);
  const pc = (v, d = 0) => v == null || !isFinite(v) ? '—' : nf(v * 100, d) + '%';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dBR = s => s ? s.slice(8, 10) + '/' + s.slice(5, 7) : '—';
  const dBRa = s => s ? dBR(s) + '/' + s.slice(0, 4) : '—';
  const addD = (s, n) => { const t = new Date(s + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const rangeD = (a, b) => { const r = []; for (let x = a; x <= b; x = addD(x, 1)) r.push(x); return r; };
  const semana = s => { const w = new Date(s + 'T12:00:00Z').toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'UTC' }); return w.charAt(0).toUpperCase() + w.slice(1); };
  const nomeF = f => 'Frente ' + f.slice(1);
  const sum = a => a.reduce((s, x) => s + (x || 0), 0);
  const avg = a => { a = a.filter(x => x != null && isFinite(x)); return a.length ? sum(a) / a.length : null; };
  const porNum = (a, b) => String(a).localeCompare(String(b), 'pt-BR', { numeric: true });
  const st = p => p == null ? 'nd' : p >= 1 ? 'ok' : p >= .9 ? 'warn' : 'bad';
  const stInd = (k, v) => { const c = IND[k]; if (v == null || c.meta == null) return ''; return c.maior ? (v >= c.meta ? 'ok' : v >= c.meta * .9 ? 'warn' : 'bad') : (v <= c.meta ? 'ok' : v <= c.meta * 1.1 ? 'warn' : 'bad'); };
  function arred100(vals) {
    const tot = sum(vals); if (!tot) return vals.map(() => 0);
    const raw = vals.map(v => v / tot * 100), base = raw.map(Math.floor); let r = 100 - sum(base);
    raw.map((v, i) => [v - base[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (r > 0) { base[i]++; r--; } });
    return base;
  }
  const mix = (a, b, t) => { const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); const A = p(a), B = p(b); return '#' + A.map((x, i) => Math.round(x + (B[i] - x) * t).toString(16).padStart(2, '0')).join(''); };
  const cascata = el => { [...el.children].forEach((c, i) => c.style.setProperty('--i', i)); el.classList.remove('ft-cas'); void el.offsetWidth; el.classList.add('ft-cas'); };
  const animar = el => { if (window.Layout && Layout.animar) Layout.animar(el); };
  function contar(root) {
    root.querySelectorAll('[data-cnt]').forEach(el => {
      const alvo = +el.dataset.cnt, d = +(el.dataset.dec || 0), suf = el.dataset.suf || '';
      if (semMov() || !isFinite(alvo)) { el.textContent = nf(alvo, d) + suf; return; }
      const t0 = performance.now();
      const passo = t => { const k = Math.min(1, (t - t0) / 850), e = 1 - Math.pow(1 - k, 3); el.textContent = nf(alvo * e, d) + suf; if (k < 1) requestAnimationFrame(passo); };
      requestAnimationFrame(passo);
    });
  }
  const toast = msg => { const t = $('#toast'); if (!t) return; t.textContent = msg; t.classList.add('on'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('on'), 2800); };

  /* tooltip */
  document.addEventListener('mousemove', e => {
    const t = e.target.closest && e.target.closest('[data-tip]'), el = $('#tip'); if (!el) return;
    if (!t) { el.classList.remove('on'); return; }
    el.innerHTML = t.dataset.tip; el.classList.add('on');
    el.style.left = Math.min(e.clientX + 14, innerWidth - el.offsetWidth - 10) + 'px';
    el.style.top = Math.min(e.clientY + 16, innerHeight - el.offsetHeight - 10) + 'px';
  });

  /* indicador deslizante dos botões segmentados */
  function mover(seg, b, ja) {
    if (!seg || !b) return; const ind = seg.querySelector('.ind');
    $$('button', seg).forEach(x => x.classList.toggle('is-on', x === b));
    if (!ind) return;
    if (ja) ind.style.transition = 'none';
    ind.style.left = b.offsetLeft + 'px'; ind.style.width = b.offsetWidth + 'px';
    if (ja) { void ind.offsetWidth; ind.style.transition = ''; }
  }

  /* ---------- índices e cota ---------- */
  function indexar() {
    IX = { ha: {}, ap: {}, sg: {}, cotas: Object.keys(D.historico.cotas || {}).sort() };
    D.producao.forEach(p => {
      const k = p.d + '|' + p.f + '|' + p.t; IX.ha[k] = (IX.ha[k] || 0) + (p.ha || 0);
      IX.ap[p.d + '|' + p.f] = 1; IX.ap[k] = 1;
    });
    D.sgpa.forEach(s => { IX.sg[s.d + '|' + s.f + '|' + s.t] = s; });
    IX.dias = [...new Set(D.producao.map(p => p.d))].sort();
    IX.min = IX.dias[0]; IX.max = IX.dias[IX.dias.length - 1];
    IX.ultProd = D.producao.filter(p => p.ha > 0).map(p => p.d).sort().pop() || IX.max;
    IX.sgDias = [...new Set(D.sgpa.map(s => s.d))].sort();
  }
  /** Cota do dia (potencial ha/dia). Sem registro no dia → última gravada até 7 dias antes (referência). Antes do 1º registro não há cota. */
  function cota(d, f) {
    const h = D.historico.cotas, ok = k => h[k] && h[k].frentes[f] && h[k].frentes[f].potencial != null;
    if (ok(d)) return { v: h[d].frentes[f].potencial, ref: false };
    let k = null; for (const s of IX.cotas) if (s <= d && s >= addD(d, -7) && ok(s)) k = s;
    return k ? { v: h[k].frentes[f].potencial, ref: true, de: k } : null;
  }
  function metaOf(d, f, t) {
    const tudo = t === 'todos' || t === 'dia';
    if (!IX.ap[tudo ? d + '|' + f : d + '|' + f + '|' + t]) return null;
    const c = cota(d, f); if (!c) return null;
    return tudo ? c : { v: c.v / 3, ref: c.ref };
  }
  const realOf = (d, f, t) => t === 'todos' || t === 'dia' ? sum(TU.map(x => IX.ha[d + '|' + f + '|' + x])) : (IX.ha[d + '|' + f + '|' + t] || 0);
  function serie(dias, fs, t) {
    return dias.map(d => {
      let real = 0, meta = 0, tem = false, ref = false;
      fs.forEach(f => { const m = metaOf(d, f, t); real += realOf(d, f, t); if (m) { meta += m.v; tem = true; ref = ref || m.ref; } });
      return { d, real, meta: tem ? meta : null, ref };
    });
  }
  const tot = s => { const c = s.filter(x => x.meta != null); return { real: sum(s.map(x => x.real)), realC: sum(c.map(x => x.real)), meta: sum(c.map(x => x.meta)), dias: c.length }; };

  /* ---------- gráficos SVG (sem legenda: rótulos e dicas explicam) ---------- */
  const W = el => Math.max(280, Math.round(el.clientWidth || 800));
  const passoBom = r => { const e = Math.pow(10, Math.floor(Math.log10(r || 1))), f = r / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e; };
  const vazio = (el, msg = 'Sem dados no recorte.') => { el.innerHTML = `<div class="ft-vazio"><i class="fa-regular fa-folder-open"></i> ${msg}</div>`; };
  function eixoY(max, y, x0, x1, fmt) {
    const p = passoBom(max / 4); let s = '';
    for (let v = 0; v <= max + 1e-9; v += p) s += `<line x1="${x0}" x2="${x1}" y1="${y(v)}" y2="${y(v)}" stroke="#EEF1EC"/><text x="${x0 - 8}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`;
    return s;
  }
  const pilula = (x, y, w, txt, cor = '#18301F') => `<g class="fade"><rect x="${x}" y="${y - 11}" width="${w}" height="22" rx="11" fill="${cor}"/><text x="${x + w / 2}" y="${y + 4}" text-anchor="middle" style="fill:#fff;font-weight:700;font-size:10.5px">${txt}</text></g>`;
  /** Barras por dia (padrão do Histórico do painel-agricola): cor pela situação, valor dentro, traço da cota e linha da média. */
  function barrasDia(el, itens, o = {}) {
    if (!itens.length) return vazio(el);
    const w = W(el), H = o.h || 250, pl = 44, pr = 80, pt = 16, pb = 28, n = itens.length;
    const vals = itens.map(i => i.v), mx = Math.max(1, ...vals, ...itens.map(i => i.m || 0)) * 1.12;
    const y = v => pt + (H - pt - pb) * (1 - v / mx), bw = (w - pl - pr) / n, gap = Math.max(1, Math.min(8, bw * .22));
    const fmt = o.fmt || (v => nf(v, 0));
    let s = `<svg viewBox="0 0 ${w} ${H}" width="${w}" height="${H}" role="img">` + eixoY(mx / 1.12, y, pl, w - pr, fmt);
    const iMax = vals.indexOf(Math.max(...vals)), pX = Math.max(1, Math.ceil(n / Math.floor((w - pl - pr) / 54)));
    itens.forEach((it, i) => {
      const x = pl + i * bw + gap / 2, bwi = Math.max(1.5, bw - gap), h = Math.max(0, y(0) - y(it.v || 0));
      s += `<rect class="ftb" style="--i:${Math.round(i * 40 / n)};cursor:${o.click ? 'pointer' : 'default'}" data-i="${i}" x="${x}" y="${y(it.v || 0)}" width="${bwi}" height="${h}" rx="${Math.min(5, bwi / 3)}" fill="${it.cor}" data-tip="${esc(it.tip)}"/>`;
      if (it.m != null) s += `<line class="fade" x1="${x - 2}" x2="${x + bwi + 2}" y1="${y(it.m)}" y2="${y(it.m)}" stroke="#18301F" stroke-width="2.4" ${it.ref ? 'opacity=".45"' : ''}/>`;
      if ((bwi >= 22 || i === iMax || i === n - 1) && it.v > 0) {
        const t = fmt(it.v);
        if (h > 26 && bwi >= 22) s += `<text class="lb-in fade" x="${x + bwi / 2}" y="${y(it.v) + 16}" text-anchor="middle">${t}</text>`;
        else s += `<text class="lb fade" x="${x + bwi / 2}" y="${Math.min(y(it.v), it.m != null ? y(it.m) : 1e9) - 6}" text-anchor="middle">${t}</text>`;
      }
      if ((i % pX === 0 && n - 1 - i >= pX) || i === n - 1) s += `<text x="${x + bwi / 2}" y="${H - 8}" text-anchor="middle">${esc(it.label)}</text>`;
    });
    if (o.media != null) { const ym = y(o.media); s += `<line class="fade" x1="${pl}" x2="${w - pr + 4}" y1="${ym}" y2="${ym}" stroke="#5E6C62" stroke-dasharray="5 4"/>` + pilula(w - pr + 6, ym, pr - 8, o.mediaTxt); }
    el.innerHTML = s + '</svg>';
    if (o.click) el.querySelector('svg').onclick = e => { const r = e.target.closest('rect.ftb'); if (r) o.click(itens[+r.dataset.i]); };
  }
  /** Grupos de barras (turnos por frente) com o turno escrito embaixo de cada barra. */
  function grupos(el, grs, series, o = {}) {
    if (!grs.length) return vazio(el, o.vazio);
    const w = W(el), H = o.h || 240, pl = 44, pr = 12, pt = 20, pb = 34, ng = grs.length, ns = series.length;
    const mx = Math.max(1, ...grs.flatMap(g => g.v.map(x => x || 0)), ...grs.flatMap(g => (g.m || []).map(x => x || 0))) * 1.15;
    const y = v => pt + (H - pt - pb) * (1 - v / mx), gw = (w - pl - pr) / ng, inner = gw * .78, bw = inner / ns;
    let s = `<svg viewBox="0 0 ${w} ${H}" width="${w}" height="${H}">` + eixoY(mx / 1.15, y, pl, w - pr, v => nf(v, 0));
    grs.forEach((g, gi) => {
      const x0 = pl + gi * gw + (gw - inner) / 2;
      g.v.forEach((v, si) => {
        if (v == null) return;
        const x = x0 + si * bw + 2, bwi = Math.max(2, bw - 4), h = Math.max(0, y(0) - y(v || 0)), m = g.m ? g.m[si] : null, cor = series[si].cor;
        s += `<rect class="ftb" style="--i:${gi * ns + si}" x="${x}" y="${y(v || 0)}" width="${bwi}" height="${h}" rx="${Math.min(5, bwi / 3)}" fill="${cor}" data-tip="${esc(`<b>${g.label}</b> · ${series[si].nome}<br>${nf(v, 1)} ${o.un || ''}${m != null ? ` de ${nf(m, 1)} (${pc(v / m)})` : ''}`)}"/>`;
        if (m != null) s += `<line class="fade" x1="${x - 2}" x2="${x + bwi + 2}" y1="${y(m)}" y2="${y(m)}" stroke="#18301F" stroke-width="2.4"/>`;
        if (bwi >= 16) s += `<text class="lb fade" x="${x + bwi / 2}" y="${Math.min(y(v), m != null ? y(m) : 1e9) - 6}" text-anchor="middle">${nf(v, 0)}</text>`;
        s += `<text x="${x + bwi / 2}" y="${H - 19}" text-anchor="middle" style="font-size:10px">${series[si].curto}</text>`;
      });
      s += `<text x="${x0 + inner / 2}" y="${H - 3}" text-anchor="middle" style="fill:#18301F;font-weight:700">${esc(g.label)}</text>`;
    });
    el.innerHTML = s + '</svg>';
  }
  /** Linha de um indicador com faixa da meta (verde), pílulas de meta e média, pontos coloridos pela situação. */
  function linha(el, labels, vals, o = {}) {
    const vs = vals.filter(v => v != null);
    if (!vs.length) return vazio(el);
    const w = W(el), H = o.h || 250, pl = 46, pr = 84, pt = 16, pb = 28, n = labels.length;
    const mx = o.pct ? (Math.min(1, Math.max(...vs, o.meta || 0) * 1.15) || 1) : Math.max(...vs, o.meta || 0) * 1.15;
    const x = i => pl + (n < 2 ? (w - pl - pr) / 2 : i * (w - pl - pr) / (n - 1)), y = v => pt + (H - pt - pb) * (1 - v / mx);
    const f = o.fmt || (v => nf(v, 1));
    let s = `<svg viewBox="0 0 ${w} ${H}" width="${w}" height="${H}"><defs><linearGradient id="gArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#3C7A35" stop-opacity=".22"/><stop offset="1" stop-color="#3C7A35" stop-opacity="0"/></linearGradient></defs>` + eixoY(mx, y, pl, w - pr, v => o.pct ? pc(v) : nf(v, 0));
    if (o.meta != null) {
      const faixa = o.maior ? [y(mx), y(o.meta)] : [y(o.meta), y(0)];
      s += `<rect class="fade" x="${pl}" y="${faixa[0]}" width="${w - pl - pr}" height="${Math.max(0, faixa[1] - faixa[0])}" fill="#2E7D32" opacity=".06"/><line class="fade" x1="${pl}" x2="${w - pr + 4}" y1="${y(o.meta)}" y2="${y(o.meta)}" stroke="#2E7D32" stroke-width="1.6"/>` + pilula(w - pr + 6, y(o.meta), pr - 8, 'meta ' + f(o.meta), '#2E7D32');
    }
    const media = avg(vals);
    if (media != null && (o.meta == null || Math.abs(y(media) - y(o.meta)) > 24)) s += `<line class="fade" x1="${pl}" x2="${w - pr + 4}" y1="${y(media)}" y2="${y(media)}" stroke="#5E6C62" stroke-dasharray="5 4"/>` + pilula(w - pr + 6, y(media), pr - 8, 'média ' + f(media));
    const pX = Math.max(1, Math.ceil(n / Math.floor((w - pl - pr) / 54)));
    labels.forEach((l, i) => { if ((i % pX === 0 && n - 1 - i >= pX) || i === n - 1) s += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(l)}</text>`; });
    let d = '', len = 0, p = null;
    vals.forEach((v, i) => { if (v == null) { p = null; return; } const px = x(i), py = y(v); d += (p ? 'L' : 'M') + px.toFixed(1) + ' ' + py.toFixed(1); if (p) len += Math.hypot(px - p[0], py - p[1]); p = [px, py]; });
    const pts = vals.map((v, i) => v == null ? null : [x(i), y(v)]).filter(Boolean);
    if (pts.length > 1) s += `<path class="fade" d="M${pts[0][0].toFixed(1)} ${y(0)} ${pts.map(q => 'L' + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' ')} L${pts[pts.length - 1][0].toFixed(1)} ${y(0)} Z" fill="url(#gArea)"/>`;
    s += `<path d="${d}" fill="none" stroke="#1F4D2B" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" class="linha" style="--len:${Math.ceil(len) + 4}"/>`;
    vals.forEach((v, i) => { if (v == null) return; const sc = o.stv ? o.stv(v) : ''; s += `<circle class="fade" cx="${x(i)}" cy="${y(v)}" r="${n > 45 ? 2.4 : 3.8}" fill="${sc ? COR[sc] : '#1F4D2B'}"/><circle cx="${x(i)}" cy="${y(v)}" r="9" fill="transparent" data-tip="${esc(`<b>${labels[i]}</b><br>${o.nome || ''}: <b>${f(v)}</b>`)}"/>`; });
    const li = vals.map((v, i) => v == null ? -1 : i).filter(i => i >= 0).pop();
    if (li != null) s += `<text class="lb fade" x="${x(li) - 8}" y="${y(vals[li]) - 10}" text-anchor="end">${f(vals[li])}</text>`;
    el.innerHTML = s + '</svg>';
  }
  const spark = (vals, meta, w = 150, h = 38, cor = '#1F4D2B') => {
    const ok = vals.filter(v => v != null); if (ok.length < 2) return '';
    const mx = Math.max(...ok, meta ?? -Infinity), mn = Math.min(...ok, meta ?? Infinity), r = mx - mn || 1, yy = v => h - 3 - (v - mn) / r * (h - 6);
    let d = '', on = false;
    vals.forEach((v, i) => { if (v == null) { on = false; return; } d += (on ? 'L' : 'M') + (i * (w - 4) / (vals.length - 1) + 2).toFixed(1) + ' ' + yy(v).toFixed(1); on = true; });
    return `<svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${meta != null ? `<line x1="0" x2="${w}" y1="${yy(meta)}" y2="${yy(meta)}" stroke="#2E7D32" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>` : ''}<path d="${d}" fill="none" stroke="${cor}" stroke-width="1.8" vector-effect="non-scaling-stroke"/></svg>`;
  };
  const kpi = ({ t, ic, v, dec = 0, un = '', sub = '', st: s = '', bar = null, mk = null, attrs = '' }) =>
    `<div class="k${s && s !== 'nd' ? ' is-' + s : ''}" ${attrs}><div class="k__t"><span>${t}</span><i class="fa-solid ${ic}"></i></div><div class="k__v">${v == null ? '—' : nf(v, dec)}${un ? `<small>${un}</small>` : ''}</div><div class="k__s">${sub}</div>${bar != null ? `<div class="k__bar"><i style="width:${Math.max(0, Math.min(100, bar * 100))}%"></i>${mk != null ? `<span class="mk" style="left:calc(${Math.min(100, mk * 100)}% - 1px)"></span>` : ''}</div>` : ''}</div>`;
  const nav = (el, datas, atual, cb) => {
    const i = datas.indexOf(atual);
    el.innerHTML = `<div class="pv-dia"><button type="button" data-n="-1" ${i <= 0 ? 'disabled' : ''} aria-label="Anterior"><i class="fa-solid fa-chevron-left"></i></button><span>${dBRa(atual)}</span><button type="button" data-n="1" ${i < 0 || i >= datas.length - 1 ? 'disabled' : ''} aria-label="Próximo"><i class="fa-solid fa-chevron-right"></i></button></div>`;
    el.onclick = e => { const b = e.target.closest('button[data-n]'); if (b && !b.disabled) cb(datas[i + +b.dataset.n]); };
  };

  /* =================== 0. RESUMO DO DIA =================== */
  function pResumo() {
    const c0 = D.cota || {}, C = c0.frentes || {}, fs = FR.filter(f => C[f]), T = k => sum(fs.map(f => C[f][k]));
    const pot = T('potencial'), pos = T('possivel'), nec = T('necFrota'), fro = T('frotaTotal'), ncj = T('ncConjuntos'), tem = T('conjuntosTem');
    const d1 = IX.dias.filter(d => d < (c0.data || '9999') && FR.some(f => realOf(d, f, 'dia') > 0)).pop() || IX.ultProd;
    const s1 = serie([d1], FR, 'dia')[0], p1 = s1.meta ? s1.real / s1.meta : null;
    const prev7 = serie(rangeD(addD(d1, -7), addD(d1, -1)), FR, 'dia').filter(x => IX.dias.includes(x.d)), m7 = prev7.length ? sum(prev7.map(x => x.real)) / prev7.length : null;
    const P = (D.historico.painel || {})[(D.painel || {}).data] || (D.painel || {}).frentes || {};
    const eqs = Object.values(P).flatMap(p => [...(p.aplicadores || []), ...(p.conjuntos || [])]), al = eqs.filter(e => e.alerta);
    const dl = m7 ? s1.real / m7 - 1 : null;
    const el = $('#resKpis');
    el.innerHTML = [
      kpi({ t: `Cota do dia · ${dBR(c0.data)}`, ic: 'fa-bullseye', v: pot, dec: 1, un: 'ha', sub: 'potencial ha/dia do dimensionamento' }),
      kpi({ t: 'Capacidade de aplicação', ic: 'fa-flag-checkered', v: pos, dec: 1, un: 'ha', sub: `<b>${pc(pot ? pos / pot : null, 1)}</b> da cota${pot - pos > .05 ? ` · faltam ${nf(pot - pos, 1)} ha` : ''}`, st: st(pot ? pos / pot : null), bar: pot ? pos / pot : null }),
      kpi({ t: `Cota do dia anterior · ${dBR(d1)}`, ic: 'fa-calendar-minus', v: s1.meta, dec: 1, un: 'ha', sub: s1.meta == null ? 'sem cota gravada' : 'cota gravada do dia' }),
      kpi({ t: `Realizado · ${dBR(d1)}`, ic: 'fa-droplet', v: s1.real, dec: 1, un: 'ha', sub: dl == null ? '' : `<span class="d ${dl >= 0 ? 'up' : 'dn'}">${dl >= 0 ? '▲' : '▼'} ${pc(Math.abs(dl))}</span> vs média de 7 dias (${nf(m7, 0)} ha)` }),
      kpi({ t: `Atingimento · ${dBR(d1)}`, ic: 'fa-gauge', v: p1 == null ? null : p1 * 100, dec: 1, un: '%', sub: p1 == null ? 'sem cota gravada' : `diferença de <b>${nfs(s1.real - s1.meta, 1)} ha</b>`, st: st(p1), bar: p1, mk: p1 ? Math.min(1, 1 / Math.max(1, p1)) : null }),
      kpi({ t: 'Caminhões', ic: 'fa-truck', v: fro, un: `de ${nf(nec)}`, sub: fro >= nec ? 'frota atende a cota' : `faltam <b>${nf(nec - fro)}</b> para a cota`, st: fro >= nec ? 'ok' : 'bad', bar: nec ? fro / nec : null }),
      kpi({ t: 'Conjuntos', ic: 'fa-trailer', v: tem, un: `de ${nf(ncj)}`, sub: `frota + bate-volta · ${tem >= ncj ? 'atende' : `faltam <b>${nf(ncj - tem)}</b>`}`, st: tem >= ncj ? 'ok' : 'bad', bar: ncj ? tem / ncj : null }),
      kpi({ t: 'Em manutenção', ic: 'fa-screwdriver-wrench', v: al.length, un: `de ${eqs.length}`, sub: al.length ? esc(al.slice(0, 4).map(e => e.frota || e.cavalo || e.trelas[0]).join(', ')) + (al.length > 4 ? '…' : '') : 'nenhum equipamento marcado', st: al.length ? 'warn' : 'ok', attrs: 'data-ir="frentes" style="cursor:pointer" data-tip="Ver as frentes"' }),
    ].join('');
    cascata(el); animar(el);
    el.onclick = e => { const k = e.target.closest('[data-ir]'); if (k) $('#' + k.dataset.ir).scrollIntoView({ behavior: semMov() ? 'auto' : 'smooth', block: 'start' }); };
    $('#ftPgData').textContent = `Cota do dia ${dBRa(c0.data)} · produção até ${dBRa(IX.ultProd)}`;
  }

  /* =================== 1. FRENTES (aba PAINEL) =================== */
  function pFrentes() {
    const datas = Object.keys(D.historico.painel || {}).sort();
    if (!S.diaPainel || !datas.includes(S.diaPainel)) S.diaPainel = datas[datas.length - 1];
    const P = (D.historico.painel || {})[S.diaPainel] || (D.painel && D.painel.frentes) || {};
    nav($('#navPainel'), datas, S.diaPainel, d => { S.diaPainel = d; pFrentes(); });
    const el = $('#ftFrentes');
    el.innerHTML = FR.filter(f => P[f]).map(f => {
      const p = P[f], al = [...p.aplicadores, ...p.conjuntos].filter(e => e.alerta).length;
      const tile = (ic, rot, val, un = '') => `<div class="ft-tile"><i class="fa-solid ${ic}"></i><small>${rot}</small><b title="${esc(val)}">${val === '' || val == null ? '—' : esc(val)}${un && val !== '' && val != null ? `<em>${un}</em>` : ''}</b></div>`;
      const aplic = p.aplicadores.map(a => `<div class="ft-eq${a.alerta ? ' al' : ''}"${a.alerta ? ' data-tip="Em manutenção (vermelho no PAINEL)"' : ''}><span class="ic"><i class="fa-solid fa-tractor"></i></span><div><div class="nm">${a.modelo} ${a.frota}</div><div class="sb">implemento ${a.implemento}</div></div><div class="cods">${a.alerta ? '<span class="ft-pulso"></span>' : ''}</div></div>`).join('');
      const conj = p.conjuntos.map(c => `<div class="ft-eq${c.alerta ? ' al' : ''}"${c.alerta ? ` data-tip="Em manutenção: ${esc(c.alertas.join(', '))}"` : ''}><span class="ic"><i class="fa-solid ${c.cavalo ? 'fa-truck-moving' : 'fa-trailer'}"></i></span><div><div class="nm">${c.cavalo ? 'Cavalo ' + c.cavalo : 'Trelas'}</div><div class="sb">${c.cavalo ? (c.trelas.length ? 'conjunto' : 'sem trela') : 'sem cavalo'}</div></div><div class="cods">${c.trelas.map(t => `<span class="c${c.alertas.includes(t) ? ' al' : ''}">${t}</span>`).join('')}${c.alerta ? '<span class="ft-pulso" style="align-self:center;margin-left:4px"></span>' : ''}</div></div>`).join('');
      const nec = p.necCaminhoes, cav = p.conjuntos.filter(c => c.cavalo).length;
      return `<article class="ft-fr">
        <div class="ft-fr__top">
          <div class="ft-fr__kick"><span>${nomeF(f)}</span><span class="cod">${esc(p.codigo)}</span></div>
          <div class="ft-fr__faz">${esc(p.fazenda)}</div>
          <div class="ft-fr__lam"><b data-cnt="${p.lamina || 0}">${nf(p.lamina)}</b><span>m³/ha de lâmina</span></div>
        </div>
        <div class="ft-fr__body">
          <div class="ft-tiles">
            ${tile('fa-gauge-high', 'Velocidade', p.velocidade == null ? '' : nf(p.velocidade, 1), 'km/h')}
            ${tile('fa-route', 'Raio', p.raio == null ? '' : nf(p.raio, 1), 'km')}
            ${tile('fa-industry', 'Carregamento', p.carregamento)}
            ${tile('fa-file-lines', 'OS', p.os)}
            ${tile('fa-truck', 'Caminhões nec.', nec == null ? '' : nf(nec))}
            ${tile('fa-arrows-rotate', 'Bate-volta', p.bateVolta || 'Não')}
          </div>
          <div class="ft-linha"><i class="fa-solid fa-map-location-dot"></i><div><span>Talhões</span><br><b>${esc(p.talhoes || '—')}</b></div></div>
          <div class="ft-linha"><i class="fa-solid fa-droplet"></i><div><span>Operação</span><br><b>${esc(p.operacao || '—')}</b></div></div>
          <div class="ft-sub"><span>Aplicadores</span><span>${p.aplicadores.length}</span></div>
          <div class="ft-eqs">${aplic || '<div class="ft-vazio" style="padding:8px">—</div>'}</div>
          <div class="ft-sub"><span>Conjuntos de caminhão</span><span>${cav} cavalo(s)</span></div>
          <div class="ft-eqs">${conj || '<div class="ft-vazio" style="padding:8px">—</div>'}</div>
          <div class="ft-fr__foot">${al ? `<span class="ft-tag bad"><span class="ft-pulso"></span>${al} em manutenção</span>` : '<span class="ft-tag ok"><i class="fa-solid fa-check"></i>sem pendência</span>'}${nec != null ? `<span class="ft-tag ${cav >= nec ? 'ok' : 'warn'}"><i class="fa-solid fa-truck"></i>${cav} cavalo(s) · ${nec} necessário(s)</span>` : ''}</div>
        </div>
      </article>`;
    }).join('') || '<div class="ft-vazio">Sem informações do PAINEL.</div>';
    cascata(el); contar(el);
  }

  /* =================== 2. COTA DO DIA POR FRENTE =================== */
  function pCota() {
    const h = D.historico.cotas, datas = IX.cotas.filter(d => h[d].fonte === 'dimensionamento');
    if (!S.diaCota || !datas.includes(S.diaCota)) S.diaCota = datas[datas.length - 1];
    nav($('#navCota'), datas, S.diaCota, d => { S.diaCota = d; pCota(); });
    const C = h[S.diaCota] ? h[S.diaCota].frentes : {}, fs = FR.filter(f => C[f]);
    const ic = (n, tot, ico) => Array.from({ length: Math.max(n, tot) }, (_, j) => `<span class="ft-ico ${j < n ? '' : 'falta'}" style="--j:${j}"><i class="fa-solid ${ico}"></i></span>`).join('');
    const lista = $('#cotaFrentes');
    lista.innerHTML = `<div class="ft-cl ft-cl--head"><span>Frente</span><span>Capacidade × cota (ha/dia)</span><span>Caminhões</span><span>Conjuntos</span></div>` + fs.map(f => {
      const c = C[f], p = c.potencial ? c.possivel / c.potencial : null;
      const conj = Array.from({ length: Math.max(c.ncConjuntos || 0, c.conjuntosTem || 0) }, (_, j) => { const cls = j < c.frotaTotal ? '' : j < c.conjuntosTem ? 'bv' : 'falta'; return `<span class="ft-ico ${cls}" style="--j:${j}" ${cls === 'bv' ? 'data-tip="Bate-volta campo"' : ''}><i class="fa-solid ${cls === 'bv' ? 'fa-arrows-rotate' : 'fa-trailer'}"></i></span>`; }).join('');
      return `<div class="ft-cl">
        <div class="ft-cl__nm"><b>${nomeF(f)}</b><small>lâmina ${nf(c.lamina)} m³/ha · raio ${nf(c.raio, 1)} km</small></div>
        <div class="ft-bullet"><div class="ft-bullet__trk"><div class="ft-bullet__fill ${p != null && p < .999 ? 'warn' : ''}" data-w="${Math.min(100, (p || 0) * 100)}"></div></div>
          <div class="ft-bullet__vals"><span>capacidade <b>${nf(c.possivel, 1)}</b></span><span>${p != null && p < .999 ? `<span class="t-warn">faltam ${nf(c.potencial - c.possivel, 1)}</span> · ` : '<span class="t-ok">atinge</span> · '}cota <b>${nf(c.potencial, 1)}</b></span></div></div>
        <div><div class="ft-icons">${ic(c.frotaTotal || 0, c.necFrota || 0, 'fa-truck')}</div><div class="ft-icons-l"><b>${nf(c.frotaTotal)}</b> de <b>${nf(c.necFrota)}</b>${c.necFrota > c.frotaTotal ? ` · <span class="bad">faltam ${nf(c.necFrota - c.frotaTotal)}</span>` : ''}</div></div>
        <div><div class="ft-icons">${conj}</div><div class="ft-icons-l"><b>${nf(c.conjuntosTem)}</b> de <b>${nf(c.ncConjuntos)}</b>${c.bateVolta ? ` · ${nf(c.bateVolta)} bate-volta` : ''}${c.ncConjuntos > c.conjuntosTem ? ` · <span class="bad">faltam ${nf(c.ncConjuntos - c.conjuntosTem)}</span>` : ''}</div></div>
      </div>`;
    }).join('');
    requestAnimationFrame(() => requestAnimationFrame(() => $$('.ft-bullet__fill', lista).forEach(b => b.style.width = b.dataset.w + '%')));
  }

  /* =================== 3. FECHAMENTO DE TURNO (imagem compacta) =================== */
  function turnoPadrao(d) { for (const t of ['C', 'B', 'A']) if (FR.some(f => (IX.ha[d + '|' + f + '|' + t] || 0) > 0)) return t; return 'A'; }
  const pill = q => `<span class="fc-p" style="background:${COR[st(q)]}">${pc(q)}</span>`;
  function pFech() {
    if (!S.fechDia) { S.fechDia = IX.ultProd; S.fechT = turnoPadrao(S.fechDia); }
    const d = S.fechDia, T = S.fechT, dia = T === 'dia';
    $('#fechDia').value = d; $('#fechDia').min = IX.min; $('#fechDia').max = IX.max;
    mover($('#fechTurno'), $(`#fechTurno button[data-t="${T}"]`), true);
    const fs = FR.filter(f => IX.ap[d + '|' + f]);
    const hf = (D.historico.fechamento || {})[d];
    const cotaD = f => { const c = cota(d, f); return c ? c.v : null; };
    const PN = (D.historico.painel || {})[S.diaPainel] || {};
    const cab = (tit, sub) => `<div class="fc-head"><div class="fc-logo"><img src="logo.png" alt="Bioenergética Aroeira"></div><div class="fc-tt"><h3>${tit}</h3><p>Fertirrigação Localizada · COA Bioenergética Aroeira</p></div><div class="fc-data"><b>${dBRa(d)}</b><span>${sub}</span></div></div>`;
    const R_ = 46, CIR = 2 * Math.PI * R_;
    const anel = p => `<div class="fc-ring"><svg viewBox="0 0 110 110"><circle cx="55" cy="55" r="${R_}" fill="none" stroke="#EEF1EC" stroke-width="10"/><circle class="arco" cx="55" cy="55" r="${R_}" fill="none" stroke="${COR[st(p)]}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${CIR}" stroke-dashoffset="${semMov() ? CIR * (1 - Math.min(1, p || 0)) : CIR}" data-off="${CIR * (1 - Math.min(1, p || 0))}"/></svg><div class="meio"><b data-cnt="${p == null ? 0 : p * 100}" data-suf="%">${pc(p)}</b></div></div>`;
    const hero = (R, M, rot, eqp) => `<div class="fc-hero">${anel(M ? R / M : null)}<div class="fc-nums"><div class="fc-num"><small>Realizado</small><b><span data-cnt="${R}" data-dec="1">${nf(R, 1)}</span><em>ha</em></b></div><div class="fc-num"><small>${rot}</small><b>${nf(M, 1)}<em>ha</em></b></div><div class="fc-num ${R - M >= 0 ? 'ok' : 'bad'}"><small>Diferença</small><b>${nfs(R - M, 1)}<em>ha</em></b></div>${eqp ? `<div class="fc-eqp"><span><i class="fa-solid fa-tractor"></i>${nf(eqp.aplicadores)} aplicadores</span><span><i class="fa-solid fa-truck"></i>${nf(eqp.caminhoes)} caminhões</span></div>` : ''}</div></div>`;
    const cel = (r, m) => `<b>${nf(r, 1)}</b><small>/${nf(m, 1)}</small>${m ? pill(r / m) : ''}`;
    const card = $('#fechCard');
    if (dia) {
      // Dia: turnos A, B, C e acumulado juntos, como o FECHAMENTO DE TURNO da planilha
      const Mt = sum(fs.map(cotaD)), Rt = sum(fs.map(f => realOf(d, f, 'dia')));
      const linT = t => { const ms = fs.map(f => { const m = cotaD(f); return m == null ? null : m / 3; }); const rs = fs.map(f => realOf(d, f, t)); return `<tr><th>Turno ${t}</th>${fs.map((f, i) => `<td>${cel(rs[i], ms[i])}</td>`).join('')}<td class="tt">${cel(sum(rs), sum(ms))}</td></tr>`; };
      const sgT = t => { const r = D.sgpa.filter(s => s.d === d && s.t === t && fs.includes(s.f)); const a = k => avg(r.map(s => s[k])); const e = hf && hf.turnos[t]; return `<tr><th>Turno ${t}</th><td>${e ? nf(e.aplicadores) : '—'}</td><td>${e ? nf(e.caminhoes) : '—'}</td>${['prod', 'manut', 'ins', 'motor'].map(k => { const v = a(k), s = stInd(k, v); return `<td class="${s ? 't-' + s : ''}">${pc(v)}</td>`; }).join('')}</tr>`; };
      const ofs = fs.map(f => `<tr><th>${nomeF(f)}</th>${TU.map(t => { const s = IX.sg[d + '|' + f + '|' + t]; return `<td>${s && s.of.length ? s.of.map(o => `<span>${esc(o)}</span>`).join('') : '—'}</td>`; }).join('')}</tr>`).join('');
      card.innerHTML = cab('Fechamento do dia', semana(d)) + hero(Rt, Mt, 'Cota do dia') + `
        <div class="fc-sec"><h4>Realizado / cota por turno (ha)</h4>
          <table class="fc-mx"><thead><tr><th></th>${fs.map(f => `<th>${nomeF(f)}</th>`).join('')}<th>Total</th></tr></thead><tbody>${TU.map(linT).join('')}
          <tr class="acum"><th>Acumulado</th>${fs.map(f => `<td>${cel(realOf(d, f, 'dia'), cotaD(f))}</td>`).join('')}<td class="tt">${cel(Rt, Mt)}</td></tr></tbody></table></div>
        <div class="fc-sec"><h4>Equipe e variáveis online por turno</h4>
          <table class="fc-mx fc-mx--v"><thead><tr><th></th><th>Aplic.</th><th>Caminh.</th><th>Produtivo</th><th>Manutenção</th><th>Ag. insumos</th><th>Ef. motor</th></tr></thead><tbody>${TU.map(sgT).join('')}</tbody></table></div>
        <div class="fc-sec"><h4>Ofensores</h4><table class="fc-mx fc-mx--of"><thead><tr><th></th>${TU.map(t => `<th>Turno ${t}</th>`).join('')}</tr></thead><tbody>${ofs}</tbody></table></div>`;
    } else {
      const linhas = fs.map(f => { const m = metaOf(d, f, T), r = realOf(d, f, T); return { f, r, m: m ? m.v : null, sg: IX.sg[d + '|' + f + '|' + T] }; });
      const R = sum(linhas.map(l => l.r)), M = sum(linhas.map(l => l.m));
      const ate = TU.slice(0, TU.indexOf(T) + 1), sgT = D.sgpa.filter(s => s.d === d && s.t === T && fs.includes(s.f));
      const mx = Math.max(1, ...linhas.map(l => Math.max(l.r, l.m || 0))) * 1.08;
      const vv = k => { const v = avg(sgT.map(s => s[k])), s = stInd(k, v), c = IND[k]; return `<div class="fc-var"><small>${c.curto}</small><b class="${s ? 't-' + s : ''}">${pc(v)}</b><div class="trk"><i style="--w:${Math.min(100, (v || 0) * 100)}%;background:${s ? COR[s] : '#3C7A35'}"></i><span class="mt" style="left:calc(${c.meta * 100}% - 1px)"></span></div></div>`; };
      const acR = sum(fs.map(f => sum(ate.map(t => realOf(d, f, t))))), acM = sum(fs.map(cotaD));
      card.innerHTML = cab('Fechamento · Turno ' + T, `${semana(d)} · ${{ A: '07h às 15h', B: '15h às 23h', C: '23h às 07h' }[T]}`) + hero(R, M, 'Cota do turno', hf && hf.turnos[T]) + `
        <div class="fc-sec"><h4>Por frente</h4>
          ${linhas.map((l, i) => { const q = l.m ? l.r / l.m : null, s = l.sg; return `<div class="fc-fr"><div class="nm">${nomeF(l.f)}<small>${esc((PN[l.f] || {}).fazenda || '')}</small></div><div class="fc-trk"><i style="--w:${l.r / mx * 100}%;--i:${i};background:${COR[st(q)]}"></i>${l.m ? `<span class="mt" style="left:calc(${l.m / mx * 100}% - 1px)"></span>` : ''}</div><div class="vl"><b>${nf(l.r, 1)}</b>/${nf(l.m, 1)}</div>${pill(q)}<div class="fc-det">${s && s.vel != null ? `<span>${nf(s.vel, 1)} km/h</span>` : ''}${s && s.pil != null ? `<span>piloto ${pc(s.pil)}</span>` : ''}${s && s.ofTxt ? `<span class="of">${esc(s.ofTxt)}</span>` : ''}</div></div>`; }).join('')}
        </div>
        <div class="fc-sec"><h4>Variáveis online</h4><div class="fc-vars">${vv('prod')}${vv('manut')}${vv('ins')}${vv('motor')}</div></div>
        <div class="fc-sec"><h4>Acumulado do dia${ate.length > 1 ? ' · turnos ' + ate.join(' + ') : ''}</h4>
          <table class="fc-mx"><thead><tr>${fs.map(f => `<th>${nomeF(f)}</th>`).join('')}<th>Total</th></tr></thead><tbody><tr>${fs.map(f => `<td>${cel(sum(ate.map(t => realOf(d, f, t))), cotaD(f))}</td>`).join('')}<td class="tt">${cel(acR, acM)}</td></tr></tbody></table>
        </div>`;
    }
    card.insertAdjacentHTML('beforeend', `<div class="fc-foot"><span>Gerenciamento Produção · ${new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span><span>© Talamante</span></div>`);
    contar(card);
    requestAnimationFrame(() => requestAnimationFrame(() => { const a = card.querySelector('.arco'); if (a) a.style.strokeDashoffset = a.dataset.off; }));
  }
  async function imagemFech() {
    if (!window.html2canvas) { toast('Gerador de imagem indisponível — verifique a internet.'); return null; }
    const card = $('#fechCard'); card.classList.add('ft-captura');
    const a = card.querySelector('.arco'); if (a) a.style.strokeDashoffset = a.dataset.off;
    card.querySelectorAll('[data-cnt]').forEach(el => { el.textContent = nf(+el.dataset.cnt, +(el.dataset.dec || 0)) + (el.dataset.suf || ''); });
    try { return await html2canvas(card, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false, windowWidth: 1280 }); }
    finally { card.classList.remove('ft-captura'); }
  }
  const nomeImg = () => `fechamento-${S.fechDia}-${S.fechT === 'dia' ? 'dia' : 'turno-' + S.fechT}.png`;
  function abrirFech(d, t) { S.fechDia = d; S.fechT = t; pFech(); const s = $('#fechamento'); if (s) s.scrollIntoView({ behavior: semMov() ? 'auto' : 'smooth', block: 'start' }); }

  /* =================== barras de filtro (Produção e Variáveis) =================== */
  const safraIni = () => SAFRA_INI < IX.min ? IX.min : SAFRA_INI;
  function filtroHTML() {
    return `<div class="pv-fg pv-fg--per"><span class="pv-fl"><i class="fa-regular fa-calendar"></i>Período</span><div class="pv-fctl"><div class="pv-range"><input type="date" data-k="de" aria-label="De"><i class="fa-solid fa-arrow-right-long" aria-hidden="true"></i><input type="date" data-k="ate" aria-label="Até"></div><div class="pv-seg pv-pre" data-k="pre"><button type="button" data-v="7">7 dias</button><button type="button" data-v="30">30 dias</button><button type="button" data-v="mes">Mês</button><button type="button" data-v="safra">Safra</button></div></div></div>
      <div class="pv-fg"><span class="pv-fl"><i class="fa-regular fa-clock"></i>Turno</span><div class="pv-seg" data-k="t"><span class="ind"></span>${['todos', ...TU].map(t => `<button type="button" data-v="${t}">${t === 'todos' ? 'Todos' : t}</button>`).join('')}</div></div>
      <div class="pv-fg"><span class="pv-fl"><i class="fa-solid fa-location-dot"></i>Frente</span><div class="pv-seg" data-k="f"><span class="ind"></span>${['todas', ...FR].map(f => `<button type="button" data-v="${f}">${f === 'todas' ? 'Todas' : f}</button>`).join('')}</div></div>
      <div class="pv-fg pv-fg--local"><div class="pv-fctl"><span class="ft-fresumo"></span><button type="button" class="pv-limpar"><i class="fa-solid fa-rotate-left"></i><span>Limpar filtros</span></button></div></div>`;
  }
  function filtro(el, F, fim, padrao, cb) {
    el.innerHTML = filtroHTML();
    const at = a => { if (a === '7') F.de = addD(F.ate, -6); else if (a === '30') F.de = addD(F.ate, -29); else if (a === 'mes') F.de = F.ate.slice(0, 8) + '01'; else if (a === 'safra') { F.de = safraIni(); F.ate = fim; } if (F.de < IX.min) F.de = IX.min; };
    el.onclick = e => {
      const b = e.target.closest('button'); if (!b || b.disabled) return;
      const k = b.parentNode.dataset.k;
      if (k === 'pre') at(b.dataset.v); else if (k === 't') F.t = b.dataset.v; else if (k === 'f') F.f = b.dataset.v;
      else if (b.classList.contains('pv-limpar')) Object.assign(F, padrao());
      else return;
      cb();
    };
    el.onchange = e => { const k = e.target.dataset.k; if (!k || !e.target.value) return; F[k] = e.target.value; if (F.de > F.ate) { if (k === 'de') F.ate = F.de; else F.de = F.ate; } cb(); };
    return {
      sync(ja) {
        const n = rangeD(F.de, F.ate).length, a = F.de === safraIni() && F.ate === fim ? 'safra' : n === 7 ? '7' : n === 30 ? '30' : F.de === F.ate.slice(0, 8) + '01' ? 'mes' : null;
        $$('input[type=date]', el).forEach(i => { i.value = F[i.dataset.k]; i.min = IX.min; i.max = IX.max; });
        $$('[data-k="pre"] button', el).forEach(b => b.classList.toggle('is-on', b.dataset.v === a));
        mover($('[data-k="t"]', el), $(`[data-k="t"] button[data-v="${F.t}"]`, el), ja);
        mover($('[data-k="f"]', el), $(`[data-k="f"] button[data-v="${F.f}"]`, el), ja);
        const p = padrao(); $('.pv-limpar', el).classList.toggle('is-on', F.de !== p.de || F.ate !== p.ate || F.t !== p.t || F.f !== p.f);
        $('.ft-fresumo', el).innerHTML = `<b>${dBRa(F.de)}</b> a <b>${dBRa(F.ate)}</b> · ${F.f === 'todas' ? 'todas as frentes' : nomeF(F.f)} · ${F.t === 'todos' ? 'todos os turnos' : 'turno ' + F.t}`;
      },
    };
  }

  /* =================== 4. PRODUÇÃO =================== */
  function pProd() {
    const F = S.p, fsel = F.f === 'todas' ? FR : [F.f], inP = d => d >= F.de && d <= F.ate, inF = f => F.f === 'todas' || f === F.f, inT = t => F.t === 'todos' || t === F.t;
    S.fbP.sync(); mover($('#evoModo'), $(`#evoModo button[data-m="${S.evo}"]`), true);
    const dias = rangeD(F.de, F.ate), se = serie(dias, fsel, F.t), T = tot(se), p = T.meta ? T.realC / T.meta : null;
    const comP = se.filter(x => x.meta != null), RT = sum(se.map(x => x.real)), nAp = se.filter(x => fsel.some(f => IX.ap[x.d + '|' + f])).length;
    const P = D.producao.filter(x => inP(x.d) && inF(x.f) && inT(x.t)), sem = P.filter(x => x.semProd);
    const mot = {}; sem.forEach(x => mot[x.motivo] = (mot[x.motivo] || 0) + 1);
    const motO = Object.entries(mot).sort((a, b) => b[1] - a[1]);
    const okD = comP.filter(x => x.real >= x.meta).length;
    const kp = $('#prodKpis');
    kp.innerHTML = [
      kpi({ t: 'Realizado', ic: 'fa-droplet', v: RT, dec: 1, un: 'ha', sub: `${nAp} dia(s) com apontamento` }),
      kpi({ t: 'Atingimento da cota', ic: 'fa-bullseye', v: p == null ? null : p * 100, dec: 1, un: '%', sub: T.dias ? `${nf(T.realC, 1)} de ${nf(T.meta, 1)} ha` : 'sem cota gravada no período', st: T.dias ? st(p) : '', bar: T.dias ? p : null, mk: T.dias ? Math.min(1, 1 / Math.max(1, p || 0)) : null }),
      kpi({ t: 'Média por dia', ic: 'fa-calendar-day', v: nAp ? RT / nAp : null, dec: 1, un: 'ha/dia', sub: T.dias ? `cota média ${nf(T.meta / T.dias, 1)} ha/dia` : '' }),
      kpi({ t: 'Dias na cota', ic: 'fa-flag-checkered', v: okD, un: `de ${comP.length}`, sub: comP.length ? `${comP.filter(x => x.real < x.meta * .9).length} mais de 10% abaixo` : 'sem cota gravada no período', st: comP.length ? (okD / comP.length >= .8 ? 'ok' : okD / comP.length >= .5 ? 'warn' : 'bad') : '' }),
      kpi({ t: 'Turnos sem produção', ic: 'fa-circle-pause', v: sem.length, sub: motO[0] ? `mais comum: <b>${esc(motO[0][0])}</b>` : 'nenhum no período' }),
    ].join(''); cascata(kp); animar(kp);
    const porF = fsel.map(f => { const t = tot(serie(dias, [f], F.t)); return { f, p: t.meta ? t.realC / t.meta : null }; }).filter(x => x.p != null);
    const porT = TU.filter(inT).map(t => ({ t, r: sum(P.filter(x => x.t === t).map(x => x.ha)) }));
    let tx = !nAp ? 'Não possui dados no período selecionado.' : `A fertirrigação aplicou <b>${nf(RT, 1)} ha</b> em ${nAp} dia(s), média de <b>${nf(RT / nAp, 1)} ha/dia</b>. `;
    if (nAp) {
      if (T.dias) tx += `Nos ${T.dias} dia(s) com cota gravada, entregou <b>${pc(p)}</b> da cota. `;
      if (porF.length > 1) { const o = porF.slice().sort((a, b) => b.p - a.p); tx += `Melhor entrega: <b>${nomeF(o[0].f)}</b> (${pc(o[0].p)}); mais distante: <b>${nomeF(o[o.length - 1].f)}</b> (${pc(o[o.length - 1].p)}). `; }
      if (porT.length > 1) { const o = porT.slice().sort((a, b) => a.r - b.r); tx += `O turno <b>${o[0].t}</b> aplicou menos (${nf(o[0].r, 1)} ha). `; }
      if (motO[0]) tx += `Motivo mais comum sem produção: <b>${esc(motO[0][0]).toLowerCase()}</b>.`;
    }
    $('#prodLeitura').innerHTML = `<div class="tt"><i class="fa-solid fa-wand-magic-sparkles"></i>Leitura automática</div>${tx}`;
    const modoPc = S.evo === 'pc';
    const itens = se.filter(x => x.meta != null || IX.dias.includes(x.d)).map(x => { const q = x.meta ? x.real / x.meta : null; return { label: dBR(x.d), d: x.d, v: modoPc ? (q == null ? 0 : q * 100) : x.real, m: modoPc ? (x.meta ? 100 : null) : x.meta, ref: x.ref, cor: q == null ? '#B9CFB2' : COR[st(q)], tip: `<b>${dBRa(x.d)}</b> · ${semana(x.d)}<br>Realizado: <b>${nf(x.real, 1)} ha</b><br>${x.meta == null ? 'Sem cota gravada neste dia' : `Cota: ${nf(x.meta, 1)} ha${x.ref ? ' (referência)' : ''}<br>Atingimento: <b>${pc(q)}</b>`}<br><i>clique para abrir o fechamento</i>` }; });
    const med = itens.length ? sum(itens.map(i => i.v)) / itens.length : null;
    barrasDia($('#chEvo'), itens, { fmt: v => modoPc ? nf(v, 0) + '%' : nf(v, 0), media: med, mediaTxt: `média ${modoPc ? nf(med, 0) + '%' : nf(med, 0)}`, click: it => abrirFech(it.d, 'dia') });
    grupos($('#chTurno'), fsel.map(f => ({ label: nomeF(f), v: TU.map(t => inT(t) ? tot(serie(dias, [f], t)).real : null), m: TU.map(t => { if (!inT(t)) return null; const x = tot(serie(dias, [f], t)), ap = dias.filter(d => IX.ap[d + '|' + f + '|' + t]).length; return x.dias && x.dias === ap ? x.meta : null; }) })).filter(g => g.v.some(v => v)),
      TU.map((t, i) => ({ nome: 'Turno ' + t, curto: t, cor: ['#3C7A35', '#5E9A57', '#1F4D2B'][i] })), { un: 'ha', h: 250 });
    const pcs = arred100(motO.map(x => x[1])), mm = Math.max(1, ...motO.map(x => x[1]));
    $('#rkMotivo').innerHTML = motO.length ? motO.map(([n, c], i) => pcs[i] ? `<div class="r" data-tip="${c} turno(s) de aplicador"><span>${esc(n)}</span><div class="trk"><i class="${n === 'Não informado' ? 'warn' : ''}" style="--w:${c / mm * 100}%;--i:${i}"></i></div><span class="v">${pcs[i]}%</span></div>` : '').join('') : '<div class="ft-vazio">Nenhum turno sem produção no período.</div>';
    heat(dias, fsel, F.t);
  }
  function heatCor(p) {
    if (p == null) return ['#F1F3EF', '#9AA59D'];
    if (p >= 1) { const t = Math.min((p - 1) / .3, 1) * .8 + .15; return [mix('#E3EDF8', '#1c5cab', t), t > .55 ? '#fff' : '#18301F']; }
    const t = Math.min((1 - p) / .6, 1); return [mix('#FCEDE6', '#b8401c', t), t > .5 ? '#fff' : '#18301F'];
  }
  function heat(dias, fsel, t) {
    const ms = {}; dias.forEach(d => (ms[d.slice(0, 7)] = ms[d.slice(0, 7)] || []).push(d));
    const NM = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'], mk = Object.keys(ms);
    let h = '<table><thead><tr><th class="rl"></th>' + mk.map((m, i) => `<th class="mes" colspan="${ms[m].length}">${NM[+m.slice(5) - 1]}/${m.slice(2, 4)}</th>${i < mk.length - 1 ? '<th></th>' : ''}`).join('') + '</tr><tr><th class="rl"></th>' + mk.map((m, i) => ms[m].map(d => `<th class="dd">${+d.slice(8)}</th>`).join('') + (i < mk.length - 1 ? '<td class="gap"></td>' : '')).join('') + '</tr></thead><tbody>';
    let k = 0;
    fsel.forEach(f => {
      h += `<tr><th class="rl">${nomeF(f)}</th>` + mk.map((m, i) => ms[m].map(d => {
        const me = metaOf(d, f, t), r = realOf(d, f, t), ap = IX.ap[d + '|' + f], p = me && me.v ? r / me.v : null, [bg, fg] = heatCor(p);
        return `<td class="c${p == null && ap ? ' semcota' : ''}" style="background:${bg};color:${fg};--i:${k++ % 200}" data-d="${d}" data-tip="<b>${nomeF(f)} · ${dBRa(d)}</b><br>${me ? `${nf(r, 1)} ha de ${nf(me.v, 1)} ha · <b>${pc(p)}</b>` : ap ? `${nf(r, 1)} ha · sem cota gravada` : 'sem apontamento'}<br><i>clique para abrir o fechamento</i>">${p != null ? Math.round(p * 100) : ap ? Math.round(r) : ''}</td>`;
      }).join('') + (i < mk.length - 1 ? '<td class="gap"></td>' : '')).join('') + '</tr>';
    });
    const el = $('#heat'); el.innerHTML = h + '</tbody></table>';
    el.onclick = e => { const c = e.target.closest('td.c'); if (c) abrirFech(c.dataset.d, 'dia'); };
    el.scrollLeft = el.scrollWidth;
  }

  /* =================== 5. VARIÁVEIS OPERACIONAIS (interativo) =================== */
  function pVar() {
    const F = S.v, k = F.ind, c = IND[k], fsel = F.f === 'todas' ? FR : [F.f];
    S.fbV.sync();
    const inP = d => d >= F.de && d <= F.ate, inT = t => F.t === 'todos' || t === F.t;
    const n = rangeD(F.de, F.ate).length, antP = d => d >= addD(F.de, -n) && d < F.de;
    const base = D.sgpa.filter(s => inP(s.d) && inT(s.t)), R = base.filter(s => fsel.includes(s.f)), ant = D.sgpa.filter(s => antP(s.d) && inT(s.t) && fsel.includes(s.f));
    const fmt = v => c.pct ? pc(v, 1) : nf(v, 1) + ' ' + c.un;
    const delta = (v, va, ci) => { if (v == null || va == null) return ''; const dl = ci.pct ? (v - va) * 100 : v - va; if (Math.abs(dl) < .05) return ''; const bom = ci.maior ? dl >= 0 : dl <= 0; return `<span class="d ${bom ? 'up' : 'dn'}">${dl > 0 ? '▲' : '▼'} ${nf(Math.abs(dl), 1)}${ci.pct ? ' p.p.' : ''}</span>`; };
    // cards = um por indicador; clique troca o indicador dos gráficos
    const kp = $('#sgKpis');
    kp.innerHTML = Object.keys(IND).map(key => {
      const ci = IND[key], v = avg(R.map(r => r[key])), va = avg(ant.map(r => r[key])), s = stInd(key, v);
      return `<button type="button" class="k ft-kbtn${s ? ' is-' + s : ''}${key === k ? ' sel' : ''}" data-ind="${key}" role="tab" aria-selected="${key === k}"><div class="k__t"><span>${ci.nome}</span><i class="fa-solid ${ci.ic}"></i></div><div class="k__v">${v == null ? '—' : nf(ci.pct ? v * 100 : v, 1)}<small>${ci.pct ? '%' : ci.un}</small></div><div class="k__s">${ci.meta != null ? `meta ${ci.maior ? '≥' : '≤'} ${pc(ci.meta)}` : 'sem meta'} ${delta(v, va, ci)}</div>${ci.meta != null ? `<div class="k__bar"><i style="width:${Math.min(100, (v || 0) * 100)}%"></i><span class="mk" style="left:calc(${ci.meta * 100}% - 1px)"></span></div>` : ''}</button>`;
    }).join('');
    kp.onclick = e => { const b = e.target.closest('[data-ind]'); if (b) { S.v.ind = b.dataset.ind; pVar(); } };
    animar(kp);
    const rotulo = `${F.f === 'todas' ? 'todas as frentes' : nomeF(F.f)}${F.t === 'todos' ? '' : ' · turno ' + F.t}`;
    // evolução diária
    const ds = [...new Set(R.map(r => r.d))].sort(), por = {}; R.forEach(r => (por[r.d] = por[r.d] || []).push(r));
    $('#sgTit').innerHTML = `${c.nome} por dia <span class="ft-sub2">${rotulo}</span>`;
    linha($('#chSgEvo'), ds.map(dBR), ds.map(d => avg(por[d].map(r => r[k]))), { pct: c.pct, meta: c.meta, maior: c.maior, fmt, nome: c.nome, stv: v => stInd(k, v) });
    // por turno (clique filtra)
    $('#sgTurTit').innerHTML = `Por turno <span class="ft-sub2">${F.f === 'todas' ? 'todas as frentes' : nomeF(F.f)}</span>`;
    const bt = D.sgpa.filter(s => inP(s.d) && fsel.includes(s.f));
    turnoBarras($('#chSgTurno'), TU.map(t => ({ t, v: avg(bt.filter(s => s.t === t).map(s => s[k])) })), c, k, fmt);
    // pequenos múltiplos por frente (clique filtra)
    const sm = $('#sgFrentes');
    sm.innerHTML = FR.map(f => {
      const rf = base.filter(s => s.f === f), v = avg(rf.map(r => r[k])), va = avg(D.sgpa.filter(s => antP(s.d) && inT(s.t) && s.f === f).map(r => r[k])), s = stInd(k, v);
      const dsf = [...new Set(rf.map(r => r.d))].sort(), sp = spark(dsf.map(d => avg(rf.filter(r => r.d === d).map(r => r[k]))), c.meta);
      const ofs = {}; rf.forEach(r => r.of.forEach(o => ofs[o] = (ofs[o] || 0) + 1)); const top = Object.entries(ofs).sort((a, b) => b[1] - a[1])[0];
      return `<button type="button" class="ft-smc${F.f === f ? ' sel' : ''}${F.f !== 'todas' && F.f !== f ? ' off' : ''}" data-f="${f}" data-tip="${F.f === f ? 'Clique para ver todas as frentes' : 'Clique para filtrar a ' + nomeF(f)}">
        <div class="hd"><b>${nomeF(f)}</b>${s ? `<span class="ft-tag ${s}">${s === 'ok' ? 'na meta' : s === 'warn' ? 'atenção' : 'fora da meta'}</span>` : ''}</div>
        <div class="vv"><span class="${s ? 't-' + s : ''}">${v == null ? '—' : fmt(v)}</span>${delta(v, va, c)}</div>
        <div class="sp">${sp}</div>
        <div class="of">${top ? `<i class="fa-solid fa-triangle-exclamation"></i>${esc(top[0])} · ${pc(top[1] / rf.length)} dos turnos` : '&nbsp;'}</div>
      </button>`;
    }).join('');
    cascata(sm);
    sm.onclick = e => { const b = e.target.closest('[data-f]'); if (!b) return; S.v.f = S.v.f === b.dataset.f ? 'todas' : b.dataset.f; pVar(); };
    // ofensores (Pareto)
    const cnt = {}; R.forEach(r => r.of.forEach(o => cnt[o] = (cnt[o] || 0) + 1));
    const of = Object.entries(cnt).sort((a, b) => b[1] - a[1]).filter(([, q]) => Math.round(q / R.length * 100) > 0), mo = Math.max(1, ...of.map(x => x[1]));
    $('#sgOfTit').innerHTML = `Ofensores <span class="ft-sub2">% dos turnos · ${rotulo}</span>`;
    $('#rkOf').innerHTML = of.length ? of.map(([nm, q], i) => `<div class="r" data-tip="${q} de ${R.length} turnos"><span>${esc(nm)}</span><div class="trk"><i style="--w:${q / mo * 100}%;--i:${i}"></i></div><span class="v">${pc(q / R.length)}</span></div>`).join('') : '<div class="ft-vazio">Sem ofensores no período.</div>';
    // leitura
    const v = avg(R.map(r => r[k]));
    const pf = FR.map(f => ({ f, v: avg(base.filter(s => s.f === f).map(r => r[k])) })).filter(x => x.v != null).sort((a, b) => c.maior ? b.v - a.v : a.v - b.v);
    const pt = TU.map(t => ({ t, v: avg(bt.filter(s => s.t === t).map(s => s[k])) })).filter(x => x.v != null).sort((a, b) => c.maior ? b.v - a.v : a.v - b.v);
    let tx = v == null ? 'Sem registros no recorte.' : `<b>${c.nome}</b> médio de <b>${fmt(v)}</b> em ${rotulo}`;
    if (v != null && c.meta != null) tx += `, ${stInd(k, v) === 'ok' ? 'dentro' : 'fora'} da meta (${c.maior ? '≥' : '≤'} ${pc(c.meta)})`;
    if (v != null) tx += '. ';
    if (pf.length > 1 && F.f === 'todas') tx += `Melhor frente: <b>${nomeF(pf[0].f)}</b> (${fmt(pf[0].v)}); pior: <b>${nomeF(pf[pf.length - 1].f)}</b> (${fmt(pf[pf.length - 1].v)}). `;
    if (pt.length > 1) tx += `Turno com pior resultado: <b>${pt[pt.length - 1].t}</b> (${fmt(pt[pt.length - 1].v)}). `;
    if (of[0]) tx += `Ofensor mais frequente: <b>${esc(of[0][0]).toLowerCase()}</b> (${pc(of[0][1] / R.length)} dos turnos).`;
    $('#sgLeitura').innerHTML = `<div class="tt"><i class="fa-solid fa-wand-magic-sparkles"></i>Leitura automática</div>${tx}<small>Clique num indicador para trocar os gráficos; clique numa frente ou num turno para filtrar.</small>`;
  }
  function turnoBarras(el, it, c, k, fmt) {
    if (!it.some(x => x.v != null)) return vazio(el);
    const w = W(el), H = 250, pl = 46, pr = 12, pt = 22, pb = 30, mx = Math.max(...it.map(x => x.v || 0), c.meta || 0) * 1.18, y = v => pt + (H - pt - pb) * (1 - v / mx), gw = (w - pl - pr) / 3, bw = Math.min(70, gw * .55);
    let s = `<svg viewBox="0 0 ${w} ${H}" width="${w}" height="${H}">` + eixoY(mx / 1.18, y, pl, w - pr, v => c.pct ? pc(v) : nf(v, 0));
    if (c.meta != null) s += `<line class="fade" x1="${pl}" x2="${w - pr}" y1="${y(c.meta)}" y2="${y(c.meta)}" stroke="#2E7D32" stroke-width="1.6" stroke-dasharray="5 4"/><text class="fade" x="${w - pr}" y="${y(c.meta) - 5}" text-anchor="end" style="fill:#2E7D32;font-weight:700">meta ${c.pct ? pc(c.meta) : nf(c.meta, 1)}</text>`;
    it.forEach((x, i) => {
      if (x.v == null) return;
      const cx = pl + i * gw + gw / 2, sc = stInd(k, x.v), on = S.v.t === x.t;
      s += `<rect class="ftb" style="--i:${i};cursor:pointer" data-t="${x.t}" x="${cx - bw / 2}" y="${y(x.v)}" width="${bw}" height="${y(0) - y(x.v)}" rx="6" fill="${sc ? COR[sc] : '#3C7A35'}" opacity="${S.v.t === 'todos' || on ? 1 : .35}" data-tip="${esc(`<b>Turno ${x.t}</b><br>${c.nome}: <b>${fmt(x.v)}</b><br><i>clique para ${on ? 'ver todos os turnos' : 'filtrar'}</i>`)}"/><text class="lb fade" x="${cx}" y="${y(x.v) - 7}" text-anchor="middle">${fmt(x.v)}</text><text x="${cx}" y="${H - 8}" text-anchor="middle" style="fill:#18301F;font-weight:700">Turno ${x.t}</text>`;
    });
    el.innerHTML = s + '</svg>';
    el.querySelector('svg').onclick = e => { const r = e.target.closest('rect[data-t]'); if (r) { S.v.t = S.v.t === r.dataset.t ? 'todos' : r.dataset.t; pVar(); } };
  }

  /* ---------- ligação dos controles ---------- */
  function ligar() {
    if (ligado) return; ligado = true;
    $('#evoModo').onclick = e => { const b = e.target.closest('button'); if (b) { S.evo = b.dataset.m; pProd(); } };
    $('#fechTurno').onclick = e => { const b = e.target.closest('button'); if (b) { S.fechT = b.dataset.t; pFech(); } };
    $('#fechDia').onchange = e => { if (e.target.value) { S.fechDia = e.target.value; pFech(); } };
    $('#fechDiaNav').addEventListener('click', e => { const b = e.target.closest('button[data-n]'); if (!b) return; const i = IX.dias.indexOf(S.fechDia) + +b.dataset.n; if (i >= 0 && i < IX.dias.length) { S.fechDia = IX.dias[i]; pFech(); } });
    $('#fechBaixar').onclick = async () => { const c = await imagemFech(); if (!c) return; const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = nomeImg(); a.click(); toast('Imagem baixada.'); };
    $('#fechCopiar').onclick = async () => {
      try { const c = await imagemFech(); if (!c) return; const blob = await new Promise(r => c.toBlob(r, 'image/png')); await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); toast('Imagem copiada — é só colar no grupo.'); }
      catch (e) { toast('Não foi possível copiar. Use “Baixar imagem”.'); }
    };
    let tm; addEventListener('resize', () => { clearTimeout(tm); tm = setTimeout(() => { if (D) { pProd(); pVar(); mover($('#fechTurno'), $(`#fechTurno button[data-t="${S.fechT}"]`), true); } }, 220); });
    const css = document.createElement('style'); css.textContent = '.ft-captura *, .ft-captura *::before, .ft-captura *::after { animation: none !important; transition: none !important; font-stretch: 100% !important; letter-spacing: 0 !important; }'; document.head.appendChild(css);
  }

  function montar() {
    FR = (D.frentes || []).slice().sort(porNum); indexar();
    const fimP = IX.ultProd, fimV = IX.sgDias[IX.sgDias.length - 1] || fimP;
    const padP = () => ({ de: addD(fimP, -29) < IX.min ? IX.min : addD(fimP, -29), ate: fimP, t: 'todos', f: 'todas' });
    const padV = () => ({ de: addD(fimV, -29), ate: fimV, t: 'todos', f: 'todas' });
    if (!S) S = { p: padP(), v: { ...padV(), ind: 'prod' }, evo: 'ha', diaPainel: null, diaCota: null, fechDia: null, fechT: null };
    S.fbP = filtro($('#fbProd'), S.p, fimP, padP, pProd);
    S.fbV = filtro($('#fbSg'), S.v, fimV, padV, pVar);
    ligar();
    const g = D.geradoEm ? new Date(D.geradoEm) : null;
    const chip = $('#ftChip span'); if (chip) chip.textContent = g ? 'Atualizado ' + g.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
    pResumo(); pFrentes(); pCota(); pFech(); pProd(); pVar();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { S.fbP.sync(true); S.fbV.sync(true); mover($('#fechTurno'), $(`#fechTurno button[data-t="${S.fechT}"]`), true); mover($('#evoModo'), $(`#evoModo button[data-m="${S.evo}"]`), true); });
  }
  async function iniciar(dados) {
    if (dados) { D = dados; montar(); return; }
    try {
      const r = await fetch(ARQ, { cache: 'no-store' }); if (!r.ok) throw new Error('sem arquivo');
      D = (await Acesso.readJson(await r.json())).data; montar();
    } catch (e) { const el = $('#resKpis'); if (el) el.innerHTML = '<div class="ft-vazio" style="grid-column:1/-1">Ainda não há dados publicados. Use “Sincronizar pasta”.</div>'; }
  }
  /** Recebe dados novos logo após a sincronização, sem recarregar a página. */
  function definir(dados) { D = dados; S = null; montar(); }

  return { iniciar, definir, VERSAO, ARQ, get dados() { return D; } };
})();

/* ---------- inicialização (login → layout → página) ---------- */
(function () {
  const sair = document.getElementById('btnSair');
  if (sair) sair.addEventListener('click', () => { Acesso.logout(); location.reload(); });
  Acesso.gate().then(user => {
    if (window.Layout) { Layout.definirUsuario(user); Layout.iniciar(); }
    if (sair) sair.title = `Sair (${user})`;
    Fertirrigacao.iniciar(window.__FERT_DADOS__);
  });
})();
