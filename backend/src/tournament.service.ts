import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { existsSync, promises as fsp, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import {
  BracketPlan,
  HistoryEntry,
  Match,
  MatchStage,
  Player,
  PlayerState,
  PublicPlayer,
  SnapshotMatch,
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

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_NICK = 16;
const MAX_GAME = 30;

type Fail = { success: false; error: string };
const fail = (error: string): Fail => ({ success: false, error });
const newId = () => randomBytes(6).toString('hex');
const newToken = () => randomBytes(16).toString('hex');

@Injectable()
export class TournamentService implements OnModuleDestroy {
  private readonly filePath = join(process.cwd(), 'torneos.json');

  private tournaments: Record<string, Tournament> = {};

  private saveTimer: NodeJS.Timeout | null = null;
  private flushing = false;
  private dirty = false;

  constructor() {
    this.load();
  }

  onModuleDestroy() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    try {
      writeFileSync(this.filePath, JSON.stringify(this.tournaments), 'utf8');
    } catch {
      /* nada que hacer al cerrar */
    }
  }

  // =========================================================
  // PERSISTENCIA
  // =========================================================

  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf8');
        this.tournaments = raw ? JSON.parse(raw) : {};
      }
    } catch {
      this.tournaments = {};
    }

    for (const [pin, t] of Object.entries(this.tournaments)) {
      // Descarta ficheros con el formato antiguo.
      if (!t.hostToken) {
        delete this.tournaments[pin];
        continue;
      }
      // Tras un reinicio nadie está conectado: tendrán que reentrar con su token.
      t.hostSocketId = null;
      t.hostConnected = false;
      for (const p of t.players) {
        p.socketId = null;
        p.connected = false;
      }
    }

    this.purgeOld();
  }

  /** Guarda en diferido y sin bloquear el hilo principal. */
  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer || this.flushing) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flush();
    }, 300);
  }

  private async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    this.dirty = false;
    const tmp = `${this.filePath}.tmp`;
    try {
      await fsp.writeFile(tmp, JSON.stringify(this.tournaments), 'utf8');
      await fsp.rename(tmp, this.filePath);
    } catch (error) {
      console.error('No se pudo guardar torneos.json', error);
    } finally {
      this.flushing = false;
      if (this.dirty) this.scheduleSave();
    }
  }

  private purgeOld(): void {
    const limit = Date.now() - MAX_AGE_MS;
    for (const [pin, t] of Object.entries(this.tournaments)) {
      if (t.createdAt < limit) delete this.tournaments[pin];
    }
  }

  // =========================================================
  // HELPERS
  // =========================================================

  private generatePin(): string {
    let pin = '';
    do {
      pin = String(Math.floor(100000 + Math.random() * 900000));
    } while (this.tournaments[pin]);
    return pin;
  }

  private shuffle<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  private nextPow2(n: number): number {
    let p = 2;
    while (p < n) p *= 2;
    return p;
  }

  /** Orden estándar de un cuadro: 1 vs N, 4 vs N-3, ... (los mejores no se cruzan pronto). */
  private bracketOrder(size: number): number[] {
    let order = [1];
    while (order.length < size) {
      const n = order.length * 2;
      order = order.flatMap((seed) => [seed, n + 1 - seed]);
    }
    return order;
  }

  private pub(player: Player): PublicPlayer {
    return {
      id: player.id,
      nickname: player.nickname,
      connected: player.connected,
      left: player.left,
    };
  }

  private pubById(t: Tournament, id: string | null): PublicPlayer | null {
    const player = id ? this.getPlayer(t, id) : undefined;
    return player ? this.pub(player) : null;
  }

  private getPlayer(t: Tournament, id: string): Player | undefined {
    return t.players.find((p) => p.id === id);
  }

  private getActivePlayers(t: Tournament): Player[] {
    return t.players.filter((p) => !p.left);
  }

  private getMatch(t: Tournament, id: string): Match | undefined {
    return t.matches.find((m) => m.id === id);
  }

  private toSnapshotMatch(t: Tournament, m: Match): SnapshotMatch {
    return {
      ...m,
      player1: this.pubById(t, m.player1Id),
      player2: this.pubById(t, m.player2Id),
    };
  }

  // =========================================================
  // TORNEO Y SESIONES
  // =========================================================

  createTournament(hostSocketId: string): Tournament {
    this.purgeOld();

    // Evita acumular lobbies vacíos del mismo anfitrión.
    for (const [pin, old] of Object.entries(this.tournaments)) {
      if (
        old.hostSocketId === hostSocketId &&
        old.status === 'LOBBY' &&
        old.players.length === 0
      ) {
        delete this.tournaments[pin];
      }
    }

    const tournament: Tournament = {
      pin: this.generatePin(),
      hostToken: newToken(),
      hostSocketId,
      hostConnected: true,
      status: 'LOBBY',
      players: [],
      games: [...DEFAULT_GAMES],
      matches: [],
      bannedNicknames: [],
      bannedPlayerIds: [],
      sequence: 0,
      bracketRound: 0,
      roundSlots: [],
      frozenStandings: null,
      champion: null,
      createdAt: Date.now(),
    };

    this.tournaments[tournament.pin] = tournament;
    this.scheduleSave();
    return tournament;
  }

  getTournament(pin: string): Tournament | undefined {
    return this.tournaments[pin];
  }

  deleteTournament(pin: string): void {
    delete this.tournaments[pin];
    this.scheduleSave();
  }

  isHost(pin: string, socketId: string): boolean {
    const t = this.tournaments[pin];
    return !!t && t.hostSocketId === socketId;
  }

  findBySocket(socketId: string) {
    for (const tournament of Object.values(this.tournaments)) {
      if (tournament.hostSocketId === socketId) {
        return { tournament, role: 'host' as const, player: undefined };
      }
      const player = tournament.players.find(
        (p) => p.socketId === socketId && !p.left,
      );
      if (player) {
        return { tournament, role: 'player' as const, player };
      }
    }
    return undefined;
  }

  getPlayerById(pin: string, playerId: string): Player | undefined {
    const t = this.getTournament(pin);
    return t ? this.getPlayer(t, playerId) : undefined;
  }

  listDisconnected(): { pin: string; playerId: string }[] {
    const list: { pin: string; playerId: string }[] = [];
    for (const t of Object.values(this.tournaments)) {
      for (const p of t.players) {
        if (!p.left && !p.connected) list.push({ pin: t.pin, playerId: p.id });
      }
    }
    return list;
  }

  setPlayerConnected(pin: string, playerId: string, connected: boolean): void {
    const player = this.getPlayerById(pin, playerId);
    if (!player) return;
    player.connected = connected;
    if (!connected) player.socketId = null;
    this.scheduleSave();
  }

  setHostConnected(pin: string, connected: boolean): void {
    const t = this.getTournament(pin);
    if (!t) return;
    t.hostConnected = connected;
    this.scheduleSave();
  }

  rejoinHost(pin: string, hostToken: string, socketId: string) {
    const t = this.getTournament(pin);
    if (!t) return fail('Torneo no encontrado.');
    if (!hostToken || t.hostToken !== hostToken) return fail('No autorizado.');
    t.hostSocketId = socketId;
    t.hostConnected = true;
    this.scheduleSave();
    return { success: true as const };
  }

  rejoinPlayer(pin: string, playerId: string, token: string, socketId: string) {
    const t = this.getTournament(pin);
    if (!t) return fail('Torneo no encontrado.');
    const player = t.players.find((p) => p.id === playerId && p.token === token);
    if (!player || player.left) return fail('Tu sesión ya no es válida.');
    if (t.bannedPlayerIds.includes(player.id)) {
      return fail('Has sido expulsado del torneo.');
    }
    player.socketId = socketId;
    player.connected = true;
    this.scheduleSave();
    return { success: true as const, player };
  }

  // =========================================================
  // JUGADORES
  // =========================================================

  addPlayer(pin: string, rawNickname: string, socketId: string) {
    const t = this.getTournament(pin);
    if (!t) return fail('Torneo no encontrado.');

    const nickname = (rawNickname ?? '').trim().slice(0, MAX_NICK);
    if (!nickname) return fail('Debes introducir un apodo.');

    const key = nickname.toLowerCase();
    const same = t.players.find(
      (p) => !p.left && p.nickname.toLowerCase() === key,
    );

    // Doble toque en "Unirse": mismo socket y mismo apodo -> es idempotente.
    if (same && same.socketId === socketId) {
      return { success: true as const, player: same };
    }

    if (t.status !== 'LOBBY') return fail('El torneo ya ha comenzado.');
    if (t.bannedNicknames.includes(key)) {
      return fail('Ese jugador ha sido expulsado del torneo.');
    }
    if (same) return fail('Ese apodo ya está ocupado.');

    const player: Player = {
      id: newId(),
      token: newToken(),
      nickname,
      socketId,
      connected: true,
      left: false,
      seed: Math.random(),
    };

    t.players.push(player);
    this.scheduleSave();
    return { success: true as const, player };
  }

  /** Salida voluntaria, desconexión prolongada o expulsión. */
  removePlayer(pin: string, playerId: string) {
    const t = this.getTournament(pin);
    if (!t) return fail('Torneo no encontrado.');

    const player = this.getPlayer(t, playerId);
    if (!player) return fail('Jugador no encontrado.');

    if (t.status === 'LOBBY') {
      t.players = t.players.filter((p) => p.id !== playerId);
    } else {
      player.left = true;
      player.connected = false;
      player.socketId = null;
      this.resolveLeftMatches(t);
      this.progress(t);
    }

    this.scheduleSave();
    return { success: true as const, player };
  }

  kickPlayer(pin: string, playerId: string) {
    const t = this.getTournament(pin);
    if (!t) return fail('Torneo no encontrado.');

    const player = this.getPlayer(t, playerId);
    if (!player) return fail('Jugador no encontrado.');

    if (!t.bannedPlayerIds.includes(player.id)) t.bannedPlayerIds.push(player.id);

    const nick = player.nickname.toLowerCase();
    if (!t.bannedNicknames.includes(nick)) t.bannedNicknames.push(nick);

    return this.removePlayer(pin, playerId);
  }

  // =========================================================
  // JUEGOS
  // =========================================================

  addGame(pin: string, game: string) {
    const t = this.getTournament(pin);
    if (!t) return fail('Torneo no encontrado.');

    const clean = (game ?? '').trim().slice(0, MAX_GAME);
    if (!clean) return fail('El nombre del juego está vacío.');

    if (t.games.some((g) => g.toLowerCase() === clean.toLowerCase())) {
      return fail('Ese juego ya existe.');
    }

    t.games.push(clean);
    this.scheduleSave();
    return { success: true as const, games: t.games };
  }

  removeGame(pin: string, game: string) {
    const t = this.getTournament(pin);
    if (!t) return fail('Torneo no encontrado.');

    const index = t.games.indexOf(game);
    if (index === -1) return fail('Juego no encontrado.');

    t.games.splice(index, 1);
    this.scheduleSave();
    return { success: true as const, games: t.games };
  }

  assignGame(pin: string, matchId: string, game: string) {
    const t = this.getTournament(pin);
    if (!t) return fail('Torneo no encontrado.');

    const match = this.getMatch(t, matchId);
    if (!match) return fail('Partido no encontrado.');
    if (match.played) return fail('El partido ya ha terminado.');
    if (!t.games.includes(game)) return fail('Ese juego no está disponible.');

    match.game = game;
    this.scheduleSave();
    return { success: true as const, game };
  }

  /** Vuelve a sortear el juego de un partido (distinto al actual). */
  rerollGame(pin: string, matchId: string) {
    const t = this.getTournament(pin);
    if (!t) return fail('Torneo no encontrado.');

    const match = this.getMatch(t, matchId);
    if (!match) return fail('Partido no encontrado.');
    if (match.played) return fail('El partido ya ha terminado.');

    const game = this.pickGame(t, match.player1Id, match.player2Id, match.game);
    if (!game) return fail('No hay juegos disponibles.');

    match.game = game;
    this.scheduleSave();
    return { success: true as const, game };
  }

  /**
   * Elige un juego al azar evitando los que ya han jugado los dos rivales
   * y prefiriendo los menos usados en todo el torneo.
   */
  private pickGame(
    t: Tournament,
    player1Id: string,
    player2Id: string,
    avoid: string | null = null,
  ): string | null {
    if (t.games.length === 0) return null;

    const usedByThem = new Set<string>();
    const usage = new Map<string, number>();

    for (const m of t.matches) {
      if (!m.game) continue;
      usage.set(m.game, (usage.get(m.game) ?? 0) + 1);
      const theirs = [m.player1Id, m.player2Id];
      if (theirs.includes(player1Id) || theirs.includes(player2Id)) {
        usedByThem.add(m.game);
      }
    }

    let pool = t.games.filter((g) => !usedByThem.has(g) && g !== avoid);
    if (pool.length === 0) pool = t.games.filter((g) => g !== avoid);
    if (pool.length === 0) pool = [...t.games];

    const min = Math.min(...pool.map((g) => usage.get(g) ?? 0));
    const best = pool.filter((g) => (usage.get(g) ?? 0) === min);
    return best[Math.floor(Math.random() * best.length)];
  }

  // =========================================================
  // PLAN DEL TORNEO
  // =========================================================

  getBracketPlan(n: number): BracketPlan {
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
    while (bracketSize * 2 <= n) bracketSize *= 2;

    const calc = (size: number) => {
      const direct = Math.ceil(size / 2);
      const repSlots = size - direct;
      return {
        direct,
        repSlots,
        repPlayers: repSlots * 2,
        totalNeeded: direct + repSlots * 2,
      };
    };

    let c = calc(bracketSize);

    while (c.totalNeeded > n && bracketSize > 2) {
      bracketSize /= 2;
      c = calc(bracketSize);
    }

    if (c.totalNeeded > n) {
      const direct = Math.min(bracketSize, n);
      c = { direct, repSlots: 0, repPlayers: 0, totalNeeded: direct };
    }

    return { bracketSize, ...c, out: Math.max(0, n - c.totalNeeded) };
  }

  private roundName(size: number): string {
    if (size <= 2) return 'GRAN FINAL';
    if (size === 4) return 'SEMIFINAL';
    if (size === 8) return 'CUARTOS DE FINAL';
    if (size === 16) return 'OCTAVOS DE FINAL';
    if (size === 32) return 'DIECISEISAVOS DE FINAL';
    return `RONDA DE ${size}`;
  }

  // =========================================================
  // PARTIDOS
  // =========================================================

  private createMatch(
    t: Tournament,
    stage: MatchStage,
    round: number,
    player1Id: string,
    player2Id: string,
    slot?: number,
  ): Match {
    const match: Match = {
      id: `${t.pin}-${++t.sequence}`,
      stage,
      round,
      slot,
      player1Id,
      player2Id,
      score1: 0,
      score2: 0,
      winnerId: null,
      game: this.pickGame(t, player1Id, player2Id),
      played: false,
      forfeit: false,
      playedAt: null,
    };

    t.matches.push(match);
    return match;
  }

  // =========================================================
  // CLASIFICACIÓN
  // =========================================================

  startTournament(pin: string) {
    const t = this.getTournament(pin);
    if (!t) return fail('Torneo no encontrado.');
    if (t.status !== 'LOBBY') return fail('El torneo ya ha comenzado.');
    if (this.getActivePlayers(t).length < 2) {
      return fail('Se necesitan al menos 2 jugadores.');
    }

    this.generateClassification(t);
    this.scheduleSave();
    return { success: true as const };
  }

  private generateClassification(t: Tournament): void {
    t.matches = [];
    t.sequence = 0;
    t.bracketRound = 0;
    t.roundSlots = [];
    t.frozenStandings = null;
    t.champion = null;
    t.status = 'CLASIFICACION';

    let list: (Player | null)[] = this.shuffle(this.getActivePlayers(t));
    if (list.length % 2 !== 0) list.push(null);

    const totalRounds = Math.min(3, list.length - 1);

    for (let round = 1; round <= totalRounds; round++) {
      for (let i = 0; i < list.length / 2; i++) {
        const a = list[i];
        const b = list[list.length - 1 - i];
        if (a && b) this.createMatch(t, 'clasificacion', round, a.id, b.id);
      }

      // Método del círculo: el primero queda fijo y el resto rota.
      const [fixed, ...rest] = list;
      rest.unshift(rest.pop() as Player | null);
      list = [fixed, ...rest];
    }
  }

  private computeStandings(t: Tournament): Standing[] {
    const players = this.getActivePlayers(t);
    const plan = this.getBracketPlan(players.length);
    const played = t.matches.filter(
      (m) => m.stage === 'clasificacion' && m.played && m.winnerId,
    );

    const rows = players.map((player) => {
      let wins = 0;
      let losses = 0;
      let scoreFor = 0;
      let scoreAgainst = 0;

      for (const m of played) {
        const isP1 = m.player1Id === player.id;
        const isP2 = m.player2Id === player.id;
        if (!isP1 && !isP2) continue;

        scoreFor += isP1 ? m.score1 : m.score2;
        scoreAgainst += isP1 ? m.score2 : m.score1;
        if (m.winnerId === player.id) wins++;
        else losses++;
      }

      return { player, wins, losses, scoreFor, scoreAgainst };
    });

    const headToHead = (a: string, b: string) => {
      const m = played.find(
        (x) =>
          (x.player1Id === a && x.player2Id === b) ||
          (x.player1Id === b && x.player2Id === a),
      );
      if (!m) return 0;
      return m.winnerId === a ? -1 : 1;
    };

    // Porcentaje de victorias primero: quien descansa una ronda no sale perjudicado.
    const rate = (r: { wins: number; losses: number }) => {
      const total = r.wins + r.losses;
      return total ? r.wins / total : 0;
    };

    rows.sort(
      (a, b) =>
        rate(b) - rate(a) ||
        b.wins - a.wins ||
        b.scoreFor - b.scoreAgainst - (a.scoreFor - a.scoreAgainst) ||
        b.scoreFor - a.scoreFor ||
        headToHead(a.player.id, b.player.id) ||
        a.player.seed - b.player.seed,
    );

    return rows.map((r, index) => ({
      position: index + 1,
      player: this.pub(r.player),
      played: r.wins + r.losses,
      wins: r.wins,
      losses: r.losses,
      scoreFor: r.scoreFor,
      scoreAgainst: r.scoreAgainst,
      roundDifference: r.scoreFor - r.scoreAgainst,
      zone:
        index < plan.direct
          ? 'directo'
          : index < plan.direct + plan.repPlayers
            ? 'repesca'
            : 'fuera',
    }));
  }

  getStandings(t: Tournament): Standing[] {
    return t.frozenStandings ?? this.computeStandings(t);
  }

  lockClassification(pin: string) {
    const t = this.getTournament(pin);
    if (!t) return fail('Torneo no encontrado.');
    if (t.status !== 'CLASIFICACION') {
      return fail('La clasificación ya está cerrada.');
    }

    const pending = t.matches.some(
      (m) => m.stage === 'clasificacion' && !m.played,
    );
    if (pending) {
      return fail('Todavía quedan partidos de clasificación sin resultado.');
    }

    // Se congela la tabla: a partir de aquí las salidas ya no cambian las zonas.
    const standings = this.computeStandings(t);
    t.frozenStandings = standings;

    const direct = standings
      .filter((s) => s.zone === 'directo')
      .map((s) => s.player.id);
    const rep = standings
      .filter((s) => s.zone === 'repesca')
      .map((s) => s.player.id);

    if (rep.length < 2) {
      t.status = 'ELIMINATORIA';
      const size = this.nextPow2(direct.length);
      this.startEliminationRound(
        t,
        this.bracketOrder(size).map((seed) => direct[seed - 1] ?? null),
      );
    } else {
      t.status = 'REPESCA';
      // Mejor contra peor dentro de la zona de repesca.
      for (let j = 0; j < Math.floor(rep.length / 2); j++) {
        this.createMatch(t, 'repesca', 1, rep[j], rep[rep.length - 1 - j]);
      }
      this.resolveLeftMatches(t);
      this.progress(t);
    }

    this.scheduleSave();
    return { success: true as const };
  }

  // =========================================================
  // REPESCA Y ELIMINATORIA
  // =========================================================

  private progress(t: Tournament): void {
    if (t.status === 'REPESCA') this.tryStartElimination(t);
    else if (t.status === 'ELIMINATORIA') this.tryAdvanceElimination(t);
  }

  private tryStartElimination(t: Tournament): void {
    if (t.status !== 'REPESCA') return;

    const repMatches = t.matches.filter((m) => m.stage === 'repesca');
    if (repMatches.length === 0 || repMatches.some((m) => !m.played)) return;

    const direct = (t.frozenStandings ?? [])
      .filter((s) => s.zone === 'directo')
      .map((s) => s.player.id);

    // Los cabezas de serie directos ocupan las primeras plazas;
    // el ganador de la repesca "j" ocupa la plaza direct + j + 1.
    const size = this.nextPow2(direct.length + repMatches.length);
    const slots = this.bracketOrder(size).map((seed) =>
      seed <= direct.length
        ? direct[seed - 1]
        : (repMatches[seed - direct.length - 1]?.winnerId ?? null),
    );

    t.status = 'ELIMINATORIA';
    this.startEliminationRound(t, slots);
  }

  private startEliminationRound(t: Tournament, slots: (string | null)[]): void {
    t.bracketRound++;
    t.roundSlots = slots;

    const name = this.roundName(this.nextPow2(slots.length));

    for (let p = 0; p < slots.length; p += 2) {
      const a = slots[p];
      const b = slots[p + 1] ?? null;
      if (a && b) {
        const match = this.createMatch(t, 'eliminatoria', t.bracketRound, a, b, p / 2);
        match.roundName = name;
      }
    }

    this.resolveLeftMatches(t);
    this.tryAdvanceElimination(t);
  }

  private tryAdvanceElimination(t: Tournament): void {
    if (t.status !== 'ELIMINATORIA') return;

    const round = t.bracketRound;
    const roundMatches = t.matches.filter(
      (m) => m.stage === 'eliminatoria' && m.round === round,
    );
    if (roundMatches.some((m) => !m.played)) return;

    const slots = t.roundSlots;
    const next: (string | null)[] = [];

    for (let p = 0; p < slots.length; p += 2) {
      const a = slots[p];
      const b = slots[p + 1] ?? null;
      let advances: string | null = null;

      if (a && b) {
        advances = roundMatches.find((m) => m.slot === p / 2)?.winnerId ?? null;
      } else {
        // Pase directo (bye), salvo que ese jugador ya se haya ido.
        const only = a ?? b;
        const gone = only ? !!this.getPlayer(t, only)?.left : true;
        advances = only && !gone ? only : null;
      }

      next.push(advances);
    }

    const alive = next.filter((id): id is string => !!id);

    if (alive.length <= 1) {
      t.champion = alive[0] ?? null;
      t.status = 'FINISHED';
      return;
    }

    this.startEliminationRound(t, next.length % 2 ? [...next, null] : next);
  }

  /** Da por perdidos (forfait) los partidos pendientes con jugadores que ya no están. */
  private resolveLeftMatches(t: Tournament): void {
    const gone = (id: string) => {
      const p = this.getPlayer(t, id);
      return !p || p.left;
    };

    for (const m of t.matches) {
      if (m.played) continue;

      const g1 = gone(m.player1Id);
      const g2 = gone(m.player2Id);
      if (!g1 && !g2) continue;

      m.played = true;
      m.forfeit = true;
      m.playedAt = Date.now();
      m.game = m.game ?? t.games[0] ?? null;

      if (g1 && g2) {
        m.winnerId = null;
        m.score1 = 0;
        m.score2 = 0;
      } else if (g1) {
        m.winnerId = m.player2Id;
        m.score1 = 0;
        m.score2 = 2;
      } else {
        m.winnerId = m.player1Id;
        m.score1 = 2;
        m.score2 = 0;
      }
    }
  }

  // =========================================================
  // RESULTADOS
  // =========================================================

  setMatchResult(pin: string, matchId: string, score1: number, score2: number) {
    const t = this.getTournament(pin);
    if (!t) return fail('Torneo no encontrado.');

    const match = this.getMatch(t, matchId);
    if (!match) return fail('Partido no encontrado.');
    if (match.played) return fail('Este partido ya ha terminado.');
    if (!match.game) {
      return fail('Primero debes asignar un juego al partido.');
    }

    const valid = (n: number) => Number.isInteger(n) && n >= 0 && n <= 2;
    if (!valid(score1) || !valid(score2)) {
      return fail('El marcador debe estar entre 0 y 2.');
    }
    if (score1 === score2) return fail('No puede haber empate.');
    if (score1 !== 2 && score2 !== 2) return fail('Un jugador debe llegar a 2.');

    match.score1 = score1;
    match.score2 = score2;
    match.winnerId = score1 > score2 ? match.player1Id : match.player2Id;
    match.played = true;
    match.forfeit = false;
    match.playedAt = Date.now();

    this.progress(t);
    this.scheduleSave();

    return { success: true as const, finished: t.status === 'FINISHED' };
  }

  // =========================================================
  // SNAPSHOT Y ESTADO INDIVIDUAL
  // =========================================================

  getSnapshot(pin: string): TournamentSnapshot | null {
    const t = this.getTournament(pin);
    if (!t) return null;

    const active = this.getActivePlayers(t);

    return {
      pin: t.pin,
      phase: t.status,
      plan: this.getBracketPlan(active.length),
      players: active.map((p) => this.pub(p)),
      games: t.games,
      matches: t.matches.map((m) => this.toSnapshotMatch(t, m)),
      standings: this.getStandings(t),
      champion: this.pubById(t, t.champion),
    };
  }

  getPlayerHistory(pin: string, playerId: string): PlayerState | null {
    const t = this.getTournament(pin);
    if (!t) return null;

    const player = this.getPlayer(t, playerId);
    if (!player) return null;

    const mine = t.matches.filter(
      (m) => m.player1Id === playerId || m.player2Id === playerId,
    );

    const opponentOf = (m: Match) =>
      m.player1Id === playerId ? m.player2Id : m.player1Id;

    const history: HistoryEntry[] = mine.map((m) => {
      const isP1 = m.player1Id === playerId;
      return {
        matchId: m.id,
        stage: m.stage,
        roundName: m.roundName,
        opponent: this.pubById(t, opponentOf(m)),
        game: m.game,
        myScore: isP1 ? m.score1 : m.score2,
        opponentScore: isP1 ? m.score2 : m.score1,
        result: !m.played ? 'pending' : m.winnerId === playerId ? 'win' : 'loss',
        forfeit: m.forfeit,
      };
    });

    const current = mine.find((m) => !m.played) ?? null;
    const standing = this.getStandings(t).find((s) => s.player.id === playerId);

    return {
      player: this.pub(player),
      phase: t.status,
      currentMatch: current ? this.toSnapshotMatch(t, current) : null,
      opponent: current ? this.pubById(t, opponentOf(current)) : null,
      game: current?.game ?? null,
      history,
      zone: standing?.zone ?? null,
    };
  }
}