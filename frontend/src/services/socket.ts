import { io, Socket } from 'socket.io-client';

// Puedes cambiarla sin tocar el código con EXPO_PUBLIC_SERVER_URL en un fichero .env
const SERVER_URL =
  process.env.EXPO_PUBLIC_SERVER_URL ?? 'http://172.22.28.50:3000';

export const socket: Socket = io(SERVER_URL, {
  autoConnect: true,
  transports: ['websocket'],
  reconnection: true,
  reconnectionDelay: 500,
  reconnectionDelayMax: 3000,
});