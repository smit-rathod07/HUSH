// ============================================================
// HUSH - Entities (Player & Listener)
// ============================================================

/**
 * Checks if a pixel position is walkable according to the map
 * @param {Object} map 
 * @param {number} px 
 * @param {number} py 
 * @returns {boolean}
 */
function isPixelWalkable(map, px, py) {
    if (!map) return true;
    
    // Bounds check
    const mapW = (map.width || MAP_WIDTH) * TILE_SIZE;
    const mapH = (map.height || MAP_HEIGHT) * TILE_SIZE;
    if (px < 0 || py < 0 || px >= mapW || py >= mapH) {
        return false;
    }
    
    // Check map methods or direct tiles
    if (typeof map.isWalkable === 'function') {
        return map.isWalkable(px, py);
    }
    
    const tx = pixelToTile(px);
    const ty = pixelToTile(py);
    if (typeof map.getTile === 'function') {
        const t = map.getTile(tx, ty);
        return t !== TILE.WALL && t !== undefined;
    }
    if (map.tiles && map.tiles[ty]) {
        const t = map.tiles[ty][tx];
        return t !== TILE.WALL && t !== undefined;
    }
    return true;
}

/**
 * Checks if a circular entity can move to a pixel position
 * @param {number} x 
 * @param {number} y 
 * @param {number} radius 
 * @param {Object} map 
 * @returns {boolean}
 */
function canEntityMoveTo(x, y, radius, map) {
    if (!map) return true;
    if (!isPixelWalkable(map, x, y)) return false;
    
    const offset = radius * 0.95;
    const diag = offset * 0.7071;
    const points = [
        [x - offset, y],
        [x + offset, y],
        [x, y - offset],
        [x, y + offset],
        [x - diag, y - diag],
        [x + diag, y - diag],
        [x - diag, y + diag],
        [x + diag, y + diag]
    ];
    
    for (let i = 0; i < points.length; i++) {
        if (!isPixelWalkable(map, points[i][0], points[i][1])) {
            return false;
        }
    }
    return true;
}

// ============================================================
// Player Class
// ============================================================

class Player {
    constructor(x, y) {
        this.x = x;                                     // pixel position
        this.y = y;
        this.angle = 0;                                 // facing direction in radians
        this.speed = PLAYER_SPEED;                      // current speed
        this.vx = 0;                                    // velocity
        this.vy = 0;
        this.isMoving = false;
        this.isRunning = false;
        this.isSneaking = false;
        
        // Flashlight
        this.flashlightOn = true;
        this.flashlightBattery = FLASHLIGHT_MAX_BATTERY; // 100
        this.flashlightAngle = 0;                        // direction flashlight points (follows mouse/angle)
        
        // Hiding
        this.isHiding = false;
        this.hideSpot = null;                            // reference to hiding spot object
        
        // Hold breath
        this.isHoldingBreath = false;
        this.breathStamina = BREATH_MAX_STAMINA;         // 100
        this.breathExhausted = false;                    // lockout flag when stamina reaches 0
        
        // Inventory
        this.inventory = [];                             // array of item objects
        this.maxInventory = 5;
        this.stonesCollected = 0;
        this.stonesPlaced = 0;                           // placed in exit machine
        this.keys = [];                                  // color-coded keys collected
        this.hasRelic = false;                           // Banishment Relic flag

        // State
        this.alive = true;
        this.escaped = false;
        this.radius = 10;                                // collision radius in pixels
        this.interactRadius = 48;                        // interaction range
        
        // Animation
        this.animTimer = 0;
        this.bobAmount = 0;                              // head bob for walking
        
        // Internal input edge tracking
        this._prevFlashlight = false;
        this._prevHide = false;
        this._prevInteract = false;
        this._prevThrow = false;
        this.currentMap = null;
    }
    
    /**
     * Update player each frame
     * @param {number} dt Delta time in seconds
     * @param {Object} input { up, down, left, right, run, sneak, mouseX, mouseY, interact, hide, breath, flashlight, throw }
     * @param {Object} map Map instance
     */
    update(dt, input, map) {
        this.currentMap = map;
        if (!this.alive) return;
        
        const safeInput = input || {};
        const safeDt = Math.min(dt || 0.016, 0.1);
        
        // 1. Mouse / Touch Aiming & Flashlight Direction
        if (safeInput.aimWorldX !== undefined && safeInput.aimWorldY !== undefined) {
            // Explicit touch aim
            this.angle = angleToward(this.x, this.y, safeInput.aimWorldX, safeInput.aimWorldY);
            this.flashlightAngle = this.angle;
        } else if (!safeInput.isTouch && safeInput.hasMouseMoved) {
            // Mouse aiming (only when mouse has actually moved, never force (0,0))
            const targetX = (typeof safeInput.mouseWorldX === 'number') ? safeInput.mouseWorldX : safeInput.mouseX;
            const targetY = (typeof safeInput.mouseWorldY === 'number') ? safeInput.mouseWorldY : safeInput.mouseY;
            if (typeof targetX === 'number' && typeof targetY === 'number' &&
                !isNaN(targetX) && !isNaN(targetY)) {
                this.angle = angleToward(this.x, this.y, targetX, targetY);
                this.flashlightAngle = this.angle;
            }
        }
        
        // 2. Flashlight Toggle & Battery Drain
        const toggleFlashlight = safeInput.flashlightJustPressed || (safeInput.flashlight && !this._prevFlashlight);
        if (toggleFlashlight) {
            if (this.flashlightOn) {
                this.flashlightOn = false;
            } else if (this.flashlightBattery > 0) {
                this.flashlightOn = true;
            }
        }
        this._prevFlashlight = !!safeInput.flashlight;
        
        if (this.flashlightOn) {
            this.flashlightBattery = Math.max(0, this.flashlightBattery - FLASHLIGHT_DRAIN_RATE * safeDt);
            if (this.flashlightBattery <= 0) {
                this.flashlightBattery = 0;
                this.flashlightOn = false;
            }
        }
        
        // 3. Hold Breath Logic
        // Space to hold breath: drains breathStamina, recovers when released
        // When stamina hits 0, forced to release and locked until stamina > 30
        if (safeInput.breath && !this.breathExhausted && this.breathStamina > 0) {
            this.isHoldingBreath = true;
            this.breathStamina = Math.max(0, this.breathStamina - BREATH_DRAIN_RATE * safeDt);
            if (this.breathStamina <= 0) {
                this.breathStamina = 0;
                this.isHoldingBreath = false;
                this.breathExhausted = true;
            }
        } else {
            this.isHoldingBreath = false;
            this.breathStamina = Math.min(BREATH_MAX_STAMINA, this.breathStamina + BREATH_RECOVER_RATE * safeDt);
            if (this.breathExhausted && this.breathStamina > 30) {
                this.breathExhausted = false;
            }
        }
        
        // 4. Hiding Toggle (H key)
        const toggleHideInput = safeInput.hideJustPressed || (safeInput.hide && !this._prevHide);
        if (toggleHideInput) {
            this.toggleHide(map);
        }
        this._prevHide = !!safeInput.hide;
        
        // 5. Interaction (E key)
        const interactInput = safeInput.interactJustPressed || (safeInput.interact && !this._prevInteract);
        if (interactInput) {
            this.interact(map);
        }
        this._prevInteract = !!safeInput.interact;
        
        // 6. Throw Item
        const throwInput = safeInput.throwJustPressed || (safeInput.throw && !this._prevThrow);
        if (throwInput) {
            this.throwItem(this.angle, map);
        }
        this._prevThrow = !!safeInput.throw;
        
        // 7. Movement & Collision
        if (this.isHiding) {
            // Movement is disabled while hiding
            this.vx = 0;
            this.vy = 0;
            this.isMoving = false;
            this.isRunning = false;
            this.isSneaking = false;
            this.bobAmount = lerp(this.bobAmount, 0, 10 * safeDt);
            return;
        }
        
        let dx = 0;
        let dy = 0;
        let analogMag = 1.0;
        
        if (typeof safeInput.moveX === 'number' && typeof safeInput.moveY === 'number' && (safeInput.moveX !== 0 || safeInput.moveY !== 0)) {
            dx = safeInput.moveX;
            dy = safeInput.moveY;
            const mag = Math.sqrt(dx * dx + dy * dy);
            if (mag > 0) {
                analogMag = Math.min(1.0, mag);
                dx /= mag;
                dy /= mag;
            }
            // If on touch and not aiming manually, rotate facing toward joystick vector
            if (safeInput.isTouch && safeInput.aimWorldX === undefined) {
                this.angle = Math.atan2(dy, dx);
                this.flashlightAngle = this.angle;
            }
        } else {
            if (safeInput.up) dy -= 1;
            if (safeInput.down) dy += 1;
            if (safeInput.left) dx -= 1;
            if (safeInput.right) dx += 1;
            if (dx !== 0 || dy !== 0) {
                const len = Math.sqrt(dx * dx + dy * dy);
                dx /= len;
                dy /= len;
            }
        }
        
        if (dx !== 0 || dy !== 0) {
            this.isMoving = true;
            
            // Speed calculation
            if (safeInput.run) {
                this.speed = PLAYER_RUN_SPEED;
                this.isRunning = true;
                this.isSneaking = false;
            } else if (safeInput.sneak) {
                this.speed = PLAYER_SNEAK_SPEED;
                this.isSneaking = true;
                this.isRunning = false;
            } else {
                this.speed = PLAYER_SPEED * analogMag;
                this.isRunning = false;
                this.isSneaking = false;
            }
            
            // Movement speed is halved when holding breath
            if (this.isHoldingBreath) {
                this.speed *= 0.5;
            }
            
            this.vx = dx * this.speed;
            this.vy = dy * this.speed;
            
            const moveX = this.vx * safeDt;
            const moveY = this.vy * safeDt;
            const newX = this.x + moveX;
            const newY = this.y + moveY;
            
            // Collision detection & wall sliding
            if (canEntityMoveTo(newX, newY, this.radius, map)) {
                this.x = newX;
                this.y = newY;
            } else {
                // Try sliding along X
                if (moveX !== 0 && canEntityMoveTo(this.x + moveX, this.y, this.radius, map)) {
                    this.x += moveX;
                }
                // Try sliding along Y
                if (moveY !== 0 && canEntityMoveTo(this.x, this.y + moveY, this.radius, map)) {
                    this.y += moveY;
                }
            }
            
            // Head bob animation
            this.animTimer += safeDt;
            this.bobAmount = Math.sin(this.animTimer * 8) * 2;
        } else {
            this.isMoving = false;
            this.isRunning = false;
            this.isSneaking = false;
            this.vx = 0;
            this.vy = 0;
            this.bobAmount = lerp(this.bobAmount, 0, 10 * safeDt);
        }
    }
    
    /**
     * Handle interaction with nearby objects (E key)
     * @param {Object} map Map instance
     * @returns {string|null}
     */
    interact(map) {
        if (!map) return null;
        
        const playerTx = pixelToTile(this.x);
        const playerTy = pixelToTile(this.y);
        const tileRange = Math.ceil(this.interactRadius / TILE_SIZE);
        
        // 1. Check nearby map items
        if (Array.isArray(map.items)) {
            for (let i = map.items.length - 1; i >= 0; i--) {
                const item = map.items[i];
                if (!item) continue;
                if (dist(this.x, this.y, item.x, item.y) <= this.interactRadius) {
                    if (this.pickupItem(item)) {
                        if (typeof map.removeItem === 'function') {
                            map.removeItem(item);
                        } else {
                            map.items.splice(i, 1);
                        }
                    }
                }
            }
        }
        
        // 2. Check nearby stones (objects array)
        if (Array.isArray(map.stones)) {
            for (let i = map.stones.length - 1; i >= 0; i--) {
                const stone = map.stones[i];
                if (!stone || stone.collected) continue;
                if (dist(this.x, this.y, stone.x, stone.y) <= this.interactRadius) {
                    stone.collected = true;
                    this.stonesCollected++;
                    if (typeof map.removeStone === 'function') {
                        map.removeStone(stone);
                    } else {
                        map.stones.splice(i, 1);
                    }
                }
            }
        }
        
        // 3. Check nearby stone tiles
        for (let dy = -tileRange; dy <= tileRange; dy++) {
            for (let dx = -tileRange; dx <= tileRange; dx++) {
                const tx = playerTx + dx;
                const ty = playerTy + dy;
                const px = tileToPixel(tx);
                const py = tileToPixel(ty);
                if (dist(this.x, this.y, px, py) <= this.interactRadius) {
                    const tile = map.getTile ? map.getTile(tx, ty) : (map.tiles && map.tiles[ty] ? map.tiles[ty][tx] : null);
                    if (tile === TILE.STONE) {
                        this.stonesCollected++;
                        if (typeof map.setTile === 'function') {
                            map.setTile(tx, ty, TILE.FLOOR);
                        } else if (map.tiles && map.tiles[ty]) {
                            map.tiles[ty][tx] = TILE.FLOOR;
                        }
                    }
                }
            }
        }
        
        // 4. Check exit machine
        let nearExit = false;
        if (map.exit && dist(this.x, this.y, map.exit.x, map.exit.y) <= this.interactRadius) {
            nearExit = true;
        } else {
            for (let dy = -tileRange; dy <= tileRange; dy++) {
                for (let dx = -tileRange; dx <= tileRange; dx++) {
                    const tx = playerTx + dx;
                    const ty = playerTy + dy;
                    const px = tileToPixel(tx);
                    const py = tileToPixel(ty);
                    if (dist(this.x, this.y, px, py) <= this.interactRadius) {
                        const tile = map.getTile ? map.getTile(tx, ty) : (map.tiles && map.tiles[ty] ? map.tiles[ty][tx] : null);
                        if (tile === TILE.EXIT) {
                            nearExit = true;
                            break;
                        }
                    }
                }
                if (nearExit) break;
            }
        }
        
        if (nearExit) {
            if (this.stonesCollected >= TOTAL_STONES) {
                this.stonesPlaced = this.stonesCollected;
                this.escaped = true;
                if (typeof map.triggerEscape === 'function') {
                    map.triggerEscape();
                } else if (typeof window !== 'undefined') {
                    if (window.gameState !== undefined) window.gameState = GAME_STATE.ESCAPED;
                    if (window.game && window.game.state !== undefined) window.game.state = GAME_STATE.ESCAPED;
                }
                return 'escaped';
            }
        }
        
        return null;
    }
    
    /**
     * Toggle hiding at nearest spot (H key)
     * @param {Object} map Map instance
     * @returns {boolean} Whether player is now hiding
     */
    toggleHide(map) {
        if (this.isHiding) {
            this.isHiding = false;
            this.hideSpot = null;
            return false;
        }
        
        let spot = null;
        if (map) {
            // Method 1: map.getNearbyHidingSpot
            if (typeof map.getNearbyHidingSpot === 'function') {
                spot = map.getNearbyHidingSpot(this.x, this.y, this.interactRadius);
            }
            
            // Method 2: map.hidingSpots array
            if (!spot && Array.isArray(map.hidingSpots)) {
                let closestD = Infinity;
                for (let i = 0; i < map.hidingSpots.length; i++) {
                    const s = map.hidingSpots[i];
                    const d = dist(this.x, this.y, s.x, s.y);
                    if (d <= this.interactRadius && d < closestD) {
                        closestD = d;
                        spot = s;
                    }
                }
            }
            
            // Method 3: TILE.HIDING_SPOT in tiles
            if (!spot) {
                const playerTx = pixelToTile(this.x);
                const playerTy = pixelToTile(this.y);
                const tileRange = Math.ceil(this.interactRadius / TILE_SIZE);
                let closestD = Infinity;
                for (let dy = -tileRange; dy <= tileRange; dy++) {
                    for (let dx = -tileRange; dx <= tileRange; dx++) {
                        const tx = playerTx + dx;
                        const ty = playerTy + dy;
                        const px = tileToPixel(tx);
                        const py = tileToPixel(ty);
                        const d = dist(this.x, this.y, px, py);
                        if (d <= this.interactRadius) {
                            const tile = map.getTile ? map.getTile(tx, ty) : (map.tiles && map.tiles[ty] ? map.tiles[ty][tx] : null);
                            if (tile === TILE.HIDING_SPOT && d < closestD) {
                                closestD = d;
                                spot = { x: px, y: py, tx, ty };
                            }
                        }
                    }
                }
            }
        }
        
        if (spot) {
            this.isHiding = true;
            this.hideSpot = spot;
            this.x = spot.x;
            this.y = spot.y;
            this.vx = 0;
            this.vy = 0;
            this.isMoving = false;
            this.isRunning = false;
            this.isSneaking = false;
            return true;
        }
        
        return false;
    }
    
    /**
     * Get base movement noise (0-1)
     * Standing: 0, Sneaking: 0.02, Walking: 0.06, Running: 0.15
     * @returns {number}
     */
    getMovementNoise() {
        if (!this.alive || !this.isMoving || this.isHiding) {
            return 0.0;
        }
        if (this.isRunning) {
            return 0.15;
        }
        if (this.isSneaking) {
            return 0.02;
        }
        return 0.06;
    }
    
    /**
     * Get stone carrying noise (0-1)
     * Base (0.02) + stonesCollected * perStone (0.03)
     * @returns {number}
     */
    getStoneNoise() {
        if (this.stonesCollected <= 0) {
            return 0.0;
        }
        return STONE_HUM_BASE + this.stonesCollected * STONE_HUM_PER_STONE;
    }
    
    /**
     * Get noise multiplier based on environment floor (Water: 2.0x, Loud Floor: 1.8x)
     * @param {Object} map Map instance
     * @returns {number}
     */
    getEnvironmentMultiplier(map) {
        const targetMap = map || this.currentMap;
        if (!targetMap) return 1.0;
        
        if (typeof targetMap.getNoiseMultiplier === 'function') {
            const m = targetMap.getNoiseMultiplier(this.x, this.y);
            if (typeof m === 'number') return m;
        }
        
        if (typeof targetMap.isWater === 'function' && targetMap.isWater(this.x, this.y)) {
            return 2.0;
        }
        if (typeof targetMap.isLoudFloor === 'function' && targetMap.isLoudFloor(this.x, this.y)) {
            return 1.8;
        }
        
        const tx = pixelToTile(this.x);
        const ty = pixelToTile(this.y);
        const tile = targetMap.getTile ? targetMap.getTile(tx, ty) : (targetMap.tiles && targetMap.tiles[ty] ? targetMap.tiles[ty][tx] : null);
        if (tile === TILE.WATER) return 2.0;
        if (tile === TILE.LOUD_FLOOR) return 1.8;
        
        return 1.0;
    }
    
    /**
     * Get environment noise added by current position
     * Returns the noise addition: movementNoise * (multiplier - 1)
     * @param {Object} map Map instance
     * @returns {number}
     */
    getEnvironmentNoise(map) {
        const targetMap = map || this.currentMap;
        if (!targetMap || !this.alive || !this.isMoving || this.isHiding) {
            return 0.0;
        }
        const baseNoise = this.getMovementNoise();
        const mult = this.getEnvironmentMultiplier(targetMap);
        return baseNoise * (mult - 1.0);
    }
    
    /**
     * Get total noise produced by player (movement * multiplier + stone hum)
     * @param {Object} map Map instance
     * @returns {number}
     */
    getTotalNoise(map) {
        const base = this.getMovementNoise();
        const env = this.getEnvironmentNoise(map);
        const stone = this.getStoneNoise();
        return base + env + stone;
    }
    
    /**
     * Pick up an item
     * @param {Object} item 
     * @returns {boolean}
     */
    pickupItem(item) {
        if (!item) return false;
        
        // Battery item immediately restores flashlight battery
        if (item.type === ITEM_TYPE.BATTERY || item.type === 'battery') {
            this.flashlightBattery = FLASHLIGHT_MAX_BATTERY;
            return true;
        }
        
        // Stone item increases collected stone count
        if (item.type === 'stone' || item.type === TILE.STONE || item.isStone) {
            this.stonesCollected++;
            return true;
        }
        
        // Key item adds to keys collection
        if (item.type === ITEM_TYPE.KEY || item.type === 'key') {
            this.keys.push(item);
            if (this.inventory.length < this.maxInventory) {
                this.inventory.push(item);
            }
            return true;
        }

        // Banishment Relic
        if (item.type === ITEM_TYPE.BANISH_RELIC || item.type === 'banish_relic') {
            this.hasRelic = true;
            if (this.inventory.length < this.maxInventory) {
                this.inventory.push(item);
            }
            return true;
        }
        
        // General inventory addition
        if (this.inventory.length < this.maxInventory) {
            this.inventory.push(item);
            return true;
        }
        
        return false;
    }

    /**
     * Use the Banishment Relic to destroy/banish the Listener.
     * @param {Listener} listener 
     * @param {Object} network 
     * @param {Object} renderer 
     * @returns {boolean} Whether the relic was used
     */
    useRelic(listener, network, renderer) {
        if (!this.hasRelic || !this.alive || this.isHiding) return false;
        this.hasRelic = false;

        // Remove from inventory
        const idx = this.inventory.findIndex(it => it && (it.type === ITEM_TYPE.BANISH_RELIC || it.type === 'banish_relic'));
        if (idx !== -1) this.inventory.splice(idx, 1);

        if (typeof window !== 'undefined' && window.audioManager) {
            window.audioManager.playSound('ghost_banish');
        }

        if (renderer && renderer.shakeScreen) {
            renderer.shakeScreen(16);
        }

        // Radiating holy blast particles
        if (renderer && renderer.addParticle) {
            for (let i = 0; i < 45; i++) {
                const ang = Math.random() * Math.PI * 2;
                const spd = randomFloat(70, 260);
                renderer.addParticle(
                    this.x, this.y,
                    Math.cos(ang) * spd, Math.sin(ang) * spd,
                    randomFloat(1.0, 2.2),
                    randomFloat(4, 8),
                    '#00ffee',
                    'spark'
                );
            }
        }

        let ghostKilled = false;
        const candidates = Array.isArray(listener) ? listener : (listener ? [listener] : []);
        let closestCandidate = null;
        let closestDist = Infinity;
        for (const g of candidates) {
            if (g && !g.isDead) {
                const d = dist(this.x, this.y, g.x, g.y);
                if (d <= 420 && d < closestDist) {
                    closestDist = d;
                    closestCandidate = g;
                }
            }
        }

        if (closestCandidate) {
            closestCandidate.banish();
            ghostKilled = true;
            if (renderer && renderer.addParticle) {
                for (let i = 0; i < 70; i++) {
                    const ang = Math.random() * Math.PI * 2;
                    const spd = randomFloat(40, 200);
                    renderer.addParticle(
                        closestCandidate.x, closestCandidate.y,
                        Math.cos(ang) * spd, Math.sin(ang) * spd,
                        randomFloat(1.2, 3.0),
                        randomFloat(5, 12),
                        '#ffffff',
                        'smoke'
                    );
                }
            }
        }

        // Broadcast to multiplayer peers
        if (network && typeof network.sendAction === 'function') {
            network.sendAction({
                type: 'RELIC_USED',
                x: this.x,
                y: this.y,
                ghostKilled: ghostKilled
            });
        }

        return true;
    }
    
    /**
     * Throw an item (throwable) toward angle
     * @param {number} angle 
     * @param {Object} map 
     * @returns {Object|null}
     */
    throwItem(angle, map) {
        const index = this.inventory.findIndex(item => item && (item.type === ITEM_TYPE.THROWABLE || item.throwable || item.type === 'throwable'));
        if (index === -1) {
            return null;
        }
        
        const item = this.inventory.splice(index, 1)[0];
        const throwDist = 160;
        let targetX = this.x + Math.cos(angle) * throwDist;
        let targetY = this.y + Math.sin(angle) * throwDist;
        
        // Raycast / step along line to stop at walls
        if (map) {
            const steps = 16;
            let lastValidX = this.x;
            let lastValidY = this.y;
            for (let i = 1; i <= steps; i++) {
                const t = i / steps;
                const checkX = this.x + Math.cos(angle) * throwDist * t;
                const checkY = this.y + Math.sin(angle) * throwDist * t;
                const tx = pixelToTile(checkX);
                const ty = pixelToTile(checkY);
                const tile = map.getTile ? map.getTile(tx, ty) : (map.tiles && map.tiles[ty] ? map.tiles[ty][tx] : null);
                if (tile === TILE.WALL) {
                    break;
                }
                lastValidX = checkX;
                lastValidY = checkY;
            }
            targetX = lastValidX;
            targetY = lastValidY;
        }
        
        const thrownObject = {
            item: item,
            startX: this.x,
            startY: this.y,
            x: targetX,
            y: targetY,
            noise: 0.75,
            timestamp: Date.now()
        };
        
        // Notify map / audio system
        if (map && typeof map.createNoise === 'function') {
            map.createNoise(targetX, targetY, 0.75);
        }
        if (typeof window !== 'undefined' && window.audioManager && typeof window.audioManager.createNoise === 'function') {
            window.audioManager.createNoise(targetX, targetY, 0.75);
        }
        
        return thrownObject;
    }
    
    /**
     * Take damage / get caught by listener
     */
    die() {
        this.alive = false;
        this.isMoving = false;
        this.isRunning = false;
        this.isSneaking = false;
        this.vx = 0;
        this.vy = 0;
        
        if (typeof window !== 'undefined') {
            if (window.gameState !== undefined) window.gameState = GAME_STATE.GAME_OVER;
            if (window.game && window.game.state !== undefined) window.game.state = GAME_STATE.GAME_OVER;
            if (window.audioManager && typeof window.audioManager.playDeath === 'function') {
                window.audioManager.playDeath();
            }
        }
    }
    
    /**
     * Optional entity rendering
     * @param {CanvasRenderingContext2D} ctx 
     */
    render(ctx) {
        if (!ctx) return;
        ctx.save();
        
        // If hiding, semi-transparent
        if (this.isHiding) {
            ctx.globalAlpha = 0.4;
        }
        
        // Draw Flashlight Cone
        if (this.flashlightOn && this.flashlightBattery > 0 && this.alive) {
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.rotate(this.flashlightAngle);
            
            const batteryRatio = this.flashlightBattery / FLASHLIGHT_MAX_BATTERY;
            const range = FLASHLIGHT_RANGE * (0.5 + 0.5 * batteryRatio);
            
            const grad = ctx.createRadialGradient(0, 0, 10, 0, 0, range);
            grad.addColorStop(0, COLORS.FLASHLIGHT_CORE || 'rgba(255, 245, 220, 0.25)');
            grad.addColorStop(0.7, COLORS.FLASHLIGHT || 'rgba(255, 245, 220, 0.12)');
            grad.addColorStop(1, 'rgba(255, 245, 220, 0)');
            
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.arc(0, 0, range, -FLASHLIGHT_ANGLE, FLASHLIGHT_ANGLE);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }
        
        // Draw Player Body
        const drawY = this.y + this.bobAmount;
        ctx.beginPath();
        ctx.arc(this.x, drawY, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.alive ? (COLORS.PLAYER || '#7799cc') : '#552222';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = COLORS.PLAYER_OUTLINE || '#99bbee';
        ctx.stroke();
        
        // Facing indicator
        if (this.alive) {
            const noseX = this.x + Math.cos(this.angle) * (this.radius + 3);
            const noseY = drawY + Math.sin(this.angle) * (this.radius + 3);
            ctx.beginPath();
            ctx.arc(noseX, noseY, 3, 0, Math.PI * 2);
            ctx.fillStyle = COLORS.PLAYER_OUTLINE || '#99bbee';
            ctx.fill();
        }
        
        ctx.restore();
    }
}

// ============================================================
// Listener Class (The Monster)
// ============================================================

class Listener {
    constructor(x, y) {
        this.x = x;                                     // pixel position
        this.y = y;
        this.angle = 0;                                 // facing direction
        this.state = LISTENER_STATE.PATROL;             // current AI state
        this.speed = LISTENER_PATROL_SPEED;
        
        // AI
        this.targetX = 0;                               // current movement target
        this.targetY = 0;
        this.path = [];                                 // A* path (array of {x,y} pixel coords)
        this.pathIndex = 0;
        this.patrolIndex = 0;                           // current patrol point index
        this.stateTimer = 0;                            // time in current state
        this.alertLevel = 0;                            // 0-1, how suspicious
        this.lastHeardX = 0;                            // last sound location
        this.lastHeardY = 0;
        this.lastHeardTime = 0;
        
        // Hunting
        this.huntTarget = null;                         // reference to player being chased
        this.huntTimer = 0;                             // ms remaining in hunt
        this.coolTimer = 0;                             // ms remaining in cool-down
        
        // Voice mimicry
        this.canMimic = false;                          // Unlocked after stone 2
        this.mimicTimer = randomFloat(15, 30);          // Cooldown between mimics
        this.mimicPhrases = [
            'Help me...', 'Over here...', 'I found it...',
            'This way...', 'Wait for me...', 'Don\'t leave me...', 
            'I hear something...', 'Come here...', 'Is anyone there?',
            'I\'m scared...'
        ];
        
        // Visual
        this.radius = 12;
        this.eyeGlow = 1.0;                             // 0-1, pulsing
        this.eyeGlowTimer = 0;
        this.headTilt = 0;                              // head tilt animation
        this.headTiltTarget = 0;
        this.visible = true;                             // for spawn/despawn animations
        
        // Ghost lifecycle state
        this.alive = true;
        this.isDead = false;
        this.isBanished = false;
        this.deathTimer = 0;

        // Timers & state tracking
        this.patrolPauseTimer = 0;
        this.investigateWaitTimer = 0;
        this.reachedInvestigateTarget = false;
        this.coolWanderTimer = 0;
        this.huntPathTimer = 0;
        this.lastMimic = null;
        this.currentMap = null;
    }

    /**
     * Banish and destroy the Listener
     */
    banish() {
        if (this.isDead) return;
        this.alive = false;
        this.isDead = true;
        this.isBanished = true;
        this.huntTimer = 0;
        this.state = LISTENER_STATE.COOL;
        if (typeof window !== 'undefined' && window.audioManager) {
            window.audioManager.playSound('ghost_banish');
            window.audioManager.stopChase();
        }
    }
    
    /**
     * Main update - called every frame
     * @param {number} dt Delta time in seconds
     * @param {Object} map Map instance
     * @param {Player} player Player instance
     * @param {number} noiseLevel 0-1 from audio manager / player
     * @param {number} noiseX Sound source X
     * @param {number} noiseY Sound source Y
     */
    update(dt, map, player, noiseLevel, noiseX, noiseY) {
        if (this.isDead) return;

        this.currentMap = map;
        const safeDt = Math.min(dt || 0.016, 0.1);
        this.stateTimer += safeDt;
        
        // Update visual animations
        this.updateAnimation(safeDt);
        
        // Voice mimicry unlock check (unlocked after stone 2)
        if (player && player.stonesCollected >= 2) {
            this.canMimic = true;
        }
        
        // Voice mimicry cooldown & triggering
        if (this.canMimic && (this.state === LISTENER_STATE.PATROL || this.state === LISTENER_STATE.COOL)) {
            this.mimicTimer -= safeDt;
            if (this.mimicTimer <= 0) {
                this.triggerMimic();
                this.mimicTimer = randomFloat(15, 30);
            }
        }
        
        // Near-blind vision check (immediately hunts if player seen)
        if (player && player.alive && this.canSeePlayer(player)) {
            if (this.state !== LISTENER_STATE.HUNT) {
                this.huntTarget = player;
                this.enterState(LISTENER_STATE.HUNT);
            }
        }
        
        // Sound detection logic
        const currentNoise = (typeof noiseLevel === 'number') ? noiseLevel : 0;
        const targetNoiseX = (typeof noiseX === 'number') ? noiseX : (player ? player.x : this.x);
        const targetNoiseY = (typeof noiseY === 'number') ? noiseY : (player ? player.y : this.y);
        const soundDist = dist(this.x, this.y, targetNoiseX, targetNoiseY);
        
        if (soundDist <= LISTENER_HEARING_RANGE) {
            if (currentNoise >= NOISE_THRESHOLDS.RED_LINE) {
                // Above RED_LINE: immediate hunt
                this.hearSound(targetNoiseX, targetNoiseY, currentNoise);
            } else if (currentNoise > 0.3) {
                // Moderate sound: investigate
                if (this.state === LISTENER_STATE.PATROL || this.state === LISTENER_STATE.COOL) {
                    this.lastHeardX = targetNoiseX;
                    this.lastHeardY = targetNoiseY;
                    this.lastHeardTime = Date.now();
                    this.alertLevel = Math.max(this.alertLevel, currentNoise);
                    this.enterState(LISTENER_STATE.INVESTIGATE);
                    this.requestPath(map, this.lastHeardX, this.lastHeardY);
                } else if (this.state === LISTENER_STATE.INVESTIGATE) {
                    // Update target and reset patience timer on new sound
                    this.lastHeardX = targetNoiseX;
                    this.lastHeardY = targetNoiseY;
                    this.lastHeardTime = Date.now();
                    this.stateTimer = 0;
                    this.reachedInvestigateTarget = false;
                    this.alertLevel = Math.max(this.alertLevel, currentNoise);
                    this.requestPath(map, targetNoiseX, targetNoiseY);
                }
            }
        }
        
        // State update
        switch (this.state) {
            case LISTENER_STATE.PATROL:
                this.updatePatrol(safeDt, map, player);
                break;
            case LISTENER_STATE.INVESTIGATE:
                this.updateInvestigate(safeDt, map);
                break;
            case LISTENER_STATE.HUNT:
                this.updateHunt(safeDt, map, player);
                break;
            case LISTENER_STATE.COOL:
                this.updateCool(safeDt, map);
                break;
        }
    }
    
    /**
     * Called when a sound is detected above the red line
     * @param {number} x Sound X coordinate
     * @param {number} y Sound Y coordinate
     * @param {number} volume Sound volume (0-1)
     */
    hearSound(x, y, volume) {
        this.lastHeardX = x;
        this.lastHeardY = y;
        this.lastHeardTime = Date.now();
        this.alertLevel = 1.0;
        this.targetX = x;
        this.targetY = y;
        this.enterState(LISTENER_STATE.HUNT);
        if (this.currentMap) {
            this.requestPath(this.currentMap, x, y);
        }
    }
    
    /**
     * State machine transitions
     * @param {number} newState LISTENER_STATE enum
     */
    enterState(newState) {
        if (this.state === newState && newState !== LISTENER_STATE.HUNT) return;
        
        this.state = newState;
        this.stateTimer = 0;
        this.path = [];
        this.pathIndex = 0;
        
        switch (newState) {
            case LISTENER_STATE.PATROL:
                this.speed = LISTENER_PATROL_SPEED;
                this.huntTarget = null;
                this.patrolPauseTimer = 0;
                break;
                
            case LISTENER_STATE.INVESTIGATE:
                this.speed = LISTENER_INVESTIGATE_SPEED;
                this.huntTarget = null;
                this.reachedInvestigateTarget = false;
                this.investigateWaitTimer = 0;
                break;
                
            case LISTENER_STATE.HUNT:
                this.speed = LISTENER_HUNT_SPEED;
                this.huntElapsed = 0;
                this.huntTimer = (typeof LISTENER_HUNT_MIN_CHASE !== 'undefined') ? LISTENER_HUNT_MIN_CHASE : 5000;
                this.huntPathTimer = 0;
                this.alertLevel = 1.0;
                if (typeof window !== 'undefined' && window.audioManager && typeof window.audioManager.startChase === 'function') {
                    window.audioManager.startChase();
                }
                break;
                
            case LISTENER_STATE.COOL:
                this.speed = LISTENER_PATROL_SPEED * 0.6;
                this.coolTimer = LISTENER_COOL_DURATION; // 5000 ms
                this.huntTarget = null;
                this.coolWanderTimer = 0;
                if (typeof window !== 'undefined' && window.audioManager && typeof window.audioManager.stopChase === 'function') {
                    window.audioManager.stopChase();
                }
                break;
        }
    }
    
    /**
     * PATROL state behavior
     * Moves slowly between patrol points, avoids room player is in, pauses 2-4s at points
     * @param {number} dt 
     * @param {Object} map 
     * @param {Player} [player]
     */
    updatePatrol(dt, map, player) {
        this.speed = LISTENER_PATROL_SPEED;
        
        if (this.patrolPauseTimer > 0) {
            this.patrolPauseTimer -= dt;
            return;
        }
        
        const points = (map && Array.isArray(map.patrolPoints) && map.patrolPoints.length > 0) ? map.patrolPoints : null;
        if (!points) {
            return;
        }
        
        // Golden Rule enforcement:
        // Patrol route should avoid the room the player is currently in if the player hasn't made noise.
        let playerRoom = null;
        let playerIsSilent = true;
        if (map && typeof map.getRoom === 'function' && player) {
            playerRoom = map.getRoom(player.x, player.y);
            if (typeof player.getMovementNoise === 'function') {
                playerIsSilent = (player.getMovementNoise() === 0);
            }
        }
        
        let pt = points[this.patrolIndex % points.length];
        if (playerRoom !== null && playerRoom !== undefined && playerIsSilent) {
            let attempts = 0;
            while (attempts < points.length) {
                const px = (pt.tx !== undefined) ? tileToPixel(pt.tx) : pt.x;
                const py = (pt.ty !== undefined) ? tileToPixel(pt.ty) : pt.y;
                const ptRoom = map.getRoom(px, py);
                if (ptRoom !== playerRoom) {
                    break;
                }
                this.patrolIndex = (this.patrolIndex + 1) % points.length;
                pt = points[this.patrolIndex];
                attempts++;
            }
        }
        
        const targetX = (pt.tx !== undefined) ? tileToPixel(pt.tx) : pt.x;
        const targetY = (pt.ty !== undefined) ? tileToPixel(pt.ty) : pt.y;
        
        const d = dist(this.x, this.y, targetX, targetY);
        if (d < 16) {
            // Reached patrol point: pause 2-4s and cycle
            this.patrolPauseTimer = randomFloat(2.0, 4.0);
            this.patrolIndex = (this.patrolIndex + 1) % points.length;
            this.path = [];
            this.pathIndex = 0;
            return;
        }
        
        // Golden Rule check for current path waypoint entering player room
        if (this.path && this.pathIndex < this.path.length && playerRoom !== null && playerRoom !== undefined && playerIsSilent) {
            const nextWp = this.path[this.pathIndex];
            if (map.getRoom(nextWp.x, nextWp.y) === playerRoom) {
                // Redirect immediately
                this.patrolIndex = (this.patrolIndex + 1) % points.length;
                this.path = [];
                this.pathIndex = 0;
                return;
            }
        }
        
        if (this.path.length === 0 || this.pathIndex >= this.path.length) {
            this.requestPath(map, targetX, targetY);
        }
        
        this.followPath(dt, LISTENER_PATROL_SPEED);
    }
    
    /**
     * INVESTIGATE state behavior - move toward last heard sound
     * @param {number} dt 
     * @param {Object} map 
     */
    updateInvestigate(dt, map) {
        this.speed = LISTENER_INVESTIGATE_SPEED;
        this.alertLevel = Math.min(1.0, this.alertLevel + 0.1 * dt);
        
        // Patience timeout check (6s)
        if (this.stateTimer * 1000 >= LISTENER_INVESTIGATE_PATIENCE) {
            this.enterState(LISTENER_STATE.COOL);
            return;
        }
        
        if (!this.reachedInvestigateTarget) {
            const d = dist(this.x, this.y, this.lastHeardX, this.lastHeardY);
            if (d < 24) {
                this.reachedInvestigateTarget = true;
                this.investigateWaitTimer = randomFloat(3.0, 5.0);
                this.path = [];
                this.pathIndex = 0;
            } else {
                if (this.path.length === 0 || this.pathIndex >= this.path.length) {
                    this.requestPath(map, this.lastHeardX, this.lastHeardY);
                }
                const isMoving = this.followPath(dt, LISTENER_INVESTIGATE_SPEED);
                if (!isMoving && this.pathIndex >= this.path.length) {
                    this.reachedInvestigateTarget = true;
                    this.investigateWaitTimer = randomFloat(3.0, 5.0);
                }
            }
        } else {
            // Reached location, wait 3-5 seconds then go to COOL
            this.investigateWaitTimer -= dt;
            if (this.investigateWaitTimer <= 0) {
                this.enterState(LISTENER_STATE.COOL);
            }
        }
    }
    
    /**
     * HUNT state behavior - chase the player
     * @param {number} dt 
     * @param {Object} map 
     * @param {Player} player 
     */
    updateHunt(dt, map, player) {
        this.speed = LISTENER_HUNT_SPEED;
        this.huntElapsed = (this.huntElapsed || 0) + dt;
        this.huntTimer -= dt * 1000;
        
        const target = this.huntTarget || player;
        if (!target || !target.alive) {
            this.enterState(LISTENER_STATE.COOL);
            return;
        }
        
        const d = this.distToPlayer(target);
        
        // Kill range check (30px)
        if (d <= 30) {
            target.die();
            this.enterState(LISTENER_STATE.COOL);
            return;
        }
        
        // Hiding check: if player is hiding AND listener > 60px away, lose track
        if (target.isHiding && d > 60) {
            this.enterState(LISTENER_STATE.COOL);
            return;
        }

        // 5-second chase rule:
        // Follows the player for at least 5 seconds.
        // After 5 seconds, if the player's location is far away (> 180px, ~6 tiles), he stops chasing!
        if (this.huntElapsed >= 5.0) {
            const escapeDist = (typeof LISTENER_HUNT_ESCAPE_DIST !== 'undefined') ? LISTENER_HUNT_ESCAPE_DIST : 180;
            if (d > escapeDist) {
                this.enterState(LISTENER_STATE.COOL);
                return;
            }
            // Maximum chase ceiling if player stays very close (10s)
            if (this.huntElapsed >= 10.0) {
                this.enterState(LISTENER_STATE.COOL);
                return;
            }
        }
        
        // Update path to player every 0.5 seconds
        this.huntPathTimer += dt;
        if (this.huntPathTimer >= 0.5 || this.path.length === 0 || this.pathIndex >= this.path.length) {
            this.huntPathTimer = 0;
            this.requestPath(map, target.x, target.y);
        }
        
        this.followPath(dt, LISTENER_HUNT_SPEED);
        
        // Direct facing when close
        if (d < 120) {
            this.angle = angleToward(this.x, this.y, target.x, target.y);
        }
    }
    
    /**
     * COOL state behavior - slow down, stay alert, wander locally
     * @param {number} dt 
     * @param {Object} map 
     */
    updateCool(dt, map) {
        this.speed = LISTENER_PATROL_SPEED * 0.6;
        this.coolTimer -= dt * 1000;
        this.alertLevel = Math.max(0, this.alertLevel - 0.2 * dt);
        
        if (this.coolTimer <= 0) {
            this.enterState(LISTENER_STATE.PATROL);
            return;
        }
        
        this.coolWanderTimer -= dt;
        if (this.coolWanderTimer <= 0) {
            this.coolWanderTimer = randomFloat(2.0, 3.5);
            const wanderAngle = randomFloat(0, Math.PI * 2);
            const wanderDist = randomFloat(30, 80);
            const wx = this.x + Math.cos(wanderAngle) * wanderDist;
            const wy = this.y + Math.sin(wanderAngle) * wanderDist;
            this.requestPath(map, wx, wy);
        }
        
        this.followPath(dt, this.speed);
    }
    
    /**
     * Move along the current A* path
     * @param {number} dt 
     * @param {number} speed 
     * @returns {boolean} Whether moving
     */
    followPath(dt, speed) {
        if (!this.path || this.path.length === 0 || this.pathIndex >= this.path.length) {
            return false;
        }
        
        let targetNode = this.path[this.pathIndex];
        let d = dist(this.x, this.y, targetNode.x, targetNode.y);
        
        // Advance waypoint if close enough (< 8px)
        while (d < 8 && this.pathIndex < this.path.length - 1) {
            this.pathIndex++;
            targetNode = this.path[this.pathIndex];
            d = dist(this.x, this.y, targetNode.x, targetNode.y);
        }
        
        if (d < 8 && this.pathIndex >= this.path.length - 1) {
            this.x = targetNode.x;
            this.y = targetNode.y;
            this.pathIndex = this.path.length;
            return false;
        }
        
        const angle = angleToward(this.x, this.y, targetNode.x, targetNode.y);
        this.angle = angle;
        const moveDist = Math.min(d, speed * dt);
        this.x += Math.cos(angle) * moveDist;
        this.y += Math.sin(angle) * moveDist;
        return true;
    }
    
    /**
     * Request a new path from current position to target
     * @param {Object} map 
     * @param {number} targetX 
     * @param {number} targetY 
     */
    requestPath(map, targetX, targetY) {
        this.targetX = targetX;
        this.targetY = targetY;
        this.path = [];
        this.pathIndex = 0;
        
        if (!map || typeof map.findPath !== 'function') {
            this.path = [{ x: targetX, y: targetY }];
            return;
        }
        
        const startTx = pixelToTile(this.x);
        const startTy = pixelToTile(this.y);
        const endTx = pixelToTile(targetX);
        const endTy = pixelToTile(targetY);
        
        const rawPath = map.findPath(startTx, startTy, endTx, endTy);
        if (Array.isArray(rawPath) && rawPath.length > 0) {
            this.path = rawPath.map(node => {
                if (node.tx !== undefined && node.ty !== undefined) {
                    return { x: tileToPixel(node.tx), y: tileToPixel(node.ty) };
                }
                if (node.x !== undefined && node.y !== undefined) {
                    const isTileCoord = node.x < 100 && node.y < 100 && (!map.width || node.x < map.width);
                    if (isTileCoord) {
                        return { x: tileToPixel(node.x), y: tileToPixel(node.y) };
                    }
                    return { x: node.x, y: node.y };
                }
                return { x: targetX, y: targetY };
            });
            
            // Advance past first waypoint if listener is already on it
            if (this.path.length > 1 && dist(this.x, this.y, this.path[0].x, this.path[0].y) < 16) {
                this.pathIndex = 1;
            } else {
                this.pathIndex = 0;
            }
        } else {
            this.path = [{ x: targetX, y: targetY }];
            this.pathIndex = 0;
        }
    }
    
    /**
     * Check if listener can see the player (very short range: 80px)
     * @param {Player} player 
     * @param {Object} [map]
     * @returns {boolean}
     */
    canSeePlayer(player, map) {
        if (!player || !player.alive || player.isHiding) {
            return false;
        }
        const d = dist(this.x, this.y, player.x, player.y);
        if (d > LISTENER_NEAR_BLIND_RANGE) {
            return false;
        }
        
        const currentMap = map || this.currentMap;
        if (currentMap && typeof hasLineOfSight === 'function') {
            if (!hasLineOfSight(currentMap, this.x, this.y, player.x, player.y)) {
                return false;
            }
        }
        return true;
    }
    
    /**
     * Get distance to player
     * @param {Player} player 
     * @returns {number}
     */
    distToPlayer(player) {
        if (!player) return Infinity;
        return dist(this.x, this.y, player.x, player.y);
    }
    
    /**
     * Trigger voice mimicry phrase
     */
    triggerMimic() {
        const phrase = this.mimicPhrases[randomInt(0, this.mimicPhrases.length - 1)];
        const angle = randomFloat(0, Math.PI * 2);
        const offsetDist = randomFloat(120, 240);
        const mimicX = this.x + Math.cos(angle) * offsetDist;
        const mimicY = this.y + Math.sin(angle) * offsetDist;
        
        this.lastMimic = {
            phrase: phrase,
            x: mimicX,
            y: mimicY,
            time: Date.now()
        };
        
        if (typeof window !== 'undefined') {
            if (window.audioManager && typeof window.audioManager.playMimic === 'function') {
                window.audioManager.playMimic(phrase, mimicX, mimicY);
            }
            if (window.dispatchEvent && typeof CustomEvent === 'function') {
                window.dispatchEvent(new CustomEvent('listenerMimic', {
                    detail: { phrase: phrase, x: mimicX, y: mimicY }
                }));
            }
        }
    }
    
    /**
     * Update visual animations (head tilt, eye glow)
     * @param {number} dt 
     */
    updateAnimation(dt) {
        if (this.state === LISTENER_STATE.HUNT) {
            this.eyeGlowTimer += dt * 6;
            this.eyeGlow = clamp(Math.sin(this.eyeGlowTimer) * 0.2 + 0.9, 0.7, 1.2);
            this.headTiltTarget = 0;
        } else if (this.state === LISTENER_STATE.PATROL) {
            this.eyeGlowTimer += dt * 2;
            this.eyeGlow = clamp(Math.sin(this.eyeGlowTimer * 2) * 0.3 + 0.7, 0.3, 1.0);
            this.headTiltTarget = Math.sin(this.stateTimer * 2) * 0.35;
        } else if (this.state === LISTENER_STATE.INVESTIGATE) {
            this.eyeGlowTimer += dt * 3;
            this.eyeGlow = clamp(Math.sin(this.eyeGlowTimer * 2.5) * 0.3 + 0.7, 0.3, 1.0);
            this.headTiltTarget = Math.sin(this.stateTimer * 3.5) * 0.45;
        } else if (this.state === LISTENER_STATE.COOL) {
            this.eyeGlowTimer += dt * 1.5;
            this.eyeGlow = clamp(Math.sin(this.eyeGlowTimer * 1.5) * 0.2 + 0.6, 0.2, 0.8);
            this.headTiltTarget = Math.sin(this.stateTimer * 1.5) * 0.2;
        }
        
        this.headTilt = lerp(this.headTilt, this.headTiltTarget, Math.min(1.0, 6 * dt));
    }
    
    /**
     * Reposition the listener far from the player (used on spawn)
     * @param {Object} map 
     * @param {Player} player 
     */
    repositionFarFrom(map, player) {
        if (!map || !player) return;
        if (Array.isArray(map.patrolPoints) && map.patrolPoints.length > 0) {
            let bestPt = map.patrolPoints[0];
            let maxD = -1;
            for (let i = 0; i < map.patrolPoints.length; i++) {
                const pt = map.patrolPoints[i];
                const px = (pt.tx !== undefined) ? tileToPixel(pt.tx) : pt.x;
                const py = (pt.ty !== undefined) ? tileToPixel(pt.ty) : pt.y;
                const d = dist(player.x, player.y, px, py);
                if (d > maxD) {
                    maxD = d;
                    bestPt = pt;
                }
            }
            this.x = (bestPt.tx !== undefined) ? tileToPixel(bestPt.tx) : bestPt.x;
            this.y = (bestPt.ty !== undefined) ? tileToPixel(bestPt.ty) : bestPt.y;
        }
    }
    
    /**
     * Optional entity rendering
     * @param {CanvasRenderingContext2D} ctx 
     */
    render(ctx) {
        if (!ctx || !this.visible || this.isDead) return;
        
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle + this.headTilt);
        
        // Body (Doll-like creature)
        ctx.beginPath();
        ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.LISTENER_BODY || '#f0e0d0';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#332222';
        ctx.stroke();
        
        // Head stitching / markings
        ctx.beginPath();
        ctx.moveTo(-6, -4);
        ctx.lineTo(6, -4);
        ctx.strokeStyle = 'rgba(60, 40, 40, 0.4)';
        ctx.lineWidth = 1;
        ctx.stroke();
        
        // Red glowing eyes
        const eyeOffsetX = 4;
        const eyeOffsetY = -4;
        const eyeRadius = 2.5;
        
        // Left Eye Glow
        const glowRadius = 8 * this.eyeGlow;
        const eyeGlowGrad1 = ctx.createRadialGradient(-eyeOffsetX, eyeOffsetY, 1, -eyeOffsetX, eyeOffsetY, glowRadius);
        eyeGlowGrad1.addColorStop(0, COLORS.LISTENER_EYE || '#ff2222');
        eyeGlowGrad1.addColorStop(0.5, COLORS.LISTENER_EYE_GLOW || 'rgba(255, 34, 34, 0.4)');
        eyeGlowGrad1.addColorStop(1, 'rgba(255, 34, 34, 0)');
        
        ctx.fillStyle = eyeGlowGrad1;
        ctx.beginPath();
        ctx.arc(-eyeOffsetX, eyeOffsetY, glowRadius, 0, Math.PI * 2);
        ctx.fill();
        
        // Right Eye Glow
        const eyeGlowGrad2 = ctx.createRadialGradient(eyeOffsetX, eyeOffsetY, 1, eyeOffsetX, eyeOffsetY, glowRadius);
        eyeGlowGrad2.addColorStop(0, COLORS.LISTENER_EYE || '#ff2222');
        eyeGlowGrad2.addColorStop(0.5, COLORS.LISTENER_EYE_GLOW || 'rgba(255, 34, 34, 0.4)');
        eyeGlowGrad2.addColorStop(1, 'rgba(255, 34, 34, 0)');
        
        ctx.fillStyle = eyeGlowGrad2;
        ctx.beginPath();
        ctx.arc(eyeOffsetX, eyeOffsetY, glowRadius, 0, Math.PI * 2);
        ctx.fill();
        
        // Eye Cores
        ctx.fillStyle = COLORS.LISTENER_EYE || '#ff2222';
        ctx.beginPath();
        ctx.arc(-eyeOffsetX, eyeOffsetY, eyeRadius, 0, Math.PI * 2);
        ctx.arc(eyeOffsetX, eyeOffsetY, eyeRadius, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.restore();
    }
}

// Ensure classes are globally accessible
if (typeof window !== 'undefined') {
    window.Player = Player;
    window.Listener = Listener;
}
if (typeof globalThis !== 'undefined') {
    globalThis.Player = Player;
    globalThis.Listener = Listener;
}
