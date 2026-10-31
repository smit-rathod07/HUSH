// ============================================================
// HUSH - Audio Manager
// ============================================================
// Handles microphone input for noise detection, calibration,
// noise bar computation, and procedural Web Audio API sound synthesis.

class AudioManager {
    constructor() {
        this.micLevel = 0;           // Raw mic level 0-1
        this.smoothedLevel = 0;      // Smoothed mic level 0-1
        this.noiseBarValue = 0;      // Final noise bar value 0-1 (includes movement, stones, etc.)
        this.redLine = NOISE_THRESHOLDS.RED_LINE; // 0.36
        this.micActive = false;
        this.calibrated = false;
        this.calibrationData = { whisper: 0, talk: 0, shout: 0 };
        this.micGain = 2.5;          // Adjusted baseline for responsive voice detection
        this.audioCtx = null;
        this.heartbeatIntensity = 0; // 0-1
        this.heartbeatTimer = 0;
        this.ambientPlaying = false;

        // Internal audio state
        this.stream = null;
        this.analyser = null;
        this.micSource = null;
        this.dataArray = null;
        this.muted = false;
        this.masterGain = null;
        this.ambientGain = null;
        this.ambientNodes = [];
        this.calibrationPhase = null;
        this.calibrationCurrentMax = 0;
        this.calibrationTimer = 0;
        this.heartbeatNoise = 0;
        this._noiseBuffer = null;
        this._distortionCurve = null;
    }

    /**
     * Lazily initialize or resume the Web Audio context.
     * @private
     */
    _ensureAudioContext() {
        if (!this.audioCtx) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (AudioContextClass) {
                this.audioCtx = new AudioContextClass();
            }
        }
        if (this.audioCtx) {
            if (this.audioCtx.state === 'suspended') {
                this.audioCtx.resume().catch(() => {});
            }
            if (!this.masterGain) {
                this.masterGain = this.audioCtx.createGain();
                this.masterGain.gain.setValueAtTime(1.0, this.audioCtx.currentTime);
                this.masterGain.connect(this.audioCtx.destination);
            }
        }
        return this.audioCtx;
    }

    /**
     * Returns a cached reusable white noise buffer.
     * @param {number} duration - seconds
     * @private
     */
    _getNoiseBuffer(duration = 2.0) {
        if (!this.audioCtx) return null;
        if (!this._noiseBuffer) {
            const sampleRate = this.audioCtx.sampleRate;
            const bufferSize = Math.floor(sampleRate * duration);
            const buffer = this.audioCtx.createBuffer(1, bufferSize, sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = Math.random() * 2 - 1;
            }
            this._noiseBuffer = buffer;
        }
        return this._noiseBuffer;
    }

    /**
     * Generates a non-linear distortion curve for alarming sound synthesis.
     * @param {number} amount
     * @private
     */
    _makeDistortionCurve(amount = 25) {
        if (this._distortionCurve) return this._distortionCurve;
        const k = amount;
        const n_samples = 44100;
        const curve = new Float32Array(n_samples);
        const deg = Math.PI / 180;
        for (let i = 0; i < n_samples; ++i) {
            const x = (i * 2) / n_samples - 1;
            curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
        }
        this._distortionCurve = curve;
        return curve;
    }

    /**
     * Initialize Web Audio API and request microphone access.
     * Gracefully falls back if microphone permission is denied.
     */
    async init() {
        try {
            this._ensureAudioContext();

            if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: false,
                        noiseSuppression: false,
                        autoGainControl: false
                    }
                });

                this.stream = stream;
                if (this.audioCtx) {
                    this.micSource = this.audioCtx.createMediaStreamSource(stream);
                    this.analyser = this.audioCtx.createAnalyser();
                    this.analyser.fftSize = 2048;
                    // Connect microphone source strictly to analyser (never destination to prevent feedback)
                    this.micSource.connect(this.analyser);
                    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
                    this.micActive = true;
                }
            } else {
                console.warn('getUserMedia not supported on this browser.');
                this.micActive = false;
            }
        } catch (err) {
            console.warn('Microphone access denied or unavailable. Fallback to manual simulation:', err);
            this.micActive = false;
        }
    }

    /**
     * Start calibration phase ('whisper', 'talk', or 'shout').
     * @param {string} phase
     */
    startCalibration(phase) {
        if (phase && ['whisper', 'talk', 'shout'].includes(phase)) {
            this.calibrationPhase = phase;
            this.calibrationCurrentMax = 0;
            this.calibrationTimer = 0;
            this.calibrationData[phase] = 0;
        } else {
            console.warn('Unknown calibration phase:', phase);
        }
    }

    /**
     * End calibration phase and record the peak mic level.
     * @param {string} phase
     * @returns {number} The recorded peak value for the phase
     */
    endCalibration(phase) {
        const p = phase || this.calibrationPhase;
        if (p && this.calibrationData.hasOwnProperty(p)) {
            this.calibrationData[p] = Math.max(this.calibrationData[p] || 0, this.calibrationCurrentMax);
        }
        const recorded = (p && this.calibrationData[p]) || 0;
        this.calibrationPhase = null;
        this.calibrationCurrentMax = 0;
        this.calibrationTimer = 0;
        return recorded;
    }

    /**
     * Finalize calibration and compute micGain so that:
     * whisper maps to ~0.15, talk maps to ~0.4, shout maps to ~0.8.
     * Includes safeguards against zero/silent values.
     */
    finalizeCalibration() {
        const talk = this.calibrationData.talk || 0;
        if (talk > 0.01) {
            this.micGain = clamp(0.24 / talk, 1.2, 35.0);
        } else if (this.calibrationData.shout > 0.02) {
            this.micGain = clamp(0.48 / this.calibrationData.shout, 1.2, 35.0);
        } else if (this.calibrationData.whisper > 0.005) {
            this.micGain = clamp(0.08 / this.calibrationData.whisper, 1.2, 35.0);
        } else {
            // Default gain if mic was completely silent or unavailable
            this.micGain = 2.5;
        }
        this.calibrated = true;
        return this.micGain;
    }

    /**
     * Update audio manager state every frame.
     * @param {number} dt - Delta time in seconds
     * @param {number} movementNoise - Noise from player movement (0-1)
     * @param {number} stoneNoise - Noise from carrying stones (0-1)
     * @param {number} environmentNoise - Noise from water / loud floors (0-1)
     */
    update(dt, movementNoise = 0, stoneNoise = 0, environmentNoise = 0) {
        // 1. Calculate raw microphone level (RMS)
        if (this.micActive && this.analyser && this.dataArray) {
            try {
                this.analyser.getByteTimeDomainData(this.dataArray);
                let sum = 0;
                for (let i = 0; i < this.dataArray.length; i++) {
                    const sample = (this.dataArray[i] - 128) / 128.0;
                    sum += sample * sample;
                }
                this.micLevel = clamp(Math.sqrt(sum / this.dataArray.length), 0, 1);
            } catch (e) {
                // Keep existing micLevel
            }
        }

        // 2. Track peak mic level during active calibration phase
        if (this.calibrationPhase) {
            this.calibrationCurrentMax = Math.max(this.calibrationCurrentMax, this.micLevel);
            this.calibrationTimer += dt;
            if (this.calibrationData.hasOwnProperty(this.calibrationPhase)) {
                this.calibrationData[this.calibrationPhase] = this.calibrationCurrentMax;
            }
        }

        // 3. Smooth mic level with MIC_SMOOTHING
        this.smoothedLevel = lerp(this.smoothedLevel, this.micLevel, MIC_SMOOTHING);

        // 4. Decay heartbeat noise pulse
        if (this.heartbeatNoise > 0) {
            this.heartbeatNoise = Math.max(0, this.heartbeatNoise - dt * 0.25);
        }

        // 5. Compute final noise bar value
        const micContribution = this.smoothedLevel * this.micGain;
        const targetNoise = clamp(
            micContribution + (movementNoise || 0) + (stoneNoise || 0) + (environmentNoise || 0) + this.heartbeatNoise,
            0,
            1
        );

        if (this.muted) {
            // When muted (holding breath), noiseBarValue gradually approaches 0
            this.noiseBarValue = lerp(this.noiseBarValue, 0, clamp(dt * 6.0, 0, 1));
            if (this.noiseBarValue < 0.001) this.noiseBarValue = 0;
        } else {
            this.noiseBarValue = targetNoise;
        }
    }

    /**
     * Get current noise bar value (0-1).
     * @returns {number}
     */
    getNoiseBar() {
        return this.noiseBarValue;
    }

    /**
     * Checks if current noise is at or above the red line threshold.
     * @returns {boolean}
     */
    isAboveRedLine() {
        return this.noiseBarValue >= this.redLine;
    }

    /**
     * Get raw microphone level (0-1).
     * @returns {number}
     */
    getMicLevel() {
        return this.micLevel;
    }

    /**
     * Simulate microphone level manually (useful for testing or keyboard-only controls).
     * @param {number} level - 0 to 1
     */
    simulateMicLevel(level) {
        if (!this.micActive) {
            this.micLevel = clamp(level, 0, 1);
        }
    }

    /**
     * Mute or unmute the noise bar (e.g., when holding breath or hiding).
     * @param {boolean} muted
     */
    setMuted(muted) {
        this.muted = !!muted;
    }

    /**
     * Start playing dark atmospheric ambient drone sound.
     * Composed of 40-60Hz modulated oscillator, 80Hz tremolo oscillator, and filtered noise.
     */
    startAmbient() {
        if (this.ambientPlaying) return;

        try {
            const ctx = this._ensureAudioContext();
            if (!ctx) return;
            const now = ctx.currentTime;

            // Ambient master gain node with smooth fade-in
            const ambGain = ctx.createGain();
            ambGain.gain.setValueAtTime(0.0001, now);
            ambGain.gain.exponentialRampToValueAtTime(0.15, now + 2.0);
            ambGain.connect(this.masterGain);
            this.ambientGain = ambGain;

            const nodes = [];

            // 1. Low-frequency oscillator (48Hz) with slow frequency modulation
            const osc1 = ctx.createOscillator();
            osc1.type = 'sine';
            osc1.frequency.setValueAtTime(48, now);

            const lfo1 = ctx.createOscillator();
            const lfo1Gain = ctx.createGain();
            lfo1.type = 'sine';
            lfo1.frequency.setValueAtTime(0.2, now); // 0.2Hz drift
            lfo1Gain.gain.setValueAtTime(6.0, now);   // modulates +/- 6Hz
            lfo1.connect(osc1.frequency);

            const osc1Gain = ctx.createGain();
            osc1Gain.gain.setValueAtTime(0.18, now);
            osc1.connect(osc1Gain);
            osc1Gain.connect(ambGain);

            osc1.start(now);
            lfo1.start(now);
            nodes.push(osc1, lfo1, lfo1Gain, osc1Gain);

            // 2. Second oscillator at 80Hz with tremolo
            const osc2 = ctx.createOscillator();
            osc2.type = 'triangle';
            osc2.frequency.setValueAtTime(80, now);

            const osc2Gain = ctx.createGain();
            osc2Gain.gain.setValueAtTime(0.06, now);

            const lfo2 = ctx.createOscillator();
            const lfo2Gain = ctx.createGain();
            lfo2.type = 'sine';
            lfo2.frequency.setValueAtTime(1.6, now); // tremolo speed
            lfo2Gain.gain.setValueAtTime(0.035, now); // tremolo depth
            lfo2.connect(osc2Gain.gain);

            osc2.connect(osc2Gain);
            osc2Gain.connect(ambGain);

            osc2.start(now);
            lfo2.start(now);
            nodes.push(osc2, lfo2, lfo2Gain, osc2Gain);

            // 3. Filtered white noise for cavernous air / hiss
            const noise = ctx.createBufferSource();
            noise.buffer = this._getNoiseBuffer();
            noise.loop = true;

            const noiseFilter = ctx.createBiquadFilter();
            noiseFilter.type = 'lowpass';
            noiseFilter.frequency.setValueAtTime(150, now);
            noiseFilter.Q.value = 2.0;

            const noiseGain = ctx.createGain();
            noiseGain.gain.setValueAtTime(0.04, now);

            noise.connect(noiseFilter);
            noiseFilter.connect(noiseGain);
            noiseGain.connect(ambGain);

            noise.start(now);
            nodes.push(noise, noiseFilter, noiseGain);

            this.ambientNodes = nodes;
            this.ambientPlaying = true;
        } catch (e) {
            console.warn('Failed to start ambient audio:', e);
            this.ambientPlaying = false;
        }
    }

    /**
     * Stop the ambient drone sound with smooth fade-out.
     */
    stopAmbient() {
        if (!this.ambientPlaying) return;
        this.ambientPlaying = false;

        try {
            if (this.ambientGain && this.audioCtx) {
                const now = this.audioCtx.currentTime;
                this.ambientGain.gain.setValueAtTime(Math.max(0.0001, this.ambientGain.gain.value), now);
                this.ambientGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.0);
            }

            const nodesToStop = this.ambientNodes || [];
            this.ambientNodes = [];

            setTimeout(() => {
                nodesToStop.forEach(node => {
                    try {
                        if (node.stop) node.stop();
                        if (node.disconnect) node.disconnect();
                    } catch (e) {}
                });
                if (this.ambientGain) {
                    try { this.ambientGain.disconnect(); } catch (e) {}
                    this.ambientGain = null;
                }
            }, 1100);
        } catch (e) {
            console.warn('Failed to stop ambient audio:', e);
        }
    }

    /**
     * Play heartbeat sounds based on panic / proximity intensity (0-1).
     * Increases rate, volume, and noise generation as intensity rises.
     * @param {number} dt - delta time in seconds
     * @param {number} intensity - 0 to 1
     */
    updateHeartbeat(dt, intensity) {
        this.heartbeatIntensity = clamp(intensity, 0, 1);

        // Do not trigger heartbeat if intensity is negligible
        if (this.heartbeatIntensity <= 0.05) {
            this.heartbeatTimer = 0;
            return;
        }

        const rate = lerp(HEARTBEAT_BASE_RATE, HEARTBEAT_MAX_RATE, this.heartbeatIntensity);
        const interval = 1.0 / rate;

        this.heartbeatTimer += dt;
        if (this.heartbeatTimer >= interval) {
            this.heartbeatTimer -= interval;
            if (this.heartbeatTimer >= interval) this.heartbeatTimer = 0;

            this._playHeartbeatThuds(this.heartbeatIntensity);

            // Add noise contribution per heartbeat when panicked
            if (this.heartbeatIntensity > 0.35) {
                this.heartbeatNoise = Math.min(1.0, this.heartbeatNoise + HEARTBEAT_NOISE_ADD * this.heartbeatIntensity);
            }
        }
    }

    /**
     * Plays the two quick low-frequency thuds of a single heartbeat cycle.
     * @param {number} intensity
     * @private
     */
    _playHeartbeatThuds(intensity) {
        try {
            const ctx = this._ensureAudioContext();
            if (!ctx) return;
            const now = ctx.currentTime;
            const vol = lerp(0.12, 0.45, intensity);

            // Thud 1 (Lub)
            this._playSingleHeartbeatThud(now, 56, 42, vol, 0.08);

            // Thud 2 (Dub) slightly quieter and ~0.12s later
            this._playSingleHeartbeatThud(now + 0.12, 50, 38, vol * 0.8, 0.07);
        } catch (e) {}
    }

    /**
     * Single low-frequency heartbeat thud.
     * @private
     */
    _playSingleHeartbeatThud(startTime, startFreq, endFreq, volume, duration) {
        const ctx = this.audioCtx;
        const osc = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(startFreq, startTime);
        osc.frequency.exponentialRampToValueAtTime(endFreq, startTime + duration);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(100, startTime);

        gain.gain.setValueAtTime(0.001, startTime);
        gain.gain.linearRampToValueAtTime(volume, startTime + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);

        osc.start(startTime);
        osc.stop(startTime + duration + 0.02);
    }

    /**
     * Play a one-shot procedural sound effect.
     * Supported types:
     * 'drip', 'creak', 'clang', 'footstep_water', 'footstep_loud',
     * 'stone_pickup', 'door_open', 'static', 'whisper', 'listener_growl', 'chase_start'
     * @param {string} type
     */
    playSound(type) {
        try {
            const ctx = this._ensureAudioContext();
            if (!ctx) return;

            switch (type) {
                case 'drip':
                    this._soundDrip(ctx);
                    break;
                case 'creak':
                    this._soundCreak(ctx);
                    break;
                case 'clang':
                    this._soundClang(ctx);
                    break;
                case 'footstep_water':
                    this._soundFootstepWater(ctx);
                    break;
                case 'footstep_loud':
                    this._soundFootstepLoud(ctx);
                    break;
                case 'footstep':
                    this._soundFootstepNormal(ctx);
                    break;
                case 'stone_pickup':
                    this._soundStonePickup(ctx);
                    break;
                case 'door_open':
                    this._soundDoorOpen(ctx);
                    break;
                case 'static':
                    this._soundStatic(ctx);
                    break;
                case 'whisper':
                    this._soundWhisper(ctx);
                    break;
                case 'listener_growl':
                    this._soundListenerGrowl(ctx);
                    break;
                case 'chase_start':
                    this._soundChaseStart(ctx);
                    break;
                default:
                    console.warn('Unknown sound type:', type);
                    break;
            }
        } catch (e) {
            console.warn(`Error playing sound effect '${type}':`, e);
        }
    }

    /**
     * Drip: Short noise burst filtered through high bandpass with quick exponential decay.
     * @private
     */
    _soundDrip(ctx) {
        const now = ctx.currentTime;
        const noise = ctx.createBufferSource();
        noise.buffer = this._getNoiseBuffer();

        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(2100 + randomFloat(-150, 200), now);
        filter.Q.value = 10.0;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.18, now + 0.003);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);

        // Subtle water droplet tone drop
        const tone = ctx.createOscillator();
        tone.type = 'sine';
        const startFreq = 1650 + randomFloat(-100, 100);
        tone.frequency.setValueAtTime(startFreq, now);
        tone.frequency.exponentialRampToValueAtTime(startFreq * 0.7, now + 0.06);

        const toneGain = ctx.createGain();
        toneGain.gain.setValueAtTime(0.001, now);
        toneGain.gain.linearRampToValueAtTime(0.12, now + 0.005);
        toneGain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

        tone.connect(toneGain);
        toneGain.connect(this.masterGain);

        noise.start(now);
        tone.start(now);
        noise.stop(now + 0.08);
        tone.stop(now + 0.08);
    }

    /**
     * Creak: Noise through a narrow bandpass filter (300-600Hz) with slow attack and medium decay.
     * @private
     */
    _soundCreak(ctx) {
        const now = ctx.currentTime;
        const noise = ctx.createBufferSource();
        noise.buffer = this._getNoiseBuffer();

        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        const startFreq = 340 + randomFloat(-30, 30);
        const peakFreq = 520 + randomFloat(-30, 50);
        filter.frequency.setValueAtTime(startFreq, now);
        filter.frequency.linearRampToValueAtTime(peakFreq, now + 0.22);
        filter.frequency.linearRampToValueAtTime(startFreq - 20, now + 0.6);
        filter.Q.value = 7.5;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.24, now + 0.16);
        gain.gain.setValueAtTime(0.2, now + 0.32);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.62);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);

        noise.start(now);
        noise.stop(now + 0.65);
    }

    /**
     * Clang: Short metallic sound - noise burst with resonant filter at 800Hz.
     * @private
     */
    _soundClang(ctx) {
        const now = ctx.currentTime;
        const noise = ctx.createBufferSource();
        noise.buffer = this._getNoiseBuffer();

        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(800, now);
        filter.Q.value = 16.0;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.32, now + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);

        // Resonant inharmonic metallic ringings
        [800, 1280, 1960].forEach(freq => {
            const osc = ctx.createOscillator();
            const oscGain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq + randomFloat(-10, 10), now);

            oscGain.gain.setValueAtTime(0.001, now);
            oscGain.gain.linearRampToValueAtTime(0.1, now + 0.005);
            oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

            osc.connect(oscGain);
            oscGain.connect(this.masterGain);

            osc.start(now);
            osc.stop(now + 0.55);
        });

        noise.start(now);
        noise.stop(now + 0.5);
    }

    /**
     * Footstep Water: Low noise burst with very short decay, slight pitch variation.
     * @private
     */
    _soundFootstepWater(ctx) {
        const now = ctx.currentTime;
        const noise = ctx.createBufferSource();
        noise.buffer = this._getNoiseBuffer();

        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(460 + randomFloat(-50, 50), now);
        filter.Q.value = 2.2;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.2, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

        // High splash spray
        const splash = ctx.createBiquadFilter();
        splash.type = 'highpass';
        splash.frequency.setValueAtTime(2400, now);

        const splashGain = ctx.createGain();
        splashGain.gain.setValueAtTime(0.001, now);
        splashGain.gain.linearRampToValueAtTime(0.08, now + 0.015);
        splashGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);

        noise.connect(splash);
        splash.connect(splashGain);
        splashGain.connect(this.masterGain);

        noise.start(now);
        noise.stop(now + 0.14);
    }

    /**
     * Footstep Loud: Sharper noise burst than normal, with creaky overtone.
     * @private
     */
    _soundFootstepLoud(ctx) {
        const now = ctx.currentTime;
        const noise = ctx.createBufferSource();
        noise.buffer = this._getNoiseBuffer();

        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(950 + randomFloat(-60, 60), now);
        filter.Q.value = 3.2;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.35, now + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);

        // Creaky overtone
        const creak = ctx.createOscillator();
        creak.type = 'triangle';
        creak.frequency.setValueAtTime(360 + randomFloat(-25, 25), now);
        creak.frequency.linearRampToValueAtTime(420, now + 0.1);

        const creakGain = ctx.createGain();
        creakGain.gain.setValueAtTime(0.001, now);
        creakGain.gain.linearRampToValueAtTime(0.12, now + 0.02);
        creakGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

        creak.connect(creakGain);
        creakGain.connect(this.masterGain);

        noise.start(now);
        creak.start(now);
        noise.stop(now + 0.2);
        creak.stop(now + 0.2);
    }

    /**
     * Normal Footstep: Muffled subtle thud for regular floors.
     * @private
     */
    _soundFootstepNormal(ctx) {
        const now = ctx.currentTime;
        const noise = ctx.createBufferSource();
        noise.buffer = this._getNoiseBuffer();

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(400 + randomFloat(-40, 40), now);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.15, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);

        noise.start(now);
        noise.stop(now + 0.1);
    }

    /**
     * Stone Pickup: Rising tone (200-800Hz) over 0.5 seconds with ethereal quality and delay.
     * @private
     */
    _soundStonePickup(ctx) {
        const now = ctx.currentTime;

        const osc = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        // Echo / reverb-like delay loop
        const delay = ctx.createDelay();
        delay.delayTime.value = 0.15;
        const feedback = ctx.createGain();
        feedback.gain.value = 0.35;
        const delayGain = ctx.createGain();
        delayGain.gain.value = 0.4;

        delay.connect(feedback);
        feedback.connect(delay);
        delay.connect(delayGain);
        delayGain.connect(this.masterGain);

        // Frequencies rising 200 -> 800Hz
        osc.type = 'sine';
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.exponentialRampToValueAtTime(800, now + 0.5);

        // Ethereal overtone
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(400, now);
        osc2.frequency.exponentialRampToValueAtTime(1600, now + 0.5);

        const osc2Gain = ctx.createGain();
        osc2Gain.gain.value = 0.25;
        osc2.connect(osc2Gain);
        osc2Gain.connect(gain);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.28, now + 0.08);
        gain.gain.setValueAtTime(0.28, now + 0.4);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);

        osc.connect(gain);
        gain.connect(this.masterGain);
        gain.connect(delay);

        osc.start(now);
        osc2.start(now);
        osc.stop(now + 0.7);
        osc2.stop(now + 0.7);

        setTimeout(() => {
            try {
                delay.disconnect();
                feedback.disconnect();
                delayGain.disconnect();
            } catch (e) {}
        }, 1500);
    }

    /**
     * Door Open: Low grinding noise and creaking wood/stone.
     * @private
     */
    _soundDoorOpen(ctx) {
        const now = ctx.currentTime;
        const noise = ctx.createBufferSource();
        noise.buffer = this._getNoiseBuffer();

        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(320, now);
        filter.frequency.linearRampToValueAtTime(480, now + 0.8);
        filter.Q.value = 3.8;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.25, now + 0.15);
        gain.gain.setValueAtTime(0.22, now + 0.7);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);

        // Sub rumble
        const rumble = ctx.createOscillator();
        rumble.type = 'triangle';
        rumble.frequency.setValueAtTime(70, now);
        rumble.frequency.linearRampToValueAtTime(50, now + 1.0);

        const rumbleGain = ctx.createGain();
        rumbleGain.gain.setValueAtTime(0.001, now);
        rumbleGain.gain.linearRampToValueAtTime(0.18, now + 0.1);
        rumbleGain.gain.exponentialRampToValueAtTime(0.001, now + 1.1);

        rumble.connect(rumbleGain);
        rumbleGain.connect(this.masterGain);

        noise.start(now);
        rumble.start(now);
        noise.stop(now + 1.25);
        rumble.stop(now + 1.25);
    }

    /**
     * Static: Filtered white noise for walkie-talkie effect.
     * @private
     */
    _soundStatic(ctx) {
        const now = ctx.currentTime;
        const noise = ctx.createBufferSource();
        noise.buffer = this._getNoiseBuffer();

        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(1500, now);
        filter.Q.value = 1.4;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.22, now + 0.02);
        gain.gain.setValueAtTime(0.2, now + 0.35);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);

        noise.start(now);
        noise.stop(now + 0.55);
    }

    /**
     * Whisper: Filtered noise to simulate whispering (500-2000Hz bandpass, very quiet).
     * @private
     */
    _soundWhisper(ctx) {
        const now = ctx.currentTime;
        const noise = ctx.createBufferSource();
        noise.buffer = this._getNoiseBuffer();

        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(1150, now);
        filter.Q.value = 1.8; // spans roughly 500-2000Hz

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.09, now + 0.2);
        gain.gain.setValueAtTime(0.07, now + 0.6);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 1.1);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);

        noise.start(now);
        noise.stop(now + 1.15);
    }

    /**
     * Listener Growl: Very low rumble (30-50Hz) with slight modulation. Unsettling.
     * @private
     */
    _soundListenerGrowl(ctx) {
        const now = ctx.currentTime;

        const osc = ctx.createOscillator();
        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        const oscGain = ctx.createGain();
        const filter = ctx.createBiquadFilter();

        // Very low pitch rumble crawling down from 46Hz to 32Hz
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(46, now);
        osc.frequency.exponentialRampToValueAtTime(32, now + 2.0);

        // Guttural modulation flutter (14Hz)
        lfo.type = 'sine';
        lfo.frequency.setValueAtTime(14, now);
        lfoGain.gain.setValueAtTime(0.28, now);
        lfo.connect(oscGain.gain);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(120, now);
        filter.Q.value = 3.0;

        oscGain.gain.setValueAtTime(0.001, now);
        oscGain.gain.linearRampToValueAtTime(0.35, now + 0.3);
        oscGain.gain.setValueAtTime(0.35, now + 1.2);
        oscGain.gain.exponentialRampToValueAtTime(0.001, now + 2.0);

        osc.connect(filter);
        filter.connect(oscGain);
        oscGain.connect(this.masterGain);

        // Breathy low noise layer
        const noise = ctx.createBufferSource();
        noise.buffer = this._getNoiseBuffer();
        const noiseFilter = ctx.createBiquadFilter();
        noiseFilter.type = 'bandpass';
        noiseFilter.frequency.setValueAtTime(80, now);
        noiseFilter.Q.value = 2.0;

        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(0.001, now);
        noiseGain.gain.linearRampToValueAtTime(0.08, now + 0.4);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 2.0);

        noise.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(this.masterGain);

        osc.start(now);
        lfo.start(now);
        noise.start(now);
        osc.stop(now + 2.0);
        lfo.stop(now + 2.0);
        noise.stop(now + 2.0);
    }

    /**
     * Chase Start: Dramatic low tone (100Hz) that rises, with distortion. Alarming!
     * @private
     */
    _soundChaseStart(ctx) {
        const now = ctx.currentTime;

        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator(); // Dissonant tritone
        const waveShaper = ctx.createWaveShaper();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();

        waveShaper.curve = this._makeDistortionCurve(50);
        waveShaper.oversample = '4x';

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(450, now);
        filter.frequency.exponentialRampToValueAtTime(3200, now + 0.8);

        osc1.type = 'sawtooth';
        osc1.frequency.setValueAtTime(100, now);
        osc1.frequency.exponentialRampToValueAtTime(280, now + 1.0);

        osc2.type = 'sawtooth';
        osc2.frequency.setValueAtTime(141.4, now); // ~100 * sqrt(2)
        osc2.frequency.exponentialRampToValueAtTime(396, now + 1.0);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.42, now + 0.04);
        gain.gain.setValueAtTime(0.38, now + 0.7);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 1.4);

        osc1.connect(waveShaper);
        osc2.connect(waveShaper);
        waveShaper.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);

        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 1.4);
        osc2.stop(now + 1.4);
    }

    /**
     * Play a fake voice mimic (the Listener copying a player).
     * Uses the SpeechSynthesis API with a creepy, distorted whisper-like delivery.
     * Falls back to procedural filtered whisper if SpeechSynthesis is unavailable.
     * @param {string} phrase
     */
    playMimic(phrase) {
        const text = phrase || "I hear you...";
        let spoken = false;

        try {
            if (typeof window !== 'undefined' && 'speechSynthesis' in window && window.SpeechSynthesisUtterance) {
                window.speechSynthesis.cancel();

                const utterance = new SpeechSynthesisUtterance(text);
                utterance.rate = 0.7;
                utterance.pitch = 0.5;
                utterance.volume = 0.85;

                const voices = window.speechSynthesis.getVoices();
                if (voices && voices.length > 0) {
                    const creepyVoice = voices.find(v =>
                        v.name.toLowerCase().includes('whisper') ||
                        v.name.toLowerCase().includes('zarvox') ||
                        (v.lang && v.lang.startsWith('en'))
                    );
                    if (creepyVoice) {
                        utterance.voice = creepyVoice;
                    }
                }

                // Layer eerie procedural whisper sound alongside voice
                this.playSound('whisper');

                window.speechSynthesis.speak(utterance);
                spoken = true;
            }
        } catch (e) {
            console.warn('SpeechSynthesis failed:', e);
            spoken = false;
        }

        if (!spoken) {
            // Fallback to procedural creepy whisper sound
            this.playSound('whisper');
        }
    }

    /**
     * Cleanup and release all audio nodes and microphone streams.
     */
    destroy() {
        this.stopAmbient();

        if (this.stream) {
            try {
                this.stream.getTracks().forEach(track => track.stop());
            } catch (e) {}
            this.stream = null;
        }

        if (this.micSource) {
            try { this.micSource.disconnect(); } catch (e) {}
            this.micSource = null;
        }

        if (this.analyser) {
            try { this.analyser.disconnect(); } catch (e) {}
            this.analyser = null;
        }

        if (this.masterGain) {
            try { this.masterGain.disconnect(); } catch (e) {}
            this.masterGain = null;
        }

        if (this.audioCtx && this.audioCtx.state !== 'closed') {
            try {
                this.audioCtx.close().catch(() => {});
            } catch (e) {}
            this.audioCtx = null;
        }

        this.micActive = false;
        this.calibrated = false;
        this.ambientPlaying = false;
        this._noiseBuffer = null;
        this._distortionCurve = null;
    }

    startChase() {
        this.playSound('chase_start');
    }

    stopChase() {
        // Can be used for custom chase music fade out
    }

    playDeath() {
        this.playSound('listener_growl');
    }

    createNoise(x, y, volume) {
        this.playSound('clang');
    }
}

// Global scope export for vanilla JS environment
if (typeof window !== 'undefined') {
    window.AudioManager = AudioManager;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AudioManager };
}
