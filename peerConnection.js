// peerConnection.js

import * as state from './state.js';
import * as ui from './ui.js';
import * as gameLogic from './gameLogic.js';
import * as matchmaking from './matchmaking_supabase.js';

const CAJITAS_BASE_URL = "https://cajitas.martinez.fyi"; // Or your game's URL

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

        if (!state.pvpRemoteActive) {
            console.log('[PeerConn] onPeerOpen: Not in active PvP mode (likely pre-initialization). Returning.');
            // If you needed to store this id for a join-by-URL that happens before user clicks anything,
            // you could set a temporary state variable like state.setPrelimPeerId(id);
            // For now, joinRoomById and hostNewRoom handle their own ensurePeerInitialized context.
            return;
        }

        // If we've reached here, pvpRemoteActive is true.
        // This means an active attempt to host or join is in progress.

        if (state.networkRoomData.isRoomLeader && !state.networkRoomData.roomId) {
            // This is the flow for a host whose PeerJS has just opened,
            // and whose roomID hasn't been set from their peerID yet.
            // state.networkRoomData should have been partially set up by hostNewRoom().
            console.log('[PeerConn] onPeerOpen: Finalizing host setup.');

            if (!state.networkRoomData || !state.networkRoomData.players || !state.networkRoomData.players[0]) {
                console.error('[PeerConn] onPeerOpen Error: networkRoomData or players array not initialized for host! This should not happen if hostNewRoom ran correctly.');
                ui.showModalMessage("Error crítico al crear la sala: Faltan datos del anfitrión.");
                // Consider resetting state or other error handling
                state.resetNetworkRoomData();
                state.setPvpRemoteActive(false);
                ui.showSetupScreen();
                return;
            }
            
            // Set the host's actual peerId in their player object
            state.networkRoomData.players[0].peerId = id; 
            // Now set the canonical room ID and ensure players array update is recognized
            state.setNetworkRoomData({ 
                roomId: id, 
                leaderPeerId: id,
                players: [...state.networkRoomData.players] // Propagate change to players array
            }); 

            console.log(`[PeerConn] Room setup complete. Room ID (Host Peer ID): ${id}. Host player PeerID set to: ${state.networkRoomData.players[0].peerId}`);

            // UI Sequence (show lobby, update general UI, then show QR)
            ui.showLobbyScreen();
            ui.updateLobbyUI();
            ui.updateGameModeUI(); 
            
            const gameLink = `${CAJITAS_BASE_URL}/?room=${id}&slots=${state.networkRoomData.maxPlayers}`;
            ui.displayQRCode(gameLink, `${state.CAJITAS_PEER_ID_PREFIX}${id}`,
                `Compartí este enlace o ID para que ${state.networkRoomData.maxPlayers - 1} jugador(es) más se unan:`);
            
            if (state.networkRoomData.roomState === 'creating_random_match_room') {
                matchmaking.updateHostedRoomStatus(id, state.networkRoomData.gameSettings, state.networkRoomData.maxPlayers, state.networkRoomData.players.length);
                state.setNetworkRoomData({ roomState: 'waiting_for_players' });
            }
            ui.hideModalMessage(); // Hide "Creando sala..."

        } else if (state.networkRoomData.isRoomLeader && state.networkRoomData.roomId === id) {
            // This case handles if onPeerOpen fires again for an already set-up host (e.g., PeerServer reconnection)
            console.log('[PeerConn] onPeerOpen: Host PeerJS reconnected or event fired again for existing room. Ensuring UI is correct.');
            ui.showLobbyScreen();
            ui.updateLobbyUI();
            ui.updateGameModeUI();
            const gameLink = `${CAJITAS_BASE_URL}/?room=${id}&slots=${state.networkRoomData.maxPlayers}`;
            ui.displayQRCode(gameLink, `${state.CAJITAS_PEER_ID_PREFIX}${id}`,
                `Compartí este enlace o ID para que ${state.networkRoomData.maxPlayers - 1} jugador(es) más se unan:`);
            ui.hideModalMessage(); 

        } else if (!state.networkRoomData.isRoomLeader && state.networkRoomData.leaderPeerId && !leaderConnection) {
            // This is the flow for a joiner whose PeerJS has just opened.
            console.log(`[PeerConn] onPeerOpen: Joiner's PeerJS opened (ID: ${id}). Attempting to connect to leader: ${state.networkRoomData.leaderPeerId}`);
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
            console.log(`[PeerConn] onPeerOpen: PeerJS opened with ID ${id}, but current state (pvpActive: ${state.pvpRemoteActive}, isLeader: ${state.networkRoomData.isRoomLeader}, roomId: ${state.networkRoomData.roomId}) doesn't match primary hosting/joining flows in this callback.`);
        }
    },

    onNewConnection: (conn) => { 
        if (!state.networkRoomData.isRoomLeader) {
            console.warn(`[PeerJS] Non-leader received a connection from ${conn.peer}. Rejecting.`);
            conn.on('open', () => conn.close()); 
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
                const myPlayerDataFromState = state.networkRoomData.players.find(p => p.peerId === state.myPeerId); 
                if (myPlayerDataFromState) { // Player data should exist from joinRoomById
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
            } else if (err.type === 'disconnected') {
                 message = "Desconectado del servidor PeerJS. Intentando reconectar...";
            }
        }
        ui.showModalMessage(`Error de conexión: ${message}`);
        ui.updateMessageArea("Error de conexión.", true);
        
        if (!state.networkRoomData.isRoomLeader && (state.networkRoomData.roomState === 'connecting_to_lobby' || state.networkRoomData.roomState === 'awaiting_join_approval')) {
            // If client fails to connect or has error during these states, reset.
            state.resetNetworkRoomData();
            state.setPvpRemoteActive(false);
            ui.showSetupScreen();
            ui.hideNetworkInfo();
        } 
    }
};

function reassignPlayerIdsAndBroadcastUpdate() {
    if (!state.networkRoomData.isRoomLeader) return;
    const connectedPlayers = state.networkRoomData.players.filter(p => p.isConnected);
    
    connectedPlayers.sort((a, b) => a.id - b.id); // Preserve order of those remaining as much as possible

    let idChanged = false;
    connectedPlayers.forEach((player, index) => {
        if (player.id !== index) {
            idChanged = true;
        }
        player.id = index; 
        if (player.peerId === state.myPeerId) { 
            state.setNetworkRoomData({ myPlayerIdInRoom: index });
        }
    });
    // Update the main players list in the state, keeping only connected ones with re-assigned IDs
    state.setNetworkRoomData({ players: connectedPlayers }); 

    if (idChanged || true) { 
       broadcastRoomState();
    }
}

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
            // Ensure the connection is stored. onNewConnection should have called setupConnectionEventHandlers
            // which might not store it if we wait for REQUEST_JOIN_ROOM.
            // Let's ensure it's stored here.
            const activeConn = window.peerJsMultiplayer.getConnection(fromPeerId); // Helper needed in peerjs-multiplayer.js
            if (activeConn) { // Or just use 'conn' from onNewConnection if that's reliable. For now, assume clientConn is the one.
                 connections.set(fromPeerId, clientConn || activeConn);
            } else if (clientConn) {
                 connections.set(fromPeerId, clientConn);
            }
             else {
                console.error(`[PeerConn L] No connection object available for ${fromPeerId} upon JOIN_REQUEST.`);
            }


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
            // My initial player data (name, icon, color) was sent to leader.
            // Leader includes it in roomData.players. Update local state based on that.
            const myPlayerFromServer = data.roomData.players.find(p => p.id === data.yourPlayerId);

            state.setNetworkRoomData({
                myPlayerIdInRoom: data.yourPlayerId,
                // players: data.roomData.players, // Use this full list
                gameSettings: data.roomData.gameSettings,
                maxPlayers: data.roomData.maxPlayers,
                roomState: 'lobby',
                // Update players, ensuring my local customizations are preserved if they weren't part of the initial echo from leader
                players: data.roomData.players.map(p => {
                    if (p.id === data.yourPlayerId && myPlayerFromServer) {
                        // My local details before joining (name, icon, color)
                        const localCustomizations = state.networkRoomData.players.find(lp => lp.peerId === state.myPeerId);
                        return {
                            ...myPlayerFromServer, // Base data from server
                            name: localCustomizations?.name || myPlayerFromServer.name,
                            icon: localCustomizations?.icon || myPlayerFromServer.icon,
                            color: localCustomizations?.color || myPlayerFromServer.color,
                        };
                    }
                    return p;
                })
            });
            
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
            if (data.player.peerId !== state.myPeerId) { // Only add if it's not me
                 const existingPlayer = state.networkRoomData.players.find(p => p.peerId === data.player.peerId);
                 if (!existingPlayer) {
                    state.addPlayerToNetworkRoom(data.player);
                 } else { // Player reconnected or data resent, update instead of adding duplicate
                    Object.assign(existingPlayer, data.player);
                    state.setNetworkRoomData({ players: [...state.networkRoomData.players] }); // Trigger update
                 }
            }
            ui.updateLobbyUI();
            break;

        case MSG_TYPE.PLAYER_LEFT:
            const leftPlayer = state.networkRoomData.players.find(p => p.id === data.playerId);
            state.removePlayerFromNetworkRoom(data.peerId); 
            if (leftPlayer) ui.updateLobbyMessage(`${leftPlayer.name} ha salido de la sala.`);
            // Leader will send ROOM_STATE_UPDATE with re-assigned IDs if necessary
            ui.updateLobbyUI(); // Update UI immediately
            break;

        case MSG_TYPE.ROOM_STATE_UPDATE:
            state.setNetworkRoomData({
                players: data.roomData.players,
                gameSettings: data.roomData.gameSettings,
                maxPlayers: data.roomData.maxPlayers,
                myPlayerIdInRoom: data.roomData.players.find(p => p.peerId === state.myPeerId)?.id ?? state.networkRoomData.myPlayerIdInRoom,
                leaderPeerId: data.roomData.leaderPeerId || state.networkRoomData.leaderPeerId, // update leader ID if provided
                roomId: data.roomData.roomId || state.networkRoomData.roomId, // update room ID if provided
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
            ui.hideNetworkInfo(); // Hide QR/Link area as game starts
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
    const mergedCallbacks = { ...peerJsCallbacks, ...customCallbacks };

    if (window.peerJsMultiplayer?.getPeer && window.peerJsMultiplayer.getPeer() && !window.peerJsMultiplayer.getPeer().destroyed) {
        const currentPeerId = window.peerJsMultiplayer.getLocalId();
        console.log("[PeerConn] PeerJS already initialized and not destroyed. My ID:", currentPeerId);
        if (currentPeerId) {
            // If peer already exists and has an ID, immediately call the onPeerOpen from mergedCallbacks
            // This ensures that if ensurePeerInitialized is called when peer is already open, the logic proceeds.
            mergedCallbacks.onPeerOpen(currentPeerId);
        } else {
            // This case is tricky: peer object exists but ID is null (e.g., connecting to server).
            // Rely on PeerJS own 'open' event for this existing peer object,
            // which should use the global peerJsCallbacks.onPeerOpen.
            // Or, re-init if this state is problematic. For now, let's log.
            console.warn("[PeerConn] Peer object exists but ID is null. Waiting for its 'open' event or re-init if needed.");
            // To be safe, one could re-register the callbacks for the existing peer if PeerJS lib allows it,
            // or call init which might handle recreation. Let's assume init handles it.
             window.peerJsMultiplayer.init(null, mergedCallbacks);
        }
        return;
    }

    if (window.peerJsMultiplayer?.init) {
        console.log("[PeerConn] Initializing PeerJS via peerJsMultiplayer.init().");
        window.peerJsMultiplayer.init(null, mergedCallbacks); // Pass merged callbacks
    } else {
        console.error("[PeerConn] peerJsMultiplayer.init not found.");
        mergedCallbacks.onError({ type: 'init_failed', message: 'Módulo multijugador no disponible.' });
    }
}

export function hostNewRoom(hostPlayerData, gameSettings, isRandomMatchHost = false) {
    console.log("[PeerConn] hostNewRoom called.");
    state.resetNetworkRoomData(); 
    state.setPvpRemoteActive(true); // Set this BEFORE ensurePeerInitialized
    state.setNetworkRoomData({
        isRoomLeader: true,
        myPlayerIdInRoom: 0, 
        gameSettings: { rows: gameSettings.rows, cols: gameSettings.cols },
        maxPlayers: gameSettings.maxPlayers,
        players: [{ 
            id: 0,
            peerId: null, // Will be set by the global onPeerOpen callback
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

    // ensurePeerInitialized will use the global peerJsCallbacks.onPeerOpen,
    // which is now guarded by state.pvpRemoteActive.
    // The local onPeerOpen here is just for any actions specific to *this* init call finishing.
    ensurePeerInitialized({
        onPeerOpen: (hostPeerId) => { 
            console.log(`[PeerConn] hostNewRoom's ensurePeerInitialized successfully got PeerID: ${hostPeerId}. Global onPeerOpen will handle full UI setup.`);
            // ui.hideModalMessage(); // Modal is hidden in the global onPeerOpen after full setup.
        },
        onError: (err) => { // Error specific to this PeerJS initialization attempt
            ui.hideModalMessage();
            peerJsCallbacks.onError(err); // Use global handler for consistent error display
            state.resetNetworkRoomData();
            state.setPvpRemoteActive(false);
            ui.showSetupScreen();
        }
    });
}

export function joinRoomById(leaderPeerIdToJoin, joinerPlayerData) {
    console.log(`[PeerConn] joinRoomById called for leader: ${leaderPeerIdToJoin}`);
    state.resetNetworkRoomData(); 
    state.setPvpRemoteActive(true); // Set this BEFORE ensurePeerInitialized
    state.setNetworkRoomData({
        roomId: leaderPeerIdToJoin, 
        leaderPeerId: leaderPeerIdToJoin,
        isRoomLeader: false,
        players: [{ // Temporary placeholder for self, peerId will be set by global onPeerOpen
            peerId: null, 
            name: joinerPlayerData.name,
            icon: joinerPlayerData.icon,
            color: joinerPlayerData.color,
            // id will be assigned by leader
        }],
        roomState: 'connecting_to_lobby'
    });
    ui.showModalMessage(`Intentando conectar a la sala ${state.CAJITAS_PEER_ID_PREFIX}${leaderPeerIdToJoin}...`);

    ensurePeerInitialized({
        onPeerOpen: (myPeerId) => {
            console.log(`[PeerConn] joinRoomById's ensurePeerInitialized successful for PeerID: ${myPeerId}. Global onPeerOpen will handle connection attempt.`);
            // Update my player data with the obtained peerId
            if (state.networkRoomData.players && state.networkRoomData.players[0] && state.networkRoomData.players[0].peerId === null) {
                state.networkRoomData.players[0].peerId = myPeerId;
                state.setNetworkRoomData({ players: [...state.networkRoomData.players] }); // Ensure state update if needed
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
    ui.hideNetworkInfo(); // Hide QR code area when leaving a room
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
    state.setPvpRemoteActive(false); // Set pvpRemoteActive to false
    state.setGameActive(false);
    // Caller (main.js) should handle UI transition (e.g., ui.showSetupScreen())
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
            leaderPeerId: state.networkRoomData.leaderPeerId, // Send leaderPeerId
            roomId: state.networkRoomData.roomId // Send roomId
        }
    });
}
export function sendPlayerReadyState(isReady) {
    if (state.networkRoomData.isRoomLeader) {
        const leaderData = state.networkRoomData.players.find(p => p.peerId === state.myPeerId);
        if (leaderData) {
            leaderData.isReady = isReady;
            // Update the players array in the state to reflect this change for the leader's own UI
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
                     state.networkRoomData.players.every(p => p.isReady && p.isConnected);

    if (!canStart) {
        ui.updateLobbyMessage("No se puede iniciar: no todos los jugadores están listos o no hay suficientes.", true);
        return;
    }
    
    ui.hideNetworkInfo(); // Hide QR before starting game
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