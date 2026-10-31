// ============================================================
// HUSH - Game Map Generator & Manager
// ============================================================
// Generates and manages the 2D tile-based underground horror facility.
// Features 7 distinct zones, short patrolled corridors, winding quiet
// tunnels, memory stones, hiding spots, items, and A* pathfinding.

class MapPriorityQueue {
    constructor() {
        this.heap = [];
    }

    push(item) {
        this.heap.push(item);
        this._bubbleUp(this.heap.length - 1);
    }

    pop() {
        if (this.heap.length === 0) return null;
        const top = this.heap[0];
        const bottom = this.heap.pop();
        if (this.heap.length > 0) {
            this.heap[0] = bottom;
            this._sinkDown(0);
        }
        return top;
    }

    size() {
        return this.heap.length;
    }

    isEmpty() {
        return this.heap.length === 0;
    }

    _bubbleUp(idx) {
        const item = this.heap[idx];
        while (idx > 0) {
            const pIdx = (idx - 1) >> 1;
            const parent = this.heap[pIdx];
            if (item.f >= parent.f) break;
            this.heap[idx] = parent;
            idx = pIdx;
        }
        this.heap[idx] = item;
    }

    _sinkDown(idx) {
        const len = this.heap.length;
        const item = this.heap[idx];
        while (true) {
            const leftIdx = (idx << 1) + 1;
            const rightIdx = leftIdx + 1;
            let swapIdx = null;

            if (leftIdx < len) {
                if (this.heap[leftIdx].f < item.f) {
                    swapIdx = leftIdx;
                }
            }
            if (rightIdx < len) {
                const target = swapIdx === null ? item : this.heap[leftIdx];
                if (this.heap[rightIdx].f < target.f) {
                    swapIdx = rightIdx;
                }
            }
            if (swapIdx === null) break;
            this.heap[idx] = this.heap[swapIdx];
            idx = swapIdx;
        }
        this.heap[idx] = item;
    }
}

class GameMap {
    constructor() {
        this.width = MAP_WIDTH;   // 60
        this.height = MAP_HEIGHT; // 50
        this.tiles = [];          // 2D array [y][x] of TILE values
        this.rooms = [];          // Array of {x, y, w, h, type, name} objects (tile coords)
        this.items = [];          // Array of {x, y, type, id, collected, data} objects (pixel coords)
        this.stones = [];         // Array of {x, y, collected, id} objects (pixel coords)
        this.relic = null;        // Banishment Relic {x, y, collected, id}
        this.hidingSpots = [];    // Array of {x, y, occupied} objects (pixel coords)
        this.patrolPoints = [];   // Array of {x, y} for Listener patrol route (pixel coords)
        this.startPos = { x: 0, y: 0 };   // Player start position in pixel coords
        this.exitPos = { x: 0, y: 0 };    // Exit position in pixel coords
        this.listenerStartPos = { x: 0, y: 0 }; // Where the Listener starts (pixel coords)
        this.pathCache = new Map();
        this._itemIdCounter = 1;

        this.generate();
    }

    // ------------------------------------------------------------
    // Generation
    // ------------------------------------------------------------

    generate() {
        this.tiles = [];
        this.rooms = [];
        this.items = [];
        this.stones = [];
        this.relic = null;
        this.hidingSpots = [];
        this.patrolPoints = [];
        this.pathCache.clear();
        this._itemIdCounter = 1;

        // 1. Initialize entire map to solid WALL
        for (let y = 0; y < this.height; y++) {
            const row = new Array(this.width).fill(TILE.WALL);
            this.tiles.push(row);
        }

        // 2. Carve Zones & Architecture
        this._carveExitChamber();
        this._carveFloodedBasement();
        this._carveOfficeFloor();
        this._carveToiletPitAndSecretTunnels();
        this._carveHostelCorridors();
        this._carveHospitalWing();
        this._carveStationHall();

        // 3. Carve Connecting Corridors (Short Way & Quiet Ways)
        this._carveCorridors();

        // 4. Place Key Entities & Objectives
        this._setupStones();
        this._setupHidingSpots();
        this._setupItems();
        this._setupPatrolRoute();

        // 5. Positions
        this.startPos = {
            x: tileToPixel(30),
            y: tileToPixel(45)
        };

        this.exitPos = {
            x: tileToPixel(29),
            y: tileToPixel(2)
        };

        this.listenerStartPos = {
            x: tileToPixel(30),
            y: tileToPixel(25)
        };
    }

    // ------------------------------------------------------------
    // Room Carving Methods
    // ------------------------------------------------------------

    _carveExitChamber() {
        // Exit Chamber at top center (x: 25, y: 1, w: 10, h: 4)
        const rx = 25, ry = 1, rw = 10, rh = 4;
        this._fillRect(rx, ry, rw, rh, TILE.FLOOR);

        // Place exit tiles at the north back wall
        this.tiles[1][28] = TILE.EXIT;
        this.tiles[1][29] = TILE.EXIT;
        this.tiles[1][30] = TILE.EXIT;
        this.tiles[1][31] = TILE.EXIT;

        this.rooms.push({
            x: rx,
            y: ry,
            w: rw,
            h: rh,
            type: 'exit',
            name: 'Exit Chamber'
        });
    }

    _carveFloodedBasement() {
        // Flooded Basement (x: 2, y: 2, w: 16, h: 12)
        // Submerged under dark water. High noise footprint.
        const rx = 2, ry = 2, rw = 16, rh = 12;
        this._fillRect(rx, ry, rw, rh, TILE.WATER);

        // Submerged pump machinery and support pillars (cover walls)
        this._fillRect(5, 4, 2, 2, TILE.WALL);
        this._fillRect(5, 9, 2, 2, TILE.WALL);
        this._fillRect(11, 4, 2, 2, TILE.WALL);
        this._fillRect(11, 9, 2, 2, TILE.WALL);

        // Elevated dry walkway along the top right of the basement
        this._fillRect(14, 2, 3, 4, TILE.FLOOR);

        this.rooms.push({
            x: rx,
            y: ry,
            w: rw,
            h: rh,
            type: 'basement',
            name: 'Flooded Basement'
        });
    }

    _carveOfficeFloor() {
        // Office Floor (x: 21, y: 5, w: 18, h: 12)
        // Filled with creaky floorboards that create high noise.
        const rx = 21, ry = 5, rw = 18, rh = 12;
        this._fillRect(rx, ry, rw, rh, TILE.LOUD_FLOOR);

        // Executive Office in Northwest corner
        this._drawHLine(21, 26, 8, TILE.WALL);
        this._drawVLine(5, 8, 26, TILE.WALL);
        this.tiles[8][24] = TILE.DOOR; // Executive office entrance

        // Server Room in Northeast corner
        this._drawHLine(33, 38, 8, TILE.WALL);
        this._drawVLine(5, 8, 33, TILE.WALL);
        this.tiles[8][35] = TILE.DOOR; // Server room entrance

        // Central cubicle partition barriers (creating cover & stealth lanes)
        this._drawHLine(23, 26, 11, TILE.WALL);
        this._drawHLine(33, 36, 11, TILE.WALL);
        this._drawHLine(23, 26, 14, TILE.WALL);
        this._drawHLine(33, 36, 14, TILE.WALL);

        this.rooms.push({
            x: rx,
            y: ry,
            w: rw,
            h: rh,
            type: 'office',
            name: 'Office Floor'
        });
    }

    _carveToiletPitAndSecretTunnels() {
        // Toilet Pit Restroom & Secret Maintenance Tunnels (x: 41, y: 2, w: 17, h: 13)
        const rx = 41, ry = 2, rw = 17, rh = 13;

        // West side: Decrepit Washroom / Toilet Pit (Floor tiles)
        this._fillRect(41, 7, 7, 8, TILE.FLOOR);
        // Stall partition dividers
        this._drawHLine(43, 46, 9, TILE.WALL);
        this._drawHLine(43, 46, 12, TILE.WALL);

        // Wall between restroom and tunnels with cracked breach at (47, 10)
        this._drawVLine(7, 14, 47, TILE.WALL);
        this.tiles[10][47] = TILE.FLOOR; // Cracked wall gap

        // East side: Secret Tunnels (Sound dampening tunnel tiles)
        // Upper maintenance tunnel loop and pedestal chamber
        this._fillRect(48, 2, 9, 5, TILE.TUNNEL);
        this._fillRect(50, 3, 5, 1, TILE.WALL); // Central rock pillar inside tunnel chamber

        // Connecting tunnel passages
        this._fillRect(48, 7, 2, 4, TILE.TUNNEL);
        this._fillRect(52, 7, 5, 2, TILE.TUNNEL);
        this._fillRect(54, 9, 3, 5, TILE.TUNNEL);
        this._fillRect(50, 11, 4, 2, TILE.TUNNEL);

        this.rooms.push({
            x: rx,
            y: ry,
            w: rw,
            h: rh,
            type: 'tunnels',
            name: 'Secret Tunnels'
        });
    }

    _carveHostelCorridors() {
        // Hostel Corridors (x: 2, y: 18, w: 18, h: 14)
        // Long hallways with numbered rooms (3x3 or 4x3) branching off
        const rx = 2, ry = 18, rw = 18, rh = 14;

        // Central Hostel Hallway (2 tiles wide)
        this._fillRect(10, 18, 2, 14, TILE.FLOOR);

        // West wall of hallway with doors
        this._drawVLine(18, 31, 9, TILE.WALL);
        // East wall of hallway with doors
        this._drawVLine(18, 31, 12, TILE.WALL);

        // Room 101 (Northwest)
        this._fillRect(2, 18, 7, 4, TILE.FLOOR);
        this._drawHLine(2, 9, 21, TILE.WALL);
        this.tiles[20][9] = TILE.DOOR;
        this.tiles[19][4] = TILE.WALL; // Bed obstacle

        // Room 102 (Middle-west)
        this._fillRect(2, 22, 7, 4, TILE.FLOOR);
        this._drawHLine(2, 9, 25, TILE.WALL);
        this.tiles[23][9] = TILE.DOOR;
        this.tiles[23][4] = TILE.WALL; // Bed obstacle

        // Room 103 (Southwest)
        this._fillRect(2, 26, 7, 5, TILE.FLOOR);
        this.tiles[28][9] = TILE.DOOR;
        this.tiles[28][4] = TILE.WALL; // Bed obstacle

        // Room 104 (Northeast)
        this._fillRect(13, 18, 6, 4, TILE.FLOOR);
        this._drawHLine(12, 19, 21, TILE.WALL);
        this.tiles[19][12] = TILE.DOOR;
        this.tiles[19][16] = TILE.WALL; // Bed obstacle

        // Common Lounge (Middle-east)
        this._fillRect(13, 22, 6, 5, TILE.FLOOR);
        this._drawHLine(12, 19, 26, TILE.WALL);
        this.tiles[24][12] = TILE.DOOR;
        this._fillRect(15, 23, 2, 1, TILE.WALL); // Coffee table / seating obstacle

        // Shared Bathroom Stalls (Southeast)
        this._fillRect(13, 27, 6, 5, TILE.FLOOR);
        this.tiles[29][12] = TILE.DOOR;
        this._drawHLine(14, 17, 29, TILE.WALL); // Stall divider

        this.rooms.push({
            x: rx,
            y: ry,
            w: rw,
            h: rh,
            type: 'hostel',
            name: 'Hostel Corridors'
        });
    }

    _carveHospitalWing() {
        // Hospital Wing (x: 40, y: 18, w: 18, h: 14)
        // Medical wards with bed obstacles, pharmacy, and morgue
        const rx = 40, ry = 18, rw = 18, rh = 14;

        // Main access aisle
        this._fillRect(40, 18, 3, 14, TILE.FLOOR);

        // Ward A (Northwest open ward)
        this._fillRect(43, 18, 6, 6, TILE.FLOOR);
        // Gurneys / hospital bed obstacles
        this._fillRect(44, 19, 2, 1, TILE.WALL);
        this._fillRect(44, 22, 2, 1, TILE.WALL);

        // Ward B (Southwest open ward)
        this._fillRect(43, 25, 6, 7, TILE.FLOOR);
        // Dividing wall between wards
        this._drawHLine(43, 49, 24, TILE.WALL);
        // Gurneys / hospital bed obstacles
        this._fillRect(44, 27, 2, 1, TILE.WALL);
        this._fillRect(44, 30, 2, 1, TILE.WALL);

        // East partition wall
        this._drawVLine(18, 31, 49, TILE.WALL);

        // Pharmacy (Northeast)
        this._fillRect(50, 18, 8, 6, TILE.FLOOR);
        this.tiles[21][49] = TILE.DOOR;
        this._fillRect(52, 21, 3, 1, TILE.WALL); // Dispensing counter

        // Dividing wall between Pharmacy and Morgue
        this._drawHLine(49, 57, 24, TILE.WALL);

        // Morgue (Southeast)
        this._fillRect(50, 25, 8, 7, TILE.FLOOR);
        this.tiles[27][49] = TILE.DOOR;
        this._fillRect(52, 27, 3, 2, TILE.WALL); // Autopsy slab

        this.rooms.push({
            x: rx,
            y: ry,
            w: rw,
            h: rh,
            type: 'hospital',
            name: 'Hospital Wing'
        });
    }

    _carveStationHall() {
        // Station Hall (x: 18, y: 35, w: 24, h: 12)
        // Grand open subterranean station with pillars and ticket booths
        const rx = 18, ry = 35, rw = 24, rh = 12;
        this._fillRect(rx, ry, rw, rh, TILE.FLOOR);

        // Architectural support pillars (providing cover against sightlines)
        this._fillRect(22, 37, 2, 2, TILE.WALL);
        this._fillRect(36, 37, 2, 2, TILE.WALL);
        this._fillRect(22, 43, 2, 2, TILE.WALL);
        this._fillRect(36, 43, 2, 2, TILE.WALL);

        // Ticket Counter / Booth (West side)
        this._drawHLine(20, 25, 39, TILE.WALL);
        this._drawVLine(39, 41, 20, TILE.WALL);
        this._drawVLine(39, 41, 25, TILE.WALL);
        this.tiles[41][22] = TILE.DOOR; // Ticket booth door

        // Turnstiles barrier line with gaps
        this._drawHLine(26, 33, 41, TILE.WALL);
        this.tiles[41][28] = TILE.FLOOR; // Turnstile passage 1
        this.tiles[41][30] = TILE.FLOOR; // Turnstile passage 2
        this.tiles[41][32] = TILE.FLOOR; // Turnstile passage 3

        // Station Maintenance Booth (Southeast corner)
        this._drawHLine(35, 41, 42, TILE.WALL);
        this._drawVLine(42, 46, 35, TILE.WALL);
        this.tiles[44][35] = TILE.DOOR;

        this.rooms.push({
            x: rx,
            y: ry,
            w: rw,
            h: rh,
            type: 'station',
            name: 'Station Hall'
        });
    }

    // ------------------------------------------------------------
    // Corridors Carving (The Short Way vs The Quiet Way)
    // ------------------------------------------------------------

    _carveCorridors() {
        // ========================================================
        // 1. THE SHORT WAY (Direct arterial route patrolled by Listener)
        // ========================================================

        // Central Vertical Corridor: Station Hall (y:35) -> Office Floor (y:16)
        // 3 tiles wide (x: 29..31)
        this._fillRect(29, 16, 3, 20, TILE.FLOOR);

        // Central Crossway at y: 24..25
        // West arm: connects to Hostel central hallway (x: 11)
        this._fillRect(11, 24, 18, 2, TILE.FLOOR);
        // East arm: connects to Hospital aisle (x: 40)
        this._fillRect(32, 24, 9, 2, TILE.FLOOR);

        // Office Floor North Entrance -> Exit Chamber
        this._fillRect(28, 4, 4, 2, TILE.DOOR);

        // Office Floor to Flooded Basement short corridor (y: 8..9)
        this._fillRect(17, 8, 4, 2, TILE.FLOOR);

        // Office Floor to Toilet Pit / Secret Tunnels short corridor (y: 8..9)
        this._fillRect(38, 8, 4, 2, TILE.FLOOR);

        this.rooms.push({
            x: 28,
            y: 16,
            w: 5,
            h: 19,
            type: 'corridor',
            name: 'Central Junction'
        });

        // ========================================================
        // 2. THE QUIET WAYS (Winding, safe, unpatrolled routes)
        // ========================================================

        // --- Quiet Way West: Station Hall to Hostel Corridors ---
        // Doorway from Station Hall west wall
        this._fillRect(16, 43, 3, 2, TILE.FLOOR);
        // Horizontal passage going west
        this._fillRect(5, 43, 12, 2, TILE.FLOOR);
        // Utility alcove along the passage
        this._fillRect(5, 39, 4, 4, TILE.FLOOR);
        // Vertical passage heading north along western perimeter
        this._fillRect(5, 31, 2, 13, TILE.FLOOR);
        // Connecting into bottom of Hostel hallway
        this._fillRect(6, 31, 5, 2, TILE.FLOOR);

        this.rooms.push({
            x: 4,
            y: 31,
            w: 13,
            h: 14,
            type: 'corridor',
            name: 'Western Service Tunnel'
        });

        // --- Quiet Way East: Station Hall to Hospital Wing ---
        // Doorway from Station Hall east wall
        this._fillRect(41, 43, 3, 2, TILE.FLOOR);
        // Horizontal passage going east
        this._fillRect(43, 43, 11, 2, TILE.FLOOR);
        // Boiler & Generator alcove
        this._fillRect(50, 39, 4, 4, TILE.FLOOR);
        // Vertical passage heading north along eastern perimeter
        this._fillRect(52, 31, 2, 13, TILE.FLOOR);
        // Connecting into Hospital aisle
        this._fillRect(42, 31, 11, 2, TILE.FLOOR);

        this.rooms.push({
            x: 43,
            y: 31,
            w: 13,
            h: 14,
            type: 'corridor',
            name: 'Eastern Maintenance Conduit'
        });

        // --- Quiet Way Northwest: Hostel Corridors to Flooded Basement ---
        // Stairwell corridor from top of Hostel (x: 6..8, y: 13..18)
        this._fillRect(6, 13, 3, 6, TILE.FLOOR);
        this._fillRect(6, 17, 5, 2, TILE.FLOOR); // connection to Hostel hallway

        // --- Quiet Way Northeast: Hospital Wing to Secret Tunnels ---
        // Old laundry shaft made of sound-dampening tunnel tiles
        this._fillRect(52, 13, 3, 6, TILE.TUNNEL);

        // --- Quiet Exit Crawlways (Bypassing loud Office Floor entirely!) ---
        // Crawlway 1: Flooded Basement dry walkway (x: 16) directly to Exit Chamber (x: 25)
        this._fillRect(16, 2, 10, 2, TILE.TUNNEL);

        // Crawlway 2: Secret Tunnels top chamber (x: 48) directly to Exit Chamber (x: 34)
        this._fillRect(34, 2, 14, 2, TILE.TUNNEL);
    }

    // ------------------------------------------------------------
    // Objectives: Memory Stones
    // ------------------------------------------------------------

    _setupStones() {
        // Stone 1: Flooded Basement (Water Stone)
        this._addStone(8, 7, 1);

        // Stone 2: Office Floor (Hollow Stone)
        this._addStone(29, 10, 2);

        // Stone 3: Secret Tunnels (Echoing Stone)
        this._addStone(53, 5, 3);
    }

    // ------------------------------------------------------------
    // Hiding Spots
    // ------------------------------------------------------------

    _setupHidingSpots() {
        // Station Hall
        this._addHidingSpot(21, 40); // Behind ticket counter
        this._addHidingSpot(39, 44); // Station maintenance booth
        this._addHidingSpot(35, 36); // Passenger bench alcove

        // Western Service Tunnel (Quiet Way)
        this._addHidingSpot(6, 40);  // Service alcove locker

        // Eastern Maintenance Conduit (Quiet Way)
        this._addHidingSpot(53, 40); // Boiler room nook

        // Hostel Corridors
        this._addHidingSpot(3, 19);  // Room 101 wardrobe
        this._addHidingSpot(3, 23);  // Room 102 under bed
        this._addHidingSpot(3, 27);  // Room 103 wardrobe
        this._addHidingSpot(18, 19); // Room 104 under bed
        this._addHidingSpot(17, 30); // Bathroom stall

        // Hospital Wing
        this._addHidingSpot(47, 19); // Ward A curtained cubicle
        this._addHidingSpot(47, 31); // Ward B curtained cubicle
        this._addHidingSpot(56, 19); // Pharmacy supply cabinet
        this._addHidingSpot(56, 29); // Morgue cold storage drawer

        // Flooded Basement
        this._addHidingSpot(15, 3);  // Elevated walkway steel locker
        this._addHidingSpot(3, 11);  // Sump pump control alcove
        this._addHidingSpot(14, 12); // Drainage pipe nook

        // Office Floor
        this._addHidingSpot(22, 6);  // Executive wardrobe
        this._addHidingSpot(37, 6);  // Server rack cabinet
        this._addHidingSpot(24, 13); // Cubicle under-desk
        this._addHidingSpot(35, 13); // Filing room closet

        // Toilet Pit & Secret Tunnels
        this._addHidingSpot(45, 9);  // Restroom stall
        this._addHidingSpot(55, 3);  // Crawlspace nook
        this._addHidingSpot(51, 10); // Pipe junction recess
        this._addHidingSpot(55, 13); // Deep tunnel dead-end
    }

    // ------------------------------------------------------------
    // Items
    // ------------------------------------------------------------

    _setupItems() {
        // Station Hall
        this._addItem(23, 40, ITEM_TYPE.BATTERY, { name: 'Flashlight Battery', charge: 40 });
        this._addItem(30, 38, ITEM_TYPE.THROWABLE, { name: 'Glass Bottle', noise: 0.7 });
        this._addItem(38, 43, ITEM_TYPE.DIARY_PAGE, { name: 'Station Master Log', page: 1 });

        // Hostel Corridors
        this._addItem(6, 20, ITEM_TYPE.BATTERY, { name: 'Flashlight Battery', charge: 40 });
        this._addItem(6, 24, ITEM_TYPE.THROWABLE, { name: 'Empty Soda Can', noise: 0.6 });
        this._addItem(7, 28, ITEM_TYPE.KEY, { name: 'Hostel Master Key', doorId: 'hostel' });
        this._addItem(14, 20, ITEM_TYPE.BATTERY, { name: 'Flashlight Battery', charge: 40 });
        this._addItem(15, 25, ITEM_TYPE.TAPE_RECORDER, { name: 'Cassette Player', tapeId: 'hostel_tape' });
        this._addItem(17, 25, ITEM_TYPE.DIARY_PAGE, { name: 'Torn Guest Journal', page: 2 });

        // Hospital Wing
        this._addItem(43, 21, ITEM_TYPE.BATTERY, { name: 'Flashlight Battery', charge: 40 });
        this._addItem(43, 29, ITEM_TYPE.THROWABLE, { name: 'Glass Beaker', noise: 0.8 });
        this._addItem(55, 21, ITEM_TYPE.BATTERY, { name: 'Medical Battery', charge: 50 });
        this._addItem(51, 20, ITEM_TYPE.DIARY_PAGE, { name: 'Doctor Note', page: 3 });
        this._addItem(55, 30, ITEM_TYPE.KEY, { name: 'Pharmacy Key', doorId: 'pharmacy' });

        // Flooded Basement
        this._addItem(9, 5, ITEM_TYPE.THROWABLE, { name: 'Rusted Iron Pipe', noise: 0.9 });
        this._addItem(15, 5, ITEM_TYPE.BATTERY, { name: 'Heavy Duty Battery', charge: 50 });
        this._addItem(4, 8, ITEM_TYPE.KEY, { name: 'Substation Key', doorId: 'basement' });

        // Office Floor
        this._addItem(36, 7, ITEM_TYPE.BATTERY, { name: 'Flashlight Battery', charge: 40 });
        this._addItem(26, 12, ITEM_TYPE.THROWABLE, { name: 'Ceramic Mug', noise: 0.7 });
        this._addItem(23, 7, ITEM_TYPE.DIARY_PAGE, { name: 'Executive Memo', page: 4 });
        this._addItem(34, 15, ITEM_TYPE.BATTERY, { name: 'Flashlight Battery', charge: 40 });

        // Secret Tunnels & Restrooms
        this._addItem(43, 13, ITEM_TYPE.THROWABLE, { name: 'Heavy Brick', noise: 0.85 });
        this._addItem(50, 4, ITEM_TYPE.BATTERY, { name: 'Flashlight Battery', charge: 40 });
        this._addItem(55, 8, ITEM_TYPE.WALKIE_TALKIE, { name: 'Static Receiver', channel: 1 });
        this._addItem(54, 12, ITEM_TYPE.BATTERY, { name: 'Emergency Battery', charge: 50 });

        // Quiet Way Alcoves
        this._addItem(52, 41, ITEM_TYPE.BATTERY, { name: 'Generator Battery', charge: 45 });

        // Banishment Relic - Hidden in Hospital Wing Altar (x:50, y:25)
        this.relic = this._addItem(50, 25, ITEM_TYPE.BANISH_RELIC, {
            name: 'Banishment Relic',
            desc: 'Press [G] to blast and banish the Listener into dust!'
        });
    }

    // ------------------------------------------------------------
    // Listener Patrol Route (The Short Way Circuit)
    // ------------------------------------------------------------

    _setupPatrolRoute() {
        const waypoints = [
            { tx: 30, ty: 34 }, // North junction outside Station Hall
            { tx: 30, ty: 25 }, // Central Crossway
            { tx: 40, ty: 25 }, // Hospital Wing entrance
            { tx: 30, ty: 25 }, // Central Crossway
            { tx: 12, ty: 25 }, // Hostel Corridors entrance
            { tx: 30, ty: 25 }, // Central Crossway
            { tx: 30, ty: 16 }, // Office Floor south entrance
            { tx: 30, ty: 9 },  // Office central intersection
            { tx: 18, ty: 9 },  // Flooded Basement threshold
            { tx: 30, ty: 9 },  // Office central intersection
            { tx: 41, ty: 9 },  // Toilet Pit / Tunnel threshold
            { tx: 30, ty: 9 },  // Office central intersection
            { tx: 30, ty: 16 }, // Office south entrance
            { tx: 30, ty: 25 }, // Central Crossway
            { tx: 30, ty: 34 }  // Loop back to Station junction
        ];

        this.patrolPoints = waypoints.map(wp => ({
            x: tileToPixel(wp.tx),
            y: tileToPixel(wp.ty)
        }));
    }

    // ------------------------------------------------------------
    // Primitive Carving Helpers
    // ------------------------------------------------------------

    _fillRect(x, y, w, h, tile) {
        for (let cy = y; cy < y + h; cy++) {
            if (cy < 0 || cy >= this.height) continue;
            for (let cx = x; cx < x + w; cx++) {
                if (cx < 0 || cx >= this.width) continue;
                this.tiles[cy][cx] = tile;
            }
        }
    }

    _drawHLine(x1, x2, y, tile) {
        if (y < 0 || y >= this.height) return;
        const minX = Math.max(0, Math.min(x1, x2));
        const maxX = Math.min(this.width - 1, Math.max(x1, x2));
        for (let x = minX; x <= maxX; x++) {
            this.tiles[y][x] = tile;
        }
    }

    _drawVLine(y1, y2, x, tile) {
        if (x < 0 || x >= this.width) return;
        const minY = Math.max(0, Math.min(y1, y2));
        const maxY = Math.min(this.height - 1, Math.max(y1, y2));
        for (let y = minY; y <= maxY; y++) {
            this.tiles[y][x] = tile;
        }
    }

    _addStone(tx, ty, id) {
        this.tiles[ty][tx] = TILE.STONE;
        this.stones.push({
            x: tileToPixel(tx),
            y: tileToPixel(ty),
            collected: false,
            id: id
        });
    }

    _addHidingSpot(tx, ty) {
        this.tiles[ty][tx] = TILE.HIDING_SPOT;
        this.hidingSpots.push({
            x: tileToPixel(tx),
            y: tileToPixel(ty),
            occupied: false
        });
    }

    _addItem(tx, ty, type, data = {}) {
        const item = {
            x: tileToPixel(tx),
            y: tileToPixel(ty),
            type: type,
            id: this._itemIdCounter++,
            collected: false,
            data: data
        };
        this.items.push(item);
        return item;
    }

    // ------------------------------------------------------------
    // Public Interface Methods
    // ------------------------------------------------------------

    // Get tile at tile coordinates. Returns TILE.WALL for out of bounds.
    getTile(tx, ty) {
        if (tx < 0 || tx >= this.width || ty < 0 || ty >= this.height) {
            return TILE.WALL;
        }
        return this.tiles[ty][tx];
    }

    // Check if tile is walkable
    isTileWalkable(tx, ty) {
        return this.getTile(tx, ty) !== TILE.WALL;
    }

    // Check if pixel position is walkable (not a wall)
    isWalkable(x, y) {
        const tx = pixelToTile(x);
        const ty = pixelToTile(y);
        return this.isTileWalkable(tx, ty);
    }

    // Check if pixel position is in water
    isWater(x, y) {
        const tx = pixelToTile(x);
        const ty = pixelToTile(y);
        return this.getTile(tx, ty) === TILE.WATER;
    }

    // Check if pixel position is on loud floor
    isLoudFloor(x, y) {
        const tx = pixelToTile(x);
        const ty = pixelToTile(y);
        return this.getTile(tx, ty) === TILE.LOUD_FLOOR;
    }

    // Check if pixel position is on tunnel
    isTunnel(x, y) {
        const tx = pixelToTile(x);
        const ty = pixelToTile(y);
        return this.getTile(tx, ty) === TILE.TUNNEL;
    }

    // Get the noise multiplier at a pixel position
    // Water = 2.0, Loud floor = 1.8, Normal = 1.0, Tunnel = 0.7
    getNoiseMultiplier(x, y) {
        const tx = pixelToTile(x);
        const ty = pixelToTile(y);
        const tile = this.getTile(tx, ty);
        if (tile === TILE.WATER) return 2.0;
        if (tile === TILE.LOUD_FLOOR) return 1.8;
        if (tile === TILE.TUNNEL) return 0.7;
        return 1.0;
    }

    // Get the room at pixel position, or null
    getRoom(x, y) {
        const tx = pixelToTile(x);
        const ty = pixelToTile(y);
        for (let i = 0; i < this.rooms.length; i++) {
            const r = this.rooms[i];
            if (tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h) {
                return r;
            }
        }
        return null;
    }

    // Get nearby hiding spot within range (pixels), or null
    getNearbyHidingSpot(x, y, range = 48) {
        let closest = null;
        let minDist = range;
        for (let i = 0; i < this.hidingSpots.length; i++) {
            const spot = this.hidingSpots[i];
            const d = dist(x, y, spot.x, spot.y);
            if (d <= minDist) {
                minDist = d;
                closest = spot;
            }
        }
        return closest;
    }

    // Get nearby stone within range (pixels), or null
    getNearbyStone(x, y, range = 48) {
        let closest = null;
        let minDist = range;
        for (let i = 0; i < this.stones.length; i++) {
            const stone = this.stones[i];
            if (stone.collected) continue;
            const d = dist(x, y, stone.x, stone.y);
            if (d <= minDist) {
                minDist = d;
                closest = stone;
            }
        }
        return closest;
    }

    // Get nearby item within range (pixels), or null
    getNearbyItem(x, y, range = 48) {
        let closest = null;
        let minDist = range;
        for (let i = 0; i < this.items.length; i++) {
            const item = this.items[i];
            if (item.collected) continue;
            const d = dist(x, y, item.x, item.y);
            if (d <= minDist) {
                minDist = d;
                closest = item;
            }
        }
        return closest;
    }

    // ------------------------------------------------------------
    // A* Pathfinding
    // ------------------------------------------------------------
    // Efficient A* implementation on 60x50 grid with binary heap priority
    // queue, octile heuristic, corner-cutting checks, and LRU cache.
    // Returns array of {x, y} in pixel coords, or empty array if no path.
    findPath(tx1, ty1, tx2, ty2) {
        // Validate map boundaries
        if (tx1 < 0 || tx1 >= this.width || ty1 < 0 || ty1 >= this.height ||
            tx2 < 0 || tx2 >= this.width || ty2 < 0 || ty2 >= this.height) {
            return [];
        }

        // Start and goal must be walkable
        if (!this.isTileWalkable(tx1, ty1) || !this.isTileWalkable(tx2, ty2)) {
            return [];
        }

        // Already at the destination tile
        if (tx1 === tx2 && ty1 === ty2) {
            return [{
                x: tileToPixel(tx1),
                y: tileToPixel(ty1),
                tx: tx1,
                ty: ty1
            }];
        }

        // Check path cache
        const cacheKey = `${tx1},${ty1},${tx2},${ty2}`;
        if (this.pathCache.has(cacheKey)) {
            return this.pathCache.get(cacheKey).map(p => ({ ...p }));
        }

        const totalTiles = this.width * this.height;
        const gScore = new Float32Array(totalTiles);
        gScore.fill(Infinity);
        const cameFrom = new Int32Array(totalTiles);
        cameFrom.fill(-1);
        const closed = new Uint8Array(totalTiles);

        const startIdx = ty1 * this.width + tx1;
        const goalIdx = ty2 * this.width + tx2;

        // Octile distance heuristic
        const octile = (x1, y1, x2, y2) => {
            const dx = Math.abs(x1 - x2);
            const dy = Math.abs(y1 - y2);
            return 1.0 * (dx + dy) + (1.414 - 2.0) * Math.min(dx, dy);
        };

        const pq = new MapPriorityQueue();
        gScore[startIdx] = 0;
        pq.push({
            x: tx1,
            y: ty1,
            g: 0,
            f: octile(tx1, ty1, tx2, ty2)
        });

        const CARDINALS = [
            { dx: 0, dy: -1, cost: 1.0 },
            { dx: 0, dy: 1, cost: 1.0 },
            { dx: -1, dy: 0, cost: 1.0 },
            { dx: 1, dy: 0, cost: 1.0 }
        ];

        const DIAGONALS = [
            { dx: -1, dy: -1, cost: 1.414, c1: [-1, 0], c2: [0, -1] },
            { dx: 1, dy: -1, cost: 1.414, c1: [1, 0], c2: [0, -1] },
            { dx: -1, dy: 1, cost: 1.414, c1: [-1, 0], c2: [0, 1] },
            { dx: 1, dy: 1, cost: 1.414, c1: [1, 0], c2: [0, 1] }
        ];

        let found = false;

        while (!pq.isEmpty()) {
            const curr = pq.pop();
            const currIdx = curr.y * this.width + curr.x;

            if (currIdx === goalIdx) {
                found = true;
                break;
            }

            if (closed[currIdx]) continue;
            closed[currIdx] = 1;

            // Cardinal neighbors
            for (let i = 0; i < 4; i++) {
                const dir = CARDINALS[i];
                const nx = curr.x + dir.dx;
                const ny = curr.y + dir.dy;

                if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) continue;
                if (!this.isTileWalkable(nx, ny)) continue;

                const nIdx = ny * this.width + nx;
                if (closed[nIdx]) continue;

                const tentativeG = curr.g + dir.cost;
                if (tentativeG < gScore[nIdx]) {
                    gScore[nIdx] = tentativeG;
                    cameFrom[nIdx] = currIdx;
                    const f = tentativeG + octile(nx, ny, tx2, ty2);
                    pq.push({ x: nx, y: ny, g: tentativeG, f: f });
                }
            }

            // Diagonal neighbors (allowed only if both adjacent cardinal tiles are walkable)
            for (let i = 0; i < 4; i++) {
                const dir = DIAGONALS[i];
                const nx = curr.x + dir.dx;
                const ny = curr.y + dir.dy;

                if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) continue;
                if (!this.isTileWalkable(nx, ny)) continue;

                // Both orthogonal tiles must be walkable to prevent clipping through wall corners
                const adj1X = curr.x + dir.c1[0];
                const adj1Y = curr.y + dir.c1[1];
                const adj2X = curr.x + dir.c2[0];
                const adj2Y = curr.y + dir.c2[1];

                if (!this.isTileWalkable(adj1X, adj1Y) || !this.isTileWalkable(adj2X, adj2Y)) {
                    continue;
                }

                const nIdx = ny * this.width + nx;
                if (closed[nIdx]) continue;

                const tentativeG = curr.g + dir.cost;
                if (tentativeG < gScore[nIdx]) {
                    gScore[nIdx] = tentativeG;
                    cameFrom[nIdx] = currIdx;
                    const f = tentativeG + octile(nx, ny, tx2, ty2);
                    pq.push({ x: nx, y: ny, g: tentativeG, f: f });
                }
            }
        }

        if (!found) {
            return [];
        }

        // Reconstruct path from goal back to start
        const path = [];
        let curr = goalIdx;
        while (curr !== -1) {
            const cx = curr % this.width;
            const cy = Math.floor(curr / this.width);
            path.push({
                x: tileToPixel(cx),
                y: tileToPixel(cy),
                tx: cx,
                ty: cy
            });
            curr = cameFrom[curr];
        }
        path.reverse();

        // LRU Cache update (capped at 500 paths)
        if (this.pathCache.size >= 500) {
            const oldestKey = this.pathCache.keys().next().value;
            this.pathCache.delete(oldestKey);
        }
        this.pathCache.set(cacheKey, path);

        return path.map(p => ({ ...p }));
    }
}
