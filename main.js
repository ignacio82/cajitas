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

        stopAnyActiveGameOrNetworkSession();
        state.setPvpRemoteActive(false); 

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
    });

    resetGameBtn?.addEventListener('click', () => { 
        if (state.soundsInitialized) sound.playSound(sound.uiClickSound, "E3", "16n");
        
        if (state.pvpRemoteActive && state.networkRoomData.roomId) {
            ui.showModalMessageWithActions("¿Reiniciar el juego o salir de la sala?", [
                { text: "Juego Nuevo (Local)", action: () => { stopAnyActiveGameOrNetworkSession(); gameLogic.resetGame(true); ui.showSetupScreen(); ui.hideModalMessage(); }},
                ...(state.pvpRemoteActive ? [{ text: "Salir de Sala", action: () => { stopAnyActiveGameOrNetworkSession(); ui.showSetupScreen(); ui.hideModalMessage(); } }] : []),
                { text: "Cancelar", action: ui.hideModalMessage, isCancel: true }
            ]);
        } else { 
            stopAnyActiveGameOrNetworkSession();
            gameLogic.resetGame(true);
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
        if (state.pvpRemoteActive) return;
        const count = parseInt(e.target.value);
        if (count >= 2 && count <= state.MAX_PLAYERS_LOCAL) {
            ui.generatePlayerSetupFields(count);
        }
    });
    
    hostGameButton?.addEventListener('click', async () => {
        console.log("[Main] Host game button clicked");
        if (!state.soundsInitialized) await sound.initSounds();
        if (state.soundsInitialized) sound.playSound(sound.uiClickSound, "C4", "16n");
        
        stopAnyActiveGameOrNetworkSession();
        state.setPvpRemoteActive(true);

        const gameSettings = {
            rows: parseInt(document.getElementById('rows').value),
            cols: parseInt(document.getElementById('cols').value),
            maxPlayers: parseInt(document.getElementById('network-max-players').value)
        };
        const hostPlayerData = getLocalPlayerCustomization();

        ui.generatePlayerSetupFields(1, true); 
        peerConnection.hostNewRoom(hostPlayerData, gameSettings);
        // Note: ui.updateGameModeUI() was removed from here in a previous fix, which is correct.
        // It will be called from within peerConnection.js's onPeerOpen flow.
    });

    playRandomButton?.addEventListener('click', async () => {
        console.log("[Main] Play random button clicked");
        if (!state.soundsInitialized) await sound.initSounds();
        if (state.soundsInitialized) sound.playSound(sound.uiClickSound, "D4", "16n");

        stopAnyActiveGameOrNetworkSession();
        state.setPvpRemoteActive(true);

        const myPlayerData = getLocalPlayerCustomization();
        const preferences = {
            preferredPlayers: parseInt(document.getElementById('network-max-players').value),
            maxPlayers: parseInt(document.getElementById('network-max-players').value),
            minPlayers: 2,
            gameSettings: { 
                rows: parseInt(document.getElementById('rows').value) || 4,
                cols: parseInt(document.getElementById('cols').value) || 4,
            }
        };
        
        ui.generatePlayerSetupFields(1, true);
        ui.updateGameModeUI(); 
        state.setNetworkRoomData({ roomState: 'seeking_match' });

        peerConnection.ensurePeerInitialized({
            onPeerOpen: (localPeerId) => {
                if (localPeerId) {
                    console.log(`[Main - Random Matching] My PeerJS ID for matchmaking: ${localPeerId}`);
                    matchmaking.joinQueue(localPeerId, myPlayerData, preferences, {
                        onSearching: () => {
                            ui.updateMessageArea("Buscando oponentes en la red...");
                            // ui.showModalMessage("Buscando una sala al azar..."); // Modal can be distracting if networkInfoArea is used
                            if (cancelMatchmakingButton) cancelMatchmakingButton.style.display = 'inline-block'; // Show cancel button
                            if (ui.networkInfoArea) { // Show message in networkInfoArea
                                ui.networkInfoArea.classList.remove('hidden');
                                if(ui.networkInfoTitle) ui.networkInfoTitle.textContent = "Buscando Partida...";
                                if(ui.networkInfoText) ui.networkInfoText.textContent = "Intentando encontrar oponentes al azar...";
                                if(ui.qrCodeContainer) ui.qrCodeContainer.innerHTML = ''; 
                            }
                        },
                        onMatchFoundAndJoiningRoom: (roomIdToJoin, roomLeaderPeerId, initialRoomData) => {
                            console.log(`[Main - Random Matching] Match found! Joining Room ID: ${roomIdToJoin}, Leader: ${roomLeaderPeerId}`);
                            ui.hideModalMessage();
                            if (ui.networkInfoArea && ui.networkInfoTitle.textContent === "Buscando Partida...") ui.hideNetworkInfo();
                            state.setNetworkRoomData({
                                roomId: roomIdToJoin,
                                leaderPeerId: roomLeaderPeerId,
                                isRoomLeader: false,
                                maxPlayers: initialRoomData.maxPlayers,
                                gameSettings: initialRoomData.gameSettings,
                                players: initialRoomData.players, // Will be overwritten by leader's list
                                roomState: 'connecting_to_lobby'
                            });
                            peerConnection.joinRoomById(roomLeaderPeerId, myPlayerData);
                            if (cancelMatchmakingButton) cancelMatchmakingButton.style.display = 'none';
                        },
                        onMatchFoundAndHostingRoom: async (newRoomHostPeerId, initialRoomData) => { // newRoomHostPeerId is our localRawPeerId
                            console.log(`[Main - Random Matching] No room found. Hosting new Room ID (my PeerID): ${newRoomHostPeerId}`);
                            ui.hideModalMessage();
                            if (ui.networkInfoArea && ui.networkInfoTitle.textContent === "Buscando Partida...") ui.hideNetworkInfo();
                            
                            // State is set within hostNewRoom, but ensure pvpRemoteActive is true
                            state.setPvpRemoteActive(true); 
                            // hostNewRoom now returns a promise
                            try {
                                await peerConnection.hostNewRoom(myPlayerData, initialRoomData.gameSettings, true);
                                console.log("[Main - Random Matching] hostNewRoom completed for random match fallback.");
                                // QR code display and lobby transition are handled within hostNewRoom's onPeerOpen flow
                            } catch (error) {
                                console.error("[Main - Random Matching] Error during hostNewRoom fallback:", error);
                                ui.showModalMessage(`Error al crear sala para matchmaking: ${error.message || error}`);
                                state.resetNetworkRoomData();
                                state.setPvpRemoteActive(false);
                                ui.showSetupScreen();
                            }
                            if (cancelMatchmakingButton) cancelMatchmakingButton.style.display = 'none';
                        },
                        onError: (errMsg) => {
                            ui.hideModalMessage();
                            if (ui.networkInfoArea && ui.networkInfoTitle.textContent === "Buscando Partida...") ui.hideNetworkInfo();
                            ui.showModalMessage(`Error de Matchmaking: ${errMsg}`);
                            if (cancelMatchmakingButton) cancelMatchmakingButton.style.display = 'none';
                            state.resetNetworkRoomData(); // Reset network state
                            state.setPvpRemoteActive(false); // No longer in PvP mode
                            ui.showSetupScreen(); // Go back to setup
                            // ui.updateGameModeUI(); // showSetupScreen calls this
                        },
                        onTimeout: () => { // Assuming matchmaking.joinQueue might have a timeout mechanism
                            ui.hideModalMessage();
                            if (ui.networkInfoArea && ui.networkInfoTitle.textContent === "Buscando Partida...") ui.hideNetworkInfo();
                            ui.showModalMessage("No se encontraron salas al azar. Intentá de nuevo más tarde o creá una sala.");
                            if (cancelMatchmakingButton) cancelMatchmakingButton.style.display = 'none';
                            matchmaking.leaveQueue(); // Ensure queue is left
                            state.resetNetworkRoomData();
                            state.setPvpRemoteActive(false);
                            ui.showSetupScreen();
                            // ui.updateGameModeUI();
                        }
                    });
                } else {
                    ui.hideModalMessage();
                    if (ui.networkInfoArea && ui.networkInfoTitle.textContent === "Buscando Partida...") ui.hideNetworkInfo();
                    ui.showModalMessage("Error: No se pudo obtener un ID de PeerJS para el matchmaking.");
                    if (cancelMatchmakingButton) cancelMatchmakingButton.style.display = 'none';
                    state.resetNetworkRoomData();
                    state.setPvpRemoteActive(false);
                    ui.showSetupScreen();
                    // ui.updateGameModeUI();
                }
            },
            onError: (err) => { // Error from ensurePeerInitialized itself
                ui.hideModalMessage();
                if (ui.networkInfoArea && ui.networkInfoTitle.textContent === "Buscando Partida...") ui.hideNetworkInfo();
                ui.showModalMessage(`Error al iniciar PeerJS para matchmaking: ${err.type || 'Desconocido'}`);
                if (cancelMatchmakingButton) cancelMatchmakingButton.style.display = 'none';
                state.resetNetworkRoomData();
                state.setPvpRemoteActive(false);
                ui.showSetupScreen();
                // ui.updateGameModeUI();
            }
        });
    });

    cancelMatchmakingButton?.addEventListener('click', () => {
        if (state.soundsInitialized) sound.playSound(sound.uiClickSound, "A3", "16n");
        matchmaking.leaveQueue(); 
        peerConnection.closePeerSession(); // Ensure PeerJS is fully closed
        state.resetNetworkRoomData();
        state.setPvpRemoteActive(false);
        // state.setNetworkRoomData({ roomState: 'idle'}); // resetNetworkRoomData handles this
        ui.hideModalMessage();
        if (ui.networkInfoArea && ui.networkInfoTitle.textContent === "Buscando Partida...") {
             ui.hideNetworkInfo();
        }
        ui.updateMessageArea("Búsqueda de sala cancelada.");
        ui.showSetupScreen(); // This will call updateGameModeUI
        cancelMatchmakingButton.style.display = 'none'; // Ensure it's hidden
    });

    lobbyToggleReadyBtn?.addEventListener('click', () => {
        if (!state.pvpRemoteActive || !state.networkRoomData.roomId) return;
        if (state.soundsInitialized) sound.playSound(sound.uiClickSound, "G4", "16n");

        const myCurrentData = state.networkRoomData.players.find(p => p.peerId === state.myPeerId);
        if (myCurrentData) {
            const newReadyState = !myCurrentData.isReady;
            peerConnection.sendPlayerReadyState(newReadyState);
        }
    });

    lobbyStartGameLeaderBtn?.addEventListener('click', () => {
        if (!state.pvpRemoteActive || !state.networkRoomData.isRoomLeader) return;
        if (state.soundsInitialized) sound.playSound(sound.gameStartSound, "C5", "8n");

        const allReady = state.networkRoomData.players.length >= state.MIN_PLAYERS_NETWORK &&
                         state.networkRoomData.players.every(p => p.isReady && p.isConnected);
        if (allReady) {
            peerConnection.sendStartGameRequest();
        } else {
            ui.updateLobbyMessage("No todos los jugadores están listos.", true);
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
            if (state.soundsInitialized) sound.playSound(sound.modalCloseSound, "C2", "32n");
            ui.hideModalMessage();
        }
    });

    console.log("[Main] Event listeners setup complete");
}

function stopAnyActiveGameOrNetworkSession(preserveUIScreen = false) {
    console.log("[Main] stopAnyActiveGameOrNetworkSession called. Preserve UI:", preserveUIScreen);
    if (state.gameActive && !preserveUIScreen) {
        gameLogic.endGameAbruptly();
    } else if (state.gameActive) {
        state.setGameActive(false);
    }

    if (state.pvpRemoteActive && state.networkRoomData.roomId) { // If in a room or trying to connect to one
        peerConnection.leaveRoom(); // Handles closing connections specific to the room
    }
    // Always ensure PeerJS session is fully closed if it was active, regardless of room status
    // This helps prevent issues with stale peer objects if leaveRoom wasn't sufficient or not in a room.
    if (state.pvpRemoteActive || window.peerJsMultiplayer?.getPeer()) { // Check if pvp mode was active or peer exists
        peerConnection.closePeerSession();
    }
    
    matchmaking.leaveQueue();

    state.resetNetworkRoomData();
    state.setPvpRemoteActive(false);

    if (!preserveUIScreen) {
        ui.showSetupScreen(); 
    }
    const cancelBtn = document.getElementById('cancel-matchmaking-btn');
    if (cancelBtn) cancelBtn.style.display = 'none';
    console.log("[Main] Any active game/network/matchmaking session stopped.");
}

function processUrlJoin() {
    const roomToJoin = window.cajitasJoinRoomOnLoad;
    if (!roomToJoin || !roomToJoin.roomId) {
        console.warn("[Main processUrlJoin] No room ID to process from URL.");
        // Standard setup if no room ID in URL
        ui.showSetupScreen();
        ui.generatePlayerSetupFields(parseInt(document.getElementById('num-players-input')?.value || "2"));
        // ui.updateGameModeUI(); // showSetupScreen calls this
        peerConnection.ensurePeerInitialized(); // Ensure peer is ready for manual hosting/joining
        return;
    }

    console.log("[Main - processUrlJoin] Processing room join for:", roomToJoin.roomId);
    
    // Ensure UI is in a base state before showing modal
    ui.showSetupScreen(); // Show setup to allow player customization
    ui.generatePlayerSetupFields(1, true); // For "Your Name", "Your Icon" etc.
    
    // Add a small delay to ensure DOM is fully rendered and setup screen is visible
    setTimeout(() => {
        stopAnyActiveGameOrNetworkSession(true); // true to preserve UI for the modal
        state.setPvpRemoteActive(true); // Set pvpRemoteActive before attempting to join
        
        ui.showModalMessageWithActions(
            `¿Unirte a la sala ${state.CAJITAS_PEER_ID_PREFIX}${roomToJoin.roomId}? Personalizá tus datos en la pantalla de configuración si es necesario.`,
            [
                { 
                    text: "Sí, ¡Unirme!", 
                    action: async () => { // Make action async if joinRoomById becomes async
                        const joinerPlayerData = getLocalPlayerCustomization();
                        
                        state.setNetworkRoomData({
                            roomId: roomToJoin.roomId, // This is the raw peer ID from URL
                            maxPlayers: roomToJoin.slots || state.MAX_PLAYERS_NETWORK,
                            roomState: 'connecting_to_lobby' // Set state before connection attempt
                        });
                        // ui.updateGameModeUI(); // This will be called by ensurePeerInitialized->onPeerOpen flow

                        try {
                            // If joinRoomById is made async due to promise in ensurePeerInitialized:
                            // await peerConnection.joinRoomById(roomToJoin.roomId, joinerPlayerData);
                            peerConnection.joinRoomById(roomToJoin.roomId, joinerPlayerData);
                            // ui.hideModalMessage(); // Hide modal after successfully initiating join
                            // Lobby screen transition will happen from peerConnection.js callbacks
                        } catch (error) {
                            console.error("[Main processUrlJoin] Error initiating join:", error);
                            ui.showModalMessage(`Error al intentar unirse: ${error.message || 'Error desconocido'}`);
                            // Optionally reset state here
                            stopAnyActiveGameOrNetworkSession();
                            ui.showSetupScreen();
                        }
                    }
                },
                { 
                    text: "No, Cancelar", 
                    action: () => {
                        stopAnyActiveGameOrNetworkSession(); 
                        ui.showSetupScreen(); 
                        ui.hideModalMessage();
                        window.history.replaceState({}, document.title, window.location.pathname); 
                        delete window.cajitasJoinRoomOnLoad;
                    }, 
                    isCancel: true
                }
            ]
        );
    }, 100); // Small delay
}

document.addEventListener('DOMContentLoaded', () => {
    console.log("Cajitas de Danielle: DOM fully loaded and parsed");
    console.log("[Main - DOMContentLoaded] window.cajitasJoinRoomOnLoad:", window.cajitasJoinRoomOnLoad);

    setupEventListeners();

    if (window.cajitasJoinRoomOnLoad) {
        console.log("[Main - DOMContentLoaded] Processing URL join immediately");
        processUrlJoin(); 
    } else {
        console.log("[Main - DOMContentLoaded] No room to join from URL, showing setup screen and initializing PeerJS.");
        ui.showSetupScreen();
        ui.generatePlayerSetupFields(parseInt(document.getElementById('num-players-input')?.value || "2"));
        const undoBtn = document.getElementById('undo-btn');
        if (undoBtn) undoBtn.disabled = true;
        // Ensure PeerJS is initialized for manual hosting/joining later
        peerConnection.ensurePeerInitialized({ 
            onPeerOpen: (id) => console.log('[Main] PeerJS pre-initialized on load (no room in URL). ID:', id),
            onError: (err) => console.warn('[Main] Benign PeerJS pre-init error (no room in URL):', err.type, err.message || err)
        });
    }

    console.log("Cajitas de Danielle: Main script initialized.");
});