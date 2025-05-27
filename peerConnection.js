// peerConnection.js

import * as state from './state.js';
import * as ui from './ui.js'; // Will be created next, for UI updates
import * as gameLogic from './gameLogic.js'; // Will be created later, for game logic and state updates

// Placeholder for a potential matchmaking module, similar to tateti
// import * as matchmaking from './matchmaking.js';

const peerJsCallbacks = {
    onPeerOpen: (id) => {
        console.log(`[PeerJS] My Peer ID is: ${id}. Am I P1 (host)? ${state.iAmPlayer1InRemote}`);
        state.setMyPeerId(id);

        if (state.pvpRemoteActive && state.iAmPlayer1InRemote) {
            state.setCurrentHostPeerId(id);
            // Modify game ID for Cajitas to avoid collision with Tateti if using the same Supabase table
            const gameLink = `https://YOUR_CAJITAS_GAME_URL/?room=cajitas-${id}`; // Replace with your actual URL
            ui.updateMessageArea(`Compartí este ID para que se unan: cajitas-${id}`); // FIXED
            ui.displayQRCode(gameLink, `cajitas-${id}`); // Pass the modified ID for display
        } else if (state.pvpRemoteActive && !state.iAmPlayer1InRemote && state.currentHostPeerId) {
            if (window.peerJsMultiplayer?.connect) {
                console.log(`[PeerJS] Joiner (my ID ${id}) connecting to host: ${state.currentHostPeerId}`);
                // currentHostPeerId should already have the "cajitas-" prefix if set by host/URL
                window.peerJsMultiplayer.connect(state.currentHostPeerId);
            } else {
                console.error(`[PeerJS] Host ID not set for joiner or connect not available.`);
                ui.showModalMessage("Error: No se pudo conectar al host. El ID del host no está configurado.");
                state.resetNetworkState();
                ui.updateGameModeUI(); // Assumes ui.js will have this
            }
        }
    },

    onNewConnection: (conn) => {
        console.log(`[PeerJS] Incoming connection from ${conn.peer}.`);
        ui.hideQRCode(); // Assuming ui.js will have this
        ui.showModalMessage("Jugador/a conectándose..."); // Translated
        ui.updateMessageArea("Jugador/a conectándose..."); // FIXED

        // For matchmaking scenarios, roles might be determined here or upon connection open.
        // If not using matchmaking and direct hosting, the host is already P1.
        // The first to establish connection could be P1 if roles are dynamic.
        // For Cajitas, the host (P1) usually sets up the game.
    },

    onConnectionOpen: () => {
        console.log(`[PeerJS] Data connection opened.`);
        state.setGamePaired(true);
        ui.hideModalMessage(); // Assuming ui.js will have this
        ui.hideQRCode();

        // Exchange player info
        if (window.peerJsMultiplayer?.send) {
            // Host sends initial game settings and its player data
            // Joiner sends its player data
            if (state.iAmPlayer1InRemote) {
                // Host sends game config and its player data
                const hostPlayerData = state.playersData.find(p => p.id === state.myPlayerIdInRemoteGame) || state.playersData[0]; // Fallback
                window.peerJsMultiplayer.send({
                    type: 'game_init_data',
                    settings: {
                        rows: state.numRows,
                        cols: state.numCols,
                        numPlayers: state.numPlayers, // This will be 2 for P2P
                        players: state.playersData.map(p => ({ name: p.name, icon: p.icon, color: p.color, id: p.id })) // Send all player shells
                    },
                    hostPlayer: hostPlayerData, // Host's specific data
                    initialTurnCounter: state.turnCounter
                });
                 ui.updateMessageArea("¡Conectado! Esperando al Jugador 2..."); // FIXED
            } else {
                // Joiner sends their player data
                const joinerPlayerData = state.playersData.find(p => p.id === state.myPlayerIdInRemoteGame) || state.playersData[1]; // Fallback
                 if(joinerPlayerData) {
                    window.peerJsMultiplayer.send({
                        type: 'player_join_info',
                        player: joinerPlayerData
                    });
                }
                ui.updateMessageArea("¡Conectado! Iniciando partida..."); // FIXED
                // gameLogic.initializeGame(); // Joiner initializes once host confirms or sends start signal
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
            case 'game_init_data': // Received by Joiner from Host
                if (!state.iAmPlayer1InRemote) {
                    console.log("[PeerJS] Joiner received game_init_data from Host", data);
                    state.setGameDimensions(data.settings.rows, data.settings.cols);
                    state.setNumPlayers(data.settings.numPlayers); // Should be 2 for P2P
                    
                    const hostData = data.hostPlayer;
                    const myData = state.playersData.find(p => p.id === state.myPlayerIdInRemoteGame) || state.playersData[1]; 

                    const remoteSessionPlayers = [
                        { ...hostData, id: 0, score: 0 }, 
                        { ...myData, id: 1, score: 0 }   
                    ];
                    state.setPlayersData(remoteSessionPlayers);
                    state.setRemotePlayersData([...remoteSessionPlayers]); 

                    state.setTurnCounter(data.initialTurnCounter || 0);
                    state.setCurrentPlayerIndex(data.initialTurnCounter % state.numPlayers); 
                    state.setGameActive(true);
                    state.setIsMyTurnInRemote(state.currentPlayerIndex === state.myPlayerIdInRemoteGame);


                    gameLogic.initializeGame(true); 
                    ui.updateMessageArea(state.isMyTurnInRemote ? "¡Tu turno!" : `Esperando a ${state.playersData[state.currentPlayerIndex]?.name}...`); // FIXED
                    ui.setBoardClickable(state.isMyTurnInRemote); 
                }
                break;

            case 'player_join_info': // Received by Host from Joiner
                if (state.iAmPlayer1InRemote) {
                    console.log("[PeerJS] Host received player_join_info from Joiner", data);
                    if (state.playersData.length === 2) { 
                        state.playersData[1] = { ...data.player, id: 1, score: 0 };
                        state.setRemotePlayersData([...state.playersData]);
                    }
                    
                    state.setGameActive(true);
                    state.setCurrentPlayerIndex(state.turnCounter % state.numPlayers); 
                    state.setIsMyTurnInRemote(true); 

                    gameLogic.initializeGame(true); 
                     ui.updateMessageArea("¡Tu turno!"); // FIXED
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
                 if (data.turnCounter <= state.turnCounter && state.turnCounter !== 0 && data.turnCounter !== 0) { // also check that received TC isn't 0 if local isn't
                    console.warn(`[PeerJS] Ignoring stale/duplicate full_state_update. RX TC: ${data.turnCounter}, Local TC: ${state.turnCounter}.`, data);
                    return;
                }
                console.log(`[PeerJS] Received full_state_update. TC: ${data.turnCounter}`);
                gameLogic.applyFullState(data.gameState);
                break;

            case 'undo_request':
                break;
            case 'undo_confirm':
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
            ui.updateMessageArea("Conexión perdida."); // FIXED
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
                const peerId = message.match(/peer\s(cajitas-[A-Za-z0-9_-]+)/)?.[1] || 'desconocido';
                message = `No se pudo conectar al jugador: ${peerId}. Verificá el ID e intentá de nuevo.`; 
            }
        }
        ui.showModalMessage(`Error de conexión: ${message}`);
        ui.updateMessageArea("Error de conexión.", true); // FIXED, added isError flag
        state.resetNetworkState();
        ui.updateGameModeUI();
        ui.hideQRCode();
    }
};

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
    state.setMyPlayerIdInRemoteGame(0); 

    ui.updateGameModeUI();
    ui.updateMessageArea("Estableciendo conexión como Host..."); // FIXED
    ui.hideModalMessage();

    ensurePeerInitialized();
}

export function initializePeerAsJoiner(rawHostId, stopPreviousGameCallback) {
    stopPreviousGameCallback?.();
    state.setPvpRemoteActive(true);
    state.setIAmPlayer1InRemote(false);
    state.setGamePaired(false);
    state.setMyPlayerIdInRemoteGame(1); 

    ui.updateGameModeUI();
    ui.hideModalMessage();

    const hostId = rawHostId.startsWith('cajitas-') ? rawHostId : `cajitas-${rawHostId}`;

    if (!hostId?.trim()) {
        ui.showModalMessage("ID del Host no ingresado."); 
        ui.updateMessageArea("Cancelado."); // FIXED
        state.resetNetworkState();
        ui.updateGameModeUI();
        return;
    }

    state.setCurrentHostPeerId(hostId.trim());
    ui.updateMessageArea(`Intentando conectar a ${state.currentHostPeerId}...`); // FIXED
    ui.showModalMessage(`Conectando a ${state.currentHostPeerId}...`); 

    ensurePeerInitialized(); 
}

export function connectToDiscoveredPeer(remotePeerIdWithPrefix) {
     if (!remotePeerIdWithPrefix) {
        console.error("connectToDiscoveredPeer: remotePeerId is null or undefined.");
        peerJsCallbacks.onError?.({type: 'connect_error', message: 'ID de par remoto nulo.'}); 
        return;
    }
    
    if (window.peerJsMultiplayer?.connect) {
        console.log(`[PeerJS] Attempting to connect to discovered peer: ${remotePeerIdWithPrefix}`);
        state.setPvpRemoteActive(true);
        state.setIAmPlayer1InRemote(false); 
        state.setMyPlayerIdInRemoteGame(1); 
        state.setCurrentHostPeerId(remotePeerIdWithPrefix); 
        window.peerJsMultiplayer.connect(remotePeerIdWithPrefix);
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