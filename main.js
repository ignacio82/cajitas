// main.js

// VERY EARLY LOG: What is the URL when the script first runs?
console.log("[Main - Pre-DOM] Initial window.location.href:", window.location.href);
console.log("[Main - Pre-DOM] Initial window.location.search:", window.location.search);
console.log("[Main - Pre-DOM] Initial URLSearchParams:", new URLSearchParams(window.location.search));

import * as state from './state.js';
import * as ui from './ui.js';
import * as gameLogic from './gameLogic.js';
import * as sound from './sound.js'; // Ensure sound is imported
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
    const undoBtn = document.getElementById('undo-btn'); // Undo haptics are in gameLogic.js
    const numPlayersInput = document.getElementById('num-players-input');
    const hostGameButton = document.getElementById('host-cajitas-btn');
    const playRandomButton = document.getElementById('play-random-cajitas-btn');
    const cancelMatchmakingButton = document.getElementById('cancel-matchmaking-btn');
    const lobbyToggleReadyBtn = document.getElementById('lobby-toggle-ready-btn');
    const lobbyStartGameLeaderBtn = document.getElementById('lobby-start-game-leader-btn');
    const lobbyLeaveRoomBtn = document.getElementById('lobby-leave-room-btn');
    const modalCloseBtn = document.getElementById('modal-close-btn');
    const customModal = document.getElementById('custom-modal'); // For background click close

    startGameBtn?.addEventListener('click', async () => {
        if (!state.soundsInitialized) await sound.initSounds();
        if (state.soundsInitialized && sound.uiClickSound) {
            sound.playSound(sound.uiClickSound, "C4", "16n");
            if (typeof sound.triggerVibration === 'function') sound.triggerVibration(35); // Slightly stronger for start
        }

        stopAnyActiveGameOrNetworkSession(); 
        const numLocalPlayers = parseInt(document.getElementById('num-players-input').value);
        state.setGameDimensions(parseInt(document.getElementById('rows').value), parseInt(document.getElementById('cols').value));

        const localPlayers = [];
        for (let i = 0; i < numLocalPlayers; i++) {
            const name = document.getElementById(`player-name-${i}`)?.value || `Jugador ${i + 1}`;
            const icon = document.getElementById(`player-icon-${i}`)?.value || state.AVAILABLE_ICONS[i % state.AVAILABLE_ICONS.length];
            const color = document.getElementById(`player-color-${i}`)?.value || state.DEFAULT_PLAYER_COLORS[i % state.DEFAULT_PLAYER_COLORS.length];
            localPlayers.push({ id: i, name, icon, color, score: 0 });
        }
        state.setPlayersData(localPlayers); 

        gameLogic.initializeGame(false); 
        ui.showGameScreen();
        if (state.soundsInitialized && sound.gameStartSound) { // Game start sound for local game too
             sound.playSound(sound.gameStartSound, "C5", "8n");
             if (typeof sound.triggerVibration === 'function') sound.triggerVibration([50,30,100]);
        }
    });

    resetGameBtn?.addEventListener('click', () => {
        if (state.soundsInitialized && sound.uiClickSound) {
            sound.playSound(sound.uiClickSound, "E3", "16n");
            if (typeof sound.triggerVibration === 'function') sound.triggerVibration(30);
        }

        if (state.pvpRemoteActive && state.networkRoomData.roomId) {
            ui.showModalMessageWithActions("¿Reiniciar el juego o salir de la sala?", [
                { text: "Juego Nuevo (Local)", action: () => { stopAnyActiveGameOrNetworkSession(); gameLogic.resetGame(true); ui.showSetupScreen(); ui.hideModalMessage(); }},
                { text: "Salir de Sala", action: () => { stopAnyActiveGameOrNetworkSession(); ui.showSetupScreen(); ui.hideModalMessage(); } },
                { text: "Cancelar", action: ui.hideModalMessage, isCancel: true }
            ]);
        } else {
            stopAnyActiveGameOrNetworkSession();
            gameLogic.resetGame(true); 
            ui.showSetupScreen();
        }
    });

    // Undo button's haptic feedback is handled in gameLogic.js via handleUndo()
    undoBtn?.addEventListener('click', () => {
        if (state.pvpRemoteActive) {
            ui.updateMessageArea("Deshacer no disponible en juegos de red.", true);
            // No sound or haptic for this specific error message path, or add error haptic here
            if(sound.errorSound && typeof sound.playSound === 'function') sound.playSound(sound.errorSound, undefined, "16n");
            if(typeof sound.triggerVibration === 'function') sound.triggerVibration([70,50,70]);
            return;
        }
        // gameLogic.handleUndo() will play sound and haptic
        gameLogic.handleUndo();
    });

    numPlayersInput?.addEventListener('input', (e) => {
        if (state.pvpRemoteActive && state.networkRoomData.roomState !== 'idle' && state.networkRoomData.roomState !== 'setup') return; 
        const count = parseInt(e.target.value);
        if (count >= 2 && count <= state.MAX_PLAYERS_LOCAL) {
            ui.generatePlayerSetupFields(count);
            // Optional: haptic for input change if desired, e.g., sound.triggerVibration(10);
        }
    });

    hostGameButton?.addEventListener('click', async () => {
        console.log("[Main] Host game button clicked");
        if (!state.soundsInitialized) await sound.initSounds();
        if (state.soundsInitialized && sound.uiClickSound) {
            sound.playSound(sound.uiClickSound, "C4", "16n");
            if (typeof sound.triggerVibration === 'function') sound.triggerVibration(30);
        }

        stopAnyActiveGameOrNetworkSession(); 
        const gameSettings = {
            rows: parseInt(document.getElementById('rows').value),
            cols: parseInt(document.getElementById('cols').value),
            maxPlayers: parseInt(document.getElementById('network-max-players').value)
        };
        const hostPlayerData = state.getLocalPlayerCustomizationForNetwork(); 

        ui.generatePlayerSetupFields(1, true); 
        try {
            await peerConnection.hostNewRoom(hostPlayerData, gameSettings);
            console.log("[Main] hostNewRoom promise resolved. Host setup should be complete.");
            // Potentially a success haptic here if hostNewRoom itself doesn't cover it via modal/UI change sounds
        } catch (error) {
            console.error("[Main] Error hosting new room:", error);
            ui.showModalMessage(`Error al crear la sala: ${error.message || 'Error desconocido'}`);
            if (typeof sound.triggerVibration === 'function') sound.triggerVibration([70,50,70]); // Error haptic
            stopAnyActiveGameOrNetworkSession(); 
            ui.showSetupScreen();
        }
    });

    playRandomButton?.addEventListener('click', async () => {
        console.log("[Main] Play random button clicked");
        if (!state.soundsInitialized) await sound.initSounds();
        if (state.soundsInitialized && sound.uiClickSound) {
            sound.playSound(sound.uiClickSound, "D4", "16n");
            if (typeof sound.triggerVibration === 'function') sound.triggerVibration(30);
        }

        stopAnyActiveGameOrNetworkSession();
        const myPlayerData = state.getLocalPlayerCustomizationForNetwork();
        const preferences = {
            maxPlayers: parseInt(document.getElementById('network-max-players').value),
            gameSettings: {
                rows: parseInt(document.getElementById('rows').value) || 4,
                cols: parseInt(document.getElementById('cols').value) || 4,
            }
        };

        ui.generatePlayerSetupFields(1, true); 
        state.setNetworkRoomData({ roomState: 'seeking_match' });
        ui.updateGameModeUI(); 

        try {
            const localPeerId = await peerConnection.ensurePeerInitialized();
            if (!localPeerId) {
                throw new Error("No se pudo obtener un ID de PeerJS para el matchmaking.");
            }
            console.log(`[Main - Random Matching] My PeerJS ID for matchmaking: ${localPeerId}`);
            state.setPvpRemoteActive(true); 

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
                    ui.hideModalMessage(); // Hide searching modal if any
                    if (ui.networkInfoArea && ui.networkInfoTitle.textContent === "Buscando Partida...") ui.hideNetworkInfo();
                    if (typeof sound.triggerVibration === 'function') sound.triggerVibration(40); // Haptic for match found

                    try {
                        await peerConnection.joinRoomById(roomLeaderPeerId, myPlayerData);
                        console.log("[Main] joinRoomById for random match completed successfully.");
                    } catch (joinError) {
                        console.error("[Main] Error joining room after random match found:", joinError);
                        ui.showModalMessage(`Error al unirse a la sala encontrada: ${joinError.message || 'Error desconocido'}`);
                        if (typeof sound.triggerVibration === 'function') sound.triggerVibration([70,50,70]); // Error haptic
                        stopAnyActiveGameOrNetworkSession();
                        ui.showSetupScreen();
                    }
                    if (cancelMatchmakingButton) cancelMatchmakingButton.style.display = 'none';
                },
                onMatchFoundAndHostingRoom: async (newRoomHostPeerId, initialRoomData) => {
                    console.log(`[Main - Random Matching] No suitable room. Hosting new Room. My PeerID (raw): ${newRoomHostPeerId}`);
                    ui.hideModalMessage();
                    if (ui.networkInfoArea && ui.networkInfoTitle.textContent === "Buscando Partida...") ui.hideNetworkInfo();
                    if (typeof sound.triggerVibration === 'function') sound.triggerVibration(40); // Haptic for becoming host

                    try {
                        await peerConnection.hostNewRoom(myPlayerData, initialRoomData.gameSettings, true); 
                        console.log("[Main - Random Matching] hostNewRoom completed for random match fallback.");
                    } catch (hostError) {
                        console.error("[Main - Random Matching] Error during hostNewRoom fallback:", hostError);
                        ui.showModalMessage(`Error al crear sala para matchmaking: ${hostError.message || hostError}`);
                        if (typeof sound.triggerVibration === 'function') sound.triggerVibration([70,50,70]); // Error haptic
                        stopAnyActiveGameOrNetworkSession();
                        ui.showSetupScreen();
                    }
                    if (cancelMatchmakingButton) cancelMatchmakingButton.style.display = 'none';
                },
                onError: (errMsg) => {
                    ui.hideModalMessage();
                    if (ui.networkInfoArea && ui.networkInfoTitle.textContent === "Buscando Partida...") ui.hideNetworkInfo();
                    ui.showModalMessage(`Error de Matchmaking: ${errMsg}`);
                    if (typeof sound.triggerVibration === 'function') sound.triggerVibration([70,50,70]); // Error haptic
                    if (cancelMatchmakingButton) cancelMatchmakingButton.style.display = 'none';
                    stopAnyActiveGameOrNetworkSession();
                    ui.showSetupScreen();
                },
                onTimeout: () => {
                    ui.hideModalMessage();
                    if (ui.networkInfoArea && ui.networkInfoTitle.textContent === "Buscando Partida...") ui.hideNetworkInfo();
                    ui.showModalMessage("No se encontraron salas al azar. Intentá de nuevo más tarde o creá una sala.");
                    if (typeof sound.triggerVibration === 'function') sound.triggerVibration(40); // Neutral haptic for timeout
                    if (cancelMatchmakingButton) cancelMatchmakingButton.style.display = 'none';
                    matchmaking.leaveQueue(state.myPeerId); 
                    stopAnyActiveGameOrNetworkSession();
                    ui.showSetupScreen();
                }
            });
        } catch (initError) { 
            ui.hideModalMessage();
            if (ui.networkInfoArea && ui.networkInfoTitle.textContent === "Buscando Partida...") ui.hideNetworkInfo();
            ui.showModalMessage(`Error al iniciar PeerJS para matchmaking: ${initError.message || 'Desconocido'}`);
            if (typeof sound.triggerVibration === 'function') sound.triggerVibration([70,50,70]); // Error haptic
            if (cancelMatchmakingButton) cancelMatchmakingButton.style.display = 'none';
            stopAnyActiveGameOrNetworkSession();
            ui.showSetupScreen();
        }
    });


    cancelMatchmakingButton?.addEventListener('click', () => {
        if (state.soundsInitialized && sound.uiClickSound) {
            sound.playSound(sound.uiClickSound, "A3", "16n");
            if (typeof sound.triggerVibration === 'function') sound.triggerVibration(30);
        }
        matchmaking.leaveQueue(state.myPeerId); 
        stopAnyActiveGameOrNetworkSession(); 
        ui.hideModalMessage();
        if (ui.networkInfoArea && ui.networkInfoTitle.textContent === "Buscando Partida...") {
             ui.hideNetworkInfo();
        }
        ui.updateMessageArea("Búsqueda de sala cancelada.");
        if(cancelMatchmakingButton) cancelMatchmakingButton.style.display = 'none';
    });

    lobbyToggleReadyBtn?.addEventListener('click', () => {
        if (!state.pvpRemoteActive || !state.networkRoomData.roomId) return;
        if (state.soundsInitialized && sound.uiClickSound) {
            sound.playSound(sound.uiClickSound, "G4", "16n");
            if (typeof sound.triggerVibration === 'function') sound.triggerVibration(30);
        }

        const myCurrentData = state.networkRoomData.players.find(p => p.peerId === state.myPeerId);
        if (myCurrentData) {
            const newReadyState = !myCurrentData.isReady;
            peerConnection.sendPlayerReadyState(newReadyState);
        }
    });

    lobbyStartGameLeaderBtn?.addEventListener('click', () => {
        if (!state.pvpRemoteActive || !state.networkRoomData.isRoomLeader) return;
        if (state.soundsInitialized && sound.gameStartSound) {
            sound.playSound(sound.gameStartSound, "C5", "8n");
            if (typeof sound.triggerVibration === 'function') sound.triggerVibration([50, 30, 100]); // Game start haptic
        }

        const allReady = state.networkRoomData.players.length >= state.MIN_PLAYERS_NETWORK &&
                         state.networkRoomData.players.every(p => p.isReady && p.isConnected !== false);
        if (allReady) {
            peerConnection.sendStartGameRequest(); 
        } else {
            ui.updateLobbyMessage("No todos los jugadores están listos o conectados.", true);
            if (typeof sound.triggerVibration === 'function') sound.triggerVibration([70,50,70]); // Error haptic
        }
    });

    lobbyLeaveRoomBtn?.addEventListener('click', () => {
        if (state.soundsInitialized && sound.uiClickSound) {
            sound.playSound(sound.uiClickSound, "D3", "16n");
            if (typeof sound.triggerVibration === 'function') sound.triggerVibration(30);
        }

        ui.showModalMessageWithActions("¿Seguro que querés salir de la sala?", [
            { text: "Sí, Salir", action: () => {
                if (typeof sound.triggerVibration === 'function') sound.triggerVibration(25); // Confirm action haptic
                stopAnyActiveGameOrNetworkSession();
                ui.showSetupScreen();
                ui.hideModalMessage();
            }},
            { text: "No, Quedarme", action: () => {
                if (typeof sound.triggerVibration === 'function') sound.triggerVibration(25); // Confirm action haptic
                ui.hideModalMessage();
            }, isCancel: true }
        ]);
    });

    modalCloseBtn?.addEventListener('click', () => {
        if (state.soundsInitialized && sound.modalCloseSound) {
            sound.playSound(sound.modalCloseSound, "C2", "32n");
            if (typeof sound.triggerVibration === 'function') sound.triggerVibration(20); // Haptic for modal close
        }
        ui.hideModalMessage();
    });

    // Haptic for modal open can be added in ui.js showModalMessage functions if desired
    // e.g., in ui.js:
    // export function showModalMessage(message) {
    //   ...
    //   if(sound.modalOpenSound && typeof sound.playSound === 'function') sound.playSound(sound.modalOpenSound, "C5", "32n");
    //   if(typeof sound.triggerVibration === 'function') sound.triggerVibration(20);
    //   ...
    // }


    window.addEventListener('click', (event) => {
        if (event.target === customModal) {
            if (modalDynamicButtons && modalDynamicButtons.children.length === 0) {
                if (state.soundsInitialized && sound.modalCloseSound) {
                     sound.playSound(sound.modalCloseSound, "C2", "32n");
                     if (typeof sound.triggerVibration === 'function') sound.triggerVibration(20);
                }
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
    // const isLeader = state.networkRoomData.isRoomLeader; // Not directly used here but good for context

    if (state.gameActive) { 
        gameLogic.endGameAbruptly(); // This sets state.gameActive = false and plays haptic
    } else {
        state.setGameActive(false); 
    }

    if (wasPvpActive) {
        if (currentRoomId) {
            peerConnection.leaveRoom(); 
        }
        if (state.networkRoomData.roomState === 'seeking_match' && state.myPeerId) {
            matchmaking.leaveQueue(state.myPeerId);
        }
        peerConnection.closePeerSession(); 
    }

    state.resetFullLocalStateForNewGame(); 

    if (!preserveUIScreen) {
        ui.showSetupScreen(); 
    } else {
        ui.updateGameModeUI(); 
    }

    const cancelBtn = document.getElementById('cancel-matchmaking-btn');
    if (cancelBtn) cancelBtn.style.display = 'none';

    console.log("[Main] Any active game/network/matchmaking session stopped. UI preserverd:", preserveUIScreen);
}


async function processUrlJoin() { 
    const roomToJoin = window.cajitasJoinRoomOnLoad;
    if (!roomToJoin || !roomToJoin.roomId) {
        console.warn("[Main processUrlJoin] No room ID to process from URL.");
        ui.showSetupScreen();
        ui.generatePlayerSetupFields(parseInt(document.getElementById('num-players-input')?.value || "2"));
        try {
            await peerConnection.ensurePeerInitialized(); 
        } catch (e) { console.error("[Main] Error pre-initializing peer for no-URL scenario:", e); }
        return;
    }

    console.log("[Main - processUrlJoin] Processing room join for:", roomToJoin.roomId);

    ui.showSetupScreen(); 
    ui.generatePlayerSetupFields(1, true); 

    await new Promise(resolve => setTimeout(resolve, 100));

    stopAnyActiveGameOrNetworkSession(true); 

    // Modal open sound/haptic could be triggered by showModalMessageWithActions itself if ui.js is modified
    // For now, the action buttons within the modal will have haptics.
    ui.showModalMessageWithActions(
        `¿Unirte a la sala ${state.CAJITAS_PEER_ID_PREFIX}${roomToJoin.roomId}? Personalizá tus datos en la pantalla de configuración si es necesario.`,
        [
            {
                text: "Sí, ¡Unirme!",
                action: async () => {
                    if (state.soundsInitialized && sound.uiClickSound) { // Sound for modal button
                        sound.playSound(sound.uiClickSound, "E4", "16n");
                        if (typeof sound.triggerVibration === 'function') sound.triggerVibration(30);
                    }
                    ui.hideModalMessage(); 
                    const joinerPlayerData = state.getLocalPlayerCustomizationForNetwork();
                    try {
                        await peerConnection.joinRoomById(roomToJoin.roomId, joinerPlayerData);
                        console.log("[Main processUrlJoin] joinRoomById initiated.");
                    } catch (error) {
                        console.error("[Main processUrlJoin] Error initiating joinRoomById:", error);
                        ui.showModalMessage(`Error al intentar unirse: ${error.message || 'Error desconocido'}`);
                        if (typeof sound.triggerVibration === 'function') sound.triggerVibration([70,50,70]); // Error haptic
                        stopAnyActiveGameOrNetworkSession();
                        ui.showSetupScreen();
                         window.history.replaceState({}, document.title, window.location.pathname); 
                         delete window.cajitasJoinRoomOnLoad;
                    }
                }
            },
            {
                text: "No, Cancelar",
                action: () => {
                    if (state.soundsInitialized && sound.uiClickSound) { // Sound for modal button
                        sound.playSound(sound.uiClickSound, "C4", "16n");
                         if (typeof sound.triggerVibration === 'function') sound.triggerVibration(30);
                    }
                    ui.hideModalMessage();
                    stopAnyActiveGameOrNetworkSession();
                    ui.showSetupScreen();
                    window.history.replaceState({}, document.title, window.location.pathname); 
                    delete window.cajitasJoinRoomOnLoad;
                },
                isCancel: true
            }
        ]
    );
}

document.addEventListener('DOMContentLoaded', async () => { 
    console.log("Cajitas de Danielle: DOM fully loaded and parsed");
    console.log("[Main - DOMContentLoaded] window.cajitasJoinRoomOnLoad:", window.cajitasJoinRoomOnLoad);

    setupEventListeners(); 

    if (window.cajitasJoinRoomOnLoad && window.cajitasJoinRoomOnLoad.roomId) {
        console.log("[Main - DOMContentLoaded] Processing URL join immediately");
        await processUrlJoin(); 
    } else {
        console.log("[Main - DOMContentLoaded] No room to join from URL, showing setup screen and pre-initializing PeerJS.");
        ui.showSetupScreen(); 
        ui.generatePlayerSetupFields(parseInt(document.getElementById('num-players-input')?.value || "2"));
        const undoBtnDOM = document.getElementById('undo-btn'); // Renamed to avoid conflict with undoBtn in setupEventListeners
        if (undoBtnDOM) undoBtnDOM.disabled = true; 

        try {
            await peerConnection.ensurePeerInitialized();
             console.log('[Main] PeerJS pre-initialized on load (no room in URL). My ID (if available):', state.myPeerId);
        } catch (err) {
            console.warn('[Main] Benign PeerJS pre-init error (no room in URL):', err.type, err.message || err);
        }
    }
    state.logCurrentState("DOMContentLoaded End");
    console.log("Cajitas de Danielle: Main script initialized.");
});