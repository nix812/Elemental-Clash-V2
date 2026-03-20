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
  hp:        { min:450,  max:1100 },   // 50% cut — fights end in 5–8s
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
    role:'Assassin', desc:'Ember hits hard and disappears before you can hit back. She\'s not built to brawl — she\'s built to erase you in one window and reset.',
    baseStats:{
      hp:52, defense:28, damage:80, mobility:82,
      atkSpeed:80, abilityPower:80, cdr:34, lifesteal:22,
      critChance:20, armorPen:40, manaRegen:40, moveSpeed:72,
    },
    abilities:[
      { name:'Fireball', icon:'FIRE', cd:3.0, manaCost:20, damage:55, range:390, type:'projectile', projSpeed:8.5,
        cc:{type:'slow', duration:1.0},
        tags:['dmg','cc'], desc:'Lobs a fire orb that explodes on contact and scorches the target, slowing their movement.' },
      { name:'Flame Surge', icon:'BOOM', cd:5, manaCost:30, damage:65, range:155, type:'aoe',
        tags:['dmg','cc'], cc:{type:'stun',duration:1.0},
        desc:'Detonates fire in a ring around herself, stunning anyone caught in the burst. Short range but brutal up close.' },
      { name:'Inferno', icon:'VOLC', cd:34, manaCost:60, damage:145, range:500, type:'projectile', projSpeed:8.5,
        tags:['dmg','cc','ult-tag'], cc:{type:'slow',duration:2.0},
        desc:'Fires a superheated cannon round that hits for massive damage and leaves a lasting scorch on impact.' },
    ],
  },
  {
    id:'water', combatClass:'hybrid', name:'TIDE', icon:'WAVE', color:'#00aaff',
    role:'Support/Tank', desc:'Tide is deceptively hard to kill and constantly in your business. Slows, pulls, and waves make him the teammate everyone wants and the opponent nobody enjoys.',
    baseStats:{
      hp:76, defense:52, damage:76, mobility:18,
      atkSpeed:50, abilityPower:85, cdr:48, lifesteal:30,
      critChance:5, armorPen:10, manaRegen:68, moveSpeed:62,
    },
    abilities:[
      { name:'Wave Shot', icon:'WAVE', cd:3.5, manaCost:15, damage:38, range:400, type:'projectile', projSpeed:7.0,
        tags:['dmg','cc'], cc:{type:'slow',duration:1.8},
        desc:'A slow-moving water bolt that hits hard and leaves the target significantly slowed.' },
      { name:'Whirlpool', icon:'SPIN', cd:7, manaCost:38, damage:50, range:140, type:'aoe',
        tags:['dmg','util'], cc:{type:'pull',duration:0.6},
        desc:'Spawns a vortex that deals damage and drags nearby enemies toward its centre.' },
      { name:'Tsunami', icon:'TSUN', cd:30, manaCost:72, damage:110, range:700, type:'line',
        tags:['dmg','cc','ult-tag'], cc:{type:'knockback',duration:1.4},
        desc:'Unleashes a wall of water across the arena — heavy damage and knocks enemies back hard.' },
    ],
  },
  {
    id:'earth', combatClass:'melee', name:'STONE', icon:'ROCK', color:'#7ec850',
    role:'Tank', desc:'Stone is slow, hits like a freight train, and shrugs off most of what you throw at him. Get cornered by Stone and you\'ll understand why everyone else gives him space.',
    baseStats:{
      hp:75, defense:58, damage:82, mobility:0,
      atkSpeed:62, abilityPower:72, cdr:22, lifesteal:24,
      critChance:8, armorPen:52, manaRegen:38, moveSpeed:42,
    },
    abilities:[
      { name:'Rock Charge', icon:'ROCK', cd:3.5, manaCost:20, damage:52, range:240, type:'dash',
        cc:{type:'stun',duration:1.0},
        tags:['dmg','util'], desc:'Charges at the target and slams them into the ground on impact. Stone\'s main gap-closer.' },
      { name:'Seismic Slam', icon:'SLAM', cd:7, manaCost:40, damage:72, range:145, type:'aoe',
        tags:['dmg','cc'], cc:{type:'stun',duration:1.0},
        desc:'Slams the ground and sends out a shockwave that stuns every enemy nearby.' },
      { name:'Tectonic Fury', icon:'MNTN', cd:30, manaCost:75, damage:118, range:195, type:'aoe',
        tags:['dmg','cc','ult-tag'], cc:{type:'stun',duration:1.8},
        desc:'Erupts the ground across a wide area — massive damage and a long stun on everything caught inside.' },
    ],
  },
  {
    id:'wind', combatClass:'hybrid', name:'GALE', icon:'WIND', color:'#a8f0c0',
    role:'Skirmisher', desc:'Gale is the fastest thing on the map and she knows it. Poke, dash through, vanish, repeat. She decides when the fight starts and when it ends.',
    baseStats:{
      hp:50, defense:42, damage:88, mobility:100,
      atkSpeed:70, abilityPower:88, cdr:44, lifesteal:8,
      critChance:20, armorPen:28, manaRegen:50, moveSpeed:98,
    },
    abilities:[
      { name:'Gust Bolt', icon:'GUST', cd:3.5, manaCost:14, damage:38, range:360, type:'projectile', projSpeed:9.5,
        cc:{type:'slow',duration:0.6},
        tags:['dmg','cc'], desc:'Fires a fast wind blade that nicks the target for solid poke damage and briefly slows them.' },
      { name:'Tailwind Dash', icon:'WIND', cd:5.5, manaCost:30, damage:62, range:180, type:'dash',
        tags:['dmg','util','cc'], cc:{type:'stun',duration:1.0},
        desc:'Dashes forward at speed, driving through enemies and stunning the first one hit.' },
      { name:'Eye of the Storm', icon:'SPIN', cd:26, manaCost:62, damage:85,  range:270, type:'aoe',
        tags:['dmg','cc','ult-tag'], cc:{type:'knockback',duration:1.6},
        desc:'Spins up a full cyclone that deals heavy damage and hurls every enemy caught in it outward.' },
    ],
  },
  {
    id:'shadow', combatClass:'hybrid', name:'VOID', icon:'VOID', color:'#8844cc',
    role:'Assassin', desc:'Void punishes isolation. Silences shut down your escape options right before he goes all in, and by the time your teammates hear about it, it\'s already over.',
    baseStats:{
      hp:52, defense:30, damage:78, mobility:74,
      atkSpeed:62, abilityPower:100, cdr:36, lifesteal:22,
      critChance:18, armorPen:46, manaRegen:58, moveSpeed:74,
    },
    abilities:[
      { name:'Shadow Bolt', icon:'VOID', cd:3.5, manaCost:18, damage:44, range:400, type:'projectile', projSpeed:8.0,
        cc:{type:'silence', duration:0.5},
        tags:['dmg','cc'], desc:'Fires a void bolt that silences the target on hit, briefly cutting off their abilities.' },
      { name:'Eclipse Mute', icon:'MUTE', cd:9, manaCost:38, damage:55, range:150, type:'aoe',
        tags:['dmg','cc'], cc:{type:'silence',duration:1.2},
        desc:'Releases a shadow burst that damages and silences all nearby enemies at once.' },
      { name:'Annihilate', icon:'ANNI', cd:32, manaCost:72, damage:125, range:320, type:'aoe',
        tags:['dmg','cc','ult-tag'], cc:{type:'silence',duration:2.0},
        desc:'Collapses the void in a large area — huge burst damage and a long silence on everything hit.' },
    ],
  },
  {
    id:'arcane', combatClass:'ranged', name:'MYST', icon:'MYST', color:'#ff44aa',
    role:'Mage', desc:'Myst controls the map with roots and rifts, picking fights she\'s already set up. She\'s not the most mobile element, but she rarely needs to be.',
    baseStats:{
      hp:58, defense:38, damage:90, mobility:58,
      atkSpeed:52, abilityPower:86, cdr:60, lifesteal:14,
      critChance:18, armorPen:38, manaRegen:82, moveSpeed:48,
    },
    abilities:[
      { name:'Arcane Bolt', icon:'MYST', cd:2.5, manaCost:20, damage:42, range:440, type:'projectile', projSpeed:8.0,
        cc:{type:'slow',duration:0.8},
        tags:['dmg','cc'], desc:'Fast arcane missile with reliable range — good for poking and leaves a brief slow on hit.' },
      { name:'Sigil Bind', icon:'BIND', cd:5.5, manaCost:42, damage:22, range:340, type:'projectile', projSpeed:7.0,
        tags:['dmg','cc'], cc:{type:'root',duration:2.0},
        desc:'Brands the target with a rune that roots them firmly in place.' },
      { name:'Singularity', icon:'SING', cd:30, manaCost:85, damage:110, range:520, type:'aoe',
        tags:['dmg','cc','ult-tag'], cc:{type:'root',duration:2.5},
        desc:'Tears open an arcane rift that pulls every nearby enemy to the centre before rooting them.' },
    ],
  },
  {
    id:'lightning', combatClass:'ranged', name:'VOLT', icon:'SPD', color:'#ffee00',
    role:'Assassin/Mage', desc:'Volt plays like a highlight reel waiting to happen. Insane damage, insane speed, and a habit of chaining stuns across the whole team before anyone can react.',
    baseStats:{
      hp:52, defense:36, damage:86, mobility:60,
      atkSpeed:78, abilityPower:62, cdr:42, lifesteal:12,
      critChance:14, armorPen:40, manaRegen:50, moveSpeed:66,
    },
    abilities:[
      { name:'Spark', icon:'SPD', cd:2.8, manaCost:14, damage:42, range:420, type:'projectile', projSpeed:9.5,
        cc:{type:'slow',duration:0.35},
        tags:['dmg','cc'], desc:'The fastest projectile in the game. Hits for solid damage and briefly slows the target on contact.' },
      { name:'Static Shock', icon:'SHCK', cd:5.5, manaCost:32, damage:45, range:160, type:'aoe',
        tags:['dmg','cc'], cc:{type:'stun',duration:1.2},
        desc:'Discharges static in a close-range burst — good damage and stuns every enemy nearby.' },
      { name:'Thunderstrike', icon:'THDR', cd:32, manaCost:68, damage:115, range:600, type:'projectile', projSpeed:9.5,
        tags:['dmg','cc','ult-tag'], cc:{type:'stun',duration:2.2},
        desc:'Calls down a lightning strike from range — massive damage and a long stun on the target.' },
    ],
  },
  {
    id:'ice', combatClass:'ranged', name:'FROST', icon:'ICE', color:'#88ddff',
    role:'Controller', desc:'Frost doesn\'t kill you outright — she makes sure you can\'t move while everyone else does. The most CC in the game, and she knows exactly how to use it.',
    baseStats:{
      hp:72, defense:45, damage:92, mobility:32,
      atkSpeed:52, abilityPower:88, cdr:44, lifesteal:10,
      critChance:12, armorPen:24, manaRegen:62, moveSpeed:42,
    },
    abilities:[
      { name:'Ice Shard', icon:'ICE', cd:3.0, manaCost:16, damage:32, range:400, type:'projectile', projSpeed:7.0,
        tags:['dmg','cc'], cc:{type:'slow',duration:1.4},
        desc:'Ice shard that hits for decent damage and leaves the target heavily slowed.' },
      { name:'Frost Nova', icon:'NOVA', cd:6, manaCost:38, damage:50, range:140, type:'aoe',
        tags:['dmg','cc'], cc:{type:'root',duration:1.4},
        desc:'Erupts ice from the ground around Frost, damaging and rooting every nearby enemy.' },
      { name:'Glacial Prison', icon:'PRSN', cd:28, manaCost:70, damage:100, range:440, type:'aoe',
        tags:['dmg','cc','ult-tag'], cc:{type:'root',duration:2.0},
        desc:'Collapses a blizzard across a huge area — Frost\'s longest and most punishing root by a wide margin.' },
    ],
  },
  {
    id:'metal', combatClass:'melee', name:'FORGE', icon:'GEAR', color:'#aabbcc',
    role:'Tank/Fighter', desc:'Forge looks slow until he\'s already on top of you. Ridiculous defense, a gap-closer that slams into you at full speed, and an ultimate that will absolutely ruin your day.',
    baseStats:{
      hp:82, defense:54, damage:82, mobility:3,
      atkSpeed:54, abilityPower:70, cdr:38, lifesteal:18,
      critChance:10, armorPen:42, manaRegen:30, moveSpeed:36,
    },
    abilities:[
      { name:'Mag Lunge', icon:'SHOT', cd:4.5, manaCost:18, damage:48, range:210, type:'dash',
        cc:{type:'slow', duration:1.4},
        tags:['dmg','util'], desc:'Launches magnetically into the target at speed, dealing solid damage and slowing hard on impact.' },
      { name:'Magnetic Field', icon:'MAGN', cd:8, manaCost:44, damage:42, range:155, type:'aoe',
        tags:['dmg','util','cc'], cc:{type:'slow',duration:2.5},
        desc:'Releases a magnetic pulse that damages all nearby enemies and knocks their movement speed down hard.' },
      { name:'Meltdown', icon:'MELT', cd:28, manaCost:80, damage:108, range:145, type:'aoe',
        tags:['dmg','cc','ult-tag'], cc:{type:'stun',duration:1.5},
        desc:'Detonates his molten core in a massive close-range blast — enormous damage and a stun on everyone nearby.' },
    ],
  },
  {
    id:'nature', combatClass:'melee', name:'FLORA', icon:'LEAF', color:'#44cc88',
    role:'Support', desc:'Flora heals, roots, and hits harder than any support has a right to. She\'s not there to babysit — she\'s there to lock you down while topping herself back up.',
    baseStats:{
      hp:82, defense:54, damage:90, mobility:38,
      atkSpeed:70, abilityPower:78, cdr:48, lifesteal:28,
      critChance:8, armorPen:16, manaRegen:72, moveSpeed:50,
    },
    abilities:[
      { name:'Thorn Shot', icon:'LEAF', cd:4.0, manaCost:15, damage:28, range:390, type:'projectile', projSpeed:7.5,
        cc:{type:'root',duration:0.8},
        tags:['dmg','cc'], desc:'Quick thorn dart that pokes for damage and briefly roots the target on hit.' },
      { name:'Vine Snare', icon:'VINE', cd:7, manaCost:38, damage:22, range:340, type:'projectile', projSpeed:7.0,
        tags:['dmg','cc'], cc:{type:'root',duration:2.2},
        desc:'Fires a vine that erupts from the ground at the target\'s feet, rooting them solidly in place.' },
      { name:'Ancient Wrath', icon:'WRTX', cd:26, manaCost:80, damage:95, range:480, type:'aoe',
        tags:['dmg','cc','heal','ult-tag'], cc:{type:'root',duration:3.0}, healAmt:40,
        desc:'Erupts the ground across a wide area — roots every enemy caught in it, deals heavy damage, and heals Flora for a substantial chunk of health.' },
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
    desc: 'Kills and assists build Heat. Next ability deals +20% damage per stack.',
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
    desc: 'Generates a hit-absorbing shield every 10s.',
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
    desc: 'Takes 15% reduced damage while charging. SLAM leaves a slow zone (3s).',
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
    desc: 'Dashing through an enemy refunds 40% sprint CD. After sprinting, next ability has +30% speed and range.',
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
    desc: 'First ability after warping deals +25% damage. While active, one hit is phased through.',
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
    desc: 'Abilities hitting a rooted target deal +35% bonus (5s CD). Kill with an ability to refund 50% CD.',
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
    desc: 'Abilities hitting a frozen target deal +30% bonus damage, slowed targets +20% (4s cooldown).',
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
    desc: 'Large hits grant 20% DR for 4s. While active, melee collisions deal +50% damage.',
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
    desc: 'Self-healing damages nearby enemies for 30% healed. Passively heals 6 HP/s while a rooted enemy is nearby.',
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

