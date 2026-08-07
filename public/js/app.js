// Turco — cliente PWA.

import { cardHtml } from './cards.js';
import { sound } from './sound.js';
import { voice } from './voice.js';

const $ = (sel) => document.querySelector(sel);

const CALL_NAMES = {
  ENVIDO: 'Envido',
  REAL_ENVIDO: 'Real Envido',
  FALTA_ENVIDO: 'Falta Envido',
  TRUCO: 'Truco',
  RETRUCO: 'Retruco',
  VALE_CUATRO: 'Vale Cuatro',
  SHOW_TANTOS: 'Mostrar tantos',
};
// Lo que "dice" cada jugada en la burbuja, y de qué color sale.
const BUBBLE = {
  ENVIDO:            ['¡Envido!',            'envido'],
  REAL_ENVIDO:       ['¡Real envido!',       'envido'],
  FALTA_ENVIDO:      ['¡Falta envido!',      'envido'],
  TRUCO:             ['¡Truco!',             'truco'],
  RETRUCO:           ['¡Retruco!',           'truco'],
  VALE_CUATRO:       ['¡Vale cuatro!',       'truco'],
  QUIERO_ENVIDO:     ['¡Quiero!',            'si'],
  QUIERO_TRUCO:      ['¡Quiero!',            'si'],
  NO_QUIERO_ENVIDO:  ['No quiero',           'no'],
  NO_QUIERO_TRUCO:   ['No quiero',           'no'],
  MAZO:              ['Me voy al mazo',      'no'],
  SHOW_TANTOS:       ['¡Muestro los tantos!', 'envido'],
};

const ENVIDO_CALLS = ['ENVIDO', 'REAL_ENVIDO', 'FALTA_ENVIDO'];
const TRUCO_CALLS = ['TRUCO', 'RETRUCO', 'VALE_CUATRO'];

const store = {
  get id() { return localStorage.getItem('turco.playerId') || ''; },
  set id(v) { localStorage.setItem('turco.playerId', v); },
  get name() { return localStorage.getItem('turco.name') || ''; },
  set name(v) { localStorage.setItem('turco.name', v); },
};

const ui = { envidoOpen: false, lastLogSeq: 0, wakeLock: null };
let view = null;
let ws = null;
let retryDelay = 500;
let pendingJoin = null;

// ═══════════════════════════════ conexión ═══════════════════════════════

function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);

  ws.addEventListener('open', () => {
    retryDelay = 500;
    $('#conn').hidden = true;
    if (pendingJoin) send({ type: 'join', ...pendingJoin, playerId: store.id || undefined });
  });

  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    handleMessage(msg);
  });

  ws.addEventListener('close', () => {
    if (pendingJoin) $('#conn').hidden = false;
    setTimeout(connect, retryDelay);
    retryDelay = Math.min(retryDelay * 1.7, 8000);
  });

  ws.addEventListener('error', () => ws.close());
}

function send(msg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function handleMessage(msg) {
  if (msg.type === 'joined') {
    store.id = msg.playerId;
    pendingJoin = { ...pendingJoin, code: msg.code };
    history.replaceState(null, '', `/${msg.code}`);
    return;
  }
  if (msg.type === 'rtc') {
    voice.handleSignal(msg.from, msg.data);
    return;
  }
  if (msg.type === 'error') {
    if (!view) showHomeError(msg.message);
    else toast(msg.message);
    return;
  }
  if (msg.type === 'state') {
    const previous = view;
    view = msg;
    ui.envidoOpen = false;
    syncVoice(msg);
    render();
    playSoundsFor(previous, msg);
  }
}

// ═══════════════════════════════ sonido ═══════════════════════════════

/** Compara el estado anterior con el nuevo y suena lo que haya pasado. */
function playSoundsFor(prev, next) {
  // Sorteo de apertura.
  if (next.phase === 'draw' && prev?.phase !== 'draw') sound.play('draw');

  // Mano nueva sobre la mesa.
  if (next.phase === 'playing' && next.roundNo !== prev?.roundNo) {
    sound.play('deal');
    ui.lastLogSeq = 0;
    clearBubbles();
  }

  // Cantos y cartas: todo lo que se anotó desde la última vez.
  const log = next.round?.log ?? [];
  const fresh = log.filter((e) => e.n > (ui.lastLogSeq ?? 0));
  if (fresh.length) {
    ui.lastLogSeq = fresh[fresh.length - 1].n;
    // Si llegaron varias de golpe (reconexión), sólo suena la última.
    const last = fresh[fresh.length - 1];
    if (last.kind === 'PLAY') sound.play('card');
    else if (last.kind) {
      sound.play(last.kind);
      sound.say(last.kind);
      showBubble(last.who, last.kind);
    }
  }

  // Cierre de ronda.
  if (next.phase === 'roundEnd' && prev?.phase !== 'roundEnd') {
    const o = next.outcome;
    if (o?.pacto) sound.play('pacto');
    const after = o?.pacto ? 340 : 0;
    setTimeout(() => {
      if (o?.tie) sound.play('tie');
      else if (next.you.isSpectator) sound.play('turn');
      else sound.play(o?.winnerId === next.you.id ? 'win' : 'lose');
    }, after);
  }

  // Fin de partida.
  if (next.phase === 'gameEnd' && prev?.phase !== 'gameEnd') {
    setTimeout(() => sound.play(next.gameOver?.magistral ? 'magistral' : 'gameWin'), 260);
  }
}

/** Burbuja de diálogo del lado del jugador que cantó. */
function showBubble(seatIdx, kind) {
  const texto = BUBBLE[kind];
  if (!texto || seatIdx === null || seatIdx === undefined) return;
  const { top } = seatOrientation();
  const el = $(seatIdx === top ? '#bubble-top' : '#bubble-bottom');
  if (!el) return;

  el.className = `bubble bubble--${seatIdx === top ? 'top' : 'bottom'} bubble--${texto[1]}`;
  el.textContent = texto[0];
  el.hidden = false;
  // Reiniciamos la animación si se encadenan dos cantos.
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';

  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, 2600);
}

function clearBubbles() {
  for (const id of ['#bubble-top', '#bubble-bottom']) {
    const el = $(id);
    if (el) { clearTimeout(el._t); el.hidden = true; }
  }
}

// ═══════════════════════════════ audio entre jugadores ═══════════════════════════════

let voiceReady = false;

/** Mantiene las conexiones de voz al día con los miembros de la sala. */
function syncVoice(state) {
  if (state.you?.isTv) return; // la tele no habla ni escucha

  if (!voiceReady && state.you?.id) {
    voice.init({ send, myId: state.you.id, onChange: renderVoice });
    voiceReady = true;
  }
  if (!voiceReady) return;

  voice.syncPeers((state.members ?? []).map((m) => m.id));
  renderVoice();
}

/** Pinta los botones de micrófono y auriculares en las dos pantallas. */
function renderVoice() {
  const esTele = view?.you?.isTv;

  for (const el of document.querySelectorAll('[data-voice="mic"]')) {
    el.classList.toggle('is-on', voice.micOn);
    el.classList.toggle('is-off', !voice.micOn);
    el.classList.toggle('is-talking', voice.micOn && voice.level('me') > 0.12);
    el.hidden = !!esTele;
    if (el.classList.contains('btn')) {
      el.textContent = voice.micOn ? '🎙️ Micrófono abierto' : '🎙️ Micrófono cerrado';
    } else {
      el.textContent = voice.micOn ? '🎙️' : '🔇';
    }
  }

  for (const el of document.querySelectorAll('[data-voice="deafen"]')) {
    el.classList.toggle('is-off', voice.deafened);
    el.classList.toggle('is-on', !voice.deafened);
    el.hidden = !!esTele;
    if (el.classList.contains('btn')) {
      el.textContent = voice.deafened ? '🔕 No escuchás a nadie' : '🎧 Escuchás a todos';
    } else {
      el.textContent = voice.deafened ? '🔕' : '🎧';
    }
  }

  const nota = $('#voice-note');
  if (nota) {
    const msg = voice.error ?? (!voice.supported && !esTele
      ? 'El micrófono necesita HTTPS. Por red local (http://) no está disponible.'
      : null);
    nota.textContent = msg ?? '';
    nota.hidden = !msg;
  }

  // Repintamos sólo lo que existe: en el lobby todavía no hay marcador.
  if (view?.players) renderScoreboard();
  if (view?.phase === 'lobby') renderLobby();
}

// ═══════════════════════════════ helpers ═══════════════════════════════

function toast(text, ms = 2200) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, ms);
}

function showHomeError(text) {
  const el = $('#home-error');
  el.textContent = text;
  el.hidden = !text;
}

function showScreen(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('is-active', s.id === id);
}

function playerName(id) {
  return view?.players?.find((p) => p.id === id)?.name
    ?? view?.members?.find((m) => m.id === id)?.name
    ?? '—';
}

function chainLabel(chain) {
  return chain.map((c) => CALL_NAMES[c]).join(' + ');
}

function pts(n) {
  return `${n} ${n === 1 ? 'punto' : 'puntos'}`;
}

async function keepAwake() {
  try {
    if ('wakeLock' in navigator && !ui.wakeLock) {
      ui.wakeLock = await navigator.wakeLock.request('screen');
      ui.wakeLock.addEventListener('release', () => { ui.wakeLock = null; });
    }
  } catch { /* no pasa nada si el navegador no lo permite */ }
}

// ═══════════════════════════════ render ═══════════════════════════════

function render() {
  if (!view) { showScreen('screen-home'); return; }

  if (view.phase === 'lobby') {
    renderLobby();
    showScreen('screen-lobby');
    closeModal('#modal-round');
    closeModal('#modal-game');
    return;
  }

  showScreen('screen-game');
  keepAwake();
  renderScoreboard();
  renderTable();
  renderActions();

  if (view.phase === 'gameEnd') {
    closeModal('#modal-round');
    closeModal('#modal-draw');
    renderGameOver();
  } else if (view.phase === 'roundEnd') {
    closeModal('#modal-game');
    closeModal('#modal-draw');
    renderRoundEnd();
  } else if (view.phase === 'draw') {
    closeModal('#modal-round');
    closeModal('#modal-game');
    renderDraw();
  } else {
    closeModal('#modal-round');
    closeModal('#modal-game');
    closeModal('#modal-draw');
  }
}

// ─────────────────────────── sorteo inicial ───────────────────────────

function renderDraw() {
  const d = view.draw;
  if (!d) return;

  const roles = ['Mano', 'Juega', 'Mira'];
  const rows = d.ranked
    .map((r, i) => `
      <div class="rhand ${i < 2 ? 'is-winner' : ''}">
        <div class="rhand__who">
          <div class="nm">${escapeHtml(r.name)}${r.id === view.you.id ? ' (vos)' : ''}</div>
          <div class="tanto">${roles[i]}</div>
        </div>
        <div class="rhand__cards">${cardHtml(r.card, { size: 'mini' })}</div>
      </div>`)
    .join('');

  const retryNote = d.retries > 0
    ? `<div class="sub">Hubo empate ${d.retries === 1 ? 'una vez' : `${d.retries} veces`}: se volvió a dar.</div>`
    : '';

  $('#draw-body').innerHTML = `<div class="reveal">
    <div class="reveal__head">
      <div class="kicker">Sorteo</div>
      <h2>Una carta a cada uno</h2>
      <div class="sub">Juegan las dos más altas. La más baja mira.</div>
      ${retryNote}
    </div>
    <div class="reveal__hands">${rows}</div>
  </div>`;

  $('#btn-start').hidden = view.you.isTv;
  openModal('#modal-draw');
}

// ─────────────────────────── lobby ───────────────────────────

function renderLobby() {
  $('#lobby-code').textContent = view.code;
  const list = $('#lobby-members');
  list.innerHTML = '';

  for (const m of view.members) {
    const li = document.createElement('li');
    const hablando = m.mic && (m.id === view.you.id ? voice.level('me') : voice.level(m.id)) > 0.12;
    if (hablando) li.classList.add('is-talking');
    li.innerHTML = `<span class="dot ${m.connected ? '' : 'off'}"></span>
      <span>${escapeHtml(m.name)}</span>
      ${m.id === view.you.id ? '<span class="muted" style="font-size:12px">vos</span>' : ''}
      <span class="mic">${m.mic ? '🎙️' : ''}</span>`;
    list.appendChild(li);
  }
  for (let i = view.members.length; i < 3; i++) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.innerHTML = '<span class="dot off"></span><span>Lugar libre</span>';
    list.appendChild(li);
  }

  $('#lobby-tvcode').textContent = view.tvCode ?? '····';
  $('.tvbox').hidden = !view.tvCode;

  const needed = 3 - view.members.length;
  $('#lobby-status').textContent = needed > 0
    ? `Falta${needed > 1 ? 'n' : ''} ${needed} jugador${needed > 1 ? 'es' : ''} para arrancar.`
    : 'Arrancando…';
}

// ─────────────────────────── marcador ───────────────────────────

function renderScoreboard() {
  const el = $('#scoreboard');
  const parts = view.players.map((p) => {
    const playing = view.seats.includes(p.id);
    const isYou = p.id === view.you.id;
    const cls = ['pscore', playing ? 'is-playing' : 'is-spec'].join(' ');
    const tag = playing
      ? (view.round && view.seats[view.round.manoIdx] === p.id ? 'Mano' : 'Juega')
      : 'Mira';
    const crown = p.neverLost && p.score > 0 ? ' ★' : '';
    const micAbierto = view.voice?.[p.id];
    const hablando = micAbierto && (isYou ? voice.level('me') : voice.level(p.id)) > 0.12;
    return `<div class="${cls}${hablando ? ' is-talking' : ''}">
      <span class="tag">${tag}</span>
      <div class="nm">${escapeHtml(p.name)}${isYou ? ' (vos)' : ''}${crown}</div>
      <div class="pts">${p.score}</div>
      ${micAbierto ? '<span class="mic">🎙️</span>' : ''}
    </div>`;
  });

  const pot = view.pot > 0
    ? `<div class="pot-chip"><span class="lbl">Pozo</span><span class="val">${view.pot}</span></div>`
    : '';

  el.innerHTML = parts.join('') + pot;
}

// ─────────────────────────── mesa ───────────────────────────

function seatOrientation() {
  // El espectador mira la mesa "de costado": arriba silla 0, abajo silla 1.
  if (view.you.isSpectator) return { top: 0, bottom: 1 };
  return { top: 1 - view.you.seatIdx, bottom: view.you.seatIdx };
}

function seatBadges(idx, r) {
  const badges = [];
  if (r.manoIdx === idx) badges.push('<span class="badge badge--mano">Mano</span>');
  if (r.acting === idx && !r.finished) badges.push('<span class="badge badge--turn">Juega</span>');
  // El tanto sólo aparece si tenés permiso para ver esa mano.
  if (r.envido.tantos?.[idx] != null && idx !== view.you.seatIdx) {
    badges.push(`<span class="badge badge--tanto">${r.envido.tantos[idx]} de tanto</span>`);
  }
  return badges.join('');
}

function handHtml(hand, { playable = false, size = 'md' } = {}) {
  return hand
    .map((slot, i) => {
      if (slot.played) return cardHtml(null, { ghost: true, size });
      if (slot.hidden) return cardHtml(null, { size });
      return cardHtml(slot.card, { size, playable, index: i });
    })
    .join('');
}

function renderTable() {
  const r = view.round;
  if (!r) {
    // Durante el sorteo todavía no hay mano que mostrar.
    for (const sel of ['#seat-top', '#seat-bottom', '#stakes', '#tricks']) $(sel).innerHTML = '';
    $('#table-msg').textContent = 'Sorteando…';
    return;
  }
  const { top, bottom } = seatOrientation();

  const canPlay = !view.you.isSpectator && r.actions.includes('PLAY');

  $('#seat-top').innerHTML = `
    <div class="seat__name">${escapeHtml(playerName(view.seats[top]))} ${seatBadges(top, r)}</div>
    <div class="hand">${handHtml(r.hands[top], { size: 'mini' })}</div>`;

  $('#seat-bottom').innerHTML = `
    <div class="hand ${canPlay ? '' : 'hand--locked'}">${handHtml(r.hands[bottom], {
      playable: canPlay,
      size: 'hand',
    })}</div>
    <div class="seat__name">${escapeHtml(playerName(view.seats[bottom]))}${
      view.you.isSpectator ? '' : ' (vos)'
    } ${seatBadges(bottom, r)}</div>`;

  renderStakes(r);
  renderTricks(r, top, bottom);
  renderTableMsg(r);
  renderPeekAsk(r);
}

function renderStakes(r) {
  const chips = [];

  if (r.truco.chain.length) {
    const last = CALL_NAMES[r.truco.chain[r.truco.chain.length - 1]];
    chips.push(
      r.truco.accepted
        ? `<span class="chip chip--truco">${last} <span class="n">${r.truco.value}</span></span>`
        : `<span class="chip chip--truco">${last} · sin responder</span>`,
    );
  }

  if (r.envido.chain.length) {
    const label = chainLabel(r.envido.chain);
    if (r.envido.accepted) {
      chips.push(`<span class="chip chip--secret">🔒 ${label} <span class="n">${r.envido.value}</span> · al final</span>`);
    } else if (r.envido.result?.type === 'noquiero') {
      chips.push(`<span class="chip chip--envido">${label} no querido <span class="n">${r.envido.result.value}</span></span>`);
    } else {
      chips.push(`<span class="chip chip--envido">${label} · sin responder</span>`);
    }
  }

  $('#stakes').innerHTML = chips.join('');
}

function renderTricks(r, top, bottom) {
  const html = r.tricks
    .map((t, i) => {
      const isCurrent = i === r.tricks.length - 1 && !r.finished;
      let cls = 'trick';
      if (isCurrent) cls += ' is-current';
      if (t.winner === 'tie') cls += ' won-tie';
      else if (t.winner === top) cls += ' won-top';
      else if (t.winner === bottom) cls += ' won-bottom';

      let res = '';
      if (t.winner === 'tie') res = 'Parda';
      else if (t.winner === top) res = '▲';
      else if (t.winner === bottom) res = '▼';

      const topCard = t.cards[top] ? cardHtml(t.cards[top]) : cardHtml(null, { ghost: true });
      const bottomCard = t.cards[bottom] ? cardHtml(t.cards[bottom]) : cardHtml(null, { ghost: true });

      return `<div class="${cls}">
        <span class="trick__no">${['1ª', '2ª', '3ª'][i]}</span>
        ${topCard}${bottomCard}
        <span class="trick__res">${res}</span>
      </div>`;
    })
    .join('');
  $('#tricks').innerHTML = html;
}

function renderTableMsg(r) {
  const el = $('#table-msg');
  if (r.finished) { el.innerHTML = ''; return; }

  const last = r.log[r.log.length - 1];
  const lastLine = last
    ? `<span class="muted">${escapeHtml(playerName(view.seats[last.who]))}: ${escapeHtml(last.text)}</span>`
    : '';

  if (view.you.isTv) {
    const stake = r.truco.accepted ? `Truco por ${r.truco.value}` : '';
    el.innerHTML = `Juega <strong>${escapeHtml(playerName(view.seats[r.acting]))}</strong>${
      stake ? ` · ${stake}` : ''
    }${lastLine ? `<br>${lastLine}` : ''}`;
    return;
  }

  if (view.you.isSpectator) {
    const permisos = [0, 1].filter((i) => r.peek?.granted[i]).length;
    el.innerHTML = `${
      permisos === 2 ? 'Te dejaron ver las dos manos.'
        : permisos === 1 ? 'Ves una de las dos manos.'
        : 'No ves ninguna mano todavía.'
    }${lastLine ? `<br>${lastLine}` : ''}`;
    return;
  }

  if (r.acting === view.you.seatIdx) {
    el.innerHTML = last && last.who !== view.you.seatIdx
      ? `<strong>${escapeHtml(playerName(view.seats[last.who]))}</strong>: ${escapeHtml(last.text)}`
      : 'Te toca.';
  } else {
    el.innerHTML = `Esperando a <strong>${escapeHtml(playerName(view.seats[r.acting]))}</strong>…`;
  }
}

// ─────────────────────────── barra de acciones ───────────────────────────

function renderActions() {
  const bar = $('#actionbar');
  const r = view.round;

  if (!r || view.phase !== 'playing') { bar.innerHTML = ''; return; }

  // La tele es pantalla pública: nunca tiene botones.
  if (view.you.isTv) {
    bar.innerHTML = '<div class="actionbar__wait">📺 Modo tele · sólo se ve lo que está sobre la mesa</div>';
    return;
  }

  if (view.you.isSpectator) { renderSpectatorBar(bar, r); return; }

  const a = r.actions;
  if (!a.length) {
    bar.innerHTML = `<div class="actionbar__wait">Esperando a ${escapeHtml(
      playerName(view.seats[r.acting]),
    )}…</div>`;
    return;
  }

  // ── modo respuesta: me cantaron algo
  if (a.includes('QUIERO')) {
    const answeringEnvido = r.envido.pending === view.you.seatIdx;
    const chain = answeringEnvido ? r.envido.chain : r.truco.chain;
    const callerIdx = answeringEnvido ? r.envido.caller : r.truco.caller;
    const last = CALL_NAMES[chain[chain.length - 1]];
    const raises = a.filter((x) => ENVIDO_CALLS.includes(x) || TRUCO_CALLS.includes(x));

    const note = answeringEnvido
      ? '<div class="actionbar__prompt muted" style="font-size:11.5px">Se juega a ciegas: los tantos se ven al final.</div>'
      : '';

    bar.innerHTML = `
      <div class="actionbar__prompt">${escapeHtml(playerName(view.seats[callerIdx]))} cantó <em>${last}</em></div>
      ${note}
      <div class="actionbar__row">
        <button class="btn btn--ok" data-act="QUIERO">Quiero</button>
        <button class="btn btn--danger" data-act="NO_QUIERO">No quiero</button>
      </div>
      ${raises.length ? `<div class="actionbar__row">${raises
        .map((x) => {
          // Contestar un truco con envido tiene nombre propio en la mesa.
          const primero = !answeringEnvido && ENVIDO_CALLS.includes(x);
          const label = primero ? `${CALL_NAMES[x]} está primero` : CALL_NAMES[x];
          return `<button class="btn btn--ghost" data-act="${x}">${label}</button>`;
        })
        .join('')}</div>` : ''}
      ${a.includes('SHOW_TANTOS')
        ? '<div class="actionbar__row"><button class="btn btn--tantos" data-act="SHOW_TANTOS">🃏 No quiero, muestro los tantos</button></div>'
        : ''}`;
    return;
  }

  // ── modo canto libre
  const envidoOpts = a.filter((x) => ENVIDO_CALLS.includes(x));
  const trucoOpt = a.find((x) => TRUCO_CALLS.includes(x));

  if (ui.envidoOpen && envidoOpts.length) {
    bar.innerHTML = `<div class="popover">
      ${envidoOpts.map((x) => `<button class="btn btn--ghost" data-act="${x}">${CALL_NAMES[x]}</button>`).join('')}
      <button class="btn" data-ui="envido-close">Cancelar</button>
    </div>`;
    return;
  }

  const row = [];
  if (envidoOpts.length === 1) {
    row.push(`<button class="btn btn--ghost" data-act="${envidoOpts[0]}">${CALL_NAMES[envidoOpts[0]]}</button>`);
  } else if (envidoOpts.length > 1) {
    row.push('<button class="btn btn--ghost" data-ui="envido-open">Envido ▾</button>');
  }
  if (trucoOpt) {
    row.push(`<button class="btn btn--ghost" data-act="${trucoOpt}">${CALL_NAMES[trucoOpt]}</button>`);
  }
  if (a.includes('MAZO')) {
    row.push('<button class="btn" data-act="MAZO">Al mazo</button>');
  }

  // Con el envido querido: confiar en el tanto y cortar la mano acá.
  const tantosRow = a.includes('SHOW_TANTOS')
    ? `<div class="actionbar__row"><button class="btn btn--tantos" data-act="SHOW_TANTOS">🃏 Mostrar tantos (${view.round.envido.value} en juego)</button></div>`
    : '';

  const hint = a.includes('PLAY')
    ? '<div class="actionbar__prompt muted" style="font-size:12px">Tocá una carta para jugarla</div>'
    : '';

  bar.innerHTML = `${hint}<div class="actionbar__row">${row.join('')}</div>${tantosRow}`;
}

/**
 * Pedido de permiso al costado de la mesa: así no tapa los botones de jugar,
 * que siguen usables porque contestar no consume el turno.
 */
function renderPeekAsk(r) {
  const el = $('#peek-ask');
  if (!el) return;
  const yo = view.you.seatIdx;
  if (view.you.isTv || yo === -1 || !r.peek?.requested[yo]) { el.hidden = true; return; }

  el.innerHTML = `
    <div class="peek-ask__txt"><b>${escapeHtml(playerName(view.spectator))}</b> quiere ver tus cartas</div>
    <div class="peek-ask__row">
      <button class="btn btn--ok" data-act="PEEK_YES">Sí</button>
      <button class="btn btn--danger" data-act="PEEK_NO">No</button>
    </div>`;
  el.hidden = false;
}

/** Barra del que mira: pedir permiso a cada jugador para ver su mano. */
function renderSpectatorBar(bar, r) {
  const buttons = [0, 1].map((seat) => {
    const who = escapeHtml(playerName(view.seats[seat]));
    const p = r.peek;
    if (p.granted[seat]) return `<button class="btn btn--ok" disabled>${who}: ves sus cartas</button>`;
    if (p.requested[seat]) return `<button class="btn" disabled>${who}: esperando…</button>`;
    if (p.denied[seat]) return `<button class="btn" disabled>${who}: te dijo que no</button>`;
    return `<button class="btn btn--ghost" data-peek="${seat}">Pedirle a ${who}</button>`;
  });

  bar.innerHTML = `
    <div class="actionbar__prompt muted" style="font-size:12px">
      👀 Mirás la partida. Para ver una mano tenés que pedir permiso.
    </div>
    <div class="actionbar__row">${buttons.join('')}</div>`;
}

// ─────────────────────────── fin de ronda ───────────────────────────

function renderRoundEnd() {
  const o = view.outcome;
  if (!o) return;

  // Mismo orden que la mesa: el rival arriba, vos abajo.
  const mySeat = o.seats.indexOf(view.you.id);
  const order = mySeat === -1 ? [0, 1] : [1 - mySeat, mySeat];

  // Pacto: las cartas que no se revelan llegan como null y se muestran tapadas.
  const rows = order.map((i) => {
    const id = o.seats[i];
    const winner = o.winnerIdx === i;
    const cards = o.hands[i].map((c) => cardHtml(c, { size: 'mini' })).join('');
    // tantos es un array con null en las manos que no podés ver.
    const tanto = o.envido.tantos?.[i] != null
      ? `Tanto: <b>${o.envido.tantos[i]}</b>`
      : '<span class="muted">Tanto reservado</span>';
    return `<div class="rhand ${winner ? 'is-winner' : ''}">
      <div class="rhand__who">
        <div class="nm">${escapeHtml(playerName(id))}${id === view.you.id ? ' (vos)' : ''}</div>
        <div class="tanto">${tanto}</div>
      </div>
      <div class="rhand__cards">${cards}</div>
      <div class="rhand__pts">${o.roundPoints[i]}</div>
    </div>`;
  });

  const lines = [];
  lines.push(`<div><span>Truco · ${escapeHtml(o.trucoReason)}</span>
    <b>${o.trucoPoints} → ${escapeHtml(playerName(o.seats[o.trucoWinner]))}</b></div>`);

  if (o.envido.type === 'quiero') {
    const tieNote = o.envido.tie ? ' (empate, gana la mano)' : '';
    lines.push(`<div><span>${chainLabel(o.envido.chain)} · ${o.envido.tantos[0]} vs ${o.envido.tantos[1]}${tieNote}</span>
      <b>${o.envido.value} → ${escapeHtml(playerName(o.seats[o.envido.winner]))}</b></div>`);
  } else if (o.envido.type === 'noquiero') {
    lines.push(`<div><span>${chainLabel(o.envido.chain)} · no querido</span>
      <b>${o.envido.value} → ${escapeHtml(playerName(o.seats[o.envido.winner]))}</b></div>`);
  } else {
    lines.push('<div><span>Envido</span><b>no se cantó</b></div>');
  }

  let verdict;
  if (o.tie) {
    const capped = o.potAfter >= view.maxPot ? ' · tope alcanzado' : '';
    verdict = `<div class="verdict is-tie">
      <div class="big">Empate a ${o.roundPoints[0]}</div>
      <div class="small">Se vuelve a dar entre los mismos dos. Pozo: <b>${pts(o.potAfter)}</b>${capped}</div>
    </div>`;
  } else {
    const potNote = o.potBefore > 0 ? ` y se lleva el pozo de ${pts(o.potBefore)}` : '';
    const nextIn = playerName(o.spectator);
    verdict = `<div class="verdict is-win">
      <div class="big">Gana ${escapeHtml(playerName(o.winnerId))} · +${pts(o.awarded)}</div>
      <div class="small">Se queda de mano${potNote}. Entra ${escapeHtml(nextIn)}, sale ${escapeHtml(
        playerName(o.loserId),
      )}.</div>
    </div>`;
  }

  // Encabezado según cuánto se destapó.
  let title = 'Se revelan los tantos';
  let sub = 'Puntos de la ronda';
  if (o.showedTantos !== null && o.showedTantos !== undefined) {
    title = 'Mostró los tantos';
    sub = `${playerName(o.seats[o.showedTantos])} cortó la mano y la ronda se define por el envido.`;
  } else if (o.pacto) {
    title = 'Pacto';
    sub = o.sawEverything
      ? 'No se muestra ninguna carta (vos las ves porque mirabas).'
      : 'No se muestra ninguna carta.';
  } else if (o.envido.type !== 'quiero') {
    title = 'Fin de la ronda';
    sub = 'Sólo se ve lo que quedó sobre la mesa.';
  }

  const pactoNote = o.pacto
    ? ''
    : `<div class="reveal__note">${
        o.envido.type === 'quiero'
          ? 'Se muestran las cartas jugadas y las que forman cada tanto.'
          : 'Las cartas que no se jugaron quedan tapadas.'
      }</div>`;

  $('#round-body').innerHTML = `<div class="reveal">
    <div class="reveal__head">
      <div class="kicker">Ronda ${o.roundNo}${o.foldedBy !== null ? ' · se fue al mazo' : ''}${
        o.showedTantos != null ? ' · mostró los tantos' : ''
      }</div>
      <h2>${title}</h2>
      <div class="sub">${sub}</div>
    </div>
    <div class="reveal__hands">${rows.join('')}</div>
    ${pactoNote}
    <div class="breakdown">${lines.join('')}</div>
    ${verdict}
  </div>`;

  renderNextConfirm(o);
  openModal('#modal-round');
}

/**
 * Para pasar de ronda tienen que aceptar los dos que jugaron.
 * Muestra quién ya dio el OK y a quién se está esperando.
 */
function renderNextConfirm(o) {
  const btn = $('#btn-next');
  const listos = view.nextReady ?? [];
  const jugaron = o.seats;
  const soyJugador = jugaron.includes(view.you.id);
  const yaDije = listos.includes(view.you.id);

  // Marcas de quién aceptó
  const marcas = jugaron
    .map((id) => `<span class="ready-mark ${listos.includes(id) ? 'is-ready' : ''}">${
      listos.includes(id) ? '✓' : '·'} ${escapeHtml(playerName(id))}</span>`)
    .join('');

  let pie = document.getElementById('next-status');
  if (!pie) {
    pie = document.createElement('div');
    pie.id = 'next-status';
    btn.parentNode.insertBefore(pie, btn);
  }

  const faltan = jugaron.filter((id) => !listos.includes(id));
  pie.innerHTML = `<div class="ready-marks">${marcas}</div>${
    faltan.length && listos.length
      ? `<div class="waiting-next">Esperando a <span class="who">${
          faltan.map((id) => escapeHtml(playerName(id))).join(' y ')}</span>…</div>`
      : ''}`;

  if (view.you.isTv || !soyJugador) {
    // La tele y el que mira no deciden: sólo ven a quién se espera.
    btn.hidden = true;
    return;
  }
  btn.hidden = false;
  btn.disabled = yaDije;
  btn.textContent = yaDije
    ? 'Listo, esperando…'
    : (o.tie ? 'Repartir de nuevo' : 'Siguiente ronda');
}

// ─────────────────────────── fin de partida ───────────────────────────

function renderGameOver() {
  const g = view.gameOver;
  const scores = view.players
    .slice()
    .sort((a, b) => b.score - a.score)
    .map((p) => `<div><span>${escapeHtml(p.name)}${p.id === view.you.id ? ' (vos)' : ''}</span><b>${p.score}</b></div>`)
    .join('');

  $('#game-body').innerHTML = `
    <div class="trophy">${g.magistral ? '🏆' : '🎉'}</div>
    <div class="champ">${escapeHtml(g.winnerName)}</div>
    <p class="muted">Llegó a ${view.target} puntos</p>
    ${g.magistral
      ? `<div class="magistral">Magistral</div>
         <p class="muted" style="font-size:13px">Llegó a ${view.target} sin perder una sola ronda.</p>`
      : ''}
    <div class="final-scores">${scores}</div>`;

  $('#btn-rematch').hidden = view.you.isTv;
  openModal('#modal-game');
}

// ─────────────────────────── modales ───────────────────────────

function openModal(sel) { $(sel).hidden = false; }
function closeModal(sel) { $(sel).hidden = true; }

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ═══════════════════════════════ eventos ═══════════════════════════════

document.addEventListener('click', (ev) => {
  const playEl = ev.target.closest('[data-play]');
  if (playEl && !playEl.closest('.hand--locked')) {
    send({ type: 'action', action: { type: 'PLAY', cardIndex: Number(playEl.dataset.play) } });
    return;
  }

  const peekEl = ev.target.closest('[data-peek]');
  if (peekEl) {
    send({ type: 'action', action: { type: 'PEEK_REQUEST', seat: Number(peekEl.dataset.peek) } });
    return;
  }

  const voiceEl = ev.target.closest('[data-voice]');
  if (voiceEl) {
    if (voiceEl.dataset.voice === 'mic') voice.toggleMic().then(renderVoice);
    else { const off = voice.toggleDeafen(); toast(off ? 'Micrófonos silenciados' : 'Escuchás a los demás', 1400); }
    renderVoice();
    return;
  }

  const actEl = ev.target.closest('[data-act]');
  if (actEl) {
    ui.envidoOpen = false;
    send({ type: 'action', action: { type: actEl.dataset.act } });
    return;
  }

  const uiEl = ev.target.closest('[data-ui]');
  if (uiEl) {
    if (uiEl.dataset.ui === 'envido-open') ui.envidoOpen = true;
    if (uiEl.dataset.ui === 'envido-close') ui.envidoOpen = false;
    renderActions();
  }
});

document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter') return;
  if (ev.target === $('#input-name')) $('#btn-create').click();
  if (ev.target === $('#input-code')) $('#btn-join').click();
});

$('#btn-create').addEventListener('click', () => doJoin(null));
$('#btn-join').addEventListener('click', () => {
  const code = $('#input-code').value.trim().toUpperCase();
  if (code.length !== 4) return showHomeError('El código tiene 4 caracteres.');
  doJoin(code);
});

function doJoin(code) {
  const name = $('#input-name').value.trim();
  if (!name) return showHomeError('Poné tu nombre para arrancar.');
  showHomeError('');
  store.name = name;
  pendingJoin = { name, code: code || undefined };
  if (ws?.readyState === WebSocket.OPEN) {
    send({ type: 'join', ...pendingJoin, playerId: store.id || undefined });
  }
}

$('#btn-share').addEventListener('click', async () => {
  const url = `${location.origin}/${view?.code ?? ''}`;
  const text = `Jugamos al Turco. Código: ${view?.code}`;
  try {
    if (navigator.share) await navigator.share({ title: 'Turco', text, url });
    else {
      await navigator.clipboard.writeText(url);
      toast('Link copiado');
    }
  } catch { /* el usuario canceló */ }
});

$('#btn-leave').addEventListener('click', () => {
  voice.stop();
  voiceReady = false;
  pendingJoin = null;
  view = null;
  history.replaceState(null, '', '/');
  ws?.close();
  showScreen('screen-home');
});

$('#btn-next').addEventListener('click', () => send({ type: 'next' }));
$('#btn-start').addEventListener('click', () => send({ type: 'next' }));
$('#btn-rematch').addEventListener('click', () => send({ type: 'rematch' }));

$('#btn-sound').addEventListener('click', () => {
  const mode = sound.cycle();
  $('#btn-sound').textContent = mode.icon;
  toast(mode.label, 1300);
});

$('#btn-rules-home').addEventListener('click', () => openModal('#modal-rules'));
$('#btn-rules-game').addEventListener('click', () => openModal('#modal-rules'));
$('#btn-close-rules').addEventListener('click', () => closeModal('#modal-rules'));
$('#modal-rules').addEventListener('click', (ev) => {
  if (ev.target === $('#modal-rules')) closeModal('#modal-rules');
});

$('#input-code').addEventListener('input', (ev) => {
  ev.target.value = ev.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    keepAwake();
    send({ type: 'sync' });
  }
});

// ═══════════════════════════════ arranque ═══════════════════════════════

function boot() {
  $('#input-name').value = store.name;
  $('#btn-sound').textContent = sound.mode.icon;

  const codeFromUrl = location.pathname.slice(1).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  if (codeFromUrl.length === 4) $('#input-code').value = codeFromUrl;

  connect();

  // Con nombre guardado y código en la URL, entramos directo.
  if (codeFromUrl.length === 4 && store.name) {
    pendingJoin = { name: store.name, code: codeFromUrl };
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

boot();
