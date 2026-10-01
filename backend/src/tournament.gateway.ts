import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  OnGatewayDisconnect,
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
  // BROADCASTS
  // =========================================================

  private emitTournamentUpdate(
    pin: string,
  ): void {
    const snapshot =
      this.tournamentService.getSnapshot(
        pin,
      );

    if (!snapshot) return;

    this.server
      .to(pin)
      .emit(
        'tournament:updated',
        snapshot,
      );

    this.server
      .to(pin)
      .emit(
        'bracket:update',
        snapshot,
      );

    if (
      snapshot.phase ===
      'FINISHED'
    ) {
      this.server
        .to(pin)
        .emit(
          'tournament:end',
          {
            champion:
              snapshot.champion,
            snapshot,
          },
        );
    }
  }

  private emitLobbyUpdate(
    pin: string,
  ): void {
    const tournament =
      this.tournamentService.getTournament(
        pin,
      );

    if (!tournament) return;

    this.server
      .to(pin)
      .emit(
        'lobby:update',
        tournament.players.filter(
          (player) =>
            !player.left,
        ),
      );

    this.emitTournamentUpdate(
      pin,
    );
  }

  private emitGamesUpdate(
    pin: string,
  ): void {
    const tournament =
      this.tournamentService.getTournament(
        pin,
      );

    if (!tournament) return;

    this.server
      .to(pin)
      .emit(
        'games:update',
        {
          games:
            tournament.games,
        },
      );
  }

  private emitPlayerState(
    pin: string,
  ): void {
    const tournament =
      this.tournamentService.getTournament(
        pin,
      );

    if (!tournament) return;

    for (
      const player of tournament.players
    ) {
      if (player.left) continue;

      const state =
        this.tournamentService.getPlayerHistory(
          pin,
          player.id,
        );

      this.server
        .to(player.id)
        .emit(
          'player:state',
          state,
        );
    }
  }

  private isHost(
    pin: string,
    socketId: string,
  ): boolean {
    const tournament =
      this.tournamentService.getTournament(
        pin,
      );

    return !!(
      tournament &&
      tournament.hostSocketId ===
        socketId
    );
  }

  // =========================================================
  // CREAR
  // =========================================================

  @SubscribeMessage('host:create')
  handleCreateTournament(
    @ConnectedSocket()
    client: Socket,
  ) {
    const tournament =
      this.tournamentService.createTournament(
        client.id,
      );

    client.join(
      tournament.pin,
    );

    return {
      success: true,

      pin:
        tournament.pin,

      games:
        tournament.games,

      phase:
        tournament.status,
    };
  }

  // =========================================================
  // UNIRSE
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
    if (
      !data?.pin ||
      !data?.nickname
    ) {
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
          nickname:
            data.nickname,
        },
      );

    if (!result.success) {
      return result;
    }

    client.join(
      data.pin,
    );

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

    this.emitLobbyUpdate(
      data.pin,
    );

    this.emitPlayerState(
      data.pin,
    );

    return {
      success: true,

      pin:
        data.pin,

      player:
        result.player,

      playerId:
        client.id,

      players:
        tournament.players.filter(
          (player) =>
            !player.left,
        ),

      games:
        tournament.games,

      phase:
        tournament.status,
    };
  }

  // =========================================================
  // START
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
        error:
          'No autorizado.',
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

    const activePlayers =
      tournament.players.filter(
        (player) =>
          !player.left,
      );

    if (
      activePlayers.length < 2
    ) {
      return {
        success: false,
        error:
          'Se necesitan al menos 2 jugadores.',
      };
    }

    if (
      tournament.status !==
      'LOBBY'
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

    this.server
      .to(data.pin)
      .emit(
        'tournament:started',
        {
          matches,
          snapshot,
        },
      );

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
        error:
          'No autorizado.',
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
  // RESULTADO
  // =========================================================

  @SubscribeMessage(
    'host:setResult',
  )
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
        error:
          'No autorizado.',
      };
    }

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

    this.emitTournamentUpdate(
      data.pin,
    );

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
  // JUEGOS
  // =========================================================

  @SubscribeMessage(
    'host:addGame',
  )
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
        error:
          'No autorizado.',
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

    this.emitGamesUpdate(
      data.pin,
    );

    this.emitTournamentUpdate(
      data.pin,
    );

    return result;
  }

  @SubscribeMessage(
    'host:removeGame',
  )
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
        error:
          'No autorizado.',
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

    this.emitGamesUpdate(
      data.pin,
    );

    this.emitTournamentUpdate(
      data.pin,
    );

    return result;
  }

  @SubscribeMessage(
    'host:spinGame',
  )
  handleSpinGame(
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
        error:
          'No autorizado.',
      };
    }

    return this.tournamentService.spinGame(
      data.pin,
    );
  }

  @SubscribeMessage(
    'host:assignGame',
  )
  handleAssignGame(
    @MessageBody()
    data: {
      pin: string;
      matchId: string;
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
        error:
          'No autorizado.',
      };
    }

    const result =
      this.tournamentService.assignGame(
        data.pin,
        data.matchId,
        data.game,
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

    return result;
  }

  // =========================================================
  // EXPULSAR JUGADOR
  // =========================================================

  @SubscribeMessage(
    'host:kick',
  )
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
        error:
          'No autorizado.',
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

    this.server
      .to(data.playerId)
      .emit(
        'player:kicked',
        {
          message:
            'Has sido expulsado del torneo.',
        },
      );

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

    this.emitTournamentUpdate(
      data.pin,
    );

    this.emitPlayerState(
      data.pin,
    );

    return {
      success: true,

      player:
        result.player,
    };
  }

  // =========================================================
  // SALIR
  // =========================================================

  @SubscribeMessage(
    'player:leave',
  )
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

    if (
      tournament.hostSocketId ===
      client.id
    ) {
      return {
        success: false,
        error:
          'El anfitrión no puede abandonar el torneo desde aquí.',
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

    this.emitLobbyUpdate(
      pin,
    );

    this.emitTournamentUpdate(
      pin,
    );

    this.emitPlayerState(
      pin,
    );

    return {
      success: true,
    };
  }

  // =========================================================
  // DESCONECTAR
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

    // El host NO se elimina automáticamente.
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

    this.emitLobbyUpdate(
      pin,
    );

    this.emitTournamentUpdate(
      pin,
    );

    this.emitPlayerState(
      pin,
    );
  }

  // =========================================================
  // RECUPERAR ESTADO
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

    client.join(
      data.pin,
    );

    client.emit(
      'tournament:updated',
      snapshot,
    );

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