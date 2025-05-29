// peerjs-multiplayer.js
console.log("DEBUG: peerjs-multiplayer.js script execution started."); 

let peer = null; 
let currentConnection = null; 
let localPeerId = null;

// Default callbacks
let onPeerOpenCallback_default = (id) => console.log('PeerJS: Default (Global) - My peer ID is:', id);
let onConnectionOpenCallback_default = (peerId) => console.log('PeerJS: Default (Global) - Connection opened with:', peerId);
let onDataReceivedCallback_default = (data, peerId) => console.log('PeerJS: Default (Global) - Data received from:', peerId, data);
let onConnectionCloseCallback_default = (peerId) => console.log('PeerJS: Default (Global) - Connection closed with:', peerId);
let onErrorCallback_default = (err) => console.error('PeerJS: Default (Global) - Error:', err.type, err.message || err);
let onNewConnectionCallback_default = (conn) => console.log('PeerJS: Default (Global) - New incoming connection from:', conn.peer);

// Module-level variables to hold the currently registered callbacks
let currentOnPeerOpenCallback = onPeerOpenCallback_default;
let currentOnConnectionOpenCallback = onConnectionOpenCallback_default;
let currentOnDataReceivedCallback = onDataReceivedCallback_default;
let currentOnConnectionCloseCallback = onConnectionCloseCallback_default;
let currentOnErrorCallback = onErrorCallback_default;
let currentOnNewConnectionCallback = onNewConnectionCallback_default;


function initPeerSession(options = {}, callbacks = {}) { // Options can now include PeerJS constructor options
    if (peer && !peer.destroyed) { 
        console.warn("PeerJS: Peer object already exists and is not destroyed. Closing existing session before creating a new one.");
        closePeerSession(); // This destroys the old peer and sets it to null
    } else if (peer && peer.destroyed) {
        console.log("PeerJS: Peer object was already destroyed. Ready for new initialization.");
        peer = null; 
    }

    // Update module-level current callbacks with those provided for this initialization
    currentOnPeerOpenCallback = callbacks.onPeerOpen || onPeerOpenCallback_default;
    currentOnConnectionOpenCallback = callbacks.onConnectionOpen || onConnectionOpenCallback_default;
    currentOnDataReceivedCallback = callbacks.onDataReceived || onDataReceivedCallback_default;
    currentOnConnectionCloseCallback = callbacks.onConnectionClose || onConnectionCloseCallback_default;
    currentOnErrorCallback = callbacks.onError || onErrorCallback_default;
    currentOnNewConnectionCallback = callbacks.onNewConnection || onNewConnectionCallback_default;

    try {
        if (typeof Peer === 'undefined') {
            console.error("PeerJS: Peer library (Peer constructor) is not loaded!");
            currentOnErrorCallback({type: 'init_failed', message: 'PeerJS library not loaded.', originalError: new Error('Peer is not defined')});
            return;
        }

        let peerIdToUse = null;
        let peerOptions = {
            // key: 'your-peerjs-api-key', // Optional: if you're using PeerServer Cloud
            // host: 'your-peerjs-server-host', // Optional: if self-hosting PeerServer
            // port: 9000, // Optional
            // path: '/myapp', // Optional
            debug: 2, // 0: none, 1: errors, 2: warnings, 3: verbose
            config: { // Add STUN server configuration
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    // You can add more STUN servers or a TURN server here if needed
                    // {
                    //   urls: 'turn:your.turn.server:3478',
                    //   username: 'yourUsername',
                    //   credential: 'yourPassword'
                    // }
                ]
            }
        };

        if (typeof options === 'string' || options === null) { // options is just a preferredId
            peerIdToUse = options;
        } else if (typeof options === 'object' && options !== null) {
            if(options.peerId) peerIdToUse = options.peerId; // Allow passing preferred ID via options object
            if(options.config) peerOptions.config = {...peerOptions.config, ...options.config};
            if(options.key) peerOptions.key = options.key;
            if(options.host) peerOptions.host = options.host;
            if(options.port) peerOptions.port = options.port;
            if(options.path) peerOptions.path = options.path;
            if(options.debug) peerOptions.debug = options.debug;
        }


        if (peerIdToUse) {
            console.log(`PeerJS: Initializing with preferred ID: ${peerIdToUse} and options:`, peerOptions);
            peer = new Peer(peerIdToUse, peerOptions); 
        } else {
            console.log("PeerJS: Initializing with auto-assigned ID and options:", peerOptions);
            peer = new Peer(peerOptions); // Let PeerServer assign an ID
        }
    } catch (error) {
        console.error("PeerJS: Failed to create Peer object.", error);
        currentOnErrorCallback({type: 'init_failed', message: 'Failed to create Peer object.', originalError: error});
        return;
    }

    peer.on('open', (id) => {
        localPeerId = id;
        console.log('PeerJS: Peer.on("open") event. My peer ID is:', id);
        if (currentOnPeerOpenCallback) {
            currentOnPeerOpenCallback(id);
        }
    });

    peer.on('connection', (conn) => {
        console.log('PeerJS: Peer.on("connection") event. Incoming connection from', conn.peer);
        if (currentOnNewConnectionCallback) { 
            currentOnNewConnectionCallback(conn); // Let higher-level module (peerConnection.js) handle it
        } else {
            // Fallback if no specific handler (should not happen with peerConnection.js)
            console.warn("PeerJS: No onNewConnectionCallback registered, default handling (may reject).");
            if (currentConnection && currentConnection.open) {
                conn.on('open', () => conn.close());
                return;
            }
            currentConnection = conn; // Not ideal for multi-connection host
            setupConnectionEventHandlers(currentConnection);
        }
    });

    peer.on('disconnected', () => {
        console.log('PeerJS: Peer.on("disconnected") event. Disconnected from PeerServer.');
        if (currentOnErrorCallback) currentOnErrorCallback({type: 'disconnected', message: 'Disconnected from PeerServer.'});
    });

    peer.on('close', () => { // This event means the peer is fully closed and its ID is unusable.
        console.log('PeerJS: Peer.on("close") event. Peer object closed (local peer.destroy() was called).');
        localPeerId = null; // ID is no longer valid
        // currentOnConnectionCloseCallback might be relevant if it implies all connections are gone.
        // However, individual DataConnection close events are usually handled separately.
        // This event signifies the Peer object itself is gone.
    });

    peer.on('error', (err) => {
        console.error('PeerJS: Peer.on("error") event:', err.type, err.message || err);
        if (currentOnErrorCallback) {
            currentOnErrorCallback(err);
        }
    });
}

function setupConnectionEventHandlers(conn) {
    // These handlers use the module-level 'current' callbacks
    conn.on('open', () => {
        console.log(`PeerJS: DataConnection.on("open") with ${conn.peer}.`);
        if (currentOnConnectionOpenCallback) {
            currentOnConnectionOpenCallback(conn.peer);
        }
    });

    conn.on('data', (data) => {
        // console.log(`PeerJS: DataConnection.on("data") from ${conn.peer}:`, data); // Can be very verbose
        if (currentOnDataReceivedCallback) {
            currentOnDataReceivedCallback(data, conn.peer); 
        }
    });

    conn.on('close', () => { // This means this specific DataConnection closed.
        console.log(`PeerJS: DataConnection.on("close") with ${conn.peer}.`);
        if (currentOnConnectionCloseCallback) {
            currentOnConnectionCloseCallback(conn.peer);
        }
        if (conn === currentConnection) { 
            currentConnection = null;
        }
    });

    conn.on('error', (err) => {
        console.error(`PeerJS: DataConnection.on("error") with ${conn.peer}:`, err.type, err.message || err);
        if (currentOnErrorCallback) {
            currentOnErrorCallback({type: 'connection_error', peer: conn.peer, originalError: err});
        }
    });
}

function connectToPeer(hostPeerId) {
    if (!peer || peer.destroyed) {
        console.error("PeerJS: connectToPeer - Peer object not initialized or destroyed. Call initPeerSession first.");
        currentOnErrorCallback({type: 'not_initialized', message: 'PeerJS not initialized for connectToPeer.'});
        return null; 
    }
    // For a client, currentConnection is its single connection to the host.
    if (currentConnection && currentConnection.open && currentConnection.peer === hostPeerId) {
        console.warn(`PeerJS: connectToPeer - Already connected to ${hostPeerId}.`);
        return currentConnection; 
    }
    if (currentConnection && currentConnection.peer === hostPeerId && !currentConnection.open) {
        console.warn(`PeerJS: connectToPeer - Already attempting to connect to ${hostPeerId}.`);
        return currentConnection;
    }
     if (currentConnection && currentConnection.open && currentConnection.peer !== hostPeerId) {
        console.warn(`PeerJS: connectToPeer - Already connected to a different peer (${currentConnection.peer}). Closing it before connecting to ${hostPeerId}.`);
        currentConnection.close();
        currentConnection = null;
    }


    console.log(`PeerJS: Attempting to connect to host with ID: ${hostPeerId}`);
    let newConnection = null;
    try {
        newConnection = peer.connect(hostPeerId, {
            reliable: true,
            serialization: 'json' // Explicitly set, though often default
        });

        if (!newConnection) {
            console.error("PeerJS: peer.connect() returned null or undefined. This is unexpected.");
            currentOnErrorCallback({type: 'connect_failed', message: 'peer.connect() failed to return a connection object.', peerId: hostPeerId });
            return null;
        }
        currentConnection = newConnection; // Track this as the primary outgoing connection
        setupConnectionEventHandlers(currentConnection); 
        return currentConnection; 

    } catch (error) {
        console.error("PeerJS: Error when trying to call peer.connect():", error);
        currentOnErrorCallback({type: 'connect_exception', message: 'Exception during peer.connect().', peerId: hostPeerId, originalError: error });
        return null;
    }
}


function sendData(data, connToSendTo = null) {
    const targetConn = connToSendTo || currentConnection; 

    if (targetConn && targetConn.open) {
        try {
            targetConn.send(data);
        } catch (error) {
            console.error("PeerJS: Error sending data:", error);
            if (currentOnErrorCallback) currentOnErrorCallback({type: 'send_error', message: 'Failed to send data.', originalError: error});
        }
    } else {
        console.warn("PeerJS: No open connection or connection not ready/specified. Cannot send data.");
        if (currentOnErrorCallback && (!targetConn || !targetConn.open) ) {
             currentOnErrorCallback({type: 'send_error_no_connection', message: 'No open connection to send data.'});
        }
    }
}

function closePeerSession() {
    console.log("PeerJS: Closing peer session (destroying local peer object)...");
    if (currentConnection) { // Close the client's primary connection if it exists
        try {
            if (currentConnection.open) { 
                currentConnection.close();
            }
        } catch (e) {
            console.warn("PeerJS: Error closing main data connection", e);
        }
        currentConnection = null; 
    }

    // For a host, peerConnection.js should iterate its `connections` map and close each one
    // before this function is called, or rely on peer.destroy().

    if (peer) {
        try {
            if (!peer.destroyed) {
                console.log("PeerJS: Calling peer.destroy().");
                peer.destroy(); 
                // Note: peer.destroy() itself will trigger the 'close' event on the peer object.
            } else {
                console.log("PeerJS: Peer object was already destroyed.");
            }
        } catch (e) {
            console.warn("PeerJS: Error destroying peer object", e);
        }
        peer = null; 
    }
    localPeerId = null; 
}

function getLocalPeerId() {
    return localPeerId;
}

function getPeer() {
    return peer; 
}

function getConnection(targetPeerId) {
    if (!peer || peer.destroyed) {
        console.warn("getConnection: Peer object not available or destroyed.");
        return null;
    }
    
    if (currentConnection && currentConnection.peer === targetPeerId && currentConnection.open) {
        return currentConnection;
    }

    if (peer.connections && peer.connections[targetPeerId]) {
        const connectionsToPeer = peer.connections[targetPeerId];
        for (let i = 0; i < connectionsToPeer.length; i++) {
            if (connectionsToPeer[i].open) {
                return connectionsToPeer[i]; 
            }
        }
    }
    
    // console.log(`getConnection: No open connection found to peer ${targetPeerId}.`); // Can be noisy
    return null;
}

window.peerJsMultiplayer = {
    init: initPeerSession,
    connect: connectToPeer,
    send: sendData,
    close: closePeerSession,
    getLocalId: getLocalPeerId,
    getPeer: getPeer,          
    getConnection: getConnection 
};

console.log("PeerJS multiplayer script loaded and attached to window.peerJsMultiplayer.");