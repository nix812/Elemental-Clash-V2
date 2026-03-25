// ========== SPATIAL UTILITIES ==========
// ── Warp-aware shortest path between two world positions ─────────────────
// Must live here (arena.js) — loaded before game-loop.js and ai.js.
function warpDelta(ax, ay, bx, by) {
  const W = gameState?.arena?.scale ? 3200 * gameState.arena.scale : 3200;
  const H = gameState?.arena?.scale ? 1800 * gameState.arena.scale : 1800;
  let dx = bx - ax, dy = by - ay;
  if (Math.abs(dx - W) < Math.abs(dx)) dx -= W; else if (Math.abs(dx + W) < Math.abs(dx)) dx += W;
  if (Math.abs(dy - H) < Math.abs(dy)) dy -= H; else if (Math.abs(dy + H) < Math.abs(dy)) dy += H;
  return { dx, dy, dist: Math.sqrt(dx*dx + dy*dy) || 1 };
}
// Squared warp distance — no sqrt, for comparisons only
function warpDist2(ax, ay, bx, by) {
  const { dx, dy } = warpDelta(ax, ay, bx, by);
  return dx*dx + dy*dy;
}

// ========== ITEMS ==========
// ── Health pack spawn system ──
// Two fixed slots, each with its own 15s cooldown after pickup.
// Neither spawns until 30s have elapsed in the match.
const HP_PACK_SLOTS = [
  { id: 0, cooldown: 0 },
  { id: 1, cooldown: 0 },
];
const HP_PACK_COOLDOWN = 15;   // seconds between respawns per slot
const HP_PACK_DELAY    = 30;   // seconds before first spawn
const HP_PACK_HEAL     = 0.40; // heals 40% of max HP total (15% instant + 25% HoT)

const MANA_PACK_SLOTS = [
  { id: 0, cooldown: 0 },
  { id: 1, cooldown: 0 },
];
const MANA_PACK_COOLDOWN = 18;   // slightly longer than health packs
const MANA_PACK_DELAY    = 20;   // appears earlier — mana pressure hits sooner
const MANA_PACK_RESTORE  = 0.50; // restores 50% of max mana instantly

// Finds best spawn position for a pack — maximises distance from characters and existing items
// packType: 'healthpack' or 'manapack' — controls item proximity weighting
function _bestPackPos(gs, packType) {
  const b = gs.gates ? getArenaBounds(gs) : { x: 0, y: 0, x2: gs.W, y2: gs.H, w: gs.W, h: gs.H };
  const margin = 150;
  const ax = b.x + margin, ay = b.y + margin;
  const aw = b.w - margin * 2, ah = b.h - margin * 2;
  if (aw <= 0 || ah <= 0) return { x: b.x + b.w/2, y: b.y + b.h/2 };

  const chars = [gs.player, ...(gs.enemies || [])].filter(c => c && c.alive);
  const isMana = packType === 'manapack';
  const COLS = 8, ROWS = 5;
  let best = null, bestDist = -1;

  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < ROWS; row++) {
      const cx = ax + (col + 0.5) * aw / COLS;
      const cy = ay + (row + 0.5) * ah / ROWS;
      let minD = Infinity;
      for (const c of chars) {
        const dx = c.x - cx, dy = c.y - cy;
        minD = Math.min(minD, Math.sqrt(dx * dx + dy * dy));
      }
      for (const item of gs.items) {
        if (!isMana && item.type !== 'healthpack') continue;
        const dx = item.x - cx, dy = item.y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const weight = isMana ? (item.type === 'healthpack' ? 0.3 : 0.5) : 0.5;
        minD = Math.min(minD, dist * weight);
      }
      if (minD > bestDist) { bestDist = minD; best = { x: cx, y: cy }; }
    }
  }
  return best || { x: b.x + b.w/2, y: b.y + b.h/2 };
}

function spawnItems(gs) {
  if (!gs || gs.time < HP_PACK_DELAY) return;
  // Count existing health packs on the map
  const onMap = gs.items.filter(i => i.type === 'healthpack');
  HP_PACK_SLOTS.forEach(slot => {
    // Already on map
    if (onMap.some(i => i.slotId === slot.id)) return;
    // Still on cooldown
    if (slot.cooldown > 0) return;
    // Spawn one
    const pos = _bestPackPos(gs, 'healthpack');
    gs.items.push({
      type: 'healthpack',
      slotId: slot.id,
      x: pos.x, y: pos.y,
      vx: (Math.random() - 0.5) * 40,
      vy: (Math.random() - 0.5) * 40,
      icon: '💊',
      color: '#ff4488',
    });
  });

  // Mana packs — spawn after their own delay
  if (gs.time >= MANA_PACK_DELAY) {
    const manaOnMap = gs.items.filter(i => i.type === 'manapack');
    MANA_PACK_SLOTS.forEach(slot => {
      if (manaOnMap.some(i => i.slotId === slot.id)) return;
      if (slot.cooldown > 0) return;
      const pos = _bestPackPos(gs, 'manapack');
      gs.items.push({
        type: 'manapack',
        slotId: slot.id,
        x: pos.x, y: pos.y,
        vx: (Math.random() - 0.5) * 40,
        vy: (Math.random() - 0.5) * 40,
        color: '#4466ff',
      });
    });
  }
}

function tickItemCooldowns(gs, dt) {
  HP_PACK_SLOTS.forEach(slot => {
    if (slot.cooldown > 0) slot.cooldown = Math.max(0, slot.cooldown - dt);
  });
  MANA_PACK_SLOTS.forEach(slot => {
    if (slot.cooldown > 0) slot.cooldown = Math.max(0, slot.cooldown - dt);
  });

  // Cull items that have drifted outside the shrinking arena
  if (gs.gates) {
    const b = getArenaBounds(gs);
    gs.items = gs.items.filter(item => {
      const outside = item.x < b.x || item.x > b.x2 || item.y < b.y || item.y > b.y2;
      if (outside) {
        if (item.type === 'healthpack') {
          const slot = HP_PACK_SLOTS.find(s => s.id === item.slotId);
          if (slot) slot.cooldown = 3;
        } else if (item.type === 'manapack') {
          const slot = MANA_PACK_SLOTS.find(s => s.id === item.slotId);
          if (slot) slot.cooldown = 3;
        }
      }
      return !outside;
    });
  }
}

function applyItem(player, item, gs) {
  if (item.type === 'healthpack') {
    // Allow pickup at full health — denies the pack from fleeing enemies
    const totalHeal   = Math.round(player.maxHp * HP_PACK_HEAL);
    const instantHeal = Math.round(player.maxHp * 0.15);
    const hotHeal     = totalHeal - instantHeal;
    // 15% instant, remaining 25% over 3 seconds
    player.hp = Math.min(player.maxHp, player.hp + instantHeal);
    player.healRemaining = (player.healRemaining || 0) + hotHeal;
    player.healDuration  = 3.0;
    const atFull = player.hp >= player.maxHp && instantHeal === 0;
    spawnFloat(item.x, item.y, atFull ? 'DENIED!' : `+${instantHeal} (+${hotHeal})`, '#ff4488', { char: player });
    if (player.isPlayer) Audio.sfx.pickupHealth();
    // Tutorial tracking
    if (gs?.isTutorial && player.isPlayer) {
      if (!gs.tutorial) gs.tutorial = {};
      gs.tutorial._healthPickup = true;
    }
    // Start cooldown for this slot
    const slot = HP_PACK_SLOTS.find(s => s.id === item.slotId);
    if (slot) slot.cooldown = HP_PACK_COOLDOWN;
    // ── PASSIVE: FLORA — Overgrowth ──
    PASSIVES[player.hero?.id]?.onHeal?.(player, totalHeal, gs);
    return true; // consumed
  }
  if (item.type === 'manapack') {
    const restore = Math.round((player.maxMana ?? 100) * MANA_PACK_RESTORE);
    player.mana = Math.min(player.maxMana ?? 100, (player.mana ?? 0) + restore);
    spawnFloat(item.x, item.y, `+${restore} MANA`, '#4488ff', { char: player });
    if (player.isPlayer) Audio.sfx.pickupMana();
    const slot = MANA_PACK_SLOTS.find(s => s.id === item.slotId);
    if (slot) slot.cooldown = MANA_PACK_COOLDOWN;
    return true; // consumed
  }
  return false;
}

// ========== FLOATING OBSTACLES ==========
// Randomly generated each match — varied shapes, sizes, slow floating paths.
// Block projectiles. Push characters out on overlap. AOEs pass through.

// Queue a new obstacle to spawn after a delay — keeps cover density stable in long matches
function scheduleObstacleRespawn(isLarge, gs) {
  if (!gs._obstacleRespawnQueue) gs._obstacleRespawnQueue = [];
  gs._obstacleRespawnQueue.push({ isLarge, timer: 8 + Math.random() * 6 }); // 8–14s delay
}

function generateObstacles(gs) {
  const b = getArenaBounds(gs);
  gs.obstacles = [];

  const largeCount = 5 + Math.floor(Math.random() * 4); // 5–8 large (up from 3–5)
  const smallCount = 5 + Math.floor(Math.random() * 4); // 5–8 small

  function makeObstacle(isLarge) {
    const size = isLarge
      ? 55 + Math.random() * 45   // large: 55–100
      : 18 + Math.random() * 22;  // small: 18–40

    const sides = isLarge
      ? 4 + Math.floor(Math.random() * 4)  // 4–7 sides
      : 3 + Math.floor(Math.random() * 3); // 3–5 sides

    const verts = [];
    for (let v = 0; v < sides; v++) {
      const angle = (v / sides) * Math.PI * 2 - Math.PI / 2;
      const r = size * (0.75 + Math.random() * 0.5);
      verts.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r });
    }

    const pathType = ['drift', 'orbit', 'bounce'][Math.floor(Math.random() * 3)];
    const orbitR   = 60 + Math.random() * 120;
    const orbitSpd = (Math.random() < 0.5 ? 1 : -1) * (0.2 + Math.random() * 0.3);
    const orbitPhase = Math.random() * Math.PI * 2;
    const bvx = (Math.random() < 0.5 ? 1 : -1) * (8 + Math.random() * 12);
    const bvy = (Math.random() < 0.5 ? 1 : -1) * (8 + Math.random() * 12);

    const margin = size + (pathType === 'orbit' ? orbitR + 80 : 80);
    const ox = b.x + margin + Math.random() * Math.max(10, b.w - margin * 2);
    const oy = b.y + margin + Math.random() * Math.max(10, b.h - margin * 2);

    const hp    = isLarge ? 5 + Math.floor(Math.random() * 6) : 2;
    const maxHp = hp;

    gs.obstacles.push({
      x: ox, y: oy,
      baseX: ox, baseY: oy,
      verts, size, sides, pathType,
      orbitR, orbitSpd, orbitPhase,
      vx: bvx, vy: bvy,
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.3,
      color:     `hsl(${200 + Math.random() * 60}, 20%, ${12 + Math.random() * 10}%)`,
      edgeColor: `hsl(${180 + Math.random() * 80}, 60%, ${40 + Math.random() * 20}%)`,
      hp, maxHp, isFragment: false, _dmgCd: 0,
      _spawnFade: 0,
    });
  }

  for (let i = 0; i < largeCount; i++) makeObstacle(true);
  for (let i = 0; i < smallCount; i++) makeObstacle(false);
}

function updateObstacles(gs, dt) {
  if (!gs.obstacles) return;
  const b = getArenaBounds(gs);

  // Pre-find active Maelstrom for gravitational nudge
  const maelstrom = gs.weatherZones?.find(z => z.comboKey === 'MAELSTROM' && z.intensity > 0.3);

  for (const ob of gs.obstacles) {
    ob.rotation += ob.rotSpeed * dt;
    if ((ob._dmgCd ?? 0) > 0) ob._dmgCd = Math.max(0, ob._dmgCd - dt);
    if ((ob._spawnFade ?? 1) < 1) ob._spawnFade = Math.min(1, ob._spawnFade + dt * 0.5);

    // ── Maelstrom gravitational pull — strong enough to drag rocks in ──
    if (maelstrom) {
      const mdx = maelstrom.x - ob.x, mdy = maelstrom.y - ob.y;
      const md  = Math.hypot(mdx, mdy) || 1;
      if (md < maelstrom.radius * 2.2) {
        // Pull scales with proximity — crushing at core, strong at edge
        const proximity = 1 - md / (maelstrom.radius * 2.2);
        const pullStr   = 420 * proximity * proximity * maelstrom.intensity;
        ob.vx = (ob.vx ?? 0) + (mdx / md) * pullStr * dt;
        ob.vy = (ob.vy ?? 0) + (mdy / md) * pullStr * dt;
      }
    }

    // Friction — bleeds off any player-imparted impulse so obstacles settle back naturally
    const DRAG = 0.96; // lighter drag so impulses last longer before dying out
    ob.vx = (ob.vx ?? 0) * DRAG;
    ob.vy = (ob.vy ?? 0) * DRAG;
    // Clamp residual jitter to zero
    if (Math.abs(ob.vx) < 0.05) ob.vx = 0;
    if (Math.abs(ob.vy) < 0.05) ob.vy = 0;

    // Rotational friction — bleeds off spin so rocks decelerate naturally after being hit.
    // Without this, stacked collision impulses cause nutty perpetual spinning.
    const ROT_DRAG = 0.988; // gentle — takes ~3s to halve spin from a big hit
    ob.rotSpeed = (ob.rotSpeed ?? 0) * ROT_DRAG;
    if (Math.abs(ob.rotSpeed) < 0.003) ob.rotSpeed = 0; // clamp micro-spin

    if (ob.pathType === 'orbit') {
      ob.orbitPhase += ob.orbitSpd * dt;
      // Base orbit position + any player-imparted nudge (vx/vy act as offset, drag handles decay)
      ob._nudgeX = (ob._nudgeX ?? 0) + ob.vx * dt;
      ob._nudgeY = (ob._nudgeY ?? 0) + ob.vy * dt;
      ob._nudgeX *= DRAG; ob._nudgeY *= DRAG;
      const MAX_NUDGE = 40;
      ob._nudgeX = Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, ob._nudgeX));
      ob._nudgeY = Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, ob._nudgeY));
      // Clamp baseX/baseY so orbit centre doesn't drift outside shrinking arena
      const margin = ob.orbitR + ob.size + 10;
      ob.baseX = Math.max(b.x + margin, Math.min(b.x2 - margin, ob.baseX));
      ob.baseY = Math.max(b.y + margin, Math.min(b.y2 - margin, ob.baseY));
      ob.x = ob.baseX + Math.cos(ob.orbitPhase) * ob.orbitR + ob._nudgeX;
      ob.y = ob.baseY + Math.sin(ob.orbitPhase) * ob.orbitR + ob._nudgeY;
      // Hard clamp final position so it never renders outside the arena
      const m = ob.size + 4;
      ob.x = Math.max(b.x + m, Math.min(b.x2 - m, ob.x));
      ob.y = Math.max(b.y + m, Math.min(b.y2 - m, ob.y));
    } else if (ob.pathType === 'bounce') {
      ob.x += ob.vx * dt;
      ob.y += ob.vy * dt;
      const m = ob.size + 20;
      if (ob.x < b.x + m)  { ob.x = b.x + m;  ob.vx =  Math.abs(ob.vx); }
      if (ob.x > b.x2 - m) { ob.x = b.x2 - m; ob.vx = -Math.abs(ob.vx); }
      if (ob.y < b.y + m)  { ob.y = b.y + m;  ob.vy =  Math.abs(ob.vy); }
      if (ob.y > b.y2 - m) { ob.y = b.y2 - m; ob.vy = -Math.abs(ob.vy); }
    } else { // drift
      ob.x += ob.vx * dt;
      ob.y += ob.vy * dt;
      const m = ob.size + 20;
      if (ob.x < b.x + m)  { ob.x = b.x + m;  ob.vx =  Math.abs(ob.vx); }
      if (ob.x > b.x2 - m) { ob.x = b.x2 - m; ob.vx = -Math.abs(ob.vx); }
      if (ob.y < b.y + m)  { ob.y = b.y + m;  ob.vy =  Math.abs(ob.vy); }
      if (ob.y > b.y2 - m) { ob.y = b.y2 - m; ob.vy = -Math.abs(ob.vy); }
    }
  }

  // Rock-rock collision — push overlapping obstacles apart
  const obs = gs.obstacles;
  for (let i = 0; i < obs.length; i++) {
    for (let j = i + 1; j < obs.length; j++) {
      const a = obs[i], b2 = obs[j];
      if (a.isFragment || b2.isFragment) continue;
      const dx = b2.x - a.x, dy = b2.y - a.y;
      const dist = Math.hypot(dx, dy);
      const minD = a.size + b2.size;
      if (dist < minD && dist > 0.1) {
        const overlap = (minD - dist) / 2;
        const nx = dx / dist, ny = dy / dist;
        a.x -= nx * overlap; a.y -= ny * overlap;
        b2.x += nx * overlap; b2.y += ny * overlap;
        // Exchange velocity components along collision normal (elastic-ish)
        const rvx = (b2.vx ?? 0) - (a.vx ?? 0);
        const rvy = (b2.vy ?? 0) - (a.vy ?? 0);
        const dot  = rvx * nx + rvy * ny;
        if (dot < 0) { // approaching
          const impulse = dot * 0.6;
          a.vx  = (a.vx  ?? 0) + nx * impulse;
          a.vy  = (a.vy  ?? 0) + ny * impulse;
          b2.vx = (b2.vx ?? 0) - nx * impulse;
          b2.vy = (b2.vy ?? 0) - ny * impulse;
          // Add spin on collision — capped so rocks don't go nutty
          const MAX_ROT = 1.8;
          a.rotSpeed  = Math.max(-MAX_ROT, Math.min(MAX_ROT, (a.rotSpeed  ?? 0) + (Math.random() - 0.5) * 0.4));
          b2.rotSpeed = Math.max(-MAX_ROT, Math.min(MAX_ROT, (b2.rotSpeed ?? 0) + (Math.random() - 0.5) * 0.4));
        }
      }
    }
  }

  // Process respawn queue — tick timers and spawn when ready
  if (gs._obstacleRespawnQueue?.length) {
    const b = getArenaBounds(gs);
    gs._obstacleRespawnQueue = gs._obstacleRespawnQueue.filter(entry => {
      entry.timer -= dt;
      if (entry.timer > 0) return true; // still waiting

      // Spawn away from all players (min 200px)
      const allChars = [...(gs.players ?? []), ...(gs.enemies ?? [])].filter(ch => ch?.alive);
      const size = entry.isLarge ? 55 + Math.random() * 45 : 18 + Math.random() * 22;
      const margin = size + 80;
      let ox, oy, attempts = 0;
      do {
        ox = b.x + margin + Math.random() * Math.max(10, b.w - margin * 2);
        oy = b.y + margin + Math.random() * Math.max(10, b.h - margin * 2);
        attempts++;
      } while (attempts < 12 && allChars.some(ch => Math.hypot(ch.x - ox, ch.y - oy) < 200));

      const sides = entry.isLarge ? 4 + Math.floor(Math.random() * 4) : 3 + Math.floor(Math.random() * 3);
      const verts = [];
      for (let v = 0; v < sides; v++) {
        const angle = (v / sides) * Math.PI * 2 - Math.PI / 2;
        const r = size * (0.75 + Math.random() * 0.5);
        verts.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r });
      }
      const pathType = ['drift', 'orbit', 'bounce'][Math.floor(Math.random() * 3)];
      const hp = entry.isLarge ? 5 + Math.floor(Math.random() * 6) : 2;
      gs.obstacles.push({
        x: ox, y: oy, baseX: ox, baseY: oy,
        verts, size, sides, pathType,
        orbitR: 60 + Math.random() * 120,
        orbitSpd: (Math.random() < 0.5 ? 1 : -1) * (0.2 + Math.random() * 0.3),
        orbitPhase: Math.random() * Math.PI * 2,
        vx: (Math.random() < 0.5 ? 1 : -1) * (8 + Math.random() * 12),
        vy: (Math.random() < 0.5 ? 1 : -1) * (8 + Math.random() * 12),
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.3,
        color:     `hsl(${200 + Math.random() * 60}, 20%, ${12 + Math.random() * 10}%)`,
        edgeColor: `hsl(${180 + Math.random() * 80}, 60%, ${40 + Math.random() * 20}%)`,
        hp, maxHp: hp, isFragment: false, _dmgCd: 0,
        _spawnFade: 0,   // start invisible, fade in over ~2s
      });
      return false; // remove from queue
    });
  }
}

// Push a character out of any overlapping obstacle, and transfer a small impulse to the obstacle.
// Heavier (slower) heroes push harder. Sprinting into an obstacle adds a velocity-scaled bonus.
// Obstacles have high mass so movement stays subtle even at full sprint.
function resolveObstacleCollisions(c, gs) {
  if (!gs.obstacles || c.stunned > 0) return;
  const CULL = 400;
  for (let _oi = gs.obstacles.length - 1; _oi >= 0; _oi--) {
    const ob = gs.obstacles[_oi];
    const dx = c.x - ob.x;
    const dy = c.y - ob.y;
    if (Math.abs(dx) > CULL || Math.abs(dy) > CULL) continue;
    const dist = Math.hypot(dx, dy);
    const minDist = ob.size + c.radius;
    if (dist < minDist && dist > 0) {
      const push = (minDist - dist) / dist;
      c.x += dx * push;
      c.y += dy * push;

      const charSpeed = c.speed ?? 4.0;
      const heaviness = 1 - (charSpeed - 2.8) / (6.2 - 2.8);
      const basePush = 6 + heaviness * 14;

      const nx = -dx / dist, ny = -dy / dist;
      const velX = c.velX ?? c.vx ?? 0;
      const velY = c.velY ?? c.vy ?? 0;
      const approachSpeed = Math.max(0, velX * nx + velY * ny);
      const normalSpeed = c.speed * 2.2;
      const velocityFactor = Math.min(1, approachSpeed / normalSpeed);

      const velocityBonus = velocityFactor * 18;
      const totalImpulse = basePush + velocityBonus;

      ob.vx = (ob.vx ?? 0) + nx * totalImpulse;
      ob.vy = (ob.vy ?? 0) + ny * totalImpulse;

      if (ob.hp !== null && velocityFactor > 0.55 && (ob._dmgCd ?? 0) <= 0) {
        const sprintDmg = Math.round(heaviness * velocityFactor * 2);
        if (sprintDmg > 0) {
          ob.hp = Math.max(0, ob.hp - sprintDmg);
          ob._dmgCd = 0.5;
          ob._hitFlash = 0.2;
          ob._cracks = null; // invalidate crack cache
          ob.rotSpeed = Math.max(-1.8, Math.min(1.8, (ob.rotSpeed ?? 0) + (Math.random() - 0.5) * velocityFactor * 0.6));
          if (c.isPlayer) Audio.sfx.sprintHit();
          if (ob.hp <= 0 && gs) {
            // Tutorial: track large rock destroyed by player
            if (gs.isTutorial && c.isPlayer && ob.size >= 40) {
              if (!gs.tutorial) gs.tutorial = {};
              gs.tutorial._rockDestroyed = true;
            }
            spawnObstacleFragments(ob, gs); maybeDropItem(ob, gs); Audio.sfx.rockDestroy(); if (!ob.isFragment) scheduleObstacleRespawn(ob.size >= 40, gs); gs.obstacles.splice(_oi, 1); break; // obstacle removed, skip rest for this char
          }
        }
      }

      const MAX_OB_SPEED = 60;
      const obSpd = Math.hypot(ob.vx, ob.vy);
      if (obSpd > MAX_OB_SPEED) {
        ob.vx = (ob.vx / obSpd) * MAX_OB_SPEED;
        ob.vy = (ob.vy / obSpd) * MAX_OB_SPEED;
      }
    }
  }
}

// Random item drop when a rock is destroyed — 66% chance, large rocks only, health pots only
function maybeDropItem(ob, gs) {
  if (!gs || ob.isFragment) return;       // fragments never drop
  if (ob.size < 40) return;              // small rocks don't drop either
  if (Math.random() > 0.50) return;      // 50% drop chance
  const angle = Math.random() * Math.PI * 2;
  const speed = 30 + Math.random() * 40;
  gs.items.push({
    type:   'healthpack',
    slotId: null,
    x: ob.x, y: ob.y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    icon:  '💊',
    color: '#ff4488',
    _fromRock: true,
  });
}

// Spawn 2–3 small fragment obstacles from a destroyed large one
function spawnObstacleFragments(ob, gs) {
  // Small obstacles (size < 45) just puff — no child fragments
  if (ob.size < 45) {
    gs.effects.push({ x: ob.x, y: ob.y, r: 0, maxR: ob.size * 2.5, life: 0.3, maxLife: 0.3, color: ob.edgeColor });
    return;
  }
  const count = 2 + Math.floor(Math.random() * 2); // 2–3 chunks
  for (let i = 0; i < count; i++) {
    const fragSize = 14 + Math.random() * 18; // small: 14–32
    const sides = 3 + Math.floor(Math.random() * 3); // 3–5 sides
    const verts = [];
    for (let v = 0; v < sides; v++) {
      const angle = (v / sides) * Math.PI * 2 - Math.PI / 2;
      const r = fragSize * (0.65 + Math.random() * 0.5);
      verts.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r });
    }
    // Scatter outward from parent
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.8;
    const scatterDist = ob.size * 0.6;
    const fx = ob.x + Math.cos(angle) * scatterDist;
    const fy = ob.y + Math.sin(angle) * scatterDist;
    gs.obstacles.push({
      x: fx, y: fy,
      baseX: fx, baseY: fy,
      verts, size: fragSize, sides,
      pathType: 'drift',
      orbitR: 0, orbitSpd: 0, orbitPhase: 0,
      vx: Math.cos(angle) * (10 + Math.random() * 14),
      vy: Math.sin(angle) * (10 + Math.random() * 14),
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.8,
      color: ob.color,
      edgeColor: ob.edgeColor,
      hp: null, maxHp: null, isFragment: true,
    });
  }
  // Burst effect
  gs.effects.push({ x: ob.x, y: ob.y, r: 0, maxR: ob.size * 2, life: 0.4, maxLife: 0.4, color: ob.edgeColor });
}

// Returns true if a projectile hits any obstacle. Also handles hp damage and fragmentation.
function projectileHitsObstacle(proj, gs) {
  if (!gs.obstacles) return false;
  if (proj.isAutoAttack) return false; // auto attacks pass through rocks — only rock buster interacts
  for (let i = gs.obstacles.length - 1; i >= 0; i--) {
    const ob = gs.obstacles[i];
    const dx = proj.x - ob.x;
    const dy = proj.y - ob.y;
    if (dx*dx + dy*dy < (ob.size + proj.radius) * (ob.size + proj.radius)) {
      // Damage destructible obstacles
      if (ob.hp !== null) {
        if ((ob._dmgCd ?? 0) > 0 && !proj.isRockBuster) return true; // blocked — absorb projectile but no damage (rock buster always lands)
        ob.hp -= proj.isFocusShot ? 2 : proj.isRockBuster ? 1 : 1;
        ob._dmgCd = 0.5;
        ob._hitFlash = 0.3;
        ob._cracks = null; // invalidate crack cache so it regenerates at new damage tier
        if (ob.hp > 0) Audio.sfx.rockHit();
        // Rock Buster: show float text on impact, not on shot
        if (proj.isRockBuster && proj.casterRef) {
          showFloatText(proj.x, proj.y - 20, 'ROCK BUSTER!', '#ff9933', proj.casterRef);
        }
        if (ob.hp <= 0) {
          // Tutorial: track large rock destroyed by player projectile
          if (gs.isTutorial && proj.casterRef?.isPlayer && ob.size >= 40) {
            if (!gs.tutorial) gs.tutorial = {};
            gs.tutorial._rockDestroyed = true;
          }
          spawnObstacleFragments(ob, gs);
          maybeDropItem(ob, gs);
          Audio.sfx.rockDestroy();
          if (!ob.isFragment) scheduleObstacleRespawn(ob.size >= 40, gs);
          gs.obstacles.splice(i, 1);
        }
      }
      return true;
    }
  }
  return false;
}

// Color helpers for 3D obstacle bevel
function lightenColor(hex, amount) {
  try {
    const n = parseInt(hex.replace('#',''), 16);
    const r = Math.min(255, ((n>>16)&255) + Math.round(255*amount));
    const g = Math.min(255, ((n>>8)&255)  + Math.round(255*amount));
    const b = Math.min(255, (n&255)       + Math.round(255*amount));
    return `rgb(${r},${g},${b})`;
  } catch { return hex; }
}
function darkenColor(hex, amount) {
  try {
    const n = parseInt(hex.replace('#',''), 16);
    const r = Math.max(0, ((n>>16)&255) - Math.round(255*amount));
    const g = Math.max(0, ((n>>8)&255)  - Math.round(255*amount));
    const b = Math.max(0, (n&255)       - Math.round(255*amount));
    return `rgb(${r},${g},${b})`;
  } catch { return hex; }
}

function drawObstacles(gs) {
  if (!gs.obstacles) return;
  const t = gs.time ?? 0;

  // Light direction (fixed world-space) — upper-left
  const LIGHT_ANGLE = -Math.PI * 0.35; // ~-63 degrees
  const LIGHT_X = Math.cos(LIGHT_ANGLE);
  const LIGHT_Y = Math.sin(LIGHT_ANGLE);

  for (const ob of gs.obstacles) {
    const flash = ob._hitFlash ?? 0;
    const pulse = 0.4 + 0.2 * Math.sin(t * 1.5 + (ob.orbitPhase ?? 0));
    const spawnFade = ob._spawnFade ?? 1;

    // ── Drop shadow — rotates WITH the rock, offset in light direction ──────
    ctx.save();
    ctx.translate(ob.x, ob.y);
    ctx.rotate(ob.rotation);
    if (spawnFade < 1) { ctx.scale(0.2 + spawnFade * 0.8, 0.2 + spawnFade * 0.8); }

    // ── Drop shadow using shadowBlur (GPU-accelerated, no ctx.filter) ──
    const shadowDist = ob.size * 0.55;
    const localShadowX = Math.cos(LIGHT_ANGLE - ob.rotation) * shadowDist;
    const localShadowY = Math.sin(LIGHT_ANGLE - ob.rotation) * shadowDist;
    ctx.globalAlpha = (0.35 + 0.06 * pulse) * spawnFade;
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur  = ob.size * 0.55;
    ctx.shadowOffsetX = localShadowX;
    ctx.shadowOffsetY = localShadowY;
    ctx.beginPath();
    ctx.moveTo(ob.verts[0].x, ob.verts[0].y);
    for (let i = 1; i < ob.verts.length; i++) ctx.lineTo(ob.verts[i].x, ob.verts[i].y);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    ctx.restore();

    // ── Main rock body ────────────────────────────────────────────────────────
    ctx.save();
    ctx.translate(ob.x, ob.y);
    ctx.rotate(ob.rotation);
    if (spawnFade < 1) {
      ctx.scale(0.2 + spawnFade * 0.8, 0.2 + spawnFade * 0.8);
      ctx.globalAlpha = spawnFade;
    }

    // Clip to rock shape for all interior detail
    ctx.beginPath();
    ctx.moveTo(ob.verts[0].x, ob.verts[0].y);
    for (let i = 1; i < ob.verts.length; i++) ctx.lineTo(ob.verts[i].x, ob.verts[i].y);
    ctx.closePath();
    ctx.save();
    ctx.clip();

    // Invalidate gradient cache if rock has rotated (gradients are in local transform space)
    const wantFlash = flash > 0;
    const rotBucket = Math.round(ob.rotation * 4); // ~15° buckets
    if (ob._gradRotBucket !== rotBucket) {
      ob._faceGrad = null; ob._specGrad = null; ob._aoGrad = null;
      ob._gradRotBucket = rotBucket;
    }
    if (!ob._faceGrad || ob._faceGradFlash !== wantFlash) {
      const litX = -ob.size * 0.7, litY = -ob.size * 0.7;
      const darkX = ob.size * 0.5,  darkY = ob.size * 0.6;
      const g = ctx.createLinearGradient(litX, litY, darkX, darkY);
      g.addColorStop(0,   wantFlash ? ob.edgeColor : lightenColor(ob.color, 0.38));
      g.addColorStop(0.4, wantFlash ? ob.edgeColor : lightenColor(ob.color, 0.10));
      g.addColorStop(0.7, wantFlash ? ob.edgeColor : ob.color);
      g.addColorStop(1,   wantFlash ? ob.edgeColor : darkenColor(ob.color, 0.45));
      ob._faceGrad = g; ob._faceGradFlash = wantFlash;
    }
    ctx.fillStyle = ob._faceGrad;
    ctx.globalAlpha = wantFlash ? 0.75 : 1;
    ctx.beginPath();
    ctx.moveTo(ob.verts[0].x, ob.verts[0].y);
    for (let i = 1; i < ob.verts.length; i++) ctx.lineTo(ob.verts[i].x, ob.verts[i].y);
    ctx.closePath();
    ctx.fill();

    // Surface cracks — natural fractures radiating from impact points with Y-fork branching
    if (!ob.isFragment && ob.size > 28 && ob.hp !== null) {
      const hpFrac  = Math.max(0, ob.hp / ob.maxHp);
      const dmgFrac = 1 - hpFrac;

      if (dmgFrac > 0.08) {
        // Generate stable crack geometry on first hit — stays consistent between frames
        // Real cracks: start at impact point, branch Y-forks, secondaries are shorter
        if (!ob._cracks || ob._crackDmgTier !== Math.floor(dmgFrac * 4)) {
          ob._crackDmgTier = Math.floor(dmgFrac * 4);
          const seed = ob.orbitPhase ?? 0;
          ob._cracks = [];
          const crackCount = Math.min(4, 1 + Math.floor(dmgFrac * 4.5));

          for (let ci = 0; ci < crackCount; ci++) {
            // Impact origin — near surface edge, not dead centre
            const impactAng = seed * 2.1 + ci * (Math.PI * 2 / Math.max(crackCount, 3)) + ci * 0.37;
            const impactR   = ob.size * (0.55 + ((seed * 2.7 + ci * 1.3) % 0.35));
            const ox = Math.cos(impactAng) * impactR;
            const oy = Math.sin(impactAng) * impactR;

            // Primary crack runs toward centre-ish with wobble
            const primaryDir = impactAng + Math.PI + ((seed * 3.3 + ci) % 1 - 0.5) * 0.9;
            const primaryLen = ob.size * (0.4 + dmgFrac * 0.35);
            const segs = 3 + Math.floor(dmgFrac * 2);
            const segLen = primaryLen / segs;
            const jitter = 0.25 + dmgFrac * 0.35;

            const pts = [{ x: ox, y: oy }];
            let cx = ox, cy = oy;
            for (let s = 0; s < segs; s++) {
              const dir = primaryDir + ((seed * 5.1 + ci * 2.9 + s * 1.7) % 1 - 0.5) * jitter * 2;
              cx += Math.cos(dir) * segLen;
              cy += Math.sin(dir) * segLen;
              pts.push({ x: cx, y: cy });
            }
            ob._cracks.push({ pts, primary: true });

            // Y-fork branches — split off at ~30° from a mid-point on the primary
            if (dmgFrac > 0.3) {
              const forkPt = Math.floor(segs * 0.5);
              for (const forkDir of [-1, 1]) {
                const fp = pts[forkPt];
                const branchDir = primaryDir + forkDir * (0.4 + ((seed + ci) % 0.3));
                const branchLen = primaryLen * (0.35 + dmgFrac * 0.2);
                const bSegs = 2;
                const bPts = [fp];
                let bx = fp.x, by = fp.y;
                for (let bs = 0; bs < bSegs; bs++) {
                  const bd = branchDir + ((seed * 4.3 + ci + bs * 2.1) % 1 - 0.5) * jitter;
                  bx += Math.cos(bd) * branchLen / bSegs;
                  by += Math.sin(bd) * branchLen / bSegs;
                  bPts.push({ x: bx, y: by });
                }
                ob._cracks.push({ pts: bPts, primary: false });
                if (forkDir === 1) break; // only one fork at < heavy damage
              }
            }
          }
        }

        if (!ob._crackColor)      ob._crackColor      = darkenColor(ob.color, 0.72);
        if (!ob._crackColorLight) ob._crackColorLight = 'rgba(255,255,255,0.12)';

        const crackAlpha = 0.22 + dmgFrac * 0.55;
        const crackWidth = 0.6 + dmgFrac * 1.6;

        // Near-death: rocks start to visually separate — widen crack gap, darken interior
        const separation = dmgFrac > 0.75 ? (dmgFrac - 0.75) * 3.5 : 0;

        for (const crack of ob._cracks) {
          const w = crack.primary ? crackWidth : crackWidth * 0.55;
          const a = crack.primary ? crackAlpha : crackAlpha * 0.6;
          ctx.lineWidth   = w + separation * (crack.primary ? 1.2 : 0.5);
          ctx.globalAlpha = a;
          ctx.strokeStyle = ob._crackColor;
          ctx.beginPath();
          ctx.moveTo(crack.pts[0].x, crack.pts[0].y);
          for (let pi = 1; pi < crack.pts.length; pi++) ctx.lineTo(crack.pts[pi].x, crack.pts[pi].y);
          ctx.stroke();

          // Bright highlight beside primary crack for depth
          if (crack.primary && dmgFrac > 0.4) {
            ctx.globalAlpha = a * 0.22;
            ctx.strokeStyle = ob._crackColorLight;
            ctx.lineWidth = w * 0.4;
            ctx.beginPath();
            ctx.moveTo(crack.pts[0].x + 0.8, crack.pts[0].y - 0.5);
            for (let pi = 1; pi < crack.pts.length; pi++) ctx.lineTo(crack.pts[pi].x + 0.8, crack.pts[pi].y - 0.5);
            ctx.stroke();
            ctx.lineWidth = crackWidth;
          }
        }

        // Near-death: shadow fill in crack gaps to simulate separation
        if (separation > 0) {
          ctx.globalAlpha = Math.min(0.55, separation * 0.4);
          ctx.strokeStyle = 'rgba(0,0,0,0.9)';
          for (const crack of ob._cracks) {
            if (!crack.primary) continue;
            ctx.lineWidth = separation * 2.5;
            ctx.beginPath();
            ctx.moveTo(crack.pts[0].x, crack.pts[0].y);
            for (let pi = 1; pi < crack.pts.length; pi++) ctx.lineTo(crack.pts[pi].x, crack.pts[pi].y);
            ctx.stroke();
          }
        }
      }
    }

    // Specular hotspot — cached
    if (!ob._specGrad || ob._specGradFlash !== wantFlash) {
      const specX = -ob.size * 0.28, specY = -ob.size * 0.30;
      const g = ctx.createRadialGradient(specX, specY, 0, specX, specY, ob.size * 0.38);
      g.addColorStop(0,   `rgba(255,255,255,${wantFlash ? 0.55 : 0.22})`);
      g.addColorStop(0.5, `rgba(255,255,255,${wantFlash ? 0.15 : 0.06})`);
      g.addColorStop(1,   'rgba(255,255,255,0)');
      ob._specGrad = g; ob._specGradFlash = wantFlash;
    }
    ctx.fillStyle = ob._specGrad;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(ob.verts[0].x, ob.verts[0].y);
    for (let i = 1; i < ob.verts.length; i++) ctx.lineTo(ob.verts[i].x, ob.verts[i].y);
    ctx.closePath();
    ctx.fill();

    // AO vignette — cached (never changes per obstacle)
    if (!ob._aoGrad) {
      const g = ctx.createRadialGradient(0, 0, ob.size * 0.35, 0, 0, ob.size * 0.95);
      g.addColorStop(0,   'rgba(0,0,0,0)');
      g.addColorStop(0.7, 'rgba(0,0,0,0)');
      g.addColorStop(1,   'rgba(0,0,0,0.38)');
      ob._aoGrad = g;
    }
    ctx.fillStyle = ob._aoGrad;
    ctx.beginPath();
    ctx.moveTo(ob.verts[0].x, ob.verts[0].y);
    for (let i = 1; i < ob.verts.length; i++) ctx.lineTo(ob.verts[i].x, ob.verts[i].y);
    ctx.closePath();
    ctx.fill();

    ctx.restore(); // unclip

    // Bevel highlight — lit edges (top-left half of verts)
    if (!ob._bevelLit)  ob._bevelLit  = lightenColor(ob.color, 0.60);
    if (!ob._bevelDark) ob._bevelDark = darkenColor(ob.color, 0.65);
    const bevelCount = Math.ceil(ob.verts.length / 2);
    ctx.globalAlpha = flash > 0 ? 0.9 : 0.55;
    ctx.strokeStyle = flash > 0 ? '#ffffff' : ob._bevelLit;
    ctx.lineWidth = flash > 0 ? 2.5 : 2.0;
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.moveTo(ob.verts[0].x, ob.verts[0].y);
    for (let i = 1; i < bevelCount; i++) ctx.lineTo(ob.verts[i].x, ob.verts[i].y);
    ctx.stroke();

    // Bevel shadow — dark edges (bottom-right half)
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = ob._bevelDark;
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(ob.verts[bevelCount % ob.verts.length].x, ob.verts[bevelCount % ob.verts.length].y);
    for (let i = bevelCount + 1; i < ob.verts.length; i++) ctx.lineTo(ob.verts[i].x, ob.verts[i].y);
    ctx.lineTo(ob.verts[0].x, ob.verts[0].y);
    ctx.stroke();

    // Edge glow
    ctx.globalAlpha = 0.5 + pulse * 0.45;
    ctx.strokeStyle = ob.edgeColor;
    ctx.lineWidth = flash > 0 ? 2.5 : 1.5;
    ctx.shadowColor = ob.edgeColor; ctx.shadowBlur = flash > 0 ? 16 : 8;
    ctx.beginPath();
    ctx.moveTo(ob.verts[0].x, ob.verts[0].y);
    for (let i = 1; i < ob.verts.length; i++) ctx.lineTo(ob.verts[i].x, ob.verts[i].y);
    ctx.closePath();
    ctx.stroke();

    ctx.restore();

    // HP counter — drawn in world space (no rotation), centered on obstacle
    if (ob.hp !== null && !ob.isFragment) {
      ctx.save();
      ctx.translate(ob.x, ob.y);
      const hpFrac = ob.hp / ob.maxHp;
      const hpColor = flash > 0 ? '#ffffff'
        : hpFrac > 0.5 ? ob.edgeColor
        : hpFrac > 0.25 ? '#ffaa33'
        : '#ff4444';
      const fontSize = Math.max(10, Math.round(ob.size * 0.32));
      ctx.globalAlpha = 0.92;
      ctx.font = `bold ${fontSize}px 'Orbitron', monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#000';
      ctx.fillText(ob.hp, 1.5, 1.5);
      ctx.fillStyle = hpColor;
      ctx.fillText(ob.hp, 0, 0);
      ctx.restore();

      if (flash > 0) ob._hitFlash = Math.max(0, flash - (1/60));
    }
  }
}

// ========== SHRINKING ARENA + WARP GATES ==========
const ARENA_MIN_SCALE = 0.40;
const GATE_SIZE_BASE  = 320;
const GATE_SIZE_MIN   = 200;

function initArenaGates(gs) {
  gs.arena = { scale: 1.0 };
  gs.gates = [0,1,2,3].map(() => {
    return Array.from({length: 3}, (_, i) => {
      // Four distinct personalities with clearly different feels
      const r = Math.random();
      let velMult, personality;
      if (r < 0.18) {
        velMult = 0.12 + Math.random() * 0.10; // barely drifting — near-static
        personality = 'slow';
      } else if (r < 0.55) {
        velMult = 0.7 + Math.random() * 0.5;   // normal
        personality = 'normal';
      } else if (r < 0.82) {
        velMult = 2.0 + Math.random() * 1.2;   // fast pacer — clearly different
        personality = 'fast';
      } else {
        velMult = 1.2 + Math.random() * 0.8;   // erratic — mid speed but random reversals
        personality = 'erratic';
      }
      return {
        pos: Math.max(0.15, Math.min(0.85, (i + 0.5) / 3 + (Math.random() - 0.5) * 0.1)),
        vel: (Math.random() < 0.5 ? 1 : -1) * (0.03 + Math.random() * 0.03),
        velMult,
        personality,
        _burstTimer: 0,
        _pauseTimer: 0,
        _erraticTimer: 0,
      };
    });
  });
}

function updateArena(gs, dt) {
  if (!gs.gates) initArenaGates(gs);

  // ── Arena progress — drives shrink, gate count, gate speed ──
  // Three modes depending on match settings:
  //   Normal:         time-based  (progress = time / MATCH_DURATION)
  //   Infinite time:  kill-based  (progress = totalKills / maxKills)
  //   Both infinite:  ebb cycle   (slow oscillation so arena still feels alive)
  let progress;
  const timeInfinite = !isFinite(MATCH_DURATION);
  const killsInfinite = (gs.maxKills ?? 0) >= 999;

  if (!timeInfinite) {
    progress = Math.min(1, gs.time / MATCH_DURATION);
  } else if (!killsInfinite) {
    const totalKills = Object.values(gs.teamKills ?? {}).reduce((a, b) => a + b, 0);
    progress = Math.min(1, totalKills / gs.maxKills);
  } else {
    // Both unlimited — ebb in and out on a 90s full cycle (45s shrink, 45s expand)
    // Clamp between 0.05 and 0.65 so it never fully closes or stays fully open
    const cycle = (gs.time % 90) / 90; // 0→1 over 90s
    const raw = cycle < 0.5 ? cycle * 2 : (1 - cycle) * 2; // triangle wave 0→1→0
    progress = 0.05 + raw * 0.60;
  }

  gs.arena.scale = 1.0 - (1.0 - ARENA_MIN_SCALE) * progress;
  const targetGateCount = progress < 0.33 ? 3 : progress < 0.66 ? 2 : 1;
  const speedMult = 0.6 + progress * 1.9;
  gs.gates.forEach(edgeGates => {
    while (edgeGates.length > targetGateCount) {
      edgeGates.splice(Math.floor(Math.random() * edgeGates.length), 1);
    }
    const gateSize   = GATE_SIZE_BASE - (GATE_SIZE_BASE - GATE_SIZE_MIN) * progress;
    const ab         = getArenaBounds(gs);
    const edgeIdx    = gs.gates.indexOf(edgeGates);
    const edgePixels = (edgeIdx === 0 || edgeIdx === 2) ? ab.w : ab.h;
    const halfGate   = (gateSize / edgePixels) / 2;
    const minPos     = halfGate + 0.01;
    const maxPos     = 1 - halfGate - 0.01;

    edgeGates.forEach(g => {
      // Occasional burst (fast gates) or micro-pause (slow gates)
      g._burstTimer = Math.max(0, (g._burstTimer ?? 0) - dt);
      g._pauseTimer = Math.max(0, (g._pauseTimer ?? 0) - dt);
      g._erraticTimer = Math.max(0, (g._erraticTimer ?? 0) - dt);

      if (g.personality === 'erratic') {
        // Erratic gates randomly snap direction — unpredictable, keep players guessing
        if (g._erraticTimer <= 0) {
          g._erraticTimer = 0.4 + Math.random() * 1.8; // next reversal in 0.4–2.2s
          if (Math.random() < 0.65) g.vel = -g.vel;    // 65% chance to actually flip
        }
      } else {
        // Random events — fast gates occasionally burst, slow gates occasionally pause
        if (g._burstTimer <= 0 && g._pauseTimer <= 0) {
          const r = Math.random();
          if (r < 0.0008 * dt * 60) {
            g._burstTimer = 1.2 + Math.random() * 1.5;
          } else if (r < 0.0015 * dt * 60) {
            g._pauseTimer = 0.8 + Math.random() * 1.2;
          }
        }
      }
      const burstFactor = g._burstTimer > 0 ? 2.2 : 1.0;
      const pauseFactor = g._pauseTimer > 0 ? 0.0 : 1.0;
      const gMult = (g.velMult ?? 1.0) * burstFactor * pauseFactor;
      g.pos += g.vel * speedMult * gMult * dt;
      if (g.pos < minPos) { g.pos = minPos; g.vel =  Math.abs(g.vel); }
      if (g.pos > maxPos) { g.pos = maxPos; g.vel = -Math.abs(g.vel); }
    });

    // Gate-gate bounce — repel gates on the same edge so they never overlap
    const minGap = halfGate * 2;
    for (let a = 0; a < edgeGates.length; a++) {
      for (let b2 = a + 1; b2 < edgeGates.length; b2++) {
        const ga = edgeGates[a], gb = edgeGates[b2];
        const gap = Math.abs(ga.pos - gb.pos);
        if (gap < minGap) {
          const tmp = ga.vel; ga.vel = gb.vel; gb.vel = tmp;
          const push = (minGap - gap) / 2 + 0.001;
          if (ga.pos < gb.pos) { ga.pos -= push; gb.pos += push; }
          else                 { ga.pos += push; gb.pos -= push; }
        }
      }
    }
  });
}

function getArenaBounds(gs) {
  const s  = gs.arena?.scale ?? 1.0;
  const W  = 3200, H = 1800;
  const iw = W * s, ih = H * s;
  return { x: (W-iw)/2, y: (H-ih)/2, x2: (W+iw)/2, y2: (H+ih)/2, w: iw, h: ih };
}

// ── Gate-aware aim delta for AI ───────────────────────────────────────────
// Like warpDelta but only wraps through an edge if there's actually a gate there.
// Prevents AI from firing through solid walls — they must use a gate.
function safeAimDelta(ax, ay, bx, by, gs) {
  const W = 3200, H = 1800;
  const rawDx = bx - ax, rawDy = by - ay;
  const wrapDx = rawDx > 0 ? rawDx - W : rawDx + W;
  const wrapDy = rawDy > 0 ? rawDy - H : rawDy + H;

  // Determine best dx — direct or wrapping through left/right edge
  let useDx = rawDx;
  if (Math.abs(wrapDx) < Math.abs(rawDx) && gs?.gates) {
    // Wrapping through horizontal edge — check if shooter's Y is in a gate on that edge
    const ab = getArenaBounds(gs);
    const t = (ay - ab.y) / ab.h; // normalised Y position
    const edgeGates = wrapDx < 0 ? gs.gates[3] : gs.gates[1]; // left or right edge
    const gateSize = GATE_SIZE_BASE - (GATE_SIZE_BASE - GATE_SIZE_MIN) * (gs.arena?.scale ? 1 - gs.arena.scale : 0);
    if (inGate(edgeGates, t, gateSize, ab.h)) useDx = wrapDx;
  }

  // Determine best dy — direct or wrapping through top/bottom edge
  let useDy = rawDy;
  if (Math.abs(wrapDy) < Math.abs(rawDy) && gs?.gates) {
    const ab = getArenaBounds(gs);
    const t = (ax - ab.x) / ab.w; // normalised X position
    const edgeGates = wrapDy < 0 ? gs.gates[0] : gs.gates[2]; // top or bottom edge
    const gateSize = GATE_SIZE_BASE - (GATE_SIZE_BASE - GATE_SIZE_MIN) * (gs.arena?.scale ? 1 - gs.arena.scale : 0);
    if (inGate(edgeGates, t, gateSize, ab.w)) useDy = wrapDy;
  }

  const dist = Math.sqrt(useDx * useDx + useDy * useDy) || 1;
  return { dx: useDx, dy: useDy, dist };
}

function inGate(edgeGates, t, gateSize, edgeLen) {
  const halfGate = (gateSize / edgeLen) / 2;
  return edgeGates.some(g => Math.abs(t - g.pos) < halfGate);
}

// Pick a random position (normalised 0-1) within a random gate on edgeGates.
// Returns null if no gates exist.
function randomGateExit(edgeGates, gateSize, edgeLen) {
  if (!edgeGates || edgeGates.length === 0) return null;
  const g = edgeGates[Math.floor(Math.random() * edgeGates.length)];
  const halfGate = (gateSize / edgeLen) / 2;
  // Random offset: ±80% of half-gate so we never land right at the edge of the portal
  const scatter = (Math.random() * 2 - 1) * halfGate * 0.8;
  return Math.max(0.02, Math.min(0.98, g.pos + scatter));
}

function warpChar(c, W, H) {
  // Characters inside the Rift pocket are clamped by _updateRiftDimension — skip world warp
  if (c._inRift) return;
  const gs = gameState;
  if (!gs || !gs.gates) {
    if (c.x < 0) c.x += W; if (c.x > W) c.x -= W;
    if (c.y < 0) c.y += H; if (c.y > H) c.y -= H;
    return;
  }
  const b = getArenaBounds(gs);
  const progress = (1.0 - (gs.arena?.scale ?? 1.0)) / (1.0 - ARENA_MIN_SCALE);
  const gateSize = GATE_SIZE_BASE - (GATE_SIZE_BASE - GATE_SIZE_MIN) * progress;
  const BOUNCE_VEL = 4.5;
  const WARP_CD = 4.5;
  const RETURN_WINDOW = 1.5;

  const now = performance.now() / 1000;
  const warpOnCooldown = (now - (c._lastWarp || 0)) < WARP_CD;

  // ── Helper: place character back through return gate ─────────────────
  function _doReturnWarp(exitEdgeIdx, tPos) {
    // exitEdgeIdx is the edge they originally exited through — return goes back there
    // tPos is the normalised gate position to re-enter at
    const edgeLenH = b.h, edgeLenW = b.w;
    switch (exitEdgeIdx) {
      case 3: c.x = b.x + c.radius;  c.y = b.y + tPos * edgeLenH; break; // left edge
      case 1: c.x = b.x2 - c.radius; c.y = b.y + tPos * edgeLenH; break; // right edge
      case 0: c.y = b.y2 - c.radius; c.x = b.x + tPos * edgeLenW; break; // top edge
      case 2: c.y = b.y  + c.radius; c.x = b.x + tPos * edgeLenW; break; // bottom edge
    }
    c._lastWarp = now;
    c._returnWindowTimer = 0;
    c._returnGateEdge = undefined;
    c._returnGateT    = undefined;
    PASSIVES[c.hero?.id]?.onWarp?.(c);
    if (c.isPlayer) {
      Audio.sfx.warpReturn();
      // Return warp flash — teal/cyan, slightly smaller than normal warp
      if (gs?.effects) {
        gs.effects.push({ x: c.x, y: c.y, r: 0, maxR: 90, life: 0.35, maxLife: 0.35, color: '#44ffcc', ring: true });
      }
      showFloatText(c.x, c.y - 40, 'RETURN!', '#44ffcc', c);
      if (gs.isTutorial) { gs.tutorial = gs.tutorial || {}; gs.tutorial._warpReturn = true; }
    }
  }

  // ── Helper: standard first-time warp through gate ────────────────────
  function _doWarp(fromEdgeIdx, toEdgeGates, tPos, isHoriz) {
    const exitT = randomGateExit(toEdgeGates, gateSize, isHoriz ? b.w : b.h);
    // Place on opposite side
    switch (fromEdgeIdx) {
      case 3: c.x = b.x2 - c.radius; if (exitT !== null) c.y = b.y + exitT * b.h; break;
      case 1: c.x = b.x  + c.radius; if (exitT !== null) c.y = b.y + exitT * b.h; break;
      case 0: c.y = b.y2 - c.radius; if (exitT !== null) c.x = b.x + exitT * b.w; break;
      case 2: c.y = b.y  + c.radius; if (exitT !== null) c.x = b.x + exitT * b.w; break;
    }
    // Store return-gate info
    c._returnWindowTimer = RETURN_WINDOW;
    c._returnGateEdge    = fromEdgeIdx; // return through the edge they just exited
    c._returnGateT       = tPos;         // at the exact gate they used
    c._lastWarp = now;
    PASSIVES[c.hero?.id]?.onWarp?.(c);
    if (c.isPlayer) {
      Audio.sfx.warp();
      // Warp flash — expanding ring burst at exit point
      if (gs?.effects) {
        gs.effects.push({ x: c.x, y: c.y, r: 0, maxR: 120, life: 0.4, maxLife: 0.4, color: '#00eeff', ring: true });
        gs.effects.push({ x: c.x, y: c.y, r: 0, maxR: 70,  life: 0.25, maxLife: 0.25, color: '#ffffff', ring: true });
      }
      if (gs.isTutorial) { gs.tutorial = gs.tutorial || {}; gs.tutorial._warpUsed = true; }
    }
  }

  function _bounce(axis, dir) {
    if (axis === 'x') { c.x = dir > 0 ? b.x + c.radius : b.x2 - c.radius; c.velX = dir * (Math.abs(c.velX) * 0.4 + BOUNCE_VEL); c.vx = c.velX; }
    else              { c.y = dir > 0 ? b.y + c.radius : b.y2 - c.radius; c.velY = dir * (Math.abs(c.velY) * 0.4 + BOUNCE_VEL); c.vy = c.velY; }
    if (c.isPlayer) { showFloatText(c.x, c.y-40, warpOnCooldown ? 'WARP COOLDOWN' : 'BLOCKED', '#ff4444', c); Audio.sfx.warpBlocked(); }
  }

  // ── Tick return window ────────────────────────────────────────────────
  if ((c._returnWindowTimer ?? 0) > 0) {
    c._returnWindowTimer -= (gameState?._dt ?? 1/60);
    if (c._returnWindowTimer <= 0) {
      // Window expired — start cooldown now
      c._lastWarp = now;
      c._returnWindowTimer = 0;
      c._returnGateEdge = undefined;
      c._returnGateT    = undefined;
    }
  }

  const inReturnWindow = (c._returnWindowTimer ?? 0) > 0;

  // ── Left edge ─────────────────────────────────────────────────────────
  if (c.x < b.x) {
    const t = (c.y - b.y) / b.h;
    if (inReturnWindow) {
      // Return through same gate we exited
      _doReturnWarp(c._returnGateEdge, c._returnGateT);
    } else if (!warpOnCooldown && t >= 0 && t <= 1 && inGate(gs.gates[3], t, gateSize, b.h)) {
      _doWarp(3, gs.gates[1], t, false);
    } else {
      _bounce('x', 1);
    }
  }
  // ── Right edge ────────────────────────────────────────────────────────
  if (c.x > b.x2) {
    const t = (c.y - b.y) / b.h;
    if (inReturnWindow) {
      _doReturnWarp(c._returnGateEdge, c._returnGateT);
    } else if (!warpOnCooldown && t >= 0 && t <= 1 && inGate(gs.gates[1], t, gateSize, b.h)) {
      _doWarp(1, gs.gates[3], t, false);
    } else {
      _bounce('x', -1);
    }
  }
  // ── Top edge ──────────────────────────────────────────────────────────
  if (c.y < b.y) {
    const t = (c.x - b.x) / b.w;
    if (inReturnWindow) {
      _doReturnWarp(c._returnGateEdge, c._returnGateT);
    } else if (!warpOnCooldown && t >= 0 && t <= 1 && inGate(gs.gates[0], t, gateSize, b.w)) {
      _doWarp(0, gs.gates[2], t, true);
    } else {
      _bounce('y', 1);
    }
  }
  // ── Bottom edge ───────────────────────────────────────────────────────
  if (c.y > b.y2) {
    const t = (c.x - b.x) / b.w;
    if (inReturnWindow) {
      _doReturnWarp(c._returnGateEdge, c._returnGateT);
    } else if (!warpOnCooldown && t >= 0 && t <= 1 && inGate(gs.gates[2], t, gateSize, b.w)) {
      _doWarp(2, gs.gates[0], t, true);
    } else {
      _bounce('y', -1);
    }
  }
}

function drawWarpEdges(gs) {
  if (!gs.gates) return;
  const b = getArenaBounds(gs);
  const progress = (1.0 - (gs.arena?.scale ?? 1.0)) / (1.0 - ARENA_MIN_SCALE);
  const gateSize = GATE_SIZE_BASE - (GATE_SIZE_BASE - GATE_SIZE_MIN) * progress;
  const now = performance.now() / 1000;
  const pulse = 0.55 + 0.45 * Math.sin(now * 3.5);

  // Darken out-of-bounds zones
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, 3200, b.y);
  ctx.fillRect(0, b.y2, 3200, 1800 - b.y2);
  ctx.fillRect(0, b.y, b.x, b.h);
  ctx.fillRect(b.x2, b.y, 3200 - b.x2, b.h);
  ctx.restore();

  // Gate portal segments — cached, only recompute when gate positions change significantly
  if (!gs._gateSegCache) gs._gateSegCache = { segs: [[],[],[],[]], lastPos: null };
  const cache = gs._gateSegCache;
  const curPos = gs.gates.map(e => e.map(g => g.pos).join(',')).join('|');
  if (curPos !== cache.lastPos) {
    cache.lastPos = curPos;
    gs.gates.forEach((edgeGates, ei) => {
      const edgeLen = (ei === 0 || ei === 2) ? b.w : b.h;
      const halfGate = (gateSize / edgeLen) / 2;
      cache.segs[ei] = edgeGates.map(g => [
        Math.max(0, g.pos - halfGate), Math.min(1, g.pos + halfGate)
      ]).sort((a, z) => a[0] - z[0]);
    });
  }
  const allSegs = cache.segs;

  const wallAlpha = 0.45 + 0.35 * progress;
  const wallColor = `rgba(255,80,80,${wallAlpha})`;
  const gateColor = `rgba(0,220,255,${0.7 + 0.3 * pulse})`;
  const gateGlowA = 0.22 * pulse;

  function drawEdge(edgeIdx, x1, y1, x2, y2, horiz) {
    const edgeLen = horiz ? b.w : b.h;
    const openSegs = allSegs[edgeIdx];

    // Batch all closed wall segments into one path
    ctx.strokeStyle = wallColor; ctx.lineWidth = 4; ctx.setLineDash([8,4]);
    ctx.beginPath();
    let cur = 0;
    for (let si = 0; si <= openSegs.length; si++) {
      const s = si < openSegs.length ? openSegs[si][0] : 1;
      if (cur < s - 0.001) {
        if (horiz) { ctx.moveTo(x1 + cur*edgeLen, y1); ctx.lineTo(x1 + s*edgeLen, y1); }
        else       { ctx.moveTo(x1, y1 + cur*edgeLen); ctx.lineTo(x1, y1 + s*edgeLen); }
      }
      if (si < openSegs.length) cur = openSegs[si][1];
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Gate portals — endpoint pillars + inward energy streams + particles
    for (let gi = 0; gi < openSegs.length; gi++) {
      const [s, e] = openSegs[gi];
      const g = gs.gates[edgeIdx][gi] ?? {};
      const gx1 = horiz ? x1 + s*edgeLen : x1, gy1 = horiz ? y1 : y1 + s*edgeLen;
      const gx2 = horiz ? x1 + e*edgeLen : x1, gy2 = horiz ? y1 : y1 + e*edgeLen;
      const gmx = (gx1+gx2)/2, gmy = (gy1+gy2)/2;
      const gLen = horiz ? (gx2 - gx1) : (gy2 - gy1);

      // Gate visual personality — color and intensity reflect speed
      const personality = g.personality ?? 'normal';
      const isErratic = personality === 'erratic';
      const isFast    = personality === 'fast';
      const isSlow    = personality === 'slow';
      // Erratic gates flicker; fast gates burn bright; slow gates dim
      const erraticFlicker = isErratic ? (0.6 + 0.4 * Math.abs(Math.sin(now * 9.3 + gi * 2.7))) : 1.0;
      const gSpeedIntensity = Math.min(1.6, (g.velMult ?? 1.0) * (g._burstTimer > 0 ? 1.8 : 1.0)) * erraticFlicker;
      // Color: slow=cool teal, normal=cyan, fast=hot white-blue, erratic=magenta-tinted
      const gateR = isSlow ? 0   : isFast ? 80  : isErratic ? 120 : 0;
      const gateG = isSlow ? 180 : isFast ? 200 : isErratic ? 160 : 220;
      const gateB = isSlow ? 200 : isFast ? 255 : isErratic ? 255 : 255;
      const gateAlpha = Math.min(1, (isSlow ? 0.45 : 0.65) + 0.3 * pulse) * erraticFlicker;
      const gateColorLocal = `rgba(${gateR},${gateG},${gateB},${gateAlpha})`;

      // Endpoint pillars — bright column at each gate end, perpendicular to wall
      const pillarLen = 20;
      for (const [epx, epy] of [[gx1, gy1], [gx2, gy2]]) {
        // Soft outer glow
        ctx.globalAlpha = 0.2 * pulse * gSpeedIntensity; ctx.strokeStyle = '#00ccff'; ctx.lineWidth = 10;
        ctx.beginPath();
        if (horiz) { ctx.moveTo(epx, epy - pillarLen); ctx.lineTo(epx, epy + pillarLen); }
        else        { ctx.moveTo(epx - pillarLen, epy); ctx.lineTo(epx + pillarLen, epy); }
        ctx.stroke();
        // Bright inner line
        ctx.globalAlpha = 0.85; ctx.strokeStyle = '#aaeeff'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        if (horiz) { ctx.moveTo(epx, epy - pillarLen + 2); ctx.lineTo(epx, epy + pillarLen - 2); }
        else        { ctx.moveTo(epx - pillarLen + 2, epy); ctx.lineTo(epx + pillarLen - 2, epy); }
        ctx.stroke();
        // Cap dot
        ctx.globalAlpha = 0.9; ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(epx, epy, 3, 0, Math.PI * 2); ctx.fill();
      }

      // Energy streams flowing inward — faster for fast/erratic gates
      const streamSpeed = isFast ? 1.4 : isErratic ? (1.0 + 0.6 * Math.abs(Math.sin(now * 3 + gi))) : isSlow ? 0.3 : 0.65;
      for (let str = 0; str < 5; str++) {
        const phase = ((now * streamSpeed + str * 0.2) % 1);
        const fromEnd1 = str % 2 === 0;
        const alpha = phase < 0.25 ? phase / 0.25 : phase < 0.65 ? 1 - (phase - 0.25) / 0.4 : 0;
        if (alpha < 0.01) continue;
        ctx.globalAlpha = alpha * 0.55 * erraticFlicker;
        ctx.strokeStyle = str % 3 === 0 ? '#ffffff' : gateColorLocal;
        ctx.lineWidth = 1.2 - str * 0.08;
        ctx.beginPath();
        if (horiz) {
          const sx = fromEnd1 ? gx1 : gx2, ex2 = fromEnd1 ? gx1 + gLen * phase : gx2 - gLen * phase;
          ctx.moveTo(sx, gy1); ctx.lineTo(ex2, gy1);
        } else {
          const sy = fromEnd1 ? gy1 : gy2, ey2 = fromEnd1 ? gy1 + gLen * phase : gy2 - gLen * phase;
          ctx.moveTo(gx1, sy); ctx.lineTo(gx1, ey2);
        }
        ctx.stroke();
      }

      // Base gate line
      ctx.globalAlpha = 0.6 + 0.3 * pulse; ctx.strokeStyle = gateColorLocal; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(gx1, gy1); ctx.lineTo(gx2, gy2); ctx.stroke();

      // Particles scattered along gate, perpendicular drift
      for (let i = 0; i < 10; i++) {
        const pf = (Math.sin(now * 1.9 + i * 1.4) * 0.5 + 0.5);
        const pd = Math.sin(now * 4.1 + i * 2.3) * 6;
        const fl = 0.3 + 0.7 * Math.abs(Math.sin(now * 3.5 + i * 1.1));
        ctx.globalAlpha = fl * 0.75;
        ctx.fillStyle = i % 3 === 0 ? '#ffffff' : '#66ddff';
        const pr = i % 4 === 0 ? 1.8 : 1.0;
        ctx.beginPath();
        if (horiz) ctx.arc(gx1 + pf * gLen, gy1 + pd, pr, 0, Math.PI * 2);
        else        ctx.arc(gx1 + pd, gy1 + pf * gLen, pr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  ctx.save();
  drawEdge(0, b.x,  b.y,  b.x2, b.y,  true);
  drawEdge(1, b.x2, b.y,  b.x2, b.y2, false);
  drawEdge(2, b.x,  b.y2, b.x2, b.y2, true);
  drawEdge(3, b.x,  b.y,  b.x,  b.y2, false);
  // Corner dots
  ctx.globalAlpha = 1;
  ctx.fillStyle = wallColor;
  [[b.x,b.y],[b.x2,b.y],[b.x2,b.y2],[b.x,b.y2]].forEach(([cx2,cy2]) => {
    ctx.beginPath(); ctx.arc(cx2,cy2,6,0,Math.PI*2); ctx.fill();
  });
  ctx.restore();

  // ── Return window indicator — pulsing ring + countdown arc on player ──
  const allChars = gs.players ? [...gs.players, ...gs.enemies] : [gs.player, ...gs.enemies];
  ctx.save();
  ctx.beginPath(); ctx.rect(b.x, b.y, b.w, b.h); ctx.clip();
  for (const c of allChars) {
    if (!c?.alive || !((c._returnWindowTimer ?? 0) > 0)) continue;
    const ratio = c._returnWindowTimer / 1.0; // 1→0
    const rpulse = 0.7 + 0.3 * Math.abs(Math.sin(now * 8));
    const r = (c.radius || 18) + 10;
    ctx.save();
    ctx.globalAlpha = ratio * rpulse * 0.9;
    ctx.strokeStyle = '#44ffcc';
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    // Countdown sweep arc
    ctx.globalAlpha = ratio * 0.85;
    ctx.strokeStyle = '#44ffcc';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r + 6, -Math.PI / 2, -Math.PI / 2 + ratio * Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore(); // arena clip for return window indicators
}

