import { io, Socket } from 'socket.io-client';

// IMPORTANTE: En el emulador usa 'http://10.0.2.2:3000'. 
// Si usas tu móvil físico por Wi-Fi, pon la IP local de tu PC (ej: 'http://192.168.1.50:3000').
const SERVER_URL = 'http://192.168.1.19:3000';

export const socket: Socket = io(SERVER_URL, {
  autoConnect: true,
  transports: ['websocket'],
});