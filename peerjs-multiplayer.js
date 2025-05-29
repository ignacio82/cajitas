// peerjs-multiplayer.js
console.log("DEBUG: peerjs-multiplayer.js script execution started."); 

let peer = null; 
let currentConnection = null; 
let localPeerId = null;

let onPeerOpenCallback = (id) => console.log('PeerJS: Default - My peer ID is:', id);
let onConnectionOpenCallback = () => console.log('PeerJS: Default - Connection opened!');
let onDataReceivedCallback = (data) => console.log('PeerJS: Default - Data received:', data);
let onConnectionCloseCallback = () => console.log('PeerJS: Default - Connection closed.');
let onErrorCallback = (err) => console.error('PeerJS: Default - Error:', err);
let onNewConnectionCallback = (conn) => console.log('PeerJS: Default - New incoming connection', conn);


function initPeerSession(preferredId = null, callbacks = {}) {
    if (peer && !peer.destroyed) { // Check if peer exists and is not destroyed
        console.warn("PeerJS: Peer object already exists and is not destroyed. Closing existing session before creating a new one.");
        closePeerSession();
    } else if (peer && peer.destroyed) {
        console.log("PeerJS: Peer object was already destroyed. Ready for new initialization.");
        peer = null; // Ensure peer is null if it was destroyed
    }


    onPeerOpenCallback = callbacks.onPeerOpen || onPeerOpenCallback;
    onConnectionOpenCallback = callbacks.onConnectionOpen || onConnectionOpenCallback;
    onDataReceivedCallback = callbacks.onDataReceived || onDataReceivedCallback;
    onConnectionCloseCallback = callbacks.onConnectionClose || onConnectionCloseCallback;
    onErrorCallback = callbacks.onError || onErrorCallback;
    onNewConnectionCallback = callbacks.onNewConnection || onNewConnectionCallback;

    try {
        if (typeof Peer === 'undefined') {
            console.error("PeerJS: Peer library (Peer constructor) is not loaded!");
            if (onErrorCallback) onErrorCallback({type: 'init_failed', message: 'PeerJS library not loaded.', originalError: new Error('Peer is not defined')});
            return;
        }

        if (preferredId) {
            peer = new Peer(preferredId); 
        } else {
            peer = new Peer(); 
        }
    } catch (error) {
        console.error("PeerJS: Failed to create Peer object.", error);
        if (onErrorCallback) onErrorCallback({type: 'init_failed', message: 'Failed to create Peer object.', originalError: error});
        return;
    }

    peer.on('open', (id) => {
        localPeerId = id;
        console.log('PeerJS: My peer ID is:', id);
        if (onPeerOpenCallback) {
            onPeerOpenCallback(id);
        }
    });

    peer.on('connection', (conn) => {
        console.log('PeerJS: Incoming connection from', conn.peer);
        // Modified logic for handling multiple connections if this peer is a host
        // The currentConnection variable is more suited for a client that connects to one host,
        // or a host that only expects one client.
        // For a host that can have multiple clients, onNewConnectionCallback should handle
        // storing and managing these connections (e.g., in a map in peerConnection.js).
        
        // Example of how a host might handle multiple connections (actual management is in peerConnection.js):
        // if (IS_HOST_EXPECTING_MULTIPLE_CLIENTS) { // This flag would be app-specific
        //     if (onNewConnectionCallback) {
        //         onNewConnectionCallback(conn); // Let the higher-level module manage it
        //     }
        //     // setupConnectionEventHandlers(conn); // Higher-level module should also do this
        // } else {
            // Original logic for single connection or client
            if (currentConnection && currentConnection.open) {
                console.warn(`PeerJS: Already connected to ${currentConnection.peer}. Rejecting new connection from ${conn.peer}.`);
                if (conn.open) {
                    conn.close();
                } else {
                    conn.on('open', () => conn.close()); 
                }
                return;
            }
            currentConnection = conn;
            if (onNewConnectionCallback) { // This is usually for the host/leader in peerConnection.js
                onNewConnectionCallback(conn);
            } else { // If no specific callback, set up handlers directly (less common for host)
                setupConnectionEventHandlers(currentConnection);
            }
        // }
    });

    peer.on('disconnected', () => {
        console.log('PeerJS: Disconnected from PeerServer.'); // PeerJS v1.x attempts auto-reconnect
        if (onErrorCallback) onErrorCallback({type: 'disconnected', message: 'Disconnected from PeerServer.'});
    });

    peer.on('close', () => {
        console.log('PeerJS: Peer object closed (local peer.destroy() was called).');
        localPeerId = null;
        // currentConnection related cleanup should happen in its own 'close' or error events,
        // or when peer is destroyed.
    });

    peer.on('error', (err) => {
        console.error('PeerJS: Error:', err);
        if (onErrorCallback) {
            onErrorCallback(err);
        }
    });
}

function setupConnectionEventHandlers(conn) {
    conn.on('open', () => {
        console.log(`PeerJS: Data connection opened with ${conn.peer}. Ready to send/receive data.`);
        // If this is the 'currentConnection' (client's connection to host, or host to a specific client)
        if (conn === currentConnection) {
            if (onConnectionOpenCallback) {
                onConnectionOpenCallback(conn.peer); // Pass peerId for context
            }
        } else {
            // For other connections managed by a host, the host logic (e.g. peerConnection.js)
            // would have its own onConnectionOpen logic tied to its connection map.
            // This generic setup is a fallback or for simpler P2P.
             if (onConnectionOpenCallback) { // Call it anyway if defined
                onConnectionOpenCallback(conn.peer);
            }
        }
    });

    conn.on('data', (data) => {
        if (onDataReceivedCallback) {
            onDataReceivedCallback(data, conn.peer); // Pass data and sender's peerId
        }
    });

    conn.on('close', () => {
        console.log(`PeerJS: Data connection with ${conn.peer} closed.`);
        if (conn === currentConnection) { // If it was the primary tracked connection
            if (onConnectionCloseCallback) {
                onConnectionCloseCallback(conn.peer);
            }
            currentConnection = null;
        } else {
            // For other connections (e.g. host with multiple clients), peerConnection.js handles this.
            if (onConnectionCloseCallback) { // Call it anyway if defined
                 onConnectionCloseCallback(conn.peer);
            }
        }
    });

    conn.on('error', (err) => {
        console.error(`PeerJS: Data connection error with ${conn.peer}:`, err);
        if (onErrorCallback) {
            onErrorCallback({type: 'connection_error', peer: conn.peer, originalError: err});
        }
    });
}

function connectToPeer(hostPeerId) {
    if (!peer || peer.destroyed) {
        console.error("PeerJS: Peer object not initialized or destroyed. Call initPeerSession first.");
        if (onErrorCallback) onErrorCallback({type: 'not_initialized', message: 'PeerJS not initialized or destroyed.'});
        return null; // Return null on failure
    }
    if (currentConnection && currentConnection.open) {
        console.warn(`PeerJS: Already connected to ${currentConnection.peer}. Please close it first if you want to connect to another peer.`);
        return currentConnection; // Return existing connection
    }
    if (currentConnection) { 
        console.warn(`PeerJS: Already attempting to connect to ${currentConnection.peer || 'a peer'}. Please wait or close the current attempt.`);
        return currentConnection; // Return existing attempt
    }

    console.log(`PeerJS: Attempting to connect to host with ID: ${hostPeerId}`);
    let newConnection = null;
    try {
        newConnection = peer.connect(hostPeerId, {
            reliable: true 
        });

        if (!newConnection) {
            console.error("PeerJS: peer.connect() returned null or undefined. This is unexpected.");
            if (onErrorCallback) onErrorCallback({type: 'connect_failed', message: 'peer.connect() failed to return a connection object.', peerId: hostPeerId });
            return null;
        }
        // Set as currentConnection if this is the primary outgoing connection for a client
        currentConnection = newConnection; 
        setupConnectionEventHandlers(currentConnection); // Setup handlers immediately
        return currentConnection; // Return the connection object (which will emit 'open' or 'error')

    } catch (error) {
        console.error("PeerJS: Error when trying to call peer.connect():", error);
        if (onErrorCallback) onErrorCallback({type: 'connect_exception', message: 'Exception during peer.connect().', peerId: hostPeerId, originalError: error });
        return null;
    }
}

function sendData(data, connToSendTo = null) {
    const targetConn = connToSendTo || currentConnection; // Use specific connection if provided, else default

    if (targetConn && targetConn.open) {
        try {
            targetConn.send(data);
        } catch (error) {
            console.error("PeerJS: Error sending data:", error);
            if (onErrorCallback) onErrorCallback({type: 'send_error', message: 'Failed to send data.', originalError: error});
        }
    } else {
        console.warn("PeerJS: No open connection or connection not ready/specified. Cannot send data.");
        if (onErrorCallback && (!targetConn || !targetConn.open) ) {
             onErrorCallback({type: 'send_error_no_connection', message: 'No open connection to send data.'});
        }
    }
}

function closePeerSession() {
    console.log("PeerJS: Closing peer session (destroying local peer object)...");
    if (currentConnection) {
        try {
            if (currentConnection.open) { 
                currentConnection.close();
                console.log("PeerJS: Main data connection closed.");
            } else {
                console.log("PeerJS: Main data connection was not open or did not exist.");
            }
        } catch (e) {
            console.warn("PeerJS: Error closing main data connection", e);
        }
        currentConnection = null; 
    }

    // For a host managing multiple connections, those should be closed by the higher-level logic (peerConnection.js)
    // before destroying the peer object. peer.destroy() will sever all connections anyway.

    if (peer) {
        try {
            if (!peer.destroyed) {
                peer.destroy(); 
                console.log("PeerJS: Peer object destroyed.");
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

/**
 * Gets the peer object (for checking if initialized or accessing underlying peer features).
 * @returns {Peer|null} The peer object or null if not initialized/destroyed.
 */
function getPeer() {
    return peer; // Returns the actual Peer instance
}

/**
 * Gets an existing open DataConnection to a specific peer ID.
 * This is a basic implementation; robust multi-connection management is usually in a higher layer.
 * @param {string} targetPeerId - The peer ID of the desired connection.
 * @returns {Peer.DataConnection|null} The open DataConnection or null if not found/not open.
 */
function getConnection(targetPeerId) {
    if (!peer || peer.destroyed) {
        console.warn("getConnection: Peer object not available or destroyed.");
        return null;
    }
    
    // Check the 'currentConnection' (if it matches)
    if (currentConnection && currentConnection.peer === targetPeerId && currentConnection.open) {
        return currentConnection;
    }

    // Check the peer.connections map (stores arrays of connections per peerId)
    // Note: peer.connections structure can vary or be internal; use with caution.
    if (peer.connections && peer.connections[targetPeerId]) {
        const connectionsToPeer = peer.connections[targetPeerId];
        for (let i = 0; i < connectionsToPeer.length; i++) {
            if (connectionsToPeer[i].open) {
                return connectionsToPeer[i]; // Return the first open connection found
            }
        }
    }
    
    console.log(`getConnection: No open connection found to peer ${targetPeerId}.`);
    return null;
}


window.peerJsMultiplayer = {
    init: initPeerSession,
    connect: connectToPeer,
    send: sendData,
    close: closePeerSession,
    getLocalId: getLocalPeerId,
    getPeer: getPeer,          // Added
    getConnection: getConnection // Added
};

console.log("PeerJS multiplayer script loaded and attached to window.peerJsMultiplayer.");