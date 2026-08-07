// Audio entre jugadores: WebRTC en malla (son 3, alcanza de sobra) con la
// señalización viajando por el WebSocket que ya usa el juego.
//
// Las teles quedan afuera: el servidor no les enruta señalización.

const ICE = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

let send = () => {};
let onChange = () => {};
let myId = null;

let localStream = null;
let micOn = false;
let deafened = false; // silenciar las voces de los demás para mí
let lastError = null;

/** peerId -> { pc, polite, makingOffer, ignoreOffer, audio, level } */
const peers = new Map();

// Medición de quién está hablando.
let meterCtx = null;
const meters = new Map(); // peerId | 'me' -> { analyser, data, level }
let meterTimer = null;

export const voice = {
  get micOn() { return micOn; },
  get deafened() { return deafened; },
  get error() { return lastError; },
  get connected() { return [...peers.keys()]; },

  /** ¿El navegador puede pedir micrófono acá? Necesita HTTPS o localhost. */
  get supported() {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  },
  get secureContext() {
    return typeof window !== 'undefined' && window.isSecureContext;
  },

  /** Nivel de voz 0..1 de alguien, para el indicador de "está hablando". */
  level(id) { return meters.get(id)?.level ?? 0; },

  init,
  toggleMic,
  toggleDeafen,
  syncPeers,
  handleSignal,
  stop,
};

function init(opts) {
  send = opts.send;
  myId = opts.myId;
  onChange = opts.onChange ?? (() => {});
}

// ─────────────────────────── micrófono propio ───────────────────────────

async function toggleMic() {
  lastError = null;

  if (micOn) {
    micOn = false;
    // Cortamos el envío pero mantenemos las conexiones: volver a prender es instantáneo.
    for (const track of localStream?.getAudioTracks() ?? []) track.enabled = false;
    meters.delete('me');
    announce();
    onChange();
    return;
  }

  if (!voice.supported) {
    lastError = voice.secureContext
      ? 'Este navegador no da acceso al micrófono.'
      : 'El micrófono necesita HTTPS. Andá por el link seguro o por localhost.';
    onChange();
    return;
  }

  try {
    if (!localStream) {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      attachMeter('me', localStream);
    }
    for (const track of localStream.getAudioTracks()) track.enabled = true;
    micOn = true;

    // Ahora que hay audio propio, lo mandamos a cada peer.
    for (const [peerId, peer] of peers) addLocalTracks(peer, peerId);

    announce();
    onChange();
  } catch (err) {
    lastError =
      err?.name === 'NotAllowedError'
        ? 'No diste permiso para el micrófono.'
        : err?.name === 'NotFoundError'
          ? 'No se encontró ningún micrófono.'
          : `No se pudo abrir el micrófono (${err?.name ?? 'error'}).`;
    onChange();
  }
}

/** Silencia para mí las voces de todos, sin tocar el audio del juego. */
function toggleDeafen() {
  deafened = !deafened;
  for (const peer of peers.values()) {
    if (peer.audio) peer.audio.muted = deafened;
  }
  onChange();
  return deafened;
}

function announce() {
  send({ type: 'voice', on: micOn });
}

// ─────────────────────────── peers ───────────────────────────

/** Sincroniza las conexiones con la lista de miembros de la sala. */
function syncPeers(memberIds) {
  const others = memberIds.filter((id) => id && id !== myId);

  for (const id of others) if (!peers.has(id)) createPeer(id);
  for (const id of [...peers.keys()]) if (!others.includes(id)) dropPeer(id);
}

function createPeer(peerId) {
  const pc = new RTCPeerConnection({ iceServers: ICE });
  // "Perfect negotiation": uno de los dos cede ante una colisión de ofertas.
  // El orden alfabético de los ids nos da un criterio estable y sin acuerdo previo.
  const peer = { pc, polite: myId < peerId, makingOffer: false, ignoreOffer: false, audio: null };
  peers.set(peerId, peer);

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) send({ type: 'rtc', to: peerId, data: { candidate } });
  };

  pc.ontrack = ({ streams }) => {
    const stream = streams[0];
    if (!stream) return;
    if (!peer.audio) {
      const el = document.createElement('audio');
      el.autoplay = true;
      el.playsInline = true;
      el.muted = deafened;
      el.dataset.peer = peerId;
      el.style.display = 'none';
      // Safari no reproduce elementos sueltos: tienen que estar en el documento.
      document.body.appendChild(el);
      peer.audio = el;
    }
    peer.audio.srcObject = stream;
    peer.audio.play().catch(() => { /* hace falta un gesto; ya habrá uno */ });
    attachMeter(peerId, stream);
    onChange();
  };

  pc.onnegotiationneeded = async () => {
    try {
      peer.makingOffer = true;
      await pc.setLocalDescription();
      send({ type: 'rtc', to: peerId, data: { description: pc.localDescription } });
    } catch { /* la renegociación reintenta sola */ } finally {
      peer.makingOffer = false;
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') pc.restartIce?.();
    onChange();
  };

  if (micOn) addLocalTracks(peer, peerId);
  return peer;
}

function addLocalTracks(peer, peerId) {
  if (!localStream) return;
  const yaEstan = peer.pc.getSenders().some((s) => s.track?.kind === 'audio');
  if (yaEstan) return;
  for (const track of localStream.getAudioTracks()) {
    peer.pc.addTrack(track, localStream);
  }
}

function dropPeer(peerId) {
  const peer = peers.get(peerId);
  if (!peer) return;
  try { peer.pc.close(); } catch { /* ya cerrado */ }
  if (peer.audio) { peer.audio.srcObject = null; peer.audio.remove(); }
  meters.delete(peerId);
  peers.delete(peerId);
  onChange();
}

/** Recibe una oferta, respuesta o candidato de otro jugador. */
async function handleSignal(from, data) {
  let peer = peers.get(from);
  if (!peer) peer = createPeer(from);
  const { pc, polite } = peer;

  try {
    if (data.description) {
      const colision =
        data.description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
      peer.ignoreOffer = !polite && colision;
      if (peer.ignoreOffer) return;

      await pc.setRemoteDescription(data.description);
      if (data.description.type === 'offer') {
        await pc.setLocalDescription();
        send({ type: 'rtc', to: from, data: { description: pc.localDescription } });
      }
    } else if (data.candidate) {
      try {
        await pc.addIceCandidate(data.candidate);
      } catch (err) {
        if (!peer.ignoreOffer) throw err;
      }
    }
  } catch { /* si la negociación falla, onnegotiationneeded reintenta */ }
}

function stop() {
  for (const id of [...peers.keys()]) dropPeer(id);
  for (const track of localStream?.getAudioTracks() ?? []) track.stop();
  localStream = null;
  micOn = false;
  meters.clear();
  stopMeterLoop();
}

// ─────────────────────────── quién está hablando ───────────────────────────

function attachMeter(id, stream) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!meterCtx) meterCtx = new AC();
    const source = meterCtx.createMediaStreamSource(stream);
    const analyser = meterCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser);
    meters.set(id, { analyser, data: new Uint8Array(analyser.frequencyBinCount), level: 0 });
    startMeterLoop();
  } catch { /* el indicador es opcional */ }
}

function startMeterLoop() {
  if (meterTimer) return;
  meterTimer = setInterval(() => {
    let cambio = false;
    for (const [id, m] of meters) {
      m.analyser.getByteFrequencyData(m.data);
      let suma = 0;
      for (const v of m.data) suma += v;
      const nivel = Math.min(1, suma / m.data.length / 90);
      // Sólo avisamos si cruzó el umbral de "está hablando".
      if ((nivel > 0.12) !== (m.level > 0.12)) cambio = true;
      m.level = nivel;
      if (id === 'me' && !micOn) m.level = 0;
    }
    if (cambio) onChange();
  }, 120);
}

function stopMeterLoop() {
  clearInterval(meterTimer);
  meterTimer = null;
}
