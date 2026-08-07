// Salas de Turco: 3 jugadores por sala, con reconexión por playerId.

import crypto from 'node:crypto';
import { createMatch, applyAction, advance, viewFor, playerById } from './game.js';

const ROOM_TTL_MS = 6 * 60 * 60 * 1000; // salas vacías se limpian a las 6 h
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin I/O/0/1

const rooms = new Map();
const tvCodes = new Map(); // código de tele -> sala

function makeCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');
  } while (rooms.has(code) || tvCodes.has(code));
  return code;
}

export function newPlayerId() {
  return crypto.randomUUID();
}

function createRoom(code) {
  const room = {
    code,
    tvCode: makeCode(), // segundo código: entra en modo tele, sin ver manos
    members: [], // {id, name, socket|null, connected}
    viewers: new Set(), // pantallas en modo tele
    match: null,
    createdAt: Date.now(),
    touchedAt: Date.now(),
  };
  rooms.set(code, room);
  tvCodes.set(room.tvCode, room);
  return room;
}

export function getOrCreateRoom(code) {
  if (!code) return createRoom(makeCode());
  const normalized = String(code).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  if (!normalized) return createRoom(makeCode());
  return rooms.get(normalized) ?? createRoom(normalized);
}

export function findRoom(code) {
  return rooms.get(String(code ?? '').toUpperCase()) ?? null;
}

/** ¿Este código es el de una tele? Devuelve la sala a la que pertenece. */
export function findRoomByTvCode(code) {
  return tvCodes.get(String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')) ?? null;
}

export function joinAsViewer(room, socket) {
  room.viewers.add(socket);
  room.touchedAt = Date.now();
  return { ok: true };
}

export function leaveAsViewer(room, socket) {
  room.viewers.delete(socket);
}

function sanitizeName(name, fallback) {
  const clean = String(name ?? '').trim().replace(/\s+/g, ' ').slice(0, 14);
  return clean || fallback;
}

export function joinRoom(room, { playerId, name, socket }) {
  room.touchedAt = Date.now();

  // Reconexión: mismo playerId vuelve a su lugar (y a su mano).
  const existing = room.members.find((m) => m.id === playerId);
  if (existing) {
    existing.socket?.close();
    existing.socket = socket;
    existing.connected = true;
    if (name) {
      existing.name = sanitizeName(name, existing.name);
      const p = room.match && playerById(room.match, existing.id);
      if (p) p.name = existing.name;
    }
    return { member: existing, reconnected: true };
  }

  if (room.members.length >= 3) return { error: 'La sala ya está completa (3 jugadores).' };

  const member = {
    id: playerId || newPlayerId(),
    name: sanitizeName(name, `Jugador ${room.members.length + 1}`),
    socket,
    connected: true,
    mic: false, // audio entre jugadores
  };
  room.members.push(member);

  // Con los 3 en la sala se hace el sorteo; la partida arranca cuando dan "Empezar".
  if (room.members.length === 3 && !room.match) {
    room.match = createMatch(room.members.map((m) => ({ id: m.id, name: m.name })));
  }

  return { member, reconnected: false };
}

export function leaveRoom(room, socket) {
  const member = room.members.find((m) => m.socket === socket);
  if (!member) return null;
  member.socket = null;
  member.connected = false;
  member.mic = false;
  room.touchedAt = Date.now();

  // Si nadie llegó a jugar todavía, liberamos el asiento para que entre otro.
  if (!room.match) {
    room.members = room.members.filter((m) => m !== member);
  }
  return member;
}

export function roomState(room, playerId, opts = {}) {
  const isTv = opts.tv === true;
  const lobby = {
    type: 'state',
    code: room.code,
    // El código de tele se lo mostramos sólo a los jugadores, para que lo compartan.
    tvCode: isTv ? null : room.tvCode,
    viewers: room.viewers.size,
    you: { id: playerId, isTv },
    members: room.members.map((m) => ({
      id: m.id, name: m.name, connected: m.connected, mic: !!m.mic,
    })),
    // La tele no participa del audio, pero sí puede mostrar quién está hablando.
    voice: Object.fromEntries(room.members.map((m) => [m.id, !!m.mic])),
  };

  if (!room.match) {
    return { ...lobby, phase: 'lobby', needed: 3 - room.members.length };
  }

  const view = viewFor(room.match, playerId, { tv: isTv });
  return {
    ...lobby,
    ...view,
    you: { ...view.you, isTv },
    connected: Object.fromEntries(room.members.map((m) => [m.id, m.connected])),
  };
}

export function broadcast(room) {
  for (const m of room.members) {
    if (m.socket && m.connected) m.socket.send(roomState(room, m.id));
  }
  for (const socket of room.viewers) {
    socket.send(roomState(room, null, { tv: true }));
  }
}

/** Marca si un jugador abrió o cerró su micrófono. */
export function setMic(room, playerId, on) {
  const member = room.members.find((m) => m.id === playerId);
  if (!member) return { error: 'No estás en la sala.' };
  member.mic = !!on;
  return { ok: true };
}

/**
 * Reenvía señalización WebRTC a otro jugador de la sala.
 * Sólo entre miembros: las teles nunca reciben ni mandan.
 */
export function relaySignal(room, fromId, toId, data) {
  const from = room.members.find((m) => m.id === fromId);
  if (!from) return { error: 'No estás en la sala.' };
  const target = room.members.find((m) => m.id === toId);
  if (!target?.socket || !target.connected) return { error: 'Ese jugador no está conectado.' };
  target.socket.send({ type: 'rtc', from: fromId, data });
  return { ok: true };
}

export function handleAction(room, playerId, action) {
  if (!room.match) return { error: 'Faltan jugadores para empezar.' };
  return applyAction(room.match, playerId, action);
}

export function handleAdvance(room) {
  if (!room.match) return { error: 'No hay partida.' };
  return advance(room.match);
}

export function handleRematch(room) {
  if (!room.match) return { error: 'No hay partida.' };
  if (room.match.phase !== 'gameEnd') return { error: 'La partida sigue en juego.' };
  room.match = createMatch(room.members.map((m) => ({ id: m.id, name: m.name })));
  return { ok: true };
}

// Limpieza periódica de salas abandonadas.
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const anyConnected = room.members.some((m) => m.connected) || room.viewers.size > 0;
    if (!anyConnected && now - room.touchedAt > ROOM_TTL_MS) {
      rooms.delete(code);
      tvCodes.delete(room.tvCode);
    }
  }
}, 15 * 60 * 1000);
sweeper.unref?.();

export function roomCount() {
  return rooms.size;
}
