// main.js -- Main Application Orchestrator for Cajitas de Dani

// VERY EARLY LOG: What is the URL when the script first runs?
console.log("[Main - Pre-DOM] Initial window.location.href:", window.location.href);
console.log("[Main - Pre-DOM] Initial window.location.search:", window.location.search);

import * as state from './state.js';
import * as ui from './ui.js';
import * as gameLogic from './gameLogic.js';
import * as sound from './sound.js';
import * as peerConnection from './peerConnection.js';
import * as matchmaking from './matchmaking_supabase.js';

document.addEventListener('DOMContentLoaded', () => {
    console.log("Cajitas de Dani: DOM fully loaded and parsed");
    console.log("[Main - DOMContentLoaded] window.location.href:", window.location.href);
    console.log("[Main - DOMContentLoaded] window.location.search:", window.location.search);


    // --- Initial UI Setup ---
    ui.showSetupScreen();
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
        gameLogic.resetGame(true);
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
                    state.setRemotePlayersData([...state.playersData]);
                    ui.updateScoresDisplay();

                    matchmaking.joinQueue(localPeerId, {
                        onSearching: () => {
                            ui.updateMessageArea("Buscando oponente en la red...");
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
        if (state.gameActive && !preserveUIScreen) {
            gameLogic.resetGame(true);
        } else if (state.gameActive) {
            state.setGameActive(false);
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
        console.log("[Main - checkUrlForRoomAndJoin START] Current href:", window.location.href);
        console.log("[Main - checkUrlForRoomAndJoin START] Current search:", window.location.search);

        const urlParams = new URLSearchParams(window.location.search);
        const roomIdFromUrl = urlParams.get('room');
        console.log("[Main] URL Join Check: roomIdFromUrl Extracted:", roomIdFromUrl);

        if (roomIdFromUrl && roomIdFromUrl.startsWith('cajitas-')) {
            console.log("[Main] URL Join Check: Valid 'cajitas-' room ID found:", roomIdFromUrl, ". Attempting to join...");
            const attemptSoundAndJoin = async () => {
                if (!state.soundsInitialized) {
                    // Attempt to initialize sounds, user might need to click for this to fully work on first load
                    try {
                        await sound.initSounds();
                    } catch(e) {
                        console.warn("Sound init on URL join needs user gesture or prior interaction.", e);
                    }
                }
                
                stopAnyActiveGameAndMatchmaking(true);

                if(ui.setupSection) ui.setupSection.classList.add('hidden');
                if(ui.gameArea) ui.gameArea.classList.remove('hidden');
                ui.updateMessageArea(`Conectando a la sala ${roomIdFromUrl}...`);
                if(ui.mainTitle) ui.mainTitle.textContent = "Uniéndose a Partida...";


                if(ui.numPlayersInput) ui.numPlayersInput.value = "2";
                state.setNumPlayers(2);
                ui.generatePlayerSetupFields(2);

                const joinerName = document.getElementById('player-name-0')?.value || 'Jugador URL';
                const joinerIcon = document.getElementById('player-icon-0')?.value || state.AVAILABLE_ICONS[1];
                const joinerColor = document.getElementById('player-color-0')?.value || state.DEFAULT_PLAYER_COLORS[1];

                state.setPlayersData([
                     {id: 0, name: "Host (Conectando)", icon: "❓", color: "#cccccc", score: 0},
                     {id: 1, name: joinerName, icon: joinerIcon, color: joinerColor, score: 0}
                ]);
                state.setRemotePlayersData([...state.playersData]);
                ui.updateScoresDisplay();

                peerConnection.initializePeerAsJoiner(roomIdFromUrl, stopAnyActiveGameAndMatchmaking);
                                
                window.history.replaceState({}, document.title, window.location.pathname);
                console.log("[Main] URL Join: Cleared room parameter from URL.");
            };
            attemptSoundAndJoin();
        } else {
            console.log("[Main] URL Join Check: No valid 'cajitas-' room ID found in URL or roomIdFromUrl is null.");
            peerConnection.ensurePeerInitialized({
                onPeerOpen: (id) => console.log('[Main] PeerJS session pre-initialized on load (no room in URL). ID:', id),
                onError: (err) => console.warn('[Main] Benign PeerJS pre-init error (no room in URL):', err.type)
            });
        }
    }

    // Call checkUrlForRoomAndJoin after the initial setup UI might have been shown by DOMContentLoaded.
    // DOMContentLoaded ensures that basic DOM elements are available.
    checkUrlForRoomAndJoin();
    console.log("Cajitas de Dani: Main script initialized.");
});