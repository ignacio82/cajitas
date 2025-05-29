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
        console.log(`[PeerConn] Global onPeerOpen triggered with ID: ${id}. Current state: pvpRemoteActive=${state.pvpRemoteActive}, isRoomLeader=${state.networkRoomData?.isRoomLeader}, roomState=${state.networkRoomData?.roomState}, roomId=${state.networkRoomData?.roomId}`);
        state.setMyPeerId(id); 

        const isJoiningViaUrlOnInit = window.cajitasJoinRoomOnLoad && 
                                    state.networkRoomData?.leaderPeerId && // Ensure leaderPeerId is set for join-by-URL context
                                    state.networkRoomData.leaderPeerId === id.replace(state.CAJITAS_PEER_ID_PREFIX, '') && // Check if current ID matches target leader
                                    !state.networkRoomData.isRoomLeader;
        
        if (!state.pvpRemoteActive && !isJoiningViaUrlOnInit) {
            console.log('[PeerConn] Global onPeerOpen: Not in active PvP mode and not a relevant pending URL join. Likely pre-initialization. Returning.');
            if (state.networkRoomData?._setupErrorCallback) {
                console.warn('[PeerConn] Global onPeerOpen: Found _setupErrorCallback during pre-init return. This might indicate an issue if pvpRemoteActive was expected to be true.');
            }
            return;
        }

        console.log('[PeerConn] Global onPeerOpen: Proceeding with active PvP/URL join logic.');

        if (state.networkRoomData.isRoomLeader && 
            (state.networkRoomData.roomState === 'waiting_for_players' || state.networkRoomData.roomState === 'creating_random_match_room')) {
            
            console.log('[PeerConn] Global onPeerOpen: Matched host conditions.');

            if (!state.networkRoomData.roomId) { 
                console.log('[PeerConn] Global onPeerOpen: Host setup - roomId not yet set from this peer ID. Finalizing...');

                if (!state.networkRoomData || !state.networkRoomData.players || !state.networkRoomData.players[0]) {
                    console.error('[PeerConn] Global onPeerOpen Error: networkRoomData or players array/players[0] not initialized for host!');
                    ui.showModalMessage("Error crítico al crear la sala: Faltan datos del anfitrión (P0G-2).");
                    if (state.networkRoomData._setupErrorCallback) {
                        state.networkRoomData._setupErrorCallback(new Error("networkRoomData or players array/players[0] not initialized for host in global onPeerOpen"));
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

                console.log(`[PeerConn] Global onPeerOpen: Host setup complete. Room ID: ${id}. Host player[0].peerId set to: ${state.networkRoomData.players[0].peerId}`);

                ui.showLobbyScreen();
                ui.updateLobbyUI();
                ui.updateGameModeUI(); 
                
                const gameLink = `${CAJITAS_BASE_URL}/?room=${id}&slots=${state.networkRoomData.maxPlayers}`;
                console.log("[PeerConn] Global onPeerOpen: Calling displayQRCode for host.");
                ui.displayQRCode(gameLink, `${state.CAJITAS_PEER_ID_PREFIX}${id}`,
                    `Compartí este enlace o ID para que ${state.networkRoomData.maxPlayers - 1} jugador(es) más se unan:`);
                
                if (state.networkRoomData.roomState === 'creating_random_match_room') {
                    matchmaking.updateHostedRoomStatus(id, state.networkRoomData.gameSettings, state.networkRoomData.maxPlayers, state.networkRoomData.players.length);
                }
                console.log("[PeerConn] Global onPeerOpen: Hiding modal message after host setup.");
                ui.hideModalMessage(); 

                if (state.networkRoomData._setupCompleteCallback) {
                    console.log("[PeerConn] Global onPeerOpen: Calling _setupCompleteCallback for hostNewRoom promise.");
                    state.networkRoomData._setupCompleteCallback(id); 
                    delete state.networkRoomData._setupCompleteCallback;
                    delete state.networkRoomData._setupErrorCallback;
                } else {
                    console.warn("[PeerConn] Global onPeerOpen: _setupCompleteCallback was not defined for host setup completion.");
                }

            } else if (state.networkRoomData.roomId === id) {
                console.log('[PeerConn] Global onPeerOpen: Host PeerJS reconnected or event fired again for existing room. Ensuring UI is correct.');
                ui.showLobbyScreen();
                ui.updateLobbyUI();
                ui.updateGameModeUI();
                const gameLink = `${CAJITAS_BASE_URL}/?room=${id}&slots=${state.networkRoomData.maxPlayers}`;
                ui.displayQRCode(gameLink, `${state.CAJITAS_PEER_ID_PREFIX}${id}`,
                    `Compartí este enlace o ID para que ${state.networkRoomData.maxPlayers - 1} jugador(es) más se unan:`);
                ui.hideModalMessage(); 
                 if (state.networkRoomData._setupCompleteCallback) { 
                    state.networkRoomData._setupCompleteCallback(id);
                    delete state.networkRoomData._setupCompleteCallback;
                    delete state.networkRoomData._setupErrorCallback;
                }
            } else {
                 console.warn(`[PeerConn] Global onPeerOpen: Host conditions met, but roomId ('${state.networkRoomData.roomId}') differs from current peerId ('${id}') or was already set. This state might be unexpected during initial host setup if roomId was pre-filled differently.`);
            }

        } else if (!state.networkRoomData.isRoomLeader && state.networkRoomData.leaderPeerId && !leaderConnection && state.pvpRemoteActive) {
            console.log(`[PeerConn] Global onPeerOpen: Joiner's PeerJS opened (ID: ${id}). pvpRemoteActive=${state.pvpRemoteActive}. Attempting to connect to leader: ${state.networkRoomData.leaderPeerId}`);
            if (state.networkRoomData.players && state.networkRoomData.players[0] && state.networkRoomData.players[0].peerId === null) {
                state.networkRoomData.players[0].peerId = id; // Assign peerId to the placeholder joiner player object
                state.setNetworkRoomData({ players: [...state.networkRoomData.players] }); // Ensure change is reflected
                console.log(`[PeerConn] Global onPeerOpen: Joiner's own player entry peerId updated to ${id}`);
            }

            if (window.peerJsMultiplayer?.connect) {
                const connToLeader = window.peerJsMultiplayer.connect(state.networkRoomData.leaderPeerId);
                if (connToLeader) {
                    leaderConnection = connToLeader;
                    setupConnectionEventHandlers(leaderConnection, true);
                } else {
                     console.error(`[PeerConn] Global onPeerOpen: peer.connect() returned null when trying to connect to leader.`);
                     peerJsCallbacks.onError({type: 'connect_failed', message: 'Failed to initiate connection to leader (connect returned null).'});
                }
            } else {
                peerJsCallbacks.onError({type: 'connect_error', message: 'PeerJS connect function not available.'});
            }
        } else {
            console.log(`[PeerConn] Global onPeerOpen: PeerJS opened with ID ${id}, but did not match primary host/join logic paths. Current state (pvpActive: ${state.pvpRemoteActive}, isLeader: ${state.networkRoomData?.isRoomLeader}, roomState: ${state.networkRoomData?.roomState}, roomId: ${state.networkRoomData?.roomId}, leaderPeerId: ${state.networkRoomData?.leaderPeerId}, leaderConnection: ${!!leaderConnection})`);
        }
    },

    onNewConnection: (conn) => { 
        if (!state.networkRoomData.isRoomLeader) {
            console.warn(`[PeerJS] Non-leader received a connection from ${conn.peer}. Rejecting.`);
            conn.on('open', () => conn.close()); 
            return;
        }
        
        const activeOrPendingPlayers = Array.from(connections.values()).filter(c => c.status !== 'rejected').length + (state.networkRoomData.isRoomLeader ? 1:0); 
        
        if (activeOrPendingPlayers > state.networkRoomData.maxPlayers && !connections.has(conn.peer)) { 
             // Already at max players (leader + max-1 others), reject new distinct connection.
            console.warn(`[PeerJS] Room is full. Max players: ${state.networkRoomData.maxPlayers}, current active/pending: ${activeOrPendingPlayers -1} (excluding leader). Rejecting new connection from ${conn.peer}.`);
            conn.on('open', () => { 
                conn.send({ type: MSG_TYPE.JOIN_REJECTED, reason: 'room_full' });
                setTimeout(() => conn.close(), 500); 
            });
            return;
        }
        console.log(`[PeerJS] Leader received incoming connection from ${conn.peer}.`);
        
        connections.set(conn.peer, { connObject: conn, status: 'pending_join_request' }); 
        setupConnectionEventHandlers(conn, false); 
    },

    onConnectionOpen: (peerId) => { 
        console.log(`[PeerJS] Data connection opened with ${peerId}.`);
        const connEntry = connections.get(peerId);

        if (state.networkRoomData.isRoomLeader) {
            console.log(`[PeerConn] Leader: Connection from client ${peerId} is now open. Current status in map: ${connEntry?.status}. Waiting for their join request.`);
            if (connEntry && connEntry.status === 'pending_join_request') {
                // Client should now send REQUEST_JOIN_ROOM
            } else if (connEntry && (connEntry.status === 'active' || connEntry.connObject)) { 
                console.log(`[PeerConn] Leader: Re-established or already active connection with ${peerId}.`);
            } else if (!connEntry && peerId !== state.myPeerId) { 
                 console.warn(`[PeerConn] Leader: Connection opened with ${peerId}, but no matching pending/active entry in connections map. This might be a new client establishing DataChannel.`);
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
            // Call to handleClientDataReception was guarded by AI. It IS defined in this file.
            handleClientDataReception(data, fromPeerId);
        }
    },

    onConnectionClose: (peerId) => {
        console.log(`[PeerJS] Connection with ${peerId} closed.`);
        if (state.networkRoomData.isRoomLeader) {
            const connEntry = connections.get(peerId);
            if (connEntry) { 
                connections.delete(peerId); 
                const leavingPlayer = state.networkRoomData.players.find(p => p.peerId === peerId);
                if (leavingPlayer) {
                    state.removePlayerFromNetworkRoom(peerId); 
                    broadcastToRoom({ type: MSG_TYPE.PLAYER_LEFT, playerId: leavingPlayer.id, peerId: peerId });
                    reassignPlayerIdsAndBroadcastUpdate(); 
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
        console.error(`[PeerJS] Error (context: ${peerIdContext || 'general'}): Type: ${err.type}, Message: ${err.message || err}`, err);
        let displayMessage = err.message || (typeof err === 'string' ? err : 'Error desconocido de conexión.');
        if (err.type) {
            if (err.type === 'peer-unavailable' || err.type === 'unavailable-id') {
                const peerIdMsgPart = peerIdContext || err.message?.match(/peer\s(.+)/)?.[1] || state.networkRoomData.leaderPeerId || 'remoto';
                displayMessage = `No se pudo conectar al jugador: ${peerIdMsgPart}. Verificá el ID/disponibilidad.`;
            } else if (err.type === 'network') {
                displayMessage = "Error de red. Verificá tu conexión a internet.";
            } else if (err.type === 'webrtc') {
                displayMessage = "Error de WebRTC. Puede ser un problema de firewall o red.";
            } else if (err.type === 'disconnected') {
                 displayMessage = "Desconectado del servidor PeerJS. Verifica tu conexión.";
            } else if (err.type === 'server-error') {
                 displayMessage = "Error del servidor PeerJS. Intenta más tarde.";
            } else {
                displayMessage = `${err.type}: ${displayMessage}`;
            }
        }
        
        if (state.networkRoomData?._setupErrorCallback) {
            console.log("[PeerConn] onError: Calling _setupErrorCallback due to PeerJS error during host setup.");
            state.networkRoomData._setupErrorCallback(err); 
            delete state.networkRoomData._setupCompleteCallback;
            delete state.networkRoomData._setupErrorCallback;
        } else {
            ui.showModalMessage(`Error de conexión: ${displayMessage}`);
        }
        ui.updateMessageArea("Error de conexión.", true);
        
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
    const connectedPlayers = state.networkRoomData.players.filter(p => p.isConnected !== false); 
    
    connectedPlayers.sort((a, b) => { // Sort by original ID to maintain order if possible
        const idA = typeof a.id === 'number' ? a.id : Infinity;
        const idB = typeof b.id === 'number' ? b.id : Infinity;
        return idA - idB;
    });

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
    // If it's already an active connection (direct conn object), connObject will be undefined here.
    // So, connToUse should check connEntryWrapper.connObject first, then connEntryWrapper itself if it's not a wrapper.
    const connToUse = connEntryWrapper?.connObject || connEntryWrapper;


    if (!connToUse && data.type !== MSG_TYPE.REQUEST_JOIN_ROOM) { 
        console.warn(`[PeerConn L] Data from ${fromPeerId} but no active connection object found. Type: ${data.type}. Ignored.`);
        return;
    }
    // For REQUEST_JOIN_ROOM, connEntryWrapper.status should be 'pending_join_request'
    // and connEntryWrapper.connObject will be the actual connection.

    switch (data.type) {
        case MSG_TYPE.REQUEST_JOIN_ROOM:
            if (!connEntryWrapper || connEntryWrapper.status !== 'pending_join_request' || !connEntryWrapper.connObject) {
                console.warn(`[PeerConn L] REQUEST_JOIN_ROOM from ${fromPeerId} but no valid pending connection found or connObject missing. Status: ${connEntryWrapper?.status}. Ignoring.`);
                // Try to send rejection if connObject somehow exists on a bad entry
                connEntryWrapper?.connObject?.send({ type: MSG_TYPE.JOIN_REJECTED, reason: 'internal_server_error_or_stale_request' });
                return;
            }

            const actualConnObject = connEntryWrapper.connObject;

            if (state.networkRoomData.players.length >= state.networkRoomData.maxPlayers) {
                actualConnObject.send({ type: MSG_TYPE.JOIN_REJECTED, reason: 'room_full' });
                connections.set(fromPeerId, { ...connEntryWrapper, status: 'rejected' }); 
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
            
            connections.set(fromPeerId, actualConnObject); // Store the direct connection object now, status is implicitly 'active'.

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
             if (!connections.has(fromPeerId)) { 
                console.warn(`[PeerConn L] PLAYER_READY_CHANGED from peer ${fromPeerId} not in active connections map. Ignored.`);
                return;
            }
            const playerToUpdate = state.networkRoomData.players.find(p => p.peerId === fromPeerId);
            if (playerToUpdate) {
                playerToUpdate.isReady = data.isReady;
                state.setNetworkRoomData({players: [...state.networkRoomData.players]}); 
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
            if (!connections.has(fromPeerId)) { 
                console.warn(`[PeerConn L] GAME_MOVE from peer ${fromPeerId} not in active connections map. Ignored.`);
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

// handleClientDataReception remains the same as in Turn 40 (no changes suggested by AI for this specifically)
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
                            name: myLocalInitialData.name, 
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
            } else { 
                const myData = state.networkRoomData.players.find(p=> p.peerId === state.myPeerId);
                if(myData) {
                    Object.assign(myData, data.player); 
                    state.setNetworkRoomData({ players: [...state.networkRoomData.players] });
                }
            }
            ui.updateLobbyUI();
            break;

        case MSG_TYPE.PLAYER_LEFT:
            const leftPlayer = state.networkRoomData.players.find(p => p.id === data.playerId && p.peerId === data.peerId);
            if (leftPlayer) {
                state.removePlayerFromNetworkRoom(data.peerId); 
                ui.updateLobbyMessage(`${leftPlayer.name} ha salido de la sala.`);
            } else {
                state.removePlayerFromNetworkRoom(data.peerId);
            }
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


export function ensurePeerInitialized(customOnSuccess, customOnError) {
    // Capture callbacks for this specific call, ensuring they are functions
    const onSuccessThisCall = (typeof customOnSuccess === 'function') ? customOnSuccess : null;
    const onErrorThisCall = (typeof customOnError === 'function') ? customOnError : null;

    const existingPeer = window.peerJsMultiplayer?.getPeer();
    if (existingPeer && !existingPeer.destroyed) {
        const currentPeerId = window.peerJsMultiplayer.getLocalId();
        console.log("[PeerConn] ensurePeerInitialized: PeerJS already initialized and not destroyed. My ID:", currentPeerId);
        if (currentPeerId) {
            if (onSuccessThisCall) onSuccessThisCall(currentPeerId); 
        } else {
            console.warn("[PeerConn] ensurePeerInitialized: Peer object exists but ID is null. PeerJS might be connecting. Setting up temp listeners for this call.");
            const tempPeerOpen = (id) => {
                if (onSuccessThisCall) onSuccessThisCall(id);
                existingPeer.off('open', tempPeerOpen); // Clean up listener
                existingPeer.off('error', tempPeerError); // Clean up listener
            };
            const tempPeerError = (err) => {
                if (onErrorThisCall) onErrorThisCall(err);
                existingPeer.off('open', tempPeerOpen); // Clean up listener
                existingPeer.off('error', tempPeerError); // Clean up listener
            };
            existingPeer.on('open', tempPeerOpen);
            existingPeer.on('error', tempPeerError);
        }
        return;
    }

    if (window.peerJsMultiplayer?.init) {
        console.log("[PeerConn] ensurePeerInitialized: Initializing new PeerJS instance via peerJsMultiplayer.init().");
        
        // Define callbacks that will be passed to peerJsMultiplayer.init
        // These will invoke the global peerJsCallbacks AND the custom ones for this specific call.
        const initDynamicCallbacks = {
            onPeerOpen: (id) => {
                peerJsCallbacks.onPeerOpen(id); // Always call the global handler
                if (onSuccessThisCall) onSuccessThisCall(id); // Then the custom success for this specific call
            },
            onError: (err) => {
                peerJsCallbacks.onError(err); // Always call the global handler
                if (onErrorThisCall) onErrorThisCall(err); // Then the custom error for this specific call
            },
            // Pass other global callbacks directly as they don't have custom versions per call
            onNewConnection: peerJsCallbacks.onNewConnection,
            onConnectionOpen: peerJsCallbacks.onConnectionOpen,
            onDataReceived: peerJsCallbacks.onDataReceived,
            onConnectionClose: peerJsCallbacks.onConnectionClose,
        };

        window.peerJsMultiplayer.init(null, initDynamicCallbacks); // Pass the callbacks for the new peer instance
    } else {
        console.error("[PeerConn] ensurePeerInitialized: peerJsMultiplayer.init not found.");
        const errorPayload = { type: 'init_failed', message: 'Módulo multijugador no disponible.' };
        if (onErrorThisCall) onErrorThisCall(errorPayload);
        else peerJsCallbacks.onError(errorPayload); // Fallback to global if no custom error handler
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
            _setupCompleteCallback: resolve, 
            _setupErrorCallback: reject     
        });
        
        ui.showModalMessage("Creando sala de juego...");

        ensurePeerInitialized(
            (hostPeerId) => { 
                console.log(`[PeerConn] hostNewRoom's ensurePeerInitialized customOnSuccess for PeerID: ${hostPeerId}. Global onPeerOpen expected to handle full setup and promise resolution.`);
                // The promise is resolved/rejected by the global onPeerOpen (which is called by initDynamicCallbacks.onPeerOpen)
                // via _setupCompleteCallback/_setupErrorCallback.
            },
            (err) => { 
                console.error("[PeerConn] Error in hostNewRoom's ensurePeerInitialized customOnError call:", err);
                ui.hideModalMessage();
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
            }
        );
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

    ensurePeerInitialized(
        (myPeerId) => { 
            console.log(`[PeerConn] joinRoomById's ensurePeerInitialized customOnSuccess for PeerID: ${myPeerId}. Global onPeerOpen will handle connection attempt.`);
            if (state.networkRoomData.players && state.networkRoomData.players[0] && state.networkRoomData.players[0].peerId === null) {
                state.networkRoomData.players[0].peerId = myPeerId;
                state.setNetworkRoomData({ players: [...state.networkRoomData.players] });
            }
        },
        (err) => { 
            ui.hideModalMessage();
            peerJsCallbacks.onError(err); 
            state.resetNetworkRoomData();
            state.setPvpRemoteActive(false);
            ui.showSetupScreen();
        }
    );
}

export function leaveRoom() {
    console.log("[PeerConn] Leaving room...");
    ui.hideNetworkInfo(); 
    if (state.networkRoomData.isRoomLeader) {
        broadcastToRoom({ type: 'error', message: 'El líder ha cerrado la sala.' }); 
        setTimeout(() => { 
            connections.forEach(connEntry => { 
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
    const conn = connEntry?.connObject || connEntry; 
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
        const conn = connEntry?.connObject || connEntry; 
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