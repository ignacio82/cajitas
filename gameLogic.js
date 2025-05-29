// gameLogic.js

import * as state from './state.js';
import * as ui from './ui.js';
import * as peerConnection from './peerConnection.js'; 
import * as sound from './sound.js'; 

export function initializeGame(isRemoteGame = false) {
    console.log(`[GameLogic] initializeGame called. Remote: ${isRemoteGame}. Current Player Index before init: ${state.currentPlayerIndex}`);
    
    if (!isRemoteGame) { 
        state.setGameDimensions(state.numRows, state.numCols); 
    } else { 
        state.setGameDimensions(state.numRows, state.numCols);
        console.log(`[GameLogic] Remote game. Dimensions: ${state.numRows}x${state.numCols}. Total Boxes: ${state.totalPossibleBoxes}`);
    }

    state.resetGameFlowState(isRemoteGame); 
    state.setGameActive(true);
    
    console.log(`[GameLogic] After resetGameFlowState, Current Player Index: ${state.currentPlayerIndex}, Players:`, JSON.stringify(state.playersData));

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

    console.log(`[GameLogic] Game initialized. Starting Player: ${state.playersData[state.currentPlayerIndex]?.name}. Is My Turn (if remote): ${state.pvpRemoteActive ? (state.networkRoomData.myPlayerIdInRoom === state.currentPlayerIndex) : 'N/A'}`);
}


export function resetGame(backToSetupScreen = true) { 
    console.log("[GameLogic] resetGame called. Back to setup:", backToSetupScreen);
    state.setGameActive(false);
    ui.clearBoardForNewGame();

    if (state.pvpRemoteActive) {
        console.warn("[GameLogic] resetGame called during active PvP. Primary reset control is with leader/room logic.");
        state.resetScores();
        state.resetGameFlowState(true); 
        ui.updateScoresDisplay();
    } else { 
        state.resetScores(); 
        state.resetGameFlowState(false); 
        if (backToSetupScreen) {
            // main.js will handle ui.showSetupScreen()
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
            return;
        }
        
        const boxesBefore = state.filledBoxesCount;
        let playerIndexForMove = state.networkRoomData.myPlayerIdInRoom; 

        if (state.networkRoomData.isRoomLeader) { 
            console.log(`[GameLogic] Host (P${playerIndexForMove}) making an authoritative move: ${type} ${r}-${c}`);
            processMove(type, r, c, playerIndexForMove, false, true); 
            const boxesMadeThisTurn = state.filledBoxesCount - boxesBefore;
            
            const moveDataForBroadcast = { type, r, c }; 
            peerConnection.handleLeaderLocalMove(moveDataForBroadcast, boxesMadeThisTurn);

            // Update leader's own board clickability based on whose turn it is now
            // processMove -> endTurn -> ui.updatePlayerTurnDisplay would have updated currentPlayerIndex
            // If it's still the leader's turn (they scored), it should remain clickable.
            const isStillMyTurn = state.currentPlayerIndex === playerIndexForMove;
            ui.setBoardClickable(isStillMyTurn && state.gameActive);
            if (!isStillMyTurn && state.gameActive) { // If turn passed to another player
                const nextPlayer = state.playersData[state.currentPlayerIndex];
                ui.updateMessageArea(`Esperando a ${nextPlayer?.name || 'otro jugador'}...`, false, 0);
            } else if (!state.gameActive) {
                ui.updateMessageArea("Juego terminado.", false, 0);
            }


        } else { // I AM A CLIENT making a move
            console.log(`[GameLogic] Client (P${playerIndexForMove}) making an optimistic move: ${type} ${r}-${c}`);
            processMove(type, r, c, playerIndexForMove, true, false); 
            const boxesMadeThisTurn = state.filledBoxesCount - boxesBefore;
            peerConnection.sendGameMoveToLeader(type, r, c, boxesMadeThisTurn); 
            
            ui.setBoardClickable(false); 
            ui.updateMessageArea("Jugada enviada. Esperando al líder...", false, 0); 
        }

    } else { // Local Game
        processMove(type, r, c, state.currentPlayerIndex, false, false); 
    }
}

export function processMove(type, r, c, playerIndex, isOptimisticUpdate = false, isLeaderProcessing = false) {
    // Allow processing if game is active OR if it's the leader processing what might be the game-ending move.
    if (!state.gameActive && !isLeaderProcessing && !isOptimisticUpdate) { 
        console.warn(`[GameLogic processMove] Called but game not active (and not leader/optimistic). Move: ${type} ${r}-${c} by P${playerIndex}.`);
        return 0;
    }
    
    console.log(`[GameLogic processMove] Line ${type} at (${r},${c}) by P${playerIndex} (${state.playersData[playerIndex]?.name}). Optimistic: ${isOptimisticUpdate}, Leader: ${isLeaderProcessing}. CurrentPlayerIdx: ${state.currentPlayerIndex}, GameActive: ${state.gameActive}`);

    // Authoritative check: In local games or when leader is processing, it must be the player's actual turn.
    if ( (!state.pvpRemoteActive && !isOptimisticUpdate) || isLeaderProcessing ) {
        if (playerIndex !== state.currentPlayerIndex) {
            console.error(`[GameLogic processMove] Turn mismatch! Expected P${state.currentPlayerIndex}, got P${playerIndex}. Move ignored.`);
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

    const lineElement = ui.drawVisualLineOnBoard(type, r, c, playerIndex);
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
            type, r, c, playerIndex, lineElement, slotElement,
            boxesCompletedBeforeThisMove: previousBoxStates,
            scoreBeforeThisMove: state.playersData[playerIndex]?.score ?? 0
        });
        const undoBtn = document.getElementById('undo-btn');
        if (undoBtn) undoBtn.disabled = false;
    }

    const boxesCompletedCount = checkForCompletedBoxes(type, r, c, playerIndex); 
    console.log(`[GameLogic processMove] Boxes completed this turn by P${playerIndex} (${state.playersData[playerIndex]?.name}): ${boxesCompletedCount}`);

    let playerContinues = false;
    if (boxesCompletedCount > 0) {
        state.updatePlayerScoreInGame(playerIndex, boxesCompletedCount); 
        state.incrementFilledBoxesCount(boxesCompletedCount);
        ui.updateScoresDisplay();
        if(sound.boxSound && typeof sound.playSound === 'function') sound.playSound(sound.boxSound, "A5", "16n", Tone.now() + 0.05); 
        playerContinues = true;

        if (!isOptimisticUpdate) { // Local game or leader processing
            const playerName = state.playersData[playerIndex]?.name || `Jugador ${playerIndex + 1}`;
            ui.updateMessageArea(`¡${playerName} hizo ${boxesCompletedCount} cajita(s)! ¡Sigue jugando!`, false, 3000);
        }

        if (!state.pvpRemoteActive && !isOptimisticUpdate && !isLeaderProcessing) { // Local game undo logic with scoring
            state.setLastMoveForUndo(null);
            const undoBtn = document.getElementById('undo-btn');
            if (undoBtn) undoBtn.disabled = true;
        }
    }

    // This check now also sets state.gameActive = false if game is over
    const gameOver = checkGameOver(); 

    if (gameOver) {
        if (!isOptimisticUpdate) { // Leader or local game handles end game announcement
            if (!state.pvpRemoteActive) { // Local game
                announceWinner();
            } else if (isLeaderProcessing) {
                // Leader will trigger GAME_OVER_ANNOUNCEMENT broadcast via handleLeaderLocalMove
                // or handleLeaderDataReception (if client's move ended the game)
                console.log("[GameLogic] Game over processed by leader. Broadcast will be handled by peerConnection.");
            }
        }
        ui.setBoardClickable(false); 
        const undoBtn = document.getElementById('undo-btn');
        if (undoBtn && !state.pvpRemoteActive) undoBtn.disabled = true;
        
        return boxesCompletedCount; 
    }

    // This block should only run for authoritative processing (local game or leader)
    // Client's optimistic updates do not change turns locally.
    if (!isOptimisticUpdate) { 
        if (!playerContinues) {
            endTurn(playerIndex); 
        } else {
            state.setCurrentPlayerIndex(playerIndex); // Player scored, turn continues for them
        }
        ui.updatePlayerTurnDisplay(); 

        if (!state.pvpRemoteActive) { // Local game
            ui.setBoardClickable(true);
        } else if (isLeaderProcessing) { 
            // For leader, board clickability if it's still their turn is handled by handleLineClickWrapper after this.
            // The broadcast will inform clients whose turn it is and they will set their own clickability.
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
    if (!state.gameActive) { // If game became inactive (e.g. game over), don't switch turns.
        console.log(`[GameLogic endTurn] Game not active, not switching turn from P${playerWhoseTurnEnded}.`);
        return;
    }

    const nextPlayerIndex = (playerWhoseTurnEnded + 1) % state.playersData.length;
    state.setCurrentPlayerIndex(nextPlayerIndex);
    console.log(`[GameLogic endTurn] P${playerWhoseTurnEnded}'s turn ended. Next is P${state.currentPlayerIndex} (${state.playersData[state.currentPlayerIndex]?.name}).`);
    
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
    if(sound.undoSound && typeof sound.playSound === 'function') sound.playSound(sound.undoSound, "E3", "16n");

    const { type, r, c, playerIndex, lineElement, slotElement, boxesCompletedBeforeThisMove, scoreBeforeThisMove } = state.lastMoveForUndo;
    console.log(`[GameLogic handleUndo] Reverting move by P${playerIndex}: ${type} at (${r},${c})`);

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
            if (state.boxes[prevBoxState.r]?.[prevBoxState.c] === playerIndex && prevBoxState.player === -1) {
                state.boxes[prevBoxState.r][prevBoxState.c] = -1; 
                ui.removeFilledBoxFromBoard(prevBoxState.r, prevBoxState.c); 
                boxesRevertedCount++;
            }
        });
        state.incrementFilledBoxesCount(-boxesRevertedCount);
    }
    if(state.playersData[playerIndex]) state.playersData[playerIndex].score = scoreBeforeThisMove;

    ui.updateScoresDisplay();
    ui.updateMessageArea(`${state.playersData[playerIndex]?.name}, ¡hacé tu jugada de nuevo!`);
    state.setLastMoveForUndo(null);
    const undoBtn = document.getElementById('undo-btn');
    if (undoBtn) undoBtn.disabled = true;

    state.setCurrentPlayerIndex(playerIndex); 
    ui.updatePlayerTurnDisplay();
    ui.setBoardClickable(true);
}

function checkGameOver() {
    const isOver = state.totalPossibleBoxes > 0 && state.filledBoxesCount >= state.totalPossibleBoxes;
    if (isOver && state.gameActive) { // Only set gameActive to false once
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
    // A tie occurs if there's more than one winner OR if all players have 0 and all boxes are filled (maxScore would be 0)
    // but usually a tie is among those with the highest score, provided that score isn't a baseline like 0 unless it's the only possibility.
    const isTie = winners.length > 1 || (winners.length === 1 && state.playersData.length > 1 && state.playersData.every(p => p.score === winners[0].score));
    return { winners, maxScore, isTie: isTie && maxScore >=0 }; // Ensure maxScore is non-negative for a valid tie/win scenario
}

function announceWinner() { // Called locally or by leader's end-game logic
    if (state.gameActive) { // Should not announce if game is still marked active by logic
        console.warn("[GameLogic announceWinner] Called while game is still marked active. This might be premature.");
       // return; // Or proceed if this is the definitive end.
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
    } else if (isTie && winners.length > 0) { // Ensure there's at least one winner for a tie message
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

export function applyRemoteMove(moveData, nextPlayerIndexFromLeader, updatedScoresFromLeader) {
    if (!state.pvpRemoteActive ) { // Allow applying move even if game locally marked inactive, to sync final state
        console.warn(`[GameLogic applyRemoteMove] Ignoring. PVP not active.`);
        return;
    }
    if (!state.gameActive && state.filledBoxesCount >= state.totalPossibleBoxes) {
        console.log("[GameLogic applyRemoteMove] Game already ended locally, but applying remote move possibly for final sync.");
    }
    
    const { type, r, c, playerIndex: moverPlayerIndex } = moveData; 
    console.log(`[GameLogic applyRemoteMove] Applying remote move: ${type} at (${r},${c}) by P${moverPlayerIndex}. Next turn: P${nextPlayerIndexFromLeader}. My local PId: ${state.networkRoomData.myPlayerIdInRoom}.`);

    // Avoid re-processing if line already exists (can happen with re-syncs)
    const lineAlreadyExists = (type === 'h' && state.horizontalLines[r]?.[c]) || (type === 'v' && state.verticalLines[r]?.[c]);

    if (!lineAlreadyExists) {
        if (type === 'h') state.horizontalLines[r][c] = 1;
        else state.verticalLines[r][c] = 1;
        ui.drawVisualLineOnBoard(type, r, c, moverPlayerIndex);
        if(sound.lineSound && typeof sound.playSound === 'function') sound.playSound(sound.lineSound, "C4", "32n");
        const slotId = `slot-${type}-${r}-${c}`;
        const slotElement = document.getElementById(slotId);
        if (slotElement) {
            slotElement.removeEventListener('click', handleLineClickWrapper);
            slotElement.style.fill = 'transparent';
        }
    } else {
        console.log(`[GameLogic applyRemoteMove] Line ${type}-${r}-${c} already exists locally. Skipping draw.`);
    }


    // Boxes are filled based on the new line, even if the line itself was a duplicate (state should catch up).
    const boxesCompletedLocally = checkForCompletedBoxes(type, r, c, moverPlayerIndex);
    if (boxesCompletedLocally > 0 && !lineAlreadyExists) { // Only play box sound if this move actually made it happen now
        if(sound.boxSound && typeof sound.playSound === 'function') sound.playSound(sound.boxSound, "A5", "16n", Tone.now() + 0.05);
    }
    
    if (updatedScoresFromLeader) {
        updatedScoresFromLeader.forEach(ps => {
            const playerToUpdate = state.playersData.find(p => p.id === ps.id);
            if (playerToUpdate) playerToUpdate.score = ps.score;
        });
        let newFilledCount = 0;
        for(let br=0; br < state.numRows-1; br++){
            for(let bc=0; bc < state.numCols-1; bc++){
                if(state.boxes[br][bc] !== -1) newFilledCount++;
            }
        }
        state.setFilledBoxesCount(newFilledCount); // Crucial to sync filledBoxesCount
        ui.updateScoresDisplay();
    }

    state.setCurrentPlayerIndex(nextPlayerIndexFromLeader);
    ui.updatePlayerTurnDisplay();

    const isGameOver = checkGameOver(); // This will set state.gameActive = false if game over

    if (isGameOver) { 
        ui.setBoardClickable(false);
        // Client waits for GAME_OVER_ANNOUNCEMENT message for modal.
        console.log("[GameLogic applyRemoteMove] Game is over after applying remote move.");
    } else {
        const isMyTurnNow = state.networkRoomData.myPlayerIdInRoom === state.currentPlayerIndex;
        ui.setBoardClickable(isMyTurnNow && state.gameActive); // Game must be active for board to be clickable
        if (isMyTurnNow && state.gameActive) { 
            ui.updateMessageArea("¡Tu turno!", false, 3000);
        } else if (state.gameActive) { 
            const currentPlayerName = state.playersData[state.currentPlayerIndex]?.name || `Jugador ${state.currentPlayerIndex +1}`;
            ui.updateMessageArea(`Esperando a ${currentPlayerName}...`, false, 0); 
        } else if (!state.gameActive) {
            ui.updateMessageArea("El juego ha terminado.", false, 0);
        }
    }
}

export function applyFullState(remoteGameState) {
    if (!state.pvpRemoteActive) {
        console.warn("[GameLogic applyFullState] Not in PVP remote mode, ignoring.");
        return;
    }
    
    console.log("[GameLogic applyFullState] Applying full remote state. My local Player ID:", state.networkRoomData.myPlayerIdInRoom);

    state.setGameDimensions(remoteGameState.gameSettings.rows, remoteGameState.gameSettings.cols);
    state.setPlayersData(remoteGameState.playersInGameOrder.map(p => ({...p}))); 
    
    state.setHorizontalLines(remoteGameState.horizontalLines.map(row => [...row]));
    state.setVerticalLines(remoteGameState.verticalLines.map(row => [...row]));
    state.setBoxes(remoteGameState.boxes.map(row => [...row]));
    state.setFilledBoxesCount(remoteGameState.filledBoxesCount);
    state.setCurrentPlayerIndex(remoteGameState.currentPlayerIndex);
    state.setGameActive(remoteGameState.gameActive); 

    ui.clearBoardForNewGame();
    ui.drawBoardSVG();
    addSlotListeners(); 

    state.horizontalLines.forEach((row, r_idx) => {
        row.forEach((val, c_idx) => {
            if (val) { 
                const lineOwnerPlayerIndex = findLineOwnerForRedraw(r_idx, c_idx, 'h', remoteGameState.boxes, remoteGameState.playersInGameOrder);
                ui.drawVisualLineOnBoard('h', r_idx, c_idx, lineOwnerPlayerIndex);
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
                const lineOwnerPlayerIndex = findLineOwnerForRedraw(r_idx, c_idx, 'v', remoteGameState.boxes, remoteGameState.playersInGameOrder);
                ui.drawVisualLineOnBoard('v', r_idx, c_idx, lineOwnerPlayerIndex);
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
    
    ui.updateScoresDisplay();
    ui.updatePlayerTurnDisplay();

    if (state.gameActive) {
        const isMyTurn = state.networkRoomData.myPlayerIdInRoom === state.currentPlayerIndex;
        ui.setBoardClickable(isMyTurn);
        if(isMyTurn) ui.updateMessageArea("¡Tu turno! (Estado Sincronizado)"); else ui.updateMessageArea("Esperando al oponente... (Estado Sincronizado)", false, 0);
    } else { 
        ui.setBoardClickable(false);
        if (state.filledBoxesCount >= state.totalPossibleBoxes && state.totalPossibleBoxes > 0) {
            const winnerData = getWinnerData(); // Use local getWinnerData for display
            ui.showModalMessage(`Juego terminado. ${winnerData.winners.map(w=>w.name).join(', ')} ganó.`);
        } else {
            ui.updateMessageArea("Juego sincronizado. Esperando acción o finalización...");
        }
    }
    console.log(`[GameLogic applyFullState] Full state applied. Is my turn? ${state.networkRoomData.myPlayerIdInRoom === state.currentPlayerIndex}`);
}

function findLineOwnerForRedraw(r, c, type, boxesState, playersList) {
    const defaultPlayerId = (playersList && playersList.length > 0) ? playersList[0].id : 0; 

    const adjBoxes = getPotentiallyAffectedBoxes(type, r, c);
    for (const boxCoords of adjBoxes) {
        const boxOwnerId = boxesState[boxCoords.r]?.[boxCoords.c];
        if (boxOwnerId !== undefined && boxOwnerId !== -1) {
            if (playersList.some(p => p.id === boxOwnerId)) return boxOwnerId;
        }
    }
    return defaultPlayerId; 
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