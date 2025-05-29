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
    // Ensure this is only called once for a given setup attempt
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

    state.networkRoomData.players[0].peerId = hostPeerId; // Assign the confirmed peerId
    state.setNetworkRoomData({ // Update state with the final roomId and leaderPeerId
        roomId: hostPeerId,
        leaderPeerId: hostPeerId,
        players: [...state.networkRoomData.players] // Ensure the change to players[0].peerId is captured
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
        state.networkRoomData._setupCompleteCallback(hostPeerId); // Resolve the promise from hostNewRoom
    }
    // Clean up callbacks once used
    delete state.networkRoomData._setupCompleteCallback;
    delete state.networkRoomData._setupErrorCallback;
}

// Internal helper for client join attempt finalization (initiating connection)
function _finalizeClientJoinAttempt(myPeerId, leaderPeerIdToJoin) {
    console.log(`[PeerConn] _finalizeClientJoinAttempt: My PeerID ${myPeerId}, attempting to connect to ${leaderPeerIdToJoin}`);
    if (!state.networkRoomData._setupCompleteCallback && !state.networkRoomData._setupErrorCallback) {
        console.warn("[PeerConn] _finalizeClientJoinAttempt: No pending setup callbacks.");
        return;
    }
    if (state.networkRoomData.isRoomLeader || !leaderPeerIdToJoin || !state.pvpRemoteActive) {
        console.warn("[PeerConn] _finalizeClientJoinAttempt: Conditions not met for client join. IsLeader:", state.networkRoomData.isRoomLeader, "LeaderPID:", leaderPeerIdToJoin, "PvPActive:", state.pvpRemoteActive);
        if (state.networkRoomData._setupErrorCallback) {
            state.networkRoomData._setupErrorCallback(new Error("Client join conditions not met."));
        }
        delete state.networkRoomData._setupCompleteCallback;
        delete state.networkRoomData._setupErrorCallback;
        return;
    }

    if (state.networkRoomData.players && state.networkRoomData.players[0]) {
        if (state.networkRoomData.players[0].peerId !== myPeerId) {
            state.networkRoomData.players[0].peerId = myPeerId; // Set my peerId in my player template
            state.setNetworkRoomData({ players: [...state.networkRoomData.players] });
        }
    } else {
        const customData = state.getLocalPlayerCustomizationForNetwork();
        state.setNetworkRoomData({ players: [{ ...customData, peerId: myPeerId }] });
    }

    if (window.peerJsMultiplayer?.connect) {
        if (leaderConnection && leaderConnection.open && leaderConnection.peer === leaderPeerIdToJoin) {
            console.log("[PeerConn] _finalizeClientJoinAttempt: Already connected or connecting to leader. Letting onConnectionOpen handle further steps.");
             // If onConnectionOpen will resolve it, we might not need to here.
             // However, joinRoomById's promise should resolve indicating connection initiation.
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
            setupConnectionEventHandlers(leaderConnection, true); // true = is leader connection
            // The promise of joinRoomById resolves when the connection attempt is initiated.
            // Actual join success is confirmed by JOIN_ACCEPTED.
            if (state.networkRoomData._setupCompleteCallback) {
                state.networkRoomData._setupCompleteCallback(myPeerId); // Resolve joinRoomById promise
                // Callbacks will be deleted by onConnectionOpen or onError after this for join.
            }
        } else {
            console.error(`[PeerConn] _finalizeClientJoinAttempt: peer.connect() returned null when trying to connect to ${leaderPeerIdToJoin}.`);
            // Call global error handler which will use _setupErrorCallback
            peerJsCallbacks.onError({ type: 'connect_failed', message: `Failed to initiate connection to ${leaderPeerIdToJoin} (connect returned null).` });
        }
    } else {
        peerJsCallbacks.onError({ type: 'connect_error', message: 'PeerJS connect function not available.' });
    }
}


const peerJsCallbacks = {
    onPeerOpen: (id) => {
        console.log(`[PeerConn] Global onPeerOpen triggered with ID: ${id}.`);
        const oldPeerId = state.myPeerId;
        state.setMyPeerId(id); // Set our peer ID in the global state

        // Resolve the promise from initPeerObject if it's pending
        if (state.networkRoomData._peerInitResolve) {
            console.log(`[PeerConn] Global onPeerOpen: Resolving _peerInitResolve for ID ${id}`);
            state.networkRoomData._peerInitResolve(id);
            delete state.networkRoomData._peerInitResolve;
            delete state.networkRoomData._peerInitReject;
        }

        // This peer object has just opened. Check if a high-level setup (host/join) was waiting for this.
        // The _setupCompleteCallback is set by hostNewRoom/joinRoomById.
        if (state.networkRoomData._setupCompleteCallback) {
            console.log(`[PeerConn] Global onPeerOpen: Pending setup found (_setupCompleteCallback exists).`);
            if (state.networkRoomData.isRoomLeader &&
                (state.networkRoomData.roomState === 'waiting_for_players' || state.networkRoomData.roomState === 'creating_random_match_room')) {
                console.log("[PeerConn] onPeerOpen: Finalizing host setup because a new peer object just opened.");
                _finalizeHostSetup(id); // Pass the newly opened ID
            } else if (!state.networkRoomData.isRoomLeader && state.networkRoomData.leaderPeerId && state.pvpRemoteActive) {
                console.log("[PeerConn] onPeerOpen: Finalizing client join because a new peer object just opened.");
                _finalizeClientJoinAttempt(id, state.networkRoomData.leaderPeerId); // Pass my new ID and leader's ID
            } else {
                console.log("[PeerConn] onPeerOpen: _setupCompleteCallback exists, but current state doesn't match host/join finalization criteria here. State:", JSON.parse(JSON.stringify(state.networkRoomData)));
                 // This might indicate a logic mismatch or an unexpected state.
                 // If _setupCompleteCallback exists, it should ideally be consumed by a finalization path.
                 // Consider if an error state should be triggered if no path consumes it.
            }
        } else {
            console.log(`[PeerConn] Global onPeerOpen: Peer ${id} opened. No pending _setupCompleteCallback. PvP Active: ${state.pvpRemoteActive}.`);
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
        // Max players check should account for leader + current clients + new connection
        if (state.networkRoomData.players.length >= state.networkRoomData.maxPlayers && !connections.has(conn.peer)) {
             console.warn(`[PeerJS] Room is full (Players in room: ${state.networkRoomData.players.length} / Max: ${state.networkRoomData.maxPlayers}). Rejecting ${conn.peer}.`);
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

    onConnectionOpen: (peerId) => { // peerId is the remote peer whose connection opened
        console.log(`[PeerJS] Data connection now open with ${peerId}.`);
        if (state.networkRoomData.isRoomLeader) {
            // This means a client's DataConnection to us (leader) is now open.
            // The client should send REQUEST_JOIN_ROOM.
            console.log(`[PeerConn] Leader: Connection from client ${peerId} is now open. Waiting for their JOIN_REQUEST.`);
            const connEntry = connections.get(peerId);
            if (connEntry) {
                connections.set(peerId, { ...connEntry, status: 'awaiting_join_request' });
            }
        } else { // This is the client's perspective
            if (peerId === state.networkRoomData.leaderPeerId && leaderConnection && leaderConnection.open) {
                console.log(`[PeerConn] Client: Connection to leader ${peerId} fully open. Sending JOIN_REQUEST.`);
                const myPlayerDataForJoin = state.getLocalPlayerCustomizationForNetwork(); // Fetches from UI
                // Ensure our local player template has our peerId before sending.
                // state.myPeerId should be set by ensurePeerInitialized.
                if (state.networkRoomData.players && state.networkRoomData.players[0]) {
                    state.networkRoomData.players[0].peerId = state.myPeerId;
                }

                if (myPlayerDataForJoin && state.myPeerId) {
                     sendDataToLeader({
                        type: MSG_TYPE.REQUEST_JOIN_ROOM,
                        playerData: { // Send my customized data
                            name: myPlayerDataForJoin.name,
                            icon: myPlayerDataForJoin.icon,
                            color: myPlayerDataForJoin.color,
                            // peerId: state.myPeerId // Leader knows sender's peerId
                        }
                    });
                    state.setNetworkRoomData({ roomState: 'awaiting_join_approval' });
                    ui.showModalMessage(`Conectado al líder. Esperando aprobación para unirse a la sala...`);

                    // If joinRoomById's promise is still pending, resolve it now.
                    if (state.networkRoomData._setupCompleteCallback) {
                        console.log("[PeerConn] Client onConnectionOpen to leader: Resolving _setupCompleteCallback for joinRoomById.");
                        state.networkRoomData._setupCompleteCallback(state.myPeerId);
                        delete state.networkRoomData._setupCompleteCallback;
                        delete state.networkRoomData._setupErrorCallback;
                    }

                } else {
                    console.error("[PeerConn] Client onConnectionOpen: Cannot send JOIN_REQUEST. Missing player data or myPeerId.", myPlayerDataForJoin, state.myPeerId);
                    peerJsCallbacks.onError({type: 'internal_error', message: 'Player data for join request missing locally.'});
                }
            } else {
                 console.warn(`[PeerConn] Client onConnectionOpen: Opened connection with ${peerId}, but expected leader ${state.networkRoomData.leaderPeerId} or leaderConnection issue. LC open: ${leaderConnection?.open}`);
            }
        }
    },
    onDataReceived,
    onConnectionClose,
    onError
};

// Lower-level Peer object initialization
function initPeerObject(peerIdToUse = null, options = {}) {
    return new Promise((resolve, reject) => {
        // Check if peerJsMultiplayer and init method exist
        if (window.peerJsMultiplayer && typeof window.peerJsMultiplayer.init === 'function') {
            // Store these promise handlers in state, so global onPeerOpen can use them
            state.setNetworkRoomData({
                _peerInitResolve: resolve, // For this specific initPeerObject call
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

// Ensures PeerJS is initialized and returns a promise that resolves with the Peer ID.
// This function now also triggers finalization of pending host/join ops if peer already open.
export async function ensurePeerInitialized() {
    const existingPeer = window.peerJsMultiplayer?.getPeer();
    let currentPeerId = window.peerJsMultiplayer?.getLocalId(); // May be null if connecting

    if (existingPeer && !existingPeer.destroyed && currentPeerId) {
        console.log("[PeerConn] ensurePeerInitialized: PeerJS already initialized and open. My ID:", currentPeerId);
        if (state.myPeerId !== currentPeerId) { // Sync global state if needed
            state.setMyPeerId(currentPeerId);
        }

        // If peer is already open, and a setup operation (host/join) is pending, finalize it now.
        if (state.networkRoomData._setupCompleteCallback) { // Indicates hostNewRoom or joinRoomById is waiting
            console.log("[PeerConn] ensurePeerInitialized (already open): Pending setup found. Attempting direct finalization.");
            if (state.networkRoomData.isRoomLeader) {
                _finalizeHostSetup(currentPeerId);
            } else if (!state.networkRoomData.isRoomLeader && state.networkRoomData.leaderPeerId) {
                _finalizeClientJoinAttempt(currentPeerId, state.networkRoomData.leaderPeerId);
            }
        }
        return currentPeerId; // Resolve with the existing ID
    }

    if (existingPeer && !existingPeer.destroyed && !currentPeerId) {
        // Peer object exists but is still trying to get an ID (e.g. connecting to PeerServer)
        console.warn("[PeerConn] ensurePeerInitialized: Peer object exists but ID is null (PeerServer connection pending). Waiting for 'open' via its promise.");
        if (state.networkRoomData._peerInitPromise) {
            return state.networkRoomData._peerInitPromise; // Return the promise of the ongoing initialization
        }
        // If somehow _peerInitPromise is not set, we might need to re-init or it's an odd state.
        // Forcing a new init might be problematic if one is truly in progress.
        // This path implies that initPeerObject was called, but onPeerOpen hasn't fired yet.
        // The promise stored by initPeerObject is the one to await.
        console.error("[PeerConn] ensurePeerInitialized: Peer connecting, but no _peerInitPromise found. This is unexpected. Attempting new init.");
        // Fall through to new initialization, but this is a recovery attempt.
    }

    console.log("[PeerConn] ensurePeerInitialized: Initializing new PeerJS instance or awaiting existing init promise.");
    try {
        // Store the promise from initPeerObject. If initPeerObject is called multiple times
        // while the first is still pending, they should all await the same underlying promise.
        // However, our _peerInitResolve/Reject are global for simplicity, so rapid calls might interfere.
        // A better approach would be for initPeerObject to manage its promise locally if re-entrant.
        // For now, assuming ensurePeerInitialized is not called in rapid succession before resolution.
        if (!state.networkRoomData._peerInitPromise) { // Only create new init promise if one isn't already pending
            state.networkRoomData._peerInitPromise = initPeerObject();
        }
        const newPeerId = await state.networkRoomData._peerInitPromise;
        delete state.networkRoomData._peerInitPromise; // Clear once resolved/rejected

        console.log("[PeerConn] ensurePeerInitialized: PeerJS initialization completed. ID:", newPeerId);
        // Global onPeerOpen (called via initPeerObject) should have:
        // 1. Set state.myPeerId.
        // 2. If _setupCompleteCallback was present (from hostNewRoom/joinRoomById), it called _finalizeHostSetup or _finalizeClientJoinAttempt.
        return newPeerId;
    } catch (err) {
        console.error("[PeerConn] ensurePeerInitialized: Error during new PeerJS initialization.", err);
        delete state.networkRoomData._peerInitPromise;
        if (state.networkRoomData._setupErrorCallback) { // If this init was part of a larger setup
            state.networkRoomData._setupErrorCallback(err); // Reject the hostNewRoom/joinRoomById promise
            delete state.networkRoomData._setupCompleteCallback;
            delete state.networkRoomData._setupErrorCallback;
        }
        throw err; // Re-throw for the caller of ensurePeerInitialized
    }
}

export function hostNewRoom(hostPlayerData, gameSettings, isRandomMatchHost = false) {
    console.log("[PeerConn] hostNewRoom called. RandomHost:", isRandomMatchHost);
    state.resetNetworkRoomData(); // Resets callbacks, roomId, etc.
    state.setPvpRemoteActive(true);

    return new Promise(async (resolve, reject) => {
        state.setNetworkRoomData({
            isRoomLeader: true,
            myPlayerIdInRoom: 0, // Leader is player 0
            gameSettings: { ...gameSettings },
            maxPlayers: gameSettings.maxPlayers,
            players: [{ // Template for the host
                id: 0, peerId: null, /* will be set by _finalizeHostSetup */
                name: hostPlayerData.name, icon: hostPlayerData.icon,
                color: hostPlayerData.color, isReady: true, /* Leader is implicitly ready */
                isConnected: true, score: 0
            }],
            roomState: isRandomMatchHost ? 'creating_random_match_room' : 'waiting_for_players',
            _setupCompleteCallback: resolve, // Promise for hostNewRoom itself
            _setupErrorCallback: reject
        });

        ui.showModalMessage("Creando sala de juego...");

        try {
            await ensurePeerInitialized();
            console.log("[PeerConn] hostNewRoom: ensurePeerInitialized completed. Host ID should be set in state now:", state.myPeerId);
            // If peer was already open, ensurePeerInitialized-> _finalizeHostSetup should have resolved/rejected.
            // If peer was new, onPeerOpen -> _finalizeHostSetup should have resolved/rejected.
            // So, the promise (resolve/reject) is handled internally by those paths.
        } catch (err) {
            console.error("[PeerConn] hostNewRoom: Error from ensurePeerInitialized. The _setupErrorCallback should have been called.", err);
            // No need to call reject(err) here if _setupErrorCallback did it.
            // ui.hideModalMessage(); // Error handler might do this
            // stopAnyActiveGameOrNetworkSession(); // Main.js will likely call this on catch
        }
    });
}

export async function joinRoomById(leaderPeerIdToJoin, joinerPlayerData) {
    console.log(`[PeerConn] joinRoomById called for leader: ${leaderPeerIdToJoin}`);
    state.resetNetworkRoomData();
    state.setPvpRemoteActive(true);

    return new Promise(async (resolve, reject) => {
        state.setNetworkRoomData({
            roomId: leaderPeerIdToJoin, // Actual PeerID of the leader
            leaderPeerId: leaderPeerIdToJoin,
            isRoomLeader: false,
            players: [{ // Placeholder for self, peerId will be set
                peerId: null, name: joinerPlayerData.name,
                icon: joinerPlayerData.icon, color: joinerPlayerData.color,
            }],
            roomState: 'connecting_to_lobby',
            _setupCompleteCallback: resolve, // For this joinRoomById promise
            _setupErrorCallback: reject
        });
        ui.showModalMessage(`Intentando conectar a la sala ${state.CAJITAS_PEER_ID_PREFIX}${leaderPeerIdToJoin}...`);

        try {
            await ensurePeerInitialized();
            console.log(`[PeerConn] joinRoomById: ensurePeerInitialized completed. My ID: ${state.myPeerId}. Attempting connection to leader.`);
            // If peer was already open, ensurePeerInitialized -> _finalizeClientJoinAttempt handled connection.
            // If peer was new, onPeerOpen -> _finalizeClientJoinAttempt handled connection.
            // The promise (resolve/reject) is handled by those paths, typically resolved upon connection attempt or error.
            // onConnectionOpen with the leader will send JOIN_REQUEST.
        } catch (err) {
            console.error(`[PeerConn] joinRoomById: Error from ensurePeerInitialized. _setupErrorCallback should have been called.`, err);
        }
    });
}

function handleLeaderDataReception(data, fromPeerId) {
    const connEntryWrapper = connections.get(fromPeerId);
    const connToUse = connEntryWrapper?.connObject;

    if (!connToUse && data.type !== MSG_TYPE.REQUEST_JOIN_ROOM) {
        console.warn(`[PeerConn L] Data from ${fromPeerId} but no active connection object found or not open. Type: ${data.type}. Ignored. Conn Entry:`, connEntryWrapper);
        return;
    }

    switch (data.type) {
        case MSG_TYPE.REQUEST_JOIN_ROOM:
            const newClientConn = window.peerJsMultiplayer.getConnection(fromPeerId); // Get the actual conn obj from the wrapper
            const actualConnObjectForJoin = newClientConn || connToUse; // Fallback if connToUse was from the initial map
             if (!actualConnObjectForJoin) {
                console.warn(`[PeerConn L] REQUEST_JOIN_ROOM from ${fromPeerId} but no connection object found. Ignoring.`);
                // Optionally send a rejection if a way to communicate exists
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
                console.log(`[PeerConn L] Player ${data.playerData.name} requested color ${requestedColor} (taken). Assigning ${assignedColor}.`);
            }
            
            const newPlayerId = state.networkRoomData.players.length; // Simple incremental ID for new player
            const newPlayer = {
                id: newPlayerId, // This is their playerIndex in game
                peerId: fromPeerId,
                name: data.playerData.name,
                icon: data.playerData.icon,
                color: assignedColor,
                isReady: false,
                isConnected: true, // They've established a data connection
                score: 0
            };
            state.addPlayerToNetworkRoom(newPlayer); // Add to state.networkRoomData.players
            // Update the connections map with the player info and ensure status is active
            connections.set(fromPeerId, { connObject: actualConnObjectForJoin, player: newPlayer, status: 'active' });


            sendDataToClient(fromPeerId, {
                type: MSG_TYPE.JOIN_ACCEPTED,
                yourPlayerId: newPlayerId, // Their assigned ID in the room
                roomData: state.getSanitizedNetworkRoomDataForClient(), // Send current room state (includes all players)
                yourAssignedColor: assignedColor,
                colorChanged: colorWasChanged
            });

            // Broadcast to OTHERS that a new player joined
            broadcastToRoom({ type: MSG_TYPE.PLAYER_JOINED, player: newPlayer }, fromPeerId); // Exclude the new player themselves

            ui.updateLobbyUI(); // Update leader's UI
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
                state.setNetworkRoomData({players: [...state.networkRoomData.players]}); // Persist change
                // Broadcast the change to all clients (including the one who sent it, for consistency if needed)
                broadcastToRoom({
                    type: MSG_TYPE.PLAYER_READY_CHANGED,
                    playerId: playerToUpdate.id, // Use the player's game ID
                    peerId: fromPeerId,
                    isReady: data.isReady
                });
                ui.updateLobbyUI(); // Update leader's UI
            }
            break;

        case MSG_TYPE.GAME_MOVE:
            if (!connections.has(fromPeerId) || !connections.get(fromPeerId)?.player) {
                console.warn(`[PeerConn L] GAME_MOVE from peer ${fromPeerId} not in active connections map/no player data. Ignored.`);
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
                gameLogic.processMove(data.move.type, data.move.r, data.move.c, movingPlayer.id, false, true); // isLeaderProcessing = true
                const boxesCompletedThisTurn = state.filledBoxesCount - boxesBefore;

                broadcastToRoom({
                    type: MSG_TYPE.GAME_MOVE,
                    move: { ...data.move, playerIndex: movingPlayer.id, boxesJustCompleted: boxesCompletedThisTurn },
                    turnCounter: state.networkRoomData.turnCounter,
                    nextPlayerIndex: state.currentPlayerIndex, // This is state.currentPlayerIndex after gameLogic.processMove
                    updatedScores: state.playersData.map(p => ({id: p.id, score: p.score})),
                });

                // Update leader's own board clickability
                const isStillLeaderTurn = state.currentPlayerIndex === state.networkRoomData.myPlayerIdInRoom;
                ui.setBoardClickable(isStillLeaderTurn && state.gameActive);

                if (!state.gameActive && state.networkRoomData.roomState !== 'game_over') { // Game ended
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
                console.error("[PeerConn C] JOIN_ACCEPTED but my player data not found in received roomData. My assigned ID:", data.yourPlayerId);
                ui.showModalMessage("Error al unirse: no se encontraron tus datos en la sala.");
                leaveRoom(); // This should also trigger cleanup via stopAnyActiveGameOrNetworkSession
                return;
            }

            const localPlayerCustomization = state.getLocalPlayerCustomizationForNetwork(); // My current name/icon from UI
            myAssignedData.name = localPlayerCustomization.name;
            myAssignedData.icon = localPlayerCustomization.icon;
            myAssignedData.color = data.yourAssignedColor; // Use color assigned by leader
            myAssignedData.peerId = state.myPeerId; // Ensure my peerId is correct in my own player object

            state.setNetworkRoomData({
                myPlayerIdInRoom: data.yourPlayerId,
                gameSettings: data.roomData.gameSettings,
                maxPlayers: data.roomData.maxPlayers,
                roomState: 'lobby',
                leaderPeerId: data.roomData.leaderPeerId || state.networkRoomData.leaderPeerId,
                roomId: data.roomData.roomId || state.networkRoomData.roomId,
                players: data.roomData.players // This list includes me with my new ID and assigned color
            });


            if (data.colorChanged) {
                console.log(`[PeerConn C] Server assigned different color: ${data.yourAssignedColor}.`);
                const colorInput = document.getElementById('player-color-0');
                if (colorInput) {
                    colorInput.value = data.yourAssignedColor;
                    colorInput.dispatchEvent(new Event('input', { bubbles: true }));
                }
                 ui.updateLobbyMessage(`¡Te uniste a la sala! Tu color fue cambiado a ${data.yourAssignedColor}.`);
            } else {
                ui.updateLobbyMessage("¡Te uniste a la sala! Marcate como listo cuando quieras.");
            }
            
            ui.showLobbyScreen();
            ui.updateLobbyUI();
            ui.updateGameModeUI();
            console.log(`[PeerConn C] Joined room! My Player ID in room: ${data.yourPlayerId}. My Color: ${data.yourAssignedColor}. Full Room Data:`, JSON.parse(JSON.stringify(state.networkRoomData)));
            
            // Resolve joinRoomById's promise if it's still pending and callbacks are present
             if (state.networkRoomData._setupCompleteCallback) {
                 console.log("[PeerConn C] JOIN_ACCEPTED: Resolving _setupCompleteCallback for joinRoomById.");
                 state.networkRoomData._setupCompleteCallback(state.myPeerId);
                 delete state.networkRoomData._setupCompleteCallback;
                 delete state.networkRoomData._setupErrorCallback;
             }
            break;

        case MSG_TYPE.JOIN_REJECTED:
            ui.showModalMessage(`No se pudo unir a la sala: ${data.reason || 'Rechazado por el líder.'}`);
            if (state.networkRoomData._setupErrorCallback) { // If joinRoomById promise is pending
                state.networkRoomData._setupErrorCallback(new Error(data.reason || 'Join rejected'));
                delete state.networkRoomData._setupCompleteCallback;
                delete state.networkRoomData._setupErrorCallback;
            }
            leaveRoom(); // This also calls closePeerSession if needed
            break;

        case MSG_TYPE.PLAYER_JOINED: // Another player joined the room
            if (data.player.peerId !== state.myPeerId) { // If it's not me
                 const existingPlayer = state.networkRoomData.players.find(p => p.peerId === data.player.peerId);
                 if (!existingPlayer) {
                    state.addPlayerToNetworkRoom(data.player); // Add new player to local list
                 } else { // Player reconnected or data updated
                    Object.assign(existingPlayer, data.player);
                    state.setNetworkRoomData({ players: [...state.networkRoomData.players] }); // Ensure reactivity
                 }
                 ui.updateLobbyMessage(`${data.player.name} se ha unido a la sala.`);
            }
            ui.updateLobbyUI(); // Update display for all clients
            break;

        case MSG_TYPE.PLAYER_LEFT:
            const leftPlayer = state.networkRoomData.players.find(p => p.id === data.playerId && p.peerId === data.peerId);
            if (leftPlayer) {
                state.removePlayerFromNetworkRoom(data.peerId); // Remove by peerId
                ui.updateLobbyMessage(`${data.playerName || 'Un jugador'} ha salido de la sala.`);
            } else {
                state.removePlayerFromNetworkRoom(data.peerId); // Still try to remove if only peerId matches
                 ui.updateLobbyMessage(`${data.playerName || 'Un jugador'} (ID ${data.peerId?.slice(-4)}) ha salido.`);
            }
            ui.updateLobbyUI();
            break;

        case MSG_TYPE.ROOM_STATE_UPDATE: // Full room state update from leader
            const myNewDataInRoom = data.roomData.players.find(p => p.peerId === state.myPeerId);
            const myNewPlayerId = myNewDataInRoom ? myNewDataInRoom.id : state.networkRoomData.myPlayerIdInRoom;

            state.setNetworkRoomData({
                players: data.roomData.players,
                gameSettings: data.roomData.gameSettings,
                maxPlayers: data.roomData.maxPlayers,
                myPlayerIdInRoom: myNewPlayerId,
                leaderPeerId: data.roomData.leaderPeerId || state.networkRoomData.leaderPeerId,
                roomId: data.roomData.roomId || state.networkRoomData.roomId,
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
            state.setNetworkRoomData({ roomState: 'in_game' });

            state.setPlayersData(data.initialGameState.playersInGameOrder);
            state.setGameDimensions(data.initialGameState.gameSettings.rows, data.initialGameState.gameSettings.cols);
            state.setCurrentPlayerIndex(data.initialGameState.startingPlayerIndex);
            state.networkRoomData.turnCounter = data.initialGameState.turnCounter;

            gameLogic.initializeGame(true); // true for remote game
            ui.showGameScreen();
            ui.updateMessageArea("¡El juego ha comenzado!", false, 5000);
            break;

        case MSG_TYPE.GAME_MOVE:
            // console.log("[PeerConn C] Client received GAME_MOVE:", data);
            if (data.turnCounter < state.networkRoomData.turnCounter && state.networkRoomData.turnCounter !== 0 && data.move.playerIndex !== state.networkRoomData.myPlayerIdInRoom) {
                console.warn(`[PeerConn C] Stale/duplicate game_move. RX TC: ${data.turnCounter}, My TC: ${state.networkRoomData.turnCounter}. Ignored.`);
                return;
            }
            state.networkRoomData.turnCounter = data.turnCounter;
            gameLogic.applyRemoteMove(data.move, data.nextPlayerIndex, data.updatedScores);
            break;
        
        case MSG_TYPE.FULL_GAME_STATE: 
             if (data.gameState.turnCounter < state.networkRoomData.turnCounter && state.networkRoomData.turnCounter !== 0 && data.gameState.turnCounter !== 0) {
                console.warn(`[PeerConn C] Stale full_game_state. RX TC: ${data.gameState.turnCounter}, My TC: ${state.networkRoomData.turnCounter}. Ignored.`);
                return;
            }
            console.log("[PeerConn C] Applying full game state from leader.");
            gameLogic.applyFullState(data.gameState);
            state.networkRoomData.turnCounter = data.gameState.turnCounter;
            state.setNetworkRoomData({ roomState: data.gameState.gameActive ? 'in_game' : 'game_over' });
            if(state.networkRoomData.roomState === 'in_game') ui.showGameScreen();
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
            ui.updateScoresDisplay();
            ui.setBoardClickable(false);
            break;
    }
}

function reassignPlayerIdsAndBroadcastUpdate() {
    if (!state.networkRoomData.isRoomLeader) return;
    const currentPlayers = state.networkRoomData.players.filter(p => {
        if (p.peerId === state.myPeerId) return true; // Leader is always considered connected
        const conn = connections.get(p.peerId);
        return conn && (conn.connObject?.open || conn.open); // Check actual PeerJS connection object
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
        if (currentRoomId && state.myPeerId === currentRoomId) { // Ensure it's the leader's own ID
            matchmaking.leaveQueue(currentRoomId);
        }
        setTimeout(() => { // Allow messages to send
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

    // Note: Actual reset of state (resetNetworkRoomData, setPvpRemoteActive(false))
    // is typically handled by stopAnyActiveGameOrNetworkSession in main.js,
    // which calls this leaveRoom function.
    // closePeerSession is also handled by stopAnyActiveGameOrNetworkSession.
}

export function handleLeaderLocalMove(moveDetails, boxesCompletedCount) {
    if (!state.networkRoomData.isRoomLeader) {
         console.warn("[PeerConn] handleLeaderLocalMove called, but not leader. Ignoring.");
         return;
    }
    const leaderPlayerId = state.networkRoomData.myPlayerIdInRoom;
    if (leaderPlayerId === null || leaderPlayerId === undefined) { // Should be 0 for leader
        console.error("[PeerConn] Leader's myPlayerIdInRoom is not set. Aborting move broadcast.");
        return;
    }
    
    if(typeof state.incrementTurnCounter === 'function') {
        state.incrementTurnCounter();
    } else {
        console.error("[PeerConn] FATAL: state.incrementTurnCounter is not a function!");
        return;
    }

    const gameMoveMessage = {
        type: MSG_TYPE.GAME_MOVE,
        move: {
            ...moveDetails,
            playerIndex: leaderPlayerId,
            boxesJustCompleted: boxesCompletedCount
        },
        turnCounter: state.networkRoomData.turnCounter,
        nextPlayerIndex: state.currentPlayerIndex,
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
        console.warn("[PeerConn C] No open connection to leader or connection object invalid. Cannot send data.", data, "Leader Conn State:", leaderConnection);
         peerJsCallbacks.onError({type: 'send_error_no_connection', message: 'No open connection to leader to send data.'});
    }
}

function sendDataToClient(clientPeerId, data) {
    const connEntry = connections.get(clientPeerId);
    const conn = connEntry?.connObject; // Use the actual PeerJS connection object
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
        roomData: state.getSanitizedNetworkRoomDataForClient() // Send sanitized data
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
        ui.updateLobbyMessage("No se puede iniciar: no todos los jugadores están listos o conectados.", true);
        return;
    }
    
    ui.hideNetworkInfo();
    state.setNetworkRoomData({ roomState: 'in_game' });
    state.setGameDimensions(state.networkRoomData.gameSettings.rows, state.networkRoomData.gameSettings.cols);
    
    const playersForGame = [...state.networkRoomData.players]
        .sort((a,b) => (a.id || 0) - (b.id || 0))
        .map(p => ({
            id: p.id, name: p.name, icon: p.icon, color: p.color, score: 0, peerId: p.peerId
        }));
    
    state.setPlayersData(playersForGame);
    state.setCurrentPlayerIndex(0); // Leader (player 0) starts
    if(typeof state.incrementTurnCounter === 'function') state.incrementTurnCounter(); else console.error("Missing incrementTurnCounter for game start");
    state.networkRoomData.turnCounter = 1; // Game starts at turn 1

    gameLogic.initializeGame(true);
    ui.showGameScreen();

    matchmaking.leaveQueue(state.networkRoomData.roomId); // Unlist from matchmaking

    broadcastToRoom({
        type: MSG_TYPE.GAME_STARTED,
        initialGameState: {
            playersInGameOrder: playersForGame,
            gameSettings: state.networkRoomData.gameSettings,
            startingPlayerIndex: state.currentPlayerIndex,
            turnCounter: state.networkRoomData.turnCounter
        }
    });
    // Leader's turn display will be handled by ui.updatePlayerTurnDisplay via initializeGame.
    // ui.updateMessageArea("¡Juego iniciado! Tu turno.", false, 5000); // Redundant if initializeGame handles it
}

export function sendGameMoveToLeader(type, r, c, boxesCompletedCount) {
    if (state.networkRoomData.isRoomLeader) {
        console.error("Leader logic error: sendGameMoveToLeader called.");
        return;
    }
    sendDataToLeader({
        type: MSG_TYPE.GAME_MOVE,
        move: { type, r, c, playerIndex: state.networkRoomData.myPlayerIdInRoom, boxesJustCompleted: boxesCompletedCount }
    });
}

function setupConnectionEventHandlers(conn, isLeaderConn = false) {
    conn.on('open', () => {
        peerJsCallbacks.onConnectionOpen(conn.peer); // remote peer ID
    });
    conn.on('data', (data) => {
        peerJsCallbacks.onDataReceived(data, conn.peer);
    });
    conn.on('close', () => {
        peerJsCallbacks.onConnectionClose(conn.peer);
    });
    conn.on('error', (err) => {
        peerJsCallbacks.onError(err, conn.peer); // Pass context
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
    state.setMyPeerId(null); // Clear our own peer ID as the session is closed
}

window.addEventListener('beforeunload', () => {
    if (state.pvpRemoteActive) {
        if (state.networkRoomData.isRoomLeader && state.networkRoomData.roomId) {
            matchmaking.leaveQueue(state.networkRoomData.roomId); // Unlist the room
        }
        // leaveRoom(); // May not have time to send messages
        closePeerSession(); // Destroy peer object immediately
    }
});