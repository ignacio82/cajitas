// gameLogic.js - MODIFIED with enhanced logging for playerIndex and turn logic

import * as state from './state.js';
import * as ui from './ui.js';
import * as peerConnection from './peerConnection.js';
// import * as sound from './sound.js'; // Import if game logic directly triggers sounds

/**
 * Initializes the game. Sets up the board, players, and initial state.
 * @param {boolean} isRemoteGame - True if this is a network game being initialized.
 */
export function initializeGame(isRemoteGame = false) {
    console.log(`[GameLogic] initializeGame called. Remote: ${isRemoteGame}. Current Player Index before init: ${state.currentPlayerIndex}`);
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
        state.playersData.forEach(p => p.score = 0);
        state.setRemotePlayersData([...state.playersData]);
        console.log(`[GameLogic] Remote game dimensions: ${state.numRows}x${state.numCols}, totalPossibleBoxes: ${state.totalPossibleBoxes}`);
        if (state.totalPossibleBoxes === 0 && (state.numRows > 1 && state.numCols > 1)) { // Check if rows/cols are valid for recalculation
            console.warn(`[GameLogic] totalPossibleBoxes was 0 for remote game, recalculating...`);
            state.setGameDimensions(state.numRows, state.numCols); // This recalculates totalPossibleBoxes
            console.log(`[GameLogic] Recalculated totalPossibleBoxes: ${state.totalPossibleBoxes}`);
        }
    }

    state.resetGameFlowState(); // Resets board, scores, turn counter etc.
    state.setGameActive(true);
    // For remote games, currentPlayerIndex should already be set by peerConnection logic (usually 0 for host start)
    // For local games, resetGameFlowState sets it to 0.
    console.log(`[GameLogic] After resetGameFlowState, Current Player Index: ${state.currentPlayerIndex}`);


    ui.drawBoardSVG();
    addSlotListeners();

    ui.updateScoresDisplay();
    ui.updatePlayerTurnDisplay(); // This will reflect the starting player
    ui.updateMessageArea('');
    ui.showGameScreen();
    ui.setBoardClickable(state.pvpRemoteActive ? state.isMyTurnInRemote : true);
    if (ui.undoBtn) ui.undoBtn.disabled = true;

    console.log(`[GameLogic] Game initialized. Dimensions: ${state.numRows}x${state.numCols}. Total Boxes: ${state.totalPossibleBoxes}. Starting Player: ${state.currentPlayerIndex}. Is My Turn (if remote): ${state.isMyTurnInRemote}`);
}

/**
 * Resets the game to the setup screen or restarts with current settings.
 * @param {boolean} backToSetup - If true, goes back to the setup screen.
 */
export function resetGame(backToSetup = true) {
    console.log("[GameLogic] Resetting game. Back to setup:", backToSetup);
    state.setGameActive(false);
    ui.clearBoardForNewGame();

    if (state.pvpRemoteActive && state.gamePaired && !backToSetup) {
        peerConnection.sendPeerData({ type: 'restart_request', playerName: state.playersData[state.myPlayerIdInRemoteGame]?.name });
        ui.showModalMessage("Solicitud de reinicio enviada...");
    } else if (backToSetup) {
        ui.showSetupScreen();
        state.resetNetworkState();
        ui.updateGameModeUI();
    } else {
        initializeGame();
    }
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
    console.log(`[GameLogic] handleLineClickWrapper: Game Active? ${state.gameActive}. PVP Remote? ${state.pvpRemoteActive}. My Turn? ${state.isMyTurnInRemote}. Current Player Index: ${state.currentPlayerIndex}. My Remote ID: ${state.myPlayerIdInRemoteGame}`);
    if (!state.gameActive) return;
    if (state.pvpRemoteActive && !state.isMyTurnInRemote) {
        ui.updateMessageArea("¡Ey! No es tu turno.", true);
        return;
    }

    const targetSlot = event.currentTarget;
    const type = targetSlot.dataset.type;
    const r = parseInt(targetSlot.dataset.r);
    const c = parseInt(targetSlot.dataset.c);

    const lineDrawn = (type === 'h' && state.horizontalLines[r]?.[c]) || (type === 'v' && state.verticalLines[r]?.[c]);
    if (lineDrawn) {
        console.warn(`[GameLogic] Click on already drawn line slot: ${type}-${r}-${c}. Ignoring.`);
        return;
    }
    
    // Log current player index BEFORE processing move
    const playerMakingMove = state.currentPlayerIndex;
    console.log(`[GameLogic] Player ${playerMakingMove} (local client's current player) is making a move: ${type} at (${r},${c})`);

    processMove(type, r, c, playerMakingMove); // Use the logged playerMakingMove

    if (state.pvpRemoteActive) {
        state.incrementTurnCounter();
        const moveData = {
            type: 'game_move',
            move: { type, r, c, playerIndex: playerMakingMove }, // Send the playerIndex of who made the move
            turnCounter: state.turnCounter
        };
        console.log(`[GameLogic] Sending game_move:`, moveData);
        peerConnection.sendPeerData(moveData);
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
    if (!state.gameActive) {
        console.warn(`[GameLogic] processMove called but game not active. Move: ${type} ${r}-${c} by P${playerIndex}`);
        return;
    }

    console.log(`[GameLogic] processMove: Line ${type} at (${r},${c}) by player ${playerIndex}. Is Remote Sync: ${isRemoteSync}. Current state.currentPlayerIndex: ${state.currentPlayerIndex}`);

    // If it's a remote sync, the playerIndex IS the current player for this move.
    // If it's a local move, playerIndex was already state.currentPlayerIndex.
    if (isRemoteSync && playerIndex !== state.currentPlayerIndex) {
        console.warn(`[GameLogic] Discrepancy in processMove: remote move by P${playerIndex}, but local state.currentPlayerIndex is ${state.currentPlayerIndex}. Setting local to P${playerIndex} for this move.`);
        state.setCurrentPlayerIndex(playerIndex); // Align for the duration of this move processing
    }


    if (type === 'h') {
        if(state.horizontalLines[r]?.[c]) {
            console.warn(`[GameLogic] Horizontal line ${r}-${c} already drawn. Aborting processMove.`);
            return;
        }
        state.horizontalLines[r][c] = 1;
    } else {
        if(state.verticalLines[r]?.[c]) {
            console.warn(`[GameLogic] Vertical line ${r}-${c} already drawn. Aborting processMove.`);
            return;
        }
        state.verticalLines[r][c] = 1;
    }

    const lineElement = ui.drawVisualLineOnBoard(type, r, c, playerIndex);

    const slotId = `slot-${type}-${r}-${c}`;
    const slotElement = document.getElementById(slotId);
    if (slotElement) {
        slotElement.style.fill = 'transparent';
        slotElement.removeEventListener('click', handleLineClickWrapper);
    }

    if (!isRemoteSync && !state.pvpRemoteActive) {
        const boxesPotentiallyCompleted = getPotentiallyAffectedBoxes(type, r, c);
        const previousBoxStates = boxesPotentiallyCompleted.map(box => ({
            r: box.r, c: box.c, player: state.boxes[box.r]?.[box.c] ?? -1 // Added nullish coalescing
        }));

        state.setLastMoveForUndo({
            type, r, c, playerIndex, lineElement, slotElement,
            boxesCompletedBeforeThisMove: previousBoxStates,
            scoreBeforeThisMove: state.playersData[playerIndex]?.score ?? 0 // Added nullish coalescing
        });
        if (ui.undoBtn) ui.undoBtn.disabled = false;
    }

    const boxesCompletedCount = checkForCompletedBoxes(type, r, c, playerIndex);
    console.log(`[GameLogic] Boxes completed this turn by P${playerIndex}: ${boxesCompletedCount}`);

    let playerContinues = false;
    if (boxesCompletedCount > 0) {
        state.updatePlayerScore(playerIndex, boxesCompletedCount);
        state.incrementFilledBoxesCount(boxesCompletedCount);
        ui.updateScoresDisplay();
        ui.updateMessageArea(`¡${state.playersData[playerIndex]?.name ?? ('Jugador ' + (playerIndex + 1))} hizo ${boxesCompletedCount} cajita(s)! ¡Seguís vos!`);
        playerContinues = true; // Player who scored continues
        
        if (!isRemoteSync && !state.pvpRemoteActive) { // Local game scoring move
            state.setLastMoveForUndo(null); 
            if (ui.undoBtn) ui.undoBtn.disabled = true;
        }
    }

    if (checkGameOver()) {
        console.log(`[GameLogic] Game Over detected after move by P${playerIndex}.`);
        announceWinner();
        state.setGameActive(false);
        if (ui.undoBtn) ui.undoBtn.disabled = true;
        state.setLastMoveForUndo(null);
        // For remote games, ensure the board is not clickable for anyone.
        if(state.pvpRemoteActive) ui.setBoardClickable(false);
        return; // No further turn logic if game is over
    }

    // Turn logic:
    // If playerContinues is true, currentPlayerIndex remains playerIndex.
    // If playerContinues is false, advance to the next player.
    if (!playerContinues) {
        console.log(`[GameLogic] No box scored by P${playerIndex} or game not over. Ending turn.`);
        endTurn(playerIndex); // Pass current player who just finished their non-scoring move
    } else {
        console.log(`[GameLogic] P${playerIndex} scored. Their turn continues. Updating turn display for P${playerIndex}.`);
        // Ensure state.currentPlayerIndex is set to the player who continues
        state.setCurrentPlayerIndex(playerIndex);
        ui.updatePlayerTurnDisplay(); // Update display for the continuing player
    }
    
    // For remote games, determine if it's this client's turn now.
    // This logic is critical and should happen AFTER turn logic (endTurn or continue turn)
    if (state.pvpRemoteActive) {
        state.setIsMyTurnInRemote(state.currentPlayerIndex === state.myPlayerIdInRemoteGame && state.gameActive);
        ui.setBoardClickable(state.isMyTurnInRemote);
        console.log(`[GameLogic processMove] Remote game. After move by P${playerIndex}. Next player is P${state.currentPlayerIndex}. My turn? ${state.isMyTurnInRemote}. My ID: ${state.myPlayerIdInRemoteGame}`);
    } else { // Local game
         ui.setBoardClickable(true); // Board always clickable for current player in local game
    }
}


function getPotentiallyAffectedBoxes(lineType, lineR, lineC) {
    const affected = [];
    if (lineType === 'h') {
        if (lineR < state.numRows - 1) affected.push({ r: lineR, c: lineC });
        if (lineR > 0) affected.push({ r: lineR - 1, c: lineC });
    } else {
        if (lineC < state.numCols - 1) affected.push({ r: lineR, c: lineC });
        if (lineC > 0) affected.push({ r: lineR, c: lineC - 1 });
    }
    return affected.filter(b => b.r >= 0 && b.r < state.numRows -1 && b.c >=0 && b.c < state.numCols -1);
}

function checkForCompletedBoxes(lineType, lineR, lineC, playerIndex) {
    let boxesMadeThisTurn = 0;
    const check = (br_idx, bc_idx) => { // Box row, box col
        if (br_idx < 0 || br_idx >= state.numRows - 1 || bc_idx < 0 || bc_idx >= state.numCols - 1) return false;
        if (state.boxes[br_idx]?.[bc_idx] === -1 && // Box not yet claimed
            state.horizontalLines[br_idx]?.[bc_idx] &&      // Top line of box
            state.horizontalLines[br_idx + 1]?.[bc_idx] &&  // Bottom line of box
            state.verticalLines[br_idx]?.[bc_idx] &&        // Left line of box
            state.verticalLines[br_idx]?.[bc_idx + 1]) {    // Right line of box
            ui.fillBoxOnBoard(br_idx, bc_idx, playerIndex);
            state.boxes[br_idx][bc_idx] = playerIndex;
            boxesMadeThisTurn++;
            console.log(`[GameLogic] Box completed at (${br_idx}, ${bc_idx}) by player ${playerIndex}`);
            return true;
        }
        return false;
    };

    if (lineType === 'h') {
        check(lineR, lineC);     // Check box below the H-line (if lineR is its top border)
        check(lineR - 1, lineC); // Check box above the H-line (if lineR is its bottom border)
    } else { // lineType === 'v'
        check(lineR, lineC);     // Check box to the right of V-line (if lineC is its left border)
        check(lineR, lineC - 1); // Check box to the left of V-line (if lineC is its right border)
    }
    return boxesMadeThisTurn;
}

function endTurn(playerWhoJustMoved) {
    if (!state.gameActive) return;

    const nextPlayerIndex = (playerWhoJustMoved + 1) % state.numPlayers;
    state.setCurrentPlayerIndex(nextPlayerIndex);
    console.log(`[GameLogic] endTurn: Player ${playerWhoJustMoved} finished. Next player is ${state.currentPlayerIndex}.`);
    ui.updatePlayerTurnDisplay();

    if (!state.pvpRemoteActive) {
        state.setLastMoveForUndo(null);
        if (ui.undoBtn) ui.undoBtn.disabled = true;
        ui.updateMessageArea('');
    }
    // isMyTurnInRemote and board clickability will be handled by the calling context (processMove or applyRemoteMove)
}

export function handleUndo() {
    if (!state.gameActive || state.pvpRemoteActive || !state.lastMoveForUndo) {
        if (ui.undoBtn) ui.undoBtn.disabled = true;
        return;
    }

    const { type, r, c, playerIndex, lineElement, slotElement, boxesCompletedBeforeThisMove, scoreBeforeThisMove } = state.lastMoveForUndo;
    console.log(`[GameLogic] handleUndo: Reverting move by P${playerIndex}: ${type} at (${r},${c})`);

    if (type === 'h') state.horizontalLines[r][c] = 0;
    else state.verticalLines[r][c] = 0;

    if (lineElement && lineElement.parentNode) {
        lineElement.remove();
    }
    if (slotElement) {
        slotElement.style.fill = 'rgba(0,0,0,0.03)';
        slotElement.addEventListener('click', handleLineClickWrapper);
    }

    if (boxesCompletedBeforeThisMove) {
        boxesCompletedBeforeThisMove.forEach(prevBoxState => {
            if (state.boxes[prevBoxState.r]?.[prevBoxState.c] === playerIndex && prevBoxState.player === -1) {
                state.boxes[prevBoxState.r][prevBoxState.c] = -1;
                ui.removeFilledBoxFromBoard(prevBoxState.r, prevBoxState.c);
                state.incrementFilledBoxesCount(-1);
            }
        });
    }
    state.playersData[playerIndex].score = scoreBeforeThisMove;

    ui.updateScoresDisplay();
    ui.updateMessageArea(`${state.playersData[playerIndex].name}, ¡hacé tu jugada de nuevo!`);
    state.setLastMoveForUndo(null);
    if (ui.undoBtn) ui.undoBtn.disabled = true;

    state.setCurrentPlayerIndex(playerIndex);
    ui.updatePlayerTurnDisplay();
    ui.setBoardClickable(true);
}

function checkGameOver() {
    // totalPossibleBoxes should be correctly calculated by setGameDimensions
    const gameOver = state.totalPossibleBoxes > 0 && state.filledBoxesCount >= state.totalPossibleBoxes;
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
    if (winners.length === 0 && state.totalPossibleBoxes > 0) { // Should not happen if game over check is correct
        winnerMessage = "¡El juego terminó, pero no hay un claro ganador! Algo raro pasó.";
    } else if (winners.length === 1) {
        winnerMessage = `¡${winners[0].name} ${winners[0].icon} ganó con ${maxScore} cajitas brillantes! ¡Bravo! 🥳`;
    } else {
        const winnerNames = winners.map(p => `${p.name} ${p.icon}`).join(' y ');
        winnerMessage = `¡Hay un súper empate entre ${winnerNames} con ${maxScore} cajitas cada uno! ¡Muy bien jugado! 🎉`;
    }
    ui.showModalMessage(`¡Juego Terminado! ${winnerMessage}`);
    ui.updateMessageArea('');
    if (ui.mainTitle) ui.mainTitle.textContent = "¿Jugar de Nuevo?";
}

// ---------- NETWORK GAME LOGIC HANDLERS ----------

export function applyRemoteMove(moveData) {
    if (!state.pvpRemoteActive || !state.gameActive) {
        console.warn(`[GameLogic applyRemoteMove] Ignoring remote move. PVP Active: ${state.pvpRemoteActive}, Game Active: ${state.gameActive}`);
        return;
    }
    
    const { type, r, c, playerIndex: remotePlayerIndex } = moveData;
    console.log(`[GameLogic applyRemoteMove] Applying remote move: ${type} at (${r},${c}) by player ${remotePlayerIndex}. My Player ID: ${state.myPlayerIdInRemoteGame}. Current local playerIndex: ${state.currentPlayerIndex}`);

    // The move was made by remotePlayerIndex. This player is now the "current player" for this action.
    state.setCurrentPlayerIndex(remotePlayerIndex);
    ui.updatePlayerTurnDisplay(); // Reflects who just made the move from remote perspective

    processMove(type, r, c, remotePlayerIndex, true); // true indicates remote sync

    // After processing the move (which might have changed state.currentPlayerIndex if no box was scored),
    // determine if it's now this local client's turn.
    if (state.gameActive) { // Game might have ended in processMove
        state.setIsMyTurnInRemote(state.currentPlayerIndex === state.myPlayerIdInRemoteGame);
        ui.setBoardClickable(state.isMyTurnInRemote);
        ui.updatePlayerTurnDisplay(); // Update again to reflect "Your turn" or "Waiting" after local turn advancement
        console.log(`[GameLogic applyRemoteMove] After processing remote move. Next player is ${state.currentPlayerIndex}. Is My Turn? ${state.isMyTurnInRemote}`);
    } else {
        console.log(`[GameLogic applyRemoteMove] Game ended after processing remote move.`);
        ui.setBoardClickable(false);
    }
}

export function applyFullState(remoteGameState) {
    if (!state.pvpRemoteActive) return;
    console.log("[GameLogic applyFullState] Applying full remote state. Current local player ID:", state.myPlayerIdInRemoteGame, "Remote state:", JSON.stringify(remoteGameState));

    state.setGameDimensions(remoteGameState.numRows, remoteGameState.numCols);
    state.setNumPlayers(remoteGameState.numPlayers);

    state.setPlayersData(remoteGameState.playersData.map(p => ({...p})));
    state.setRemotePlayersData([...remoteGameState.playersData]);

    state.setHorizontalLines(remoteGameState.horizontalLines.map(row => [...row]));
    state.setVerticalLines(remoteGameState.verticalLines.map(row => [...row]));
    state.setBoxes(remoteGameState.boxes.map(row => [...row]));
    state.setFilledBoxesCount(remoteGameState.filledBoxesCount);
    state.setTurnCounter(remoteGameState.turnCounter);
    state.setCurrentPlayerIndex(remoteGameState.currentPlayerIndex);
    state.setGameActive(remoteGameState.gameActive);
    console.log(`[GameLogic applyFullState] Applied state. New currentPlayerIndex: ${state.currentPlayerIndex}, GameActive: ${state.gameActive}`);


    ui.clearBoardForNewGame();
    ui.drawBoardSVG();
    addSlotListeners();

    state.horizontalLines.forEach((row, r_idx) => {
        row.forEach((val, c_idx) => {
            if (val) {
                const linePlayer = findLineOwner(r_idx,c_idx,'h', remoteGameState.boxes);
                ui.drawVisualLineOnBoard('h', r_idx, c_idx, linePlayer);
                const slotElement = document.getElementById(`slot-h-${r_idx}-${c_idx}`);
                if(slotElement) {
                     slotElement.style.fill = 'transparent';
                     slotElement.removeEventListener('click', handleLineClickWrapper);
                }
            }
        });
    });
    state.verticalLines.forEach((row, r_idx) => {
        row.forEach((val, c_idx) => {
            if (val) {
                const linePlayer = findLineOwner(r_idx,c_idx,'v', remoteGameState.boxes);
                ui.drawVisualLineOnBoard('v', r_idx, c_idx, linePlayer);
                const slotElement = document.getElementById(`slot-v-${r_idx}-${c_idx}`);
                 if(slotElement) {
                     slotElement.style.fill = 'transparent';
                     slotElement.removeEventListener('click', handleLineClickWrapper);
                 }
            }
        });
    });

    state.boxes.forEach((row, r_idx) => {
        row.forEach((playerIdxBox, c_idx) => {
            if (playerIdxBox !== -1) {
                ui.fillBoxOnBoard(r_idx, c_idx, playerIdxBox);
            }
        });
    });
    
    // This logic determines if it's this client's turn based on the new state
    if (state.gameActive) {
        state.setIsMyTurnInRemote(state.currentPlayerIndex === state.myPlayerIdInRemoteGame);
        ui.setBoardClickable(state.isMyTurnInRemote);
    } else {
        ui.setBoardClickable(false); // Game not active, board not clickable
    }
    
    ui.updateScoresDisplay();
    ui.updatePlayerTurnDisplay(); // This will now use the currentPlayerIndex from the synced state
    console.log(`[GameLogic applyFullState] Full state applied. Is my turn? ${state.isMyTurnInRemote} (CurrentPlayer: ${state.currentPlayerIndex} vs MyID: ${state.myPlayerIdInRemoteGame})`);


    if (!state.gameActive && state.filledBoxesCount >= state.totalPossibleBoxes && state.totalPossibleBoxes > 0) {
        announceWinner();
    } else if (!state.gameActive) {
        ui.updateMessageArea("Juego sincronizado. Esperando acción...");
    }
}

function findLineOwner(r, c, type, boxesState) {
    // Prefers the player who owns an adjacent box to the line.
    // This is still a heuristic as lines don't have explicit owners.
    // Pass boxesState (e.g., remoteGameState.boxes) to check against that specific state
    const bState = boxesState || state.boxes; 

    if (type === 'h') { // Horizontal line at (r,c)
        // Box below this line is (r, c)
        if (bState[r]?.[c] !== undefined && bState[r][c] !== -1) return bState[r][c];
        // Box above this line is (r-1, c)
        if (bState[r-1]?.[c] !== undefined && bState[r-1][c] !== -1) return bState[r-1][c];
    } else { // Vertical line at (r,c)
        // Box to the right of this line is (r,c)
        if (bState[r]?.[c] !== undefined && bState[r][c] !== -1) return bState[r][c];
        // Box to the left of this line is (r, c-1)
        if (bState[r]?.[c-1] !== undefined && bState[r][c-1] !== -1) return bState[r][c-1];
    }
    // Fallback: If no adjacent box is owned, try to find who could have completed it
    // This is complex. For simplicity, default to player 0 or a neutral indicator if not critical.
    // Or, more simply, use the current player if it's a live game, or player 0 for sync.
    return state.playersData[0]?.id ?? 0; // Default to first player's ID
}

export function endGameAbruptly() {
    console.warn("[GameLogic] endGameAbruptly called.");
    state.setGameActive(false);
    ui.updateMessageArea("El juego terminó inesperadamente.", true);
    ui.setBoardClickable(false);
}