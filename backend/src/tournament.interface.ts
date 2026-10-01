export type TournamentPhase =
  | 'LOBBY'
  | 'CLASIFICACION'
  | 'REPESCA'
  | 'ELIMINATORIA'
  | 'FINISHED';

export type MatchStage =
  | 'clasificacion'
  | 'repesca'
  | 'eliminatoria';

export type PlayerZone =
  | 'directo'
  | 'repesca'
  | 'fuera';

export interface Player {
  id: string;
  nickname: string;
  left: boolean;
}

export interface Match {
  id: string;
  stage: MatchStage;
  round: number;

  player1Id: string;
  player2Id: string;

  score1: number;
  score2: number;

  winnerId: string | null;

  game: string | null;

  played: boolean;
  forfeit: boolean;
  playedAt: number | null;

  roundName?: string;
}

export interface Standing {
  position: number;
  player: Player;

  played: number;
  wins: number;
  losses: number;

  scoreFor: number;
  scoreAgainst: number;
  roundDifference: number;

  zone: PlayerZone;
}

export interface BracketPlan {
  bracketSize: number;

  direct: number;

  repSlots: number;

  repPlayers: number;

  out: number;

  totalNeeded: number;
}

export interface Tournament {
  pin: string;

  hostSocketId: string;

  status: TournamentPhase;

  players: Player[];

  games: string[];

  matches: Match[];

  bannedNicknames: string[];

  bannedPlayerIds: string[];

  sequence: number;

  bracketRound: number;

  champion: string | null;

  createdAt: number;
}

export interface TournamentSnapshot {
  pin: string;

  phase: TournamentPhase;

  plan: BracketPlan;

  players: Player[];

  games: string[];

  matches: Match[];

  standings: Standing[];

  champion: Player | null;
}

export interface PlayerState {
  player: Player;

  phase: TournamentPhase;

  currentMatch: Match | null;

  opponent: Player | null;

  game: string | null;

  history: Match[];

  zone: PlayerZone | null;
}