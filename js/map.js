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
        this.width = MAP_WIDTH;   // 170
        this.height = MAP_HEIGHT; // 140
        this.tiles = [];          // 2D array [y][x] of TILE values
        this.rooms = [];          // Array of {x, y, w, h, type, name} objects (tile coords)
        this.items = [];          // Array of {x, y, type, id, collected, data} objects (pixel coords)
        this.stones = [];         // Array of {x, y, collected, id} objects (pixel coords)
        this.relic = null;        // Banishment Relic {x, y, collected, id}
        this.hidingSpots = [];    // Array of {x, y, occupied} objects (pixel coords)
        this.patrolPoints = [];   // Array of {x, y} for Listener patrol route (pixel coords)
        this.listenerStartPositions = []; // Array of {x, y} for 3 Listeners
        this.listenerPatrolRoutes = [];    // Array of routes for 3 Listeners
        this.startPos = { x: 0, y: 0 };   // Player start position in pixel coords
        this.exitPos = { x: 0, y: 0 };    // Exit position in pixel coords
        this.exit = null;
        this.listenerStartPos = { x: 0, y: 0 }; // Where the central Listener starts (pixel coords)
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
        this.listenerStartPositions = [];
        this.listenerPatrolRoutes = [];
        this.pathCache.clear();
        this._itemIdCounter = 1;

        // 1. Initialize entire map to solid WALL
        for (let y = 0; y < this.height; y++) {
            const row = new Array(this.width).fill(TILE.WALL);
            this.tiles.push(row);
        }

        // 2. Carve Zones & Architecture (5x Expanded Facility)
        this._carveExitChamber();
        this._carveFloodedBasement();
        this._carveOfficeFloor();
        this._carveToiletPitAndSecretTunnels();
        this._carveHostelCorridors();
        this._carveHospitalWing();
        this._carveWestCatacombs();
        this._carveEastPsychiatricCrypt();
        this._carveStationHall();

        // 3. Carve Connecting Corridors (Short Way & Quiet Ways)
        this._carveCorridors();

        // 4. Place Key Entities & Objectives
        this._setupStones();
        this._setupHidingSpots();
        this._setupItems();
        this._setupPatrolRoutes();

        // 5. Positions for 170x140 Grid
        this.startPos = {
            x: tileToPixel(85),
            y: tileToPixel(130)
        };

        this.exitPos = {
            x: tileToPixel(85),
            y: tileToPixel(2)
        };
        this.exit = this.exitPos;

        // 3 Ghost start positions (Central Wing, West Wing, East Wing)
        this.listenerStartPositions = [
            { x: tileToPixel(85), y: tileToPixel(72) },
            { x: tileToPixel(28), y: tileToPixel(72) },
            { x: tileToPixel(142), y: tileToPixel(72) }
        ];

        this.listenerStartPos = this.listenerStartPositions[0];
    }

    // ------------------------------------------------------------
    // Room Carving Methods
    // ------------------------------------------------------------

    _carveExitChamber() {
        // Exit Blast Terminus at top center (x: 74, y: 1, w: 22, h: 8)
        const rx = 74, ry = 1, rw = 22, rh = 8;
        this._fillRect(rx, ry, rw, rh, TILE.FLOOR);

        // Place exit tiles at the north blast wall
        for (let x = 82; x <= 88; x++) {
            this.tiles[1][x] = TILE.EXIT;
        }

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
        // Flooded Basement Vaults (x: 4, y: 4, w: 56, h: 42)
        // Submerged under dark water. High noise footprint.
        const rx = 4, ry = 4, rw = 56, rh = 42;
        this._fillRect(rx, ry, rw, rh, TILE.WATER);

        // Concrete dry catwalks
        this._fillRect(26, 4, 4, 42, TILE.FLOOR);  // N-S catwalk
        this._fillRect(4, 23, 56, 4, TILE.FLOOR);  // E-W catwalk

        // Submerged pump machinery and support pillars (obstacles)
        const pillars = [
            [12, 10], [12, 32], [42, 10], [42, 32],
            [18, 16], [18, 38], [36, 16], [36, 38]
        ];
        pillars.forEach(([px, py]) => {
            this._fillRect(px, py, 4, 4, TILE.WALL);
        });

        // Elevated dry walkway along the top right of the basement
        this._fillRect(46, 4, 14, 8, TILE.FLOOR);

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
        // Executive Office Floor & Archives (x: 66, y: 14, w: 38, h: 32)
        // Filled with creaky floorboards that create high noise.
        const rx = 66, ry = 14, rw = 38, rh = 32;
        this._fillRect(rx, ry, rw, rh, TILE.LOUD_FLOOR);

        // Executive Offices in Northwest corner
        this._fillRect(68, 16, 12, 10, TILE.FLOOR);
        this._drawHLine(68, 80, 26, TILE.WALL);
        this._drawVLine(16, 26, 80, TILE.WALL);
        this.tiles[26][74] = TILE.DOOR;

        // Server Room in Northeast corner
        this._fillRect(90, 16, 12, 10, TILE.FLOOR);
        this._drawHLine(90, 102, 26, TILE.WALL);
        this._drawVLine(16, 26, 90, TILE.WALL);
        this.tiles[26][96] = TILE.DOOR;

        // Central Executive Strongroom (Vault containing Stone 2)
        this._fillRect(82, 20, 6, 8, TILE.FLOOR);
        this._drawHLine(82, 88, 20, TILE.WALL);
        this._drawHLine(82, 88, 28, TILE.WALL);
        this._drawVLine(20, 28, 82, TILE.WALL);
        this._drawVLine(20, 28, 88, TILE.WALL);
        this.tiles[28][85] = TILE.DOOR; // Strongroom door

        // Cubicle partition barriers (creating stealth cover lanes)
        this._drawHLine(70, 78, 32, TILE.WALL);
        this._drawHLine(92, 100, 32, TILE.WALL);
        this._drawHLine(70, 78, 38, TILE.WALL);
        this._drawHLine(92, 100, 38, TILE.WALL);

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
        // Restroom Pit & Secret Maintenance Tunnels (x: 110, y: 4, w: 56, h: 42)
        const rx = 110, ry = 4, rw = 56, rh = 42;

        // West side: Decrepit Washroom / Restroom Pit (Floor tiles)
        this._fillRect(110, 14, 18, 24, TILE.FLOOR);
        // Stall partition dividers
        this._drawHLine(112, 122, 20, TILE.WALL);
        this._drawHLine(112, 122, 26, TILE.WALL);
        this._drawHLine(112, 122, 32, TILE.WALL);

        // Wall between restroom and tunnels with cracked breach at (128, 24)
        this._drawVLine(14, 38, 128, TILE.WALL);
        this.tiles[24][128] = TILE.FLOOR; // Cracked wall gap

        // East side: Secret Tunnels (Sound dampening tunnel tiles)
        // Upper maintenance tunnel loop and pedestal chamber
        this._fillRect(130, 4, 34, 12, TILE.TUNNEL);
        this._fillRect(140, 6, 14, 6, TILE.WALL); // Central rock pillar inside tunnel chamber

        // Connecting tunnel passages
        this._fillRect(130, 16, 6, 12, TILE.TUNNEL);
        this._fillRect(142, 16, 22, 4, TILE.TUNNEL);
        this._fillRect(158, 20, 6, 24, TILE.TUNNEL);
        this._fillRect(134, 28, 24, 4, TILE.TUNNEL);
        this._fillRect(130, 32, 6, 12, TILE.TUNNEL);

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
        // Hostel Corridors (x: 4, y: 52, w: 56, h: 40)
        // Long hallways with numbered rooms branching off
        const rx = 4, ry = 52, rw = 56, rh = 40;

        // Central Hostel Hallway (4 tiles wide: x: 26..29)
        this._fillRect(26, 52, 4, 40, TILE.FLOOR);
        // Cross-hallway at y: 70..73
        this._fillRect(4, 70, 56, 4, TILE.FLOOR);

        // West wall of hallway with doors
        this._drawVLine(52, 91, 25, TILE.WALL);
        // East wall of hallway with doors
        this._drawVLine(52, 91, 30, TILE.WALL);

        // Room 101 (Northwest: 4..24, 52..69)
        this._fillRect(4, 52, 21, 17, TILE.FLOOR);
        this._fillRect(6, 55, 4, 3, TILE.WALL); // Bed obstacle
        this._fillRect(6, 62, 4, 3, TILE.WALL); // Bed obstacle
        this.tiles[60][25] = TILE.DOOR;

        // Room 102 (Southwest: 4..24, 74..91)
        this._fillRect(4, 74, 21, 17, TILE.FLOOR);
        this._fillRect(6, 77, 4, 3, TILE.WALL); // Bed obstacle
        this._fillRect(6, 84, 4, 3, TILE.WALL); // Bed obstacle
        this.tiles[80][25] = TILE.DOOR;

        // Room 103 (Northeast: 31..58, 52..69)
        this._fillRect(31, 52, 28, 17, TILE.FLOOR);
        this._fillRect(40, 56, 8, 3, TILE.WALL); // Lounge table obstacle
        this.tiles[60][30] = TILE.DOOR;

        // Room 104 (Southeast: 31..58, 74..91)
        this._fillRect(31, 74, 28, 17, TILE.FLOOR);
        this._drawHLine(36, 46, 80, TILE.WALL); // Stall dividers
        this._drawHLine(36, 46, 86, TILE.WALL);
        this.tiles[80][30] = TILE.DOOR;

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
        // Hospital Sanatorium Wing (x: 110, y: 52, w: 56, h: 40)
        // Medical wards with bed obstacles, pharmacy, and morgue
        const rx = 110, ry = 52, rw = 56, rh = 40;

        // Main access aisle (4 tiles wide: x: 140..143)
        this._fillRect(140, 52, 4, 40, TILE.FLOOR);
        // Cross-aisle at y: 70..73
        this._fillRect(110, 70, 56, 4, TILE.FLOOR);

        // Partition walls
        this._drawVLine(52, 91, 139, TILE.WALL);
        this._drawVLine(52, 91, 144, TILE.WALL);

        // Ward A (Northwest open ward: 110..138, 52..69)
        this._fillRect(110, 52, 29, 17, TILE.FLOOR);
        this._fillRect(115, 55, 4, 2, TILE.WALL); // Gurney
        this._fillRect(125, 55, 4, 2, TILE.WALL); // Gurney
        this._fillRect(115, 62, 4, 2, TILE.WALL); // Gurney
        this._fillRect(125, 62, 4, 2, TILE.WALL); // Gurney
        this.tiles[60][139] = TILE.DOOR;

        // Ward B (Southwest open ward: 110..138, 74..91)
        this._fillRect(110, 74, 29, 17, TILE.FLOOR);
        this._fillRect(115, 77, 4, 2, TILE.WALL); // Gurney
        this._fillRect(125, 77, 4, 2, TILE.WALL); // Gurney
        this._fillRect(115, 84, 4, 2, TILE.WALL); // Gurney
        this._fillRect(125, 84, 4, 2, TILE.WALL); // Gurney
        this.tiles[80][139] = TILE.DOOR;

        // Pharmacy (Northeast: 145..165, 52..69)
        this._fillRect(145, 52, 21, 17, TILE.FLOOR);
        this._fillRect(148, 58, 8, 2, TILE.WALL); // Dispensing counter
        this.tiles[60][144] = TILE.DOOR;

        // Morgue & Autopsy Room (Southeast: 145..165, 74..91)
        this._fillRect(145, 74, 21, 17, TILE.FLOOR);
        this._fillRect(154, 78, 6, 3, TILE.WALL); // Autopsy slab
        this.tiles[80][144] = TILE.DOOR;

        this.rooms.push({
            x: rx,
            y: ry,
            w: rw,
            h: rh,
            type: 'hospital',
            name: 'Hospital Wing'
        });
    }

    _carveWestCatacombs() {
        // West Catacombs / Sub-Basement Sump Vault (x: 4, y: 96, w: 56, h: 40)
        const rx = 4, ry = 96, rw = 56, rh = 40;

        // Main catacomb avenue (x: 26..29, y: 96..136)
        this._fillRect(26, 96, 4, 40, TILE.FLOOR);
        // Cross avenue (x: 4..60, y: 114..117)
        this._fillRect(4, 114, 56, 4, TILE.FLOOR);

        // West Crypt (4..24, 96..112)
        this._fillRect(4, 96, 21, 17, TILE.FLOOR);
        this._fillRect(8, 100, 6, 3, TILE.WALL); // Stone sarcophagus
        this._fillRect(8, 106, 6, 3, TILE.WALL);
        this.tiles[104][25] = TILE.DOOR;

        // Deep Sump Drainage Trench (Water: 4..24, 119..136)
        this._fillRect(4, 119, 21, 17, TILE.WATER);
        this._fillRect(10, 125, 4, 4, TILE.WALL); // Pump machinery

        // East Archive Storage (31..58, 96..112)
        this._fillRect(31, 96, 28, 17, TILE.FLOOR);
        this._fillRect(36, 100, 10, 2, TILE.WALL); // File shelves
        this._fillRect(36, 106, 10, 2, TILE.WALL);
        this.tiles[104][30] = TILE.DOOR;

        // Lower Drainage Cistern (Water with Catwalk: 31..58, 119..136)
        this._fillRect(31, 119, 28, 17, TILE.WATER);
        this._fillRect(42, 119, 4, 17, TILE.FLOOR); // Dry concrete catwalk

        this.rooms.push({
            x: rx,
            y: ry,
            w: rw,
            h: rh,
            type: 'catacombs',
            name: 'West Catacombs'
        });
    }

    _carveEastPsychiatricCrypt() {
        // Deep East Psychiatric Archive Crypt (x: 110, y: 96, w: 56, h: 40)
        const rx = 110, ry = 96, rw = 56, rh = 40;

        // Main access aisle (x: 140..143, y: 96..136)
        this._fillRect(140, 96, 4, 40, TILE.FLOOR);
        // Cross aisle (x: 110..165, y: 114..117)
        this._fillRect(110, 114, 56, 4, TILE.FLOOR);

        // Partition walls
        this._drawVLine(96, 136, 139, TILE.WALL);
        this._drawVLine(96, 136, 144, TILE.WALL);

        // Padded Isolation Cell 1 (NW: 110..138, 96..112)
        this._fillRect(110, 96, 29, 17, TILE.FLOOR);
        this.tiles[104][139] = TILE.DOOR;

        // Padded Isolation Cell 2 (SW: 110..138, 119..136)
        this._fillRect(110, 119, 29, 17, TILE.FLOOR);
        this.tiles[126][139] = TILE.DOOR;

        // Deep Psychiatric Archive Vault (East: 145..165, 96..136)
        this._fillRect(145, 96, 21, 40, TILE.FLOOR);
        this.tiles[115][144] = TILE.DOOR;

        // Heavy archive metal racks
        this._fillRect(150, 102, 10, 2, TILE.WALL);
        this._fillRect(150, 110, 10, 2, TILE.WALL);
        this._fillRect(150, 126, 10, 2, TILE.WALL);

        this.rooms.push({
            x: rx,
            y: ry,
            w: rw,
            h: rh,
            type: 'psychiatric',
            name: 'Psychiatric Crypt'
        });
    }

    _carveStationHall() {
        // Station Hall & Commuter Concourse (x: 66, y: 80, w: 38, h: 56)
        // Grand open subterranean station with pillars and ticket booths
        const rx = 66, ry = 80, rw = 38, rh = 56;
        this._fillRect(rx, ry, rw, rh, TILE.FLOOR);

        // Architectural support pillars (providing cover against sightlines)
        const stationPillars = [
            [74, 90], [94, 90],
            [74, 106], [94, 106],
            [74, 122], [94, 122]
        ];
        stationPillars.forEach(([px, py]) => this._fillRect(px, py, 3, 3, TILE.WALL));

        // Ticket Counter / Booth (West side: 68..78, 98..104)
        this._drawHLine(68, 78, 98, TILE.WALL);
        this._drawHLine(68, 78, 104, TILE.WALL);
        this._drawVLine(98, 104, 68, TILE.WALL);
        this._drawVLine(98, 104, 78, TILE.WALL);
        this.tiles[104][73] = TILE.DOOR; // Ticket booth door

        // Turnstiles barrier line with gaps at y: 112
        this._drawHLine(78, 92, 112, TILE.WALL);
        this.tiles[112][82] = TILE.FLOOR; // Turnstile passage 1
        this.tiles[112][85] = TILE.FLOOR; // Turnstile passage 2
        this.tiles[112][88] = TILE.FLOOR; // Turnstile passage 3

        // Station Platform Tracks Wall at bottom
        this._drawHLine(66, 103, 135, TILE.WALL);

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
        // 1. THE SHORT WAY (Direct arterial route patrolled by Listeners)
        // ========================================================

        // Central Vertical Spine: Exit Chamber (y:8) -> Office Floor (y:14..45) -> Station Hall (y:80)
        // 4 tiles wide (x: 83..86)
        this._fillRect(83, 8, 4, 72, TILE.FLOOR);

        // Central Crossway at y: 70..73
        // West arm: connects to Hostel central hallway (x: 28)
        this._fillRect(28, 70, 56, 4, TILE.FLOOR);
        // East arm: connects to Hospital aisle (x: 142)
        this._fillRect(86, 70, 56, 4, TILE.FLOOR);

        // Connectors to wings
        this._fillRect(58, 22, 10, 4, TILE.FLOOR);
        this._fillRect(102, 22, 10, 4, TILE.FLOOR);
        this._fillRect(58, 114, 10, 4, TILE.FLOOR);
        this._fillRect(102, 114, 10, 4, TILE.FLOOR);

        // Connect Hostels to Catacombs corridor bridge (y: 92..96, x: 26..29)
        this._fillRect(26, 92, 4, 4, TILE.FLOOR);

        // Connect Hospital to Psychiatric Crypt corridor bridge (y: 92..96, x: 140..143)
        this._fillRect(140, 92, 4, 4, TILE.FLOOR);

        // Connect Central Corridor to Station Concourse bridge (y: 78..82, x: 83..86)
        this._fillRect(83, 78, 4, 4, TILE.FLOOR);

        this.rooms.push({
            x: 81,
            y: 46,
            w: 8,
            h: 34,
            type: 'corridor',
            name: 'Central Junction'
        });

        // ========================================================
        // 2. THE QUIET WAYS (Winding, sound-dampened bypasses)
        // ========================================================

        // --- Quiet Way Far-West: Basement -> Hostel -> Catacombs ---
        this._fillRect(2, 6, 3, 128, TILE.FLOOR);
        this._fillRect(2, 23, 4, 3, TILE.FLOOR);
        this._fillRect(2, 70, 4, 3, TILE.FLOOR);
        this._fillRect(2, 114, 4, 3, TILE.FLOOR);

        // --- Quiet Way Far-East: Secret Tunnels -> Hospital -> Psychiatric ---
        this._fillRect(165, 6, 3, 128, TILE.TUNNEL);
        this._fillRect(162, 22, 4, 3, TILE.TUNNEL);
        this._fillRect(162, 70, 4, 3, TILE.TUNNEL);
        this._fillRect(162, 114, 4, 3, TILE.TUNNEL);

        // --- Quiet Exit Crawlways (Bypassing loud Office Floor entirely!) ---
        // Crawlway 1: Flooded Basement dry walkway directly to Exit Chamber
        this._fillRect(56, 4, 20, 3, TILE.TUNNEL);

        // Crawlway 2: Secret Tunnels top chamber directly to Exit Chamber
        this._fillRect(94, 4, 20, 3, TILE.TUNNEL);
    }

    // ------------------------------------------------------------
    // Objectives: Memory Stones
    // ------------------------------------------------------------

    _setupStones() {
        // Stone 1: Flooded Basement (Water Stone) - deep submerged vault
        this._addStone(18, 30, 1);

        // Stone 2: Office Floor (Hollow Stone) - central executive strongroom vault
        this._addStone(85, 24, 2);

        // Stone 3: East Psychiatric Crypt (Echoing Stone) - deep isolation records vault
        this._addStone(148, 120, 3);
    }

    // ------------------------------------------------------------
    // Hiding Spots
    // ------------------------------------------------------------

    _setupHidingSpots() {
        const spots = [
            // Station Hall
            [85, 128], [70, 102], [98, 102], [72, 128],
            // West Catacombs
            [10, 104], [10, 128], [48, 104], [48, 128],
            // East Psychiatric Crypt
            [116, 106], [116, 128], [158, 106], [158, 128],
            // Hostel Corridors
            [8, 56], [8, 66], [8, 78], [8, 86], [48, 56], [48, 86],
            // Hospital Wing
            [116, 60], [116, 84], [158, 60], [160, 84],
            // Flooded Basement
            [10, 10], [10, 36], [48, 10], [48, 36], [24, 6],
            // Office Floor
            [70, 18], [98, 18], [72, 38], [96, 38],
            // Toilet Pit & Secret Tunnels
            [116, 20], [116, 32], [140, 10], [158, 20], [158, 38]
        ];

        spots.forEach(([tx, ty]) => {
            this._addHidingSpot(tx, ty);
        });
    }

    // ------------------------------------------------------------
    // Items
    // ------------------------------------------------------------

    _setupItems() {
        // Station Hall
        this._addItem(70, 101, ITEM_TYPE.BATTERY, { name: 'Lantern Battery', charge: 45 });
        this._addItem(85, 105, ITEM_TYPE.THROWABLE, { name: 'Glass Bottle', noise: 0.7 });

        // West Catacombs
        this._addItem(10, 102, ITEM_TYPE.BATTERY, { name: 'Emergency Battery', charge: 45 });
        this._addItem(28, 114, ITEM_TYPE.THROWABLE, { name: 'Stone Brick', noise: 0.85 });

        // East Psychiatric Crypt
        this._addItem(120, 102, ITEM_TYPE.BATTERY, { name: 'High-Capacity Battery', charge: 50 });

        // Hostel Corridors
        this._addItem(10, 58, ITEM_TYPE.BATTERY, { name: 'Flashlight Battery', charge: 40 });
        this._addItem(36, 70, ITEM_TYPE.THROWABLE, { name: 'Metal Can', noise: 0.65 });

        // Hospital Wing
        this._addItem(120, 58, ITEM_TYPE.BATTERY, { name: 'Medical Battery', charge: 50 });
        this._addItem(148, 60, ITEM_TYPE.THROWABLE, { name: 'Chemical Flask', noise: 0.8 });

        // Banishment Relic - Hidden in Hospital Wing Morgue Altar (x:148, y:76)
        this.relic = this._addItem(148, 76, ITEM_TYPE.BANISH_RELIC, {
            name: 'Banishment Relic',
            desc: 'Press [G] to blast and banish the nearest Listener into dust!'
        });

        // Flooded Basement
        this._addItem(26, 12, ITEM_TYPE.THROWABLE, { name: 'Iron Pipe', noise: 0.9 });
        this._addItem(48, 6, ITEM_TYPE.BATTERY, { name: 'Heavy Battery', charge: 50 });

        // Office Floor
        this._addItem(74, 20, ITEM_TYPE.BATTERY, { name: 'Flashlight Battery', charge: 40 });
        this._addItem(85, 36, ITEM_TYPE.THROWABLE, { name: 'Ceramic Mug', noise: 0.7 });
    }

    // ------------------------------------------------------------
    // Listener Patrol Routes (3 Identical Listeners across Wings)
    // ------------------------------------------------------------

    _setupPatrolRoutes() {
        // Ghost 1: Central Wing patrol circuit
        const route1 = [
            { tx: 85, ty: 72 }, { tx: 85, ty: 45 }, { tx: 85, ty: 24 },
            { tx: 85, ty: 10 }, { tx: 85, ty: 24 }, { tx: 85, ty: 45 },
            { tx: 85, ty: 72 }, { tx: 85, ty: 95 }, { tx: 85, ty: 120 }, { tx: 85, ty: 95 }
        ].map(wp => ({ x: tileToPixel(wp.tx), y: tileToPixel(wp.ty), tx: wp.tx, ty: wp.ty }));

        // Ghost 2: West Wing patrol circuit
        const route2 = [
            { tx: 28, ty: 72 }, { tx: 28, ty: 55 }, { tx: 28, ty: 30 },
            { tx: 18, ty: 30 }, { tx: 28, ty: 30 }, { tx: 28, ty: 72 },
            { tx: 28, ty: 95 }, { tx: 28, ty: 115 }, { tx: 18, ty: 115 }, { tx: 28, ty: 95 }
        ].map(wp => ({ x: tileToPixel(wp.tx), y: tileToPixel(wp.ty), tx: wp.tx, ty: wp.ty }));

        // Ghost 3: East Wing patrol circuit
        const route3 = [
            { tx: 142, ty: 72 }, { tx: 142, ty: 55 }, { tx: 142, ty: 30 },
            { tx: 148, ty: 18 }, { tx: 142, ty: 30 }, { tx: 142, ty: 72 },
            { tx: 142, ty: 95 }, { tx: 142, ty: 115 }, { tx: 148, ty: 120 }, { tx: 142, ty: 95 }
        ].map(wp => ({ x: tileToPixel(wp.tx), y: tileToPixel(wp.ty), tx: wp.tx, ty: wp.ty }));

        this.listenerPatrolRoutes = [route1, route2, route3];
        this.patrolPoints = route1; // backward compatibility
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
