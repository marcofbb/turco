// Servidor de Turco: estáticos de la PWA + WebSocket para el juego en vivo.

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { attachWebSocket } from './ws.js';
import {
  getOrCreateRoom,
  findRoomByTvCode,
  joinRoom,
  joinAsViewer,
  leaveRoom,
  leaveAsViewer,
  broadcast,
  roomState,
  handleAction,
  handleAdvance,
  handleRematch,
  newPlayerId,
} from './rooms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
};

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);

  if (pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (pathname === '/') pathname = '/index.html';

  const filePath = path.join(PUBLIC_DIR, pathname);
  // Evita escapar de public/ con ../
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const stat = await fsp.stat(filePath);
    if (stat.isDirectory()) throw new Error('dir');

    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'content-length': stat.size,
    };
    // El shell y el service worker se revalidan siempre; las cartas nunca cambian.
    if (ext === '.html' || pathname === '/sw.js') headers['cache-control'] = 'no-cache';
    else if (pathname.startsWith('/cards/')) headers['cache-control'] = 'public, max-age=31536000, immutable';
    else headers['cache-control'] = 'public, max-age=300';

    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  } catch {
    // SPA fallback: cualquier /XXXX (código de sala) devuelve el index.
    if (!path.extname(pathname)) {
      try {
        const html = await fsp.readFile(path.join(PUBLIC_DIR, 'index.html'));
        res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-cache' });
        res.end(html);
        return;
      } catch {
        /* cae al 404 */
      }
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('No encontrado');
  }
}

const server = http.createServer(serveStatic);

attachWebSocket(server, (ws) => {
  let room = null;
  let playerId = null;
  let isTv = false;

  const fail = (msg) => ws.send({ type: 'error', message: msg });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return fail('Mensaje inválido.');
    }

    switch (msg.type) {
      case 'join': {
        const requestedCode = msg.code ? String(msg.code).toUpperCase() : null;

        // Si el código es el de una tele, entra como pantalla pública.
        const tvRoom = requestedCode ? findRoomByTvCode(requestedCode) : null;
        if (tvRoom) {
          room = tvRoom;
          isTv = true;
          joinAsViewer(room, ws);
          ws.send({ type: 'joined', playerId: null, code: requestedCode, tv: true });
          broadcast(room);
          return;
        }

        // Si pide una sala puntual y no existe, la creamos con ese código.
        room = requestedCode ? getOrCreateRoom(requestedCode) : getOrCreateRoom(null);
        playerId = msg.playerId || newPlayerId();

        const result = joinRoom(room, { playerId, name: msg.name, socket: ws });
        if (result.error) {
          room = null;
          return fail(result.error);
        }
        playerId = result.member.id;

        ws.send({ type: 'joined', playerId, code: room.code });
        broadcast(room);
        return;
      }

      case 'action': {
        if (isTv) return fail('La tele sólo mira.');
        if (!room || !playerId) return fail('No estás en una sala.');
        const result = handleAction(room, playerId, msg.action);
        if (result.error) {
          fail(result.error);
          ws.send(roomState(room, playerId, { tv: isTv }));
          return;
        }
        broadcast(room);
        return;
      }

      case 'next': {
        if (isTv) return fail('La tele sólo mira.');
        if (!room) return fail('No estás en una sala.');
        const result = handleAdvance(room);
        if (result.error) return fail(result.error);
        broadcast(room);
        return;
      }

      case 'rematch': {
        if (isTv) return fail('La tele sólo mira.');
        if (!room) return fail('No estás en una sala.');
        const result = handleRematch(room);
        if (result.error) return fail(result.error);
        broadcast(room);
        return;
      }

      case 'sync': {
        if (!room) return;
        ws.send(roomState(room, playerId, { tv: isTv }));
        return;
      }

      case 'ping':
        ws.send({ type: 'pong' });
        return;

      default:
        fail('Acción desconocida.');
    }
  });

  ws.on('close', () => {
    if (!room) return;
    if (isTv) leaveAsViewer(room, ws);
    else leaveRoom(room, ws);
    broadcast(room);
    room = null;
  });
});

function localAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

server.listen(PORT, () => {
  const lan = localAddresses();
  console.log('\n  🃏  TURCO — servidor listo\n');
  console.log(`     Local:   http://localhost:${PORT}`);
  for (const ip of lan) console.log(`     Red:     http://${ip}:${PORT}`);
  console.log('\n     Abrí la app en 3 celulares y compartí el código de sala.\n');
});
