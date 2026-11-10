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
/* ==========================================================================
   MUNDOS, ENTORNOS, CATÁLOGO DE PLANTAS Y NIVELES
   --------------------------------------------------------------------------
   5 mundos x 10 subniveles = 50 fragmentos de historia (1-1 ... 5-10).
   Cada nivel trae: env, dialogue (líneas progresivas de Crazy Dave) y reward
   (id de la planta que se gana al superarlo, o null).
   ========================================================================== */
const WORLDS = Object.freeze([
  { id: 1, name: 'Día', env: 'day' },
  { id: 2, name: 'Noche', env: 'night' },
  { id: 3, name: 'Piscina', env: 'pool' },
  { id: 4, name: 'Niebla', env: 'fog' },
  { id: 5, name: 'Tejado', env: 'roof' }
]);

const PLANT_NAMES = Object.freeze(Object.fromEntries(
  ('peashooter:Lanzaguisantes,sunflower:Girasol,wallnut:Nuez,cherrybomb:Petacereza,potatomine:Mina de papa,' +
   'snowpea:Guisante helado,repeater:Repetidora,chomper:Planta carnívora,puffshroom:Puff-seta,sunshroom:Sol-seta,' +
   'fumeshroom:Fume-seta,gravebuster:Come-tumbas,hypnoshroom:Hipno-seta,scaredyshroom:Seta miedosa,' +
   'iceshroom:Hielo-seta,doomshroom:Seta fatal,magnetshroom:Imán-seta,lilypad:Nenúfar,squash:Calabaza aplastante,' +
   'threepeater:Triple lanzaguisantes,tanglekelp:Alga enredadera,jalapeno:Jalapeño,spikeweed:Pinchos,' +
   'torchwood:Tronco antorcha,splitpea:Guisante doble,plantern:Linterna vegetal,cactus:Cactus,blover:Trébol,' +
   'starfruit:Carambola,pumpkin:Calabaza,cabbagepult:Col catapulta,garlic:Ajo,flowerpot:Maceta,' +
   'kernelpult:Maíz catapulta,umbrellaleaf:Hoja paraguas,marigold:Caléndula,melonpult:Melón catapulta,' +
   'coffeebean:Grano de café').split(',').map(p => p.split(':'))
));

/* Paletas por entorno para _drawBackground() */
const ENVS = Object.freeze({
  day: { sky: ['#7cc8ef', '#cdeefb'], lawn: ['#6bb548', '#5fa83e'], side: '#4f9535', fence: ['#a8723a', '#97652f'], rail: '#6b4220', walk: '#b9b9b0', house: '#b4492f' },
  night: { sky: ['#0b1033', '#27386b'], lawn: ['#34604a', '#2b5240'], side: '#23442f', fence: ['#4a3a2a', '#3f3124'], rail: '#2b2016', walk: '#5d6068', house: '#6b2c25', overlay: 'rgba(6,10,40,.28)', stars: true },
  pool: { sky: ['#7cc8ef', '#d7f3fb'], lawn: ['#6bb548', '#5fa83e'], side: '#4f9535', fence: ['#c9b48a', '#bba67c'], rail: '#8c7a55', walk: '#d8d2c0', house: '#b4492f', water: ['#3ba7d9', '#2f95c8'], waterRows: [2, 3] },
  fog: { sky: ['#6f7b87', '#b8c2cb'], lawn: ['#4f7f48', '#497642'], side: '#3d6338', fence: ['#6c5a48', '#5f4f3f'], rail: '#43372b', walk: '#8d9298', house: '#7a3a2e', overlay: 'rgba(170,182,195,.18)', fog: true },
  roof: { sky: ['#d98a5a', '#f3c89a'], lawn: ['#b4492f', '#a64028'], side: '#8f3622', fence: null, rail: '#6d2a1a', walk: '#7a7a7a', house: '#5d2113', roof: true }
});

/* ----- Mundo 1 (Día): escrito a mano, con la introducción extendida en 1-1 ----- */
const DAY_LEVELS = [
  { name: 'Patio delantero', reward: 'sunflower', startSuns: 150, lines: [
    '¡Hola, vecino! Soy Crazy Dave. Sí, el de la cacerola en la cabeza. No, no me la quito. Ni para dormir, ni para ducharme.',
    'Vivo en la casa de al lado desde hace años y últimamente la calle está rara. Raaara. Ayer vi a alguien en mi jardín que no era el cartero. Tenía un cono en la cabeza y caminaba así: ¡bluuuh!',
    'Son zombis, vecino. ZOM-BIS. Llegaron esta mañana, justo después de mi desayuno de tacos. Mi desayuno de tacos.',
    'Quieren entrar a tu casa. Quieren tu cerebro. Yo les expliqué que no es un buen cerebro, que tiene cosas raras dentro, pero no escuchan.',
    'Por suerte tengo un plan. Mi plan se llama PLANTAS. Las plantas, ellas disparan. Es un plan buenísimo. Casi nunca explota.',
    'Primero necesitas soles. Caen del cielo cada cierto tiempo. Pasa el mouse por encima y los recoges. Es como magia, pero gratis.',
    'Con los soles compras plantas. Arriba, en la barra de cartas, elige la Lanzaguisantes y haz clic en una casilla del césped.',
    'Cada carril tiene una podadora. Si un zombi la toca, arranca y arrasa con toda la fila. Es tu última defensa y el único objeto de la casa que sabe correr.',
    'Y si un zombi llega a la puerta sin podadora... bueno. Digamos que tu cerebro hará de aperitivo.',
    'Cuando suene la sirena viene una Gran Oleada: todos los zombis a la vez. Mantén la calma y mantén los guisantes.',
    '¡Ahora, a plantar! Yo me quedo aquí, vigilando mi buzón.'
  ] },
  { name: 'Girasoles al sol', reward: 'wallnut', lines: [
    '¡Lo lograste, vecino! Un zombi menos y la cacerola sigue en mi cabeza. Hoy es un buen día.',
    'Acabo de plantar un Girasol en mi macetero. Produce soles extra, así que no dependerás solo del cielo.',
    'Ponlos atrás, lejos de la acción, y deja que los guisantes se ocupen del frente.',
    'Ah, y toma esta pala (botón del panel o tecla S). Si plantas algo en el lugar equivocado, lo desentierras y listo.'
  ] },
  { name: 'Nueces valientes', reward: 'cherrybomb', lines: [
    '¿Viste ese zombi con un cono de tráfico en la cabeza? Resiste más que los otros. Creo que lo robó de la obra de la esquina.',
    'Para esos tenemos las Nueces, que aguantan mordiscos como campeonas. Ponlas delante y tus plantas respiran.',
    'Y tengo una sorpresa: algo rojo, redondo y con muy mal carácter. Se llama Petacereza. Pero eso será para el final del nivel.'
  ] },
  { name: 'El buzón de Dave', reward: 'potatomine', lines: [
    'Vecino, hoy atacaron mi buzón. Mi buzón. Tenía una carta de mi tía dentro. Una carta MUY importante.',
    'Los zombis no leen correo, pero sí muerden cartas. Hay que defender el buzón y todo lo que esté cerca.',
    'Te presto una Mina de papa. Es una papa que explota. No me preguntes quién la entrenó.'
  ] },
  { name: 'Cubos en la calle', reward: 'snowpea', lines: [
    'Ahora aparecen zombis con cubos en la cabeza. ¡Cubos! Los vecinos de la otra calle deben haber vaciado el garaje.',
    'Un cubo aguanta muchísimo. Necesitas daño continuo, mucho guisante junto.',
    'Mira lo que encontré en mi congelador: un Guisante helado. Ralentiza todo lo que toca. Hasta a mi tío en las reuniones.'
  ] },
  { name: 'Sirenas en el barrio', reward: 'repeater', lines: [
    '¿Escuchaste una sirena? Son las Grandes Oleadas, vecino. Aparecen todos juntos, como en una rebaja del súper.',
    'Los zombis con bandera avisan que viene la horda. Tienen muy buen sentido de la puntualidad.',
    'Para eso, doble potencia: una Repetidora. Dos guisantes por disparo. Matemática pura.'
  ] },
  { name: 'Cerebros en peligro', reward: 'chomper', lines: [
    'Tengo malas noticias: los zombis se están organizando. Creo que alguien les da órdenes. Algún zombi con corbata y buena postura.',
    'No sé quién es, pero lo veré pronto. Mientras tanto, aprende a plantar con cabeza. Y yo me pongo la cacerola otra vez.',
    'Te traigo una Planta carnívora: se come un zombi entero y descansa un buen rato. Como mi tío en Navidad.'
  ] },
  { name: 'La noche se acerca', reward: null, lines: [
    'El sol baja más rápido de lo normal, vecino. Cuando oscurezca, los soles dejarán de caer del cielo.',
    'Por eso hay que guardar soles y plantar girasoles de más. Cada sol cuenta el doble.',
    'Y recuerda la pala: si una planta está mal puesta, la sacas y la cambias.'
  ] },
  { name: 'Última cuadra del día', reward: null, lines: [
    'Hoy los zombis vienen más fuertes. Los guisantes se cansan, las nueces se asustan y yo tengo hambre.',
    'Pero estás haciendo un trabajo increíble. Mis vecinos no lo creen, pero yo sí.',
    'Aguanta esta oleada y esta noche hablamos de lo que viene.'
  ] },
  { name: 'El atardecer', reward: 'puffshroom', lines: [
    'Eso fue todo el día, vecino. El patio sigue en pie, el buzón también, y yo me siento orgulloso de ti.',
    'Pero no te relajes: la noche trae algo peor. Zombis que no se ven bien y soles que no caen.',
    'Cuando oscurezca, los hongos serán tus nuevos amigos. Toma una Puff-seta: pequeña, silenciosa y de mal humor.',
    '¡Descansa un poco! Nos vemos a la luz de la luna.'
  ] }
];

/* ----- Mundos 2 a 5: [nombre, recompensa, línea 1, línea 2] ----- */
const PACKED_WORLDS = {
  2: [
    ['Primera noche', 'sunshroom', 'Qué oscuro está, ¿no? Aquí no caen soles del cielo. Tendrás que producirlos tú.', 'La Sol-seta es pequeña, pero rinde. Ponla en tu primera línea de defensa económica.'],
    ['Hongos curiosos', 'fumeshroom', 'Los hongos son plantas nocturnas, vecino. Gastan poco y atacan pronto.', 'Prueba esta Fume-seta. Atraviesa armaduras. Y huele a calcetín, pero no lo digas.'],
    ['Lápidas en el césped', 'gravebuster', 'Algo raro: aparecieron lápidas en tu patio. Los zombis salen de ellas como de una puerta giratoria.', 'Hay que limpiarlas con un Come-tumbas. Parece un trabajo, pero es puro apetito.'],
    ['Voces en la oscuridad', 'hypnoshroom', 'Escuché susurros desde el garaje. Creo que los zombis hablan entre ellos, y no de cosas buenas.', 'Una Hipno-seta convierte a uno de ellos en tu aliado. Siempre quise un zombi amigo.'],
    ['Seta miedosa', 'scaredyshroom', 'Esta seta tiene un defecto: se esconde cuando los zombis se acercan. Pero dispara desde lejos.', 'Ponla detrás de las nueces. Valiente no es quien no tiene miedo, sino quien dispara escondido.'],
    ['Luna llena', 'iceshroom', 'Con luna llena los zombis caminan más rápido. Bueno, eso creo. No tengo cronómetro.', 'El Hielo-seta los congela a todos a la vez. Es como un congelador gigante, pero con rabia.'],
    ['Baile fúnebre', 'doomshroom', 'Creí escuchar música en la calle. Es un zombi bailarín, y se ve muy confiado.', 'Si hay baile, hay que apagar la música. Para eso la Seta fatal: un solo botón rojo.'],
    ['Faros apagados', 'magnetshroom', 'Se apagaron todas las luces del vecindario. Mis linternas también. Ya no veo ni mis propios pies.', 'Con un Imán-seta arrancas cubos y cascos de la cabeza de los zombis. Parece un truco de magia.'],
    ['Madrugada', null, 'Aguanta, vecino. Falta poco para el amanecer y los zombis lo saben. Por eso atacan con todo.', 'Mantén los hongos vivos y las nueces firmes. Yo te traigo café. Bueno, un termo con algo parecido.'],
    ['Amanecer', 'lilypad', '¡Lo lograste! El sol sale y los zombis se tambalean. Los muy dormilones.', 'Lo siguiente está en la casa de los García: una piscina. Toma un Nenúfar para flotar. Nos vemos allí.']
  ],
  3: [
    ['La piscina de los García', 'squash', 'Bienvenido a la piscina. Dos carriles de agua, y no puedes plantar en ellos sin ayuda.', 'Los zombis nadan mejor que yo. Prueba con una Calabaza aplastante.'],
    ['Chapuzón', 'threepeater', 'Cuidado con el trampolín: algunos zombis saltan por encima de tus defensas. Qué espectáculo.', 'Un Triple lanzaguisantes cubre tres carriles a la vez. Mucho guisante para tan poca planta.'],
    ['Agua fría', 'tanglekelp', 'El agua está helada, pero los zombis ni lo notan. Están muertos, vecino, ya no sienten frío.', 'Toma un Alga enredadera: se ancla bajo el agua y arrastra al primero que pase.'],
    ['Tubo salvavidas', 'jalapeno', 'Hay zombis con flotadores de patito. Parecen felices, ¿verdad? No te confíes.', 'Un Jalapeño arrasa una fila entera con fuego. Resultado: zombis a la parrilla.'],
    ['Pelotas de playa', 'spikeweed', 'Alguien dejó pelotas por todas partes. Si las tocas, ruedan. Es un caos delicioso.', 'Los Pinchos pinchan lo que pisa el césped. Simples y eficaces, como mi plan de dormir siesta.'],
    ['Bañistas', 'torchwood', 'Esos zombis con gorros de baño llegaron sin avisar. Y no traen toalla.', 'Un Tronco antorcha prende los guisantes que lo cruzan. Doble daño, y el patio se ilumina.'],
    ['Snorkel', null, 'Los zombis con snorkel se sumergen y no pueden ser atacados hasta que salen. Qué traicioneros.', 'Hay que esperar con paciencia y guardar los soles. Yo me quedo mirando las burbujas.'],
    ['Delfines', 'splitpea', 'Un zombi llegó montado en un delfín. No pregunto de dónde lo sacó.', 'Este Guisante doble dispara por delante y por detrás. Los delfines no entienden de retaguardia.'],
    ['Tobogán', null, 'La piscina tiene tobogán y los zombis lo usan como autopista. Qué mal planificada está esta urbanización.', 'Una defensa profunda salva el día. Nueces al frente y deja que los guisantes hagan su arte.'],
    ['Último chapuzón', 'plantern', 'Y eso fue todo en la piscina. Mojado, cansado, pero a salvo. Bien hecho.', 'Mañana se levanta una niebla extraña. Toma una Linterna vegetal, la vas a necesitar.']
  ],
  4: [
    ['Neblina', 'cactus', 'No veo nada, vecino. La niebla cubre la mitad derecha del patio. Los zombis aparecen de la nada.', 'Planta un Cactus. Dispara de lejos, incluso a lo que no ves. Cuidado con abrazarlo.'],
    ['Faroles en la calle', 'blover', 'Algo huele raro. A calcetín, a niebla y a pollo frito. No sé qué es peor.', 'El Trébol sopla la niebla lejos. Pero vuelve. La niebla es terca.'],
    ['Sin visibilidad', 'starfruit', 'Dicen que la niebla trae zombis de otro barrio. Ayer vi uno con chaleco de pescador.', 'La Carambola dispara en cinco direcciones. Perfecta para cuando no sabes de dónde vienen.'],
    ['Ruido en la niebla', 'pumpkin', 'Escucho ruidos que no son de zombis. Eso sí me da miedo. Mi cacerola tiembla.', 'Una Calabaza protege a la planta que está dentro. Como un casco, pero más naranja.'],
    ['Carteles', 'cabbagepult', 'Había un cartel que decía "Vecinos, cuidado con los zombis". Lo clavaron los zombis. Debe ser un chiste.', 'Una Col catapulta lanza coles por encima de las nueces. Hasta contra lo que no ves.'],
    ['Silbatos', null, 'Los zombis se silban entre sí. Se comunican con silbidos. Estoy asustado y un poco impresionado.', 'Mantén tus plantas vivas y los soles al día. Esa es la receta, y también la de mis tacos.'],
    ['Cerco', null, 'Los zombis forman un cerco alrededor del patio. Nunca los había visto tan organizados.', 'Cada carril cuenta. Si uno cae, caen los demás. Cuídalos todos por igual.'],
    ['Cuerno en la niebla', null, 'Escuché un cuerno en la niebla. Es una señal: algo grande se acerca.', 'Gasta soles con cabeza, vecino, y guarda algo para emergencias.'],
    ['Espesura', null, 'La niebla está tan espesa que podría cortarla con cuchillo. Pero no lo hagas, es raro.', 'Un poco más y se despeja. Aguanta, que lo estás haciendo genial.'],
    ['Disipando', 'garlic', 'La niebla se está yendo. Detrás hay un tejado enorme. Eso es lo que sigue.', 'Toma un Ajo: desvía a los zombis hacia otro carril. Huele fatal y funciona de maravilla. ¡Al tejado!']
  ],
  5: [
    ['Escalera', 'flowerpot', 'Subieron por la escalera, vecino. Los zombis llegaron al tejado y ya no hay césped, solo tejas.', 'Aquí las plantas necesitan macetas. Toma una Maceta: es un jardín portátil.'],
    ['Tejas resbalosas', 'kernelpult', 'Las tejas son resbaladizas y los proyectiles directos rebotan en la pendiente. Qué mala idea.', 'Maíz catapulta: lanza maíz y mantequilla. Sin explicaciones. Suena delicioso.'],
    ['Chimenea', 'umbrellaleaf', 'Sale humo de la chimenea. Los zombis intentan entrar por ahí. Qué falta de educación.', 'La Hoja paraguas protege a las plantas vecinas de los lanzamientos. Hasta de los pájaros.'],
    ['Antena', 'marigold', 'La antena se cayó y ahora solo tenemos señal de zombis. ¡No me gusta!', 'Caléndula: produce monedas. Aquí no sirven de nada, pero se ven bonitas.'],
    ['Gárgolas', 'melonpult', 'Encontré una gárgola en la esquina. Creo que me miró. Mmm. Tal vez es solo yeso.', 'El Melón catapulta golpea fuerte: un melón gigante, daño y frescura.'],
    ['Cielo rojo', 'coffeebean', 'El cielo se puso rojo, vecino. Los zombis atacan con todo. Lo siento en mi cacerola.', 'Toma un Grano de café: despierta a las plantas dormidas. Y a mí también.'],
    ['Satélite', null, 'Alguien subió un satélite al tejado. Los zombis lo usan para localizar tu cerebro. Los muy tecnológicos.', 'Mantén la calma y defiende cada carril. Nadie toca tu cerebro mientras yo respire.'],
    ['Último piso', null, 'Ya casi no quedan tejas sin pisar. Los zombis están cada vez más cerca de la puerta.', 'Confío en ti, vecino. Siempre lo hice, desde que me prestaste tu sartén.'],
    ['Pararrayos', null, 'Se acerca una tormenta. Los zombis tienen aspecto de querer mojarse. Qué desfachatez.', 'Aguanta firme esta oleada y estaremos a una sola batalla de la victoria.'],
    ['La cima', null, 'Esta es la última batalla, vecino. Todos los zombis del barrio en un solo tejado.', 'Gracias por defender mi buzón, mi casa y mi cacerola. ¡A plantar por última vez!']
  ]
};

const LEVELS_PER_WORLD = 10;

function buildLevels() {
  const out = [];
  WORLDS.forEach(w => {
    const rows = w.id === 1
      ? DAY_LEVELS
      : PACKED_WORLDS[w.id].map(([name, reward, a, b]) => ({ name, reward, lines: [a, b] }));
    rows.forEach((d, i) => {
      const sub = i + 1;
      out.push({
        id: `${w.id}-${sub}`,
        world: w.id,
        sub,
        name: d.name,
        subtitle: `${w.name} ${w.id}-${sub}`,
        env: w.env,
        blurb: d.lines[0],
        startSuns: d.startSuns ?? ((w.env === 'night' || w.env === 'fog') ? 100 : 50),
        skySuns: !(w.env === 'night' || w.env === 'fog'),   // de noche y con niebla no caen soles
        music: `bgm_${w.env}`,
        reward: d.reward || null,
        waves: null,                                          // LevelManager genera o lee el JSON
        dialogue: d.lines.map(text => ({ speaker: 'Crazy Dave', mood: /!\s*$/.test(text) ? 'excited' : 'normal', text }))
      });
    });
  });
  return out;
}

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
  STORAGE_KEY: 'pvz-modern-days:progress:v2',
  WORLDS,
  ENVS,
  PLANT_NAMES,
  LEVELS_PER_WORLD,
  DEFAULT_UNLOCKED: Object.freeze(['peashooter']),   // el jugador empieza solo con la Lanzaguisantes
  ENFORCE_WATER: false,       // true cuando exista el Nenúfar (lilypad): bloquea plantar en agua
  UPDATE_ORDER: Object.freeze(['plants', 'zombies', 'projectiles', 'mowers', 'pickups', 'suns']),
  /* Manifiesto de assets. Deja vacío para usar solo primitivas.
     Ejemplo:
       images: { sun: 'assets/img/sun.png', card_peashooter: 'assets/img/cards/peashooter.png' },
       audio:  { bgm_day: 'assets/audio/day.mp3', shoot: 'assets/audio/shoot.wav' }               */
  ASSETS: Object.freeze({ images: {}, audio: {} }),
  LEVELS: buildLevels()
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
      case 'shovel': this._noise(0.12, 0.3 * v, 900); this._tone(110, 55, 0.14, 'sine', 0.35 * v, 0.05); break;
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
  play(lines, opts = {}) {
    return new Promise(resolve => {
      if (!lines || !lines.length) { resolve(); return; }
      this.lines = lines;
      this.idx = 0;
      $('#btn-story-skip').hidden = !opts.canSkip;   // primera vez: hay que leer la historia
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
    d.shovelBtn = $('#btn-shovel');
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
    click('#btn-victory-next', () => this.startLevel(this.levelIndex + 1));
    this.dom.pfBtn.addEventListener('click', () => this._toggleFoodTool());
    this.dom.shovelBtn.addEventListener('click', () => { this.audio.unlock(); this._toggleShovel(); });
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
          await this.story.play(lines, { canSkip: !!(data && data.canSkip) });
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
          const lvl = this.level;
          const idx = this.levelIndex;
          const isLast = idx >= Config.LEVELS.length - 1;
          // 1) Recompensa: planta nueva => se añade a unlockedPlants
          let newPlant = null;
          if (lvl.reward && !this.progress.unlockedPlants.includes(lvl.reward)) {
            this.progress.unlockedPlants.push(lvl.reward);
            newPlant = lvl.reward;
          }
          // 2) Avanza el índice (solo si se superó el fragmento más reciente)
          if (idx === this.progress.currentLevelIndex) {
            if (isLast) this.progress.finished = true;
            else this.progress.currentLevelIndex = idx + 1;
          }
          this._saveProgress();
          // 3) Modal de victoria
          const box = $('#victory-reward');
          box.hidden = !newPlant;
          if (newPlant) {
            $('#victory-reward-name').textContent = Config.PLANT_NAMES[newPlant] || newPlant;
            $('#victory-reward-note').textContent = this.registry.plants.has(newPlant)
              ? 'Ya está en tu barra de semillas.'
              : 'Quedará disponible cuando se programe esta planta.';
          }
          $('#btn-victory-next').hidden = isLast;
          $('#victory-text').textContent = isLast
            ? 'La última oleada cayó. Crazy Dave recupera su buzón y el vecindario respira.'
            : `Fragmento ${lvl.subtitle} superado. La historia continúa.`;
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
     Progreso (localStorage) y mapa por mundos
     currentLevelIndex = índice del siguiente fragmento por jugar
     (es decir, último subnivel completado + 1). Empieza en 0 (nivel 1-1).
     ------------------------------------------------------------------ */
  _defaultProgress() {
    return { currentLevelIndex: 0, unlockedPlants: [...Config.DEFAULT_UNLOCKED], finished: false };
  }
  _loadProgress() {
    try {
      const raw = localStorage.getItem(Config.STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        const idx = Number.isInteger(p.currentLevelIndex) ? clamp(p.currentLevelIndex, 0, Config.LEVELS.length - 1) : 0;
        const plants = Array.isArray(p.unlockedPlants) ? p.unlockedPlants.filter(x => typeof x === 'string') : [];
        for (const d of [...Config.DEFAULT_UNLOCKED].reverse()) if (!plants.includes(d)) plants.unshift(d);
        return { currentLevelIndex: idx, unlockedPlants: [...new Set(plants)], finished: !!p.finished };
      }
    } catch (e) { /* almacenamiento no disponible o datos corruptos */ }
    return this._defaultProgress();
  }
  _saveProgress() {
    try { localStorage.setItem(Config.STORAGE_KEY, JSON.stringify(this.progress)); } catch (e) { /* ignorar */ }
  }
  _worldOf(levelIndex) { return Config.LEVELS[clamp(levelIndex, 0, Config.LEVELS.length - 1)].world; }

  _buildMap() {
    const tabs = $('#world-tabs');
    tabs.innerHTML = '';
    Config.WORLDS.forEach(w => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'world-tab';
      b.dataset.world = String(w.id);
      b.textContent = w.name;
      b.addEventListener('click', () => { this.audio.unlock(); this.audio.playSfx('click'); this._showWorld(w.id); });
      tabs.appendChild(b);
    });
    this.mapWorld = this._worldOf(this.progress.currentLevelIndex);
  }
  _refreshMap() {
    this.mapWorld = this._worldOf(this.progress.currentLevelIndex);
    this.selectedMapLevel = null;
    this._showWorld(this.mapWorld);
  }
  _showWorld(worldId) {
    this.mapWorld = worldId;
    const cur = this.progress.currentLevelIndex;
    document.querySelectorAll('#world-tabs .world-tab').forEach(b => {
      const id = Number(b.dataset.world);
      b.disabled = (id - 1) * Config.LEVELS_PER_WORLD > cur;
      b.classList.toggle('is-active', id === worldId);
    });
    // Nodos del mundo, repartidos a lo largo del camino SVG
    const path = $('.map-road-line');
    const len = path.getTotalLength();
    const list = this.dom.mapNodes;
    list.innerHTML = '';
    Config.LEVELS.forEach((lvl, i) => {
      if (lvl.world !== worldId) return;
      const k = lvl.sub - 1;
      const pt = path.getPointAtLength(len * (0.05 + 0.9 * k / (Config.LEVELS_PER_WORLD - 1)));
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'map-node';
      b.dataset.index = String(i);
      b.style.left = `${pt.x / Config.WIDTH * 100}%`;
      b.style.top = `${pt.y / Config.HEIGHT * 100}%`;
      b.textContent = String(lvl.sub);
      b.disabled = i > cur;
      b.classList.toggle('is-done', i < cur);
      b.classList.toggle('is-current', i === cur);
      b.setAttribute('aria-label', `${lvl.subtitle}: ${lvl.name}`);
      const name = document.createElement('span');
      name.className = 'map-node-name';
      name.textContent = lvl.name;
      b.appendChild(name);
      b.addEventListener('click', () => { this.audio.unlock(); this.audio.playSfx('click'); this._selectMapLevel(i); });
      li.appendChild(b);
      list.appendChild(li);
    });
    const first = (worldId - 1) * Config.LEVELS_PER_WORLD;
    const pick = (this.selectedMapLevel !== null && this._worldOf(this.selectedMapLevel) === worldId)
      ? this.selectedMapLevel
      : clamp(cur, first, first + Config.LEVELS_PER_WORLD - 1);
    this._selectMapLevel(Math.min(pick, cur));
  }
  _selectMapLevel(i) {
    if (i > this.progress.currentLevelIndex) return;
    this.selectedMapLevel = i;
    const lvl = Config.LEVELS[i];
    $('#map-info-title').textContent = `${lvl.subtitle}: ${lvl.name}`;
    $('#map-info-text').textContent = lvl.blurb;
    const rewardEl = $('#map-info-reward');
    const showReward = lvl.reward && !this.progress.unlockedPlants.includes(lvl.reward);
    rewardEl.hidden = !showReward;
    if (showReward) rewardEl.textContent = `Recompensa: ${Config.PLANT_NAMES[lvl.reward] || lvl.reward}`;
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
    this.fsm.change('STORY', { lines: this.level.dialogue, next: 'PLAYING', canSkip: index < this.progress.currentLevelIndex });
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
    const ids = this.progress.unlockedPlants.filter(id => this.registry.plants.has(id));   // solo plantas desbloqueadas
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
    this.dom.shovelBtn.setAttribute('aria-pressed', String(this.tool.type === 'shovel'));
    this.dom.stage.classList.toggle('tool-active', this.tool.type !== null);
    this.dom.stage.classList.toggle('tool-shovel', this.tool.type === 'shovel');
  }
  _toggleShovel() {
    if (!this.fsm.is('PLAYING')) return;
    if (this.tool.type === 'shovel') { this._clearTool(); return; }
    this.tool = { type: 'shovel', id: null };
    this.audio.playSfx('click');
    this._syncToolUi();
  }
  /** Desentierra la planta de la celda: la destruye, libera la grilla y suelta la herramienta. */
  _tryShovel(row, col) {
    const plant = this.grid[row][col];
    if (!plant) return;
    plant.dead = true;
    this.grid[row][col] = null;
    this.audio.playSfx('shovel');
    this._clearTool();
  }
  _denySuns() {
    this.audio.playSfx('deny');
    this.dom.sunCounter.classList.remove('deny');
    void this.dom.sunCounter.offsetWidth;
    this.dom.sunCounter.classList.add('deny');
    this.spawnFloatText('Soles insuficientes', this.input.mouse.x, this.input.mouse.y, '#ff8787');
  }
  isWater(row) {
    const e = Config.ENVS[this.level && this.level.env];
    return !!(e && e.waterRows && e.waterRows.includes(row));
  }
  canPlace(def, row, col) {
    if (this.grid[row][col]) return false;
    if (Config.ENFORCE_WATER && this.isWater(row) && !def.aquatic) return false;
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
    else if (this.tool.type === 'shovel') this._tryShovel(cell.row, cell.col);
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
    if (code === 'KeyS') { this._toggleShovel(); return; }
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
    if (this.level && this.level.env === 'fog') this._drawFog(ctx);
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
    } else if (this.tool.type === 'shovel') {
      const hasPlant = !!this.grid[cell.row][cell.col];
      ctx.fillStyle = hasPlant ? 'rgba(220,40,40,.28)' : 'rgba(255,255,255,.08)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = hasPlant ? '#ff6b6b' : 'rgba(255,255,255,.35)';
      ctx.lineWidth = 4;
      ctx.strokeRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
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
     Fondo dinámico según this.level.env: day, night, pool, fog, roof.
     Si existe la imagen 'bg_<env>' en el AssetLoader, se usa en su lugar.
     ------------------------------------------------------------------ */
  _drawBackground() {
    const ctx = this.ctx.bg;
    const W = Config.WIDTH, H = Config.HEIGHT, g = Config.GRID;
    const env = (this.level && this.level.env) || 'day';
    const E = Config.ENVS[env] || Config.ENVS.day;
    const gridW = g.cols * g.cellW;
    this.dom.viewport.dataset.env = env;
    ctx.clearRect(0, 0, W, H);
    if (this.assets.hasImage(`bg_${env}`)) { ctx.drawImage(this.assets.getImage(`bg_${env}`), 0, 0, W, H); return; }

    // Cielo
    const sky = ctx.createLinearGradient(0, 0, 0, g.y);
    sky.addColorStop(0, E.sky[0]);
    sky.addColorStop(1, E.sky[1]);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    if (E.stars) {                                   // estrellas deterministas y luna
      let s = 7;
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 46; i++) {
        s = (s * 16807) % 2147483647; const x = (s % 1000) / 1000 * W;
        s = (s * 16807) % 2147483647; const y = (s % 1000) / 1000 * (g.y - 24);
        ctx.globalAlpha = 0.35 + (s % 5) / 10;
        ctx.fillRect(x, y, 2, 2);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#f4f1d0';
      ctx.beginPath(); ctx.arc(960, 46, 22, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = E.sky[0];
      ctx.beginPath(); ctx.arc(971, 40, 20, 0, Math.PI * 2); ctx.fill();
    }

    // Cerca de madera (el tejado no tiene)
    const fenceTop = 58, fenceBottom = g.y + 4;
    if (E.fence) {
      for (let x = g.x - 20; x < W; x += 26) {
        ctx.fillStyle = (Math.floor(x / 26) % 2) ? E.fence[0] : E.fence[1];
        ctx.beginPath();
        ctx.moveTo(x, fenceBottom); ctx.lineTo(x, fenceTop + 10); ctx.lineTo(x + 11, fenceTop); ctx.lineTo(x + 22, fenceTop + 10); ctx.lineTo(x + 22, fenceBottom);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 2; ctx.stroke();
      }
      ctx.fillStyle = E.rail;
      ctx.fillRect(g.x - 20, fenceTop + 28, W, 8);
      ctx.fillRect(g.x - 20, fenceBottom - 24, W, 8);
    } else if (E.roof) {                              // cumbrera del tejado
      ctx.fillStyle = E.rail;
      ctx.fillRect(0, g.y - 12, W, 12);
    }

    // Celdas: patrón de ajedrez de césped, agua (piscina) o tejas
    for (let r = 0; r < g.rows; r++) {
      const water = !!(E.waterRows && E.waterRows.includes(r));
      for (let c = 0; c < g.cols; c++) {
        const cr = this.cellRect(r, c);
        ctx.fillStyle = water ? E.water[(r + c) % 2] : E.lawn[(r + c) % 2];
        ctx.fillRect(cr.x, cr.y, cr.w, cr.h);
        if (E.roof) {
          ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(cr.x + cr.w / 2, cr.y + 2, cr.w / 2 - 4, 0.12 * Math.PI, 0.88 * Math.PI); ctx.stroke();
          ctx.beginPath(); ctx.arc(cr.x + cr.w / 2, cr.y + cr.h / 2 + 2, cr.w / 2 - 4, 0.12 * Math.PI, 0.88 * Math.PI); ctx.stroke();
        }
      }
    }
    // Detalles del agua: borde de la piscina y ondas
    if (E.waterRows) {
      const y0 = g.y + E.waterRows[0] * g.cellH;
      const y1 = g.y + (E.waterRows[E.waterRows.length - 1] + 1) * g.cellH;
      ctx.fillStyle = '#e9e4d2';
      ctx.fillRect(g.x, y0 - 6, gridW, 6);
      ctx.fillRect(g.x, y1, gridW, 6);
      ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 2;
      for (let y = y0 + 20; y < y1; y += 28) {
        ctx.beginPath();
        for (let x = g.x; x <= g.x + gridW; x += 8) {
          const yy = y + Math.sin((x + y) / 14) * 3;
          if (x === g.x) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
    }

    // Franjas laterales y líneas de la grilla
    ctx.fillStyle = E.side;
    ctx.fillRect(0, g.y, g.x, g.rows * g.cellH);
    ctx.fillRect(this.gridRight, g.y, W - this.gridRight, g.rows * g.cellH);
    ctx.strokeStyle = 'rgba(0,0,0,.08)'; ctx.lineWidth = 1;
    for (let r = 0; r <= g.rows; r++) { ctx.beginPath(); ctx.moveTo(g.x, g.y + r * g.cellH); ctx.lineTo(this.gridRight, g.y + r * g.cellH); ctx.stroke(); }
    for (let c = 0; c <= g.cols; c++) { ctx.beginPath(); ctx.moveTo(g.x + c * g.cellW, g.y); ctx.lineTo(g.x + c * g.cellW, this.gridBottom); ctx.stroke(); }

    // Fachada de la casa
    ctx.fillStyle = E.house;
    ctx.fillRect(0, g.y - 4, 26, g.rows * g.cellH + 8);
    ctx.strokeStyle = 'rgba(0,0,0,.2)';
    for (let y = g.y; y < this.gridBottom; y += 14) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(26, y); ctx.stroke(); }
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.fillRect(24, g.y - 4, 4, g.rows * g.cellH + 8);

    // Acera / borde inferior
    ctx.fillStyle = E.walk;
    ctx.fillRect(0, this.gridBottom, W, H - this.gridBottom);
    ctx.fillStyle = 'rgba(0,0,0,.18)';
    ctx.fillRect(0, this.gridBottom, W, 6);
    ctx.strokeStyle = 'rgba(0,0,0,.12)';
    for (let x = 0; x < W; x += 120) { ctx.beginPath(); ctx.moveTo(x, this.gridBottom + 6); ctx.lineTo(x, H); ctx.stroke(); }

    // Velo ambiental (noche azulada, bruma de la niebla)
    if (E.overlay) { ctx.fillStyle = E.overlay; ctx.fillRect(0, 0, W, H); }
  }

  /** Niebla del mundo 4: cubre la mitad derecha y se desplaza lentamente (capa UI). */
  _drawFog(ctx) {
    const g = Config.GRID;
    const x0 = g.x + 3.5 * g.cellW;
    const drift = Math.sin(this.timer.elapsed * 0.4) * 14;
    const grad = ctx.createLinearGradient(x0 + drift, 0, x0 + 2.6 * g.cellW + drift, 0);
    grad.addColorStop(0, 'rgba(214,224,232,0)');
    grad.addColorStop(1, 'rgba(214,224,232,.62)');
    ctx.fillStyle = grad;
    ctx.fillRect(x0 + drift, g.y - 8, Config.WIDTH - x0 - drift, g.rows * g.cellH + 16);
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