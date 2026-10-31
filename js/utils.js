// ============================================================
// HUSH - Utility Functions
// ============================================================

function dist(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min, max) {
    return Math.random() * (max - min) + min;
}

function tileToPixel(t) {
    return t * TILE_SIZE + TILE_SIZE / 2;
}

function pixelToTile(p) {
    return Math.floor(p / TILE_SIZE);
}

function angleToward(x1, y1, x2, y2) {
    return Math.atan2(y2 - y1, x2 - x1);
}

function normalizeAngle(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
}

function angleDiff(a, b) {
    return normalizeAngle(b - a);
}

// Smooth step for nice transitions
function smoothstep(edge0, edge1, x) {
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
}

// Check if a point is inside a rectangle
function pointInRect(px, py, rx, ry, rw, rh) {
    return px >= rx && px < rx + rw && py >= ry && py < ry + rh;
}

// Line of sight check (Bresenham-ish)
function hasLineOfSight(map, x1, y1, x2, y2) {
    const tx1 = pixelToTile(x1);
    const ty1 = pixelToTile(y1);
    const tx2 = pixelToTile(x2);
    const ty2 = pixelToTile(y2);
    
    const dx = Math.abs(tx2 - tx1);
    const dy = Math.abs(ty2 - ty1);
    const sx = tx1 < tx2 ? 1 : -1;
    const sy = ty1 < ty2 ? 1 : -1;
    let err = dx - dy;
    let cx = tx1;
    let cy = ty1;
    
    while (cx !== tx2 || cy !== ty2) {
        if (map.getTile(cx, cy) === TILE.WALL) return false;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; cx += sx; }
        if (e2 < dx) { err += dx; cy += sy; }
    }
    return true;
}

// Ease in-out for animations
function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

// Simple pseudo-random seeded generator (for consistent map generation)
class SeededRandom {
    constructor(seed) {
        this.seed = seed;
    }
    next() {
        this.seed = (this.seed * 16807 + 0) % 2147483647;
        return this.seed / 2147483647;
    }
    nextInt(min, max) {
        return Math.floor(this.next() * (max - min + 1)) + min;
    }
}

// Simple object pool for particles
class ObjectPool {
    constructor(factory, reset, maxSize = 200) {
        this.factory = factory;
        this.reset = reset;
        this.pool = [];
        this.active = [];
        this.maxSize = maxSize;
    }
    
    get() {
        let obj = this.pool.pop() || this.factory();
        this.active.push(obj);
        return obj;
    }
    
    release(obj) {
        const idx = this.active.indexOf(obj);
        if (idx >= 0) {
            this.active.splice(idx, 1);
            this.reset(obj);
            if (this.pool.length < this.maxSize) {
                this.pool.push(obj);
            }
        }
    }
    
    releaseAll() {
        while (this.active.length > 0) {
            this.release(this.active[0]);
        }
    }
}
