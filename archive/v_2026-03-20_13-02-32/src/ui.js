// ========== VERSION ==========
const CURRENT_VERSION = 'v0.5.160';

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

function endMatchEarly() {
  if (!gameState || gameState.over) return;
  // Close pause overlay first
  const po = document.getElementById('pause-overlay');
  if (po) po.style.display = 'none';
  gamePaused = false;
  // Determine leading team by kills (or team 0 as fallback)
  const gs = gameState;
  let winningTeam = 0;
  let bestKills = -1;
  for (const [teamId, kills] of Object.entries(gs.teamKills ?? {})) {
    if (kills > bestKills) { bestKills = kills; winningTeam = Number(teamId); }
  }
  // Use the same endGame sequence as a normal match end
  // endGame() sets gs.over, cancels animFrame, shows overlay + win screen
  endGame(gs, winningTeam);
}

function togglePause(playerIdx) {
  const overlay = document.getElementById('pause-overlay');
  if (!overlay) return;
  // Use gamePaused flag — more reliable than reading DOM display state
  // which can mismatch on first press if inline style was never set
  const paused = gamePaused;
  overlay.style.display = paused ? 'none' : 'flex';
  // Don't hide cursor in spectator mode — player needs to click things
  if (!document.body.classList.contains('spectator-mode')) {
    document.body.style.cursor = paused ? '' : 'none';
  }

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
    // Resuming — clear flag and restart loop
    gamePaused = false;
    if (gameState) gameState._lastTimestamp = null;
    animFrame = requestAnimationFrame(gameLoop);
  } else {
    // Pausing — set flag so loop won't reschedule after current frame
    gamePaused = true;
    cancelAnimationFrame(animFrame);
    setTimeout(() => UINav.activate('pause-overlay'), 150);
  }
}

function showScoreOverlay(viewerIdx) {
  const overlay = document.getElementById('score-overlay');
  if (!overlay || !gameState || gameState.over) return;
  // Pause overlay takes priority
  const pauseEl = document.getElementById('pause-overlay');
  if (pauseEl && pauseEl.style.display === 'flex') return;

  const gs = gameState;
  // viewerIdx: which player opened the scoreboard (-1 = keyboard P1, or _playerIdx)
  const viewer = viewerIdx ?? 0;

  // Build score header — all teams sorted descending by kills, each in their team color
  const teamsSorted = [...gs.teamIds].sort((a, b) => (gs.teamKills[b] ?? 0) - (gs.teamKills[a] ?? 0));
  const sep = `<span style="color:rgba(255,255,255,0.25);font-size:0.5em;vertical-align:middle;margin:0 10px">—</span>`;
  document.getElementById('score-overlay-teams').innerHTML = teamsSorted.map(tid => {
    const tc = TEAM_COLORS[tid] || TEAM_COLORS[0];
    return `<span style="color:${tc.color}">${gs.teamKills[tid] ?? 0}</span>`;
  }).join(sep);
  document.getElementById('score-overlay-limit').textContent =
    `FIRST TO ${gs.maxKills} KILLS WINS`;

  const allChars = [...new Set([...(gs.players ?? [gs.player]), ...gs.enemies])].filter(c => c);
  allChars.sort((a, b) => ((b.kills||0)*3 + (b.assists||0) - (b.deaths||0)) -
                           ((a.kills||0)*3 + (a.assists||0) - (a.deaths||0)));
  const showMaelstromCol = (gs._maelstromKillCount || 0) > 0;
  const rows = allChars.filter(c => c?.hero).map(c => {
    const k = c.kills||0, a = c.assists||0, d = c.deaths||0;
    const kda = d === 0 ? '—' : ((k + a * 0.5) / d).toFixed(1);
    const isPlayer = c.isPlayer;
    const teamCol  = (TEAM_COLORS[c.teamId ?? 0] || TEAM_COLORS[0]).color;
    const teamName = (TEAM_COLORS[c.teamId ?? 0] || TEAM_COLORS[0]).name;
    const heroColor = c.hero?.color || '#fff';
    const heroName  = c.hero?.name  || '?';
    const isViewer = isPlayer && (c._playerIdx ?? 0) === viewer;
    const playerLabel = isPlayer
      ? isViewer
        ? `<span style="color:#ffffff;font-size:0.8em;margin-left:4px;font-weight:900">(YOU)</span>`
        : `<span style="color:${PLAYER_COLORS[c._playerIdx]??'#ffee44'};font-size:0.8em;margin-left:4px">P${(c._playerIdx??0)+1}</span>`
      : '';
    return `<tr class="${isViewer ? 'is-player' : ''}">
      <td><div class="wsb-hero">
        <div class="wsb-dot" style="background:${heroColor}"></div>
        <span style="color:${heroColor}">${heroName}</span>
        ${playerLabel}
      </div></td>
      <td style="color:${teamCol};font-weight:700;font-size:0.8em;letter-spacing:1px;white-space:nowrap">${teamName}</td>
      <td class="wsb-kills">${k}</td>
      <td class="wsb-assists">${a}</td>
      <td class="wsb-deaths">${d}</td>
      <td>${kda}</td>
      ${showMaelstromCol ? `<td style="color:${(c.maelstromDeaths||0)>0?'#ffffff':'rgba(255,255,255,0.2)'};text-align:center">${(c.maelstromDeaths||0)>0?'☄ '+c.maelstromDeaths:'—'}</td>` : ''}
    </tr>`;
  }).join('');

  document.getElementById('score-overlay-table-wrap').innerHTML =
    `<table class="win-scoreboard">
      <thead><tr>
        <th>HERO</th><th>TEAM</th><th>KILLS</th><th>ASSISTS</th><th>DEATHS</th><th>KDA</th>
        ${showMaelstromCol ? '<th style="color:#ffffff;opacity:0.7">☄</th>' : ''}
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

  overlay.style.display = 'flex';
}

function hideScoreOverlay() {
  const overlay = document.getElementById('score-overlay');
  if (overlay) overlay.style.display = 'none';
}

function toggleScoreOverlay(viewerIdx) {
  const overlay = document.getElementById('score-overlay');
  if (!overlay) return;
  if (overlay.style.display === 'flex') {
    hideScoreOverlay();
  } else {
    showScoreOverlay(viewerIdx);
  }
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
    {key:'q',           label:'Ability 1'},
    {key:'e',           label:'Ability 2'},
    {key:'r',           label:'Ultimate'},
    {key:'sprint',      label:'Sprint'},
    {key:'special',     label:'Special'},
    {key:'rockbuster',  label:'Rock Buster'},
    {key:'pause',       label:'Pause'},
    {key:'cycleTarget', label:'Cycle Target'},
    {key:'scoreboard',  label:'Scoreboard'},
  ];

  const CTRL_ACTIONS = [
    {key:'q',           label:'Ability 1'},
    {key:'e',           label:'Ability 2'},
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
    const couchOn = document.body.classList.contains('couch-mode');
    return `
    <div style="border-radius:8px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;margin-bottom:24px;">

      <div style="padding:16px;background:rgba(255,255,255,0.03);border-bottom:1px solid rgba(255,255,255,0.06);">
        <div style="font-size:var(--fs-xs);color:var(--accent);letter-spacing:1px;margin-bottom:4px;">GRAPHICS</div>
        <div style="font-size:10px;color:var(--muted);">Resolution scaling, particle density, and performance options — coming soon.</div>
      </div>

      <div style="padding:16px;background:rgba(0,0,0,0.15);border-bottom:1px solid rgba(255,255,255,0.06);">
        <div style="font-size:var(--fs-xs);color:var(--accent);letter-spacing:1px;margin-bottom:8px;">COUCH MODE</div>
        <div style="font-size:10px;color:var(--muted);line-height:1.6;margin-bottom:12px;">
          Scales up hero names, lobby text, and UI elements for comfortable viewing on a TV from a distance.
        </div>
        <button onclick="toggleCouchMode()" style="
          font-family:'Orbitron',monospace; font-size:11px; font-weight:700; letter-spacing:1.5px;
          padding:8px 20px; border-radius:20px; cursor:pointer;
          border:1px solid ${couchOn ? 'rgba(68,255,136,0.6)' : 'rgba(255,255,255,0.2)'};
          background:${couchOn ? 'rgba(68,255,136,0.12)' : 'rgba(255,255,255,0.03)'};
          color:${couchOn ? '#44ff88' : 'rgba(255,255,255,0.5)'};
        ">COUCH MODE: ${couchOn ? 'ON' : 'OFF'}</button>
      </div>

      <div style="padding:16px;background:rgba(255,255,255,0.02);border-bottom:1px solid rgba(255,255,255,0.06);">
        <div style="font-size:var(--fs-xs);color:var(--accent);letter-spacing:1px;margin-bottom:8px;">TOUCH LAYOUT</div>
        <div style="font-size:10px;color:var(--muted);line-height:1.6;margin-bottom:12px;">
          Drag each button to where it feels best on your screen. Changes save automatically per device. You can also long-press the game arena to enter edit mode.
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button onclick="openTouchLayoutTest()" style="
            font-family:'Orbitron',monospace; font-size:11px; font-weight:700; letter-spacing:1.5px;
            padding:8px 20px; border-radius:20px; cursor:pointer;
            border:1px solid rgba(255,220,50,0.5); background:rgba(255,220,50,0.08); color:#ffdc32;
          ">EDIT TOUCH LAYOUT</button>
          <button onclick="resetTouchLayout()" style="
            font-family:'Orbitron',monospace; font-size:11px; font-weight:700; letter-spacing:1.5px;
            padding:8px 20px; border-radius:20px; cursor:pointer;
            border:1px solid rgba(255,80,80,0.4); background:rgba(255,80,80,0.06); color:#ff8080;
          ">RESET TO DEFAULT</button>
        </div>
      </div>

      <div style="padding:16px;background:rgba(255,255,255,0.02);border-bottom:1px solid rgba(255,255,255,0.06);">
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
  function buildPatchNotesTab(container) {
    const notes = [
      {
        v: 'v0.5.160', date: '2026-03-20',
        title: 'Safe-area fix — controls and overlays no longer clipped',
        changes: [
          { tag: 'FIX', text: 'Removed safe-area padding from #app — it was shrinking the layout container while absolute-positioned children (canvas, controls) still sized to the full viewport, causing clipping.' },
          { tag: 'FIX', text: 'Safe-area now applied to .screen:not(#game) so all non-game screens (menu, hero select etc) respect notch/home bar.' },
          { tag: 'FIX', text: 'Controls (#controls, p2/p3/p4) get explicit safe-area bottom/top padding so joystick always clears the home indicator bar.' },
          { tag: 'FIX', text: 'Welcome overlay (#launch-tip) gets safe-area padding so LET\'S GO button is never clipped.' },
          { tag: 'FIX', text: 'Game top buttons (PAUSE/SCOREBOARD) restore safe-area-inset-top for notch clearance.' },
        ]
      },
      {
        v: 'v0.5.159', date: '2026-03-20',
        title: 'Platform-agnostic layout — works on any device',
        changes: [
          { tag: 'FIX', text: 'Ripped out all orientation:landscape media queries and dvh hacks. Layout is now platform-agnostic: menus scale via vmin/clamp, safe-area insets applied once on #app and inherited everywhere, game canvas always fills the screen via the existing JS resize handler.' },
          { tag: 'FIX', text: 'Version stamp now always visible — rendered as a proper DOM element positioned bottom-right of menu, populated from CURRENT_VERSION constant.' },
          { tag: 'FIX', text: 'Welcome overlay now uses max-height:90svh + overflow-y:auto — scrollable at any screen size with no layout hacks needed.' },
          { tag: 'FIX', text: 'Removed 15+ scattered env(safe-area-inset-*) rules from individual elements. One rule on #app covers all screens.' },
        ]
      },
      {
        v: 'v0.5.158', date: '2026-03-20',
        title: 'Fluid mobile landscape layout — works across all phone sizes',
        changes: [
          { tag: 'FIX', text: 'Replaced brittle max-height:520px breakpoint with orientation:landscape + max-width:1024px query. Now fires on any phone in landscape regardless of exact viewport height — iPhone SE, Pro, Pro Max, all covered. Menu logo and buttons now use dvh units so they scale proportionally to whatever height the device actually has. Desktop unaffected (1024px+ guard).' },
        ]
      },
      {
        v: 'v0.5.157', date: '2026-03-20',
        title: 'iOS landscape layout fix',
        changes: [
          { tag: 'FIX', text: 'Landscape menu layout now handles 480px WebView height correctly. Web Inspector confirmed window.innerHeight=480 on iPhone via Capacitor. Raised landscape media query threshold from 500→520px, tightened button padding and logo size so all menu items fit without scrolling. Removed portrait rotation fallback (device was correctly in landscape already).' },
        ]
      },
      {
        v: 'v0.5.155', date: '2026-03-20',
        title: 'iOS landscape orientation fix',
        changes: [
          { tag: 'FIX', text: 'Added CSS portrait rotation fallback — when device is in portrait orientation on mobile, the entire page rotates 90° to landscape. This is a safety net for when Info.plist orientation lock is not in effect (PWA, browser). The real fix for Capacitor is ensuring Info.plist has UISupportedInterfaceOrientations set to landscape-only and the Xcode General → Deployment Info → Device Orientation checkboxes match.' },
        ]
      },
      {
        v: 'v0.5.154', date: '2026-03-20',
        title: 'Scoreboard polish',
        changes: [
          { tag: 'FIX', text: 'Button label restored to SCOREBOARD (was incorrectly changed to SCORES).' },
          { tag: 'FIX', text: 'Clicking anywhere on the scoreboard overlay now dismisses it.' },
          { tag: 'FIX', text: 'PAUSE and SCOREBOARD buttons now render above the scoreboard overlay (z-index raised to 31). Always accessible while scoreboard is open.' },
        ]
      },
      {
        v: 'v0.5.153', date: '2026-03-20',
        title: 'Spectator SCORES button — toggle fix + position fix',
        changes: [
          { tag: 'FIX', text: 'SCORES button now toggles the scoreboard overlay on/off. Previously all buttons called showScoreOverlay() — clicking again had no effect. Added toggleScoreOverlay() and wired all three score buttons to it.' },
          { tag: 'FIX', text: 'SCORES button moved directly below the PAUSE button in the top-right corner. No longer in the spectator panel at the bottom or conflicting with the timer.' },
        ]
      },
      {
        v: 'v0.5.151', date: '2026-03-20',
        title: 'Spectator scoreboard button position fix',
        changes: [
          { tag: 'FIX', text: 'Spectator mode: top-center SCOREBOARD button hidden (was overlapping the match timer). The SCORES button in the spectator panel at the bottom is now the primary scoreboard access in spectator — made more prominent and stacked below the navigation hint.' },
        ]
      },
      {
        v: 'v0.5.150', date: '2026-03-20',
        title: 'Spectator cursor + end match fixes',
        changes: [
          { tag: 'FIX', text: 'Spectator mode: cursor is now visible. Added CSS override so spectator-mode un-hides the cursor that game screen normally suppresses. Also guarded togglePause from hiding cursor while spectating.' },
          { tag: 'FIX', text: 'END MATCH: now calls the real endGame() sequence (overlay animation → greyscale → win screen) instead of abruptly setting gs.over. Determines winning team by current kill lead. Same flow as a natural match end.' },
        ]
      },
      {
        v: 'v0.5.149', date: '2026-03-20',
        title: 'Polish pass — 9 items',
        changes: [
          { tag: 'FEATURE', text: 'Pause menu: END MATCH button ends the current match to the summary screen without quitting to menu.' },
          { tag: 'FIX', text: 'Spectator mode: SCORES button now always visible, not hidden behind touch-mode check.' },
          { tag: 'FIX', text: 'AI storm avoidance: normal/easy bots now only avoid blackhole/maelstrom (genuinely dangerous). All other storms they get caught in naturally like players do. Hard bots still avoid high-negative zones but with a tighter margin.' },
          { tag: 'FIX', text: 'AI edge spamming: wall push margin reduced from 280px to 160px. Additive wallPush on flee movement vectors removed — was causing oscillation/direction fighting at edges. Center pull now handles edge avoidance cleanly.' },
          { tag: 'FIX', text: 'Mobile landscape: controls scaled down 25% in landscape to stop squishing the canvas viewport.' },
          { tag: 'FIX', text: 'Hero select: clicking a hero with your cursor now overrides a locked selection. Lets players change their mind after locking in.' },
          { tag: 'FIX', text: 'Controller pause: togglePause now reads gamePaused flag instead of DOM display state. Fixes intermittent failure to open on first press.' },
          { tag: 'VFX', text: 'All 6 base storms now have distinct visual signatures: Heatwave rising heat columns, Blizzard orbiting snowflake crystals, Thunderstorm electric arc bolts, Downpour falling rain streaks + ripple rings, Sandstorm dense orbiting grain particles, Blackhole inward triangles + lensing ring. Seismic Charge combo also gets a unique shockwave renderer.' },
          { tag: 'TUNING', text: 'Default kill limit changed from 5 to 10.' },
        ]
      },
      {
        v: 'v0.5.148', date: '2026-03-20',
        title: 'Balance pass — sim-verified across 18,000 fights',
        changes: [
          { tag: 'BALANCE', text: 'Global HP +12% (all heroes). HP scale raised from 450–1100 to 504–1232 real HP. Extends average TTK from ~7s toward ~10s — fights have more decision time.' },
          { tag: 'BALANCE', text: 'Melee ability in-range bonus reduced from +20% to +8%. Proximity is the melee advantage, not free damage on top of everything else.' },
          { tag: 'BALANCE', text: 'Hybrid auto-attack multiplier raised from 0.55 to 0.75. TIDE, GALE, and VOID all had near-zero sustained DPS — hybrids can fight now.' },
          { tag: 'BALANCE', text: 'STONE: defense raw 58→50 (36%→32% DR), armorPen raw 52→35 (was shredding light heroes to near-zero defense), Rock Charge cd 3.5→5.5s, all stun durations shortened (Q 1.0→0.7s, E 1.0→0.8s, R 1.8→1.4s). Was 99% WR across the board.' },
          { tag: 'BALANCE', text: 'VOID: hp raw 52→62, defense raw 30→38. Eclipse Mute damage 55→70. Needs to burst harder in his silence window to compensate for CC that doesn\'t stop movement.' },
          { tag: 'BALANCE', text: 'EMBER: abilityPower raw 80→86. Assassin window needs to actually threaten a kill.' },
          { tag: 'BALANCE', text: 'VOLT: abilityPower raw 62→72. Chain-shot hero needs more per shot to justify the positioning requirement.' },
          { tag: 'BALANCE', text: 'FROST: Ice Shard damage 32→42, atkSpeed raw 52→60. More poke pressure — was locking targets down with no kill potential. Glacial Prison root 2.0→1.6s.' },
          { tag: 'BALANCE', text: 'FORGE: Mag Lunge cd 4.5→3.5s, range 210→280. Gap closer was too unreliable against kiting ranged heroes.' },
          { tag: 'BALANCE', text: 'FLORA: Vine Snare root 2.2→1.6s, Ancient Wrath root 3.0→2.2s. Ranged root at full range was an oppressive free kill setup.' },
        ]
      },
      {
        v: 'v0.5.147', date: '2026-03-19',
        title: 'Hero descriptions rewritten',
        changes: [
          { tag: 'UI', text: 'All 10 hero bios rewritten — direct, confident gamer voice. No more comma-separated action lists or hedge phrases. Every description tells you what the hero feels like to play and fight against.' },
          { tag: 'UI', text: 'All 30 ability descriptions rewritten — each one tells you what to do with it, not just what it does. Passive descriptions also updated.' },
        ]
      },
      {
        v: 'v0.5.146', date: '2026-03-19',
        title: 'HTP storm descriptions updated',
        changes: [
          { tag: 'UI', text: 'How To Play storm cards updated to reflect all new mechanics: Heatwave kill burst, Blizzard first-hit, Thunderstorm chain, Downpour lifesteal, Sandstorm melee surge, Firestorm fire trail, Supercell pierce. Intro blurb updated for pill badges and screen flash.' },
        ]
      },
      {
        v: 'v0.5.145', date: '2026-03-19',
        title: 'Storm buff overhaul — all base storms and weak combos',
        changes: [
          { tag: 'GAMEPLAY', text: 'HEATWAVE: killing inside the zone triggers a 1.8× speed burst (1.2s) and heals 40% max HP. Fight to snowball.' },
          { tag: 'GAMEPLAY', text: 'BLIZZARD: your first hit every 5 seconds deals ×1.8 damage — patience is rewarded with a punishing empowered strike.' },
          { tag: 'GAMEPLAY', text: 'THUNDERSTORM: ability hits arc 35% damage to the nearest other enemy. Chain lightning, effectively.' },
          { tag: 'GAMEPLAY', text: 'DOWNPOUR: healing reduced to 8HP/s but now grants 25% lifesteal on damage dealt — stay aggressive to stay healthy.' },
          { tag: 'GAMEPLAY', text: 'SANDSTORM: range still collapses but close-range damage surges ×1.65 — melee heroes own this zone now.' },
          { tag: 'GAMEPLAY', text: 'FIRESTORM: movement now leaves burning trail hazards (18 DPS, 2.2s lifetime). Speed matters for map control.' },
          { tag: 'GAMEPLAY', text: 'SUPERCELL: projectiles now pierce and deal 75% damage to the nearest second target within 180px.' },
        ]
      },
      {
        v: 'v0.5.144', date: '2026-03-19',
        title: 'Storm buff pizzaz — pill badges + entry flash',
        changes: [
          { tag: 'VFX', text: 'Active storm buff labels replaced with glowing pill badges — dark background, colored border glow, gentle bob animation. Pulse intensifies with zone intensity.' },
          { tag: 'VFX', text: 'Zone entry now triggers a vignette-style screen edge flash in the storm\'s color, plus a larger icon + name float text. Combo storm entries are bigger than normal zone entries.' },
        ]
      },
      {
        v: 'v0.5.143', date: '2026-03-19',
        title: 'Tutorial checklist — mobile friendly',
        changes: [
          { tag: 'UI', text: 'Tutorial HUD refactored from inline styles to CSS class. On touch/small screens it moves to a top-center strip instead of left sidebar — no longer overlaps controls. Font sizes fixed from tiny vw-based values to readable flat px.' },
        ]
      },
      {
        v: 'v0.5.142', date: '2026-03-19',
        title: 'Fix CHANGE ELEMENT lobby persistence',
        changes: [
          { tag: 'FIX', text: 'CHANGE ELEMENT now properly retains player count, CPU slots, team assignments, and match settings. Root cause: goToRematchLobby was calling showScreen() which always resets lobbySlots. Now bypasses the reset and rebuilds the lobby UI directly from the preserved state.' },
        ]
      },
      {
        v: 'v0.5.141', date: '2026-03-19',
        title: 'Post-game lobby persistence',
        changes: [
          { tag: 'UI', text: 'CHANGE ELEMENT now returns to hero-select with player count, CPU count, and match settings preserved — players just repick their hero. No more reconfiguring the whole lobby after every match.' },
          { tag: 'UI', text: 'MENU and QUIT TO MENU both do a full reset — next session starts fresh from the default 2-player config.' },
        ]
      },
      {
        v: 'v0.5.140', date: '2026-03-19',
        title: 'Maelstrom color overhaul + smarter bot rock busting',
        changes: [
          { tag: 'VFX', text: 'Maelstrom accretion disk: pastel lavender blobs replaced with white-hot, deep orange, hot red, and deep violet. Lensing rings go from soft lilac to deep violet. Matter streams from pastel purple to dark violet. Photon ring flips from pastel pink to gold-orange.' },
          { tag: 'AI', text: 'Bots now persist on a rock target until it is dead — no more single-shot-and-forget. Hard difficulty hunts large rocks proactively when below 50% HP even outside flee state. Wounded rock bonus encourages finishing the job. Scoring weights doubled.' },
        ]
      },
      {
        v: 'v0.5.139', date: '2026-03-19',
        title: 'Storm renderer perf — eliminate Math.random() per frame',
        changes: [
          { tag: 'PERF', text: 'Plasma Storm and Supercell bolt jitter replaced with deterministic sin/cos-based offsets — eliminates Math.random() calls in per-frame draw loops. Visual result is identical.' },
        ]
      },
      {
        v: 'v0.5.138', date: '2026-03-19',
        title: 'Unique visual effects for all combo storms',
        changes: [
          { tag: 'VFX', text: 'Every combo storm now has a unique renderer matching its identity: Plasma Storm (fast bolts + electric orbit), Firestorm (fast spiral arms + embers), Flashpoint (detonation pulse ring), Supercell (sharp jagged lightning + fast rings), Whiteout (crystalline rings + freeze flash), Arctic Gale (high-speed 4-arm spiral + chaotic sparks), Dust Devil (chunky debris spiral), Magma Surge (slow lava blobs + heavy pulse), Permafrost (slow heavy rings + ice crystal shards).' },
          { tag: 'VFX', text: 'Singularity (blackhole + any) gets its own renderer: dark void, slow inward spiral arms, oppressive black core with faint purple photon ring. Noticeably darker and heavier than regular combo storms.' },
        ]
      },
      {
        v: 'v0.5.137', date: '2026-03-19',
        title: 'P1 sprint/special/rockbuster labels match P2/P3/P4',
        changes: [
          { tag: 'FIX', text: 'Removed inline font-size and color from P1 sprint/special/rockbuster ab-name labels — now uses CSS class exactly like P2/P3/P4.' },
        ]
      },
      {
        v: 'v0.5.136', date: '2026-03-19',
        title: 'P1 button text colors — all gold',
        changes: [
          { tag: 'FIX', text: 'P1 sprint/special/rockbuster button text was orange (#ff8c00, #ff9933) — changed to gold (#ffee44) to match the player theme. Gamepad Y and B labels also updated to gold.' },
        ]
      },
      {
        v: 'v0.5.135', date: '2026-03-19',
        title: 'Player button backgrounds — all ability buttons tinted',
        changes: [
          { tag: 'FIX', text: 'Ability buttons (Q/E/R) now get player-colored backgrounds, not just borders. All 4 players fully consistent: P1 gold, P2 cyan, P3 orange, P4 lime on every button.' },
        ]
      },
      {
        v: 'v0.5.134', date: '2026-03-19',
        title: 'P1 always gold — matches other players',
        changes: [
          { tag: 'FIX', text: 'P1 buttons are now always gold regardless of solo/MP mode — same approach as P2 cyan, P3 orange, P4 lime. No more mode gates on P1 colors.' },
        ]
      },
      {
        v: 'v0.5.133', date: '2026-03-19',
        title: 'Player button themes — all 4 players consistent',
        changes: [
          { tag: 'FIX', text: 'All sprint/special/rockbuster buttons now correctly themed per player in MP mode. Solo default colors gated with :not(.mp-mode). P1 gold, P2 cyan, P3 orange, P4 lime applied to backgrounds and borders across all button types.' },
        ]
      },
      {
        v: 'v0.5.132', date: '2026-03-19',
        title: 'P1 button colors fixed + text scaling',
        changes: [
          { tag: 'FIX', text: 'Removed all inline border-color/background from sprint/special/rockbuster buttons across P1-P4. Solo default colors now CSS-driven; MP mode gold/cyan/orange/lime tints apply cleanly.' },
          { tag: 'FIX', text: 'Ability button name font scales with button size: clamp(8px, ctrl-sz * 0.105, 12px). ROCK BUSTER and other long names now fit inside the circle at any button size.' },
        ]
      },
      {
        v: 'v0.5.131', date: '2026-03-19',
        title: 'Target panes pinned to controls + P1 gold backgrounds',
        changes: [
          { tag: 'FIX', text: 'Target panes (P1/P2/P3/P4 TARGET) moved inside their respective controls divs — now use position:absolute bottom/top:100% to pin directly above/below controls at any window size.' },
          { tag: 'FIX', text: 'P1 sprint/special/rockbuster inline background colors removed so CSS gold theme can apply correctly in MP mode. All 4 players now consistently themed.' },
        ]
      },
      {
        v: 'v0.5.130', date: '2026-03-19',
        title: 'P1 gold theme + 4-player pause removed',
        changes: [
          { tag: 'FIX', text: 'P1 ability buttons now use gold theme in MP mode — matching P2 cyan, P3 orange, P4 lime. Sprint/special/rockbuster borders also updated to gold.' },
          { tag: 'UI', text: 'PAUSE button hidden in 4-player mode — screen real estate is tight with 4 control clusters, and any player can pause via controller Start button.' },
          { tag: 'FIX', text: 'Target frames (P1/P2/P3/P4 TARGET) now anchored with calc(ctrl-sz) so they stay above controls at any window size.' },
          { tag: 'FIX', text: 'Ability button names allow 2-line wrap at 11px — less truncation.' },
        ]
      },
      {
        v: 'v0.5.129', date: '2026-03-19',
        title: 'Performance sweep — storms and obstacle collisions',
        changes: [
          { tag: 'PERF', text: 'Maelstrom accretion disk: 80 individual draw calls reduced to 5 batched calls (grouped by color). Particle count 80→48. Estimated 15x fewer ctx.arc/fill ops per frame while Maelstrom is active.' },
          { tag: 'PERF', text: 'Maelstrom lensing rings: removed 5 save/restore pairs per frame. Matter stream gradients replaced with solid color (createLinearGradient × 8 per frame → 0).' },
          { tag: 'PERF', text: 'Maelstrom outer field and core gradients now cached on the zone object — only recreated when position changes by 4+ pixels.' },
          { tag: 'PERF', text: 'Combo zone (merged storm) radial gradient also cached.' },
          { tag: 'PERF', text: 'Weather zone list building: replaced 3 filter() array allocations per frame with a single manual loop.' },
          { tag: 'PERF', text: 'Obstacle-character collision: converted for...of to indexed reverse loop, eliminating O(n) indexOf search when obstacles are destroyed.' },
        ]
      },
      {
        v: 'v0.5.128', date: '2026-03-19',
        title: 'Dev safety net — keyboard setup verification',
        changes: [
          { tag: 'DEV', text: 'Added runtime check: 1 second after match start, verifies setupKeyboard() was called. If missing, prints a loud red console error identifying exactly what happened and where to fix it.' },
        ]
      },
      {
        v: 'v0.5.127', date: '2026-03-19',
        title: 'Fix keyboard input — setupKeyboard() restored',
        changes: [
          { tag: 'FIX', text: 'setupKeyboard() was accidentally dropped from initGame() during an earlier str_replace. Keyboard input now works again in all matches.' },
        ]
      },
      {
        v: 'v0.5.126', date: '2026-03-19',
        title: 'Fix keyboard regression + layout editor separation',
        changes: [
          { tag: 'FIX', text: 'Keyboard input restored — layout editor no longer applies position:fixed to buttons at match start. applyTouchLayoutIfNeeded removed from match start, moved to touch input mode activation only.' },
          { tag: 'FIX', text: 'Edit Touch Layout now opens a safe preview (game screen without a live match) — DONE returns to Options. No more accidental fixed positioning leaking into real matches.' },
          { tag: 'FIX', text: 'Landscape welcome overlay reverts to clean vertical compression — removes broken flex-row layout that was causing misalignment.' },
        ]
      },
      {
        v: 'v0.5.125', date: '2026-03-19',
        title: 'Fix keyboard regression from touch layout editor',
        changes: [
          { tag: 'FIX', text: 'Touch layout editor was applying position:fixed to all buttons unconditionally at match start, breaking keyboard and gamepad control layouts. _applyLayout() now guards on touch-mode class. Switching input mode clears fixed positioning and restores normal flow.' },
        ]
      },
      {
        v: 'v0.5.124', date: '2026-03-19',
        title: 'Movable touch controls + layout editor',
        changes: [
          { tag: 'FEATURE', text: 'Touch Layout Editor: drag any individual button (joystick, Q/E/R, Sprint, Special, Rock Buster) to wherever it feels right on your screen. Positions saved as % of screen size — works across all resolutions. Access via Options → Display → EDIT TOUCH LAYOUT, or long-press (600ms) on the game arena.' },
          { tag: 'FEATURE', text: 'RESET button restores all controls to defaults. DONE saves and exits.' },
          { tag: 'FIX', text: 'Hero select lobby column clipping on left — increased left padding in landscape media query.' },
        ]
      },
      {
        v: 'v0.5.123', date: '2026-03-19',
        title: 'Controls safe area — guaranteed bottom clearance',
        changes: [
          { tag: 'FIX', text: 'Controls padding-bottom now uses max(34px, safe-area-inset-bottom + 20px) — 34px hardcoded minimum covers iPhone home indicator bar even if env() vars not available in Capacitor WKWebView.' },
          { tag: 'FIX', text: 'Removed broken #hud padding (element does not exist in DOM).' },
        ]
      },
      {
        v: 'v0.5.122', date: '2026-03-19',
        title: 'Dynamic viewport — no black bars on any screen size',
        changes: [
          { tag: 'FIX', text: 'VIEW_W is now dynamic — calculated from the screen aspect ratio at resize time, keeping VIEW_H fixed at 900. On a phone in landscape (wider aspect), you see more of the arena horizontally. No black bars, no clipping. Works on any device.' },
          { tag: 'FIX', text: 'Desktop/couch unaffected — 16:9 screens still get VIEW_W≈1600 as before.' },
          { tag: 'FIX', text: 'HUD safe area uses padding (not inset positioning) so canvas stays full-bleed while controls clear the notch.' },
          { tag: 'FIX', text: 'Game screen excluded from screen-level safe area padding — canvas always fills the display.' },
        ]
      },
      {
        v: 'v0.5.121', date: '2026-03-19',
        title: 'iOS — fill-screen gameplay, hero select notch fix',
        changes: [
          { tag: 'FIX', text: 'Game canvas now uses fill-screen scaling on mobile (sh<600px) — scales to fill width instead of letterboxing. Eliminates black bars on iPhone landscape.' },
          { tag: 'FIX', text: 'Hero select topbar and body now respect safe-area-inset-left/right in landscape — lobby column no longer hidden behind Dynamic Island.' },
          { tag: 'FIX', text: 'screen-topbar (Options, How To Play etc) also gets notch padding in landscape.' },
        ]
      },
      {
        v: 'v0.5.120', date: '2026-03-19',
        title: 'iOS landscape fixes — menu, overlay, HUD safe areas',
        changes: [
          { tag: 'FIX', text: 'Main menu switches to horizontal layout in landscape — logo left, buttons right. Logo shrinks to 28px so nothing clips.' },
          { tag: 'FIX', text: 'Welcome overlay compresses into a compact horizontal layout in landscape so the dismiss button is always reachable.' },
          { tag: 'FIX', text: 'HUD now respects safe-area-inset on all sides — controls no longer hide behind the Dynamic Island notch.' },
          { tag: 'FIX', text: 'Canvas reverted to innerWidth/Height — visualViewport was causing black bars on iPhone.' },
        ]
      },
      {
        v: 'v0.5.119', date: '2026-03-19',
        title: 'iOS mobile fixes — safe areas, logo, canvas',
        changes: [
          { tag: 'FIX', text: 'Menu screen now respects safe-area-inset-left/right/bottom in landscape — fixes content hiding behind Dynamic Island notch on iPhone.' },
          { tag: 'FIX', text: 'All screens get safe-area padding in landscape via media query.' },
          { tag: 'FIX', text: 'Logo font-size capped at 32px in landscape mobile so it no longer clips.' },
          { tag: 'FIX', text: 'Canvas resizing now uses window.visualViewport when available for more accurate sizing on iOS.' },
        ]
      },
      {
        v: 'v0.5.118', date: '2026-03-19',
        title: 'Hero grid centering — fix vertical alignment',
        changes: [
          { tag: 'FIX', text: 'Removed align-items:center from scroll containers — was causing potential vertical centering issues. margin:0 auto on the grid itself handles horizontal centering correctly.' },
        ]
      },
      {
        v: 'v0.5.117', date: '2026-03-19',
        title: 'Hero grid — centered in all lobby screens',
        changes: [
          { tag: 'UI', text: 'Hero grid (hero select, element roster, tutorial) now centers within its scroll area at all window sizes. max-width:900px with margin:0 auto keeps cards in the middle — no more left-aligned cards with empty space on the right.' },
        ]
      },
      {
        v: 'v0.5.116', date: '2026-03-19',
        title: 'Couch Mode — larger hero cards on all lobby screens',
        changes: [
          { tag: 'UI', text: 'Couch Mode hero cards expanded from 70–100px to 160px wide on hero select, tutorial lobby, and element roster. Canvas bumped to 80px, hero name 20px with wider letter spacing. Landscape media query override added so cards stay large regardless of orientation.' },
        ]
      },
      {
        v: 'v0.5.115', date: '2026-03-19',
        title: 'Couch Mode — full coverage all screens',
        changes: [
          { tag: 'FEATURE', text: 'Couch Mode expanded to cover all screens: HOW TO PLAY (card titles/body/tips), OPTIONS (tabs, rebind table, key chips), MATCH SETTINGS (title, FF button, close), WIN SCREEN (subtitle, scoreboard rows/headers, stat values). Every readable element now has a couch-mode override.' },
        ]
      },
      {
        v: 'v0.5.114', date: '2026-03-19',
        title: 'Couch Mode — comprehensive audit and expansion',
        changes: [
          { tag: 'FEATURE', text: 'Couch Mode now covers every screen: hero grid cards (24px names, bigger canvases), lobby column (52px pill height, wider), match settings overlay (wider panel, larger all text), options screen (tabs, section titles), and how-to-play (18–20px body text). Full audit performed via live browser inspection.' },
        ]
      },
      {
        v: 'v0.5.113', date: '2026-03-19',
        title: 'Couch Mode',
        changes: [
          { tag: 'FEATURE', text: 'Couch Mode toggle added to Options → Display tab. Scales up hero names, lobby pills, column headers, match settings, and buttons for comfortable TV viewing from a distance.' },
          { tag: 'FEATURE', text: 'Couch Mode persists across sessions via localStorage.' },
        ]
      },
      {
        v: 'v0.5.112', date: '2026-03-19',
        title: 'Menu screen — reverted to single column',
        changes: [
          { tag: 'UI', text: 'Main menu reverted to original single column layout — logo centered, buttons below, no tagline. Two-column experiment removed.' },
        ]
      },
      {
        v: 'v0.5.111', date: '2026-03-19',
        title: 'Restore menu screen scaling from v0.5.107',
        changes: [
          { tag: 'FIX', text: 'Menu screen logo font restored to clamp(32px,6vw,88px) — was incorrectly flattened to 88px fixed. Mobile clamp also restored. All other UI font-size fixes from v0.5.110 remain.' },
        ]
      },
      {
        v: 'v0.5.110', date: '2026-03-19',
        title: 'Font sizes fixed — removed viewport-responsive scaling',
        changes: [
          { tag: 'FIX', text: 'Root cause found: a @media (max-width:520px) block was overriding base font sizes with larger values at small window widths. Font sizes now promoted out of the media query into base rules — text is consistent at all viewport widths.' },
          { tag: 'FIX', text: 'All remaining font-size clamp() values replaced with fixed px (the max of each clamp). --fs-* CSS variables also fixed. Spacing/layout clamps left unchanged.' },
        ]
      },
      {
        v: 'v0.5.107', date: '2026-03-19',
        title: 'Menu screen — two-column layout on wide screens',
        changes: [
          { tag: 'UI', text: 'Menu screen now uses a two-column layout on wide screens — large logo + tagline on the left, nav buttons on the right. Logo scales up to 88px on large displays. Reverts to centered single-column on mobile (<640px).' },
        ]
      },
      {
        v: 'v0.5.106', date: '2026-03-19',
        title: 'Maelstrom implode — rock blast and damage',
        changes: [
          { tag: 'FEATURE', text: 'Maelstrom implode now blasts all rocks outward with a force wave (320–600 velocity based on proximity). Deals 3–5 HP damage to each rock — edge rocks take 3, center rocks take 5. Low-health rocks get destroyed, triggering fragments and potential item drops.' },
        ]
      },
      {
        v: 'v0.5.105', date: '2026-03-19',
        title: 'Maelstrom tweaks — countdown offset + stronger rock pull',
        changes: [
          { tag: 'UI', text: 'Countdown offset reduced from 18% to 10% of radius — moved back up toward center.' },
          { tag: 'BALANCE', text: 'Rock gravity pull strength doubled from 55 to 120 — noticeably more chaotic.' },
        ]
      },
      {
        v: 'v0.5.104', date: '2026-03-19',
        title: 'Maelstrom countdown on top + rock gravity',
        changes: [
          { tag: 'FIX', text: 'Maelstrom countdown timer moved to drawWeatherZoneLabels — now renders above health packs, characters, and all world-space elements. No longer buried.' },
          { tag: 'UI', text: 'Countdown offset 18% below center so it clears the health pack that gets pulled to center. Brighter white fill, solid black stroke, larger font.' },
          { tag: 'FEATURE', text: 'Rocks now get a gentle gravitational nudge toward the Maelstrom center — proximity-scaled pull (stronger near core, faint at edge). Creates chaotic obstacle pile-up without forcing them in.' },
        ]
      },
      {
        v: 'v0.5.103', date: '2026-03-19',
        title: 'Performance sweep — canvas leak fix + per-frame optimizations',
        changes: [
          { tag: 'FIX', text: 'state.js: ctx.save/restore leak in drawWeatherZones — normal zone renderer had 2 ctx.save() calls but only 1 ctx.restore(). Was leaking one canvas context level per weather zone per frame. Fixed.' },
          { tag: 'PERF', text: 'Spectator overlay no longer rebuilds all DOM elements every frame — button structure only rebuilt on character change, cooldown numbers updated in-place.' },
          { tag: 'PERF', text: 'Target frame (tf-p1 through tf-p4), target-frame div, and weather-player-pill now cached on gs at match start — no more per-frame getElementById.' },
          { tag: 'PERF', text: 'Effects cleanup swapped from Array.filter() (new allocation every frame) to reverse-splice loop (zero allocation).' },
        ]
      },
      {
        v: 'v0.5.102', date: '2026-03-19',
        title: 'How To Play — refreshed for recent features',
        changes: [
          { tag: 'UI', text: 'Objective section updated to reflect stepper range (kills 5–100, time 1:00–10:00) and renamed Match Settings to Match Rules.' },
          { tag: 'UI', text: 'Couch Multiplayer updated: − count + pill, TYPE/TEAM column labels, 4-human cap, portrait badge colours.' },
          { tag: 'UI', text: 'Warp Gates section expanded with return warp mechanic — 1s window, same-gate return, pulsing ring visual.' },
          { tag: 'UI', text: 'Maelstrom tip updated: singularity/black hole description, 5s post-implode persist, convergence % colour coding (blue = normal, orange/red = maelstrom incoming). Touch tap-to-lock tip added.' },
        ]
      },
      {
        v: 'v0.5.101', date: '2026-03-19',
        title: 'Maelstrom — Singularity visual overhaul',
        changes: [
          { tag: 'VISUAL', text: 'Maelstrom completely rerendered as a black hole singularity: deep purple void, 80-particle accretion disk in orange/gold/white orbiting in a flat ellipse, 5 gravitational lensing rings, 8 curved matter streams being consumed, glowing photon ring, and absolute black event horizon. Countdown lives inside the core.' },
        ]
      },
      {
        v: 'v0.5.100', date: '2026-03-19',
        title: 'Fix warp return rings bleeding outside arena',
        changes: [
          { tag: 'FIX', text: 'Warp return window rings (cyan pulsing indicator) now clipped to arena bounds — were rendering below the arena on mobile when characters passed through gates.' },
        ]
      },
      {
        v: 'v0.5.99', date: '2026-03-19',
        title: 'Match settings — left-aligned steppers',
        changes: [
          { tag: 'UI', text: 'Kill and time steppers now left-aligned to match the rest of the settings panel.' },
        ]
      },
      {
        v: 'v0.5.98', date: '2026-03-19',
        title: 'Match settings — ∞ toggle is now a proper toggle',
        changes: [
          { tag: 'FIX', text: 'Tapping ∞ again when already active now deactivates it, reverting kills to 5 and time to 3:30. Was a one-way trip before.' },
        ]
      },
      {
        v: 'v0.5.97', date: '2026-03-19',
        title: 'Match settings — stepper controls for kills and time',
        changes: [
          { tag: 'UI', text: 'Kill limit now uses a − value + stepper (5 to 100, steps of 5) with a separate ∞ toggle. Pill grid removed.' },
          { tag: 'UI', text: 'Match time uses the same stepper pattern (1:00 to 10:00 across 8 steps) with a ∞ toggle. Clean and compact.' },
        ]
      },
      {
        v: 'v0.5.96', date: '2026-03-18',
        title: 'Touch: tap to lock target',
        changes: [
          { tag: 'FEATURE', text: 'Touch mode: tap an enemy to lock onto them (shows LOCKED float, uses player color). Tap empty space to clear lock. Fires immediately on touchend — no 300ms delay. Works per-player in MP.' },
        ]
      },
      {
        v: 'v0.5.95', date: '2026-03-18',
        title: 'Warp return mechanic + tutorial section 6',
        changes: [
          { tag: 'FEATURE', text: 'New warp return mechanic: warp through any gate and you have 1 second to cross back through any edge — you\'ll return through the exact same gate you used. A pulsing cyan ring + countdown arc shows the return window.' },
          { tag: 'FEATURE', text: 'After the return window expires, the normal warp cooldown begins.' },
          { tag: 'FEATURE', text: 'Tutorial section 6 added: WARP GATES — teaches warping through a gate and returning within 1s.' },
          { tag: 'AI', text: 'AI also benefits from the return mechanic — they can back-warp within the window using the same logic as players.' },
        ]
      },
      {
        v: 'v0.5.94', date: '2026-03-18',
        title: 'AI gate-aware shooting + natural storm behaviour',
        changes: [
          { tag: 'FIX', text: 'AI now uses safeAimDelta for auto-attacks — only fires through an edge if there is actually a warp gate at that position. No more shooting through solid walls.' },
          { tag: 'AI', text: 'Storm avoidance heavily reduced — easy/normal bots have zero repulsion and get caught in storms just like players. Hard bots only dodge truly dangerous zones (voidPull, maelstrom) and only when already inside them, not pre-emptively skirting the edge.' },
        ]
      },
      {
        v: 'v0.5.93', date: '2026-03-18',
        title: 'Maelstrom persists 5s after implode',
        changes: [
          { tag: 'BALANCE', text: 'Maelstrom zone now lingers for 5 seconds after imploding before fading out — zone stays active, effects still apply during that window.' },
        ]
      },
      {
        v: 'v0.5.92', date: '2026-03-18',
        title: 'Match settings — 4-wide pill rows with centered overflow',
        changes: [
          { tag: 'UI', text: 'Kill limit and match time pill rows now show 4 across, with any overflow (5th, 6th pill) centered on the row below — cleaner than a cramped 5 or 6 column grid.' },
        ]
      },
      {
        v: 'v0.5.91', date: '2026-03-18',
        title: 'Maelstrom % hidden on cooldown + whirlpool artifact fix',
        changes: [
          { tag: 'FIX', text: 'Maelstrom-warning convergence % (orange/red) hidden when maelstrom is still on its 90s cooldown — only shows when a maelstrom can actually form.' },
          { tag: 'FIX', text: 'Tide whirlpool (and all hazard zones) now clipped to arena bounds — spiral rings and gradient fills no longer bleed outside the world rect.' },
        ]
      },
      {
        v: 'v0.5.90', date: '2026-03-18',
        title: 'Convergence % on mega/combo storms',
        changes: [
          { tag: 'FIX', text: 'Convergence % indicator now shows when a converged storm (mega or combo) approaches any other active zone — was only tracking non-converged pairs.' },
          { tag: 'UI', text: 'Maelstrom-warning convergence % renders in orange→red instead of blue→white, making the threat visually distinct from a regular merge.' },
        ]
      },
      {
        v: 'v0.5.89', date: '2026-03-18',
        title: 'Lobby column max width capped at 300px',
        changes: [
          { tag: 'UI', text: 'Hero select lobby column capped at 300px — was 340px, which got too wide on larger screens.' },
        ]
      },
      {
        v: 'v0.5.88', date: '2026-03-18',
        title: 'Tutorial button on first-launch overlay',
        changes: [
          { tag: 'UI', text: 'TUTORIAL button added to the welcome overlay — spans full width below HOW TO PLAY and ELEMENT ROSTER, styled in gold to stand out as the recommended new player path.' },
        ]
      },
      {
        v: 'v0.5.87', date: '2026-03-18',
        title: 'Game Over sequence',
        changes: [
          { tag: 'FEATURE', text: 'New end-of-match sequence: VICTORY/DEFEAT/GAME OVER slams onto screen with a punch-in animation, canvas desaturates to greyscale over ~2.4s, then fades out into the scoreboard.' },
        ]
      },
      {
        v: 'v0.5.86', date: '2026-03-18',
        title: 'Damage floats — player-only',
        changes: [
          { tag: 'UI', text: 'Damage number floats now only appear when the player is the attacker or the target — CPU vs CPU combat no longer clutters the screen with numbers.' },
        ]
      },
      {
        v: 'v0.5.85', date: '2026-03-18',
        title: 'Match settings button renamed to MATCH RULES',
        changes: [
          { tag: 'UI', text: 'Settings button in hero select topbar renamed from SETTINGS to MATCH RULES — clearly scoped to the match, not global options.' },
        ]
      },
      {
        v: 'v0.5.84', date: '2026-03-18',
        title: 'Topbar restored + column headers fixed',
        changes: [
          { tag: 'UI', text: 'Topbar reverted to clean single row: BACK + SETTINGS left, title centered, READY right. Two-row layout was cluttered.' },
          { tag: 'FIX', text: 'TYPE/TEAM column headers now use the same flex structure as lslot-right (gap:10px, matching pill widths) — perfectly centered over their pills.' },
        ]
      },
      {
        v: 'v0.5.83', date: '2026-03-18',
        title: 'Hero select topbar — two-row layout',
        changes: [
          { tag: 'UI', text: 'Topbar split into two rows: BACK / MATCH SETTINGS / READY on row 1, CHOOSE YOUR ELEMENT centered on its own full-width row 2 — no more title competing with buttons.' },
          { tag: 'UI', text: 'TYPE and TEAM column headers now precisely aligned over their respective pills.' },
        ]
      },
      {
        v: 'v0.5.82', date: '2026-03-18',
        title: 'Type pill fixed width + spacing from team pill',
        changes: [
          { tag: 'UI', text: 'CPU/HUMAN pill now fixed width clamp(60px,6vw,72px) — CPU and HUMAN render identically sized.' },
          { tag: 'UI', text: 'Gap between type and team pills increased from 6px to 10px for cleaner separation.' },
          { tag: 'UI', text: 'TYPE/TEAM column headers each sized to match their respective pill widths.' },
        ]
      },
      {
        v: 'v0.5.81', date: '2026-03-18',
        title: 'Lobby team count label font bump',
        changes: [
          { tag: 'UI', text: 'Match label (1/1/1/1 team breakdown) in lobby column bumped from clamp(8px) to clamp(12px,1.3vw,14px) — clearly readable now.' },
        ]
      },
      {
        v: 'v0.5.80', date: '2026-03-18',
        title: 'Lobby column headers + count font fix',
        changes: [
          { tag: 'UI', text: 'TYPE and TEAM column headers added above lobby slots — players now know what each pill does without guessing.' },
          { tag: 'FIX', text: 'Player count font bumped to clamp(16px,1.8vw,22px) — was unreadably small.' },
        ]
      },
      {
        v: 'v0.5.79', date: '2026-03-18',
        title: 'Team color pill — wider, no text clipping',
        changes: [
          { tag: 'UI', text: 'Team pill widened to clamp(72px,7vw,88px) and white-space:nowrap added — YELLOW and ORANGE no longer clip outside the pill.' },
        ]
      },
      {
        v: 'v0.5.78', date: '2026-03-18',
        title: 'Team BLUE color propagation audit',
        changes: [
          { tag: 'FIX', text: 'Full audit of all team-blue color references across all source files. TEAM_COLORS[0] drives all team rings, score pills, win screen, and scoreboard automatically. Enemy kill ring effect updated from #4488ff to #1a4adb to match.' },
          { tag: 'NOTE', text: 'UI accent color (cyan #00d4ff via --accent) intentionally unchanged — that is the game chrome, not a team color.' },
        ]
      },
      {
        v: 'v0.5.77', date: '2026-03-18',
        title: 'Team color pill — fixed width',
        changes: [
          { tag: 'UI', text: 'Team color pill now has a fixed width so all names (BLUE, RED, GREEN, YELLOW, ORANGE, PURPLE) render the same size — no more YELLOW being wider than BLUE.' },
        ]
      },
      {
        v: 'v0.5.76', date: '2026-03-18',
        title: 'Team BLUE — deep blue color',
        changes: [
          { tag: 'UI', text: 'Team BLUE color changed from cyan (#00d4ff) to deep blue (#1a4adb) — clearly distinct from the P1 player color.' },
        ]
      },
      {
        v: 'v0.5.75', date: '2026-03-18',
        title: 'Lobby − count + fixed at top, 4 human player cap',
        changes: [
          { tag: 'UI', text: '− count + pill moved to top of lobby list — fixed position, never moves as players are added.' },
          { tag: 'FIX', text: 'Human player cap set to 4 — CPU pill grays out and stops responding when 4 humans are already set.' },
        ]
      },
      {
        v: 'v0.5.74', date: '2026-03-18',
        title: 'Lobby − count + pill restored',
        changes: [
          { tag: 'UI', text: 'Replaced per-slot × and separate add button with a clean − count + pill below the last player slot. − grays out at 2 players, + grays out at 6.' },
        ]
      },
      {
        v: 'v0.5.73', date: '2026-03-18',
        title: 'Player color indicators on lobby slots',
        changes: [
          { tag: 'UI', text: 'Portrait border now uses player color (P1=gold, P2=cyan, P3=orange, P4=lime) for human slots instead of team color.' },
          { tag: 'UI', text: 'P1/P2/P3/P4 badge overlaid on portrait bottom in matching player color with glow.' },
        ]
      },
      {
        v: 'v0.5.72', date: '2026-03-18',
        title: 'Remove grade cards from hero select',
        changes: [
          { tag: 'UI', text: 'Grade cards (HP/DEF/DMG) removed from element info panel in hero select. Element info section hidden entirely — hero grid takes all available space.' },
        ]
      },
      {
        v: 'v0.5.71', date: '2026-03-18',
        title: 'Lobby wider, hero cards smaller, no extended stats',
        changes: [
          { tag: 'UI', text: 'Lobby column widened to clamp(260px,30vw,340px) — slots no longer clip.' },
          { tag: 'UI', text: 'Hero cards shrunk to clamp(70px,12vw,100px) to compensate, canvas at 60%, name font tightened.' },
          { tag: 'UI', text: 'Extended stats removed from hero select detail panel — just the 3 core grade cards.' },
          { tag: 'UI', text: 'Class header padding tightened for better vertical density.' },
        ]
      },
      {
        v: 'v0.5.70', date: '2026-03-18',
        title: 'Lobby × delete fix + element info combat stats',
        changes: [
          { tag: 'FIX', text: '× remove button now correctly targets CPU slots (not locked/human slots) and is properly placed inside the slot right controls.' },
          { tag: 'UI', text: 'Element info panel now shows full combat stats (ability power, armor pen, crit, lifesteal, etc.) below the core 3 grade cards — uses the space that was blank.' },
          { tag: 'UI', text: 'Element info panel padding tightened in hero select context.' },
        ]
      },
      {
        v: 'v0.5.69', date: '2026-03-18',
        title: 'Lobby slots — pill controls, inline add/remove',
        changes: [
          { tag: 'UI', text: 'CPU/HUMAN toggle replaced with a single tappable pill — reads "CPU" (cyan) or "HUMAN" (green), tap to flip. Clearer than a trackless switch.' },
          { tag: 'UI', text: 'Team color pill now always shows the name ("BLUE", "RED", etc.) alongside the swatch — context fully restored.' },
          { tag: 'UI', text: '+ ADD PLAYER button moves inline below the last slot, shifts down as players are added. Old footer +/− removed.' },
          { tag: 'UI', text: '× remove button appears on each slot (when > 2 players), lets you remove any specific slot.' },
        ]
      },
      {
        v: 'v0.5.68', date: '2026-03-18',
        title: 'Lobby sidebar — condensed slot controls',
        changes: [
          { tag: 'FIX', text: 'CPU/HUMAN text labels hidden in sidebar mode — toggle track alone is clear enough, prevents clipping.' },
          { tag: 'FIX', text: 'Team name label hidden in sidebar — color swatch communicates team without text.' },
          { tag: 'UI', text: 'Lobby column width tuned to clamp(180px,20vw,240px) now that controls are condensed.' },
        ]
      },
      {
        v: 'v0.5.67', date: '2026-03-18',
        title: 'Hero select — lobby sidebar layout',
        changes: [
          { tag: 'UI', text: 'Lobby slots moved from bottom stack to a fixed left column alongside the element grid — landscape-optimized, no more scrolling past heroes to reach slots.' },
          { tag: 'UI', text: 'READY and MATCH SETTINGS moved into the topbar right side — always visible without a footer bar.' },
          { tag: 'UI', text: 'Team color pill now shows team name (BLUE, RED, GREEN etc.) instead of static "TEAM" label.' },
          { tag: 'UI', text: 'Lobby column always renders slots as a single column; player +/− control pinned to bottom of lobby column.' },
        ]
      },
      {
        v: 'v0.5.66', date: '2026-03-18',
        title: 'Hero select READY button always visible',
        changes: [
          { tag: 'FIX', text: 'READY button no longer scrolls off-screen when the window is small. Scrollable content is now wrapped in its own flex child; the action bar sits outside it as a fixed footer — always on screen regardless of window height.' },
        ]
      },
      {
        v: 'v0.5.65', date: '2026-03-18',
        title: 'Timer cluster moved to top-center',
        changes: [
          { tag: 'UI', text: 'Match timer, team kill pills, maelstrom countdown, and sudden death now sit top-center — opposite side from the SP kill feed at top-right.' },
        ]
      },
      {
        v: 'v0.5.64', date: '2026-03-18',
        title: 'Timer cluster + kill feed pinned to window bottom',
        changes: [
          { tag: 'FIX', text: 'Match timer, team kill pills, maelstrom countdown, and sudden death label now anchor to canvas.height (window bottom) and stack upward — no longer tied to viewport top.' },
          { tag: 'FIX', text: 'MP kill feed now pins to canvas.height bottom (window edge) instead of viewport bottom — consistent with timer cluster position.' },
        ]
      },
      {
        v: 'v0.5.63', date: '2026-03-18',
        title: 'Kill feed — MP bottom-center, SP top-right fix',
        changes: [
          { tag: 'FIX', text: 'Kill feed no longer drifts to centre of canvas on widescreen/letterboxed viewports — now uses offsetX/offsetY + vpW/vpH (same coordinate system as rest of HUD).' },
          { tag: 'UI', text: 'SP: kill feed stays top-right, pinned correctly to viewport right edge.' },
          { tag: 'UI', text: 'MP (2+ human players): kill feed moves to bottom-center, stacking upward — clear of the ability bars and less cluttered during couch play.' },
        ]
      },
      {
        v: 'v0.5.62', date: '2026-03-18',
        title: 'Mobile responsive audit pass',
        changes: [
          { tag: 'UI', text: 'Element roster detail page: role, desc, section title font sizes now use clamp() — were hardcoded 9–15px.' },
          { tag: 'FIX', text: 'Extended stats grid: fixed 120px label column replaced with minmax(80px,25%) — no longer overflows narrow screens. Grade/val columns hidden below 520px.' },
          { tag: 'UI', text: 'HTP cards: title, body, tip text and card padding now responsive with clamp(). Grid minmax lowered from 220px to min(200px,100%) so single-column always fits.' },
          { tag: 'UI', text: 'Spectator ability buttons: fixed 52/62/44px sizes replaced with clamp() scaling with vw.' },
          { tag: 'UI', text: 'Menu PLAY NOW/TUTORIAL buttons: min-width uses clamp() instead of hardcoded 200px.' },
          { tag: 'FIX', text: 'Launch tip overlay: tip-links collapses to single column below 420px; tip-footer wraps instead of clipping.' },
          { tag: 'UI', text: 'Win screen, HTP bind table: tighter padding at ≤520px via new entries in existing mobile breakpoint.' },
        ]
      },
      {
        v: 'v0.5.61', date: '2026-03-18',
        title: 'Tutorial — infinite match time, timer hidden',
        changes: [
          { tag: 'FIX', text: 'Tutorial match duration set to Infinity (was 99999s). Match timer is now hidden entirely in tutorial — training has no time pressure.' },
        ]
      },
      {
        v: 'v0.5.60', date: '2026-03-18',
        title: 'Tutorial checklist — left side + responsive scaling',
        changes: [
          { tag: 'UI', text: 'Tutorial checklist moved from right side to left side of screen — no longer overlaps the ability HUD or kill feed.' },
          { tag: 'UI', text: 'All hardcoded pixel font sizes replaced with clamp()/vw values. Panel width, padding, gaps, and fonts now scale cleanly across resolutions.' },
        ]
      },
      {
        v: 'v0.5.59', date: '2026-03-18',
        title: 'Kill float deduplication + first blood suppression',
        changes: [
          { tag: 'FIX', text: 'Removed stale KILL! float from applyHit — it fired before _killChain was incremented, causing KILL! and DOUBLE KILL! to both appear simultaneously on multi-kills. killChar already handles KILL! correctly.' },
          { tag: 'FIX', text: 'FIRST BLOOD now suppresses the plain KILL! world float. Previously both fired on the opening kill.' },
        ]
      },
      {
        v: 'v0.5.38', date: '2026-03-18',
        title: 'Standardized hero sprite sizing',
        changes: [
          { tag: 'BALANCE', text: 'All heroes now share a tight 22–26px radius band. Old spread was 16–30px. Stone/Forge at top end, Gale/Ember at bottom — consistent enough to read clearly in combat.' },
          { tag: 'FIX', text: 'Team rings now use actual TEAM_COLORS for each team ID — correct for 2-team, 3-team, and FFA modes. No longer hardcoded blue/red.' },
          { tag: 'FIX', text: 'FFA detection corrected: one player per team regardless of team count (previously required more than 2 teams).' },
        ]
      },
      {
        v: 'v0.5.37', date: '2026-03-18',
        title: 'Team rings + timer viewport fix',
        changes: [
          { tag: 'FEATURE', text: 'Glowing elliptical team ring at each character\'s feet — blue = ally, red = enemy in 2-team; actual team color in multi-team; hero color in FFA.' },
          { tag: 'FIX', text: 'Match timer and maelstrom timer now pinned to top of viewport (offsetY + 8) not raw canvas top. Fixes drift as arena shrinks.' },
          { tag: 'FIX', text: 'All timer font sizes use vpH instead of H for consistent letterbox-aware scaling.' },
        ]
      },
      {
        v: 'v0.5.36', date: '2026-03-18',
        title: 'Timer and maelstrom display anchoring',
        changes: [
          { tag: 'FIX', text: 'timerY now uses offsetY + 8 so the match timer stays pinned to the top of the viewport rather than drifting with arena shrink.' },
        ]
      },
      {
        v: 'v0.5.35', date: '2026-03-18',
        title: 'Audio fix — onFire kill sound',
        changes: [
          { tag: 'FIX', text: 'onFire() kill sound crashed with non-finite AudioParam value. The fm() reverb tail call was missing its gainVal argument, causing an AudioNode to land in the gainVal slot.' },
        ]
      },
      {
        v: 'v0.5.34', date: '2026-03-18',
        title: 'Tutorial EMBER target — remove spawn invulnerability',
        changes: [
          { tag: 'FIX', text: 'EMBER (killable target dummy) respawns with no spawn invulnerability so players can immediately re-engage after killing it.' },
        ]
      },
      {
        v: 'v0.5.33', date: '2026-03-18',
        title: 'Tutorial EMBER instant respawn',
        changes: [
          { tag: 'FEATURE', text: 'EMBER (the killable target dummy) now respawns immediately at its original position when killed in tutorial mode. Stays dead in normal matches.' },
        ]
      },
      {
        v: 'v0.5.32', date: '2026-03-18',
        title: 'Tutorial fixed dummies — TIDE + EMBER',
        changes: [
          { tag: 'FEATURE', text: 'Tutorial always spawns TIDE as the immortal training dummy and EMBER as the killable target, regardless of which hero the player picks.' },
        ]
      },
      {
        v: 'v0.5.31', date: '2026-03-18',
        title: 'Tutorial — Ultimate starts ready',
        changes: [
          { tag: 'FEATURE', text: 'In tutorial mode only, the player\'s Ultimate (slot 2) starts with 0 cooldown so it can be tried immediately without waiting 30s.' },
        ]
      },
      {
        v: 'v0.5.30', date: '2026-03-18',
        title: 'Tutorial completion — Keep Practicing option',
        changes: [
          { tag: 'FEATURE', text: 'Completion overlay now has a third option: KEEP PRACTICING — dismisses the overlay and resumes the match so players can free-roam the tutorial arena.' },
        ]
      },
      {
        v: 'v0.5.29', date: '2026-03-18',
        title: 'TDZ fix — team ring isFFA',
        changes: [
          { tag: 'FIX', text: 'Team ring code referenced isFFA before its const declaration in drawChar, causing a TDZ crash. Fixed by computing _isFFA locally in the ring block.' },
        ]
      },
      {
        v: 'v0.5.28', date: '2026-03-18',
        title: 'Team identification rings + targeting tutorial task',
        changes: [
          { tag: 'FEATURE', text: 'Glowing elliptical base ring on every character. Blue = ally team, red = enemy team, hero color = FFA. Instant friend/foe read without checking HP bars.' },
          { tag: 'FEATURE', text: 'Tutorial section 2 now includes "Lock onto an enemy" task with live bound key label. Hooked into both keyboard and controller cycleTarget paths.' },
          { tag: 'UI', text: 'Radar button removed from in-game HUD top-right — only PAUSE remains.' },
        ]
      },
      {
        v: 'v0.5.27', date: '2026-03-18',
        title: 'Tutorial — two dummies, sequential checklist, collapsing sections',
        changes: [
          { tag: 'FEATURE', text: 'Two tutorial dummies: TRAINING DUMMY (blue label, immortal, auto-heals) and TARGET DUMMY (red label, 120 HP, killable). Both passive.' },
          { tag: 'FEATURE', text: 'Tutorial checklist is now sequential — each section unlocks only after the previous is complete. Completed sections collapse to a ✓ header.' },
          { tag: 'FEATURE', text: 'Section 2 adds "Destroy the red dummy" kill task. Killable dummy stays dead after being killed.' },
          { tag: 'FEATURE', text: 'Tutorial HUD moved to middle-right of screen (top:50%; transform:translateY(-50%)) to avoid covering the pause button.' },
          { tag: 'FEATURE', text: 'Dummy names rendered above HP bars: TRAINING DUMMY in blue, TARGET DUMMY in red.' },
        ]
      },
      {
        v: 'v0.5.26', date: '2026-03-18',
        title: 'Tutorial checklist — live bound key labels',
        changes: [
          { tag: 'FEATURE', text: 'Tutorial task labels with keybinds (Sprint, Ability 1/2/Ultimate, Class Ability, Rock Buster) now call getBindLabel() at render time — reflect any custom rebindings and switch between keyboard/controller labels.' },
        ]
      },
      {
        v: 'v0.5.25', date: '2026-03-18',
        title: 'Health pack steal mechanic',
        changes: [
          { tag: 'FEATURE', text: 'Health packs can now be picked up at full HP to deny them from fleeing enemies. Shows "DENIED!" float. HoT and instant heal still capped at maxHp.' },
        ]
      },
      {
        v: 'v0.5.24', date: '2026-03-18',
        title: 'Class mechanics overhaul',
        changes: [
          { tag: 'FEATURE', text: 'Melee collision: replaces knockback with 0.35–0.60s 60% speed slow. Getting hit by melee is sticky — you have to escape, not bounce away.' },
          { tag: 'FEATURE', text: 'Melee in-range bonus: +20% damage on all attacks when within melee range. Closing the gap is now meaningfully rewarded.' },
          { tag: 'FEATURE', text: 'Ranged cornered defense: 25% DR when a melee enemy is within 120px ("EVASION" float). Represents the instinctive defensive stance at close range.' },
          { tag: 'FEATURE', text: 'Hybrid combo system: auto-attacks build stacks (max 5, expire 4s). Each stack = +6% ability damage. Land 5 autos then fire an ability = +30% burst. Shows "COMBO ×N" and "COMBO BURST!" floats.' },
          { tag: 'BALANCE', text: 'Melee hero HP/defense bumped across Stone/Forge/Flora. Ranged mobility bumped across Ember/Myst/Volt/Frost. Hybrid abilityPower bumped on Tide/Gale.' },
        ]
      },
      {
        v: 'v0.5.23', date: '2026-03-18',
        title: 'Tutorial hero select — class grouping',
        changes: [
          { tag: 'UI', text: 'Tutorial hero select now matches roster layout: MELEE / RANGED / HYBRID class headers with colored dividers, animated sprites, hero names in element color.' },
          { tag: 'UI', text: 'Tutorial screen uses same topbar with back button and scrollable grid layout as the Element Roster screen.' },
        ]
      },
      {
        v: 'v0.5.22', date: '2026-03-18',
        title: 'Tutorial hero select — animated sprites',
        changes: [
          { tag: 'UI', text: 'Tutorial hero select shows canvas sprite previews with hero names only — no emoji icons, no class labels. Sprites animate at 20fps.' },
        ]
      },
      {
        v: 'v0.5.21', date: '2026-03-18',
        title: 'Tutorial button in HTP',
        changes: [
          { tag: 'UI', text: 'Added TUTORIAL button at the bottom of the How To Play screen alongside PLAY NOW.' },
        ]
      },
      {
        v: 'v0.5.20', date: '2026-03-18',
        title: 'Ability renaming — Q/E/R → Ability 1/2/Ultimate',
        changes: [
          { tag: 'UI', text: 'All player-facing ability references renamed: "Ability Q" → "Ability 1", "Ability E" → "Ability 2", "R" → "Ultimate". Internal keybinding action keys unchanged.' },
          { tag: 'UI', text: 'Options panel, HTP bindings table, tutorial checklist, ability card fallback chips all updated.' },
        ]
      },
      {
        v: 'v0.5.19', date: '2026-03-18',
        title: 'Tutorial mode',
        changes: [
          { tag: 'FEATURE', text: 'TUTORIAL button on main menu. Pick any hero, train against a completely passive dummy.' },
          { tag: 'FEATURE', text: '5-section loose checklist: Movement, Auto Attacks, Abilities (Q/E/R), Class Ability, Rocks & Health Pots.' },
          { tag: 'FEATURE', text: 'Dummy has massive HP and never attacks back. Win condition and time limit disabled in tutorial.' },
          { tag: 'FEATURE', text: 'On completion, option to launch a real match with the same hero.' },
        ]
      },
      {
        v: 'v0.5.18', date: '2026-03-18',
        title: 'Core stats layout — 3 cards, combat stats alphabetized',
        changes: [
          { tag: 'UI', text: 'Core Stats reduced to 3 cards: HP, Defense, Damage. Mobility moved to Combat Stats.' },
          { tag: 'UI', text: 'Combat Stats alphabetized: Ability Power → Armor Pen → Atk Speed → CDR → Crit Chance → Lifesteal → Mana Regen → Mobility.' },
          { tag: 'UI', text: 'Core stat grid switched to 3 columns (from 4), centered and capped at 420px wide.' },
        ]
      },
      {
        v: 'v0.5.17', date: '2026-03-18',
        title: 'Core stats — Mobility moved to Combat Stats',
        changes: [
          { tag: 'UI', text: 'Removed Mobility from Core Stats section. Moved to top of Combat Stats. Core stats are now HP, Defense, Damage only.' },
        ]
      },
      {
        v: 'v0.5.16', date: '2026-03-18',
        title: 'Main menu — Play Locally label',
        changes: [
          { tag: 'UI', text: '"PLAY LOCAL" renamed to "PLAY LOCALLY" on the main menu.' },
        ]
      },
      {
        v: 'v0.5.15', date: '2026-03-18',
        title: 'Health pack — instant + HoT split',
        changes: [
          { tag: 'FEATURE', text: 'Health packs now deal 15% instant heal + 25% HoT = 40% total (up from 30% pure HoT). Float shows "+X (+Y)". Instant heal is combat-safe; HoT still cancels on hit.' },
        ]
      },
      {
        v: 'v0.5.14', date: '2026-03-18',
        title: 'AI weather awareness + obstacle avoidance tuning',
        changes: [
          { tag: 'FIX', text: 'Per-frame maelstrom/voidPull escape: AI now reacts every frame, not every 1.5s. Strong escape force (speed × 4.0) ramps sharply inside the zone.' },
          { tag: 'FIX', text: 'Obstacle avoidance scale reduced from speed×2.5 to speed×1.6. Dot threshold widened so bots push through rocks to reach health packs rather than deadlocking.' },
          { tag: 'FIX', text: 'Seek_item obstacle avoidance also reduced from speed×2.5 to speed×1.4.' },
          { tag: 'BALANCE', text: 'Weather zone seek threshold lowered (5/8 vs 8/12) and blend strength increased (18/28% vs 10/18%) so bots more visibly react to beneficial zones.' },
        ]
      },
      {
        v: 'v0.5.13', date: '2026-03-18',
        title: 'Rock drop rate + health pack steal',
        changes: [
          { tag: 'FEATURE', text: 'Large rocks only drop health pots (no small rock drops). Drop rate 50%.' },
          { tag: 'FEATURE', text: 'Pots pickable at full health — "DENIED!" float shows to deny resource from fleeing enemies.' },
        ]
      },
      {
        v: 'v0.5.12', date: '2026-03-18',
        title: 'Rock drop fade-in + elastic collision',
        changes: [
          { tag: 'FEATURE', text: 'Rocks that spawn mid-match fade in over 2s (20%→100% scale). Rock-rock elastic collision with spin kick response.' },
        ]
      },
      {
        v: 'v0.5.11', date: '2026-03-18',
        title: 'Health pack — HoT + AI priority',
        changes: [
          { tag: 'FEATURE', text: 'Health pack heals 15% instantly + 25% HoT over 3s = 40% total. Float shows "+X (+Y)".' },
          { tag: 'BALANCE', text: 'AI priority chain: Flee > Health pack (close only during flee) > Fight. Mana packs only sought when HP is safe.' },
        ]
      },
      {
        v: 'v0.5.10', date: '2026-03-18',
        title: 'AI stuck detection + dangerous zone escape',
        changes: [
          { tag: 'FIX', text: 'Per-frame maelstrom escape force (speed×4.0) bypasses timer gate. AI no longer stands in storms.' },
          { tag: 'FIX', text: 'Seek stuck detection: 3s timeout resets AI to chase when pathing to an item fails.' },
        ]
      },
      {
        v: 'v0.5.09', date: '2026-03-18',
        title: 'Arena and AI improvements',
        changes: [
          { tag: 'FEATURE', text: 'Large rocks only, health pots only, 50% drop rate from rocks.' },
          { tag: 'BALANCE', text: 'Obstacle avoidance scale reduced (speed×2.5 → speed×1.6), dot threshold widened.' },
        ]
      },
      {
        v: 'v0.5.08', date: '2026-03-18',
        title: 'Melee slash direction + renderer',
        changes: [
          { tag: 'FEATURE', text: 'Melee auto-attacks use directional arc check (dot product, 135° forward cone). Fixed pixel slash renderer: 8px glow, 3px white core, 2px color accent.' },
          { tag: 'BALANCE', text: 'Melee auto damage multiplier set to 1.0× (up from 0.65×).' },
        ]
      },
      {
        v: 'v0.5.07', date: '2026-03-18',
        title: 'Melee slash system',
        changes: [
          { tag: 'FEATURE', text: 'Melee auto-attacks replaced with stationary slash: vx:0, vy:0, radius covering melee range, 0.07s life. Hits all enemies in forward arc simultaneously.' },
        ]
      },
      {
        v: 'v0.5.06', date: '2026-03-18',
        title: 'Pause flag fix',
        changes: [
          { tag: 'FIX', text: 'Added gamePaused flag to state. gameLoop now checks !gamePaused before rescheduling. togglePause sets/clears flag + cancelAnimationFrame.' },
          { tag: 'FIX', text: 'B-button during countdown clicks #abort-countdown-btn. cleanupGame resets gamePaused = false.' },
        ]
      },
      {
        v: 'v0.5.05', date: '2026-03-18',
        title: 'Pause and B-button fixes',
        changes: [
          { tag: 'FIX', text: 'pollControllerUI detects pauseOpen && curScreen !== pause-overlay inline every frame — no timing dependency.' },
        ]
      },
      {
        v: 'v0.5.04', date: '2026-03-18',
        title: 'Input source switching',
        changes: [
          { tag: 'FEATURE', text: 'Global inputSource on document.body classes: gamepad-mode, keyboard-mode, touch-mode. Mouse/controller switch dynamically, cursors restart on hero-select when mode changes.' },
          { tag: 'FIX', text: '_inputSourceListeners declared BEFORE listeners that call _onInputSourceChange — fixes TDZ crash.' },
          { tag: 'FIX', text: 'mousemove never overrides gamepad-mode. mousedown switches to keyboard-mode only if no gamepad connected.' },
        ]
      },
      {
        v: 'v0.5.03', date: '2026-03-18',
        title: 'Input source + cursor integration',
        changes: [
          { tag: 'FIX', text: '_applyGamepadUI fires _onInputSourceChange("gamepad") + restarts cursors if on hero-select.' },
          { tag: 'FIX', text: 'controls.js _restartCursorsIfOnRoster() called from all three mode-change handlers.' },
        ]
      },
      {
        v: 'v0.5.02', date: '2026-03-18',
        title: 'PlayerCursors — mouse click hero select fix',
        changes: [
          { tag: 'FIX', text: 'Mouse click on hero card uses capture-phase listener calling lobbySetHero(hero, p1.slotIdx) directly — prevents P2 overriding P1 slot on click.' },
          { tag: 'FIX', text: 'cursor:none !important injected as <style> tag to override all child cursor:pointer rules.' },
        ]
      },
      {
        v: 'v0.5.01', date: '2026-03-18',
        title: 'PlayerCursors — analog movement + soft magnet',
        changes: [
          { tag: 'FEATURE', text: 'Analog controller cursor movement: quadratic input curve (x²) + velocity lerp (ACCEL_T=0.08, DECEL_T=0.12, MAX_SPEED=1400px/s).' },
          { tag: 'FEATURE', text: 'Soft magnet snap: 60px proximity gate, 0.09 strength, cache rebuilt every 200ms.' },
          { tag: 'FEATURE', text: 'Touch detection via window.matchMedia("(pointer: fine)") — touch devices skip cursors entirely.' },
        ]
      },
      {
        v: 'v0.5.00', date: '2026-03-18',
        title: 'PlayerCursors full-screen cursor system',
        changes: [
          { tag: 'FEATURE', text: 'Full-screen per-player colored arrow cursors for hero select. P1 always visible (mouse-driven by default); touch devices skip cursors.' },
          { tag: 'FEATURE', text: 'document.elementFromPoint for universal hit detection — cursors can click anything on screen.' },
          { tag: 'FEATURE', text: 'Controller assignment uses browserSlot = activeGamepadIndex + pIdx via _pickBestGamepad.' },
          { tag: 'FEATURE', text: 'lobbySetHero(h, slotIdx) uses explicit slotIdx to prevent P2 overriding P1.' },
        ]
      },
      {
        v: 'v0.4.99', date: '2026-03-18',
        title: 'mousedown listener ordering fix',
        changes: [
          { tag: 'FIX', text: 'mousedown listener was calling _onInputSourceChange before _inputSourceListeners was declared — TDZ crash. Moved below all declarations it depends on.' },
        ]
      },
      {
        v: 'v0.4.98', date: '2026-03-18',
        title: 'Global input source switching - keyboard/mouse/touch/controller profiles',
        changes: [
          { tag: 'FEATURE', text: 'Moving the mouse now switches to keyboard-mode globally. Any screen reacts: cursors follow mouse, controller hints hide, mouse hints show.' },
          { tag: 'FEATURE', text: 'PlayerCursors reads body class on every start() — touch-mode = no cursors, keyboard-mode = mouse-driven P1 cursor, gamepad-mode = controller cursors.' },
          { tag: 'FEATURE', text: 'Input source change fires a callback — PlayerCursors auto-restarts on hero-select whenever mode switches so the right cursor style appears immediately.' },
          { tag: 'FEATURE', text: 'Battlefield: cursor always hidden during gameplay. Pause menu: system cursor restored when pause opens, hidden again on resume.' },
        ]
      },
      {
        v: 'v0.4.97', date: '2026-03-18',
        title: 'Touch detection — per-call not permanent flag',
        changes: [
          { tag: 'FIX', text: 'Replaced permanent _isTouch flag with per-call matchMedia("(pointer: fine)") check. Touch-only screens skip cursors; PC+controller correctly passes.' },
        ]
      },
      {
        v: 'v0.4.96', date: '2026-03-18',
        title: 'PlayerCursors — direct pIdx=browserSlot mapping',
        changes: [
          { tag: 'FIX', text: 'Simplified to direct pIdx=browserSlot assignment — P1 always uses browser slot 0, P2 uses slot 1. Stable: browser never moves a controller to a different index once assigned. Removed _padOrder entirely.' },
        ]
      },
      {
        v: 'v0.4.95', date: '2026-03-18',
        title: 'PlayerCursors — ordered _padOrder array',
        changes: [
          { tag: 'FIX', text: 'Replaced complex claim-on-first-input with simple ordered _padOrder array for stable controller-to-cursor mapping.' },
        ]
      },
      {
        v: 'v0.4.94', date: '2026-03-18',
        title: 'PlayerCursors — claim input threshold raised',
        changes: [
          { tag: 'FIX', text: 'Raised claim-on-first-input threshold from 0.1 to 0.5 for axes and required actual button pressed state — prevents resting controller noise from accidentally claiming a cursor slot.' },
        ]
      },
      {
        v: 'v0.4.93', date: '2026-03-18',
        title: 'PlayerCursors — claim-on-first-input approach',
        changes: [
          { tag: 'FIX', text: 'Replaced static slot assignment with claim-on-first-input: a cursor claims whichever gamepad first produces input above threshold.' },
        ]
      },
      {
        v: 'v0.4.92', date: '2026-03-18',
        title: 'PlayerCursors — raw browser slot lookup',
        changes: [
          { tag: 'FIX', text: 'Store raw browser gamepad slot index on each cursor at creation. Tick looks up by raw index instead of navigating assignment maps — eliminates stale reference issues.' },
        ]
      },
      {
        v: 'v0.4.91', date: '2026-03-18',
        title: 'PlayerCursors — remove _gpAssignments',
        changes: [
          { tag: 'FIX', text: 'Removed _gpAssignments entirely. Match gamepads to cursors by position in connected list — simpler and more reliable than a maintained assignment map.' },
        ]
      },
      {
        v: 'v0.4.90', date: '2026-03-18',
        title: 'PlayerCursors — always rescan on start()',
        changes: [
          { tag: 'FIX', text: 'if (!_gpAssignments) guard meant controllers connected before the screen loads never got picked up on re-entry. Now always scans and fills unassigned slots on every start().' },
        ]
      },
      {
        v: 'v0.4.89', date: '2026-03-18',
        title: 'PlayerCursors — spawn at center + position reset',
        changes: [
          { tag: 'FIX', text: 'All cursors now start at center of the hero-select screen. Saved positions are cleared when fully leaving hero-select so cursors always spawn fresh on re-entry.' },
        ]
      },
      {
        v: 'v0.4.88', date: '2026-03-18',
        title: 'PlayerCursors — magnet tuning',
        changes: [
          { tag: 'FIX', text: 'Reduced magnet strength and added minimum distance threshold before attraction activates. High strength (0.18) was causing cursor oscillation between nearby elements.' },
        ]
      },
      {
        v: 'v0.4.87', date: '2026-03-18',
        title: 'PlayerCursors — magnet performance + AI freeze fixes',
        changes: [
          { tag: 'FIX', text: 'Throttled magnet getBoundingClientRect calls — querying all hero cards every frame was expensive. Cache rebuilt on interval instead.' },
          { tag: 'FIX', text: 'Rock navigation removed from AI — bots no longer walk to rocks as destinations. Rock buster only fired opportunistically when in range, never as a navigation goal.' },
          { tag: 'FIX', text: 'AI seek_item stuck detection added: 3s timeout resets to chase if pathing to an item fails.' },
        ]
      },
      {
        v: 'v0.4.98', date: '2026-03-18',
        title: 'Global input source switching - keyboard/mouse/touch/controller profiles',
        changes: [
          { tag: 'FEATURE', text: 'Moving the mouse now switches to keyboard-mode globally. Any screen reacts: cursors follow mouse, controller hints hide, mouse hints show.' },
          { tag: 'FEATURE', text: 'PlayerCursors reads body class on every start() — touch-mode = no cursors, keyboard-mode = mouse-driven P1 cursor, gamepad-mode = controller cursors.' },
          { tag: 'FEATURE', text: 'Input source change fires a callback — PlayerCursors auto-restarts on hero-select whenever mode switches so the right cursor style appears immediately.' },
          { tag: 'FEATURE', text: 'Battlefield: cursor always hidden during gameplay. Pause menu: system cursor restored when pause opens, hidden again on resume. ESC to pause works for mouse users.' },
        ]
      },
      {
        v: 'v0.4.86', date: '2026-03-18',
        title: 'Cursor: soft magnet snap',
        changes: [
          { tag: 'FEEL', text: 'Cursor softly drifts toward the nearest clickable element when the stick is mostly released (< 30% deflection). Pushing hard overrides it completely — full deflection = free movement.' },
          { tag: 'FEEL', text: 'Magnet strength scales quadratically with distance and linearly with how much the stick is released. Closest element within 120px attracts, nothing outside that range.' },
        ]
      },
      {
        v: 'v0.4.85', date: '2026-03-18',
        title: 'Bugfix: Controller hot-plug detection on hero select',
        changes: [
          { tag: 'FIX', text: 'Plugging in a controller while on hero-select now correctly assigns it to the next available human slot. Previously _gpAssignments was locked after first start() so new controllers were ignored.' },
          { tag: 'FIX', text: 'Toggling a slot to/from CPU resets controller assignments so they remap cleanly to the new human layout.' },
          { tag: 'FIX', text: 'Assignments cleared when leaving hero-select so next session re-scans from scratch.' },
        ]
      },
      {
        v: 'v0.4.85', date: '2026-03-18',
        title: 'Bugfix: Cursors no longer appear on battlefield',
        changes: [
          { tag: 'FIX', text: 'launchGame() now explicitly calls PlayerCursors.stop() and cancels any pending start timer before launching. Prevents a race where abortCountdown\'s 120ms setTimeout could fire PlayerCursors.start() after the game had already launched.' },
          { tag: 'FIX', text: 'All PlayerCursors.start() timeouts now use a named window._pcStartTimer so launchGame() can cancel them reliably.' },
        ]
      },
      {
        v: 'v0.4.85', date: '2026-03-18',
        title: 'Bugfix: Cursors no longer leak onto battlefield',
        changes: [
          { tag: 'FIX', text: 'PlayerCursors.stop() now called when showScreen(\'game\') fires. Previously only stopped on menu/hero-select transitions, so cursors persisted into the match.' },
        ]
      },
      {
        v: 'v0.4.85', date: '2026-03-18',
        title: 'Bugfix: Controller P1/P2 assignment stable across re-entries',
        changes: [
          { tag: 'FIX', text: 'GP assignments (which browser slot = which player cursor) are now locked on first entry to hero-select and reused on every rebuild — toggle, abort countdown, etc. Leaving hero-select fully clears them for next session.' },
          { tag: 'FIX', text: 'gamepadconnected no longer reshuffles existing cursors. Only triggers a rebuild if the new controller is not already assigned.' },
          { tag: 'FIX', text: 'stop() takes a clearAssignments flag — internal rebuilds pass false (keep assignments), showScreen away from hero-select passes true (reset for next time).' },
        ]
      },
      {
        v: 'v0.4.84', date: '2026-03-18',
        title: 'Cursor: natural analog feel',
        changes: [
          { tag: 'FEEL', text: 'Cursor movement now uses quadratic input curve (x²) — small stick deflections stay slow for precision, full deflection reaches max speed. Eliminates the on/off feel.' },
          { tag: 'FEEL', text: 'Velocity lerp matches character movement: 80ms acceleration ramp, 120ms coast-to-stop when stick released. Cursor has momentum instead of cutting dead.' },
          { tag: 'FEEL', text: 'Top speed raised to 1400px/s so the cursor can cross the full screen quickly at full deflection. Diagonal input is normalised so corner deflection doesn\'t overspeed.' },
        ]
      },
      {
        v: 'v0.4.83', date: '2026-03-18',
        title: 'Hide cursor on battlefield',
        changes: [
          { tag: 'FIX', text: 'Cursor now hidden on the game screen via #game, #game * { cursor: none !important }.' },
        ]
      },
      {
        v: 'v0.4.82', date: '2026-03-18',
        title: 'Bugfix: P2/P3/P4 selections no longer override P1',
        changes: [
          { tag: 'FIX', text: 'lobbySetHero now takes an explicit slotIdx parameter. Each cursor (P1/P2/P3/P4) passes its own slot directly — no shared activeSlotIdx involved in assignment.' },
          { tag: 'FIX', text: 'Controller A-button on hero card calls lobbySetHero(hero, cur.slotIdx) directly instead of card.click() which would route through the shared activeSlotIdx path.' },
          { tag: 'FIX', text: 'Mouse click on hero card calls lobbySetHero(hero, p1.slotIdx) directly. activeSlotIdx is now only used for keyboard/UINav confirm path.' },
          { tag: 'FIX', text: 'CPU slots are explicitly rejected in lobbySetHero — can\'t accidentally assign to a CPU slot.' },
        ]
      },
      {
        v: 'v0.4.81', date: '2026-03-18',
        title: 'Cursor: touch detection + finger cursor fix',
        changes: [
          { tag: 'FIX', text: 'System finger/pointer cursor no longer shows alongside the player cursor. Cursor:none is now injected as a <style> tag with !important, overriding all child element cursor:pointer rules.' },
          { tag: 'FIX', text: 'Touch devices (iPhone, tablet) skip PlayerCursors entirely — no cursor shown, native tap selection works as expected. Detected on first touchstart event.' },
          { tag: 'FIX', text: 'If a touch event fires while cursors are active, they immediately stop and restore the system cursor.' },
        ]
      },

      {
        v: 'v0.4.80', date: '2026-03-18',
        title: 'P1 cursor replaces system cursor on hero select',
        changes: [
          { tag: 'FEATURE', text: 'System cursor hidden on hero-select. P1\'s gold cursor replaces it — always visible, always tracking the mouse.' },
          { tag: 'FEATURE', text: 'Controller and mouse work simultaneously for P1. Mouse moves the cursor, controller also moves it. Whichever had last input wins.' },
          { tag: 'FEATURE', text: 'Mouse click on a hero card sets activeSlotIdx to P1\'s slot automatically before the click fires.' },
          { tag: 'FEATURE', text: 'System cursor restored when leaving hero-select.' },
        ]
      },
      {
        v: 'v0.4.79', date: '2026-03-18',
        title: 'PlayerCursors: P2/P3/P4 controller fix',
        changes: [
          { tag: 'FIX', text: 'Gamepad list is now rebuilt every tick instead of snapshotted at start() — controllers plugged in after the screen loads are picked up immediately.' },
          { tag: 'FIX', text: 'Added gamepadconnected listener: plugging in a controller while on hero-select automatically spawns its cursor.' },
          { tag: 'FIX', text: 'P2/P3/P4 cursor colors now map correctly by human player index — P1=gold, P2=cyan, P3=orange, P4=lime regardless of how many CPU slots exist.' },
          { tag: 'FIX', text: 'Cursor count matches human slot count, not validGPs count — all human players always get a cursor if a controller is available for them.' },
        ]
      },
      {
        v: 'v0.4.79', date: '2026-03-18',
        title: 'Bugfix: P2/P3/P4 controller cursor indexing',
        changes: [
          { tag: 'FIX', text: 'PlayerCursors was using a compacted filtered array for gamepad lookup — if browser slot 0 was empty, P1\'s gamepad would be treated as P2\'s. Now stores real browser slot index on each cursor and indexes rawGPs[] directly.' },
          { tag: 'FIX', text: 'Player count +/- buttons were still calling HeroCursors.start() — switched to PlayerCursors.start().' },
          { tag: 'FIX', text: 'P3/P4 cursors now correctly pick up gamepads at browser indices 2 and 3.' },
        ]
      },
      {
        v: 'v0.4.78', date: '2026-03-18',
        title: 'PlayerCursors — full screen, interact with everything',
        changes: [
          { tag: 'FEATURE', text: 'Controller cursors now roam the entire hero-select screen, not just the hero grid. Can click player count +/-, team dots, LOCK IN, MATCH SETTINGS, BACK — anything a mouse can click.' },
          { tag: 'FEATURE', text: 'Uses document.elementFromPoint under the cursor tip to find the real element, walks up to nearest clickable ancestor. A clicks it, B clears hero pick.' },
          { tag: 'FEATURE', text: 'Cursors use position:fixed attached to body so they work correctly outside the grid container.' },
        ]
      },
      {
        v: 'v0.4.78', date: '2026-03-18',
        title: 'Bugfix: Cursor stays on selection',
        changes: [
          { tag: 'FIX', text: 'Player cursors no longer reset to their starting position after selecting a hero. Position is saved before each grid rebuild and restored when cursors restart.' },
        ]
      },
      {
        v: 'v0.4.77', date: '2026-03-18',
        title: 'Smash-style PlayerCursors — clean sheet hero select input',
        changes: [
          { tag: 'FEATURE', text: 'Each human player gets a colored arrow cursor over the hero grid. Analog stick glides it smoothly like a mouse. D-pad also works.' },
          { tag: 'FEATURE', text: 'A button selects the card under the cursor, assigning it to that player\'s slot. B clears their selection. Touch/mouse click cards directly as before.' },
          { tag: 'FEATURE', text: 'Cursors always shown for all human slots regardless of player count — single player can use controller, mouse, or touch freely.' },
          { tag: 'REFACTOR', text: 'Deleted pollExtraGamepadHeroSelect and all extra gamepad hero-select nav layers. One system for all input.' },
        ]
      },
      {
        v: 'v0.4.77', date: '2026-03-18',
        title: 'Smash-style PlayerCursors',
        changes: [
          { tag: 'FEATURE', text: 'Replaced all gamepad hero-select navigation with PlayerCursors — a per-player colored pointer cursor over the hero grid. Left stick or d-pad moves it freely like a mouse. Hover over a card to highlight it, A to select, B to clear.' },
          { tag: 'FEATURE', text: 'Cursor only appears when a gamepad is connected. Touch and mouse work naturally via card.onclick unchanged.' },
          { tag: 'FEATURE', text: 'Multiple cursors (P1+P2) only shown when 2+ human slots AND 2+ gamepads are connected. Single player with one gamepad gets one cursor.' },
          { tag: 'FEATURE', text: 'Cursor restarts automatically when a new gamepad is connected on the hero-select screen.' },
          { tag: 'REFACTOR', text: 'Removed pollExtraGamepadHeroSelect and all hero-select specific UINav grid nav code.' },
        ]
      },
      {
        v: 'v0.4.76', date: '2026-03-18',
        title: 'Controller input wired to unified hero select',
        changes: [
          { tag: 'FEATURE', text: 'P1 controller d-pad navigates hero grid and A confirms via UINav — same click path as mouse/touch.' },
          { tag: 'FEATURE', text: 'P2+ controllers each independently navigate and confirm their own slot. D-pad moves focus, A picks, B clears selection. Each gamepad sets activeSlotIdx to its own slot before acting.' },
          { tag: 'REFACTOR', text: 'Removed dead HeroCursors.isActive() suppression check from UINav.' },
        ]
      },
      {
        v: 'v0.4.75', date: '2026-03-18',
        title: 'Remove HeroCursors — unified selection logic',
        changes: [
          { tag: 'REFACTOR', text: 'Deleted the entire HeroCursors gamepad overlay system (~250 lines). Controller, touch, and mouse all now use the same slot badge logic — click/select a card, badge appears on it. No duplicate layers.' },
        ]
      },
      {
        v: 'v0.4.74', date: '2026-03-18',
        title: 'Bugfix: Stale gamepad cursor badges on fresh lobby',
        changes: [
          { tag: 'FIX', text: 'HeroCursors (gamepad overlay system) was rendering P1/P2 badges on the first two cards by default even with no gamepad input. Cursors now only become visible after the player has actually moved the d-pad or pressed a button.' },
        ]
      },
      {
        v: 'v0.4.73', date: '2026-03-18',
        title: 'Bugfix: No more auto-start',
        changes: [
          { tag: 'FIX', text: 'Removed auto-start timer entirely. LOCK IN always requires a manual button press regardless of player count. Aborting the countdown no longer re-triggers a new countdown loop.' },
        ]
      },
      {
        v: 'v0.4.72', date: '2026-03-18',
        title: 'Lock-in Countdown',
        changes: [
          { tag: 'UI', text: 'Pressing LOCK IN now shows a full-screen 3-second countdown before the match starts. Hit ABORT (or Escape) at any time to cancel and return to character selection.' },
          { tag: 'UI', text: 'CPU random picks are revealed on the cards before the countdown begins so everyone can see the full lineup.' },
        ]
      },
      {
        v: 'v0.4.71', date: '2026-03-18',
        title: 'Lobby: Clean rewrite of card selection display',
        changes: [
          { tag: 'FIX', text: 'Scrapped all previous badge/cursor/border logic. New rule: if slot.hero === this card\'s hero, stamp a P1/P2/CPU label badge on the card in the slot\'s color. That\'s it. No activeSlotIdx involvement.' },
        ]
      },
      {
        v: 'v0.4.70', date: '2026-03-18',
        title: 'Lobby: Fix hero assignment to wrong slot',
        changes: [
          { tag: 'FIX', text: 'v0.4.69 introduced a snap-to-first-unfilled-slot on every card click, which was reassigning heroes to P1\'s slot even when P2 was active. Removed aggressive snap — card clicks now respect activeSlotIdx as set by tapping a slot pill, only correcting if it points at a CPU or locked slot.' },
          { tag: 'FIX', text: 'Toggle slot type change no longer moves activeSlotIdx unless it\'s now pointing at a CPU slot.' },
        ]
      },
      {
        v: 'v0.4.69', date: '2026-03-18',
        title: 'Lobby: Fix hero card selection highlight',
        changes: [
          { tag: 'FIX', text: 'Hero card borders now show the correct player color for whoever has that hero assigned — no longer driven by activeSlotIdx which could point at a different slot entirely.' },
          { tag: 'FIX', text: 'Active cursor (unpicked slot) shows its player color on the hovered/selected card only. Assigned heroes always show their owner\'s color regardless of which slot is active.' },
        ]
      },
      {
        v: 'v0.4.68', date: '2026-03-18',
        title: 'Lobby UI Fixes',
        changes: [
          { tag: 'FIX', text: 'CPU→Human toggle no longer auto-starts the match. Toggling any slot now clears its hero, cancels any pending auto-start timer, and re-points activeSlotIdx at the first unfilled human slot.' },
          { tag: 'FIX', text: 'Auto-start timer re-validates humanCount at fire time — if you toggled back to multiple humans in the 800ms window, it no longer fires.' },
          { tag: 'FIX', text: 'Mouse/touch hero card clicks now snap activeSlotIdx to the first unfilled human slot before assigning, fixing the mismatch between the highlighted slot at the top and the locked-in slot at the bottom.' },
          { tag: 'FIX', text: 'LOCK IN button (multi-human) now always requires a manual press — no auto-launch path when humanCount > 1.' },
        ]
      },
      {
        v: 'v0.4.67', date: '2026-03-18',
        title: 'Bugfix: weatherEnter audio crash',
        changes: [
          { tag: 'FIX', text: 'Fixed gameLoop crash: weatherEnter() was passing an AudioNode as the gainVal argument to fm() — rev.input was in the wrong position. linearRampToValueAtTime received a non-finite value and threw every frame a player entered a weather zone.' },
        ]
      },
      {
        v: 'v0.4.66', date: '2026-03-18',
        title: 'Bugfix: Convergence % now counts up correctly',
        changes: [
          { tag: 'FIX', text: 'Convergence % was inverted — old formula measured post-merge overlap depth, so it showed 0% at the exact moment of merge and only climbed after. Fixed to count from 0% (zones far apart) to 99% (just before merge fires), so players see the buildup.' },
        ]
      },
      {
        v: 'v0.4.65', date: '2026-03-18',
        title: 'Convergence % Indicator',
        changes: [
          { tag: 'UI', text: 'Convergence percentage now displayed at the overlap midpoint between two approaching storms. Fades in as zones get close, pulses faster above 70%, and shifts from blue toward white as it climbs toward 100%.' },
        ]
      },
      {
        v: 'v0.4.64', date: '2026-03-18',
        title: 'Bugfix: Timer pinned to top, no overlaps',
        changes: [
          { tag: 'FIX', text: 'Match timer re-pinned to 8px from top of window — no longer shifts with letterbox offsetY.' },
          { tag: 'FIX', text: 'Replaced fixed-offset sub-item positioning with a y-cursor that advances after each rendered element. Score pills, ∞, Maelstrom timer, and Sudden Death label now always stack cleanly with no overlap regardless of which combination is visible.' },
        ]
      },
      {
        v: 'v0.4.63', date: '2026-03-18',
        title: 'TIDE Whirlpool Buff',
        changes: [
          { tag: 'BALANCE', text: 'Whirlpool DPS tripled: 12 → 38 (total damage over duration ~152 vs old 36).' },
          { tag: 'BALANCE', text: 'Whirlpool pull strength quadrupled: 3.5 → 14.' },
          { tag: 'BALANCE', text: 'Whirlpool radius increased: 160 → 200. Duration extended: 3s → 4s.' },
          { tag: 'BALANCE', text: 'Pull falloff changed from linear to sqrt — enemies near the edge now feel strong pull instead of almost nothing.' },
        ]
      },
      {
        v: 'v0.4.62', date: '2026-03-18',
        title: 'Perf Fix: AI Zone Repulsion',
        changes: [
          { tag: 'FIX', text: 'Zone repulsion was calling getWeatherAt() for every zone every frame for every bot — could be 12+ calls per frame causing lag. Moved repulsion calculation inside the _weatherEvalTimer gate (runs every 0.8–1.5s per bot, not every frame).' },
        ]
      },
      {
        v: 'v0.4.61', date: '2026-03-18',
        title: 'Bugfix: Static hex grid',
        changes: [
          { tag: 'FIX', text: 'Hex grid no longer scrolls with camera movement. Was being tiled and offset by camera.x/y causing a nauseating parallax. Now drawn once at full arena size in world coordinates — completely static.' },
        ]
      },
      {
        v: 'v0.4.60', date: '2026-03-18',
        title: 'Maelstrom Kill Penalty',
        changes: [
          { tag: 'BALANCE', text: 'Dying to a Maelstrom now deducts 1 kill from your score. Both the individual kill count and team kill total are reduced (floored at 0). Player sees a -1 KILL float text on death.' },
        ]
      },
      {
        v: 'v0.4.59', date: '2026-03-18',
        title: 'AI: Natural Storm Avoidance',
        changes: [
          { tag: 'AI', text: 'Removed escape waypoint system for harmful zones — was causing bots to walk to the storm edge, clear the waypoint, then re-enter, creating a visible bounce loop.' },
          { tag: 'AI', text: 'Replaced with continuous radial repulsion force: harmful zones push bots away proportional to how deep inside they are. Fades to zero outside the zone. No state, no waypoints, no bouncing.' },
          { tag: 'AI', text: 'Beneficial zone seeking (Downpour heal etc.) retained as a gentle nudge, only active when not in combat.' },
        ]
      },
      {
        v: 'v0.4.58', date: '2026-03-18',
        title: 'Bugfix: Timer off-center',
        changes: [
          { tag: 'FIX', text: 'Match timer and score pills now correctly centered in the game viewport. drawHUD was using canvas.width/2 as the center, but the game renders inside a letterboxed viewport with offsetX. Fixed to use the actual viewport center.' },
        ]
      },
      {
        v: 'v0.4.57', date: '2026-03-18',
        title: 'AI Overhaul — Harder Hard, Less Dithering',
        changes: [
          { tag: 'AI', text: 'Fixed "stay still" loop: hold state now has a forward pressure component on hard, so bots don\'t just strafe on the spot.' },
          { tag: 'AI', text: 'Fixed flee over-conservatism: hard re-engage cooldown reduced from 2.0s to 0.8s, re-engage HP threshold lowered from 50% to 42%.' },
          { tag: 'AI', text: 'Fixed weather zone avoidance overriding combat: escape blend halved, and zone seek/escape waypoints are completely suppressed while in direct combat range.' },
          { tag: 'AI', text: 'Fixed obstacle avoidance causing circling: lookahead distance halved, avoidance now ignores obstacles that are behind or beside the bot — only avoids what\'s directly ahead.' },
          { tag: 'AI', text: 'Fixed roam returning early: bots now fall through to auto-attack and ability firing even while roaming toward center.' },
          { tag: 'AI', text: 'Hard bots now auto-attack while fleeing if the target wanders into close range.' },
          { tag: 'AI', text: 'Hard flee HP threshold lowered to 28% (was 35%) — hard bots fight longer before retreating.' },
          { tag: 'AI', text: 'Zone seek score threshold doubled — bots won\'t abandon a fight to seek a mildly beneficial weather zone.' },
        ]
      },
      {
        v: 'v0.4.56', date: '2026-03-17',
        title: 'Storm Edge Polish',
        changes: [
          { tag: 'VISUAL', text: 'Removed jagged dashed perimeter line from storm zones — no more defined circular boundary.' },
          { tag: 'VISUAL', text: 'Edges now dissolve into scattered short arc fragments that fade to nothing, making storm boundaries feel organic and undefined.' },
          { tag: 'VISUAL', text: 'Merge warning ring only appears when zones are actually close — hidden otherwise.' },
          { tag: 'VISUAL', text: 'Inner glow dimmed to avoid a visible circular blob at storm centers.' },
        ]
      },
      {
        v: 'v0.4.55', date: '2026-03-17',
        title: 'Storm Overhaul — Pure Energy, No Blob',
        changes: [
          { tag: 'VISUAL', text: 'Complete storm zone rewrite. No more solid fill polygon. Storms are now built from layered energy: soft inner glow, rotating concentric arc wisps at every radius, radial energy streak lines, and a jagged perimeter edge.' },
          { tag: 'VISUAL', text: 'STORM zones add flickering lightning bolt cracks that randomly flash outward. SANDSTORM gets slower crackling arcs.' },
          { tag: 'VISUAL', text: 'Each zone type has distinct character: STORM is fast and electric, BLIZZARD is dense slow wisps, RAIN is streaking verticals, HEATWAVE is lazy rolling arcs, BLACKHOLE spirals inward.' },
          { tag: 'VISUAL', text: 'Concentric arcs rotate at different speeds per radius layer, creating a genuine sense of turbulent spinning depth.' },
        ]
      },
      {
        v: 'v0.4.54', date: '2026-03-17',
        title: 'Stormy Storms',
        changes: [
          { tag: 'VISUAL', text: 'Weather zones now have turbulent, noise-distorted perimeters instead of perfect circles. The edge churns and breathes over time.' },
          { tag: 'VISUAL', text: 'Each zone type has a distinct churn speed — STORM churns fast, BLIZZARD slow and heavy, SANDSTORM sweeping.' },
          { tag: 'VISUAL', text: 'Swirling tendrils spiral outward from zone centers, rotating at zone-appropriate speed.' },
          { tag: 'VISUAL', text: 'Weather particles rendered as elongated motion-blur streaks in their direction of travel instead of dots.' },
          { tag: 'VISUAL', text: 'Edge outline follows the same jagged noise shape as the fill — no more circle ring over a lumpy blob.' },
        ]
      },
      {
        v: 'v0.4.53', date: '2026-03-17',
        title: 'Performance Pass — Visual Optimisation',
        changes: [
          { tag: 'PERF', text: 'Hex grid now rendered once into an offscreen canvas and scrolled/tiled — eliminates hundreds of draw calls per frame.' },
          { tag: 'PERF', text: 'Removed per-frame screen-blend glow pass on characters (was the biggest frame cost).' },
          { tag: 'PERF', text: 'Removed shadowBlur from all obstacle rendering — faked with edge stroke only.' },
          { tag: 'PERF', text: 'Removed shadowBlur from arena border.' },
          { tag: 'PERF', text: 'Zone floor bleeding changed from screen composite + radial gradient to simple low-alpha fill — eliminates composite mode switch per zone.' },
          { tag: 'PERF', text: 'Character drop shadow simplified from 3 gradients to a single cheap ellipse.' },
          { tag: 'PERF', text: 'Obstacle AO shadow simplified from radial gradient to flat ellipse.' },
          { tag: 'PERF', text: 'Projectile trails now use Float32Array circular buffers instead of allocating new objects every frame.' },
        ]
      },
      {
        v: 'v0.4.52', date: '2026-03-17',
        title: 'Bugfix: heroCol ReferenceError',
        changes: [
          { tag: 'FIX', text: 'Fixed crash on match start — ground shadow code referenced heroCol before it was declared in drawChar. Renamed to _shadowHeroCol and used c.hero?.color directly.' },
        ]
      },
      {
        v: 'v0.4.51', date: '2026-03-17',
        title: 'Visual Dimension Pass — 7 Upgrades',
        changes: [
          { tag: 'VISUAL', text: 'Arena floor: replaced flat grid with animated hex tile pattern, pulsing energy veins, and weather zone light bleeding onto the floor using screen blend mode.' },
          { tag: 'VISUAL', text: 'Arena boundary: glowing cyan border with pulsing intensity and inner soft glow strip.' },
          { tag: 'VISUAL', text: 'Obstacles: 3D bevel illusion — gradient face with top-lit highlight edge and bottom-right shadow edge. Ambient occlusion contact shadow on the floor beneath each obstacle.' },
          { tag: 'VISUAL', text: 'Characters: proper radial drop shadow with AO contact ring and hero-color rim light on the ground beneath each character.' },
          { tag: 'VISUAL', text: 'Projectile motion trails: each projectile now stores the last 8 positions and draws a fading size-tapered trail behind it.' },
          { tag: 'VISUAL', text: 'Glow pass: after character draw, additive screen-blend halo drawn around every living character for a bloom effect without post-processing.' },
          { tag: 'VISUAL', text: 'Added hexWithAlpha() color helper. Added lightenColor() and darkenColor() helpers for obstacle bevel.' },
        ]
      },
      {
        v: 'v0.4.50', date: '2026-03-17',
        title: 'SFX Gap Fill — 12 New Sounds',
        changes: [
          { tag: 'AUDIO', text: 'Respawn — rising pulse when player comes back to life.' },
          { tag: 'AUDIO', text: 'CC feedback — distinct sounds for Stun (bell impact), Freeze (ice lock), Silence (muffled cut) when applied to player.' },
          { tag: 'AUDIO', text: 'Kill streaks — First Blood (dramatic low hit + sting), Double Kill (two-note), Triple Kill (three-note escalation), Unstoppable (four-chord power surge).' },
          { tag: 'AUDIO', text: 'Nuked — massive descending slam when player lands an ult kill.' },
          { tag: 'AUDIO', text: 'Sudden Death — ominous low bell toll when time runs out tied.' },
          { tag: 'AUDIO', text: 'Warp blocked — short dull thud when hitting a closed gate.' },
          { tag: 'AUDIO', text: 'Combo hit — bright ping when player lands a combo-window hit.' },
          { tag: 'AUDIO', text: 'Storm convergence — reverb swell when two zones merge (non-Maelstrom).' },
          { tag: 'AUDIO', text: 'Low mana — double soft pulse when player tries to cast without enough mana.' },
          { tag: 'AUDIO', text: 'Sprint collision — crunch when player rams an obstacle while sprinting.' },
        ]
      },
      {
        v: 'v0.4.49', date: '2026-03-17',
        title: 'Dr Sound Guru III — Full Audio Engine Rewrite',
        changes: [
          { tag: 'AUDIO', text: 'Complete audio engine rewrite. Added: FM synthesis (carrier + modulator), convolution reverb (synthetic room impulse), master compressor chain, ADSR envelopes on all sounds, chorus/LFO modulation, stereo panning, waveshaper distortion with 4x oversampling, delay lines.' },
          { tag: 'AUDIO', text: 'Each hero now has 3 unique ability sounds designed for their element — EMBER crackles and burns, TIDE rumbles with pressure, STONE seismic thuds, GALE slices and howls, VOID tears dark glitches, MYST shimmers crystalline, VOLT cracks instant electric, FROST pings glass and hisses cold, FORGE clangs industrial metal, FLORA snaps woody organic.' },
          { tag: 'AUDIO', text: 'Maelstrom spawn: massive sub-bass surge with reverb tail. Maelstrom implode: everything collapses to void with aftershock.' },
          { tag: 'AUDIO', text: 'Arena hum upgraded to 3-oscillator drone with subtle LFO tremolo. All SFX routed through master compressor to prevent clipping.' },
        ]
      },
      {
        v: 'v0.4.48', date: '2026-03-17',
        title: 'SFX Sweep — Major Immersion Pass',
        changes: [
          { tag: 'AUDIO', text: 'Countdown beeps — 3 low ticks then a bright GO! chord on match start.' },
          { tag: 'AUDIO', text: 'Auto-attack — short element-tuned cast sound when player fires a basic attack.' },
          { tag: 'AUDIO', text: 'Hit received — dull thud when player takes damage, heavy crunch on a crit.' },
          { tag: 'AUDIO', text: 'Sprint — air whoosh on activation.' },
          { tag: 'AUDIO', text: 'Warp gate — digital teleport sweep on all 4 gate exits.' },
          { tag: 'AUDIO', text: 'Rock hit — low thud when obstacle takes projectile damage.' },
          { tag: 'AUDIO', text: 'Rock destroy — deep crunch + debris scatter when large rock is destroyed.' },
          { tag: 'AUDIO', text: 'Health pickup — rising chime on collect.' },
          { tag: 'AUDIO', text: 'Mana pickup — soft rising tone on collect.' },
          { tag: 'AUDIO', text: 'Maelstrom spawn — massive dramatic swell on zone formation.' },
          { tag: 'AUDIO', text: 'Maelstrom implode — deep descending crunch on implosion.' },
        ]
      },
      {
        v: 'v0.4.47', date: '2026-03-17',
        title: 'Rock Item Drops',
        changes: [
          { tag: 'FEATURE', text: 'Large rocks now have a 30% chance to drop a health or mana pack when destroyed (55/45 split). Fragments and small rocks never drop. Works on both melee/sprint destruction and projectile/rock buster hits. Drops fly out at a random angle and are fully collectible.' },
        ]
      },
      {
        v: 'v0.4.46', date: '2026-03-17',
        title: 'Target Reticle on Canvas — DOM Frame Removed',
        changes: [
          { tag: 'UI', text: 'Removed solo bottom-center target frame DOM element — no more looking away from the action.' },
          { tag: 'UI', text: 'Solo target now shown directly on canvas: thick red pulsing dashed ring, bright corner brackets, and HP% label above the target in world space. Everything you need is right on top of the enemy.' },
          { tag: 'UI', text: 'MP target rings unchanged — player-colored rings for each human player\'s locked target.' },
        ]
      },
      {
        v: 'v0.4.45', date: '2026-03-17',
        title: 'Team Color on Character HP Bars',
        changes: [
          { tag: 'UI', text: 'HP bars now use team color instead of hero color in team matches — instantly tells you friend from foe at a glance. A thin team color strip always shows below the HP bar regardless of HP level so the team ID is readable even when HP is critical and bar turns red.' },
          { tag: 'UI', text: 'FFA mode (every player on their own team) keeps the original hero color HP bars since all opponents are enemies anyway.' },
        ]
      },
      {
        v: 'v0.4.44', date: '2026-03-17',
        title: 'Team Score Pills — Up to 6 Teams',
        changes: [
          { tag: 'UI', text: 'Team score display replaced with compact colored pills below the timer — one pill per team, each in their team color. Leading team shows brighter pill + white text. Supports all team configurations from 2-team to 6-way FFA.' },
        ]
      },
      {
        v: 'v0.4.43', date: '2026-03-17',
        title: 'Live Team Scores on HUD',
        changes: [
          { tag: 'UI', text: 'Team kill totals now display on the canvas HUD flanking the match timer — team 0 on the left, team 1 on the right, each in their team color. Win condition has always been team-based (gs.teamKills), now it\'s obvious at a glance during play. Hidden on unlimited kill matches.' },
        ]
      },
      {
        v: 'v0.4.42', date: '2026-03-17',
        title: 'Session Wrap — Spectator Buttons Tabled',
        changes: [
          { tag: 'FIX', text: 'Spectator ability buttons confirmed working in JS (5 children created every frame). CSS visibility issue tabled for next session — DevTools element inspection needed.' },
        ]
      },
      {
        v: 'v0.4.41', date: '2026-03-17',
        title: 'Spectator Ability Buttons CSS Fix',
        changes: [
          { tag: 'FIX', text: 'Spectator ability buttons confirmed present in DOM (5 children, running every frame) but invisible due to CSS. Fixed: replaced clamp() sizing with fixed px values, changed align-items from flex-end to center, changed overflow:hidden to overflow:visible on buttons so children aren\'t clipped.' },
        ]
      },
      {
        v: 'v0.4.40', date: '2026-03-17',
        title: 'Spectator Debug Build 2',
        changes: [
          { tag: 'DEBUG', text: 'Added console.log to updateSpectatorOverlay to confirm it runs and finds abEl in true all-CPU spectator mode.' },
        ]
      },
      {
        v: 'v0.4.39', date: '2026-03-17',
        title: 'Spectator Abilities Debug Build',
        changes: [
          { tag: 'DEBUG', text: 'Added red outline and min-height to #spec-abilities to diagnose why ability buttons are not visible in spectator mode.' },
        ]
      },
      {
        v: 'v0.4.38', date: '2026-03-17',
        title: 'Spectator Ability Buttons Fix (for real)',
        changes: [
          { tag: 'FIX', text: 'Removed hero ID cache entirely from spectator ability overlay — now rebuilds buttons every frame with live cooldown states baked in. Cache was silently preventing the initial render.' },
        ]
      },
      {
        v: 'v0.4.37', date: '2026-03-17',
        title: 'Spectator Ability Buttons Fix',
        changes: [
          { tag: 'FIX', text: 'Spectator ability buttons were not rendering due to stale _lastHeroId cache on the DOM element. Fixed: null guard added, _lastHeroId reset when spectate target changes, and optional chaining on hero.abilities in case of null ref.' },
        ]
      },
      {
        v: 'v0.4.36', date: '2026-03-17',
        title: 'Spectator Overlay Polish — Backlog Complete',
        changes: [
          { tag: 'FIX', text: 'Rock Buster slot added to spectator ability overlay — was missing entirely. Now shows 🪨 BUSTER with live cooldown alongside Q/E/R/Special.' },
          { tag: 'FIX', text: 'Spectator CD update loop was using array index instead of dataset.abIdx — Special was reading the wrong cooldown slot. Fixed to use abIdx directly for all slots.' },
        ]
      },
      {
        v: 'v0.4.35', date: '2026-03-17',
        title: 'Maelstrom Implode Timer 5s',
        changes: [
          { tag: 'BALANCE', text: 'Maelstrom implode timer reduced from 8s to 5s — less time to escape, more pressure from the yank. HTP updated.' },
        ]
      },
      {
        v: 'v0.4.34', date: '2026-03-17',
        title: 'Per-Player Scoreboard YOU Label',
        changes: [
          { tag: 'FEATURE', text: 'In couch MP, the scoreboard now shows (YOU) next to whichever player opened it — P4 opens it and sees their own row highlighted as YOU, while P1/P2/P3 show as their respective labels. Previously only P1 could open the scoreboard; now any player can.' },
          { tag: 'FIX', text: 'Scoreboard row highlight (is-player) now only applies to the viewing player\'s row, not all human player rows.' },
        ]
      },
      {
        v: 'v0.4.33', date: '2026-03-17',
        title: 'Scoreboard Team Column',
        changes: [
          { tag: 'UI', text: 'Team name moved out of the HERO cell into its own dedicated TEAM column on both the mid-match score overlay and win screen. Displayed in team color, bold. Much easier to read at a glance.' },
        ]
      },
      {
        v: 'v0.4.32', date: '2026-03-17',
        title: 'Infinite Loop Freeze Fix',
        changes: [
          { tag: 'FIX', text: 'Found the real cause of all browser-hang freezes: _reserveMajorSlot() had a while loop that could spin forever. When gap < MIN_GAP but (MIN_GAP - gap) was floating-point near-zero, shifted never accumulated enough to exit the loop and changed stayed true — locking the main thread. Music kept playing because audio runs on a separate thread, browser became unresponsive.' },
          { tag: 'FIX', text: 'Fixed by ensuring the nudge amount is always at least MIN_GAP * 0.5, so shifted always makes meaningful progress. Added a hard safetyIter cap of 20 iterations as a belt-and-suspenders guard.' },
        ]
      },
      {
        v: 'v0.4.31', date: '2026-03-17',
        title: 'Canvas Save Stack Overflow Fix',
        changes: [
          { tag: 'FIX', text: 'Root cause of silent render freezes found: any thrown error inside render() was caught by the gameLoop try/catch, but the canvas ctx.save() calls inside render were never matched with ctx.restore(). Each caught error leaked 2 saves. After enough frames the browser\'s canvas transform stack silently saturated and rendering stopped while the loop kept running — no console error, game appears frozen.' },
          { tag: 'FIX', text: 'Added try/finally blocks around the two outer ctx.save() regions in render() so restores are guaranteed even if something throws mid-frame.' },
          { tag: 'FIX', text: 'Added ctx.resetTransform() safety call at the top of each render() to flush any leaked state from previous frames.' },
          { tag: 'FIX', text: 'gameLoop catch block now calls ctx.restore() x6 and resets transform/alpha/composite on any caught error to prevent accumulation.' },
        ]
      },
      {
        v: 'v0.4.30', date: '2026-03-17',
        title: 'Maelstrom Freeze Fix',
        changes: [
          { tag: 'FIX', text: 'Fixed game freeze during active Maelstrom — buff label loop in drawChar would throw if a zone entry had an undefined def (zone expired mid-frame while inWeatherAll still held a stale reference). Added null guard to skip those entries safely.' },
          { tag: 'FIX', text: 'Guarded def.color and def.icon in buff label draw calls — previously threw if def existed but had no color/icon property.' },
          { tag: 'FIX', text: 'Both scoreboard builders (win screen and score overlay) now filter out any chars with undefined hero before building rows — prevents TypeError during Maelstrom kill chains where chars can be mid-kill.' },
          { tag: 'FIX', text: 'teamId now uses ?? 0 fallback in all scoreboard row builders to prevent TEAM_COLORS[undefined] lookups.' },
        ]
      },
      {
        v: 'v0.4.29', date: '2026-03-17',
        title: 'AI currentZoneScore ReferenceError Fix',
        changes: [
          { tag: 'FIX', text: 'Fixed ReferenceError: currentZoneScore is not defined — firing every frame on every bot, hammering CPU. Variable was declared inside the weather eval timer block but referenced outside it in the escape waypoint clear check. Replaced with a simple getWeatherAt() call that is always in scope.' },
        ]
      },
      {
        v: 'v0.4.28', date: '2026-03-17',
        title: 'AI Freeze + Wall-Hug Fix + Rock Density',
        changes: [
          { tag: 'FIX', text: 'Removed lateral wall sliding during flee — was the primary cause of bots hugging edges indefinitely. Replaced with center-pull blend at 80% strength when near walls, regardless of warp cooldown.' },
          { tag: 'FIX', text: 'Wall margin widened from 120px to 280px so center-pull kicks in before bots reach the edge.' },
          { tag: 'FIX', text: 'Roam stuck-break: if a bot hasn\'t moved for 0.8s during roam, it fires a random nudge to break obstacle lock.' },
          { tag: 'FIX', text: 'Global stuck-break: if any bot is frozen for 1.5s while not in hold state, nudge it toward its target with randomness to escape geometry.' },
          { tag: 'FIX', text: 'Storm escape waypoints now use 55-70% blend strength (up from 18-30%) so bots actually exit harmful zones instead of being pulled back in by flee/chase. Escape waypoint clears once the bot is out of the harmful zone.' },
          { tag: 'BALANCE', text: 'Large rock count increased from 3-5 to 5-8 at match start.' },
        ]
      },
      {
        v: 'v0.4.27', date: '2026-03-17',
        title: 'HTP Update',
        changes: [
          { tag: 'UI', text: 'Couch Multiplayer section updated — now correctly says up to 4 players, lists all four player colors (gold/cyan/orange/lime), describes P3/P4 overlay positions.' },
          { tag: 'UI', text: 'Maelstrom tip in Storm Convergence completely rewritten — yank on spawn, 8s implode timer, depth-scaled damage (10-90%), 90s cooldown, 🌀 HUD indicator.' },
          { tag: 'UI', text: 'Sprint section updated — notes that sprint gives partial Maelstrom slow relief but won\'t save you at the core.' },
        ]
      },
      {
        v: 'v0.4.26', date: '2026-03-17',
        title: 'Damage Float Threshold 50',
        changes: [
          { tag: 'BALANCE', text: 'Damage number threshold raised from 10 to 50 — only meaningful hits show. Crits always show regardless of value.' },
        ]
      },
      {
        v: 'v0.4.25', date: '2026-03-17',
        title: 'Damage Float Cleanup + Maelstrom Kill Tracking',
        changes: [
          { tag: 'UI', text: 'Damage floats below 10 are suppressed — chip auto-attack noise no longer clutters the screen. Crits always show regardless of value.' },
          { tag: 'UI', text: 'Anti-overlap: new damage numbers check for existing floats in the same screen area and nudge downward/sideways to avoid stacking on identical positions.' },
          { tag: 'FEATURE', text: 'Maelstrom kills tracked separately per character as maelstromDeaths. Feed shows "☄ STONE killed by MAELSTROM". Screams death text shows MAELSTROM! in white.' },
          { tag: 'FEATURE', text: 'Scoreboard (both mid-match and win screen) shows a ☄ column only when someone actually died to the Maelstrom — blank matches stay clean, chaos matches get called out.' },
        ]
      },
      {
        v: 'v0.4.24', date: '2026-03-17',
        title: 'Damage Number Scaling',
        changes: [
          { tag: 'UI', text: 'Damage numbers now scale in size with the value — chip damage (1-20) is tiny and forgettable, big hits (200+) are large and alarming, crits get an additional 25% size boost. Logarithmic scale from 14px to 38px (crits up to 42px).' },
          { tag: 'UI', text: 'Larger numbers also rise/fall slightly faster so they clear the screen before smaller numbers do.' },
        ]
      },
      {
        v: 'v0.4.23', date: '2026-03-17',
        title: 'Maelstrom Cooldown Indicator + Zone Warning Rings',
        changes: [
          { tag: 'UI', text: 'Maelstrom cooldown indicator appears below the match timer after the first Maelstrom fires — shows 🌀 47s counting down, then pulses 🌀 READY when available. Hidden until first Maelstrom so early game is uncluttered.' },
          { tag: 'UI', text: 'Positioned to never overlap the ∞ symbol on unlimited time matches.' },
          { tag: 'UI', text: 'Zone rings pulse faster and shift toward white as two zones approach merge distance (when Maelstrom cooldown is up) — pure visual signal, no numbers.' },
        ]
      },
      {
        v: 'v0.4.22', date: '2026-03-17',
        title: 'Scoreboard Team Labels',
        changes: [
          { tag: 'UI', text: 'Scoreboard rows now show full team name ("YELLOW TEAM", "BLUE TEAM") in their team color instead of a small dot. Applies to both the in-match score overlay and the post-match win screen. Always visible in FFA and team modes.' },
        ]
      },
      {
        v: 'v0.4.21', date: '2026-03-17',
        title: 'Maelstrom Yank + Slow Tuning',
        changes: [
          { tag: 'BALANCE', text: 'Yank strength increased from 55% to 75% of distance to center — no distance cap. Everyone gets pulled hard regardless of map position.' },
          { tag: 'BALANCE', text: 'Yank stun increased from 0.4s to 1.2s — enough time for the pull to land before players can react.' },
          { tag: 'BALANCE', text: 'Slow curve changed from quadratic to cubic — catastrophically slow at center (8% speed), tapers to 85% at edge. Much more punishing in the inner core.' },
          { tag: 'BALANCE', text: 'Sprint relief reduced from 0.35 to 0.12 factor — sprint still helps but center players are stuck at ~20% speed even while sprinting.' },
        ]
      },
      {
        v: 'v0.4.20', date: '2026-03-17',
        title: 'First Blood Feed Fix',
        changes: [
          { tag: 'FIX', text: 'First Blood in the scrolling feed now shows the killer\'s name — e.g. "EMBER: FIRST BLOOD" with the hero name in their element color. Was previously showing just "FIRST BLOOD" with no attribution.' },
        ]
      },
      {
        v: 'v0.4.19', date: '2026-03-17',
        title: 'Maelstrom Depth Slow + Scaled Implode',
        changes: [
          { tag: 'BALANCE', text: 'Maelstrom now applies a depth-based slow — center is brutal (15% speed), edge is barely felt (90% speed). Quadratic falloff so the real punishment is close to the core.' },
          { tag: 'BALANCE', text: 'Sprint gives meaningful relief: sprinting at center gets you to ~50% speed instead of 15% — the clear escape tool, but still a fight to reach the edge.' },
          { tag: 'BALANCE', text: 'Implode damage now scales by depth: center = 90% maxHp (nearly lethal), edge = 10% maxHp (survivable). Quadratic curve — mostly punishing in the inner third.' },
        ]
      },
      {
        v: 'v0.4.18', date: '2026-03-17',
        title: 'Unlimited Match ∞ Indicator',
        changes: [
          { tag: 'UI', text: 'Unlimited time matches now show a small faded ∞ symbol below the elapsed count-up timer so it\'s clear the match has no time limit.' },
        ]
      },
      {
        v: 'v0.4.17', date: '2026-03-17',
        title: 'Maelstrom Overhaul',
        changes: [
          { tag: 'FEATURE', text: 'Maelstrom spawn yanks all alive characters toward the centre regardless of map position — up to 55% of their distance, capped at 420px. Brief 0.4s stun on yank.' },
          { tag: 'BALANCE', text: 'Implode timer reduced from 15s to 8s — fast and dangerous.' },
          { tag: 'BALANCE', text: '1s grace window on spawn before implode countdown starts — enough time to register what happened.' },
          { tag: 'BALANCE', text: '90s cooldown between Maelstroms. Match-length cap: ≤4 min = max 2, 4-8 min = max 3, 8+ min = max 4. Unlimited time matches have no cap.' },
          { tag: 'UI', text: 'Countdown timer hidden during grace period so it doesnt flash 9 on spawn.' },
        ]
      },
      {
        v: 'v0.4.16', date: '2026-03-17',
        title: 'Maelstrom Convergence Fix',
        changes: [
          { tag: 'FIX', text: 'Converged storm + any other storm now correctly triggers Maelstrom. Previously the 3-zone check required 3 simultaneous active zones, but maxZones=2 for the first 66% of the match — after two zones merged into one converged zone, only 2 total zones could ever exist, making Maelstrom unreachable.' },
          { tag: 'FIX', text: 'A converged zone already represents 2 merged storms, so converged + 1 regular = 3 original storms worth of energy = Maelstrom. This is now a dedicated check that runs before the 3-zone check.' },
        ]
      },
      {
        v: 'v0.4.15', date: '2026-03-17',
        title: 'Syntax Error Fix',
        changes: [
          { tag: 'FIX', text: 'Fixed SyntaxError: Unexpected token } on load — a literal \\n escape sequence was written into ai.js during the v0.4.14 str_replace, breaking JS parsing.' },
        ]
      },
      {
        v: 'v0.4.14', date: '2026-03-17',
        title: 'AI Pull Escape ReferenceError Fix',
        changes: [
          { tag: 'FIX', text: 'Fixed ReferenceError: Cannot access targetVX before initialization — firing every frame in updateAI, swallowed by the gameLoop catch but hammering performance (2155 errors visible in console).' },
          { tag: 'FIX', text: 'The black hole pull escape block added in v0.4.04 used targetVX before the let declaration below it — a JavaScript temporal dead zone violation. Moved let targetVX = 0 above the pull escape block.' },
        ]
      },
      {
        v: 'v0.4.13', date: '2026-03-17',
        title: 'Unlimited Time — Elapsed Counter',
        changes: [
          { tag: 'UI', text: 'Unlimited time matches now show an elapsed MM:SS counter instead of the ∞ symbol — e.g. 04:32 counting up. Timed matches are unaffected and still count down.' },
        ]
      },
      {
        v: 'v0.4.12', date: '2026-03-17',
        title: 'Score Header — All Teams with Colors',
        changes: [
          { tag: 'UI', text: 'Score overlay header now shows all teams in descending kill order, each in their team color — e.g. 6 — 5 — 5 — 3 in blue/red/green/purple. Previously hardcoded to a 2-team cyan vs red layout.' },
          { tag: 'UI', text: 'Team color dots in the scoreboard rows now use the actual TEAM_COLORS entry for each character rather than hardcoded cyan/red.' },
          { tag: 'UI', text: 'Player labels in score overlay now show P1/P2/P3/P4 in their player color in MP, or (YOU) in solo.' },
        ]
      },
      {
        v: 'v0.4.11', date: '2026-03-17',
        title: 'Scoreboard Duplicate Entries Fix',
        changes: [
          { tag: 'FIX', text: 'Fixed duplicate hero entries in scoreboard during spectator mode. In spectator, gs.enemies[0] is the same dummy char as gs.players[0] — spreading both arrays produced duplicates. Both showScoreOverlay and endGame now deduplicate with Set before building the scoreboard.' },
        ]
      },
      {
        v: 'v0.4.10', date: '2026-03-17',
        title: 'Remove Match Start Tooltip',
        changes: [
          { tag: 'UI', text: 'Removed the "Move with joystick. Use Q/E/R to cast abilities!" tooltip that appeared 3.8s into every match — not relevant when playing with keyboard or controller.' },
        ]
      },
      {
        v: 'v0.4.09', date: '2026-03-17',
        title: 'MP Float Crash Fix — Root Cause',
        changes: [
          { tag: 'FIX', text: 'Found and fixed the true root cause of the converged storm crash. _getChar() in controls.js only searched gameState.player + gameState.enemies — completely missing P2/P3/P4 who live in gameState.players[]. Any float spawned near P2/P3/P4 returned char=null.' },
          { tag: 'FIX', text: 'spawnFloat cc/self category branches then tried null._floatCcY or null._floatSelfY — TypeError — crashing the game loop. Converged storms were the trigger because they fire PULLED/STUNNED floats on all players simultaneously, near-guaranteeing a P2/P3/P4 hit.' },
          { tag: 'FIX', text: '_getChar() now searches gameState.players[] (all human players) + gameState.enemies. Self category branch now has the same null guard the cc branch already had.' },
        ]
      },
      {
        v: 'v0.4.08', date: '2026-03-17',
        title: 'Converged Storm Death Freeze Fix',
        changes: [
          { tag: 'FIX', text: 'Fixed game freeze on death inside any converged storm (Whiteout, Flashpoint, Singularity, etc). The endGame setTimeout had no error handling — any throw in the win screen build would leave the game frozen with BGM still playing and no win screen ever appearing.' },
          { tag: 'FIX', text: 'Storm zone kills (Flashpoint detonation, Magma Surge damageRate, Maelstrom implode) were defaulting killerTeam to 1 when there was no attacker, incorrectly crediting team 1 and potentially triggering a false endGame mid-match.' },
          { tag: 'FIX', text: 'Storm kills with no attacker now use killerTeam = -1 and skip teamKills credit entirely — environment kills dont count toward any team\'s score.' },
          { tag: 'FIX', text: 'endGame now hides tf-p3 and tf-p4 target panes on match end, not just tf-p1/tf-p2.' },
        ]
      },
      {
        v: 'v0.4.07', date: '2026-03-17',
        title: 'Singularity Crash Fix',
        changes: [
          { tag: 'FIX', text: 'Fixed game loop crash when dying inside Singularity. v0.4.05 introduced a bad getArenaBounds() call inside applyWeatherToChar — was constructing a fake gs object instead of passing the real gs param, throwing on every pull frame and stopping rendering.' },
          { tag: 'FIX', text: 'getArenaBounds now correctly receives the gs argument already available in applyWeatherToChar.' },
        ]
      },
      {
        v: 'v0.4.06', date: '2026-03-17',
        title: 'Singularity Respawn Lockout Fix',
        changes: [
          { tag: 'FIX', text: 'Fixed lockout when dying inside a Singularity. weatherBlackholePull was persisting across death — player would respawn at a safe position then immediately get yanked back into the zone before they could move.' },
          { tag: 'FIX', text: 'respawnChar() now clears weatherBlackholePull, _bhSpeedMult, and _bhReactTimer so respawned characters always start with a clean pull state.' },
        ]
      },
      {
        v: 'v0.4.05', date: '2026-03-17',
        title: 'Singularity Wall-Pin Fix (Human Players)',
        changes: [
          { tag: 'FIX', text: 'Human players can no longer be pinned to arena walls by Singularity or Black Hole. Pull nudge is now clamped to arena bounds every frame, so no amount of pull force can push a player through a boundary.' },
          { tag: 'FIX', text: 'Sprint now grants full pull immunity for all pull types including Singularity (force=520) — previously pullSpeedMult=0.30 was being set even during sprint, making escape nearly impossible under Singularity.' },
          { tag: 'FIX', text: 'Previous fix (v0.4.04) only addressed bots via AI movement override. This fixes the same class of bug for human players directly in the pull physics in state.js.' },
        ]
      },
      {
        v: 'v0.4.04', date: '2026-03-17',
        title: 'Singularity/Black Hole Bot Freeze Fix',
        changes: [
          { tag: 'FIX', text: 'Bots no longer freeze inside Singularity or Black Hole zones. Previous fix only triggered sprint but never overrode movement direction — bots would sprint toward their target, get dragged back in, and loop forever.' },
          { tag: 'FIX', text: 'New pull escape override: when weatherBlackholePull is active on a bot, movement direction is immediately set to directly away from the pull center, sprint is forced every frame until clear, and the rest of the state machine is skipped for that frame.' },
          { tag: 'FIX', text: 'Singularity (force=520, pullSpeedMult=0.30) was 2.6x stronger than normal Black Hole — the old sprint-only fix was never enough. Direct position override now wins regardless of pull strength.' },
        ]
      },
      {
        v: 'v0.4.03', date: '2026-03-17',
        title: 'P3/P4 Diamond Layout Fix',
        changes: [
          { tag: 'FIX', text: 'P3 and P4 controller overlays now use the correct diamond grid layout matching P1/P2 — shoulder buttons top row, face buttons in diamond formation.' },
          { tag: 'FIX', text: 'Added gamepad-mode grid-column/grid-row rules for all p3-btn-* and p4-btn-* IDs — previously only p2-btn-* had these rules so P3/P4 fell back to a plain 2-column grid.' },
        ]
      },
      {
        v: 'v0.4.02', date: '2026-03-17',
        title: 'P3/P4 Couch Multiplayer',
        changes: [
          { tag: 'FEATURE', text: 'Full 3 and 4 player local co-op - P3 and P4 are fully routed from gamepads 2/3 through the existing per-gamepad input system.' },
          { tag: 'FEATURE', text: 'P3 HUD overlay top-left (orange tint), P4 top-right (lime tint) - ability names, cooldowns, sprint and special timers all live-update.' },
          { tag: 'FEATURE', text: 'Body classes mp3-mode and mp4-mode drive CSS layout - P3/P4 overlays appear automatically based on human slot count.' },
          { tag: 'FEATURE', text: 'Target panes tf-p3 and tf-p4 show each player\'s locked target with HP/mana readout.' },
          { tag: 'FEATURE', text: 'Camera already handled multi-player bounding box zoom - works seamlessly for 3/4 players.' },
          { tag: 'FIX', text: 'getSafeSpawnPos now checks all gs.players not just gs.player - P3/P4 respawn safely away from all human players.' },
          { tag: 'FIX', text: 'cleanupGame() now removes mp3-mode and mp4-mode classes and hides P3/P4 overlays on match exit.' },
        ]
      },
      {
        v: 'v0.4.01', date: '2026-03-17',
        title: 'NUKED + Player Event Feed',
        changes: [
          { tag: 'FEATURE', text: 'Ult kills now show NUKED! instead of ELIMINATED! - bigger, magenta, more screen shake. Everyone sees it: victim, killer (NUKED STONE), and spectator feed.' },
          { tag: 'FEATURE', text: 'Player event feed - same scrolling feed as spectator, lives top-right during normal matches. Shows eliminations, nukes, first blood, multi-kills, ON FIRE.' },
          { tag: 'UI', text: 'Killer sees NUKED [hero name] world-space confirmation above their character on ult kills.' },
          { tag: 'UI', text: 'Feed text colours match hero colours - killer name in their element colour, NUKED in magenta, event tags in their established colours.' },
        ]
      },
      {
        v: 'v0.3.99', date: '2026-03-17',
        title: 'Spectator Feed Hero Colors',
        changes: [
          { tag: 'UI', text: 'Spectator kill feed now renders killer names in their hero color - EMBER eliminated STONE shows EMBER in fire orange, eliminations and streaks in their event color' },
        ]
      },
      {
        v: 'v0.3.98', date: '2026-03-17',
        title: 'Spectator Feed Stability',
        changes: [
          { tag: 'FIX', text: 'Removed all spectator world-space spawnFloat calls - they were routing through the player float machinery and crashing when multiple kills fired near a black hole' },
          { tag: 'UI', text: 'Spectator kill feed is now the sole event display - font bumped up, thicker stroke, 4.5s entry lifetime so rapid multi-kills are all readable' },
        ]
      },
      {
        v: 'v0.3.97', date: '2026-03-17',
        title: 'Spectator & Maelstrom Crash Fixes',
        changes: [
          { tag: 'FIX', text: 'Fixed spectator feed crash - was calling getContext(2d) a second time mid-frame which conflicts with the active render pipeline in Safari. Now uses the existing global canvas context.' },
          { tag: 'FIX', text: 'Maelstrom implode now snapshots the character list before dealing damage, preventing re-entrancy issues when multiple kills fire in the same implosion frame' },
          { tag: 'FIX', text: 'Removed stale extra closing brace in Maelstrom implode loop from previous refactor' },
        ]
      },
      {
        v: 'v0.3.96', date: '2026-03-17',
        title: 'Spectator Float Fix',
        changes: [
          { tag: 'FIX', text: 'Fixed lockup and overlapping text in spectator - world-space kill floats no longer pass AI char refs into the player cooldown/stacking system' },
          { tag: 'FIX', text: 'ELIMINATED! and DOUBLE KILL no longer render on top of each other - floats now use raw coordinates only in spectator mode' },
        ]
      },
      {
        v: 'v0.3.95', date: '2026-03-17',
        title: 'Spectator Kill Feed + World Floats',
        changes: [
          { tag: 'FEATURE', text: 'Spectator now sees both: a scrolling kill feed on the right (who did what) AND the world-space text at the location it happened' },
          { tag: 'FEATURE', text: 'World floats in spectator: ELIMINATED!, FIRST BLOOD, DOUBLE KILL, TRIPLE KILL!, UNSTOPPABLE!!, ON FIRE! all appear above the character in-arena' },
          { tag: 'BALANCE', text: 'All of this is spectator-only - zero change to what players see in normal matches' },
        ]
      },
      {
        v: 'v0.3.94', date: '2026-03-17',
        title: 'Spectator Kill Feed',
        changes: [
          { tag: 'FEATURE', text: 'Spectator mode now shows a kill feed on the right side of the screen - FIRST BLOOD, eliminations, double/triple/unstoppable kills, and ON FIRE' },
          { tag: 'FEATURE', text: 'Feed is a completely separate screen-space system - zero impact on what players see in normal matches' },
          { tag: 'FIX', text: 'Removed previous attempt that injected into the world-space float system, which was causing crashes and overlapping text during big fights' },
        ]
      },
      {
        v: 'v0.3.93', date: '2026-03-17',
        title: 'Spectator Kill Events',
        changes: [
          { tag: 'FEATURE', text: 'Spectators now see FIRST BLOOD, ELIMINATED!, DOUBLE KILL, TRIPLE KILL!, UNSTOPPABLE!!, and ON FIRE! at world position above the character they happened to' },
          { tag: 'BALANCE', text: 'KILL! text remains player-only in non-spectator matches - too noisy to show every kill in spectator' },
        ]
      },
      {
        v: 'v0.3.92', date: '2026-03-17',
        title: 'Maelstrom Convergence Fix',
        changes: [
          { tag: 'FIX', text: 'Converged storms (combo zones) now count toward Maelstrom - previously only non-converged zones were checked' },
          { tag: 'FIX', text: 'Maelstrom now triggers as soon as any 3 active zones mutually overlap - including Plasma Storm + a third zone, or MEGA HEATWAVE + two others' },
          { tag: 'FIX', text: 'Maelstrom check now runs before the two-zone merge so three overlapping zones always collapse into Maelstrom rather than pair-merging first' },
        ]
      },
      {
        v: 'v0.3.91', date: '2026-03-17',
        title: 'Ultimate Cooldown Overhaul',
        changes: [
          { tag: 'BALANCE', text: 'All ult cooldowns raised to 26-34 seconds (up from 15-19s) - scaled by damage and utility' },
          { tag: 'BALANCE', text: 'EMBER Inferno: 15s → 34s (highest damage, was one-shotting full HP targets)' },
          { tag: 'BALANCE', text: 'VOID Annihilate: 18s → 32s  |  VOLT Thunderstrike: 18s → 32s (high damage + CC)' },
          { tag: 'BALANCE', text: 'TIDE Tsunami: 18s → 30s  |  STONE Tectonic Fury: 18s → 30s  |  MYST Singularity: 19s → 30s' },
          { tag: 'BALANCE', text: 'FROST Glacial Prison: 16s → 28s  |  FORGE Meltdown: 19s → 28s (control/short range)' },
          { tag: 'BALANCE', text: 'GALE Eye of Storm: 18s → 26s  |  FLORA Ancient Wrath: 19s → 26s (lowest damage ults)' },
          { tag: 'FEATURE', text: 'New mechanic: dealing damage with abilities reduces your ult cooldown - every 80 damage shaves 1 second off' },
          { tag: 'BALANCE', text: 'Damage-done reduction is capped at 40% of the ult base CD - a full combo can earn you back time but not trivially reset it' },
        ]
      },
      {
        v: 'v0.3.90', date: '2026-03-17',
        title: 'Storm Tuning',
        changes: [
          { tag: 'BALANCE', text: 'Storms now persist longer at match start - base lifetime increased from 28-48s to 40-65s' },
          { tag: 'BALANCE', text: 'Storm convergence threshold reduced from 60% to 45% overlap - storms merge more readily' },
          { tag: 'BALANCE', text: 'Infinite time matches now use a 10-24s spawn interval floor so storms appear consistently regardless of arena progress' },
        ]
      },
      {
        v: 'v0.3.89', date: '2026-03-17',
        title: 'Code Audit',
        changes: [
          { tag: 'CLEANUP', text: 'Removed two dead audio buffer variables that were declared but never used' },
          { tag: 'CLEANUP', text: 'Fixed a stale comment in the obstacle system that incorrectly described items as removed' },
        ]
      },
      {
        v: 'v0.3.88', date: '2026-03-17',
        title: 'Obstacle Respawn Crash Fix',
        changes: [
          { tag: 'FIX', text: 'Fixed a function scope error in the obstacle system where resolveObstacleCollisions body was accidentally nested inside updateObstacles during a previous refactor' },
        ]
      },
      {
        v: 'v0.3.87', date: '2026-03-17',
        title: 'Obstacle Respawn Variable Fix',
        changes: [
          { tag: 'FIX', text: 'Fixed crash in obstacle respawn queue - gs.enemies was not guarded against undefined' },
        ]
      },
      {
        v: 'v0.3.86', date: '2026-03-17',
        title: 'Obstacle Function Restore',
        changes: [
          { tag: 'FIX', text: 'Restored spawnObstacleFragments function header that was lost during a str_replace operation' },
        ]
      },
      {
        v: 'v0.3.85', date: '2026-03-17',
        title: 'Infinite Match Arena + Obstacle Respawns',
        changes: [
          { tag: 'FEATURE', text: 'Infinite time + kill matches now use a slow arena ebb cycle - the arena breathes in and out on a 90s period instead of staying full size forever' },
          { tag: 'FEATURE', text: 'Infinite time + limited kills: arena shrinks based on kill progress instead of time' },
          { tag: 'FEATURE', text: 'Destroyed obstacles now respawn after 8-14 seconds - cover density stays consistent in long matches' },
          { tag: 'VFX', text: 'Respawned obstacles fade in over 1.25 seconds so they appear smoothly' },
          { tag: 'FIX', text: 'Gate size, warp physics, and weather scaling now all derive from arena scale directly - consistent across all match modes' },
        ]
      },
      {
        v: 'v0.3.83', date: '2026-03-17',
        title: 'Scoreboard Touch Access',
        changes: [
          { tag: 'FEATURE', text: 'Added a SCOREBOARD button to the touch overlay - hold to view, release to hide, matches keyboard and controller behaviour' },
          { tag: 'FEATURE', text: 'Spectator overlay now has a SCORES button inline with the cycle hint for touch access' },
        ]
      },
      {
        v: 'v0.3.82', date: '2026-03-17',
        title: 'AI Auto-Attack Range Fix',
        changes: [
          { tag: 'FIX', text: 'AI bots were using a much longer auto-attack range formula than players - a melee bot on normal had 3x the range of a human melee player' },
          { tag: 'BALANCE', text: 'All bots now use the same base range as players (180 * class multiplier). Hard bots retain a small edge via their difficulty range multiplier' },
        ]
      },
      {
        v: 'v0.3.81', date: '2026-03-17',
        title: 'Rematch + Change Element',
        changes: [
          { tag: 'FEATURE', text: 'Win screen now has three options: REMATCH (same picks, instant restart), CHANGE ELEMENT (back to hero select with human slots cleared), and MENU' },
        ]
      },
      {
        v: 'v0.3.80', date: '2026-03-17',
        title: 'Change Element Flow',
        changes: [
          { tag: 'FEATURE', text: 'REMATCH button replaced with CHANGE ELEMENT - returns to hero select with human player slots unlocked for repicking. CPU slots stay intact.' },
        ]
      },
      {
        v: 'v0.3.79', date: '2026-03-17',
        title: 'Storm Gravity Tuning',
        changes: [
          { tag: 'BALANCE', text: 'Inter-storm gravitational pull strength bumped from 3.5 to 5.0 - storms more purposefully drift toward each other' },
        ]
      },
      {
        v: 'v0.3.78', date: '2026-03-17',
        title: 'Inter-Storm Gravity',
        changes: [
          { tag: 'FEATURE', text: 'Storms now gravitate toward each other instead of wandering independently - makes convergence feel purposeful rather than accidental' },
          { tag: 'BALANCE', text: 'Pull strength scales with arena size - strong attraction on a full arena, tapers to near-zero as walls close in since proximity handles it naturally' },
        ]
      },
      {
        v: 'v0.3.77', date: '2026-03-17',
        title: 'Spectator Overlay Polish',
        changes: [
          { tag: 'UI', text: 'Spectator ability buttons now show emoji icons above ability names' },
          { tag: 'FEATURE', text: 'Special ability slot (SLAM/SURGE/FOCUS) added to spectator overlay with its own cooldown tracking' },
          { tag: 'UI', text: 'Ult button is visually larger with gold border to distinguish from regular abilities' },
          { tag: 'UI', text: 'Buttons are bigger and more readable - bumped from 36px to 44-68px' },
        ]
      },
      {
        v: 'v0.3.76', date: '2026-03-17',
        title: 'Welcome Overlay Polish',
        changes: [
          { tag: 'UI', text: 'Welcome overlay buttons updated to pill shape (border-radius 20px) matching all other buttons in the app' },
          { tag: 'UI', text: 'Text centered, equal-width nav buttons via CSS grid, custom checkbox, top accent line, and separator rule' },
        ]
      },
      {
        v: 'v0.3.75', date: '2026-03-17',
        title: 'Welcome Overlay Copy',
        changes: [
          { tag: 'UI', text: 'Welcome overlay body text simplified - removed storm-specific details, kept high level. HTP and Roster do the talking.' },
        ]
      },
      {
        v: 'v0.3.74', date: '2026-03-17',
        title: 'Welcome Overlay Redesign',
        changes: [
          { tag: 'FEATURE', text: 'Welcome overlay now shows every time unless the player checks "Don\'t show again"' },
          { tag: 'UI', text: 'HOW TO PLAY and ELEMENT ROSTER shortcut buttons navigate directly from the overlay' },
          { tag: 'UI', text: 'LET\'S GO button replaces tap-anywhere dismiss - no more accidental closures' },
        ]
      },
      {
        v: 'v0.3.73', date: '2026-03-17',
        title: 'Storm Labels + Patch Notes Catch-Up',
        changes: [
          { tag: 'FIX', text: 'Storm zone labels now render on top of obstacles and characters - previously they were buried underneath' },
          { tag: 'FIX', text: 'Storm labels are clamped to the arena boundary so they never drift into the HUD' },
          { tag: 'UI', text: 'Patch notes updated with all versions from v0.3.63 through v0.3.72' },
        ]
      },
      {
        v: 'v0.3.84', date: '2026-03-17',
        title: 'Ultimate Damage Cap',
        changes: [
          { tag: 'BALANCE', text: 'Ultimates can no longer one-shot a full health target - a single ult hit is capped at 85% of the target\'s max HP' },
          { tag: 'BALANCE', text: 'Against targets already below 15% HP, ultimates deal full damage and can still kill - the cap only affects big hits on healthy targets' },
          { tag: 'BALANCE', text: 'Applies to all ultimates equally - not just EMBER and VOLT' },
        ]
      },
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
      'BALANCE':  { bg: 'rgba(255,200,0,0.10)',   border: 'rgba(255,200,0,0.30)',  text: '#ffc800' },
      'AUDIO':    { bg: 'rgba(0,200,255,0.10)',   border: 'rgba(0,200,255,0.30)',  text: '#00c8ff' },
      'FEEL':     { bg: 'rgba(200,100,255,0.10)', border: 'rgba(200,100,255,0.30)',text: '#c864ff' },
      'REFACTOR': { bg: 'rgba(180,180,180,0.08)', border: 'rgba(180,180,180,0.2)', text: '#aaaaaa' },
    };

    // Render directly to DOM to avoid innerHTML truncation on large datasets
    function renderPatchNotesDOM(container) {
      container.innerHTML = '';
      if (!document.getElementById('pn-styles')) {
        const s = document.createElement('style');
        s.id = 'pn-styles';
        s.textContent = '.pn-date{border:1px solid rgba(255,255,255,0.10);border-radius:6px;margin-bottom:10px;overflow:hidden;}.pn-date>summary{display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;user-select:none;list-style:none;background:rgba(255,255,255,0.05);transition:background 0.15s;}.pn-date>summary::-webkit-details-marker{display:none;}.pn-date>summary:hover{background:rgba(255,255,255,0.09);}.pn-date[open]>summary{border-bottom:1px solid rgba(255,255,255,0.08);}.pn-date-body{padding:8px 10px;display:flex;flex-direction:column;gap:6px;}.pn-entry{border:1px solid rgba(255,255,255,0.07);border-radius:5px;overflow:hidden;}.pn-entry>summary{display:flex;align-items:baseline;gap:10px;padding:8px 12px;cursor:pointer;user-select:none;list-style:none;background:rgba(255,255,255,0.02);transition:background 0.15s;}.pn-entry>summary::-webkit-details-marker{display:none;}.pn-entry>summary:hover{background:rgba(255,255,255,0.05);}.pn-entry[open]>summary{border-bottom:1px solid rgba(255,255,255,0.06);}.pn-chevron{margin-left:auto;font-size:10px;color:rgba(255,255,255,0.25);transition:transform 0.15s;}.pn-date[open]>summary .pn-chevron,.pn-entry[open]>summary .pn-chevron{transform:rotate(180deg);}.pn-body{padding:8px 12px;display:flex;flex-direction:column;gap:5px;}';
        document.head.appendChild(s);
      }
      // Build off-screen in a fragment — single reflow on append
      const frag = document.createDocumentFragment();
      const hdr = document.createElement('div');
      hdr.style.cssText = 'font-size:11px;color:var(--muted);letter-spacing:1px;margin-bottom:16px;';
      hdr.textContent = 'FULL CHANGELOG \u2014 ALL CHANGES SINCE LAUNCH';
      frag.appendChild(hdr);
      const byDate = {}, dateOrder = [];
      notes.forEach(p => { if (!byDate[p.date]) { byDate[p.date] = []; dateOrder.push(p.date); } byDate[p.date].push(p); });
      dateOrder.forEach((date, di) => {
        const dEl = document.createElement('details');
        dEl.className = 'pn-date'; dEl.open = (di === 0);
        const dSum = document.createElement('summary');
        dSum.innerHTML = '<span style="font-family:\'Orbitron\',monospace;font-size:12px;font-weight:900;color:rgba(255,255,255,0.7);letter-spacing:2px;">' + date + '</span><span style="font-size:10px;color:var(--muted);">' + byDate[date].length + ' version' + (byDate[date].length > 1 ? 's' : '') + '</span><span class="pn-chevron">\u25bc</span>';
        dEl.appendChild(dSum);
        const dBody = document.createElement('div'); dBody.className = 'pn-date-body';
        byDate[date].forEach((patch, pi) => {
          const eEl = document.createElement('details'); eEl.className = 'pn-entry';
          if (di === 0 && pi === 0) eEl.open = true;
          const eSum = document.createElement('summary');
          eSum.innerHTML = '<span style="font-family:\'Orbitron\',monospace;font-size:12px;font-weight:700;color:var(--accent);">' + patch.v + '</span><span style="font-family:\'Orbitron\',monospace;font-size:10px;font-weight:700;color:rgba(255,255,255,0.80);letter-spacing:0.5px;">' + patch.title + '</span><span class="pn-chevron">\u25bc</span>';
          eEl.appendChild(eSum);
          const eBody = document.createElement('div'); eBody.className = 'pn-body';
          patch.changes.forEach(c => {
            const tc = TAG_COLORS[c.tag] || TAG_COLORS['BUILD'];
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:flex-start;font-size:var(--fs-xs);color:rgba(255,255,255,0.70);line-height:1.5;';
            const tagEl = document.createElement('span');
            tagEl.style.cssText = 'display:inline-block;padding:1px 6px;border-radius:3px;font-size:9px;font-family:\'Orbitron\',monospace;font-weight:700;letter-spacing:0.5px;margin-right:6px;flex-shrink:0;background:' + tc.bg + ';border:1px solid ' + tc.border + ';color:' + tc.text + ';';
            tagEl.textContent = c.tag;
            const txtEl = document.createElement('span'); txtEl.textContent = c.text;
            row.appendChild(tagEl); row.appendChild(txtEl); eBody.appendChild(row);
          });
          eEl.appendChild(eBody); dBody.appendChild(eEl);
        });
        dEl.appendChild(dBody); frag.appendChild(dEl);
      });
      container.appendChild(frag); // single reflow
    }
    if (container) { renderPatchNotesDOM(container); return; }
    return ''; // no container — nothing to render inline
  }

  // ── Assemble ────────────────────────────────────────────────────
  const tabContent = optionsActiveTab === 'controls'   ? buildControlsTab()
                   : optionsActiveTab === 'audio'      ? buildAudioTab()
                   : optionsActiveTab === 'patchnotes' ? ''
                   : buildDisplayTab();

  el.innerHTML = `
    <div style="font-family:'Orbitron',monospace;color:var(--text);padding-bottom:32px;">
      ${tabBarHtml}
      <div style="padding:0 2px;" id="options-tab-body">
        ${tabContent}
      </div>
    </div>`;

  // Patch notes rendered directly into DOM after innerHTML set — avoids truncation on large content
  if (optionsActiveTab === 'patchnotes') {
    const pnTarget = el.querySelector('#options-tab-body');
    if (pnTarget) buildPatchNotesTab(pnTarget);
  }
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

function openTouchLayoutTest() {
  // Navigate to game screen (controls exist there) without starting a match.
  // enterLayoutEdit() provides its own DONE button that returns to options.
  document.body.classList.add('touch-mode');
  // Show game screen so controls are visible, but don't call initGame()
  const gameEl = document.getElementById('game');
  document.querySelectorAll('.screen.active').forEach(s => s.classList.remove('active'));
  if (gameEl) gameEl.classList.add('active');
  // Clear canvas to dark
  const canvas = document.getElementById('game-canvas');
  if (canvas) {
    const ctx2 = canvas.getContext('2d');
    if (ctx2) { ctx2.fillStyle = '#080c10'; ctx2.fillRect(0, 0, canvas.width, canvas.height); }
  }
  // Show label
  let lbl = document.getElementById('layout-test-label');
  if (!lbl) {
    lbl = document.createElement('div');
    lbl.id = 'layout-test-label';
    lbl.style.cssText = 'position:absolute;top:60px;left:50%;transform:translateX(-50%);' +
      'font-family:Orbitron,monospace;font-size:11px;letter-spacing:2px;' +
      'color:rgba(0,212,255,0.4);pointer-events:none;white-space:nowrap;z-index:9998;';
    lbl.textContent = 'DRAG BUTTONS TO REPOSITION';
    document.getElementById('game').appendChild(lbl);
  }
  lbl.style.display = 'block';
  if (typeof enterLayoutEdit === 'function') {
    // Override DONE to go back to options and hide label
    const origExit = window.exitLayoutEdit;
    window.exitLayoutEdit = function() {
      origExit && origExit();
      lbl.style.display = 'none';
      window.exitLayoutEdit = origExit; // restore
      showScreen('options');
    };
    enterLayoutEdit();
  }
}

function closeTouchLayoutTest() {
  if (typeof exitLayoutEdit === 'function') exitLayoutEdit();
  showScreen('options');
}

function toggleCouchMode() {
  const on = document.body.classList.toggle('couch-mode');
  localStorage.setItem('ec_couchMode', on ? '1' : '0');
  // Rebuild display tab to reflect new state
  const containerId = document.getElementById('options-inner') ? 'options-inner' : 'options-ingame-inner';
  if (containerId && document.getElementById(containerId)) buildOptionsPanel(containerId, 'display');
}

// Restore couch mode on page load
if (localStorage.getItem('ec_couchMode') === '1') document.body.classList.add('couch-mode');

function showScreen(id) {
  // If navigating away from a game to a non-game screen, stop the engine
  if (id === 'menu' || id === 'hero-select' || id === 'hero-select-solo' || id === 'tutorial-hero-select') {
    if (id !== 'hero-select') PlayerCursors.stop(true); // clear assignments on exit
    cleanupGame();
    if (id !== 'tutorial-hero-select') endTutorial(true); // silent cleanup
  }
  if (id === 'game') PlayerCursors.stop(true);
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
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
    clearTimeout(window._pcStartTimer); window._pcStartTimer = setTimeout(() => PlayerCursors.start(), 120);
    // Start Smash-style cursors after grid is built (delayed so DOM is ready)
  }
  if (id === 'hero-select-solo') buildHeroGrid('hero-grid-solo','hero-detail-solo');
  if (id === 'tutorial-hero-select') buildTutorialHeroGrid();
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

// ── PlayerCursors — full-screen per-player cursors for hero select ───────────
// P1 cursor always visible — driven by mouse by default, controller blends in.
// P2/P3/P4 cursors appear when their gamepad is connected.
// System cursor is hidden on hero-select; P1 cursor replaces it visually.
const PlayerCursors = (() => {
  let cursors    = [];
  let rafId      = null;
  let active     = false;
  let _mouseHandler = null;
  let _styleTag  = null;
  const _savedPos = {};
  // browserSlot → gpIdx assignment locked on first start(), cleared on full stop()
  // Prevents re-entering hero-select from reshuffling which controller is P1/P2/etc.
  const MAX_SPEED = 1400;
  const ACCEL_T  = 0.08;
  const DECEL_T  = 0.12;

  // Current input mode — driven by global body class
  function _inputMode() {
    const b = document.body.classList;
    if (b.contains('touch-mode'))    return 'touch';
    if (b.contains('gamepad-mode'))  return 'gamepad';
    return 'keyboard'; // default
  }

  function _clickable(el) {
    while (el && el !== document.body) {
      if (el.tagName === 'BUTTON' || el.tagName === 'A' ||
          el.onclick || el.classList.contains('hero-card') ||
          el.classList.contains('lslot-toggle-wrap') ||
          el.classList.contains('lslot-team-dot') ||
          el.classList.contains('lslot-slot')) return el;
      el = el.parentElement;
    }
    return null;
  }

  function _makeCursor(color, label) {
    const el = document.createElement('div');
    el.style.cssText = "position:fixed;z-index:9500;pointer-events:none;width:24px;height:24px;"
      + "filter:drop-shadow(0 0 5px " + color + ");";
    el.innerHTML = "<svg width='24' height='24' viewBox='0 0 24 24' fill='none'>"
      + "<polygon points='3,2 3,19 8,14 11,22 14,21 11,13 18,13'"
      + " fill='" + color + "' stroke='#000' stroke-width='1.3' stroke-linejoin='round'/></svg>";
    const lbl = document.createElement('div');
    lbl.textContent = label;
    lbl.style.cssText = "position:absolute;top:22px;left:50%;transform:translateX(-50%);"
      + "font-family:'Orbitron',monospace;font-size:9px;font-weight:900;"
      + "color:" + color + ";background:rgba(0,0,0,0.75);padding:1px 5px;"
      + "border-radius:3px;white-space:nowrap;letter-spacing:1px;";
    el.appendChild(lbl);
    return el;
  }

  function start() {
    stop();
    if (!lobbySlots?.length) return;
    if (_inputMode() === 'touch') return; // touch mode — native tapping, no cursors

    const humanSlots = lobbySlots.filter(s => s.type !== 'cpu');
    // Always show at least a P1 cursor — even in all-CPU config the user needs to navigate
    const cursorSlots = humanSlots.length > 0 ? humanSlots : [lobbySlots[0]].filter(Boolean);

    active = true;

    const screenEl = document.getElementById('hero-select');
    const sr = screenEl ? screenEl.getBoundingClientRect()
                        : { left:0, top:0, right:window.innerWidth, bottom:window.innerHeight,
                            width:window.innerWidth, height:window.innerHeight };

    // Hide system cursor — inject a style tag to override cursor:pointer on all children
    _styleTag = document.createElement('style');
    _styleTag.id = 'pc-cursor-none';
    _styleTag.textContent = '#hero-select, #hero-select * { cursor: none !important; }';
    document.head.appendChild(_styleTag);

    // Always scan currently connected gamepads and assign to any unassigned human slots.
    // This handles: controllers already connected before screen loads, hot-plug, and rebuilds.
    // No pre-assignment needed — gamepads matched live each tick by connection order

    cursors = cursorSlots.map((slot, pIdx) => {
      const si    = lobbySlots.indexOf(slot);
      const color = PLAYER_COLORS[pIdx] ?? '#ffee44';
      const label = slot.type === 'cpu' ? 'P1' : slot.type.toUpperCase();
      const el    = _makeCursor(color, label);
      const saved = _savedPos[si];
      const sx    = saved ? saved.x : sr.left + sr.width  * 0.5;
      const sy    = saved ? saved.y : sr.top  + sr.height * 0.5;
      el.style.left = sx + 'px';
      el.style.top  = sy + 'px';
      document.body.appendChild(el);
      // Use the known active gamepad index for P1, offset for P2/P3/P4
      // activeGamepadIndex is set by _pickBestGamepad — it's the real browser slot
      const baseSlot = (typeof activeGamepadIndex !== 'undefined' && activeGamepadIndex >= 0)
        ? activeGamepadIndex : 0;
      const browserSlot = baseSlot + pIdx;
      return { el, x: sx, y: sy, gpIdx: pIdx, browserSlot, slotIdx: si, prevBtns: [], color };
    }).filter(Boolean);

    // P1 cursor tracks mouse — mouse always works regardless of controller
    const p1 = cursors[0];
    if (p1) {
      _mouseHandler = (e) => {
        if (!active) return;
        p1.x = e.clientX;
        p1.y = e.clientY;
        p1.el.style.left = p1.x + 'px';
        p1.el.style.top  = p1.y + 'px';
        _savedPos[p1.slotIdx] = { x: p1.x, y: p1.y };
      };
      document.addEventListener('mousemove', _mouseHandler);

      // Mouse click on hero cards — assign directly to P1's slot, bypass activeSlotIdx
      p1._clickHandler = (e) => {
        if (!active) return;
        const card = e.target.closest?.('.hero-card');
        if (!card) return;
        e.stopPropagation();
        e.preventDefault();
        const heroName = card.querySelector('.hero-name')?.textContent;
        const hero = HEROES.find(h => h.name === heroName);
        if (hero) lobbySetHero(hero, p1.slotIdx);
      };
      document.addEventListener('click', p1._clickHandler, true);
    }

    let lastTime = performance.now();
    function tick() {
      if (!active) return;
      const now = performance.now();
      const dt  = Math.min((now - lastTime) / 1000, 0.05);
      lastTime  = now;

      let rawGPs = [];
      try { rawGPs = Array.from(navigator.getGamepads ? navigator.getGamepads() : []); } catch(e) {}

      const screenEl2 = document.getElementById('hero-select');
      if (!screenEl2 || !screenEl2.classList.contains('active')) {
        rafId = requestAnimationFrame(tick); return;
      }
      const sr2 = screenEl2.getBoundingClientRect();

      document.querySelectorAll('.pc-hover').forEach(e => {
        e.classList.remove('pc-hover'); e.style.outline = '';
      });

      cursors.forEach(cur => {
        const gp = (cur.browserSlot !== null) ? (rawGPs[cur.browserSlot] ?? null) : null;
        if (!gp || !gp.connected) return;

        if (gp) {
          const M           = typeof _getButtonMap === 'function' ? _getButtonMap(gp) : {};
          const prev        = cur.prevBtns;
          const pressed     = b => gp.buttons[b]?.pressed ?? false;
          const justPressed = b => pressed(b) && !(prev[b] ?? false);

          // Controller movement — analog stick + d-pad
          // Input pipeline: deadzone → remap to 0-1 → quadratic curve → velocity lerp
          const lx = gp.axes[0] ?? 0, ly = gp.axes[1] ?? 0;
          const DEAD = 0.12;
          // Remap: remove deadzone, rescale remaining range to 0..1
          const remapAxis = v => {
            const a = Math.abs(v);
            if (a < DEAD) return 0;
            const remapped = (a - DEAD) / (1 - DEAD); // 0..1 past deadzone
            // Quadratic curve — small deflections stay slow, full deflection = max
            return Math.sign(v) * remapped * remapped;
          };
          let ix = remapAxis(lx), iy = remapAxis(ly);
          // D-pad: treat as ±1 after curve (full speed, but still lerped)
          if (ix === 0 && iy === 0) {
            if (pressed(M.dright)) ix =  1;
            if (pressed(M.dleft))  ix = -1;
            if (pressed(M.ddown))  iy =  1;
            if (pressed(M.dup))    iy = -1;
          }
          // Normalise diagonal so corner input doesn't exceed 1.0
          const inputLen = Math.hypot(ix, iy);
          if (inputLen > 1) { ix /= inputLen; iy /= inputLen; }

          const targetVX = ix * MAX_SPEED;
          const targetVY = iy * MAX_SPEED;
          if (!cur.velX) { cur.velX = 0; cur.velY = 0; }

          if (ix !== 0 || iy !== 0) {
            // Accelerate toward target — lerp like character movement
            const alpha = Math.min(1, dt / ACCEL_T);
            cur.velX += (targetVX - cur.velX) * alpha;
            cur.velY += (targetVY - cur.velY) * alpha;
          } else {
            // Decelerate — coast to stop
            const alpha = Math.min(1, dt / DECEL_T);
            cur.velX *= (1 - alpha);
            cur.velY *= (1 - alpha);
            if (Math.hypot(cur.velX, cur.velY) < 1) { cur.velX = 0; cur.velY = 0; }
          }

          if (cur.velX !== 0 || cur.velY !== 0) {
            cur.x = Math.max(sr2.left + 4, Math.min(sr2.right  - 4, cur.x + cur.velX * dt));
            cur.y = Math.max(sr2.top  + 4, Math.min(sr2.bottom - 4, cur.y + cur.velY * dt));
          }

          // ── Soft magnet — pull toward nearest clickable when moving slowly ──
          const inputStrength = Math.hypot(ix, iy);
          if (inputStrength < 0.30) {
            // Cache clickable element centers — rebuild every 200ms, not every frame
            if (!cur._magnetCache || now - (cur._magnetCacheTime ?? 0) > 200) {
              cur._magnetCache = [];
              cur._magnetCacheTime = now;
              const screenEl3 = document.getElementById('hero-select');
              if (screenEl3) {
                screenEl3.querySelectorAll('.hero-card, button, .lslot-toggle-wrap, .lslot-team-dot')
                  .forEach(el => {
                    if (el.offsetParent === null) return;
                    const r = el.getBoundingClientRect();
                    cur._magnetCache.push({ cx: r.left + r.width/2, cy: r.top + r.height/2 });
                  });
              }
            }
            const MAGNET_RADIUS = 120;
            let nearestEl = null, nearestDist = Infinity;
            for (const c of (cur._magnetCache ?? [])) {
              const d = Math.hypot(cur.x - c.cx, cur.y - c.cy);
              if (d < nearestDist && d < MAGNET_RADIUS) { nearestDist = d; nearestEl = c; }
            }
            if (nearestEl) {
              const distFactor    = 1 - nearestDist / MAGNET_RADIUS;
              const releaseFactor = 1 - inputStrength / 0.30;
              // Only attract once within 60px — avoids fighting between nearby small elements
              const proximityGate = nearestDist < 60 ? 1 : 0;
              const strength      = distFactor * distFactor * releaseFactor * 0.09 * proximityGate;
              cur.x += (nearestEl.cx - cur.x) * strength;
              cur.y += (nearestEl.cy - cur.y) * strength;
            }
          } else {
            cur._magnetCache = null; // invalidate cache when moving fast
          }

          cur.el.style.left = cur.x + 'px';
          cur.el.style.top  = cur.y + 'px';
          _savedPos[cur.slotIdx] = { x: cur.x, y: cur.y };

          // A — click element under cursor
          const confirmBtn = Array.isArray(controllerBindings?.e) ? controllerBindings.e[0] : (M.a ?? 0);
          if (justPressed(confirmBtn)) {
            cur.el.style.display = 'none';
            const tipEl = document.elementFromPoint(cur.x + 2, cur.y + 2);
            cur.el.style.display = '';
            const hov = tipEl ? _clickable(tipEl) : null;
            if (hov) {
              if (hov.classList.contains('hero-card')) {
                // Find which hero this card represents and assign directly to this cursor's slot
                const heroName = hov.querySelector('.hero-name')?.textContent;
                const hero = HEROES.find(h => h.name === heroName);
                if (hero) lobbySetHero(hero, cur.slotIdx);
              } else {
                hov.click();
              }
            }
          }

          // B — clear hero pick
          const backBtn = Array.isArray(controllerBindings?.auto) ? controllerBindings.auto[0] : (M.b ?? 1);
          if (justPressed(backBtn)) {
            const slot = lobbySlots[cur.slotIdx];
            if (slot && slot.hero) {
              slot.hero = null;
              buildLobby();
              buildHeroGrid('hero-grid', 'hero-detail');
              clearTimeout(window._pcStartTimer); window._pcStartTimer = setTimeout(() => PlayerCursors.start(), 120);
            }
          }

          cur.prevBtns = gp.buttons.map(b => b?.pressed ?? false);
        } else {
          cur.prevBtns = [];
        }

        // Hover highlight — always run regardless of input source
        cur.el.style.display = 'none';
        const tipEl2 = document.elementFromPoint(cur.x + 2, cur.y + 2);
        cur.el.style.display = '';
        const hov2 = tipEl2 ? _clickable(tipEl2) : null;
        if (hov2) { hov2.classList.add('pc-hover'); hov2.style.outline = "2px solid " + cur.color; }
      });

      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
  }

  function stop(clearAssignments = false) {
    active = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (_mouseHandler) { document.removeEventListener('mousemove', _mouseHandler); _mouseHandler = null; }
    const p1 = cursors[0];
    if (p1?._clickHandler) { document.removeEventListener('click', p1._clickHandler, true); }
    cursors.forEach(c => { if (c) _savedPos[c.slotIdx] = { x: c.x, y: c.y }; });
    cursors.forEach(c => c?.el?.remove());
    cursors = [];
    if (_styleTag) { _styleTag.remove(); _styleTag = null; }
    const screenEl = document.getElementById('hero-select');
    if (screenEl) screenEl.style.cursor = '';
    document.body.style.cursor = '';
    document.querySelectorAll('.pc-hover').forEach(e => { e.classList.remove('pc-hover'); e.style.outline = ''; });
    // Only clear assignments when fully leaving hero-select — preserves P1/P2 mapping on rebuilds
    if (clearAssignments) {
      // Clear saved positions so cursors start at center next time
      Object.keys(_savedPos).forEach(k => delete _savedPos[k]);
    }
  }

  function refresh() { if (active) { stop(); start(); } }

  // When a new controller connects, restart cursors so it gets picked up
  window.addEventListener('gamepadconnected', () => {
    const hs = document.getElementById('hero-select');
    if (hs && hs.classList.contains('active')) {
      setTimeout(() => PlayerCursors.start(), 100);
    }
  });

  return { start, stop, refresh };
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

      const card = document.createElement('div');
      card.className = 'hero-card';
      card.style.cssText = 'position:relative;';

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

      // ── Slot label badges — one per slot that has this hero assigned ──────
      // Simple rule: if slot.hero === h, stamp a label on the card.
      // Human slots → P1/P2/P3/P4 in their player color. CPU slots → "CPU" in grey.
      if (inLobby) {
        let humanCount = 0;
        lobbySlots.forEach((s, si) => {
          const isHuman = s.type !== 'cpu';
          const pIdx = isHuman ? humanCount : -1;
          if (isHuman) humanCount++;
          if (s.hero !== h) return; // not this card

          const label = isHuman ? s.type.toUpperCase() : 'CPU';
          const color = isHuman ? (PLAYER_COLORS[pIdx] ?? '#ffee44') : '#888';
          const badge = document.createElement('div');
          badge.textContent = label;
          badge.style.cssText = `
            position:absolute; top:4px; left:4px;
            font-family:'Orbitron',monospace; font-size:9px; font-weight:900;
            letter-spacing:1px; padding:2px 5px; border-radius:3px;
            background:rgba(0,0,0,0.75); border:1px solid ${color};
            color:${color}; pointer-events:none; line-height:1.4;
          `;
          card.appendChild(badge);
          // Also tint the card border to match
          card.style.borderColor = color;
          card.style.boxShadow = `0 0 10px ${color}55`;
        });
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
}

// ── Hero Detail Page (full roster view) ──
function openHeroDetailPage(h) {
  showScreen('hero-detail-page');
  const el = document.getElementById('detail-page-content');
  if (!el || !h || !h.baseStats) return;
  const b = h.baseStats;

  function abilityCardFull(a, idx) {
    const actions  = ['q', 'e', 'r'];
    const fallback = ['1', '2', 'ULT'];
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
    </div>

    <div class="detail-section-title">COMBAT STATS</div>
    <div class="ext-stats-grid">
      ${extendedStatRow('abilityPower',b.abilityPower)}
      ${extendedStatRow('armorPen',    b.armorPen)}
      ${extendedStatRow('atkSpeed',    b.atkSpeed)}
      ${extendedStatRow('cdr',         b.cdr)}
      ${extendedStatRow('critChance',  b.critChance)}
      ${extendedStatRow('lifesteal',   b.lifesteal)}
      ${extendedStatRow('manaRegen',   b.manaRegen)}
      ${extendedStatRow('mobility',    b.mobility)}
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
    if (localStorage.getItem(LAUNCH_TIP_KEY)) return; // player opted out
  } catch(e) {}
  document.getElementById('launch-tip').style.display = 'flex';
}
function dismissLaunchTip() {
  document.getElementById('launch-tip').style.display = 'none';
  try {
    const noShow = document.getElementById('tip-no-show-check');
    if (noShow && noShow.checked) localStorage.setItem(LAUNCH_TIP_KEY, '1');
  } catch(e) {}
}

function abilityCard(a, idx) {
  const actions  = ['q', 'e', 'r'];
  const fallback = ['1', '2', 'ULT'];
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
  if (!el || !h) return;
  el.innerHTML = `<div class="hs-inline-lobby"></div>`;
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






const KILL_STEPS = [5,10,15,20,25,30,35,40,45,50,55,60,65,70,75,80,85,90,95,100];
const TIME_STEPS = [60,90,120,180,210,300,420,600]; // seconds: 1:00,1:30,2:00,3:00,3:30,5:00,7:00,10:00

function _fmtTime(secs) {
  const m = Math.floor(secs / 60), s = secs % 60;
  return s === 0 ? `${m}:00` : `${m}:${String(s).padStart(2,'0')}`;
}

function stepKills(dir) {
  if (dir === 'inf') {
    matchKillLimit = matchKillLimit >= 999 ? 5 : 999;
    buildSettingsPanel(); return;
  }
  const idx = KILL_STEPS.indexOf(matchKillLimit >= 999 ? KILL_STEPS[0] : matchKillLimit);
  const cur = idx < 0 ? 0 : idx;
  matchKillLimit = KILL_STEPS[Math.max(0, Math.min(KILL_STEPS.length - 1, cur + dir))];
  buildSettingsPanel();
}

function stepTime(dir) {
  if (dir === 'inf') {
    matchDuration = isFinite(matchDuration) ? Infinity : 210;
    buildSettingsPanel(); return;
  }
  const idx = TIME_STEPS.indexOf(!isFinite(matchDuration) ? TIME_STEPS[0] : matchDuration);
  const cur = idx < 0 ? 0 : idx;
  matchDuration = TIME_STEPS[Math.max(0, Math.min(TIME_STEPS.length - 1, cur + dir))];
  buildSettingsPanel();
}

function buildSettingsPanel() {
  setDifficulty(aiDifficulty);
  const ffBtn = document.getElementById('ff-toggle');
  if (ffBtn) {
    ffBtn.textContent = 'FRIENDLY FIRE: ' + (friendlyFire ? 'ON' : 'OFF');
    ffBtn.classList.toggle('active', friendlyFire);
  }

  // Kill stepper
  const killVal  = document.getElementById('kill-val');
  const killMinus = document.getElementById('kill-minus');
  const killPlus  = document.getElementById('kill-plus');
  const killInf   = document.getElementById('kill-inf');
  if (killVal) {
    const isInf = matchKillLimit >= 999;
    killVal.textContent = isInf ? '—' : matchKillLimit;
    killVal.style.opacity = isInf ? '0.3' : '1';
    if (killMinus) killMinus.disabled = isInf || matchKillLimit <= KILL_STEPS[0];
    if (killPlus)  killPlus.disabled  = isInf || matchKillLimit >= KILL_STEPS[KILL_STEPS.length - 1];
    if (killInf)   killInf.classList.toggle('active', isInf);
  }

  // Time stepper
  const timeVal   = document.getElementById('time-val');
  const timeMinus = document.getElementById('time-minus');
  const timePlus  = document.getElementById('time-plus');
  const timeInf   = document.getElementById('time-inf');
  if (timeVal) {
    const isInf = !isFinite(matchDuration);
    timeVal.textContent = isInf ? '—' : _fmtTime(matchDuration);
    timeVal.style.opacity = isInf ? '0.3' : '1';
    if (timeMinus) timeMinus.disabled = isInf || matchDuration <= TIME_STEPS[0];
    if (timePlus)  timePlus.disabled  = isInf || matchDuration >= TIME_STEPS[TIME_STEPS.length - 1];
    if (timeInf)   timeInf.classList.toggle('active', isInf);
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

  // ── − count + pill at top of slot list — fixed position ──
  const controlRow = document.createElement('div');
  controlRow.className = 'lslot-count-row';

  const minusBtn = document.createElement('button');
  minusBtn.className = 'lslot-count-btn';
  minusBtn.textContent = '−';
  minusBtn.disabled = lobbySlots.length <= 2;
  minusBtn.onclick = () => {
    if (lobbySlots.length <= 2) return;
    lobbySlots.pop();
    if (activeSlotIdx >= lobbySlots.length) activeSlotIdx = 0;
    buildLobby();
    buildHeroGrid('hero-grid', 'hero-detail');
    setTimeout(() => PlayerCursors.start(), 120);
  };

  const countEl = document.createElement('span');
  countEl.className = 'lslot-count-num';
  countEl.textContent = lobbySlots.length;

  const plusBtn = document.createElement('button');
  plusBtn.className = 'lslot-count-btn';
  plusBtn.textContent = '+';
  plusBtn.disabled = lobbySlots.length >= 6;
  plusBtn.onclick = () => {
    if (lobbySlots.length >= 6) return;
    const t = [...new Set(lobbySlots.map(s => s.teamId))];
    const n = t.length < 6 ? t.length : t[t.length - 1];
    lobbySlots.push({ type: 'cpu', hero: null, locked: false, teamId: n });
    autoAssignSlotTypes();
    buildLobby();
    buildHeroGrid('hero-grid', 'hero-detail');
    setTimeout(() => PlayerCursors.start(), 120);
  };

  controlRow.appendChild(minusBtn);
  controlRow.appendChild(countEl);
  controlRow.appendChild(plusBtn);
  slotsEl.appendChild(controlRow);

  // Column headers — mirror lslot-right structure exactly for perfect alignment
  const colHeaders = document.createElement('div');
  colHeaders.className = 'lslot-col-headers';
  colHeaders.innerHTML = `
    <span class="lslot-col-header-spacer"></span>
    <div style="display:flex;align-items:center;gap:10px;flex-shrink:0;">
      <span class="lslot-col-header type">TYPE</span>
      <span class="lslot-col-header team">TEAM</span>
    </div>
  `;
  slotsEl.appendChild(colHeaders);

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
    portrait.style.borderColor = isHuman ? (PLAYER_COLORS[humanIdx] ?? '#44ff88') : tc.color + '88';
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
    // P1/P2/P3/P4 label badge on portrait for human slots
    if (isHuman) {
      const pLabel = document.createElement('div');
      pLabel.className = 'lslot-player-badge';
      pLabel.textContent = `P${humanIdx + 1}`;
      pLabel.style.cssText = `color:${PLAYER_COLORS[humanIdx] ?? '#44ff88'};`;
      portrait.appendChild(pLabel);
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

    // Right: CPU/HUMAN pill (tap to toggle) + team color pill (tap to cycle)
    const right = document.createElement('div');
    right.className = 'lslot-right';

    // CPU / HUMAN — single tappable pill
    const typePill = document.createElement('button');
    typePill.className = 'lslot-type-pill' + (slot.locked ? ' lslot-toggle-locked' : '');
    typePill.textContent = isHuman ? 'HUMAN' : 'CPU';
    const humanCount = lobbySlots.filter(s => s.type !== 'cpu').length;
    const atHumanCap = !isHuman && humanCount >= 4;
    typePill.style.cssText = isHuman
      ? 'color:#44ff88;border-color:rgba(68,255,136,0.4);background:rgba(68,255,136,0.08);'
      : atHumanCap
        ? 'color:var(--muted);border-color:rgba(255,255,255,0.1);background:rgba(255,255,255,0.02);cursor:default;opacity:0.4;'
        : 'color:var(--accent);border-color:rgba(0,212,255,0.35);background:rgba(0,212,255,0.06);';
    typePill.onclick = (e) => {
      e.stopPropagation();
      if (lobbyPhase !== 'pick' || slot.locked) return;
      // Cap at 4 human players
      if (!isHuman) {
        const currentHumans = lobbySlots.filter(s => s.type !== 'cpu').length;
        if (currentHumans >= 4) return;
      }
      slot.type = isHuman ? 'cpu' : 'p1';
      if (typeof PlayerCursors !== 'undefined') PlayerCursors.stop(true);
      slot.hero = null;
      slot.locked = false;
      clearTimeout(window._autoLockTimer);
      autoAssignSlotTypes();
      if (lobbySlots[activeSlotIdx]?.type === 'cpu') {
        const firstHuman = lobbySlots.findIndex(s => s.type !== 'cpu' && !s.locked);
        if (firstHuman >= 0) activeSlotIdx = firstHuman;
      }
      buildLobby();
      buildHeroGrid('hero-grid', 'hero-detail');
      clearTimeout(window._pcStartTimer); window._pcStartTimer = setTimeout(() => PlayerCursors.start(), 120);
    };
    right.appendChild(typePill);

    // Team color — tappable pill with color name
    const teamDot = document.createElement('button');
    teamDot.className = 'lslot-team-dot';
    teamDot.style.cssText = `border-color:${tc.color}66;color:${tc.color};`;
    teamDot.title = 'Tap to change team';
    teamDot.innerHTML = `<span class="lslot-team-swatch" style="background:${tc.color};box-shadow:0 0 5px ${tc.color}88;"></span><span class="lslot-team-label">${tc.name}</span>`;
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
      clearTimeout(window._pcStartTimer); window._pcStartTimer = setTimeout(() => PlayerCursors.start(), 120);
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
      // Always require manual LOCK IN press — no auto-start
      clearTimeout(window._autoLockTimer);
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

function lobbySetHero(h, slotIdx) {
  if (lobbyPhase !== 'pick') return;
  // If slotIdx explicitly provided (cursor click), use it directly
  // Otherwise fall back to activeSlotIdx (keyboard/UINav confirm)
  const idx  = (slotIdx !== undefined) ? slotIdx : activeSlotIdx;
  const slot = lobbySlots[idx];
  if (!slot) return;
  // Cursor click always overrides — unlock first if already locked
  // This lets players change their mind even after locking in
  if (slot.locked && slotIdx !== undefined) slot.locked = false;
  if (slot.locked) return;  // keyboard path still respects locked state
  // Don't allow assigning to a CPU slot
  if (slot.type === 'cpu') return;
  slot.hero = h;
  selectedHero = h;

  // Only auto-advance activeSlotIdx when not using explicit slotIdx
  if (slotIdx === undefined) {
    const humanSlots = lobbySlots.map((s,i) => ({s,i})).filter(({s}) => s.type !== 'cpu');
    const nextUnpicked = humanSlots.find(({s,i}) => !s.hero && i !== activeSlotIdx);
    if (nextUnpicked) activeSlotIdx = nextUnpicked.i;
  }

  buildLobby();
  buildHeroGrid('hero-grid','hero-detail');
  clearTimeout(window._pcStartTimer); window._pcStartTimer = setTimeout(() => PlayerCursors.start(), 120);
}

function lobbyReady() {
  if (lobbyPhase !== 'pick') return;

  // Validate: must have at least two distinct teams
  const uniqueTeams = new Set(lobbySlots.map(s => s.teamId));
  if (uniqueTeams.size < 2) {
    showLobbyError('At least two different teams are required. Tap a team badge to reassign a slot.');
    return;
  }

  // Fill any empty CPU slots with random heroes (no duplicates)
  const takenHeroIds = lobbySlots.filter(s => s.hero).map(s => s.hero.id);
  lobbySlots.forEach(slot => {
    if (!slot.hero) {
      const available = HEROES.filter(h => !takenHeroIds.includes(h.id));
      const pool = available.length > 0 ? available : HEROES;
      const picked = pool[Math.floor(Math.random() * pool.length)];
      slot.hero = picked;
      takenHeroIds.push(picked.id);
    }
  });

  // Rebuild so CPU random picks show their badges before countdown
  buildLobby();
  buildHeroGrid('hero-grid', 'hero-detail');

  // ── 3-second countdown with abort ──────────────────────────────────────
  lobbyPhase = 'countdown';
  let remaining = 3;

  const overlay = document.createElement('div');
  overlay.id = 'launch-countdown-overlay';
  overlay.style.cssText = [
    'position:fixed;inset:0;z-index:9000;',
    'display:flex;flex-direction:column;align-items:center;justify-content:center;',
    'background:rgba(0,0,0,0.72);backdrop-filter:blur(4px);',
    'animation:fadeIn 0.15s ease;'
  ].join('');

  const numEl = document.createElement('div');
  numEl.style.cssText = "font-family:'Orbitron',monospace;font-size:clamp(72px,14vw,140px);"
    + "font-weight:900;color:#fff;text-shadow:0 0 40px rgba(255,200,0,0.7);"
    + "line-height:1;margin-bottom:16px;transition:transform 0.25s ease;";
  numEl.textContent = remaining;

  const labelEl = document.createElement('div');
  labelEl.style.cssText = "font-family:'Orbitron',monospace;font-size:clamp(10px,1.4vw,14px);"
    + "font-weight:700;letter-spacing:3px;color:rgba(255,255,255,0.5);margin-bottom:32px;";
  labelEl.textContent = 'MATCH STARTING';

  const abortBtn = document.createElement('button');
  abortBtn.textContent = 'ABORT';
  abortBtn.style.cssText = "font-family:'Orbitron',monospace;font-size:clamp(10px,1.2vw,13px);"
    + "font-weight:700;letter-spacing:2px;padding:10px 32px;"
    + "background:rgba(255,60,60,0.15);border:1px solid #ff4444;"
    + "color:#ff6666;border-radius:4px;cursor:pointer;";
  abortBtn.id = 'abort-countdown-btn';
  abortBtn.onmouseenter = () => abortBtn.style.background = 'rgba(255,60,60,0.3)';
  abortBtn.onmouseleave = () => abortBtn.style.background = 'rgba(255,60,60,0.15)';

  overlay.appendChild(numEl);
  overlay.appendChild(labelEl);
  overlay.appendChild(abortBtn);
  document.body.appendChild(overlay);

  function abortCountdown() {
    clearInterval(countdownInterval);
    document.removeEventListener('keydown', escHandler);
    overlay.remove();
    lobbyPhase = 'pick';
    buildLobby();
    buildHeroGrid('hero-grid', 'hero-detail');
    clearTimeout(window._pcStartTimer); window._pcStartTimer = setTimeout(() => PlayerCursors.start(), 120);
  }

  abortBtn.onclick = abortCountdown;

  const escHandler = (e) => {
    if (e.key === 'Escape') abortCountdown();
  };
  document.addEventListener('keydown', escHandler);

  const countdownInterval = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(countdownInterval);
      document.removeEventListener('keydown', escHandler);
      overlay.remove();
      lobbySlots.forEach(s => s.locked = true);
      lobbyPhase = 'launch';
      launchGame();
    } else {
      numEl.textContent = remaining;
      numEl.style.transform = 'scale(1.25)';
      setTimeout(() => { numEl.style.transform = 'scale(1)'; }, 60);
    }
  }, 1000);
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
  clearTimeout(window._pcStartTimer);
  PlayerCursors.stop();
  document.body.classList.add('in-game');
  showScreen('game');
  initGame();
  // Set spectator-mode body class after initGame sets gameState
  setTimeout(() => {
    if (gameState?.spectator) document.body.classList.add('spectator-mode');
  }, 50);
}

// Return to hero select after a match — unlock human slots so players can repick,
// but keep CPU slots and team assignments intact.
function goToRematchLobby() {
  // Unlock human hero slots but keep everything else intact:
  // player count, CPU slots, team assignments, match settings all persist.
  if (window.lobbySlots) {
    lobbySlots.forEach(slot => {
      if (slot.type !== 'cpu') { slot.locked = false; slot.hero = null; }
    });
  }
  lobbyPhase = 'pick';
  selectedHero = HEROES[0];
  activeSlotIdx = 0;

  // Do everything showScreen('hero-select') does EXCEPT reset lobbySlots
  cleanupGame();
  endTutorial(true);
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('hero-select')?.classList.add('active');
  Audio.sfx.uiClick();
  refreshDynamicBindLabels();
  if (typeof UINav !== 'undefined') setTimeout(() => UINav.activate('hero-select'), 30);
  Audio.playMenuBGM();
  initHeroDetailCollapse();
  clearTimeout(window._autoLockTimer);
  buildLobby();
  buildSettingsPanel();
  buildHeroGrid('hero-grid','hero-detail');
  clearTimeout(window._pcStartTimer);
  window._pcStartTimer = setTimeout(() => PlayerCursors.start(), 120);
}

function goToMainMenu() {
  // Full reset — showScreen handles lobbySlots reset on next hero-select visit
  showScreen('menu');
}

// ========== TUTORIAL SYSTEM ==========

let _tutorialHero = null; // hero selected for tutorial

function buildTutorialHeroGrid() {
  const grid = document.getElementById('tutorial-hero-grid');
  if (!grid) return;
  grid.innerHTML = '';
  const canvasRefs = [];

  const CLASS_ORDER = ['melee', 'ranged', 'hybrid'];
  const CLASS_META = {
    melee:  { label: 'MELEE',  icon: '⚔',  color: '#ff6644', desc: 'Close-range brawlers' },
    ranged: { label: 'RANGED', icon: '◎',  color: '#44ccff', desc: 'Long-range specialists' },
    hybrid: { label: 'HYBRID', icon: '⚡',  color: '#ffee44', desc: 'Adaptable fighters' },
  };

  CLASS_ORDER.forEach(cls => {
    const heroes = HEROES.filter(h => h.combatClass === cls);
    if (!heroes.length) return;
    const meta = CLASS_META[cls];

    // Section header — identical to roster
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

    const row = document.createElement('div');
    row.className = 'hero-class-row';
    grid.appendChild(row);

    heroes.forEach(h => {
      const card = document.createElement('div');
      card.className = 'hero-card';
      card.style.cssText = 'position:relative;cursor:pointer;';

      const cvs = document.createElement('canvas');
      const dpr = window.devicePixelRatio || 1;
      const CVS_CSS = 90;
      cvs.width  = CVS_CSS * dpr;
      cvs.height = CVS_CSS * dpr;
      cvs.style.cssText = `display:block;margin:0 auto 2px;width:${CVS_CSS}px;height:${CVS_CSS}px;`;
      const cctx = cvs.getContext('2d');
      const drawer = SPRITE_DRAWERS[h.id];
      if (drawer) {
        cctx.clearRect(0, 0, cvs.width, cvs.height);
        cctx.save(); cctx.scale(dpr, dpr);
        drawer(cctx, CVS_CSS/2, CVS_CSS/2+2, CVS_CSS*0.28, Date.now()*0.001, 1);
        cctx.restore();
      }
      canvasRefs.push({ cvs, h });

      const name = document.createElement('div');
      name.className = 'hero-name';
      name.style.color = h.color;
      name.textContent = h.name;

      card.appendChild(cvs);
      card.appendChild(name);
      card.onclick = () => launchTutorial(h);
      row.appendChild(card);
    });
  });

  // Animate sprites
  clearInterval(window._tutorialGridInterval);
  window._tutorialGridInterval = setInterval(() => {
    const tutScreen = document.getElementById('tutorial-hero-select');
    if (!tutScreen?.classList.contains('active')) { clearInterval(window._tutorialGridInterval); return; }
    const t = Date.now() * 0.001;
    canvasRefs.forEach(({ cvs, h }) => {
      const dpr = window.devicePixelRatio || 1;
      const CVS_CSS = 90;
      const cctx = cvs.getContext('2d');
      const drawer = SPRITE_DRAWERS[h.id];
      if (!drawer) return;
      cctx.clearRect(0, 0, cvs.width, cvs.height);
      cctx.save(); cctx.scale(dpr, dpr);
      drawer(cctx, CVS_CSS/2, CVS_CSS/2+2, CVS_CSS*0.28, t, 1);
      cctx.restore();
    });
  }, 50);
}

function launchTutorial(hero) {
  _tutorialHero = hero;
  // Two dummies: one immortal practice target, one killable red dummy
  const tideHero  = HEROES.find(h => h.id === 'water') || HEROES[0]; // immortal training dummy
  const emberHero = HEROES.find(h => h.id === 'fire')  || HEROES[1]; // killable target dummy
  lobbySlots = [
    { type: 'p1',  hero: hero,      locked: false, teamId: 0 },
    { type: 'cpu', hero: tideHero,  locked: false, teamId: 1 }, // immortal
    { type: 'cpu', hero: emberHero, locked: false, teamId: 1 }, // killable
  ];
  selectedHero = hero;
  activeSlotIdx = 0;
  window._isTutorial = true;
  window._tutorialMatchDuration = matchDuration;
  window._tutorialKillLimit     = matchKillLimit;
  matchDuration = Infinity; // tutorial never times out — timer counts elapsed time up
  matchKillLimit = 99999;
  clearTimeout(window._pcStartTimer);
  PlayerCursors.stop();
  document.body.classList.add('in-game');
  showScreen('game');
  initGame();
  if (gameState) {
    gameState.isTutorial = true;
    if (gameState.enemies[0]) {
      gameState.enemies[0].hp = 99999;
      gameState.enemies[0].maxHp = 99999;
      gameState.enemies[0]._tutorialImmortal = true;
      gameState.enemies[0]._tutorialLabel = 'TRAINING DUMMY';
    }
    if (gameState.enemies[1]) {
      gameState.enemies[1]._tutorialKillable = true;
      gameState.enemies[1]._tutorialLabel = 'TARGET DUMMY';
      // Give it a low HP pool so it's killable in a few hits
      gameState.enemies[1].hp = 120;
      gameState.enemies[1].maxHp = 120;
    }
    Tutorial.init(gameState, hero);
  }
}

function dismissTutorialOverlay() {
  const overlay = document.getElementById('tutorial-complete-overlay');
  if (overlay) overlay.style.display = 'none';
  const hud = document.getElementById('tutorial-hud');
  if (hud) hud.style.display = 'none';
  // Resume the game loop
  if (gameState && !gameState.over) {
    gamePaused = false;
    animFrame = requestAnimationFrame(gameLoop);
  }
}

function endTutorial(silent) {
  if (!window._isTutorial && !silent) return;
  window._isTutorial = false;
  // Restore match settings
  if (window._tutorialMatchDuration !== undefined) { matchDuration = window._tutorialMatchDuration; delete window._tutorialMatchDuration; }
  if (window._tutorialKillLimit     !== undefined) { matchKillLimit = window._tutorialKillLimit;    delete window._tutorialKillLimit; }
  const hud = document.getElementById('tutorial-hud');
  if (hud) hud.style.display = 'none';
  const overlay = document.getElementById('tutorial-complete-overlay');
  if (overlay) overlay.style.display = 'none';
  if (!silent) { cleanupGame(); showScreen('menu'); }
}

function launchRealMatchFromTutorial() {
  const hero = _tutorialHero;
  endTutorial(true);
  lobbySlots = [
    { type: 'p1',  hero: hero,        locked: false, teamId: 0 },
    { type: 'cpu', hero: null,         locked: false, teamId: 1 },
  ];
  selectedHero = hero;
  activeSlotIdx = 0;
  document.body.classList.add('in-game');
  showScreen('game');
  initGame();
}

// ── Tutorial task engine ──────────────────────────────────────────────────────
const Tutorial = (() => {
  let _gs   = null;
  let _hero = null;
  let _tasks = [];
  let _done  = false;

  const SECTIONS = [
    {
      id: 'movement',
      title: '1 · MOVEMENT',
      hint: 'Move around the arena. Try every direction and use sprint.',
      tasks: [
        { id: 'move_basic',  label: 'Move in any direction', done: false },
        { id: 'move_sprint', label: () => `Sprint [${getBindLabel('sprint')}]`, done: false },
        { id: 'move_all4',   label: 'Move in all 4 directions', done: false },
      ],
    },
    {
      id: 'autoattack',
      title: '2 · AUTO ATTACKS & TARGETING',
      hint: 'Move close to a dummy — auto-attacks fire automatically. Lock onto a target to focus them.',
      tasks: [
        { id: 'auto_first',   label: 'Land an auto-attack', done: false },
        { id: 'auto_five',    label: 'Land 5 auto-attacks', done: false, count: 0 },
        { id: 'lock_target',  label: () => `Lock onto an enemy [${getBindLabel('cycleTarget')}]`, done: false },
        { id: 'kill_dummy',   label: 'Destroy the red dummy', done: false },
      ],
    },
    {
      id: 'abilities',
      title: '3 · ABILITIES',
      hint: 'Use your element abilities. Each hero has Ability 1, Ability 2, and an Ultimate.',
      tasks: [
        { id: 'ability_q', label: () => `Use Ability 1 [${getBindLabel('q')}]`, done: false },
        { id: 'ability_e', label: () => `Use Ability 2 [${getBindLabel('e')}]`, done: false },
        { id: 'ability_r', label: () => `Use Ultimate [${getBindLabel('r')}]`, done: false },
      ],
    },
    {
      id: 'class',
      title: '4 · CLASS ABILITY',
      hint: 'Your class ability is a powerful move unique to your archetype.',
      tasks: [
        { id: 'special', label: () => `Use class ability [${getBindLabel('special')}]`, done: false },
      ],
    },
    {
      id: 'rocks',
      title: '5 · ROCKS & HEALTH POTS',
      hint: 'Large rocks can drop health potions! Use Rock Buster to destroy them.',
      tasks: [
        { id: 'rockbuster',    label: () => `Fire Rock Buster [${getBindLabel('rockbuster')}]`, done: false },
        { id: 'rock_destroy',  label: 'Destroy a large rock', done: false },
        { id: 'health_pickup', label: 'Pick up a health potion', done: false },
      ],
    },
    {
      id: 'warp',
      title: '6 · WARP GATES',
      hint: 'Blue gates on arena edges teleport you across! Walk through one — then walk back within 1 second to return through the same gate.',
      tasks: [
        { id: 'warp_through', label: 'Warp through a gate', done: false },
        { id: 'warp_return',  label: 'Return through the same gate within 1s', done: false },
      ],
    },
  ];

  let _moveDir = new Set();
  let _prevX = null, _prevY = null;

  function init(gs, hero) {
    _gs   = gs;
    _hero = hero;
    _done = false;
    _moveDir.clear();
    _prevX = null; _prevY = null;
    _tasks = SECTIONS.map(s => ({
      ...s,
      tasks: s.tasks.map(t => ({ ...t, done: false, count: 0 })),
    }));
    _renderHUD();
  }

  function _findTask(id) {
    for (const s of _tasks) for (const t of s.tasks) if (t.id === id) return t;
    return null;
  }

  // Is the given section unlocked? Only first section always unlocked;
  // subsequent sections unlock when previous is complete.
  function _sectionUnlocked(sectionIdx) {
    if (sectionIdx === 0) return true;
    return _tasks[sectionIdx - 1].tasks.every(t => t.done);
  }

  function complete(id) {
    const t = _findTask(id);
    if (!t || t.done) return false;
    // Check the task's section is unlocked
    const secIdx = _tasks.findIndex(s => s.tasks.includes(t));
    if (!_sectionUnlocked(secIdx)) return false;
    t.done = true;
    _renderHUD();
    _checkComplete();
    return true;
  }

  function increment(id) {
    const t = _findTask(id);
    if (!t || t.done) return;
    const secIdx = _tasks.findIndex(s => s.tasks.includes(t));
    if (!_sectionUnlocked(secIdx)) return;
    t.count = (t.count || 0) + 1;
    if (id === 'auto_five' && t.count >= 5) complete('auto_five');
    _renderHUD();
  }

  function _allDone() {
    return _tasks.every(s => s.tasks.every(t => t.done));
  }

  function _totalDone() {
    let d = 0, total = 0;
    _tasks.forEach(s => s.tasks.forEach(t => { total++; if (t.done) d++; }));
    return { d, total };
  }

  function _checkComplete() {
    if (!_done && _allDone()) {
      _done = true;
      setTimeout(() => {
        const hud = document.getElementById('tutorial-hud');
        if (hud) hud.style.display = 'none';
        const overlay = document.getElementById('tutorial-complete-overlay');
        if (overlay) overlay.style.display = 'flex';
        gamePaused = true;
        cancelAnimationFrame(animFrame);
      }, 800);
    }
  }

  function _renderHUD() {
    const hud = document.getElementById('tutorial-hud');
    if (!hud) return;
    hud.style.display = 'block';

    // Active section = first unlocked section with incomplete tasks
    const activeSection = _tasks.find((s, i) => _sectionUnlocked(i) && s.tasks.some(t => !t.done))
      || _tasks[_tasks.length - 1];

    // Update hint to active section
    const hintEl = document.getElementById('tutorial-task-hint');
    if (hintEl) hintEl.textContent = activeSection.hint;

    const cl = document.getElementById('tutorial-checklist');
    cl.innerHTML = '';

    _tasks.forEach((section, sIdx) => {
      const secDone     = section.tasks.every(t => t.done);
      const isActive    = section === activeSection;
      const isUnlocked  = _sectionUnlocked(sIdx);
      const isLocked    = !isUnlocked;

      // Section header row
      const sh = document.createElement('div');
      sh.style.cssText = [
        'display:flex;align-items:center;gap:5px;',
        `font-size:11px;letter-spacing:1px;font-family:'Orbitron',monospace;`,
        `color:${secDone ? 'rgba(100,255,100,0.7)' : isActive ? 'gold' : isLocked ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.45)'};`,
        `margin-top:${sIdx === 0 ? '0' : '6px'};margin-bottom:${isActive ? '4px' : '2px'};`,
      ].join('');
      sh.textContent = (secDone ? '✓ ' : isLocked ? '🔒 ' : '') + section.title;
      cl.appendChild(sh);

      // Tasks — only show for active section; collapsed otherwise
      if (isActive) {
        section.tasks.forEach(t => {
          const row = document.createElement('div');
          row.style.cssText = `display:flex;align-items:center;gap:6px;font-size:12px;color:${t.done ? 'rgba(100,255,100,0.8)' : 'rgba(255,255,255,0.75)'};padding:1px 0 1px 10px;`;
          const icon = document.createElement('span');
          icon.textContent = t.done ? '✓' : '○';
          icon.style.cssText = `color:${t.done ? '#44ff88' : 'rgba(255,255,255,0.3)'};flex-shrink:0;font-size:12px;`;
          const lbl = document.createElement('span');
          lbl.textContent = (typeof t.label === 'function' ? t.label() : t.label)
            + (t.count && !t.done ? ` (${t.count}/5)` : '');
          row.appendChild(icon);
          row.appendChild(lbl);
          cl.appendChild(row);
        });
      }
    });

    const { d, total } = _totalDone();
    document.getElementById('tutorial-progress').textContent = `${d} / ${total} COMPLETE`;
  }

  // Called every game frame
  function tick(gs, dt) {
    if (!gs?.isTutorial || _done) return;
    const p = gs.player;
    if (!p?.alive) return;

    // 1. Movement
    if (_prevX !== null) {
      const mx = p.x - _prevX, my = p.y - _prevY;
      if (Math.hypot(mx, my) > 0.5) {
        complete('move_basic');
        if (Math.abs(mx) > 0.5) _moveDir.add(mx > 0 ? 'right' : 'left');
        if (Math.abs(my) > 0.5) _moveDir.add(my > 0 ? 'down' : 'up');
        if (_moveDir.size >= 4) complete('move_all4');
      }
    }
    _prevX = p.x; _prevY = p.y;

    if ((p.sprintTimer ?? 0) > 0) complete('move_sprint');

    // 2. Auto-attack hits
    if (gs.tutorial?._autoHit) {
      gs.tutorial._autoHit = false;
      complete('auto_first');
      increment('auto_five');
    }

    // Kill killable dummy
    if (gs.tutorial?._dummyKilled) {
      gs.tutorial._dummyKilled = false;
      complete('kill_dummy');
    }

    // Target locked
    if (gs.tutorial?._targetLocked) {
      gs.tutorial._targetLocked = false;
      complete('lock_target');
    }

    // 3. Abilities
    if (gs.tutorial?._abilityUsed !== undefined) {
      const idx = gs.tutorial._abilityUsed;
      gs.tutorial._abilityUsed = undefined;
      if (idx === 0) complete('ability_q');
      if (idx === 1) complete('ability_e');
      if (idx === 2) complete('ability_r');
    }

    // 4. Special
    if (gs.tutorial?._specialUsed) {
      gs.tutorial._specialUsed = false;
      complete('special');
    }

    // 5. Rocks
    if (gs.tutorial?._rbFired)      { gs.tutorial._rbFired = false;      complete('rockbuster'); }
    if (gs.tutorial?._rockDestroyed){ gs.tutorial._rockDestroyed = false; complete('rock_destroy'); }
    if (gs.tutorial?._healthPickup) { gs.tutorial._healthPickup = false;  complete('health_pickup'); }

    // 6. Warp gates
    if (gs.tutorial?._warpUsed)   { gs.tutorial._warpUsed = false;   complete('warp_through'); }
    if (gs.tutorial?._warpReturn) { gs.tutorial._warpReturn = false;  complete('warp_return'); }
  }

  return { init, tick, complete, increment };
})();
