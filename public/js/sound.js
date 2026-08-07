// Sonido de Turco: todo sintetizado con Web Audio (sin archivos, funciona offline).
// Los cantos además se "gritan" con la voz del sistema si está disponible.

const KEY = 'turco.sound';
const VOICE_KEY = 'turco.voice';

let ctx = null;
let master = null;
let unlocked = false;

let enabled = localStorage.getItem(KEY) !== 'off';
let voiceEnabled = localStorage.getItem(VOICE_KEY) !== 'off';

/** Tres estados en un solo botón: todo / sólo efectos / mudo. */
const MODES = [
  { id: 'full', icon: '🔊', label: 'Sonido y voz' },
  { id: 'sfx', icon: '🔉', label: 'Sólo sonidos' },
  { id: 'off', icon: '🔇', label: 'Silencio' },
];

function currentMode() {
  if (!enabled) return MODES[2];
  return voiceEnabled ? MODES[0] : MODES[1];
}

export const sound = {
  get enabled() { return enabled; },
  get voiceEnabled() { return voiceEnabled; },
  get mode() { return currentMode(); },

  /** Avanza al siguiente estado y devuelve el nuevo. */
  cycle() {
    const next = MODES[(MODES.indexOf(currentMode()) + 1) % MODES.length];
    enabled = next.id !== 'off';
    voiceEnabled = next.id === 'full';
    localStorage.setItem(KEY, enabled ? 'on' : 'off');
    localStorage.setItem(VOICE_KEY, voiceEnabled ? 'on' : 'off');
    if (!enabled) stopVoice();
    else { unlock(); play('turn'); }
    return next;
  },

  play,
  say,
  unlock,
};

// ─────────────────────────── contexto ───────────────────────────

/** iOS y Chrome exigen un gesto del usuario antes de dejar sonar nada. */
export function unlock() {
  if (unlocked) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    unlocked = true;
  } catch { /* sin audio, el juego sigue igual */ }
}

function ready() {
  if (!enabled) return false;
  if (!unlocked) unlock();
  if (!ctx) return false;
  if (ctx.state === 'suspended') ctx.resume();
  return true;
}

// ─────────────────────────── ladrillos ───────────────────────────

/** Una nota. `slide` desliza la frecuencia; `type` es la forma de onda. */
function tone(freq, { at = 0, dur = 0.16, type = 'triangle', gain = 0.3, slide = null } = {}) {
  const t0 = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t0 + dur);

  // Envolvente suave: sin clicks al arrancar ni al cortar.
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** Ruido filtrado: sirve para el roce de las cartas. */
function noise({ at = 0, dur = 0.12, gain = 0.25, freq = 1800, q = 0.8, sweepTo = null } = {}) {
  const t0 = ctx.currentTime + at;
  const frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(freq, t0);
  filter.Q.value = q;
  if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);

  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  src.connect(filter).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

const N = { C4: 261.6, D4: 293.7, E4: 329.6, F4: 349.2, G4: 392, A4: 440, B4: 493.9,
            C5: 523.3, D5: 587.3, E5: 659.3, F5: 698.5, G5: 784, A5: 880, B5: 987.8, C6: 1046.5 };

// ─────────────────────────── sonidos ───────────────────────────

const SOUNDS = {
  // Carta sobre la mesa: roce corto y seco.
  card() {
    noise({ dur: 0.09, gain: 0.3, freq: 2600, sweepTo: 900, q: 0.6 });
    tone(180, { dur: 0.06, gain: 0.12, type: 'sine', slide: 120 });
  },

  // Envido: dos notas que suben, tono "azul", medio pícaro.
  ENVIDO() {
    tone(N.E5, { dur: 0.13, gain: 0.28 });
    tone(N.B5, { at: 0.1, dur: 0.2, gain: 0.26 });
  },
  REAL_ENVIDO() {
    tone(N.E5, { dur: 0.11, gain: 0.28 });
    tone(N.G5, { at: 0.09, dur: 0.11, gain: 0.28 });
    tone(N.C6, { at: 0.18, dur: 0.26, gain: 0.3 });
  },
  FALTA_ENVIDO() {
    [N.E5, N.G5, N.B5, N.C6].forEach((f, i) =>
      tone(f, { at: i * 0.075, dur: i === 3 ? 0.34 : 0.1, gain: 0.3, type: 'triangle' }));
    tone(N.E4, { at: 0.22, dur: 0.34, gain: 0.16, type: 'sine' });
  },

  // Truco: golpe seco y grave, con actitud.
  TRUCO() {
    tone(N.A4, { dur: 0.1, gain: 0.34, type: 'square' });
    tone(N.D4, { at: 0.08, dur: 0.24, gain: 0.3, type: 'square' });
  },
  RETRUCO() {
    tone(N.B4, { dur: 0.09, gain: 0.34, type: 'square' });
    tone(N.G4, { at: 0.07, dur: 0.09, gain: 0.32, type: 'square' });
    tone(N.D4, { at: 0.15, dur: 0.28, gain: 0.32, type: 'square' });
  },
  VALE_CUATRO() {
    [N.D5, N.B4, N.G4, N.D4].forEach((f, i) =>
      tone(f, { at: i * 0.07, dur: i === 3 ? 0.4 : 0.08, gain: 0.34, type: 'square' }));
    noise({ at: 0.21, dur: 0.3, gain: 0.14, freq: 300, sweepTo: 90 });
  },

  // Respuestas.
  QUIERO_ENVIDO() { quiero(); },
  QUIERO_TRUCO() { quiero(); },
  NO_QUIERO_ENVIDO() { noQuiero(); },
  NO_QUIERO_TRUCO() { noQuiero(); },

  // Mostrar los tantos: fanfarria corta y confiada.
  SHOW_TANTOS() {
    tone(N.C5, { dur: 0.1, gain: 0.28 });
    tone(N.E5, { at: 0.08, dur: 0.1, gain: 0.28 });
    tone(N.A5, { at: 0.16, dur: 0.3, gain: 0.3 });
  },

  // Al mazo: caída y golpe del mazo sobre la mesa.
  MAZO() {
    tone(N.G4, { dur: 0.3, gain: 0.26, type: 'sawtooth', slide: 90 });
    noise({ at: 0.22, dur: 0.16, gain: 0.3, freq: 260, sweepTo: 80, q: 0.5 });
  },

  // Repartida y sorteo.
  deal() {
    for (let i = 0; i < 6; i++) {
      noise({ at: i * 0.075, dur: 0.07, gain: 0.18, freq: 2400, sweepTo: 1000, q: 0.7 });
    }
  },
  draw() {
    for (let i = 0; i < 3; i++) {
      noise({ at: i * 0.13, dur: 0.08, gain: 0.22, freq: 2400, sweepTo: 1100 });
      tone(N.C5 + i * 60, { at: i * 0.13, dur: 0.1, gain: 0.18, type: 'sine' });
    }
  },

  turn() { tone(N.A5, { dur: 0.1, gain: 0.16, type: 'sine' }); },

  // Cierres de ronda.
  win() {
    [N.C5, N.E5, N.G5, N.C6].forEach((f, i) =>
      tone(f, { at: i * 0.085, dur: i === 3 ? 0.45 : 0.13, gain: 0.3 }));
  },
  lose() {
    [N.G4, N.E4, N.C4].forEach((f, i) =>
      tone(f, { at: i * 0.11, dur: i === 2 ? 0.4 : 0.14, gain: 0.26, type: 'sine' }));
  },
  tie() {
    tone(N.D5, { dur: 0.12, gain: 0.26, type: 'sine' });
    tone(N.D5, { at: 0.16, dur: 0.12, gain: 0.26, type: 'sine' });
    tone(N.A4, { at: 0.32, dur: 0.3, gain: 0.22, type: 'sine' });
  },
  pacto() {
    // Nada se revela: dos golpecitos sordos, cómplices.
    noise({ dur: 0.07, gain: 0.2, freq: 500, sweepTo: 200, q: 0.5 });
    noise({ at: 0.13, dur: 0.09, gain: 0.18, freq: 420, sweepTo: 160, q: 0.5 });
  },
  gameWin() {
    [N.C5, N.E5, N.G5, N.C6, N.G5, N.C6].forEach((f, i) =>
      tone(f, { at: i * 0.11, dur: i === 5 ? 0.7 : 0.15, gain: 0.32 }));
    tone(N.C4, { at: 0.55, dur: 0.7, gain: 0.18, type: 'sine' });
  },
  magistral() {
    [N.C5, N.E5, N.G5, N.C6, N.E5, N.G5, N.C6].forEach((f, i) =>
      tone(f, { at: i * 0.1, dur: i === 6 ? 0.9 : 0.14, gain: 0.32 }));
    [N.C4, N.G4, N.C5].forEach((f, i) =>
      tone(f, { at: 0.6 + i * 0.05, dur: 0.9, gain: 0.14, type: 'sine' }));
  },
};

function quiero() {
  tone(N.C5, { dur: 0.1, gain: 0.28, type: 'sine' });
  tone(N.G5, { at: 0.08, dur: 0.22, gain: 0.28, type: 'sine' });
}
function noQuiero() {
  tone(N.E4, { dur: 0.1, gain: 0.26, type: 'sawtooth' });
  tone(N.C4, { at: 0.08, dur: 0.22, gain: 0.24, type: 'sawtooth' });
}

export function play(name) {
  if (!ready()) return;
  try { SOUNDS[name]?.(); } catch { /* que un sonido no rompa una jugada */ }
}

// ─────────────────────────── voz ───────────────────────────

const SPOKEN = {
  ENVIDO: '¡Envido!',
  REAL_ENVIDO: '¡Real envido!',
  FALTA_ENVIDO: '¡Falta envido!',
  TRUCO: '¡Truco!',
  RETRUCO: '¡Retruco!',
  VALE_CUATRO: '¡Vale cuatro!',
  QUIERO_ENVIDO: '¡Quiero!',
  QUIERO_TRUCO: '¡Quiero!',
  NO_QUIERO_ENVIDO: 'No quiero',
  NO_QUIERO_TRUCO: 'No quiero',
  MAZO: 'Me voy al mazo',
  SHOW_TANTOS: '¡Muestro los tantos!',
};

let voice = null;
let voiceResolved = false;

function pickVoice() {
  if (voiceResolved) return voice;
  const synth = window.speechSynthesis;
  if (!synth) return null;
  const voices = synth.getVoices();
  if (!voices.length) return null; // todavía no cargaron; se reintenta
  voice =
    voices.find((v) => /^es[-_]AR/i.test(v.lang)) ??
    voices.find((v) => /^es[-_](419|MX|US|CO|CL|UY)/i.test(v.lang)) ??
    voices.find((v) => /^es/i.test(v.lang)) ??
    null;
  voiceResolved = true;
  return voice;
}

if (window.speechSynthesis) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.addEventListener?.('voiceschanged', () => {
    voiceResolved = false;
    pickVoice();
  });
}

function stopVoice() {
  try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
}

/** Canta la jugada. Sólo se usa para los cantos, no para cada carta. */
export function say(kind) {
  if (!enabled || !voiceEnabled) return;
  const text = SPOKEN[kind];
  if (!text || !window.speechSynthesis) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) u.voice = v;
    u.lang = v?.lang ?? 'es-AR';
    u.rate = 1.08;
    u.pitch = 1.0;
    u.volume = 0.9;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch { /* la voz es opcional */ }
}

// Primer toque en cualquier lado: habilita el audio.
for (const ev of ['pointerdown', 'touchstart', 'keydown']) {
  window.addEventListener(ev, () => unlock(), { once: true, passive: true });
}
