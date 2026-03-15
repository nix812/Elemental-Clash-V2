// ========== GAME ENGINE ==========
function initGame() {
  canvas = document.getElementById('game-canvas');
  ctx = canvas.getContext('2d');
  // Defer resize until after the game screen is fully visible in the DOM
  resizeCanvas();
  setTimeout(resizeCanvas, 50);
  window.addEventListener('resize', resizeCanvasDebounced);

  const W = WORLD_W, H = WORLD_H;
  camera.x = WORLD_W / 2 - VIEW_W / 2;
  camera.y = WORLD_H / 2 - VIEW_H / 2;
  gameStartTime = Date.now();
  lockedTarget = null;
  // Reset health pack slots for new match
  HP_PACK_SLOTS.forEach(s => s.cooldown = 0);
  MANA_PACK_SLOTS.forEach(s => s.cooldown = 0);

  // Build characters from lobby slots
  const allSlots = lobbySlots.length >= 2 ? lobbySlots : [
    { type:'p1', hero: selectedHero, teamId: 0 },
    { type:'cpu', hero: HEROES[3], teamId: 1 },
  ];

  // Unique team IDs present in this match
  const teamIds = [...new Set(allSlots.map(s => s.teamId))];
  const teamKills = {};
  teamIds.forEach(tid => teamKills[tid] = 0);

  // Spawn positions spread around map
  const spawnPositions = allSlots.map((_, i) => {
    const angle = (i / allSlots.length) * Math.PI * 2;
    return {
      x: W * 0.5 + Math.cos(angle) * W * 0.18,
      y: H * 0.5 + Math.sin(angle) * H * 0.18,
    };
  });

  // Find the human player slot (type:'p1') — never assume it's index 0
  const playerSlotIdx = allSlots.findIndex(s => s.type === 'p1');
  const playerSlot = allSlots[playerSlotIdx >= 0 ? playerSlotIdx : 0];
  const playerSpawn = spawnPositions[playerSlotIdx >= 0 ? playerSlotIdx : 0];
  const playerChar = createChar(
    playerSlot.hero || selectedHero,
    playerSpawn.x, playerSpawn.y, true, {}, playerSlot.teamId ?? 0
  );

  const pIdx = playerSlotIdx >= 0 ? playerSlotIdx : 0;
  const otherChars = allSlots
    .map((slot, i) => ({ slot, i }))
    .filter(({ i }) => i !== pIdx)
    .map(({ slot, i }) =>
      createChar(
        slot.hero || HEROES[i % HEROES.length],
        spawnPositions[i].x, spawnPositions[i].y,
        false, {}, slot.teamId ?? 1
      )
    );

  // Apply match settings
  MATCH_DURATION = matchDuration;

  gameState = {
    W, H,
    teamKills,             // { teamId: killCount }
    teamIds,               // ordered list of teams in this match
    maxKills: matchKillLimit,
    // Legacy aliases so HUD code keeps working for 1v1
    get kills() { return { p: teamKills[0]??0, e: teamKills[1]??0 }; },
    time: 0,
    over: false,
    countdown: 3.0,        // freeze gameplay for 3s at match start
    winner: null,          // winning teamId
    player: playerChar,
    enemies: otherChars,
    projectiles: [],
    effects: [],
    floatDmgs: [],
    items: [],
    itemSpawnTimer: 0, // legacy — kept for safety
    weatherZones: [],
    weatherSpawnTimer: 20,  // first weather event at 20s
    deaths: 0,
    assists: 0,
    playerDeaths: 0,
    arena: { scale: 1.0 },
    gates: null, // initialized on first updateArena call
  };

  generateObstacles(gameState);
  updateHUDNames();

  // Update special button label + desc based on player class
  const _sLabel = document.getElementById('special-btn-label');
  const _sDesc  = document.getElementById('special-btn-desc');
  const _pClass = gameState.player?.combatClass;
  if (_sLabel && _sDesc) {
    if (_pClass === 'melee')       { _sLabel.textContent='SLAM';  _sDesc.textContent='AOE ground slam'; }
    else if (_pClass === 'hybrid') { _sLabel.textContent='SURGE'; _sDesc.textContent='Forward shockwave'; }
    else                           { _sLabel.textContent='FOCUS'; _sDesc.textContent='Charged skillshot'; }
  }
  setupJoystick();


  // Tap-to-lock targeting (mobile: tap enemy to lock onto them)
  canvas.addEventListener('mousedown', () => {
    if (!document.body.classList.contains('gamepad-mode') &&
        !document.body.classList.contains('keyboard-mode') &&
        navigator.maxTouchPoints === 0) {
      document.body.classList.add('keyboard-mode');
      refreshDynamicBindLabels();
    }
  });
  canvas.addEventListener('click', e => {
    if (!gameState || gameState.over) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const {x: wx, y: wy} = screenToWorld(sx, sy);
    const tapped = gameState.enemies.filter(en => en.alive).find(en => {
      return Math.sqrt((en.x-wx)**2 + (en.y-wy)**2) < en.radius + 24;
    });
    if (tapped) {
      lockedTarget = tapped;
      showFloatText(tapped.x, tapped.y - 50, 'LOCKED', '#ffee44');
    }
  });
  setupKeyboard();
  spawnItems();
  updateAbilityIcons();
  if (animFrame) cancelAnimationFrame(animFrame);

  // Cache frequently-accessed DOM elements to avoid per-frame getElementById calls
  gameState._cdEls    = ['cd-q','cd-e','cd-r'].map(id => document.getElementById(id));
  gameState._cdSprint = document.getElementById('cd-sprint');
  gameState._sprintBtn= document.getElementById('btn-sprint');
  gameState._cdSpecial= document.getElementById('cd-special');
  gameState._specialBtn=document.getElementById('btn-special');
  gameState._respawnEl = document.getElementById('respawn-timer');
  gameState._respawnNum= document.getElementById('rt-num');

  // Snapshot current gamepad button state so held buttons (e.g. Start from hero-select)
  // are not seen as fresh presses on the first game frame
  try {
    const gps = Array.from(navigator.getGamepads ? navigator.getGamepads() : []);
    const gp  = _pickBestGamepad(gps);
    prevGamepadButtons = gp ? gp.buttons.map(b => b?.pressed ?? false) : [];
  } catch(e) { prevGamepadButtons = []; }
  gameLoop();
  // Delay gameStartTime so match timer doesn't tick during the countdown
  gameStartTime = Date.now() + 3000;

  setTimeout(()=>{ showTutorial('Move with joystick. Use Q/E/R to cast abilities!'); }, 3800);
}

function createChar(hero, x, y, isPlayer, itemMods={}, teamId=0) {
  const d = derivedStats(hero, itemMods);
  const baseHp   = d.hp;
  const baseMana = 80 + (hero.baseStats.manaRegen ?? 50) * 1.4;
  const stats = { ...d };
  const _sizeOverride = {
    earth: 8, metal: 6,
    water: 2, nature: 2,
    arcane: 0, ice: 0,
    lightning: -1, shadow: -1,
    fire: -3, wind: -4,
  };
  return {
    hero, x, y, isPlayer, teamId,
    hp: baseHp, maxHp: baseHp,
    mana: baseMana, maxMana: baseMana,
    speed: stats.mobility,
    radius: 18 + (hero.baseStats.defense / 100) * 6 + (_sizeOverride[hero.id] ?? 0),
    alive: true, respawnTimer: 0,
    cooldowns: [0, 0, 30],
    autoAtkTimer: 0,
    facing: isPlayer ? 1 : -1,
    vx:0, vy:0,
    animTick: 0,
    aiState: 'chase', aiTimer: 0, aiTarget: null,
    personality: isPlayer ? null : rollPersonality(),
    stunned: 0, frozen: 0, shielded: 0, silenced: 0,
    kills:0, deaths:0, assists:0,
    stats,
    itemMods,
    combatClass: hero.combatClass || 'hybrid',
    // ── New mechanics state ──
    ccedTimer: 0,           // seconds remaining as a CC target (for combo amp)
    momentumStacks: 0,      // 0–2 stacks from kills/assists
    momentumTimer: 0,       // seconds until momentum expires
    weaveWindow: 0,         // seconds remaining for ability→auto weave bonus
    // ── Passive state ──
    passiveStacks: 0,      // stack count (EMBER heat, etc.)
    passiveCooldown: 0,    // cooldown timer for the passive
    passiveReady: false,   // flag: passive is primed (TIDE shield, VOID shadow strike)
    passiveActive: 0,      // duration timer for active buff (FORGE iron will)
    // ── Sprint state ──
    sprintCd: 0,           // cooldown remaining
    sprintTimer: 0,         // active burst duration remaining
    sprintMult: 1,          // active speed multiplier (1 when not sprinting)
  };
}

// ── Fixed world size — everyone sees the same battlefield ──────────────────
// Canvas pixels fill the screen but the GAME WORLD is always 1600×900.
// We scale and letterbox so a 32" 1440p monitor has no visibility advantage
// over a phone. Think of it like a fixed FOV in competitive shooters.
const WORLD_W = 3200;
const WORLD_H = 1800;
const VIEW_W  = 1600;  // fixed viewport — same for everyone
const VIEW_H  = 900;

// Camera state — smooth follow
const camera = { x: 0, y: 0 };  // top-left corner of viewport in world coords

function updateCamera(gs) {
  const p = gs.player;
  if (!p) return;

  // Target: center viewport on player
  const targetX = p.x - VIEW_W / 2;
  const targetY = p.y - VIEW_H / 2;

  // Smooth lerp
  const lerpSpeed = 0.12;
  camera.x += (targetX - camera.x) * lerpSpeed;
  camera.y += (targetY - camera.y) * lerpSpeed;

  // Clamp so we don't show outside world bounds
  // (world warps, but we don't render the seam — clamp prevents jitter at edges)
  camera.x = Math.max(0, Math.min(WORLD_W - VIEW_W, camera.x));
  camera.y = Math.max(0, Math.min(WORLD_H - VIEW_H, camera.y));

  // Snap camera if player just warped (teleported more than half the world)
  const snapThreshold = WORLD_W * 0.4;
  if (Math.abs(targetX - camera.x) > snapThreshold) {
    camera.x = Math.max(0, Math.min(WORLD_W - VIEW_W, targetX));
  }
  if (Math.abs(targetY - camera.y) > snapThreshold) {
    camera.y = Math.max(0, Math.min(WORLD_H - VIEW_H, targetY));
  }
}

function resizeCanvas() {
  if (!canvas) return;

  const sw = window.innerWidth;
  const sh = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;

  canvas.width  = Math.round(sw * dpr);
  canvas.height = Math.round(sh * dpr);

  canvas.style.width    = sw + 'px';
  canvas.style.height   = sh + 'px';
  canvas.style.position = 'absolute';
  canvas.style.top      = '0';
  canvas.style.left     = '0';

  const scale   = Math.min((sw * dpr) / VIEW_W, (sh * dpr) / VIEW_H);
  const offsetX = ((sw * dpr) - VIEW_W * scale) / 2;
  const offsetY = ((sh * dpr) - VIEW_H * scale) / 2;

  canvas._worldScale   = scale;
  canvas._worldOffsetX = offsetX;
  canvas._worldOffsetY = offsetY;
  canvas._dpr          = dpr;

  // Reset any leaked transform state on the context
  if (ctx) ctx.setTransform(1, 0, 0, 1, 0, 0);

  if (gameState) {
    gameState.W = WORLD_W;
    gameState.H = WORLD_H;
  }
}

let _resizeTimer = null;
function resizeCanvasDebounced() {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(resizeCanvas, 100);
}

// Convert screen coords → world coords (for tap-to-target)
function screenToWorld(sx, sy) {
  const scale   = canvas._worldScale   || 1;
  const offsetX = canvas._worldOffsetX || 0;
  const offsetY = canvas._worldOffsetY || 0;
  const dpr     = canvas._dpr          || 1;
  // CSS pixels → physical pixels → viewport space → world space
  const vx = (sx * dpr - offsetX) / scale;
  const vy = (sy * dpr - offsetY) / scale;
  return { x: vx + camera.x, y: vy + camera.y };
}

// ========== MAIN LOOP ==========
function gameLoop(timestamp) {
  if (!gameState || gameState.over) return;
  try {
    const gs = gameState;
    const now = timestamp ?? performance.now();
    // Always reset timestamp after a gap (first frame, post-pause) to prevent dt spike
    if (!gs._lastTimestamp || (now - gs._lastTimestamp) > 200) {
      gs._lastTimestamp = now;
    }
    const dt = Math.min((now - gs._lastTimestamp) / 1000, 1/30); // cap at 2 frames
    gs._lastTimestamp = now;
    gs._dt = dt;

    gs.time = Math.max(0, (Date.now() - gameStartTime) / 1000);
    _spriteFrameCount++;
    update(gs);
    updateCamera(gs);
    render(gs);
    drawHUD(gs);
    renderOffScreenIndicators(gs);
  } catch(err) {
    console.error('[Elemental Clash] gameLoop error:', err);
  }
  animFrame = requestAnimationFrame(gameLoop);
}

function update(gs) {
  const dt = gs._dt ?? 1/60;
  pollGamepad(gs);
  if (window._updateKeyboardJoy) window._updateKeyboardJoy();

  // ── Countdown freeze ─────────────────────────────────────────────────────
  if (gs.countdown > 0) {
    gs.countdown = Math.max(0, gs.countdown - dt);
    return; // freeze all gameplay — render still runs
  }

  // ── Match timer ──────────────────────────────────────────────────────────
  const remaining = Math.max(0, MATCH_DURATION - gs.time);
  if (!gs.over && !gs.suddenDeath && gs.time > 0 && remaining <= 0) {
    handleTimeUp(gs);
    // Check if eliminations at sudden death start already decided a winner
    if (!gs.over) {
      const allChars = [gs.player, ...gs.enemies];
      for (const tid of gs.teamIds) {
        const teamAlive = allChars.filter(c => c.teamId === tid && c.alive);
        if (teamAlive.length === 0) {
          // Find surviving team
          const winTeam = gs.teamIds.find(t => t !== tid &&
            allChars.some(c => c.teamId === t && c.alive));
          if (winTeam !== undefined) { endGame(gs, winTeam); break; }
        }
      }
    }
  }
  if (gs.over) return;

  // Item spawn
  // Tick health pack slot cooldowns and try to spawn
  tickItemCooldowns(gs, dt);
  spawnItems(gs);

  // Weather
  updateWeather(gs, dt);
  updateArena(gs, dt);
  updateObstacles(gs, dt);
  const allCharsForWeather = [gs.player, ...gs.enemies];
  allCharsForWeather.forEach(c => { if (c.alive) applyWeatherToChar(c, gs, dt); });

  // Player movement — acceleration/deceleration model
  const p = gs.player;
  if (p.alive) {
    p.stunned = Math.max(0, p.stunned - dt);
    p.frozen = Math.max(0, p.frozen - dt);
    if ((p.spawnInvuln ?? 0) > 0) p.spawnInvuln = Math.max(0, p.spawnInvuln - dt);

    // Ensure velocity state exists
    if (p.velX === undefined) { p.velX = 0; p.velY = 0; }

    if (p.stunned <= 0 && p.frozen <= 0) {
      let spdMult = 2.5;
      const topSpeed = p.speed * spdMult * (p.weatherSpeedMult ?? 1)
        * (p.sprintMult ?? 1)
        * (p.hp / p.maxHp < 0.25 ? 0.78 : 1); // -22% speed below 25% HP

      // Target velocity from input
      const inputLen = Math.hypot(joyDelta.x, joyDelta.y);
      const targetVX = joyDelta.x * topSpeed;
      const targetVY = joyDelta.y * topSpeed;

      // Acceleration: faster when input present, deceleration when releasing
      // accelT = time (seconds) to reach full speed from rest
      // decelT = time to stop from full speed
      const accelT = 0.10;   // 100ms to full speed — snappy but smooth
      const decelT = 0.08;   // 80ms to stop — quick stop, no ice-skate feel

      if (inputLen > 0.01) {
        // Lerp toward target velocity
        const alpha = Math.min(1, dt / accelT);
        p.velX += (targetVX - p.velX) * alpha;
        p.velY += (targetVY - p.velY) * alpha;
        p.facing = joyDelta.x > 0 ? 1 : joyDelta.x < 0 ? -1 : p.facing;
      } else {
        // Decelerate to zero
        const alpha = Math.min(1, dt / decelT);
        p.velX *= (1 - alpha);
        p.velY *= (1 - alpha);
        // Snap to zero when very slow to avoid jitter
        if (Math.hypot(p.velX, p.velY) < 0.05) { p.velX = 0; p.velY = 0; }
      }

      p.x += p.velX;
      p.y += p.velY;
      warpChar(p, gs.W, gs.H);
      resolveObstacleCollisions(p, gs);
      p.vx = p.velX;
      p.vy = p.velY;
    } else {
      // Stunned/frozen: bleed off velocity quickly
      p.velX *= 0.6;
      p.velY *= 0.6;
      p.vx = 0; p.vy = 0;
    }
    // Melee LOW-ground passive defense bonus
    p.meleeTerrainDefBonus = 0;
    // Collision damage (melee only)
    if (p.combatClass === 'melee') {
      const vel = Math.sqrt((p.vx||0)**2 + (p.vy||0)**2);
      if (vel > 0.8) {
        for (const e of gs.enemies) {
          if (!e.alive) continue;
          const cdx = e.x - p.x, cdy = e.y - p.y;
          const dist = Math.sqrt(cdx*cdx + cdy*cdy);
          if (dist < p.radius + e.radius + 4) {
            const dot = (p.vx * cdx + p.vy * cdy) / (dist * vel);
            if (dot > 0.3) applyMeleeCollision(p, e, vel, gs);
          }
        }
      }
    }
    p.mana = Math.min(p.maxMana, p.mana + (p.stats?.manaRegen ?? 3) * dt);
    // Heal-over-time from health packs
    if (p.healRemaining > 0 && p.healDuration > 0) {
      const tick = Math.min(p.healRemaining, (p.healRemaining / p.healDuration) * dt);
      p.hp = Math.min(p.maxHp, p.hp + tick);
      p.healRemaining -= tick;
      p.healDuration   = Math.max(0, p.healDuration - dt);
      if (p.healDuration <= 0) p.healRemaining = 0;
    }
    if (p.silenced > 0) p.silenced = Math.max(0, p.silenced - dt);
    p.animTick += dt;
    for (let i=0;i<3;i++) p.cooldowns[i] = Math.max(0, p.cooldowns[i]-dt);
    p.autoAtkTimer = Math.max(0, p.autoAtkTimer - dt);

    // ── Sprint timers ──
    if ((p.sprintTimer ?? 0) > 0) {
      p.sprintTimer = Math.max(0, p.sprintTimer - dt);
      if (p.sprintTimer <= 0) p.sprintMult = 1; // burst expired
    }
    if ((p.sprintCd ?? 0) > 0) p.sprintCd = Math.max(0, p.sprintCd - dt);
    if ((p.specialCd ?? 0) > 0) p.specialCd = Math.max(0, p.specialCd - dt);
    // ── New mechanic timers ──
    if (p.ccedTimer    > 0) p.ccedTimer    = Math.max(0, p.ccedTimer    - dt);
    if (p.weaveWindow  > 0) p.weaveWindow  = Math.max(0, p.weaveWindow  - dt);
    if (p.momentumTimer > 0) {
      p.momentumTimer = Math.max(0, p.momentumTimer - dt);
      if (p.momentumTimer <= 0) p.momentumStacks = 0;
    }
    // ── Passive tick ──
    PASSIVES[p.hero?.id]?.onTick?.(p, dt);

    // ── Auto-attack: always fires toward locked target ──
    if (p.autoAtkTimer <= 0 && !p.stunned && !p.frozen && !p.silenced) {
      const atkTarget = getLockedTarget(gameState);
      if (atkTarget && atkTarget.alive) {
        const atkSpd = p.stats?.atkSpeed ?? 1.0;
        p.autoAtkTimer = 1 / atkSpd;

        const classMult = COMBAT_CLASS[p.combatClass]?.rangeMult ?? 1.0;
        const autoRange = 180 * classMult;

        const { dx: adx, dy: ady, dist: ad } = warpDelta(p.x, p.y, atkTarget.x, atkTarget.y);
        if (ad <= autoRange * 1.2) {
          const autoMult = p.combatClass === 'melee' ? 0.65 : p.combatClass === 'hybrid' ? 0.55 : 0.52;
          const autoDmg = Math.round((p.stats?.damage ?? 60) * autoMult);
          const col = p.hero.color;
          gameState.projectiles.push({
            x:p.x, y:p.y,
            vx:(adx/ad)*9, vy:(ady/ad)*9,
            damage: autoDmg,
            radius: 5,
            life: autoRange / (9*60),
            color: col,
            teamId: p.teamId,
            isAutoAttack: true,
            stun:0, freeze:0, slow:0, silence:0, knockback:0,
            kbDirX:adx, kbDirY:ady,
            casterStats: p.stats, casterRef: p,
          });
          p.facing = adx > 0 ? 1 : -1;
        }
      }
    }
  } else {
    p.respawnTimer -= dt;
    if (p.respawnTimer <= 0) { respawnChar(p, gs); }
    if (gs._respawnEl) gs._respawnEl.style.display = 'flex';
    if (gs._respawnNum) gs._respawnNum.textContent = Math.ceil(p.respawnTimer);
    // NOTE: no return here — enemies/projectiles/effects must keep running while player is dead
  }
  if (p.alive && gs._respawnEl) gs._respawnEl.style.display = 'none';

  // Enemy AI
  gs.enemies.forEach(e => updateAI(e, gs, dt));

  // Projectiles
  gs.projectiles = gs.projectiles.filter(proj => {
    proj.x += proj.vx;
    proj.y += proj.vy;
    proj.life -= dt;
    if (proj.life <= 0) return false;
    if (!warpProj(proj, gs.W, gs.H)) return false; // hit solid arena wall

    // Obstacle collision — destroy projectile on impact
    if (projectileHitsObstacle(proj, gs)) return false;

    // Rock buster only hits obstacles — skip character collision entirely
    if (proj.isRockBuster) return true;

    // Hit check — team filtering unless friendly fire is on
    const allChars = [gs.player, ...gs.enemies];
    const targets = friendlyFire
      ? allChars.filter(c => c !== proj.casterRef)
      : allChars.filter(c => c.teamId !== proj.teamId);
    for (const t of targets) {
      if (!t.alive) continue;
      const dx=t.x-proj.x, dy=t.y-proj.y;
      const hitR = t.radius+proj.radius;
      if (dx*dx+dy*dy < hitR*hitR) {
        applyHit(t, proj, gs);
        if (!proj.piercing) return false;
      }
    }
    return true;
  });

  // Effects
  gs.effects = gs.effects.filter(ef => { ef.life -= dt; return ef.life > 0; });

  // Item pickup — check all alive characters
  // ── Item physics — drift and bounce off obstacles/walls ──────────────────
  {
    const b = getArenaBounds(gs);
    const ITEM_R = 16; // pickup radius for collision purposes
    const FRICTION = 0.88; // per-frame velocity decay
    for (const item of gs.items) {
      if (!item.vx && !item.vy) continue;
      item.vx = (item.vx || 0) * FRICTION;
      item.vy = (item.vy || 0) * FRICTION;
      // Stop sliding when basically still
      if (Math.hypot(item.vx, item.vy) < 0.5) { item.vx = 0; item.vy = 0; continue; }
      item.x += item.vx * dt;
      item.y += item.vy * dt;
      // Bounce off arena bounds
      if (item.x < b.x + ITEM_R) { item.x = b.x + ITEM_R; item.vx = Math.abs(item.vx) * 0.6; }
      if (item.x > b.x2 - ITEM_R) { item.x = b.x2 - ITEM_R; item.vx = -Math.abs(item.vx) * 0.6; }
      if (item.y < b.y + ITEM_R) { item.y = b.y + ITEM_R; item.vy = Math.abs(item.vy) * 0.6; }
      if (item.y > b.y2 - ITEM_R) { item.y = b.y2 - ITEM_R; item.vy = -Math.abs(item.vy) * 0.6; }
      // Bounce off obstacles
      if (gs.obstacles) {
        for (const ob of gs.obstacles) {
          const odx = item.x - ob.x, ody = item.y - ob.y;
          const od = Math.hypot(odx, ody) || 1;
          const minDist = ob.size + ITEM_R;
          if (od < minDist) {
            // Push item out and reflect velocity along normal
            item.x = ob.x + (odx / od) * minDist;
            item.y = ob.y + (ody / od) * minDist;
            const dot = item.vx * (odx/od) + item.vy * (ody/od);
            item.vx -= 2 * dot * (odx/od) * 0.6;
            item.vy -= 2 * dot * (ody/od) * 0.6;
          }
        }
      }
    }
  }

  gs.items = gs.items.filter(item => {
    const allChars = [gs.player, ...gs.enemies].filter(c => c && c.alive);
    for (const c of allChars) {
      const dx = c.x - item.x, dy = c.y - item.y;
      if (dx*dx+dy*dy < 36*36) {
        if (applyItem(c, item, gs)) return false; // consumed — remove
        // full health — keep item, but only show message once per frame
        break;
      }
    }
    return true;
  });

  // Float dmg cleanup
  gs.floatDmgs = gs.floatDmgs.filter(f => f.life > 0 && (f.life -= dt) > 0);

  // Update cooldown UI (only while player is alive) — uses cached DOM refs
  if (p.alive && gs._cdEls) {
    const cdIds = ['q','e','r'];
    for(let i=0;i<3;i++) {
      const overlay = gs._cdEls[i];
      if (overlay) {
        const cd = p.cooldowns[i];
        if (cd > 0) { overlay.style.display='flex'; overlay.textContent=Math.ceil(cd); }
        else overlay.style.display='none';
      }
    }
    // Sprint cooldown overlay
    const sprintOverlay = gs._cdSprint;
    const sprintBtn = gs._sprintBtn;
    if (sprintOverlay) {
      const scd = p.sprintCd ?? 0;
      if (scd > 0) {
        sprintOverlay.style.display='flex';
        sprintOverlay.textContent = Math.ceil(scd);
        if (sprintBtn) sprintBtn.style.opacity='0.55';
      } else {
        sprintOverlay.style.display='none';
        if (sprintBtn) sprintBtn.style.opacity = (p.sprintTimer??0) > 0 ? '1' : '0.9';
      }
      if (sprintBtn) sprintBtn.style.boxShadow = (p.sprintTimer??0) > 0
        ? '0 0 14px 4px rgba(255,220,50,0.7)' : '';
    }
    // Special ability cooldown
    const specialOverlay = gs._cdSpecial;
    const specialBtn     = gs._specialBtn;
    if (specialOverlay) {
      const spcd = p.specialCd ?? 0;
      if (spcd > 0) {
        specialOverlay.style.display='flex';
        specialOverlay.textContent = Math.ceil(spcd);
        if (specialBtn) specialBtn.style.opacity='0.55';
      } else {
        specialOverlay.style.display='none';
        if (specialBtn) specialBtn.style.opacity='0.9';
      }
    }
  }
}

// ── Melee collision damage ──────────────────────────────────────────────────
// Triggered when a melee hero charges into an enemy at speed.
// Damage = 20–30% of a normal ability hit, scaled by velocity and damage stat.
// HIGH→LOW charge adds +35%. 0.6s per-target cooldown prevents spam.
function applyMeleeCollision(attacker, target, vel, gs) {
  if (!target.alive) return;
  if ((target.spawnInvuln ?? 0) > 0) return; // spawn invulnerability
  // Per-target cooldown
  attacker.collisionCooldowns = attacker.collisionCooldowns || {};
  const now = gs.time;
  if ((attacker.collisionCooldowns[target] || 0) > now) return;
  attacker.collisionCooldowns[target] = now + 0.6;

  // Base damage: 25% of hero's raw damage stat, scaled by velocity (0–1 range)
  const baseDmg = attacker.hero.baseStats.damage;
  const velScale = Math.min(1.0, (vel - 0.8) / 2.5); // 0 at vel=0.8, 1 at vel=3.3
  let dmg = Math.round(baseDmg * 0.25 * (0.6 + velScale * 0.4)); // 20–30% band

  // Apply target defense
  if (target.stats) {
    let defPct = Math.min(0.80, (target.stats.defense ?? 0) / 100);
    defPct = Math.max(0, defPct);
    dmg = Math.round(dmg * (1 - defPct));
  }
  if (target.shielded > 0) dmg = Math.floor(dmg * 0.3);
  dmg = Math.max(1, dmg);

  target.hp = Math.max(0, target.hp - dmg);

  // Track damage for assist credit (33% of maxHp threshold)
  if (attacker && attacker !== target && dmg > 0) {
    if (!target._dmgContrib) target._dmgContrib = {};
    const cid = attacker.hero?.id ?? (attacker.isPlayer ? 'player' : 'unknown');
    target._dmgContrib[cid] = (target._dmgContrib[cid] || 0) + dmg;
    target._dmgContribRef = target._dmgContribRef || {};
    target._dmgContribRef[cid] = attacker;
  }

  // Knockback away from attacker
  const dx = target.x - attacker.x, dy = target.y - attacker.y;
  const d = Math.sqrt(dx*dx+dy*dy)||1;
  const kbStrength = 55 + velScale * 30;
  target.x += (dx/d) * kbStrength;
  target.y += (dy/d) * kbStrength;
  warpChar(target, gs.W, gs.H);
  resolveObstacleCollisions(target, gs);

  // Visual feedback
  const col = attacker.hero.color;
  showFloatText(target.x, target.y - 40, `-${dmg} COLLISION`, col, target);
  gs.effects.push({ x: target.x, y: target.y, r:0, maxR: 40, life: 0.25, maxLife: 0.25, color: col });

  // Kill check
  if (target.hp <= 0) {
    target.alive = false;
    target.respawnTimer = 3;
    const attackerTeam = attacker.teamId ?? 0;
    gs.teamKills[attackerTeam] = (gs.teamKills[attackerTeam] || 0) + 1;
    attacker.kills = (attacker.kills||0) + 1;
    if (attacker.isPlayer) showFloatText(attacker.x, attacker.y - 60, 'KILL!', '#44ff88', attacker);
    const winTeam = checkWinCondition(gs);
    if (winTeam !== null) endGame(gs, winTeam);
  }
}

function applyHit(target, proj, gs) {
  if (!target.alive) return;
  if ((target.spawnInvuln ?? 0) > 0) return; // spawn invulnerability
  const caster = proj.casterRef;

  // Cancel health pack heal-over-time on hit
  if (target.healRemaining > 0) {
    target.healRemaining = 0;
    target.healDuration  = 0;
    if (target.isPlayer) spawnFloat(target.x, target.y - 30, 'HEAL BROKEN!', '#ff4444', { char: target });
  }

  // ── Base damage ──
  const ap = proj.casterStats ? (proj.casterStats.abilityPower ?? 1.0) : 1.0;
  let dmg = proj.isAutoAttack ? proj.damage : Math.round(proj.damage * ap);
  // Flat passive bonus (EMBER heat, VOID shadow strike) — added post-AP scaling
  if (!proj.isAutoAttack && (proj.flatBonus ?? 0) > 0) dmg += proj.flatBonus;

  // ── Weather damage multiplier (from caster's zone) ──
  if (caster?.weatherDmgMult && caster.weatherDmgMult !== 1) {
    dmg = Math.round(dmg * caster.weatherDmgMult);
  }

  // ── Defense reduction ──
  if (target.stats) {
    let defPct = Math.min(0.80, (target.stats.defense ?? 0) / 100);
    defPct = Math.min(0.80, defPct + (target.meleeTerrainDefBonus || 0));
    const pen = proj.casterStats ? Math.min(defPct, (proj.casterStats.armorPen ?? 0) / 100) : 0;
    dmg = Math.round(dmg * (1 - defPct + pen));
  }
  if (target.shielded > 0) dmg = Math.floor(dmg * 0.3);

  // ── PASSIVE: TIDE — Resilience (absorb one hit) ──
  if (PASSIVES[target.hero?.id]?.onHit) {
    if (PASSIVES[target.hero.id].onHit(target, gs)) return; // hit absorbed
  }
  // ── PASSIVE: STONE — Unstoppable (damage reduction while charging) ──
  if (target.hero?.id === 'earth') {
    const mult = PASSIVES.earth.onDamageReceived(target, caster);
    if (mult < 1) dmg = Math.round(dmg * mult);
  }
  // ── PASSIVE: FORGE — Iron Will (big-hit damage reduction) ──
  if (target.hero?.id === 'metal') {
    PASSIVES.metal.onDamageReceived(target, dmg, gs);
    const mult = PASSIVES.metal.getDmgReduction(target);
    if (mult < 1) dmg = Math.round(dmg * mult);
  }

  // ── Crit ──
  const critRoll = proj.casterStats?.critChance ?? 10;
  const isCrit = Math.random() < critRoll / 100;
  if (isCrit) dmg = Math.floor(dmg * 1.75);

  // ══════════════════════════════════════════════════════════
  // NEW MECHANICS — applied after base calc, hard-capped at 2.0x
  // to prevent compounding power blowout across features
  // ══════════════════════════════════════════════════════════
  let ampMult = 1.0;

  // 1. CC COMBO AMPLIFIER — +30% on CC'd targets
  const targetIsCC = (target.ccedTimer ?? 0) > 0 || target.stunned > 0 || target.frozen > 0;
  if (targetIsCC) {
    ampMult *= 1.30;
    if (proj.casterRef?.isPlayer) spawnFloat(target.x, target.y, 'COMBO!', '#ff9944', { char: target });
  }

  // 2. MOMENTUM STACKS — +8% per stack (max 2 = +16%), expires 6s after last kill
  if (caster && (caster.momentumStacks ?? 0) > 0) {
    ampMult *= (1 + caster.momentumStacks * 0.08);
  }

  // 3. EXECUTE THRESHOLD — +15% below 20% HP (weather can lower the threshold)
  const execThreshold = 0.20 * (caster?.weatherExecuteMult ?? 1);
  if (target.hp / target.maxHp < execThreshold) {
    ampMult *= 1.15;
  }

  // 4. ABILITY WEAVE WINDOW — +20% on next auto within 0.5s of an ability hit
  if (proj.isAutoAttack && caster && (caster.weaveWindow ?? 0) > 0) {
    ampMult *= 1.20;
    caster.weaveWindow = 0;
  }

  // ── PASSIVE: MYST — Arcane Mastery / FROST — Shatter (bonus on rooted target) ──
  if (!proj.isAutoAttack && caster) {
    const passiveHitFn = PASSIVES[caster.hero?.id]?.onHitTarget;
    if (passiveHitFn) {
      const ab = { damage: proj.damage || 0 }; // synthetic ab for bonus calc
      const bonus = passiveHitFn(caster, target, ab, gs);
      if (bonus > 0) dmg += bonus;
    }
  }

  // Hard cap: no single hit can exceed 2.0x amplification
  ampMult = Math.min(2.0, ampMult);
  dmg = Math.round(dmg * ampMult);

  // ── Lifesteal ──
  if (caster && proj.casterStats && proj.casterStats.lifesteal > 0) {
    const ls = Math.round(dmg * proj.casterStats.lifesteal / 100);
    if (ls > 0 && caster.alive) caster.hp = Math.min(caster.maxHp, caster.hp + ls);
  }

  target.hp = Math.max(0, target.hp - dmg);

  // Track damage for assist credit (33% of maxHp threshold)
  if (caster && caster !== target && dmg > 0) {
    if (!target._dmgContrib) target._dmgContrib = {};
    const cid = caster.hero?.id ?? (caster.isPlayer ? 'player' : 'unknown');
    target._dmgContrib[cid] = (target._dmgContrib[cid] || 0) + dmg;
    target._dmgContribRef = target._dmgContribRef || {};
    target._dmgContribRef[cid] = caster;
    // Hard AI threat tracking — remember who just hit us
    if (!target.isPlayer) target._lastAttackerId = cid;
  }

  // ── Auto mana refund ──
  if (proj.isAutoAttack && caster && caster.alive) {
    caster.mana = Math.min(caster.maxMana, caster.mana + 8 + Math.floor(Math.random() * 5));
  }

  // ── Open weave window after ability lands ──
  if (!proj.isAutoAttack && caster) caster.weaveWindow = 0.5;

  // ── Status effects ──
  const baseSpd = target.stats ? target.stats.mobility : 3.5;
  if (proj.stun && proj.stun > 0) {
    target.stunned   = Math.max(target.stunned,  proj.stun);
    target.ccedTimer = Math.max(target.ccedTimer ?? 0, proj.stun);
  }
  if (proj.freeze && proj.freeze > 0) {
    target.frozen    = Math.max(target.frozen,   proj.freeze);
    target.ccedTimer = Math.max(target.ccedTimer ?? 0, proj.freeze);
  }
  if (proj.slow && proj.slow > 0) {
    target.speed     = baseSpd * 0.45;
    target.ccedTimer = Math.max(target.ccedTimer ?? 0, proj.slow);
    setTimeout(()=>{ if(target) target.speed = baseSpd; }, proj.slow * 1000);
    showFloatText(target.x, target.y-30, 'SLOWED', '#44ccff', target);
  }
  if (proj.silence && proj.silence > 0) {
    target.silenced  = Math.max(target.silenced||0, proj.silence);
    target.ccedTimer = Math.max(target.ccedTimer ?? 0, proj.silence);
    showFloatText(target.x, target.y-30, 'SILENCED', '#cc88ff', target);
  }
  if (proj.knockback && proj.knockback > 0 && gameState) {
    const kd = Math.sqrt((proj.kbDirX||1)**2+(proj.kbDirY||0)**2)||1;
    target.x = Math.max(20, Math.min(gameState.W-20, target.x + (proj.kbDirX/kd)*80));
    target.y = Math.max(20, Math.min(gameState.H-20, target.y + (proj.kbDirY/kd)*80));
    target.ccedTimer = Math.max(target.ccedTimer ?? 0, 0.3);
    showFloatText(target.x, target.y-30, 'KNOCKED BACK', '#ff6644', target);
  }
  if (proj.pull && proj.pull > 0 && gameState) {
    const kd = Math.sqrt((proj.kbDirX||1)**2+(proj.kbDirY||0)**2)||1;
    target.x = Math.max(20, Math.min(gameState.W-20, target.x - (proj.kbDirX/kd)*70));
    target.y = Math.max(20, Math.min(gameState.H-20, target.y - (proj.kbDirY/kd)*70));
    target.ccedTimer = Math.max(target.ccedTimer ?? 0, 0.3);
    if (!target.isPlayer) target._wasPulled = true; // triggers AI sprint escape in ai.js
    showFloatText(target.x, target.y-30, 'PULLED', '#00ddff', target);
  }

  // ── Heal ability ──
  if (proj.heal) { target.hp = Math.min(target.maxHp, target.hp + Math.abs(proj.damage)); return; }

  // ── Float damage number — lane-aware ──
  spawnFloat(target.x, target.y,
    isCrit ? `${dmg}!` : `${dmg}`,
    isCrit ? '#ffee00' : (ampMult > 1.15 ? '#ff9944' : (proj.casterRef?.isPlayer ? '#fff' : '#ff4444')),
    { char: target }
  );

  // ── Hit effect ring ──
  gs.effects.push({ x:target.x, y:target.y, r:0, maxR:proj.damage+20, life:0.3, maxLife:0.3, color:proj.color||'#fff', elem:proj.casterRef?.hero?.id });

  if (target.hp <= 0) killChar(target, proj.casterRef?.isPlayer ?? false, gs, proj.casterRef);
}

function killChar(target, killedByPlayer, gs, attacker) {
  target.alive = false;
  target.hp = 0;
  target.respawnTimer = gs.suddenDeath ? 9999 : 3;
  target.deaths++;
  if (target.isPlayer) gs.playerDeaths = (gs.playerDeaths||0) + 1;
  // Clear target lock if this was the locked target
  if (lockedTarget === target) lockedTarget = null;

  // Credit kill to attacker's team
  const killer = attacker || (killedByPlayer ? gs.player : null);
  const killerTeam = killer ? (killer.teamId ?? 0) : 1;
  gs.teamKills[killerTeam] = (gs.teamKills[killerTeam] || 0) + 1;
  if (killer) killer.kills = (killer.kills||0) + 1;

  const killerIsPlayer = killer && killer.isPlayer;
  const effectColor = killerIsPlayer ? '#ff4444' : '#4488ff';
  gs.effects.push({ x:target.x, y:target.y, r:0, maxR:80, life:0.5, maxLife:0.5, color:effectColor, big:true });
  showFloatText(target.x, target.y - 40, 'ELIMINATED!', effectColor, target);
  if (killerIsPlayer) Audio.sfx.kill();
  if (target.isPlayer) Audio.sfx.death();

  // Award assists — anyone who dealt >= 33% of maxHp who isn't the killer
  if (target._dmgContrib && target._dmgContribRef) {
    const assistThreshold = target.maxHp * 0.33;
    const killerHeroId = killer?.hero?.id ?? (killer?.isPlayer ? 'player' : null);
    for (const [cid, totalDmg] of Object.entries(target._dmgContrib)) {
      if (cid === killerHeroId) continue; // killer gets kill credit, not assist
      if (totalDmg >= assistThreshold) {
        const assistChar = target._dmgContribRef[cid];
        if (assistChar && assistChar.alive) {
          assistChar.assists = (assistChar.assists || 0) + 1;
          if (assistChar.isPlayer) {
            gs.playerAssists = (gs.playerAssists || 0) + 1;
            showFloatText(assistChar.x, assistChar.y - 55, 'ASSIST!', '#44ccff', assistChar);
          }
          // ── PASSIVE: EMBER — Ignition (assist also builds heat) ──
          if (PASSIVES[assistChar.hero?.id]?.onKillOrAssist) {
            PASSIVES[assistChar.hero.id].onKillOrAssist(assistChar);
          }
        }
      }
    }
  }
  // Clear damage tracking for next life
  target._dmgContrib = {};
  target._dmgContribRef = {};

  // ── PASSIVE: EMBER — Ignition (kill/assist builds heat) ──
  if (killer && PASSIVES[killer.hero?.id]?.onKillOrAssist) {
    PASSIVES[killer.hero.id].onKillOrAssist(killer);
  }
  // ── PASSIVE: VOLT — Overclock (kill refunds ult cooldown) ──
  if (killer && PASSIVES[killer.hero?.id]?.onKill) {
    PASSIVES[killer.hero.id].onKill(killer);
  }

  // MOMENTUM for killer
  if (killer) {
    killer.momentumStacks = Math.min(2, (killer.momentumStacks || 0) + 1);
    killer.momentumTimer  = 6;
    if (killerIsPlayer) {
      if (killer.momentumStacks === 2) {
        showFloatText(killer.x, killer.y - 55, 'ON FIRE!', '#ff6600', killer);
        if (killer.isPlayer) Audio.sfx.onFire();
      }
      showFloatText(killer.x, killer.y - 60, 'KILL!', '#44ff88', killer);
    }
  }

  const winTeam = checkWinCondition(gs);
  if (winTeam !== null) endGame(gs, winTeam);
}

function getSafeSpawnPos(gs, excludeChar) {
  // Sample random candidates and pick the one furthest from all living characters
  const CANDIDATES = 24;
  const MARGIN = 120;
  const others = [...gs.enemies, gs.player].filter(c => c && c.alive && c !== excludeChar);

  let bestPos = null, bestDist = -1;

  for (let attempt = 0; attempt < CANDIDATES; attempt++) {
    // Random position anywhere on the map with margin from edges
    const cx = MARGIN + Math.random() * (gs.W - MARGIN * 2);
    const cy = MARGIN + Math.random() * (gs.H - MARGIN * 2);

    // Min warp-aware distance to any living player
    let minDist = Infinity;
    for (const other of others) {
      const { dist } = warpDelta(cx, cy, other.x, other.y);
      if (dist < minDist) minDist = dist;
    }

    if (minDist > bestDist) {
      bestDist = minDist;
      bestPos = { x: cx, y: cy };
    }
  }

  // Fallback if no others alive
  return bestPos || { x: gs.W * 0.5 + (Math.random()-0.5)*200, y: gs.H * 0.5 + (Math.random()-0.5)*200 };
}

// Stop the engine completely and clear state — call whenever leaving a match
function cleanupGame() {
  if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
  gameState = null;
  const po = document.getElementById('pause-overlay');
  if (po) po.style.display = 'none';
  const tf = document.getElementById('target-frame');
  if (tf) tf.style.display = 'none';
}

function respawnChar(c, gs) {
  c.alive = true;
  c.hp = c.maxHp;
  c.mana = c.maxMana;
  c.stunned = 0; c.frozen = 0; c.silenced = 0;
  c.ccedTimer = 0; c.weaveWindow = 0; c.momentumStacks = 0; c.momentumTimer = 0;
  c.velX = 0; c.velY = 0; c.vx = 0; c.vy = 0;
  c.aiState = 'chase'; c._lastWarp = 0;
  c.spawnInvuln = 2.0; // 2 seconds of invulnerability on spawn
  if (!c.isPlayer) c.personality = rollPersonality(); // re-roll personality each life
  const pos = getSafeSpawnPos(gs, c);
  c.x = pos.x;
  c.y = pos.y;
}

