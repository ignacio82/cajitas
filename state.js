// state.js

// ---------- GAME CONSTANTS ----------
export const DEFAULT_PLAYER_COLORS = ['#FF69B4', '#00BFFF', '#FFD700', '#00FA9A'];
export const AVAILABLE_ICONS = ['⭐', '💖', '✨', '🎈', '🎉', '🍓', '🦄', '🌈', '👑', '🚀', '⚽', '🍕'];
export const DOT_RADIUS = 6;
export const LINE_THICKNESS = 5;
export const CLICKABLE_AREA_EXTENSION = 7;
export const CELL_SIZE = 60;
export const SVG_PADDING = 20;
export const DOT_COLOR = '#8A2BE2';

// ---------- GAME STATE ----------
export let numRows = 4;
export let numCols = 4;
export let numPlayers = 2;
export let playersData = []; // Array of player objects {id, name, icon, color, score, isCPU}
export let currentPlayerIndex = 0;
export let horizontalLines = []; // Array of arrays, 1 if line exists, 0 otherwise
export let verticalLines = [];   // Array of arrays, 1 if line exists, 0 otherwise
export let boxes = [];           // Array of arrays, stores playerIndex who completed the box, -1 if not completed
export let totalPossibleBoxes = 0;
export let filledBoxesCount = 0;
export let gameActive = false;
export let lastMoveForUndo = null; // Stores { type, r, c, playerIndex, lineElement, slotElement, boxesCompletedBeforeMove: [] }

// ---------- UI / SETTINGS STATE ----------
export let soundsInitialized = false;
export let soundEnabled = true; // Assuming sound is enabled by default

// ---------- NETWORK PLAY STATE ----------
export let pvpRemoteActive = false;       // Is the game a remote PvP game?
export let isMyTurnInRemote = false;      // Is it this client's turn in a remote game?
export let iAmPlayer1InRemote = true;     // Is this client Player 1 (host) in a remote game? (P1 typically goes first or decides)
export let gamePaired = false;            // Is the remote game successfully paired with an opponent?
export let currentHostPeerId = null;      // PeerJS ID of the host if this client is a joiner, or own ID if host
export let myPeerId = null;               // This client's PeerJS ID
export let turnCounter = 0;               // To sync game events, similar to tateti
export let myPlayerIdInRemoteGame = null; // The player ID (0, 1, 2, 3) assigned to this client in a remote game
export let remotePlayersData = [];        // Player data received from the host or to be sent
export const CAJITAS_PEER_ID_PREFIX = "cajitas-";

// ---------- STATE MUTATORS / SETTERS ----------

// Game Setup
export function setGameDimensions(rows, cols) {
    numRows = rows;
    numCols = cols;
    totalPossibleBoxes = (rows - 1) * (cols - 1);
}
export function setNumPlayers(count) { numPlayers = count; }
export function setPlayersData(data) { playersData = data; }

// Game Play
export function setCurrentPlayerIndex(index) { currentPlayerIndex = index; }
export function setHorizontalLines(lines) { horizontalLines = lines; }
export function setVerticalLines(lines) { verticalLines = lines; }
export function setBoxes(newBoxes) { boxes = newBoxes; }
export function incrementFilledBoxesCount(count = 1) { filledBoxesCount += count; }
export function setFilledBoxesCount(count) { filledBoxesCount = count; }
export function setGameActive(isActive) { gameActive = isActive; }
export function setLastMoveForUndo(move) { lastMoveForUndo = move; }

// Board State Initialization/Reset
export function initializeBoardState() {
    horizontalLines = Array(numRows).fill(null).map(() => Array(numCols - 1).fill(0));
    verticalLines = Array(numRows - 1).fill(null).map(() => Array(numCols).fill(0));
    boxes = Array(numRows - 1).fill(null).map(() => Array(numCols - 1).fill(-1));
    filledBoxesCount = 0;
    lastMoveForUndo = null;
    turnCounter = 0;
}

// UI/Settings
export function setSoundsInitialized(initialized) { soundsInitialized = initialized; }
export function setSoundEnabled(enabled) { soundEnabled = enabled; }

// Network Play
export function setPvpRemoteActive(isActive) { pvpRemoteActive = isActive; }
export function setIsMyTurnInRemote(isMyTurn) { isMyTurnInRemote = isMyTurn; }
export function setIAmPlayer1InRemote(isP1) { iAmPlayer1InRemote = isP1; }
export function setGamePaired(isPaired) { gamePaired = isPaired; }
export function setCurrentHostPeerId(id) { currentHostPeerId = id; }
export function setMyPeerId(id) { myPeerId = id; }
export function incrementTurnCounter() { turnCounter++; }
export function setTurnCounter(tc) { turnCounter = tc; }
export function setMyPlayerIdInRemoteGame(id) { myPlayerIdInRemoteGame = id; }
export function setRemotePlayersData(data) { remotePlayersData = data; }

// Reset functions
export function resetScores() {
    if (playersData) {
        playersData.forEach(p => p.score = 0);
    }
    if (remotePlayersData) {
        remotePlayersData.forEach(p => p.score = 0);
    }
}

export function resetGameFlowState() {
    currentPlayerIndex = 0; // Or determine based on settings/winner
    gameActive = false;
    filledBoxesCount = 0;
    lastMoveForUndo = null;
    turnCounter = 0;
    // Keep numRows, numCols, numPlayers, playersData (names, colors, icons) from setup
    // Re-initialize board arrays:
    initializeBoardState();
}

export function resetNetworkState() {
    pvpRemoteActive = false;
    isMyTurnInRemote = false;
    iAmPlayer1InRemote = true; // Default to host assumption
    gamePaired = false;
    currentHostPeerId = null;
    // myPeerId might persist for the session, or be nulled if re-initing peer
    turnCounter = 0;
    myPlayerIdInRemoteGame = null;
    remotePlayersData = [];
}

// Helper to get current player's data, considering network play
export function getCurrentPlayer() {
    if (pvpRemoteActive) {
        // In a remote game, playersData might be derived from remotePlayersData
        // or a mapping if local playersData is still used as the primary.
        // For now, assume playersData is the source of truth, and currentPlayerIndex points to it.
        return playersData.find(p => p.id === currentPlayerIndex);
    }
    return playersData[currentPlayerIndex];
}

// Helper to update a specific player's score
export function updatePlayerScore(playerIndex, newBoxesCount) {
    if (playersData[playerIndex]) {
        playersData[playerIndex].score += newBoxesCount;
    }
    // If remote, this update might also need to be reflected in remotePlayersData
    if (pvpRemoteActive && remotePlayersData[playerIndex]) {
         remotePlayersData[playerIndex].score += newBoxesCount;
    }
}