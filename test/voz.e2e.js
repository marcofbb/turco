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

  // ── al desconectarse, el micrófono queda cerrado
  a.close();
  await b.until(s => s.voice['v-a'] === false || s.members.every(m => m.id !== 'v-a'));
  ok('al caerse la conexión el micrófono se cierra solo');

  for (const x of [b,c,tv]) x.close();
  console.log(`\n${pass} pruebas de audio OK\n`);
};
run().catch(e => { console.error('\n✗', e.message, '\n'); process.exit(1); });
