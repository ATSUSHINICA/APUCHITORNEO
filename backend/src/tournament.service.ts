import { Injectable } from '@nestjs/common';
import {
  Tournament,
  Player,
  Match,
  MatchStage,
} from './tournament.interface';

@Injectable()
export class TournamentService {
  private tournaments = new Map<string, Tournament>();

  private readonly DEFAULT_GAMES = [
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

  // ─────────────────────────────────────────────
  // UTILIDADES
  // ─────────────────────────────────────────────

  private uid(): string {
    return Math.random().toString(36).substring(2, 10);
  }

  private shuffle<T>(array: T[]): T[] {
    const result = [...array];

    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));

      [result[i], result[j]] = [result[j], result[i]];
    }

    return result;
  }

  private byId(
    tournament: Tournament,
    id: string | null | undefined,
  ): Player | null {
    if (!id) return null;

    return tournament.players.find((p) => p.id === id) ?? null;
  }

  private pickGame(tournament: Tournament): string | undefined {
    if (tournament.games.length === 0) {
      return undefined;
    }

    return tournament.games[
      Math.floor(Math.random() * tournament.games.length)
    ];
  }

  // ─────────────────────────────────────────────
  // PIN
  // ─────────────────────────────────────────────

  generatePin(): string {
    let pin: string;

    do {
      pin = Math.floor(100000 + Math.random() * 900000).toString();
    } while (this.tournaments.has(pin));

    return pin;
  }

  // ─────────────────────────────────────────────
  // CREAR TORNEO
  // ─────────────────────────────────────────────

  createTournament(hostSocketId: string): Tournament {
    const pin = this.generatePin();

    const tournament: Tournament = {
      pin,
      hostSocketId,
      status: 'LOBBY',

      players: [],
      matches: [],

      games: [...this.DEFAULT_GAMES],

      sequence: 0,
      bracketRound: 0,

      direct: [],

      champion: null,
    };

    this.tournaments.set(pin, tournament);

    return tournament;
  }

  // ─────────────────────────────────────────────
  // OBTENER TORNEO
  // ─────────────────────────────────────────────

  getTournament(pin: string): Tournament | undefined {
    return this.tournaments.get(pin);
  }

  // ─────────────────────────────────────────────
  // JUGADORES
  // ─────────────────────────────────────────────

  addPlayer(
    pin: string,
    player: Player,
  ): boolean {
    const tournament = this.tournaments.get(pin);

    if (!tournament) return false;

    if (tournament.status !== 'LOBBY') {
      return false;
    }

    const exists = tournament.players.some(
      (p) =>
        p.nickname.toLowerCase() === player.nickname.toLowerCase(),
    );

    if (exists) {
      return false;
    }

    tournament.players.push(player);

    return true;
  }

  removePlayer(
    pin: string,
    playerId: string,
  ): boolean {
    const tournament = this.tournaments.get(pin);

    if (!tournament) return false;

    const index = tournament.players.findIndex(
      (p) => p.id === playerId,
    );

    if (index === -1) return false;

    tournament.players.splice(index, 1);

    return true;
  }

  // ─────────────────────────────────────────────
  // PLAN DEL TORNEO
  // ─────────────────────────────────────────────

  computePlan(n: number) {
    if (n < 2) {
      return {
        bracketSize: 0,
        direct: 0,
        repSlots: 0,
        repPlayers: 0,
        out: n,
      };
    }

    let size = 2;

    while (size * 2 <= n) {
      size *= 2;
    }

    const calculate = (s: number) => {
      const direct = Math.ceil(s / 2);
      const slots = s - direct;

      return {
        direct,
        slots,
        repPlayers: slots * 2,
        total: direct + slots * 2,
      };
    };

    let result = calculate(size);

    while (result.total > n && size > 2) {
      size /= 2;
      result = calculate(size);
    }

    if (result.total > n) {
      const direct = Math.min(size, n);

      result = {
        direct,
        slots: 0,
        repPlayers: 0,
        total: direct,
      };
    }

    return {
      bracketSize: size,
      direct: result.direct,
      repSlots: result.slots,
      repPlayers: result.repPlayers,
      out: Math.max(0, n - result.total),
    };
  }

  // ─────────────────────────────────────────────
  // PARTIDOS
  // ─────────────────────────────────────────────

  private newMatch(
    tournament: Tournament,
    stage: MatchStage,
    round: number,
    label: string,
    player1: Player | null,
    player2: Player | null,
  ): Match {
    tournament.sequence++;

    const match: Match = {
      id: `m${tournament.sequence}`,

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

  // ─────────────────────────────────────────────
  // CLASIFICACIÓN
  // ─────────────────────────────────────────────

  generateClassification(
    tournament: Tournament,
  ): void {
    const players = this.shuffle(tournament.players);

    if (players.length < 2) {
      return;
    }

    const list: (Player | null)[] = [...players];

    if (list.length % 2 !== 0) {
      list.push(null);
    }

    const n = list.length;

    const fixed = list[0];

    const rotation = list.slice(1);

    const rounds: Player[][][] = [];

    for (let r = 0; r < n - 1; r++) {
      const current = [fixed, ...rotation];

      const pairs: Player[][] = [];

      for (let i = 0; i < n / 2; i++) {
        const player1 = current[i];
        const player2 = current[n - 1 - i];

        if (player1 && player2) {
          pairs.push([player1, player2]);
        }
      }

      rounds.push(pairs);

      rotation.unshift(rotation.pop()!);
    }

    // Para no generar una fase de clasificación interminable,
    // utilizamos las primeras 3 jornadas.
    rounds
      .slice(0, 3)
      .forEach((pairs, index) => {
        pairs.forEach(([player1, player2]) => {
          this.newMatch(
            tournament,
            'clasificacion',
            index + 1,
            `Jornada ${index + 1}`,
            player1,
            player2,
          );
        });
      });
  }

  // ─────────────────────────────────────────────
  // CLASIFICACIÓN / TABLA
  // ─────────────────────────────────────────────

  standings(tournament: Tournament) {
    const rows = tournament.players.map((player, index) => {
      let wins = 0;
      let played = 0;
      let diff = 0;

      tournament.matches.forEach((match) => {
        if (
          match.stage !== 'clasificacion' ||
          !match.winner ||
          (
            match.player1?.id !== player.id &&
            match.player2?.id !== player.id
          )
        ) {
          return;
        }

        played++;

        const mine =
          match.player1?.id === player.id
            ? match.score1 ?? 0
            : match.score2 ?? 0;

        const theirs =
          match.player1?.id === player.id
            ? match.score2 ?? 0
            : match.score1 ?? 0;

        diff += mine - theirs;

        if (match.winner.id === player.id) {
          wins++;
        }
      });

      return {
        id: player.id,
        idx: index,
        wins,
        played,
        diff,
      };
    });

    const headToHead = (
      a: string,
      b: string,
    ): number => {
      const match = tournament.matches.find(
        (m) =>
          m.stage === 'clasificacion' &&
          m.winner &&
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

      if (!match || !match.winner) return 0;

      return match.winner.id === a ? -1 : 1;
    };

    rows.sort(
      (a, b) =>
        b.wins - a.wins ||
        headToHead(a.id, b.id) ||
        b.diff - a.diff ||
        a.idx - b.idx,
    );

    const plan = this.computePlan(rows.length);

    rows.forEach((row, index) => {
      if (index < plan.direct) {
        (row as any).zone = 'directo';
      } else if (
        index < plan.direct + plan.repPlayers
      ) {
        (row as any).zone = 'repesca';
      } else {
        (row as any).zone = 'fuera';
      }
    });

    return rows;
  }

  // ─────────────────────────────────────────────
  // REPESCA
  // ─────────────────────────────────────────────

  private createRepesca(
    tournament: Tournament,
  ): void {
    const standings = this.standings(tournament);

    const plan = this.computePlan(
      standings.length,
    );

    tournament.direct = standings
      .slice(0, plan.direct)
      .map((row) => row.id);

    const repescaPlayers = standings
      .slice(
        plan.direct,
        plan.direct + plan.repPlayers,
      )
      .map((row) => row.id);

    for (
      let i = 0;
      i < repescaPlayers.length;
      i += 2
    ) {
      const player1 = this.byId(
        tournament,
        repescaPlayers[i],
      );

      const player2 = this.byId(
        tournament,
        repescaPlayers[i + 1],
      );

      this.newMatch(
        tournament,
        'repesca',
        0,
        'Repesca',
        player1,
        player2,
      );
    }

    if (repescaPlayers.length > 0) {
      tournament.status = 'REPESCA';
    } else {
      tournament.status = 'IN_PROGRESS';

      this.startEliminationRound(
        tournament,
        tournament.direct,
      );
    }
  }

  // ─────────────────────────────────────────────
  // ELIMINATORIAS
  // ─────────────────────────────────────────────

  private roundName(size: number): string {
    const names: Record<number, string> = {
      2: 'Final',
      4: 'Semifinal',
      8: 'Cuartos',
      16: 'Octavos',
    };

    return names[size] ?? `Ronda de ${size}`;
  }

  private startEliminationRound(
    tournament: Tournament,
    playerIds: string[],
  ): void {
    tournament.bracketRound++;

    const label = this.roundName(
      playerIds.length,
    );

    for (
      let i = 0;
      i < playerIds.length;
      i += 2
    ) {
      const player1 = this.byId(
        tournament,
        playerIds[i],
      );

      const player2 = this.byId(
        tournament,
        playerIds[i + 1],
      );

      if (player1) {
        this.newMatch(
          tournament,
          'eliminatoria',
          tournament.bracketRound,
          label,
          player1,
          player2,
        );
      }
    }
  }

  private buildFirstRound(
    tournament: Tournament,
  ): void {
    const repescaWinners = tournament.matches
      .filter((match) => match.stage === 'repesca')
      .map((match) => match.winner?.id)
      .filter(Boolean) as string[];

    const order: string[] = [];

    tournament.direct.forEach(
      (id, index) => {
        order.push(id);

        const repescaWinner =
          repescaWinners[
            repescaWinners.length - 1 - index
          ];

        if (repescaWinner) {
          order.push(repescaWinner);
        }
      },
    );

    this.startEliminationRound(
      tournament,
      order,
    );
  }

  // ─────────────────────────────────────────────
  // AVANZAR TORNEO
  // ─────────────────────────────────────────────

  advanceTournament(
    tournament: Tournament,
  ): void {
    // REPESCA
    if (tournament.status === 'REPESCA') {
      const repescaMatches = tournament.matches.filter(
        (match) => match.stage === 'repesca',
      );

      if (
        repescaMatches.length > 0 &&
        repescaMatches.every(
          (match) => !!match.winner,
        )
      ) {
        tournament.status = 'IN_PROGRESS';

        this.buildFirstRound(tournament);
      }

      return;
    }

    // ELIMINATORIAS
    if (tournament.status === 'IN_PROGRESS') {
      const currentMatches =
        tournament.matches.filter(
          (match) =>
            match.stage === 'eliminatoria' &&
            match.round === tournament.bracketRound,
        );

      if (
        currentMatches.length > 0 &&
        currentMatches.every(
          (match) => !!match.winner,
        )
      ) {
        const winners = currentMatches
          .map((match) => match.winner?.id)
          .filter(Boolean) as string[];

        if (winners.length === 1) {
          const champion = this.byId(
            tournament,
            winners[0],
          );

          tournament.champion = champion;

          tournament.status = 'FINISHED';

          return;
        }

        this.startEliminationRound(
          tournament,
          winners,
        );
      }
    }
  }

  // ─────────────────────────────────────────────
  // INICIAR TORNEO
  // ─────────────────────────────────────────────

  startTournament(
    pin: string,
  ): Tournament | null {
    const tournament =
      this.tournaments.get(pin);

    if (!tournament) return null;

    if (tournament.players.length < 2) {
      return null;
    }

    if (tournament.status !== 'LOBBY') {
      return null;
    }

    tournament.status = 'CLASSIFICATION';

    tournament.matches = [];

    tournament.sequence = 0;
    tournament.bracketRound = 0;

    tournament.direct = [];

    tournament.champion = null;

    this.generateClassification(
      tournament,
    );

    return tournament;
  }

  // ─────────────────────────────────────────────
  // RESULTADO
  // ─────────────────────────────────────────────

  setMatchResult(
    pin: string,
    matchId: string,
    score1: number,
    score2: number,
  ):
    | {
        tournament: Tournament;
        isFinished: boolean;
      }
    | null {
    const tournament =
      this.tournaments.get(pin);

    if (!tournament) return null;

    const match =
      tournament.matches.find(
        (m) => m.id === matchId,
      );

    if (!match) return null;

    if (!match.player1 || !match.player2) {
      return null;
    }

    if (
      !Number.isInteger(score1) ||
      !Number.isInteger(score2) ||
      score1 < 0 ||
      score2 < 0 ||
      score1 === score2
    ) {
      return null;
    }

    // En eliminatorias no permitimos modificar
    // un resultado ya registrado.
    if (
      match.winner &&
      match.stage !== 'clasificacion'
    ) {
      return null;
    }

    match.score1 = score1;
    match.score2 = score2;

    match.winner =
      score1 > score2
        ? match.player1
        : match.player2;

    match.playedAt = Date.now();

    this.advanceTournament(
      tournament,
    );

    return {
      tournament,
      isFinished:
        tournament.status === 'FINISHED',
    };
  }

  // ─────────────────────────────────────────────
  // SNAPSHOT PARA FRONTEND
  // ─────────────────────────────────────────────

  getSnapshot(tournament: Tournament) {
    return {
      pin: tournament.pin,

      status: tournament.status,

      champion: tournament.champion
        ? {
            id: tournament.champion.id,
            nickname:
              tournament.champion.nickname,
          }
        : null,

      matches:
        tournament.matches.map(
          (match) => ({
            id: match.id,

            stage: match.stage,

            round: match.round,

            label: match.label,

            player1: match.player1
              ? {
                  id: match.player1.id,
                  nickname:
                    match.player1.nickname,
                }
              : null,

            player2: match.player2
              ? {
                  id: match.player2.id,
                  nickname:
                    match.player2.nickname,
                }
              : null,

            score1: match.score1,
            score2: match.score2,

            winnerId:
              match.winner?.id ?? null,

            game: match.game,
          }),
        ),

      standings:
        this.standings(
          tournament,
        ).map((row) => ({
          player: this.byId(
            tournament,
            row.id,
          ),

          played: row.played,

          wins: row.wins,

          diff: row.diff,

          zone: (row as any).zone,
        })),
    };
  }
}