// peerConnection.js - FIXED with proper role detection based on connection direction

import * as state from './state.js';
import * as ui from './ui.js';
import * as gameLogic from './gameLogic.js';
import * as matchmaking from './matchmaking_supabase.js';

const CAJITAS_BASE_URL = "https://cajitas.martinez.fyi";

const peerJsCallbacks = {
    onPeerOpen: (id) => {
        console.log(`[PeerJS] My Peer ID is: ${id}. Am I P1 (host)? ${state.iAmPlayer1InRemote}`);
        state.setMyPeerId(id);

        if (state.pvpRemoteActive && state.iAmPlayer1InRemote) {
            state.setCurrentHostPeerId(id);
            const gameIdForDisplay = `${state.CAJITAS_PEER_ID_PREFIX}${id}`;
            const gameLink = `${CAJITAS_BASE_URL}/?room=${id}`;
            ui.updateMessageArea(`Compartí este enlace o ID: ${gameIdForDisplay}`);
            console.log("[PeerConnection] Game link for QR:", gameLink);
            ui.displayQRCode(gameLink, gameIdForDisplay);

        } else if (state.pvpRemoteActive && !state.iAmPlayer1InRemote && state.currentHostPeerId) {
            if (window.peerJsMultiplayer?.connect) {
                console.log(`[PeerJS] Joiner (my ID ${id}) connecting to host: ${state.currentHostPeerId}`);
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
        
        // CRITICAL FIX: Only override role for random matching, not for intentional hosting
        // If I'm already set as a host (from initializePeerAsHost), keep that role
        // Only override to JOINER if this is from random matching (no explicit host setup)
        
        if (state.currentHostPeerId && state.currentHostPeerId === state.myPeerId) {
            // I am an intentional HOST (link sharing) - keep my role
            console.log(`[PeerJS] I am an intentional HOST (link sharing) - keeping HOST role`);
        } else {
            // This is random matching - I should be the JOINER
            console.log(`[PeerJS] Random matching incoming connection - I will be the JOINER (receive game_init_data)`);
            state.setIAmPlayer1InRemote(false); // I am NOT the network host
            state.setMyPlayerIdInRemoteGame(1);  // I am Player 1 in the game
            state.setPvpRemoteActive(true);
        }
        
        // Stop matchmaking search (applies to both cases)
        console.log(`[PeerJS] Stopping matchmaking search due to incoming connection from ${conn.peer}`);
        matchmaking.stopSearchingDueToIncomingConnection();
        
        ui.hideQRCode();
        ui.showModalMessage("Jugador/a conectándose...");
        ui.updateMessageArea("Jugador/a conectándose...");
    },

    onConnectionOpen: () => {
        console.log(`[PeerJS] Data connection opened. My role - Am I Host? ${state.iAmPlayer1InRemote}`);
        state.setGamePaired(true);
        ui.hideModalMessage();
        ui.hideQRCode();

        if (window.peerJsMultiplayer?.send) {
            if (state.iAmPlayer1InRemote) {
                // I am the HOST - I initiated the connection, so I send game_init_data
                const hostPlayerData = {
                    id: 0,
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
                        players: [hostPlayerData, null]
                    },
                    hostPlayer: hostPlayerData,
                    initialTurnCounter: state.turnCounter
                });
                ui.updateMessageArea("¡Conectado! Esperando respuesta del oponente...");
            } else {
                // I am the JOINER - I received the connection, so I wait for game_init_data
                console.log("[PeerConnection] JOINER connected, waiting for game_init_data from host...");
                ui.updateMessageArea("¡Conectado! Esperando configuración del juego...");
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
                // Only JOINER should receive and process game_init_data
                if (!state.iAmPlayer1InRemote) {
                    console.log("[PeerJS] JOINER received game_init_data from Host", data);
                    state.setGameDimensions(data.settings.rows, data.settings.cols);
                    state.setNumPlayers(data.settings.numPlayers);
                    const hostData = data.hostPlayer;
                    
                    // Use existing player data for joiner, or create default
                    const myJoinerData = {
                        id: 1,
                        name: state.playersData[1]?.name || 'Jugador 2',
                        icon: state.playersData[1]?.icon || state.AVAILABLE_ICONS[1],
                        color: state.playersData[1]?.color || state.DEFAULT_PLAYER_COLORS[1],
                        score: 0
                    };
                    
                    const remoteSessionPlayers = [
                        { ...hostData, id: 0, score: 0 },
                        { ...myJoinerData, id: 1, score: 0 }
                    ];
                    console.log("[PeerConnection] JOINER setting up players:", remoteSessionPlayers);
                    state.setPlayersData(remoteSessionPlayers);
                    state.setRemotePlayersData([...remoteSessionPlayers]);
                    state.setMyPlayerIdInRemoteGame(1);
                    state.setTurnCounter(data.initialTurnCounter || 0);
                    state.setCurrentPlayerIndex(0);
                    state.setGameActive(true);
                    state.setIsMyTurnInRemote(false);
                    gameLogic.initializeGame(true);
                    ui.updateMessageArea("Esperando a que empiece el host...");
                    ui.setBoardClickable(false);

                    // JOINER sends back their player info
                    console.log("[PeerConnection] JOINER sending player_join_info as Player 1:", myJoinerData);
                    window.peerJsMultiplayer.send({
                        type: 'player_join_info',
                        player: myJoinerData
                    });
                } else {
                    console.warn("[PeerJS] HOST received game_init_data - this should not happen in random matching!");
                }
                break;

            case 'player_join_info':
                if (state.iAmPlayer1InRemote) { // HOST receives this
                    console.log("[PeerJS] HOST received player_join_info from Joiner. Raw data:", JSON.stringify(data));

                    const hostData = {
                        id: 0,
                        name: state.playersData[0]?.name || 'Host',
                        icon: state.playersData[0]?.icon || state.AVAILABLE_ICONS[0],
                        color: state.playersData[0]?.color || state.DEFAULT_PLAYER_COLORS[0],
                        score: 0
                    };

                    let joinerData = { ...data.player, id: 1, score: 0 };

                    let originalJoinerName = joinerData.name;
                    let originalJoinerIcon = joinerData.icon;
                    let originalJoinerColor = joinerData.color;

                    let currentJoinerName = joinerData.name;
                    let currentJoinerIcon = joinerData.icon;
                    let currentJoinerColor = joinerData.color;
                    let detailsChanged = false;

                    if (currentJoinerName === hostData.name) {
                        currentJoinerName = "Oponente";
                        if (currentJoinerName === hostData.name) {
                            currentJoinerName = "Rival";
                        }
                        detailsChanged = true;
                    }

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
                            currentJoinerIcon = '❓';
                        }
                        detailsChanged = true;
                    }

                    // Case-insensitive color comparison
                    if (currentJoinerColor.toLowerCase() === hostData.color.toLowerCase()) {
                        const hostColorNormalized = hostData.color.toLowerCase();
                        // Find index of host color in a normalized list of available colors
                        const hostColorIndex = state.DEFAULT_PLAYER_COLORS.findIndex(c => c.toLowerCase() === hostColorNormalized);
                        
                        let newColorIndex = hostColorIndex; // Start assuming it might be the same if only one color
                        if (state.DEFAULT_PLAYER_COLORS.length > 1) {
                            let attempts = 0;
                            do {
                                newColorIndex = (newColorIndex + 1) % state.DEFAULT_PLAYER_COLORS.length;
                                attempts++;
                            // Ensure new index is different from host's index and we don't loop infinitely if all colors somehow match after normalization (highly unlikely with distinct DEFAULT_PLAYER_COLORS)
                            } while (newColorIndex === hostColorIndex && attempts < state.DEFAULT_PLAYER_COLORS.length);
                            
                            if (newColorIndex !== hostColorIndex) { // If a different color was found
                                currentJoinerColor = state.DEFAULT_PLAYER_COLORS[newColorIndex];
                            } else { // All available colors are essentially the same as host's (after normalization), or only one color available
                                currentJoinerColor = '#808080'; // Fallback grey, different from most defaults
                                if (currentJoinerColor.toLowerCase() === hostColorNormalized) { // If host is also grey
                                    currentJoinerColor = '#A9A9A9'; // Darker grey
                                }
                            }
                        } else if (state.DEFAULT_PLAYER_COLORS.length === 1 && state.DEFAULT_PLAYER_COLORS[0].toLowerCase() !== hostColorNormalized) {
                            // Only one default color available, and it's different from host
                            currentJoinerColor = state.DEFAULT_PLAYER_COLORS[0];
                        } else {
                            // Only one default color and it IS the same as host, or no default colors
                            currentJoinerColor = '#808080'; 
                        }
                        detailsChanged = true;
                    }

                    if (detailsChanged) {
                        console.log("[PeerConnection] Joiner details clashed with host or were updated.");
                        console.log(`[PeerConnection] Host Details: Name=${hostData.name}, Icon=${hostData.icon}, Color=${hostData.color}`);
                        console.log(`[PeerConnection] Original Joiner Details: Name=${originalJoinerName}, Icon=${originalJoinerIcon}, Color=${originalJoinerColor}`);
                        console.log(`[PeerConnection] Corrected Joiner Details: Name=${currentJoinerName}, Icon=${currentJoinerIcon}, Color=${currentJoinerColor}`);

                        joinerData.name = currentJoinerName;
                        joinerData.icon = currentJoinerIcon;
                        joinerData.color = currentJoinerColor;
                    } else {
                        console.log(`[PeerConnection] Joiner details did not clash. Using as is: Name=${joinerData.name}, Icon=${joinerData.icon}, Color=${joinerData.color}`);
                    }

                    const finalPlayers = [hostData, joinerData];
                    console.log("[PeerConnection] HOST setting up final players (JSON):", JSON.stringify(finalPlayers));

                    state.setPlayersData(finalPlayers);
                    state.setRemotePlayersData([...finalPlayers]);
                    state.setMyPlayerIdInRemoteGame(0);

                    state.setGameActive(true);
                    state.setCurrentPlayerIndex(0);
                    state.setIsMyTurnInRemote(true);

                    gameLogic.initializeGame(true);
                    ui.updateMessageArea("¡Tu turno! Empezá jugando.");
                    ui.setBoardClickable(true);

                    sendFullGameState();
                } else {
                    console.warn("[PeerJS] JOINER received player_join_info - this should not happen!");
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
                if (data.turnCounter < state.turnCounter && state.turnCounter !== 0 && data.turnCounter !== 0) {
                    console.warn(`[PeerJS] Ignoring stale full_state_update. RX TC: ${data.turnCounter}, Local TC: ${state.turnCounter}. Data:`, data);
                    return;
                }
                console.log(`[PeerJS] Received full_state_update. TC: ${data.turnCounter}. PlayersData (JSON):`, JSON.stringify(data.gameState.playersData));
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

export function ensurePeerInitialized(customCallbacks = {}) {
    if (window.peerJsMultiplayer?.init) {
        const effectiveCallbacks = { ...peerJsCallbacks, ...customCallbacks };
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
    state.setMyPlayerIdInRemoteGame(0);
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
    state.setMyPlayerIdInRemoteGame(1);
    ui.updateGameModeUI();
    ui.hideModalMessage();
    const hostIdToConnect = rawHostIdFromUrlOrPrompt;
    if (!hostIdToConnect?.trim()) {
        ui.showModalMessage("ID del Host inválido.");
        ui.updateMessageArea("Cancelado.");
        state.resetNetworkState();
        ui.updateGameModeUI();
        return;
    }
    state.setCurrentHostPeerId(hostIdToConnect.trim());
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
        
        // CRITICAL: Set role as HOST since I'm initiating the connection
        state.setPvpRemoteActive(true);
        state.setIAmPlayer1InRemote(true);  // I am the network host
        state.setMyPlayerIdInRemoteGame(0); // I am Player 0 in the game
        state.setCurrentHostPeerId(opponentRawPeerId);
        
        console.log(`[PeerJS] connectToDiscoveredPeer: Set myself as HOST (Player 0)`);
        
        window.peerJsMultiplayer.connect(opponentRawPeerId);
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
    console.log("[PeerConnection] HOST sending full_state_update with playersData (JSON):", JSON.stringify(gameStatePayload.playersData));
    sendPeerData({
        type: 'full_state_update',
        gameState: gameStatePayload,
        turnCounter: state.turnCounter
    });
}