// main.js

console.log("[Main - Pre-DOM] Initial window.location.href:", window.location.href);

import * as state from './state.js';
import * as ui from './ui.js';
import * as gameLogic from './gameLogic.js';
import * as sound from './sound.js';
import * as peerConnection from './peerConnection.js';
import * as matchmaking from './matchmaking_supabase.js';
import * as cpu from './cpu.js'; // Import the new CPU module

function checkUrlForRoomAndJoinEarly() {
    // ... (existing function, no changes needed here for CPU logic) ...
    const urlParams = new URLSearchParams(window.location.search);
    const roomIdFromUrl = urlParams.get('room');
    const slotsFromUrl = urlParams.get('slots');
    if (roomIdFromUrl && roomIdFromUrl.trim()) {
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

    // Existing DOM Elements
    const startGameBtn = document.getElementById('start-game-btn');
    const resetGameBtn = document.getElementById('reset-game-btn');
    const undoBtn = document.getElementById('undo-btn');
    const numPlayersInput = document.getElementById('num-players-input'); // For all-human local
    const hostGameButton = document.getElementById('host-cajitas-btn');
    const playRandomButton = document.getElementById('play-random-cajitas-btn');
    const cancelMatchmakingButton = document.getElementById('cancel-matchmaking-btn');
    const lobbyToggleReadyBtn = document.getElementById('lobby-toggle-ready-btn');
    const lobbyStartGameLeaderBtn = document.getElementById('lobby-start-game-leader-btn');
    const lobbyLeaveRoomBtn = document.getElementById('lobby-leave-room-btn');
    const modalCloseBtn = document.getElementById('modal-close-btn');
    const customModal = document.getElementById('custom-modal');

    // New DOM Elements for CPU mode
    const gameModeSelect = document.getElementById('game-mode-select');
    const localPlayersConfigSection = document.getElementById('local-players-config-section');
    const cpuGameSection = document.getElementById('cpu-game-section');
    const humanPlayersCpuModeInput = document.getElementById('human-players-cpu-mode-input');
    const totalPlayersCpuModeInput = document.getElementById('total-players-cpu-mode-input');
    const cpuDifficultySelect = document.getElementById('cpu-difficulty-select');

    // Event Listener for Game Mode Change
    gameModeSelect?.addEventListener('change', (e) => {
        const mode = e.target.value;
        ui.updateGameModeUI(); // This will show/hide the correct sections

        if (mode === 'vs-cpu') {
            const humanCount = parseInt(humanPlayersCpuModeInput?.value || '1');
            ui.generatePlayerSetupFields(humanCount, false, true); // Generate fields for human players in CPU mode
        } else { // 'local' mode (all human)
            const localCount = parseInt(numPlayersInput?.value || '2');
            ui.generatePlayerSetupFields(localCount, false, false); // Generate fields for all local human players
        }
        if (typeof sound.triggerVibration === 'function') sound.triggerVibration(20);
    });

    // Event Listener for Number of Human Players in CPU mode
    humanPlayersCpuModeInput?.addEventListener('input', () => {
        if (state.pvpRemoteActive || gameModeSelect?.value !== 'vs-cpu') return;

        let humanCount = parseInt(humanPlayersCpuModeInput.value);
        let totalCount = parseInt(totalPlayersCpuModeInput.value);

        if (isNaN(humanCount) || humanCount < 1) humanCount = 1;
        if (humanCount > 3) humanCount = 3; // Max 3 humans if CPU is involved (to ensure at least 1 CPU if total is 4)
        humanPlayersCpuModeInput.value = humanCount;
        
        if (humanCount >= totalCount) {
            totalPlayersCpuModeInput.value = Math.min(4, humanCount + 1); // Ensure total is at least human + 1 (up to 4)
             if (humanCount === 4) totalPlayersCpuModeInput.value = 4; // Should not happen if max human is 3
        }
         // Ensure total players is at least 2
        if (parseInt(totalPlayersCpuModeInput.value) < 2) totalPlayersCpuModeInput.value = 2;


        ui.generatePlayerSetupFields(humanCount, false, true);
        if (typeof sound.triggerVibration === 'function') sound.triggerVibration(15);
    });

    // Event Listener for Total Players in CPU mode
    totalPlayersCpuModeInput?.addEventListener('input', () => {
        if (state.pvpRemoteActive || gameModeSelect?.value !== 'vs-cpu') return;

        let totalCount = parseInt(totalPlayersCpuModeInput.value);
        let humanCount = parseInt(humanPlayersCpuModeInput.value);

        if (isNaN(totalCount) || totalCount < 2) totalCount = 2;
        if (totalCount > 4) totalCount = 4;
        totalPlayersCpuModeInput.value = totalCount;

        if (humanCount > totalCount) {
            humanPlayersCpuModeInput.value = totalCount; // Max humans can be total
            ui.generatePlayerSetupFields(totalCount, false, true);
        } else if (humanCount === totalCount && totalCount > 1) { // Trying to make all players human
            //This is fine, it means no CPU players. But this input is for "vs CPU" mode.
            //If humanCount == totalCount, it's essentially a local game.
            //The logic should probably ensure at least one CPU if "vs-cpu" is selected.
            //For now, allow it, game start logic will handle it.
        }
        if (typeof sound.triggerVibration === 'function') sound.triggerVibration(15);
    });
    
    // Listener for local all-human player count change
    numPlayersInput?.addEventListener('input', (e) => {
        if (state.pvpRemoteActive || gameModeSelect?.value !== 'local') return;
        const count = parseInt(e.target.value);
        if (count >= 2 && count <= state.MAX_PLAYERS_LOCAL) {
            ui.generatePlayerSetupFields(count, false, false);
        }
        if (typeof sound.triggerVibration === 'function') sound.triggerVibration(15);
    });


    startGameBtn?.addEventListener('click', async () => {
        if (!state.soundsInitialized) await sound.initSounds();
        const selectedGameMode = gameModeSelect?.value || 'local';

        if (state.soundsInitialized && sound.uiClickSound) {
            sound.playSound(sound.uiClickSound, "C4", "16n");
            if (typeof sound.triggerVibration === 'function') sound.triggerVibration(35);
        }

        stopAnyActiveGameOrNetworkSession(); 
        state.setGameDimensions(parseInt(document.getElementById('rows').value), parseInt(document.getElementById('cols').value));

        let playersArray = [];

        if (selectedGameMode === 'vs-cpu') {
            const humanCount = Math.max(1, Math.min(3, parseInt(humanPlayersCpuModeInput.value || '1')));
            let totalPlayers = Math.max(2, Math.min(4, parseInt(totalPlayersCpuModeInput.value || '2')));
            if (totalPlayers <= humanCount && totalPlayers < 4) totalPlayers = humanCount + 1; // Ensure at least one CPU if possible
            if (humanCount === 4) totalPlayers = 4; // All human scenario
            if (totalPlayers < humanCount) totalPlayers = humanCount; // total cannot be less than human

            const difficulty = cpuDifficultySelect.value || 'MEDIUM';
            
            if (humanCount === totalPlayers && humanCount > 1) { // Essentially a local all-human game started from CPU mode
                 console.warn("[Main Start Game] CPU mode selected but human count equals total players. Treating as local all-human game.");
                 for (let i = 0; i < humanCount; i++) {
                    const name = document.getElementById(`player-name-${i}`)?.value || `Jugador ${i + 1}`;
                    const icon = document.getElementById(`player-icon-${i}`)?.value || state.AVAILABLE_ICONS[i % state.AVAILABLE_ICONS.length];
                    const color = document.getElementById(`player-color-${i}`)?.value || state.DEFAULT_PLAYER_COLORS[i % state.DEFAULT_PLAYER_COLORS.length];
                    playersArray.push({ id: i, name, icon, color, score: 0, isCpu: false });
                }
            } else {
                 playersArray = cpu.initializeCpuGame(humanCount, totalPlayers, difficulty);
            }

        } else { // 'local' (all-human) mode
            const numLocalPlayers = parseInt(numPlayersInput.value);
            for (let i = 0; i < numLocalPlayers; i++) {
                const name = document.getElementById(`player-name-${i}`)?.value || `Jugador ${i + 1}`;
                const icon = document.getElementById(`player-icon-${i}`)?.value || state.AVAILABLE_ICONS[i % state.AVAILABLE_ICONS.length];
                const color = document.getElementById(`player-color-${i}`)?.value || state.DEFAULT_PLAYER_COLORS[i % state.DEFAULT_PLAYER_COLORS.length];
                playersArray.push({ id: i, name, icon, color, score: 0, isCpu: false });
            }
        }
        
        state.setPlayersData(playersArray);
        gameLogic.initializeGame(false); // false for local game (CPU or all-human)
        ui.showGameScreen();

        if (state.soundsInitialized && sound.gameStartSound) {
             sound.playSound(sound.gameStartSound, "C5", "8n");
             if (typeof sound.triggerVibration === 'function') sound.triggerVibration([50,30,100]);
        }
        
        // If the first player is a CPU, trigger its move.
        cpu.handleTurnChange(); 
    });

    resetGameBtn?.addEventListener('click', () => {
        // ... (existing reset logic, haptics already added) ...
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
            stopAnyActiveGameOrNetworkSession(); // This now calls cancelCpuMove
            gameLogic.resetGame(true); 
            ui.showSetupScreen();
        }
    });
    
    // ... (undoBtn listener remains, haptics handled in gameLogic.js) ...
    undoBtn?.addEventListener('click', () => {
        if (state.pvpRemoteActive) {
            ui.updateMessageArea("Deshacer no disponible en juegos de red.", true);
            if(sound.errorSound && typeof sound.playSound === 'function') sound.playSound(sound.errorSound, undefined, "16n");
            if(typeof sound.triggerVibration === 'function') sound.triggerVibration([70,50,70]);
            return;
        }
        const currentPlayer = state.playersData.find(p => p.id === state.currentPlayerIndex);
        if (currentPlayer && currentPlayer.isCpu) {
            ui.updateMessageArea("No se puede deshacer la jugada de la CPU.", true);
            if(sound.errorSound && typeof sound.playSound === 'function') sound.playSound(sound.errorSound, undefined, "16n");
            if(typeof sound.triggerVibration === 'function') sound.triggerVibration([70,50,70]);
            return;
        }
        gameLogic.handleUndo();
    });


    // ... (network button listeners remain, haptics already added) ...
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
        } catch (error) {
            console.error("[Main] Error hosting new room:", error);
            ui.showModalMessage(`Error al crear la sala: ${error.message || 'Error desconocido'}`);
            if (typeof sound.triggerVibration === 'function') sound.triggerVibration([70,50,70]);
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
        // ... (rest of playRandomButton logic, haptics already added for sub-steps) ...
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
            if (!localPeerId) throw new Error("No se pudo obtener un ID de PeerJS para el matchmaking.");
            state.setPvpRemoteActive(true); 
            matchmaking.joinQueue(localPeerId, myPlayerData, preferences, {
                onSearching: () => { /* ... */ },
                onMatchFoundAndJoiningRoom: async (roomIdToJoin, roomLeaderPeerId, initialRoomData) => {
                    if (typeof sound.triggerVibration === 'function') sound.triggerVibration(40);
                    try { await peerConnection.joinRoomById(roomLeaderPeerId, myPlayerData); } 
                    catch (joinError) { 
                        ui.showModalMessage(`Error al unirse: ${joinError.message || 'Error'}`);
                        if (typeof sound.triggerVibration === 'function') sound.triggerVibration([70,50,70]);
                        stopAnyActiveGameOrNetworkSession(); ui.showSetupScreen(); 
                    }
                    if (cancelMatchmakingButton) cancelMatchmakingButton.style.display = 'none';
                },
                onMatchFoundAndHostingRoom: async (newRoomHostPeerId, initialRoomData) => {
                    if (typeof sound.triggerVibration === 'function') sound.triggerVibration(40);
                    try { await peerConnection.hostNewRoom(myPlayerData, initialRoomData.gameSettings, true); } 
                    catch (hostError) { 
                         ui.showModalMessage(`Error al hostear: ${hostError.message || hostError}`);
                        if (typeof sound.triggerVibration === 'function') sound.triggerVibration([70,50,70]);
                        stopAnyActiveGameOrNetworkSession(); ui.showSetupScreen();
                    }
                    if (cancelMatchmakingButton) cancelMatchmakingButton.style.display = 'none';
                },
                onError: (errMsg) => { 
                    ui.showModalMessage(`Error de Matchmaking: ${errMsg}`);
                    if (typeof sound.triggerVibration === 'function') sound.triggerVibration([70,50,70]);
                    if (cancelMatchmakingButton) cancelMatchmakingButton.style.display = 'none';
                    stopAnyActiveGameOrNetworkSession(); ui.showSetupScreen();
                },
                onTimeout: () => { /* ... haptic already added ... */ matchmaking.leaveQueue(state.myPeerId); stopAnyActiveGameOrNetworkSession(); ui.showSetupScreen(); }
            });
        } catch (initError) { 
            ui.showModalMessage(`Error PeerJS: ${initError.message || 'Desconocido'}`);
            if (typeof sound.triggerVibration === 'function') sound.triggerVibration([70,50,70]);
            if (cancelMatchmakingButton) cancelMatchmakingButton.style.display = 'none';
            stopAnyActiveGameOrNetworkSession(); ui.showSetupScreen();
        }
    });

    cancelMatchmakingButton?.addEventListener('click', () => {
        // ... (existing logic, haptics already added) ...
        if (state.soundsInitialized && sound.uiClickSound) {
            sound.playSound(sound.uiClickSound, "A3", "16n");
            if (typeof sound.triggerVibration === 'function') sound.triggerVibration(30);
        }
        matchmaking.leaveQueue(state.myPeerId); 
        stopAnyActiveGameOrNetworkSession(); 
        ui.hideModalMessage();
        if (ui.networkInfoArea && ui.networkInfoTitle.textContent === "Buscando Partida...") ui.hideNetworkInfo();
        ui.updateMessageArea("Búsqueda de sala cancelada.");
        if(cancelMatchmakingButton) cancelMatchmakingButton.style.display = 'none';
    });

    lobbyToggleReadyBtn?.addEventListener('click', () => {
        // ... (existing logic, haptics already added) ...
        if (!state.pvpRemoteActive || !state.networkRoomData.roomId) return;
        if (state.soundsInitialized && sound.uiClickSound) {
            sound.playSound(sound.uiClickSound, "G4", "16n");
            if (typeof sound.triggerVibration === 'function') sound.triggerVibration(30);
        }
        const myCurrentData = state.networkRoomData.players.find(p => p.peerId === state.myPeerId);
        if (myCurrentData) peerConnection.sendPlayerReadyState(!myCurrentData.isReady);
    });

    lobbyStartGameLeaderBtn?.addEventListener('click', () => {
        // ... (existing logic, haptics for game start already added) ...
        if (!state.pvpRemoteActive || !state.networkRoomData.isRoomLeader) return;
        if (state.soundsInitialized && sound.gameStartSound) {
            sound.playSound(sound.gameStartSound, "C5", "8n");
            if (typeof sound.triggerVibration === 'function') sound.triggerVibration([50, 30, 100]);
        }
        const allReady = state.networkRoomData.players.length >= state.MIN_PLAYERS_NETWORK &&
                         state.networkRoomData.players.every(p => p.isReady && p.isConnected !== false);
        if (allReady) peerConnection.sendStartGameRequest();
        else {
            ui.updateLobbyMessage("No todos los jugadores están listos o conectados.", true);
            if (typeof sound.triggerVibration === 'function') sound.triggerVibration([70,50,70]);
        }
    });

    lobbyLeaveRoomBtn?.addEventListener('click', () => {
        // ... (existing logic, haptics for modal buttons added in processUrlJoin and here for consistency) ...
        if (state.soundsInitialized && sound.uiClickSound) {
            sound.playSound(sound.uiClickSound, "D3", "16n");
            if (typeof sound.triggerVibration === 'function') sound.triggerVibration(30);
        }
        ui.showModalMessageWithActions("¿Seguro que querés salir de la sala?", [
            { text: "Sí, Salir", action: () => {
                if (typeof sound.triggerVibration === 'function') sound.triggerVibration(25);
                stopAnyActiveGameOrNetworkSession(); ui.showSetupScreen(); ui.hideModalMessage();
            }},
            { text: "No, Quedarme", action: () => {
                if (typeof sound.triggerVibration === 'function') sound.triggerVibration(25);
                ui.hideModalMessage();
            }, isCancel: true }
        ]);
    });

    modalCloseBtn?.addEventListener('click', () => {
        // ... (existing logic, haptics already added) ...
        if (state.soundsInitialized && sound.modalCloseSound) {
            sound.playSound(sound.modalCloseSound, "C2", "32n");
            if (typeof sound.triggerVibration === 'function') sound.triggerVibration(20);
        }
        ui.hideModalMessage();
    });
    
    window.addEventListener('click', (event) => {
        // ... (existing logic, haptics already added) ...
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
} // End of setupEventListeners

function stopAnyActiveGameOrNetworkSession(preserveUIScreen = false) {
    console.log("[Main] stopAnyActiveGameOrNetworkSession called. Preserve UI:", preserveUIScreen);
    cpu.cancelCpuMove(); // Cancel any pending CPU moves

    // ... (rest of existing logic) ...
    const wasPvpActive = state.pvpRemoteActive;
    const currentRoomId = state.networkRoomData.roomId;
    if (state.gameActive) gameLogic.endGameAbruptly(); 
    else state.setGameActive(false); 
    if (wasPvpActive) {
        if (currentRoomId) peerConnection.leaveRoom(); 
        if (state.networkRoomData.roomState === 'seeking_match' && state.myPeerId) matchmaking.leaveQueue(state.myPeerId);
        peerConnection.closePeerSession(); 
    }
    state.resetFullLocalStateForNewGame(); 
    if (!preserveUIScreen) ui.showSetupScreen(); 
    else ui.updateGameModeUI(); 
    const cancelBtn = document.getElementById('cancel-matchmaking-btn');
    if (cancelBtn) cancelBtn.style.display = 'none';
    console.log("[Main] Any active game/network/matchmaking session stopped. UI preserverd:", preserveUIScreen);
}


async function processUrlJoin() { 
    // ... (existing logic, haptics added to modal buttons) ...
    const roomToJoin = window.cajitasJoinRoomOnLoad;
    if (!roomToJoin || !roomToJoin.roomId) { /* ... */ return; }
    ui.showSetupScreen(); 
    ui.generatePlayerSetupFields(1, true); 
    await new Promise(resolve => setTimeout(resolve, 100));
    stopAnyActiveGameOrNetworkSession(true); 
    ui.showModalMessageWithActions(
        `¿Unirte a la sala ${state.CAJITAS_PEER_ID_PREFIX}${roomToJoin.roomId}? Personalizá tus datos...`,
        [
            { text: "Sí, ¡Unirme!", action: async () => {
                if (state.soundsInitialized && sound.uiClickSound) {
                    sound.playSound(sound.uiClickSound, "E4", "16n");
                    if (typeof sound.triggerVibration === 'function') sound.triggerVibration(30);
                }
                ui.hideModalMessage(); 
                const joinerPlayerData = state.getLocalPlayerCustomizationForNetwork();
                try { await peerConnection.joinRoomById(roomToJoin.roomId, joinerPlayerData); } 
                catch (error) { 
                    ui.showModalMessage(`Error al unirse: ${error.message || 'Error'}`);
                    if (typeof sound.triggerVibration === 'function') sound.triggerVibration([70,50,70]);
                    stopAnyActiveGameOrNetworkSession(); ui.showSetupScreen();
                    window.history.replaceState({}, document.title, window.location.pathname); 
                    delete window.cajitasJoinRoomOnLoad;
                }
            }},
            { text: "No, Cancelar", action: () => {
                if (state.soundsInitialized && sound.uiClickSound) {
                    sound.playSound(sound.uiClickSound, "C4", "16n");
                    if (typeof sound.triggerVibration === 'function') sound.triggerVibration(30);
                }
                ui.hideModalMessage(); stopAnyActiveGameOrNetworkSession(); ui.showSetupScreen();
                window.history.replaceState({}, document.title, window.location.pathname); 
                delete window.cajitasJoinRoomOnLoad;
            }, isCancel: true }
        ]
    );
}

document.addEventListener('DOMContentLoaded', async () => { 
    console.log("Cajitas de Danielle: DOM fully loaded and parsed");
    
    setupEventListeners(); 
    ui.updateGameModeUI(); // Call this to set initial visibility of CPU/Local sections

    if (window.cajitasJoinRoomOnLoad && window.cajitasJoinRoomOnLoad.roomId) {
        console.log("[Main - DOMContentLoaded] Processing URL join immediately");
        await processUrlJoin(); 
    } else {
        console.log("[Main - DOMContentLoaded] No room to join from URL, showing setup screen.");
        ui.showSetupScreen(); // This calls updateGameModeUI internally
        
        // Generate initial player fields based on default game mode ('local')
        const gameModeSelect = document.getElementById('game-mode-select');
        if (gameModeSelect?.value === 'local') {
            const numPlayers = parseInt(document.getElementById('num-players-input')?.value || "2");
            ui.generatePlayerSetupFields(numPlayers, false, false);
        } else if (gameModeSelect?.value === 'vs-cpu') {
             const humanPlayers = parseInt(document.getElementById('human-players-cpu-mode-input')?.value || "1");
            ui.generatePlayerSetupFields(humanPlayers, false, true);
        } else { // Fallback if somehow gameModeSelect is not found or has unexpected value
            const numPlayers = parseInt(document.getElementById('num-players-input')?.value || "2");
            ui.generatePlayerSetupFields(numPlayers, false, false);
        }

        const undoBtnDOM = document.getElementById('undo-btn');
        if (undoBtnDOM) undoBtnDOM.disabled = true; 

        try {
            await peerConnection.ensurePeerInitialized();
             console.log('[Main] PeerJS pre-initialized on load. My ID:', state.myPeerId);
        } catch (err) {
            console.warn('[Main] Benign PeerJS pre-init error:', err.type, err.message || err);
        }
    }
    state.logCurrentState("DOMContentLoaded End");
    console.log("Cajitas de Danielle: Main script initialized.");
});