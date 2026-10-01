import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';

import { Server, Socket } from 'socket.io';

import { TournamentService } from './tournament.service';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  transports: ['websocket'],
})
export class TournamentGateway
  implements OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly tournamentService: TournamentService,
  ) {}

  // =========================================================
  // HELPERS
  // =========================================================

  private emitTournamentUpdate(
    pin: string,
  ): void {
    const snapshot =
      this.tournamentService.getSnapshot(pin);

    if (!snapshot) {
      return;
    }

    // Evento principal.
    this.server
      .to(pin)
      .emit('tournament:updated', snapshot);

    // Lo mantenemos para que tu App.tsx actual
    // siga funcionando sin cambiar su apariencia.
    this.server
      .to(pin)
      .emit('bracket:update', snapshot);

    // Si acaba el torneo, avisamos también.
    if (snapshot.phase === 'FINISHED') {
      this.server
        .to(pin)
        .emit('tournament:end', {
          champion: snapshot.champion,
          snapshot,
        });
    }
  }

  private emitLobbyUpdate(
    pin: string,
  ): void {
    const tournament =
      this.tournamentService.getTournament(pin);

    if (!tournament) {
      return;
    }

    this.server
      .to(pin)
      .emit(
        'lobby:update',
        tournament.players.filter(
          (player) => !player.left,
        ),
      );

    this.emitTournamentUpdate(pin);
  }

  private emitPlayerState(
    pin: string,
  ): void {
    const tournament =
      this.tournamentService.getTournament(pin);

    if (!tournament) {
      return;
    }

    for (
      const player of tournament.players
    ) {
      if (player.left) {
        continue;
      }

      const state =
        this.tournamentService.getPlayerHistory(
          pin,
          player.id,
        );

      this.server
        .to(player.id)
        .emit('player:state', state);
    }
  }

  private isHost(
    pin: string,
    socketId: string,
  ): boolean {
    const tournament =
      this.tournamentService.getTournament(pin);

    return !!tournament &&
      tournament.hostSocketId === socketId;
  }

  // =========================================================
  // CREAR TORNEO
  // =========================================================

  @SubscribeMessage('host:create')
  handleCreateTournament(
    @ConnectedSocket() client: Socket,
  ) {
    const tournament =
      this.tournamentService.createTournament(
        client.id,
      );

    client.join(tournament.pin);

    return {
      success: true,

      pin: tournament.pin,

      games: tournament.games,

      phase: tournament.status,
    };
  }

  // =========================================================
  // UNIRSE AL TORNEO
  // =========================================================

  @SubscribeMessage('player:join')
  handleJoinTournament(
    @MessageBody()
    data: {
      pin: string;
      nickname: string;
    },

    @ConnectedSocket()
    client: Socket,
  ) {
    if (!data?.pin || !data?.nickname) {
      return {
        success: false,
        error:
          'Debes introducir el PIN y un apodo.',
      };
    }

    const result =
      this.tournamentService.addPlayer(
        data.pin,
        {
          id: client.id,
          nickname: data.nickname,
        },
      );

    if (!result.success) {
      return result;
    }

    client.join(data.pin);

    const tournament =
      this.tournamentService.getTournament(
        data.pin,
      );

    if (!tournament) {
      return {
        success: false,
        error:
          'Torneo no encontrado.',
      };
    }

    // Actualizamos lobby.
    this.emitLobbyUpdate(
      data.pin,
    );

    return {
      success: true,

      pin: data.pin,

      players:
        tournament.players.filter(
          (player) =>
            !player.left,
        ),

      games: tournament.games,

      phase: tournament.status,
    };
  }

  // =========================================================
  // INICIAR TORNEO
  // =========================================================

  @SubscribeMessage('host:start')
  handleStartTournament(
    @MessageBody()
    data: {
      pin: string;
    },

    @ConnectedSocket()
    client: Socket,
  ) {
    if (
      !this.isHost(
        data.pin,
        client.id,
      )
    ) {
      return {
        success: false,
        error: 'No autorizado.',
      };
    }

    const tournament =
      this.tournamentService.getTournament(
        data.pin,
      );

    if (!tournament) {
      return {
        success: false,
        error:
          'Torneo no encontrado.',
      };
    }

    if (
      tournament.players.length < 2
    ) {
      return {
        success: false,
        error:
          'Se necesitan al menos 2 jugadores.',
      };
    }

    if (
      tournament.status !== 'LOBBY'
    ) {
      return {
        success: false,
        error:
          'El torneo ya ha comenzado.',
      };
    }

    const matches =
      this.tournamentService.generateClassification(
        tournament,
      );

    const snapshot =
      this.tournamentService.getSnapshot(
        data.pin,
      );

    // Evento que ya utiliza tu frontend.
    this.server
      .to(data.pin)
      .emit('tournament:started', {
        matches,

        snapshot,
      });

    // Evento adicional para mantener todo sincronizado.
    this.emitTournamentUpdate(
      data.pin,
    );

    this.emitPlayerState(
      data.pin,
    );

    return {
      success: true,

      matches,

      snapshot,
    };
  }

  // =========================================================
  // CERRAR CLASIFICACIÓN
  // =========================================================

  @SubscribeMessage(
    'host:lockClassification',
  )
  handleLockClassification(
    @MessageBody()
    data: {
      pin: string;
    },

    @ConnectedSocket()
    client: Socket,
  ) {
    if (
      !this.isHost(
        data.pin,
        client.id,
      )
    ) {
      return {
        success: false,
        error: 'No autorizado.',
      };
    }

    const result =
      this.tournamentService.lockClassification(
        data.pin,
      );

    if (!result.success) {
      return result;
    }

    this.emitTournamentUpdate(
      data.pin,
    );

    this.emitPlayerState(
      data.pin,
    );

    return {
      success: true,

      snapshot:
        this.tournamentService.getSnapshot(
          data.pin,
        ),
    };
  }

  // =========================================================
  // REGISTRAR RESULTADO
  // =========================================================

  @SubscribeMessage('host:setResult')
  handleSetResult(
    @MessageBody()
    data: {
      pin: string;
      matchId: string;
      score1: number;
      score2: number;
    },

    @ConnectedSocket()
    client: Socket,
  ) {
    if (
      !this.isHost(
        data.pin,
        client.id,
      )
    ) {
      return {
        success: false,
        error: 'No autorizado.',
      };
    }

    /*
     * IMPORTANTE:
     *
     * Ya NO necesitamos winnerId.
     *
     * El backend determina automáticamente
     * el ganador mediante score1 y score2.
     */
    const result =
      this.tournamentService.setMatchResult(
        data.pin,
        data.matchId,
        Number(data.score1),
        Number(data.score2),
      );

    if (!result.success) {
      return result;
    }

    /*
     * Todos reciben el nuevo cuadro.
     */
    this.emitTournamentUpdate(
      data.pin,
    );

    /*
     * Cada jugador recibe también
     * su rival, juego e historial.
     */
    this.emitPlayerState(
      data.pin,
    );

    return {
      success: true,

      finished:
        result.isFinished,

      snapshot:
        this.tournamentService.getSnapshot(
          data.pin,
        ),
    };
  }

  // =========================================================
  // AÑADIR JUEGO
  // =========================================================

  @SubscribeMessage('host:addGame')
  handleAddGame(
    @MessageBody()
    data: {
      pin: string;
      game: string;
    },

    @ConnectedSocket()
    client: Socket,
  ) {
    if (
      !this.isHost(
        data.pin,
        client.id,
      )
    ) {
      return {
        success: false,
        error: 'No autorizado.',
      };
    }

    const result =
      this.tournamentService.addGame(
        data.pin,
        data.game,
      );

    if (!result.success) {
      return result;
    }

    /*
     * Actualizamos la lista de juegos
     * de todos los participantes.
     */
    this.server
      .to(data.pin)
      .emit('games:update', {
        games: result.games,
      });

    this.emitTournamentUpdate(
      data.pin,
    );

    return result;
  }

  // =========================================================
  // ELIMINAR JUEGO
  // =========================================================

  @SubscribeMessage('host:removeGame')
  handleRemoveGame(
    @MessageBody()
    data: {
      pin: string;
      game: string;
    },

    @ConnectedSocket()
    client: Socket,
  ) {
    if (
      !this.isHost(
        data.pin,
        client.id,
      )
    ) {
      return {
        success: false,
        error: 'No autorizado.',
      };
    }

    const result =
      this.tournamentService.removeGame(
        data.pin,
        data.game,
      );

    if (!result.success) {
      return result;
    }

    this.server
      .to(data.pin)
      .emit('games:update', {
        games: result.games,
      });

    this.emitTournamentUpdate(
      data.pin,
    );

    return result;
  }

  // =========================================================
  // EXPULSAR JUGADOR
  // =========================================================

  @SubscribeMessage('host:kick')
  handleKickPlayer(
    @MessageBody()
    data: {
      pin: string;
      playerId: string;
    },

    @ConnectedSocket()
    client: Socket,
  ) {
    if (
      !this.isHost(
        data.pin,
        client.id,
      )
    ) {
      return {
        success: false,
        error: 'No autorizado.',
      };
    }

    const result =
      this.tournamentService.kickPlayer(
        data.pin,
        data.playerId,
      );

    if (!result.success) {
      return result;
    }

    /*
     * Avisamos directamente al jugador expulsado.
     */
    this.server
      .to(data.playerId)
      .emit('player:kicked', {
        message:
          'Has sido expulsado del torneo.',
      });

    /*
     * Lo sacamos de la sala Socket.IO.
     */
    const kickedSocket =
      this.server.sockets.sockets.get(
        data.playerId,
      );

    if (kickedSocket) {
      kickedSocket.leave(
        data.pin,
      );
    }

    this.emitLobbyUpdate(
      data.pin,
    );

    this.emitPlayerState(
      data.pin,
    );

    return {
      success: true,

      player: result.player,
    };
  }

  // =========================================================
  // SALIR VOLUNTARIAMENTE
  // =========================================================

  @SubscribeMessage('player:leave')
  handlePlayerLeave(
    @MessageBody()
    data: {
      pin?: string;
    },

    @ConnectedSocket()
    client: Socket,
  ) {
    const tournament =
      data?.pin
        ? this.tournamentService.getTournament(
            data.pin,
          )
        : this.tournamentService.findTournamentBySocket(
            client.id,
          );

    if (!tournament) {
      return {
        success: false,
        error:
          'No estás dentro de ningún torneo.',
      };
    }

    const pin =
      tournament.pin;

    const result =
      this.tournamentService.removePlayer(
        pin,
        client.id,
      );

    client.leave(pin);

    if (!result.success) {
      return result;
    }

    this.emitLobbyUpdate(pin);

    this.emitPlayerState(pin);

    return {
      success: true,
    };
  }

  // =========================================================
  // DESCONEXIÓN AUTOMÁTICA
  // =========================================================

  handleDisconnect(
    client: Socket,
  ) {
    const tournament =
      this.tournamentService.findTournamentBySocket(
        client.id,
      );

    if (!tournament) {
      return;
    }

    /*
     * Si era jugador, se elimina automáticamente.
     *
     * Si era el host, de momento no destruimos
     * el torneo: queda guardado.
     */
    if (
      tournament.hostSocketId ===
      client.id
    ) {
      return;
    }

    const pin =
      tournament.pin;

    const result =
      this.tournamentService.removePlayer(
        pin,
        client.id,
      );

    if (!result.success) {
      return;
    }

    this.emitLobbyUpdate(pin);

    this.emitPlayerState(pin);
  }

  // =========================================================
  // PEDIR ESTADO ACTUAL
  // =========================================================

  @SubscribeMessage(
    'tournament:getState',
  )
  handleGetState(
    @MessageBody()
    data: {
      pin: string;
    },

    @ConnectedSocket()
    client: Socket,
  ) {
    const snapshot =
      this.tournamentService.getSnapshot(
        data.pin,
      );

    if (!snapshot) {
      return {
        success: false,
        error:
          'Torneo no encontrado.',
      };
    }

    client.join(data.pin);

    /*
     * Estado general.
     */
    client.emit(
      'tournament:updated',
      snapshot,
    );

    /*
     * Estado específico del jugador.
     */
    const playerState =
      this.tournamentService.getPlayerHistory(
        data.pin,
        client.id,
      );

    if (playerState) {
      client.emit(
        'player:state',
        playerState,
      );
    }

    return {
      success: true,

      snapshot,

      playerState,
    };
  }
}