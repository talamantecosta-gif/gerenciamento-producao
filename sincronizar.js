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
       - "FO.SA.21 - Protocolo de Entrega de OS" → osaerea.json (OS aéreas abertas, na página Aviação;
         só as abas Ordem de servico, Fazendas e Pagina 1 — sem fornecedores, CPF ou nomes)
         (trabalhos acumulados: o histórico fica mesmo que saia do período exportado);
       - "FO.SA.23 - Matriz de Herbicida" → herbicida.json (esperado × realizado das
         operações 2007/2242, fila por frente e ordens de serviço, na página Pulverização);
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
    { tipo: 'osa', rx: /(protocolo.*entrega|fo\.?\s*sa\.?\s*21).*\.xls[xm]?$/i, nome: 'OS aéreas (FO.SA.21)' },
    { tipo: 'abast', rx: /abastec.*\.xls[xm]?$/i, nome: 'Abastecimentos (fertirrigação)' },
    { tipo: 'prep', rx: /informativo.*opera.*\.xls[xm]?$/i, nome: 'Preparo de Solo (Informativo Operacional)' },
    { tipo: 'herb', rx: /(matriz.*herbicida|fo\.?\s*sa\.?\s*23).*\.xls[xmb]?$/i, nome: 'Matriz de Herbicida' },
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
  // Tudo que depende do navegador tem tempo limite: em alguns computadores o banco local (IndexedDB)
  // fica travado (perfil corporativo, dados do site bloqueados, outra aba presa) e a sincronização
  // ficava parada sem mensagem. Agora, se travar, o painel avisa e oferece escolher a pasta/arquivos na hora.
  const comTempo = (p, ms, erro) => Promise.race([p, new Promise((_, nok) => setTimeout(() => nok(new Error(erro || 'tempo esgotado')), ms))]);
  let SEM_BANCO = false, MEM = []; // sem banco local: guarda as pastas só enquanto a página está aberta
  const idb = (modo, fn) => comTempo(new Promise((ok, nok) => {
    const r = indexedDB.open('painel-producao', 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('h')) r.result.createObjectStore('h'); };
    r.onerror = () => nok(r.error);
    r.onblocked = () => nok(new Error('banco local bloqueado por outra aba do painel'));
    r.onsuccess = () => { const db = r.result, fecha = () => { try { db.close(); } catch (e) { /* */ } }; try { const tx = db.transaction('h', modo); const q = fn(tx.objectStore('h')); tx.oncomplete = () => { fecha(); ok(q && q.result); }; tx.onerror = () => { fecha(); nok(tx.error); }; } catch (e) { fecha(); nok(e); } };
  }), 4000, 'o navegador não respondeu ao abrir o banco local');
  const lerPastas = async () => {
    if (SEM_BANCO) return MEM.slice();
    try { const v = await idb('readonly', st => st.get('pastas')); if (Array.isArray(v)) return v; const antiga = await idb('readonly', st => st.get('pasta')); return antiga ? [antiga] : []; }
    catch (e) { SEM_BANCO = true; console.warn('[Sincronizar] banco local indisponível:', e); return MEM.slice(); }
  };
  const gravarPastas = async l => { MEM = l.slice(); if (SEM_BANCO) return null; try { return await idb('readwrite', st => st.put(l, 'pastas')); } catch (e) { SEM_BANCO = true; return null; } };
  const SUPORTA = 'showDirectoryPicker' in window;
  const temPerm = async h => { try { return (await comTempo(h.queryPermission({ mode: 'read' }), 3000)) === 'granted'; } catch (e) { return false; } };
  const pedirPerm = async h => { try { return (await comTempo(h.requestPermission({ mode: 'read' }), 60000)) === 'granted'; } catch (e) { return false; } };
  /** escolher planilhas soltas (sem pasta): funciona em qualquer navegador */
  const escolherArquivos = () => new Promise(ok => { const i = document.createElement('input'); i.type = 'file'; i.multiple = true; i.accept = '.xlsm,.xlsx,.xls,.xlsb'; i.onchange = () => ok([...i.files]); i.addEventListener('cancel', () => ok([])); i.click(); });
  async function adicionarPasta() {
    const h = await window.showDirectoryPicker({ id: 'painel-producao', mode: 'read' });
    const l = await lerPastas();
    for (const x of l) if (x.isSameEntry && await x.isSameEntry(h)) return l;
    l.push(h); await gravarPastas(l); return l;
  }
  // lê o que conseguir: arquivo bloqueado ou subpasta sem acesso é pulado, sem parar a pasta inteira
  async function varrer(dir, nivel, achados, pasta) {
    for await (const [nome, h] of dir.entries()) {
      try {
        if (h.kind === 'file' && !nome.startsWith('~$')) {
          const t = TIPOS.find(t => t.rx.test(nome));
          if (t) { const f = await h.getFile(); (achados.cands = achados.cands || {}); (achados.cands[t.tipo] = achados.cands[t.tipo] || []).push({ f, pasta }); }
        } else if (h.kind === 'directory' && nivel < 1) await varrer(h, nivel + 1, achados, pasta);
      } catch (e) { log(`<b>${esc(nome)}</b> (${esc(pasta)}): sem acesso ou aberto em outro programa — pulei.`, 'bad'); }
    }
  }

  /* Vários arquivos podem ter nome parecido (cópias, "Acompanhamento …" de outra área, "(1).xlsx" baixado).
     Para cada tipo, fica o arquivo mais recente que tem as ABAS certas; os outros são ignorados. */
  const ABAS = {
    fert: n => n.some(x => /^painel$/i.test(x.trim())) && n.some(x => /produ[cç][aã]o\s*turno/i.test(x)),
    pulv: n => n.some(x => /ioa\s*pulve/i.test(x)) && n.some(x => /^tabelas$/i.test(x.trim())),
    avi: n => n.some(x => /trabalho/i.test(x)),
    prep: n => n.some(x => /^form1$/i.test(x.trim())),
    osa: n => n.some(x => /^ordem de servi/i.test(x.trim())) && n.some(x => /^fazendas$/i.test(x.trim())),
    herb: n => n.some(x => /^i\s*-\s*locais de produ/i.test(x.trim())) && n.some(x => /^resumo$/i.test(x.trim())),
    abast: () => true, usuarios: () => true,
  };
  async function escolher(achados) {
    const C = achados.cands || {}; let X = null;
    for (const t of TIPOS) {
      const l = (C[t.tipo] || []).sort((a, b) => b.f.lastModified - a.f.lastModified);
      if (!l.length) continue;
      if (l.length === 1 && ABAS[t.tipo] === ABAS.abast) { achados[t.tipo] = l[0]; continue; }
      for (const c of l) {
        try { X = X || await carregaXlsx(); const nomes = X.read(await c.f.arrayBuffer(), { type: 'array', bookSheets: true }).SheetNames; if (ABAS[t.tipo](nomes)) { achados[t.tipo] = c; break; } log(`<b>${esc(c.f.name)}</b> (${esc(c.pasta)}): não é a planilha de ${esc(t.nome)} (abas diferentes) — ignorei.`); }
        catch (e) { log(`<b>${esc(c.f.name)}</b> (${esc(c.pasta)}): não consegui abrir — pulei.`, 'bad'); }
      }
    }
  }
  const semMudanca = (nome, f) => log(`${nome}: sem mudança — o arquivo <b>${esc(f.name)}</b> (salvo em ${new Date(f.lastModified).toLocaleString('pt-BR')}) é o mesmo já publicado. Alterou a planilha? Salve (Ctrl+S), espere o OneDrive sincronizar e tente de novo.`);

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
  // coluna opcional: quem pode Sincronizar/publicar (Sim/X/1/Editor)
  const COL_EDITOR = ['atualiza painel', 'atualizar painel', 'pode atualizar', 'editor', 'edita', 'publica', 'publicar', 'sincroniza', 'sincronizar'];
  const achaCab = rows => { for (let i = 0; i < Math.min(rows.length, 30); i++) { const h = (rows[i] || []).map(normU); const u = h.findIndex(x => COL_USER.includes(x)), p = h.findIndex(x => COL_SENHA.includes(x)); if (u >= 0 && p >= 0) return { i, u, p, a: h.findIndex(x => COL_ATIVO.includes(x)), e: h.findIndex(x => COL_EDITOR.includes(x)) }; } return null; };
  async function atualizarUsuarios(file, c) {
    const X = await carregaXlsx();
    const wb = X.read(await file.arrayBuffer(), { type: 'array' });
    let tab = null;
    for (const n of wb.SheetNames) { const rows = X.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: null }); const cab = achaCab(rows); if (cab) { tab = { rows, cab }; break; } }
    if (!tab) throw new Error('não encontrei as colunas "Usuário" e "Senha"');
    const inativo = v => /^(nao|n|inativo|bloqueado|desativado|removido|sem acesso|0|false)$/.test(normU(v));
    const lista = new Map(), avisos = [], editores = new Set();
    const ehEditor = v => /^(sim|s|x|1|true|editor|admin|pode|yes)$/.test(normU(v));
    tab.rows.slice(tab.cab.i + 1).forEach((r, k) => {
      const u = String(r[tab.cab.u] ?? '').trim().toLowerCase(); if (!u) return;
      if (tab.cab.a >= 0 && inativo(r[tab.cab.a])) return;
      if (tab.cab.e >= 0 && ehEditor(r[tab.cab.e])) editores.add(u);
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
    if (eu) editores.add(eu);
    // sem a coluna na planilha, mantém a lista de editores que já estava publicada
    if (tab.cab.e >= 0) cfgN = { ...cfgN, editores: await Acesso.encryptJson([...editores].filter(u => lista.has(u) || u === eu)) };
    else if (cfgA.editores) cfgN = { ...cfgN, editores: cfgA.editores };
    return { cfg: cfgN, total: cfgN.usuarios.length, removidos, avisos, editores: tab.cab.e >= 0 ? editores.size : null };
  }

  /* ---------- janelas ---------- */
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const modal = html => { const m = $('#syncModal'); m.innerHTML = `<div class="ft-modal__box">${html}</div>`; m.hidden = false; m.onclick = e => { if (e.target === m || e.target.closest('[data-fechar]')) m.hidden = true; }; return m; };
  const toast = msg => { const t = $('#toast'); if (!t) return; t.textContent = msg; t.classList.add('on'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('on'), 2800); };
  let LOG = null;
  const log = (txt, cls = '') => { if (LOG) { LOG.insertAdjacentHTML('beforeend', `<div class="${cls}">${txt}</div>`); LOG.scrollTop = LOG.scrollHeight; } };

  async function pastas() {
    if (!SUPORTA) { modal(`<h3>Pastas</h3><p>Para ler pastas do computador, abra o painel no <b>Google Chrome</b> ou no <b>Microsoft Edge</b> (no computador).</p><div class="ft-modal__acts"><button class="ft-btn" data-fechar>Fechar</button></div>`); return; }
    modal(`<h3><i class="fa-regular fa-folder-open"></i> Pastas sincronizadas</h3><p>Carregando as pastas vinculadas…</p><div class="ft-modal__acts"><button class="ft-btn" data-fechar>Fechar</button></div>`);
    const l = await lerPastas(), perms = await Promise.all(l.map(temPerm));
    const m = modal(`<h3><i class="fa-regular fa-folder-open"></i> Pastas sincronizadas</h3><p>O painel procura nestas pastas (e numa subpasta abaixo) as planilhas <b>Acompanhamento 2026</b>, <b>Pulverizadores</b>, o relatório da <b>TRAVICAR</b> (relatorio-ciclo-operacao), <b>Abastecimentos</b>, <b>Informativo Operacional Agrícola</b> e <b>Usuários site gerencial</b>. Se o mesmo arquivo estiver em duas pastas, vale o salvo por último.</p>
      ${SEM_BANCO ? '<p style="background:var(--warn-bg);border-radius:10px;padding:8px 10px;font-size:12.5px"><i class="fa-solid fa-triangle-exclamation"></i> Este navegador não deixou o painel guardar as pastas (dados do site bloqueados ou perfil restrito). A pasta escolhida vale só enquanto esta página estiver aberta — ou use <b>Escolher planilhas</b>.</p>' : ''}
      <div class="ft-pastas">${l.length ? l.map((h, i) => `<div class="ft-pasta"><i class="fa-solid fa-folder"></i><b>${esc(h.name)}</b>${perms[i] ? '<span class="ft-tag ok">liberada</span>' : `<button class="ft-btn" data-lib="${i}">Liberar</button>`}<button class="ft-btn" data-rem="${i}" aria-label="Remover ${esc(h.name)}"><i class="fa-solid fa-trash"></i></button></div>`).join('') : '<div class="ft-vazio">Nenhuma pasta vinculada.</div>'}</div>
      <div class="ft-modal__acts"><button class="ft-btn" data-fechar>Fechar</button><button class="ft-btn" id="pArq"><i class="fa-regular fa-file-excel"></i>Escolher planilhas</button><button class="ft-btn" id="pAdd"><i class="fa-solid fa-folder-plus"></i>Adicionar pasta</button><button class="ft-btn pri" id="pSync"><i class="fa-solid fa-rotate"></i>Sincronizar</button></div>`);
    m.querySelector('#pAdd').onclick = async () => { try { await adicionarPasta(); } catch (e) { if (e && e.name !== 'AbortError') toast('Não consegui abrir a pasta: ' + (e.message || e)); } pastas(); };
    m.querySelector('#pArq').onclick = async () => { const fs = await escolherArquivos(); if (fs.length) sincronizar(fs); };
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
  async function sincronizar(manuais) {
    if (!Array.isArray(manuais)) manuais = null; // clique no botão passa um evento
    if (RODANDO) { const m = $('#syncModal'); if (m && m.hidden) RODANDO = false; else return; } // modal fechado = libera nova tentativa
    RODANDO = true;
    const btn = $('#btnSync'); if (btn) btn.classList.add('girando');
    const m = modal(`<h3><i class="fa-solid fa-rotate"></i> Sincronizar</h3><p>Lendo as pastas e publicando o que mudou.</p><div class="ft-modal__log" id="syncLog"></div><div class="ft-modal__acts"><button class="ft-btn" id="sArq"><i class="fa-regular fa-file-excel"></i>Escolher planilhas</button><button class="ft-btn" id="sPastas"><i class="fa-regular fa-folder-open"></i>Pastas</button><button class="ft-btn" data-fechar>Fechar</button></div>`);
    LOG = m.querySelector('#syncLog'); m.querySelector('#sPastas').onclick = () => { RODANDO = false; pastas(); };
    m.querySelector('#sArq').onclick = async () => { const fs = await escolherArquivos(); if (fs.length) { RODANDO = false; sincronizar(fs); } };
    try {
      if (!window.Acesso || !Acesso.unlocked) throw new Error('entre com seu usuário antes de sincronizar.');
      const achados = {};
      const porArquivos = fs => fs.forEach(f => { const t = TIPOS.find(t => t.rx.test(f.name)); if (t) { (achados.cands = achados.cands || {}); (achados.cands[t.tipo] = achados.cands[t.tipo] || []).push({ f, pasta: 'arquivo escolhido' }); } else log(`<b>${esc(f.name)}</b>: não reconheci essa planilha pelo nome.`, 'bad'); });
      if (manuais) { log(`Planilhas escolhidas: ${manuais.length}.`); porArquivos(manuais); }
      else if (SUPORTA) {
        log('Procurando as pastas vinculadas…');
        let l = await lerPastas();
        if (SEM_BANCO) log('Este navegador não deixou o painel guardar as pastas (dados do site bloqueados ou perfil restrito). Escolha a pasta agora ou use <b>Escolher planilhas</b>.', 'bad');
        if (!l.length) {
          log('Nenhuma pasta vinculada: escolha a pasta das planilhas…');
          try { l = await adicionarPasta(); }
          catch (e) {
            if (e && e.name === 'AbortError') throw e;
            throw new Error('o navegador não abriu a janela de pastas (' + (e.message || e) + '). Clique em <b>Pastas → Adicionar pasta</b> ou em <b>Escolher planilhas</b>.');
          }
        }
        for (const h of l) {
          if (!(await temPerm(h)) && !(await pedirPerm(h))) { log(`Pasta <b>${esc(h.name)}</b>: sem permissão de leitura (use Pastas → Liberar).`, 'bad'); continue; }
          try { await varrer(h, 0, achados, h.name); log(`Pasta <b>${esc(h.name)}</b> lida.`); } catch (e) { log(`Pasta <b>${esc(h.name)}</b>: não consegui ler (${esc(e.message || e)}).`, 'bad'); }
        }
      } else {
        log('Este navegador não abre pastas: clique em <b>Escolher planilhas</b> e marque as que você tem (pode marcar várias).');
        porArquivos(await escolherArquivos());
      }
      await escolher(achados);
      const vistas = TIPOS.filter(t => achados[t.tipo] && !(t.tipo === 'usuarios' && window.Layout && !Layout.admin()));
      vistas.forEach(t => { const a = achados[t.tipo]; log(`${t.nome}: <b>${esc(a.f.name)}</b> (${esc(a.pasta)}) · salva em ${new Date(a.f.lastModified).toLocaleString('pt-BR')}`); });
      const fora = TIPOS.filter(t => !achados[t.tipo] && !(t.tipo === 'usuarios' && window.Layout && !Layout.admin()));
      if (fora.length && vistas.length) log(`Não estão nas suas pastas: ${fora.map(t => t.nome).join(', ')}. Essas partes do painel continuam como estão.`);
      if (!vistas.length) throw new Error('nenhuma planilha encontrada. Confira no botão <b>Pastas</b> ou use <b>Escolher planilhas</b>.');

      const c = await cfg.get(), S0 = sigs.get(), S1 = { ...S0 }, arquivos = [];
      // cada planilha é independente: se uma falhar (sem acesso, aberta/bloqueada, formato diferente),
      // as outras continuam e o que deu certo é publicado; a que falhou mantém o que já estava no painel.
      const falhas = [];
      const etapa = async (nome, fn) => { try { await fn(); } catch (e) { if (e && /token|GitHub/.test(e.message || '')) throw e; falhas.push(nome); log(`${nome}: não consegui atualizar (${esc((e && e.message) || e)}). O painel mantém o que já estava publicado.`, 'bad'); } };
      // fertirrigação
      if (achados.fert) await etapa('Fertirrigação', async () => {
        const f = achados.fert.f, sig = `${f.name}|${f.lastModified}|${FertPlanilha.VERSAO}|${Fertirrigacao.VERSAO}`;
        let anterior = null;
        if (c && c.token) { try { const b = await lerRepoBruto(c, ARQ); anterior = b ? (await Acesso.readJson(b)).data : null; } catch (e) { if (/token/.test(e.message)) throw e; } }
        if (!anterior) anterior = Fertirrigacao.dados || await (async () => { const b = await lerSite(ARQ); return b ? (await Acesso.readJson(b)).data : null; })();
        if (anterior && anterior.fonteSig === sig) semMudanca('Fertirrigação', f);
        else {
          log('Lendo a planilha de fertirrigação…');
          const X = await carregaXlsx();
          const novo = FertPlanilha.ler(X, await f.arrayBuffer());
          const final = FertPlanilha.mesclar(anterior, novo); final.fonte = f.name; final.fonteSig = sig;
          arquivos.push({ path: ARQ, content: JSON.stringify(await Acesso.encryptJson(final)), dados: final });
          log(`Fertirrigação: cota do dia ${final.cota.data.split('-').reverse().join('/')} gravada · ${Object.keys(final.historico.cotas).length} dia(s) de cota no histórico.`, 'ok');
        }
      });
      // pulverização
      if (achados.pulv && window.PulvPlanilha) await etapa('Pulverização', async () => {
        const AP = 'pulverizacao.json', f = achados.pulv.f, sig = `${f.name}|${f.lastModified}|${PulvPlanilha.VERSAO}|${window.Pulverizacao ? Pulverizacao.VERSAO : 0}`;
        let anterior = null;
        if (c && c.token) { try { const b = await lerRepoBruto(c, AP); anterior = b ? (await Acesso.readJson(b)).data : null; } catch (e) { if (/token/.test(e.message)) throw e; } }
        if (!anterior) anterior = (window.Pulverizacao && Pulverizacao.dados) || await (async () => { const b = await lerSite(AP); return b ? (await Acesso.readJson(b)).data : null; })();
        if (anterior && anterior.fonteSig === sig) semMudanca('Pulverização', f);
        else {
          log('Lendo a planilha dos pulverizadores…');
          const X = await carregaXlsx();
          const novo = PulvPlanilha.ler(X, await f.arrayBuffer());
          const final = PulvPlanilha.mesclar(anterior, novo); final.fonte = f.name; final.fonteSig = sig;
          arquivos.push({ path: AP, content: JSON.stringify(await Acesso.encryptJson(final)), pulv: final });
          log(`Pulverização: status de ${String(final.status.data || '').split('-').reverse().join('/')} · ${final.producao.length} apontamentos de produção.`, 'ok');
        }
      });
      // aviação (TRAVICAR)
      if (achados.avi && window.AviPlanilha) await etapa('Aviação', async () => {
        const AA = 'aviacao.json', f = achados.avi.f, sig = `${f.name}|${f.lastModified}|${AviPlanilha.VERSAO}|${window.Aviacao ? Aviacao.VERSAO : 0}`;
        let anterior = null;
        if (c && c.token) { try { const b = await lerRepoBruto(c, AA); anterior = b ? (await Acesso.readJson(b)).data : null; } catch (e) { if (/token/.test(e.message)) throw e; } }
        if (!anterior) anterior = (window.Aviacao && Aviacao.dados) || await (async () => { const b = await lerSite(AA); return b ? (await Acesso.readJson(b)).data : null; })();
        if (anterior && anterior.fonteSig === sig) semMudanca('Aviação', f);
        else {
          log('Lendo o relatório da TRAVICAR…');
          const X = await carregaXlsx();
          const novo = AviPlanilha.ler(X, await f.arrayBuffer());
          const final = AviPlanilha.mesclar(anterior, novo); final.fonte = f.name; final.fonteSig = sig;
          arquivos.push({ path: AA, content: JSON.stringify(await Acesso.encryptJson(final)), avi: final });
          const cr = novo.correcoes || {};
          log(`Aviação: ${novo.trabalhos.length} trabalhos no relatório · ${final.trabalhos.length} no histórico${cr.repetidos ? ` · ${cr.repetidos} repetido(s) unificado(s)` : ''}.`, 'ok');
        }
      });
      // abastecimentos dos aplicadores / carregamentos dos caminhões (fechamento de turno da fertirrigação)
      if (achados.abast && window.AbastPlanilha) await etapa('Abastecimentos', async () => {
        const AQ = 'abastecimentos.json', f = achados.abast.f, sig = `${f.name}|${f.lastModified}|${AbastPlanilha.VERSAO}`;
        let anterior = null;
        if (c && c.token) { try { const b = await lerRepoBruto(c, AQ); anterior = b ? (await Acesso.readJson(b)).data : null; } catch (e) { if (/token/.test(e.message)) throw e; } }
        if (!anterior) anterior = Fertirrigacao.abast || await (async () => { const b = await lerSite(AQ); return b ? (await Acesso.readJson(b)).data : null; })();
        if (anterior && anterior.fonteSig === sig) semMudanca('Abastecimentos', f);
        else {
          log('Lendo a planilha de abastecimentos…');
          const X = await carregaXlsx();
          const novo = AbastPlanilha.ler(X, await f.arrayBuffer());
          const final = AbastPlanilha.mesclar(anterior, novo); final.fonte = f.name; final.fonteSig = sig;
          arquivos.push({ path: AQ, content: JSON.stringify(await Acesso.encryptJson(final)), abast: final });
          const dias = [...new Set(novo.registros.map(r => r.d.split('-').reverse().slice(0, 2).join('/') + ' ' + r.t))].sort((x, y) => x.slice(3, 5).localeCompare(y.slice(3, 5)) || x.localeCompare(y));
          log(`Abastecimentos: ${novo.registros.filter(r => r.tipo === 'abast').length} abastecimentos e ${novo.registros.filter(r => r.tipo === 'carreg').length} carregamentos · ${dias.join(', ')} (turno C após 00h conta no dia em que começou).`, 'ok');
        }
      });
      // preparo de solo (Informativo Operacional Agrícola · Forms)
      if (achados.prep && window.PrepPlanilha) await etapa('Preparo de Solo', async () => {
        const AR = 'preparo.json', f = achados.prep.f, sig = `${f.name}|${f.lastModified}|${PrepPlanilha.VERSAO}|${window.Preparo ? Preparo.VERSAO : 0}`;
        let anterior = null;
        if (c && c.token) { try { const b = await lerRepoBruto(c, AR); anterior = b ? (await Acesso.readJson(b)).data : null; } catch (e) { if (/token/.test(e.message)) throw e; } }
        if (!anterior) anterior = (window.Preparo && Preparo.dados) || await (async () => { const b = await lerSite(AR); return b ? (await Acesso.readJson(b)).data : null; })();
        if (anterior && anterior.fonteSig === sig) semMudanca('Preparo de Solo', f);
        else {
          log('Lendo o Informativo Operacional (preparo de solo)…');
          const X = await carregaXlsx();
          const novo = PrepPlanilha.ler(X, await f.arrayBuffer());
          const final = PrepPlanilha.mesclar(anterior, novo); final.fonte = f.name; final.fonteSig = sig;
          arquivos.push({ path: AR, content: JSON.stringify(await Acesso.encryptJson(final)), prep: final });
          const cr = novo.correcoes || {}, ult = final.registros.length ? final.registros[final.registros.length - 1].d.split('-').reverse().join('/') : '—';
          log(`Preparo de Solo: ${final.registros.length} apontamentos até ${ult}${cr.repetidos ? ` · ${cr.repetidos} repetido(s) unificado(s)` : ''}${final.conferir.length ? ` · ${final.conferir.length} para conferir` : ''}.`, 'ok');
        }
      });
      // OS aéreas (FO.SA.21 · protocolo de entrega de OS) → página Aviação
      if (achados.osa && window.OsAereaPlanilha) await etapa('OS aéreas', async () => {
        const AO = 'osaerea.json', f = achados.osa.f, sig = `${f.name}|${f.lastModified}|${OsAereaPlanilha.VERSAO}|${window.AviOS ? AviOS.VERSAO : 0}`;
        let anterior = null;
        if (c && c.token) { try { const b = await lerRepoBruto(c, AO); anterior = b ? (await Acesso.readJson(b)).data : null; } catch (e) { if (/token/.test(e.message)) throw e; } }
        if (!anterior) anterior = (window.AviOS && AviOS.dados) || await (async () => { const b = await lerSite(AO); return b ? (await Acesso.readJson(b)).data : null; })();
        if (anterior && anterior.fonteSig === sig) semMudanca('OS aéreas', f);
        else {
          const X = await carregaXlsx();
          const novo = OsAereaPlanilha.ler(X, await f.arrayBuffer());
          const final = OsAereaPlanilha.mesclar(anterior, novo); final.fonte = f.name; final.fonteSig = sig;
          arquivos.push({ path: AO, content: JSON.stringify(await Acesso.encryptJson(final)), osa: final });
          const ha = final.os.reduce((a, o) => a + o.ha, 0);
          log(`OS aéreas: ${final.os.length} OS abertas · ${Math.round(ha).toLocaleString('pt-BR')} ha${final.protocolo ? ` · último protocolo com ${final.protocolo.os.length} OS` : ''}.`, 'ok');
        }
      });
      // matriz de herbicida (FO.SA.23) → planejamento de herbicidas e OS na página Pulverização
      if (achados.herb && window.HerbPlanilha) await etapa('Matriz de Herbicida', async () => {
        const AH = 'herbicida.json', f = achados.herb.f, sig = `${f.name}|${f.lastModified}|${HerbPlanilha.VERSAO}|${window.Pulverizacao ? Pulverizacao.VERSAO : 0}`;
        let anterior = null;
        if (c && c.token) { try { const b = await lerRepoBruto(c, AH); anterior = b ? (await Acesso.readJson(b)).data : null; } catch (e) { if (/token/.test(e.message)) throw e; } }
        if (!anterior) anterior = (window.Pulverizacao && Pulverizacao.herb) || await (async () => { const b = await lerSite(AH); return b ? (await Acesso.readJson(b)).data : null; })();
        if (anterior && anterior.fonteSig === sig) semMudanca('Matriz de Herbicida', f);
        else {
          log('Lendo a Matriz de Herbicida (pode levar alguns segundos)…');
          const X = await carregaXlsx();
          const novo = HerbPlanilha.ler(X, await f.arrayBuffer());
          const final = HerbPlanilha.mesclar(anterior, novo); final.fonte = f.name; final.fonteSig = sig;
          arquivos.push({ path: AH, content: JSON.stringify(await Acesso.encryptJson(final)), herb: final });
          const o7 = final.ops['2007'], ab = (final.os || []).filter(o => o.sit === 'A').length;
          log(`Matriz de Herbicida: ${o7 ? `2007 com ${Math.round(o7.r).toLocaleString('pt-BR')} de ${Math.round(o7.tot).toLocaleString('pt-BR')} ha realizados · ` : ''}${final.fila.length} aplicações na fila · ${ab} OS abertas de ${(final.os || []).length}.`, 'ok');
        }
      });
      // usuários
      if (achados.usuarios && window.Layout && !Layout.admin()) log('Usuários: só o administrador do painel atualiza os acessos — planilha ignorada.');
      else if (achados.usuarios) await etapa('Usuários', async () => {
        const f = achados.usuarios.f, sig = `${f.name}|${f.lastModified}|editores`; // '|editores': força reler a planilha uma vez com a coluna Atualiza painel
        if (S0.usuarios === sig) log('Usuários: sem mudança desde a última publicação.');
        else {
          log('Atualizando os usuários do painel…');
          const r = await atualizarUsuarios(f, c);
          arquivos.push({ path: 'acesso.json', content: JSON.stringify(r.cfg, null, 1) });
          S1.usuarios = sig;
          log(`Usuários: ${r.total} liberado(s)${r.removidos ? `, ${r.removidos} removido(s)` : ''}${r.editores != null ? ` · ${r.editores} podem atualizar o painel` : ''}.`, 'ok');
          r.avisos.forEach(a => log('Usuários: ' + esc(a), 'bad'));
        }
      });
      if (!arquivos.length) { log(falhas.length ? 'Nada novo para publicar.' : 'Nada a publicar: tudo já está atualizado.', 'ok'); return; }
      if (c && c.token) {
        log(`Publicando ${arquivos.map(a => a.path).join(' e ')} em <b>${esc(c.owner + '/' + c.repo)}</b>…`);
        await commit(c, arquivos.map(({ path, content }) => ({ path, content })), `Sincronização: ${arquivos.map(a => a.path).join(', ')} · ${new Date().toLocaleString('pt-BR')}`);
        sigs.set(S1);
        log(`Publicado${falhas.length ? ` (exceto ${falhas.join(', ')})` : ''}. O site atualiza em 1 a 2 minutos; esta tela já mostra os dados novos.`, 'ok');
      } else {
        arquivos.forEach(a => baixar(a.content, a.path));
        sigs.set(S1);
        log(`Sem token do GitHub: baixei ${arquivos.map(a => '<b>' + a.path + '</b>').join(' e ')}. Suba no repositório (Add file → Upload files) ou configure o token no botão do GitHub.`, 'ok');
      }
      const fert = arquivos.find(a => a.dados); if (fert) Fertirrigacao.definir(fert.dados);
      const pz = arquivos.find(a => a.pulv); if (pz && window.Pulverizacao) Pulverizacao.definir(pz.pulv);
      const av = arquivos.find(a => a.avi); if (av && window.Aviacao) Aviacao.definir(av.avi);
      const oa = arquivos.find(a => a.osa); if (oa && window.AviOS) AviOS.definir(oa.osa); else if (av && window.AviOS) AviOS.aoEntrar();
      const ab = arquivos.find(a => a.abast); if (ab) Fertirrigacao.definirAbast(ab.abast);
      const pp = arquivos.find(a => a.prep); if (pp && window.Preparo) Preparo.definir(pp.prep);
      const hb = arquivos.find(a => a.herb); if (hb && window.Pulverizacao) Pulverizacao.definirHerb(hb.herb);
      if ((fert || pz || av || pp || hb || oa) && window.Layout && Layout.animar) Layout.animar(document);
    } catch (e) {
      if (e && e.name === 'AbortError') log('Sincronização cancelada.');
      else { console.error('[Sincronizar]', e); log('Não foi possível sincronizar: ' + esc((e && e.message) || e).replace(/&lt;(\/?)b&gt;/g, '<$1b>'), 'bad'); }
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
