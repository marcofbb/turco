// Contra el servidor real: verifica que nunca se filtre una carta que no corresponde.
import assert from 'node:assert/strict';

const URL = 'ws://localhost:3000';
let pass = 0;
const ok = (name) => { console.log(`  ✓ ${name}`); pass++; };

class C {
  constructor(name, id) { this.name = name; this.id = id; this.errors = []; this.waiters = []; }
  connect() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(URL);
      this.ws.onopen = () => res();
      this.ws.onerror = (e) => rej(new Error(String(e.message ?? e)));
      this.ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.type === 'error') this.errors.push(m.message);
        if (m.type === 'joined') { this.code = m.code; this.tv = m.tv; }
        if (m.type === 'state') {
          this.state = m;
          const w = this.waiters; this.waiters = [];
          for (const fn of w) fn(m);
        }
      };
    });
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  join(code) { this.send({ type: 'join', name: this.name, code, playerId: this.id }); }
  act(action) { this.send({ type: 'action', action }); }
  next() {
    const p = this.nextState();
    this.send({ type: 'next' });
    return p;
  }
  nextState(ms = 4000) {
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`timeout (${this.name})`)), ms);
      this.waiters.push((s) => { clearTimeout(t); res(s); });
    });
  }
  until(cond, label = '?', ms = 4000) {
    if (this.state && cond(this.state)) return Promise.resolve(this.state);
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`timeout ${label} (${this.name})`)), ms);
      const check = (s) => { if (cond(s)) { clearTimeout(t); res(s); } else this.waiters.push(check); };
      this.waiters.push(check);
    });
  }
  close() { this.ws.close(); }
}

const settle = (ms = 110) => new Promise((r) => setTimeout(r, ms));
const seatOf = (c) => c.state.you.seatIdx;

/** Pasar de ronda ahora necesita el OK de los dos que jugaron. */
async function avanzar(clientes, observador) {
  const sillas = observador.state.seats;
  const jugadores = sillas.map((id) => clientes.find((c) => c.id === id)).filter(Boolean);
  for (const j of jugadores) {
    const p = observador.nextState();
    j.send({ type: 'next' });
    await p;
    await settle();
  }
}

const run = async () => {
  const ana = new C('Ana', 'pv-ana');
  const beto = new C('Beto', 'pv-beto');
  const caro = new C('Caro', 'pv-caro');
  const all = [ana, beto, caro];
  await Promise.all(all.map((c) => c.connect()));

  ana.join();
  await ana.until((s) => s.code);
  const code = ana.code;
  beto.join(code);
  caro.join(code);
  await Promise.all(all.map((c) => c.until((s) => s.phase === 'draw', 'sorteo')));
  ok('con 3 jugadores se hace el sorteo de apertura');

  const tvCode = ana.state.tvCode;
  assert.match(tvCode ?? '', /^[A-Z0-9]{4}$/, 'la sala trae código de tele');
  assert.notEqual(tvCode, code, 'es distinto del código de sala');
  ok(`la sala ${code} genera un código de tele aparte (${tvCode})`);

  // La tele entra con el otro código.
  const tv = new C('Tele', null);
  await tv.connect();
  tv.join(tvCode);
  await tv.until((s) => s.you?.isTv === true, 'modo tele');
  ok('con el código de tele se entra en modo pantalla');

  await ana.next();
  await Promise.all(all.map((c) => c.until((s) => s.phase === 'playing', 'reparto')));
  await settle();

  const bySeat = (i) => all.find((c) => c.state.you.seatIdx === i);
  const spec = all.find((c) => c.state.you.isSpectator);
  const p0 = bySeat(0), p1 = bySeat(1);

  // ── privacidad base
  assert.ok(p0.state.round.hands[0].every((h) => h.card), 've su mano');
  assert.ok(p0.state.round.hands[1].every((h) => h.hidden), 'no ve la del rival');
  assert.ok(spec.state.round.hands.every((h) => h.every((s) => s.hidden)),
    'quien mira arranca sin ver nada');
  assert.ok(tv.state.round.hands.every((h) => h.every((s) => s.hidden)), 'la tele no ve manos');
  ok('nadie ve una mano ajena al empezar la ronda');

  // ── permiso
  spec.act({ type: 'PEEK_REQUEST', seat: 0 });
  await p0.until((s) => s.round.peek.requested[0], 'pedido');
  assert.ok(spec.state.round.hands[0].every((h) => h.hidden), 'pedir no alcanza');
  ok('pedir permiso no destapa nada por sí solo');

  p0.act({ type: 'PEEK_YES' });
  await spec.until((s) => s.round.peek.granted[0], 'permiso dado');
  await settle();
  assert.ok(spec.state.round.hands[0].every((h) => h.card), 'ahora sí ve esa mano');
  assert.ok(spec.state.round.hands[1].every((h) => h.hidden), 'la otra no');
  assert.ok(spec.state.round.envido.tantos[0] != null);
  assert.equal(spec.state.round.envido.tantos[1], null);
  ok('con el sí del dueño ve esa mano y ese tanto, nada más');

  assert.ok(tv.state.round.hands.every((h) => h.every((s) => s.hidden)),
    'la tele sigue sin ver, aunque haya permiso dado');
  ok('el permiso no alcanza a la tele');

  spec.act({ type: 'PEEK_REQUEST', seat: 1 });
  await p1.until((s) => s.round.peek.requested[1], 'pedido 2');
  p1.act({ type: 'PEEK_NO' });
  await spec.until((s) => s.round.peek.denied[1], 'negado');
  await settle();
  assert.ok(spec.state.round.hands[1].every((h) => h.hidden), 'sigue tapada tras el no');
  ok('si le dicen que no, no ve la mano');

  // ── PACTO: cerrar sin jugar cartas ni querer envido
  const mano = bySeat(p0.state.round.acting);
  const pie = bySeat(1 - p0.state.round.acting);
  const manoSeat = seatOf(mano), pieSeat = seatOf(pie);

  let p = pie.nextState();
  mano.act({ type: 'ENVIDO' });
  await p;
  await settle();
  p = mano.nextState();
  pie.act({ type: 'NO_QUIERO' });
  await p;
  await settle();

  p = pie.nextState();
  mano.act({ type: 'TRUCO' });
  await p;
  await settle();
  p = mano.nextState();
  pie.act({ type: 'NO_QUIERO' });
  await p;
  await settle();

  assert.equal(mano.state.phase, 'roundEnd', 'la ronda cerró sin jugar una sola carta');
  assert.equal(mano.state.outcome.pacto, true, 'es pacto');
  ok('se puede cerrar una ronda entera sin poner una carta: PACTO');

  // Ninguno ve la mano del otro.
  for (const [me, rival] of [[mano, pieSeat], [pie, manoSeat]]) {
    const o = me.state.outcome;
    assert.ok(o.hands[rival].every((c) => c === null),
      `${me.name} no debería ver ninguna carta del rival`);
    assert.equal(o.envido.tantos[rival], null, `${me.name} no debería ver el tanto del rival`);
    assert.ok(o.hands[seatOf(me)].every((c) => c?.rank), `${me.name} sí ve su propia mano`);
  }
  ok('en pacto ningún jugador ve una carta ni el tanto del rival');

  // La tele: nada de nada.
  assert.ok(tv.state.outcome.hands.every((h) => h.every((c) => c === null)),
    'la tele no ve ninguna carta');
  assert.deepEqual(tv.state.outcome.envido.tantos, [null, null]);
  assert.ok(tv.state.outcome.roundPoints.every((n) => typeof n === 'number'),
    'pero sí ve los puntos de la ronda');
  assert.ok(tv.state.players.every((p2) => typeof p2.score === 'number'), 'y el marcador general');
  ok('la tele ve los puntajes pero ninguna carta');

  // Quien miraba conserva sólo lo que le habían mostrado.
  const so = spec.state.outcome;
  assert.ok(so.hands[0].every((c) => c?.rank), 've la mano que le dejaron ver');
  assert.ok(so.hands[1].every((c) => c === null), 'la que le negaron sigue tapada');
  ok('quien mira conserva sólo la mano que le permitieron');

  // ── el permiso caduca al pasar de ronda
  // Ojo: al rotar las sillas, el que miraba puede pasar a jugar.
  await avanzar(all, spec);
  await Promise.all(all.map((c) => c.until((s) => s.phase === 'playing', 'ronda nueva')));
  await settle();
  const spec2 = all.find((c) => c.state.you.isSpectator);
  assert.ok(spec2.state.round.hands.every((h) => h.every((s) => s.hidden)),
    'la ronda nueva arranca sin permisos');
  assert.deepEqual(spec2.state.round.peek.granted, [false, false]);
  ok('el permiso caduca al terminar la ronda');

  // ── cerrar en la 2ª baza: la 3ª carta no se muestra
  let guard = 0;
  while (spec.state.phase === 'playing' && guard++ < 12) {
    const idx = spec.state.round.acting;
    const who = bySeat(idx);
    const hand = who.state.round.hands[idx];
    const ci = hand.findIndex((h) => !h.played);
    const q = spec.nextState();
    who.act({ type: 'PLAY', cardIndex: ci });
    await q;
    await settle();
  }
  assert.equal(spec.state.phase, 'roundEnd');
  const o2 = bySeat(0).state.outcome;
  const jugadas = o2.hands[1].filter(Boolean).length;
  const enMano = o2.hands[1].filter((c) => c === null).length;
  assert.equal(jugadas + enMano, 3);
  assert.ok(jugadas >= 2, 'se ven las cartas que se jugaron');
  if (enMano > 0) {
    ok(`al cerrar antes de la 3ª, la carta que quedó en la mano no se muestra (${jugadas} visibles, ${enMano} tapada)`);
  } else {
    ok('se jugaron las 3 cartas, así que se ven las 3');
  }

  // ── la tele no puede tocar nada
  tv.errors.length = 0;
  tv.send({ type: 'action', action: { type: 'PLAY', cardIndex: 0 } });
  tv.send({ type: 'next' });
  await settle();
  assert.ok(tv.errors.length >= 2, 'la tele es de sólo lectura');
  assert.ok(tv.errors.every((e) => /sólo mira/.test(e)));
  ok('la tele no puede jugar ni avanzar la partida');

  for (const c of [...all, tv]) c.close();
  console.log(`\n${pass} pruebas de privacidad OK\n`);
};

run().catch((e) => { console.error('\n✗', e.message, '\n'); process.exit(1); });
