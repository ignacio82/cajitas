// matchmaking_supabase.js - MODIFIED for enhanced initialization logging

const SUPABASE_URL = "https://lunxhfsvlfyhqehpirdi.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1bnhoZnN2bGZ5aHFlaHBpcmRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgzMDMzMzMsImV4cCI6MjA2Mzg3OTMzM30.iKEnrtSVjwTQhB8OLahTANJzvCamR60bjhC6qvTtwxU";

let supabase = null;
let localPlayerSupabasePeerId = null;
const CAJITAS_PEER_ID_PREFIX = "cajitas-";
const MATCHMAKING_TABLE = 'matchmaking_queue_cajitas';

// Declare these at the module scope
let lookingForMatch = false;
let matchCheckInterval = null;

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

    localPlayerSupabasePeerId = `${CAJITAS_PEER_ID_PREFIX}${rawPeerId}`;
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

        let attempts = 0;
        const MAX_ATTEMPTS_BEFORE_TIMEOUT_MESSAGE = 10; // e.g., 10 * 3s = 30s

        if (matchCheckInterval) clearInterval(matchCheckInterval);
        matchCheckInterval = setInterval(async () => {
            if (!lookingForMatch) {
                clearInterval(matchCheckInterval);
                return;
            }
            attempts++;
            console.log(`[Cajitas Matchmaking] Intento de búsqueda ${attempts}...`);

            const { data: waitingPlayers, error: fetchError } = await supabase
                .from(MATCHMAKING_TABLE)
                .select('peer_id')
                .eq('status', 'waiting')
                .eq('game_type', 'cajitas')
                .neq('peer_id', localPlayerSupabasePeerId)
                .limit(1);

            if (fetchError) {
                console.error('[Cajitas Matchmaking] Error al buscar oponentes:', fetchError.message, fetchError);
                // Optionally, you could stop the interval if fetch errors persist.
                // For now, it will just keep trying.
                return;
            }

            if (waitingPlayers && waitingPlayers.length > 0) {
                const opponentSupabasePeerId = waitingPlayers[0].peer_id;
                console.log(`[Cajitas Matchmaking] Oponente potencial encontrado: ${opponentSupabasePeerId}`);

                const { error: deleteOpponentError } = await supabase
                    .from(MATCHMAKING_TABLE)
                    .delete()
                    .eq('peer_id', opponentSupabasePeerId)
                    .eq('status', 'waiting');

                if (!deleteOpponentError) { // Successfully claimed by deleting
                    console.log(`[Cajitas Matchmaking] ¡Emparejado con ${opponentSupabasePeerId}!`);
                    await leaveQueue(); // Remove self from queue
                    
                    const opponentRawPeerId = opponentSupabasePeerId.startsWith(CAJITAS_PEER_ID_PREFIX)
                        ? opponentSupabasePeerId.substring(CAJITAS_PEER_ID_PREFIX.length)
                        : opponentSupabasePeerId;

                    callbacks.onMatchFound?.(opponentRawPeerId);
                    return; // Exit interval logic
                } else {
                    console.log('[Cajitas Matchmaking] El oponente ya no estaba disponible (o error al reclamar), buscando de nuevo...', deleteOpponentError?.message);
                }
            }

            if (attempts >= MAX_ATTEMPTS_BEFORE_TIMEOUT_MESSAGE && lookingForMatch) {
                console.log('[Cajitas Matchmaking] Límite de tiempo de búsqueda alcanzado.');
                callbacks.onTimeout?.();
                await leaveQueue(); // Stop searching
            }
        }, 3000);

    } catch (error) {
        console.error('[Cajitas Matchmaking] Excepción general al unirse a la cola:', error);
        callbacks.onError?.('Error general al unirse a la cola.');
        lookingForMatch = false;
    }
}

export async function leaveQueue() {
    console.log('[Cajitas Matchmaking] leaveQueue called.');
    lookingForMatch = false;
    if (matchCheckInterval) {
        clearInterval(matchCheckInterval);
        matchCheckInterval = null;
        console.log('[Cajitas Matchmaking] Match check interval cleared.');
    }

    if (localPlayerSupabasePeerId && supabase) {
        console.log(`[Cajitas Matchmaking] Attempting to remove ${localPlayerSupabasePeerId} from queue...`);
        try {
            const { error } = await supabase
                .from(MATCHMAKING_TABLE)
                .delete()
                .eq('peer_id', localPlayerSupabasePeerId);
            if (error) {
                console.warn('[Cajitas Matchmaking] Error al intentar salir de la cola (delete op):', error.message, error);
            } else {
                console.log('[Cajitas Matchmaking] Se salió exitosamente de la cola (o ya no estaba).');
            }
        } catch (error) {
            console.error('[Cajitas Matchmaking] Excepción al salir de la cola:', error);
        }
        localPlayerSupabasePeerId = null; // Clear it after attempting removal
    } else {
        console.log('[Cajitas Matchmaking] leaveQueue: No localPlayerSupabasePeerId or supabase client to perform delete.');
    }
}

// Log at the end of the module to confirm it's fully evaluated
console.log('[Cajitas Matchmaking] Module fully loaded. typeof joinQueue:', typeof joinQueue, 'typeof leaveQueue:', typeof leaveQueue);