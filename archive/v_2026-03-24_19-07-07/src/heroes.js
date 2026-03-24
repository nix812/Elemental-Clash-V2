// ========== STAT SYSTEM ================================================
// DISPLAYED (hero select): hp, defense, damage, mobility  →  grade + real number on hover
// HIDDEN (item foundation): atkSpeed, abilityPower, cdr, lifesteal,
//                           critChance, armorPen, manaRegen, moveSpeed
//
// Grade scale: raw 0-100 → S(90+) A(75-89) B(55-74) C(35-54) D(<35)
// Real values are derived from raw score via STAT_SCALES below.
// Items will add flat/percent modifiers to any field in baseStats.

const STAT_SCALES = {
  // core — displayed
  hp:        { min:504,  max:1232 },   // +12% from balance pass — extends TTK toward 10s
  defense:   { min:10,   max:55   },   // damage reduction % — tightened to reduce melee dominance
  damage:    { min:40,   max:120  },   // base ability damage multiplier %
  mobility:  { min:2.8,  max:6.2  },   // movement speed units/frame

  // extended
  atkSpeed:  { min:1.2,  max:2.2  },   // auto-attacks per second — bumped up, slow heroes gain more
  abilityPower:{ min:0.7, max:1.5 },   // multiplier on all ability damage
  cdr:       { min:0,    max:35   },   // cooldown reduction %
  lifesteal: { min:0,    max:20   },   // % of ability dmg returned as HP
  critChance:{ min:0,    max:30   },   // % chance for 1.75x damage
  armorPen:  { min:0,    max:40   },   // flat armor penetration
  manaRegen: { min:1.5,  max:6.0  },   // mana per second
  moveSpeed: { min:2.8,  max:6.2  },   // alias of mobility for item targeting
};

function rawToReal(stat, raw) {
  const s = STAT_SCALES[stat];
  if (!s) return raw;
  return +(s.min + (raw / 100) * (s.max - s.min)).toFixed(1);
}

// Convert raw 0-100 to 1–5 star rating (supports half-stars as 0.5 increments)
function rawToStars(raw) {
  return Math.round((raw / 100) * 10) / 2; // 0–5 in 0.5 steps
}

// Star color based on rating
function starsColor(stars) {
  if (stars >= 4.5) return '#ffee44';
  if (stars >= 3.5) return '#44ff88';
  if (stars >= 2.5) return '#44ccff';
  if (stars >= 1.5) return '#ffaa44';
  return '#ff5544';
}


const GRADE_COLORS = { 5:'#ffee44', 4:'#44ff88', 3:'#44ccff', 2:'#ffaa44', 1:'#ff5544' };

// Each hero has a `baseStats` object with raw 0-100 scores.
// `derivedStats(hero)` converts these to real game values + applies item mods (future).
function derivedStats(hero, itemMods = {}) {
  const b = hero.baseStats;
  const out = {};
  for (const key of Object.keys(STAT_SCALES)) {
    const raw   = b[key] ?? 50;
    const real  = rawToReal(key, raw);
    const mod   = itemMods[key] ?? 0;           // future: flat item bonus
    const pctMod= itemMods[key+'Pct'] ?? 0;     // future: % item bonus
    out[key] = +(real * (1 + pctMod/100) + mod).toFixed(2);
  }
  return out;
}

// ========== HERO DATA ==========
const HEROES = [
  {
    id:'fire', combatClass:'ranged', name:'EMBER', icon:'FIRE', color:'#ff4e1a',
    role:'Assassin', desc:'Ember doesn\'t fight you. She picks her moment, presses the window, and you\'re dead before you understood what happened. If she misses that window, she\'s already gone.',
    baseStats:{
      hp:52, defense:30, damage:80, mobility:82,
      atkSpeed:76, abilityPower:82, cdr:32, lifesteal:20,
      critChance:20, armorPen:36, manaRegen:40, moveSpeed:72,
    },
    abilities:[
      { name:'Fireball', icon:'FIRE', cd:3.0, manaCost:20, damage:52, range:390, type:'projectile', projSpeed:8.5,
        cc:{type:'slow', duration:1.0},
        tags:['dmg','cc'], desc:'Fire orb that slows on hit. Your opener — land this before closing in.' },
      { name:'Flame Surge', icon:'BOOM', cd:5.2, manaCost:30, damage:62, range:155, type:'aoe',
        tags:['dmg','cc'], cc:{type:'stun',duration:0.9},
        desc:'Close-range detonation that stuns and leaves a burn patch on the ground. Get in, press the window, get out.' },
      { name:'Inferno', icon:'VOLC', cd:35, manaCost:60, damage:138, range:500, type:'projectile', projSpeed:8.5,
        tags:['dmg','cc','ult-tag'], cc:{type:'slow',duration:2.0},
        desc:'Superheated round that scorches the ground on landing. The burn zone lingers — don\'t stand in it.' },
    ],
  },
  {
    id:'water', combatClass:'hybrid', name:'TIDE', icon:'WAVE', color:'#00aaff',
    role:'Support/Tank', desc:'Fighting Tide feels like fighting the current — everything he does makes you end up somewhere you didn\'t mean to be. By the time you\'re in position to fight back, you\'re already losing.',
    baseStats:{
      hp:76, defense:52, damage:76, mobility:35,
      atkSpeed:50, abilityPower:85, cdr:48, lifesteal:30,
      critChance:5, armorPen:10, manaRegen:68, moveSpeed:62,
    },
    abilities:[
      { name:'Wave Shot', icon:'WAVE', cd:3.2, manaCost:15, damage:40, range:400, type:'projectile', projSpeed:7.0,
        tags:['dmg','cc'], cc:{type:'slow',duration:1.8},
        desc:'Slow projectile, big slow on hit. Land this and everything else gets easier.' },
      { name:'Whirlpool', icon:'SPIN', cd:6.5, manaCost:38, damage:52, range:155, type:'aoe',
        tags:['dmg','util'], cc:{type:'pull',duration:0.9},
        desc:'Drops a whirlpool that pulls enemies in and leaves a slow zone behind. Great after Wave Shot lands.' },
      { name:'Tsunami', icon:'TSUN', cd:29, manaCost:72, damage:115, range:700, type:'line',
        tags:['dmg','cc','ult-tag'], cc:{type:'knockback',duration:1.4},
        desc:'A wave that sweeps the whole arena. Hits hard and shoves everyone — aim toward walls for extra pressure.' },
    ],
  },
  {
    id:'earth', combatClass:'melee', name:'STONE', icon:'ROCK', color:'#7ec850',
    role:'Tank', desc:'Stone doesn\'t need to chase you. He plants himself, dares you to come in, and makes you pay for it. The longer a fight goes in his space, the worse it gets for you.',
    baseStats:{
      hp:78, defense:48, damage:82, mobility:12,
      atkSpeed:63, abilityPower:72, cdr:24, lifesteal:24,
      critChance:8, armorPen:34, manaRegen:38, moveSpeed:42,
    },
    abilities:[
      { name:'Rock Charge', icon:'ROCK', cd:5.0, manaCost:20, damage:54, range:255, type:'dash',
        cc:{type:'stun',duration:0.7},
        tags:['dmg','util'], desc:'Stone covers ground fast and stuns on arrival. This is how you get into a fight.' },
      { name:'Seismic Slam', icon:'SLAM', cd:7.0, manaCost:40, damage:74, range:150, type:'aoe',
        tags:['dmg','util'], cc:{type:'slow',duration:3.0},
        desc:'Cracks the ground around Stone — the zone lingers 3s and slows anyone who steps in it. Own your space.' },
      { name:'Tectonic Fury', icon:'MNTN', cd:30, manaCost:75, damage:120, range:200, type:'aoe',
        tags:['dmg','cc','ult-tag'], cc:{type:'stun',duration:1.4},
        desc:'The ground erupts outward. Massive damage, long stun, and knocks enemies to the edge of the blast.' },
    ],
  },
  {
    id:'wind', combatClass:'hybrid', name:'GALE', icon:'WIND', color:'#a8f0c0',
    role:'Skirmisher', desc:'Gale plays every fight like she\'s got somewhere better to be. She\'ll hit you, blow through your team, and be across the map before you finish turning around. Catching her is its own game.',
    baseStats:{
      hp:54, defense:44, damage:82, mobility:58,
      atkSpeed:70, abilityPower:84, cdr:43, lifesteal:8,
      critChance:20, armorPen:24, manaRegen:50, moveSpeed:98,
    },
    abilities:[
      { name:'Gust Bolt', icon:'GUST', cd:3.8, manaCost:14, damage:38, range:370, type:'projectile', projSpeed:9.5,
        cc:{type:'slow',duration:0.5},
        tags:['dmg','cc'], desc:'Fast wind blade that clips movement. Quick poke before you dash in.' },
      { name:'Tailwind Dash', icon:'WIND', cd:6.5, manaCost:30, damage:54, range:185, type:'dash',
        tags:['dmg','util','cc'], cc:{type:'stun',duration:0.9},
        desc:'Gale blows straight through targets — stuns anyone hit. Dash through slowed enemies for maximum effect.' },
      { name:'Eye of the Storm', icon:'SPIN', cd:28, manaCost:62, damage:76, range:510, type:'aoe',
        tags:['dmg','cc','ult-tag'], cc:{type:'knockback',duration:1.6},
        desc:'Throw the eye to any location — pulls enemies in then launches them outward. Gale doesn\'t need to be inside it.' },
    ],
  },
  {
    id:'shadow', combatClass:'hybrid', name:'VOID', icon:'VOID', color:'#8844cc',
    role:'Assassin', desc:'Void finds you alone and makes sure you stay that way. The silence lands, your kit goes dark, and then he finishes it. There\'s no clutch play when you can\'t press your buttons.',
    baseStats:{
      hp:64, defense:40, damage:80, mobility:74,
      atkSpeed:64, abilityPower:83, cdr:38, lifesteal:20,
      critChance:18, armorPen:40, manaRegen:58, moveSpeed:74,
    },
    abilities:[
      { name:'Shadow Bolt', icon:'VOID', cd:3.8, manaCost:18, damage:42, range:400, type:'projectile', projSpeed:8.0,
        cc:{type:'silence', duration:0.5},
        tags:['dmg','cc'], desc:'Cuts off one person\'s kit on hit. Your way of saying they don\'t get to respond.' },
      { name:'Eclipse Mute', icon:'MUTE', cd:9.0, manaCost:38, damage:68, range:140, type:'aoe',
        tags:['dmg','cc'], cc:{type:'silence',duration:1.1},
        desc:'Shadow explosion that silences everyone around you at once. Follow up immediately.' },
      { name:'Annihilate', icon:'ANNI', cd:34, manaCost:72, damage:116, range:320, type:'aoe',
        tags:['dmg','cc','ult-tag'], cc:{type:'silence',duration:2.0},
        desc:'Collapses the void across a wide area. Everything it catches is silenced and in serious trouble.' },
    ],
    autoDot:{ dps:7, duration:2.5, onExpirySilence:0.6 },
  },
  {
    id:'arcane', combatClass:'ranged', name:'MYST', icon:'MYST', color:'#ff44aa',
    role:'Mage', desc:'Myst doesn\'t react to fights — she engineers them. By the time you\'re fighting her, she\'s been setting this up for the last ten seconds. Every step you took was into her design.',
    baseStats:{
      hp:60, defense:38, damage:86, mobility:58,
      atkSpeed:52, abilityPower:84, cdr:55, lifesteal:14,
      critChance:18, armorPen:36, manaRegen:82, moveSpeed:48,
    },
    abilities:[
      { name:'Arcane Bolt', icon:'MYST', cd:2.6, manaCost:20, damage:41, range:440, type:'projectile', projSpeed:8.0,
        cc:{type:'slow',duration:0.8},
        tags:['dmg','cc'], desc:'Reliable arcane shot with good range. Slows on hit — use it to set up what comes next. Hitting a placed Sigil detonates it instantly.' },
      { name:'Sigil Bind', icon:'BIND', cd:5.5, manaCost:42, damage:22, range:340, type:'projectile', projSpeed:7.0,
        tags:['dmg','cc'], cc:{type:'root',duration:2.1},
        desc:'Places a rune trap at a location. Walk into it and you\'re rooted. Hit it with Q and it detonates with a bonus silence.' },
      { name:'Singularity', icon:'SING', cd:31, manaCost:85, damage:108, range:520, type:'aoe',
        tags:['dmg','cc','ult-tag'], cc:{type:'root',duration:2.3},
        desc:'Rips open a rift that pulls everyone nearby and roots them. Rooted targets from Sigil Bind are pulled even harder.' },
    ],
  },
  {
    id:'lightning', combatClass:'ranged', name:'VOLT', icon:'SPD', color:'#ffee00',
    role:'Assassin/Mage', desc:'Volt finds the angle nobody else sees. One spark hits, the chain starts, and suddenly half the team is stunned while you\'re already lining up the next shot. He doesn\'t win fights clean — he short-circuits them.',
    baseStats:{
      hp:56, defense:38, damage:80, mobility:60,
      atkSpeed:65, abilityPower:70, cdr:38, lifesteal:12,
      critChance:14, armorPen:36, manaRegen:50, moveSpeed:66,
    },
    abilities:[
      { name:'Spark', icon:'SPD', cd:3.0, manaCost:14, damage:38, range:420, type:'projectile', projSpeed:9.5,
        cc:{type:'slow',duration:0.7},
        tags:['dmg','cc'], desc:'The fastest shot in the game. Slows on hit — the window for Static Shock opens immediately.' },
      { name:'Static Shock', icon:'SHCK', cd:5.5, manaCost:32, damage:45, range:160, type:'aoe',
        tags:['dmg','cc'], cc:{type:'stun',duration:1.1},
        desc:'Close-range discharge. Anyone your Spark already slowed catches the full stun. Close in fast.' },
      { name:'Thunderstrike', icon:'THDR', cd:33, manaCost:68, damage:112, range:600, type:'projectile', projSpeed:9.5,
        tags:['dmg','cc','ult-tag'], cc:{type:'stun',duration:1.9},
        desc:'Long-range strike with a devastating stun. In multi-player matches, arcs to nearby enemies for 60% damage each.' },
    ],
  },
  {
    id:'ice', combatClass:'ranged', name:'FROST', icon:'ICE', color:'#88ddff',
    role:'Controller', desc:'Frost doesn\'t kill you — she freezes you in place and lets the situation handle it. You\'ll spend most of a fight against her watching your character stand perfectly still while everything goes wrong.',
    baseStats:{
      hp:74, defense:46, damage:88, mobility:56,
      atkSpeed:59, abilityPower:92, cdr:42, lifesteal:10,
      critChance:12, armorPen:22, manaRegen:62, moveSpeed:42,
    },
    abilities:[
      { name:'Ice Shard', icon:'ICE', cd:2.8, manaCost:16, damage:44, range:450, type:'projectile', projSpeed:7.0,
        tags:['dmg','cc'], cc:{type:'slow',duration:1.6},
        desc:'Long-range shard with a hard slow. Your setup piece — everything hits harder after this lands.' },
      { name:'Frost Nova', icon:'NOVA', cd:6.0, manaCost:38, damage:52, range:148, type:'aoe',
        tags:['dmg','cc'], cc:{type:'root',duration:1.5},
        desc:'Drops a Frost Well at her feet. Enemies who enter already rooted freeze solid — a distinct ice crystal effect marks the moment.' },
      { name:'Glacial Prison', icon:'PRSN', cd:30, manaCost:70, damage:98, range:440, type:'aoe',
        tags:['dmg','cc','ult-tag'], cc:{type:'root',duration:1.5},
        desc:'Buries a huge area in a blizzard. Enemies freeze in place — and when they thaw, they\'re briefly rooted again as the ice cracks.' },
    ],
  },
  {
    id:'metal', combatClass:'melee', name:'FORGE', icon:'GEAR', color:'#aabbcc',
    role:'Tank/Fighter', desc:'Forge is immovable until the moment he decides to move, and by then it\'s too late to reposition. He doesn\'t dodge your damage — he absorbs it and converts it into something worse for you.',
    baseStats:{
      hp:82, defense:50, damage:80, mobility:20,
      atkSpeed:55, abilityPower:68, cdr:36, lifesteal:18,
      critChance:10, armorPen:40, manaRegen:30, moveSpeed:36,
    },
    abilities:[
      { name:'Mag Lunge', icon:'SHOT', cd:3.0, manaCost:18, damage:50, range:310, type:'dash',
        cc:{type:'slow', duration:1.4},
        tags:['dmg','util'], desc:'Forge launches himself magnetically at the target. Covers distance fast and slows hard on landing.' },
      { name:'Magnetic Field', icon:'MAGN', cd:8.0, manaCost:44, damage:52, range:162, type:'aoe',
        tags:['dmg','util','cc'], cc:{type:'slow',duration:3.0},
        desc:'Magnetic anchor that pulls enemies and rocks toward Forge continuously for 3s. Rocks hitting enemies caught in the field deal bonus damage.' },
      { name:'Meltdown', icon:'MELT', cd:28, manaCost:80, damage:112, range:150, type:'aoe',
        tags:['dmg','cc','ult-tag'], cc:{type:'stun',duration:1.5},
        desc:'Detonates his core in a massive blast. If he\'s been pulling rocks with Magnetic Field, they launch outward as shrapnel.' },
    ],
  },
  {
    id:'nature', combatClass:'melee', name:'FLORA', icon:'LEAF', color:'#44cc88',
    role:'Support', desc:'Flora turns the arena into a garden and you into fertilizer. Roots go down, zones go up, and suddenly there\'s nowhere safe to stand. She heals off every enemy she traps, so the more she catches you, the harder she is to kill.',
    baseStats:{
      hp:82, defense:50, damage:86, mobility:42,
      atkSpeed:68, abilityPower:74, cdr:44, lifesteal:18,
      critChance:8, armorPen:14, manaRegen:72, moveSpeed:50,
    },
    abilities:[
      { name:'Thorn Shot', icon:'LEAF', cd:3.8, manaCost:15, damage:30, range:410, type:'projectile', projSpeed:7.5,
        cc:{type:'root',duration:0.8},
        tags:['dmg','cc'], desc:'Quick thorn that roots on hit and leaves a poison trail where it flew — enemies who cross it are slowed.' },
      { name:'Vine Snare', icon:'VINE', cd:7.0, manaCost:38, damage:23, range:360, type:'projectile', projSpeed:7.0,
        tags:['dmg','cc'], cc:{type:'root',duration:1.2},
        desc:'Places a vine trap at a location. When it triggers, vines chain to any nearby enemy — both rooted and tethered together.' },
      { name:'Ancient Wrath', icon:'WRTX', cd:28, manaCost:80, damage:88, range:490, type:'aoe',
        tags:['dmg','cc','heal','ult-tag'], cc:{type:'root',duration:1.8}, healAmt:40,
        desc:'The whole area becomes overgrowth. Each enemy rooted heals Flora instantly — then continues healing her over time.' },
    ],
  },
];


// ═══════════════════════════════════════════════════════════════════════════
// HERO PASSIVES
// Design principles:
//   • Conservative power budget (~8-12% of match impact at optimal play)
//   • Every passive has a visible tell (float text + optional ring)
//   • Trigger gated by a cooldown floor (min 4s) or hard event gate
//   • Additive bonuses only — never multiplicative on top of AP/crit
//   • Stack caps at 2 — prevents snowball
//   • Casual player benefits passively; skilled player builds around it
// ═══════════════════════════════════════════════════════════════════════════
const PASSIVES = {

  // EMBER — Ignition: kills/assists build Heat (max 2).
  // Next ability gets +20% flat damage per stack. Stacks consumed on cast.
  // Casual: occasionally hits harder. Skilled: save abilities until 2 stacks.
  fire: {
    name: 'Ignition',
    desc: 'Get a kill or assist and build Heat. Two stacks in and your next ability hits noticeably harder.',
    onKillOrAssist(c) {
      if ((c.passiveStacks ?? 0) < 2) {
        c.passiveStacks = (c.passiveStacks ?? 0) + 1;
        c.passiveCooldown = 0; // no cooldown — gated by kills
        showPassiveTell(c, `HEAT ${c.passiveStacks}`, '#ff6622');
      }
    },
    // Called in castAbility before damage is set — returns flat bonus dmg
    onAbilityCast(c, ab) {
      const stacks = c.passiveStacks ?? 0;
      if (stacks > 0) {
        const bonus = Math.round(ab.damage * 0.20 * stacks);
        c.passiveStacks = 0;
        showPassiveTell(c, `HEAT BURST`, '#ff4400');
        return bonus;
      }
      return 0;
    },
  },

  // TIDE — Resilience: auto-regenerating shield bubble (1 hit every 10s).
  // When shield absorbs a hit, shows a visible tell. Purely automatic.
  // Casual: feels tankier. Skilled: bait the hit before committing.
  water: {
    name: 'Resilience',
    desc: 'A shield builds up every 10 seconds and eats one incoming hit. Bait the hit, then commit.',
    passiveCdBase: 10,
    onTick(c, dt) {
      if ((c.passiveCooldown ?? 0) > 0) {
        c.passiveCooldown = Math.max(0, c.passiveCooldown - dt);
      } else if (!(c.passiveReady ?? false)) {
        c.passiveReady = true;
        showPassiveTell(c, 'SHIELD READY', '#00aaff');
      }
    },
    // Returns true if hit was absorbed
    onHit(c, gs) {
      if (c.passiveReady) {
        c.passiveReady = false;
        c.passiveCooldown = 10;
        showPassiveTell(c, 'BLOCKED!', '#44ccff');
        gs.effects.push({ x:c.x, y:c.y, r:0, maxR:c.radius+24, life:0.3, maxLife:0.3, color:'#00aaff', ring:true });
        return true; // absorb hit
      }
      return false;
    },
  },

  // STONE — Unstoppable + Aftershock
  // TWIST: SLAM leaves a cracked slow zone for 3s.
  earth: {
    name: 'Unstoppable',
    desc: 'Stone takes less damage while moving toward you. Every Slam leaves cracked ground behind — step in it and you slow down.',
    onDamageReceived(c, attacker) {
      if (!c.alive || !attacker) return 1.0;
      const vx = c.velX ?? c.vx ?? 0;
      const vy = c.velY ?? c.vy ?? 0;
      const speed = Math.sqrt(vx*vx + vy*vy);
      if (speed < 0.3) return 1.0;
      const toAtk = { x: attacker.x - c.x, y: attacker.y - c.y };
      const dot = (vx/speed)*toAtk.x + (vy/speed)*toAtk.y;
      return dot > 0 ? 0.85 : 1.0;
    },
    onSlam(c, gs) {
      if (!gs) return;
      gs.hazards.push({
        type: 'aftershock', x: c.x, y: c.y,
        radius: 130, dps: 0, pull: 0,
        slowDuration: 2.0,
        life: 3.0, maxLife: 3.0,
        teamId: c.teamId, ownerRef: c,
      });
    },
  },

  // GALE — Windrunner + Tailwind
  // TWIST: Sprinting gives next ability +30% speed and range.
  wind: {
    name: 'Windrunner',
    desc: 'Hitting someone with your dash gives you sprint back faster. Sprint first and your next ability carries further and hits harder.',
    passiveCdBase: 4,
    onDashHit(c) {
      if ((c.passiveCooldown ?? 0) <= 0) {
        const refund = (c.sprintCd ?? 0) * 0.40;
        c.sprintCd = Math.max(0, (c.sprintCd ?? 0) - refund);
        c.passiveCooldown = 4;
        showPassiveTell(c, 'WINDRUNNER', '#a8f0c0');
      }
    },
    onSprint(c) {
      c._tailwindActive = 3.0;
      showPassiveTell(c, 'TAILWIND', '#a8f0c0');
    },
    onTick(c, dt) {
      if ((c.passiveCooldown ?? 0) > 0) c.passiveCooldown = Math.max(0, c.passiveCooldown - dt);
      if ((c._tailwindActive ?? 0) > 0) c._tailwindActive = Math.max(0, c._tailwindActive - dt);
    },
    onAbilityCast(c) {
      if ((c._tailwindActive ?? 0) > 0) {
        c._tailwindActive = 0;
        showPassiveTell(c, 'TAILWIND BURST', '#a8f0c0');
        return 1.30;
      }
      return 1.0;
    },
  },

  // VOID — Shadow Strike + Phantom Step
  // TWIST: While Shadow Strike window is active, one incoming projectile is phased through.
  shadow: {
    name: 'Shadow Strike',
    desc: 'Warp, then immediately cast something — it hits harder. While that window is open, one incoming shot passes right through you.',
    onWarp(c) {
      c.passiveReady = true;
      c.passiveCooldown = 4;
      c._phantomReady = true;
    },
    onTick(c, dt) {
      if ((c.passiveCooldown ?? 0) > 0) {
        c.passiveCooldown = Math.max(0, c.passiveCooldown - dt);
        if (c.passiveCooldown <= 0) { c.passiveReady = false; c._phantomReady = false; }
      }
      if ((c._phantomTimer ?? 0) > 0) c._phantomTimer = Math.max(0, c._phantomTimer - dt);
    },
    onAbilityCast(c, ab) {
      if (c.passiveReady) {
        const bonus = Math.round(ab.damage * 0.25);
        c.passiveReady = false;
        c._phantomReady = false;
        c.passiveCooldown = 0;
        showPassiveTell(c, 'SHADOW STRIKE', '#cc66ff');
        return bonus;
      }
      return 0;
    },
    onHit(c, gs) {
      if (c._phantomReady && (c.passiveCooldown ?? 0) > 0) {
        c._phantomReady = false;
        c._phantomTimer = 0.5;
        showPassiveTell(c, 'PHANTOM STEP', '#cc66ff');
        gs.effects.push({ x:c.x, y:c.y, r:0, maxR:c.radius+20, life:0.3, maxLife:0.3, color:'#cc66ff', ring:true });
        return true;
      }
      return false;
    },
  },

  // MYST — Arcane Mastery + Arcane Echo
  // TWIST: Killing with an ability refunds 50% of its cooldown.
  arcane: {
    name: 'Arcane Mastery',
    desc: 'Hit a rooted target and your ability deals significantly more damage. Kill with an ability and half the cooldown comes back.',
    passiveCdBase: 5,
    onHitTarget(c, target, ab, gs) {
      const isRooted = (target.frozen ?? 0) > 0;
      if (isRooted && (c.passiveCooldown ?? 0) <= 0) {
        const bonus = Math.round(ab.damage * 0.35);
        c.passiveCooldown = 5;
        showPassiveTell(c, 'MASTERY', '#ff44aa');
        gs.effects.push({ x:target.x, y:target.y, r:0, maxR:40, life:0.3, maxLife:0.3, color:'#ff44aa', ring:true });
        return bonus;
      }
      return 0;
    },
    onKill(c) {
      const idx = c._lastAbIdx;
      // Guard: only fire once per cast even if multiple enemies die in the same frame (AOE)
      if (idx !== undefined && c._echoFiredForCast !== c._castId && (c.cooldowns?.[idx] ?? 0) > 0) {
        const refund = c.cooldowns[idx] * 0.50;
        c.cooldowns[idx] = Math.max(0, c.cooldowns[idx] - refund);
        c._echoFiredForCast = c._castId; // mark this cast as echoed
        showPassiveTell(c, 'ECHO', '#ff44aa');
      }
    },
    onTick(c, dt) {
      if ((c.passiveCooldown ?? 0) > 0) c.passiveCooldown = Math.max(0, c.passiveCooldown - dt);
    },
  },

  // VOLT — Overclock + Static Charge
  // TWIST: Autos build Static stacks (max 3, 4s timeout); next ability consumes for +8% each.
  lightning: {
    name: 'Overclock',
    desc: "Kills refund 45% of ult CD. Autos build Static Charge (max 3) — next ability gets +8% damage per stack.",
    onKill(c) {
      const refund = (c.cooldowns?.[2] ?? 0) * 0.45;
      if (refund > 0.5) {
        c.cooldowns[2] = Math.max(5, (c.cooldowns[2] ?? 0) - refund);
        showPassiveTell(c, 'OVERCLOCK', '#ffee00');
      }
    },
    onAutoAttack(c) {
      c._staticStacks = Math.min(3, (c._staticStacks ?? 0) + 1);
      c._staticTimer = 4.0;
    },
    onAbilityCast(c, ab) {
      const stacks = c._staticStacks ?? 0;
      if (stacks > 0) {
        const bonus = Math.round(ab.damage * 0.08 * stacks);
        c._staticStacks = 0;
        c._staticTimer = 0;
        showPassiveTell(c, `STATIC x${stacks}`, '#ffee00');
        return bonus;
      }
      return 0;
    },
    onTick(c, dt) {
      if ((c._staticTimer ?? 0) > 0) {
        c._staticTimer = Math.max(0, c._staticTimer - dt);
        if (c._staticTimer <= 0) c._staticStacks = 0;
      }
    },
  },

  // FROST — Shatter (already updated)
  ice: {
    name: 'Shatter',
    desc: 'Hitting a frozen or slowed target deals bonus damage. Slow them first and everything you throw hits harder.',
    passiveCdBase: 4,
    onHitTarget(c, target, ab, gs) {
      const isFrozen = (target.frozen ?? 0) > 0;
      const isSlowed = (target.ccedTimer ?? 0) > 0;
      if ((isFrozen || isSlowed) && (c.passiveCooldown ?? 0) <= 0) {
        const pct = isFrozen ? 0.30 : 0.20;
        const bonus = Math.round(ab.damage * pct);
        c.passiveCooldown = 4;
        showPassiveTell(c, isFrozen ? 'SHATTER' : 'SHATTER+', '#88ddff');
        gs.effects.push({ x:target.x, y:target.y, r:0, maxR:36, life:0.25, maxLife:0.25, color:'#88ddff', ring:true });
        return bonus;
      }
      return 0;
    },
    onTick(c, dt) {
      if ((c.passiveCooldown ?? 0) > 0) c.passiveCooldown = Math.max(0, c.passiveCooldown - dt);
    },
  },

  // FORGE — Iron Will + Molten Core
  // TWIST: While Iron Will is active, melee collisions deal +50% damage.
  metal: {
    name: 'Iron Will',
    desc: 'Take a big hit and you briefly absorb more of what comes next. While that\'s active, walking into enemies deals serious damage.',
    passiveCdBase: 6,
    onDamageReceived(c, dmg, gs) {
      if (dmg > c.maxHp * 0.15 && (c.passiveCooldown ?? 0) <= 0) {
        c.passiveActive = 4;
        c.passiveCooldown = 6;
        showPassiveTell(c, 'IRON WILL', '#aabbcc');
        if (gs) gs.effects.push({ x:c.x, y:c.y, r:0, maxR:c.radius+20, life:0.3, maxLife:0.3, color:'#aabbcc', ring:true });
      }
    },
    onTick(c, dt) {
      if ((c.passiveActive ?? 0) > 0) c.passiveActive = Math.max(0, c.passiveActive - dt);
      if ((c.passiveCooldown ?? 0) > 0) c.passiveCooldown = Math.max(0, c.passiveCooldown - dt);
    },
    getDmgReduction(c) { return (c.passiveActive ?? 0) > 0 ? 0.80 : 1.0; },
    getMoltenCoreMult(c) { return (c.passiveActive ?? 0) > 0 ? 1.50 : 1.0; },
  },

  // FLORA — Overgrowth: self-heals damage nearby enemies for 30% of heal amount.
  // TWIST: While any nearby enemy is rooted, Flora passively heals 6 HP/s.
  // Rewards staying in melee range of rooted targets — her natural playstyle.
  nature: {
    name: 'Overgrowth',
    desc: 'Healing herself burns nearby enemies for a portion of it. Any rooted enemy nearby also tops her up passively — the more she traps, the harder she is to kill.',
    passiveCdBase: 5,
    onHeal(c, healAmt, gs) {
      if ((c.passiveCooldown ?? 0) > 0 || healAmt < 3) return;
      const dmg = Math.round(healAmt * 0.30);
      if (dmg < 1) return;
      const allChars = [gs.player, ...gs.enemies];
      let hit = false;
      allChars.forEach(t => {
        if (t === c || !t.alive || t.teamId === c.teamId) return;
        const dx = t.x - c.x, dy = t.y - c.y;
        if (dx*dx + dy*dy < 120*120) {
          t.hp = Math.max(0, t.hp - dmg);
          spawnFloat(t.x, t.y, `${dmg}`, '#44cc88', { char: t });
          hit = true;
          if (t.hp <= 0) killChar(t, c.isPlayer, gs, c);
        }
      });
      if (hit) {
        c.passiveCooldown = 5;
        showPassiveTell(c, 'OVERGROWTH', '#44cc88');
      }
    },
    onTick(c, dt, gs) {
      if ((c.passiveCooldown ?? 0) > 0) c.passiveCooldown = Math.max(0, c.passiveCooldown - dt);
      // Root-tether: heal 6 HP/s while a rooted enemy is within 180px
      if (!gs || !c.alive || c.hp >= c.maxHp) return;
      const allChars = [gs.player, ...gs.enemies];
      const rootedNearby = allChars.some(t =>
        t !== c && t.alive && t.teamId !== c.teamId &&
        (t.frozen ?? 0) > 0 &&
        Math.hypot(t.x - c.x, t.y - c.y) < 180
      );
      if (rootedNearby) {
        const healAmt = 6 * dt;
        c.hp = Math.min(c.maxHp, c.hp + healAmt);
        if (!(c._rootTetherTell > 0)) {
          showPassiveTell(c, 'ROOT TETHER', '#44cc88');
          c._rootTetherTell = 1.5;
        }
      }
      if ((c._rootTetherTell ?? 0) > 0) c._rootTetherTell -= dt;
    },
  },
};

// Shared float text helper for passive tells
function showPassiveTell(c, text, color) {
  if (!gameState) return;
  spawnFloat(c.x, c.y, text, color, { char: c });
}

// ========== COMBAT CLASS CONFIG ==========
const COMBAT_CLASS = {
  melee:  { rangeMult: 0.55, label: 'MELEE',  color: '#ff6644' },
  hybrid: { rangeMult: 0.85, label: 'HYBRID',  color: '#ffee44' },
  ranged: { rangeMult: 1.20, label: 'RANGED', color: '#44ccff' },
};

