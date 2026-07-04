import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

export function handleWebSocketUpgrade(_request: IncomingMessage, socket: Duplex) {
  socket.write('HTTP/1.1 501 Not Implemented\r\nConnection: close\r\n\r\n');
  socket.destroy();
}
