// Motor de "Turco": truco argentino de a 3 (2 juegan, 1 mira).
//
// Reglas propias del Turco:
//  1. Tres jugadores: dos juegan, el tercero mira ambas manos.
//  2. Al cantar envido NO se dice el tanto: si hay quiero, se revela recién al final de la ronda.
//  3. Gana la ronda quien más puntos hace en ella (envido + truco). Eso vale 1 punto en la general.
//  4. Si empatan en puntos, se redan cartas entre esos dos y queda 1 punto en el pozo.
//     Cada empate suma 1 al pozo (máx. 5). El que finalmente gana se lleva todo el pozo.
//  5. El ganador se queda y entra el que miraba; el perdedor pasa a mirar.
//  6. Gana el juego el primero en llegar a 15 puntos.
//  7. Si llega a 15 sin haber perdido nunca una ronda, se lleva el trofeo MAGISTRAL.
//
// Casas de la casa (elegidas al configurar): sin flor, Falta Envido vale 4,
// y el ganador arranca siendo mano; en las redadas por pozo la mano alterna.

import { newDeck, shuffle, power, envidoOf, envidoBreakdown, cardLabel } from './deck.js';

export const TARGET = 15;
export const MAX_POT = 5;
export const FALTA_ENVIDO_VALUE = 4;

const ENVIDO_CALLS = ['ENVIDO', 'REAL_ENVIDO', 'FALTA_ENVIDO'];
const TRUCO_CALLS = ['TRUCO', 'RETRUCO', 'VALE_CUATRO'];

const TRUCO_QUERIDO = { 1: 2, 2: 3, 3: 4 };
const TRUCO_NO_QUERIDO = { 1: 1, 2: 2, 3: 3 };

export const CALL_NAMES = {
  ENVIDO: 'Envido',
  REAL_ENVIDO: 'Real Envido',
  FALTA_ENVIDO: 'Falta Envido',
  TRUCO: 'Truco',
  RETRUCO: 'Retruco',
  VALE_CUATRO: 'Vale Cuatro',
  QUIERO: 'Quiero',
  NO_QUIERO: 'No quiero',
  MAZO: 'Me voy al mazo',
  SHOW_TANTOS: 'Muestro los tantos',
};

// ---------------------------------------------------------------- valores

/** Puntos del envido si hay quiero. */
function envidoChainValue(chain) {
  if (chain.includes('FALTA_ENVIDO')) return FALTA_ENVIDO_VALUE;
  return chain.reduce((sum, c) => sum + (c === 'REAL_ENVIDO' ? 3 : 2), 0);
}

/** Puntos del envido si hay no quiero: lo que valía antes del último canto (mínimo 1). */
function envidoNoQuieroValue(chain) {
  const previous = chain.slice(0, -1);
  return Math.max(1, envidoChainValue(previous));
}

/** Qué se puede cantar a continuación en la escalera del envido. */
function envidoRaises(chain) {
  if (chain.length === 0) return ['ENVIDO', 'REAL_ENVIDO', 'FALTA_ENVIDO'];
  const last = chain[chain.length - 1];
  if (last === 'FALTA_ENVIDO') return [];
  if (last === 'REAL_ENVIDO') return ['FALTA_ENVIDO'];
  // último fue ENVIDO: se puede repetir envido una sola vez
  const envidoCount = chain.filter((c) => c === 'ENVIDO').length;
  return envidoCount >= 2
    ? ['REAL_ENVIDO', 'FALTA_ENVIDO']
    : ['ENVIDO', 'REAL_ENVIDO', 'FALTA_ENVIDO'];
}

function nextTrucoCall(chain) {
  return TRUCO_CALLS[chain.length] ?? null;
}

// ---------------------------------------------------------------- partida

export function createMatch(players) {
  const match = {
    players: players.map((p) => ({ id: p.id, name: p.name, score: 0, neverLost: true })),
    seats: [players[0].id, players[1].id],
    spectator: players[2].id,
    manoIdx: 0,
    pot: 0,
    roundNo: 0,
    phase: 'draw', // draw | playing | roundEnd | gameEnd
    round: null,
    draw: null,
    lastOutcome: null,
    nextReady: [], // quiénes ya aceptaron pasar a la ronda siguiente
    gameOver: null,
  };
  runDraw(match);
  return match;
}

/**
 * Sorteo de apertura: se da una carta a cada uno y juegan los dos más altos;
 * el más bajo mira. Si hay empate se vuelve a dar de a una hasta desempatar.
 * La carta más alta arranca de mano.
 */
export function runDraw(match) {
  let deck = shuffle(newDeck());
  const rounds = [];
  let decided = null;

  for (let attempt = 0; attempt < 12 && !decided; attempt++) {
    if (deck.length < match.players.length) deck = shuffle(newDeck());
    const dealt = match.players.map((p) => ({ id: p.id, name: p.name, card: deck.pop() }));
    rounds.push(dealt);
    const powers = dealt.map((d) => power(d.card));
    if (new Set(powers).size === powers.length) decided = dealt;
  }
  // Con 40 cartas esto no debería pasar nunca, pero no dejamos la partida colgada.
  if (!decided) decided = rounds[rounds.length - 1];

  const ranked = decided.slice().sort((a, b) => power(b.card) - power(a.card));
  match.draw = { rounds, ranked, retries: rounds.length - 1 };
  match.seats = [ranked[0].id, ranked[1].id];
  match.spectator = ranked[2].id;
  match.manoIdx = 0; // la carta más alta es mano
  match.phase = 'draw';
  return match.draw;
}

export function playerById(match, id) {
  return match.players.find((p) => p.id === id) ?? null;
}

export function startRound(match) {
  const deck = shuffle(newDeck());
  match.roundNo += 1;
  match.phase = 'playing';
  match.round = {
    hands: [
      deck.slice(0, 3).map((card) => ({ card, played: false })),
      deck.slice(3, 6).map((card) => ({ card, played: false })),
    ],
    tricks: [{ cards: [null, null], leader: match.manoIdx, winner: null }],
    results: [], // 'tie' | 0 | 1 por baza resuelta
    turn: match.manoIdx,
    envido: { chain: [], pending: null, caller: null, accepted: false, closed: false, result: null },
    truco: { chain: [], pending: null, caller: null, accepted: false, accepterIdx: null },
    foldedBy: null,
    showedTantos: null,
    // Quien mira arranca sin ver nada: tiene que pedir permiso a cada jugador,
    // y el permiso dura sólo esta ronda.
    peek: { requested: [false, false], granted: [false, false], denied: [false, false] },
    log: [],
    logSeq: 0,
    finished: false,
  };
  return match.round;
}

// ---------------------------------------------------------------- turnos

/** Quién tiene que actuar: primero responder envido, después truco, después jugar carta. */
export function toAct(round) {
  if (round.finished) return null;
  if (round.envido.pending !== null) return round.envido.pending;
  if (round.truco.pending !== null) return round.truco.pending;
  return round.turn;
}

function cardsOnFirstTrick(round) {
  return round.tricks[0].cards.filter((c) => c !== null).length;
}

function envidoStillOpen(round) {
  const { envido } = round;
  if (envido.closed) return false;
  if (round.tricks.length > 1) return false;
  // Una vez completada la primera baza ya no se canta envido.
  return cardsOnFirstTrick(round) < 2 || envido.pending !== null;
}

// ---------------------------------------------------------------- acciones legales

export function legalActions(match, idx) {
  const round = match.round;
  if (!round || match.phase !== 'playing' || round.finished) return [];
  if (idx !== 0 && idx !== 1) return [];
  if (toAct(round) !== idx) return [];

  const actions = [];
  const { envido, truco } = round;

  // ---- responder envido (con posibilidad de subir la apuesta)
  if (envido.pending === idx) {
    actions.push('QUIERO', 'NO_QUIERO', ...envidoRaises(envido.chain));
    return actions;
  }

  // ---- cantar envido: sólo en la primera baza, y "el envido va primero"
  if (envidoStillOpen(round) && envido.chain.length === 0) {
    actions.push(...envidoRaises([]));
  }

  // ---- responder truco (o subirlo como contracanto)
  if (truco.pending === idx) {
    actions.push('QUIERO', 'NO_QUIERO');
    const next = nextTrucoCall(truco.chain);
    if (next) actions.push(next);
    // Con el envido querido podés cortar acá mismo y definir por tanto.
    if (envido.accepted) actions.push('SHOW_TANTOS');
    actions.push('MAZO');
    return actions;
  }

  // ---- cantar/subir truco en mi turno
  const next = nextTrucoCall(truco.chain);
  if (next) {
    const canOpen = truco.chain.length === 0;
    const canRaise = truco.accepted && truco.accepterIdx === idx;
    if (canOpen || canRaise) actions.push(next);
  }

  // ---- jugar carta
  if (round.hands[idx].some((h) => !h.played)) actions.push('PLAY');

  // ---- mostrar los tantos: sólo tiene sentido con el envido querido
  if (envido.accepted) actions.push('SHOW_TANTOS');

  actions.push('MAZO');
  return actions;
}

// ---------------------------------------------------------------- aplicar acción

// ---------------------------------------------------------------- permisos para mirar

/** Quien mira pide ver la mano de una silla. Queda esperando el sí o el no. */
function peekRequest(match, playerId, seat) {
  const { peek } = match.round;
  if (match.spectator !== playerId) return { error: 'Sólo quien mira puede pedir ver las cartas.' };
  if (seat !== 0 && seat !== 1) return { error: 'Esa silla no existe.' };
  if (peek.granted[seat]) return { error: 'Ya te dejó ver sus cartas.' };
  if (peek.denied[seat]) return { error: 'Ya te dijo que no en esta ronda.' };
  if (peek.requested[seat]) return { error: 'Ya se lo pediste: falta que conteste.' };
  peek.requested[seat] = true;
  return { ok: true };
}

/** El dueño de las cartas contesta. El permiso vale sólo para esta ronda. */
function peekAnswer(match, playerId, yes) {
  const { peek } = match.round;
  const idx = match.seats.indexOf(playerId);
  if (idx === -1) return { error: 'No estás jugando esta ronda.' };
  if (!peek.requested[idx]) return { error: 'Nadie te pidió ver tus cartas.' };
  peek.requested[idx] = false;
  if (yes) peek.granted[idx] = true;
  else peek.denied[idx] = true;
  return { ok: true };
}

export function applyAction(match, playerId, action) {
  const round = match.round;
  if (!round || match.phase !== 'playing') return { error: 'La ronda no está en juego.' };

  // Pedir y dar permiso para mirar va por fuera del turno: no interrumpe la mano.
  if (action?.type === 'PEEK_REQUEST') return peekRequest(match, playerId, action.seat);
  if (action?.type === 'PEEK_YES') return peekAnswer(match, playerId, true);
  if (action?.type === 'PEEK_NO') return peekAnswer(match, playerId, false);

  const idx = match.seats.indexOf(playerId);
  if (idx === -1) return { error: 'Estás de espectador: no podés jugar esta ronda.' };
  if (round.finished) return { error: 'La ronda ya terminó.' };
  if (toAct(round) !== idx) return { error: 'No es tu turno.' };

  const type = action?.type;
  const legal = legalActions(match, idx);
  if (!legal.includes(type)) return { error: 'Esa jugada no está permitida ahora.' };

  switch (type) {
    case 'PLAY':
      return playCard(match, idx, action.cardIndex);
    case 'ENVIDO':
    case 'REAL_ENVIDO':
    case 'FALTA_ENVIDO':
      return callEnvido(match, idx, type);
    case 'TRUCO':
    case 'RETRUCO':
    case 'VALE_CUATRO':
      return callTruco(match, idx, type);
    case 'QUIERO':
      return answer(match, idx, true);
    case 'NO_QUIERO':
      return answer(match, idx, false);
    case 'SHOW_TANTOS':
      return showTantos(match, idx);
    case 'MAZO':
      return goToMazo(match, idx);
    default:
      return { error: 'Acción desconocida.' };
  }
}

/**
 * Anota lo que pasó. `kind` es lo que usa el cliente para elegir el sonido;
 * `n` es un contador que le permite saber qué entradas son nuevas.
 */
function log(round, idx, text, kind) {
  round.logSeq += 1;
  round.log.push({ n: round.logSeq, who: idx, text, kind });
  if (round.log.length > 40) round.log.shift();
}

function callEnvido(match, idx, type) {
  const round = match.round;
  round.envido.chain.push(type);
  round.envido.caller = idx;
  round.envido.pending = 1 - idx;
  log(round, idx, CALL_NAMES[type], type);
  return { ok: true };
}

function callTruco(match, idx, type) {
  const round = match.round;
  round.truco.chain.push(type);
  round.truco.caller = idx;
  round.truco.pending = 1 - idx;
  round.truco.accepted = false;
  round.truco.accepterIdx = null;
  log(round, idx, CALL_NAMES[type], type);
  return { ok: true };
}

function answer(match, idx, quiero) {
  const round = match.round;
  const { envido, truco } = round;

  if (envido.pending === idx) {
    envido.pending = null;
    envido.closed = true;
    log(round, idx, quiero ? 'Quiero (envido)' : 'No quiero (envido)',
      quiero ? 'QUIERO_ENVIDO' : 'NO_QUIERO_ENVIDO');
    if (quiero) {
      // Turco: NO se cantan los tantos. Se guarda el valor y se revela al final.
      envido.accepted = true;
      envido.result = { type: 'quiero', value: envidoChainValue(envido.chain) };
    } else {
      envido.result = {
        type: 'noquiero',
        value: envidoNoQuieroValue(envido.chain),
        winner: envido.caller,
      };
    }
    return { ok: true };
  }

  if (truco.pending === idx) {
    truco.pending = null;
    log(round, idx, quiero ? 'Quiero (truco)' : 'No quiero (truco)',
      quiero ? 'QUIERO_TRUCO' : 'NO_QUIERO_TRUCO');
    if (quiero) {
      truco.accepted = true;
      truco.accepterIdx = idx;
      // "El envido va primero" sólo vale mientras el truco está sin responder.
      // Si lo quisiste sin cantar envido, la ventana del envido se cerró.
      round.envido.closed = true;
      return { ok: true };
    }
    return finishRound(match, {
      trucoWinner: truco.caller,
      trucoPoints: TRUCO_NO_QUERIDO[truco.chain.length],
      trucoReason: `${CALL_NAMES[truco.chain[truco.chain.length - 1]]} no querido`,
    });
  }

  return { error: 'No hay nada que responder.' };
}

/** Lo que vale el truco para el que abandona la mano en este momento. */
function trucoStakeOnFold(truco, idx) {
  if (truco.pending === idx) return TRUCO_NO_QUERIDO[truco.chain.length];
  if (truco.accepted) return TRUCO_QUERIDO[truco.chain.length];
  return truco.chain.length ? TRUCO_NO_QUERIDO[truco.chain.length] : 1;
}

/**
 * "Muestro los tantos": con el envido ya querido, uno confía en su tanto y corta
 * la mano ahí mismo. Le regala el truco al otro y la ronda se define por el envido.
 */
function showTantos(match, idx) {
  const round = match.round;
  round.showedTantos = idx;
  log(round, idx, 'Mostró los tantos', 'SHOW_TANTOS');
  return finishRound(match, {
    trucoWinner: 1 - idx,
    trucoPoints: trucoStakeOnFold(round.truco, idx),
    trucoReason: 'Mostró los tantos',
  });
}

function goToMazo(match, idx) {
  const round = match.round;
  const { truco } = round;
  round.foldedBy = idx;
  log(round, idx, 'Se fue al mazo', 'MAZO');

  // Si había envido pendiente, se toma como no querido.
  if (round.envido.pending === idx) {
    round.envido.pending = null;
    round.envido.closed = true;
    round.envido.result = {
      type: 'noquiero',
      value: envidoNoQuieroValue(round.envido.chain),
      winner: round.envido.caller,
    };
  }

  return finishRound(match, {
    trucoWinner: 1 - idx,
    trucoPoints: trucoStakeOnFold(truco, idx),
    trucoReason: 'Se fue al mazo',
  });
}

function playCard(match, idx, cardIndex) {
  const round = match.round;
  const slot = round.hands[idx][cardIndex];
  if (!slot) return { error: 'Esa carta no existe.' };
  if (slot.played) return { error: 'Esa carta ya la jugaste.' };

  slot.played = true;
  const trick = round.tricks[round.tricks.length - 1];
  trick.cards[idx] = slot.card;
  log(round, idx, `Jugó ${cardLabel(slot.card)}`, 'PLAY');

  const [a, b] = trick.cards;
  if (a === null || b === null) {
    round.turn = 1 - idx;
    // Al completarse el primer canto de carta el envido sigue vivo hasta cerrar la baza.
    return { ok: true };
  }

  // Baza completa: resolver.
  const pa = power(a);
  const pb = power(b);
  const winner = pa === pb ? 'tie' : pa > pb ? 0 : 1;
  trick.winner = winner;
  round.results.push(winner);

  // Cerrada la primera baza ya no se puede cantar envido.
  if (round.results.length === 1) round.envido.closed = true;

  const decided = trickWinnerOfRound(round.results, match.manoIdx);
  if (decided !== null || round.results.length === 3) {
    const trucoWinner = decided !== null ? decided : match.manoIdx;
    const points = round.truco.accepted
      ? TRUCO_QUERIDO[round.truco.chain.length]
      : 1;
    return finishRound(match, {
      trucoWinner,
      trucoPoints: points,
      trucoReason: round.truco.accepted
        ? `${CALL_NAMES[round.truco.chain[round.truco.chain.length - 1]]} querido`
        : 'Ganó las bazas',
    });
  }

  // Sigue: nueva baza, la abre el ganador (en parda, quien la había abierto).
  const nextLeader = winner === 'tie' ? trick.leader : winner;
  round.tricks.push({ cards: [null, null], leader: nextLeader, winner: null });
  round.turn = nextLeader;
  return { ok: true };
}

/** Quién gana las bazas. Devuelve 0, 1 o null si todavía no está definido. */
export function trickWinnerOfRound(results, manoIdx) {
  const [a, b, c] = results;
  if (results.length >= 2) {
    if (a === 'tie' && b !== 'tie') return b;
    if (a !== 'tie' && b === a) return a;
    if (a !== 'tie' && b === 'tie') return a;
  }
  if (results.length === 3) {
    if (c !== 'tie') return c;
    if (a !== 'tie') return a;
    if (b !== 'tie') return b;
    return manoIdx;
  }
  return null;
}

// ---------------------------------------------------------------- cierre de ronda

function finishRound(match, { trucoWinner, trucoPoints, trucoReason }) {
  const round = match.round;
  round.finished = true;

  const roundPoints = [0, 0];
  roundPoints[trucoWinner] += trucoPoints;

  const hands = round.hands.map((h) => h.map((s) => s.card));
  const tantos = hands.map((cards) => envidoOf(cards));

  // Envido: recién ahora se revelan los tantos (regla 2).
  let envidoSummary = { played: round.envido.chain.length > 0, chain: round.envido.chain.slice() };
  const res = round.envido.result;
  if (res?.type === 'quiero') {
    const winner = tantos[0] === tantos[1] ? match.manoIdx : tantos[0] > tantos[1] ? 0 : 1;
    roundPoints[winner] += res.value;
    envidoSummary = {
      ...envidoSummary,
      type: 'quiero',
      value: res.value,
      winner,
      tantos,
      tie: tantos[0] === tantos[1],
    };
  } else if (res?.type === 'noquiero') {
    roundPoints[res.winner] += res.value;
    envidoSummary = { ...envidoSummary, type: 'noquiero', value: res.value, winner: res.winner, tantos };
  } else {
    envidoSummary = { ...envidoSummary, type: null, tantos };
  }

  // ── Pacto: al cerrar la ronda no se muestra la mano entera.
  // Sólo se ven las cartas que ya estaban sobre la mesa y, si el envido fue
  // querido, las que justifican el tanto. Si no queda nada a la vista, es PACTO.
  const envidoQuerido = res?.type === 'quiero';
  const revealedHands = round.hands.map((hand, i) => {
    const show = new Set();
    hand.forEach((slot, j) => { if (slot.played) show.add(j); });
    if (envidoQuerido) for (const j of envidoBreakdown(hands[i]).indices) show.add(j);
    return hand.map((slot, j) => (show.has(j) ? slot.card : null));
  });
  const pacto = revealedHands.every((hand) => hand.every((card) => card === null));

  // En el resumen las cartas se muestran en el orden en que se tiraron
  // (1ª, 2ª, 3ª baza); las que quedaron en la mano van después.
  const playOrder = round.hands.map((hand, i) => {
    const order = [];
    for (const trick of round.tricks) {
      const card = trick.cards[i];
      if (!card) continue;
      const j = hand.findIndex((slot) => slot.card.id === card.id);
      if (j !== -1 && !order.includes(j)) order.push(j);
    }
    hand.forEach((_, j) => { if (!order.includes(j)) order.push(j); });
    return order;
  });
  const inPlayOrder = (rows) => rows.map((row, i) => playOrder[i].map((j) => row[j]));

  const tie = roundPoints[0] === roundPoints[1];
  const winnerIdx = tie ? null : roundPoints[0] > roundPoints[1] ? 0 : 1;

  const potBefore = match.pot;
  let awarded = 0;
  let winnerId = null;
  let loserId = null;

  if (tie) {
    // Regla 4: empate → se redan cartas entre los mismos dos y crece el pozo.
    match.pot = Math.min(MAX_POT, match.pot + 1);
  } else {
    winnerId = match.seats[winnerIdx];
    loserId = match.seats[1 - winnerIdx];
    awarded = Math.max(1, match.pot);
    const winner = playerById(match, winnerId);
    winner.score += awarded;
    playerById(match, loserId).neverLost = false;
    match.pot = 0;
  }

  match.lastOutcome = {
    roundNo: match.roundNo,
    seats: match.seats.slice(),
    spectator: match.spectator,
    manoIdx: match.manoIdx,
    hands: inPlayOrder(hands), // manos completas: sólo para quien tenía permiso
    revealedHands: inPlayOrder(revealedHands), // lo que se destapa por el pacto
    peekGranted: round.peek.granted.slice(),
    pacto,
    trucoWinner,
    trucoPoints,
    trucoReason,
    envido: envidoSummary,
    roundPoints,
    tie,
    winnerIdx,
    winnerId,
    loserId,
    potBefore,
    potAfter: match.pot,
    awarded,
    foldedBy: round.foldedBy,
    showedTantos: round.showedTantos,
  };

  const champion = match.players.find((p) => p.score >= TARGET);
  if (champion) {
    match.phase = 'gameEnd';
    match.gameOver = {
      winnerId: champion.id,
      winnerName: champion.name,
      magistral: champion.neverLost,
    };
  } else {
    match.phase = 'roundEnd';
    match.nextReady = [];
  }

  return { ok: true, roundFinished: true };
}

/**
 * Arranca la partida tras el sorteo, o prepara la siguiente ronda.
 * Al cerrar una ronda hacen falta los dos que jugaron: `playerId` marca a uno y
 * la ronda avanza recién cuando están los dos (o cuando el otro se desconectó).
 */
export function advance(match, playerId = null, connected = null) {
  if (match.phase === 'draw') {
    startRound(match);
    return { ok: true };
  }
  if (match.phase !== 'roundEnd') return { error: 'La ronda todavía no terminó.' };

  if (playerId) {
    const jugaron = match.lastOutcome?.seats ?? match.seats;
    if (!jugaron.includes(playerId)) return { error: 'Sólo confirman los que jugaron la ronda.' };
    if (!match.nextReady.includes(playerId)) match.nextReady.push(playerId);

    // Si alguien se cayó, no bloqueamos la mesa esperándolo.
    const faltan = jugaron.filter(
      (id) => !match.nextReady.includes(id) && (connected ? connected(id) : true),
    );
    if (faltan.length) return { ok: true, waiting: faltan };
  }
  match.nextReady = [];
  const out = match.lastOutcome;

  if (out.tie) {
    // Mismos dos jugadores; la mano pasa al contrincante.
    match.manoIdx = 1 - match.manoIdx;
  } else {
    // El ganador se queda y es mano; entra el que miraba, sale el perdedor.
    const previousSpectator = match.spectator;
    match.seats = [out.winnerId, previousSpectator];
    match.spectator = out.loserId;
    match.manoIdx = 0;
  }

  startRound(match);
  return { ok: true };
}

// ---------------------------------------------------------------- vista por jugador

/**
 * Resultado de la ronda tal como lo puede ver este jugador.
 * Se combina lo que el pacto destapa con lo que ya tenía permiso de ver.
 */
function outcomeFor(match, playerId, isTv, tvPeek = new Set()) {
  const o = match.lastOutcome;
  if (!o) return null;

  const seatIdx = o.seats.indexOf(playerId);
  const wasSpectator = !isTv && o.spectator === playerId;
  const granted = o.peekGranted ?? [false, false];
  const sawSeat = (i) =>
    isTv ? tvPeek.has(o.seats[i]) : i === seatIdx || (wasSpectator && granted[i]);

  // Mano completa si ya la podía ver; si no, sólo lo que el pacto destapa.
  const hands = o.revealedHands.map((revealed, i) => (sawSeat(i) ? o.hands[i] : revealed));

  // Con envido querido los tantos son públicos: justifican los puntos.
  // Si no, cada uno sólo ve el tanto de la mano que tenía permitido mirar.
  const envido = { ...o.envido };
  if (envido.type !== 'quiero') {
    envido.tantos = [0, 1].map((i) => (sawSeat(i) ? o.envido.tantos[i] : null));
  }

  const { revealedHands, peekGranted, ...rest } = o;
  return {
    ...rest,
    envido,
    hands,
    sawEverything: sawSeat(0) && sawSeat(1),
  };
}

/**
 * @param {string|null} playerId
 * @param {{tv?: boolean, tvPeek?: Set<string>}} opts
 *   modo TV: pantalla pública. Sólo ve la mano de quien le dio permiso, y ese
 *   permiso lo otorga cada jugador por separado y dura toda la partida.
 */
export function viewFor(match, playerId, opts = {}) {
  const isTv = opts.tv === true;
  const tvPeek = opts.tvPeek ?? new Set();
  const me = playerById(match, playerId);
  const seatIdx = isTv ? -1 : match.seats.indexOf(playerId);
  const isSpectator = seatIdx === -1;
  const round = match.round;

  const base = {
    phase: match.phase,
    pot: match.pot,
    target: TARGET,
    maxPot: MAX_POT,
    faltaEnvidoValue: FALTA_ENVIDO_VALUE,
    roundNo: match.roundNo,
    you: { id: playerId, name: me?.name ?? '', seatIdx, isSpectator, isTv },
    seats: match.seats.slice(),
    spectator: match.spectator,
    players: match.players.map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      neverLost: p.neverLost,
    })),
    gameOver: match.gameOver,
    draw: match.draw,
    nextReady: match.nextReady ?? [],
    outcome:
      match.phase === 'roundEnd' || match.phase === 'gameEnd'
        ? outcomeFor(match, playerId, isTv, tvPeek)
        : null,
  };

  if (!round) return { ...base, round: null };

  // Cada uno ve su mano. Quien mira ve sólo las que le dieron permiso en esta
  // ronda; la tele, sólo las que le habilitaron para toda la partida.
  const sees = (i) => {
    if (isTv) return tvPeek.has(match.seats[i]);
    if (i === seatIdx) return true;
    return isSpectator && round.peek.granted[i];
  };

  const hands = round.hands.map((hand, i) =>
    hand.map((slot) =>
      sees(i) ? { card: slot.card, played: slot.played } : { hidden: true, played: slot.played },
    ),
  );

  const acting = toAct(round);

  return {
    ...base,
    round: {
      manoIdx: match.manoIdx,
      turn: round.turn,
      acting,
      hands,
      tricks: round.tricks.map((t) => ({ cards: t.cards, leader: t.leader, winner: t.winner })),
      results: round.results,
      envido: {
        chain: round.envido.chain,
        pending: round.envido.pending,
        caller: round.envido.caller,
        accepted: round.envido.accepted,
        closed: round.envido.closed,
        value: round.envido.accepted ? round.envido.result.value : 0,
        // El "no quiero" es información pública (sale de la escalera cantada).
        result: round.envido.result
          ? {
              type: round.envido.result.type,
              value: round.envido.result.value,
              winner: round.envido.result.winner ?? null,
            }
          : null,
        // Un tanto por silla, pero sólo el de las manos que uno tiene permitido ver.
        tantos: [0, 1].map((i) =>
          sees(i) ? envidoOf(round.hands[i].map((s) => s.card)) : null,
        ),
      },
      truco: {
        chain: round.truco.chain,
        pending: round.truco.pending,
        caller: round.truco.caller,
        accepted: round.truco.accepted,
        value: round.truco.accepted ? TRUCO_QUERIDO[round.truco.chain.length] : 1,
      },
      log: round.log.slice(-12),
      actions: isSpectator ? [] : legalActions(match, seatIdx),
      peek: isTv ? null : round.peek,
      finished: round.finished,
    },
  };
}
