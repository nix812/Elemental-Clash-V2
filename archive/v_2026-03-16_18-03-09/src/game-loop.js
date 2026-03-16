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
  lockedTarget = null; // legacy stub clear
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

  // Separate human and CPU slots
  const humanSlots = allSlots.map((s,i) => ({...s, _origIdx:i})).filter(s => s.type !== 'cpu');
  const cpuSlots   = allSlots.map((s,i) => ({...s, _origIdx:i})).filter(s => s.type === 'cpu');
  const isSpectator = humanSlots.length === 0;

  // Build human player characters — each gets a playerIdx for input routing
  let playerChars;
  if (isSpectator) {
    // All-bot mode: create a dummy watched char from slot 0
    const s = allSlots[0];
    playerChars = [createChar(s.hero || selectedHero, spawnPositions[0].x, spawnPositions[0].y, false, {}, s.teamId ?? 0, 0)];
  } else {
    playerChars = humanSlots.map((s, pi) =>
      createChar(s.hero || selectedHero, spawnPositions[s._origIdx].x, spawnPositions[s._origIdx].y, true, {}, s.teamId ?? 0, pi)
    );
  }

  // Build AI characters
  const aiChars = isSpectator
    ? allSlots.slice(1).map((s,i) => createChar(s.hero || HEROES[(i+1) % HEROES.length], spawnPositions[i+1].x, spawnPositions[i+1].y, false, {}, s.teamId ?? 1, -1))
    : cpuSlots.map(s => createChar(s.hero || HEROES[s._origIdx % HEROES.length], spawnPositions[s._origIdx].x, spawnPositions[s._origIdx].y, false, {}, s.teamId ?? 1, -1));

  // In spectator mode, AI also runs on the watched char
  const enemyChars = isSpectator ? [playerChars[0], ...aiChars] : aiChars;

  // Apply match settings
  MATCH_DURATION = matchDuration;

  gameState = {
    W, H,
    teamKills,
    teamIds,
    maxKills: matchKillLimit,
    get kills() { return { p: teamKills[0]??0, e: teamKills[1]??0 }; },
    time: 0,
    over: false,
    spectator: isSpectator,
    countdown: 3.0,
    winner: null,
    // gs.players[] = all human-controlled chars (1–4)
    // gs.player    = gs.players[0] alias for backward compatibility
    players: playerChars,
    get player() { return this.players[0]; },
    enemies: enemyChars,
    projectiles: [],
    effects: [],
    floatDmgs: [],
    hazards: [],
    items: [],
    itemSpawnTimer: 0,
    weatherZones: [],
    weatherSpawnTimer: 20,
    deaths: 0,
    assists: 0,
    playerDeaths: 0,
    arena: { scale: 1.0 },
    gates: null,
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
      const p1 = gameState.players?.[0];
      if (p1) { p1._lockedTarget = tapped; p1._manualLock = true; }
      showFloatText(tapped.x, tapped.y - 50, 'LOCKED', PLAYER_COLORS[0]);
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

  // P2 HUD elements
  gameState._p2CdEls    = ['p2-cd-q','p2-cd-e','p2-cd-r'].map(id => document.getElementById(id));
  gameState._p2CdSprint = document.getElementById('p2-cd-sprint');
  gameState._p2CdSpecial = document.getElementById('p2-cd-special');
  gameState._p2CdRockbuster = document.getElementById('p2-cd-rockbuster');
  gameState._p2SpecialLabel = document.getElementById('p2-special-btn-label');

  // Show P2 overlay if there's a second human player
  const p2overlay = document.getElementById('controls-p2');
  const hasP2 = gameState.players.length > 1;
  if (p2overlay) p2overlay.style.display = hasP2 ? '' : 'none';
  // mp-mode class shifts P1 controls to bottom-left and shows P2 bottom-right
  document.body.classList.toggle('mp-mode', hasP2);

  // Populate P2 ability names if P2 exists
  if (hasP2) {
    const p2 = gameState.players[1];
    const p2names = ['p2-ab-name-q','p2-ab-name-e','p2-ab-name-r'];
    p2names.forEach((id, i) => {
      const el = document.getElementById(id);
      if (el) el.textContent = p2.hero?.abilities[i]?.name ?? '';
    });
    if (gameState._p2SpecialLabel) {
      const cls = p2.combatClass;
      gameState._p2SpecialLabel.textContent = cls === 'melee' ? 'SLAM' : cls === 'hybrid' ? 'SURGE' : 'FOCUS';
    }
  }

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

function createChar(hero, x, y, isPlayer, itemMods={}, teamId=0, playerIdx=0) {
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
    _playerIdx: isPlayer ? playerIdx : -1, // index into gs.players[] (-1 = AI)
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
    // ── Target lock (per human player) ──
    _lockedTarget: null,
    _manualLock: false,
    // ── Input (per human player — set each frame by pollGamepad/keyboard) ──
    _joyDelta: { x: 0, y: 0 },
    // ── New mechanics state ──
    ccedTimer: 0,
    momentumStacks: 0,
    momentumTimer: 0,
    weaveWindow: 0,
    // ── Passive state ──
    passiveStacks: 0,
    passiveCooldown: 0,
    passiveReady: false,
    passiveActive: 0,
    // ── Sprint state ──
    sprintCd: 0,
    sprintTimer: 0,
    sprintMult: 1,
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
  const alivePlayers = gs.players.filter(p => p.alive);
  if (!alivePlayers.length) return;

  let targetX, targetY;

  if (alivePlayers.length === 1) {
    // Single player — follow them directly
    targetX = alivePlayers[0].x - VIEW_W / 2;
    targetY = alivePlayers[0].y - VIEW_H / 2;
  } else {
    // Multiple players — frame bounding box with padding
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of alivePlayers) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
    const PAD = 220; // padding around outermost players
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    targetX = cx - VIEW_W / 2;
    targetY = cy - VIEW_H / 2;

    // Zoom out when players are spread — stored on gs for rendering scale
    const spanX = (maxX - minX + PAD * 2) / VIEW_W;
    const spanY = (maxY - minY + PAD * 2) / VIEW_H;
    const desiredZoom = Math.max(1.0, Math.min(2.2, Math.max(spanX, spanY)));
    gs._cameraZoom = gs._cameraZoom ?? 1.0;
    gs._cameraZoom += (desiredZoom - gs._cameraZoom) * 0.06; // smooth
  }

  const lerpSpeed = 0.12;
  camera.x += (targetX - camera.x) * lerpSpeed;
  camera.y += (targetY - camera.y) * lerpSpeed;

  camera.x = Math.max(0, Math.min(WORLD_W - VIEW_W, camera.x));
  camera.y = Math.max(0, Math.min(WORLD_H - VIEW_H, camera.y));

  // Snap on warp
  const snapThreshold = WORLD_W * 0.4;
  if (Math.abs(targetX - camera.x) > snapThreshold) camera.x = Math.max(0, Math.min(WORLD_W - VIEW_W, targetX));
  if (Math.abs(targetY - camera.y) > snapThreshold) camera.y = Math.max(0, Math.min(WORLD_H - VIEW_H, targetY));

  // Screen shake
  if (gs._screenShake > 0) {
    gs._screenShake *= 0.82;
    if (gs._screenShake < 0.3) gs._screenShake = 0;
    camera.x = Math.max(0, Math.min(WORLD_W - VIEW_W, camera.x + (Math.random() - 0.5) * 2 * gs._screenShake));
    camera.y = Math.max(0, Math.min(WORLD_H - VIEW_H, camera.y + (Math.random() - 0.5) * 2 * gs._screenShake));
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
    console.error('[Elemental Clash] gameLoop error:', err, err?.stack);
  }
  animFrame = requestAnimationFrame(gameLoop);
}

function update(gs) {
  const dt = gs._dt ?? 1/60;
  pollGamepad(gs);
  if (window._updateKeyboardJoy) window._updateKeyboardJoy();

  // ── Cache allChars once per frame (avoids 6–8 repeated spread allocations) ──
  gs._allChars = [...gs.players, ...gs.enemies];
  gs._allCharsAlive = gs._allChars.filter(c => c?.alive);

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
      const allChars = gs._allChars;
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
  const allCharsForWeather = gs._allChars;
  allCharsForWeather.forEach(c => { if (c.alive) applyWeatherToChar(c, gs, dt); });

  // Player movement — runs for every human player
  for (const p of gs.players) {
    if (gs.spectator) continue;

    if (p.alive) {
      p.stunned = Math.max(0, p.stunned - dt);
      p.frozen  = Math.max(0, p.frozen  - dt);
      if ((p.spawnInvuln ?? 0) > 0) p.spawnInvuln = Math.max(0, p.spawnInvuln - dt);

      if (p.velX === undefined) { p.velX = 0; p.velY = 0; }

      if (p.stunned <= 0 && p.frozen <= 0) {
        const spdMult = 2.5;
        const topSpeed = p.speed * spdMult * (p.weatherSpeedMult ?? 1)
          * (p.sprintMult ?? 1)
          * (p.hp / p.maxHp < 0.25 ? 0.78 : 1)
          * (p._bhSpeedMult ?? 1);

        // P1 uses the global joyDelta (keyboard/touch/gamepad0 all write here — identical to pre-multiplayer)
        // P2+ use their own _joyDelta written by their gamepad in pollGamepad
        const joy = (p._playerIdx === 0) ? joyDelta : (p._joyDelta ?? { x:0, y:0 });
        const inputLen = Math.hypot(joy.x, joy.y);
        const targetVX = joy.x * topSpeed;
        const targetVY = joy.y * topSpeed;

        const accelT = 0.10;
        const decelT = 0.08;
        if (inputLen > 0.01) {
          const alpha = Math.min(1, dt / accelT);
          p.velX += (targetVX - p.velX) * alpha;
          p.velY += (targetVY - p.velY) * alpha;
          p.facing = joy.x > 0 ? 1 : joy.x < 0 ? -1 : p.facing;
        } else {
          const alpha = Math.min(1, dt / decelT);
          p.velX *= (1 - alpha);
          p.velY *= (1 - alpha);
          if (Math.hypot(p.velX, p.velY) < 0.05) { p.velX = 0; p.velY = 0; }
        }

        p.x += p.velX;
        p.y += p.velY;
        warpChar(p, gs.W, gs.H);
        resolveObstacleCollisions(p, gs);
        p.vx = p.velX;
        p.vy = p.velY;
      } else {
        p.velX *= 0.6;
        p.velY *= 0.6;
        p.vx = 0; p.vy = 0;
      }

      p.meleeTerrainDefBonus = 0;
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

      if ((p.sprintTimer ?? 0) > 0) {
        p.sprintTimer = Math.max(0, p.sprintTimer - dt);
        if (p.sprintTimer <= 0) p.sprintMult = 1;
      }
      if ((p.sprintCd ?? 0) > 0)  p.sprintCd  = Math.max(0, p.sprintCd  - dt);
      if ((p.specialCd ?? 0) > 0) p.specialCd = Math.max(0, p.specialCd - dt);

      if (p.ccedTimer > 0) {
        p.ccedTimer = Math.max(0, p.ccedTimer - dt);
        if (p.ccedTimer <= 0 && p._baseSpeed && p.speed < p._baseSpeed) p.speed = p._baseSpeed;
      }
      if (p.weaveWindow  > 0) p.weaveWindow  = Math.max(0, p.weaveWindow  - dt);
      if (p.momentumTimer > 0) {
        p.momentumTimer = Math.max(0, p.momentumTimer - dt);
        if (p.momentumTimer <= 0) p.momentumStacks = 0;
      }

      PASSIVES[p.hero?.id]?.onTick?.(p, dt, gameState);

      // Auto-attack toward locked target or nearest enemy
      if (p.autoAtkTimer <= 0 && !p.stunned && !p.frozen && !p.silenced) {
        const classMult = COMBAT_CLASS[p.combatClass]?.rangeMult ?? 1.0;
        const autoRange = 180 * classMult;
        let atkTarget = null;
        const locked = getLockedTarget(gameState, p);
        if (locked && locked.alive) {
          const { dist: ld } = warpDelta(p.x, p.y, locked.x, locked.y);
          if (ld <= autoRange * 1.2) atkTarget = locked;
        }
        if (!atkTarget) {
          let nearestDist = autoRange * 1.2;
          for (const en of gs.enemies) {
            if (!en.alive || en.teamId === p.teamId) continue;
            const { dist: ed } = warpDelta(p.x, p.y, en.x, en.y);
            if (ed < nearestDist) { nearestDist = ed; atkTarget = en; }
          }
        }
        if (atkTarget) {
          p.autoAtkTimer = 1 / (p.stats?.atkSpeed ?? 1.0);
          const { dx: adx, dy: ady, dist: ad } = warpDelta(p.x, p.y, atkTarget.x, atkTarget.y);
          const adSafe = Math.max(ad, 0.1);
          const autoMult = p.combatClass === 'melee' ? 0.65 : p.combatClass === 'hybrid' ? 0.55 : 0.52;
          const autoDmg = Math.round((p.stats?.damage ?? 60) * autoMult);
          gs.projectiles.push({
            x:p.x, y:p.y,
            vx:(adx/adSafe)*9, vy:(ady/adSafe)*9,
            damage: autoDmg, radius: 5,
            life: autoRange / (9*60),
            color: p.hero.color,
            teamId: p.teamId,
            isAutoAttack: true,
            stun:0, freeze:0, slow:0, silence:0, knockback:0,
            kbDirX:adx, kbDirY:ady,
            casterStats: p.stats, casterRef: p,
          });
          p.facing = adx > 0 ? 1 : -1;
          PASSIVES[p.hero?.id]?.onAutoAttack?.(p);
        }
      }
    } else {
      // Dead — tick respawn
      p.respawnTimer -= dt;
      if (p.respawnTimer <= 0) { respawnChar(p, gs); }
      // Show respawn timer only for P1
      if (p._playerIdx === 0) {
        if (gs._respawnEl) gs._respawnEl.style.display = 'flex';
        if (gs._respawnNum) gs._respawnNum.textContent = Math.ceil(p.respawnTimer);
      }
    }
    if (p.alive && p._playerIdx === 0 && gs._respawnEl) gs._respawnEl.style.display = 'none';
  }

  // Tick kill streak timers on all alive characters
  gs._allChars.forEach(c => {
    if (!c || !c.alive) return;
    if ((c._killStreakTimer ?? 0) > 0) {
      c._killStreakTimer -= dt;
      if (c._killStreakTimer <= 0) c._killStreak = 0;
    }
  });

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
    const allChars = gs._allChars;
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

  // ── Pending shots tick (TIDE Tsunami staggered projectiles — frame-accurate, no setTimeout) ──
  if (gs._pendingShots?.length) {
    gs._pendingShots = gs._pendingShots.filter(s => {
      s.delay -= dt;
      if (s.delay > 0) return true; // not ready yet
      const c = s.casterRef;
      if (!c?.alive) return false;
      const spd = 9;
      gs.projectiles.push({
        x: c.x, y: c.y,
        vx: (s.dx / s.d) * spd, vy: (s.dy / s.d) * spd,
        damage: s.damage, flatBonus: 0,
        radius: 10, life: (s.rangeMult * 700) / (spd * 60),
        color: s.color, teamId: s.teamId,
        isAutoAttack: false,
        stun: 0, freeze: 0, slow: 0, silence: 0, knockback: 1.4,
        kbDirX: s.dx, kbDirY: s.dy,
        casterStats: c.stats, casterRef: c,
      });
      return false; // consumed
    });
  }

  // ── Hazard zones tick (flame patches, whirlpools) ────────────────────────
  if (gs.hazards?.length) {
    const allChars = gs._allCharsAlive;
    gs.hazards = gs.hazards.filter(hz => {
      hz.life -= dt;
      if (hz.life <= 0) return false;
      for (const c of allChars) {
        if (c.teamId === hz.teamId) continue; // friendly fire off
        const d = Math.hypot(c.x - hz.x, c.y - hz.y);
        if (d > hz.radius) continue;
        // Damage tick
        if (hz.dps > 0) {
          const dmg = hz.dps * dt;
          c.hp = Math.max(0, c.hp - dmg);
          if (c.hp <= 0 && c.alive) killChar(c, false, gs, hz.ownerRef);
        }
        // Slow (aftershock) — re-applies each frame while inside zone
        // speed restoration is handled by the ccedTimer expiry path in the main character tick
        if (hz.slowDuration > 0) {
          if (!c._baseSpeed) c._baseSpeed = c.speed;
          c.ccedTimer = Math.max(c.ccedTimer ?? 0, hz.slowDuration * 0.25); // short rolling refresh
          c.speed = c._baseSpeed * 0.55;
        }
        // Pull toward center (whirlpool)
        if (hz.pull > 0) {
          const nx = hz.x - c.x, ny = hz.y - c.y;
          const nd = Math.max(d, 1);
          const strength = hz.pull * dt * (1 - d / hz.radius);
          c.velX = (c.velX ?? 0) + (nx/nd) * strength;
          c.velY = (c.velY ?? 0) + (ny/nd) * strength;
        }
      }
      return true;
    });
  }

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
    const allChars = gs._allCharsAlive;
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

  // Update cooldown UI for P1 only (uses cached DOM refs)
  const p1hud = gs.player;
  if (p1hud?.alive && gs._cdEls) {
    const cdIds = ['q','e','r'];
    for(let i=0;i<3;i++) {
      const overlay = gs._cdEls[i];
      if (overlay) {
        const cd = p1hud.cooldowns[i];
        if (cd > 0) { overlay.style.display='flex'; overlay.textContent=Math.ceil(cd); }
        else overlay.style.display='none';
      }
    }
    const sprintOverlay = gs._cdSprint;
    const sprintBtn = gs._sprintBtn;
    if (sprintOverlay) {
      const scd = p1hud.sprintCd ?? 0;
      if (scd > 0) {
        sprintOverlay.style.display='flex';
        sprintOverlay.textContent = Math.ceil(scd);
        if (sprintBtn) sprintBtn.style.opacity='0.55';
      } else {
        sprintOverlay.style.display='none';
        if (sprintBtn) sprintBtn.style.opacity = (p1hud.sprintTimer??0) > 0 ? '1' : '0.9';
      }
      if (sprintBtn) sprintBtn.style.boxShadow = (p1hud.sprintTimer??0) > 0
        ? '0 0 14px 4px rgba(255,220,50,0.7)' : '';
    }
    const specialOverlay = gs._cdSpecial;
    const specialBtn     = gs._specialBtn;
    if (specialOverlay) {
      const spcd = p1hud.specialCd ?? 0;
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

  // Update cooldown UI for P2 (display-only, no touch interaction)
  const p2hud = gs.players?.[1];
  if (p2hud && gs._p2CdEls) {
    for(let i=0;i<3;i++) {
      const overlay = gs._p2CdEls[i];
      if (overlay) {
        const cd = p2hud.cooldowns[i];
        if (cd > 0) { overlay.style.display='flex'; overlay.textContent=Math.ceil(cd); }
        else overlay.style.display='none';
      }
    }
    if (gs._p2CdSprint) {
      const scd = p2hud.sprintCd ?? 0;
      if (scd > 0) { gs._p2CdSprint.style.display='flex'; gs._p2CdSprint.textContent=Math.ceil(scd); }
      else gs._p2CdSprint.style.display='none';
    }
    if (gs._p2CdSpecial) {
      const spcd = p2hud.specialCd ?? 0;
      if (spcd > 0) { gs._p2CdSpecial.style.display='flex'; gs._p2CdSpecial.textContent=Math.ceil(spcd); }
      else gs._p2CdSpecial.style.display='none';
    }
    if (gs._p2CdRockbuster) {
      const rbcd = p2hud.rockBusterCd ?? 0;
      if (rbcd > 0) { gs._p2CdRockbuster.style.display='flex'; gs._p2CdRockbuster.textContent=Math.ceil(rbcd); }
      else gs._p2CdRockbuster.style.display='none';
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

  // ── PASSIVE: FORGE Molten Core — +50% collision damage while Iron Will is active ──
  const moltenMult = PASSIVES[attacker.hero?.id]?.getMoltenCoreMult?.(attacker) ?? 1.0;
  if (moltenMult > 1) {
    dmg = Math.round(dmg * moltenMult);
    showFloatText(attacker.x, attacker.y - 40, 'MOLTEN CORE', '#aabbcc', attacker);
  }

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

  // ── EMBER mechanic twist — Inferno leaves a flame patch ──
  if (proj.casterRef?.hero?.id === 'fire' && proj.isUlt) {
    gs.hazards.push({
      type: 'flame', x: target.x, y: target.y,
      radius: 100, dps: 8, pull: 0,
      life: 3.0, maxLife: 3.0,
      teamId: proj.teamId, ownerRef: proj.casterRef,
    });
    showFloatText(target.x, target.y - 30, 'FLAME PATCH', '#ff6622', target);
  }

  if (target.hp <= 0) killChar(target, proj.casterRef?.isPlayer ?? false, gs, proj.casterRef);
}

function killChar(target, killedByPlayer, gs, attacker) {
  target.alive = false;
  target.hp = 0;
  target.respawnTimer = gs.suddenDeath ? 9999 : 3;
  target.deaths++;
  if (target.isPlayer) gs.playerDeaths = (gs.playerDeaths||0) + 1;
  // Per-player target lock reset: if any human player had this as their manual lock,
  // clear it so they auto-relock on nearest next frame
  for (const p of (gs.players ?? [])) {
    if (p._lockedTarget === target) {
      p._lockedTarget = null;
      p._manualLock = false; // auto-relock on nearest
    }
  }
  // Also clear if this dying char was a human player — clear their lock
  if (target.isPlayer) {
    target._lockedTarget = null;
    target._manualLock = false;
  }

  // Credit kill to attacker's team
  const killer = attacker || (killedByPlayer ? gs.player : null);
  const killerTeam = killer ? (killer.teamId ?? 0) : 1;
  gs.teamKills[killerTeam] = (gs.teamKills[killerTeam] || 0) + 1;
  if (killer) killer.kills = (killer.kills||0) + 1;

  const killerIsPlayer = killer && killer.isPlayer;
  const targetIsPlayer = target.isPlayer;
  const effectColor = killerIsPlayer ? '#ff4444' : '#4488ff';
  gs.effects.push({ x:target.x, y:target.y, r:0, maxR:80, life:0.5, maxLife:0.5, color:effectColor, big:true });
  // ELIMINATED — only the player who died sees this
  if (targetIsPlayer) {
    spawnFloat(target.x, target.y - 50, 'ELIMINATED!', '#ff4444', { char: target, size: 42, life: 2.0 });
    if (!gs._screenShake) gs._screenShake = 0;
    gs._screenShake = Math.max(gs._screenShake, 10);
  }
  if (killerIsPlayer) Audio.sfx.kill();
  if (targetIsPlayer) Audio.sfx.death();

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

    // ── First Blood ──
    const totalKills = Object.values(gs.teamKills).reduce((a,b) => a+b, 0);
    if (totalKills === 1 && !gs._firstBloodDone) {
      gs._firstBloodDone = true;
      if (killerIsPlayer) {
        spawnFloat(killer.x, killer.y - 80, 'FIRST BLOOD', '#ff2222', { char: killer, size: 34, life: 2.2 });
        gs.effects.push({ x:killer.x, y:killer.y, r:0, maxR:120, life:0.6, maxLife:0.6, color:'#ff2222' });
      }
    }

    // ── Multi-kill (2+ kills within 8s) ──
    killer._killStreak = (killer._killStreak || 0) + 1;
    killer._killStreakTimer = 8;
    if (killerIsPlayer) {
      if (killer._killStreak === 2) {
        spawnFloat(killer.x, killer.y - 75, 'DOUBLE KILL', '#ffaa00', { char: killer, size: 30, life: 1.8 });
      } else if (killer._killStreak === 3) {
        spawnFloat(killer.x, killer.y - 75, 'TRIPLE KILL!', '#ff4400', { char: killer, size: 34, life: 2.0 });
        gs.effects.push({ x:killer.x, y:killer.y, r:0, maxR:100, life:0.5, maxLife:0.5, color:'#ff4400' });
      } else if (killer._killStreak >= 4) {
        spawnFloat(killer.x, killer.y - 75, 'UNSTOPPABLE!!', '#ff0044', { char: killer, size: 38, life: 2.2 });
        gs.effects.push({ x:killer.x, y:killer.y, r:0, maxR:130, life:0.6, maxLife:0.6, color:'#ff0044' });
      }
    }

    // ── ON FIRE for killer at 2 momentum stacks ──
    if (killer.momentumStacks === 2) {
      if (killerIsPlayer) spawnFloat(killer.x, killer.y - 55, 'ON FIRE!', '#ff6600', { char: killer, size: 28, life: 1.6 });
      if (killer.isPlayer) Audio.sfx.onFire();
    }

    // ── KILL text — player kills only ──
    if (killerIsPlayer) {
      spawnFloat(killer.x, killer.y - 65, 'KILL!', '#44ff88', { char: killer, size: 32, life: 1.5 });
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
  document.body.classList.remove('in-game', 'mp-mode');
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

