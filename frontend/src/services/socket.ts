import { io, Socket } from 'socket.io-client';

const SERVER_URL = 'http://172.22.28.50:3000';

export const socket: Socket = io(SERVER_URL, {
  autoConnect: true,
  transports: ['websocket'],
});