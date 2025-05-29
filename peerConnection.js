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
        // Set state.myPeerId here, as this is the actual peer ID obtained from PeerServer.
        // The local onPeerOpen in ensurePeerInitialized might also call state.setMyPeerId, which is fine, it will be the same ID.
        state.setMyPeerId(id); 

        const isJoiningViaUrlOnInit = window.cajitasJoinRoomOnLoad && 
                                    state.networkRoomData?.leaderPeerId === id.replace(state.CAJITAS_PEER_ID_PREFIX, '') &&
                                    !state.networkRoomData.isRoomLeader; // Ensure we are trying to join.
        
        if (!state.pvpRemoteActive && !isJoiningViaUrlOnInit) {
            console.log('[PeerConn] Global onPeerOpen: Not in active PvP mode and not a pending URL join (pvpRemoteActive is false). Likely pre-initialization. Returning.');
            if (state.networkRoomData?._setupErrorCallback) {
                console.warn('[PeerConn] Global onPeerOpen: Found _setupErrorCallback during pre-init return. This should ideally not happen if pvpRemoteActive is managed correctly.');
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
                    ui.showModalMessage("Error crítico al crear la sala: Faltan datos del anfitrión (P0G).");
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
                    // No need to change roomState here, it's already 'creating_random_match_room', matchmaking update is enough
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
                state.networkRoomData.players[0].peerId = id;
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

    // ... (onNewConnection, onConnectionOpen, onDataReceived, onConnectionClose, onError - keep from previous version - Turn 40)
    // Minor changes might be needed in onError if it handles _setupErrorCallback
    onNewConnection: (conn) => { 
        if (!state.networkRoomData.isRoomLeader) {
            console.warn(`[PeerJS] Non-leader received a connection from ${conn.peer}. Rejecting.`);
            conn.on('open', () => conn.close()); 
            return;
        }
        const activeOrPendingPlayers = Array.from(connections.values()).filter(c => c.status !== 'rejected').length + (state.networkRoomData.isRoomLeader ? 1:0); 
        if (activeOrPendingPlayers >= state.networkRoomData.maxPlayers && !connections.has(conn.peer)) { 
            console.warn(`[PeerJS] Room is full (${activeOrPendingPlayers-1} connected/pending out of ${state.networkRoomData.maxPlayers-1} slots). Rejecting new connection from ${conn.peer}.`);
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
            } else if (!connEntry && peerId !== state.myPeerId) { // If a connection opens from a peer not yet in 'connections'
                 console.warn(`[PeerConn] Leader: Connection opened with ${peerId}, but no matching pending/active entry in connections map. This might be a new client establishing DataChannel.`);
                 // onNewConnection should have added it. If not, this path might need review or onNewConnection needs to be more robust.
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
            // Keep detailed error messages from previous version
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
            console.log("[PeerConn] onError: Calling _setupErrorCallback due to PeerJS error.");
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

// ... (reassignPlayerIdsAndBroadcastUpdate, handleLeaderDataReception, handleClientDataReception, setupConnectionEventHandlers from Turn 40/AI#3 are mostly fine)
// The critical part is ensuring ensurePeerInitialized correctly uses the global callbacks or chains them.
// Let's refine ensurePeerInitialized and hostNewRoom/joinRoomById to use the global callback more directly.

function setupConnectionEventHandlers(conn, isToLeaderConnection = false) {
    conn.on('open', () => {
        // The global peerJsCallbacks.onConnectionOpen is generic.
        // Specific logic for client->leader or leader->client 'open' is better handled
        // where the connection is made or accepted, if more context is needed.
        // For now, let the global one log and handle basic state.
        peerJsCallbacks.onConnectionOpen(conn.peer); 
    });

    conn.on('data', (data) => {
        peerJsCallbacks.onDataReceived(data, conn.peer); 
    });

    conn.on('close', () => {
        peerJsCallbacks.onConnectionClose(conn.peer); 
    });

    conn.on('error', (err) => {
        peerJsCallbacks.onError(err, conn.peer); 
    });
}


export function ensurePeerInitialized(customOnSuccess, customOnError) {
    // customOnSuccess(peerId) and customOnError(error) are specific to THIS call.
    // The global peerJsCallbacks are always registered with peerjs-multiplayer.js for general peer events.

    const existingPeer = window.peerJsMultiplayer?.getPeer();
    if (existingPeer && !existingPeer.destroyed) {
        const currentPeerId = window.peerJsMultiplayer.getLocalId();
        console.log("[PeerConn] ensurePeerInitialized: PeerJS already initialized and not destroyed. My ID:", currentPeerId);
        if (currentPeerId) {
            if (customOnSuccess) customOnSuccess(currentPeerId); // Call custom success immediately
        } else {
            console.warn("[PeerConn] ensurePeerInitialized: Peer object exists but ID is null. PeerJS might be connecting. Setting up temp listeners for this call.");
            // Peer is connecting, set up temporary listeners for this specific initialization attempt
            const tempPeerOpen = (id) => {
                if (customOnSuccess) customOnSuccess(id);
                existingPeer.off('open', tempPeerOpen);
                existingPeer.off('error', tempPeerError);
            };
            const tempPeerError = (err) => {
                if (customOnError) customOnError(err);
                existingPeer.off('open', tempPeerOpen);
                existingPeer.off('error', tempPeerError);
            };
            existingPeer.on('open', tempPeerOpen);
            existingPeer.on('error', tempPeerError);
        }
        return;
    }

    // If peer doesn't exist or is destroyed, initialize a new one.
    // Pass our GLOBAL callbacks to peerjs-multiplayer.init.
    // Then, use the customOnSuccess/Error for this specific call's completion.
    if (window.peerJsMultiplayer?.init) {
        console.log("[PeerConn] ensurePeerInitialized: Initializing new PeerJS instance via peerJsMultiplayer.init().");
        
        // Create temporary wrappers for this specific call's success/error
        // that will also trigger the custom callbacks.
        const initSpecificCallbacks = {
            onPeerOpen: (id) => {
                peerJsCallbacks.onPeerOpen(id); // Call global handler first
                if (customOnSuccess) customOnSuccess(id); // Then custom success for this call
            },
            onError: (err) => {
                peerJsCallbacks.onError(err); // Call global handler first
                if (customOnError) customOnError(err); // Then custom error for this call
            }
        };
        // Merge other global callbacks so peerjs-multiplayer gets everything it needs.
        const mergedForInit = {...peerJsCallbacks, ...initSpecificCallbacks };

        window.peerJsMultiplayer.init(null, mergedForInit); 
    } else {
        console.error("[PeerConn] ensurePeerInitialized: peerJsMultiplayer.init not found.");
        if(customOnError) customOnError({ type: 'init_failed', message: 'Módulo multijugador no disponible.' });
        else peerJsCallbacks.onError({ type: 'init_failed', message: 'Módulo multijugador no disponible.' });
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

        // ensurePeerInitialized will now use the global peerJsCallbacks.onPeerOpen.
        // The global onPeerOpen is responsible for calling _setupCompleteCallback or _setupErrorCallback.
        ensurePeerInitialized(
            (hostPeerId) => { 
                console.log(`[PeerConn] hostNewRoom's ensurePeerInitialized reported PeerID: ${hostPeerId}. Global onPeerOpen should handle full setup and promise resolution.`);
                // The promise is resolved/rejected by the global onPeerOpen via _setupCompleteCallback/_setupErrorCallback
            },
            (err) => { 
                console.error("[PeerConn] Error in hostNewRoom's ensurePeerInitialized call:", err);
                ui.hideModalMessage();
                // The global onError (which might call _setupErrorCallback) should have been triggered by ensurePeerInitialized.
                // If not, or for belt-and-suspenders:
                if (state.networkRoomData?._setupErrorCallback) {
                     state.networkRoomData._setupErrorCallback(err);
                     delete state.networkRoomData._setupCompleteCallback; 
                     delete state.networkRoomData._setupErrorCallback;
                } else {
                    // Fallback if callbacks not set, use global handler.
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
        (myPeerId) => { // Custom success for this call
            console.log(`[PeerConn] joinRoomById's ensurePeerInitialized successful for PeerID: ${myPeerId}. Global onPeerOpen will handle connection attempt.`);
            if (state.networkRoomData.players && state.networkRoomData.players[0] && state.networkRoomData.players[0].peerId === null) {
                state.networkRoomData.players[0].peerId = myPeerId;
            }
            // The global onPeerOpen, when it fires for this peerId, will see pvpRemoteActive=true, isRoomLeader=false, 
            // and leaderPeerId is set, so it should attempt the connection.
        },
        (err) => { // Custom error for this call
            ui.hideModalMessage();
            peerJsCallbacks.onError(err); // Delegate to global error handler too
            state.resetNetworkRoomData();
            state.setPvpRemoteActive(false);
            ui.showSetupScreen();
        }
    );
}
// ... (The rest of the file: leaveRoom, send functions, closePeerSession, event listener, handleLeaderDataReception, handleClientDataReception etc. from Turn 40 should be largely okay, just need to ensure consistency with any small changes in peerJsCallbacks or state.)
// For brevity, I'm not repeating all of them if they were not the direct target of AI#3's suggestions or my analysis for *this* specific fix.
// The full functions from the previous complete file (Turn 40) for handleLeader/ClientDataReception etc. should be used.
// The key is the updated peerJsCallbacks.onPeerOpen and the revised ensurePeerInitialized and hostNewRoom.

// Make sure to include the rest of the functions like:
// reassignPlayerIdsAndBroadcastUpdate, handleLeaderDataReception, handleClientDataReception,
// sendDataToLeader, sendDataToClient, broadcastToRoom, broadcastRoomState,
// sendPlayerReadyState, sendStartGameRequest, sendGameMoveToLeader,
// closePeerSession, and the beforeunload listener from the previous version (Turn 40).
// I've only detailed the functions that needed significant changes based on the analysis.
// The AI's specific diffs for onNewConnection and parts of handleLeaderDataReception (Suggestion 2)
// were about connection object storage, which I tried to integrate into the version from Turn 40.

// Re-pasting the rest of the functions from Turn 40 for completeness, assuming they are largely compatible.
// It's important to merge carefully if there were subtle changes in those functions suggested by AI #3
// that were not explicitly highlighted as top-level suggestions. AI#3's specific code for `onNewConnection` and `handleLeaderDataReception` for `REQUEST_JOIN_ROOM` should be used.


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