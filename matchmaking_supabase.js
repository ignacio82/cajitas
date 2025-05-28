// matchmaking_supabase.js - MODIFIED for enhanced initialization logging

const SUPABASE_URL = "https://lunxhfsvlfyhqehpirdi.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1bnhoZnN2bGZ5aHFlaHBpcmRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgzMDMzMzMsImV4cCI6MjA2Mzg3OTMzM30.iKEnrtSVjwTQhB8OLahTANJzvCamR60bjhC6qvTtwxU";

let supabase = null;
let localPlayerSupabasePeerId = null;
const CAJITAS_PEER_ID_PREFIX = "cajitas-";
const MATCHMAKING_TABLE = 'matchmaking_queue_cajitas';

function initSupabase() {
    console.log('[Cajitas Matchmaking] Attempting to init Supabase...');
    console.log('[Cajitas Matchmaking] typeof window.supabase:', typeof window.supabase);
    if (window.supabase) {
        console.log('[Cajitas Matchmaking] window.supabase object found:', window.supabase);
    } else {
        console.error('[Cajitas Matchmaking] window.supabase object NOT found at init time!');
    }

    if (!supabase && window.supabase && typeof window.supabase.createClient === 'function') {
        try {
            supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            console.log('[Cajitas Matchmaking] Supabase client initialized successfully via createClient.', supabase);
            return true;
        } catch (e) {
            console.error('[Cajitas Matchmaking] Error during supabase.createClient:', e);
            supabase = null; // Ensure supabase is null if initialization failed
            return false;
        }
    } else if (supabase) {
        console.log('[Cajitas Matchmaking] Supabase client already initialized.');
        return true;
    }

    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
        console.error('[Cajitas Matchmaking] Supabase library (window.supabase or window.supabase.createClient) not available.');
    }
    return false;
}

export async function joinQueue(rawPeerId, callbacks) {
    console.log('[Cajitas Matchmaking] joinQueue called with rawPeerId:', rawPeerId);
    if (!initSupabase()) {
        const errorMsg = 'Supabase client no pudo ser inicializado. Check console for details.';
        console.error('[Cajitas Matchmaking] joinQueue aborting:', errorMsg);
        callbacks.onError?.(errorMsg);
        return;
    }

    if (!rawPeerId) {
        const errorMsg = 'PeerJS ID es inválido para unirse a la cola.';
        console.error('[Cajitas Matchmaking] joinQueue aborting:', errorMsg);
        callbacks.onError?.(errorMsg);
        return;
    }

    localPlayerSupabasePeerId = `<span class="math-inline">\{CAJITAS\_PEER\_ID\_PREFIX\}</span>{rawPeerId}`;
    console.log(`[Cajitas Matchmaking] Intentando unirse a la cola con Supabase Peer ID: ${localPlayerSupabasePeerId}`);
    lookingForMatch = true;
    callbacks.onSearching?.();

    try {
        console.log(`[Cajitas Matchmaking] Attempting to clean old entries for ${localPlayerSupabasePeerId}...`);
        const { error: deleteOldError } = await supabase
            .from(MATCHMAKING_TABLE)
            .delete()
            .eq('peer_id', localPlayerSupabasePeerId);

        if (deleteOldError) {
            // Log the error but continue, as this is not always critical
            console.warn('[Cajitas Matchmaking] Error cleaning old entries (continuing):', deleteOldError.message, deleteOldError);
        } else {
            console.log(`[Cajitas Matchmaking] Old entries cleaned (or none found) for ${localPlayerSupabasePeerId}.`);
        }

        console.log(`[Cajitas Matchmaking] Attempting to insert new entry for ${localPlayerSupabasePeerId}...`);
        const { error: insertError } = await supabase
            .from(MATCHMAKING_TABLE)
            .insert({ peer_id: localPlayerSupabasePeerId, status: 'waiting', game_type: 'cajitas' });

        if (insertError) {
            console.error('[Cajitas Matchmaking] Error al insertar en la cola:', insertError.message, insertError);
            callbacks.onError?.(`No se pudo unir a la cola de matchmaking: ${insertError.message}`);
            lookingForMatch = false;
            return;
        }
        console.log('[Cajitas Matchmaking] Se unió exitosamente a la cola.');

        // ... (rest of the matchmaking logic: polling, etc.)
        // Ensure you have good logging inside the setInterval as well for fetchError and deleteOpponentError

    } catch (error) {
        console.error('[Cajitas Matchmaking] Excepción general al unirse a la cola:', error);
        callbacks.onError?.('Error general al unirse a la cola.');
        lookingForMatch = false;
    }
}
// ... (rest of the file: leaveQueue, matchCheckInterval, lookingForMatch declaration)
// Make sure lookingForMatch and matchCheckInterval are declared at the top level of the module scope if not already.
// let lookingForMatch = false;
// let matchCheckInterval = null;