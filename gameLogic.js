// gameLogic.js

import * as state from './state.js';
import * as ui from './ui.js';
import * as peerConnection from './peerConnection.js';
import * as sound from './sound.js'; // Ensure sound is imported to use sound.triggerVibration
import * as cpu from './cpu.js'; // Import the new CPU module

export function initializeGame(isRemoteGame = false) {
    console.log(`[GameLogic] initializeGame called. Remote: ${isRemoteGame}. Current Player Index (ID) before init: ${state.currentPlayerIndex}`);
    
    if (!isRemoteGame) {
        state.setGameDimensions(state.numRows, state.numCols);
    } else {
        // Dimensions are set by leader via GAME_STARTED message, which calls setGameDimensions in state.js
        console.log(`[GameLogic] Remote game. Dimensions: ${state.numRows}x${state.numCols}. Total Boxes: ${state.totalPossibleBoxes}`);
    }

    state.resetGameFlowState(isRemoteGame); 
    state.setGameActive(true);
    
    if (state.playersData.length > 0 && !state.playersData.find(p => p.id === state.currentPlayerIndex)) {
        state.setCurrentPlayerIndex(state.playersData[0].id); 
        console.warn(`[GameLogic] initializeGame: currentPlayerIndex was invalid after reset, defaulted to ${state.playersData[0].id}`);
    }

    console.log(`[GameLogic] After resetGameFlowState, Current Player ID: ${state.currentPlayerIndex}, Players:`, JSON.parse(JSON.stringify(state.playersData)));

    ui.drawBoardSVG();
    addSlotListeners();

    ui.updateScoresDisplay();
    ui.updatePlayerTurnDisplay();
    ui.updateMessageArea('');
    
    const undoBtn = document.getElementById('undo-btn');
    if (undoBtn) { // Ensure undoBtn exists
        // Disable undo if it's a remote game or if the current player is CPU (and it's their turn)
        const currentPlayerIsCpu = !isRemoteGame && state.playersData.find(p => p.id === state.currentPlayerIndex)?.isCpu;
        undoBtn.disabled = isRemoteGame || !state.lastMoveForUndo || currentPlayerIsCpu;
    }


    if (!isRemoteGame) { // Local game (either all-human or vs-CPU)
        cpu.handleTurnChange(); // This will trigger CPU if it's their turn, or set board clickable for human.
    } else { // Remote game
        const isMyTurn = state.networkRoomData.myPlayerIdInRoom === state.currentPlayerIndex;
        ui.setBoardClickable(isMyTurn && state.gameActive);
    }
    
    const currentPlayerForLog = state.playersData.find(p => p.id === state.currentPlayerIndex);
    console.log(`[GameLogic] Game initialized. Starting Player: ${currentPlayerForLog?.name} (ID: ${state.currentPlayerIndex}). Is My Turn (if remote): ${state.pvpRemoteActive ? (state.networkRoomData.myPlayerIdInRoom === state.currentPlayerIndex) : 'N/A'}`);
}


export function resetGame(backToSetupScreen = true) {
    console.log("[GameLogic] resetGame called. Back to setup:", backToSetupScreen);
    cpu.cancelCpuMove(); // Ensure any pending CPU move is cancelled
    state.setGameActive(false);
    ui.clearBoardForNewGame();

    if (state.pvpRemoteActive) {
        console.warn("[GameLogic] resetGame called during active PvP. This should ideally be managed by room logic (e.g. leader initiates restart).");
        state.resetScores();
        state.resetGameFlowState(true);
        ui.updateScoresDisplay();
    } else {
        state.resetScores();
        state.resetGameFlowState(false); 
        if (backToSetupScreen) {
            // main.js handles ui.showSetupScreen()
        } else {
            // This case is for restarting the same local game configuration
            initializeGame(false); // Re-initialize, which will call cpu.handleTurnChange
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

    // Prevent clicks if current player is CPU (as a safeguard, though UI should be disabled)
    const currentPlayerObject = state.playersData.find(p => p.id === state.currentPlayerIndex);
    if (!state.pvpRemoteActive && currentPlayerObject && currentPlayerObject.isCpu) {
        console.warn("[GameLogic] Line click ignored: It's CPU's turn.");
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
            if(typeof sound.triggerVibration === 'function') sound.triggerVibration([70, 50, 70]); 
            return;
        }
        
        const boxesBefore = state.filledBoxesCount;
        let playerIndexForMove = state.networkRoomData.myPlayerIdInRoom; 

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
            }
        } else { 
            console.log(`[GameLogic] Client (P-ID ${playerIndexForMove}) making an optimistic move: ${type} ${r}-${c}`);
            const boxesMadeThisTurn = 0; 
            peerConnection.sendGameMoveToLeader(type, r, c, boxesMadeThisTurn);
            
            ui.setBoardClickable(false); 
            ui.updateMessageArea("Jugada enviada. Esperando al líder...", false, 0);
        }

    } else { // Local Game (human player making a move, as CPU moves are called via cpu.makeCpuMove -> gameLogic.processMove)
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

    // Turn validation: In local games (even vs CPU), or when leader is processing authoritatively,
    // the playerMakingMoveId must match the currentPlayerIndex.
    // isOptimisticUpdate is not currently used but could be for client-side prediction in network games.
    if ( (!state.pvpRemoteActive && !isOptimisticUpdate) || isLeaderProcessing ) {
        if (playerMakingMoveId !== state.currentPlayerIndex) {
            console.error(`[GameLogic processMove] Turn mismatch! Expected P-ID ${state.currentPlayerIndex}, got P-ID ${playerMakingMoveId}. Move ignored.`);
            // Potentially trigger error sound/haptic if this happens locally unexpectedly
            if(!state.pvpRemoteActive && sound.errorSound && typeof sound.playSound === 'function') {
                sound.playSound(sound.errorSound, undefined, "16n");
                if(typeof sound.triggerVibration === 'function') sound.triggerVibration([70,50,70]);
            }
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
    if(sound.lineSound && typeof sound.playSound === 'function') {
        sound.playSound(sound.lineSound, "C4", "32n");
        if(typeof sound.triggerVibration === 'function') sound.triggerVibration(50); // Haptic for line draw
    }


    const slotId = `slot-${type}-${r}-${c}`;
    const slotElement = document.getElementById(slotId);
    if (slotElement) {
        slotElement.style.fill = 'transparent';
        slotElement.removeEventListener('click', handleLineClickWrapper);
    }

    // Setup undo only for local human players' moves
    if (!state.pvpRemoteActive && !isOptimisticUpdate && !isLeaderProcessing && playerObject && !playerObject.isCpu) { 
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
        if(sound.boxSound && typeof sound.playSound === 'function') {
            sound.playSound(sound.boxSound, "A5", "16n", Tone.now() + 0.05);
            if(typeof sound.triggerVibration === 'function') sound.triggerVibration([60, 40, 60]); // Haptic for box completion
        }
        playerContinues = true;

        if (!isOptimisticUpdate) { // Don't show this for client's optimistic updates in network play
            const playerName = completingPlayer?.name || `Jugador ${playerMakingMoveId}`;
            ui.updateMessageArea(`¡${playerName} hizo ${boxesCompletedCount} cajita(s)! ¡Sigue jugando!`, false, 3000);
        }

        // If a human player scored in a local game, disable undo for this specific scoring move.
        if (!state.pvpRemoteActive && !isOptimisticUpdate && !isLeaderProcessing && playerObject && !playerObject.isCpu) {
            state.setLastMoveForUndo(null); 
            const undoBtn = document.getElementById('undo-btn');
            if (undoBtn) undoBtn.disabled = true;
        }
    }

    const gameOver = checkGameOver(); 

    if (gameOver) {
        if (!isOptimisticUpdate) { // Only announce winner authoritatively
            if (!state.pvpRemoteActive) { // Local game (CPU or all-human)
                announceWinner();
            } else if (isLeaderProcessing) { // Network game, leader processed the move
                console.log("[GameLogic processMove] Game over, processed by leader. Broadcast handled by peerConnection.");
                // peerConnection.js will send GAME_OVER_ANNOUNCEMENT
            }
        }
        ui.setBoardClickable(false);
        const undoBtn = document.getElementById('undo-btn');
        if (undoBtn && !state.pvpRemoteActive) undoBtn.disabled = true;
        
        return boxesCompletedCount;
    }

    // Turn Management & CPU Handling
    if (!isOptimisticUpdate) { // Authoritative turn change (local game or leader processing remote)
        if (!playerContinues) {
            endTurn(playerMakingMoveId); // Sets the next player's ID to state.currentPlayerIndex
        } else {
            state.setCurrentPlayerIndex(playerMakingMoveId); // Player scored, turn continues for them
        }
        ui.updatePlayerTurnDisplay(); // Update display for the new/continuing current player

        if (!state.pvpRemoteActive) { // Local game (all-human or vs-CPU)
            // cpu.handleTurnChange will check current player; if CPU, it makes a move. If human, enables board.
            cpu.handleTurnChange(); 
        }
        // For remote games, clickability and next turn flow are dictated by network messages and leader actions.
        // ui.setBoardClickable is handled by isMyTurn checks in network handlers.
    }
    return boxesCompletedCount;
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
    return affected.filter(b =>
        b.r >= 0 && b.r < (state.numRows - 1) &&
        b.c >= 0 && b.c < (state.numCols - 1)
    );
}

function checkForCompletedBoxes(lineType, lineR, lineC, playerFillingBoxId) {
    let boxesMadeThisTurn = 0;
    const check = (br_idx, bc_idx) => {
        if (br_idx < 0 || br_idx >= state.numRows - 1 || bc_idx < 0 || bc_idx >= state.numCols - 1) return false;

        if (state.boxes[br_idx]?.[bc_idx] === -1 && 
            state.horizontalLines[br_idx]?.[bc_idx] &&      
            state.horizontalLines[br_idx + 1]?.[bc_idx] &&  
            state.verticalLines[br_idx]?.[bc_idx] &&        
            state.verticalLines[br_idx]?.[bc_idx + 1]) {    
            
            ui.fillBoxOnBoard(br_idx, bc_idx, playerFillingBoxId);
            state.boxes[br_idx][bc_idx] = playerFillingBoxId; 
            boxesMadeThisTurn++;
            console.log(`[GameLogic] Box completed at (${br_idx}, ${bc_idx}) by player P-ID ${playerFillingBoxId}`);
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

/**
 * Sets the next player's turn. Does not handle CPU move initiation directly.
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
        console.error(`[GameLogic endTurn] Player with ID ${playerWhoseTurnEndedId} not found in playersData. Defaulting to first player.`);
        state.setCurrentPlayerIndex(state.playersData[0].id);
        // ui.updatePlayerTurnDisplay(); // Caller (processMove) will handle this
        return;
    }

    const nextPlayerArrayIndex = (currentPlayerArrayIndex + 1) % state.playersData.length;
    const nextPlayerId = state.playersData[nextPlayerArrayIndex].id;
    state.setCurrentPlayerIndex(nextPlayerId); // Crucially, update state.currentPlayerIndex

    const nextPlayerObject = state.playersData.find(p => p.id === nextPlayerId);
    console.log(`[GameLogic endTurn] P-ID ${playerWhoseTurnEndedId}'s turn ended. Next is P-ID ${state.currentPlayerIndex} (${nextPlayerObject?.name}).`);
    
    // Manage undo state for local human games
    if (!state.pvpRemoteActive) { 
        const endedPlayerObject = state.playersData.find(p => p.id === playerWhoseTurnEndedId);
        // Only clear undo state if the player whose turn just ended was human.
        // If it was a CPU, their move shouldn't have set up an undo state for a human to use.
        if (endedPlayerObject && !endedPlayerObject.isCpu) {
            state.setLastMoveForUndo(null); 
            const undoBtn = document.getElementById('undo-btn');
            if (undoBtn) undoBtn.disabled = true;
        }
        ui.updateMessageArea(''); 
    }
    // ui.updatePlayerTurnDisplay() is handled by the caller (processMove) after endTurn
}

export function handleUndo() {
    if (state.pvpRemoteActive || !state.gameActive || !state.lastMoveForUndo) {
        const undoBtn = document.getElementById('undo-btn');
        if (undoBtn) undoBtn.disabled = true; // Ensure it's disabled if conditions not met
        return;
    }
    // Additional check: ensure current player is human (main.js might already do this)
    const playerRequestingUndo = state.playersData.find(p => p.id === state.currentPlayerIndex);
    if (playerRequestingUndo && playerRequestingUndo.isCpu) {
        console.warn("[GameLogic handleUndo] Undo requested but current player is CPU. Ignoring.");
        return;
    }


    if(sound.undoSound && typeof sound.playSound === 'function') {
        sound.playSound(sound.undoSound, "E3", "16n");
        if(typeof sound.triggerVibration === 'function') sound.triggerVibration(40); // Haptic for undo
    }

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
            if (state.boxes[prevBoxState.r]?.[prevBoxState.c] === playerMakingMoveId && prevBoxState.player === -1) {
                state.boxes[prevBoxState.r][prevBoxState.c] = -1;
                ui.removeFilledBoxFromBoard(prevBoxState.r, prevBoxState.c);
                boxesRevertedCount++;
            }
        });
        state.incrementFilledBoxesCount(-boxesRevertedCount); 
    }
    const playerToUpdate = state.playersData.find(p => p.id === playerMakingMoveId);
    if(playerToUpdate) playerToUpdate.score = scoreBeforeThisMove; 

    ui.updateScoresDisplay();
    ui.updateMessageArea(`${playerToUpdate?.name || 'Jugador'}, ¡hacé tu jugada de nuevo!`);
    state.setLastMoveForUndo(null);
    const undoBtn = document.getElementById('undo-btn');
    if (undoBtn) undoBtn.disabled = true;

    state.setCurrentPlayerIndex(playerMakingMoveId); 
    ui.updatePlayerTurnDisplay();
    
    // After undo, ensure board is correctly set for the human player.
    // cpu.handleTurnChange will do this (set clickable if human, or trigger CPU if somehow it is CPU's turn).
    if (!state.pvpRemoteActive) {
        cpu.handleTurnChange();
    } else { // Should not happen in PvP as undo is disabled.
        ui.setBoardClickable(true); 
    }
}

function checkGameOver() {
    const isOver = state.totalPossibleBoxes > 0 && state.filledBoxesCount >= state.totalPossibleBoxes;
    if (isOver && state.gameActive) {
        console.log(`[GameLogic checkGameOver] Game Over! Filled: ${state.filledBoxesCount}, Total: ${state.totalPossibleBoxes}. Setting gameActive to false.`);
        state.setGameActive(false);
        cpu.cancelCpuMove(); // Cancel any CPU thinking if game ends
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
        } else if (player.score === maxScore && maxScore !== -1) { 
            winners.push({ name: player.name, icon: player.icon, score: player.score, id: player.id });
        }
    });
    const isTie = winners.length > 1 || (winners.length === 1 && state.playersData.length > 1 && state.playersData.every(p => p.score === winners[0].score));
    return { winners, maxScore, isTie: isTie && maxScore >=0 };
}

function announceWinner() {
    if (state.gameActive) { 
       console.warn("[GameLogic announceWinner] Called while game is still marked active. This might be premature.");
       state.setGameActive(false); // Ensure it's false
       cpu.cancelCpuMove();
    }
    const { winners, maxScore, isTie } = getWinnerData();
    let winnerMessage;
    let hapticPattern = null;

    if (winners.length === 0 && state.totalPossibleBoxes > 0 && state.filledBoxesCount >= state.totalPossibleBoxes) {
         winnerMessage = "¡Es un empate general! ¡Todas las cajitas han sido llenadas!";
         if(sound.tieSound && typeof sound.playSound === 'function') sound.playSound(sound.tieSound, ["C4", "E4", "G4"], "4n");
         hapticPattern = [80, 60, 80];
    } else if (maxScore === 0 && state.filledBoxesCount === state.totalPossibleBoxes && state.playersData.every(p => p.score === 0)) {
        winnerMessage = "¡Todas las cajitas llenas, pero fue un empate sin puntos! ¿Revancha?";
        if(sound.tieSound && typeof sound.playSound === 'function') sound.playSound(sound.tieSound, ["C4", "E4", "G4"], "4n");
        hapticPattern = [80, 60, 80];
    } else if (!isTie && winners.length === 1) {
        winnerMessage = `¡${winners[0].name} ${winners[0].icon || ''} ganó con ${maxScore} cajitas brillantes! ¡Bravo! 🥳`;
        if(sound.winSound && typeof sound.playSound === 'function') sound.playSound(sound.winSound, ["C4", "E4", "G4", "C5"], "2n");
        hapticPattern = [100, 50, 100, 50, 200];
    } else if (isTie && winners.length > 0) {
        const winnerNames = winners.map(p => `${p.name} ${p.icon || ''}`).join(' y ');
        winnerMessage = `¡Hay un súper empate entre ${winnerNames} con ${maxScore} cajitas cada uno! ¡Muy bien jugado! 🎉`;
        if(sound.tieSound && typeof sound.playSound === 'function') sound.playSound(sound.tieSound, ["D4", "F4", "A4"], "4n");
        hapticPattern = [90, 70, 90];
    } else {
        winnerMessage = "El juego ha terminado.";
        console.log("[GameLogic announceWinner] Game ended, but winner conditions were ambiguous.", {winners, maxScore, isTie});
    }

    if(hapticPattern && typeof sound.triggerVibration === 'function') {
        sound.triggerVibration(hapticPattern);
    }

    ui.showModalMessage(`¡Juego Terminado! ${winnerMessage}`);
    ui.updateMessageArea('');
    const mainTitle = document.getElementById('main-title');
    if (mainTitle && !state.pvpRemoteActive) mainTitle.textContent = "¿Jugar de Nuevo?";
    else if (mainTitle && state.pvpRemoteActive) mainTitle.textContent = "Partida Terminada";
}

export function applyRemoteMove(moveData, nextPlayerIdFromLeader, updatedScoresFromLeader) {
    // ... (This function is for network play, CPU logic primarily affects local games) ...
    // Ensure no CPU logic interferes here if applyRemoteMove is strictly for human vs human network play.
    // If network games could have CPUs (not current scope), this would need more thought.
    // For now, assume CPUs are local only.

    // ... (existing applyRemoteMove logic, haptics for line/box are already there) ...
    if (!state.pvpRemoteActive && !state.gameActive) { /* ... */ return; }
    // ...
    state.setCurrentPlayerIndex(nextPlayerIdFromLeader); 
    ui.updatePlayerTurnDisplay();
    const isGameOver = checkGameOver(); 
    if (isGameOver) {
        ui.setBoardClickable(false);
    } else {
        const isMyTurnNow = state.networkRoomData.myPlayerIdInRoom === state.currentPlayerIndex;
        ui.setBoardClickable(isMyTurnNow && state.gameActive);
        // ...
    }
}


export function applyFullState(remoteGameState) {
    // ... (This function is for network play state sync) ...
    // Similar to applyRemoteMove, assume no direct CPU interaction here for now.
    
    // ... (existing applyFullState logic, haptic for sync already there) ...

    if (state.gameActive) {
        const isMyTurn = state.networkRoomData.myPlayerIdInRoom === state.currentPlayerIndex;
        ui.setBoardClickable(isMyTurn);
        // ...
    } else {
        ui.setBoardClickable(false);
        // ...
    }
}


export function endGameAbruptly() {
    console.warn("[GameLogic] endGameAbruptly called.");
    cpu.cancelCpuMove(); // Make sure to cancel CPU move
    if (state.gameActive) {
        state.setGameActive(false);
        ui.updateMessageArea("El juego terminó inesperadamente.", true);
        ui.setBoardClickable(false);
        const undoBtn = document.getElementById('undo-btn');
        if (undoBtn && !state.pvpRemoteActive) undoBtn.disabled = true;
        state.setLastMoveForUndo(null);
        if(typeof sound.triggerVibration === 'function') sound.triggerVibration([50,30,50,30,50]); 
    }
}