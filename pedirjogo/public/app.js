// Front-end sem framework e sem build: DOM puro + fetch + Server-Sent Events.
// Todo texto vindo da Steam/usuários entra via textContent (nada de innerHTML) para evitar XSS.

const state = {
  me: { user: null, isAdmin: false, providers: [], bots: {} },
  status: 'pendente',
  games: [],
  highlight: Number(new URLSearchParams(location.search).get('jogo')) || null,
};

const $ = (sel) => document.querySelector(sel);
const fmt = new Intl.NumberFormat('pt-BR');
const fmtCompact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

/** Cria elementos: h('div', { class: 'x', onclick: fn }, 'texto', filho) */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'src' && tag === 'img') {
      el.src = value;
      // Imagem da Steam fora do ar? Some com ela e fica só o fundo do placeholder.
      el.addEventListener('error', () => { el.style.visibility = 'hidden'; }, { once: true });
    }
    else if (key === 'class') el.className = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

// ------------------------------------------------------------------ API

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: method === 'GET' ? {} : { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : method === 'GET' ? undefined : '{}',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Erro ${res.status}`);
    err.code = data?.error?.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

// ------------------------------------------------------------------ autenticação

const ICONS = {
  twitch: 'M4.3 3 3 6.4v13.4h4.6V22h2.6l2.4-2.3h3.7l5-5V3H4.3Zm15.6 10.9-2.9 2.9h-4.6l-2.4 2.4v-2.4H6.1V4.8h13.8v9.1ZM17 7.6h-1.8v5.2H17V7.6Zm-4.9 0h-1.8v5.2h1.8V7.6Z',
  discord: 'M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.3 18.3 0 0 0-5.5 0L8.6 3a19.7 19.7 0 0 0-4.9 1.5C.6 9.1-.3 13.6.1 18.1a19.9 19.9 0 0 0 6 3l1.3-2.1a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4a12.8 12.8 0 0 1-2 1l1.3 2.1a19.8 19.8 0 0 0 6-3c.5-5.2-.8-9.7-3.6-13.7ZM8 15.3c-1.2 0-2.2-1.1-2.2-2.4S6.8 10.5 8 10.5s2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z',
};

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[name]);
  svg.append(path);
  return svg;
}

function loginUrl(provider) {
  return `/auth/${provider}?returnTo=${encodeURIComponent(location.pathname + location.search)}`;
}

function renderAuth() {
  const el = $('#auth');
  el.replaceChildren();
  const { user, isAdmin, providers } = state.me;

  if (user) {
    el.append(
      h('span', { class: 'user-chip' },
        user.avatarUrl ? h('img', { src: user.avatarUrl, alt: '' }) : null,
        user.displayName,
        isAdmin ? h('span', { class: 'badge' }, 'streamer') : null,
      ),
      h('button', { class: 'btn ghost', onclick: logout }, 'Sair'),
    );
  } else if (providers.length) {
    for (const p of providers) {
      el.append(h('a', { class: `btn ${p}`, href: loginUrl(p) }, icon(p), `Entrar com ${p === 'twitch' ? 'Twitch' : 'Discord'}`));
    }
  } else {
    el.append(h('span', { class: 'hints' }, 'Login não configurado (veja o .env)'));
  }

  document.querySelectorAll('.admin-only').forEach((node) => { node.hidden = !isAdmin; });

  const hints = $('#bot-hints');
  hints.replaceChildren();
  const parts = [];
  if (state.me.bots.twitch) parts.push(['No chat da Twitch: ', h('code', {}, '!pedirjogo nome do jogo')]);
  if (state.me.bots.discord) parts.push(['No Discord: ', h('code', {}, '/pedirjogo')]);
  parts.forEach((p, i) => hints.append(...(i ? [' · '] : []), ...p));
}

async function logout() {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  state.me.user = null;
  state.me.isAdmin = false;
  renderAuth();
  loadGames();
}

function requireLogin() {
  if (state.me.user) return true;
  const p = state.me.providers[0];
  toast(p ? 'Entre com Twitch ou Discord para votar' : 'Login não está configurado', true);
  return false;
}

// ------------------------------------------------------------------ votos

async function vote(appid, { remove = false } = {}) {
  if (!requireLogin()) return;
  try {
    const data = await api(`/api/games/${appid}/vote`, { method: remove ? 'DELETE' : 'POST' });
    if (remove) toast('Voto removido');
    else if (data.created) toast(`${data.game.name} entrou na fila! 🎉`);
    else if (data.alreadyVoted) toast('Você já tinha votado nesse 😉');
    else toast(`Voto registrado em ${data.game.name}`);
    closeSearch();
    if (!remove) state.highlight = appid;
    await loadGames();
  } catch (err) {
    if (err.status === 401) state.me.user = null;
    toast(err.message, true);
  }
}

async function setStatus(appid, status) {
  try {
    await api(`/api/games/${appid}`, { method: 'PATCH', body: { status } });
    toast(status === 'jogado' ? 'Marcado como jogado ✅' : status === 'recusado' ? 'Pedido recusado' : 'Voltou para a fila');
    await loadGames();
  } catch (err) {
    toast(err.message, true);
  }
}

// ------------------------------------------------------------------ lista

async function loadGames() {
  try {
    const { games } = await api(`/api/games?status=${state.status}`);
    state.games = games;
    if (state.status === 'pendente') $('#count-pendente').textContent = games.length ? String(games.length) : '';
    renderList();
  } catch (err) {
    $('#list').replaceChildren(h('div', { class: 'empty' }, `Não foi possível carregar a fila: ${err.message}`));
  }
}

function reviewClass(percent) {
  if (percent === null) return '';
  return percent >= 70 ? 'good' : percent >= 40 ? 'mixed' : 'bad';
}

function steamStats(game) {
  const s = game.steam;
  const stats = [];
  if (s.reviewPercent !== null) {
    stats.push(h('span', { class: reviewClass(s.reviewPercent), title: s.reviewScoreDesc ?? '' },
      `👍 ${s.reviewPercent}%`, s.reviewTotal ? ` (${fmtCompact.format(s.reviewTotal)})` : ''));
  }
  if (s.currentPlayers !== null) stats.push(h('span', { title: 'Jogando agora na Steam' }, `🎮 ${fmtCompact.format(s.currentPlayers)} agora`));
  if (s.topRank !== null) stats.push(h('span', { title: 'Posição no top 100 mais jogados da Steam' }, `🏆 #${s.topRank} Steam`));
  if (game.priceText) stats.push(h('span', {}, game.priceText));
  return h('div', { class: 'stats' }, stats);
}

function gameCard(game) {
  const open = game.status === 'pendente';
  const voteBtn = h('button', {
    class: `vote${game.hasVoted ? ' voted' : ''}`,
    disabled: !open,
    title: !open ? 'Votação encerrada' : game.hasVoted ? 'Clique para remover seu voto' : 'Votar',
    'aria-pressed': game.hasVoted ? 'true' : 'false',
    'aria-label': `${game.hasVoted ? 'Remover voto de' : 'Votar em'} ${game.name}, ${game.votes} votos`,
    onclick: () => vote(game.appid, { remove: game.hasVoted }),
  }, h('span', { class: 'arrow' }, game.hasVoted ? '✓' : '▲'), h('span', { class: 'n' }, fmt.format(game.votes)));

  const admin = state.me.isAdmin
    ? h('div', { class: 'admin-actions' },
        game.status !== 'jogado' ? h('button', { class: 'btn', onclick: () => setStatus(game.appid, 'jogado') }, '✅ Jogado') : null,
        game.status !== 'recusado' ? h('button', { class: 'btn', onclick: () => setStatus(game.appid, 'recusado') }, '🚫 Recusar') : null,
        game.status !== 'pendente' ? h('button', { class: 'btn', onclick: () => setStatus(game.appid, 'pendente') }, '↩ Reabrir') : null,
      )
    : null;

  return h('article', { class: `card${state.highlight === game.appid ? ' highlight' : ''}`, id: `jogo-${game.appid}` },
    h('div', { class: 'pos' }, `${game.position}`),
    game.headerImage ? h('img', { class: 'thumb', src: game.headerImage, alt: '', loading: 'lazy' }) : h('div', { class: 'thumb' }),
    h('div', { class: 'info' },
      h('a', { class: 'name', href: game.steam.url, target: '_blank', rel: 'noopener' }, game.name),
      game.genres.length ? h('div', { class: 'chips' }, game.genres.slice(0, 3).map((g) => h('span', { class: 'chip' }, g))) : null,
      steamStats(game),
      game.requestedBy ? h('div', { class: 'requested' }, `pedido por ${game.requestedBy}`) : null,
      admin,
    ),
    voteBtn,
  );
}

function renderList() {
  const list = $('#list');
  if (!state.games.length) {
    const msg = state.status === 'pendente'
      ? 'Nenhum pedido ainda. Busque um jogo aí em cima e seja o primeiro!'
      : 'Nada por aqui ainda.';
    list.replaceChildren(h('div', { class: 'empty' }, msg));
    return;
  }
  list.replaceChildren(...state.games.map(gameCard));
  if (state.highlight) {
    const el = document.getElementById(`jogo-${state.highlight}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      state.highlight = null;
      $('#spotlight').hidden = true;
    }
  }
}

// ------------------------------------------------------------------ link direto (?jogo=APPID)

async function showSpotlight(appid) {
  try {
    const { game } = await api(`/api/steam/app/${appid}`);
    if (game.inQueue !== false && game.status === 'pendente') return; // já está na lista, o card é destacado
    const box = $('#spotlight');
    const inQueue = game.inQueue !== false;
    box.replaceChildren(
      game.headerImage ? h('img', { src: game.headerImage, alt: '' }) : h('div'),
      h('div', {},
        h('h2', {}, game.name),
        game.shortDescription ? h('p', {}, game.shortDescription) : null,
        inQueue
          ? h('p', {}, game.status === 'jogado' ? 'Esse jogo já foi jogado na live 🎉' : 'Esse pedido foi recusado pelo streamer.')
          : h('button', { class: 'btn twitch', onclick: () => vote(appid) }, '▲ Pedir este jogo'),
      ),
    );
    box.hidden = false;
  } catch (err) {
    toast(err.message, true);
  }
}

// ------------------------------------------------------------------ busca na Steam

let searchTimer;
let searchSeq = 0;

function closeSearch() {
  $('#search-results').hidden = true;
}

async function runSearch(term) {
  const box = $('#search-results');
  if (term.trim().length < 2) return closeSearch();
  const seq = ++searchSeq;
  try {
    const { results } = await api(`/api/steam/search?q=${encodeURIComponent(term)}`);
    if (seq !== searchSeq) return; // resposta antiga chegou depois da nova
    if (!results.length) {
      box.replaceChildren(h('div', { class: 'result-empty' }, 'Nenhum jogo encontrado na Steam.'));
    } else {
      box.replaceChildren(...results.map((r) => {
        const label = r.inQueue
          ? r.status !== 'pendente' ? (r.status === 'jogado' ? 'Já jogado' : 'Recusado') : r.hasVoted ? 'Votado ✓' : `Votar (${r.votes})`
          : 'Pedir';
        const disabled = (r.inQueue && r.status !== 'pendente') || r.hasVoted;
        return h('div', { class: 'result', role: 'option' },
          r.image ? h('img', { src: r.image, alt: '', loading: 'lazy' }) : h('div'),
          h('div', { style: 'min-width:0' },
            h('div', { class: 'r-name' }, r.name),
            h('div', { class: 'r-meta' }, [r.priceText, r.inQueue ? `${r.votes} votos na fila` : null].filter(Boolean).join(' · ')),
          ),
          h('button', { class: `btn ${r.inQueue ? '' : 'twitch'}`, disabled, onclick: () => vote(r.appid) }, label),
        );
      }));
    }
    box.hidden = false;
  } catch (err) {
    if (seq === searchSeq) {
      box.replaceChildren(h('div', { class: 'result-empty' }, err.message));
      box.hidden = false;
    }
  }
}

// ------------------------------------------------------------------ util

let toastTimer;
function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast${isError ? ' error' : ''}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

// ------------------------------------------------------------------ início

function bindEvents() {
  const input = $('#search-input');
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch(input.value), 300);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSearch(); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.search')) closeSearch(); });

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      state.status = tab.dataset.status;
      loadGames();
    });
  });

  // Tempo real: quando alguém vota (site, Twitch ou Discord) o servidor avisa e recarregamos.
  let reloadTimer;
  const events = new EventSource('/api/stream');
  events.addEventListener('ranking', () => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(loadGames, 250);
  });
}

async function init() {
  $('#list').replaceChildren(...Array.from({ length: 3 }, () => h('div', { class: 'skeleton' })));
  bindEvents();
  try {
    state.me = await api('/api/me');
  } catch { /* segue sem login */ }
  renderAuth();

  const params = new URLSearchParams(location.search);
  if (params.get('login') === 'cancelado') toast('Login cancelado');

  await loadGames();
  if (state.highlight && !document.getElementById(`jogo-${state.highlight}`)) showSpotlight(state.highlight);
}

init();
