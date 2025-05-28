// peerConnection.js

import * as state from './state.js';
import * as ui from './ui.js';
import * as gameLogic from './gameLogic.js';

const CAJITAS_BASE_URL = "https://cajitas.martinez.fyi";

const peerJsCallbacks = {
    onPeerOpen: (id) => {
        console.log(`[PeerJS] My Peer ID is: ${id}. Am I P1 (host)? ${state.iAmPlayer1InRemote}`);
        state.setMyPeerId(id);

        if (state.pvpRemoteActive && state.iAmPlayer1InRemote) {
            // Store the RAW peer ID for connection purposes
            state.setCurrentHostPeerId(id);

            // Create display ID with prefix for UI/QR
            const gameIdForDisplay = `${state.CAJITAS_PEER_ID_PREFIX}${id}`;
            const gameLink = `${CAJITAS_BASE_URL}/?room=${id}`; // Use RAW ID in URL

            ui.updateMessageArea(`Compartí este enlace o ID: ${gameIdForDisplay}`);
            console.log("[PeerConnection] Game link for QR:", gameLink);
            ui.displayQRCode(gameLink, gameIdForDisplay);

        } else if (state.pvpRemoteActive && !state.iAmPlayer1InRemote && state.currentHostPeerId) {
            if (window.peerJsMultiplayer?.connect) {
                console.log(`[PeerJS] Joiner (my ID ${id}) connecting to host: ${state.currentHostPeerId}`);
                // Use the RAW peer ID for actual connection
                window.peerJsMultiplayer.connect(state.currentHostPeerId);
            } else {
                console.error(`[PeerJS] Host ID not set for joiner or connect not available.`);
                ui.showModalMessage("Error: No se pudo conectar al host. El ID del host no está configurado.");
                state.resetNetworkState();
                ui.updateGameModeUI();
            }
        }
    },

    onNewConnection: (conn) => {
        console.log(`[PeerJS] Incoming connection from ${conn.peer}.`);
        ui.hideQRCode();
        ui.showModalMessage("Jugador/a conectándose...");
        ui.updateMessageArea("Jugador/a conectándose...");
    },

    onConnectionOpen: () => {
        console.log(`[PeerJS] Data connection opened.`);
        state.setGamePaired(true);
        ui.hideModalMessage();
        ui.hideQRCode();

        if (window.peerJsMultiplayer?.send) {
            if (state.iAmPlayer1InRemote) {
                // HOST: Send initial game setup with HOST as Player 0
                const hostPlayerData = {
                    id: 0, // HOST is always Player 0
                    name: state.playersData[0]?.name || 'Host',
                    icon: state.playersData[0]?.icon || state.AVAILABLE_ICONS[0],
                    color: state.playersData[0]?.color || state.DEFAULT_PLAYER_COLORS[0],
                    score: 0
                };

                console.log("[PeerConnection] HOST sending game_init_data as Player 0:", hostPlayerData);

                window.peerJsMultiplayer.send({
                    type: 'game_init_data',
                    settings: {
                        rows: state.numRows,
                        cols: state.numCols,
                        numPlayers: state.numPlayers,
                        players: [hostPlayerData, null] // Player 1 slot will be filled by joiner
                    },
                    hostPlayer: hostPlayerData,
                    initialTurnCounter: state.turnCounter
                });
                ui.updateMessageArea("¡Conectado! Esperando al Jugador 2...");
            } else {
                // JOINER: Send their info as Player 1
                const joinerPlayerData = {
                    id: 1, // JOINER is always Player 1
                    name: state.playersData[1]?.name || 'Jugador 2',
                    icon: state.playersData[1]?.icon || state.AVAILABLE_ICONS[1],
                    color: state.playersData[1]?.color || state.DEFAULT_PLAYER_COLORS[1],
                    score: 0
                };

                console.log("[PeerConnection] JOINER sending player_join_info as Player 1:", joinerPlayerData);

                window.peerJsMultiplayer.send({
                    type: 'player_join_info',
                    player: joinerPlayerData
                });
                ui.updateMessageArea("¡Conectado! Iniciando partida...");
            }
        }
    },

    onDataReceived: (data) => {
        console.log(`[PeerJS] RX RAW: Type: ${data.type}`, data);

        if (!state.pvpRemoteActive && !['ping', 'game_init_data', 'player_join_info'].includes(data.type)) {
            console.warn("[PeerJS] Ignoring data (not in PVP remote mode or not initial setup data).", data);
            return;
        }

        switch (data.type) {
            case 'game_init_data':
                if (!state.iAmPlayer1InRemote) {
                    console.log("[PeerJS] JOINER received game_init_data from Host", data);

                    // Set up game dimensions
                    state.setGameDimensions(data.settings.rows, data.settings.cols);
                    state.setNumPlayers(data.settings.numPlayers);

                    // Get host data (Player 0) and my joiner data (Player 1)
                    const hostData = data.hostPlayer;
                    const myJoinerData = {
                        id: 1,
                        name: state.playersData[1]?.name || 'Jugador 2',
                        icon: state.playersData[1]?.icon || state.AVAILABLE_ICONS[1],
                        color: state.playersData[1]?.color || state.DEFAULT_PLAYER_COLORS[1],
                        score: 0
                    };

                    // CRITICAL: Set up players array with correct assignments
                    const remoteSessionPlayers = [
                        { ...hostData, id: 0, score: 0 },     // Host is Player 0
                        { ...myJoinerData, id: 1, score: 0 }  // Joiner is Player 1
                    ];

                    console.log("[PeerConnection] JOINER setting up players:", remoteSessionPlayers);

                    state.setPlayersData(remoteSessionPlayers);
                    state.setRemotePlayersData([...remoteSessionPlayers]);
                    state.setMyPlayerIdInRemoteGame(1); // Joiner is Player 1

                    // Set up turn management
                    state.setTurnCounter(data.initialTurnCounter || 0);
                    state.setCurrentPlayerIndex(0); // Game always starts with Player 0 (host)
                    state.setGameActive(true);
                    state.setIsMyTurnInRemote(false); // Joiner waits for host to start

                    // Initialize the actual game
                    gameLogic.initializeGame(true);
                    ui.updateMessageArea("Esperando a que empiece el host...");
                    ui.setBoardClickable(false); // Joiner can't click yet
                }
                break;

            case 'player_join_info':
                if (state.iAmPlayer1InRemote) { // HOST receives this
                    console.log("[PeerJS] HOST received player_join_info from Joiner. Raw data:", data);

                    const hostData = { // This is Player 0 (Host)
                        id: 0,
                        name: state.playersData[0]?.name || 'Host',
                        icon: state.playersData[0]?.icon || state.AVAILABLE_ICONS[0],
                        color: state.playersData[0]?.color || state.DEFAULT_PLAYER_COLORS[0],
                        score: 0
                    };

                    let joinerData = { ...data.player, id: 1, score: 0 }; // This is Player 1 (Joiner)

                    // ---- START OF CONFLICT RESOLUTION WITH ENHANCED LOGGING ----
                    let originalJoinerName = joinerData.name;
                    let originalJoinerIcon = joinerData.icon;
                    let originalJoinerColor = joinerData.color;

                    let currentJoinerName = joinerData.name;
                    let currentJoinerIcon = joinerData.icon;
                    let currentJoinerColor = joinerData.color;
                    let detailsChanged = false;

                    // Check and resolve name clash
                    if (currentJoinerName === hostData.name) {
                        currentJoinerName = "Oponente"; // Assign a default distinct name
                        if (currentJoinerName === hostData.name) { // If host is also "Oponente"
                            currentJoinerName = "Rival";
                        }
                        detailsChanged = true;
                    }

                    // Check and resolve icon clash
                    if (currentJoinerIcon === hostData.icon) {
                        const hostIconIndex = state.AVAILABLE_ICONS.indexOf(hostData.icon);
                        let newIconIndex = hostIconIndex;
                        if (state.AVAILABLE_ICONS.length > 1) {
                            do {
                                newIconIndex = (newIconIndex + 1) % state.AVAILABLE_ICONS.length;
                            } while (newIconIndex === hostIconIndex);
                            currentJoinerIcon = state.AVAILABLE_ICONS[newIconIndex];
                        } else if (state.AVAILABLE_ICONS.length === 1 && state.AVAILABLE_ICONS[0] !== hostData.icon) {
                            currentJoinerIcon = state.AVAILABLE_ICONS[0];
                        } else {
                            currentJoinerIcon = '❓'; // Fallback
                        }
                        detailsChanged = true;
                    }

                    // Check and resolve color clash
                    if (currentJoinerColor === hostData.color) {
                        const hostColorIndex = state.DEFAULT_PLAYER_COLORS.indexOf(hostData.color);
                        let newColorIndex = hostColorIndex;
                         if (state.DEFAULT_PLAYER_COLORS.length > 1) {
                            do {
                                newColorIndex = (newColorIndex + 1) % state.DEFAULT_PLAYER_COLORS.length;
                            } while (newColorIndex === hostColorIndex);
                            currentJoinerColor = state.DEFAULT_PLAYER_COLORS[newColorIndex];
                        } else if (state.DEFAULT_PLAYER_COLORS.length === 1 && state.DEFAULT_PLAYER_COLORS[0] !== hostData.color) {
                            currentJoinerColor = state.DEFAULT_PLAYER_COLORS[0];
                        } else {
                            currentJoinerColor = '#808080'; // Fallback grey
                        }
                        detailsChanged = true;
                    }

                    if (detailsChanged) {
                        console.log("[PeerConnection] Joiner details clashed with host.");
                        console.log("[PeerConnection] Host Details: ", { name: hostData.name, icon: hostData.icon, color: hostData.color });
                        console.log("[PeerConnection] Original Joiner Details: ", { name: originalJoinerName, icon: originalJoinerIcon, color: originalJoinerColor });
                        console.log("[PeerConnection] Corrected Joiner Details: ", { name: currentJoinerName, icon: currentJoinerIcon, color: currentJoinerColor });

                        joinerData.name = currentJoinerName;
                        joinerData.icon = currentJoinerIcon;
                        joinerData.color = currentJoinerColor;
                    } else {
                        console.log("[PeerConnection] Joiner details did not clash. Using as is: ", joinerData);
                    }
                    // ---- END OF CONFLICT RESOLUTION ----

                    const finalPlayers = [hostData, joinerData];

                    console.log("[PeerConnection] HOST setting up final players based on (potentially corrected) joiner data:", finalPlayers);

                    state.setPlayersData(finalPlayers);
                    state.setRemotePlayersData([...finalPlayers]);
                    state.setMyPlayerIdInRemoteGame(0); // Host is Player 0

                    state.setGameActive(true);
                    state.setCurrentPlayerIndex(0); // Host (Player 0) starts
                    state.setIsMyTurnInRemote(true); // Host's turn first

                    gameLogic.initializeGame(true);
                    ui.updateMessageArea("¡Tu turno! Empezá jugando.");
                    ui.setBoardClickable(true);

                    sendFullGameState();
                }
                break;

            case 'game_move':
                if (data.turnCounter <= state.turnCounter && state.turnCounter !== 0) {
                    console.warn(`[PeerJS] Ignoring stale/duplicate game_move. RX TC: ${data.turnCounter}, Local TC: ${state.turnCounter}.`);
                    return;
                }
                console.log("[PeerJS] Received game_move", data);
                state.setTurnCounter(data.turnCounter);
                gameLogic.applyRemoteMove(data.move);
                break;

            case 'full_state_update':
                if (data.turnCounter <= state.turnCounter && state.turnCounter !== 0 && data.turnCounter !== 0) {
                    console.warn(`[PeerJS] Ignoring stale/duplicate full_state_update. RX TC: ${data.turnCounter}, Local TC: ${state.turnCounter}.`, data);
                    return;
                }
                console.log(`[PeerJS] Received full_state_update. TC: ${data.turnCounter}`, data.gameState); // Log received game state
                gameLogic.applyFullState(data.gameState);
                break;

            case 'restart_request':
                ui.showModalMessageWithActions(`${data.playerName || 'El oponente'} quiere reiniciar. ¿Aceptar?`, [
                    { text: "Sí", action: () => { sendPeerData({ type: 'restart_ack' }); gameLogic.resetGame(true); ui.hideModalMessage(); }},
                    { text: "No", action: () => { sendPeerData({ type: 'restart_nak' }); ui.hideModalMessage(); }}
                ]);
                break;

            case 'restart_ack':
                ui.showModalMessage("Reinicio aceptado. Nueva partida...");
                setTimeout(() => { gameLogic.resetGame(true); ui.hideModalMessage(); }, 1500);
                break;

            case 'restart_nak':
                ui.showModalMessage("El oponente rechazó el reinicio.");
                setTimeout(ui.hideModalMessage, 2000);
                break;

            default:
                console.warn(`[PeerJS] Received unhandled data type: ${data.type}`, data);
        }
    },

    onConnectionClose: () => {
        console.log(`[PeerJS] Connection closed.`);
        if (state.pvpRemoteActive) {
            ui.showModalMessage("El oponente se ha desconectado.");
            ui.updateMessageArea("Conexión perdida.");
        }
        state.resetNetworkState();
        ui.updateGameModeUI();
        if (state.gameActive) gameLogic.endGameAbruptly();
    },

    onError: (err) => {
        console.error(`[PeerJS] Error: `, err);
        let message = err.message || (typeof err === 'string' ? err : 'Error desconocido');
        if (err.type) {
            message = `${err.type}: ${message}`;
            if (err.type === 'peer-unavailable') {
                const peerIdMsgPart = err.message.match(/peer\s(.+)/)?.[1] || 'desconocido';
                message = `No se pudo conectar al jugador: ${peerIdMsgPart}. Verificá el ID e intentá de nuevo.`;
            }
        }
        ui.showModalMessage(`Error de conexión: ${message}`);
        ui.updateMessageArea("Error de conexión.", true);
        state.resetNetworkState();
        ui.updateGameModeUI();
        ui.hideQRCode();
    }
};

// Initialize PeerJS with optional custom callbacks
export function ensurePeerInitialized(customCallbacks = {}) {
    if (window.peerJsMultiplayer?.init) {
        const effectiveCallbacks = {
            ...peerJsCallbacks,
            onPeerOpen: (id) => {
                peerJsCallbacks.onPeerOpen(id);
                customCallbacks.onPeerOpen?.(id);
            },
            onError: (err) => {
                peerJsCallbacks.onError(err);
                customCallbacks.onError?.(err);
            },
            onNewConnection: (conn) => {
                peerJsCallbacks.onNewConnection(conn);
                customCallbacks.onNewConnection?.(conn);
            },
            onConnectionOpen: () => {
                peerJsCallbacks.onConnectionOpen();
                customCallbacks.onConnectionOpen?.();
            },
            onDataReceived: (data) => {
                peerJsCallbacks.onDataReceived(data);
                customCallbacks.onDataReceived?.(data);
            },
            onConnectionClose: () => {
                peerJsCallbacks.onConnectionClose();
                customCallbacks.onConnectionClose?.();
            }
        };
        window.peerJsMultiplayer.init(null, effectiveCallbacks);
    } else {
        console.error("[PeerJS] peerJsMultiplayer.init not found.");
        customCallbacks.onError?.({ type: 'init_failed', message: 'Módulo multijugador no disponible.' });
    }
}

export function initializePeerAsHost(stopPreviousGameCallback) {
    stopPreviousGameCallback?.();
    state.setPvpRemoteActive(true);
    state.setIAmPlayer1InRemote(true);
    state.setGamePaired(false);
    state.setCurrentHostPeerId(null);
    state.setMyPlayerIdInRemoteGame(0); // HOST is Player 0

    ui.updateGameModeUI();
    ui.updateMessageArea("Estableciendo conexión como Host...");
    ui.hideModalMessage();

    ensurePeerInitialized();
}

export function initializePeerAsJoiner(rawHostIdFromUrlOrPrompt, stopPreviousGameCallback) {
    stopPreviousGameCallback?.();
    state.setPvpRemoteActive(true);
    state.setIAmPlayer1InRemote(false);
    state.setGamePaired(false);
    state.setMyPlayerIdInRemoteGame(1); // JOINER is Player 1

    ui.updateGameModeUI();
    ui.hideModalMessage();

    // Use the raw host ID directly (no prefix manipulation needed)
    const hostIdToConnect = rawHostIdFromUrlOrPrompt;

    if (!hostIdToConnect?.trim()) {
        ui.showModalMessage("ID del Host inválido.");
        ui.updateMessageArea("Cancelado.");
        state.resetNetworkState();
        ui.updateGameModeUI();
        return;
    }

    state.setCurrentHostPeerId(hostIdToConnect.trim()); // Store the raw ID
    ui.updateMessageArea(`Intentando conectar a ${hostIdToConnect}...`);
    ui.showModalMessage(`Conectando a ${hostIdToConnect}...`);

    ensurePeerInitialized();
}

export function connectToDiscoveredPeer(opponentRawPeerId) {
    if (!opponentRawPeerId) {
        console.error("connectToDiscoveredPeer: opponentRawPeerId is null or undefined.");
        peerJsCallbacks.onError?.({type: 'connect_error', message: 'ID de par remoto nulo.'});
        return;
    }

    if (window.peerJsMultiplayer?.connect) {
        console.log(`[PeerJS] Attempting to connect to discovered peer: ${opponentRawPeerId}`);
        state.setPvpRemoteActive(true);
        state.setCurrentHostPeerId(opponentRawPeerId); // Store raw ID
        window.peerJsMultiplayer.connect(opponentRawPeerId); // Connect with raw ID
    } else {
        console.error("connectToDiscoveredPeer: peerJsMultiplayer.connect not found.");
        peerJsCallbacks.onError?.({type: 'connect_error', message: 'Función de conexión P2P no disponible.'});
    }
}

export function sendPeerData(data) {
    if (window.peerJsMultiplayer?.send && state.gamePaired) {
        console.log(`[PeerJS] TX: Type: ${data.type}`, data);
        window.peerJsMultiplayer.send(data);
    } else if (!state.gamePaired) {
        console.warn(`[PeerJS] Cannot send, game not paired. Type: ${data.type}.`, data);
    } else {
        console.error(`[PeerJS] peerJsMultiplayer.send not available. Type: ${data.type}.`, data);
    }
}

export function closePeerSession() {
    if (window.peerJsMultiplayer?.close) {
        window.peerJsMultiplayer.close();
    }
}

export function sendFullGameState() {
    if (!state.iAmPlayer1InRemote || !state.gamePaired) return;

    const gameStatePayload = {
        numRows: state.numRows,
        numCols: state.numCols,
        numPlayers: state.numPlayers,
        playersData: state.playersData.map(p => ({
            name: p.name,
            icon: p.icon,
            color: p.color,
            score: p.score,
            id: p.id
        })),
        currentPlayerIndex: state.currentPlayerIndex,
        horizontalLines: state.horizontalLines,
        verticalLines: state.verticalLines,
        boxes: state.boxes,
        filledBoxesCount: state.filledBoxesCount,
        gameActive: state.gameActive,
        turnCounter: state.turnCounter
    };
    console.log("[PeerConnection] HOST sending full_state_update with playersData:", gameStatePayload.playersData); // Added log
    sendPeerData({
        type: 'full_state_update',
        gameState: gameStatePayload,
        turnCounter: state.turnCounter
    });
}