// WebSocket server mínimo (RFC 6455) sin dependencias externas.
// Sólo lo que necesita Turco: mensajes de texto, ping/pong y close.

import crypto from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 1 << 20; // 1 MB

const OP_CONT = 0x0;
const OP_TEXT = 0x1;
const OP_BIN = 0x2;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;

function encodeFrame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeUInt32BE(Math.floor(len / 2 ** 32), 2);
    header.writeUInt32BE(len >>> 0, 6);
  }
  header[0] = 0x80 | opcode; // FIN + opcode
  return Buffer.concat([header, payload]);
}

class Socket {
  constructor(raw) {
    this.raw = raw;
    this.open = true;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.fragmentOp = null;
    this.listeners = { message: [], close: [] };
    this.isAlive = true;
  }

  on(event, fn) {
    this.listeners[event]?.push(fn);
    return this;
  }

  emit(event, ...args) {
    for (const fn of this.listeners[event] ?? []) {
      try {
        fn(...args);
      } catch (err) {
        console.error(`[ws] error en handler "${event}":`, err);
      }
    }
  }

  send(data) {
    if (!this.open) return;
    const payload = Buffer.from(typeof data === 'string' ? data : JSON.stringify(data), 'utf8');
    try {
      this.raw.write(encodeFrame(OP_TEXT, payload));
    } catch {
      this.destroy();
    }
  }

  ping() {
    if (!this.open) return;
    try {
      this.raw.write(encodeFrame(OP_PING, Buffer.alloc(0)));
    } catch {
      this.destroy();
    }
  }

  close(code = 1000) {
    if (!this.open) return;
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(code, 0);
    try {
      this.raw.write(encodeFrame(OP_CLOSE, payload));
    } catch {
      /* ya cerrado */
    }
    this.destroy();
  }

  destroy() {
    if (!this.open) return;
    this.open = false;
    try {
      this.raw.destroy();
    } catch {
      /* noop */
    }
    this.emit('close');
  }

  feed(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    while (this.open) {
      const frame = this.readFrame();
      if (!frame) break;
      this.handleFrame(frame);
    }
  }

  readFrame() {
    const buf = this.buffer;
    if (buf.length < 2) return null;

    const fin = (buf[0] & 0x80) !== 0;
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let length = buf[1] & 0x7f;
    let offset = 2;

    if (length === 126) {
      if (buf.length < offset + 2) return null;
      length = buf.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (buf.length < offset + 8) return null;
      const high = buf.readUInt32BE(offset);
      const low = buf.readUInt32BE(offset + 4);
      length = high * 2 ** 32 + low;
      offset += 8;
    }

    if (length > MAX_MESSAGE) {
      this.close(1009);
      return null;
    }

    let mask = null;
    if (masked) {
      if (buf.length < offset + 4) return null;
      mask = buf.subarray(offset, offset + 4);
      offset += 4;
    }

    if (buf.length < offset + length) return null;

    const payload = Buffer.from(buf.subarray(offset, offset + length));
    if (mask) {
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    }

    this.buffer = buf.subarray(offset + length);
    return { fin, opcode, payload };
  }

  handleFrame({ fin, opcode, payload }) {
    switch (opcode) {
      case OP_CLOSE:
        this.close(1000);
        return;
      case OP_PING:
        if (this.open) this.raw.write(encodeFrame(OP_PONG, payload));
        return;
      case OP_PONG:
        this.isAlive = true;
        return;
      case OP_TEXT:
      case OP_BIN:
        if (!fin) {
          this.fragmentOp = opcode;
          this.fragments = [payload];
          return;
        }
        this.deliver(opcode, payload);
        return;
      case OP_CONT: {
        this.fragments.push(payload);
        if (!fin) return;
        const full = Buffer.concat(this.fragments);
        const op = this.fragmentOp;
        this.fragments = [];
        this.fragmentOp = null;
        this.deliver(op, full);
        return;
      }
      default:
        this.close(1002);
    }
  }

  deliver(opcode, payload) {
    if (opcode !== OP_TEXT) return;
    this.emit('message', payload.toString('utf8'));
  }
}

/** Engancha el manejo de upgrades HTTP → WebSocket sobre un server de node:http. */
export function attachWebSocket(server, onConnection) {
  const sockets = new Set();

  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (req.headers.upgrade?.toLowerCase() !== 'websocket' || !key) {
      socket.destroy();
      return;
    }

    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.setNoDelay(true);

    const ws = new Socket(socket);
    sockets.add(ws);
    socket.on('data', (chunk) => ws.feed(chunk));
    socket.on('error', () => ws.destroy());
    socket.on('close', () => ws.destroy());
    ws.on('close', () => sockets.delete(ws));

    onConnection(ws, req);
  });

  // Heartbeat: descarta conexiones muertas (móviles que se duermen, túneles, etc.)
  const timer = setInterval(() => {
    for (const ws of sockets) {
      if (!ws.isAlive) {
        ws.destroy();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);
  timer.unref?.();

  return sockets;
}
