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
    countdown: 4.0,
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
    isTutorial: window._isTutorial ?? false,
    tutorial: {},
  };

  // Tutorial: give dummy massive HP; zero player's ultimate cooldown so they can try it immediately
  if (gameState.isTutorial) {
    gameState.enemies.forEach(e => {
      if (e._tutorialImmortal) { e.hp = 99999; e.maxHp = 99999; }
    });
    gameState.players.forEach(p => { p.cooldowns[2] = 0; });
  }

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
  // ── Tap-to-lock: touch tap on enemy locks onto them, tap empty space clears lock ──
  canvas.addEventListener('touchstart', e => {
    for (const t of e.changedTouches) { t._tapStartX = t.clientX; t._tapStartY = t.clientY; }
  }, { passive: true });
  canvas.addEventListener('touchend', e => {
    if (!gameState || gameState.over) return;
    if (!document.body.classList.contains('touch-mode')) return;
    const touch = e.changedTouches[0];
    if (!touch) return;
    const moved = Math.hypot(touch.clientX - (touch._tapStartX ?? touch.clientX),
                             touch.clientY - (touch._tapStartY ?? touch.clientY));
    if (moved > 20) return; // drag, not a tap
    const rect = canvas.getBoundingClientRect();
    const {x: wx, y: wy} = screenToWorld(touch.clientX - rect.left, touch.clientY - rect.top);
    const humans = gameState.players ?? [gameState.player];
    const tapper = humans.filter(p => p?.alive).reduce((best, p) =>
      !best || Math.hypot(p.x-wx,p.y-wy) < Math.hypot(best.x-wx,best.y-wy) ? p : best, null);
    if (!tapper) return;
    const tapped = gameState.enemies.filter(en => en.alive)
      .find(en => Math.hypot(en.x-wx, en.y-wy) < en.radius + 28);
    if (tapped) {
      tapper._lockedTarget = tapped;
      tapper._manualLock = true;
      showFloatText(tapped.x, tapped.y - 50, 'LOCKED', PLAYER_COLORS[tapper._playerIdx ?? 0]);
      if (gameState.isTutorial) { gameState.tutorial = gameState.tutorial || {}; gameState.tutorial._targetLocked = true; }
    } else {
      tapper._lockedTarget = null;
      tapper._manualLock = false;
    }
    e.preventDefault();
  }, { passive: false });
  setupKeyboard();
  // ── DEV SAFETY NET: verify setupKeyboard ran ──────────────────────────────
  // If this fires, a str_replace dropped setupKeyboard() from initGame() again.
  window._keyboardSetupDone = true;
  setTimeout(() => {
    if (!window._keyboardReady) {
      console.error(
        '%c⚠ KEYBOARD BUG DETECTED — setupKeyboard() was not called in initGame().\n' +
        'Check game-loop.js — a str_replace likely dropped the setupKeyboard() call.',
        'color:#ff4444;font-size:14px;font-weight:bold;background:#1a0000;padding:4px 8px;'
      );
    }
  }, 1000);
  // ─────────────────────────────────────────────────────────────────────────
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

  // Target frame + per-player panes
  gameState._tfEl  = document.getElementById('target-frame');
  gameState._tfEls = ['tf-p1','tf-p2','tf-p3','tf-p4'].map(id => document.getElementById(id));
  gameState._weatherPillEl = document.getElementById('weather-player-pill');

  // P2 HUD elements
  gameState._p2CdEls    = ['p2-cd-q','p2-cd-e','p2-cd-r'].map(id => document.getElementById(id));
  gameState._p2CdSprint = document.getElementById('p2-cd-sprint');
  gameState._p2CdSpecial = document.getElementById('p2-cd-special');
  gameState._p2CdRockbuster = document.getElementById('p2-cd-rockbuster');
  gameState._p2SpecialLabel = document.getElementById('p2-special-btn-label');

  // P3 HUD elements
  gameState._p3CdEls       = ['p3-cd-q','p3-cd-e','p3-cd-r'].map(id => document.getElementById(id));
  gameState._p3CdSprint    = document.getElementById('p3-cd-sprint');
  gameState._p3CdSpecial   = document.getElementById('p3-cd-special');
  gameState._p3CdRockbuster= document.getElementById('p3-cd-rockbuster');
  gameState._p3SpecialLabel= document.getElementById('p3-special-btn-label');

  // P4 HUD elements
  gameState._p4CdEls       = ['p4-cd-q','p4-cd-e','p4-cd-r'].map(id => document.getElementById(id));
  gameState._p4CdSprint    = document.getElementById('p4-cd-sprint');
  gameState._p4CdSpecial   = document.getElementById('p4-cd-special');
  gameState._p4CdRockbuster= document.getElementById('p4-cd-rockbuster');
  gameState._p4SpecialLabel= document.getElementById('p4-special-btn-label');

  // Show/hide player overlays based on human count
  const p2overlay = document.getElementById('controls-p2');
  const p3overlay = document.getElementById('controls-p3');
  const p4overlay = document.getElementById('controls-p4');
  const hasP2 = gameState.players.length > 1;
  const hasP3 = gameState.players.length > 2;
  const hasP4 = gameState.players.length > 3;
  if (p2overlay) p2overlay.style.display = hasP2 ? '' : 'none';
  if (p3overlay) p3overlay.style.display = hasP3 ? '' : 'none';
  if (p4overlay) p4overlay.style.display = hasP4 ? '' : 'none';

  // Body mode classes — drive CSS layout for 2/3/4 player
  document.body.classList.remove('mp-mode', 'mp3-mode', 'mp4-mode');
  if (hasP4)      { document.body.classList.add('mp-mode', 'mp3-mode', 'mp4-mode'); }
  else if (hasP3) { document.body.classList.add('mp-mode', 'mp3-mode'); }
  else if (hasP2) { document.body.classList.add('mp-mode'); }

  // In MP, always default to gamepad layout — two players means two controllers
  if (hasP2) {
    document.body.classList.remove('keyboard-mode', 'touch-mode');
    document.body.classList.add('gamepad-mode');
  }

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

  // Populate P3 ability names if P3 exists
  if (hasP3) {
    const p3 = gameState.players[2];
    ['p3-ab-name-q','p3-ab-name-e','p3-ab-name-r'].forEach((id, i) => {
      const el = document.getElementById(id);
      if (el) el.textContent = p3.hero?.abilities[i]?.name ?? '';
    });
    if (gameState._p3SpecialLabel) {
      const cls = p3.combatClass;
      gameState._p3SpecialLabel.textContent = cls === 'melee' ? 'SLAM' : cls === 'hybrid' ? 'SURGE' : 'FOCUS';
    }
  }

  // Populate P4 ability names if P4 exists
  if (hasP4) {
    const p4 = gameState.players[3];
    ['p4-ab-name-q','p4-ab-name-e','p4-ab-name-r'].forEach((id, i) => {
      const el = document.getElementById(id);
      if (el) el.textContent = p4.hero?.abilities[i]?.name ?? '';
    });
    if (gameState._p4SpecialLabel) {
      const cls = p4.combatClass;
      gameState._p4SpecialLabel.textContent = cls === 'melee' ? 'SLAM' : cls === 'hybrid' ? 'SURGE' : 'FOCUS';
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

  // Tutorial tip removed — not always relevant to the active control scheme
}

function createChar(hero, x, y, isPlayer, itemMods={}, teamId=0, playerIdx=0) {
  const d = derivedStats(hero, itemMods);
  const baseHp   = d.hp;
  const baseMana = 80 + (hero.baseStats.manaRegen ?? 50) * 1.4;
  const stats = { ...d };
  // Sprite size: all heroes within a tight 24–27px band (Stone reference, slightly smaller)
  // Formula: base 24 + small defense contribution (max ~2px) + fine-tune per hero
  const _sizeOverride = {
    earth:     1,   // Stone — reference, slightly bigger
    metal:     1,   // Forge — similarly tanky
    water:     0,   // Tide
    nature:    0,   // Flora
    arcane:    0,   // Myst
    ice:      -1,   // Frost
    shadow:   -1,   // Void
    lightning: -1,  // Volt
    fire:     -1,   // Ember
    wind:     -2,   // Gale — lightest feel
  };
  return {
    hero, x, y, isPlayer, teamId,
    _playerIdx: isPlayer ? playerIdx : -1, // index into gs.players[] (-1 = AI)
    hp: baseHp, maxHp: baseHp,
    mana: baseMana, maxMana: baseMana,
    speed: stats.mobility,
    radius: 23 + (hero.baseStats.defense / 100) * 3 + (_sizeOverride[hero.id] ?? 0),
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
// VIEW_H is the fixed axis (always 900). VIEW_W expands on wider screens
// so phones show more of the arena sideways instead of getting black bars.
// Think of it like a wider FOV — you see more, not a zoomed-in view.
const WORLD_W = 3200;
const WORLD_H = 1800;
let   VIEW_W  = 1600;  // recalculated in resizeCanvas() to match screen aspect
const VIEW_H  = 900;

// Camera state — smooth follow
const camera = { x: 0, y: 0 };  // top-left corner of viewport in world coords

function updateCamera(gs) {
  // ── Spectator mode: follow watched character ──
  if (gs.spectator) {
    // Init spectate index if needed
    if (gs._spectateIdx === undefined) gs._spectateIdx = 0;
    const allMatchChars = [...(gs.players ?? []), ...gs.enemies];
    // Keep index valid
    if (gs._spectateIdx >= allMatchChars.length) gs._spectateIdx = 0;
    gs._spectateChar = allMatchChars[gs._spectateIdx] ?? allMatchChars[0];
    // If current watched char is dead, auto-advance to next alive one
    if (gs._spectateChar && !gs._spectateChar.alive) {
      const aliveIdx = allMatchChars.findIndex((c, i) => i !== gs._spectateIdx && c.alive);
      if (aliveIdx >= 0) gs._spectateIdx = aliveIdx;
      gs._spectateChar = allMatchChars[gs._spectateIdx];
    }
    if (gs._spectateChar) {
      const targetX = gs._spectateChar.x - VIEW_W / 2;
      const targetY = gs._spectateChar.y - VIEW_H / 2;
      camera.x += (targetX - camera.x) * 0.12;
      camera.y += (targetY - camera.y) * 0.12;
      camera.x = Math.max(0, Math.min(WORLD_W - VIEW_W, camera.x));
      camera.y = Math.max(0, Math.min(WORLD_H - VIEW_H, camera.y));
    }
    return;
  }

  const alivePlayers = gs.players.filter(p => p.alive);
  if (!alivePlayers.length) return;

  let targetX, targetY;

  if (alivePlayers.length === 1) {
    // Single player — follow them directly, smoothly reset zoom
    targetX = alivePlayers[0].x - VIEW_W / 2;
    targetY = alivePlayers[0].y - VIEW_H / 2;
    gs._cameraZoom = gs._cameraZoom ?? 1.0;
    gs._cameraZoom += (1.0 - gs._cameraZoom) * 0.06; // lerp back to 1x
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

  // Extend the viewport width to match the screen's aspect ratio.
  // VIEW_H stays fixed at 900 — VIEW_W grows on wider screens.
  // This eliminates black bars on any aspect ratio without clipping.
  VIEW_W = Math.round(VIEW_H * (sw / sh));
  // Cap so we never exceed the world width
  VIEW_W = Math.min(VIEW_W, WORLD_W);

  canvas.width  = Math.round(sw * dpr);
  canvas.height = Math.round(sh * dpr);

  canvas.style.width    = sw + 'px';
  canvas.style.height   = sh + 'px';
  canvas.style.position = 'absolute';
  canvas.style.top      = '0';
  canvas.style.left     = '0';

  // Scale to fill exactly — no bars, no clipping
  const scale   = (sh * dpr) / VIEW_H;
  const offsetX = ((sw * dpr) - VIEW_W * scale) / 2;
  const offsetY = 0;  // always fills full height

  canvas._worldScale   = scale;
  canvas._worldOffsetX = offsetX;
  canvas._worldOffsetY = offsetY;
  canvas._dpr          = dpr;

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
// ── Spectator overlay update ────────────────────────────────────────────────
// Cached spectator overlay elements — populated once, reused every frame
const _specCache = { nameEl:null, hpBar:null, hpVal:null, manaBar:null, manaVal:null, abEl:null, lastChar:null };

function _buildSpecAbilityButtons(c, abEl) {
  abEl.innerHTML = '';
  const abilities = c.hero?.abilities ?? [];
  abilities.forEach((ab, i) => {
    const btn = document.createElement('div');
    btn.className = 'spec-ab-btn' + (i === 2 ? ' spec-ab-ult' : '');
    btn.dataset.abIdx = i;
    const iconDiv = document.createElement('div'); iconDiv.className = 'spec-ab-icon'; iconDiv.textContent = ab.icon ?? '⚡';
    const nameDiv = document.createElement('div'); nameDiv.className = 'spec-ab-name'; nameDiv.textContent = ab.name.length > 7 ? ab.name.slice(0, 6) + '…' : ab.name;
    const cdDiv   = document.createElement('div'); cdDiv.className = 'spec-ab-cd'; cdDiv.dataset.abCd = i;
    btn.appendChild(iconDiv); btn.appendChild(nameDiv); btn.appendChild(cdDiv);
    abEl.appendChild(btn);
  });
  const cls = c.combatClass ?? 'hybrid';
  const specLabels = { melee:'SLAM', hybrid:'SURGE', ranged:'FOCUS' };
  const specIcons  = { melee:'💥', hybrid:'🌀', ranged:'🎯' };
  const specBtn = document.createElement('div'); specBtn.className = 'spec-ab-btn spec-ab-special'; specBtn.dataset.specCd = '1';
  const sI = document.createElement('div'); sI.className = 'spec-ab-icon'; sI.textContent = specIcons[cls] ?? '💥';
  const sN = document.createElement('div'); sN.className = 'spec-ab-name'; sN.textContent = specLabels[cls] ?? 'SPEC';
  const sC = document.createElement('div'); sC.className = 'spec-ab-cd'; sC.dataset.specCdEl = '1';
  specBtn.appendChild(sI); specBtn.appendChild(sN); specBtn.appendChild(sC); abEl.appendChild(specBtn);
  const rbBtn = document.createElement('div'); rbBtn.className = 'spec-ab-btn spec-ab-special'; rbBtn.dataset.rbCd = '1';
  const rI = document.createElement('div'); rI.className = 'spec-ab-icon'; rI.textContent = '🪨';
  const rN = document.createElement('div'); rN.className = 'spec-ab-name'; rN.textContent = 'BUSTER';
  const rC = document.createElement('div'); rC.className = 'spec-ab-cd'; rC.dataset.rbCdEl = '1';
  rbBtn.appendChild(rI); rbBtn.appendChild(rN); rbBtn.appendChild(rC); abEl.appendChild(rbBtn);
}

function updateSpectatorOverlay(gs) {
  window.updateSpectatorOverlay = updateSpectatorOverlay;
  const c = gs._spectateChar;
  if (!c) return;

  // Lazily cache element references once
  if (!_specCache.nameEl) {
    _specCache.nameEl  = document.getElementById('spec-hero-name');
    _specCache.hpBar   = document.getElementById('spec-hp-bar');
    _specCache.hpVal   = document.getElementById('spec-hp-val');
    _specCache.manaBar = document.getElementById('spec-mana-bar');
    _specCache.manaVal = document.getElementById('spec-mana-val');
    _specCache.abEl    = document.getElementById('spec-abilities');
  }
  const { nameEl, hpBar, hpVal, manaBar, manaVal, abEl } = _specCache;
  if (!nameEl || !hpBar || !manaBar || !abEl) return;

  // Rebuild button structure only when character changes
  if (_specCache.lastChar !== c) {
    _specCache.lastChar = c;
    nameEl.textContent = c.hero.name;
    nameEl.style.color = c.hero.color;
    _buildSpecAbilityButtons(c, abEl);
  }

  // Update bars (cheap — just style.width strings)
  const hpPct = Math.max(0, c.hp / c.maxHp);
  const hpCol = hpPct > 0.5 ? '#44ff88' : hpPct > 0.25 ? '#ffaa44' : '#ff4444';
  hpBar.style.width = `${hpPct * 100}%`;
  hpBar.style.background = hpCol;
  hpVal.textContent = `${Math.ceil(c.hp)} / ${Math.ceil(c.maxHp)}`;
  const manaPct = Math.min(1, (c.mana ?? 0) / (c.maxMana ?? 80));
  manaBar.style.width = `${manaPct * 100}%`;
  manaVal.textContent = `${Math.floor(c.mana ?? 0)} / ${Math.floor(c.maxMana ?? 80)} MP`;

  // Update cooldown numbers in-place (no DOM creation)
  abEl.querySelectorAll('[data-ab-cd]').forEach(cdEl => {
    const i  = parseInt(cdEl.dataset.abCd);
    const cd = c.cooldowns?.[i] ?? 0;
    const btn = cdEl.parentElement;
    if (cd > 0.2) { cdEl.style.display = 'flex'; cdEl.textContent = Math.ceil(cd); btn.classList.remove('spec-ab-ready'); }
    else          { cdEl.style.display = 'none';  cdEl.textContent = '';            btn.classList.add('spec-ab-ready'); }
  });
  const specCdEl = abEl.querySelector('[data-spec-cd-el]');
  if (specCdEl) {
    const v = c.specialCd ?? 0;
    const btn = specCdEl.parentElement;
    if (v > 0.2) { specCdEl.style.display = 'flex'; specCdEl.textContent = Math.ceil(v); btn.classList.remove('spec-ab-ready'); }
    else         { specCdEl.style.display = 'none';  specCdEl.textContent = '';           btn.classList.add('spec-ab-ready'); }
  }
  const rbCdEl = abEl.querySelector('[data-rb-cd-el]');
  if (rbCdEl) {
    const v = c.rockBusterCd ?? 0;
    const btn = rbCdEl.parentElement;
    if (v > 0.2) { rbCdEl.style.display = 'flex'; rbCdEl.textContent = Math.ceil(v); btn.classList.remove('spec-ab-ready'); }
    else         { rbCdEl.style.display = 'none';  rbCdEl.textContent = '';           btn.classList.add('spec-ab-ready'); }
  }
}

function gameLoop(timestamp) {
  if (!gameState || gameState.over) return;
  try {
    const gs = gameState;
    const now = timestamp ?? performance.now();
    if (!gs._lastTimestamp || (now - gs._lastTimestamp) > 200) {
      gs._lastTimestamp = now;
    }
    const dt = Math.min((now - gs._lastTimestamp) / 1000, 1/30);
    gs._lastTimestamp = now;
    gs._dt = dt;

    gs.time = Math.max(0, (Date.now() - gameStartTime) / 1000);
    _spriteFrameCount++;
    update(gs);
    updateCamera(gs);
    render(gs);
    drawHUD(gs);
    renderOffScreenIndicators(gs);
    // Tutorial tick — track player actions for checklist
    if (gs.isTutorial && typeof Tutorial !== 'undefined') Tutorial.tick(gs, gs._dt ?? 1/60);
    if (gs.spectator) {
      updateSpectatorOverlay(gs);
      _tickSpectatorFeed(gs, dt);
      _drawSpectatorFeed(gs);
    } else {
      _tickPlayerFeed(gs, dt);
      _drawPlayerFeed(gs);
    }
  } catch(err) {
    console.error('[Elemental Clash] gameLoop error:', err, err?.stack);
    // Reset canvas state — if render() threw mid-save, the save stack leaks.
    // A runaway leak eventually saturates the browser's canvas transform stack
    // and silently stops rendering even though the loop keeps running.
    try {
      ctx.restore(); ctx.restore(); ctx.restore();
      ctx.restore(); ctx.restore(); ctx.restore();
    } catch(_) {}
    try { ctx.resetTransform(); } catch(_) {}
    try { ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; } catch(_) {}
  }
  if (!gamePaused) animFrame = requestAnimationFrame(gameLoop);
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
    const prev = gs.countdown;
    gs.countdown = Math.max(0, gs.countdown - dt);
    // Beep on each whole second crossing (3→2→1→GO)
    if (Math.floor(prev) !== Math.floor(gs.countdown)) {
      if (Math.floor(prev) === 1) Audio.sfx.countdownBeep(true);  // crossing 1→0 = GO!
      else Audio.sfx.countdownBeep(false);                         // 3→2, 2→1
    }
    return; // freeze all gameplay — render still runs
  }

  // ── Match timer ──────────────────────────────────────────────────────────
  const remaining = isFinite(MATCH_DURATION) ? Math.max(0, MATCH_DURATION - gs.time) : Infinity;
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
        // Tick down heatwave kill speed burst timer
        if ((p._heatwaveKillTimer ?? 0) > 0) p._heatwaveKillTimer -= dt;
        const heatwaveBurst = (p._heatwaveKillTimer ?? 0) > 0 && p._weatherKillSpeedBurst
          ? p._weatherKillSpeedBurst.mult : 1;
        const topSpeed = p.speed * spdMult * (p.weatherSpeedMult ?? 1)
          * (p.sprintMult ?? 1)
          * (p.hp / p.maxHp < 0.25 ? 0.78 : 1)
          * (p._bhSpeedMult ?? 1)
          * heatwaveBurst;

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
      if ((p._comboTimer ?? 0) > 0) {
        p._comboTimer = Math.max(0, p._comboTimer - dt);
        if (p._comboTimer <= 0) p._comboStacks = 0;
      }

      PASSIVES[p.hero?.id]?.onTick?.(p, dt, gameState);

      // Auto-attack toward locked target or nearest enemy
      if (p.autoAtkTimer <= 0 && !p.stunned && !p.frozen && !p.silenced && !(p.spawnInvuln > 0)) {
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
          const autoMult = p.combatClass === 'melee' ? 1.0 : p.combatClass === 'hybrid' ? 0.75 : 0.52;
          const autoDmg = Math.round((p.stats?.damage ?? 60) * autoMult);
          // Melee: stationary slash at caster position with large radius covering melee range
          if (p.combatClass === 'melee') {
            gs.projectiles.push({
              x: p.x, y: p.y,
              vx: 0, vy: 0,
              damage: autoDmg, radius: autoRange * 0.85,
              life: 0.07,
              color: p.hero.color,
              teamId: p.teamId,
              isAutoAttack: true,
              isMeleeSlash: true,
              slashAngle: Math.atan2(ady, adx),
              slashBorn: performance.now(),
              stun:0, freeze:0, slow:0, silence:0, knockback:0,
              kbDirX:adx, kbDirY:ady,
              casterStats: p.stats, casterRef: p,
            });
          } else {
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
          }
          p.facing = adx > 0 ? 1 : -1;
          Audio.sfx.autoAttack(p.hero?.id);
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
        // Melee slash: only hit enemies within the forward arc (135°)
        if (proj.isMeleeSlash) {
          const dot = dx * proj.kbDirX + dy * proj.kbDirY;
          const len = Math.hypot(dx, dy) * Math.hypot(proj.kbDirX, proj.kbDirY);
          if (len > 0 && dot / len < -0.38) continue; // behind caster — skip
        }
        applyHit(t, proj, gs);
        if (!proj.piercing) return false;
      }
    }
    return true;
  });

  // Effects — reverse-splice to avoid array allocation every frame
  for (let i = gs.effects.length - 1; i >= 0; i--) {
    gs.effects[i].life -= dt;
    if (gs.effects[i].life <= 0) gs.effects.splice(i, 1);
  }

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
        // Pull toward center (whirlpool) — quadratic falloff, strong across whole zone
        if (hz.pull > 0) {
          const nx = hz.x - c.x, ny = hz.y - c.y;
          const nd = Math.max(d, 1);
          const falloff = Math.pow(1 - d / hz.radius, 0.5); // sqrt: strong even near edge
          const strength = hz.pull * dt * falloff;
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

  // Update cooldown UI for P3
  const p3hud = gs.players?.[2];
  if (p3hud && gs._p3CdEls) {
    for(let i=0;i<3;i++) {
      const overlay = gs._p3CdEls[i];
      if (overlay) {
        const cd = p3hud.cooldowns[i];
        if (cd > 0) { overlay.style.display='flex'; overlay.textContent=Math.ceil(cd); }
        else overlay.style.display='none';
      }
    }
    if (gs._p3CdSprint) {
      const scd = p3hud.sprintCd ?? 0;
      if (scd > 0) { gs._p3CdSprint.style.display='flex'; gs._p3CdSprint.textContent=Math.ceil(scd); }
      else gs._p3CdSprint.style.display='none';
    }
    if (gs._p3CdSpecial) {
      const spcd = p3hud.specialCd ?? 0;
      if (spcd > 0) { gs._p3CdSpecial.style.display='flex'; gs._p3CdSpecial.textContent=Math.ceil(spcd); }
      else gs._p3CdSpecial.style.display='none';
    }
    if (gs._p3CdRockbuster) {
      const rbcd = p3hud.rockBusterCd ?? 0;
      if (rbcd > 0) { gs._p3CdRockbuster.style.display='flex'; gs._p3CdRockbuster.textContent=Math.ceil(rbcd); }
      else gs._p3CdRockbuster.style.display='none';
    }
  }

  // Update cooldown UI for P4
  const p4hud = gs.players?.[3];
  if (p4hud && gs._p4CdEls) {
    for(let i=0;i<3;i++) {
      const overlay = gs._p4CdEls[i];
      if (overlay) {
        const cd = p4hud.cooldowns[i];
        if (cd > 0) { overlay.style.display='flex'; overlay.textContent=Math.ceil(cd); }
        else overlay.style.display='none';
      }
    }
    if (gs._p4CdSprint) {
      const scd = p4hud.sprintCd ?? 0;
      if (scd > 0) { gs._p4CdSprint.style.display='flex'; gs._p4CdSprint.textContent=Math.ceil(scd); }
      else gs._p4CdSprint.style.display='none';
    }
    if (gs._p4CdSpecial) {
      const spcd = p4hud.specialCd ?? 0;
      if (spcd > 0) { gs._p4CdSpecial.style.display='flex'; gs._p4CdSpecial.textContent=Math.ceil(spcd); }
      else gs._p4CdSpecial.style.display='none';
    }
    if (gs._p4CdRockbuster) {
      const rbcd = p4hud.rockBusterCd ?? 0;
      if (rbcd > 0) { gs._p4CdRockbuster.style.display='flex'; gs._p4CdRockbuster.textContent=Math.ceil(rbcd); }
      else gs._p4CdRockbuster.style.display='none';
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

  // Slow instead of knockback — collision is sticky, forces target to escape
  const baseSpd = target._baseSpeed ?? target.stats?.mobility ?? target.speed;
  const slowDur = 0.35 + velScale * 0.25; // 0.35–0.60s based on charge speed
  if ((target.ccedTimer ?? 0) < slowDur) {
    target._baseSpeed = target._baseSpeed ?? target.speed;
    target.speed = baseSpd * 0.40; // 60% speed reduction
    target.ccedTimer = slowDur;
    setTimeout(() => {
      if (target && target._baseSpeed) {
        target.speed = target._baseSpeed;
        target._baseSpeed = undefined;
      }
    }, slowDur * 1000);
  }

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
    const winTeam = checkWinCondition(gs);
    if (winTeam !== null) endGame(gs, winTeam);
  }
}

function applyHit(target, proj, gs) {
  if (!target.alive) return;
  if ((target.spawnInvuln ?? 0) > 0) return;
  const caster = proj.casterRef;

  // Tutorial: track auto-attack hits by player
  if (gs?.isTutorial && proj.isAutoAttack && caster?.isPlayer) {
    if (!gs.tutorial) gs.tutorial = {};
    gs.tutorial._autoHit = true;
  }

  // Cancel health pack heal-over-time on hit
  if (target.healRemaining > 0) {
    target.healRemaining = 0;
    target.healDuration  = 0;
    if (target.isPlayer) spawnFloat(target.x, target.y - 30, 'HEAL BROKEN!', '#ff4444', { char: target });
  }

  // ── Base damage ──
  const ap = proj.casterStats ? (proj.casterStats.abilityPower ?? 1.0) : 1.0;
  let dmg = proj.isAutoAttack ? proj.damage : Math.round(proj.damage * ap);

  // Melee in-range bonus: +20% damage when within melee range of target
  if (caster && caster.combatClass === 'melee') {
    const { dist: meleeDist } = warpDelta(caster.x, caster.y, target.x, target.y);
    const meleeRange = 180 * (COMBAT_CLASS[caster.combatClass]?.rangeMult ?? 0.55) * 1.1;
    if (meleeDist <= meleeRange) dmg = Math.round(dmg * 1.08);
  }
  // Sandstorm: melee damage surge (applies to all combat classes when close range)
  if (caster && (caster._weatherMeleeDmgMult ?? 1) > 1) {
    const { dist: sdDist } = warpDelta(caster.x, caster.y, target.x, target.y);
    const sdRange = 200;
    if (sdDist <= sdRange) dmg = Math.round(dmg * caster._weatherMeleeDmgMult);
  }

  // Ranged cornered defence: 25% DR when a melee enemy is within 120px
  if (target.combatClass === 'ranged' && caster && caster.combatClass === 'melee') {
    const { dist: cornerDist } = warpDelta(caster.x, caster.y, target.x, target.y);
    if (cornerDist < 120) {
      dmg = Math.round(dmg * 0.75);
      if (target.isPlayer) showFloatText(target.x, target.y - 50, 'EVASION', '#44ccff', target);
    }
  }
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
    if (proj.casterRef?.isPlayer) { spawnFloat(target.x, target.y, 'COMBO!', '#ff9944', { char: target }); Audio.sfx.combo(); }
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

  // 5. HYBRID COMBO SYSTEM — auto-attacks build combo stacks (max 5)
  //    Each stack = +6% ability damage, consumed on next non-auto hit
  if (proj.isAutoAttack && caster && caster.combatClass === 'hybrid') {
    caster._comboStacks = Math.min(5, (caster._comboStacks ?? 0) + 1);
    caster._comboTimer  = 4.0; // stacks expire after 4s of no autos
    if (caster.isPlayer && caster._comboStacks > 1) {
      spawnFloat(caster.x, caster.y - 30, `COMBO ×${caster._comboStacks}`, '#ffee44', { char: caster });
    }
  }
  if (!proj.isAutoAttack && caster && caster.combatClass === 'hybrid' && (caster._comboStacks ?? 0) > 0) {
    ampMult *= (1 + caster._comboStacks * 0.06); // +6% per stack
    if (caster.isPlayer) spawnFloat(caster.x, caster.y - 40, `COMBO BURST ×${caster._comboStacks}!`, '#ffee44', { char: caster });
    caster._comboStacks = 0;
    caster._comboTimer  = 0;
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

  // ── Ult single-hit cap: can't deal more than 85% of target's max HP in one hit ──
  // Prevents 100-0 sweeps. Still lethal vs targets already below 15% HP.
  if (!proj.isAutoAttack && proj.isUlt && target.maxHp) {
    dmg = Math.min(dmg, Math.round(target.maxHp * 0.85));
  }

  target.hp = Math.max(0, target.hp - dmg);

  // ── Damage-done ult cooldown reduction ──
  // Every 80 damage dealt (by any non-auto hit) shaves 1s off the caster's ult CD.
  // Capped at 40% of the ult's base CD so it can't trivially reset from one combo.
  if (!proj.isAutoAttack && caster && (caster.cooldowns?.[2] ?? 0) > 0 && dmg > 0) {
    const ultBaseCd = caster.hero?.abilities?.[2]?.cd ?? 30;
    const minCd     = ultBaseCd * 0.60; // floor: 40% max reduction
    const reduction = dmg / 80;         // 1s per 80 damage dealt
    caster.cooldowns[2] = Math.max(minCd, caster.cooldowns[2] - reduction);
  }

  // ── Plasma Storm: reflect damage back to attacker ──
  if (target.alive && (target._weatherReflect ?? 0) > 0 && caster && caster !== target && caster.alive && dmg > 0) {
    const reflectDmg = Math.round(dmg * target._weatherReflect);
    if (reflectDmg > 0) {
      caster.hp = Math.max(0, caster.hp - reflectDmg);
      if (caster.isPlayer || target.isPlayer) spawnFloat(caster.x, caster.y - 30, '\u21a9 ' + reflectDmg, '#ff9900', { char: caster, size: 14 });
    }
  }

  // ── Supercell: projectile pierces through one extra nearby enemy ──
  if (target.alive && caster && dmg > 0 && !proj._isChain && !proj.isAutoAttack
      && (caster._weatherProjPierce ?? 0) > 0) {
    const allChars = gs._allChars ?? [...(gs.players ?? [gs.player]), ...gs.enemies];
    let nearest = null, nearestDist = 180;
    for (const nearby of allChars) {
      if (!nearby.alive || nearby === target || nearby === caster) continue;
      if (nearby.teamId === caster.teamId) continue;
      const cd = Math.hypot(nearby.x - target.x, nearby.y - target.y);
      if (cd < nearestDist) { nearestDist = cd; nearest = nearby; }
    }
    if (nearest) {
      applyHit(nearest, Object.assign({}, proj, { damage: Math.round(dmg * 0.75), _isChain: true,
        casterRef: caster, casterStats: caster.stats }), gs);
      if (caster.isPlayer || target.isPlayer)
        spawnFloat(nearest.x, nearest.y - 24, '⚡ PIERCE', '#aaddff', { char: nearest, size: 12 });
    }
  }

  // ── Seismic Charge: chain damage to nearby enemies ──
  if (target.alive && (target._weatherChainRange ?? 0) > 0 && caster && dmg > 0 && !proj._isChain) {
    const chainDmg = Math.round(dmg * (target._weatherChainDmgPct ?? 0));
    if (chainDmg > 0) {
      const allChars = gs._allChars ?? [...(gs.players ?? [gs.player]), ...gs.enemies];
      for (const nearby of allChars) {
        if (!nearby.alive || nearby === target || nearby === caster) continue;
        if (nearby.teamId === caster.teamId) continue;
        const cd = Math.hypot(nearby.x - target.x, nearby.y - target.y);
        if (cd < target._weatherChainRange) {
          applyHit(nearby, Object.assign({}, proj, { damage: chainDmg, _isChain: true,
            casterRef: caster, casterStats: caster.stats }), gs);
          gs.effects.push({ x: target.x, y: target.y, r: 0, maxR: target._weatherChainRange * 0.5,
            life: 0.2, maxLife: 0.2, color: '#bb88ff' });
        }
      }
    }
  }

  // ── Downpour: lifesteal on damage dealt ──
  if (caster && caster.alive && (caster._weatherLifesteal ?? 0) > 0 && dmg > 0) {
    const ls = Math.round(dmg * caster._weatherLifesteal);
    if (ls > 0) {
      caster.hp = Math.min(caster.maxHp, caster.hp + ls);
      if (caster.isPlayer) spawnFloat(caster.x, caster.y - 24, '+' + ls, '#4499ff', { char: caster, size: 12 });
    }
  }

  // ── Thunderstorm: ability hits chain to nearest other enemy ──
  if (target.alive && caster && dmg > 0 && !proj._isChain && proj.isAbility && (caster._weatherAbilityChain ?? null)) {
    const ac = caster._weatherAbilityChain;
    const chainDmg = Math.round(dmg * ac.pct);
    if (chainDmg > 0) {
      const allChars = gs._allChars ?? [...(gs.players ?? [gs.player]), ...gs.enemies];
      let nearest = null, nearestDist = ac.range;
      for (const nearby of allChars) {
        if (!nearby.alive || nearby === target || nearby === caster) continue;
        if (nearby.teamId === caster.teamId) continue;
        const cd = Math.hypot(nearby.x - target.x, nearby.y - target.y);
        if (cd < nearestDist) { nearestDist = cd; nearest = nearby; }
      }
      if (nearest) {
        applyHit(nearest, Object.assign({}, proj, { damage: chainDmg, _isChain: true,
          casterRef: caster, casterStats: caster.stats }), gs);
        // Arc visual
        gs.effects.push({ x: target.x, y: target.y, r: 0, maxR: nearestDist * 0.6,
          life: 0.15, maxLife: 0.15, color: '#aa88ff' });
        if (caster.isPlayer || target.isPlayer)
          spawnFloat(nearest.x, nearest.y - 24, '⚡ ' + chainDmg, '#aa88ff', { char: nearest, size: 12 });
      }
    }
  }

  // ── Blizzard: first-hit bonus window ──
  if (target.alive && caster && dmg > 0 && (caster._weatherFirstHitBonus ?? null) && !proj._isBonusHit) {
    const fhb = caster._weatherFirstHitBonus;
    const now = Date.now() / 1000;
    if (!caster._blizzardFirstHitTimer || now >= caster._blizzardFirstHitTimer) {
      // This is the empowered hit — already applied via dmgMult below, just reset timer
      // We apply the bonus by adding extra damage here
      const bonusDmg = Math.round(dmg * (fhb.mult - 1));
      if (bonusDmg > 0) {
        target.hp = Math.max(0, target.hp - bonusDmg);
        if (caster.isPlayer || target.isPlayer)
          spawnFloat(target.x, target.y - 32, '❄ EMPOWERED +' + bonusDmg, '#88eeff', { char: target, size: 13 });
      }
      caster._blizzardFirstHitTimer = now + fhb.cooldown;
    }
  }

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
    if (proj.stun > 0 && target.isPlayer) Audio.sfx.stunned();
    target.ccedTimer = Math.max(target.ccedTimer ?? 0, proj.stun);
  }
  if (proj.freeze && proj.freeze > 0) {
    target.frozen    = Math.max(target.frozen,   proj.freeze);
    if (proj.freeze > 0 && target.isPlayer) Audio.sfx.frozen();
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
    if (proj.silence > 0 && target.isPlayer) Audio.sfx.silenced();
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

  // ── Float damage number — only when player is involved ──
  if (proj.casterRef?.isPlayer || target.isPlayer) {
    spawnFloat(target.x, target.y,
      isCrit ? `${dmg}!` : `${dmg}`,
      isCrit ? '#ffee00' : (ampMult > 1.15 ? '#ff9944' : (proj.casterRef?.isPlayer ? '#fff' : '#ff4444')),
      { char: target }
    );
  }

  // ── Hit received SFX — player only ──
  if (target.isPlayer && dmg > 0) Audio.sfx.hitReceived(isCrit);

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

  if (target.hp <= 0) killChar(target, proj.casterRef?.isPlayer ?? false, gs, proj.casterRef, proj.isUlt ?? false, proj.isMaelstrom ?? false);
}

function killChar(target, killedByPlayer, gs, attacker, killedByUlt = false, killedByMaelstrom = false) {
  if (!target.alive) return; // already dead this frame — prevent double kill processing
  target.alive = false;
  target.hp = 0;
  // Tutorial: killable dummy respawns immediately at same spot; track kill for checklist
  if (gs?.isTutorial && target._tutorialKillable) {
    target.respawnTimer = 0.01; // near-instant respawn
    target._tutorialRespawnX = target.x; // save position for respawn
    target._tutorialRespawnY = target.y;
    gs.tutorial = gs.tutorial || {};
    gs.tutorial._dummyKilled = true;
  } else {
    target.respawnTimer = gs.suddenDeath ? 9999 : 3;
  }
  target.deaths++;
  if (target.isPlayer) gs.playerDeaths = (gs.playerDeaths||0) + 1;
  // Track Maelstrom deaths separately
  if (killedByMaelstrom) {
    target.maelstromDeaths = (target.maelstromDeaths || 0) + 1;
    gs._maelstromKillCount = (gs._maelstromKillCount || 0) + 1;
  }
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

  // Credit kill to attacker's team — storm zone kills (no attacker) don't credit any team
  const killer = attacker || (killedByPlayer ? gs.player : null);
  const killerTeam = killer ? (killer.teamId ?? 0) : -1;
  if (killerTeam >= 0) {
    gs.teamKills[killerTeam] = (gs.teamKills[killerTeam] || 0) + 1;
  }
  if (killer) killer.kills = (killer.kills||0) + 1;

  // Maelstrom kill penalty — target loses a kill from their team's score
  if (killedByMaelstrom && target.teamId !== undefined) {
    gs.teamKills[target.teamId] = Math.max(0, (gs.teamKills[target.teamId] || 0) - 1);
    target.kills = Math.max(0, (target.kills || 0) - 1);
    if (target.isPlayer) spawnFloat(target.x, target.y - 60, '-1 KILL', '#ff4444', { char: target, size: 22, life: 1.8 });
  }

  // Maelstrom: kills reset all cooldowns for the killer
  if (killer && killer._maelstromActive) {
    for (let i = 0; i < killer.cooldowns.length; i++) killer.cooldowns[i] = 0;
    spawnFloat(killer.x, killer.y - 60, 'RESET!', '#ffffff', { char: killer, size: 18, life: 1.0 });
  }

  // ── Heatwave: kill triggers speed burst + partial heal ──
  if (killer && killer.alive && (killer._weatherKillSpeedBurst ?? null)) {
    const ksb = killer._weatherKillSpeedBurst;
    killer._heatwaveKillTimer = ksb.duration;
    if ((killer._weatherKillHealPct ?? 0) > 0) {
      const healAmt = Math.round(killer.maxHp * killer._weatherKillHealPct);
      killer.hp = Math.min(killer.maxHp, killer.hp + healAmt);
      spawnFloat(killer.x, killer.y - 44, '🔥 KILL! +' + healAmt + 'HP', '#ff6622', { char: killer, size: 16, life: 1.4 });
    } else {
      spawnFloat(killer.x, killer.y - 44, '🔥 KILL BOOST!', '#ff6622', { char: killer, size: 15, life: 1.2 });
    }
  }

  const killerIsPlayer = killer && killer.isPlayer;
  const targetIsPlayer = target.isPlayer;
  const effectColor = killerIsPlayer ? '#ff4444' : '#1a4adb';
  gs.effects.push({ x:target.x, y:target.y, r:0, maxR:80, life:0.5, maxLife:0.5, color:effectColor, big:true });
  // ELIMINATED / NUKED — victim sees it, killer sees confirmation, spectator feed gets it
  const deathText  = killedByMaelstrom ? 'MAELSTROM!' : killedByUlt ? 'NUKED!'      : 'ELIMINATED!';
  const deathColor = killedByMaelstrom ? '#ffffff'    : killedByUlt ? '#ff00ff'      : '#ff4444';
  const deathSize  = killedByMaelstrom ? 46           : killedByUlt ? 52             : 42;
  if (targetIsPlayer) {
    spawnFloat(target.x, target.y - 50, deathText, deathColor, { char: target, size: deathSize, life: 2.2 });
    if (!gs._screenShake) gs._screenShake = 0;
    gs._screenShake = Math.max(gs._screenShake, killedByUlt ? 18 : 10);
  }
  // Killer sees "NUKED [name]" confirmation for ult kills (world-space above killer)
  if (killedByUlt && killerIsPlayer && killer) {
    spawnFloat(killer.x, killer.y - 70, `NUKED ${target.hero?.name ?? ''}`, '#ff00ff', { char: killer, size: 22, life: 1.8 });
    if (killerIsPlayer) Audio.sfx.nuked();
  }
  // Player feed — shared centre-right overlay for human matches
  if (!gs.spectator) {
    const overrideTag = killedByMaelstrom ? 'MAELSTROM' : killedByUlt ? 'NUKED' : null;
    _pushPlayerFeed(gs, killedByMaelstrom ? null : (killer?.hero?.name ?? null), target.hero?.name ?? '?', killedByMaelstrom ? '#ffffff' : (killer?.hero?.color ?? '#fff'), overrideTag);
  }
  // Spectator kill feed
  if (gs.spectator) {
    const overrideTag = killedByMaelstrom ? 'MAELSTROM' : killedByUlt ? 'NUKED' : null;
    _pushSpectatorFeed(gs, killedByMaelstrom ? null : (killer?.hero?.name ?? '?'), target.hero?.name ?? '?', killedByMaelstrom ? '#ffffff' : (killer?.hero?.color ?? '#fff'), overrideTag);
  }
  if (killerIsPlayer) {
    // Kill chain tracking — resets after 6s of no kills, caps at 5
    if (!killer._killChainTimer || Date.now() - killer._killChainTimer > 3000) {
      killer._killChain = 0;
    }
    killer._killChain = Math.min((killer._killChain || 0) + 1, 5);
    killer._killChainTimer = Date.now();
    Audio.sfx.kill(killer._killChain);
    // Multi-kill announcements
    const chainLabels = [null, null, 'DOUBLE KILL!', 'TRIPLE KILL!', 'QUAD KILL!', 'RAMPAGE!'];
    const chainColors = [null, null, '#ffee44', '#ff9900', '#ff4400', '#ff00ff'];
    if (killer._killChain >= 2) {
      spawnFloat(killer.x, killer.y - 90, chainLabels[killer._killChain], chainColors[killer._killChain], { char: killer, size: 26, life: 2.0 });
    }
  }
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
        if (killerIsPlayer) Audio.sfx.firstBlood();
        gs.effects.push({ x:killer.x, y:killer.y, r:0, maxR:120, life:0.6, maxLife:0.6, color:'#ff2222' });
      }
      // Spectator feed
      if (gs.spectator) {
        _pushSpectatorFeed(gs, killer.hero?.name ?? '?', null, killer.hero?.color ?? '#ff2222', 'FIRST BLOOD');
      }
      // Player feed
      if (!gs.spectator) _pushPlayerFeed(gs, killer.hero?.name ?? '?', null, killer.hero?.color ?? '#ff2222', 'FIRST BLOOD');
    }

    // ── Multi-kill (2+ kills within 8s) — feed only, floats handled by _killChain ──
    killer._killStreak = (killer._killStreak || 0) + 1;
    killer._killStreakTimer = 8;
    if (killerIsPlayer) {
      if (killer._killStreak === 3) {
        gs.effects.push({ x:killer.x, y:killer.y, r:0, maxR:100, life:0.5, maxLife:0.5, color:'#ff4400' });
      } else if (killer._killStreak >= 4) {
        gs.effects.push({ x:killer.x, y:killer.y, r:0, maxR:130, life:0.6, maxLife:0.6, color:'#ff0044' });
      }
    }
    // Spectator multi-kill feed
    if (gs.spectator && killer._killStreak >= 2) {
      const streakText  = killer._killStreak === 2 ? 'DOUBLE KILL' : killer._killStreak === 3 ? 'TRIPLE KILL!' : 'UNSTOPPABLE!!';
      const streakColor = killer._killStreak === 2 ? '#ffaa00' : killer._killStreak === 3 ? '#ff4400' : '#ff0044';
      _pushSpectatorFeed(gs, killer.hero?.name ?? '?', null, streakColor, streakText);
    }
    // Player multi-kill feed
    if (!gs.spectator && killer._killStreak >= 2) {
      const streakText  = killer._killStreak === 2 ? 'DOUBLE KILL' : killer._killStreak === 3 ? 'TRIPLE KILL!' : 'UNSTOPPABLE!!';
      const streakColor = killer._killStreak === 2 ? '#ffaa00' : killer._killStreak === 3 ? '#ff4400' : '#ff0044';
      _pushPlayerFeed(gs, killer.hero?.name ?? '?', null, streakColor, streakText);
    }

    // ── ON FIRE for killer at 2 momentum stacks ──
    if (killer.momentumStacks === 2) {
      if (killerIsPlayer) spawnFloat(killer.x, killer.y - 55, 'ON FIRE!', '#ff6600', { char: killer, size: 28, life: 1.6 });
      if (killer.isPlayer) Audio.sfx.onFire();
      if (gs.spectator)  _pushSpectatorFeed(gs, killer.hero?.name ?? '?', null, '#ff6600', 'ON FIRE!');
      if (!gs.spectator) _pushPlayerFeed(gs, killer.hero?.name ?? '?', null, '#ff6600', 'ON FIRE!');
    }

    // ── KILL text — only show for single kills; chain labels cover multi-kills; first blood covers first kill ──
    if (killerIsPlayer && (killer._killChain ?? 1) < 2 && !gs._firstBloodDone) {
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
  const others = [...gs.enemies, ...(gs.players ?? [gs.player])].filter(c => c && c.alive && c !== excludeChar);

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

// ── Spectator kill feed ───────────────────────────────────────────────────
// Separate screen-space event feed shown only in spectator mode.
// Never touches the world-space float system — zero impact on player matches.
function _pushSpectatorFeed(gs, killerName, targetName, killerColor, overrideText) {
  if (!gs._specFeed) gs._specFeed = [];
  const neutral = 'rgba(200,216,232,0.80)';
  const isNuke = overrideText === 'NUKED';
  const isMaelstrom = overrideText === 'MAELSTROM';
  let segments;
  if (isMaelstrom) {
    // "☄ STONE killed by MAELSTROM"
    segments = [
      { text: '☄ ', color: '#ffffff' },
      { text: targetName ?? '?', color: neutral },
      { text: ' killed by MAELSTROM', color: '#ffffff' },
    ];
  } else if (overrideText && overrideText !== 'NUKED') {
    // Streak / ON FIRE / FIRST BLOOD
    if (killerName) {
      segments = [
        { text: killerName, color: killerColor },
        { text: ': ' + overrideText, color:
            overrideText === 'FIRST BLOOD'    ? '#ff2222' :
            overrideText === 'ON FIRE!'       ? '#ff6600' :
            overrideText === 'DOUBLE KILL'    ? '#ffaa00' :
            overrideText === 'TRIPLE KILL!'   ? '#ff4400' :
            overrideText === 'UNSTOPPABLE!!'  ? '#ff0044' : neutral },
      ];
    } else {
      segments = [{ text: overrideText, color: killerColor }];
    }
  } else if (isNuke) {
    // "EMBER NUKED STONE"
    segments = killerName ? [
      { text: killerName,           color: killerColor },
      { text: ' NUKED ',            color: '#ff00ff'  },
      { text: targetName ?? '?',    color: neutral     },
    ] : [
      { text: (targetName ?? '?') + ' was NUKED', color: '#ff00ff' },
    ];
  } else {
    // "EMBER eliminated STONE"
    segments = killerName ? [
      { text: killerName,           color: killerColor },
      { text: ' eliminated ',       color: neutral     },
      { text: targetName ?? '?',    color: neutral     },
    ] : [
      { text: (targetName ?? '?') + ' eliminated', color: neutral },
    ];
  }
  gs._specFeed.push({ segments, life: 4.5, maxLife: 4.5 });
  if (gs._specFeed.length > 6) gs._specFeed.shift();
}

function _tickSpectatorFeed(gs, dt) {
  if (!gs._specFeed?.length) return;
  gs._specFeed = gs._specFeed.filter(e => {
    e.life -= dt;
    return e.life > 0;
  });
}

// ── Player event feed ─────────────────────────────────────────────────────
// Shared centre-right feed shown during normal (non-spectator) matches.
// Same segment-colour system as the spectator feed.
function _pushPlayerFeed(gs, killerName, targetName, killerColor, overrideText) {
  if (!gs._playerFeed) gs._playerFeed = [];
  const neutral = 'rgba(200,216,232,0.80)';
  const isNuke  = overrideText === 'NUKED';
  const isMaelstrom = overrideText === 'MAELSTROM';
  let segments;
  if (isMaelstrom) {
    segments = [
      { text: '☄ ', color: '#ffffff' },
      { text: targetName ?? '?', color: neutral },
      { text: ' killed by MAELSTROM', color: '#ffffff' },
    ];
  } else if (overrideText && !isNuke) {
    if (killerName) {
      segments = [
        { text: killerName, color: killerColor },
        { text: ': ' + overrideText, color:
            overrideText === 'FIRST BLOOD'   ? '#ff2222' :
            overrideText === 'ON FIRE!'      ? '#ff6600' :
            overrideText === 'DOUBLE KILL'   ? '#ffaa00' :
            overrideText === 'TRIPLE KILL!'  ? '#ff4400' :
            overrideText === 'UNSTOPPABLE!!' ? '#ff0044' : neutral },
      ];
    } else {
      segments = [{ text: overrideText, color: killerColor }];
    }
  } else if (isNuke) {
    segments = killerName ? [
      { text: killerName,        color: killerColor },
      { text: ' NUKED ',         color: '#ff00ff'  },
      { text: targetName ?? '?', color: neutral     },
    ] : [
      { text: (targetName ?? '?') + ' was NUKED', color: '#ff00ff' },
    ];
  } else {
    segments = killerName ? [
      { text: killerName,        color: killerColor },
      { text: ' eliminated ',    color: neutral     },
      { text: targetName ?? '?', color: neutral     },
    ] : [
      { text: (targetName ?? '?') + ' eliminated', color: neutral },
    ];
  }
  gs._playerFeed.push({ segments, life: 4.0, maxLife: 4.0 });
  if (gs._playerFeed.length > 6) gs._playerFeed.shift();
}

function _tickPlayerFeed(gs, dt) {
  if (!gs._playerFeed?.length) return;
  gs._playerFeed = gs._playerFeed.filter(e => {
    e.life -= dt;
    return e.life > 0;
  });
}

function _drawPlayerFeed(gs) {
  if (!gs._playerFeed?.length) return;
  if (!ctx) return;
  const canvas = ctx.canvas;

  // ── Viewport-aware coordinates (matches rest of HUD renderer) ──
  const baseScale = canvas._worldScale || 1;
  const offsetX   = canvas._worldOffsetX || 0;
  const offsetY   = canvas._worldOffsetY || 0;
  const vpW = VIEW_W * baseScale;
  const vpH = VIEW_H * baseScale;
  const H   = canvas.height;

  const isMP = (gs.players?.length ?? 1) > 1;
  const fontSize = Math.max(13, Math.min(18, vpW * 0.013));
  const lineH = fontSize + 8;
  const padX = 14;

  try {
    ctx.save();
    ctx.font = `700 ${fontSize}px 'Orbitron', monospace`;
    ctx.textBaseline = 'middle';

    if (isMP) {
      // ── MP: bottom-center, stack upward ──
      const cx = offsetX + vpW / 2;
      const baseY = H - 12; // pinned to canvas window bottom
      gs._playerFeed.forEach((e, i) => {
        if (!e?.segments?.length) return;
        const fadeAlpha = e.life < 0.8 ? e.life / 0.8 : 1;
        // Stack upward: most recent (index 0) at bottom
        const y = baseY - i * lineH;
        ctx.globalAlpha = fadeAlpha * 0.95;
        const totalW = e.segments.reduce((sum, seg) => sum + ctx.measureText(seg.text).width, 0);
        let x = cx - totalW / 2;
        ctx.strokeStyle = 'rgba(0,0,0,0.9)';
        ctx.lineWidth = 4;
        ctx.textAlign = 'left';
        let sx = x;
        for (const seg of e.segments) { ctx.strokeText(seg.text, sx, y); sx += ctx.measureText(seg.text).width; }
        for (const seg of e.segments) { ctx.fillStyle = seg.color ?? '#fff'; ctx.fillText(seg.text, x, y); x += ctx.measureText(seg.text).width; }
      });
    } else {
      // ── SP: top-right, pinned to viewport right edge ──
      const rightEdge = offsetX + vpW - padX;
      const startY = offsetY + Math.round(vpH * 0.28);
      gs._playerFeed.forEach((e, i) => {
        if (!e?.segments?.length) return;
        const fadeAlpha = e.life < 0.8 ? e.life / 0.8 : 1;
        const y = startY + i * lineH;
        ctx.globalAlpha = fadeAlpha * 0.95;
        const totalW = e.segments.reduce((sum, seg) => sum + ctx.measureText(seg.text).width, 0);
        let x = rightEdge - totalW;
        ctx.strokeStyle = 'rgba(0,0,0,0.9)';
        ctx.lineWidth = 4;
        ctx.textAlign = 'left';
        let sx = x;
        for (const seg of e.segments) { ctx.strokeText(seg.text, sx, y); sx += ctx.measureText(seg.text).width; }
        for (const seg of e.segments) { ctx.fillStyle = seg.color ?? '#fff'; ctx.fillText(seg.text, x, y); x += ctx.measureText(seg.text).width; }
      });
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  } catch (err) {
    console.warn('[Player feed draw error]', err);
    try { ctx.restore(); } catch (_) {}
  }
}


function _drawSpectatorFeed(gs) {
  if (!gs._specFeed?.length) return;
  if (!ctx) return;
  const canvas = ctx.canvas;
  const fontSize = Math.max(13, Math.min(18, canvas.width * 0.022));
  const lineH = fontSize + 10;
  const padX = 14;
  const startY = Math.round(canvas.height * 0.28);
  try {
    ctx.save();
    ctx.font = `700 ${fontSize}px 'Orbitron', monospace`;
    ctx.textBaseline = 'middle';
    gs._specFeed.forEach((e, i) => {
      if (!e?.segments?.length) return;
      const fadeAlpha = e.life < 0.8 ? e.life / 0.8 : 1;
      const y = startY + i * lineH;
      ctx.globalAlpha = fadeAlpha * 0.95;
      // Measure total width so we can right-align the whole line
      const totalW = e.segments.reduce((sum, seg) => sum + ctx.measureText(seg.text).width, 0);
      let x = canvas.width - padX - totalW;
      // Draw stroke pass first (full line, black outline for legibility)
      ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.lineWidth = 4;
      ctx.textAlign = 'left';
      let strokeX = x;
      for (const seg of e.segments) {
        ctx.strokeText(seg.text, strokeX, y);
        strokeX += ctx.measureText(seg.text).width;
      }
      // Draw fill pass with per-segment color
      for (const seg of e.segments) {
        ctx.fillStyle = seg.color ?? '#fff';
        ctx.fillText(seg.text, x, y);
        x += ctx.measureText(seg.text).width;
      }
    });
    ctx.globalAlpha = 1;
    ctx.restore();
  } catch (err) {
    console.warn('[Spectator feed draw error]', err);
    try { ctx.restore(); } catch (_) {}
  }
}

// Stop the engine completely and clear state — call whenever leaving a match
function cleanupGame() {
  gamePaused = false;
  if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
  gameState = null;
  document.body.classList.remove('in-game', 'mp-mode', 'mp3-mode', 'mp4-mode', 'spectator-mode');
  const po = document.getElementById('pause-overlay');
  if (po) po.style.display = 'none';
  const tf = document.getElementById('target-frame');
  if (tf) tf.style.display = 'none';
  ['tf-p1','tf-p2','tf-p3','tf-p4'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
  ['controls-p3','controls-p4'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
}

function respawnChar(c, gs) {
  c.alive = true;
  c.hp = c.maxHp;
  c.mana = c.maxMana;
  c.stunned = 0; c.frozen = 0; c.silenced = 0;
  c.ccedTimer = 0; c.weaveWindow = 0; c.momentumStacks = 0; c.momentumTimer = 0;
  c.velX = 0; c.velY = 0; c.vx = 0; c.vy = 0;
  c.aiState = 'chase'; c._lastWarp = 0;
  // Tutorial killable dummy: respawn at same spot, no spawn invulnerability
  if (c._tutorialKillable && c._tutorialRespawnX !== undefined) {
    c.x = c._tutorialRespawnX;
    c.y = c._tutorialRespawnY;
    c.spawnInvuln = 0;
  } else {
    c.spawnInvuln = 2.0;
    const pos = getSafeSpawnPos(gs, c);
    c.x = pos.x;
    c.y = pos.y;
  }
  if (c.isPlayer) Audio.sfx.respawn();
}

