// ========== KEYBINDING SYSTEM ==========
const DEFAULT_BINDINGS = {
  up:    ['KeyW','ArrowUp'],
  down:  ['KeyS','ArrowDown'],
  left:  ['KeyA','ArrowLeft'],
  right: ['KeyD','ArrowRight'],
  q:     ['KeyQ'],
  e:     ['KeyE'],
  r:     ['KeyR'],
  sprint:['ShiftLeft','ShiftRight'],
  special:['KeyF'],
  rockbuster: ['KeyG'],
  pause: ['Escape'],
};
let keybindings = (() => {
  const saved = JSON.parse(localStorage.getItem('ec_keybindings') || 'null');
  // Merge saved over defaults — ensures new actions (e.g. sprint) are always present
  return Object.assign(JSON.parse(JSON.stringify(DEFAULT_BINDINGS)), saved || {});
})();
let rebindingAction = null;  // which action is being rebound

function saveBindings() { localStorage.setItem('ec_keybindings', JSON.stringify(keybindings)); refreshDynamicBindLabels(); }
function resetBindings() { keybindings = JSON.parse(JSON.stringify(DEFAULT_BINDINGS)); saveBindings(); }

function keyMatchesAction(code, action) {
  return (keybindings[action]||[]).includes(code);
}

// ========== GAMEPAD SUPPORT ==========
// Standard Gamepad API button indices (mapping === 'standard'):
//   0=A/Cross  1=B/Circle  2=X/Square  3=Y/Triangle
//   4=LB/L1    5=RB/R1     6=LT/L2     7=RT/R2
//   8=Select   9=Start/Options  10=L3  11=R3
//   12=DUp  13=DDown  14=DLeft  15=DRight  16=Home/Guide
// Axes: 0=LS-X  1=LS-Y  2=RS-X  3=RS-Y

function _detectControllerType(id) {
  const s = (id || '').toLowerCase();
  if (/054c|sony|playstation|dualshock|dualsense/.test(s))   return 'ps';
  if (/045e|xbox|microsoft|xinput/.test(s))                  return 'xbox';
  if (/057e|nintendo|switch|pro controller|joy-con/.test(s)) return 'nintendo';
  if (/8bitdo/.test(s))                                      return '8bitdo';
  if (/stadia/.test(s))                                      return 'stadia';
  if (/logitech|046d/.test(s))                               return 'logitech';
  return 'generic';
}

// Button maps: { a, b, x, y, lb, rb, start, dup, ddown, dleft, dright, lx, ly }
// lx/ly = axis indices for left stick
const CONTROLLER_MAPS = {
  standard:  { a:0,  b:1,  x:2,  y:3,  lb:4, rb:5, start:9,  dup:12, ddown:13, dleft:14, dright:15, lx:0, ly:1 },
  nintendo:  { a:1,  b:0,  x:3,  y:2,  lb:4, rb:5, start:9,  dup:12, ddown:13, dleft:14, dright:15, lx:0, ly:1 },
  '8bitdo':  { a:0,  b:1,  x:3,  y:4,  lb:6, rb:7, start:11, dup:12, ddown:13, dleft:14, dright:15, lx:0, ly:1 },
  logitech:  { a:1,  b:2,  x:0,  y:3,  lb:4, rb:5, start:9,  dup:12, ddown:13, dleft:14, dright:15, lx:0, ly:1 },
};

function _getButtonMap(gp) {
  if (gp.mapping === 'standard') return CONTROLLER_MAPS.standard;
  const type = _detectControllerType(gp.id);
  return CONTROLLER_MAPS[type] || CONTROLLER_MAPS.standard;
}

const SKIP_DEVICE_KEYWORDS = /keyboard|keychron|ducky|corsair|razer blackwidow|steelseries apex|das keyboard|hyperx alloy/i;
let gamepadState = { connected: false, id: '', type: 'generic' };
let prevGamepadButtons = [];
let activeGamepadIndex = -1;

function _pickBestGamepad(gamepads) {
  if (activeGamepadIndex >= 0) {
    const prev = gamepads[activeGamepadIndex];
    if (prev && prev.connected && !SKIP_DEVICE_KEYWORDS.test(prev.id)) return prev;
  }
  for (let i = 0; i < gamepads.length; i++) {
    const g = gamepads[i];
    if (!g || !g.connected) continue;
    if (SKIP_DEVICE_KEYWORDS.test(g.id)) continue;
    activeGamepadIndex = i;
    return g;
  }
  return null;
}

function pollGamepad(gs) {
  let gamepads = [];
  try { gamepads = Array.from(navigator.getGamepads ? navigator.getGamepads() : []); }
  catch(e) { return; }

  const gp = _pickBestGamepad(gamepads);
  if (!gp) {
    if (gamepadState.connected) {
      gamepadState.connected = false;
      activeGamepadIndex = -1;
      document.body.classList.remove('gamepad-mode','gp-ps','gp-xbox','gp-nintendo','gp-generic','keyboard-mode');
      refreshDynamicBindLabels();
    }
    _updateGPDebug(null, gamepads);
    return;
  }

  gamepadState.connected = true;
  gamepadState.id   = gp.id;
  gamepadState.type = _detectControllerType(gp.id);
  if (!document.body.classList.contains('gamepad-mode')) _applyGamepadUI(gp);
  refreshDynamicBindLabels();
  _updateGPDebug(gp, gamepads);

  const M = _getButtonMap(gp);

  // ── Movement: left stick + d-pad ──
  const deadzone = 0.12;
  let axisX = gp.axes[M.lx] || 0;
  let axisY = gp.axes[M.ly] || 0;
  // Fallback: try axes 2/3 if 0/1 are dead
  if (Math.abs(axisX) < deadzone && Math.abs(axisY) < deadzone && gp.axes.length > 3) {
    const ax2 = gp.axes[2] || 0, ay2 = gp.axes[3] || 0;
    if (Math.abs(ax2) > deadzone || Math.abs(ay2) > deadzone) { axisX = ax2; axisY = ay2; }
  }

  const p = gs?.player;
  if (p && p.alive && p.stunned <= 0 && p.frozen <= 0) {
    const gpX = Math.abs(axisX) > deadzone ? axisX : 0;
    const gpY = Math.abs(axisY) > deadzone ? axisY : 0;
    const dpL = gp.buttons[M.dleft ]?.pressed ? -1 : 0;
    const dpR = gp.buttons[M.dright]?.pressed ?  1 : 0;
    const dpU = gp.buttons[M.dup   ]?.pressed ? -1 : 0;
    const dpD = gp.buttons[M.ddown ]?.pressed ?  1 : 0;
    const rawX = gpX + dpL + dpR;
    const rawY = gpY + dpU + dpD;
    const len  = Math.hypot(rawX, rawY) || 1;
    // Always write joyDelta from gamepad (including zero) so keyboard handler can't override
    joyDelta.x = rawX !== 0 ? rawX / Math.max(1, len) : 0;
    joyDelta.y = rawY !== 0 ? rawY / Math.max(1, len) : 0;
    if (rawX !== 0) p.facing = rawX > 0 ? 1 : -1;
  } else if (!p?.alive) {
    // Clear movement when player is dead
    joyDelta.x = 0;
    joyDelta.y = 0;
  }

  // ── Abilities: use controllerBindings for remappable buttons ──
  [['q', 0],['e', 1],['r', 2]].forEach(([action, idx]) => {
    if (ctrlBtnPressed(action, gp, prevGamepadButtons) && gs && p && p.alive) {
      const nearest = gs.enemies.reduce((best, e) => {
        if (!e.alive) return best;
        const d = Math.hypot(e.x-p.x, e.y-p.y);
        return (!best || d < best.d) ? {e,d} : best;
      }, null);
      useAbility(idx, null, nearest?.e);
    }
  });

  // ── Sprint ──
  if (ctrlBtnPressed('sprint', gp, prevGamepadButtons)) activateSprint();

  // ── Special ability ──
  if (ctrlBtnPressed('special', gp, prevGamepadButtons)) activateSpecial();

  // ── Rock Buster ──
  if (ctrlBtnPressed('rockbuster', gp, prevGamepadButtons)) activateRockBuster();

  // ── Pause (ignore for 1s after launch to avoid carry-over press) ──
  const pauseGrace = (Date.now() - gameStartTime) > 1000;
  if (pauseGrace && ctrlBtnPressed('pause', gp, prevGamepadButtons)) togglePause();

  // ── Score overlay — Select/Back (button 8) hold to view ──
  const selectNow  = gp.buttons[8]?.pressed ?? false;
  const selectPrev = prevGamepadButtons[8] ?? false;
  if (selectNow && !selectPrev) showScoreOverlay();
  if (!selectNow && selectPrev) hideScoreOverlay();

  prevGamepadButtons = gp.buttons.map(b => b?.pressed ?? false);
}

window.addEventListener('gamepadconnected', e => {
  activeGamepadIndex = -1;
  // Update gamepadState immediately — don't wait for game loop
  try {
    const gps = Array.from(navigator.getGamepads ? navigator.getGamepads() : []);
    const gp  = _pickBestGamepad(gps);
    if (gp) {
      gamepadState.connected = true;
      gamepadState.id        = gp.id;
      gamepadState.type      = _detectControllerType(gp.id);
    }
  } catch(err) {}
  showFloatText && showFloatText(window.innerWidth/2, 80, 'CONTROLLER CONNECTED', '#44ff88');
  _refreshOptionsIfOpen();
});
window.addEventListener('gamepaddisconnected', e => {
  if (activeGamepadIndex === e.gamepad.index) {
    gamepadState.connected = false;
    activeGamepadIndex = -1;
    document.body.classList.remove('gamepad-mode','gp-ps','gp-xbox','gp-nintendo','gp-generic','keyboard-mode');
    document.querySelectorAll('.ui-nav-focus').forEach(el => el.classList.remove('ui-nav-focus'));
    _refreshOptionsIfOpen();
  }
});

function _refreshOptionsIfOpen() {
  if (document.getElementById('options')?.classList.contains('active'))
    setTimeout(() => buildOptionsPanel('options-inner'), 50);
  if (document.getElementById('options-ingame')?.classList.contains('active'))
    setTimeout(() => buildOptionsPanel('options-ingame-inner'), 50);
}

function _updateGPDebug(activeGp, allGamepads) {
  const dbg = document.getElementById('gp-debug');
  if (!dbg) return;
  const all = (allGamepads || []).filter(g => g && g.connected);
  if (all.length === 0 || !window._gpDebugVisible) { dbg.style.display = 'none'; return; }
  dbg.style.display = 'block';
  document.getElementById('gp-debug-id').innerHTML = all.map((g,i) =>
    `<span style="color:${g===activeGp?'#ffee44':'#888'}">[slot ${g.index}] ${g.id.substring(0,48)} [${g.mapping}]</span>`
  ).join('<br>');
  if (activeGp) {
    const axes = Array.from(activeGp.axes).map((v,i)=>`A${i}:${v.toFixed(2)}`).join('  ');
    document.getElementById('gp-debug-axes').textContent = axes;
    const btns = Array.from(activeGp.buttons)
      .map((b,i)=>b.pressed?`[${i}]`:null).filter(Boolean).join(' ') || '—';
    document.getElementById('gp-debug-btns').textContent = 'Pressed: '+btns;
  }
}

function _applyGamepadUI(gp) {
  // On touch devices keep the virtual joystick visible — don't enter gamepad-mode
  const isTouch = navigator.maxTouchPoints > 0;
  if (isTouch) return;

  const id   = typeof gp === 'string' ? gp : gp.id;
  const type = _detectControllerType(id);
  const isPS  = type === 'ps';
  const isNin = type === 'nintendo';
  document.body.classList.remove('keyboard-mode');
  document.body.classList.add('gamepad-mode');
  document.body.classList.toggle('gp-ps',      isPS);
  document.body.classList.toggle('gp-nintendo', isNin);
  document.body.classList.toggle('gp-xbox',     !isPS && !isNin);
  document.querySelectorAll('.gp-label-ps').forEach(el =>
    el.style.display = isPS ? 'inline' : 'none');
  document.querySelectorAll('.gp-label-xbox').forEach(el =>
    el.style.display = (!isPS && !isNin) ? 'inline' : 'none');
}

