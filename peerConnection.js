// peerConnection.js - FIXED VERSION

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
                // Host sends initial game setup
                const hostPlayerData = state.playersData.find(p => p.id === state.myPlayerIdInRemoteGame) || state.playersData[0];
                window.peerJsMultiplayer.send({
                    type: 'game_init_data',
                    settings: {
                        rows: state.numRows,
                        cols: state.numCols,
                        numPlayers: state.numPlayers,
                        players: state.playersData.map(p => ({ 
                            name: p.name, 
                            icon: p.icon, 
                            color: p.color, 
                            id: p.id 
                        }))
                    },
                    hostPlayer: hostPlayerData,
                    initialTurnCounter: state.turnCounter
                });
                ui.updateMessageArea("¡Conectado! Esperando al Jugador 2...");
            } else {
                // Joiner sends their info
                const joinerPlayerData = state.playersData.find(p => p.id === state.myPlayerIdInRemoteGame) || state.playersData[1];
                if(joinerPlayerData) {
                    window.peerJsMultiplayer.send({
                        type: 'player_join_info',
                        player: joinerPlayerData
                    });
                }
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
                    console.log("[PeerJS] Joiner received game_init_data from Host", data);
                    
                    // Set up game dimensions and players
                    state.setGameDimensions(data.settings.rows, data.settings.cols);
                    state.setNumPlayers(data.settings.numPlayers);
                    
                    const hostData = data.hostPlayer;
                    const myData = state.playersData.find(p => p.id === state.myPlayerIdInRemoteGame) || state.playersData[1]; 

                    const remoteSessionPlayers = [
                        { ...hostData, id: 0, score: 0 }, 
                        { ...myData, id: 1, score: 0 }   
                    ];
                    state.setPlayersData(remoteSessionPlayers);
                    state.setRemotePlayersData([...remoteSessionPlayers]); 

                    // Set up turn management
                    state.setTurnCounter(data.initialTurnCounter || 0);
                    state.setCurrentPlayerIndex(data.initialTurnCounter % state.numPlayers); 
                    state.setGameActive(true);
                    state.setIsMyTurnInRemote(state.currentPlayerIndex === state.myPlayerIdInRemoteGame);

                    // Initialize the actual game
                    gameLogic.initializeGame(true); 
                    ui.updateMessageArea(state.isMyTurnInRemote ? "¡Tu turno!" : `Esperando a ${state.playersData[state.currentPlayerIndex]?.name}...`);
                    ui.setBoardClickable(state.isMyTurnInRemote); 
                }
                break;

            case 'player_join_info': 
                if (state.iAmPlayer1InRemote) {
                    console.log("[PeerJS] Host received player_join_info from Joiner", data);
                    
                    // Update player 2 data
                    if (state.playersData.length === 2) { 
                        state.playersData[1] = { ...data.player, id: 1, score: 0 };
                        state.setRemotePlayersData([...state.playersData]);
                    }
                    
                    // Start the game
                    state.setGameActive(true);
                    state.setCurrentPlayerIndex(state.turnCounter % state.numPlayers); 
                    state.setIsMyTurnInRemote(state.currentPlayerIndex === state.myPlayerIdInRemoteGame); 

                    gameLogic.initializeGame(true); 
                    ui.updateMessageArea(state.isMyTurnInRemote ? "¡Tu turno!" : `Esperando a ${state.playersData[state.currentPlayerIndex]?.name}...`);
                    ui.setBoardClickable(state.isMyTurnInRemote);

                    // Send back the full game state to sync
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
                console.log(`[PeerJS] Received full_state_update. TC: ${data.turnCounter}`);
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

    // FIXED: Use the raw host ID directly (no prefix manipulation needed)
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
    sendPeerData({ 
        type: 'full_state_update', 
        gameState: gameStatePayload, 
        turnCounter: state.turnCounter 
    });
}