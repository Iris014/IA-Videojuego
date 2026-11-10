'use strict';
/* ==========================================================================
   PVZ MODERN DAYS — Entities.js  (Archivo 4)
   --------------------------------------------------------------------------
   Requiere Engine.js cargado antes. Se registra con PVZ.use().

   DEFENSORES (herencia de Plant → GameObject)
     Peashooter  100 soles. Guisante de 20 de daño cada 1.42 s (NDS).
                 Estados: IDLE → ACTION → COOLDOWN. Nutriente: ULTIMATE_ACTION,
                 60 guisantes en 3 s, ignora el cooldown e inmune durante la animación.
     Sunflower    50 soles. Produce 50 soles cada 20 s en parábola. Nutriente: 150 soles.
     Wallnut      50 soles. 4000 HP, tres estados visuales (>50 %, >25 %, <=25 %).

   ZOMBIS (herencia de Zombie → GameObject)
     HP base 200. Un recorrido de celda tarda 4.7 s. Muerden a 100 DPS.
     Estados: WALKING, EATING, DYING_ARMLESS (HP <= 100), DYING_HEADLESS (HP <= 0,
     camina 0.5 s), DYING (colapso), DEAD.
     Hitboxes: cuerpo + cabeza (getHeadHitbox). Cono (370) y cubo (1100) absorben
     el daño antes que el cuerpo. Con hasPlantFood, sueltan un nutriente al morir.

   OTROS
     Pea               Proyectil con barrido segmento-vs-AABB (sin tunneling).
     Mower             Podadora: barrido a 520 px/s, daño 9999 en su fila.
     PlantFoodPickup   Nutriente recolectable con clic.
   ========================================================================== */

(() => {
const { Config, Physics, GameObject } = PVZ;
const G = Config.GRID;
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ----- Constantes de diseño (PvZ 1 para daño/vida, PvZ 2 para economía) ----- */
const Stats = Object.freeze({
  PEA_DAMAGE: 20,
  PEA_SPEED: 420,            // px/s
  PEA_INTERVAL: 1.42,        // s entre disparos
  PEA_ULTIMATE_COUNT: 60,
  PEA_ULTIMATE_TIME: 3,
  SUNFLOWER_INTERVAL: 20,
  SUNFLOWER_FIRST: 6,
  WALLNUT_HP: 4000,
  PLANT_HP: 300,
  ZOMBIE_HP: 200,
  ZOMBIE_ARM_HP: 100,        // pierde el brazo a 100 HP
  ZOMBIE_CELL_TIME: 4.7,     // s por celda
  ZOMBIE_DPS: 100,
  HEADLESS_WALK: 0.5,        // s que camina sin cabeza
  COLLAPSE_TIME: 0.6,
  MOWER_SPEED: 520,
  MOWER_DAMAGE: 9999,
  HOUSE_X: 30                // borde de la casa: aquí un zombi sin podadora gana
});

/* ==========================================================================
   Helpers de dibujo con primitivas
   ========================================================================== */
function ellipse(ctx, x, y, rx, ry, fill, stroke, lw = 2) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
function shadow(ctx, cx, by, rx) { ellipse(ctx, cx, by, rx, 7, 'rgba(0,0,0,.25)'); }
function line(ctx, x0, y0, x1, y1, color, w) {
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
}

function drawPeashooter(ctx, cx, cy, t, recoil = 0) {
  const sway = Math.sin(t * 2.4) * 1.8;
  shadow(ctx, cx, cy + 40, 26);
  ctx.strokeStyle = '#3f8f26'; ctx.lineWidth = 7; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx, cy + 38); ctx.quadraticCurveTo(cx - 6, cy + 14, cx + sway - 2, cy - 4); ctx.stroke();
  ellipse(ctx, cx - 14, cy + 26, 13, 6, '#4fa12f', '#2d6a1a', 2);
  ellipse(ctx, cx + 14, cy + 30, 12, 6, '#4fa12f', '#2d6a1a', 2);
  const hx = cx + sway - 2, hy = cy - 14;
  ellipse(ctx, hx, hy, 24, 22, '#6cc644', '#2d6a1a', 3);
  ellipse(ctx, hx - 4, hy - 22, 6, 9, '#58b236', '#2d6a1a', 2);       // mechón
  const mx = hx + 22 - recoil * 5;
  ellipse(ctx, mx, hy + 2, 12, 11, '#58b236', '#2d6a1a', 3);
  ellipse(ctx, mx + 6, hy + 2, 6, 7, '#1d4d10');
  ellipse(ctx, hx + 4, hy - 8, 6, 7, '#fff', '#2d6a1a', 1.5);
  ellipse(ctx, hx + 6, hy - 8, 2.5, 3, '#111');
}

function drawSunflower(ctx, cx, cy, t, glow = 0) {
  shadow(ctx, cx, cy + 40, 24);
  ctx.strokeStyle = '#3f8f26'; ctx.lineWidth = 7; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx, cy + 38); ctx.lineTo(cx, cy + 2); ctx.stroke();
  ellipse(ctx, cx - 13, cy + 26, 12, 6, '#4fa12f', '#2d6a1a', 2);
  ellipse(ctx, cx + 13, cy + 22, 12, 6, '#4fa12f', '#2d6a1a', 2);
  const hx = cx + Math.sin(t * 1.8) * 1.5, hy = cy - 16;
  ctx.save();
  ctx.translate(hx, hy);
  ctx.scale(1 + glow * 0.18, 1 + glow * 0.18);
  if (glow > 0) { ctx.globalAlpha = 0.5 * glow; ellipse(ctx, 0, 0, 42, 42, '#fff3a8'); ctx.globalAlpha = 1; }
  ctx.save();
  ctx.rotate(t * 0.25);
  for (let i = 0; i < 12; i++) { ctx.rotate(TAU / 12); ellipse(ctx, 0, -22, 7, 13, '#ffd43b', '#c97f00', 1.5); }
  ctx.restore();
  ellipse(ctx, 0, 0, 15, 15, '#8a5a2b', '#4a2c10', 2);
  ellipse(ctx, -5, -3, 2.2, 3, '#111'); ellipse(ctx, 5, -3, 2.2, 3, '#111');
  ctx.strokeStyle = '#2a1608'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 2, 6, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  ctx.restore();
}

function drawWallnut(ctx, cx, cy, t, stage = 0, wobble = 0) {
  shadow(ctx, cx, cy + 40, 28);
  ctx.save();
  ctx.translate(cx, cy + 38);
  ctx.rotate(Math.sin(t * 30) * 0.05 * wobble + stage * 0.04);
  ctx.translate(-cx, -(cy + 38));
  ellipse(ctx, cx, cy + 2, 28, 36, ['#c28a45', '#b07a3a', '#99672e'][stage], '#6b4220', 3);
  ellipse(ctx, cx - 9, cy - 8, 6, 7, '#fff', '#4a2c10', 1.5);
  ellipse(ctx, cx + 9, cy - 8, 6, 7, '#fff', '#4a2c10', 1.5);
  ellipse(ctx, cx - 8, cy - 7, 2.4, 3, '#111'); ellipse(ctx, cx + 10, cy - 7, 2.4, 3, '#111');
  ctx.strokeStyle = '#4a2c10'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  ctx.beginPath();
  if (stage === 0) ctx.arc(cx, cy + 8, 8, 0.15 * Math.PI, 0.85 * Math.PI);
  else { ctx.moveTo(cx - 8, cy + 14); ctx.lineTo(cx + 8, cy + 12); }
  ctx.stroke();
  if (stage >= 1) {
    line(ctx, cx - 18, cy - 24, cx - 8, cy - 12, '#3a2210', 2.5);
    line(ctx, cx - 8, cy - 12, cx - 14, cy - 2, '#3a2210', 2.5);
  }
  if (stage >= 2) {
    line(ctx, cx + 16, cy - 20, cx + 6, cy - 6, '#3a2210', 2.5);
    line(ctx, cx + 4, cy + 22, cx + 14, cy + 10, '#3a2210', 2.5);
    line(ctx, cx - 20, cy + 14, cx - 8, cy + 26, '#3a2210', 2.5);
  }
  ctx.restore();
}

/* ==========================================================================
   PLANT (superclase de defensores)
   ========================================================================== */
class Plant extends GameObject {
  constructor(game, row, col, type, hp) {
    const cell = game.cellRect(row, col);
    super({
      x: cell.x + 10, y: cell.y + 8, w: 80, h: 84, row, col, z: 0, state: 'IDLE',
      hitbox: { ox: 10, oy: 6, w: 60, h: 74 }
    });
    this.game = game;
    this.type = type;
    this.maxHp = hp;
    this.hp = hp;
    this.immune = false;
    this.t = rand(0, 5);       // fase de animación aleatoria
    this.flash = 0;
  }
  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }

  takeDamage(n) {
    if (this.immune || this.dead) return;
    this.hp -= n;
    this.flash = 0.1;
    if (this.hp <= 0) { this.hp = 0; this.dead = true; }
  }
  /** ¿Hay un zombi visible en mi fila, por delante? */
  hasTarget(game) {
    for (const z of game.entities.zombies) {
      if (z.row !== this.row || !z.targetable) continue;
      const b = z.getHitbox();
      if (b.x + b.w > this.x && b.x < Config.WIDTH) return true;
    }
    return false;
  }
  applyPlantFood() { return false; }
  think() {}
  drawShape() {}
  update(dt, game) {
    super.update(dt);
    this.t += dt;
    if (this.flash > 0) this.flash -= dt;
    this.think(dt, game);
  }
  render(ctx, game) {
    if (game.assets.hasImage(`plant_${this.type}`)) {
      ctx.drawImage(game.assets.getImage(`plant_${this.type}`), this.x, this.y, this.w, this.h);
    } else this.drawShape(ctx, this.cx, this.cy);
    if (this.state === 'ULTIMATE_ACTION') {
      ctx.globalAlpha = 0.3 + 0.2 * Math.sin(this.t * 18);
      ellipse(ctx, this.cx, this.cy, 46, 54, '#7dff5a');
      ctx.globalAlpha = 1;
    }
    if (this.flash > 0) ellipse(ctx, this.cx, this.cy, 34, 42, 'rgba(255,255,255,.35)');
  }
}

/* ----- Lanzaguisantes ----- */
class Peashooter extends Plant {
  constructor(game, row, col) {
    super(game, row, col, 'peashooter', Stats.PLANT_HP);
    this.fired = false;
    this.ultShots = 0;
    this.ultAcc = 0;
  }
  fire(game, jitter = 0) {
    game.addEntity('projectiles', new Pea(game, this.row, this.x + this.w - 8, this.y + 30 + jitter));
  }
  applyPlantFood(game) {
    if (this.state === 'ULTIMATE_ACTION') return false;
    this.setState('ULTIMATE_ACTION');
    this.ultShots = 0;
    this.ultAcc = 0;
    this.immune = true;          // inmunidad durante la animación
    return true;
  }
  think(dt, game) {
    switch (this.state) {
      case 'IDLE':
        if (this.hasTarget(game)) { this.setState('ACTION'); this.fired = false; }
        break;
      case 'ACTION':   // pequeña carga y disparo
        if (!this.fired && this.stateTime >= 0.12) { this.fire(game); game.audio.playSfx('shoot'); this.fired = true; }
        if (this.stateTime >= 0.25) this.setState('COOLDOWN');
        break;
      case 'COOLDOWN':
        if (this.stateTime >= Stats.PEA_INTERVAL - 0.25) this.setState('IDLE');
        break;
      case 'ULTIMATE_ACTION': {
        const step = Stats.PEA_ULTIMATE_TIME / Stats.PEA_ULTIMATE_COUNT;   // 0.05 s
        this.ultAcc += dt;
        while (this.ultAcc >= step && this.ultShots < Stats.PEA_ULTIMATE_COUNT) {
          this.ultAcc -= step;
          this.ultShots++;
          this.fire(game, rand(-6, 6));
          if (this.ultShots % 3 === 0) game.audio.playSfx('shoot', { volume: 0.5 });
        }
        if (this.ultShots >= Stats.PEA_ULTIMATE_COUNT) { this.immune = false; this.setState('IDLE'); }
        break;
      }
    }
  }
  drawShape(ctx, cx, cy) {
    let recoil = 0;
    if (this.state === 'ACTION') recoil = Math.sin(clamp(this.stateTime / 0.25, 0, 1) * Math.PI);
    if (this.state === 'ULTIMATE_ACTION') recoil = 0.5 + 0.5 * Math.sin(this.t * 40);
    drawPeashooter(ctx, cx, cy, this.t, recoil);
  }
}

/* ----- Girasol ----- */
class Sunflower extends Plant {
  constructor(game, row, col) {
    super(game, row, col, 'sunflower', Stats.PLANT_HP);
    this.timer = Stats.SUNFLOWER_FIRST;
    this.produced = false;
  }
  produce(game, n = 1) {
    for (let i = 0; i < n; i++) game.spawnPlantSun(this.cx, this.cy - 10);
  }
  applyPlantFood(game) {
    if (this.state === 'ULTIMATE_ACTION') return false;
    this.setState('ULTIMATE_ACTION');
    this.immune = true;
    this.produce(game, 3);       // 3 × 50 = 150 soles instantáneos
    return true;
  }
  think(dt, game) {
    switch (this.state) {
      case 'IDLE':
        this.timer -= dt;
        if (this.timer <= 0) { this.setState('ACTION'); this.produced = false; }
        break;
      case 'ACTION':
        if (!this.produced && this.stateTime >= 0.35) { this.produce(game, 1); this.produced = true; }
        if (this.stateTime >= 0.6) { this.timer = Stats.SUNFLOWER_INTERVAL; this.setState('COOLDOWN'); }
        break;
      case 'COOLDOWN':
        this.setState('IDLE');
        break;
      case 'ULTIMATE_ACTION':
        if (this.stateTime >= 1) { this.immune = false; this.timer = Stats.SUNFLOWER_INTERVAL; this.setState('IDLE'); }
        break;
    }
  }
  drawShape(ctx, cx, cy) {
    let glow = 0;
    if (this.state === 'IDLE' && this.timer < 1.2) glow = 1 - this.timer / 1.2;
    if (this.state === 'ACTION') glow = 1;
    if (this.state === 'ULTIMATE_ACTION') glow = 1;
    drawSunflower(ctx, cx, cy, this.t, glow);
  }
}

/* ----- Nuez ----- */
class Wallnut extends Plant {
  constructor(game, row, col) { super(game, row, col, 'wallnut', Stats.WALLNUT_HP); }
  get stage() { const r = this.hp / this.maxHp; return r > 0.5 ? 0 : (r > 0.25 ? 1 : 2); }
  applyPlantFood() {
    if (this.state === 'ULTIMATE_ACTION') return false;
    this.hp = this.maxHp;        // se restaura por completo
    this.immune = true;
    this.setState('ULTIMATE_ACTION');
    return true;
  }
  think() {
    if (this.state === 'ULTIMATE_ACTION' && this.stateTime >= 3) { this.immune = false; this.setState('IDLE'); }
  }
  drawShape(ctx, cx, cy) { drawWallnut(ctx, cx, cy, this.t, this.stage, this.flash > 0 ? 1 : 0); }
}

/* ==========================================================================
   PEA: proyectil con interpolación y barrido contra hitboxes
   ========================================================================== */
class Pea extends GameObject {
  constructor(game, row, x, y) {
    super({ x, y, w: 14, h: 14, vx: Stats.PEA_SPEED, row, z: 20 });
    this.damage = Stats.PEA_DAMAGE;
    this.r = 7;
  }
  getHitbox() { return { x: this.x - this.r, y: this.y - this.r, w: this.r * 2, h: this.r * 2 }; }
  update(dt, game) {
    super.update(dt);                       // guarda prevX y avanza x += vx·dt
    let bestT = Infinity, best = null;
    for (const z of game.entities.zombies) {
      if (z.row !== this.row || !z.targetable) continue;
      const b = z.getHitbox();
      if (b.x >= Config.WIDTH) continue;    // aún fuera de pantalla
      const box = { x: b.x - this.r, y: b.y - this.r, w: b.w + this.r * 2, h: b.h + this.r * 2 };
      const t = Physics.segmentHitsBox(this.prevX, this.y, this.x, this.y, box);
      if (t !== null && t < bestT) { bestT = t; best = z; }
    }
    if (best) {
      this.x = Physics.lerp(this.prevX, this.x, bestT);
      best.takeDamage(this.damage);
      game.audio.playSfx('hit', { volume: 0.6 });
      this.dead = true;
    } else if (this.x > Config.WIDTH + 20) this.dead = true;
  }
  render(ctx, game) {
    if (game.assets.hasImage('pea')) { ctx.drawImage(game.assets.getImage('pea'), this.x - 9, this.y - 9, 18, 18); return; }
    ellipse(ctx, this.x, this.y, this.r, this.r, '#7ed957', '#2d6a1a', 2);
    ellipse(ctx, this.x - 2, this.y - 2, 2.5, 2.5, '#d9ffc2');
  }
}

/* ==========================================================================
   PLANT FOOD (nutriente recolectable)
   ========================================================================== */
class PlantFoodPickup extends GameObject {
  constructor(game, row, x, y) {
    super({ x, y, w: 40, h: 40, row, z: 50 });
    this.game = game;
    this.age = 0;
    this.life = 12;
    this.vy = -240;
    this.groundY = clamp(y + 20, G.y + 30, game.gridBottom - 20);
    this.hoverCollect = false;      // se recoge solo con clic
    this.alpha = 1;
  }
  getHitbox() { return { x: this.x - 22, y: this.y - 22, w: 44, h: 44 }; }
  contains(px, py) { const dx = px - this.x, dy = py - this.y; return !this.dead && dx * dx + dy * dy <= 30 * 30; }
  collect() {
    if (this.dead) return false;
    this.dead = true;
    this.game.addPlantFood(1);
    this.game.spawnFloatText('+1 Nutriente', this.x, this.y - 20, '#9bff7a');
    return true;
  }
  update(dt) {
    this.age += dt;
    if (this.vy !== 0 || this.y < this.groundY) {
      this.vy += 900 * dt;
      this.y += this.vy * dt;
      if (this.y >= this.groundY) { this.y = this.groundY; this.vy = Math.abs(this.vy) > 120 ? -this.vy * 0.35 : 0; }
    }
    if (this.age > this.life - 3) this.alpha = 0.5 + 0.5 * Math.abs(Math.sin(this.age * 8));
    if (this.age >= this.life) this.dead = true;
  }
  render(ctx, game) {
    ctx.save();
    ctx.globalAlpha = this.alpha;
    if (game.assets.hasImage('plantfood')) { ctx.drawImage(game.assets.getImage('plantfood'), this.x - 22, this.y - 22, 44, 44); ctx.restore(); return; }
    ctx.globalAlpha = this.alpha * (0.35 + 0.2 * Math.sin(this.age * 8));
    ellipse(ctx, this.x, this.y, 30, 30, '#9bff7a');
    ctx.globalAlpha = this.alpha;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(Math.sin(this.age * 3) * 0.12);
    ctx.beginPath();
    ctx.moveTo(-14, 10); ctx.quadraticCurveTo(-20, -14, -4, -18); ctx.lineTo(4, -18); ctx.quadraticCurveTo(20, -14, 14, 10);
    ctx.closePath();
    ctx.fillStyle = '#38b000'; ctx.fill();
    ctx.strokeStyle = '#1d4d00'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = '#d6ffb0';
    ctx.fillRect(-6, -24, 12, 8);
    ctx.restore();
    ctx.restore();
  }
}

/* ==========================================================================
   ZOMBIE (superclase) y variantes
   ========================================================================== */
class Zombie extends GameObject {
  constructor(game, row, x, cfg, opts = {}) {
    const by = game.cellRect(row, 0).y + G.cellH - 8;          // línea de pies
    super({
      x, y: by - 100, w: 80, h: 100, row, z: 10, state: 'WALKING',
      hitbox: { ox: 24, oy: 4, w: 40, h: 92 }
    });
    this.game = game;
    this.cfg = cfg;
    this.type = cfg.type;
    this.maxHp = this.hp = Stats.ZOMBIE_HP;
    this.armor = cfg.armor ? { type: cfg.armor.type, hp: cfg.armor.hp, max: cfg.armor.hp } : null;
    this.speed = (G.cellW / Stats.ZOMBIE_CELL_TIME) * (cfg.speedMul || 1) * rand(0.94, 1.06);
    this.hasPlantFood = !!opts.hasPlantFood;
    this.eating = false;
    this.target = null;
    this.biteTimer = 0;
    this.armLost = false;
    this.headLost = false;
    this.crushed = false;
    this.dropped = false;
    this.headlessTimer = 0;
    this.fallT = 0;
    this.flash = 0;
    this.anim = rand(0, 6);
    this.groanT = rand(4, 14);
    this.headFx = null;
  }

  /** ¿Puede recibir daño de proyectiles? */
  get targetable() { return this.state === 'WALKING' || this.state === 'EATING' || this.state === 'DYING_ARMLESS'; }
  get cx() { return this.x + this.w / 2; }
  get baseY() { return this.y + this.h; }

  /** Hitbox secundario: cabeza (28 % superior del cuerpo). */
  getHeadHitbox() { const b = this.getHitbox(); return { x: b.x, y: b.y, w: b.w, h: b.h * 0.28 }; }

  /**
   * Daño: la armadura (cono/cubo) absorbe primero. opts.crush = podadora
   * (ignora armadura, mata al instante y aplasta).
   */
  takeDamage(dmg, opts = {}) {
    if (!this.targetable && !(opts.crush && this.state === 'DYING_HEADLESS')) return;
    this.flash = 0.1;
    if (opts.crush) {
      this.armor = null;
      this.hp = 0;
      this.crushed = true;
      this._onKilled();
      this._beginCollapse();
      return;
    }
    let remaining = dmg;
    if (this.armor) {
      const absorbed = Math.min(this.armor.hp, remaining);
      this.armor.hp -= absorbed;
      remaining -= absorbed;
      if (this.armor.hp <= 0) this.armor = null;
    }
    this.hp -= remaining;
    if (this.hp <= 0) this._loseHead();
    else if (this.hp <= Stats.ZOMBIE_ARM_HP && !this.armLost) {
      this.armLost = true;
      this.setState('DYING_ARMLESS');
    }
  }

  _loseHead() {
    if (this.state === 'DYING_HEADLESS' || this.state === 'DYING' || this.state === 'DEAD') return;
    this.hp = 0;
    this.armLost = true;
    this.headLost = true;
    this.eating = false;
    this.target = null;
    this.headlessTimer = Stats.HEADLESS_WALK;
    this.setState('DYING_HEADLESS');
    this.headFx = { x: this.cx - 2, y: this.baseY - 86, vx: rand(40, 110), vy: -260, rot: 0, t: 0 };
    this._onKilled();
  }

  _beginCollapse() {
    this.eating = false;
    this.target = null;
    this.fallT = 0;
    this.setState('DYING');
  }

  /** Al morir suelta un nutriente si lo portaba. */
  _onKilled() {
    if (this.dropped) return;
    this.dropped = true;
    if (this.hasPlantFood) this.game.addEntity('pickups', new PlantFoodPickup(this.game, this.row, this.cx, this.baseY - 50));
  }

  _acquireTarget(game) {
    const zb = this.getHitbox();
    let best = null;
    for (const p of game.entities.plants) {
      if (p.dead || p.row !== this.row) continue;
      if (!Physics.overlap(zb, p.getHitbox())) continue;
      if (!best || p.x > best.x) best = p;
    }
    this.target = best;
  }

  _checkHouse(game) {
    if (this.getHitbox().x < Stats.HOUSE_X && !game.rowHasMower(this.row)) game.triggerGameOver(this.row);
  }

  update(dt, game) {
    super.update(dt);
    this.anim += dt;
    if (this.flash > 0) this.flash -= dt;
    if (this.headFx) {
      const f = this.headFx;
      f.t += dt; f.vy += 900 * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.rot += dt * 9;
      if (f.t > 0.9) this.headFx = null;
    }
    switch (this.state) {
      case 'WALKING':
      case 'EATING':
      case 'DYING_ARMLESS': {
        this._acquireTarget(game);
        if (this.target) {
          this.eating = true;
          if (this.state === 'WALKING') this.setState('EATING');
          this.target.takeDamage(Stats.ZOMBIE_DPS * dt);          // 100 DPS
          this.biteTimer -= dt;
          if (this.biteTimer <= 0) { game.audio.playSfx('bite', { volume: 0.6 }); this.biteTimer = 0.5; }
        } else {
          this.eating = false;
          if (this.state === 'EATING') this.setState('WALKING');
          this.x -= this.speed * dt;
        }
        this.groanT -= dt;
        if (this.groanT <= 0) { if (this.x < Config.WIDTH) game.audio.playSfx('groan', { volume: 0.35 }); this.groanT = rand(10, 20); }
        this._checkHouse(game);
        break;
      }
      case 'DYING_HEADLESS':
        this.x -= this.speed * dt;
        this.headlessTimer -= dt;
        this._checkHouse(game);
        if (this.headlessTimer <= 0) this._beginCollapse();
        break;
      case 'DYING':
        this.fallT += dt;
        if (this.fallT >= Stats.COLLAPSE_TIME) { this.setState('DEAD'); this.dead = true; }
        break;
      default: break;
    }
  }

  render(ctx, game) {
    const cx = this.cx, by = this.baseY;
    ctx.save();
    if (this.state !== 'DYING') shadow(ctx, cx, by, 24);
    if (this.hasPlantFood && this.state !== 'DYING') {
      ctx.globalAlpha = 0.25 + 0.15 * Math.sin(this.anim * 6);
      ellipse(ctx, cx, by - 50, 38, 62, '#7dff5a');
      ctx.globalAlpha = 1;
    }
    if (this.state === 'DYING') {
      const k = clamp(this.fallT / Stats.COLLAPSE_TIME, 0, 1);
      ctx.translate(cx, by);
      if (this.crushed) ctx.scale(1 + 0.35 * k, 1 - 0.85 * k);
      else ctx.rotate(k * Math.PI * 0.48);
      ctx.globalAlpha = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
      ctx.translate(-cx, -by);
    }
    if (game.assets.hasImage(`zombie_${this.type}`)) {
      ctx.drawImage(game.assets.getImage(`zombie_${this.type}`), this.x, this.y, this.w, this.h);
    } else this.drawShape(ctx, cx, by);
    if (this.flash > 0) { ctx.globalAlpha = 0.35; ctx.fillStyle = '#fff'; ctx.fillRect(cx - 22, by - 100, 44, 100); }
    ctx.restore();
    if (this.headFx) {
      const f = this.headFx;
      ctx.save();
      ctx.translate(f.x, f.y); ctx.rotate(f.rot);
      ellipse(ctx, 0, 0, 15, 16, '#9bc48a', '#3d5a33', 2);
      ellipse(ctx, -4, -2, 3, 3, '#fff'); ellipse(ctx, 4, -2, 3, 3, '#fff');
      ctx.restore();
    }
  }

  drawShape(ctx, cx, by) {
    const walking = this.state !== 'DYING' && !this.eating;
    const phase = this.anim * (walking ? 4.5 : 0);
    const bob = walking ? Math.abs(Math.sin(phase)) * 2 : 0;
    // Piernas
    const swing = walking ? Math.sin(phase) * 7 : 0;
    ctx_rect(ctx, cx - 14 + swing, by - 34, 10, 34, '#3a3f4a');
    ctx_rect(ctx, cx + 3 - swing, by - 34, 10, 34, '#2f333c');
    ctx_rect(ctx, cx - 18 + swing, by - 5, 15, 5, '#222');
    ctx_rect(ctx, cx - 1 - swing, by - 5, 15, 5, '#1b1b1b');
    // Brazo trasero
    line(ctx, cx + 8, by - 66 - bob, cx - 10, by - 52 - bob, '#8fb67f', 8);
    // Cuerpo
    ctx_rect(ctx, cx - 18, by - 74 - bob, 36, 42, '#4b5d7a');
    ctx_rect(ctx, cx - 3, by - 72 - bob, 6, 24, '#b33a3a');
    // Brazo delantero (se pierde a 100 HP)
    if (!this.armLost) {
      const lift = this.eating ? Math.sin(this.anim * 12) * 10 : 0;
      line(ctx, cx - 14, by - 66 - bob, cx - 42, by - 62 - bob + lift, '#9bc48a', 9);
      ellipse(ctx, cx - 44, by - 62 - bob + lift, 6, 6, '#9bc48a', '#3d5a33', 1.5);
    } else {
      ellipse(ctx, cx - 16, by - 64 - bob, 5, 5, '#a33');
    }
    // Cabeza
    const hy = by - 86 - bob;
    if (!this.headLost) {
      ellipse(ctx, cx - 2, hy, 16, 17, '#9bc48a', '#3d5a33', 2.5);
      ellipse(ctx, cx - 8, hy - 3, 4.5, 5, '#fff', '#3d5a33', 1); ellipse(ctx, cx + 3, hy - 3, 4.5, 5, '#fff', '#3d5a33', 1);
      ellipse(ctx, cx - 9, hy - 3, 1.8, 2.2, '#111'); ellipse(ctx, cx + 2, hy - 3, 1.8, 2.2, '#111');
      line(ctx, cx - 9, hy + 8, cx + 3, hy + 8 + (this.eating ? Math.sin(this.anim * 14) * 2 : 0), '#3d1a1a', 2.2);
      line(ctx, cx - 6, hy - 17, cx - 9, hy - 25, '#3d5a33', 2);
    } else {
      ellipse(ctx, cx - 2, by - 78 - bob, 9, 5, '#a33');
    }
    // Armadura
    if (this.armor && !this.headLost) this._drawArmor(ctx, cx, hy);
    // Bandera
    if (this.cfg.flag) {
      line(ctx, cx + 10, by - 60 - bob, cx + 10, by - 128, '#7a4a22', 3);
      const wave = Math.sin(this.anim * 5) * 3;
      ctx.fillStyle = '#c92a2a';
      ctx.beginPath();
      ctx.moveTo(cx + 11, by - 128); ctx.lineTo(cx + 40, by - 122 + wave); ctx.lineTo(cx + 11, by - 110); ctx.closePath(); ctx.fill();
    }
  }

  _drawArmor(ctx, cx, hy) {
    const a = this.armor, ratio = a.hp / a.max;
    if (a.type === 'cone') {
      ctx.beginPath();
      ctx.moveTo(cx - 16, hy - 12); ctx.lineTo(cx + 12, hy - 12); ctx.lineTo(cx - 2, hy - 42); ctx.closePath();
      ctx.fillStyle = ratio > 0.66 ? '#f08c1a' : (ratio > 0.33 ? '#d4780f' : '#a85f0c');
      ctx.fill(); ctx.strokeStyle = '#7a3f00'; ctx.lineWidth = 2.5; ctx.stroke();
      line(ctx, cx - 12, hy - 20, cx + 8, hy - 20, '#fff', 3);
      line(ctx, cx - 8, hy - 30, cx + 4, hy - 30, '#fff', 3);
      if (ratio < 0.66) line(ctx, cx - 3, hy - 38, cx + 2, hy - 24, '#5a2f00', 2);
      if (ratio < 0.33) line(ctx, cx - 10, hy - 16, cx + 6, hy - 28, '#5a2f00', 2);
    } else {
      ctx.beginPath();
      ctx.moveTo(cx - 17, hy - 8); ctx.lineTo(cx + 13, hy - 8); ctx.lineTo(cx + 10, hy - 34); ctx.lineTo(cx - 14, hy - 34); ctx.closePath();
      ctx.fillStyle = ratio > 0.66 ? '#aeb6bf' : (ratio > 0.33 ? '#8d959e' : '#6f767e');
      ctx.fill(); ctx.strokeStyle = '#3b4148'; ctx.lineWidth = 2.5; ctx.stroke();
      ctx_rect(ctx, cx - 19, hy - 10, 36, 5, '#8a929b');
      if (ratio < 0.66) line(ctx, cx - 8, hy - 32, cx - 4, hy - 16, '#3b4148', 2);
      if (ratio < 0.33) line(ctx, cx + 4, hy - 30, cx + 8, hy - 14, '#3b4148', 2);
    }
  }
}

function ctx_rect(ctx, x, y, w, h, fill) { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); }

class BasicZombie extends Zombie {
  constructor(g, row, x, o) { super(g, row, x, { type: 'basic' }, o); }
}
class ConeheadZombie extends Zombie {
  constructor(g, row, x, o) { super(g, row, x, { type: 'cone', armor: { type: 'cone', hp: 370 } }, o); }
}
class BucketheadZombie extends Zombie {
  constructor(g, row, x, o) { super(g, row, x, { type: 'bucket', armor: { type: 'bucket', hp: 1100 } }, o); }
}
class FlagZombie extends Zombie {
  constructor(g, row, x, o) { super(g, row, x, { type: 'flag', flag: true, speedMul: 1.12 }, o); }
}

/* ==========================================================================
   MOWER (podadora)
   ========================================================================== */
class Mower extends GameObject {
  constructor(game, row) {
    const cell = game.cellRect(row, 0);
    super({ x: 46, y: cell.y + cell.h - 62, w: 84, h: 56, row, z: 5, state: 'IDLE', hitbox: { ox: 12, oy: 6, w: 72, h: 46 } });
    this.game = game;
  }
  update(dt, game) {
    super.update(dt);
    const mb = this.getHitbox();
    if (this.state === 'IDLE') {
      for (const z of game.entities.zombies) {
        if (z.row !== this.row || z.state === 'DEAD' || z.state === 'DYING') continue;
        if (Physics.overlap(mb, z.getHitbox())) {
          this.setState('SWEEPING');
          this.vx = Stats.MOWER_SPEED;
          game.audio.playSfx('mower');
          break;
        }
      }
    }
    if (this.state === 'SWEEPING') {
      for (const z of game.entities.zombies) {
        if (z.row !== this.row || z.state === 'DEAD' || z.state === 'DYING') continue;
        if (Physics.overlap(mb, z.getHitbox())) z.takeDamage(Stats.MOWER_DAMAGE, { crush: true });
      }
      if (this.x > Config.WIDTH + 80) this.dead = true;
    }
  }
  render(ctx, game) {
    if (game.assets.hasImage('mower')) { ctx.drawImage(game.assets.getImage('mower'), this.x, this.y, this.w, this.h); return; }
    const shake = this.state === 'SWEEPING' ? Math.sin(this.stateTime * 80) * 1.5 : 0;
    const x = this.x, y = this.y + shake;
    shadow(ctx, x + 46, this.y + this.h, 34);
    line(ctx, x + 14, y + 22, x - 2, y + 4, '#444', 4);                  // manubrio
    ctx_rect(ctx, x + 10, y + 16, 60, 24, '#d63a2f');
    ctx_rect(ctx, x + 60, y + 24, 22, 18, '#9a2a22');
    ctx_rect(ctx, x + 16, y + 10, 16, 8, '#333');
    ellipse(ctx, x + 22, y + 46, 10, 10, '#222', '#555', 2);
    ellipse(ctx, x + 62, y + 46, 10, 10, '#222', '#555', 2);
    if (this.state === 'SWEEPING') {
      ctx.save(); ctx.translate(x + 80, y + 40); ctx.rotate(this.stateTime * 40);
      line(ctx, -9, 0, 9, 0, '#ccc', 3); ctx.restore();
    }
  }
}

/* ==========================================================================
   REGISTRO EN EL JUEGO
   ========================================================================== */
PVZ.use(game => {
  game.registerPlant({
    id: 'peashooter', name: 'Lanzaguisantes', cost: 100, cooldown: 7.5, color: '#5cb83a',
    create: (g, r, c) => new Peashooter(g, r, c),
    renderHologram: (ctx, cx, cy) => drawPeashooter(ctx, cx, cy, 0, 0)
  });
  game.registerPlant({
    id: 'sunflower', name: 'Girasol', cost: 50, cooldown: 7.5, color: '#f2b705',
    create: (g, r, c) => new Sunflower(g, r, c),
    renderHologram: (ctx, cx, cy) => drawSunflower(ctx, cx, cy, 0, 0)
  });
  game.registerPlant({
    id: 'wallnut', name: 'Nuez', cost: 50, cooldown: 20, color: '#b8803c',
    create: (g, r, c) => new Wallnut(g, r, c),
    renderHologram: (ctx, cx, cy) => drawWallnut(ctx, cx, cy, 0, 0, 0)
  });

  const x0 = () => Config.WIDTH + 30 + rand(0, 30);
  game.registerZombie({ id: 'basic', name: 'Zombi', create: (g, row, x, o) => new BasicZombie(g, row, x ?? x0(), o) });
  game.registerZombie({ id: 'cone', name: 'Zombi cono', create: (g, row, x, o) => new ConeheadZombie(g, row, x ?? x0(), o) });
  game.registerZombie({ id: 'bucket', name: 'Zombi cubo', create: (g, row, x, o) => new BucketheadZombie(g, row, x ?? x0(), o) });
  game.registerZombie({ id: 'flag', name: 'Zombi bandera', create: (g, row, x, o) => new FlagZombie(g, row, x ?? x0(), o) });

  game.registerFactory('mower', (g, row) => new Mower(g, row));
});

Object.assign(PVZ, { Stats, Plant, Peashooter, Sunflower, Wallnut, Pea, PlantFoodPickup, Zombie, BasicZombie, ConeheadZombie, BucketheadZombie, FlagZombie, Mower });

})();
