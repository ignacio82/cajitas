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

// playersData will store the information for the *current* game being played.
// {id (player's unique ID for game logic, e.g. 0, 1, or from networkRoomData.player.id), name, icon, color, score, peerId (optional)}
export let playersData = [];

export let currentPlayerIndex = 0; // IMPORTANT: This now stores the *ID* of the current player from playersData, not an array index.
export let horizontalLines = [];
export let verticalLines = [];
export let boxes = []; // Stores player ID who completed the box, -1 if not completed
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
    myPlayerIdInRoom: null, // This client's *ID* in the network game (matches an id in networkRoomData.players)
    isRoomLeader: false,
    maxPlayers: MAX_PLAYERS_NETWORK,
    // Player list in the room. Synced.
    // Structure: { id: number (player's unique ID for this room/game), peerId, name, icon, color, isReady, isConnected, score }
    players: [],
    gameSettings: {
        rows: 4,
        cols: 4,
    },
    roomState: 'idle',
    turnCounter: 0,
    _peerInitPromise: null, // Store the promise from initPeerObject
    _peerInitResolve: null,
    _peerInitReject: null,
    _setupCompleteCallback: null, // For hostNewRoom/joinRoomById promises
    _setupErrorCallback: null,
};

// ---------- STATE MUTATORS / SETTERS ----------

export function setGameDimensions(rows, cols) {
    numRows = rows;
    numCols = cols;
    totalPossibleBoxes = (rows - 1) * (cols - 1);
    if (pvpRemoteActive && networkRoomData.isRoomLeader) {
        if (!networkRoomData.gameSettings) networkRoomData.gameSettings = {};
        networkRoomData.gameSettings.rows = rows;
        networkRoomData.gameSettings.cols = cols;
    }
}

export function setPlayersData(data) {
    playersData = data.map(p => ({ ...p, score: p.score || 0 }));
    console.log("[State] setPlayersData called. Active game players (playersData):", JSON.parse(JSON.stringify(playersData)));
}

export function setCurrentPlayerIndex(playerId) { // Renamed for clarity, accepts player ID
    currentPlayerIndex = playerId;
    // console.log(`[State] Current player ID set to: ${currentPlayerIndex}`);
}
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
    // Preserve promise handlers if not explicitly cleared by the update
    const preservedCallbacks = {
        _peerInitPromise: networkRoomData._peerInitPromise,
        _peerInitResolve: networkRoomData._peerInitResolve,
        _peerInitReject: networkRoomData._peerInitReject,
        _setupCompleteCallback: networkRoomData._setupCompleteCallback,
        _setupErrorCallback: networkRoomData._setupErrorCallback,
    };
    networkRoomData = { ...preservedCallbacks, ...networkRoomData, ...data };

    // If data explicitly clears a callback, it will be null/undefined
    if (data.hasOwnProperty('_peerInitPromise')) networkRoomData._peerInitPromise = data._peerInitPromise;
    if (data.hasOwnProperty('_peerInitResolve')) networkRoomData._peerInitResolve = data._peerInitResolve;
    if (data.hasOwnProperty('_peerInitReject')) networkRoomData._peerInitReject = data._peerInitReject;
    if (data.hasOwnProperty('_setupCompleteCallback')) networkRoomData._setupCompleteCallback = data._setupCompleteCallback;
    if (data.hasOwnProperty('_setupErrorCallback')) networkRoomData._setupErrorCallback = data._setupErrorCallback;


    if (data.roomState && data.roomState !== oldRoomState) {
        console.log(`[State] networkRoomData.roomState changed from ${oldRoomState} to ${networkRoomData.roomState}`);
    }
}

export function resetNetworkRoomData() {
    console.log("[State] Resetting networkRoomData (callbacks preserved if mid-operation).");
    const preservedCallbacks = { // Preserve callbacks if an operation is in flight
        _peerInitPromise: networkRoomData._peerInitPromise,
        _peerInitResolve: networkRoomData._peerInitResolve,
        _peerInitReject: networkRoomData._peerInitReject,
        _setupCompleteCallback: networkRoomData._setupCompleteCallback,
        _setupErrorCallback: networkRoomData._setupErrorCallback,
    };
    networkRoomData = {
        roomId: null, leaderPeerId: null, myPlayerIdInRoom: null, isRoomLeader: false,
        maxPlayers: MAX_PLAYERS_NETWORK, players: [],
        gameSettings: { rows: 4, cols: 4 }, roomState: 'idle', turnCounter: 0,
        ...preservedCallbacks // Apply preserved callbacks over the reset
    };
}


export function addPlayerToNetworkRoom(player) {
    const existingPlayerIndex = networkRoomData.players.findIndex(p => p.peerId === player.peerId);
    if (existingPlayerIndex === -1) {
        networkRoomData.players.push(player);
    } else {
        networkRoomData.players[existingPlayerIndex] = { ...networkRoomData.players[existingPlayerIndex], ...player };
        console.warn(`[State] Player ${player.peerId} already in network room. Updating data.`);
    }
    networkRoomData.players.sort((a, b) => (a.id || Infinity) - (b.id || Infinity));
    // console.log("[State] addPlayerToNetworkRoom. Current network players:", JSON.parse(JSON.stringify(networkRoomData.players)));
}

export function removePlayerFromNetworkRoom(peerIdToRemove) {
    const initialCount = networkRoomData.players.length;
    networkRoomData.players = networkRoomData.players.filter(p => p.peerId !== peerIdToRemove);
    if (networkRoomData.players.length < initialCount) {
        console.log(`[State] Player with peerId ${peerIdToRemove} removed from network room.`);
    }
}

export function updatePlayerInNetworkRoom(peerIdToUpdate, updates) {
    const playerIndex = networkRoomData.players.findIndex(p => p.peerId === peerIdToUpdate);
    if (playerIndex !== -1) {
        networkRoomData.players[playerIndex] = { ...networkRoomData.players[playerIndex], ...updates };
    }
}

export function incrementTurnCounter() {
    if (networkRoomData) {
        networkRoomData.turnCounter = (networkRoomData.turnCounter || 0) + 1;
    } else {
        console.warn("[State] incrementTurnCounter called but networkRoomData is not initialized.");
    }
}

export function resetScores() {
    if (playersData) {
        playersData.forEach(p => p.score = 0);
    }
    if (networkRoomData && networkRoomData.players) {
        networkRoomData.players.forEach(p => p.score = 0);
    }
}

export function resetGameFlowState(isNetworkReset = false) {
    // If playersData is already populated (e.g. by GAME_STARTED), set currentPlayerIndex to the first player's ID.
    // Otherwise, default to 0, which might be adjusted once playersData is set.
    currentPlayerIndex = (playersData && playersData.length > 0) ? playersData[0].id : 0;
    gameActive = false;
    filledBoxesCount = 0;
    lastMoveForUndo = null;
    initializeBoardState();
    resetScores();

    if (pvpRemoteActive && networkRoomData) {
        networkRoomData.turnCounter = 0;
    }
    console.log(`[State] resetGameFlowState completed. Current Player ID: ${currentPlayerIndex}`);
}

export function resetFullLocalStateForNewGame() {
    numRows = 4;
    numCols = 4;
    totalPossibleBoxes = (numRows - 1) * (numCols - 1);
    playersData = [];
    resetGameFlowState(false); // This will set currentPlayerIndex to 0 as playersData is empty
    resetNetworkRoomData();
    pvpRemoteActive = false;
    myPeerId = null;
}

export function getCurrentPlayer() { // Returns the player object whose ID matches currentPlayerIndex
    if (gameActive && playersData) {
        return playersData.find(p => p.id === currentPlayerIndex);
    }
    return null;
}

export function updatePlayerScoreInGame(playerToScoreId, newBoxesCount) { // Takes player ID
    const playerInGame = playersData.find(p => p.id === playerToScoreId);
    if (playerInGame) {
        playerInGame.score = (playerInGame.score || 0) + newBoxesCount;
    }

    if (pvpRemoteActive && networkRoomData.isRoomLeader && networkRoomData.players) {
        const playerInNetwork = networkRoomData.players.find(p => p.id === playerToScoreId);
        if (playerInNetwork) {
            playerInNetwork.score = (playerInNetwork.score || 0) + newBoxesCount;
        }
    }
}

export function getLocalPlayerCustomizationForNetwork() {
    const nameEl = document.getElementById('player-name-0');
    const iconEl = document.getElementById('player-icon-0');
    const colorEl = document.getElementById('player-color-0');

    const name = nameEl?.value || `Jugador`;
    const icon = iconEl?.value || AVAILABLE_ICONS[0];
    const color = colorEl?.value || DEFAULT_PLAYER_COLORS[0];
    return { name, icon, color };
}

export function getSanitizedNetworkRoomDataForClient() {
    if (!networkRoomData) return {};
    const {
        _peerInitPromise, _peerInitResolve, _peerInitReject,
        _setupCompleteCallback, _setupErrorCallback,
        ...sanitizedData
    } = networkRoomData;
    return sanitizedData;
}

export function logCurrentState(context = "Generic") {
    console.log(`--- CURRENT GAME STATE (${context}) ---`);
    console.log("Dimensions:", `${numRows}x${numCols}`, "Total Boxes:", totalPossibleBoxes);
    console.log("Players Data (for gameLogic):", JSON.parse(JSON.stringify(playersData)));
    console.log("Current Player ID (currentPlayerIndex):", currentPlayerIndex);
    console.log("Game Active:", gameActive);
    console.log("Filled Boxes:", filledBoxesCount);
    console.log("--- NETWORK STATE ---");
    console.log("PVP Remote Active:", pvpRemoteActive);
    console.log("My Peer ID:", myPeerId);
    console.log("Network Room Data (Sanitized):", JSON.parse(JSON.stringify(getSanitizedNetworkRoomDataForClient())));
    // console.log("Full Network Room Data (DEBUG):", JSON.parse(JSON.stringify(networkRoomData)));
    console.log("------------------------");
}

totalPossibleBoxes = (numRows - 1) * (numCols - 1);