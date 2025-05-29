// matchmaking_supabase.js

import * as state from './state.js'; // For CAJITAS_PEER_ID_PREFIX

const SUPABASE_URL = "https://lunxhfsvlfyhqehpirdi.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1bnhoZnN2bGZ5aHFlaHBpcmRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgzMDMzMzMsImV4cCI6MjA2Mzg3OTMzM30.iKEnrtSVjwTQhB8OLahTANJzvCamR60bjhC6qvTtwxU";

let supabase = null;
const MATCHMAKING_TABLE = 'matchmaking_queue_cajitas'; // Ensure this table matches the new schema

// To keep track of the current player's Supabase entry if they are hosting
let localPlayerHostedRoomId_Supabase = null; // This will be the player's own PeerJS ID if they host
let matchmakingCheckInterval = null; // Interval for periodically checking for rooms if initial search fails
let isSearchingOrHostingViaMatchmaking = false; // Flag to control operations

function initSupabase() {
    console.log('[Matchmaking] Attempting to init Supabase...');
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

/**
 * Attempts to find an open room or creates a new one for hosting.
 * @param {string} localRawPeerId - The local player's raw PeerJS ID.
 * @param {object} myPlayerData - { name, icon, color }
 * @param {object} preferences - { preferredPlayers, maxPlayers, minPlayers, gameSettings: {rows, cols} }
 * @param {object} callbacks - { onSearching, onMatchFoundAndJoiningRoom, onMatchFoundAndHostingRoom, onError, onTimeout }
 */
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

    isSearchingOrHostingViaMatchmaking = true;
    callbacks.onSearching?.();
    const localSupabasePeerId = `${state.CAJITAS_PEER_ID_PREFIX}${localRawPeerId}`;

    // Clean up any old entries for this peer_id first.
    await leaveQueue(localRawPeerId); // Pass raw PeerId here

    try {
        // Phase 1: Look for existing rooms to join
        console.log('[Matchmaking] Phase 1: Looking for existing rooms...');
        const { data: openRooms, error: fetchError } = await supabase
            .from(MATCHMAKING_TABLE)
            .select('*')
            .eq('status', 'hosting_waiting_for_players')
            .eq('game_type', 'cajitas') // Match game type
            // .gte('max_players', preferences.minPlayers) // Room can hold at least min
            // .lte('max_players', preferences.maxPlayers) // Room doesn't exceed max (more complex pref matching later)
            .lt('current_players', supabase. විය('max_players')) // Room is not full (current_players < max_players)
            .order('created_at', { ascending: true }); // Try to fill older rooms first

        if (fetchError) {
            console.error('[Matchmaking] Error fetching open rooms:', fetchError);
            // Proceed to Phase 2 (hosting) if fetching fails, or call onError
            // callbacks.onError?.(`Error buscando salas: ${fetchError.message}`);
            // return; // If we want to stop on error
        }

        if (openRooms && openRooms.length > 0) {
            // TODO: Add more sophisticated matching based on preferences (player count, board size if stored)
            const suitableRoom = openRooms[0]; // Simplistic: take the first one
            console.log('[Matchmaking] Found suitable room to join:', suitableRoom);

            // Clear any existing matchmaking interval if one was running from a previous attempt
            if (matchmakingCheckInterval) clearInterval(matchmakingCheckInterval);
            isSearchingOrHostingViaMatchmaking = false;
            
            // Extract raw leader PeerID from room_id (which should be leader's prefixed PeerID)
            const leaderRawPeerId = suitableRoom.room_id.startsWith(state.CAJITAS_PEER_ID_PREFIX)
                ? suitableRoom.room_id.substring(state.CAJITAS_PEER_ID_PREFIX.length)
                : suitableRoom.room_id;

            callbacks.onMatchFoundAndJoiningRoom?.(
                suitableRoom.room_id, // This is the prefixed Room ID (leader's full Supabase Peer ID)
                leaderRawPeerId,      // The raw PeerJS ID of the leader to connect to
                { // Pass some initial room data
                    maxPlayers: suitableRoom.max_players,
                    gameSettings: suitableRoom.game_settings || preferences.gameSettings, // Use stored or preferred
                    players: [], // Joining player will get full list from leader
                    currentPlayers: suitableRoom.current_players // For main.js to know
                }
            );
            return; // Successfully found a room to join
        }

        // Phase 2: No suitable room found, so become a host.
        console.log('[Matchmaking] Phase 2: No suitable rooms found. Becoming a host.');
        localPlayerHostedRoomId_Supabase = localSupabasePeerId; // My prefixed ID is the Room ID I'm hosting

        const newRoomEntry = {
            peer_id: localSupabasePeerId, // Who created this listing
            room_id: localSupabasePeerId, // This peer is the leader, so their ID is the room ID
            status: 'hosting_waiting_for_players',
            game_type: 'cajitas',
            preferred_players: preferences.preferredPlayers,
            max_players: preferences.maxPlayers,
            current_players: 1, // Starts with the host
            game_settings: preferences.gameSettings, // Store host's preferred game settings
            // created_at is default
        };

        const { error: insertError } = await supabase
            .from(MATCHMAKING_TABLE)
            .insert(newRoomEntry);

        if (insertError) {
            console.error('[Matchmaking] Error inserting new room for hosting:', insertError);
            callbacks.onError?.(`No se pudo crear una nueva sala: ${insertError.message}`);
            isSearchingOrHostingViaMatchmaking = false;
            localPlayerHostedRoomId_Supabase = null;
            return;
        }

        console.log('[Matchmaking] Successfully listed new room for hosting:', newRoomEntry);
        if (matchmakingCheckInterval) clearInterval(matchmakingCheckInterval); // Clear any old interval
        isSearchingOrHostingViaMatchmaking = false;

        callbacks.onMatchFoundAndHostingRoom?.(
            localRawPeerId, // My raw peer ID, I am the host/leader
            { // Initial data for the room I'm hosting
                maxPlayers: preferences.maxPlayers,
                gameSettings: preferences.gameSettings,
                players: [ // I am the first player
                    { ...myPlayerData, id: 0, peerId: localRawPeerId, isReady: false, isConnected: true, score: 0 }
                ]
            }
        );

        // Optional: Start a timeout for how long this room stays listed if no one joins.
        // For now, room stays listed until explicitly left via leaveQueue() or game starts & becomes full.

    } catch (error) {
        console.error('[Matchmaking] General exception in joinQueue:', error);
        callbacks.onError?.('Error general durante el matchmaking.');
        isSearchingOrHostingViaMatchmaking = false;
        if (matchmakingCheckInterval) clearInterval(matchmakingCheckInterval);
    }
}

/**
 * Removes the player's listing from the matchmaking queue.
 * If the player was hosting a room, this effectively unlists/closes that room.
 * @param {string} localRawPeerIdToLeave - The raw PeerJS ID of the player leaving.
 */
export async function leaveQueue(localRawPeerIdToLeave = null) {
    console.log('[Matchmaking] leaveQueue called.');
    if (matchmakingCheckInterval) {
        clearInterval(matchmakingCheckInterval);
        matchmakingCheckInterval = null;
    }
    isSearchingOrHostingViaMatchmaking = false;

    // Determine the Supabase Peer ID to remove. It could be the globally stored one
    // (if this client was hosting) or one passed explicitly.
    const peerIdToRemove = localRawPeerIdToLeave
        ? `${state.CAJITAS_PEER_ID_PREFIX}${localRawPeerIdToLeave}`
        : localPlayerHostedRoomId_Supabase;

    if (peerIdToRemove && supabase) {
        console.log(`[Matchmaking] Attempting to remove Supabase entry for room/peer: ${peerIdToRemove}`);
        try {
            // Remove any entry where this peer is the host (room_id = peerIdToRemove)
            // OR where this peer is listed as the primary peer_id (if it was just seeking, though that status is removed)
            const { error } = await supabase
                .from(MATCHMAKING_TABLE)
                .delete()
                .or(`peer_id.eq.${peerIdToRemove},room_id.eq.${peerIdToRemove}`); // Match if peer_id or room_id

            if (error) {
                console.warn('[Matchmaking] Error removing entry from Supabase (continuing):', error.message);
            } else {
                console.log('[Matchmaking] Successfully removed/unlisted entry from Supabase for:', peerIdToRemove);
            }
        } catch (error) {
            console.error('[Matchmaking] Exception during Supabase delete in leaveQueue:', error);
        }
    }
    if (peerIdToRemove === localPlayerHostedRoomId_Supabase) {
        localPlayerHostedRoomId_Supabase = null; // Clear it if we just removed the room this client was hosting
    }
}

/**
 * Called by the room leader to update their room's status in Supabase,
 * typically when current_players changes or game starts/ends.
 * @param {string} hostRawPeerId - The raw PeerJS ID of the host (which is also the room_id).
 * @param {object} gameSettings - Current game settings {rows, cols}.
 * @param {number} maxPlayers - Max players for the room.
 * @param {number} currentPlayers - Current number of players in the room.
 * @param {string} newStatus - Optional: new status like 'in_game', 'full', or back to 'hosting_waiting_for_players'.
 */
export async function updateHostedRoomStatus(hostRawPeerId, gameSettings, maxPlayers, currentPlayers, newStatus = null) {
    if (!supabase || !hostRawPeerId) return;

    const hostSupabasePeerId = `${state.CAJITAS_PEER_ID_PREFIX}${hostRawPeerId}`;
    console.log(`[Matchmaking] Host ${hostSupabasePeerId} updating room status. Current Players: ${currentPlayers}/${maxPlayers}. New Status: ${newStatus}`);

    let statusToSet = newStatus;
    if (!statusToSet) { // Auto-determine status if not provided
        if (currentPlayers >= maxPlayers) {
            statusToSet = 'full'; // Or 'in_game' if game actually started
        } else {
            statusToSet = 'hosting_waiting_for_players';
        }
    }
    
    // If room becomes full or game starts, it might be removed or marked differently
    // so new players don't try to join via matchmaking.
    // If status is 'full' or 'in_game', perhaps it should be removed from active queue after a while,
    // or simply not show up in "find open rooms" queries.
    if (statusToSet === 'full' || statusToSet === 'in_game') {
         console.log(`[Matchmaking] Room ${hostSupabasePeerId} is now ${statusToSet}. It will effectively be unlisted or marked as unjoinable for new matchmaking searches.`);
         // Option 1: Delete it
         // const { error } = await supabase.from(MATCHMAKING_TABLE).delete().eq('room_id', hostSupabasePeerId);
         // Option 2: Update status (current approach)
        const { error } = await supabase
            .from(MATCHMAKING_TABLE)
            .update({ current_players: currentPlayers, status: statusToSet, game_settings: gameSettings })
            .eq('room_id', hostSupabasePeerId); // room_id is the host's Supabase Peer ID

        if (error) {
            console.error(`[Matchmaking] Error updating room ${hostSupabasePeerId} to status ${statusToSet}:`, error);
        } else {
            console.log(`[Matchmaking] Room ${hostSupabasePeerId} status updated to ${statusToSet}.`);
        }
    } else { // Still 'hosting_waiting_for_players'
        const { error } = await supabase
            .from(MATCHMAKING_TABLE)
            .update({ current_players: currentPlayers, status: statusToSet, game_settings: gameSettings })
            .eq('room_id', hostSupabasePeerId);

        if (error) {
            console.error(`[Matchmaking] Error updating room ${hostSupabasePeerId} (waiting status):`, error);
        } else {
            console.log(`[Matchmaking] Room ${hostSupabasePeerId} (waiting status) updated. Players: ${currentPlayers}/${maxPlayers}`);
        }
    }
}

// This function is no longer needed with the new model, as hosts don't poll.
// export function stopSearchingDueToIncomingConnection() { ... }


console.log('[Matchmaking] Module loaded.');