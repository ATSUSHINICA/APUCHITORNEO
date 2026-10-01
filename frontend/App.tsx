import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { socket } from './src/services/socket';
// ========================================================= 
// TIPOS 
// ========================================================= 
type Player = {
    id: string;
    nickname: string;
    left?: boolean;
};
type Match = {
    id: string;
    stage?: 'clasificacion' | 'repesca' | 'eliminatoria';
    round?: number;
    roundName?: string;
    player1Id?: string;
    player2Id?: string;
    player1?: Player | null;
    player2?: Player | null;
    score1?: number;
    score2?: number;
    winnerId?: string | null;
    game?: string | null;
    played?: boolean;
    forfeit?: boolean;
};
type Standing = {
    position: number;
    player: Player;
    played: number;
    wins: number;
    losses: number;
    scoreFor: number;
    scoreAgainst: number;
    roundDifference: number;
    zone: 'directo' | 'repesca' | 'fuera';
};
type Plan = {
    bracketSize: number;
    direct: number;
    repSlots: number;
    repPlayers: number;
    out: number;
    totalNeeded: number;
};
type Phase = 'LOBBY' | 'CLASIFICACION' | 'REPESCA' | 'ELIMINATORIA' | 'FINISHED';
type Snapshot = {
    pin: string;
    phase: Phase;
    plan: Plan;
    players: Player[];
    games: string[];
    matches: Match[];
    standings: Standing[];
    champion: Player | null;
};
type PlayerState = {
    player: Player;
    phase: Phase;
    currentMatch: Match | null;
    opponent: Player | null;
    game: string | null;
    history: Match[];
    zone: 'directo' | 'repesca' | 'fuera' | null;
};
type Screen = 'home' | 'lobby' | 'tournament';
type Kind = 'green' | 'blue' | 'red' | 'yellow' | 'ink' | 'ghost';
// ========================================================= 
// TEMA 
// ========================================================= 
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
const TOP = Platform.OS === 'android'
    ? (StatusBar.currentHeight ?? 24) + 12
    : 56;
const BTN: Record<Kind, [
    string,
    string
]> = {
    green: [
        C.green,
        '#1A5E07',
    ],
    blue: [
        C.blue,
        '#0C4A94',
    ],
    red: [
        C.red,
        '#A81229',
    ],
    yellow: [
        C.yellow,
        '#C47F00',
    ],
    ink: [
        C.ink,
        '#0A0A12',
    ],
    ghost: [
        'rgba(255,255,255,0.16)',
        'rgba(0,0,0,0.22)',
    ],
};
const AVATAR = [
    C.red,
    C.blue,
    C.yellow,
    C.green,
    '#864CBF',
    '#0AA3A3',
];
// ========================================================= 
// HELPERS 
// ========================================================= 
const initial = (name = '?') => name
    .trim()
    .charAt(0)
    .toUpperCase() || '?';
const colorFor = (name = '') => AVATAR[[...name].reduce((total, char) => total + char.charCodeAt(0), 0) % AVATAR.length];
const toMatches = (data: any): Match[] => Array.isArray(data)
    ? data
    : data?.matches ?? [];
const getWinner = (match: Match) => {
    if (match.winnerId) {
        return match.winnerId;
    }
    if (match.score1 != null &&
        match.score2 != null &&
        match.score1 !== match.score2) {
        return match.score1 >
            match.score2
            ? match.player1Id
            : match.player2Id;
    }
    return undefined;
};
const getPlayer = (match: Match, id?: string | null) => {
    if (!id)
        return null;
    if (match.player1?.id === id ||
        match.player1Id === id) {
        return match.player1;
    }
    if (match.player2?.id === id ||
        match.player2Id === id) {
        return match.player2;
    }
    return null;
};
const phaseName = (phase?: Phase) => {
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
// ========================================================= 
// COMPONENTES 
// ========================================================= 
function Btn({ label, kind = 'green', onPress, disabled, }: {
    label: string;
    kind?: Kind;
    onPress: () => void;
    disabled?: boolean;
}) {
    const [backgroundColor, borderColor,] = BTN[kind];
    return (<Pressable onPress={onPress} disabled={disabled} style={[
            s.btn,
            {
                backgroundColor,
                borderBottomColor: borderColor,
            },
            disabled &&
                s.disabled,
        ]}> 
      <Text style={s.btnText}> 
        {label} 
      </Text> 
    </Pressable>);
}
function Avatar({ name, size = 38, }: {
    name?: string;
    size?: number;
}) {
    return (<View style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: colorFor(name),
            alignItems: 'center',
            justifyContent: 'center',
        }}> 
      <Text style={{
            color: C.white,
            fontWeight: '900',
            fontSize: size * 0.45,
        }}> 
        {initial(name)} 
      </Text> 
    </View>);
}
function ConnPill({ connected, }: {
    connected: boolean;
}) {
    return (<View style={s.conn}> 
      <View style={[
            s.dot,
            {
                backgroundColor: connected
                    ? '#5EE17A'
                    : C.red,
            },
        ]}/> 
 
      <Text style={s.connTxt}> 
        {connected
            ? 'En línea'
            : 'Sin conexión'} 
      </Text> 
    </View>);
}
function Pop({ children, style }: {
    children: React.ReactNode;
    style?: object;
}) {
    const scale = useRef(new Animated.Value(0.92)).current;
    useEffect(() => {
        Animated.spring(scale, { toValue: 1, friction: 6, useNativeDriver: true }).start();
    }, [scale]);
    return <Animated.View style={[{ transform: [{ scale }] }, style]}>{children}</Animated.View>;
}
function Pulse({ children }: {
    children: React.ReactNode;
}) {
    const opacity = useRef(new Animated.Value(0.55)).current;
    useEffect(() => {
        const loop = Animated.loop(Animated.sequence([
            Animated.timing(opacity, { toValue: 1, duration: 850, useNativeDriver: true }),
            Animated.timing(opacity, { toValue: 0.55, duration: 850, useNativeDriver: true }),
        ]));
        loop.start();
        return () => loop.stop();
    }, [opacity]);
    return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}
// ========================================================= 
// MATCH CARD 
// ========================================================= 
function MatchCard({ match, host, onScore, onGame, }: {
    match: Match;
    host: boolean;
    onScore: () => void;
    onGame: () => void;
}) {
    const winner = getWinner(match);
    const row = (player?: Player | null, score?: number) => {
        const isWinner = !!player &&
            winner === player.id;
        return (<View style={[
                s.playerRow,
                isWinner &&
                    s.winnerRow,
            ]}> 
        {player ? (<Avatar name={player.nickname} size={32}/>) : (<View style={s.emptyAvatar}/>)} 
 
        <Text style={[
                s.playerName,
                isWinner &&
                    s.winnerName,
            ]} numberOfLines={1}> 
          {player?.nickname ??
                'Por definir'} 
        </Text> 
 
        <Text style={s.score}> 
          {score ?? '–'} 
        </Text> 
      </View>);
    };
    const ready = !!match.player1 &&
        !!match.player2;
    return (<View style={s.matchCard}> 
      <View style={s.matchHeader}> 
        <Text style={s.stageText}> 
          {match.roundName ??
            phaseName(match.stage ===
                'clasificacion'
                ? 'CLASIFICACION'
                : match.stage ===
                    'repesca'
                    ? 'REPESCA'
                    : 'ELIMINATORIA')} 
        </Text> 
 
        {match.forfeit && (<Text style={s.forfeit}> 
            FORFAIT 
          </Text>)} 
      </View> 
 
      <Pressable disabled={!host || !ready} onPress={onGame} style={s.gameBox}> 
        <Text style={match.game
            ? s.gameText
            : s.noGame}> 
          {match.game
            ? `🎮 ${match.game}`
            : '🎮 ASIGNAR JUEGO'} 
        </Text> 
      </Pressable> 
 
      {row(match.player1, match.score1)} 
 
      <View style={s.sep}/> 
 
      {row(match.player2, match.score2)} 
 
      {host &&
            ready &&
            !match.played && (<Pressable onPress={onScore} disabled={!match.game} style={[
                s.resultButton,
                !match.game &&
                    s.disabled,
            ]}> 
            <Text style={s.resultButtonText}> 
              {match.game
                ? 'ANOTAR RESULTADO'
                : 'ASIGNA UN JUEGO PRIMERO'} 
            </Text> 
          </Pressable>)} 
    </View>);
}
// ========================================================= 
// APP 
// ========================================================= 
export default function App() {
    const [screen, setScreen,] = useState<Screen>('home');
    const [pin, setPin,] = useState('');
    const [nickname, setNickname,] = useState('');
    const [players, setPlayers,] = useState<Player[]>([]);
    const [games, setGames,] = useState<string[]>([]);
    const [matches, setMatches,] = useState<Match[]>([]);
    const [standings, setStandings,] = useState<Standing[]>([]);
    const [plan, setPlan,] = useState<Plan | null>(null);
    const [phase, setPhase,] = useState<Phase>('LOBBY');
    const [champion, setChampion,] = useState<Player | null>(null);
    const [playerState, setPlayerState,] = useState<PlayerState | null>(null);
    const [isHost, setIsHost,] = useState(false);
    const [connected, setConnected,] = useState(socket.connected);
    // --------------------------------------------------------- 
    // MODALES 
    // --------------------------------------------------------- 
    const [scoring, setScoring,] = useState<Match | null>(null);
    const [sc1, setSc1,] = useState(0);
    const [sc2, setSc2,] = useState(0);
    const [gameMatch, setGameMatch,] = useState<Match | null>(null);
    const [spinning, setSpinning,] = useState(false);
    const [newGame, setNewGame,] = useState('');
    // --------------------------------------------------------- 
    // SOCKET 
    // --------------------------------------------------------- 
    useEffect(() => {
        const onConnect = () => setConnected(true);
        const onDisconnect = () => setConnected(false);
        const applySnapshot = (snapshot: Snapshot) => {
            if (!snapshot)
                return;
            setPin(snapshot.pin);
            setPhase(snapshot.phase);
            setPlayers(snapshot.players ??
                []);
            setGames(snapshot.games ??
                []);
            setMatches(snapshot.matches ??
                []);
            setStandings(snapshot.standings ??
                []);
            setPlan(snapshot.plan ??
                null);
            setChampion(snapshot.champion ??
                null);
            if (snapshot.phase !==
                'LOBBY') {
                setScreen('tournament');
            }
        };
        const onStarted = (data: any) => {
            applySnapshot(data?.snapshot);
        };
        const onUpdated = (snapshot: Snapshot) => {
            applySnapshot(snapshot);
        };
        const onBracket = (snapshot: Snapshot) => {
            applySnapshot(snapshot);
        };
        const onLobby = (list: Player[]) => {
            setPlayers(list ?? []);
        };
        const onGames = (data: {
            games: string[];
        }) => {
            setGames(data?.games ?? []);
        };
        const onPlayerState = (state: PlayerState) => {
            setPlayerState(state);
        };
        const onEnd = (data: any) => {
            if (data?.champion) {
                setChampion(data.champion);
            }
            if (data?.snapshot) {
                applySnapshot(data.snapshot);
            }
        };
        const onKicked = (data: any) => {
            Alert.alert('Expulsado', data?.message ??
                'Has sido expulsado del torneo.');
            setScreen('home');
            setPin('');
            setPlayers([]);
            setMatches([]);
            setIsHost(false);
        };
        socket.on('connect', onConnect);
        socket.on('disconnect', onDisconnect);
        socket.on('tournament:started', onStarted);
        socket.on('tournament:updated', onUpdated);
        socket.on('bracket:update', onBracket);
        socket.on('lobby:update', onLobby);
        socket.on('games:update', onGames);
        socket.on('player:state', onPlayerState);
        socket.on('tournament:end', onEnd);
        socket.on('player:kicked', onKicked);
        return () => {
            socket.off('connect', onConnect);
            socket.off('disconnect', onDisconnect);
            socket.off('tournament:started', onStarted);
            socket.off('tournament:updated', onUpdated);
            socket.off('bracket:update', onBracket);
            socket.off('lobby:update', onLobby);
            socket.off('games:update', onGames);
            socket.off('player:state', onPlayerState);
            socket.off('tournament:end', onEnd);
            socket.off('player:kicked', onKicked);
        };
    }, []);
    // --------------------------------------------------------- 
    // CREAR 
    // --------------------------------------------------------- 
    const createTournament = () => {
        socket.emit('host:create', (result: any) => {
            if (!result?.success) {
                Alert.alert('Error', result?.error ??
                    'No se pudo crear el torneo.');
                return;
            }
            setPin(result.pin);
            setGames(result.games ??
                []);
            setPhase(result.phase ??
                'LOBBY');
            setIsHost(true);
            setScreen('lobby');
        });
    };
    // --------------------------------------------------------- 
    // UNIRSE 
    // --------------------------------------------------------- 
    const joinTournament = () => {
        if (!pin.trim() ||
            !nickname.trim()) {
            Alert.alert('Faltan datos', 'Introduce el PIN y tu apodo.');
            return;
        }
        socket.emit('player:join', {
            pin: pin.trim(),
            nickname: nickname.trim(),
        }, (result: any) => {
            if (!result?.success) {
                Alert.alert('No puedes entrar', result?.error ??
                    'No se pudo entrar al torneo.');
                return;
            }
            setPlayers(result.players ??
                []);
            setGames(result.games ??
                []);
            setPhase(result.phase ??
                'LOBBY');
            setScreen('lobby');
        });
    };
    // --------------------------------------------------------- 
    // INICIAR 
    // --------------------------------------------------------- 
    const startTournament = () => {
        socket.emit('host:start', { pin }, (result: any) => {
            if (!result?.success) {
                Alert.alert('No se puede iniciar', result?.error ??
                    'Error.');
            }
        });
    };
    // --------------------------------------------------------- 
    // CERRAR CLASIFICACIÓN 
    // --------------------------------------------------------- 
    const lockClassification = () => {
        socket.emit('host:lockClassification', { pin }, (result: any) => {
            if (!result?.success) {
                Alert.alert('No se puede cerrar', result?.error ??
                    'Todavía no se puede cerrar la clasificación.');
                return;
            }
            if (result.snapshot) {
                setPhase(result.snapshot.phase);
            }
        });
    };
    // --------------------------------------------------------- 
    // RESULTADO 
    // --------------------------------------------------------- 
    const openScore = (match: Match) => {
        setSc1(match.score1 ?? 0);
        setSc2(match.score2 ?? 0);
        setScoring(match);
    };
    const confirmScore = () => {
        if (!scoring) {
            return;
        }
        if (sc1 === sc2) {
            Alert.alert('Marcador inválido', 'No puede haber empate.');
            return;
        }
        if (sc1 !== 2 &&
            sc2 !== 2) {
            Alert.alert('Marcador inválido', 'Uno de los jugadores debe llegar a 2.');
            return;
        }
        socket.emit('host:setResult', {
            pin,
            matchId: scoring.id,
            score1: sc1,
            score2: sc2,
        }, (result: any) => {
            if (!result?.success) {
                Alert.alert('Error', result?.error ??
                    'No se pudo guardar el resultado.');
                return;
            }
            setScoring(null);
        });
    };
    // --------------------------------------------------------- 
    // JUEGOS 
    // --------------------------------------------------------- 
    const addGame = () => {
        const clean = newGame.trim();
        if (!clean) {
            return;
        }
        socket.emit('host:addGame', {
            pin,
            game: clean,
        }, (result: any) => {
            if (!result?.success) {
                Alert.alert('Error', result?.error ??
                    'No se pudo añadir.');
                return;
            }
            setNewGame('');
        });
    };
    const removeGame = (game: string) => {
        Alert.alert('Eliminar juego', `¿Eliminar "${game}" de la lista?`, [
            {
                text: 'Cancelar',
                style: 'cancel',
            },
            {
                text: 'Eliminar',
                style: 'destructive',
                onPress: () => {
                    socket.emit('host:removeGame', {
                        pin,
                        game,
                    }, (result: any) => {
                        if (!result?.success) {
                            Alert.alert('Error', result?.error ??
                                'No se pudo eliminar.');
                        }
                    });
                },
            },
        ]);
    };
    const assignGame = (matchId: string, game: string) => {
        socket.emit('host:assignGame', {
            pin,
            matchId,
            game,
        }, (result: any) => {
            if (!result?.success) {
                Alert.alert('Error', result?.error ??
                    'No se pudo asignar el juego.');
                return;
            }
            setGameMatch(null);
        });
    };
    const spinGame = () => {
        if (!gameMatch) {
            return;
        }
        setSpinning(true);
        socket.emit('host:spinGame', { pin }, (result: any) => {
            setTimeout(() => {
                setSpinning(false);
                if (!result?.success) {
                    Alert.alert('Ruleta', result?.error ??
                        'No hay juegos disponibles.');
                    return;
                }
                Alert.alert('🎯 JUEGO SELECCIONADO', result.game, [
                    {
                        text: 'Asignar',
                        onPress: () => assignGame(gameMatch.id, result.game),
                    },
                    {
                        text: 'Cancelar',
                        style: 'cancel',
                    },
                ]);
            }, 900);
        });
    };
    // --------------------------------------------------------- 
    // KICK 
    // --------------------------------------------------------- 
    const kickPlayer = (player: Player) => {
        Alert.alert('Expulsar jugador', `¿Seguro que quieres expulsar a ${player.nickname}?`, [
            {
                text: 'Cancelar',
                style: 'cancel',
            },
            {
                text: 'Expulsar',
                style: 'destructive',
                onPress: () => {
                    socket.emit('host:kick', {
                        pin,
                        playerId: player.id,
                    }, (result: any) => {
                        if (!result?.success) {
                            Alert.alert('Error', result?.error ??
                                'No se pudo expulsar.');
                        }
                    });
                },
            },
        ]);
    };
    // --------------------------------------------------------- 
    // SALIR 
    // --------------------------------------------------------- 
    const leave = () => {
        if (isHost) {
            setScreen('home');
            setPin('');
            setPlayers([]);
            setMatches([]);
            setIsHost(false);
            return;
        }
        socket.emit('player:leave', { pin });
        setScreen('home');
        setPin('');
        setPlayers([]);
        setMatches([]);
        setIsHost(false);
    };
    // --------------------------------------------------------- 
    // DERIVADOS 
    // --------------------------------------------------------- 
    const myId = socket.id;
    const myMatch = playerState?.currentMatch ??
        matches.find((match) => !match.played &&
            (match.player1Id ===
                myId ||
                match.player2Id ===
                    myId));
    const opponent = playerState?.opponent ??
        (myMatch
            ? getPlayer(myMatch, myMatch.player1Id ===
                myId
                ? myMatch.player2Id
                : myMatch.player1Id)
            : null);
    const classificationMatches = useMemo(() => matches.filter((match) => match.stage ===
        'clasificacion'), [matches]);
    const repechageMatches = useMemo(() => matches.filter((match) => match.stage ===
        'repesca'), [matches]);
    const eliminationMatches = useMemo(() => matches.filter((match) => match.stage ===
        'eliminatoria'), [matches]);
    const eliminationRounds = useMemo(() => {
        const groups: Record<number, Match[]> = {};
        eliminationMatches.forEach((match) => {
            const round = match.round ?? 1;
            if (!groups[round]) {
                groups[round] = [];
            }
            groups[round].push(match);
        });
        return Object.entries(groups)
            .sort(([a], [b]) => Number(a) -
            Number(b))
            .map(([round, list]) => ({
            round: Number(round),
            matches: list,
        }));
    }, [
        eliminationMatches,
    ]);
    // =========================================================
    // HOME
    // =========================================================
    if (screen === 'home') {
        return (<KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                <StatusBar barStyle="light-content"/>
                <ConnPill connected={connected}/>

                <ScrollView contentContainerStyle={s.home}>
                    <View style={s.logoRow}>
                        <View style={[s.logoSq, { backgroundColor: C.yellow }]}/>
                        <View style={[s.logoSq, { backgroundColor: C.blue }]}/>
                        <Text style={s.logo}>TORNEO</Text>
                    </View>
                    <Text style={s.tag}>Compite. Gana. Repite.</Text>

                    <View style={s.panel}>
                        <TextInput style={[s.input, s.pinInput]} placeholder="PIN" placeholderTextColor={C.mute} keyboardType="number-pad" value={pin} onChangeText={setPin} maxLength={6}/>
                        <TextInput style={s.input} placeholder="Tu apodo" placeholderTextColor={C.mute} value={nickname} onChangeText={setNickname} maxLength={16} autoCapitalize="words"/>
                        <Btn label="UNIRSE" kind="ink" onPress={joinTournament}/>
                    </View>

                    <Text style={s.or}>¿Organizas tú?</Text>
                    <View style={{ width: '100%' }}>
                        <Btn label="CREAR TORNEO" kind="ghost" onPress={createTournament}/>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>);
    }
    // =========================================================
    // LOBBY
    // =========================================================
    if (screen === 'lobby') {
        return (<View style={s.screen}>
                <StatusBar barStyle="light-content"/>
                <View style={s.topBar}>
                    <Pressable onPress={leave}><Text style={s.link}>‹ Salir</Text></Pressable>
                    <ConnPill connected={connected}/>
                </View>

                <ScrollView contentContainerStyle={s.lobby}>
                    <Pop style={s.pinCard}>
                        <Text style={s.pinLabel}>{isHost ? 'Comparte este PIN' : 'Estás dentro. PIN'}</Text>
                        <Text style={s.pinNumber}>{pin}</Text>
                    </Pop>

                    <View style={s.countPill}>
                        <Text style={s.countTxt}>{players.length} {players.length === 1 ? 'jugador' : 'jugadores'}</Text>
                    </View>

                    <View style={s.chips}>
                        {players.map((player) => (<Pop key={player.id} style={s.playerChip}>
                                <Avatar name={player.nickname} size={30}/>
                                <Text style={s.chipName} numberOfLines={1}>{player.nickname}</Text>
                                {isHost && (<Pressable onPress={() => kickPlayer(player)}>
                                        <Text style={s.kickText}>✕</Text>
                                    </Pressable>)}
                            </Pop>))}
                    </View>

                    {players.length === 0 && <Text style={s.empty}>Esperando a que se una la gente…</Text>}
                </ScrollView>

                <View style={s.footer}>
                    {isHost ? (<>
                            {players.length < 2 && <Text style={s.warning}>Hacen falta al menos 2 jugadores</Text>}
                            <Btn label="INICIAR TORNEO" onPress={startTournament} disabled={players.length < 2}/>
                        </>) : (<Pulse><Text style={s.waiting}>Esperando a que el anfitrión comience…</Text></Pulse>)}
                </View>
            </View>);
    }
    // ========================================================= 
    // TORNEO 
    // ========================================================= 
    return (<View style={s.screen}> 
      <StatusBar barStyle="light-content"/> 
 
      <View style={s.topBar}> 
        <Pressable onPress={leave}> 
          <Text style={s.link}> 
            ‹ Salir 
          </Text> 
        </Pressable> 
 
        <View> 
          <Text style={s.phase}> 
            {phaseName(phase)} 
          </Text> 
 
          <Text style={s.pinSmall}> 
            PIN {pin} 
          </Text> 
        </View> 
 
        <ConnPill connected={connected}/> 
      </View> 
 
      <ScrollView contentContainerStyle={s.tournament}> 
        {/* CAMPEÓN */} 
 
        {champion && (<View style={s.champion}> 
            <Text style={s.championTitle}> 
              🏆 CAMPEÓN 
            </Text> 
 
            <Text style={s.championName}> 
              {champion.nickname} 
            </Text> 
          </View>)} 
 
        {/* =========================
            HOST
        ========================== */} 
 
        {isHost && (<> 
            {/* JUEGOS */} 
 
            <View style={s.section}> 
              <Text style={s.sectionTitle}> 
                🎮 JUEGOS 
              </Text> 
 
              <View style={s.addGameRow}> 
                <TextInput style={s.gameInput} placeholder="Nuevo juego" placeholderTextColor={C.mute} value={newGame} onChangeText={setNewGame}/> 
 
                <Pressable style={s.addGameButton} onPress={addGame}> 
                  <Text style={s.addGameText}> 
                    + 
                  </Text> 
                </Pressable> 
              </View> 
 
              {games.map((game) => (<View key={game} style={s.gameRow}> 
                    <Text style={s.gameRowText}> 
                      🎮 {game} 
                    </Text> 
 
                    <Pressable onPress={() => removeGame(game)}> 
                      <Text style={s.deleteText}> 
                        🗑️ 
                      </Text> 
                    </Pressable> 
                  </View>))} 
            </View> 
 
            {/* JUGADORES */} 
 
            <View style={s.section}> 
              <Text style={s.sectionTitle}> 
                👥 JUGADORES 
              </Text> 
 
              {players.map((player) => (<View key={player.id} style={s.adminPlayer}> 
                    <Avatar name={player.nickname} size={34}/> 
 
                    <Text style={s.adminPlayerName}> 
                      {player.nickname} 
                    </Text> 
 
                    <Pressable onPress={() => kickPlayer(player)} style={s.kickButton}> 
                      <Text style={s.kickButtonText}> 
                        EXPULSAR 
                      </Text> 
                    </Pressable> 
                  </View>))} 
            </View> 
          </>)} 
 
        {/* =========================
            ESTADO DEL JUGADOR
        ========================== */} 
 
        {!isHost &&
            playerState && (<View style={s.myState}> 
              <Text style={s.sectionTitle}> 
                TU ESTADO 
              </Text> 
 
              <Text style={s.myStateText}> 
                Zona:{' '} 
                {playerState.zone ??
                '—'} 
              </Text> 
 
              {opponent && (<Text style={s.myStateText}> 
                  Rival:{' '} 
                  {opponent.nickname} 
                </Text>)} 
 
              {playerState.game && (<Text style={s.myStateText}> 
                  🎮{' '} 
                  {playerState.game} 
                </Text>)} 
            </View>)} 
 
        {/* =========================
            CLASIFICACIÓN
        ========================== */} 
 
        {phase ===
            'CLASIFICACION' && (<View style={s.section}> 
            <Text style={s.sectionTitle}> 
              📊 CLASIFICACIÓN 
            </Text> 
 
            {plan && (<View style={s.planBox}> 
                <Text style={s.planText}> 
                  🟢 {plan.direct}{' '} 
                  directos 
                </Text> 
 
                <Text style={s.planText}> 
                  🟡{' '} 
                  {plan.repPlayers}{' '} 
                  repesca 
                </Text> 
 
                <Text style={s.planText}> 
                  🔴 {plan.out}{' '} 
                  eliminados 
                </Text> 
              </View>)} 
 
            {standings.map((standing) => (<View key={standing.player.id} style={s.standingRow}> 
                  <Text style={s.position}> 
                    {standing.position} 
                  </Text> 
 
                  <Avatar name={standing.player
                    .nickname} size={34}/> 
 
                  <View style={s.standingInfo}> 
                    <Text style={s.standingName}> 
                      {standing
                    .player
                    .nickname} 
                    </Text> 
 
                    <Text style={s.standingStats}> 
                      {standing.wins}{' '} 
                      V ·{' '} 
                      {standing.losses}{' '} 
                      D · DIF{' '} 
                      {standing.roundDifference} 
                    </Text> 
                  </View> 
 
                  <View style={[
                    s.zoneBadge,
                    standing.zone ===
                        'directo' &&
                        s.directBadge,
                    standing.zone ===
                        'repesca' &&
                        s.repechageBadge,
                    standing.zone ===
                        'fuera' &&
                        s.outBadge,
                ]}> 
                    <Text style={s.zoneText}> 
                      {standing.zone ===
                    'directo'
                    ? 'DIRECTO'
                    : standing.zone ===
                        'repesca'
                        ? 'REPESCA'
                        : 'FUERA'} 
                    </Text> 
                  </View> 
                </View>))} 
 
            {isHost && (<View style={s.lockButtonWrap}> 
                <Btn label="🔒 CERRAR CLASIFICACIÓN" kind="yellow" onPress={lockClassification} disabled={classificationMatches.some((match) => !match.played)}/> 
 
                {classificationMatches.some((match) => !match.played) && (<Text style={s.warning}> 
                    Termina todos los 
                    partidos antes de 
                    cerrar la 
                    clasificación. 
                  </Text>)} 
              </View>)} 
 
            {classificationMatches.map((match) => (<MatchCard key={match.id} match={match} host={isHost} onScore={() => openScore(match)} onGame={() => setGameMatch(match)}/>))} 
          </View>)} 
 
        {/* =========================
            REPESCA
        ========================== */} 
 
        {phase ===
            'REPESCA' && (<View style={s.section}> 
            <Text style={s.sectionTitle}> 
              ⚡ REPESCA 
            </Text> 
 
            <Text style={s.description}> 
              Los jugadores de la 
              zona de repesca se 
              enfrentan al mejor de 
              3. Los ganadores 
              entran en la 
              eliminatoria. 
            </Text> 
 
            {repechageMatches.map((match) => (<MatchCard key={match.id} match={match} host={isHost} onScore={() => openScore(match)} onGame={() => setGameMatch(match)}/>))} 
          </View>)} 
 
        {/* =========================
            ELIMINATORIA
        ========================== */} 
 
        {(phase ===
            'ELIMINATORIA' ||
            phase ===
                'FINISHED') && (<View style={s.section}> 
            <Text style={s.sectionTitle}> 
              🏆 ELIMINATORIA 
            </Text> 
 
            {eliminationRounds.map((round) => (<View key={round.round}> 
                  <Text style={s.roundTitle}> 
                    {round.matches[0]
                    ?.roundName ??
                    `RONDA ${round.round}`} 
                  </Text> 
 
                  {round.matches.map((match) => (<MatchCard key={match.id} match={match} host={isHost} onScore={() => openScore(match)} onGame={() => setGameMatch(match)}/>))} 
                </View>))} 
          </View>)} 
      </ScrollView> 
 
      {/* =====================================================
                MODAL RESULTADO
            ====================================================== */} 
 
      <Modal visible={!!scoring} transparent animationType="fade" onRequestClose={() => setScoring(null)}> 
        <View style={s.overlay}> 
          <View style={s.modal}> 
            <Text style={s.modalTitle}> 
              RESULTADO 
            </Text> 
 
            <Text style={s.modalGame}> 
              🎮{' '} 
              {scoring?.game ??
            'Sin juego'} 
            </Text> 
 
            <View style={s.scorePlayer}> 
              <Text style={s.scorePlayerName}> 
                {scoring?.player1
            ?.nickname} 
              </Text> 
 
              <View style={s.scoreControls}> 
                <Pressable style={s.scoreButton} onPress={() => setSc1(Math.max(0, sc1 - 1))}> 
                  <Text> 
                    − 
                  </Text> 
                </Pressable> 
 
                <Text style={s.bigScore}> 
                  {sc1} 
                </Text> 
 
                <Pressable style={s.scoreButton} onPress={() => setSc1(Math.min(2, sc1 + 1))}> 
                  <Text> 
                    + 
                  </Text> 
                </Pressable> 
              </View> 
            </View> 
 
            <View style={s.scorePlayer}> 
              <Text style={s.scorePlayerName}> 
                {scoring?.player2
            ?.nickname} 
              </Text> 
 
              <View style={s.scoreControls}> 
                <Pressable style={s.scoreButton} onPress={() => setSc2(Math.max(0, sc2 - 1))}> 
                  <Text> 
                    − 
                  </Text> 
                </Pressable> 
 
                <Text style={s.bigScore}> 
                  {sc2} 
                </Text> 
 
                <Pressable style={s.scoreButton} onPress={() => setSc2(Math.min(2, sc2 + 1))}> 
                  <Text> 
                    + 
                  </Text> 
                </Pressable> 
              </View> 
            </View> 
 
            <Btn label="GUARDAR RESULTADO" onPress={confirmScore} disabled={sc1 === sc2 ||
            (sc1 !== 2 &&
                sc2 !== 2)}/> 
 
            <Pressable onPress={() => setScoring(null)}> 
              <Text style={s.cancel}> 
                Cancelar 
              </Text> 
            </Pressable> 
          </View> 
        </View> 
      </Modal> 
 
      {/* =====================================================
                MODAL JUEGO
            ====================================================== */} 
 
      <Modal visible={!!gameMatch} transparent animationType="fade" onRequestClose={() => setGameMatch(null)}> 
        <View style={s.overlay}> 
          <View style={s.modal}> 
            <Text style={s.modalTitle}> 
              🎮 JUEGO DEL PARTIDO 
            </Text> 
 
            <Btn label={spinning
            ? '🎰 GIRANDO...'
            : '🎰 GIRAR RULETA'} kind="yellow" onPress={spinGame} disabled={spinning}/> 
 
            <Text style={s.orModal}> 
              O selecciona 
              manualmente 
            </Text> 
 
            <ScrollView style={s.gameListModal}> 
              {games.map((game) => (<Pressable key={game} style={s.selectGame} onPress={() => gameMatch &&
                assignGame(gameMatch.id, game)}> 
                    <Text style={s.selectGameText}> 
                      🎮 {game} 
                    </Text> 
                  </Pressable>))} 
            </ScrollView> 
 
            <Pressable onPress={() => setGameMatch(null)}> 
              <Text style={s.cancel}> 
                Cancelar 
              </Text> 
            </Pressable> 
          </View> 
        </View> 
      </Modal> 
    </View>);
}
// ========================================================= 
// ESTILOS 
// ========================================================= 
const s = StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: C.bg,
    },
    conn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: 'rgba(0,0,0,0.22)',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 20,
        position: 'absolute',
        top: TOP - 8,
        right: 16,
        zIndex: 10,
    },
    dot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    connTxt: {
        color: C.white,
        fontSize: 12,
        fontWeight: '700',
    },
    home: {
        flexGrow: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
        paddingTop: TOP + 20,
    },
    logoRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 14,
    },
    logoSq: {
        width: 20,
        height: 20,
        borderRadius: 6,
        transform: [{ rotate: '45deg' }],
    },
    logo: {
        color: C.white,
        fontSize: 52,
        fontWeight: '900',
        letterSpacing: 5,
    },
    tag: {
        color: 'rgba(255,255,255,0.7)',
        marginTop: 5,
        marginBottom: 30,
    },
    panel: {
        width: '100%',
        backgroundColor: C.white,
        borderRadius: 18,
        padding: 16,
        gap: 12,
    },
    input: {
        backgroundColor: '#F4F3F9',
        borderWidth: 2,
        borderColor: C.line,
        borderRadius: 10,
        padding: 14,
        color: C.ink,
        fontSize: 17,
        fontWeight: '600',
    },
    pinInput: {
        textAlign: 'center',
        fontSize: 25,
        fontWeight: '900',
        letterSpacing: 5,
    },
    or: {
        color: 'rgba(255,255,255,0.65)',
        marginVertical: 18,
    },
    btn: {
        width: '100%',
        paddingVertical: 15,
        borderRadius: 10,
        alignItems: 'center',
        borderBottomWidth: 5,
    },
    btnText: {
        color: C.white,
        fontSize: 16,
        fontWeight: '900',
    },
    disabled: {
        opacity: 0.45,
    },
    topBar: {
        paddingTop: TOP - 8,
        paddingHorizontal: 16,
        height: TOP + 38,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    link: {
        color: C.white,
        fontSize: 17,
        fontWeight: '800',
    },
    lobby: {
        padding: 20,
    },
    countPill: {
        alignSelf: 'center',
        backgroundColor: 'rgba(0,0,0,0.25)',
        borderRadius: 20,
        paddingHorizontal: 16,
        paddingVertical: 7,
        marginBottom: 18,
    },
    countTxt: {
        color: C.white,
        fontWeight: '800',
        fontSize: 15,
    },
    chips: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: 10,
    },
    pinCard: {
        backgroundColor: C.white,
        borderRadius: 18,
        padding: 24,
        alignItems: 'center',
        marginBottom: 24,
    },
    pinLabel: {
        color: C.mute,
        fontWeight: '700',
    },
    pinNumber: {
        color: C.ink,
        fontSize: 52,
        fontWeight: '900',
        letterSpacing: 8,
    },
    sectionTitle: {
        color: C.white,
        fontSize: 20,
        fontWeight: '900',
        marginBottom: 12,
    },
    playerChip: {
        backgroundColor: C.white,
        borderRadius: 14,
        padding: 9,
        marginBottom: 9,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    chipName: {
        flex: 1,
        color: C.ink,
        fontWeight: '800',
        fontSize: 16,
    },
    kickText: {
        color: C.red,
        fontSize: 20,
        fontWeight: '900',
        padding: 8,
    },
    empty: {
        color: 'rgba(255,255,255,0.65)',
        textAlign: 'center',
        marginTop: 30,
    },
    footer: {
        padding: 20,
        paddingBottom: 30,
        backgroundColor: 'rgba(0,0,0,0.18)',
    },
    waiting: {
        color: C.white,
        textAlign: 'center',
        fontWeight: '800',
        padding: 10,
    },
    tournament: {
        padding: 18,
        paddingBottom: 50,
    },
    phase: {
        color: C.white,
        fontWeight: '900',
        textAlign: 'center',
    },
    pinSmall: {
        color: 'rgba(255,255,255,0.6)',
        textAlign: 'center',
        fontSize: 11,
    },
    section: {
        backgroundColor: 'rgba(0,0,0,0.15)',
        borderRadius: 16,
        padding: 14,
        marginBottom: 18,
    },
    planBox: {
        backgroundColor: 'rgba(255,255,255,0.1)',
        borderRadius: 12,
        padding: 12,
        marginBottom: 15,
        gap: 4,
    },
    planText: {
        color: C.white,
        fontWeight: '700',
    },
    standingRow: {
        backgroundColor: C.white,
        borderRadius: 12,
        padding: 8,
        marginBottom: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    position: {
        width: 25,
        color: C.mute,
        fontWeight: '900',
        textAlign: 'center',
    },
    standingInfo: {
        flex: 1,
    },
    standingName: {
        color: C.ink,
        fontWeight: '800',
        fontSize: 15,
    },
    standingStats: {
        color: C.mute,
        fontSize: 12,
        marginTop: 2,
    },
    zoneBadge: {
        paddingHorizontal: 8,
        paddingVertical: 5,
        borderRadius: 8,
    },
    directBadge: {
        backgroundColor: '#DDF5D8',
    },
    repechageBadge: {
        backgroundColor: '#FFF0C9',
    },
    outBadge: {
        backgroundColor: '#FFD9DF',
    },
    zoneText: {
        color: C.ink,
        fontSize: 9,
        fontWeight: '900',
    },
    lockButtonWrap: {
        marginTop: 15,
        marginBottom: 20,
    },
    warning: {
        color: '#FFD8DE',
        textAlign: 'center',
        marginTop: 8,
        fontSize: 12,
        fontWeight: '700',
    },
    description: {
        color: 'rgba(255,255,255,0.75)',
        marginBottom: 15,
        lineHeight: 20,
    },
    roundTitle: {
        color: C.white,
        fontSize: 18,
        fontWeight: '900',
        marginBottom: 10,
        marginTop: 10,
    },
    matchCard: {
        backgroundColor: C.white,
        borderRadius: 14,
        padding: 8,
        marginBottom: 12,
    },
    matchHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: 5,
        paddingBottom: 5,
    },
    stageText: {
        color: C.mute,
        fontSize: 10,
        fontWeight: '900',
    },
    forfeit: {
        color: C.red,
        fontSize: 10,
        fontWeight: '900',
    },
    gameBox: {
        backgroundColor: '#F4F3F9',
        borderRadius: 9,
        padding: 9,
        marginBottom: 5,
    },
    gameText: {
        color: C.blue,
        textAlign: 'center',
        fontWeight: '900',
    },
    noGame: {
        color: C.red,
        textAlign: 'center',
        fontWeight: '900',
    },
    playerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 7,
        borderRadius: 9,
        gap: 9,
    },
    winnerRow: {
        backgroundColor: C.win,
    },
    playerName: {
        flex: 1,
        color: C.ink,
        fontSize: 16,
        fontWeight: '600',
    },
    winnerName: {
        fontWeight: '900',
    },
    score: {
        color: C.ink,
        fontSize: 21,
        fontWeight: '900',
        minWidth: 25,
        textAlign: 'right',
    },
    emptyAvatar: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: C.line,
    },
    sep: {
        height: 1,
        backgroundColor: C.line,
        marginHorizontal: 8,
    },
    resultButton: {
        backgroundColor: C.ink,
        padding: 11,
        borderRadius: 9,
        marginTop: 6,
        alignItems: 'center',
    },
    resultButtonText: {
        color: C.white,
        fontSize: 12,
        fontWeight: '900',
    },
    addGameRow: {
        flexDirection: 'row',
        gap: 8,
        marginBottom: 10,
    },
    gameInput: {
        flex: 1,
        backgroundColor: C.white,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 11,
        color: C.ink,
    },
    addGameButton: {
        width: 46,
        borderRadius: 10,
        backgroundColor: C.green,
        justifyContent: 'center',
        alignItems: 'center',
    },
    addGameText: {
        color: C.white,
        fontSize: 25,
        fontWeight: '900',
    },
    gameRow: {
        backgroundColor: C.white,
        borderRadius: 9,
        padding: 10,
        marginBottom: 6,
        flexDirection: 'row',
        alignItems: 'center',
    },
    gameRowText: {
        flex: 1,
        color: C.ink,
        fontWeight: '700',
    },
    deleteText: {
        fontSize: 18,
    },
    adminPlayer: {
        backgroundColor: C.white,
        borderRadius: 11,
        padding: 8,
        marginBottom: 7,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 9,
    },
    adminPlayerName: {
        flex: 1,
        color: C.ink,
        fontWeight: '800',
    },
    kickButton: {
        backgroundColor: '#FFDDE3',
        paddingHorizontal: 9,
        paddingVertical: 7,
        borderRadius: 8,
    },
    kickButtonText: {
        color: C.red,
        fontSize: 10,
        fontWeight: '900',
    },
    myState: {
        backgroundColor: C.white,
        borderRadius: 14,
        padding: 15,
        marginBottom: 18,
    },
    myStateText: {
        color: C.ink,
        fontWeight: '700',
        marginBottom: 5,
    },
    champion: {
        backgroundColor: C.yellow,
        borderRadius: 18,
        padding: 20,
        alignItems: 'center',
        marginBottom: 18,
    },
    championTitle: {
        color: C.ink,
        fontWeight: '900',
        fontSize: 15,
    },
    championName: {
        color: C.ink,
        fontWeight: '900',
        fontSize: 30,
        marginTop: 3,
    },
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(15,5,35,0.7)',
        justifyContent: 'center',
        padding: 20,
    },
    modal: {
        backgroundColor: C.white,
        borderRadius: 20,
        padding: 20,
        maxHeight: '85%',
    },
    modalTitle: {
        color: C.ink,
        fontSize: 23,
        fontWeight: '900',
        marginBottom: 8,
    },
    modalGame: {
        color: C.blue,
        fontWeight: '800',
        marginBottom: 15,
    },
    scorePlayer: {
        paddingVertical: 10,
    },
    scorePlayerName: {
        color: C.ink,
        fontSize: 17,
        fontWeight: '800',
        marginBottom: 7,
    },
    scoreControls: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 18,
    },
    scoreButton: {
        width: 45,
        height: 45,
        borderRadius: 23,
        backgroundColor: '#F0EFF6',
        justifyContent: 'center',
        alignItems: 'center',
    },
    bigScore: {
        color: C.ink,
        fontSize: 32,
        fontWeight: '900',
        minWidth: 40,
        textAlign: 'center',
    },
    cancel: {
        textAlign: 'center',
        color: C.mute,
        fontWeight: '800',
        padding: 15,
    },
    orModal: {
        color: C.mute,
        textAlign: 'center',
        marginVertical: 12,
    },
    gameListModal: {
        maxHeight: 350,
    },
    selectGame: {
        backgroundColor: '#F4F3F9',
        padding: 13,
        borderRadius: 10,
        marginBottom: 7,
    },
    selectGameText: {
        color: C.ink,
        fontWeight: '700',
    },
});
