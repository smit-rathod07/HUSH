// ============================================================
// HUSH - Story Cutscene System
// ============================================================
// Cinematic animated story clip explaining the Listener's tragic origin:
// A normal stranger who ran into the collapsing station to save a crying child,
// died unsatisfied pinned beneath rubble, whose grief crystallized into memory
// stones and twisted him into the blind, listening entity.

class StoryCutscene {
    constructor() {
        this.active = false;
        this.outcome = 'victory'; // 'victory' | 'defeat'
        this.currentSlide = 0;
        this.slideTimer = 0;
        this.slideDuration = 7.0; // Seconds per slide before auto-advancing
        this.fadeAlpha = 0;
        this.isFading = false;
        this.fadeDirection = 1; // 1 = fade in, -1 = fade out
        this.particles = [];
        this.onCompleteCallback = null;
        this.textProgress = 0; // Typewriter text reveal
        this.lastSlideIndex = -1;

        // Visual effects timing
        this.sceneTime = 0;
    }

    /**
     * Start the end-game story cutscene
     * @param {'victory'|'defeat'} outcome
     * @param {Function} onComplete
     */
    start(outcome = 'victory', onComplete = null) {
        this.active = true;
        this.outcome = outcome;
        this.currentSlide = 0;
        this.slideTimer = 0;
        this.sceneTime = 0;
        this.fadeAlpha = 1.0;
        this.fadeDirection = -1; // Fade in from black
        this.textProgress = 0;
        this.onCompleteCallback = onComplete;
        this.particles = [];
        this.initSlideParticles(0);

        // Sound cue
        if (typeof window !== 'undefined' && window.audioManager) {
            if (outcome === 'victory') {
                window.audioManager.playSound('stone_pickup');
            } else {
                window.audioManager.playSound('creak');
            }
        }
    }

    getSlides() {
        const commonSlides = [
            {
                chapter: 'PROLOGUE',
                title: 'THE STRANGER BEFORE THE RUINS',
                text: 'Years ago, this dead subway was a bustling hostel and transit station. The entity that now stalks these halls was once an ordinary man—a quiet, kind stranger on his way home from work.',
                subtitle: 'He had a life, a name, and a heart that could not turn away.'
            },
            {
                chapter: 'THE CAVE-IN',
                title: 'A CRY IN THE CRUMBLING DARK',
                text: 'When the tremors struck and the ceilings began to tear apart, everyone fled to the surface to save themselves. But from deep in the lower halls, he heard a little girl crying out in terror for help.',
                subtitle: 'A stranger who simply could not walk away from a crying child.'
            },
            {
                chapter: 'THE ATTEMPT',
                title: 'SECONDS FROM REACHING HER',
                text: 'He ran headfirst into the collapsing dark. He leaped through falling rubble and smoke, arm outstretched, his fingers inches away from taking her hand. Then the entire building caved in on them both.',
                subtitle: 'The ceiling fell. Darkness swallowed them.'
            },
            {
                chapter: 'THE CRYSTALLIZATION',
                title: 'UNSATISFIED AGONY & THE STONES',
                text: 'Pinned beneath massive concrete slabs, he died listening to her voice fade into eternal silence... inches away, unable to answer. He died unsatisfied, crushed by unbearable guilt and grief. His worst memories crystallized into glowing stones.',
                subtitle: 'Every stone holds his final moments: the cries, the collapse, the silence.'
            },
            {
                chapter: 'THE AFTERLIFE',
                title: 'THE BIRTH OF THE LISTENER',
                text: 'His soul never rested. Decades in the dark withered his eyes, but his hearing became endless. Trapped in his own nightmare, every sound in the ruins became her cry. He was never a monster hunting prey—he was still trying to find her.',
                subtitle: 'You were never running from a monster. You were walking through a man\'s afterlife.'
            }
        ];

        if (this.outcome === 'victory') {
            return [
                ...commonSlides,
                {
                    chapter: 'FINALE: REDEMPTION',
                    title: 'THE SILENCE IS AT PEACE',
                    text: 'By carrying his memory stones to the exit machine, you pulled decades of grief out of the walls. The burden is lifted. The doll mask shatters into light, revealing the gentle, relieved smile of a man finally at peace.',
                    subtitle: 'For the first time in forty years, the silent stranger rests.'
                }
            ];
        } else {
            return [
                ...commonSlides,
                {
                    chapter: 'FINALE: TRAPPED IN MEMORY',
                    title: 'STILL SEARCHING IN THE VOID',
                    text: 'You fell in the darkness, but now you understand his pain. He stands alone on the dead platform, head tilted, weeping in the silence. He is still waiting for a child he can never reach.',
                    subtitle: 'Will someone return to guide him home?'
                }
            ];
        }
    }

    initSlideParticles(slideIndex) {
        this.particles = [];
        const count = 45;
        for (let i = 0; i < count; i++) {
            this.particles.push({
                x: Math.random() * (window.innerWidth || 1280),
                y: Math.random() * (window.innerHeight || 720),
                vx: (Math.random() - 0.5) * 20,
                vy: (Math.random() * 25) + 10,
                size: Math.random() * 3 + 1,
                alpha: Math.random() * 0.7 + 0.3,
                color: slideIndex === 5 && this.outcome === 'victory' ? '#ffdd66' : '#8899aa'
            });
        }
    }

    nextSlide() {
        const slides = this.getSlides();
        if (this.currentSlide < slides.length - 1) {
            this.currentSlide++;
            this.slideTimer = 0;
            this.textProgress = 0;
            this.fadeAlpha = 0.5;
            this.initSlideParticles(this.currentSlide);
            
            // Subtle transition audio chime
            if (typeof window !== 'undefined' && window.audioManager) {
                if (this.currentSlide === slides.length - 1 && this.outcome === 'victory') {
                    window.audioManager.playSound('ghost_banish');
                } else {
                    window.audioManager.playSound('whisper');
                }
            }
        } else {
            this.finish();
        }
    }

    skip() {
        this.finish();
    }

    finish() {
        this.active = false;
        if (typeof this.onCompleteCallback === 'function') {
            this.onCompleteCallback();
        }
    }

    update(dt) {
        if (!this.active) return;
        const safeDt = Math.min(dt || 0.016, 0.1);
        this.sceneTime += safeDt;
        this.slideTimer += safeDt;
        this.textProgress = Math.min(1.0, this.textProgress + safeDt * 0.9);

        // Fade in/out transitions
        if (this.fadeDirection < 0) {
            this.fadeAlpha = Math.max(0, this.fadeAlpha - safeDt * 1.5);
        } else if (this.fadeDirection > 0) {
            this.fadeAlpha = Math.min(1, this.fadeAlpha + safeDt * 2.0);
            if (this.fadeAlpha >= 1.0) {
                this.nextSlide();
                this.fadeDirection = -1;
            }
        }

        // Auto-advance slide if player doesn't click
        if (this.slideTimer >= this.slideDuration && this.fadeDirection <= 0) {
            const slides = this.getSlides();
            if (this.currentSlide < slides.length - 1) {
                this.fadeDirection = 1; // start fade out to next slide
            } else {
                this.finish();
            }
        }

        // Update atmospheric particles
        const w = window.innerWidth || 1280;
        const h = window.innerHeight || 720;
        for (const p of this.particles) {
            p.x += p.vx * safeDt;
            p.y += p.vy * safeDt;
            if (p.y > h) {
                p.y = -10;
                p.x = Math.random() * w;
            }
        }
    }

    /**
     * Render the cutscene onto the main canvas
     */
    render(ctx, width, height) {
        if (!this.active) return;

        const slides = this.getSlides();
        const slide = slides[this.currentSlide] || slides[0];

        ctx.save();

        // 1. Solid deep background
        ctx.fillStyle = '#05060a';
        ctx.fillRect(0, 0, width, height);

        // 2. Draw procedural cinematic art for the current slide
        this.drawSceneArt(ctx, width, height, this.currentSlide);

        // 3. Draw drifting ambient particles (rain, dust, glowing embers)
        this.drawParticles(ctx);

        // 4. Cinematic Letterbox Bars (Top & Bottom black cinema borders)
        const letterboxH = Math.round(height * 0.14);
        ctx.fillStyle = '#030306';
        ctx.fillRect(0, 0, width, letterboxH);
        ctx.fillRect(0, height - letterboxH, width, letterboxH);

        // Letterbox border lines
        ctx.strokeStyle = 'rgba(70, 90, 120, 0.35)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, letterboxH);
        ctx.lineTo(width, letterboxH);
        ctx.moveTo(0, height - letterboxH);
        ctx.lineTo(width, height - letterboxH);
        ctx.stroke();

        // 5. Header: Chapter Title & Timeline Dots
        this.drawHeader(ctx, width, letterboxH, slide, slides.length);

        // 6. Subtitle & Story Card at Bottom
        this.drawSubtitleCard(ctx, width, height, letterboxH, slide);

        // 7. Navigation Hints: [Click / Space to continue] & [ESC to Skip]
        this.drawControlsHint(ctx, width, height);

        // 8. Screen Fade Overlay
        if (this.fadeAlpha > 0) {
            ctx.fillStyle = `rgba(3, 4, 8, ${this.fadeAlpha})`;
            ctx.fillRect(0, 0, width, height);
        }

        ctx.restore();
    }

    drawHeader(ctx, width, letterboxH, slide, totalSlides) {
        const topY = Math.round(letterboxH / 2);

        // Chapter tag
        ctx.font = 'bold 11px monospace';
        ctx.fillStyle = '#65b2f0';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`✦ STORY CLIP — ${slide.chapter}`, 40, topY);

        // Chapter Main Title
        ctx.font = '13px monospace';
        ctx.fillStyle = '#ccddee';
        ctx.fillText(slide.title, 260, topY);

        // Slide dots / timeline indicator on right
        const dotSpacing = 16;
        const totalW = (totalSlides - 1) * dotSpacing;
        const startX = width - 40 - totalW;
        for (let i = 0; i < totalSlides; i++) {
            ctx.beginPath();
            ctx.arc(startX + i * dotSpacing, topY, i === this.currentSlide ? 4.5 : 2.5, 0, Math.PI * 2);
            if (i === this.currentSlide) {
                ctx.fillStyle = '#00ffee';
                ctx.shadowColor = '#00ffee';
                ctx.shadowBlur = 8;
            } else if (i < this.currentSlide) {
                ctx.fillStyle = '#4488aa';
                ctx.shadowBlur = 0;
            } else {
                ctx.fillStyle = '#223344';
                ctx.shadowBlur = 0;
            }
            ctx.fill();
        }
        ctx.shadowBlur = 0;
    }

    drawSubtitleCard(ctx, width, height, letterboxH, slide) {
        const cardH = 96;
        const cardY = height - letterboxH - cardH - 12;
        const cardW = Math.min(880, width - 80);
        const cardX = Math.round((width - cardW) / 2);

        // Translucent frosted glass narrative box
        ctx.save();
        ctx.fillStyle = 'rgba(7, 10, 18, 0.85)';
        ctx.strokeStyle = 'rgba(80, 120, 180, 0.35)';
        ctx.lineWidth = 1;
        this.roundRect(ctx, cardX, cardY, cardW, cardH, 8, true, true);

        // Narrative text with graceful typewriter length
        ctx.font = '14px "Courier New", monospace';
        ctx.fillStyle = '#e8edf6';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        const fullText = slide.text;
        const visibleLength = Math.floor(fullText.length * this.textProgress);
        const visibleText = fullText.substring(0, visibleLength);

        // Split text into 2-3 lines nicely
        const words = visibleText.split(' ');
        let line = '';
        const lines = [];
        const maxLineW = cardW - 60;

        for (const w of words) {
            const testLine = line + (line ? ' ' : '') + w;
            if (ctx.measureText(testLine).width > maxLineW && line) {
                lines.push(line);
                line = w;
            } else {
                line = testLine;
            }
        }
        if (line) lines.push(line);

        const startTextY = cardY + 18;
        const lineHeight = 22;
        for (let i = 0; i < lines.length; i++) {
            ctx.fillText(lines[i], width / 2, startTextY + i * lineHeight);
        }

        // Subtitle accent in gold/cyan
        if (slide.subtitle && this.textProgress > 0.6) {
            const subAlpha = Math.min(1.0, (this.textProgress - 0.6) / 0.4);
            ctx.fillStyle = `rgba(235, 185, 90, ${subAlpha})`;
            ctx.font = 'italic 12px monospace';
            ctx.fillText(`“${slide.subtitle}”`, width / 2, cardY + cardH - 22);
        }

        ctx.restore();
    }

    drawControlsHint(ctx, width, height) {
        ctx.font = '10px monospace';
        ctx.fillStyle = 'rgba(140, 160, 190, 0.7)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText('Press [SPACE] or Click to Continue • [ESC] to Skip', width / 2, height - 16);
    }

    drawParticles(ctx) {
        ctx.save();
        for (const p of this.particles) {
            ctx.fillStyle = p.color;
            ctx.globalAlpha = p.alpha;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    /**
     * Procedural visual art customized for each slide of the story
     */
    drawSceneArt(ctx, width, height, slideIndex) {
        const cx = width / 2;
        const cy = height / 2 - 20;

        switch (slideIndex) {
            case 0:
                // Scene 1: The Stranger Before The Collapse (Rain, warm lamp, umbrella silhouette)
                this.drawSceneStranger(ctx, cx, cy, width, height);
                break;
            case 1:
                // Scene 2: The Tremor & The Crying Child
                this.drawSceneCryingChild(ctx, cx, cy, width, height);
                break;
            case 2:
                // Scene 3: The Fatal Cave-In & Outstretched Hand
                this.drawSceneCaveIn(ctx, cx, cy, width, height);
                break;
            case 3:
                // Scene 4: Unsatisfied Death & The Memory Stones
                this.drawSceneMemoryStones(ctx, cx, cy, width, height);
                break;
            case 4:
                // Scene 5: The Birth of the Listener (Porcelain mask & red crying eyes)
                this.drawSceneListenerBirth(ctx, cx, cy, width, height);
                break;
            case 5:
                // Scene 6: Finale (Redemption for victory, Sorrow for defeat)
                if (this.outcome === 'victory') {
                    this.drawSceneVictoryRedemption(ctx, cx, cy, width, height);
                } else {
                    this.drawSceneDefeatSorrow(ctx, cx, cy, width, height);
                }
                break;
        }
    }

    drawSceneStranger(ctx, cx, cy, width, height) {
        // Wet asphalt ground reflection
        const groundY = cy + 120;
        ctx.fillStyle = '#080c14';
        ctx.fillRect(0, groundY, width, height - groundY);

        // Streetlamp post
        const lampX = cx - 180;
        ctx.strokeStyle = '#223048';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(lampX, groundY);
        ctx.lineTo(lampX, cy - 140);
        ctx.quadraticCurveTo(lampX, cy - 170, lampX + 30, cy - 170);
        ctx.stroke();

        // Lamp warm radial glow
        const lampGlow = ctx.createRadialGradient(lampX + 30, cy - 170, 5, lampX + 30, cy - 170, 260);
        lampGlow.addColorStop(0, 'rgba(255, 215, 120, 0.45)');
        lampGlow.addColorStop(0.3, 'rgba(255, 180, 80, 0.18)');
        lampGlow.addColorStop(1, 'rgba(255, 160, 60, 0)');
        ctx.fillStyle = lampGlow;
        ctx.beginPath();
        ctx.arc(lampX + 30, cy - 170, 260, 0, Math.PI * 2);
        ctx.fill();

        // Subway entrance arch
        ctx.fillStyle = '#101624';
        ctx.fillRect(cx + 60, cy - 80, 220, 200);
        ctx.fillStyle = '#04060a';
        ctx.beginPath();
        ctx.arc(cx + 170, cy + 30, 80, Math.PI, 0);
        ctx.lineTo(cx + 250, groundY);
        ctx.lineTo(cx + 90, groundY);
        ctx.closePath();
        ctx.fill();

        // Subway neon sign
        ctx.font = 'bold 10px monospace';
        ctx.fillStyle = 'rgba(100, 200, 255, 0.8)';
        ctx.shadowColor = '#44aaff';
        ctx.shadowBlur = 10;
        ctx.fillText('SUBWAY STATION & REFUGE', cx + 170, cy - 65);
        ctx.shadowBlur = 0;

        // Man's silhouette in raincoat holding umbrella
        const manX = cx - 30;
        ctx.fillStyle = '#141824';
        // Umbrella
        ctx.beginPath();
        ctx.arc(manX, cy - 10, 42, Math.PI, 0);
        ctx.closePath();
        ctx.fill();
        // Umbrella stick & handle
        ctx.strokeStyle = '#141824';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(manX, cy - 10);
        ctx.lineTo(manX, cy + 40);
        ctx.stroke();
        // Head
        ctx.beginPath();
        ctx.arc(manX, cy + 10, 12, 0, Math.PI * 2);
        ctx.fill();
        // Coat
        ctx.beginPath();
        ctx.moveTo(manX - 16, cy + 24);
        ctx.lineTo(manX + 16, cy + 24);
        ctx.lineTo(manX + 22, groundY);
        ctx.lineTo(manX - 22, groundY);
        ctx.closePath();
        ctx.fill();

        // Puddle reflection
        ctx.fillStyle = 'rgba(255, 180, 80, 0.08)';
        ctx.beginPath();
        ctx.ellipse(manX, groundY + 8, 50, 10, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    drawSceneCryingChild(ctx, cx, cy, width, height) {
        // Fractured underground hallway
        ctx.strokeStyle = 'rgba(180, 50, 50, 0.5)';
        ctx.lineWidth = 2;
        // Wall cracks
        ctx.beginPath();
        ctx.moveTo(cx - 260, cy - 140);
        ctx.lineTo(cx - 180, cy - 20);
        ctx.lineTo(cx - 120, cy + 40);
        ctx.lineTo(cx - 60, cy + 120);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(cx + 220, cy - 160);
        ctx.lineTo(cx + 140, cy - 40);
        ctx.lineTo(cx + 80, cy + 80);
        ctx.stroke();

        // Red flickering emergency light
        const emGlow = ctx.createRadialGradient(cx, cy - 100, 5, cx, cy - 100, 220);
        emGlow.addColorStop(0, 'rgba(255, 40, 40, 0.35)');
        emGlow.addColorStop(0.5, 'rgba(180, 20, 20, 0.12)');
        emGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = emGlow;
        ctx.beginPath();
        ctx.arc(cx, cy - 100, 220, 0, Math.PI * 2);
        ctx.fill();

        // Broken turnstiles silhouette
        ctx.fillStyle = '#111520';
        ctx.fillRect(cx - 160, cy + 50, 40, 70);
        ctx.fillRect(cx - 80, cy + 50, 40, 70);
        ctx.fillRect(cx + 40, cy + 50, 40, 70);

        // Frightened little girl silhouette clutching a doll
        const girlX = cx;
        const girlY = cy + 45;
        ctx.fillStyle = '#1a1f30';
        // Head with pigtails
        ctx.beginPath();
        ctx.arc(girlX, girlY, 11, 0, Math.PI * 2);
        ctx.arc(girlX - 10, girlY - 2, 5, 0, Math.PI * 2);
        ctx.arc(girlX + 10, girlY - 2, 5, 0, Math.PI * 2);
        ctx.fill();
        // Dress
        ctx.beginPath();
        ctx.moveTo(girlX - 12, girlY + 11);
        ctx.lineTo(girlX + 12, girlY + 11);
        ctx.lineTo(girlX + 18, girlY + 60);
        ctx.lineTo(girlX - 18, girlY + 60);
        ctx.closePath();
        ctx.fill();

        // Faint sound waves representing her cry
        const wavePulse = (this.sceneTime * 3) % 1;
        ctx.strokeStyle = `rgba(255, 120, 120, ${1.0 - wavePulse})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(girlX, girlY, 20 + wavePulse * 70, 0, Math.PI * 2);
        ctx.stroke();
    }

    drawSceneCaveIn(ctx, cx, cy, width, height) {
        // Dramatic diagonal falling concrete slabs
        ctx.fillStyle = '#1c2235';
        ctx.save();
        ctx.translate(cx - 100, cy - 40);
        ctx.rotate(-0.35);
        ctx.fillRect(-80, -30, 240, 80);
        ctx.restore();

        ctx.fillStyle = '#161a29';
        ctx.save();
        ctx.translate(cx + 80, cy - 60);
        ctx.rotate(0.28);
        ctx.fillRect(-100, -30, 260, 90);
        ctx.restore();

        // Man diving forward desperately reaching out
        const manX = cx - 120;
        const manY = cy + 60;
        ctx.fillStyle = '#22283e';
        // Leaning body
        ctx.beginPath();
        ctx.ellipse(manX, manY, 32, 16, 0.4, 0, Math.PI * 2);
        ctx.fill();
        // Head
        ctx.beginPath();
        ctx.arc(manX + 22, manY - 14, 12, 0, Math.PI * 2);
        ctx.fill();
        // Outstretched arm reaching forward
        ctx.strokeStyle = '#22283e';
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(manX + 20, manY - 4);
        ctx.lineTo(manX + 85, manY - 10);
        ctx.stroke();
        // Outstretched hand
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(manX + 85, manY - 10);
        ctx.lineTo(manX + 105, manY - 14);
        ctx.stroke();

        // Girl's tiny hand reaching back from behind rubble
        const girlHandX = cx + 50;
        const girlHandY = cy + 42;
        ctx.strokeStyle = '#2c3552';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(girlHandX + 40, girlHandY + 20);
        ctx.lineTo(girlHandX, girlHandY);
        ctx.stroke();

        // Flash of light in the agonizing gap between their fingertips
        const gapX = (manX + 105 + girlHandX) / 2;
        const gapY = (manY - 14 + girlHandY) / 2;
        ctx.fillStyle = 'rgba(255, 240, 200, 0.6)';
        ctx.beginPath();
        ctx.arc(gapX, gapY, 8 + Math.sin(this.sceneTime * 10) * 3, 0, Math.PI * 2);
        ctx.fill();
    }

    drawSceneMemoryStones(ctx, cx, cy, width, height) {
        // Deep subterranean rubble layers
        ctx.fillStyle = '#0a0d16';
        ctx.fillRect(0, cy + 40, width, height - cy - 40);

        // Crushed silhouette pinned under slab
        ctx.fillStyle = '#040508';
        ctx.beginPath();
        ctx.ellipse(cx - 30, cy + 70, 60, 20, 0, 0, Math.PI * 2);
        ctx.fill();

        // Massive boulder on top
        ctx.fillStyle = '#141826';
        ctx.beginPath();
        ctx.moveTo(cx - 160, cy + 70);
        ctx.lineTo(cx - 60, cy - 20);
        ctx.lineTo(cx + 120, cy - 10);
        ctx.lineTo(cx + 180, cy + 80);
        ctx.closePath();
        ctx.fill();

        // Three glowing memory stones radiating from his heart
        const stoneDefs = [
            { x: cx - 60, y: cy + 10, color: '#00ffee', glow: 'rgba(0, 255, 238, 0.45)', name: 'STONE I: THE CRYING' },
            { x: cx + 10, y: cy - 45, color: '#ffaa33', glow: 'rgba(255, 170, 51, 0.45)', name: 'STONE II: THE COLLAPSE' },
            { x: cx + 80, y: cy + 20, color: '#dd66ff', glow: 'rgba(221, 102, 255, 0.45)', name: 'STONE III: THE SILENCE' }
        ];

        for (const st of stoneDefs) {
            const floatOffset = Math.sin(this.sceneTime * 2.5 + st.x) * 6;
            const sy = st.y + floatOffset;

            // Radiant glow
            const radGlow = ctx.createRadialGradient(st.x, sy, 3, st.x, sy, 55);
            radGlow.addColorStop(0, st.color);
            radGlow.addColorStop(0.35, st.glow);
            radGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = radGlow;
            ctx.beginPath();
            ctx.arc(st.x, sy, 55, 0, Math.PI * 2);
            ctx.fill();

            // Diamond crystalline core
            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = st.color;
            ctx.shadowBlur = 12;
            ctx.beginPath();
            ctx.moveTo(st.x, sy - 14);
            ctx.lineTo(st.x + 10, sy);
            ctx.lineTo(st.x, sy + 14);
            ctx.lineTo(st.x - 10, sy);
            ctx.closePath();
            ctx.fill();
            ctx.shadowBlur = 0;
        }
    }

    drawSceneListenerBirth(ctx, cx, cy, width, height) {
        // Shadow vignette aura
        const aura = ctx.createRadialGradient(cx, cy, 20, cx, cy, 260);
        aura.addColorStop(0, 'rgba(20, 10, 15, 0.8)');
        aura.addColorStop(0.6, 'rgba(12, 6, 8, 0.5)');
        aura.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = aura;
        ctx.beginPath();
        ctx.arc(cx, cy, 260, 0, Math.PI * 2);
        ctx.fill();

        // Cracked Porcelain Baby Doll Face
        const dollR = 64;
        ctx.fillStyle = '#f0e8dc'; // Porcelain skin
        ctx.beginPath();
        ctx.arc(cx, cy, dollR, 0, Math.PI * 2);
        ctx.fill();

        // Porcelain edge shadow
        ctx.strokeStyle = '#c4b5a0';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Facial hairline cracks
        ctx.strokeStyle = '#2b231a';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx - 20, cy - 50);
        ctx.lineTo(cx - 10, cy - 25);
        ctx.lineTo(cx - 28, cy - 8);
        ctx.moveTo(cx + 15, cy + 10);
        ctx.lineTo(cx + 35, cy + 35);
        ctx.moveTo(cx - 40, cy + 15);
        ctx.lineTo(cx - 15, cy + 28);
        ctx.stroke();

        // Pale white lips
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(cx, cy + 32, 14, 5, 0, 0, Math.PI * 2);
        ctx.fill();

        // Bleeding Glowing Red Eyes
        const eyeOffset = 24;
        const eyeY = cy - 8;
        const eyePulse = Math.sin(this.sceneTime * 6) * 0.3 + 0.7;

        for (const ex of [cx - eyeOffset, cx + eyeOffset]) {
            // Glow
            const eyeGlow = ctx.createRadialGradient(ex, eyeY, 2, ex, eyeY, 32);
            eyeGlow.addColorStop(0, `rgba(255, 30, 30, ${eyePulse})`);
            eyeGlow.addColorStop(0.5, 'rgba(255, 20, 20, 0.3)');
            eyeGlow.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = eyeGlow;
            ctx.beginPath();
            ctx.arc(ex, eyeY, 32, 0, Math.PI * 2);
            ctx.fill();

            // Eye dot
            ctx.fillStyle = '#ff2222';
            ctx.beginPath();
            ctx.arc(ex, eyeY, 6, 0, Math.PI * 2);
            ctx.fill();

            // Red tears dripping down the cheeks
            ctx.strokeStyle = 'rgba(255, 34, 34, 0.75)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(ex, eyeY + 6);
            ctx.lineTo(ex - 2, eyeY + 36);
            ctx.lineTo(ex - 1, eyeY + 54);
            ctx.stroke();
        }

        // Auditory sound wave rings radiating outward (Ears that hear everything)
        const wave = (this.sceneTime * 1.5) % 1;
        ctx.strokeStyle = `rgba(255, 60, 60, ${0.45 * (1.0 - wave)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, dollR + wave * 160, 0, Math.PI * 2);
        ctx.stroke();
    }

    drawSceneVictoryRedemption(ctx, cx, cy, width, height) {
        // Radiant golden dawn rays
        const rayCount = 16;
        for (let i = 0; i < rayCount; i++) {
            const ang = (i / rayCount) * Math.PI * 2 + this.sceneTime * 0.2;
            ctx.fillStyle = 'rgba(255, 220, 120, 0.06)';
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, 380, ang - 0.08, ang + 0.08);
            ctx.closePath();
            ctx.fill();
        }

        // Golden warm center glow
        const sunGlow = ctx.createRadialGradient(cx, cy, 20, cx, cy, 280);
        sunGlow.addColorStop(0, 'rgba(255, 240, 180, 0.6)');
        sunGlow.addColorStop(0.4, 'rgba(255, 200, 90, 0.25)');
        sunGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = sunGlow;
        ctx.beginPath();
        ctx.arc(cx, cy, 280, 0, Math.PI * 2);
        ctx.fill();

        // Shards of the porcelain doll mask peeling away into light
        ctx.fillStyle = 'rgba(240, 230, 215, 0.7)';
        ctx.beginPath();
        ctx.moveTo(cx - 70, cy - 50);
        ctx.lineTo(cx - 40, cy - 80);
        ctx.lineTo(cx - 20, cy - 40);
        ctx.closePath();
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(cx + 40, cy + 30);
        ctx.lineTo(cx + 80, cy + 60);
        ctx.lineTo(cx + 60, cy + 10);
        ctx.closePath();
        ctx.fill();

        // The man's peaceful, gentle silhouette bathed in gold
        ctx.fillStyle = '#2a2218';
        ctx.beginPath();
        ctx.arc(cx, cy - 20, 36, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(cx - 45, cy + 20);
        ctx.quadraticCurveTo(cx, cy + 10, cx + 45, cy + 20);
        ctx.lineTo(cx + 60, cy + 120);
        ctx.lineTo(cx - 60, cy + 120);
        ctx.closePath();
        ctx.fill();

        // Gentle smiling facial profile in warm brown
        ctx.strokeStyle = '#ffdd99';
        ctx.lineWidth = 2;
        // Warm brown eyes at peace
        ctx.fillStyle = '#996633';
        ctx.beginPath();
        ctx.arc(cx - 12, cy - 22, 4, 0, Math.PI * 2);
        ctx.arc(cx + 12, cy - 22, 4, 0, Math.PI * 2);
        ctx.fill();
        // Gentle smile
        ctx.beginPath();
        ctx.arc(cx, cy - 12, 10, 0.2, Math.PI - 0.2);
        ctx.stroke();

        // Floating ascending golden spirit motes
        for (let i = 0; i < 20; i++) {
            const mx = cx + Math.sin(this.sceneTime * 3 + i * 2) * 120;
            const my = (cy + 100 - ((this.sceneTime * 50 + i * 35) % 240));
            ctx.fillStyle = '#ffee88';
            ctx.beginPath();
            ctx.arc(mx, my, 3, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    drawSceneDefeatSorrow(ctx, cx, cy, width, height) {
        // Heavy dark vignette
        const darkGrad = ctx.createRadialGradient(cx, cy, 30, cx, cy, 320);
        darkGrad.addColorStop(0, 'rgba(10, 10, 18, 0.4)');
        darkGrad.addColorStop(0.7, 'rgba(4, 4, 8, 0.85)');
        darkGrad.addColorStop(1, '#020306');
        ctx.fillStyle = darkGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, 320, 0, Math.PI * 2);
        ctx.fill();

        // The Listener standing alone in the dead subway center
        const dollR = 48;
        ctx.fillStyle = '#d5c8b5';
        ctx.beginPath();
        ctx.arc(cx, cy - 10, dollR, 0, Math.PI * 2);
        ctx.fill();

        // Head tilted down in sorrow (curved posture)
        ctx.fillStyle = '#10141f';
        ctx.beginPath();
        ctx.moveTo(cx - 30, cy + 38);
        ctx.lineTo(cx + 30, cy + 38);
        ctx.lineTo(cx + 40, cy + 120);
        ctx.lineTo(cx - 40, cy + 120);
        ctx.closePath();
        ctx.fill();

        // Soft fading red eyes looking downward
        ctx.fillStyle = 'rgba(255, 40, 40, 0.65)';
        ctx.beginPath();
        ctx.arc(cx - 16, cy - 4, 4.5, 0, Math.PI * 2);
        ctx.arc(cx + 16, cy - 4, 4.5, 0, Math.PI * 2);
        ctx.fill();

        // Single red tear splashing on the dark tiles
        const tearY = (cy + ((this.sceneTime * 60) % 110));
        ctx.fillStyle = '#ff3333';
        ctx.beginPath();
        ctx.arc(cx - 16, tearY, 2.5, 0, Math.PI * 2);
        ctx.fill();

        // Floor ripple
        ctx.strokeStyle = 'rgba(255, 50, 50, 0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(cx - 16, cy + 110, 18, 6, 0, 0, Math.PI * 2);
        ctx.stroke();
    }

    roundRect(ctx, x, y, width, height, radius, fill, stroke) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
        if (fill) ctx.fill();
        if (stroke) ctx.stroke();
    }
}

// Export for vanilla and module environments
if (typeof window !== 'undefined') {
    window.StoryCutscene = StoryCutscene;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { StoryCutscene };
}
