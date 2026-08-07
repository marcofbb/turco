// End-to-end contra el servidor real: 3 clientes WebSocket juegan una partida entera.
import assert from 'node:assert/strict';

const URL = 'ws://localhost:3000';
let pass = 0;
const ok = (name) => { console.log(`  ✓ ${name}`); pass++; };

class Client {
  constructor(name, id) {
    this.name = name;
    this.id = id;
    this.state = null;
    this.errors = [];
    this.waiters = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(URL);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(new Error(`no conecta: ${e.message ?? e}`));
      this.ws.onclose = (e) => {
        this.closed = { code: e.code, reason: e.reason, at: Date.now() };
        console.log(`     [!] socket de ${this.name} cerrado (code ${e.code})`);
      };
      this.ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'error') this.errors.push(msg.message);
        if (msg.type === 'joined') this.code = msg.code;
        if (msg.type === 'state') {
          this.state = msg;
          const w = this.waiters; this.waiters = [];
          for (const fn of w) fn(msg);
        }
      };
    });
  }

  send(msg) { this.ws.send(JSON.stringify(msg)); }
  join(code) { this.send({ type: 'join', name: this.name, code, playerId: this.id }); }

  /** Espera a que llegue un state que cumpla la condición. */
  until(cond, label = 'condición', ms = 4000) {
    if (this.state && cond(this.state)) return Promise.resolve(this.state);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout esperando ${label} (${this.name})`)), ms);
      const check = (s) => {
        if (cond(s)) { clearTimeout(timer); resolve(s); }
        else this.waiters.push(check);
      };
      this.waiters.push(check);
    });
  }

  /** Se resuelve con el próximo state que llegue. Registrar ANTES de mandar la acción. */
  nextState(ms = 4000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout esperando estado (${this.name})`)), ms);
      this.waiters.push((s) => { clearTimeout(timer); resolve(s); });
    });
  }

  close() { this.ws.close(); }
}

const settle = () => new Promise((r) => setTimeout(r, 90));

const run = async () => {
  const ana = new Client('Ana', 'p-ana');
  const beto = new Client('Beto', 'p-beto');
  const caro = new Client('Caro', 'p-caro');
  const all = [ana, beto, caro];

  await Promise.all(all.map((c) => c.connect()));
  ok('los 3 clientes conectan por WebSocket');

  // ── sala
  ana.join();
  const first = await ana.until((s) => s.code, 'código de sala');
  const code = first.code;
  assert.match(code, /^[A-Z0-9]{4}$/);
  ok(`se crea la sala ${code}`);

  await ana.until((s) => s.phase === 'lobby', 'lobby');
  assert.equal(ana.state.members.length, 1);
  ok('con 1 jugador queda en lobby');

  beto.join(code);
  await beto.until((s) => s.phase === 'lobby');
  await settle();
  assert.equal(ana.state.members.length, 2);
  ok('el segundo entra y todos lo ven');

  caro.join(code);
  await Promise.all(all.map((c) => c.until((s) => s.phase === 'draw', 'sorteo')));
  ok('con el tercero se hace el sorteo de apertura');

  const next0 = ana.nextState();
  ana.send({ type: 'next' });
  await next0;
  await Promise.all(all.map((c) => c.until((s) => s.phase === 'playing', 'arranque')));
  await settle();
  ok('tras el sorteo se reparte la primera mano');

  // ── roles
  const s = ana.state;
  assert.equal(s.seats.length, 2);
  assert.ok(!s.seats.includes(s.spectator));
  assert.equal(all.filter((c) => c.state.you.isSpectator).length, 1, 'exactamente uno mira');
  ok('2 en la mesa, 1 de espectador');

  // ── privacidad de las manos
  const jugadores = all.filter((c) => !c.state.you.isSpectator);
  const mira = all.find((c) => c.state.you.isSpectator);
  for (const j of jugadores) {
    const mine = j.state.you.seatIdx;
    assert.ok(j.state.round.hands[mine].every((h) => h.card), 've su mano');
    assert.ok(j.state.round.hands[1 - mine].every((h) => h.hidden), 'no ve la del rival');
  }
  assert.ok(mira.state.round.hands.every((h) => h.every((x) => x.hidden)),
    'quien mira arranca sin ver nada');
  ok('cada jugador ve sólo su mano; quien mira no ve ninguna');

  for (const j of jugadores) {
    assert.equal(j.state.round.envido.tantos[1 - j.state.you.seatIdx], null);
  }
  assert.deepEqual(mira.state.round.envido.tantos, [null, null]);
  ok('nadie ve el tanto ajeno');

  // ── el espectador no puede jugar
  mira.errors.length = 0;
  mira.send({ type: 'action', action: { type: 'PLAY', cardIndex: 0 } });
  await settle();
  assert.match(mira.errors[0] ?? '', /espectador/);
  ok('quien mira no puede jugar cartas');

  // ── fuera de turno
  const manoIdx = ana.state.round.manoIdx;
  const offTurn = jugadores.find((c) => c.state.you.seatIdx === 1 - manoIdx);
  offTurn.errors.length = 0;
  offTurn.send({ type: 'action', action: { type: 'PLAY', cardIndex: 0 } });
  await settle();
  assert.match(offTurn.errors[0] ?? '', /turno/);
  ok('no se puede jugar fuera de turno');

  // ── envido a ciegas
  const players = [0, 1].map((i) => jugadores.find((c) => c.state.you.seatIdx === i));
  const mano = players[manoIdx];
  const pie = players[1 - manoIdx];
  mano.send({ type: 'action', action: { type: 'ENVIDO' } });
  await pie.until((st) => st.round.envido.pending === (1 - manoIdx), 'envido cantado');
  pie.send({ type: 'action', action: { type: 'QUIERO' } });
  await mano.until((st) => st.round.envido.accepted, 'envido querido');
  await settle();

  assert.equal(mano.state.round.envido.value, 2);
  assert.equal(mano.state.round.envido.tantos[1 - manoIdx], null, 'sigue oculto el del rival');
  assert.deepEqual(mira.state.round.envido.tantos, [null, null], 'quien mira tampoco');
  ok('envido querido: 2 puntos guardados, tantos todavía ocultos');

  // ── se juega la mano hasta que termine la ronda
  let guard = 0;
  while (ana.state.phase === 'playing' && guard++ < 30) {
    await settle();
    const idx = ana.state.round.acting;
    const who = players[idx];
    const actions = who.state.round.actions;
    const type = actions.includes('PLAY') ? 'PLAY' : actions[0];
    const extra = type === 'PLAY'
      ? { cardIndex: who.state.round.hands[idx].findIndex((h) => !h.played) }
      : {};
    const next = ana.nextState();
    who.send({ type: 'action', action: { type, ...extra } });
    await next;
  }
  assert.equal(ana.state.phase, 'roundEnd');
  ok('la ronda se juega hasta el final');

  // ── revelado
  const o = ana.state.outcome;
  assert.ok(Array.isArray(o.envido.tantos) && o.envido.tantos.length === 2);
  assert.ok(o.hands.every((h) => h.some((c) => c && c.rank)), 'se revela lo que corresponde');
  assert.equal(o.envido.type, 'quiero');
  assert.equal(o.envido.value, 2);
  const expectedEnvidoWinner = o.envido.tantos[0] === o.envido.tantos[1]
    ? o.manoIdx
    : (o.envido.tantos[0] > o.envido.tantos[1] ? 0 : 1);
  assert.equal(o.envido.winner, expectedEnvidoWinner, 'gana el tanto más alto (empate: la mano)');
  ok(`al terminar se revelan los tantos (${o.envido.tantos.join(' vs ')}) y gana el más alto`);

  const sum = [0, 1].map((i) =>
    (o.trucoWinner === i ? o.trucoPoints : 0) + (o.envido.winner === i ? o.envido.value : 0));
  assert.deepEqual(o.roundPoints, sum, 'los puntos de la ronda suman truco + envido');
  ok('los puntos de la ronda son truco + envido');

  // ── rotación / pozo
  const beforeSeats = ana.state.seats.slice();
  const beforeSpec = ana.state.spectator;
  // Pasar de ronda necesita el OK de los dos que jugaron.
  for (const id of beforeSeats) {
    const quien = all.find((c) => c.id === id);
    const p = ana.nextState();
    quien.send({ type: 'next' });
    await p;
    await settle();
  }
  await ana.until((x) => x.phase === 'playing', 'siguiente ronda');
  await settle();

  if (o.tie) {
    assert.deepEqual(ana.state.seats, beforeSeats, 'empate: siguen los mismos dos');
    assert.equal(ana.state.pot, 1, 'empate: queda 1 en el pozo');
    ok('empate → se redan cartas entre los mismos y el pozo sube a 1');
  } else {
    assert.equal(ana.state.seats[0], o.winnerId, 'el ganador se queda de mano');
    assert.equal(ana.state.seats[1], beforeSpec, 'entra quien miraba');
    assert.equal(ana.state.spectator, o.loserId, 'el perdedor pasa a mirar');
    assert.equal(ana.state.round.manoIdx, 0, 'el ganador arranca de mano');
    const winner = ana.state.players.find((p) => p.id === o.winnerId);
    assert.equal(winner.score, 1, 'ganar la ronda vale 1 en la general');
    ok('gana uno → se queda de mano, entra quien miraba, sale el perdedor');
  }

  // ── reconexión
  const specNow = ana.state.spectator;
  const target = all.find((c) => c.id === specNow);
  const handBefore = JSON.stringify(target.state.round.hands);
  target.close();
  await settle();
  const revived = new Client(target.name, target.id);
  await revived.connect();
  revived.join(code);
  await revived.until((x) => x.phase === 'playing', 'reconexión');
  assert.equal(JSON.stringify(revived.state.round.hands), handBefore, 'vuelve al mismo lugar');
  ok('reconexión: se vuelve a la misma silla y a la misma mano');

  // ── sala llena
  const cuarto = new Client('Dani', 'p-dani');
  await cuarto.connect();
  cuarto.join(code);
  await settle();
  assert.match(cuarto.errors[0] ?? '', /completa/);
  ok('un cuarto jugador es rechazado');
  cuarto.close();

  // ── partida completa hasta 15
  const byId = { [ana.id]: ana, [beto.id]: beto, [caro.id]: caro, [revived.id]: revived };
  const live = (id) => (revived.id === id ? revived : byId[id]);
  let steps = 0;
  let rounds = 0;
  while (ana.state.phase !== 'gameEnd' && steps++ < 3000) {
    if (ana.state.phase === 'roundEnd') {
      rounds++;
      // Los dos que jugaron tienen que aceptar.
      for (const id of ana.state.seats) {
        const quien = live(id);
        if (!quien) continue;
        const p = ana.nextState();
        quien.send({ type: 'next' });
        await p;
        await settle();
      }
      continue;
    }
    await settle();
    if (ana.state.phase !== 'playing') continue;
    const idx = ana.state.round.acting;
    const who = live(ana.state.seats[idx]);
    const actions = who.state?.round?.actions ?? [];
    if (!actions.length) continue;
    const type = actions[Math.floor(Math.random() * actions.length)];
    const extra = type === 'PLAY'
      ? { cardIndex: who.state.round.hands[idx].findIndex((h) => !h.played) }
      : {};
    const next = ana.nextState();
    who.send({ type: 'action', action: { type, ...extra } });
    try {
      await next;
    } catch (e) {
      console.log(`     [!] se colgó en el paso ${steps}: ${who.name} intentó ${type}`);
      console.log(`         acciones que creía legales: ${JSON.stringify(actions)}`);
      console.log(`         errores de ${who.name}: ${JSON.stringify(who.errors.slice(-3))}`);
      console.log(`         fase=${ana.state.phase} acting=${ana.state.round?.acting} sillas=${JSON.stringify(ana.state.seats)}`);
      throw e;
    }
  }
  assert.equal(ana.state.phase, 'gameEnd', 'la partida llega a su fin');
  const champ = ana.state.players.find((p) => p.id === ana.state.gameOver.winnerId);
  assert.ok(champ.score >= 15, 'el campeón llegó a 15');
  assert.equal(ana.state.gameOver.magistral, champ.neverLost, 'MAGISTRAL sólo si nunca perdió');
  ok(`partida completa (${rounds} rondas): gana ${champ.name} con ${champ.score}${ana.state.gameOver.magistral ? ' (MAGISTRAL)' : ''}`);

  // ── revancha
  ana.send({ type: 'rematch' });
  await ana.until((x) => x.phase === 'draw', 'sorteo de revancha');
  const nx = ana.nextState();
  ana.send({ type: 'next' });
  await nx;
  await ana.until((x) => x.phase === 'playing', 'revancha');
  assert.ok(ana.state.players.every((p) => p.score === 0), 'la revancha arranca 0 a 0');
  assert.equal(ana.state.pot, 0);
  ok('la revancha resetea el marcador');

  for (const c of [ana, beto, caro, revived]) c.close();
  console.log(`\n${pass} pruebas e2e OK\n`);
};

run().catch((e) => { console.error('\n✗', e.message, '\n'); process.exit(1); });
