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

// Internal helper for host finalization
function _finalizeHostSetup(hostPeerId) {
    console.log(`[PeerConn] _finalizeHostSetup called with hostPeerId: ${hostPeerId}`);
    if (!state.networkRoomData.isRoomLeader ||
        !(state.networkRoomData.roomState === 'waiting_for_players' || state.networkRoomData.roomState === 'creating_random_match_room')) {
        console.warn("[PeerConn] _finalizeHostSetup: Conditions not met for host setup (not leader or wrong room state). State:", state.networkRoomData.roomState);
        if (state.networkRoomData._setupErrorCallback) {
            state.networkRoomData._setupErrorCallback(new Error("Host setup conditions not met."));
        }
        return;
    }

    if (!state.networkRoomData.players || !state.networkRoomData.players[0]) {
        console.error('[PeerConn] _finalizeHostSetup Error: networkRoomData.players[0] not initialized for host!');
        if (state.networkRoomData._setupErrorCallback) {
            state.networkRoomData._setupErrorCallback(new Error("Host player data missing."));
        }
        return;
    }
    state.networkRoomData.players[0].peerId = hostPeerId;
    state.setNetworkRoomData({
        roomId: hostPeerId,
        leaderPeerId: hostPeerId,
        players: [...state.networkRoomData.players]
    });

    console.log(`[PeerConn] _finalizeHostSetup: Host setup complete. Room ID: ${hostPeerId}.`);
    ui.showLobbyScreen();
    ui.updateLobbyUI();
    ui.updateGameModeUI();

    const gameLink = `${CAJITAS_BASE_URL}/?room=${hostPeerId}&slots=${state.networkRoomData.maxPlayers}`;
    ui.displayQRCode(gameLink, `${state.CAJITAS_PEER_ID_PREFIX}${hostPeerId}`,
        `Compartí este enlace o ID para que ${state.networkRoomData.maxPlayers - 1} jugador(es) más se unan:`);

    if (state.networkRoomData.roomState === 'creating_random_match_room') {
        matchmaking.updateHostedRoomStatus(hostPeerId, state.networkRoomData.gameSettings, state.networkRoomData.maxPlayers, state.networkRoomData.players.length);
    }
    ui.hideModalMessage();

    if (state.networkRoomData._setupCompleteCallback) {
        console.log("[PeerConn] _finalizeHostSetup: Calling _setupCompleteCallback.");
        state.networkRoomData._setupCompleteCallback(hostPeerId);
    }
    delete state.networkRoomData._setupCompleteCallback;
    delete state.networkRoomData._setupErrorCallback;
}

// Internal helper for client join attempt
function _finalizeClientJoinAttempt(myPeerId, leaderPeerIdToJoin) {
    console.log(`[PeerConn] _finalizeClientJoinAttempt: My PeerID ${myPeerId}, connecting to ${leaderPeerIdToJoin}`);
    if (state.networkRoomData.isRoomLeader || !leaderPeerIdToJoin || !state.pvpRemoteActive) {
        console.warn("[PeerConn] _finalizeClientJoinAttempt: Conditions not met for client join.");
        if (state.networkRoomData._setupErrorCallback) {
            state.networkRoomData._setupErrorCallback(new Error("Client join conditions not met."));
        }
        return;
    }
     // Ensure client's own player data has their peer ID
    if (state.networkRoomData.players && state.networkRoomData.players[0]) {
        if (state.networkRoomData.players[0].peerId !== myPeerId) {
            state.networkRoomData.players[0].peerId = myPeerId;
            state.setNetworkRoomData({ players: [...state.networkRoomData.players] });
        }
    } else {
        // This might happen if joinRoomById was called before player customisation fields were fully ready
        const customData = state.getLocalPlayerCustomizationForNetwork();
        state.setNetworkRoomData({ players: [{ ...customData, peerId: myPeerId }] });
        console.warn("[PeerConn] _finalizeClientJoinAttempt: Client player data was not fully initialized, using defaults.");
    }


    if (window.peerJsMultiplayer?.connect) {
        const connToLeader = window.peerJsMultiplayer.connect(leaderPeerIdToJoin);
        if (connToLeader) {
            leaderConnection = connToLeader;
            setupConnectionEventHandlers(leaderConnection, true); // true = is leader connection
             // _setupCompleteCallback for joinRoomById might be resolved upon successful connection open or JOIN_ACCEPTED
            if (state.networkRoomData._setupCompleteCallback) {
                 // For join, the promise might resolve earlier, e.g., once connection is initiated.
                 // Or later, upon JOIN_ACCEPTED. For now, let's assume successful initiation is enough.
                 state.networkRoomData._setupCompleteCallback(myPeerId); // Resolving with my ID
                 // delete state.networkRoomData._setupCompleteCallback;
                 // delete state.networkRoomData._setupErrorCallback;
            }
        } else {
            console.error(`[PeerConn] _finalizeClientJoinAttempt: peer.connect() returned null.`);
            peerJsCallbacks.onError({ type: 'connect_failed', message: 'Failed to initiate connection (connect returned null).' });
        }
    } else {
        peerJsCallbacks.onError({ type: 'connect_error', message: 'PeerJS connect function not available.' });
    }
}


const peerJsCallbacks = {
    onPeerOpen: (id) => {
        console.log(`[PeerConn] Global onPeerOpen triggered with ID: ${id}.`);
        const oldPeerId = state.myPeerId;
        state.setMyPeerId(id);

        if (state.networkRoomData._peerInitResolve) {
            console.log(`[PeerConn] Global onPeerOpen: Resolving _peerInitResolve for ID ${id}`);
            state.networkRoomData._peerInitResolve(id); // Resolve promise from initPeerObject
            // Clear them as they are for one-time initPeerObject
            delete state.networkRoomData._peerInitResolve;
            delete state.networkRoomData._peerInitReject;
        }

        // Check if a high-level setup (host/join) is pending and needs finalization
        if (state.networkRoomData._setupCompleteCallback || state.networkRoomData._setupErrorCallback) {
            if (state.networkRoomData.isRoomLeader &&
                (state.networkRoomData.roomState === 'waiting_for_players' || state.networkRoomData.roomState === 'creating_random_match_room')) {
                console.log("[PeerConn] onPeerOpen: Finalizing host setup initiated by a new peer object.");
                _finalizeHostSetup(id);
            } else if (!state.networkRoomData.isRoomLeader && state.networkRoomData.leaderPeerId && state.pvpRemoteActive) {
                console.log("[PeerConn] onPeerOpen: Finalizing client join initiated by a new peer object.");
                _finalizeClientJoinAttempt(id, state.networkRoomData.leaderPeerId);
            } else {
                console.log("[PeerConn] onPeerOpen: Peer opened, but no specific host/join finalization needed from here right now.");
            }
        } else {
            console.log(`[PeerConn] Global onPeerOpen: Peer ${id} opened. No pending _setupCallbacks. PvP Active: ${state.pvpRemoteActive}.`);
        }

        if (!state.pvpRemoteActive && oldPeerId !== id) {
             console.log('[PeerConn] Global onPeerOpen: PeerJS initialized/reconnected outside of active PvP mode (e.g. on page load). ID:', id);
        }
    },

    onNewConnection: (conn) => {
        if (!state.networkRoomData.isRoomLeader) {
            console.warn(`[PeerJS] Non-leader received a connection from ${conn.peer}. Rejecting.`);
            conn.on('open', () => conn.close());
            return;
        }
        let connectedOrPendingClientCount = 0;
        connections.forEach(entry => {
            if (entry.status !== 'rejected') connectedOrPendingClientCount++;
        });
        const totalPlayersIncludingLeaderAndNew = connectedOrPendingClientCount + 1 + 1;

        if (totalPlayersIncludingLeaderAndNew > state.networkRoomData.maxPlayers && !connections.has(conn.peer)) {
            console.warn(`[PeerJS] Room is full (Max: ${state.networkRoomData.maxPlayers}). Rejecting ${conn.peer}.`);
            conn.on('open', () => {
                conn.send({ type: MSG_TYPE.JOIN_REJECTED, reason: 'room_full' });
                setTimeout(() => conn.close(), 500);
            });
            return;
        }
        console.log(`[PeerJS] Leader received incoming connection from ${conn.peer}.`);
        connections.set(conn.peer, { connObject: conn, status: 'pending_join_request', player: null });
        setupConnectionEventHandlers(conn, false);
    },

    onConnectionOpen: (peerId) => {
        console.log(`[PeerJS] Data connection opened with ${peerId}.`);
        if (state.networkRoomData.isRoomLeader) {
            console.log(`[PeerConn] Leader: Connection from client ${peerId} is now open. Waiting for JOIN_REQUEST.`);
        } else {
            if (peerId === state.networkRoomData.leaderPeerId && leaderConnection && leaderConnection.open) {
                console.log(`[PeerConn] Client: Connection to leader ${peerId} open. Sending JOIN_REQUEST.`);
                const myPlayerDataForJoin = state.getLocalPlayerCustomizationForNetwork();
                if (myPlayerDataForJoin) {
                    sendDataToLeader({
                        type: MSG_TYPE.REQUEST_JOIN_ROOM,
                        playerData: myPlayerDataForJoin
                    });
                    state.setNetworkRoomData({ roomState: 'awaiting_join_approval' });
                    ui.showModalMessage(`Conectado al líder. Esperando aprobación para unirse...`);
                     if (state.networkRoomData._setupCompleteCallback) {
                        // For joinRoomById, this is a good point to resolve its promise.
                        state.networkRoomData._setupCompleteCallback(state.myPeerId);
                        delete state.networkRoomData._setupCompleteCallback;
                        delete state.networkRoomData._setupErrorCallback;
                    }
                } else {
                    peerJsCallbacks.onError({type: 'internal_error', message: 'Player data for join request missing.'});
                }
            }
        }
    },
    onDataReceived, // Keep existing
    onConnectionClose, // Keep existing
    onError // Keep existing
};


function initPeerObject(peerIdToUse = null, options = {}) {
    return new Promise((resolve, reject) => {
        if (window.peerJsMultiplayer && typeof window.peerJsMultiplayer.init === 'function') {
            state.setNetworkRoomData({ // Store these for onPeerOpen to use
                _peerInitResolve: resolve,
                _peerInitReject: reject
            });
            console.log(`[PeerConn] initPeerObject: Calling peerJsMultiplayer.init. Preferred ID: ${peerIdToUse}`);
            window.peerJsMultiplayer.init(peerIdToUse || options, peerJsCallbacks);
        } else {
            console.error("[PeerConn] initPeerObject: peerJsMultiplayer.init not found.");
            reject(new Error('Módulo multijugador no disponible.'));
        }
    });
}

export async function ensurePeerInitialized() { // Removed callbacks parameter
    const existingPeer = window.peerJsMultiplayer?.getPeer();
    const currentPeerId = window.peerJsMultiplayer?.getLocalId();

    if (existingPeer && !existingPeer.destroyed && currentPeerId) {
        console.log("[PeerConn] ensurePeerInitialized: PeerJS already initialized and open. My ID:", currentPeerId);
        state.setMyPeerId(currentPeerId); // Ensure state is up-to-date

        // If a high-level setup is pending, try to finalize it now
        if (state.networkRoomData._setupCompleteCallback || state.networkRoomData._setupErrorCallback) {
            console.log("[PeerConn] ensurePeerInitialized (already open): Pending setup found. Attempting finalization.");
            if (state.networkRoomData.isRoomLeader &&
                (state.networkRoomData.roomState === 'waiting_for_players' || state.networkRoomData.roomState === 'creating_random_match_room')) {
                _finalizeHostSetup(currentPeerId);
            } else if (!state.networkRoomData.isRoomLeader && state.networkRoomData.leaderPeerId && state.pvpRemoteActive) {
                 // For client, ensure connection attempt if not already connected
                if (!leaderConnection || !leaderConnection.open) {
                    _finalizeClientJoinAttempt(currentPeerId, state.networkRoomData.leaderPeerId);
                } else {
                     // Already connected or attempting, let onConnectionOpen handle JOIN_REQUEST
                     console.log("[PeerConn] ensurePeerInitialized (already open client): Leader connection exists/pending.");
                     if(state.networkRoomData._setupCompleteCallback) state.networkRoomData._setupCompleteCallback(currentPeerId); // Resolve if pending
                }
            }
        }
        return currentPeerId;
    }

    if (existingPeer && !existingPeer.destroyed && !currentPeerId) {
        console.warn("[PeerConn] ensurePeerInitialized: Peer object exists but ID is null (still connecting). Waiting for open via promise.");
        if (state.networkRoomData._peerInitResolve) { // If initPeerObject was already called
            return state.networkRoomData._peerInitPromise; // Return the existing promise
        }
        // This case should be rare if initPeerObject is always used.
        // Fall through to new initialization if _peerInitResolve is not set.
    }

    console.log("[PeerConn] ensurePeerInitialized: Initializing new PeerJS instance.");
    try {
        // Store the promise itself if needed for multiple awaiters, though ensurePeerInitialized is usually sequential.
        const peerInitPromise = initPeerObject();
        state.networkRoomData._peerInitPromise = peerInitPromise; // Store for potential re-entry
        const newPeerId = await peerInitPromise;

        console.log("[PeerConn] ensurePeerInitialized: New PeerJS instance initialized via initPeerObject. ID:", newPeerId);
        // onPeerOpen (global callback) would have already set state.myPeerId and handled finalization if needed.
        delete state.networkRoomData._peerInitPromise;
        return newPeerId;
    } catch (err) {
        console.error("[PeerConn] ensurePeerInitialized: Error initializing new PeerJS instance.", err);
        delete state.networkRoomData._peerInitPromise;
        // Global onError should have been called by initPeerObject's rejection
        if (state.networkRoomData._setupErrorCallback) { // If part of a larger setup
            state.networkRoomData._setupErrorCallback(err);
            delete state.networkRoomData._setupCompleteCallback;
            delete state.networkRoomData._setupErrorCallback;
        }
        throw err;
    }
}


export function hostNewRoom(hostPlayerData, gameSettings, isRandomMatchHost = false) {
    console.log("[PeerConn] hostNewRoom called.");
    state.resetNetworkRoomData(); // Critical: Clears previous callbacks too
    state.setPvpRemoteActive(true);

    return new Promise(async (resolve, reject) => {
        state.setNetworkRoomData({ // Set up the callbacks for THIS hosting attempt
            isRoomLeader: true,
            myPlayerIdInRoom: 0,
            gameSettings: { rows: gameSettings.rows, cols: gameSettings.cols },
            maxPlayers: gameSettings.maxPlayers,
            players: [{
                id: 0, peerId: null, name: hostPlayerData.name, icon: hostPlayerData.icon,
                color: hostPlayerData.color, isReady: true, isConnected: true, score: 0
            }],
            roomState: isRandomMatchHost ? 'creating_random_match_room' : 'waiting_for_players',
            _setupCompleteCallback: resolve,
            _setupErrorCallback: reject
        });

        ui.showModalMessage("Creando sala de juego...");

        try {
            // ensurePeerInitialized will now handle triggering _finalizeHostSetup
            // either directly (if peer already open) or via onPeerOpen (if peer newly opens).
            await ensurePeerInitialized();
            console.log("[PeerConn] hostNewRoom: ensurePeerInitialized completed. Host ID (from state):", state.myPeerId);
            // The promise for hostNewRoom (resolve/reject) is handled by _finalizeHostSetup or onError.
        } catch (err) {
            console.error("[PeerConn] Error during ensurePeerInitialized in hostNewRoom:", err);
            // ui.hideModalMessage(); // onError might show a modal
            // state.resetNetworkRoomData(); // Global error handler or stopAnyActive... should do this
            // state.setPvpRemoteActive(false);
            // ui.showSetupScreen();
            // reject(err); // The _setupErrorCallback should have been called by ensurePeerInitialized's error path
        }
    });
}

export async function joinRoomById(leaderPeerIdToJoin, joinerPlayerData) {
    console.log(`[PeerConn] joinRoomById called for leader: ${leaderPeerIdToJoin}`);
    state.resetNetworkRoomData(); // Critical: Clears previous callbacks
    state.setPvpRemoteActive(true);

    return new Promise(async (resolve, reject) => {
        state.setNetworkRoomData({
            roomId: leaderPeerIdToJoin,
            leaderPeerId: leaderPeerIdToJoin,
            isRoomLeader: false,
            players: [{ // Placeholder for self
                peerId: null, name: joinerPlayerData.name, icon: joinerPlayerData.icon, color: joinerPlayerData.color,
            }],
            roomState: 'connecting_to_lobby',
            _setupCompleteCallback: resolve, // For this join attempt
            _setupErrorCallback: reject
        });
        ui.showModalMessage(`Intentando conectar a la sala ${state.CAJITAS_PEER_ID_PREFIX}${leaderPeerIdToJoin}...`);

        try {
            // ensurePeerInitialized will set state.myPeerId and then trigger _finalizeClientJoinAttempt
            // either directly or via onPeerOpen.
            await ensurePeerInitialized();
            console.log(`[PeerConn] joinRoomById: ensurePeerInitialized completed. My ID (from state): ${state.myPeerId}. Leader: ${leaderPeerIdToJoin}`);
            // The promise for joinRoomById (resolve/reject) is handled by _finalizeClientJoinAttempt (e.g. onConnectionOpen) or onError.
        } catch (err) {
            console.error(`[PeerConn] Error during ensurePeerInitialized in joinRoomById for leader ${leaderPeerIdToJoin}:`, err);
            // ui.hideModalMessage(); // onError might show
            // Error handling is now more centralized via _setupErrorCallback in onError
        }
    });
}
// --- Functions below this line are less modified or just need to use the updated state/helpers ---
// Minor changes might be needed in handleLeaderDataReception and handleClientDataReception for consistency if any.

// Re-export existing functions or add minor adjustments as needed based on above changes.
// For example, broadcastRoomState, sendPlayerReadyState etc. should continue to work.
// The key is that state.myPeerId, state.networkRoomData.roomId, and state.networkRoomData.leaderPeerId
// are now more reliably set before these functions are typically called in earnest.

// Functions like handleLeaderDataReception, handleClientDataReception, reassignPlayerIdsAndBroadcastUpdate,
// leaveRoom, handleLeaderLocalMove, sendDataToLeader, sendDataToClient, broadcastToRoom, broadcastRoomState,
// sendPlayerReadyState, sendStartGameRequest, sendGameMoveToLeader, closePeerSession, setupConnectionEventHandlers
// remain largely the same as in the previous version, but they will benefit from a more stable underlying
// peer initialization and state management. Ensure they use state.getSanitizedNetworkRoomDataForClient()
// when sending full room data to clients.

// (Keep the rest of the functions from the previous `peerConnection.js` provided in Turn 7,
// e.g., handleLeaderDataReception, handleClientDataReception, etc.
// Ensure they are compatible with the more robust initialization flow.
// The main changes were focused on the init and setup sequence.)

// Placeholder for the rest of the functions from the previous response.
// You would paste the `handleLeaderDataReception`, `handleClientDataReception`,
// `reassignPlayerIdsAndBroadcastUpdate`, `leaveRoom`, `handleLeaderLocalMove`,
// `sendDataToLeader`, `sendDataToClient`, `broadcastToRoom`, `broadcastRoomState`,
// `sendPlayerReadyState`, `sendStartGameRequest`, `sendGameMoveToLeader`,
// `closePeerSession`, `setupConnectionEventHandlers` functions here.
// Make sure any references to `_setupCompleteCallback` are appropriate for their new context,
// generally they are now handled by `_finalizeHostSetup` or `_finalizeClientJoinAttempt` or `onConnectionOpen` for clients.

// ... (Paste the remaining functions from the previous version of peerConnection.js)
// For brevity, I'm omitting them here, but they are essential.
// Key functions to ensure are correct:
// - handleLeaderDataReception (especially MSG_TYPE.REQUEST_JOIN_ROOM)
// - handleClientDataReception (especially MSG_TYPE.JOIN_ACCEPTED, GAME_STARTED)
// - sendStartGameRequest
// - leaveRoom
// - closePeerSession

// Example of where to integrate:
function onDataReceived(data, fromPeerId) { // This is a global callback reference
    console.log(`[PeerJS] RX from ${fromPeerId}: Type: ${data.type}`, data);
    if (state.networkRoomData.isRoomLeader) {
        handleLeaderDataReception(data, fromPeerId);
    } else {
        handleClientDataReception(data, fromPeerId);
    }
}

function onConnectionClose(peerId) { // This is a global callback reference
    console.log(`[PeerJS] Connection with ${peerId} closed.`);
    if (state.networkRoomData.isRoomLeader) {
        const connEntry = connections.get(peerId);
        if (connEntry) {
            connections.delete(peerId);
            const leavingPlayer = state.networkRoomData.players.find(p => p.peerId === peerId);
            if (leavingPlayer) {
                const leavingPlayerName = leavingPlayer.name;
                state.removePlayerFromNetworkRoom(peerId);
                broadcastToRoom({ type: MSG_TYPE.PLAYER_LEFT, playerId: leavingPlayer.id, peerId: peerId, playerName: leavingPlayerName });
                reassignPlayerIdsAndBroadcastUpdate();
                ui.updateLobbyUI();
                matchmaking.updateHostedRoomStatus(state.networkRoomData.roomId, state.networkRoomData.gameSettings, state.networkRoomData.maxPlayers, state.networkRoomData.players.length);
                if (state.networkRoomData.roomState === 'in_game' && state.networkRoomData.players.length < state.MIN_PLAYERS_NETWORK) {
                    ui.showModalMessage(`Jugador ${leavingPlayerName} se desconectó. No hay suficientes jugadores.`);
                    gameLogic.endGameAbruptly();
                    state.setNetworkRoomData({ roomState: 'game_over_by_disconnect' });
                    broadcastToRoom({ type: MSG_TYPE.GAME_OVER_ANNOUNCEMENT, reason: 'disconnect', winnersData: gameLogic.getWinnerData(), scores: state.playersData.map(p => ({id:p.id, name:p.name, score:p.score}))});
                }
            }
        }
    } else {
        if (peerId === state.networkRoomData.leaderPeerId) {
            console.error("[PeerConn] Client: Connection to leader lost!");
            ui.showModalMessage("Se perdió la conexión con el líder de la sala.");
            connections.clear(); leaderConnection = null;
            state.resetNetworkRoomData(); state.setPvpRemoteActive(false);
            ui.showSetupScreen();
            if (state.gameActive) gameLogic.endGameAbruptly();
        }
    }
}
function onError(err, peerIdContext = null) { // This is a global callback reference
    console.error(`[PeerJS] Error (context: ${peerIdContext || 'general'}): Type: ${err.type}, Message: ${err.message || err}`, err);
    let displayMessage = err.message || (typeof err === 'string' ? err : 'Error desconocido.');
    const targetPeerForMsg = peerIdContext || state.networkRoomData.leaderPeerId || (err.peer ? err.peer : null) || (err.message?.match(/peer\s(.+)/)?.[1]);

    if (err.type) {
        if (err.type === 'peer-unavailable' || err.type === 'unavailable-id') displayMessage = `No se pudo conectar a: ${targetPeerForMsg ? state.CAJITAS_PEER_ID_PREFIX + targetPeerForMsg : 'remoto'}.`;
        else if (err.type === 'network') displayMessage = "Error de red. Verificá tu conexión.";
        else if (err.type === 'webrtc') displayMessage = "Error de WebRTC (firewall/red).";
        else if (err.type === 'disconnected') displayMessage = "Desconectado del servidor PeerJS.";
        else if (err.type === 'server-error') displayMessage = "Error del servidor PeerJS.";
        else if (err.type === 'socket-error' && err.message === 'Trying to send command before socket is open.') displayMessage = "Error de conexión inicial. Reintentando...";
        else displayMessage = `${err.type}: ${displayMessage}`;
    }

    if (state.networkRoomData._peerInitReject) { // Low-level initPeerObject promise
        state.networkRoomData._peerInitReject(err);
        delete state.networkRoomData._peerInitResolve; delete state.networkRoomData._peerInitReject;
    } else if (state.networkRoomData._setupErrorCallback) { // Higher-level host/join promise
        state.networkRoomData._setupErrorCallback(err);
        delete state.networkRoomData._setupCompleteCallback; delete state.networkRoomData._setupErrorCallback;
    } else {
        ui.showModalMessage(`Error de conexión: ${displayMessage}`);
    }
    ui.updateMessageArea("Error de conexión.", true);

    if (!state.networkRoomData.isRoomLeader && (state.networkRoomData.roomState === 'connecting_to_lobby' || state.networkRoomData.roomState === 'awaiting_join_approval')) {
        state.resetNetworkRoomData(); state.setPvpRemoteActive(false);
        ui.showSetupScreen(); ui.hideNetworkInfo();
    }
}


// --- Paste other functions from previous Turn 7 `peerConnection.js` here ---
// handleLeaderDataReception, handleClientDataReception, reassignPlayerIdsAndBroadcastUpdate,
// leaveRoom, handleLeaderLocalMove, sendDataToLeader, sendDataToClient, broadcastToRoom,
// broadcastRoomState, sendPlayerReadyState, sendStartGameRequest, sendGameMoveToLeader,
// closePeerSession, setupConnectionEventHandlers.
// Ensure they use state.getSanitizedNetworkRoomDataForClient() when appropriate.
// For example:
function handleLeaderDataReception(data, fromPeerId) {
    const connEntryWrapper = connections.get(fromPeerId);
    const connToUse = connEntryWrapper?.connObject;

    if (!connToUse && data.type !== MSG_TYPE.REQUEST_JOIN_ROOM) {
        console.warn(`[PeerConn L] Data from ${fromPeerId} but no active connection object found or not open. Type: ${data.type}. Ignored. Conn Entry:`, connEntryWrapper);
        return;
    }

    switch (data.type) {
        case MSG_TYPE.REQUEST_JOIN_ROOM:
            const newClientConn = window.peerJsMultiplayer.getConnection(fromPeerId);
            const actualConnObjectForJoin = newClientConn || connToUse;
             if (!actualConnObjectForJoin) {
                console.warn(`[PeerConn L] REQUEST_JOIN_ROOM from ${fromPeerId} but no connection object. Ignoring.`);
                return;
            }

            if (state.networkRoomData.players.length >= state.networkRoomData.maxPlayers) {
                actualConnObjectForJoin.send({ type: MSG_TYPE.JOIN_REJECTED, reason: 'room_full' });
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
            }
            
            const newPlayerId = state.networkRoomData.players.length;
            const newPlayer = {
                id: newPlayerId, peerId: fromPeerId, name: data.playerData.name, icon: data.playerData.icon,
                color: assignedColor, isReady: false, isConnected: true, score: 0
            };
            state.addPlayerToNetworkRoom(newPlayer);
            connections.set(fromPeerId, { connObject: actualConnObjectForJoin, player: newPlayer, status: 'active' });

            sendDataToClient(fromPeerId, {
                type: MSG_TYPE.JOIN_ACCEPTED,
                yourPlayerId: newPlayerId,
                roomData: state.getSanitizedNetworkRoomDataForClient(),
                yourAssignedColor: assignedColor,
                colorChanged: colorWasChanged
            });
            broadcastToRoom({ type: MSG_TYPE.PLAYER_JOINED, player: newPlayer }, fromPeerId);
            ui.updateLobbyUI();
            matchmaking.updateHostedRoomStatus(state.networkRoomData.roomId, state.networkRoomData.gameSettings, state.networkRoomData.maxPlayers, state.networkRoomData.players.length);
            break;

        case MSG_TYPE.PLAYER_READY_CHANGED:
            if (!connections.has(fromPeerId) || !connections.get(fromPeerId)?.player) return;
            const playerToUpdate = state.networkRoomData.players.find(p => p.peerId === fromPeerId);
            if (playerToUpdate) {
                playerToUpdate.isReady = data.isReady;
                state.setNetworkRoomData({players: [...state.networkRoomData.players]});
                broadcastToRoom({ type: MSG_TYPE.PLAYER_READY_CHANGED, playerId: playerToUpdate.id, peerId: fromPeerId, isReady: data.isReady });
                ui.updateLobbyUI();
            }
            break;

        case MSG_TYPE.GAME_MOVE:
            if (!connections.has(fromPeerId) || !connections.get(fromPeerId)?.player) return;
            if (state.networkRoomData.roomState !== 'in_game' || !state.gameActive) return;
            
            const movingPlayer = state.networkRoomData.players.find(p => p.peerId === fromPeerId);
            if (movingPlayer && movingPlayer.id === state.currentPlayerIndex) {
                if(typeof state.incrementTurnCounter === 'function') state.incrementTurnCounter();
                else console.error("state.incrementTurnCounter is not a function");

                const boxesBefore = state.filledBoxesCount;
                gameLogic.processMove(data.move.type, data.move.r, data.move.c, movingPlayer.id, false, true);
                const boxesCompletedThisTurn = state.filledBoxesCount - boxesBefore;

                broadcastToRoom({
                    type: MSG_TYPE.GAME_MOVE,
                    move: { ...data.move, playerIndex: movingPlayer.id, boxesJustCompleted: boxesCompletedThisTurn },
                    turnCounter: state.networkRoomData.turnCounter,
                    nextPlayerIndex: state.currentPlayerIndex,
                    updatedScores: state.playersData.map(p => ({id: p.id, score: p.score})),
                });

                const isStillLeaderTurn = state.currentPlayerIndex === state.networkRoomData.myPlayerIdInRoom;
                ui.setBoardClickable(isStillLeaderTurn && state.gameActive);

                if (!state.gameActive && state.networkRoomData.roomState !== 'game_over') {
                    state.setNetworkRoomData({ roomState: 'game_over' });
                    broadcastToRoom({
                        type: MSG_TYPE.GAME_OVER_ANNOUNCEMENT,
                        winnersData: gameLogic.getWinnerData(),
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
            const myAssignedData = data.roomData.players.find(p => p.id === data.yourPlayerId);
            if (!myAssignedData) {
                ui.showModalMessage("Error al unirse: tus datos no se encontraron.");
                leaveRoom(); return;
            }
            const localPlayerCustomization = state.getLocalPlayerCustomizationForNetwork();
            myAssignedData.name = localPlayerCustomization.name;
            myAssignedData.icon = localPlayerCustomization.icon;
            myAssignedData.color = data.yourAssignedColor;
            myAssignedData.peerId = state.myPeerId;

            state.setNetworkRoomData({
                myPlayerIdInRoom: data.yourPlayerId,
                gameSettings: data.roomData.gameSettings,
                maxPlayers: data.roomData.maxPlayers,
                roomState: 'lobby',
                leaderPeerId: data.roomData.leaderPeerId || state.networkRoomData.leaderPeerId,
                roomId: data.roomData.roomId || state.networkRoomData.roomId,
                players: data.roomData.players
            });

            if (data.colorChanged) {
                const colorInput = document.getElementById('player-color-0');
                if (colorInput) {
                    colorInput.value = data.yourAssignedColor;
                    colorInput.dispatchEvent(new Event('input', { bubbles: true }));
                }
                ui.updateLobbyMessage(`¡Te uniste! Tu color fue cambiado a ${data.yourAssignedColor}.`);
            } else {
                ui.updateLobbyMessage("¡Te uniste a la sala! Marcate como listo.");
            }
            ui.showLobbyScreen(); ui.updateLobbyUI(); ui.updateGameModeUI();
            console.log(`[PeerConn C] Joined room! My ID: ${data.yourPlayerId}. Color: ${data.yourAssignedColor}.`);
            break;

        case MSG_TYPE.JOIN_REJECTED:
            ui.showModalMessage(`No se pudo unir: ${data.reason || 'Rechazado.'}`);
            leaveRoom();
            break;

        case MSG_TYPE.PLAYER_JOINED:
            if (data.player.peerId !== state.myPeerId) {
                const existingPlayer = state.networkRoomData.players.find(p => p.peerId === data.player.peerId);
                if (!existingPlayer) state.addPlayerToNetworkRoom(data.player);
                else Object.assign(existingPlayer, data.player);
                ui.updateLobbyMessage(`${data.player.name} se ha unido.`);
            }
            ui.updateLobbyUI();
            break;

        case MSG_TYPE.PLAYER_LEFT:
            const leftPlayer = state.networkRoomData.players.find(p => p.id === data.playerId && p.peerId === data.peerId);
            state.removePlayerFromNetworkRoom(data.peerId);
            ui.updateLobbyMessage(`${data.playerName || 'Un jugador'} ha salido.`);
            ui.updateLobbyUI();
            break;

        case MSG_TYPE.ROOM_STATE_UPDATE:
            const myNewDataInRoom = data.roomData.players.find(p => p.peerId === state.myPeerId);
            state.setNetworkRoomData({
                players: data.roomData.players,
                gameSettings: data.roomData.gameSettings,
                maxPlayers: data.roomData.maxPlayers,
                myPlayerIdInRoom: myNewDataInRoom ? myNewDataInRoom.id : state.networkRoomData.myPlayerIdInRoom,
                leaderPeerId: data.roomData.leaderPeerId || state.networkRoomData.leaderPeerId,
                roomId: data.roomData.roomId || state.networkRoomData.roomId,
            });
            ui.updateLobbyUI();
            break;

        case MSG_TYPE.PLAYER_READY_CHANGED:
            const changedPlayer = state.networkRoomData.players.find(p => p.id === data.playerId);
            if (changedPlayer) changedPlayer.isReady = data.isReady;
            ui.updateLobbyUI();
            break;

        case MSG_TYPE.GAME_STARTED:
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
            if (data.turnCounter < state.networkRoomData.turnCounter && state.networkRoomData.turnCounter !== 0 && data.move.playerIndex !== state.networkRoomData.myPlayerIdInRoom) {
                return; // Stale move
            }
            state.networkRoomData.turnCounter = data.turnCounter;
            gameLogic.applyRemoteMove(data.move, data.nextPlayerIndex, data.updatedScores);
            break;
        
        case MSG_TYPE.FULL_GAME_STATE:
            if (data.gameState.turnCounter < state.networkRoomData.turnCounter && state.networkRoomData.turnCounter !== 0 && data.gameState.turnCounter !== 0) return; // Stale state
            gameLogic.applyFullState(data.gameState);
            state.networkRoomData.turnCounter = data.gameState.turnCounter;
            state.setNetworkRoomData({ roomState: data.gameState.gameActive ? 'in_game' : 'game_over' });
            if(state.networkRoomData.roomState === 'in_game') ui.showGameScreen();
            break;

        case MSG_TYPE.GAME_OVER_ANNOUNCEMENT:
            state.setNetworkRoomData({ roomState: 'game_over' });
            state.setGameActive(false);
            const winnerNames = data.winnersData.winners.map(w => w.name).join(' y ');
            let message = data.reason === 'disconnect' ? "Juego terminado por desconexión." : `¡Juego Terminado! Ganador(es): ${winnerNames || 'Nadie'}.`;
            if (data.winnersData.isTie && winnerNames) message = `¡Juego Terminado! Empate entre ${winnerNames}.`;
            else if (data.winnersData.winners.length === 0 && !data.reason) message = `¡Juego Terminado! ${data.winnersData.isTie ? "Empate general." : "No hubo ganadores claros."}`;
            ui.showModalMessage(message);
            ui.updateScoresDisplay();
            ui.setBoardClickable(false);
            break;
    }
}

function reassignPlayerIdsAndBroadcastUpdate() {
    if (!state.networkRoomData.isRoomLeader) return;
    const currentPlayers = state.networkRoomData.players.filter(p => {
        if (p.peerId === state.myPeerId) return true;
        const conn = connections.get(p.peerId);
        return conn && (conn.connObject?.open || conn.open);
    });
    currentPlayers.sort((a, b) => {
        if (a.peerId === state.myPeerId) return -1;
        if (b.peerId === state.myPeerId) return 1;
        return (a.id || Infinity) - (b.id || Infinity);
    });
    let idChangedOrPlayerRemoved = currentPlayers.length !== state.networkRoomData.players.length;
    currentPlayers.forEach((player, index) => {
        if (player.id !== index) idChangedOrPlayerRemoved = true;
        player.id = index;
        if (player.peerId === state.myPeerId) state.setNetworkRoomData({ myPlayerIdInRoom: index });
    });
    state.setNetworkRoomData({ players: currentPlayers });
    if (idChangedOrPlayerRemoved) broadcastRoomState();
}

export function leaveRoom() {
    console.log("[PeerConn] Leaving room...");
    ui.hideNetworkInfo();
    const currentRoomId = state.networkRoomData.roomId;
    if (state.networkRoomData.isRoomLeader) {
        broadcastToRoom({ type: 'error', message: 'El líder ha cerrado la sala.' });
        if (currentRoomId && window.peerJsMultiplayer?.getLocalId() === currentRoomId) {
            matchmaking.leaveQueue(currentRoomId);
        }
        setTimeout(() => {
            connections.forEach((connEntry, peerId) => {
                const connToClose = connEntry.connObject || connEntry;
                if (connToClose && typeof connToClose.close === 'function') {
                    try { connToClose.close(); } catch (e) { console.warn(`Error closing client conn ${peerId}:`, e); }
                }
            });
            connections.clear();
        }, 200);
    } else if (leaderConnection) {
        if (leaderConnection.open) {
          try { leaderConnection.close(); } catch (e) { console.warn("Error closing leader conn:", e); }
        }
    }
    leaderConnection = null;
}

export function handleLeaderLocalMove(moveDetails, boxesCompletedCount) {
    if (!state.networkRoomData.isRoomLeader) return;
    const leaderPlayerId = state.networkRoomData.myPlayerIdInRoom;
    if (leaderPlayerId === null || leaderPlayerId === undefined) return;

    if(typeof state.incrementTurnCounter === 'function') state.incrementTurnCounter();
    else console.error("state.incrementTurnCounter is not a function");

    const gameMoveMessage = {
        type: MSG_TYPE.GAME_MOVE,
        move: { ...moveDetails, playerIndex: leaderPlayerId, boxesJustCompleted: boxesCompletedCount },
        turnCounter: state.networkRoomData.turnCounter,
        nextPlayerIndex: state.currentPlayerIndex,
        updatedScores: state.playersData.map(p => ({id: p.id, score: p.score})),
    };
    broadcastToRoom(gameMoveMessage);

    if (!state.gameActive && state.networkRoomData.roomState !== 'game_over') {
        state.setNetworkRoomData({ roomState: 'game_over' });
        broadcastToRoom({
            type: MSG_TYPE.GAME_OVER_ANNOUNCEMENT,
            winnersData: gameLogic.getWinnerData(),
            scores: state.playersData.map(p => ({id: p.id, name: p.name, score: p.score}))
        });
    }
}

function sendDataToLeader(data) {
    if (leaderConnection && leaderConnection.open) {
        try { leaderConnection.send(data); }
        catch (e) { peerJsCallbacks.onError({type: 'send_error', message: 'Failed to send data to leader.', originalError: e}); }
    } else {
        peerJsCallbacks.onError({type: 'send_error_no_connection', message: 'No open connection to leader.'});
    }
}

function sendDataToClient(clientPeerId, data) {
    const connEntry = connections.get(clientPeerId);
    const conn = connEntry?.connObject;
    if (conn && conn.open) {
        try { conn.send(data); }
        catch (e) { console.error(`[PeerConn L] Error sending to client ${clientPeerId}:`, e, data); }
    } else {
        console.warn(`[PeerConn L] No open connection to client ${clientPeerId}. Cannot send.`, connEntry);
    }
}

function broadcastToRoom(data, excludePeerId = null) {
    if (!state.networkRoomData.isRoomLeader) return;
    connections.forEach((connEntry, peerId) => {
        const conn = connEntry?.connObject;
        if (peerId !== excludePeerId && conn && conn.open) {
            try { conn.send(data); }
            catch (e) { console.error(`[PeerConn L] Error broadcasting to ${peerId}:`, e); }
        }
    });
}

function broadcastRoomState() {
    if (!state.networkRoomData.isRoomLeader) return;
    broadcastToRoom({ type: MSG_TYPE.ROOM_STATE_UPDATE, roomData: state.getSanitizedNetworkRoomDataForClient() });
}

export function sendPlayerReadyState(isReady) {
    if (state.networkRoomData.isRoomLeader) {
        const leaderData = state.networkRoomData.players.find(p => p.peerId === state.myPeerId);
        if (leaderData) {
            leaderData.isReady = isReady;
            state.setNetworkRoomData({ players: [...state.networkRoomData.players] });
            broadcastToRoom({ type: MSG_TYPE.PLAYER_READY_CHANGED, playerId: leaderData.id, peerId: state.myPeerId, isReady: isReady });
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
        ui.updateLobbyMessage("No todos están listos o conectados.", true); return;
    }

    ui.hideNetworkInfo();
    state.setNetworkRoomData({ roomState: 'in_game' });
    state.setGameDimensions(state.networkRoomData.gameSettings.rows, state.networkRoomData.gameSettings.cols);
    const playersForGame = [...state.networkRoomData.players]
        .sort((a,b) => (a.id || 0) - (b.id || 0))
        .map(p => ({ id: p.id, name: p.name, icon: p.icon, color: p.color, score: 0, peerId: p.peerId }));
    state.setPlayersData(playersForGame);
    state.setCurrentPlayerIndex(0);
    if(typeof state.incrementTurnCounter === 'function') state.incrementTurnCounter(); else console.error("Missing incrementTurnCounter");
    state.networkRoomData.turnCounter = 1;
    gameLogic.initializeGame(true);
    ui.showGameScreen();
    matchmaking.leaveQueue(state.networkRoomData.roomId);
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
    if (state.networkRoomData.isRoomLeader) return;
    sendDataToLeader({ type: MSG_TYPE.GAME_MOVE, move: { type, r, c, playerIndex: state.networkRoomData.myPlayerIdInRoom, boxesJustCompleted: boxesCompletedCount }});
}

function setupConnectionEventHandlers(conn, isLeaderConn = false) {
    conn.on('open', () => {
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

export function closePeerSession() {
    if (window.peerJsMultiplayer && typeof window.peerJsMultiplayer.close === 'function') {
        console.log("[PeerConn] Fully closing PeerJS session (destroying peer).");
        window.peerJsMultiplayer.close();
    }
    leaderConnection = null;
    connections.clear();
    state.setMyPeerId(null);
}

window.addEventListener('beforeunload', () => {
    if (state.pvpRemoteActive) {
        if (state.networkRoomData.isRoomLeader && state.networkRoomData.roomId) {
            matchmaking.leaveQueue(state.networkRoomData.roomId);
        }
        closePeerSession();
    }
});