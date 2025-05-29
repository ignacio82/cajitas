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
export const numPlayersInput = document.getElementById('num-players-input'); // For local games
export const networkMaxPlayersSelect = document.getElementById('network-max-players'); // For hosting network games
export const playerCustomizationArea = document.getElementById('player-customization-area');

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
    updateGameModeUI();
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
        // Ensure players are sorted by ID for consistent display
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
            // Display player ID in lobby for clarity if needed for debugging: nameSpan.textContent = `${player.name || `Jugador ${player.id +1}`} (ID: ${player.id})`;
            nameSpan.textContent = player.name || `Jugador ${player.id === 0 ? 'Líder' : player.id + 1}`;
            if (player.peerId === roomData.leaderPeerId) {
                nameSpan.textContent += ' 👑 (Líder)';
            }
            if (player.peerId === state.myPeerId && player.peerId !== roomData.leaderPeerId) { // Avoid double "(Vos)" if leader
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
            lobbyToggleReadyBtn.classList.toggle('btn-secondary', !myPlayerData.isReady); // Assuming btn-secondary is the default "not ready" style
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
    // state.currentPlayerIndex now holds the ID of the current player
    const currentPlayer = state.playersData.find(p => p.id === state.currentPlayerIndex);

    if (!currentPlayer) {
        playerTurnDisplay.innerHTML = `Turno de: Error (ID ${state.currentPlayerIndex} no encontrado)`;
        console.error("updatePlayerTurnDisplay: Current player not found with ID:", state.currentPlayerIndex, "Players Data:", state.playersData);
        return;
    }
    let turnText = `Turno de ${currentPlayer.name} ${currentPlayer.icon}`;

    if (state.pvpRemoteActive && state.networkRoomData?.players?.length > 0) { // Check networkRoomData.players too
        // state.networkRoomData.myPlayerIdInRoom is the *ID* of this client in the game
        const isMyTurn = state.networkRoomData.myPlayerIdInRoom === state.currentPlayerIndex;

        if (state.networkRoomData.myPlayerIdInRoom !== null && state.networkRoomData.myPlayerIdInRoom !== undefined) { // If I am a player in the room
            turnText = isMyTurn ?
                `¡Tu turno, ${currentPlayer.name} ${currentPlayer.icon}!` :
                `Esperando a ${currentPlayer.name} ${currentPlayer.icon}...`;
        } else { // Spectating
            turnText = `Turno de ${currentPlayer.name} ${currentPlayer.icon} (Observando)`;
        }
    }
    playerTurnDisplay.innerHTML = `${turnText} <span style="color:${currentPlayer.color}; font-size: 1.5em;">●</span>`;
}


export function updateScoresDisplay() {
    if (!scoresDisplay) return;
    scoresDisplay.innerHTML = '';
    const playersToDisplay = state.playersData; // playersData contains {id, name, icon, color, score}

    if (!playersToDisplay || playersToDisplay.length === 0) return;

    // Sort by player ID for consistent display order
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
    messageArea.style.color = isError ? 'red' : '#FF69B4'; // Hot pink for normal messages
    if (message && !isError && duration > 0) {
        setTimeout(() => {
            if (messageArea.textContent === message) { // Only clear if message hasn't changed
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
    modalCloseBtn.innerHTML = "¡Dale!"; // Default close button text
    modalCloseBtn.style.display = 'inline-block'; // Ensure default close button is visible
    modalCloseBtn.onclick = () => hideModalMessage(); // Default action
    modalDynamicButtons.innerHTML = ''; // Clear any dynamic buttons
    modalDynamicButtons.style.display = 'none'; // Hide dynamic button container
}

export function hideModalMessage() {
    if (!customModal || !modalCloseBtn || !modalDynamicButtons) return;
    customModal.style.display = "none";
    // Reset modal to default state if needed (e.g. ensure close button visible)
    modalCloseBtn.style.display = 'inline-block';
    modalDynamicButtons.style.display = 'none';
}

export function showModalMessageWithActions(message, actions) {
    if (!customModal || !modalMessageText || !modalCloseBtn || !modalDynamicButtons) return;
    modalMessageText.textContent = message;
    modalCloseBtn.style.display = 'none'; // Hide default close button when actions are present

    modalDynamicButtons.innerHTML = ''; // Clear previous buttons
    actions.forEach(actionInfo => {
        const button = document.createElement('button');
        button.textContent = actionInfo.text;
        // Base classes for all action buttons
        button.className = 'font-semibold py-2 px-4 rounded-lg shadow-md transition-colors';

        // Specific styling based on type
        if (actionInfo.isConfirm) {
            button.classList.add('bg-green-500', 'hover:bg-green-600', 'text-white');
        } else if (actionInfo.isCancel) {
            button.classList.add('bg-gray-400', 'hover:bg-gray-500', 'text-white');
        } else { // Default action button style (e.g., pink)
            button.classList.add('bg-pink-500', 'hover:bg-pink-600', 'text-white');
        }

        button.onclick = () => {
            actionInfo.action();
            // Optionally hide modal after action, unless action itself handles it
            // if (actionInfo.autoHideModal !== false) hideModalMessage();
        };
        modalDynamicButtons.appendChild(button);
    });
    modalDynamicButtons.style.display = 'flex'; // Show container for dynamic buttons
    customModal.style.display = "block";
}


export function generatePlayerSetupFields(count, forNetwork = false) {
    if (!playerCustomizationArea) return;
    playerCustomizationArea.innerHTML = '';

    const maxCustomize = forNetwork ? 1 : count; // Only one set of fields for network player (self)

    for (let i = 0; i < maxCustomize; i++) {
        const card = document.createElement('div');
        card.className = 'player-setup-card';
        // Default border color, will be updated by color input
        card.style.borderColor = DEFAULT_PLAYER_COLORS[i % DEFAULT_PLAYER_COLORS.length];

        const nameLabel = document.createElement('label');
        nameLabel.htmlFor = `player-name-${i}`;
        nameLabel.textContent = forNetwork ? `Tu Nombre:` : `Nombre Jugador/a ${i + 1}:`;
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.id = `player-name-${i}`;
        // For network, provide a default name that might include part of peerId if available early
        const defaultNetworkName = `Jugador ${state.myPeerId ? state.myPeerId.slice(-4) : (i + 1)}`;
        nameInput.value = forNetwork ? defaultNetworkName : `Jugador/a ${i + 1}`;
        nameInput.maxLength = 15;

        const iconLabel = document.createElement('label');
        iconLabel.htmlFor = `player-icon-${i}`;
        iconLabel.textContent = forNetwork ? `Tu Ícono:` : `Ícono Jugador/a ${i + 1}:`;
        const iconSelect = document.createElement('select');
        iconSelect.id = `player-icon-${i}`;
        state.AVAILABLE_ICONS.forEach(icon => {
            const option = document.createElement('option');
            option.value = icon;
            option.textContent = icon;
            iconSelect.appendChild(option);
        });
        // Set a random default icon
        iconSelect.value = state.AVAILABLE_ICONS[Math.floor(Math.random() * state.AVAILABLE_ICONS.length)];

        const colorLabel = document.createElement('label');
        colorLabel.htmlFor = `player-color-${i}`;
        colorLabel.textContent = forNetwork ? `Tu Color:` : `Color Jugador/a ${i + 1}:`;
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
    // Message for network game setup if max players > 1 (leader sets up for self initially)
    if (forNetwork && networkMaxPlayersSelect && parseInt(networkMaxPlayersSelect.value) > 1) {
        const infoText = document.createElement('p');
        infoText.className = 'text-sm text-gray-600 mt-2';
        infoText.textContent = `Personalizarás tus datos. Los demás jugadores se unirán en la sala.`;
        playerCustomizationArea.appendChild(infoText);
    }
}
// ... (drawBoardSVG, drawVisualLineOnBoard, fillBoxOnBoard, etc. remain the same)
export function drawBoardSVG() {
    if (!gameBoardSVG) return;
    gameBoardSVG.innerHTML = ''; // Clear previous board
    const svgWidth = (state.numCols - 1) * state.CELL_SIZE + 2 * state.SVG_PADDING;
    const svgHeight = (state.numRows - 1) * state.CELL_SIZE + 2 * state.SVG_PADDING;
    gameBoardSVG.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`);

    // Group for lines (drawn by players)
    const linesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    linesGroup.id = 'drawn-lines-group';
    gameBoardSVG.appendChild(linesGroup);

    // Group for filled boxes (initials/icons)
    const boxesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    boxesGroup.id = 'filled-boxes-group';
    gameBoardSVG.appendChild(boxesGroup);

    // Draw dots and line slots
    for (let r_idx = 0; r_idx < state.numRows; r_idx++) {
        for (let c_idx = 0; c_idx < state.numCols; c_idx++) {
            // Draw dot
            const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            dot.setAttribute('cx', (state.SVG_PADDING + c_idx * state.CELL_SIZE).toString());
            dot.setAttribute('cy', (state.SVG_PADDING + r_idx * state.CELL_SIZE).toString());
            dot.setAttribute('r', state.DOT_RADIUS.toString());
            dot.setAttribute('fill', state.DOT_COLOR);
            gameBoardSVG.appendChild(dot);

            // Horizontal line slot (if not in the last column)
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
            // Vertical line slot (if not in the last row)
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

    const playerData = state.playersData.find(p => p.id === playerDrawingId) || { color: '#888888' }; // Fallback color
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('id', `line-${type}-${r_val}-${c_val}`);
    line.setAttribute('stroke', playerData.color);
    line.setAttribute('stroke-width', state.LINE_THICKNESS.toString());
    let x1, y1, x2, y2;
    if (type === 'h') {
        x1 = state.SVG_PADDING + c_val * state.CELL_SIZE + state.DOT_RADIUS; y1 = state.SVG_PADDING + r_val * state.CELL_SIZE;
        x2 = state.SVG_PADDING + (c_val + 1) * state.CELL_SIZE - state.DOT_RADIUS; y2 = state.SVG_PADDING + r_val * state.CELL_SIZE;
    } else { // type === 'v'
        x1 = state.SVG_PADDING + c_val * state.CELL_SIZE; y1 = state.SVG_PADDING + r_val * state.CELL_SIZE + state.DOT_RADIUS;
        x2 = state.SVG_PADDING + c_val * state.CELL_SIZE; y2 = state.SVG_PADDING + (r_val + 1) * state.CELL_SIZE - state.DOT_RADIUS;
    }
    line.setAttribute('x1', x1.toString()); line.setAttribute('y1', y1.toString());
    line.setAttribute('x2', x2.toString()); line.setAttribute('y2', y2.toString());
    // Animation for drawing the line
    const lineLength = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
    line.setAttribute('stroke-dasharray', lineLength.toString());
    line.setAttribute('stroke-dashoffset', lineLength.toString());
    line.setAttribute('class', 'line-drawn'); // For CSS transitions
    drawnLinesGroup.appendChild(line);
    // Trigger animation
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
        boxRect.setAttribute('fill', 'rgba(128,128,128,0.5)'); // Fallback fill
    }
    
    boxRect.setAttribute('rx', '6'); boxRect.setAttribute('ry', '6');
    boxRect.setAttribute('class', 'box-filled-anim'); // For CSS animation
    // For scale animation from center
    const originXRect = rectX + rectWidth / 2; const originYRect = rectY + rectHeight / 2;
    boxRect.style.transformOrigin = `${originXRect}px ${originYRect}px`;
    boxRect.style.transform = 'scale(0.2)'; // Initial state for animation
    filledBoxesGroup.appendChild(boxRect);

    // Add player icon/initial to the box
    const boxText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    const textX = state.SVG_PADDING + bc * state.CELL_SIZE + state.CELL_SIZE / 2;
    const textY = state.SVG_PADDING + br * state.CELL_SIZE + state.CELL_SIZE / 2;
    boxText.setAttribute('id', `boxtext-${br}-${bc}`);
    boxText.setAttribute('x', textX.toString()); boxText.setAttribute('y', textY.toString());
    boxText.setAttribute('fill', playerData.color); // Text color same as player color
    boxText.setAttribute('class', 'box-text box-text-anim'); // For styling and animation
    const dynamicFontSize = Math.max(10, Math.min(18, state.CELL_SIZE / 3.2)); // Responsive font size
    boxText.style.fontSize = `${dynamicFontSize}px`;
    const namePart = playerData.name && playerData.name.length > 0 ? playerData.name.substring(0, 1).toUpperCase() + "." : "";
    boxText.textContent = `${namePart}${playerData.icon || '?'}`;
    // Animation for text
    boxText.style.transformOrigin = `${textX}px ${textY}px`;
    boxText.style.transform = 'scale(0.2)'; boxText.style.opacity = '0';
    filledBoxesGroup.appendChild(boxText);

    // Trigger animations
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

    // Reset slot appearance and clickability (though listeners are added in initializeGame)
    const slots = gameBoardSVG?.querySelectorAll('.line-slot');
    slots?.forEach(slot => {
        slot.style.fill = 'rgba(0,0,0,0.03)'; // Default hoverable appearance
        slot.classList.remove('disabled-slot'); // Should be handled by setBoardClickable primarily
    });
}

export function removeVisualLineFromBoard(type, r_val, c_val) {
    const lineElement = document.getElementById(`line-${type}-${r_val}-${c_val}`);
    if (lineElement && lineElement.parentNode) {
        lineElement.style.opacity = '0'; // Fade out
        setTimeout(() => { if (lineElement.parentNode) lineElement.remove(); }, 300); // Remove after transition
    }
    // Restore slot appearance
    const slotElement = document.getElementById(`slot-${type}-${r_val}-${c_val}`);
     if (slotElement) {
        slotElement.style.fill = 'rgba(0,0,0,0.03)'; // Default hoverable fill
    }
}

export function removeFilledBoxFromBoard(br, bc) {
    const boxElement = document.getElementById(`box-${br}-${bc}`);
    const textElement = document.getElementById(`boxtext-${br}-${bc}`);
    if (boxElement && boxElement.parentNode) {
        boxElement.style.transform = 'scale(0.2)'; // Animate out
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
  if (qrCodeContainer) qrCodeContainer.innerHTML = ''; // Clear QR code
}

export function displayQRCode(gameLink, displayId, message = "Compartí este enlace o ID para que se unan:") {
    if (!networkInfoArea || !qrCodeContainer || !copyGameIdButton || !networkInfoTitle || !networkInfoText) {
        console.error("[UI] QR Code or Network Info Area elements not found!");
        showModalMessage(`ID de Sala: ${displayId}. Enlace: ${gameLink}. (Error UI QR)`);
        return;
    }
    if (!window.QRious) { // Check if QRious library is loaded
        console.warn('[UI] QRious library not loaded. Cannot display QR code.');
        showModalMessage(`ID de Sala: ${displayId}. Enlace: ${gameLink}. (QR Lib no cargada)`);
        if (networkInfoText) networkInfoText.textContent = `ID: ${displayId}. Link: ${gameLink}`;
        if (networkInfoArea) networkInfoArea.classList.remove('hidden'); // Show text info even if QR fails
        return;
    }

    console.log("[UI] displayQRCode: Making network info area visible and populating QR code");
    
    if (networkInfoArea) networkInfoArea.classList.remove('hidden');
    if (networkInfoTitle) networkInfoTitle.textContent = "¡Sala Creada!";
    if (networkInfoText) networkInfoText.textContent = `${message} ID: ${displayId}`;

    // Force reflow to ensure visibility before QR generation if it was just unhidden
    if (networkInfoArea) networkInfoArea.offsetHeight;

    if (qrCodeContainer) qrCodeContainer.innerHTML = ''; // Clear previous QR
    const canvas = document.createElement('canvas');
    try {
        new QRious({
            element: canvas,
            value: gameLink,
            size: 160, padding: 8, level: 'H', // QR code settings
            foreground: '#A020F0', background: '#FFF8FB' // Purple on light pinkish white
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

    // Ensure visibility again, as some operations might hide it
    if (networkInfoArea && networkInfoArea.classList.contains('hidden')) {
        console.warn("[UI] Network info area was hidden after setup - forcing visible");
        networkInfoArea.classList.remove('hidden');
    }
}


export function updateGameModeUI() {
    const inLobby = lobbyArea && !lobbyArea.classList.contains('hidden');
    // Disable setup fields if in lobby, or if pvpRemoteActive and not in idle/setup state for networkRoomData
    const disableSetupInputs = inLobby || (state.pvpRemoteActive && state.networkRoomData.roomState !== 'idle' && state.networkRoomData.roomState !== 'setup');

    if(rowsInput) rowsInput.disabled = disableSetupInputs;
    if(colsInput) colsInput.disabled = disableSetupInputs;
    if(numPlayersInput) numPlayersInput.disabled = disableSetupInputs;
    if(networkMaxPlayersSelect) networkMaxPlayersSelect.disabled = disableSetupInputs;

    // Disable player customization fields (name, icon, color)
    playerCustomizationArea?.querySelectorAll('input, select').forEach(el => {
        if(el instanceof HTMLElement) el.disabled = disableSetupInputs;
    });
    
    // Start Local Game button visibility
    if (startGameBtn) startGameBtn.style.display = (state.pvpRemoteActive || inLobby) ? 'none' : 'block';

    // Network game buttons (Host, Play Random) visibility
    const showNetworkSetupButtons = !state.pvpRemoteActive && !inLobby; // Only show if not already in a network game/lobby
    if (hostGameButton) hostGameButton.style.display = showNetworkSetupButtons ? 'inline-block' : 'none';
    if (playRandomButton) playRandomButton.style.display = showNetworkSetupButtons ? 'inline-block' : 'none';


    // Cancel Matchmaking Button & its associated message in networkInfoArea
    if (cancelMatchmakingButton && networkInfoArea && networkInfoTitle && networkInfoText && qrCodeContainer) {
        const isMatchmaking = state.pvpRemoteActive && state.networkRoomData.roomState === 'seeking_match';
        cancelMatchmakingButton.style.display = isMatchmaking ? 'inline-block' : 'none';

        if (isMatchmaking) {
            networkInfoArea.classList.remove('hidden');
            networkInfoTitle.textContent = "Buscando Partida...";
            networkInfoText.textContent = "Intentando encontrar oponentes al azar...";
            qrCodeContainer.innerHTML = ''; // No QR code while matchmaking
        } else {
            // If not matchmaking, hide the matchmaking-specific message.
            // displayQRCode and hideNetworkInfo will manage the area for actual room links.
            if (networkInfoTitle.textContent === "Buscando Partida...") {
                hideNetworkInfo(); // Clear matchmaking message if no longer matchmaking
            }
        }
    }

    // Undo button: disabled in PvP or if no undo move is available
    if (undoBtn) undoBtn.disabled = state.pvpRemoteActive || !state.lastMoveForUndo || !state.gameActive;
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
    
    // Extremely unlikely fallback if all random attempts also taken
    if (takenColors.includes(newColor)) {
        return `#${Math.floor(Math.random()*9)}${Math.floor(Math.random()*9)}${Math.floor(Math.random()*9)}${Math.floor(Math.random()*9)}${Math.floor(Math.random()*9)}${Math.floor(Math.random()*9)}`;
    }
    return newColor;
}


export function updateAvailableColors(takenColors = []) {
    const colorInput = document.getElementById('player-color-0'); // Assumes client customization is always 'player-color-0'
    if (!colorInput) return;
    
    const card = colorInput.closest('.player-setup-card');
    
    // This function is more of a UI hint. Primary color assignment is by the leader.
    // If the current input color is taken (and not by me via server assignment), suggest a new one.
    if (takenColors.includes(colorInput.value)) {
        const myCurrentAssignedColor = state.networkRoomData?.players?.find(p => p.peerId === state.myPeerId)?.color;
        if (colorInput.value !== myCurrentAssignedColor) { // If my input doesn't match my actual assigned color
            console.log(`[UI] My color picker shows ${colorInput.value}, but it's taken. Suggesting new one.`);
            const newSuggestedColor = getNextAvailableColor(takenColors);
            if (newSuggestedColor) {
                colorInput.value = newSuggestedColor;
                if (card) card.style.borderColor = newSuggestedColor;
            }
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if(numPlayersInput && playerCustomizationArea && !state.pvpRemoteActive && (state.networkRoomData.roomState === 'idle' || !state.networkRoomData.roomState) ) {
        generatePlayerSetupFields(parseInt(numPlayersInput.value || "2"));
    }
    updateGameModeUI();
});