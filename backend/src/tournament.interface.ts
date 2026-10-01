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

export interface Player {
  id: string;
  nickname: string;
  left?: boolean;
}

export interface Match {
  id: string;

  stage: MatchStage;

  /**
   * Jornada en clasificación.
   * Ronda de eliminación en eliminatorias.
   */
  round: number;

  label: string;

  player1: Player | null;
  player2: Player | null;

  score1: number | null;
  score2: number | null;

  winner: Player | null;

  /**
   * Juego asignado aleatoriamente.
   */
  game: string | null;

  /**
   * Indica si el partido terminó por abandono.
   */
  forfeit?: boolean;

  /**
   * Momento en el que se registró el resultado.
   */
  playedAt?: number;
}

export interface Standing {
  player: Player;

  played: number;
  wins: number;
  diff: number;

  zone: 'directo' | 'repesca' | 'fuera';

  left: boolean;
}

export interface BracketPlan {
  bracketSize: number;

  /**
   * Jugadores que pasan directamente.
   */
  direct: number;

  /**
   * Número de partidos de repesca.
   */
  repSlots: number;

  /**
   * Número de jugadores que participan en repesca.
   */
  repPlayers: number;

  /**
   * Jugadores eliminados directamente.
   */
  out: number;
}

export interface TournamentSnapshot {
  pin: string;

  phase: TournamentPhase;

  plan: BracketPlan;

  champion: Player | null;

  players: Player[];

  games: string[];

  matches: Match[];

  standings: Standing[];
}

export interface Tournament {
  pin: string;

  hostSocketId: string;

  status: TournamentPhase;

  players: Player[];

  games: string[];

  matches: Match[];

  /**
   * Jugadores que han sido expulsados.
   * Guardamos nickname e id para impedir que vuelvan.
   */
  bannedNicknames: string[];

  bannedPlayerIds: string[];

  sequence: number;

  bracketRound: number;

  champion: Player | null;

  createdAt: number;
}