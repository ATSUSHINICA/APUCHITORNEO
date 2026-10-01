import { Injectable } from '@nestjs/common';
import { Tournament, Player, Match } from './tournament.interface';

@Injectable()
export class TournamentService {
  private tournaments = new Map<string, Tournament>();

  generatePin(): string {
    let pin: string;
    do {
      pin = Math.floor(100000 + Math.random() * 900000).toString();
    } while (this.tournaments.has(pin));
    return pin;
  }

  createTournament(hostSocketId: string): Tournament {
    const pin = this.generatePin();
    const tournament: Tournament = {
      pin,
      hostSocketId,
      status: 'LOBBY',
      players: [],
      matches: [],
    };
    this.tournaments.set(pin, tournament);
    return tournament;
  }

  getTournament(pin: string): Tournament | undefined {
    return this.tournaments.get(pin);
  }

  addPlayer(pin: string, player: Player): boolean {
    const tournament = this.tournaments.get(pin);
    if (!tournament || tournament.status !== 'LOBBY') return false;
    tournament.players.push(player);
    return true;
  }

  generateBracket(players: Player[]): Match[] {
    const matches: Match[] = [];
    const shuffled = [...players].sort(() => Math.random() - 0.5);

    let matchIndex = 1;
    for (let i = 0; i < shuffled.length; i += 2) {
      const p1 = shuffled[i];
      const p2 = shuffled[i + 1] || null;

      matches.push({
        id: `m_1_${matchIndex}`,
        round: 1,
        player1: p1,
        player2: p2,
        winner: p2 === null ? p1 : null,
      });
      matchIndex++;
    }
    return matches;
  }

  // Registra el ganador de un partido y lo avanza si existe un siguiente encuentro
setMatchResult(
  pin: string,
  matchId: string,
  winnerId: string,
  score1: number,
  score2: number,
): { tournament: Tournament; isFinished: boolean } | null {
  const tournament = this.tournaments.get(pin);
  if (!tournament) return null;

  const match = tournament.matches.find((m) => m.id === matchId);
  if (!match) return null;

  const winner = tournament.players.find((p) => p.id === winnerId);
  if (!winner) return null;

  // Registrar resultado
  match.winner = winner;
  match.score1 = score1;
  match.score2 = score2;

  // Si tiene un partido posterior asignado, promover al ganador
  if (match.nextMatchId) {
    const nextMatch = tournament.matches.find((m) => m.id === match.nextMatchId);
    if (nextMatch) {
      if (!nextMatch.player1) {
        nextMatch.player1 = winner;
      } else if (!nextMatch.player2) {
        nextMatch.player2 = winner;
      }
    }
  }

  // Comprobar si la final ha terminado
  const pendingMatches = tournament.matches.filter((m) => !m.winner);
  const isFinished = pendingMatches.length === 0;

  if (isFinished) {
    tournament.status = 'FINISHED';
  }

  return { tournament, isFinished };
}
}