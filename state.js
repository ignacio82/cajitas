// state.js

// ---------- GAME CONSTANTS ----------
export const DEFAULT_PLAYER_COLORS = ['#FF69B4', '#00BFFF', '#FFD700', '#00FA9A', '#FF7F50', '#DA70D6'];
export const AVAILABLE_ICONS = ['⭐', '💖', '✨', '🎈', '🎉', '🍓', '🦄', '🌈', '👑', '🚀', '⚽', '🍕'];
export const DOT_RADIUS = 6;
export const LINE_THICKNESS = 5;
export const CLICKABLE_AREA_EXTENSION = 7;
export const CELL_SIZE = 60;
export const SVG_PADDING = 20;
export const DOT_COLOR = '#8A2BE2';
export const MAX_PLAYERS_LOCAL = 4;
export const MAX_PLAYERS_NETWORK = 4;
export const MIN_PLAYERS_NETWORK = 2;

// ---------- GAME STATE (Local & Core Gameplay) ----------
export let numRows = 4;
export let numCols = 4;
export let totalPossibleBoxes = 0;

export let playersData = []; // Array of player objects {id (playerIndex), name, icon, color, score, peerId (optional)}

export let currentPlayerIndex = 0;
export let horizontalLines = [];
export let verticalLines = [];
export let boxes = [];
export let filledBoxesCount = 0;
export let gameActive = false;
export let lastMoveForUndo = null;

// ---------- UI / SETTINGS STATE ----------
export let soundsInitialized = false;
export let soundEnabled = true;

// ---------- NETWORK PLAY STATE ----------
export let pvpRemoteActive = false;
export let myPeerId = null;
export const CAJITAS_PEER_ID_PREFIX = "cajitas-";

export let networkRoomData = {
    roomId: null,
    leaderPeerId: null,
    myPlayerIdInRoom: null, // This client's playerIndex in the network game (0, 1, 2, 3)
    isRoomLeader: false,
    maxPlayers: MAX_PLAYERS_NETWORK,
    // Player list in the room. Synced across clients.
    // Structure: { id: number (playerIndex), peerId: string, name: string, icon: string, color: string, isReady: boolean, isConnected: boolean, score: number (lobby score, might not be used) }
    players: [],
    gameSettings: {
        rows: 4,
        cols: 4,
    },
    roomState: 'idle', // 'idle', 'waiting_for_players', 'creating_random_match_room', 'lobby', 'in_game', 'game_over', 'game_over_by_disconnect', 'connecting_to_lobby', 'awaiting_join_approval', 'seeking_match'
    turnCounter: 0,
    // _peerInitResolve: null, // Store Promise resolvers for initPeerObject
    // _peerInitReject: null,
    // _setupCompleteCallback: null, // Store promise resolvers for hostNewRoom/joinRoomById
    // _setupErrorCallback: null,
};

// ---------- STATE MUTATORS / SETTERS ----------

export function setGameDimensions(rows, cols) {
    numRows = rows;
    numCols = cols;
    totalPossibleBoxes = (rows - 1) * (cols - 1);
    if (pvpRemoteActive && networkRoomData.isRoomLeader) {
        networkRoomData.gameSettings.rows = rows;
        networkRoomData.gameSettings.cols = cols;
    }
}

export function setPlayersData(data) { // data for the active game (gameLogic)
    playersData = data.map(p => ({ ...p, score: p.score || 0 }));
    console.log("[State] setPlayersData called. Active game players:", JSON.parse(JSON.stringify(playersData)));
}

export function setCurrentPlayerIndex(index) { currentPlayerIndex = index; }
export function setHorizontalLines(lines) { horizontalLines = lines.map(row => [...row]); }
export function setVerticalLines(lines) { verticalLines = lines.map(row => [...row]); }
export function setBoxes(newBoxes) { boxes = newBoxes.map(row => [...row]); }
export function incrementFilledBoxesCount(count = 1) { filledBoxesCount += count; }
export function setFilledBoxesCount(count) { filledBoxesCount = count; }
export function setGameActive(isActive) { gameActive = isActive; }
export function setLastMoveForUndo(move) { lastMoveForUndo = move; }


export function initializeBoardState() {
    horizontalLines = Array(numRows).fill(null).map(() => Array(numCols - 1).fill(0));
    verticalLines = Array(numRows - 1).fill(null).map(() => Array(numCols).fill(0));
    boxes = Array(numRows - 1).fill(null).map(() => Array(numCols - 1).fill(-1));
    filledBoxesCount = 0;
    lastMoveForUndo = null;
}

export function setSoundsInitialized(initialized) { soundsInitialized = initialized; }
export function setSoundEnabled(enabled) { soundEnabled = enabled; }

export function setPvpRemoteActive(isActive) { pvpRemoteActive = isActive; }
export function setMyPeerId(id) { myPeerId = id; }

export function setNetworkRoomData(data) {
    const oldRoomState = networkRoomData.roomState;
    networkRoomData = { ...networkRoomData, ...data };
    if (data.roomState && data.roomState !== oldRoomState) {
        console.log(`[State] networkRoomData.roomState changed from ${oldRoomState} to ${networkRoomData.roomState}`);
    }
     // console.log("[State] setNetworkRoomData:", JSON.parse(JSON.stringify(networkRoomData)));
}

export function resetNetworkRoomData() {
    console.log("[State] Resetting networkRoomData.");
    networkRoomData = {
        roomId: null,
        leaderPeerId: null,
        myPlayerIdInRoom: null,
        isRoomLeader: false,
        maxPlayers: MAX_PLAYERS_NETWORK,
        players: [], // Clear player list
        gameSettings: { rows: 4, cols: 4 },
        roomState: 'idle',
        turnCounter: 0,
        // _peerInitResolve: networkRoomData._peerInitResolve, // Preserve if mid-init
        // _peerInitReject: networkRoomData._peerInitReject,
        // _setupCompleteCallback: networkRoomData._setupCompleteCallback, // Preserve if mid-setup
        // _setupErrorCallback: networkRoomData._setupErrorCallback,
    };
}


export function addPlayerToNetworkRoom(player) {
    // Ensure no duplicate player by peerId
    const existingPlayerIndex = networkRoomData.players.findIndex(p => p.peerId === player.peerId);
    if (existingPlayerIndex === -1) {
        networkRoomData.players.push(player);
    } else {
        // Update existing player data, useful for reconnections or data corrections
        networkRoomData.players[existingPlayerIndex] = { ...networkRoomData.players[existingPlayerIndex], ...player };
        console.warn(`[State] Player ${player.peerId} already in network room. Updating data.`);
    }
    // Sort by ID (playerIndex) to maintain order, leader (id 0) should be first
    networkRoomData.players.sort((a, b) => (a.id || Infinity) - (b.id || Infinity));
    console.log("[State] addPlayerToNetworkRoom. Current network players:", JSON.parse(JSON.stringify(networkRoomData.players)));
}

export function removePlayerFromNetworkRoom(peerIdToRemove) {
    const initialCount = networkRoomData.players.length;
    networkRoomData.players = networkRoomData.players.filter(p => p.peerId !== peerIdToRemove);
    if (networkRoomData.players.length < initialCount) {
        console.log(`[State] Player with peerId ${peerIdToRemove} removed from network room.`);
    } else {
        console.warn(`[State] Attempted to remove player ${peerIdToRemove}, but not found in network room.`);
    }
}

export function updatePlayerInNetworkRoom(peerIdToUpdate, updates) {
    const playerIndex = networkRoomData.players.findIndex(p => p.peerId === peerIdToUpdate);
    if (playerIndex !== -1) {
        networkRoomData.players[playerIndex] = { ...networkRoomData.players[playerIndex], ...updates };
    } else {
        console.warn(`[State] updatePlayerInNetworkRoom: Player with peerId ${peerIdToUpdate} not found.`);
    }
}

export function incrementTurnCounter() {
    if (networkRoomData) {
        networkRoomData.turnCounter = (networkRoomData.turnCounter || 0) + 1;
        // console.log(`[State] Turn counter incremented to: ${networkRoomData.turnCounter}`);
    } else {
        console.warn("[State] incrementTurnCounter called but networkRoomData is not initialized.");
    }
}

export function resetScores() {
    if (playersData) {
        playersData.forEach(p => p.score = 0);
    }
    // Also reset scores in networkRoomData.players for lobby display if game restarts in lobby context
    if (networkRoomData && networkRoomData.players) {
        networkRoomData.players.forEach(p => p.score = 0);
    }
}

export function resetGameFlowState(isNetworkReset = false) {
    currentPlayerIndex = 0;
    gameActive = false; // Game is not active until explicitly started
    filledBoxesCount = 0;
    lastMoveForUndo = null;

    initializeBoardState(); // Clears lines, boxes

    // Scores are reset for both local and network games when flow state is reset
    resetScores();

    if (pvpRemoteActive && networkRoomData) {
        networkRoomData.turnCounter = 0;
        // If it's a network reset, potentially other network-specific state needs clearing
        // For now, turnCounter is the main one for game flow.
        // The room state (lobby, in_game) is managed separately.
    }
}

export function resetFullLocalStateForNewGame() {
    // Resets state for a completely new local game, or when abandoning a network game setup
    numRows = 4; // Reset to default or last used local settings
    numCols = 4;
    totalPossibleBoxes = (numRows - 1) * (numCols - 1);
    playersData = []; // Clear active game players

    resetGameFlowState(false); // Reset all game logic variables for a local context

    // Crucially, reset network-specific states
    resetNetworkRoomData(); // Clears all network room info
    pvpRemoteActive = false; // No longer in PvP mode
    myPeerId = null; // Clear own peer ID
}

export function getCurrentPlayer() {
    if (gameActive && playersData && playersData[currentPlayerIndex]) {
        return playersData[currentPlayerIndex];
    }
    return null;
}

export function updatePlayerScoreInGame(playerIndex, newBoxesCount) {
    // Update score in the active game's playersData
    if (playersData[playerIndex]) {
        playersData[playerIndex].score = (playersData[playerIndex].score || 0) + newBoxesCount;
    }

    // If network game and this client is the leader, also update the score in networkRoomData.players
    // This is for lobby/sync purposes if scores are shown there or if a game restarts.
    if (pvpRemoteActive && networkRoomData.isRoomLeader && networkRoomData.players) {
        const networkPlayerToUpdate = networkRoomData.players.find(p => p.id === playerIndex);
        if (networkPlayerToUpdate) {
            networkPlayerToUpdate.score = (networkPlayerToUpdate.score || 0) + newBoxesCount;
        }
    }
}

// Helper to get player customization from the UI (for the local player joining a network game)
export function getLocalPlayerCustomizationForNetwork() {
    // Assumes player customization fields (name-0, icon-0, color-0) are for the local user for network play
    const name = document.getElementById('player-name-0')?.value || `Jugador`;
    const icon = document.getElementById('player-icon-0')?.value || AVAILABLE_ICONS[0];
    const color = document.getElementById('player-color-0')?.value || DEFAULT_PLAYER_COLORS[0];
    return { name, icon, color };
}

// Helper to get a sanitized version of networkRoomData for sending to clients
// Avoids sending internal state like _callbacks
export function getSanitizedNetworkRoomDataForClient() {
    if (!networkRoomData) return {};
    const {
        _peerInitResolve, _peerInitReject,
        _setupCompleteCallback, _setupErrorCallback,
        ...sanitizedData
    } = networkRoomData;
    return sanitizedData;
}


export function logCurrentState(context = "Generic") {
    console.log(`--- CURRENT GAME STATE (${context}) ---`);
    console.log("Dimensions:", `${numRows}x${numCols}`, "Total Boxes:", totalPossibleBoxes);
    console.log("Players Data (for gameLogic):", JSON.parse(JSON.stringify(playersData)));
    console.log("Current Player Index:", currentPlayerIndex);
    console.log("Game Active:", gameActive);
    console.log("Filled Boxes:", filledBoxesCount);
    // console.log("Undo Move:", lastMoveForUndo ? "{...}" : null);
    console.log("--- NETWORK STATE ---");
    console.log("PVP Remote Active:", pvpRemoteActive);
    console.log("My Peer ID:", myPeerId);
    // console.log("Network Room Data (full):", JSON.parse(JSON.stringify(networkRoomData)));
    console.log("Network Room Data (Sanitized for client view):", JSON.parse(JSON.stringify(getSanitizedNetworkRoomDataForClient())));
    console.log("------------------------");
}

totalPossibleBoxes = (numRows - 1) * (numCols - 1); // Initial calculation