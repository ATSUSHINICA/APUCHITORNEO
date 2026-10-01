export interface Player {
  id: string;
  nickname: string;
}

export interface Match {
  id: string;
  round: number;
  player1: Player | null;
  player2: Player | null;
  winner: Player | null;
  score1?: number;
  score2?: number;
  nextMatchId?: string;
}

export interface Tournament {
  pin: string;
  hostSocketId: string;
  status: 'LOBBY' | 'IN_PROGRESS' | 'FINISHED';
  players: Player[];
  matches: Match[];
}