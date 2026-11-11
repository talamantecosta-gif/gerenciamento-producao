/* =========================================================================
   Sincronizar pastas → GitHub (painel Gerenciamento Produção)
   -------------------------------------------------------------------------
   • Várias pastas vinculadas (botão "Pastas"): o navegador guarda só a
     autorização de leitura. Em cada pasta (e um nível de subpastas) procura:
       - "Acompanhamento 2026.xlsm" (nome com Acompanhamento/Fertirrigação)
         → fertirrigacao.json (com o histórico da cota, PAINEL e fechamentos);
       - "Pulverizadores.xlsx" (nome com Pulveriza) → pulverizacao.json
         (correções da planilha refeitas a cada sincronização);
       - "relatorio-ciclo-operacao.xlsx" (TRAVICAR, aplicação aérea) → aviacao.json
         (trabalhos acumulados: o histórico fica mesmo que saia do período exportado);
       - "Usuários site gerencial.xlsx" (nome com Usuário) → acesso.json
         (mesma regra do painel-agricola: inativo sai, senha < 8 mantém como
         estava, o usuário logado nunca é removido).
     Havendo o mesmo arquivo em mais de uma pasta, vale o salvo por último.
   • Só publica o que mudou, num único commit (token do usuário, protegido).
   • Sem token: baixa os arquivos prontos para subir à mão.
   • Só sincroniza no clique. Só o editor vê os botões.
   ========================================================================= */
window.Sincronizar = (function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const ARQ = 'fertirrigacao.json';
  const PADRAO = { owner: 'talamantecosta-gif', repo: 'gerenciamento-producao', branch: 'main' };
  const CFG_KEY = 'painel-github-producao', CFG_AGR = 'painel-github', SIG_KEY = 'painel-producao-assinaturas';
  const TIPOS = [
    { tipo: 'fert', rx: /(acompanhamento|fertirriga).*\.xls[xm]$/i, nome: 'Fertirrigação' },
    { tipo: 'pulv', rx: /pulveriza.*\.xls[xm]$/i, nome: 'Pulverização' },
    { tipo: 'avi', rx: /(ciclo.*opera|travicar).*\.xls[xm]?$/i, nome: 'Aviação (TRAVICAR)' },
    { tipo: 'usuarios', rx: /usu[aá]rio.*\.xls[xm]$/i, nome: 'Usuários' },
  ];

  /* ---------- configuração protegida e assinaturas ---------- */
  const lerCfg = async k => { try { const s = localStorage.getItem(k); if (!s) return null; const o = JSON.parse(s); return Acesso.isProtected(o) ? await Acesso.decryptJson(o) : null; } catch (e) { return null; } };
  const cfg = {
    async get() { const p = await lerCfg(CFG_KEY); if (p) return p; const a = await lerCfg(CFG_AGR); return a && a.token ? { ...PADRAO, token: a.token, herdado: true } : null; },
    async set(v) { try { if (!v) localStorage.removeItem(CFG_KEY); else localStorage.setItem(CFG_KEY, JSON.stringify(await Acesso.encryptJson(v))); } catch (e) { /* sem storage */ } },
  };
  const sigs = { get() { try { return JSON.parse(localStorage.getItem(SIG_KEY) || '{}'); } catch (e) { return {}; } }, set(o) { try { localStorage.setItem(SIG_KEY, JSON.stringify(o)); } catch (e) { /* */ } } };

  /* ---------- pastas vinculadas (IndexedDB) ---------- */
  const idb = (modo, fn) => new Promise((ok, nok) => {
    const r = indexedDB.open('painel-producao', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('h');
    r.onerror = () => nok(r.error);
    r.onsuccess = () => { try { const tx = r.result.transaction('h', modo); const q = fn(tx.objectStore('h')); tx.oncomplete = () => ok(q && q.result); tx.onerror = () => nok(tx.error); } catch (e) { nok(e); } };
  });
  const lerPastas = async () => { try { const v = await idb('readonly', st => st.get('pastas')); if (Array.isArray(v)) return v; const antiga = await idb('readonly', st => st.get('pasta')); return antiga ? [antiga] : []; } catch (e) { return []; } };
  const gravarPastas = l => idb('readwrite', st => st.put(l, 'pastas')).catch(() => null);
  const SUPORTA = 'showDirectoryPicker' in window;
  const temPerm = async h => { try { return (await h.queryPermission({ mode: 'read' })) === 'granted'; } catch (e) { return false; } };
  const pedirPerm = async h => { try { return (await h.requestPermission({ mode: 'read' })) === 'granted'; } catch (e) { return false; } };
  async function adicionarPasta() {
    const h = await window.showDirectoryPicker({ id: 'painel-producao', mode: 'read' });
    const l = await lerPastas();
    for (const x of l) if (x.isSameEntry && await x.isSameEntry(h)) return l;
    l.push(h); await gravarPastas(l); return l;
  }
  async function varrer(dir, nivel, achados, pasta) {
    for await (const [nome, h] of dir.entries()) {
      if (h.kind === 'file' && !nome.startsWith('~$')) {
        const t = TIPOS.find(t => t.rx.test(nome));
        if (t) { const f = await h.getFile(); const at = achados[t.tipo]; if (!at || f.lastModified > at.f.lastModified) achados[t.tipo] = { f, pasta }; }
      } else if (h.kind === 'directory' && nivel < 1) await varrer(h, nivel + 1, achados, pasta);
    }
  }

  /* ---------- GitHub (API) ---------- */
  const gh = async (c, metodo, rota, corpo) => {
    const r = await fetch(`https://api.github.com/repos/${c.owner}/${c.repo}${rota}`, {
      method: metodo, cache: 'no-store', body: corpo ? JSON.stringify(corpo) : undefined,
      headers: { Authorization: `Bearer ${c.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
    });
    if (r.status === 404 && metodo === 'GET') return null;
    if (!r.ok) {
      let msg = ''; try { msg = (await r.json()).message || ''; } catch (e) { /* */ }
      if (r.status === 401) throw new Error('o GitHub recusou o token (expirado ou inválido). Cole um token válido no botão do GitHub.');
      if (r.status === 403 || r.status === 404) throw new Error(`o token não tem acesso de escrita ao repositório ${c.owner}/${c.repo} (Contents: Read and write).`);
      throw new Error(`GitHub respondeu ${r.status}${msg ? ': ' + msg : ''}`);
    }
    return r.status === 204 ? null : r.json();
  };
  const b64utf8 = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), ch => ch.charCodeAt(0)));
  const lerRepoBruto = async (c, path) => { const x = await gh(c, 'GET', `/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(c.branch)}`); return x && x.content ? JSON.parse(b64utf8(x.content)) : null; };
  const commit = async (c, arquivos, msg) => {
    for (let tent = 0; tent < 2; tent++) {
      const ref = await gh(c, 'GET', `/git/ref/heads/${encodeURIComponent(c.branch)}`);
      if (!ref) throw new Error(`não encontrei o branch "${c.branch}" em ${c.owner}/${c.repo}.`);
      const base = await gh(c, 'GET', `/git/commits/${ref.object.sha}`);
      const tree = await gh(c, 'POST', '/git/trees', { base_tree: base.tree.sha, tree: arquivos.map(a => ({ path: a.path, mode: '100644', type: 'blob', content: a.content })) });
      const novo = await gh(c, 'POST', '/git/commits', { message: msg, tree: tree.sha, parents: [ref.object.sha] });
      try { await gh(c, 'PATCH', `/git/refs/heads/${encodeURIComponent(c.branch)}`, { sha: novo.sha }); return novo.sha; } catch (e) { if (tent) throw e; }
    }
  };
  const lerSite = async p => { try { const r = await fetch(p, { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch (e) { return null; } };
  const carregaXlsx = () => new Promise((ok, nok) => {
    if (window.XLSX) return ok(window.XLSX);
    const sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    sc.onload = () => ok(window.XLSX); sc.onerror = () => nok(new Error('o leitor de planilhas não carregou (verifique a internet)'));
    document.head.appendChild(sc);
  });
  const baixar = (texto, nome) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([texto], { type: 'application/json' })); a.download = nome; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); };

  /* ---------- planilha de usuários → acesso.json (mesma regra do painel-agricola) ---------- */
  const normU = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const COL_USER = ['usuario', 'usuarios', 'login', 'user', 'nome de usuario', 'usuario do site', 'usuario painel'];
  const COL_SENHA = ['senha', 'password', 'senha do site', 'senha painel'];
  const COL_ATIVO = ['ativo', 'status', 'situacao', 'acesso', 'liberado'];
  const achaCab = rows => { for (let i = 0; i < Math.min(rows.length, 30); i++) { const h = (rows[i] || []).map(normU); const u = h.findIndex(x => COL_USER.includes(x)), p = h.findIndex(x => COL_SENHA.includes(x)); if (u >= 0 && p >= 0) return { i, u, p, a: h.findIndex(x => COL_ATIVO.includes(x)) }; } return null; };
  async function atualizarUsuarios(file, c) {
    const X = await carregaXlsx();
    const wb = X.read(await file.arrayBuffer(), { type: 'array' });
    let tab = null;
    for (const n of wb.SheetNames) { const rows = X.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: null }); const cab = achaCab(rows); if (cab) { tab = { rows, cab }; break; } }
    if (!tab) throw new Error('não encontrei as colunas "Usuário" e "Senha"');
    const inativo = v => /^(nao|n|inativo|bloqueado|desativado|removido|sem acesso|0|false)$/.test(normU(v));
    const lista = new Map(), avisos = [];
    tab.rows.slice(tab.cab.i + 1).forEach((r, k) => {
      const u = String(r[tab.cab.u] ?? '').trim().toLowerCase(); if (!u) return;
      if (tab.cab.a >= 0 && inativo(r[tab.cab.a])) return;
      const p = String(r[tab.cab.p] ?? '');
      if (!Acesso.checkPass(p)) { avisos.push(`a senha de ${u} tem menos de 8 caracteres (linha ${tab.cab.i + k + 2}) — mantive o acesso como estava`); lista.set(u, null); return; }
      lista.set(u, p);
    });
    if (![...lista.values()].some(Boolean)) throw new Error('nenhum usuário com senha válida na planilha');
    let cfgA = null;
    if (c && c.token) { try { cfgA = await lerRepoBruto(c, 'acesso.json'); } catch (e) { cfgA = null; } }
    if (!cfgA) cfgA = await Acesso.loadConfig();
    if (!cfgA || !Array.isArray(cfgA.usuarios)) throw new Error('não consegui ler o acesso.json atual');
    const atuais = await Acesso.listUsers(cfgA), eu = String(Acesso.user || '').toLowerCase();
    let cfgN = cfgA, removidos = 0;
    for (const [u, p] of lista) if (p) cfgN = await Acesso.addUser(cfgN, u, p);
    for (const x of atuais) { const nome = String(x.nome || '').toLowerCase(); if (lista.has(nome) || nome === eu || nome === '(sem nome)') continue; cfgN = await Acesso.removeUser(cfgN, x.id); removidos++; }
    return { cfg: cfgN, total: cfgN.usuarios.length, removidos, avisos };
  }

  /* ---------- janelas ---------- */
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const modal = html => { const m = $('#syncModal'); m.innerHTML = `<div class="ft-modal__box">${html}</div>`; m.hidden = false; m.onclick = e => { if (e.target === m || e.target.closest('[data-fechar]')) m.hidden = true; }; return m; };
  const toast = msg => { const t = $('#toast'); if (!t) return; t.textContent = msg; t.classList.add('on'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('on'), 2800); };
  let LOG = null;
  const log = (txt, cls = '') => { if (LOG) { LOG.insertAdjacentHTML('beforeend', `<div class="${cls}">${txt}</div>`); LOG.scrollTop = LOG.scrollHeight; } };

  async function pastas() {
    if (!SUPORTA) { modal(`<h3>Pastas</h3><p>Para ler pastas do computador, abra o painel no <b>Google Chrome</b> ou no <b>Microsoft Edge</b> (no computador).</p><div class="ft-modal__acts"><button class="ft-btn" data-fechar>Fechar</button></div>`); return; }
    const l = await lerPastas(), perms = await Promise.all(l.map(temPerm));
    const m = modal(`<h3><i class="fa-regular fa-folder-open"></i> Pastas sincronizadas</h3><p>O painel procura nestas pastas (e numa subpasta abaixo) as planilhas <b>Acompanhamento 2026</b>, <b>Pulverizadores</b>, o relatório da <b>TRAVICAR</b> (relatorio-ciclo-operacao) e <b>Usuários site gerencial</b>. Se o mesmo arquivo estiver em duas pastas, vale o salvo por último.</p>
      <div class="ft-pastas">${l.length ? l.map((h, i) => `<div class="ft-pasta"><i class="fa-solid fa-folder"></i><b>${esc(h.name)}</b>${perms[i] ? '<span class="ft-tag ok">liberada</span>' : `<button class="ft-btn" data-lib="${i}">Liberar</button>`}<button class="ft-btn" data-rem="${i}" aria-label="Remover ${esc(h.name)}"><i class="fa-solid fa-trash"></i></button></div>`).join('') : '<div class="ft-vazio">Nenhuma pasta vinculada.</div>'}</div>
      <div class="ft-modal__acts"><button class="ft-btn" data-fechar>Fechar</button><button class="ft-btn" id="pAdd"><i class="fa-solid fa-folder-plus"></i>Adicionar pasta</button><button class="ft-btn pri" id="pSync"><i class="fa-solid fa-rotate"></i>Sincronizar</button></div>`);
    m.querySelector('#pAdd').onclick = async () => { try { await adicionarPasta(); } catch (e) { /* cancelou */ } pastas(); };
    m.querySelector('#pSync').onclick = () => sincronizar();
    m.querySelectorAll('[data-rem]').forEach(b => b.onclick = async () => { const x = await lerPastas(); x.splice(+b.dataset.rem, 1); await gravarPastas(x); pastas(); });
    m.querySelectorAll('[data-lib]').forEach(b => b.onclick = async () => { await pedirPerm(l[+b.dataset.lib]); pastas(); });
  }

  async function configurar() {
    const c = (await cfg.get()) || PADRAO;
    const m = modal(`<h3><i class="fa-brands fa-github"></i> Publicação no GitHub</h3><p>O token fica guardado protegido pela sua senha, só neste navegador, e só é enviado para api.github.com. Use um token fine-grained com acesso ao repositório do painel e <b>Contents: Read and write</b>.</p>
      <label>Repositório (dono/nome)</label><input id="cfgRepo" value="${esc(c.owner + '/' + c.repo)}">
      <label>Branch</label><input id="cfgBranch" value="${esc(c.branch || 'main')}">
      <label>Token${c.herdado ? ' (reaproveitado do painel-agricola)' : ''}</label><input id="cfgTok" type="password" autocomplete="off" placeholder="${c.token ? 'token salvo — deixe em branco para manter' : 'github_pat_…'}">
      <div class="ft-modal__log" id="cfgMsg" hidden></div>
      <div class="ft-modal__acts"><button class="ft-btn" data-fechar>Cancelar</button><button class="ft-btn" id="cfgApagar">Apagar token</button><button class="ft-btn pri" id="cfgSalvar">Testar e salvar</button></div>`);
    const msg = m.querySelector('#cfgMsg');
    m.querySelector('#cfgSalvar').onclick = async () => {
      const [owner, repo] = m.querySelector('#cfgRepo').value.trim().split('/');
      const n = { owner, repo, branch: m.querySelector('#cfgBranch').value.trim() || 'main', token: m.querySelector('#cfgTok').value.trim() || c.token || '' };
      msg.hidden = false;
      if (!owner || !repo || !n.token) { msg.innerHTML = '<div class="bad">Preencha o repositório e o token.</div>'; return; }
      msg.innerHTML = '<div>Testando o acesso…</div>';
      try {
        const r = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { cache: 'no-store', headers: { Authorization: `Bearer ${n.token}`, Accept: 'application/vnd.github+json' } });
        if (r.status === 401) throw new Error('o GitHub recusou o token (inválido ou expirado).');
        if (!r.ok) throw new Error('o token não enxerga esse repositório — confira o nome e o Repository access do token.');
        const rep = await r.json();
        if (rep.permissions && !rep.permissions.push) throw new Error('o token não tem permissão de escrita (Contents: Read and write).');
        await cfg.set(n); m.hidden = true; toast('GitHub conectado neste navegador.');
      } catch (e) { msg.innerHTML = `<div class="bad">Não salvei: ${esc(e.message)}</div>`; }
    };
    m.querySelector('#cfgApagar').onclick = async () => { await cfg.set(null); m.hidden = true; toast('Token apagado deste navegador.'); };
  }

  /* ---------- sincronização ---------- */
  let RODANDO = false;
  async function sincronizar() {
    if (RODANDO) return; RODANDO = true;
    const btn = $('#btnSync'); if (btn) btn.classList.add('girando');
    const m = modal(`<h3><i class="fa-solid fa-rotate"></i> Sincronizar</h3><p>Lendo as pastas e publicando o que mudou.</p><div class="ft-modal__log" id="syncLog"></div><div class="ft-modal__acts"><button class="ft-btn" id="sPastas"><i class="fa-regular fa-folder-open"></i>Pastas</button><button class="ft-btn" data-fechar>Fechar</button></div>`);
    LOG = m.querySelector('#syncLog'); m.querySelector('#sPastas').onclick = () => pastas();
    try {
      if (!window.Acesso || !Acesso.unlocked) throw new Error('entre com seu usuário antes de sincronizar.');
      const achados = {};
      if (SUPORTA) {
        let l = await lerPastas();
        if (!l.length) { log('Nenhuma pasta vinculada: escolha a primeira pasta…'); l = await adicionarPasta(); }
        for (const h of l) {
          if (!(await temPerm(h)) && !(await pedirPerm(h))) { log(`Pasta <b>${esc(h.name)}</b>: sem permissão de leitura (use Pastas → Liberar).`, 'bad'); continue; }
          try { await varrer(h, 0, achados, h.name); log(`Pasta <b>${esc(h.name)}</b> lida.`); } catch (e) { log(`Pasta <b>${esc(h.name)}</b>: não consegui ler (${esc(e.message || e)}).`, 'bad'); }
        }
      } else {
        log('Este navegador não abre pastas: escolha a planilha (Acompanhamento 2026 ou Pulverizadores).');
        const f = await new Promise(ok => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.xlsm,.xlsx'; i.onchange = () => ok(i.files[0] || null); i.click(); });
        if (f) { const t = TIPOS.find(t => t.rx.test(f.name)); achados[t && t.tipo !== 'usuarios' ? t.tipo : 'fert'] = { f, pasta: '—' }; }
      }
      TIPOS.forEach(t => { const a = achados[t.tipo]; log(a ? `${t.nome}: <b>${esc(a.f.name)}</b> (${esc(a.pasta)}) · salva em ${new Date(a.f.lastModified).toLocaleString('pt-BR')}` : `${t.nome}: planilha não encontrada nas pastas.`, a ? '' : 'bad'); });
      if (!achados.fert && !achados.pulv && !achados.avi && !achados.usuarios) throw new Error('nenhuma planilha encontrada. Confira as pastas no botão Pastas.');

      const c = await cfg.get(), S0 = sigs.get(), S1 = { ...S0 }, arquivos = [];
      // fertirrigação
      if (achados.fert) {
        const f = achados.fert.f, sig = `${f.name}|${f.lastModified}|${FertPlanilha.VERSAO}|${Fertirrigacao.VERSAO}`;
        let anterior = null;
        if (c && c.token) { try { const b = await lerRepoBruto(c, ARQ); anterior = b ? (await Acesso.readJson(b)).data : null; } catch (e) { if (/token/.test(e.message)) throw e; } }
        if (!anterior) anterior = Fertirrigacao.dados || await (async () => { const b = await lerSite(ARQ); return b ? (await Acesso.readJson(b)).data : null; })();
        if (anterior && anterior.fonteSig === sig) log('Fertirrigação: sem mudança desde a última publicação.');
        else {
          log('Lendo a planilha de fertirrigação…');
          const X = await carregaXlsx();
          const novo = FertPlanilha.ler(X, await f.arrayBuffer());
          const final = FertPlanilha.mesclar(anterior, novo); final.fonte = f.name; final.fonteSig = sig;
          arquivos.push({ path: ARQ, content: JSON.stringify(await Acesso.encryptJson(final)), dados: final });
          log(`Fertirrigação: cota do dia ${final.cota.data.split('-').reverse().join('/')} gravada · ${Object.keys(final.historico.cotas).length} dia(s) de cota no histórico.`, 'ok');
        }
      }
      // pulverização
      if (achados.pulv && window.PulvPlanilha) {
        const AP = 'pulverizacao.json', f = achados.pulv.f, sig = `${f.name}|${f.lastModified}|${PulvPlanilha.VERSAO}|${window.Pulverizacao ? Pulverizacao.VERSAO : 0}`;
        let anterior = null;
        if (c && c.token) { try { const b = await lerRepoBruto(c, AP); anterior = b ? (await Acesso.readJson(b)).data : null; } catch (e) { if (/token/.test(e.message)) throw e; } }
        if (!anterior) anterior = (window.Pulverizacao && Pulverizacao.dados) || await (async () => { const b = await lerSite(AP); return b ? (await Acesso.readJson(b)).data : null; })();
        if (anterior && anterior.fonteSig === sig) log('Pulverização: sem mudança desde a última publicação.');
        else {
          log('Lendo a planilha dos pulverizadores…');
          const X = await carregaXlsx();
          const novo = PulvPlanilha.ler(X, await f.arrayBuffer());
          const final = PulvPlanilha.mesclar(anterior, novo); final.fonte = f.name; final.fonteSig = sig;
          arquivos.push({ path: AP, content: JSON.stringify(await Acesso.encryptJson(final)), pulv: final });
          log(`Pulverização: status de ${String(final.status.data || '').split('-').reverse().join('/')} · ${final.producao.length} apontamentos de produção · ${final.os.length} OS.`, 'ok');
        }
      }
      // aviação (TRAVICAR)
      if (achados.avi && window.AviPlanilha) {
        const AA = 'aviacao.json', f = achados.avi.f, sig = `${f.name}|${f.lastModified}|${AviPlanilha.VERSAO}|${window.Aviacao ? Aviacao.VERSAO : 0}`;
        let anterior = null;
        if (c && c.token) { try { const b = await lerRepoBruto(c, AA); anterior = b ? (await Acesso.readJson(b)).data : null; } catch (e) { if (/token/.test(e.message)) throw e; } }
        if (!anterior) anterior = (window.Aviacao && Aviacao.dados) || await (async () => { const b = await lerSite(AA); return b ? (await Acesso.readJson(b)).data : null; })();
        if (anterior && anterior.fonteSig === sig) log('Aviação: sem mudança desde a última publicação.');
        else {
          log('Lendo o relatório da TRAVICAR…');
          const X = await carregaXlsx();
          const novo = AviPlanilha.ler(X, await f.arrayBuffer());
          const final = AviPlanilha.mesclar(anterior, novo); final.fonte = f.name; final.fonteSig = sig;
          arquivos.push({ path: AA, content: JSON.stringify(await Acesso.encryptJson(final)), avi: final });
          const cr = novo.correcoes || {};
          log(`Aviação: ${novo.trabalhos.length} trabalhos no relatório · ${final.trabalhos.length} no histórico${cr.repetidos ? ` · ${cr.repetidos} repetido(s) unificado(s)` : ''}.`, 'ok');
        }
      }
      // usuários
      if (achados.usuarios) {
        const f = achados.usuarios.f, sig = `${f.name}|${f.lastModified}`;
        if (S0.usuarios === sig) log('Usuários: sem mudança desde a última publicação.');
        else {
          log('Atualizando os usuários do painel…');
          const r = await atualizarUsuarios(f, c);
          arquivos.push({ path: 'acesso.json', content: JSON.stringify(r.cfg, null, 1) });
          S1.usuarios = sig;
          log(`Usuários: ${r.total} liberado(s)${r.removidos ? `, ${r.removidos} removido(s)` : ''}.`, 'ok');
          r.avisos.forEach(a => log('Usuários: ' + esc(a), 'bad'));
        }
      }
      if (!arquivos.length) { log('Nada a publicar.', 'ok'); return; }
      if (c && c.token) {
        log(`Publicando ${arquivos.map(a => a.path).join(' e ')} em <b>${esc(c.owner + '/' + c.repo)}</b>…`);
        await commit(c, arquivos.map(({ path, content }) => ({ path, content })), `Sincronização: ${arquivos.map(a => a.path).join(', ')} · ${new Date().toLocaleString('pt-BR')}`);
        sigs.set(S1);
        log('Publicado. O site atualiza em 1 a 2 minutos; esta tela já mostra os dados novos.', 'ok');
      } else {
        arquivos.forEach(a => baixar(a.content, a.path));
        sigs.set(S1);
        log(`Sem token do GitHub: baixei ${arquivos.map(a => '<b>' + a.path + '</b>').join(' e ')}. Suba no repositório (Add file → Upload files) ou configure o token no botão do GitHub.`, 'ok');
      }
      const fert = arquivos.find(a => a.dados); if (fert) Fertirrigacao.definir(fert.dados);
      const pz = arquivos.find(a => a.pulv); if (pz && window.Pulverizacao) Pulverizacao.definir(pz.pulv);
      const av = arquivos.find(a => a.avi); if (av && window.Aviacao) Aviacao.definir(av.avi);
      if ((fert || pz || av) && window.Layout && Layout.animar) Layout.animar(document);
    } catch (e) {
      if (e && e.name === 'AbortError') log('Sincronização cancelada.');
      else log('Não foi possível sincronizar: ' + esc(e.message || e), 'bad');
    } finally { RODANDO = false; if (btn) btn.classList.remove('girando'); }
  }

  function ligar() {
    const b = $('#btnSync'), g = $('#btnSyncCfg'), p = $('#btnPastas');
    if (b) b.addEventListener('click', sincronizar);
    if (g) g.addEventListener('click', configurar);
    if (p) p.addEventListener('click', pastas);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ligar); else ligar();
  return { sincronizar, configurar, pastas };
})();
