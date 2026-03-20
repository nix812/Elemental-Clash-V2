// ========== STATE ==========
let selectedHero = HEROES[0];
let gameState = null;
let animFrame = null;
let gamePaused = false;
let canvas, ctx;
let joyActive = false, joyId = null, joyOrigin = {x:0,y:0}, joyDelta = {x:0,y:0};

let gameStartTime = 0;
let MATCH_DURATION = 210; // 3:30 in seconds — overridden by match settings

// Match settings — persisted between lobbies
let matchKillLimit = 5;   // default 5 kills to win
let matchDuration  = 210; // default 3:30

// ═══════════════════════════════════════════════════════════════
// WEATHER SYSTEM
// ═══════════════════════════════════════════════════════════════
const WEATHER_TYPES = {
  // Philosophy: universal effects — every zone affects ALL heroes the same way.
  // Zones are contested territory everyone wants, not elemental home turf.
  // Each zone changes the rules of the fight in a distinct way.
  //
  // Universal keys: dmgMult, rangeMult, speedMult, healRate (HP/s),
  //                 cooldownMult, shieldRate (HP/s), voidPull (special)

  HEATWAVE: {
    label: 'HEATWAVE',
    icon: '🔥',
    color: '#ff6622',
    glowColor: 'rgba(255,100,30,0.26)',
    particleColor: '#ffaa55',
    desc: 'Everyone hits harder. Fights inside are lethal.',
    universal: { dmgMult: 1.40 },
  },

  BLIZZARD: {
    label: 'BLIZZARD',
    icon: '❄️',
    color: '#88eeff',
    glowColor: 'rgba(100,220,255,0.26)',
    particleColor: '#ccf4ff',
    desc: 'Everyone slows to a crawl. A slug-fest for the bold.',
    universal: { speedMult: 0.60 },
  },

  THUNDERSTORM: {
    label: 'THUNDERSTORM',
    icon: '⚡',
    color: '#aa88ff',
    glowColor: 'rgba(140,100,255,0.28)',
    particleColor: '#ccbbff',
    desc: 'Cooldowns drain fast. Ability spam zone.',
    universal: { cooldownMult: 0.45 },
  },

  DOWNPOUR: {
    label: 'DOWNPOUR',
    icon: '🌧️',
    color: '#4499ff',
    glowColor: 'rgba(60,140,255,0.26)',
    particleColor: '#88bbff',
    desc: 'Everyone heals over time. Hard to finish kills inside.',
    universal: { healRate: 10 },  // quadratic falloff: ~10 HP/s at center, fades quickly
  },

  SANDSTORM: {
    label: 'SANDSTORM',
    icon: '🌪️',
    color: '#ddaa44',
    glowColor: 'rgba(220,170,60,0.26)',
    particleColor: '#eecc88',
    desc: 'Ability range collapses. Everything becomes a brawl.',
    universal: { rangeMult: 0.55 },
  },

  BLACKHOLE: {
    label: 'BLACK HOLE',
    icon: '🌀',
    color: '#9933cc',
    glowColor: 'rgba(120,30,200,0.30)',
    particleColor: '#cc88ff',
    desc: 'Gravity warps. Sprint to escape — walking won\'t save you.',
    universal: { voidPull: 200 },  // pull ramps sharply toward centre — edge survivable on foot, core needs sprint
  },
};

// ═══════════════════════════════════════════════════════════════
// COMBO STORM DEFINITIONS
// Two-storm merges (60%+ overlap) and the 3-storm MAELSTROM
// Each combo has: label, icon, color, glowColor, particleColor,
//                 desc, effects[]
// effects are processed in applyWeatherToChar
// ═══════════════════════════════════════════════════════════════
const COMBO_STORMS = {

  // FIRE + LIGHTNING → Plasma Storm
  HEATWAVE_THUNDERSTORM: {
    label: 'PLASMA STORM', icon: '⚡🔥', color: '#ff9900',
    glowColor: 'rgba(255,150,0,0.35)', particleColor: '#ffcc44',
    desc: 'Abilities recharge fast and hit harder — every hit you take deals damage back to your attacker.',
    effects: {
      cooldownMult: 0.35,  // abilities drain very fast
      dmgMult: 1.30,       // everything hits harder
      reflectDmgPct: 0.25, // % of damage received reflected back
    },
  },

  // FIRE + WIND → Firestorm
  HEATWAVE_SANDSTORM: {
    label: 'FIRESTORM', icon: '🌪️🔥', color: '#ff5500',
    glowColor: 'rgba(255,80,0,0.32)', particleColor: '#ff8844',
    desc: 'Deal more damage and move faster. Fight hard or get left behind.',
    effects: {
      dmgMult: 1.35,
      speedMult: 1.45,
    },
  },

  // FIRE + ICE → Flashpoint
  HEATWAVE_BLIZZARD: {
    label: 'FLASHPOINT', icon: '❄️🔥', color: '#ff44cc',
    glowColor: 'rgba(255,60,200,0.30)', particleColor: '#ff88ee',
    desc: 'The zone detonates every 4 seconds, damaging and briefly stunning everyone inside. Between blasts, everyone heals.',
    effects: {
      healRate: 12,          // heals between detonations
      detonateInterval: 4.0, // seconds between blasts
      detonateDmg: 35,
      detonateStun: 0.6,
    },
  },

  // LIGHTNING + WIND → Supercell
  THUNDERSTORM_SANDSTORM: {
    label: 'SUPERCELL', icon: '⚡🌪️', color: '#aaddff',
    glowColor: 'rgba(150,210,255,0.32)', particleColor: '#cceeff',
    desc: 'All projectiles move and travel much further. Ranged heroes become lethal from across the map.',
    effects: {
      projSpeedMult: 2.2,
      rangeMult: 1.80,
    },
  },

  // LIGHTNING + ICE → Whiteout
  THUNDERSTORM_BLIZZARD: {
    label: 'WHITEOUT', icon: '❄️⚡', color: '#88ffee',
    glowColor: 'rgba(100,255,220,0.30)', particleColor: '#bbffee',
    desc: 'Every 3 seconds everyone inside is briefly frozen. While frozen you are immune to all incoming damage.',
    effects: {
      freezeInterval: 3.0,
      freezeDuration: 1.2,
      frozenImmunity: true, // immune to damage while frozen by this zone
    },
  },

  // WIND + ICE → Arctic Gale
  SANDSTORM_BLIZZARD: {
    label: 'ARCTIC GALE', icon: '❄️🌪️', color: '#44eeff',
    glowColor: 'rgba(60,230,255,0.30)', particleColor: '#88f8ff',
    desc: 'Everyone moves and attacks at extreme speed. Slow heroes keep pace with fast ones. Pure chaos.',
    effects: {
      speedMult: 1.65,
      atkSpeedMult: 1.60,
      cooldownMult: 0.50,
    },
  },

  // WIND + EARTH (SANDSTORM + DOWNPOUR) → Dust Devil
  SANDSTORM_DOWNPOUR: {
    label: 'DUST DEVIL', icon: '🌪️💧', color: '#ddbb44',
    glowColor: 'rgba(220,180,50,0.28)', particleColor: '#eedd88',
    desc: 'All knockback is tripled and enemy HP bars are hidden. Every hit sends someone flying.',
    effects: {
      knockbackMult: 3.0,
      hideEnemyBars: true,
    },
  },

  // FIRE + EARTH (HEATWAVE + DOWNPOUR) → Magma Surge
  HEATWAVE_DOWNPOUR: {
    label: 'MAGMA SURGE', icon: '🔥💧', color: '#ff6600',
    glowColor: 'rgba(255,100,0,0.30)', particleColor: '#ff9944',
    desc: 'The zone deals 15 HP/s damage but grants 40% armour. Hit like a truck and absorb almost anything else.',
    effects: {
      damageRate: 15,   // HP/s damage from the zone itself
      defBonus: 0.40,   // flat defence multiplier bonus
    },
  },

  // ICE + EARTH (BLIZZARD + DOWNPOUR) → Permafrost
  BLIZZARD_DOWNPOUR: {
    label: 'PERMAFROST', icon: '❄️💧', color: '#88ccff',
    glowColor: 'rgba(120,180,255,0.28)', particleColor: '#aaddff',
    desc: 'Movement is slowed but all ability damage is doubled. Commit to fighting here and you hit twice as hard.',
    effects: {
      speedMult: 0.55,
      abilityPowerMult: 2.0,
    },
  },

  // LIGHTNING + EARTH (THUNDERSTORM + DOWNPOUR) → Seismic Charge
  THUNDERSTORM_DOWNPOUR: {
    label: 'SEISMIC CHARGE', icon: '⚡💧', color: '#bb88ff',
    glowColor: 'rgba(170,120,255,0.30)', particleColor: '#cc99ff',
    desc: 'Melee hits chain — damage arcs to all enemies within 200px of the target. Pack fighting is dangerous here.',
    effects: {
      chainRange: 200,
      chainDmgPct: 0.55, // % of original damage chained
    },
  },

  // BLACKHOLE combos → Singularity (VOID + anything)
  BLACKHOLE_HEATWAVE:    { _singularity: true },
  BLACKHOLE_BLIZZARD:    { _singularity: true },
  BLACKHOLE_THUNDERSTORM:{ _singularity: true },
  BLACKHOLE_DOWNPOUR:    { _singularity: true },
  BLACKHOLE_SANDSTORM:   { _singularity: true },

  // 3-storm merge → THE MAELSTROM
  MAELSTROM: {
    label: 'THE MAELSTROM', icon: '🌀', color: '#ffffff',
    glowColor: 'rgba(255,255,255,0.40)', particleColor: '#ffffff',
    desc: 'All damage doubled. Cooldowns reset on kill. All health and mana packs pulled to the centre. Yanks everyone to the centre on spawn. Lasts 8 seconds then implodes.',
    effects: {
      dmgMult: 2.0,
      killResetCooldowns: true,
      pullPacks: true,
      implodeTimer: 5.0,
      implodeDmg: 120,
    },
  },
};

// Singularity definition — shared by all BLACKHOLE + X combos
const SINGULARITY_DEF = {
  label: 'SINGULARITY', icon: '🌀⚡', color: '#cc44ff',
  glowColor: 'rgba(180,50,255,0.40)', particleColor: '#dd88ff',
  desc: 'Extreme gravitational pull drags everyone to the centre. Sprinting barely helps. Getting out requires a warp gate.',
  effects: {
    voidPull: 520,        // much stronger than normal blackhole
    pullSpeedMult: 0.30,  // barely able to move while inside
  },
};

// Resolve a combo key from two zone types (order-independent)
function getComboKey(typeA, typeB) {
  const key1 = `${typeA}_${typeB}`;
  const key2 = `${typeB}_${typeA}`;
  if (COMBO_STORMS[key1]) return key1;
  if (COMBO_STORMS[key2]) return key2;
  return null;
}

// Weather zone particle pool (visual only)
const weatherParticles = [];

function spawnWeatherZone(gs) {
  const types = Object.keys(WEATHER_TYPES);
  const type = types[Math.floor(Math.random() * types.length)];
  const b = getArenaBounds(gs);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;

  // Spawn on a random edge of the arena (outside the play area, sliding in)
  const edge = Math.floor(Math.random() * 4); // 0=top 1=right 2=bottom 3=left
  let x, y;
  if (edge === 0)      { x = b.x + Math.random() * b.w; y = b.y - 80; }
  else if (edge === 1) { x = b.x2 + 80; y = b.y + Math.random() * b.h; }
  else if (edge === 2) { x = b.x + Math.random() * b.w; y = b.y2 + 80; }
  else                 { x = b.x - 80; y = b.y + Math.random() * b.h; }

  // Initial velocity: roughly toward center with random angular offset (±50°)
  const toCx = cx - x, toCy = cy - y;
  const baseAngle = Math.atan2(toCy, toCx);
  const spread = (Math.random() - 0.5) * (Math.PI * 0.55); // ±~50°
  const speed = 14 + Math.random() * 8;
  const angle = baseAngle + spread;

  return {
    type,
    x, y,
    radius: (320 + Math.random() * 160) * 1.2,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    intensity: 0,
    fadeIn:  4,
    lifetime: 40 + Math.random() * 25,
    fadeOut: 5,
    age: 0,
    announced: false,
    // Wander state — small random nudge applied each tick
    _wanderAngle: Math.random() * Math.PI * 2,
    _wanderTimer: 0,
  };
}

function updateWeather(gs, dt) {
  if (!gs.weatherZones) gs.weatherZones = [];

  const progress = (1.0 - (gs.arena?.scale ?? 1.0)) / (1.0 - 0.40); // 0.40 = ARENA_MIN_SCALE
  // Late game: more zones allowed, faster spawning
  const maxZones      = progress < 0.66 ? 2 : 3;
  // Spawn interval scales with progress — early matches get longer gaps, late game more frequent
  // For infinite time matches progress stays low so we use a floor to avoid storms never appearing
  const baseInterval  = progress < 0.33 ? 24 : progress < 0.66 ? 16 : 10;
  const spawnInterval = Math.max(10, baseInterval);
  // Zones drift faster as match progresses
  const speedMult = 1.0 + progress * 2.2;

  gs.weatherSpawnTimer = (gs.weatherSpawnTimer ?? 20) - dt;
  if (gs.weatherSpawnTimer <= 0 && gs.weatherZones.length < maxZones) {
    gs.weatherZones.push(spawnWeatherZone(gs));
    gs.weatherSpawnTimer = spawnInterval + Math.random() * 8;
  }

  // Get current arena bounds for bounce walls
  const b = getArenaBounds(gs);

  gs.weatherZones = gs.weatherZones.filter(z => {
    z.age += dt;

    // Intensity ramp
    if (z.age < z.fadeIn) {
      z.intensity = z.age / z.fadeIn;
    } else if (z.age < z.lifetime) {
      z.intensity = 1;
    } else if (z.age < z.lifetime + z.fadeOut) {
      z.intensity = 1 - (z.age - z.lifetime) / z.fadeOut;
    } else {
      return false; // expired
    }

    // Drift with speed scaling
    z.x += z.vx * speedMult * dt;
    z.y += z.vy * speedMult * dt;

    // Wander: randomly shift direction every 2–4s for organic movement
    z._wanderTimer = (z._wanderTimer ?? 0) - dt;
    if (z._wanderTimer <= 0) {
      z._wanderAngle = (z._wanderAngle ?? 0) + (Math.random() - 0.5) * Math.PI * 0.8;
      z._wanderTimer = 2.0 + Math.random() * 2.0;
    }
    const wanderStr = 1.8;
    z.vx += Math.cos(z._wanderAngle) * wanderStr * dt;
    z.vy += Math.sin(z._wanderAngle) * wanderStr * dt;

    // Inter-storm gravity — pull toward nearest other active non-converged zone.
    // Strength scales with arena size: large arena = strong pull to encourage merges;
    // small arena = near-zero pull since proximity handles it naturally.
    if (!z.converged) {
      // Reference area is the starting arena size (full canvas); current arena shrinking reduces pull.
      const arenaArea    = b.w * b.h;
      const refArea      = (ctx.canvas.width * 0.9) * (ctx.canvas.height * 0.9); // approx full size
      const arenaSizeT   = Math.min(1, arenaArea / refArea); // 1.0 = full size, ~0 = tiny
      const stormPullStr = arenaSizeT * 5.0; // bumped from 3.5

      let nearestDist = Infinity, nearestDx = 0, nearestDy = 0;
      for (const other of gs.weatherZones) {
        if (other === z || other.converged || other.intensity < 0.5) continue;
        const dx = other.x - z.x, dy = other.y - z.y;
        const dist = Math.hypot(dx, dy) || 1;
        if (dist < nearestDist) {
          nearestDist = dist; nearestDx = dx / dist; nearestDy = dy / dist;
        }
      }
      if (nearestDist < Infinity) {
        z.vx += nearestDx * stormPullStr * dt;
        z.vy += nearestDy * stormPullStr * dt;
      }
    }

    // Gentle center pull — keeps zones from hugging walls indefinitely
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const toCx = cx - z.x, toCy = cy - z.y;
    const toCDist = Math.hypot(toCx, toCy) || 1;
    // Stronger pull the farther from center (kicks in meaningfully beyond ~30% of arena)
    const centerPullStr = Math.max(0, (toCDist / (b.w * 0.35) - 0.5)) * 2.5;
    z.vx += (toCx / toCDist) * centerPullStr * dt;
    z.vy += (toCy / toCDist) * centerPullStr * dt;

    // Speed cap so zones don't run away
    const spd = Math.hypot(z.vx, z.vy);
    const maxSpd = 22;
    if (spd > maxSpd) { z.vx = (z.vx / spd) * maxSpd; z.vy = (z.vy / spd) * maxSpd; }

    // Bounce off current arena bounds — keep zones inside the shrinking walls
    const margin = z.radius * 0.5;
    if (z.x - margin < b.x)  { z.x = b.x  + margin; z.vx =  Math.abs(z.vx); }
    if (z.x + margin > b.x2) { z.x = b.x2 - margin; z.vx = -Math.abs(z.vx); }
    if (z.y - margin < b.y)  { z.y = b.y  + margin; z.vy =  Math.abs(z.vy); }
    if (z.y + margin > b.y2) { z.y = b.y2 - margin; z.vy = -Math.abs(z.vy); }

    // Announce when hitting full intensity
    if (!z.announced && z.intensity >= 0.95) {
      z.announced = true;
      const def = z.converged ? z.comboDef : WEATHER_TYPES[z.type];
      if (def) showFloatText(z.x, z.y - z.radius - 30, def.label, def.color);
    }

    // Spawn particles — capped to keep particle count bounded
    const particleColor = z.converged
      ? (z.comboDef?.particleColor ?? '#ffffff')
      : (WEATHER_TYPES[z.type]?.particleColor ?? '#ffffff');
    if (weatherParticles.length < 80 && Math.random() < z.intensity * 2) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * z.radius;
      weatherParticles.push({
        x: z.x + Math.cos(angle) * r,
        y: z.y + Math.sin(angle) * r,
        vx: (Math.random()-0.5)*1.5 + (z.vx*0.3),
        vy: (Math.random()-0.5)*1.5 + (z.vy*0.3),
        life: 0.6 + Math.random()*0.8,
        maxLife: 0,
        color: particleColor,
        size: 1.5 + Math.random()*2.5,
      });
    }

    return true;
  });

  // ── Storm convergence check ─────────────────────────────────────────────
  // Helper: returns true if two zones overlap at the 45% threshold
  function _zonesOverlap(za, zb) {
    const dist = Math.hypot(za.x - zb.x, za.y - zb.y);
    const smaller = Math.min(za.radius, zb.radius);
    const larger  = Math.max(za.radius, zb.radius);
    return dist < (larger - smaller * 0.45);
  }


  // ── Maelstrom spawn helper ────────────────────────────────────────────────
  // Handles: 90s cooldown, match-length cap, spawn yank, 1s implode grace
  function _trySpawnMaelstrom(zonesToRemove, mx, my, mergedRadius, avgVx, avgVy) {
    const MAELSTROM_CD = 90;
    const now = gs.time;
    if (gs._lastMaelstromTime !== undefined && now - gs._lastMaelstromTime < MAELSTROM_CD) return false;
    const isUnlimited = !isFinite(MATCH_DURATION);
    if (!isUnlimited) {
      const matchMinutes = MATCH_DURATION / 60;
      const maxMaelstroms = matchMinutes <= 4 ? 2 : matchMinutes <= 8 ? 3 : 4;
      if ((gs._maelstromCount ?? 0) >= maxMaelstroms) return false;
    }
    const cd = COMBO_STORMS.MAELSTROM;
    gs.weatherZones = gs.weatherZones.filter(z => !zonesToRemove.includes(z));
    gs.weatherZones.push({
      type: 'MAELSTROM', comboKey: 'MAELSTROM', comboDef: cd,
      converged: true,
      x: mx, y: my, radius: mergedRadius,
      vx: avgVx, vy: avgVy,
      intensity: 1, fadeIn: 0,
      lifetime: (cd.effects?.implodeTimer ?? 5) + 1,
      fadeOut: 4, age: 0,
      announced: false,
      _wanderAngle: Math.random() * Math.PI * 2, _wanderTimer: 0,
      _detonateTimer: 0, _freezeTimer: 0,
      _implodeTimer: cd.effects?.implodeTimer ?? 5,
      _graceTimer: 1.0,
    });
    const allChars = gs._allChars ?? [...(gs.players ?? [gs.player]), ...gs.enemies];
    for (const c of allChars) {
      if (!c?.alive) continue;
      const dx = mx - c.x, dy = my - c.y;
      const d = Math.hypot(dx, dy) || 1;
      // Yank 75% of the way to center — no cap, everyone gets pulled hard
      const yankStr = d * 0.75;
      c.x += (dx / d) * yankStr;
      c.y += (dy / d) * yankStr;
      // 1.2s stun so the yank lands before they can react
      c.stunned = Math.max(c.stunned ?? 0, 1.2);
      c.ccedTimer = Math.max(c.ccedTimer ?? 0, 1.2);
    }
    gs.effects.push({ x: mx, y: my, r: 0, maxR: mergedRadius * 2.0, life: 0.6, maxLife: 0.6, color: '#ffffff', ring: true });
    spawnFloat(mx, my - mergedRadius * 0.7, 'MAELSTROM', cd.color, { size: 30, life: 3 });
    Audio.sfx.maelstromSpawn();
    gs._lastMaelstromTime = now;
    gs._maelstromCount = (gs._maelstromCount ?? 0) + 1;
    return true;
  }

  // Build zone lists without allocating via filter() — zones array is tiny (max 3)
  const allActiveZones = [], nonConverged = [], convergedZones = [];
  for (const z of gs.weatherZones) {
    if (z.intensity <= 0.7) continue;
    allActiveZones.push(z);
    if (!z.converged) nonConverged.push(z);
    else if (z.comboKey !== 'MAELSTROM') convergedZones.push(z);
  }

  // ── Maelstrom check — fires when:
  //   (a) any 3 non-Maelstrom zones all mutually overlap, OR
  //   (b) a converged zone (already = 2 merged storms) overlaps any other active zone
  //   Case (b) means converged + 1 regular = Maelstrom (represents 3 original storms)
  let maelstromFormed = false;

  // Case (b): converged + any other zone
  if (!maelstromFormed) {
    for (const conv of convergedZones) {
      for (const other of allActiveZones) {
        if (other === conv) continue;
        if (!_zonesOverlap(conv, other)) continue;

        const totalR = conv.radius + other.radius;
        const mx = (conv.x * conv.radius + other.x * other.radius) / totalR;
        const my = (conv.y * conv.radius + other.y * other.radius) / totalR;
        const mergedRadius = Math.min(
          Math.max(conv.radius, other.radius) * 1.5,
          (conv.radius + other.radius) * 0.6
        );
        maelstromFormed = _trySpawnMaelstrom(
          [conv, other], mx, my, mergedRadius,
          (conv.vx + other.vx) / 2, (conv.vy + other.vy) / 2
        );
        if (maelstromFormed) break;
      }
      if (maelstromFormed) break;
    }
  }

  // Case (a): 3 non-converged zones all mutually overlapping
  if (!maelstromFormed && allActiveZones.length >= 3) {
    outer3: for (let i = 0; i < allActiveZones.length; i++) {
      for (let j = i + 1; j < allActiveZones.length; j++) {
        for (let k = j + 1; k < allActiveZones.length; k++) {
          const a = allActiveZones[i], b = allActiveZones[j], c = allActiveZones[k];
          if (!_zonesOverlap(a, b) || !_zonesOverlap(a, c) || !_zonesOverlap(b, c)) continue;

          const totalR = a.radius + b.radius + c.radius;
          const mx = (a.x * a.radius + b.x * b.radius + c.x * c.radius) / totalR;
          const my = (a.y * a.radius + b.y * b.radius + c.y * c.radius) / totalR;
          const mergedRadius = Math.min(
            Math.max(a.radius, b.radius, c.radius) * 1.5,
            (a.radius + b.radius + c.radius) * 0.6
          );
          maelstromFormed = _trySpawnMaelstrom(
            [a, b, c], mx, my, mergedRadius,
            (a.vx + b.vx + c.vx) / 3, (a.vy + b.vy + c.vy) / 3
          );
          if (maelstromFormed) break outer3;
        }
      }
    }
  }

  // ── Two-zone merge (non-converged only) ──────────────────────────────────
  const _maelstromFormedThisFrame = maelstromFormed || gs.weatherZones.find(z => z.comboKey === 'MAELSTROM' && z.age < 0.1);
  if (nonConverged.length >= 2 && !_maelstromFormedThisFrame) {
    for (let i = 0; i < nonConverged.length; i++) {
      for (let j = i + 1; j < nonConverged.length; j++) {
        const a = nonConverged[i], b = nonConverged[j];
        if (!_zonesOverlap(a, b)) continue;

        // Determine combo type
        let comboKey = null, comboDef = null;

        if (a.type === b.type) {
          // Same-type merge: MEGA version — amplify all effects by 1.5x
          const base = WEATHER_TYPES[a.type];
          comboKey = `MEGA_${a.type}`;
          comboDef = {
            label: `MEGA ${base.label}`,
            icon: base.icon + base.icon,
            color: base.color,
            glowColor: base.glowColor,
            particleColor: base.particleColor,
            isMega: true,
            baseType: a.type,
            effects: base.universal ? Object.fromEntries(
              Object.entries(base.universal).map(([k, v]) => {
                if (k === 'dmgMult')      return [k, 1 + (v - 1) * 1.5];
                if (k === 'speedMult')    return [k, 1 + (v - 1) * 1.5];
                if (k === 'rangeMult')    return [k, 1 + (v - 1) * 1.5];
                if (k === 'cooldownMult') return [k, 1 - (1 - v) * 1.5];
                if (k === 'healRate')     return [k, v * 1.5];
                if (k === 'voidPull')     return [k, v * 1.5];
                return [k, v];
              })
            ) : {},
            universal: base.universal ? Object.fromEntries(
              Object.entries(base.universal).map(([k, v]) => {
                if (k === 'dmgMult')      return [k, 1 + (v - 1) * 1.5];
                if (k === 'speedMult')    return [k, 1 + (v - 1) * 1.5];
                if (k === 'rangeMult')    return [k, 1 + (v - 1) * 1.5];
                if (k === 'cooldownMult') return [k, 1 - (1 - v) * 1.5];
                if (k === 'healRate')     return [k, v * 1.5];
                if (k === 'voidPull')     return [k, v * 1.5];
                return [k, v];
              })
            ) : {},
          };
        } else {
          comboKey = getComboKey(a.type, b.type);
          if (!comboKey) continue;
          let raw = COMBO_STORMS[comboKey];
          comboDef = raw._singularity ? SINGULARITY_DEF : raw;
        }

        // Merge: create combo zone at weighted centre, remove parents
        const totalR = a.radius + b.radius;
        const mx = (a.x * a.radius + b.x * b.radius) / totalR;
        const my = (a.y * a.radius + b.y * b.radius) / totalR;
        const mergedRadius = Math.min(
          Math.max(a.radius, b.radius) * 1.35,
          (a.radius + b.radius) * 0.75
        );

        const mergedZone = {
          type: comboKey,
          comboKey,
          comboDef,
          converged: true,
          x: mx, y: my,
          radius: mergedRadius,
          vx: (a.vx + b.vx) * 0.5,
          vy: (a.vy + b.vy) * 0.5,
          intensity: 1,
          fadeIn: 0,
          lifetime: 30 + Math.random() * 12,
          fadeOut: 4,
          age: 0,
          announced: false,
          _wanderAngle: Math.random() * Math.PI * 2,
          _wanderTimer: 0,
          _detonateTimer: comboDef.effects?.detonateInterval ?? 0,
          _freezeTimer: comboDef.effects?.freezeInterval ?? 0,
          _implodeTimer: comboDef.effects?.implodeTimer ?? 0,
        };

        gs.weatherZones = gs.weatherZones.filter(z => z !== a && z !== b);
        gs.weatherZones.push(mergedZone);
        spawnFloat(mx, my - mergedRadius * 0.7, comboDef.label, comboDef.color, { size: 26, life: 2.5 });
        Audio.sfx.stormConverge();
        break;
      }
      if (gs.weatherZones.find(z => z.converged && z.age < 0.1)) break;
    }
  }

  // ── Per-tick combo zone effects ──────────────────────────────────────────
  for (const z of gs.weatherZones) {
    if (!z.converged || !z.comboDef) continue;
    const eff = z.comboDef.effects;
    if (!eff) continue;

    // Flashpoint detonation
    if (eff.detonateInterval && z._detonateTimer !== undefined) {
      z._detonateTimer -= dt;
      if (z._detonateTimer <= 0) {
        z._detonateTimer = eff.detonateInterval;
        // Damage + stun everyone inside
        const allChars = gs._allChars ?? [...(gs.players ?? [gs.player]), ...gs.enemies];
        for (const c of allChars) {
          if (!c?.alive) continue;
          const d = Math.hypot(c.x - z.x, c.y - z.y);
          if (d < z.radius * 0.85) {
            applyHit(c, { damage: eff.detonateDmg, flatBonus: 0, color: z.comboDef.color,
              teamId: -1, radius: 0, stun: eff.detonateStun, freeze: 0, slow: 0,
              silence: 0, knockback: 5,
              kbDirX: c.x - z.x, kbDirY: c.y - z.y, casterStats: null, casterRef: null }, gs);
          }
        }
        gs.effects.push({ x: z.x, y: z.y, r: 0, maxR: z.radius, life: 0.4, maxLife: 0.4,
          color: z.comboDef.color, ring: true });
      }
    }

    // Whiteout periodic freeze
    if (eff.freezeInterval && z._freezeTimer !== undefined) {
      z._freezeTimer -= dt;
      if (z._freezeTimer <= 0) {
        z._freezeTimer = eff.freezeInterval;
        const allChars = gs._allChars ?? [...(gs.players ?? [gs.player]), ...gs.enemies];
        for (const c of allChars) {
          if (!c?.alive) continue;
          const d = Math.hypot(c.x - z.x, c.y - z.y);
          if (d < z.radius * 0.85) {
            c.frozen = Math.max(c.frozen ?? 0, eff.freezeDuration);
            if (eff.frozenImmunity) c._frozenImmune = eff.freezeDuration;
          }
        }
        gs.effects.push({ x: z.x, y: z.y, r: 0, maxR: z.radius * 0.8, life: 0.3, maxLife: 0.3,
          color: '#88ffee', ring: true });
      }
    }

    // Maelstrom: pull health/mana packs to centre
    if (eff.pullPacks && gs.items?.length) {
      for (const item of gs.items) {
        const dx = z.x - item.x, dy = z.y - item.y;
        const d = Math.hypot(dx, dy) || 1;
        const pullStr = Math.min(d, 6);
        item.x += (dx / d) * pullStr;
        item.y += (dy / d) * pullStr;
      }
    }

    // Maelstrom implode countdown — respects 1s grace window on spawn
    if (z.comboKey === 'MAELSTROM') {
      // Tick down grace timer first — implode can't fire until grace expires
      if ((z._graceTimer ?? 0) > 0) {
        z._graceTimer = Math.max(0, z._graceTimer - dt);
      } else if (z.age >= z.lifetime && !z._imploded) {
        z._imploded = true;
        z.lifetime = z.age + 5; // persist 5s after implode before fading out
        // Snapshot chars — applyHit/killChar may modify alive state mid-loop
        const implodeTargets = (gs._allChars ?? [...(gs.players ?? [gs.player]), ...gs.enemies]).filter(c => {
          if (!c?.alive) return false;
          return Math.hypot(c.x - z.x, c.y - z.y) < z.radius;
        });
        for (const c of implodeTargets) {
          const kbX = c.x - z.x, kbY = c.y - z.y;
          // Depth-scaled damage: center=90% maxHp, edge=10% maxHp
          const impDepth = c._maelstromDepth ?? Math.max(0, 1 - Math.hypot(c.x - z.x, c.y - z.y) / z.radius);
          const impDmgPct = 0.10 + impDepth * impDepth * 0.80; // quadratic — lethal at center
          applyHit(c, { damage: Math.round(c.maxHp * impDmgPct), flatBonus: 0, color: '#ffffff',
            teamId: -1, radius: 0, stun: 1.5, freeze: 0, slow: 0, silence: 0,
            knockback: 30, kbDirX: kbX, kbDirY: kbY,
            casterStats: null, casterRef: null, isMaelstrom: true }, gs);
        }
        gs.effects.push({ x: z.x, y: z.y, r: 0, maxR: z.radius * 1.5, life: 0.6, maxLife: 0.6,
          color: '#ffffff', ring: true });
        spawnFloat(z.x, z.y, 'IMPLOSION!', '#ffffff', { size: 36, life: 2.0 });
        Audio.sfx.maelstromImplode();

        // ── Rock blast-out — push all obstacles outward + deal 3-5 damage ──
        if (gs.obstacles) {
          const toDestroy = [];
          for (let oi = gs.obstacles.length - 1; oi >= 0; oi--) {
            const ob = gs.obstacles[oi];
            if (ob.isFragment) continue;
            const odx = ob.x - z.x, ody = ob.y - z.y;
            const od  = Math.hypot(odx, ody) || 1;
            // Blast force — stronger for rocks close to center
            const proximity = Math.max(0, 1 - od / (z.radius * 1.3));
            const blastForce = 320 + proximity * 280;
            ob.vx = (ob.vx ?? 0) + (odx / od) * blastForce;
            ob.vy = (ob.vy ?? 0) + (ody / od) * blastForce;
            // 3–5 damage to the rock
            if (ob.hp !== null) {
              const dmg = 3 + Math.floor(proximity * 2); // 3 at edge, 5 at center
              ob.hp = Math.max(0, ob.hp - dmg);
              if (ob.hp <= 0) toDestroy.push(oi);
            }
          }
          // Destroy low-hp rocks (reverse order to keep indices valid)
          for (const oi of toDestroy) {
            const ob = gs.obstacles[oi];
            spawnObstacleFragments(ob, gs);
            maybeDropItem(ob, gs);
            Audio.sfx.rockDestroy();
            scheduleObstacleRespawn(ob.size >= 40, gs);
            gs.obstacles.splice(oi, 1);
          }
        }
      }
    }
  }

  // Update particles
  for (let i = weatherParticles.length-1; i >= 0; i--) {
    const p = weatherParticles[i];
    if (!p.maxLife) p.maxLife = p.life;
    p.x += p.vx; p.y += p.vy;
    p.life -= dt;
    if (p.life <= 0) weatherParticles.splice(i, 1);
  }
}

// Returns all weather zones influencing a world position, sorted strongest first
function getWeatherAt(x, y, gs) {
  if (!gs.weatherZones) return null;
  const hits = [];
  for (const z of gs.weatherZones) {
    const dx = x - z.x, dy = y - z.y;
    const dist2 = dx*dx + dy*dy;
    if (dist2 > z.radius * z.radius) continue;
    const dist = Math.sqrt(dist2);
    const t = dist / z.radius; // 0 = center, 1 = edge
    // Quadratic falloff: full strength in inner 40%, then drops off sharply
    // Center (t=0) → 1.0, midpoint (t=0.5) → 0.56, edge (t=1) → 0
    const falloff = Math.max(0, 1 - t * t);
    const eff = falloff * z.intensity;
    if (eff > 0.05) hits.push({ type: z.type, intensity: eff, zone: z, def: z.converged ? z.comboDef : WEATHER_TYPES[z.type] });
  }
  if (!hits.length) return null;
  hits.sort((a, b) => b.intensity - a.intensity);
  hits.primary = hits[0];
  return hits;
}

// Apply per-tick weather effects to a character
function applyWeatherToChar(c, gs, dt) {
  const zones = getWeatherAt(c.x, c.y, gs);
  const wasInWeather = !!c.inWeather;

  // Clear weather modifiers each tick
  c.weatherDmgMult      = 1;
  c.weatherRangeMult    = 1;
  c.weatherSpeedMult    = 1;
  c.weatherCooldownMult = 1;
  c.weatherHealRate     = 0;
  c.weatherShieldRate   = 0;
  c.weatherFreezeChance = 0;
  c.weatherExecuteMult  = 1;
  c.weatherBlackholePull = null;
  c._bhSpeedMult = undefined;
  c.inWeather           = null;
  c.inWeatherAll        = null;
  // Combo-specific fields
  c._weatherProjSpeedMult = 1;
  c._weatherAtkSpeedMult  = 1;
  c._weatherAbPowerMult   = 1;
  c._weatherDefBonus      = 0;
  c._weatherKbMult        = 1;
  c._weatherReflect       = 0;
  c._weatherChainRange    = 0;
  c._weatherChainDmgPct   = 0;
  c._weatherHideEnemyBars = false;
  c._maelstromActive      = false;
  c._maelstromDepth       = 0;

  if (!zones) return;
  c.inWeather    = zones[0];   // primary (strongest) for legacy code
  c.inWeatherAll = zones;      // full list for display

  // Notify player on zone entry (primary zone only)
  if (!wasInWeather && c.isPlayer && zones[0].intensity > 0.3) {
    const z0 = zones[0].zone;
    const def = z0.converged ? z0.comboDef : WEATHER_TYPES[z0.type];
    if (def) spawnFloat(c.x, c.y, `${def.label}!`, def.color, { char: c });
    if (!z0.converged) Audio.sfx.weatherEnter(z0.type);
  }

  // Stack effects from ALL overlapping zones
  for (const w of zones) {
    const { def, intensity } = w;

    // ── Combo zone effects ───────────────────────────────────────────────
    if (w.zone.converged && w.zone.comboDef && !w.zone.comboDef.isMega) {
      const eff = w.zone.comboDef.effects;
      if (!eff) continue;

      if (eff.cooldownMult)      c.weatherCooldownMult *= 1 - (1 - eff.cooldownMult) * intensity;
      if (eff.dmgMult)           c.weatherDmgMult      *= 1 + (eff.dmgMult - 1)      * intensity;
      if (eff.speedMult)         c.weatherSpeedMult    *= 1 + (eff.speedMult - 1)     * intensity;
      if (eff.healRate)          c.weatherHealRate     += eff.healRate * intensity;
      if (eff.rangeMult)         c.weatherRangeMult    *= 1 + (eff.rangeMult - 1)     * intensity;
      if (eff.projSpeedMult)     c._weatherProjSpeedMult = (c._weatherProjSpeedMult ?? 1) * (1 + (eff.projSpeedMult - 1) * intensity);
      if (eff.atkSpeedMult)      c._weatherAtkSpeedMult  = (c._weatherAtkSpeedMult ?? 1) * (1 + (eff.atkSpeedMult - 1) * intensity);
      if (eff.abilityPowerMult)  c._weatherAbPowerMult   = (c._weatherAbPowerMult ?? 1) * (1 + (eff.abilityPowerMult - 1) * intensity);
      if (eff.defBonus)          c._weatherDefBonus      = (c._weatherDefBonus ?? 0) + eff.defBonus * intensity;
      if (eff.damageRate)        c.hp = Math.max(1, c.hp - eff.damageRate * dt * intensity);
      if (eff.knockbackMult)     c._weatherKbMult        = (c._weatherKbMult ?? 1) * (1 + (eff.knockbackMult - 1) * intensity);
      if (eff.reflectDmgPct)     c._weatherReflect       = (c._weatherReflect ?? 0) + eff.reflectDmgPct * intensity;
      if (eff.chainRange)        c._weatherChainRange    = eff.chainRange;
      if (eff.chainDmgPct)       c._weatherChainDmgPct   = (c._weatherChainDmgPct ?? 0) + eff.chainDmgPct * intensity;
      if (eff.hideEnemyBars)     c._weatherHideEnemyBars = true;
      if (eff.voidPull && !c.weatherBlackholePull) {
        c.weatherBlackholePull = { x: w.zone.x, y: w.zone.y, force: eff.voidPull * intensity, radius: w.zone.radius };
        if (eff.pullSpeedMult)   c._bhSpeedMult = eff.pullSpeedMult;
      }
      // Maelstrom: kill resets cooldowns (handled in applyHit via flag on char)
      if (eff.killResetCooldowns) c._maelstromActive = true;

      // Maelstrom: depth-based slow — punishing at center, tapering at edge
      // Sprint gives ~60% relief so sprinting is the clear escape tool
      if (w.zone.comboKey === 'MAELSTROM') {
        const mDist = Math.hypot(c.x - w.zone.x, c.y - w.zone.y);
        const mDepth = Math.max(0, 1 - mDist / w.zone.radius); // 1=center, 0=edge
        const isSprinting = (c.sprintTimer ?? 0) > 0;
        // Base slow: center=0.08 speed, edge=0.85 speed (cubic — catastrophic near core)
        const baseSlow = 1.0 - mDepth * mDepth * mDepth * 0.92;
        // Sprint relief: modest — sprint helps but doesn't save you at center
        // center: 0.08 + 0.12 = 0.20 while sprinting (still a crawl)
        const sprintRelief = isSprinting ? mDepth * mDepth * 0.12 : 0;
        const maelstromSpeedMult = Math.min(1, baseSlow + sprintRelief);
        c.weatherSpeedMult *= maelstromSpeedMult;
        // Store depth for implode damage scaling
        c._maelstromDepth = mDepth;
      }
      continue;
    }

    // ── Normal zone effects ──────────────────────────────────────────────
    const u = def?.universal;
    if (!u) continue;

    if (u.dmgMult)      c.weatherDmgMult      *= 1 + (u.dmgMult - 1)      * intensity;
    if (u.rangeMult)    c.weatherRangeMult    *= 1 + (u.rangeMult - 1)    * intensity;
    if (u.speedMult)    c.weatherSpeedMult    *= 1 + (u.speedMult - 1)    * intensity;
    if (u.cooldownMult) c.weatherCooldownMult *= 1 - (1 - u.cooldownMult) * intensity;
    if (u.healRate)     c.weatherHealRate     += u.healRate * intensity;
    if (u.shieldRate)   c.weatherShieldRate   += u.shieldRate * intensity;
    // Black hole: use strongest pull zone only (stacking pulls would be unfair)
    if (u.voidPull && !c.weatherBlackholePull) {
      c.weatherBlackholePull = { x: w.zone.x, y: w.zone.y, force: u.voidPull * intensity, radius: w.zone.radius };
    }
  }

  // Heal over time
  if (c.weatherHealRate > 0)
    c.hp = Math.min(c.maxHp, c.hp + c.weatherHealRate * dt);

  // Shield over time
  if (c.weatherShieldRate > 0) {
    c.weatherShield = Math.min(c.maxHp * 0.15, (c.weatherShield || 0) + c.weatherShieldRate * dt);
    c.shielded = Math.max(c.shielded || 0, c.weatherShield > 0 ? 0.1 : 0);
  }

  // Cooldown drain (stacked)
  if (c.weatherCooldownMult < 1 && c.cooldowns) {
    const cdReduction = (1 - c.weatherCooldownMult) * dt;
    for (let i = 0; i < c.cooldowns.length; i++) {
      if (c.cooldowns[i] > 0) c.cooldowns[i] = Math.max(0, c.cooldowns[i] - cdReduction);
    }
  }

  // Black hole pull — strongest zone only
  if (c.weatherBlackholePull) {
    const vp = c.weatherBlackholePull;
    const dx = vp.x - c.x;
    const dy = vp.y - c.y;
    const dist = Math.max(1, Math.hypot(dx, dy));
    const normX = dx / dist;
    const normY = dy / dist;
    // depth: 0 at zone edge, 1 at dead centre
    const depth = Math.max(0, 1 - dist / vp.radius);

    const isSprinting = (c.sprintTimer ?? 0) > 0;

    if (isSprinting) {
      // Sprint = full pull immunity regardless of pull strength or pullSpeedMult
      c._bhSpeedMult = undefined;
    } else {
      // Pull is a direct position nudge toward centre each frame.
      // Never touches velX/velY — no bouncing, no momentum.
      // Player's own movement input competes directly against this offset.
      //
      // Pull px/frame at 60fps (force=200):
      //   depth 0.0 (edge):   0.2 — barely felt
      //   depth 0.5 (mid):    1.1 — takes effort to fight
      //   depth 0.8 (inner):  2.5 — slow heroes struggle
      //   depth 1.0 (centre): 3.8 — strong, but walk speed (3–6 px/frame) still wins
      const pullPx = (0.2 + depth * depth * 3.6) * (vp.force / 200);
      c.x += normX * pullPx;
      c.y += normY * pullPx;

      // Clamp to arena bounds after pull nudge — prevents wall-pin softlock
      // where high-force pulls (Singularity: 520) push players through boundaries
      const ab = getArenaBounds(gs);
      const margin = c.radius ?? 18;
      c.x = Math.max(ab.x + margin, Math.min(ab.x2 - margin, c.x));
      c.y = Math.max(ab.y + margin, Math.min(ab.y2 - margin, c.y));

      // Speed reduction: feels heavy at centre, never zero, sprint skips this entirely
      c._bhSpeedMult = 1.0 - depth * depth * 0.40;

      // Bot escape: trigger sprint after a difficulty-scaled reaction delay
      if (!c.isPlayer) {
        const diff = aiDifficulty || 'normal';
        if (c._bhReactTimer === undefined) {
          const base = { easy: 1.2, normal: 0.6, hard: 0.15 }[diff] ?? 0.6;
          c._bhReactTimer = base + (Math.random() - 0.5) * 0.2;
        }
        c._bhReactTimer -= dt;
        if (c._bhReactTimer <= 0) {
          const sprintCfg = SPRINT_CONFIG[c.combatClass] ?? SPRINT_CONFIG.hybrid;
          c.sprintTimer = sprintCfg.duration;
          c.sprintCd    = sprintCfg.cd;
          c.sprintMult  = sprintCfg.mult;
          c._bhReactTimer = undefined;
        }
      }
    }

    if (!c.isPlayer && isSprinting) c._bhReactTimer = undefined;

  } else {
    c._bhSpeedMult = undefined;
    if (!c.isPlayer) c._bhReactTimer = undefined;
  }
}

// Draw all active weather zones (called inside world transform in render)
function drawWeatherZones(gs) {
  if (!gs.weatherZones) return;

  // Clip all weather visuals to the arena boundary
  const ab = getArenaBounds(gs);
  ctx.save();
  ctx.beginPath();
  ctx.rect(ab.x, ab.y, ab.w, ab.h);
  ctx.clip();

  for (const z of gs.weatherZones) {
    if (z.intensity <= 0) continue;

    // ── MAELSTROM: Singularity renderer ──────────────────────────────────
    if (z.comboKey === 'MAELSTROM') {
      const t  = performance.now() / 1000;
      const R  = z.radius;
      const ix = z.intensity;
      const zx = z.x, zy = z.y;
      ctx.save();

      // ── 1. Outer dark field — cached gradient ──
      ctx.globalAlpha = ix;
      const _mgx = Math.round(zx/4), _mgy = Math.round(zy/4);
      if (!z._outerGrad || z._outerGX !== _mgx || z._outerGY !== _mgy) {
        z._outerGrad = ctx.createRadialGradient(zx, zy, R*0.25, zx, zy, R);
        z._outerGrad.addColorStop(0,   'rgba(20,0,55,0.92)');
        z._outerGrad.addColorStop(0.5, 'rgba(10,0,30,0.65)');
        z._outerGrad.addColorStop(1,   'rgba(0,0,0,0)');
        z._outerGX = _mgx; z._outerGY = _mgy;
      }
      ctx.fillStyle = z._outerGrad;
      ctx.beginPath(); ctx.arc(zx, zy, R, 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha = 1;

      // ── 2. Accretion disk — batched by color to cut draw calls 80→5 ──
      const diskCount = 48; // reduced from 80, still looks dense
      const diskGroups = [[], [], [], [], []];
      for (let i = 0; i < diskCount; i++) {
        const angle = (i / diskCount) * Math.PI * 2 + t * 0.65;
        const rVar  = R * (0.42 + 0.14 * Math.sin(i * 2.3 + t * 1.1));
        const sz    = 1.4 + 2.0 * (i % 4 === 0 ? 1 : 0.35);
        diskGroups[i % 5].push({ angle, rVar, sz });
      }
      const diskColors = [
        `rgba(255,240,180,${ix})`,         // white-hot
        `rgba(255,160,40,${0.95 * ix})`,   // deep orange
        `rgba(255,80,20,${0.8 * ix})`,     // hot red-orange
        `rgba(255,255,255,${0.6 * ix})`,   // pure white
        `rgba(120,40,200,${0.7 * ix})`,    // deep violet (not pastel)
      ];
      for (let g = 0; g < 5; g++) {
        ctx.fillStyle = diskColors[g];
        ctx.beginPath();
        for (const { angle, rVar, sz } of diskGroups[g]) {
          ctx.arc(zx + Math.cos(angle)*rVar, zy + Math.sin(angle)*rVar*0.32, sz, 0, Math.PI*2);
        }
        ctx.fill();
      }

      // ── 3. Gravitational lensing rings — no save/restore, just set props ──
      for (let ring = 0; ring < 5; ring++) {
        const r     = R * (0.48 + ring * 0.11);
        const alpha = (0.55 - ring * 0.08) * (0.5 + 0.5 * Math.sin(t * 1.4 + ring * 0.7)) * ix;
        const tilt  = t * 0.12 + ring * 0.25;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = ring < 2 ? 'rgba(140,60,255,1)' : 'rgba(80,20,180,1)';
        ctx.lineWidth   = Math.max(0.5, 2 - ring * 0.3);
        ctx.beginPath();
        ctx.ellipse(zx, zy, r, r * 0.28, tilt, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = ix; // restore for remaining draw ops

      // ── 4. Matter streams — 8 curved lines being consumed ──
      for (let s = 0; s < 8; s++) {
        const baseAngle = (s / 8) * Math.PI * 2 + t * 0.18;
        const streamLen = R * (0.55 + 0.18 * Math.sin(t * 1.8 + s));
        const sx0 = zx + Math.cos(baseAngle) * streamLen;
        const sy0 = zy + Math.sin(baseAngle) * streamLen;
        const cpx = zx + Math.cos(baseAngle + 0.55) * R * 0.38;
        const cpy = zy + Math.sin(baseAngle + 0.55) * R * 0.38;
        const sx1 = zx + Math.cos(baseAngle) * R * 0.24;
        const sy1 = zy + Math.sin(baseAngle) * R * 0.24;
        const streamAlpha = (0.45 + 0.2 * Math.sin(t * 2.5 + s)) * ix;
        ctx.globalAlpha = streamAlpha;
        ctx.strokeStyle = 'rgba(140,60,220,0.85)';
        ctx.lineWidth   = 1.5;
        ctx.beginPath();
        ctx.moveTo(sx0, sy0);
        ctx.quadraticCurveTo(cpx, cpy, sx1, sy1);
        ctx.stroke();
      }

      // ── 5. Photon ring — bright halo just outside event horizon ──
      const photonPulse = (0.65 + 0.35 * Math.sin(t * 3.8)) * ix;
      ctx.save();
      ctx.globalAlpha = photonPulse;
      ctx.strokeStyle = 'rgba(255,200,80,1)'; // hot gold photon ring
      ctx.lineWidth   = 3.5;
      ctx.beginPath(); ctx.arc(zx, zy, R * 0.23, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();

      // ── 6. Event horizon — absolute black core ──
      ctx.save();
      ctx.globalAlpha = ix;
      if (!z._coreGrad || z._coreGX !== _mgx || z._coreGY !== _mgy) {
        z._coreGrad = ctx.createRadialGradient(zx, zy, 0, zx, zy, R * 0.22);
        z._coreGrad.addColorStop(0,   'rgba(0,0,0,1)');
        z._coreGrad.addColorStop(0.7, 'rgba(0,0,5,1)');
        z._coreGrad.addColorStop(1,   'rgba(5,0,20,0.9)');
      }
      ctx.fillStyle = z._coreGrad;
      ctx.beginPath(); ctx.arc(zx, zy, R * 0.22, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      // ── 8. Announce ──
      if (!z.announced && z.intensity >= 0.95) {
        z.announced = true;
        showFloatText(zx, zy - R - 30, 'THE MAELSTROM', '#cc88ff');
      }

      ctx.restore();
      continue;
    }

    // ── Combo / Singularity zone rendering ──────────────────────────────
    if (z.converged && z.comboDef) {
      const cd = z.comboDef;
      const t = performance.now() / 1000;
      const R = z.radius, ix = z.intensity;
      const zx = z.x, zy = z.y;
      const PI2 = Math.PI * 2;
      ctx.save();

      // ── Shared: cached radial gradient fill ──
      ctx.globalAlpha = ix * 0.85;
      const _gx = Math.round(zx / 4), _gy = Math.round(zy / 4);
      if (!z._grad || z._gradX !== _gx || z._gradY !== _gy) {
        z._grad = ctx.createRadialGradient(zx, zy, 0, zx, zy, R);
        z._grad.addColorStop(0,   cd.color + 'cc');
        z._grad.addColorStop(0.4, cd.color + '66');
        z._grad.addColorStop(1,   cd.color + '00');
        z._gradX = _gx; z._gradY = _gy;
      }
      ctx.fillStyle = z._grad;
      ctx.beginPath(); ctx.arc(zx, zy, R, 0, PI2); ctx.fill();

      const ck = z.comboKey;

      // ── SINGULARITY: void gravity, slow inward spiral, oppressive ──
      if (ck === 'SINGULARITY' || cd.color === '#cc44ff') {
        // Slow inward spiral arms (4 arms, heavy)
        for (let arm = 0; arm < 4; arm++) {
          const off = (arm / 4) * PI2;
          ctx.beginPath();
          for (let s = 0; s <= 80; s++) {
            const f = s / 80;
            const a = off + f * PI2 * 3.0 + t * 0.8;
            const r = R * (0.92 - f * 0.88);
            const px = zx + Math.cos(a) * r, py = zy + Math.sin(a) * r;
            s === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
          }
          ctx.globalAlpha = (0.5 + 0.15 * Math.sin(t * 1.5 + arm)) * ix;
          ctx.strokeStyle = arm % 2 === 0 ? 'rgba(160,60,255,0.9)' : 'rgba(100,30,180,0.7)';
          ctx.lineWidth = 1.5; ctx.stroke();
        }
        ctx.globalAlpha = ix;
        // Slow distortion rings
        for (const [spd, r, lw, dash, alpha] of [
          [0.18, R*0.90, 2.0, [18,8], 0.7], [-0.12, R*0.68, 1.4, [12,10], 0.5], [0.22, R*0.46, 1.0, [7,10], 0.4]
        ]) {
          ctx.save(); ctx.translate(zx, zy); ctx.rotate(t * spd);
          ctx.strokeStyle = 'rgba(180,80,255,0.9)'; ctx.lineWidth = lw;
          ctx.globalAlpha = alpha * ix; ctx.setLineDash(dash);
          ctx.beginPath(); ctx.arc(0, 0, r, 0, PI2); ctx.stroke();
          ctx.setLineDash([]); ctx.restore();
        }
        // Orbiting particles
        ctx.globalAlpha = ix;
        for (let i = 0; i < 18; i++) {
          const a = (i * 0.618 * PI2 + t * (0.6 + i * 0.02)) % PI2;
          const orR = R * (0.85 - 0.05 * Math.sin(t * 2 + i));
          ctx.fillStyle = i % 4 === 0 ? 'rgba(200,120,255,0.9)' : 'rgba(130,60,200,0.7)';
          ctx.beginPath(); ctx.arc(zx + Math.cos(a) * orR, zy + Math.sin(a) * orR, i % 4 === 0 ? 2.5 : 1.2, 0, PI2); ctx.fill();
        }
        // Black core with faint purple ring
        if (!z._coreGrad || z._coreGX !== _gx || z._coreGY !== _gy) {
          z._coreGrad = ctx.createRadialGradient(zx, zy, 0, zx, zy, R * 0.2);
          z._coreGrad.addColorStop(0, 'rgba(0,0,0,1)'); z._coreGrad.addColorStop(1, 'rgba(40,0,80,0.6)');
          z._coreGX = _gx; z._coreGY = _gy;
        }
        ctx.globalAlpha = ix; ctx.fillStyle = z._coreGrad;
        ctx.beginPath(); ctx.arc(zx, zy, R * 0.2, 0, PI2); ctx.fill();
        ctx.globalAlpha = (0.35 + 0.2 * Math.sin(t * 2.8)) * ix;
        ctx.strokeStyle = 'rgba(160,60,255,1)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(zx, zy, R * 0.21, 0, PI2); ctx.stroke();

      // ── PLASMA STORM: fire+lightning — fast orbits + electric bolts ──
      } else if (ck === 'HEATWAVE_THUNDERSTORM') {
        ctx.fillStyle = '#ffcc44'; ctx.globalAlpha = ix;
        ctx.beginPath();
        for (let i = 0; i < 20; i++) {
          const a = (i / 20) * PI2 + t * 2.2;
          const r = R * (0.65 + 0.15 * Math.sin(i * 2.1 + t * 4));
          ctx.arc(zx + Math.cos(a) * r, zy + Math.sin(a) * r, i % 4 === 0 ? 3 : 1.5, 0, PI2);
        }
        ctx.fill();
        for (let b = 0; b < 8; b++) {
          const ba = (b / 8) * PI2 + t * 1.2;
          const len = R * (0.45 + 0.2 * Math.sin(t * 6 + b));
          ctx.globalAlpha = (0.6 + 0.4 * Math.sin(t * 8 + b)) * ix;
          ctx.strokeStyle = b % 2 === 0 ? '#ffdd44' : '#ff8800'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(zx, zy);
          for (let s = 1; s <= 4; s++) {
            const f = s / 4, j = R * 0.07 * (1 - f);
            const jx = Math.sin(t * 7.3 + b * 3.1 + s * 5.7) * j;
            const jy = Math.cos(t * 6.9 + b * 2.8 + s * 4.3) * j;
            ctx.lineTo(zx + Math.cos(ba) * len * f + jx, zy + Math.sin(ba) * len * f + jy);
          }
          ctx.stroke();
        }
        ctx.globalAlpha = ix;
        if (!z._coreGrad || z._coreGX !== _gx || z._coreGY !== _gy) {
          z._coreGrad = ctx.createRadialGradient(zx, zy, 0, zx, zy, R * 0.22);
          z._coreGrad.addColorStop(0, 'rgba(255,240,150,1)'); z._coreGrad.addColorStop(1, 'rgba(255,120,0,0)');
          z._coreGX = _gx; z._coreGY = _gy;
        }
        ctx.fillStyle = z._coreGrad; ctx.globalAlpha = (0.8 + 0.2 * Math.sin(t * 5)) * ix;
        ctx.beginPath(); ctx.arc(zx, zy, R * 0.22, 0, PI2); ctx.fill();

      // ── FIRESTORM: fire+wind — fast spiral arms + embers ──
      } else if (ck === 'HEATWAVE_SANDSTORM') {
        for (let arm = 0; arm < 3; arm++) {
          const off = (arm / 3) * PI2;
          ctx.beginPath();
          for (let s = 0; s <= 60; s++) {
            const f = s / 60, a = off + f * PI2 * 2.2 + t * 2.5;
            const r = R * (0.85 - f * 0.7);
            s === 0 ? ctx.moveTo(zx + Math.cos(a) * r, zy + Math.sin(a) * r) : ctx.lineTo(zx + Math.cos(a) * r, zy + Math.sin(a) * r);
          }
          ctx.globalAlpha = 0.8 * ix;
          ctx.strokeStyle = arm === 0 ? '#ff6600' : arm === 1 ? '#ff3300' : '#ff9944'; ctx.lineWidth = 1.8; ctx.stroke();
        }
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * PI2 + t * 3.0; const r = R * (0.78 + 0.06 * Math.sin(i + t * 5));
          ctx.fillStyle = i % 3 === 0 ? 'rgba(255,220,80,0.9)' : 'rgba(255,100,30,0.7)';
          ctx.globalAlpha = ix; ctx.beginPath();
          ctx.arc(zx + Math.cos(a) * r, zy + Math.sin(a) * r, i % 3 === 0 ? 2.5 : 1.2, 0, PI2); ctx.fill();
        }
        if (!z._coreGrad || z._coreGX !== _gx || z._coreGY !== _gy) {
          z._coreGrad = ctx.createRadialGradient(zx, zy, 0, zx, zy, R * 0.25);
          z._coreGrad.addColorStop(0, 'rgba(255,220,100,1)'); z._coreGrad.addColorStop(0.5, 'rgba(255,80,0,0.7)'); z._coreGrad.addColorStop(1, 'rgba(150,20,0,0)');
          z._coreGX = _gx; z._coreGY = _gy;
        }
        ctx.fillStyle = z._coreGrad; ctx.globalAlpha = (0.7 + 0.3 * Math.sin(t * 5)) * ix;
        ctx.beginPath(); ctx.arc(zx, zy, R * 0.25, 0, PI2); ctx.fill();

      // ── FLASHPOINT: fire+ice — magenta, detonation pulse ring ──
      } else if (ck === 'HEATWAVE_BLIZZARD') {
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * PI2 + t * 0.9; const r = R * (0.6 + 0.15 * Math.sin(i * 1.7 + t * 2));
          ctx.fillStyle = i % 2 === 0 ? 'rgba(255,120,40,0.9)' : 'rgba(140,200,255,0.9)';
          ctx.globalAlpha = ix; ctx.beginPath();
          ctx.arc(zx + Math.cos(a) * r, zy + Math.sin(a) * r, i % 2 === 0 ? 2.5 : 2, 0, PI2); ctx.fill();
        }
        const phase = (t * 0.25) % 1;
        const pulseAlpha = phase < 0.15 ? phase / 0.15 : phase < 0.5 ? 1 - (phase - 0.15) / 0.35 : 0;
        ctx.globalAlpha = pulseAlpha * 0.8 * ix; ctx.strokeStyle = '#ff88ee'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(zx, zy, R * 0.1 + R * 0.88 * Math.min(phase / 0.3, 1), 0, PI2); ctx.stroke();
        if (!z._coreGrad || z._coreGX !== _gx || z._coreGY !== _gy) {
          z._coreGrad = ctx.createRadialGradient(zx, zy, 0, zx, zy, R * 0.22);
          z._coreGrad.addColorStop(0, 'rgba(255,180,255,1)'); z._coreGrad.addColorStop(1, 'rgba(180,20,120,0)');
          z._coreGX = _gx; z._coreGY = _gy;
        }
        ctx.fillStyle = z._coreGrad; ctx.globalAlpha = (0.8 + 0.2 * Math.sin(t * 4)) * ix;
        ctx.beginPath(); ctx.arc(zx, zy, R * 0.22, 0, PI2); ctx.fill();

      // ── SUPERCELL: lightning+wind — steel blue, sharp bolts + fast rings ──
      } else if (ck === 'THUNDERSTORM_SANDSTORM') {
        for (const [spd, r, lw, dash, alpha] of [
          [1.8, R*0.9, 2, [14,6], 0.85], [-1.1, R*0.7, 1.3, [8,10], 0.6], [2.8, R*0.5, 0.9, [4,8], 0.45]
        ]) {
          ctx.save(); ctx.translate(zx, zy); ctx.rotate(t * spd);
          ctx.strokeStyle = '#aaddff'; ctx.lineWidth = lw; ctx.globalAlpha = alpha * ix;
          ctx.setLineDash(dash); ctx.beginPath(); ctx.arc(0, 0, r, 0, PI2); ctx.stroke();
          ctx.setLineDash([]); ctx.restore();
        }
        for (let b = 0; b < 5; b++) {
          const ba = (b / 5) * PI2 + t * 0.8; const len = R * 0.55;
          ctx.globalAlpha = (0.7 + 0.3 * Math.sin(t * 9 + b)) * ix;
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.8;
          ctx.beginPath(); ctx.moveTo(zx, zy);
          for (let s = 1; s <= 5; s++) {
            const f = s / 5, j = R * 0.09 * (1 - f);
            const jx = Math.sin(t * 11.3 + b * 4.1 + s * 6.7) * j;
            const jy = Math.cos(t * 9.7 + b * 3.9 + s * 5.1) * j;
            ctx.lineTo(zx + Math.cos(ba) * len * f + jx, zy + Math.sin(ba) * len * f + jy);
          }
          ctx.stroke();
        }
        ctx.globalAlpha = ix;
        if (!z._coreGrad || z._coreGX !== _gx || z._coreGY !== _gy) {
          z._coreGrad = ctx.createRadialGradient(zx, zy, 0, zx, zy, R * 0.2);
          z._coreGrad.addColorStop(0, 'rgba(220,240,255,1)'); z._coreGrad.addColorStop(1, 'rgba(80,160,255,0)');
          z._coreGX = _gx; z._coreGY = _gy;
        }
        ctx.fillStyle = z._coreGrad; ctx.globalAlpha = (0.75 + 0.25 * Math.sin(t * 3.5)) * ix;
        ctx.beginPath(); ctx.arc(zx, zy, R * 0.2, 0, PI2); ctx.fill();

      // ── WHITEOUT: lightning+ice — teal, crystalline rings + freeze flash ──
      } else if (ck === 'THUNDERSTORM_BLIZZARD') {
        for (const [spd, r, lw, dash, alpha] of [
          [0.4, R*0.92, 2.5, [20,6], 0.9], [-0.3, R*0.74, 1.8, [14,8], 0.7],
          [0.55, R*0.55, 1.2, [8,10], 0.55], [-0.8, R*0.36, 0.9, [5,8], 0.4]
        ]) {
          ctx.save(); ctx.translate(zx, zy); ctx.rotate(t * spd);
          ctx.strokeStyle = '#88ffee'; ctx.lineWidth = lw; ctx.globalAlpha = alpha * ix;
          ctx.setLineDash(dash); ctx.beginPath(); ctx.arc(0, 0, r, 0, PI2); ctx.stroke();
          ctx.setLineDash([]); ctx.restore();
        }
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * PI2 + t * 0.6; const r = R * 0.78;
          const px = zx + Math.cos(a) * r, py = zy + Math.sin(a) * r, sz = 3;
          ctx.fillStyle = 'rgba(180,255,240,0.85)'; ctx.globalAlpha = ix;
          ctx.save(); ctx.translate(px, py); ctx.rotate(t + i);
          ctx.beginPath(); ctx.moveTo(0, -sz); ctx.lineTo(sz, 0); ctx.lineTo(0, sz); ctx.lineTo(-sz, 0); ctx.closePath(); ctx.fill(); ctx.restore();
        }
        const freeze = (t * 0.33) % 1;
        const fa = freeze < 0.12 ? freeze / 0.12 : freeze < 0.3 ? 1 - (freeze - 0.12) / 0.18 : 0;
        ctx.globalAlpha = fa * 0.5 * ix; ctx.fillStyle = 'rgba(200,255,250,1)';
        ctx.beginPath(); ctx.arc(zx, zy, R, 0, PI2); ctx.fill();
        if (!z._coreGrad || z._coreGX !== _gx || z._coreGY !== _gy) {
          z._coreGrad = ctx.createRadialGradient(zx, zy, 0, zx, zy, R * 0.2);
          z._coreGrad.addColorStop(0, 'rgba(220,255,245,1)'); z._coreGrad.addColorStop(1, 'rgba(60,200,180,0)');
          z._coreGX = _gx; z._coreGY = _gy;
        }
        ctx.fillStyle = z._coreGrad; ctx.globalAlpha = ix;
        ctx.beginPath(); ctx.arc(zx, zy, R * 0.2, 0, PI2); ctx.fill();

      // ── ARCTIC GALE: wind+ice — cyan, very fast spiral + chaotic sparks ──
      } else if (ck === 'SANDSTORM_BLIZZARD') {
        for (let arm = 0; arm < 4; arm++) {
          const off = (arm / 4) * PI2;
          ctx.beginPath();
          for (let s = 0; s <= 50; s++) {
            const f = s / 50, a = off + f * PI2 * 2.0 + t * 3.5;
            const r = R * (0.88 - f * 0.78);
            s === 0 ? ctx.moveTo(zx + Math.cos(a) * r, zy + Math.sin(a) * r) : ctx.lineTo(zx + Math.cos(a) * r, zy + Math.sin(a) * r);
          }
          ctx.globalAlpha = 0.75 * ix;
          ctx.strokeStyle = arm % 2 === 0 ? '#44eeff' : '#88ffff'; ctx.lineWidth = 1.2; ctx.stroke();
        }
        for (let i = 0; i < 20; i++) {
          const a = (i / 20) * PI2 + t * 4.5 + i * 0.3; const r = R * (0.3 + 0.55 * ((i * 0.17) % 1));
          ctx.fillStyle = i % 3 === 0 ? 'rgba(200,255,255,0.95)' : 'rgba(80,220,255,0.65)';
          ctx.globalAlpha = ix; ctx.beginPath();
          ctx.arc(zx + Math.cos(a) * r, zy + Math.sin(a) * r, i % 4 === 0 ? 2 : 1, 0, PI2); ctx.fill();
        }
        if (!z._coreGrad || z._coreGX !== _gx || z._coreGY !== _gy) {
          z._coreGrad = ctx.createRadialGradient(zx, zy, 0, zx, zy, R * 0.18);
          z._coreGrad.addColorStop(0, 'rgba(200,255,255,1)'); z._coreGrad.addColorStop(1, 'rgba(20,160,200,0)');
          z._coreGX = _gx; z._coreGY = _gy;
        }
        ctx.fillStyle = z._coreGrad; ctx.globalAlpha = (0.8 + 0.2 * Math.sin(t * 6)) * ix;
        ctx.beginPath(); ctx.arc(zx, zy, R * 0.18, 0, PI2); ctx.fill();

      // ── DUST DEVIL: wind+earth — sandy gold, chunky spiral debris ──
      } else if (ck === 'SANDSTORM_DOWNPOUR') {
        for (let arm = 0; arm < 2; arm++) {
          const off = (arm / 2) * PI2;
          ctx.beginPath();
          for (let s = 0; s <= 40; s++) {
            const f = s / 40, a = off + f * PI2 * 1.8 + t * 1.8;
            const r = R * (0.85 - f * 0.72);
            s === 0 ? ctx.moveTo(zx + Math.cos(a) * r, zy + Math.sin(a) * r) : ctx.lineTo(zx + Math.cos(a) * r, zy + Math.sin(a) * r);
          }
          ctx.globalAlpha = 0.7 * ix;
          ctx.strokeStyle = arm === 0 ? '#ddbb44' : '#aa8822'; ctx.lineWidth = 2.5; ctx.stroke();
        }
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * PI2 + t * 2.1; const r = R * (0.5 + 0.3 * Math.sin(i * 1.3 + t * 2));
          ctx.fillStyle = i % 3 === 0 ? 'rgba(220,180,60,0.9)' : 'rgba(160,120,40,0.7)';
          ctx.globalAlpha = ix; ctx.beginPath();
          ctx.arc(zx + Math.cos(a) * r, zy + Math.sin(a) * r, i % 3 === 0 ? 4 : i % 3 === 1 ? 2.5 : 1.5, 0, PI2); ctx.fill();
        }
        if (!z._coreGrad || z._coreGX !== _gx || z._coreGY !== _gy) {
          z._coreGrad = ctx.createRadialGradient(zx, zy, 0, zx, zy, R * 0.22);
          z._coreGrad.addColorStop(0, 'rgba(240,200,80,1)'); z._coreGrad.addColorStop(1, 'rgba(160,100,0,0)');
          z._coreGX = _gx; z._coreGY = _gy;
        }
        ctx.fillStyle = z._coreGrad; ctx.globalAlpha = (0.75 + 0.25 * Math.sin(t * 3)) * ix;
        ctx.beginPath(); ctx.arc(zx, zy, R * 0.22, 0, PI2); ctx.fill();

      // ── MAGMA SURGE: fire+earth — deep orange/red, slow lava pulse ──
      } else if (ck === 'HEATWAVE_DOWNPOUR') {
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * PI2 + t * 0.6; const r = R * (0.62 + 0.12 * Math.sin(i * 1.5 + t * 1.5));
          ctx.fillStyle = i % 3 === 0 ? 'rgba(255,100,0,0.9)' : 'rgba(200,50,0,0.7)';
          ctx.globalAlpha = ix; ctx.beginPath();
          ctx.arc(zx + Math.cos(a) * r, zy + Math.sin(a) * r, i % 3 === 0 ? 5 : i % 3 === 1 ? 3.5 : 2, 0, PI2); ctx.fill();
        }
        ctx.globalAlpha = (0.5 + 0.5 * Math.sin(t * 1.5)) * 0.7 * ix;
        ctx.strokeStyle = 'rgba(255,120,0,0.8)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(zx, zy, R * 0.85, 0, PI2); ctx.stroke();
        if (!z._coreGrad || z._coreGX !== _gx || z._coreGY !== _gy) {
          z._coreGrad = ctx.createRadialGradient(zx, zy, 0, zx, zy, R * 0.32);
          z._coreGrad.addColorStop(0, 'rgba(255,220,100,1)'); z._coreGrad.addColorStop(0.4, 'rgba(255,80,0,0.8)'); z._coreGrad.addColorStop(1, 'rgba(140,20,0,0)');
          z._coreGX = _gx; z._coreGY = _gy;
        }
        ctx.fillStyle = z._coreGrad; ctx.globalAlpha = (0.65 + 0.35 * Math.sin(t * 1.8)) * ix;
        ctx.beginPath(); ctx.arc(zx, zy, R * 0.32, 0, PI2); ctx.fill();

      // ── PERMAFROST: ice+earth — deep blue, slow heavy crystalline rings ──
      } else if (ck === 'BLIZZARD_DOWNPOUR') {
        for (const [spd, r, lw, dash, alpha] of [
          [0.25, R*0.91, 3, [22,6], 0.9], [-0.18, R*0.72, 2, [14,8], 0.7], [0.35, R*0.52, 1.5, [8,10], 0.55]
        ]) {
          ctx.save(); ctx.translate(zx, zy); ctx.rotate(t * spd);
          ctx.strokeStyle = '#88ccff'; ctx.lineWidth = lw; ctx.globalAlpha = alpha * ix;
          ctx.setLineDash(dash); ctx.beginPath(); ctx.arc(0, 0, r, 0, PI2); ctx.stroke();
          ctx.setLineDash([]); ctx.restore();
        }
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * PI2 + t * 0.3; const r = R * 0.72;
          const px = zx + Math.cos(a) * r, py = zy + Math.sin(a) * r, sz = 5;
          ctx.fillStyle = 'rgba(160,200,255,0.8)'; ctx.globalAlpha = ix;
          ctx.save(); ctx.translate(px, py); ctx.rotate(t * 0.3 + i);
          ctx.beginPath(); ctx.moveTo(0, -sz); ctx.lineTo(sz * 0.5, 0); ctx.lineTo(0, sz); ctx.lineTo(-sz * 0.5, 0); ctx.closePath(); ctx.fill(); ctx.restore();
        }
        if (!z._coreGrad || z._coreGX !== _gx || z._coreGY !== _gy) {
          z._coreGrad = ctx.createRadialGradient(zx, zy, 0, zx, zy, R * 0.25);
          z._coreGrad.addColorStop(0, 'rgba(180,220,255,1)'); z._coreGrad.addColorStop(0.5, 'rgba(60,100,220,0.7)'); z._coreGrad.addColorStop(1, 'rgba(20,40,160,0)');
          z._coreGX = _gx; z._coreGY = _gy;
        }
        ctx.fillStyle = z._coreGrad; ctx.globalAlpha = (0.6 + 0.4 * Math.sin(t * 1.4)) * ix;
        ctx.beginPath(); ctx.arc(zx, zy, R * 0.25, 0, PI2); ctx.fill();

      // ── DEFAULT FALLBACK: generic orbiting particles + 3 rings ──
      } else {
        const orbCount = cd.isMega ? 16 : 12;
        ctx.fillStyle = cd.color; ctx.globalAlpha = 0.75 * ix;
        ctx.beginPath();
        for (let i = 0; i < orbCount; i++) {
          const a = (i / orbCount) * PI2 + t * (cd.isMega ? 1.4 : 1.0);
          const orR = R * (0.55 + 0.12 * Math.sin(i * 1.7 + t * 2.1));
          const sz = cd.isMega ? 3.5 : 2.5;
          ctx.arc(zx + Math.cos(a) * orR, zy + Math.sin(a) * orR, sz, 0, PI2);
        }
        ctx.fill();
        const ringDefs = cd.isMega
          ? [[t * 1.0, R*0.94, [20,8]], [-t * 0.65, R*0.76, [12,10]], [t * 0.4, R*0.55, [8,12]]]
          : [[t * 0.8, R*0.92, [18,10]], [-t * 0.5, R*0.72, [10,14]], [t * 0.35, R*0.5, [6,14]]];
        for (const [rot, r, dash] of ringDefs) {
          ctx.save(); ctx.translate(zx, zy); ctx.rotate(rot);
          ctx.strokeStyle = cd.color; ctx.lineWidth = cd.isMega ? 4.0 : 2.5;
          ctx.globalAlpha = (cd.isMega ? 0.9 : 0.75) * ix; ctx.setLineDash(dash);
          ctx.beginPath(); ctx.arc(0, 0, r, 0, PI2); ctx.stroke();
          ctx.setLineDash([]); ctx.restore();
        }
        if (!z._coreGrad || z._coreGX !== _gx || z._coreGY !== _gy) {
          z._coreGrad = ctx.createRadialGradient(zx, zy, 0, zx, zy, R * 0.2);
          z._coreGrad.addColorStop(0, cd.color + 'ff'); z._coreGrad.addColorStop(1, cd.color + '00');
          z._coreGX = _gx; z._coreGY = _gy;
        }
        ctx.fillStyle = z._coreGrad; ctx.globalAlpha = (0.7 + 0.3 * Math.sin(t * 2.8)) * ix;
        ctx.beginPath(); ctx.arc(zx, zy, R * 0.2, 0, PI2); ctx.fill();
      }

      // ── Shared: announce on first full intensity ──
      if (!z.announced && z.intensity >= 0.95) {
        z.announced = true;
        showFloatText(z.x, z.y - z.radius - 30, cd.label, cd.color);
      }

      ctx.restore();
      continue; // skip normal zone rendering
    }

    // ── Normal zone rendering ─────────────────────────────────────────────
    const def = WEATHER_TYPES[z.type];
    if (!def) continue; // safety guard for any zone type not in WEATHER_TYPES

    ctx.save();

    // ── STORM ZONE RENDERING — no solid fill, pure energy ───────────────────
    const t_anim = performance.now() / 1000;
    if (!z._noiseSeed) z._noiseSeed = Math.random() * 100;
    const seed = z._noiseSeed;
    const R = z.radius;
    const ix = z.intensity;

    // Per-type configuration
    const cfg = {
      STORM:     { rotSpd:1.4, arcCount:18, boltCount:7,  streakCount:28, col:def.color, innerGlow:'rgba(200,220,255,' },
      RAIN:      { rotSpd:0.5, arcCount:12, boltCount:0,  streakCount:40, col:def.color, innerGlow:'rgba(100,160,255,' },
      BLIZZARD:  { rotSpd:0.7, arcCount:16, boltCount:0,  streakCount:50, col:def.color, innerGlow:'rgba(200,240,255,' },
      SANDSTORM: { rotSpd:0.9, arcCount:14, boltCount:3,  streakCount:35, col:def.color, innerGlow:'rgba(220,180,80,'  },
      HEATWAVE:  { rotSpd:0.4, arcCount:10, boltCount:0,  streakCount:20, col:def.color, innerGlow:'rgba(255,140,40,'  },
      BLACKHOLE: { rotSpd:2.2, arcCount:20, boltCount:0,  streakCount:0,  col:def.color, innerGlow:'rgba(120,0,200,'   },
    }[z.type] ?? { rotSpd:0.8, arcCount:14, boltCount:4, streakCount:25, col:def.color, innerGlow:'rgba(180,180,255,' };

    function sn(a, s) { // storm noise
      return Math.sin(a*3.7+seed+t_anim*s)*0.5
           + Math.sin(a*5.3-seed*.7+t_anim*s*1.3)*0.3
           + Math.sin(a*2.1+seed*1.4-t_anim*s*.7)*0.2;
    }

    ctx.save();
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';

    // ── 1. Soft inner glow — very faint radial, no hard fill ────────────────
    {
      const g = ctx.createRadialGradient(z.x, z.y, 0, z.x, z.y, R * 0.8);
      g.addColorStop(0,   cfg.innerGlow + (0.10 * ix).toFixed(2) + ')');
      g.addColorStop(0.4, cfg.innerGlow + (0.04 * ix).toFixed(2) + ')');
      g.addColorStop(1,   cfg.innerGlow + '0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(z.x, z.y, R * 0.85, 0, Math.PI*2); ctx.fill();
    }

    // ── 2. Rotating concentric arc wisps ─────────────────────────────────────
    for (let a = 0; a < cfg.arcCount; a++) {
      const frac = (a + 0.5) / cfg.arcCount;
      const baseAng = (a / cfg.arcCount) * Math.PI*2 + t_anim * cfg.rotSpd * (1 - frac * 0.5);
      const arcR = R * (0.15 + frac * 0.82 + sn(baseAng, cfg.rotSpd) * 0.06);
      const arcSpan = (0.3 + Math.abs(sn(baseAng + a, cfg.rotSpd * 0.5)) * 0.9) * Math.PI;
      const alpha = (0.12 + frac * 0.18) * ix * (0.6 + Math.abs(sn(baseAng, 0.3)) * 0.4);
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = cfg.col;
      ctx.lineWidth = 0.8 + (1 - frac) * 1.5;
      ctx.beginPath();
      ctx.arc(z.x, z.y, arcR, baseAng, baseAng + arcSpan);
      ctx.stroke();
    }

    // ── 3. Radial energy streaks ──────────────────────────────────────────────
    for (let s = 0; s < cfg.streakCount; s++) {
      const ang = (s / cfg.streakCount) * Math.PI*2 + sn(s, cfg.rotSpd * 0.2) * 0.4;
      const innerR = R * (0.05 + Math.random() * 0.0); // stable: use seed-based
      const innerFrac = 0.08 + ((s * 17 + seed * 3) % 100) / 100 * 0.35;
      const outerFrac = innerFrac + 0.15 + ((s * 31 + seed) % 100) / 100 * 0.5;
      const r1 = R * innerFrac;
      const r2 = R * Math.min(outerFrac, 0.95 + sn(ang + s, cfg.rotSpd) * 0.05);
      const devAng = ang + sn(ang * 2 + s * 0.3, cfg.rotSpd * 1.1) * 0.18;
      const alpha = (0.06 + ((s * 13) % 10) / 10 * 0.12) * ix;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = cfg.col;
      ctx.lineWidth = 0.6 + ((s * 7) % 10) / 10 * 1.0;
      ctx.beginPath();
      ctx.moveTo(z.x + Math.cos(ang) * r1, z.y + Math.sin(ang) * r1);
      ctx.lineTo(z.x + Math.cos(devAng) * r2, z.y + Math.sin(devAng) * r2);
      ctx.stroke();
    }

    // ── 4. Lightning bolt cracks (STORM / SANDSTORM only) ────────────────────
    for (let b = 0; b < cfg.boltCount; b++) {
      const bPhase = Math.floor(t_anim * 3 + b * 2.7) % 7; // flicker
      if (bPhase > 2) continue; // only visible ~40% of time
      const bAng = (b / cfg.boltCount) * Math.PI*2 + seed + t_anim * 0.3;
      const bAlpha = (0.4 + Math.random() * 0.4) * ix;
      ctx.globalAlpha = bAlpha;
      ctx.strokeStyle = b % 2 === 0 ? '#ffffff' : cfg.col;
      ctx.lineWidth = 1 + (bPhase === 0 ? 1.5 : 0.5);
      ctx.beginPath();
      let bx = z.x, by = z.y;
      ctx.moveTo(bx, by);
      const bSegs = 4 + (b % 3);
      for (let k = 0; k < bSegs; k++) {
        const frac = (k + 1) / bSegs;
        const jitter = R * 0.18 * (1 - frac);
        bx = z.x + Math.cos(bAng) * R * frac * 0.9 + (Math.random() - 0.5) * jitter;
        by = z.y + Math.sin(bAng) * R * frac * 0.9 + (Math.random() - 0.5) * jitter;
        ctx.lineTo(bx, by);
      }
      ctx.stroke();
    }

    // ── 5. Dissolving outer edge — scattered short arcs, no defined boundary ──
    let mergeProximity = 0;
    if (!z.converged && gs._lastMaelstromTime !== undefined) {
      const cdDone = (gs.time - (gs._lastMaelstromTime ?? -999)) >= 90;
      if (cdDone) {
        for (const other of gs.weatherZones) {
          if (other === z || other.intensity < 0.5) continue;
          const dd = Math.hypot(z.x - other.x, z.y - other.y);
          const larger = Math.max(z.radius, other.radius);
          const smaller = Math.min(z.radius, other.radius);
          if (dd < (larger - smaller * 0.45) * 2.5)
            mergeProximity = Math.max(mergeProximity, 1 - dd / ((larger - smaller * 0.45) * 2.5));
        }
      }
    }
    const pulse = 0.5 + 0.5 * Math.sin(gs.time * (2 + mergeProximity * 10));

    // Scattered short arc fragments near the perimeter — fade to nothing, no hard line
    const edgeFrags = 22;
    for (let e = 0; e < edgeFrags; e++) {
      const ang = (e / edgeFrags) * Math.PI*2 + sn(e, cfg.rotSpd * 0.4) * 0.5 + t_anim * cfg.rotSpd * 0.15;
      const rOff = sn(ang + e * 0.7, cfg.rotSpd * 0.6);
      const r = R * (0.82 + rOff * 0.15); // scattered near but inside edge
      const span = (0.08 + Math.abs(sn(ang, 0.5)) * 0.18) * Math.PI;
      const falloff = 0.5 + rOff * 0.5; // fragments closer to edge are fainter
      ctx.globalAlpha = Math.max(0, 0.1 * ix * falloff * (0.5 + pulse * 0.5));
      ctx.strokeStyle = mergeProximity > 0 ? `rgba(255,255,255,${mergeProximity*0.9})` : cfg.col;
      ctx.lineWidth = 0.8 + (1 - falloff) * 1.2;
      ctx.beginPath();
      ctx.arc(z.x, z.y, r, ang, ang + span);
      ctx.stroke();
    }

    // Merge warning — only visible cue when zones are close, no outline otherwise
    if (mergeProximity > 0.15) {
      const warnAlpha = mergeProximity * 0.6 * ix * pulse;
      ctx.globalAlpha = warnAlpha;
      ctx.strokeStyle = `rgba(255,255,255,${mergeProximity})`;
      ctx.lineWidth = 1 + mergeProximity * 2;
      ctx.setLineDash([6, 8]);
      ctx.beginPath();
      ctx.arc(z.x, z.y, R * 0.95, 0, Math.PI*2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // BLACKHOLE special: dark collapsing core
    if (z.type === 'BLACKHOLE') {
      const cg = ctx.createRadialGradient(z.x, z.y, 0, z.x, z.y, R*0.35);
      cg.addColorStop(0,   `rgba(0,0,0,${0.85*ix})`);
      cg.addColorStop(0.6, `rgba(40,0,80,${0.5*ix})`);
      cg.addColorStop(1,   'rgba(0,0,0,0)');
      ctx.fillStyle = cg; ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(z.x, z.y, R*0.35, 0, Math.PI*2); ctx.fill();
      const arrowCount = 8, rotSpeed = gs.time * 1.2;
      ctx.globalAlpha = 0.5 * ix; ctx.fillStyle = def.color;
      for (let a = 0; a < arrowCount; a++) {
        const angle = (a/arrowCount)*Math.PI*2 + rotSpeed;
        const ax = z.x + Math.cos(angle)*R*0.75, ay = z.y + Math.sin(angle)*R*0.75;
        ctx.save(); ctx.translate(ax, ay); ctx.rotate(angle+Math.PI);
        ctx.beginPath(); ctx.moveTo(0,-8); ctx.lineTo(5,4); ctx.lineTo(-5,4);
        ctx.closePath(); ctx.fill(); ctx.restore();
      }
    }

    if (!z.announced && z.intensity >= 0.95) {
      z.announced = true;
      showFloatText(z.x, z.y - R - 30, def.label ?? z.type, def.color);
    }

    ctx.restore(); // close inner drawing-state save (lineWidth/lineCap)
    ctx.restore(); // close outer zone save
  }


  // Weather particles — draw as elongated streaks in movement direction
  if (weatherParticles.length > 0) {
    ctx.save();
    const byColor = {};
    for (const p of weatherParticles) {
      if (!byColor[p.color]) byColor[p.color] = [];
      byColor[p.color].push(p);
    }
    for (const [color, pts] of Object.entries(byColor)) {
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.55;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (const p of pts) {
        // Streak: draw a short line in the direction of travel
        const spd = Math.hypot(p.vx ?? 0, p.vy ?? 0) || 1;
        const nx = (p.vx ?? 0) / spd, ny = (p.vy ?? 0) / spd;
        const streak = p.size * 3.5;
        ctx.lineWidth = p.size * 0.9;
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - nx * streak, p.y - ny * streak);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // End arena clipping
  ctx.restore();
}

// Draw storm zone labels on top of everything — called last in render()
function drawWeatherZoneLabels(gs) {
  if (!gs.weatherZones) return;
  const ab = getArenaBounds(gs);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const z of gs.weatherZones) {
    if (z.intensity <= 0.1) continue;

    // ── Maelstrom countdown — drawn here so it sits above health packs + characters ──
    if (z.comboKey === 'MAELSTROM' && z.comboDef?.effects?.implodeTimer && !(z._graceTimer > 0)) {
      const remaining = Math.max(0, z.lifetime - z.age);
      const fontSize  = Math.floor(20 + z.radius * 0.055);
      const offsetY   = z.radius * 0.10; // nudge below center — clears health pack
      ctx.save();
      ctx.globalAlpha  = z.intensity;
      ctx.font         = `900 ${fontSize}px 'Orbitron', monospace`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth    = 5;
      ctx.strokeStyle  = 'rgba(0,0,0,1)';
      ctx.strokeText(Math.ceil(remaining), z.x, z.y + offsetY);
      ctx.fillStyle    = remaining < 5 ? '#ff3333' : '#ffffff';
      ctx.fillText(Math.ceil(remaining), z.x, z.y + offsetY);
      ctx.restore();
    }

    let label, color, fontSize;
    if (z.converged && z.comboDef) {
      label    = z.comboDef.label;
      color    = z.comboDef.color;
      fontSize = Math.floor(13 + z.radius * 0.025);
    } else {
      const def = WEATHER_TYPES[z.type];
      if (!def) continue;
      label    = def.label;
      color    = def.color;
      fontSize = Math.floor(11 + z.radius * 0.02);
    }

    // Clamp label position to stay inside arena
    const rawY   = z.y - z.radius + (z.converged ? 28 : 22);
    const labelX = Math.max(ab.x + 10, Math.min(ab.x + ab.w - 10, z.x));
    const labelY = Math.max(ab.y + fontSize + 4, Math.min(ab.y + ab.h - 4, rawY));

    ctx.globalAlpha = Math.min(1, z.intensity * 1.5);
    ctx.font        = `bold ${fontSize}px 'Orbitron', monospace`;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.lineWidth   = 3;
    ctx.strokeText(label, labelX, labelY);
    ctx.fillStyle = color;
    ctx.fillText(label, labelX, labelY);
  }

  // ── Convergence % — shown at overlap midpoint between approaching zone pairs ──
  // Includes converged zones (mega storms) approaching others → shows Maelstrom buildup
  const MAELSTROM_CD = 90;
  const maelstromPossible = gs._lastMaelstromTime === undefined || (gs.time - gs._lastMaelstromTime) >= MAELSTROM_CD;
  // Build active list without filter() allocation
  const allActive = [];
  for (const z of gs.weatherZones) {
    if (z.intensity > 0.4 && z.comboKey !== 'MAELSTROM') allActive.push(z);
  }
  for (let i = 0; i < allActive.length; i++) {
    for (let j = i + 1; j < allActive.length; j++) {
      const za = allActive[i], zb = allActive[j];
      // Skip two converged zones pairing with each other (Maelstrom already handles that)
      if (za.converged && zb.converged) continue;
      // Hide maelstrom-warning % when maelstrom is on cooldown
      const isMaelstromWarning = za.converged || zb.converged;
      if (isMaelstromWarning && !maelstromPossible) continue;
      const dist = Math.hypot(za.x - zb.x, za.y - zb.y);
      const larger  = Math.max(za.radius, zb.radius);
      const smaller = Math.min(za.radius, zb.radius);
      const mergeThresh = larger - smaller * 0.45; // merge fires below this distance
      const startDist   = mergeThresh * 3.5;       // 0% shown here — far apart
      if (dist > startDist) continue;

      // Progress from 0% (startDist) to 100% (mergeThresh)
      const pct = Math.round((1 - (dist - mergeThresh) / (startDist - mergeThresh)) * 100);
      const clampedPct = Math.max(0, Math.min(99, pct)); // cap at 99; 100% = merge

      // Midpoint between zone centers
      const mx = (za.x + zb.x) / 2;
      const my = (za.y + zb.y) / 2;

      // Fade in as zones approach, pulse faster near merge
      const proximity = clampedPct / 100;
      const pulse = clampedPct >= 70
        ? 0.7 + 0.3 * Math.abs(Math.sin(gs.time * (4 + clampedPct * 0.08)))
        : 1;
      const alpha = (0.3 + proximity * 0.65) * pulse;

      // Color shifts: blue→white for normal merge, orange→red for Maelstrom buildup
      const bright = Math.round(180 + proximity * 75);
      const fSize  = Math.max(10, Math.round(10 + proximity * 9));

      ctx.globalAlpha = alpha;
      ctx.font = `900 ${fSize}px 'Orbitron', monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.lineWidth = 3;
      const label2 = `${clampedPct}%`;
      ctx.strokeText(label2, mx, my);
      ctx.fillStyle = isMaelstromWarning
        ? `rgb(255,${Math.round(140 - proximity * 80)},0)`   // orange → red
        : `rgb(${bright},${bright},255)`;                    // blue → white
      ctx.fillText(label2, mx, my);
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}
const PLAYER_COLORS = ['#ffee44', '#44eeff', '#ff6644', '#88ff44']; // P1=gold P2=cyan P3=orange P4=lime

// lockedTarget is now per-character (_lockedTarget on each human char).
// This stub remains so any stale references don't crash, but is never written.
let lockedTarget = null; // DEPRECATED — use char._lockedTarget instead

// ═══════════════════════════════════════════════════════
// ICON LIBRARY — hand-crafted SVG icons, royalty-free
// All icons use currentColor and viewBox="0 0 24 24"
// iconSVG(key, size?) → inline SVG string
// ═══════════════════════════════════════════════════════
const ICONS = {
  // ── Universal / UI ──────────────────────────────────
  ATK:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="19" x2="19" y2="5"/><polyline points="9 5 19 5 19 15"/><line x1="7" y1="21" x2="9" y2="19"/></svg>`,
  LOCK: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/><circle cx="12" cy="16" r="1.2" fill="currentColor"/></svg>`,
  PAUSE:`<svg viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="4" width="4" height="16" rx="1"/><rect x="15" y="4" width="4" height="16" rx="1"/></svg>`,
  RADAR:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><line x1="12" y1="3" x2="12" y2="1"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="3" y1="12" x2="1" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/></svg>`,
  TIP:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2a7 7 0 0 1 4 12.9V17a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-2.1A7 7 0 0 1 12 2z"/><line x1="9" y1="21" x2="15" y2="21"/><line x1="10" y1="23" x2="14" y2="23"/></svg>`,
  ONLINE:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 3c-3 4-3 14 0 18"/><path d="M12 3c3 4 3 14 0 18"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/></svg>`,
  HP:   `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21C12 21 3 14 3 8.5A5.5 5.5 0 0 1 12 5.1 5.5 5.5 0 0 1 21 8.5C21 14 12 21 12 21z"/></svg>`,
  MP:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.5 9 23 10 17.5 15.5 19 23 12 19.5 5 23 6.5 15.5 1 10 8.5 9"/></svg>`,
  SPD:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M13 2L4 14h8l-1 8 9-12h-8z" fill="currentColor" stroke="none"/></svg>`,
  DEF:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 4v6c0 5-4 9-8 10C8 21 4 17 4 12V6z"/></svg>`,

  SPNT: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18h13l2-5H8V7H5v11z"/><line x1="4" y1="20" x2="17" y2="20"/><path d="M14 13l3-3" stroke-width="1.5" opacity=".6"/><path d="M15 10l2-2" stroke-width="1.5" opacity=".4"/></svg>`,
  SWFT: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18h13l2-5H8V7H5v11z"/><line x1="4" y1="20" x2="17" y2="20"/><path d="M18 8l2-2m0 4l2-2" stroke-width="1.5"/></svg>`,
  BLNC: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18h13l2-5H8V7H5v11z"/><line x1="4" y1="20" x2="17" y2="20"/><circle cx="19" cy="8" r="2.5"/></svg>`,
  IRON: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18h13l2-5H8V7H5v11z"/><line x1="4" y1="20" x2="17" y2="20"/><path d="M9 13h6M9 16h6" stroke-width="1.5"/></svg>`,
  FORT: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18h13l2-5H8V7H5v11z"/><line x1="4" y1="20" x2="17" y2="20"/><path d="M9 7V4m4 3V4m4 3V4" stroke-width="1.5"/></svg>`,

  // ── Fire / Ember ─────────────────────────────────────
  FIRE: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C10 6 7 7 7 12a5 5 0 0 0 10 0c0-2-1-4-2-5-1 2-2 2-2 2S13 6 12 2zm0 14a2 2 0 0 1-2-2c0-2 2-3 2-3s2 1 2 3a2 2 0 0 1-2 2z" opacity=".9"/></svg>`,
  BOOM: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/><line x1="5" y1="5" x2="7" y2="7"/><line x1="17" y1="17" x2="19" y2="19"/><line x1="19" y1="5" x2="17" y2="7"/><line x1="7" y1="17" x2="5" y2="19"/></svg>`,
  VOLC: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 3 20 20 4 20" fill="currentColor" opacity=".3"/><polygon points="12 3 20 20 4 20"/><line x1="9" y1="13" x2="7" y2="8"/><line x1="15" y1="13" x2="17" y2="8"/><path d="M10 8c1-3 3-3 4 0" fill="none"/></svg>`,

  // ── Water / Tide ─────────────────────────────────────
  WAVE: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M2 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0"/><path d="M2 17c2-4 4-4 6 0s4 4 6 0 4-4 6 0" opacity=".5"/></svg>`,
  SPIN: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 12a8 8 0 1 1-3-6.3"/><polyline points="21 3 21 9 15 9"/></svg>`,
  TSUN: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 18c4-8 8-8 12 0"/><path d="M2 12c3-6 7-8 12-4"/><polyline points="18 8 22 12 18 16"/></svg>`,

  // ── Earth / Stone ────────────────────────────────────
  ROCK: `<svg viewBox="0 0 24 24" fill="currentColor" opacity=".9"><path d="M6 19l2-8 4-7 4 7 2 8H6z"/><path d="M8 11l4-2 4 2" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>`,
  SLAM: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="3" x2="12" y2="14"/><polyline points="7 9 12 14 17 9"/><path d="M4 19c2-2 5-3 8-3s6 1 8 3" opacity=".6"/><line x1="4" y1="21" x2="20" y2="21" opacity=".4"/></svg>`,
  MNTN: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 3 22 20 2 20" fill="currentColor" opacity=".25"/><polygon points="12 3 22 20 2 20"/><polyline points="8 20 12 10 16 20" opacity=".5"/></svg>`,

  // ── Wind / Gale ──────────────────────────────────────
  GUST: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 8h10a3 3 0 0 0 0-6 3 3 0 0 0-3 3"/><path d="M5 12h14"/><path d="M5 16h8a3 3 0 0 1 0 6 3 3 0 0 1-3-3"/></svg>`,
  WIND: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12h12a3 3 0 0 0 0-6 3 3 0 0 0-3 3"/><path d="M3 16h8a3 3 0 0 1 0 6 3 3 0 0 1-3-3"/><line x1="3" y1="8" x2="7" y2="8" opacity=".4"/></svg>`,

  // ── Black Hole / Void ────────────────────────────────────
  BLACKHOLE: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor" opacity=".2"/><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="4" fill="currentColor" opacity=".7"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>`,
  MUTE: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><line x1="7" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="7" y2="15"/></svg>`,
  ANNI: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2l2.5 7h7.5l-6 4.5 2.5 7L12 17l-6.5 3.5 2.5-7L2 9h7.5z" fill="currentColor" opacity=".3"/><path d="M12 2l2.5 7h7.5l-6 4.5 2.5 7L12 17l-6.5 3.5 2.5-7L2 9h7.5z"/></svg>`,

  // ── Arcane / Myst ────────────────────────────────────
  MYST: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><polygon points="12 2 14.5 9 22 9 16 13.5 18.5 21 12 16.5 5.5 21 8 13.5 2 9 9.5 9"/></svg>`,
  BIND: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 9V5"/><path d="M12 19v-4"/><path d="M9 12H5"/><path d="M19 12h-4"/><path d="M10 10l-3-3"/><path d="M17 17l-3-3"/><path d="M14 10l3-3"/><path d="M7 17l3-3"/></svg>`,
  SING: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="9"/><line x1="12" y1="3" x2="12" y2="1"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="3" y1="12" x2="1" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/></svg>`,

  // ── Lightning / Volt ─────────────────────────────────
  BOLT: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L4 14h8l-1 8 9-12h-8z"/></svg>`,
  SHCK: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M13 2L4 14h8l-1 8 9-12h-8z" fill="currentColor" opacity=".25"/><path d="M13 2L4 14h8l-1 8 9-12h-8z"/><path d="M2 18c3-2 5-2 8 0s5 2 8 0" opacity=".6"/></svg>`,
  THDR: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M13 2L4 14h8l-1 8 9-12h-8z" fill="currentColor" opacity=".3"/><path d="M13 2L4 14h8l-1 8 9-12h-8z"/><line x1="2" y1="6" x2="5" y2="6"/><line x1="2" y1="10" x2="4" y2="10" opacity=".6"/><line x1="20" y1="6" x2="23" y2="6"/><line x1="21" y1="10" x2="23" y2="10" opacity=".6"/></svg>`,

  // ── Ice / Frost ──────────────────────────────────────
  ICE:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="2" x2="12" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>`,
  NOVA: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="5" y1="5" x2="8" y2="8"/><line x1="16" y1="16" x2="19" y2="19"/><line x1="19" y1="5" x2="16" y2="8"/><line x1="8" y1="16" x2="5" y2="19"/></svg>`,
  PRSN: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor" opacity=".2"/><rect x="4" y="4" width="16" height="16" rx="2"/><line x1="12" y1="4" x2="12" y2="20" opacity=".5"/><line x1="4" y1="12" x2="20" y2="12" opacity=".5"/></svg>`,

  // ── Metal / Forge ────────────────────────────────────
  GEAR: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>`,
  SHOT: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="12" x2="17" y2="12"/><polygon points="17 8 21 12 17 16" fill="currentColor"/><line x1="7" y1="8" x2="7" y2="16" opacity=".4"/><line x1="11" y1="6" x2="11" y2="18" opacity=".3"/></svg>`,
  MAGN: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 4h4v9a2 2 0 0 0 4 0V4h4"/><line x1="5" y1="20" x2="9" y2="20"/><line x1="15" y1="20" x2="19" y2="20"/></svg>`,
  MELT: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="8" y="2" width="8" height="14" rx="2" fill="currentColor" opacity=".2"/><rect x="8" y="2" width="8" height="14" rx="2"/><path d="M10 16c0 4 4 4 4 0" opacity=".6"/><line x1="10" y1="7" x2="14" y2="7" opacity=".5"/></svg>`,

  // ── Nature / Flora ───────────────────────────────────
  LEAF: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 5C16 5 7 6 4 19c4-3 9-4 16-2V5z" fill="currentColor" opacity=".25"/><path d="M20 5C16 5 7 6 4 19c4-3 9-4 16-2V5z"/><line x1="4" y1="19" x2="11" y2="12"/></svg>`,
  THRN: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 5C16 5 7 6 4 19c4-3 9-4 16-2V5z" fill="currentColor" opacity=".2"/><path d="M20 5C16 5 7 6 4 19c4-3 9-4 16-2V5z"/><path d="M4 19l7-7"/><path d="M8 12l-3-3 3-1"/></svg>`,
  VINE: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20c4-8 12-10 16-8"/><path d="M4 20c2-4 6-8 10-9"/><circle cx="18" cy="6" r="2" fill="currentColor" opacity=".5"/><circle cx="13" cy="10" r="1.5" fill="currentColor" opacity=".4"/></svg>`,
  WRTX: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9" opacity=".3"/><path d="M12 3c5 3 5 15 0 18"/><path d="M3 12c3-5 15-5 18 0"/><path d="M5 5c5 2 9 12 14 14"/></svg>`,
};

// Helper — returns an inline SVG string sized to `size` px
function iconSVG(key, size=24, extraStyle='') {
  const svg = ICONS[key];
  if (!svg) return key; // fallback to text label
  // Inject width/height/style onto the <svg> tag
  return svg.replace('<svg ', `<svg width="${size}" height="${size}" style="display:inline-block;vertical-align:middle;${extraStyle}" `);
}

// ── Team colors (8 options) ──
const TEAM_COLORS = [
  { id:0, name:'BLUE',    color:'#1a4adb', bg:'rgba(26,74,219,0.18)'   },
  { id:1, name:'RED',     color:'#ff4444', bg:'rgba(255,68,68,0.18)'   },
  { id:2, name:'GREEN',   color:'#44ff88', bg:'rgba(68,255,136,0.18)'  },
  { id:3, name:'PURPLE',  color:'#cc44ff', bg:'rgba(204,68,255,0.18)'  },
  { id:4, name:'ORANGE',  color:'#ff9944', bg:'rgba(255,153,68,0.18)'  },
  { id:5, name:'YELLOW',  color:'#ffee44', bg:'rgba(255,238,68,0.18)'  },
  { id:6, name:'PINK',    color:'#ff44aa', bg:'rgba(255,68,170,0.18)'  },
  { id:7, name:'TEAL',    color:'#44ffcc', bg:'rgba(68,255,204,0.18)'  },
];

// Mode is now fully derived from lobbySlots — no fixed configs needed.
// Helper: derive a human-readable match label from current slots.
function getMatchLabel() {
  if (!lobbySlots || lobbySlots.length < 2) return '<span>—</span>';
  const seen = [];
  const teamMap = {};
  lobbySlots.forEach(s => {
    if (!teamMap[s.teamId]) { teamMap[s.teamId] = 0; seen.push(s.teamId); }
    teamMap[s.teamId]++;
  });
  return seen.map((tid, i) => {
    const tc = TEAM_COLORS[tid] || TEAM_COLORS[0];
    const sep = i < seen.length - 1 ? `<span style="color:rgba(255,255,255,0.3)"> / </span>` : '';
    return `<span style="color:${tc.color};font-weight:900">${teamMap[tid]}</span>${sep}`;
  }).join('');
}

// ── Lobby state ──
let lobbySlots = [];       // [{type:'cpu'|'p1', hero:HERO|null, locked:bool, teamId:number}]
let aiDifficulty = 'normal'; // 'easy' | 'normal' | 'hard'
let friendlyFire = false;    // when true, projectiles can hit teammates
let activeSlotIdx = 0;     // which slot is currently being picked for
let lobbyTimerInterval = null;
let lobbyPhase = 'pick';   // 'pick' | 'countdown' | 'launch'

