// matchmaking_supabase.js

import * as state from './state.js'; // For CAJITAS_PEER_ID_PREFIX

const SUPABASE_URL = "https://lunxhfsvlfyhqehpirdi.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1bnhoZnN2bGZ5aHFlaHBpcmRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgzMDMzMzMsImV4cCI6MjA2Mzg3OTMzM30.iKEnrtSVjwTQhB8OLahTANJzvCamR60bjhC6qvTtwxU";

let supabase = null;
const MATCHMAKING_TABLE = 'matchmaking_queue_cajitas'; 

let localPlayerHostedRoomId_Supabase = null; 
let matchmakingCheckInterval = null; 
let isSearchingOrHostingViaMatchmaking = false; 

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

function cleanupMatchmakingState() {
    console.log('[Matchmaking] Cleaning up matchmaking state.');
    if (matchmakingCheckInterval) {
        clearInterval(matchmakingCheckInterval);
        matchmakingCheckInterval = null;
    }
    isSearchingOrHostingViaMatchmaking = false;
    // localPlayerHostedRoomId_Supabase is cleared by leaveQueue if it was this client's room
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

    isSearchingOrHostingViaMatchmaking = true; 
    callbacks.onSearching?.();
    const localSupabasePeerId = `${state.CAJITAS_PEER_ID_PREFIX}${localRawPeerId}`;

    await leaveQueue(localRawPeerId); 

    try {
        console.log('[Matchmaking] Phase 1: Looking for existing rooms...');
        // Ensure preferences.maxPlayers is a number for the filter
        const preferredMaxPlayers = Number(preferences.maxPlayers);
        if (isNaN(preferredMaxPlayers)) {
            console.error('[Matchmaking] preferences.maxPlayers is not a valid number:', preferences.maxPlayers);
            cleanupMatchmakingState();
            callbacks.onError?.('Preferencia de maxPlayers inválida.');
            return;
        }

        const { data: openRooms, error: fetchError } = await supabase
            .from(MATCHMAKING_TABLE)
            .select('*')
            .eq('status', 'hosting_waiting_for_players')
            .eq('game_type', 'cajitas') 
            // Filter for rooms where current_players < value_of_preferences.maxPlayers
            // And also that the room's max_players setting is compatible (e.g., equal to preferredMaxPlayers)
            .lt('current_players', preferredMaxPlayers) // Room is not full for this preference
            .eq('max_players', preferredMaxPlayers)     // Room is set up for the same number of max players
            // TODO: Add more sophisticated matching for game_settings (rows, cols) if stored and preferred
            .order('created_at', { ascending: true }); 

        if (fetchError) {
            console.error('[Matchmaking] Error fetching open rooms:', fetchError);
            cleanupMatchmakingState(); 
            callbacks.onError?.(`Error buscando salas: ${fetchError.message}`);
            return; 
        }

        if (openRooms && openRooms.length > 0) {
            // TODO: Implement more sophisticated room selection logic if multiple suitable rooms are found.
            // For now, taking the first one that matches the max_players preference and has space.
            const suitableRoom = openRooms[0]; 
            console.log('[Matchmaking] Found suitable room to join:', suitableRoom);
            
            cleanupMatchmakingState(); 

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
            preferred_players: preferences.preferredPlayers, // This might be the same as max_players for now
            max_players: preferences.maxPlayers,
            current_players: 1, 
            game_settings: preferences.gameSettings, 
        };

        const { error: insertError } = await supabase
            .from(MATCHMAKING_TABLE)
            .insert(newRoomEntry);

        if (insertError) {
            console.error('[Matchmaking] Error inserting new room for hosting:', insertError);
            cleanupMatchmakingState(); 
            localPlayerHostedRoomId_Supabase = null; 
            callbacks.onError?.(`No se pudo crear una nueva sala: ${insertError.message}`);
            return;
        }

        console.log('[Matchmaking] Successfully listed new room for hosting:', newRoomEntry);
        isSearchingOrHostingViaMatchmaking = false; 

        callbacks.onMatchFoundAndHostingRoom?.(
            localRawPeerId, 
            { 
                maxPlayers: preferences.maxPlayers,
                gameSettings: preferences.gameSettings,
                players: [ 
                    { ...myPlayerData, id: 0, peerId: localRawPeerId, isReady: false, isConnected: true, score: 0 }
                ]
            }
        );

    } catch (error) {
        console.error('[Matchmaking] General exception in joinQueue:', error);
        cleanupMatchmakingState(); 
        callbacks.onError?.('Error general durante el matchmaking.');
    }
}

export async function leaveQueue(localRawPeerIdToLeave = null) {
    console.log('[Matchmaking] leaveQueue called.');
    const peerIdToRemove = localRawPeerIdToLeave
        ? `${state.CAJITAS_PEER_ID_PREFIX}${localRawPeerIdToLeave}`
        : localPlayerHostedRoomId_Supabase;

    if (peerIdToRemove && supabase) {
        console.log(`[Matchmaking] Attempting to remove Supabase entry for room/peer: ${peerIdToRemove}`);
        try {
            // Remove any entry where this peer is the host (room_id = peerIdToRemove)
            // OR where this peer is listed as the primary peer_id (if it was just seeking)
            const { error } = await supabase
                .from(MATCHMAKING_TABLE)
                .delete()
                .or(`peer_id.eq.${peerIdToRemove},room_id.eq.${peerIdToRemove}`); 

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
        localPlayerHostedRoomId_Supabase = null; 
    }
    cleanupMatchmakingState(); // Ensure flags are reset after DB operations
}

export async function updateHostedRoomStatus(hostRawPeerId, gameSettings, maxPlayers, currentPlayers, newStatus = null) {
    if (!supabase || !hostRawPeerId) return;

    const hostSupabasePeerId = `${state.CAJITAS_PEER_ID_PREFIX}${hostRawPeerId}`;
    console.log(`[Matchmaking] Host ${hostSupabasePeerId} updating room status. Current Players: ${currentPlayers}/${maxPlayers}. New Status: ${newStatus}`);

    let statusToSet = newStatus;
    if (!statusToSet) { 
        if (currentPlayers >= maxPlayers) {
            statusToSet = 'full'; 
        } else if (currentPlayers < state.MIN_PLAYERS_NETWORK && currentPlayers > 0) { // If players drop below min but room not empty
            statusToSet = 'hosting_waiting_for_players';
        } else if (currentPlayers <= 0) { // No one left, should probably be unlisted by leaveQueue
            console.warn(`[Matchmaking] updateHostedRoomStatus called for host ${hostSupabasePeerId} with 0 players. Room should ideally be unlisted via leaveQueue.`);
            // For safety, mark as waiting if not explicitly something else.
            statusToSet = 'hosting_waiting_for_players'; 
        }
        else { // Default to waiting if status not explicitly set and not full
            statusToSet = 'hosting_waiting_for_players';
        }
    }
    
    // If room becomes full or game starts, its status is updated.
    // If status is 'full' or 'in_game', new players won't find it via matchmaking query for 'hosting_waiting_for_players'.
    const { error } = await supabase
        .from(MATCHMAKING_TABLE)
        .update({ current_players: currentPlayers, status: statusToSet, game_settings: gameSettings, max_players: maxPlayers }) // Also update max_players if it can change
        .eq('room_id', hostSupabasePeerId); 

    if (error) {
        console.error(`[Matchmaking] Error updating room ${hostSupabasePeerId} to status ${statusToSet}:`, error);
    } else {
        console.log(`[Matchmaking] Room ${hostSupabasePeerId} status updated to ${statusToSet}. Players: ${currentPlayers}/${maxPlayers}`);
    }
}

console.log('[Matchmaking] Module loaded.');