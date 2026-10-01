import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { existsSync, readFileSync, writeFile } from 'fs';
import { join } from 'path';

import {
  BracketPlan,
  Match,
  Player,
  Standing,
  Tournament,
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
  private tournaments = new Map<string, Tournament>();

  private readonly dbFile = join(process.cwd(), 'torneos.json');

  constructor() {
    this.load();
  }

  // =========================================================
  // PERSISTENCIA
  // =========================================================

  private load(): void {
    try {
      if (!existsSync(this.dbFile)) {
        return;
      }

      const data = readFileSync(this.dbFile, 'utf8');

      if (!data.trim()) {
        return;
      }

      const tournaments = JSON.parse(data);

      for (const [pin, tournament] of Object.entries(
        tournaments as Record<string, Tournament>,
      )) {
        this.tournaments.set(pin, tournament);
      }
    } catch (error) {
      console.error('No se pudieron cargar los torneos:', error);
    }
  }

  private save(): void {
    const data = Object.fromEntries(this.tournaments);

    writeFile(
      this.dbFile,
      JSON.stringify(data, null, 2),
      (error) => {
        if (error) {
          console.error('No se pudieron guardar los torneos:', error);
        }
      },
    );
  }

  // =========================================================
  // HELPERS
  // =========================================================

  private generateId(): string {
    return randomBytes(4).toString('hex');
  }

  private shuffle<T>(array: T[]): T[] {
    const result = [...array];

    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));

      [result[i], result[j]] = [result[j], result[i]];
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

  private pickGame(tournament: Tournament): string | null {
    if (tournament.games.length === 0) {
      return null;
    }

    const index = Math.floor(
      Math.random() * tournament.games.length,
    );

    return tournament.games[index];
  }

  private roundName(size: number): string {
    switch (size) {
      case 2:
        return 'Final';

      case 4:
        return 'Semifinal';

      case 8:
        return 'Cuartos';

      case 16:
        return 'Octavos';

      case 32:
        return 'Dieciseisavos';

      default:
        return `Ronda de ${size}`;
    }
  }

  // =========================================================
  // PIN
  // =========================================================

  generatePin(): string {
    let pin: string;

    do {
      pin = Math.floor(
        100000 + Math.random() * 900000,
      ).toString();
    } while (this.tournaments.has(pin));

    return pin;
  }

  // =========================================================
  // CREAR TORNEO
  // =========================================================

  createTournament(hostSocketId: string): Tournament {
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

    this.tournaments.set(pin, tournament);

    this.save();

    return tournament;
  }

  // =========================================================
  // BUSCAR TORNEO
  // =========================================================

  getTournament(pin: string): Tournament | undefined {
    return this.tournaments.get(pin);
  }

  findTournamentBySocket(
    socketId: string,
  ): Tournament | undefined {
    for (const tournament of this.tournaments.values()) {
      if (tournament.hostSocketId === socketId) {
        return tournament;
      }

      const player = tournament.players.find(
        (p) => p.id === socketId,
      );

      if (player) {
        return tournament;
      }
    }

    return undefined;
  }

  // =========================================================
  // JUGADORES
  // =========================================================

  addPlayer(
    pin: string,
    player: Player,
  ): {
    success: boolean;
    error?: string;
  } {
    const tournament = this.tournaments.get(pin);

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

    const nickname = player.nickname.trim();

    if (!nickname) {
      return {
        success: false,
        error: 'El apodo no puede estar vacío.',
      };
    }

    // No permitir volver a entrar a alguien expulsado.
    if (
      tournament.bannedNicknames.includes(
        nickname.toLowerCase(),
      )
    ) {
      return {
        success: false,
        error: 'Este jugador ha sido expulsado del torneo.',
      };
    }

    // Evitar dos jugadores con el mismo nickname.
    const duplicate = tournament.players.some(
      (existing) =>
        existing.nickname.toLowerCase() ===
        nickname.toLowerCase(),
    );

    if (duplicate) {
      return {
        success: false,
        error: 'Ese apodo ya está en uso.',
      };
    }

    tournament.players.push({
      id: player.id,
      nickname,
      left: false,
    });

    this.save();

    return {
      success: true,
    };
  }

  removePlayerFromLobby(
    pin: string,
    playerId: string,
  ): boolean {
    const tournament = this.tournaments.get(pin);

    if (!tournament) {
      return false;
    }

    if (tournament.status !== 'LOBBY') {
      return false;
    }

    const index = tournament.players.findIndex(
      (player) => player.id === playerId,
    );

    if (index === -1) {
      return false;
    }

    tournament.players.splice(index, 1);

    this.save();

    return true;
  }

  // =========================================================
  // JUEGOS
  // =========================================================

  addGame(
    pin: string,
    game: string,
  ): {
    success: boolean;
    error?: string;
    games?: string[];
  } {
    const tournament = this.tournaments.get(pin);

    if (!tournament) {
      return {
        success: false,
        error: 'Torneo no encontrado.',
      };
    }

    const cleanGame = game.trim().slice(0, 40);

    if (!cleanGame) {
      return {
        success: false,
        error: 'Escribe el nombre del juego.',
      };
    }

    const exists = tournament.games.some(
      (existing) =>
        existing.toLowerCase() ===
        cleanGame.toLowerCase(),
    );

    if (exists) {
      return {
        success: false,
        error: 'Ese juego ya está en la lista.',
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
  ): {
    success: boolean;
    error?: string;
    games?: string[];
  } {
    const tournament = this.tournaments.get(pin);

    if (!tournament) {
      return {
        success: false,
        error: 'Torneo no encontrado.',
      };
    }

    tournament.games = tournament.games.filter(
      (existing) => existing !== game,
    );

    this.save();

    return {
      success: true,
      games: tournament.games,
    };
  }

  // =========================================================
  // PLAN DE CLASIFICACIÓN
  // =========================================================

  getBracketPlan(n: number): BracketPlan {
    if (n < 2) {
      return {
        bracketSize: 0,
        direct: 0,
        repSlots: 0,
        repPlayers: 0,
        out: n,
      };
    }

    let bracketSize = 2;

    while (bracketSize * 2 <= n) {
      bracketSize *= 2;
    }

    let direct = Math.ceil(bracketSize / 2);

    let repSlots = bracketSize - direct;

    let repPlayers = repSlots * 2;

    let total = direct + repPlayers;

    while (total > n && bracketSize > 2) {
      bracketSize /= 2;

      direct = Math.ceil(bracketSize / 2);

      repSlots = bracketSize - direct;

      repPlayers = repSlots * 2;

      total = direct + repPlayers;
    }

    if (total > n) {
      repSlots = 0;

      repPlayers = 0;

      direct = Math.min(bracketSize, n);

      total = direct;
    }

    return {
      bracketSize,
      direct,
      repSlots,
      repPlayers,
      out: Math.max(0, n - total),
    };
  }

  // =========================================================
  // CREAR PARTIDO
  // =========================================================

  private createMatch(
    tournament: Tournament,
    stage: Match['stage'],
    round: number,
    label: string,
    player1Id: string,
    player2Id: string,
  ): Match {
    const player1 =
      this.getPlayer(tournament, player1Id) ?? null;

    const player2 =
      this.getPlayer(tournament, player2Id) ?? null;

    const match: Match = {
      id: `m${++tournament.sequence}`,

      stage,

      round,

      label,

      player1,

      player2,

      score1: null,

      score2: null,

      winner: null,

      game: this.pickGame(tournament),
    };

    tournament.matches.push(match);

    return match;
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

    const ids = this.shuffle(
      tournament.players
        .filter((player) => !player.left)
        .map((player) => player.id),
    );

    if (ids.length < 2) {
      return [];
    }

    /*
     * Método del círculo / round-robin.
     *
     * Cada jugador se enfrenta a rivales diferentes
     * siempre que el número de jugadores lo permita.
     */
    const list: Array<string | null> = [...ids];

    if (list.length % 2 !== 0) {
      list.push(null);
    }

    const n = list.length;

    const fixed = list[0];

    const rotation = list.slice(1);

    const rounds: Array<
      Array<[string, string]>
    > = [];

    for (
      let round = 0;
      round < n - 1;
      round++
    ) {
      const current = [
        fixed,
        ...rotation,
      ];

      const pairs: Array<
        [string, string]
      > = [];

      for (
        let i = 0;
        i < n / 2;
        i++
      ) {
        const a = current[i];

        const b = current[n - 1 - i];

        if (a && b) {
          pairs.push([a, b]);
        }
      }

      rounds.push(pairs);

      rotation.unshift(
        rotation.pop()!,
      );
    }

    /*
     * El ejemplo utiliza 3 jornadas.
     */
    rounds
      .slice(0, 3)
      .forEach((pairs, index) => {
        for (const [player1, player2] of pairs) {
          this.createMatch(
            tournament,
            'clasificacion',
            index + 1,
            `Jornada ${index + 1}`,
            player1,
            player2,
          );
        }
      });

    tournament.status = 'CLASIFICACION';

    this.save();

    return tournament.matches;
  }

  // =========================================================
  // CLASIFICACIÓN / STANDINGS
  // =========================================================

  getStandings(
    tournament: Tournament,
  ): Standing[] {
    const rows: Array<{
      id: string;
      idx: number;
      played: number;
      wins: number;
      diff: number;
      zone: 'directo' | 'repesca' | 'fuera';
      left: boolean;
    }> = [];

    tournament.players.forEach(
      (player, index) => {
        const matches =
          tournament.matches.filter(
            (match) =>
              match.stage === 'clasificacion' &&
              match.winner !== null &&
              (
                match.player1?.id === player.id ||
                match.player2?.id === player.id
              ),
          );

        let wins = 0;

        let diff = 0;

        for (const match of matches) {
          if (match.winner?.id === player.id) {
            wins++;
          }

          if (
            match.score1 !== null &&
            match.score2 !== null
          ) {
            if (
              match.player1?.id === player.id
            ) {
              diff +=
                match.score1 -
                match.score2;
            } else {
              diff +=
                match.score2 -
                match.score1;
            }
          }
        }

        rows.push({
          id: player.id,
          idx: index,
          played: matches.length,
          wins,
          diff,
          zone: 'fuera',
          left: !!player.left,
        });
      },
    );

    /*
     * Desempate:
     *
     * 1. Victorias
     * 2. Enfrentamiento directo
     * 3. Diferencia de marcador
     * 4. Orden original
     */
    const headToHead = (
      a: string,
      b: string,
    ): number => {
      const match =
        tournament.matches.find(
          (m) =>
            m.stage === 'clasificacion' &&
            m.winner !== null &&
            (
              (
                m.player1?.id === a &&
                m.player2?.id === b
              ) ||
              (
                m.player1?.id === b &&
                m.player2?.id === a
              )
            ),
        );

      if (!match || !match.winner) {
        return 0;
      }

      if (match.winner.id === a) {
        return -1;
      }

      return 1;
    };

    rows.sort(
      (a, b) =>
        b.wins - a.wins ||
        headToHead(a.id, b.id) ||
        b.diff - a.diff ||
        a.idx - b.idx,
    );

    const plan =
      this.getBracketPlan(rows.length);

    rows.forEach((row, index) => {
      if (index < plan.direct) {
        row.zone = 'directo';
      } else if (
        index <
        plan.direct + plan.repPlayers
      ) {
        row.zone = 'repesca';
      } else {
        row.zone = 'fuera';
      }
    });

    return rows.map((row) => {
      const player =
        this.getPlayer(
          tournament,
          row.id,
        )!;

      return {
        player,
        played: row.played,
        wins: row.wins,
        diff: row.diff,
        zone: row.zone,
        left: row.left,
      };
    });
  }

  // =========================================================
  // CERRAR CLASIFICACIÓN
  // =========================================================

  lockClassification(
    pin: string,
  ):
    | {
        success: true;
        tournament: Tournament;
      }
    | {
        success: false;
        error: string;
      } {
    const tournament =
      this.tournaments.get(pin);

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
          'La clasificación no está activa.',
      };
    }

    const pending =
      tournament.matches.some(
        (match) =>
          match.stage ===
            'clasificacion' &&
          !match.winner,
      );

    if (pending) {
      return {
        success: false,
        error:
          'Aún quedan partidos de clasificación sin resultado.',
      };
    }

    const standings =
      this.getStandings(tournament);

    const plan =
      this.getBracketPlan(
        tournament.players.length,
      );

    const direct =
      standings
        .filter(
          (row) =>
            row.zone === 'directo',
        )
        .map(
          (row) => row.player.id,
        );

    const repechagePlayers =
      standings
        .filter(
          (row) =>
            row.zone === 'repesca',
        )
        .map(
          (row) => row.player.id,
        );

    /*
     * Si no hay repesca, comenzamos directamente
     * la llave.
     */
    if (
      plan.repSlots === 0
    ) {
      tournament.status =
        'ELIMINATORIA';

      this.startEliminationRound(
        tournament,
        direct,
      );

      this.save();

      return {
        success: true,
        tournament,
      };
    }

    /*
     * Creamos la repesca.
     *
     * Ejemplo:
     *
     * 3º vs 6º
     * 4º vs 5º
     */
    tournament.status =
      'REPESCA';

    const ordered =
      [...repechagePlayers];

    for (
      let i = 0;
      i < ordered.length / 2;
      i++
    ) {
      const player1 =
        ordered[i];

      const player2 =
        ordered[
          ordered.length - 1 - i
        ];

      this.createMatch(
        tournament,
        'repesca',
        1,
        `Repesca ${i + 1}`,
        player1,
        player2,
      );
    }

    this.save();

    return {
      success: true,
      tournament,
    };
  }

  // =========================================================
  // REPESCA -> ELIMINATORIA
  // =========================================================

  private tryStartElimination(
    tournament: Tournament,
  ): void {
    const repechage =
      tournament.matches.filter(
        (match) =>
          match.stage === 'repesca',
      );

    if (repechage.length === 0) {
      return;
    }

    if (
      repechage.some(
        (match) =>
          !match.winner,
      )
    ) {
      return;
    }

    const standings =
      this.getStandings(tournament);

    const direct =
      standings
        .filter(
          (row) =>
            row.zone === 'directo',
        )
        .map(
          (row) => row.player.id,
        );

    const repechageWinners =
      repechage
        .map(
          (match) =>
            match.winner?.id,
        )
        .filter(
          (id): id is string =>
            !!id,
        );

    const order: string[] = [];

    for (
      let i = 0;
      i < direct.length;
      i++
    ) {
      order.push(direct[i]);

      const repechageWinner =
        repechageWinners[
          repechageWinners.length -
            1 -
            i
        ];

      if (repechageWinner) {
        order.push(
          repechageWinner,
        );
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
  // ELIMINATORIAS
  // =========================================================

  private startEliminationRound(
    tournament: Tournament,
    playerIds: string[],
  ): void {
    if (playerIds.length < 2) {
      if (playerIds.length === 1) {
        tournament.champion =
          this.getPlayer(
            tournament,
            playerIds[0],
          ) ?? null;

        tournament.status =
          'FINISHED';
      }

      return;
    }

    tournament.bracketRound++;

    const label =
      this.roundName(
        playerIds.length,
      );

    for (
      let i = 0;
      i < playerIds.length;
      i += 2
    ) {
      const player1 =
        playerIds[i];

      const player2 =
        playerIds[i + 1];

      if (!player1 || !player2) {
        continue;
      }

      this.createMatch(
        tournament,
        'eliminatoria',
        tournament.bracketRound,
        label,
        player1,
        player2,
      );
    }
  }

  private tryAdvanceElimination(
    tournament: Tournament,
  ): void {
    const currentRound =
      tournament.matches.filter(
        (match) =>
          match.stage ===
            'eliminatoria' &&
          match.round ===
            tournament.bracketRound,
      );

    if (currentRound.length === 0) {
      return;
    }

    if (
      currentRound.some(
        (match) =>
          !match.winner,
      )
    ) {
      return;
    }

    const winners =
      currentRound
        .map(
          (match) =>
            match.winner?.id,
        )
        .filter(
          (id): id is string =>
            !!id,
        );

    if (winners.length === 1) {
      tournament.champion =
        this.getPlayer(
          tournament,
          winners[0],
        ) ?? null;

      tournament.status =
        'FINISHED';

      return;
    }

    this.startEliminationRound(
      tournament,
      winners,
    );
  }

  // =========================================================
  // RESULTADO DE PARTIDO
  // =========================================================

  setMatchResult(
    pin: string,
    matchId: string,
    score1: number,
    score2: number,
  ):
    | {
        success: true;
        tournament: Tournament;
        isFinished: boolean;
      }
    | {
        success: false;
        error: string;
      } {
    const tournament =
      this.tournaments.get(pin);

    if (!tournament) {
      return {
        success: false,
        error: 'Torneo no encontrado.',
      };
    }

    const match =
      tournament.matches.find(
        (item) =>
          item.id === matchId,
      );

    if (!match) {
      return {
        success: false,
        error: 'Partido no encontrado.',
      };
    }

    if (
      !Number.isInteger(score1) ||
      !Number.isInteger(score2) ||
      score1 < 0 ||
      score2 < 0
    ) {
      return {
        success: false,
        error:
          'El marcador no es válido.',
      };
    }

    if (score1 === score2) {
      return {
        success: false,
        error:
          'No puede haber empate.',
      };
    }

    if (match.winner) {
      return {
        success: false,
        error:
          'Este partido ya tiene resultado.',
      };
    }

    if (
      !match.player1 ||
      !match.player2
    ) {
      return {
        success: false,
        error:
          'El partido no tiene dos jugadores.',
      };
    }

    match.score1 = score1;

    match.score2 = score2;

    match.winner =
      score1 > score2
        ? match.player1
        : match.player2;

    match.forfeit = false;

    match.playedAt = Date.now();

    /*
     * Guardamos el resultado inmediatamente.
     */
    this.save();

    /*
     * Avanzamos automáticamente
     * cuando corresponde.
     */
    if (
      match.stage === 'repesca'
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
      tournament,
      isFinished:
        tournament.status ===
        'FINISHED',
    };
  }

  // =========================================================
  // ABANDONAR / EXPULSAR
  // =========================================================

  removePlayer(
    pin: string,
    playerId: string,
  ): {
    success: boolean;
    error?: string;
  } {
    const tournament =
      this.tournaments.get(pin);

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
        error: 'Jugador no encontrado.',
      };
    }

    /*
     * En lobby desaparece completamente.
     */
    if (
      tournament.status === 'LOBBY'
    ) {
      tournament.players =
        tournament.players.filter(
          (item) =>
            item.id !== playerId,
        );

      this.save();

      return {
        success: true,
      };
    }

    /*
     * Una vez iniciado el torneo,
     * marcamos al jugador como abandonado.
     */
    player.left = true;

    this.resolveForfeitMatches(
      tournament,
      playerId,
    );

    this.save();

    return {
      success: true,
    };
  }

  private resolveForfeitMatches(
    tournament: Tournament,
    playerId: string,
  ): void {
    for (const match of tournament.matches) {
      if (match.winner) {
        continue;
      }

      const player1Left =
        match.player1?.id ===
        playerId;

      const player2Left =
        match.player2?.id ===
        playerId;

      if (
        !player1Left &&
        !player2Left
      ) {
        continue;
      }

      const opponent =
        player1Left
          ? match.player2
          : match.player1;

      if (!opponent) {
        continue;
      }

      match.score1 =
        player1Left ? 0 : 1;

      match.score2 =
        player2Left ? 0 : 1;

      match.winner =
        opponent;

      match.forfeit = true;

      match.playedAt =
        Date.now();
    }

    /*
     * Si el abandono termina una fase,
     * hacemos avanzar el torneo.
     */
    if (
      tournament.status ===
      'REPESCA'
    ) {
      this.tryStartElimination(
        tournament,
      );
    }

    if (
      tournament.status ===
      'ELIMINATORIA'
    ) {
      this.tryAdvanceElimination(
        tournament,
      );
    }

    if (
      tournament.status ===
      'CLASIFICACION'
    ) {
      /*
       * En clasificación, los partidos
       * pendientes del jugador abandonado
       * ya quedan resueltos por forfeit.
       */
    }
  }

  // =========================================================
  // EXPULSAR
  // =========================================================

  kickPlayer(
    pin: string,
    playerId: string,
  ):
    | {
        success: true;
        player: Player;
      }
    | {
        success: false;
        error: string;
      } {
    const tournament =
      this.tournaments.get(pin);

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
        error: 'Jugador no encontrado.',
      };
    }

    tournament.bannedPlayerIds.push(
      player.id,
    );

    tournament.bannedNicknames.push(
      player.nickname.toLowerCase(),
    );

    const result =
      this.removePlayer(
        pin,
        playerId,
      );

    if (!result.success) {
      return {
        success: false,
        error:
          result.error ??
          'No se pudo expulsar.',
      };
    }

    this.save();

    return {
      success: true,
      player,
    };
  }

  // =========================================================
  // SNAPSHOT PARA FRONTEND
  // =========================================================

  getSnapshot(
    pin: string,
  ): TournamentSnapshot | null {
    const tournament =
      this.tournaments.get(pin);

    if (!tournament) {
      return null;
    }

    return {
      pin: tournament.pin,

      phase: tournament.status,

      plan: this.getBracketPlan(
        tournament.players.length,
      ),

      champion:
        tournament.champion,

      players:
        tournament.players.filter(
          (player) =>
            !player.left,
        ),

      games: [
        ...tournament.games,
      ],

      matches:
        tournament.matches,

      standings:
        this.getStandings(
          tournament,
        ),
    };
  }

  // =========================================================
  // HISTORIAL DE UN JUGADOR
  // =========================================================

  getPlayerHistory(
    pin: string,
    playerId: string,
  ) {
    const tournament =
      this.tournaments.get(pin);

    if (!tournament) {
      return null;
    }

    const history =
      tournament.matches
        .filter(
          (match) =>
            match.player1?.id ===
              playerId ||
            match.player2?.id ===
              playerId,
        )
        .map((match) => {
          const isPlayer1 =
            match.player1?.id ===
            playerId;

          const opponent =
            isPlayer1
              ? match.player2
              : match.player1;

          return {
            matchId: match.id,

            stage: match.stage,

            round: match.round,

            label: match.label,

            opponent,

            game: match.game,

            score1: match.score1,

            score2: match.score2,

            winner:
              match.winner,

            won:
              match.winner?.id ===
              playerId,

            playedAt:
              match.playedAt,

            forfeit:
              !!match.forfeit,
          };
        });

    /*
     * El próximo partido pendiente.
     */
    const currentMatch =
      tournament.matches.find(
        (match) =>
          !match.winner &&
          (
            match.player1?.id ===
              playerId ||
            match.player2?.id ===
              playerId
          ),
      );

    const opponent =
      currentMatch
        ? currentMatch.player1?.id ===
          playerId
          ? currentMatch.player2
          : currentMatch.player1
        : null;

    return {
      currentMatch,

      opponent,

      game:
        currentMatch?.game ??
        null,

      history,
    };
  }
}