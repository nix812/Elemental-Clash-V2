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

function togglePause() {
  const overlay = document.getElementById('pause-overlay');
  if (!overlay) return;
  const paused = overlay.style.display === 'flex';
  overlay.style.display = paused ? 'none' : 'flex';
  if (paused) {
    if (gameState) gameState._lastTimestamp = null; // force dt reset on resume
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
  cycleTarget: [8],   // Select / Share
  scoreboard:  [8],   // Select / Share (hold — handled separately in input.js)
};

let controllerBindings = (() => {
  const saved = JSON.parse(localStorage.getItem('ec_ctrl_bindings') || 'null');
  const merged = Object.assign(JSON.parse(JSON.stringify(DEFAULT_CONTROLLER_BINDINGS)), saved || {});
  // Migrate old single-integer format to arrays
  for (const k of Object.keys(merged)) {
    if (!Array.isArray(merged[k])) merged[k] = merged[k] >= 0 ? [merged[k]] : [];
  }
  return merged;
})();
let rebindingCtrlAction = null;
let optionsActiveTab = 'controls'; // persists across rebuilds

function saveCtrlBindings() { localStorage.setItem('ec_ctrl_bindings', JSON.stringify(controllerBindings)); refreshDynamicBindLabels(); }
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
        v: 'v0.3.24', date: '2026-03-16',
        title: 'Bug Fixes, Balance Pass, Performance + Code Cleanup',
        changes: [
          { tag: 'BUGFIX', text: 'GALE Tailwind — passive was silently double-consumed every cast, making Tailwind Burst never fire. Fixed: single clean call, multiplier now routes correctly.' },
          { tag: 'BUGFIX', text: 'MYST Arcane Echo — AOE/multi-kills could grant multiple CD refunds per cast. Fixed: _echoFiredForCast guard ensures one refund per ability.' },
          { tag: 'BUGFIX', text: 'TIDE Tsunami — projectiles were spawned via setTimeout, causing frame-rate-dependent timing and incorrect caster position. Replaced with frame-accurate _pendingShots queue.' },
          { tag: 'BUGFIX', text: 'Aftershock slow zone — characters could remain permanently slowed after leaving the zone. Fixed: speed now restores when ccedTimer expires in both player and AI tick.' },
          { tag: 'BALANCE', text: 'FLORA nerf — lifesteal 38→28, ability power 88→78. Was winning 97% of 1v1s.' },
          { tag: 'BALANCE', text: 'STONE nerf — armour penetration 72→52, Tectonic Fury 140→118 damage.' },
          { tag: 'BALANCE', text: 'FORGE nerf — defense 72→60, Meltdown 125→108 damage.' },
          { tag: 'BALANCE', text: 'GALE buff — damage stat 80→88, Gust Bolt 30→38. Tailwind bug fix alone is a large effective buff.' },
          { tag: 'BALANCE', text: 'VOID buff — ability power 88→96, Eclipse Mute 42→55 damage.' },
          { tag: 'BALANCE', text: 'EMBER buff — ability power 72→80, Inferno 130→145 damage.' },
          { tag: 'BALANCE', text: 'FROST buff — HP raw 64→72, defense raw 56→62. Survivability uplift.' },
          { tag: 'BALANCE', text: 'MYST buff — Arcane Bolt 35→42 damage. Rewards her high CDR with better poke pressure.' },
          { tag: 'PERF', text: 'gs._allChars / gs._allCharsAlive cached once per frame — eliminates 6–8 repeated array spread allocations per tick.' },
          { tag: 'CODE', text: 'warpDelta and warpDist2 moved from ai.js to arena.js — correct load order, no more implicit hoisting dependency.' },
          { tag: 'CODE', text: 'Removed dead code: ab.type teleport handler, ab.type buff handler, unused _abDist variable.' },
        ]
      },
      {
        v: 'v0.3.23', date: '2026-03-16',
        title: 'All Hero Mechanical Twists + HTP/Roster Updates',
        changes: [
          { tag: 'GAMEPLAY', text: 'STONE — Aftershock: SLAM leaves a cracked slow zone (130px, 3s) that slows enemies who step in it for 2s' },
          { tag: 'GAMEPLAY', text: 'GALE — Tailwind: sprinting activates a 3s window where next ability gets +30% projectile speed and range' },
          { tag: 'GAMEPLAY', text: 'VOID — Phantom Step: while Shadow Strike post-warp window is active, one incoming hit is phased through' },
          { tag: 'GAMEPLAY', text: 'MYST — Arcane Echo: killing with an ability refunds 50% of that ability\'s cooldown' },
          { tag: 'GAMEPLAY', text: 'VOLT — Static Charge: autos build stacks (max 3, 4s timeout); next ability cast consumes for +8% flat damage per stack' },
          { tag: 'GAMEPLAY', text: 'FORGE — Molten Core: while Iron Will is active, melee collisions deal +50% damage' },
          { tag: 'GAMEPLAY', text: 'MYST Arcane Echo now tracks last ability used via _lastAbIdx for correct refund targeting' },
          { tag: 'GAMEPLAY', text: 'VOLT Static now fires onAutoAttack hook from player auto-attack loop' },
          { tag: 'VFX', text: 'Aftershock zone renders as dashed green circle with SLOW label' },
          { tag: 'UI', text: 'HTP updated: Rock Buster section added, Specials updated with STONE/GALE twists, Hazard Zones section added, Passives section now shows all 10 hero twists' },
          { tag: 'UI', text: 'Roster detail page passive descriptions auto-update from heroes.js — no manual sync needed' },
        ]
      },
      {
        v: 'v0.3.23', date: '2026-03-16',
        title: 'Hero Mechanical Twists — Full Roster',
        changes: [
          { tag: 'GAMEPLAY', text: 'STONE — Aftershock: SLAM now leaves a 130px slow zone for 3s. Enemies in it are slowed 45%' },
          { tag: 'GAMEPLAY', text: 'GALE — Tailwind: sprinting activates a 3s window where the next ability fires 30% faster and travels 30% further' },
          { tag: 'GAMEPLAY', text: 'VOID — Phantom Step: while Shadow Strike window is active after warping, one incoming hit is phased through completely' },
          { tag: 'GAMEPLAY', text: 'MYST — Arcane Echo: killing an enemy with an ability refunds 50% of that ability\'s cooldown — chain-kill combos reset the toolkit' },
          { tag: 'GAMEPLAY', text: 'VOLT — Static Charge: auto-attacks build stacks (max 3, expire after 4s). Next ability consumes them for +8% damage each' },
          { tag: 'GAMEPLAY', text: 'FORGE — Molten Core: while Iron Will is active, melee collisions deal +50% damage. Rewards baiting a big hit then charging in' },
          { tag: 'VFX', text: 'Aftershock zones render as pulsing dashed green circles with a SLOW label' },
        ]
      },
      {
        v: 'v0.3.22', date: '2026-03-16',
        title: 'AI Special Ability Improvements',
        changes: [
          { tag: 'AI', text: 'Easy bots no longer use SLAM/SURGE/FOCUS — consistent with their passive playstyle' },
          { tag: 'AI', text: 'SLAM — Hard bots prioritise SLAM when target is CC\'d, low HP, or point-blank; Normal bots fire on proximity as before' },
          { tag: 'AI', text: 'SURGE — Hard bots now use SURGE as an escape dash when fleeing, not just for engaging' },
          { tag: 'AI', text: 'FOCUS — Hard bots prefer to fire when target is CC\'d (guaranteed hit); Normal bots fire at any target in range' },
        ]
      },
      {
        v: 'v0.3.21', date: '2026-03-16',
        title: 'Hero Mechanical Twists',
        changes: [
          { tag: 'GAMEPLAY', text: 'EMBER — Inferno now leaves a Flame Patch on impact: 100px zone, 8 damage/s for 3 seconds' },
          { tag: 'GAMEPLAY', text: 'FROST — Shatter passive now procs on slowed targets (+20%) in addition to frozen (+30%). Rewards Ice Shard → ability chains' },
          { tag: 'GAMEPLAY', text: 'TIDE — Whirlpool now leaves a persistent 3s pull zone after cast: 160px radius, 12 damage/s, continues dragging enemies toward center' },
          { tag: 'GAMEPLAY', text: 'FLORA — Root Tether: passively heals 6 HP/s while a rooted enemy is within 180px. Rewards staying in melee range of rooted targets' },
          { tag: 'GAMEPLAY', text: 'New hazard zone system added — supports persistent ground effects with damage and pull' },
          { tag: 'VFX', text: 'Flame patches render as pulsing gradient circles with dashed orange border' },
          { tag: 'VFX', text: 'Whirlpool zones render as spinning spiral rings with blue gradient fill' },
        ]
      },
      {
        v: 'v0.3.20', date: '2026-03-16',
        title: 'Auto-Attack Fallback Targeting',
        changes: [
          { tag: 'GAMEPLAY', text: 'Auto-attacks now fire at the nearest enemy in range when your locked target is out of range' },
          { tag: 'GAMEPLAY', text: 'Locked target still takes priority — fallback only activates if they\'re too far away' },
          { tag: 'GAMEPLAY', text: 'No more dead air when you\'re surrounded but your target ran off-screen' },
        ]
      },
      {
        v: 'v0.3.19', date: '2026-03-16',
        title: 'Personal Kill Feed Text',
        changes: [
          { tag: 'VFX', text: 'ELIMINATED! now only shows when the human player is killed — not on every bot death' },
          { tag: 'VFX', text: 'KILL!, DOUBLE KILL, TRIPLE KILL!, UNSTOPPABLE!!, FIRST BLOOD, ON FIRE! now only show when the human player gets the kill' },
          { tag: 'VFX', text: 'Screen shake on death now only triggers when the human player is eliminated' },
          { tag: 'VFX', text: 'Bot-vs-bot kills no longer generate any float text — combat is much cleaner to read' },
        ]
      },
      {
        v: 'v0.3.18', date: '2026-03-16',
        title: 'No Abilities During Spawn Invulnerability',
        changes: [
          { tag: 'GAMEPLAY', text: 'All abilities (Q/E/R, Special, Sprint, Rock Buster) are blocked during the 2s spawn invulnerability window after respawn' },
          { tag: 'GAMEPLAY', text: 'Prevents using invulnerability frames to safely pre-fire abilities with no risk' },
        ]
      },
      {
        v: 'v0.3.17', date: '2026-03-16',
        title: 'Bot Weather Zone Awareness',
        changes: [
          { tag: 'AI', text: 'Easy bots remain unaware — zones are invisible to them' },
          { tag: 'AI', text: 'Normal bots evaluate zones every 1.5s — seek beneficial zones (DOWNPOUR when hurt, THUNDERSTORM when abilities on CD), avoid dangerous ones (BLACKHOLE, zones that counter their class)' },
          { tag: 'AI', text: 'Hard bots evaluate every 0.8s with full tactical scoring — factors in HP, combat class, cooldown state, and travel cost before committing to a zone' },
          { tag: 'AI', text: 'HEATWAVE: bots seek when healthy (lethal fights), avoid when low HP' },
          { tag: 'AI', text: 'BLIZZARD: melee avoids (can\'t close), ranged seeks (enemies can\'t escape)' },
          { tag: 'AI', text: 'SANDSTORM: ranged/hybrid avoid (range collapses), melee seeks (forces brawl)' },
          { tag: 'AI', text: 'DOWNPOUR: all bots seek when below 50% HP — also biases retreat path toward it' },
          { tag: 'AI', text: 'BLACKHOLE: all bots avoid — hard bots less so if enemy is already being pulled in' },
          { tag: 'AI', text: 'Weather waypoints blend into chase movement (18-30%) without overriding gate routing or flee logic' },
        ]
      },
      {
        v: 'v0.3.16', date: '2026-03-16',
        title: 'Bot Retreat Overhaul',
        changes: [
          { tag: 'AI', text: 'Easy bots unchanged — no retreat, they fight to the death' },
          { tag: 'AI', text: 'Normal bots now use retreat-to-distance — they maintain a target distance (420px) and circle laterally rather than running straight at a wall' },
          { tag: 'AI', text: 'Normal bots re-engage once HP recovers to 42% — no more infinite fleeing' },
          { tag: 'AI', text: 'Hard bots have two retreat sub-modes: kite-retreat above 20% HP (circle at range), full disengage below 20% (path to safest arena quadrant)' },
          { tag: 'AI', text: 'Hard bots evaluate all four arena quadrants by enemy distance and wall proximity to pick the safest fallback position' },
          { tag: 'AI', text: 'All fleeing bots now apply a wall-push force — a repulsion field 200px from any wall that steers them back toward center' },
          { tag: 'AI', text: 'Center pull increased to 55-65% (was 35%) — bots rarely reach the wall now even with warp on CD' },
        ]
      },
      {
        v: 'v0.3.15', date: '2026-03-16',
        title: 'Bot Rock Buster Awareness',
        changes: [
          { tag: 'AI', text: 'Easy bots never use rock buster — rocks are just terrain to them' },
          { tag: 'AI', text: 'Normal bots fire reactively when an obstacle is blocking their chase path or sitting between them and a pursuing enemy' },
          { tag: 'AI', text: 'Hard bots score every nearby obstacle on path-blocking, escape value, proximity, and HP — only fire when it genuinely improves their situation' },
          { tag: 'AI', text: 'All bots track their own rock buster cooldown independently (3.5s)' },
        ]
      },
      {
        v: 'v0.3.14', date: '2026-03-16',
        title: 'Controller Scrolling Fixed',
        changes: [
          { tag: 'FIX', text: 'Controller scrolling now works on Roster detail, HTP, and all screens where the scrollable container is a child div rather than the screen itself' },
          { tag: 'FIX', text: 'UINav now tracks screen changes via showScreen — curScreen was never updating for hero-detail-page or how-to-play' },
          { tag: 'FIX', text: 'Scroll discovery now walks down into screen children when walk-up from focused element finds nothing' },
          { tag: 'FIX', text: 'hero-detail-page and how-to-play added to SCREEN_CONFIGS so navigation and scrolling target them correctly' },
        ]
      },
      {
        v: 'v0.3.13', date: '2026-03-16',
        title: 'Collapsible Patch Notes',
        changes: [
          { tag: 'UI', text: 'Patch notes entries are now collapsible — click any version header to expand/collapse' },
          { tag: 'UI', text: 'Latest version auto-expands on open, all older entries collapsed by default' },
          { tag: 'UI', text: 'Chevron indicator rotates to show open/closed state' },
        ]
      },
      {
        v: 'v0.3.11', date: '2026-03-16',
        title: 'Warp-Aware Flee AI',
        changes: [
          { tag: 'AI', text: 'Bots now track warp cooldown state — gate waypoints are suppressed when warp is unavailable' },
          { tag: 'AI', text: 'Cornered bots with warp on CD now slide laterally along walls instead of bouncing repeatedly' },
          { tag: 'AI', text: 'Open-field flee now biases toward arena center (35%) to avoid self-cornering' },
          { tag: 'AI', text: 'Hard bots with <1.5s warp CD remaining and no escape route turn and fight rather than juke' },
          { tag: 'AI', text: 'Sprint toward gates now requires warp to be ready — bots no longer sprint into solid walls' },
        ]
      },
      {
        v: 'v0.3.10', date: '2026-03-16',
        title: 'Float Text Spatial Separation',
        changes: [
          { tag: 'VFX', text: 'Damage numbers now fall downward below the target\'s feet — no longer competing with event text' },
          { tag: 'VFX', text: 'Damage numbers rendered at 72% alpha — clearly informational rather than dramatic' },
          { tag: 'VFX', text: 'Kill/CC/priority events float upward above the character as before — clean spatial split' },
          { tag: 'VFX', text: 'CC labels tightened to 13px, slower rise so they stay readable without drifting off-screen' },
        ]
      },
      {
        v: 'v0.3.9', date: '2026-03-16',
        title: 'Big Events + Sprint CC Break',
        changes: [
          { tag: 'VFX', text: 'New MEGA float category for ELIMINATED!, FIRST BLOOD, TRIPLE KILL!, UNSTOPPABLE!! — multi-layer glow, scale-pop entry' },
          { tag: 'VFX', text: 'FIRST BLOOD fires on the match\'s very first kill — once per game' },
          { tag: 'VFX', text: 'Kill streak tracking: DOUBLE KILL → TRIPLE KILL! → UNSTOPPABLE!! within 8s window' },
          { tag: 'VFX', text: 'Screen shake on every ELIMINATED! event' },
          { tag: 'VFX', text: 'KILL! bumped to size 32, ON FIRE! to 28, ELIMINATED! to 42' },
          { tag: 'GAMEPLAY', text: 'Sprint now breaks Stun, Slow, and Silence (minor CCs) — shows UNSTOPPABLE! float text' },
          { tag: 'GAMEPLAY', text: 'Sprint does NOT break Freeze — ultimate-tier CC remains punishing' },
        ]
      },
      {
        v: 'v0.3.8', date: '2026-03-16',
        title: 'Spectator / Bot Match Mode',
        changes: [
          { tag: 'FEATURE', text: 'Set Player 1 slot to CPU in the lobby to watch a fully simulated bot match' },
          { tag: 'FEATURE', text: '👁 SPECTATING label shown in HUD during bot matches' },
          { tag: 'FIX', text: 'Controller HUD z-index raised above target frame — buttons no longer render behind it' },
          { tag: 'FIX', text: 'Ability descriptions panel hidden during active gameplay — only visible in lobby/menu' },
        ]
      },
      {
        v: 'v0.3.7', date: '2026-03-16',
        title: 'Controller Scrolling + Audio Fix',
        changes: [
          { tag: 'FIX', text: 'Audio ON/OFF buttons now work correctly — were referencing a removed variable after BGM rewrite' },
          { tag: 'CONTROLS', text: 'Right stick Y scrolls any active menu screen — Options, HTP, Hero Select' },
          { tag: 'CONTROLS', text: 'Left stick also scrolls when d-pad is not in use' },
          { tag: 'CONTROLS', text: 'Scroll finds nearest scrollable container walking up from focused element' },
        ]
      },
      {
        v: 'v0.3.6', date: '2026-03-15',
        title: 'Full Rebind + Options Layout',
        changes: [
          { tag: 'FEATURE', text: 'ALL bindings now rebindable — Tab (Cycle Target) and U (Scoreboard) moved from fixed list to rebind table' },
          { tag: 'FIX', text: 'Secondary binding column was using CLEAR instead of REBIND — corrected to match primary column' },
          { tag: 'FIX', text: 'Clear button (✕) now lives in its own grid column — no longer breaks row alignment' },
          { tag: 'UI', text: 'HTP controller column always visible regardless of gamepad connection state' },
          { tag: 'UI', text: 'HTP Tab and U bindings now pull from actual keybindings via data-bind' },
        ]
      },
      {
        v: 'v0.3.5', date: '2026-03-15',
        title: 'Weather Buff Feedback',
        changes: [
          { tag: 'GAMEPLAY', text: 'Buff labels below characters now show actual intensity-scaled values — edge of zone shows DMG +8%, center shows DMG +40%' },
          { tag: 'VFX', text: 'Inner ring added to weather zones showing the ~80% intensity "power zone" at 45% radius' },
          { tag: 'VFX', text: 'Label alpha now scales with intensity — edge text is muted, center text is bright' },
          { tag: 'BUILD', text: 'build.py now reads version from template — supports x.x.xx format, no longer capped at single digit' },
        ]
      },
      {
        v: 'v0.3.0', date: '2026-03-15',
        title: 'Three Input Layouts + HTP Rebuild',
        changes: [
          { tag: 'UI', text: 'Three distinct HUD layouts: Touch (circles), Keyboard (compact horizontal bar), Controller (diamond)' },
          { tag: 'UI', text: 'Keyboard mode activates on first keydown — shows key chip labels + ability names, still clickable' },
          { tag: 'UI', text: 'Controller diamond: Y top, X left, B right, A bottom, LB/RB shoulders — Rock Buster on B' },
          { tag: 'UI', text: 'HTP controls section rebuilt as two-column table — Keyboard left, Controller right' },
          { tag: 'FIX', text: 'Hero select controller navigation uses actual row structure — can now navigate to all heroes on all rows' },
        ]
      },
      {
        v: 'v0.2.0', date: '2026-03-14',
        title: 'Arena & Game Systems',
        changes: [
          { tag: 'GAMEPLAY', text: 'Floating obstacles — two size tiers, drift/orbit/bounce paths, destructible with fragment spawns' },
          { tag: 'GAMEPLAY', text: 'Rock Buster ability (G / B) — fires at nearest destructible obstacle, independent cooldown' },
          { tag: 'GAMEPLAY', text: 'Sprint collision damage — sprinting into enemies deals flat impulse and chip damage' },
          { tag: 'GAMEPLAY', text: 'Special ability button (F / Y) — SLAM (melee), SURGE (hybrid), FOCUS (ranged)' },
          { tag: 'GAMEPLAY', text: 'Sudden death — tied matches continue until someone scores after time expires' },
          { tag: 'GAMEPLAY', text: 'Score overlay — hold U / Select to view mid-match scoreboard' },
          { tag: 'AI', text: 'Tiered gate AI — Easy ignores gates, Normal reacts, Hard evaluates warp shortcuts strategically' },
          { tag: 'AI', text: 'Spectator/bot-watch mode — all-CPU lobby plays full match autonomously' },
          { tag: 'FIX', text: 'Warp gate corner clipping resolved — gates clamp away from arena corners' },
          { tag: 'FIX', text: 'Health/mana packs now spawn with velocity and bounce off obstacles' },
          { tag: 'FIX', text: 'Black hole bot softlock fixed — physics self-contained, reaction delay scales with difficulty' },
        ]
      },
      {
        v: 'v0.1.0', date: '2026-03-13',
        title: 'Foundation',
        changes: [
          { tag: 'FEATURE', text: '10 elemental heroes across Melee, Ranged, and Hybrid combat classes' },
          { tag: 'FEATURE', text: 'Weather zone system with per-element buff tables and center-weighted intensity' },
          { tag: 'FEATURE', text: 'Fluid CSS scaling and letterbox — same viewport for all screen sizes' },
          { tag: 'FEATURE', text: 'Gamepad, touch, and keyboard/mouse input with full rebinding' },
          { tag: 'FEATURE', text: 'Lobby/ready flow with team assignments and slot management' },
          { tag: 'FEATURE', text: 'Warp gate arena — characters warp through gates in arena walls' },
          { tag: 'FEATURE', text: 'Damage contribution tracking for assist credit' },
          { tag: 'FEATURE', text: 'Off-screen enemy indicators with HP bars' },
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
    // Always reset — back button should clear previous selections
    lobbySlots = [
      { type:'p1',  hero:null, locked:false, teamId:0 },
      { type:'cpu', hero:null, locked:false, teamId:1 },
    ];
    selectedHero = HEROES[0];
    activeSlotIdx = 0;
    buildLobby();
    buildSettingsPanel();
    buildHeroGrid('hero-grid','hero-detail');
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

      const card = document.createElement('div');
      card.className = 'hero-card' + (isSelected?' selected':'') + (takenByOther?' taken':'');
      card.style.cssText = `opacity:${takenByOther?0.35:1}`;

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
    [5, 10, 15, 20, 25].forEach(k => {
      const btn = document.createElement('button');
      btn.className = 'ms-opt-btn' + (matchKillLimit === k ? ' active' : '');
      btn.textContent = k + ' KILLS';
      btn.onclick = () => {
        matchKillLimit = k;
        buildSettingsPanel();
      };
      killRow.appendChild(btn);
    });
  }

  // Match time buttons: 3:30, 5:00, 7:00, 10:00
  const timeOpts = [
    { label: '3:30', secs: 210 },
    { label: '5:00', secs: 300 },
    { label: '7:00', secs: 420 },
    { label: '10:00', secs: 600 },
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
    pill.style.borderColor = isHuman ? '#44ff88' : tc.color + '55';
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
  // Also refresh inline lobby bar in detail panel (may have re-rendered)
  _buildInlineLobbyControls();

  if (lobbyPhase === 'pick') {
    const allFilled = lobbySlots.every(s => s.hero);
    readyBtn.textContent = allFilled ? 'LOCK IN' : 'READY';
    readyBtn.disabled = false;
    if (allFilled) {
      readyBtn.style.borderColor = 'gold';
      readyBtn.style.color = 'gold';
      readyBtn.style.background = 'rgba(255,200,0,0.1)';
      clearTimeout(window._autoLockTimer);
      window._autoLockTimer = setTimeout(() => {
        const hs = document.getElementById('hero-select');
        const teamsOk = new Set(lobbySlots.map(s => s.teamId)).size >= 2;
        if (lobbyPhase === 'pick' && lobbySlots.every(s => s.hero) && teamsOk && hs && hs.classList.contains('active')) lobbyReady();
      }, 800);
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
  // Called when a hero card is clicked in lobby mode
  if (lobbyPhase !== 'pick') return;
  const slot = lobbySlots[activeSlotIdx];
  if (!slot || slot.locked) return;
  slot.hero = h;
  selectedHero = h; // keep detail panel in sync
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
}

