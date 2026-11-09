'use strict';
/* ==========================================================================
   PVZ MODERN DAYS — Engine.js  (Archivo 3)
   --------------------------------------------------------------------------
   Contenido:
     Config         Constantes de grilla, economía, físicas y niveles.
     Physics        Utilidades matemáticas (lerp, easing, Bézier, AABB, segmento vs AABB).
     GameObject     Superclase base de entidades (Entities.js extenderá esta clase).
     Sun            Sol con caída gravitacional + rebote (cielo) o parábola (plantas).
     DeltaTimer     Delta Time acotado, escala de tiempo y FPS.
     StateMachine   Máquina de estados genérica (usada por el juego y reutilizable).
     InputManager   Mouse / touch / teclado en coordenadas lógicas 1060x640.
     AudioManager   Web Audio API: SFX/BGM con buffers o síntesis procedural, balbuceos.
     AssetLoader    Precarga de imágenes y audio con progreso (tolera archivos ausentes).
     StoryManager   Diálogos estilo visual novel (capa DOM sobre el canvas).
     Game           Loop principal, pantallas, grilla, cartas, economía y render por capas.

   CONTRATO PARA Entities.js Y LevelManager.js
   --------------------------------------------------------------------------
   PVZ.use(game => { ... })       Ejecuta código cuando el juego ya está arrancado.
   game.registerPlant(def)        def = { id, name, cost, cooldown, color, startCooldown?,
                                          canPlace?(game,row,col), create(game,row,col),
                                          renderHologram?(ctx,cx,cy,game) }
   game.registerZombie(def)       def = { id, name, create(game,row, x?) }
   game.registerFactory('mower', (game,row) => entidad)   Fábrica de podadoras.
   game.addEntity(lista, e)       listas: plants, zombies, projectiles, mowers, pickups, suns
   game.entities.<lista>          Arrays de entidades. Una entidad necesita:
                                  update(dt, game), render(ctx, game), dead (bool),
                                  row (para orden de dibujado), z (opcional),
                                  getHitbox() -> {x,y,w,h} (opcional, para depuración).
   game.grid[row][col]            Planta que ocupa la celda o null.
   game.addSystem(sys)            sys = { update?(dt, game), render?(ctx, game) }
   game.levelManager = obj        obj = { start(level), reset?() }  (se invoca en startLevel).
   game.spawnPlantSun(x, y)       Sol de planta (curva cuadrática).
   game.addPlantFood(n)           Suma nutrientes al HUD.
   game.rowHasMower(row)          true si la fila aún tiene podadora.
   game.triggerGameOver(row)      game.triggerVictory()
   game.announceHugeWave(text)    Pausa la BGM, sirena y banner. game.endHugeWave() la reanuda.
   game.setProgress(p, flags[])   Barra de oleadas (0..1) y marcadores de bandera (0..1).
   game.runStory(lines)           Pausa la partida y muestra diálogo; devuelve Promise.
   Cada nivel de Config.LEVELS puede incluir `waves` (JSON) que leerá LevelManager.js.
   ========================================================================== */

(() => {

/* ==========================================================================
   CONFIG
   ========================================================================== */
const Config = Object.freeze({
  WIDTH: 1060,
  HEIGHT: 640,
  GRID: Object.freeze({ rows: 5, cols: 9, x: 130, y: 120, cellW: 100, cellH: 98 }),
  PHYSICS: Object.freeze({ maxDelta: 0.1, maxStep: 1 / 120 }),
  ECONOMY: Object.freeze({
    sunValue: 50,          // Valor base del sol (PvZ 2)
    startSuns: 50,
    skyInterval: 7,        // Segundos entre soles del cielo
    firstSkyDelay: 4,
    sunLifetime: 9,        // Segundos que un sol permanece en el suelo
    gravity: 230,          // px/s² (ease-in por aceleración constante)
    bounceDamping: 0.32,
    bounceMinSpeed: 90,
    arcDuration: 0.85,     // Duración de la parábola del sol de planta
    arcHeight: 90,
    collectDuration: 0.55,
    sunRadius: 26,
    maxPlantFood: 3
  }),
  STORAGE_KEY: 'pvz-modern-days:progress',
  UPDATE_ORDER: Object.freeze(['plants', 'zombies', 'projectiles', 'mowers', 'pickups', 'suns']),
  /* Manifiesto de assets. Deja vacío para usar solo primitivas.
     Ejemplo:
       images: { sun: 'assets/img/sun.png', card_peashooter: 'assets/img/cards/peashooter.png' },
       audio:  { bgm_day: 'assets/audio/day.mp3', shoot: 'assets/audio/shoot.wav' }               */
  ASSETS: Object.freeze({ images: {}, audio: {} }),
  LEVELS: [
    {
      id: 'patio-1', name: 'Patio delantero', subtitle: 'Día 1', mapPos: { x: 9, y: 78 },
      blurb: 'El primer ataque. Un patio, un buzón y muy pocos zombis. Todavía.',
      startSuns: 50, skySuns: true, cards: null, music: 'bgm_day', waves: null,
      dialogue: [
        { speaker: 'Dave el Loco', mood: 'excited', text: '¡Vecino! Soy Dave. Sí, el de la cacerola. No, no me la quito. Ni para dormir.' },
        { speaker: 'Dave el Loco', text: 'Los zombis están subiendo por tu calle. Algunos ya pisaron mi buzón. ¡Mi buzón, vecino!' },
        { speaker: 'Dave el Loco', text: 'Los soles caen del cielo. Pasa el mouse por encima y los recoges. Es gratis, como el aire y los tacos de mi tío.' },
        { speaker: 'Dave el Loco', text: 'Elige una carta, toca una casilla del césped y planta. Cada carril tiene una podadora. Es tu última defensa.' },
        { speaker: 'Dave el Loco', mood: 'excited', text: 'Y cuando suene la sirena, prepárate: viene una Gran Oleada. ¡Wuuu! Ahora a plantar.' }
      ]
    },
    { id: 'patio-2', name: 'Patio de noche', subtitle: 'Noche 1', mapPos: { x: 28, y: 62 }, blurb: 'Sin sol del cielo. Cada girasol cuenta.', startSuns: 100, skySuns: false, cards: null, music: 'bgm_night', waves: null,
      dialogue: [{ speaker: 'Dave el Loco', text: 'Se hizo de noche y el sol se fue a tomar un café. Tendrás que producir tus propios soles.' }] },
    { id: 'patio-3', name: 'Piscina vecina', subtitle: 'Piscina 1', mapPos: { x: 50, y: 70 }, blurb: 'Dos carriles de agua. Los zombis también saben nadar.', startSuns: 50, skySuns: true, cards: null, music: 'bgm_pool', waves: null,
      dialogue: [{ speaker: 'Dave el Loco', text: 'La piscina de los García. Nadie la limpia desde 2009. Los zombis la adoran.' }] },
    { id: 'patio-4', name: 'Calle con niebla', subtitle: 'Niebla 1', mapPos: { x: 70, y: 48 }, blurb: 'No se ve nada a la derecha. Eso es mala señal.', startSuns: 50, skySuns: false, cards: null, music: 'bgm_fog', waves: null,
      dialogue: [{ speaker: 'Dave el Loco', text: 'Niebla espesa. Si ves algo moverse, probablemente quiere tu cerebro.' }] },
    { id: 'patio-5', name: 'Tejado', subtitle: 'Tejado 1', mapPos: { x: 90, y: 24 }, blurb: 'La última defensa, en lo alto de la casa.', startSuns: 50, skySuns: true, cards: null, music: 'bgm_roof', waves: null,
      dialogue: [{ speaker: 'Dave el Loco', mood: 'excited', text: '¡Al tejado! Es el último lugar donde pueden alcanzarnos. Bueno, casi.' }] }
  ]
});

/* ==========================================================================
   UTILIDADES GLOBALES
   ========================================================================== */
const $ = (sel, root = document) => root.querySelector(sel);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rand = (a, b) => a + Math.random() * (b - a);
let _uid = 0;

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/* ==========================================================================
   PHYSICS: matemáticas y colisiones AABB
   ========================================================================== */
const Physics = {
  lerp: (a, b, t) => a + (b - a) * t,
  easeInQuad: t => t * t,
  easeOutCubic: t => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),

  /** Curva Bézier cuadrática: P(t) = (1-t)²P0 + 2(1-t)t·C + t²P1 */
  quadBezier(p0, c, p1, t) {
    const u = 1 - t;
    return {
      x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
      y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y
    };
  },

  /** Solape AABB entre dos cajas {x,y,w,h}. */
  overlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  },

  pointInBox(px, py, b) {
    return px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h;
  },

  /**
   * Segmento (x0,y0)->(x1,y1) contra AABB (método de slabs).
   * Devuelve t∈[0,1] del primer impacto o null. Evita el "tunneling" de
   * proyectiles rápidos: se prueba el recorrido completo del frame.
   */
  segmentHitsBox(x0, y0, x1, y1, box) {
    const dx = x1 - x0, dy = y1 - y0;
    let tmin = 0, tmax = 1;
    const axes = [
      [dx, x0, box.x, box.x + box.w],
      [dy, y0, box.y, box.y + box.h]
    ];
    for (const [d, o, lo, hi] of axes) {
      if (Math.abs(d) < 1e-9) {
        if (o < lo || o > hi) return null;
      } else {
        let t1 = (lo - o) / d, t2 = (hi - o) / d;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return null;
      }
    }
    return tmin;
  }
};

/* ==========================================================================
   GAMEOBJECT: superclase base
   ========================================================================== */
class GameObject {
  constructor(o = {}) {
    this.id = ++_uid;
    this.x = o.x || 0;           // esquina superior izquierda del sprite
    this.y = o.y || 0;
    this.w = o.w || 0;
    this.h = o.h || 0;
    this.vx = o.vx || 0;
    this.vy = o.vy || 0;
    this.prevX = this.x;
    this.prevY = this.y;
    this.row = o.row ?? 0;
    this.col = o.col ?? 0;
    this.z = o.z || 0;
    this.state = o.state || 'IDLE';
    this.stateTime = 0;
    this.dead = false;
    // Hitbox independiente del sprite (offsets relativos a x,y)
    this.hitbox = Object.assign({ ox: 0, oy: 0, w: this.w, h: this.h }, o.hitbox || {});
  }
  getHitbox() {
    return { x: this.x + this.hitbox.ox, y: this.y + this.hitbox.oy, w: this.hitbox.w, h: this.hitbox.h };
  }
  setState(s) { if (this.state !== s) { this.state = s; this.stateTime = 0; } }
  update(dt) {
    this.prevX = this.x;
    this.prevY = this.y;
    this.stateTime += dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }
  render(ctx) {
    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(this.x, this.y, this.w, this.h);
  }
  destroy() { this.dead = true; }
}

/* ==========================================================================
   SUN: caída gravitacional (cielo) o parábola cuadrática (plantas)
   ========================================================================== */
class Sun {
  constructor(game, o) {
    const E = Config.ECONOMY;
    this.id = ++_uid;
    this.game = game;
    this.mode = o.mode || 'sky';
    this.value = o.value ?? E.sunValue;
    this.x = o.x;
    this.y = o.y;
    this.r = E.sunRadius;
    this.row = 99;      // siempre por encima en el orden de capas
    this.z = 99;
    this.dead = false;
    this.age = 0;
    this.rot = 0;
    this.scale = 1;
    this.alpha = 1;
    this.t = 0;
    if (this.mode === 'sky') {
      this.state = 'FALLING';
      this.vy = 0;
      this.groundY = o.targetY;
    } else {
      this.state = 'ARC';
      this.p0 = { x: o.x, y: o.y };
      this.p1 = { x: o.targetX, y: o.targetY };
      this.ctrl = { x: (o.x + o.targetX) / 2, y: Math.min(o.y, o.targetY) - E.arcHeight };
    }
  }
  getHitbox() { const p = this.r * 1.35; return { x: this.x - p, y: this.y - p, w: p * 2, h: p * 2 }; }
  contains(px, py) {
    if (this.dead || this.state === 'COLLECTING') return false;
    const dx = px - this.x, dy = py - this.y, p = this.r * 1.35;
    return dx * dx + dy * dy <= p * p;
  }
  collect() {
    if (this.dead || this.state === 'COLLECTING') return false;
    this.state = 'COLLECTING';
    this.t = 0;
    this.from = { x: this.x, y: this.y };
    this.to = this.game.getSunTarget();
    this.game.audio.playSfx('sun');
    return true;
  }
  update(dt) {
    const E = Config.ECONOMY;
    this.rot += dt * 1.1;
    switch (this.state) {
      case 'FALLING':
        this.vy += E.gravity * dt;              // v = v0 + g·t  → y ∝ t² (ease-in)
        this.y += this.vy * dt;
        if (this.y >= this.groundY) {
          this.y = this.groundY;
          if (Math.abs(this.vy) > E.bounceMinSpeed) this.vy = -this.vy * E.bounceDamping;
          else { this.vy = 0; this.state = 'IDLE'; }
        }
        break;
      case 'ARC': {
        this.t = Math.min(1, this.t + dt / E.arcDuration);
        const p = Physics.quadBezier(this.p0, this.ctrl, this.p1, this.t);
        this.x = p.x; this.y = p.y;
        if (this.t >= 1) this.state = 'IDLE';
        break;
      }
      case 'IDLE':
        this.age += dt;
        if (this.age > E.sunLifetime - 2) this.alpha = 0.55 + 0.45 * Math.abs(Math.sin(this.age * 9));
        if (this.age >= E.sunLifetime) this.dead = true;
        break;
      case 'COLLECTING': {
        this.t = Math.min(1, this.t + dt / E.collectDuration);
        const e = Physics.easeInOutCubic(this.t);
        this.x = Physics.lerp(this.from.x, this.to.x, e);
        this.y = Physics.lerp(this.from.y, this.to.y, e);
        this.scale = 1 - 0.5 * e;
        if (this.t >= 1) { this.game.addSuns(this.value); this.dead = true; }
        break;
      }
    }
  }
  render(ctx, game) {
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.translate(this.x, this.y);
    ctx.scale(this.scale, this.scale);
    if (game.assets.hasImage('sun')) {
      ctx.rotate(this.rot);
      ctx.drawImage(game.assets.getImage('sun'), -this.r * 1.3, -this.r * 1.3, this.r * 2.6, this.r * 2.6);
    } else {
      const g = ctx.createRadialGradient(0, 0, 2, 0, 0, this.r * 1.7);
      g.addColorStop(0, 'rgba(255,240,150,.85)');
      g.addColorStop(1, 'rgba(255,212,59,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, this.r * 1.7, 0, Math.PI * 2); ctx.fill();
      ctx.rotate(this.rot);
      ctx.fillStyle = '#f59f00';
      for (let i = 0; i < 10; i++) {
        ctx.rotate(Math.PI / 5);
        ctx.beginPath();
        ctx.moveTo(-5, -this.r + 2); ctx.lineTo(0, -this.r - 9); ctx.lineTo(5, -this.r + 2);
        ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = '#ffd43b';
      ctx.strokeStyle = '#f59f00';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, this.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff3a8';
      ctx.beginPath(); ctx.arc(-6, -7, this.r * 0.35, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
}

/* ==========================================================================
   DELTATIMER
   ========================================================================== */
class DeltaTimer {
  constructor({ maxDelta = Config.PHYSICS.maxDelta, timeScale = 1 } = {}) {
    this.maxDelta = maxDelta;
    this.timeScale = timeScale;
    this.reset();
  }
  reset() {
    this.last = null;
    this.elapsed = 0;
    this.fps = 60;
    this._acc = 0;
    this._frames = 0;
  }
  /** @param now timestamp de requestAnimationFrame (ms). Devuelve dt en segundos. */
  tick(now) {
    if (this.last === null) this.last = now;
    const raw = (now - this.last) / 1000;
    this.last = now;
    const dt = clamp(raw, 0, this.maxDelta) * this.timeScale;   // acota saltos al volver de otra pestaña
    this.elapsed += dt;
    this._acc += raw;
    this._frames++;
    if (this._acc >= 0.5) { this.fps = this._frames / this._acc; this._acc = 0; this._frames = 0; }
    return dt;
  }
}

/* ==========================================================================
   STATEMACHINE
   ========================================================================== */
class StateMachine {
  constructor(owner) {
    this.owner = owner;
    this.states = new Map();
    this.current = null;
    this.currentName = null;
    this.previousName = null;
    this.listeners = [];
  }
  add(name, def) { this.states.set(name, def); return this; }
  is(name) { return this.currentName === name; }
  onChange(fn) { this.listeners.push(fn); }
  change(name, data) {
    if (!this.states.has(name)) throw new Error(`Estado desconocido: ${name}`);
    const from = this.currentName;
    if (this.current && this.current.exit) this.current.exit.call(this.owner, name, data);
    this.previousName = from;
    this.currentName = name;
    this.current = this.states.get(name);
    this.listeners.forEach(fn => fn(name, from, data));
    if (this.current.enter) this.current.enter.call(this.owner, data, from);
  }
  update(dt) {
    if (this.current && this.current.update) this.current.update.call(this.owner, dt);
  }
}

/* ==========================================================================
   INPUTMANAGER
   ========================================================================== */
class InputManager {
  constructor(stage) {
    this.stage = stage;
    this.mouse = { x: -999, y: -999, inside: false, down: false };
    this.keys = new Set();
    this.handlers = { click: [], key: [] };
    this._bind();
  }
  on(type, fn) { this.handlers[type].push(fn); }
  _emit(type, ...args) { for (const fn of this.handlers[type]) fn(...args); }
  _toLogical(e) {
    const r = this.stage.getBoundingClientRect();
    this.mouse.x = (e.clientX - r.left) * (Config.WIDTH / r.width);
    this.mouse.y = (e.clientY - r.top) * (Config.HEIGHT / r.height);
  }
  _bind() {
    const st = this.stage;
    st.addEventListener('pointermove', e => { this._toLogical(e); this.mouse.inside = true; });
    st.addEventListener('pointerenter', e => { this._toLogical(e); this.mouse.inside = true; });
    st.addEventListener('pointerleave', () => { this.mouse.inside = false; });
    st.addEventListener('pointerdown', e => {
      this._toLogical(e);
      this.mouse.inside = true;
      this.mouse.down = true;
      if (e.target.closest('#hud, .modal, .story')) return;   // la UI DOM gestiona sus propios clics
      this._emit('click', this.mouse.x, this.mouse.y, e.button, e.pointerType);
    });
    window.addEventListener('pointerup', e => {
      this.mouse.down = false;
      if (e.pointerType === 'touch') this.mouse.inside = false;
    });
    st.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('keydown', e => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this._emit('key', e.code, e);
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.down = false; });
  }
}

/* ==========================================================================
   AUDIOMANAGER (Web Audio API)
   ========================================================================== */
class AudioManager {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = AC ? new AC() : null;
    this.buffers = new Map();
    this.enabled = true;
    this.musicName = null;
    this.musicSource = null;
    this.musicOffset = 0;
    this.musicStartedAt = 0;
    this.musicPaused = false;
    if (this.ctx) {
      this.master = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.musicGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.8;
      this.musicGain.gain.value = 0.5;
      this.sfxGain.connect(this.master);
      this.musicGain.connect(this.master);
      this.master.connect(this.ctx.destination);
    }
  }
  /** Los navegadores exigen un gesto del usuario para iniciar el audio. */
  unlock() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume() { this.unlock(); }
  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 1 : 0;
  }
  async loadBuffer(key, url) {
    if (!this.ctx) return false;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.arrayBuffer();
    this.buffers.set(key, await this.ctx.decodeAudioData(data));
    return true;
  }
  hasBuffer(key) { return this.buffers.has(key); }

  /* ----- SFX ----- */
  playSfx(name, { volume = 1, rate = 1 } = {}) {
    if (!this.ctx || !this.enabled) return;
    const buf = this.buffers.get(name);
    if (buf) {
      const src = this.ctx.createBufferSource();
      const g = this.ctx.createGain();
      src.buffer = buf;
      src.playbackRate.value = rate;
      g.gain.value = volume;
      src.connect(g).connect(this.sfxGain);
      src.start();
      return;
    }
    this._synth(name, volume);
  }
  _tone(f0, f1, dur, type = 'sine', vol = 0.3, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfxGain);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  _noise(dur, vol = 0.3, cutoff = 1200, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = buf;
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.sfxGain);
    s.start(t);
  }
  _synth(name, v = 1) {
    switch (name) {
      case 'click': this._tone(520, 360, 0.07, 'square', 0.18 * v); break;
      case 'sun': this._tone(660, 990, 0.12, 'sine', 0.3 * v); this._tone(990, 1320, 0.14, 'sine', 0.25 * v, 0.08); break;
      case 'plant': this._tone(150, 60, 0.18, 'sine', 0.5 * v); this._noise(0.1, 0.15 * v, 700); break;
      case 'shoot': this._tone(620, 280, 0.09, 'square', 0.16 * v); break;
      case 'hit': this._noise(0.08, 0.28 * v, 2600); break;
      case 'bite': this._noise(0.14, 0.3 * v, 500); this._tone(120, 70, 0.14, 'sawtooth', 0.15 * v); break;
      case 'groan': this._tone(95, 60, 0.7, 'sawtooth', 0.14 * v); break;
      case 'mower': this._tone(70, 55, 1.2, 'sawtooth', 0.2 * v); this._noise(1.2, 0.12 * v, 900); break;
      case 'siren': for (let i = 0; i < 3; i++) this._tone(440, 880, 0.5, 'sine', 0.25 * v, i * 0.55); break;
      case 'pf': this._tone(300, 1200, 0.4, 'triangle', 0.3 * v); break;
      case 'deny': this._tone(180, 120, 0.15, 'square', 0.15 * v); break;
      case 'scream': this._tone(900, 200, 0.9, 'sawtooth', 0.22 * v); this._tone(700, 150, 0.9, 'square', 0.12 * v, 0.05); break;
      case 'win': [523, 659, 784, 1047].forEach((f, i) => this._tone(f, f, 0.22, 'triangle', 0.28 * v, i * 0.14)); break;
      default: break;   // sonido desconocido: silencio
    }
  }
  /** Balbuceo del mentor: pitidos cortos con pitch aleatorio. */
  babble() {
    if (!this.ctx || !this.enabled) return;
    if (this.buffers.has('babble')) { this.playSfx('babble', { volume: 0.7, rate: rand(0.85, 1.25) }); return; }
    const f = rand(170, 380);
    this._tone(f, f * rand(0.8, 1.35), 0.07, 'triangle', 0.22);
  }

  /* ----- Música ----- */
  playMusic(name, loop = true) {
    if (this.musicName === name && this.musicSource && !this.musicPaused) return;
    this.stopMusic();
    this.musicName = name;
    this.musicOffset = 0;
    this.musicPaused = false;
    this._startMusicSource(loop);
  }
  _startMusicSource(loop = true) {
    const buf = this.buffers.get(this.musicName);
    if (!this.ctx || !buf) return;   // sin archivo de música: silencio
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    src.connect(this.musicGain);
    src.start(0, this.musicOffset % buf.duration);
    this.musicStartedAt = this.ctx.currentTime;
    this.musicSource = src;
  }
  pauseMusic() {
    if (!this.musicName || this.musicPaused) return;
    this.musicPaused = true;
    if (this.musicSource) {
      this.musicOffset += this.ctx.currentTime - this.musicStartedAt;
      this.musicSource.onended = null;
      try { this.musicSource.stop(); } catch (e) { /* ya detenida */ }
      this.musicSource = null;
    }
  }
  resumeMusic() {
    if (!this.musicName || !this.musicPaused) return;
    this.musicPaused = false;
    this._startMusicSource(true);
  }
  stopMusic() {
    if (this.musicSource) { try { this.musicSource.stop(); } catch (e) { /* ya detenida */ } }
    this.musicSource = null;
    this.musicName = null;
    this.musicPaused = false;
    this.musicOffset = 0;
  }
}

/* ==========================================================================
   ASSETLOADER
   ========================================================================== */
class AssetLoader {
  constructor(audio) {
    this.audio = audio;
    this.images = new Map();
    this.failed = [];
  }
  loadImage(key, url) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => { this.images.set(key, img); resolve(true); };
      img.onerror = () => { this.failed.push(url); resolve(false); };
      img.src = url;
    });
  }
  async loadAudio(key, url) {
    try { return await this.audio.loadBuffer(key, url); }
    catch (err) { this.failed.push(url); return false; }
  }
  /** Precarga todo el manifiesto. Un archivo ausente no detiene el juego (se usan primitivas). */
  async loadAll(manifest, onProgress = () => {}) {
    const jobs = [
      ...Object.entries(manifest.images || {}).map(([k, u]) => () => this.loadImage(k, u)),
      ...Object.entries(manifest.audio || {}).map(([k, u]) => () => this.loadAudio(k, u))
    ];
    const total = jobs.length;
    if (total === 0) { onProgress(1, 0, 0); return; }
    let done = 0;
    await Promise.all(jobs.map(job => job().then(() => { done++; onProgress(done / total, done, total); })));
    if (this.failed.length) console.warn('[AssetLoader] No se pudieron cargar:', this.failed);
  }
  hasImage(key) { return this.images.has(key); }
  getImage(key) { return this.images.get(key) || null; }
  /** Dibuja el sprite si existe; si no, ejecuta el fallback con primitivas. */
  drawSprite(ctx, key, x, y, w, h, fallback) {
    const img = this.images.get(key);
    if (img) ctx.drawImage(img, x, y, w, h);
    else if (fallback) fallback(ctx, x, y, w, h);
  }
  /** Dibuja un frame de un spritesheet horizontal. */
  drawFrame(ctx, key, frame, fw, fh, dx, dy, dw, dh, fallback) {
    const img = this.images.get(key);
    if (img) {
      const cols = Math.max(1, Math.floor(img.width / fw));
      ctx.drawImage(img, (frame % cols) * fw, Math.floor(frame / cols) * fh, fw, fh, dx, dy, dw, dh);
    } else if (fallback) fallback(ctx, dx, dy, dw, dh);
  }
}

/* ==========================================================================
   STORYMANAGER: diálogos DOM estilo visual novel
   ========================================================================== */
class StoryManager {
  constructor(game) {
    this.game = game;
    this.root = $('#story');
    this.portrait = $('#story-portrait');
    this.elSpeaker = $('#story-speaker');
    this.elLine = $('#story-line');
    this.elNext = $('#story-next');
    this.active = false;
    this.charsPerSecond = 38;
    this.root.addEventListener('pointerdown', e => {
      if (e.target.closest('#btn-story-skip')) return;
      this.advance();
    });
    $('#btn-story-skip').addEventListener('click', () => this.finish());
  }
  play(lines) {
    return new Promise(resolve => {
      if (!lines || !lines.length) { resolve(); return; }
      this.lines = lines;
      this.idx = 0;
      this.resolve = resolve;
      this.active = true;
      this.root.classList.add('is-open');
      this.root.setAttribute('aria-hidden', 'false');
      this._showLine();
    });
  }
  _showLine() {
    const l = this.lines[this.idx];
    this.full = l.text;
    this.pos = 0;
    this.acc = 0;
    this.typing = true;
    this.elSpeaker.textContent = l.speaker || '';
    this.elLine.textContent = '';
    this.portrait.dataset.mood = l.mood || 'normal';
    this.portrait.classList.add('is-talking');
    this.elNext.classList.remove('is-ready');
  }
  update(dt) {
    if (!this.active || !this.typing) return;
    this.acc += dt * this.charsPerSecond;
    while (this.acc >= 1 && this.pos < this.full.length) {
      this.acc -= 1;
      const ch = this.full[this.pos++];
      if (/\S/.test(ch) && this.pos % 2 === 0) this.game.audio.babble();
      if (ch === '.' || ch === '!' || ch === '?') this.acc -= 5;   // pausa dramática
      else if (ch === ',') this.acc -= 2;
    }
    this.elLine.textContent = this.full.slice(0, this.pos);
    if (this.pos >= this.full.length) this._endTyping();
  }
  _endTyping() {
    this.typing = false;
    this.portrait.classList.remove('is-talking');
    this.elNext.classList.add('is-ready');
  }
  advance() {
    if (!this.active) return;
    if (this.typing) {
      this.pos = this.full.length;
      this.elLine.textContent = this.full;
      this._endTyping();
      return;
    }
    this.idx++;
    if (this.idx >= this.lines.length) this.finish();
    else this._showLine();
  }
  finish() {
    if (!this.active) return;
    this.active = false;
    this.typing = false;
    this.portrait.classList.remove('is-talking');
    this.root.classList.remove('is-open');
    this.root.setAttribute('aria-hidden', 'true');
    const r = this.resolve;
    this.resolve = null;
    if (r) r();
  }
}

/* ==========================================================================
   GAME
   ========================================================================== */
class Game {
  constructor() {
    this.cfg = Config;
    this.booted = false;
    this.audio = new AudioManager();
    this.assets = new AssetLoader(this.audio);
    this.timer = new DeltaTimer();
    this.fsm = new StateMachine(this);
    this.registry = { plants: new Map(), zombies: new Map(), factories: {} };
    this.systems = [];
    this.levelManager = null;
    this.levelIndex = 0;
    this.level = null;
    this.entities = this._emptyEntities();
    this.grid = this._emptyGrid();
    this.suns = 0;
    this.displaySuns = -1;
    this.plantFood = 0;
    this.displayFood = -1;
    this.skyTimer = 0;
    this.levelTime = 0;
    this.tool = { type: null, id: null };
    this.cooldowns = new Map();
    this.cardRefs = new Map();
    this.floatTexts = [];
    this.debug = false;
    this.selectedMapLevel = null;
    this.progress = this._loadProgress();
  }

  _emptyEntities() { const o = {}; Config.UPDATE_ORDER.forEach(k => { o[k] = []; }); return o; }
  _emptyGrid() { return Array.from({ length: Config.GRID.rows }, () => Array(Config.GRID.cols).fill(null)); }

  /* ------------------------------------------------------------------
     Registro público (Entities.js / LevelManager.js)
     ------------------------------------------------------------------ */
  registerPlant(def) { this.registry.plants.set(def.id, def); }
  registerZombie(def) { this.registry.zombies.set(def.id, def); }
  registerFactory(name, fn) { this.registry.factories[name] = fn; }
  addSystem(sys) { this.systems.push(sys); return sys; }
  addEntity(list, e) { this.entities[list].push(e); return e; }

  /* ------------------------------------------------------------------
     Arranque
     ------------------------------------------------------------------ */
  boot() {
    this._cacheDom();
    this.input = new InputManager(this.dom.stage);
    this.story = new StoryManager(this);
    this.input.on('click', (x, y, b) => this._handleClick(x, y, b));
    this.input.on('key', (code, e) => this._handleKey(code, e));
    this._bindUi();
    this._buildMap();
    this._defineStates();
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.fsm.is('PLAYING')) this.fsm.change('PAUSED'); });
    this.booted = true;
    PVZ._queue.splice(0).forEach(fn => fn(this));   // módulos que se registraron antes del arranque
    this.fsm.change('LOADING');
    requestAnimationFrame(this._frame);
  }

  _cacheDom() {
    const d = this.dom = {};
    d.viewport = $('#viewport');
    d.stage = $('#stage');
    d.sunValue = $('#sun-value');
    d.sunCounter = $('#sun-counter');
    d.sunIcon = $('#sun-icon');
    d.cardBar = $('#card-bar');
    d.pfBtn = $('#btn-plantfood');
    d.pfValue = $('#pf-value');
    d.progress = $('#progress');
    d.progressFill = $('#progress-fill');
    d.progressFlags = $('#progress-flags');
    d.banner = $('#banner');
    d.mapNodes = $('#map-nodes');
    this.ctx = {
      bg: $('#layer-bg').getContext('2d'),
      ent: $('#layer-entities').getContext('2d'),
      ui: $('#layer-ui').getContext('2d')
    };
  }

  _bindUi() {
    const click = (sel, fn) => $(sel).addEventListener('click', () => { this.audio.unlock(); this.audio.playSfx('click'); fn(); });
    click('#btn-play', () => this.fsm.change('MAP'));
    click('#btn-mute', () => {
      const btn = $('#btn-mute');
      const on = btn.getAttribute('aria-pressed') === 'true';   // pressed = silenciado
      btn.setAttribute('aria-pressed', String(!on));
      btn.textContent = on ? 'Sonido activado' : 'Sonido desactivado';
      this.audio.setEnabled(on);
    });
    click('#btn-map-back', () => this.fsm.change('START'));
    click('#btn-map-start', () => { if (this.selectedMapLevel !== null) this.startLevel(this.selectedMapLevel); });
    click('#btn-pause', () => { if (this.fsm.is('PLAYING')) this.fsm.change('PAUSED'); });
    click('#btn-resume', () => this.fsm.change('PLAYING'));
    click('#btn-restart', () => this.startLevel(this.levelIndex));
    click('#btn-quit', () => this.fsm.change('MAP'));
    click('#btn-retry', () => this.startLevel(this.levelIndex));
    click('#btn-gameover-map', () => this.fsm.change('MAP'));
    click('#btn-victory-map', () => this.fsm.change('MAP'));
    this.dom.pfBtn.addEventListener('click', () => this._toggleFoodTool());
  }

  /* ------------------------------------------------------------------
     Estados del juego
     ------------------------------------------------------------------ */
  _defineStates() {
    const SCREEN_OF = { LOADING: 'LOADING', START: 'START', MAP: 'MAP', STORY: 'GAME', PLAYING: 'GAME', PAUSED: 'GAME', GAME_OVER: 'GAME', VICTORY: 'GAME' };
    this.fsm.onChange(name => {
      this.dom.viewport.dataset.state = name;
      document.querySelectorAll('[data-screen]').forEach(el => el.classList.toggle('is-active', el.dataset.screen === SCREEN_OF[name]));
      this._setModal('#modal-pause', name === 'PAUSED');
      this._setModal('#modal-gameover', name === 'GAME_OVER');
      this._setModal('#modal-victory', name === 'VICTORY');
    });

    this.fsm
      .add('LOADING', {
        enter: async () => {
          const bar = $('#loadbar'), fill = $('#loadbar-fill'), txt = $('#loading-text');
          const msgs = ['Regando el césped…', 'Afilando las podadoras…', 'Convenciendo a Dave de quitarse la cacerola…'];
          await this.assets.loadAll(Config.ASSETS, p => {
            fill.style.width = `${Math.round(p * 100)}%`;
            bar.setAttribute('aria-valuenow', String(Math.round(p * 100)));
            txt.textContent = msgs[Math.min(msgs.length - 1, Math.floor(p * msgs.length))];
          });
          fill.style.width = '100%';
          bar.setAttribute('aria-valuenow', '100');
          setTimeout(() => this.fsm.change('START'), 350);
        }
      })
      .add('START', {})
      .add('MAP', { enter: () => { this.audio.stopMusic(); this._refreshMap(); } })
      .add('STORY', {
        enter: async data => {
          this._clearTool();
          const lines = (data && data.lines) || [];
          await this.story.play(lines);
          if (this.fsm.is('STORY')) this.fsm.change((data && data.next) || 'PLAYING');
        },
        update: dt => this.story.update(dt),
        exit: () => this.story.finish()
      })
      .add('PLAYING', {
        enter: () => {
          this.audio.resume();
          if (this.level && this.level.music && !this.audio.musicPaused) this.audio.playMusic(this.level.music);
        },
        update: dt => this._step(dt)
      })
      .add('PAUSED', { enter: () => this.audio.suspend(), exit: () => this.audio.resume() })
      .add('GAME_OVER', { enter: () => { this.audio.stopMusic(); this.audio.playSfx('scream'); this._clearTool(); } })
      .add('VICTORY', {
        enter: () => {
          this.audio.stopMusic();
          this.audio.playSfx('win');
          this._clearTool();
          const next = this.levelIndex + 1;
          if (next > this.progress.unlocked && next < Config.LEVELS.length) this.progress.unlocked = next;
          this.progress.done[this.level.id] = true;
          this._saveProgress();
        }
      });
  }

  _setModal(sel, open) {
    const el = $(sel);
    el.classList.toggle('is-open', open);
    el.setAttribute('aria-hidden', String(!open));
    if (open) { const b = el.querySelector('.btn-primary'); if (b) b.focus({ preventScroll: true }); }
  }

  /* ------------------------------------------------------------------
     Progreso y mapa
     ------------------------------------------------------------------ */
  _loadProgress() {
    try {
      const raw = localStorage.getItem(Config.STORAGE_KEY);
      if (raw) { const p = JSON.parse(raw); return { unlocked: p.unlocked || 0, done: p.done || {} }; }
    } catch (e) { /* almacenamiento no disponible */ }
    return { unlocked: 0, done: {} };
  }
  _saveProgress() {
    try { localStorage.setItem(Config.STORAGE_KEY, JSON.stringify(this.progress)); } catch (e) { /* ignorar */ }
  }
  _buildMap() {
    this.dom.mapNodes.innerHTML = '';
    Config.LEVELS.forEach((lvl, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'map-node';
      b.dataset.index = String(i);
      b.style.left = `${lvl.mapPos.x}%`;
      b.style.top = `${lvl.mapPos.y}%`;
      b.textContent = String(i + 1);
      b.setAttribute('aria-label', `${lvl.name}, ${lvl.subtitle}`);
      const name = document.createElement('span');
      name.className = 'map-node-name';
      name.textContent = lvl.name;
      b.appendChild(name);
      b.addEventListener('click', () => { this.audio.unlock(); this.audio.playSfx('click'); this._selectMapLevel(i); });
      li.appendChild(b);
      this.dom.mapNodes.appendChild(li);
    });
  }
  _refreshMap() {
    this.dom.mapNodes.querySelectorAll('.map-node').forEach(b => {
      const i = Number(b.dataset.index);
      b.disabled = i > this.progress.unlocked;
      b.classList.toggle('is-done', !!this.progress.done[Config.LEVELS[i].id]);
      b.classList.toggle('is-selected', i === this.selectedMapLevel);
    });
    if (this.selectedMapLevel === null) this._selectMapLevel(Math.min(this.progress.unlocked, Config.LEVELS.length - 1));
  }
  _selectMapLevel(i) {
    if (i > this.progress.unlocked) return;
    this.selectedMapLevel = i;
    const lvl = Config.LEVELS[i];
    $('#map-info-title').textContent = `${lvl.name} (${lvl.subtitle})`;
    $('#map-info-text').textContent = lvl.blurb;
    $('#btn-map-start').disabled = false;
    this.dom.mapNodes.querySelectorAll('.map-node').forEach(b => b.classList.toggle('is-selected', Number(b.dataset.index) === i));
  }

  /* ------------------------------------------------------------------
     Niveles
     ------------------------------------------------------------------ */
  startLevel(index) {
    this.audio.unlock();
    this._resetLevel(index);
    if (this.levelManager && this.levelManager.start) this.levelManager.start(this.level);
    this.fsm.change('STORY', { lines: this.level.dialogue, next: 'PLAYING' });
  }

  _resetLevel(index) {
    this.levelIndex = index;
    this.level = Config.LEVELS[index];
    this.entities = this._emptyEntities();
    this.grid = this._emptyGrid();
    this.floatTexts = [];
    this.levelTime = 0;
    this.suns = this.level.startSuns ?? Config.ECONOMY.startSuns;
    this.displaySuns = -1;
    this.plantFood = 0;
    this.displayFood = -1;
    this.skyTimer = Config.ECONOMY.firstSkyDelay;
    this.audio.stopMusic();
    this._clearTool();
    this._buildCards();
    this.setProgress(0, []);
    this.dom.progress.classList.remove('is-visible');
    if (this.levelManager && this.levelManager.reset) this.levelManager.reset();
    const mowerFactory = this.registry.factories.mower;
    if (mowerFactory) for (let r = 0; r < Config.GRID.rows; r++) this.addEntity('mowers', mowerFactory(this, r));
    this._drawBackground();
  }

  triggerGameOver() {
    if (!this.fsm.is('PLAYING')) return;
    this.fsm.change('GAME_OVER');
  }
  triggerVictory() {
    if (!this.fsm.is('PLAYING')) return;
    this.fsm.change('VICTORY');
  }
  rowHasMower(row) { return this.entities.mowers.some(m => !m.dead && m.row === row); }

  /** Diálogo en medio de la partida (p. ej. antes de la Gran Oleada). */
  runStory(lines) {
    return new Promise(resolve => {
      if (!this.fsm.is('PLAYING')) { resolve(); return; }
      this.fsm.change('STORY', { lines, next: 'PLAYING' });
      const wait = () => { if (this.fsm.is('STORY')) requestAnimationFrame(wait); else resolve(); };
      wait();
    });
  }

  announceHugeWave(text = '¡Una gran oleada de zombis se acerca!') {
    this.audio.pauseMusic();
    this.audio.playSfx('siren');
    this.showBanner(text, true);
  }
  endHugeWave() { this.audio.resumeMusic(); }

  showBanner(text, huge = false) {
    const b = this.dom.banner;
    b.textContent = text;
    b.classList.remove('is-showing', 'is-huge');
    void b.offsetWidth;   // reinicia la animación CSS
    b.classList.add('is-showing');
    if (huge) b.classList.add('is-huge');
  }

  /** p ∈ [0,1]; flags = posiciones de las banderas ∈ [0,1]. */
  setProgress(p, flags) {
    const pct = clamp(p, 0, 1);
    this.dom.progressFill.style.transform = `scaleX(${pct})`;
    this.dom.progress.setAttribute('aria-valuenow', String(Math.round(pct * 100)));
    if (flags) {
      this.dom.progressFlags.innerHTML = '';
      flags.forEach(f => {
        const el = document.createElement('i');
        el.className = 'progress-flag';
        el.style.right = `${clamp(f, 0, 1) * 100}%`;   // el progreso crece de derecha a izquierda
        this.dom.progressFlags.appendChild(el);
      });
      this.dom.progress.classList.toggle('is-visible', flags.length > 0);
    }
  }

  /* ------------------------------------------------------------------
     Geometría de la grilla
     ------------------------------------------------------------------ */
  cellRect(row, col) {
    const g = Config.GRID;
    return { x: g.x + col * g.cellW, y: g.y + row * g.cellH, w: g.cellW, h: g.cellH };
  }
  cellCenter(row, col) { const r = this.cellRect(row, col); return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; }
  cellAt(x, y) {
    const g = Config.GRID;
    const col = Math.floor((x - g.x) / g.cellW);
    const row = Math.floor((y - g.y) / g.cellH);
    return (row >= 0 && row < g.rows && col >= 0 && col < g.cols) ? { row, col } : null;
  }
  get gridRight() { const g = Config.GRID; return g.x + g.cols * g.cellW; }
  get gridBottom() { const g = Config.GRID; return g.y + g.rows * g.cellH; }

  /* ------------------------------------------------------------------
     Economía
     ------------------------------------------------------------------ */
  addSuns(n) { this.suns += n; }
  addPlantFood(n = 1) {
    this.plantFood = Math.min(Config.ECONOMY.maxPlantFood, this.plantFood + n);
    this.audio.playSfx('pf');
  }
  getSunTarget() {
    const s = this.dom.stage.getBoundingClientRect();
    const i = this.dom.sunIcon.getBoundingClientRect();
    return {
      x: (i.left + i.width / 2 - s.left) * (Config.WIDTH / s.width),
      y: (i.top + i.height / 2 - s.top) * (Config.HEIGHT / s.height)
    };
  }
  spawnSkySun() {
    const E = Config.ECONOMY;
    const g = Config.GRID;
    this.addEntity('suns', new Sun(this, {
      mode: 'sky',
      x: rand(g.x + 40, this.gridRight - 40),
      y: -E.sunRadius * 2,
      targetY: rand(g.y + 60, this.gridBottom - 50)
    }));
  }
  /** Sol producido por una planta: parábola hacia una posición cercana. */
  spawnPlantSun(x, y, value) {
    const g = Config.GRID;
    this.addEntity('suns', new Sun(this, {
      mode: 'plant',
      value,
      x, y,
      targetX: clamp(x + rand(-80, 80), g.x + 20, this.gridRight - 20),
      targetY: clamp(y + rand(20, 50), g.y + 30, this.gridBottom - 20)
    }));
  }
  spawnFloatText(text, x, y, color = '#fff') {
    this.floatTexts.push({ text, x, y, t: 0, life: 1.1, color });
  }

  /* ------------------------------------------------------------------
     Cartas, herramientas y colocación
     ------------------------------------------------------------------ */
  _buildCards() {
    this.dom.cardBar.innerHTML = '';
    this.cardRefs.clear();
    this.cooldowns.clear();
    const ids = (this.level.cards && this.level.cards.length) ? this.level.cards : [...this.registry.plants.keys()];
    ids.forEach((id, i) => {
      const def = this.registry.plants.get(id);
      if (!def) return;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'card';
      el.dataset.id = id;
      el.style.setProperty('--tint', def.color || '#6bb548');
      el.setAttribute('aria-label', `${def.name}, cuesta ${def.cost} soles`);
      const art = document.createElement('span');
      art.className = 'card-art';
      if (this.assets.hasImage(`card_${id}`)) {
        const img = document.createElement('img');
        img.src = this.assets.getImage(`card_${id}`).src;
        img.alt = '';
        art.appendChild(img);
      } else art.textContent = def.name.charAt(0);
      const name = document.createElement('span'); name.className = 'card-name'; name.textContent = def.name;
      const cost = document.createElement('span'); cost.className = 'card-cost'; cost.textContent = String(def.cost);
      const key = document.createElement('kbd'); key.className = 'card-key'; key.textContent = String(i + 1);
      const cd = document.createElement('span'); cd.className = 'card-cd';
      el.append(key, art, name, cost, cd);
      el.addEventListener('click', () => this._selectCard(id));
      this.dom.cardBar.appendChild(el);
      this.cooldowns.set(id, def.startCooldown || 0);
      this.cardRefs.set(id, { el, cd, def, lastFrac: -1, lastAfford: null, wasCooling: (def.startCooldown || 0) > 0 });
    });
  }

  _selectCard(id) {
    if (!this.fsm.is('PLAYING')) return;
    const ref = this.cardRefs.get(id);
    if (!ref) return;
    if (this.tool.type === 'plant' && this.tool.id === id) { this._clearTool(); return; }
    if ((this.cooldowns.get(id) || 0) > 0) { this.audio.playSfx('deny'); return; }
    if (this.suns < ref.def.cost) { this._denySuns(); return; }
    this.tool = { type: 'plant', id };
    this.audio.playSfx('click');
    this._syncToolUi();
  }
  _toggleFoodTool() {
    if (!this.fsm.is('PLAYING')) return;
    if (this.tool.type === 'plantfood') { this._clearTool(); return; }
    if (this.plantFood <= 0) { this.audio.playSfx('deny'); return; }
    this.tool = { type: 'plantfood', id: null };
    this._syncToolUi();
  }
  _clearTool() { this.tool = { type: null, id: null }; if (this.dom && this.dom.stage) this._syncToolUi(); }
  _syncToolUi() {
    this.cardRefs.forEach((ref, id) => ref.el.classList.toggle('selected', this.tool.type === 'plant' && this.tool.id === id));
    this.dom.pfBtn.setAttribute('aria-pressed', String(this.tool.type === 'plantfood'));
    this.dom.stage.classList.toggle('tool-active', this.tool.type !== null);
  }
  _denySuns() {
    this.audio.playSfx('deny');
    this.dom.sunCounter.classList.remove('deny');
    void this.dom.sunCounter.offsetWidth;
    this.dom.sunCounter.classList.add('deny');
    this.spawnFloatText('Soles insuficientes', this.input.mouse.x, this.input.mouse.y, '#ff8787');
  }
  canPlace(def, row, col) {
    if (this.grid[row][col]) return false;
    return def.canPlace ? !!def.canPlace(this, row, col) : true;
  }
  _tryPlace(row, col) {
    const def = this.registry.plants.get(this.tool.id);
    if (!def) return;
    if ((this.cooldowns.get(def.id) || 0) > 0) { this.audio.playSfx('deny'); return; }
    if (this.suns < def.cost) { this._denySuns(); this._clearTool(); return; }
    if (!this.canPlace(def, row, col)) { this.audio.playSfx('deny'); this.spawnFloatText('Casilla ocupada', this.input.mouse.x, this.input.mouse.y, '#ff8787'); return; }
    this.suns -= def.cost;
    this.cooldowns.set(def.id, def.cooldown || 0);
    const plant = def.create(this, row, col);
    plant.row = row;
    plant.col = col;
    this.grid[row][col] = plant;
    this.addEntity('plants', plant);
    this.audio.playSfx('plant');
    this._clearTool();
  }
  _tryPlantFood(row, col) {
    const plant = this.grid[row][col];
    if (!plant) return;
    if (typeof plant.applyPlantFood !== 'function') { this.spawnFloatText('No usa nutrientes', this.input.mouse.x, this.input.mouse.y, '#ffd43b'); return; }
    if (plant.applyPlantFood(this) === false) return;
    this.plantFood--;
    this.audio.playSfx('pf');
    this._clearTool();
  }

  /* ------------------------------------------------------------------
     Entrada
     ------------------------------------------------------------------ */
  _handleClick(x, y, button) {
    if (!this.fsm.is('PLAYING')) return;
    if (button === 2) { this._clearTool(); return; }
    for (const key of ['pickups', 'suns']) {
      const list = this.entities[key];
      for (let i = list.length - 1; i >= 0; i--) {
        const e = list[i];
        if (!e.dead && e.contains && e.contains(x, y) && e.collect && e.collect()) return;
      }
    }
    const cell = this.cellAt(x, y);
    if (!cell) return;
    if (this.tool.type === 'plant') this._tryPlace(cell.row, cell.col);
    else if (this.tool.type === 'plantfood') this._tryPlantFood(cell.row, cell.col);
  }
  _handleKey(code) {
    this.audio.unlock();
    if (code === 'F3') { this.debug = !this.debug; return; }
    if (code === 'Escape' || code === 'KeyP') {
      if (this.fsm.is('PLAYING')) { if (this.tool.type) this._clearTool(); else this.fsm.change('PAUSED'); }
      else if (this.fsm.is('PAUSED')) this.fsm.change('PLAYING');
      return;
    }
    if (code === 'Space' || code === 'Enter') { if (this.fsm.is('STORY')) this.story.advance(); return; }
    if (!this.fsm.is('PLAYING')) return;
    if (code === 'KeyF') { this._toggleFoodTool(); return; }
    const m = /^(?:Digit|Numpad)([1-9])$/.exec(code);
    if (m) { const id = [...this.cardRefs.keys()][Number(m[1]) - 1]; if (id) this._selectCard(id); }
  }
  _hoverCollect() {
    const m = this.input.mouse;
    if (!m.inside) return;
    for (const key of ['pickups', 'suns']) {
      for (const e of this.entities[key]) {
        if (!e.dead && e.hoverCollect !== false && e.contains && e.contains(m.x, m.y) && e.collect) e.collect();
      }
    }
  }

  /* ------------------------------------------------------------------
     Loop principal
     ------------------------------------------------------------------ */
  _frame = now => {
    const dt = this.timer.tick(now);
    this.fsm.update(dt);
    this._render();
    requestAnimationFrame(this._frame);
  };

  /** Subdivide dt en pasos ≤ 1/120 s: estabilidad numérica y sin tunneling. */
  _step(dt) {
    const n = Math.max(1, Math.ceil(dt / Config.PHYSICS.maxStep));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this._tick(h);
      if (!this.fsm.is('PLAYING')) break;
    }
  }

  _tick(dt) {
    this.levelTime += dt;

    // Soles del cielo
    if (this.level.skySuns !== false) {
      this.skyTimer -= dt;
      if (this.skyTimer <= 0) { this.spawnSkySun(); this.skyTimer += Config.ECONOMY.skyInterval; }
    }

    // Cooldowns de cartas
    this.cooldowns.forEach((v, id) => { if (v > 0) this.cooldowns.set(id, Math.max(0, v - dt)); });

    // Sistemas (LevelManager, etc.)
    for (const s of this.systems) if (s.update) s.update(dt, this);

    // Entidades en orden fijo
    for (const key of Config.UPDATE_ORDER) {
      const list = this.entities[key];
      for (let i = 0; i < list.length; i++) if (!list[i].dead) list[i].update(dt, this);
    }
    this._sweepDead();
    this._hoverCollect();

    for (const f of this.floatTexts) f.t += dt;
    this.floatTexts = this.floatTexts.filter(f => f.t < f.life);
  }

  _sweepDead() {
    for (const key of Config.UPDATE_ORDER) {
      const list = this.entities[key];
      let w = 0;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (e.dead) {
          if (key === 'plants' && this.grid[e.row] && this.grid[e.row][e.col] === e) this.grid[e.row][e.col] = null;
        } else list[w++] = e;
      }
      list.length = w;
    }
  }

  /* ------------------------------------------------------------------
     Render por capas
     ------------------------------------------------------------------ */
  _render() {
    const s = this.fsm.currentName;
    if (s !== 'STORY' && s !== 'PLAYING' && s !== 'PAUSED' && s !== 'GAME_OVER' && s !== 'VICTORY') return;
    this._renderEntities();
    this._renderUi();
    this._syncHud();
  }

  _renderEntities() {
    const ctx = this.ctx.ent;
    ctx.clearRect(0, 0, Config.WIDTH, Config.HEIGHT);
    const drawList = [];
    for (const key of ['plants', 'mowers', 'zombies', 'projectiles', 'pickups']) {
      for (const e of this.entities[key]) if (!e.dead) drawList.push(e);
    }
    drawList.sort((a, b) => ((a.row ?? 0) - (b.row ?? 0)) || ((a.z || 0) - (b.z || 0)));
    for (const e of drawList) { ctx.save(); e.render(ctx, this); ctx.restore(); }
    for (const sys of this.systems) if (sys.render) { ctx.save(); sys.render(ctx, this); ctx.restore(); }
  }

  _renderUi() {
    const ctx = this.ctx.ui;
    ctx.clearRect(0, 0, Config.WIDTH, Config.HEIGHT);
    this._renderHologram(ctx);
    for (const sun of this.entities.suns) if (!sun.dead) sun.render(ctx, this);
    for (const f of this.floatTexts) {
      const k = f.t / f.life;
      ctx.save();
      ctx.globalAlpha = 1 - k * k;
      ctx.font = '800 20px Nunito, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,.6)';
      ctx.fillStyle = f.color;
      ctx.strokeText(f.text, f.x, f.y - 40 * k);
      ctx.fillText(f.text, f.x, f.y - 40 * k);
      ctx.restore();
    }
    if (this.debug) this._renderDebug(ctx);
  }

  /** Holograma de la planta seleccionada sobre la celda bajo el mouse. */
  _renderHologram(ctx) {
    if (!this.fsm.is('PLAYING') || !this.tool.type) return;
    const m = this.input.mouse;
    if (!m.inside) return;
    const cell = this.cellAt(m.x, m.y);
    if (!cell) return;
    const r = this.cellRect(cell.row, cell.col);
    const c = this.cellCenter(cell.row, cell.col);
    ctx.save();
    if (this.tool.type === 'plant') {
      const def = this.registry.plants.get(this.tool.id);
      const ok = def && this.canPlace(def, cell.row, cell.col);
      ctx.fillStyle = ok ? 'rgba(255,255,255,.16)' : 'rgba(220,40,40,.28)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = ok ? 'rgba(255,255,255,.7)' : 'rgba(255,90,90,.9)';
      ctx.lineWidth = 3;
      ctx.strokeRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
      if (ok && def) {
        ctx.globalAlpha = 0.55;
        if (def.renderHologram) def.renderHologram(ctx, c.x, c.y, this);
        else {
          ctx.fillStyle = def.color || '#6bb548';
          roundRectPath(ctx, c.x - 30, c.y - 36, 60, 72, 14);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.font = '400 30px "Lilita One", sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(def.name.charAt(0), c.x, c.y);
        }
      }
    } else if (this.tool.type === 'plantfood') {
      const hasPlant = !!this.grid[cell.row][cell.col];
      ctx.strokeStyle = hasPlant ? '#56d364' : 'rgba(255,255,255,.4)';
      ctx.lineWidth = 4;
      ctx.strokeRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
    }
    ctx.restore();
  }

  _renderDebug(ctx) {
    ctx.save();
    ctx.lineWidth = 1.5;
    const colors = { plants: '#4dabf7', zombies: '#ff6b6b', projectiles: '#ffd43b', mowers: '#b197fc', pickups: '#69db7c', suns: '#ffa94d' };
    for (const key of Config.UPDATE_ORDER) {
      ctx.strokeStyle = colors[key];
      for (const e of this.entities[key]) {
        if (e.dead || !e.getHitbox) continue;
        const b = e.getHitbox();
        ctx.strokeRect(b.x, b.y, b.w, b.h);
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,.35)';
    for (let r = 0; r < Config.GRID.rows; r++) for (let c = 0; c < Config.GRID.cols; c++) {
      const cr = this.cellRect(r, c);
      ctx.strokeRect(cr.x, cr.y, cr.w, cr.h);
    }
    const lines = [
      `FPS ${this.timer.fps.toFixed(0)}`,
      `Estado ${this.fsm.currentName}`,
      `Plantas ${this.entities.plants.length}  Zombis ${this.entities.zombies.length}  Proyectiles ${this.entities.projectiles.length}`,
      `Soles ${this.suns}  Tiempo ${this.levelTime.toFixed(1)}s`
    ];
    ctx.fillStyle = 'rgba(0,0,0,.65)';
    ctx.fillRect(8, Config.HEIGHT - 84, 380, 76);
    ctx.fillStyle = '#fff';
    ctx.font = '700 14px Nunito, monospace';
    ctx.textAlign = 'left';
    lines.forEach((l, i) => ctx.fillText(l, 16, Config.HEIGHT - 64 + i * 18));
    ctx.restore();
  }

  /** Sincroniza el HUD DOM (solo toca el DOM cuando hay cambios). */
  _syncHud() {
    if (this.displaySuns !== this.suns) {
      if (this.displaySuns >= 0 && this.suns > this.displaySuns) {
        this.dom.sunCounter.classList.remove('bump');
        void this.dom.sunCounter.offsetWidth;
        this.dom.sunCounter.classList.add('bump');
      }
      this.displaySuns = this.suns;
      this.dom.sunValue.textContent = String(this.suns);
    }
    if (this.displayFood !== this.plantFood) {
      this.displayFood = this.plantFood;
      this.dom.pfValue.textContent = String(this.plantFood);
      this.dom.pfBtn.classList.toggle('has-food', this.plantFood > 0);
    }
    this.cardRefs.forEach((ref, id) => {
      const total = ref.def.cooldown || 0;
      const left = this.cooldowns.get(id) || 0;
      const frac = total > 0 ? left / total : 0;
      if (Math.abs(frac - ref.lastFrac) > 0.002 || (frac === 0 && ref.lastFrac !== 0)) {
        ref.cd.style.setProperty('--cd', frac.toFixed(3));
        ref.lastFrac = frac;
      }
      const cooling = left > 0;
      if (ref.wasCooling && !cooling) {
        ref.el.classList.remove('ready-flash');
        void ref.el.offsetWidth;
        ref.el.classList.add('ready-flash');
      }
      ref.wasCooling = cooling;
      ref.el.classList.toggle('is-cooling', cooling);
      const afford = this.suns >= ref.def.cost;
      if (afford !== ref.lastAfford) {
        ref.el.classList.toggle('unaffordable', !afford);
        ref.lastAfford = afford;
      }
    });
  }

  /* ------------------------------------------------------------------
     Fondo estático: patio delantero (primitivas; AssetLoader 'bg_lawn' opcional)
     ------------------------------------------------------------------ */
  _drawBackground() {
    const ctx = this.ctx.bg;
    const W = Config.WIDTH, H = Config.HEIGHT, g = Config.GRID;
    ctx.clearRect(0, 0, W, H);
    if (this.assets.hasImage('bg_lawn')) { ctx.drawImage(this.assets.getImage('bg_lawn'), 0, 0, W, H); return; }

    // Cielo
    const sky = ctx.createLinearGradient(0, 0, 0, g.y);
    sky.addColorStop(0, '#7cc8ef');
    sky.addColorStop(1, '#cdeefb');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Cerca de madera detrás del césped
    const fenceTop = 58, fenceBottom = g.y + 4;
    for (let x = g.x - 20; x < W; x += 26) {
      ctx.fillStyle = (Math.floor(x / 26) % 2) ? '#a8723a' : '#97652f';
      ctx.beginPath();
      ctx.moveTo(x, fenceBottom);
      ctx.lineTo(x, fenceTop + 10);
      ctx.lineTo(x + 11, fenceTop);
      ctx.lineTo(x + 22, fenceTop + 10);
      ctx.lineTo(x + 22, fenceBottom);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#47280f';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.fillStyle = '#6b4220';
    ctx.fillRect(g.x - 20, fenceTop + 28, W, 8);
    ctx.fillRect(g.x - 20, fenceBottom - 24, W, 8);

    // Césped: alternancia por filas y columnas
    for (let r = 0; r < g.rows; r++) {
      for (let c = 0; c < g.cols; c++) {
        const cr = this.cellRect(r, c);
        ctx.fillStyle = ((r + c) % 2) ? '#5fa83e' : '#6bb548';
        ctx.fillRect(cr.x, cr.y, cr.w, cr.h);
      }
    }
    // Césped lateral (zona de podadoras) y franja derecha
    ctx.fillStyle = '#4f9535';
    ctx.fillRect(0, g.y, g.x, g.rows * g.cellH);
    ctx.fillStyle = '#4f9535';
    ctx.fillRect(this.gridRight, g.y, W - this.gridRight, g.rows * g.cellH);
    ctx.strokeStyle = 'rgba(0,0,0,.08)';
    ctx.lineWidth = 1;
    for (let r = 0; r <= g.rows; r++) { ctx.beginPath(); ctx.moveTo(g.x, g.y + r * g.cellH); ctx.lineTo(this.gridRight, g.y + r * g.cellH); ctx.stroke(); }
    for (let c = 0; c <= g.cols; c++) { ctx.beginPath(); ctx.moveTo(g.x + c * g.cellW, g.y); ctx.lineTo(g.x + c * g.cellW, this.gridBottom); ctx.stroke(); }

    // Fachada de la casa (lado izquierdo)
    ctx.fillStyle = '#b4492f';
    ctx.fillRect(0, g.y - 4, 26, g.rows * g.cellH + 8);
    ctx.strokeStyle = 'rgba(0,0,0,.2)';
    for (let y = g.y; y < this.gridBottom; y += 14) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(26, y); ctx.stroke(); }
    ctx.fillStyle = '#5d2113';
    ctx.fillRect(24, g.y - 4, 4, g.rows * g.cellH + 8);

    // Acera y bordillo inferior
    ctx.fillStyle = '#b9b9b0';
    ctx.fillRect(0, this.gridBottom, W, H - this.gridBottom);
    ctx.fillStyle = '#8f8f87';
    ctx.fillRect(0, this.gridBottom, W, 6);
    ctx.strokeStyle = '#9a9a92';
    for (let x = 0; x < W; x += 120) { ctx.beginPath(); ctx.moveTo(x, this.gridBottom + 6); ctx.lineTo(x, H); ctx.stroke(); }
  }
}

/* ==========================================================================
   EXPOSICIÓN GLOBAL Y ARRANQUE
   ========================================================================== */
const PVZ = {
  Config, Physics, GameObject, Sun, DeltaTimer, StateMachine, InputManager,
  AudioManager, AssetLoader, StoryManager, Game,
  game: null,
  _queue: [],
  /** Registra un módulo (Entities.js, LevelManager.js). Se ejecuta tras el arranque. */
  use(fn) {
    if (this.game && this.game.booted) fn(this.game);
    else this._queue.push(fn);
  }
};
window.PVZ = PVZ;

window.addEventListener('load', () => {
  PVZ.game = new Game();
  PVZ.game.boot();
});

})();
