// ============================================================
// HUSH - Network Manager (Peer-to-Peer Multiplayer & Voice)
// ============================================================
// Supports Room Codes (e.g. HUSH-7A9B), P2P Data sync via WebRTC (PeerJS),
// Proximity Voice Chat streaming with Web Audio attenuation,
// and BroadcastChannel for seamless local tab-to-tab multi-instance testing.

class NetworkManager {
    constructor() {
        this.isHost = false;
        this.roomCode = null;
        this.peerId = null;
        this.peer = null;
        this.connections = new Map(); // peerId -> DataConnection
        this.calls = new Map();       // peerId -> MediaConnection
        this.remotePlayers = {};      // peerId -> player state object
        this.localStream = null;
        this.micMuted = false;
        this.isTalking = false;
        this.playerName = 'Player_' + Math.floor(100 + Math.random() * 900);
        this.playerColorIndex = 0;
        
        // BroadcastChannel fallback for multi-tab testing on the same computer
        this.bc = null;
        try {
            if (typeof BroadcastChannel !== 'undefined') {
                this.bc = new BroadcastChannel('hush_lan_room');
                this.bc.onmessage = (e) => this.handleBroadcastMessage(e.data);
            }
        } catch (e) {}

        this.syncTimer = 0;
        this.syncInterval = 0.05; // 20 updates per second (50ms)
        this.onPlayerChangeCallback = null;
        this.onEventCallback = null;
    }

    /**
     * Request microphone access for real-time proximity voice chat
     */
    async initLocalVoice() {
        if (this.localStream) return this.localStream;
        try {
            if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                this.localStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true
                    },
                    video: false
                });
                return this.localStream;
            }
        } catch (e) {
            console.warn('Microphone access denied or unavailable for voice chat:', e);
        }
        return null;
    }

    /**
     * Generate a 4 or 5 character uppercase room code
     */
    generateRoomCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = 'HUSH-';
        for (let i = 0; i < 4; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }

    /**
     * Create a multiplayer group / room as Host
     * @param {string} customCode
     * @param {Function} onPlayerListChange
     */
    async createGroup(customCode, onPlayerListChange) {
        this.isHost = true;
        this.roomCode = customCode || this.generateRoomCode();
        this.playerColorIndex = 0;
        this.onPlayerChangeCallback = onPlayerListChange;

        await this.initLocalVoice();

        // Unique Peer ID prefixed to prevent collisions on public broker
        const normalizedPeerId = 'hush-group-' + this.roomCode.toLowerCase().replace(/[^a-z0-9]/g, '');

        if (typeof Peer === 'undefined') {
            console.warn('PeerJS library not loaded, falling back to local BroadcastChannel.');
            if (this.onPlayerChangeCallback) {
                this.onPlayerChangeCallback(this.getPlayerList());
            }
            return this.roomCode;
        }

        try {
            if (this.peer) this.peer.destroy();
            this.peer = new Peer(normalizedPeerId, {
                debug: 1,
                config: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' }
                    ]
                }
            });

            this.peer.on('open', (id) => {
                this.peerId = id;
                console.log(`[Multiplayer] Host created group with room code: ${this.roomCode}`);
                if (this.onPlayerChangeCallback) {
                    this.onPlayerChangeCallback(this.getPlayerList());
                }
            });

            this.peer.on('connection', (conn) => {
                this.setupConnection(conn);
            });

            this.peer.on('call', (call) => {
                // Answer incoming voice call with local mic stream
                if (this.localStream) {
                    call.answer(this.localStream);
                } else {
                    call.answer();
                }
                call.on('stream', (remoteStream) => {
                    if (window.audioManager && typeof window.audioManager.addPeerStream === 'function') {
                        window.audioManager.addPeerStream(call.peer, remoteStream);
                    }
                });
                this.calls.set(call.peer, call);
            });

            this.peer.on('error', (err) => {
                console.warn('[Multiplayer Host Error]:', err);
            });
        } catch (e) {
            console.warn('Failed to initialize PeerJS host:', e);
        }

        if (this.bc) {
            this.bc.postMessage({
                type: 'HOST_ANNOUNCE',
                roomCode: this.roomCode,
                hostName: this.playerName
            });
        }

        return this.roomCode;
    }

    /**
     * Join an existing multiplayer group as Client
     * @param {string} code
     * @param {Function} onConnected
     * @param {Function} onError
     */
    async joinGroup(code, onConnected, onError) {
        if (!code) {
            if (onError) onError('Please enter a valid room code.');
            return;
        }

        this.isHost = false;
        this.roomCode = code.trim().toUpperCase();
        await this.initLocalVoice();

        const hostPeerId = 'hush-group-' + this.roomCode.toLowerCase().replace(/[^a-z0-9]/g, '');

        if (typeof Peer === 'undefined') {
            console.warn('PeerJS not available, connecting via local broadcast channel');
            if (this.bc) {
                this.bc.postMessage({
                    type: 'CLIENT_JOIN',
                    roomCode: this.roomCode,
                    peerId: 'local_' + Math.random().toString(36).substr(2, 6),
                    name: this.playerName
                });
            }
            if (onConnected) onConnected(this.roomCode);
            return;
        }

        try {
            if (this.peer) this.peer.destroy();
            this.peer = new Peer({
                debug: 1,
                config: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' }
                    ]
                }
            });

            this.peer.on('open', (id) => {
                this.peerId = id;
                console.log(`[Multiplayer Client] Connected to signaling with ID: ${id}`);
                const conn = this.peer.connect(hostPeerId, { reliable: true });
                this.setupConnection(conn);

                // Call host with voice stream
                if (this.localStream) {
                    const call = this.peer.call(hostPeerId, this.localStream);
                    if (call) {
                        call.on('stream', (remoteStream) => {
                            if (window.audioManager && typeof window.audioManager.addPeerStream === 'function') {
                                window.audioManager.addPeerStream(hostPeerId, remoteStream);
                            }
                        });
                        this.calls.set(hostPeerId, call);
                    }
                }

                if (onConnected) onConnected(this.roomCode);
            });

            this.peer.on('call', (call) => {
                if (this.localStream) {
                    call.answer(this.localStream);
                } else {
                    call.answer();
                }
                call.on('stream', (remoteStream) => {
                    if (window.audioManager && typeof window.audioManager.addPeerStream === 'function') {
                        window.audioManager.addPeerStream(call.peer, remoteStream);
                    }
                });
                this.calls.set(call.peer, call);
            });

            this.peer.on('error', (err) => {
                console.warn('[Multiplayer Join Error]:', err);
                if (onError) onError('Could not connect to group: ' + (err.message || 'Room not found'));
            });
        } catch (e) {
            if (onError) onError('Connection failed: ' + e.message);
        }
    }

    /**
     * Configure a PeerJS Data Connection
     */
    setupConnection(conn) {
        conn.on('open', () => {
            console.log(`[Multiplayer] Data channel connected with peer: ${conn.peer}`);
            this.connections.set(conn.peer, conn);

            // Announce self
            conn.send({
                type: 'PLAYER_JOIN',
                id: this.peerId,
                name: this.playerName,
                colorIndex: this.isHost ? 0 : (Object.keys(this.remotePlayers).length + 1)
            });

            if (this.onPlayerChangeCallback) {
                this.onPlayerChangeCallback(this.getPlayerList());
            }
        });

        conn.on('data', (data) => {
            this.handleData(conn.peer, data);
        });

        conn.on('close', () => {
            console.log(`[Multiplayer] Peer disconnected: ${conn.peer}`);
            this.removePeer(conn.peer);
        });

        conn.on('error', (err) => {
            console.warn(`[Multiplayer] Peer connection error:`, err);
            this.removePeer(conn.peer);
        });
    }

    /**
     * Handle incoming peer data messages
     */
    handleData(peerId, data) {
        if (!data || !data.type) return;

        switch (data.type) {
            case 'PLAYER_JOIN':
                this.remotePlayers[peerId] = {
                    id: peerId,
                    name: data.name || ('Friend_' + peerId.substr(0, 4)),
                    colorIndex: data.colorIndex || (Object.keys(this.remotePlayers).length + 1),
                    x: 0,
                    y: 0,
                    angle: 0,
                    flashlightOn: true,
                    stonesCollected: 0,
                    hasRelic: false,
                    isHiding: false,
                    isTalking: false,
                    distance: 0
                };
                if (this.onPlayerChangeCallback) {
                    this.onPlayerChangeCallback(this.getPlayerList());
                }
                break;

            case 'PLAYER_STATE':
                if (!this.remotePlayers[peerId]) {
                    this.remotePlayers[peerId] = {
                        id: peerId,
                        name: data.name || 'Friend',
                        colorIndex: data.colorIndex || 1
                    };
                }
                const rp = this.remotePlayers[peerId];
                rp.x = data.x;
                rp.y = data.y;
                rp.angle = data.angle;
                rp.flashlightOn = !!data.flashlightOn;
                rp.flashlightAngle = data.flashlightAngle || data.angle;
                rp.isSneaking = !!data.isSneaking;
                rp.isRunning = !!data.isRunning;
                rp.isHiding = !!data.isHiding;
                rp.stonesCollected = data.stonesCollected || 0;
                rp.hasRelic = !!data.hasRelic;
                rp.isTalking = !!data.isTalking;
                break;

            case 'GHOST_STATE':
                // Client receives ghost position and state from Host
                if (!this.isHost && window.hushGame && window.hushGame.listener) {
                    const l = window.hushGame.listener;
                    l.x = data.x;
                    l.y = data.y;
                    l.angle = data.angle;
                    l.state = data.state;
                    if (data.isDead && !l.isDead) {
                        l.banish();
                    }
                }
                break;

            case 'ACTION_EVENT':
                if (this.onEventCallback) {
                    this.onEventCallback(data.action);
                }
                break;
        }
    }

    /**
     * Handle local BroadcastChannel messages
     */
    handleBroadcastMessage(data) {
        if (!data || !this.roomCode || data.roomCode !== this.roomCode) return;
        if (data.senderId && data.senderId === this.peerId) return;

        if (data.type === 'BC_PLAYER_STATE') {
            const pid = data.senderId;
            if (!this.remotePlayers[pid]) {
                this.remotePlayers[pid] = {
                    id: pid,
                    name: data.name || 'Friend',
                    colorIndex: data.colorIndex || 1
                };
                if (this.onPlayerChangeCallback) {
                    this.onPlayerChangeCallback(this.getPlayerList());
                }
            }
            const rp = this.remotePlayers[pid];
            rp.x = data.x;
            rp.y = data.y;
            rp.angle = data.angle;
            rp.flashlightOn = data.flashlightOn;
            rp.flashlightAngle = data.flashlightAngle;
            rp.stonesCollected = data.stonesCollected || 0;
            rp.hasRelic = data.hasRelic;
            rp.isHiding = data.isHiding;
            rp.isTalking = data.isTalking;
        } else if (data.type === 'BC_ACTION_EVENT') {
            if (this.onEventCallback) {
                this.onEventCallback(data.action);
            }
        }
    }

    /**
     * Broadcast an action event (Stone pickup, Ghost banish, Escape victory)
     */
    sendAction(action) {
        const msg = { type: 'ACTION_EVENT', action };
        this.broadcast(msg);
        if (this.bc && this.roomCode) {
            this.bc.postMessage({
                type: 'BC_ACTION_EVENT',
                roomCode: this.roomCode,
                senderId: this.peerId,
                action
            });
        }
    }

    /**
     * Broadcast payload to all connected peers
     */
    broadcast(payload) {
        for (const conn of this.connections.values()) {
            if (conn.open) {
                try {
                    conn.send(payload);
                } catch (e) {}
            }
        }
    }

    /**
     * Remove peer upon disconnect
     */
    removePeer(peerId) {
        this.connections.delete(peerId);
        this.calls.delete(peerId);
        delete this.remotePlayers[peerId];
        if (window.audioManager && typeof window.audioManager.removePeerStream === 'function') {
            window.audioManager.removePeerStream(peerId);
        }
        if (this.onPlayerChangeCallback) {
            this.onPlayerChangeCallback(this.getPlayerList());
        }
    }

    /**
     * Toggle local microphone mute
     */
    toggleMic() {
        this.micMuted = !this.micMuted;
        if (this.localStream) {
            this.localStream.getAudioTracks().forEach(track => {
                track.enabled = !this.micMuted;
            });
        }
        return !this.micMuted;
    }

    /**
     * Get active player count where each player has collected at least 2 diamonds.
     * Used to calculate the simultaneous 1/50 danger line reduction.
     */
    getQualifyingPlayerCount(localPlayer) {
        let count = 0;
        if (localPlayer && localPlayer.stonesCollected >= 2) {
            count++;
        }
        for (const rp of Object.values(this.remotePlayers)) {
            if (rp.stonesCollected >= 2) {
                count++;
            }
        }
        return count;
    }

    /**
     * Get array of all connected players for lobby and HUD
     */
    getPlayerList() {
        const list = [
            {
                id: this.peerId || 'local',
                name: this.playerName + ' (You)' + (this.isHost ? ' [Host]' : ''),
                isHost: this.isHost,
                isTalking: this.isTalking,
                isMuted: this.micMuted
            }
        ];
        for (const rp of Object.values(this.remotePlayers)) {
            list.push({
                id: rp.id,
                name: rp.name,
                isHost: false,
                isTalking: rp.isTalking,
                stonesCollected: rp.stonesCollected || 0,
                hasRelic: rp.hasRelic,
                distance: rp.distance || 0
            });
        }
        return list;
    }

    /**
     * Update loop called from Game.update()
     */
    update(dt, localPlayer, listener, audioManager) {
        if (!localPlayer) return;

        // Detect if local player is actively talking into microphone
        const micVal = audioManager ? (audioManager.micLevel || 0) : 0;
        this.isTalking = (!this.micMuted && micVal > 0.08);

        // Update proximity audio for all remote peers
        for (const rp of Object.values(this.remotePlayers)) {
            const d = dist(localPlayer.x, localPlayer.y, rp.x, rp.y);
            rp.distance = Math.round(d / 32); // Convert to meters/tiles
            if (audioManager && typeof audioManager.updatePeerProximity === 'function') {
                audioManager.updatePeerProximity(rp.id, d);
            }
        }

        // Send periodic state sync
        this.syncTimer += dt;
        if (this.syncTimer >= this.syncInterval) {
            this.syncTimer = 0;

            const playerMsg = {
                type: 'PLAYER_STATE',
                x: Math.round(localPlayer.x),
                y: Math.round(localPlayer.y),
                angle: localPlayer.angle,
                flashlightOn: localPlayer.flashlightOn,
                flashlightAngle: localPlayer.flashlightAngle,
                isSneaking: localPlayer.isSneaking,
                isRunning: localPlayer.isRunning,
                isHiding: localPlayer.isHiding,
                stonesCollected: localPlayer.stonesCollected,
                hasRelic: localPlayer.hasRelic,
                isTalking: this.isTalking
            };

            this.broadcast(playerMsg);

            if (this.bc && this.roomCode) {
                this.bc.postMessage({
                    type: 'BC_PLAYER_STATE',
                    roomCode: this.roomCode,
                    senderId: this.peerId || 'host',
                    name: this.playerName,
                    ...playerMsg
                });
            }

            // If Host, broadcast ghost state
            if (this.isHost && listener) {
                const ghostMsg = {
                    type: 'GHOST_STATE',
                    x: Math.round(listener.x),
                    y: Math.round(listener.y),
                    angle: listener.angle,
                    state: listener.state,
                    isDead: !!listener.isDead
                };
                this.broadcast(ghostMsg);
            }
        }
    }
}

if (typeof window !== 'undefined') {
    window.NetworkManager = NetworkManager;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { NetworkManager };
}
