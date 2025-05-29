// peerConnection.js

import * as state from './state.js';
import * as ui from './ui.js';
import * as gameLogic from './gameLogic.js';
import * as matchmaking from './matchmaking_supabase.js';

const CAJITAS_BASE_URL = "https://cajitas.martinez.fyi"; // Or your game's URL

// Store active P2P connections.
// If leader: Map of peerId -> PeerJS DataConnection
// If client: Single connection to the leader.
let connections = new Map();
let leaderConnection = null; // For clients, this is their connection to the leader

// --- MESSAGE TYPES ---
const MSG_TYPE = {
    // Room Management
    REQUEST_JOIN_ROOM: 'request_join_room',        // Client to Leader: I want to join your room
    JOIN_ACCEPTED: 'join_accepted',                // Leader to Client: Welcome, here's room state & your ID
    JOIN_REJECTED: 'join_rejected',                // Leader to Client: Room full or other reason
    PLAYER_JOINED: 'player_joined',                // Leader to all Clients: New player has joined
    PLAYER_LEFT: 'player_left',                    // Leader to all Clients: A player has left
    ROOM_STATE_UPDATE: 'room_state_update',        // Leader to all Clients: Full update of room (players, settings)
    PLAYER_READY_CHANGED: 'player_ready_changed',  // Client to Leader (or Leader updates self): Player's ready status toggled
                                                   // Leader to all Clients: Broadcast of the change

    // Game Start & Sync
    START_GAME_REQUEST: 'start_game_request',      // Leader to Self (or internal trigger): Request to start game
    GAME_STARTED: 'game_started',                  // Leader to all Clients: Game is now active, here's initial state
    FULL_GAME_STATE: 'full_game_state',            // Leader to all Clients: Complete game state for sync

    // In-Game Actions
    GAME_MOVE: 'game_move',                        // Client to Leader: Player made a move
                                                   // Leader to all Clients: Broadcast of validated move
    // Game End/Reset
    GAME_OVER_ANNOUNCEMENT: 'game_over_announcement', // Leader to all Clients: Game has ended, here are results
    RESTART_GAME_REQUEST: 'restart_game_request',  // Client to Leader: Propose a new game
    RESTART_GAME_RESPONSE: 'restart_game_response',// Leader to Client(s): Ack/Nak for restart
    // PING/PONG for connection health could be added if needed
};


// --- PeerJS Callbacks (Wrapper) ---
const peerJsCallbacks = {
    onPeerOpen: (id) => {
        console.log(`[PeerJS] My Peer ID is: ${id}.`);
        state.setMyPeerId(id);
    
        // If peer opened as part of hosting or joining, the specific functions will continue the flow.
        // This callback is general.
        if (state.pvpRemoteActive && state.networkRoomData.isRoomLeader && !state.networkRoomData.roomId) {
            // This peer just opened, and we intend to be a leader. Finalize room creation.
            state.setNetworkRoomData({ roomId: id, leaderPeerId: id });
            console.log(`[PeerConn] Room created by host. Room ID (Host Peer ID): ${id}`);
    
            // Add self to player list in roomData (already done partially in hostNewRoom)
            // and show lobby.
            ui.showLobbyScreen();
            ui.updateLobbyUI();
            
            // IMPORTANT: Display QR code BEFORE calling updateGameModeUI
            const gameLink = `${CAJITAS_BASE_URL}/?room=${id}&slots=${state.networkRoomData.maxPlayers}`;
            ui.displayQRCode(gameLink, `${state.CAJITAS_PEER_ID_PREFIX}${id}`,
                `Compartí este enlace o ID para que ${state.networkRoomData.maxPlayers -1} jugador(es) más se unan:`);
            
            // Call updateGameModeUI AFTER QR code is displayed to ensure proper state
            ui.updateGameModeUI();
    
            // If this was a random match host, update matchmaking service
            if (state.networkRoomData.roomState === 'creating_random_match_room') {
                matchmaking.updateHostedRoomStatus(id, state.networkRoomData.gameSettings, state.networkRoomData.maxPlayers, state.networkRoomData.players.length);
                state.setNetworkRoomData({ roomState: 'waiting_for_players' });
            }
    
        } else if (state.pvpRemoteActive && !state.networkRoomData.isRoomLeader && state.networkRoomData.roomId && state.networkRoomData.leaderPeerId && !leaderConnection) {
            // This peer just opened, and we intend to join a specific leader.
            console.log(`[PeerConn] Joiner (my ID ${id}) connecting to leader: ${state.networkRoomData.leaderPeerId}`);
            if (window.peerJsMultiplayer?.connect) {
                const connToLeader = window.peerJsMultiplayer.connect(state.networkRoomData.leaderPeerId);
                if (connToLeader) {
                    leaderConnection = connToLeader; // Store the attempt
                    setupConnectionEventHandlers(leaderConnection, true); // true = isLeaderConnection
                } else {
                     console.error(`[PeerConn] peer.connect() returned null when trying to connect to leader.`);
                     peerJsCallbacks.onError({type: 'connect_failed', message: 'Failed to initiate connection to leader.'});
                }
            } else {
                peerJsCallbacks.onError({type: 'connect_error', message: 'PeerJS connect not available.'});
            }
        }
        // Other scenarios (like pre-initialization) are handled by their respective calling functions.
    },

    onNewConnection: (conn) => { // Only relevant for the Room Leader
        if (!state.networkRoomData.isRoomLeader) {
            console.warn(`[PeerJS] Non-leader received a connection from ${conn.peer}. Rejecting.`);
            conn.on('open', () => conn.close()); // Close if it opens
            return;
        }
        if (state.networkRoomData.players.length >= state.networkRoomData.maxPlayers) {
            console.warn(`[PeerJS] Room is full. Rejecting connection from ${conn.peer}.`);
            conn.on('open', () => {
                conn.send({ type: MSG_TYPE.JOIN_REJECTED, reason: 'room_full' });
                setTimeout(() => conn.close(), 500); 
            });
            return;
        }
        console.log(`[PeerJS] Leader received incoming connection from ${conn.peer}.`);
        setupConnectionEventHandlers(conn, false); 
    },

    onConnectionOpen: (peerId) => { 
        console.log(`[PeerJS] Data connection opened with ${peerId}.`);
        if (state.networkRoomData.isRoomLeader) {
            console.log(`[PeerConn] Leader: Connection from ${peerId} is now open. Waiting for their join request.`);
             const conn = connections.get(peerId);
             if(conn && conn.open) {
             } else {
                console.warn(`[PeerConn] Leader: Connection object for ${peerId} not found or not open after 'open' event.`);
             }
        } else { 
            if (peerId === state.networkRoomData.leaderPeerId && leaderConnection && leaderConnection.open) {
                console.log(`[PeerConn] Client: Connection to leader ${peerId} is now open. Sending join request.`);
                const myInitialData = state.networkRoomData.players.find(p => p.peerId === state.myPeerId); 
                if (myInitialData) {
                    sendDataToLeader({
                        type: MSG_TYPE.REQUEST_JOIN_ROOM,
                        playerData: { name: myInitialData.name, icon: myInitialData.icon, color: myInitialData.color }
                    });
                    state.setNetworkRoomData({ roomState: 'awaiting_join_approval' });
                    ui.showModalMessage(`Conectado al líder. Esperando aprobación para unirse a la sala ${state.CAJITAS_PEER_ID_PREFIX}${state.networkRoomData.roomId}...`);
                } else {
                    console.error("[PeerConn] Client: Own player data not found to send join request.");
                     peerJsCallbacks.onError({type: 'internal_error', message: 'Player data for join request missing.'});
                }
            }
        }
    },

    onDataReceived: (data, fromPeerId) => {
        console.log(`[PeerJS] RX from ${fromPeerId}: Type: ${data.type}`, data);

        if (state.networkRoomData.isRoomLeader) {
            handleLeaderDataReception(data, fromPeerId);
        } else {
            handleClientDataReception(data, fromPeerId);
        }
    },

    onConnectionClose: (peerId) => {
        console.log(`[PeerJS] Connection with ${peerId} closed.`);
        if (state.networkRoomData.isRoomLeader) {
            const leavingPlayer = state.networkRoomData.players.find(p => p.peerId === peerId);
            if (leavingPlayer) {
                state.removePlayerFromNetworkRoom(peerId);
                connections.delete(peerId);
                broadcastToRoom({ type: MSG_TYPE.PLAYER_LEFT, playerId: leavingPlayer.id, peerId: peerId });
                reassignPlayerIdsAndBroadcastUpdate();
                ui.updateLobbyUI(); 
                if (state.networkRoomData.roomState === 'in_game' && state.networkRoomData.players.length < state.MIN_PLAYERS_NETWORK) {
                    ui.showModalMessage(`Jugador ${leavingPlayer.name} se desconectó. No hay suficientes jugadores para continuar.`);
                    gameLogic.endGameAbruptly(); 
                    state.setNetworkRoomData({ roomState: 'game_over' }); 
                }
            }
        } else { 
            if (peerId === state.networkRoomData.leaderPeerId) {
                console.error("[PeerConn] Client: Connection to leader lost!");
                ui.showModalMessage("Se perdió la conexión con el líder de la sala.");
                connections.clear();
                leaderConnection = null;
                state.resetNetworkRoomData();
                state.setPvpRemoteActive(false);
                ui.showSetupScreen();
                if (state.gameActive) gameLogic.endGameAbruptly();
            }
        }
    },

    onError: (err, peerIdContext = null) => {
        console.error(`[PeerJS] Error (context: ${peerIdContext || 'general'}): `, err);
        let message = err.message || (typeof err === 'string' ? err : 'Error desconocido');
        if (err.type) {
            message = `${err.type}: ${message}`;
            if (err.type === 'peer-unavailable' || err.type === 'unavailable-id') {
                const peerIdMsgPart = peerIdContext || err.message.match(/peer\s(.+)/)?.[1] || state.networkRoomData.leaderPeerId || 'remoto';
                message = `No se pudo conectar al jugador: ${peerIdMsgPart}. Verificá el ID/disponibilidad.`;
                 if (state.networkRoomData.roomState === 'connecting_to_lobby' || state.networkRoomData.roomState === 'awaiting_join_approval') {
                    state.resetNetworkRoomData();
                    state.setPvpRemoteActive(false);
                    ui.showSetupScreen();
                 }
            } else if (err.type === 'network') {
                message = "Error de red. Verificá tu conexión a internet.";
            } else if (err.type === 'webrtc') {
                message = "Error de WebRTC. Puede ser un problema de firewall o red.";
            }
        }
        ui.showModalMessage(`Error de conexión: ${message}`);
        ui.updateMessageArea("Error de conexión.", true);
        
        if (!state.networkRoomData.isRoomLeader && (!leaderConnection || !leaderConnection.open)) {
            state.resetNetworkRoomData();
            state.setPvpRemoteActive(false);
            ui.showSetupScreen();
            ui.hideQRCode();
        } 
    }
};

function reassignPlayerIdsAndBroadcastUpdate() {
    if (!state.networkRoomData.isRoomLeader) return;

    const sortedPlayers = state.networkRoomData.players
        .filter(p => p.isConnected) 
        .sort((a, b) => a.id - b.id); 

    let idChanged = false;
    sortedPlayers.forEach((player, index) => {
        if (player.id !== index) {
            idChanged = true;
        }
        player.id = index; 
        if (player.peerId === state.myPeerId) { 
            state.setNetworkRoomData({ myPlayerIdInRoom: index });
        }
    });
    state.setNetworkRoomData({ players: sortedPlayers }); 

    if (idChanged || true) { 
       broadcastRoomState();
    }
}


// --- Data Reception Handlers ---
function handleLeaderDataReception(data, fromPeerId) {
    const clientConn = connections.get(fromPeerId);
    if (!clientConn && data.type !== MSG_TYPE.REQUEST_JOIN_ROOM) { 
        console.warn(`[PeerConn L] Data from unknown or untracked peer ${fromPeerId}. Type: ${data.type}. Ignored.`);
        return;
    }

    switch (data.type) {
        case MSG_TYPE.REQUEST_JOIN_ROOM:
            if (state.networkRoomData.players.length >= state.networkRoomData.maxPlayers) {
                clientConn?.send({ type: MSG_TYPE.JOIN_REJECTED, reason: 'room_full' });
                return;
            }
            const newPlayerId = state.networkRoomData.players.length; 

            const newPlayer = {
                ...data.playerData, 
                id: newPlayerId,
                peerId: fromPeerId,
                isReady: false,
                isConnected: true,
                score: 0
            };
            state.addPlayerToNetworkRoom(newPlayer);
            const connToStore = clientConn || window.peerJsMultiplayer.getConnection(fromPeerId); 
            if (connToStore) connections.set(fromPeerId, connToStore);
            else console.error(`[PeerConn L] No connection object found for ${fromPeerId} during JOIN_REQUEST.`);

            sendDataToClient(fromPeerId, {
                type: MSG_TYPE.JOIN_ACCEPTED,
                yourPlayerId: newPlayerId,
                roomData: state.networkRoomData 
            });

            broadcastToRoom({ type: MSG_TYPE.PLAYER_JOINED, player: newPlayer }, fromPeerId); 

            ui.updateLobbyUI(); 
            matchmaking.updateHostedRoomStatus(state.networkRoomData.roomId, state.networkRoomData.gameSettings, state.networkRoomData.maxPlayers, state.networkRoomData.players.length);
            break;

        case MSG_TYPE.PLAYER_READY_CHANGED:
            const playerToUpdate = state.networkRoomData.players.find(p => p.peerId === fromPeerId);
            if (playerToUpdate) {
                playerToUpdate.isReady = data.isReady;
                broadcastToRoom({
                    type: MSG_TYPE.PLAYER_READY_CHANGED,
                    playerId: playerToUpdate.id,
                    peerId: fromPeerId,
                    isReady: data.isReady
                });
                ui.updateLobbyUI(); 
            }
            break;

        case MSG_TYPE.GAME_MOVE:
            if (state.networkRoomData.roomState !== 'in_game' || !state.gameActive) {
                console.warn("[PeerConn L] Game move received but game not active. Ignored.");
                return;
            }
            const movingPlayer = state.networkRoomData.players.find(p => p.peerId === fromPeerId);
            if (movingPlayer && movingPlayer.id === state.currentPlayerIndex) {
                state.incrementTurnCounter(); 
                gameLogic.processMove(data.move.type, data.move.r, data.move.c, movingPlayer.id, false, true); 
                
                broadcastToRoom({
                    type: MSG_TYPE.GAME_MOVE,
                    move: { ...data.move, playerIndex: movingPlayer.id }, 
                    turnCounter: state.networkRoomData.turnCounter, 
                    nextPlayerIndex: state.currentPlayerIndex,
                    updatedScores: state.playersData.map(p => ({id: p.id, score: p.score})),
                    boxesJustCompleted: data.move.boxesJustCompleted 
                });

                if (!state.gameActive && state.networkRoomData.roomState === 'in_game') { 
                    state.setNetworkRoomData({ roomState: 'game_over' });
                    broadcastToRoom({
                        type: MSG_TYPE.GAME_OVER_ANNOUNCEMENT,
                        winners: gameLogic.getWinnerData(), 
                        scores: state.playersData.map(p => ({id: p.id, name: p.name, score: p.score}))
                    });
                }
            } else {
                console.warn(`[PeerConn L] Move from ${fromPeerId} (P${movingPlayer?.id}) but it's P${state.currentPlayerIndex}'s turn. Ignored.`);
            }
            break;
    }
}

function handleClientDataReception(data, fromLeaderPeerId) {
    if (fromLeaderPeerId !== state.networkRoomData.leaderPeerId) {
        console.warn(`[PeerConn C] Data from non-leader peer ${fromLeaderPeerId}. Ignored.`);
        return;
    }

    switch (data.type) {
        case MSG_TYPE.JOIN_ACCEPTED:
            ui.hideModalMessage();
            state.setNetworkRoomData({
                myPlayerIdInRoom: data.yourPlayerId,
                players: data.roomData.players, 
                gameSettings: data.roomData.gameSettings,
                maxPlayers: data.roomData.maxPlayers,
                roomState: 'lobby' 
            });
            const myDataIndex = state.networkRoomData.players.findIndex(p => p.id === data.yourPlayerId);
            if (myDataIndex !== -1) {
                const preJoinData = state.networkRoomData.players.find(p => p.peerId === state.myPeerId && p.id !== data.yourPlayerId); 
                if(preJoinData) { 
                    state.networkRoomData.players[myDataIndex].name = preJoinData.name;
                    state.networkRoomData.players[myDataIndex].icon = preJoinData.icon;
                    state.networkRoomData.players[myDataIndex].color = preJoinData.color;
                }
            }

            ui.showLobbyScreen();
            ui.updateLobbyUI();
            ui.updateGameModeUI();
            console.log(`[PeerConn C] Joined room! My Player ID: ${data.yourPlayerId}. Room Data:`, data.roomData);
            ui.updateLobbyMessage("¡Te uniste a la sala! Marcate como listo cuando quieras.");
            break;

        case MSG_TYPE.JOIN_REJECTED:
            ui.showModalMessage(`No se pudo unir a la sala: ${data.reason || 'Rechazado por el líder.'}`);
            leaveRoom(); 
            break;

        case MSG_TYPE.PLAYER_JOINED:
            if (data.player.peerId !== state.myPeerId) {
                state.addPlayerToNetworkRoom(data.player);
            }
            ui.updateLobbyUI();
            break;

        case MSG_TYPE.PLAYER_LEFT:
            const leftPlayer = state.networkRoomData.players.find(p => p.id === data.playerId);
            state.removePlayerFromNetworkRoom(data.peerId); 
            if (leftPlayer) ui.updateLobbyMessage(`${leftPlayer.name} ha salido de la sala.`);
            break;

        case MSG_TYPE.ROOM_STATE_UPDATE:
            state.setNetworkRoomData({
                players: data.roomData.players,
                gameSettings: data.roomData.gameSettings,
                maxPlayers: data.roomData.maxPlayers,
                myPlayerIdInRoom: data.roomData.players.find(p => p.peerId === state.myPeerId)?.id ?? state.networkRoomData.myPlayerIdInRoom,
            });
            ui.updateLobbyUI();
            break;

        case MSG_TYPE.PLAYER_READY_CHANGED:
            const changedPlayer = state.networkRoomData.players.find(p => p.id === data.playerId);
            if (changedPlayer) {
                changedPlayer.isReady = data.isReady;
                ui.updateLobbyUI();
            }
            break;

        case MSG_TYPE.GAME_STARTED:
            console.log("[PeerConn C] Game started by leader!", data.initialGameState);
            state.setNetworkRoomData({ roomState: 'in_game' });
            state.setPlayersData(data.initialGameState.playersInGameOrder); 
            state.setGameDimensions(data.initialGameState.gameSettings.rows, data.initialGameState.gameSettings.cols);
            state.setCurrentPlayerIndex(data.initialGameState.startingPlayerIndex);
            state.networkRoomData.turnCounter = data.initialGameState.turnCounter;

            gameLogic.initializeGame(true); 
            ui.showGameScreen();
            ui.updateMessageArea("¡El juego ha comenzado!", false, 5000);
            break;

        case MSG_TYPE.GAME_MOVE:
            if (data.turnCounter <= state.networkRoomData.turnCounter && state.networkRoomData.turnCounter !== 0 && data.move.playerIndex !== state.networkRoomData.myPlayerIdInRoom) {
                console.warn(`[PeerConn C] Stale/duplicate game_move. RX TC: ${data.turnCounter}, My TC: ${state.networkRoomData.turnCounter}. Move by P${data.move.playerIndex}. Ignored.`);
                return;
            }
            state.networkRoomData.turnCounter = data.turnCounter;
            gameLogic.applyRemoteMove(data.move, data.nextPlayerIndex, data.updatedScores);
            break;
        
        case MSG_TYPE.FULL_GAME_STATE: 
             if (data.turnCounter < state.networkRoomData.turnCounter && state.networkRoomData.turnCounter !== 0 && data.turnCounter !== 0) {
                console.warn(`[PeerConn C] Stale full_game_state. RX TC: ${data.turnCounter}, My TC: ${state.networkRoomData.turnCounter}. Ignored.`);
                return;
            }
            console.log("[PeerConn C] Applying full game state from leader.");
            gameLogic.applyFullState(data.gameState); 
            state.networkRoomData.turnCounter = data.gameState.turnCounter; 
            state.setNetworkRoomData({ roomState: data.gameState.gameActive ? 'in_game' : 'game_over' });
            if(state.networkRoomData.roomState === 'in_game') ui.showGameScreen(); else ui.showLobbyScreen(); 
            break;

        case MSG_TYPE.GAME_OVER_ANNOUNCEMENT:
            state.setNetworkRoomData({ roomState: 'game_over' });
            state.setGameActive(false); 
            ui.showModalMessage(`¡Juego Terminado! Ganador(es): ${data.winners.map(w => w.name).join(', ')}.`);
            ui.updateScoresDisplay(); 
            ui.setBoardClickable(false);
            break;
    }
}

// --- PeerJS Setup and Connection Management ---
function setupConnectionEventHandlers(conn, isToLeaderConnection = false) {
    conn.on('open', () => {
        if (isToLeaderConnection) { 
            peerJsCallbacks.onConnectionOpen(conn.peer); 
        } else { 
            if (state.networkRoomData.isRoomLeader && !connections.has(conn.peer)) {
                 console.log(`[PeerConn] Leader: Raw connection from ${conn.peer} opened. Awaiting their formal join request.`);
            }
             peerJsCallbacks.onConnectionOpen(conn.peer); 
        }
    });

    conn.on('data', (data) => {
        peerJsCallbacks.onDataReceived(data, conn.peer); 
    });

    conn.on('close', () => {
        peerJsCallbacks.onConnectionClose(conn.peer); 
        if (isToLeaderConnection) {
            leaderConnection = null;
        } else if (state.networkRoomData.isRoomLeader) {
            connections.delete(conn.peer);
        }
    });

    conn.on('error', (err) => {
        peerJsCallbacks.onError(err, conn.peer); 
    });
}


export function ensurePeerInitialized(customCallbacks = {}) {
    if (window.peerJsMultiplayer?.getPeer && window.peerJsMultiplayer.getPeer()) {
        console.log("[PeerConn] PeerJS already initialized. My ID:", window.peerJsMultiplayer.getLocalId());
        const currentPeerId = window.peerJsMultiplayer.getLocalId();
        if (currentPeerId) {
            (customCallbacks.onPeerOpen || peerJsCallbacks.onPeerOpen)(currentPeerId);
        } else {
            console.warn("[PeerConn] Peer object exists but ID is null. Attempting re-init logic if any.");
             window.peerJsMultiplayer.init(null, { ...peerJsCallbacks, ...customCallbacks });
        }
        return;
    }

    if (window.peerJsMultiplayer?.init) {
        const effectiveCallbacks = { ...peerJsCallbacks, ...customCallbacks };
        window.peerJsMultiplayer.init(null, effectiveCallbacks);
    } else {
        console.error("[PeerConn] peerJsMultiplayer.init not found.");
        (customCallbacks.onError || peerJsCallbacks.onError)({ type: 'init_failed', message: 'Módulo multijugador no disponible.' });
    }
}

// --- Hosting and Joining Room ---
export function hostNewRoom(hostPlayerData, gameSettings, isRandomMatchHost = false) {
    state.resetNetworkRoomData(); 
    state.setPvpRemoteActive(true);
    state.setNetworkRoomData({
        isRoomLeader: true,
        myPlayerIdInRoom: 0, 
        gameSettings: { rows: gameSettings.rows, cols: gameSettings.cols },
        maxPlayers: gameSettings.maxPlayers,
        players: [{ 
            id: 0,
            peerId: null, 
            name: hostPlayerData.name,
            icon: hostPlayerData.icon,
            color: hostPlayerData.color,
            isReady: false, 
            isConnected: true,
            score: 0
        }],
        roomState: isRandomMatchHost ? 'creating_random_match_room' : 'waiting_for_players',
        gamePaired: false 
    });
    ui.showModalMessage("Creando sala de juego...");


    ensurePeerInitialized({
        onPeerOpen: (hostPeerId) => { 
            state.setMyPeerId(hostPeerId);
            state.networkRoomData.players[0].peerId = hostPeerId; 
            state.setNetworkRoomData({
                roomId: hostPeerId,
                leaderPeerId: hostPeerId,
            });
            console.log(`[PeerConn] Room created by host. Room ID (Host Peer ID): ${hostPeerId}`);
            ui.hideModalMessage();
        },
        onError: (err) => {
            ui.hideModalMessage();
            peerJsCallbacks.onError(err); 
            state.resetNetworkRoomData();
            state.setPvpRemoteActive(false);
            ui.showSetupScreen();
        }
    });
}

export function joinRoomById(leaderPeerIdToJoin, joinerPlayerData) {
    state.resetNetworkRoomData(); 
    state.setPvpRemoteActive(true);
    state.setNetworkRoomData({
        roomId: leaderPeerIdToJoin, 
        leaderPeerId: leaderPeerIdToJoin,
        isRoomLeader: false,
        players: [{
            peerId: null, 
            name: joinerPlayerData.name,
            icon: joinerPlayerData.icon,
            color: joinerPlayerData.color,
        }],
        roomState: 'connecting_to_lobby'
    });
    ui.showModalMessage(`Intentando conectar a la sala ${state.CAJITAS_PEER_ID_PREFIX}${leaderPeerIdToJoin}...`);

    ensurePeerInitialized({
        onPeerOpen: (myPeerId) => { 
            state.setMyPeerId(myPeerId);
            state.networkRoomData.players[0].peerId = myPeerId; 
        },
        onError: (err) => {
            ui.hideModalMessage();
            peerJsCallbacks.onError(err);
            state.resetNetworkRoomData();
            state.setPvpRemoteActive(false);
            ui.showSetupScreen();
        }
    });
}

export function leaveRoom() {
    console.log("[PeerConn] Leaving room...");
    if (state.networkRoomData.isRoomLeader) {
        broadcastToRoom({ type: 'error', message: 'El líder ha cerrado la sala.' }); 
        setTimeout(() => { 
            connections.forEach(conn => conn.close());
            connections.clear();
        }, 500);
    } else if (leaderConnection) {
        leaderConnection.close();
    }
    leaderConnection = null;
    
    state.resetNetworkRoomData();
    state.setPvpRemoteActive(false);
    state.setGameActive(false);
}

// --- Sending Data ---
function sendDataToLeader(data) {
    if (leaderConnection && leaderConnection.open) {
        console.log(`[PeerConn C] TX to Leader: Type: ${data.type}`, data);
        leaderConnection.send(data);
    } else {
        console.warn("[PeerConn C] No open connection to leader. Cannot send data.", data);
    }
}

function sendDataToClient(clientPeerId, data) {
    const conn = connections.get(clientPeerId);
    if (conn && conn.open) {
        console.log(`[PeerConn L] TX to Client ${clientPeerId}: Type: ${data.type}`, data);
        conn.send(data);
    } else {
        console.warn(`[PeerConn L] No open connection to client ${clientPeerId}. Cannot send data.`, data);
    }
}

function broadcastToRoom(data, excludePeerId = null) { 
    if (!state.networkRoomData.isRoomLeader) return;
    console.log(`[PeerConn L] Broadcast TX: Type: ${data.type} (excluding ${excludePeerId || 'none'})`, data);
    connections.forEach((conn, peerId) => {
        if (peerId !== excludePeerId && conn.open) {
            conn.send(data);
        }
    });
}

function broadcastRoomState() { 
    if (!state.networkRoomData.isRoomLeader) return;
    broadcastToRoom({
        type: MSG_TYPE.ROOM_STATE_UPDATE,
        roomData: { 
            players: state.networkRoomData.players,
            gameSettings: state.networkRoomData.gameSettings,
            maxPlayers: state.networkRoomData.maxPlayers,
        }
    });
}

// --- Public Functions for Main.js to Call ---
export function sendPlayerReadyState(isReady) {
    if (state.networkRoomData.isRoomLeader) {
        const leaderData = state.networkRoomData.players.find(p => p.peerId === state.myPeerId);
        if (leaderData) {
            leaderData.isReady = isReady;
            broadcastToRoom({
                type: MSG_TYPE.PLAYER_READY_CHANGED,
                playerId: leaderData.id,
                peerId: state.myPeerId,
                isReady: isReady
            });
            ui.updateLobbyUI(); 
        }
    } else {
        sendDataToLeader({ type: MSG_TYPE.PLAYER_READY_CHANGED, isReady: isReady });
    }
}

export function sendStartGameRequest() { 
    if (!state.networkRoomData.isRoomLeader || state.networkRoomData.roomState === 'in_game') return;

    const canStart = state.networkRoomData.players.length >= state.MIN_PLAYERS_NETWORK &&
                     state.networkRoomData.players.every(p => p.isReady && p.isConnected);

    if (!canStart) {
        ui.updateLobbyMessage("No se puede iniciar: no todos los jugadores están listos o no hay suficientes.", true);
        return;
    }
    
    state.setNetworkRoomData({ roomState: 'in_game' });
    state.setGameDimensions(state.networkRoomData.gameSettings.rows, state.networkRoomData.gameSettings.cols);
    
    const playersForGame = [...state.networkRoomData.players]
        .sort((a,b) => a.id - b.id)
        .map(p => ({ id: p.id, name: p.name, icon: p.icon, color: p.color, score: 0, peerId: p.peerId }));
    
    state.setPlayersData(playersForGame); 
    state.setCurrentPlayerIndex(0); 
    state.networkRoomData.turnCounter = 0; 

    gameLogic.initializeGame(true); 
    ui.showGameScreen(); 

    broadcastToRoom({
        type: MSG_TYPE.GAME_STARTED,
        initialGameState: {
            playersInGameOrder: playersForGame, 
            gameSettings: state.networkRoomData.gameSettings,
            startingPlayerIndex: state.currentPlayerIndex,
            turnCounter: state.networkRoomData.turnCounter
        }
    });
    ui.updateMessageArea("¡Juego iniciado! Tu turno.", false, 5000); 
}

export function sendGameMoveToLeader(type, r, c, boxesCompletedCount) {
    if (state.networkRoomData.isRoomLeader) {
        console.error("Leader should not be sending moves to itself via this function.");
        return;
    }
    sendDataToLeader({
        type: MSG_TYPE.GAME_MOVE,
        move: { type, r, c, playerIndex: state.networkRoomData.myPlayerIdInRoom, boxesJustCompleted: boxesCompletedCount }
    });
}

export function closePeerSession() {
    if (window.peerJsMultiplayer && typeof window.peerJsMultiplayer.close === 'function') {
        console.log("[PeerConn] Fully closing PeerJS session (destroying peer).");
        window.peerJsMultiplayer.close(); 
    } else {
        console.warn("[PeerConn] Attempted to close peer session, but peerJsMultiplayer.close is not available.");
    }
    leaderConnection = null;
    connections.clear();
}

window.addEventListener('beforeunload', () => {
    if (state.pvpRemoteActive) {
        leaveRoom(); 
        closePeerSession(); 
    }
});