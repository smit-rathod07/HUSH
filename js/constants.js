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
    ESCAPED: 6
};

const LISTENER_STATE = {
    PATROL: 0,
    INVESTIGATE: 1,
    HUNT: 2,
    COOL: 3
};

// Noise thresholds (0-1 normalized)
const NOISE_THRESHOLDS = {
    SILENT: 0.0,
    WHISPER: 0.15,
    TALK: 0.35,
    LOUD: 0.55,
    RED_LINE: 0.6,
    SHOUT: 0.8
};

// Colors
const COLORS = {
    BACKGROUND: '#0a0a0f',
    WALL: '#1a1a2e',
    WALL_EDGE: '#252540',
    FLOOR: '#16213e',
    FLOOR_ALT: '#141e38',
    WATER: '#0a1628',
    WATER_SHIMMER: '#1a3a5c',
    LOUD_FLOOR: '#1e1a16',
    TUNNEL: '#12121e',
    HIDING_SPOT: '#1a2a1a',
    DOOR: '#2a2a1a',
    STONE_GLOW: '#ffaa33',
    STONE_GLOW_FAINT: 'rgba(255, 170, 51, 0.15)',
    EXIT_GLOW: '#33ffaa',
    PLAYER: '#7799cc',
    PLAYER_OUTLINE: '#99bbee',
    LISTENER_BODY: '#f0e0d0',
    LISTENER_EYE: '#ff2222',
    LISTENER_EYE_GLOW: 'rgba(255, 34, 34, 0.4)',
    NOISE_BAR_BG: 'rgba(0, 0, 0, 0.6)',
    NOISE_BAR_SAFE: '#22aa44',
    NOISE_BAR_WARN: '#ccaa22',
    NOISE_BAR_DANGER: '#cc2222',
    FLASHLIGHT: 'rgba(255, 245, 220, 0.12)',
    FLASHLIGHT_CORE: 'rgba(255, 245, 220, 0.25)',
    FOG: '#0a0a0f',
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
const LISTENER_HUNT_DURATION = 4000;     // ms (60-120 seconds in design, shortened for gameplay)
const LISTENER_COOL_DURATION = 5000;     // ms
const LISTENER_INVESTIGATE_PATIENCE = 6000; // ms before giving up

// Audio settings
const MIC_SMOOTHING = 0.15;
const HEARTBEAT_BASE_RATE = 1.0;     // beats per second
const HEARTBEAT_MAX_RATE = 3.0;
const HEARTBEAT_NOISE_ADD = 0.05;    // noise added per heartbeat when panicked

// Map settings  
const MAP_WIDTH = 60;   // tiles
const MAP_HEIGHT = 50;  // tiles

// Stone settings
const TOTAL_STONES = 3;
const STONE_HUM_BASE = 0.02;      // base noise from carrying a stone
const STONE_HUM_PER_STONE = 0.03; // additional noise per extra stone

// Item types
const ITEM_TYPE = {
    BATTERY: 0,
    KEY: 1,
    THROWABLE: 2,
    WALKIE_TALKIE: 3,
    TAPE_RECORDER: 4,
    DIARY_PAGE: 5
};
