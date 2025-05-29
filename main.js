// main.js

// VERY EARLY LOG: What is the URL when the script first runs?
console.log("[Main - Pre-DOM] Initial window.location.href:", window.location.href);
console.log("[Main - Pre-DOM] Initial window.location.search:", window.location.search);
console.log("[Main - Pre-DOM] Initial URLSearchParams:", new URLSearchParams(window.location.search));

import * as state from './state.js';
import * as ui from './ui.js';
import * as gameLogic from './gameLogic.js';
import * as sound from './sound.js';
import * as peerConnection from './peerConnection.js';
import * as matchmaking from './matchmaking_supabase.js';

function checkUrlForRoomAndJoinEarly() {
    console.log("[Main - Early URL Check] window.location.href:", window.location.href);
    const urlParams = new URLSearchParams(window.location.search);
    const roomIdFromUrl = urlParams.get('room');
    const slotsFromUrl = urlParams.get('slots');
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


function setupEventListeners() {
    console.log("[Main] Setting up event listeners...");

    const startGameBtn = document.getElementById('start-game-btn');
    const resetGameBtn = document.getElementById('reset-game-btn');
    const undoBtn = document.getElementById('undo-btn');
    const numPlayersInput = document.getElementById('num-players-input');
    const hostGameButton = document.getElementById('host-cajitas-btn');
    const playRandomButton = document.getElementById('play-random-cajitas-btn');
    const cancelMatchmakingButton = document.getElementById('cancel-matchmaking-btn');
    const lobbyToggleReadyBtn = document.getElementById('lobby-toggle-ready-btn');
    const lobbyStartGameLeaderBtn = document.getElementById('lobby-start-game-leader-btn');
    const lobbyLeaveRoomBtn = document.getElementById('lobby-leave-room-btn');
    const modalCloseBtn = document.getElementById('modal-close-btn');
    const customModal = document.getElementById('custom-modal');

    startGameBtn?.addEventListener('click', async () => {
        if (!state.soundsInitialized) await sound.initSounds();
        if (state.soundsInitialized) sound.playSound(sound.uiClickSound, "C4", "16n");

        stopAnyActiveGameOrNetworkSession(); // This resets pvpRemoteActive to false
        // state.setPvpRemoteActive(false); // Ensured by stopAnyActive...

        const numLocalPlayers = parseInt(document.getElementById('num-players-input').value);
        state.setGameDimensions(parseInt(document.getElementById('rows').value), parseInt(document.getElementById('cols').value));

        const localPlayers = [];
        for (let i = 0; i < numLocalPlayers; i++) {
            const name = document.getElementById(`player-name-${i}`)?.value || `Jugador ${i + 1}`;
            const icon = document.getElementById(`player-icon-${i}`)?.value || state.AVAILABLE_ICONS[i % state.AVAILABLE_ICONS.length];
            const color = document.getElementById(`player-color-${i}`)?.value || state.DEFAULT_PLAYER_COLORS[i % state.DEFAULT_PLAYER_COLORS.length];
            localPlayers.push({ id: i, name, icon, color, score: 0 }); // id is the playerIndex
        }
        state.setPlayersData(localPlayers); // Sets for active game

        gameLogic.initializeGame(false); // false for local game
        ui.showGameScreen();
    });

    resetGameBtn?.addEventListener('click', () => {
        if (state.soundsInitialized) sound.playSound(sound.uiClickSound, "E3", "16n");

        if (state.pvpRemoteActive && state.networkRoomData.roomId) {
            ui.showModalMessageWithActions("¿Reiniciar el juego o salir de la sala?", [
                { text: "Juego Nuevo (Local)", action: () => { stopAnyActiveGameOrNetworkSession(); gameLogic.resetGame(true); ui.showSetupScreen(); ui.hideModalMessage(); }},
                { text: "Salir de Sala", action: () => { stopAnyActiveGameOrNetworkSession(); ui.showSetupScreen(); ui.hideModalMessage(); } },
                { text: "Cancelar", action: ui.hideModalMessage, isCancel: true }
            ]);
        } else {
            stopAnyActiveGameOrNetworkSession();
            gameLogic.resetGame(true); // true for backToSetupScreen
            ui.showSetupScreen();
        }
    });

    undoBtn?.addEventListener('click', () => {
        if (state.pvpRemoteActive) {
            ui.updateMessageArea("Deshacer no disponible en juegos de red.", true);
            return;
        }
        if (state.soundsInitialized) sound.playSound(sound.undoSound, "E3", "16n");
        gameLogic.handleUndo();
    });

    numPlayersInput?.addEventListener('input', (e) => {
        if (state.pvpRemoteActive && state.networkRoomData.roomState !== 'idle' && state.networkRoomData.roomState !== 'setup') return; // Prevent changes if in a network session
        const count = parseInt(e.target.value);
        if (count >= 2 && count <= state.MAX_PLAYERS_LOCAL) {
            ui.generatePlayerSetupFields(count);
        }
    });

    hostGameButton?.addEventListener('click', async () => {
        console.log("[Main] Host game button clicked");
        if (!state.soundsInitialized) await sound.initSounds();
        if (state.soundsInitialized) sound.playSound(sound.uiClickSound, "C4", "16n");

        stopAnyActiveGameOrNetworkSession(); // Resets pvpRemoteActive, networkRoomData
        // state.setPvpRemoteActive(true); // Will be set by hostNewRoom or its flow

        const gameSettings = {
            rows: parseInt(document.getElementById('rows').value),
            cols: parseInt(document.getElementById('cols').value),
            maxPlayers: parseInt(document.getElementById('network-max-players').value)
        };
        const hostPlayerData = state.getLocalPlayerCustomizationForNetwork(); // Use state helper

        ui.generatePlayerSetupFields(1, true); // Setup UI for "self" as host
        try {
            await peerConnection.hostNewRoom(hostPlayerData, gameSettings);
            // UI transitions (lobby, QR code) are handled within hostNewRoom's logic (onPeerOpen)
            console.log("[Main] hostNewRoom promise resolved. Host setup should be complete.");
        } catch (error) {
            console.error("[Main] Error hosting new room:", error);
            ui.showModalMessage(`Error al crear la sala: ${error.message || 'Error desconocido'}`);
            stopAnyActiveGameOrNetworkSession(); // Cleanup
            ui.showSetupScreen();
        }
    });

    playRandomButton?.addEventListener('click', async () => {
        console.log("[Main] Play random button clicked");
        if (!state.soundsInitialized) await sound.initSounds();
        if (state.soundsInitialized) sound.playSound(sound.uiClickSound, "D4", "16n");

        stopAnyActiveGameOrNetworkSession();
        // state.setPvpRemoteActive(true); // Will be set by join/host flow

        const myPlayerData = state.getLocalPlayerCustomizationForNetwork();
        const preferences = {
            maxPlayers: parseInt(document.getElementById('network-max-players').value),
            gameSettings: {
                rows: parseInt(document.getElementById('rows').value) || 4,
                cols: parseInt(document.getElementById('cols').value) || 4,
            }
        };

        ui.generatePlayerSetupFields(1, true); // Setup UI for "self"
        state.setNetworkRoomData({ roomState: 'seeking_match' });
        ui.updateGameModeUI(); // Show "seeking match" UI if any

        try {
            // First, ensure PeerJS is up for us. This will set state.myPeerId.
            const localPeerId = await peerConnection.ensurePeerInitialized();
            if (!localPeerId) {
                throw new Error("No se pudo obtener un ID de PeerJS para el matchmaking.");
            }
            console.log(`[Main - Random Matching] My PeerJS ID for matchmaking: ${localPeerId}`);
            state.setPvpRemoteActive(true); // Now we are actively in PvP mode

            matchmaking.joinQueue(localPeerId, myPlayerData, preferences, {
                onSearching: () => {
                    ui.updateMessageArea("Buscando oponentes en la red...");
                    if (cancelMatchmakingButton) cancelMatchmakingButton.style.display = 'inline-block';
                    if (ui.networkInfoArea) {
                        ui.networkInfoArea.classList.remove('hidden');
                        if(ui.networkInfoTitle) ui.networkInfoTitle.textContent = "Buscando Partida...";
                        if(ui.networkInfoText) ui.networkInfoText.textContent = "Intentando encontrar oponentes al azar...";
                        if(ui.qrCodeContainer) ui.qrCodeContainer.innerHTML = '';
                    }
                },
                onMatchFoundAndJoiningRoom: async (roomIdToJoin, roomLeaderPeerId, initialRoomData) => {
                    console.log(`[Main - Random Matching] Match found! Joining Room ID (Leader PeerID): ${roomLeaderPeerId}`);
                    ui.hideModalMessage();
                    if (ui.networkInfoArea && ui.networkInfoTitle.textContent === "Buscando Partida...") ui.hideNetworkInfo();

                    // RoomIdToJoin is likely the leader's peerId (raw, without prefix)
                    // The state for joining will be set up by joinRoomById
                    try {
                        await peerConnection.joinRoomById(roomLeaderPeerId, myPlayerData);
                        console.log("[Main] joinRoomById for random match completed successfully.");
                        // UI transition to lobby is handled by joinRoomById's callbacks
                    } catch (joinError) {
                        console.error("[Main] Error joining room after random match found:", joinError);
                        ui.showModalMessage(`Error al unirse a la sala encontrada: ${joinError.message || 'Error desconocido'}`);
                        stopAnyActiveGameOrNetworkSession();
                        ui.showSetupScreen();
                    }
                    if (cancelMatchmakingButton) cancelMatchmakingButton.style.display = 'none';
                },
                onMatchFoundAndHostingRoom: async (newRoomHostPeerId, initialRoomData) => {
                    console.log(`[Main - Random Matching] No suitable room. Hosting new Room. My PeerID (raw): ${newRoomHostPeerId}`);
                    ui.hideModalMessage();
                    if (ui.networkInfoArea && ui.networkInfoTitle.textContent === "Buscando Partida...") ui.hideNetworkInfo();

                    try {
                        // newRoomHostPeerId is our localRawPeerId, hostNewRoom will use state.myPeerId
                        await peerConnection.hostNewRoom(myPlayerData, initialRoomData.gameSettings, true); // true for isRandomMatchHost
                        console.log("[Main - Random Matching] hostNewRoom completed for random match fallback.");
                    } catch (hostError) {
                        console.error("[Main - Random Matching] Error during hostNewRoom fallback:", hostError);
                        ui.showModalMessage(`Error al crear sala para matchmaking: ${hostError.message || hostError}`);
                        stopAnyActiveGameOrNetworkSession();
                        ui.showSetupScreen();
                    }
                    if (cancelMatchmakingButton) cancelMatchmakingButton.style.display = 'none';
                },
                onError: (errMsg) => {
                    ui.hideModalMessage();
                    if (ui.networkInfoArea && ui.networkInfoTitle.textContent === "Buscando Partida...") ui.hideNetworkInfo();
                    ui.showModalMessage(`Error de Matchmaking: ${errMsg}`);
                    if (cancelMatchmakingButton) cancelMatchmakingButton.style.display = 'none';
                    stopAnyActiveGameOrNetworkSession();
                    ui.showSetupScreen();
                },
                onTimeout: () => {
                    ui.hideModalMessage();
                    if (ui.networkInfoArea && ui.networkInfoTitle.textContent === "Buscando Partida...") ui.hideNetworkInfo();
                    ui.showModalMessage("No se encontraron salas al azar. Intentá de nuevo más tarde o creá una sala.");
                    if (cancelMatchmakingButton) cancelMatchmakingButton.style.display = 'none';
                    matchmaking.leaveQueue(localPeerId); // Ensure queue is left with our peerId
                    stopAnyActiveGameOrNetworkSession();
                    ui.showSetupScreen();
                }
            });
        } catch (initError) { // Error from ensurePeerInitialized
            ui.hideModalMessage();
            if (ui.networkInfoArea && ui.networkInfoTitle.textContent === "Buscando Partida...") ui.hideNetworkInfo();
            ui.showModalMessage(`Error al iniciar PeerJS para matchmaking: ${initError.message || 'Desconocido'}`);
            if (cancelMatchmakingButton) cancelMatchmakingButton.style.display = 'none';
            stopAnyActiveGameOrNetworkSession();
            ui.showSetupScreen();
        }
    });


    cancelMatchmakingButton?.addEventListener('click', () => {
        if (state.soundsInitialized) sound.playSound(sound.uiClickSound, "A3", "16n");
        matchmaking.leaveQueue(state.myPeerId); // Pass current peerId if available
        // peerConnection.closePeerSession(); // stopAnyActiveGame handles this
        stopAnyActiveGameOrNetworkSession(); // Resets states and UI
        ui.hideModalMessage();
        if (ui.networkInfoArea && ui.networkInfoTitle.textContent === "Buscando Partida...") {
             ui.hideNetworkInfo();
        }
        ui.updateMessageArea("Búsqueda de sala cancelada.");
        // ui.showSetupScreen(); // Called by stopAnyActive...
        if(cancelMatchmakingButton) cancelMatchmakingButton.style.display = 'none';
    });

    lobbyToggleReadyBtn?.addEventListener('click', () => {
        if (!state.pvpRemoteActive || !state.networkRoomData.roomId) return;
        if (state.soundsInitialized) sound.playSound(sound.uiClickSound, "G4", "16n");

        const myCurrentData = state.networkRoomData.players.find(p => p.peerId === state.myPeerId);
        if (myCurrentData) {
            const newReadyState = !myCurrentData.isReady;
            peerConnection.sendPlayerReadyState(newReadyState);
            // UI update will come from peerConnection based on broadcast or direct ack
        }
    });

    lobbyStartGameLeaderBtn?.addEventListener('click', () => {
        if (!state.pvpRemoteActive || !state.networkRoomData.isRoomLeader) return;
        if (state.soundsInitialized) sound.playSound(sound.gameStartSound, "C5", "8n");

        const allReady = state.networkRoomData.players.length >= state.MIN_PLAYERS_NETWORK &&
                         state.networkRoomData.players.every(p => p.isReady && p.isConnected);
        if (allReady) {
            peerConnection.sendStartGameRequest(); // This will initiate game start for all
        } else {
            ui.updateLobbyMessage("No todos los jugadores están listos o conectados.", true);
        }
    });

    lobbyLeaveRoomBtn?.addEventListener('click', () => {
        if (state.soundsInitialized) sound.playSound(sound.uiClickSound, "D3", "16n");

        ui.showModalMessageWithActions("¿Seguro que querés salir de la sala?", [
            { text: "Sí, Salir", action: () => {
                stopAnyActiveGameOrNetworkSession();
                ui.showSetupScreen();
                ui.hideModalMessage();
            }},
            { text: "No, Quedarme", action: ui.hideModalMessage, isCancel: true }
        ]);
    });

    modalCloseBtn?.addEventListener('click', () => {
        if (state.soundsInitialized) sound.playSound(sound.modalCloseSound, "C2", "32n");
        ui.hideModalMessage();
    });

    window.addEventListener('click', (event) => {
        if (event.target === customModal) {
            // Only close if no dynamic buttons are present, or make it smarter
            if (modalDynamicButtons && modalDynamicButtons.children.length === 0) {
                if (state.soundsInitialized) sound.playSound(sound.modalCloseSound, "C2", "32n");
                ui.hideModalMessage();
            }
        }
    });

    console.log("[Main] Event listeners setup complete");
}

function stopAnyActiveGameOrNetworkSession(preserveUIScreen = false) {
    console.log("[Main] stopAnyActiveGameOrNetworkSession called. Preserve UI:", preserveUIScreen);

    const wasPvpActive = state.pvpRemoteActive;
    const currentRoomId = state.networkRoomData.roomId;
    const isLeader = state.networkRoomData.isRoomLeader;

    if (state.gameActive) { // If a game (local or network) is active
        gameLogic.endGameAbruptly(); // This sets state.gameActive = false
    } else {
        state.setGameActive(false); // Ensure it's false
    }

    if (wasPvpActive) {
        if (currentRoomId) {
            peerConnection.leaveRoom(); // Informs others if leader, closes connection if client
        }
        // matchmaking.leaveQueue might have been called by leaveRoom if leader,
        // or by cancel matchmaking button. Call it again defensively if we were searching.
        if (state.networkRoomData.roomState === 'seeking_match' && state.myPeerId) {
            matchmaking.leaveQueue(state.myPeerId);
        }
        peerConnection.closePeerSession(); // Destroys the peer object
    }


    // Reset all relevant state for starting fresh
    state.resetFullLocalStateForNewGame(); // This resets playersData, game flow, and networkRoomData, pvpRemoteActive

    if (!preserveUIScreen) {
        ui.showSetupScreen(); // This also calls ui.updateGameModeUI()
    } else {
        ui.updateGameModeUI(); // Ensure UI reflects the new idle state
    }

    const cancelBtn = document.getElementById('cancel-matchmaking-btn');
    if (cancelBtn) cancelBtn.style.display = 'none';

    console.log("[Main] Any active game/network/matchmaking session stopped. UI preserverd:", preserveUIScreen);
}


async function processUrlJoin() { // Make async
    const roomToJoin = window.cajitasJoinRoomOnLoad;
    if (!roomToJoin || !roomToJoin.roomId) {
        console.warn("[Main processUrlJoin] No room ID to process from URL.");
        ui.showSetupScreen();
        ui.generatePlayerSetupFields(parseInt(document.getElementById('num-players-input')?.value || "2"));
        try {
            await peerConnection.ensurePeerInitialized(); // Ensure peer is ready for manual hosting/joining
        } catch (e) { console.error("[Main] Error pre-initializing peer for no-URL scenario:", e); }
        return;
    }

    console.log("[Main - processUrlJoin] Processing room join for:", roomToJoin.roomId);

    ui.showSetupScreen(); // Show setup for player customization
    ui.generatePlayerSetupFields(1, true); // For "Your Name", "Your Icon", etc.

    // Delay for DOM rendering and to ensure user sees the setup screen briefly
    await new Promise(resolve => setTimeout(resolve, 100));

    stopAnyActiveGameOrNetworkSession(true); // true to preserve UI for the modal
    // state.setPvpRemoteActive(true); // Will be set by joinRoomById flow

    ui.showModalMessageWithActions(
        `¿Unirte a la sala ${state.CAJITAS_PEER_ID_PREFIX}${roomToJoin.roomId}? Personalizá tus datos en la pantalla de configuración si es necesario.`,
        [
            {
                text: "Sí, ¡Unirme!",
                action: async () => {
                    ui.hideModalMessage(); // Hide before attempting to join
                    const joinerPlayerData = state.getLocalPlayerCustomizationForNetwork();
                    // state.setPvpRemoteActive(true); // Set before joinRoomById
                    // state.setNetworkRoomData({ // Basic setup, peerConnection.joinRoomById will refine
                    //     roomId: roomToJoin.roomId, // This is the raw peer ID from URL
                    //     leaderPeerId: roomToJoin.roomId,
                    //     isRoomLeader: false,
                    //     maxPlayers: roomToJoin.slots || state.MAX_PLAYERS_NETWORK,
                    //     roomState: 'connecting_to_lobby'
                    // });
                    // ui.updateGameModeUI(); // Reflects connecting state

                    try {
                        await peerConnection.joinRoomById(roomToJoin.roomId, joinerPlayerData);
                        // Successfully initiated join, peerConnection callbacks will handle UI (e.g., lobby)
                        console.log("[Main processUrlJoin] joinRoomById initiated.");
                        // ui.hideModalMessage(); // Moved up
                    } catch (error) {
                        console.error("[Main processUrlJoin] Error initiating joinRoomById:", error);
                        ui.showModalMessage(`Error al intentar unirse: ${error.message || 'Error desconocido'}`);
                        stopAnyActiveGameOrNetworkSession();
                        ui.showSetupScreen();
                         window.history.replaceState({}, document.title, window.location.pathname); // Clear URL param
                         delete window.cajitasJoinRoomOnLoad;
                    }
                }
            },
            {
                text: "No, Cancelar",
                action: () => {
                    ui.hideModalMessage();
                    stopAnyActiveGameOrNetworkSession();
                    ui.showSetupScreen();
                    window.history.replaceState({}, document.title, window.location.pathname); // Clear URL param
                    delete window.cajitasJoinRoomOnLoad;
                },
                isCancel: true
            }
        ]
    );
}

document.addEventListener('DOMContentLoaded', async () => { // Make async
    console.log("Cajitas de Danielle: DOM fully loaded and parsed");
    console.log("[Main - DOMContentLoaded] window.cajitasJoinRoomOnLoad:", window.cajitasJoinRoomOnLoad);

    setupEventListeners(); // Setup all button clicks etc.

    if (window.cajitasJoinRoomOnLoad && window.cajitasJoinRoomOnLoad.roomId) {
        console.log("[Main - DOMContentLoaded] Processing URL join immediately");
        await processUrlJoin(); // processUrlJoin is now async
    } else {
        console.log("[Main - DOMContentLoaded] No room to join from URL, showing setup screen and pre-initializing PeerJS.");
        ui.showSetupScreen(); // Default screen
        // Generate fields for local play by default
        ui.generatePlayerSetupFields(parseInt(document.getElementById('num-players-input')?.value || "2"));
        const undoBtn = document.getElementById('undo-btn');
        if (undoBtn) undoBtn.disabled = true; // Undo not possible at start

        // Pre-initialize PeerJS so it's ready faster if user hosts/joins manually
        try {
            await peerConnection.ensurePeerInitialized();
             console.log('[Main] PeerJS pre-initialized on load (no room in URL). My ID (if available):', state.myPeerId);
        } catch (err) {
            console.warn('[Main] Benign PeerJS pre-init error (no room in URL):', err.type, err.message || err);
            // Not critical if this fails, will re-attempt on host/join.
        }
    }
    state.logCurrentState("DOMContentLoaded End");
    console.log("Cajitas de Danielle: Main script initialized.");
});