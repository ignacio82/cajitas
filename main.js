// main.js -- Main Application Orchestrator for Cajitas de Dani

import * as state from './state.js';
import * as ui from './ui.js';
import * as gameLogic from './gameLogic.js';
import * as sound from './sound.js';
import * as peerConnection from './peerConnection.js';
import * as matchmaking from './matchmaking_supabase.js'; // Import matchmaking

document.addEventListener('DOMContentLoaded', () => {
    console.log("Cajitas de Dani: DOM fully loaded and parsed");

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
        stopAnyActiveGameAndMatchmaking(); // Ensure any network activity is stopped
        gameLogic.initializeGame(false);
    });

    ui.resetGameBtn?.addEventListener('click', () => {
        if (state.soundsInitialized) sound.playSound(sound.uiClickSound, "E3", "16n");
        stopAnyActiveGameAndMatchmaking(); // Also stop network if resetting
        gameLogic.resetGame(true);
    });

    ui.undoBtn?.addEventListener('click', () => {
        if (state.soundsInitialized) sound.playSound(sound.undoSound, "E3", "16n");
        gameLogic.handleUndo();
    });

    ui.numPlayersInput?.addEventListener('input', (e) => {
        const count = parseInt(e.target.value);
        if (count >= 2 && count <= 4 && !state.pvpRemoteActive) { // Only allow change if not in remote mode
            ui.generatePlayerSetupFields(count);
        } else if (state.pvpRemoteActive && ui.numPlayersInput) {
            ui.numPlayersInput.value = "2"; // Keep it at 2 for remote
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
        
        stopAnyActiveGameAndMatchmaking(); // Stop other activities

        if(ui.numPlayersInput) ui.numPlayersInput.value = "2";
        state.setNumPlayers(2);
        ui.generatePlayerSetupFields(2);

        const hostName = document.getElementById('player-name-0')?.value || 'Host';
        const hostIcon = document.getElementById('player-icon-0')?.value || state.AVAILABLE_ICONS[0];
        const hostColor = document.getElementById('player-color-0')?.value || state.DEFAULT_PLAYER_COLORS[0];
        state.setPlayersData([{ id: 0, name: hostName, icon: hostIcon, color: hostColor, score: 0 }]);
        
        peerConnection.initializePeerAsHost(stopAnyActiveGameAndMatchmaking); // Pass updated stop function
        ui.updateGameModeUI();
    });

    const joinButton = document.getElementById('join-cajitas-btn');
    joinButton?.addEventListener('click', async () => {
        if (!state.soundsInitialized) await sound.initSounds();
        if (state.soundsInitialized) sound.playSound(sound.uiClickSound, "C4", "16n");

        stopAnyActiveGameAndMatchmaking(); // Stop other activities

        const rawHostId = prompt("Ingresá el ID del Host para unirte a la partida de Cajitas (debe empezar con 'cajitas-'):");
        if (rawHostId && rawHostId.trim().startsWith('cajitas-')) {
            if(ui.numPlayersInput) ui.numPlayersInput.value = "2";
            state.setNumPlayers(2);
            ui.generatePlayerSetupFields(2);

            const joinerName = document.getElementById('player-name-0')?.value || 'Jugador 2'; // Joiner uses first fields now
            const joinerIcon = document.getElementById('player-icon-0')?.value || state.AVAILABLE_ICONS[1];
            const joinerColor = document.getElementById('player-color-0')?.value || state.DEFAULT_PLAYER_COLORS[1];
            
            state.setPlayersData([
                {id: 0, name: "Host (Esperando)", icon: "❓", color: "#cccccc", score: 0},
                {id: 1, name: joinerName, icon: joinerIcon, color: joinerColor, score: 0}
            ]);

            peerConnection.initializePeerAsJoiner(rawHostId.trim(), stopAnyActiveGameAndMatchmaking); // Pass updated stop
            ui.updateGameModeUI();
        } else {
            ui.showModalMessage("ID del Host inválido. Debe empezar con 'cajitas-' y no estar vacío.");
        }
    });

    const playRandomButton = document.getElementById('play-random-cajitas-btn');
    playRandomButton?.addEventListener('click', async () => {
        if (!state.soundsInitialized) await sound.initSounds();
        if (state.soundsInitialized) sound.playSound(sound.uiClickSound, "D4", "16n");

        stopAnyActiveGameAndMatchmaking(); // Stop other activities

        if(ui.numPlayersInput) ui.numPlayersInput.value = "2";
        state.setNumPlayers(2);
        ui.generatePlayerSetupFields(2);

        // Setup local player data (Player 0 initially, will be P0 or P1 based on matchmaking role)
        const myName = document.getElementById('player-name-0')?.value || 'Jugador Aleatorio';
        const myIcon = document.getElementById('player-icon-0')?.value || state.AVAILABLE_ICONS[Math.floor(Math.random() * state.AVAILABLE_ICONS.length)];
        const myColor = document.getElementById('player-color-0')?.value || state.DEFAULT_PLAYER_COLORS[0];
        // We don't know our final ID (0 or 1) yet, peerConnection will set it.
        // For now, prepare a generic player object for "me".
        // state.setPlayersData([{id:0, name: myName, icon:myIcon, color:myColor, score:0}]); // This will be adjusted
        // The playersData will be fully defined once connection is made via peerConnection.js

        ui.showModalMessage("Buscando un oponente al azar...");
        if (ui.cancelMatchmakingButton) ui.cancelMatchmakingButton.style.display = 'inline-block';
        ui.updateGameModeUI(); // To hide other network buttons

        peerConnection.ensurePeerInitialized({
            onPeerOpen: (localPeerId) => {
                if (localPeerId) {
                    // Set up P1 data for now (name, icon, color) - actual player ID determined later
                    state.setPlayersData([
                        {id: 0, name: myName, icon: myIcon, color: myColor, score: 0},
                        {id: 1, name: "Oponente", icon: "❓", color: "#DDDDDD", score: 0} // Placeholder for opponent
                    ]);

                    matchmaking.joinQueue(localPeerId, {
                        onSearching: () => {
                            ui.updateMessageArea("Buscando oponente en la red...");
                            if (ui.cancelMatchmakingButton) ui.cancelMatchmakingButton.classList.remove('hidden');
                        },
                        onMatchFound: (opponentRawPeerId) => {
                            ui.hideModalMessage();
                            ui.showModalMessage(`¡Oponente encontrado! (${opponentRawPeerId.substring(0,8)}...). Conectando...`);
                            if (ui.cancelMatchmakingButton) ui.cancelMatchmakingButton.classList.add('hidden');
                            
                            // Decide who is P1 (host-like role in PeerJS connection)
                            // A common strategy: the one with the lexicographically smaller raw PeerJS ID initiates connection.
                            // This prevents both trying to connect simultaneously to each other.
                            if (localPeerId < opponentRawPeerId) {
                                console.log("[Matchmaking] Decided to be P1 (connector) as my ID is smaller.");
                                state.setIAmPlayer1InRemote(true); // I will initiate the connection
                                state.setMyPlayerIdInRemoteGame(0);
                                // My player data is already set for P0
                                state.playersData[0] = {id:0, name: myName, icon: myIcon, color: myColor, score:0};
                                state.playersData[1] = {id:1, name: "Oponente Remoto", icon: "❓", color: state.DEFAULT_PLAYER_COLORS[1], score:0}; // Placeholder
                            } else {
                                console.log("[Matchmaking] Decided to be P2 (listener) as my ID is larger.");
                                state.setIAmPlayer1InRemote(false); // I will wait for connection
                                state.setMyPlayerIdInRemoteGame(1);
                                // Opponent will be P0.
                                state.playersData[0] = {id:0, name: "Oponente Remoto", icon: "❓", color: state.DEFAULT_PLAYER_COLORS[0], score:0}; // Placeholder
                                state.playersData[1] = {id:1, name: myName, icon: myIcon, color: myColor, score:0};
                            }
                            state.setRemotePlayersData([...state.playersData]); // Sync for UI
                            ui.updateScoresDisplay();


                            // Connect to the discovered peer (prefix is handled by matchmaking.joinQueue on opponent side)
                            // connectToDiscoveredPeer expects the raw ID without prefix
                            peerConnection.connectToDiscoveredPeer(opponentRawPeerId);
                        },
                        onError: (errMsg) => {
                            ui.hideModalMessage();
                            ui.showModalMessage(`Error de Matchmaking: ${errMsg}`);
                            if (ui.cancelMatchmakingButton) ui.cancelMatchmakingButton.classList.add('hidden');
                            ui.updateGameModeUI(); // Re-enable host/join buttons
                        },
                        onTimeout: () => {
                            ui.hideModalMessage();
                            ui.showModalMessage("No se encontraron oponentes al azar. Intentá de nuevo más tarde.");
                            if (ui.cancelMatchmakingButton) ui.cancelMatchmakingButton.classList.add('hidden');
                            ui.updateGameModeUI(); // Re-enable host/join buttons
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
            stopAnyActiveGameAndMatchmaking(); // Full reset
            ui.updateGameModeUI(); // Show host/join again
        });
    }


    // --- Helper to stop any game AND matchmaking before starting a new mode ---
    function stopAnyActiveGameAndMatchmaking() {
        if (state.gameActive) {
            gameLogic.resetGame(true);
        }
        matchmaking.leaveQueue(); // Ensure we leave any matchmaking queue
        peerConnection.closePeerSession();
        state.resetNetworkState();
        console.log("Any active game/network/matchmaking session stopped.");
        ui.updateGameModeUI(); // Reflect that we are no longer in a network process
         if (ui.cancelMatchmakingButton) ui.cancelMatchmakingButton.classList.add('hidden');
    }

    // --- Handle Deep Linking for Joining Games ---
    function checkUrlForRoomAndJoin() {
        const urlParams = new URLSearchParams(window.location.search);
        const roomIdFromUrl = urlParams.get('room');

        if (roomIdFromUrl && roomIdFromUrl.startsWith('cajitas-')) {
            const attemptSoundAndJoin = async () => {
                if (!state.soundsInitialized) {
                    await sound.initSounds().catch(e => console.warn("Sound init on URL join needs user gesture.", e));
                }
                
                stopAnyActiveGameAndMatchmaking();

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

                peerConnection.initializePeerAsJoiner(roomIdFromUrl, stopAnyActiveGameAndMatchmaking);
                ui.updateGameModeUI();
                window.history.replaceState({}, document.title, window.location.pathname);
            };
            attemptSoundAndJoin();
        } else {
            peerConnection.ensurePeerInitialized({
                onPeerOpen: (id) => console.log('[Main] PeerJS session pre-initialized on load. ID:', id),
                onError: (err) => console.warn('[Main] Benign PeerJS pre-init error:', err.type)
            });
        }
    }

    checkUrlForRoomAndJoin();
    console.log("Cajitas de Dani: Main script initialized.");
});