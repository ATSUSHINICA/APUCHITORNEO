import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import {
  existsSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';

import {
  BracketPlan,
  Match,
  MatchStage,
  Player,
  PlayerState,
  Standing,
  Tournament,
  TournamentPhase,
  TournamentSnapshot,
} from './tournament.interface';

const DEFAULT_GAMES = [
  'FIFA',
  'Minecraft',
  'Brawl Stars',
  'Clash Royale',
  'UNO',
  'Call of Duty',
  'Rayman',
  'Garfield Racing',
  'Rocket League',
  'Gang Beasts',
  'Dragon Ball Sparking Zero',
  'Asphalt Legends',
  'Brawlhalla',
  'Piedra Papel Tijeras',
  'Tres en Raya',
  'Pulso',
  'PvP Fortnite',
  'Jump Force',
  'Naruto Storm',
  'Kimetsu no Yaiba',
];

@Injectable()
export class TournamentService {
  private readonly filePath = join(process.cwd(), 'torneos.json');

  private tournaments: Record<string, Tournament> = {};

  constructor() {
    this.load();
  }

  // =========================================================
  // PERSISTENCIA
  // =========================================================

  private load(): void {
    try {
      if (!existsSync(this.filePath)) {
        this.tournaments = {};
        return;
      }

      const raw = readFileSync(this.filePath, 'utf8');

      this.tournaments = raw
        ? JSON.parse(raw)
        : {};
    } catch {
      this.tournaments = {};
    }
  }

  private save(): void {
    writeFileSync(
      this.filePath,
      JSON.stringify(this.tournaments, null, 2),
      'utf8',
    );
  }

  // =========================================================
  // HELPERS
  // =========================================================

  private generatePin(): string {
    let pin = '';

    do {
      pin = String(
        Math.floor(
          100000 + Math.random() * 900000,
        ),
      );
    } while (this.tournaments[pin]);

    return pin;
  }

  private generateId(): string {
    return randomBytes(6).toString('hex');
  }

  private shuffle<T>(array: T[]): T[] {
    const result = [...array];

    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(
        Math.random() * (i + 1),
      );

      [result[i], result[j]] = [
        result[j],
        result[i],
      ];
    }

    return result;
  }

  private getPlayer(
    tournament: Tournament,
    playerId: string,
  ): Player | undefined {
    return tournament.players.find(
      (player) => player.id === playerId,
    );
  }

  private getActivePlayers(
    tournament: Tournament,
  ): Player[] {
    return tournament.players.filter(
      (player) => !player.left,
    );
  }

  private getMatch(
    tournament: Tournament,
    matchId: string,
  ): Match | undefined {
    return tournament.matches.find(
      (match) => match.id === matchId,
    );
  }

  private getPlayerMatches(
    tournament: Tournament,
    playerId: string,
  ): Match[] {
    return tournament.matches.filter(
      (match) =>
        match.player1Id === playerId ||
        match.player2Id === playerId,
    );
  }

  // =========================================================
  // TORNEO
  // =========================================================

  createTournament(
    hostSocketId: string,
  ): Tournament {
    const pin = this.generatePin();

    const tournament: Tournament = {
      pin,

      hostSocketId,

      status: 'LOBBY',

      players: [],

      games: [...DEFAULT_GAMES],

      matches: [],

      bannedNicknames: [],

      bannedPlayerIds: [],

      sequence: 0,

      bracketRound: 0,

      champion: null,

      createdAt: Date.now(),
    };

    this.tournaments[pin] = tournament;

    this.save();

    return tournament;
  }

  getTournament(
    pin: string,
  ): Tournament | undefined {
    return this.tournaments[pin];
  }

  findTournamentBySocket(
    socketId: string,
  ): Tournament | undefined {
    return Object.values(this.tournaments).find(
      (tournament) =>
        tournament.hostSocketId === socketId ||
        tournament.players.some(
          (player) => player.id === socketId,
        ),
    );
  }

  // =========================================================
  // JUGADORES
  // =========================================================

  addPlayer(
    pin: string,
    data: {
      id: string;
      nickname: string;
    },
  ) {
    const tournament = this.getTournament(pin);

    if (!tournament) {
      return {
        success: false,
        error: 'Torneo no encontrado.',
      };
    }

    if (tournament.status !== 'LOBBY') {
      return {
        success: false,
        error: 'El torneo ya ha comenzado.',
      };
    }

    const nickname = data.nickname.trim();

    if (!nickname) {
      return {
        success: false,
        error: 'Debes introducir un apodo.',
      };
    }

    const normalized = nickname.toLowerCase();

    if (
      tournament.bannedNicknames.includes(
        normalized,
      )
    ) {
      return {
        success: false,
        error: 'Ese jugador ha sido expulsado del torneo.',
      };
    }

    const exists = tournament.players.some(
      (player) =>
        !player.left &&
        player.nickname.toLowerCase() === normalized,
    );

    if (exists) {
      return {
        success: false,
        error: 'Ese apodo ya está ocupado.',
      };
    }

    const player: Player = {
      id: data.id,
      nickname,
      left: false,
    };

    tournament.players.push(player);

    this.save();

    return {
      success: true,
      player,
    };
  }

  // =========================================================
  // JUEGOS
  // =========================================================

  addGame(
    pin: string,
    game: string,
  ) {
    const tournament = this.getTournament(pin);

    if (!tournament) {
      return {
        success: false,
        error: 'Torneo no encontrado.',
      };
    }

    const cleanGame = game?.trim();

    if (!cleanGame) {
      return {
        success: false,
        error: 'El nombre del juego está vacío.',
      };
    }

    const exists = tournament.games.some(
      (item) =>
        item.toLowerCase() ===
        cleanGame.toLowerCase(),
    );

    if (exists) {
      return {
        success: false,
        error: 'Ese juego ya existe.',
      };
    }

    tournament.games.push(cleanGame);

    this.save();

    return {
      success: true,
      games: tournament.games,
    };
  }

  removeGame(
    pin: string,
    game: string,
  ) {
    const tournament = this.getTournament(pin);

    if (!tournament) {
      return {
        success: false,
        error: 'Torneo no encontrado.',
      };
    }

    const index = tournament.games.findIndex(
      (item) => item === game,
    );

    if (index === -1) {
      return {
        success: false,
        error: 'Juego no encontrado.',
      };
    }

    tournament.games.splice(index, 1);

    this.save();

    return {
      success: true,
      games: tournament.games,
    };
  }

  spinGame(pin: string) {
    const tournament = this.getTournament(pin);

    if (!tournament) {
      return {
        success: false,
        error: 'Torneo no encontrado.',
      };
    }

    if (tournament.games.length === 0) {
      return {
        success: false,
        error: 'No hay juegos disponibles.',
      };
    }

    const game =
      tournament.games[
        Math.floor(
          Math.random() *
            tournament.games.length,
        )
      ];

    return {
      success: true,
      game,
    };
  }

  assignGame(
    pin: string,
    matchId: string,
    game: string,
  ) {
    const tournament = this.getTournament(pin);

    if (!tournament) {
      return {
        success: false,
        error: 'Torneo no encontrado.',
      };
    }

    const match = this.getMatch(
      tournament,
      matchId,
    );

    if (!match) {
      return {
        success: false,
        error: 'Partido no encontrado.',
      };
    }

    if (match.played) {
      return {
        success: false,
        error: 'El partido ya ha terminado.',
      };
    }

    if (!tournament.games.includes(game)) {
      return {
        success: false,
        error: 'Ese juego no está disponible.',
      };
    }

    match.game = game;

    this.save();

    return {
      success: true,
      match,
    };
  }

  // =========================================================
  // PLAN DE TORNEO
  // =========================================================

  getBracketPlan(
    n: number,
  ): BracketPlan {
    if (n < 2) {
      return {
        bracketSize: 0,
        direct: 0,
        repSlots: 0,
        repPlayers: 0,
        out: n,
        totalNeeded: 0,
      };
    }

    let bracketSize = 2;

    while (
      bracketSize * 2 <= n
    ) {
      bracketSize *= 2;
    }

    let direct = Math.ceil(
      bracketSize / 2,
    );

    let repSlots =
      bracketSize - direct;

    let repPlayers =
      repSlots * 2;

    let totalNeeded =
      direct + repPlayers;

    while (
      totalNeeded > n &&
      bracketSize > 2
    ) {
      bracketSize /= 2;

      direct = Math.ceil(
        bracketSize / 2,
      );

      repSlots =
        bracketSize - direct;

      repPlayers =
        repSlots * 2;

      totalNeeded =
        direct + repPlayers;
    }

    if (totalNeeded > n) {
      repSlots = 0;
      repPlayers = 0;

      direct = Math.min(
        bracketSize,
        n,
      );

      totalNeeded = direct;
    }

    const out = Math.max(
      0,
      n - totalNeeded,
    );

    return {
      bracketSize,
      direct,
      repSlots,
      repPlayers,
      out,
      totalNeeded,
    };
  }

  private roundName(
    size: number,
  ): string {
    if (size === 2) return 'GRAN FINAL';

    if (size === 4) return 'SEMIFINAL';

    if (size === 8) return 'CUARTOS DE FINAL';

    if (size === 16) return 'OCTAVOS DE FINAL';

    if (size === 32) {
      return 'DIECISEISAVOS DE FINAL';
    }

    return `RONDA DE ${size}`;
  }

  // =========================================================
  // CREAR PARTIDO
  // =========================================================

  private createMatch(
    tournament: Tournament,
    stage: MatchStage,
    round: number,
    player1Id: string,
    player2Id: string,
  ): Match {
    const match: Match = {
      id: `${tournament.pin}-${++tournament.sequence}`,

      stage,

      round,

      player1Id,

      player2Id,

      score1: 0,

      score2: 0,

      winnerId: null,

      game: null,

      played: false,

      forfeit: false,

      playedAt: null,

      roundName:
        stage === 'eliminatoria'
          ? this.roundName(
              this.getExpectedRoundSize(
                tournament,
                round,
              ),
            )
          : undefined,
    };

    tournament.matches.push(match);

    return match;
  }

  private getExpectedRoundSize(
    tournament: Tournament,
    round: number,
  ): number {
    const eliminationMatches =
      tournament.matches.filter(
        (match) =>
          match.stage === 'eliminatoria' &&
          match.round === round,
      );

    return eliminationMatches.length * 2;
  }

  // =========================================================
  // CLASIFICACIÓN
  // =========================================================

  generateClassification(
    tournament: Tournament,
  ): Match[] {
    tournament.matches = [];

    tournament.sequence = 0;

    tournament.bracketRound = 0;

    tournament.champion = null;

    tournament.status =
      'CLASIFICACION';

    const players =
      this.shuffle(
        this.getActivePlayers(tournament),
      );

    if (players.length < 2) {
      this.save();

      return [];
    }

    let list = [...players];

    if (list.length % 2 !== 0) {
      list.push(null as any);
    }

    const rounds: Match[][] = [];

    const totalRounds =
      Math.min(
        3,
        list.length - 1,
      );

    for (
      let round = 0;
      round < totalRounds;
      round++
    ) {
      const roundMatches: Match[] = [];

      for (
        let i = 0;
        i < list.length / 2;
        i++
      ) {
        const player1 =
          list[i];

        const player2 =
          list[
            list.length - 1 - i
          ];

        if (
          player1 &&
          player2
        ) {
          const match =
            this.createMatch(
              tournament,
              'clasificacion',
              round + 1,
              player1.id,
              player2.id,
            );

          roundMatches.push(match);
        }
      }

      rounds.push(roundMatches);

      const fixed = list[0];

      const rest = list.slice(1);

      rest.unshift(
        rest.pop()!,
      );

      list = [
        fixed,
        ...rest,
      ];
    }

    this.save();

    return rounds.flat();
  }

  // =========================================================
  // CLASIFICACIÓN / STANDINGS
  // =========================================================

  getStandings(
    tournament: Tournament,
  ): Standing[] {
    const players =
      this.getActivePlayers(
        tournament,
      );

    const plan =
      this.getBracketPlan(
        players.length,
      );

    const standings =
      players.map(
        (player, index) => {
          const matches =
            tournament.matches.filter(
              (match) =>
                match.stage ===
                  'clasificacion' &&
                match.played &&
                (
                  match.player1Id ===
                    player.id ||
                  match.player2Id ===
                    player.id
                ),
            );

          let wins = 0;
          let losses = 0;
          let scoreFor = 0;
          let scoreAgainst = 0;

          for (
            const match of matches
          ) {
            const isPlayer1 =
              match.player1Id ===
              player.id;

            const ownScore =
              isPlayer1
                ? match.score1
                : match.score2;

            const opponentScore =
              isPlayer1
                ? match.score2
                : match.score1;

            scoreFor += ownScore;

            scoreAgainst +=
              opponentScore;

            if (
              match.winnerId ===
              player.id
            ) {
              wins++;
            } else {
              losses++;
            }
          }

          return {
            position: 0,

            player,

            played:
              matches.length,

            wins,

            losses,

            scoreFor,

            scoreAgainst,

            roundDifference:
              scoreFor -
              scoreAgainst,

            zone: 'fuera' as const,

            originalIndex: index,
          };
        },
      );

    standings.sort(
      (a: any, b: any) => {
        if (b.wins !== a.wins) {
          return b.wins - a.wins;
        }

        if (
          b.roundDifference !==
          a.roundDifference
        ) {
          return (
            b.roundDifference -
            a.roundDifference
          );
        }

        if (
          b.scoreFor !==
          a.scoreFor
        ) {
          return (
            b.scoreFor -
            a.scoreFor
          );
        }

        return (
          a.originalIndex -
          b.originalIndex
        );
      },
    );

    standings.forEach(
      (standing: any, index) => {
        standing.position =
          index + 1;

        if (
          index < plan.direct
        ) {
          standing.zone =
            'directo';
        } else if (
          index <
          plan.direct +
            plan.repPlayers
        ) {
          standing.zone =
            'repesca';
        } else {
          standing.zone =
            'fuera';
        }

        delete standing.originalIndex;
      },
    );

    return standings;
  }

  // =========================================================
  // CERRAR CLASIFICACIÓN
  // =========================================================

  lockClassification(
    pin: string,
  ) {
    const tournament =
      this.getTournament(pin);

    if (!tournament) {
      return {
        success: false,
        error: 'Torneo no encontrado.',
      };
    }

    if (
      tournament.status !==
      'CLASIFICACION'
    ) {
      return {
        success: false,
        error:
          'La clasificación ya está cerrada.',
      };
    }

    const classificationMatches =
      tournament.matches.filter(
        (match) =>
          match.stage ===
          'clasificacion',
      );

    const unfinished =
      classificationMatches.some(
        (match) => !match.played,
      );

    if (unfinished) {
      return {
        success: false,
        error:
          'Todavía quedan partidos de clasificación sin resultado.',
      };
    }

    const standings =
      this.getStandings(
        tournament,
      );

    const plan =
      this.getBracketPlan(
        standings.length,
      );

    const direct =
      standings.slice(
        0,
        plan.direct,
      );

    const repechagePlayers =
      standings.slice(
        plan.direct,
        plan.direct +
          plan.repPlayers,
      );

    tournament.matches =
      tournament.matches.filter(
        (match) =>
          match.stage !==
          'repesca',
      );

    if (
      repechagePlayers.length === 0
    ) {
      tournament.status =
        'ELIMINATORIA';

      this.startEliminationRound(
        tournament,
        direct.map(
          (standing) =>
            standing.player.id,
        ),
      );
    } else {
      tournament.status =
        'REPESCA';

      for (
        let i = 0;
        i <
        repechagePlayers.length;
        i += 2
      ) {
        const player1 =
          repechagePlayers[i];

        const player2 =
          repechagePlayers[i + 1];

        if (
          !player1 ||
          !player2
        ) {
          continue;
        }

        this.createMatch(
          tournament,
          'repesca',
          1,
          player1.player.id,
          player2.player.id,
        );
      }
    }

    this.save();

    return {
      success: true,

      snapshot:
        this.getSnapshot(pin),
    };
  }

  // =========================================================
  // REPESCA
  // =========================================================

  private tryStartElimination(
    tournament: Tournament,
  ): void {
    const repechageMatches =
      tournament.matches.filter(
        (match) =>
          match.stage ===
          'repesca',
      );

    if (
      repechageMatches.length === 0
    ) {
      return;
    }

    if (
      repechageMatches.some(
        (match) =>
          !match.played,
      )
    ) {
      return;
    }

    const standings =
      this.getStandings(
        tournament,
      );

    const plan =
      this.getBracketPlan(
        standings.length,
      );

    const direct =
      standings
        .slice(
          0,
          plan.direct,
        )
        .map(
          (standing) =>
            standing.player.id,
        );

    const repechageWinners =
      repechageMatches
        .map(
          (match) =>
            match.winnerId,
        )
        .filter(
          (
            id,
          ): id is string =>
            !!id,
        );

    const order: string[] = [];

    for (
      let i = 0;
      i < direct.length;
      i++
    ) {
      order.push(
        direct[i],
      );

      const winner =
        repechageWinners[
          repechageWinners.length -
            1 -
            i
        ];

      if (winner) {
        order.push(winner);
      }
    }

    tournament.status =
      'ELIMINATORIA';

    this.startEliminationRound(
      tournament,
      order,
    );
  }

  // =========================================================
  // ELIMINATORIA
  // =========================================================

  private startEliminationRound(
    tournament: Tournament,
    playerIds: string[],
  ): void {
    if (playerIds.length < 2) {
      if (playerIds.length === 1) {
        tournament.champion =
          playerIds[0];

        tournament.status =
          'FINISHED';
      }

      return;
    }

    tournament.bracketRound++;

    const round =
      tournament.bracketRound;

    const bracketSize =
      playerIds.length;

    for (
      let i = 0;
      i <
      playerIds.length;
      i += 2
    ) {
      const player1 =
        playerIds[i];

      const player2 =
        playerIds[i + 1];

      if (
        !player1 ||
        !player2
      ) {
        continue;
      }

      const match =
        this.createMatch(
          tournament,
          'eliminatoria',
          round,
          player1,
          player2,
        );

      match.roundName =
        this.roundName(
          bracketSize,
        );
    }
  }

  private tryAdvanceElimination(
    tournament: Tournament,
  ): void {
    const currentRound =
      tournament.bracketRound;

    const matches =
      tournament.matches.filter(
        (match) =>
          match.stage ===
            'eliminatoria' &&
          match.round ===
            currentRound,
      );

    if (
      matches.length === 0
    ) {
      return;
    }

    if (
      matches.some(
        (match) =>
          !match.played,
      )
    ) {
      return;
    }

    const winners =
      matches
        .map(
          (match) =>
            match.winnerId,
        )
        .filter(
          (
            id,
          ): id is string =>
            !!id,
        );

    if (
      winners.length === 1
    ) {
      tournament.champion =
        winners[0];

      tournament.status =
        'FINISHED';

      this.save();

      return;
    }

    this.startEliminationRound(
      tournament,
      winners,
    );
  }

  // =========================================================
  // RESULTADOS
  // =========================================================

  setMatchResult(
    pin: string,
    matchId: string,
    score1: number,
    score2: number,
  ) {
    const tournament =
      this.getTournament(pin);

    if (!tournament) {
      return {
        success: false,
        error: 'Torneo no encontrado.',
      };
    }

    const match =
      this.getMatch(
        tournament,
        matchId,
      );

    if (!match) {
      return {
        success: false,
        error: 'Partido no encontrado.',
      };
    }

    if (match.played) {
      return {
        success: false,
        error:
          'Este partido ya ha terminado.',
      };
    }

    if (!match.game) {
      return {
        success: false,
        error:
          'Primero debes asignar un juego al partido.',
      };
    }

    if (
      !Number.isInteger(score1) ||
      !Number.isInteger(score2) ||
      score1 < 0 ||
      score2 < 0 ||
      score1 > 2 ||
      score2 > 2
    ) {
      return {
        success: false,
        error:
          'El marcador debe estar entre 0 y 2.',
      };
    }

    if (score1 === score2) {
      return {
        success: false,
        error:
          'No puede haber empate.',
      };
    }

    if (
      score1 !== 2 &&
      score2 !== 2
    ) {
      return {
        success: false,
        error:
          'Un jugador debe llegar a 2.',
      };
    }

    match.score1 =
      score1;

    match.score2 =
      score2;

    match.winnerId =
      score1 > score2
        ? match.player1Id
        : match.player2Id;

    match.played = true;

    match.forfeit = false;

    match.playedAt =
      Date.now();

    if (
      match.stage ===
      'repesca'
    ) {
      this.tryStartElimination(
        tournament,
      );
    }

    if (
      match.stage ===
      'eliminatoria'
    ) {
      this.tryAdvanceElimination(
        tournament,
      );
    }

    this.save();

    return {
      success: true,

      isFinished:
        tournament.status ===
        'FINISHED',

      snapshot:
        this.getSnapshot(pin),
    };
  }

  // =========================================================
  // EXPULSAR / SALIR
  // =========================================================

  removePlayer(
    pin: string,
    playerId: string,
  ) {
    const tournament =
      this.getTournament(pin);

    if (!tournament) {
      return {
        success: false,
        error: 'Torneo no encontrado.',
      };
    }

    const player =
      this.getPlayer(
        tournament,
        playerId,
      );

    if (!player) {
      return {
        success: false,
        error:
          'Jugador no encontrado.',
      };
    }

    if (
      tournament.status ===
      'LOBBY'
    ) {
      tournament.players =
        tournament.players.filter(
          (item) =>
            item.id !== playerId,
        );
    } else {
      player.left = true;

      this.resolveForfeitMatches(
        tournament,
        playerId,
      );
    }

    this.save();

    return {
      success: true,
      player,
    };
  }

  kickPlayer(
    pin: string,
    playerId: string,
  ) {
    const tournament =
      this.getTournament(pin);

    if (!tournament) {
      return {
        success: false,
        error: 'Torneo no encontrado.',
      };
    }

    const player =
      this.getPlayer(
        tournament,
        playerId,
      );

    if (!player) {
      return {
        success: false,
        error:
          'Jugador no encontrado.',
      };
    }

    tournament.bannedPlayerIds.push(
      player.id,
    );

    const nickname =
      player.nickname.toLowerCase();

    if (
      !tournament.bannedNicknames.includes(
        nickname,
      )
    ) {
      tournament.bannedNicknames.push(
        nickname,
      );
    }

    return this.removePlayer(
      pin,
      playerId,
    );
  }

  private resolveForfeitMatches(
    tournament: Tournament,
    playerId: string,
  ): void {
    const pending =
      tournament.matches.filter(
        (match) =>
          !match.played &&
          (
            match.player1Id ===
              playerId ||
            match.player2Id ===
              playerId
          ),
      );

    for (
      const match of pending
    ) {
      const winnerId =
        match.player1Id ===
        playerId
          ? match.player2Id
          : match.player1Id;

      const winner =
        this.getPlayer(
          tournament,
          winnerId,
        );

      if (
        !winner ||
        winner.left
      ) {
        continue;
      }

      match.winnerId =
        winnerId;

      if (
        match.player1Id ===
        winnerId
      ) {
        match.score1 = 2;
        match.score2 = 0;
      } else {
        match.score1 = 0;
        match.score2 = 2;
      }

      match.played = true;

      match.forfeit = true;

      match.playedAt =
        Date.now();

      if (!match.game) {
        match.game =
          tournament.games[0] ??
          null;
      }
    }

    const hasRepesca =
      tournament.matches.some(
        (match) =>
          match.stage ===
          'repesca',
      );

    const hasEliminatoria =
      tournament.matches.some(
        (match) =>
          match.stage ===
          'eliminatoria',
      );

    if (
      tournament.status ===
      'REPESCA' &&
      hasRepesca
    ) {
      this.tryStartElimination(
        tournament,
      );
    }

    if (
      tournament.status ===
      'ELIMINATORIA' &&
      hasEliminatoria
    ) {
      this.tryAdvanceElimination(
        tournament,
      );
    }
  }

  // =========================================================
  // SNAPSHOT
  // =========================================================

  getSnapshot(
    pin: string,
  ): TournamentSnapshot | null {
    const tournament =
      this.getTournament(pin);

    if (!tournament) {
      return null;
    }

    const players =
      this.getActivePlayers(
        tournament,
      );

    const standings =
      this.getStandings(
        tournament,
      );

    const plan =
      this.getBracketPlan(
        players.length,
      );

    const champion =
      tournament.champion
        ? this.getPlayer(
            tournament,
            tournament.champion,
          ) ?? null
        : null;

    return {
      pin:

        tournament.pin,

      phase:
        tournament.status,

      plan,

      players,

      games:
        tournament.games,

      matches:
        tournament.matches,

      standings,

      champion,
    };
  }

  // =========================================================
  // ESTADO INDIVIDUAL
  // =========================================================

  getPlayerHistory(
    pin: string,
    playerId: string,
  ): PlayerState | null {
    const tournament =
      this.getTournament(pin);

    if (!tournament) {
      return null;
    }

    const player =
      this.getPlayer(
        tournament,
        playerId,
      );

    if (!player) {
      return null;
    }

    const history =
      this.getPlayerMatches(
        tournament,
        playerId,
      );

    const currentMatch =
      history.find(
        (match) =>
          !match.played &&
          (
            match.player1Id ===
              playerId ||
            match.player2Id ===
              playerId
          ),
      ) ?? null;

    let opponent: Player | null =
      null;

    if (currentMatch) {
      const opponentId =
        currentMatch.player1Id ===
        playerId
          ? currentMatch.player2Id
          : currentMatch.player1Id;

      opponent =
        this.getPlayer(
          tournament,
          opponentId,
        ) ?? null;
    }

    const standings =
      this.getStandings(
        tournament,
      );

    const standing =
      standings.find(
        (item) =>
          item.player.id ===
          playerId,
      );

    return {
      player,

      phase:
        tournament.status,

      currentMatch,

      opponent,

      game:
        currentMatch?.game ??
        null,

      history,

      zone:
        standing?.zone ??
        null,
    };
  }
}