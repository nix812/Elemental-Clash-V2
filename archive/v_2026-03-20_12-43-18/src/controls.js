// ========== JOYSTICK ==========
function setupJoystick() {
  if (window._joystickSetup) return; // only wire up once
  window._joystickSetup = true;
  const zone=document.getElementById('joystick-zone');
  const thumb=document.getElementById('joystick-thumb');
  const base=document.getElementById('joystick-base');

  function joyStart(cx,cy,id) {
    joyActive=true; joyId=id;
    const r=zone.getBoundingClientRect();
    joyOrigin={x:r.left+r.width/2, y:r.top+r.height/2};
  }
  function joyMove(cx,cy) {
    if(!joyActive) return;
    const r=zone.getBoundingClientRect();
    const maxR=r.width*0.38;
    const dx=cx-joyOrigin.x, dy=cy-joyOrigin.y;
    const dist=Math.sqrt(dx*dx+dy*dy);
    const clamped=Math.min(dist,maxR);
    const angle=Math.atan2(dy,dx);
    const tx=Math.cos(angle)*clamped, ty=Math.sin(angle)*clamped;
    thumb.style.transform=`translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px))`;
    joyDelta.x=tx/maxR; joyDelta.y=ty/maxR;
  }
  function joyEnd() { joyActive=false; joyDelta={x:0,y:0}; thumb.style.transform='translate(-50%,-50%)'; }

  zone.addEventListener('touchstart',e=>{const t=e.changedTouches[0];joyStart(t.clientX,t.clientY,t.identifier);e.preventDefault();},{passive:false});
  zone.addEventListener('touchmove',e=>{for(const t of e.changedTouches){if(t.identifier===joyId){joyMove(t.clientX,t.clientY);}}e.preventDefault();},{passive:false});
  zone.addEventListener('touchend',joyEnd);
  zone.addEventListener('mousedown',e=>joyStart(e.clientX,e.clientY,-1));
  window.addEventListener('mousemove',e=>joyMove(e.clientX,e.clientY));
  window.addEventListener('mouseup',joyEnd);
}

function setupKeyboard() {
  window._keyboardReady = true;
  const keys={};
  window.onkeydown = e => {
    // F12 — toggle controller debug overlay (diagnostic, not shown to end users)
    if (e.code === 'F12') { e.preventDefault(); window._gpDebugVisible = !window._gpDebugVisible; return; }
    // Skip if rebinding
    if (rebindingAction) return;
    // Switch to keyboard mode on any keydown (unless gamepad or touch is active)
    if (!document.body.classList.contains('gamepad-mode') &&
        !document.body.classList.contains('keyboard-mode') &&
        !document.body.classList.contains('touch-mode')) {
      document.body.classList.add('keyboard-mode');
      refreshDynamicBindLabels();
    } else if (document.body.classList.contains('touch-mode')) {
      // Key pressed on touch device — switch to keyboard mode
      document.body.classList.remove('touch-mode');
      document.body.classList.add('keyboard-mode');
      refreshDynamicBindLabels();
    }
    if (keyMatchesAction(e.code,'q')) useAbility(0);
    if (keyMatchesAction(e.code,'e')) useAbility(1);
    if (keyMatchesAction(e.code,'r')) useAbility(2);
    if (keyMatchesAction(e.code,'sprint')) activateSprint();
    if (keyMatchesAction(e.code,'special')) activateSpecial();
    if (keyMatchesAction(e.code,'rockbuster')) activateRockBuster();
    if (keyMatchesAction(e.code,'pause')) togglePause(0);
    if (keyMatchesAction(e.code,'cycleTarget')) {
      e.preventDefault();
      if (gameState && !gameState.over) {
        if (gameState.spectator) cycleSpectateTarget(gameState);
        else {
          cycleTarget(gameState);
          if (gameState.isTutorial) { gameState.tutorial = gameState.tutorial||{}; gameState.tutorial._targetLocked = true; }
        }
      }
    }
    if (keyMatchesAction(e.code,'scoreboard')) { e.preventDefault(); showScoreOverlay(0); }
    keys[e.code]=true;
  };
  window.onkeyup = e => {
    if (keyMatchesAction(e.code,'scoreboard')) hideScoreOverlay();
    keys[e.code]=false;
  };

  // Called each game frame to recompute joyDelta from held keys (handles diagonals correctly)
  // Skips if gamepad is providing movement input for P1
  function updateKeyboardJoy() {
    if (!gameState || gameState.over) return;
    if (joyActive) return;
    if (gamepadState.connected) return; // gamepad handles joyDelta for P1
    let kx = 0, ky = 0;
    if ((keybindings.left  ||['KeyA','ArrowLeft'] ).some(k=>keys[k])) kx -= 1;
    if ((keybindings.right ||['KeyD','ArrowRight']).some(k=>keys[k])) kx += 1;
    if ((keybindings.up    ||['KeyW','ArrowUp']   ).some(k=>keys[k])) ky -= 1;
    if ((keybindings.down  ||['KeyS','ArrowDown'] ).some(k=>keys[k])) ky += 1;
    const len = Math.hypot(kx, ky);
    if (len > 0) {
      joyDelta.x = kx / len;
      joyDelta.y = ky / len;
    } else {
      joyDelta.x = 0;
      joyDelta.y = 0;
    }
  }
  window._updateKeyboardJoy = updateKeyboardJoy;
}

// ========== FULLSCREEN ==========
function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
function warpProj(p, W, H) {
  const gs = gameState;
  if (!gs || !gs.gates) {
    if (p.x < 0) p.x += W; if (p.x > W) p.x -= W;
    if (p.y < 0) p.y += H; if (p.y > H) p.y -= H;
    return true;
  }
  const b = getArenaBounds(gs);
  const progress = Math.min(1, gs.time / MATCH_DURATION);
  const gateSize = GATE_SIZE_BASE - (GATE_SIZE_BASE - GATE_SIZE_MIN) * progress;

  // Left wall
  if (p.x < b.x) {
    const t = (p.y - b.y) / b.h;
    if (t >= 0 && t <= 1 && inGate(gs.gates[3], t, gateSize, b.h)) { p.x = b.x2 - p.radius; }
    else { p.x = b.x + p.radius; return false; }
  }
  // Right wall
  if (p.x > b.x2) {
    const t = (p.y - b.y) / b.h;
    if (t >= 0 && t <= 1 && inGate(gs.gates[1], t, gateSize, b.h)) { p.x = b.x + p.radius; }
    else { p.x = b.x2 - p.radius; return false; }
  }
  // Top wall
  if (p.y < b.y) {
    const t = (p.x - b.x) / b.w;
    if (t >= 0 && t <= 1 && inGate(gs.gates[0], t, gateSize, b.w)) { p.y = b.y2 - p.radius; }
    else { p.y = b.y + p.radius; return false; }
  }
  // Bottom wall
  if (p.y > b.y2) {
    const t = (p.x - b.x) / b.w;
    if (t >= 0 && t <= 1 && inGate(gs.gates[2], t, gateSize, b.w)) { p.y = b.y + p.radius; }
    else { p.y = b.y2 - p.radius; return false; }
  }
  return true;
}
function dist2(a,b){const dx=a.x-b.x,dy=a.y-b.y;return dx*dx+dy*dy;}
function lighten(hex,amt){return adjustColor(hex,amt);}
function darken(hex,amt){return adjustColor(hex,-amt);}
function adjustColor(hex,amt){
  let c=hex.replace('#','');
  if(c.length===3)c=c[0]+c[0]+c[1]+c[1]+c[2]+c[2];
  const r=Math.min(255,Math.max(0,parseInt(c.slice(0,2),16)+Math.round(amt*255)));
  const g=Math.min(255,Math.max(0,parseInt(c.slice(2,4),16)+Math.round(amt*255)));
  const b=Math.min(255,Math.max(0,parseInt(c.slice(4,6),16)+Math.round(amt*255)));
  return `rgb(${r},${g},${b})`;
}
// ── Float text lane system ────────────────────────────────────────────────────
// Each character tracks independent lanes so simultaneous events don't stack.
//
// Lane layout (relative to character centre):
//   DAMAGE   — right column, lanes stack upward  (+0..+3 × LANE_H)
//   CC       — left side, fixed offset per CC type
//   PRIORITY — above all (KILL, COMBO, ON FIRE, ELIMINATED)
//   SELF     — above caster head (SPRINT, LOW MANA, WARP COOLDOWN etc.)
//
const FLOAT_LANE_H   = 22;   // vertical px between damage lanes
const FLOAT_LANES    = 3;    // how many simultaneous damage numbers per character
const FLOAT_LANE_TTL = 0.45; // seconds a lane is considered "occupied"

function _getChar(x, y) {
  // Find the character closest to this world position — used to attach lanes
  if (!gameState) return null;
  const all = [...(gameState.players || [gameState.player]), ...(gameState.enemies || [])];
  let best = null, bestD = 120 * 120;
  for (const c of all) {
    if (!c) continue;
    const dx = c.x - x, dy = c.y - y;
    const d2 = dx*dx + dy*dy;
    if (d2 < bestD) { bestD = d2; best = c; }
  }
  return best;
}

function _nextDamageLane(char) {
  // Returns a Y offset (negative = above head) for the next free damage lane
  if (!char) return 0;
  if (!char._floatLanes) char._floatLanes = new Array(FLOAT_LANES).fill(0);
  const now = performance.now() / 1000;
  // Find the lane with the oldest timestamp (most "free")
  let oldest = 0, oldestT = Infinity;
  for (let i = 0; i < FLOAT_LANES; i++) {
    if (char._floatLanes[i] < oldestT) { oldestT = char._floatLanes[i]; oldest = i; }
  }
  char._floatLanes[oldest] = now + FLOAT_LANE_TTL;
  // Stagger: oldest lane = lowest, newest = highest above head
  // Sort lanes by timestamp to get visual order
  const sorted = [...char._floatLanes].sort((a,b) => a-b);
  const rank = sorted.indexOf(char._floatLanes[oldest]);
  return -(char.radius || 18) - 12 - rank * FLOAT_LANE_H;
}

function _ccSideOffset(type) {
  // CC labels appear to left, alternating by type to avoid stacking
  const offsets = { slow:-52, silence:-52, stun:-52, root:-52, knockback:-52, pull:-52 };
  return offsets[type] || -52;
}

// Category tags determine placement behaviour
const FLOAT_CAT = {
  // Mega — biggest events, dominate screen, sit highest above character
  MEGA:     ['NUKED','ELIMINATED','FIRST BLOOD','TRIPLE KILL','QUAD KILL','RAMPAGE','UNSTOPPABLE'],
  // Priority — important events, sit above character, stack-aware
  PRIORITY: ['KILL!','DOUBLE KILL','TRIPLE KILL','QUAD KILL','RAMPAGE','FIRST BLOOD',
             'COMBO BURST','ON FIRE!','NUKED','ELIMINATED','ASSIST!',
             'DOUBLE KILL!','TRIPLE KILL!','QUAD KILL!','RAMPAGE!'],
  // CC — left side labels
  CC:       ['SLOWED','SILENCED','STUNNED','KNOCKED BACK','PULLED','BLOCKED','WARP COOLDOWN'],
  // Self — above caster, quiet events
  SELF:     ['SPRINT!','LOW MANA','LOCKED','SHIELDED!','SHADOW STRIKE','UNSTOPPABLE!',
             'GALE DASH','OVERGROWTH','RESILIENCE','IGNITION',
             'EVASION','COMBO ×','MOLTEN CORE','DENIED!','HEAL BROKEN!',
             'ROCK BUSTER!','FLAME PATCH'],
};

function _floatCategory(text) {
  if (FLOAT_CAT.MEGA.some(k => text.includes(k)))     return 'mega';
  if (FLOAT_CAT.PRIORITY.some(k => text.includes(k))) return 'priority';
  if (FLOAT_CAT.CC.some(k => text.includes(k)))       return 'cc';
  if (FLOAT_CAT.SELF.some(k => text.includes(k)))     return 'self';
  if (/^\d+!?$/.test(text.trim()))                    return 'damage';
  return 'label';
}

// Cooldown (seconds) before the same text can appear again on the same character.
// Keyed by text content — tweak per-message as needed.
const FLOAT_COOLDOWNS = {
  // UI / state messages
  'FULL HEALTH':    3.0,
  'LOW MANA':       2.5,
  'LOCKED':         1.5,
  'WARP COOLDOWN':  1.5,
  'BLOCKED':        1.0,
  'SPRINT!':        1.5,
  'SHIELDED!':      1.5,
  'ROCK BUSTER!':   0.5,
  'EVASION':        1.2,
  'MOLTEN CORE':    1.0,
  'DENIED!':        1.5,
  'FLAME PATCH':    1.0,
  // CC labels — suppress repeats while the effect is still active
  'SLOWED':         1.8,
  'SILENCED':       1.8,
  'STUNNED':        1.8,
  'KNOCKED BACK':   1.2,
  'PULLED':         1.2,
  // Kill feed — only show once per kill event
  'KILL!':          1.5,
  'ASSIST!':        2.0,
  'ON FIRE!':       3.0,
  'NUKED':          3.0,
  'ELIMINATED':     3.0,
  'FIRST BLOOD':    99.0,
  'DOUBLE KILL!':   2.0,
  'TRIPLE KILL!':   2.0,
  'QUAD KILL!':     2.0,
  'RAMPAGE!':       3.0,
  'COMBO BURST':    1.5,
  'COMBO!':         1.5,
  // Collision spam
  'COLLISION':      0.6,
  'HEAL BROKEN!':   2.0,
};
const FLOAT_COOLDOWN_DEFAULT = 0; // no throttle unless listed above

function spawnFloat(x, y, text, color, opts = {}) {
  if (!gameState) return;
  const char  = opts.char || _getChar(x, y);
  const cat   = _floatCategory(text);

  // Suppress CC and generic labels for AI-vs-AI — player doesn't need that noise
  if ((cat === 'cc' || cat === 'label') && char && !char.isPlayer) {
    const caster = opts.caster;
    if (!caster || !caster.isPlayer) return;
  }
  const r     = char?.radius || 18;

  // ── Duplicate suppression ──────────────────────────────────────────
  const cd = FLOAT_COOLDOWNS[text] ?? FLOAT_COOLDOWN_DEFAULT;
  if (cd > 0 && char) {
    if (!char._floatCd) char._floatCd = {};
    const now = performance.now() / 1000;
    if (now < (char._floatCd[text] || 0)) return; // still on cooldown
    char._floatCd[text] = now + cd;
  }
  // ──────────────────────────────────────────────────────────────────
  let fx = x, fy = y, size = opts.size || 18, riseSpeed = 50, life = opts.life || 1.2;
  let fallDir = -1; // -1 = float up, +1 = fall down

  if (cat === 'mega') {
    size = opts.size || 44;
    riseSpeed = 30;
    life = opts.life || 2.0;
    fx = x + (Math.random() - 0.5) * 30;
    fy = y - r - 60;
    // Push down below any existing live mega floats near this character
    fy = _reserveMajorSlot(fx, fy, size, life, gameState.floatDmgs, 'mega');

  } else if (cat === 'priority') {
    size = opts.size || 24;
    riseSpeed = 65;
    life = opts.life || 1.4;
    fx = x + (Math.random() - 0.5) * 20;
    fy = y - r - 50;  // start further above to clear damage numbers
    fy = _reserveMajorSlot(fx, fy, size, life, gameState.floatDmgs, 'priority');

  } else if (cat === 'damage' || cat === 'label') {
    // Damage numbers — BELOW the target, fall downward
    const laneY = _nextDamageLane(char);
    fx = x + (char ? 18 : 0) + (Math.random() - 0.5) * 10;
    fy = y + r + 14 + Math.abs(laneY) * 0.5; // start just below feet, stagger downward
    if (cat === 'damage') {
      // Scale size by damage value — tiny chip damage, huge crits
      const dmgVal = parseInt(text.replace('!', ''), 10) || 0;
      const isCrit = text.includes('!');
      // Suppress trivial chip damage — below threshold just adds noise
      const DAMAGE_THRESHOLD = 50;
      if (dmgVal > 0 && dmgVal < DAMAGE_THRESHOLD && !isCrit) return;
      // Base: 14px at threshold, scales up logarithmically, cap at 38px
      const logScale = dmgVal > 0 ? Math.log10(dmgVal + 1) / Math.log10(500) : 0;
      size = Math.round(14 + logScale * 24); // 14–38px range
      if (isCrit) size = Math.min(42, Math.round(size * 1.25)); // crits get 25% boost
      // Anti-overlap: nudge spawn position away from existing nearby damage floats
      if (gameState?.floatDmgs?.length) {
        const PROX = 60; // px proximity to consider a conflict
        let attempts = 0;
        while (attempts++ < 6) {
          const conflict = gameState.floatDmgs.find(f =>
            f.life > 0 && f.cat === 'damage' &&
            Math.abs(f.x - fx) < PROX && Math.abs(f.y - fy) < size * 1.5
          );
          if (!conflict) break;
          // Push down and slightly sideways
          fy += size * 1.4;
          fx += (Math.random() - 0.5) * 16;
        }
      }
    } else {
      size = 17;
    }
    riseSpeed = 32 + (size - 14) * 0.8; // bigger numbers rise/fall a bit faster too
    fallDir = 1; // fall downward

  } else if (cat === 'cc') {
    // CC labels — left side above character, float up slowly
    if (!char) { fx = x - 50; fy = y - r - 10; }
    else {
      if (!char._floatCcY) char._floatCcY = 0;
      const now = performance.now()/1000;
      if (now - (char._floatCcT || 0) > 0.3) char._floatCcY = 0;
      fx = x - 62;
      fy = y - r - 8 - char._floatCcY * 18;
      char._floatCcY = ((char._floatCcY || 0) + 1) % 3;
      char._floatCcT = now;
    }
    size = 13;
    riseSpeed = 22;
    life = 1.0;

  } else if (cat === 'self') {
    // Self-events — right side above caster, stack upward against live self floats
    size = opts.size || 15;
    riseSpeed = 42;
    life = opts.life || 1.1;
    fx = x + r + 8 + (Math.random() - 0.5) * 8;
    fy = y - r - 30;
    // Stack above any live self floats near this character
    if (gameState?.floatDmgs?.length) {
      const nearby = gameState.floatDmgs.filter(f =>
        f.life > 0 && f.cat === 'self' && Math.abs(f.x - fx) < 100
      );
      for (const f of nearby) {
        if (Math.abs(fy - f.y) < size * 1.4) {
          fy = Math.min(fy, f.y) - size * 1.4;
        }
      }
    }
  }

  gameState.floatDmgs.push({ x: fx, y: fy, text, color, life, maxLife: life, size, riseSpeed, fallDir, cat });
}

// Reserve a vertical slot for major (mega/priority) floats so they never overlap.
// Scans existing live major floats within horizontal proximity and bumps fy downward
// (further above the character) until there is clear vertical space.
function _reserveMajorSlot(fx, fy, size, life, floats, tier) {
  const PROX_X    = 160;  // horizontal proximity to consider a conflict
  const MIN_GAP   = size * 1.2; // minimum vertical gap between major texts
  const MAX_SHIFT = size * 8;   // don't push more than 8 text heights up

  // All major floats (mega + priority) block each other — no tier isolation
  const competing = floats.filter(f =>
    f.life > 0 &&
    (f.cat === 'mega' || f.cat === 'priority') &&
    Math.abs(f.x - fx) < PROX_X
  );

  if (!competing.length) return fy;

  let candidate = fy;
  let shifted = 0;
  let changed = true;
  let safetyIter = 0;
  while (changed && shifted < MAX_SHIFT && safetyIter++ < 20) {
    changed = false;
    for (const f of competing) {
      const gap = Math.abs(candidate - f.y);
      if (gap < MIN_GAP) {
        const nudge = Math.max(MIN_GAP - gap, MIN_GAP * 0.5);
        candidate = Math.min(f.y - MIN_GAP, candidate - nudge);
        shifted += nudge;
        changed = true;
      }
    }
  }
  return candidate;
}

function showFloatText(x, y, text, color, charRef) {
  spawnFloat(x, y, text, color, { char: charRef });
}
function showTutorial(msg){
  const el=document.getElementById('tutorial');
  if(!el){
    const t=document.createElement('div');
    t.id='tutorial'; t.textContent=msg;
    document.getElementById('game').appendChild(t);
    setTimeout(()=>t.remove(),4000);
  }
}

// ========== ZOOM / GESTURE LOCK ==========
// Block pinch-zoom (wheel + ctrl), double-tap zoom, and context menu
document.addEventListener('wheel', e => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
document.addEventListener('gesturestart',  e => e.preventDefault(), { passive: false });
document.addEventListener('gesturechange', e => e.preventDefault(), { passive: false });
document.addEventListener('gestureend',    e => e.preventDefault(), { passive: false });
document.addEventListener('contextmenu',   e => e.preventDefault());
// Block double-tap zoom on mobile
let lastTap = 0;
document.addEventListener('touchend', e => {
  const now = Date.now();
  if (now - lastTap < 300) e.preventDefault();
  lastTap = now;
}, { passive: false });

// ========== UI NAVIGATION (Controller + Keyboard) ==========
// Unified navigation for all menus. Works with controller d-pad/buttons
// and keyboard arrows/enter/escape. Game input is handled separately.

const UINav = (() => {
  // Each screen lists selectable elements in focus order
  // 'grid' type navigates a 2D grid (hero select)
  // headerSelectors = items above/outside the grid (back btn, ready btn, etc.)
  // gridSelectors   = the repeating grid items (hero cards)
  // Header items are navigated with up/down as a 1-col list; grid items use 2D navigation.
  const SCREEN_CONFIGS = {
    'menu': {
      gridSelectors: ['.menu-btns .btn'],
    },
    'hero-select': {
      // Navigation handled by PlayerCursors — UINav only handles scroll here
      headerSelectors: [],
      gridSelectors:   [],
    },
    'pause-overlay': {
      gridSelectors: ['#pause-overlay .btn, #pause-overlay .btn-primary'],
    },
    'win-screen': {
      gridSelectors: ['#win-screen .btn, #win-screen .btn-primary'],
    },
    'options': {
      gridSelectors: ['.back-btn', '.diff-btn', '.ms-opt-btn', '.rebind-btn', '.reset-btn'],
    },
    'options-ingame': {
      gridSelectors: ['.back-btn', '.diff-btn', '.ms-opt-btn', '.rebind-btn', '.reset-btn'],
    },
    'online-menu': {
      gridSelectors: ['.back-btn', '.btn'],
    },
    'how-to-play': {
      headerSelectors: ['.back-btn'],
      gridSelectors:   [],
    },
    'hero-detail-page': {
      headerSelectors: ['.back-btn'],
      gridSelectors:   [],
    },
    'hero-select-solo': {
      headerSelectors: ['.back-btn'],
      gridSelectors:   ['.hero-card'],
      gridIds: ['hero-grid-solo'],
    },
  };

  let curScreen = 'menu';
  let focusIdx   = 0;
  let focusItems = [];

  // Controller repeat-press throttle
  let navCooldown = 0;
  const NAV_REPEAT_INITIAL = 400; // ms before repeat starts
  const NAV_REPEAT_RATE    = 150; // ms between repeats
  let navHeldDir   = null;
  let navHeldTimer = 0;

  // Collect elements for a selector list within a screen element
  function _querySelectors(screen, selectors) {
    const all = [];
    (selectors || []).forEach(sel => {
      screen.querySelectorAll(sel).forEach(el => {
        if (!all.includes(el) && el.offsetParent !== null) all.push(el);
      });
    });
    return all;
  }

  // headerItems = back btn / ready btn etc. (1-col list, isolated from grid)
  // focusItems  = grid items only (hero cards)
  // focusZone   = 'header' | 'grid'
  let headerItems = [];
  let focusZone   = 'grid';

  function getFocusItems(screenId) {
    const cfg = SCREEN_CONFIGS[screenId];
    if (!cfg) return [];
    const screen = document.getElementById(screenId) ||
                   (screenId === 'pause-overlay' ? document.getElementById('pause-overlay') : null);
    if (!screen) return [];
    return _querySelectors(screen, cfg.gridSelectors);
  }

  function getHeaderItems(screenId) {
    const cfg = SCREEN_CONFIGS[screenId];
    if (!cfg || !cfg.headerSelectors) return [];
    const screen = document.getElementById(screenId) ||
                   (screenId === 'pause-overlay' ? document.getElementById('pause-overlay') : null);
    if (!screen) return [];
    return _querySelectors(screen, cfg.headerSelectors);
  }

  function activate(screenId) {
    curScreen   = screenId;
    focusIdx    = 0;
    focusItems  = getFocusItems(screenId);
    headerItems = getHeaderItems(screenId);
    focusZone   = focusItems.length > 0 ? 'grid' : 'header';
    navHeldDir  = null;
    applyFocus();
    // If nothing found yet (DOM not ready), retry once after a short delay
    if (focusItems.length === 0 && headerItems.length === 0) {
      setTimeout(() => {
        focusItems  = getFocusItems(screenId);
        headerItems = getHeaderItems(screenId);
        focusZone   = focusItems.length > 0 ? 'grid' : 'header';
        applyFocus();
      }, 100);
    }
  }

  function applyFocus() {
    document.querySelectorAll('.ui-nav-focus').forEach(el =>
      el.classList.remove('ui-nav-focus'));
    // Only show controller focus ring when a controller is actually connected
    if (!gamepadState.connected) return;
    const list = focusZone === 'header' ? headerItems : focusItems;
    if (list.length === 0) return;
    focusIdx = Math.max(0, Math.min(focusIdx, list.length - 1));
    const el = list[focusIdx];
    if (el) {
      el.classList.add('ui-nav-focus');
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function getColCount() {
    // Measure from the actual grid DOM element for accuracy
    const cfg = SCREEN_CONFIGS[curScreen];
    if (cfg && cfg.gridIds) {
      for (const gridId of cfg.gridIds) {
        const grid = document.getElementById(gridId);
        if (!grid) continue;
        const cards = Array.from(grid.querySelectorAll('.hero-card')).filter(el => el.offsetParent !== null);
        if (cards.length < 2) continue;
        const firstTop = cards[0].getBoundingClientRect().top;
        let cols = 0;
        for (const c of cards) {
          if (Math.abs(c.getBoundingClientRect().top - firstTop) < 10) cols++;
          else break;
        }
        if (cols > 1) return cols;
      }
    }
    // Fallback: count from focusItems
    if (focusItems.length < 2) return 1;
    const firstTop = focusItems[0]?.getBoundingClientRect().top ?? 0;
    let cols = 0;
    for (const el of focusItems) {
      if (Math.abs(el.getBoundingClientRect().top - firstTop) < 10) cols++;
      else break;
    }
    return Math.max(1, cols);
  }

  // Build a row-map from focusItems — groups cards by their vertical position.
  // Returns array of rows, each row being an array of focusItems indices.
  function getRowMap() {
    if (!focusItems.length) return [];
    const rows = [];
    let currentRow = [];
    let currentTop = null;
    focusItems.forEach((el, i) => {
      const top = Math.round(el.getBoundingClientRect().top);
      if (currentTop === null || Math.abs(top - currentTop) > 10) {
        if (currentRow.length) rows.push(currentRow);
        currentRow = [i];
        currentTop = top;
      } else {
        currentRow.push(i);
      }
    });
    if (currentRow.length) rows.push(currentRow);
    return rows;
  }

  function move(dir) {
    // Refresh lists if empty
    if (focusItems.length === 0)  focusItems  = getFocusItems(curScreen);
    if (headerItems.length === 0) headerItems = getHeaderItems(curScreen);

    const inHeader = focusZone === 'header';
    const list     = inHeader ? headerItems : focusItems;
    if (list.length === 0) return;

    if (inHeader) {
      // Header zone: simple 1-col list; down enters the grid
      if (dir === 'down' && focusItems.length > 0) {
        focusZone = 'grid'; focusIdx = 0; applyFocus(); return;
      }
      if (dir === 'up')    { if (focusIdx > 0) { focusIdx--; applyFocus(); } return; }
      if (dir === 'down')  { if (focusIdx < list.length - 1) { focusIdx++; applyFocus(); } return; }
      if (dir === 'left' || dir === 'right') return; // no horizontal in header
    } else {
      // Grid zone: 2D navigation using actual row structure
      // Up from row 0 enters header if it exists
      const rowMap = getRowMap();
      if (!rowMap.length) return;

      // Find which row and column the current focusIdx is in
      let curRow = -1, curCol = -1;
      for (let r = 0; r < rowMap.length; r++) {
        const ci = rowMap[r].indexOf(focusIdx);
        if (ci !== -1) { curRow = r; curCol = ci; break; }
      }
      if (curRow === -1) return; // shouldn't happen

      let next = focusIdx;

      if (dir === 'up') {
        if (curRow === 0 && headerItems.length > 0) {
          focusZone = 'header'; focusIdx = headerItems.length - 1; applyFocus(); return;
        }
        if (curRow > 0) {
          const prevRow = rowMap[curRow - 1];
          // Land on same column index, or last item if row is shorter
          next = prevRow[Math.min(curCol, prevRow.length - 1)];
        }
      } else if (dir === 'down') {
        if (curRow < rowMap.length - 1) {
          const nextRow = rowMap[curRow + 1];
          next = nextRow[Math.min(curCol, nextRow.length - 1)];
        }
      } else if (dir === 'right') {
        const row = rowMap[curRow];
        if (curCol < row.length - 1) next = row[curCol + 1];
      } else if (dir === 'left') {
        const row = rowMap[curRow];
        if (curCol > 0) next = row[curCol - 1];
      }

      next = Math.max(0, Math.min(next, focusItems.length - 1));
      if (next !== focusIdx) { focusIdx = next; applyFocus(); }
    }
  }

  function confirm() {
    const list = focusZone === 'header' ? headerItems : focusItems;
    const el = list[focusIdx];
    if (!el) return;
    el.click();
  }

  function back() {
    // Find and click the back button on current screen
    const screen = document.getElementById(curScreen);
    if (!screen) return;
    const backBtn = screen.querySelector('.back-btn, .hs-back');
    if (backBtn) backBtn.click();
    else if (curScreen === 'pause-overlay') togglePause(undefined);
  }

  // Poll controller UI inputs each frame (called from a separate rAF loop)
  let prevUIButtons = [];

  function pollControllerUI(gp) {
    if (!gp) { prevUIButtons = []; return; }
    // Suspend all UI nav while waiting for a rebind press
    if (rebindingCtrlAction !== null) { prevUIButtons = gp.buttons.map(b => b?.pressed ?? false); return; }
    // Only handle UI nav when NOT in active gameplay — but DO handle when paused
    const pauseOpen = document.getElementById('pause-overlay')?.style.display === 'flex';
    const inGame = !pauseOpen && gameState && !gameState.over &&
                   document.getElementById('game')?.classList.contains('active');
    if (inGame) { prevUIButtons = gp.buttons.map(b => b?.pressed ?? false); return; }

    // If pause just opened, curScreen may be stale — force activate
    if (pauseOpen && curScreen !== 'pause-overlay') {
      curScreen  = 'pause-overlay';
      focusItems  = getFocusItems('pause-overlay');
      headerItems = getHeaderItems('pause-overlay');
      focusZone   = focusItems.length > 0 ? 'grid' : 'header';
      focusIdx    = 0;
      applyFocus();
    }

    const M = _getButtonMap(gp);
    const now = performance.now();

    const pressedNow  = (btn) => gp.buttons[btn]?.pressed ?? false;
    const justPressed = (btn) => pressedNow(btn) && !(prevUIButtons[btn] ?? false);

    // Confirm = bound E button (A/Cross by default), Back = bound auto button (B/Circle by default)
    const confirmBtn = Array.isArray(controllerBindings.e) ? (controllerBindings.e[0] ?? M.a) : (controllerBindings.e >= 0 ? controllerBindings.e : M.a);
    const backBtn    = Array.isArray(controllerBindings.auto) ? (controllerBindings.auto[0] ?? M.b) : (controllerBindings.auto >= 0 ? controllerBindings.auto : M.b);
    if (justPressed(confirmBtn)) confirm();
    if (justPressed(backBtn)) {
      // During countdown, B aborts the countdown — not back to previous screen
      const onHeroSelect = document.getElementById('hero-select')?.classList.contains('active');
      if (onHeroSelect && typeof lobbyPhase !== 'undefined' && lobbyPhase === 'countdown') {
        const abortBtn = document.getElementById('abort-countdown-btn');
        if (abortBtn) abortBtn.click();
      } else {
        back();
      }
    }

    // Start button — context sensitive
    const startBtn = controllerBindings.pause >= 0 ? controllerBindings.pause : M.start;
    if (justPressed(startBtn)) {
      const onHeroSelect = document.getElementById('hero-select')?.classList.contains('active');
      if (onHeroSelect) lobbyReady();
      else if (pauseOpen) togglePause(undefined); // resume from pause
    }

    // D-pad navigation with repeat
    const dirMap = [
      { dir:'up',    btn: M.dup    },
      { dir:'down',  btn: M.ddown  },
      { dir:'left',  btn: M.dleft  },
      { dir:'right', btn: M.dright },
    ];
    let activeDir = null;
    for (const {dir, btn} of dirMap) {
      if (pressedNow(btn)) { activeDir = dir; break; }
    }

    if (activeDir) {
      if (navHeldDir !== activeDir) {
        // New direction — fire immediately and start hold timer
        navHeldDir   = activeDir;
        navHeldTimer = now + NAV_REPEAT_INITIAL;
        move(activeDir);
      } else if (now >= navHeldTimer) {
        // Held — repeat at rate
        navHeldTimer = now + NAV_REPEAT_RATE;
        move(activeDir);
      }
    } else {
      navHeldDir = null;
    }

    // ── Right stick / left stick scrolling ─────────────────────────
    // Right stick Y scrolls the active screen's scrollable container.
    // Left stick also scrolls when d-pad is not pressed (fallback for screens with no nav items).
    const rsY = gp.axes[3] ?? 0; // right stick Y
    const lsY = gp.axes[1] ?? 0; // left stick Y
    const scrollAxis = Math.abs(rsY) > 0.15 ? rsY : (Math.abs(lsY) > 0.15 && !activeDir ? lsY : 0);
    if (Math.abs(scrollAxis) > 0.15) {
      const screenEl = document.getElementById(curScreen) ||
                       (pauseOpen ? document.getElementById('pause-overlay') : null);
      if (screenEl) {
        let scrollTarget = null;

        // 1. Walk UP from focused element — catches scrollable ancestors
        const focused = document.querySelector('.ui-nav-focus');
        let el = focused;
        while (el && el !== document.body) {
          if (el.scrollHeight > el.clientHeight + 2) { scrollTarget = el; break; }
          el = el.parentElement;
        }

        // 2. Check the screen itself
        if (!scrollTarget && screenEl.scrollHeight > screenEl.clientHeight + 2) {
          scrollTarget = screenEl;
        }

        // 3. Walk DOWN into screen children — catches screens where the scrollable
        //    container is a child div (hero-detail-page, hero-select-solo, how-to-play, options)
        if (!scrollTarget) {
          const candidate = screenEl.querySelector('[style*="overflow-y:auto"],[style*="overflow-y: auto"],[style*="overflow:auto"],[style*="overflow: auto"]');
          if (candidate && candidate.scrollHeight > candidate.clientHeight + 2) {
            scrollTarget = candidate;
          }
        }

        if (scrollTarget) {
          const speed = 12;
          scrollTarget.scrollTop += scrollAxis * speed;
        }
      }
    }

    prevUIButtons = gp.buttons.map(b => b?.pressed ?? false);
  }

  // Keyboard UI navigation
  function onKey(e) {
    const inGame = gameState && !gameState.over &&
                   document.getElementById('game')?.classList.contains('active');
    if (inGame) return; // game handles its own keys

    const map = {
      ArrowUp:'up', ArrowDown:'down', ArrowLeft:'left', ArrowRight:'right',
      KeyW:'up',    KeyS:'down',      KeyA:'left',      KeyD:'right',
    };
    if (map[e.code]) {
      e.preventDefault();
      move(map[e.code]);
    } else if (e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      confirm();
    } else if (e.code === 'Escape') {
      e.preventDefault();
      // Escape in-game = pause; in menus = back
      if (document.getElementById('game')?.classList.contains('active')) {
        togglePause(0);
      } else {
        back();
      }
    }
  }

  // Hook into showScreen so nav activates on screen transitions
  const _origShowScreen = window.showScreen;
  // We'll patch showScreen after it's defined — see init()

  function init() {
    // Keyboard listeners
    window.addEventListener('keydown', onKey);

    // Patch showScreen to activate nav on transition
    const orig = showScreen;
    window.showScreen = function(id) {
      orig(id);
      // Refresh focus items after DOM settles
      setTimeout(() => activate(id), 80);
    };

    // Start loop for controller UI polling
    ;(function uiNavLoop() {
      try {
        const all = Array.from(navigator.getGamepads ? navigator.getGamepads() : []);
        const gp  = _pickBestGamepad(all);
        const wasConnected = gamepadState.connected;
        if (gp) {
          gamepadState.connected = true;
          gamepadState.id        = gp.id;
          gamepadState.type      = _detectControllerType(gp.id);
        } else if (gamepadState.connected) {
          gamepadState.connected = false;
        }
        if (wasConnected !== gamepadState.connected) _refreshOptionsIfOpen();
        pollControllerUI(gp);
      } catch(e) {}
      requestAnimationFrame(uiNavLoop);
    })();

    // Initial activation
    activate('menu');
  }

  return { activate, move, confirm, back, init };
})();

// CSS for focus ring
(function injectNavCSS() {
  const style = document.createElement('style');
  style.textContent = `
    .ui-nav-focus {
      outline: 2px solid #ffee44 !important;
      outline-offset: 3px !important;
      box-shadow: 0 0 12px rgba(255,238,68,0.5) !important;
    }
    .ui-nav-focus.hero-card {
      border-color: #ffee44 !important;
      box-shadow: 0 0 16px rgba(255,238,68,0.6), inset 0 0 8px rgba(255,238,68,0.1) !important;
    }
    .ui-nav-focus-p2 {
      outline: 2px solid #44eeff !important;
      outline-offset: 5px !important;
      box-shadow: 0 0 12px rgba(68,238,255,0.5) !important;
    }
    .ui-nav-focus-p2.hero-card {
      border-color: #44eeff !important;
      box-shadow: 0 0 16px rgba(68,238,255,0.6), inset 0 0 8px rgba(68,238,255,0.1) !important;
    }
    .ui-nav-focus.ui-nav-focus-p2.hero-card {
      border-color: #ffee44 !important;
      box-shadow: 0 0 16px rgba(255,238,68,0.6), 0 0 24px rgba(68,238,255,0.4) !important;
    }
  `;
  document.head.appendChild(style);
})();
buildHeroGrid('hero-grid','hero-detail');
checkLaunchTip();
UINav.init();

// Standalone gamepad debug loop — runs independently of game loop
(function gpDebugLoop() {
  try {
    const all = Array.from(navigator.getGamepads ? navigator.getGamepads() : []);
    const gp = _pickBestGamepad(all);
    _updateGPDebug(gp || null, all);
  } catch(e) {}
  requestAnimationFrame(gpDebugLoop);
})();

let _inputSourceListeners = [];
function _onInputSourceChange(source) {
  _inputSourceListeners.forEach(fn => { try { fn(source); } catch(e) {} });
  if (source === 'touch') {
    // Apply saved layout when entering touch mode
    if (typeof applyTouchLayoutIfNeeded === 'function') applyTouchLayoutIfNeeded();
  } else {
    // Clear fixed positions when switching to keyboard/gamepad
    if (typeof _clearLayout === 'function') _clearLayout();
  }
}
function onInputSourceChange(fn) {
  _inputSourceListeners.push(fn);
}

// ── Mouse click → keyboard-mode ──
// Only switches from gamepad-mode if no controller is currently connected
window.addEventListener('mousedown', () => {
  if (document.body.classList.contains('keyboard-mode')) return;
  if (gamepadState.connected) return; // controller connected — don't let mouse override it
  document.body.classList.remove('gamepad-mode', 'touch-mode',
    'gp-ps', 'gp-xbox', 'gp-nintendo', 'gp-generic');
  document.body.classList.add('keyboard-mode');
  refreshDynamicBindLabels();
  _onInputSourceChange('keyboard');
  _restartCursorsIfOnRoster();
}, { passive: true });

// ── Touch mode detection ──
window.addEventListener('touchstart', () => {
  if (gamepadState.connected) return; // controller connected — ignore touch for mode
  document.body.classList.remove('keyboard-mode', 'gamepad-mode');
  document.body.classList.add('touch-mode');
  refreshDynamicBindLabels();
  _onInputSourceChange('touch');
  _restartCursorsIfOnRoster();
}, { passive: true });

// ── Mouse movement → keyboard-mode ──
// Only when no controller connected and not already in keyboard-mode
window.addEventListener('mousemove', () => {
  if (document.body.classList.contains('keyboard-mode')) return;
  if (document.body.classList.contains('gamepad-mode')) return;
  if (document.body.classList.contains('touch-mode') && gamepadState.connected) return;
  document.body.classList.remove('touch-mode');
  document.body.classList.add('keyboard-mode');
  refreshDynamicBindLabels();
  _onInputSourceChange('keyboard');
  _restartCursorsIfOnRoster();
}, { passive: true });

function _restartCursorsIfOnRoster() {
  const hs = document.getElementById('hero-select');
  if (!hs || !hs.classList.contains('active')) return;
  clearTimeout(window._pcStartTimer);
  window._pcStartTimer = setTimeout(() => {
    if (typeof PlayerCursors !== 'undefined') PlayerCursors.start();
  }, 80);
}

// Inject SVG icons into static HTML slots
(function initIcons() {
  const tipEl = document.getElementById('tip-icon-el');
  if (tipEl) tipEl.innerHTML = iconSVG('TIP', 44);
  const globeEl = document.getElementById('online-globe-el');
  if (globeEl) globeEl.innerHTML = iconSVG('ONLINE', 80);
  const autoIcon = document.getElementById('icon-auto');
  if (autoIcon) autoIcon.innerHTML = ''; // icon-auto no longer used (replaced with text)
  const pauseIcon = document.getElementById('pause-icon');
  if (pauseIcon) pauseIcon.innerHTML = iconSVG('PAUSE', 14);
  const radarIcon = document.getElementById('radar-icon');
  if (radarIcon) radarIcon.innerHTML = iconSVG('RADAR', 14);
})();

// ═══════════════════════════════════════════════════════════════════════════
// TOUCH LAYOUT EDITOR
// Allows players to drag individual touch controls to any position.
// Positions saved as % of screen size so they work across resolutions.
// ═══════════════════════════════════════════════════════════════════════════

const LAYOUT_STORAGE_KEY = 'ec_touchLayout';

// Default positions as % of screen (x=left%, y=top%)
const LAYOUT_DEFAULTS = {
  'joystick-zone': { x: 4,  y: 55 },
  'btn-q':         { x: 72, y: 38 },
  'btn-e':         { x: 83, y: 38 },
  'btn-r':         { x: 77, y: 56 },
  'btn-sprint':    { x: 72, y: 72 },
  'btn-special':   { x: 83, y: 72 },
  'btn-rockbuster':{ x: 77, y: 88 },
};

let _layoutEditing = false;
let _layoutPositions = null;
let _layoutDragState = null;

function _loadLayout() {
  try {
    const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch(e) {}
  return JSON.parse(JSON.stringify(LAYOUT_DEFAULTS));
}

function _saveLayout() {
  try { localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(_layoutPositions)); } catch(e) {}
}

function _applyLayout() {
  if (!document.body.classList.contains('touch-mode')) return;
  if (!_layoutPositions) _layoutPositions = _loadLayout();
  const W = window.innerWidth;
  const H = window.innerHeight;
  for (const [id, pos] of Object.entries(_layoutPositions)) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.style.position = 'fixed';
    el.style.left = (pos.x / 100 * W) + 'px';
    el.style.top  = (pos.y / 100 * H) + 'px';
    el.style.margin = '0';
  }
}

function _resetLayout(el) {
  // Restore normal flow positioning when not in touch mode
  el.style.position = '';
  el.style.left = '';
  el.style.top = '';
  el.style.margin = '';
}

function _clearLayout() {
  for (const id of Object.keys(LAYOUT_DEFAULTS)) {
    const el = document.getElementById(id);
    if (el) _resetLayout(el);
  }
}

function _resetLayoutToDefaults() {
  _layoutPositions = JSON.parse(JSON.stringify(LAYOUT_DEFAULTS));
  _saveLayout();
  _applyLayout();
}

function enterLayoutEdit() {
  if (!document.body.classList.contains('touch-mode')) return;
  _layoutEditing = true;
  if (!_layoutPositions) _layoutPositions = _loadLayout();
  _applyLayout();
  document.body.classList.add('layout-edit-mode');

  // Build overlay UI
  let overlay = document.getElementById('layout-edit-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'layout-edit-overlay';
    overlay.style.cssText = `
      position:fixed; inset:0; z-index:9999; pointer-events:none;
    `;
    // Top bar
    const bar = document.createElement('div');
    bar.style.cssText = `
      position:fixed; top:0; left:0; right:0; height:48px;
      background:rgba(0,0,0,0.85); border-bottom:1px solid rgba(0,212,255,0.4);
      display:flex; align-items:center; justify-content:space-between;
      padding:0 16px; pointer-events:all; z-index:10000;
      font-family:'Orbitron',monospace; font-size:12px; letter-spacing:1px;
    `;
    bar.innerHTML = `
      <span style="color:#44ccff;">✦ EDIT TOUCH LAYOUT</span>
      <div style="display:flex;gap:12px;">
        <button onclick="resetTouchLayout()" style="
          background:rgba(255,80,80,0.15); border:1px solid rgba(255,80,80,0.5);
          color:#ff5050; font-family:'Orbitron',monospace; font-size:10px;
          letter-spacing:1px; padding:6px 14px; border-radius:20px; cursor:pointer;">
          RESET
        </button>
        <button onclick="exitLayoutEdit()" style="
          background:rgba(0,212,255,0.15); border:1px solid rgba(0,212,255,0.5);
          color:#44ccff; font-family:'Orbitron',monospace; font-size:10px;
          letter-spacing:1px; padding:6px 14px; border-radius:20px; cursor:pointer;">
          DONE
        </button>
      </div>
    `;
    overlay.appendChild(bar);
    document.body.appendChild(overlay);
  }
  overlay.style.display = 'block';

  // Make each control draggable
  for (const id of Object.keys(LAYOUT_DEFAULTS)) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.dataset.layoutId = id;
    el.style.cursor = 'grab';
    el.style.outline = '2px dashed rgba(0,212,255,0.6)';
    el.style.borderRadius = el.style.borderRadius || '12px';
    el.addEventListener('touchstart', _layoutTouchStart, { passive: false });
    el.addEventListener('mousedown',  _layoutMouseStart);
  }
}

function exitLayoutEdit() {
  _layoutEditing = false;
  document.body.classList.remove('layout-edit-mode');
  const overlay = document.getElementById('layout-edit-overlay');
  if (overlay) overlay.style.display = 'none';
  for (const id of Object.keys(LAYOUT_DEFAULTS)) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.style.cursor = '';
    el.style.outline = '';
    el.removeEventListener('touchstart', _layoutTouchStart);
    el.removeEventListener('mousedown',  _layoutMouseStart);
  }
  _saveLayout();
}

function resetTouchLayout() {
  _resetLayoutToDefaults();
}

function _layoutTouchStart(e) {
  if (!_layoutEditing) return;
  e.preventDefault();
  const el = e.currentTarget;
  const touch = e.touches[0];
  const rect = el.getBoundingClientRect();
  _layoutDragState = {
    el,
    id: el.dataset.layoutId,
    offX: touch.clientX - rect.left,
    offY: touch.clientY - rect.top,
  };
  el.style.opacity = '0.8';
  el.style.cursor = 'grabbing';
  document.addEventListener('touchmove',  _layoutTouchMove,  { passive: false });
  document.addEventListener('touchend',   _layoutTouchEnd);
}

function _layoutMouseStart(e) {
  if (!_layoutEditing) return;
  e.preventDefault();
  const el = e.currentTarget;
  const rect = el.getBoundingClientRect();
  _layoutDragState = {
    el,
    id: el.dataset.layoutId,
    offX: e.clientX - rect.left,
    offY: e.clientY - rect.top,
  };
  el.style.opacity = '0.8';
  el.style.cursor = 'grabbing';
  document.addEventListener('mousemove', _layoutMouseMove);
  document.addEventListener('mouseup',   _layoutMouseEnd);
}

function _layoutTouchMove(e) {
  if (!_layoutDragState) return;
  e.preventDefault();
  const touch = e.touches[0];
  _moveElement(touch.clientX, touch.clientY);
}

function _layoutMouseMove(e) {
  if (!_layoutDragState) return;
  _moveElement(e.clientX, e.clientY);
}

function _moveElement(cx, cy) {
  const { el, id, offX, offY } = _layoutDragState;
  const W = window.innerWidth, H = window.innerHeight;
  const elW = el.offsetWidth, elH = el.offsetHeight;
  const newX = Math.max(0, Math.min(W - elW, cx - offX));
  const newY = Math.max(48, Math.min(H - elH, cy - offY)); // 48 = bar height
  el.style.left = newX + 'px';
  el.style.top  = newY + 'px';
  _layoutPositions[id] = { x: (newX / W) * 100, y: (newY / H) * 100 };
}

function _layoutTouchEnd() {
  if (_layoutDragState) {
    _layoutDragState.el.style.opacity = '1';
    _layoutDragState.el.style.cursor  = 'grab';
    _layoutDragState = null;
  }
  document.removeEventListener('touchmove', _layoutTouchMove);
  document.removeEventListener('touchend',  _layoutTouchEnd);
}

function _layoutMouseEnd() {
  if (_layoutDragState) {
    _layoutDragState.el.style.opacity = '1';
    _layoutDragState.el.style.cursor  = 'grab';
    _layoutDragState = null;
  }
  document.removeEventListener('mousemove', _layoutMouseMove);
  document.removeEventListener('mouseup',   _layoutMouseEnd);
}

// Apply saved layout on touch mode activation
function applyTouchLayoutIfNeeded() {
  if (!document.body.classList.contains('touch-mode')) {
    _clearLayout(); // restore normal flow if we switched input modes
    return;
  }
  if (!_layoutPositions) _layoutPositions = _loadLayout();
  const hasCustom = Object.keys(LAYOUT_DEFAULTS).some(id => {
    const saved = _layoutPositions[id];
    const def   = LAYOUT_DEFAULTS[id];
    return !saved || Math.abs(saved.x - def.x) > 0.5 || Math.abs(saved.y - def.y) > 0.5;
  });
  if (hasCustom) _applyLayout();
}

// Long-press on game canvas to enter edit mode (600ms)
let _longPressTimer = null;
document.addEventListener('touchstart', e => {
  if (!document.getElementById('game')?.classList.contains('active')) return;
  if (e.touches.length !== 1) return;
  const target = e.target;
  // Only trigger long-press on the canvas background, not on controls
  if (target.closest('#controls, #controls-p2, #joystick-zone, .ability-btn, #btn-scoreboard-touch')) return;
  _longPressTimer = setTimeout(() => {
    enterLayoutEdit();
  }, 600);
}, { passive: true });

document.addEventListener('touchend',   () => clearTimeout(_longPressTimer), { passive: true });
document.addEventListener('touchmove',  () => clearTimeout(_longPressTimer), { passive: true });

// Re-apply on window resize (touch mode only)
window.addEventListener('resize', () => {
  if (!document.body.classList.contains('touch-mode')) return;
  if (_layoutEditing) return;
  if (_layoutPositions) {
    const hasCustom = Object.keys(LAYOUT_DEFAULTS).some(id => {
      const saved = _layoutPositions[id];
      const def   = LAYOUT_DEFAULTS[id];
      return !saved || Math.abs(saved.x - def.x) > 0.5 || Math.abs(saved.y - def.y) > 0.5;
    });
    if (hasCustom) _applyLayout();
  }
});
