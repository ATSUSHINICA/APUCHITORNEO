import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { TournamentService } from './tournament.service';

@WebSocketGateway({ cors: { origin: '*' } })
export class TournamentGateway {
  @WebSocketServer()
  server: Server;

  constructor(private readonly tournamentService: TournamentService) {}

  // 1. Crear torneo (Anfitrión)
  @SubscribeMessage('host:create')
  handleCreateTournament(@ConnectedSocket() client: Socket) {
    const tournament = this.tournamentService.createTournament(client.id);
    client.join(tournament.pin);
    return { pin: tournament.pin };
  }

  // 2. Unirse a la sala (Jugadores)
  @SubscribeMessage('player:join')
  handleJoinTournament(
    @MessageBody() data: { pin: string; nickname: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { pin, nickname } = data;
    const success = this.tournamentService.addPlayer(pin, {
      id: client.id,
      nickname,
    });

    if (!success) {
      return { error: 'No se pudo unirse al torneo' };
    }

    client.join(pin);
    const tournament = this.tournamentService.getTournament(pin);

    if (!tournament) {
    return { error: 'Torneo no encontrado' };
    }

    // Notificar a toda la sala de la lista actualizada
    this.server.to(pin).emit('lobby:update', tournament.players);

    return { success: true };
  }

  // 3. Iniciar Torneo (Anfitrión)
  @SubscribeMessage('host:start')
  handleStartTournament(
    @MessageBody() data: { pin: string },
    @ConnectedSocket() client: Socket,
  ) {
    const tournament = this.tournamentService.getTournament(data.pin);

    if (!tournament || tournament.hostSocketId !== client.id) {
      return { error: 'No autorizado' };
    }

    tournament.status = 'IN_PROGRESS';
    tournament.matches = this.tournamentService.generateBracket(tournament.players);

    // Enviar el cuadro inicial a todos los jugadores
    this.server.to(data.pin).emit('tournament:started', {
      matches: tournament.matches,
    });
  }


  @SubscribeMessage('host:setResult')
handleSetResult(
  @MessageBody()
  data: {
    pin: string;
    matchId: string;
    winnerId: string;
    score1: number;
    score2: number;
  },
  @ConnectedSocket() client: Socket,
) {
  const tournament = this.tournamentService.getTournament(data.pin);

  if (!tournament || tournament.hostSocketId !== client.id) {
    return { error: 'No autorizado' };
  }

  const result = this.tournamentService.setMatchResult(
    data.pin,
    data.matchId,
    data.winnerId,
    data.score1,
    data.score2,
  );

  if (!result) {
    return { error: 'No se pudo actualizar el partido' };
  }

  // Avisar a todos los móviles de la actualización del cuadro
  this.server.to(data.pin).emit('tournament:updated', {
    matches: result.tournament.matches,
    status: result.tournament.status,
  });

  return { success: true };
}
}