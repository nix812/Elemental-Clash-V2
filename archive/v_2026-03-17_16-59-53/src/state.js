// ========== STATE ==========
let selectedHero = HEROES[0];
let gameState = null;
let animFrame = null;
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
      implodeTimer: 8.0,
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
      lifetime: (cd.effects?.implodeTimer ?? 8) + 1,
      fadeOut: 4, age: 0,
      announced: false,
      _wanderAngle: Math.random() * Math.PI * 2, _wanderTimer: 0,
      _detonateTimer: 0, _freezeTimer: 0,
      _implodeTimer: cd.effects?.implodeTimer ?? 8,
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
    gs._lastMaelstromTime = now;
    gs._maelstromCount = (gs._maelstromCount ?? 0) + 1;
    return true;
  }

  const allActiveZones = gs.weatherZones.filter(z => z.intensity > 0.7);
  const nonConverged   = allActiveZones.filter(z => !z.converged);
  const convergedZones = allActiveZones.filter(z => z.converged && z.comboKey !== 'MAELSTROM');

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

    // ── Combo zone rendering ──────────────────────────────────────────────
    if (z.converged && z.comboDef) {
      const cd = z.comboDef;
      const t = performance.now() / 1000;
      ctx.save();

      // Radial gradient fill using hex color with alpha suffixes
      ctx.globalAlpha = z.intensity;
      const cg = ctx.createRadialGradient(z.x, z.y, 0, z.x, z.y, z.radius);
      cg.addColorStop(0,   cd.color + 'aa');
      cg.addColorStop(0.4, cd.color + '55');
      cg.addColorStop(1,   cd.color + '00');
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.radius, 0, Math.PI * 2);
      ctx.fill();

      // Spinning double ring (distinct from single zone rings)
      const rot1 = t * 0.8;
      const rot2 = -t * 0.5;
      // MEGA zones get a thicker, brighter outer ring to signal amplification
      const ringWidth = cd.isMega ? 4.0 : 2.5;
      const ringAlpha = cd.isMega ? 0.9 : 0.7;
      for (const [rot, r, dash] of [[rot1, z.radius * 0.92, [18,10]], [rot2, z.radius * 0.72, [10,14]]]) {
        ctx.save();
        ctx.translate(z.x, z.y);
        ctx.rotate(rot);
        ctx.strokeStyle = cd.color;
        ctx.lineWidth = ringWidth;
        ctx.globalAlpha = ringAlpha * z.intensity;
        ctx.setLineDash(dash);
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // MEGA zones: extra pulsing solid outer ring to make amplification obvious
      if (cd.isMega) {
        const pulse = 0.5 + 0.5 * Math.abs(Math.sin(t * 2.5));
        ctx.save();
        ctx.globalAlpha = pulse * z.intensity * 0.8;
        ctx.strokeStyle = cd.color;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(z.x, z.y, z.radius * 0.98, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Label — drawn separately by drawWeatherZoneLabels() to render above obstacles/characters

      // Maelstrom: countdown timer — doesn't show during grace period
      if (z.comboKey === 'MAELSTROM' && z.comboDef.effects?.implodeTimer && !(z._graceTimer > 0)) {
        const remaining = Math.max(0, z.lifetime - z.age);
        ctx.font = `900 ${Math.floor(18 + z.radius * 0.04)}px 'Orbitron', monospace`;
        ctx.fillStyle = remaining < 5 ? '#ff4444' : '#ffffff';
        ctx.strokeStyle = 'rgba(0,0,0,0.9)';
        ctx.strokeText(Math.ceil(remaining), z.x, z.y);
        ctx.fillText(Math.ceil(remaining), z.x, z.y);
      }

      // Announce on first full intensity
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

    // Cache gradient — only recreate if zone moved more than 4px or intensity changed noticeably
    const gx = Math.round(z.x / 4) * 4, gy = Math.round(z.y / 4) * 4;
    const gi = Math.round(z.intensity * 10);
    const gradKey = `${gx},${gy},${gi}`;
    if (!z._gradCache || z._gradKey !== gradKey) {
      const grad = ctx.createRadialGradient(z.x, z.y, 0, z.x, z.y, z.radius);
      grad.addColorStop(0,   def.glowColor.replace('0.2', String((0.32 * z.intensity).toFixed(2))));
      grad.addColorStop(0.5, def.glowColor.replace('0.2', String((0.18 * z.intensity).toFixed(2))));
      grad.addColorStop(1,   'rgba(0,0,0,0)');
      z._gradCache = grad;
      z._gradKey = gradKey;
    }
    ctx.fillStyle = z._gradCache;
    ctx.beginPath();
    ctx.arc(z.x, z.y, z.radius, 0, Math.PI*2);
    ctx.fill();

    // Black hole zone: dark collapsing core + rotating pull arrows
    if (z.type === 'BLACKHOLE') {
      // Dark singularity core
      const coreGrad = ctx.createRadialGradient(z.x, z.y, 0, z.x, z.y, z.radius * 0.35);
      coreGrad.addColorStop(0,   `rgba(0,0,0,${0.85 * z.intensity})`);
      coreGrad.addColorStop(0.6, `rgba(40,0,80,${0.5 * z.intensity})`);
      coreGrad.addColorStop(1,   'rgba(0,0,0,0)');
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.radius * 0.35, 0, Math.PI*2);
      ctx.fill();

      // Rotating pull arrows around the ring
      const arrowCount = 8;
      const rotSpeed = gs.time * 1.2;
      ctx.globalAlpha = 0.5 * z.intensity;
      ctx.fillStyle = def.color;
      for (let a = 0; a < arrowCount; a++) {
        const angle = (a / arrowCount) * Math.PI * 2 + rotSpeed;
        const arrowR = z.radius * 0.75;
        const ax = z.x + Math.cos(angle) * arrowR;
        const ay = z.y + Math.sin(angle) * arrowR;
        // Arrow points toward center
        const toCenter = angle + Math.PI;
        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate(toCenter);
        ctx.beginPath();
        ctx.moveTo(0, -8);
        ctx.lineTo(5, 4);
        ctx.lineTo(-5, 4);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }

    // Zone edge ring — pulsing dashed outline at full radius
    // If this zone is close to merging with another, pulse faster and shift toward white
    let mergeProximity = 0; // 0=far, 1=at merge threshold
    if (!z.converged && gs._lastMaelstromTime !== undefined) {
      // Check if cooldown is up and this zone is approaching any other
      const cdDone = (gs.time - (gs._lastMaelstromTime ?? -999)) >= 90;
      if (cdDone) {
        for (const other of gs.weatherZones) {
          if (other === z || other.intensity < 0.5) continue;
          const dd = Math.hypot(z.x - other.x, z.y - other.y);
          const larger = Math.max(z.radius, other.radius);
          const smaller = Math.min(z.radius, other.radius);
          const mergeThresh = larger - smaller * 0.45;
          const warnThresh  = mergeThresh * 2.5; // start warning at 2.5x merge distance
          if (dd < warnThresh) {
            mergeProximity = Math.max(mergeProximity, 1 - dd / warnThresh);
          }
        }
      }
    }
    const pulseSpeed = 2 + mergeProximity * 10; // 2 normally, up to 12 when close
    const pulse = 0.5 + 0.5 * Math.sin(gs.time * pulseSpeed);
    const ringColor = mergeProximity > 0
      ? `rgba(255,255,255,${mergeProximity * 0.8})` // shift toward white as proximity increases
      : def.color;
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 2 + pulse * (2 + mergeProximity * 3);
    ctx.globalAlpha = (0.25 + mergeProximity * 0.5) * z.intensity;
    ctx.setLineDash([12, 8]);
    ctx.beginPath();
    ctx.arc(z.x, z.y, z.radius, 0, Math.PI*2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Inner ring — shows where intensity ≥ ~0.8 (t ≤ 0.45 in quadratic model)
    // This is the "power zone" players should aim to stand in
    const innerR = z.radius * 0.45;
    ctx.strokeStyle = def.color;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.45 * z.intensity * pulse;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.arc(z.x, z.y, innerR, 0, Math.PI*2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Zone label at top of circle
    if (z.intensity > 0.4) {
      ctx.globalAlpha = (z.intensity - 0.4) / 0.6;
      // Label — drawn separately by drawWeatherZoneLabels() to render above obstacles/characters
    }

    ctx.restore();
  }

  // Weather particles — batch all same-color into a single path, constant alpha per batch
  if (weatherParticles.length > 0) {
    ctx.save();
    const byColor = {};
    for (const p of weatherParticles) {
      if (!byColor[p.color]) byColor[p.color] = [];
      byColor[p.color].push(p);
    }
    for (const [color, pts] of Object.entries(byColor)) {
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.55; // fixed alpha per batch — cheap, good enough
      ctx.beginPath();
      for (const p of pts) {
        ctx.moveTo(p.x + p.size, p.y);
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      }
      ctx.fill();
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
  { id:0, name:'BLUE',    color:'#00d4ff', bg:'rgba(0,212,255,0.18)'   },
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

