export type TournamentPhase =
  | 'LOBBY'
  | 'CLASIFICACION'
  | 'REPESCA'
  | 'ELIMINATORIA'
  | 'FINISHED';

export type MatchStage = 'clasificacion' | 'repesca' | 'eliminatoria';

export type PlayerZone = 'directo' | 'repesca' | 'fuera';

/** Jugador completo (solo vive en el servidor). */
export interface Player {
  /** Id público y estable (no cambia al reconectar). */
  id: string;
  /** Secreto que guarda el móvil para volver a entrar. Nunca sale en snapshots. */
  token: string;
  nickname: string;
  /** Socket actual (null si está desconectado). */
  socketId: string | null;
  connected: boolean;
  /** true si salió, fue expulsado o agotó el margen de desconexión. */
  left: boolean;
  /** Número aleatorio fijo, usado como último desempate. */
  seed: number;
}

/** Lo único que ven los demás clientes de un jugador. */
export interface PublicPlayer {
  id: string;
  nickname: string;
  connected: boolean;
  left: boolean;
}

export interface Match {
  id: string;
  stage: MatchStage;
  round: number;
  /** Posición del cruce dentro de la ronda de eliminatoria. */
  slot?: number;

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

/** Partido tal y como lo recibe la app: con los jugadores ya resueltos. */
export interface SnapshotMatch extends Match {
  player1: PublicPlayer | null;
  player2: PublicPlayer | null;
}

export interface Standing {
  position: number;
  player: PublicPlayer;

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

  /** Secreto del anfitrión, se guarda en su móvil. */
  hostToken: string;
  hostSocketId: string | null;
  hostConnected: boolean;

  status: TournamentPhase;

  players: Player[];

  games: string[];

  matches: Match[];

  bannedNicknames: string[];

  bannedPlayerIds: string[];

  sequence: number;

  bracketRound: number;

  /** Cuadro de la ronda de eliminatoria en curso (null = descanso/bye). */
  roundSlots: (string | null)[];

  /** Tabla congelada al cerrar la clasificación. */
  frozenStandings: Standing[] | null;

  champion: string | null;

  createdAt: number;
}

export interface TournamentSnapshot {
  pin: string;

  phase: TournamentPhase;

  plan: BracketPlan;

  players: PublicPlayer[];

  games: string[];

  matches: SnapshotMatch[];

  standings: Standing[];

  champion: PublicPlayer | null;
}

export interface HistoryEntry {
  matchId: string;
  stage: MatchStage;
  roundName?: string;
  opponent: PublicPlayer | null;
  game: string | null;
  myScore: number;
  opponentScore: number;
  result: 'win' | 'loss' | 'pending';
  forfeit: boolean;
}

export interface PlayerState {
  player: PublicPlayer;

  phase: TournamentPhase;

  currentMatch: SnapshotMatch | null;

  opponent: PublicPlayer | null;

  game: string | null;

  history: HistoryEntry[];

  zone: PlayerZone | null;
}