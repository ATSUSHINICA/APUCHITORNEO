export interface Player {
  id: string;
  nickname: string;
}

export type TournamentStatus =
  | 'LOBBY'
  | 'CLASSIFICATION'
  | 'REPESCA'
  | 'IN_PROGRESS'
  | 'FINISHED';

export type MatchStage =
  | 'clasificacion'
  | 'repesca'
  | 'eliminatoria';

export interface Match {
  id: string;

  stage: MatchStage;
  round: number;
  label: string;

  player1: Player | null;
  player2: Player | null;

  score1: number | null;
  score2: number | null;

  winner: Player | null;

  game?: string;

  forfeit?: boolean;
  playedAt?: number;
}

export interface Tournament {
  pin: string;
  hostSocketId: string;

  status: TournamentStatus;

  players: Player[];
  matches: Match[];

  games: string[];

  sequence: number;
  bracketRound: number;

  direct: string[];

  champion: Player | null;
}