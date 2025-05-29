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
        const oldPeerId = state.myPeerId;
        state.setMyPeerId(id);

        if (state.networkRoomData._peerInitResolve) {
            console.log(`[PeerConn] Global onPeerOpen: Resolving _peerInitResolve for ID ${id}`);
            state.networkRoomData._peerInitResolve(id);
            delete state.networkRoomData._peerInitResolve;
            delete state.networkRoomData._peerInitReject;
        }


        if (!state.pvpRemoteActive) {
            console.log('[PeerConn] Global onPeerOpen: Not in active PvP mode. Likely pre-initialization. Returning.');
            return;
        }

        console.log('[PeerConn] Global onPeerOpen: Proceeding with active PvP/URL join logic.');

        if (state.networkRoomData.isRoomLeader &&
            (state.networkRoomData.roomState === 'waiting_for_players' || state.networkRoomData.roomState === 'creating_random_match_room')) {

            console.log('[PeerConn] Global onPeerOpen: Matched host conditions.');

            // Check if this is the initial setup for the host
            if (!state.networkRoomData.roomId || state.networkRoomData.roomId !== id) {
                console.log('[PeerConn] Global onPeerOpen: Host setup - roomId not yet set from this peer ID or differs. Finalizing...');

                if (!state.networkRoomData.players || !state.networkRoomData.players[0]) {
                    console.error('[PeerConn] Global onPeerOpen Error: networkRoomData or players array/players[0] not initialized for host!');
                    ui.showModalMessage("Error crítico al crear la sala: Faltan datos del anfitrión (P0G-INIT).");
                    if (state.networkRoomData._setupErrorCallback) {
                        state.networkRoomData._setupErrorCallback(new Error("networkRoomData or players array/players[0] not initialized for host in global onPeerOpen"));
                    }
                    return;
                }
                // Ensure leader's player data uses the new peer ID
                state.networkRoomData.players[0].peerId = id;
                state.setNetworkRoomData({
                    roomId: id,
                    leaderPeerId: id,
                    players: [...state.networkRoomData.players] // Propagate the peerId update
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
                }

            } else if (state.networkRoomData.roomId === id) {
                console.log('[PeerConn] Global onPeerOpen: Host PeerJS reconnected or event fired again for existing room. Ensuring UI is correct.');
                // This path might be hit if PeerJS reconnects. UI should already be in lobby.
                // Simply ensure QR is displayed if it was hidden
                if (ui.networkInfoArea && ui.networkInfoArea.classList.contains('hidden') && state.networkRoomData.roomState === 'waiting_for_players') {
                    const gameLink = `${CAJITAS_BASE_URL}/?room=${id}&slots=${state.networkRoomData.maxPlayers}`;
                    ui.displayQRCode(gameLink, `${state.CAJITAS_PEER_ID_PREFIX}${id}`,
                        `Compartí este enlace o ID para que ${state.networkRoomData.maxPlayers - 1} jugador(es) más se unan:`);
                }
                 if (state.networkRoomData._setupCompleteCallback) { // If a promise was pending
                    state.networkRoomData._setupCompleteCallback(id);
                }
            } else {
                 console.warn(`[PeerConn] Global onPeerOpen: Host conditions met, but roomId ('${state.networkRoomData.roomId}') differs from current peerId ('${id}') or was already set. This state might be unexpected during initial host setup if roomId was pre-filled differently.`);
            }
             // Clean up promise handlers after potential use
            delete state.networkRoomData._setupCompleteCallback;
            delete state.networkRoomData._setupErrorCallback;


        } else if (!state.networkRoomData.isRoomLeader && state.networkRoomData.leaderPeerId && !leaderConnection && state.pvpRemoteActive) {
            console.log(`[PeerConn] Global onPeerOpen: Joiner's PeerJS opened (ID: ${id}). pvpRemoteActive=${state.pvpRemoteActive}. Attempting to connect to leader: ${state.networkRoomData.leaderPeerId}`);

            // Ensure joiner's own player data has their new peer ID
            if (state.networkRoomData.players && state.networkRoomData.players[0]) {
                 if (state.networkRoomData.players[0].peerId !== id) {
                    state.networkRoomData.players[0].peerId = id;
                    state.setNetworkRoomData({ players: [...state.networkRoomData.players] });
                    console.log(`[PeerConn] Global onPeerOpen: Joiner's own player entry peerId updated to ${id}`);
                }
            } else {
                // Initialize player data for joiner if it's missing
                 state.setNetworkRoomData({
                    players: [{ // Assuming joiner is player 0 locally until assigned an ID by leader
                        peerId: id,
                        name: "Invitado Temporal", // Will be updated by getLocalPlayerCustomization
                        icon: "❓",
                        color: state.DEFAULT_PLAYER_COLORS[1] // A default color
                    }]
                });
                console.log(`[PeerConn] Global onPeerOpen: Joiner's player data initialized with peerId ${id}`);
            }


            if (window.peerJsMultiplayer?.connect) {
                const connToLeader = window.peerJsMultiplayer.connect(state.networkRoomData.leaderPeerId);
                if (connToLeader) {
                    leaderConnection = connToLeader;
                    setupConnectionEventHandlers(leaderConnection, true); // True indicates it's the leader connection
                } else {
                     console.error(`[PeerConn] Global onPeerOpen: peer.connect() returned null when trying to connect to leader ${state.networkRoomData.leaderPeerId}.`);
                     peerJsCallbacks.onError({type: 'connect_failed', message: `Failed to initiate connection to leader ${state.networkRoomData.leaderPeerId} (connect returned null).`});
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

        // Count active and pending (but not rejected) connections
        let connectedOrPendingClientCount = 0;
        connections.forEach(entry => {
            if (entry.status !== 'rejected') {
                connectedOrPendingClientCount++;
            }
        });
        const totalPlayersIncludingLeaderAndNew = connectedOrPendingClientCount + 1 + 1; // +1 for leader, +1 for this new conn


        if (totalPlayersIncludingLeaderAndNew > state.networkRoomData.maxPlayers && !connections.has(conn.peer)) {
            console.warn(`[PeerJS] Room is full. Max players: ${state.networkRoomData.maxPlayers}. Current players in room (incl. leader): ${state.networkRoomData.players.length}. Active/Pending connections: ${connectedOrPendingClientCount}. Rejecting new connection from ${conn.peer}.`);
            conn.on('open', () => {
                conn.send({ type: MSG_TYPE.JOIN_REJECTED, reason: 'room_full' });
                setTimeout(() => conn.close(), 500);
            });
            return;
        }
        console.log(`[PeerJS] Leader received incoming connection from ${conn.peer}.`);

        // Store with a temporary status, actual 'connection' established when client sends JOIN_REQUEST
        connections.set(conn.peer, { connObject: conn, status: 'pending_join_request', player: null });
        setupConnectionEventHandlers(conn, false); // False, it's a client connection
    },

    onConnectionOpen: (peerId) => {
        console.log(`[PeerJS] Data connection opened with ${peerId}.`);
        const connEntry = connections.get(peerId);

        if (state.networkRoomData.isRoomLeader) {
            console.log(`[PeerConn] Leader: Connection from client ${peerId} is now open. Current status in map: ${connEntry?.status}. Waiting for their join request.`);
            // Client should now send REQUEST_JOIN_ROOM. Leader waits for that.
        } else {
            // This is the client's connection to the leader
            if (peerId === state.networkRoomData.leaderPeerId && leaderConnection && leaderConnection.open) {
                console.log(`[PeerConn] Client: Connection to leader ${peerId} is now open. Sending join request.`);

                // Ensure myPlayerData is correctly fetched using the current local customization
                // This should get the name/icon/color from the UI setup fields.
                const myPlayerDataForJoin = state.getLocalPlayerCustomizationForNetwork(); // Use updated state method

                if (myPlayerDataForJoin) {
                    sendDataToLeader({
                        type: MSG_TYPE.REQUEST_JOIN_ROOM,
                        playerData: myPlayerDataForJoin
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
            if (connEntry) {
                connections.delete(peerId);
                // Find player by peerId, not by the potentially stale player object in connEntry
                const leavingPlayer = state.networkRoomData.players.find(p => p.peerId === peerId);
                if (leavingPlayer) {
                    const leavingPlayerName = leavingPlayer.name; // Store before removal
                    state.removePlayerFromNetworkRoom(peerId);
                    broadcastToRoom({ type: MSG_TYPE.PLAYER_LEFT, playerId: leavingPlayer.id, peerId: peerId, playerName: leavingPlayerName });
                    reassignPlayerIdsAndBroadcastUpdate(); // Important to keep player IDs sequential
                    ui.updateLobbyUI();
                    matchmaking.updateHostedRoomStatus(state.networkRoomData.roomId, state.networkRoomData.gameSettings, state.networkRoomData.maxPlayers, state.networkRoomData.players.length);


                    if (state.networkRoomData.roomState === 'in_game' && state.networkRoomData.players.length < state.MIN_PLAYERS_NETWORK) {
                        ui.showModalMessage(`Jugador ${leavingPlayerName} se desconectó. No hay suficientes jugadores para continuar.`);
                        gameLogic.endGameAbruptly();
                        state.setNetworkRoomData({ roomState: 'game_over_by_disconnect' });
                         broadcastToRoom({ type: MSG_TYPE.GAME_OVER_ANNOUNCEMENT, reason: 'disconnect', winners: [], scores: state.playersData.map(p => ({id:p.id, name:p.name, score:p.score}))});
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

        const targetPeerForMsg = peerIdContext || state.networkRoomData.leaderPeerId || (err.peer ? err.peer : null) || (err.message?.match(/peer\s(.+)/)?.[1]);

        if (err.type) {
            if (err.type === 'peer-unavailable' || err.type === 'unavailable-id') {
                displayMessage = `No se pudo conectar al jugador: ${targetPeerForMsg ? state.CAJITAS_PEER_ID_PREFIX + targetPeerForMsg : 'remoto'}. Verificá el ID/disponibilidad.`;
            } else if (err.type === 'network') {
                displayMessage = "Error de red. Verificá tu conexión a internet.";
            } else if (err.type === 'webrtc') {
                displayMessage = "Error de WebRTC. Puede ser un problema de firewall o red.";
            } else if (err.type === 'disconnected') { // Disconnected from PeerJSBroker
                 displayMessage = "Desconectado del servidor PeerJS. Intentando reconectar...";
                 // Attempt to reconnect the Peer object
                 if (window.peerJsMultiplayer?.getPeer() && !window.peerJsMultiplayer.getPeer().destroyed) {
                    window.peerJsMultiplayer.getPeer().reconnect();
                 } else {
                    // If peer is destroyed or doesn't exist, might need full re-init
                    // This can be complex depending on current game state.
                    // For now, we just inform.
                 }
            } else if (err.type === 'server-error') { // Error from PeerJSBroker
                 displayMessage = "Error del servidor PeerJS. Intenta más tarde.";
            } else if (err.type === 'socket-error' && err.message === 'Trying to send command before socket is open.') {
                displayMessage = "Error de conexión inicial con el servidor. Reintentando...";
            }
            else {
                displayMessage = `${err.type}: ${displayMessage}`;
            }
        }

        if (state.networkRoomData?._peerInitReject) {
            console.log("[PeerConn] onError: Rejecting _peerInitReject due to PeerJS error during init.");
            state.networkRoomData._peerInitReject(err);
        } else if (state.networkRoomData?._setupErrorCallback) {
            console.log("[PeerConn] onError: Calling _setupErrorCallback due to PeerJS error during host setup.");
            state.networkRoomData._setupErrorCallback(err);
        } else {
            ui.showModalMessage(`Error de conexión: ${displayMessage}`);
        }
        ui.updateMessageArea("Error de conexión.", true);


        // If a client fails to connect during lobby setup, reset them.
        if (!state.networkRoomData.isRoomLeader &&
            (state.networkRoomData.roomState === 'connecting_to_lobby' ||
             state.networkRoomData.roomState === 'awaiting_join_approval' ||
             !leaderConnection || (leaderConnection && !leaderConnection.open))) {
            console.warn("[PeerConn] onError: Client connection failed during setup phases. Resetting state.");
            state.resetNetworkRoomData();
            state.setPvpRemoteActive(false);
            ui.showSetupScreen();
            ui.hideNetworkInfo();
        }
         // Clean up promise handlers after potential use
        delete state.networkRoomData._setupCompleteCallback;
        delete state.networkRoomData._setupErrorCallback;
        delete state.networkRoomData._peerInitResolve;
        delete state.networkRoomData._peerInitReject;
    }
};

function reassignPlayerIdsAndBroadcastUpdate() {
    if (!state.networkRoomData.isRoomLeader) return;

    // Filter out any disconnected players if they weren't caught by onConnectionClose for some reason
    // (though ideally they are)
    const currentPlayers = state.networkRoomData.players.filter(p => {
        if (p.peerId === state.myPeerId) return true; // Leader is always "connected"
        return connections.has(p.peerId) && (connections.get(p.peerId).connObject?.open || connections.get(p.peerId).open);
    });


    // Sort players: leader first, then by original join order (approximated by current ID if stable)
    currentPlayers.sort((a, b) => {
        if (a.peerId === state.myPeerId) return -1; // Leader always first (id 0)
        if (b.peerId === state.myPeerId) return 1;
        return (a.id || Infinity) - (b.id || Infinity); // Sort by existing ID to maintain order
    });

    let idChangedOrPlayerRemoved = false;
    if (currentPlayers.length !== state.networkRoomData.players.length) {
        idChangedOrPlayerRemoved = true;
    }

    // Re-assign sequential IDs
    currentPlayers.forEach((player, index) => {
        if (player.id !== index) {
            idChangedOrPlayerRemoved = true;
        }
        player.id = index; // This is their new playerIndex for the game
        if (player.peerId === state.myPeerId) {
            state.setNetworkRoomData({ myPlayerIdInRoom: index }); // Should always be 0 for leader
        }
    });
    state.setNetworkRoomData({ players: currentPlayers }); // Update the master list

    if (idChangedOrPlayerRemoved) {
       console.log("[PeerConn] Player IDs reassigned or player removed. Broadcasting new room state.");
       broadcastRoomState(); // Send the updated list to all clients
    }
}

function handleLeaderDataReception(data, fromPeerId) {
    const connEntryWrapper = connections.get(fromPeerId);
    const connToUse = connEntryWrapper?.connObject; // Ensure we're using the actual PeerJS connection object

    if (!connToUse && data.type !== MSG_TYPE.REQUEST_JOIN_ROOM) {
        console.warn(`[PeerConn L] Data from ${fromPeerId} but no active connection object found or not open. Type: ${data.type}. Ignored. Conn Entry:`, connEntryWrapper);
        return;
    }

    switch (data.type) {
        case MSG_TYPE.REQUEST_JOIN_ROOM:
            // The connection object (connToUse) should be the one from peer.on('connection')
            // It might not be fully "open" in the peerJsMultiplayer sense yet, but it's the channel.
            const newClientConn = window.peerJsMultiplayer.getConnection(fromPeerId); // Get the actual conn obj
             if (!newClientConn && !connToUse) { // connToUse might be set if onNewConnection already fired
                console.warn(`[PeerConn L] REQUEST_JOIN_ROOM from ${fromPeerId} but no connection object found via peerJsMultiplayer.getConnection or map. Ignoring.`);
                // Optionally send a rejection if a way to communicate exists (e.g., if connToUse was defined but not open)
                if(connToUse && typeof connToUse.send === 'function') {
                    connToUse.send({ type: MSG_TYPE.JOIN_REJECTED, reason: 'internal_server_error_no_conn_obj' });
                }
                return;
            }
            const actualConnObjectForJoin = newClientConn || connToUse;


            if (state.networkRoomData.players.length >= state.networkRoomData.maxPlayers) {
                actualConnObjectForJoin.send({ type: MSG_TYPE.JOIN_REJECTED, reason: 'room_full' });
                // Update status in connections map if it exists
                if(connEntryWrapper) connections.set(fromPeerId, { ...connEntryWrapper, status: 'rejected' });
                else connections.set(fromPeerId, { connObject: actualConnObjectForJoin, status: 'rejected', player: null });
                return;
            }

            const takenColors = state.networkRoomData.players.map(p => p.color);
            let requestedColor = data.playerData.color;
            let assignedColor = requestedColor;
            let colorWasChanged = false;

            if (takenColors.includes(requestedColor)) {
                assignedColor = ui.getNextAvailableColor(takenColors);
                colorWasChanged = true;
                console.log(`[PeerConn L] Player ${data.playerData.name} requested color ${requestedColor} but it's taken. Assigning ${assignedColor} instead.`);
            }

            const newPlayerId = state.networkRoomData.players.length; // Next available ID

            const newPlayer = {
                id: newPlayerId, // This is the playerIndex in the game
                peerId: fromPeerId,
                name: data.playerData.name,
                icon: data.playerData.icon,
                color: assignedColor,
                isReady: false,
                isConnected: true, // Connection is active
                score: 0
            };
            state.addPlayerToNetworkRoom(newPlayer); // Adds to state.networkRoomData.players

            // Update the connections map with the player info and ensure status is active
            connections.set(fromPeerId, { connObject: actualConnObjectForJoin, player: newPlayer, status: 'active' });


            sendDataToClient(fromPeerId, {
                type: MSG_TYPE.JOIN_ACCEPTED,
                yourPlayerId: newPlayerId, // Their assigned ID in the room
                roomData: state.getSanitizedNetworkRoomDataForClient(), // Send current room state
                yourAssignedColor: assignedColor,
                colorChanged: colorWasChanged
            });

            // Broadcast to OTHERS that a new player joined
            broadcastToRoom({ type: MSG_TYPE.PLAYER_JOINED, player: newPlayer }, fromPeerId);

            ui.updateLobbyUI();
            matchmaking.updateHostedRoomStatus(state.networkRoomData.roomId, state.networkRoomData.gameSettings, state.networkRoomData.maxPlayers, state.networkRoomData.players.length);
            break;

        case MSG_TYPE.PLAYER_READY_CHANGED:
             if (!connections.has(fromPeerId) || !connections.get(fromPeerId)?.player) {
                console.warn(`[PeerConn L] PLAYER_READY_CHANGED from peer ${fromPeerId} not in active connections map or no player data. Ignored.`);
                return;
            }
            const playerToUpdate = state.networkRoomData.players.find(p => p.peerId === fromPeerId);
            if (playerToUpdate) {
                playerToUpdate.isReady = data.isReady;
                state.setNetworkRoomData({players: [...state.networkRoomData.players]});
                broadcastToRoom({
                    type: MSG_TYPE.PLAYER_READY_CHANGED,
                    playerId: playerToUpdate.id, // Use the player's game ID
                    peerId: fromPeerId,
                    isReady: data.isReady
                });
                ui.updateLobbyUI();
            }
            break;

        case MSG_TYPE.GAME_MOVE:
            if (!connections.has(fromPeerId) || !connections.get(fromPeerId)?.player) {
                console.warn(`[PeerConn L] GAME_MOVE from peer ${fromPeerId} not in active connections map or no player data. Ignored.`);
                return;
            }
            if (state.networkRoomData.roomState !== 'in_game' || !state.gameActive) {
                console.warn("[PeerConn L] Game move received but game not active. Ignored.");
                return;
            }
            const movingPlayer = state.networkRoomData.players.find(p => p.peerId === fromPeerId);
            if (movingPlayer && movingPlayer.id === state.currentPlayerIndex) { // movingPlayer.id is their playerIndex
                if(typeof state.incrementTurnCounter === 'function') {
                     state.incrementTurnCounter();
                } else {
                    console.error("state.incrementTurnCounter is not a function in handleLeaderDataReception");
                }

                const boxesBefore = state.filledBoxesCount;
                // processMove uses playerIndex (which is movingPlayer.id here)
                gameLogic.processMove(data.move.type, data.move.r, data.move.c, movingPlayer.id, false, true);
                const boxesCompletedThisTurn = state.filledBoxesCount - boxesBefore;

                broadcastToRoom({
                    type: MSG_TYPE.GAME_MOVE,
                    move: { ...data.move, playerIndex: movingPlayer.id, boxesJustCompleted: boxesCompletedThisTurn },
                    turnCounter: state.networkRoomData.turnCounter,
                    nextPlayerIndex: state.currentPlayerIndex, // This is the crucial state.currentPlayerIndex after processMove
                    updatedScores: state.playersData.map(p => ({id: p.id, score: p.score})),
                });

                // Update leader's own board clickability
                const isStillLeaderTurn = state.currentPlayerIndex === state.networkRoomData.myPlayerIdInRoom;
                ui.setBoardClickable(isStillLeaderTurn && state.gameActive);

                if (!state.gameActive && state.networkRoomData.roomState !== 'game_over') {
                    state.setNetworkRoomData({ roomState: 'game_over' });
                    broadcastToRoom({
                        type: MSG_TYPE.GAME_OVER_ANNOUNCEMENT,
                        winnersData: gameLogic.getWinnerData(), // Send full winner data object
                        scores: state.playersData.map(p => ({id: p.id, name: p.name, score: p.score}))
                    });
                }
            } else {
                console.warn(`[PeerConn L] Move from ${fromPeerId} (P${movingPlayer?.id}) but it's P${state.currentPlayerIndex}'s turn. Ignored.`);
            }
            break;
        // Add other leader-specific message handlers if any
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
            // My *customization* data was sent to leader. Leader assigns ID and final color.
            // data.roomData contains the full list of players already in the room (including me with my new ID).
            const myAssignedData = data.roomData.players.find(p => p.id === data.yourPlayerId);

            if (!myAssignedData) {
                console.error("[PeerConn C] JOIN_ACCEPTED but my player data not found in received roomData. My assigned ID:", data.yourPlayerId);
                ui.showModalMessage("Error al unirse: no se encontraron tus datos en la sala.");
                leaveRoom();
                return;
            }

            // Update my local player representation with the assigned color and ID
             const localPlayerCustomization = state.getLocalPlayerCustomizationForNetwork(); // My current name/icon from UI
             myAssignedData.name = localPlayerCustomization.name; // Keep my latest name
             myAssignedData.icon = localPlayerCustomization.icon; // Keep my latest icon
             myAssignedData.color = data.yourAssignedColor;    // Use color assigned by leader
             myAssignedData.peerId = state.myPeerId; // Ensure my peerId is correct

            // Update the entire players list in networkRoomData
            state.setNetworkRoomData({
                myPlayerIdInRoom: data.yourPlayerId,
                gameSettings: data.roomData.gameSettings,
                maxPlayers: data.roomData.maxPlayers,
                roomState: 'lobby', // Successfully joined the lobby
                leaderPeerId: data.roomData.leaderPeerId || state.networkRoomData.leaderPeerId,
                roomId: data.roomData.roomId || state.networkRoomData.roomId,
                players: data.roomData.players // This list includes me with my new ID and assigned color
            });


            if (data.colorChanged) {
                console.log(`[PeerConn C] Server assigned different color: ${data.yourAssignedColor}. I requested a color, but leader had final say.`);
                const colorInput = document.getElementById('player-color-0');
                if (colorInput) {
                    colorInput.value = data.yourAssignedColor;
                    colorInput.dispatchEvent(new Event('input', { bubbles: true }));
                }
                 ui.updateLobbyMessage(`¡Te uniste a la sala! Tu color fue cambiado a ${data.yourAssignedColor} porque el original ya estaba en uso.`);
            } else {
                ui.updateLobbyMessage("¡Te uniste a la sala! Marcate como listo cuando quieras.");
            }

            ui.showLobbyScreen();
            ui.updateLobbyUI();
            ui.updateGameModeUI();
            console.log(`[PeerConn C] Joined room! My Player ID in room: ${data.yourPlayerId}. My Color: ${data.yourAssignedColor}. Full Room Data:`, JSON.parse(JSON.stringify(state.networkRoomData)));
            break;

        case MSG_TYPE.JOIN_REJECTED:
            ui.showModalMessage(`No se pudo unir a la sala: ${data.reason || 'Rechazado por el líder.'}`);
            leaveRoom(); // This also calls closePeerSession if needed
            break;

        case MSG_TYPE.PLAYER_JOINED: // Another player joined the room
            if (data.player.peerId !== state.myPeerId) { // If it's not me
                 const existingPlayer = state.networkRoomData.players.find(p => p.peerId === data.player.peerId);
                 if (!existingPlayer) {
                    state.addPlayerToNetworkRoom(data.player); // Add new player to local list
                 } else { // Player reconnected or data updated
                    Object.assign(existingPlayer, data.player);
                    state.setNetworkRoomData({ players: [...state.networkRoomData.players] });
                 }
                 ui.updateLobbyMessage(`${data.player.name} se ha unido a la sala.`);
            }
            ui.updateLobbyUI();
            break;

        case MSG_TYPE.PLAYER_LEFT:
            const leftPlayer = state.networkRoomData.players.find(p => p.id === data.playerId && p.peerId === data.peerId);
            if (leftPlayer) {
                state.removePlayerFromNetworkRoom(data.peerId);
                ui.updateLobbyMessage(`${data.playerName || 'Un jugador'} ha salido de la sala.`);
            } else {
                // If player wasn't found by ID but peerId matches, still remove
                state.removePlayerFromNetworkRoom(data.peerId);
                 ui.updateLobbyMessage(`${data.playerName || 'Un jugador'} (ID ${data.peerId.slice(-4)}) ha salido.`);
            }
            // Leader will send a ROOM_STATE_UPDATE if IDs need re-shuffling
            // For client, just update UI based on current data.
            ui.updateLobbyUI();
            break;

        case MSG_TYPE.ROOM_STATE_UPDATE: // Full room state update from leader (e.g., after a player leaves)
            // Ensure myPlayerIdInRoom is correctly updated based on my peerId in the new list
            const myNewDataInRoom = data.roomData.players.find(p => p.peerId === state.myPeerId);
            const myNewPlayerId = myNewDataInRoom ? myNewDataInRoom.id : state.networkRoomData.myPlayerIdInRoom;

            state.setNetworkRoomData({
                players: data.roomData.players,
                gameSettings: data.roomData.gameSettings,
                maxPlayers: data.roomData.maxPlayers,
                myPlayerIdInRoom: myNewPlayerId, // Update my ID based on new list
                leaderPeerId: data.roomData.leaderPeerId || state.networkRoomData.leaderPeerId,
                roomId: data.roomData.roomId || state.networkRoomData.roomId,
                // roomState can also be part of this if leader sends it.
            });
            ui.updateLobbyUI();
            break;

        case MSG_TYPE.PLAYER_READY_CHANGED:
            const changedPlayer = state.networkRoomData.players.find(p => p.id === data.playerId);
            if (changedPlayer) {
                changedPlayer.isReady = data.isReady;
                ui.updateLobbyUI(); // Update display of who is ready
            }
            break;

        case MSG_TYPE.GAME_STARTED:
            console.log("[PeerConn C] Client received GAME_STARTED:", data.initialGameState);
            ui.hideNetworkInfo();
            state.setNetworkRoomData({ roomState: 'in_game' }); // Update room state

            // playersInGameOrder is the definitive list for the game
            state.setPlayersData(data.initialGameState.playersInGameOrder);
            state.setGameDimensions(data.initialGameState.gameSettings.rows, data.initialGameState.gameSettings.cols);
            state.setCurrentPlayerIndex(data.initialGameState.startingPlayerIndex);
            state.networkRoomData.turnCounter = data.initialGameState.turnCounter; // Sync initial turn counter

            gameLogic.initializeGame(true); // true for remote game
            ui.showGameScreen();
            ui.updateMessageArea("¡El juego ha comenzado!", false, 5000);
            break;

        case MSG_TYPE.GAME_MOVE:
            console.log("[PeerConn C] Client received GAME_MOVE:", data);
            // Basic de-duplication/ordering check
            if (data.turnCounter < state.networkRoomData.turnCounter && state.networkRoomData.turnCounter !== 0 && data.move.playerIndex !== state.networkRoomData.myPlayerIdInRoom) {
                console.warn(`[PeerConn C] Stale/duplicate game_move. RX TC: ${data.turnCounter}, My TC: ${state.networkRoomData.turnCounter}. Move by P${data.move.playerIndex}. Ignored.`);
                return;
            }
            state.networkRoomData.turnCounter = data.turnCounter; // Update to leader's turn counter
            gameLogic.applyRemoteMove(data.move, data.nextPlayerIndex, data.updatedScores);
            break;

        case MSG_TYPE.FULL_GAME_STATE: // For re-sync
             if (data.gameState.turnCounter < state.networkRoomData.turnCounter && state.networkRoomData.turnCounter !== 0 && data.gameState.turnCounter !== 0) {
                console.warn(`[PeerConn C] Stale full_game_state. RX TC: ${data.gameState.turnCounter}, My TC: ${state.networkRoomData.turnCounter}. Ignored.`);
                return;
            }
            console.log("[PeerConn C] Applying full game state from leader.");
            gameLogic.applyFullState(data.gameState); // This function should handle setting all relevant game state
            state.networkRoomData.turnCounter = data.gameState.turnCounter; // Sync turn counter
            state.setNetworkRoomData({ roomState: data.gameState.gameActive ? 'in_game' : 'game_over' });
            if(state.networkRoomData.roomState === 'in_game') ui.showGameScreen();
            // else if (state.networkRoomData.roomState === 'game_over') ui.showLobbyScreen(); // Or a game over screen
            break;

        case MSG_TYPE.GAME_OVER_ANNOUNCEMENT:
            console.log("[PeerConn C] Client received GAME_OVER_ANNOUNCEMENT:", data);
            state.setNetworkRoomData({ roomState: 'game_over' });
            state.setGameActive(false);
            const winnerNames = data.winnersData.winners.map(w => w.name).join(' y ');
            let message = data.reason === 'disconnect' ? "Juego terminado por desconexión." : `¡Juego Terminado! Ganador(es): ${winnerNames || 'Nadie'}.`;
            if (data.winnersData.isTie && winnerNames) {
                message = `¡Juego Terminado! Empate entre ${winnerNames}.`;
            } else if (data.winnersData.winners.length === 0 && !data.reason) {
                 message = `¡Juego Terminado! ${data.winnersData.isTie ? "Empate general." : "No hubo ganadores claros."}`;
            }

            ui.showModalMessage(message);
            ui.updateScoresDisplay(); // Ensure final scores are shown
            ui.setBoardClickable(false);
            // Consider navigating to lobby or a post-game screen
            // ui.showLobbyScreen(); // Or a specific game over screen
            break;
    }
}

// Returns a promise that resolves with the peer ID when 'open' event fires,
// or rejects on 'error'.
function initPeerObject(peerIdToUse = null, options = {}) {
    return new Promise((resolve, reject) => {
        if (window.peerJsMultiplayer && typeof window.peerJsMultiplayer.init === 'function') {
            // Store promise resolvers in a temporary place accessible by the global callbacks
            // This is a bit of a workaround for the global callback structure of peerJsMultiplayer
            state.setNetworkRoomData({
                _peerInitResolve: resolve,
                _peerInitReject: reject
            });

            console.log(`[PeerConn] initPeerObject: Calling peerJsMultiplayer.init. Preferred ID: ${peerIdToUse}`);
            window.peerJsMultiplayer.init(peerIdToUse || options, peerJsCallbacks); // Pass all global callbacks
        } else {
            console.error("[PeerConn] initPeerObject: peerJsMultiplayer.init not found.");
            reject(new Error('Módulo multijugador no disponible.'));
        }
    });
}


export async function ensurePeerInitialized(callbacks = {}) {
    const onSuccessThisCall = callbacks.onPeerOpen || null;
    const onErrorThisCall = callbacks.onError || null;

    const existingPeer = window.peerJsMultiplayer?.getPeer();
    const currentPeerId = window.peerJsMultiplayer?.getLocalId();

    if (existingPeer && !existingPeer.destroyed && currentPeerId) {
        console.log("[PeerConn] ensurePeerInitialized: PeerJS already initialized and open. My ID:", currentPeerId);
        if (onSuccessThisCall) onSuccessThisCall(currentPeerId);
        return currentPeerId; // Return Promise<string> for consistency
    }

    if (existingPeer && !existingPeer.destroyed && !currentPeerId) {
        console.warn("[PeerConn] ensurePeerInitialized: Peer object exists but ID is null (still connecting). Waiting for open.");
        // This scenario relies on the global onPeerOpen to eventually fire.
        // We can return a new promise that wraps this.
        return new Promise((resolve, reject) => {
            const tempOnOpen = (id) => {
                if (onSuccessThisCall) onSuccessThisCall(id);
                resolve(id);
                existingPeer.off('open', tempOnOpen);
                existingPeer.off('error', tempOnError);
            };
            const tempOnError = (err) => {
                if (onErrorThisCall) onErrorThisCall(err);
                reject(err);
                existingPeer.off('open', tempOnOpen);
                existingPeer.off('error', tempOnError);
            };
            existingPeer.on('open', tempOnOpen);
            existingPeer.on('error', tempOnError);
        });
    }

    console.log("[PeerConn] ensurePeerInitialized: Initializing new PeerJS instance.");
    try {
        const newPeerId = await initPeerObject(); // Uses the promise-based init
        console.log("[PeerConn] ensurePeerInitialized: New PeerJS instance initialized. ID:", newPeerId);
        if (onSuccessThisCall) onSuccessThisCall(newPeerId);
        return newPeerId;
    } catch (err) {
        console.error("[PeerConn] ensurePeerInitialized: Error initializing new PeerJS instance.", err);
        if (onErrorThisCall) onErrorThisCall(err);
        throw err; // Re-throw to be caught by caller
    }
}


export function hostNewRoom(hostPlayerData, gameSettings, isRandomMatchHost = false) {
    console.log("[PeerConn] hostNewRoom called.");
    state.resetNetworkRoomData();
    state.setPvpRemoteActive(true);

    return new Promise(async (resolve, reject) => { // Make outer function async
        // Store the main promise resolvers
        state.setNetworkRoomData({
            isRoomLeader: true,
            myPlayerIdInRoom: 0, // Leader is always player 0
            gameSettings: { rows: gameSettings.rows, cols: gameSettings.cols },
            maxPlayers: gameSettings.maxPlayers,
            // Initialize leader's data. PeerID will be set once PeerJS opens.
            players: [{
                id: 0, // Leader is player ID 0
                peerId: null, // Will be set by onPeerOpen
                name: hostPlayerData.name,
                icon: hostPlayerData.icon,
                color: hostPlayerData.color,
                isReady: false, // Leader doesn't need to "ready up" in the same way
                isConnected: true, // Leader is connected by definition
                score: 0
            }],
            roomState: isRandomMatchHost ? 'creating_random_match_room' : 'waiting_for_players',
            gamePaired: false, // Not used extensively, roomState is better
            _setupCompleteCallback: resolve, // For onPeerOpen to call
            _setupErrorCallback: reject      // For onPeerOpen or init error to call
        });

        ui.showModalMessage("Creando sala de juego...");

        try {
            // Ensure PeerJS is initialized. The actual peer ID is set in onPeerOpen.
            // The 'resolve' and 'reject' from this outer Promise are passed via
            // _setupCompleteCallback and _setupErrorCallback for onPeerOpen to use.
            await ensurePeerInitialized(); // This will trigger onPeerOpen
            // The promise from hostNewRoom will be resolved/rejected inside onPeerOpen
            // via the _setupCompleteCallback or _setupErrorCallback.
        } catch (err) {
            console.error("[PeerConn] Error during ensurePeerInitialized in hostNewRoom:", err);
            ui.hideModalMessage();
            state.resetNetworkRoomData();
            state.setPvpRemoteActive(false);
            ui.showSetupScreen();
            reject(err); // Reject the main hostNewRoom promise
             // Clean up promise handlers
            delete state.networkRoomData._setupCompleteCallback;
            delete state.networkRoomData._setupErrorCallback;
        }
    });
}

export async function joinRoomById(leaderPeerIdToJoin, joinerPlayerData) { // Make async
    console.log(`[PeerConn] joinRoomById called for leader: ${leaderPeerIdToJoin}`);
    state.resetNetworkRoomData();
    state.setPvpRemoteActive(true);

    // Temporarily set local player data. It will be confirmed/updated by leader.
    state.setNetworkRoomData({
        roomId: leaderPeerIdToJoin, // This is the leader's PeerJS ID (raw, without prefix)
        leaderPeerId: leaderPeerIdToJoin,
        isRoomLeader: false,
        players: [{ // Placeholder for self, peerId will be set by ensurePeerInitialized
            peerId: null, // Will be set once our PeerJS opens
            name: joinerPlayerData.name,
            icon: joinerPlayerData.icon,
            color: joinerPlayerData.color,
            // id, isReady, isConnected will be set by leader
        }],
        roomState: 'connecting_to_lobby'
    });
    ui.showModalMessage(`Intentando conectar a la sala ${state.CAJITAS_PEER_ID_PREFIX}${leaderPeerIdToJoin}...`);

    try {
        // Initialize PeerJS for the client. This needs to complete *before* attempting to connect.
        const myPeerId = await ensurePeerInitialized(); // This will set state.myPeerId via onPeerOpen
        console.log(`[PeerConn] joinRoomById: My PeerJS initialized, ID: ${myPeerId}. Now connecting to leader.`);

        // At this point, onPeerOpen should have fired and state.myPeerId is set.
        // The global onPeerOpen callback will handle the actual connection attempt.
        // The logic in onPeerOpen for a non-leader with a leaderPeerId will try to connect.

    } catch (err) {
        console.error(`[PeerConn] Error during ensurePeerInitialized in joinRoomById for leader ${leaderPeerIdToJoin}:`, err);
        ui.hideModalMessage();
        peerJsCallbacks.onError(err, leaderPeerIdToJoin); // Use global error handler
        state.resetNetworkRoomData();
        state.setPvpRemoteActive(false);
        ui.showSetupScreen();
    }
}


export function leaveRoom() {
    console.log("[PeerConn] Leaving room...");
    ui.hideNetworkInfo();
    const currentRoomId = state.networkRoomData.roomId; // Get room ID before reset

    if (state.networkRoomData.isRoomLeader) {
        console.log("[PeerConn] Leader is leaving. Informing clients and closing connections.");
        broadcastToRoom({ type: 'error', message: 'El líder ha cerrado la sala.' });
         // Also unlist from matchmaking if this room was listed
        if (currentRoomId && window.peerJsMultiplayer?.getLocalId() === currentRoomId) { // Ensure it's the leader's own ID
            matchmaking.leaveQueue(currentRoomId); // Pass the raw peer ID
        }

        setTimeout(() => {
            connections.forEach((connEntry, peerId) => {
                const connToClose = connEntry.connObject || connEntry; // Handle both structures
                if (connToClose && typeof connToClose.close === 'function') {
                    try { connToClose.close(); } catch (e) { console.warn(`Error closing client conn ${peerId}:`, e); }
                }
            });
            connections.clear();
            // closePeerSession(); // Now handled by stopAnyActiveGameOrNetworkSession
        }, 200); // Short delay for messages to go out
    } else if (leaderConnection) {
        console.log("[PeerConn] Client is leaving. Closing connection to leader.");
        if (leaderConnection.open) {
          try { leaderConnection.close(); } catch (e) { console.warn("Error closing leader conn:", e); }
        }
    }
    leaderConnection = null; // Clear leader connection for client

    // state.resetNetworkRoomData(); // main.js/stopAnyActiveGameOrNetworkSession will handle this
    // state.setPvpRemoteActive(false);
    // state.setGameActive(false);
    // closePeerSession(); // Deferred to stopAnyActiveGameOrNetworkSession for robustness
}


export function handleLeaderLocalMove(moveDetails, boxesCompletedCount) {
    if (!state.networkRoomData.isRoomLeader) {
         console.warn("[PeerConn] handleLeaderLocalMove called, but not leader. Ignoring.");
         return;
    }
    // Ensure myPlayerIdInRoom is correctly set for the leader (should be 0)
    const leaderPlayerId = state.networkRoomData.myPlayerIdInRoom;
    if (leaderPlayerId === null || leaderPlayerId === undefined) {
        console.error("[PeerConn] Leader's myPlayerIdInRoom is not set. Aborting move broadcast.");
        return;
    }

    console.log(`[PeerConn] handleLeaderLocalMove: Leader (P${leaderPlayerId}) made move. Broadcasting. GameActive: ${state.gameActive}, RoomState: ${state.networkRoomData.roomState}`);

    if(typeof state.incrementTurnCounter === 'function') {
        state.incrementTurnCounter();
    } else {
        console.error("[PeerConn] FATAL: state.incrementTurnCounter is not a function during leader's local move!");
        return;
    }

    const gameMoveMessage = {
        type: MSG_TYPE.GAME_MOVE,
        move: {
            ...moveDetails,
            playerIndex: leaderPlayerId, // This is the crucial playerIndex
            boxesJustCompleted: boxesCompletedCount
        },
        turnCounter: state.networkRoomData.turnCounter,
        nextPlayerIndex: state.currentPlayerIndex, // This is state.currentPlayerIndex after gameLogic.processMove
        updatedScores: state.playersData.map(p => ({id: p.id, score: p.score})),
    };

    console.log("[PeerConn] Broadcasting leader's local move:", gameMoveMessage);
    broadcastToRoom(gameMoveMessage);

    if (!state.gameActive && state.networkRoomData.roomState !== 'game_over') {
        console.log("[PeerConn] Game ended with leader's move. Broadcasting GAME_OVER_ANNOUNCEMENT.");
        state.setNetworkRoomData({ roomState: 'game_over' });
        broadcastToRoom({
            type: MSG_TYPE.GAME_OVER_ANNOUNCEMENT,
            winnersData: gameLogic.getWinnerData(),
            scores: state.playersData.map(p => ({id: p.id, name: p.name, score: p.score}))
        });
    } else if (state.gameActive) {
        console.log(`[PeerConn] Leader's move processed. Next player is P${state.currentPlayerIndex}.`);
    }
}

function sendDataToLeader(data) {
    if (leaderConnection && leaderConnection.open) {
        console.log(`[PeerConn C] TX to Leader: Type: ${data.type}`, data);
        try {
            leaderConnection.send(data);
        } catch (e) {
            console.error("[PeerConn C] Error sending data to leader:", e, data);
            peerJsCallbacks.onError({type: 'send_error', message: 'Failed to send data to leader.', originalError: e});
        }
    } else {
        console.warn("[PeerConn C] No open connection to leader. Cannot send data.", data, "Leader Conn State:", leaderConnection);
         peerJsCallbacks.onError({type: 'send_error_no_connection', message: 'No open connection to leader to send data.'});
    }
}

function sendDataToClient(clientPeerId, data) {
    const connEntry = connections.get(clientPeerId);
    // Ensure we use the actual PeerJS connection object from the map
    const conn = connEntry?.connObject;
    if (conn && conn.open) {
        console.log(`[PeerConn L] TX to Client ${clientPeerId}: Type: ${data.type}`, data);
        try {
            conn.send(data);
        } catch (e) {
            console.error(`[PeerConn L] Error sending data to client ${clientPeerId}:`, e, data);
        }
    } else {
        console.warn(`[PeerConn L] No open connection to client ${clientPeerId}. Cannot send data. Conn entry:`, connEntry, "Conn object:", conn);
    }
}

function broadcastToRoom(data, excludePeerId = null) {
    if (!state.networkRoomData.isRoomLeader) return;
    console.log(`[PeerConn L] Broadcast TX: Type: ${data.type} (excluding ${excludePeerId || 'none'})`, data);
    connections.forEach((connEntry, peerId) => {
        const conn = connEntry?.connObject; // Use the actual PeerJS connection object
        if (peerId !== excludePeerId && conn && conn.open) {
            try {
                conn.send(data);
            } catch (e) {
                console.error(`[PeerConn L] Error broadcasting to ${peerId}:`, e);
            }
        }
    });
}

function broadcastRoomState() {
    if (!state.networkRoomData.isRoomLeader) return;
    console.log("[PeerConn L] Broadcasting full room state update.");
    broadcastToRoom({
        type: MSG_TYPE.ROOM_STATE_UPDATE,
        roomData: state.getSanitizedNetworkRoomDataForClient()
    });
}
export function sendPlayerReadyState(isReady) {
    if (state.networkRoomData.isRoomLeader) {
        // Leader's "ready" state is implicit or handled differently (e.g., start button)
        // However, if leader also has a ready toggle for consistency in UI:
        const leaderData = state.networkRoomData.players.find(p => p.peerId === state.myPeerId);
        if (leaderData) {
            leaderData.isReady = isReady;
            state.setNetworkRoomData({ players: [...state.networkRoomData.players] });
            // Broadcast this change so clients can update their UI for the leader's status
            broadcastToRoom({
                type: MSG_TYPE.PLAYER_READY_CHANGED,
                playerId: leaderData.id, // Leader's player ID (usually 0)
                peerId: state.myPeerId,
                isReady: isReady
            });
            ui.updateLobbyUI(); // Update leader's own lobby UI
        }
    } else {
        // Client sends their ready state to the leader
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
    state.setNetworkRoomData({ roomState: 'in_game' }); // Critical: update state first
    state.setGameDimensions(state.networkRoomData.gameSettings.rows, state.networkRoomData.gameSettings.cols);

    // Create the playersData list for the game from networkRoomData.players
    // Ensure correct IDs (playerIndex) and other attributes.
    const playersForGame = [...state.networkRoomData.players]
        .sort((a,b) => (a.id || 0) - (b.id || 0)) // Sort by assigned ID to ensure order
        .map(p => ({
            id: p.id, // This 'id' is the playerIndex for gameLogic
            name: p.name,
            icon: p.icon,
            color: p.color,
            score: 0, // Reset scores for new game
            peerId: p.peerId // Keep peerId for reference if needed during game
        }));

    state.setPlayersData(playersForGame); // This sets the active game players
    state.setCurrentPlayerIndex(0); // Game always starts with player 0 (the leader initially)
    if(typeof state.incrementTurnCounter === 'function') state.incrementTurnCounter(); else console.error("Missing incrementTurnCounter");
    state.networkRoomData.turnCounter = 1; // Start with turn 1

    gameLogic.initializeGame(true); // true for remote game
    ui.showGameScreen();

    // Unlist from matchmaking as game is starting
    matchmaking.leaveQueue(state.networkRoomData.roomId);


    broadcastToRoom({
        type: MSG_TYPE.GAME_STARTED,
        initialGameState: {
            playersInGameOrder: playersForGame, // The actual players for gameLogic
            gameSettings: state.networkRoomData.gameSettings,
            startingPlayerIndex: state.currentPlayerIndex,
            turnCounter: state.networkRoomData.turnCounter // Send initial turn counter
        }
    });
    ui.updateMessageArea("¡Juego iniciado! Tu turno.", false, 5000);
}

export function sendGameMoveToLeader(type, r, c, boxesCompletedCount) {
    if (state.networkRoomData.isRoomLeader) {
        console.error("Leader logic error: sendGameMoveToLeader called. Leader should use handleLeaderLocalMove.");
        return;
    }
    // Client needs to send its playerIndex (myPlayerIdInRoom)
    sendDataToLeader({
        type: MSG_TYPE.GAME_MOVE,
        move: { type, r, c, playerIndex: state.networkRoomData.myPlayerIdInRoom, boxesJustCompleted: boxesCompletedCount }
    });
}

function setupConnectionEventHandlers(conn, isLeaderConn = false) {
    // Use the global callbacks defined in peerJsCallbacks object
    // These are already set up by initPeerSession in peerjs-multiplayer.js
    // to point to the handlers in THIS file (peerConnection.js).

    // The 'open' event for the connection is particularly important.
    conn.on('open', () => {
        console.log(`[PeerConn] setupConnectionEventHandlers: Connection now open with ${conn.peer}. IsLeaderConn: ${isLeaderConn}`);
        peerJsCallbacks.onConnectionOpen(conn.peer); // Trigger the global handler
    });

    conn.on('data', (data) => {
        // console.log(`[PeerConn] setupConnectionEventHandlers: Data from ${conn.peer}`, data); // Can be verbose
        peerJsCallbacks.onDataReceived(data, conn.peer);
    });

    conn.on('close', () => {
        console.log(`[PeerConn] setupConnectionEventHandlers: Connection closed with ${conn.peer}`);
        peerJsCallbacks.onConnectionClose(conn.peer);
    });

    conn.on('error', (err) => {
        console.error(`[PeerConn] setupConnectionEventHandlers: Connection error with ${conn.peer}`, err);
        peerJsCallbacks.onError(err, conn.peer); // Pass peerId for context
    });
}


export function closePeerSession() {
    if (window.peerJsMultiplayer && typeof window.peerJsMultiplayer.close === 'function') {
        console.log("[PeerConn] Fully closing PeerJS session (destroying peer).");
        window.peerJsMultiplayer.close(); // This calls peer.destroy()
    } else {
        console.warn("[PeerConn] Attempted to close peer session, but peerJsMultiplayer.close is not available.");
    }
    // Reset local tracking of connections
    leaderConnection = null;
    connections.clear();
    state.setMyPeerId(null); // Clear our own peer ID
}

// Graceful disconnect on page unload
window.addEventListener('beforeunload', () => {
    if (state.pvpRemoteActive) {
        // If leader, try to inform Supabase this room is going down
        if (state.networkRoomData.isRoomLeader && state.networkRoomData.roomId) {
            matchmaking.leaveQueue(state.networkRoomData.roomId); // Unlist the room
        }
        // leaveRoom(); // This would try to send messages, might be too late
        closePeerSession(); // More direct: just destroy the peer object
    }
});