'use strict';

// ============================================================
// CONSTANTS
// ============================================================
const SAFE_MIN          = 30;
const SAFE_MAX          = 75;
const GAME_DURATION_MS  = 60_000;
const FIGHT_MAX_MS      = 12_000;
const CAST_COOLDOWN_MS  = 600;
const FLASH_DURATION_MS = 900;
const REEL_TICK_MS      = 1000 / 11; // ~11 ticks/sec

// Cast → Bite → Hook phase
const CAST_WAIT_MAX_MS   = 4500;
const BITE_WINDOW_MS     = 550;
const BITE_MIN_DELAY_MS  = 400;
const BITE_MAX_DELAY_MS  = 3200;
const FAKE_NIBBLE_CHANCE = 0.35;
const EARLY_HOOK_PENALTY = true;

// Tension physics (per second)
const REEL_FORCE        = 18;   // T increases while reeling
const SLACK_FORCE       = 28;   // T decreases while slacking
const FISH_DRIFT        = 0;    // base drift: 0 = neutral (fish randomly up/down)
const FISH_NOISE        = 10;   // Brownian amplitude (random ±)
const SPIKE_RATE        = 0.5;  // avg spikes/sec
const SPIKE_STRENGTH    = 11;   // magnitude of spike

// Damage (per second when reeling in safe zone)
const REEL_DAMAGE       = 28;

// Fish HP by rarity
const HP_MAP = { E: 60, D: 85, C: 110, B: 140, A: 170 };

// Fish aggressiveness (multiplier on noise/drift/spikes)
const AGG_MAP = { E: 0.7, D: 0.9, C: 1.1, B: 1.4, A: 1.8 };

// localStorage keys
const LS_ENC  = 'fishing_encyclopedia';
const LS_HI   = 'fishing_highscore';

// ============================================================
// STATE
// ============================================================
let gameState = 'TITLE'; // TITLE | PLAYING_IDLE | CAST_WAIT | BITE_WINDOW | FIGHTING | RESULT

let gameTimeMs  = GAME_DURATION_MS;
let score       = 0;
let highscore   = 0;
let encyclopedia = {};
let items       = [];

// Fighting
let tension     = 50;
let fishHp      = 100;
let fishHpMax   = 100;
let currentFish = null;
let fightMs     = 0;
let reelTickTimer = 0;

// Cast-wait / bite phase
let pendingPick      = null;
let castElapsedMs    = 0;
let biteAtMs         = 0;
let biteWindowLeftMs = 0;
let fakeNibbleTimes  = [];
let fakeNibbleIdx    = 0;
let nibbleFlashMs    = 0;

// Fishing log for result screen
let recentCatches = [];

// Cooldown / flash
let castCooldown = 0;
let flashMsg    = '';
let flashTimer  = 0;

// Input edge detection
const inp = { space: false, shift: false, left: false, right: false };
const prev = { space: false, left: false };

// Audio
let audioCtx   = null;
let muted      = false;

// RAF timing
let lastTs     = null;

// Scene canvas
let canvas, ctx, canvasW, canvasH;

// Bobber animation
let bobberPhase = 0;

// ============================================================
// DOM REFS (populated in init)
// ============================================================
let dom = {};

// ============================================================
// INIT
// ============================================================
async function init() {
  dom = {
    timer:        document.getElementById('timer'),
    score:        document.getElementById('score-display'),
    hi:           document.getElementById('highscore-display'),
    muteBtn:      document.getElementById('mute-btn'),
    gauges:       document.getElementById('gauges'),
    tensionFill:  document.getElementById('tension-fill'),
    tensionPtr:   document.getElementById('tension-ptr'),
    tensionVal:   document.getElementById('tension-value'),
    fishHpSec:    document.getElementById('fishHp-section'),
    fishHpFill:   document.getElementById('fishHp-fill'),
    fishHpVal:    document.getElementById('fishHp-value'),
    flash:        document.getElementById('flash-msg'),
    hint:         document.getElementById('controls-hint'),
    titleScreen:  document.getElementById('title-screen'),
    titleHi:      document.getElementById('title-hi-score'),
    titleEncBtn:  document.getElementById('title-enc-btn'),
    resultScreen: document.getElementById('result-screen'),
    resultScore:  document.getElementById('result-score-line'),
    resultHi:     document.getElementById('result-hi-line'),
    resultCatches:document.getElementById('result-catches'),
    startBtn:     document.getElementById('start-btn'),
    retryBtn:     document.getElementById('retry-btn'),
    toTitleBtn:   document.getElementById('to-title-btn'),
    encModal:     document.getElementById('enc-modal'),
    encTbody:     document.getElementById('enc-tbody'),
    closeEncBtn:  document.getElementById('close-enc-btn'),
  };

  // Canvas
  canvas  = document.getElementById('scene-canvas');
  ctx     = canvas.getContext('2d');
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // Load data
  await loadItems();
  loadStorage();
  updateHiDisplay();

  // Events
  setupInput();
  setupUI();

  // Start loop
  requestAnimationFrame(loop);
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr  = window.devicePixelRatio || 1;
  canvas.width  = Math.floor(rect.width  * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  // Changing canvas.width/height resets ctx; re-apply HiDPI scale
  ctx.scale(dpr, dpr);
  // Store CSS dimensions for drawing
  canvasW = rect.width;
  canvasH = rect.height;
}

// ============================================================
// DATA
// Fetches data/items.json; falls back to ITEMS_FALLBACK if
// running via file:// (where fetch is blocked by CORS policy).
// ============================================================
const ITEMS_FALLBACK = [
  {"id":"junk_boot","name":"ながぐつ","type":"junk","rarity":"E","score":0,"spawnWeight":8,"length":{"min":25,"max":35},"weight":{"min":0.20,"max":0.50}},
  {"id":"junk_bottle","name":"ペットボトル","type":"junk","rarity":"E","score":0,"spawnWeight":8,"length":{"min":20,"max":30},"weight":{"min":0.03,"max":0.10}},
  {"id":"fish_medaka","name":"ぷちぷちめだかちゃん","type":"fish","rarity":"E","score":10,"spawnWeight":14,"length":{"min":2,"max":4},"weight":{"min":0.001,"max":0.003}},
  {"id":"fish_tanago","name":"ぷちぷちたなごちゃん","type":"fish","rarity":"E","score":20,"spawnWeight":13,"length":{"min":5,"max":12},"weight":{"min":0.002,"max":0.020}},
  {"id":"fish_yoshino","name":"ぷちぷちよしのぼりちゃん","type":"fish","rarity":"E","score":20,"spawnWeight":12,"length":{"min":5,"max":10},"weight":{"min":0.001,"max":0.010}},
  {"id":"fish_zezera","name":"ぷちぷちぜぜらちゃん","type":"fish","rarity":"E","score":20,"spawnWeight":11,"length":{"min":5,"max":8},"weight":{"min":0.001,"max":0.005}},
  {"id":"fish_itomoro","name":"ぷちぷちいともろこちゃん","type":"fish","rarity":"E","score":20,"spawnWeight":11,"length":{"min":6,"max":10},"weight":{"min":0.001,"max":0.010}},
  {"id":"fish_dojo","name":"ぷちぷちどじょうちゃん","type":"fish","rarity":"E","score":25,"spawnWeight":12,"length":{"min":10,"max":20},"weight":{"min":0.005,"max":0.030}},
  {"id":"fish_oikawa","name":"ぷちぷちおいかわちゃん","type":"fish","rarity":"E","score":25,"spawnWeight":13,"length":{"min":8,"max":15},"weight":{"min":0.005,"max":0.030}},
  {"id":"fish_abraya","name":"ぷちぷちあぶらはやちゃん","type":"fish","rarity":"E","score":20,"spawnWeight":11,"length":{"min":8,"max":15},"weight":{"min":0.003,"max":0.020}},
  {"id":"fish_takahaya","name":"ぷちぷちたかはやちゃん","type":"fish","rarity":"E","score":20,"spawnWeight":11,"length":{"min":8,"max":14},"weight":{"min":0.003,"max":0.015}},
  {"id":"fish_motsugo","name":"ぷちぷちもつごちゃん","type":"fish","rarity":"E","score":25,"spawnWeight":12,"length":{"min":7,"max":12},"weight":{"min":0.003,"max":0.015}},
  {"id":"fish_chichibu","name":"ぷちぷちちちぶちゃん","type":"fish","rarity":"E","score":20,"spawnWeight":11,"length":{"min":8,"max":15},"weight":{"min":0.003,"max":0.020}},
  {"id":"fish_ukigori","name":"ぷちぷちうきごりちゃん","type":"fish","rarity":"E","score":25,"spawnWeight":11,"length":{"min":7,"max":12},"weight":{"min":0.002,"max":0.015}},
  {"id":"fish_shirouo","name":"ぷちぷちしろうおちゃん","type":"fish","rarity":"E","score":25,"spawnWeight":10,"length":{"min":5,"max":8},"weight":{"min":0.001,"max":0.005}},
  {"id":"fish_haze","name":"ぷちぷちはぜちゃん","type":"fish","rarity":"E","score":30,"spawnWeight":14,"length":{"min":8,"max":18},"weight":{"min":0.005,"max":0.050}},
  {"id":"fish_kamatsuka","name":"ぷちぷちかまつかちゃん","type":"fish","rarity":"E","score":30,"spawnWeight":10,"length":{"min":8,"max":15},"weight":{"min":0.005,"max":0.020}},
  {"id":"fish_kawamutsu","name":"ぷちぷちかわむつちゃん","type":"fish","rarity":"E","score":30,"spawnWeight":12,"length":{"min":10,"max":20},"weight":{"min":0.010,"max":0.060}},
  {"id":"fish_mugitsuku","name":"ぷちぷちむぎつくちゃん","type":"fish","rarity":"E","score":30,"spawnWeight":10,"length":{"min":10,"max":20},"weight":{"min":0.005,"max":0.030}},
  {"id":"fish_bluegill","name":"ぷちぷちぶるーぎるちゃん","type":"fish","rarity":"E","score":30,"spawnWeight":13,"length":{"min":8,"max":20},"weight":{"min":0.020,"max":0.300}},
  {"id":"fish_sujishima","name":"ぷちぷちすじしまどじょうちゃん","type":"fish","rarity":"E","score":30,"spawnWeight":10,"length":{"min":10,"max":20},"weight":{"min":0.005,"max":0.020}},
  {"id":"fish_honmoro","name":"ぷちぷちほんもろこちゃん","type":"fish","rarity":"E","score":30,"spawnWeight":11,"length":{"min":8,"max":15},"weight":{"min":0.003,"max":0.020}},
  {"id":"fish_yaritanago","name":"ぷちぷちやりたなごちゃん","type":"fish","rarity":"E","score":35,"spawnWeight":10,"length":{"min":6,"max":10},"weight":{"min":0.002,"max":0.015}},
  {"id":"fish_kanehira","name":"ぷちぷちかねひらちゃん","type":"fish","rarity":"E","score":40,"spawnWeight":10,"length":{"min":7,"max":14},"weight":{"min":0.003,"max":0.030}},
  {"id":"fish_ugui","name":"ぷちぷちうぐいちゃん","type":"fish","rarity":"E","score":35,"spawnWeight":12,"length":{"min":15,"max":30},"weight":{"min":0.030,"max":0.300}},
  {"id":"fish_funa","name":"ぷちぷちふなちゃん","type":"fish","rarity":"E","score":35,"spawnWeight":13,"length":{"min":10,"max":30},"weight":{"min":0.050,"max":0.500}},
  {"id":"fish_ginbuna","name":"ぷちぷちぎんぶなちゃん","type":"fish","rarity":"E","score":40,"spawnWeight":12,"length":{"min":15,"max":30},"weight":{"min":0.050,"max":0.500}},
  {"id":"fish_gori","name":"ぷちぷちごりちゃん","type":"fish","rarity":"E","score":40,"spawnWeight":10,"length":{"min":8,"max":15},"weight":{"min":0.005,"max":0.030}},
  {"id":"fish_wataka","name":"ぷちぷちわたかちゃん","type":"fish","rarity":"E","score":50,"spawnWeight":10,"length":{"min":20,"max":40},"weight":{"min":0.100,"max":0.500}},
  {"id":"fish_sappa","name":"ぷちぷちさっぱちゃん","type":"fish","rarity":"E","score":30,"spawnWeight":12,"length":{"min":10,"max":18},"weight":{"min":0.015,"max":0.080}},
  {"id":"fish_konoshiro","name":"ぷちぷちこのしろちゃん","type":"fish","rarity":"E","score":35,"spawnWeight":11,"length":{"min":20,"max":30},"weight":{"min":0.100,"max":0.300}},
  {"id":"fish_aji","name":"ぷちぷちあじちゃん","type":"fish","rarity":"E","score":40,"spawnWeight":14,"length":{"min":15,"max":35},"weight":{"min":0.050,"max":0.400}},
  {"id":"fish_katakuchi","name":"ぷちぷちかたくちいわしちゃん","type":"fish","rarity":"E","score":25,"spawnWeight":13,"length":{"min":10,"max":18},"weight":{"min":0.010,"max":0.050}},
  {"id":"fish_iwashi","name":"ぷちぷちいわしちゃん","type":"fish","rarity":"E","score":30,"spawnWeight":14,"length":{"min":12,"max":25},"weight":{"min":0.020,"max":0.150}},
  {"id":"fish_nisin","name":"ぷちぷちにしんちゃん","type":"fish","rarity":"E","score":40,"spawnWeight":11,"length":{"min":25,"max":35},"weight":{"min":0.100,"max":0.300}},
  {"id":"fish_koango","name":"ぷちぷちこうなごちゃん","type":"fish","rarity":"E","score":20,"spawnWeight":12,"length":{"min":5,"max":10},"weight":{"min":0.001,"max":0.005}},
  {"id":"fish_kisu","name":"ぷちぷちきすちゃん","type":"fish","rarity":"E","score":45,"spawnWeight":12,"length":{"min":15,"max":30},"weight":{"min":0.030,"max":0.200}},
  {"id":"fish_bera","name":"ぷちぷちべらちゃん","type":"fish","rarity":"E","score":35,"spawnWeight":11,"length":{"min":15,"max":30},"weight":{"min":0.050,"max":0.300}},
  {"id":"fish_suzumedai","name":"ぷちぷちすずめだいちゃん","type":"fish","rarity":"E","score":35,"spawnWeight":11,"length":{"min":12,"max":18},"weight":{"min":0.020,"max":0.080}},
  {"id":"fish_aigo","name":"ぷちぷちあいごちゃん","type":"fish","rarity":"E","score":40,"spawnWeight":10,"length":{"min":15,"max":25},"weight":{"min":0.050,"max":0.300}},
  {"id":"fish_mejina_s","name":"ぷちぷちめじなちゃん","type":"fish","rarity":"E","score":50,"spawnWeight":10,"length":{"min":10,"max":20},"weight":{"min":0.030,"max":0.200}},
  {"id":"fish_saba","name":"ぷちぷちさばちゃん","type":"fish","rarity":"E","score":50,"spawnWeight":13,"length":{"min":25,"max":50},"weight":{"min":0.200,"max":1.000}},
  {"id":"fish_wakasagi","name":"わんぱくわかさぎちゃん","type":"fish","rarity":"D","score":120,"spawnWeight":7,"length":{"min":8,"max":15},"weight":{"min":0.005,"max":0.030}},
  {"id":"fish_ishimochi","name":"わんぱくいしもちちゃん","type":"fish","rarity":"D","score":130,"spawnWeight":6,"length":{"min":20,"max":35},"weight":{"min":0.100,"max":0.500}},
  {"id":"fish_anago","name":"わんぱくあなごちゃん","type":"fish","rarity":"D","score":150,"spawnWeight":6,"length":{"min":40,"max":80},"weight":{"min":0.100,"max":0.800}},
  {"id":"fish_bora","name":"わんぱくぼらちゃん","type":"fish","rarity":"D","score":140,"spawnWeight":6,"length":{"min":30,"max":70},"weight":{"min":0.300,"max":3.000}},
  {"id":"fish_maiwashi","name":"わんぱくまいわしちゃん","type":"fish","rarity":"D","score":130,"spawnWeight":6,"length":{"min":20,"max":28},"weight":{"min":0.100,"max":0.300}},
  {"id":"fish_kasago","name":"わんぱくかさごちゃん","type":"fish","rarity":"D","score":180,"spawnWeight":5,"length":{"min":15,"max":30},"weight":{"min":0.100,"max":0.500}},
  {"id":"fish_mebaru","name":"わんぱくめばるちゃん","type":"fish","rarity":"D","score":180,"spawnWeight":5,"length":{"min":20,"max":35},"weight":{"min":0.100,"max":0.800}},
  {"id":"fish_mejina_l","name":"わんぱくめじなちゃん","type":"fish","rarity":"D","score":200,"spawnWeight":4,"length":{"min":30,"max":50},"weight":{"min":0.300,"max":2.000}},
  {"id":"fish_ainame","name":"わんぱくあいなめちゃん","type":"fish","rarity":"D","score":220,"spawnWeight":4,"length":{"min":30,"max":50},"weight":{"min":0.200,"max":1.500}},
  {"id":"fish_soi","name":"わんぱくくろそいちゃん","type":"fish","rarity":"D","score":220,"spawnWeight":4,"length":{"min":25,"max":50},"weight":{"min":0.200,"max":2.000}},
  {"id":"fish_chinu","name":"わんぱくくろだいちゃん","type":"fish","rarity":"D","score":230,"spawnWeight":4,"length":{"min":30,"max":60},"weight":{"min":0.300,"max":3.000}},
  {"id":"fish_ayu","name":"わんぱくあゆちゃん","type":"fish","rarity":"D","score":200,"spawnWeight":5,"length":{"min":15,"max":30},"weight":{"min":0.050,"max":0.300}},
  {"id":"fish_nigoi","name":"わんぱくにごいちゃん","type":"fish","rarity":"D","score":200,"spawnWeight":4,"length":{"min":30,"max":60},"weight":{"min":0.300,"max":3.000}},
  {"id":"fish_himemasu","name":"わんぱくひめますちゃん","type":"fish","rarity":"D","score":240,"spawnWeight":4,"length":{"min":25,"max":35},"weight":{"min":0.200,"max":0.800}},
  {"id":"fish_amago","name":"わんぱくあまごちゃん","type":"fish","rarity":"D","score":260,"spawnWeight":4,"length":{"min":20,"max":40},"weight":{"min":0.100,"max":0.800}},
  {"id":"fish_yamame","name":"わんぱくやまめちゃん","type":"fish","rarity":"D","score":260,"spawnWeight":4,"length":{"min":20,"max":40},"weight":{"min":0.100,"max":0.800}},
  {"id":"fish_iwana","name":"わんぱくいわなちゃん","type":"fish","rarity":"D","score":280,"spawnWeight":3,"length":{"min":20,"max":50},"weight":{"min":0.100,"max":2.000}},
  {"id":"fish_nijimasu","name":"わんぱくにじますちゃん","type":"fish","rarity":"D","score":280,"spawnWeight":4,"length":{"min":25,"max":60},"weight":{"min":0.100,"max":3.000}},
  {"id":"fish_bass","name":"わんぱくぶらっくばすちゃん","type":"fish","rarity":"D","score":300,"spawnWeight":4,"length":{"min":20,"max":50},"weight":{"min":0.200,"max":3.000}},
  {"id":"fish_namazu","name":"わんぱくなまずちゃん","type":"fish","rarity":"D","score":300,"spawnWeight":3,"length":{"min":30,"max":70},"weight":{"min":0.500,"max":5.000}},
  {"id":"fish_raigyo","name":"わんぱくらいぎょちゃん","type":"fish","rarity":"D","score":320,"spawnWeight":3,"length":{"min":40,"max":100},"weight":{"min":0.500,"max":5.000}},
  {"id":"fish_koi","name":"わんぱくこいちゃん","type":"fish","rarity":"D","score":300,"spawnWeight":4,"length":{"min":30,"max":80},"weight":{"min":0.500,"max":10.000}},
  {"id":"fish_unagi","name":"わんぱくうなぎちゃん","type":"fish","rarity":"D","score":340,"spawnWeight":3,"length":{"min":40,"max":100},"weight":{"min":0.200,"max":2.000}},
  {"id":"fish_souko","name":"わんぱくそうぎょちゃん","type":"fish","rarity":"D","score":340,"spawnWeight":3,"length":{"min":50,"max":100},"weight":{"min":2.000,"max":20.000}},
  {"id":"fish_hakuren","name":"わんぱくはくれんちゃん","type":"fish","rarity":"D","score":320,"spawnWeight":3,"length":{"min":40,"max":80},"weight":{"min":1.000,"max":10.000}},
  {"id":"fish_suzuki","name":"わんぱくすずきちゃん","type":"fish","rarity":"D","score":360,"spawnWeight":4,"length":{"min":40,"max":80},"weight":{"min":0.500,"max":8.000}},
  {"id":"fish_tako","name":"わんぱくまだこちゃん","type":"fish","rarity":"D","score":280,"spawnWeight":4,"length":{"min":20,"max":50},"weight":{"min":0.100,"max":2.000}},
  {"id":"fish_ika","name":"わんぱくするめいかちゃん","type":"fish","rarity":"D","score":260,"spawnWeight":4,"length":{"min":20,"max":40},"weight":{"min":0.100,"max":0.500}},
  {"id":"fish_sakura","name":"わんぱくさくらますちゃん","type":"fish","rarity":"D","score":380,"spawnWeight":3,"length":{"min":30,"max":65},"weight":{"min":0.500,"max":3.000}},
  {"id":"fish_hirasuzuki","name":"わんぱくひらすずきちゃん","type":"fish","rarity":"D","score":380,"spawnWeight":3,"length":{"min":40,"max":80},"weight":{"min":0.500,"max":5.000}},
  {"id":"fish_isaki","name":"きらきらいさきちゃん","type":"fish","rarity":"C","score":500,"spawnWeight":2.5,"length":{"min":25,"max":45},"weight":{"min":0.300,"max":2.000}},
  {"id":"fish_aoriika","name":"きらきらあおりいかちゃん","type":"fish","rarity":"C","score":520,"spawnWeight":2.5,"length":{"min":25,"max":40},"weight":{"min":0.200,"max":2.000}},
  {"id":"fish_makarei","name":"きらきらまこがれいちゃん","type":"fish","rarity":"C","score":550,"spawnWeight":2.0,"length":{"min":30,"max":60},"weight":{"min":0.200,"max":2.000}},
  {"id":"fish_kijihata","name":"きらきらきじはたちゃん","type":"fish","rarity":"C","score":580,"spawnWeight":2.0,"length":{"min":25,"max":45},"weight":{"min":0.200,"max":2.000}},
  {"id":"fish_hobo","name":"きらきらほうぼうちゃん","type":"fish","rarity":"C","score":580,"spawnWeight":2.0,"length":{"min":25,"max":40},"weight":{"min":0.200,"max":1.000}},
  {"id":"fish_onikasago","name":"きらきらおにかさごちゃん","type":"fish","rarity":"C","score":620,"spawnWeight":1.8,"length":{"min":20,"max":35},"weight":{"min":0.200,"max":1.500}},
  {"id":"fish_mahata","name":"きらきらまはたちゃん","type":"fish","rarity":"C","score":650,"spawnWeight":1.5,"length":{"min":40,"max":80},"weight":{"min":1.000,"max":10.000}},
  {"id":"fish_tachiuo","name":"きらきらたちうおちゃん","type":"fish","rarity":"C","score":680,"spawnWeight":1.5,"length":{"min":80,"max":150},"weight":{"min":0.500,"max":3.000}},
  {"id":"fish_isidai","name":"きらきらいしだいちゃん","type":"fish","rarity":"C","score":700,"spawnWeight":1.5,"length":{"min":30,"max":70},"weight":{"min":0.500,"max":5.000}},
  {"id":"fish_sawara","name":"きらきらさわらちゃん","type":"fish","rarity":"C","score":720,"spawnWeight":1.5,"length":{"min":50,"max":100},"weight":{"min":1.000,"max":5.000}},
  {"id":"fish_hirame","name":"きらきらひらめちゃん","type":"fish","rarity":"C","score":750,"spawnWeight":1.5,"length":{"min":40,"max":80},"weight":{"min":0.500,"max":5.000}},
  {"id":"fish_shimaaji","name":"きらきらしまあじちゃん","type":"fish","rarity":"C","score":800,"spawnWeight":1.2,"length":{"min":30,"max":60},"weight":{"min":0.500,"max":4.000}},
  {"id":"fish_kanpachi","name":"きらきらかんぱちちゃん","type":"fish","rarity":"C","score":850,"spawnWeight":1.2,"length":{"min":50,"max":100},"weight":{"min":2.000,"max":10.000}},
  {"id":"fish_buri","name":"きらきらぶりちゃん","type":"fish","rarity":"C","score":900,"spawnWeight":1.0,"length":{"min":50,"max":100},"weight":{"min":2.000,"max":10.000}},
  {"id":"fish_madai","name":"きらきらまだいちゃん","type":"fish","rarity":"C","score":1000,"spawnWeight":1.0,"length":{"min":40,"max":80},"weight":{"min":0.500,"max":5.000}},
  {"id":"fish_kinmedai","name":"すごつよきんめだいくん","type":"fish","rarity":"B","score":1500,"spawnWeight":0.8,"length":{"min":30,"max":50},"weight":{"min":0.300,"max":2.000}},
  {"id":"fish_magochi","name":"すごつよまごちくん","type":"fish","rarity":"B","score":1600,"spawnWeight":0.7,"length":{"min":30,"max":60},"weight":{"min":0.500,"max":3.000}},
  {"id":"fish_akahata","name":"すごつよあかはたくん","type":"fish","rarity":"B","score":1800,"spawnWeight":0.7,"length":{"min":30,"max":60},"weight":{"min":0.500,"max":3.000}},
  {"id":"fish_katsuo","name":"すごつよかつおくん","type":"fish","rarity":"B","score":2000,"spawnWeight":0.6,"length":{"min":50,"max":100},"weight":{"min":2.000,"max":10.000}},
  {"id":"fish_hiramasa","name":"すごつよひらまさくん","type":"fish","rarity":"B","score":2200,"spawnWeight":0.5,"length":{"min":60,"max":120},"weight":{"min":3.000,"max":20.000}},
  {"id":"fish_shiira","name":"すごつよしいらくん","type":"fish","rarity":"B","score":2400,"spawnWeight":0.5,"length":{"min":60,"max":150},"weight":{"min":5.000,"max":25.000}},
  {"id":"fish_kue","name":"すごつよくえくん","type":"fish","rarity":"B","score":2600,"spawnWeight":0.4,"length":{"min":50,"max":100},"weight":{"min":5.000,"max":50.000}},
  {"id":"fish_chozame","name":"すごつよちょうざめくん","type":"fish","rarity":"B","score":2800,"spawnWeight":0.4,"length":{"min":50,"max":150},"weight":{"min":5.000,"max":100.000}},
  {"id":"fish_kajiki","name":"すごつよかじきくん","type":"fish","rarity":"B","score":3000,"spawnWeight":0.3,"length":{"min":60,"max":120},"weight":{"min":5.000,"max":30.000}},
  {"id":"fish_oodai","name":"すごつよだいおうまだいくん","type":"fish","rarity":"B","score":3500,"spawnWeight":0.3,"length":{"min":60,"max":90},"weight":{"min":3.000,"max":15.000}},
  {"id":"fish_kuromaguro","name":"でんせつのくろまぐろさま","type":"fish","rarity":"A","score":5000,"spawnWeight":1.0,"length":{"min":150,"max":280},"weight":{"min":50.000,"max":300.000}},
  {"id":"fish_ryugu","name":"でんせつのりゅうぐうのつかいさま","type":"fish","rarity":"A","score":8000,"spawnWeight":0.7,"length":{"min":300,"max":800},"weight":{"min":50.000,"max":300.000}},
  {"id":"fish_megamouth","name":"でんせつのめがまうすさま","type":"fish","rarity":"A","score":10000,"spawnWeight":0.5,"length":{"min":400,"max":700},"weight":{"min":700.000,"max":2000.000}}
];

async function loadItems() {
  try {
    const r = await fetch('data/items.json');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    items = await r.json();
  } catch (_) {
    // Fallback for file:// protocol or missing server
    items = ITEMS_FALLBACK;
  }
}

function loadStorage() {
  const hi  = localStorage.getItem(LS_HI);
  highscore = hi ? Number(hi) : 0;
  const enc = localStorage.getItem(LS_ENC);
  encyclopedia = enc ? JSON.parse(enc) : {};
}

function saveStorage() {
  localStorage.setItem(LS_ENC, JSON.stringify(encyclopedia));
  localStorage.setItem(LS_HI,  String(highscore));
}

// ============================================================
// INPUT
// ============================================================
function setupInput() {
  document.addEventListener('keydown', e => {
    initAudio();
    if (e.code === 'Space') {
      e.preventDefault();
      inp.space = true;
    }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') inp.shift = true;
  });
  document.addEventListener('keyup', e => {
    if (e.code === 'Space')  inp.space = false;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') inp.shift = false;
  });

  // Mouse – attach to canvas so right-click prevent works cleanly
  document.addEventListener('mousedown', e => {
    initAudio();
    if (e.button === 0) inp.left  = true;
    if (e.button === 2) inp.right = true;
  });
  document.addEventListener('mouseup', e => {
    if (e.button === 0) inp.left  = false;
    if (e.button === 2) inp.right = false;
  });
  document.addEventListener('contextmenu', e => e.preventDefault());
}

// ============================================================
// UI EVENTS
// ============================================================
function setupUI() {
  dom.startBtn.addEventListener('click',    startGame);
  dom.retryBtn.addEventListener('click',    startGame);
  dom.toTitleBtn.addEventListener('click',  goToTitle);

  dom.muteBtn.addEventListener('click', () => {
    initAudio();
    muted = !muted;
    dom.muteBtn.textContent = muted ? '🔇' : '🔊';
    if (bgmGain) {
      bgmGain.gain.cancelScheduledValues(audioCtx.currentTime);
      bgmGain.gain.setValueAtTime(muted ? 0 : 1, audioCtx.currentTime);
    }
    playSE('UI');
  });

  dom.titleEncBtn.addEventListener('click', () => {
    initAudio();
    playSE('UI');
    toggleEnc();
  });

  dom.closeEncBtn.addEventListener('click', () => {
    dom.encModal.classList.add('hidden');
  });

  // Close modal when clicking backdrop
  dom.encModal.addEventListener('click', e => {
    if (e.target === dom.encModal) dom.encModal.classList.add('hidden');
  });
}

// ============================================================
// AUDIO (Famicom-style WebAudio)
// ============================================================
function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  startBgm();
}

function playSE(type) {
  if (!audioCtx || muted) return;
  duckBgm();
  const t = audioCtx.currentTime;
  switch (type) {
    case 'CAST':
      osc('triangle', 350, 0.12, 0.12, t);
      osc('triangle', 220, 0.08, 0.10, t + 0.06);
      break;
    case 'HIT':
      osc('square', 440, 0.09, 0.08, t);
      osc('square', 554, 0.09, 0.08, t + 0.08);
      osc('square', 659, 0.09, 0.12, t + 0.16);
      break;
    case 'REEL_TICK':
      osc('square', 900, 0.04, 0.03, t);
      break;
    case 'SUCCESS':
      osc('square', 523,  0.10, 0.09, t);
      osc('square', 659,  0.10, 0.09, t + 0.09);
      osc('square', 784,  0.10, 0.09, t + 0.18);
      osc('square', 1047, 0.12, 0.25, t + 0.27);
      break;
    case 'FAIL':
      osc('square', 440, 0.10, 0.10, t);
      osc('square', 330, 0.10, 0.10, t + 0.10);
      osc('square', 220, 0.12, 0.18, t + 0.20);
      break;
    case 'TIMEUP':
      osc('square', 880, 0.10, 0.07, t);
      osc('square', 880, 0.10, 0.07, t + 0.14);
      osc('square', 880, 0.10, 0.07, t + 0.28);
      osc('square', 220, 0.18, 0.55, t + 0.50);
      break;
    case 'UI':
      osc('square', 1100, 0.06, 0.04, t);
      break;
    case 'NIBBLE':
      osc('square', 700, 0.04, 0.05, t);
      break;
    case 'BITE':
      osc('triangle', 260, 0.14, 0.05, t);
      osc('triangle', 180, 0.16, 0.20, t + 0.04);
      break;
    case 'HOOK_SUCCESS':
      osc('square', 523, 0.10, 0.07, t);
      osc('square', 784, 0.13, 0.13, t + 0.07);
      break;
    case 'HOOK_FAIL':
      osc('sawtooth', 320, 0.08, 0.04, t);
      osc('square',   150, 0.12, 0.18, t + 0.04);
      break;
  }
}

function osc(type, freq, gain, dur, startAt) {
  const o  = audioCtx.createOscillator();
  const g  = audioCtx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, startAt);
  g.gain.setValueAtTime(gain, startAt);
  g.gain.exponentialRampToValueAtTime(0.0001, startAt + dur);
  o.connect(g);
  g.connect(audioCtx.destination);
  o.start(startAt);
  o.stop(startAt + dur + 0.01);
}

// ============================================================
// BGM (Famicom-style looping, WebAudio scheduleAhead)
// ============================================================
const BGM_BPM     = 78;
const BGM_BEAT    = 60 / BGM_BPM;   // ~0.769 s per quarter note
const BGM_STEP    = BGM_BEAT * 0.5; // ~0.385 s per 8th-note step
const BGM_STEPS   = 64;             // 8 bars × 4 beats × 2 = 64 eighth-note steps
const BGM_AHEAD   = 0.30;           // schedule-ahead window (s)
const BGM_TICK_MS = 100;            // scheduler poll interval (ms)

// Note tables: [stepIndex, durationInSteps, frequencyHz]
// 8-bar "relaxed sea" melody on triangle wave (Cメジャー)
const BGM_MEL = [
  // bar 1  (steps 0–7)
  [0, 1, 261.63], [2, 1, 329.63], [4, 1, 392.00], [6, 1, 329.63],
  // bar 2  (steps 8–15)
  [8, 1, 293.66], [10, 1, 261.63], [12, 2, 220.00],
  // bar 3  (steps 16–23)
  [16, 1, 329.63], [18, 1, 392.00], [21, 1, 440.00], [23, 1, 392.00],
  // bar 4  (steps 24–31)
  [24, 1, 329.63], [26, 1, 293.66], [28, 3, 261.63],
  // bar 5  (steps 32–39)
  [32, 1, 392.00], [34, 1, 329.63], [36, 1, 261.63], [38, 1, 329.63],
  // bar 6  (steps 40–47)
  [40, 1, 293.66], [44, 1, 329.63], [46, 1, 293.66],
  // bar 7  (steps 48–55)
  [48, 1, 261.63], [50, 1, 220.00], [52, 1, 196.00], [54, 2, 220.00],
  // bar 8  (steps 56–63)
  [56, 3, 261.63], [60, 1, 220.00], [62, 1, 196.00],
];

// Bass line on triangle wave — root pulse every half-bar (4 steps)
const BGM_BASS = [
  [ 0, 3,  65.41], [ 4, 3,  65.41],  // bar 1  C2
  [ 8, 3,  65.41], [12, 3,  65.41],  // bar 2  C2
  [16, 3,  87.31], [20, 3,  65.41],  // bar 3  F2 → C2
  [24, 3,  98.00], [28, 3,  65.41],  // bar 4  G2 → C2
  [32, 3,  98.00], [36, 3,  98.00],  // bar 5  G2
  [40, 3,  98.00], [44, 3,  65.41],  // bar 6  G2 → C2
  [48, 3,  65.41], [52, 3,  65.41],  // bar 7  C2
  [56, 3,  65.41], [60, 3,  65.41],  // bar 8  C2
];

// Accompaniment — quiet square "twinkle" on off-beats (C3/G3 alternating)
const BGM_ACC = [
  [ 1, 1, 130.81], [ 5, 1, 196.00],  // bar 1
  [ 9, 1, 130.81], [13, 1, 196.00],  // bar 2
  [17, 1, 130.81], [21, 1, 196.00],  // bar 3
  [25, 1, 130.81], [29, 1, 196.00],  // bar 4
  [33, 1, 196.00], [37, 1, 164.81],  // bar 5  G3/E3
  [41, 1, 196.00], [45, 1, 130.81],  // bar 6
  [49, 1, 130.81], [53, 1, 196.00],  // bar 7
  [57, 1, 130.81], [61, 1, 196.00],  // bar 8
];

let bgmGain    = null;  // master GainNode for entire BGM chain
let bgmStep    = 0;     // absolute step counter (never resets, enables seamless loop)
let bgmOrigin  = 0;     // audioCtx time when step 0 was scheduled
let bgmTimerId = null;  // setInterval handle

function startBgm() {
  if (bgmTimerId || !audioCtx) return;
  bgmGain = audioCtx.createGain();
  bgmGain.gain.value = muted ? 0 : 1;
  bgmGain.connect(audioCtx.destination);
  bgmStep   = 0;
  bgmOrigin = audioCtx.currentTime;
  scheduleBgm();
  bgmTimerId = setInterval(scheduleBgm, BGM_TICK_MS);
}

function scheduleBgm() {
  if (!audioCtx || !bgmGain) return;
  const until = audioCtx.currentTime + BGM_AHEAD;
  while (bgmOrigin + bgmStep * BGM_STEP < until) {
    const pat = bgmStep % BGM_STEPS;
    const t   = bgmOrigin + bgmStep * BGM_STEP;
    for (const [s, dur, freq] of BGM_MEL) {
      if (s === pat) bgmNote('triangle', freq, 0.055, dur * BGM_STEP, t);
    }
    for (const [s, dur, freq] of BGM_BASS) {
      if (s === pat) bgmNote('triangle', freq, 0.040, dur * BGM_STEP * 0.85, t);
    }
    for (const [s, dur, freq] of BGM_ACC) {
      if (s === pat) bgmNote('square', freq, 0.018, dur * BGM_STEP * 0.75, t);
    }
    bgmStep++;
  }
}

function bgmNote(type, freq, gain, dur, startAt) {
  if (!audioCtx || !bgmGain) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, startAt);
  g.gain.setValueAtTime(0, startAt);
  g.gain.linearRampToValueAtTime(gain, startAt + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, startAt + Math.max(0.03, dur * 0.92));
  o.connect(g);
  g.connect(bgmGain);
  o.start(startAt);
  o.stop(startAt + dur + 0.02);
}

function duckBgm() {
  if (!bgmGain || muted) return;
  const t = audioCtx.currentTime;
  bgmGain.gain.cancelScheduledValues(t);
  bgmGain.gain.setValueAtTime(bgmGain.gain.value, t);
  bgmGain.gain.linearRampToValueAtTime(0.25, t + 0.03);
  bgmGain.gain.linearRampToValueAtTime(1.0,  t + 0.30);
}

// ============================================================
// GAME CONTROL
// ============================================================
function startGame() {
  initAudio();
  playSE('UI');
  score        = 0;
  gameTimeMs   = GAME_DURATION_MS;
  castCooldown = 0;
  flashMsg     = '';
  flashTimer   = 0;
  currentFish  = null;
  recentCatches = [];
  bobberPhase      = 0;
  pendingPick      = null;
  castElapsedMs    = 0;
  biteWindowLeftMs = 0;
  fakeNibbleTimes  = [];
  fakeNibbleIdx    = 0;
  nibbleFlashMs    = 0;

  dom.titleScreen.classList.add('hidden');
  dom.resultScreen.classList.add('hidden');
  dom.gauges.classList.remove('hidden');
  dom.fishHpSec.classList.remove('visible');

  // Sync prev to current input so the start-button click/keypress
  // does NOT immediately trigger a cast on the first game frame.
  prev.space = inp.space;
  prev.left  = inp.left;

  gameState = 'PLAYING_IDLE';
  setHint('PLAYING_IDLE');
}

function cast() {
  if (castCooldown > 0 || items.length === 0) return;
  castCooldown = CAST_COOLDOWN_MS;

  pendingPick     = selectFish();
  castElapsedMs   = 0;
  biteAtMs        = rand(BITE_MIN_DELAY_MS, BITE_MAX_DELAY_MS);
  fakeNibbleTimes = [];
  fakeNibbleIdx   = 0;
  nibbleFlashMs   = 0;
  bobberPhase     = 0;

  // Schedule fake nibbles (only if there's enough time before the bite)
  if (Math.random() < FAKE_NIBBLE_CHANCE && biteAtMs > 700) {
    const count = Math.random() < 0.4 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      fakeNibbleTimes.push(rand(200, biteAtMs - 400));
    }
    fakeNibbleTimes.sort((a, b) => a - b);
  }

  playSE('CAST');
  gameState = 'CAST_WAIT';
  setHint('CAST_WAIT');

  // Sync prev so the cast input doesn't immediately trigger an early hook
  prev.space = inp.space;
  prev.left  = inp.left;
}

function beginFight(fish) {
  currentFish   = fish;
  tension       = 50;
  fishHpMax     = HP_MAP[fish.rarity] || 100;
  fishHp        = fishHpMax;
  fightMs       = 0;
  reelTickTimer = 0;

  gameState = 'FIGHTING';
  showFlash('HIT！  ' + fish.name);
  playSE('HIT');
  dom.fishHpSec.classList.add('visible');
  setHint('FIGHTING');

  // Sync prev so the hook input doesn't instantly start REEL
  prev.space = inp.space;
  prev.left  = inp.left;
}

function selectFish() {
  const total = items.reduce((s, i) => s + i.spawnWeight, 0);
  let r = Math.random() * total;
  for (const item of items) {
    r -= item.spawnWeight;
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}

function getFishHp(fish) {
  return HP_MAP[fish.rarity] || 100;
}

// ============================================================
// FIGHT OUTCOME
// ============================================================
function successFight() {
  const fish   = currentFish;
  score       += fish.score;

  // Random size
  let len = null, wgt = null;
  if (fish.length) len = rand(fish.length.min, fish.length.max);
  if (fish.weight) wgt = rand(fish.weight.min, fish.weight.max);

  // Record for result screen
  recentCatches.push({ fish, len, wgt });

  // Update encyclopedia
  if (!encyclopedia[fish.id]) {
    encyclopedia[fish.id] = { caughtCount: 0, maxLength: null, maxWeight: null };
  }
  const e = encyclopedia[fish.id];
  e.caughtCount++;
  if (len !== null && (e.maxLength === null || len > e.maxLength)) e.maxLength = +len.toFixed(1);
  if (wgt !== null && (e.maxWeight === null || wgt > e.maxWeight)) e.maxWeight = +wgt.toFixed(3);
  saveStorage();

  const label = fish.type === 'junk'
    ? `${fish.name}... (ハズレ)`
    : `🎉 ${fish.name}  +${fish.score.toLocaleString()}pt`;
  showFlash(label);
  playSE('SUCCESS');
  endFight();
}

function failFight(msg) {
  showFlash(msg);
  playSE('FAIL');
  endFight();
}

function endFight() {
  gameState    = 'PLAYING_IDLE';
  castCooldown = CAST_COOLDOWN_MS;
  currentFish  = null;
  tension      = 50; // reset for clean gauge display
  dom.fishHpSec.classList.remove('visible');
  setHint('PLAYING_IDLE');
}

function endGame() {
  if (score > highscore) {
    highscore = score;
    saveStorage();
  }
  gameState = 'RESULT';
  playSE('TIMEUP');
  dom.gauges.classList.add('hidden');
  dom.resultScore.textContent = `スコア：${score.toLocaleString()} pt`;
  dom.resultHi.textContent    = `ハイスコア：${highscore.toLocaleString()} pt`;
  buildResultCatches();
  dom.resultScreen.classList.remove('hidden');
}

function buildResultCatches() {
  if (recentCatches.length === 0) {
    dom.resultCatches.innerHTML = '<div class="catch-empty">釣果なし</div>';
    return;
  }
  const rarColor = { E:'#aaa', D:'#4dd0e1', C:'#ffd54f', B:'#ff9800', A:'#e040fb' };
  const rows = recentCatches.map(c => {
    const emoji    = c.fish.type === 'junk' ? '👟' : '🐟';
    const scoreStr = c.fish.score > 0 ? `+${c.fish.score.toLocaleString()}pt` : 'ハズレ';
    let sizeStr = '';
    if (c.len !== null) sizeStr += `${c.len.toFixed(1)}cm`;
    if (c.wgt !== null) sizeStr += (sizeStr ? ' / ' : '') + `${c.wgt.toFixed(3)}kg`;
    const col = rarColor[c.fish.rarity] || '#aaa';
    return `<div class="catch-row">
      <span class="catch-name" style="color:${col}">${emoji} ${c.fish.name}</span>
      <span class="catch-score">${scoreStr}</span>
      ${sizeStr ? `<span class="catch-size">${sizeStr}</span>` : ''}
    </div>`;
  }).join('');
  dom.resultCatches.innerHTML = rows;
}

function goToTitle() {
  gameState = 'TITLE';
  dom.resultScreen.classList.add('hidden');
  dom.titleScreen.classList.remove('hidden');
  dom.gauges.classList.add('hidden');
  dom.encModal.classList.add('hidden');
  updateHiDisplay();
  setHint('');
}

// ============================================================
// MAIN LOOP
// ============================================================
function loop(ts) {
  const dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.1) : 0;
  lastTs = ts;

  update(dt);
  drawScene();
  renderHUD();

  requestAnimationFrame(loop);
}

// ============================================================
// UPDATE
// ============================================================
function update(dt) {
  // Flash countdown
  if (flashTimer > 0) {
    flashTimer -= dt * 1000;
    if (flashTimer <= 0) { flashMsg = ''; }
  }
  // Cast cooldown
  if (castCooldown > 0) castCooldown -= dt * 1000;

  switch (gameState) {
    case 'PLAYING_IDLE': updateIdle(dt); break;
    case 'CAST_WAIT':    updateCastWait(dt); break;
    case 'BITE_WINDOW':  updateBiteWindow(dt); break;
    case 'FIGHTING':     updateFighting(dt); break;
  }

  // Edge detection bookkeeping
  prev.space = inp.space;
  prev.left  = inp.left;
}

function updateIdle(dt) {
  gameTimeMs -= dt * 1000;
  if (gameTimeMs <= 0) { gameTimeMs = 0; endGame(); return; }

  const castPressed = (inp.space && !prev.space) || (inp.left && !prev.left);
  if (castPressed && castCooldown <= 0) cast();
}

function updateCastWait(dt) {
  gameTimeMs    -= dt * 1000;
  if (gameTimeMs <= 0) { gameTimeMs = 0; endGame(); return; }

  castElapsedMs += dt * 1000;
  bobberPhase   += dt * 3.5;
  if (nibbleFlashMs > 0) nibbleFlashMs -= dt * 1000;

  // Fire scheduled fake nibbles
  while (fakeNibbleIdx < fakeNibbleTimes.length &&
         castElapsedMs >= fakeNibbleTimes[fakeNibbleIdx]) {
    playSE('NIBBLE');
    showFlash('コツ…（まだ食ってない）');
    nibbleFlashMs = 300;
    fakeNibbleIdx++;
  }

  // Actual bite → enter BITE_WINDOW
  if (castElapsedMs >= biteAtMs) {
    gameState        = 'BITE_WINDOW';
    biteWindowLeftMs = BITE_WINDOW_MS;
    showFlash('きた！今だ！合わせろ！');
    playSE('BITE');
    setHint('BITE_WINDOW');
    return;
  }

  // Timeout – fish didn't bite in time
  if (castElapsedMs >= CAST_WAIT_MAX_MS) {
    showFlash('食わなかった…もう一回投げろ');
    gameState       = 'PLAYING_IDLE';
    castCooldown    = CAST_COOLDOWN_MS;
    pendingPick     = null;
    fakeNibbleTimes = [];
    setHint('PLAYING_IDLE');
    return;
  }

  // Early hook – player pressed before the bite
  const hookPressed = (inp.space && !prev.space) || (inp.left && !prev.left);
  if (hookPressed && EARLY_HOOK_PENALTY) {
    playSE('HOOK_FAIL');
    showFlash('早い！まだ食ってない！');
    gameState       = 'PLAYING_IDLE';
    castCooldown    = CAST_COOLDOWN_MS;
    pendingPick     = null;
    fakeNibbleTimes = [];
    setHint('PLAYING_IDLE');
  }
}

function updateBiteWindow(dt) {
  gameTimeMs       -= dt * 1000;
  if (gameTimeMs <= 0) { gameTimeMs = 0; endGame(); return; }

  biteWindowLeftMs -= dt * 1000;
  bobberPhase      += dt * 6.0; // faster oscillation during bite

  // Hook input (rising edge only)
  const hookPressed = (inp.space && !prev.space) || (inp.left && !prev.left);
  if (hookPressed) {
    playSE('HOOK_SUCCESS');
    const fish  = pendingPick;
    pendingPick = null;
    beginFight(fish);
    return;
  }

  // Timeout – player was too slow
  if (biteWindowLeftMs <= 0) {
    playSE('HOOK_FAIL');
    showFlash('遅い！バラした…');
    gameState    = 'PLAYING_IDLE';
    castCooldown = CAST_COOLDOWN_MS;
    pendingPick  = null;
    setHint('PLAYING_IDLE');
  }
}

function updateFighting(dt) {
  gameTimeMs -= dt * 1000;
  fightMs    += dt * 1000;
  bobberPhase += dt * 3.5; // bobber oscillation speed

  if (gameTimeMs <= 0) { gameTimeMs = 0; endGame(); return; }
  if (fightMs >= FIGHT_MAX_MS) { failFight('バラし！（時間切れ）'); return; }

  // --- Player action (SLACK priority) ---
  const slacking = inp.right || inp.shift;
  const reeling  = !slacking && (inp.left || inp.space);

  // --- Fish behavior ---
  const agg  = AGG_MAP[currentFish.rarity] || 1;
  let delta  = FISH_DRIFT * agg * dt;
  delta     += (Math.random() - 0.5) * 2 * FISH_NOISE * agg * Math.sqrt(dt);
  if (Math.random() < SPIKE_RATE * agg * dt) {
    delta += (Math.random() < 0.5 ? 1 : -1) * SPIKE_STRENGTH * agg;
  }

  // --- Player forces ---
  if (reeling)  delta += REEL_FORCE  * dt;
  if (slacking) delta -= SLACK_FORCE * dt;

  tension = Math.max(0, Math.min(100, tension + delta));

  // --- Failure checks ---
  if (tension >= 100) { failFight('糸切れ！'); return; }
  if (tension <= 0)   { failFight('バラし！'); return; }

  // --- Damage fish ---
  if (reeling && tension >= SAFE_MIN && tension <= SAFE_MAX) {
    fishHp -= REEL_DAMAGE * dt;
    reelTickTimer -= dt * 1000;
    if (reelTickTimer <= 0) {
      playSE('REEL_TICK');
      reelTickTimer = REEL_TICK_MS;
    }
  }
  if (fishHp <= 0) { fishHp = 0; successFight(); }
}

// ============================================================
// DRAW SCENE (canvas)
// canvasW/H are in CSS pixels; resizeCanvas applied HiDPI scale
// ============================================================
function drawScene() {
  // canvasW/H now hold CSS pixel dimensions (set in resizeCanvas)
  const W = canvasW;
  const H = canvasH;

  // Clear
  ctx.clearRect(0, 0, W, H);

  // Sky gradient
  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.55);
  sky.addColorStop(0, '#0d1b2a');
  sky.addColorStop(1, '#1a3a5c');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H * 0.55);

  // Water gradient
  const water = ctx.createLinearGradient(0, H * 0.5, 0, H);
  water.addColorStop(0, '#0a3d62');
  water.addColorStop(1, '#051e31');
  ctx.fillStyle = water;
  ctx.fillRect(0, H * 0.5, W, H * 0.5 + 1);

  // Water surface shimmer line
  ctx.fillStyle = 'rgba(79, 195, 247, 0.12)';
  ctx.fillRect(0, H * 0.50, W, 2);

  // Wave lines
  ctx.strokeStyle = 'rgba(79, 195, 247, 0.13)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const baseY = H * (0.56 + i * 0.09);
    ctx.beginPath();
    for (let x = 0; x <= W; x += 4) {
      const wy = baseY + Math.sin(x / 30 + bobberPhase + i * 1.3) * 2;
      x === 0 ? ctx.moveTo(x, wy) : ctx.lineTo(x, wy);
    }
    ctx.stroke();
  }

  // --- Rod ---
  const rodBase = { x: W * 0.82, y: H * 0.88 };
  const rodTip  = { x: W * 0.42, y: H * 0.12 };

  ctx.lineCap = 'round';

  // Rod shadow
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.moveTo(rodBase.x + 2, rodBase.y + 2);
  ctx.lineTo(rodTip.x + 2,  rodTip.y + 2);
  ctx.stroke();

  // Rod body
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#8d6e63';
  ctx.beginPath();
  ctx.moveTo(rodBase.x, rodBase.y);
  ctx.lineTo(rodTip.x,  rodTip.y);
  ctx.stroke();

  // Rod highlight
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#bcaaa4';
  ctx.beginPath();
  ctx.moveTo(rodBase.x - 1.5, rodBase.y);
  ctx.lineTo(rodTip.x  - 1.5, rodTip.y);
  ctx.stroke();

  // --- Fishing line & bobber ---
  const lineOut = gameState === 'FIGHTING' ||
                  gameState === 'CAST_WAIT'  ||
                  gameState === 'BITE_WINDOW' ||
                  (gameState === 'PLAYING_IDLE' && castCooldown > 0);

  if (lineOut) {
    const waterY  = H * 0.52;
    const bobberX = W * 0.30;
    let wobble    = Math.sin(bobberPhase * 1.4) * 4;
    if (nibbleFlashMs > 0) wobble += Math.sin(bobberPhase * 9) * 5;
    if (gameState === 'BITE_WINDOW') wobble = 10 + Math.sin(bobberPhase * 4) * 2;
    const bobberY = waterY + 6 + wobble;

    // Line from rod tip to bobber
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(200, 230, 255, 0.7)';
    ctx.beginPath();
    ctx.moveTo(rodTip.x, rodTip.y);
    const cpX = (rodTip.x + bobberX) / 2;
    const cpY = rodTip.y + (bobberY - rodTip.y) * 0.55;
    ctx.quadraticCurveTo(cpX, cpY, bobberX, bobberY);
    ctx.stroke();

    // Bobber (red body)
    ctx.beginPath();
    ctx.arc(bobberX, bobberY + 3, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#e53935';
    ctx.fill();
    // Bobber (white top)
    ctx.beginPath();
    ctx.arc(bobberX, bobberY - 2, 5, Math.PI, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();

    // Fish info (during FIGHTING)
    if (gameState === 'FIGHTING' && currentFish) {
      const rarColor = { E:'#aaa', D:'#4dd0e1', C:'#ffd54f', B:'#ff9800', A:'#e040fb' };

      // Fish emoji below bobber
      const fishX = bobberX;
      const fishY = bobberY + 32 + Math.sin(bobberPhase * 2) * 5;
      ctx.font = '22px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(currentFish.type === 'junk' ? '👟' : '🐟', fishX, fishY);

      // Rarity label + fish name (2 lines)
      const pct = Math.min(fightMs / FIGHT_MAX_MS, 1);
      ctx.textAlign = 'center';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillStyle = rarColor[currentFish.rarity] || '#aaa';
      ctx.fillText(rarityLabel(currentFish.rarity), W * 0.30, H * 0.36);
      ctx.font = '11px sans-serif';
      ctx.fillStyle = '#ddd';
      ctx.fillText(currentFish.name, W * 0.30, H * 0.36 + 13);

      // Fight timer bar
      const barW = 80, barH = 4;
      const barX = W * 0.30 - barW / 2;
      const barY = H * 0.36 + 18;
      ctx.fillStyle = '#1a2a3a';
      ctx.fillRect(barX, barY, barW, barH);
      ctx.fillStyle = pct > 0.7 ? '#e53935' : '#4fc3f7';
      ctx.fillRect(barX, barY, barW * (1 - pct), barH);
    }

    // Bite window countdown bar
    if (gameState === 'BITE_WINDOW') {
      const pct  = Math.max(0, biteWindowLeftMs / BITE_WINDOW_MS);
      const barW = 100, barH = 5;
      const barX = bobberX - barW / 2;
      const barY = bobberY + 22;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(barX - 2, barY - 2, barW + 4, barH + 4);
      ctx.fillStyle = pct > 0.4 ? '#ff5252' : '#ff1744';
      ctx.fillRect(barX, barY, barW * pct, barH);
      ctx.font = 'bold 11px sans-serif';
      ctx.fillStyle = '#ffeb3b';
      ctx.textAlign = 'center';
      ctx.fillText('合わせろ！', bobberX, barY - 5);
    }

    // Cast-wait idle indicator
    if (gameState === 'CAST_WAIT') {
      ctx.font = '11px sans-serif';
      ctx.fillStyle = 'rgba(180, 210, 255, 0.55)';
      ctx.textAlign = 'center';
      ctx.fillText('……', bobberX, bobberY + 24);
    }
  }
}

// ============================================================
// HUD RENDER
// ============================================================
function renderHUD() {
  // Timer
  const sec = Math.max(0, gameTimeMs) / 1000;
  dom.timer.textContent = sec.toFixed(1);
  dom.timer.classList.toggle('urgent', sec <= 10 && gameState !== 'TITLE' && gameState !== 'RESULT');

  // Score
  dom.score.textContent = score.toLocaleString();
  updateHiDisplay();

  // Flash message
  dom.flash.textContent = flashMsg;
  dom.flash.style.opacity = flashTimer > 0 ? '1' : '0';

  if (gameState === 'PLAYING_IDLE' || gameState === 'FIGHTING') {
    // Tension gauge
    const t = tension;
    dom.tensionFill.style.width   = t + '%';
    dom.tensionPtr.style.left     = t + '%';
    dom.tensionVal.textContent    = Math.round(t);
    // Color
    let col;
    if (t < SAFE_MIN)       col = '#2979ff';   // too low – blue
    else if (t > SAFE_MAX)  col = '#e53935';   // too high – red
    else                     col = '#48c850';   // safe – green
    dom.tensionFill.style.background = col;
    dom.tensionVal.style.color       = col;

    // Fish HP gauge
    if (gameState === 'FIGHTING' && currentFish) {
      const pct = Math.max(0, fishHp / fishHpMax * 100);
      dom.fishHpFill.style.width  = pct + '%';
      dom.fishHpVal.textContent   = Math.round(pct) + '%';
    }
  }

  // Action indicator during FIGHTING — shows that input is being received
  if (gameState === 'FIGHTING') {
    const slacking = inp.right || inp.shift;
    const reeling  = !slacking && (inp.left || inp.space);
    const inSafe   = tension >= SAFE_MIN && tension <= SAFE_MAX;
    if (reeling && inSafe) {
      dom.hint.textContent = '▶▶ REEL中（巻き取り） — ダメージ中！';
      dom.hint.style.color = '#48c850';
    } else if (reeling) {
      dom.hint.textContent = '▶▶ REEL中（巻き取り） — 適正帯に入れて！';
      dom.hint.style.color = '#ffd54f';
    } else if (slacking) {
      dom.hint.textContent = '◀◀ SLACK中（糸を緩める） — テンション下降中';
      dom.hint.style.color = '#4dd0e1';
    } else {
      dom.hint.textContent = '[Space/左] 長押し＝REEL  ／  [Shift/右] 長押し＝SLACK';
      dom.hint.style.color = '';
    }
  } else if (gameState !== 'CAST_WAIT' && gameState !== 'BITE_WINDOW') {
    dom.hint.style.color = '';
  }
}

function updateHiDisplay() {
  dom.hi.textContent     = highscore.toLocaleString();
  dom.titleHi.textContent = highscore.toLocaleString();
}

// ============================================================
// HELPERS
// ============================================================
function showFlash(msg) {
  flashMsg   = msg;
  flashTimer = FLASH_DURATION_MS;
}

function setHint(state) {
  if (state === 'PLAYING_IDLE') {
    dom.hint.textContent = 'Space / 左クリック でキャスト';
    dom.hint.style.color = '';
  } else if (state === 'CAST_WAIT') {
    dom.hint.textContent = 'アタリを待て… ※まだ合わせるな！';
    dom.hint.style.color = '#ffd54f';
  } else if (state === 'BITE_WINDOW') {
    dom.hint.textContent = '▶ 今だ！Space / 左クリック で合わせろ！ ◀';
    dom.hint.style.color = '#ff5252';
  } else if (state === 'FIGHTING') {
    // FIGHTING hints are updated every frame by renderHUD(); just clear for now
    dom.hint.textContent = '[Space/左] 長押し＝REEL  ／  [Shift/右] 長押し＝SLACK';
    dom.hint.style.color = '';
  } else {
    dom.hint.textContent = '';
    dom.hint.style.color = '';
  }
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function rarityLabel(r) {
  switch (r) {
    case 'A': return '★★★★★（でんせつ）';
    case 'B': return '★★★★（すごレア）';
    case 'C': return '★★★（レア）';
    case 'D': return '★★（ちょいレア）';
    case 'E': return '★（ふつう）';
    default:  return r;
  }
}

// ============================================================
// ENCYCLOPEDIA
// ============================================================
function toggleEnc() {
  if (dom.encModal.classList.contains('hidden')) {
    buildEncTable();
    dom.encModal.classList.remove('hidden');
  } else {
    dom.encModal.classList.add('hidden');
  }
}

function buildEncTable() {
  const rarClass = { E:'rar-E', D:'rar-D', C:'rar-C', B:'rar-B', A:'rar-A' };
  dom.encTbody.innerHTML = '';

  items.forEach((item, idx) => {
    const e     = encyclopedia[item.id];
    const count = e ? e.caughtCount : 0;
    const maxL  = e && e.maxLength  != null ? e.maxLength.toFixed(1)  : '–';
    const maxW  = e && e.maxWeight  != null ? e.maxWeight.toFixed(3)  : '–';
    const known = count > 0;

    const tr = document.createElement('tr');
    if (!known) tr.classList.add('not-caught');

    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td>${known ? item.name : '???'}</td>
      <td class="${rarClass[item.rarity] || ''}">${rarityLabel(item.rarity)}</td>
      <td>${count}</td>
      <td>${maxL}</td>
      <td>${maxW}</td>
    `;
    dom.encTbody.appendChild(tr);
  });
}

// ============================================================
// START
// ============================================================
window.addEventListener('DOMContentLoaded', init);
