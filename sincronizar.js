/* =========================================================================
   Sincronizar pasta → GitHub (painel Gerenciamento Produção)
   -------------------------------------------------------------------------
   1. Lê a pasta vinculada (fica guardada no navegador) e acha a planilha
      "Acompanhamento 2026.xlsm" (nome com "acompanhamento" ou "fertirriga").
   2. Lê a planilha no próprio navegador (SheetJS) com FertPlanilha.ler().
   3. Junta com o que já está publicado (mantém o histórico da cota, do PAINEL
      e dos fechamentos), criptografa com a chave do painel e publica
      fertirrigacao.json num único commit (token do usuário, salvo protegido).
   4. Sem token: baixa o fertirrigacao.json pronto para subir à mão.
   Só sincroniza no clique do botão. Só o editor vê os botões.
   ========================================================================= */
window.Sincronizar = (function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const ARQ = 'fertirrigacao.json';
  const PADRAO = { owner: 'talamantecosta-gif', repo: 'gerenciamento-producao', branch: 'main' };
  const CFG_KEY = 'painel-github-producao', CFG_AGR = 'painel-github'; // o token do painel-agricola é reaproveitado (mesmo domínio e mesma chave)
  const RX_PLAN = /(acompanhamento|fertirriga).*\.xls[xm]$/i;

  /* ---------- configuração protegida ---------- */
  const lerCfg = async k => { try { const s = localStorage.getItem(k); if (!s) return null; const o = JSON.parse(s); return Acesso.isProtected(o) ? await Acesso.decryptJson(o) : null; } catch (e) { return null; } };
  const cfg = {
    async get() { const p = await lerCfg(CFG_KEY); if (p) return p; const a = await lerCfg(CFG_AGR); return a && a.token ? { ...PADRAO, token: a.token, herdado: true } : null; },
    async set(v) { try { if (!v) localStorage.removeItem(CFG_KEY); else localStorage.setItem(CFG_KEY, JSON.stringify(await Acesso.encryptJson(v))); } catch (e) { /* sem storage */ } },
  };

  /* ---------- pasta vinculada (o navegador guarda só a autorização) ---------- */
  const idb = (modo, fn) => new Promise((ok, nok) => {
    const r = indexedDB.open('painel-producao', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('h');
    r.onerror = () => nok(r.error);
    r.onsuccess = () => { try { const tx = r.result.transaction('h', modo); const q = fn(tx.objectStore('h')); tx.oncomplete = () => ok(q && q.result); tx.onerror = () => nok(tx.error); } catch (e) { nok(e); } };
  });
  const pastaGuardada = () => idb('readonly', st => st.get('pasta')).catch(() => null);
  const guardarPasta = h => idb('readwrite', st => st.put(h, 'pasta')).catch(() => null);
  const permissao = async (h, pedir) => { if (!h) return false; const o = { mode: 'read' }; if ((await h.queryPermission(o)) === 'granted') return true; return pedir ? (await h.requestPermission(o)) === 'granted' : false; };
  async function acharPlanilha(dir, nivel = 0, achados = []) {
    for await (const [nome, h] of dir.entries()) {
      if (h.kind === 'file' && RX_PLAN.test(nome) && !nome.startsWith('~$')) achados.push(await h.getFile());
      else if (h.kind === 'directory' && nivel < 1) await acharPlanilha(h, nivel + 1, achados);
    }
    return achados.sort((a, b) => b.lastModified - a.lastModified)[0] || null;
  }
  const escolherArquivo = () => new Promise(ok => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.xlsm,.xlsx'; i.onchange = () => ok(i.files[0] || null); i.click(); });

  /* ---------- GitHub (API) ---------- */
  const gh = async (c, metodo, rota, corpo) => {
    const r = await fetch(`https://api.github.com/repos/${c.owner}/${c.repo}${rota}`, {
      method: metodo, cache: 'no-store', body: corpo ? JSON.stringify(corpo) : undefined,
      headers: { Authorization: `Bearer ${c.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
    });
    if (r.status === 404 && metodo === 'GET') return null;
    if (!r.ok) {
      let msg = ''; try { msg = (await r.json()).message || ''; } catch (e) { /* */ }
      if (r.status === 401) throw new Error('o GitHub recusou o token (expirado ou inválido). Gere um novo em Configurar GitHub.');
      if (r.status === 403 || r.status === 404) throw new Error(`o token não tem acesso de escrita ao repositório ${c.owner}/${c.repo} (Contents: Read and write).`);
      throw new Error(`GitHub respondeu ${r.status}${msg ? ': ' + msg : ''}`);
    }
    return r.status === 204 ? null : r.json();
  };
  const b64utf8 = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), ch => ch.charCodeAt(0)));
  const lerRepo = async (c, path) => { const x = await gh(c, 'GET', `/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(c.branch)}`); if (!x || !x.content) return null; return (await Acesso.readJson(JSON.parse(b64utf8(x.content)))).data; };
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
  const lerSite = async p => { try { const r = await fetch(p, { cache: 'no-store' }); if (!r.ok) return null; return (await Acesso.readJson(await r.json())).data; } catch (e) { return null; } };
  const carregaXlsx = () => new Promise((ok, nok) => {
    if (window.XLSX) return ok(window.XLSX);
    const sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    sc.onload = () => ok(window.XLSX); sc.onerror = () => nok(new Error('o leitor de planilhas não carregou (verifique a internet)'));
    document.head.appendChild(sc);
  });
  const baixar = (texto, nome) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([texto], { type: 'application/json' })); a.download = nome; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); };

  /* ---------- janela de progresso / configuração ---------- */
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const modal = html => { const m = $('#syncModal'); m.innerHTML = `<div class="ft-modal__box">${html}</div>`; m.hidden = false; m.onclick = e => { if (e.target === m || e.target.closest('[data-fechar]')) m.hidden = true; }; return m; };
  let LOG = null;
  const log = (txt, cls = '') => { if (LOG) { LOG.insertAdjacentHTML('beforeend', `<div class="${cls}">${txt}</div>`); LOG.scrollTop = LOG.scrollHeight; } const t = $('#syncTip'); if (t) t.textContent = txt.replace(/<[^>]+>/g, ''); };

  async function configurar() {
    const c = (await cfg.get()) || PADRAO;
    const m = modal(`<h3><i class="fa-brands fa-github"></i> Publicação no GitHub</h3><p>O token fica guardado protegido pela sua senha, só neste navegador, e só é enviado para api.github.com. No GitHub → Settings → Developer settings → Fine-grained tokens, dê acesso ao repositório do painel com <b>Contents: Read and write</b>.</p>
      <label>Repositório (dono/nome)</label><input id="cfgRepo" value="${esc(c.owner + '/' + c.repo)}">
      <label>Branch</label><input id="cfgBranch" value="${esc(c.branch || 'main')}">
      <label>Token${c.herdado ? ' (reaproveitado do painel-agricola)' : ''}</label><input id="cfgTok" type="password" autocomplete="off" placeholder="${c.token ? 'token salvo — deixe em branco para manter' : 'github_pat_…'}">
      <div class="ft-modal__acts"><button class="ft-btn" data-fechar>Cancelar</button><button class="ft-btn" id="cfgApagar">Apagar token</button><button class="ft-btn pri" id="cfgSalvar">Salvar</button></div>`);
    m.querySelector('#cfgSalvar').onclick = async () => {
      const [owner, repo] = m.querySelector('#cfgRepo').value.trim().split('/');
      if (!owner || !repo) return;
      const token = m.querySelector('#cfgTok').value.trim() || c.token || '';
      await cfg.set({ owner, repo, branch: m.querySelector('#cfgBranch').value.trim() || 'main', token });
      m.hidden = true; toast('Configuração salva.');
    };
    m.querySelector('#cfgApagar').onclick = async () => { await cfg.set(null); m.hidden = true; toast('Token apagado deste navegador.'); };
  }
  const toast = msg => { const t = $('#toast'); if (!t) return; t.textContent = msg; t.classList.add('on'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('on'), 2800); };

  let RODANDO = false;
  async function sincronizar() {
    if (RODANDO) return; RODANDO = true;
    const btn = $('#btnSync'); if (btn) btn.classList.add('girando');
    const m = modal(`<h3><i class="fa-solid fa-rotate"></i> Sincronizar</h3><p>Lendo a planilha da pasta e publicando no painel.</p><div class="ft-modal__log" id="syncLog"></div><div class="ft-modal__acts"><button class="ft-btn" data-fechar>Fechar</button></div>`);
    LOG = m.querySelector('#syncLog');
    try {
      if (!window.Acesso || !Acesso.unlocked) throw new Error('entre com seu usuário antes de sincronizar.');
      // 1. planilha
      let arq = null;
      if ('showDirectoryPicker' in window) {
        let pasta = await pastaGuardada();
        if (!(await permissao(pasta, true))) { log('Escolha a pasta onde fica a planilha…'); pasta = await window.showDirectoryPicker({ id: 'painel-producao', mode: 'read' }); await guardarPasta(pasta); }
        log(`Pasta: <b>${esc(pasta.name)}</b>`);
        arq = await acharPlanilha(pasta);
        if (!arq) throw new Error('não achei a planilha na pasta (o nome precisa ter "Acompanhamento" ou "Fertirrigação" e ser .xlsm/.xlsx).');
      } else {
        log('Este navegador não abre pastas: escolha a planilha.');
        arq = await escolherArquivo(); if (!arq) throw new Error('nenhuma planilha escolhida.');
      }
      log(`Planilha: <b>${esc(arq.name)}</b> · salva em ${new Date(arq.lastModified).toLocaleString('pt-BR')}`);
      const sig = `${arq.name}|${arq.lastModified}|${FertPlanilha.VERSAO}|${Fertirrigacao.VERSAO}`;
      const c = await cfg.get();
      // 2. versão publicada (para manter o histórico)
      let anterior = null;
      if (c && c.token) { log('Buscando o histórico publicado no GitHub…'); anterior = await lerRepo(c, ARQ).catch(() => null); }
      if (!anterior) anterior = Fertirrigacao.dados || await lerSite(ARQ);
      if (anterior && anterior.fonteSig === sig) { log('Nada a publicar: a planilha não mudou desde a última sincronização.', 'ok'); return; }
      // 3. leitura e junção
      log('Lendo a planilha…');
      const X = await carregaXlsx();
      const novo = FertPlanilha.ler(X, await arq.arrayBuffer());
      novo.fonte = arq.name; novo.fonteSig = sig;
      const final = FertPlanilha.mesclar(anterior, novo);
      final.fonte = arq.name; final.fonteSig = sig;
      log(`Cota do dia ${final.cota.data.split('-').reverse().join('/')} gravada · ${Object.keys(final.historico.cotas).length} dia(s) de cota no histórico · ${final.producao.length} apontamentos de produção.`);
      const conteudo = JSON.stringify(await Acesso.encryptJson(final));
      // 4. publicação
      if (c && c.token) {
        log(`Publicando em <b>${esc(c.owner + '/' + c.repo)}</b>…`);
        await commit(c, [{ path: ARQ, content: conteudo }], `Fertirrigação: planilha de ${new Date(arq.lastModified).toLocaleDateString('pt-BR')} (cota do dia ${final.cota.data.split('-').reverse().join('/')})`);
        log('Publicado. O site atualiza em 1 a 2 minutos; esta tela já mostra os dados novos.', 'ok');
      } else {
        baixar(conteudo, ARQ);
        log('Sem token do GitHub: baixei o <b>fertirrigacao.json</b> criptografado. Suba no repositório (Add file → Upload files) ou configure o token no botão do GitHub.', 'ok');
      }
      Fertirrigacao.definir(final);
      if (window.Layout && Layout.animar) Layout.animar(document);
    } catch (e) {
      if (e && e.name === 'AbortError') log('Sincronização cancelada.');
      else log('Não foi possível sincronizar: ' + esc(e.message || e), 'bad');
    } finally {
      RODANDO = false; if (btn) btn.classList.remove('girando');
      const t = $('#syncTip'); if (t) setTimeout(() => { t.textContent = 'Sincronizar pasta'; }, 4000);
    }
  }

  function ligar() {
    const b = $('#btnSync'), g = $('#btnSyncCfg');
    if (b) b.addEventListener('click', sincronizar);
    if (g) g.addEventListener('click', configurar);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ligar); else ligar();
  return { sincronizar, configurar };
})();
