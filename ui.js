// ui.js

import * as state from './state.js';
import { DEFAULT_PLAYER_COLORS } from './state.js'; // Import for color logic

// ---------- DOM ELEMENT REFERENCES ----------
export const mainTitle = document.getElementById('main-title');
export const setupSection = document.getElementById('setup-section');
export const gameArea = document.getElementById('game-area');
export const startGameBtn = document.getElementById('start-game-btn');
export const resetGameBtn = document.getElementById('reset-game-btn');
export const undoBtn = document.getElementById('undo-btn');

export const rowsInput = document.getElementById('rows');
export const colsInput = document.getElementById('cols');
export const numPlayersInput = document.getElementById('num-players-input'); // For local all-human games
export const networkMaxPlayersSelect = document.getElementById('network-max-players'); // For hosting network games
export const playerCustomizationArea = document.getElementById('player-customization-area');

// CPU Game Mode Elements (assuming they will be added to main.js getElementById if needed there)
// export const gameModeSelect = document.getElementById('game-mode-select');
// export const humanPlayersCpuModeInput = document.getElementById('human-players-cpu-mode-input');
// export const totalPlayersCpuModeInput = document.getElementById('total-players-cpu-mode-input');
// export const cpuDifficultySelect = document.getElementById('cpu-difficulty-select');

export const playerTurnDisplay = document.getElementById('player-turn');
export const scoresDisplay = document.getElementById('scores');
export const gameBoardSVG = document.getElementById('game-board-svg');
export const messageArea = document.getElementById('message-area');

export const customModal = document.getElementById('custom-modal');
export const modalMessageText = document.getElementById('modal-message-text');
export const modalCloseBtn = document.getElementById('modal-close-btn');
export const modalDynamicButtons = document.getElementById('modal-dynamic-buttons');


export const hostGameButton = document.getElementById('host-cajitas-btn');
export const playRandomButton = document.getElementById('play-random-cajitas-btn');

export const networkInfoArea = document.getElementById('network-info-area');
export const networkInfoTitle = document.getElementById('network-info-title');
export const qrCodeContainer = document.getElementById('qr-code-container');
export const networkInfoText = document.getElementById('network-info-text');
export const copyGameIdButton = document.getElementById('copy-game-id-btn');
export const cancelMatchmakingButton = document.getElementById('cancel-matchmaking-btn');

// Lobby Area Elements
export const lobbyArea = document.getElementById('lobby-area');
export const lobbyTitle = document.getElementById('lobby-title');
export const lobbyRoomIdDisplay = document.getElementById('lobby-room-id-display');
export const lobbyGameSettingsDisplay = document.getElementById('lobby-game-settings-display');
export const lobbyBoardSize = document.getElementById('lobby-board-size');
export const lobbyPlayerCount = document.getElementById('lobby-player-count');
export const lobbyPlayerList = document.getElementById('lobby-player-list');
export const lobbyMessageArea = document.getElementById('lobby-message-area');
export const lobbyToggleReadyBtn = document.getElementById('lobby-toggle-ready-btn');
export const lobbyStartGameLeaderBtn = document.getElementById('lobby-start-game-leader-btn');
export const lobbyLeaveRoomBtn = document.getElementById('lobby-leave-room-btn');


// ---------- UI STATE SWITCHING FUNCTIONS ----------

export function showSetupScreen() {
    if (setupSection) setupSection.classList.remove('hidden');
    if (gameArea) gameArea.classList.add('hidden');
    if (lobbyArea) lobbyArea.classList.add('hidden');
    if (mainTitle) mainTitle.textContent = "Cajitas de Danielle";
    hideNetworkInfo();
    updateGameModeUI(); // Ensure this is called to reflect current game state
}

export function showLobbyScreen() {
    if (setupSection) setupSection.classList.add('hidden');
    if (gameArea) gameArea.classList.add('hidden');
    if (lobbyArea) lobbyArea.classList.remove('hidden');
    if (mainTitle) mainTitle.textContent = "Sala de Espera";
}

export function showGameScreen() {
    if (setupSection) setupSection.classList.add('hidden');
    if (gameArea) gameArea.classList.remove('hidden');
    if (lobbyArea) lobbyArea.classList.add('hidden');
    if (mainTitle) mainTitle.textContent = "¡A Jugar!";
    hideNetworkInfo();
}

// ---------- LOBBY UI FUNCTIONS ----------

export function updateLobbyUI(roomData = state.networkRoomData) {
    if (!lobbyArea || lobbyArea.classList.contains('hidden') || !roomData) return;

    if (lobbyRoomIdDisplay) {
        const roomIdSpan = lobbyRoomIdDisplay.querySelector('span');
        if (roomIdSpan) roomIdSpan.textContent = roomData.roomId ? `${state.CAJITAS_PEER_ID_PREFIX}${roomData.roomId}` : 'N/A';
    }
    if (lobbyBoardSize && roomData.gameSettings) lobbyBoardSize.textContent = `${roomData.gameSettings.rows}x${roomData.gameSettings.cols}`;
    if (lobbyPlayerCount && roomData.players) lobbyPlayerCount.textContent = `${roomData.players.length}/${roomData.maxPlayers}`;

    if (lobbyPlayerList && roomData.players) {
        lobbyPlayerList.innerHTML = '';
        const sortedPlayers = [...roomData.players].sort((a, b) => (a.id || 0) - (b.id || 0));

        sortedPlayers.forEach(player => {
            const card = document.createElement('div');
            card.className = 'player-lobby-card flex items-center justify-between p-3 bg-white rounded-lg shadow transition-all duration-300 ease-in-out';
            card.style.borderLeft = `5px solid ${player.color || DEFAULT_PLAYER_COLORS[0]}`;
            if (player.peerId === state.myPeerId) {
                card.classList.add('ring-2', 'ring-purple-500');
            }

            const infoDiv = document.createElement('div');
            infoDiv.className = 'flex items-center';

            const iconSpan = document.createElement('span');
            iconSpan.className = 'text-2xl mr-2';
            iconSpan.textContent = player.icon || '❓';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'font-semibold text-gray-800';
            nameSpan.textContent = player.name || `Jugador ${player.id === 0 ? 'Líder' : player.id + 1}`;
            if (player.peerId === roomData.leaderPeerId) {
                nameSpan.textContent += ' 👑 (Líder)';
            }
            if (player.peerId === state.myPeerId && player.peerId !== roomData.leaderPeerId) { 
                nameSpan.textContent += ' (Vos)';
            }
            infoDiv.append(iconSpan, nameSpan);

            const readySpan = document.createElement('span');
            readySpan.className = 'text-xs sm:text-sm font-medium rounded-full px-2 py-1 transition-colors duration-300';
            if (player.isConnected) {
                readySpan.textContent = player.isReady ? '✔️ Listo' : '⏳ Esperando';
                readySpan.classList.add(player.isReady ? 'bg-green-100' : 'bg-yellow-100');
                readySpan.classList.add(player.isReady ? 'text-green-700' : 'text-yellow-700');
            } else {
                readySpan.textContent = '❌ Desconectado';
                readySpan.classList.add('bg-red-100', 'text-red-700');
            }

            card.append(infoDiv, readySpan);
            lobbyPlayerList.appendChild(card);
        });
    }

    if (lobbyToggleReadyBtn && roomData.players) {
        const myPlayerData = roomData.players.find(p => p.peerId === state.myPeerId);
        if (myPlayerData) {
            lobbyToggleReadyBtn.textContent = myPlayerData.isReady ? 'Marcar como NO Listo ❌' : 'Marcar como Listo 👍';
            lobbyToggleReadyBtn.classList.toggle('bg-red-500', myPlayerData.isReady);
            lobbyToggleReadyBtn.classList.toggle('hover:bg-red-600', myPlayerData.isReady);
            lobbyToggleReadyBtn.classList.toggle('btn-secondary', !myPlayerData.isReady); 
        }
        lobbyToggleReadyBtn.disabled = roomData.roomState === 'in_game';
    }

    if (lobbyStartGameLeaderBtn && roomData.players) {
        const allConnectedAndReady = roomData.players.length >= state.MIN_PLAYERS_NETWORK &&
                                   roomData.players.every(p => p.isReady && p.isConnected);
        lobbyStartGameLeaderBtn.style.display = roomData.isRoomLeader && roomData.roomState !== 'in_game' ? 'block' : 'none';
        lobbyStartGameLeaderBtn.disabled = !allConnectedAndReady;
        lobbyStartGameLeaderBtn.title = !allConnectedAndReady ? `Se necesitan ${state.MIN_PLAYERS_NETWORK}-${roomData.maxPlayers} jugadores listos y conectados.` : 'Iniciar el juego para todos';
    }
    
    if (!roomData.isRoomLeader && roomData.players) {
        const takenColors = roomData.players
            .filter(p => p.peerId !== state.myPeerId)
            .map(p => p.color);
        updateAvailableColors(takenColors);
    }
}

export function updateLobbyMessage(message, isError = false) {
    if (!lobbyMessageArea) return;
    lobbyMessageArea.textContent = message;
    lobbyMessageArea.style.color = isError ? 'red' : '#D946EF';
}

// ---------- GENERAL UI UPDATE FUNCTIONS ----------
export function updatePlayerTurnDisplay() {
    if (!playerTurnDisplay) return;
    if (!state.gameActive || !state.playersData || state.playersData.length === 0) {
        playerTurnDisplay.innerHTML = '';
        return;
    }
    const currentPlayer = state.playersData.find(p => p.id === state.currentPlayerIndex);

    if (!currentPlayer) {
        playerTurnDisplay.innerHTML = `Turno de: Error (ID ${state.currentPlayerIndex} no encontrado)`;
        console.error("updatePlayerTurnDisplay: Current player not found with ID:", state.currentPlayerIndex, "Players Data:", state.playersData);
        return;
    }
    let turnText = `Turno de ${currentPlayer.name} ${currentPlayer.icon || ''}`; // Added icon here

    if (state.pvpRemoteActive && state.networkRoomData?.players?.length > 0) { 
        const isMyTurn = state.networkRoomData.myPlayerIdInRoom === state.currentPlayerIndex;
        if (state.networkRoomData.myPlayerIdInRoom !== null && state.networkRoomData.myPlayerIdInRoom !== undefined) { 
            turnText = isMyTurn ?
                `¡Tu turno, ${currentPlayer.name} ${currentPlayer.icon || ''}!` :
                `Esperando a ${currentPlayer.name} ${currentPlayer.icon || ''}...`;
        } else { 
            turnText = `Turno de ${currentPlayer.name} ${currentPlayer.icon || ''} (Observando)`;
        }
    }
    playerTurnDisplay.innerHTML = `${turnText} <span style="color:${currentPlayer.color}; font-size: 1.5em;">●</span>`;
}


export function updateScoresDisplay() {
    if (!scoresDisplay) return;
    scoresDisplay.innerHTML = '';
    const playersToDisplay = state.playersData; 

    if (!playersToDisplay || playersToDisplay.length === 0) return;

    const sortedPlayers = [...playersToDisplay].sort((a, b) => (a.id || 0) - (b.id || 0));

    sortedPlayers.forEach((player) => {
        if (!player || typeof player.color !== 'string' || player.color.length < 3) {
             console.warn("updateScoresDisplay: Invalid player data or color", player);
             return;
        }
        const scoreDiv = document.createElement('div');
        scoreDiv.classList.add('p-2', 'rounded-lg', 'shadow-md', 'text-sm', 'md:text-base');
        try {
            if (!player.color.startsWith('#')) throw new Error("Color not hex");
            let r_col = parseInt(player.color.slice(1, 3), 16);
            let g_col = parseInt(player.color.slice(3, 5), 16);
            let b_col = parseInt(player.color.slice(5, 7), 16);
            if (isNaN(r_col) || isNaN(g_col) || isNaN(b_col)) throw new Error("Invalid hex components");

            scoreDiv.style.backgroundColor = `rgba(${r_col},${g_col},${b_col},0.3)`;
            scoreDiv.style.border = `2px solid ${player.color}`;
        } catch (e) {
            console.warn("updateScoresDisplay: Error parsing player color, using fallback.", player.color, e);
            scoreDiv.style.backgroundColor = `rgba(200,200,200,0.3)`;
            scoreDiv.style.border = `2px solid #888888`;
        }
        scoreDiv.style.color = player.color;
        scoreDiv.style.fontWeight = 'bold';
        scoreDiv.innerHTML = `${player.name || 'Jugador'} ${player.icon || '❓'}: <span class="text-xl md:text-2xl">${player.score !== undefined ? player.score : 0}</span>`;
        scoresDisplay.appendChild(scoreDiv);
    });
}

export function updateMessageArea(message, isError = false, duration = 3000) {
    if (!messageArea) return;
    messageArea.textContent = message;
    messageArea.style.color = isError ? 'red' : '#FF69B4'; 
    if (message && !isError && duration > 0) {
        setTimeout(() => {
            if (messageArea.textContent === message) { 
                messageArea.textContent = '';
            }
        }, duration);
    }
}

export function setBoardClickable(clickable) {
    if (!gameBoardSVG) return;
    gameBoardSVG.style.pointerEvents = clickable ? 'auto' : 'none';
    const slots = gameBoardSVG.querySelectorAll('.line-slot');
    slots.forEach(slot => {
        if (clickable) {
            slot.classList.remove('disabled-slot');
        } else {
            slot.classList.add('disabled-slot');
        }
    });
}

export function showModalMessage(message) {
    if (!customModal || !modalMessageText || !modalCloseBtn || !modalDynamicButtons) return;
    modalMessageText.textContent = message;
    customModal.style.display = "block";
    modalCloseBtn.innerHTML = "¡Dale!"; 
    modalCloseBtn.style.display = 'inline-block'; 
    modalCloseBtn.onclick = () => hideModalMessage(); 
    modalDynamicButtons.innerHTML = ''; 
    modalDynamicButtons.style.display = 'none'; 
}

export function hideModalMessage() {
    if (!customModal || !modalCloseBtn || !modalDynamicButtons) return;
    customModal.style.display = "none";
    modalCloseBtn.style.display = 'inline-block';
    modalDynamicButtons.style.display = 'none';
}

export function showModalMessageWithActions(message, actions) {
    if (!customModal || !modalMessageText || !modalCloseBtn || !modalDynamicButtons) return;
    modalMessageText.textContent = message;
    modalCloseBtn.style.display = 'none'; 

    modalDynamicButtons.innerHTML = ''; 
    actions.forEach(actionInfo => {
        const button = document.createElement('button');
        button.textContent = actionInfo.text;
        button.className = 'font-semibold py-2 px-4 rounded-lg shadow-md transition-colors';

        if (actionInfo.isConfirm) {
            button.classList.add('bg-green-500', 'hover:bg-green-600', 'text-white');
        } else if (actionInfo.isCancel) {
            button.classList.add('bg-gray-400', 'hover:bg-gray-500', 'text-white');
        } else { 
            button.classList.add('bg-pink-500', 'hover:bg-pink-600', 'text-white');
        }

        button.onclick = () => {
            actionInfo.action();
        };
        modalDynamicButtons.appendChild(button);
    });
    modalDynamicButtons.style.display = 'flex'; 
    customModal.style.display = "block";
}

/**
 * Generates player setup fields in the UI.
 * @param {number} count - Number of player fields to generate (e.g., total local players or human players in CPU mode).
 * @param {boolean} forNetwork - True if these fields are for a network game (only one set for self).
 * @param {boolean} isCpuGameMode - True if the game mode involves CPU players.
 */
export function generatePlayerSetupFields(count, forNetwork = false, isCpuGameMode = false) {
    if (!playerCustomizationArea) return;
    playerCustomizationArea.innerHTML = '';

    // If forNetwork, only 1 field for the local player.
    // Otherwise, 'count' fields (e.g., human players in CPU mode, or all players in local mode).
    const maxCustomize = forNetwork ? 1 : count;

    for (let i = 0; i < maxCustomize; i++) {
        const card = document.createElement('div');
        card.className = 'player-setup-card';
        card.style.borderColor = DEFAULT_PLAYER_COLORS[i % DEFAULT_PLAYER_COLORS.length];

        const nameLabel = document.createElement('label');
        nameLabel.htmlFor = `player-name-${i}`;
        
        const iconLabel = document.createElement('label');
        iconLabel.htmlFor = `player-icon-${i}`;
        
        const colorLabel = document.createElement('label');
        colorLabel.htmlFor = `player-color-${i}`;

        let defaultPlayerNameText;

        if (forNetwork) { // Network game, customizing self
            nameLabel.textContent = `Tu Nombre:`;
            iconLabel.textContent = `Tu Ícono:`;
            colorLabel.textContent = `Tu Color:`;
            defaultPlayerNameText = `Jugador ${state.myPeerId ? state.myPeerId.slice(-4) : (i + 1)}`;
        } else if (isCpuGameMode) { // CPU game mode, customizing human players
            if (count === 1) { // Single human player vs CPU(s)
                nameLabel.textContent = `Tu Nombre (Humano):`;
                iconLabel.textContent = `Tu Ícono (Humano):`;
                colorLabel.textContent = `Tu Color (Humano):`;
                defaultPlayerNameText = `Humano 1`;
            } else { // Multiple human players vs CPU(s) or each other + CPU
                nameLabel.textContent = `Nombre Humano ${i + 1}:`;
                iconLabel.textContent = `Ícono Humano ${i + 1}:`;
                colorLabel.textContent = `Color Humano ${i + 1}:`;
                defaultPlayerNameText = `Humano ${i + 1}`;
            }
        } else { // Local all-human game
            nameLabel.textContent = `Nombre Jugador/a ${i + 1}:`;
            iconLabel.textContent = `Ícono Jugador/a ${i + 1}:`;
            colorLabel.textContent = `Color Jugador/a ${i + 1}:`;
            defaultPlayerNameText = `Jugador/a ${i + 1}`;
        }
        
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.id = `player-name-${i}`;
        nameInput.value = defaultPlayerNameText;
        nameInput.maxLength = 15;

        const iconSelect = document.createElement('select');
        iconSelect.id = `player-icon-${i}`;
        state.AVAILABLE_ICONS.forEach(icon => {
            const option = document.createElement('option');
            option.value = icon;
            option.textContent = icon;
            iconSelect.appendChild(option);
        });
        iconSelect.value = state.AVAILABLE_ICONS[Math.floor(Math.random() * state.AVAILABLE_ICONS.length)];

        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.id = `player-color-${i}`;
        colorInput.value = DEFAULT_PLAYER_COLORS[i % DEFAULT_PLAYER_COLORS.length];
        colorInput.addEventListener('input', (e) => {
            if (card) card.style.borderColor = e.target.value;
        });

        card.append(nameLabel, nameInput, iconLabel, iconSelect, colorLabel, colorInput);
        playerCustomizationArea.appendChild(card);
    }
    
    // Message for network game setup if max players > 1
    if (forNetwork && networkMaxPlayersSelect && parseInt(networkMaxPlayersSelect.value) > 1) {
        const infoText = document.createElement('p');
        infoText.className = 'text-sm text-gray-600 mt-2';
        infoText.textContent = `Personalizarás tus datos. Los demás jugadores se unirán en la sala.`;
        playerCustomizationArea.appendChild(infoText);
    }
    // No specific message for CPU mode here, as CPUs don't use these fields.
}

export function drawBoardSVG() {
    if (!gameBoardSVG) return;
    gameBoardSVG.innerHTML = ''; 
    const svgWidth = (state.numCols - 1) * state.CELL_SIZE + 2 * state.SVG_PADDING;
    const svgHeight = (state.numRows - 1) * state.CELL_SIZE + 2 * state.SVG_PADDING;
    gameBoardSVG.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`);

    const linesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    linesGroup.id = 'drawn-lines-group';
    gameBoardSVG.appendChild(linesGroup);

    const boxesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    boxesGroup.id = 'filled-boxes-group';
    gameBoardSVG.appendChild(boxesGroup);

    for (let r_idx = 0; r_idx < state.numRows; r_idx++) {
        for (let c_idx = 0; c_idx < state.numCols; c_idx++) {
            const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            dot.setAttribute('cx', (state.SVG_PADDING + c_idx * state.CELL_SIZE).toString());
            dot.setAttribute('cy', (state.SVG_PADDING + r_idx * state.CELL_SIZE).toString());
            dot.setAttribute('r', state.DOT_RADIUS.toString());
            dot.setAttribute('fill', state.DOT_COLOR);
            gameBoardSVG.appendChild(dot);

            if (c_idx < state.numCols - 1) {
                const hSlot = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                hSlot.setAttribute('id', `slot-h-${r_idx}-${c_idx}`);
                hSlot.setAttribute('x', (state.SVG_PADDING + c_idx * state.CELL_SIZE + state.DOT_RADIUS / 2).toString());
                hSlot.setAttribute('y', (state.SVG_PADDING + r_idx * state.CELL_SIZE - (state.LINE_THICKNESS / 2 + state.CLICKABLE_AREA_EXTENSION / 2)).toString());
                hSlot.setAttribute('width', (state.CELL_SIZE - state.DOT_RADIUS).toString());
                hSlot.setAttribute('height', (state.LINE_THICKNESS + state.CLICKABLE_AREA_EXTENSION).toString());
                hSlot.setAttribute('class', 'line-slot');
                hSlot.dataset.type = 'h'; hSlot.dataset.r = r_idx.toString(); hSlot.dataset.c = c_idx.toString();
                gameBoardSVG.appendChild(hSlot);
            }
            if (r_idx < state.numRows - 1) {
                const vSlot = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                vSlot.setAttribute('id', `slot-v-${r_idx}-${c_idx}`);
                vSlot.setAttribute('x', (state.SVG_PADDING + c_idx * state.CELL_SIZE - (state.LINE_THICKNESS / 2 + state.CLICKABLE_AREA_EXTENSION / 2)).toString());
                vSlot.setAttribute('y', (state.SVG_PADDING + r_idx * state.CELL_SIZE + state.DOT_RADIUS / 2).toString());
                vSlot.setAttribute('width', (state.LINE_THICKNESS + state.CLICKABLE_AREA_EXTENSION).toString());
                vSlot.setAttribute('height', (state.CELL_SIZE - state.DOT_RADIUS).toString());
                vSlot.setAttribute('class', 'line-slot');
                vSlot.dataset.type = 'v'; vSlot.dataset.r = r_idx.toString(); vSlot.dataset.c = c_idx.toString();
                gameBoardSVG.appendChild(vSlot);
            }
        }
    }
}

export function drawVisualLineOnBoard(type, r_val, c_val, playerDrawingId) {
    const drawnLinesGroup = document.getElementById('drawn-lines-group');
    if (!drawnLinesGroup) return null;

    const playerData = state.playersData.find(p => p.id === playerDrawingId) || { color: '#888888' }; 
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('id', `line-${type}-${r_val}-${c_val}`);
    line.setAttribute('stroke', playerData.color);
    line.setAttribute('stroke-width', state.LINE_THICKNESS.toString());
    let x1, y1, x2, y2;
    if (type === 'h') {
        x1 = state.SVG_PADDING + c_val * state.CELL_SIZE + state.DOT_RADIUS; y1 = state.SVG_PADDING + r_val * state.CELL_SIZE;
        x2 = state.SVG_PADDING + (c_val + 1) * state.CELL_SIZE - state.DOT_RADIUS; y2 = state.SVG_PADDING + r_val * state.CELL_SIZE;
    } else { 
        x1 = state.SVG_PADDING + c_val * state.CELL_SIZE; y1 = state.SVG_PADDING + r_val * state.CELL_SIZE + state.DOT_RADIUS;
        x2 = state.SVG_PADDING + c_val * state.CELL_SIZE; y2 = state.SVG_PADDING + (r_val + 1) * state.CELL_SIZE - state.DOT_RADIUS;
    }
    line.setAttribute('x1', x1.toString()); line.setAttribute('y1', y1.toString());
    line.setAttribute('x2', x2.toString()); line.setAttribute('y2', y2.toString());
    const lineLength = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
    line.setAttribute('stroke-dasharray', lineLength.toString());
    line.setAttribute('stroke-dashoffset', lineLength.toString());
    line.setAttribute('class', 'line-drawn'); 
    drawnLinesGroup.appendChild(line);
    requestAnimationFrame(() => { line.setAttribute('stroke-dashoffset', '0'); });
    return line;
}

export function fillBoxOnBoard(br, bc, playerFillingBoxId) {
    const filledBoxesGroup = document.getElementById('filled-boxes-group');
    if(!filledBoxesGroup) return null;

    const playerData = state.playersData.find(p => p.id === playerFillingBoxId) || { color: '#888888', icon: '?', name: '??' };
    const boxRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    const rectX = state.SVG_PADDING + bc * state.CELL_SIZE + state.LINE_THICKNESS / 2;
    const rectY = state.SVG_PADDING + br * state.CELL_SIZE + state.LINE_THICKNESS / 2;
    const rectWidth = state.CELL_SIZE - state.LINE_THICKNESS; const rectHeight = state.CELL_SIZE - state.LINE_THICKNESS;
    boxRect.setAttribute('id', `box-${br}-${bc}`);
    boxRect.setAttribute('x', rectX.toString()); boxRect.setAttribute('y', rectY.toString());
    boxRect.setAttribute('width', rectWidth.toString()); boxRect.setAttribute('height', rectHeight.toString());
    
    try {
        let r_color = parseInt(playerData.color.slice(1, 3), 16);
        let g_color = parseInt(playerData.color.slice(3, 5), 16);
        let b_color = parseInt(playerData.color.slice(5, 7), 16);
        boxRect.setAttribute('fill', `rgba(${r_color},${g_color},${b_color},0.5)`);
    } catch (e) {
        boxRect.setAttribute('fill', 'rgba(128,128,128,0.5)'); 
    }
    
    boxRect.setAttribute('rx', '6'); boxRect.setAttribute('ry', '6');
    boxRect.setAttribute('class', 'box-filled-anim'); 
    const originXRect = rectX + rectWidth / 2; const originYRect = rectY + rectHeight / 2;
    boxRect.style.transformOrigin = `${originXRect}px ${originYRect}px`;
    boxRect.style.transform = 'scale(0.2)'; 
    filledBoxesGroup.appendChild(boxRect);

    const boxText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    const textX = state.SVG_PADDING + bc * state.CELL_SIZE + state.CELL_SIZE / 2;
    const textY = state.SVG_PADDING + br * state.CELL_SIZE + state.CELL_SIZE / 2;
    boxText.setAttribute('id', `boxtext-${br}-${bc}`);
    boxText.setAttribute('x', textX.toString()); boxText.setAttribute('y', textY.toString());
    boxText.setAttribute('fill', playerData.color); 
    boxText.setAttribute('class', 'box-text box-text-anim'); 
    const dynamicFontSize = Math.max(10, Math.min(18, state.CELL_SIZE / 3.2)); 
    boxText.style.fontSize = `${dynamicFontSize}px`;
    const namePart = playerData.name && playerData.name.length > 0 ? playerData.name.substring(0, 1).toUpperCase() + "." : "";
    boxText.textContent = `${namePart}${playerData.icon || '?'}`;
    boxText.style.transformOrigin = `${textX}px ${textY}px`;
    boxText.style.transform = 'scale(0.2)'; boxText.style.opacity = '0';
    filledBoxesGroup.appendChild(boxText);

    requestAnimationFrame(() => {
        if (boxRect && boxRect.parentNode) boxRect.style.transform = 'scale(1)';
        if (boxText && boxText.parentNode) {
             boxText.style.transform = 'scale(1)';
             boxText.style.opacity = '1';
        }
    });
    return { boxRect, boxText };
}

export function clearBoardForNewGame() {
    const linesGroup = document.getElementById('drawn-lines-group');
    const boxesGroup = document.getElementById('filled-boxes-group');
    if (linesGroup) linesGroup.innerHTML = '';
    if (boxesGroup) boxesGroup.innerHTML = '';

    const slots = gameBoardSVG?.querySelectorAll('.line-slot');
    slots?.forEach(slot => {
        slot.style.fill = 'rgba(0,0,0,0.03)'; 
        slot.classList.remove('disabled-slot'); 
    });
}

export function removeVisualLineFromBoard(type, r_val, c_val) {
    const lineElement = document.getElementById(`line-${type}-${r_val}-${c_val}`);
    if (lineElement && lineElement.parentNode) {
        lineElement.style.opacity = '0'; 
        setTimeout(() => { if (lineElement.parentNode) lineElement.remove(); }, 300); 
    }
    const slotElement = document.getElementById(`slot-${type}-${r_val}-${c_val}`);
     if (slotElement) {
        slotElement.style.fill = 'rgba(0,0,0,0.03)'; 
    }
}

export function removeFilledBoxFromBoard(br, bc) {
    const boxElement = document.getElementById(`box-${br}-${bc}`);
    const textElement = document.getElementById(`boxtext-${br}-${bc}`);
    if (boxElement && boxElement.parentNode) {
        boxElement.style.transform = 'scale(0.2)'; 
        setTimeout(() => { if (boxElement.parentNode) boxElement.remove(); }, 300);
    }
    if (textElement && textElement.parentNode) {
        textElement.style.transform = 'scale(0.2)';
        textElement.style.opacity = '0';
        setTimeout(() => { if (textElement.parentNode) textElement.remove(); }, 300);
    }
}

// ---------- NETWORK UI FUNCTIONS (QR, Info Area) ----------

export function hideNetworkInfo() {
  if (networkInfoArea) networkInfoArea.classList.add('hidden');
  if (qrCodeContainer) qrCodeContainer.innerHTML = ''; 
}

export function displayQRCode(gameLink, displayId, message = "Compartí este enlace o ID para que se unan:") {
    if (!networkInfoArea || !qrCodeContainer || !copyGameIdButton || !networkInfoTitle || !networkInfoText) {
        console.error("[UI] QR Code or Network Info Area elements not found!");
        showModalMessage(`ID de Sala: ${displayId}. Enlace: ${gameLink}. (Error UI QR)`);
        return;
    }
    if (!window.QRious) { 
        console.warn('[UI] QRious library not loaded. Cannot display QR code.');
        showModalMessage(`ID de Sala: ${displayId}. Enlace: ${gameLink}. (QR Lib no cargada)`);
        if (networkInfoText) networkInfoText.textContent = `ID: ${displayId}. Link: ${gameLink}`;
        if (networkInfoArea) networkInfoArea.classList.remove('hidden'); 
        return;
    }

    console.log("[UI] displayQRCode: Making network info area visible and populating QR code");
    
    if (networkInfoArea) networkInfoArea.classList.remove('hidden');
    if (networkInfoTitle) networkInfoTitle.textContent = "¡Sala Creada!";
    if (networkInfoText) networkInfoText.textContent = `${message} ID: ${displayId}`;

    if (networkInfoArea) networkInfoArea.offsetHeight;

    if (qrCodeContainer) qrCodeContainer.innerHTML = ''; 
    const canvas = document.createElement('canvas');
    try {
        new QRious({
            element: canvas,
            value: gameLink,
            size: 160, padding: 8, level: 'H', 
            foreground: '#A020F0', background: '#FFF8FB' 
        });
        if (qrCodeContainer) qrCodeContainer.appendChild(canvas);
        console.log("[UI] QR code generated and added to container");
    } catch(e) {
        console.error("[UI] Error generating QR code:", e);
        if (qrCodeContainer) qrCodeContainer.textContent = "Error QR.";
        if (networkInfoText) networkInfoText.textContent += " (Error al generar QR)";
        showModalMessage(`Error al generar QR. ID: ${displayId}. Link: ${gameLink}`);
        return;
    }

    if (copyGameIdButton) {
        copyGameIdButton.textContent = "Copiar Enlace de Sala";
        copyGameIdButton.onclick = () => {
            navigator.clipboard.writeText(gameLink)
                .then(() => updateMessageArea('¡Enlace de la sala copiado!', false, 2000))
                .catch(err => {
                    console.error('[UI] Error copying game link:', err);
                    updateMessageArea('Error al copiar enlace.', true, 2000);
                });
        };
    }

    if (networkInfoArea && networkInfoArea.classList.contains('hidden')) {
        console.warn("[UI] Network info area was hidden after setup - forcing visible");
        networkInfoArea.classList.remove('hidden');
    }
}


export function updateGameModeUI() {
    const inLobby = lobbyArea && !lobbyArea.classList.contains('hidden');
    const disableSetupInputs = inLobby || (state.pvpRemoteActive && state.networkRoomData.roomState !== 'idle' && state.networkRoomData.roomState !== 'setup');

    if(rowsInput) rowsInput.disabled = disableSetupInputs;
    if(colsInput) colsInput.disabled = disableSetupInputs;
    
    // Game mode specific inputs
    const gameModeSelect = document.getElementById('game-mode-select');
    const localPlayersConfigSection = document.getElementById('local-players-config-section');
    const cpuGameSection = document.getElementById('cpu-game-section');
    const humanPlayersCpuModeInput = document.getElementById('human-players-cpu-mode-input');
    const totalPlayersCpuModeInput = document.getElementById('total-players-cpu-mode-input');
    const cpuDifficultySelect = document.getElementById('cpu-difficulty-select');


    if (gameModeSelect) gameModeSelect.disabled = disableSetupInputs;
    if (numPlayersInput) numPlayersInput.disabled = disableSetupInputs; // Part of local-players-config-section
    if (humanPlayersCpuModeInput) humanPlayersCpuModeInput.disabled = disableSetupInputs;
    if (totalPlayersCpuModeInput) totalPlayersCpuModeInput.disabled = disableSetupInputs;
    if (cpuDifficultySelect) cpuDifficultySelect.disabled = disableSetupInputs;


    if(networkMaxPlayersSelect) networkMaxPlayersSelect.disabled = disableSetupInputs;

    playerCustomizationArea?.querySelectorAll('input, select').forEach(el => {
        if(el instanceof HTMLElement) el.disabled = disableSetupInputs;
    });
    
    if (startGameBtn) startGameBtn.style.display = (state.pvpRemoteActive || inLobby) ? 'none' : 'block';

    const showNetworkSetupButtons = !state.pvpRemoteActive && !inLobby; 
    if (hostGameButton) hostGameButton.style.display = showNetworkSetupButtons ? 'inline-block' : 'none';
    if (playRandomButton) playRandomButton.style.display = showNetworkSetupButtons ? 'inline-block' : 'none';


    if (cancelMatchmakingButton && networkInfoArea && networkInfoTitle && networkInfoText && qrCodeContainer) {
        const isMatchmaking = state.pvpRemoteActive && state.networkRoomData.roomState === 'seeking_match';
        cancelMatchmakingButton.style.display = isMatchmaking ? 'inline-block' : 'none';

        if (isMatchmaking) {
            networkInfoArea.classList.remove('hidden');
            networkInfoTitle.textContent = "Buscando Partida...";
            networkInfoText.textContent = "Intentando encontrar oponentes al azar...";
            qrCodeContainer.innerHTML = ''; 
        } else {
            if (networkInfoTitle.textContent === "Buscando Partida...") {
                hideNetworkInfo(); 
            }
        }
    }

    if (undoBtn) undoBtn.disabled = state.pvpRemoteActive || !state.lastMoveForUndo || !state.gameActive;

    // Show/hide local vs CPU config sections based on gameModeSelect (if not in network/lobby)
    if (!disableSetupInputs && gameModeSelect && localPlayersConfigSection && cpuGameSection) {
        if (gameModeSelect.value === 'vs-cpu') {
            localPlayersConfigSection.classList.add('hidden');
            cpuGameSection.classList.remove('hidden');
        } else { // 'local'
            localPlayersConfigSection.classList.remove('hidden');
            cpuGameSection.classList.add('hidden');
        }
    } else if (disableSetupInputs && localPlayersConfigSection && cpuGameSection) {
        // If inputs are disabled (e.g., in lobby/network game), perhaps hide both or ensure consistency
        // For now, just let them be disabled.
    }
}


export function getNextAvailableColor(takenColors = []) {
    const availableDefault = DEFAULT_PLAYER_COLORS.find(color => !takenColors.includes(color));
    if (availableDefault) return availableDefault;
    
    let newColor;
    let attempts = 0;
    do {
        newColor = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
        attempts++;
    } while (takenColors.includes(newColor) && attempts < 20);
    
    if (takenColors.includes(newColor)) {
        return `#${Math.floor(Math.random()*9)}${Math.floor(Math.random()*9)}${Math.floor(Math.random()*9)}${Math.floor(Math.random()*9)}${Math.floor(Math.random()*9)}${Math.floor(Math.random()*9)}`;
    }
    return newColor;
}


export function updateAvailableColors(takenColors = []) {
    const colorInput = document.getElementById('player-color-0'); 
    if (!colorInput) return;
    
    const card = colorInput.closest('.player-setup-card');
    
    if (takenColors.includes(colorInput.value)) {
        const myCurrentAssignedColor = state.networkRoomData?.players?.find(p => p.peerId === state.myPeerId)?.color;
        if (colorInput.value !== myCurrentAssignedColor) { 
            console.log(`[UI] My color picker shows ${colorInput.value}, but it's taken. Suggesting new one.`);
            const newSuggestedColor = getNextAvailableColor(takenColors);
            if (newSuggestedColor) {
                colorInput.value = newSuggestedColor;
                if (card) card.style.borderColor = newSuggestedColor;
            }
        }
    }
}

// Initial call on DOM load
document.addEventListener('DOMContentLoaded', () => {
    // Default to local human player setup fields
    // The gameModeSelect listener in main.js will adjust this if 'vs-cpu' is chosen
    if (numPlayersInput && playerCustomizationArea && !state.pvpRemoteActive &&
        (state.networkRoomData.roomState === 'idle' || !state.networkRoomData.roomState)) {
        
        const gameModeSelect = document.getElementById('game-mode-select');
        if (gameModeSelect && gameModeSelect.value === 'local') {
            generatePlayerSetupFields(parseInt(numPlayersInput.value || "2"), false, false);
        } else if (gameModeSelect && gameModeSelect.value === 'vs-cpu') {
            const humanPlayersInput = document.getElementById('human-players-cpu-mode-input');
            generatePlayerSetupFields(parseInt(humanPlayersInput?.value || "1"), false, true);
        } else { // Fallback or initial state before mode select is processed
             generatePlayerSetupFields(parseInt(numPlayersInput?.value || "2"), false, false);
        }
    }
    updateGameModeUI(); // This will also handle showing/hiding CPU/Local sections initially
});