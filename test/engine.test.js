// Pruebas del motor de Turco.
import assert from 'node:assert/strict';
import {
  createMatch, startRound, applyAction, advance, viewFor, legalActions,
  trickWinnerOfRound, TARGET, MAX_POT,
} from '../server/game.js';
import { envidoOf, envidoBreakdown, power, newDeck } from '../server/deck.js';

let pass = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n     ${e.message}`); process.exitCode = 1; }
};

const C = (rank, suit) => ({ rank, suit, id: `${rank}-${suit}` });
const P = [{id:'a',name:'Ana'},{id:'b',name:'Beto'},{id:'c',name:'Caro'}];

/** Partida lista para jugar, con las sillas ya sorteadas. */
const mkMatch = () => { const m = createMatch(P); startRound(m); return m; };
const act = (m, seat, type, extra = {}) => {
  const r = applyAction(m, m.seats[seat], { type, ...extra });
  assert.ok(!r.error, `acción ${type} de la silla ${seat} falló: ${r.error}`);
  return r;
};
const seated = (m, seat) => m.players.find((p) => p.id === m.seats[seat]);

/** El que mira pide ver la mano de una silla y el dueño acepta. */
const pedirYAceptar = (m, seat) => {
  let r = applyAction(m, m.spectator, { type: 'PEEK_REQUEST', seat });
  assert.ok(!r.error, `pedir permiso falló: ${r.error}`);
  r = applyAction(m, m.seats[seat], { type: 'PEEK_YES' });
  assert.ok(!r.error, `aceptar falló: ${r.error}`);
};

// ───────────────────────── mazo ─────────────────────────
console.log('\nMazo y jerarquía');

t('mazo de 40 cartas únicas', () => {
  const d = newDeck();
  assert.equal(d.length, 40);
  assert.equal(new Set(d.map((c) => c.id)).size, 40);
});

t('jerarquía: 1 espada > 1 basto > 7 espada > 7 oro > 3 > 2 > 1 oro', () => {
  const order = [C(1,'espada'), C(1,'basto'), C(7,'espada'), C(7,'oro'), C(3,'copa'), C(2,'copa'), C(1,'oro')];
  for (let i = 0; i < order.length - 1; i++) {
    assert.ok(power(order[i]) > power(order[i+1]), `${order[i].id} debe ganarle a ${order[i+1].id}`);
  }
});

t('7 falso pierde contra sota', () => {
  assert.ok(power(C(10,'oro')) > power(C(7,'copa')));
});

t('tanto: dos del mismo palo suman +20', () => {
  assert.equal(envidoOf([C(7,'oro'), C(6,'oro'), C(4,'copa')]), 33);
  assert.equal(envidoOf([C(12,'oro'), C(11,'oro'), C(4,'copa')]), 20);
  assert.equal(envidoOf([C(7,'oro'), C(5,'copa'), C(3,'basto')]), 7);
  assert.equal(envidoOf([C(12,'oro'), C(11,'copa'), C(10,'basto')]), 0);
  assert.equal(envidoOf([C(7,'oro'), C(6,'oro'), C(5,'oro')]), 33); // toma las dos mejores
});

t('el tanto sabe QUÉ cartas lo forman', () => {
  // par del mismo palo → esas dos
  let b = envidoBreakdown([C(7,'oro'), C(6,'oro'), C(3,'copa')]);
  assert.equal(b.value, 33);
  assert.deepEqual(b.indices.slice().sort(), [0, 1]);
  // tres del mismo palo → las dos más altas
  b = envidoBreakdown([C(5,'oro'), C(7,'oro'), C(6,'oro')]);
  assert.equal(b.value, 33);
  assert.deepEqual(b.indices.slice().sort(), [1, 2]);
  // sin par → una sola carta
  b = envidoBreakdown([C(7,'oro'), C(5,'copa'), C(3,'basto')]);
  assert.equal(b.value, 7);
  assert.deepEqual(b.indices, [0]);
});

// ───────────────────────── bazas ─────────────────────────
console.log('\nResolución de bazas');

t('gana quien se lleva dos bazas', () => {
  assert.equal(trickWinnerOfRound([0, 0], 0), 0);
  assert.equal(trickWinnerOfRound([1, 0, 1], 0), 1);
});
t('primera parda: gana la segunda', () => assert.equal(trickWinnerOfRound(['tie', 1], 0), 1));
t('gana primera y parda la segunda', () => assert.equal(trickWinnerOfRound([0, 'tie'], 1), 0));
t('parda la tercera: gana el de la primera', () => assert.equal(trickWinnerOfRound([1, 0, 'tie'], 0), 1));
t('las tres pardas: gana la mano', () => assert.equal(trickWinnerOfRound(['tie','tie','tie'], 1), 1));
t('sin definir todavía', () => {
  assert.equal(trickWinnerOfRound([0], 0), null);
  assert.equal(trickWinnerOfRound([0, 1], 0), null);
});

// ───────────────────────── sorteo de apertura ─────────────────────────
console.log('\nSorteo de apertura');

t('la partida arranca en fase de sorteo', () => {
  const m = createMatch(P);
  assert.equal(m.phase, 'draw');
  assert.equal(m.round, null, 'todavía no se reparten las manos');
});

t('se da una carta a cada uno y juegan las dos más altas', () => {
  for (let i = 0; i < 300; i++) {
    const m = createMatch(P);
    const ranked = m.draw.ranked;
    assert.equal(ranked.length, 3);
    assert.ok(power(ranked[0].card) > power(ranked[1].card), 'ranking estrictamente ordenado');
    assert.ok(power(ranked[1].card) > power(ranked[2].card));
    assert.deepEqual(m.seats, [ranked[0].id, ranked[1].id], 'juegan las dos más altas');
    assert.equal(m.spectator, ranked[2].id, 'la más baja mira');
    assert.equal(m.manoIdx, 0, 'la carta más alta es mano');
  }
});

t('si hay empate se vuelve a dar', () => {
  let sawRetry = false;
  for (let i = 0; i < 400 && !sawRetry; i++) {
    const m = createMatch(P);
    if (m.draw.retries > 0) {
      sawRetry = true;
      // las vueltas previas tienen que haber tenido al menos dos cartas iguales
      for (const round of m.draw.rounds.slice(0, -1)) {
        const powers = round.map((d) => power(d.card));
        assert.ok(new Set(powers).size < 3, 'sólo se vuelve a dar si hubo empate');
      }
      const finalPowers = m.draw.rounds.at(-1).map((d) => power(d.card));
      assert.equal(new Set(finalPowers).size, 3, 'la última vuelta desempata');
    }
  }
  assert.ok(sawRetry, 'en 400 sorteos debería haber salido al menos un empate');
});

t('todos ven el sorteo', () => {
  const m = createMatch(P);
  for (const id of ['a','b','c']) {
    const v = viewFor(m, id);
    assert.equal(v.phase, 'draw');
    assert.ok(v.draw.ranked.every((r) => r.card?.rank), 'las 3 cartas del sorteo son visibles');
  }
});

t('desde el sorteo, "siguiente" reparte la primera mano', () => {
  const m = createMatch(P);
  advance(m);
  assert.equal(m.phase, 'playing');
  assert.equal(m.round.hands[0].length, 3);
});

// ───────────────────────── partida ─────────────────────────
console.log('\nFlujo de partida');

t('2 en la mesa y 1 mirando, sin repetidos', () => {
  const m = mkMatch();
  assert.equal(new Set([...m.seats, m.spectator]).size, 3);
  assert.ok(!m.seats.includes(m.spectator));
});

t('el espectador no puede jugar', () => {
  const m = mkMatch();
  const r = applyAction(m, m.spectator, { type: 'PLAY', cardIndex: 0 });
  assert.match(r.error, /espectador/);
});

t('no se puede jugar fuera de turno', () => {
  const m = mkMatch();
  const r = applyAction(m, m.seats[1], { type: 'PLAY', cardIndex: 0 });
  assert.match(r.error, /turno/);
});

t('el envido se puede cantar en la primera baza y se cierra después', () => {
  const m = mkMatch();
  assert.ok(legalActions(m, 0).includes('ENVIDO'));
  act(m, 0, 'PLAY', { cardIndex: 0 });
  assert.ok(legalActions(m, 1).includes('ENVIDO'), 'el pie todavía puede cantar');
  act(m, 1, 'PLAY', { cardIndex: 0 });
  assert.ok(!legalActions(m, m.round.turn).includes('ENVIDO'), 'cerrada la primera baza ya no se canta');
});

t('el envido querido NO revela el tanto del rival hasta el final', () => {
  const m = mkMatch();
  act(m, 0, 'ENVIDO');
  act(m, 1, 'QUIERO');
  const v = viewFor(m, m.seats[0]);
  assert.equal(v.round.envido.tantos[1], null, 'no se ve el tanto del rival');
  assert.ok(v.round.envido.tantos[0] != null, 'el propio sí, es su mano');
  assert.equal(v.round.envido.value, 2, 'sí se sabe cuánto se juega');
});

t('el jugador NO ve la mano del rival', () => {
  const m = mkMatch();
  const v = viewFor(m, m.seats[0]);
  assert.ok(v.round.hands[0][0].card, 've la propia');
  assert.equal(v.round.hands[1][0].hidden, true, 'no ve la del rival');
});

t('escalera del envido: envido, envido, real → 7', () => {
  const m = mkMatch();
  act(m, 0, 'ENVIDO'); act(m, 1, 'ENVIDO'); act(m, 0, 'REAL_ENVIDO'); act(m, 1, 'QUIERO');
  assert.equal(m.round.envido.result.value, 7);
});

t('no quiero al envido envido paga 2', () => {
  const m = mkMatch();
  act(m, 0, 'ENVIDO'); act(m, 1, 'ENVIDO'); act(m, 0, 'NO_QUIERO');
  assert.equal(m.round.envido.result.type, 'noquiero');
  assert.equal(m.round.envido.result.value, 2);
  assert.equal(m.round.envido.result.winner, 1, 'cobra el que cantó último');
});

t('falta envido vale 4', () => {
  const m = mkMatch();
  act(m, 0, 'FALTA_ENVIDO'); act(m, 1, 'QUIERO');
  assert.equal(m.round.envido.result.value, 4);
});

t('el envido va primero: puedo cantarlo con truco pendiente', () => {
  const m = mkMatch();
  act(m, 0, 'TRUCO');
  assert.ok(legalActions(m, 1).includes('ENVIDO'));
  act(m, 1, 'ENVIDO'); act(m, 0, 'QUIERO');
  assert.equal(m.round.truco.pending, 1, 'resuelto el envido vuelve el truco pendiente');
  assert.ok(legalActions(m, 1).includes('QUIERO'));
});

t('truco no querido cierra la ronda', () => {
  const m = mkMatch();
  act(m, 0, 'TRUCO'); act(m, 1, 'NO_QUIERO');
  assert.equal(m.phase, 'roundEnd');
  assert.equal(m.lastOutcome.trucoPoints, 1);
  assert.equal(m.lastOutcome.trucoWinner, 0);
});

t('retruco no querido paga 2', () => {
  const m = mkMatch();
  act(m, 0, 'TRUCO'); act(m, 1, 'RETRUCO'); act(m, 0, 'NO_QUIERO');
  assert.equal(m.lastOutcome.trucoPoints, 2);
  assert.equal(m.lastOutcome.trucoWinner, 1);
});

t('sólo quien aceptó el truco puede subirlo', () => {
  const m = mkMatch();
  act(m, 0, 'TRUCO'); act(m, 1, 'QUIERO');
  assert.ok(!legalActions(m, 0).includes('RETRUCO'), 'el cantor no puede resubir');
  act(m, 0, 'PLAY', { cardIndex: 0 });
  assert.ok(legalActions(m, 1).includes('RETRUCO'), 'quien aceptó sí puede');
});

t('irse al mazo entrega la ronda', () => {
  const m = mkMatch();
  act(m, 0, 'MAZO');
  assert.equal(m.phase, 'roundEnd');
  assert.equal(m.lastOutcome.trucoWinner, 1);
  assert.equal(m.lastOutcome.foldedBy, 0);
});

t('ganar la ronda da 1 punto y rota las sillas', () => {
  const m = mkMatch();
  const ganador = m.seats[0], perdedor = m.seats[1], miraba = m.spectator;
  act(m, 0, 'TRUCO'); act(m, 1, 'NO_QUIERO');
  assert.equal(m.lastOutcome.winnerId, ganador);
  assert.equal(m.players.find(p=>p.id===ganador).score, 1);
  assert.equal(m.players.find(p=>p.id===perdedor).neverLost, false);
  advance(m);
  assert.deepEqual(m.seats, [ganador, miraba], 'el ganador se queda y entra el que miraba');
  assert.equal(m.spectator, perdedor, 'el perdedor pasa a mirar');
  assert.equal(m.manoIdx, 0, 'el ganador arranca de mano');
});

// ───────────────────────── permisos del que mira ─────────────────────────
console.log('\nEl que mira: permisos');

t('de entrada no ve ninguna mano', () => {
  const m = mkMatch();
  const v = viewFor(m, m.spectator);
  assert.ok(v.round.hands.every((h) => h.every((s) => s.hidden)), 'las dos manos tapadas');
  assert.deepEqual(v.round.envido.tantos, [null, null], 'ningún tanto');
});

t('con permiso ve sólo la mano que le dieron', () => {
  const m = mkMatch();
  pedirYAceptar(m, 0);
  const v = viewFor(m, m.spectator);
  assert.ok(v.round.hands[0].every((s) => s.card), 've la mano de la silla 0');
  assert.ok(v.round.hands[1].every((s) => s.hidden), 'la otra sigue tapada');
  assert.ok(v.round.envido.tantos[0] != null, 've ese tanto');
  assert.equal(v.round.envido.tantos[1], null, 'el otro no');
});

t('si le dicen que no, no ve nada y no puede insistir', () => {
  const m = mkMatch();
  applyAction(m, m.spectator, { type: 'PEEK_REQUEST', seat: 1 });
  applyAction(m, m.seats[1], { type: 'PEEK_NO' });
  const v = viewFor(m, m.spectator);
  assert.ok(v.round.hands[1].every((s) => s.hidden), 'sigue sin ver');
  const r = applyAction(m, m.spectator, { type: 'PEEK_REQUEST', seat: 1 });
  assert.match(r.error, /no en esta ronda/, 'no puede volver a pedir');
});

t('un jugador no puede pedir permiso ni contestar por otro', () => {
  const m = mkMatch();
  let r = applyAction(m, m.seats[0], { type: 'PEEK_REQUEST', seat: 1 });
  assert.match(r.error, /Sólo quien mira/);
  applyAction(m, m.spectator, { type: 'PEEK_REQUEST', seat: 0 });
  r = applyAction(m, m.seats[1], { type: 'PEEK_YES' });
  assert.match(r.error, /Nadie te pidió/, 'no puede aceptar por el otro');
});

t('el permiso se termina al terminar la ronda', () => {
  const m = mkMatch();
  pedirYAceptar(m, 0);
  act(m, 0, 'TRUCO'); act(m, 1, 'NO_QUIERO');
  advance(m);
  const v = viewFor(m, m.spectator);
  assert.ok(v.round.hands.every((h) => h.every((s) => s.hidden)), 'arranca de cero');
  assert.deepEqual(v.round.peek.granted, [false, false]);
});

t('pedir permiso no interrumpe el turno', () => {
  const m = mkMatch();
  const antes = m.round.turn;
  pedirYAceptar(m, 1);
  assert.equal(m.round.turn, antes, 'el turno queda donde estaba');
  assert.ok(legalActions(m, antes).includes('PLAY'), 'se puede seguir jugando');
});

// ───────────────────────── pacto ─────────────────────────
console.log('\nPacto: qué se revela al final');

t('PACTO: sin cartas jugadas ni envido querido, no se ve la mano del rival', () => {
  const m = mkMatch();
  act(m, 0, 'ENVIDO'); act(m, 1, 'NO_QUIERO');   // 1 punto para la silla 0
  act(m, 0, 'TRUCO');  act(m, 1, 'NO_QUIERO');   // 1 punto más para la silla 0
  assert.equal(m.phase, 'roundEnd');
  assert.equal(m.lastOutcome.pacto, true);

  for (const seat of [0, 1]) {
    const v = viewFor(m, m.seats[seat]);
    const rival = 1 - seat;
    assert.ok(v.outcome.hands[rival].every((c) => c === null), 'no ve nada del rival');
    assert.equal(v.outcome.envido.tantos[rival], null, 'ni su tanto');
    assert.ok(v.outcome.hands[seat].every((c) => c?.rank), 'su propia mano sí, obvio');
  }
});

t('en pacto, el que mira tampoco ve nada si no tenía permiso', () => {
  const m = mkMatch();
  act(m, 0, 'ENVIDO'); act(m, 1, 'NO_QUIERO');
  act(m, 0, 'TRUCO');  act(m, 1, 'NO_QUIERO');
  const v = viewFor(m, m.spectator);
  assert.ok(v.outcome.hands.every((h) => h.every((c) => c === null)), 'seis cartas tapadas');
  assert.deepEqual(v.outcome.envido.tantos, [null, null]);
});

t('en pacto, el que mira conserva lo que le habían dejado ver', () => {
  const m = mkMatch();
  pedirYAceptar(m, 0);
  act(m, 0, 'ENVIDO'); act(m, 1, 'NO_QUIERO');
  act(m, 0, 'TRUCO');  act(m, 1, 'NO_QUIERO');
  const v = viewFor(m, m.spectator);
  assert.ok(v.outcome.hands[0].every((c) => c?.rank), 've la mano que le mostraron');
  assert.ok(v.outcome.hands[1].every((c) => c === null), 'la otra no');
  assert.ok(v.outcome.envido.tantos[0] != null);
  assert.equal(v.outcome.envido.tantos[1], null);
});

t('sólo se revela del rival lo que se jugó', () => {
  const m = mkMatch();
  act(m, 0, 'PLAY', { cardIndex: 0 });
  act(m, 1, 'PLAY', { cardIndex: 0 });
  const turno = m.round.turn;
  act(m, turno, 'TRUCO'); act(m, 1 - turno, 'NO_QUIERO');

  const v = viewFor(m, m.seats[0]);
  assert.equal(v.outcome.pacto, false);
  const rival = v.outcome.hands[1];
  assert.ok(rival[0]?.rank, 'la carta jugada se ve');
  assert.equal(rival[1], null, 'la que quedó en la mano, no');
  assert.equal(rival[2], null);
  assert.equal(v.outcome.envido.tantos[1], null, 'sin envido querido no se canta el tanto');
});

t('con envido querido se muestran las cartas del tanto del rival', () => {
  const m = mkMatch();
  act(m, 0, 'ENVIDO'); act(m, 1, 'QUIERO');
  act(m, 0, 'MAZO');   // cierra sin jugar ninguna carta

  const v = viewFor(m, m.seats[0]);
  assert.equal(v.outcome.pacto, false);
  assert.ok(v.outcome.envido.tantos.every((t) => t != null), 'los tantos justifican los puntos');

  const manoRival = m.lastOutcome.hands[1];
  const esperado = envidoBreakdown(manoRival).indices.slice().sort();
  const visibles = v.outcome.hands[1]
    .map((c, i) => (c ? i : null)).filter((i) => i !== null).sort();
  assert.deepEqual(visibles, esperado, 'exactamente las cartas que forman el tanto');
  assert.equal(envidoOf(manoRival), v.outcome.envido.tantos[1]);
});

t('el tanto del rival se puede verificar con las cartas visibles', () => {
  for (let i = 0; i < 200; i++) {
    const m = mkMatch();
    act(m, 0, 'ENVIDO'); act(m, 1, 'QUIERO'); act(m, 0, 'MAZO');
    const v = viewFor(m, m.seats[1]);
    const visibles = v.outcome.hands[0].filter(Boolean);
    assert.ok(visibles.length >= 1 && visibles.length <= 2);
    const calculado = visibles.length === 2
      ? visibles.reduce((s, c) => s + (c.rank >= 10 ? 0 : c.rank), 0) + 20
      : (visibles[0].rank >= 10 ? 0 : visibles[0].rank);
    assert.equal(calculado, v.outcome.envido.tantos[0],
      'las cartas visibles explican el tanto');
  }
});

// ───────────────────────── modo tele ─────────────────────────
console.log('\nModo tele');

t('la tele nunca ve una mano, ni con permiso dado', () => {
  const m = mkMatch();
  pedirYAceptar(m, 0);
  pedirYAceptar(m, 1);
  const v = viewFor(m, null, { tv: true });
  assert.equal(v.you.isTv, true);
  assert.ok(v.round.hands.every((h) => h.every((s) => s.hidden)), 'las seis tapadas');
  assert.deepEqual(v.round.envido.tantos, [null, null], 'ningún tanto');
  assert.equal(v.round.peek, null, 'no maneja permisos');
  assert.deepEqual(v.round.actions, [], 'no tiene jugadas');
});

t('la tele sí ve mesa, jugadores y puntajes', () => {
  const m = mkMatch();
  act(m, 0, 'PLAY', { cardIndex: 0 });
  act(m, 1, 'TRUCO');
  const v = viewFor(m, null, { tv: true });
  assert.ok(v.round.tricks[0].cards.some((c) => c?.rank), 've la carta sobre la mesa');
  assert.equal(v.seats.length, 2, 've quiénes juegan');
  assert.ok(v.players.every((p) => typeof p.score === 'number'), 've el marcador general');
  assert.equal(typeof v.pot, 'number', 've el pozo');
  assert.ok(v.round.truco, 've lo que se está jugando');
});

t('al terminar la ronda la tele ve sólo lo que destapa el pacto', () => {
  const m = mkMatch();
  pedirYAceptar(m, 0);
  act(m, 0, 'ENVIDO'); act(m, 1, 'NO_QUIERO');
  act(m, 0, 'TRUCO');  act(m, 1, 'NO_QUIERO');
  const v = viewFor(m, null, { tv: true });
  assert.ok(v.outcome.hands.every((h) => h.every((c) => c === null)), 'pacto: nada');
  assert.equal(v.outcome.sawEverything, false);
  assert.ok(v.outcome.roundPoints.every((n) => typeof n === 'number'), 'los puntos sí');
});

t('el resumen ordena las cartas por orden de tirada', () => {
  for (let n = 0; n < 60; n++) {
    const m = mkMatch();
    // Guardamos qué carta juega cada uno en cada baza.
    const tirado = [[], []];
    let guard = 0;
    while (m.phase === 'playing' && guard++ < 12) {
      const idx = m.round.turn;
      const ci = m.round.hands[idx].findIndex((h) => !h.played);
      const carta = m.round.hands[idx][ci].card;
      tirado[idx].push(carta.id);
      act(m, idx, 'PLAY', { cardIndex: ci });
    }
    assert.equal(m.phase, 'roundEnd');
    const o = m.lastOutcome;
    for (const seat of [0, 1]) {
      const mostrado = o.hands[seat].filter(Boolean).map((c) => c.id);
      const esperado = tirado[seat];
      // Las jugadas van primero y en el orden en que salieron.
      assert.deepEqual(mostrado.slice(0, esperado.length), esperado,
        `silla ${seat}: el resumen debe seguir el orden de tirada`);
    }
  }
});

t('las cartas no jugadas van después de las tiradas', () => {
  const m = mkMatch();
  act(m, 0, 'ENVIDO'); act(m, 1, 'QUIERO');
  const ci = m.round.hands[0].findIndex((h) => !h.played);
  const primera = m.round.hands[0][ci].card.id;
  act(m, 0, 'PLAY', { cardIndex: ci });
  act(m, 1, 'MAZO');
  const o = m.lastOutcome;
  assert.equal(o.hands[0][0].id, primera, 'la carta tirada queda primera');
});

// ───────────────────────── mostrar los tantos ─────────────────────────
console.log('\nMostrar los tantos');

t('sin envido querido no se puede mostrar', () => {
  const m = mkMatch();
  assert.ok(!legalActions(m, 0).includes('SHOW_TANTOS'), 'no aparece sin envido');
  act(m, 0, 'ENVIDO'); act(m, 1, 'NO_QUIERO');
  assert.ok(!legalActions(m, 0).includes('SHOW_TANTOS'), 'tampoco si no lo quisieron');
});

t('con el envido querido, los dos pueden mostrar', () => {
  const m = mkMatch();
  act(m, 0, 'ENVIDO'); act(m, 1, 'QUIERO');
  assert.ok(legalActions(m, 0).includes('SHOW_TANTOS'), 'el que cantó puede');
  act(m, 0, 'PLAY', { cardIndex: 0 });
  assert.ok(legalActions(m, 1).includes('SHOW_TANTOS'), 'el que quiso también');
});

t('mostrar cierra la ronda y la define el tanto', () => {
  const m = mkMatch();
  act(m, 0, 'ENVIDO'); act(m, 1, 'QUIERO');
  act(m, 0, 'SHOW_TANTOS');
  assert.equal(m.phase, 'roundEnd');
  const o = m.lastOutcome;
  assert.equal(o.showedTantos, 0, 'queda registrado quién mostró');
  assert.equal(o.trucoWinner, 1, 'el truco se lo regala al otro');
  assert.equal(o.trucoPoints, 1, 'sin truco cantado, vale 1');
  assert.equal(o.envido.type, 'quiero');
  const esperado = o.envido.tantos[0] === o.envido.tantos[1]
    ? o.manoIdx : (o.envido.tantos[0] > o.envido.tantos[1] ? 0 : 1);
  assert.equal(o.envido.winner, esperado, 'el envido lo gana el tanto más alto');
});

t('mostrar en vez de querer un truco paga el no quiero', () => {
  const m = mkMatch();
  act(m, 0, 'ENVIDO'); act(m, 1, 'QUIERO');
  act(m, 0, 'PLAY', { cardIndex: 0 });
  act(m, 1, 'TRUCO');
  assert.ok(legalActions(m, 0).includes('SHOW_TANTOS'), 'se puede contestar mostrando');
  act(m, 0, 'SHOW_TANTOS');
  assert.equal(m.lastOutcome.trucoWinner, 1);
  assert.equal(m.lastOutcome.trucoPoints, 1, 'truco no querido = 1');
});

t('mostrar con retruco pendiente paga 2', () => {
  const m = mkMatch();
  act(m, 0, 'ENVIDO'); act(m, 1, 'QUIERO');
  act(m, 0, 'TRUCO'); act(m, 1, 'RETRUCO');
  act(m, 0, 'SHOW_TANTOS');
  assert.equal(m.lastOutcome.trucoPoints, 2);
  assert.equal(m.lastOutcome.trucoWinner, 1);
});

t('al mostrar se ven las cartas del tanto de los dos', () => {
  const m = mkMatch();
  act(m, 0, 'ENVIDO'); act(m, 1, 'QUIERO');
  act(m, 0, 'SHOW_TANTOS');
  const v = viewFor(m, m.seats[1]);
  const manoRival = m.lastOutcome.hands[0];
  const esperado = envidoBreakdown(manoRival).indices.slice().sort();
  const visibles = v.outcome.hands[0]
    .map((c, i) => (c ? i : null)).filter((i) => i !== null).sort();
  assert.deepEqual(visibles, esperado);
  assert.ok(v.outcome.envido.tantos.every((x) => x != null), 'los dos tantos a la vista');
});

// ───────────────────────── empate y pozo ─────────────────────────
console.log('\nEmpate y pozo');

t('empate: envido no querido (1) vs truco no querido (1)', () => {
  const m = mkMatch();
  act(m, 0, 'ENVIDO'); act(m, 1, 'NO_QUIERO');   // +1 silla 0
  assert.equal(m.round.turn, 0, 'sigue el turno de la mano');
  act(m, 0, 'PLAY', { cardIndex: 0 });
  act(m, 1, 'TRUCO'); act(m, 0, 'NO_QUIERO');    // +1 silla 1

  assert.deepEqual(m.lastOutcome.roundPoints, [1, 1]);
  assert.equal(m.lastOutcome.tie, true);
  assert.equal(m.pot, 1, 'el pozo arranca en 1');
  assert.ok(m.players.every((p) => p.score === 0), 'nadie suma en la general');
  assert.ok(m.players.every((p) => p.neverLost), 'empatar no es perder');

  const sillasAntes = m.seats.slice();
  const manoAntes = m.manoIdx;
  advance(m);
  assert.deepEqual(m.seats, sillasAntes, 'se redan cartas entre los mismos dos');
  assert.equal(m.manoIdx, 1 - manoAntes, 'la mano alterna en la redada');
});

t('el pozo tiene tope de 5', () => {
  const m = mkMatch();
  m.pot = 5;
  act(m, 0, 'ENVIDO'); act(m, 1, 'NO_QUIERO');
  act(m, 0, 'PLAY', { cardIndex: 0 });
  act(m, 1, 'TRUCO'); act(m, 0, 'NO_QUIERO');
  assert.equal(m.lastOutcome.tie, true);
  assert.equal(m.pot, MAX_POT, 'no pasa de 5');
});

t('el ganador se lleva todo el pozo', () => {
  const m = mkMatch();
  m.pot = 3;
  const ganador = m.seats[0];
  act(m, 0, 'TRUCO'); act(m, 1, 'NO_QUIERO');
  assert.equal(m.lastOutcome.awarded, 3);
  assert.equal(m.players.find((p) => p.id === ganador).score, 3);
  assert.equal(m.pot, 0, 'el pozo se vacía');
});

// ───────────────────────── fin de juego ─────────────────────────
console.log('\nFin de juego y Magistral');

t('llegar a 15 termina la partida', () => {
  const m = mkMatch();
  seated(m, 0).score = 14;
  act(m, 0, 'TRUCO'); act(m, 1, 'NO_QUIERO');
  assert.equal(m.phase, 'gameEnd');
  assert.equal(m.gameOver.winnerId, m.seats[0]);
});

t('MAGISTRAL si llegó a 15 sin perder nunca', () => {
  const m = mkMatch();
  seated(m, 0).score = 14;
  act(m, 0, 'TRUCO'); act(m, 1, 'NO_QUIERO');
  assert.equal(m.gameOver.magistral, true);
});

t('sin MAGISTRAL si alguna vez perdió', () => {
  const m = mkMatch();
  const p = seated(m, 0);
  p.score = 14; p.neverLost = false;
  act(m, 0, 'TRUCO'); act(m, 1, 'NO_QUIERO');
  assert.equal(m.gameOver.magistral, false);
});

// ───────────────────────── simulación ─────────────────────────
console.log('\nSimulación');

t('200 partidas aleatorias terminan sin romperse', () => {
  let pactos = 0, revelados = 0;
  for (let game = 0; game < 200; game++) {
    const m = createMatch(P);
    advance(m); // sale del sorteo
    let guard = 0;
    while (m.phase !== 'gameEnd' && guard++ < 4000) {
      if (m.phase === 'roundEnd') {
        if (m.lastOutcome.pacto) pactos++; else revelados++;
        // Nunca se puede filtrar una carta que no corresponde.
        for (const seat of [0, 1]) {
          const jugadas = m.round.hands[seat].map((s) => s.played);
          m.lastOutcome.revealedHands[seat].forEach((card, i) => {
            if (card && !jugadas[i]) {
              assert.equal(m.lastOutcome.envido.type, 'quiero',
                'sólo se destapa una carta no jugada si hubo envido querido');
            }
          });
        }
        advance(m);
        continue;
      }
      const idx = m.round.envido.pending ?? m.round.truco.pending ?? m.round.turn;
      const legal = legalActions(m, idx);
      assert.ok(legal.length, `silla ${idx} se quedó sin jugadas legales`);
      const type = legal[Math.floor(Math.random() * legal.length)];
      const extra = type === 'PLAY'
        ? { cardIndex: m.round.hands[idx].findIndex((h) => !h.played) }
        : {};
      const r = applyAction(m, m.seats[idx], { type, ...extra });
      assert.ok(!r.error, `acción ${type} rechazada: ${r.error}`);
    }
    assert.equal(m.phase, 'gameEnd', 'la partida debería terminar');
    assert.ok(m.players.some((p) => p.score >= TARGET));
    assert.ok(m.pot <= MAX_POT);
    for (const p of m.players) assert.ok(p.score >= 0 && p.score <= TARGET + MAX_POT);
  }
  assert.ok(pactos > 0, 'debería haber salido algún pacto');
  assert.ok(revelados > 0);
  console.log(`     (${pactos} pactos y ${revelados} revelados parciales en la muestra)`);
});

console.log(`\n${pass} pruebas OK\n`);
