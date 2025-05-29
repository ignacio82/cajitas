// peerConnection.js

import * as state from './state.js';
import * as ui from './ui.js';
import * as gameLogic from './gameLogic.js';
import * as matchmaking from './matchmaking_supabase.js';

const CAJITAS_BASE_URL = "https://cajitas.martinez.fyi"; 

let connections = new Map();
let leaderConnection = null; 

const MSG_TYPE = {
    REQUEST_JOIN_ROOM: 'request_join_room',
    JOIN_ACCEPTED: 'join_accepted',
    JOIN_REJECTED: 'join_rejected',
    PLAYER_JOINED: 'player_joined',
    PLAYER_LEFT: 'player_left',
    ROOM_STATE_UPDATE: 'room_state_update',
    PLAYER_READY_CHANGED: 'player_ready_changed',
    START_GAME_REQUEST: 'start_game_request',
    GAME_STARTED: 'game_started',
    FULL_GAME_STATE: 'full_game_state',
    GAME_MOVE: 'game_move',
    GAME_OVER_ANNOUNCEMENT: 'game_over_announcement',
    RESTART_GAME_REQUEST: 'restart_game_request',
    RESTART_GAME_RESPONSE: 'restart_game_response',
};

const peerJsCallbacks = {
    onPeerOpen: (id) => {
        console.log(`[PeerConn] Global onPeerOpen triggered with ID: ${id}. pvpRemoteActive: ${state.pvpRemoteActive}`);
        state.setMyPeerId(id); 

        if (!state.pvpRemoteActive && !(window.cajitasJoinRoomOnLoad && window.cajitasJoinRoomOnLoad.roomId === id.replace(state.CAJITAS_PEER_ID_PREFIX, ''))) {
            console.log('[PeerConn] onPeerOpen: Not in active PvP mode (likely pre-initialization or joining via URL before pvpRemoteActive is set). Returning.');
            // If there's a setup promise waiting (e.g. from hostNewRoom), and this pre-init somehow intereferes,
            // we might need to reject it or handle it. But pvpRemoteActive should be set by hostNewRoom first.
            // For now, if not pvpRemoteActive, assume it's a pre-init.
            if (state.networkRoomData?._setupErrorCallback && !state.pvpRemoteActive) {
                // This case should ideally not be hit if pvpRemoteActive is set before ensurePeerInitialized
                // in hostNewRoom. But as a safeguard:
                // state.networkRoomData._setupErrorCallback(new Error("onPeerOpen called when pvpRemoteActive is false during hosting."));
                // delete state.networkRoomData._setupCompleteCallback;
                // delete state.networkRoomData._setupErrorCallback;
            }
            return;
        }

        if (state.networkRoomData.isRoomLeader && 
            (state.networkRoomData.roomState === 'waiting_for_players' || state.networkRoomData.roomState === 'creating_random_match_room')) {
            
            if (!state.networkRoomData.roomId) { // Room ID not yet set from PeerID
                console.log('[PeerConn] onPeerOpen: Finalizing host setup.');

                if (!state.networkRoomData || !state.networkRoomData.players || !state.networkRoomData.players[0]) {
                    console.error('[PeerConn] onPeerOpen Error: networkRoomData or players array not initialized for host!');
                    ui.showModalMessage("Error crítico al crear la sala. Faltan datos del anfitrión.");
                    if (state.networkRoomData._setupErrorCallback) {
                        state.networkRoomData._setupErrorCallback(new Error("networkRoomData or players array not initialized for host"));
                        delete state.networkRoomData._setupCompleteCallback;
                        delete state.networkRoomData._setupErrorCallback;
                    }
                    return;
                }
                
                state.networkRoomData.players[0].peerId = id; 
                state.setNetworkRoomData({ 
                    roomId: id, 
                    leaderPeerId: id,
                    players: [...state.networkRoomData.players] 
                }); 

                console.log(`[PeerConn] Room setup complete. Room ID (Host Peer ID): ${id}. Host player PeerID set to: ${state.networkRoomData.players[0].peerId}`);

                ui.showLobbyScreen();
                ui.updateLobbyUI();
                ui.updateGameModeUI(); 
                
                const gameLink = `${CAJITAS_BASE_URL}/?room=${id}&slots=${state.networkRoomData.maxPlayers}`;
                ui.displayQRCode(gameLink, `${state.CAJITAS_PEER_ID_PREFIX}${id}`,
                    `Compartí este enlace o ID para que ${state.networkRoomData.maxPlayers - 1} jugador(es) más se unan:`);
                
                if (state.networkRoomData.roomState === 'creating_random_match_room') {
                    matchmaking.updateHostedRoomStatus(id, state.networkRoomData.gameSettings, state.networkRoomData.maxPlayers, state.networkRoomData.players.length);
                    // roomState is already creating_random_match_room, will transition if needed
                }
                ui.hideModalMessage(); 

                if (state.networkRoomData._setupCompleteCallback) {
                    state.networkRoomData._setupCompleteCallback(id); // Resolve the promise from hostNewRoom
                    delete state.networkRoomData._setupCompleteCallback;
                    delete state.networkRoomData._setupErrorCallback;
                }

            } else if (state.networkRoomData.roomId === id) {
                // Peer reconnected as host, or onPeerOpen fired again for an already set up host.
                console.log('[PeerConn] onPeerOpen: Host PeerJS reconnected or event fired again for existing room. Ensuring UI.');
                ui.showLobbyScreen();
                ui.updateLobbyUI();
                ui.updateGameModeUI();
                const gameLink = `${CAJITAS_BASE_URL}/?room=${id}&slots=${state.networkRoomData.maxPlayers}`;
                ui.displayQRCode(gameLink, `${state.CAJITAS_PEER_ID_PREFIX}${id}`,
                    `Compartí este enlace o ID para que ${state.networkRoomData.maxPlayers - 1} jugador(es) más se unan:`);
                ui.hideModalMessage(); 
                 if (state.networkRoomData._setupCompleteCallback) { // If somehow still pending
                    state.networkRoomData._setupCompleteCallback(id);
                    delete state.networkRoomData._setupCompleteCallback;
                    delete state.networkRoomData._setupErrorCallback;
                }
            }

        } else if (!state.networkRoomData.isRoomLeader && state.networkRoomData.leaderPeerId && !leaderConnection && state.pvpRemoteActive) {
            // This is the flow for a joiner whose PeerJS has just opened and pvpRemoteActive is true.
            console.log(`[PeerConn] onPeerOpen: Joiner's PeerJS opened (ID: ${id}). Attempting to connect to leader: ${state.networkRoomData.leaderPeerId}`);
            // Update my player data with the obtained peerId if not already set (e.g. in joinRoomById's local onPeerOpen)
            if (state.networkRoomData.players && state.networkRoomData.players[0] && state.networkRoomData.players[0].peerId === null) {
                state.networkRoomData.players[0].peerId = id;
                 // state.setNetworkRoomData({ players: [...state.networkRoomData.players] }); // Not strictly needed if joinRoomById also does this
            }

            if (window.peerJsMultiplayer?.connect) {
                const connToLeader = window.peerJsMultiplayer.connect(state.networkRoomData.leaderPeerId);
                if (connToLeader) {
                    leaderConnection = connToLeader;
                    setupConnectionEventHandlers(leaderConnection, true);
                } else {
                     console.error(`[PeerConn] peer.connect() returned null when trying to connect to leader.`);
                     peerJsCallbacks.onError({type: 'connect_failed', message: 'Failed to initiate connection to leader.'});
                }
            } else {
                peerJsCallbacks.onError({type: 'connect_error', message: 'PeerJS connect not available.'});
            }
        } else {
            console.log(`[PeerConn] onPeerOpen: PeerJS opened with ID ${id}, but current state (pvpActive: ${state.pvpRemoteActive}, isLeader: ${state.networkRoomData.isRoomLeader}, roomState: ${state.networkRoomData.roomState}, roomId: ${state.networkRoomData.roomId}) doesn't match primary hosting/joining flows in this callback.`);
        }
    },

    onNewConnection: (conn) => { 
        if (!state.networkRoomData.isRoomLeader) {
            console.warn(`[PeerJS] Non-leader received a connection from ${conn.peer}. Rejecting.`);
            conn.on('open', () => conn.close()); 
            return;
        }
        // Check if room is full based on players who are 'active' or 'pending' but not yet rejected
        const activeOrPendingPlayers = Array.from(connections.values()).filter(c => c.status !== 'rejected').length + 1; // +1 for leader
        if (activeOrPendingPlayers >= state.networkRoomData.maxPlayers && !connections.has(conn.peer)) { // Only reject new peers if full
            console.warn(`[PeerJS] Room is full (${activeOrPendingPlayers-1} connected/pending out of ${state.networkRoomData.maxPlayers-1} slots). Rejecting new connection from ${conn.peer}.`);
            conn.on('open', () => { // Ensure connection is open before sending and closing
                conn.send({ type: MSG_TYPE.JOIN_REJECTED, reason: 'room_full' });
                setTimeout(() => conn.close(), 500); 
            });
            // Optionally mark this conn attempt as rejected if we were to track it.
            return;
        }
        console.log(`[PeerJS] Leader received incoming connection from ${conn.peer}.`);
        
        // Store the connection immediately with a pending status
        connections.set(conn.peer, { connObject: conn, status: 'pending_join_request' }); // Store the actual PeerJS connection object
        setupConnectionEventHandlers(conn, false); 
    },

    onConnectionOpen: (peerId) => { 
        console.log(`[PeerJS] Data connection opened with ${peerId}.`);
        const connEntry = connections.get(peerId);

        if (state.networkRoomData.isRoomLeader) {
            console.log(`[PeerConn] Leader: Connection from client ${peerId} is now open. Waiting for their join request.`);
            if (connEntry && connEntry.status === 'pending_join_request') {
                // Client should now send REQUEST_JOIN_ROOM
            } else if (connEntry && connEntry.status === 'active') {
                console.log(`[PeerConn] Leader: Re-established or already active connection with ${peerId}.`);
            } else {
                console.warn(`[PeerConn] Leader: Connection opened with ${peerId}, but no matching pending/active entry in connections map or unexpected status.`);
            }
        } else { 
            if (peerId === state.networkRoomData.leaderPeerId && leaderConnection && leaderConnection.open) {
                console.log(`[PeerConn] Client: Connection to leader ${peerId} is now open. Sending join request.`);
                const myPlayerDataFromState = state.networkRoomData.players.find(p => p.peerId === state.myPeerId); 
                if (myPlayerDataFromState) { 
                    sendDataToLeader({
                        type: MSG_TYPE.REQUEST_JOIN_ROOM,
                        playerData: { 
                            name: myPlayerDataFromState.name, 
                            icon: myPlayerDataFromState.icon, 
                            color: myPlayerDataFromState.color 
                        }
                    });
                    state.setNetworkRoomData({ roomState: 'awaiting_join_approval' });
                    ui.showModalMessage(`Conectado al líder. Esperando aprobación para unirse a la sala ${state.CAJITAS_PEER_ID_PREFIX}${state.networkRoomData.roomId}...`);
                } else {
                    console.error("[PeerConn] Client: Own player data not found in state to send join request. MyPeerID:", state.myPeerId, "Players in state:", state.networkRoomData.players);
                     peerJsCallbacks.onError({type: 'internal_error', message: 'Player data for join request missing locally.'});
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
            const connEntry = connections.get(peerId);
            if (connEntry) { // Check if the connection was tracked
                connections.delete(peerId); // Remove from map
                const leavingPlayer = state.networkRoomData.players.find(p => p.peerId === peerId);
                if (leavingPlayer) {
                    state.removePlayerFromNetworkRoom(peerId); // This filters players array
                    broadcastToRoom({ type: MSG_TYPE.PLAYER_LEFT, playerId: leavingPlayer.id, peerId: peerId });
                    reassignPlayerIdsAndBroadcastUpdate(); // This will update players array in state and broadcast
                    ui.updateLobbyUI(); 
                    if (state.networkRoomData.roomState === 'in_game' && state.networkRoomData.players.length < state.MIN_PLAYERS_NETWORK) {
                        ui.showModalMessage(`Jugador ${leavingPlayer.name} se desconectó. No hay suficientes jugadores para continuar.`);
                        gameLogic.endGameAbruptly(); 
                        state.setNetworkRoomData({ roomState: 'game_over' }); 
                    }
                } else {
                     console.warn(`[PeerConn] Connection closed with ${peerId}, but no matching player found in room data.`);
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
            } else if (err.type === 'network') {
                message = "Error de red. Verificá tu conexión a internet.";
            } else if (err.type === 'webrtc') {
                message = "Error de WebRTC. Puede ser un problema de firewall o red.";
            } else if (err.type === 'disconnected') {
                 message = "Desconectado del servidor PeerJS. Verifica tu conexión.";
            }
        }
        
        if (state.networkRoomData && state.networkRoomData._setupErrorCallback) {
            state.networkRoomData._setupErrorCallback(new Error(message));
            delete state.networkRoomData._setupCompleteCallback;
            delete state.networkRoomData._setupErrorCallback;
        } else {
            ui.showModalMessage(`Error de conexión: ${message}`);
        }
        ui.updateMessageArea("Error de conexión.", true);
        
        // More robust reset if client fails during connection attempts
        if (!state.networkRoomData.isRoomLeader && 
            (state.networkRoomData.roomState === 'connecting_to_lobby' || 
             state.networkRoomData.roomState === 'awaiting_join_approval' ||
             !leaderConnection || (leaderConnection && !leaderConnection.open))) {
            state.resetNetworkRoomData();
            state.setPvpRemoteActive(false);
            ui.showSetupScreen();
            ui.hideNetworkInfo();
        } 
    }
};

function reassignPlayerIdsAndBroadcastUpdate() {
    if (!state.networkRoomData.isRoomLeader) return;
    const connectedPlayers = state.networkRoomData.players.filter(p => p.isConnected !== false); // Assume isConnected is true unless explicitly false
    
    connectedPlayers.sort((a, b) => a.id - b.id); 

    let idChangedOrPlayerRemoved = false;
    if (connectedPlayers.length !== state.networkRoomData.players.length) {
        idChangedOrPlayerRemoved = true;
    }

    connectedPlayers.forEach((player, index) => {
        if (player.id !== index) {
            idChangedOrPlayerRemoved = true;
        }
        player.id = index; 
        if (player.peerId === state.myPeerId) { 
            state.setNetworkRoomData({ myPlayerIdInRoom: index });
        }
    });
    state.setNetworkRoomData({ players: connectedPlayers }); 

    if (idChangedOrPlayerRemoved) { 
       broadcastRoomState();
    }
}

function handleLeaderDataReception(data, fromPeerId) {
    const connEntryWrapper = connections.get(fromPeerId);
    const clientConn = connEntryWrapper ? connEntryWrapper.connObject : null;

    if (!clientConn && data.type !== MSG_TYPE.REQUEST_JOIN_ROOM) { 
        console.warn(`[PeerConn L] Data from ${fromPeerId} but no connection object found (or not yet established for non-join message). Type: ${data.type}. Ignored.`);
        return;
    }
    // For REQUEST_JOIN_ROOM, connEntryWrapper.status should be 'pending_join_request'

    switch (data.type) {
        case MSG_TYPE.REQUEST_JOIN_ROOM:
            if (!connEntryWrapper || connEntryWrapper.status !== 'pending_join_request') {
                console.warn(`[PeerConn L] REQUEST_JOIN_ROOM from ${fromPeerId} but no valid pending connection found. Status: ${connEntryWrapper?.status}. Ignoring.`);
                clientConn?.send({ type: MSG_TYPE.JOIN_REJECTED, reason: 'internal_server_error_or_stale_request' });
                return;
            }

            if (state.networkRoomData.players.length >= state.networkRoomData.maxPlayers) {
                clientConn.send({ type: MSG_TYPE.JOIN_REJECTED, reason: 'room_full' });
                connections.set(fromPeerId, { ...connEntryWrapper, status: 'rejected' }); // Update status
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
            
            connections.set(fromPeerId, clientConn); // Now store the direct connection object, replacing the wrapper. Status is implicitly 'active'.

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
             if (!connEntryWrapper) { // Ensure we only process from known, active connections
                console.warn(`[PeerConn L] PLAYER_READY_CHANGED from unknown peer ${fromPeerId}. Ignored.`);
                return;
            }
            const playerToUpdate = state.networkRoomData.players.find(p => p.peerId === fromPeerId);
            if (playerToUpdate) {
                playerToUpdate.isReady = data.isReady;
                state.setNetworkRoomData({players: [...state.networkRoomData.players]}); // Ensure state update
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
            if (!connEntryWrapper) { 
                console.warn(`[PeerConn L] GAME_MOVE from unknown peer ${fromPeerId}. Ignored.`);
                return;
            }
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
            const myLocalInitialData = state.networkRoomData.players.find(p => p.peerId === state.myPeerId);
            const myDataFromServer = data.roomData.players.find(p => p.id === data.yourPlayerId);

            state.setNetworkRoomData({
                myPlayerIdInRoom: data.yourPlayerId,
                gameSettings: data.roomData.gameSettings,
                maxPlayers: data.roomData.maxPlayers,
                roomState: 'lobby',
                leaderPeerId: data.roomData.leaderPeerId || state.networkRoomData.leaderPeerId,
                roomId: data.roomData.roomId || state.networkRoomData.roomId,
                players: data.roomData.players.map(p => {
                    if (p.id === data.yourPlayerId && myDataFromServer && myLocalInitialData) {
                        return {
                            ...myDataFromServer, 
                            name: myLocalInitialData.name, // Prioritize local customizations if available
                            icon: myLocalInitialData.icon,
                            color: myLocalInitialData.color,
                        };
                    }
                    return p;
                })
            });
            
            ui.showLobbyScreen();
            ui.updateLobbyUI();
            ui.updateGameModeUI();
            console.log(`[PeerConn C] Joined room! My Player ID: ${data.yourPlayerId}. Room Data:`, state.networkRoomData);
            ui.updateLobbyMessage("¡Te uniste a la sala! Marcate como listo cuando quieras.");
            break;

        case MSG_TYPE.JOIN_REJECTED:
            ui.showModalMessage(`No se pudo unir a la sala: ${data.reason || 'Rechazado por el líder.'}`);
            leaveRoom(); 
            break;

        case MSG_TYPE.PLAYER_JOINED:
            if (data.player.peerId !== state.myPeerId) {
                 const existingPlayer = state.networkRoomData.players.find(p => p.peerId === data.player.peerId);
                 if (!existingPlayer) {
                    state.addPlayerToNetworkRoom(data.player);
                 } else { 
                    Object.assign(existingPlayer, data.player);
                    state.setNetworkRoomData({ players: [...state.networkRoomData.players] });
                 }
            } else { // It's me, ensure my data is fully updated if I just joined.
                const myData = state.networkRoomData.players.find(p=> p.peerId === state.myPeerId);
                if(myData) Object.assign(myData, data.player);
                state.setNetworkRoomData({ players: [...state.networkRoomData.players] });
            }
            ui.updateLobbyUI();
            break;

        case MSG_TYPE.PLAYER_LEFT:
            const leftPlayer = state.networkRoomData.players.find(p => p.id === data.playerId && p.peerId === data.peerId);
            if (leftPlayer) {
                state.removePlayerFromNetworkRoom(data.peerId); 
                ui.updateLobbyMessage(`${leftPlayer.name} ha salido de la sala.`);
            } else {
                // If player not found by ID and PeerId, maybe they were already removed or ID changed.
                // Check if any player with that peerId exists and remove.
                state.removePlayerFromNetworkRoom(data.peerId);
            }
            // Leader will send ROOM_STATE_UPDATE with re-assigned IDs if necessary
            ui.updateLobbyUI(); 
            break;

        case MSG_TYPE.ROOM_STATE_UPDATE:
            state.setNetworkRoomData({
                players: data.roomData.players,
                gameSettings: data.roomData.gameSettings,
                maxPlayers: data.roomData.maxPlayers,
                myPlayerIdInRoom: data.roomData.players.find(p => p.peerId === state.myPeerId)?.id ?? state.networkRoomData.myPlayerIdInRoom,
                leaderPeerId: data.roomData.leaderPeerId || state.networkRoomData.leaderPeerId,
                roomId: data.roomData.roomId || state.networkRoomData.roomId,
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
            ui.hideNetworkInfo(); 
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

function setupConnectionEventHandlers(conn, isToLeaderConnection = false) {
    conn.on('open', () => {
        if (isToLeaderConnection) { 
            peerJsCallbacks.onConnectionOpen(conn.peer); 
        } else { 
             // For leader, onNewConnection stores the conn object with 'pending_join_request'
             // The generic peerJsCallbacks.onConnectionOpen will be called from peerjs-multiplayer.js
             // if that library directly invokes it.
             // Here, we can update the status if this 'open' means the channel is ready before formal join.
            const connEntry = connections.get(conn.peer);
            if (connEntry && connEntry.status === 'pending_join_request') {
                // Update status to indicate channel is open, still awaiting application-level join.
                // connections.set(conn.peer, { ...connEntry, status: 'channel_open_pending_join' });
                console.log(`[PeerConn] Leader: Channel with ${conn.peer} is open. Awaiting REQUEST_JOIN_ROOM.`);
            }
            // Call the generic callback, which might be useful for logging or basic state.
            peerJsCallbacks.onConnectionOpen(conn.peer); 
        }
    });

    conn.on('data', (data) => {
        peerJsCallbacks.onDataReceived(data, conn.peer); 
    });

    conn.on('close', () => {
        peerJsCallbacks.onConnectionClose(conn.peer); 
        // Redundant: onConnectionClose callback already handles this.
        // if (isToLeaderConnection) {
        //     leaderConnection = null;
        // } else if (state.networkRoomData.isRoomLeader) {
        //     connections.delete(conn.peer);
        // }
    });

    conn.on('error', (err) => {
        peerJsCallbacks.onError(err, conn.peer); 
    });
}

export function ensurePeerInitialized(customCallbacks = {}) {
    const mergedCallbacks = { ...peerJsCallbacks, ...customCallbacks };

    const existingPeer = window.peerJsMultiplayer?.getPeer();
    if (existingPeer && !existingPeer.destroyed) {
        const currentPeerId = window.peerJsMultiplayer.getLocalId();
        console.log("[PeerConn] PeerJS already initialized and not destroyed. My ID:", currentPeerId);
        if (currentPeerId) {
            mergedCallbacks.onPeerOpen(currentPeerId);
        } else {
            console.warn("[PeerConn] Peer object exists but ID is null. Waiting for its 'open' event.");
            // If peer exists but ID is null, it means it's connecting.
            // We should ensure our mergedCallbacks are used when it *does* open.
            // This requires peerjs-multiplayer.js to use the latest passed callbacks.
            // For now, if init is called again, it should destroy and recreate.
            // The logic in initPeerSession in peerjs-multiplayer.js should handle this.
            // If we call init again, it will use the new mergedCallbacks.
            window.peerJsMultiplayer.init(null, mergedCallbacks);
        }
        return;
    }

    if (window.peerJsMultiplayer?.init) {
        console.log("[PeerConn] Initializing PeerJS via peerJsMultiplayer.init().");
        window.peerJsMultiplayer.init(null, mergedCallbacks); 
    } else {
        console.error("[PeerConn] peerJsMultiplayer.init not found.");
        mergedCallbacks.onError({ type: 'init_failed', message: 'Módulo multijugador no disponible.' });
    }
}

export function hostNewRoom(hostPlayerData, gameSettings, isRandomMatchHost = false) {
    console.log("[PeerConn] hostNewRoom called.");
    state.resetNetworkRoomData(); 
    state.setPvpRemoteActive(true); 
    
    return new Promise((resolve, reject) => {
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
            gamePaired: false,
            _setupCompleteCallback: resolve, // Store resolve for onPeerOpen to call
            _setupErrorCallback: reject     // Store reject for onPeerOpen or onError to call
        });
        
        ui.showModalMessage("Creando sala de juego...");

        ensurePeerInitialized({
            // onPeerOpen for this specific call to ensurePeerInitialized:
            // The global peerJsCallbacks.onPeerOpen will handle the main logic due to pvpRemoteActive flag
            onPeerOpen: (hostPeerId) => { 
                console.log(`[PeerConn] hostNewRoom's local onPeerOpen for PeerID: ${hostPeerId}. Global onPeerOpen should manage full setup.`);
                // If the global onPeerOpen relies on _setupCompleteCallback being set, it should work.
                // No need to call resolve/reject here, global onPeerOpen will use the stored ones.
            },
            onError: (err) => { 
                ui.hideModalMessage();
                // Use the stored reject from the Promise, or global if not specific to this promise.
                if (state.networkRoomData?._setupErrorCallback) {
                     state.networkRoomData._setupErrorCallback(err);
                     delete state.networkRoomData._setupCompleteCallback;
                     delete state.networkRoomData._setupErrorCallback;
                } else {
                    peerJsCallbacks.onError(err); 
                }
                state.resetNetworkRoomData();
                state.setPvpRemoteActive(false);
                ui.showSetupScreen();
                // No explicit reject(err) here as _setupErrorCallback handles it if set.
            }
        });
    });
}

export function joinRoomById(leaderPeerIdToJoin, joinerPlayerData) {
    console.log(`[PeerConn] joinRoomById called for leader: ${leaderPeerIdToJoin}`);
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
            console.log(`[PeerConn] joinRoomById's local onPeerOpen for PeerID: ${myPeerId}. Global onPeerOpen will handle connection.`);
            if (state.networkRoomData.players && state.networkRoomData.players[0] && state.networkRoomData.players[0].peerId === null) {
                state.networkRoomData.players[0].peerId = myPeerId;
            }
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
    ui.hideNetworkInfo(); 
    if (state.networkRoomData.isRoomLeader) {
        broadcastToRoom({ type: 'error', message: 'El líder ha cerrado la sala.' }); 
        setTimeout(() => { 
            connections.forEach(connEntry => { // connEntry can be a direct conn or {connObject, status}
                const connToClose = connEntry.connObject || connEntry;
                if (connToClose && typeof connToClose.close === 'function') {
                    connToClose.close();
                }
            });
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

function sendDataToLeader(data) {
    if (leaderConnection && leaderConnection.open) {
        console.log(`[PeerConn C] TX to Leader: Type: ${data.type}`, data);
        leaderConnection.send(data);
    } else {
        console.warn("[PeerConn C] No open connection to leader. Cannot send data.", data);
    }
}

function sendDataToClient(clientPeerId, data) {
    const connEntry = connections.get(clientPeerId);
    const conn = connEntry?.connObject || connEntry; // Handle both direct conn and wrapper
    if (conn && conn.open) {
        console.log(`[PeerConn L] TX to Client ${clientPeerId}: Type: ${data.type}`, data);
        conn.send(data);
    } else {
        console.warn(`[PeerConn L] No open connection to client ${clientPeerId}. Cannot send data. Conn entry:`, connEntry);
    }
}

function broadcastToRoom(data, excludePeerId = null) { 
    if (!state.networkRoomData.isRoomLeader) return;
    console.log(`[PeerConn L] Broadcast TX: Type: ${data.type} (excluding ${excludePeerId || 'none'})`, data);
    connections.forEach((connEntry, peerId) => {
        const conn = connEntry?.connObject || connEntry; // Handle both direct conn and wrapper
        if (peerId !== excludePeerId && conn && conn.open) {
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
            leaderPeerId: state.networkRoomData.leaderPeerId, 
            roomId: state.networkRoomData.roomId 
        }
    });
}
export function sendPlayerReadyState(isReady) {
    if (state.networkRoomData.isRoomLeader) {
        const leaderData = state.networkRoomData.players.find(p => p.peerId === state.myPeerId);
        if (leaderData) {
            leaderData.isReady = isReady;
            state.setNetworkRoomData({ players: [...state.networkRoomData.players] });
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
                     state.networkRoomData.players.every(p => p.isReady && p.isConnected !== false);

    if (!canStart) {
        ui.updateLobbyMessage("No se puede iniciar: no todos los jugadores están listos o no hay suficientes.", true);
        return;
    }
    
    ui.hideNetworkInfo(); 
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