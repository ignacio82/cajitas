// matchmaking_supabase.js

import * as state from './state.js'; // For CAJITAS_PEER_ID_PREFIX

const SUPABASE_URL = "https://lunxhfsvlfyhqehpirdi.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1bnhoZnN2bGZ5aHFlaHBpcmRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgzMDMzMzMsImV4cCI6MjA2Mzg3OTMzM30.iKEnrtSVjwTQhB8OLahTANJzvCamR60bjhC6qvTtwxU";

let supabase = null;
const MATCHMAKING_TABLE = 'matchmaking_queue_cajitas';
const ROOM_EXPIRATION_MINUTES = 5;
const ROOM_REFRESH_INTERVAL_MS = 30 * 1000;

let localPlayerHostedRoomId_Supabase = null;
let hostRefreshIntervalId = null;
let refreshFailures = 0;

function initSupabase() {
    if (!supabase && window.supabase && typeof window.supabase.createClient === 'function') {
        try {
            supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            console.log('[Matchmaking] Supabase client initialized successfully.');
            return true;
        } catch (e) {
            console.error('[Matchmaking] Error during supabase.createClient:', e);
            supabase = null;
            return false;
        }
    } else if (supabase) {
        return true;
    }
    console.error('[Matchmaking] Supabase library not available.');
    return false;
}

function cleanupMatchmakingState() {
    console.log('[Matchmaking] Cleaning up matchmaking state.');
    if (hostRefreshIntervalId) {
        clearInterval(hostRefreshIntervalId);
        hostRefreshIntervalId = null;
    }
}

async function refreshRoomExpiration(roomIdToRefresh) {
    if (!supabase || !roomIdToRefresh) return;
    try {
        const newExpiration = new Date(Date.now() + ROOM_EXPIRATION_MINUTES * 60 * 1000).toISOString();
        const { error } = await supabase
            .from(MATCHMAKING_TABLE)
            .update({ expires_at: newExpiration })
            .eq('room_id', roomIdToRefresh);

        if (error) {
            refreshFailures++;
            console.warn(`[Matchmaking] Refresh failed (${refreshFailures}):`, error.message);
            if (refreshFailures >= 5) {
                console.warn('[Matchmaking] Too many refresh failures. Stopping interval.');
                clearInterval(hostRefreshIntervalId);
                hostRefreshIntervalId = null;
            }
        } else {
            refreshFailures = 0;
        }
    } catch (e) {
        console.error(`[Matchmaking] Exception during refreshRoomExpiration:`, e);
    }
}

async function cleanupStaleRooms() {
    if (!supabase) return;
    try {
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        const { data, error } = await supabase
            .from(MATCHMAKING_TABLE)
            .delete()
            .lt('expires_at', tenMinutesAgo);

        if (error) {
            console.warn('[Matchmaking] Error during stale room cleanup:', error.message);
        } else if (data && data.length > 0) {
            console.log(`[Matchmaking] Opportunistically cleaned up ${data.length} stale room(s).`);
        }
    } catch (e) {
        console.error('[Matchmaking] Exception during stale room cleanup:', e);
    }
}

/**
 * Removes a room from Supabase if the PeerJS host is found to be unavailable.
 * @param {string} deadPeerId - The raw PeerJS ID (without prefix) of the host whose room should be removed.
 */
export async function removeDeadRoomByPeerId(deadPeerId) {
  if (!supabase || !deadPeerId) {
    console.warn('[Matchmaking removeDeadRoomByPeerId] Supabase not init or deadPeerId missing.');
    return;
  }
  const deadRoomIdWithPrefix = `${state.CAJITAS_PEER_ID_PREFIX}${deadPeerId}`;
  console.log(`[Matchmaking removeDeadRoomByPeerId] Attempting to remove room: ${deadRoomIdWithPrefix} for dead peer: ${deadPeerId}`);
  try {
    const { data, error } = await supabase
      .from(MATCHMAKING_TABLE)
      .delete()
      .eq('room_id', deadRoomIdWithPrefix);

    if (error) {
      console.warn(`[Matchmaking removeDeadRoomByPeerId] Failed to clean up dead room ${deadRoomIdWithPrefix}:`, error.message);
    } else {
      if (data && data.length > 0) {
        console.log(`[Matchmaking removeDeadRoomByPeerId] Successfully cleaned up dead room: ${deadRoomIdWithPrefix}`);
      } else {
        console.log(`[Matchmaking removeDeadRoomByPeerId] No room found with ID ${deadRoomIdWithPrefix} to clean up, or it was already gone.`);
      }
    }
  } catch (e) {
    console.error(`[Matchmaking removeDeadRoomByPeerId] Exception while cleaning up dead room ${deadRoomIdWithPrefix}:`, e);
  }
}

export async function joinQueue(localRawPeerId, myPlayerData, preferences, callbacks) {
    console.log('[Matchmaking] joinQueue called. My PeerID (raw):', localRawPeerId, "Prefs:", preferences);
    if (!initSupabase()) {
        callbacks.onError?.('Supabase client no pudo ser inicializado.');
        return;
    }
    if (!localRawPeerId) {
        callbacks.onError?.('PeerJS ID es inválido para matchmaking.');
        return;
    }

    cleanupMatchmakingState();
    await cleanupStaleRooms();

    callbacks.onSearching?.();
    const localSupabasePeerId = `${state.CAJITAS_PEER_ID_PREFIX}${localRawPeerId}`;

    await leaveQueue(localRawPeerId, false); // Remove any existing listing for this peer before starting a new search/host

    try {
        console.log('[Matchmaking] Phase 1: Looking for existing, valid rooms...');

        const preferredMaxPlayers = Number(preferences.maxPlayers);
        if (isNaN(preferredMaxPlayers)) {
            callbacks.onError?.('Preferencia de maxPlayers inválida.');
            return;
        }

        const nowISO = new Date().toISOString();
        const { data: openRooms, error: fetchError } = await supabase
            .from(MATCHMAKING_TABLE)
            .select('*')
            .eq('status', 'hosting_waiting_for_players')
            .eq('game_type', 'cajitas')
            .lt('current_players', preferredMaxPlayers) // Room must have space
            .gte('max_players', preferredMaxPlayers) // Room must allow for at least preferredMaxPlayers
            .gt('expires_at', nowISO) // Room must not be expired
            .order('created_at', { ascending: true });

        if (fetchError) {
            console.error('[Matchmaking] Error fetching open rooms:', fetchError);
            callbacks.onError?.(`Error buscando salas: ${fetchError.message}`);
            return;
        }

        if (openRooms && openRooms.length > 0) {
            const suitableRoom = openRooms[0]; // Try the oldest suitable room
            console.log('[Matchmaking] Found suitable room to join:', suitableRoom);

            const leaderRawPeerId = suitableRoom.room_id.startsWith(state.CAJITAS_PEER_ID_PREFIX)
                ? suitableRoom.room_id.substring(state.CAJITAS_PEER_ID_PREFIX.length)
                : suitableRoom.room_id;

            // This callback will trigger peerConnection.joinRoomById(...)
            // If that join fails due to peer-unavailable, peerConnection.js should call removeDeadRoomByPeerId.
            callbacks.onMatchFoundAndJoiningRoom?.(
                suitableRoom.room_id, // This is the prefixed room_id from Supabase
                leaderRawPeerId,      // This is the raw peerId for PeerJS connection
                {
                    maxPlayers: suitableRoom.max_players,
                    gameSettings: suitableRoom.game_settings || preferences.gameSettings, // Fallback to user's preferred settings if not in DB
                    players: [], // Player list will be populated by the host
                    currentPlayers: suitableRoom.current_players // Info about current occupancy
                }
            );
            return; // Found a room, attempt to join is initiated by callback
        }

        // Phase 2: No suitable rooms found, become a host.
        console.log('[Matchmaking] Phase 2: No suitable rooms found. Becoming a host.');
        localPlayerHostedRoomId_Supabase = localSupabasePeerId; // Our own peer ID (prefixed) is the room_id

        const newRoomEntry = {
            peer_id: localSupabasePeerId, // Who owns this entry
            room_id: localSupabasePeerId, // The ID of the room (our PeerJS ID, prefixed)
            status: 'hosting_waiting_for_players',
            game_type: 'cajitas',
            max_players: preferences.maxPlayers,
            current_players: 1, // Starts with us, the host
            game_settings: preferences.gameSettings,
            expires_at: new Date(Date.now() + ROOM_EXPIRATION_MINUTES * 60 * 1000).toISOString()
        };

        const { error: insertError } = await supabase
            .from(MATCHMAKING_TABLE)
            .insert(newRoomEntry);

        if (insertError) {
            if (insertError.code === '23505') { // Unique constraint violation (e.g., room_id already exists)
                console.warn('[Matchmaking] Race condition or stale entry: Could not insert new room due to existing room_id. Consider re-queue.', insertError);
                callbacks.onError?.('Error al crear sala: la sala ya existe o hubo un conflicto. Intentá de nuevo.');
            } else {
                console.error('[Matchmaking] Error inserting new room:', insertError);
                callbacks.onError?.(`No se pudo crear una nueva sala: ${insertError.message}`);
            }
            localPlayerHostedRoomId_Supabase = null;
            return;
        }

        // Start refreshing the expiration time for the hosted room
        hostRefreshIntervalId = setInterval(() => {
            refreshRoomExpiration(localSupabasePeerId);
        }, ROOM_REFRESH_INTERVAL_MS);
        console.log(`[Matchmaking] Started refresh interval (ID: ${hostRefreshIntervalId}) for room ${localSupabasePeerId}`);

        callbacks.onMatchFoundAndHostingRoom?.(
            localRawPeerId, // Our raw peer ID to be used for hosting with PeerJS
            {
                maxPlayers: preferences.maxPlayers,
                gameSettings: preferences.gameSettings,
                players: [ // Initial player data for the host
                    { ...myPlayerData, id: 0, peerId: localRawPeerId, isReady: true, isConnected: true, score: 0 }
                ]
            }
        );

    } catch (error) {
        console.error('[Matchmaking] General exception in joinQueue:', error);
        callbacks.onError?.('Error general durante el matchmaking.');
    }
}

export async function leaveQueue(localRawPeerIdToLeave = null, performCleanup = true) {
    console.log(`[Matchmaking] leaveQueue called for PeerID (raw): ${localRawPeerIdToLeave}. Perform full cleanup: ${performCleanup}`);
    const peerIdToRemove = localRawPeerIdToLeave
        ? `${state.CAJITAS_PEER_ID_PREFIX}${localRawPeerIdToLeave}`
        : localPlayerHostedRoomId_Supabase;

    if (performCleanup) {
        cleanupMatchmakingState();
    } else if (hostRefreshIntervalId && peerIdToRemove === localPlayerHostedRoomId_Supabase) {
        // If not full cleanup, but we are leaving the room we were hosting via interval, clear that interval
        clearInterval(hostRefreshIntervalId);
        hostRefreshIntervalId = null;
        console.log(`[Matchmaking] Stopped refresh interval for ${peerIdToRemove} due to leaveQueue (not full cleanup).`);
    }


    if (peerIdToRemove && supabase) {
        console.log(`[Matchmaking] Removing Supabase entry for room/peer: ${peerIdToRemove}`);
        try {
            const { error } = await supabase
                .from(MATCHMAKING_TABLE)
                .delete()
                .eq('room_id', peerIdToRemove);

            if (error) {
                console.warn('[Matchmaking] Error removing entry from Supabase:', error.message);
            } else {
                console.log('[Matchmaking] Successfully removed entry from Supabase.');
            }
        } catch (error) {
            console.error('[Matchmaking] Exception during Supabase delete in leaveQueue:', error);
        }
    }

    if (peerIdToRemove === localPlayerHostedRoomId_Supabase) {
        localPlayerHostedRoomId_Supabase = null;
    }
}

export async function updateHostedRoomStatus(hostRawPeerId, gameSettings, maxPlayers, currentPlayers, newStatus = null) {
    if (!supabase || !hostRawPeerId) return;

    const hostSupabasePeerId = `${state.CAJITAS_PEER_ID_PREFIX}${hostRawPeerId}`;

    let statusToSet = newStatus;
    if (!statusToSet) { // If no explicit newStatus, determine based on game state
        if (state.networkRoomData.roomState === 'in_game') {
            statusToSet = 'in_game';
            // If the game starts and this client is the one who listed it for matchmaking, stop the refresh interval
            if (hostSupabasePeerId === localPlayerHostedRoomId_Supabase && hostRefreshIntervalId) {
                console.log(`[Matchmaking] Game started for room ${hostSupabasePeerId}. Stopping expiration refresh and setting status to 'in_game'.`);
                clearInterval(hostRefreshIntervalId);
                hostRefreshIntervalId = null;
                // Update status and remove expiration for 'in_game' rooms
                try {
                    await supabase.from(MATCHMAKING_TABLE)
                                  .update({ status: 'in_game', expires_at: null, current_players: currentPlayers })
                                  .eq('room_id', hostSupabasePeerId);
                    console.log(`[Matchmaking] Room ${hostSupabasePeerId} status set to 'in_game', expiration removed.`);
                    return; // Exit after this specific update for 'in_game'
                } catch(e) {
                    console.error("[Matchmaking] Error setting room to in_game:", e);
                    // Fall through to general update if this fails, though it ideally shouldn't.
                }
            }
        } else if (currentPlayers >= maxPlayers) {
            statusToSet = 'full';
        } else {
            statusToSet = 'hosting_waiting_for_players';
        }
    }

    const updatePayload = {
        current_players: currentPlayers,
        status: statusToSet,
        game_settings: gameSettings,
        max_players: maxPlayers
    };

    // If we are (re)listing as waiting_for_players, ensure expires_at is set/refreshed
    if (statusToSet === 'hosting_waiting_for_players') {
        updatePayload.expires_at = new Date(Date.now() + ROOM_EXPIRATION_MINUTES * 60 * 1000).toISOString();
        // If this is our hosted room and the interval wasn't running, start it
        if (hostSupabasePeerId === localPlayerHostedRoomId_Supabase && !hostRefreshIntervalId) {
            hostRefreshIntervalId = setInterval(() => {
                refreshRoomExpiration(hostSupabasePeerId);
            }, ROOM_REFRESH_INTERVAL_MS);
            console.log(`[Matchmaking] Restarted refresh interval for room ${hostSupabasePeerId} due to status update to waiting.`);
        }
    } else if (statusToSet === 'full' || statusToSet === 'in_game') {
        // If room becomes full or in_game, clear its expiration refresh interval if we were hosting it
        if (hostSupabasePeerId === localPlayerHostedRoomId_Supabase && hostRefreshIntervalId) {
            console.log(`[Matchmaking] Room ${hostSupabasePeerId} is now ${statusToSet}. Stopping expiration refresh.`);
            clearInterval(hostRefreshIntervalId);
            hostRefreshIntervalId = null;
            updatePayload.expires_at = null; // Explicitly nullify expiration for full/in_game rooms
        }
    }


    const { error } = await supabase
        .from(MATCHMAKING_TABLE)
        .update(updatePayload)
        .eq('room_id', hostSupabasePeerId);

    if (error) {
        console.error(`[Matchmaking] Error updating room ${hostSupabasePeerId} to status ${statusToSet}:`, error);
    } else {
        console.log(`[Matchmaking] Successfully updated room ${hostSupabasePeerId} status to ${statusToSet}. Players: ${currentPlayers}/${maxPlayers}`);
    }
}

console.log('[Matchmaking] Module loaded with expiration logic and dead room cleanup function.');