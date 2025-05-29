// gameLogic.js - FIXED with missing exported functions

import * as state from './state.js';
import * as ui from './ui.js';
import * as peerConnection from './peerConnection.js';

/**
 * Initializes the game. Sets up the board, players, and initial state.
 * @param {boolean} isRemoteGame - True if this is a network game being initialized.
 */
export function initializeGame(isRemoteGame = false) {
    console.log(`[GameLogic] initializeGame called. Remote: ${isRemoteGame}. Current Player Index before init: ${state.currentPlayerIndex}`);
    if (!isRemoteGame) {
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
        if (state.totalPossibleBoxes === 0 && (state.numRows > 1 && state.numCols > 1)) {
            console.warn(`[GameLogic] totalPossibleBoxes was 0 for remote game, recalculating...`);
            state.setGameDimensions(state.numRows, state.numCols);
            console.log(`[GameLogic] Recalculated totalPossibleBoxes: ${state.totalPossibleBoxes}`);
        }
    }

    state.resetGameFlowState();
    state.setGameActive(true);
    console.log(`[GameLogic] After resetGameFlowState, Current Player Index: ${state.currentPlayerIndex}`);

    ui.drawBoardSVG();
    addSlotListeners();

    ui.updateScoresDisplay();
    ui.updatePlayerTurnDisplay();
    ui.updateMessageArea('');
    ui.showGameScreen();
    ui.setBoardClickable(state.pvpRemoteActive ? state.isMyTurnInRemote : true);
    if (ui.undoBtn) ui.undoBtn.disabled = true;

    console.log(`[GameLogic] Game initialized. Dimensions: ${state.numRows}x${state.numCols}. Total Boxes: ${state.totalPossibleBoxes}. Starting Player: ${state.currentPlayerIndex}. Is My Turn (if remote): ${state.isMyTurnInRemote}`);
}

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

function addSlotListeners() {
    const slots = ui.gameBoardSVG.querySelectorAll('.line-slot');
    slots.forEach(slot => {
        slot.addEventListener('click', handleLineClickWrapper);
    });
}

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
    
    // For local moves, playerMakingMove is the current turn player.
    // For remote moves, this will be derived from state.myPlayerIdInRemoteGame when sending.
    const playerMakingMove = state.currentPlayerIndex;
    console.log(`[GameLogic] Player ${playerMakingMove} (local client's current player) is making a move: ${type} at (${r},${c})`);

    processMove(type, r, c, playerMakingMove);

    if (state.pvpRemoteActive) {
        state.incrementTurnCounter();
        // MODIFIED: Send state.myPlayerIdInRemoteGame as the playerIndex
        // This ensures the sender is always correctly identified.
        const moveData = {
            type: 'game_move',
            move: { type, r, c, playerIndex: state.myPlayerIdInRemoteGame },
            turnCounter: state.turnCounter
        };
        console.log(`[GameLogic] Sending game_move (playerIndex from myPlayerIdInRemoteGame):`, moveData);
        peerConnection.sendPeerData(moveData);
    }
}

export function processMove(type, r, c, playerIndex, isRemoteSync = false) {
    if (!state.gameActive) {
        console.warn(`[GameLogic] processMove called but game not active. Move: ${type} ${r}-${c} by P${playerIndex}`);
        return;
    }

    console.log(`[GameLogic] processMove: Line ${type} at (${r},${c}) by player ${playerIndex}. Is Remote Sync: ${isRemoteSync}. Current state.currentPlayerIndex before this move processing: ${state.currentPlayerIndex}`);

    if (isRemoteSync && playerIndex !== state.currentPlayerIndex) {
        console.warn(`[GameLogic] Discrepancy in processMove: remote move by P${playerIndex}, but local state.currentPlayerIndex is ${state.currentPlayerIndex}. Setting local state.currentPlayerIndex to P${playerIndex} for this move action.`);
        state.setCurrentPlayerIndex(playerIndex);
    } else if (!isRemoteSync && playerIndex !== state.currentPlayerIndex) {
        // This case should ideally not happen if handleLineClickWrapper uses state.currentPlayerIndex correctly for playerMakingMove
        console.error(`[GameLogic] CRITICAL MISMATCH for local move: playerIndex arg P${playerIndex} !== state.currentPlayerIndex P${state.currentPlayerIndex}. Using state.currentPlayerIndex.`);
        playerIndex = state.currentPlayerIndex; // Trust the current state for local moves
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
            r: box.r, c: box.c, player: state.boxes[box.r]?.[box.c] ?? -1
        }));

        state.setLastMoveForUndo({
            type, r, c, playerIndex, lineElement, slotElement,
            boxesCompletedBeforeThisMove: previousBoxStates,
            scoreBeforeThisMove: state.playersData[playerIndex]?.score ?? 0
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
        playerContinues = true;
        
        if (!isRemoteSync && !state.pvpRemoteActive) {
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
        if(state.pvpRemoteActive) ui.setBoardClickable(false);
        return;
    }

    if (!playerContinues) {
        console.log(`[GameLogic] No box scored by P${playerIndex}. Ending their turn.`);
        endTurn(playerIndex); 
    } else {
        console.log(`[GameLogic] P${playerIndex} scored. Their turn continues. CurrentPlayerIndex remains ${playerIndex}.`);
        state.setCurrentPlayerIndex(playerIndex); // Explicitly ensure current player is the one who scored
        ui.updatePlayerTurnDisplay();
    }
    
    if (state.pvpRemoteActive) {
        state.setIsMyTurnInRemote(state.currentPlayerIndex === state.myPlayerIdInRemoteGame && state.gameActive);
        ui.setBoardClickable(state.isMyTurnInRemote);
        console.log(`[GameLogic processMove] Remote game. After P${playerIndex}'s move. Next logical player is P${state.currentPlayerIndex}. My turn? ${state.isMyTurnInRemote}. My ID: ${state.myPlayerIdInRemoteGame}`);
    } else {
         ui.setBoardClickable(true);
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
    const check = (br_idx, bc_idx) => {
        if (br_idx < 0 || br_idx >= state.numRows - 1 || bc_idx < 0 || bc_idx >= state.numCols - 1) return false;
        if (state.boxes[br_idx]?.[bc_idx] === -1 &&
            state.horizontalLines[br_idx]?.[bc_idx] &&
            state.horizontalLines[br_idx + 1]?.[bc_idx] &&
            state.verticalLines[br_idx]?.[bc_idx] &&
            state.verticalLines[br_idx]?.[bc_idx + 1]) {
            ui.fillBoxOnBoard(br_idx, bc_idx, playerIndex);
            state.boxes[br_idx][bc_idx] = playerIndex;
            boxesMadeThisTurn++;
            console.log(`[GameLogic] Box completed at (${br_idx}, ${bc_idx}) by player ${playerIndex}`);
            return true;
        }
        return false;
    };

    if (lineType === 'h') {
        check(lineR, lineC);
        check(lineR - 1, lineC);
    } else {
        check(lineR, lineC);
        check(lineR, lineC - 1);
    }
    return boxesMadeThisTurn;
}

function endTurn(playerWhoseTurnEnded) {
    if (!state.gameActive) return;

    const nextPlayerIndex = (playerWhoseTurnEnded + 1) % state.numPlayers;
    state.setCurrentPlayerIndex(nextPlayerIndex);
    console.log(`[GameLogic] endTurn: Player ${playerWhoseTurnEnded} turn ended. Next player is P${state.currentPlayerIndex}.`);
    ui.updatePlayerTurnDisplay();

    if (!state.pvpRemoteActive) {
        state.setLastMoveForUndo(null);
        if (ui.undoBtn) ui.undoBtn.disabled = true;
        ui.updateMessageArea('');
    }
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

    if (lineElement && lineElement.parentNode) lineElement.remove();
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
    if(state.playersData[playerIndex]) state.playersData[playerIndex].score = scoreBeforeThisMove;


    ui.updateScoresDisplay();
    ui.updateMessageArea(`${state.playersData[playerIndex]?.name ?? ('Jugador ' + (playerIndex+1))}, ¡hacé tu jugada de nuevo!`);
    state.setLastMoveForUndo(null);
    if (ui.undoBtn) ui.undoBtn.disabled = true;

    state.setCurrentPlayerIndex(playerIndex);
    ui.updatePlayerTurnDisplay();
    ui.setBoardClickable(true);
}

function checkGameOver() {
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
     if (winners.length === 0 && state.totalPossibleBoxes > 0 && state.filledBoxesCount >= state.totalPossibleBoxes) {
        winnerMessage = "¡Es un empate general! ¡Todas las cajitas han sido llenadas!";
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

export function applyRemoteMove(moveData) {
    if (!state.pvpRemoteActive || !state.gameActive) {
        console.warn(`[GameLogic applyRemoteMove] Ignoring remote move. PVP Active: ${state.pvpRemoteActive}, Game Active: ${state.gameActive}`);
        return;
    }
    
    const { type, r, c, playerIndex: remotePlayerIndex } = moveData; // This is the ID of the player who SENT the move.
    console.log(`[GameLogic applyRemoteMove] Applying remote move: ${type} at (${r},${c}) by actual sender P${remotePlayerIndex}. My Local Player ID: ${state.myPlayerIdInRemoteGame}. Current local state.currentPlayerIndex: ${state.currentPlayerIndex}`);

    // Set the currentPlayerIndex to the player who made the move FOR THIS ACTION
    state.setCurrentPlayerIndex(remotePlayerIndex);
    // ui.updatePlayerTurnDisplay(); // Update to show who just made the move. Re-called later.

    processMove(type, r, c, remotePlayerIndex, true); // true indicates remote sync

    if (state.gameActive) {
        // After processMove, state.currentPlayerIndex is now who plays NEXT.
        // So, isMyTurnInRemote is true if the NEXT player is me.
        state.setIsMyTurnInRemote(state.currentPlayerIndex === state.myPlayerIdInRemoteGame);
        ui.setBoardClickable(state.isMyTurnInRemote);
        ui.updatePlayerTurnDisplay(); // Update again to reflect actual "Your turn" or "Waiting"
        console.log(`[GameLogic applyRemoteMove] After processing remote move by P${remotePlayerIndex}. Next logical player is P${state.currentPlayerIndex}. Is My Turn? ${state.isMyTurnInRemote}`);
    } else {
        console.log(`[GameLogic applyRemoteMove] Game ended after processing remote move by P${remotePlayerIndex}.`);
        ui.setBoardClickable(false);
    }
}

// FIXED: Added missing applyFullState export
export function applyFullState(remoteGameState) {
    if (!state.pvpRemoteActive) {
        console.warn("[GameLogic applyFullState] Not in PVP remote mode, ignoring full state update");
        return;
    }
    
    console.log("[GameLogic applyFullState] Applying full remote state. My local Player ID:", state.myPlayerIdInRemoteGame, "Remote state (playersData only):", JSON.stringify(remoteGameState.playersData));

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
    console.log(`[GameLogic applyFullState] Applied state. New state.currentPlayerIndex: ${state.currentPlayerIndex}, GameActive: ${state.gameActive}`);

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
    
    if (state.gameActive) {
        state.setIsMyTurnInRemote(state.currentPlayerIndex === state.myPlayerIdInRemoteGame);
        ui.setBoardClickable(state.isMyTurnInRemote);
    } else {
        ui.setBoardClickable(false);
    }
    
    ui.updateScoresDisplay();
    ui.updatePlayerTurnDisplay();
    console.log(`[GameLogic applyFullState] Full state applied. Is my turn? ${state.isMyTurnInRemote} (CurrentPlayer: ${state.currentPlayerIndex} vs MyID: ${state.myPlayerIdInRemoteGame})`);

    if (!state.gameActive && state.filledBoxesCount >= state.totalPossibleBoxes && state.totalPossibleBoxes > 0) {
        announceWinner();
    } else if (!state.gameActive && state.pvpRemoteActive) { // Added pvpRemoteActive condition
        ui.updateMessageArea("Juego sincronizado. Esperando acción...");
    }
}

// FIXED: Added missing endGameAbruptly export
export function endGameAbruptly() {
    console.warn("[GameLogic] endGameAbruptly called.");
    state.setGameActive(false);
    ui.updateMessageArea("El juego terminó inesperadamente.", true);
    ui.setBoardClickable(false);
    if (ui.undoBtn) ui.undoBtn.disabled = true;
    state.setLastMoveForUndo(null);
}

function findLineOwner(r, c, type, boxesState) {
    const bState = boxesState || state.boxes; 
    let ownerId = state.playersData[0]?.id ?? 0; // Default to first player

    if (type === 'h') {
        if (bState[r]?.[c] !== undefined && bState[r][c] !== -1) ownerId = bState[r][c];
        else if (bState[r-1]?.[c] !== undefined && bState[r-1][c] !== -1) ownerId = bState[r-1][c];
    } else { 
        if (bState[r]?.[c] !== undefined && bState[r][c] !== -1) ownerId = bState[r][c];
        else if (bState[r]?.[c-1] !== undefined && bState[r][c-1] !== -1) ownerId = bState[r][c-1];
    }
    // Ensure the ownerId is a valid player index for the current playersData
    if (!state.playersData.find(p => p.id === ownerId)) {
        return state.playersData[0]?.id ?? 0;
    }
    return ownerId;
}