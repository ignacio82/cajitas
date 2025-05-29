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

function onError(err, peerIdContext = null) {
    console.error(`[PeerJS Error] (Context: ${peerIdContext || 'general'}): Type: ${err.type}, Msg: ${err.message || err}`, err);
    let displayMessage = err.message || (typeof err === 'string' ? err : 'Error desconocido.');
    const targetPeerForMsg = peerIdContext || state.networkRoomData.leaderPeerId || (err.peer ? err.peer : null) || (err.message?.match(/peer\s(.+)/)?.[1]);

    if (err.type) {
        if (err.type === 'peer-unavailable' || err.type === 'unavailable-id') displayMessage = `No se pudo conectar a: ${targetPeerForMsg ? state.CAJITAS_PEER_ID_PREFIX + targetPeerForMsg : 'remoto'}.`;
        else if (err.type === 'network') displayMessage = "Error de red. Verificá tu conexión.";
        else if (err.type === 'webrtc') displayMessage = "Error de WebRTC (firewall/red).";
        else if (err.type === 'disconnected') displayMessage = "Desconectado del servidor PeerJS."; // From PeerJS signaling server
        else if (err.type === 'server-error') displayMessage = "Error del servidor PeerJS.";
        else if (err.type === 'socket-error' && err.message === 'Trying to send command before socket is open.') displayMessage = "Error de conexión inicial. Reintentando...";
        else if (err.type === 'connection-error') displayMessage = `Error de conexión con ${targetPeerForMsg ? state.CAJITAS_PEER_ID_PREFIX+targetPeerForMsg : 'par' }.`;
        else displayMessage = `${err.type}: ${displayMessage}`;
    }

    // Handle promise rejections for initPeerObject (low-level)
    if (state.networkRoomData._peerInitReject) {
        console.log("[PeerConn] onError: Calling _peerInitReject.");
        state.networkRoomData._peerInitReject(err);
        delete state.networkRoomData._peerInitResolve; delete state.networkRoomData._peerInitReject;
    }
    // Handle promise rejections for hostNewRoom/joinRoomById (high-level)
    if (state.networkRoomData._setupErrorCallback) {
        console.log("[PeerConn] onError: Calling _setupErrorCallback.");
        state.networkRoomData._setupErrorCallback(err);
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
        console.warn("[PeerConn] onError: Client connection failed during setup. Resetting state.");
        state.resetNetworkRoomData(); state.setPvpRemoteActive(false);
        ui.showSetupScreen(); ui.hideNetworkInfo();
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
    onError            // Defined above
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
            peerJsCallbacks.onError({ type: 'connect_failed', message: `Failed to initiate connection to ${leaderPeerIdToJoin} (connect returned null).` });
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
            if (state.networkRoomData._setupErrorCallback) state.networkRoomData._setupErrorCallback(err);
            reject(err);
        }
    });
}

export async function ensurePeerInitialized() {
    const existingPeer = window.peerJsMultiplayer?.getPeer();
    let currentPeerId = window.peerJsMultiplayer?.getLocalId();

    if (existingPeer && !existingPeer.destroyed && currentPeerId) {
        console.log("[PeerConn] ensurePeerInitialized: PeerJS already initialized and open. My ID:", currentPeerId);
        if (state.myPeerId !== currentPeerId) state.setMyPeerId(currentPeerId);

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
        console.warn("[PeerConn] ensurePeerInitialized: Peer object exists but ID is null (PeerServer connection pending).");
        if (state.networkRoomData._peerInitPromise) {
            console.log("[PeerConn] ensurePeerInitialized: Awaiting existing _peerInitPromise.");
            return state.networkRoomData._peerInitPromise;
        }
        // This case should ideally be covered by an existing _peerInitPromise.
        // If not, it suggests a state desync or an init attempt was lost.
        console.error("[PeerConn] ensurePeerInitialized: Peer connecting, but no _peerInitPromise. This is unexpected. Re-initiating.");
        // Fall through to new init, but this indicates potential issues.
    }

    console.log("[PeerConn] ensurePeerInitialized: Initializing new PeerJS instance or awaiting existing init.");
    try {
        // Only create and store a new promise if one isn't already pending for the current init cycle
        let initPromise = state.networkRoomData._peerInitPromise;
        if (!initPromise) {
            initPromise = initPeerObject();
            state.networkRoomData._peerInitPromise = initPromise;
        }
        
        const newPeerId = await initPromise;
        // Clear the promise once resolved/rejected to allow fresh inits later if needed
        delete state.networkRoomData._peerInitPromise;

        console.log("[PeerConn] ensurePeerInitialized: PeerJS initialization completed. ID (from promise):", newPeerId);
        // Global onPeerOpen (triggered by initPeerObject) would have:
        // 1. Set state.myPeerId.
        // 2. If _setupCompleteCallback was present, called appropriate _finalize function.
        return newPeerId;
    } catch (err) {
        console.error("[PeerConn] ensurePeerInitialized: Error during new PeerJS initialization.", err);
        delete state.networkRoomData._peerInitPromise; // Clear on error too
        // The onError callback within peerJsCallbacks should have handled _setupErrorCallback
        // if one was pending.
        throw err;
    }
}

export function hostNewRoom(hostPlayerData, gameSettings, isRandomMatchHost = false) {
    console.log("[PeerConn] hostNewRoom called. RandomHost:", isRandomMatchHost);
    state.resetNetworkRoomData();
    state.setPvpRemoteActive(true);

    return new Promise(async (resolve, reject) => {
        state.setNetworkRoomData({
            isRoomLeader: true,
            myPlayerIdInRoom: 0,
            gameSettings: { ...gameSettings },
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
            await ensurePeerInitialized();
            // The promise of hostNewRoom (resolve/reject) is handled by _finalizeHostSetup
            // (called either by ensurePeerInitialized directly or by onPeerOpen).
        } catch (err) {
            console.error("[PeerConn] hostNewRoom: Error from ensurePeerInitialized. _setupErrorCallback should have been called by onError.", err);
            // If reject wasn't called by _setupErrorCallback, call it here. But it should have.
            if (state.networkRoomData._setupErrorCallback) { /* It was already called by onError */ }
            else { reject(err); } // Fallback
        }
    });
}

export async function joinRoomById(leaderPeerIdToJoin, joinerPlayerData) {
    console.log(`[PeerConn] joinRoomById called for leader: ${leaderPeerIdToJoin}`);
    state.resetNetworkRoomData();
    state.setPvpRemoteActive(true);

    return new Promise(async (resolve, reject) => {
        state.setNetworkRoomData({
            roomId: leaderPeerIdToJoin,
            leaderPeerId: leaderPeerIdToJoin,
            isRoomLeader: false,
            players: [{
                peerId: null, name: joinerPlayerData.name,
                icon: joinerPlayerData.icon, color: joinerPlayerData.color,
            }],
            roomState: 'connecting_to_lobby',
            _setupCompleteCallback: resolve,
            _setupErrorCallback: reject
        });
        ui.showModalMessage(`Intentando conectar a la sala ${state.CAJITAS_PEER_ID_PREFIX}${leaderPeerIdToJoin}...`);

        try {
            await ensurePeerInitialized();
            // The promise of joinRoomById is handled by _finalizeClientJoinAttempt (direct or via onPeerOpen)
            // and then by onConnectionOpen (for client).
        } catch (err) {
            console.error(`[PeerConn] joinRoomById: Error from ensurePeerInitialized. _setupErrorCallback should have been handled.`, err);
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
            if (!connections.has(fromPeerId) || !connections.get(fromPeerId)?.player) {
                 console.warn(`[PeerConn L] PLAYER_READY_CHANGED from ${fromPeerId} but not in connections or no player data.`);
                 return;
            }
            const playerToUpdate = state.networkRoomData.players.find(p => p.peerId === fromPeerId);
            if (playerToUpdate) {
                playerToUpdate.isReady = data.isReady;
                state.setNetworkRoomData({players: [...state.networkRoomData.players]});
                broadcastToRoom({ type: MSG_TYPE.PLAYER_READY_CHANGED, playerId: playerToUpdate.id, peerId: fromPeerId, isReady: data.isReady });
                ui.updateLobbyUI();
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
                ui.showModalMessage("Error al unirse: tus datos no se encontraron en la sala.");
                if (state.networkRoomData._setupErrorCallback) state.networkRoomData._setupErrorCallback(new Error("My data not found in JOIN_ACCEPTED"));
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
            
            // Resolve joinRoomById's promise if it's still pending (already done in onConnectionOpen, but as a fallback)
             if (state.networkRoomData._setupCompleteCallback) {
                 console.log("[PeerConn C] JOIN_ACCEPTED: Resolving _setupCompleteCallback (fallback).");
                 state.networkRoomData._setupCompleteCallback(state.myPeerId);
                 delete state.networkRoomData._setupCompleteCallback;
                 delete state.networkRoomData._setupErrorCallback;
             }
            break;

        case MSG_TYPE.JOIN_REJECTED:
            ui.showModalMessage(`No se pudo unir: ${data.reason || 'Rechazado.'}`);
            if (state.networkRoomData._setupErrorCallback) { // If joinRoomById promise is pending
                state.networkRoomData._setupErrorCallback(new Error(data.reason || 'Join rejected by leader'));
            }
            leaveRoom(); // This also calls closePeerSession if needed
            break;

        case MSG_TYPE.PLAYER_JOINED:
            if (data.player.peerId !== state.myPeerId) {
                const existingPlayer = state.networkRoomData.players.find(p => p.peerId === data.player.peerId);
                if (!existingPlayer) state.addPlayerToNetworkRoom(data.player);
                else Object.assign(existingPlayer, data.player); // Update if rejoining/data change
                ui.updateLobbyMessage(`${data.player.name} se ha unido.`);
            }
            ui.updateLobbyUI();
            break;

        case MSG_TYPE.PLAYER_LEFT:
            // const leftPlayer = state.networkRoomData.players.find(p => p.id === data.playerId && p.peerId === data.peerId);
            state.removePlayerFromNetworkRoom(data.peerId); // Remove by peerId is more robust
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
                return; 
            }
            state.networkRoomData.turnCounter = data.turnCounter;
            gameLogic.applyRemoteMove(data.move, data.nextPlayerIndex, data.updatedScores);
            break;
        
        case MSG_TYPE.FULL_GAME_STATE:
            if (data.gameState.turnCounter < state.networkRoomData.turnCounter && state.networkRoomData.turnCounter !== 0 && data.gameState.turnCounter !== 0) return;
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
    // Clean up callbacks if they were related to a join attempt that just got an update
    if (data.type === MSG_TYPE.JOIN_ACCEPTED || data.type === MSG_TYPE.JOIN_REJECTED) {
        delete state.networkRoomData._setupCompleteCallback;
        delete state.networkRoomData._setupErrorCallback;
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
    if (idChangedOrPlayerRemoved) {
       console.log("[PeerConn] Player IDs reassigned or player removed. Broadcasting new room state.");
       broadcastRoomState();
    }
}

export function leaveRoom() {
    console.log("[PeerConn] Leaving room called...");
    ui.hideNetworkInfo();
    const currentRoomId = state.networkRoomData.roomId;
    const isCurrentlyLeader = state.networkRoomData.isRoomLeader;

    if (isCurrentlyLeader) {
        console.log("[PeerConn] Leader is leaving. Informing clients and unlisting.");
        broadcastToRoom({ type: MSG_TYPE.GAME_OVER_ANNOUNCEMENT, reason: 'leader_left', winnersData: {winners:[], isTie:false}, scores: [] });
        if (currentRoomId && state.myPeerId === currentRoomId) {
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
        }, 300);
    } else if (leaderConnection) {
        console.log("[PeerConn] Client is leaving. Closing connection to leader.");
        if (leaderConnection.open) {
          try { leaderConnection.close(); } catch (e) { console.warn("Error closing leader conn:", e); }
        }
    }
    leaderConnection = null;
    // State reset is handled by stopAnyActiveGameOrNetworkSession in main.js
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
        console.warn(`[PeerConn L] No open connection to client ${clientPeerId}. Cannot send. Entry:`, connEntry);
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
    if(typeof state.incrementTurnCounter === 'function') state.incrementTurnCounter(); else console.error("Missing incrementTurnCounter for game start");
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
    // ui.updateMessageArea("¡Juego iniciado! Tu turno.", false, 5000); // Let initializeGame handle this via updatePlayerTurnDisplay
}

export function sendGameMoveToLeader(type, r, c, boxesCompletedCount) {
    if (state.networkRoomData.isRoomLeader) return; // Should not happen
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
    // Reset local tracking
    leaderConnection = null;
    connections.clear();
    state.setMyPeerId(null); // Our peer ID is no longer valid
}

// Graceful disconnect on page unload
window.addEventListener('beforeunload', () => {
    if (state.pvpRemoteActive) {
        // If leader, try to inform Supabase this room is going down
        if (state.networkRoomData.isRoomLeader && state.networkRoomData.roomId) {
            matchmaking.leaveQueue(state.networkRoomData.roomId); // Unlist the room
        }
        // leaveRoom(); // May not have time to send messages gracefully
        closePeerSession(); // Destroy peer object immediately
    }
});