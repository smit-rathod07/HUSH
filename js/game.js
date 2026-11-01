// ============================================================
// HUSH - Main Game Controller
// ============================================================
// Coordinates all systems: GameMap, AudioManager, Player, Listener, Renderer

class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.state = GAME_STATE.MENU;
        this.map = null;
        this.player = null;
        this.listener = null;
        this.listeners = [];
        this.renderer = null;
        this.audio = null;

        // Input state
        this.input = {
            up: false, down: false, left: false, right: false,
            moveX: 0, moveY: 0, isTouch: false,
            run: false, sneak: false,
            interact: false, hide: false, breath: false,
            flashlight: false, throw: false,
            talk: false, // Push-to-talk / simulated voice
            mouseX: 0, mouseY: 0,
            mouseWorldX: 0, mouseWorldY: 0,
            hasMouseMoved: false,
            aimWorldX: undefined,
            aimWorldY: undefined
        };
        this.keysJustPressed = {};
        this.touchJoyActive = false;
        this.touchJoyTouchId = null;
        this.touchJoyOriginX = 0;
        this.touchJoyOriginY = 0;

        // Timing
        this.lastTime = 0;
        this.dt = 0;
        this.elapsed = 0;
        this.fps = 0;
        this.fpsTimer = 0;
        this.frameCount = 0;

        // Audio & Step timing
        this.stepTimer = 0;
        this.ambientEventTimer = 0;
        this.nextAmbientEventTime = 12.0;

        // Calibration state
        this.calibrationPhase = 0; // 0=waiting, 1=whisper, 2=talk, 3=shout, 4=done
        this.calibrationTimer = 0;
        this.calibrationDuration = 3.0; // seconds per phase

        // Room name display
        this.currentRoomName = '';
        this.roomNameAlpha = 0;
        this.roomNameTimer = 0;
        this.lastRoomName = '';

        // Flashback state
        this.flashbackStoneId = -1;
        this.flashbackProgress = 0;
        this.flashbackDuration = 3.2;

        // Hint text
        this.hintText = '';
        this.hintAlpha = 0;

        // Final Escape Act
        this.finalEscapeActive = false;
        this.finalEscapeTimer = 0;

        // Map overlay toggle
        this.showFullMap = false;

        // Game stats
        this.playTime = 0;
        this.deathCount = 0;

        // Multiplayer Networking
        this.network = null;

        // Origin Story Cutscene
        this.cutscene = (typeof StoryCutscene !== 'undefined') ? new StoryCutscene() : null;
    }

    async init() {
        // Set up canvas
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());

        // Create renderer
        this.renderer = new Renderer(this.canvas);

        // Create audio manager
        this.audio = new AudioManager();
        window.audioManager = this.audio;

        // Create cutscene system
        if (!this.cutscene && typeof StoryCutscene !== 'undefined') {
            this.cutscene = new StoryCutscene();
        }

        // Create network manager
        if (typeof NetworkManager !== 'undefined') {
            this.network = new NetworkManager();
            this.renderer.network = this.network;
            this.setupNetworkCallbacks();
        }

        // Set up input handlers (keyboard & mouse)
        this.setupInput();

        // Set up mobile touch controls
        this.setupTouchControls();

        // Unlock Web Audio context on first user touch gesture (mobile policy)
        ['touchstart', 'touchend', 'click'].forEach(evt => {
            window.addEventListener(evt, () => {
                if (this.audio && this.audio.ctx && this.audio.ctx.state === 'suspended') {
                    this.audio.ctx.resume();
                }
            }, { once: true, passive: true });
        });

        // Set up multiplayer lobby UI
        this.setupMultiplayerUI();

        // Listen for listener mimic events
        window.addEventListener('listenerMimic', (e) => {
            if (this.renderer && e.detail) {
                // Add an ominous auditory disturbance ripple at mimic position
                this.renderer.addParticle(e.detail.x, e.detail.y, 0, 0, 1.2, 8, 'rgba(255, 60, 60, 0.4)', 'smoke');
            }
        });

        // Hide loading screen
        const loading = document.getElementById('loading');
        if (loading) {
            loading.classList.add('hidden');
            setTimeout(() => { loading.style.display = 'none'; }, 1000);
        }

        // Show menu
        this.showScreen('menuScreen');

        // Start game loop
        this.lastTime = performance.now();
        requestAnimationFrame((t) => this.loop(t));
    }

    resizeCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        if (this.renderer) {
            this.renderer.resize(this.canvas.width, this.canvas.height);
        }
    }

    // ---- Input Handling ----

    setupInput() {
        // Keyboard
        window.addEventListener('keydown', (e) => this.onKeyDown(e));
        window.addEventListener('keyup', (e) => this.onKeyUp(e));

        // Mouse
        window.addEventListener('mousemove', (e) => this.onMouseMove(e));
        window.addEventListener('mousedown', (e) => this.onMouseDown(e));
        window.addEventListener('mouseup', (e) => this.onMouseUp(e));

        // Click to start
        window.addEventListener('click', (e) => this.onClick(e));

        // Prevent context menu
        window.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    setupTouchControls() {
        // 1. Force Landscape Button Handler
        const forceBtn = document.getElementById('forceLandscapeBtn');
        if (forceBtn) {
            forceBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                document.body.classList.add('force-landscape');
                document.body.classList.add('is-touch');
                this.input.isTouch = true;
                const overlay = document.getElementById('orientationOverlay');
                if (overlay) overlay.style.display = 'none';
                if (this.audio && this.audio.ctx && this.audio.ctx.state === 'suspended') {
                    this.audio.ctx.resume().catch(() => {});
                }
                if (document.documentElement.requestFullscreen) {
                    document.documentElement.requestFullscreen().catch(() => {});
                }
                if (screen.orientation && screen.orientation.lock) {
                    screen.orientation.lock('landscape').catch(() => {});
                }
            });
        }

        // 2. Virtual Analog Joystick
        const joyBase = document.getElementById('joystickBase');
        const joyThumb = document.getElementById('joystickThumb');
        const joyZone = document.getElementById('joystickZone');

        if (joyZone && joyBase && joyThumb) {
            const maxRadius = 45; // Max thumb offset in pixels

            const handleJoyStart = (e) => {
                e.preventDefault();
                e.stopPropagation();
                document.body.classList.add('is-touch');
                this.input.isTouch = true;
                const touch = e.changedTouches[0];
                if (!touch) return;
                this.touchJoyActive = true;
                this.touchJoyTouchId = touch.identifier;
                const rect = joyBase.getBoundingClientRect();
                this.touchJoyOriginX = rect.left + rect.width / 2;
                this.touchJoyOriginY = rect.top + rect.height / 2;
                handleJoyMove(e);
            };

            const handleJoyMove = (e) => {
                if (!this.touchJoyActive) return;
                let touch = null;
                for (let i = 0; i < e.touches.length; i++) {
                    if (e.touches[i].identifier === this.touchJoyTouchId) {
                        touch = e.touches[i];
                        break;
                    }
                }
                if (!touch) return;
                e.preventDefault();

                let dx = touch.clientX - this.touchJoyOriginX;
                let dy = touch.clientY - this.touchJoyOriginY;
                const distVal = Math.sqrt(dx * dx + dy * dy);

                if (distVal > maxRadius) {
                    dx = (dx / distVal) * maxRadius;
                    dy = (dy / distVal) * maxRadius;
                }

                joyThumb.style.transform = `translate(${dx}px, ${dy}px)`;

                const normX = dx / maxRadius;
                const normY = dy / maxRadius;
                this.input.moveX = normX;
                this.input.moveY = normY;
                this.input.isTouch = true;
            };

            const handleJoyEnd = (e) => {
                for (let i = 0; i < e.changedTouches.length; i++) {
                    if (e.changedTouches[i].identifier === this.touchJoyTouchId) {
                        e.preventDefault();
                        this.touchJoyActive = false;
                        this.touchJoyTouchId = null;
                        this.input.moveX = 0;
                        this.input.moveY = 0;
                        joyThumb.style.transform = 'translate(0px, 0px)';
                        break;
                    }
                }
            };

            joyZone.addEventListener('touchstart', handleJoyStart, { passive: false });
            window.addEventListener('touchmove', handleJoyMove, { passive: false });
            window.addEventListener('touchend', handleJoyEnd, { passive: false });
            window.addEventListener('touchcancel', handleJoyEnd, { passive: false });
        }

        // 3. Right-Screen Touch Aiming (Look / Flashlight Direction)
        let aimTouchId = null;
        const handleAimStart = (e) => {
            if (this.state !== GAME_STATE.PLAYING) return;
            for (let i = 0; i < e.changedTouches.length; i++) {
                const t = e.changedTouches[i];
                if (t.clientX > window.innerWidth * 0.35) {
                    if (e.target && e.target.closest && e.target.closest('.touch-btn')) continue;
                    aimTouchId = t.identifier;
                    document.body.classList.add('is-touch');
                    this.input.isTouch = true;
                    if (this.renderer) {
                        this.input.aimWorldX = t.clientX + this.renderer.camX;
                        this.input.aimWorldY = t.clientY + this.renderer.camY;
                    }
                    break;
                }
            }
        };

        const handleAimMove = (e) => {
            if (aimTouchId === null) return;
            for (let i = 0; i < e.touches.length; i++) {
                const t = e.touches[i];
                if (t.identifier === aimTouchId) {
                    if (this.renderer) {
                        this.input.aimWorldX = t.clientX + this.renderer.camX;
                        this.input.aimWorldY = t.clientY + this.renderer.camY;
                    }
                    break;
                }
            }
        };

        const handleAimEnd = (e) => {
            for (let i = 0; i < e.changedTouches.length; i++) {
                if (e.changedTouches[i].identifier === aimTouchId) {
                    aimTouchId = null;
                    this.input.aimWorldX = undefined;
                    this.input.aimWorldY = undefined;
                    break;
                }
            }
        };

        window.addEventListener('touchstart', handleAimStart, { passive: true });
        window.addEventListener('touchmove', handleAimMove, { passive: true });
        window.addEventListener('touchend', handleAimEnd, { passive: true });
        window.addEventListener('touchcancel', handleAimEnd, { passive: true });

        // 4. Action Buttons bindings
        const bindTouchBtn = (id, onDown, onUp) => {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                e.stopPropagation();
                document.body.classList.add('is-touch');
                this.input.isTouch = true;
                btn.classList.add('active');
                if (typeof onDown === 'function') onDown();
            }, { passive: false });

            const release = (e) => {
                e.preventDefault();
                btn.classList.remove('active');
                if (typeof onUp === 'function') onUp();
            };
            btn.addEventListener('touchend', release, { passive: false });
            btn.addEventListener('touchcancel', release, { passive: false });
        };

        bindTouchBtn('touchFlashlight', () => this.handleFlashlight());
        bindTouchBtn('touchBreath', () => { this.input.breath = true; }, () => { this.input.breath = false; });
        bindTouchBtn('touchInteract', () => this.handleInteract());
        bindTouchBtn('touchThrow', () => this.handleThrow());
        bindTouchBtn('touchBanish', () => this.handleBanishRelic());
        bindTouchBtn('touchMap', () => this.toggleFullMap());
        bindTouchBtn('touchSneak', () => { this.input.sneak = !this.input.sneak; if (this.input.sneak) this.input.run = false; });
        bindTouchBtn('touchRun', () => { this.input.run = !this.input.run; if (this.input.run) this.input.sneak = false; });
    }

    setupNetworkCallbacks() {
        if (!this.network) return;

        this.network.onEventCallback = (event) => {
            if (event.type === 'RELIC_USED') {
                if (this.listener) this.listener.banish();
                if (this.audio) this.audio.playSound('ghost_banish');
                if (this.renderer) this.renderer.shakeScreen(10);
                this.showHint('✦ A teammate banished the Listener into oblivion! ✦');
            } else if (event.type === 'TEAM_ESCAPED') {
                this.showHint(`✦ ${event.senderName || 'Your squad'} unlocked the exit doors! ESCAPED TOGETHER! ✦`);
                this.triggerVictory();
            } else if (event.type === 'PLAYER_ESCAPED') {
                this.showHint(`✦ ${event.senderName || 'A teammate'} has escaped the building! ✦`);
                if (this.audio) this.audio.playSound('stone_pickup');
            } else if (event.type === 'STONE_COLLECTED') {
                this.showHint(`✦ ${event.senderName || 'A teammate'} collected a memory stone! ✦`);
                if (this.audio) this.audio.playSound('stone_pickup');
            } else if (event.type === 'GAME_START') {
                if (this.state === GAME_STATE.MENU || this.state === GAME_STATE.CALIBRATING) {
                    this.startGame();
                }
            }
        };

        this.network.onPlayerChangeCallback = () => {
            this.updateLobbyPlayerList();
        };

        this.network.onPeerChangeCallback = () => {
            this.updateLobbyPlayerList();
        };
    }

    setupMultiplayerUI() {
        const soloBtn = document.getElementById('soloBtn');
        const createGroupBtn = document.getElementById('createGroupBtn');
        const joinGroupBtn = document.getElementById('joinGroupBtn');
        const groupModal = document.getElementById('groupModal');
        const joinModal = document.getElementById('joinModal');
        const copyCodeBtn = document.getElementById('copyCodeBtn');
        const startGroupGameBtn = document.getElementById('startGroupGameBtn');
        const cancelGroupBtn = document.getElementById('cancelGroupBtn');
        const confirmJoinBtn = document.getElementById('confirmJoinBtn');
        const cancelJoinBtn = document.getElementById('cancelJoinBtn');
        const joinCodeInput = document.getElementById('joinCodeInput');

        const addHoverAudio = (btn) => {
            if (btn) {
                btn.addEventListener('mouseenter', () => {
                    if (this.audio) {
                        try {
                            const ctx = this.audio.getAudioContext();
                            if (ctx && ctx.state === 'running') {
                                this.audio.playSound('whisper');
                            }
                        } catch (err) {}
                    }
                });
            }
        };
        addHoverAudio(soloBtn);
        addHoverAudio(createGroupBtn);
        addHoverAudio(joinGroupBtn);

        if (soloBtn) {
            soloBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.startCalibration();
            });
        }

        if (createGroupBtn) {
            createGroupBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (groupModal) groupModal.classList.remove('hidden');
                if (this.network) {
                    const code = this.network.createGroup(null, (roomCode) => {
                        const codeDisplay = document.getElementById('roomCodeDisplay');
                        const finalCode = (typeof roomCode === 'string') ? roomCode : this.network.roomCode;
                        if (codeDisplay && finalCode) codeDisplay.textContent = finalCode;
                        this.updateLobbyPlayerList();
                    });
                    const codeDisplay = document.getElementById('roomCodeDisplay');
                    const finalCode = (typeof code === 'string') ? code : this.network.roomCode;
                    if (codeDisplay && finalCode) codeDisplay.textContent = finalCode;
                    this.updateLobbyPlayerList();
                }
            });
        }

        if (copyCodeBtn) {
            copyCodeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const code = this.network ? this.network.roomCode : '';
                if (code) {
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(code).then(() => {
                            copyCodeBtn.textContent = 'COPIED!';
                            setTimeout(() => { copyCodeBtn.textContent = 'COPY CODE'; }, 2000);
                        }).catch(() => {
                            copyCodeBtn.textContent = 'COPIED!';
                            setTimeout(() => { copyCodeBtn.textContent = 'COPY CODE'; }, 2000);
                        });
                    } else {
                        copyCodeBtn.textContent = 'COPIED!';
                        setTimeout(() => { copyCodeBtn.textContent = 'COPY CODE'; }, 2000);
                    }
                }
            });
        }

        if (startGroupGameBtn) {
            startGroupGameBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (groupModal) groupModal.classList.add('hidden');
                if (this.network) {
                    this.network.broadcastAction('GAME_START', {});
                }
                this.startCalibration();
            });
        }

        if (cancelGroupBtn) {
            cancelGroupBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (groupModal) groupModal.classList.add('hidden');
            });
        }

        if (joinGroupBtn) {
            joinGroupBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (joinModal) {
                    joinModal.classList.remove('hidden');
                    const status = document.getElementById('joinStatus');
                    if (status) { status.textContent = ''; status.className = 'modal-status'; }
                    if (joinCodeInput) { joinCodeInput.value = ''; joinCodeInput.focus(); }
                }
            });
        }

        if (confirmJoinBtn) {
            confirmJoinBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const code = joinCodeInput ? joinCodeInput.value.trim().toUpperCase() : '';
                const status = document.getElementById('joinStatus');
                if (!code) {
                    if (status) { status.textContent = 'Please enter a valid group code!'; status.className = 'modal-status error'; }
                    return;
                }
                if (status) { status.textContent = 'Connecting to room ' + code + '...'; status.className = 'modal-status pending'; }
                if (this.network) {
                    this.network.joinGroup(code, (connectedRoom) => {
                        if (status) {
                            status.textContent = `Connected to ${connectedRoom}! Waiting for host to launch the game...`;
                            status.className = 'modal-status success';
                        }
                    }, (err) => {
                        if (status) {
                            status.textContent = 'Failed to connect: ' + (err || 'Unknown error');
                            status.className = 'modal-status error';
                        }
                    });
                }
            });
        }

        if (cancelJoinBtn) {
            cancelJoinBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (joinModal) joinModal.classList.add('hidden');
            });
        }
    }

    updateLobbyPlayerList() {
        const list = document.getElementById('lobbyPlayersList');
        const countDisplay = document.getElementById('playerCountDisplay');
        if (!list) return;

        const players = this.network ? this.network.getPlayerList() : [];
        const count = players.length > 0 ? players.length : 1;
        if (countDisplay) countDisplay.textContent = count;

        list.innerHTML = '';
        if (players.length === 0) {
            const hostName = (this.network && this.network.playerName) ? this.network.playerName : 'Player_1';
            list.innerHTML = `<li class="player-item host">👑 ${hostName} (You) [Host] - Ready</li>`;
            return;
        }

        for (const p of players) {
            const li = document.createElement('li');
            li.className = p.isHost ? 'player-item host' : 'player-item';
            const icon = p.isHost ? '👑' : '👤';
            li.textContent = `${icon} ${p.name} - Ready`;
            list.appendChild(li);
        }
    }

    handleBanishRelic() {
        if (!this.player || !this.player.alive) return;
        if (!this.player.hasRelic) {
            this.showHint("Find the Banishment Relic in the Hospital Wing to destroy the ghost!");
            return;
        }
        const targets = (this.listeners && this.listeners.length > 0) ? this.listeners : (this.listener ? [this.listener] : []);
        const aliveGhosts = targets.filter(g => g && !g.isDead);
        if (aliveGhosts.length === 0) {
            this.showHint("All Listeners have already been banished!");
            return;
        }
        const banished = this.player.useRelic(targets, this.network, this.renderer);
        if (banished) {
            if (this.audio) this.audio.playSound('ghost_banish');
            this.showHint("✦ YOU BANISHED A LISTENER INTO OBLIVION! ✦");
        } else {
            this.showHint("The nearest Listener is too far away! Move closer (within 420px) to cast!");
        }
    }

    toggleVoiceMic() {
        if (this.network) {
            const isMuted = this.network.toggleMic();
            this.showHint(isMuted ? "🔇 Voice Microphone Muted [Press T to Unmute]" : "🎙️ Voice Microphone Live [Press T to Mute]");
        }
    }

    onKeyDown(e) {
        if (e.repeat) return;
        this.keysJustPressed[e.code] = true;

        // Cutscene navigation (Space / Enter / N to advance, Escape to skip)
        if (this.state === GAME_STATE.CUTSCENE) {
            if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyN') {
                if (this.cutscene) this.cutscene.nextSlide();
            } else if (e.code === 'Escape') {
                if (this.cutscene) this.cutscene.skip();
            }
            if (['Space', 'Enter', 'Escape'].includes(e.code)) {
                e.preventDefault();
            }
            return;
        }

        switch (e.code) {
            case 'KeyW': case 'ArrowUp':    this.input.up = true; break;
            case 'KeyS': case 'ArrowDown':  this.input.down = true; break;
            case 'KeyA': case 'ArrowLeft':  this.input.left = true; break;
            case 'KeyD': case 'ArrowRight': this.input.right = true; break;
            case 'ShiftLeft': case 'ShiftRight': this.input.run = true; break;
            case 'ControlLeft': case 'KeyC': this.input.sneak = true; break;
            case 'Space': this.input.breath = true; break;
            case 'KeyV':
                this.input.talk = true;
                if (this.audio && !this.audio.micActive) this.audio.simulateMicLevel(0.40);
                break;
            case 'KeyT':
                this.toggleVoiceMic();
                break;
            case 'KeyG':
                this.handleBanishRelic();
                break;
            case 'Digit1': // Simulate Whisper
                if (this.audio) this.audio.simulateMicLevel(0.12);
                break;
            case 'Digit2': // Simulate Normal Talk
                if (this.audio) this.audio.simulateMicLevel(0.24);
                break;
            case 'Digit3': // Simulate Loud Shout / Laugh
                if (this.audio) this.audio.simulateMicLevel(0.55);
                break;
            case 'KeyM':
                this.toggleFullMap();
                break;
            case 'Escape':
                if (this.showFullMap) {
                    this.toggleFullMap();
                }
                break;
        }

        // Single-press actions
        if (this.state === GAME_STATE.PLAYING) {
            if (e.code === 'KeyE') this.handleInteract();
            if (e.code === 'KeyH') this.handleHide();
            if (e.code === 'KeyF') this.handleFlashlight();
        }

        // Retry
        if ((this.state === GAME_STATE.GAME_OVER || this.state === GAME_STATE.VICTORY) && e.code === 'KeyR') {
            this.restart();
        }

        // Prevent scrolling
        if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
            e.preventDefault();
        }
    }

    onKeyUp(e) {
        switch (e.code) {
            case 'KeyW': case 'ArrowUp':    this.input.up = false; break;
            case 'KeyS': case 'ArrowDown':  this.input.down = false; break;
            case 'KeyA': case 'ArrowLeft':  this.input.left = false; break;
            case 'KeyD': case 'ArrowRight': this.input.right = false; break;
            case 'ShiftLeft': case 'ShiftRight': this.input.run = false; break;
            case 'ControlLeft': case 'KeyC': this.input.sneak = false; break;
            case 'Space': this.input.breath = false; break;
            case 'KeyV':
                this.input.talk = false;
                if (this.audio && !this.audio.micActive) this.audio.simulateMicLevel(0.0);
                break;
        }
    }

    onMouseMove(e) {
        this.input.hasMouseMoved = true;
        this.input.mouseX = e.clientX;
        this.input.mouseY = e.clientY;
        if (this.renderer) {
            this.input.mouseWorldX = e.clientX + this.renderer.camX;
            this.input.mouseWorldY = e.clientY + this.renderer.camY;
        }
    }

    onMouseDown(e) {
        if (e.button === 0) {
            this.input.throw = true;
        }
    }

    onMouseUp(e) {
        if (e.button === 0) {
            this.input.throw = false;
        }
    }

    onClick(e) {
        if (e && e.target && (e.target.closest('button') || e.target.closest('input') || e.target.closest('.modal-box') || e.target.closest('.modal-overlay'))) {
            return;
        }
        if (this.state === GAME_STATE.CUTSCENE) {
            if (this.cutscene) this.cutscene.nextSlide();
            return;
        }
        if (this.state === GAME_STATE.GAME_OVER || this.state === GAME_STATE.VICTORY) {
            this.restart();
            return;
        }
        if (this.state === GAME_STATE.MENU) {
            this.startCalibration();
        }
    }

    // ---- Screen Management ----

    showScreen(id) {
        document.querySelectorAll('.screen').forEach(s => {
            s.classList.remove('active');
            s.classList.add('fade-out');
        });
        const screen = document.getElementById(id);
        if (screen) {
            screen.classList.remove('fade-out');
            screen.classList.add('active');
        }
        const mobileControls = document.getElementById('mobileControls');
        if (mobileControls) {
            mobileControls.classList.remove('visible');
        }
    }

    hideAllScreens() {
        document.querySelectorAll('.screen').forEach(s => {
            s.classList.remove('active');
            s.classList.add('fade-out');
        });
        const overlay = document.getElementById('overlay');
        if (overlay) overlay.style.pointerEvents = 'none';
        const mobileControls = document.getElementById('mobileControls');
        if (mobileControls) {
            mobileControls.classList.add('visible');
        }
    }

    // ---- Calibration ----

    async startCalibration() {
        this.state = GAME_STATE.CALIBRATING;
        this.showScreen('calibrationScreen');

        // Initialize audio (requests mic permission)
        try {
            await this.audio.init();
        } catch (e) {
            console.warn('Microphone not available, keyboard simulation available:', e);
        }

        // Start calibration phases
        this.calibrationPhase = 0;
        this.calibrationTimer = 1.2;
        const instr = document.getElementById('calibrationInstruction');
        if (instr) instr.textContent = 'Get ready to calibrate your voice...';

        // Skip button
        const skipBtn = document.getElementById('skipCalibration');
        if (skipBtn) {
            skipBtn.onclick = () => this.skipCalibration();
        }
    }

    updateCalibration(dt) {
        this.calibrationTimer -= dt;

        // Update calibration meter
        if (this.audio) {
            const bar = document.getElementById('calibrationBar');
            if (bar) {
                const level = (this.audio.micActive ? this.audio.getMicLevel() : this.audio.smoothedLevel) * 100;
                bar.style.width = Math.min(100, Math.max(0, level)) + '%';
            }
        }

        if (this.calibrationTimer <= 0) {
            this.calibrationPhase++;
            const instr = document.getElementById('calibrationInstruction');

            if (this.calibrationPhase === 1) {
                // Whisper phase
                if (instr) instr.textContent = 'Whisper quietly into your microphone...';
                const s1 = document.getElementById('step1');
                if (s1) s1.classList.add('active');
                this.calibrationTimer = this.calibrationDuration;
                if (this.audio) this.audio.startCalibration('whisper');
            } else if (this.calibrationPhase === 2) {
                // Talk phase
                if (this.audio) this.audio.endCalibration('whisper');
                if (instr) instr.textContent = 'Now speak at your normal conversational volume...';
                const s1 = document.getElementById('step1');
                const s2 = document.getElementById('step2');
                if (s1) { s1.classList.remove('active'); s1.classList.add('done'); }
                if (s2) s2.classList.add('active');
                this.calibrationTimer = this.calibrationDuration;
                if (this.audio) this.audio.startCalibration('talk');
            } else if (this.calibrationPhase === 3) {
                // Shout phase
                if (this.audio) this.audio.endCalibration('talk');
                if (instr) instr.textContent = 'Now make a loud sound, laugh, or shout!';
                const s2 = document.getElementById('step2');
                const s3 = document.getElementById('step3');
                if (s2) { s2.classList.remove('active'); s2.classList.add('done'); }
                if (s3) s3.classList.add('active');
                this.calibrationTimer = this.calibrationDuration;
                if (this.audio) this.audio.startCalibration('shout');
            } else if (this.calibrationPhase === 4) {
                // Finalize
                if (this.audio) {
                    this.audio.endCalibration('shout');
                    this.audio.finalizeCalibration();
                }
                const s3 = document.getElementById('step3');
                if (s3) { s3.classList.remove('active'); s3.classList.add('done'); }
                if (instr) instr.textContent = 'Calibration complete. Entering the silent darkness...';
                this.calibrationTimer = 1.2;
                this.calibrationPhase = 5;
            } else if (this.calibrationPhase >= 6) {
                this.startGame();
            }
        }
    }

    skipCalibration() {
        if (this.audio) {
            this.audio.finalizeCalibration();
        }
        this.startGame();
    }

    // ---- Game Start / Restart ----

    startGame() {
        // Generate map
        this.map = new GameMap();
        this.map.exit = this.map.exitPos; // compatibility alias

        // Create player at start position
        this.player = new Player(this.map.startPos.x, this.map.startPos.y);

        // Create 3 Listeners across Central, West, and East wings
        this.listeners = [];
        const startPositions = this.map.listenerStartPositions || [this.map.listenerStartPos];
        const patrolRoutes = this.map.listenerPatrolRoutes || [this.map.patrolPoints];
        const ghostCount = (typeof LISTENER_COUNT !== 'undefined') ? LISTENER_COUNT : 3;
        for (let i = 0; i < ghostCount; i++) {
            const startP = startPositions[i] || startPositions[0];
            const route = patrolRoutes[i] || patrolRoutes[0];
            const ghost = new Listener(startP.x, startP.y);
            ghost.id = i;
            ghost.patrolPoints = route;
            this.listeners.push(ghost);
        }
        this.listener = this.listeners[0];

        // Start ambient drone sound & atmospheric horror music
        if (this.audio) {
            this.audio.startAmbient();
            this.audio.startHorrorMusic();
        }

        // Set game state
        this.state = GAME_STATE.PLAYING;
        this.elapsed = 0;
        this.playTime = 0;
        this.stepTimer = 0;
        this.ambientEventTimer = 0;
        this.nextAmbientEventTime = randomFloat(10, 20);
        this.finalEscapeActive = false;
        this.showFullMap = false;
        if (this.renderer) this.renderer.showFullMap = false;

        // Hide overlay screens
        this.hideAllScreens();

        // Initial room banner
        const room = this.map.getRoom(this.player.x, this.player.y);
        if (room) {
            this.showRoomName(room.name);
        }
    }

    restart() {
        this.state = GAME_STATE.MENU;
        if (this.cutscene) this.cutscene.active = false;
        this.calibrationPhase = 0;
        this.flashbackStoneId = -1;
        this.finalEscapeActive = false;
        this.showFullMap = false;
        if (this.renderer) this.renderer.showFullMap = false;
        this.currentRoomName = '';
        this.lastRoomName = '';
        this.hintText = '';

        if (this.audio) {
            this.audio.stopAmbient();
            this.audio.stopHorrorMusic();
            this.audio.stopVictoryMusic();
        }

        const overlay = document.getElementById('overlay');
        if (overlay) overlay.style.pointerEvents = '';
        document.querySelectorAll('.step').forEach(s => {
            s.classList.remove('active', 'done');
        });

        this.showScreen('menuScreen');
    }

    // ---- Game Actions ----

    handleInteract() {
        if (!this.player || !this.player.alive || this.player.isHiding) return;

        // 1. Check for nearby items
        const item = this.map.getNearbyItem(this.player.x, this.player.y, this.player.interactRadius);
        if (item && !item.collected) {
            item.collected = true;
            this.player.pickupItem(item);
            if (item.type === ITEM_TYPE.BANISH_RELIC) {
                if (this.audio) this.audio.playSound('stone_pickup');
                this.showHint("✦ ACQUIRED BANISHMENT RELIC! Press [G] to destroy the ghost! ✦");
                if (this.network) {
                    this.network.broadcastAction('RELIC_PICKUP', { x: this.player.x, y: this.player.y });
                }
            } else {
                if (this.audio) this.audio.playSound('stone_pickup');
            }
            return;
        }

        // 2. Check for nearby memory stones
        const stone = this.map.getNearbyStone(this.player.x, this.player.y, this.player.interactRadius);
        if (stone && !stone.collected) {
            stone.collected = true;
            this.player.stonesCollected++;
            if (this.audio) this.audio.playSound('stone_pickup');
            if (this.network) {
                this.network.broadcastAction('STONE_COLLECTED', {
                    stoneId: stone.id,
                    totalCount: this.player.stonesCollected,
                    senderName: this.network.localPlayerName
                });
            }

            // Trigger story flashback
            this.flashbackStoneId = stone.id;
            this.flashbackProgress = 0;
            this.state = GAME_STATE.FLASHBACK;

            // Stone 2: Listener learns to copy player voices
            if (this.player.stonesCollected >= 2 && this.listener) {
                this.listener.canMimic = true;
                if (this.audio) {
                    setTimeout(() => {
                        this.audio.playMimic("Help me... over here...");
                    }, 2500);
                }
            }

            // Stone 3: The Final Act begins!
            if (this.player.stonesCollected >= TOTAL_STONES) {
                this.triggerFinalAct();
            }
            return;
        }

        // 3. Check for exit chamber / escape machine (Group Escape Enforcement)
        const tx = pixelToTile(this.player.x);
        const ty = pixelToTile(this.player.y);
        const nearExit = (this.map.getTile(tx, ty) === TILE.EXIT) ||
            (this.map.exitPos && dist(this.player.x, this.player.y, this.map.exitPos.x, this.map.exitPos.y) <= (typeof ESCAPE_GROUP_RADIUS !== 'undefined' ? ESCAPE_GROUP_RADIUS : 240));

        if (nearExit) {
            const hasRemotePeers = this.network && Object.keys(this.network.remotePlayers).length > 0;
            if (hasRemotePeers) {
                const status = this.network.canTeamEscape(this.player, this.map.exitPos, ESCAPE_GROUP_RADIUS);
                if (status.canEscape) {
                    this.network.broadcastAction('TEAM_ESCAPED', {
                        senderName: this.network.localPlayerName
                    });
                    this.showHint("✦ YOUR ENTIRE SQUAD HAS ESCAPED TOGETHER! ✦");
                    this.triggerVictory();
                } else if (!status.allHaveStones) {
                    this.showHint(`✦ SQUAD LOCKED: All players must collect 3 stones! Missing: ${status.missingStonesNames.join(', ')}`);
                } else {
                    this.showHint(`✦ CANNOT LEAVE ALONE! All players must gather at the exit doors! (${status.arrivedCount}/${status.totalCount} arrived)`);
                }
            } else {
                if (this.player.stonesCollected >= TOTAL_STONES) {
                    this.triggerVictory();
                } else {
                    this.showHint(`Collect all ${TOTAL_STONES} memory stones before you can escape! (${this.player.stonesCollected}/${TOTAL_STONES})`);
                }
            }
            return;
        }
    }

    triggerFinalAct() {
        this.finalEscapeActive = true;
        this.finalEscapeTimer = 0;

        if (this.audio) {
            this.audio.playSound('chase_start');
            setTimeout(() => {
                this.audio.playMimic("Don't leave me... run!");
            }, 1800);
        }

        if (this.renderer) {
            this.renderer.shakeScreen(6);
        }

        this.showHint("The exit machine is alive! ESCAPE THROUGH THE EXIT CHAMBER!");
    }

    handleHide() {
        if (!this.player || !this.player.alive) return;

        if (this.player.isHiding) {
            this.player.isHiding = false;
            if (this.player.hideSpot) {
                this.player.hideSpot.occupied = false;
                this.player.hideSpot = null;
            }
            if (this.audio) this.audio.playSound('creak');
        } else {
            const spot = this.map.getNearbyHidingSpot(this.player.x, this.player.y, this.player.interactRadius);
            if (spot && !spot.occupied) {
                this.player.isHiding = true;
                this.player.hideSpot = spot;
                spot.occupied = true;
                this.player.x = spot.x;
                this.player.y = spot.y;
                if (this.audio) this.audio.playSound('creak');
            }
        }
    }

    handleFlashlight() {
        if (!this.player || !this.player.alive) return;
        if (this.player.flashlightBattery > 0 || this.player.flashlightOn) {
            this.player.flashlightOn = !this.player.flashlightOn;
        }
    }

    handleThrow() {
        if (!this.player || !this.player.alive || this.player.isHiding) return;
        const angle = angleToward(
            this.player.x, this.player.y,
            this.input.mouseWorldX, this.input.mouseWorldY
        );

        const thrown = this.player.throwItem(angle, this.map);
        if (thrown) {
            if (this.audio) this.audio.playSound('clang');
            if (this.renderer) {
                this.renderer.addParticle(thrown.x, thrown.y, 0, 0, 0.5, 4, '#ccccaa', 'spark');
            }
            // Distract all Listeners within hearing range of the throw landing spot
            const ghostList = (this.listeners && this.listeners.length > 0) ? this.listeners : (this.listener ? [this.listener] : []);
            for (const ghost of ghostList) {
                if (ghost && !ghost.isDead) {
                    const d = dist(thrown.x, thrown.y, ghost.x, ghost.y);
                    if (d <= (typeof LISTENER_HEARING_RANGE !== 'undefined' ? LISTENER_HEARING_RANGE : 600)) {
                        ghost.hearSound(thrown.x, thrown.y, 0.85);
                    }
                }
            }
        }
    }

    toggleFullMap() {
        if (this.state !== GAME_STATE.PLAYING) return;
        this.showFullMap = !this.showFullMap;
        if (this.renderer) {
            this.renderer.showFullMap = this.showFullMap;
        }
    }

    // ---- Environmental Building Events ----

    triggerRandomBuildingNoise() {
        if (!this.map) return;
        const ghostList = (this.listeners && this.listeners.length > 0) ? this.listeners : (this.listener ? [this.listener] : []);
        if (ghostList.length === 0) return;

        const events = ['drip', 'creak', 'clang'];
        const chosen = events[randomInt(0, events.length - 1)];

        // Pick a random room or hallway
        const room = this.map.rooms[randomInt(0, this.map.rooms.length - 1)];
        if (!room) return;
        const rx = tileToPixel(room.x + randomInt(1, Math.max(1, room.w - 2)));
        const ry = tileToPixel(room.y + randomInt(1, Math.max(1, room.h - 2)));

        if (this.audio) {
            this.audio.playSound(chosen);
        }

        // Listeners investigate sound if it's loud (creak/clang)
        if (chosen === 'clang' || chosen === 'creak') {
            for (const ghost of ghostList) {
                if (ghost && !ghost.isDead) {
                    const d = dist(ghost.x, ghost.y, rx, ry);
                    if (d < (typeof LISTENER_HEARING_RANGE !== 'undefined' ? LISTENER_HEARING_RANGE : 600) * 0.8) {
                        ghost.lastHeardX = rx;
                        ghost.lastHeardY = ry;
                        ghost.lastHeardTime = Date.now();
                        ghost.enterState(LISTENER_STATE.INVESTIGATE);
                    }
                }
            }
        }
    }

    // ---- Room Name Display ----

    showRoomName(name) {
        if (name === this.lastRoomName) return;
        this.currentRoomName = name;
        this.lastRoomName = name;
        this.roomNameAlpha = 0;
        this.roomNameTimer = 3.5;
        if (this.renderer) {
            this.renderer.showRoomName(name);
        }
    }

    updateRoomName(dt) {
        if (this.roomNameTimer > 0) {
            this.roomNameTimer -= dt;
            if (this.roomNameTimer > 3.0) {
                this.roomNameAlpha = 1.0 - (this.roomNameTimer - 3.0) / 0.5;
            } else if (this.roomNameTimer > 1.0) {
                this.roomNameAlpha = 1.0;
            } else {
                this.roomNameAlpha = this.roomNameTimer / 1.0;
            }
            this.roomNameAlpha = clamp(this.roomNameAlpha, 0, 1);
        } else {
            this.roomNameAlpha = 0;
        }
    }

    // ---- Hint Text ----

    showHint(text) {
        this.hintText = text;
        this.hintAlpha = 1;
        if (this.renderer) {
            this.renderer.showHint(text);
        }
    }

    updateHint(dt) {
        if (this.player && this.player.alive && !this.player.isHiding) {
            const stone = this.map.getNearbyStone(this.player.x, this.player.y, this.player.interactRadius);
            const item = this.map.getNearbyItem(this.player.x, this.player.y, this.player.interactRadius);
            const spot = this.map.getNearbyHidingSpot(this.player.x, this.player.y, this.player.interactRadius);
            const tx = pixelToTile(this.player.x);
            const ty = pixelToTile(this.player.y);
            const nearExit = (this.map.getTile(tx, ty) === TILE.EXIT) ||
                (this.map.exitPos && dist(this.player.x, this.player.y, this.map.exitPos.x, this.map.exitPos.y) <= this.player.interactRadius);

            if (stone && !stone.collected) {
                this.showHint('Press E to collect glowing memory stone');
            } else if (item && !item.collected) {
                if (item.type === ITEM_TYPE.BANISH_RELIC) {
                    this.showHint('✦ Press E to pick up Banishment Relic (Destroy the Ghost!) ✦');
                } else {
                    const name = item.type === ITEM_TYPE.BATTERY ? 'Battery' : (item.type === ITEM_TYPE.THROWABLE ? 'Throwable Cans' : 'Key');
                    this.showHint(`Press E to pick up ${name}`);
                }
            } else if (this.player.hasRelic && this.listener && !this.listener.isDead && this.listener.distToPlayer(this.player) < 420) {
                this.showHint('✦ PRESS [G] TO CAST BANISHMENT RELIC AND DESTROY THE GHOST! ✦');
            } else if (spot && !spot.occupied) {
                this.showHint('Press H to hide in darkness');
            } else if (nearExit && this.player.stonesCollected >= TOTAL_STONES) {
                this.showHint('Press E to escape the building!');
            } else if (nearExit && this.player.stonesCollected < TOTAL_STONES) {
                this.showHint(`Collect all ${TOTAL_STONES} stones to unlock exit (${this.player.stonesCollected}/${TOTAL_STONES})`);
            } else {
                this.hintAlpha = Math.max(0, this.hintAlpha - dt * 2);
            }
        } else if (this.player && this.player.isHiding) {
            this.showHint('Press H to step out of hiding');
        }
    }

    // ---- Victory / Game Over / Origin Story Cutscene ----

    triggerVictory() {
        if (this.audio) {
            this.audio.stopAmbient();
            this.audio.stopHorrorMusic();
        }
        if (this.network) {
            this.network.broadcastAction('PLAYER_ESCAPED', {
                senderName: this.network.localPlayerName
            });
        }
        // Launch the tragic origin story cutscene (Redemption branch)
        this.startStoryCutscene('victory');
    }

    triggerGameOver() {
        this.deathCount++;
        if (this.renderer && typeof this.renderer.triggerKillJumpscare === 'function') {
            this.renderer.triggerKillJumpscare();
        }
        if (this.audio) {
            this.audio.stopAmbient();
            this.audio.stopHorrorMusic();
            this.audio.playDeath();
        }
        // Let the terrifying jumpscare visual play out before transitioning to origin story cutscene
        setTimeout(() => {
            this.startStoryCutscene('defeat');
        }, 1300);
    }

    startStoryCutscene(outcome = 'victory') {
        this.state = GAME_STATE.CUTSCENE;
        this.hideAllScreens();
        const overlay = document.getElementById('overlay');
        if (overlay) overlay.style.pointerEvents = 'none';

        if (this.cutscene) {
            this.cutscene.start(outcome, () => {
                if (outcome === 'victory') {
                    this.showVictoryScreen();
                } else {
                    this.showGameOverScreen();
                }
            });
        } else {
            if (outcome === 'victory') {
                this.showVictoryScreen();
            } else {
                this.showGameOverScreen();
            }
        }
    }

    showVictoryScreen() {
        this.state = GAME_STATE.VICTORY;
        if (this.audio) {
            this.audio.playVictoryMusic();
        }
        this.showScreen('victoryScreen');
        const overlay = document.getElementById('overlay');
        if (overlay) overlay.style.pointerEvents = '';
    }

    showGameOverScreen() {
        this.state = GAME_STATE.GAME_OVER;
        this.showScreen('gameOverScreen');
        const overlay = document.getElementById('overlay');
        if (overlay) overlay.style.pointerEvents = '';
    }

    // ---- Main Game Loop ----

    loop(time) {
        this.dt = Math.min((time - this.lastTime) / 1000, 0.05);
        this.lastTime = time;

        this.frameCount++;
        this.fpsTimer += this.dt;
        if (this.fpsTimer >= 1.0) {
            this.fps = this.frameCount;
            this.frameCount = 0;
            this.fpsTimer = 0;
        }

        switch (this.state) {
            case GAME_STATE.MENU:
                break;
            case GAME_STATE.CALIBRATING:
                this.updateCalibration(this.dt);
                break;
            case GAME_STATE.PLAYING:
                this.updatePlaying(this.dt);
                break;
            case GAME_STATE.FLASHBACK:
                this.updateFlashback(this.dt);
                break;
            case GAME_STATE.CUTSCENE:
                if (this.cutscene) this.cutscene.update(this.dt);
                break;
        }

        this.render();

        this.keysJustPressed = {};
        requestAnimationFrame((t) => this.loop(t));
    }

    updatePlaying(dt) {
        this.playTime += dt;

        // 1. Simulated voice input
        if (this.input.talk && this.audio && !this.audio.micActive) {
            this.audio.simulateMicLevel(0.55);
        }

        // 2. Update player
        if (this.player && this.player.alive) {
            this.input.mouseWorldX = this.input.mouseX + this.renderer.camX;
            this.input.mouseWorldY = this.input.mouseY + this.renderer.camY;

            this.player.update(dt, this.input, this.map);

            if (this.input.throw) {
                this.handleThrow();
                this.input.throw = false;
            }

            // Room transitions
            const room = this.map.getRoom(this.player.x, this.player.y);
            if (room && room.name !== this.lastRoomName) {
                this.showRoomName(room.name);
            }

            // Footstep sounds & movement tension
            const movingNow = this.player.isMoving && !this.player.isHiding;
            if (this.audio && typeof this.audio.setMoving === 'function') {
                this.audio.setMoving(movingNow);
            }

            if (movingNow) {
                this.stepTimer += dt;
                const interval = this.player.isRunning ? 0.28 : (this.player.isSneaking ? 0.6 : 0.42);
                if (this.stepTimer >= interval) {
                    this.stepTimer = 0;
                    if (this.audio) {
                        if (this.map.isWater(this.player.x, this.player.y)) {
                            this.audio.playSound('footstep_water');
                        } else if (this.map.isLoudFloor(this.player.x, this.player.y)) {
                            this.audio.playSound('footstep_loud');
                        } else {
                            this.audio.playSound('footstep');
                        }
                    }
                }
            } else {
                this.stepTimer = 0.2;
            }
        }

        // 3. Audio manager, Multiplayer Sync & Dynamic Danger Line
        if (this.network) {
            this.network.update(dt, this.player, this.listeners, this.audio);
            const qualifying = this.network.getQualifyingPlayerCount(this.player);
            if (this.audio) {
                this.audio.updateDynamicRedLine(qualifying);
            }
        } else if (this.audio && this.player) {
            const qualifying = this.player.stonesCollected >= 2 ? 1 : 0;
            this.audio.updateDynamicRedLine(qualifying);
        }

        if (this.audio) {
            // Silence when holding breath or hiding
            const isMuted = this.player ? (this.player.isHiding || this.player.isHoldingBreath) : false;
            this.audio.setMuted(isMuted);

            const movementNoise = this.player ? this.player.getMovementNoise() : 0;
            const stoneNoise = this.player ? this.player.getStoneNoise() : 0;
            const envNoise = this.player ? this.player.getEnvironmentNoise(this.map) : 0;
            this.audio.update(dt, movementNoise, stoneNoise, envNoise);

            // Heartbeat audio scaling based on closest active ghost
            const ghostList = (this.listeners && this.listeners.length > 0) ? this.listeners : (this.listener ? [this.listener] : []);
            const aliveGhosts = ghostList.filter(g => g && !g.isDead);
            if (this.player && aliveGhosts.length > 0) {
                let minGhostDist = Infinity;
                for (const g of aliveGhosts) {
                    const d = dist(this.player.x, this.player.y, g.x, g.y);
                    if (d < minGhostDist) minGhostDist = d;
                }
                const intensity = clamp(1.0 - minGhostDist / 420, 0, 1);
                this.audio.updateHeartbeat(dt, intensity);
            }

            // Noise threshold crossing: All active Listeners within hearing range hunt!
            if (this.audio.isAboveRedLine() && this.player) {
                for (const ghost of aliveGhosts) {
                    const d = dist(this.player.x, this.player.y, ghost.x, ghost.y);
                    if (d <= (typeof LISTENER_HEARING_RANGE !== 'undefined' ? LISTENER_HEARING_RANGE : 600)) {
                        ghost.hearSound(
                            this.player.x, this.player.y,
                            this.audio.getNoiseBar()
                        );
                    }
                }
            }
        }

        // 4. Random ambient building sounds
        this.ambientEventTimer += dt;
        if (this.ambientEventTimer >= this.nextAmbientEventTime) {
            this.ambientEventTimer = 0;
            this.nextAmbientEventTime = randomFloat(12, 24);
            this.triggerRandomBuildingNoise();
        }

        // 5. Update All 3 Listeners AI & Check Kill Collisions
        if (this.player && this.player.alive) {
            const noiseLevel = this.audio ? this.audio.getNoiseBar() : 0;
            let closestActiveGhost = null;
            let minDistance = Infinity;

            for (const ghost of this.listeners) {
                if (!ghost || ghost.isDead) continue;
                ghost.update(dt, this.map, this.player, noiseLevel, this.player.x, this.player.y);

                const d = dist(this.player.x, this.player.y, ghost.x, ghost.y);
                if (d < minDistance) {
                    minDistance = d;
                    closestActiveGhost = ghost;
                }

                // Check kill collision (30px radius)
                if (d <= 30 && !this.player.isHiding) {
                    this.player.alive = false;
                    this.triggerGameOver();
                    break;
                }
            }

            // Expose closest ghost as this.listener for camera/HUD/effects
            if (closestActiveGhost) {
                this.listener = closestActiveGhost;
            } else if (this.listeners.length > 0) {
                this.listener = this.listeners[0];
            }
        }

        // 6. UI texts
        this.updateRoomName(dt);
        this.updateHint(dt);

        // 7. Group Escape status check near exit doors
        if (this.player && this.player.alive && this.map && this.map.exitPos) {
            const tx = pixelToTile(this.player.x);
            const ty = pixelToTile(this.player.y);
            const nearExit = (this.map.getTile(tx, ty) === TILE.EXIT) ||
                (dist(this.player.x, this.player.y, this.map.exitPos.x, this.map.exitPos.y) <= (typeof ESCAPE_GROUP_RADIUS !== 'undefined' ? ESCAPE_GROUP_RADIUS : 240));

            if (nearExit) {
                const hasRemotePeers = this.network && Object.keys(this.network.remotePlayers).length > 0;
                if (hasRemotePeers) {
                    const status = this.network.canTeamEscape(this.player, this.map.exitPos, ESCAPE_GROUP_RADIUS);
                    if (status.canEscape) {
                        this.showHint("✦ ALL SQUAD MEMBERS READY! Press [E] to escape together as a group! ✦");
                    } else if (!status.allHaveStones) {
                        this.showHint(`✦ SQUAD OBJECTIVE: All players must collect 3 stones! Missing: ${status.missingStonesNames.join(', ')} ✦`);
                    } else if (!status.allAtExit) {
                        this.showHint(`✦ WAITING FOR SQUAD: Gather at exit doors to escape! (${status.arrivedCount}/${status.totalCount} arrived) ✦`);
                    }
                }
            }
        }

        // Screen shake triggers
        if (this.audio && this.audio.getNoiseBar() > NOISE_THRESHOLDS.SHOUT && this.renderer) {
            this.renderer.shakeScreen(2.5);
        }
        if (this.listener && this.listener.state === LISTENER_STATE.HUNT && this.renderer) {
            this.renderer.shakeScreen(0.8);
        }
    }

    updateFlashback(dt) {
        this.flashbackProgress += dt / this.flashbackDuration;
        if (this.flashbackProgress >= 1.0) {
            this.flashbackProgress = 1.0;
            this.state = GAME_STATE.PLAYING;
            this.flashbackStoneId = -1;
        }
    }

    // ---- Rendering ----

    render() {
        if (!this.renderer) return;

        // Render cinematic origin story cutscene
        if (this.state === GAME_STATE.CUTSCENE) {
            if (this.cutscene) {
                this.cutscene.render(this.renderer.ctx, this.canvas.width, this.canvas.height);
            }
            return;
        }

        // Multi-state rendering handled through renderer (pass all 3 listeners)
        const ghostTarget = (this.listeners && this.listeners.length > 0) ? this.listeners : this.listener;
        this.renderer.render(
            this.map,
            this.player,
            ghostTarget,
            this.audio,
            this.state,
            this.dt
        );

        if (this.state === GAME_STATE.PLAYING) {
            this.drawCursor(this.renderer.ctx);
        }
    }

    drawCursor(ctx) {
        if (this.input.isTouch) return;
        const mx = this.input.mouseX;
        const my = this.input.mouseY;

        ctx.save();
        ctx.strokeStyle = 'rgba(220, 220, 240, 0.5)';
        ctx.lineWidth = 1;

        // Outer ring
        ctx.beginPath();
        ctx.arc(mx, my, 8, 0, Math.PI * 2);
        ctx.stroke();

        // Crosshairs
        ctx.beginPath();
        ctx.moveTo(mx - 12, my); ctx.lineTo(mx - 5, my);
        ctx.moveTo(mx + 5, my); ctx.lineTo(mx + 12, my);
        ctx.moveTo(mx, my - 12); ctx.lineTo(mx, my - 5);
        ctx.moveTo(mx, my + 5); ctx.lineTo(mx, my + 12);
        ctx.stroke();

        // Center dot
        ctx.fillStyle = 'rgba(220, 220, 240, 0.7)';
        ctx.beginPath();
        ctx.arc(mx, my, 1.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }
}

// ============================================================
// Bootstrap
// ============================================================

window.addEventListener('DOMContentLoaded', () => {
    const game = new Game();
    game.init();
    window.hushGame = game;
});
