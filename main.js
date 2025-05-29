// main.js

// VERY EARLY LOG: What is the URL when the script first runs?
console.log("[Main - Pre-DOM] Initial window.location.href:", window.location.href);
console.log("[Main - Pre-DOM] Initial window.location.search:", window.location.search);
console.log("[Main - Pre-DOM] Initial URLSearchParams:", new URLSearchParams(window.location.search));

import * as state from './state.js';
import *ui from './ui.js';
import * as gameLogic from './gameLogic.js';
import * as sound from './sound.js';
import * as peerConnection from './peerConnection.js';
import * as matchmaking from './matchmaking_supabase.js';

function checkUrlForRoomAndJoinEarly() {
    console.log("[Main - Early URL Check] window.location.href:", window.location.href);
    const urlParams = new URLSearchParams(window.location.search);
    const roomIdFromUrl = urlParams.get('room');
    const slotsFromUrl = urlParams.get('slots'); // Optional: may inform UI or logic
    console.log("[Main - Early URL Check] roomIdFromUrl:", roomIdFromUrl, "slotsFromUrl:", slotsFromUrl);

    if (roomIdFromUrl && roomIdFromUrl.trim()) {
        console.log("[Main - Early URL Check] ROOM ID FOUND! Setting flag for DOM ready processing.");
        window.cajitasJoinRoomOnLoad = {
            roomId: roomIdFromUrl.trim(),
            slots: slotsFromUrl ? parseInt(slotsFromUrl) : null
        };
        return true;
    }
    return false;
}

const hasRoomInUrl = checkUrlForRoomAndJoinEarly();
console.log("[Main - Early URL Check] Has room in URL:", hasRoomInUrl);


// Helper to get player customization from the UI (for the local player)
function getLocalPlayerCustomization() {
    // Assumes player customization fields (name-0, icon-0, color-0) are for the local user
    const name = document.getElementById('player-name-0')?.value || `Jugador`;
    const icon = document.getElementById('player-icon-0')?.value || state.AVAILABLE_ICONS[0];
    const color = document.getElementById('player-color-0')?.value || state.DEFAULT_PLAYER_COLORS[0];
    return { name, icon, color };
}


document.addEventListener('DOMContentLoaded', () => {
    console.log("Cajitas de Danielle: DOM fully loaded and parsed");
    console.log("[Main - DOMContentLoaded] window.cajitasJoinRoomOnLoad:", window.cajitasJoinRoomOnLoad);

    // --- Initial UI Setup ---
    if (!window.cajitasJoinRoomOnLoad) {
        ui.showSetupScreen();
        // For local game setup or initial network player details
        ui.generatePlayerSetupFields(parseInt(ui.numPlayersInput?.value || "2"));
        ui.updateGameModeUI();
        if (ui.undoBtn) ui.undoBtn.disabled = true;
    } else {
        console.log("[Main - DOMContentLoaded] Skipping initial setup screen - joining room via URL");
        // UI will transition to lobby or game via processUrlJoin
    }

    // --- Event Listeners for Setup Screen ---
    ui.startGameBtn?.addEventListener('click', async () => { // Local Game Start
        if (!state.soundsInitialized) await sound.initSounds();
        if (state.soundsInitialized) sound.playSound(sound.uiClickSound, "C4", "16n");

        stopAnyActiveGameOrNetworkSession();
        state.setPvpRemoteActive(false); // Ensure it's a local game

        const numLocalPlayers = parseInt(ui.numPlayersInput.value);
        state.setGameDimensions(parseInt(ui.rowsInput.value), parseInt(ui.colsInput.value));
        // numPlayers is not a global state variable anymore for game logic,
        // it's derived from playersData.length or networkRoomData.maxPlayers

        const localPlayers = [];
        for (let i = 0; i < numLocalPlayers; i++) {
            const name = document.getElementById(`player-name-${i}`)?.value || `Jugador ${i + 1}`;
            const icon = document.getElementById(`player-icon-${i}`)?.value || state.AVAILABLE_ICONS[i % state.AVAILABLE_ICONS.length];
            const color = document.getElementById(`player-color-${i}`)?.value || state.DEFAULT_PLAYER_COLORS[i % state.DEFAULT_PLAYER_COLORS.length];
            localPlayers.push({ id: i, name, icon, color, score: 0 });
        }
        state.setPlayersData(localPlayers); // This is the playersData for the actual game instance

        gameLogic.initializeGame(false); // isRemoteGame = false
        ui.showGameScreen();
    });

    ui.resetGameBtn?.addEventListener('click', () => { // In-Game Reset Button
        if (state.soundsInitialized) sound.playSound(sound.uiClickSound, "E3", "16n");
        
        if (state.pvpRemoteActive && state.networkRoomData.roomId) {
            // For network games, reset might mean proposing a new game to the room or leaving.
            // Simple reset for now: leader can trigger a game state reset (if implemented)
            // Clients might request, leader decides.
            // For now, this button might be more for "Leave Room/Back to Setup" in network context
            // or a full local re-init if leader.
            // TODO: Refine network game reset logic.
            // For now, let's make it behave like "stop and go to setup" for network.
             ui.showModalMessageWithActions("¿Reiniciar el juego o salir de la sala?", [
                { text: "Juego Nuevo (Local)", action: () => { stopAnyActiveGameOrNetworkSession(); gameLogic.resetGame(true); ui.showSetupScreen(); ui.hideModalMessage(); }},
                ...(state.pvpRemoteActive ? [{ text: "Salir de Sala", action: () => { stopAnyActiveGameOrNetworkSession(); ui.showSetupScreen(); ui.hideModalMessage(); } }] : []),
                { text: "Cancelar", action: ui.hideModalMessage, isCancel: true }
            ]);

        } else { // Local game
            stopAnyActiveGameOrNetworkSession(); // Ensure any lingering network stuff is cleared
            gameLogic.resetGame(true); // true = back to setup screen
            ui.showSetupScreen();
        }
    });


    ui.undoBtn?.addEventListener('click', () => {
        if (state.pvpRemoteActive) {
            ui.updateMessageArea("Deshacer no disponible en juegos de red.", true);
            return;
        }
        if (state.soundsInitialized) sound.playSound(sound.undoSound, "E3", "16n");
        gameLogic.handleUndo();
    });

    ui.numPlayersInput?.addEventListener('input', (e) => { // For local game player count
        if (state.pvpRemoteActive) return; // Don't change if network game is in progress/setup
        const count = parseInt(e.target.value);
        if (count >= 2 && count <= state.MAX_PLAYERS_LOCAL) {
            ui.generatePlayerSetupFields(count);
        }
    });
    
    // --- Network Play Button Event Listeners (Setup Screen) ---
    ui.hostGameButton?.addEventListener('click', async () => {
        if (!state.soundsInitialized) await sound.initSounds();
        if (state.soundsInitialized) sound.playSound(sound.uiClickSound, "C4", "16n");
        
        stopAnyActiveGameOrNetworkSession();
        state.setPvpRemoteActive(true); // Mark as a network game starting

        const gameSettings = {
            rows: parseInt(ui.rowsInput.value),
            cols: parseInt(ui.colsInput.value),
            maxPlayers: parseInt(ui.networkMaxPlayersSelect.value)
        };
        const hostPlayerData = getLocalPlayerCustomization(); // Get name, icon, color for the host

        ui.generatePlayerSetupFields(1, true); // Show only one customization for "self"

        // This will initialize peer, get an ID, then create a room concept
        peerConnection.hostNewRoom(hostPlayerData, gameSettings);
        // UI should transition to lobby, handled by peerConnection callbacks (e.g., onRoomCreated)
        // ui.showLobbyScreen(); // This might be called from peerConnection once host PeerID is open
        ui.updateGameModeUI();
    });

    ui.playRandomButton?.addEventListener('click', async () => {
        if (!state.soundsInitialized) await sound.initSounds();
        if (state.soundsInitialized) sound.playSound(sound.uiClickSound, "D4", "16n");

        stopAnyActiveGameOrNetworkSession();
        state.setPvpRemoteActive(true);

        const myPlayerData = getLocalPlayerCustomization();
        const preferences = {
            preferredPlayers: parseInt(ui.networkMaxPlayersSelect.value), // Use same selector for preference
            maxPlayers: parseInt(ui.networkMaxPlayersSelect.value),
            minPlayers: 2, // Default min
            // gameBoardSize: `${ui.rowsInput.value}x${ui.colsInput.value}` // Could send board preference
        };
        
        ui.generatePlayerSetupFields(1, true);
        ui.updateGameModeUI(); // Show "cancel matchmaking" etc.
        state.setNetworkRoomData({ roomState: 'seeking_match' });


        peerConnection.ensurePeerInitialized({
            onPeerOpen: (localPeerId) => {
                if (localPeerId) {
                    console.log(`[Main - Random Matching] My PeerJS ID for matchmaking: ${localPeerId}`);
                    matchmaking.joinQueue(localPeerId, myPlayerData, preferences, {
                        onSearching: () => {
                            ui.updateMessageArea("Buscando oponentes en la red...");
                            ui.showModalMessage("Buscando una sala al azar...");
                            if (ui.cancelMatchmakingButton) ui.cancelMatchmakingButton.classList.remove('hidden');
                        },
                        onMatchFoundAndJoiningRoom: (roomIdToJoin, roomLeaderPeerId, initialRoomData) => {
                            // A room was found, and we are joining it.
                            // matchmaking has decided we are a JOINER for this room.
                            console.log(`[Main - Random Matching] Match found! Joining Room ID: ${roomIdToJoin}, Leader: ${roomLeaderPeerId}`);
                            ui.hideModalMessage();
                            state.setNetworkRoomData({
                                roomId: roomIdToJoin,
                                leaderPeerId: roomLeaderPeerId,
                                isRoomLeader: false,
                                maxPlayers: initialRoomData.maxPlayers,
                                gameSettings: initialRoomData.gameSettings,
                                players: initialRoomData.players, // initial list, I will be added by leader
                                roomState: 'connecting_to_lobby'
                            });
                            peerConnection.joinRoomById(roomLeaderPeerId, myPlayerData); // Connect to the leader
                            if (ui.cancelMatchmakingButton) ui.cancelMatchmakingButton.classList.add('hidden');
                            // ui.showLobbyScreen(); // Will be shown once connection to leader is established and confirmed
                        },
                        onMatchFoundAndHostingRoom: (newRoomId, initialRoomData) => {
                            // No suitable room found, matchmaking determined I should HOST a new one.
                            // The peer (self) is already initialized.
                            console.log(`[Main - Random Matching] Match found! Hosting new Room ID: ${newRoomId}`);
                            ui.hideModalMessage();
                             state.setNetworkRoomData({ // Initial setup, peerConnection.hostNewRoom will finalize
                                roomId: newRoomId, // My peerId is the new room ID
                                leaderPeerId: localPeerId,
                                isRoomLeader: true,
                                maxPlayers: initialRoomData.maxPlayers, // From preferences
                                gameSettings: initialRoomData.gameSettings, // From preferences
                                roomState: 'waiting_for_players', // Or 'lobby'
                            });
                            // Call the hostNewRoom function in peerConnection to set up listeners and add self.
                            // This reuses the hosting logic.
                            peerConnection.hostNewRoom(myPlayerData, initialRoomData.gameSettings, true); // true for isRandomMatchHost
                            if (ui.cancelMatchmakingButton) ui.cancelMatchmakingButton.classList.add('hidden');
                        },
                        onError: (errMsg) => {
                            ui.hideModalMessage();
                            ui.showModalMessage(`Error de Matchmaking: ${errMsg}`);
                            if (ui.cancelMatchmakingButton) ui.cancelMatchmakingButton.classList.add('hidden');
                            state.setNetworkRoomData({ roomState: 'idle' });
                            ui.updateGameModeUI();
                        },
                        onTimeout: () => {
                            ui.hideModalMessage();
                            ui.showModalMessage("No se encontraron salas al azar. Intentá de nuevo más tarde o creá una sala.");
                            if (ui.cancelMatchmakingButton) ui.cancelMatchmakingButton.classList.add('hidden');
                            state.setNetworkRoomData({ roomState: 'idle' });
                            matchmaking.leaveQueue(); // Ensure left queue on timeout
                            ui.updateGameModeUI();
                        }
                    });
                } else {
                    ui.hideModalMessage();
                    ui.showModalMessage("Error: No se pudo obtener un ID de PeerJS para el matchmaking.");
                    if (ui.cancelMatchmakingButton) ui.cancelMatchmakingButton.classList.add('hidden');
                    state.setNetworkRoomData({ roomState: 'idle' });
                    ui.updateGameModeUI();
                }
            },
            onError: (err) => {
                ui.hideModalMessage();
                ui.showModalMessage(`Error al iniciar PeerJS para matchmaking: ${err.type || 'Desconocido'}`);
                if (ui.cancelMatchmakingButton) ui.cancelMatchmakingButton.classList.add('hidden');
                state.setNetworkRoomData({ roomState: 'idle' });
                ui.updateGameModeUI();
            }
        });
    });

    ui.cancelMatchmakingButton?.addEventListener('click', () => {
        if (state.soundsInitialized) sound.playSound(sound.uiClickSound, "A3", "16n");
        matchmaking.leaveQueue(); // Inform Supabase
        peerConnection.closePeerSession(); // Close any partial connections
        state.resetNetworkRoomData();
        state.setPvpRemoteActive(false);
        state.setNetworkRoomData({ roomState: 'idle'});
        ui.hideModalMessage();
        ui.updateMessageArea("Búsqueda de sala cancelada.");
        ui.showSetupScreen(); // Go back to setup
    });


    // --- Lobby Event Listeners ---
    ui.lobbyToggleReadyBtn?.addEventListener('click', () => {
        if (!state.pvpRemoteActive || !state.networkRoomData.roomId) return;
        if (state.soundsInitialized) sound.playSound(sound.uiClickSound, "G4", "16n");

        const myCurrentData = state.networkRoomData.players.find(p => p.peerId === state.myPeerId);
        if (myCurrentData) {
            const newReadyState = !myCurrentData.isReady;
            peerConnection.sendPlayerReadyState(newReadyState);
            // UI will be updated via onDataReceived -> updateLobbyUI
        }
    });

    ui.lobbyStartGameLeaderBtn?.addEventListener('click', () => {
        if (!state.pvpRemoteActive || !state.networkRoomData.isRoomLeader) return;
        if (state.soundsInitialized) sound.playSound(sound.gameStartSound, "C5", "8n");

        // Leader initiates game start
        // Ensure all players are ready (already checked by button's disabled state, but double check)
        const allReady = state.networkRoomData.players.length >= state.MIN_PLAYERS_NETWORK &&
                         state.networkRoomData.players.every(p => p.isReady && p.isConnected);
        if (allReady) {
            peerConnection.sendStartGameRequest();
        } else {
            ui.updateLobbyMessage("No todos los jugadores están listos.", true);
        }
    });

    ui.lobbyLeaveRoomBtn?.addEventListener('click', () => {
        if (state.soundsInitialized) sound.playSound(sound.uiClickSound, "D3", "16n");
        
        ui.showModalMessageWithActions("¿Seguro que querés salir de la sala?", [
            { text: "Sí, Salir", action: () => {
                stopAnyActiveGameOrNetworkSession(); // This will handle peerConnection.leaveRoom()
                ui.showSetupScreen();
                ui.hideModalMessage();
            }},
            { text: "No, Quedarme", action: ui.hideModalMessage, isCancel: true }
        ]);
    });


    // --- Modal Listeners ---
    ui.modalCloseBtn?.addEventListener('click', () => {
        if (state.soundsInitialized) sound.playSound(sound.modalCloseSound, "C2", "32n");
        ui.hideModalMessage();
    });
    window.addEventListener('click', (event) => { // Close modal on outside click
        if (event.target === ui.customModal) {
            if (state.soundsInitialized) sound.playSound(sound.modalCloseSound, "C2", "32n");
            ui.hideModalMessage();
        }
    });

    // --- Helper Functions ---
    function stopAnyActiveGameOrNetworkSession(preserveUIScreen = false) {
        console.log("[Main] stopAnyActiveGameOrNetworkSession called. Preserve UI:", preserveUIScreen);
        if (state.gameActive && !preserveUIScreen) { // If a game is active and we are not preserving UI (e.g. for abrupt end)
            gameLogic.endGameAbruptly(); // End local game logic if it was running
        } else if (state.gameActive) {
            state.setGameActive(false); // Just mark as inactive
        }

        if (state.pvpRemoteActive && state.networkRoomData.roomId) {
            peerConnection.leaveRoom(); // Inform others and close connections
        } else {
            peerConnection.closePeerSession(); // General cleanup if not in a specific room
        }
        
        matchmaking.leaveQueue(); // Ensure not stuck in Supabase queue

        state.resetNetworkRoomData();
        state.setPvpRemoteActive(false); // No longer in a network session

        if (!preserveUIScreen) {
            ui.showSetupScreen(); // Default to setup screen
            ui.updateGameModeUI();
        }
        if (ui.cancelMatchmakingButton) ui.cancelMatchmakingButton.classList.add('hidden');
        console.log("[Main] Any active game/network/matchmaking session stopped.");
    }


    function processUrlJoin() {
        const roomToJoin = window.cajitasJoinRoomOnLoad;
        if (!roomToJoin || !roomToJoin.roomId) {
            console.warn("[Main processUrlJoin] No room ID to process from URL.");
            // Fallback to normal init if room details are missing
            ui.showSetupScreen();
            ui.generatePlayerSetupFields(parseInt(ui.numPlayersInput?.value || "2"));
            ui.updateGameModeUI();
            peerConnection.ensurePeerInitialized(); // Ensure peer is up for potential use
            return;
        }

        console.log("[Main - processUrlJoin] Processing room join for:", roomToJoin.roomId);
        stopAnyActiveGameOrNetworkSession(true); // Stop existing, preserve UI for now
        state.setPvpRemoteActive(true);

        // Player customizes their own details before attempting to join
        ui.showSetupScreen(); // Show setup briefly for player customization
        ui.generatePlayerSetupFields(1, true); // Customize self
        ui.updateMessageArea(`Preparate para unirte a la sala ${roomToJoin.roomId}... Personalizá tus datos y luego conectaremos.`);

        // We need a way for the user to confirm their details before actually joining.
        // For now, let's assume they customize and then we'd need a "Join Room" button specific to this flow,
        // or we auto-join after a small delay/interaction.
        // Simplified: use a modal to confirm joining after they see their customization options.

        ui.showModalMessageWithActions(`¿Unirte a la sala ${roomToJoin.roomId}? Personalizá tus datos en la pantalla de configuración.`,[
            { text: "Sí, ¡Unirme!", action: () => {
                const joinerPlayerData = getLocalPlayerCustomization();
                
                state.setNetworkRoomData({
                    roomId: roomToJoin.roomId, // Target room ID
                    // leaderPeerId will be the roomToJoin.roomId if it's the leader's peerId
                    // isRoomLeader will be false
                    // maxPlayers might come from URL or be discovered
                    maxPlayers: roomToJoin.slots || state.MAX_PLAYERS_NETWORK,
                    roomState: 'connecting_to_lobby'
                });
                ui.updateGameModeUI(); // Reflect that a network process has started

                // The roomIdFromUrl is typically the leader's PeerId.
                peerConnection.joinRoomById(roomToJoin.roomId, joinerPlayerData);
                // UI will transition to lobby via peerConnection callbacks
                ui.hideModalMessage();
            }},
            { text: "No, Cancelar", action: () => {
                stopAnyActiveGameOrNetworkSession();
                ui.showSetupScreen();
                ui.hideModalMessage();
                window.history.replaceState({}, document.title, window.location.pathname); // Clear URL
                delete window.cajitasJoinRoomOnLoad;
            }, isCancel: true}
        ]);
                            
        // Clear the URL parameter after initiating the process (or on cancel)
        // Moved clearing to after confirmation/cancellation
    }

    // --- Initial PeerJS setup and URL processing ---
    if (window.cajitasJoinRoomOnLoad) {
        console.log("[Main - DOMContentLoaded] Processing URL join immediately");
        processUrlJoin(); // This will now guide user through customization then join
    } else {
        console.log("[Main - DOMContentLoaded] No room to join from URL, initializing PeerJS for potential future use");
        peerConnection.ensurePeerInitialized({ // Pre-init for hosting/random matching
            onPeerOpen: (id) => console.log('[Main] PeerJS pre-initialized on load (no room in URL). ID:', id),
            onError: (err) => console.warn('[Main] Benign PeerJS pre-init error (no room in URL):', err.type)
        });
    }

    console.log("Cajitas de Danielle: Main script initialized.");
});