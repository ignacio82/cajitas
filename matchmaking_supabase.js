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

    await leaveQueue(localRawPeerId, false);

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
            .lt('current_players', preferredMaxPlayers)
            .gte('max_players', preferredMaxPlayers)
            .gt('expires_at', nowISO)
            .order('created_at', { ascending: true });

        if (fetchError) {
            console.error('[Matchmaking] Error fetching open rooms:', fetchError);
            callbacks.onError?.(`Error buscando salas: ${fetchError.message}`);
            return;
        }

        if (openRooms && openRooms.length > 0) {
            const suitableRoom = openRooms[0];
            console.log('[Matchmaking] Found suitable room to join:', suitableRoom);

            const leaderRawPeerId = suitableRoom.room_id.startsWith(state.CAJITAS_PEER_ID_PREFIX)
                ? suitableRoom.room_id.substring(state.CAJITAS_PEER_ID_PREFIX.length)
                : suitableRoom.room_id;

            callbacks.onMatchFoundAndJoiningRoom?.(
                suitableRoom.room_id,
                leaderRawPeerId,
                {
                    maxPlayers: suitableRoom.max_players,
                    gameSettings: suitableRoom.game_settings || preferences.gameSettings,
                    players: [],
                    currentPlayers: suitableRoom.current_players
                }
            );
            return;
        }

        console.log('[Matchmaking] Phase 2: No suitable rooms found. Becoming a host.');
        localPlayerHostedRoomId_Supabase = localSupabasePeerId;

        const newRoomEntry = {
            peer_id: localSupabasePeerId,
            room_id: localSupabasePeerId,
            status: 'hosting_waiting_for_players',
            game_type: 'cajitas',
            max_players: preferences.maxPlayers,
            current_players: 1,
            game_settings: preferences.gameSettings,
            expires_at: new Date(Date.now() + ROOM_EXPIRATION_MINUTES * 60 * 1000).toISOString()
        };

        const { error: insertError } = await supabase
            .from(MATCHMAKING_TABLE)
            .insert(newRoomEntry);

        if (insertError) {
            if (insertError.code === '23505') {
                console.warn('Race condition: Duplicate room. Restarting matchmaking.');
                callbacks.onError?.('Otro jugador se unió justo antes que tú. Intenta de nuevo.');
            } else {
                console.error('[Matchmaking] Error inserting new room:', insertError);
                callbacks.onError?.(`No se pudo crear una nueva sala: ${insertError.message}`);
            }
            localPlayerHostedRoomId_Supabase = null;
            return;
        }

        hostRefreshIntervalId = setInterval(() => {
            refreshRoomExpiration(localSupabasePeerId);
        }, ROOM_REFRESH_INTERVAL_MS);
        console.log(`[Matchmaking] Started refresh interval (ID: ${hostRefreshIntervalId}) for room ${localSupabasePeerId}`);

        callbacks.onMatchFoundAndHostingRoom?.(
            localRawPeerId,
            {
                maxPlayers: preferences.maxPlayers,
                gameSettings: preferences.gameSettings,
                players: [
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
    } else if (hostRefreshIntervalId) {
        clearInterval(hostRefreshIntervalId);
        hostRefreshIntervalId = null;
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
    if (!statusToSet) {
        if (state.networkRoomData.roomState === 'in_game') {
            statusToSet = 'in_game';
            if (hostSupabasePeerId === localPlayerHostedRoomId_Supabase && hostRefreshIntervalId) {
                console.log(`[Matchmaking] Game started. Stopping expiration refresh for ${hostSupabasePeerId}`);
                clearInterval(hostRefreshIntervalId);
                hostRefreshIntervalId = null;
                try {
                    await supabase.from(MATCHMAKING_TABLE).update({ status: 'in_game', expires_at: null, current_players: currentPlayers })
                                  .eq('room_id', hostSupabasePeerId);
                    return;
                } catch(e) {
                    console.error("Error setting room to in_game:", e);
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

    if (statusToSet === 'hosting_waiting_for_players') {
        updatePayload.expires_at = new Date(Date.now() + ROOM_EXPIRATION_MINUTES * 60 * 1000).toISOString();
    }

    const { error } = await supabase
        .from(MATCHMAKING_TABLE)
        .update(updatePayload)
        .eq('room_id', hostSupabasePeerId);

    if (error) {
        console.error(`[Matchmaking] Error updating room ${hostSupabasePeerId} to status ${statusToSet}:`, error);
    }
}

console.log('[Matchmaking] Module loaded with expiration logic.');
