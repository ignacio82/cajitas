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

// Helper function to clean up matchmaking state variables
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

    isSearchingOrHostingViaMatchmaking = true; // Set flag
    callbacks.onSearching?.();
    const localSupabasePeerId = `${state.CAJITAS_PEER_ID_PREFIX}${localRawPeerId}`;

    await leaveQueue(localRawPeerId); // Clean up any old entries for this peer_id first.

    try {
        console.log('[Matchmaking] Phase 1: Looking for existing rooms...');
        const { data: openRooms, error: fetchError } = await supabase
            .from(MATCHMAKING_TABLE)
            .select('*')
            .eq('status', 'hosting_waiting_for_players')
            .eq('game_type', 'cajitas') 
            .filter('current_players', 'lt', supabase.sql('max_players')) // Ensure this syntax is correct for your Supabase version or use raw filter
            .order('created_at', { ascending: true }); 

        if (fetchError) {
            console.error('[Matchmaking] Error fetching open rooms:', fetchError);
            cleanupMatchmakingState(); // Cleanup on error
            callbacks.onError?.(`Error buscando salas: ${fetchError.message}`);
            return; 
        }

        if (openRooms && openRooms.length > 0) {
            const suitableRoom = openRooms[0]; 
            console.log('[Matchmaking] Found suitable room to join:', suitableRoom);
            
            cleanupMatchmakingState(); // Cleanup as we found a match

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
            preferred_players: preferences.preferredPlayers,
            max_players: preferences.maxPlayers,
            current_players: 1, 
            game_settings: preferences.gameSettings, 
        };

        const { error: insertError } = await supabase
            .from(MATCHMAKING_TABLE)
            .insert(newRoomEntry);

        if (insertError) {
            console.error('[Matchmaking] Error inserting new room for hosting:', insertError);
            cleanupMatchmakingState(); // Cleanup on error
            localPlayerHostedRoomId_Supabase = null; // Ensure this is nulled if insert fails
            callbacks.onError?.(`No se pudo crear una nueva sala: ${insertError.message}`);
            return;
        }

        console.log('[Matchmaking] Successfully listed new room for hosting:', newRoomEntry);
        // isSearchingOrHostingViaMatchmaking will be false after this, or can be set by cleanup
        // No longer need to call cleanupMatchmakingState here if the flow is exiting successfully to host.
        // The hosting status will be managed by updateHostedRoomStatus or leaveQueue if game starts/user cancels.
        // However, if the intention of cleanup is for isSearchingOrHostingViaMatchmaking flag, then:
        isSearchingOrHostingViaMatchmaking = false; // Explicitly set after successfully becoming a host via matchmaking

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
        cleanupMatchmakingState(); // Cleanup on general error
        callbacks.onError?.('Error general durante el matchmaking.');
    }
}

export async function leaveQueue(localRawPeerIdToLeave = null) {
    console.log('[Matchmaking] leaveQueue called.');
    // Call cleanupMatchmakingState here as well if it's meant to be a general reset for this module's flags
    // cleanupMatchmakingState(); // Moved below specific Supabase ID logic

    const peerIdToRemove = localRawPeerIdToLeave
        ? `${state.CAJITAS_PEER_ID_PREFIX}${localRawPeerIdToLeave}`
        : localPlayerHostedRoomId_Supabase;

    if (peerIdToRemove && supabase) {
        console.log(`[Matchmaking] Attempting to remove Supabase entry for room/peer: ${peerIdToRemove}`);
        try {
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
    // General cleanup for matchmaking flags after DB operations
    cleanupMatchmakingState();
}

export async function updateHostedRoomStatus(hostRawPeerId, gameSettings, maxPlayers, currentPlayers, newStatus = null) {
    if (!supabase || !hostRawPeerId) return;

    const hostSupabasePeerId = `${state.CAJITAS_PEER_ID_PREFIX}${hostRawPeerId}`;
    console.log(`[Matchmaking] Host ${hostSupabasePeerId} updating room status. Current Players: ${currentPlayers}/${maxPlayers}. New Status: ${newStatus}`);

    let statusToSet = newStatus;
    if (!statusToSet) { 
        if (currentPlayers >= maxPlayers) {
            statusToSet = 'full'; 
        } else {
            statusToSet = 'hosting_waiting_for_players';
        }
    }
    
    if (statusToSet === 'full' || statusToSet === 'in_game') {
         console.log(`[Matchmaking] Room ${hostSupabasePeerId} is now ${statusToSet}.`);
        const { error } = await supabase
            .from(MATCHMAKING_TABLE)
            .update({ current_players: currentPlayers, status: statusToSet, game_settings: gameSettings })
            .eq('room_id', hostSupabasePeerId); 

        if (error) {
            console.error(`[Matchmaking] Error updating room ${hostSupabasePeerId} to status ${statusToSet}:`, error);
        } else {
            console.log(`[Matchmaking] Room ${hostSupabasePeerId} status updated to ${statusToSet}.`);
        }
    } else { 
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

console.log('[Matchmaking] Module loaded.');