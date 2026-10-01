import { io, Socket } from 'socket.io-client';

const SERVER_URL = 'http://192.168.1.19:3000';

export const socket: Socket = io(SERVER_URL, {
  autoConnect: true,
  transports: ['websocket'],
});