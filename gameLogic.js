// gameLogic.js

import * as state from './state.js';
import * as ui from './ui.js';
import * as peerConnection from './peerConnection.js'; // To send moves if client
import * as sound from './sound.js'; // For sound effects

/**
 * Initializes the game. Sets up the board, players, and initial state.
 * @param {boolean} isRemoteGame - True if this is a network game being initialized/synced.
 */
export function initializeGame(isRemoteGame = false) {
    console.log(`[GameLogic] initializeGame called. Remote: ${isRemoteGame}. Current Player Index before init: ${state.currentPlayerIndex}`);
    
    if (!isRemoteGame) { // For local games, setup is driven by UI inputs directly here.
        // state.playersData should have been set by main.js from UI.
        // state.numRows and state.numCols also from UI.
        state.setGameDimensions(state.numRows, state.numCols); // Ensure totalPossibleBoxes is calculated
    } else { // For remote games, state.playersData and dimensions are set by peerConnection from leader's data.
        // Ensure totalPossibleBoxes is calculated based on synced dimensions.
        state.setGameDimensions(state.numRows, state.numCols);
        console.log(`[GameLogic] Remote game. Dimensions: ${state.numRows}x${state.numCols}. Total Boxes: ${state.totalPossibleBoxes}`);
    }

    // Reset core game flow variables (scores are reset if needed by caller, or handled by setPlayersData)
    state.resetGameFlowState(isRemoteGame); // Initializes board arrays, filledBoxesCount, currentPlayerIndex (to 0 initially)
    state.setGameActive(true);
    
    console.log(`[GameLogic] After resetGameFlowState, Current Player Index: ${state.currentPlayerIndex}, Players:`, JSON.stringify(state.playersData));


    ui.drawBoardSVG();
    addSlotListeners(); // Add listeners to the newly drawn board slots

    ui.updateScoresDisplay(); // Uses state.playersData
    ui.updatePlayerTurnDisplay(); // Uses state.currentPlayerIndex and state.playersData
    ui.updateMessageArea('');
    // ui.showGameScreen(); // Caller (main.js or peerConnection) handles screen transition

    if (isRemoteGame) {
        const isMyTurn = state.networkRoomData.myPlayerIdInRoom === state.currentPlayerIndex;
        ui.setBoardClickable(isMyTurn && state.gameActive);
    } else {
        ui.setBoardClickable(state.gameActive);
    }

    if (ui.undoBtn) ui.undoBtn.disabled = isRemoteGame || !state.lastMoveForUndo;

    console.log(`[GameLogic] Game initialized. Starting Player: ${state.playersData[state.currentPlayerIndex]?.name}. Is My Turn (if remote): ${state.pvpRemoteActive ? (state.networkRoomData.myPlayerIdInRoom === state.currentPlayerIndex) : 'N/A'}`);
}


export function resetGame(backToSetupScreen = true) { // "backToSetupScreen" implies full local reset
    console.log("[GameLogic] resetGame called. Back to setup:", backToSetupScreen);
    state.setGameActive(false);
    ui.clearBoardForNewGame();

    if (state.pvpRemoteActive) {
        // In a network game, "reset" is complex.
        // If leader: Could mean re-initializing the game for everyone (needs new message flow).
        // If client: Could mean requesting a reset from leader.
        // For now, this button in a network game context will be handled by main.js to "Leave Room".
        // This function, if called during a network game, assumes local state cleanup.
        console.warn("[GameLogic] resetGame called during active PvP. Primary reset control is with leader/room logic.");
        // Local cleanup is mostly covered by stopAnyActiveGameOrNetworkSession in main.js
        // If called to reset *within* an ongoing network game (e.g. new round after game over)
        // then gameActive = true, scores reset, board cleared, leader dictates start.
        state.resetScores();
        state.resetGameFlowState(true); // true for network context reset of board etc.
        ui.updateScoresDisplay();
        // Leader would then re-broadcast GAME_STARTED or similar.
    } else { // Local game reset
        state.resetScores(); // Scores to 0
        state.resetGameFlowState(false); // Resets board, currentPlayerIndex, etc.
        // playersData names/icons/colors persist for local game unless going back to setup.
        if (backToSetupScreen) {
            // main.js will handle ui.showSetupScreen()
        } else {
            // Re-initialize for a new local game with same players/settings
            initializeGame(false);
        }
    }
}

function addSlotListeners() {
    const slots = ui.gameBoardSVG?.querySelectorAll('.line-slot');
    slots?.forEach(slot => {
        slot.removeEventListener('click', handleLineClickWrapper); // Remove old if any
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

    if (state.pvpRemoteActive) { // Network Game
        if (state.networkRoomData.myPlayerIdInRoom !== state.currentPlayerIndex) {
            ui.updateMessageArea("¡Ey! No es tu turno.", true);
            sound.playSound(sound.errorSound, undefined, "16n");
            return;
        }
        // It's my turn in a network game. Process optimistically, then send to leader.
        const boxesBefore = state.filledBoxesCount;
        processMove(type, r, c, state.currentPlayerIndex, true, false); // isOptimisticUpdate=true, isLeaderProcessing=false
        const boxesMadeThisTurn = state.filledBoxesCount - boxesBefore;

        peerConnection.sendGameMoveToLeader(type, r, c, boxesMadeThisTurn); // Send actual move to leader
        // UI for whose turn it is will be updated when leader confirms and broadcasts.
        // Optimistic update already changed board. If player scored, their turn *might* continue.
        // For now, make board unclickable until leader confirms next turn.
        ui.setBoardClickable(false);
        ui.updateMessageArea("Jugada enviada. Esperando al líder...", false, 0);


    } else { // Local Game
        processMove(type, r, c, state.currentPlayerIndex, false, false); // Not optimistic, not leader
    }
}

/**
 * Processes a game move.
 * @param {string} type - 'h' or 'v' for line type.
 * @param {number} r - Row index.
 * @param {number} c - Column index.
 * @param {number} playerIndex - The ID of the player making the move.
 * @param {boolean} isOptimisticUpdate - True if this is a client's optimistic local update in a network game.
 * @param {boolean} isLeaderProcessing - True if this is the leader authoritatively processing a move.
 * @returns {number} Number of boxes completed by this move.
 */
export function processMove(type, r, c, playerIndex, isOptimisticUpdate = false, isLeaderProcessing = false) {
    if (!state.gameActive && !isLeaderProcessing) { // Leader might process a final move that ends game
        console.warn(`[GameLogic processMove] Called but game not active. Move: ${type} ${r}-${c} by P${playerIndex}. Optimistic: ${isOptimisticUpdate}, Leader: ${isLeaderProcessing}`);
        return 0;
    }
    
    console.log(`[GameLogic processMove] Line ${type} at (${r},${c}) by P${playerIndex}. Optimistic: ${isOptimisticUpdate}, Leader: ${isLeaderProcessing}. Current state.currentPlayerIndex: ${state.currentPlayerIndex}`);

    // --- 1. Validate player turn (if not optimistic client update) ---
    // For leader processing or local games, playerIndex must match current turn.
    if ((isLeaderProcessing || (!state.pvpRemoteActive && !isOptimisticUpdate)) && playerIndex !== state.currentPlayerIndex) {
        console.error(`[GameLogic processMove] Turn mismatch! Expected P${state.currentPlayerIndex}, got P${playerIndex}. Move ignored.`);
        return 0;
    }

    // --- 2. Update Line State ---
    if (type === 'h') {
        if(state.horizontalLines[r]?.[c]) {
            console.warn(`[GameLogic processMove] Horiz line ${r}-${c} already drawn. Aborting.`);
            return 0;
        }
        state.horizontalLines[r][c] = 1;
    } else { // 'v'
        if(state.verticalLines[r]?.[c]) {
            console.warn(`[GameLogic processMove] Vert line ${r}-${c} already drawn. Aborting.`);
            return 0;
        }
        state.verticalLines[r][c] = 1;
    }

    // --- 3. Update UI (Draw Line) ---
    const lineElement = ui.drawVisualLineOnBoard(type, r, c, playerIndex);
    sound.playSound(sound.lineSound, "C4", "32n");

    const slotId = `slot-${type}-${r}-${c}`;
    const slotElement = document.getElementById(slotId);
    if (slotElement) {
        slotElement.style.fill = 'transparent'; // Visually mark as used
        slotElement.removeEventListener('click', handleLineClickWrapper); // Prevent further clicks
    }

    // --- 4. Store for Undo (Local Games Only) ---
    if (!state.pvpRemoteActive && !isOptimisticUpdate && !isLeaderProcessing) {
        const boxesPotentiallyAffected = getPotentiallyAffectedBoxes(type, r, c); // Helper needed
        const previousBoxStates = boxesPotentiallyAffected.map(box => ({
            r: box.r, c: box.c, player: state.boxes[box.r]?.[box.c] ?? -1
        }));
        state.setLastMoveForUndo({
            type, r, c, playerIndex, lineElement, slotElement,
            boxesCompletedBeforeThisMove: previousBoxStates,
            scoreBeforeThisMove: state.playersData[playerIndex]?.score ?? 0
        });
        if (ui.undoBtn) ui.undoBtn.disabled = false;
    }

    // --- 5. Check for Completed Boxes & Update Scores/UI ---
    const boxesCompletedCount = checkForCompletedBoxes(type, r, c, playerIndex); // Also updates state.boxes and UI for boxes
    console.log(`[GameLogic processMove] Boxes completed this turn by P${playerIndex}: ${boxesCompletedCount}`);

    let playerContinues = false;
    if (boxesCompletedCount > 0) {
        state.updatePlayerScoreInGame(playerIndex, boxesCompletedCount); // Updates state.playersData & networkRoomData if leader
        state.incrementFilledBoxesCount(boxesCompletedCount);
        ui.updateScoresDisplay();
        sound.playSound(sound.boxSound, "A5", "16n", Tone.now() + 0.05); // Slightly delayed
        playerContinues = true;

        if (!isOptimisticUpdate) { // For local games or leader processing
            ui.updateMessageArea(`¡${state.playersData[playerIndex]?.name} hizo ${boxesCompletedCount} cajita(s)! ¡Sigue jugando!`);
        }

        // In local games, if a box is made, undo is disabled for that specific scoring move chain.
        if (!state.pvpRemoteActive && !isOptimisticUpdate && !isLeaderProcessing) {
            state.setLastMoveForUndo(null);
            if (ui.undoBtn) ui.undoBtn.disabled = true;
        }
    }

    // --- 6. Check for Game Over ---
    if (checkGameOver()) {
        if (!isOptimisticUpdate) { // Leader or local game announces winner
            announceWinner();
        }
        state.setGameActive(false);
        if (ui.undoBtn && !state.pvpRemoteActive) ui.undoBtn.disabled = true;
        if (!isOptimisticUpdate) ui.setBoardClickable(false);
        // Leader will broadcast game over state.
        return boxesCompletedCount; // Return boxes made, even if game ends
    }

    // --- 7. Determine Next Player (if not an optimistic update) ---
    if (!isOptimisticUpdate) { // Local game or Leader processing
        if (!playerContinues) {
            endTurn(playerIndex); // This updates state.currentPlayerIndex
        } else {
            // Player scored, their turn continues. currentPlayerIndex remains playerIndex.
            state.setCurrentPlayerIndex(playerIndex); // Explicitly set for clarity
             // Message already set above for scoring.
        }
        ui.updatePlayerTurnDisplay();

        // Update board clickability based on current player (relevant for local, leader handles broadcast for remote)
        if (state.pvpRemoteActive && isLeaderProcessing) {
            // Leader's context: board clickability is for leader's own UI interaction (if any)
            // Actual client clickability is set by leader's broadcast.
            // No direct ui.setBoardClickable here for leader based on its own turn,
            // as leader isn't "playing" against UI in the same way.
        } else if (!state.pvpRemoteActive) { // Local game
            ui.setBoardClickable(true);
        }
    }
    // For optimistic updates, client doesn't change turn; leader dictates.
    return boxesCompletedCount;
}


function getPotentiallyAffectedBoxes(lineType, lineR, lineC) {
    const affected = [];
    // For a horizontal line at (lineR, lineC)
    if (lineType === 'h') {
        // Box "below" the line (if one exists)
        if (lineR < state.numRows - 1) affected.push({ r: lineR, c: lineC });
        // Box "above" the line (if one exists)
        if (lineR > 0) affected.push({ r: lineR - 1, c: lineC });
    }
    // For a vertical line at (lineR, lineC)
    else { // lineType === 'v'
        // Box to the "right" of the line (if one exists)
        if (lineC < state.numCols - 1) affected.push({ r: lineR, c: lineC });
        // Box to the "left" of the line (if one exists)
        if (lineC > 0) affected.push({ r: lineR, c: lineC - 1 });
    }
    // Filter out out-of-bounds boxes (shouldn't happen with correct logic but good safeguard)
    return affected.filter(b =>
        b.r >= 0 && b.r < (state.numRows - 1) &&
        b.c >= 0 && b.c < (state.numCols - 1)
    );
}


function checkForCompletedBoxes(lineType, lineR, lineC, playerIndex) {
    let boxesMadeThisTurn = 0;
    const check = (br_idx, bc_idx) => { // br_idx, bc_idx are top-left of the box
        if (br_idx < 0 || br_idx >= state.numRows - 1 || bc_idx < 0 || bc_idx >= state.numCols - 1) return false;

        if (state.boxes[br_idx]?.[bc_idx] === -1 && // Box not already completed
            state.horizontalLines[br_idx]?.[bc_idx] &&      // Top edge
            state.horizontalLines[br_idx + 1]?.[bc_idx] &&  // Bottom edge
            state.verticalLines[br_idx]?.[bc_idx] &&        // Left edge
            state.verticalLines[br_idx]?.[bc_idx + 1]) {    // Right edge
            
            ui.fillBoxOnBoard(br_idx, bc_idx, playerIndex);
            state.boxes[br_idx][bc_idx] = playerIndex;
            boxesMadeThisTurn++;
            console.log(`[GameLogic] Box completed at (${br_idx}, ${bc_idx}) by player ${playerIndex}`);
            return true;
        }
        return false;
    };

    // Check boxes adjacent to the new line
    if (lineType === 'h') {
        check(lineR, lineC);      // Box "below" (top-left corner is (lineR, lineC))
        check(lineR - 1, lineC);  // Box "above" (top-left corner is (lineR-1, lineC))
    } else { // lineType === 'v'
        check(lineR, lineC);      // Box to the "right" (top-left corner is (lineR, lineC))
        check(lineR, lineC - 1);  // Box to the "left" (top-left corner is (lineR, lineC-1))
    }
    return boxesMadeThisTurn;
}

function endTurn(playerWhoseTurnEnded) { // Called by leader or local game
    if (!state.gameActive) return;

    const nextPlayerIndex = (playerWhoseTurnEnded + 1) % state.playersData.length;
    state.setCurrentPlayerIndex(nextPlayerIndex);
    console.log(`[GameLogic endTurn] P${playerWhoseTurnEnded}'s turn ended. Next is P${state.currentPlayerIndex} (${state.playersData[state.currentPlayerIndex]?.name}).`);
    
    if (!state.pvpRemoteActive) { // Local game specific UI updates
        state.setLastMoveForUndo(null);
        if (ui.undoBtn) ui.undoBtn.disabled = true;
        ui.updateMessageArea(''); // Clear "scored box" message
    }
    // ui.updatePlayerTurnDisplay(); // Caller (processMove or applyRemoteMove) will handle this
}

export function handleUndo() {
    if (state.pvpRemoteActive || !state.gameActive || !state.lastMoveForUndo) {
        if (ui.undoBtn) ui.undoBtn.disabled = true;
        return;
    }
    sound.playSound(sound.undoSound, "E3", "16n");

    const { type, r, c, playerIndex, lineElement, slotElement, boxesCompletedBeforeThisMove, scoreBeforeThisMove } = state.lastMoveForUndo;
    console.log(`[GameLogic handleUndo] Reverting move by P${playerIndex}: ${type} at (${r},${c})`);

    if (type === 'h') state.horizontalLines[r][c] = 0;
    else state.verticalLines[r][c] = 0;

    ui.removeVisualLineFromBoard(type, r, c); // Visually remove line
    if (slotElement) { // Re-enable slot
        slotElement.style.fill = 'rgba(0,0,0,0.03)';
        slotElement.addEventListener('click', handleLineClickWrapper);
    }

    // Revert completed boxes and scores
    if (boxesCompletedBeforeThisMove) {
        let boxesRevertedCount = 0;
        boxesCompletedBeforeThisMove.forEach(prevBoxState => {
            // If the box was completed by THIS move (was -1, now is playerIndex)
            if (state.boxes[prevBoxState.r]?.[prevBoxState.c] === playerIndex && prevBoxState.player === -1) {
                state.boxes[prevBoxState.r][prevBoxState.c] = -1; // Mark as uncompleted
                ui.removeFilledBoxFromBoard(prevBoxState.r, prevBoxState.c); // Visually remove fill
                boxesRevertedCount++;
            }
        });
        state.incrementFilledBoxesCount(-boxesRevertedCount);
    }
    if(state.playersData[playerIndex]) state.playersData[playerIndex].score = scoreBeforeThisMove;


    ui.updateScoresDisplay();
    ui.updateMessageArea(`${state.playersData[playerIndex]?.name}, ¡hacé tu jugada de nuevo!`);
    state.setLastMoveForUndo(null);
    if (ui.undoBtn) ui.undoBtn.disabled = true;

    state.setCurrentPlayerIndex(playerIndex); // Return turn to the player who made the original move
    ui.updatePlayerTurnDisplay();
    ui.setBoardClickable(true);
}

function checkGameOver() {
    const gameOver = state.totalPossibleBoxes > 0 && state.filledBoxesCount >= state.totalPossibleBoxes;
    if (gameOver) console.log(`[GameLogic checkGameOver] Game Over! Filled: ${state.filledBoxesCount}, Total: ${state.totalPossibleBoxes}`);
    return gameOver;
}

// Returns data for announcement, doesn't show modal directly
export function getWinnerData() {
    let maxScore = -1;
    let winners = [];
    state.playersData.forEach((player) => {
        if (player.score > maxScore) {
            maxScore = player.score;
            winners = [{ name: player.name, icon: player.icon, score: player.score, id: player.id }];
        } else if (player.score === maxScore) {
            winners.push({ name: player.name, icon: player.icon, score: player.score, id: player.id });
        }
    });
    return { winners, maxScore, isTie: winners.length !== 1 };
}

function announceWinner() { // Called in local games or by leader
    const { winners, maxScore, isTie } = getWinnerData();
    let winnerMessage;

    if (winners.length === 0 && state.totalPossibleBoxes > 0 && state.filledBoxesCount >= state.totalPossibleBoxes) {
        winnerMessage = "¡Es un empate general! ¡Todas las cajitas han sido llenadas!";
        sound.playSound(sound.tieSound, ["C4", "E4", "G4"], "4n");
    } else if (!isTie) {
        winnerMessage = `¡${winners[0].name} ${winners[0].icon} ganó con ${maxScore} cajitas brillantes! ¡Bravo! 🥳`;
        sound.playSound(sound.winSound, ["C4", "E4", "G4", "C5"], "2n");
    } else {
        const winnerNames = winners.map(p => `${p.name} ${p.icon}`).join(' y ');
        winnerMessage = `¡Hay un súper empate entre ${winnerNames} con ${maxScore} cajitas cada uno! ¡Muy bien jugado! 🎉`;
        sound.playSound(sound.tieSound, ["D4", "F4", "A4"], "4n");
    }
    ui.showModalMessage(`¡Juego Terminado! ${winnerMessage}`);
    ui.updateMessageArea(''); // Clear any turn messages
    if (ui.mainTitle && !state.pvpRemoteActive) ui.mainTitle.textContent = "¿Jugar de Nuevo?"; // For local
    else if (ui.mainTitle && state.pvpRemoteActive) ui.mainTitle.textContent = "Partida Terminada";
}

/**
 * Applies a remote move received from the leader.
 * @param {object} moveData - {type, r, c, playerIndex (of mover)}
 * @param {number} nextPlayerIndexFromLeader - The player whose turn it is next.
 * @param {Array} updatedScoresFromLeader - Array of {id, score} for all players.
 */
export function applyRemoteMove(moveData, nextPlayerIndexFromLeader, updatedScoresFromLeader) {
    if (!state.pvpRemoteActive || !state.gameActive) {
        console.warn(`[GameLogic applyRemoteMove] Ignoring. PVP: ${state.pvpRemoteActive}, GameActive: ${state.gameActive}`);
        return;
    }
    
    const { type, r, c, playerIndex: moverPlayerIndex } = moveData;
    console.log(`[GameLogic applyRemoteMove] Applying remote move: ${type} at (${r},${c}) by P${moverPlayerIndex}. Next turn: P${nextPlayerIndexFromLeader}. My local PId: ${state.networkRoomData.myPlayerIdInRoom}.`);

    // --- 1. Update Line State & UI (Draw Line) ---
    // This is effectively re-doing parts of processMove, but without turn logic/score calculation here.
    // It's assumed the leader has validated and this is just for visual/state sync.
    if (type === 'h') state.horizontalLines[r][c] = 1;
    else state.verticalLines[r][c] = 1;

    ui.drawVisualLineOnBoard(type, r, c, moverPlayerIndex);
    sound.playSound(sound.lineSound, "C4", "32n");
    const slotId = `slot-${type}-${r}-${c}`;
    document.getElementById(slotId)?.removeEventListener('click', handleLineClickWrapper);
    document.getElementById(slotId)?.style.fill = 'transparent';

    // --- 2. Check for Completed Boxes & Update UI (Fill Box) ---
    // This needs to happen to fill boxes based on the new line. Scores come from leader.
    // We re-run checkForCompletedBoxes to update UI, but scores are taken from leader.
    const boxesCompletedLocally = checkForCompletedBoxes(type, r, c, moverPlayerIndex);
    if (boxesCompletedLocally > 0) {
        sound.playSound(sound.boxSound, "A5", "16n", Tone.now() + 0.05);
    }
    
    // --- 3. Update Scores from Leader ---
    if (updatedScoresFromLeader) {
        updatedScoresFromLeader.forEach(ps => {
            const playerToUpdate = state.playersData.find(p => p.id === ps.id);
            if (playerToUpdate) playerToUpdate.score = ps.score;
        });
        // Also update filledBoxesCount based on scores if not perfectly synced by boxesCompletedLocally
        // For simplicity, trust leader's scores and recalculate filledBoxesCount from boxes state.
        let newFilledCount = 0;
        for(let br=0; br < state.numRows-1; br++){
            for(let bc=0; bc < state.numCols-1; bc++){
                if(state.boxes[br][bc] !== -1) newFilledCount++;
            }
        }
        state.setFilledBoxesCount(newFilledCount);

        ui.updateScoresDisplay();
    }

    // --- 4. Set Next Player & Update UI ---
    state.setCurrentPlayerIndex(nextPlayerIndexFromLeader);
    ui.updatePlayerTurnDisplay();

    // --- 5. Check Game Over ---
    if (checkGameOver()) {
        state.setGameActive(false);
        ui.setBoardClickable(false);
        // Leader will send GAME_OVER_ANNOUNCEMENT, client will display modal then.
        // ui.updateMessageArea("El juego ha terminado. Esperando resultados del líder...");
    } else {
        const isMyTurnNow = state.networkRoomData.myPlayerIdInRoom === state.currentPlayerIndex;
        ui.setBoardClickable(isMyTurnNow && state.gameActive);
        if (isMyTurnNow) {
            ui.updateMessageArea("¡Tu turno!");
        } else {
            const currentPlayerName = state.playersData[state.currentPlayerIndex]?.name || `Jugador ${state.currentPlayerIndex +1}`;
            ui.updateMessageArea(`Esperando a ${currentPlayerName}...`);
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
    // state.setNumPlayers is not used directly like this anymore. Player count from playersData.length.
    
    state.setPlayersData(remoteGameState.playersInGameOrder.map(p => ({...p}))); // Full player data for the game
    
    state.setHorizontalLines(remoteGameState.horizontalLines.map(row => [...row]));
    state.setVerticalLines(remoteGameState.verticalLines.map(row => [...row]));
    state.setBoxes(remoteGameState.boxes.map(row => [...row]));
    state.setFilledBoxesCount(remoteGameState.filledBoxesCount);
    state.setCurrentPlayerIndex(remoteGameState.currentPlayerIndex);
    state.setGameActive(remoteGameState.gameActive);
    // state.networkRoomData.turnCounter should be set by peerConnection from the message turnCounter

    ui.clearBoardForNewGame();
    ui.drawBoardSVG();
    addSlotListeners(); // Add listeners to newly drawn slots

    // Redraw all existing lines
    state.horizontalLines.forEach((row, r_idx) => {
        row.forEach((val, c_idx) => {
            if (val) { // Line exists
                // Find who "owns" this line. This is tricky without full history.
                // Simplification: color it by player who owns an adjacent completed box, or default.
                // Or, if game sends player per line, use that. For now, find owner of adjacent box.
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

    // Fill all completed boxes
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
        if(isMyTurn) ui.updateMessageArea("¡Tu turno! (Estado Sincronizado)"); else ui.updateMessageArea("Esperando al oponente... (Estado Sincronizado)");
    } else { // Game not active (e.g., game over)
        ui.setBoardClickable(false);
        if (state.filledBoxesCount >= state.totalPossibleBoxes && state.totalPossibleBoxes > 0) {
            announceWinner(); // Show game over modal
        } else {
            ui.updateMessageArea("Juego sincronizado. Esperando acción...");
        }
    }
    console.log(`[GameLogic applyFullState] Full state applied. Is my turn? ${state.networkRoomData.myPlayerIdInRoom === state.currentPlayerIndex}`);
}

// Helper for redrawing lines during full state sync. Tries to find an owner.
function findLineOwnerForRedraw(r, c, type, boxesState, playersList) {
    const defaultPlayerId = playersList[0]?.id ?? 0; // Fallback to first player in list

    // Check adjacent boxes
    const adjBoxes = getPotentiallyAffectedBoxes(type, r, c);
    for (const boxCoords of adjBoxes) {
        const boxOwnerId = boxesState[boxCoords.r]?.[boxCoords.c];
        if (boxOwnerId !== undefined && boxOwnerId !== -1) {
            // Ensure this ownerId is valid in the current playersList
            if (playersList.some(p => p.id === boxOwnerId)) return boxOwnerId;
        }
    }
    return defaultPlayerId; // If no owner found, use default
}

export function endGameAbruptly() {
    console.warn("[GameLogic] endGameAbruptly called.");
    if (state.gameActive) { // Only if a game was actually running
        state.setGameActive(false);
        ui.updateMessageArea("El juego terminó inesperadamente.", true);
        ui.setBoardClickable(false);
        if (ui.undoBtn && !state.pvpRemoteActive) ui.undoBtn.disabled = true;
        state.setLastMoveForUndo(null);
        // Consider showing a modal or specific UI state
    }
}
// Removed extra closing brace from here