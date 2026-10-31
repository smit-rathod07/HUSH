// ============================================================
// HUSH - Constants
// ============================================================

const TILE_SIZE = 32;

const TILE = {
    WALL: 0,
    FLOOR: 1,
    WATER: 2,
    LOUD_FLOOR: 3,
    HIDING_SPOT: 4,
    STONE: 5,
    EXIT: 6,
    DOOR: 7,
    TUNNEL: 8
};

const GAME_STATE = {
    MENU: 0,
    CALIBRATING: 1,
    PLAYING: 2,
    GAME_OVER: 3,
    VICTORY: 4,
    FLASHBACK: 5,
    ESCAPED: 6,
    CUTSCENE: 7
};

const LISTENER_STATE = {
    PATROL: 0,
    INVESTIGATE: 1,
    HUNT: 2,
    COOL: 3
};

// Noise thresholds (0-1 normalized)
// Lowered red line so players don't have to shout unnaturally loud
const NOISE_THRESHOLDS = {
    SILENT: 0.0,
    WHISPER: 0.08,
    TALK: 0.22,
    LOUD: 0.30,
    BASE_RED_LINE: 0.36,
    RED_LINE: 0.36,   // Reduced from 0.60 to 0.36
    SHOUT: 0.48       // Reduced from 0.80 to 0.48
};

// Colors - enriched for high contrast and prominent obstacle visibility
const COLORS = {
    BACKGROUND: '#08080d',
    WALL: '#2c304f',
    WALL_EDGE: '#626a9c',
    WALL_TOP: '#3a4066',
    WALL_OBSTACLE: '#444b75',
    WALL_OBSTACLE_EDGE: '#7884bf',
    FLOOR: '#141a2c',
    FLOOR_ALT: '#182036',
    FLOOR_GRID: 'rgba(70, 95, 140, 0.25)',
    WATER: '#0c2340',
    WATER_SHIMMER: '#296da8',
    LOUD_FLOOR: '#322013',
    LOUD_FLOOR_PLANK: '#523722',
    TUNNEL: '#181428',
    TUNNEL_GRATE: 'rgba(80, 60, 120, 0.4)',
    HIDING_SPOT: '#265431',
    HIDING_SPOT_OUTLINE: '#4fa864',
    DOOR: '#6e4424',
    DOOR_EDGE: '#996339',
    DOOR_HANDLE: '#e0b33b',
    // Specialized room obstacles
    OBSTACLE_BED: '#5f7394',
    OBSTACLE_BED_SHEET: '#d2dce8',
    OBSTACLE_DESK: '#78482a',
    OBSTACLE_DESK_EDGE: '#b06f43',
    OBSTACLE_PILLAR: '#4f5678',
    OBSTACLE_PILLAR_EDGE: '#8590bd',
    OBSTACLE_TURNSTILE: '#68788c',
    OBSTACLE_TURNSTILE_STRIPE: '#e0ae36',
    OBSTACLE_PUMP: '#61432f',
    OBSTACLE_PUMP_PIPE: '#966a4a',
    // Glows and HUD
    STONE_GLOW: '#ffaa33',
    STONE_GLOW_FAINT: 'rgba(255, 170, 51, 0.25)',
    EXIT_GLOW: '#33ffaa',
    RELIC: '#00ffee',
    RELIC_GLOW: 'rgba(0, 255, 238, 0.85)',
    PLAYER: '#7799cc',
    PLAYER_OUTLINE: '#99bbee',
    PEER_PLAYERS: ['#33ddaa', '#ffaa44', '#dd66ff', '#44aaff'],
    LISTENER_BODY: '#f0e0d0',
    LISTENER_EYE: '#ff2222',
    LISTENER_EYE_GLOW: 'rgba(255, 34, 34, 0.4)',
    NOISE_BAR_BG: 'rgba(0, 0, 0, 0.7)',
    NOISE_BAR_SAFE: '#22aa44',
    NOISE_BAR_WARN: '#ccaa22',
    NOISE_BAR_DANGER: '#cc2222',
    FLASHLIGHT: 'rgba(255, 245, 220, 0.16)',
    FLASHLIGHT_CORE: 'rgba(255, 245, 220, 0.32)',
    FOG: '#08080d',
    TEXT: '#ccccdd',
    TEXT_DIM: '#667788',
    TEXT_WARN: '#ff6644',
    RED_LINE_COLOR: '#ff3333'
};

// Player settings
const PLAYER_SPEED = 120;       // pixels per second
const PLAYER_RUN_SPEED = 200;
const PLAYER_SNEAK_SPEED = 60;
const FLASHLIGHT_RANGE = 200;
const FLASHLIGHT_ANGLE = Math.PI / 3.5;  // cone half-angle
const FLASHLIGHT_MAX_BATTERY = 100;
const FLASHLIGHT_DRAIN_RATE = 2.5;  // per second
const BREATH_MAX_STAMINA = 100;
const BREATH_DRAIN_RATE = 25;   // per second when holding
const BREATH_RECOVER_RATE = 8;  // per second

// Listener settings
const LISTENER_PATROL_SPEED = 50;
const LISTENER_HUNT_SPEED = 140;
const LISTENER_INVESTIGATE_SPEED = 80;
const LISTENER_HEARING_RANGE = 600;      // pixels
const LISTENER_NEAR_BLIND_RANGE = 80;    // pixels - can barely see this close
const LISTENER_HUNT_MIN_CHASE = 5000;    // Follows player for at least 5 seconds
const LISTENER_HUNT_ESCAPE_DIST = 180;   // After 5s, if player is far away (> 180px, ~6 tiles), ghost stops chasing
const LISTENER_HUNT_MAX_DURATION = 10000;// Max chase ceiling if player stays very close (10s)
const LISTENER_HUNT_DURATION = 5000;     // 5 seconds default
const LISTENER_COOL_DURATION = 5000;     // ms
const LISTENER_INVESTIGATE_PATIENCE = 6000; // ms before giving up

// Audio settings
const MIC_SMOOTHING = 0.15;
const HEARTBEAT_BASE_RATE = 1.0;     // beats per second
const HEARTBEAT_MAX_RATE = 3.0;
const HEARTBEAT_NOISE_ADD = 0.05;    // noise added per heartbeat when panicked

// Map settings  
const MAP_WIDTH = 76;   // tiles (expanded from 60 to 76)
const MAP_HEIGHT = 62;  // tiles (expanded from 50 to 62)

// Stone settings
const TOTAL_STONES = 3;
const STONE_HUM_BASE = 0.02;      // base noise from carrying a stone
const STONE_HUM_PER_STONE = 0.03; // additional noise per extra stone

// Danger line reduction by diamonds/stones (very subtle so normal conversations remain completely safe)
const DIAMOND_REDUCTION_FRACTION = 0.005; // 0.005 (0.5%) per qualifying player holding >= 2 diamonds

// Proximity Voice Chat Settings
const PROXIMITY_MIN_DISTANCE = 120; // pixels: full volume
const PROXIMITY_MAX_DISTANCE = 680; // pixels: zero volume / silence

// Item types
const ITEM_TYPE = {
    BATTERY: 0,
    KEY: 1,
    THROWABLE: 2,
    WALKIE_TALKIE: 3,
    TAPE_RECORDER: 4,
    DIARY_PAGE: 5,
    BANISH_RELIC: 6
};
