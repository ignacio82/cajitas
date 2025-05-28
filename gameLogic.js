// gameLogic.js - FIXED VERSION

import * as state from './state.js';
import * as ui from './ui.js';
import * as peerConnection from './peerConnection.js';
// import * as sound from './sound.js'; // Import if game logic directly triggers sounds

/**
 * Initializes the game. Sets up the board, players, and initial state.
 * @param {boolean} isRemoteGame - True if this is a network game being initialized.
 */
export function initializeGame(isRemoteGame = false) {
    console.log("Initializing game. Remote:", isRemoteGame);
    if (!isRemoteGame) { // For local games, read from UI inputs
        state.setGameDimensions(parseInt(ui.rowsInput.value), parseInt(ui.colsInput.value));
        state.setNumPlayers(parseInt(ui.numPlayersInput.value));

        const players = [];
        for (let i = 0; i < state.numPlayers; i++) {
            const name = document.getElementById(`player-name-${i}`).value || `Jugador/a ${i + 1}`;
            const icon = document.getElementById(`player-icon-${i}`).value;
            const color = document.getElementById(`player-color-${i}`).value;
            players.push({ id: i, name, icon, color, score: 0 });
        }
        state.setPlayersData(players);
    } else {
        // For remote games, playersData should have been set by peerConnection.js
        // based on exchanged info. We just ensure scores are 0.
        state.playersData.forEach(p => p.score = 0);
        state.setRemotePlayersData([...state.playersData]); // Sync remotePlayersData if it's used
    }

    state.resetGameFlowState(); // Resets board, scores, turn counter etc.
    state.setGameActive(true);
    state.setCurrentPlayerIndex(0); // Player 0 starts by default

    ui.drawBoardSVG(); // Draws dots and line slots
    addSlotListeners(); // Add click listeners to the newly drawn slots

    ui.updateScoresDisplay();
    ui.updatePlayerTurnDisplay();
    ui.updateMessageArea('');
    ui.showGameScreen();
    ui.setBoardClickable(state.pvpRemoteActive ? state.isMyTurnInRemote : true);
    if (ui.undoBtn) ui.undoBtn.disabled = true;

    // if (state.soundEnabled && sound.gameStartSound) sound.playSound(sound.gameStartSound);
    console.log("Game initialized. Current player:", state.currentPlayerIndex);
}

/**
 * Resets the game to the setup screen or restarts with current settings.
 * @param {boolean} backToSetup - If true, goes back to the setup screen.
 */
export function resetGame(backToSetup = true) {
    console.log("Resetting game. Back to setup:", backToSetup);
    state.setGameActive(false);
    ui.clearBoardForNewGame();

    if (state.pvpRemoteActive && state.gamePaired && !backToSetup) {
        // If it's a paired remote game and not going fully back to setup (e.g. restart request)
        peerConnection.sendPeerData({ type: 'restart_request', playerName: state.playersData[state.myPlayerIdInRemoteGame]?.name });
        ui.showModalMessage("Solicitud de reinicio enviada..."); // Translated
        // Game will fully re-initialize if opponent accepts
    } else if (backToSetup) {
        ui.showSetupScreen();
        state.resetNetworkState(); // Full reset if going to setup
        ui.updateGameModeUI();
    } else { // Local game restart with same settings
        initializeGame();
    }
    // if (state.soundEnabled && sound.resetSound) sound.playSound(sound.resetSound);
}

/**
 * Adds click listeners to all line slots on the board.
 */
function addSlotListeners() {
    const slots = ui.gameBoardSVG.querySelectorAll('.line-slot');
    slots.forEach(slot => {
        slot.addEventListener('click', handleLineClickWrapper);
    });
}

/**
 * Wrapper for handling line clicks to manage turn logic for local and remote games.
 * @param {Event} event - The click event.
 */
function handleLineClickWrapper(event) {
    if (!state.gameActive) return;
    if (state.pvpRemoteActive && !state.isMyTurnInRemote) {
        ui.updateMessageArea("¡Ey! No es tu turno.", true); // Translated
        return;
    }

    const targetSlot = event.currentTarget;
    const type = targetSlot.dataset.type;
    const r = parseInt(targetSlot.dataset.r);
    const c = parseInt(targetSlot.dataset.c);

    // Check if line is already drawn (though listener should be removed)
    const lineDrawn = (type === 'h' && state.horizontalLines[r]?.[c]) || (type === 'v' && state.verticalLines[r]?.[c]);
    if (lineDrawn) {
        return; // Should not happen if listener is removed correctly
    }

    processMove(type, r, c, state.currentPlayerIndex);

    if (state.pvpRemoteActive) {
        state.incrementTurnCounter();
        const moveData = {
            type: 'game_move',
            move: { type, r, c, playerIndex: state.currentPlayerIndex },
            turnCounter: state.turnCounter
        };
        peerConnection.sendPeerData(moveData);
        // Turn switching for remote game will happen upon receiving data or after local processing + state check
    }
}

/**
 * Processes a move: draws the line, checks for boxes, updates scores, and manages turns.
 * @param {string} type - 'h' for horizontal, 'v' for vertical.
 * @param {number} r - Row index of the line.
 * @param {number} c - Column index of the line.
 * @param {number} playerIndex - The index of the player making the move.
 * @param {boolean} isRemoteSync - True if this move is being applied from a remote message.
 */
export function processMove(type, r, c, playerIndex, isRemoteSync = false) {
    if (!state.gameActive) return;

    console.log(`[GameLogic] processMove: ${type} at (${r},${c}) by player ${playerIndex}, remote: ${isRemoteSync}`);

    // Validate playerIndex if it's coming from remote
    if (isRemoteSync && playerIndex !== state.currentPlayerIndex) {
        console.warn(`Remote move for player ${playerIndex}, but current local player is ${state.currentPlayerIndex}. Syncing current player.`);
        state.setCurrentPlayerIndex(playerIndex);
    }

    // Mark the line in the state
    if (type === 'h') {
        if(state.horizontalLines[r]?.[c]) return; // Already drawn
        state.horizontalLines[r][c] = 1;
    } else {
        if(state.verticalLines[r]?.[c]) return; // Already drawn
        state.verticalLines[r][c] = 1;
    }

    // Draw the line visually
    const lineElement = ui.drawVisualLineOnBoard(type, r, c, playerIndex);
    // if (state.soundEnabled && sound.lineSound) sound.playSound(sound.lineSound, "C4", "32n");

    // Disable the clicked slot
    const slotId = `slot-${type}-${r}-${c}`;
    const slotElement = document.getElementById(slotId);
    if (slotElement) {
        slotElement.style.fill = 'transparent'; // Make it invisible
        slotElement.removeEventListener('click', handleLineClickWrapper);
    }

    // Store for potential local undo (if not a remote sync and game rules allow)
    if (!isRemoteSync && !state.pvpRemoteActive) {
        const boxesPotentiallyCompleted = getPotentiallyAffectedBoxes(type, r, c);
        const previousBoxStates = boxesPotentiallyCompleted.map(box => ({
            r: box.r, c: box.c, player: state.boxes[box.r][box.c]
        }));

        state.setLastMoveForUndo({
            type, r, c, playerIndex, lineElement, slotElement,
            boxesCompletedBeforeThisMove: previousBoxStates,
            scoreBeforeThisMove: state.playersData[playerIndex].score
        });
        if (ui.undoBtn) ui.undoBtn.disabled = false;
    }

    const boxesCompletedCount = checkForCompletedBoxes(type, r, c, playerIndex);
    console.log(`[GameLogic] Boxes completed: ${boxesCompletedCount}`);

    if (boxesCompletedCount > 0) {
        state.updatePlayerScore(playerIndex, boxesCompletedCount);
        state.incrementFilledBoxesCount(boxesCompletedCount);
        ui.updateScoresDisplay();
        // Player continues if they completed a box
        ui.updateMessageArea(`¡${state.playersData[playerIndex].name} hizo ${boxesCompletedCount} cajita(s)! ¡Seguís vos!`);
        // if (state.soundEnabled && sound.boxSound) { /* play multiple times */ }

        // For local play, completing a box means no "simple" undo for the line that completed it.
        // The turn continues for the same player.
        if (!state.pvpRemoteActive) {
            state.setLastMoveForUndo(null); // Cannot undo a scoring move's line simply
            if (ui.undoBtn) ui.undoBtn.disabled = true;
        }
    } else {
        // No box completed, switch player
        if (!isRemoteSync || (isRemoteSync && state.isMyTurnInRemote)) { // Only switch if it was our turn or local game
            endTurn();
        }
    }

    if (state.pvpRemoteActive && !isRemoteSync) {
        // If it was my turn and I made a move, it's no longer my turn (unless I scored)
        if (boxesCompletedCount === 0) { // I didn't score, so it's other player's turn
             state.setIsMyTurnInRemote(false);
        }
        // if I did score, it's still my turn (isMyTurnInRemote remains true)
        ui.setBoardClickable(state.isMyTurnInRemote);
        ui.updatePlayerTurnDisplay();
    }

    // FIXED: Check game over AFTER all processing is complete
    console.log(`[GameLogic] Checking game over: filledBoxes=${state.filledBoxesCount}, totalPossible=${state.totalPossibleBoxes}`);
    if (checkGameOver()) {
        console.log(`[GameLogic] Game over detected!`);
        announceWinner();
        state.setGameActive(false);
        if (ui.undoBtn) ui.undoBtn.disabled = true;
        state.setLastMoveForUndo(null);
    } else {
        console.log(`[GameLogic] Game continues...`);
    }
}

function getPotentiallyAffectedBoxes(lineType, lineR, lineC) {
    const affected = [];
    if (lineType === 'h') {
        // Box below the horizontal line
        if (lineR < state.numRows - 1) affected.push({ r: lineR, c: lineC });
        // Box above the horizontal line
        if (lineR > 0) affected.push({ r: lineR - 1, c: lineC });
    } else { // Vertical line
        // Box to the right of the vertical line
        if (lineC < state.numCols - 1) affected.push({ r: lineR, c: lineC });
        // Box to the left of the vertical line
        if (lineC > 0) affected.push({ r: lineR, c: lineC - 1 });
    }
    return affected.filter(b => b.r >= 0 && b.r < state.numRows -1 && b.c >=0 && b.c < state.numCols -1);
}

/**
 * Checks for completed boxes after a line is drawn.
 * @param {string} lineType - 'h' or 'v'.
 * @param {number} lineR - Row of the drawn line.
 * @param {number} lineC - Column of the drawn line.
 * @param {number} playerIndex - Player who drew the line.
 * @returns {number} - The number of boxes completed by this move.
 */
function checkForCompletedBoxes(lineType, lineR, lineC, playerIndex) {
    let boxesMadeThisTurn = 0;

    // Check box "below" a horizontal line or "to the right" of a vertical line
    if (lineType === 'h' && lineR < state.numRows - 1) { // Box below lineR, lineC
        if (state.boxes[lineR][lineC] === -1 &&
            state.horizontalLines[lineR + 1]?.[lineC] &&
            state.verticalLines[lineR]?.[lineC] &&
            state.verticalLines[lineR]?.[lineC + 1]) {
            ui.fillBoxOnBoard(lineR, lineC, playerIndex);
            state.boxes[lineR][lineC] = playerIndex;
            boxesMadeThisTurn++;
            console.log(`[GameLogic] Box completed at (${lineR}, ${lineC}) by player ${playerIndex}`);
        }
    } else if (lineType === 'v' && lineC < state.numCols - 1) { // Box to the right of lineR, lineC
        if (state.boxes[lineR][lineC] === -1 &&
            state.verticalLines[lineR]?.[lineC + 1] &&
            state.horizontalLines[lineR]?.[lineC] &&
            state.horizontalLines[lineR + 1]?.[lineC]) {
            ui.fillBoxOnBoard(lineR, lineC, playerIndex);
            state.boxes[lineR][lineC] = playerIndex;
            boxesMadeThisTurn++;
            console.log(`[GameLogic] Box completed at (${lineR}, ${lineC}) by player ${playerIndex}`);
        }
    }

    // Check box "above" a horizontal line or "to the left" of a vertical line
    if (lineType === 'h' && lineR > 0) { // Box above lineR, lineC (means it's box [lineR-1][lineC])
        if (state.boxes[lineR - 1][lineC] === -1 &&
            state.horizontalLines[lineR - 1]?.[lineC] &&
            state.verticalLines[lineR - 1]?.[lineC] &&
            state.verticalLines[lineR - 1]?.[lineC + 1]) {
            ui.fillBoxOnBoard(lineR - 1, lineC, playerIndex);
            state.boxes[lineR - 1][lineC] = playerIndex;
            boxesMadeThisTurn++;
            console.log(`[GameLogic] Box completed at (${lineR - 1}, ${lineC}) by player ${playerIndex}`);
        }
    } else if (lineType === 'v' && lineC > 0) { // Box to the left of lineR, lineC (means it's box [lineR][lineC-1])
        if (state.boxes[lineR][lineC - 1] === -1 &&
            state.verticalLines[lineR]?.[lineC - 1] &&
            state.horizontalLines[lineR]?.[lineC - 1] &&
            state.horizontalLines[lineR + 1]?.[lineC - 1]) {
            ui.fillBoxOnBoard(lineR, lineC - 1, playerIndex);
            state.boxes[lineR][lineC - 1] = playerIndex;
            boxesMadeThisTurn++;
            console.log(`[GameLogic] Box completed at (${lineR}, ${lineC - 1}) by player ${playerIndex}`);
        }
    }
    return boxesMadeThisTurn;
}

function endTurn() {
    if (!state.gameActive) return;

    state.setCurrentPlayerIndex((state.currentPlayerIndex + 1) % state.numPlayers);
    ui.updatePlayerTurnDisplay();

    if (!state.pvpRemoteActive) { // Local game
        state.setLastMoveForUndo(null);
        if (ui.undoBtn) ui.undoBtn.disabled = true;
        ui.updateMessageArea(''); // Clear any previous "continue your turn" message
    } else { // Remote game
        // isMyTurnInRemote is managed by processMove and applyRemoteMove
        // Turn display already updated
    }
     ui.setBoardClickable(state.pvpRemoteActive ? state.isMyTurnInRemote : true);
}

/**
 * Handles the undo action for local games.
 */
export function handleUndo() {
    if (!state.gameActive || state.pvpRemoteActive || !state.lastMoveForUndo) {
        if (ui.undoBtn) ui.undoBtn.disabled = true;
        return;
    }
    // if (state.soundEnabled && sound.undoSound) sound.playSound(sound.undoSound);

    const { type, r, c, playerIndex, lineElement, slotElement, boxesCompletedBeforeThisMove, scoreBeforeThisMove } = state.lastMoveForUndo;

    // Revert line state
    if (type === 'h') state.horizontalLines[r][c] = 0;
    else state.verticalLines[r][c] = 0;

    // Remove visual line
    if (lineElement && lineElement.parentNode) {
        lineElement.remove();
    }
    // Re-enable slot and re-add listener
    if (slotElement) {
        slotElement.style.fill = 'rgba(0,0,0,0.03)';
        slotElement.addEventListener('click', handleLineClickWrapper);
    }

    // Revert any boxes that were completed by this specific move
    if (boxesCompletedBeforeThisMove) {
        boxesCompletedBeforeThisMove.forEach(prevBoxState => {
            // If a box was -1 and is now owned by current player, revert it
            if (prevBoxState.player === -1 && state.boxes[prevBoxState.r][prevBoxState.c] === playerIndex) {
                state.boxes[prevBoxState.r][prevBoxState.c] = -1;
                ui.removeFilledBoxFromBoard(prevBoxState.r, prevBoxState.c);
                state.incrementFilledBoxesCount(-1); // Decrement
            }
        });
    }
    // Revert score
    state.playersData[playerIndex].score = scoreBeforeThisMove;

    ui.updateScoresDisplay();
    ui.updateMessageArea(`${state.playersData[playerIndex].name}, ¡hacé tu jugada de nuevo!`); // Translated
    state.setLastMoveForUndo(null);
    if (ui.undoBtn) ui.undoBtn.disabled = true;

    // The turn does not switch back; the current player gets to replay.
    state.setCurrentPlayerIndex(playerIndex); // Ensure it's still this player's logical turn
    ui.updatePlayerTurnDisplay();
    ui.setBoardClickable(true);
}

// FIXED: More robust game over check
function checkGameOver() {
    const gameOver = state.filledBoxesCount >= state.totalPossibleBoxes;
    console.log(`[GameLogic] checkGameOver: filledBoxes=${state.filledBoxesCount}, totalPossible=${state.totalPossibleBoxes}, gameOver=${gameOver}`);
    return gameOver;
}

function announceWinner() {
    let maxScore = -1;
    let winners = [];
    state.playersData.forEach((player) => {
        if (player.score > maxScore) {
            maxScore = player.score;
            winners = [player];
        } else if (player.score === maxScore) {
            winners.push(player);
        }
    });

    let winnerMessage;
    if (winners.length === 1) {
        winnerMessage = `¡${winners[0].name} ${winners[0].icon} ganó con ${maxScore} cajitas brillantes! ¡Bravo! 🥳`; // Translated
        // if (state.soundEnabled && sound.winSound) { /* play win notes */ }
    } else {
        const winnerNames = winners.map(p => `${p.name} ${p.icon}`).join(' y ');
        winnerMessage = `¡Hay un súper empate entre ${winnerNames} con ${maxScore} cajitas cada uno! ¡Muy bien jugado! 🎉`; // Translated
        // if (state.soundEnabled && sound.tieSound) { /* play tie notes */ }
    }
    ui.showModalMessage(`¡Juego Terminado! ${winnerMessage}`); // Translated
    ui.updateMessageArea('');
    if (ui.mainTitle) ui.mainTitle.textContent = "¿Jugar de Nuevo?"; // Translated
}

// ---------- NETWORK GAME LOGIC HANDLERS ----------

/**
 * Applies a move received from a remote player.
 * @param {object} moveData - The move data { type, r, c, playerIndex }.
 */
export function applyRemoteMove(moveData) {
    if (!state.pvpRemoteActive || !state.gameActive) return;
    console.log("Applying remote move:", moveData);

    const { type, r, c, playerIndex } = moveData;

    // It's now this player's turn locally because a move was made by them remotely.
    // However, processMove will handle the turn logic (who plays next).
    // We first ensure the currentPlayerIndex is set to who made the move.
    state.setCurrentPlayerIndex(playerIndex);
    ui.updatePlayerTurnDisplay(); // Reflects who just made the move

    processMove(type, r, c, playerIndex, true); // true indicates remote sync

    // After processing the move, determine if it's now the local client's turn
    state.setIsMyTurnInRemote(state.currentPlayerIndex === state.myPlayerIdInRemoteGame && state.gameActive);
    ui.setBoardClickable(state.isMyTurnInRemote);
    ui.updatePlayerTurnDisplay(); // Update again to reflect "Your turn" or "Waiting"
}

/**
 * Applies a full game state received from a remote player (e.g., for syncing).
 * @param {object} remoteGameState - The complete game state.
 */
export function applyFullState(remoteGameState) {
    if (!state.pvpRemoteActive) return;
    console.log("Applying full remote state:", remoteGameState);

    state.setGameDimensions(remoteGameState.numRows, remoteGameState.numCols);
    state.setNumPlayers(remoteGameState.numPlayers);

    // Important: Map remote player IDs to local player structure if necessary,
    // for now, assume player order is consistent (0 for host, 1 for joiner in P2P)
    state.setPlayersData(remoteGameState.playersData.map(p => ({...p}))); // Deep copy might be better
    state.setRemotePlayersData([...remoteGameState.playersData]);

    state.setHorizontalLines(remoteGameState.horizontalLines.map(row => [...row]));
    state.setVerticalLines(remoteGameState.verticalLines.map(row => [...row]));
    state.setBoxes(remoteGameState.boxes.map(row => [...row]));
    state.setFilledBoxesCount(remoteGameState.filledBoxesCount);
    state.setTurnCounter(remoteGameState.turnCounter);
    state.setCurrentPlayerIndex(remoteGameState.currentPlayerIndex);
    state.setGameActive(remoteGameState.gameActive);

    // Redraw the entire board based on the new state
    ui.clearBoardForNewGame(); // Clear existing visuals
    ui.drawBoardSVG();       // Redraw slots and dots
    addSlotListeners();      // Re-add listeners to new slots

    // Redraw all lines
    state.horizontalLines.forEach((row, r) => {
        row.forEach((val, c) => {
            if (val) {
                const linePlayer = findLineOwner(r,c,'h'); // Placeholder
                ui.drawVisualLineOnBoard('h', r, c, linePlayer !== -1 ? linePlayer : 0); // Default to P0 if unknown
                const slotElement = document.getElementById(`slot-h-${r}-${c}`);
                if(slotElement) {
                     slotElement.style.fill = 'transparent';
                     slotElement.removeEventListener('click', handleLineClickWrapper);
                }
            }
        });
    });
    state.verticalLines.forEach((row, r) => {
        row.forEach((val, c) => {
            if (val) {
                const linePlayer = findLineOwner(r,c,'v'); // Placeholder
                ui.drawVisualLineOnBoard('v', r, c, linePlayer !== -1 ? linePlayer : 0);
                const slotElement = document.getElementById(`slot-v-${r}-${c}`);
                 if(slotElement) {
                     slotElement.style.fill = 'transparent';
                     slotElement.removeEventListener('click', handleLineClickWrapper);
                 }
            }
        });
    });

    // Redraw all filled boxes
    state.boxes.forEach((row, r) => {
        row.forEach((playerIdx, c) => {
            if (playerIdx !== -1) {
                ui.fillBoxOnBoard(r, c, playerIdx);
            }
        });
    });

    state.setIsMyTurnInRemote(state.currentPlayerIndex === state.myPlayerIdInRemoteGame && state.gameActive);
    ui.setBoardClickable(state.isMyTurnInRemote);
    ui.updateScoresDisplay();
    ui.updatePlayerTurnDisplay();

    if (!state.gameActive && state.filledBoxesCount === state.totalPossibleBoxes) {
        announceWinner();
    }
}

// Placeholder: In a real scenario, you'd need a more robust way to know who drew each line
function findLineOwner(r, c, type) {
    // This is a simplified placeholder.
    // Try to find an adjacent box owned by a player.
    if (type === 'h') {
        if (state.boxes[r]?.[c] !== -1) return state.boxes[r][c];
        if (state.boxes[r-1]?.[c] !== -1) return state.boxes[r-1][c];
    } else { // type === 'v'
        if (state.boxes[r]?.[c] !== -1) return state.boxes[r][c];
        if (state.boxes[r]?.[c-1] !== -1) return state.boxes[r][c-1];
    }
    return 0; // Default to player 0 or a neutral color indicator
}

export function endGameAbruptly() {
    state.setGameActive(false);
    ui.updateMessageArea("El juego terminó inesperadamente.", true); // Translated
    ui.setBoardClickable(false);
    // Optionally, show modal or navigate to setup screen
}