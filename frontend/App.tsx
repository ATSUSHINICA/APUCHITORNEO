import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { socket } from './src/services/socket';

/* ───────── Tipos (reflejan tournament.interface.ts) ───────── */
type Zone = 'directo' | 'repesca' | 'fuera';
type Stage = 'clasificacion' | 'repesca' | 'eliminatoria';
type Phase = 'LOBBY' | 'CLASIFICACION' | 'REPESCA' | 'ELIMINATORIA' | 'FINISHED';

type PublicPlayer = { id: string; nickname: string; connected: boolean; left: boolean };

type Match = {
  id: string;
  stage: Stage;
  round: number;
  roundName?: string;
  player1: PublicPlayer | null;
  player2: PublicPlayer | null;
  score1: number;
  score2: number;
  winnerId: string | null;
  game: string | null;
  played: boolean;
  forfeit: boolean;
};

type Standing = {
  position: number;
  player: PublicPlayer;
  played: number;
  wins: number;
  losses: number;
  scoreFor: number;
  scoreAgainst: number;
  roundDifference: number;
  zone: Zone;
};

type Plan = {
  bracketSize: number;
  direct: number;
  repSlots: number;
  repPlayers: number;
  out: number;
  totalNeeded: number;
};

type Snapshot = {
  pin: string;
  phase: Phase;
  plan: Plan;
  players: PublicPlayer[];
  games: string[];
  matches: Match[];
  standings: Standing[];
  champion: PublicPlayer | null;
};

type HistoryEntry = {
  matchId: string;
  stage: Stage;
  roundName?: string;
  opponent: PublicPlayer | null;
  game: string | null;
  myScore: number;
  opponentScore: number;
  result: 'win' | 'loss' | 'pending';
  forfeit: boolean;
};

type PlayerState = {
  player: PublicPlayer;
  phase: Phase;
  currentMatch: Match | null;
  opponent: PublicPlayer | null;
  game: string | null;
  history: HistoryEntry[];
  zone: Zone | null;
};

type Session = {
  pin: string;
  role: 'host' | 'player';
  token: string;
  playerId?: string;
  nickname?: string;
};

type Screen = 'home' | 'lobby' | 'tournament';
type Tab = 'partidos' | 'juegos' | 'jugadores';
type Kind = 'green' | 'blue' | 'red' | 'yellow' | 'ink' | 'ghost';

/* ───────── Tema ───────── */
const C = {
  bg: '#46178F',
  ink: '#1F1F2E',
  mute: '#8A8AA3',
  line: '#ECEBF3',
  win: '#E7F6E2',
  red: '#E21B3C',
  blue: '#1368CE',
  yellow: '#FFA602',
  green: '#26890C',
  white: '#FFFFFF',
};
const AVATAR = [C.red, C.blue, C.yellow, C.green, '#864CBF', '#0AA3A3'];
const BTN: Record<Kind, [string, string]> = {
  green: [C.green, '#1A5E07'],
  blue: [C.blue, '#0C4A94'],
  red: [C.red, '#A81229'],
  yellow: [C.yellow, '#C47F00'],
  ink: [C.ink, '#0A0A12'],
  ghost: ['rgba(255,255,255,0.16)', 'rgba(0,0,0,0.22)'],
};
const TOP = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) + 12 : 56;
const TAB_LABEL: Record<Tab, string> = {
  partidos: '⚔️ PARTIDOS',
  juegos: '🎮 JUEGOS',
  jugadores: '👥 JUGADORES',
};

/* ───────── Sesión guardada en el móvil ───────── */
const SESSION_KEY = 'torneo:session';
const saveSession = (s: Session) =>
  AsyncStorage.setItem(SESSION_KEY, JSON.stringify(s)).catch(() => {});
const clearSession = () => AsyncStorage.removeItem(SESSION_KEY).catch(() => {});
const loadSession = async (): Promise<Session | null> => {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
};

/* ───────── Helpers ───────── */
const initial = (n = '?') => n.trim().charAt(0).toUpperCase() || '?';
const colorFor = (n = '') =>
  AVATAR[[...n].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR.length];

const phaseName = (phase: Phase) => {
  switch (phase) {
    case 'CLASIFICACION':
      return 'CLASIFICACIÓN';
    case 'REPESCA':
      return 'REPESCA';
    case 'ELIMINATORIA':
      return 'ELIMINATORIA';
    case 'FINISHED':
      return 'FINALIZADO';
    default:
      return 'LOBBY';
  }
};

const stageLabel = (stage: Stage, roundName?: string, round?: number) =>
  stage === 'eliminatoria'
    ? (roundName ?? 'ELIMINATORIA')
    : stage === 'repesca'
      ? 'REPESCA'
      : `CLASIFICACIÓN${round ? ` · RONDA ${round}` : ''}`;

/* ───────── Componentes pequeños ───────── */
function Btn({
  label,
  kind = 'green',
  onPress,
  disabled,
}: {
  label: string;
  kind?: Kind;
  onPress: () => void;
  disabled?: boolean;
}) {
  const [bg, edge] = BTN[kind];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.btn,
        {
          backgroundColor: bg,
          borderBottomColor: edge,
          borderBottomWidth: pressed ? 1 : 5,
          marginTop: pressed ? 4 : 0,
        },
        disabled && s.disabled,
      ]}
    >
      <Text style={s.btnText}>{label}</Text>
    </Pressable>
  );
}

const Avatar = ({ name, size = 38 }: { name?: string; size?: number }) => (
  <View
    style={{
      width: size,
      height: size,
      borderRadius: size / 2,
      backgroundColor: colorFor(name),
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    <Text style={{ color: C.white, fontWeight: '900', fontSize: size * 0.45 }}>
      {initial(name)}
    </Text>
  </View>
);

const ConnPill = ({ connected }: { connected: boolean }) => (
  <View style={s.conn}>
    <View style={[s.dot, { backgroundColor: connected ? '#5EE17A' : C.red }]} />
    <Text style={s.connTxt}>{connected ? 'En línea' : 'Sin conexión'}</Text>
  </View>
);

function Pop({ children, style }: { children: React.ReactNode; style?: object }) {
  const scale = useRef(new Animated.Value(0.85)).current;
  useEffect(() => {
    Animated.spring(scale, { toValue: 1, friction: 6, useNativeDriver: true }).start();
  }, [scale]);
  return <Animated.View style={[{ transform: [{ scale }] }, style]}>{children}</Animated.View>;
}

function Pulse({ children }: { children: React.ReactNode }) {
  const opacity = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 850, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.55, duration: 850, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}

function MatchCard({
  match,
  host,
  onScore,
  onGame,
}: {
  match: Match;
  host: boolean;
  onScore: () => void;
  onGame: () => void;
}) {
  const ready = !!match.player1 && !!match.player2 && !match.played;

  const row = (p: PublicPlayer | null, score: number) => {
    const isWinner = !!p && match.winnerId === p.id;
    return (
      <View style={[s.playerRow, isWinner && s.winnerRow]}>
        {p ? <Avatar name={p.nickname} size={32} /> : <View style={s.emptyAvatar} />}
        <Text
          style={[s.playerName, isWinner && s.winnerName, p?.left && s.leftName]}
          numberOfLines={1}
        >
          {p ? p.nickname + (p.left ? ' (salió)' : '') : 'Por definir'}
        </Text>
        <Text style={s.score}>{match.played ? score : '–'}</Text>
      </View>
    );
  };

  return (
    <View style={s.matchCard}>
      <View style={s.matchHeader}>
        <Text style={s.stageText}>{stageLabel(match.stage, match.roundName, match.round)}</Text>
        {match.forfeit && <Text style={s.forfeit}>FORFAIT</Text>}
      </View>

      <Pressable disabled={!host || match.played} onPress={onGame} style={s.gameBox}>
        <Text style={match.game ? s.gameText : s.noGame}>
          {match.game ? `🎮 ${match.game}` : host ? '🎮 ASIGNAR JUEGO' : '🎮 SIN JUEGO'}
        </Text>
      </Pressable>

      {row(match.player1, match.score1)}
      <View style={s.sep} />
      {row(match.player2, match.score2)}

      {host && ready && (
        <Pressable
          onPress={onScore}
          disabled={!match.game}
          style={[s.resultButton, !match.game && s.disabled]}
        >
          <Text style={s.resultButtonText}>
            {match.game ? 'ANOTAR RESULTADO' : 'ASIGNA UN JUEGO PRIMERO'}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

/* ───────── App ───────── */
export default function App() {
  const [booting, setBooting] = useState(true);
  const [screen, setScreen] = useState<Screen>('home');
  const [pin, setPin] = useState('');
  const [nickname, setNickname] = useState('');
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [playerState, setPlayerState] = useState<PlayerState | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [connected, setConnected] = useState(socket.connected);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('partidos');

  const [scoringId, setScoringId] = useState<string | null>(null);
  const [sc1, setSc1] = useState(0);
  const [sc2, setSc2] = useState(0);
  const [gameMatchId, setGameMatchId] = useState<string | null>(null);
  const [newGame, setNewGame] = useState('');

  const sessionRef = useRef<Session | null>(null);
  const activePinRef = useRef('');

  /* Estado local ↔ servidor */
  const applySnapshot = (next: Snapshot) => {
    if (!next) return;
    setSnap(next);
    setPin(next.pin);
    setScreen(next.phase === 'LOBBY' ? 'lobby' : 'tournament');
  };

  const resetLocal = () => {
    sessionRef.current = null;
    activePinRef.current = '';
    clearSession();
    setBooting(false);
    setScreen('home');
    setPin('');
    setSnap(null);
    setPlayerState(null);
    setIsHost(false);
    setScoringId(null);
    setGameMatchId(null);
    setTab('partidos');
  };

  const enter = (session: Session, next: Snapshot, state?: PlayerState | null) => {
    sessionRef.current = session;
    activePinRef.current = session.pin;
    saveSession(session);
    setIsHost(session.role === 'host');
    setPlayerState(state ?? null);
    applySnapshot(next);
  };

  /* ───────── Socket ───────── */
  useEffect(() => {
    // Vuelve a identificarse con el token tras cada (re)conexión.
    const rejoin = () => {
      const session = sessionRef.current;
      if (!session) return;
      socket.emit('session:rejoin', session, (res: any) => {
        setBooting(false);
        if (!res?.success) {
          Alert.alert('Sesión finalizada', res?.error ?? 'Ya no puedes volver a este torneo.');
          resetLocal();
          return;
        }
        activePinRef.current = res.pin;
        setIsHost(res.role === 'host');
        if (res.role === 'player') setNickname(session.nickname ?? '');
        setPlayerState(res.state ?? null);
        applySnapshot(res.snapshot);
      });
    };

    const onConnect = () => {
      setConnected(true);
      rejoin();
    };
    const onDisconnect = () => setConnected(false);
    const onUpdated = (next: Snapshot) => {
      if (next?.pin === activePinRef.current) applySnapshot(next);
    };
    const onState = (state: PlayerState) => setPlayerState(state);
    const onKicked = (data: any) => {
      Alert.alert('Expulsado', data?.message ?? 'Has sido expulsado del torneo.');
      resetLocal();
    };
    const onClosed = (data: any) => {
      Alert.alert('Torneo cerrado', data?.message ?? 'El anfitrión cerró el torneo.');
      resetLocal();
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('tournament:updated', onUpdated);
    socket.on('player:state', onState);
    socket.on('player:kicked', onKicked);
    socket.on('tournament:closed', onClosed);

    (async () => {
      const saved = await loadSession();
      if (!saved) {
        setBooting(false);
        return;
      }
      sessionRef.current = saved;
      if (socket.connected) rejoin();
    })();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('tournament:updated', onUpdated);
      socket.off('player:state', onState);
      socket.off('player:kicked', onKicked);
      socket.off('tournament:closed', onClosed);
    };
  }, []);

  /* ───────── Acciones ───────── */
  const hostEmit = (
    event: string,
    payload: object,
    onOk?: (res: any) => void,
    title = 'Error',
  ) => {
    socket.emit(event, { pin, ...payload }, (res: any) => {
      if (!res?.success) {
        Alert.alert(title, res?.error ?? 'No se pudo completar la acción.');
        return;
      }
      onOk?.(res);
    });
  };

  const createTournament = () => {
    setBusy(true);
    socket.timeout(8000).emit('host:create', (err: any, res: any) => {
      setBusy(false);
      if (err || !res?.success) {
        Alert.alert('Error', res?.error ?? 'No se pudo crear el torneo. Revisa la conexión.');
        return;
      }
      enter({ pin: res.pin, role: 'host', token: res.hostToken }, res.snapshot);
    });
  };

  const joinTournament = () => {
    const cleanPin = pin.trim();
    const nick = nickname.trim();
    if (!cleanPin || !nick) {
      Alert.alert('Faltan datos', 'Introduce el PIN y tu apodo.');
      return;
    }
    setBusy(true);
    socket
      .timeout(8000)
      .emit('player:join', { pin: cleanPin, nickname: nick }, (err: any, res: any) => {
        setBusy(false);
        if (err || !res) {
          Alert.alert('Sin respuesta', 'El servidor no responde. Revisa la conexión.');
          return;
        }
        if (!res.success) {
          Alert.alert('No puedes entrar', res.error ?? 'No se pudo entrar al torneo.');
          return;
        }
        enter(
          { pin: res.pin, role: 'player', playerId: res.playerId, token: res.token, nickname: nick },
          res.snapshot,
          res.state,
        );
      });
  };

  const startTournament = () => hostEmit('host:start', {}, undefined, 'No se puede iniciar');
  const lockClassification = () =>
    hostEmit('host:lockClassification', {}, undefined, 'No se puede cerrar');

  const openScore = (m: Match) => {
    setSc1(m.score1 ?? 0);
    setSc2(m.score2 ?? 0);
    setScoringId(m.id);
  };

  const confirmScore = () => {
    if (!scoringId) return;
    if (sc1 === sc2) {
      Alert.alert('Marcador inválido', 'No puede haber empate.');
      return;
    }
    if (sc1 !== 2 && sc2 !== 2) {
      Alert.alert('Marcador inválido', 'Uno de los jugadores debe llegar a 2.');
      return;
    }
    hostEmit('host:setResult', { matchId: scoringId, score1: sc1, score2: sc2 }, () =>
      setScoringId(null),
    );
  };

  const addGame = () => {
    const clean = newGame.trim();
    if (!clean) return;
    hostEmit('host:addGame', { game: clean }, () => setNewGame(''), 'No se pudo añadir');
  };

  const removeGame = (game: string) => {
    Alert.alert('Eliminar juego', `¿Eliminar "${game}" de la lista?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: () => hostEmit('host:removeGame', { game }, undefined, 'No se pudo eliminar'),
      },
    ]);
  };

  const assignGame = (matchId: string, game: string) =>
    hostEmit('host:assignGame', { matchId, game }, () => setGameMatchId(null));

  const rerollGame = () => {
    if (!gameMatchId) return;
    hostEmit('host:rerollGame', { matchId: gameMatchId }, (res) => {
      setGameMatchId(null);
      Alert.alert('🎲 Juego sorteado', res.game);
    });
  };

  const kickPlayer = (player: PublicPlayer) => {
    Alert.alert('Expulsar jugador', `¿Seguro que quieres expulsar a ${player.nickname}?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Expulsar',
        style: 'destructive',
        onPress: () =>
          hostEmit('host:kick', { playerId: player.id }, undefined, 'No se pudo expulsar'),
      },
    ]);
  };

  const leave = () => {
    if (isHost) {
      Alert.alert('Cerrar torneo', 'Se cerrará para todos los jugadores. ¿Seguro?', [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Cerrar',
          style: 'destructive',
          onPress: () => {
            socket.emit('host:close', { pin });
            resetLocal();
          },
        },
      ]);
      return;
    }

    const doLeave = () => {
      socket.emit('player:leave', {});
      resetLocal();
    };

    if (snap && snap.phase !== 'LOBBY' && snap.phase !== 'FINISHED') {
      Alert.alert('Salir del torneo', 'Si sales perderás tus partidos pendientes.', [
        { text: 'Quedarme', style: 'cancel' },
        { text: 'Salir', style: 'destructive', onPress: doLeave },
      ]);
      return;
    }
    doLeave();
  };

  /* ───────── Derivados ───────── */
  const phase: Phase = snap?.phase ?? 'LOBBY';
  const players = snap?.players ?? [];
  const games = snap?.games ?? [];
  const matches = snap?.matches ?? [];
  const standings = snap?.standings ?? [];
  const plan = snap?.plan ?? null;
  const champion = snap?.champion ?? null;

  const scoring = matches.find((m) => m.id === scoringId) ?? null;
  const gameMatch = matches.find((m) => m.id === gameMatchId) ?? null;

  const byStage = useMemo(
    () => ({
      clasificacion: matches.filter((m) => m.stage === 'clasificacion'),
      repesca: matches.filter((m) => m.stage === 'repesca'),
      eliminatoria: matches.filter((m) => m.stage === 'eliminatoria'),
    }),
    [matches],
  );

  const eliminationRounds = useMemo(() => {
    const groups: Record<number, Match[]> = {};
    byStage.eliminatoria.forEach((m) => {
      (groups[m.round] = groups[m.round] || []).push(m);
    });
    return Object.entries(groups)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([round, list]) => ({ round: Number(round), matches: list }));
  }, [byStage.eliminatoria]);

  const classificationPending = byStage.clasificacion.some((m) => !m.played);

  const card = (m: Match) => (
    <MatchCard
      key={m.id}
      match={m}
      host={isHost}
      onScore={() => openScore(m)}
      onGame={() => setGameMatchId(m.id)}
    />
  );

  /* ───────── Bloques de la pantalla del torneo ───────── */
  const renderStandings = () => (
    <View style={s.section}>
      <Text style={s.sectionTitle}>📊 CLASIFICACIÓN</Text>

      {phase === 'CLASIFICACION' && plan && (
        <View style={s.planBox}>
          <Text style={s.planText}>🟢 {plan.direct} directos</Text>
          <Text style={s.planText}>🟡 {plan.repPlayers} repesca</Text>
          <Text style={s.planText}>🔴 {plan.out} eliminados</Text>
        </View>
      )}

      {standings.map((st) => (
        <View key={st.player.id} style={s.standingRow}>
          <Text style={s.position}>{st.position}</Text>
          <Avatar name={st.player.nickname} size={34} />
          <View style={s.standingInfo}>
            <Text style={s.standingName}>{st.player.nickname}</Text>
            <Text style={s.standingStats}>
              {st.wins} V · {st.losses} D · DIF {st.roundDifference}
            </Text>
          </View>
          <View
            style={[
              s.zoneBadge,
              st.zone === 'directo' && s.directBadge,
              st.zone === 'repesca' && s.repechageBadge,
              st.zone === 'fuera' && s.outBadge,
            ]}
          >
            <Text style={s.zoneText}>
              {st.zone === 'directo' ? 'DIRECTO' : st.zone === 'repesca' ? 'REPESCA' : 'FUERA'}
            </Text>
          </View>
        </View>
      ))}

      {isHost && phase === 'CLASIFICACION' && (
        <View style={s.lockButtonWrap}>
          <Btn
            label="🔒 CERRAR CLASIFICACIÓN"
            kind="yellow"
            onPress={lockClassification}
            disabled={classificationPending}
          />
          {classificationPending && (
            <Text style={s.warning}>
              Termina todos los partidos antes de cerrar la clasificación.
            </Text>
          )}
        </View>
      )}
    </View>
  );

  const renderPhase = () => (
    <>
      {phase !== 'LOBBY' && standings.length > 0 && renderStandings()}

      {phase === 'CLASIFICACION' && (
        <View style={s.section}>
          <Text style={s.sectionTitle}>⚔️ PARTIDOS</Text>
          {byStage.clasificacion.map(card)}
        </View>
      )}

      {phase === 'REPESCA' && (
        <View style={s.section}>
          <Text style={s.sectionTitle}>⚡ REPESCA</Text>
          <Text style={s.description}>
            Los jugadores de la zona de repesca se enfrentan al mejor de 3. Los ganadores entran en
            la eliminatoria.
          </Text>
          {byStage.repesca.map(card)}
        </View>
      )}

      {(phase === 'ELIMINATORIA' || phase === 'FINISHED') && (
        <View style={s.section}>
          <Text style={s.sectionTitle}>🏆 ELIMINATORIA</Text>
          {eliminationRounds.map((r) => (
            <View key={r.round}>
              <Text style={s.roundTitle}>{r.matches[0]?.roundName ?? `RONDA ${r.round}`}</Text>
              {r.matches.map(card)}
            </View>
          ))}
        </View>
      )}
    </>
  );

  const renderMyState = () => {
    const current = playerState?.currentMatch ?? null;
    const opponent = playerState?.opponent ?? null;
    const history = playerState?.history ?? [];
    const zone = playerState?.zone ?? null;

    const lost = history.some((h) => h.result === 'loss' && h.stage !== 'clasificacion');
    const out = zone === 'fuera' && phase !== 'CLASIFICACION';

    const softMessage = champion
      ? null
      : phase === 'CLASIFICACION'
        ? 'Esperando a que el anfitrión cierre la clasificación…'
        : out || lost
          ? 'Quedaste eliminado. ¡Gracias por jugar!'
          : 'Esperando tu próximo cruce…';

    return (
      <>
        {current && opponent ? (
          <Pop style={s.banner}>
            <Text style={s.bannerLbl}>
              Tu próximo rival · {stageLabel(current.stage, current.roundName, current.round)}
            </Text>
            <Text style={s.bannerName}>{opponent.nickname}</Text>
            <Text style={s.bannerGame}>🎮 {current.game ?? 'Juego por asignar'}</Text>
          </Pop>
        ) : (
          softMessage && (
            <View style={s.bannerSoft}>
              <Text style={s.bannerSoftTxt}>{softMessage}</Text>
            </View>
          )
        )}

        <View style={s.myState}>
          <Text style={s.cardTitle}>TU HISTORIAL DE RIVALES</Text>

          {zone && phase !== 'LOBBY' && (
            <Text style={s.zoneLine}>
              Zona:{' '}
              <Text
                style={{
                  color: zone === 'directo' ? C.green : zone === 'repesca' ? '#B27800' : C.red,
                }}
              >
                {zone.toUpperCase()}
              </Text>
            </Text>
          )}

          {history.length === 0 ? (
            <Text style={s.histMeta}>Aún no tienes partidos.</Text>
          ) : (
            history.map((h) => (
              <View key={h.matchId} style={s.histRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.histName}>vs {h.opponent?.nickname ?? '—'}</Text>
                  <Text style={s.histMeta}>
                    🎮 {h.game ?? 'Sin juego'} · {stageLabel(h.stage, h.roundName)}
                  </Text>
                </View>
                <Text
                  style={[
                    s.histRes,
                    h.result === 'win' && { color: C.green },
                    h.result === 'loss' && { color: C.red },
                  ]}
                >
                  {h.result === 'pending' ? 'Pendiente' : `${h.myScore}–${h.opponentScore}`}
                  {h.forfeit ? ' (F)' : ''}
                </Text>
              </View>
            ))
          )}
        </View>
      </>
    );
  };

  const renderGames = () => (
    <View style={s.section}>
      <Text style={s.sectionTitle}>🎮 JUEGOS</Text>
      <Text style={s.description}>
        Cada partido recibe un juego al azar de esta lista (sin repetirlo a los mismos rivales).
      </Text>

      <View style={s.addGameRow}>
        <TextInput
          style={s.gameInput}
          placeholder="Nuevo juego"
          placeholderTextColor={C.mute}
          value={newGame}
          onChangeText={setNewGame}
          maxLength={30}
          onSubmitEditing={addGame}
        />
        <Pressable style={s.addGameButton} onPress={addGame}>
          <Text style={s.addGameText}>+</Text>
        </Pressable>
      </View>

      {games.map((game) => (
        <View key={game} style={s.gameRow}>
          <Text style={s.gameRowText}>🎮 {game}</Text>
          <Pressable onPress={() => removeGame(game)}>
            <Text style={s.deleteText}>🗑️</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );

  const renderPlayersAdmin = () => (
    <View style={s.section}>
      <Text style={s.sectionTitle}>👥 JUGADORES</Text>
      {players.map((player) => (
        <View key={player.id} style={[s.adminPlayer, !player.connected && s.dim]}>
          <Avatar name={player.nickname} size={34} />
          <Text style={s.adminPlayerName}>
            {player.nickname}
            {!player.connected ? ' · sin conexión' : ''}
          </Text>
          <Pressable onPress={() => kickPlayer(player)} style={s.kickButton}>
            <Text style={s.kickButtonText}>EXPULSAR</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );

  /* ───────── ARRANQUE ───────── */
  if (booting) {
    return (
      <View style={[s.screen, s.center]}>
        <StatusBar barStyle="light-content" />
        <ConnPill connected={connected} />
        <Pulse>
          <Text style={s.waiting}>Conectando…</Text>
        </Pulse>
        <Pressable onPress={resetLocal}>
          <Text style={s.link}>Cancelar</Text>
        </Pressable>
      </View>
    );
  }

  /* ───────── HOME ───────── */
  if (screen === 'home') {
    return (
      <KeyboardAvoidingView
        style={s.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <StatusBar barStyle="light-content" />
        <ConnPill connected={connected} />

        <ScrollView contentContainerStyle={s.home} keyboardShouldPersistTaps="handled">
          <View style={s.logoRow}>
            {[C.red, C.blue, C.yellow, C.green].map((c) => (
              <View key={c} style={[s.logoSq, { backgroundColor: c }]} />
            ))}
          </View>
          <Text style={s.logo}>TORNEO</Text>
          <Text style={s.tag}>Compite. Gana. Repite.</Text>

          <View style={s.panel}>
            <TextInput
              style={[s.input, s.pinInput]}
              placeholder="PIN del torneo"
              placeholderTextColor={C.mute}
              keyboardType="number-pad"
              value={pin}
              onChangeText={setPin}
              maxLength={6}
            />
            <TextInput
              style={s.input}
              placeholder="Tu apodo"
              placeholderTextColor={C.mute}
              value={nickname}
              onChangeText={setNickname}
              maxLength={16}
              autoCapitalize="words"
            />
            <Btn label="UNIRSE" kind="ink" onPress={joinTournament} disabled={busy} />
          </View>

          <Text style={s.or}>¿Organizas tú?</Text>
          <View style={{ width: '100%' }}>
            <Btn label="CREAR TORNEO" kind="ghost" onPress={createTournament} disabled={busy} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  /* ───────── LOBBY ───────── */
  if (screen === 'lobby') {
    return (
      <View style={s.screen}>
        <StatusBar barStyle="light-content" />
        <View style={s.topBar}>
          <Pressable onPress={leave}>
            <Text style={s.link}>‹ Salir</Text>
          </Pressable>
          <ConnPill connected={connected} />
        </View>

        <ScrollView contentContainerStyle={s.lobby}>
          <Pop style={s.pinCard}>
            <Text style={s.pinLabel}>{isHost ? 'Comparte este PIN' : 'Estás dentro. PIN'}</Text>
            <Text style={s.pinNumber}>{pin}</Text>
          </Pop>

          <View style={s.countPill}>
            <Text style={s.countTxt}>
              {players.length} {players.length === 1 ? 'jugador' : 'jugadores'}
            </Text>
          </View>

          <View style={s.chips}>
            {players.map((player) => (
              <Pop key={player.id} style={[s.playerChip, !player.connected && s.dim]}>
                <Avatar name={player.nickname} size={30} />
                <Text style={s.chipName} numberOfLines={1}>
                  {player.nickname}
                </Text>
                {isHost && (
                  <Pressable onPress={() => kickPlayer(player)}>
                    <Text style={s.kickText}>✕</Text>
                  </Pressable>
                )}
              </Pop>
            ))}
          </View>

          {players.length === 0 && <Text style={s.empty}>Esperando a que se una la gente…</Text>}
        </ScrollView>

        <View style={s.footer}>
          {isHost ? (
            <>
              {players.length < 2 && (
                <Text style={s.warning}>Hacen falta al menos 2 jugadores</Text>
              )}
              <Btn label="INICIAR TORNEO" onPress={startTournament} disabled={players.length < 2} />
            </>
          ) : (
            <Pulse>
              <Text style={s.waiting}>Esperando a que el anfitrión comience…</Text>
            </Pulse>
          )}
        </View>
      </View>
    );
  }

  /* ───────── TORNEO ───────── */
  return (
    <View style={s.screen}>
      <StatusBar barStyle="light-content" />

      <View style={s.topBar}>
        <Pressable onPress={leave}>
          <Text style={s.link}>‹ Salir</Text>
        </Pressable>
        <View>
          <Text style={s.phase}>{phaseName(phase)}</Text>
          <Text style={s.pinSmall}>PIN {pin}</Text>
        </View>
        <ConnPill connected={connected} />
      </View>

      <ScrollView contentContainerStyle={s.tournament}>
        {champion && (
          <Pop style={s.champion}>
            <Text style={s.championTitle}>🏆 CAMPEÓN</Text>
            <Text style={s.championName}>{champion.nickname}</Text>
          </Pop>
        )}

        {isHost ? (
          <>
            <View style={s.tabs}>
              {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
                <Pressable
                  key={t}
                  onPress={() => setTab(t)}
                  style={[s.tab, tab === t && s.tabActive]}
                >
                  <Text style={[s.tabText, tab === t && s.tabTextActive]}>{TAB_LABEL[t]}</Text>
                </Pressable>
              ))}
            </View>
            {tab === 'partidos' && renderPhase()}
            {tab === 'juegos' && renderGames()}
            {tab === 'jugadores' && renderPlayersAdmin()}
          </>
        ) : (
          <>
            {renderMyState()}
            {renderPhase()}
          </>
        )}
      </ScrollView>

      {/* MODAL RESULTADO */}
      <Modal
        visible={!!scoring}
        transparent
        animationType="fade"
        onRequestClose={() => setScoringId(null)}
      >
        <View style={s.overlay}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>RESULTADO</Text>
            <Text style={s.modalGame}>🎮 {scoring?.game ?? 'Sin juego'}</Text>

            {[
              { p: scoring?.player1, v: sc1, set: setSc1 },
              { p: scoring?.player2, v: sc2, set: setSc2 },
            ].map((row, i) => (
              <View key={i} style={s.scorePlayer}>
                <Text style={s.scorePlayerName}>{row.p?.nickname}</Text>
                <View style={s.scoreControls}>
                  <Pressable style={s.scoreButton} onPress={() => row.set(Math.max(0, row.v - 1))}>
                    <Text style={s.scoreBtnTxt}>−</Text>
                  </Pressable>
                  <Text style={s.bigScore}>{row.v}</Text>
                  <Pressable style={s.scoreButton} onPress={() => row.set(Math.min(2, row.v + 1))}>
                    <Text style={s.scoreBtnTxt}>+</Text>
                  </Pressable>
                </View>
              </View>
            ))}

            <Btn
              label="GUARDAR RESULTADO"
              onPress={confirmScore}
              disabled={sc1 === sc2 || (sc1 !== 2 && sc2 !== 2)}
            />
            <Pressable onPress={() => setScoringId(null)}>
              <Text style={s.cancel}>Cancelar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* MODAL JUEGO */}
      <Modal
        visible={!!gameMatch}
        transparent
        animationType="fade"
        onRequestClose={() => setGameMatchId(null)}
      >
        <View style={s.overlay}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>🎮 JUEGO DEL PARTIDO</Text>
            {gameMatch?.game && <Text style={s.modalGame}>Actual: {gameMatch.game}</Text>}

            <Btn label="🎲 SORTEAR OTRO" kind="yellow" onPress={rerollGame} />

            <Text style={s.orModal}>O selecciona manualmente</Text>

            <ScrollView style={s.gameListModal}>
              {games.map((game) => (
                <Pressable
                  key={game}
                  style={s.selectGame}
                  onPress={() => gameMatch && assignGame(gameMatch.id, game)}
                >
                  <Text style={s.selectGameText}>🎮 {game}</Text>
                </Pressable>
              ))}
            </ScrollView>

            <Pressable onPress={() => setGameMatchId(null)}>
              <Text style={s.cancel}>Cancelar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/* ───────── Estilos ───────── */
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 18 },
  disabled: { opacity: 0.45 },
  dim: { opacity: 0.45 },

  conn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.22)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, position: 'absolute', top: TOP - 8, right: 16, zIndex: 10 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  connTxt: { color: C.white, fontSize: 12, fontWeight: '700' },

  home: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 24, paddingTop: TOP + 20 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  logoSq: { width: 22, height: 22, borderRadius: 6, transform: [{ rotate: '45deg' }] },
  logo: { color: C.white, fontSize: 52, fontWeight: '900', letterSpacing: 5 },
  tag: { color: 'rgba(255,255,255,0.7)', marginTop: 5, marginBottom: 30 },
  panel: { width: '100%', backgroundColor: C.white, borderRadius: 18, padding: 16, gap: 12 },
  input: { backgroundColor: '#F4F3F9', borderWidth: 2, borderColor: C.line, borderRadius: 10, padding: 14, color: C.ink, fontSize: 17, fontWeight: '600' },
  pinInput: { textAlign: 'center', fontSize: 25, fontWeight: '900', letterSpacing: 5 },
  or: { color: 'rgba(255,255,255,0.65)', marginVertical: 18 },

  btn: { width: '100%', paddingVertical: 15, borderRadius: 10, alignItems: 'center', borderBottomWidth: 5 },
  btnText: { color: C.white, fontSize: 16, fontWeight: '900' },

  topBar: { paddingTop: TOP - 8, paddingHorizontal: 16, height: TOP + 38, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  link: { color: C.white, fontSize: 17, fontWeight: '800' },

  lobby: { padding: 20 },
  pinCard: { backgroundColor: C.white, borderRadius: 18, padding: 24, alignItems: 'center', marginBottom: 24 },
  pinLabel: { color: C.mute, fontWeight: '700' },
  pinNumber: { color: C.ink, fontSize: 52, fontWeight: '900', letterSpacing: 8 },
  countPill: { alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 7, marginBottom: 18 },
  countTxt: { color: C.white, fontWeight: '800', fontSize: 15 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 },
  playerChip: { backgroundColor: C.white, borderRadius: 14, padding: 9, marginBottom: 9, flexDirection: 'row', alignItems: 'center', gap: 10, maxWidth: 220 },
  chipName: { flexShrink: 1, color: C.ink, fontWeight: '800', fontSize: 16 },
  kickText: { color: C.red, fontSize: 20, fontWeight: '900', padding: 8 },
  empty: { color: 'rgba(255,255,255,0.65)', textAlign: 'center', marginTop: 30 },

  footer: { padding: 20, paddingBottom: 30, backgroundColor: 'rgba(0,0,0,0.18)' },
  waiting: { color: C.white, textAlign: 'center', fontWeight: '800', padding: 10 },
  warning: { color: '#FFD8DE', textAlign: 'center', marginBottom: 8, fontSize: 12, fontWeight: '700' },

  tournament: { padding: 18, paddingBottom: 50 },
  phase: { color: C.white, fontWeight: '900', textAlign: 'center' },
  pinSmall: { color: 'rgba(255,255,255,0.6)', textAlign: 'center', fontSize: 11 },

  tabs: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.22)', alignItems: 'center' },
  tabActive: { backgroundColor: C.white },
  tabText: { color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: '900' },
  tabTextActive: { color: C.ink },

  section: { backgroundColor: 'rgba(0,0,0,0.15)', borderRadius: 16, padding: 14, marginBottom: 18 },
  sectionTitle: { color: C.white, fontSize: 20, fontWeight: '900', marginBottom: 12 },
  description: { color: 'rgba(255,255,255,0.75)', marginBottom: 15, lineHeight: 20 },
  roundTitle: { color: C.white, fontSize: 18, fontWeight: '900', marginBottom: 10, marginTop: 10 },

  planBox: { backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 12, padding: 12, marginBottom: 15, gap: 4 },
  planText: { color: C.white, fontWeight: '700' },
  standingRow: { backgroundColor: C.white, borderRadius: 12, padding: 8, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  position: { width: 25, color: C.mute, fontWeight: '900', textAlign: 'center' },
  standingInfo: { flex: 1 },
  standingName: { color: C.ink, fontWeight: '800', fontSize: 15 },
  standingStats: { color: C.mute, fontSize: 12, marginTop: 2 },
  zoneBadge: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8 },
  directBadge: { backgroundColor: '#DDF5D8' },
  repechageBadge: { backgroundColor: '#FFF0C9' },
  outBadge: { backgroundColor: '#FFD9DF' },
  zoneText: { color: C.ink, fontSize: 9, fontWeight: '900' },
  lockButtonWrap: { marginTop: 15 },

  matchCard: { backgroundColor: C.white, borderRadius: 14, padding: 8, marginBottom: 12 },
  matchHeader: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 5, paddingBottom: 5 },
  stageText: { color: C.mute, fontSize: 10, fontWeight: '900' },
  forfeit: { color: C.red, fontSize: 10, fontWeight: '900' },
  gameBox: { backgroundColor: '#F4F3F9', borderRadius: 9, padding: 9, marginBottom: 5 },
  gameText: { color: C.blue, textAlign: 'center', fontWeight: '900' },
  noGame: { color: C.red, textAlign: 'center', fontWeight: '900' },
  playerRow: { flexDirection: 'row', alignItems: 'center', padding: 7, borderRadius: 9, gap: 9 },
  winnerRow: { backgroundColor: C.win },
  playerName: { flex: 1, color: C.ink, fontSize: 16, fontWeight: '600' },
  winnerName: { fontWeight: '900' },
  leftName: { color: C.mute },
  score: { color: C.ink, fontSize: 21, fontWeight: '900', minWidth: 25, textAlign: 'right' },
  emptyAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.line },
  sep: { height: 1, backgroundColor: C.line, marginHorizontal: 8 },
  resultButton: { backgroundColor: C.ink, padding: 11, borderRadius: 9, marginTop: 6, alignItems: 'center' },
  resultButtonText: { color: C.white, fontSize: 12, fontWeight: '900' },

  addGameRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  gameInput: { flex: 1, backgroundColor: C.white, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, color: C.ink },
  addGameButton: { width: 46, borderRadius: 10, backgroundColor: C.green, justifyContent: 'center', alignItems: 'center' },
  addGameText: { color: C.white, fontSize: 25, fontWeight: '900' },
  gameRow: { backgroundColor: C.white, borderRadius: 9, padding: 10, marginBottom: 6, flexDirection: 'row', alignItems: 'center' },
  gameRowText: { flex: 1, color: C.ink, fontWeight: '700' },
  deleteText: { fontSize: 18 },

  adminPlayer: { backgroundColor: C.white, borderRadius: 11, padding: 8, marginBottom: 7, flexDirection: 'row', alignItems: 'center', gap: 9 },
  adminPlayerName: { flex: 1, color: C.ink, fontWeight: '800' },
  kickButton: { backgroundColor: '#FFDDE3', paddingHorizontal: 9, paddingVertical: 7, borderRadius: 8 },
  kickButtonText: { color: C.red, fontSize: 10, fontWeight: '900' },

  banner: { backgroundColor: C.yellow, borderRadius: 16, padding: 18, alignItems: 'center', marginBottom: 18 },
  bannerLbl: { color: 'rgba(31,31,46,0.7)', fontWeight: '700', fontSize: 13 },
  bannerName: { color: C.ink, fontWeight: '900', fontSize: 30, marginTop: 2 },
  bannerGame: { color: C.ink, fontWeight: '800', fontSize: 16, marginTop: 6 },
  bannerSoft: { backgroundColor: 'rgba(0,0,0,0.22)', borderRadius: 12, padding: 14, marginBottom: 18 },
  bannerSoftTxt: { color: C.white, textAlign: 'center', fontWeight: '600' },

  myState: { backgroundColor: C.white, borderRadius: 14, padding: 15, marginBottom: 18 },
  cardTitle: { color: C.ink, fontSize: 15, fontWeight: '900', marginBottom: 8 },
  zoneLine: { color: C.ink, fontWeight: '800', marginBottom: 8 },
  histRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: C.line },
  histName: { color: C.ink, fontWeight: '800', fontSize: 15 },
  histMeta: { color: C.mute, fontSize: 12, marginTop: 2 },
  histRes: { color: C.mute, fontWeight: '900', fontSize: 15 },

  champion: { backgroundColor: C.yellow, borderRadius: 18, padding: 20, alignItems: 'center', marginBottom: 18 },
  championTitle: { color: C.ink, fontWeight: '900', fontSize: 15 },
  championName: { color: C.ink, fontWeight: '900', fontSize: 30, marginTop: 3 },

  overlay: { flex: 1, backgroundColor: 'rgba(15,5,35,0.7)', justifyContent: 'center', padding: 20 },
  modal: { backgroundColor: C.white, borderRadius: 20, padding: 20, maxHeight: '85%' },
  modalTitle: { color: C.ink, fontSize: 23, fontWeight: '900', marginBottom: 8 },
  modalGame: { color: C.blue, fontWeight: '800', marginBottom: 15 },
  scorePlayer: { paddingVertical: 10 },
  scorePlayerName: { color: C.ink, fontSize: 17, fontWeight: '800', marginBottom: 7 },
  scoreControls: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 18 },
  scoreButton: { width: 45, height: 45, borderRadius: 23, backgroundColor: '#F0EFF6', justifyContent: 'center', alignItems: 'center' },
  scoreBtnTxt: { color: C.ink, fontSize: 24, fontWeight: '700', marginTop: -2 },
  bigScore: { color: C.ink, fontSize: 32, fontWeight: '900', minWidth: 40, textAlign: 'center' },
  cancel: { textAlign: 'center', color: C.mute, fontWeight: '800', padding: 15 },
  orModal: { color: C.mute, textAlign: 'center', marginVertical: 12 },
  gameListModal: { maxHeight: 350 },
  selectGame: { backgroundColor: '#F4F3F9', padding: 13, borderRadius: 10, marginBottom: 7 },
  selectGameText: { color: C.ink, fontWeight: '700' },
});