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
export const numPlayersInput = document.getElementById('num-players-input');
export const playerCustomizationArea = document.getElementById('player-customization-area');

export const playerTurnDisplay = document.getElementById('player-turn');
export const scoresDisplay = document.getElementById('scores');
export const gameBoardSVG = document.getElementById('game-board-svg');
export const messageArea = document.getElementById('message-area');

export const customModal = document.getElementById('custom-modal');
export const modalMessageText = document.getElementById('modal-message-text');
export const modalCloseBtn = document.getElementById('modal-close-btn');

export const hostGameButton = document.getElementById('host-cajitas-btn');
// export const joinGameButton = document.getElementById('join-cajitas-btn'); // REMOVED
export const playRandomButton = document.getElementById('play-random-cajitas-btn');

export const qrCodeContainer = document.getElementById('qr-code-container');
// export const gameIdDisplay = document.getElementById('game-id-display'); // REMOVED
export const copyGameIdButton = document.getElementById('copy-game-id-btn');
export const cancelMatchmakingButton = document.getElementById('cancel-matchmaking-btn');


// ---------- UI UPDATE FUNCTIONS ----------

export function showSetupScreen() {
    if (setupSection) setupSection.classList.remove('hidden');
    if (gameArea) gameArea.classList.add('hidden');
    if (mainTitle) mainTitle.textContent = "Cajitas de Dani";
    hideQRCode();
}

export function showGameScreen() {
    if (setupSection) setupSection.classList.add('hidden');
    if (gameArea) gameArea.classList.remove('hidden');
    if (mainTitle) mainTitle.textContent = "¡A Jugar!";
    hideQRCode();
}

export function updatePlayerTurnDisplay() {
    if (!playerTurnDisplay) return;
    if (!state.gameActive || !state.playersData || state.playersData.length === 0 || !state.playersData[state.currentPlayerIndex]) {
        playerTurnDisplay.innerHTML = '';
        return;
    }
    const currentPlayer = state.playersData[state.currentPlayerIndex];
    if (!currentPlayer) {
        playerTurnDisplay.innerHTML = '';
        return;
    }
    let turnText = `Turno de ${currentPlayer.name} ${currentPlayer.icon}`;

    if (state.pvpRemoteActive) {
        turnText = state.isMyTurnInRemote ?
            `¡Tu turno, ${currentPlayer.name} ${currentPlayer.icon}!` :
            `Esperando a ${currentPlayer.name} ${currentPlayer.icon}...`;
    }
    playerTurnDisplay.innerHTML = `${turnText} <span style="color:${currentPlayer.color}; font-size: 1.5em;">●</span>`;
}

export function updateScoresDisplay() {
    if (!scoresDisplay) return;
    scoresDisplay.innerHTML = '';
    const playersToDisplay = (state.pvpRemoteActive && state.remotePlayersData && state.remotePlayersData.length > 0) ? state.remotePlayersData : state.playersData;

    if (!playersToDisplay) return;

    playersToDisplay.forEach((player) => {
        if (!player || typeof player.color !== 'string' || player.color.length < 7) {
             console.warn("updateScoresDisplay: Invalid player data or color", player);
             return;
        }
        const scoreDiv = document.createElement('div');
        scoreDiv.classList.add('p-2', 'rounded-lg', 'shadow-md', 'text-sm', 'md:text-base');
        try {
            let r_col = parseInt(player.color.slice(1, 3), 16);
            let g_col = parseInt(player.color.slice(3, 5), 16);
            let b_col = parseInt(player.color.slice(5, 7), 16);
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

export function updateMessageArea(message, isError = false) {
    if (!messageArea) return;
    messageArea.textContent = message;
    messageArea.style.color = isError ? 'red' : '#FF69B4';
    if (message && !isError) {
        setTimeout(() => {
            if (messageArea.textContent === message) {
                messageArea.textContent = '';
            }
        }, 3000);
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
    if (!customModal || !modalMessageText || !modalCloseBtn) return;
    modalMessageText.textContent = message;
    customModal.style.display = "block";
    modalCloseBtn.innerHTML = "¡Dale!";
    modalCloseBtn.style.display = 'inline-block';
    modalCloseBtn.onclick = () => hideModalMessage();
    const dynamicButtonsContainer = document.getElementById('modal-dynamic-buttons');
    if (dynamicButtonsContainer) {
        dynamicButtonsContainer.innerHTML = '';
    }
}

export function hideModalMessage() {
    if (!customModal || !modalCloseBtn) return;
    customModal.style.display = "none";
    modalCloseBtn.style.display = 'inline-block';
}

export function showModalMessageWithActions(message, actions) {
    if (!customModal || !modalMessageText || !modalCloseBtn) return;
    modalMessageText.textContent = message;
    modalCloseBtn.style.display = 'none';

    let dynamicButtonsContainer = document.getElementById('modal-dynamic-buttons');
    if (!dynamicButtonsContainer && modalMessageText.parentNode) {
        dynamicButtonsContainer = document.createElement('div');
        dynamicButtonsContainer.id = 'modal-dynamic-buttons';
        dynamicButtonsContainer.className = 'mt-4 flex justify-center space-x-4';
        modalMessageText.parentNode.appendChild(dynamicButtonsContainer);
    }
    if (dynamicButtonsContainer) dynamicButtonsContainer.innerHTML = '';

    actions.forEach(actionInfo => {
        const button = document.createElement('button');
        button.textContent = actionInfo.text;
        button.className = 'bg-pink-500 hover:bg-pink-600 text-white font-semibold py-2 px-4 rounded-lg shadow-md';
        button.onclick = () => {
            actionInfo.action();
        };
        dynamicButtonsContainer?.appendChild(button);
    });
    customModal.style.display = "block";
}

export function generatePlayerSetupFields(count) {
    if (!playerCustomizationArea) return;
    playerCustomizationArea.innerHTML = '';
    for (let i = 0; i < count; i++) {
        const card = document.createElement('div');
        card.className = 'player-setup-card';
        card.style.borderColor = state.DEFAULT_PLAYER_COLORS[i % state.DEFAULT_PLAYER_COLORS.length];

        const nameLabel = document.createElement('label');
        nameLabel.htmlFor = `player-name-${i}`;
        nameLabel.textContent = `Nombre Jugador/a ${i + 1}:`;
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.id = `player-name-${i}`;
        nameInput.value = `Jugador/a ${i + 1}`;

        const iconLabel = document.createElement('label');
        iconLabel.htmlFor = `player-icon-${i}`;
        iconLabel.textContent = `Ícono:`;
        const iconSelect = document.createElement('select');
        iconSelect.id = `player-icon-${i}`;
        state.AVAILABLE_ICONS.forEach(icon => {
            const option = document.createElement('option');
            option.value = icon;
            option.textContent = icon;
            iconSelect.appendChild(option);
        });
        iconSelect.value = state.AVAILABLE_ICONS[i % state.AVAILABLE_ICONS.length];

        const colorLabel = document.createElement('label');
        colorLabel.htmlFor = `player-color-${i}`;
        colorLabel.textContent = `Color:`;
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

export function drawVisualLineOnBoard(type, r_val, c_val, playerIdx) {
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
    const namePart = playerData.name.length > 0 ? playerData.name.substring(0, 1).toUpperCase() + "." : "";
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

// ---------- NETWORK UI FUNCTIONS ----------
export function displayQRCode(gameLink, displayId) {
    console.log("[UI] displayQRCode called with gameLink:", gameLink, "displayId:", displayId);
    const networkInfoDiv = document.getElementById('network-info-area');

    if (!qrCodeContainer) { // This is the direct container for the canvas
        console.error("[UI] qrCodeContainer element (for canvas) not found!");
        showModalMessage(`ID del Juego: ${displayId}. Compartilo para que alguien se una. (Error: Contenedor QR no encontrado)`);
        return;
    }
    if (!window.QRious) {
        console.warn('[UI] QRious library not loaded.');
        showModalMessage(`ID del Juego: ${displayId}. Compartilo para que alguien se una. (Error: Librería QR no cargada)`);
        return;
    }

    // Make the parent 'network-info-area' visible
    if (networkInfoDiv) {
        console.log("[UI] Making networkInfoDiv visible.");
        networkInfoDiv.classList.remove('hidden');
    } else {
        console.warn("[UI] 'network-info-area' div (parent for QR) not found. QR code might not be styled/positioned correctly.");
        // If the main container is missing, we might still try to show QR in modal or just the link
        // For now, we assume qrCodeContainer itself is where it should go.
    }

    qrCodeContainer.innerHTML = ''; // Clear previous QR
    const canvas = document.createElement('canvas');
    try {
        new QRious({
            element: canvas,
            value: gameLink,
            size: 160,
            padding: 8,
            level: 'H',
            foreground: '#FF1493',
            background: '#FFF8FB'
        });
        qrCodeContainer.appendChild(canvas);
        console.log("[UI] QR code generated and appended to qrCodeContainer.");
    } catch(e) {
        console.error("[UI] Error generating QR code with QRious:", e);
        if(qrCodeContainer) qrCodeContainer.textContent = "Error al generar QR."; // Check qrCodeContainer exists
        showModalMessage(`Error al generar QR. ID: ${displayId}. Link: ${gameLink}`);
        return;
    }

    // No longer using gameIdDisplay for plain text ID here
    // if(gameIdDisplay) gameIdDisplay.textContent = `ID para compartir: ${displayId}`;

    if(copyGameIdButton) {
        copyGameIdButton.textContent = "Copiar Enlace del Juego";
        copyGameIdButton.onclick = () => {
            navigator.clipboard.writeText(gameLink)
                .then(() => updateMessageArea('¡Enlace del juego copiado!'))
                .catch(err => {
                    console.error('[UI] Error copying game link to clipboard:', err);
                    updateMessageArea('Error al copiar enlace.', true);
                });
        };
    }
}

export function hideQRCode() {
    console.log("[UI] hideQRCode called.");
    const networkInfoDiv = document.getElementById('network-info-area');
    if (networkInfoDiv) {
        networkInfoDiv.classList.add('hidden');
        console.log("[UI] networkInfoDiv hidden.");
    }
    if (qrCodeContainer) qrCodeContainer.innerHTML = ''; // Clear the QR canvas
    // if (gameIdDisplay) gameIdDisplay.textContent = ''; // No longer used
}

export function updateGameModeUI() {
    console.log("[UI] updateGameModeUI called. PvP Active:", state.pvpRemoteActive, "Paired:", state.gamePaired, "Am P1:", state.iAmPlayer1InRemote, "Host ID:", state.currentHostPeerId);
    const networkInfoDiv = document.getElementById('network-info-area');

    const isActuallyHostingOrJoining = state.pvpRemoteActive;

    if (hostGameButton) hostGameButton.style.display = isActuallyHostingOrJoining ? 'none' : 'inline-block';
    // joinGameButton is removed, playRandomButton takes its place if needed or is separate
    if (playRandomButton) playRandomButton.style.display = isActuallyHostingOrJoining ? 'none' : 'inline-block';


    if (cancelMatchmakingButton) {
        const isActivelyMatchmaking = state.pvpRemoteActive &&
                                   !state.gamePaired &&
                                   !state.currentHostPeerId && // Not in a direct hosting/joining state (ID would be set)
                                   (playRandomButton?.style.display === 'none'); // If play random was clicked
        cancelMatchmakingButton.style.display = isActivelyMatchmaking ? 'inline-block' : 'none';
    }

    const disableSetupInputs = state.pvpRemoteActive;
    if(rowsInput) rowsInput.disabled = disableSetupInputs;
    if(colsInput) colsInput.disabled = disableSetupInputs;
    if(numPlayersInput) {
        numPlayersInput.disabled = disableSetupInputs;
        if(disableSetupInputs && parseInt(numPlayersInput.value) !== 2) {
             numPlayersInput.value = "2";
             generatePlayerSetupFields(2);
        }
    }
    playerCustomizationArea?.querySelectorAll('input, select').forEach(el => { if(el) el.disabled = disableSetupInputs; });

    const hostIsActivelyWaitingWithId = state.pvpRemoteActive && !state.gamePaired && state.iAmPlayer1InRemote && state.currentHostPeerId;

    if (hostIsActivelyWaitingWithId) {
        // This state is primarily when displayQRCode should have been called.
        // If networkInfoDiv is somehow hidden, displayQRCode should reveal it.
        // We ensure the message reflects waiting state.
        if (networkInfoDiv && networkInfoDiv.classList.contains('hidden')) {
             // This implies displayQRCode might not have run or an issue occurred.
             // For now, we let displayQRCode handle unhiding.
            console.warn("[UI] Host is waiting with ID, but networkInfoDiv is hidden. displayQRCode should manage this.");
        }
        updateMessageArea(`Compartí el enlace o ID: ${state.CAJITAS_PEER_ID_PREFIX}${state.currentHostPeerId}`);
    } else if (networkInfoDiv && !networkInfoDiv.classList.contains('hidden')) {
        // If NOT in the "host waiting with ID" state, but the div IS visible, hide it.
        hideQRCode();
    }


    // Update general messages based on other states for clarity
    if (state.pvpRemoteActive && !state.gamePaired) {
        if (!state.iAmPlayer1InRemote && state.currentHostPeerId) {
            updateMessageArea(`Intentando conectar a ${state.currentHostPeerId}...`);
        } else if (state.iAmPlayer1InRemote && !state.currentHostPeerId && !cancelMatchmakingButton?.style.display !== 'none') { // Host, before PeerID assigned AND not matchmaking
            updateMessageArea("Estableciendo conexión como Host...");
        }
        // Matchmaking searching message is handled by matchmaking callbacks
    } else if (state.pvpRemoteActive && state.gamePaired) {
        // Game is paired. Player turn display will show current status.
    } else if (!state.gameActive) {
         updateMessageArea("Configurá la partida y dale a Empezar!");
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if(numPlayersInput && playerCustomizationArea) {
        generatePlayerSetupFields(parseInt(numPlayersInput.value));
    }
});