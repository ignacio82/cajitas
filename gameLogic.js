// gameLogic.js

import * as state from './state.js';
import * as ui from './ui.js';
import * as peerConnection from './peerConnection.js';
import * as sound from './sound.js'; // Ensure sound is imported to use sound.triggerVibration

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
    // Consider a gentle haptic for game start, perhaps handled in main.js where gameStartSound is played.
}


export function resetGame(backToSetupScreen = true) {
    console.log("[GameLogic] resetGame called. Back to setup:", backToSetupScreen);
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
            if(typeof sound.triggerVibration === 'function') sound.triggerVibration([70, 50, 70]); // Haptic for error/invalid turn
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

    if (!state.pvpRemoteActive && !isOptimisticUpdate && !isLeaderProcessing) { 
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

        if (!isOptimisticUpdate) {
            const playerName = completingPlayer?.name || `Jugador ${playerMakingMoveId}`;
            ui.updateMessageArea(`¡${playerName} hizo ${boxesCompletedCount} cajita(s)! ¡Sigue jugando!`, false, 3000);
        }

        if (!state.pvpRemoteActive && !isOptimisticUpdate && !isLeaderProcessing) {
            state.setLastMoveForUndo(null); 
            const undoBtn = document.getElementById('undo-btn');
            if (undoBtn) undoBtn.disabled = true;
        }
    }

    const gameOver = checkGameOver(); 

    if (gameOver) {
        if (!isOptimisticUpdate) {
            if (!state.pvpRemoteActive) { 
                announceWinner();
            } else if (isLeaderProcessing) {
                console.log("[GameLogic processMove] Game over, processed by leader. Broadcast handled by peerConnection.");
            }
        }
        ui.setBoardClickable(false);
        const undoBtn = document.getElementById('undo-btn');
        if (undoBtn && !state.pvpRemoteActive) undoBtn.disabled = true;
        
        return boxesCompletedCount;
    }

    if (!isOptimisticUpdate) { 
        if (!playerContinues) {
            endTurn(playerMakingMoveId); 
        } else {
            state.setCurrentPlayerIndex(playerMakingMoveId); 
        }
        ui.updatePlayerTurnDisplay();

        if (!state.pvpRemoteActive) { 
            ui.setBoardClickable(true);
        }
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
        state.setCurrentPlayerIndex(state.playersData[0].id);
        ui.updatePlayerTurnDisplay();
        return;
    }

    const nextPlayerArrayIndex = (currentPlayerArrayIndex + 1) % state.playersData.length;
    const nextPlayerId = state.playersData[nextPlayerArrayIndex].id;
    state.setCurrentPlayerIndex(nextPlayerId);

    const nextPlayerObject = state.playersData.find(p => p.id === nextPlayerId);
    console.log(`[GameLogic endTurn] P-ID ${playerWhoseTurnEndedId}'s turn ended. Next is P-ID ${state.currentPlayerIndex} (${nextPlayerObject?.name}).`);
    
    if (!state.pvpRemoteActive) { 
        state.setLastMoveForUndo(null); 
        const undoBtn = document.getElementById('undo-btn');
        if (undoBtn) undoBtn.disabled = true;
        ui.updateMessageArea(''); 
    }
}

export function handleUndo() {
    if (state.pvpRemoteActive || !state.gameActive || !state.lastMoveForUndo) {
        const undoBtn = document.getElementById('undo-btn');
        if (undoBtn) undoBtn.disabled = true;
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
        winnerMessage = `¡${winners[0].name} ${winners[0].icon} ganó con ${maxScore} cajitas brillantes! ¡Bravo! 🥳`;
        if(sound.winSound && typeof sound.playSound === 'function') sound.playSound(sound.winSound, ["C4", "E4", "G4", "C5"], "2n");
        hapticPattern = [100, 50, 100, 50, 200];
    } else if (isTie && winners.length > 0) {
        const winnerNames = winners.map(p => `${p.name} ${p.icon}`).join(' y ');
        winnerMessage = `¡Hay un súper empate entre ${winnerNames} con ${maxScore} cajitas cada uno! ¡Muy bien jugado! 🎉`;
        if(sound.tieSound && typeof sound.playSound === 'function') sound.playSound(sound.tieSound, ["D4", "F4", "A4"], "4n");
        hapticPattern = [90, 70, 90];
    } else {
        winnerMessage = "El juego ha terminado.";
        console.log("[GameLogic announceWinner] Game ended, but winner conditions were ambiguous.", {winners, maxScore, isTie});
        // No specific win/tie sound, maybe a generic game end sound/haptic if desired
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
    if (!state.pvpRemoteActive && !state.gameActive) {
        console.warn(`[GameLogic applyRemoteMove] Ignoring. Not PVP or game not active locally. Active: ${state.gameActive}, PVP: ${state.pvpRemoteActive}`);
        return;
    }
    if (!state.gameActive && state.filledBoxesCount >= state.totalPossibleBoxes) {
        console.log("[GameLogic applyRemoteMove] Game already ended locally, but applying remote move possibly for final sync.");
    }
    
    const { type, r, c, playerIndex: moverPlayerId } = moveData; 
    const moverPlayerObject = state.playersData.find(p => p.id === moverPlayerId);
    const nextPlayerObject = state.playersData.find(p => p.id === nextPlayerIdFromLeader);

    console.log(`[GameLogic applyRemoteMove] Applying remote move: ${type} at (${r},${c}) by P-ID ${moverPlayerId} (${moverPlayerObject?.name}). Next turn P-ID: ${nextPlayerIdFromLeader} (${nextPlayerObject?.name}). My local P-ID: ${state.networkRoomData.myPlayerIdInRoom}.`);

    const lineAlreadyExists = (type === 'h' && state.horizontalLines[r]?.[c]) || (type === 'v' && state.verticalLines[r]?.[c]);

    if (!lineAlreadyExists) {
        if (type === 'h') state.horizontalLines[r][c] = 1;
        else state.verticalLines[r][c] = 1;
        ui.drawVisualLineOnBoard(type, r, c, moverPlayerId);
        if(sound.lineSound && typeof sound.playSound === 'function') {
            sound.playSound(sound.lineSound, "C4", "32n");
            if(typeof sound.triggerVibration === 'function') sound.triggerVibration(50); // Haptic for line
        }
        const slotId = `slot-${type}-${r}-${c}`;
        const slotElement = document.getElementById(slotId);
        if (slotElement) {
            slotElement.removeEventListener('click', handleLineClickWrapper);
            slotElement.style.fill = 'transparent';
        }
    } else {
        console.log(`[GameLogic applyRemoteMove] Line ${type}-${r}-${c} by P-ID ${moverPlayerId} already exists locally. Skipping draw.`);
    }

    const boxesCompletedLocally = checkForCompletedBoxes(type, r, c, moverPlayerId); 
    if (boxesCompletedLocally > 0 && !lineAlreadyExists) { // Only play sound/haptic if line was new for this client
        if(sound.boxSound && typeof sound.playSound === 'function') {
            sound.playSound(sound.boxSound, "A5", "16n", Tone.now() + 0.05);
            if(typeof sound.triggerVibration === 'function') sound.triggerVibration([60, 40, 60]); // Haptic for box
        }
    }
    
    if (updatedScoresFromLeader) {
        updatedScoresFromLeader.forEach(ps => {
            const playerToUpdate = state.playersData.find(p => p.id === ps.id);
            if (playerToUpdate) playerToUpdate.score = ps.score;
        });
        let newFilledCount = 0;
        for(let br=0; br < state.numRows-1; br++){
            for(let bc=0; bc < state.numCols-1; bc++){
                if(state.boxes[br]?.[bc] !== -1) newFilledCount++;
            }
        }
        state.setFilledBoxesCount(newFilledCount);
        ui.updateScoresDisplay();
    }

    state.setCurrentPlayerIndex(nextPlayerIdFromLeader); 
    ui.updatePlayerTurnDisplay();

    const isGameOver = checkGameOver(); 

    if (isGameOver) {
        ui.setBoardClickable(false);
        console.log("[GameLogic applyRemoteMove] Game is over after applying remote move. Client awaits GAME_OVER_ANNOUNCEMENT for modal & final haptics.");
        // Winner haptics will be triggered by GAME_OVER_ANNOUNCEMENT handler in peerConnection.js if that calls announceWinner or similar.
        // For now, announceWinner is local. If GAME_OVER_ANNOUNCEMENT triggers a modal, that's where haptics could go.
    } else {
        const isMyTurnNow = state.networkRoomData.myPlayerIdInRoom === state.currentPlayerIndex;
        console.log(`[GameLogic applyRemoteMove] Is it my turn now? ${isMyTurnNow} (My ID: ${state.networkRoomData.myPlayerIdInRoom}, Current Turn P-ID: ${state.currentPlayerIndex})`);
        ui.setBoardClickable(isMyTurnNow && state.gameActive);
        if (isMyTurnNow && state.gameActive) {
            ui.updateMessageArea("¡Tu turno!", false, 3000);
        } else if (state.gameActive) {
            const currentPlayerName = state.playersData.find(p => p.id === state.currentPlayerIndex)?.name || `Jugador ${state.currentPlayerIndex}`;
            ui.updateMessageArea(`Esperando a ${currentPlayerName}...`, false, 0);
        } else if (!state.gameActive && !isGameOver) { 
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
    state.setPlayersData(remoteGameState.playersInGameOrder.map(p => ({...p}))); 
    
    state.setHorizontalLines(remoteGameState.horizontalLines.map(row => [...row]));
    state.setVerticalLines(remoteGameState.verticalLines.map(row => [...row]));
    state.setBoxes(remoteGameState.boxes.map(row => [...row])); 
    state.setFilledBoxesCount(remoteGameState.filledBoxesCount);
    state.setCurrentPlayerIndex(remoteGameState.currentPlayerIndex); 
    state.setGameActive(remoteGameState.gameActive);
    state.networkRoomData.turnCounter = remoteGameState.turnCounter; 

    ui.clearBoardForNewGame();
    ui.drawBoardSVG(); 
    addSlotListeners(); 

    state.horizontalLines.forEach((row, r_idx) => {
        row.forEach((val, c_idx) => {
            if (val) {
                ui.drawVisualLineOnBoard('h', r_idx, c_idx, remoteGameState.currentPlayerIndex); 
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

    state.boxes.forEach((row, r_idx) => {
        row.forEach((playerOwnerId, c_idx) => { 
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
        if(typeof sound.triggerVibration === 'function') sound.triggerVibration(30); // Small vibration for state sync
    } else {
        ui.setBoardClickable(false);
        if (state.filledBoxesCount >= state.totalPossibleBoxes && state.totalPossibleBoxes > 0) {
            console.log("[GameLogic applyFullState] Synced to a game over state.");
            // Haptics for game over would be handled by GAME_OVER_ANNOUNCEMENT typically.
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
        if(typeof sound.triggerVibration === 'function') sound.triggerVibration([50,30,50,30,50]); // Haptic for abrupt end
    }
}