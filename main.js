// main.js -- Main Application Orchestrator for Cajitas de Dani

import * as state from './state.js';
import * as ui from './ui.js';
import * as gameLogic from './gameLogic.js';
import * as sound from './sound.js';
import * as peerConnection from './peerConnection.js';
import * as matchmaking from './matchmaking_supabase.js';

document.addEventListener('DOMContentLoaded', () => {
    console.log("Cajitas de Dani: DOM fully loaded and parsed");

    // --- Initial UI Setup ---
    ui.showSetupScreen(); // Show setup initially
    if (ui.numPlayersInput) {
        ui.generatePlayerSetupFields(parseInt(ui.numPlayersInput.value));
    }
    ui.updateGameModeUI();
    if (ui.undoBtn) ui.undoBtn.disabled = true;


    // --- Event Listeners for Setup ---
    ui.startGameBtn?.addEventListener('click', async () => {
        if (!state.soundsInitialized) {
            await sound.initSounds();
        }
        if (state.soundsInitialized) {
            sound.playSound(sound.uiClickSound, "C4", "16n");
            sound.playSound(sound.gameStartSound, "C4", "8n", Tone.now() + 0.1);
        }
        stopAnyActiveGameAndMatchmaking();
        gameLogic.initializeGame(false);
    });

    ui.resetGameBtn?.addEventListener('click', () => {
        if (state.soundsInitialized) sound.playSound(sound.uiClickSound, "E3", "16n");
        stopAnyActiveGameAndMatchmaking();
        gameLogic.resetGame(true); // true to go back to setup screen
    });

    ui.undoBtn?.addEventListener('click', () => {
        if (state.soundsInitialized) sound.playSound(sound.undoSound, "E3", "16n");
        gameLogic.handleUndo();
    });

    ui.numPlayersInput?.addEventListener('input', (e) => {
        const count = parseInt(e.target.value);
        if (count >= 2 && count <= 4 && !state.pvpRemoteActive) {
            ui.generatePlayerSetupFields(count);
        } else if (state.pvpRemoteActive && ui.numPlayersInput) {
            ui.numPlayersInput.value = "2";
        }
    });

    // --- Modal Listeners ---
    ui.modalCloseBtn?.addEventListener('click', () => {
        if (state.soundsInitialized) sound.playSound(sound.modalCloseSound, "C2", "32n");
        ui.hideModalMessage();
    });
    window.addEventListener('click', (event) => {
        if (event.target === ui.customModal) {
            if (state.soundsInitialized) sound.playSound(sound.modalCloseSound, "C2", "32n");
            ui.hideModalMessage();
        }
    });

    // --- Network Play Button Event Listeners ---
    const hostButton = document.getElementById('host-cajitas-btn');
    hostButton?.addEventListener('click', async () => {
        if (!state.soundsInitialized) await sound.initSounds();
        if (state.soundsInitialized) sound.playSound(sound.uiClickSound, "C4", "16n");
        
        stopAnyActiveGameAndMatchmaking();

        if(ui.numPlayersInput) ui.numPlayersInput.value = "2";
        state.setNumPlayers(2);
        ui.generatePlayerSetupFields(2);

        const hostName = document.getElementById('player-name-0')?.value || 'Host';
        const hostIcon = document.getElementById('player-icon-0')?.value || state.AVAILABLE_ICONS[0];
        const hostColor = document.getElementById('player-color-0')?.value || state.DEFAULT_PLAYER_COLORS[0];
        state.setPlayersData([{ id: 0, name: hostName, icon: hostIcon, color: hostColor, score: 0 }]);
        
        peerConnection.initializePeerAsHost(stopAnyActiveGameAndMatchmaking);
        ui.updateGameModeUI();
    });

    const joinButton = document.getElementById('join-cajitas-btn');
    joinButton?.addEventListener('click', async () => {
        if (!state.soundsInitialized) await sound.initSounds();
        if (state.soundsInitialized) sound.playSound(sound.uiClickSound, "C4", "16n");

        stopAnyActiveGameAndMatchmaking();

        const rawHostId = prompt("Ingresá el ID del Host para unirte a la partida de Cajitas (debe empezar con 'cajitas-'):");
        if (rawHostId && rawHostId.trim().startsWith('cajitas-')) {
            if(ui.numPlayersInput) ui.numPlayersInput.value = "2";
            state.setNumPlayers(2);
            ui.generatePlayerSetupFields(2);

            const joinerName = document.getElementById('player-name-0')?.value || 'Jugador 2';
            const joinerIcon = document.getElementById('player-icon-0')?.value || state.AVAILABLE_ICONS[1];
            const joinerColor = document.getElementById('player-color-0')?.value || state.DEFAULT_PLAYER_COLORS[1];
            
            state.setPlayersData([
                {id: 0, name: "Host (Esperando)", icon: "❓", color: "#cccccc", score: 0},
                {id: 1, name: joinerName, icon: joinerIcon, color: joinerColor, score: 0}
            ]);

            peerConnection.initializePeerAsJoiner(rawHostId.trim(), stopAnyActiveGameAndMatchmaking);
            ui.updateGameModeUI();
        } else {
            ui.showModalMessage("ID del Host inválido. Debe empezar con 'cajitas-' y no estar vacío.");
        }
    });

    const playRandomButton = document.getElementById('play-random-cajitas-btn');
    playRandomButton?.addEventListener('click', async () => {
        if (!state.soundsInitialized) await sound.initSounds();
        if (state.soundsInitialized) sound.playSound(sound.uiClickSound, "D4", "16n");

        stopAnyActiveGameAndMatchmaking();

        if(ui.numPlayersInput) ui.numPlayersInput.value = "2";
        state.setNumPlayers(2);
        ui.generatePlayerSetupFields(2);

        const myName = document.getElementById('player-name-0')?.value || 'Jugador Aleatorio';
        const myIcon = document.getElementById('player-icon-0')?.value || state.AVAILABLE_ICONS[Math.floor(Math.random() * state.AVAILABLE_ICONS.length)];
        const myColor = document.getElementById('player-color-0')?.value || state.DEFAULT_PLAYER_COLORS[0];

        ui.showModalMessage("Buscando un oponente al azar...");
        if (ui.cancelMatchmakingButton) ui.cancelMatchmakingButton.style.display = 'inline-block';
        ui.updateGameModeUI();

        peerConnection.ensurePeerInitialized({
            onPeerOpen: (localPeerId) => {
                if (localPeerId) {
                    state.setPlayersData([
                        {id: 0, name: myName, icon: myIcon, color: myColor, score: 0},
                        {id: 1, name: "Oponente", icon: "❓", color: state.DEFAULT_PLAYER_COLORS[1], score: 0}
                    ]);
                    state.setRemotePlayersData([...state.playersData]); // Initialize remotePlayersData as well
                    ui.updateScoresDisplay(); // Show initial (potentially placeholder) scores

                    matchmaking.joinQueue(localPeerId, {
                        onSearching: () => {
                            ui.updateMessageArea("Buscando oponente en la red...");
                            if (ui.cancelMatchmakingButton) ui.cancelMatchmakingButton.classList.remove('hidden'); // Should be visible
                        },
                        onMatchFound: (opponentRawPeerId) => {
                            ui.hideModalMessage();
                            ui.showModalMessage(`¡Oponente encontrado! (${opponentRawPeerId.substring(0,8)}...). Conectando...`);
                            if (ui.cancelMatchmakingButton) ui.cancelMatchmakingButton.classList.add('hidden');
                            
                            if (localPeerId < opponentRawPeerId) {
                                console.log("[Matchmaking] Decided to be P1 (connector) as my ID is smaller.");
                                state.setIAmPlayer1InRemote(true);
                                state.setMyPlayerIdInRemoteGame(0);
                                state.playersData[0] = {id:0, name: myName, icon: myIcon, color: myColor, score:0};
                                state.playersData[1] = {id:1, name: "Oponente Remoto", icon: "❓", color: state.DEFAULT_PLAYER_COLORS[1], score:0};
                            } else {
                                console.log("[Matchmaking] Decided to be P2 (listener) as my ID is larger.");
                                state.setIAmPlayer1InRemote(false);
                                state.setMyPlayerIdInRemoteGame(1);
                                state.playersData[0] = {id:0, name: "Oponente Remoto", icon: "❓", color: state.DEFAULT_PLAYER_COLORS[0], score:0};
                                state.playersData[1] = {id:1, name: myName, icon: myIcon, color: myColor, score:0};
                            }
                            state.setRemotePlayersData([...state.playersData]);
                            ui.updateScoresDisplay();

                            peerConnection.connectToDiscoveredPeer(opponentRawPeerId);
                        },
                        onError: (errMsg) => {
                            ui.hideModalMessage();
                            ui.showModalMessage(`Error de Matchmaking: ${errMsg}`);
                            if (ui.cancelMatchmakingButton) ui.cancelMatchmakingButton.classList.add('hidden');
                            ui.updateGameModeUI();
                        },
                        onTimeout: () => {
                            ui.hideModalMessage();
                            ui.showModalMessage("No se encontraron oponentes al azar. Intentá de nuevo más tarde.");
                            if (ui.cancelMatchmakingButton) ui.cancelMatchmakingButton.classList.add('hidden');
                            ui.updateGameModeUI();
                        }
                    });
                } else {
                    ui.hideModalMessage();
                    ui.showModalMessage("Error: No se pudo obtener un ID de PeerJS para el matchmaking.");
                    if (ui.cancelMatchmakingButton) ui.cancelMatchmakingButton.classList.add('hidden');
                    ui.updateGameModeUI();
                }
            },
            onError: (err) => {
                ui.hideModalMessage();
                ui.showModalMessage(`Error al iniciar PeerJS para matchmaking: ${err.type || 'Desconocido'}`);
                if (ui.cancelMatchmakingButton) ui.cancelMatchmakingButton.classList.add('hidden');
                ui.updateGameModeUI();
            }
        });
    });

    if (ui.cancelMatchmakingButton) {
        ui.cancelMatchmakingButton.addEventListener('click', () => {
            if (state.soundsInitialized) sound.playSound(sound.uiClickSound, "A3", "16n");
            matchmaking.leaveQueue();
            ui.hideModalMessage();
            ui.updateMessageArea("Búsqueda de partida cancelada.");
            if (ui.cancelMatchmakingButton) ui.cancelMatchmakingButton.classList.add('hidden');
            stopAnyActiveGameAndMatchmaking();
            ui.updateGameModeUI();
        });
    }

    function stopAnyActiveGameAndMatchmaking(preserveUIScreen = false) {
        if (state.gameActive && !preserveUIScreen) { // Only reset to setup if not preserving screen
            gameLogic.resetGame(true); // true to go fully back to setup
        } else if (state.gameActive) {
            state.setGameActive(false); // At least deactivate game
            // Consider if other parts of gameLogic.resetGame are needed without UI change
        }
        matchmaking.leaveQueue();
        peerConnection.closePeerSession();
        state.resetNetworkState();
        console.log("Any active game/network/matchmaking session stopped.");
        if (!preserveUIScreen) {
            ui.updateGameModeUI();
        }
        if (ui.cancelMatchmakingButton) ui.cancelMatchmakingButton.classList.add('hidden');
    }

    function checkUrlForRoomAndJoin() {
        const urlParams = new URLSearchParams(window.location.search);
        const roomIdFromUrl = urlParams.get('room');
        console.log("[Main] URL Join Check: roomIdFromUrl =", roomIdFromUrl);

        if (roomIdFromUrl && roomIdFromUrl.startsWith('cajitas-')) {
            console.log("[Main] URL Join Check: Valid 'cajitas-' room ID found. Attempting to join...");
            const attemptSoundAndJoin = async () => {
                if (!state.soundsInitialized) {
                    await sound.initSounds().catch(e => console.warn("Sound init on URL join needs user gesture.", e));
                }
                
                // Stop previous activities but preserve the UI from going back to full setup screen.
                // We want to show a "connecting" state on the current view if possible, or transition quickly.
                stopAnyActiveGameAndMatchmaking(true); // true to preserve UI screen

                // Hide setup, show game area with a connecting message
                ui.setupSection.classList.add('hidden');
                ui.gameArea.classList.remove('hidden');
                ui.updateMessageArea(`Conectando a la sala ${roomIdFromUrl}...`);
                if(ui.mainTitle) ui.mainTitle.textContent = "Uniéndose a Partida...";


                if(ui.numPlayersInput) ui.numPlayersInput.value = "2";
                state.setNumPlayers(2);
                ui.generatePlayerSetupFields(2); // Setup fields for 2 players, though joiner uses only first set for their info

                const joinerName = document.getElementById('player-name-0')?.value || 'Jugador URL';
                const joinerIcon = document.getElementById('player-icon-0')?.value || state.AVAILABLE_ICONS[1];
                const joinerColor = document.getElementById('player-color-0')?.value || state.DEFAULT_PLAYER_COLORS[1];

                state.setPlayersData([
                     {id: 0, name: "Host (Conectando)", icon: "❓", color: "#cccccc", score: 0},
                     {id: 1, name: joinerName, icon: joinerIcon, color: joinerColor, score: 0}
                ]);
                state.setRemotePlayersData([...state.playersData]); // Initialize for UI
                ui.updateScoresDisplay(); // Show initial score display

                // Initialize peer as joiner. The stop callback is still stopAnyActiveGameAndMatchmaking
                // in case joining fails and needs cleanup, or if user navigates away.
                peerConnection.initializePeerAsJoiner(roomIdFromUrl, stopAnyActiveGameAndMatchmaking);
                
                // ui.updateGameModeUI will be called within initializePeerAsJoiner
                // and on connection events to update status further.
                
                window.history.replaceState({}, document.title, window.location.pathname);
            };
            attemptSoundAndJoin();
        } else {
            // No room ID, or not for Cajitas, normal startup.
            // Call this AFTER the DOMContentLoaded initial ui.showSetupScreen()
            // to avoid race conditions or double initializations.
            peerConnection.ensurePeerInitialized({
                onPeerOpen: (id) => console.log('[Main] PeerJS session pre-initialized on load. ID:', id),
                onError: (err) => console.warn('[Main] Benign PeerJS pre-init error:', err.type)
            });
        }
    }

    // Call checkUrlForRoomAndJoin after the initial setup UI is shown.
    // This ensures that if not joining by URL, the setup screen is correctly presented first.
    checkUrlForRoomAndJoin();
    console.log("Cajitas de Dani: Main script initialized.");
});