// Verifica el relay de señalización: entre jugadores sí, con la tele nunca.
import assert from 'node:assert/strict';
const URL = 'ws://localhost:3000';
let pass = 0;
const ok = n => { console.log(`  ✓ ${n}`); pass++; };

class C {
  constructor(n, id) { this.name = n; this.id = id; this.rtc = []; this.errors = []; this.w = []; }
  connect() { return new Promise(r => {
    this.ws = new WebSocket(URL);
    this.ws.onopen = () => r();
    this.ws.onmessage = e => { const m = JSON.parse(e.data);
      if (m.type === 'joined') { this.code = m.code; this.isTv = !!m.tv; }
      if (m.type === 'rtc') this.rtc.push(m);
      if (m.type === 'error') this.errors.push(m.message);
      if (m.type === 'state') { this.state = m; const w = this.w; this.w = []; w.forEach(f => f(m)); } };
  }); }
  send(m) { this.ws.send(JSON.stringify(m)); }
  until(c, ms = 8000) { if (this.state && c(this.state)) return Promise.resolve(this.state);
    return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + this.name)), ms);
      const k = s => { if (c(s)) { clearTimeout(t); res(s); } else this.w.push(k); }; this.w.push(k); }); }
  close() { this.ws.close(); }
}
const settle = (ms = 150) => new Promise(r => setTimeout(r, ms));

const run = async () => {
  const a = new C('Ana','v-a'), b = new C('Beto','v-b'), c = new C('Caro','v-c');
  const all = [a,b,c];
  await Promise.all(all.map(x => x.connect()));
  a.send({ type:'join', name:a.name, playerId:a.id });
  await a.until(s => s.code);
  const code = a.code;
  b.send({ type:'join', name:b.name, code, playerId:b.id });
  c.send({ type:'join', name:c.name, code, playerId:c.id });
  await Promise.all(all.map(x => x.until(s => s.phase === 'draw')));
  ok('sala con 3 jugadores');

  const tvCode = a.state.tvCode;
  const tv = new C('Tele', null);
  await tv.connect();
  tv.send({ type:'join', code:tvCode });
  await tv.until(s => s.you?.isTv === true);
  ok('tele conectada');

  // ── estado del micrófono
  assert.deepEqual(a.state.voice, { 'v-a':false, 'v-b':false, 'v-c':false });
  ok('todos arrancan con el micrófono cerrado');

  a.send({ type:'voice', on:true });
  await b.until(s => s.voice['v-a'] === true);
  await settle();
  assert.equal(c.state.voice['v-a'], true, 'el que mira también lo ve');
  assert.equal(tv.state.voice['v-a'], true, 'la tele lo puede mostrar');
  ok('abrir el micrófono se propaga a todos');

  // ── señalización punto a punto
  a.rtc.length = b.rtc.length = c.rtc.length = 0;
  a.send({ type:'rtc', to:'v-b', data:{ description:{ type:'offer', sdp:'x' } } });
  await settle(250);
  assert.equal(b.rtc.length, 1, 'le llega al destinatario');
  assert.equal(b.rtc[0].from, 'v-a');
  assert.equal(c.rtc.length, 0, 'no le llega a un tercero');
  ok('la señalización va sólo al destinatario');

  // ── la tele no participa
  tv.errors.length = 0; tv.rtc.length = 0;
  tv.send({ type:'voice', on:true });
  tv.send({ type:'rtc', to:'v-a', data:{ description:{ type:'offer', sdp:'x' } } });
  await settle(250);
  assert.ok(tv.errors.some(e => /no participa del audio/.test(e)), 'la tele no puede abrir micrófono');
  assert.equal(a.state.voice['v-a'], true);
  assert.ok(!('null' in (a.state.voice ?? {})), 'la tele no figura en el roster de voz');
  ok('la tele no puede hablar');

  a.rtc.length = 0;
  b.send({ type:'rtc', to:null, data:{ x:1 } });     // destinatario inválido
  await settle(200);
  assert.equal(a.rtc.length, 0);
  ok('no se puede señalizar a un destinatario inexistente');

  // Nadie puede mandarle señalización a una tele: no tiene id de miembro.
  b.rtc.length = 0; tv.rtc.length = 0;
  a.send({ type:'rtc', to:'tele', data:{ x:1 } });
  await settle(200);
  assert.equal(tv.rtc.length, 0, 'la tele nunca recibe señalización');
  ok('la tele nunca recibe señalización');

  // ── permiso de la tele para ver manos
  await a.until(s => s.phase === 'draw');
  a.send({ type:'next' });
  await Promise.all([a,b,c,tv].map(x => x.until(s => s.phase === 'playing')));
  await settle();

  const sillas = a.state.seats;
  const porId = { 'v-a':a, 'v-b':b, 'v-c':c };
  const s0 = porId[sillas[0]], s1 = porId[sillas[1]];

  assert.ok(tv.state.round.hands.every(h => h.every(x => x.hidden)), 'la tele arranca sin ver nada');
  ok('la tele no ve ninguna mano al empezar');

  tv.errors.length = 0;
  tv.send({ type:'tvpeek', seat: 0 });
  await s0.until(st => (st.tvPeek?.requested ?? []).includes(sillas[0]));
  await settle();
  assert.ok(tv.state.round.hands.every(h => h.every(x => x.hidden)), 'pedir no alcanza');
  ok('pedir permiso no destapa nada por sí solo');

  s0.send({ type:'tvpeek-answer', yes: true });
  await tv.until(st => (st.tvPeek?.granted ?? []).includes(sillas[0]));
  await settle();
  assert.ok(tv.state.round.hands[0].every(x => x.card), 'ahora ve esa mano');
  assert.ok(tv.state.round.hands[1].every(x => x.hidden), 'la otra no');
  ok('con el sí, la tele ve sólo esa mano');

  // El otro dice que no
  tv.send({ type:'tvpeek', seat: 1 });
  await s1.until(st => (st.tvPeek?.requested ?? []).includes(sillas[1]));
  s1.send({ type:'tvpeek-answer', yes: false });
  await settle(300);
  assert.ok(tv.state.round.hands[1].every(x => x.hidden), 'sigue tapada tras el no');
  ok('si le dicen que no, la tele no ve esa mano');

  // Un jugador no puede contestar por el otro
  s1.errors.length = 0;
  s1.send({ type:'tvpeek-answer', yes: true });
  await settle(250);
  assert.ok(s1.errors.some(e => /no te pidió/i.test(e)), 'no hay pedido pendiente para él');
  ok('nadie contesta por otro');

  // La tele no puede contestarse a sí misma
  tv.errors.length = 0;
  tv.send({ type:'tvpeek-answer', yes: true });
  await settle(250);
  assert.ok(tv.errors.some(e => /no contesta/i.test(e)));
  ok('la tele no puede autorizarse sola');

  // ── el permiso sobrevive a la ronda
  const antesDeRonda = sillas[0];
  // Cerramos la ronda: el que tiene el turno se va al mazo.
  const deTurno = porId[a.state.seats[a.state.round.acting]];
  deTurno.send({ type:'action', action:{ type:'MAZO' } });
  await tv.until(st => st.phase === 'roundEnd');
  await settle();
  const listos = tv.state.outcome.seats;
  porId[listos[0]].send({ type:'next' });
  porId[listos[1]].send({ type:'next' });
  await tv.until(st => st.phase === 'playing', 6000);
  await settle(300);
  // La garantía de "para siempre": el permiso sigue registrado pase lo que pase.
  assert.ok((tv.state.tvPeek?.granted ?? []).includes(antesDeRonda),
    'el permiso tiene que sobrevivir al cambio de ronda');

  const sillaAhora = tv.state.seats.indexOf(antesDeRonda);
  if (sillaAhora !== -1) {
    assert.ok(tv.state.round.hands[sillaAhora].every(x => x.card),
      'y si sigue en la mesa, la tele ve su mano nueva');
  }
  // El que NO dio permiso sigue tapado, esté donde esté.
  for (const [i, id] of tv.state.seats.entries()) {
    if (id === antesDeRonda) continue;
    assert.ok(tv.state.round.hands[i].every(x => x.hidden),
      'sólo se ve la mano de quien dio permiso');
  }
  ok(`el permiso de la tele dura toda la partida${sillaAhora !== -1 ? ' (verificado en la mesa)' : ''}`);

  // ── al desconectarse, el micrófono queda cerrado
  a.close();
  await b.until(s => s.voice['v-a'] === false || s.members.every(m => m.id !== 'v-a'));
  ok('al caerse la conexión el micrófono se cierra solo');

  for (const x of [b,c,tv]) x.close();
  console.log(`\n${pass} pruebas de audio OK\n`);
};
run().catch(e => { console.error('\n✗', e.message, '\n'); process.exit(1); });
