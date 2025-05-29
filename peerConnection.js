// peerConnection.js

import * as state from './state.js';
import * as ui from './ui.js';
import * as gameLogic from './gameLogic.js';
import * as matchmaking from './matchmaking_supabase.js'; // Ensure this line is present or add it

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

// Moved function definitions before peerJsCallbacks object

function onDataReceived(data, fromPeerId) {
    console.log(`[PeerJS RX] From ${fromPeerId}: Type: ${data.type}`, data);
    if (state.networkRoomData.isRoomLeader) {
        handleLeaderDataReception(data, fromPeerId);
    } else {
        handleClientDataReception(data, fromPeerId);
    }
}

function onConnectionClose(peerId) {
    console.log(`[PeerJS Event] Connection with ${peerId} closed.`);
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
            } else {
                console.warn(`[PeerConn] Connection closed with ${peerId}, but no matching player found in room data to properly announce departure.`);
            }
        }
    } else { // Client's perspective
        if (peerId === state.networkRoomData.leaderPeerId) {
            console.error("[PeerConn] Client: Connection to leader lost!");
            ui.showModalMessage("Se perdió la conexión con el líder de la sala.");
            connections.clear(); leaderConnection = null;
            // Reset state and UI - usually stopAnyActiveGameOrNetworkSession handles this in main.js
            if (state.networkRoomData._setupErrorCallback) { // If a join promise was pending
                 state.networkRoomData._setupErrorCallback(new Error("Connection to leader closed."));
                 delete state.networkRoomData._setupCompleteCallback;
                 delete state.networkRoomData._setupErrorCallback;
            }
            state.resetNetworkRoomData(); state.setPvpRemoteActive(false);
            ui.showSetupScreen();
            if (state.gameActive) gameLogic.endGameAbruptly();
        }
    }
}

async function onError(err, peerIdContext = null) { // Made async to await removeDeadRoomByPeerId
    console.error(`[PeerJS Error] (Context: ${peerIdContext || 'general'}): Type: ${err.type}, Msg: ${err.message || err}`, err);
    let displayMessage = err.message || (typeof err === 'string' ? err : 'Error desconocido.');
    const targetPeerForMsg = peerIdContext || state.networkRoomData.leaderPeerId || (err.peer ? err.peer : null) || (err.message?.match(/peer\s(.+)/)?.[1]);

    if (err.type) {
        if (err.type === 'peer-unavailable' || err.type === 'unavailable-id') {
            displayMessage = `No se pudo conectar a: ${targetPeerForMsg ? state.CAJITAS_PEER_ID_PREFIX + targetPeerForMsg : 'remoto'}.`;
            // Check if this client was trying to join a room (found via matchmaking) that is now unavailable
            if (!state.networkRoomData.isRoomLeader && targetPeerForMsg && 
                (state.networkRoomData.roomState === 'connecting_to_lobby' || state.networkRoomData.roomState === 'awaiting_join_approval') &&
                targetPeerForMsg === state.networkRoomData.leaderPeerId) { // leaderPeerId is the raw ID
                console.warn(`[PeerConn onError] Peer ${targetPeerForMsg} is unavailable. This might be a dead room from matchmaking. Attempting cleanup.`);
                await matchmaking.removeDeadRoomByPeerId(targetPeerForMsg); // targetPeerForMsg should be the raw peer ID
                displayMessage += " La sala podría haber sido cerrada. Intentá buscar de nuevo.";
            }
        } else if (err.type === 'network') {
            displayMessage = "Error de red. Verificá tu conexión.";
        } else if (err.type === 'webrtc') {
            displayMessage = "Error de WebRTC (firewall/red).";
        } else if (err.type === 'disconnected') {
            displayMessage = "Desconectado del servidor PeerJS."; // From PeerJS signaling server
        } else if (err.type === 'server-error') {
            displayMessage = "Error del servidor PeerJS.";
        } else if (err.type === 'socket-error' && err.message === 'Trying to send command before socket is open.') {
            displayMessage = "Error de conexión inicial. Reintentando...";
        } else if (err.type === 'connection-error') {
            displayMessage = `Error de conexión con ${targetPeerForMsg ? state.CAJITAS_PEER_ID_PREFIX+targetPeerForMsg : 'par' }.`;
        } else {
            displayMessage = `${err.type}: ${displayMessage}`;
        }
    }

    // Handle promise rejections for initPeerObject (low-level)
    if (state.networkRoomData._peerInitReject) {
        console.log("[PeerConn] onError: Calling _peerInitReject.");
        state.networkRoomData._peerInitReject(err); // Pass original error object
        delete state.networkRoomData._peerInitResolve; delete state.networkRoomData._peerInitReject;
    }
    // Handle promise rejections for hostNewRoom/joinRoomById (high-level)
    if (state.networkRoomData._setupErrorCallback) {
        console.log("[PeerConn] onError: Calling _setupErrorCallback.");
        // Pass a new error with the processed displayMessage for user-facing errors,
        // but keep the original error type for internal logic if needed.
        const errorForCallback = new Error(displayMessage);
        errorForCallback.type = err.type; // Preserve original error type
        errorForCallback.originalError = err; // Preserve original error
        state.networkRoomData._setupErrorCallback(errorForCallback);
        delete state.networkRoomData._setupCompleteCallback; delete state.networkRoomData._setupErrorCallback;
    }

    // Fallback UI update if no specific promise was being handled or if they are already cleared
    if (!state.networkRoomData._peerInitReject && !state.networkRoomData._setupErrorCallback) {
         ui.showModalMessage(`Error de conexión: ${displayMessage}`);
    }
    ui.updateMessageArea("Error de conexión.", true);

    // If client experiences critical error during connection phases
    if (!state.networkRoomData.isRoomLeader &&
        (state.networkRoomData.roomState === 'connecting_to_lobby' ||
         state.networkRoomData.roomState === 'awaiting_join_approval')) {
        console.warn("[PeerConn] onError: Client connection failed during setup. Resetting state (after potential cleanup).");
        // The error callback for joinRoomById would have been called, leading to main.js handling UI reset.
        // If not, or as a safeguard:
        // state.resetNetworkRoomData(); state.setPvpRemoteActive(false);
        // ui.showSetupScreen(); ui.hideNetworkInfo();
    }
}


// This object holds references to the callbacks used by peerjs-multiplayer.js
const peerJsCallbacks = {
    onPeerOpen: (id) => { // id is our own PeerJS ID when successfully connected to PeerServer
        console.log(`[PeerConn] Global onPeerOpen triggered with ID: ${id}.`);
        const oldPeerId = state.myPeerId;
        state.setMyPeerId(id);

        if (state.networkRoomData._peerInitResolve) {
            console.log(`[PeerConn] Global onPeerOpen: Resolving _peerInitResolve for ID ${id}`);
            state.networkRoomData._peerInitResolve(id);
            delete state.networkRoomData._peerInitResolve;
            delete state.networkRoomData._peerInitReject;
        }

        if (state.networkRoomData._setupCompleteCallback) {
            console.log(`[PeerConn] Global onPeerOpen: Pending _setupCompleteCallback found.`);
            if (state.networkRoomData.isRoomLeader &&
                (state.networkRoomData.roomState === 'waiting_for_players' || state.networkRoomData.roomState === 'creating_random_match_room')) {
                console.log("[PeerConn] onPeerOpen: Finalizing host setup because peer object just opened.");
                _finalizeHostSetup(id);
            } else if (!state.networkRoomData.isRoomLeader && state.networkRoomData.leaderPeerId && state.pvpRemoteActive) {
                console.log("[PeerConn] onPeerOpen: Finalizing client join because peer object just opened.");
                _finalizeClientJoinAttempt(id, state.networkRoomData.leaderPeerId);
            } else {
                console.log("[PeerConn] onPeerOpen: _setupCompleteCallback exists, but conditions for host/join finalization not met from here. State:", JSON.parse(JSON.stringify(state.getSanitizedNetworkRoomDataForClient())));
            }
        } else {
            console.log(`[PeerConn] Global onPeerOpen: Peer ${id} opened. No pending _setupCompleteCallback. PvP Active: ${state.pvpRemoteActive}.`);
        }
         if (!state.pvpRemoteActive && oldPeerId !== id) {
             console.log('[PeerConn] Global onPeerOpen: PeerJS initialized/reconnected outside of active PvP mode. ID:', id);
        }
    },

    onNewConnection: (conn) => { // conn is the PeerJS DataConnection object from a new client
        if (!state.networkRoomData.isRoomLeader) {
            console.warn(`[PeerJS Event] Non-leader received a connection from ${conn.peer}. Rejecting.`);
            conn.on('open', () => conn.close());
            return;
        }
        // Check if room is full BEFORE adding to connections map
        if (state.networkRoomData.players.length >= state.networkRoomData.maxPlayers) {
             console.warn(`[PeerJS Event] Room is full (Players: ${state.networkRoomData.players.length}/${state.networkRoomData.maxPlayers}). Rejecting new connection from ${conn.peer}.`);
            conn.on('open', () => { // Wait for connection to be open before sending rejection and closing
                conn.send({ type: MSG_TYPE.JOIN_REJECTED, reason: 'room_full' });
                setTimeout(() => conn.close(), 500); // Give time for message to send
            });
            return;
        }
        console.log(`[PeerJS Event] Leader received incoming connection from ${conn.peer}.`);
        connections.set(conn.peer, { connObject: conn, status: 'pending_join_request', player: null });
        setupConnectionEventHandlers(conn, false); // false = not the leader's primary connection to another leader
    },

    onConnectionOpen: (peerId) => { // peerId is the remote peer ID whose DataConnection to us is now open
        console.log(`[PeerJS Event] Data connection now open with remote peer: ${peerId}.`);
        if (state.networkRoomData.isRoomLeader) {
            console.log(`[PeerConn] Leader: Connection from client ${peerId} is now open. Client should send JOIN_REQUEST.`);
            const connEntry = connections.get(peerId);
            if (connEntry) { // Update status if the entry exists from onNewConnection
                connections.set(peerId, { ...connEntry, status: 'awaiting_join_request' });
            } else { // Should ideally not happen if onNewConnection fired first
                console.warn(`[PeerConn] Leader: Connection opened with ${peerId}, but no prior entry in connections map.`);
                connections.set(peerId, { connObject: window.peerJsMultiplayer.getConnection(peerId), status: 'awaiting_join_request', player: null });
            }
        } else { // Client's perspective: our connection to the leader is now open
            if (peerId === state.networkRoomData.leaderPeerId && leaderConnection && leaderConnection.open) {
                console.log(`[PeerConn] Client: Connection to leader ${peerId} fully open. Sending JOIN_REQUEST.`);
                const myPlayerDataForJoin = state.getLocalPlayerCustomizationForNetwork();
                if (state.networkRoomData.players && state.networkRoomData.players[0]) {
                    state.networkRoomData.players[0].peerId = state.myPeerId; // Ensure our own template has our ID
                }

                if (myPlayerDataForJoin && state.myPeerId) {
                     sendDataToLeader({
                        type: MSG_TYPE.REQUEST_JOIN_ROOM,
                        playerData: {
                            name: myPlayerDataForJoin.name, icon: myPlayerDataForJoin.icon,
                            color: myPlayerDataForJoin.color,
                        }
                    });
                    state.setNetworkRoomData({ roomState: 'awaiting_join_approval' });
                    ui.showModalMessage(`Conectado al líder. Esperando aprobación...`);

                    if (state.networkRoomData._setupCompleteCallback) {
                        console.log("[PeerConn] Client onConnectionOpen to leader: Resolving _setupCompleteCallback for joinRoomById.");
                        state.networkRoomData._setupCompleteCallback(state.myPeerId);
                        delete state.networkRoomData._setupCompleteCallback; // Clean up
                        delete state.networkRoomData._setupErrorCallback;
                    }
                } else {
                    console.error("[PeerConn] Client onConnectionOpen: Cannot send JOIN_REQUEST. Missing player data or myPeerId.", myPlayerDataForJoin, state.myPeerId);
                    // This should trigger the _setupErrorCallback for joinRoomById
                    peerJsCallbacks.onError({type: 'internal_error', message: 'Player data for join request missing locally.'});
                }
            } else {
                 console.warn(`[PeerConn] Client onConnectionOpen: Opened connection with ${peerId}, but expected leader ${state.networkRoomData.leaderPeerId} or leaderConnection invalid. LC open: ${leaderConnection?.open}, LC peer: ${leaderConnection?.peer}`);
            }
        }
    },
    onDataReceived,    // Defined above
    onConnectionClose, // Defined above
    onError            // Defined above (now async)
};


// Internal helper for host finalization
function _finalizeHostSetup(hostPeerId) {
    console.log(`[PeerConn] _finalizeHostSetup called with hostPeerId: ${hostPeerId}`);
    if (!state.networkRoomData._setupCompleteCallback && !state.networkRoomData._setupErrorCallback) {
        console.warn("[PeerConn] _finalizeHostSetup: No pending setup callbacks. Already finalized or aborted.");
        return;
    }

    if (!state.networkRoomData.isRoomLeader ||
        !(state.networkRoomData.roomState === 'waiting_for_players' || state.networkRoomData.roomState === 'creating_random_match_room')) {
        console.warn("[PeerConn] _finalizeHostSetup: Conditions not met for host setup. State:", state.networkRoomData.roomState, "IsLeader:", state.networkRoomData.isRoomLeader);
        if (state.networkRoomData._setupErrorCallback) {
            state.networkRoomData._setupErrorCallback(new Error("Host setup conditions not met during finalization."));
        }
        delete state.networkRoomData._setupCompleteCallback;
        delete state.networkRoomData._setupErrorCallback;
        return;
    }

    if (!state.networkRoomData.players || !state.networkRoomData.players[0]) {
        console.error('[PeerConn] _finalizeHostSetup Error: networkRoomData.players[0] not initialized for host!');
        if (state.networkRoomData._setupErrorCallback) {
            state.networkRoomData._setupErrorCallback(new Error("Host player data missing during finalization."));
        }
        delete state.networkRoomData._setupCompleteCallback;
        delete state.networkRoomData._setupErrorCallback;
        return;
    }

    state.networkRoomData.players[0].peerId = hostPeerId;
    state.setNetworkRoomData({
        roomId: hostPeerId, // roomId is the raw peerId of the host
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
        // Update Supabase with the actual hostPeerId (which is state.networkRoomData.roomId now)
        matchmaking.updateHostedRoomStatus(state.networkRoomData.roomId, state.networkRoomData.gameSettings, state.networkRoomData.maxPlayers, state.networkRoomData.players.length);
    }
    ui.hideModalMessage();

    if (state.networkRoomData._setupCompleteCallback) {
        console.log("[PeerConn] _finalizeHostSetup: Calling _setupCompleteCallback.");
        state.networkRoomData._setupCompleteCallback(hostPeerId);
    }
    delete state.networkRoomData._setupCompleteCallback;
    delete state.networkRoomData._setupErrorCallback;
}

// Internal helper for client join attempt finalization
function _finalizeClientJoinAttempt(myPeerId, leaderPeerIdToJoin) {
    console.log(`[PeerConn] _finalizeClientJoinAttempt: My PeerID ${myPeerId}, attempting to connect to ${leaderPeerIdToJoin}`);
    if (!state.networkRoomData._setupCompleteCallback && !state.networkRoomData._setupErrorCallback) {
        console.warn("[PeerConn] _finalizeClientJoinAttempt: No pending setup callbacks. Already handled or aborted.");
        return;
    }
    if (state.networkRoomData.isRoomLeader || !leaderPeerIdToJoin || !state.pvpRemoteActive) {
        console.warn("[PeerConn] _finalizeClientJoinAttempt: Conditions not met for client join. IsLeader:", state.networkRoomData.isRoomLeader, "LeaderPID:", leaderPeerIdToJoin, "PvPActive:", state.pvpRemoteActive);
        if (state.networkRoomData._setupErrorCallback) {
            state.networkRoomData._setupErrorCallback(new Error("Client join conditions not met during finalization attempt."));
        }
        delete state.networkRoomData._setupCompleteCallback;
        delete state.networkRoomData._setupErrorCallback;
        return;
    }

    if (state.networkRoomData.players && state.networkRoomData.players[0]) {
        if (state.networkRoomData.players[0].peerId !== myPeerId) {
            state.networkRoomData.players[0].peerId = myPeerId;
            state.setNetworkRoomData({ players: [...state.networkRoomData.players] });
        }
    } else {
        const customData = state.getLocalPlayerCustomizationForNetwork();
        state.setNetworkRoomData({ players: [{ ...customData, peerId: myPeerId }] });
    }

    if (window.peerJsMultiplayer?.connect) {
        if (leaderConnection && leaderConnection.open && leaderConnection.peer === leaderPeerIdToJoin) {
            console.log("[PeerConn] _finalizeClientJoinAttempt: Already connected to leader. No new connection needed.");
            // Resolve promise if pending, as connection is effectively initiated/exists
            if (state.networkRoomData._setupCompleteCallback) {
                 state.networkRoomData._setupCompleteCallback(myPeerId);
                 delete state.networkRoomData._setupCompleteCallback;
                 delete state.networkRoomData._setupErrorCallback;
            }
            return;
        }
        console.log(`[PeerConn] _finalizeClientJoinAttempt: Calling peerJsMultiplayer.connect to ${leaderPeerIdToJoin}`);
        const connToLeader = window.peerJsMultiplayer.connect(leaderPeerIdToJoin);
        if (connToLeader) {
            leaderConnection = connToLeader;
            setupConnectionEventHandlers(leaderConnection, true);
            // The promise for joinRoomById is often resolved by onConnectionOpen for the client.
            // However, if we consider initiating the connect() call as "setup complete" for joinRoomById,
            // we could resolve it here. For robustness, let's let onConnectionOpen handle it.
            // If _setupCompleteCallback still exists by the time onConnectionOpen runs, it will be called.
            // If an error occurs before that, onError will call _setupErrorCallback.
        } else {
            console.error(`[PeerConn] _finalizeClientJoinAttempt: peer.connect() returned null when trying to connect to ${leaderPeerIdToJoin}.`);
            peerJsCallbacks.onError({ type: 'connect_failed', message: `Failed to initiate connection to ${leaderPeerIdToJoin} (connect returned null).` }, leaderPeerIdToJoin);
        }
    } else {
        peerJsCallbacks.onError({ type: 'connect_error', message: 'PeerJS connect function not available.' });
    }
}


function initPeerObject(peerIdToUse = null, options = {}) {
    return new Promise((resolve, reject) => {
        if (window.peerJsMultiplayer && typeof window.peerJsMultiplayer.init === 'function') {
            state.setNetworkRoomData({
                _peerInitResolve: resolve,
                _peerInitReject: reject
            });
            console.log(`[PeerConn] initPeerObject: Calling peerJsMultiplayer.init. Preferred ID: ${peerIdToUse}`);
            window.peerJsMultiplayer.init(peerIdToUse || options, peerJsCallbacks);
        } else {
            console.error("[PeerConn] initPeerObject: peerJsMultiplayer.init not found.");
            const err = new Error('Módulo multijugador no disponible.');
            // Ensure _setupErrorCallback is called if a higher-level operation (host/join) was pending
            if (state.networkRoomData._setupErrorCallback) {
                state.networkRoomData._setupErrorCallback(err);
                delete state.networkRoomData._setupCompleteCallback;
                delete state.networkRoomData._setupErrorCallback;
            }
            reject(err); // Reject the initPeerObject promise
        }
    });
}

export async function ensurePeerInitialized() {
    const existingPeer = window.peerJsMultiplayer?.getPeer();
    let currentPeerId = window.peerJsMultiplayer?.getLocalId();

    if (existingPeer && !existingPeer.destroyed && currentPeerId) {
        console.log("[PeerConn] ensurePeerInitialized: PeerJS already initialized and open. My ID:", currentPeerId);
        if (state.myPeerId !== currentPeerId) state.setMyPeerId(currentPeerId);

        // If a setup (host/join) was pending when peer opened, finalize it.
        if (state.networkRoomData._setupCompleteCallback) {
            console.log("[PeerConn] ensurePeerInitialized (already open): Pending setup found. Triggering direct finalization.");
            if (state.networkRoomData.isRoomLeader) {
                _finalizeHostSetup(currentPeerId);
            } else if (!state.networkRoomData.isRoomLeader && state.networkRoomData.leaderPeerId) {
                _finalizeClientJoinAttempt(currentPeerId, state.networkRoomData.leaderPeerId);
            }
        }
        return currentPeerId;
    }

    if (existingPeer && !existingPeer.destroyed && !currentPeerId) {
        console.warn("[PeerConn] ensurePeerInitialized: Peer object exists but ID is null (PeerServer connection pending). Awaiting existing init promise if any.");
        if (state.networkRoomData._peerInitPromise) {
            console.log("[PeerConn] ensurePeerInitialized: Awaiting existing _peerInitPromise.");
            return state.networkRoomData._peerInitPromise;
        }
        // This situation (peer exists, no ID, no promise) might indicate a previous init attempt didn't clean up its promise store.
        // Or, it's a fresh call after a failed/cleaned-up init. Proceeding to re-initialize.
        console.log("[PeerConn] ensurePeerInitialized: No active _peerInitPromise for connecting peer. Will start new init.");
    }

    console.log("[PeerConn] ensurePeerInitialized: Initializing new PeerJS instance or awaiting existing init.");
    // Store the promise in a way that subsequent calls can await the same init attempt.
    // Only create a new promise if one isn't already stored from this current chain of ensurePeerInitialized calls.
    let initPromiseToAwait = state.networkRoomData._peerInitPromise;
    if (!initPromiseToAwait) {
        initPromiseToAwait = initPeerObject();
        state.setNetworkRoomData({ _peerInitPromise: initPromiseToAwait }); // Store it
    }
    
    try {
        const newPeerId = await initPromiseToAwait;
        console.log("[PeerConn] ensurePeerInitialized: PeerJS initialization completed. ID (from promise):", newPeerId);
        // Global onPeerOpen (triggered by initPeerObject/initPromiseToAwait) would have:
        // 1. Set state.myPeerId.
        // 2. If _setupCompleteCallback was present (for host/join), called appropriate _finalize function.
        
        // Clean up the stored promise once this specific init chain resolves or rejects.
        if (state.networkRoomData._peerInitPromise === initPromiseToAwait) {
            state.setNetworkRoomData({ _peerInitPromise: null });
        }
        return newPeerId;
    } catch (err) {
        console.error("[PeerConn] ensurePeerInitialized: Error during PeerJS initialization.", err);
        // Clean up the stored promise on error as well.
        if (state.networkRoomData._peerInitPromise === initPromiseToAwait) {
           state.setNetworkRoomData({ _peerInitPromise: null });
        }
        // The onError callback within peerJsCallbacks (called by initPeerObject)
        // should have handled _setupErrorCallback if one was pending for a host/join operation.
        throw err; // Re-throw for the caller (hostNewRoom/joinRoomById)
    }
}

export function hostNewRoom(hostPlayerData, gameSettings, isRandomMatchHost = false) {
    console.log("[PeerConn] hostNewRoom called. RandomHost:", isRandomMatchHost);
    state.resetNetworkRoomData(); // Resets everything including callbacks
    state.setPvpRemoteActive(true);

    return new Promise(async (resolve, reject) => {
        // Set up the callbacks for this specific hostNewRoom operation
        state.setNetworkRoomData({
            isRoomLeader: true,
            myPlayerIdInRoom: 0, // Leader is always player 0 initially
            gameSettings: { ...gameSettings },
            maxPlayers: gameSettings.maxPlayers,
            players: [{ // Host's own data
                id: 0, peerId: null, name: hostPlayerData.name, icon: hostPlayerData.icon,
                color: hostPlayerData.color, isReady: true, isConnected: true, score: 0
            }],
            roomState: isRandomMatchHost ? 'creating_random_match_room' : 'waiting_for_players',
            _setupCompleteCallback: resolve, // Promise resolve for hostNewRoom
            _setupErrorCallback: reject    // Promise reject for hostNewRoom
        });

        ui.showModalMessage("Creando sala de juego...");
        try {
            await ensurePeerInitialized();
            // If successful, ensurePeerInitialized (via onPeerOpen -> _finalizeHostSetup)
            // will call the _setupCompleteCallback (resolve).
            // If error, ensurePeerInitialized (via onError) will call _setupErrorCallback (reject).
        } catch (err) {
            console.error("[PeerConn] hostNewRoom: Error from ensurePeerInitialized. Callback should have been handled.", err);
            // Fallback reject if _setupErrorCallback wasn't called by the chain (it should have been)
            if (!state.networkRoomData._setupErrorCallback) { // Check if it's still set
                 reject(err);
            }
             // Clear callbacks manually here if error occurred before _setupErrorCallback was naturally cleared
            state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
        }
    });
}

export async function joinRoomById(leaderPeerIdToJoin, joinerPlayerData) {
    console.log(`[PeerConn] joinRoomById called for leader: ${leaderPeerIdToJoin}`);
    state.resetNetworkRoomData(); // Resets everything including callbacks
    state.setPvpRemoteActive(true);

    return new Promise(async (resolve, reject) => {
        state.setNetworkRoomData({
            roomId: leaderPeerIdToJoin, // Store the leader's raw peer ID as the room ID
            leaderPeerId: leaderPeerIdToJoin,
            isRoomLeader: false,
            players: [{ // Client's own data (ID will be assigned by leader)
                peerId: null, name: joinerPlayerData.name, // My peerId will be set once PeerJS is up
                icon: joinerPlayerData.icon, color: joinerPlayerData.color,
            }],
            roomState: 'connecting_to_lobby',
            _setupCompleteCallback: resolve, // Promise resolve for joinRoomById
            _setupErrorCallback: reject    // Promise reject for joinRoomById
        });
        ui.showModalMessage(`Intentando conectar a la sala ${state.CAJITAS_PEER_ID_PREFIX}${leaderPeerIdToJoin}...`);

        try {
            await ensurePeerInitialized();
            // If successful, ensurePeerInitialized (via onPeerOpen -> _finalizeClientJoinAttempt -> onConnectionOpen)
            // will eventually call _setupCompleteCallback (resolve) via client's onConnectionOpen -> JOIN_ACCEPTED.
            // If error during init or connection, onError will call _setupErrorCallback (reject).
        } catch (err) {
            console.error(`[PeerConn] joinRoomById: Error from ensurePeerInitialized. Callback should have been handled.`, err);
             if (!state.networkRoomData._setupErrorCallback) {
                 reject(err);
            }
            state.setNetworkRoomData({ _setupCompleteCallback: null, _setupErrorCallback: null });
        }
    });
}


function handleLeaderDataReception(data, fromPeerId) {
    const connEntryWrapper = connections.get(fromPeerId);
    const connToUse = connEntryWrapper?.connObject;

    if (!connToUse && data.type !== MSG_TYPE.REQUEST_JOIN_ROOM) {
        console.warn(`[PeerConn L] Data from ${fromPeerId} but no active connection object. Type: ${data.type}. Ignored. Entry:`, connEntryWrapper);
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
            
            const newPlayerId = state.networkRoomData.players.length; // Simple ID assignment for now
            const newPlayer = {
                id: newPlayerId, peerId: fromPeerId, name: data.playerData.name, icon: data.playerData.icon,
                color: assignedColor, isReady: false, isConnected: true, score: 0
            };
            state.addPlayerToNetworkRoom(newPlayer);
            // Ensure the connection object is stored correctly in the connections map
            connections.set(fromPeerId, { connObject: actualConnObjectForJoin, player: newPlayer, status: 'active' });


            sendDataToClient(fromPeerId, {
                type: MSG_TYPE.JOIN_ACCEPTED,
                yourPlayerId: newPlayerId,
                roomData: state.getSanitizedNetworkRoomDataForClient(), // Send the current state of the room
                yourAssignedColor: assignedColor,
                colorChanged: colorWasChanged
            });
            // Inform other players about the new joiner
            broadcastToRoom({ type: MSG_TYPE.PLAYER_JOINED, player: newPlayer }, fromPeerId); // Exclude the new joiner
            ui.updateLobbyUI(); // Update leader's lobby UI
            matchmaking.updateHostedRoomStatus(state.networkRoomData.roomId, state.networkRoomData.gameSettings, state.networkRoomData.maxPlayers, state.networkRoomData.players.length);
            break;

        case MSG_TYPE.PLAYER_READY_CHANGED:
            if (!connections.has(fromPeerId) || !connections.get(fromPeerId)?.player) {
                 console.warn(`[PeerConn L] PLAYER_READY_CHANGED from ${fromPeerId} but not in connections or no player data.`);
                 return;
            }
            const playerToUpdate = state.networkRoomData.players.find(p => p.peerId === fromPeerId);
            if (playerToUpdate) {
                playerToUpdate.isReady = data.isReady;
                state.setNetworkRoomData({players: [...state.networkRoomData.players]}); // Update state
                broadcastToRoom({ type: MSG_TYPE.PLAYER_READY_CHANGED, playerId: playerToUpdate.id, peerId: fromPeerId, isReady: data.isReady });
                ui.updateLobbyUI(); // Update everyone's lobby UI via broadcast
            }
            break;

        case MSG_TYPE.GAME_MOVE:
            if (!connections.has(fromPeerId) || !connections.get(fromPeerId)?.player) {
                console.warn(`[PeerConn L] GAME_MOVE from ${fromPeerId} but not in connections or no player data.`);
                return;
            }
            if (state.networkRoomData.roomState !== 'in_game' || !state.gameActive) {
                console.warn("[PeerConn L] Game move received but game not active. Ignored.");
                return;
            }
            
            const movingPlayer = state.networkRoomData.players.find(p => p.peerId === fromPeerId);
            if (movingPlayer && movingPlayer.id === state.currentPlayerIndex) { // Check if it's the correct player's turn
                if(typeof state.incrementTurnCounter === 'function') state.incrementTurnCounter();
                else console.error("state.incrementTurnCounter is not a function");

                const boxesBefore = state.filledBoxesCount;
                // gameLogic.processMove should use player IDs
                gameLogic.processMove(data.move.type, data.move.r, data.move.c, movingPlayer.id, false, true); // isLeaderProcessing = true
                const boxesCompletedThisTurn = state.filledBoxesCount - boxesBefore;

                // Broadcast the processed move and new game state
                broadcastToRoom({
                    type: MSG_TYPE.GAME_MOVE,
                    move: { ...data.move, playerIndex: movingPlayer.id, boxesJustCompleted: boxesCompletedThisTurn }, // playerIndex is ID
                    turnCounter: state.networkRoomData.turnCounter,
                    nextPlayerIndex: state.currentPlayerIndex, // currentPlayerIndex is now an ID
                    updatedScores: state.playersData.map(p => ({id: p.id, score: p.score})), // Send all scores
                });

                // Leader's board clickability
                const isStillLeaderTurn = state.currentPlayerIndex === state.networkRoomData.myPlayerIdInRoom;
                ui.setBoardClickable(isStillLeaderTurn && state.gameActive);

                // Check for game over AFTER processing the move
                if (!state.gameActive && state.networkRoomData.roomState !== 'game_over') { // Game ended
                    state.setNetworkRoomData({ roomState: 'game_over' });
                    broadcastToRoom({
                        type: MSG_TYPE.GAME_OVER_ANNOUNCEMENT,
                        winnersData: gameLogic.getWinnerData(),
                        scores: state.playersData.map(p => ({id: p.id, name: p.name, score: p.score}))
                    });
                }
            } else {
                console.warn(`[PeerConn L] Move from ${fromPeerId} (Player ID ${movingPlayer?.id}) but it's Player ID ${state.currentPlayerIndex}'s turn. Ignored.`);
                // Optionally, send a correction or full game state if desync is suspected
            }
            break;
        // Other leader-specific message handling...
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
            // My assigned ID from the leader
            const myAssignedPlayerId = data.yourPlayerId;
            const myAssignedDataInRoom = data.roomData.players.find(p => p.id === myAssignedPlayerId);

            if (!myAssignedDataInRoom) {
                console.error("[PeerConn C] JOIN_ACCEPTED: My player data not found in roomData from leader. My assigned ID:", myAssignedPlayerId, "RoomData Players:", data.roomData.players);
                ui.showModalMessage("Error al unirse: tus datos no se encontraron en la sala.");
                if (state.networkRoomData._setupErrorCallback) {
                    state.networkRoomData._setupErrorCallback(new Error("My player data not found in JOIN_ACCEPTED from leader."));
                }
                leaveRoom(); return;
            }
            
            // Update local player customization based on leader's assignment (especially color)
            const localPlayerCustomization = state.getLocalPlayerCustomizationForNetwork();
            myAssignedDataInRoom.name = localPlayerCustomization.name; // Keep my chosen name
            myAssignedDataInRoom.icon = localPlayerCustomization.icon; // Keep my chosen icon
            myAssignedDataInRoom.color = data.yourAssignedColor;      // Use color assigned by leader
            myAssignedDataInRoom.peerId = state.myPeerId; // Ensure my peerId is set correctly

            state.setNetworkRoomData({
                myPlayerIdInRoom: myAssignedPlayerId,
                gameSettings: data.roomData.gameSettings,
                maxPlayers: data.roomData.maxPlayers,
                roomState: 'lobby', // Successfully joined the lobby
                // leaderPeerId and roomId should already be set from joinRoomById
                leaderPeerId: data.roomData.leaderPeerId || state.networkRoomData.leaderPeerId,
                roomId: data.roomData.roomId || state.networkRoomData.roomId,
                players: data.roomData.players // Full player list from leader
            });

            if (data.colorChanged) {
                const colorInput = document.getElementById('player-color-0'); // Assuming client uses field 0 for self
                if (colorInput) {
                    colorInput.value = data.yourAssignedColor;
                    // Optionally dispatch an event if other parts of UI react to this input change programmatically
                    colorInput.dispatchEvent(new Event('input', { bubbles: true })); 
                }
                ui.updateLobbyMessage(`¡Te uniste! Tu color fue cambiado a ${data.yourAssignedColor}.`);
            } else {
                ui.updateLobbyMessage("¡Te uniste a la sala! Marcate como listo.");
            }
            ui.showLobbyScreen(); ui.updateLobbyUI(); ui.updateGameModeUI();
            console.log(`[PeerConn C] Joined room! My Player ID in Room: ${myAssignedPlayerId}. My PeerJS ID: ${state.myPeerId}. Color: ${data.yourAssignedColor}.`);
            
            // Resolve joinRoomById's promise if it's still pending (it should be resolved by onConnectionOpen typically)
             if (state.networkRoomData._setupCompleteCallback) {
                 console.log("[PeerConn C] JOIN_ACCEPTED: Resolving _setupCompleteCallback (as fallback or final confirmation).");
                 state.networkRoomData._setupCompleteCallback(state.myPeerId); // Resolve with our own peerId
                 delete state.networkRoomData._setupCompleteCallback;
                 delete state.networkRoomData._setupErrorCallback;
             }
            break;

        case MSG_TYPE.JOIN_REJECTED:
            ui.showModalMessage(`No se pudo unir: ${data.reason || 'Rechazado por el líder.'}`);
            if (state.networkRoomData._setupErrorCallback) { // If joinRoomById promise is pending
                state.networkRoomData._setupErrorCallback(new Error(data.reason || 'Join rejected by leader'));
            }
            // leaveRoom() will be called by stopAnyActiveGameOrNetworkSession in main.js after promise rejection
            // For robustness, ensure critical cleanup if not handled by promise chain:
            // closePeerSession(); state.resetNetworkRoomData(); state.setPvpRemoteActive(false); ui.showSetupScreen();
            break;

        case MSG_TYPE.PLAYER_JOINED: // Another player joined
            if (data.player.peerId !== state.myPeerId) { // Don't re-add self
                const existingPlayer = state.networkRoomData.players.find(p => p.peerId === data.player.peerId || p.id === data.player.id);
                if (!existingPlayer) {
                    state.addPlayerToNetworkRoom(data.player);
                } else { // Update existing player's data if they reconnected or info changed
                    Object.assign(existingPlayer, data.player);
                }
                ui.updateLobbyMessage(`${data.player.name} se ha unido.`);
            }
            ui.updateLobbyUI(); // Update UI with the new player list
            break;

        case MSG_TYPE.PLAYER_LEFT:
            // const leftPlayer = state.networkRoomData.players.find(p => p.id === data.playerId && p.peerId === data.peerId);
            state.removePlayerFromNetworkRoom(data.peerId); // Remove by peerId is more robust
            ui.updateLobbyMessage(`${data.playerName || 'Un jugador'} ha salido.`);
            ui.updateLobbyUI(); // Update UI
            // Leader might send ROOM_STATE_UPDATE after this to re-assign IDs, client should handle that too.
            break;

        case MSG_TYPE.ROOM_STATE_UPDATE: // Full room state update from leader
            const myNewDataInRoomUpdate = data.roomData.players.find(p => p.peerId === state.myPeerId);
            state.setNetworkRoomData({
                players: data.roomData.players,
                gameSettings: data.roomData.gameSettings,
                maxPlayers: data.roomData.maxPlayers,
                // Update myPlayerIdInRoom in case it changed due to re-assignment by leader
                myPlayerIdInRoom: myNewDataInRoomUpdate ? myNewDataInRoomUpdate.id : state.networkRoomData.myPlayerIdInRoom,
                // LeaderPeerId and RoomID should ideally not change post-join, but update if provided
                leaderPeerId: data.roomData.leaderPeerId || state.networkRoomData.leaderPeerId,
                roomId: data.roomData.roomId || state.networkRoomData.roomId,
            });
            ui.updateLobbyUI(); // Refresh entire lobby based on new state
            break;

        case MSG_TYPE.PLAYER_READY_CHANGED:
            const changedPlayer = state.networkRoomData.players.find(p => p.id === data.playerId);
            if (changedPlayer) {
                changedPlayer.isReady = data.isReady;
            }
            ui.updateLobbyUI(); // Update UI to reflect ready state change
            break;

        case MSG_TYPE.GAME_STARTED:
            ui.hideNetworkInfo(); // Hide QR/ID info
            state.setNetworkRoomData({ roomState: 'in_game' });
            // Leader sends game players in their correct order with IDs
            state.setPlayersData(data.initialGameState.playersInGameOrder);
            state.setGameDimensions(data.initialGameState.gameSettings.rows, data.initialGameState.gameSettings.cols);
            state.setCurrentPlayerIndex(data.initialGameState.startingPlayerIndex); // This is an ID
            state.networkRoomData.turnCounter = data.initialGameState.turnCounter; // Sync turn counter
            
            gameLogic.initializeGame(true); // true for remote game
            ui.showGameScreen();
            ui.updateMessageArea("¡El juego ha comenzado!", false, 5000);
            break;

        case MSG_TYPE.GAME_MOVE:
            // Basic stale move prevention (more robust checks might be needed for packet reordering)
            if (data.turnCounter < state.networkRoomData.turnCounter && state.networkRoomData.turnCounter !== 0 && data.move.playerIndex !== state.networkRoomData.myPlayerIdInRoom) {
                console.warn(`[PeerConn C] Stale game move received (local ${state.networkRoomData.turnCounter}, remote ${data.turnCounter}). Ignored.`);
                return; 
            }
            state.networkRoomData.turnCounter = data.turnCounter; // Update to leader's turn counter
            // applyRemoteMove expects playerIndex in moveData to be the ID of the mover
            gameLogic.applyRemoteMove(data.move, data.nextPlayerIndex, data.updatedScores);
            break;
        
        case MSG_TYPE.FULL_GAME_STATE: // Received full game state from leader (e.g., on late join or resync)
             if (data.gameState.turnCounter < state.networkRoomData.turnCounter && state.networkRoomData.turnCounter !== 0 && data.gameState.turnCounter !== 0) {
                console.warn(`[PeerConn C] Stale FULL_GAME_STATE received (local ${state.networkRoomData.turnCounter}, remote ${data.gameState.turnCounter}). Ignored.`);
                return;
            }
            gameLogic.applyFullState(data.gameState); // This function should handle setting all game parameters
            state.networkRoomData.turnCounter = data.gameState.turnCounter; // Sync turn counter
            state.setNetworkRoomData({ roomState: data.gameState.gameActive ? 'in_game' : 'game_over' });
            if(state.networkRoomData.roomState === 'in_game') ui.showGameScreen(); // Ensure game screen if active
            // If game over, modal will be triggered by GAME_OVER_ANNOUNCEMENT normally.
            // If joining a game already over, this syncs the board state.
            break;

        case MSG_TYPE.GAME_OVER_ANNOUNCEMENT:
            state.setNetworkRoomData({ roomState: 'game_over' });
            state.setGameActive(false); // Ensure game is marked inactive
            // Update scores from the announcement if provided and potentially more final than last move
            if (data.scores) {
                 data.scores.forEach(ps => {
                    const playerToUpdate = state.playersData.find(p => p.id === ps.id);
                    if (playerToUpdate) playerToUpdate.score = ps.score;
                });
                ui.updateScoresDisplay();
            }

            const winnerNamesArray = data.winnersData.winners.map(w => `${w.name} ${w.icon || ''}`);
            const winnerNames = winnerNamesArray.join(' y ');
            
            let message = "";
            if (data.reason === 'disconnect') {
                message = "Juego terminado por desconexión de un jugador.";
            } else if (data.reason === 'leader_left') {
                message = "El líder de la sala ha salido. Juego terminado.";
            } else if (data.winnersData.isTie && winnerNamesArray.length > 0) {
                message = `¡Juego Terminado! Empate épico entre ${winnerNames} con ${data.winnersData.maxScore} cajitas.`;
            } else if (winnerNamesArray.length === 1) {
                message = `¡Juego Terminado! ${winnerNames} ${data.winnersData.winners[0].icon || ''} ganó con ${data.winnersData.maxScore} cajitas! 🥳`;
            } else if (data.winnersData.winners.length === 0 && data.winnersData.maxScore === 0 && state.filledBoxesCount === state.totalPossibleBoxes) {
                message = "¡Juego Terminado! Empate sin puntos, ¡pero todas las cajitas llenas!";
            } else {
                 message = "¡Juego Terminado!";
                 if (winnerNames) message += ` Ganador(es): ${winnerNames}.`;
                 else if (data.winnersData.isTie) message += " ¡Fue un empate!";
            }
            
            ui.showModalMessage(message);
            ui.setBoardClickable(false); // Disable board
            break;
        // Other client-specific message handling...
    }
    // Clean up callbacks if they were related to a join attempt that just got a definitive server response
    if (data.type === MSG_TYPE.JOIN_ACCEPTED || data.type === MSG_TYPE.JOIN_REJECTED) {
        delete state.networkRoomData._setupCompleteCallback;
        delete state.networkRoomData._setupErrorCallback;
    }
}

function reassignPlayerIdsAndBroadcastUpdate() { // Leader only function
    if (!state.networkRoomData.isRoomLeader) return;

    // Filter out disconnected players and ensure leader is first (ID 0)
    const connectedPlayers = state.networkRoomData.players.filter(p => {
        if (p.peerId === state.myPeerId) return true; // Leader is always connected
        const conn = connections.get(p.peerId);
        // Consider a player connected if they have an open connection or are the leader
        return conn && (conn.connObject?.open || conn.open); // Check underlying PeerJS connection status
    });

    // Sort: Leader first, then by original join order (approximated by current ID if stable)
    connectedPlayers.sort((a, b) => {
        if (a.peerId === state.myPeerId) return -1; // Leader (self) comes first
        if (b.peerId === state.myPeerId) return 1;
        return (a.id === undefined ? Infinity : a.id) - (b.id === undefined ? Infinity : b.id); // Preserve order of others
    });

    let idChangedOrPlayerRemoved = connectedPlayers.length !== state.networkRoomData.players.length;

    // Re-assign IDs sequentially
    connectedPlayers.forEach((player, index) => {
        if (player.id !== index) {
            idChangedOrPlayerRemoved = true;
            console.log(`[PeerConn L] Re-assigning ID for ${player.name} (${player.peerId}): Old ID ${player.id} -> New ID ${index}`);
            player.id = index;
        }
        if (player.peerId === state.myPeerId) { // Update leader's own player ID in room
            state.setNetworkRoomData({ myPlayerIdInRoom: index });
        }
    });

    state.setNetworkRoomData({ players: connectedPlayers }); // Update state with the filtered and re-ID'd players

    if (idChangedOrPlayerRemoved) {
       console.log("[PeerConn L] Player IDs reassigned or player removed. Broadcasting new room state.");
       broadcastRoomState(); // Send updated roomData (with new IDs) to all remaining clients
       ui.updateLobbyUI(); // Update leader's own UI
    }
}

export function leaveRoom() {
    console.log("[PeerConn] Leaving room called...");
    ui.hideNetworkInfo(); // Hide QR code area
    const currentRoomId = state.networkRoomData.roomId; // This is the raw peerId of the host
    const isCurrentlyLeader = state.networkRoomData.isRoomLeader;

    if (isCurrentlyLeader) {
        console.log("[PeerConn] Leader is leaving. Informing clients and unlisting from matchmaking.");
        // Inform all clients that the game is over because leader left
        broadcastToRoom({ type: MSG_TYPE.GAME_OVER_ANNOUNCEMENT, reason: 'leader_left', winnersData: {winners:[],maxScore:0, isTie:false}, scores: [] });
        
        // If this room was listed via matchmaking, remove it
        if (currentRoomId && state.myPeerId === currentRoomId) { // currentRoomId is host's raw peerId
            matchmaking.leaveQueue(currentRoomId); // Pass raw peerId
        }
        
        // Close all client connections after a short delay to allow messages to send
        setTimeout(() => {
            connections.forEach((connEntry, peerId) => {
                const connToClose = connEntry.connObject || connEntry; // connEntry might be the connection itself or a wrapper
                if (connToClose && typeof connToClose.close === 'function') {
                    try { connToClose.close(); } catch (e) { console.warn(`Error closing client conn ${peerId}:`, e); }
                }
            });
            connections.clear();
        }, 300); // 300ms delay
    } else if (leaderConnection) { // Client is leaving
        console.log("[PeerConn] Client is leaving. Closing connection to leader.");
        if (leaderConnection.open) {
          try { leaderConnection.close(); } catch (e) { console.warn("Error closing leader conn:", e); }
        }
    }
    leaderConnection = null; // Clear leader connection for client

    // The actual state reset (pbpRemoteActive = false, networkRoomData reset, UI to setup)
    // is typically handled by stopAnyActiveGameOrNetworkSession in main.js,
    // which calls this leaveRoom function.
    // If calling leaveRoom directly, ensure those resets happen.
}

export function handleLeaderLocalMove(moveDetails, boxesCompletedCount) {
    if (!state.networkRoomData.isRoomLeader) return; // Should only be called by leader
    const leaderPlayerId = state.networkRoomData.myPlayerIdInRoom; // Leader's ID in the game
    if (leaderPlayerId === null || leaderPlayerId === undefined) {
        console.error("[PeerConn L] Leader local move, but leader's player ID is not set.");
        return;
    }

    if(typeof state.incrementTurnCounter === 'function') state.incrementTurnCounter();
    else console.error("state.incrementTurnCounter is not a function in handleLeaderLocalMove");

    const gameMoveMessage = {
        type: MSG_TYPE.GAME_MOVE,
        move: { ...moveDetails, playerIndex: leaderPlayerId, boxesJustCompleted: boxesCompletedCount }, // playerIndex is the ID
        turnCounter: state.networkRoomData.turnCounter,
        nextPlayerIndex: state.currentPlayerIndex, // ID of the next player
        updatedScores: state.playersData.map(p => ({id: p.id, score: p.score})),
    };
    broadcastToRoom(gameMoveMessage);

    // Check for game over after leader's move
    if (!state.gameActive && state.networkRoomData.roomState !== 'game_over') { // Game just ended
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
        // This can happen if connection drops right before send
        console.warn("[PeerConn C] No open connection to leader. Cannot send data.", data);
        peerJsCallbacks.onError({type: 'send_error_no_connection', message: 'No open connection to leader.'});
    }
}

function sendDataToClient(clientPeerId, data) {
    const connEntry = connections.get(clientPeerId);
    const conn = connEntry?.connObject; // Get the actual PeerJS connection object
    if (conn && conn.open) {
        try { conn.send(data); }
        catch (e) { console.error(`[PeerConn L] Error sending to client ${clientPeerId}:`, e, data); }
    } else {
        console.warn(`[PeerConn L] No open connection to client ${clientPeerId}. Cannot send. Conn Entry:`, connEntry);
    }
}

function broadcastToRoom(data, excludePeerId = null) {
    if (!state.networkRoomData.isRoomLeader) return;
    // console.log(`[PeerConn L] Broadcasting to room (excluding ${excludePeerId || 'none'}):`, data.type, data);
    connections.forEach((connEntry, peerId) => {
        const conn = connEntry?.connObject; // Get the actual PeerJS connection object
        if (peerId !== excludePeerId && conn && conn.open) {
            try { conn.send(data); }
            catch (e) { console.error(`[PeerConn L] Error broadcasting to ${peerId}:`, e); }
        }
    });
}

function broadcastRoomState() { // Leader sends its current room understanding to all clients
    if (!state.networkRoomData.isRoomLeader) return;
    broadcastToRoom({ type: MSG_TYPE.ROOM_STATE_UPDATE, roomData: state.getSanitizedNetworkRoomDataForClient() });
}

export function sendPlayerReadyState(isReady) {
    if (state.networkRoomData.isRoomLeader) {
        // Leader updates their own ready state
        const leaderData = state.networkRoomData.players.find(p => p.peerId === state.myPeerId);
        if (leaderData) {
            leaderData.isReady = isReady;
            state.setNetworkRoomData({ players: [...state.networkRoomData.players] }); // Update state
            // Broadcast the change to all clients
            broadcastToRoom({ type: MSG_TYPE.PLAYER_READY_CHANGED, playerId: leaderData.id, peerId: state.myPeerId, isReady: isReady });
            ui.updateLobbyUI(); // Update leader's own UI
        }
    } else { // Client sends ready state to leader
        sendDataToLeader({ type: MSG_TYPE.PLAYER_READY_CHANGED, isReady: isReady });
        // Client's UI will be updated when leader broadcasts PLAYER_READY_CHANGED or ROOM_STATE_UPDATE
    }
}

export function sendStartGameRequest() { // Leader initiates game start
    if (!state.networkRoomData.isRoomLeader || state.networkRoomData.roomState === 'in_game') return;
    
    const canStart = state.networkRoomData.players.length >= state.MIN_PLAYERS_NETWORK &&
                     state.networkRoomData.players.every(p => p.isReady && (p.isConnected !== false)); // isConnected might be undefined initially, treat as true unless explicitly false
    
    if (!canStart) {
        ui.updateLobbyMessage("No todos están listos o conectados para iniciar.", true); return;
    }

    ui.hideNetworkInfo(); // Hide QR/ID display
    state.setNetworkRoomData({ roomState: 'in_game' });
    
    // Finalize game settings and player order
    state.setGameDimensions(state.networkRoomData.gameSettings.rows, state.networkRoomData.gameSettings.cols);
    
    // Ensure players are sorted by their assigned IDs for game logic consistency
    const playersForGame = [...state.networkRoomData.players]
        .sort((a,b) => (a.id || 0) - (b.id || 0)) // Sort by ID
        .map(p => ({ id: p.id, name: p.name, icon: p.icon, color: p.color, score: 0, peerId: p.peerId })); // Ensure score is 0
    
    state.setPlayersData(playersForGame); // This is the array gameLogic will use
    state.setCurrentPlayerIndex(playersForGame[0].id); // Start with player ID 0 (leader)

    if(typeof state.incrementTurnCounter === 'function') state.incrementTurnCounter(); 
    else console.error("Missing incrementTurnCounter for game start in sendStartGameRequest");
    state.networkRoomData.turnCounter = 1; // Initialize turn counter for network game

    gameLogic.initializeGame(true); // true for remote game, this sets up board, etc.
    ui.showGameScreen(); // Switch UI to game view for leader

    // Unlist from matchmaking as the game is starting
    if (state.networkRoomData.roomId) { // roomId is host's raw peerId
        matchmaking.leaveQueue(state.networkRoomData.roomId); // Unlist from Supabase
        // Also explicitly update status to 'in_game' in Supabase, which also stops expiration.
        matchmaking.updateHostedRoomStatus(
            state.networkRoomData.roomId,
            state.networkRoomData.gameSettings,
            state.networkRoomData.maxPlayers,
            state.networkRoomData.players.length,
            'in_game' // Explicitly set status
        );
    }
    
    // Broadcast GAME_STARTED to all clients
    broadcastToRoom({
        type: MSG_TYPE.GAME_STARTED,
        initialGameState: {
            playersInGameOrder: playersForGame, // Send the finalized player list
            gameSettings: state.networkRoomData.gameSettings,
            startingPlayerIndex: state.currentPlayerIndex, // Send the ID of the starting player
            turnCounter: state.networkRoomData.turnCounter
        }
    });
    // Leader's turn message will be handled by initializeGame -> updatePlayerTurnDisplay
}

export function sendGameMoveToLeader(type, r, c, boxesCompletedCount) { // Client sends move to leader
    if (state.networkRoomData.isRoomLeader) return; // Client only
    // Client sends its move. playerIndex is its ID in the game.
    sendDataToLeader({ type: MSG_TYPE.GAME_MOVE, move: { type, r, c, playerIndex: state.networkRoomData.myPlayerIdInRoom, boxesJustCompleted: boxesCompletedCount }});
}

function setupConnectionEventHandlers(conn, isLeaderConn = false) { // isLeaderConn is for client's connection *to* the leader
    conn.on('open', () => {
        // This 'open' is for the DataConnection itself.
        // Call the global onConnectionOpen which then dispatches.
        peerJsCallbacks.onConnectionOpen(conn.peer); // conn.peer is the remote peer ID
    });
    conn.on('data', (data) => {
        peerJsCallbacks.onDataReceived(data, conn.peer);
    });
    conn.on('close', () => {
        peerJsCallbacks.onConnectionClose(conn.peer);
    });
    conn.on('error', (err) => {
        peerJsCallbacks.onError(err, conn.peer); // Pass remote peer ID for context
    });
}

export function closePeerSession() {
    if (window.peerJsMultiplayer && typeof window.peerJsMultiplayer.close === 'function') {
        console.log("[PeerConn] Fully closing PeerJS session (destroying peer).");
        window.peerJsMultiplayer.close(); // This should trigger peer.destroy()
    } else {
        console.warn("[PeerConn] Attempted to close peer session, but peerJsMultiplayer.close is not available.");
    }
    // Reset local tracking and state related to peer
    leaderConnection = null;
    connections.clear();
    state.setMyPeerId(null); // Our peer ID is no longer valid after session close
    // Note: Further state reset (like pvpRemoteActive, networkRoomData) is typically
    // handled by a higher-level function like stopAnyActiveGameOrNetworkSession in main.js
}

// Graceful disconnect on page unload
window.addEventListener('beforeunload', () => {
    if (state.pvpRemoteActive) {
        // If leader, try to inform Supabase this room is going down (best effort)
        if (state.networkRoomData.isRoomLeader && state.networkRoomData.roomId) {
            // roomId is host's raw peerId
            matchmaking.leaveQueue(state.networkRoomData.roomId); // Unlist the room from Supabase
        }
        // leaveRoom(); // May not have time to send messages gracefully on unload
        closePeerSession(); // Destroy peer object immediately for quicker cleanup
    }
});