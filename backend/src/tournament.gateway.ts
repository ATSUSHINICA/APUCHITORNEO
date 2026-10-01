import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';

import { Server, Socket } from 'socket.io';

import { TournamentService } from './tournament.service';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class TournamentGateway {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly tournamentService: TournamentService,
  ) {}

  // ─────────────────────────────────────────────
  // CREAR TORNEO
  // ─────────────────────────────────────────────

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
      pin: tournament.pin,
    };
  }

  // ─────────────────────────────────────────────
  // UNIR JUGADOR
  // ─────────────────────────────────────────────

  @SubscribeMessage('player:join')
  handleJoinTournament(
    @MessageBody()
    data: {
      pin: string;
      nickname: string;
    },

    @ConnectedSocket() client: Socket,
  ) {
    const pin = data.pin.trim();
    const nickname = data.nickname.trim();

    const tournament =
      this.tournamentService.getTournament(
        pin,
      );

    if (!tournament) {
      return {
        error:
          'No existe ningún torneo con ese PIN.',
      };
    }

    if (tournament.status !== 'LOBBY') {
      return {
        error:
          'El torneo ya ha comenzado.',
      };
    }

    if (!nickname) {
      return {
        error:
          'Escribe un apodo.',
      };
    }

    const success =
      this.tournamentService.addPlayer(
        pin,
        {
          id: client.id,
          nickname,
        },
      );

    if (!success) {
      return {
        error:
          'Ese apodo ya está en uso en este torneo.',
      };
    }

    client.join(pin);

    const updatedTournament =
      this.tournamentService.getTournament(
        pin,
      );

    if (!updatedTournament) {
      return {
        error:
          'Torneo no encontrado.',
      };
    }

    // Actualizar lobby
    this.server
      .to(pin)
      .emit(
        'lobby:update',
        updatedTournament.players,
      );

    return {
      success: true,
      playerId: client.id,
    };
  }

  // ─────────────────────────────────────────────
  // INICIAR TORNEO
  // ─────────────────────────────────────────────

  @SubscribeMessage('host:start')
  handleStartTournament(
    @MessageBody()
    data: {
      pin: string;
    },

    @ConnectedSocket() client: Socket,
  ) {
    const tournament =
      this.tournamentService.getTournament(
        data.pin,
      );

    if (!tournament) {
      return {
        error:
          'Torneo no encontrado.',
      };
    }

    if (
      tournament.hostSocketId !==
      client.id
    ) {
      return {
        error:
          'No autorizado.',
      };
    }

    if (
      tournament.players.length < 2
    ) {
      return {
        error:
          'Hacen falta al menos 2 jugadores.',
      };
    }

    const started =
      this.tournamentService.startTournament(
        data.pin,
      );

    if (!started) {
      return {
        error:
          'No se pudo iniciar el torneo.',
      };
    }

    const snapshot =
      this.tournamentService.getSnapshot(
        started,
      );

    this.server
      .to(data.pin)
      .emit(
        'tournament:started',
        snapshot,
      );

    // También enviamos bracket:update
    // para mantener compatibilidad con tu App.tsx.
    this.server
      .to(data.pin)
      .emit(
        'bracket:update',
        snapshot,
      );

    return {
      success: true,
    };
  }

  // ─────────────────────────────────────────────
  // RESULTADO
  // ─────────────────────────────────────────────

  @SubscribeMessage('host:setResult')
  handleSetResult(
    @MessageBody()
    data: {
      pin: string;
      matchId: string;
      score1: number;
      score2: number;
    },

    @ConnectedSocket() client: Socket,
  ) {
    const tournament =
      this.tournamentService.getTournament(
        data.pin,
      );

    if (!tournament) {
      return {
        error:
          'Torneo no encontrado.',
      };
    }

    if (
      tournament.hostSocketId !==
      client.id
    ) {
      return {
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

    if (!result) {
      return {
        error:
          'No se pudo actualizar el partido. Comprueba el marcador.',
      };
    }

    const snapshot =
      this.tournamentService.getSnapshot(
        result.tournament,
      );

    // Actualización del cuadro
    this.server
      .to(data.pin)
      .emit(
        'bracket:update',
        snapshot,
      );

    // Compatibilidad con tu App actual
    this.server
      .to(data.pin)
      .emit(
        'tournament:updated',
        snapshot,
      );

    // Si ha terminado
    if (result.isFinished) {
      this.server
        .to(data.pin)
        .emit(
          'tournament:end',
          {
            winner:
              result.tournament.champion,
          },
        );
    }

    return {
      success: true,
    };
  }

  // ─────────────────────────────────────────────
  // SALIR DEL TORNEO
  // ─────────────────────────────────────────────

  @SubscribeMessage('player:leave')
  handlePlayerLeave(
    @ConnectedSocket() client: Socket,
  ) {
    for (
      const [
        pin,
        tournament,
      ] of this.getAllTournaments()
    ) {
      if (
        tournament.status === 'LOBBY'
      ) {
      const player = tournament.players.find(
        (p: { id: string }) => p.id === client.id,
      );

        if (player) {
          this.tournamentService.removePlayer(
            pin,
            client.id,
          );

          this.server
            .to(pin)
            .emit(
              'lobby:update',
              tournament.players,
            );

          client.leave(pin);

          return {
            success: true,
          };
        }
      }
    }

    return {
      success: true,
    };
  }

  // ─────────────────────────────────────────────
  // DESCONEXIÓN
  // ─────────────────────────────────────────────

  handleDisconnect(
    client: Socket,
  ) {
    for (
      const [
        pin,
        tournament,
      ] of this.getAllTournaments()
    ) {
      const player = tournament.players.find(
        (p: { id: string }) => p.id === client.id,
      );

      if (
        player &&
        tournament.status === 'LOBBY'
      ) {
        this.tournamentService.removePlayer(
          pin,
          client.id,
        );

        this.server
          .to(pin)
          .emit(
            'lobby:update',
            tournament.players,
          );
      }
    }
  }

  // Acceso al Map privado del service.
  // Para evitarlo, de momento mantenemos
  // la gestión de desconexión principalmente
  // desde player:leave.
  private getAllTournaments(): Map<
    string,
    any
  > {
    return (
      this.tournamentService as any
    ).tournaments;
  }
}