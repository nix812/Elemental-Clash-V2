// ========== SCREEN NAV ==========
function toggleIndicators() {
  showOffScreenIndicators = !showOffScreenIndicators;
  const btn = document.getElementById('indicator-btn');
  if (btn) {
    const radarSpan = document.getElementById('radar-icon');
    if (radarSpan) radarSpan.innerHTML = iconSVG('RADAR', 14);
    btn.innerHTML = '';
    const iconSpan = document.createElement('span');
    iconSpan.id = 'radar-icon';
    iconSpan.innerHTML = iconSVG('RADAR', 14);
    btn.appendChild(iconSpan);
    btn.appendChild(document.createTextNode(' ' + (showOffScreenIndicators ? 'RADAR ON' : 'RADAR OFF')));
    btn.style.color = showOffScreenIndicators ? '#00d4ff' : 'rgba(255,255,255,0.3)';
    btn.style.borderColor = showOffScreenIndicators ? 'rgba(0,212,255,0.35)' : 'rgba(255,255,255,0.1)';
  }
}

function togglePause(playerIdx) {
  const overlay = document.getElementById('pause-overlay');
  if (!overlay) return;
  const paused = overlay.style.display === 'flex';
  overlay.style.display = paused ? 'none' : 'flex';

  // Update pause title to show who paused (only in MP with 2+ humans)
  const titleEl = document.getElementById('pause-title');
  if (titleEl) {
    const isMP = gameState?.players && gameState.players.length > 1;
    if (!paused && isMP && playerIdx !== undefined) {
      const color = PLAYER_COLORS[playerIdx] ?? '#00d4ff';
      titleEl.textContent = `P${playerIdx + 1} PAUSED`;
      titleEl.style.color = color;
    } else {
      titleEl.textContent = 'PAUSED';
      titleEl.style.color = '#00d4ff';
    }
  }

  if (paused) {
    if (gameState) gameState._lastTimestamp = null;
    animFrame = requestAnimationFrame(gameLoop);
  } else {
    cancelAnimationFrame(animFrame);
    setTimeout(() => UINav.activate('pause-overlay'), 50);
  }
}

function showScoreOverlay() {
  const overlay = document.getElementById('score-overlay');
  if (!overlay || !gameState || gameState.over) return;
  // Pause overlay takes priority
  const pauseEl = document.getElementById('pause-overlay');
  if (pauseEl && pauseEl.style.display === 'flex') return;

  const gs = gameState;
  const myTeam  = gs.player.teamId ?? 0;
  const oppTeam = gs.teamIds.find(t => t !== myTeam) ?? 1;
  const myKills  = gs.teamKills[myTeam]  ?? 0;
  const oppKills = gs.teamKills[oppTeam] ?? 0;

  // Team score header
  document.getElementById('score-overlay-teams').innerHTML =
    `<span style="color:#00d4ff">${myKills}</span>` +
    `<span style="color:rgba(255,255,255,0.3);font-size:0.5em;vertical-align:middle;margin:0 12px">—</span>` +
    `<span style="color:#ff4466">${oppKills}</span>`;
  document.getElementById('score-overlay-limit').textContent =
    `FIRST TO ${gs.maxKills} KILLS WINS`;

  // Build scoreboard table — same structure as win-screen
  const allChars = [gs.player, ...gs.enemies].filter(c => c);
  allChars.sort((a, b) => ((b.kills||0)*3 + (b.assists||0) - (b.deaths||0)) -
                           ((a.kills||0)*3 + (a.assists||0) - (a.deaths||0)));
  const rows = allChars.map(c => {
    const k = c.kills||0, a = c.assists||0, d = c.deaths||0;
    const kda = d === 0 ? '—' : ((k + a * 0.5) / d).toFixed(1);
    const isPlayer = c.isPlayer;
    const teamCol  = (c.teamId ?? 0) === myTeam ? '#00d4ff' : '#ff4466';
    return `<tr class="${isPlayer ? 'is-player' : ''}">
      <td><div class="wsb-hero">
        <div class="wsb-dot" style="background:${c.hero.color}"></div>
        <span style="color:${c.hero.color}">${c.hero.name}</span>
        ${isPlayer ? '<span style="color:var(--muted);font-size:0.8em;margin-left:4px">(YOU)</span>' : ''}
        <div class="wsb-dot" style="background:${teamCol};margin-left:4px;opacity:0.6"></div>
      </div></td>
      <td class="wsb-kills">${k}</td>
      <td class="wsb-assists">${a}</td>
      <td class="wsb-deaths">${d}</td>
      <td>${kda}</td>
    </tr>`;
  }).join('');

  document.getElementById('score-overlay-table-wrap').innerHTML =
    `<table class="win-scoreboard">
      <thead><tr>
        <th>HERO</th><th>KILLS</th><th>ASSISTS</th><th>DEATHS</th><th>KDA</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

  overlay.style.display = 'flex';
}

function hideScoreOverlay() {
  const overlay = document.getElementById('score-overlay');
  if (overlay) overlay.style.display = 'none';
}

// ========== CONTROLLER BINDINGS ==========
const DEFAULT_CONTROLLER_BINDINGS = {
  q:           [2],   // X / Square
  e:           [0],   // A / Cross
  r:           [5],   // RB / R1
  sprint:      [4],   // LB / L1
  special:     [3],   // Y / Triangle
  rockbuster:  [1],   // B / Circle
  pause:       [9],   // Start / Options
  cycleTarget: [10],  // L3 (left stick click) — separated from scoreboard
  scoreboard:  [8],   // Select / Share
};

const CTRL_BINDINGS_VERSION = 2; // bump when defaults change to force reset
let controllerBindings = (() => {
  const saved = JSON.parse(localStorage.getItem('ec_ctrl_bindings') || 'null');
  // Force reset if saved bindings are from an older version
  if (saved && saved._version !== CTRL_BINDINGS_VERSION) {
    localStorage.removeItem('ec_ctrl_bindings');
    return JSON.parse(JSON.stringify(DEFAULT_CONTROLLER_BINDINGS));
  }
  const merged = Object.assign(JSON.parse(JSON.stringify(DEFAULT_CONTROLLER_BINDINGS)), saved || {});
  for (const k of Object.keys(merged)) {
    if (k === '_version') continue;
    if (!Array.isArray(merged[k])) merged[k] = merged[k] >= 0 ? [merged[k]] : [];
  }
  return merged;
})();
let rebindingCtrlAction = null;
let optionsActiveTab = 'controls'; // persists across rebuilds

function saveCtrlBindings() { controllerBindings._version = CTRL_BINDINGS_VERSION; localStorage.setItem('ec_ctrl_bindings', JSON.stringify(controllerBindings)); refreshDynamicBindLabels(); }
function resetCtrlBindings() { controllerBindings = JSON.parse(JSON.stringify(DEFAULT_CONTROLLER_BINDINGS)); saveCtrlBindings(); }

// Check if any button in a controller binding array is pressed (fresh press)
function ctrlBtnPressed(action, gp, prev) {
  const btns = controllerBindings[action] || [];
  for (const b of btns) {
    if (b >= 0 && (gp.buttons[b]?.pressed ?? false) && !(prev[b] ?? false)) return true;
  }
  return false;
}
function ctrlBtnHeld(action, gp) {
  const btns = controllerBindings[action] || [];
  for (const b of btns) {
    if (b >= 0 && (gp.buttons[b]?.pressed ?? false)) return true;
  }
  return false;
}

// Button index → human label for Xbox and PS
function gpBtnLabel(idx) {
  if (idx === -1 || idx === undefined) return '—';
  const isPS = gamepadState.type === 'ps';
  const XBOX = { 0:'A', 1:'B', 2:'X', 3:'Y', 4:'LB', 5:'RB', 6:'LT', 7:'RT', 8:'Select', 9:'Start', 10:'L3', 11:'R3', 12:'↑', 13:'↓', 14:'←', 15:'→' };
  const PS   = { 0:'Cross', 1:'Circle', 2:'Square', 3:'Triangle', 4:'L1', 5:'R1', 6:'L2', 7:'R2', 8:'Share', 9:'Options', 10:'L3', 11:'R3', 12:'↑', 13:'↓', 14:'←', 15:'→' };
  const map  = isPS ? PS : XBOX;
  return map[idx] !== undefined ? map[idx] : `Btn ${idx}`;
}

// Returns the current human-readable label for an action, based on active device.
// action: 'q' | 'e' | 'r' | 'special' | 'sprint' | 'pause'
function getBindLabel(action) {
  if (gamepadState.connected) {
    const btns = controllerBindings[action] || [];
    if (!btns.length) return '—';
    const btnIdx = btns[0];
    const XBOX = { 0:'A', 1:'B', 2:'X', 3:'Y', 4:'LB', 5:'RB', 6:'LT', 7:'RT', 8:'Select', 9:'Start', 10:'L3', 11:'R3', 12:'↑', 13:'↓', 14:'←', 15:'→' };
    const PS   = { 0:'✕', 1:'○', 2:'□', 3:'△', 4:'L1', 5:'R1', 6:'L2', 7:'R2', 8:'Share', 9:'Options', 10:'L3', 11:'R3', 12:'↑', 13:'↓', 14:'←', 15:'→' };
    const xbox = XBOX[btnIdx] ?? `Btn ${btnIdx}`;
    const ps   = PS[btnIdx]   ?? `Btn ${btnIdx}`;
    return xbox === ps ? xbox : `${xbox}·${ps}`;
  } else {
    const codes = keybindings[action] || [];
    const fmt = c => c.replace(/^Key/, '').replace(/^Digit/, '')
      .replace('ArrowUp','↑').replace('ArrowDown','↓').replace('ArrowLeft','←').replace('ArrowRight','→')
      .replace('ShiftLeft','Shift').replace('ShiftRight','Shift').replace('Escape','Esc');
    return codes.map(fmt).filter((v,i,a) => a.indexOf(v) === i).join('/') || '—';
  }
}

// Update all [data-bind] elements in the DOM with current labels.
// data-bind       → active device (keyboard or controller, whoever is live)
// data-bind-kb    → always keyboard label
// data-bind-ctrl  → always controller label (Xbox·PS)
// Call after device change or after a rebind.
function refreshDynamicBindLabels() {
  const fmtKey = c => c.replace(/^Key/, '').replace(/^Digit/, '')
    .replace('ArrowUp','↑').replace('ArrowDown','↓').replace('ArrowLeft','←').replace('ArrowRight','→')
    .replace('ShiftLeft','Shift').replace('ShiftRight','Shift').replace('Escape','Esc');

  // Active-device spans (roster ability cards, special section header)
  document.querySelectorAll('[data-bind]').forEach(el => {
    el.textContent = getBindLabel(el.dataset.bind);
  });
  // Keyboard-always spans (HTP keyboard card)
  document.querySelectorAll('[data-bind-kb]').forEach(el => {
    const codes = keybindings[el.dataset.bindKb] || [];
    el.textContent = codes.map(fmtKey).filter((v,i,a) => a.indexOf(v) === i).join('/') || '—';
  });
  // Controller-always spans — separate xbox/ps spans get correct label for their type
  document.querySelectorAll('[data-bind-ctrl]').forEach(el => {
    const btns = controllerBindings[el.dataset.bindCtrl] || [];
    if (!btns.length) { el.textContent = '—'; return; }
    const btnIdx = btns[0];
    const XBOX = { 0:'A',1:'B',2:'X',3:'Y',4:'LB',5:'RB',6:'LT',7:'RT',8:'Select',9:'Start',10:'L3',11:'R3',12:'↑',13:'↓',14:'←',15:'→' };
    const PS   = { 0:'✕',1:'○',2:'□',3:'△',4:'L1',5:'R1',6:'L2',7:'R2',8:'Share',9:'Options',10:'L3',11:'R3',12:'↑',13:'↓',14:'←',15:'→' };
    const isXbox = el.classList.contains('gp-label-xbox');
    const isPS   = el.classList.contains('gp-label-ps');
    if (isXbox)      el.textContent = XBOX[btnIdx] ?? `Btn ${btnIdx}`;
    else if (isPS)   el.textContent = PS[btnIdx]   ?? `Btn ${btnIdx}`;
    else             el.textContent = XBOX[btnIdx] === PS[btnIdx] ? XBOX[btnIdx] : `${XBOX[btnIdx] ?? btnIdx}·${PS[btnIdx] ?? btnIdx}`;
  });
  // Move group — keyboard shows WASD-style, controller shows Left Stick
  document.querySelectorAll('[data-bind-move]').forEach(el => {
    if (gamepadState.connected) {
      el.textContent = 'Left Stick';
    } else {
      const dirs = ['up','left','down','right'];
      const labels = dirs.map(d => {
        const codes = keybindings[d] || [];
        return codes.map(fmtKey).filter((v,i,a) => a.indexOf(v) === i)[0] || '?';
      });
      el.textContent = labels.join('') === 'WASD' ? 'WASD' : labels.join('');
    }
  });
  // Aim / auto-attack — keyboard: Left Click, controller: Right Stick / RT·R2
  document.querySelectorAll('[data-bind-aim]').forEach(el => {
    el.textContent = gamepadState.connected ? 'Right Stick / RT·R2' : 'Left Click';
  });
  // Card title + icon — reflects active device
  const titleEl = document.getElementById('htp-ctrl-title');
  if (titleEl) {
    titleEl.textContent = gamepadState.connected ? '🕹 CONTROLLER' : '⌨ KEYBOARD / MOUSE';
    titleEl.style.color = gamepadState.connected ? '#ffcc44' : '#88ccff';
  }
}

function buildOptionsPanel(containerId, tab) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (tab) optionsActiveTab = tab;

  const ctrlConnected = gamepadState.connected;
  const isPS = gamepadState.type === 'ps';
  const CB   = controllerBindings;

  const KB_ACTIONS = [
    {key:'up',          label:'Move Up'},
    {key:'down',        label:'Move Down'},
    {key:'left',        label:'Move Left'},
    {key:'right',       label:'Move Right'},
    {key:'q',           label:'Ability Q'},
    {key:'e',           label:'Ability E'},
    {key:'r',           label:'Ultimate'},
    {key:'sprint',      label:'Sprint'},
    {key:'special',     label:'Special'},
    {key:'rockbuster',  label:'Rock Buster'},
    {key:'pause',       label:'Pause'},
    {key:'cycleTarget', label:'Cycle Target'},
    {key:'scoreboard',  label:'Scoreboard'},
  ];

  const CTRL_ACTIONS = [
    {key:'q',           label:'Ability Q'},
    {key:'e',           label:'Ability E'},
    {key:'r',           label:'Ultimate'},
    {key:'sprint',      label:'Sprint'},
    {key:'special',     label:'Special'},
    {key:'rockbuster',  label:'Rock Buster'},
    {key:'pause',       label:'Pause'},
    {key:'cycleTarget', label:'Cycle Target'},
    {key:'scoreboard',  label:'Scoreboard'},
  ];

  function kbKeyLabel(code) {
    if (!code) return '—';
    return code.replace('Key','').replace('Arrow','').replace('Shift','⇧')
      .replace('Tab','⇥').replace('Escape','Esc').replace('Mouse0','Click');
  }

  // ── Tab bar ──────────────────────────────────────────────────────
  const TABS = [
    { id: 'controls',    label: '⌨ CONTROLS'    },
    { id: 'audio',       label: '🔊 AUDIO'       },
    { id: 'display',     label: '🖥 DISPLAY'     },
    { id: 'patchnotes',  label: '📋 PATCH NOTES' },
  ];

  const tabBarHtml = `
  <div style="display:flex;gap:4px;margin-bottom:24px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:0;">
    ${TABS.map(t => {
      const active = optionsActiveTab === t.id;
      return `<button
        onclick="buildOptionsPanel('${containerId}','${t.id}')"
        style="font-family:'Orbitron',monospace;font-size:var(--fs-xs);padding:9px 16px;
          border:none;border-bottom:2px solid ${active ? 'var(--accent)' : 'transparent'};
          background:${active ? 'rgba(0,212,255,0.08)' : 'transparent'};
          color:${active ? 'var(--accent)' : 'var(--muted)'};
          cursor:pointer;letter-spacing:1px;transition:all 0.15s;border-radius:4px 4px 0 0;">
        ${t.label}
      </button>`;
    }).join('')}
  </div>`;

  // ── CONTROLS TAB ─────────────────────────────────────────────────
  function buildControlsTab() {
    let h = '';

    // Controller status pill
    h += `<div style="margin-bottom:20px;padding:10px 14px;background:rgba(0,0,0,0.35);
      border:1px solid ${ctrlConnected?'rgba(68,255,136,0.25)':'rgba(255,255,255,0.08)'};border-radius:6px;
      display:flex;align-items:center;gap:10px;">
      <span style="font-size:16px;">${ctrlConnected ? '🎮' : '⌨'}</span>
      <div>
        <div style="font-size:var(--fs-xs);color:${ctrlConnected?'#44ff88':'var(--muted)'};letter-spacing:1px;">
          ${ctrlConnected ? 'CONTROLLER CONNECTED' : 'NO CONTROLLER DETECTED'}
        </div>
        <div style="font-size:10px;color:rgba(255,255,255,0.25);margin-top:2px;">
          ${ctrlConnected ? gamepadState.id.substring(0,55) : 'Connect via USB or Bluetooth and press any button'}
        </div>
      </div>
    </div>`;

    // Rebind section — controller (only when connected) — primary + secondary slots
    if (ctrlConnected) {
      h += `<div style="font-size:10px;color:var(--muted);letter-spacing:2px;margin-bottom:8px;">🎮 CONTROLLER REBIND</div>`;
      h += `<div style="display:grid;grid-template-columns:1fr auto auto auto auto auto;gap:4px 8px;align-items:center;margin-bottom:6px;">`;
      h += `<div style="font-size:10px;color:rgba(255,255,255,0.3);padding-bottom:4px;border-bottom:1px solid rgba(255,255,255,0.07);">ACTION</div>
            <div style="font-size:10px;color:rgba(255,255,255,0.3);padding-bottom:4px;border-bottom:1px solid rgba(255,255,255,0.07);">PRIMARY</div>
            <div style="border-bottom:1px solid rgba(255,255,255,0.07);padding-bottom:4px;"></div>
            <div style="font-size:10px;color:rgba(255,255,255,0.3);padding-bottom:4px;border-bottom:1px solid rgba(255,255,255,0.07);">SECONDARY</div>
            <div style="border-bottom:1px solid rgba(255,255,255,0.07);padding-bottom:4px;"></div>
            <div style="border-bottom:1px solid rgba(255,255,255,0.07);padding-bottom:4px;"></div>`;
      CTRL_ACTIONS.forEach(a => {
        const btns = CB[a.key] || [];
        const primary = btns[0] !== undefined ? btns[0] : -1;
        const secondary = btns[1] !== undefined ? btns[1] : -1;
        const waitP = rebindingCtrlAction === a.key + ':0';
        const waitS = rebindingCtrlAction === a.key + ':1';
        h += `
          <div style="font-size:var(--fs-xs);padding:4px 0;">${a.label}</div>
          <div style="font-size:var(--fs-xs);padding:4px 0;color:${waitP?'#ffee44':'var(--text)'};font-family:monospace;letter-spacing:1px;">
            ${waitP ? '🎮 PRESS…' : `[${gpBtnLabel(primary)}]`}
          </div>
          <button onclick="startCtrlRebind('${a.key}',0,'${containerId}')"
            style="font-family:'Orbitron',monospace;font-size:10px;padding:3px 8px;
              background:${waitP?'rgba(255,238,68,0.2)':'rgba(0,212,255,0.08)'};
              border:1px solid ${waitP?'#ffee44':'rgba(0,212,255,0.25)'};
              color:${waitP?'#ffee44':'var(--accent)'};border-radius:4px;cursor:pointer;">
            ${waitP?'CANCEL':'REBIND'}
          </button>
          <div style="font-size:var(--fs-xs);padding:4px 0;color:${waitS?'#ffee44':'var(--text)'};font-family:monospace;letter-spacing:1px;">
            ${waitS ? '🎮 PRESS…' : `[${gpBtnLabel(secondary)}]`}
          </div>
          <button onclick="startCtrlRebind('${a.key}',1,'${containerId}')"
            style="font-family:'Orbitron',monospace;font-size:10px;padding:3px 8px;
              background:${waitS?'rgba(255,238,68,0.2)':'rgba(0,212,255,0.08)'};
              border:1px solid ${waitS?'#ffee44':'rgba(0,212,255,0.25)'};
              color:${waitS?'#ffee44':'var(--accent)'};border-radius:4px;cursor:pointer;">
            ${waitS?'CANCEL':'REBIND'}
          </button>
          <div style="display:flex;align-items:center;">
            ${!waitS && secondary !== -1 ? `<button onclick="clearSecondaryCtrlBinding('${a.key}','${containerId}')"
              style="font-family:'Orbitron',monospace;font-size:9px;padding:3px 6px;
                background:rgba(255,60,60,0.08);border:1px solid rgba(255,60,60,0.2);
                color:rgba(255,100,100,0.7);border-radius:4px;cursor:pointer;">✕</button>` : ''}
          </div>`;
      });
      h += `</div>
      <div style="margin-bottom:24px;">
        <button class="btn reset-btn" onclick="resetCtrlBindings();buildOptionsPanel('${containerId}')"
          style="font-size:10px;padding:5px 12px;margin-top:8px;">RESET CONTROLLER DEFAULTS</button>
      </div>`;
    }

    // Rebind section — keyboard (primary + secondary slots)
    h += `<div style="font-size:10px;color:var(--muted);letter-spacing:2px;margin-bottom:8px;">⌨ KEYBOARD REBIND</div>`;
    h += `<div style="display:grid;grid-template-columns:1fr auto auto auto auto auto;gap:4px 8px;align-items:center;margin-bottom:6px;">`;
    h += `<div style="font-size:10px;color:rgba(255,255,255,0.3);padding-bottom:4px;border-bottom:1px solid rgba(255,255,255,0.07);">ACTION</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.3);padding-bottom:4px;border-bottom:1px solid rgba(255,255,255,0.07);">PRIMARY</div>
          <div style="border-bottom:1px solid rgba(255,255,255,0.07);padding-bottom:4px;"></div>
          <div style="font-size:10px;color:rgba(255,255,255,0.3);padding-bottom:4px;border-bottom:1px solid rgba(255,255,255,0.07);">SECONDARY</div>
          <div style="border-bottom:1px solid rgba(255,255,255,0.07);padding-bottom:4px;"></div>
          <div style="border-bottom:1px solid rgba(255,255,255,0.07);padding-bottom:4px;"></div>`;
    KB_ACTIONS.forEach(a => {
      const keys = keybindings[a.key] || [];
      const primary = keys[0] || null;
      const secondary = keys[1] || null;
      const waitP = rebindingAction === a.key + ':0';
      const waitS = rebindingAction === a.key + ':1';
      h += `
        <div style="font-size:var(--fs-xs);padding:4px 0;">${a.label}</div>
        <div style="font-size:var(--fs-xs);padding:4px 0;color:${waitP?'#ffee44':'var(--text)'};font-family:monospace;letter-spacing:1px;">
          ${waitP ? '⌨ PRESS…' : kbKeyLabel(primary)}
        </div>
        <button onclick="startRebind('${a.key}',0,'${containerId}')"
          style="font-family:'Orbitron',monospace;font-size:10px;padding:3px 8px;
            background:${waitP?'rgba(255,238,68,0.2)':'rgba(0,212,255,0.08)'};
            border:1px solid ${waitP?'#ffee44':'rgba(0,212,255,0.25)'};
            color:${waitP?'#ffee44':'var(--accent)'};border-radius:4px;cursor:pointer;">
          ${waitP?'CANCEL':'REBIND'}
        </button>
        <div style="font-size:var(--fs-xs);padding:4px 0;color:${waitS?'#ffee44':'var(--text)'};font-family:monospace;letter-spacing:1px;">
          ${waitS ? '⌨ PRESS…' : kbKeyLabel(secondary)}
        </div>
        <button onclick="startRebind('${a.key}',1,'${containerId}')"
          style="font-family:'Orbitron',monospace;font-size:10px;padding:3px 8px;
            background:${waitS?'rgba(255,238,68,0.2)':'rgba(0,212,255,0.08)'};
            border:1px solid ${waitS?'#ffee44':'rgba(0,212,255,0.25)'};
            color:${waitS?'#ffee44':'var(--accent)'};border-radius:4px;cursor:pointer;">
          ${waitS?'CANCEL':'REBIND'}
        </button>
        <div style="display:flex;align-items:center;">
          ${!waitS && secondary ? `<button onclick="clearSecondaryBinding('${a.key}','${containerId}')"
            style="font-family:'Orbitron',monospace;font-size:9px;padding:3px 6px;
              background:rgba(255,60,60,0.08);border:1px solid rgba(255,60,60,0.2);
              color:rgba(255,100,100,0.7);border-radius:4px;cursor:pointer;">✕</button>` : ''}
        </div>`;
    });
    h += `</div>
    <div>
      <button class="btn reset-btn" onclick="resetBindings();buildOptionsPanel('${containerId}')"
        style="font-size:10px;padding:5px 12px;margin-top:8px;">RESET KEYBOARD DEFAULTS</button>
    </div>`;

    return h;
  }

  // ── AUDIO TAB ────────────────────────────────────────────────────
  function buildAudioTab() {
    return `
    <div style="display:grid;grid-template-columns:1fr auto;border-radius:8px;overflow:hidden;
      border:1px solid rgba(255,255,255,0.08);margin-bottom:12px;">

      <div style="padding:12px 14px;font-size:var(--fs-xs);color:rgba(255,255,255,0.65);background:rgba(255,255,255,0.03);display:flex;align-items:center;">Menu Music</div>
      <div style="padding:10px 14px;background:rgba(255,255,255,0.03);display:flex;align-items:center;gap:10px;">
        <input type="range" min="0" max="1" step="0.05" value="${Audio.menuMusicVol}"
          oninput="Audio.setMenuMusicVol(+this.value)"
          style="width:110px;accent-color:var(--accent);">
        <button onclick="Audio.setMenuMusicOn(!Audio.menuMusicOn);buildOptionsPanel('${containerId}')"
          style="font-family:'Orbitron',monospace;font-size:var(--fs-xs);padding:4px 12px;
            background:${Audio.menuMusicOn?'rgba(0,212,255,0.15)':'rgba(255,255,255,0.05)'};
            border:1px solid ${Audio.menuMusicOn?'rgba(0,212,255,0.4)':'rgba(255,255,255,0.15)'};
            color:${Audio.menuMusicOn?'var(--accent)':'var(--muted)'};border-radius:4px;cursor:pointer;min-width:52px;">
          ${Audio.menuMusicOn?'ON':'OFF'}
        </button>
      </div>

      <div style="padding:12px 14px;font-size:var(--fs-xs);color:rgba(255,255,255,0.65);background:rgba(0,0,0,0.1);display:flex;align-items:center;">Match Music</div>
      <div style="padding:10px 14px;background:rgba(0,0,0,0.1);display:flex;align-items:center;gap:10px;">
        <input type="range" min="0" max="1" step="0.05" value="${Audio.matchMusicVol}"
          oninput="Audio.setMatchMusicVol(+this.value)"
          style="width:110px;accent-color:var(--accent);">
        <button onclick="Audio.setMatchMusicOn(!Audio.matchMusicOn);buildOptionsPanel('${containerId}')"
          style="font-family:'Orbitron',monospace;font-size:var(--fs-xs);padding:4px 12px;
            background:${Audio.matchMusicOn?'rgba(0,212,255,0.15)':'rgba(255,255,255,0.05)'};
            border:1px solid ${Audio.matchMusicOn?'rgba(0,212,255,0.4)':'rgba(255,255,255,0.15)'};
            color:${Audio.matchMusicOn?'var(--accent)':'var(--muted)'};border-radius:4px;cursor:pointer;min-width:52px;">
          ${Audio.matchMusicOn?'ON':'OFF'}
        </button>
      </div>

      <div style="padding:12px 14px;font-size:var(--fs-xs);color:rgba(255,255,255,0.65);background:rgba(255,255,255,0.03);display:flex;align-items:center;">Sound FX</div>
      <div style="padding:10px 14px;background:rgba(255,255,255,0.03);display:flex;align-items:center;gap:10px;">
        <input type="range" min="0" max="1" step="0.05" value="${Audio.sfxVol}"
          oninput="Audio.setSFXVol(+this.value)"
          style="width:110px;accent-color:var(--accent);">
        <button onclick="Audio.setSFXOn(!Audio.sfxOn);buildOptionsPanel('${containerId}')"
          style="font-family:'Orbitron',monospace;font-size:var(--fs-xs);padding:4px 12px;
            background:${Audio.sfxOn?'rgba(0,212,255,0.15)':'rgba(255,255,255,0.05)'};
            border:1px solid ${Audio.sfxOn?'rgba(0,212,255,0.4)':'rgba(255,255,255,0.15)'};
            color:${Audio.sfxOn?'var(--accent)':'var(--muted)'};border-radius:4px;cursor:pointer;min-width:52px;">
          ${Audio.sfxOn?'ON':'OFF'}
        </button>
      </div>
    </div>

    <div style="font-size:10px;color:rgba(255,255,255,0.2);line-height:1.7;padding:0 2px;">
      Music: "Attention" by kjartan_abel · <span style="opacity:0.6">freesound.org/s/568005/</span> · CC BY 4.0<br>
      Music: "Bosch's Garden" by kjartan_abel · <span style="opacity:0.6">freesound.org/s/647212/</span> · CC BY 4.0
    </div>`;
  }

  // ── DISPLAY TAB ──────────────────────────────────────────────────
  function buildDisplayTab() {
    return `
    <div style="border-radius:8px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;margin-bottom:24px;">

      <div style="padding:16px;background:rgba(255,255,255,0.03);border-bottom:1px solid rgba(255,255,255,0.06);">
        <div style="font-size:var(--fs-xs);color:var(--accent);letter-spacing:1px;margin-bottom:4px;">GRAPHICS</div>
        <div style="font-size:10px;color:var(--muted);">Resolution scaling, particle density, and performance options — coming soon.</div>
      </div>

      <div style="padding:16px;background:rgba(0,0,0,0.15);border-bottom:1px solid rgba(255,255,255,0.06);">
        <div style="font-size:var(--fs-xs);color:var(--accent);letter-spacing:1px;margin-bottom:4px;">ACCESSIBILITY</div>
        <div style="font-size:10px;color:var(--muted);line-height:1.6;">
          Colour-blind modes, high-contrast UI, reduced motion, and other accessibility options are planned for a future update.
        </div>
      </div>

      <div style="padding:16px;background:rgba(255,255,255,0.02);">
        <div style="font-size:var(--fs-xs);color:var(--accent);letter-spacing:1px;margin-bottom:4px;">HUD</div>
        <div style="font-size:10px;color:var(--muted);">HUD layout customisation — coming soon.</div>
      </div>

    </div>

    <div style="font-size:10px;color:rgba(255,255,255,0.15);letter-spacing:1px;">
      Have a suggestion? This section is a work in progress.
    </div>`;
  }

  // ── PATCH NOTES TAB ──────────────────────────────────────────────
  function buildPatchNotesTab() {
    const notes = [
      {
        v: 'v0.3.72', date: '2026-03-17',
        title: 'Singularity Crash Fix',
        changes: [
          { tag: 'FIX', text: 'Singularity no longer crashes the game - the pull physics was reading the radius from the wrong zone when other storms were stacked on top of it' },
        ]
      },
      {
        v: 'v0.3.71', date: '2026-03-17',
        title: 'How To Play Refresh',
        changes: [
          { tag: 'UI', text: 'How To Play fully rewritten - couch multiplayer, storm convergence, MEGA storms, Maelstrom, Singularity, sprint, and pack arrows all documented' },
          { tag: 'UI', text: 'All 11 combo storm types listed with plain-language descriptions of their effects' },
        ]
      },
      {
        v: 'v0.3.70', date: '2026-03-17',
        title: 'Same-Type Storm Merges (MEGA)',
        changes: [
          { tag: 'FEATURE', text: 'Two storms of the same type now merge into a MEGA version - all effects amplified by 50%' },
          { tag: 'VFX', text: 'MEGA zones have a thick pulsing outer ring so you can spot them immediately and distinguish them from regular storms' },
          { tag: 'UI', text: 'Buff label under your character shows MEGA prefix when standing inside a MEGA zone' },
        ]
      },
      {
        v: 'v0.3.69', date: '2026-03-17',
        title: 'Maelstrom & Convergence Tuning',
        changes: [
          { tag: 'BALANCE', text: 'Maelstrom implosion now deals 30% of each character\'s max HP instead of a flat 120 - tanks take a bigger hit, glass cannons take a smaller one' },
          { tag: 'FIX', text: 'Converged storm zones now get a fresh 30-42 second lifetime on merge - previously they inherited whatever was left of the parent zones' },
        ]
      },
      {
        v: 'v0.3.68', date: '2026-03-17',
        title: 'Combo Zone Buff Labels',
        changes: [
          { tag: 'UI', text: 'Standing inside a combo storm now shows your active buffs under your character - same as regular storms' },
          { tag: 'UI', text: 'Stepping into a combo zone triggers an entry float text with the zone name' },
          { tag: 'FIX', text: 'Entry float text no longer crashes when stepping into a converged zone' },
        ]
      },
      {
        v: 'v0.3.67', date: '2026-03-17',
        title: 'Storm Convergence Bug Fixes',
        changes: [
          { tag: 'FIX', text: 'Fixed invalid CSS colour crash in combo zone gradient rendering - the alpha was being appended twice' },
          { tag: 'FIX', text: 'Fixed crash when weather particles tried to read particleColor from a converged zone type not in WEATHER_TYPES' },
          { tag: 'FIX', text: 'Fixed crash when getWeatherAt tried to read the label from a converged zone - now correctly reads from comboDef' },
          { tag: 'FIX', text: 'Added safety guard in normal zone rendering to skip any zone whose type is not in WEATHER_TYPES' },
        ]
      },
      {
        v: 'v0.3.66', date: '2026-03-17',
        title: 'Multiplayer Layout + Storm Merge Fix',
        changes: [
          { tag: 'FIX', text: 'Couch multiplayer now always launches in controller layout - previously it could start in keyboard mode if no gamepad connected during menus' },
          { tag: 'FIX', text: 'Storm convergence now actually merges overlapping zones - the overlap threshold formula was wrong and zones were just passing through each other' },
        ]
      },
      {
        v: 'v0.3.63', date: '2026-03-17',
        title: 'Storm Convergence',
        changes: [
          { tag: 'FEATURE', text: 'Two storms that deeply overlap now merge into a single more powerful combo zone with a fresh timer' },
          { tag: 'FEATURE', text: '10 two-storm combo types: Plasma Storm, Firestorm, Flashpoint, Supercell, Whiteout, Arctic Gale, Dust Devil, Magma Surge, Permafrost, Seismic Charge' },
          { tag: 'FEATURE', text: 'Black Hole merging with any storm creates a Singularity - extreme pull, barely able to move inside' },
          { tag: 'FEATURE', text: 'Three storms overlapping at once creates the Maelstrom - damage doubled, kills reset cooldowns, lasts 15 seconds then implodes' },
          { tag: 'VFX', text: 'Converged zones render with spinning double rings, a colour-coded label, and a countdown timer for the Maelstrom' },
        ]
      },
      {
        v: 'v0.3.62', date: '2026-03-17',
        title: 'Smarter Bot Warp Routing + Unlimited Match Options',
        changes: [
          { tag: 'AI', text: 'Bots no longer sprint toward a warp gate immediately after using one - they fight first and plan their next route properly' },
          { tag: 'AI', text: 'Bots fleeing through a gate now check if they can actually reach it before the enemy cuts them off' },
          { tag: 'AI', text: 'Bots stop evaluating warp shortcuts while their warp is on cooldown - no wasted movement toward walls they cannot pass through' },
          { tag: 'FEATURE', text: 'New match option: Unlimited Kills - the kill limit never triggers, play until time runs out' },
          { tag: 'FEATURE', text: 'New match option: Unlimited Time - no timer, only kills end the match. Combine both for a freeplay sandbox' },
        ]
      },
      {
        v: 'v0.3.61', date: '2026-03-17',
        title: 'Couch Multiplayer Camera Zoom',
        changes: [
          { tag: 'FIX', text: 'The camera now actually zooms out when two players move apart - this was broken since multiplayer launched' },
          { tag: 'FEATURE', text: 'Camera smoothly zooms out to keep both players on screen, then zooms back in when they close the gap' },
          { tag: 'FIX', text: 'Off-screen enemy arrows stay correctly positioned on the viewport edge when zoomed out' },
        ]
      },
      {
        v: 'v0.3.60', date: '2026-03-17',
        title: 'Low Resource Indicators',
        changes: [
          { tag: 'FEATURE', text: 'A red arrow appears around your character and points toward the nearest health pack when your HP drops below 20%' },
          { tag: 'FEATURE', text: 'A blue arrow appears and points toward the nearest mana pack when your mana drops below 20%' },
          { tag: 'VFX', text: 'Arrows pulse faster the more critical your situation - a gentle nudge when low, urgent flash when nearly out' },
        ]
      },
      {
        v: 'v0.3.58', date: '2026-03-17',
        title: 'Multiplayer End Screen',
        changes: [
          { tag: 'UI', text: 'Win screen now shows who actually won - "P1 WINS!" in gold or "P2 WINS!" in cyan instead of a generic Victory message' },
          { tag: 'UI', text: 'If a bot wins, the screen shows that hero name and colour instead' },
          { tag: 'UI', text: 'The scoreboard labels each human player as P1 or P2 in their colour - no more everyone being called YOU' },
          { tag: 'UI', text: 'The individual stat boxes are hidden in multiplayer - the full scoreboard below covers everyone' },
        ]
      },
      {
        v: 'v0.3.57', date: '2026-03-17',
        title: 'Both Players Can Pause',
        changes: [
          { tag: 'FEATURE', text: 'Either player can pause the match with their Start button - previously only P1 could pause' },
          { tag: 'UI', text: 'The pause screen shows who paused - "P1 PAUSED" in gold or "P2 PAUSED" in cyan' },
        ]
      },
      {
        v: 'v0.3.53', date: '2026-03-17',
        title: 'Multiplayer Target Display',
        changes: [
          { tag: 'FEATURE', text: 'In couch multiplayer, each player gets their own target name tag - P1 bottom-left in gold, P2 bottom-right in cyan' },
          { tag: 'FEATURE', text: 'Solo play keeps the original centred target frame - nothing changed there' },
          { tag: 'UI', text: 'Target tags show only the enemy name - health bars and ability buttons removed, that info is visible on the battlefield' },
        ]
      },
      {
        v: 'v0.3.52', date: '2026-03-17',
        title: 'Spectator Mode Overhaul',
        changes: [
          { tag: 'FEATURE', text: 'Watching a bot match now shows a proper spectator panel with the watched hero name, HP/mana bars, and ability cooldowns' },
          { tag: 'FEATURE', text: 'Press Tab or L3 to cycle through all characters and follow a different one' },
          { tag: 'FEATURE', text: 'Camera smoothly follows the watched character and automatically switches to another alive hero if they die' },
          { tag: 'UI', text: 'Controller buttons are hidden during spectating - the spectator panel takes their place' },
        ]
      },
      {
        v: 'v0.3.51', date: '2026-03-16',
        title: 'AI Improvements for Multiplayer',
        changes: [
          { tag: 'AI', text: 'SLAM now hits every enemy caught in the blast radius - it was previously only hitting one target despite being an area attack' },
          { tag: 'AI', text: 'Hard bots now notice when multiple enemies are grouped up and use SLAM to hit them all at once' },
          { tag: 'AI', text: 'Fleeing bots now move away from the group as a whole, not just the nearest enemy - stops them running toward a second attacker' },
          { tag: 'AI', text: 'Bots picking a safe corner to retreat to now find the quadrant farthest from the closest threat, not the one with the best average distance' },
        ]
      },
      {
        v: 'v0.3.50', date: '2026-03-16',
        title: 'Couch Multiplayer - 2 Players',
        changes: [
          { tag: 'FEATURE', text: 'Two human players can now play on the same screen, each with their own controller' },
          { tag: 'FEATURE', text: 'Hero select works like Smash Bros - each player moves their own coloured cursor around the grid independently, confirm with A and cancel with B' },
          { tag: 'FEATURE', text: 'P1 is gold, P2 is cyan - their colours appear on their cursor, character label, controller overlay, and target tag' },
          { tag: 'FEATURE', text: 'Small P1/P2 labels appear above each human character on the battlefield so you always know which one is yours' },
          { tag: 'FEATURE', text: 'The game detects your input automatically - plug in a controller and it switches to the gamepad layout; use a keyboard and it shows key labels' },
          { tag: 'FIX', text: 'Controller button overlay now positions correctly with no stray joystick element pushing everything out of place' },
        ]
      },
      {
        v: 'v0.3.29', date: '2026-03-16',
        title: 'Multiplayer Input Fixes',
        changes: [
          { tag: 'BUGFIX', text: 'P1 movement was broken after the multiplayer update - keyboard, touch stick, and first gamepad all control P1 correctly again' },
          { tag: 'BUGFIX', text: 'Targeting was broken in multiplayer - cycling your target and locking on now correctly includes other human players' },
          { tag: 'BUGFIX', text: 'Target cycle moved from the Select button to L3 (left stick click) - Select is reserved for the scoreboard' },
        ]
      },
      {
        v: 'v0.3.26', date: '2026-03-16',
        title: 'Black Hole Rework',
        changes: [
          { tag: 'GAMEPLAY', text: 'Sprinting now makes you completely immune to the black hole pull - walk straight through if you time your sprint' },
          { tag: 'GAMEPLAY', text: 'The pull is now weakest at the edges and strongest at dead centre - you drift in slowly rather than getting yanked suddenly' },
          { tag: 'GAMEPLAY', text: 'Movement speed reduction tops out at 40% at the very centre - you can still walk out with sustained effort' },
          { tag: 'BUGFIX', text: 'Rock Buster impact text now appears at the obstacle, not at the player who fired the shot' },
        ]
      },
      {
        v: 'v0.3.24', date: '2026-03-16',
        title: 'Bug Fixes + Balance Pass',
        changes: [
          { tag: 'BUGFIX', text: 'GALE - Tailwind Burst was silently being cancelled before it could fire. Now works as intended' },
          { tag: 'BUGFIX', text: 'MYST - Arcane Echo was awarding multiple cooldown refunds on multi-kill casts. Now correctly grants one refund per cast' },
          { tag: 'BUGFIX', text: 'TIDE - Tsunami wave timing was inconsistent at different frame rates. Now fires accurately every time' },
          { tag: 'BUGFIX', text: 'STONE - Aftershock slow zone was sometimes permanently slowing characters after they left the area' },
          { tag: 'BALANCE', text: 'FLORA nerfed - was winning over 95% of 1v1 matches. Lifesteal and ability power reduced' },
          { tag: 'BALANCE', text: 'STONE and FORGE both nerfed - damage and defence numbers brought in line with the rest of the roster' },
          { tag: 'BALANCE', text: 'GALE, VOID, EMBER, FROST, and MYST all received stat buffs to bring them up' },
        ]
      },
      {
        v: 'v0.3.23', date: '2026-03-16',
        title: 'Hero Passive Abilities - Full Roster',
        changes: [
          { tag: 'GAMEPLAY', text: 'STONE - Aftershock: landing SLAM cracks the ground, leaving a zone that slows anyone who walks through it' },
          { tag: 'GAMEPLAY', text: 'GALE - Tailwind: sprinting charges up your next ability to fire faster and travel further' },
          { tag: 'GAMEPLAY', text: 'VOID - Phantom Step: stepping through a warp gate briefly makes you intangible - the next hit passes straight through you' },
          { tag: 'GAMEPLAY', text: 'MYST - Arcane Echo: getting a kill with an ability halves that ability cooldown - chain kills to keep your toolkit fresh' },
          { tag: 'GAMEPLAY', text: 'VOLT - Static Charge: each auto-attack builds a charge stack (max 3). Your next ability spends them all for bonus damage' },
          { tag: 'GAMEPLAY', text: 'FORGE - Molten Core: while your defensive ability is active, running into enemies deals heavy bonus damage' },
          { tag: 'GAMEPLAY', text: 'EMBER - Inferno leaves a burning patch on the ground where it lands, damaging anyone who stands in it' },
          { tag: 'GAMEPLAY', text: 'FROST - Shatter now triggers on slowed enemies too, not just frozen ones - set up with Ice Shard then punish' },
          { tag: 'GAMEPLAY', text: 'TIDE - Whirlpool persists on the ground after casting, continuing to pull and damage enemies for several seconds' },
          { tag: 'GAMEPLAY', text: 'FLORA - Root Tether: while an enemy is rooted nearby you passively heal, rewarding staying in close range' },
        ]
      },
      {
        v: 'v0.3.22', date: '2026-03-16',
        title: 'Bot Special Abilities Overhaul',
        changes: [
          { tag: 'AI', text: 'Easy bots no longer use SLAM, SURGE, or FOCUS - they stick to basics, matching their passive playstyle' },
          { tag: 'AI', text: 'Hard bots save SLAM for when the target is stunned, low HP, or right in their face' },
          { tag: 'AI', text: 'Hard bots use SURGE to dash away from danger when retreating, not just to close the gap when attacking' },
          { tag: 'AI', text: 'Hard bots prefer to fire FOCUS when the target is CCd - maximising the guaranteed hit' },
        ]
      },
      {
        v: 'v0.3.20', date: '2026-03-16',
        title: 'Auto-Attack Improvements + Kill Feed Cleanup',
        changes: [
          { tag: 'GAMEPLAY', text: 'Auto-attacks now fire at the nearest enemy within range if your locked target has moved out of reach - no more dead air' },
          { tag: 'VFX', text: 'Kill streaks, ELIMINATED!, and screen shake now only show for actions involving the human player - bot fights happen silently in the background' },
        ]
      },
      {
        v: 'v0.3.17', date: '2026-03-16',
        title: 'Bots React to Weather Zones',
        changes: [
          { tag: 'AI', text: 'Bots now notice weather zones and decide whether to seek them out or avoid them based on their hero and current situation' },
          { tag: 'AI', text: 'Low HP bots gravitate toward DOWNPOUR to heal. All bots avoid the black hole zone. Bots avoid zones that counter their combat style' },
          { tag: 'AI', text: 'Hard bots factor in travel cost before committing to a zone - they will not cross the whole arena for a minor benefit' },
          { tag: 'AI', text: 'Melee bots seek SANDSTORM to force close-range fights. Ranged bots avoid it for the same reason' },
        ]
      },
      {
        v: 'v0.3.16', date: '2026-03-16',
        title: 'Bot Retreat Behaviour Overhaul',
        changes: [
          { tag: 'AI', text: 'Bots no longer run in a straight line when retreating - they circle laterally and maintain distance, making them much harder to chase down' },
          { tag: 'AI', text: 'Hard bots at critically low HP now evaluate all four corners of the arena and flee to whichever is safest' },
          { tag: 'AI', text: 'Retreating bots are pushed back toward the centre when they get too close to a wall - they no longer get cornered' },
        ]
      },
      {
        v: 'v0.3.15', date: '2026-03-16',
        title: 'Bots Use Rock Buster Tactically',
        changes: [
          { tag: 'AI', text: 'Normal bots now shoot obstacles blocking their path to you, or blocking your path to them while they flee' },
          { tag: 'AI', text: 'Hard bots score every nearby obstacle and only fire when it genuinely improves their position - they save it for moments that matter' },
          { tag: 'AI', text: 'Easy bots never use Rock Buster - rocks are just scenery to them' },
        ]
      },
      {
        v: 'v0.3.13', date: '2026-03-16',
        title: 'Patch Notes + Controller Scrolling Fixes',
        changes: [
          { tag: 'UI', text: 'Patch note entries are now collapsible - the latest one opens automatically, older ones are collapsed to save space' },
          { tag: 'FIX', text: 'Scrolling with a controller now works correctly on the Hero Roster, How To Play, and other long screens' },
        ]
      },
      {
        v: 'v0.3.9', date: '2026-03-16',
        title: 'Kill Streaks + Sprint CC Break',
        changes: [
          { tag: 'VFX', text: 'Kill streaks now have distinct callouts - DOUBLE KILL, TRIPLE KILL!, and UNSTOPPABLE!! with increasing drama. First blood calls out the very first kill of the match' },
          { tag: 'VFX', text: 'Damage numbers fall downward below the target, kill and status text rises upward above - no more visual clutter' },
          { tag: 'GAMEPLAY', text: 'Sprinting breaks Stun, Slow, and Silence - you can burst out of minor crowd control. Freeze is immune to this and still pins you completely' },
        ]
      },
      {
        v: 'v0.3.8', date: '2026-03-16',
        title: 'Bot Watch Mode',
        changes: [
          { tag: 'FEATURE', text: 'Set your own slot to CPU in the lobby to sit back and watch a full bot match play out' },
        ]
      },
      {
        v: 'v0.3.5', date: '2026-03-15',
        title: 'Full Rebinds + HUD Layouts',
        changes: [
          { tag: 'FEATURE', text: 'Every control can now be rebound - including Cycle Target and Scoreboard which were previously locked' },
          { tag: 'UI', text: 'Three distinct control layouts: Touch shows circular joystick buttons, Keyboard shows key chip labels, Controller shows the gamepad diamond. All switch automatically' },
          { tag: 'UI', text: 'How To Play rebuilt as a proper two-column table showing keyboard controls on the left and controller controls on the right' },
          { tag: 'GAMEPLAY', text: 'Weather zone buff labels now show actual numbers scaled by how deep you are in the zone, not just the zone type' },
        ]
      },
      {
        v: 'v0.2.0', date: '2026-03-14',
        title: 'Obstacles, Special Abilities + Rock Buster',
        changes: [
          { tag: 'FEATURE', text: 'Floating obstacles added - they drift, orbit, or bounce around the arena. Destroy them to clear the battlefield or create new angles' },
          { tag: 'FEATURE', text: 'Rock Buster added (G / B button) - fires a shot at the nearest destructible obstacle. Useful for clearing paths or denying enemy escapes' },
          { tag: 'FEATURE', text: 'Special ability added (F / Y button) - SLAM for melee characters (AOE stun burst), SURGE for hybrids (dash through enemies), FOCUS for ranged (fast guaranteed skillshot)' },
          { tag: 'FEATURE', text: 'Sudden death added - if time runs out with no winner, the match continues until the next kill lands' },
          { tag: 'FEATURE', text: 'Mid-match scoreboard added - hold U or Select at any time to see current kills, deaths, and KDA for all players' },
          { tag: 'AI', text: 'Bots now understand warp gates at higher difficulties - Normal bots react to nearby gates, Hard bots plan warp routes to flank or escape' },
        ]
      },
      {
        v: 'v0.1.0', date: '2026-03-13',
        title: 'First Release',
        changes: [
          { tag: 'FEATURE', text: '10 playable heroes spanning Melee, Ranged, and Hybrid combat styles' },
          { tag: 'FEATURE', text: 'Dynamic weather zones - areas of the arena that buff certain hero types, shift ability ranges, or alter movement' },
          { tag: 'FEATURE', text: 'Warp gates in the arena walls - pass through to teleport to the opposite side, on a short cooldown' },
          { tag: 'FEATURE', text: 'Full controller, touch, and keyboard support with rebindable controls' },
          { tag: 'FEATURE', text: 'Lobby with team selection, slot management, and difficulty settings' },
          { tag: 'FEATURE', text: 'Off-screen indicators showing where enemies are when they leave the viewport' },
          { tag: 'FEATURE', text: 'Assist tracking - deal damage to an enemy before a teammate kills them and you get credit' },
        ]
      },
    ];

    const TAG_COLORS = {
      'FEATURE':  { bg: 'rgba(0,212,255,0.12)',  border: 'rgba(0,212,255,0.35)',  text: '#00d4ff' },
      'GAMEPLAY': { bg: 'rgba(255,160,0,0.10)',   border: 'rgba(255,160,0,0.35)',  text: '#ffa000' },
      'AI':       { bg: 'rgba(160,80,255,0.10)',  border: 'rgba(160,80,255,0.35)', text: '#a050ff' },
      'VFX':      { bg: 'rgba(255,80,160,0.10)',  border: 'rgba(255,80,160,0.35)', text: '#ff50a0' },
      'UI':       { bg: 'rgba(80,200,120,0.10)',  border: 'rgba(80,200,120,0.35)', text: '#50c878' },
      'CONTROLS': { bg: 'rgba(80,200,120,0.10)',  border: 'rgba(80,200,120,0.35)', text: '#50c878' },
      'FIX':      { bg: 'rgba(255,80,80,0.10)',   border: 'rgba(255,80,80,0.30)',  text: '#ff8080' },
      'BUILD':    { bg: 'rgba(180,180,180,0.08)', border: 'rgba(180,180,180,0.2)', text: '#aaaaaa' },
    };

    const renderTag = (tag) => {
      const c = TAG_COLORS[tag] || TAG_COLORS['BUILD'];
      return `<span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:9px;
        font-family:'Orbitron',monospace;font-weight:700;letter-spacing:0.5px;margin-right:6px;
        background:${c.bg};border:1px solid ${c.border};color:${c.text};">${tag}</span>`;
    };

    return `
    <div style="font-size:11px;color:var(--muted);letter-spacing:1px;margin-bottom:16px;">
      FULL CHANGELOG — ALL CHANGES SINCE LAUNCH
    </div>
    <style>
      .pn-entry { border:1px solid rgba(255,255,255,0.07); border-radius:6px; margin-bottom:8px; overflow:hidden; }
      .pn-entry summary {
        display:flex; align-items:baseline; gap:10px; padding:10px 14px;
        cursor:pointer; user-select:none; list-style:none;
        background:rgba(255,255,255,0.03);
        transition:background 0.15s;
      }
      .pn-entry summary::-webkit-details-marker { display:none; }
      .pn-entry summary:hover { background:rgba(255,255,255,0.06); }
      .pn-entry[open] summary { border-bottom:1px solid rgba(255,255,255,0.07); }
      .pn-chevron { margin-left:auto; font-size:10px; color:rgba(255,255,255,0.3); transition:transform 0.15s; }
      .pn-entry[open] .pn-chevron { transform:rotate(180deg); }
      .pn-body { padding:10px 14px; display:flex; flex-direction:column; gap:6px; }
    </style>
    ${notes.map((patch, pi) => `
      <details class="pn-entry" ${pi === 0 ? 'open' : ''}>
        <summary>
          <span style="font-family:'Orbitron',monospace;font-size:13px;font-weight:700;
            color:var(--accent);">${patch.v}</span>
          <span style="font-family:'Orbitron',monospace;font-size:11px;font-weight:700;
            color:rgba(255,255,255,0.85);letter-spacing:1px;">${patch.title}</span>
          <span style="font-size:10px;color:rgba(255,255,255,0.25);font-family:monospace;">${patch.date}</span>
          <span class="pn-chevron">▼</span>
        </summary>
        <div class="pn-body">
          ${patch.changes.map(c => `
            <div style="display:flex;align-items:flex-start;font-size:var(--fs-xs);
              color:rgba(255,255,255,0.70);line-height:1.5;">
              ${renderTag(c.tag)}
              <span>${c.text}</span>
            </div>
          `).join('')}
        </div>
      </details>
    `).join('')}`;
  }

  // ── Assemble ────────────────────────────────────────────────────
  const tabContent = optionsActiveTab === 'controls'   ? buildControlsTab()
                   : optionsActiveTab === 'audio'      ? buildAudioTab()
                   : optionsActiveTab === 'patchnotes' ? buildPatchNotesTab()
                   : buildDisplayTab();

  el.innerHTML = `
    <div style="font-family:'Orbitron',monospace;color:var(--text);padding-bottom:32px;">
      ${tabBarHtml}
      <div style="padding:0 2px;">
        ${tabContent}
      </div>
    </div>`;
}


function startCtrlRebind(action, slot, containerId) {
  const rebindId = action + ':' + slot;
  if (rebindingCtrlAction === rebindId) {
    // Already waiting — just cancel
    rebindingCtrlAction = null;
    buildOptionsPanel(containerId);
    return;
  }
  rebindingCtrlAction = rebindId;
  buildOptionsPanel(containerId);

  const pollStart = performance.now();
  let   settled   = false;
  let   lastSnap  = null;

  function waitForPress() {
    if (rebindingCtrlAction !== rebindId) return;

    if (performance.now() - pollStart > 8000) {
      rebindingCtrlAction = null;
      buildOptionsPanel(containerId);
      return;
    }

    let gp = null;
    try {
      const gps = Array.from(navigator.getGamepads ? navigator.getGamepads() : []);
      gp = _pickBestGamepad(gps);
    } catch(e) {}

    if (!gp) { requestAnimationFrame(waitForPress); return; }

    const curSnap = gp.buttons.map(b => b?.pressed ?? false);

    if (!settled) {
      if (curSnap.every(v => !v)) settled = true;
      lastSnap = curSnap;
      requestAnimationFrame(waitForPress);
      return;
    }

    if (lastSnap) {
      for (let i = 0; i < curSnap.length; i++) {
        if (curSnap[i] && !lastSnap[i]) {
          // Clear conflicts: remove this button from other actions
          Object.keys(controllerBindings).forEach(k => {
            if (Array.isArray(controllerBindings[k])) {
              controllerBindings[k] = controllerBindings[k].filter(b => b !== i);
            }
          });
          // Set into correct slot
          const btns = controllerBindings[action] || [];
          if (slot === 0) {
            btns[0] = i;
          } else {
            if (btns.length === 0) btns.push(-1);
            btns[1] = i;
          }
          controllerBindings[action] = btns.filter(b => b >= 0);
          saveCtrlBindings();
          rebindingCtrlAction = null;
          buildOptionsPanel(containerId);
          return;
        }
      }
    }

    lastSnap = curSnap;
    requestAnimationFrame(waitForPress);
  }

  requestAnimationFrame(waitForPress);
}

function startRebind(action, slot, containerId) {
  const rebindId = action + ':' + slot;
  if (rebindingAction === rebindId) {
    // Already waiting — cancel
    rebindingAction = null;
    buildOptionsPanel(containerId);
    return;
  }
  rebindingAction = rebindId;
  buildOptionsPanel(containerId);
  function onKey(e) {
    e.preventDefault();
    if (e.code === 'Escape') { rebindingAction = null; buildOptionsPanel(containerId); document.removeEventListener('keydown', onKey); return; }
    // Remove this key from all other bindings to prevent conflicts
    Object.keys(keybindings).forEach(k => { keybindings[k] = (keybindings[k] || []).filter(c => c !== e.code); });
    // Set the key into the correct slot
    const keys = keybindings[action] || [];
    if (slot === 0) {
      keys[0] = e.code;
    } else {
      if (keys.length === 0) keys[0] = null;
      keys[1] = e.code;
    }
    keybindings[action] = keys.filter(k => k != null);
    saveBindings(); rebindingAction = null;
    buildOptionsPanel(containerId); document.removeEventListener('keydown', onKey);
  }
  document.addEventListener('keydown', onKey);
}

function clearSecondaryBinding(action, containerId) {
  const keys = keybindings[action] || [];
  keybindings[action] = keys.length > 0 ? [keys[0]] : [];
  saveBindings();
  buildOptionsPanel(containerId);
}

function clearSecondaryCtrlBinding(action, containerId) {
  const btns = controllerBindings[action] || [];
  controllerBindings[action] = btns.length > 0 ? [btns[0]] : [];
  saveCtrlBindings();
  buildOptionsPanel(containerId);
}

function showScreen(id) {
  // If navigating away from a game to a non-game screen, stop the engine
  if (id === 'menu' || id === 'hero-select' || id === 'hero-select-solo') {
    cleanupGame();
    if (id !== 'hero-select') HeroCursors.stop();
  }
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if (id === 'menu') Audio.sfx.uiBack(); else Audio.sfx.uiClick();
  // Refresh any data-bind labels on the newly visible screen
  refreshDynamicBindLabels();
  // Keep UINav in sync so controller scrolling and navigation target the right screen
  if (typeof UINav !== 'undefined') setTimeout(() => UINav.activate(id), 30);

  // BGM routing
  if (id === 'game-over' || id === 'win-screen') {
    Audio.stopBGM();
  } else if (id === 'menu') {
    Audio.stopBGM();
    setTimeout(() => Audio.playMenuBGM(), 600);
  } else if (id === 'hero-select' || id === 'how-to-play' || id === 'options') {
    Audio.playMenuBGM();
  } else if (id === 'game') {
    Audio.playMatchBGM();
  }
  
  if (id === 'hero-select') {
    initHeroDetailCollapse();
    clearTimeout(window._autoLockTimer);
    lobbyPhase = 'pick';
    lobbySlots = [
      { type:'p1',  hero:null, locked:false, teamId:0 },
      { type:'cpu', hero:null, locked:false, teamId:1 },
    ];
    selectedHero = HEROES[0];
    activeSlotIdx = 0;
    buildLobby();
    buildSettingsPanel();
    buildHeroGrid('hero-grid','hero-detail');
    // Start Smash-style cursors after grid is built (delayed so DOM is ready)
    setTimeout(() => HeroCursors.start(), 100);
  }
  if (id === 'hero-select-solo') buildHeroGrid('hero-grid-solo','hero-detail-solo');
  if (id === 'menu') spawnMenuParticles();
  if (id === 'options') buildOptionsPanel('options-inner');
  if (id === 'options-ingame') buildOptionsPanel('options-ingame-inner');
}

// ========== MENU PARTICLES ==========
function spawnMenuParticles() {
  const bg = document.getElementById('menu-bg');
  if (!bg) return;
  bg.innerHTML = '';
  const colors = ['#ff4e1a','#00aaff','#7ec850','#8844cc','#ff44aa','#ffee00','#88ddff'];
  for (let i=0;i<20;i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const size = 3 + Math.random()*6;
    p.style.cssText = `width:${size}px;height:${size}px;left:${Math.random()*100}%;background:${colors[i%colors.length]};
      animation-duration:${4+Math.random()*6}s;animation-delay:${Math.random()*5}s;`;
    bg.appendChild(p);
  }
}

// ========== HERO GRID ==========
// ── Hero detail panel collapse (hero-select screen) ──
// On short screens (< 700px tall) the stat block is collapsed by default.
// The user can tap the handle to expand / collapse it.
function toggleHeroDetailPanel() {
  const body   = document.getElementById('hs-detail-body');
  const handle = document.getElementById('hs-detail-handle-text');
  if (!body) return;
  const collapsed = body.classList.toggle('collapsed');
  if (handle) handle.textContent = collapsed ? '▼ ELEMENT INFO' : '▲ ELEMENT INFO';
}

function initHeroDetailCollapse() {
  const body   = document.getElementById('hs-detail-body');
  const handle = document.getElementById('hs-detail-handle-text');
  if (!body) return;
  // Collapse by default on short screens; the CSS media query keeps it open on tall ones
  if (window.innerHeight < 700) {
    body.classList.add('collapsed');
    if (handle) handle.textContent = '▼ ELEMENT INFO';
  } else {
    body.classList.remove('collapsed');
    if (handle) handle.textContent = '▲ ELEMENT INFO';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SMASH-STYLE MULTI-PLAYER HERO SELECT CURSORS
// Each human player gets an independent cursor driven by their gamepad.
// Cursors show as coloured labels floating over the hero grid.
// Solo play (1 human) uses existing mouse/touch — cursors are hidden.
// ═══════════════════════════════════════════════════════════════════════════

const HeroCursors = (() => {
  // One cursor per human player slot (up to 4)
  // { gpIdx, slotIdx, heroIdx, confirmed, heldDir, heldTimer, prevBtns }
  let cursors = [];
  let heroCards = []; // flat ordered list of .hero-card elements
  let rowMap = []; // [[cardIdx, ...], ...] matching visual rows
  let active = false;
  let rafId = null;

  const NAV_INITIAL = 350;
  const NAV_RATE    = 130;

  function getCards() {
    const grid = document.getElementById('hero-grid');
    if (!grid) return [];
    return Array.from(grid.querySelectorAll('.hero-card')).filter(el => el.offsetParent !== null);
  }

  function buildRowMap(cards) {
    if (!cards.length) return [];
    const rows = [];
    let curRow = [];
    let lastTop = null;
    cards.forEach((card, i) => {
      const top = Math.round(card.getBoundingClientRect().top);
      if (lastTop === null || Math.abs(top - lastTop) < 10) {
        curRow.push(i);
      } else {
        rows.push(curRow);
        curRow = [i];
      }
      lastTop = top;
    });
    if (curRow.length) rows.push(curRow);
    return rows;
  }

  function moveIdx(heroIdx, dir, cards, rMap) {
    if (!rMap.length) return heroIdx;
    let curRow = -1, curCol = -1;
    for (let r = 0; r < rMap.length; r++) {
      const c = rMap[r].indexOf(heroIdx);
      if (c !== -1) { curRow = r; curCol = c; break; }
    }
    if (curRow === -1) return heroIdx;
    let next = heroIdx;
    if (dir === 'up'    && curRow > 0) next = rMap[curRow-1][Math.min(curCol, rMap[curRow-1].length-1)];
    if (dir === 'down'  && curRow < rMap.length-1) next = rMap[curRow+1][Math.min(curCol, rMap[curRow+1].length-1)];
    if (dir === 'right' && curCol < rMap[curRow].length-1) next = rMap[curRow][curCol+1];
    if (dir === 'left'  && curCol > 0) next = rMap[curRow][curCol-1];
    return Math.max(0, Math.min(next, cards.length-1));
  }

  function renderCursors() {
    // Remove old cursor elements
    document.querySelectorAll('.hero-cursor').forEach(el => el.remove());
    if (!active || cursors.length === 0) return;

    cursors.forEach(cur => {
      const card = heroCards[cur.heroIdx];
      if (!card) return;
      const rect = card.getBoundingClientRect();
      const gridEl = document.getElementById('hero-grid');
      if (!gridEl) return;
      const gridRect = gridEl.getBoundingClientRect();

      const el = document.createElement('div');
      el.className = 'hero-cursor';
      const color = PLAYER_COLORS[cur.gpIdx] ?? '#ffee44';
      el.style.cssText = `
        position:absolute;
        left:${rect.left - gridRect.left}px;
        top:${rect.top - gridRect.top}px;
        width:${rect.width}px;
        height:${rect.height}px;
        border:3px solid ${color};
        border-radius:8px;
        box-shadow:0 0 14px ${color}88, inset 0 0 8px ${color}22;
        pointer-events:none;
        z-index:10;
        box-sizing:border-box;
        transition:left 0.08s ease, top 0.08s ease;
      `;

      // Label badge
      const badge = document.createElement('div');
      badge.style.cssText = `
        position:absolute;
        top:-22px; left:50%; transform:translateX(-50%);
        background:${color};
        color:#000;
        font-family:'Orbitron',monospace;
        font-size:10px;
        font-weight:900;
        letter-spacing:1px;
        padding:2px 8px;
        border-radius:4px;
        white-space:nowrap;
      `;
      badge.textContent = cur.confirmed ? `P${cur.gpIdx+1} ✓` : `P${cur.gpIdx+1}`;
      el.appendChild(badge);

      // Confirmed overlay
      if (cur.confirmed) {
        el.style.background = `${color}22`;
        const check = document.createElement('div');
        check.style.cssText = `
          position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
          font-size:28px; color:${color};
        `;
        check.textContent = '✓';
        el.appendChild(check);
      }

      gridEl.style.position = 'relative';
      gridEl.appendChild(el);
    });
  }

  function tick() {
    if (!active) return;
    const now = performance.now();
    let dirty = false;

    try {
      const gamepads = Array.from(navigator.getGamepads ? navigator.getGamepads() : []);
      const validGPs = gamepads.filter(g => g && g.connected && !SKIP_DEVICE_KEYWORDS.test(g.id));

      // Refresh card list each tick (grid may rebuild)
      const freshCards = getCards();
      if (freshCards.length !== heroCards.length) {
        heroCards = freshCards;
        rowMap = buildRowMap(heroCards);
        dirty = true;
      }

      cursors.forEach(cur => {
        const gp = validGPs[cur.gpIdx];
        if (!gp) return;
        const prev = cur.prevBtns;
        const M = _getButtonMap(gp);
        const pressed = (b) => gp.buttons[b]?.pressed ?? false;
        const justPressed = (b) => pressed(b) && !(prev[b] ?? false);

        // Confirm (A button)
        const confirmBtn = Array.isArray(controllerBindings.e) ? (controllerBindings.e[0] ?? M.a) : M.a;
        if (!cur.confirmed && justPressed(confirmBtn)) {
          const card = heroCards[cur.heroIdx];
          if (card) {
            // Set this player's slot as active and click
            const slotIdx = lobbySlots.findIndex((s,i) => {
              const humanSlots = lobbySlots.filter(ls => ls.type !== 'cpu');
              return humanSlots[cur.gpIdx] === s;
            });
            if (slotIdx >= 0) activeSlotIdx = slotIdx;
            card.click();
            cur.confirmed = true;
            dirty = true;
          }
        }

        // Unconfirm (B button) — let player change their mind
        const backBtn = Array.isArray(controllerBindings.rockbuster) ? (controllerBindings.rockbuster[0] ?? M.b) : M.b;
        if (cur.confirmed && justPressed(backBtn)) {
          cur.confirmed = false;
          // Clear this player's hero selection
          const humanSlots = lobbySlots.filter(s => s.type !== 'cpu');
          const slot = humanSlots[cur.gpIdx];
          if (slot) { slot.hero = null; buildLobby(); }
          dirty = true;
        }

        // D-pad navigation (only if not confirmed)
        if (!cur.confirmed) {
          const dirMap = [
            { dir:'up',    btn: M.dup    },
            { dir:'down',  btn: M.ddown  },
            { dir:'left',  btn: M.dleft  },
            { dir:'right', btn: M.dright },
          ];
          let activeDir = null;
          for (const {dir, btn} of dirMap) {
            if (pressed(btn)) { activeDir = dir; break; }
          }
          if (activeDir) {
            if (cur.heldDir !== activeDir) {
              cur.heldDir = activeDir;
              cur.heldTimer = now + NAV_INITIAL;
              const next = moveIdx(cur.heroIdx, activeDir, heroCards, rowMap);
              if (next !== cur.heroIdx) { cur.heroIdx = next; dirty = true; }
            } else if (now >= cur.heldTimer) {
              cur.heldTimer = now + NAV_RATE;
              const next = moveIdx(cur.heroIdx, activeDir, heroCards, rowMap);
              if (next !== cur.heroIdx) { cur.heroIdx = next; dirty = true; }
            }
          } else {
            cur.heldDir = null;
          }
        }

        cur.prevBtns = gp.buttons.map(b => b?.pressed ?? false);
      });
    } catch(e) {}

    if (dirty) renderCursors();
    rafId = requestAnimationFrame(tick);
  }

  function start() {
    const humanSlots = lobbySlots.filter(s => s.type !== 'cpu');
    if (humanSlots.length < 2) { stop(); return; } // solo — no cursors needed

    active = true;
    heroCards = getCards();
    rowMap = buildRowMap(heroCards);

    // Create one cursor per human player
    cursors = humanSlots.map((slot, gpIdx) => ({
      gpIdx,
      heroIdx: gpIdx, // stagger starting positions
      confirmed: !!slot.hero,
      heldDir: null,
      heldTimer: 0,
      prevBtns: [],
    }));

    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tick);
    renderCursors();
  }

  function stop() {
    active = false;
    cursors = [];
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    document.querySelectorAll('.hero-cursor').forEach(el => el.remove());
    // Re-activate UINav for solo controller navigation
    if (typeof UINav !== 'undefined') setTimeout(() => UINav.activate('hero-select'), 120);
  }

  function refresh() {
    // Called when buildHeroGrid runs — update card list and re-render
    if (!active) return;
    heroCards = getCards();
    rowMap = buildRowMap(heroCards);
    // Clamp all cursor indices
    cursors.forEach(cur => {
      cur.heroIdx = Math.max(0, Math.min(cur.heroIdx, heroCards.length - 1));
      // Re-sync confirmed state from lobby
      const humanSlots = lobbySlots.filter(s => s.type !== 'cpu');
      if (humanSlots[cur.gpIdx]?.hero) cur.confirmed = true;
    });
    renderCursors();
  }

  return { start, stop, refresh, isActive: () => active };
})();

function buildHeroGrid(gridId, detailId) {
  const grid = document.getElementById(gridId);
  const detail = document.getElementById(detailId);
  grid.innerHTML = '';

  const CLASS_ORDER = ['melee', 'ranged', 'hybrid'];
  const CLASS_META = {
    melee:  { label: 'MELEE',  icon: '⚔',  color: '#ff6644', desc: 'Close-range brawlers' },
    ranged: { label: 'RANGED', icon: '◎',  color: '#44ccff', desc: 'Long-range specialists' },
    hybrid: { label: 'HYBRID', icon: '⚡',  color: '#ffee44', desc: 'Adaptable fighters' },
  };

  // Track canvas refs alongside heroes for animation
  const canvasRefs = [];

  CLASS_ORDER.forEach(cls => {
    const heroes = HEROES.filter(h => h.combatClass === cls);
    if (!heroes.length) return;

    const meta = CLASS_META[cls];

    // Section header
    const header = document.createElement('div');
    header.className = 'hero-class-header';
    header.innerHTML = `
      <div class="hero-class-line" style="background:${meta.color}22;border-color:${meta.color}44;"></div>
      <div class="hero-class-label" style="color:${meta.color};border-color:${meta.color}44;background:var(--bg);">
        <span class="hero-class-icon">${meta.icon}</span>
        <span>${meta.label}</span>
        <span class="hero-class-desc">${meta.desc}</span>
      </div>
      <div class="hero-class-line" style="background:${meta.color}22;border-color:${meta.color}44;"></div>
    `;
    grid.appendChild(header);

    // Row of cards for this class
    const row = document.createElement('div');
    row.className = 'hero-class-row';
    grid.appendChild(row);

    heroes.forEach(h => {
      const inLobby = document.getElementById('hero-select')&&document.getElementById('hero-select').classList.contains('active')&&lobbySlots.length;
      const activeSlotHero = inLobby ? (lobbySlots[activeSlotIdx]||{}).hero : null;
      const takenByOther = inLobby && lobbySlots.some((s,si)=>s.hero===h && si!==activeSlotIdx);
      const isSelected = inLobby ? h===activeSlotHero : h===selectedHero;

      // Which human players have this hero selected (for cursor badges)
      const playerBadges = inLobby ? lobbySlots
        .map((s,si) => ({s,si}))
        .filter(({s}) => s.type !== 'cpu' && s.hero === h)
        .map(({s,si}) => {
          const pIdx = lobbySlots.filter((ls,li) => ls.type !== 'cpu' && li <= si).length - 1;
          return PLAYER_COLORS[pIdx] ?? '#ffee44';
        }) : [];

      const card = document.createElement('div');
      card.className = 'hero-card' + (isSelected?' selected':'') + (takenByOther?' taken':'');
      card.style.cssText = `opacity:${takenByOther?0.35:1};position:relative;`;

      // Canvas sprite preview
      const cvs = document.createElement('canvas');
      const dpr = window.devicePixelRatio || 1;
      const CVS_CSS = 90;
      cvs.width  = CVS_CSS * dpr;
      cvs.height = CVS_CSS * dpr;
      cvs.style.cssText = `display:block;margin:0 auto 2px;width:${CVS_CSS}px;height:${CVS_CSS}px;`;
      const cctx = cvs.getContext('2d');
      const drawer = SPRITE_DRAWERS[h.id];
      const cr = CVS_CSS * 0.28;
      if (drawer) {
        cctx.clearRect(0, 0, cvs.width, cvs.height);
        cctx.save(); cctx.scale(dpr, dpr);
        drawer(cctx, CVS_CSS/2, CVS_CSS/2+2, cr, Date.now()*0.001, 1);
        cctx.restore();
      }
      canvasRefs.push({ cvs, h });

      const name = document.createElement('div');
      name.className = 'hero-name'; name.style.color = h.color; name.textContent = h.name;

      card.appendChild(cvs); card.appendChild(name);

      // Player cursor badges — coloured dots showing which players have picked this hero
      if (playerBadges.length > 0) {
        const badgeRow = document.createElement('div');
        badgeRow.style.cssText = 'position:absolute;top:4px;right:4px;display:flex;gap:3px;';
        playerBadges.forEach(color => {
          const badge = document.createElement('div');
          badge.style.cssText = `width:9px;height:9px;border-radius:50%;background:${color};box-shadow:0 0 6px ${color};border:1px solid rgba(255,255,255,0.3);`;
          badgeRow.appendChild(badge);
        });
        card.appendChild(badgeRow);
      }

      // Active slot cursor — coloured border flash showing whose turn it is to pick
      if (inLobby && activeSlotIdx < lobbySlots.length && lobbySlots[activeSlotIdx].type !== 'cpu') {
        const activePIdx = lobbySlots.filter((s,li) => s.type !== 'cpu' && li <= activeSlotIdx).length - 1;
        const cursorColor = PLAYER_COLORS[activePIdx] ?? '#ffee44';
        if (isSelected) {
          card.style.borderColor = cursorColor;
          card.style.boxShadow = `0 0 12px ${cursorColor}66`;
        }
      }
      card.onclick = () => {
        if (document.getElementById('hero-select').classList.contains('active') && lobbySlots.length) {
          lobbySetHero(h);
        } else if (gridId === 'hero-grid-solo') {
          openHeroDetailPage(h);
        } else {
          selectedHero = h; buildHeroGrid(gridId, detailId);
        }
      };
      row.appendChild(card);
    });
  });

  // Animate selected hero preview
  const activeSlotHero = (lobbySlots[activeSlotIdx] && lobbySlots[activeSlotIdx].hero) || selectedHero;
  if (activeSlotHero && detail) {
    renderHeroDetail(detail, activeSlotHero);
    // Auto-expand detail panel when a hero is picked on short screens
    const body = document.getElementById('hs-detail-body');
    const handle = document.getElementById('hs-detail-handle-text');
    if (body && body.classList.contains('collapsed')) {
      body.classList.remove('collapsed');
      if (handle) handle.textContent = '▲ ELEMENT INFO';
    }
  }

  // Animate all preview canvases
  clearInterval(window._heroPreviewInterval);
  window._heroPreviewInterval = setInterval(() => {
    canvasRefs.forEach(({ cvs, h }) => {
      const cctx = cvs.getContext('2d');
      const drawer = SPRITE_DRAWERS[h.id];
      const dpr = window.devicePixelRatio || 1;
      const CVS_CSS = 90;
      const cr = CVS_CSS * 0.28;
      if (drawer) {
        cctx.clearRect(0, 0, cvs.width, cvs.height);
        cctx.save(); cctx.scale(dpr, dpr);
        drawer(cctx, CVS_CSS/2, CVS_CSS/2+2, cr, Date.now()*0.001, 1);
        cctx.restore();
      }
    });
  }, 50);

  // Refresh Smash-style cursors after grid rebuilds
  if (gridId === "hero-grid") setTimeout(() => HeroCursors.refresh(), 50);
}

// ── Hero Detail Page (full roster view) ──
function openHeroDetailPage(h) {
  showScreen('hero-detail-page');
  const el = document.getElementById('detail-page-content');
  if (!el || !h || !h.baseStats) return;
  const b = h.baseStats;

  function abilityCardFull(a, idx) {
    const actions  = ['q', 'e', 'r'];
    const fallback = ['Q', 'E', 'R'];
    const isUlt = idx === 2;
    const CC_LABELS = { stun:'STUN', root:'ROOT', slow:'SLOW', silence:'SILENCE', knockback:'KNOCKBACK', pull:'PULL' };
    const CC_COLORS = { stun:'#ffaa33', root:'#88ff44', slow:'#44ccff', silence:'#cc88ff', knockback:'#ff6644', pull:'#00ddff' };
    const tagHtml = (a.tags||[]).map(t=>`<span class="ab-tag ${t}">${t==='ult-tag'?'ULTIMATE':t==='dmg'?'DAMAGE':t==='cc'?'CC':t==='util'?'UTILITY':t==='heal'?'HEAL':t}</span>`).join('');
    const ccHtml  = a.cc ? `<span class="ab-tag cc" style="background:rgba(255,170,50,0.2);color:${CC_COLORS[a.cc.type]||'#ffaa33'};border-color:${CC_COLORS[a.cc.type]||'#ffaa33'}40">${CC_LABELS[a.cc.type]||a.cc.type.toUpperCase()} ${a.cc.duration}s</span>` : '';
    const dmgVal  = a.damage>0 ? `<div class="ab-stat-row"><span class="ab-stat-label">DAMAGE</span><span class="ab-stat-val" style="color:#ff7755">${a.damage}</span></div>` : '';
    const healVal = a.healAmt  ? `<div class="ab-stat-row"><span class="ab-stat-label">HEAL</span><span class="ab-stat-val" style="color:#44ff88">+${a.healAmt}</span></div>` : '';
    return `<div class="ability-card${isUlt?' ult':''}">
      <div class="ab-header">
        <span class="ab-keybind" style="font-size:9px;letter-spacing:0px;line-height:1.3"><span data-bind="${actions[idx]}">${fallback[idx]}</span></span>
        <span class="ab-icon-big">${iconSVG(a.icon,32)}</span>
        <span class="ab-title" style="color:${isUlt?'#ffcc44':h.color}">${a.name}</span>
      </div>
      <div class="ab-divider"></div>
      <div class="ab-desc">${a.desc}</div>
      <div class="ab-tags">${tagHtml}${ccHtml}</div>
      <div class="ab-stats">${dmgVal}${healVal}
        <div class="ab-stat-row"><span class="ab-stat-label">COOLDOWN</span><span class="ab-stat-val" style="color:#aaccff">${a.cd}s</span></div>
        <div class="ab-stat-row"><span class="ab-stat-label">MANA</span><span class="ab-stat-val" style="color:#6688ff">${a.manaCost}</span></div>
      </div>
    </div>`;
  }

  function specialCardFull(h) {
    const SPECIAL_DESCS = {
      melee:  'Ground-pound AOE around you. Stuns nearby enemies and damages obstacles in range. Heavier elements hit harder and wider.',
      hybrid: 'Dash forward and hit the first enemy or obstacle in your path. Slows what it hits and shoves obstacles aside.',
      ranged: 'Fire a fast long-range skillshot beyond your normal attack range. Great for finishing fleeing targets or clearing obstacles.',
    };
    const cls  = h.combatClass || 'hybrid';
    const spec = SPECIAL_CONFIG?.[cls] ?? { label:'SPECIAL', cd:8, color:'#ffffff' };
    return `<div class="ability-card" style="border-color:${spec.color}33;background:rgba(0,0,0,0.12);">
      <div class="ab-header">
        <span class="ab-keybind" style="font-size:9px;letter-spacing:0px;line-height:1.3"><span data-bind="special">F</span></span>
        <span class="ab-icon-big" style="font-size:20px">💥</span>
        <span class="ab-title" style="color:${spec.color}">${spec.label}</span>
      </div>
      <div class="ab-divider" style="border-color:${spec.color}33"></div>
      <div class="ab-desc">${SPECIAL_DESCS[cls]}</div>
      <div class="ab-tags"><span class="ab-tag" style="background:${spec.color}22;color:${spec.color};border:1px solid ${spec.color}44">${cls.toUpperCase()} CLASS</span><span class="ab-tag" style="background:rgba(0,255,150,0.1);color:#44ffaa;border:1px solid #44ffaa44">FREE</span></div>
      <div class="ab-stats">
        <div class="ab-stat-row"><span class="ab-stat-label">COOLDOWN</span><span class="ab-stat-val" style="color:#aaccff">${spec.cd}s</span></div>
        <div class="ab-stat-row"><span class="ab-stat-label">MANA</span><span class="ab-stat-val" style="color:#44ffaa">FREE</span></div>
      </div>
    </div>`;
  }

  el.innerHTML = `
    <div class="detail-page-hero-header">
      <div class="detail-page-portrait">
        <canvas id="detail-page-canvas"
          style="width:clamp(80px,12vw,120px);height:clamp(80px,12vw,120px);
                 border:2px solid ${h.color}44;background:rgba(0,0,0,0.4);display:block"></canvas>
      </div>
      <div>
        <div class="detail-page-title" style="color:${h.color}">${h.name}</div>
        <div class="detail-page-role">${h.role}</div>
        <div class="detail-page-desc">${h.desc}</div>
        ${PASSIVES[h.id] ? `<div style="margin-top:6px;padding:5px 8px;background:rgba(255,255,255,0.05);border-left:2px solid ${h.color};border-radius:2px;font-size:clamp(9px,1vw,12px);color:${h.color};font-family:'Rajdhani',sans-serif;letter-spacing:0.5px"><span style="opacity:0.6;text-transform:uppercase;font-size:0.85em">Passive · </span><strong>${PASSIVES[h.id].name}</strong><span style="color:rgba(255,255,255,0.6)"> — ${PASSIVES[h.id].desc}</span></div>` : ''}
      </div>
    </div>

    <div class="detail-section-title">CORE STATS</div>
    <div class="stat-grades">
      ${gradeCard('hp',       b.hp)}
      ${gradeCard('defense',  b.defense)}
      ${gradeCard('damage',   b.damage)}
      ${gradeCard('mobility', b.mobility)}
    </div>

    <div class="detail-section-title">COMBAT STATS</div>
    <div class="ext-stats-grid">
      ${extendedStatRow('atkSpeed',    b.atkSpeed)}
      ${extendedStatRow('abilityPower',b.abilityPower)}
      ${extendedStatRow('cdr',         b.cdr)}
      ${extendedStatRow('lifesteal',   b.lifesteal)}
      ${extendedStatRow('critChance',  b.critChance)}
      ${extendedStatRow('armorPen',    b.armorPen)}
      ${extendedStatRow('manaRegen',   b.manaRegen)}
    </div>

    <div class="detail-section-title">ABILITIES</div>
    <div class="abilities-row">
      ${h.abilities.map((a,i) => abilityCardFull(a,i)).join('')}
      ${specialCardFull(h)}
    </div>`;

  // Animate portrait — high-res with DPR
  clearInterval(window._detailPageInterval);
  refreshDynamicBindLabels();
  window._detailPageInterval = setInterval(()=>{
    const cvs = document.getElementById('detail-page-canvas');
    if (!cvs) { clearInterval(window._detailPageInterval); return; }
    const dpr = window.devicePixelRatio || 1;
    const cssW = cvs.offsetWidth || 100;
    const cssH = cvs.offsetHeight || 100;
    if (cvs.width !== Math.round(cssW * dpr) || cvs.height !== Math.round(cssH * dpr)) {
      cvs.width  = Math.round(cssW * dpr);
      cvs.height = Math.round(cssH * dpr);
    }
    const cctx = cvs.getContext('2d');
    const drawer = SPRITE_DRAWERS[h.id];
    if (drawer) {
      cctx.clearRect(0, 0, cvs.width, cvs.height);
      cctx.save();
      cctx.scale(dpr, dpr);
      drawer(cctx, cssW / 2, cssH / 2 + 2, cssW * 0.28, Date.now() * 0.001, 1);
      cctx.restore();
    }
  }, 50);
}

// ── First-launch tip ──
const LAUNCH_TIP_KEY = 'ec_launch_tip_seen';
function checkLaunchTip() {
  try {
    if (!localStorage.getItem(LAUNCH_TIP_KEY)) {
      document.getElementById('launch-tip').style.display = 'flex';
    }
  } catch(e) { /* storage blocked — skip tip */ }
}
function dismissLaunchTip() {
  document.getElementById('launch-tip').style.display = 'none';
  try { localStorage.setItem(LAUNCH_TIP_KEY, '1'); } catch(e) {}
}

function abilityCard(a, idx) {
  const actions  = ['q', 'e', 'r'];
  const fallback = ['Q', 'E', 'R'];
  const isUlt = idx === 2;
  return `<div class="ability-card-compact${isUlt?' ult':''}">
    <div class="ab-compact-header">
      <span class="ab-keybind" style="font-size:8px;letter-spacing:0;line-height:1.3"><span data-bind="${actions[idx]}">${fallback[idx]}</span></span>
      <span class="ab-icon-sm">${iconSVG(a.icon, 22)}</span>
      <span class="ab-compact-name" style="color:${isUlt?'#ffcc44':'rgba(255,255,255,0.85)'}">${a.name}</span>
    </div>
    <div class="ab-compact-meta">${a.cd}s cd · ${a.manaCost} mp${a.damage>0?' · '+a.damage+' dmg':''}</div>
    <div class="ab-compact-desc">${a.desc}</div>
  </div>`;
}

function specialCardCompact(h) {
  const SPECIAL_DESCS = {
    melee:  'AOE ground-pound. Stuns enemies, damages obstacles. Heavier elements hit harder.',
    hybrid: 'Dash forward, hitting the first enemy or obstacle. Slows on hit.',
    ranged: 'Fast long-range skillshot beyond normal attack range.',
  };
  const cls  = h.combatClass || 'hybrid';
  const spec = SPECIAL_CONFIG?.[cls] ?? { label:'SPECIAL', cd:8, color:'#ffffff' };
  return `<div class="ability-card-compact" style="border-color:${spec.color}33;">
    <div class="ab-compact-header">
      <span class="ab-keybind" style="font-size:8px;letter-spacing:0;line-height:1.3"><span data-bind="special">F</span></span>
      <span class="ab-icon-sm" style="font-size:14px">💥</span>
      <span class="ab-compact-name" style="color:${spec.color}">${spec.label}</span>
    </div>
    <div class="ab-compact-meta">${spec.cd}s cd · FREE</div>
    <div class="ab-compact-desc">${SPECIAL_DESCS[cls]}</div>
  </div>`;
}

function renderHeroDetail(el, h) {
  if (!el || !h || !h.baseStats) return;  // guard against null/undefined hero
  const b = h.baseStats;

  el.innerHTML = `
    <div class="stat-grades">
      ${gradeCard('hp',      b.hp)}
      ${gradeCard('defense', b.defense)}
      ${gradeCard('damage',  b.damage)}
      ${gradeCard('mobility',b.mobility)}
    </div>
    <div class="hs-inline-lobby"></div>`;

  // Populate inline lobby controls
  _buildInlineLobbyControls(el);
}

// ── Inline lobby controls rendered inside hero detail panel ──
function _buildInlineLobbyControls(detailEl) {
  // no-op — match-label now lives in hs-section-mode only
}


const STAT_META = {
  // core — shown as grade cards
  hp:          { label:'HP',           color:'#44ff88', unitLabel:' HP',  desc:'Total health pool. Higher HP means more punishment absorbed before dying.' },
  defense:     { label:'DEFENSE',      color:'#4488ff', unitLabel:'% DR', desc:'Flat damage reduction on every hit received. Stacks multiplicatively with shields.' },
  damage:      { label:'DAMAGE',       color:'#ff6644', unitLabel:'× DMG',desc:'Ability damage multiplier. Scales all outgoing damage from spells.' },
  mobility:    { label:'MOBILITY',     color:'#ffee44', unitLabel:' SPD', desc:'Movement speed across the arena. Affects both chasing and escaping.' },
  // extended — shown in expandable sheet, item-ready
  atkSpeed:    { label:'ATTACK SPD',   color:'#ffaa44', unitLabel:'/s',   desc:'Attacks or casts per second for basic projectiles. (Active in future update)' },
  abilityPower:{ label:'ABILITY PWR',  color:'#ff44aa', unitLabel:'× AP', desc:'Multiplies all ability damage. Stacks with base Damage stat.' },
  cdr:         { label:'COOLDOWN RED', color:'#44ffcc', unitLabel:'% CDR',desc:'Reduces all ability cooldowns. Capped at 40%. Already active in combat.' },
  lifesteal:   { label:'LIFESTEAL',    color:'#ff6688', unitLabel:'% LS', desc:'Returns a % of all ability damage dealt as HP. Active in combat.' },
  critChance:  { label:'CRIT CHANCE',  color:'#ffee00', unitLabel:'% CC', desc:'Chance for any hit to deal 1.75× damage. Active in combat.' },
  armorPen:    { label:'ARMOR PEN',    color:'#ff8844', unitLabel:'% PEN',desc:'Pierces a flat % of the enemy defense on every hit. Active in combat.' },
  manaRegen:   { label:'MANA REGEN',   color:'#6688ff', unitLabel:'/s',   desc:'Mana restored per second passively. Active in combat.' },
  moveSpeed:   { label:'MOVE SPEED',   color:'#aaffee', unitLabel:' SPD', desc:'Raw movement speed alias. Used as the target stat for mobility items.' },
};

function pipsHTML(stars, color) {
  let html = '<div class="stat-pips">';
  for (let i = 1; i <= 5; i++) {
    let cls;
    if (stars >= i)           cls = 'stat-pip stat-pip-filled';
    else if (stars >= i-0.5) cls = 'stat-pip stat-pip-half';
    else                      cls = 'stat-pip stat-pip-empty';
    html += `<div class="${cls}" style="background:${color}"></div>`;
  }
  html += '</div>';
  return html;
}

function gradeCard(statKey, rawVal) {
  const meta  = STAT_META[statKey];
  const stars = rawToStars(rawVal);
  const real  = rawToReal(statKey, rawVal);
  const color = starsColor(stars);
  return `<div class="stat-grade-card" ontouchstart="this.classList.toggle('tapped')">
    <div class="stat-grade-label">${meta.label}</div>
    ${pipsHTML(stars, color)}
    <div class="stat-grade-val" style="color:${color}">${real}<span style="font-size:8px;opacity:0.6;font-weight:400;margin-left:1px">${meta.unitLabel}</span></div>
    <div class="stat-tooltip">
      <div class="stat-tooltip-name">${meta.label}</div>
      <div class="stat-tooltip-val" style="color:${color}">${real}${meta.unitLabel}</div>
      <div class="stat-tooltip-desc">${meta.desc}</div>
    </div>
  </div>`;
}

function extendedStatRow(statKey, rawVal) {
  const meta  = STAT_META[statKey];
  const stars = rawToStars(rawVal);
  const real  = rawToReal(statKey, rawVal);
  const color = starsColor(stars);
  return `<div class="ext-stat-row">
    <span class="ext-stat-label">${meta.label}</span>
    <div class="ext-stat-bar-wrap">
      <div class="ext-stat-bar-track">
        <div class="ext-stat-bar-fill" style="width:${rawVal}%;background:${color}"></div>
      </div>
    </div>
    <span class="ext-stat-grade" style="color:${color}">${pipsHTML(stars, color)}</span>
    <span class="ext-stat-val" style="color:${color}">${real}${meta.unitLabel}</span>
  </div>`;
}

// ========== LOBBY SYSTEM ==========
function toggleFriendlyFire() {
  friendlyFire = !friendlyFire;
  const btn = document.getElementById('ff-toggle');
  if (!btn) return;
  btn.textContent = `FRIENDLY FIRE: ${friendlyFire ? 'ON' : 'OFF'}`;
  btn.classList.toggle('active', friendlyFire);
}

function setDifficulty(d) {
  aiDifficulty = d;
  const colors = { easy:'#44ff88', normal:'#00d4ff', hard:'#ff4444' };
  ['easy','normal','hard'].forEach(k => {
    const btn = document.getElementById('diff-'+k);
    if (!btn) return;
    const active = k === d;
    const col = colors[k];
    btn.style.borderColor = active ? col : '';
    btn.style.color       = active ? col : '';
    btn.style.background  = active ? `rgba(${k==='easy'?'68,255,136':k==='normal'?'0,212,255':'255,68,68'},0.18)` : '';
    btn.style.opacity     = active ? '1' : '';
    btn.classList.toggle('active', active);
  });
}






function buildSettingsPanel() {
  // Sync difficulty and friendly fire
  setDifficulty(aiDifficulty);
  const ffBtn = document.getElementById('ff-toggle');
  if (ffBtn) {
    ffBtn.textContent = 'FRIENDLY FIRE: ' + (friendlyFire ? 'ON' : 'OFF');
    ffBtn.classList.toggle('active', friendlyFire);
  }

  // Kill limit buttons: 5, 10, 15, 20, 25
  const killRow = document.getElementById('kill-limit-row');
  if (killRow) {
    killRow.innerHTML = '';
    [5, 10, 15, 20, 25, 999].forEach(k => {
      const btn = document.createElement('button');
      btn.className = 'ms-opt-btn' + (matchKillLimit === k ? ' active' : '');
      btn.textContent = k === 999 ? '∞ KILLS' : k + ' KILLS';
      btn.onclick = () => {
        matchKillLimit = k;
        buildSettingsPanel();
      };
      killRow.appendChild(btn);
    });
  }

  // Match time buttons: 3:30, 5:00, 7:00, 10:00, ∞
  const timeOpts = [
    { label: '3:30',  secs: 210 },
    { label: '5:00',  secs: 300 },
    { label: '7:00',  secs: 420 },
    { label: '10:00', secs: 600 },
    { label: '∞',     secs: Infinity },
  ];
  const timeRow = document.getElementById('match-time-row');
  if (timeRow) {
    timeRow.innerHTML = '';
    timeOpts.forEach(opt => {
      const btn = document.createElement('button');
      btn.className = 'ms-opt-btn' + (matchDuration === opt.secs ? ' active' : '');
      btn.textContent = opt.label;
      btn.onclick = () => {
        matchDuration = opt.secs;
        buildSettingsPanel();
      };
      timeRow.appendChild(btn);
    });
  }
}

function openMatchSettings() {
  const overlay = document.getElementById('match-settings-overlay');
  if (!overlay) return;
  if (overlay.classList.contains('open')) {
    overlay.classList.remove('open');
  } else {
    buildSettingsPanel();
    overlay.classList.add('open');
  }
}

function closeMatchSettings(e) {
  // Close when clicking the dark backdrop (not the panel itself)
  if (e && e.target.id !== 'match-settings-overlay') return;
  const overlay = document.getElementById('match-settings-overlay');
  if (overlay) overlay.classList.remove('open');
}

// Auto-assign slot types: first human-flagged slot = P1, second = P2, etc.
// CPU slots stay CPU. Called every time lobby rebuilds.
function autoAssignSlotTypes() {
  let humanCount = 0;
  const pLabels = ['p1','p2','p3','p4'];
  lobbySlots.forEach(slot => {
    if (slot.type !== 'cpu') {
      slot.type = pLabels[humanCount] || 'p4';
      humanCount++;
    }
  });
}

function buildLobby() {
  const slotsEl = document.getElementById('lobby-slots');
  if (!slotsEl) return;
  slotsEl.innerHTML = '';
  setDifficulty(aiDifficulty);
  // Drive column layout via data attribute — CSS does the rest
  const n = lobbySlots.length;
  slotsEl.dataset.cols = n <= 2 ? '1' : n <= 4 ? '2' : '3';

  // Auto-assign types: slot 0 = P1, rest = CPU unless toggled.
  // Re-derive clean labels based on current state — no manual type picking needed.
  autoAssignSlotTypes();

  lobbySlots.forEach((slot, i) => {
    const tc   = TEAM_COLORS[slot.teamId] || TEAM_COLORS[0];
    const isHuman = slot.type !== 'cpu';
    const label = isHuman ? slot.type.toUpperCase() : 'CPU';

    const pill = document.createElement('div');
    pill.className = 'lslot-pill'
      + (i === activeSlotIdx ? ' lslot-active' : '')
      + (slot.locked ? ' lslot-locked' : '')
      + (isHuman ? ' lslot-human' : '');
    // Human slots: border colour matches their player colour (P1=gold, P2=cyan, etc.)
    const humanIdx = lobbySlots.filter((s,li) => s.type !== 'cpu' && li <= i).length - 1;
    const playerPillColor = isHuman ? (PLAYER_COLORS[humanIdx] ?? '#44ff88') : tc.color + '55';
    pill.style.borderColor = playerPillColor;
    pill.dataset.idx = i;

    // Portrait circle
    const portrait = document.createElement('div');
    portrait.className = 'lslot-portrait';
    portrait.style.borderColor = tc.color;
    if (slot.hero) {
      const cvs = document.createElement('canvas');
      const dpr = window.devicePixelRatio || 1;
      const P = 44;
      cvs.width = P * dpr; cvs.height = P * dpr;
      cvs.style.cssText = `width:${P}px;height:${P}px;`;
      const cctx = cvs.getContext('2d');
      const drawer = SPRITE_DRAWERS[slot.hero.id];
      if (drawer) {
        cctx.save(); cctx.scale(dpr, dpr);
        drawer(cctx, P/2, P/2+1, P*0.28, Date.now()*0.001, 1);
        cctx.restore();
      }
      portrait.appendChild(cvs);
    } else {
      const ph = document.createElement('div');
      ph.style.cssText = 'font-size:18px;opacity:0.2;line-height:1;';
      ph.textContent = '?';
      portrait.appendChild(ph);
    }
    pill.appendChild(portrait);

    // Centre col: hero name + type label
    const info = document.createElement('div');
    info.className = 'lslot-info';

    const heroName = document.createElement('div');
    heroName.className = 'lslot-name';
    heroName.style.color = slot.hero ? slot.hero.color : 'var(--muted)';
    heroName.textContent = slot.hero ? slot.hero.name : '—';
    info.appendChild(heroName);

    const typeLabel = document.createElement('div');
    typeLabel.className = 'lslot-type' + (isHuman ? ' lslot-type-human' : '');
    typeLabel.textContent = label;
    info.appendChild(typeLabel);
    pill.appendChild(info);

    // Right: team colour dot (tap to cycle) + optional CPU/human toggle icon
    const right = document.createElement('div');
    right.className = 'lslot-right';

    // CPU / HUMAN toggle switch
    const toggleWrap = document.createElement('div');
    toggleWrap.className = 'lslot-toggle-wrap' + (slot.locked ? ' lslot-toggle-locked' : '');
    toggleWrap.innerHTML = `
      <span class="lslot-toggle-side lslot-toggle-cpu${!isHuman ? ' lslot-toggle-active-cpu' : ''}">CPU</span>
      <div class="lslot-toggle-track${isHuman ? ' lslot-toggle-on' : ''}">
        <div class="lslot-toggle-thumb"></div>
      </div>
      <span class="lslot-toggle-side lslot-toggle-human${isHuman ? ' lslot-toggle-active-human' : ''}">HUMAN</span>
    `;
    toggleWrap.onclick = (e) => {
      e.stopPropagation();
      if (lobbyPhase !== 'pick' || slot.locked) return;
      slot.type = isHuman ? 'cpu' : 'p1';
      autoAssignSlotTypes();
      buildLobby();
      buildHeroGrid('hero-grid', 'hero-detail');
      setTimeout(() => HeroCursors.start(), 100);
    };
    right.appendChild(toggleWrap);

    // Team dot
    const teamDot = document.createElement('button');
    teamDot.className = 'lslot-team-dot';
    teamDot.style.cssText = `border-color:${tc.color}66;color:${tc.color};`;
    teamDot.title = 'Tap to change team colour';
    teamDot.innerHTML = `<span class="lslot-team-swatch" style="background:${tc.color};box-shadow:0 0 5px ${tc.color}88;"></span><span class="lslot-team-label">TEAM</span>`;
    teamDot.onclick = (e) => {
      e.stopPropagation();
      if (lobbyPhase !== 'pick' || slot.locked) return;
      slot.teamId = (slot.teamId + 1) % 6;
      buildLobby();
    };
    right.appendChild(teamDot);
    pill.appendChild(right);

    // Tap pill to make it the active selection slot
    pill.onclick = () => {
      if (lobbyPhase !== 'pick' || slot.locked) return;
      activeSlotIdx = i;
      buildLobby();
      buildHeroGrid('hero-grid', 'hero-detail');
    };

    slotsEl.appendChild(pill);
  });

    // Animate portraits
  clearInterval(window._slotPortraitInterval);
  window._slotPortraitInterval = setInterval(() => {
    slotsEl.querySelectorAll('.slot-portrait canvas').forEach((cvs, i) => {
      const slot = lobbySlots[i]; if (!slot || !slot.hero) return;
      const cctx = cvs.getContext('2d');
      const drawer = SPRITE_DRAWERS[slot.hero.id];
      const dpr = window.devicePixelRatio || 1;
      const P = 60;
      if (drawer) {
        cctx.clearRect(0, 0, cvs.width, cvs.height);
        cctx.save(); cctx.scale(dpr, dpr);
        drawer(cctx, P / 2, P / 2 + 2, P * 0.28, Date.now() * 0.001, 1);
        cctx.restore();
      }
    });
  }, 50);

  // Update ready button + status
  const readyBtn = document.getElementById('ready-btn');

  // Update match label (team breakdown)
  const matchLabelEl = document.getElementById('match-label');
  if (matchLabelEl) matchLabelEl.innerHTML = getMatchLabel();
  const slotCountEl = document.getElementById('slot-count-inline');
  if (slotCountEl) slotCountEl.textContent = lobbySlots.length;
  _buildInlineLobbyControls();

  if (lobbyPhase === 'pick') {
    const allFilled = lobbySlots.every(s => s.hero);
    readyBtn.textContent = allFilled ? 'LOCK IN' : 'READY';
    readyBtn.disabled = false;
    if (allFilled) {
      readyBtn.style.borderColor = 'gold';
      readyBtn.style.color = 'gold';
      readyBtn.style.background = 'rgba(255,200,0,0.1)';
      // Auto-launch only in solo mode — MP requires the Ready button
      const humanCount = lobbySlots.filter(s => s.type !== 'cpu').length;
      if (humanCount <= 1) {
        clearTimeout(window._autoLockTimer);
        window._autoLockTimer = setTimeout(() => {
          const hs = document.getElementById('hero-select');
          const teamsOk = new Set(lobbySlots.map(s => s.teamId)).size >= 2;
          if (lobbyPhase === 'pick' && lobbySlots.every(s => s.hero) && teamsOk && hs && hs.classList.contains('active')) lobbyReady();
        }, 800);
      }
    } else {
      readyBtn.style.borderColor = '';
      readyBtn.style.color = '';
      readyBtn.style.background = '';
    }
  }

  // Force the scroll container to recompute its scrollable height after DOM changes.
  // Without this, adding slots doesn't update the scroll range on iOS/Chrome.
  requestAnimationFrame(() => {
    const screen = document.getElementById('hero-select');
    if (screen) {
      // Nudge scrollTop to trigger scroll height recalculation
      const prev = screen.scrollTop;
      screen.scrollTop = screen.scrollHeight;
      screen.scrollTop = prev;
    }
  });
}

function lobbySetHero(h) {
  if (lobbyPhase !== 'pick') return;
  const slot = lobbySlots[activeSlotIdx];
  if (!slot || slot.locked) return;
  slot.hero = h;
  selectedHero = h;

  // Auto-advance cursor to next unpicked human slot
  const humanSlots = lobbySlots.map((s,i) => ({s,i})).filter(({s}) => s.type !== 'cpu');
  const nextUnpicked = humanSlots.find(({s,i}) => !s.hero && i !== activeSlotIdx);
  if (nextUnpicked) activeSlotIdx = nextUnpicked.i;

  buildLobby();
  buildHeroGrid('hero-grid','hero-detail');
}

function lobbyReady() {
  if (lobbyPhase !== 'pick') return;

  // Validate: must have at least two distinct teams
  const uniqueTeams = new Set(lobbySlots.map(s => s.teamId));
  if (uniqueTeams.size < 2) {
    showLobbyError('At least two different teams are required. Tap a team badge to reassign a slot.');
    return;
  }

  // Fill any empty slots with random CPU heroes (no duplicates within the match)
  const takenHeroIds = lobbySlots.filter(s => s.hero).map(s => s.hero.id);
  lobbySlots.forEach(slot => {
    if (!slot.hero) {
      // Pick a random hero not already taken
      const available = HEROES.filter(h => !takenHeroIds.includes(h.id));
      const pool = available.length > 0 ? available : HEROES;
      const picked = pool[Math.floor(Math.random() * pool.length)];
      slot.hero = picked;
      if (slot.type === 'cpu') slot.type = 'cpu';  // keep cpu as cpu
      takenHeroIds.push(picked.id);
    }
  });

  lobbySlots.forEach(s => s.locked = true);
  lobbyPhase = 'launch';
  launchGame();
}

function showLobbyError(msg) {
  // Remove any existing error dialog
  const existing = document.getElementById('lobby-error-dialog');
  if (existing) existing.remove();

  const dialog = document.createElement('div');
  dialog.id = 'lobby-error-dialog';
  dialog.style.cssText = `
    position:fixed; inset:0; display:flex; align-items:center; justify-content:center;
    z-index:9999; background:rgba(0,0,0,0.6); animation:fadeIn 0.15s ease;
  `;
  dialog.innerHTML = `
    <div style="
      background:#0a0f1a; border:1px solid #ff4444;
      border-radius:8px; padding:clamp(16px,3vw,28px) clamp(20px,4vw,36px);
      max-width:clamp(260px,80vw,420px); text-align:center;
      box-shadow:0 0 32px rgba(255,68,68,0.25);
    ">
      <div style="font-size:clamp(22px,3vw,32px); margin-bottom:10px;">⚠</div>
      <div style="
        font-family:'Orbitron',monospace; font-size:clamp(10px,1.2vw,13px);
        font-weight:700; letter-spacing:1px; color:#ff6666; margin-bottom:8px;
      ">CAN'T START MATCH</div>
      <div style="
        font-size:clamp(11px,1.1vw,13px); color:rgba(255,255,255,0.65);
        line-height:1.5; margin-bottom:20px;
      ">${msg}</div>
      <button onclick="document.getElementById('lobby-error-dialog').remove()" style="
        font-family:'Orbitron',monospace; font-size:clamp(9px,1vw,11px);
        font-weight:700; letter-spacing:1px; padding:8px 24px;
        background:rgba(255,68,68,0.15); border:1px solid #ff4444;
        color:#ff6666; border-radius:4px; cursor:pointer;
      ">GOT IT</button>
    </div>
  `;
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.remove(); });
  document.body.appendChild(dialog);
}



function launchGame() {
  clearInterval(lobbyTimerInterval);
  clearInterval(window._slotPortraitInterval);
  document.body.classList.add('in-game');
  showScreen('game');
  initGame();
  // Set spectator-mode body class after initGame sets gameState
  setTimeout(() => {
    if (gameState?.spectator) document.body.classList.add('spectator-mode');
  }, 50);
}

