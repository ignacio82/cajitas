// peerConnection.js

import * as state from './state.js';
import *ui from './ui.js';
import *as gameLogic from './gameLogic.js';
import *as matchmaking from './matchmaking_supabase.js'; // For potential interaction like updating room status

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
            console.log(`[PeerConn] New Room Hosted. Room ID (Leader Peer ID): ${id}`);
            const gameLink = `${CAJITAS_BASE_URL}/?room=${id}&slots=${state.networkRoomData.maxPlayers}`;
            ui.displayQRCode(gameLink, `${state.CAJITAS_PEER_ID_PREFIX}${id}`,
                `Compartí este enlace o ID para que ${state.networkRoomData.maxPlayers -1} jugador(es) más se unan:`);

            // Add self to player list in roomData (already done partially in hostNewRoom)
            // and show lobby.
            ui.showLobbyScreen();
            ui.updateLobbyUI();
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
            // Send a specific "room_full" message before closing if protocol supports it,
            // otherwise just close. For now, we'll let JOIN_REJECTED handle it after data.
            conn.on('open', () => {
                conn.send({ type: MSG_TYPE.JOIN_REJECTED, reason: 'room_full' });
                setTimeout(() => conn.close(), 500); // Give time for message to send
            });
            return;
        }
        console.log(`[PeerJS] Leader received incoming connection from ${conn.peer}.`);
        // Store it temporarily; proper handling after 'request_join_room' message
        setupConnectionEventHandlers(conn, false); // false = not the leaderConnection for this client instance
    },

    onConnectionOpen: (peerId) => { // Generic, specific logic based on who opened
        console.log(`[PeerJS] Data connection opened with ${peerId}.`);
        if (state.networkRoomData.isRoomLeader) {
            // A client connected TO the leader. Leader waits for REQUEST_JOIN_ROOM.
            console.log(`[PeerConn] Leader: Connection from ${peerId} is now open. Waiting for their join request.`);
             const conn = connections.get(peerId);
             if(conn && conn.open) {
                // Connection is open, now client should send REQUEST_JOIN_ROOM
             } else {
                console.warn(`[PeerConn] Leader: Connection object for ${peerId} not found or not open after 'open' event.`);
             }
        } else { // Client connected TO the leader
            if (peerId === state.networkRoomData.leaderPeerId && leaderConnection && leaderConnection.open) {
                console.log(`[PeerConn] Client: Connection to leader ${peerId} is now open. Sending join request.`);
                // Send my player data to the leader to request joining
                const myInitialData = state.networkRoomData.players.find(p => p.peerId === state.myPeerId); // Should have been set by getLocalPlayerCustomization
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
                // Broadcast player_left to remaining clients
                broadcastToRoom({ type: MSG_TYPE.PLAYER_LEFT, playerId: leavingPlayer.id, peerId: peerId });
                // Re-assign player IDs to keep them sequential 0 to N-1
                reassignPlayerIdsAndBroadcastUpdate();
                ui.updateLobbyUI(); // Leader's UI
                if (state.networkRoomData.roomState === 'in_game' && state.networkRoomData.players.length < state.MIN_PLAYERS_NETWORK) {
                    // Not enough players to continue, end game
                    ui.showModalMessage(`Jugador ${leavingPlayer.name} se desconectó. No hay suficientes jugadores para continuar.`);
                    gameLogic.endGameAbruptly(); // Or a more graceful end
                    state.setNetworkRoomData({ roomState: 'game_over' }); // Or back to lobby
                }
            }
        } else { // Client
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
                    // If client fails to connect to leader during join process
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
        
        // More robust reset if error occurs during critical phases
        if (!state.networkRoomData.isRoomLeader && (!leaderConnection || !leaderConnection.open)) {
            // Client not connected or connection failed
            state.resetNetworkRoomData();
            state.setPvpRemoteActive(false);
            ui.showSetupScreen();
            ui.hideQRCode();
        } else if (state.networkRoomData.isRoomLeader && connections.size === 0 && state.networkRoomData.roomState !== 'idle' && state.networkRoomData.roomState !== 'waiting_for_players') {
            // Leader with no connections after being in a more active state
            // (This might be too aggressive, depends on desired behavior)
        }
    }
};

function reassignPlayerIdsAndBroadcastUpdate() {
    if (!state.networkRoomData.isRoomLeader) return;

    const sortedPlayers = state.networkRoomData.players
        .filter(p => p.isConnected) // Or however you track active players
        .sort((a, b) => a.id - b.id); // Keep original relative order if possible, or re-sort by join time etc.

    let idChanged = false;
    sortedPlayers.forEach((player, index) => {
        if (player.id !== index) {
            idChanged = true;
        }
        player.id = index; // Re-assign ID from 0 to N-1
        if (player.peerId === state.myPeerId) { // Update leader's own player ID in room
            state.setNetworkRoomData({ myPlayerIdInRoom: index });
        }
    });
    state.setNetworkRoomData({ players: sortedPlayers }); // Update state with re-IDed players

    if (idChanged || true) { // Always broadcast after a player leaves for now
       broadcastRoomState();
    }
}


// --- Data Reception Handlers ---
function handleLeaderDataReception(data, fromPeerId) {
    const clientConn = connections.get(fromPeerId);
    if (!clientConn && data.type !== MSG_TYPE.REQUEST_JOIN_ROOM) { // Allow REQUEST_JOIN_ROOM from a newly opened (but not yet fully tracked) connection
        console.warn(`[PeerConn L] Data from unknown or untracked peer ${fromPeerId}. Type: ${data.type}. Ignored.`);
        return;
    }

    switch (data.type) {
        case MSG_TYPE.REQUEST_JOIN_ROOM:
            if (state.networkRoomData.players.length >= state.networkRoomData.maxPlayers) {
                clientConn?.send({ type: MSG_TYPE.JOIN_REJECTED, reason: 'room_full' });
                return;
            }
            // Assign a player ID (0 is leader, so clients start from 1, or manage 0..N-1)
            // For simplicity, new players get the next available ID.
            const newPlayerId = state.networkRoomData.players.length; // If leader is ID 0, first client is ID 1, etc.

            const newPlayer = {
                ...data.playerData, // name, icon, color
                id: newPlayerId,
                peerId: fromPeerId,
                isReady: false,
                isConnected: true,
                score: 0
            };
            state.addPlayerToNetworkRoom(newPlayer);
            // The connection used to send REQUEST_JOIN_ROOM might not be the one stored in `connections` yet if it's a new peer.
            // `setupConnectionEventHandlers` should ensure `connections.set(fromPeerId, conn)` happens for new valid connections.
            // If `clientConn` is null here, it means the connection from `fromPeerId` was just established.
            // The `onNewConnection` should have called `setupConnectionEventHandlers`.
            const connToStore = clientConn || window.peerJsMultiplayer.getConnection(fromPeerId); // Assuming peerjs-multiplayer can give it
            if (connToStore) connections.set(fromPeerId, connToStore);
            else console.error(`[PeerConn L] No connection object found for ${fromPeerId} during JOIN_REQUEST.`);


            // Send acceptance and current room state to the new player
            sendDataToClient(fromPeerId, {
                type: MSG_TYPE.JOIN_ACCEPTED,
                yourPlayerId: newPlayerId,
                roomData: state.networkRoomData // Send the whole room data
            });

            // Notify all other players
            broadcastToRoom({ type: MSG_TYPE.PLAYER_JOINED, player: newPlayer }, fromPeerId); // Exclude sender

            ui.updateLobbyUI(); // Leader's UI
            matchmaking.updateHostedRoomStatus(state.networkRoomData.roomId, state.networkRoomData.gameSettings, state.networkRoomData.maxPlayers, state.networkRoomData.players.length);
            break;

        case MSG_TYPE.PLAYER_READY_CHANGED:
            const playerToUpdate = state.networkRoomData.players.find(p => p.peerId === fromPeerId);
            if (playerToUpdate) {
                playerToUpdate.isReady = data.isReady;
                // Broadcast the change to all players
                broadcastToRoom({
                    type: MSG_TYPE.PLAYER_READY_CHANGED,
                    playerId: playerToUpdate.id,
                    peerId: fromPeerId,
                    isReady: data.isReady
                });
                ui.updateLobbyUI(); // Leader's UI
            }
            break;

        case MSG_TYPE.GAME_MOVE:
            if (state.networkRoomData.roomState !== 'in_game' || !state.gameActive) {
                console.warn("[PeerConn L] Game move received but game not active. Ignored.");
                return;
            }
            // Validate if it's the sender's turn
            const movingPlayer = state.networkRoomData.players.find(p => p.peerId === fromPeerId);
            if (movingPlayer && movingPlayer.id === state.currentPlayerIndex) {
                state.incrementTurnCounter(); // Leader increments canonical turn counter
                gameLogic.processMove(data.move.type, data.move.r, data.move.c, movingPlayer.id, false, true); // isRemote=false, isLeader=true
                
                // processMove will update scores and potentially currentPlayerIndex.
                // Broadcast the applied move and resulting state.
                // For simplicity, let's send the move and let clients apply it.
                // Or send full state if too complex.
                // The 'playerIndex' in the broadcasted move is the one who *made* the move.
                broadcastToRoom({
                    type: MSG_TYPE.GAME_MOVE,
                    move: { ...data.move, playerIndex: movingPlayer.id }, // Ensure playerIndex is original mover
                    turnCounter: state.networkRoomData.turnCounter, // Current turn counter after this move
                    // Include nextPlayerIndex and scores if needed for quick sync by clients
                    nextPlayerIndex: state.currentPlayerIndex,
                    updatedScores: state.playersData.map(p => ({id: p.id, score: p.score})),
                    boxesJustCompleted: data.move.boxesJustCompleted // gameLogic.processMove should populate this
                });

                if (!state.gameActive && state.networkRoomData.roomState === 'in_game') { // Game ended
                    state.setNetworkRoomData({ roomState: 'game_over' });
                    broadcastToRoom({
                        type: MSG_TYPE.GAME_OVER_ANNOUNCEMENT,
                        winners: gameLogic.getWinnerData(), // gameLogic needs to expose this
                        scores: state.playersData.map(p => ({id: p.id, name: p.name, score: p.score}))
                    });
                }
            } else {
                console.warn(`[PeerConn L] Move from ${fromPeerId} (P${movingPlayer?.id}) but it's P${state.currentPlayerIndex}'s turn. Ignored.`);
                // Optionally send a "not_your_turn" message to the client.
            }
            break;
        // TODO: Handle RESTART_GAME_REQUEST etc.
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
                players: data.roomData.players, // Full player list from leader
                gameSettings: data.roomData.gameSettings,
                maxPlayers: data.roomData.maxPlayers,
                roomState: 'lobby' // Successfully joined the lobby
            });
            // Ensure own player data (name, icon, color) is correctly represented in the local players array
            const myDataIndex = state.networkRoomData.players.findIndex(p => p.id === data.yourPlayerId);
            if (myDataIndex !== -1) {
                const preJoinData = state.networkRoomData.players.find(p => p.peerId === state.myPeerId && p.id !== data.yourPlayerId); // Find temp data if any
                if(preJoinData) { // Copy customized name/icon/color if they existed
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
            leaveRoom(); // Clean up
            break;

        case MSG_TYPE.PLAYER_JOINED:
            // Add new player to local list if not self
            if (data.player.peerId !== state.myPeerId) {
                state.addPlayerToNetworkRoom(data.player);
            }
            ui.updateLobbyUI();
            break;

        case MSG_TYPE.PLAYER_LEFT:
            const leftPlayer = state.networkRoomData.players.find(p => p.id === data.playerId);
            state.removePlayerFromNetworkRoom(data.peerId); // Remove by peerId
             // Leader will re-assign IDs and send ROOM_STATE_UPDATE
            if (leftPlayer) ui.updateLobbyMessage(`${leftPlayer.name} ha salido de la sala.`);
            // ui.updateLobbyUI(); // Will be updated by ROOM_STATE_UPDATE
            break;

        case MSG_TYPE.ROOM_STATE_UPDATE:
            // Leader sent a full update of the room (e.g. after re-assigning IDs)
            state.setNetworkRoomData({
                players: data.roomData.players,
                gameSettings: data.roomData.gameSettings,
                maxPlayers: data.roomData.maxPlayers,
                // myPlayerIdInRoom might change if leader re-assigns, ensure it's updated
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
            // initialGameState contains playersData, gameSettings (rows, cols), currentPlayerIndex
            state.setPlayersData(data.initialGameState.playersInGameOrder); // This is the ordered list for the game
            state.setGameDimensions(data.initialGameState.gameSettings.rows, data.initialGameState.gameSettings.cols);
            state.setCurrentPlayerIndex(data.initialGameState.startingPlayerIndex);
            // state.setTurnCounter(data.initialGameState.turnCounter); // Handled by networkRoomData.turnCounter
            state.networkRoomData.turnCounter = data.initialGameState.turnCounter;


            gameLogic.initializeGame(true); // isRemoteGame = true
            ui.showGameScreen();
            // updatePlayerTurnDisplay will use the new state
            ui.updateMessageArea("¡El juego ha comenzado!", false, 5000);
            break;

        case MSG_TYPE.GAME_MOVE:
            // Leader broadcasted a validated move. Apply it locally.
            if (data.turnCounter <= state.networkRoomData.turnCounter && state.networkRoomData.turnCounter !== 0 && data.move.playerIndex !== state.networkRoomData.myPlayerIdInRoom) {
                console.warn(`[PeerConn C] Stale/duplicate game_move. RX TC: ${data.turnCounter}, My TC: ${state.networkRoomData.turnCounter}. Move by P${data.move.playerIndex}. Ignored.`);
                return;
            }
            state.networkRoomData.turnCounter = data.turnCounter;
            // The playerIndex in data.move is who MADE the move.
            gameLogic.applyRemoteMove(data.move, data.nextPlayerIndex, data.updatedScores);
            break;
        
        case MSG_TYPE.FULL_GAME_STATE: // For resync if needed
             if (data.turnCounter < state.networkRoomData.turnCounter && state.networkRoomData.turnCounter !== 0 && data.turnCounter !== 0) {
                console.warn(`[PeerConn C] Stale full_game_state. RX TC: ${data.turnCounter}, My TC: ${state.networkRoomData.turnCounter}. Ignored.`);
                return;
            }
            console.log("[PeerConn C] Applying full game state from leader.");
            gameLogic.applyFullState(data.gameState); // gameLogic handles all sub-state updates
            state.networkRoomData.turnCounter = data.gameState.turnCounter; // ensure local matches
            state.setNetworkRoomData({ roomState: data.gameState.gameActive ? 'in_game' : 'game_over' });
            if(state.networkRoomData.roomState === 'in_game') ui.showGameScreen(); else ui.showLobbyScreen(); // Or a game over screen
            break;

        case MSG_TYPE.GAME_OVER_ANNOUNCEMENT:
            state.setNetworkRoomData({ roomState: 'game_over' });
            state.setGameActive(false); // Mark local game as inactive
            // gameLogic.announceWinner(data.winners, data.scores); // Let gameLogic handle modal
            ui.showModalMessage(`¡Juego Terminado! Ganador(es): ${data.winners.map(w => w.name).join(', ')}.`);
            ui.updateScoresDisplay(); // To show final scores
            ui.setBoardClickable(false);
            // Transition to lobby or results screen
            // ui.showLobbyScreen(); // Or a dedicated game over screen
            break;

    }
}


// --- PeerJS Setup and Connection Management ---
function setupConnectionEventHandlers(conn, isToLeaderConnection = false) {
    // The `conn` object here is a PeerJS DataConnection.
    // `isToLeaderConnection` is true if this `conn` is the client's single connection to the leader.

    conn.on('open', () => {
        // This 'open' event signifies the P2P data channel is ready.
        if (isToLeaderConnection) { // This client successfully connected to the leader
            peerJsCallbacks.onConnectionOpen(conn.peer); // Pass leader's peerId
        } else { // Leader received a connection from a client
            // Don't call generic onConnectionOpen for leader here, as we wait for REQUEST_JOIN_ROOM.
            // Store the connection if it's from a new client.
            if (state.networkRoomData.isRoomLeader && !connections.has(conn.peer)) {
                 // connections.set(conn.peer, conn); // This should be done upon accepting JOIN_REQUEST
                 console.log(`[PeerConn] Leader: Raw connection from ${conn.peer} opened. Awaiting their formal join request.`);
            }
             peerJsCallbacks.onConnectionOpen(conn.peer); // For leader, signals a client is trying to talk
        }
    });

    conn.on('data', (data) => {
        peerJsCallbacks.onDataReceived(data, conn.peer); // Pass data and sender's peerId
    });

    conn.on('close', () => {
        peerJsCallbacks.onConnectionClose(conn.peer); // Pass peerId of closed connection
        if (isToLeaderConnection) {
            leaderConnection = null;
        } else if (state.networkRoomData.isRoomLeader) {
            connections.delete(conn.peer);
        }
    });

    conn.on('error', (err) => {
        peerJsCallbacks.onError(err, conn.peer); // Pass error and peerId context
    });
}


export function ensurePeerInitialized(customCallbacks = {}) {
    if (window.peerJsMultiplayer?.getPeer && window.peerJsMultiplayer.getPeer()) {
        console.log("[PeerConn] PeerJS already initialized. My ID:", window.peerJsMultiplayer.getLocalId());
        // If already initialized, directly call onPeerOpen with existing ID if needed for flow.
        const currentPeerId = window.peerJsMultiplayer.getLocalId();
        if (currentPeerId) {
            (customCallbacks.onPeerOpen || peerJsCallbacks.onPeerOpen)(currentPeerId);
        } else {
            // This case (peer object exists but ID is null) should be rare. Re-init might be needed.
            console.warn("[PeerConn] Peer object exists but ID is null. Attempting re-init logic if any.");
             window.peerJsMultiplayer.init(null, { ...peerJsCallbacks, ...customCallbacks });
        }
        return;
    }

    if (window.peerJsMultiplayer?.init) {
        const effectiveCallbacks = { ...peerJsCallbacks, ...customCallbacks };
        // Attempt to initialize. If preferredId is needed for reconnect, pass it.
        window.peerJsMultiplayer.init(null, effectiveCallbacks);
    } else {
        console.error("[PeerConn] peerJsMultiplayer.init not found.");
        (customCallbacks.onError || peerJsCallbacks.onError)({ type: 'init_failed', message: 'Módulo multijugador no disponible.' });
    }
}

// --- Hosting and Joining Room ---
export function hostNewRoom(hostPlayerData, gameSettings, isRandomMatchHost = false) {
    // 1. Ensure PeerJS is initialized and get a Peer ID for the host.
    // 2. Once Peer ID is available, this ID becomes the Room ID.
    // 3. Update game state (networkRoomData) with room details, mark self as leader.
    // 4. Add host to the player list in networkRoomData.
    // 5. Display Room ID/QR code for others to join.
    // 6. Transition to lobby UI.

    state.resetNetworkRoomData(); // Start fresh for a new room
    state.setPvpRemoteActive(true);
    state.setNetworkRoomData({
        isRoomLeader: true,
        myPlayerIdInRoom: 0, // Leader is always player 0 in their room
        gameSettings: { rows: gameSettings.rows, cols: gameSettings.cols },
        maxPlayers: gameSettings.maxPlayers,
        players: [{ // Add self (host) as the first player
            id: 0,
            peerId: null, // Will be set once peer opens
            name: hostPlayerData.name,
            icon: hostPlayerData.icon,
            color: hostPlayerData.color,
            isReady: false, // Host isn't auto-ready
            isConnected: true,
            score: 0
        }],
        roomState: isRandomMatchHost ? 'creating_random_match_room' : 'waiting_for_players',
        gamePaired: false // Not yet, needs more players
    });
    ui.showModalMessage("Creando sala de juego...");


    ensurePeerInitialized({
        onPeerOpen: (hostPeerId) => { // This is OUR peerId, which becomes the roomId
            state.setMyPeerId(hostPeerId);
            state.networkRoomData.players[0].peerId = hostPeerId; // Update host's peerId in their own player entry
            state.setNetworkRoomData({
                roomId: hostPeerId,
                leaderPeerId: hostPeerId,
                // roomState will be set by the generic onPeerOpen if isRandomMatchHost
            });
            console.log(`[PeerConn] Room created by host. Room ID (Host Peer ID): ${hostPeerId}`);
            ui.hideModalMessage();
            // The generic onPeerOpen will handle QR display and UI transition to lobby.
        },
        onError: (err) => {
            ui.hideModalMessage();
            peerJsCallbacks.onError(err); // Use the main error handler
            // Reset state if hosting failed
            state.resetNetworkRoomData();
            state.setPvpRemoteActive(false);
            ui.showSetupScreen();
        }
    });
}

export function joinRoomById(leaderPeerIdToJoin, joinerPlayerData) {
    // 1. Ensure PeerJS is initialized for the joiner.
    // 2. Attempt to connect to the leaderPeerIdToJoin.
    // 3. On successful connection ('open' event with leader), send REQUEST_JOIN_ROOM with joinerPlayerData.
    // 4. Wait for JOIN_ACCEPTED or JOIN_REJECTED from leader.
    // 5. If accepted, update local networkRoomData, transition to lobby.

    state.resetNetworkRoomData(); // Start fresh before joining
    state.setPvpRemoteActive(true);
    state.setNetworkRoomData({
        roomId: leaderPeerIdToJoin, // Tentative room ID (leader's peerId)
        leaderPeerId: leaderPeerIdToJoin,
        isRoomLeader: false,
        // Store my own details temporarily, will be confirmed by leader
        players: [{
            peerId: null, // My peerId, will be set
            name: joinerPlayerData.name,
            icon: joinerPlayerData.icon,
            color: joinerPlayerData.color,
            // id, isReady, isConnected will be set by leader
        }],
        roomState: 'connecting_to_lobby'
    });
    ui.showModalMessage(`Intentando conectar a la sala ${state.CAJITAS_PEER_ID_PREFIX}${leaderPeerIdToJoin}...`);

    ensurePeerInitialized({
        onPeerOpen: (myPeerId) => { // This is joiner's own peerId
            state.setMyPeerId(myPeerId);
            state.networkRoomData.players[0].peerId = myPeerId; // Update self in temporary player list

            // The generic onPeerOpen will handle the actual connection attempt
            // because leaderPeerId is set in networkRoomData.
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
        // Notify all clients that leader is leaving (room closing)
        // This might be too complex; simpler if leader just closes all connections.
        broadcastToRoom({ type: 'error', message: 'El líder ha cerrado la sala.' }); // Or a specific 'room_closed'
        setTimeout(() => { // Give time for messages
            connections.forEach(conn => conn.close());
            connections.clear();
        }, 500);
    } else if (leaderConnection) {
        // Notify leader that this client is leaving (optional, leader handles disconnect too)
        // sendDataToLeader({ type: MSG_TYPE.PLAYER_LEFT, myPeerId: state.myPeerId });
        leaderConnection.close();
    }
    leaderConnection = null;
    
    if (window.peerJsMultiplayer && typeof window.peerJsMultiplayer.close === 'function') {
         // We don't destroy the peer object itself, just close connections,
         // so it can be reused for hosting/joining another game without needing a new PeerID.
         // If full PeerJS shutdown is needed: window.peerJsMultiplayer.close();
    }

    state.resetNetworkRoomData();
    state.setPvpRemoteActive(false);
    state.setGameActive(false);
    // UI transition should be handled by the caller (e.g., main.js)
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

function broadcastToRoom(data, excludePeerId = null) { // Leader broadcasts
    if (!state.networkRoomData.isRoomLeader) return;
    console.log(`[PeerConn L] Broadcast TX: Type: ${data.type} (excluding ${excludePeerId || 'none'})`, data);
    connections.forEach((conn, peerId) => {
        if (peerId !== excludePeerId && conn.open) {
            conn.send(data);
        }
    });
}

function broadcastRoomState() { // Leader sends the current state.networkRoomData.players etc.
    if (!state.networkRoomData.isRoomLeader) return;
    broadcastToRoom({
        type: MSG_TYPE.ROOM_STATE_UPDATE,
        roomData: { // Send only necessary parts for lobby updates
            players: state.networkRoomData.players,
            gameSettings: state.networkRoomData.gameSettings,
            maxPlayers: state.networkRoomData.maxPlayers,
            // leaderPeerId: state.networkRoomData.leaderPeerId // Clients should know this
        }
    });
}

// --- Public Functions for Main.js to Call ---
export function sendPlayerReadyState(isReady) {
    if (state.networkRoomData.isRoomLeader) {
        // Leader updates self and broadcasts
        const leaderData = state.networkRoomData.players.find(p => p.peerId === state.myPeerId);
        if (leaderData) {
            leaderData.isReady = isReady;
            broadcastToRoom({
                type: MSG_TYPE.PLAYER_READY_CHANGED,
                playerId: leaderData.id,
                peerId: state.myPeerId,
                isReady: isReady
            });
            ui.updateLobbyUI(); // Update leader's own UI
        }
    } else {
        // Client sends to leader
        sendDataToLeader({ type: MSG_TYPE.PLAYER_READY_CHANGED, isReady: isReady });
    }
}

export function sendStartGameRequest() { // Only called by leader from UI
    if (!state.networkRoomData.isRoomLeader || state.networkRoomData.roomState === 'in_game') return;

    // Prepare playersData for gameLogic: ordered by ID, with all necessary fields.
    // Ensure all players are connected and ready.
    const canStart = state.networkRoomData.players.length >= state.MIN_PLAYERS_NETWORK &&
                     state.networkRoomData.players.every(p => p.isReady && p.isConnected);

    if (!canStart) {
        ui.updateLobbyMessage("No se puede iniciar: no todos los jugadores están listos o no hay suficientes.", true);
        return;
    }
    
    state.setNetworkRoomData({ roomState: 'in_game' });
    state.setGameDimensions(state.networkRoomData.gameSettings.rows, state.networkRoomData.gameSettings.cols);
    
    // Create the playersData array for the game instance, ensuring correct order (by ID)
    const playersForGame = [...state.networkRoomData.players]
        .sort((a,b) => a.id - b.id)
        .map(p => ({ id: p.id, name: p.name, icon: p.icon, color: p.color, score: 0, peerId: p.peerId }));
    
    state.setPlayersData(playersForGame); // This is the array gameLogic will use.
    state.setCurrentPlayerIndex(0); // Game always starts with player 0
    state.networkRoomData.turnCounter = 0; // Reset turn counter for new game

    // Leader initializes its own game logic
    gameLogic.initializeGame(true); // isRemoteGame = true
    ui.showGameScreen(); // Leader transitions UI

    // Broadcast GAME_STARTED to all clients
    broadcastToRoom({
        type: MSG_TYPE.GAME_STARTED,
        initialGameState: {
            playersInGameOrder: playersForGame, // Send the ordered list
            gameSettings: state.networkRoomData.gameSettings,
            startingPlayerIndex: state.currentPlayerIndex,
            turnCounter: state.networkRoomData.turnCounter
        }
    });
    ui.updateMessageArea("¡Juego iniciado! Tu turno.", false, 5000); // For leader
}

export function sendGameMoveToLeader(type, r, c, boxesCompletedCount) {
    if (state.networkRoomData.isRoomLeader) {
        console.error("Leader should not be sending moves to itself via this function.");
        return;
    }
    sendDataToLeader({
        type: MSG_TYPE.GAME_MOVE,
        move: { type, r, c, playerIndex: state.networkRoomData.myPlayerIdInRoom, boxesJustCompleted: boxesCompletedCount }
        // turnCounter will be added by leader upon processing
    });
}

// Close all connections when the window is about to unload
window.addEventListener('beforeunload', () => {
    if (state.pvpRemoteActive) {
        leaveRoom(); // Attempt to gracefully leave/close connections
    }
});