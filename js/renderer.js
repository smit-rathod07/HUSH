// ============================================================
// HUSH - Canvas Renderer
// Top-down 2D Horror Game Renderer
// ============================================================

class Renderer {
    constructor(canvas) {
        this.canvas = canvas || document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.width = this.canvas.width;
        this.height = this.canvas.height;
        
        // Camera
        this.camX = 0;
        this.camY = 0;
        this.camTargetX = 0;
        this.camTargetY = 0;
        this.camShake = 0;           // screen shake intensity
        this.camShakeDecay = 0.9;
        this.shakeX = 0;
        this.shakeY = 0;
        
        // Pre-rendered layers
        this.fogCanvas = null;       // off-screen canvas for fog of war
        this.fogCtx = null;
        this.lightCanvas = null;     // off-screen canvas for lighting
        this.lightCtx = null;
        
        // Particles
        this.particles = [];         // {x, y, vx, vy, life, maxLife, size, color, type}
        this.maxParticles = 300;
        
        // Ambient effects
        this.dustTimer = 0;
        this.dripTimer = 0;
        this.flickerTimer = 0;
        this.globalFlicker = 1.0;    // global light flicker multiplier
        
        // Timers and transitions
        this.gameTime = 0;
        this.currentRoomName = '';
        this.roomNameTimer = 999;
        this.roomNameDuration = 3.5;
        this.hintText = '';
        this.hintAlpha = 0;
        this.showFullMap = false;
        
        this.gameOverTimer = 0;
        this.victoryTimer = 0;
        this.flashbackTimer = 0;
        
        // Dangerous kill jumpscare state
        this.jumpscareActive = false;
        this.jumpscareTimer = 0;
        this.jumpscareDuration = 1.3;
        
        // Cached references during render frame
        this.player = null;
        this.map = null;
        this.listener = null;
        
        this.init();
    }
    
    // Trigger the terrifying kill jumpscare sequence
    triggerKillJumpscare() {
        this.jumpscareActive = true;
        this.jumpscareTimer = 0;
        this.shakeScreen(18.0);
    }
    
    init() {
        // Create off-screen canvases for fog and lighting
        this.fogCanvas = document.createElement('canvas');
        this.fogCanvas.width = this.width;
        this.fogCanvas.height = this.height;
        this.fogCtx = this.fogCanvas.getContext('2d');
        
        this.lightCanvas = document.createElement('canvas');
        this.lightCanvas.width = this.width;
        this.lightCanvas.height = this.height;
        this.lightCtx = this.lightCanvas.getContext('2d');
    }
    
    // Resize handler
    resize(w, h) {
        this.width = w;
        this.height = h;
        this.canvas.width = w;
        this.canvas.height = h;
        if (this.fogCanvas) {
            this.fogCanvas.width = w;
            this.fogCanvas.height = h;
        }
        if (this.lightCanvas) {
            this.lightCanvas.width = w;
            this.lightCanvas.height = h;
        }
    }
    
    // Main render method - called every frame
    render(map, player, listener, audioManager, gameState, dt) {
        dt = (dt !== undefined && dt > 0) ? Math.min(dt, 0.1) : (1 / 60);
        this.gameTime += dt;
        
        this.player = player;
        this.map = map;
        this.listener = listener;
        
        // Ambient global light flicker calculation
        this.flickerTimer += dt;
        if (this.flickerTimer > 0.05) {
            this.flickerTimer = 0;
            if (Math.random() < 0.04) {
                this.globalFlicker = randomFloat(0.85, 0.95);
            } else {
                this.globalFlicker = 1.0;
            }
        }
        
        // Handle standalone game states
        if (gameState === GAME_STATE.MENU) {
            this.drawMenu();
            return;
        }
        
        if (gameState === GAME_STATE.CALIBRATING) {
            const phase = audioManager ? (audioManager.calibrationPhase || 0) : 0;
            const level = audioManager ? (audioManager.smoothedLevel || audioManager.noiseBarValue || 0) : 0;
            this.drawCalibration(phase, level);
            return;
        }
        
        // Kill jumpscare takes priority on screen during death moment
        if (this.jumpscareActive) {
            this.jumpscareTimer += dt;
            const progress = clamp(this.jumpscareTimer / this.jumpscareDuration, 0, 1);
            this.drawKillJumpscare(this.ctx, this.width, this.height, progress);
            if (this.jumpscareTimer >= this.jumpscareDuration) {
                this.jumpscareActive = false;
            }
            return;
        }
        
        if (gameState === GAME_STATE.GAME_OVER) {
            this.gameOverTimer += dt;
            this.drawGameOver();
            return;
        } else {
            this.gameOverTimer = 0;
        }
        
        if (gameState === GAME_STATE.VICTORY || gameState === GAME_STATE.ESCAPED) {
            this.victoryTimer += dt;
            this.drawVictory();
            return;
        } else {
            this.victoryTimer = 0;
        }
        
        if (gameState === GAME_STATE.FLASHBACK) {
            this.flashbackTimer += dt;
            const stoneId = (player && player.stonesCollected) ? player.stonesCollected : 1;
            const progress = (this.flashbackTimer % 3.0) / 3.0;
            this.drawFlashback(stoneId, progress);
            return;
        } else {
            this.flashbackTimer = 0;
        }
        
        // === PLAYING STATE RENDERING ===
        
        // 1. Update camera and ambient particles
        this.updateCamera(player, dt);
        this.spawnAmbientParticles(player, map, dt);
        this.updateParticles(dt);
        
        // 2. Clear canvas with dark pitch background
        this.ctx.fillStyle = COLORS.BACKGROUND;
        this.ctx.fillRect(0, 0, this.width, this.height);
        
        // 3. Render world layer with camera transform
        this.ctx.save();
        this.ctx.translate(-Math.round(this.camX + this.shakeX), -Math.round(this.camY + this.shakeY));
        
        if (map) {
            this.drawMap(map);
            this.drawWaterEffects(map, dt);
            this.drawHidingSpots(map);
            this.drawItems(map);
            this.drawStones(map);
        }
        
        this.drawParticles(dt);
        
        const ghostList = Array.isArray(listener) ? listener : (listener ? [listener] : []);
        for (const l of ghostList) {
            if (l) this.drawListener(l);
        }
        
        if (player) {
            this.drawPlayer(player);
        }
        
        if (this.network) {
            this.drawRemotePlayers(this.network);
        }
        
        this.ctx.restore();
        
        // 4. Fog of War & Flashlight (cut out visibility)
        if (player) {
            this.drawFog(player);
            this.drawFlashlight(player);
        }
        
        // 5. The Listener's faint red eyes visible in the dark if within 300px
        for (const l of ghostList) {
            if (l && player && !l.isDead) {
                const d = dist(player.x, player.y, l.x, l.y);
                if (d <= 300 && !this.isListenerLit(l, player)) {
                    this.drawDarkListenerEyes(l);
                }
            }
        }
        
        // 6. Proximity heartbeat warning vignette (tracks closest active ghost)
        let closestActiveGhost = null;
        let minGhostD = Infinity;
        for (const l of ghostList) {
            if (l && !l.isDead && player) {
                const d = dist(player.x, player.y, l.x, l.y);
                if (d < minGhostD) {
                    minGhostD = d;
                    closestActiveGhost = l;
                }
            }
        }
        if (closestActiveGhost && player) {
            this.drawProximityWarning(closestActiveGhost, player);
        }
        
        // 7. Heads-Up Display (screen space)
        this.drawHUD(player, audioManager, (closestActiveGhost || ghostList[0] || listener), gameState);
        
        // 8. Room Name Banner
        if (this.currentRoomName && this.roomNameTimer < this.roomNameDuration) {
            this.roomNameTimer += dt;
            let alpha = 1.0;
            if (this.roomNameTimer < 0.5) {
                alpha = this.roomNameTimer / 0.5;
            } else if (this.roomNameTimer > 2.5) {
                alpha = clamp(1.0 - (this.roomNameTimer - 2.5) / 1.0, 0, 1);
            }
            this.drawRoomName(this.currentRoomName, alpha);
        }
        
        // 9. Hint text
        if (this.hintText && this.hintAlpha > 0) {
            this.drawHintText(this.hintText);
            this.hintAlpha -= dt * 0.4;
            if (this.hintAlpha <= 0) {
                this.hintText = '';
            }
        }
    }
    
    // Update camera to follow player smoothly
    updateCamera(player, dt) {
        if (player) {
            this.camTargetX = player.x - this.width / 2;
            this.camTargetY = player.y - this.height / 2;
            
            // Smooth lerp follow
            const camLerp = clamp(dt * 7.5, 0, 1);
            this.camX = lerp(this.camX, this.camTargetX, camLerp);
            this.camY = lerp(this.camY, this.camTargetY, camLerp);
        }
        
        // Apply and decay screen shake
        if (this.camShake > 0.05) {
            this.shakeX = randomFloat(-this.camShake, this.camShake);
            this.shakeY = randomFloat(-this.camShake, this.camShake);
            this.camShake *= Math.pow(this.camShakeDecay, dt * 60);
        } else {
            this.camShake = 0;
            this.shakeX = 0;
            this.shakeY = 0;
        }
    }
    
    // Apply screen shake
    shakeScreen(intensity) {
        this.camShake = Math.max(this.camShake, intensity);
    }
    
    // Convert world coords to screen coords
    worldToScreen(wx, wy) {
        return {
            x: wx - (this.camX + this.shakeX),
            y: wy - (this.camY + this.shakeY)
        };
    }
    
    // Convert screen coords to world coords
    screenToWorld(sx, sy) {
        return {
            x: sx + (this.camX + this.shakeX),
            y: sy + (this.camY + this.shakeY)
        };
    }
    
    // Helper to test if a point is illuminated by player
    isPointLit(px, py, player) {
        if (!player) return true;
        const d = dist(player.x, player.y, px, py);
        
        // Ambient visibility radius
        const ambientRad = 65;
        if (d <= ambientRad) return true;
        
        // Flashlight beam cone check
        const isFlashlightOn = player.flashlightOn && (player.flashlightBattery === undefined || player.flashlightBattery > 0);
        if (isFlashlightOn && d <= FLASHLIGHT_RANGE) {
            const fAngle = player.flashlightAngle !== undefined ? player.flashlightAngle : (player.angle || 0);
            const toTarget = angleToward(player.x, player.y, px, py);
            const diff = Math.abs(angleDiff(fAngle, toTarget));
            if (diff <= FLASHLIGHT_ANGLE) {
                return true;
            }
        }
        
        return false;
    }
    
    // Helper to check if the Listener is inside lit area
    isListenerLit(listener, player) {
        if (!listener) return false;
        if (!player) return true;
        return this.isPointLit(listener.x, listener.y, player);
    }
    
    // Draw the tile map (culled to visible viewport)
    drawMap(map) {
        if (!map || !map.tiles) return;
        
        const ctx = this.ctx;
        const leftWorld = this.camX + this.shakeX;
        const topWorld = this.camY + this.shakeY;
        
        const startCol = Math.max(0, Math.floor(leftWorld / TILE_SIZE) - 1);
        const endCol = Math.min((map.width || MAP_WIDTH) - 1, Math.ceil((leftWorld + this.width) / TILE_SIZE) + 1);
        const startRow = Math.max(0, Math.floor(topWorld / TILE_SIZE) - 1);
        const endRow = Math.min((map.height || MAP_HEIGHT) - 1, Math.ceil((topWorld + this.height) / TILE_SIZE) + 1);
        
        for (let ty = startRow; ty <= endRow; ty++) {
            const row = map.tiles[ty];
            if (!row) continue;
            for (let tx = startCol; tx <= endCol; tx++) {
                const tile = row[tx];
                const px = tx * TILE_SIZE;
                const py = ty * TILE_SIZE;
                
                switch (tile) {
                    case TILE.WALL: {
                        this.drawWallTile(ctx, map, tx, ty, px, py);
                        break;
                    }
                    
                    case TILE.FLOOR: {
                        // Varied dark floor pattern using coordinate hash
                        const hash = ((tx * 7 + ty * 13) % 3);
                        ctx.fillStyle = hash === 0 ? COLORS.FLOOR : (hash === 1 ? COLORS.FLOOR_ALT : '#1a2238');
                        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
                        
                        // Clear subtle tile border seams
                        ctx.strokeStyle = COLORS.FLOOR_GRID || 'rgba(70, 95, 140, 0.25)';
                        ctx.lineWidth = 0.5;
                        ctx.strokeRect(px + 0.5, py + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
                        break;
                    }
                    
                    case TILE.WATER: {
                        // High-contrast deep water tile base
                        ctx.fillStyle = COLORS.WATER;
                        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

                        // Subtle animated water edge outline
                        ctx.strokeStyle = 'rgba(40, 110, 180, 0.35)';
                        ctx.lineWidth = 1;
                        ctx.strokeRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
                        break;
                    }
                    
                    case TILE.LOUD_FLOOR: {
                        // Warmer dark creaky floor with wooden plank separators
                        ctx.fillStyle = COLORS.LOUD_FLOOR;
                        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
                        
                        // Distinct wooden plank lines
                        ctx.strokeStyle = COLORS.LOUD_FLOOR_PLANK || '#523722';
                        ctx.lineWidth = 1.2;
                        ctx.beginPath();
                        ctx.moveTo(px, py + 10); ctx.lineTo(px + TILE_SIZE, py + 10);
                        ctx.moveTo(px, py + 21); ctx.lineTo(px + TILE_SIZE, py + 21);
                        ctx.stroke();

                        // Crack lines
                        ctx.strokeStyle = '#1b120a';
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        const crackType = ((tx * 11 + ty * 17) % 3);
                        if (crackType === 0) {
                            ctx.moveTo(px + 4, py + 5); ctx.lineTo(px + 14, py + 16); ctx.lineTo(px + 26, py + 14);
                        } else if (crackType === 1) {
                            ctx.moveTo(px + 6, py + 24); ctx.lineTo(px + 16, py + 12); ctx.lineTo(px + 28, py + 8);
                        } else {
                            ctx.moveTo(px + 14, py + 3); ctx.lineTo(px + 12, py + 15); ctx.lineTo(px + 20, py + 28);
                        }
                        ctx.stroke();
                        break;
                    }
                    
                    case TILE.TUNNEL: {
                        // Darker tunnel floor with distinct industrial grating pattern
                        ctx.fillStyle = COLORS.TUNNEL;
                        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
                        
                        ctx.strokeStyle = COLORS.TUNNEL_GRATE || 'rgba(80, 60, 120, 0.4)';
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        ctx.moveTo(px, py + 8); ctx.lineTo(px + TILE_SIZE, py + 8);
                        ctx.moveTo(px, py + 16); ctx.lineTo(px + TILE_SIZE, py + 16);
                        ctx.moveTo(px, py + 24); ctx.lineTo(px + TILE_SIZE, py + 24);
                        ctx.moveTo(px + 16, py); ctx.lineTo(px + 16, py + TILE_SIZE);
                        ctx.stroke();
                        break;
                    }
                    
                    case TILE.DOOR: {
                        // Base floor underneath
                        ctx.fillStyle = COLORS.FLOOR_ALT;
                        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
                        
                        // Doorway frame & rich wooden door leaf
                        ctx.fillStyle = COLORS.DOOR;
                        ctx.fillRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
                        
                        ctx.strokeStyle = COLORS.DOOR_EDGE || '#996339';
                        ctx.lineWidth = 1.5;
                        ctx.strokeRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
                        
                        // Bright gleaming brass doorknob
                        ctx.fillStyle = COLORS.DOOR_HANDLE || '#e0b33b';
                        ctx.beginPath();
                        ctx.arc(px + TILE_SIZE - 7, py + TILE_SIZE / 2, 2.5, 0, Math.PI * 2);
                        ctx.fill();
                        break;
                    }
                    
                    case TILE.EXIT: {
                        // Exit threshold with vibrant eerie greenish glow
                        ctx.fillStyle = '#0d2b22';
                        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
                        
                        ctx.strokeStyle = COLORS.EXIT_GLOW;
                        ctx.lineWidth = 2;
                        ctx.strokeRect(px + 3, py + 3, TILE_SIZE - 6, TILE_SIZE - 6);

                        // Pulsing exit beacon square
                        const exitPulse = Math.sin(this.gameTime * 4) * 0.3 + 0.7;
                        ctx.fillStyle = `rgba(51, 255, 170, ${exitPulse * 0.4})`;
                        ctx.fillRect(px + 6, py + 6, TILE_SIZE - 12, TILE_SIZE - 12);
                        break;
                    }
                    
                    default: {
                        ctx.fillStyle = COLORS.FLOOR;
                        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
                        break;
                    }
                }
            }
        }
    }
    
    // Draw walls and specialized internal room obstacles with rich color and depth
    drawWallTile(ctx, map, tx, ty, px, py) {
        // Detect room context
        const room = map.getRoom ? map.getRoom(px + TILE_SIZE / 2, py + TILE_SIZE / 2) : null;
        const roomName = room ? (room.name || '').toLowerCase() : '';

        // Check if neighboring cardinal tiles are open/walkable
        const northOpen = ty > 0 && map.getTile(tx, ty - 1) !== TILE.WALL;
        const southOpen = ty < (map.height || MAP_HEIGHT) - 1 && map.getTile(tx, ty + 1) !== TILE.WALL;
        const westOpen = tx > 0 && map.getTile(tx - 1, ty) !== TILE.WALL;
        const eastOpen = tx < (map.width || MAP_WIDTH) - 1 && map.getTile(tx + 1, ty) !== TILE.WALL;
        const isInternalObstacle = room && (northOpen || southOpen || westOpen || eastOpen);

        // 1. Hospital Wing Obstacles: Medical Gurneys & Hospital Beds
        if (isInternalObstacle && (roomName.includes('hospital') || roomName.includes('ward') || roomName.includes('morgue'))) {
            // Steel frame
            ctx.fillStyle = COLORS.OBSTACLE_BED || '#5f7394';
            ctx.fillRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
            
            // Clean white/cream sheet
            ctx.fillStyle = COLORS.OBSTACLE_BED_SHEET || '#d2dce8';
            ctx.fillRect(px + 4, py + 4, TILE_SIZE - 8, TILE_SIZE - 8);

            // Pillow top
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(px + 5, py + 5, TILE_SIZE - 10, 6);

            ctx.strokeStyle = '#38465c';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
            return;
        }

        // 2. Office Floor Obstacles: Executive Desks & Cubicle Dividers
        if (isInternalObstacle && roomName.includes('office')) {
            ctx.fillStyle = COLORS.OBSTACLE_DESK || '#78482a';
            ctx.fillRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);

            ctx.fillStyle = COLORS.OBSTACLE_DESK_EDGE || '#b06f43';
            ctx.fillRect(px + 3, py + 3, TILE_SIZE - 6, 5);

            // Brass desk corner studs
            ctx.fillStyle = '#d4a237';
            ctx.fillRect(px + 2, py + 2, 3, 3);
            ctx.fillRect(px + TILE_SIZE - 5, py + 2, 3, 3);

            ctx.strokeStyle = '#3d2010';
            ctx.lineWidth = 1.2;
            ctx.strokeRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
            return;
        }

        // 3. Station Concourse Obstacles: Turnstiles & Architectural Pillars
        if (isInternalObstacle && (roomName.includes('station') || roomName.includes('concourse'))) {
            if (ty >= 40 && ty <= 42) {
                // Subway Turnstiles with yellow warning hazard stripes
                ctx.fillStyle = COLORS.OBSTACLE_TURNSTILE || '#68788c';
                ctx.fillRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);

                ctx.strokeStyle = COLORS.OBSTACLE_TURNSTILE_STRIPE || '#e0ae36';
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.moveTo(px + 4, py + 14); ctx.lineTo(px + 14, py + 4);
                ctx.moveTo(px + 10, py + TILE_SIZE - 4); ctx.lineTo(px + TILE_SIZE - 4, py + 10);
                ctx.stroke();

                ctx.strokeStyle = '#27313d';
                ctx.lineWidth = 1.2;
                ctx.strokeRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
                return;
            } else {
                // Heavy Support Pillars
                ctx.fillStyle = COLORS.OBSTACLE_PILLAR || '#4f5678';
                ctx.fillRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);

                ctx.fillStyle = COLORS.OBSTACLE_PILLAR_EDGE || '#8590bd';
                ctx.fillRect(px + 4, py + 4, TILE_SIZE - 8, TILE_SIZE - 8);

                ctx.strokeStyle = '#252a3d';
                ctx.lineWidth = 1.5;
                ctx.strokeRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
                return;
            }
        }

        // 4. Flooded Basement Obstacles: Pump Machinery & Iron Pipes
        if (isInternalObstacle && roomName.includes('basement')) {
            ctx.fillStyle = COLORS.OBSTACLE_PUMP || '#61432f';
            ctx.fillRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);

            ctx.fillStyle = COLORS.OBSTACLE_PUMP_PIPE || '#966a4a';
            ctx.beginPath();
            ctx.arc(px + TILE_SIZE / 2, py + TILE_SIZE / 2, 7, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = '#2d1b0f';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
            return;
        }

        // 5. Hostel Corridors Obstacles: Bunk Beds & Coffee Tables
        if (isInternalObstacle && (roomName.includes('hostel') || roomName.includes('lounge'))) {
            ctx.fillStyle = COLORS.OBSTACLE_BED || '#5f7394';
            ctx.fillRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);

            ctx.fillStyle = '#8ea4c4';
            ctx.fillRect(px + 4, py + 4, TILE_SIZE - 8, TILE_SIZE - 8);

            ctx.fillStyle = '#ffffff';
            ctx.fillRect(px + 5, py + 5, TILE_SIZE - 10, 6);

            ctx.strokeStyle = '#2c3747';
            ctx.lineWidth = 1.2;
            ctx.strokeRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
            return;
        }

        // 6. Standard Structural & Corridor Walls (Prominent 3D block with bevel)
        ctx.fillStyle = COLORS.WALL;
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

        // Highlighted top inner bevel
        ctx.fillStyle = COLORS.WALL_TOP || '#3a4066';
        ctx.fillRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);

        // Bright perimeter edge highlights
        ctx.strokeStyle = COLORS.WALL_EDGE;
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (northOpen) {
            ctx.moveTo(px, py + 1); ctx.lineTo(px + TILE_SIZE, py + 1);
        } else {
            ctx.moveTo(px, py); ctx.lineTo(px + TILE_SIZE, py);
        }
        if (westOpen) {
            ctx.moveTo(px + 1, py); ctx.lineTo(px + 1, py + TILE_SIZE);
        } else {
            ctx.moveTo(px, py); ctx.lineTo(px, py + TILE_SIZE);
        }
        ctx.stroke();

        // Dark depth shadow on south/east edges
        ctx.strokeStyle = '#06060c';
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (southOpen) {
            ctx.moveTo(px, py + TILE_SIZE - 1); ctx.lineTo(px + TILE_SIZE, py + TILE_SIZE - 1);
        }
        if (eastOpen) {
            ctx.moveTo(px + TILE_SIZE - 1, py); ctx.lineTo(px + TILE_SIZE - 1, py + TILE_SIZE);
        }
        ctx.stroke();
    }
    drawWaterEffects(map, dt) {
        if (!map || !map.tiles) return;
        
        const ctx = this.ctx;
        const leftWorld = this.camX + this.shakeX;
        const topWorld = this.camY + this.shakeY;
        
        const startCol = Math.max(0, Math.floor(leftWorld / TILE_SIZE) - 1);
        const endCol = Math.min((map.width || MAP_WIDTH) - 1, Math.ceil((leftWorld + this.width) / TILE_SIZE) + 1);
        const startRow = Math.max(0, Math.floor(topWorld / TILE_SIZE) - 1);
        const endRow = Math.min((map.height || MAP_HEIGHT) - 1, Math.ceil((topWorld + this.height) / TILE_SIZE) + 1);
        
        for (let ty = startRow; ty <= endRow; ty++) {
            const row = map.tiles[ty];
            if (!row) continue;
            for (let tx = startCol; tx <= endCol; tx++) {
                if (row[tx] === TILE.WATER) {
                    const px = tx * TILE_SIZE;
                    const py = ty * TILE_SIZE;
                    
                    // Slow undulating sine wave shimmer
                    const wave = Math.sin(this.gameTime * 1.8 + (tx * 0.7 + ty * 0.9)) * 0.5 + 0.5;
                    const shimmerAlpha = 0.08 + wave * 0.14;
                    
                    ctx.fillStyle = `rgba(26, 58, 92, ${shimmerAlpha})`;
                    ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
                    
                    // Subtle dynamic ripple line
                    const rippleY = py + ((this.gameTime * 8 + (tx * 13)) % TILE_SIZE);
                    ctx.strokeStyle = `rgba(50, 110, 170, ${shimmerAlpha * 0.7})`;
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(px + 4, rippleY);
                    ctx.quadraticCurveTo(px + TILE_SIZE / 2, rippleY + 2 * Math.sin(this.gameTime * 2 + tx), px + TILE_SIZE - 4, rippleY);
                    ctx.stroke();
                }
            }
        }
    }
    
    // Draw the fog of war - everything is black except near the player
    drawFog(player) {
        if (!this.fogCanvas || !this.fogCtx || !player) return;
        
        const fCtx = this.fogCtx;
        const pScreen = this.worldToScreen(player.x, player.y);
        
        // 1. Fill off-screen fog canvas completely with opaque darkness
        fCtx.globalCompositeOperation = 'source-over';
        fCtx.fillStyle = COLORS.FOG || '#0a0a0f';
        fCtx.fillRect(0, 0, this.width, this.height);
        
        // 2. Cut out illuminated areas using destination-out
        fCtx.globalCompositeOperation = 'destination-out';
        
        // Ambient visibility circle around player (~65px)
        const ambientRadius = 65;
        const ambGrad = fCtx.createRadialGradient(pScreen.x, pScreen.y, 0, pScreen.x, pScreen.y, ambientRadius);
        ambGrad.addColorStop(0, 'rgba(0, 0, 0, 1.0)');
        ambGrad.addColorStop(0.5, 'rgba(0, 0, 0, 0.85)');
        ambGrad.addColorStop(0.8, 'rgba(0, 0, 0, 0.4)');
        ambGrad.addColorStop(1, 'rgba(0, 0, 0, 0.0)');
        
        fCtx.fillStyle = ambGrad;
        fCtx.beginPath();
        fCtx.arc(pScreen.x, pScreen.y, ambientRadius, 0, Math.PI * 2);
        fCtx.fill();
        
        // Flashlight beam cone cutout
        const isFlashlightOn = player.flashlightOn && (player.flashlightBattery === undefined || player.flashlightBattery > 0);
        if (isFlashlightOn) {
            let range = FLASHLIGHT_RANGE;
            
            // Battery low flicker
            if (player.flashlightBattery !== undefined && player.flashlightBattery < 20) {
                range *= randomFloat(0.8, 1.0);
                if (Math.random() < 0.12) {
                    range *= 0.6; // brief drop
                }
            }
            range *= this.globalFlicker;
            
            const fAngle = player.flashlightAngle !== undefined ? player.flashlightAngle : (player.angle || 0);
            
            // Primary cone cut with radial gradient falloff
            const coneGrad = fCtx.createRadialGradient(pScreen.x, pScreen.y, 10, pScreen.x, pScreen.y, range);
            coneGrad.addColorStop(0.0, 'rgba(0, 0, 0, 1.0)');
            coneGrad.addColorStop(0.3, 'rgba(0, 0, 0, 0.95)');
            coneGrad.addColorStop(0.7, 'rgba(0, 0, 0, 0.6)');
            coneGrad.addColorStop(0.9, 'rgba(0, 0, 0, 0.25)');
            coneGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
            
            fCtx.fillStyle = coneGrad;
            fCtx.beginPath();
            fCtx.moveTo(pScreen.x, pScreen.y);
            fCtx.arc(pScreen.x, pScreen.y, range, fAngle - FLASHLIGHT_ANGLE, fAngle + FLASHLIGHT_ANGLE);
            fCtx.closePath();
            fCtx.fill();
            
            // Outer feathered edge
            const featherGrad = fCtx.createRadialGradient(pScreen.x, pScreen.y, 10, pScreen.x, pScreen.y, range * 0.95);
            featherGrad.addColorStop(0.0, 'rgba(0, 0, 0, 0.45)');
            featherGrad.addColorStop(0.8, 'rgba(0, 0, 0, 0.15)');
            featherGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
            
            fCtx.fillStyle = featherGrad;
            fCtx.beginPath();
            fCtx.moveTo(pScreen.x, pScreen.y);
            fCtx.arc(pScreen.x, pScreen.y, range * 0.95, fAngle - FLASHLIGHT_ANGLE * 1.15, fAngle + FLASHLIGHT_ANGLE * 1.15);
            fCtx.closePath();
            fCtx.fill();
        }
        
        // Memory stones glow cuts subtle light into the fog
        if (this.map && this.map.stones) {
            for (const stone of this.map.stones) {
                if (stone.collected) continue;
                const sx = stone.x !== undefined ? stone.x : tileToPixel(stone.tx);
                const sy = stone.y !== undefined ? stone.y : tileToPixel(stone.ty);
                const sScreen = this.worldToScreen(sx, sy);
                
                if (sScreen.x >= -80 && sScreen.x <= this.width + 80 && sScreen.y >= -80 && sScreen.y <= this.height + 80) {
                    const stoneLight = fCtx.createRadialGradient(sScreen.x, sScreen.y, 2, sScreen.x, sScreen.y, 70);
                    stoneLight.addColorStop(0.0, 'rgba(0, 0, 0, 0.85)');
                    stoneLight.addColorStop(0.5, 'rgba(0, 0, 0, 0.45)');
                    stoneLight.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
                    
                    fCtx.fillStyle = stoneLight;
                    fCtx.beginPath();
                    fCtx.arc(sScreen.x, sScreen.y, 70, 0, Math.PI * 2);
                    fCtx.fill();
                }
            }
        }
        
        // 3. Draw fog layer over the main game canvas
        this.ctx.save();
        this.ctx.globalCompositeOperation = 'source-over';
        this.ctx.drawImage(this.fogCanvas, 0, 0);
        this.ctx.restore();
    }
    
    // Draw the flashlight cone of light (warm volumetric beam)
    drawFlashlight(player) {
        if (!player || !player.flashlightOn || (player.flashlightBattery !== undefined && player.flashlightBattery <= 0)) {
            return;
        }
        
        const pScreen = this.worldToScreen(player.x, player.y);
        const fAngle = player.flashlightAngle !== undefined ? player.flashlightAngle : (player.angle || 0);
        let range = FLASHLIGHT_RANGE;
        
        if (player.flashlightBattery !== undefined && player.flashlightBattery < 20) {
            range *= randomFloat(0.8, 1.0);
        }
        range *= this.globalFlicker;
        
        this.ctx.save();
        this.ctx.globalCompositeOperation = 'lighter';
        
        // Warm center beam
        const warmGrad = this.ctx.createRadialGradient(pScreen.x, pScreen.y, 6, pScreen.x, pScreen.y, range);
        warmGrad.addColorStop(0.0, 'rgba(255, 240, 200, 0.18)');
        warmGrad.addColorStop(0.4, 'rgba(255, 230, 180, 0.09)');
        warmGrad.addColorStop(0.8, 'rgba(255, 220, 160, 0.03)');
        warmGrad.addColorStop(1.0, 'rgba(255, 220, 160, 0.0)');
        
        this.ctx.fillStyle = warmGrad;
        this.ctx.beginPath();
        this.ctx.moveTo(pScreen.x, pScreen.y);
        this.ctx.arc(pScreen.x, pScreen.y, range, fAngle - FLASHLIGHT_ANGLE, fAngle + FLASHLIGHT_ANGLE);
        this.ctx.closePath();
        this.ctx.fill();
        
        // Bright core cone near source
        const coreGrad = this.ctx.createRadialGradient(pScreen.x, pScreen.y, 2, pScreen.x, pScreen.y, range * 0.45);
        coreGrad.addColorStop(0.0, 'rgba(255, 248, 220, 0.16)');
        coreGrad.addColorStop(1.0, 'rgba(255, 248, 220, 0.0)');
        
        this.ctx.fillStyle = coreGrad;
        this.ctx.beginPath();
        this.ctx.moveTo(pScreen.x, pScreen.y);
        this.ctx.arc(pScreen.x, pScreen.y, range * 0.45, fAngle - FLASHLIGHT_ANGLE * 0.5, fAngle + FLASHLIGHT_ANGLE * 0.5);
        this.ctx.closePath();
        this.ctx.fill();
        
        this.ctx.restore();
    }
    
    // Draw the player character
    drawPlayer(player) {
        if (!player) return;
        
        const ctx = this.ctx;
        ctx.save();
        
        const bob = (player.isMoving && player.bobAmount !== undefined) ? player.bobAmount : 0;
        const px = player.x;
        const py = player.y + bob;
        const r = player.radius || 10;
        
        // 50% opacity when hiding
        if (player.isHiding) {
            ctx.globalAlpha = 0.5;
        }
        
        // Blue aura when holding breath
        if (player.isHoldingBreath) {
            const auraPulse = Math.sin(this.gameTime * 6) * 0.2 + 0.8;
            const auraGrad = ctx.createRadialGradient(px, py, r * 0.6, px, py, (r + 9) * auraPulse);
            auraGrad.addColorStop(0.0, 'rgba(80, 160, 255, 0.45)');
            auraGrad.addColorStop(0.7, 'rgba(80, 160, 255, 0.15)');
            auraGrad.addColorStop(1.0, 'rgba(80, 160, 255, 0.0)');
            
            ctx.fillStyle = auraGrad;
            ctx.beginPath();
            ctx.arc(px, py, (r + 9) * auraPulse, 0, Math.PI * 2);
            ctx.fill();
        }
        
        // Player body circle
        ctx.fillStyle = COLORS.PLAYER;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.strokeStyle = COLORS.PLAYER_OUTLINE;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        
        // Tiny direction indicator triangle pointing at player.angle
        const angle = player.angle !== undefined ? player.angle : 0;
        const tipX = px + Math.cos(angle) * (r + 4);
        const tipY = py + Math.sin(angle) * (r + 4);
        const leftX = px + Math.cos(angle + 2.5) * (r - 2);
        const leftY = py + Math.sin(angle + 2.5) * (r - 2);
        const rightX = px + Math.cos(angle - 2.5) * (r - 2);
        const rightY = py + Math.sin(angle - 2.5) * (r - 2);
        
        ctx.fillStyle = COLORS.PLAYER_OUTLINE;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(leftX, leftY);
        ctx.lineTo(rightX, rightY);
        ctx.closePath();
        ctx.fill();
        
        ctx.restore();
    }

    // Draw connected remote multiplayer friends
    drawRemotePlayers(network) {
        if (!network || !network.remotePlayers) return;
        const ctx = this.ctx;
        const peerColors = COLORS.PEER_PLAYERS || ['#33ddaa', '#ffaa44', '#dd66ff', '#44aaff'];

        for (const rp of Object.values(network.remotePlayers)) {
            if (!rp.x && !rp.y) continue;
            ctx.save();

            if (rp.isHiding) {
                ctx.globalAlpha = 0.45;
            }

            const pCol = peerColors[(rp.colorIndex || 1) % peerColors.length];
            const px = rp.x;
            const py = rp.y;
            const r = 10;

            // Flashlight beam for remote peer
            if (rp.flashlightOn) {
                const fAngle = rp.flashlightAngle !== undefined ? rp.flashlightAngle : (rp.angle || 0);
                ctx.save();
                ctx.globalCompositeOperation = 'lighter';
                const fGrad = ctx.createRadialGradient(px, py, 4, px, py, FLASHLIGHT_RANGE * 0.85);
                fGrad.addColorStop(0.0, 'rgba(255, 240, 200, 0.14)');
                fGrad.addColorStop(0.8, 'rgba(255, 220, 160, 0.03)');
                fGrad.addColorStop(1.0, 'rgba(255, 220, 160, 0.0)');
                ctx.fillStyle = fGrad;
                ctx.beginPath();
                ctx.moveTo(px, py);
                ctx.arc(px, py, FLASHLIGHT_RANGE * 0.85, fAngle - FLASHLIGHT_ANGLE, fAngle + FLASHLIGHT_ANGLE);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
            }

            // Glowing cyan aura if peer carries the Banishment Relic
            if (rp.hasRelic) {
                const auraPulse = Math.sin(this.gameTime * 5) * 0.3 + 0.7;
                ctx.fillStyle = `rgba(0, 255, 238, ${auraPulse * 0.35})`;
                ctx.beginPath();
                ctx.arc(px, py, 18, 0, Math.PI * 2);
                ctx.fill();
            }

            // Peer body
            ctx.fillStyle = pCol;
            ctx.beginPath();
            ctx.arc(px, py, r, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Facing pointer
            const ang = rp.angle || 0;
            const tipX = px + Math.cos(ang) * (r + 4);
            const tipY = py + Math.sin(ang) * (r + 4);
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(tipX, tipY, 2.5, 0, Math.PI * 2);
            ctx.fill();

            // Peer Name Badge
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            const nameText = rp.name || 'Friend';
            const nw = ctx.measureText(nameText).width;

            ctx.fillStyle = 'rgba(7, 10, 18, 0.85)';
            ctx.fillRect(px - nw / 2 - 4, py - 18, nw + 8, 13);
            ctx.strokeStyle = pCol;
            ctx.lineWidth = 0.8;
            ctx.strokeRect(px - nw / 2 - 4, py - 18, nw + 8, 13);

            ctx.fillStyle = '#ffffff';
            ctx.fillText(nameText, px, py - 7);

            // Voice Activity Wave Bubble (when friend is talking)
            if (rp.isTalking) {
                ctx.font = '10px monospace';
                ctx.fillText('🎙️', px + nw / 2 + 8, py - 7);
            }

            // Diamond badge if carrying >= 2 stones
            if (rp.stonesCollected >= 2) {
                ctx.font = '9px monospace';
                ctx.fillStyle = '#ffcc66';
                ctx.fillText('💎x' + rp.stonesCollected, px, py - 21);
            }

            ctx.restore();
        }
    }
    
    // Draw the Listener monster
    drawListener(listener) {
        if (!listener) return;
        
        // The Listener should ONLY be visible if within the player's flashlight cone or ambient visibility
        const isLit = this.isListenerLit(listener, this.player);
        if (!isLit) {
            // When unlit, the body is hidden.
            // Faint eyes are drawn post-fog in drawDarkListenerEyes()
            return;
        }
        
        const ctx = this.ctx;
        ctx.save();
        
        const isHunt = (listener.state === LISTENER_STATE.HUNT);
        const angle = listener.angle !== undefined ? listener.angle : 0;
        const headTilt = listener.headTilt || 0;
        
        // In HUNT state: subtle red aura around the Listener
        if (isHunt) {
            const auraPulse = Math.sin(this.gameTime * 10) * 0.2 + 0.8;
            const huntAura = ctx.createRadialGradient(listener.x, listener.y, 4, listener.x, listener.y, 36 * auraPulse);
            huntAura.addColorStop(0.0, 'rgba(255, 30, 30, 0.4)');
            huntAura.addColorStop(0.6, 'rgba(255, 30, 30, 0.15)');
            huntAura.addColorStop(1.0, 'rgba(255, 30, 30, 0.0)');
            
            ctx.fillStyle = huntAura;
            ctx.beginPath();
            ctx.arc(listener.x, listener.y, 36 * auraPulse, 0, Math.PI * 2);
            ctx.fill();
        }
        
        ctx.translate(listener.x, listener.y);
        ctx.rotate(angle);
        
        // Doll-like body: an oval shape (wider at bottom)
        ctx.fillStyle = COLORS.LISTENER_BODY; // '#f0e0d0'
        ctx.beginPath();
        ctx.moveTo(0, -14);
        ctx.bezierCurveTo(11, -14, 15, 13, 8, 16);
        ctx.bezierCurveTo(4, 18, -4, 18, -8, 16);
        ctx.bezierCurveTo(-15, 13, -11, -14, 0, -14);
        ctx.closePath();
        ctx.fill();
        
        // Subtle outline
        ctx.strokeStyle = '#c8b6a4';
        ctx.lineWidth = 1;
        ctx.stroke();
        
        // Porcelain texture: subtle fine dark crack lines
        ctx.strokeStyle = 'rgba(70, 50, 50, 0.4)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(-4, -6);
        ctx.lineTo(-1, 1);
        ctx.lineTo(-6, 7);
        ctx.moveTo(3, -3);
        ctx.lineTo(6, 4);
        ctx.stroke();
        
        // Face features with head tilt rotation
        ctx.save();
        ctx.rotate(headTilt);
        
        // Very small white lips
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-3, 6, 6, 2);
        
        // Hint of red for teeth (small line)
        ctx.fillStyle = '#991111';
        ctx.fillRect(-2, 7, 4, 1);
        
        // TWO glowing red eyes: small circles with COLORS.LISTENER_EYE
        const eyeGlowVal = listener.eyeGlow !== undefined ? listener.eyeGlow : 1.0;
        const pulseSpeed = isHunt ? 14 : 5;
        const pulseFactor = Math.sin(this.gameTime * pulseSpeed) * 0.25 + 0.75;
        const eyeIntensity = (isHunt ? 1.4 : 1.0) * eyeGlowVal * pulseFactor;
        
        const eyeOffsets = [-5, 5];
        for (const ex of eyeOffsets) {
            const ey = -2;
            const glowR = (isHunt ? 12 : 8) * eyeIntensity;
            
            // Red glow behind each eye
            const eyeGrad = ctx.createRadialGradient(ex, ey, 1, ex, ey, glowR);
            eyeGrad.addColorStop(0.0, 'rgba(255, 34, 34, 0.85)');
            eyeGrad.addColorStop(0.4, 'rgba(255, 34, 34, 0.35)');
            eyeGrad.addColorStop(1.0, 'rgba(255, 34, 34, 0.0)');
            
            ctx.fillStyle = eyeGrad;
            ctx.beginPath();
            ctx.arc(ex, ey, glowR, 0, Math.PI * 2);
            ctx.fill();
            
            // Eye core
            ctx.fillStyle = COLORS.LISTENER_EYE;
            ctx.beginPath();
            ctx.arc(ex, ey, 2.2, 0, Math.PI * 2);
            ctx.fill();
            
            // Tiny pale pinpoint
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(ex + 0.6, ey - 0.6, 0.7, 0, Math.PI * 2);
            ctx.fill();
        }
        
        ctx.restore(); // Face tilt
        ctx.restore(); // Listener body
    }
    
    // Draw faint red glowing eyes in the pitch darkness (when listener is within 300px of player but unlit)
    drawDarkListenerEyes(listener) {
        if (!listener) return;
        
        const sPos = this.worldToScreen(listener.x, listener.y);
        const headTilt = listener.headTilt || 0;
        const angle = listener.angle !== undefined ? listener.angle : 0;
        const isHunt = (listener.state === LISTENER_STATE.HUNT);
        const pulseSpeed = isHunt ? 14 : 5;
        const pulseFactor = Math.sin(this.gameTime * pulseSpeed) * 0.3 + 0.7;
        
        this.ctx.save();
        this.ctx.translate(sPos.x, sPos.y);
        this.ctx.rotate(angle + headTilt);
        
        const eyeOffsets = [-5, 5];
        for (const ex of eyeOffsets) {
            const ey = -2;
            const glowR = (isHunt ? 11 : 7) * pulseFactor;
            
            const eyeGrad = this.ctx.createRadialGradient(ex, ey, 1, ex, ey, glowR);
            eyeGrad.addColorStop(0.0, 'rgba(255, 34, 34, 0.75)');
            eyeGrad.addColorStop(0.5, 'rgba(255, 34, 34, 0.25)');
            eyeGrad.addColorStop(1.0, 'rgba(255, 34, 34, 0.0)');
            
            this.ctx.fillStyle = eyeGrad;
            this.ctx.beginPath();
            this.ctx.arc(ex, ey, glowR, 0, Math.PI * 2);
            this.ctx.fill();
            
            this.ctx.fillStyle = COLORS.LISTENER_EYE;
            this.ctx.beginPath();
            this.ctx.arc(ex, ey, 1.8, 0, Math.PI * 2);
            this.ctx.fill();
        }
        
        this.ctx.restore();
    }
    
    // Draw items on the ground
    drawItems(map) {
        if (!map || !map.items) return;
        
        const ctx = this.ctx;
        for (const item of map.items) {
            if (item.collected) continue;
            
            const ix = item.x !== undefined ? item.x : tileToPixel(item.tx);
            const iy = item.y !== undefined ? item.y : tileToPixel(item.ty);
            
            // Subtle floating bob
            const bob = Math.sin(this.gameTime * 3 + ix * 0.1) * 1.5;
            const drawY = iy + bob;
            
            // Subtle discovery glow
            const itemGlow = ctx.createRadialGradient(ix, drawY, 1, ix, drawY, 14);
            itemGlow.addColorStop(0.0, 'rgba(255, 255, 200, 0.35)');
            itemGlow.addColorStop(1.0, 'rgba(255, 255, 200, 0.0)');
            ctx.fillStyle = itemGlow;
            ctx.beginPath();
            ctx.arc(ix, drawY, 14, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.save();
            ctx.translate(ix, drawY);
            
            const type = item.type;
            if (type === ITEM_TYPE.BATTERY || type === 'battery') {
                // Battery: small yellow rectangle with terminal tab
                ctx.fillStyle = '#eedd33';
                ctx.fillRect(-4, -6, 8, 12);
                
                ctx.fillStyle = '#fff477';
                ctx.fillRect(-2, -8, 4, 2);
                
                ctx.strokeStyle = '#887711';
                ctx.lineWidth = 0.8;
                ctx.strokeRect(-4, -6, 8, 12);
            } else if (type === ITEM_TYPE.KEY || type === 'key') {
                // Key: colored key shape (lines with a circle head)
                const keyColor = item.color || '#e5a93b';
                ctx.strokeStyle = keyColor;
                ctx.fillStyle = keyColor;
                ctx.lineWidth = 1.5;
                
                // Key head
                ctx.beginPath();
                ctx.arc(0, -4, 3.5, 0, Math.PI * 2);
                ctx.stroke();
                
                // Key shaft & teeth
                ctx.beginPath();
                ctx.moveTo(0, -0.5);
                ctx.lineTo(0, 8);
                ctx.moveTo(0, 4);
                ctx.lineTo(3, 4);
                ctx.moveTo(0, 7);
                ctx.lineTo(2.5, 7);
                ctx.stroke();
            } else if (type === ITEM_TYPE.THROWABLE || type === 'throwable' || type === 'rock') {
                // Throwable: small brown circle
                ctx.fillStyle = '#7a5433';
                ctx.beginPath();
                ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
                ctx.fill();
                
                ctx.strokeStyle = '#4d321d';
                ctx.lineWidth = 1;
                ctx.stroke();
            } else if (type === ITEM_TYPE.BANISH_RELIC || type === 'banish_relic') {
                // Banishment Relic: Radiant sacred star / cross with glowing pulsing aura
                const rPulse = Math.sin(this.gameTime * 5) * 0.25 + 0.75;
                ctx.fillStyle = `rgba(0, 255, 238, ${rPulse * 0.4})`;
                ctx.beginPath();
                ctx.arc(0, 0, 16 * rPulse, 0, Math.PI * 2);
                ctx.fill();

                // Core radiant star
                ctx.fillStyle = '#ffffff';
                ctx.strokeStyle = '#00ffee';
                ctx.lineWidth = 1.8;
                ctx.beginPath();
                ctx.moveTo(0, -9); ctx.lineTo(2.5, -2.5);
                ctx.lineTo(9, 0); ctx.lineTo(2.5, 2.5);
                ctx.lineTo(0, 9); ctx.lineTo(-2.5, 2.5);
                ctx.lineTo(-9, 0); ctx.lineTo(-2.5, -2.5);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();

                // Inner core jewel
                ctx.fillStyle = '#00ffee';
                ctx.beginPath();
                ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
                ctx.fill();
            } else {
                // Generic item token / diary page
                ctx.fillStyle = '#dcdcdc';
                ctx.fillRect(-4, -5, 8, 10);
                ctx.strokeStyle = '#777777';
                ctx.lineWidth = 0.8;
                ctx.strokeRect(-4, -5, 8, 10);
            }
            
            ctx.restore();
        }
    }
    
    // Draw memory stones with glow effect
    drawStones(map) {
        if (!map || !map.stones) return;
        
        const ctx = this.ctx;
        for (const stone of map.stones) {
            if (stone.collected) continue;
            
            const sx = stone.x !== undefined ? stone.x : tileToPixel(stone.tx);
            const sy = stone.y !== undefined ? stone.y : tileToPixel(stone.ty);
            
            // Concentric rings expanding outward (animated hum effect)
            const humPhase = (this.gameTime * 0.7) % 1.0;
            for (let i = 0; i < 3; i++) {
                const ringProgress = (humPhase + i / 3) % 1.0;
                const ringRadius = 6 + ringProgress * 32;
                const ringAlpha = (1.0 - ringProgress) * 0.45;
                
                ctx.strokeStyle = `rgba(255, 170, 51, ${ringAlpha})`;
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                ctx.arc(sx, sy, ringRadius, 0, Math.PI * 2);
                ctx.stroke();
            }
            
            // Pulsing radial gradient steady glow
            const pulse = Math.sin(this.gameTime * 2.5) * 0.15 + 0.85;
            const glowGrad = ctx.createRadialGradient(sx, sy, 2, sx, sy, 26 * pulse);
            glowGrad.addColorStop(0.0, 'rgba(255, 220, 120, 0.85)');
            glowGrad.addColorStop(0.35, 'rgba(255, 170, 51, 0.4)');
            glowGrad.addColorStop(0.8, 'rgba(255, 170, 51, 0.1)');
            glowGrad.addColorStop(1.0, 'rgba(255, 170, 51, 0.0)');
            
            ctx.fillStyle = glowGrad;
            ctx.beginPath();
            ctx.arc(sx, sy, 26 * pulse, 0, Math.PI * 2);
            ctx.fill();
            
            // Core amber stone
            ctx.fillStyle = '#ffcc66';
            ctx.beginPath();
            ctx.arc(sx, sy, 4.5, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 0.8;
            ctx.stroke();
        }
    }
    
    // Draw hiding spots (subtle markers)
    drawHidingSpots(map) {
        if (!map) return;
        const ctx = this.ctx;
        
        // 1. Draw from map.hidingSpots array if present
        if (map.hidingSpots && map.hidingSpots.length > 0) {
            for (const spot of map.hidingSpots) {
                const sx = spot.x !== undefined ? spot.x : tileToPixel(spot.tx);
                const sy = spot.y !== undefined ? spot.y : tileToPixel(spot.ty);
                const isBed = spot.type === 'bed';
                this.renderHidingSpotGraphic(ctx, sx, sy, isBed);
            }
        }
        
        // 2. Also check tiles for TILE.HIDING_SPOT if hidingSpots array not fully populated
        if (map.tiles) {
            const leftWorld = this.camX + this.shakeX;
            const topWorld = this.camY + this.shakeY;
            const startCol = Math.max(0, Math.floor(leftWorld / TILE_SIZE) - 1);
            const endCol = Math.min((map.width || MAP_WIDTH) - 1, Math.ceil((leftWorld + this.width) / TILE_SIZE) + 1);
            const startRow = Math.max(0, Math.floor(topWorld / TILE_SIZE) - 1);
            const endRow = Math.min((map.height || MAP_HEIGHT) - 1, Math.ceil((topWorld + this.height) / TILE_SIZE) + 1);
            
            for (let ty = startRow; ty <= endRow; ty++) {
                const row = map.tiles[ty];
                if (!row) continue;
                for (let tx = startCol; tx <= endCol; tx++) {
                    if (row[tx] === TILE.HIDING_SPOT) {
                        const sx = tileToPixel(tx);
                        const sy = tileToPixel(ty);
                        const isBed = ((tx + ty) % 2 === 0);
                        this.renderHidingSpotGraphic(ctx, sx, sy, isBed);
                    }
                }
            }
        }
    }
    
    // Internal helper for furniture shape
    renderHidingSpotGraphic(ctx, sx, sy, isBed) {
        ctx.save();
        ctx.translate(sx, sy);
        
        if (isBed) {
            // Bed: prominent rounded hospital/hostel bed frame with crisp pillow and sheet
            ctx.fillStyle = '#2d3b4d';
            ctx.strokeStyle = '#5a7396';
            ctx.lineWidth = 1.8;
            
            ctx.beginPath();
            ctx.ellipse(0, 0, 13, 15, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            
            // Sheet & pillow
            ctx.fillStyle = '#7a96bd';
            ctx.fillRect(-7, -4, 14, 17);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(-7, -11, 14, 6);
        } else {
            // Locker / Cabinet: distinct olive-emerald locker with shiny vents and latch
            ctx.fillStyle = COLORS.HIDING_SPOT || '#265431';
            ctx.strokeStyle = COLORS.HIDING_SPOT_OUTLINE || '#4fa864';
            ctx.lineWidth = 1.8;
            
            ctx.fillRect(-9, -14, 18, 28);
            ctx.strokeRect(-9, -14, 18, 28);
            
            // Louver vent slots
            ctx.strokeStyle = '#122617';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(-6, -7); ctx.lineTo(6, -7);
            ctx.moveTo(-6, -2); ctx.lineTo(6, -2);
            ctx.moveTo(-6, 3); ctx.lineTo(6, 3);
            ctx.stroke();

            // Brass handle
            ctx.fillStyle = '#d8ab38';
            ctx.fillRect(4, -1, 2.5, 6);
        }
        
        ctx.restore();
    }
    
    // Add a particle
    addParticle(x, y, vx, vy, life, size, color, type) {
        if (this.particles.length >= this.maxParticles) {
            this.particles.shift();
        }
        this.particles.push({
            x: x,
            y: y,
            vx: vx,
            vy: vy,
            life: life,
            maxLife: life,
            size: size,
            color: color,
            type: type || 'dust'
        });
    }
    
    // Spawn ambient particles (dust motes, drips, stone sparkles, chase embers)
    spawnAmbientParticles(player, map, dt) {
        if (!player) return;
        
        // 1. Dust motes drifting near player
        this.dustTimer += dt;
        if (this.dustTimer > 0.08) {
            this.dustTimer = 0;
            const rx = player.x + randomFloat(-160, 160);
            const ry = player.y + randomFloat(-160, 160);
            this.addParticle(
                rx, ry,
                randomFloat(-4, 4), randomFloat(-4, 4),
                randomFloat(2.5, 4.5),
                randomFloat(1.0, 1.8),
                'rgba(240, 245, 255, ALPHA)',
                'dust'
            );
        }
        
        // 2. Water drips in water areas
        this.dripTimer += dt;
        if (this.dripTimer > 0.3 && map && map.tiles) {
            this.dripTimer = 0;
            const pTileX = pixelToTile(player.x);
            const pTileY = pixelToTile(player.y);
            
            // Check nearby tiles for water
            for (let dy = -4; dy <= 4; dy++) {
                for (let dx = -4; dx <= 4; dx++) {
                    const tx = pTileX + dx;
                    const ty = pTileY + dy;
                    if (map.tiles[ty] && map.tiles[ty][tx] === TILE.WATER && Math.random() < 0.15) {
                        this.addParticle(
                            tileToPixel(tx) + randomFloat(-12, 12),
                            tileToPixel(ty) - 16,
                            0, randomFloat(60, 90),
                            0.4,
                            randomFloat(1.5, 2.2),
                            'rgba(80, 150, 220, ALPHA)',
                            'drip'
                        );
                    }
                }
            }
        }
        
        // 3. Stone particles (sparkles near uncollected stones)
        if (map && map.stones) {
            for (const stone of map.stones) {
                if (stone.collected) continue;
                const sx = stone.x !== undefined ? stone.x : tileToPixel(stone.tx);
                const sy = stone.y !== undefined ? stone.y : tileToPixel(stone.ty);
                if (dist(player.x, player.y, sx, sy) < 300 && Math.random() < 0.25) {
                    this.addParticle(
                        sx + randomFloat(-8, 8),
                        sy + randomFloat(-8, 8),
                        randomFloat(-6, 6), randomFloat(-18, -32),
                        randomFloat(0.8, 1.6),
                        randomFloat(1.2, 2.0),
                        'rgba(255, 190, 70, ALPHA)',
                        'stone'
                    );
                }
            }
        }
        
        // 4. Chase particles (trailing the Listener during HUNT state)
        if (this.listener && this.listener.state === LISTENER_STATE.HUNT) {
            for (let i = 0; i < 2; i++) {
                this.addParticle(
                    this.listener.x + randomFloat(-10, 10),
                    this.listener.y + randomFloat(-10, 10),
                    randomFloat(-25, 25), randomFloat(-25, 25),
                    randomFloat(0.3, 0.7),
                    randomFloat(1.5, 2.8),
                    'rgba(255, 34, 34, ALPHA)',
                    'chase'
                );
            }
        }
    }
    
    // Update and remove dead particles
    updateParticles(dt) {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.life -= dt;
            if (p.life <= 0) {
                this.particles.splice(i, 1);
            }
        }
    }
    
    // Draw particles
    drawParticles(dt) {
        const ctx = this.ctx;
        const player = this.player;
        
        for (const p of this.particles) {
            const progress = clamp(p.life / p.maxLife, 0, 1);
            let alpha = progress;
            
            // Dust motes are only visible in flashlight beam or ambient circle
            if (p.type === 'dust') {
                const isLit = this.isPointLit(p.x, p.y, player);
                if (!isLit) {
                    continue; // Skip rendering unlit dust motes
                }
                alpha *= 0.5;
            }
            
            const colorStr = p.color.replace('ALPHA', alpha.toFixed(2));
            ctx.fillStyle = colorStr;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    
    // Draw the HUD (noise bar, inventory, stamina, etc.)
    drawHUD(player, audioManager, listener, gameState) {
        if (!player) return;
        
        this.drawNoiseBar(audioManager);
        this.drawInventory(player);
        this.drawBreathBar(player);
        this.drawBatteryIndicator(player);
        this.drawMinimap(this.map, player, listener);
        this.drawStoneCounter(player);

        if (this.network) {
            this.drawMultiplayerHUD(this.network, player);
        }

        if (player && player.hasRelic) {
            this.drawRelicPrompt();
        }

        if (this.showFullMap) {
            this.drawFullMap(this.map, player, listener);
        }
    }

    // Draw multiplayer group HUD in top right
    drawMultiplayerHUD(network, player) {
        if (!network || !network.roomCode) return;
        const ctx = this.ctx;
        ctx.save();

        const boxX = this.width - 190;
        const boxY = 20;
        const boxW = 170;
        const players = network.getPlayerList();
        const boxH = 34 + players.length * 18;

        // Panel background
        ctx.fillStyle = 'rgba(7, 10, 18, 0.88)';
        this.drawRoundedRect(ctx, boxX, boxY, boxW, boxH, 6, true, false);

        ctx.strokeStyle = 'rgba(70, 110, 170, 0.45)';
        ctx.lineWidth = 1;
        this.drawRoundedRect(ctx, boxX, boxY, boxW, boxH, 6, false, true);

        // Group Room Code Header
        ctx.font = 'bold 10px monospace';
        ctx.fillStyle = '#65b2f0';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(`ROOM: ${network.roomCode}`, boxX + 10, boxY + 8);

        // Mic status badge on right
        ctx.font = '10px monospace';
        ctx.textAlign = 'right';
        ctx.fillStyle = network.micMuted ? '#ff5555' : '#33ffaa';
        ctx.fillText(network.micMuted ? '🔇 MUTED [V]' : '🎙️ LIVE [V]', boxX + boxW - 10, boxY + 8);

        // Thin divider
        ctx.strokeStyle = 'rgba(70, 110, 170, 0.25)';
        ctx.beginPath();
        ctx.moveTo(boxX + 6, boxY + 24);
        ctx.lineTo(boxX + boxW - 6, boxY + 24);
        ctx.stroke();

        // Player entries
        for (let i = 0; i < players.length; i++) {
            const p = players[i];
            const py = boxY + 28 + i * 18;
            ctx.font = '9px monospace';
            ctx.textAlign = 'left';
            ctx.fillStyle = p.isHost ? '#eedd44' : '#ccddee';

            const dot = p.isTalking ? '🔊 ' : '● ';
            let pLabel = dot + p.name;
            if (pLabel.length > 15) pLabel = pLabel.substr(0, 14) + '…';
            ctx.fillText(pLabel, boxX + 8, py);

            // Diamond count and squad escape readiness
            ctx.textAlign = 'right';
            const stones = (p.id === 'local' || p.id === network.peerId)
                ? (player ? player.stonesCollected : 0)
                : (p.stonesCollected || 0);
            if (stones >= 3) {
                ctx.fillStyle = '#33ffaa';
                ctx.fillText(`💎${stones} [READY]`, boxX + boxW - 8, py);
            } else if (stones >= 2) {
                ctx.fillStyle = '#ffaa33';
                ctx.fillText(`💎${stones}/3`, boxX + boxW - 8, py);
            } else {
                ctx.fillStyle = '#778899';
                ctx.fillText(`💎${stones}/3`, boxX + boxW - 8, py);
            }
        }

        ctx.restore();
    }

    // Draw on-screen notification that Banishment Relic is ready
    drawRelicPrompt() {
        const ctx = this.ctx;
        ctx.save();
        const pulse = Math.sin(this.gameTime * 7) * 0.2 + 0.8;
        const bannerW = 320;
        const bannerH = 26;
        const bannerX = Math.round((this.width - bannerW) / 2);
        const bannerY = this.height - 104;

        ctx.fillStyle = 'rgba(5, 20, 28, 0.88)';
        this.drawRoundedRect(ctx, bannerX, bannerY, bannerW, bannerH, 6, true, false);

        ctx.strokeStyle = `rgba(0, 255, 238, ${pulse})`;
        ctx.lineWidth = 1.5;
        this.drawRoundedRect(ctx, bannerX, bannerY, bannerW, bannerH, 6, false, true);

        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#00ffee';
        ctx.shadowColor = '#00ffee';
        ctx.shadowBlur = 8 * pulse;
        ctx.fillText('✦ BANISHMENT RELIC READY - PRESS [G] TO CAST ✦', this.width / 2, bannerY + bannerH / 2);
        ctx.restore();
    }
    
    // Draw the noise bar (TOP CENTER)
    drawNoiseBar(audioManager) {
        const ctx = this.ctx;
        const barW = 300;
        const barH = 12;
        const barX = Math.round((this.width - barW) / 2);
        const barY = 24;
        
        // Background rounded rect
        ctx.fillStyle = COLORS.NOISE_BAR_BG;
        this.drawRoundedRect(ctx, barX, barY, barW, barH, 6, true, false);
        
        // Current noise level
        const noiseVal = audioManager ? (audioManager.noiseBarValue !== undefined ? audioManager.noiseBarValue : (audioManager.smoothedLevel || 0)) : 0;
        const clampedNoise = clamp(noiseVal, 0, 1);
        const fillW = Math.round(barW * clampedNoise);
        
        // Red line indicator percentage
        const redLinePct = audioManager && audioManager.redLine !== undefined ? audioManager.redLine : NOISE_THRESHOLDS.RED_LINE;
        const redLineX = barX + Math.round(barW * redLinePct);

        // Gradient fill: green (safe) -> warning -> red line danger
        if (fillW > 0) {
            ctx.save();
            this.clipRoundedRect(ctx, barX, barY, barW, barH, 6);
            
            const grad = ctx.createLinearGradient(barX, barY, barX + barW, barY);
            grad.addColorStop(0.0, COLORS.NOISE_BAR_SAFE);
            grad.addColorStop(Math.max(0.08, redLinePct * 0.5), COLORS.NOISE_BAR_WARN);
            grad.addColorStop(redLinePct, COLORS.RED_LINE_COLOR);
            grad.addColorStop(1.0, COLORS.NOISE_BAR_DANGER);
            
            ctx.fillStyle = grad;
            ctx.fillRect(barX, barY, fillW, barH);
            ctx.restore();
        }
        
        // Red line threshold indicator
        ctx.strokeStyle = COLORS.RED_LINE_COLOR;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(redLineX, barY - 4);
        ctx.lineTo(redLineX, barY + barH + 4);
        ctx.stroke();

        // Small clear danger label above the line
        ctx.font = 'bold 8px monospace';
        if (redLinePct < 0.359) {
            ctx.fillStyle = '#ffaa44';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(`▼ DANGER LINE (${(redLinePct * 100).toFixed(1)}% 💎)`, redLineX, barY - 3);
        } else {
            ctx.fillStyle = COLORS.RED_LINE_COLOR;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText('▼ DANGER LINE', redLineX, barY - 3);
        }
        
        // Bar pulses/glows when noise is above the red line
        if (clampedNoise >= redLinePct) {
            const pulse = Math.sin(this.gameTime * 14) * 0.3 + 0.7;
            ctx.save();
            ctx.strokeStyle = `rgba(255, 51, 51, ${pulse * 0.9})`;
            ctx.lineWidth = 2.5;
            ctx.shadowColor = '#ff3333';
            ctx.shadowBlur = 10 * pulse;
            this.drawRoundedRect(ctx, barX - 1, barY - 1, barW + 2, barH + 2, 7, false, true);
            ctx.restore();
        }
        
        // 🔇 Mute icon on left
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText('🔇', barX - 8, barY + barH / 2);
        
        // Microphone icon on right (glows when detecting sound)
        const micActive = audioManager && (audioManager.micActive || clampedNoise > 0.05);
        ctx.textAlign = 'left';
        if (micActive) {
            ctx.save();
            ctx.shadowColor = '#33ffaa';
            ctx.shadowBlur = 8;
            ctx.fillStyle = '#66ffbb';
            ctx.fillText('🎙️', barX + barW + 8, barY + barH / 2);
            ctx.restore();
        } else {
            ctx.fillStyle = COLORS.TEXT_DIM;
            ctx.fillText('🎙️', barX + barW + 8, barY + barH / 2);
        }
    }
    
    // Draw inventory slots (BOTTOM LEFT)
    drawInventory(player) {
        if (!player) return;
        
        const ctx = this.ctx;
        const slotCount = 5;
        const slotSize = 38;
        const slotGap = 8;
        const startX = 24;
        const startY = this.height - slotSize - 22;
        const selectedSlot = player.selectedSlot || 0;
        
        for (let i = 0; i < slotCount; i++) {
            const sx = startX + i * (slotSize + slotGap);
            const sy = startY;
            const isSelected = (i === selectedSlot);
            
            // Slot background
            ctx.fillStyle = 'rgba(10, 14, 22, 0.75)';
            this.drawRoundedRect(ctx, sx, sy, slotSize, slotSize, 4, true, false);
            
            // Slot border (brighter border on selected slot)
            if (isSelected) {
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                ctx.strokeRect(sx, sy, slotSize, slotSize);
            } else {
                ctx.strokeStyle = 'rgba(60, 75, 95, 0.55)';
                ctx.lineWidth = 1;
                ctx.strokeRect(sx, sy, slotSize, slotSize);
            }
            
            // Slot index number
            ctx.font = '10px monospace';
            ctx.fillStyle = isSelected ? '#ffffff' : COLORS.TEXT_DIM;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText((i + 1).toString(), sx + 3, sy + 3);
            
            // Draw item if slot is filled
            if (player.inventory && player.inventory[i]) {
                const item = player.inventory[i];
                const cx = sx + slotSize / 2;
                const cy = sy + slotSize / 2 + 1;
                
                ctx.save();
                ctx.translate(cx, cy);
                
                const type = item.type;
                if (type === ITEM_TYPE.BATTERY || type === 'battery') {
                    ctx.fillStyle = '#eedd33';
                    ctx.fillRect(-4, -6, 8, 12);
                    ctx.fillStyle = '#fff477';
                    ctx.fillRect(-2, -8, 4, 2);
                } else if (type === ITEM_TYPE.KEY || type === 'key') {
                    ctx.strokeStyle = item.color || '#e5a93b';
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.arc(0, -4, 3, 0, Math.PI * 2);
                    ctx.moveTo(0, -1); ctx.lineTo(0, 6);
                    ctx.moveTo(0, 3); ctx.lineTo(3, 3);
                    ctx.stroke();
                } else if (type === ITEM_TYPE.THROWABLE || type === 'throwable' || type === 'rock') {
                    ctx.fillStyle = '#885533';
                    ctx.beginPath();
                    ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
                    ctx.fill();
                } else if (type === ITEM_TYPE.BANISH_RELIC || type === 'banish_relic') {
                    // Sacred glowing Banishment Relic
                    ctx.fillStyle = '#00ffee';
                    ctx.shadowColor = '#00ffee';
                    ctx.shadowBlur = 8;
                    ctx.beginPath();
                    ctx.arc(0, 0, 5, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.shadowBlur = 0;
                    ctx.fillStyle = '#061324';
                    ctx.font = 'bold 8px monospace';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('✦', 0, 0);
                } else {
                    ctx.fillStyle = '#ccddee';
                    ctx.fillRect(-5, -6, 10, 12);
                }
                
                ctx.restore();
            }
        }
    }
    
    // Draw breath/stamina bar (BOTTOM CENTER LEFT)
    drawBreathBar(player) {
        if (!player) return;
        
        const stamina = player.breathStamina !== undefined ? player.breathStamina : 100;
        // Only visible when holding breath or stamina < 100
        if (!player.isHoldingBreath && stamina >= 100) return;
        
        const ctx = this.ctx;
        const cx = Math.round(this.width / 2 - 45);
        const cy = this.height - 35;
        const radius = 13;
        
        // Background track circle
        ctx.strokeStyle = 'rgba(20, 35, 55, 0.7)';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.stroke();
        
        // Blue drain progress arc
        const pct = clamp(stamina / BREATH_MAX_STAMINA, 0, 1);
        const startAng = -Math.PI / 2;
        const endAng = startAng + pct * Math.PI * 2;
        
        ctx.strokeStyle = (stamina < 25) ? '#ff5544' : '#44aaff';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, startAng, endAng);
        ctx.stroke();
        
        // Inner icon / text
        ctx.font = '9px sans-serif';
        ctx.fillStyle = '#88ccee';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🫁', cx, cy);
    }
    
    // Draw flashlight battery indicator (BOTTOM CENTER RIGHT)
    drawBatteryIndicator(player) {
        if (!player) return;
        
        const ctx = this.ctx;
        const batX = Math.round(this.width / 2 + 25);
        const batY = this.height - 42;
        const batW = 28;
        const batH = 14;
        
        const battery = player.flashlightBattery !== undefined ? player.flashlightBattery : 100;
        const pct = clamp(battery / FLASHLIGHT_MAX_BATTERY, 0, 1);
        const isLow = pct < 0.2;
        
        // Battery casing
        ctx.strokeStyle = isLow ? '#ff4444' : 'rgba(180, 190, 205, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(batX, batY, batW, batH);
        
        // Battery positive terminal nub
        ctx.fillStyle = isLow ? '#ff4444' : 'rgba(180, 190, 205, 0.7)';
        ctx.fillRect(batX + batW + 1, batY + 4, 2, 6);
        
        // Fill level
        const fillW = Math.max(0, Math.round((batW - 4) * pct));
        if (fillW > 0) {
            ctx.fillStyle = isLow ? '#ff3333' : (pct < 0.5 ? '#eedd33' : '#44dd66');
            ctx.fillRect(batX + 2, batY + 2, fillW, batH - 4);
        }
        
        // Small icon/percentage indicator
        ctx.font = '10px monospace';
        ctx.fillStyle = isLow ? '#ff6666' : COLORS.TEXT_DIM;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${Math.round(pct * 100)}%`, batX + batW + 8, batY + batH / 2);
    }
    
    // Draw proximity warning (intensive reddish interface + encroaching spider webs)
    drawProximityWarning(listener, player) {
        if (!listener || !player) return;
        
        const d = dist(player.x, player.y, listener.x, listener.y);
        const maxWarningDist = 420; // Expanded proximity warning horizon
        if (d >= maxWarningDist) return;
        
        const proximityFactor = clamp(1.0 - (d / maxWarningDist), 0, 1);
        const heartRate = lerp(HEARTBEAT_BASE_RATE, 3.8, proximityFactor);
        const heartbeatPulse = Math.pow(Math.sin(this.gameTime * heartRate * Math.PI * 2) * 0.5 + 0.5, 2.2);
        const vignetteAlpha = clamp((proximityFactor * 0.35) + (heartbeatPulse * proximityFactor * 0.52), 0, 0.96);
        
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;
        ctx.save();
        
        // 1. Intensive pulsating blood-red radial vignette
        const vigGrad = ctx.createRadialGradient(
            w / 2, h / 2, Math.min(w, h) * (0.38 - proximityFactor * 0.16),
            w / 2, h / 2, Math.max(w, h) * 0.74
        );
        vigGrad.addColorStop(0.0, 'rgba(160, 0, 0, 0.0)');
        vigGrad.addColorStop(0.55, `rgba(180, 0, 0, ${vignetteAlpha * 0.38})`);
        vigGrad.addColorStop(0.85, `rgba(220, 10, 10, ${vignetteAlpha * 0.82})`);
        vigGrad.addColorStop(1.0, `rgba(255, 0, 0, ${vignetteAlpha})`);
        
        ctx.fillStyle = vigGrad;
        ctx.fillRect(0, 0, w, h);

        // 2. Capillary veins along screen border at close range
        if (proximityFactor > 0.25) {
            this.drawProximityVeins(ctx, w, h, proximityFactor, heartbeatPulse);
        }

        // 3. Encroaching spider webs spreading inward from all 4 screen corners
        this.drawProximitySpiderWebs(ctx, w, h, proximityFactor, this.gameTime, heartbeatPulse);
        
        ctx.restore();
    }

    // Draw pulsating capillary blood veins along viewport edges
    drawProximityVeins(ctx, w, h, proximityFactor, pulse) {
        const veinAlpha = clamp((proximityFactor - 0.25) / 0.75, 0, 1) * (0.6 + pulse * 0.4);
        ctx.save();
        ctx.strokeStyle = `rgba(210, 20, 20, ${veinAlpha * 0.85})`;
        ctx.lineWidth = 1.6;
        ctx.lineCap = 'round';

        // Predefined organic root seeds along the 4 borders
        const veinSeeds = [
            // Top border
            { x: w * 0.25, y: 0, dx: 15, dy: 35, len: 45 },
            { x: w * 0.75, y: 0, dx: -18, dy: 40, len: 50 },
            // Bottom border
            { x: w * 0.3, y: h, dx: 20, dy: -40, len: 48 },
            { x: w * 0.7, y: h, dx: -15, dy: -38, len: 46 },
            // Left border
            { x: 0, y: h * 0.35, dx: 35, dy: 10, len: 42 },
            { x: 0, y: h * 0.65, dx: 38, dy: -12, len: 44 },
            // Right border
            { x: w, y: h * 0.35, dx: -35, dy: 12, len: 42 },
            { x: w, y: h * 0.65, dx: -38, dy: -10, len: 44 }
        ];

        for (const s of veinSeeds) {
            const currentLen = s.len * (0.5 + proximityFactor * 0.5);
            ctx.beginPath();
            ctx.moveTo(s.x, s.y);
            const midX = s.x + s.dx * 0.5 + Math.sin(s.x + this.gameTime * 3) * 6;
            const midY = s.y + s.dy * 0.5 + Math.cos(s.y + this.gameTime * 3) * 6;
            const endX = s.x + (s.dx / Math.hypot(s.dx, s.dy)) * currentLen;
            const endY = s.y + (s.dy / Math.hypot(s.dx, s.dy)) * currentLen;
            ctx.quadraticCurveTo(midX, midY, endX, endY);
            ctx.stroke();

            // Branch tendril
            ctx.lineWidth = 0.9;
            ctx.beginPath();
            ctx.moveTo(midX, midY);
            ctx.lineTo(midX + s.dy * 0.35, midY - s.dx * 0.35);
            ctx.stroke();
            ctx.lineWidth = 1.6;
        }

        ctx.restore();
    }

    // Draw creeping spider webs spreading inward from all screen corners
    drawProximitySpiderWebs(ctx, w, h, proximityFactor, t, heartbeatPulse) {
        const webAlpha = clamp(proximityFactor * 0.95 + heartbeatPulse * 0.15, 0, 1);
        if (webAlpha <= 0.02) return;

        // Reach expands deeper inward as ghost gets closer
        const maxReach = lerp(60, Math.min(w, h) * 0.54, Math.pow(proximityFactor, 0.8));
        const numSpokes = 8;
        const numRings = Math.max(4, Math.floor(lerp(4, 11, proximityFactor)));

        ctx.save();

        // 4 screen corners: [ox, oy, startAngle, endAngle]
        const corners = [
            { ox: 0, oy: 0, a1: 0, a2: Math.PI / 2 },                           // Top-Left
            { ox: w, oy: 0, a1: Math.PI / 2, a2: Math.PI },                   // Top-Right
            { ox: w, oy: h, a1: Math.PI, a2: 3 * Math.PI / 2 },               // Bottom-Right
            { ox: 0, oy: h, a1: 3 * Math.PI / 2, a2: Math.PI * 2 }            // Bottom-Left
        ];

        for (const c of corners) {
            const spokePoints = []; // [spokeIdx][ringIdx] = {x, y}

            // 1. Draw radiating structural spokes
            for (let i = 0; i < numSpokes; i++) {
                const angle = lerp(c.a1, c.a2, i / (numSpokes - 1));
                const spokeTremor = Math.sin(t * 11 + i * 1.8) * (1.2 + proximityFactor * 3.5) * heartbeatPulse;
                const spokeLen = maxReach * (0.85 + Math.sin(i * 2.3 + t * 2) * 0.15);

                const ex = c.ox + Math.cos(angle) * spokeLen + Math.sin(angle) * spokeTremor;
                const ey = c.oy + Math.sin(angle) * spokeLen - Math.cos(angle) * spokeTremor;

                // Base structural silk line
                ctx.strokeStyle = `rgba(235, 238, 245, ${webAlpha * 0.55})`;
                ctx.lineWidth = 1.3;
                ctx.beginPath();
                ctx.moveTo(c.ox, c.oy);
                ctx.lineTo(ex, ey);
                ctx.stroke();

                // Blood-red silk highlight
                ctx.strokeStyle = `rgba(255, 30, 30, ${webAlpha * (0.35 + proximityFactor * 0.5)})`;
                ctx.lineWidth = 0.8;
                ctx.beginPath();
                ctx.moveTo(c.ox, c.oy);
                ctx.lineTo(ex, ey);
                ctx.stroke();

                // Compute ring points along this spoke
                const ringPts = [];
                for (let r = 1; r <= numRings; r++) {
                    const frac = Math.pow(r / numRings, 1.15);
                    const rx = lerp(c.ox, ex, frac);
                    const ry = lerp(c.oy, ey, frac);
                    ringPts.push({ x: rx, y: ry });
                }
                spokePoints.push(ringPts);
            }

            // 2. Draw curved spiral/concentric silk rings connecting adjacent spokes
            for (let r = 0; r < numRings; r++) {
                const ringFrac = (r + 1) / numRings;
                const ringAlpha = webAlpha * (0.45 + ringFrac * 0.45);

                for (let i = 0; i < numSpokes - 1; i++) {
                    const p1 = spokePoints[i][r];
                    const p2 = spokePoints[i + 1][r];
                    if (!p1 || !p2) continue;

                    // Sag slightly inward toward the corner origin like real cobwebs
                    const midX = (p1.x + p2.x) * 0.5;
                    const midY = (p1.y + p2.y) * 0.5;
                    const bow = 0.88; // inward sag factor
                    const ctrlX = lerp(midX, c.ox, 1.0 - bow);
                    const ctrlY = lerp(midY, c.oy, 1.0 - bow);

                    // Outer web silk strand
                    ctx.strokeStyle = `rgba(230, 235, 245, ${ringAlpha * 0.65})`;
                    ctx.lineWidth = 1.1;
                    ctx.beginPath();
                    ctx.moveTo(p1.x, p1.y);
                    ctx.quadraticCurveTo(ctrlX, ctrlY, p2.x, p2.y);
                    ctx.stroke();

                    // Bloody glistening hue
                    ctx.strokeStyle = `rgba(255, 40, 40, ${ringAlpha * (0.3 + proximityFactor * 0.55)})`;
                    ctx.lineWidth = 0.7;
                    ctx.beginPath();
                    ctx.moveTo(p1.x, p1.y);
                    ctx.quadraticCurveTo(ctrlX, ctrlY, p2.x, p2.y);
                    ctx.stroke();

                    // Dew drop / egg nodule at spoke intersection
                    if (r % 2 === 0 && Math.random() < 0.25) {
                        ctx.fillStyle = `rgba(255, 60, 60, ${ringAlpha * 0.8})`;
                        ctx.beginPath();
                        ctx.arc(p1.x, p1.y, 1.4, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
            }
        }

        // 3. Screen edge canopy strings when Listener is extremely close (> 0.65 proximity)
        if (proximityFactor > 0.65) {
            const edgeAlpha = (proximityFactor - 0.65) / 0.35 * webAlpha;
            ctx.strokeStyle = `rgba(240, 240, 250, ${edgeAlpha * 0.55})`;
            ctx.lineWidth = 1.0;

            // Top edge hanging cobweb drape
            ctx.beginPath();
            ctx.moveTo(0, 15);
            ctx.quadraticCurveTo(w * 0.25, 45 + Math.sin(t * 8) * 4, w * 0.5, 20);
            ctx.quadraticCurveTo(w * 0.75, 48 + Math.cos(t * 8) * 4, w, 15);
            ctx.stroke();

            // Bottom edge hanging cobweb drape
            ctx.beginPath();
            ctx.moveTo(0, h - 15);
            ctx.quadraticCurveTo(w * 0.25, h - 45 - Math.sin(t * 8) * 4, w * 0.5, h - 20);
            ctx.quadraticCurveTo(w * 0.75, h - 48 - Math.cos(t * 8) * 4, w, h - 15);
            ctx.stroke();
        }

        ctx.restore();
    }
    
    // Draw the radar minimap (TOP LEFT CORNER)
    // Draw the radar minimap (TOP LEFT CORNER) - High Precision Tactical Proximity Radar
    drawMinimap(map, player, listener) {
        if (!map || !map.tiles) return;

        const ctx = this.ctx;
        const isMobile = this.width < 760 || this.height < 520;
        const miniW = isMobile ? 140 : 180;
        const miniH = isMobile ? 112 : 140;
        const miniX = isMobile ? 12 : 20;
        const miniY = isMobile ? 12 : 20;

        ctx.save();

        // 1. Sleek Radar Frame
        ctx.fillStyle = 'rgba(7, 10, 18, 0.90)';
        this.drawRoundedRect(ctx, miniX, miniY, miniW, miniH + 26, 6, true, false);

        ctx.strokeStyle = 'rgba(65, 115, 180, 0.65)';
        ctx.lineWidth = 1.2;
        this.drawRoundedRect(ctx, miniX, miniY, miniW, miniH + 26, 6, false, true);

        // Header bar
        ctx.fillStyle = 'rgba(20, 38, 64, 0.8)';
        ctx.fillRect(miniX, miniY, miniW, 20);

        ctx.font = isMobile ? 'bold 8px monospace' : 'bold 9px monospace';
        ctx.fillStyle = '#65c2ff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('◈ PROXIMITY RADAR [M]', miniX + 6, miniY + 10);

        // Current sector / room indicator on right
        let curRoom = map.getRoom ? map.getRoom(player.x, player.y) : null;
        let roomName = curRoom ? curRoom.name.split(' ')[0] : 'TRANSIT';
        const ptx = Math.floor(player.x / TILE_SIZE);
        const pty = Math.floor(player.y / TILE_SIZE);

        // 2. Map Canvas Viewport (clipped to radar body)
        const mapAreaX = miniX + 4;
        const mapAreaY = miniY + 22;
        const mapAreaW = miniW - 8;
        const mapAreaH = miniH - 2;

        ctx.save();
        ctx.beginPath();
        ctx.rect(mapAreaX, mapAreaY, mapAreaW, mapAreaH);
        ctx.clip();

        // Background of map area
        ctx.fillStyle = '#060a12';
        ctx.fillRect(mapAreaX, mapAreaY, mapAreaW, mapAreaH);

        // Centered Proximity View: 34 tiles wide by 26 tiles high
        const viewTilesX = 34;
        const viewTilesY = 26;
        const scaleX = mapAreaW / viewTilesX;
        const scaleY = mapAreaH / viewTilesY;

        const startTileX = Math.floor(ptx - viewTilesX / 2);
        const startTileY = Math.floor(pty - viewTilesY / 2);

        // Render floor sectors in local viewport
        for (let dy = 0; dy < viewTilesY; dy++) {
            const ty = startTileY + dy;
            if (ty < 0 || ty >= map.height) continue;
            const row = map.tiles[ty];
            if (!row) continue;

            for (let dx = 0; dx < viewTilesX; dx++) {
                const tx = startTileX + dx;
                if (tx < 0 || tx >= map.width) continue;
                const tile = row[tx];
                if (tile === TILE.WALL) {
                    ctx.fillStyle = '#141c2e';
                } else if (tile === TILE.WATER) {
                    ctx.fillStyle = 'rgba(25, 110, 195, 0.9)';
                } else if (tile === TILE.LOUD_FLOOR) {
                    ctx.fillStyle = 'rgba(180, 105, 40, 0.9)';
                } else if (tile === TILE.TUNNEL) {
                    ctx.fillStyle = 'rgba(110, 65, 155, 0.9)';
                } else if (tile === TILE.DOOR) {
                    ctx.fillStyle = 'rgba(225, 160, 70, 0.95)';
                } else {
                    ctx.fillStyle = 'rgba(42, 60, 90, 0.85)';
                }

                const bx = mapAreaX + dx * scaleX;
                const by = mapAreaY + dy * scaleY;
                ctx.fillRect(bx, by, Math.ceil(scaleX), Math.ceil(scaleY));
            }
        }

        // Hiding spots on radar
        if (map.hidingSpots) {
            ctx.fillStyle = '#39e66c';
            for (const spot of map.hidingSpots) {
                const stx = spot.x / TILE_SIZE;
                const sty = spot.y / TILE_SIZE;
                if (stx >= startTileX && stx < startTileX + viewTilesX &&
                    sty >= startTileY && sty < startTileY + viewTilesY) {
                    const hx = mapAreaX + (stx - startTileX) * scaleX;
                    const hy = mapAreaY + (sty - startTileY) * scaleY;
                    ctx.fillRect(hx - 2, hy - 2, 4, 4);
                }
            }
        }

        // Exit on radar
        if (map.exitPos) {
            const etx = map.exitPos.x / TILE_SIZE;
            const ety = map.exitPos.y / TILE_SIZE;
            if (etx >= startTileX && etx < startTileX + viewTilesX &&
                ety >= startTileY && ety < startTileY + viewTilesY) {
                const ex = mapAreaX + (etx - startTileX) * scaleX;
                const ey = mapAreaY + (ety - startTileY) * scaleY;
                ctx.fillStyle = '#33ffaa';
                ctx.fillRect(ex - 3, ey - 3, 6, 6);
            }
        }

        // Banishment Relic on radar
        if (map.relic && !map.relic.collected) {
            const rtx = map.relic.x / TILE_SIZE;
            const rty = map.relic.y / TILE_SIZE;
            if (rtx >= startTileX && rtx < startTileX + viewTilesX &&
                rty >= startTileY && rty < startTileY + viewTilesY) {
                const rx = mapAreaX + (rtx - startTileX) * scaleX;
                const ry = mapAreaY + (rty - startTileY) * scaleY;
                const rPulse = Math.sin(this.gameTime * 6) * 0.3 + 0.7;
                ctx.fillStyle = `rgba(0, 255, 238, ${rPulse})`;
                ctx.beginPath();
                ctx.arc(rx, ry, 3.5, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Memory Stones on radar
        if (map.stones) {
            const pulse = Math.sin(this.gameTime * 4) * 0.3 + 0.7;
            for (const stone of map.stones) {
                if (stone.collected) continue;
                const stx = stone.x / TILE_SIZE;
                const sty = stone.y / TILE_SIZE;
                if (stx >= startTileX && stx < startTileX + viewTilesX &&
                    sty >= startTileY && sty < startTileY + viewTilesY) {
                    const sx = mapAreaX + (stx - startTileX) * scaleX;
                    const sy = mapAreaY + (sty - startTileY) * scaleY;
                    ctx.fillStyle = `rgba(255, 180, 50, ${pulse})`;
                    ctx.beginPath();
                    ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }

        // Remote multiplayer friends on radar
        if (this.network && this.network.remotePlayers) {
            const peerCols = COLORS.PEER_PLAYERS || ['#33ddaa', '#ffaa44', '#dd66ff'];
            for (const rp of Object.values(this.network.remotePlayers)) {
                if (!rp.x && !rp.y) continue;
                const rptx = rp.x / TILE_SIZE;
                const rpty = rp.y / TILE_SIZE;
                if (rptx >= startTileX && rptx < startTileX + viewTilesX &&
                    rpty >= startTileY && rpty < startTileY + viewTilesY) {
                    const rpx = mapAreaX + (rptx - startTileX) * scaleX;
                    const rpy = mapAreaY + (rpty - startTileY) * scaleY;
                    ctx.fillStyle = peerCols[(rp.colorIndex || 1) % peerCols.length];
                    ctx.beginPath();
                    ctx.arc(rpx, rpy, 3, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }

        // Player marker (always dead center of local proximity radar)
        const px = mapAreaX + mapAreaW / 2;
        const py = mapAreaY + mapAreaH / 2;

        // Flashlight field on radar
        if (player.flashlightOn) {
            ctx.fillStyle = 'rgba(255, 245, 180, 0.35)';
            ctx.beginPath();
            ctx.moveTo(px, py);
            const pAngle = player.flashlightAngle !== undefined ? player.flashlightAngle : player.angle;
            ctx.arc(px, py, 20, pAngle - 0.5, pAngle + 0.5);
            ctx.closePath();
            ctx.fill();
        }

        // Player icon
        ctx.fillStyle = '#00ffee';
        ctx.shadowColor = '#00ffee';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(px, py, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Listeners disturbance ping if within 450px
        const miniGhostList = Array.isArray(listener) ? listener : (listener ? [listener] : []);
        for (const l of miniGhostList) {
            if (l && !l.isDead && dist(player.x, player.y, l.x, l.y) < 450) {
                const ltx = l.x / TILE_SIZE;
                const lty = l.y / TILE_SIZE;
                const lx = mapAreaX + (ltx - startTileX) * scaleX;
                const ly = mapAreaY + (lty - startTileY) * scaleY;
                const pingRadius = ((this.gameTime * 8) % 12) + 2;
                ctx.strokeStyle = 'rgba(255, 40, 40, 0.8)';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(lx, ly, pingRadius, 0, Math.PI * 2);
                ctx.stroke();
            }
        }

        // Mini Facility Megastructure Overview Thumbnail (top-right of radar)
        const thumbW = 28;
        const thumbH = 22;
        const thumbX = mapAreaX + mapAreaW - thumbW - 2;
        const thumbY = mapAreaY + 2;
        ctx.fillStyle = 'rgba(4, 7, 14, 0.85)';
        ctx.fillRect(thumbX, thumbY, thumbW, thumbH);
        ctx.strokeStyle = 'rgba(80, 130, 200, 0.5)';
        ctx.lineWidth = 0.8;
        ctx.strokeRect(thumbX, thumbY, thumbW, thumbH);

        // Overview player pip
        const ovPipX = thumbX + (ptx / map.width) * thumbW;
        const ovPipY = thumbY + (pty / map.height) * thumbH;
        ctx.fillStyle = '#00ffee';
        ctx.fillRect(ovPipX - 1, ovPipY - 1, 2, 2);

        ctx.restore(); // restore clipping

        // Footer Bar: Sector name and coordinates
        ctx.fillStyle = 'rgba(10, 18, 30, 0.9)';
        ctx.fillRect(miniX, miniY + miniH, miniW, 26);
        ctx.font = isMobile ? 'bold 7.5px monospace' : 'bold 8.5px monospace';
        ctx.fillStyle = '#8ec3ff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`SEC: ${roomName.toUpperCase()} [${ptx}, ${pty}] | 5X`, miniX + miniW / 2, miniY + miniH + 13);

        // Corner accents on radar
        ctx.strokeStyle = 'rgba(100, 160, 240, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(miniX, miniY + 6); ctx.lineTo(miniX, miniY); ctx.lineTo(miniX + 6, miniY); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(miniX + miniW - 6, miniY); ctx.lineTo(miniX + miniW, miniY); ctx.lineTo(miniX + miniW, miniY + 6); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(miniX, miniY + miniH + 26 - 6); ctx.lineTo(miniX, miniY + miniH + 26); ctx.lineTo(miniX + 6, miniY + miniH + 26); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(miniX + miniW - 6, miniY + miniH + 26); ctx.lineTo(miniX + miniW, miniY + miniH + 26); ctx.lineTo(miniX + miniW, miniY + miniH + 26 - 6); ctx.stroke();

        ctx.restore();
    }

    // Full tactical blueprint map overlay (toggled with M key)
    drawFullMap(map, player, listener) {
        if (!map || !map.tiles) return;

        const ctx = this.ctx;
        ctx.save();

        // 1. Full dark blueprint overlay
        ctx.fillStyle = 'rgba(5, 8, 15, 0.95)';
        ctx.fillRect(0, 0, this.width, this.height);

        // Blueprint architectural grid lines
        ctx.strokeStyle = 'rgba(30, 50, 80, 0.25)';
        ctx.lineWidth = 1;
        const gridSize = 32;
        for (let x = 0; x < this.width; x += gridSize) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.height); ctx.stroke();
        }
        for (let y = 0; y < this.height; y += gridSize) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.width, y); ctx.stroke();
        }

        // Header Title
        ctx.font = 'bold 20px Courier New, monospace';
        ctx.fillStyle = '#65b2f0';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('FACILITY MEGASTRUCTURE SCHEMATIC (5X EXPANDED • 170x140 TILES)', this.width / 2, 18);

        ctx.font = '11px monospace';
        ctx.fillStyle = '#8ca3c7';
        ctx.fillText('3 PATROLLING LISTENERS • SQUAD GROUP ESCAPE MANDATORY • PRESS [M] TO CLOSE', this.width / 2, 44);

        // Center map box
        const maxMapW = this.width * 0.82;
        const maxMapH = this.height * 0.72;
        const scale = Math.min(maxMapW / map.width, maxMapH / map.height);

        const drawW = map.width * scale;
        const drawH = map.height * scale;
        const ox = (this.width - drawW) / 2;
        const oy = 66 + (maxMapH - drawH) / 2;

        // Blueprint frame
        ctx.strokeStyle = 'rgba(80, 130, 190, 0.6)';
        ctx.lineWidth = 2;
        ctx.strokeRect(ox - 6, oy - 6, drawW + 12, drawH + 12);

        ctx.fillStyle = '#090e1a';
        ctx.fillRect(ox - 6, oy - 6, drawW + 12, drawH + 12);

        // Render tiles
        for (let ty = 0; ty < map.height; ty++) {
            const row = map.tiles[ty];
            if (!row) continue;
            for (let tx = 0; tx < map.width; tx++) {
                const tile = row[tx];
                const bx = ox + tx * scale;
                const by = oy + ty * scale;
                const bw = Math.max(1, Math.ceil(scale));
                const bh = Math.max(1, Math.ceil(scale));

                if (tile === TILE.WALL) {
                    ctx.fillStyle = '#1c253b';
                } else if (tile === TILE.WATER) {
                    ctx.fillStyle = '#1b5a94';
                } else if (tile === TILE.LOUD_FLOOR) {
                    ctx.fillStyle = '#8a5223';
                } else if (tile === TILE.TUNNEL) {
                    ctx.fillStyle = '#593a7a';
                } else if (tile === TILE.DOOR) {
                    ctx.fillStyle = '#b88139';
                } else {
                    ctx.fillStyle = '#314463';
                }
                ctx.fillRect(bx, by, bw, bh);
            }
        }

        // Room Labels on blueprint
        if (map.rooms) {
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            for (const r of map.rooms) {
                const rcx = ox + (r.x + r.w / 2) * scale;
                const rcy = oy + (r.y + r.h / 2) * scale;

                ctx.fillStyle = 'rgba(7, 12, 22, 0.8)';
                const label = r.name.toUpperCase();
                const tw = ctx.measureText(label).width;
                ctx.fillRect(rcx - tw / 2 - 4, rcy - 7, tw + 8, 14);

                ctx.strokeStyle = 'rgba(85, 140, 210, 0.45)';
                ctx.lineWidth = 1;
                ctx.strokeRect(rcx - tw / 2 - 4, rcy - 7, tw + 8, 14);

                ctx.fillStyle = '#c5dbf5';
                ctx.fillText(label, rcx, rcy);
            }
        }

        // All 3 Patrol Routes (Red Dashed Lines across wings)
        const routes = map.listenerPatrolRoutes || (map.patrolPoints ? [map.patrolPoints] : []);
        routes.forEach((route, rIdx) => {
            if (route && route.length > 1) {
                ctx.save();
                ctx.strokeStyle = rIdx === 0 ? 'rgba(255, 60, 60, 0.8)' : (rIdx === 1 ? 'rgba(255, 140, 40, 0.8)' : 'rgba(220, 40, 100, 0.8)');
                ctx.lineWidth = 1.8;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                for (let i = 0; i < route.length; i++) {
                    const pt = route[i];
                    const px = ox + (pt.x / TILE_SIZE) * scale;
                    const py = oy + (pt.y / TILE_SIZE) * scale;
                    if (i === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                ctx.closePath();
                ctx.stroke();
                ctx.restore();
            }
        });

        // 3 Ghost Markers on blueprint
        const allGhosts = Array.isArray(listener) ? listener : (listener ? [listener] : []);
        allGhosts.forEach((g, gIdx) => {
            if (g) {
                const gx = ox + (g.x / TILE_SIZE) * scale;
                const gy = oy + (g.y / TILE_SIZE) * scale;
                ctx.fillStyle = g.isDead ? '#666666' : '#ff2222';
                ctx.shadowColor = g.isDead ? '#000000' : '#ff2222';
                ctx.shadowBlur = 8;
                ctx.beginPath();
                ctx.arc(gx, gy, 5, 0, Math.PI * 2);
                ctx.fill();
                ctx.shadowBlur = 0;

                ctx.font = 'bold 8.5px monospace';
                ctx.fillStyle = g.isDead ? '#888888' : '#ff4444';
                ctx.fillText(g.isDead ? '☠ GHOST ' + (gIdx + 1) : `⚠ GHOST ${gIdx + 1}`, gx, gy - 9);
            }
        });

        // Hiding spots
        if (map.hidingSpots) {
            ctx.fillStyle = '#39e66c';
            for (const s of map.hidingSpots) {
                const hx = ox + (s.x / TILE_SIZE) * scale;
                const hy = oy + (s.y / TILE_SIZE) * scale;
                ctx.fillRect(hx - 2, hy - 2, 4, 4);
            }
        }

        // Memory stones
        if (map.stones) {
            const stonePulse = Math.sin(this.gameTime * 5) * 0.3 + 0.7;
            for (let i = 0; i < map.stones.length; i++) {
                const st = map.stones[i];
                const sx = ox + (st.x / TILE_SIZE) * scale;
                const sy = oy + (st.y / TILE_SIZE) * scale;

                if (!st.collected) {
                    ctx.fillStyle = `rgba(255, 180, 50, ${stonePulse})`;
                    ctx.shadowColor = '#ffaa33';
                    ctx.shadowBlur = 8;
                    ctx.beginPath();
                    ctx.arc(sx, sy, 5, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.shadowBlur = 0;

                    ctx.fillStyle = '#ffffff';
                    ctx.font = 'bold 8.5px monospace';
                    ctx.fillText(`STONE ${st.id || (i + 1)}`, sx, sy - 9);
                } else {
                    ctx.strokeStyle = 'rgba(120, 120, 120, 0.6)';
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.arc(sx, sy, 4, 0, Math.PI * 2);
                    ctx.stroke();
                }
            }
        }

        // Exit marker
        if (map.exitPos) {
            const ex = ox + (map.exitPos.x / TILE_SIZE) * scale;
            const ey = oy + (map.exitPos.y / TILE_SIZE) * scale;

            ctx.fillStyle = '#33ffaa';
            ctx.shadowColor = '#33ffaa';
            ctx.shadowBlur = 8;
            ctx.fillRect(ex - 4, ey - 4, 8, 8);
            ctx.shadowBlur = 0;

            ctx.font = 'bold 9px monospace';
            ctx.fillStyle = '#33ffaa';
            ctx.fillText('EXIT BLAST DOORS', ex, ey - 11);
        }

        // Banishment Relic on blueprint
        if (map.relic && !map.relic.collected) {
            const rx = ox + (map.relic.x / TILE_SIZE) * scale;
            const ry = oy + (map.relic.y / TILE_SIZE) * scale;
            ctx.fillStyle = '#00ffee';
            ctx.shadowColor = '#00ffee';
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.arc(rx, ry, 5.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;

            ctx.font = 'bold 8.5px monospace';
            ctx.fillStyle = '#00ffee';
            ctx.fillText('✦ BANISH RELIC', rx, ry - 10);
        }

        // Remote multiplayer friends on blueprint
        if (this.network && this.network.remotePlayers) {
            const peerCols = COLORS.PEER_PLAYERS || ['#33ddaa', '#ffaa44', '#dd66ff'];
            for (const rp of Object.values(this.network.remotePlayers)) {
                if (!rp.x && !rp.y) continue;
                const rpx = ox + (rp.x / TILE_SIZE) * scale;
                const rpy = oy + (rp.y / TILE_SIZE) * scale;
                const pCol = peerCols[(rp.colorIndex || 1) % peerCols.length];

                ctx.fillStyle = pCol;
                ctx.beginPath();
                ctx.arc(rpx, rpy, 5, 0, Math.PI * 2);
                ctx.fill();

                ctx.font = 'bold 8.5px monospace';
                ctx.fillStyle = pCol;
                ctx.fillText(rp.name || 'Friend', rpx, rpy + 11);
            }
        }

        // Player pin
        const ppx = ox + (player.x / TILE_SIZE) * scale;
        const ppy = oy + (player.y / TILE_SIZE) * scale;

        ctx.fillStyle = '#00e1ff';
        ctx.shadowColor = '#00e1ff';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(ppx, ppy, 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        if (player.flashlightOn) {
            ctx.fillStyle = 'rgba(255, 240, 170, 0.35)';
            ctx.beginPath();
            ctx.moveTo(ppx, ppy);
            const pAngle = player.flashlightAngle !== undefined ? player.flashlightAngle : player.angle;
            ctx.arc(ppx, ppy, 22, pAngle - 0.55, pAngle + 0.55);
            ctx.closePath();
            ctx.fill();
        }

        ctx.font = 'bold 9.5px monospace';
        ctx.fillStyle = '#00e1ff';
        ctx.fillText('YOU ARE HERE', ppx, ppy + 13);

        // Legend box on bottom
        const legY = this.height - 24;
        ctx.font = '9.5px monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#8ca3c7';
        ctx.fillText(
            'LEGEND:  ● YOU (Cyan)  |  ⚠ 3 GHOSTS (Red)  |  ◆ 3 STONES (Gold)  |  ✦ BANISH RELIC (Aqua)  |  ■ LOCKERS (Green)  |  ⚑ EXIT DOORS',
            this.width / 2, legY
        );

        ctx.restore();
    }

    // Draw stone counter (TOP LEFT - positioned cleanly below minimap)
    drawStoneCounter(player) {
        const ctx = this.ctx;
        const collected = player ? (player.stonesCollected || 0) : 0;
        
        ctx.save();
        const boxX = 20;
        const boxY = 184; // Just below the minimap (height 158)
        const boxW = 160;
        const boxH = 26;

        ctx.fillStyle = 'rgba(7, 10, 18, 0.85)';
        this.drawRoundedRect(ctx, boxX, boxY, boxW, boxH, 4, true, false);

        ctx.strokeStyle = 'rgba(65, 105, 160, 0.45)';
        ctx.lineWidth = 1;
        this.drawRoundedRect(ctx, boxX, boxY, boxW, boxH, 4, false, true);

        // Glowing amber stone icon
        ctx.font = '14px monospace';
        ctx.shadowColor = COLORS.STONE_GLOW;
        ctx.shadowBlur = 6;
        ctx.fillStyle = COLORS.STONE_GLOW;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('◆', boxX + 8, boxY + boxH / 2);

        // Counter text
        ctx.shadowBlur = 0;
        ctx.fillStyle = COLORS.TEXT;
        ctx.font = '11px monospace';
        ctx.fillText(`STONES: ${collected}/${TOTAL_STONES}`, boxX + 24, boxY + boxH / 2);

        // Key toggle tip on right
        ctx.fillStyle = '#65b2f0';
        ctx.font = '9px monospace';
        ctx.textAlign = 'right';
        ctx.fillText('[M] MAP', boxX + boxW - 8, boxY + boxH / 2);

        ctx.restore();
    }
    
    // Set hint text helper
    setHint(text) {
        this.hintText = text;
        this.hintAlpha = 1.0;
    }
    
    // Draw hint text (e.g., 'Press E to interact')
    showHint(text) {
        this.hintText = text;
        this.hintAlpha = 1.0;
    }

    drawHintText(text, alpha) {
        if (!text) return;
        
        const ctx = this.ctx;
        ctx.save();
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        const textW = ctx.measureText(text).width;
        const padX = 16;
        const padY = 8;
        const pillW = textW + padX * 2;
        const pillH = 28;
        const pillX = Math.round((this.width - pillW) / 2);
        const pillY = this.height - 78;
        
        const effectiveAlpha = (alpha !== undefined) ? alpha : (this.hintAlpha !== undefined ? this.hintAlpha : 1.0);
        ctx.globalAlpha = clamp(effectiveAlpha, 0, 1);
        if (ctx.globalAlpha <= 0.01) {
            ctx.restore();
            return;
        }
        
        // Semi-transparent pill backing
        ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        this.drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 6, true, false);
        
        ctx.strokeStyle = 'rgba(100, 120, 140, 0.4)';
        ctx.lineWidth = 1;
        ctx.strokeRect(pillX, pillY, pillW, pillH);
        
        // Hint label text
        ctx.fillStyle = '#eeeeff';
        ctx.fillText(text, this.width / 2, pillY + pillH / 2);
        
        ctx.restore();
    }
    
    // Show room name banner helper
    showRoomName(name) {
        if (this.currentRoomName !== name) {
            this.currentRoomName = name;
            this.roomNameTimer = 0;
        }
    }
    
    // Draw room name when entering a new room
    drawRoomName(roomName, alpha) {
        if (!roomName || alpha <= 0.01) return;
        
        const ctx = this.ctx;
        ctx.save();
        ctx.globalAlpha = clamp(alpha, 0, 1);
        
        ctx.font = '28px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        const cy = Math.round(this.height * 0.32);
        
        // Soft dark shadow behind room name
        ctx.shadowColor = '#000000';
        ctx.shadowBlur = 12;
        ctx.fillStyle = '#f0f0f5';
        ctx.fillText(roomName.toUpperCase(), this.width / 2, cy);
        
        ctx.restore();
    }
    
    // ============================================================
    // THEME: MAIN MENU HORROR SCENE (The Ruins, Dead Girl & Running Soul)
    // ============================================================

    // Draw main menu screen with living horror environment
    drawMenu() {
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;
        const t = this.gameTime || 0;

        ctx.save();

        // 1. Collapsed Station Architecture & Tracks
        this.drawMenuStationEnvironment(ctx, w, h, t);

        // 2. Hanging and Corner Spider Webs
        this.drawMenuSpiderWebs(ctx, w, h, t);

        // 3. The Running Soul of the Stranger (Eternal Sprint)
        this.drawMenuRunningSoul(ctx, w, h, t);

        // 4. The Dead Girl's Body & Glowing Memory Stone
        this.drawMenuDeadGirl(ctx, w, h, t);

        // 5. The Listener Lurking in the Overhead Shadows
        this.drawMenuListenerLurking(ctx, w, h, t);

        // 6. Volumetric Ground Mist, Water Ripples, and Drifting Embers
        this.drawMenuAtmosphere(ctx, w, h, t);

        // 7. Cinematic Dark Horror Vignette
        this.drawMenuVignette(ctx, w, h);

        ctx.restore();
    }

    // 1. Abandoned Subway Ruins & Collapsed Architecture
    drawMenuStationEnvironment(ctx, w, h, t) {
        // Deep subterranean background gradient
        const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
        bgGrad.addColorStop(0.0, '#020306');
        bgGrad.addColorStop(0.4, '#05070d');
        bgGrad.addColorStop(0.72, '#090d16');
        bgGrad.addColorStop(1.0, '#030407');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, w, h);

        // Receding subway tunnel arches in the dark
        const platformY = h * 0.72;

        // Tunnel arch 1 (Far Left - from where the soul sprints out)
        const a1x = w * 0.12;
        ctx.fillStyle = '#020204';
        ctx.beginPath();
        ctx.ellipse(a1x, platformY, w * 0.09, h * 0.42, 0, Math.PI, 0);
        ctx.lineTo(a1x + w * 0.09, platformY);
        ctx.lineTo(a1x - w * 0.09, platformY);
        ctx.closePath();
        ctx.fill();

        // Arch masonry border
        ctx.strokeStyle = '#121722';
        ctx.lineWidth = 14;
        ctx.stroke();

        // Broken brickwork and wall cracks inside arch
        ctx.strokeStyle = 'rgba(40, 55, 80, 0.4)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(a1x - 30, platformY - 80);
        ctx.lineTo(a1x - 10, platformY - 100);
        ctx.lineTo(a1x + 15, platformY - 95);
        ctx.lineTo(a1x + 35, platformY - 130);
        ctx.stroke();

        // Center backdrop arches (decaying pillars)
        const pillarWidth = Math.max(16, w * 0.025);
        const pillars = [w * 0.32, w * 0.50, w * 0.68];
        for (const px of pillars) {
            ctx.fillStyle = '#080c14';
            ctx.fillRect(px - pillarWidth / 2, h * 0.18, pillarWidth, platformY - h * 0.18);
            
            ctx.strokeStyle = '#101726';
            ctx.lineWidth = 2;
            ctx.strokeRect(px - pillarWidth / 2, h * 0.18, pillarWidth, platformY - h * 0.18);

            // Wall stain drips
            ctx.fillStyle = 'rgba(3, 5, 8, 0.7)';
            ctx.fillRect(px - pillarWidth / 2 + 2, h * 0.25, 4, platformY * 0.4);
        }

        // Platform Floor line
        ctx.fillStyle = '#0b0f19';
        ctx.fillRect(0, platformY, w, h - platformY);

        // Distressed subway tiles grid on platform
        ctx.strokeStyle = 'rgba(25, 35, 55, 0.4)';
        ctx.lineWidth = 1;
        const tileSize = 36;
        for (let x = 0; x < w; x += tileSize) {
            ctx.beginPath();
            ctx.moveTo(x, platformY);
            ctx.lineTo(x - (w / 2 - x) * 0.3, h);
            ctx.stroke();
        }
        for (let y = platformY + 14; y < h; y += 22) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }

        // Railway tracks on the left side
        const trackY1 = platformY + (h - platformY) * 0.3;
        const trackY2 = platformY + (h - platformY) * 0.75;
        
        // Wooden sleepers (cross-ties)
        ctx.fillStyle = '#111620';
        for (let rx = 0; rx < w * 0.55; rx += 28) {
            ctx.fillRect(rx - 8, trackY1 - 6, 16, trackY2 - trackY1 + 12);
        }

        // Steel Rails
        ctx.strokeStyle = '#2b3648';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(0, trackY1);
        ctx.lineTo(w * 0.55, trackY1);
        ctx.moveTo(0, trackY2);
        ctx.lineTo(w * 0.55, trackY2);
        ctx.stroke();

        // Rail top reflections
        ctx.strokeStyle = 'rgba(120, 160, 210, 0.35)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, trackY1 - 1);
        ctx.lineTo(w * 0.55, trackY1 - 1);
        ctx.moveTo(0, trackY2 - 1);
        ctx.lineTo(w * 0.55, trackY2 - 1);
        ctx.stroke();

        // Floor water puddles reflecting light
        const puddleX1 = w * 0.28;
        const puddleY1 = platformY + 24;
        ctx.fillStyle = 'rgba(10, 20, 36, 0.65)';
        ctx.beginPath();
        ctx.ellipse(puddleX1, puddleY1, 65, 14, -0.05, 0, Math.PI * 2);
        ctx.fill();

        // Overhead dangling wires that sway gently
        const sway1 = Math.sin(t * 1.3) * 6;
        const sway2 = Math.cos(t * 1.6) * 8;
        ctx.strokeStyle = '#0e141f';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, h * 0.08);
        ctx.bezierCurveTo(w * 0.2, h * 0.22 + sway1, w * 0.4, h * 0.25 + sway2, w * 0.6, h * 0.12);
        ctx.stroke();

        // Occasional electrical spark at dangling junction
        if (Math.sin(t * 8.4) > 0.94) {
            const sparkX = w * 0.38;
            const sparkY = h * 0.24 + sway2;
            ctx.fillStyle = '#aaddff';
            ctx.shadowColor = '#00e5ff';
            ctx.shadowBlur = 12;
            ctx.beginPath();
            ctx.arc(sparkX, sparkY, 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
        }

        // Flickering emergency subway beacon on ceiling
        const lampX = w * 0.24;
        const lampY = h * 0.14;
        const flicker = (Math.sin(t * 5.3) > 0.88 || Math.sin(t * 17.1) > 0.93) ? 0.2 : (Math.sin(t * 1.8) * 0.15 + 0.85);

        const lampGlow = ctx.createRadialGradient(lampX, lampY, 2, lampX, lampY + 40, 160);
        lampGlow.addColorStop(0, `rgba(255, 45, 45, ${0.45 * flicker})`);
        lampGlow.addColorStop(0.3, `rgba(180, 25, 25, ${0.18 * flicker})`);
        lampGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = lampGlow;
        ctx.beginPath();
        ctx.arc(lampX, lampY + 40, 160, 0, Math.PI * 2);
        ctx.fill();

        // Lamp fixture
        ctx.fillStyle = '#ff2222';
        ctx.shadowColor = '#ff2222';
        ctx.shadowBlur = 14 * flicker;
        ctx.beginPath();
        ctx.arc(lampX, lampY, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
    }

    // 2. Realistic Procedural Spider Webs (Corners, Girders & Rafters)
    drawMenuSpiderWebs(ctx, w, h, t) {
        ctx.save();
        
        // --- Helper: Draw radial web structure ---
        const drawWeb = (ox, oy, radius, startAngle, endAngle, spokeCount, ringCount, swayOffset = 0) => {
            const angleStep = (endAngle - startAngle) / (spokeCount - 1);
            const spokeTips = [];

            // Draw radial spokes
            ctx.strokeStyle = 'rgba(210, 225, 245, 0.35)';
            ctx.lineWidth = 1.1;

            for (let i = 0; i < spokeCount; i++) {
                const angle = startAngle + i * angleStep;
                const r = radius * (0.85 + Math.sin(i * 1.5) * 0.15);
                const ex = ox + Math.cos(angle) * r;
                const ey = oy + Math.sin(angle) * r;
                spokeTips.push({ x: ex, y: ey, angle, r });

                ctx.beginPath();
                ctx.moveTo(ox, oy);
                ctx.lineTo(ex, ey);
                ctx.stroke();
            }

            // Draw concentric spiral sagging arcs
            ctx.strokeStyle = 'rgba(195, 215, 240, 0.28)';
            ctx.lineWidth = 0.9;

            for (let rIdx = 1; rIdx <= ringCount; rIdx++) {
                const ringFraction = rIdx / ringCount;
                ctx.beginPath();

                for (let i = 0; i < spokeCount - 1; i++) {
                    const s1 = spokeTips[i];
                    const s2 = spokeTips[i + 1];

                    const p1x = ox + Math.cos(s1.angle) * s1.r * ringFraction;
                    const p1y = oy + Math.sin(s1.angle) * s1.r * ringFraction;
                    const p2x = ox + Math.cos(s2.angle) * s2.r * ringFraction;
                    const p2y = oy + Math.sin(s2.angle) * s2.r * ringFraction;

                    // Sagging midpoint
                    const midX = (p1x + p2x) / 2;
                    const midY = (p1y + p2y) / 2;
                    const sag = 6 * ringFraction + Math.sin(t * 1.5 + swayOffset) * 1.5;
                    const ctrlX = midX - (midX - ox) * (sag / 100);
                    const ctrlY = midY - (midY - oy) * (sag / 100);

                    if (i === 0) ctx.moveTo(p1x, p1y);
                    ctx.quadraticCurveTo(ctrlX, ctrlY, p2x, p2y);
                }
                ctx.stroke();
            }
        };

        // Top-Left Spider Web (Large Corner Web)
        const tlSize = Math.min(w, h) * 0.42;
        drawWeb(0, 0, tlSize, 0, Math.PI / 2, 8, 7, 0);

        // Top-Right Spider Web
        const trSize = Math.min(w, h) * 0.38;
        drawWeb(w, 0, trSize, Math.PI / 2, Math.PI, 7, 6, 1.2);

        // Bottom-Right Rubble Cobwebs (Clinging to the collapsed concrete)
        const brSize = Math.min(w, h) * 0.28;
        drawWeb(w * 0.95, h * 0.72, brSize, Math.PI * 0.8, Math.PI * 1.45, 6, 5, 2.1);

        // Dangling web strands in top-left with creeping spider
        const strandX = w * 0.08;
        const strandY = h * 0.18 + Math.sin(t * 2.0) * 4;
        ctx.strokeStyle = 'rgba(220, 235, 255, 0.45)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(strandX, 0);
        ctx.lineTo(strandX, strandY);
        ctx.stroke();

        // Small creeping spider silhouette
        ctx.fillStyle = '#080c14';
        ctx.beginPath();
        ctx.ellipse(strandX, strandY, 4, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(strandX, strandY + 3.5, 2, 0, Math.PI * 2);
        ctx.fill();

        // Spider legs
        ctx.strokeStyle = '#080c14';
        ctx.lineWidth = 1;
        const legOffsets = [-4, -2, 2, 4];
        for (const lo of legOffsets) {
            ctx.beginPath();
            ctx.moveTo(strandX - 2, strandY + lo * 0.5);
            ctx.lineTo(strandX - 6, strandY + lo * 1.2);
            ctx.moveTo(strandX + 2, strandY + lo * 0.5);
            ctx.lineTo(strandX + 6, strandY + lo * 1.2);
            ctx.stroke();
        }

        ctx.restore();
    }

    // 3. The Running Soul of the Stranger (The Restless Sprint)
    drawMenuRunningSoul(ctx, w, h, t) {
        ctx.save();

        const cycleDuration = 6.4; // seconds per cycle
        const cycle = t % cycleDuration;
        const platformY = h * 0.71;

        if (cycle < 4.8) {
            // SPRINTING PHASE: Desperate dash toward the trapped girl
            const p = cycle / 4.8;
            const startX = w * 0.06;
            const targetX = w * 0.67;
            const curX = startX + (targetX - startX) * p;
            const bobY = Math.abs(Math.sin(p * 26)) * 4.5;
            const curY = platformY - bobY;

            // --- GHOST ECHOES / MOTION BLUR (4 trailing afterimages) ---
            const echoOffsets = [14, 28, 44, 62];
            const echoAlphas = [0.25, 0.16, 0.09, 0.04];
            for (let i = 0; i < echoOffsets.length; i++) {
                const ex = curX - echoOffsets[i];
                if (ex > startX - 20) {
                    ctx.save();
                    ctx.globalAlpha = echoAlphas[i];
                    ctx.fillStyle = '#33ddff';
                    ctx.shadowColor = '#00ffee';
                    ctx.shadowBlur = 10;
                    this._renderSoulSilhouette(ctx, ex, curY + (i % 2) * 2, p, false);
                    ctx.restore();
                }
            }

            // --- MAIN RUNNING SPECTRAL SILHOUETTE ---
            ctx.save();
            ctx.globalAlpha = 0.88;
            ctx.fillStyle = '#a8f4ff';
            ctx.shadowColor = '#00f0ff';
            ctx.shadowBlur = 18;
            this._renderSoulSilhouette(ctx, curX, curY, p, true);

            // Outstretched arm reaching forward for her hand
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(curX + 6, curY - 26);
            ctx.lineTo(curX + 28, curY - 24);
            ctx.stroke();

            // Reaching hand / fingers
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(curX + 28, curY - 24, 2.5, 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();

            // Spectral trail particles
            ctx.fillStyle = 'rgba(100, 220, 255, 0.6)';
            for (let i = 0; i < 3; i++) {
                const px = curX - 10 - Math.random() * 30;
                const py = curY - 10 - Math.random() * 20;
                ctx.beginPath();
                ctx.arc(px, py, Math.random() * 2 + 0.8, 0, Math.PI * 2);
                ctx.fill();
            }

        } else if (cycle < 5.6) {
            // DISSOLVING PHASE: Seconds from reaching her, the cave-in shudders and his soul dissolves
            const dp = (cycle - 4.8) / 0.8;
            const shatterX = w * 0.67;
            const shatterY = platformY;

            ctx.save();
            ctx.globalAlpha = Math.max(0, 1.0 - dp);
            ctx.shadowColor = '#00ffff';
            ctx.shadowBlur = 25 * (1 - dp);

            // Shuddering silhouette bursting apart
            this._renderSoulSilhouette(ctx, shatterX + (Math.random() - 0.5) * 4, shatterY, 1.0, true);

            // Upward exploding soul embers and smoke
            for (let i = 0; i < 18; i++) {
                const emberX = shatterX + (Math.random() - 0.5) * 45;
                const emberY = shatterY - 20 - dp * 70 - Math.random() * 30;
                ctx.fillStyle = (i % 2 === 0) ? '#ffffff' : '#4deeea';
                ctx.beginPath();
                ctx.arc(emberX, emberY, Math.random() * 3 + 1, 0, Math.PI * 2);
                ctx.fill();
            }

            // Falling concrete dust in front of him
            ctx.fillStyle = 'rgba(180, 190, 205, 0.45)';
            for (let i = 0; i < 12; i++) {
                const rx = shatterX + 15 + (Math.random() - 0.5) * 35;
                const ry = platformY - 60 + dp * 80 + Math.random() * 20;
                ctx.fillRect(rx, ry, Math.random() * 3 + 2, Math.random() * 3 + 2);
            }
            ctx.restore();

        } else {
            // VOID PHASE: Dust settles, silence, soul prepares to emerge from dark left tunnel
            const vp = (cycle - 5.6) / 0.8;
            const a1x = w * 0.12;
            const glow = ctx.createRadialGradient(a1x, platformY - 20, 1, a1x, platformY - 20, 45);
            glow.addColorStop(0, `rgba(0, 240, 255, ${0.35 * vp})`);
            glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(a1x, platformY - 20, 45, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }

    // Helper: Draw runner silhouette with coat, head, legs in sprint kinematics
    _renderSoulSilhouette(ctx, x, y, runCycle, isMain = true) {
        const leanAngle = 0.38; // forward sprint lean
        const legPhase = runCycle * 26;

        ctx.save();
        ctx.translate(x, y);

        // Billowing trench coat behind runner
        ctx.beginPath();
        ctx.moveTo(-2, -26);
        ctx.quadraticCurveTo(-18, -18 + Math.sin(legPhase) * 6, -34, -14 + Math.cos(legPhase) * 8);
        ctx.lineTo(-24, -28 + Math.sin(legPhase + 1) * 7);
        ctx.lineTo(-4, -32);
        ctx.closePath();
        ctx.fill();

        // Torso leaning forward
        ctx.beginPath();
        ctx.ellipse(2, -24, 7, 14, leanAngle, 0, Math.PI * 2);
        ctx.fill();

        // Head straining forward
        ctx.beginPath();
        ctx.arc(10, -36, 6, 0, Math.PI * 2);
        ctx.fill();

        // Legs sprint kinematics
        const hipX = -1;
        const hipY = -12;
        const leg1Angle = Math.sin(legPhase) * 0.75;
        const leg2Angle = Math.sin(legPhase + Math.PI) * 0.75;

        // Front leg
        ctx.lineWidth = 3.2;
        ctx.strokeStyle = ctx.fillStyle;
        ctx.beginPath();
        ctx.moveTo(hipX, hipY);
        const k1x = hipX + Math.sin(leg1Angle) * 12 + 4;
        const k1y = hipY + Math.cos(leg1Angle) * 12;
        ctx.lineTo(k1x, k1y);
        ctx.lineTo(k1x + 6, k1y + 11);
        ctx.stroke();

        // Back leg
        ctx.beginPath();
        ctx.moveTo(hipX, hipY);
        const k2x = hipX + Math.sin(leg2Angle) * 12 - 4;
        const k2y = hipY + Math.cos(leg2Angle) * 12;
        ctx.lineTo(k2x, k2y);
        ctx.lineTo(k2x - 7, k2y + 11);
        ctx.stroke();

        ctx.restore();
    }

    // 4. The Dead Girl's Body (Trapped under collapsed slab) & Glowing Memory Stone
    drawMenuDeadGirl(ctx, w, h, t) {
        ctx.save();

        const platformY = h * 0.72;
        const gx = w * 0.77;
        const gy = platformY + 6;

        // --- COLLAPSED CONCRETE RUBBLE PILE ---
        // Heavy broken slab angled over her lower body
        ctx.fillStyle = '#06080e';
        ctx.beginPath();
        ctx.moveTo(gx - 15, gy + 14);
        ctx.lineTo(gx + w * 0.16, gy - 28);
        ctx.lineTo(gx + w * 0.18, gy + 18);
        ctx.lineTo(gx - 10, gy + 22);
        ctx.closePath();
        ctx.fill();

        // Front slab face
        ctx.fillStyle = '#141a26';
        ctx.beginPath();
        ctx.moveTo(gx - 10, gy - 2);
        ctx.lineTo(gx + w * 0.15, gy - 36);
        ctx.lineTo(gx + w * 0.16, gy - 26);
        ctx.lineTo(gx - 6, gy + 10);
        ctx.closePath();
        ctx.fill();

        // Exposed twisted rusted rebar wires sticking out of broken concrete
        ctx.strokeStyle = '#6a4a35';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(gx + 20, gy - 12);
        ctx.lineTo(gx + 12, gy - 28);
        ctx.lineTo(gx + 18, gy - 36);
        ctx.moveTo(gx + 45, gy - 18);
        ctx.lineTo(gx + 55, gy - 32);
        ctx.stroke();

        // Crushed brick fragments and gravel around the slab
        ctx.fillStyle = '#261b17';
        ctx.fillRect(gx - 25, gy + 10, 8, 5);
        ctx.fillRect(gx - 40, gy + 8, 6, 4);
        ctx.fillRect(gx + 30, gy + 12, 10, 6);

        // --- THE DEAD GIRL ---
        // Lying on her side in the dust, lower half pinned beneath the slab
        
        // Torso in torn dusty vintage dress
        ctx.fillStyle = '#2a344c';
        ctx.beginPath();
        ctx.ellipse(gx - 22, gy - 2, 16, 7, -0.15, 0, Math.PI * 2);
        ctx.fill();

        // Delicate head resting on the cold stone
        ctx.fillStyle = '#d2d9e8'; // pale skin
        ctx.beginPath();
        ctx.arc(gx - 42, gy - 5, 6.5, 0, Math.PI * 2);
        ctx.fill();

        // Long dark hair spilled across the wet concrete floor
        ctx.fillStyle = '#080a10';
        ctx.beginPath();
        ctx.moveTo(gx - 40, gy - 9);
        ctx.quadraticCurveTo(gx - 54, gy - 6, gx - 58, gy + 4);
        ctx.lineTo(gx - 36, gy + 2);
        ctx.closePath();
        ctx.fill();

        // Outstretched pale arm reaching forward toward center
        ctx.strokeStyle = '#d2d9e8';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(gx - 28, gy - 1);
        ctx.lineTo(gx - 55, gy + 2);
        ctx.lineTo(gx - 74, gy + 4);
        ctx.stroke();

        // Pale open hand / fingers reaching forward
        ctx.fillStyle = '#d2d9e8';
        ctx.beginPath();
        ctx.arc(gx - 75, gy + 4, 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(gx - 79, gy + 3, 4, 1.5); // extended fingers

        // --- BROKEN VINTAGE DOLL / KEEPSAKE IN THE RUBBLE ---
        const dollX = gx - 32;
        const dollY = gy + 11;
        // Porcelain baby doll head with crack
        ctx.fillStyle = '#dedad4';
        ctx.beginPath();
        ctx.arc(dollX, dollY, 4, 0, Math.PI * 2);
        ctx.fill();
        // Eye and crack
        ctx.fillStyle = '#222222';
        ctx.fillRect(dollX - 1.5, dollY - 1, 1, 1);
        ctx.strokeStyle = '#664444';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(dollX - 1, dollY - 3);
        ctx.lineTo(dollX + 2, dollY + 2);
        ctx.stroke();
        // Faded red hair ribbon
        ctx.fillStyle = '#aa2222';
        ctx.fillRect(dollX + 2, dollY - 2, 4, 2);

        // --- THE GLOWING MEMORY STONE ---
        // Resting inches from her fingertips, radiating tragic ethereal beauty
        const stoneX = gx - 88;
        const stoneY = gy + 3 + Math.sin(t * 2.2) * 1.5;
        const pulse = Math.sin(t * 3.0) * 0.2 + 0.8;

        // Dynamic light cast by the memory stone on her hand and the dust
        const stoneGlow = ctx.createRadialGradient(stoneX, stoneY, 2, stoneX, stoneY, 75 * pulse);
        stoneGlow.addColorStop(0.0, 'rgba(255, 255, 255, 0.95)');
        stoneGlow.addColorStop(0.2, `rgba(0, 240, 255, ${0.75 * pulse})`);
        stoneGlow.addColorStop(0.5, `rgba(255, 170, 50, ${0.40 * pulse})`); // memory stone warm agony
        stoneGlow.addColorStop(1.0, 'rgba(0, 0, 0, 0)');

        ctx.fillStyle = stoneGlow;
        ctx.beginPath();
        ctx.arc(stoneX, stoneY, 75 * pulse, 0, Math.PI * 2);
        ctx.fill();

        // Faceted crystal diamond body
        ctx.save();
        ctx.translate(stoneX, stoneY);
        ctx.rotate(Math.sin(t * 1.2) * 0.1);

        // Diamond polygon
        ctx.fillStyle = '#e8ffff';
        ctx.beginPath();
        ctx.moveTo(0, -9);
        ctx.lineTo(7, 0);
        ctx.lineTo(0, 9);
        ctx.lineTo(-7, 0);
        ctx.closePath();
        ctx.fill();

        // Inner crystalline facets
        ctx.strokeStyle = 'rgba(0, 180, 230, 0.7)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, -9); ctx.lineTo(0, 9);
        ctx.moveTo(-7, 0); ctx.lineTo(7, 0);
        ctx.stroke();

        ctx.restore();

        // Ethereal soul dust floating up from her form
        ctx.fillStyle = 'rgba(160, 230, 255, 0.55)';
        for (let i = 0; i < 4; i++) {
            const mx = gx - 30 - Math.sin(t * 1.5 + i) * 25;
            const my = gy - 12 - ((t * 25 + i * 18) % 60);
            ctx.beginPath();
            ctx.arc(mx, my, 1.2, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }

    // 5. The Listener Lurking in the Overhead Shadows
    drawMenuListenerLurking(ctx, w, h, t) {
        ctx.save();

        const lx = w * 0.50;
        const ly = h * 0.13;
        const headTilt = Math.sin(t * 0.8) * 0.22;
        const eyePulse = Math.sin(t * 2.8) * 0.25 + 0.75;

        ctx.translate(lx, ly);
        ctx.rotate(headTilt);

        // Deep shadow surrounding the monster
        const shadowGlow = ctx.createRadialGradient(0, 0, 10, 0, 0, 90);
        shadowGlow.addColorStop(0, 'rgba(0, 0, 0, 0.95)');
        shadowGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = shadowGlow;
        ctx.beginPath();
        ctx.arc(0, 0, 90, 0, Math.PI * 2);
        ctx.fill();

        // Cracked porcelain baby doll head
        ctx.fillStyle = '#dcd8ce';
        ctx.beginPath();
        ctx.ellipse(0, 0, 20, 24, 0, 0, Math.PI * 2);
        ctx.fill();

        // Fine cracks on porcelain forehead
        ctx.strokeStyle = '#5a4e48';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-4, -20); ctx.lineTo(2, -10); ctx.lineTo(-2, -3);
        ctx.moveTo(6, -14); ctx.lineTo(12, -7);
        ctx.stroke();

        // Weeping glowing crimson eyes (The Listener's true horror)
        const eyeOffsets = [-8, 8];
        for (const ex of eyeOffsets) {
            // Intense red radial searchlight
            const redGlow = ctx.createRadialGradient(ex, -3, 1, ex, -3, 24 * eyePulse);
            redGlow.addColorStop(0.0, 'rgba(255, 34, 34, 0.95)');
            redGlow.addColorStop(0.35, 'rgba(255, 34, 34, 0.45)');
            redGlow.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = redGlow;
            ctx.beginPath();
            ctx.arc(ex, -3, 24 * eyePulse, 0, Math.PI * 2);
            ctx.fill();

            // Pupil core
            ctx.fillStyle = '#ff1111';
            ctx.beginPath();
            ctx.arc(ex, -3, 3, 0, Math.PI * 2);
            ctx.fill();

            // Downward blood tear trail
            ctx.fillStyle = 'rgba(180, 20, 20, 0.65)';
            ctx.fillRect(ex - 0.75, -1, 1.5, 9);
        }

        // White lips and red teeth grin
        ctx.fillStyle = '#f0f0f5';
        ctx.beginPath();
        ctx.arc(0, 11, 7, 0, Math.PI);
        ctx.fill();

        ctx.fillStyle = '#bb1111';
        for (let i = -4; i <= 4; i += 2) {
            ctx.fillRect(i, 11, 1.2, 3);
        }

        // Faint acoustic hearing shockwaves radiating from ears
        ctx.strokeStyle = `rgba(255, 50, 50, ${0.25 * eyePulse})`;
        ctx.lineWidth = 1;
        const waveR = ((t * 35) % 60);
        ctx.beginPath();
        ctx.arc(-18, 0, waveR * 0.6, Math.PI * 0.7, Math.PI * 1.3);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(18, 0, waveR * 0.6, -Math.PI * 0.3, Math.PI * 0.3);
        ctx.stroke();

        ctx.restore();
    }

    // 6. Volumetric Ground Mist, Water Ripples, and Drifting Embers
    drawMenuAtmosphere(ctx, w, h, t) {
        ctx.save();

        const platformY = h * 0.72;

        // Ground fog layers drifting along the subway platform
        const fogColors = [
            'rgba(14, 22, 38, 0.38)',
            'rgba(10, 16, 28, 0.45)'
        ];

        for (let layer = 0; layer < 2; layer++) {
            ctx.fillStyle = fogColors[layer];
            ctx.beginPath();
            ctx.moveTo(0, h);

            const speed = (layer === 0) ? 0.35 : 0.2;
            const baseY = platformY + 10 + layer * 16;

            for (let x = 0; x <= w; x += 30) {
                const waveY = baseY + Math.sin(x * 0.008 + t * speed) * 8 + Math.cos(x * 0.015 - t * 0.2) * 5;
                ctx.lineTo(x, waveY);
            }

            ctx.lineTo(w, h);
            ctx.closePath();
            ctx.fill();
        }

        // Concentric water drop ripples in puddles
        const rippleR = ((t * 18) % 35);
        const rippleAlpha = Math.max(0, 1.0 - rippleR / 35);
        ctx.strokeStyle = `rgba(100, 180, 240, ${0.4 * rippleAlpha})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(w * 0.28, platformY + 24, rippleR * 1.6, rippleR * 0.5, 0, 0, Math.PI * 2);
        ctx.stroke();

        ctx.restore();
    }

    // 7. Cinematic Dark Horror Vignette
    drawMenuVignette(ctx, w, h) {
        const vig = ctx.createRadialGradient(
            w * 0.5, h * 0.45, Math.min(w, h) * 0.25,
            w * 0.5, h * 0.45, Math.max(w, h) * 0.78
        );
        vig.addColorStop(0.0, 'rgba(0, 0, 0, 0.0)');
        vig.addColorStop(0.65, 'rgba(2, 3, 6, 0.55)');
        vig.addColorStop(1.0, 'rgba(1, 2, 4, 0.94)');

        ctx.fillStyle = vig;
        ctx.fillRect(0, 0, w, h);
    }
    
    // Draw calibration screen
    drawCalibration(phase, level) {
        const ctx = this.ctx;
        
        // Dark background
        ctx.fillStyle = '#060810';
        ctx.fillRect(0, 0, this.width, this.height);
        
        const cx = this.width / 2;
        const cy = this.height / 2;
        
        // Calibration header
        ctx.font = 'bold 32px Georgia, serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('MICROPHONE CALIBRATION', cx, cy - 120);
        
        // Phase-specific prompt instructions
        let promptText = 'Whisper into your microphone...';
        if (phase === 1) {
            promptText = 'Speak normally...';
        } else if (phase === 2) {
            promptText = 'Shout!';
        }
        
        ctx.font = 'italic 20px Georgia, serif';
        ctx.fillStyle = '#ccaa77';
        ctx.fillText(promptText, cx, cy - 65);
        
        // Mic level bar
        const barW = 400;
        const barH = 18;
        const barX = Math.round(cx - barW / 2);
        const barY = Math.round(cy - 10);
        
        ctx.fillStyle = 'rgba(15, 20, 30, 0.8)';
        this.drawRoundedRect(ctx, barX, barY, barW, barH, 6, true, false);
        
        const normLevel = clamp(level || 0, 0, 1);
        const fillW = Math.round(barW * normLevel);
        
        if (fillW > 0) {
            ctx.save();
            this.clipRoundedRect(ctx, barX, barY, barW, barH, 6);
            
            const grad = ctx.createLinearGradient(barX, barY, barX + barW, barY);
            grad.addColorStop(0.0, COLORS.NOISE_BAR_SAFE);
            grad.addColorStop(0.35, COLORS.NOISE_BAR_WARN);
            grad.addColorStop(0.65, COLORS.RED_LINE_COLOR);
            grad.addColorStop(1.0, COLORS.NOISE_BAR_DANGER);
            
            ctx.fillStyle = grad;
            ctx.fillRect(barX, barY, fillW, barH);
            ctx.restore();
        }
        
        // Red line threshold
        const redLineX = barX + Math.round(barW * NOISE_THRESHOLDS.RED_LINE);
        ctx.strokeStyle = COLORS.RED_LINE_COLOR;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(redLineX, barY - 4);
        ctx.lineTo(redLineX, barY + barH + 4);
        ctx.stroke();
        
        // Phase progress steps indicator (1, 2, 3)
        const stepY = cy + 45;
        for (let i = 0; i < 3; i++) {
            const stepX = cx + (i - 1) * 36;
            ctx.fillStyle = (i === phase) ? '#eedd88' : (i < phase ? '#33aa55' : 'rgba(50, 60, 80, 0.6)');
            ctx.beginPath();
            ctx.arc(stepX, stepY, 6, 0, Math.PI * 2);
            ctx.fill();
        }
        
        // Dynamic mic percentage text
        ctx.font = '13px monospace';
        ctx.fillStyle = COLORS.TEXT_DIM;
        ctx.fillText(`Input Level: ${Math.round(normLevel * 100)}%`, cx, stepY + 32);
        
        // Bottom instruction
        ctx.font = '13px sans-serif';
        ctx.fillStyle = '#667788';
        ctx.fillText('Press SPACE or CLICK when ready', cx, this.height - 40);
    }
    
    // ============================================================
    // THE DANGEROUS KILL JUMPSCARE
    // ============================================================
    // Visceral, terrifying close-up of the cracked porcelain baby doll face
    // lunging forward into the camera lens with unhinged jaw, razor-sharp
    // bloody teeth, weeping crimson eyes, clawing porcelain hands,
    // shattered glass spiderwebs, and lens blood splatters.
    drawKillJumpscare(ctx, w, h, progress) {
        ctx.save();

        // 1. Violent camera jitter / glitch shock
        const shakeAmp = (1.0 - progress * 0.55) * 18;
        const jx = (Math.random() - 0.5) * shakeAmp;
        const jy = (Math.random() - 0.5) * shakeAmp;
        ctx.translate(jx, jy);

        // 2. Background: sudden bloody flash fading into pitch abyss
        const flashAlpha = progress < 0.18 ? (1.0 - progress / 0.18) : 0;
        ctx.fillStyle = '#030103';
        ctx.fillRect(-30, -30, w + 60, h + 60);

        // Visceral blood pool vignette
        const bloodGrad = ctx.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, Math.max(w, h) * 0.76);
        bloodGrad.addColorStop(0, `rgba(195, 0, 0, ${0.5 * (1.0 - progress * 0.35)})`);
        bloodGrad.addColorStop(0.55, 'rgba(80, 0, 0, 0.85)');
        bloodGrad.addColorStop(1, '#020102');
        ctx.fillStyle = bloodGrad;
        ctx.fillRect(-30, -30, w + 60, h + 60);

        if (flashAlpha > 0) {
            ctx.fillStyle = `rgba(255, 30, 30, ${flashAlpha * 0.75})`;
            ctx.fillRect(-30, -30, w + 60, h + 60);
        }

        const cx = w / 2;
        const cy = h / 2 - 20;

        // 3. Zoom / Lunge Scale: The Listener's head explodes toward the camera lens
        const zoom = lerp(0.85, 1.82, Math.pow(progress, 0.35));
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(zoom, zoom);

        // --- THE CRACKED PORCELAIN BABY DOLL VISAGE ---
        
        // A. Head base (Ghostly cracked porcelain baby doll skin)
        const headW = 142;
        const headH = 178;
        
        // Deep shadow behind head
        ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
        ctx.beginPath();
        ctx.ellipse(0, 0, headW + 14, headH + 14, 0, 0, Math.PI * 2);
        ctx.fill();

        // Porcelain base gradient
        const skinGrad = ctx.createRadialGradient(-35, -45, 20, 0, 10, headH);
        skinGrad.addColorStop(0, '#f4eee7');
        skinGrad.addColorStop(0.45, '#ded2c4');
        skinGrad.addColorStop(0.82, '#9d8e84');
        skinGrad.addColorStop(1.0, '#382a27');
        ctx.fillStyle = skinGrad;
        ctx.beginPath();
        ctx.ellipse(0, 0, headW, headH, 0, 0, Math.PI * 2);
        ctx.fill();

        // Porcelain hairline & subtle baby doll cranium suture
        ctx.strokeStyle = '#221514';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // B. Shattered Porcelain Cracks & Crevices (oozing crimson blood)
        ctx.strokeStyle = '#180404';
        ctx.lineWidth = 2.8;
        ctx.beginPath();
        // Forehead fracture split
        ctx.moveTo(0, -headH + 10);
        ctx.lineTo(-20, -headH + 55);
        ctx.lineTo(8, -headH + 90);
        ctx.lineTo(-14, -42);
        // Left temple fracture
        ctx.moveTo(-headW + 15, -45);
        ctx.lineTo(-65, -20);
        ctx.lineTo(-42, 12);
        // Right cheek fracture
        ctx.moveTo(headW - 20, 15);
        ctx.lineTo(60, 40);
        ctx.lineTo(36, 75);
        ctx.lineTo(15, 120);
        ctx.stroke();

        // Glowing red fissures beneath cracks
        ctx.strokeStyle = 'rgba(255, 30, 30, 0.75)';
        ctx.lineWidth = 1.3;
        ctx.stroke();

        // Split skull cavity showing glowing crimson flesh/void
        ctx.fillStyle = '#2b0000';
        ctx.beginPath();
        ctx.moveTo(-18, -headH + 25);
        ctx.lineTo(-6, -headH + 68);
        ctx.lineTo(12, -headH + 52);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 20, 20, 0.85)';
        ctx.beginPath();
        ctx.arc(-4, -headH + 46, 8, 0, Math.PI * 2);
        ctx.fill();

        // C. Hollow Cavernous Eye Sockets Weeping Crimson Blood
        const eyeX = 48;
        const eyeY = -22;
        const eyeR = 26;

        for (const sign of [-1, 1]) {
            const ex = sign * eyeX;
            // Sunken dark orbital socket
            ctx.fillStyle = '#060002';
            ctx.beginPath();
            ctx.ellipse(ex, eyeY, eyeR, eyeR * 1.15, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#2d0808';
            ctx.lineWidth = 3;
            ctx.stroke();

            // Weeping viscous crimson blood streams running down porcelain cheeks
            ctx.fillStyle = '#850202';
            ctx.beginPath();
            ctx.moveTo(ex - 12, eyeY + eyeR * 0.7);
            ctx.quadraticCurveTo(ex - 8, eyeY + 65, ex - 16, eyeY + 140);
            ctx.lineTo(ex - 4, eyeY + 145);
            ctx.quadraticCurveTo(ex - 2, eyeY + 70, ex + 2, eyeY + eyeR * 0.7);
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle = '#ba0808';
            ctx.beginPath();
            ctx.moveTo(ex + 4, eyeY + eyeR * 0.6);
            ctx.quadraticCurveTo(ex + 12, eyeY + 55, ex + 8, eyeY + 125);
            ctx.lineTo(ex + 14, eyeY + 130);
            ctx.quadraticCurveTo(ex + 18, eyeY + 60, ex + 14, eyeY + eyeR * 0.6);
            ctx.closePath();
            ctx.fill();

            // Burning red laser pupils in the center of hollow black void
            const glowR = 19;
            const eyeGlow = ctx.createRadialGradient(ex, eyeY, 1, ex, eyeY, glowR);
            eyeGlow.addColorStop(0, 'rgba(255, 255, 255, 1)');
            eyeGlow.addColorStop(0.25, 'rgba(255, 40, 40, 1)');
            eyeGlow.addColorStop(0.65, 'rgba(255, 0, 0, 0.72)');
            eyeGlow.addColorStop(1, 'rgba(180, 0, 0, 0)');
            ctx.fillStyle = eyeGlow;
            ctx.beginPath();
            ctx.arc(ex, eyeY, glowR, 0, Math.PI * 2);
            ctx.fill();

            // Pinpoint pupil center
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(ex, eyeY, 2.5, 0, Math.PI * 2);
            ctx.fill();
        }

        // D. Uncanny Doll Nose
        ctx.fillStyle = '#9e8c80';
        ctx.beginPath();
        ctx.arc(0, 15, 6, 0, Math.PI);
        ctx.fill();
        // Nostril holes
        ctx.fillStyle = '#1c1210';
        ctx.beginPath();
        ctx.arc(-4, 18, 2, 0, Math.PI * 2);
        ctx.arc(4, 18, 2, 0, Math.PI * 2);
        ctx.fill();

        // E. Unhinged Wide Gaping Jaw & Razor-Sharp Bloody Teeth
        const mouthY = 75;
        const mouthW = 70;
        const mouthH = 52 + progress * 22; // jaw drops unnaturally open!

        // Outer mouth cavity
        ctx.fillStyle = '#050002';
        ctx.beginPath();
        ctx.ellipse(0, mouthY, mouthW, mouthH, 0, 0, Math.PI * 2);
        ctx.fill();

        // White lips outline
        ctx.strokeStyle = '#f4ede6';
        ctx.lineWidth = 4.8;
        ctx.stroke();

        // Dark throat void
        ctx.fillStyle = '#180002';
        ctx.beginPath();
        ctx.ellipse(0, mouthY, mouthW * 0.76, mouthH * 0.76, 0, 0, Math.PI * 2);
        ctx.fill();

        // Two rows of razor-sharp needle-teeth coated in glistening red blood!
        const numTeeth = 11;
        // Top teeth pointing down
        for (let i = 0; i < numTeeth; i++) {
            const tx = lerp(-mouthW * 0.72, mouthW * 0.72, i / (numTeeth - 1));
            const toothH = 15 + Math.sin((i / numTeeth) * Math.PI) * 9;
            ctx.fillStyle = '#eae2d8';
            ctx.beginPath();
            ctx.moveTo(tx - 3.5, mouthY - mouthH * 0.65);
            ctx.lineTo(tx + 3.5, mouthY - mouthH * 0.65);
            ctx.lineTo(tx, mouthY - mouthH * 0.65 + toothH);
            ctx.closePath();
            ctx.fill();
            // Blood tip on tooth
            ctx.fillStyle = '#d00000';
            ctx.beginPath();
            ctx.moveTo(tx - 2, mouthY - mouthH * 0.65 + toothH * 0.45);
            ctx.lineTo(tx + 2, mouthY - mouthH * 0.65 + toothH * 0.45);
            ctx.lineTo(tx, mouthY - mouthH * 0.65 + toothH);
            ctx.closePath();
            ctx.fill();
        }

        // Bottom teeth pointing up
        for (let i = 0; i < numTeeth; i++) {
            const tx = lerp(-mouthW * 0.68, mouthW * 0.68, i / (numTeeth - 1));
            const toothH = 13 + Math.sin((i / numTeeth) * Math.PI) * 8;
            ctx.fillStyle = '#eae2d8';
            ctx.beginPath();
            ctx.moveTo(tx - 3, mouthY + mouthH * 0.7);
            ctx.lineTo(tx + 3, mouthY + mouthH * 0.7);
            ctx.lineTo(tx, mouthY + mouthH * 0.7 - toothH);
            ctx.closePath();
            ctx.fill();
            // Blood tip on tooth
            ctx.fillStyle = '#d00000';
            ctx.beginPath();
            ctx.moveTo(tx - 2, mouthY + mouthH * 0.7 - toothH * 0.45);
            ctx.lineTo(tx + 2, mouthY + mouthH * 0.7 - toothH * 0.45);
            ctx.lineTo(tx, mouthY + mouthH * 0.7 - toothH);
            ctx.closePath();
            ctx.fill();
        }

        ctx.restore(); // end face transform

        // 4. Cracked Porcelain Claws Reaching from Screen Edges
        this.drawJumpscareClaws(ctx, w, h, progress);

        // 5. Shattered Glass Spiderweb Cracks across the Viewport
        this.drawShatteredGlass(ctx, w, h, progress);

        // 6. Dripping Blood Splatters & Lens Dirt
        this.drawLensBloodSplatters(ctx, w, h, progress);

        // 7. Sinister Glitch / VHS Tracking / Subliminal Red Screamer Flash
        if (Math.random() < 0.4) {
            ctx.fillStyle = 'rgba(255, 0, 0, 0.2)';
            const barY = Math.random() * h;
            ctx.fillRect(0, barY, w, 14 + Math.random() * 26);
        }

        ctx.restore();
    }

    // Draw cracked porcelain doll hands lunging in from bottom corners
    drawJumpscareClaws(ctx, w, h, progress) {
        ctx.save();
        const handIn = lerp(-60, 40, Math.pow(progress, 0.5));

        // Left Hand
        ctx.save();
        ctx.translate(handIn, h - 20);
        ctx.rotate(-0.35);
        this._renderPorcelainDollHand(ctx);
        ctx.restore();

        // Right Hand
        ctx.save();
        ctx.translate(w - handIn, h - 20);
        ctx.scale(-1, 1);
        ctx.rotate(-0.35);
        this._renderPorcelainDollHand(ctx);
        ctx.restore();

        ctx.restore();
    }

    _renderPorcelainDollHand(ctx) {
        ctx.fillStyle = '#080002';
        ctx.beginPath();
        ctx.ellipse(40, 20, 65, 80, 0.2, 0, Math.PI * 2);
        ctx.fill();

        // Pale porcelain palm
        ctx.fillStyle = '#ddd2c4';
        ctx.beginPath();
        ctx.ellipse(35, 15, 55, 70, 0.2, 0, Math.PI * 2);
        ctx.fill();

        // 4 elongated cracked fingers with red bloody fingernails
        const fingers = [
            { x: 10, y: -45, w: 14, h: 65, rot: -0.2 },
            { x: 30, y: -65, w: 15, h: 80, rot: -0.05 },
            { x: 52, y: -62, w: 14, h: 75, rot: 0.1 },
            { x: 72, y: -45, w: 13, h: 60, rot: 0.3 }
        ];

        for (const f of fingers) {
            ctx.save();
            ctx.translate(f.x, f.y);
            ctx.rotate(f.rot);

            // Porcelain finger segment
            ctx.fillStyle = '#ded3c5';
            ctx.fillRect(-f.w / 2, 0, f.w, f.h);

            // Fracture lines
            ctx.strokeStyle = '#220808';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(-f.w / 2, f.h * 0.4);
            ctx.lineTo(f.w / 2, f.h * 0.5);
            ctx.stroke();

            // Sharp crimson claw tip
            ctx.fillStyle = '#b80000';
            ctx.beginPath();
            ctx.moveTo(-f.w / 2, 0);
            ctx.lineTo(f.w / 2, 0);
            ctx.lineTo(0, -18);
            ctx.closePath();
            ctx.fill();

            ctx.restore();
        }
    }

    // Draw shattered glass spiderweb fracture lines across the screen
    drawShatteredGlass(ctx, w, h, progress) {
        ctx.save();
        const cx = w / 2;
        const cy = h / 2 - 20;
        const alpha = clamp(progress * 1.5, 0, 0.85);

        ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.7})`;
        ctx.lineWidth = 1.5;

        // Jagged radial fracture lines
        const numCracks = 12;
        const maxR = Math.hypot(w, h);
        for (let i = 0; i < numCracks; i++) {
            const angle = (i / numCracks) * Math.PI * 2 + 0.15;
            let curX = cx;
            let curY = cy;
            ctx.beginPath();
            ctx.moveTo(curX, curY);

            const segments = 6;
            for (let s = 1; s <= segments; s++) {
                const segR = (s / segments) * maxR * 0.75;
                const jitterA = angle + (Math.sin(i * 3 + s * 2) * 0.12);
                curX = cx + Math.cos(jitterA) * segR;
                curY = cy + Math.sin(jitterA) * segR;
                ctx.lineTo(curX, curY);
            }
            ctx.stroke();
        }

        // Concentric polygonal stress fractures
        for (let r = 80; r < maxR * 0.65; r += 75) {
            ctx.beginPath();
            for (let i = 0; i <= numCracks; i++) {
                const angle = (i / numCracks) * Math.PI * 2 + 0.15;
                const jitterR = r + Math.sin(i * 4) * 15;
                const px = cx + Math.cos(angle) * jitterR;
                const py = cy + Math.sin(angle) * jitterR;
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.stroke();
        }

        ctx.restore();
    }

    // Draw lens blood splatters and droplets
    drawLensBloodSplatters(ctx, w, h, progress) {
        ctx.save();
        const alpha = clamp(progress * 1.6, 0, 0.95);
        ctx.fillStyle = `rgba(180, 0, 0, ${alpha})`;

        // Blood splatters fixed pseudo-randomly
        const splatters = [
            { x: w * 0.22, y: h * 0.28, r: 24, drip: 55 },
            { x: w * 0.78, y: h * 0.32, r: 28, drip: 65 },
            { x: w * 0.15, y: h * 0.65, r: 32, drip: 75 },
            { x: w * 0.85, y: h * 0.68, r: 26, drip: 50 },
            { x: w * 0.5, y: h * 0.12, r: 22, drip: 45 },
            { x: w * 0.38, y: h * 0.82, r: 18, drip: 35 }
        ];

        for (const s of splatters) {
            // Main splatter clot
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
            ctx.fill();

            // Downward blood drip
            const curDrip = s.drip * clamp((progress - 0.15) / 0.85, 0, 1);
            if (curDrip > 0) {
                ctx.beginPath();
                ctx.moveTo(s.x - s.r * 0.4, s.y);
                ctx.quadraticCurveTo(s.x, s.y + curDrip * 0.7, s.x, s.y + curDrip);
                ctx.quadraticCurveTo(s.x, s.y + curDrip * 0.7, s.x + s.r * 0.4, s.y);
                ctx.closePath();
                ctx.fill();

                // Drip droplet at bottom
                ctx.beginPath();
                ctx.arc(s.x, s.y + curDrip + 4, 3.5, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        ctx.restore();
    }
    
    // Draw game over screen (Terrifying cracked porcelain visage looms in darkness)
    drawGameOver() {
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;
        
        // Deep abyss
        ctx.fillStyle = '#020103';
        ctx.fillRect(0, 0, w, h);
        
        const cx = w / 2;
        const cy = h / 2;
        
        // Faint cracked doll face silhouette in the darkness
        const fadeAlpha = clamp(this.gameOverTimer / 2.0, 0, 1);
        ctx.save();
        ctx.fillStyle = `rgba(32, 22, 24, ${fadeAlpha * 0.55})`;
        ctx.beginPath();
        ctx.ellipse(cx, cy - 45, 110, 140, 0, 0, Math.PI * 2);
        ctx.fill();

        // The Listener's weeping red eyes appear in the center
        const eyePulse = Math.sin(this.gameTime * 4) * 0.2 + 0.8;
        const eyeOffsets = [-38, 38];
        
        for (const ex of eyeOffsets) {
            const glow = ctx.createRadialGradient(cx + ex, cy - 50, 1, cx + ex, cy - 50, 28 * eyePulse);
            glow.addColorStop(0.0, `rgba(255, 34, 34, ${0.95 * fadeAlpha})`);
            glow.addColorStop(0.4, `rgba(255, 34, 34, ${0.45 * fadeAlpha})`);
            glow.addColorStop(1.0, 'rgba(255, 34, 34, 0.0)');
            
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(cx + ex, cy - 50, 28 * eyePulse, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.fillStyle = `rgba(255, 255, 255, ${fadeAlpha})`;
            ctx.beginPath();
            ctx.arc(cx + ex, cy - 50, 3, 0, Math.PI * 2);
            ctx.fill();

            // Weeping red streaks
            ctx.fillStyle = `rgba(180, 10, 10, ${fadeAlpha * 0.7})`;
            ctx.fillRect(cx + ex - 2, cy - 45, 4, 60);
        }

        // Creeping corner cobwebs on defeat screen
        this.drawProximitySpiderWebs(ctx, w, h, 0.85, this.gameTime, 0.5);
        
        // "Don't leave me..." fades in
        const textAlpha = clamp((this.gameOverTimer - 1.0) / 1.5, 0, 1);
        ctx.font = 'italic 28px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = `rgba(245, 215, 215, ${textAlpha})`;
        ctx.fillText("Don't leave me...", cx, cy + 50);
        
        // "Press R to retry" at bottom
        const retryAlpha = clamp((this.gameOverTimer - 2.2) / 1.0, 0, 1);
        if (retryAlpha > 0) {
            const pulse = Math.sin(this.gameTime * 4) * 0.25 + 0.75;
            ctx.font = 'bold 15px monospace';
            ctx.fillStyle = `rgba(240, 70, 70, ${retryAlpha * pulse})`;
            ctx.fillText('PRESS R TO RETRY', cx, cy + 105);
        }
        
        ctx.restore();
    }
    
    // Draw victory screen
    drawVictory() {
        const ctx = this.ctx;
        const progress = clamp(this.victoryTimer / 3.0, 0, 1);
        
        // Screen fades to white slowly
        const bgVal = Math.round(lerp(10, 248, progress));
        ctx.fillStyle = `rgb(${bgVal}, ${bgVal}, ${bgVal})`;
        ctx.fillRect(0, 0, this.width, this.height);
        
        const cx = this.width / 2;
        const cy = this.height / 2;
        
        // Soft brown human eyes (not red) fade in and then fade away
        if (progress > 0.1 && progress < 0.8) {
            const eyeFade = Math.sin(((progress - 0.1) / 0.7) * Math.PI);
            const eyeOffsets = [-20, 20];
            
            ctx.save();
            ctx.fillStyle = `rgba(110, 75, 45, ${eyeFade * 0.85})`;
            for (const ex of eyeOffsets) {
                ctx.beginPath();
                ctx.arc(cx + ex, cy - 40, 4, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }
        
        // Text: "Silence." in the center
        const textAlpha = clamp((this.victoryTimer - 1.0) / 1.2, 0, 1);
        const textColor = (progress > 0.6) ? '#111118' : '#ffffff';
        
        ctx.save();
        ctx.font = '36px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = textColor;
        ctx.globalAlpha = textAlpha;
        ctx.fillText('Silence.', cx, cy);
        
        // "You escaped." appears after
        const escapedAlpha = clamp((this.victoryTimer - 2.2) / 1.0, 0, 1);
        if (escapedAlpha > 0) {
            ctx.font = '16px Georgia, serif';
            ctx.globalAlpha = escapedAlpha;
            ctx.fillText('You escaped.', cx, cy + 42);
            
            ctx.font = '13px monospace';
            ctx.fillText('PRESS R TO RETURN TO MENU', cx, cy + 95);
        }
        
        ctx.restore();
    }
    
    // Draw flashback (memory scene when picking up a stone)
    drawFlashback(stoneId, progress) {
        const ctx = this.ctx;
        progress = clamp(progress !== undefined ? progress : 0, 0, 1);
        
        // Screen desaturates and darkens
        ctx.fillStyle = '#060608';
        ctx.fillRect(0, 0, this.width, this.height);
        
        const cx = this.width / 2;
        const cy = this.height / 2;
        
        ctx.save();
        
        // Film grain effect
        for (let i = 0; i < 40; i++) {
            ctx.fillStyle = `rgba(255, 255, 255, ${randomFloat(0.02, 0.07)})`;
            ctx.fillRect(randomInt(0, this.width), randomInt(0, this.height), 2, 2);
        }
        
        // Stone-specific animated narrative shapes
        if (stoneId === 1) {
            // Stone 1: Girl figure and echoing circles (crying)
            const girlAlpha = clamp(Math.sin(progress * Math.PI), 0, 1);
            ctx.fillStyle = `rgba(220, 220, 230, ${girlAlpha * 0.75})`;
            
            // Kneeling silhouette figure
            ctx.beginPath();
            ctx.arc(cx, cy - 12, 7, 0, Math.PI * 2); // Head
            ctx.fill();
            
            ctx.beginPath();
            ctx.moveTo(cx - 10, cy + 22);
            ctx.lineTo(cx + 10, cy + 22);
            ctx.lineTo(cx + 6, cy - 4);
            ctx.lineTo(cx - 6, cy - 4);
            ctx.closePath();
            ctx.fill();
            
            // Echoing sound waves / tears ripples
            for (let rIdx = 0; rIdx < 4; rIdx++) {
                const waveProg = (progress * 2.0 + rIdx * 0.25) % 1.0;
                const waveR = 15 + waveProg * 70;
                const waveAlpha = (1.0 - waveProg) * girlAlpha * 0.5;
                
                ctx.strokeStyle = `rgba(200, 220, 255, ${waveAlpha})`;
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(cx, cy - 10, waveR, 0, Math.PI * 2);
                ctx.stroke();
            }
            
            ctx.font = 'italic 16px Georgia, serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = `rgba(200, 200, 215, ${girlAlpha * 0.8})`;
            ctx.fillText('A small voice weeping in the deep...', cx, cy + 70);
            
        } else if (stoneId === 2) {
            // Stone 2: Man running and ceiling lines falling
            const manAlpha = clamp(Math.sin(progress * Math.PI), 0, 1);
            
            // Running figure silhouette
            ctx.fillStyle = `rgba(230, 220, 210, ${manAlpha * 0.75})`;
            ctx.beginPath();
            ctx.arc(cx - 15, cy - 10, 8, 0, Math.PI * 2); // Head leaning forward
            ctx.fill();
            
            // Body torso
            ctx.lineWidth = 4;
            ctx.strokeStyle = `rgba(230, 220, 210, ${manAlpha * 0.75})`;
            ctx.beginPath();
            ctx.moveTo(cx - 15, cy - 2);
            ctx.lineTo(cx - 5, cy + 16);
            ctx.lineTo(cx + 12, cy + 28); // Stride leg
            ctx.moveTo(cx - 5, cy + 16);
            ctx.lineTo(cx - 20, cy + 26); // Back leg
            ctx.stroke();
            
            // Falling ceiling debris lines
            ctx.strokeStyle = `rgba(180, 180, 190, ${manAlpha * 0.6})`;
            ctx.lineWidth = 1.8;
            for (let dIdx = 0; dIdx < 7; dIdx++) {
                const lineX = cx - 120 + dIdx * 40;
                const dropY = ((progress * 300 + dIdx * 65) % 180) + (cy - 100);
                ctx.beginPath();
                ctx.moveTo(lineX, dropY);
                ctx.lineTo(lineX + 8, dropY + 22);
                ctx.stroke();
            }
            
            ctx.font = 'italic 16px Georgia, serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = `rgba(215, 205, 200, ${manAlpha * 0.8})`;
            ctx.fillText('The collapse... frantic footsteps fleeing into darkness...', cx, cy + 70);
            
        } else {
            // Stone 3: Silence, a hand reaching, then nothing
            const handAlpha = clamp(Math.sin(progress * Math.PI), 0, 1);
            
            // Outstretched hand silhouette
            ctx.strokeStyle = `rgba(240, 230, 220, ${handAlpha * 0.75})`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(cx - 30, cy + 30);
            ctx.lineTo(cx - 8, cy + 2);
            ctx.lineTo(cx + 18, cy - 20); // Arm
            ctx.stroke();
            
            // Fingers
            ctx.lineWidth = 1.8;
            ctx.beginPath();
            ctx.moveTo(cx + 18, cy - 20); ctx.lineTo(cx + 28, cy - 30);
            ctx.moveTo(cx + 18, cy - 20); ctx.lineTo(cx + 30, cy - 23);
            ctx.moveTo(cx + 18, cy - 20); ctx.lineTo(cx + 26, cy - 14);
            ctx.stroke();
            
            // Faint disappearing light at fingertip
            const speck = ctx.createRadialGradient(cx + 34, cy - 28, 1, cx + 34, cy - 28, 16);
            speck.addColorStop(0.0, `rgba(255, 230, 160, ${handAlpha * 0.85})`);
            speck.addColorStop(1.0, 'rgba(255, 230, 160, 0.0)');
            ctx.fillStyle = speck;
            ctx.beginPath();
            ctx.arc(cx + 34, cy - 28, 16, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.font = 'italic 16px Georgia, serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = `rgba(220, 215, 215, ${handAlpha * 0.8})`;
            ctx.fillText('An outstretched hand... fading into cold silence...', cx, cy + 70);
        }
        
        ctx.restore();
    }
    
    // Helper: draw rounded rectangle
    drawRoundedRect(ctx, x, y, w, h, r, fill = true, stroke = false) {
        if (typeof ctx.roundRect === 'function') {
            ctx.beginPath();
            ctx.roundRect(x, y, w, h, r);
            if (fill) ctx.fill();
            if (stroke) ctx.stroke();
            return;
        }
        
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
        if (fill) ctx.fill();
        if (stroke) ctx.stroke();
    }
    
    // Helper: clip rounded rectangle
    clipRoundedRect(ctx, x, y, w, h, r) {
        if (typeof ctx.roundRect === 'function') {
            ctx.beginPath();
            ctx.roundRect(x, y, w, h, r);
            ctx.clip();
            return;
        }
        
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
        ctx.clip();
    }
}
