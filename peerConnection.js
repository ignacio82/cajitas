// peerConnection.js

import * as state from './state.js';
import * as ui from './ui.js';
import * as gameLogic from './gameLogic.js';

const CAJITAS_BASE_URL = "https://cajitas.martinez.fyi"; // Ensure this is your final deployment URL for QR codes
// For local testing, you might use:
// const CAJITAS_BASE_URL = "http://localhost:YOUR_PORT"; // Replace YOUR_PORT

const peerJsCallbacks = {
    onPeerOpen: (id) => {
        console.log(`[PeerConnection] onPeerOpen: My PeerJS ID is: ${id}. Current state: pvpRemoteActive=${state.pvpRemoteActive}, iAmPlayer1InRemote=${state.iAmPlayer1InRemote}, currentHostPeerId=${state.currentHostPeerId}`);
        state.setMyPeerId(id);

        if (state.pvpRemoteActive && state.iAmPlayer1InRemote) { // HOST
            console.log("[PeerConnection] onPeerOpen: Acting as HOST.");
            state.setCurrentHostPeerId(id);
            const gameIdForLink = `${state.CAJITAS_PEER_ID_PREFIX}${id}`;
            const gameLink = `${CAJITAS_BASE_URL}/?room=${gameIdForLink}`;
            
            console.log("[PeerConnection] CAJITAS_BASE_URL:", CAJITAS_BASE_URL);
            console.log("[PeerConnection] gameLink for QR:", gameLink);

            ui.updateMessageArea(`Compartí este enlace o ID: ${gameIdForLink}`);
            ui.displayQRCode(gameLink, gameIdForLink);

        } else if (state.pvpRemoteActive && !state.iAmPlayer1InRemote && state.currentHostPeerId) { // JOINER
            console.log(`[PeerConnection] onPeerOpen: Acting as JOINER. My PeerJS ID is ${id}. Attempting to connect to host: ${state.currentHostPeerId}`);
            if (window.peerJsMultiplayer?.connect) {
                window.peerJsMultiplayer.connect(state.currentHostPeerId);
                console.log(`[PeerConnection] onPeerOpen: Called peerJsMultiplayer.connect to ${state.currentHostPeerId}`);
            } else {
                console.error(`[PeerConnection] onPeerOpen (Joiner): peerJsMultiplayer.connect not available!`);
                ui.showModalMessage("Error crítico: La función de conexión no está disponible.");
                state.resetNetworkState();
                ui.updateGameModeUI();
            }
        } else {
            console.warn(`[PeerConnection] onPeerOpen: State not ready for host/joiner logic. pvpRemoteActive=${state.pvpRemoteActive}, iAmPlayer1InRemote=${state.iAmPlayer1InRemote}, currentHostPeerId=${state.currentHostPeerId}`);
        }
    },

    onNewConnection: (conn) => { // HOST receives a connection
        console.log(`[PeerConnection] onNewConnection: Incoming connection from ${conn.peer}. Setting up handlers.`);
        // currentConnection is set by peerjs-multiplayer.js wrapper before this is called
        ui.hideQRCode();
        ui.showModalMessage("Jugador/a conectándose...");
        ui.updateMessageArea("Jugador/a conectándose...");
    },

    onConnectionOpen: () => { // Fires for BOTH host and joiner when P2P DataConnection is live
        console.log(`[PeerConnection] onConnectionOpen: Data connection established! gamePaired will be set to true.`);
        state.setGamePaired(true);
        ui.hideModalMessage();
        ui.hideQRCode(); // Ensure QR is hidden for host too once someone connects

        console.log(`[PeerConnection] onConnectionOpen: My role - iAmPlayer1InRemote: ${state.iAmPlayer1InRemote}, myPlayerIdInRemoteGame: ${state.myPlayerIdInRemoteGame}`);

        if (window.peerJsMultiplayer?.send) {
            if (state.iAmPlayer1InRemote) { // HOST sends initial game config
                console.log("[PeerConnection] onConnectionOpen (Host): Preparing to send game_init_data.");
                const hostPlayerData = state.playersData.find(p => p.id === state.myPlayerIdInRemoteGame);
                if (!hostPlayerData) {
                    console.error("[PeerConnection] onConnectionOpen (Host): Host player data not found for ID", state.myPlayerIdInRemoteGame, state.playersData);
                    // Fallback if something went wrong with player data setup
                     ui.showModalMessage("Error interno: Datos del host no encontrados."); return;
                }
                const gameInitPayload = {
                    type: 'game_init_data',
                    settings: {
                        rows: state.numRows,
                        cols: state.numCols,
                        numPlayers: state.numPlayers, // Should be 2
                        players: state.playersData.map(p => ({ name: p.name, icon: p.icon, color: p.color, id: p.id }))
                    },
                    hostPlayer: hostPlayerData, // Contains name, icon, color, id for host
                    initialTurnCounter: state.turnCounter // Should be 0
                };
                console.log("[PeerConnection] onConnectionOpen (Host): Sending game_init_data:", gameInitPayload);
                peerConnection.sendPeerData(gameInitPayload);
                ui.updateMessageArea(`¡Conectado con ${state.playersData[1]?.name || 'Jugador 2'}! Esperando su información...`);
                // Host doesn't start game fully until joiner info is received.
            } else { // JOINER sends their info
                console.log("[PeerConnection] onConnectionOpen (Joiner): Preparing to send player_join_info.");
                const joinerPlayerData = state.playersData.find(p => p.id === state.myPlayerIdInRemoteGame);
                 if(!joinerPlayerData) {
                    console.error("[PeerConnection] onConnectionOpen (Joiner): Joiner player data not found for ID", state.myPlayerIdInRemoteGame, state.playersData);
                    ui.showModalMessage("Error interno: Datos del jugador (joiner) no encontrados."); return;
                 }
                const playerJoinPayload = { type: 'player_join_info', player: joinerPlayerData };
                console.log("[PeerConnection] onConnectionOpen (Joiner): Sending player_join_info:", playerJoinPayload);
                peerConnection.sendPeerData(playerJoinPayload);
                // Joiner still waits for game_init_data from host to fully initialize the game board & settings
                ui.updateMessageArea("¡Conectado! Esperando configuración del host...");
            }
        } else {
            console.error("[PeerConnection] onConnectionOpen: peerJsMultiplayer.send not available!");
        }
    },

    onDataReceived: (data) => {
        console.log(`[PeerConnection] onDataReceived: Type: ${data.type}`, data);

        if (!state.pvpRemoteActive && !['ping', 'game_init_data', 'player_join_info'].includes(data.type)) {
            console.warn("[PeerConnection] onDataReceived: Ignoring data (not in PVP remote mode or not initial setup data).", data);
            return;
        }

        switch (data.type) {
            case 'game_init_data': // JOINER receives this from HOST
                if (!state.iAmPlayer1InRemote) {
                    console.log("[PeerConnection] onDataReceived (Joiner): Received game_init_data from Host", data);
                    if (!data.settings || !data.hostPlayer) {
                        console.error("[PeerConnection] onDataReceived (Joiner): Invalid game_init_data structure.", data);
                        ui.showModalMessage("Error: Datos de inicio del juego inválidos del host.");
                        return;
                    }
                    state.setGameDimensions(data.settings.rows, data.settings.cols);
                    state.setNumPlayers(data.settings.numPlayers);
                    
                    const hostData = data.hostPlayer; // host is player 0
                    const myDataForJoiner = state.playersData.find(p => p.id === state.myPlayerIdInRemoteGame); // My data as joiner (player 1)

                    if (!myDataForJoiner) {
                        console.error("[PeerConnection] onDataReceived (Joiner): Could not find local joiner data. This is unexpected.", state.playersData, state.myPlayerIdInRemoteGame);
                        // Create a fallback if needed, though main.js should have set it up.
                        myDataForJoiner = { id: 1, name: "Joiner (Fallback)", icon: "❓", color: state.DEFAULT_PLAYER_COLORS[1], score: 0 };
                    }
                    
                    const remoteSessionPlayers = [
                        { ...hostData, id: 0, score: 0 }, 
                        { ...myDataForJoiner, id: 1, score: 0 }   
                    ];
                    state.setPlayersData(remoteSessionPlayers);
                    state.setRemotePlayersData([...remoteSessionPlayers]); 

                    state.setTurnCounter(data.initialTurnCounter || 0);
                    state.setCurrentPlayerIndex(data.initialTurnCounter % state.numPlayers); 
                    state.setGameActive(true);
                    state.setIsMyTurnInRemote(state.currentPlayerIndex === state.myPlayerIdInRemoteGame);

                    console.log("[PeerConnection] onDataReceived (Joiner): Initializing game with host settings.");
                    gameLogic.initializeGame(true); 
                    ui.updateMessageArea(state.isMyTurnInRemote ? "¡Tu turno!" : `Esperando a ${state.playersData[state.currentPlayerIndex]?.name}...`);
                    ui.setBoardClickable(state.isMyTurnInRemote); 
                }
                break;

            case 'player_join_info': // HOST receives this from JOINER
                if (state.iAmPlayer1InRemote) {
                    console.log("[PeerConnection] onDataReceived (Host): Received player_join_info from Joiner", data);
                     if (!data.player) {
                        console.error("[PeerConnection] onDataReceived (Host): Invalid player_join_info structure.", data);
                        ui.showModalMessage("Error: Datos del jugador que se une son inválidos.");
                        return;
                    }
                    if (state.playersData.length >= 2) { 
                        state.playersData[1] = { ...data.player, id: 1, score: 0 }; // Joiner is player 1
                        state.setRemotePlayersData([...state.playersData]);
                        ui.updateScoresDisplay(); // Update scores to show joiner's name/icon
                        console.log("[PeerConnection] onDataReceived (Host): Updated P2 data:", state.playersData[1]);
                    } else {
                        console.error("[PeerConnection] onDataReceived (Host): playersData array not correctly initialized for 2 players.");
                    }
                    
                    state.setGameActive(true);
                    state.setCurrentPlayerIndex(state.turnCounter % state.numPlayers); 
                    state.setIsMyTurnInRemote(true); // Host starts or continues if turnCounter > 0 implies joiner moved first (not typical)

                    console.log("[PeerConnection] onDataReceived (Host): Initializing game fully.");
                    gameLogic.initializeGame(true); 
                    ui.updateMessageArea(`¡Tu turno! Jugando contra ${state.playersData[1]?.name || 'Jugador 2'}.`);
                    ui.setBoardClickable(true);

                    // Optionally send a full state update now if host already made moves (not typical for this handshake)
                    // or a simple "game_start_ack" if needed.
                    // For now, initializeGame should suffice.
                }
                break;

            case 'game_move':
                if (data.turnCounter <= state.turnCounter && state.turnCounter !== 0 && state.gameActive) { // Check gameActive too
                    console.warn(`[PeerConnection] onDataReceived: Ignoring stale/duplicate game_move. RX TC: ${data.turnCounter}, Local TC: ${state.turnCounter}.`);
                    return;
                }
                console.log("[PeerConnection] onDataReceived: Applying remote game_move", data);
                state.setTurnCounter(data.turnCounter); // Update turn counter first
                gameLogic.applyRemoteMove(data.move); 
                break;

            case 'full_state_update':
                 if (data.turnCounter < state.turnCounter && state.gameActive) { // Only accept if newer or if local isn't active (initial sync)
                    console.warn(`[PeerConnection] onDataReceived: Ignoring stale full_state_update. RX TC: ${data.turnCounter}, Local TC: ${state.turnCounter}.`, data);
                    return;
                }
                console.log(`[PeerConnection] onDataReceived: Applying full_state_update. TC: ${data.turnCounter}`);
                gameLogic.applyFullState(data.gameState);
                break;

            case 'restart_request':
                if(!state.gameActive && state.pvpRemoteActive && state.gamePaired) { // If game already ended locally, auto-ack
                     console.log("[PeerConnection] Game ended, auto-acking restart_request.");
                     sendPeerData({ type: 'restart_ack' });
                     gameLogic.resetGame(true); // Reset self
                     return;
                }
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
                console.warn(`[PeerConnection] onDataReceived: Received unhandled data type: ${data.type}`, data);
        }
    },

    onConnectionClose: () => {
        console.log(`[PeerConnection] onConnectionClose: Connection closed.`);
        if (state.pvpRemoteActive) {
            ui.showModalMessage("El oponente se ha desconectado."); 
            ui.updateMessageArea("Conexión perdida.");
        }
        state.resetNetworkState();
        ui.updateGameModeUI();
        if (state.gameActive) gameLogic.endGameAbruptly(); 
    },

    onError: (err) => {
        console.error(`[PeerConnection] onError: PeerJS Error: `, err);
        let message = err.message || (typeof err === 'string' ? err : 'Error desconocido'); 
        if (err.type) {
            message = `${err.type}: ${message}`;
            if (err.type === 'peer-unavailable') {
                const peerIdMsgPart = err.message?.match(/peer\s(.+)/)?.[1] || state.currentHostPeerId || 'desconocido';
                message = `No se pudo conectar al jugador: ${peerIdMsgPart}. Verificá el ID e intentá de nuevo.`; 
            } else if (err.type === 'network') {
                message = "Error de red. Verificá tu conexión a internet e intentá de nuevo.";
            } else if (err.type === 'webrtc') {
                 message = "Error de WebRTC al establecer la conexión. Esto puede ser por firewalls o configuración de red.";
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
    console.log("[PeerConnection] ensurePeerInitialized called.");
    if (window.peerJsMultiplayer?.init) {
        const effectiveCallbacks = {
            ...peerJsCallbacks, // Default game handlers
            onPeerOpen: (id) => {
                console.log("[PeerConnection] ensurePeerInitialized: onPeerOpen wrapper fired.");
                peerJsCallbacks.onPeerOpen(id); // Call original game's onPeerOpen
                customCallbacks.onPeerOpen?.(id); // Call any custom onPeerOpen (e.g., from matchmaking)
            },
            onError: (err) => {
                console.log("[PeerConnection] ensurePeerInitialized: onError wrapper fired.");
                peerJsCallbacks.onError(err); // Call original game's onError
                customCallbacks.onError?.(err); // Call any custom onError
            },
             onNewConnection: (conn) => {
                console.log("[PeerConnection] ensurePeerInitialized: onNewConnection wrapper fired.");
                peerJsCallbacks.onNewConnection(conn);
                customCallbacks.onNewConnection?.(conn);
            },
            onConnectionOpen: () => {
                console.log("[PeerConnection] ensurePeerInitialized: onConnectionOpen wrapper fired.");
                peerJsCallbacks.onConnectionOpen();
                customCallbacks.onConnectionOpen?.();
            },
            onDataReceived: (data) => {
                console.log("[PeerConnection] ensurePeerInitialized: onDataReceived wrapper fired.");
                peerJsCallbacks.onDataReceived(data);
                customCallbacks.onDataReceived?.(data);
            },
            onConnectionClose: () => {
                console.log("[PeerConnection] ensurePeerInitialized: onConnectionClose wrapper fired.");
                peerJsCallbacks.onConnectionClose();
                customCallbacks.onConnectionClose?.();
            }
        };
        console.log("[PeerConnection] Calling peerJsMultiplayer.init.");
        window.peerJsMultiplayer.init(null, effectiveCallbacks); // Pass null for PeerJS to generate ID
    } else {
        console.error("[PeerConnection] ensurePeerInitialized: peerJsMultiplayer.init not found.");
        customCallbacks.onError?.({ type: 'init_failed', message: 'Módulo multijugador no disponible.' }); 
    }
}

export function initializePeerAsHost(stopPreviousGameCallback) {
    console.log("[PeerConnection] initializePeerAsHost called.");
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
    console.log(`[PeerConnection] initializePeerAsJoiner called with rawHostIdFromUrlOrPrompt: '${rawHostIdFromUrlOrPrompt}'`);
    stopPreviousGameCallback?.();
    state.setPvpRemoteActive(true);
    state.setIAmPlayer1InRemote(false);
    state.setGamePaired(false);
    state.setMyPlayerIdInRemoteGame(1); 

    ui.updateGameModeUI(); // Update UI early to reflect "joining" mode
    ui.hideModalMessage();

    const hostIdToConnect = rawHostIdFromUrlOrPrompt.startsWith(state.CAJITAS_PEER_ID_PREFIX)
        ? rawHostIdFromUrlOrPrompt
        : `${state.CAJITAS_PEER_ID_PREFIX}${rawHostIdFromUrlOrPrompt}`;

    console.log(`[PeerConnection] initializePeerAsJoiner: hostIdToConnect set to '${hostIdToConnect}'`);

    if (!hostIdToConnect?.trim() || !hostIdToConnect.includes(state.CAJITAS_PEER_ID_PREFIX)) {
        console.error(`[PeerConnection] initializePeerAsJoiner: Invalid hostIdToConnect: '${hostIdToConnect}'`);
        ui.showModalMessage("ID del Host inválido. Debe incluir el prefijo 'cajitas-'."); 
        ui.updateMessageArea("Cancelado. ID de host inválido."); 
        state.resetNetworkState();
        ui.updateGameModeUI(); // Reset UI back to normal setup
        return;
    }

    state.setCurrentHostPeerId(hostIdToConnect.trim());
    console.log(`[PeerConnection] initializePeerAsJoiner: state.currentHostPeerId set to '${state.currentHostPeerId}'`);
    ui.updateMessageArea(`Intentando conectar a ${state.currentHostPeerId}...`); 
    // ui.showModalMessage(`Conectando a ${state.currentHostPeerId}...`); // Can be too intrusive if connection is fast

    ensurePeerInitialized(); 
}

export function connectToDiscoveredPeer(opponentRawPeerId) {
    console.log(`[PeerConnection] connectToDiscoveredPeer called with opponentRawPeerId: '${opponentRawPeerId}'`);
     if (!opponentRawPeerId) {
        console.error("[PeerConnection] connectToDiscoveredPeer: opponentRawPeerId is null or undefined.");
        peerJsCallbacks.onError?.({type: 'connect_error', message: 'ID de par remoto nulo (matchmaking).'}); 
        return;
    }
    
    // The ID from matchmaking should be raw, so we prefix it for the connection.
    // The host would have registered its prefixed ID. However, peer.connect needs the ID exactly as registered with PeerServer.
    // My matchmaking_supabase.js stores "cajitas-RAW_ID" in Supabase.
    // So, if matchmaking returns "cajitas-RAW_ID_OPPONENT", that's what we connect to.
    // If matchmaking returns "RAW_ID_OPPONENT", then we'd prefix it.
    // Let's assume matchmaking returns the ID *as it is stored in Supabase* (i.e., prefixed for Cajitas).
    // The `peerjs-multiplayer.js` `connect` function just takes the ID string.
    const opponentFullPeerIdToConnect = opponentRawPeerId.startsWith(state.CAJITAS_PEER_ID_PREFIX)
        ? opponentRawPeerId
        : `${state.CAJITAS_PEER_ID_PREFIX}${opponentRawPeerId}`;

    console.log(`[PeerConnection] connectToDiscoveredPeer: opponentFullPeerIdToConnect set to '${opponentFullPeerIdToConnect}'`);


    if (window.peerJsMultiplayer?.connect) {
        console.log(`[PeerConnection] connectToDiscoveredPeer: Calling peerJsMultiplayer.connect to '${opponentFullPeerIdToConnect}'`);
        state.setPvpRemoteActive(true); // Ensure this is set
        // iAmPlayer1InRemote and myPlayerIdInRemoteGame should have been set by main.js before calling this
        state.setCurrentHostPeerId(opponentFullPeerIdToConnect); 
        window.peerJsMultiplayer.connect(opponentFullPeerPeerIdToConnect);
    } else {
        console.error("[PeerConnection] connectToDiscoveredPeer: peerJsMultiplayer.connect not found.");
        peerJsCallbacks.onError?.({type: 'connect_error', message: 'Función de conexión P2P no disponible (matchmaking).'}); 
    }
}


export function sendPeerData(data) {
    if (window.peerJsMultiplayer?.send && state.gamePaired) {
        console.log(`[PeerConnection] sendPeerData TX: Type: ${data.type}`, data);
        window.peerJsMultiplayer.send(data);
    } else if (!state.gamePaired) {
        console.warn(`[PeerConnection] sendPeerData: Cannot send, game not paired. Type: ${data.type}.`, data);
    } else {
        console.error(`[PeerConnection] sendPeerData: peerJsMultiplayer.send not available. Type: ${data.type}.`, data);
    }
}

export function closePeerSession() {
    console.log("[PeerConnection] closePeerSession called.");
    if (window.peerJsMultiplayer?.close) {
        window.peerJsMultiplayer.close();
    }
}

export function sendFullGameState() {
    if (!state.iAmPlayer1InRemote || !state.gamePaired) {
        console.warn("[PeerConnection] sendFullGameState: Conditions not met (not host or not paired).");
        return;
    }
    console.log("[PeerConnection] sendFullGameState: Preparing to send full state.");

    const gameStatePayload = {
        numRows: state.numRows,
        numCols: state.numCols,
        numPlayers: state.numPlayers, // Should be 2 for P2P
        playersData: state.playersData.map(p => ({ name: p.name, icon: p.icon, color: p.color, score: p.score, id: p.id })),
        currentPlayerIndex: state.currentPlayerIndex,
        horizontalLines: state.horizontalLines,
        verticalLines: state.verticalLines,
        boxes: state.boxes,
        filledBoxesCount: state.filledBoxesCount,
        gameActive: state.gameActive,
        turnCounter: state.turnCounter
    };
    sendPeerData({ type: 'full_state_update', gameState: gameStatePayload, turnCounter: state.turnCounter });
}