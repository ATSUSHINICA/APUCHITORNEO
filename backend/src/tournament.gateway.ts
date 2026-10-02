import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';

import { Server, Socket } from 'socket.io';

import { TournamentService } from './tournament.service';

/** Tiempo que se espera antes de dar por ido a un jugador desconectado. */
const LOBBY_GRACE_MS = 10_000;
const GAME_GRACE_MS = 60_000;

const UNAUTHORIZED = { success: false as const, error: 'No autorizado.' };

@WebSocketGateway({
  cors: { origin: '*' },
  transports: ['websocket'],
})
export class TournamentGateway implements OnGatewayInit, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly service: TournamentService) {}

  /** Tras un reinicio, los jugadores que no vuelvan también caducan. */
  afterInit() {
    for (const { pin, playerId } of this.service.listDisconnected()) {
      this.scheduleRemoval(pin, playerId);
    }
  }

  // =========================================================
  // DIFUSIÓN
  // =========================================================

  /** Un único evento: todos reciben el estado completo y cada jugador el suyo. */
  private broadcast(pin: string): void {
    const snapshot = this.service.getSnapshot(pin);
    const tournament = this.service.getTournament(pin);
    if (!snapshot || !tournament) return;

    this.server.to(pin).emit('tournament:updated', snapshot);

    for (const player of tournament.players) {
      if (player.left || !player.connected) continue;
      this.server
        .to(`player:${player.id}`)
        .emit('player:state', this.service.getPlayerHistory(pin, player.id));
    }
  }

  // =========================================================
  // MARGEN DE DESCONEXIÓN
  // =========================================================

  private scheduleRemoval(pin: string, playerId: string): void {
    const key = `${pin}:${playerId}`;
    this.cancelRemoval(key);

    const tournament = this.service.getTournament(pin);
    const grace = tournament?.status === 'LOBBY' ? LOBBY_GRACE_MS : GAME_GRACE_MS;

    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        const player = this.service.getPlayerById(pin, playerId);
        if (!player || player.connected || player.left) return;
        this.service.removePlayer(pin, playerId);
        this.broadcast(pin);
      }, grace),
    );
  }

  private cancelRemoval(key: string): void {
    const timer = this.timers.get(key);
    if (timer) clearTimeout(timer);
    this.timers.delete(key);
  }

  // =========================================================
  // ACCIONES DEL ANFITRIÓN (misma plantilla para todas)
  // =========================================================

  private hostAction<T extends { success: boolean }>(
    client: Socket,
    pin: string,
    run: () => T,
  ) {
    if (!this.service.isHost(pin, client.id)) return UNAUTHORIZED;
    const result = run();
    if (result.success) this.broadcast(pin);
    return result;
  }

  // =========================================================
  // CREAR / UNIRSE / REENTRAR
  // =========================================================

  @SubscribeMessage('host:create')
  handleCreate(@ConnectedSocket() client: Socket) {
    const tournament = this.service.createTournament(client.id);
    client.join(tournament.pin);

    return {
      success: true,
      pin: tournament.pin,
      hostToken: tournament.hostToken,
      snapshot: this.service.getSnapshot(tournament.pin),
    };
  }

  @SubscribeMessage('player:join')
  handleJoin(
    @MessageBody() data: { pin: string; nickname: string },
    @ConnectedSocket() client: Socket,
  ) {
    if (!data?.pin || !data?.nickname) {
      return { success: false, error: 'Debes introducir el PIN y un apodo.' };
    }

    const pin = String(data.pin).trim();
    const result = this.service.addPlayer(pin, data.nickname, client.id);
    if (!result.success) return result;

    const { player } = result;
    client.join(pin);
    client.join(`player:${player.id}`);
    this.cancelRemoval(`${pin}:${player.id}`);
    this.broadcast(pin);

    return {
      success: true,
      pin,
      playerId: player.id,
      token: player.token,
      snapshot: this.service.getSnapshot(pin),
      state: this.service.getPlayerHistory(pin, player.id),
    };
  }

  /** El móvil vuelve a identificarse con su token (tras reconectar o reabrir la app). */
  @SubscribeMessage('session:rejoin')
  handleRejoin(
    @MessageBody()
    data: {
      pin: string;
      role: 'host' | 'player';
      playerId?: string;
      token: string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const pin = String(data?.pin ?? '');

    if (data?.role === 'host') {
      const result = this.service.rejoinHost(pin, data.token, client.id);
      if (!result.success) return result;

      client.join(pin);
      return {
        success: true,
        role: 'host',
        pin,
        snapshot: this.service.getSnapshot(pin),
      };
    }

    const result = this.service.rejoinPlayer(
      pin,
      data?.playerId ?? '',
      data?.token ?? '',
      client.id,
    );
    if (!result.success) return result;

    const { player } = result;
    client.join(pin);
    client.join(`player:${player.id}`);
    this.cancelRemoval(`${pin}:${player.id}`);
    this.broadcast(pin);

    return {
      success: true,
      role: 'player',
      pin,
      playerId: player.id,
      snapshot: this.service.getSnapshot(pin),
      state: this.service.getPlayerHistory(pin, player.id),
    };
  }

  // =========================================================
  // FLUJO DEL TORNEO
  // =========================================================

  @SubscribeMessage('host:start')
  handleStart(
    @MessageBody() data: { pin: string },
    @ConnectedSocket() client: Socket,
  ) {
    return this.hostAction(client, data.pin, () =>
      this.service.startTournament(data.pin),
    );
  }

  @SubscribeMessage('host:lockClassification')
  handleLock(
    @MessageBody() data: { pin: string },
    @ConnectedSocket() client: Socket,
  ) {
    return this.hostAction(client, data.pin, () =>
      this.service.lockClassification(data.pin),
    );
  }

  @SubscribeMessage('host:setResult')
  handleSetResult(
    @MessageBody()
    data: { pin: string; matchId: string; score1: number; score2: number },
    @ConnectedSocket() client: Socket,
  ) {
    return this.hostAction(client, data.pin, () =>
      this.service.setMatchResult(
        data.pin,
        data.matchId,
        Number(data.score1),
        Number(data.score2),
      ),
    );
  }

  // =========================================================
  // JUEGOS
  // =========================================================

  @SubscribeMessage('host:addGame')
  handleAddGame(
    @MessageBody() data: { pin: string; game: string },
    @ConnectedSocket() client: Socket,
  ) {
    return this.hostAction(client, data.pin, () =>
      this.service.addGame(data.pin, data.game),
    );
  }

  @SubscribeMessage('host:removeGame')
  handleRemoveGame(
    @MessageBody() data: { pin: string; game: string },
    @ConnectedSocket() client: Socket,
  ) {
    return this.hostAction(client, data.pin, () =>
      this.service.removeGame(data.pin, data.game),
    );
  }

  @SubscribeMessage('host:assignGame')
  handleAssignGame(
    @MessageBody() data: { pin: string; matchId: string; game: string },
    @ConnectedSocket() client: Socket,
  ) {
    return this.hostAction(client, data.pin, () =>
      this.service.assignGame(data.pin, data.matchId, data.game),
    );
  }

  @SubscribeMessage('host:rerollGame')
  handleRerollGame(
    @MessageBody() data: { pin: string; matchId: string },
    @ConnectedSocket() client: Socket,
  ) {
    return this.hostAction(client, data.pin, () =>
      this.service.rerollGame(data.pin, data.matchId),
    );
  }

  // =========================================================
  // EXPULSAR / CERRAR / SALIR
  // =========================================================

  @SubscribeMessage('host:kick')
  handleKick(
    @MessageBody() data: { pin: string; playerId: string },
    @ConnectedSocket() client: Socket,
  ) {
    if (!this.service.isHost(data.pin, client.id)) return UNAUTHORIZED;

    const result = this.service.kickPlayer(data.pin, data.playerId);
    if (!result.success) return result;

    this.cancelRemoval(`${data.pin}:${data.playerId}`);

    const room = `player:${data.playerId}`;
    this.server
      .to(room)
      .emit('player:kicked', { message: 'Has sido expulsado del torneo.' });
    this.server.in(room).socketsLeave([room, data.pin]);

    this.broadcast(data.pin);
    return { success: true };
  }

  /** El anfitrión cierra el torneo para todos. */
  @SubscribeMessage('host:close')
  handleClose(
    @MessageBody() data: { pin: string },
    @ConnectedSocket() client: Socket,
  ) {
    if (!this.service.isHost(data.pin, client.id)) return UNAUTHORIZED;

    client
      .to(data.pin)
      .emit('tournament:closed', { message: 'El anfitrión cerró el torneo.' });
    this.server.in(data.pin).socketsLeave(data.pin);
    this.service.deleteTournament(data.pin);

    return { success: true };
  }

  @SubscribeMessage('player:leave')
  handleLeave(@ConnectedSocket() client: Socket) {
    const found = this.service.findBySocket(client.id);
    if (!found || found.role !== 'player') {
      return { success: false, error: 'No estás dentro de ningún torneo.' };
    }

    const pin = found.tournament.pin;
    const playerId = found.player.id;

    this.cancelRemoval(`${pin}:${playerId}`);
    this.service.removePlayer(pin, playerId);
    client.leave(pin);
    client.leave(`player:${playerId}`);
    this.broadcast(pin);

    return { success: true };
  }

  // =========================================================
  // DESCONEXIÓN
  // =========================================================

  handleDisconnect(client: Socket) {
    const found = this.service.findBySocket(client.id);
    if (!found) return;

    const pin = found.tournament.pin;

    // El anfitrión nunca se elimina: puede volver con su hostToken.
    if (found.role === 'host') {
      this.service.setHostConnected(pin, false);
      return;
    }

    this.service.setPlayerConnected(pin, found.player.id, false);
    this.scheduleRemoval(pin, found.player.id);
    this.broadcast(pin);
  }

  // =========================================================
  // CONSULTA PUNTUAL
  // =========================================================

  @SubscribeMessage('tournament:getState')
  handleGetState(@MessageBody() data: { pin: string }) {
    const snapshot = this.service.getSnapshot(data?.pin);
    if (!snapshot) return { success: false, error: 'Torneo no encontrado.' };
    return { success: true, snapshot };
  }
}