// matchmaking_supabase.js - For Cajitas de Dani

// Use the same Supabase URL and Anon Key as your Tateti game
const SUPABASE_URL = "https://lunxhfsvlfyhqehpirdi.supabase.co"; //
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1bnhoZnN2bGZ5aHFlaHBpcmRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgzMDMzMzMsImV4cCI6MjA2Mzg3OTMzM30.iKEnrtSVjwTQhB8OLahTANJzvCamR60bjhC6qvTtwxU"; //

let supabase = null;
let localPlayerSupabasePeerId = null; // This will be the ID stored in Supabase (e.g., "cajitas-xxxxx")
let lookingForMatch = false;
let matchCheckInterval = null;
const CAJITAS_PEER_ID_PREFIX = "cajitas-"; // Prefix for Cajitas game
const MATCHMAKING_TABLE = 'matchmaking_queue_cajitas'; // New table name for Cajitas matchmaking

// Initialize Supabase client
function initSupabase() {
    if (!supabase && window.supabase) { // Use window.supabase as it's loaded via CDN
        supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        console.log('[Cajitas Matchmaking] Supabase client initialized.');
        return true;
    } else if (supabase) {
        return true; // Already initialized
    }
    console.error('[Cajitas Matchmaking] Supabase library not found on window object.');
    return false;
}

/**
 * Joins the matchmaking queue.
 * @param {string} rawPeerId - The raw PeerJS ID of the local player.
 * @param {object} callbacks - Callbacks for matchmaking events (onSearching, onMatchFound, onError, onTimeout).
 */
export async function joinQueue(rawPeerId, callbacks) {
    if (!initSupabase()) {
        callbacks.onError?.('Supabase client no pudo ser inicializado.');
        return;
    }

    if (!rawPeerId) {
        callbacks.onError?.('PeerJS ID es inválido para unirse a la cola.');
        return;
    }

    localPlayerSupabasePeerId = `${CAJITAS_PEER_ID_PREFIX}${rawPeerId}`;
    console.log(`[Cajitas Matchmaking] Intentando unirse a la cola con ID: ${localPlayerSupabasePeerId}`);
    lookingForMatch = true;
    callbacks.onSearching?.();

    try {
        // 1. Clean up any old entries for this player
        const { error: deleteOldError } = await supabase
            .from(MATCHMAKING_TABLE)
            .delete()
            .eq('peer_id', localPlayerSupabasePeerId);

        if (deleteOldError) {
            console.warn('[Cajitas Matchmaking] No se pudieron limpiar entradas antiguas, continuando:', deleteOldError.message);
        }

        // 2. Add player to the queue
        const { error: insertError } = await supabase
            .from(MATCHMAKING_TABLE)
            .insert({ peer_id: localPlayerSupabasePeerId, status: 'waiting', game_type: 'cajitas' }); // Added game_type

        if (insertError) {
            console.error('[Cajitas Matchmaking] Error al insertar en la cola:', insertError);
            callbacks.onError?.('No se pudo unir a la cola de matchmaking.');
            lookingForMatch = false;
            return;
        }
        console.log('[Cajitas Matchmaking] Se unió exitosamente a la cola.');

        // 3. Periodically check for opponents
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

            // Find an opponent also waiting for 'cajitas'
            const { data: waitingPlayers, error: fetchError } = await supabase
                .from(MATCHMAKING_TABLE)
                .select('peer_id')
                .eq('status', 'waiting')
                .eq('game_type', 'cajitas') // Ensure opponent is also for cajitas
                .neq('peer_id', localPlayerSupabasePeerId) // Not ourselves
                .limit(1); // Get one potential opponent

            if (fetchError) {
                console.error('[Cajitas Matchmaking] Error al buscar oponentes:', fetchError);
                return; // Wait for the next interval
            }

            if (waitingPlayers && waitingPlayers.length > 0) {
                const opponentSupabasePeerId = waitingPlayers[0].peer_id;
                console.log(`[Cajitas Matchmaking] Oponente potencial encontrado: ${opponentSupabasePeerId}`);

                // Try to "claim" this opponent by updating their status (or deleting them from queue)
                // This is a common strategy to avoid two players picking each other simultaneously.
                // A more robust way involves transactions or server-side functions if available.
                // For simplicity, we'll try deleting. If successful, we got them.
                const { error: deleteOpponentError } = await supabase
                    .from(MATCHMAKING_TABLE)
                    .delete()
                    .eq('peer_id', opponentSupabasePeerId)
                    .eq('status', 'waiting'); // Ensure they are still waiting

                if (!deleteOpponentError) {
                    // Successfully claimed opponent!
                    console.log(`[Cajitas Matchmaking] ¡Emparejado con ${opponentSupabasePeerId}!`);
                    await leaveQueue(); // Remove self from queue
                    
                    // Extract the raw PeerJS ID from the Supabase ID
                    const opponentRawPeerId = opponentSupabasePeerId.startsWith(CAJITAS_PEER_ID_PREFIX)
                        ? opponentSupabasePeerId.substring(CAJITAS_PEER_ID_PREFIX.length)
                        : opponentSupabasePeerId;

                    callbacks.onMatchFound?.(opponentRawPeerId); // Pass back the raw PeerJS ID for connection
                    return;
                } else {
                    console.log('[Cajitas Matchmaking] El oponente ya no estaba disponible, buscando de nuevo...');
                }
            }

            if (attempts >= MAX_ATTEMPTS_BEFORE_TIMEOUT_MESSAGE && lookingForMatch) {
                console.log('[Cajitas Matchmaking] Límite de tiempo de búsqueda alcanzado.');
                callbacks.onTimeout?.();
                await leaveQueue(); // Stop searching
            }
        }, 3000); // Check every 3 seconds

    } catch (error) {
        console.error('[Cajitas Matchmaking] Excepción al unirse a la cola:', error);
        callbacks.onError?.('Error general al unirse a la cola.');
        lookingForMatch = false;
    }
}

/**
 * Leaves the matchmaking queue.
 */
export async function leaveQueue() {
    console.log('[Cajitas Matchmaking] Saliendo de la cola...');
    lookingForMatch = false;
    if (matchCheckInterval) {
        clearInterval(matchCheckInterval);
        matchCheckInterval = null;
    }

    if (localPlayerSupabasePeerId && supabase) {
        try {
            const { error } = await supabase
                .from(MATCHMAKING_TABLE)
                .delete()
                .eq('peer_id', localPlayerSupabasePeerId);
            if (error) {
                console.warn('[Cajitas Matchmaking] Error al intentar salir de la cola:', error.message);
            } else {
                console.log('[Cajitas Matchmaking] Se salió exitosamente de la cola.');
            }
        } catch (error) {
            console.error('[Cajitas Matchmaking] Excepción al salir de la cola:', error);
        }
        localPlayerSupabasePeerId = null;
    }
}