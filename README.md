# HUSH - A 2D Co-op Horror Game Where Your Voice is the Danger

> *"You are trapped in a dead place with your friends. The thing hunting you cannot see. It can only hear. And the loudest thing in the room is you."*

---

## 🎮 How to Play

### Running Locally
You can run HUSH in any modern web browser. For microphone features and Web Audio API, serve via any local web server:

```bash
# Using Python 3
python3 -m http.server 8000

# Or using Node npx
npx serve .
```
Then open `http://localhost:8000` in your browser.

---

## 🕹️ Controls

| Action | Control | Notes |
| :--- | :--- | :--- |
| **Move** | `W`, `A`, `S`, `D` or `Arrow Keys` | Standard walking speed |
| **Run** | `Shift` (Hold) | Moves faster, but spikes your footstep noise bar! |
| **Sneak** | `Ctrl` or `C` | Slow, silent movement |
| **Hold Breath** | `Space` (Hold) | Silences your noise bar completely. Drains stamina! |
| **Flashlight** | `F` | Toggles flashlight beam. Drains battery over time. |
| **Interact / Pick Up / Escape** | `E` | Picks up items, collects memory stones, escapes at the Exit machine. |
| **Hide** | `H` | Hide inside lockers, morgue drawers, under beds. |
| **Throw Distraction** | `Left Click` | Throws bottles/cans toward cursor. Clangs on impact to lure the Listener away. |
| **Voice Detection** | Real Microphone | Calibrated at startup (Whisper → Talk → Shout). |
| **Simulated Voice** | `V` (Hold to speak) or `1`, `2`, `3` | `1` = Whisper, `2` = Normal Talk, `3` = Loud Scream (useful when testing without a mic). |
| **Retry** | `R` | Restart after dying or escaping. |

---

## 🧩 Core Mechanics & Game Systems

### 1. The Red Line Noise Bar
- The noise meter at the top of the screen tracks real-time volume:
  - **Microphone RMS Input** (smoothed so small audio pops don't trip alarms).
  - **Footstep Noise** (Sneaking < Walking < Running).
  - **Floor Materials** (Water tiles multiply noise by 2.0x, Loud creaky floors by 1.8x).
  - **Carrying Memory Stones** (Each stone hums faintly, adding baseline noise).
  - **Panic Heartbeats** (Heart rate quickens as the Listener draws close, quietly adding to noise).
- Crossing the fixed **Red Line (0.6)** gives away your exact position to the Listener.

### 2. The Listener (AI Monster)
- **Nearly blind**: Only sees faint outlines within 80px and cannot see hidden players.
- **Hearing is vision**: Senses sound up to 600px.
- **Behavior State Machine**:
  - `PATROL`: Rhythmical patrol along the Short Way corridors, head tilting to listen. Never accidentally ambushes players inside quiet rooms (The Golden Rule).
  - `INVESTIGATE`: Moves to check out sounds, footsteps, and thrown objects.
  - `HUNT`: Locks on with blazing red eyes and chases the player down.
  - `COOL`: Stays alert in the area before returning to patrol.
- **The Voice Copy Twist (Stone 2)**:
  - Once the 2nd stone is taken, the Listener learns to copy human voices, whispering deceptive calls like *"Help me... over here..."* from random directions.
- **The Final Act (Stone 3)**:
  - When the 3rd stone is placed, the building lights cut out, sirens and distorted whispers echo simultaneously from every direction, and the team must whisper and sprint to the Exit Chamber to escape.

### 3. Atmospheric 2D Rendering
- **Pitch-black Fog of War**: Dark off-screen canvas with feathered lighting cutouts.
- **Volumetric Flashlight**: Warm-toned flashlight beam aimed by the mouse cursor, with low-battery flickering.
- **Red Eye Sensing**: Even when hidden in pitch darkness outside your flashlight, the Listener's red eyes subtly pierce the dark within 300px.
- **Heartbeat Vignette**: Red edge vignette pulses with increasing intensity as the monster closes in.

### 4. 100% Procedural Audio (Web Audio API)
- Zero external audio files required. All synthesized procedurally in real-time:
  - Sub-bass ambient drones with LFO modulation and resonant filtered air hiss.
  - Dynamic dual-thud heartbeats with variable rate and panic volume.
  - Splashing water footsteps and creaking wood planks.
  - Metallic clang reverberations for throwables.
  - Distorted voice synthesis for the Listener's deceptive mimicry.

---

## 🗺️ Building Map Zones
- **Station Hall**: Concourse, broken turnstiles, ticket booths (Start area).
- **Hostel Corridors**: Numbered rooms (101-104), lockers, bunk beds.
- **Hospital Wing**: Medical wards with gurneys, pharmacy, morgue.
- **Flooded Basement**: Deep water tiles, submerged machinery (**Stone 1**).
- **Office Floor**: Loud creaking floorboards, desks, cubicles (**Stone 2**).
- **Secret Tunnels & Toilet Pit**: Hidden crawlspaces and breaches (**Stone 3**).
- **Exit Chamber**: Locked escape portal that unlocks once all 3 stones are gathered.
- **Paths**:
  - *The Short Way*: Direct, wide corridors patrolled by the monster.
  - *The Quiet Way*: Longer perimeter crawlspaces, tunnels, and stairwells for stealthy evasion.

---

## 🏆 Endings
- **Good Ending (Silence)**: Escape with all three memory stones. The memories dissolve, the red eyes fade to a gentle man's brown gaze, and silence finally settles over the building.
- **Bad Ending ("Don't Leave Me")**: Caught by the Listener. Darkness falls, and the creature repeats your voice softly into the void.
