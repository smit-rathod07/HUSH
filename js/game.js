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
        this.renderer = null;
        this.audio = null;

        // Input state
        this.input = {
            up: false, down: false, left: false, right: false,
            run: false, sneak: false,
            interact: false, hide: false, breath: false,
            flashlight: false, throw: false,
            talk: false, // Push-to-talk / simulated voice
            mouseX: 0, mouseY: 0,
            mouseWorldX: 0, mouseWorldY: 0
        };
        this.keysJustPressed = {};

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

        // Set up input handlers
        this.setupInput();

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
        window.addEventListener('click', () => this.onClick());

        // Prevent context menu
        window.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    onKeyDown(e) {
        if (e.repeat) return;
        this.keysJustPressed[e.code] = true;

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

    onClick() {
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
    }

    hideAllScreens() {
        document.querySelectorAll('.screen').forEach(s => {
            s.classList.remove('active');
            s.classList.add('fade-out');
        });
        const overlay = document.getElementById('overlay');
        if (overlay) overlay.style.pointerEvents = 'none';
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

        // Create Listener at its start position
        this.listener = new Listener(this.map.listenerStartPos.x, this.map.listenerStartPos.y);
        this.listener.patrolPoints = this.map.patrolPoints;

        // Start ambient drone sound
        if (this.audio) {
            this.audio.startAmbient();
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
        this.calibrationPhase = 0;
        this.flashbackStoneId = -1;
        this.finalEscapeActive = false;
        this.showFullMap = false;
        if (this.renderer) this.renderer.showFullMap = false;
        this.currentRoomName = '';
        this.lastRoomName = '';
        this.hintText = '';

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
            if (this.audio) this.audio.playSound('stone_pickup');
            return;
        }

        // 2. Check for nearby memory stones
        const stone = this.map.getNearbyStone(this.player.x, this.player.y, this.player.interactRadius);
        if (stone && !stone.collected) {
            stone.collected = true;
            this.player.stonesCollected++;
            if (this.audio) this.audio.playSound('stone_pickup');

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

        // 3. Check for exit chamber / escape machine
        const tx = pixelToTile(this.player.x);
        const ty = pixelToTile(this.player.y);
        const nearExit = (this.map.getTile(tx, ty) === TILE.EXIT) ||
            (this.map.exitPos && dist(this.player.x, this.player.y, this.map.exitPos.x, this.map.exitPos.y) <= this.player.interactRadius);

        if (nearExit) {
            if (this.player.stonesCollected >= TOTAL_STONES) {
                this.triggerVictory();
            } else {
                this.showHint(`Collect all ${TOTAL_STONES} memory stones before you can escape!`);
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
            if (this.listener) {
                // Distract the Listener to the landing spot!
                this.listener.hearSound(thrown.x, thrown.y, 0.85);
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
        if (!this.map || !this.listener) return;

        const events = ['drip', 'creak', 'clang'];
        const chosen = events[randomInt(0, events.length - 1)];

        // Pick a random room or hallway
        const room = this.map.rooms[randomInt(0, this.map.rooms.length - 1)];
        const rx = tileToPixel(room.x + randomInt(1, Math.max(1, room.w - 2)));
        const ry = tileToPixel(room.y + randomInt(1, Math.max(1, room.h - 2)));

        if (this.audio) {
            this.audio.playSound(chosen);
        }

        // Listener investigates sound if it's loud (creak/clang)
        if (chosen === 'clang' || chosen === 'creak') {
            const d = dist(this.listener.x, this.listener.y, rx, ry);
            if (d < LISTENER_HEARING_RANGE * 0.8) {
                this.listener.lastHeardX = rx;
                this.listener.lastHeardY = ry;
                this.listener.lastHeardTime = Date.now();
                this.listener.enterState(LISTENER_STATE.INVESTIGATE);
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
                const name = item.type === ITEM_TYPE.BATTERY ? 'Battery' : (item.type === ITEM_TYPE.THROWABLE ? 'Throwable Cans' : 'Key');
                this.showHint(`Press E to pick up ${name}`);
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

    // ---- Victory / Game Over ----

    triggerVictory() {
        this.state = GAME_STATE.VICTORY;
        if (this.audio) {
            this.audio.stopAmbient();
            this.audio.playSound('stone_pickup');
        }
        this.showScreen('victoryScreen');
        const overlay = document.getElementById('overlay');
        if (overlay) overlay.style.pointerEvents = '';
    }

    triggerGameOver() {
        this.state = GAME_STATE.GAME_OVER;
        this.deathCount++;
        if (this.audio) {
            this.audio.stopAmbient();
            this.audio.playDeath();
        }
        setTimeout(() => {
            this.showScreen('gameOverScreen');
            const overlay = document.getElementById('overlay');
            if (overlay) overlay.style.pointerEvents = '';
        }, 500);
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

            // Footstep sounds
            if (this.player.isMoving && !this.player.isHiding) {
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

        // 3. Audio manager & Noise bar
        if (this.audio) {
            // Silence when holding breath or hiding
            const isMuted = this.player ? (this.player.isHiding || this.player.isHoldingBreath) : false;
            this.audio.setMuted(isMuted);

            const movementNoise = this.player ? this.player.getMovementNoise() : 0;
            const stoneNoise = this.player ? this.player.getStoneNoise() : 0;
            const envNoise = this.player ? this.player.getEnvironmentNoise(this.map) : 0;
            this.audio.update(dt, movementNoise, stoneNoise, envNoise);

            // Heartbeat audio scaling
            if (this.listener && this.player) {
                const d = this.listener.distToPlayer(this.player);
                const intensity = clamp(1.0 - d / 400, 0, 1);
                this.audio.updateHeartbeat(dt, intensity);
            }

            // Noise threshold crossing: Listener hunts!
            if (this.audio.isAboveRedLine() && this.listener && this.player) {
                this.listener.hearSound(
                    this.player.x, this.player.y,
                    this.audio.getNoiseBar()
                );
            }
        }

        // 4. Random ambient building sounds
        this.ambientEventTimer += dt;
        if (this.ambientEventTimer >= this.nextAmbientEventTime) {
            this.ambientEventTimer = 0;
            this.nextAmbientEventTime = randomFloat(12, 24);
            this.triggerRandomBuildingNoise();
        }

        // 5. Update Listener AI
        if (this.listener && this.player && this.player.alive) {
            const noiseLevel = this.audio ? this.audio.getNoiseBar() : 0;
            this.listener.update(dt, this.map, this.player, noiseLevel, this.player.x, this.player.y);

            if (!this.player.alive) {
                this.triggerGameOver();
            }
        }

        // 6. UI texts
        this.updateRoomName(dt);
        this.updateHint(dt);

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

        // Multi-state rendering handled through renderer
        this.renderer.render(
            this.map,
            this.player,
            this.listener,
            this.audio,
            this.state,
            this.dt
        );

        if (this.state === GAME_STATE.PLAYING) {
            this.drawCursor(this.renderer.ctx);
        }
    }

    drawCursor(ctx) {
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
