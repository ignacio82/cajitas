// cpu.js - AI opponent system for Cajitas de Danielle

import * as state from './state.js';
import * as gameLogic from './gameLogic.js';
import * as ui from './ui.js';

// AI difficulty settings
const AI_DIFFICULTIES = {
    EASY: {
        name: 'Fácil',
        icon: '😊',
        thinkingTime: { min: 800, max: 1500 },
        boxCompletionChance: 0.3, // 30% chance to see box completion opportunities
        blockingChance: 0.1, // 10% chance to block opponent's potential boxes
        randomMoveWeight: 0.7, // 70% weight on random moves
        strategicWeight: 0.3
    },
    MEDIUM: {
        name: 'Medio',
        icon: '🤔',
        thinkingTime: { min: 1000, max: 2000 },
        boxCompletionChance: 0.7, // 70% chance to see box completion opportunities
        blockingChance: 0.4, // 40% chance to block opponent's potential boxes
        randomMoveWeight: 0.4,
        strategicWeight: 0.6
    },
    HARD: {
        name: 'Difícil',
        icon: '🤖',
        thinkingTime: { min: 1200, max: 2500 },
        boxCompletionChance: 0.95, // 95% chance to see box completion opportunities
        blockingChance: 0.8, // 80% chance to block opponent's potential boxes
        randomMoveWeight: 0.2,
        strategicWeight: 0.8
    }
};

export { AI_DIFFICULTIES };

let cpuThinkingTimeout = null;

/**
 * Checks if the given player is a CPU player
 */
export function isCpuPlayer(playerId) {
    const player = state.playersData.find(p => p.id === playerId);
    return player && player.isCpu === true;
}

/**
 * Gets the difficulty setting for a CPU player
 */
function getCpuDifficulty(playerId) {
    const player = state.playersData.find(p => p.id === playerId);
    return player?.cpuDifficulty || AI_DIFFICULTIES.MEDIUM;
}

/**
 * Makes a move for the CPU player
 */
export function makeCpuMove(cpuPlayerId) {
    if (!state.gameActive || state.currentPlayerIndex !== cpuPlayerId) {
        console.warn(`[CPU] Cannot make move: game not active or not CPU's turn. Current: ${state.currentPlayerIndex}, CPU: ${cpuPlayerId}`);
        return;
    }

    const cpuPlayer = state.playersData.find(p => p.id === cpuPlayerId);
    if (!cpuPlayer || !cpuPlayer.isCpu) {
        console.warn(`[CPU] Player ${cpuPlayerId} is not a CPU player`);
        return;
    }

    const difficulty = getCpuDifficulty(cpuPlayerId);
    
    // Update UI to show CPU is thinking
    ui.updateMessageArea(`${cpuPlayer.name} ${cpuPlayer.icon} está pensando...`, false, 0);
    ui.setBoardClickable(false); // Disable user input while CPU thinks

    // Add random thinking time for realism
    const thinkingTime = Math.random() * (difficulty.thinkingTime.max - difficulty.thinkingTime.min) + difficulty.thinkingTime.min;
    
    cpuThinkingTimeout = setTimeout(() => {
        try {
            const move = selectBestMove(cpuPlayerId, difficulty);
            if (move) {
                console.log(`[CPU] ${cpuPlayer.name} (${difficulty.name}) making move: ${move.type} at (${move.r}, ${move.c})`);
                gameLogic.processMove(move.type, move.r, move.c, cpuPlayerId, false, false);
                
                // If it's still the CPU's turn (they completed a box), schedule another move
                // processMove now calls handleTurnChange, which will re-trigger CPU if needed.
                // So, direct re-triggering here might be redundant or could conflict.
                // Let's rely on handleTurnChange to manage the flow.
                // if (state.gameActive && state.currentPlayerIndex === cpuPlayerId) {
                // //    console.log(`[CPU] ${cpuPlayer.name} scored, taking another turn.`);
                // //    setTimeout(() => makeCpuMove(cpuPlayerId), 500); // Short delay between consecutive moves
                // } else if (state.gameActive) {
                // //    const nextPlayer = state.playersData.find(p => p.id === state.currentPlayerIndex);
                // //    if (nextPlayer && !nextPlayer.isCpu) {
                // //        ui.setBoardClickable(true);
                // //        ui.updateMessageArea('', false, 0); // Clear thinking message
                // //    } else if (nextPlayer && nextPlayer.isCpu) {
                // //        // This case is handled by handleTurnChange now
                // //    }
                // }
            } else {
                console.error(`[CPU] No valid move found for ${cpuPlayer.name}`);
                ui.updateMessageArea('CPU no pudo encontrar una jugada válida', true, 3000);
                if (!state.pvpRemoteActive) ui.setBoardClickable(true); // Re-enable board for humans if CPU fails locally
            }
        } catch (error) {
            console.error(`[CPU] Error making move for ${cpuPlayer.name}:`, error);
            ui.updateMessageArea('Error en la jugada de CPU', true, 3000);
            if (!state.pvpRemoteActive) ui.setBoardClickable(true);
        }
        // Ensure handleTurnChange is called if game is still active,
        // to correctly pass turn or re-enable board for humans.
        // This is now expected to be called by gameLogic.processMove.
        // if (state.gameActive) {
        //     handleTurnChange();
        // }
    }, thinkingTime);
}

/**
 * Cancels any pending CPU move (useful for game reset/end)
 */
export function cancelCpuMove() {
    if (cpuThinkingTimeout) {
        clearTimeout(cpuThinkingTimeout);
        cpuThinkingTimeout = null;
        console.log("[CPU] Pending CPU move cancelled.");
    }
}

/**
 * Selects the best move for the CPU based on difficulty
 */
function selectBestMove(cpuPlayerId, difficulty) {
    const availableMoves = getAllAvailableMoves();
    if (availableMoves.length === 0) return null;

    // Analyze moves by type
    const boxCompletingMoves = findBoxCompletingMoves(availableMoves);
    const blockingMoves = findBlockingMoves(availableMoves, cpuPlayerId); // Pass cpuPlayerId
    const safeMoves = findSafeMoves(availableMoves);
    // const riskyMoves = availableMoves.filter(move => !safeMoves.includes(move)); // Not directly used in provided logic

    // Decision making based on difficulty
    
    // 1. Always try to complete boxes if the AI sees the opportunity
    if (boxCompletingMoves.length > 0 && Math.random() < difficulty.boxCompletionChance) {
        console.log(`[CPU] Strategy: Found ${boxCompletingMoves.length} box-completing moves. Chance: ${difficulty.boxCompletionChance}`);
        return selectRandomMove(boxCompletingMoves);
    }

    // 2. Try to block opponent's potential boxes (if not completing one for self)
    // The provided findBlockingMoves logic is more about not setting up opponent.
    // A true blocking move would prevent an immediate opponent score.
    // Let's refine this: a blocking move is a move that *prevents* the opponent from scoring a box *if they would have scored next*.
    // For now, using the provided logic for "blocking" as "not obviously bad".
    if (blockingMoves.length > 0 && Math.random() < difficulty.blockingChance) {
        console.log(`[CPU] Strategy: Found ${blockingMoves.length} 'strategic non-setup' moves. Chance: ${difficulty.blockingChance}`);
        // Filter blockingMoves to prioritize those that are also safe if possible
        const safeBlockingMoves = blockingMoves.filter(bm => safeMoves.includes(bm));
        if (safeBlockingMoves.length > 0) return selectRandomMove(safeBlockingMoves);
        return selectRandomMove(blockingMoves);
    }

    // 3. Weighted decision between safe moves and any available move (for randomness)
    const preferredMoves = [];
    if (safeMoves.length > 0) {
        // Add safe moves, weighted by strategicWeight
        for (let i = 0; i < Math.floor(difficulty.strategicWeight * 10); i++) {
            preferredMoves.push(...safeMoves);
        }
    }
    
    // Add all available moves, weighted by randomMoveWeight, to ensure some chance of any move
    for (let i = 0; i < Math.floor(difficulty.randomMoveWeight * 10); i++) {
        preferredMoves.push(...availableMoves);
    }

    if (preferredMoves.length > 0) {
        console.log(`[CPU] Strategy: Selecting from a weighted pool of ${preferredMoves.length} (safe/random) moves.`);
        return selectRandomMove(preferredMoves);
    }

    // Fallback: if pool is empty (e.g. weights are 0 or no safe moves), pick any available move.
    console.log(`[CPU] Strategy: Fallback - selecting from all ${availableMoves.length} available moves.`);
    return selectRandomMove(availableMoves);
}


/**
 * Gets all available moves on the board
 */
function getAllAvailableMoves() {
    const moves = [];
    
    // Check horizontal lines
    for (let r = 0; r < state.numRows; r++) {
        for (let c = 0; c < state.numCols - 1; c++) {
            if (!state.horizontalLines[r] || !state.horizontalLines[r][c]) {
                moves.push({ type: 'h', r, c });
            }
        }
    }
    
    // Check vertical lines
    for (let r = 0; r < state.numRows - 1; r++) {
        for (let c = 0; c < state.numCols; c++) {
            if (!state.verticalLines[r] || !state.verticalLines[r][c]) {
                moves.push({ type: 'v', r, c });
            }
        }
    }
    
    return moves;
}

/**
 * Finds moves that would complete a box
 */
function findBoxCompletingMoves(availableMoves) {
    return availableMoves.filter(move => {
        const affectedBoxes = getPotentiallyAffectedBoxes(move.type, move.r, move.c);
        return affectedBoxes.some(box => wouldCompleteBox(box.r, box.c, move));
    });
}

/**
 * Finds moves that would set up the opponent for an easy box completion.
 * The goal is to AVOID these if "blocking" is prioritized.
 * Or, if "blocking" means preventing opponent's *immediate* score, this needs adjustment.
 * The provided logic seems to identify moves that are "not safe" or lead to opponent completion.
 * Let's interpret "blockingMoves" as moves that are *not* immediately detrimental.
 * The original description was "10% chance to block opponent's potential boxes" -
 * this implies *not* making a move that gives them a box.
 * A better "blocking" would be to see if opponent has a 3-sided box and we can take the 4th side *if it's not also our scoring move*.
 * The current `findBlockingMoves` from the prompt is a bit unclear.
 * Let's assume it's trying to find moves that aren't obviously bad.
 * A "safe" move is one that doesn't leave a 3-sided box.
 */
function findBlockingMoves(availableMoves, cpuPlayerId) {
    // This function seems to be intended to find moves that don't immediately give away a box.
    // Or, to find moves that prevent an opponent's win (if they have 3 sides already).
    // The original description "blockingChance: 0.1, // 10% chance to block opponent's potential boxes"
    // is what we're trying to implement.

    // Let's find moves where, if the *opponent* were to play next, they could complete a box,
    // and our current move could prevent that or is simply a better alternative.
    // This is complex. The provided code for findBlockingMoves is:
    //      if (linesNeeded === 2) { blockingMoves.push(move); }
    // This means: if a box needs 2 lines, and *this move is one of them*, it's a "blocking" move.
    // This seems more like "setting up" or "contributing to a chain" rather than "blocking an opponent".
    // Let's stick to the provided code structure for now and refine if needed.
    // The current interpretation is: a move is "blocking" if it's part of a box that is not yet critical (needs 2 more).
    // This is not very strong. A true blocking move would see an opponent's 3-sided box and try to take a different safe line.

    // For now, let's return availableMoves that are NOT boxCompletingMoves for self, and are safe.
    // This is a simplification. The provided code for findBlockingMoves is difficult to interpret as "blocking".
    const nonScoringSafeMoves = findSafeMoves(availableMoves)
        .filter(safeMove => !findBoxCompletingMoves([safeMove]).length);

    if (nonScoringSafeMoves.length > 0) return nonScoringSafeMoves;
    return findSafeMoves(availableMoves); // if no non-scoring safe moves, just return safe ones
}


/**
 * Finds moves that don't give the opponent an easy box completion (don't leave a 3-sided box)
 */
function findSafeMoves(availableMoves) {
    return availableMoves.filter(move => {
        // Simulate placing the line for the current move
        const tempH = state.horizontalLines.map(row => [...row]);
        const tempV = state.verticalLines.map(row => [...row]);
        if (move.type === 'h') tempH[move.r][move.c] = 1;
        else tempV[move.r][move.c] = 1;

        // Check all *other* available moves. If any of *those* would complete a box *after* our move,
        // then our current move is NOT safe (it sets up the opponent).
        const otherAvailableMoves = getAllAvailableMoves().filter(m => !(m.type === move.type && m.r === move.r && m.c === move.c));
        
        for (const otherMove of otherAvailableMoves) {
            const affectedBoxesByOtherMove = getPotentiallyAffectedBoxes(otherMove.type, otherMove.r, otherMove.c);
            for (const box of affectedBoxesByOtherMove) {
                if (countLinesForBoxWithGivenState(box.r, box.c, tempH, tempV, otherMove) === 4) {
                    // If another player could complete a box after our 'move' by playing 'otherMove',
                    // then our 'move' is not safe.
                    return false; 
                }
            }
        }
        return true; // No opponent completion possible after this move
    });
}


/**
 * Checks if a move would complete a specific box given the current board state.
 */
function wouldCompleteBox(boxR, boxC, move) {
    if (boxR < 0 || boxR >= state.numRows - 1 || boxC < 0 || boxC >= state.numCols - 1) {
        return false;
    }
    if (state.boxes[boxR] && state.boxes[boxR][boxC] !== -1 && state.boxes[boxR][boxC] !== undefined) {
        return false; // Box already completed
    }
    const linesAfterMove = countLinesForBoxAfterMove(boxR, boxC, move);
    return linesAfterMove === 4;
}


/**
 * Counts how many lines a box (boxR, boxC) would have if 'move' is played.
 * Uses the current game state.
 */
function countLinesForBoxAfterMove(boxR, boxC, move) {
    return countLinesForBoxWithGivenState(boxR, boxC, state.horizontalLines, state.verticalLines, move);
}

/**
 * Generic function to count lines for a box given a board state and a potential move.
 */
function countLinesForBoxWithGivenState(boxR, boxC, hLines, vLines, move) {
    let count = 0;
    // Top line
    if ((hLines[boxR] && hLines[boxR][boxC]) || (move.type === 'h' && move.r === boxR && move.c === boxC)) {
        count++;
    }
    // Bottom line
    if ((hLines[boxR + 1] && hLines[boxR + 1][boxC]) || (move.type === 'h' && move.r === boxR + 1 && move.c === boxC)) {
        count++;
    }
    // Left line
    if ((vLines[boxR] && vLines[boxR][boxC]) || (move.type === 'v' && move.r === boxR && move.c === boxC)) {
        count++;
    }
    // Right line
    if ((vLines[boxR] && vLines[boxR][boxC + 1]) || (move.type === 'v' && move.r === boxR && move.c === boxC + 1)) {
        count++;
    }
    return count;
}


/**
 * Counts how many more lines are needed to complete a box.
 */
function countLinesNeededForBox(boxR, boxC) {
    // Count existing lines for the box
    let existingLines = 0;
    if (state.horizontalLines[boxR]?.[boxC]) existingLines++;        // Top
    if (state.horizontalLines[boxR + 1]?.[boxC]) existingLines++;    // Bottom
    if (state.verticalLines[boxR]?.[boxC]) existingLines++;          // Left
    if (state.verticalLines[boxR]?.[boxC + 1]) existingLines++;      // Right
    return 4 - existingLines;
}


/**
 * Gets boxes potentially affected by placing a line.
 */
function getPotentiallyAffectedBoxes(lineType, lineR, lineC) {
    const affected = [];
    if (lineType === 'h') { // Horizontal line
        if (lineR > 0) affected.push({ r: lineR - 1, c: lineC }); // Box above
        if (lineR < state.numRows - 1) affected.push({ r: lineR, c: lineC }); // Box below
    } else { // Vertical line
        if (lineC > 0) affected.push({ r: lineR, c: lineC - 1 }); // Box to the left
        if (lineC < state.numCols - 1) affected.push({ r: lineR, c: lineC }); // Box to the right
    }
    // Filter for valid box coordinates that exist on the board
    return affected.filter(box =>
        box.r >= 0 && box.r < (state.numRows - 1) &&
        box.c >= 0 && box.c < (state.numCols - 1)
    );
}


/**
 * Selects a random move from an array of moves
 */
function selectRandomMove(moves) {
    if (!moves || moves.length === 0) return null;
    return moves[Math.floor(Math.random() * moves.length)];
}

/**
 * Creates a CPU player object
 */
export function createCpuPlayer(id, difficultyKey = 'MEDIUM', name = null) {
    // Ensure difficultyKey is valid, default to MEDIUM
    const validDifficultyKey = AI_DIFFICULTIES[difficultyKey.toUpperCase()] ? difficultyKey.toUpperCase() : 'MEDIUM';
    const difficultySettings = AI_DIFFICULTIES[validDifficultyKey];
    
    return {
        id,
        name: name || `CPU ${difficultySettings.name}`,
        icon: difficultySettings.icon,
        color: state.DEFAULT_PLAYER_COLORS[id % state.DEFAULT_PLAYER_COLORS.length], // Assign color cyclically
        score: 0,
        isCpu: true,
        cpuDifficulty: difficultySettings // Store the whole difficulty object
    };
}

/**
 * Initializes players for a game including CPUs.
 * Reads human player details from UI elements.
 */
export function initializeCpuGame(humanPlayerCount, totalPlayerCount, cpuDifficultyKey = 'MEDIUM') {
    const players = [];
    
    // Add human players based on UI customization
    for (let i = 0; i < humanPlayerCount; i++) {
        const nameElement = document.getElementById(`player-name-${i}`);
        const iconElement = document.getElementById(`player-icon-${i}`);
        const colorElement = document.getElementById(`player-color-${i}`);
        
        players.push({
            id: i,
            name: nameElement?.value || `Jugador ${i + 1}`,
            icon: iconElement?.value || state.AVAILABLE_ICONS[i % state.AVAILABLE_ICONS.length],
            color: colorElement?.value || state.DEFAULT_PLAYER_COLORS[i % state.DEFAULT_PLAYER_COLORS.length],
            score: 0,
            isCpu: false,
            cpuDifficulty: null // Not a CPU
        });
    }
    
    // Add CPU players
    for (let i = humanPlayerCount; i < totalPlayerCount; i++) {
        // CPU player names could be more varied if desired, e.g., CPU 1 (Easy), CPU 2 (Hard)
        players.push(createCpuPlayer(i, cpuDifficultyKey));
    }
    
    return players;
}


/**
 * Handles the turn transition: if the current player is CPU, triggers its move.
 * If human, ensures board is clickable.
 */
export function handleTurnChange() {
    if (!state.gameActive) {
        cancelCpuMove(); // Cancel any pending CPU move if game becomes inactive
        return;
    }
    
    const currentPlayer = state.playersData.find(p => p.id === state.currentPlayerIndex);
    if (!currentPlayer) {
        console.error("[CPU handleTurnChange] Current player not found in state.playersData. Index:", state.currentPlayerIndex);
        return;
    }
    
    console.log(`[CPU handleTurnChange] Turn changed. Current player: ${currentPlayer.name} (ID: ${currentPlayer.id}), isCPU: ${currentPlayer.isCpu}`);
    
    if (currentPlayer.isCpu) {
        ui.setBoardClickable(false); // Board should be unclickable for CPU turn
        // Add a slight delay before CPU makes a move for better UX
        setTimeout(() => makeCpuMove(currentPlayer.id), 300); // Small delay before CPU "thinks"
    } else {
        // Human player's turn
        ui.setBoardClickable(true);
        // Clear "CPU is thinking" message if it was displayed
        if (ui.messageArea && ui.messageArea.textContent.includes("pensando...")) {
            ui.updateMessageArea('', false, 0);
        }
    }
}

console.log('[CPU] AI system loaded with difficulties:', Object.keys(AI_DIFFICULTIES));