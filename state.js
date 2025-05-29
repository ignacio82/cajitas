// state.js

// ---------- GAME CONSTANTS ----------
export const DEFAULT_PLAYER_COLORS = ['#FF69B4', '#00BFFF', '#FFD700', '#00FA9A', '#FF7F50', '#DA70D6']; // Added more for >4, though UI might cap
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
// For local games, it's set directly from UI.
// For network games, it will be synced from networkRoomData.players by the room leader or on joining.
export let playersData = []; // Array of player objects {id, name, icon, color, score, isCPU, peerId (optional, for network)}

export let currentPlayerIndex = 0;
export let horizontalLines = []; // Array of arrays, 1 if line exists, 0 otherwise
export let verticalLines = [];   // Array of arrays, 1 if line exists, 0 otherwise
export let boxes = [];           // Array of arrays, stores playerIndex who completed the box, -1 if not completed
export let filledBoxesCount = 0;
export let gameActive = false;
export let lastMoveForUndo = null;

// ---------- UI / SETTINGS STATE ----------
export let soundsInitialized = false;
export let soundEnabled = true;

// ---------- NETWORK PLAY STATE ----------
export let pvpRemoteActive = false;       // Is the game a remote PvP game?
export let myPeerId = null;               // This client's PeerJS ID
export const CAJITAS_PEER_ID_PREFIX = "cajitas-"; // For Supabase/display

// This object will hold all room-specific information
export let networkRoomData = {
    roomId: null,                   // Unique ID for the room (likely the leader's peerId)
    leaderPeerId: null,             // PeerJS ID of the room leader
    myPlayerIdInRoom: null,         // This client's assigned ID within the room (0, 1, 2, 3)
    isRoomLeader: false,            // Is this client the room leader?
    maxPlayers: MAX_PLAYERS_NETWORK,// Max players for this room (e.g., 2, 3, or 4)
    // Player list in the room. Synced across clients.
    // Structure: { id: number, peerId: string, name: string, icon: string, color: string, isReady: boolean, isConnected: boolean, score: number }
    players: [],
    gameSettings: {                 // Settings for the game determined by the leader
        rows: 4,
        cols: 4,
    },
    roomState: 'idle',              // 'idle', 'waiting_for_players', 'lobby', 'ready_check', 'in_game', 'game_over'
    turnCounter: 0,                 // To sync game events
    gamePaired: false,              // Simplified: true if enough players are connected to potentially start (still needs ready check)
                                    // More specific states will be in networkRoomData.roomState
};

// ---------- STATE MUTATORS / SETTERS ----------

// Game Setup & Core
export function setGameDimensions(rows, cols) {
    numRows = rows;
    numCols = cols;
    totalPossibleBoxes = (rows - 1) * (cols - 1);
    if (pvpRemoteActive && networkRoomData.isRoomLeader) {
        networkRoomData.gameSettings.rows = rows;
        networkRoomData.gameSettings.cols = cols;
    }
}

// playersData is the single source of truth for player info during an active game.
// For network games, this function should be called by the leader to set it for all,
// or by clients when receiving authoritative data from the leader.
export function setPlayersData(data) {
    playersData = data.map(p => ({ ...p, score: p.score || 0 })); // Ensure score is initialized
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
    // turnCounter is part of networkRoomData now
}

// UI/Settings
export function setSoundsInitialized(initialized) { soundsInitialized = initialized; }
export function setSoundEnabled(enabled) { soundEnabled = enabled; }

// Network Play
export function setPvpRemoteActive(isActive) { pvpRemoteActive = isActive; }
export function setMyPeerId(id) { myPeerId = id; }

// Network Room Data specific setters
export function setNetworkRoomData(data) {
    networkRoomData = { ...networkRoomData, ...data };
    if (data.players) { // If players array is updated, ensure local playersData for game rendering is also updated.
        // This assumes the structure in networkRoomData.players is compatible with what playersData expects.
        // The leader should be the one primarily setting this and broadcasting.
        // Clients receive it and update their local game state.
        // setPlayersData(networkRoomData.players); // NO, playersData should be set *explicitly* for game start.
                                                // networkRoomData.players is for lobby and sync.
    }
}

export function resetNetworkRoomData() {
    networkRoomData = {
        roomId: null,
        leaderPeerId: null,
        myPlayerIdInRoom: null,
        isRoomLeader: false,
        maxPlayers: MAX_PLAYERS_NETWORK,
        players: [],
        gameSettings: { rows: 4, cols: 4 },
        roomState: 'idle',
        turnCounter: 0,
        gamePaired: false,
    };
}

export function addPlayerToNetworkRoom(player) {
    // player: { id: number, peerId: string, name: string, icon: string, color: string, isReady: boolean, isConnected: boolean, score: number }
    // Ensure no duplicate peerId
    if (!networkRoomData.players.find(p => p.peerId === player.peerId)) {
        networkRoomData.players.push(player);
    }
    // Sort by ID to maintain order if necessary, though ID assignment should be sequential by leader
    networkRoomData.players.sort((a, b) => a.id - b.id);
}

export function removePlayerFromNetworkRoom(peerId) {
    networkRoomData.players = networkRoomData.players.filter(p => p.peerId !== peerId);
    // Consider re-assigning IDs if players leave mid-lobby, though simpler if IDs are stable once assigned.
    // For now, IDs are positions. If P1 leaves from [P0, P1, P2], list becomes [P0, P2].
    // This means player IDs might not be contiguous after someone leaves.
    // Simpler: Leader re-assigns IDs and sends full player list update.
}

export function updatePlayerInNetworkRoom(peerId, updates) {
    const playerIndex = networkRoomData.players.findIndex(p => p.peerId === peerId);
    if (playerIndex !== -1) {
        networkRoomData.players[playerIndex] = { ...networkRoomData.players[playerIndex], ...updates };
    }
}

// Reset functions
export function resetScores() {
    if (playersData) {
        playersData.forEach(p => p.score = 0);
    }
    if (networkRoomData.players) { // Also reset scores in the network room data if active
        networkRoomData.players.forEach(p => p.score = 0);
    }
}

export function resetGameFlowState(isNetworkReset = false) {
    currentPlayerIndex = 0;
    gameActive = false;
    filledBoxesCount = 0;
    lastMoveForUndo = null;

    initializeBoardState(); // Clears lines, boxes

    if (isNetworkReset) {
        // For network games, player data (names, icons, colors) is managed by networkRoomData.
        // Scores within playersData should be reset if that's the source for UI.
        resetScores(); // This will also hit networkRoomData.players scores.
    } else {
        // For local games, keep player definitions, just reset scores
        resetScores();
    }

    if (pvpRemoteActive) {
        networkRoomData.turnCounter = 0;
        // Room state might transition, e.g., to 'game_over' or back to 'lobby'
        // This specific reset is for game flow, not necessarily full room state.
    }
}

export function resetFullLocalStateForNewGame() {
    // Resets almost everything for returning to the main setup screen
    // numRows = 4; // Keep last used settings or reset to default? For now, keep.
    // numCols = 4;
    // playersData = []; // Cleared when new setup happens
    
    currentPlayerIndex = 0;
    horizontalLines = [];
    verticalLines = [];
    boxes = [];
    totalPossibleBoxes = (numRows - 1) * (numCols - 1); // Recalculate
    filledBoxesCount = 0;
    gameActive = false;
    lastMoveForUndo = null;

    resetNetworkRoomData(); // Full reset of network state
    // myPeerId might persist for the session unless PeerJS is fully closed.
    pvpRemoteActive = false; // Crucial
}


// Helper to get current player's data
export function getCurrentPlayer() {
    if (gameActive && playersData && playersData[currentPlayerIndex]) {
        return playersData[currentPlayerIndex];
    }
    return null; // Or a default player object if appropriate
}

// Helper to update a specific player's score IN THE ACTIVE GAME (playersData)
export function updatePlayerScoreInGame(playerIndex, newBoxesCount) {
    if (playersData[playerIndex]) {
        playersData[playerIndex].score = (playersData[playerIndex].score || 0) + newBoxesCount;
    }

    // If it's a network game, the leader also needs to update this in networkRoomData.players
    // and broadcast it. This function itself doesn't broadcast.
    if (pvpRemoteActive && networkRoomData.isRoomLeader) {
        const playerToUpdate = networkRoomData.players.find(p => p.id === playerIndex);
        if (playerToUpdate) {
            playerToUpdate.score = (playerToUpdate.score || 0) + newBoxesCount;
        }
    }
}

// This is for console logging and debugging state easily
export function logCurrentState() {
    console.log("--- CURRENT GAME STATE ---");
    console.log("Dimensions:", `${numRows}x${numCols}`, "Total Boxes:", totalPossibleBoxes);
    console.log("Players Data:", JSON.parse(JSON.stringify(playersData)));
    console.log("Current Player Index:", currentPlayerIndex);
    console.log("Game Active:", gameActive);
    console.log("Filled Boxes:", filledBoxesCount);
    // console.log("H-Lines:", horizontalLines);
    // console.log("V-Lines:", verticalLines);
    // console.log("Boxes:", boxes);
    console.log("Undo Move:", lastMoveForUndo ? "{...}" : null);
    console.log("--- NETWORK STATE ---");
    console.log("PVP Remote Active:", pvpRemoteActive);
    console.log("My Peer ID:", myPeerId);
    console.log("Network Room Data:", JSON.parse(JSON.stringify(networkRoomData)));
    console.log("------------------------");
}

// Initialize totalPossibleBoxes based on default numRows/numCols
totalPossibleBoxes = (numRows - 1) * (numCols - 1);