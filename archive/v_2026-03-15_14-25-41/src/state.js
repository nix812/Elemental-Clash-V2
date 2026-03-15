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
    universal: { healRate: 14 },
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
    universal: { voidPull: 260 },  // strong pull, sprint is the escape
  },
};

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
    lifetime: 28 + Math.random() * 20,
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

  const progress = Math.min(1, gs.time / MATCH_DURATION);
  // Late game: more zones allowed, faster spawning
  const maxZones      = progress < 0.66 ? 2 : 3;
  const spawnInterval = progress < 0.33 ? 32 : progress < 0.66 ? 22 : 14;
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
      const def = WEATHER_TYPES[z.type];
      showFloatText(z.x, z.y - z.radius - 30, def.label, def.color);
    }

    // Spawn particles — capped to keep particle count bounded
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
        color: WEATHER_TYPES[z.type].particleColor,
        size: 1.5 + Math.random()*2.5,
      });
    }

    return true;
  });

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
    const falloff = Math.max(0, 1 - dist / z.radius);
    const eff = falloff * z.intensity;
    if (eff > 0.05) hits.push({ type: z.type, intensity: eff, zone: z, def: WEATHER_TYPES[z.type] });
  }
  if (!hits.length) return null;
  hits.sort((a, b) => b.intensity - a.intensity);
  // Return array — callers that used to read a single object still work via [0]
  hits.primary = hits[0]; // convenience alias for legacy callers
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
  c.inWeather           = null;
  c.inWeatherAll        = null; // all active zones for display

  if (!zones) return;
  c.inWeather    = zones[0];   // primary (strongest) for legacy code
  c.inWeatherAll = zones;      // full list for display

  // Notify player on zone entry (primary zone only)
  if (!wasInWeather && c.isPlayer && zones[0].intensity > 0.3) {
    const def = WEATHER_TYPES[zones[0].zone.type];
    spawnFloat(c.x, c.y, `${def.label}!`, def.color, { char: c });
    Audio.sfx.weatherEnter(zones[0].zone.type);
  }

  // Stack effects from ALL overlapping zones
  for (const w of zones) {
    const { def, intensity } = w;
    const u = def.universal;
    if (!u) continue;

    if (u.dmgMult)      c.weatherDmgMult      *= 1 + (u.dmgMult - 1)      * intensity;
    if (u.rangeMult)    c.weatherRangeMult    *= 1 + (u.rangeMult - 1)    * intensity;
    if (u.speedMult)    c.weatherSpeedMult    *= 1 + (u.speedMult - 1)    * intensity;
    if (u.cooldownMult) c.weatherCooldownMult *= 1 - (1 - u.cooldownMult) * intensity;
    if (u.healRate)     c.weatherHealRate     += u.healRate * intensity;
    if (u.shieldRate)   c.weatherShieldRate   += u.shieldRate * intensity;
    // Black hole: use strongest pull zone only (stacking pulls would be unfair)
    if (u.voidPull && !c.weatherBlackholePull) {
      c.weatherBlackholePull = { x: w.zone.x, y: w.zone.y, force: u.voidPull * intensity };
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
    const falloff = Math.max(0, 1 - dist / zones[0].zone.radius);
    const pullStr = vp.force * (0.4 + falloff * 0.6) * dt;

    const isSprinting = (c.sprintTimer ?? 0) > 0;
    if (isSprinting) {
      // Sprint escape: directly zero out pull contribution and push outward
      const escapeForce = vp.force * 0.8 * dt;
      c.velX = (c.velX || 0) - normX * escapeForce;
      c.velY = (c.velY || 0) - normY * escapeForce;
    } else {
      c.velX = (c.velX || 0) + normX * pullStr;
      c.velY = (c.velY || 0) + normY * pullStr;
      // Cap pull velocity so it can never overwhelm the wall bounce
      const pullSpeed = Math.hypot(c.velX, c.velY);
      const maxPullSpeed = 18;
      if (pullSpeed > maxPullSpeed) {
        c.velX = (c.velX / pullSpeed) * maxPullSpeed;
        c.velY = (c.velY / pullSpeed) * maxPullSpeed;
      }
      // Flag AI every frame inside pull zone so escape logic stays armed
      if (!c.isPlayer) c._wasPulled = true;
    }
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
    const def = WEATHER_TYPES[z.type];

    ctx.save();

    // Outer atmospheric glow
    const grad = ctx.createRadialGradient(z.x, z.y, 0, z.x, z.y, z.radius);
    grad.addColorStop(0,   def.glowColor.replace('0.2', String((0.32 * z.intensity).toFixed(2))));
    grad.addColorStop(0.5, def.glowColor.replace('0.2', String((0.18 * z.intensity).toFixed(2))));
    grad.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
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
      const rotSpeed = Date.now() * 0.001;
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

    // Zone edge ring — pulsing
    const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.002);
    ctx.strokeStyle = def.color;
    ctx.lineWidth = 2 + pulse * 2;
    ctx.globalAlpha = 0.25 * z.intensity;
    ctx.setLineDash([12, 8]);
    ctx.beginPath();
    ctx.arc(z.x, z.y, z.radius, 0, Math.PI*2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Zone label at top of circle
    if (z.intensity > 0.4) {
      ctx.globalAlpha = (z.intensity - 0.4) / 0.6;
      ctx.font = `bold ${Math.floor(11 + z.radius * 0.02)}px 'Orbitron', monospace`;
      ctx.fillStyle = def.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 3;
      ctx.strokeText(def.label, z.x, z.y - z.radius + 22);
      ctx.fillText(def.label, z.x, z.y - z.radius + 22);
    }

    ctx.restore();
  }

  // Weather particles — grouped by color to minimize state changes, no shadowBlur
  if (weatherParticles.length > 0) {
    ctx.save();
    // Group by color for fewer fillStyle switches
    const byColor = {};
    for (const p of weatherParticles) {
      if (!byColor[p.color]) byColor[p.color] = [];
      byColor[p.color].push(p);
    }
    for (const [color, pts] of Object.entries(byColor)) {
      ctx.fillStyle = color;
      for (const p of pts) {
        ctx.globalAlpha = (p.life / p.maxLife) * 0.7;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI*2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // End arena clipping
  ctx.restore();
}

let lockedTarget = null;    // currently locked enemy (player's target lock)

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

