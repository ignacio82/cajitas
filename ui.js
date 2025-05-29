// ui.js

import * as state from './state.js';

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
    hideQRCode();
    updateGameModeUI(); // Ensure correct buttons are shown/hidden
}

export function showLobbyScreen() {
    if (setupSection) setupSection.classList.add('hidden');
    if (gameArea) gameArea.classList.add('hidden');
    if (lobbyArea) lobbyArea.classList.remove('hidden');
    if (mainTitle) mainTitle.textContent = "Sala de Espera";
    hideQRCode(); // QR code is usually for sharing before lobby, or handled within lobby UI if needed
    // updateLobbyUI will be called to populate details
}

export function showGameScreen() {
    if (setupSection) setupSection.classList.add('hidden');
    if (gameArea) gameArea.classList.remove('hidden');
    if (lobbyArea) lobbyArea.classList.add('hidden');
    if (mainTitle) mainTitle.textContent = "¡A Jugar!";
    hideQRCode();
}

// ---------- LOBBY UI FUNCTIONS ----------

export function updateLobbyUI(roomData = state.networkRoomData) {
    if (!lobbyArea || lobbyArea.classList.contains('hidden')) return;

    if (lobbyRoomIdDisplay) {
        const roomIdSpan = lobbyRoomIdDisplay.querySelector('span');
        if (roomIdSpan) roomIdSpan.textContent = roomData.roomId ? `${state.CAJITAS_PEER_ID_PREFIX}${roomData.roomId}` : 'N/A';
    }
    if (lobbyBoardSize) lobbyBoardSize.textContent = `${roomData.gameSettings.rows}x${roomData.gameSettings.cols}`;
    if (lobbyPlayerCount) lobbyPlayerCount.textContent = `${roomData.players.length}/${roomData.maxPlayers}`;

    if (lobbyPlayerList) {
        lobbyPlayerList.innerHTML = ''; // Clear existing player cards
        roomData.players.forEach(player => {
            const card = document.createElement('div');
            card.className = 'player-lobby-card flex items-center justify-between p-3 bg-white rounded-lg shadow transition-all duration-300 ease-in-out';
            card.style.borderLeft = `5px solid ${player.color || state.DEFAULT_PLAYER_COLORS[0]}`;
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
            nameSpan.textContent = player.name || `Jugador ${player.id + 1}`;
            if (player.peerId === roomData.leaderPeerId) {
                nameSpan.textContent += ' 👑 (Líder)';
            }
            if (player.peerId === state.myPeerId) {
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

    if (lobbyToggleReadyBtn) {
        const myPlayerData = roomData.players.find(p => p.peerId === state.myPeerId);
        if (myPlayerData) {
            lobbyToggleReadyBtn.textContent = myPlayerData.isReady ? 'Marcar como NO Listo ❌' : 'Marcar como Listo 👍';
            lobbyToggleReadyBtn.classList.toggle('bg-red-500', myPlayerData.isReady); // Example for "not ready" state
            lobbyToggleReadyBtn.classList.toggle('hover:bg-red-600', myPlayerData.isReady);
            lobbyToggleReadyBtn.classList.toggle('btn-secondary', !myPlayerData.isReady); // Default "ready" state

        }
        lobbyToggleReadyBtn.disabled = roomData.roomState === 'in_game';
    }

    if (lobbyStartGameLeaderBtn) {
        const allConnectedAndReady = roomData.players.length >= state.MIN_PLAYERS_NETWORK &&
                                   roomData.players.every(p => p.isReady && p.isConnected);
        lobbyStartGameLeaderBtn.style.display = roomData.isRoomLeader && roomData.roomState !== 'in_game' ? 'block' : 'none';
        lobbyStartGameLeaderBtn.disabled = !allConnectedAndReady;
        lobbyStartGameLeaderBtn.title = !allConnectedAndReady ? `Se necesitan ${state.MIN_PLAYERS_NETWORK}-${roomData.maxPlayers} jugadores listos.` : 'Iniciar el juego para todos';
    }
    
    // You might want to update lobbyMessageArea based on roomState or specific events
    // Example: if (roomData.roomState === 'ready_check') updateLobbyMessage("¡Todos listos! El líder puede iniciar el juego.");
}

export function updateLobbyMessage(message, isError = false) {
    if (!lobbyMessageArea) return;
    lobbyMessageArea.textContent = message;
    lobbyMessageArea.style.color = isError ? 'red' : '#D946EF'; // A vibrant pink/purple
}


// ---------- GENERAL UI UPDATE FUNCTIONS ----------

export function updatePlayerTurnDisplay() {
    if (!playerTurnDisplay) return;
    if (!state.gameActive || !state.playersData || state.playersData.length === 0) {
        playerTurnDisplay.innerHTML = '';
        return;
    }
    const currentPlayer = state.playersData[state.currentPlayerIndex];
    if (!currentPlayer) {
        playerTurnDisplay.innerHTML = 'Turno de: Error';
        return;
    }
    let turnText = `Turno de ${currentPlayer.name} ${currentPlayer.icon}`;

    if (state.pvpRemoteActive) {
        const myPlayerInRoom = state.networkRoomData.players.find(p => p.id === state.networkRoomData.myPlayerIdInRoom);
        const isMyTurn = state.networkRoomData.myPlayerIdInRoom === state.currentPlayerIndex;

        if (myPlayerInRoom) {
            turnText = isMyTurn ?
                `¡Tu turno, ${currentPlayer.name} ${currentPlayer.icon}!` :
                `Esperando a ${currentPlayer.name} ${currentPlayer.icon}...`;
        } else {
            turnText = `Turno de ${currentPlayer.name} ${currentPlayer.icon} (Observando)`;
        }
    }
    playerTurnDisplay.innerHTML = `${turnText} <span style="color:${currentPlayer.color}; font-size: 1.5em;">●</span>`;
}

export function updateScoresDisplay() {
    if (!scoresDisplay) return;
    scoresDisplay.innerHTML = '';

    // In network games, state.playersData should be authoritative once the game starts.
    // It's populated from networkRoomData.players by the leader.
    const playersToDisplay = state.playersData;

    if (!playersToDisplay || playersToDisplay.length === 0) return;

    playersToDisplay.forEach((player) => {
        if (!player || typeof player.color !== 'string' || player.color.length < 3) { // Min length for hex
             console.warn("updateScoresDisplay: Invalid player data or color", player);
             return;
        }
        const scoreDiv = document.createElement('div');
        scoreDiv.classList.add('p-2', 'rounded-lg', 'shadow-md', 'text-sm', 'md:text-base');
        try {
            // Basic check for hex color
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
        scoreDiv.style.color = player.color; // Text color is the player's solid color
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
            if (messageArea.textContent === message) { // Clear only if it hasn't been replaced
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
    modalDynamicButtons.innerHTML = ''; // Clear dynamic buttons
    modalDynamicButtons.style.display = 'none';
}

export function hideModalMessage() {
    if (!customModal || !modalCloseBtn || !modalDynamicButtons) return;
    customModal.style.display = "none";
    modalCloseBtn.style.display = 'inline-block'; // Ensure it's visible for next simple modal
    modalDynamicButtons.style.display = 'none';
}

export function showModalMessageWithActions(message, actions) {
    if (!customModal || !modalMessageText || !modalCloseBtn || !modalDynamicButtons) return;
    modalMessageText.textContent = message;
    modalCloseBtn.style.display = 'none'; // Hide default close button

    modalDynamicButtons.innerHTML = ''; // Clear previous buttons
    actions.forEach(actionInfo => {
        const button = document.createElement('button');
        button.textContent = actionInfo.text;
        // Tailwind classes for styling, adjust as needed
        button.className = 'bg-pink-500 hover:bg-pink-600 text-white font-semibold py-2 px-4 rounded-lg shadow-md transition-colors';
        if (actionInfo.isConfirm) { // Example: more prominent confirm button
             button.classList.replace('bg-pink-500', 'bg-green-500');
             button.classList.replace('hover:bg-pink-600', 'hover:bg-green-600');
        }
         if (actionInfo.isCancel) { // Example: different style for cancel
             button.classList.replace('bg-pink-500', 'bg-gray-400');
             button.classList.replace('hover:bg-pink-600', 'hover:bg-gray-500');
        }
        button.onclick = () => {
            actionInfo.action();
            // Optionally hide modal automatically, or let action decide
            // hideModalMessage();
        };
        modalDynamicButtons.appendChild(button);
    });
    modalDynamicButtons.style.display = 'flex'; // Make sure the container is visible
    customModal.style.display = "block";
}

export function generatePlayerSetupFields(count, forNetwork = false) {
    if (!playerCustomizationArea) return;
    playerCustomizationArea.innerHTML = '';

    const maxCustomize = forNetwork ? 1 : count; // For network, only customize self (P0 initially)

    for (let i = 0; i < maxCustomize; i++) {
        const card = document.createElement('div');
        card.className = 'player-setup-card';
        card.style.borderColor = state.DEFAULT_PLAYER_COLORS[i % state.DEFAULT_PLAYER_COLORS.length];

        const nameLabel = document.createElement('label');
        nameLabel.htmlFor = `player-name-${i}`;
        nameLabel.textContent = forNetwork ? `Tu Nombre:` : `Nombre Jugador/a ${i + 1}:`;
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.id = `player-name-${i}`;
        nameInput.value = forNetwork ? `Jugador ${state.myPeerId ? state.myPeerId.slice(-4) : (i+1)}` : `Jugador/a ${i + 1}`;
        nameInput.maxLength = 15;


        const iconLabel = document.createElement('label');
        iconLabel.htmlFor = `player-icon-${i}`;
        iconLabel.textContent = `Tu Ícono:`;
        const iconSelect = document.createElement('select');
        iconSelect.id = `player-icon-${i}`;
        state.AVAILABLE_ICONS.forEach(icon => {
            const option = document.createElement('option');
            option.value = icon;
            option.textContent = icon;
            iconSelect.appendChild(option);
        });
        iconSelect.value = state.AVAILABLE_ICONS[Math.floor(Math.random() * state.AVAILABLE_ICONS.length)]; // Random default for network player

        const colorLabel = document.createElement('label');
        colorLabel.htmlFor = `player-color-${i}`;
        colorLabel.textContent = `Tu Color:`;
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.id = `player-color-${i}`;
        colorInput.value = state.DEFAULT_PLAYER_COLORS[i % state.DEFAULT_PLAYER_COLORS.length];
        colorInput.addEventListener('input', (e) => {
            card.style.borderColor = e.target.value;
        });

        card.append(nameLabel, nameInput, iconLabel, iconSelect, colorLabel, colorInput);
        playerCustomizationArea.appendChild(card);
    }
    if (forNetwork && count > 1) {
        const infoText = document.createElement('p');
        infoText.className = 'text-sm text-gray-600 mt-2';
        infoText.textContent = `Personalizarás tus datos. Los demás jugadores (${count-1}) se unirán en la sala.`;
        playerCustomizationArea.appendChild(infoText);
    }
}

// ---------- SVG BOARD DRAWING FUNCTIONS ----------
export function drawBoardSVG() {
    // ... (keep existing drawBoardSVG content, ensure it uses state.numRows, state.numCols etc.)
    // This function seems okay as is, assuming state.numRows/cols are set correctly before calling.
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

export function drawVisualLineOnBoard(type, r_val, c_val, playerIdx) {
    // ... (keep existing drawVisualLineOnBoard content)
    // This function seems okay as is, assuming state.playersData is correctly populated for the game.
    const drawnLinesGroup = document.getElementById('drawn-lines-group');
    if (!drawnLinesGroup) return null;

    const playerData = (state.playersData && state.playersData[playerIdx]) || { color: '#888888' };
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

export function fillBoxOnBoard(br, bc, playerIdx) {
    // ... (keep existing fillBoxOnBoard content)
    // This function seems okay as is.
    const filledBoxesGroup = document.getElementById('filled-boxes-group');
    if(!filledBoxesGroup) return null;

    const playerData = (state.playersData && state.playersData[playerIdx]) || { color: '#888888', icon: '?', name: '??' };
    const boxRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    const rectX = state.SVG_PADDING + bc * state.CELL_SIZE + state.LINE_THICKNESS / 2;
    const rectY = state.SVG_PADDING + br * state.CELL_SIZE + state.LINE_THICKNESS / 2;
    const rectWidth = state.CELL_SIZE - state.LINE_THICKNESS; const rectHeight = state.CELL_SIZE - state.LINE_THICKNESS;
    boxRect.setAttribute('id', `box-${br}-${bc}`);
    boxRect.setAttribute('x', rectX.toString()); boxRect.setAttribute('y', rectY.toString());
    boxRect.setAttribute('width', rectWidth.toString()); boxRect.setAttribute('height', rectHeight.toString());
    let r_color = parseInt(playerData.color.slice(1, 3), 16);
    let g_color = parseInt(playerData.color.slice(3, 5), 16);
    let b_color = parseInt(playerData.color.slice(5, 7), 16);
    boxRect.setAttribute('fill', `rgba(${r_color},${g_color},${b_color},0.5)`);
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
    boxText.textContent = `${namePart}${playerData.icon}`;
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
    // ... (keep existing clearBoardForNewGame content)
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
    // ... (keep existing content)
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
    // ... (keep existing content)
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
export function displayQRCode(gameLink, displayId, message = "Compartí este enlace o ID para que se unan a tu sala:") {
    if (!networkInfoArea || !qrCodeContainer || !copyGameIdButton || !networkInfoTitle || !networkInfoText) {
        console.error("[UI] QR Code or Network Info Area elements not found!");
        showModalMessage(`ID de Sala: ${displayId}. Enlace: ${gameLink}. (Error UI QR)`);
        return;
    }
    if (!window.QRious) {
        console.warn('[UI] QRious library not loaded.');
        showModalMessage(`ID de Sala: ${displayId}. Enlace: ${gameLink}. (Error QR Lib)`);
        networkInfoText.textContent = `ID: ${displayId}. Link: ${gameLink}`;
        return;
    }

    networkInfoArea.classList.remove('hidden');
    networkInfoTitle.textContent = "¡Sala Creada!";
    networkInfoText.textContent = `${message} ID: ${displayId}`;


    qrCodeContainer.innerHTML = ''; // Clear previous QR
    const canvas = document.createElement('canvas');
    try {
        new QRious({
            element: canvas,
            value: gameLink,
            size: 160, padding: 8, level: 'H',
            foreground: '#A020F0', background: '#FFF8FB' // Purple theme
        });
        qrCodeContainer.appendChild(canvas);
    } catch(e) {
        console.error("[UI] Error generating QR code:", e);
        qrCodeContainer.textContent = "Error QR.";
        networkInfoText.textContent += " (Error al generar QR)";
        showModalMessage(`Error al generar QR. ID: ${displayId}. Link: ${gameLink}`);
        return;
    }

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

export function hideQRCode() {
    if (networkInfoArea) networkInfoArea.classList.add('hidden');
    if (qrCodeContainer) qrCodeContainer.innerHTML = '';
}

export function updateGameModeUI() {
    // This function now primarily controls visibility of setup vs lobby vs game
    // and enables/disables form inputs.
    // Actual display of QR or matchmaking messages might be handled more specifically.

    const inSetup = setupSection && !setupSection.classList.contains('hidden');
    const inLobby = lobbyArea && !lobbyArea.classList.contains('hidden');
    // const inGame = gameArea && !gameArea.classList.contains('hidden'); // Not needed directly for this logic

    // Disable setup inputs if in lobby or if a network game is active (even if momentarily on game screen before full init)
    const disableSetup = inLobby || state.pvpRemoteActive;

    if(rowsInput) rowsInput.disabled = disableSetup;
    if(colsInput) colsInput.disabled = disableSetup;
    if(numPlayersInput) numPlayersInput.disabled = disableSetup; // Local player count
    if(networkMaxPlayersSelect) networkMaxPlayersSelect.disabled = disableSetup; // Network max player count

    playerCustomizationArea?.querySelectorAll('input, select').forEach(el => {
        if(el) el.disabled = disableSetup;
    });
    
    // Start game button for local games
    if (startGameBtn) startGameBtn.style.display = state.pvpRemoteActive ? 'none' : 'block';

    // Network hosting/joining buttons
    if (hostGameButton) hostGameButton.style.display = state.pvpRemoteActive ? 'none' : 'inline-block';
    if (playRandomButton) playRandomButton.style.display = state.pvpRemoteActive ? 'none' : 'inline-block';


    // Cancel matchmaking button visibility
    if (cancelMatchmakingButton) {
        // Show if pvpRemoteActive (meaning a network process started),
        // AND not yet in a lobby (roomState not 'lobby' or 'in_game' etc.),
        // AND not yet successfully paired/connected (e.g. room.gamePaired is false or similar)
        // This needs to be refined based on actual matchmaking flow.
        // For now, a simple check: if "Play Random" was clicked and we are not in a lobby yet.
        const isMatchmaking = state.pvpRemoteActive &&
                              state.networkRoomData.roomState === 'seeking_match' || // A new state for matchmaking
                             (state.networkRoomData.roomState === 'idle' && playRandomButton.style.display === 'none' && !state.networkRoomData.roomId);

        cancelMatchmakingButton.style.display = isMatchmaking ? 'inline-block' : 'none';
        if (isMatchmaking && networkInfoArea && networkInfoText) {
            networkInfoArea.classList.remove('hidden');
            networkInfoTitle.textContent = "Buscando Partida...";
            networkInfoText.textContent = "Intentando encontrar oponentes al azar...";
            qrCodeContainer.innerHTML = ''; // No QR for random matchmaking search
        } else if (!isMatchmaking && networkInfoArea && networkInfoTitle.textContent === "Buscando Partida...") {
            // If matchmaking was cancelled or finished, hide this specific message.
            // Other functions (like displayQRCode or updateLobbyUI) will manage networkInfoArea if needed.
            if (!state.networkRoomData.roomId) hideQRCode(); // Only hide if not in a room yet
        }
    }

    if (undoBtn) undoBtn.disabled = state.pvpRemoteActive || !state.lastMoveForUndo;
}


// Initial call to set up player fields for local game as default
document.addEventListener('DOMContentLoaded', () => {
    if(numPlayersInput && playerCustomizationArea && !state.pvpRemoteActive) {
        generatePlayerSetupFields(parseInt(numPlayersInput.value || "2"));
    }
    updateGameModeUI(); // Initial UI state
});