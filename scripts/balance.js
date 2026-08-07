// Mide el balance de Turco con bots que juegan con criterio (no al azar).
import {
  createMatch, startRound, applyAction, advance, legalActions, TARGET,
} from '../server/game.js';
import { envidoOf, power } from '../server/deck.js';

const P = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];

/** Fuerza de la mano para el truco: 0..1 */
const trucoStrength = (cards) =>
  cards.reduce((s, c) => s + power(c), 0) / (14 * 3);

/** Bot con criterio: canta envido con buen tanto, truco con buenas cartas. */
function chooseAction(match, idx) {
  const r = match.round;
  const legal = legalActions(match, idx);
  if (!legal.length) return null;

  const cards = r.hands[idx].map((s) => s.card);
  const tanto = envidoOf(cards);
  const fuerza = trucoStrength(cards.filter((_, i) => !r.hands[idx][i].played));
  const esMano = match.manoIdx === idx;

  const has = (t) => legal.includes(t);

  // ── responder envido
  if (r.envido.pending === idx) {
    const enJuego = r.envido.chain.length;
    if (tanto >= 30 && has('REAL_ENVIDO')) return { type: 'REAL_ENVIDO' };
    if (tanto >= 27 && has('ENVIDO')) return { type: 'ENVIDO' };
    const umbral = enJuego >= 2 ? 27 : 24;
    return { type: tanto >= umbral ? 'QUIERO' : 'NO_QUIERO' };
  }

  // ── responder truco
  if (r.truco.pending === idx) {
    if (fuerza > 0.72 && has('RETRUCO')) return { type: 'RETRUCO' };
    if (fuerza > 0.72 && has('VALE_CUATRO')) return { type: 'VALE_CUATRO' };
    // Con buen tanto y envido querido, a veces conviene cortar y cobrar el envido.
    if (has('SHOW_TANTOS') && tanto >= 29 && fuerza < 0.4) return { type: 'SHOW_TANTOS' };
    return { type: fuerza > 0.42 ? 'QUIERO' : 'NO_QUIERO' };
  }

  // ── cantar envido en la primera
  if (has('ENVIDO') && r.envido.chain.length === 0) {
    if (tanto >= 33) return { type: 'REAL_ENVIDO' };
    if (tanto >= (esMano ? 25 : 27)) return { type: 'ENVIDO' };
  }

  // ── cantar truco
  if (has('TRUCO') && fuerza > 0.62) return { type: 'TRUCO' };
  if (has('RETRUCO') && fuerza > 0.75) return { type: 'RETRUCO' };

  // ── jugar: la más alta en la primera, la más baja después
  if (has('PLAY')) {
    const libres = r.hands[idx]
      .map((s, i) => ({ i, c: s.card, played: s.played }))
      .filter((x) => !x.played);
    libres.sort((x, y) => power(y.c) - power(x.c));
    const elegida = r.tricks.length === 1 ? libres[0] : libres[libres.length - 1];
    return { type: 'PLAY', cardIndex: elegida.i };
  }

  return { type: legal[0] };
}

// ─────────────────────────── simulación ───────────────────────────

const N = Number(process.argv[2] ?? 3000);
const st = {
  partidas: 0, rondas: 0, empates: 0, pactos: 0,
  envidoDecide: 0, rondasConEnvidoYBazas: 0,
  ganoMano: 0, rondasResueltas: 0,
  magistral: 0, pozoMax: {}, rachas: [], rondasPorPartida: [],
  envidoCantado: 0, envidoQuerido: 0, showTantos: 0,
  ganoQuienSeQuedo: 0, defensasPosibles: 0,
};

for (let g = 0; g < N; g++) {
  const m = createMatch(P);
  advance(m);
  let guard = 0;
  let racha = 0;
  let campeonAnterior = null;

  while (m.phase !== 'gameEnd' && guard++ < 3000) {
    if (m.phase === 'roundEnd') {
      const o = m.lastOutcome;
      st.rondas++;
      if (o.pacto) st.pactos++;
      if (o.envido.type) st.envidoCantado++;
      if (o.envido.type === 'quiero') st.envidoQuerido++;
      if (o.showedTantos != null) st.showTantos++;

      if (o.tie) {
        st.empates++;
        st.pozoMax[o.potAfter] = (st.pozoMax[o.potAfter] ?? 0) + 1;
      } else {
        st.rondasResueltas++;
        if (o.winnerIdx === o.manoIdx) st.ganoMano++;
        // ¿el envido dio vuelta el resultado de las bazas?
        if (o.envido.type && o.trucoWinner !== o.winnerIdx) st.envidoDecide++;
        if (o.envido.type) st.rondasConEnvidoYBazas++;

        // rachas: ¿el que venía ganando se quedó y volvió a ganar?
        if (campeonAnterior !== null) {
          st.defensasPosibles++;
          if (o.winnerId === campeonAnterior) { st.ganoQuienSeQuedo++; racha++; }
          else { st.rachas.push(racha); racha = 1; }
        } else racha = 1;
        campeonAnterior = o.winnerId;
      }
      advance(m);
      continue;
    }
    const idx = m.round.envido.pending ?? m.round.truco.pending ?? m.round.turn;
    const action = chooseAction(m, idx);
    if (!action) break;
    const res = applyAction(m, m.seats[idx], action);
    if (res.error) break;
  }
  st.rachas.push(racha);
  st.partidas++;
  st.rondasPorPartida.push(m.roundNo);
  if (m.gameOver?.magistral) st.magistral++;
}

const pct = (x, total) => `${((x / total) * 100).toFixed(1)}%`;
const avg = (a) => (a.reduce((s, x) => s + x, 0) / a.length).toFixed(1);

console.log(`\n  ${st.partidas} partidas · ${st.rondas} rondas\n`);
console.log(`  Rondas por partida        ${avg(st.rondasPorPartida)}  (mediana ${
  st.rondasPorPartida.slice().sort((a, b) => a - b)[Math.floor(st.partidas / 2)]})`);
console.log(`  Rondas empatadas (pozo)   ${pct(st.empates, st.rondas)}`);
console.log(`  Rondas en pacto           ${pct(st.pactos, st.rondas)}  (no se jugó ninguna carta)`);
console.log(`  Se cantó envido           ${pct(st.envidoCantado, st.rondas)}`);
console.log(`  ...y fue querido          ${pct(st.envidoQuerido, st.rondas)}`);
console.log(`  Se mostraron los tantos   ${pct(st.showTantos, st.rondas)}`);
console.log();
console.log(`  El envido dio vuelta las bazas  ${pct(st.envidoDecide, st.rondasConEnvidoYBazas)}`);
console.log(`     (de las rondas con envido y resultado, cuántas ganó quien PERDIÓ el truco)`);
console.log();
console.log(`  Ganó el mano              ${pct(st.ganoMano, st.rondasResueltas)}  (ventaja de mano)`);
console.log(`  El que se quedó revalidó  ${pct(st.ganoQuienSeQuedo, st.defensasPosibles)}`);
console.log(`  Racha media en la mesa    ${avg(st.rachas)} rondas`);
console.log(`  Partidas con MAGISTRAL    ${pct(st.magistral, st.partidas)}`);
console.log(`\n  Pozo alcanzado en empates:`);
for (const k of Object.keys(st.pozoMax).sort()) {
  console.log(`     ${k} punto(s): ${st.pozoMax[k]}`);
}
console.log();
