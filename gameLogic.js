// gameLogic.js

import * as state from './state.js';
import * as ui from './ui.js';
import * as peerConnection from './peerConnection.js';
import * as sound from './sound.js';

export function initializeGame(isRemoteGame = false) {
    console.log(`[GameLogic] initializeGame called. Remote: ${isRemoteGame}. Current Player Index (ID) before init: ${state.currentPlayerIndex}`);
    
    if (!isRemoteGame) {
        state.setGameDimensions(state.numRows, state.numCols);
    } else {
        // Dimensions are set by leader via GAME_STARTED message, which calls setGameDimensions in state.js
        // state.setGameDimensions(state.networkRoomData.gameSettings.rows, state.networkRoomData.gameSettings.cols); // This should already be done
        console.log(`[GameLogic] Remote game. Dimensions: ${state.numRows}x${state.numCols}. Total Boxes: ${state.totalPossibleBoxes}`);
    }

    state.resetGameFlowState(isRemoteGame); // This sets currentPlayerIndex to playersData[0].id if playersData is populated
    state.setGameActive(true);
    
    // Ensure currentPlayerIndex is valid after reset, especially if playersData was set by GAME_STARTED
    if (state.playersData.length > 0 && !state.playersData.find(p => p.id === state.currentPlayerIndex)) {
        state.setCurrentPlayerIndex(state.playersData[0].id); // Default to first player's ID
        console.warn(`[GameLogic] initializeGame: currentPlayerIndex was invalid after reset, defaulted to ${state.playersData[0].id}`);
    }

    console.log(`[GameLogic] After resetGameFlowState, Current Player ID: ${state.currentPlayerIndex}, Players:`, JSON.parse(JSON.stringify(state.playersData)));

    ui.drawBoardSVG();
    addSlotListeners();

    ui.updateScoresDisplay();
    ui.updatePlayerTurnDisplay();
    ui.updateMessageArea('');
    
    if (isRemoteGame) {
        const isMyTurn = state.networkRoomData.myPlayerIdInRoom === state.currentPlayerIndex;
        ui.setBoardClickable(isMyTurn && state.gameActive);
    } else {
        ui.setBoardClickable(state.gameActive);
    }

    const undoBtn = document.getElementById('undo-btn');
    if (undoBtn) undoBtn.disabled = isRemoteGame || !state.lastMoveForUndo;
    const currentPlayerForLog = state.playersData.find(p => p.id === state.currentPlayerIndex);
    console.log(`[GameLogic] Game initialized. Starting Player: ${currentPlayerForLog?.name} (ID: ${state.currentPlayerIndex}). Is My Turn (if remote): ${state.pvpRemoteActive ? (state.networkRoomData.myPlayerIdInRoom === state.currentPlayerIndex) : 'N/A'}`);
}


export function resetGame(backToSetupScreen = true) {
    console.log("[GameLogic] resetGame called. Back to setup:", backToSetupScreen);
    state.setGameActive(false);
    ui.clearBoardForNewGame();

    if (state.pvpRemoteActive) {
        console.warn("[GameLogic] resetGame called during active PvP. This should ideally be managed by room logic (e.g. leader initiates restart).");
        // For now, local reset of scores and flow state if called.
        state.resetScores();
        state.resetGameFlowState(true);
        ui.updateScoresDisplay();
        // Client might need to re-enter lobby state or await leader's instruction.
        // ui.showLobbyScreen(); // Or similar, depending on desired flow
    } else {
        state.resetScores();
        state.resetGameFlowState(false); // Resets currentPlayerIndex to first player's ID
        if (backToSetupScreen) {
            // main.js handles ui.showSetupScreen()
        } else {
            // This case is for restarting the same local game configuration
            initializeGame(false);
        }
    }
}

function addSlotListeners() {
    const slots = ui.gameBoardSVG?.querySelectorAll('.line-slot');
    slots?.forEach(slot => {
        slot.removeEventListener('click', handleLineClickWrapper);
        slot.addEventListener('click', handleLineClickWrapper);
    });
}

function handleLineClickWrapper(event) {
    if (!state.gameActive) {
        console.log("[GameLogic] Line click ignored: Game not active.");
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

    if (state.pvpRemoteActive) {
        if (state.networkRoomData.myPlayerIdInRoom !== state.currentPlayerIndex) {
            ui.updateMessageArea("¡Ey! No es tu turno.", true);
            if(sound.errorSound && typeof sound.playSound === 'function') sound.playSound(sound.errorSound, undefined, "16n");
            return;
        }
        
        const boxesBefore = state.filledBoxesCount;
        let playerIndexForMove = state.networkRoomData.myPlayerIdInRoom; // This is the player's ID

        if (state.networkRoomData.isRoomLeader) {
            console.log(`[GameLogic] Host (P-ID ${playerIndexForMove}) making an authoritative move: ${type} ${r}-${c}`);
            processMove(type, r, c, playerIndexForMove, false, true);
            const boxesMadeThisTurn = state.filledBoxesCount - boxesBefore;
            
            const moveDataForBroadcast = { type, r, c };
            peerConnection.handleLeaderLocalMove(moveDataForBroadcast, boxesMadeThisTurn);

            const isStillMyTurn = state.currentPlayerIndex === playerIndexForMove;
            ui.setBoardClickable(isStillMyTurn && state.gameActive);
            if (!isStillMyTurn && state.gameActive) {
                const nextPlayer = state.playersData.find(p => p.id === state.currentPlayerIndex);
                ui.updateMessageArea(`Esperando a ${nextPlayer?.name || 'otro jugador'}...`, false, 0);
            } else if (!state.gameActive) {
                // ui.updateMessageArea("Juego terminado.", false, 0); // Winner announcement handles this
            }
        } else { // Client making a move
            console.log(`[GameLogic] Client (P-ID ${playerIndexForMove}) making an optimistic move: ${type} ${r}-${c}`);
            // Client makes an optimistic local update. This might be reverted or confirmed by leader.
            // For simplicity, we can let client do basic processing, but leader's state is truth.
            // ui.drawVisualLineOnBoard(type, r, c, playerIndexForMove); // Optimistic draw
            // For now, let client only send the move and wait for leader's broadcast.
            // This prevents complex rollback if client's optimistic logic differs.
            
            const boxesMadeThisTurn = 0; // Client doesn't calculate score authoritatively from its optimistic move.
            peerConnection.sendGameMoveToLeader(type, r, c, boxesMadeThisTurn);
            
            ui.setBoardClickable(false); // Wait for leader's confirmation
            ui.updateMessageArea("Jugada enviada. Esperando al líder...", false, 0);
        }

    } else { // Local Game
        processMove(type, r, c, state.currentPlayerIndex, false, false);
    }
}

export function processMove(type, r, c, playerMakingMoveId, isOptimisticUpdate = false, isLeaderProcessing = false) {
    if (!state.gameActive && !isLeaderProcessing && !isOptimisticUpdate) {
        console.warn(`[GameLogic processMove] Called but game not active. Move: ${type} ${r}-${c} by P-ID ${playerMakingMoveId}.`);
        return 0;
    }
    const playerObject = state.playersData.find(p => p.id === playerMakingMoveId);
    console.log(`[GameLogic processMove] Line ${type} at (${r},${c}) by P-ID ${playerMakingMoveId} (${playerObject?.name}). Optimistic: ${isOptimisticUpdate}, Leader: ${isLeaderProcessing}. CurrentPlayerID: ${state.currentPlayerIndex}, GameActive: ${state.gameActive}`);

    if ( (!state.pvpRemoteActive && !isOptimisticUpdate) || isLeaderProcessing ) {
        if (playerMakingMoveId !== state.currentPlayerIndex) {
            console.error(`[GameLogic processMove] Turn mismatch! Expected P-ID ${state.currentPlayerIndex}, got P-ID ${playerMakingMoveId}. Move ignored.`);
            return 0;
        }
    }

    if (type === 'h') {
        if(state.horizontalLines[r]?.[c]) {
            console.warn(`[GameLogic processMove] Horiz line ${r}-${c} already drawn. Aborting.`);
            return 0;
        }
        state.horizontalLines[r][c] = 1;
    } else {
        if(state.verticalLines[r]?.[c]) {
            console.warn(`[GameLogic processMove] Vert line ${r}-${c} already drawn. Aborting.`);
            return 0;
        }
        state.verticalLines[r][c] = 1;
    }

    const lineElement = ui.drawVisualLineOnBoard(type, r, c, playerMakingMoveId);
    if(sound.lineSound && typeof sound.playSound === 'function') sound.playSound(sound.lineSound, "C4", "32n");

    const slotId = `slot-${type}-${r}-${c}`;
    const slotElement = document.getElementById(slotId);
    if (slotElement) {
        slotElement.style.fill = 'transparent';
        slotElement.removeEventListener('click', handleLineClickWrapper);
    }

    if (!state.pvpRemoteActive && !isOptimisticUpdate && !isLeaderProcessing) { // Local game undo logic
        const boxesPotentiallyAffected = getPotentiallyAffectedBoxes(type, r, c);
        const previousBoxStates = boxesPotentiallyAffected.map(box => ({
            r: box.r, c: box.c, player: state.boxes[box.r]?.[box.c] ?? -1
        }));
        state.setLastMoveForUndo({
            type, r, c, playerMakingMoveId, lineElement, slotElement,
            boxesCompletedBeforeThisMove: previousBoxStates,
            scoreBeforeThisMove: state.playersData.find(p=>p.id === playerMakingMoveId)?.score ?? 0
        });
        const undoBtn = document.getElementById('undo-btn');
        if (undoBtn) undoBtn.disabled = false;
    }

    const boxesCompletedCount = checkForCompletedBoxes(type, r, c, playerMakingMoveId);
    const completingPlayer = state.playersData.find(p => p.id === playerMakingMoveId);
    console.log(`[GameLogic processMove] Boxes completed by P-ID ${playerMakingMoveId} (${completingPlayer?.name}): ${boxesCompletedCount}`);

    let playerContinues = false;
    if (boxesCompletedCount > 0) {
        state.updatePlayerScoreInGame(playerMakingMoveId, boxesCompletedCount);
        state.incrementFilledBoxesCount(boxesCompletedCount);
        ui.updateScoresDisplay();
        if(sound.boxSound && typeof sound.playSound === 'function') sound.playSound(sound.boxSound, "A5", "16n", Tone.now() + 0.05);
        playerContinues = true;

        if (!isOptimisticUpdate) {
            const playerName = completingPlayer?.name || `Jugador ${playerMakingMoveId}`;
            ui.updateMessageArea(`¡${playerName} hizo ${boxesCompletedCount} cajita(s)! ¡Sigue jugando!`, false, 3000);
        }

        if (!state.pvpRemoteActive && !isOptimisticUpdate && !isLeaderProcessing) {
            state.setLastMoveForUndo(null); // Scored, so disable undo for this specific move
            const undoBtn = document.getElementById('undo-btn');
            if (undoBtn) undoBtn.disabled = true;
        }
    }

    const gameOver = checkGameOver(); // This also sets state.gameActive = false if game is over

    if (gameOver) {
        if (!isOptimisticUpdate) {
            if (!state.pvpRemoteActive) { // Local game
                announceWinner();
            } else if (isLeaderProcessing) {
                // Leader will trigger GAME_OVER_ANNOUNCEMENT broadcast via peerConnection
                console.log("[GameLogic processMove] Game over, processed by leader. Broadcast handled by peerConnection.");
            }
        }
        ui.setBoardClickable(false);
        const undoBtn = document.getElementById('undo-btn');
        if (undoBtn && !state.pvpRemoteActive) undoBtn.disabled = true;
        
        return boxesCompletedCount;
    }

    if (!isOptimisticUpdate) { // Authoritative turn change (local game or leader processing)
        if (!playerContinues) {
            endTurn(playerMakingMoveId); // Pass the ID of the player whose turn just ended
        } else {
            state.setCurrentPlayerIndex(playerMakingMoveId); // Player scored, turn continues for them (their ID)
        }
        ui.updatePlayerTurnDisplay();

        if (!state.pvpRemoteActive) { // Local game
            ui.setBoardClickable(true);
        }
        // For remote games, clickability is set by applyRemoteMove or handleLineClickWrapper (for leader)
    }
    return boxesCompletedCount;
}

function getPotentiallyAffectedBoxes(lineType, lineR, lineC) {
    const affected = [];
    if (lineType === 'h') {
        if (lineR < state.numRows - 1) affected.push({ r: lineR, c: lineC }); // Box below
        if (lineR > 0) affected.push({ r: lineR - 1, c: lineC });   // Box above
    } else { // type === 'v'
        if (lineC < state.numCols - 1) affected.push({ r: lineR, c: lineC }); // Box to the right
        if (lineC > 0) affected.push({ r: lineR, c: lineC - 1 });   // Box to the left
    }
    // Filter for valid box coordinates
    return affected.filter(b =>
        b.r >= 0 && b.r < (state.numRows - 1) &&
        b.c >= 0 && b.c < (state.numCols - 1)
    );
}

function checkForCompletedBoxes(lineType, lineR, lineC, playerFillingBoxId) {
    let boxesMadeThisTurn = 0;
    const check = (br_idx, bc_idx) => {
        if (br_idx < 0 || br_idx >= state.numRows - 1 || bc_idx < 0 || bc_idx >= state.numCols - 1) return false;

        if (state.boxes[br_idx]?.[bc_idx] === -1 && // Box not already filled
            state.horizontalLines[br_idx]?.[bc_idx] &&      // Top line
            state.horizontalLines[br_idx + 1]?.[bc_idx] &&  // Bottom line
            state.verticalLines[br_idx]?.[bc_idx] &&        // Left line
            state.verticalLines[br_idx]?.[bc_idx + 1]) {    // Right line
            
            ui.fillBoxOnBoard(br_idx, bc_idx, playerFillingBoxId);
            state.boxes[br_idx][bc_idx] = playerFillingBoxId; // Store ID of player who filled it
            boxesMadeThisTurn++;
            console.log(`[GameLogic] Box completed at (${br_idx}, ${bc_idx}) by player P-ID ${playerFillingBoxId}`);
            return true;
        }
        return false;
    };

    if (lineType === 'h') {
        check(lineR, lineC);      // Check box below the horizontal line
        check(lineR - 1, lineC);  // Check box above the horizontal line
    } else { // type === 'v'
        check(lineR, lineC);      // Check box to the right of the vertical line
        check(lineR, lineC - 1);  // Check box to the left of the vertical line
    }
    return boxesMadeThisTurn;
}

/**
 * Ends the current player's turn and sets the next player.
 * @param {number} playerWhoseTurnEndedId - The ID of the player whose turn just finished.
 */
function endTurn(playerWhoseTurnEndedId) {
    if (!state.gameActive) {
        console.log(`[GameLogic endTurn] Game not active, not switching turn from P-ID ${playerWhoseTurnEndedId}.`);
        return;
    }
    if (!state.playersData || state.playersData.length === 0) {
        console.error("[GameLogic endTurn] No playersData to determine next turn.");
        return;
    }

    const currentPlayerArrayIndex = state.playersData.findIndex(p => p.id === playerWhoseTurnEndedId);
    if (currentPlayerArrayIndex === -1) {
        console.error(`[GameLogic endTurn] Player with ID ${playerWhoseTurnEndedId} not found in playersData.`);
        // Default to first player if current is not found, to prevent crash
        state.setCurrentPlayerIndex(state.playersData[0].id);
        ui.updatePlayerTurnDisplay();
        return;
    }

    const nextPlayerArrayIndex = (currentPlayerArrayIndex + 1) % state.playersData.length;
    const nextPlayerId = state.playersData[nextPlayerArrayIndex].id;
    state.setCurrentPlayerIndex(nextPlayerId);

    const nextPlayerObject = state.playersData.find(p => p.id === nextPlayerId);
    console.log(`[GameLogic endTurn] P-ID ${playerWhoseTurnEndedId}'s turn ended. Next is P-ID ${state.currentPlayerIndex} (${nextPlayerObject?.name}).`);
    
    if (!state.pvpRemoteActive) { // Local game specific logic
        state.setLastMoveForUndo(null); // Clear undo for the previous player's move
        const undoBtn = document.getElementById('undo-btn');
        if (undoBtn) undoBtn.disabled = true;
        ui.updateMessageArea(''); // Clear any "you scored" messages
    }
    // ui.updatePlayerTurnDisplay(); // Caller (processMove) will handle this
}

export function handleUndo() {
    if (state.pvpRemoteActive || !state.gameActive || !state.lastMoveForUndo) {
        const undoBtn = document.getElementById('undo-btn');
        if (undoBtn) undoBtn.disabled = true;
        return;
    }
    if(sound.undoSound && typeof sound.playSound === 'function') sound.playSound(sound.undoSound, "E3", "16n");

    const { type, r, c, playerMakingMoveId, lineElement, slotElement, boxesCompletedBeforeThisMove, scoreBeforeThisMove } = state.lastMoveForUndo;
    console.log(`[GameLogic handleUndo] Reverting move by P-ID ${playerMakingMoveId}: ${type} at (${r},${c})`);

    if (type === 'h') state.horizontalLines[r][c] = 0;
    else state.verticalLines[r][c] = 0;

    ui.removeVisualLineFromBoard(type, r, c);
    if (slotElement) {
        slotElement.style.fill = 'rgba(0,0,0,0.03)';
        slotElement.addEventListener('click', handleLineClickWrapper);
    }

    if (boxesCompletedBeforeThisMove) {
        let boxesRevertedCount = 0;
        boxesCompletedBeforeThisMove.forEach(prevBoxState => {
            // Only revert if the box was indeed completed by the player whose move is being undone
            if (state.boxes[prevBoxState.r]?.[prevBoxState.c] === playerMakingMoveId && prevBoxState.player === -1) {
                state.boxes[prevBoxState.r][prevBoxState.c] = -1;
                ui.removeFilledBoxFromBoard(prevBoxState.r, prevBoxState.c);
                boxesRevertedCount++;
            }
        });
        state.incrementFilledBoxesCount(-boxesRevertedCount); // Decrement global count
    }
    const playerToUpdate = state.playersData.find(p => p.id === playerMakingMoveId);
    if(playerToUpdate) playerToUpdate.score = scoreBeforeThisMove; // Restore score

    ui.updateScoresDisplay();
    ui.updateMessageArea(`${playerToUpdate?.name || 'Jugador'}, ¡hacé tu jugada de nuevo!`);
    state.setLastMoveForUndo(null);
    const undoBtn = document.getElementById('undo-btn');
    if (undoBtn) undoBtn.disabled = true;

    state.setCurrentPlayerIndex(playerMakingMoveId); // Set turn back to the player who is undoing
    ui.updatePlayerTurnDisplay();
    ui.setBoardClickable(true);
}

function checkGameOver() {
    const isOver = state.totalPossibleBoxes > 0 && state.filledBoxesCount >= state.totalPossibleBoxes;
    if (isOver && state.gameActive) {
        console.log(`[GameLogic checkGameOver] Game Over! Filled: ${state.filledBoxesCount}, Total: ${state.totalPossibleBoxes}. Setting gameActive to false.`);
        state.setGameActive(false);
    }
    return isOver;
}

export function getWinnerData() {
    let maxScore = -1;
    let winners = [];
    if (!state.playersData || state.playersData.length === 0) return { winners, maxScore, isTie: false };

    state.playersData.forEach((player) => {
        if (player.score > maxScore) {
            maxScore = player.score;
            winners = [{ name: player.name, icon: player.icon, score: player.score, id: player.id }];
        } else if (player.score === maxScore && maxScore !== -1) { // Check maxScore !== -1 to ensure it's a valid score comparison
            winners.push({ name: player.name, icon: player.icon, score: player.score, id: player.id });
        }
    });
    const isTie = winners.length > 1 || (winners.length === 1 && state.playersData.length > 1 && state.playersData.every(p => p.score === winners[0].score));
    return { winners, maxScore, isTie: isTie && maxScore >=0 };
}

function announceWinner() {
    if (state.gameActive) { // Should ideally be false here if checkGameOver was effective
       console.warn("[GameLogic announceWinner] Called while game is still marked active. This might be premature.");
    }
    const { winners, maxScore, isTie } = getWinnerData();
    let winnerMessage;

    if (winners.length === 0 && state.totalPossibleBoxes > 0 && state.filledBoxesCount >= state.totalPossibleBoxes) {
         winnerMessage = "¡Es un empate general! ¡Todas las cajitas han sido llenadas!";
         if(sound.tieSound && typeof sound.playSound === 'function') sound.playSound(sound.tieSound, ["C4", "E4", "G4"], "4n");
    } else if (maxScore === 0 && state.filledBoxesCount === state.totalPossibleBoxes && state.playersData.every(p => p.score === 0)) {
        winnerMessage = "¡Todas las cajitas llenas, pero fue un empate sin puntos! ¿Revancha?";
        if(sound.tieSound && typeof sound.playSound === 'function') sound.playSound(sound.tieSound, ["C4", "E4", "G4"], "4n");
    } else if (!isTie && winners.length === 1) {
        winnerMessage = `¡${winners[0].name} ${winners[0].icon} ganó con ${maxScore} cajitas brillantes! ¡Bravo! 🥳`;
        if(sound.winSound && typeof sound.playSound === 'function') sound.playSound(sound.winSound, ["C4", "E4", "G4", "C5"], "2n");
    } else if (isTie && winners.length > 0) {
        const winnerNames = winners.map(p => `${p.name} ${p.icon}`).join(' y ');
        winnerMessage = `¡Hay un súper empate entre ${winnerNames} con ${maxScore} cajitas cada uno! ¡Muy bien jugado! 🎉`;
        if(sound.tieSound && typeof sound.playSound === 'function') sound.playSound(sound.tieSound, ["D4", "F4", "A4"], "4n");
    } else {
        winnerMessage = "El juego ha terminado.";
        console.log("[GameLogic announceWinner] Game ended, but winner conditions were ambiguous.", {winners, maxScore, isTie});
    }
    ui.showModalMessage(`¡Juego Terminado! ${winnerMessage}`);
    ui.updateMessageArea('');
    const mainTitle = document.getElementById('main-title');
    if (mainTitle && !state.pvpRemoteActive) mainTitle.textContent = "¿Jugar de Nuevo?";
    else if (mainTitle && state.pvpRemoteActive) mainTitle.textContent = "Partida Terminada";
}

export function applyRemoteMove(moveData, nextPlayerIdFromLeader, updatedScoresFromLeader) {
    // Allow applying move even if game locally marked inactive, to sync final state, but log it.
    if (!state.pvpRemoteActive && !state.gameActive) {
        console.warn(`[GameLogic applyRemoteMove] Ignoring. Not PVP or game not active locally. Active: ${state.gameActive}, PVP: ${state.pvpRemoteActive}`);
        return;
    }
    if (!state.gameActive && state.filledBoxesCount >= state.totalPossibleBoxes) {
        console.log("[GameLogic applyRemoteMove] Game already ended locally, but applying remote move possibly for final sync.");
    }
    
    const { type, r, c, playerIndex: moverPlayerId } = moveData; // playerIndex from message is the ID of the mover
    const moverPlayerObject = state.playersData.find(p => p.id === moverPlayerId);
    const nextPlayerObject = state.playersData.find(p => p.id === nextPlayerIdFromLeader);

    console.log(`[GameLogic applyRemoteMove] Applying remote move: ${type} at (${r},${c}) by P-ID ${moverPlayerId} (${moverPlayerObject?.name}). Next turn P-ID: ${nextPlayerIdFromLeader} (${nextPlayerObject?.name}). My local P-ID: ${state.networkRoomData.myPlayerIdInRoom}.`);

    const lineAlreadyExists = (type === 'h' && state.horizontalLines[r]?.[c]) || (type === 'v' && state.verticalLines[r]?.[c]);

    if (!lineAlreadyExists) {
        if (type === 'h') state.horizontalLines[r][c] = 1;
        else state.verticalLines[r][c] = 1;
        ui.drawVisualLineOnBoard(type, r, c, moverPlayerId);
        if(sound.lineSound && typeof sound.playSound === 'function') sound.playSound(sound.lineSound, "C4", "32n");
        const slotId = `slot-${type}-${r}-${c}`;
        const slotElement = document.getElementById(slotId);
        if (slotElement) {
            slotElement.removeEventListener('click', handleLineClickWrapper);
            slotElement.style.fill = 'transparent';
        }
    } else {
        console.log(`[GameLogic applyRemoteMove] Line ${type}-${r}-${c} by P-ID ${moverPlayerId} already exists locally. Skipping draw.`);
    }

    const boxesCompletedLocally = checkForCompletedBoxes(type, r, c, moverPlayerId); // Use mover's ID for filling
    if (boxesCompletedLocally > 0 && !lineAlreadyExists) {
        if(sound.boxSound && typeof sound.playSound === 'function') sound.playSound(sound.boxSound, "A5", "16n", Tone.now() + 0.05);
    }
    
    if (updatedScoresFromLeader) {
        updatedScoresFromLeader.forEach(ps => {
            const playerToUpdate = state.playersData.find(p => p.id === ps.id);
            if (playerToUpdate) playerToUpdate.score = ps.score;
        });
        // Recalculate filledBoxesCount based on actual boxes state for robust sync
        let newFilledCount = 0;
        for(let br=0; br < state.numRows-1; br++){
            for(let bc=0; bc < state.numCols-1; bc++){
                if(state.boxes[br]?.[bc] !== -1) newFilledCount++;
            }
        }
        state.setFilledBoxesCount(newFilledCount);
        ui.updateScoresDisplay();
    }

    state.setCurrentPlayerIndex(nextPlayerIdFromLeader); // Update current player to the ID from leader
    ui.updatePlayerTurnDisplay();

    const isGameOver = checkGameOver(); // Sets state.gameActive = false if over

    if (isGameOver) {
        ui.setBoardClickable(false);
        console.log("[GameLogic applyRemoteMove] Game is over after applying remote move. Client awaits GAME_OVER_ANNOUNCEMENT for modal.");
    } else {
        const isMyTurnNow = state.networkRoomData.myPlayerIdInRoom === state.currentPlayerIndex;
        console.log(`[GameLogic applyRemoteMove] Is it my turn now? ${isMyTurnNow} (My ID: ${state.networkRoomData.myPlayerIdInRoom}, Current Turn P-ID: ${state.currentPlayerIndex})`);
        ui.setBoardClickable(isMyTurnNow && state.gameActive);
        if (isMyTurnNow && state.gameActive) {
            ui.updateMessageArea("¡Tu turno!", false, 3000);
        } else if (state.gameActive) {
            const currentPlayerName = state.playersData.find(p => p.id === state.currentPlayerIndex)?.name || `Jugador ${state.currentPlayerIndex}`;
            ui.updateMessageArea(`Esperando a ${currentPlayerName}...`, false, 0);
        } else if (!state.gameActive && !isGameOver) { // Game became inactive but not due to all boxes filled (e.g. disconnect)
            ui.updateMessageArea("El juego ha sido interrumpido.", false, 0);
        }
    }
}


export function applyFullState(remoteGameState) {
    if (!state.pvpRemoteActive) {
        console.warn("[GameLogic applyFullState] Not in PVP remote mode, ignoring.");
        return;
    }
    
    console.log("[GameLogic applyFullState] Applying full remote state. My local Player ID in Room:", state.networkRoomData.myPlayerIdInRoom);
    state.logCurrentState("Before applyFullState");

    state.setGameDimensions(remoteGameState.gameSettings.rows, remoteGameState.gameSettings.cols);
    state.setPlayersData(remoteGameState.playersInGameOrder.map(p => ({...p}))); // Crucial: this sets the players for the game
    
    state.setHorizontalLines(remoteGameState.horizontalLines.map(row => [...row]));
    state.setVerticalLines(remoteGameState.verticalLines.map(row => [...row]));
    state.setBoxes(remoteGameState.boxes.map(row => [...row])); // Boxes store player IDs
    state.setFilledBoxesCount(remoteGameState.filledBoxesCount);
    state.setCurrentPlayerIndex(remoteGameState.currentPlayerIndex); // This is the ID of the current player
    state.setGameActive(remoteGameState.gameActive);
    state.networkRoomData.turnCounter = remoteGameState.turnCounter; // Sync turn counter

    ui.clearBoardForNewGame();
    ui.drawBoardSVG(); // Redraws dots and empty slots
    addSlotListeners(); // Re-add listeners to new slots

    // Redraw lines
    state.horizontalLines.forEach((row, r_idx) => {
        row.forEach((val, c_idx) => {
            if (val) {
                // For simplicity, just draw with a default color or try to find any player for the line.
                // The original line owner isn't stored with the line itself.
                // Box owner is more important.
                ui.drawVisualLineOnBoard('h', r_idx, c_idx, remoteGameState.currentPlayerIndex); // Or a generic player index like 0
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
                ui.drawVisualLineOnBoard('v', r_idx, c_idx, remoteGameState.currentPlayerIndex);
                const slotElement = document.getElementById(`slot-v-${r_idx}-${c_idx}`);
                 if(slotElement) {
                     slotElement.style.fill = 'transparent';
                     slotElement.removeEventListener('click', handleLineClickWrapper);
                 }
            }
        });
    });

    // Redraw filled boxes with correct player owner
    state.boxes.forEach((row, r_idx) => {
        row.forEach((playerOwnerId, c_idx) => { // playerOwnerId is the ID of the player who filled the box
            if (playerOwnerId !== -1) {
                ui.fillBoxOnBoard(r_idx, c_idx, playerOwnerId);
            }
        });
    });
    
    ui.updateScoresDisplay();
    ui.updatePlayerTurnDisplay();

    if (state.gameActive) {
        const isMyTurn = state.networkRoomData.myPlayerIdInRoom === state.currentPlayerIndex;
        ui.setBoardClickable(isMyTurn);
        const currentPlayerObject = state.playersData.find(p => p.id === state.currentPlayerIndex);
        if(isMyTurn) ui.updateMessageArea("¡Tu turno! (Estado Sincronizado)");
        else ui.updateMessageArea(`Esperando a ${currentPlayerObject?.name || 'oponente'}... (Estado Sincronizado)`, false, 0);
    } else {
        ui.setBoardClickable(false);
        if (state.filledBoxesCount >= state.totalPossibleBoxes && state.totalPossibleBoxes > 0) {
            // Game ended normally, winner modal handled by GAME_OVER_ANNOUNCEMENT
            console.log("[GameLogic applyFullState] Synced to a game over state.");
        } else {
            ui.updateMessageArea("Juego sincronizado. Esperando acción o finalización...");
        }
    }
    console.log(`[GameLogic applyFullState] Full state applied. Is my turn? ${state.networkRoomData.myPlayerIdInRoom === state.currentPlayerIndex}. Current Player ID: ${state.currentPlayerIndex}`);
    state.logCurrentState("After applyFullState");
}


export function endGameAbruptly() {
    console.warn("[GameLogic] endGameAbruptly called.");
    if (state.gameActive) {
        state.setGameActive(false);
        ui.updateMessageArea("El juego terminó inesperadamente.", true);
        ui.setBoardClickable(false);
        const undoBtn = document.getElementById('undo-btn');
        if (undoBtn && !state.pvpRemoteActive) undoBtn.disabled = true;
        state.setLastMoveForUndo(null);
    }
}