import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Animated, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StatusBar, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { socket } from './src/services/socket';

/* ───────── Tipos ───────── */
type Player = { id: string; nickname: string };
type Match = {
  id: string;
  round?: number;
  player1?: Player | null;
  player2?: Player | null;
  score1?: number | null;
  score2?: number | null;
  winnerId?: string | null;
};
type Screen = 'home' | 'lobby' | 'bracket';
type Kind = 'green' | 'blue' | 'red' | 'yellow' | 'ink' | 'ghost';

/* ───────── Tema ───────── */
const C = {
  bg: '#46178F', ink: '#1F1F2E', mute: '#8A8AA3', line: '#ECEBF3', win: '#E7F6E2',
  red: '#E21B3C', blue: '#1368CE', yellow: '#FFA602', green: '#26890C', white: '#FFFFFF',
};
const AVATAR = [C.red, C.blue, C.yellow, C.green, '#864CBF', '#0AA3A3'];
const BTN: Record<Kind, [string, string]> = {
  green: [C.green, '#1A5E07'], blue: [C.blue, '#0C4A94'], red: [C.red, '#A81229'],
  yellow: [C.yellow, '#C47F00'], ink: [C.ink, '#0A0A12'],
  ghost: ['rgba(255,255,255,0.16)', 'rgba(0,0,0,0.22)'],
};
const TOP = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) + 12 : 56;

/* ───────── Helpers ───────── */
const initial = (n = '?') => n.trim().charAt(0).toUpperCase() || '?';
const colorFor = (n = '') => AVATAR[[...n].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR.length];
const toMatches = (d: any): Match[] => (Array.isArray(d) ? d : d?.matches ?? []);
const winnerOf = (m: Match) =>
  m.winnerId ??
  (m.score1 != null && m.score2 != null && m.score1 !== m.score2
    ? m.score1 > m.score2 ? m.player1?.id : m.player2?.id
    : undefined);
const roundLabel = (i: number, total: number) => {
  const fromEnd = total - 1 - i;
  return fromEnd === 0 ? 'Final' : fromEnd === 1 ? 'Semifinal' : fromEnd === 2 ? 'Cuartos' : `Ronda ${i + 1}`;
};

/* ───────── Componentes pequeños ───────── */
function Btn({ label, kind = 'green', onPress, disabled }:
  { label: string; kind?: Kind; onPress: () => void; disabled?: boolean }) {
  const [bg, edge] = BTN[kind];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.btn,
        { backgroundColor: bg, borderBottomColor: edge, borderBottomWidth: pressed ? 1 : 5, marginTop: pressed ? 4 : 0 },
        disabled && { opacity: 0.45 },
      ]}
    >
      <Text style={s.btnText}>{label}</Text>
    </Pressable>
  );
}

const Avatar = ({ name, size = 36 }: { name?: string; size?: number }) => (
  <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colorFor(name), alignItems: 'center', justifyContent: 'center' }}>
    <Text style={{ color: C.white, fontWeight: '800', fontSize: size * 0.45 }}>{initial(name)}</Text>
  </View>
);

function Pop({ children, style }: { children: React.ReactNode; style?: object }) {
  const scale = useRef(new Animated.Value(0.8)).current;
  useEffect(() => {
    Animated.spring(scale, { toValue: 1, friction: 5, useNativeDriver: true }).start();
  }, [scale]);
  return <Animated.View style={[{ transform: [{ scale }] }, style]}>{children}</Animated.View>;
}

function Pulse({ children }: { children: React.ReactNode }) {
  const o = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(o, { toValue: 1, duration: 900, useNativeDriver: true }),
      Animated.timing(o, { toValue: 0.4, duration: 900, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [o]);
  return <Animated.View style={{ opacity: o }}>{children}</Animated.View>;
}

const ConnPill = ({ on }: { on: boolean }) => (
  <View style={s.conn}>
    <View style={[s.dot, { backgroundColor: on ? '#5EE17A' : C.red }]} />
    <Text style={s.connTxt}>{on ? 'En línea' : 'Sin conexión'}</Text>
  </View>
);

const Stepper = ({ value, onChange }: { value: number; onChange: (n: number) => void }) => (
  <View style={s.stepper}>
    <Pressable style={s.stepBtn} onPress={() => onChange(Math.max(0, value - 1))}><Text style={s.stepTxt}>−</Text></Pressable>
    <Text style={s.stepVal}>{value}</Text>
    <Pressable style={s.stepBtn} onPress={() => onChange(value + 1)}><Text style={s.stepTxt}>+</Text></Pressable>
  </View>
);

function MatchCard({ m, mine, host, onPress }:
  { m: Match; mine: boolean; host: boolean; onPress: () => void }) {
  const win = winnerOf(m);
  const ready = !!(m.player1 && m.player2);
  const row = (p?: Player | null, score?: number | null) => {
    const isWin = !!p && win === p.id;
    return (
      <View style={[s.pRow, isWin && { backgroundColor: C.win }]}>
        {p ? <Avatar name={p.nickname} size={30} /> : <View style={s.ghostDot} />}
        <Text style={[s.pName, !p && { color: C.mute }, isWin && { fontWeight: '800' }]} numberOfLines={1}>
          {p ? p.nickname : 'Por definir'}
        </Text>
        {isWin ? <Text style={s.check}>✓</Text> : null}
        <Text style={s.pScore}>{score ?? '–'}</Text>
      </View>
    );
  };
  return (
    <Pressable disabled={!host || !ready} onPress={onPress} style={[s.card, mine && s.cardMine]}>
      {row(m.player1, m.score1)}
      <View style={s.sep} />
      {row(m.player2, m.score2)}
      {host && ready && !win ? <Text style={s.hint}>Toca para anotar el resultado</Text> : null}
    </Pressable>
  );
}

/* ───────── App ───────── */
export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [pin, setPin] = useState('');
  const [nickname, setNickname] = useState('');
  const [players, setPlayers] = useState<Player[]>([]);
  const [isHost, setIsHost] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [champion, setChampion] = useState<string | null>(null);
  const [connected, setConnected] = useState(socket.connected);
  const [scoring, setScoring] = useState<Match | null>(null);
  const [sc1, setSc1] = useState(0);
  const [sc2, setSc2] = useState(0);

  useEffect(() => {
    const onLobby = (p: Player[]) => setPlayers(p);
    const onStart = (d: any) => { setMatches(toMatches(d)); setScreen('bracket'); };
    const onBracket = (d: any) => setMatches(toMatches(d));
    const onEnd = (d: any) => setChampion(d?.winner?.nickname ?? d?.winner ?? null);
    const onConn = () => setConnected(true);
    const onDisc = () => setConnected(false);

    socket.on('lobby:update', onLobby);
    socket.on('tournament:started', onStart);
    socket.on('bracket:update', onBracket);
    socket.on('tournament:end', onEnd);
    socket.on('connect', onConn);
    socket.on('disconnect', onDisc);
    return () => {
      socket.off('lobby:update', onLobby);
      socket.off('tournament:started', onStart);
      socket.off('bracket:update', onBracket);
      socket.off('tournament:end', onEnd);
      socket.off('connect', onConn);
      socket.off('disconnect', onDisc);
    };
  }, []);

  /* Acciones */
  const createTournament = () => {
    socket.emit('host:create', (res: { pin: string }) => {
      if (res?.pin) { setPin(res.pin); setIsHost(true); setScreen('lobby'); }
      else Alert.alert('No se pudo crear', 'Revisa la conexión con el servidor e inténtalo de nuevo.');
    });
  };

  const joinTournament = () => {
    if (!pin.trim() || !nickname.trim()) {
      Alert.alert('Faltan datos', 'Escribe el PIN y tu apodo para entrar.');
      return;
    }
    socket.emit('player:join', { pin: pin.trim(), nickname: nickname.trim() }, (res: any) => {
      if (res?.error) { Alert.alert('No pudiste entrar', res.error); return; }
      setMyId(res?.playerId ?? res?.player?.id ?? socket.id ?? null);
      setScreen('lobby');
    });
  };

  const startTournament = () => socket.emit('host:start', { pin });

  const openScore = (m: Match) => { setSc1(m.score1 ?? 0); setSc2(m.score2 ?? 0); setScoring(m); };
  const confirmScore = () => {
    if (!scoring || sc1 === sc2) return;
    socket.emit('host:setResult', { pin, matchId: scoring.id, score1: sc1, score2: sc2 });
    setScoring(null);
  };

  const leave = () => {
    setScreen('home'); setPin(''); setPlayers([]); setMatches([]);
    setIsHost(false); setMyId(null); setChampion(null);
  };

  /* Derivados */
  const isMe = (p?: Player | null) => !!p && !isHost && (p.id === myId || p.nickname === nickname.trim());
  const myMatch = useMemo(
    () => matches.find((m) => !winnerOf(m) && m.player1 && m.player2 && (isMe(m.player1) || isMe(m.player2))),
    [matches, myId, nickname, isHost],
  );
  const rival = myMatch ? (isMe(myMatch.player1) ? myMatch.player2 : myMatch.player1) : null;
  const eliminated = useMemo(
    () => matches.some((m) => winnerOf(m) && (isMe(m.player1) || isMe(m.player2)) &&
      !((isMe(m.player1) && winnerOf(m) === m.player1?.id) || (isMe(m.player2) && winnerOf(m) === m.player2?.id))),
    [matches, myId, nickname, isHost],
  );
  const rounds = useMemo(() => {
    const g: Record<number, Match[]> = {};
    matches.forEach((m) => { const k = m.round ?? 1; (g[k] = g[k] || []).push(m); });
    return Object.keys(g).map(Number).sort((a, b) => a - b).map((k) => g[k]);
  }, [matches]);

  /* ───────── HOME ───────── */
  if (screen === 'home') {
    return (
      <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <StatusBar barStyle="light-content" />
        <ConnPill on={connected} />
        <ScrollView contentContainerStyle={s.homeWrap} keyboardShouldPersistTaps="handled">
          <View style={s.logoRow}>
            {[C.red, C.blue, C.yellow, C.green].map((c) => <View key={c} style={[s.logoSq, { backgroundColor: c }]} />)}
          </View>
          <Text style={s.logo}>TORNEO</Text>
          <Text style={s.tag}>Compite. Gana. Repite.</Text>

          <View style={s.panel}>
            <TextInput
              style={[s.input, s.inputPin]}
              placeholder="PIN del torneo"
              placeholderTextColor={C.mute}
              value={pin}
              onChangeText={setPin}
              keyboardType="number-pad"
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
            <Btn label="Unirse" kind="ink" onPress={joinTournament} />
          </View>

          <Text style={s.or}>¿Organizas tú?</Text>
          <View style={{ width: '100%' }}>
            <Btn label="Crear torneo" kind="ghost" onPress={createTournament} />
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
          <Pressable onPress={leave}><Text style={s.link}>‹ Salir</Text></Pressable>
          <ConnPill on={connected} />
        </View>

        <ScrollView contentContainerStyle={s.lobbyWrap}>
          <Pop style={s.pinCard}>
            <Text style={s.pinLabel}>{isHost ? 'Comparte este PIN' : 'Estás dentro. PIN'}</Text>
            <Text style={s.pinNum}>{pin}</Text>
          </Pop>

          <View style={s.countPill}>
            <Text style={s.countTxt}>{players.length} {players.length === 1 ? 'jugador' : 'jugadores'}</Text>
          </View>

          <View style={s.chips}>
            {players.map((p) => (
              <Pop key={p.id} style={s.chip}>
                <Avatar name={p.nickname} size={26} />
                <Text style={s.chipTxt} numberOfLines={1}>{p.nickname}</Text>
              </Pop>
            ))}
          </View>
          {players.length === 0 && <Text style={s.empty}>Esperando a que se una la gente…</Text>}
        </ScrollView>

        <View style={s.footer}>
          {isHost ? (
            <>
              {players.length < 2 && <Text style={s.warn}>Hacen falta al menos 2 jugadores</Text>}
              <Btn label="Iniciar torneo" onPress={startTournament} disabled={players.length < 2} />
            </>
          ) : (
            <Pulse><Text style={s.wait}>Esperando a que el anfitrión comience…</Text></Pulse>
          )}
        </View>
      </View>
    );
  }

  /* ───────── CUADRO ───────── */
  return (
    <View style={s.screen}>
      <StatusBar barStyle="light-content" />
      <View style={s.topBar}>
        <Pressable onPress={leave}><Text style={s.link}>‹ Salir</Text></Pressable>
        <ConnPill on={connected} />
      </View>

      <ScrollView contentContainerStyle={s.bracketWrap}>
        <Text style={s.title}>Cuadro</Text>
        <Text style={s.sub}>PIN {pin}</Text>

        {champion ? (
          <Pop style={[s.banner, { backgroundColor: C.yellow }]}>
            <Text style={s.bannerLbl}>Campeón</Text>
            <Text style={s.bannerName}>🏆 {champion}</Text>
          </Pop>
        ) : isHost ? (
          <View style={s.bannerSoft}><Text style={s.bannerSoftTxt}>Toca un cruce para anotar el resultado.</Text></View>
        ) : rival ? (
          <Pop style={[s.banner, { backgroundColor: C.yellow }]}>
            <Text style={s.bannerLbl}>Tu próximo rival</Text>
            <Text style={s.bannerName}>{rival.nickname}</Text>
          </Pop>
        ) : (
          <View style={s.bannerSoft}>
            <Text style={s.bannerSoftTxt}>
              {eliminated ? 'Quedaste eliminado. ¡Gracias por jugar!' : 'Esperando tu próximo cruce…'}
            </Text>
          </View>
        )}

        {rounds.map((items, i) => (
          <View key={i} style={{ marginTop: 22 }}>
            <Text style={s.roundTitle}>{roundLabel(i, rounds.length)}</Text>
            {items.map((m) => (
              <MatchCard key={m.id} m={m} host={isHost} mine={m.id === myMatch?.id} onPress={() => openScore(m)} />
            ))}
          </View>
        ))}
      </ScrollView>

      <Modal visible={!!scoring} transparent animationType="fade" onRequestClose={() => setScoring(null)}>
        <View style={s.overlay}>
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>Resultado</Text>
            {[
              { p: scoring?.player1, v: sc1, set: setSc1 },
              { p: scoring?.player2, v: sc2, set: setSc2 },
            ].map((r, i) => (
              <View key={i} style={s.scoreRow}>
                <Avatar name={r.p?.nickname} size={34} />
                <Text style={s.scoreName} numberOfLines={1}>{r.p?.nickname}</Text>
                <Stepper value={r.v} onChange={r.set} />
              </View>
            ))}
            {sc1 === sc2 && <Text style={s.tie}>No puede haber empate. Ajusta el marcador.</Text>}
            <View style={{ marginTop: 14 }}>
              <Btn label="Confirmar ganador" onPress={confirmScore} disabled={sc1 === sc2} />
            </View>
            <Pressable onPress={() => setScoring(null)}><Text style={s.cancel}>Cancelar</Text></Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/* ───────── Estilos ───────── */
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },

  conn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.22)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, position: 'absolute', top: TOP - 8, right: 16, zIndex: 2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  connTxt: { color: C.white, fontSize: 12, fontWeight: '600' },

  homeWrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24, paddingTop: TOP + 20 },
  logoRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  logoSq: { width: 22, height: 22, borderRadius: 6, transform: [{ rotate: '45deg' }] },
  logo: { color: C.white, fontSize: 48, fontWeight: '900', letterSpacing: 4 },
  tag: { color: 'rgba(255,255,255,0.7)', fontSize: 15, marginTop: 4, marginBottom: 28 },
  panel: { width: '100%', backgroundColor: C.white, borderRadius: 16, padding: 16, gap: 12 },
  input: { backgroundColor: '#F4F3F9', borderRadius: 10, paddingVertical: 14, paddingHorizontal: 14, fontSize: 17, fontWeight: '600', color: C.ink, borderWidth: 2, borderColor: C.line },
  inputPin: { textAlign: 'center', fontSize: 24, letterSpacing: 6, fontWeight: '800' },
  or: { color: 'rgba(255,255,255,0.65)', marginVertical: 18, fontSize: 14 },

  btn: { width: '100%', paddingVertical: 15, borderRadius: 10, alignItems: 'center' },
  btnText: { color: C.white, fontSize: 17, fontWeight: '800' },

  topBar: { paddingTop: TOP - 8, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: TOP + 32 },
  link: { color: C.white, fontSize: 17, fontWeight: '700' },

  lobbyWrap: { alignItems: 'center', padding: 20 },
  pinCard: { backgroundColor: C.white, borderRadius: 16, paddingVertical: 20, paddingHorizontal: 32, alignItems: 'center', width: '100%' },
  pinLabel: { color: C.mute, fontSize: 14, fontWeight: '600' },
  pinNum: { color: C.ink, fontSize: 56, fontWeight: '900', letterSpacing: 8, marginTop: 4 },
  countPill: { backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 7, marginVertical: 18 },
  countTxt: { color: C.white, fontWeight: '800', fontSize: 15 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.white, borderRadius: 24, paddingVertical: 6, paddingLeft: 6, paddingRight: 14, maxWidth: 200 },
  chipTxt: { color: C.ink, fontWeight: '700', fontSize: 15, flexShrink: 1 },
  empty: { color: 'rgba(255,255,255,0.6)', marginTop: 24 },

  footer: { padding: 20, paddingBottom: 34, backgroundColor: 'rgba(0,0,0,0.18)', alignItems: 'center' },
  warn: { color: 'rgba(255,255,255,0.75)', marginBottom: 10, fontSize: 13 },
  wait: { color: C.white, fontSize: 16, fontWeight: '700', paddingVertical: 8 },

  bracketWrap: { padding: 20, paddingBottom: 50 },
  title: { color: C.white, fontSize: 32, fontWeight: '900' },
  sub: { color: 'rgba(255,255,255,0.65)', fontSize: 14, marginTop: 2, marginBottom: 16, letterSpacing: 1 },
  banner: { borderRadius: 16, padding: 18, alignItems: 'center' },
  bannerLbl: { color: 'rgba(31,31,46,0.7)', fontWeight: '700', fontSize: 14 },
  bannerName: { color: C.ink, fontWeight: '900', fontSize: 28, marginTop: 2 },
  bannerSoft: { backgroundColor: 'rgba(0,0,0,0.22)', borderRadius: 12, padding: 14 },
  bannerSoftTxt: { color: C.white, textAlign: 'center', fontWeight: '600' },
  roundTitle: { color: C.white, fontSize: 18, fontWeight: '800', marginBottom: 10 },

  card: { backgroundColor: C.white, borderRadius: 14, padding: 6, marginBottom: 12, borderWidth: 3, borderColor: 'transparent' },
  cardMine: { borderColor: C.yellow },
  pRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, borderRadius: 10 },
  ghostDot: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.line },
  pName: { flex: 1, color: C.ink, fontSize: 16, fontWeight: '600' },
  check: { color: C.green, fontWeight: '900', fontSize: 16 },
  pScore: { color: C.ink, fontWeight: '900', fontSize: 20, minWidth: 24, textAlign: 'right' },
  sep: { height: 1, backgroundColor: C.line, marginHorizontal: 8 },
  hint: { color: C.mute, fontSize: 12, textAlign: 'center', paddingTop: 6, paddingBottom: 4 },

  overlay: { flex: 1, backgroundColor: 'rgba(15,5,35,0.65)', justifyContent: 'center', padding: 24 },
  sheet: { backgroundColor: C.white, borderRadius: 20, padding: 20 },
  sheetTitle: { color: C.ink, fontSize: 22, fontWeight: '900', marginBottom: 14 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  scoreName: { flex: 1, color: C.ink, fontSize: 17, fontWeight: '700' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F4F3F9', alignItems: 'center', justifyContent: 'center' },
  stepTxt: { color: C.ink, fontSize: 24, fontWeight: '700', marginTop: -2 },
  stepVal: { color: C.ink, fontSize: 26, fontWeight: '900', minWidth: 30, textAlign: 'center' },
  tie: { color: C.red, fontSize: 13, fontWeight: '600', marginTop: 6 },
  cancel: { color: C.mute, textAlign: 'center', fontWeight: '700', paddingTop: 16, paddingBottom: 4 },
});