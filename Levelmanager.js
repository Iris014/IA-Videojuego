'use strict';
/* ==========================================================================
   PVZ MODERN DAYS — LevelManager.js  (Archivo 5)
   --------------------------------------------------------------------------
   Requiere Engine.js y Entities.js cargados antes.

   FORMATO JSON DE OLEADAS (por nivel, clave = id del nivel en Config.LEVELS)
   {
     "events": [
       { "time": 22,                       // segundos desde que empieza la partida
         "type": "basic",                  // basic | cone | bucket | flag
         "row": "random",                  // 0..4 o "random"
         "hasPlantFood": false,            // el zombi suelta un nutriente al morir
         "repeat": { "every": 9, "count": 4 } },   // opcional: se expande a 4 eventos

       { "time": 115, "flag": true,        // BANDERA: Gran Oleada en los 5 carriles
         "label": "¡Una gran oleada de zombis se acerca!",
         "final": false,                   // true = última oleada (banner distinto)
         "story": [ { "speaker": "...", "text": "..." } ],   // diálogo previo (pausa el juego)
         "spawns": [ { "type": "basic", "rows": "all", "count": 2 },
                     { "type": "cone",  "rows": [1, 3], "count": 1 } ] }
     ]
   }

   Un nivel puede traer su propio objeto en level.waves; si no, se usa WAVE_DATA (clave = id
   del nivel, p. ej. "1-1") y, en su defecto, buildWaves() genera el JSON según mundo y subnivel.
   La barra de progreso se calcula con time / (último evento) y marca las banderas.
   Se gana al agotar los eventos y morir todos los zombis.
   ========================================================================== */

(() => {
const { Config } = PVZ;

const DAVE = 'Crazy Dave';

const WAVE_DATA = {
  '1-1': {
    events: [
      { time: 22, type: 'basic', row: 'random' },
      { time: 38, type: 'basic', row: 'random' },
      { time: 52, type: 'basic', row: 'random', hasPlantFood: true },
      { time: 64, type: 'basic', row: 'random', repeat: { every: 11, count: 3 } },
      { time: 70, type: 'cone', row: 'random' },
      { time: 92, type: 'cone', row: 'random' },
      { time: 100, type: 'basic', row: 'random', repeat: { every: 7, count: 2 } },
      {
        time: 115, flag: true, label: '¡Una gran oleada de zombis se acerca!',
        story: [
          { speaker: DAVE, mood: 'excited', text: '¿Oyes esa sirena, vecino? Es la Gran Oleada. Todos los zombis de la cuadra, a la vez.' },
          { speaker: DAVE, text: 'Tranquilo. Si algo sale mal, la podadora hace el trabajo. Y si sale muy mal, yo tengo una cacerola.' }
        ],
        spawns: [
          { type: 'basic', rows: 'all', count: 1 },
          { type: 'cone', rows: [1, 3], count: 1 },
          { type: 'flag', rows: [2], count: 1 }
        ]
      },
      {
        time: 145, flag: true, final: true, label: '¡Última oleada!',
        spawns: [
          { type: 'basic', rows: 'all', count: 2 },
          { type: 'cone', rows: [0, 2, 4], count: 1 },
          { type: 'bucket', rows: [2], count: 1 }
        ]
      }
    ]
  }
};

/**
 * Generador de oleadas en el mismo formato JSON para los niveles sin datos a mano.
 * La dificultad d (1..50) sube con el mundo y el subnivel: más zombis, más frecuentes,
 * conos desde d>=3, cubos desde d>=8, y más duración.
 */
function buildWaves(level) {
  const d = (level.world - 1) * Config.LEVELS_PER_WORLD + level.sub;
  const dur = Math.min(220, 85 + d * 3);
  const ev = [];
  const run = (type, start, every, extra = {}) => {
    const count = Math.max(1, Math.floor((dur - 10 - start) / every));
    ev.push(Object.assign({ time: start, type, row: 'random', repeat: { every, count } }, extra));
  };
  run('basic', 20, Math.max(4.5, 11 - d * 0.16));
  if (d >= 3) run('cone', 38, Math.max(7, 18 - d * 0.25));
  if (d >= 8) run('bucket', 60, Math.max(13, 40 - d * 0.5));
  run('basic', 45, 28, { hasPlantFood: true });                // portadores de nutrientes
  const big = Math.floor(d / 14);
  const mid = [{ type: 'basic', rows: 'all', count: 1 + big }];
  if (d >= 3) mid.push({ type: 'cone', rows: [1, 3], count: 1 + big });
  if (d >= 8) mid.push({ type: 'bucket', rows: [2], count: 1 + big });
  if (d >= 2) ev.push({ time: Math.round(dur * 0.7), flag: true, label: '¡Una gran oleada de zombis se acerca!', spawns: mid });
  const fin = [{ type: 'basic', rows: 'all', count: 2 + big + (level.sub === 10 ? 1 : 0) }];
  if (d >= 3) fin.push({ type: 'cone', rows: [0, 2, 4], count: 1 + big });
  if (d >= 8) fin.push({ type: 'bucket', rows: [1, 3], count: 1 + big });
  ev.push({ time: dur, flag: true, final: true, label: '¡Última oleada!', spawns: fin });
  return { events: ev };
}

/* Oleada de emergencia para niveles sin datos */
const FALLBACK_WAVES = { events: [{ time: 15, type: 'basic', row: 'random', repeat: { every: 10, count: 6 } }] };

class LevelManager {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset() {
    this.events = [];
    this.index = 0;
    this.time = 0;
    this.endTime = 1;
    this.timers = [];            // acciones diferidas { t, fn }
    this.active = false;
    this.storyPending = false;
    this.introShown = false;
    this.winTimer = 0;
    this.progressAcc = 0;
  }

  /** Lo llama Game.startLevel() tras reiniciar el nivel. */
  start(level) {
    this.reset();
    const data = level.waves || WAVE_DATA[level.id] || buildWaves(level) || FALLBACK_WAVES;
    this.events = this._expand(data);
    this.endTime = Math.max(1, ...this.events.map(e => e.time));
    const flags = this.events.filter(e => e.flag).map(e => e.time / this.endTime);
    this.game.setProgress(0, flags);
    this.active = true;
  }

  /** Expande "repeat" y ordena los eventos por tiempo. */
  _expand(data) {
    const out = [];
    for (const ev of data.events) {
      const n = ev.repeat ? ev.repeat.count : 1;
      for (let i = 0; i < n; i++) {
        const copy = Object.assign({}, ev, { time: ev.time + (ev.repeat ? ev.repeat.every * i : 0) });
        delete copy.repeat;
        out.push(copy);
      }
    }
    return out.sort((a, b) => a.time - b.time);
  }

  _after(seconds, fn) { this.timers.push({ t: seconds, fn }); }

  _rows(spec) {
    const all = Array.from({ length: Config.GRID.rows }, (_, i) => i);
    if (spec === 'all') return all;
    if (Array.isArray(spec)) return spec;
    if (spec === 'random' || spec === undefined) return [Math.floor(Math.random() * Config.GRID.rows)];
    return [spec];
  }

  _spawn(type, row, opts = {}, xOffset = 0) {
    const def = this.game.registry.zombies.get(type);
    if (!def) { console.warn(`[LevelManager] Tipo de zombi desconocido: ${type}`); return; }
    const x = Config.WIDTH + 30 + xOffset + Math.random() * 30;
    this.game.addEntity('zombies', def.create(this.game, row, x, opts));
  }

  _spawnWave(spawns) {
    for (const s of spawns || []) {
      for (const row of this._rows(s.rows)) {
        for (let i = 0; i < (s.count || 1); i++) this._spawn(s.type, row, { hasPlantFood: !!s.hasPlantFood }, i * 70);
      }
    }
  }

  _fire(ev) {
    const g = this.game;
    if (!ev.flag) {
      this._spawn(ev.type, this._rows(ev.row)[0], { hasPlantFood: !!ev.hasPlantFood });
      return;
    }
    // Bandera: Gran Oleada simultánea en los 5 carriles
    const run = () => {
      this.storyPending = false;
      g.announceHugeWave(ev.final ? '¡Última oleada!' : (ev.label || undefined));
      this._after(2.6, () => this._spawnWave(ev.spawns));      // la sirena suena antes de la horda
      this._after(6, () => g.endHugeWave());                    // reanuda la música
    };
    if (ev.story && ev.story.length) {
      this.storyPending = true;
      g.runStory(ev.story).then(run);
    } else run();
  }

  update(dt, game) {
    if (!this.active) return;
    if (!this.introShown) { this.introShown = true; game.showBanner('¡Prepara tu defensa!'); }
    this.time += dt;

    // Acciones diferidas
    for (const tm of this.timers) tm.t -= dt;
    const due = this.timers.filter(tm => tm.t <= 0);
    if (due.length) { this.timers = this.timers.filter(tm => tm.t > 0); due.forEach(tm => tm.fn()); }

    // Eventos de la línea de tiempo
    while (this.index < this.events.length && this.events[this.index].time <= this.time) {
      this._fire(this.events[this.index++]);
      if (this.storyPending) return;       // el juego entra en estado STORY
    }

    // Barra de progreso (10 Hz)
    this.progressAcc += dt;
    if (this.progressAcc >= 0.1) {
      this.progressAcc = 0;
      game.setProgress(Math.min(1, this.time / this.endTime), null);
    }

    // Victoria: sin eventos pendientes ni zombis vivos
    const finished = this.index >= this.events.length && this.timers.length === 0 && !this.storyPending;
    if (finished && game.entities.zombies.length === 0) {
      this.winTimer += dt;
      if (this.winTimer >= 1.2) { this.active = false; game.setProgress(1, null); game.triggerVictory(); }
    } else this.winTimer = 0;
  }
}

PVZ.use(game => {
  const lm = new LevelManager(game);
  game.levelManager = lm;
  game.addSystem(lm);
});

Object.assign(PVZ, { LevelManager, WAVE_DATA });

})();