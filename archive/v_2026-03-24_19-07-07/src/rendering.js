// ========== RENDER ==========
function render(gs) {
  const {W,H} = gs;

  // Safety: if the canvas save stack has leaked from a previous error,
  // reset it now before doing anything. ctx.save() limit is ~1024 in Chrome.
  try { ctx.resetTransform(); } catch(_) {}
  try { ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; } catch(_) {}
  const baseScale = canvas._worldScale   || 1;
  const offsetX   = canvas._worldOffsetX || 0;
  const offsetY   = canvas._worldOffsetY || 0;

  // Clear full canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const isSplit  = gs._splitScreen ?? false;
  const vpW_px   = VIEW_W * baseScale;
  const vpH_px   = VIEW_H * baseScale;
  const panes    = getSplitPanes(gs); // defined in game-loop.js

  // Helper: render one world pane
  // pane: { playerIdx, x, y, w, h, inRift } in VIEW units
  // camObj: camera to use for this pane
  function _renderPane(pane, camObj) {
    const { x: paneVX, y: paneVY, w: paneVW, h: paneVH, inRift, playerIdx } = pane;
    const px  = offsetX + Math.round(paneVX * baseScale);
    const py  = offsetY + Math.round(paneVY * baseScale);
    const pw  = Math.round(paneVW * baseScale);
    const ph  = Math.round(paneVH * baseScale);

    // In split-screen, zoom out so the entire arena (or pocket) fits in the pane.
    // scaleToFit picks the smaller of fit-by-width and fit-by-height.
    let paneScale;
    if (isSplit) {
      let arenaW, arenaH, arenaOriginX, arenaOriginY;
      if (inRift) {
        // Fit to play area + small padding so edges aren't clipped
        const RIFT_PAD = 60;
        arenaW = RIFT_PLAY_W + RIFT_PAD * 2; arenaH = RIFT_PLAY_H + RIFT_PAD * 2;
        arenaOriginX = RIFT_PLAY_X - RIFT_PAD; arenaOriginY = RIFT_PLAY_Y - RIFT_PAD;
      } else {
        const ab = getArenaBounds(gs);
        arenaW = ab.w; arenaH = ab.h;
        arenaOriginX = ab.x; arenaOriginY = ab.y;
      }
      const scaleX = pw / arenaW;
      const scaleY = ph / arenaH;
      paneScale = Math.min(scaleX, scaleY);
    } else {
      // Single screen: use normal baseScale / cameraZoom
      paneScale = baseScale / (gs._cameraZoom ?? 1.0);
    }
    ctx.save();
    try {
      ctx.beginPath();
      ctx.rect(px, py, pw, ph);
      ctx.clip();
      ctx.save();
      try {
        let worldOffX, worldOffY;
        let riftPaneScale = paneScale; // may be overridden for single-screen rift fit-to-view
        if (isSplit) {
          // Split: center the current arena bounds (or rift play area) in the pane
          let arenaW2, arenaH2, arenaOX, arenaOY;
          if (inRift) {
            const RIFT_PAD2 = 60;
            arenaW2 = RIFT_PLAY_W + RIFT_PAD2 * 2; arenaH2 = RIFT_PLAY_H + RIFT_PAD2 * 2;
            arenaOX = RIFT_PLAY_X - RIFT_PAD2; arenaOY = RIFT_PLAY_Y - RIFT_PAD2;
          } else {
            const ab2 = getArenaBounds(gs);
            arenaW2 = ab2.w; arenaH2 = ab2.h;
            arenaOX = ab2.x; arenaOY = ab2.y;
          }
          const rendW = arenaW2 * paneScale;
          const rendH = arenaH2 * paneScale;
          worldOffX = px + (pw - rendW) / 2 - arenaOX * paneScale;
          worldOffY = py + (ph - rendH) / 2 - arenaOY * paneScale;
        } else if (inRift) {
          // Single-screen rift: scale-to-fit the play area so entire arena is visible
          const RIFT_PAD3 = 80;
          const fitW = RIFT_PLAY_W + RIFT_PAD3 * 2;
          const fitH = RIFT_PLAY_H + RIFT_PAD3 * 2;
          const fitS = Math.min(pw / fitW, ph / fitH);
          worldOffX = px + (pw - fitW * fitS) / 2 - (RIFT_PLAY_X - RIFT_PAD3) * fitS;
          worldOffY = py + (ph - fitH * fitS) / 2 - (RIFT_PLAY_Y - RIFT_PAD3) * fitS;
          // Apply transform directly; ctx.scale below will use riftPaneScale instead of paneScale
          riftPaneScale = fitS;
        } else {
          worldOffX = px + (pw - paneVW * paneScale) / 2 - camObj.x * paneScale;
          worldOffY = py + (ph - paneVH * paneScale) / 2 - camObj.y * paneScale;
        }
        ctx.translate(worldOffX, worldOffY);
        ctx.scale(riftPaneScale, riftPaneScale);

        // Background
        if (inRift) { drawRiftArena(); } else { drawArena(W, H); }

  // Edge warp — arena only
  if (!inRift) drawWarpEdges(gs);

  // Weather zones — arena only (no storms in the Rift)
  if (!inRift) drawWeatherZones(gs);

  // Convergence Rift portal — arena only
  if (!inRift) drawRiftPortal(gs);

  // Floating obstacles — above weather zones, below characters
  drawObstacles(gs);

  // Items
  gs.items.forEach(item => {
    ctx.save();
    const now2 = gameState.time; // use game time instead of Date.now() per-item
    const bob = Math.sin(now2 * 3.0) * 4;
    const iy = item.y + bob;
    const pulse = 0.7 + 0.3 * Math.abs(Math.sin(now2 * 4.0));

    if (item.type === 'healthpack') {
      const r = 16;
      // Cheap glow ring instead of shadowBlur
      ctx.globalAlpha = 0.20 * pulse;
      ctx.fillStyle = '#ff4488';
      ctx.beginPath(); ctx.arc(item.x, iy, r * 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      // Background circle
      ctx.fillStyle = 'rgba(20,8,16,0.85)';
      ctx.beginPath(); ctx.arc(item.x, iy, r, 0, Math.PI * 2); ctx.fill();
      // Border
      ctx.strokeStyle = `rgba(255,60,140,${pulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(item.x, iy, r, 0, Math.PI * 2); ctx.stroke();
      // Cross
      ctx.fillStyle = `rgba(255,80,160,${pulse})`;
      const arm = r * 0.55, thick = r * 0.28;
      ctx.fillRect(item.x - arm, iy - thick, arm * 2, thick * 2);
      ctx.fillRect(item.x - thick, iy - arm, thick * 2, arm * 2);
    } else if (item.type === 'manapack') {
      const r = 14;
      // Glow ring
      ctx.globalAlpha = 0.22 * pulse;
      ctx.fillStyle = '#4466ff';
      ctx.beginPath(); ctx.arc(item.x, iy, r * 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;

      // Potion bottle — round body + narrow neck + stopper
      const bx = item.x, by = iy;
      const bodyR = r * 0.72;       // round flask body
      const neckW = r * 0.28;       // neck half-width
      const neckH = r * 0.55;       // neck height
      const stopH = r * 0.18;       // stopper height

      // Flask body
      ctx.fillStyle = 'rgba(8,10,28,0.88)';
      ctx.beginPath(); ctx.arc(bx, by + r * 0.15, bodyR, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(80,140,255,${pulse})`;
      ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.arc(bx, by + r * 0.15, bodyR, 0, Math.PI * 2); ctx.stroke();

      // Liquid fill inside body
      ctx.save();
      ctx.beginPath(); ctx.arc(bx, by + r * 0.15, bodyR - 2, 0, Math.PI * 2);
      ctx.clip();
      const liquidY = by + r * 0.15 + bodyR * (0.35 - pulse * 0.15); // liquid sloshes with pulse
      ctx.fillStyle = `rgba(60,120,255,${0.55 + pulse * 0.2})`;
      ctx.fillRect(bx - bodyR, liquidY, bodyR * 2, bodyR * 2);
      // Bubble highlight
      ctx.fillStyle = `rgba(180,220,255,${pulse * 0.5})`;
      ctx.beginPath(); ctx.arc(bx - bodyR * 0.3, liquidY - bodyR * 0.15, bodyR * 0.18, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      // Neck
      const neckTop = by + r * 0.15 - bodyR;
      ctx.fillStyle = 'rgba(8,10,28,0.88)';
      ctx.fillRect(bx - neckW, neckTop - neckH, neckW * 2, neckH + 2);
      ctx.strokeStyle = `rgba(80,140,255,${pulse})`;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(bx - neckW, neckTop - neckH, neckW * 2, neckH);

      // Stopper / cork
      ctx.fillStyle = `rgba(200,160,80,${pulse})`;
      ctx.fillRect(bx - neckW * 1.3, neckTop - neckH - stopH, neckW * 2.6, stopH);
      ctx.strokeStyle = `rgba(240,200,100,${pulse * 0.8})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(bx - neckW * 1.3, neckTop - neckH - stopH, neckW * 2.6, stopH);
    } else {
      ctx.font = '20px serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(item.icon, item.x, iy);
    }
    ctx.restore();
  });

  // Hazard zones — persistent ground effects (flame patches, whirlpools)
  if (gs.hazards?.length) {
    const t = performance.now() / 1000;
    // Clip to arena bounds so hazards never bleed outside the world rect
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, 3200, 1800);
    ctx.clip();
    gs.hazards.forEach(hz => {
      const alpha = Math.min(1, hz.life / hz.maxLife) * 0.75;
      ctx.save();
      ctx.globalAlpha = alpha;
      if (hz.type === 'flame') {
        // Pulsing fire circle with jagged edge
        const pulse = 0.85 + 0.15 * Math.sin(t * 6);
        const r = hz.radius * pulse;
        const grad = ctx.createRadialGradient(hz.x, hz.y, 0, hz.x, hz.y, r);
        grad.addColorStop(0,   'rgba(255,200,50,0.55)');
        grad.addColorStop(0.5, 'rgba(255,100,20,0.38)');
        grad.addColorStop(1,   'rgba(255,50,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(hz.x, hz.y, r, 0, Math.PI*2); ctx.fill();
        // Dashed border
        ctx.strokeStyle = '#ff6622';
        ctx.lineWidth = 2;
        ctx.globalAlpha = alpha * 0.6;
        ctx.setLineDash([8, 5]);
        ctx.beginPath(); ctx.arc(hz.x, hz.y, hz.radius, 0, Math.PI*2); ctx.stroke();
        ctx.setLineDash([]);
      } else if (hz.type === 'whirlpool') {
        // Spinning spiral rings
        const spin = t * 2.5;
        for (let i = 0; i < 3; i++) {
          const rr = hz.radius * (0.35 + i * 0.25);
          const a = spin + i * (Math.PI * 2 / 3);
          ctx.globalAlpha = alpha * (0.55 - i * 0.12);
          ctx.strokeStyle = '#00aaff';
          ctx.lineWidth = 2.5 - i * 0.5;
          ctx.beginPath(); ctx.arc(hz.x, hz.y, rr, a, a + Math.PI * 1.4); ctx.stroke();
        }
        // Fill
        ctx.globalAlpha = alpha * 0.18;
        const grad2 = ctx.createRadialGradient(hz.x, hz.y, 0, hz.x, hz.y, hz.radius);
        grad2.addColorStop(0,   'rgba(0,180,255,0.6)');
        grad2.addColorStop(1,   'rgba(0,100,255,0)');
        ctx.fillStyle = grad2;
        ctx.beginPath(); ctx.arc(hz.x, hz.y, hz.radius, 0, Math.PI*2); ctx.fill();
      } else if (hz.type === 'aftershock') {
        const _t = performance.now() / 1000;
        const pulse = 0.9 + 0.1 * Math.sin(_t * 3);
        ctx.globalAlpha = alpha * 0.6;
        ctx.strokeStyle = '#7ec850';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.arc(hz.x, hz.y, hz.radius * pulse, 0, Math.PI*2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = alpha * 0.15;
        ctx.fillStyle = '#7ec850';
        ctx.beginPath(); ctx.arc(hz.x, hz.y, hz.radius, 0, Math.PI*2); ctx.fill();
        // Slow label
        ctx.globalAlpha = alpha * 0.7;
        ctx.font = `700 ${Math.max(9, hz.radius * 0.12)}px "Orbitron",monospace`;
        ctx.fillStyle = '#7ec850';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('SLOW', hz.x, hz.y);
      }
      ctx.restore();
    });
    ctx.restore(); // arena clip for hazards
  }

  // Effects
  const _effectsT = performance.now() / 1000;
  gs.effects.forEach(ef => {
    const progress = 1 - ef.life / ef.maxLife;
    const alpha = ef.life / ef.maxLife;
    const radius = ef.r + progress * ef.maxR;
    const t = _effectsT;
    ctx.save();
    ctx.translate(ef.x, ef.y);

    switch (ef.elem) {

      case 'fire': {
        // Jagged burst — spiky rays radiating outward
        const spikes = 10;
        ctx.globalAlpha = alpha * 0.7;
        ctx.fillStyle = ef.color;
        ctx.beginPath();
        for (let i = 0; i < spikes * 2; i++) {
          const a = (i / (spikes * 2)) * Math.PI * 2;
          const r2 = i % 2 === 0 ? radius : radius * 0.45;
          i === 0 ? ctx.moveTo(Math.cos(a)*r2, Math.sin(a)*r2) : ctx.lineTo(Math.cos(a)*r2, Math.sin(a)*r2);
        }
        ctx.closePath(); ctx.fill();
        // Inner hot core
        ctx.globalAlpha = alpha * 0.5;
        ctx.fillStyle = '#ffee44';
        ctx.beginPath(); ctx.arc(0, 0, radius * 0.35, 0, Math.PI*2); ctx.fill();
        break;
      }

      case 'water': {
        // Concentric ripple rings
        for (let i = 0; i < 3; i++) {
          const rr = radius * (0.4 + i * 0.3);
          ctx.globalAlpha = alpha * (0.6 - i * 0.15);
          ctx.strokeStyle = ef.color;
          ctx.lineWidth = 2.5 - i * 0.6;
          ctx.beginPath(); ctx.arc(0, 0, rr, 0, Math.PI*2); ctx.stroke();
        }
        ctx.globalAlpha = alpha * 0.18;
        ctx.fillStyle = ef.color;
        ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI*2); ctx.fill();
        break;
      }

      case 'earth': {
        // Ground crack pattern — 4–6 radiating lines with secondary cracks
        ctx.globalAlpha = alpha * 0.85;
        ctx.strokeStyle = ef.color;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        const cracks = 6;
        for (let i = 0; i < cracks; i++) {
          const a = (i / cracks) * Math.PI * 2 + 0.3;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          const midX = Math.cos(a) * radius * 0.55, midY = Math.sin(a) * radius * 0.55;
          const jitter = (Math.sin(i * 7.3) * 0.3);
          ctx.lineTo(midX + midY * jitter, midY - midX * jitter);
          ctx.lineTo(Math.cos(a) * radius, Math.sin(a) * radius);
          ctx.stroke();
          // Side crack
          ctx.lineWidth = 1.5; ctx.globalAlpha = alpha * 0.4;
          const sa = a + 0.4;
          ctx.beginPath();
          ctx.moveTo(midX, midY);
          ctx.lineTo(midX + Math.cos(sa) * radius * 0.4, midY + Math.sin(sa) * radius * 0.4);
          ctx.stroke();
          ctx.lineWidth = 3; ctx.globalAlpha = alpha * 0.85;
        }
        break;
      }

      case 'wind': {
        // Spiral arc rings
        ctx.globalAlpha = alpha * 0.7;
        ctx.strokeStyle = ef.color;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        for (let i = 0; i < 3; i++) {
          const startA = (i / 3) * Math.PI * 2 + progress * 4;
          ctx.beginPath();
          for (let j = 0; j <= 30; j++) {
            const a = startA + (j / 30) * Math.PI * 1.4;
            const r2 = radius * (0.3 + (j / 30) * 0.7);
            j === 0 ? ctx.moveTo(Math.cos(a)*r2, Math.sin(a)*r2) : ctx.lineTo(Math.cos(a)*r2, Math.sin(a)*r2);
          }
          ctx.stroke();
        }
        break;
      }

      case 'shadow': {
        // Inward-collapsing dark tendrils
        const tendrils = 6;
        ctx.strokeStyle = ef.elem === 'shadow' ? '#aa44ff' : ef.color;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        for (let i = 0; i < tendrils; i++) {
          const a = (i / tendrils) * Math.PI * 2 + t * 2;
          ctx.globalAlpha = alpha * 0.7;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * radius, Math.sin(a) * radius);
          ctx.lineTo(Math.cos(a) * radius * 0.15, Math.sin(a) * radius * 0.15);
          ctx.stroke();
        }
        ctx.globalAlpha = alpha * 0.35;
        ctx.fillStyle = '#330044';
        ctx.beginPath(); ctx.arc(0, 0, radius * 0.5, 0, Math.PI*2); ctx.fill();
        break;
      }

      case 'lightning': {
        // Radiating jagged arcs
        const bolts = 8;
        ctx.strokeStyle = ef.color;
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        for (let i = 0; i < bolts; i++) {
          const a = (i / bolts) * Math.PI * 2;
          ctx.globalAlpha = alpha * (0.5 + Math.sin(t * 40 + i) * 0.3);
          ctx.beginPath();
          let cx2 = 0, cy2 = 0;
          const steps = 4;
          for (let s = 1; s <= steps; s++) {
            const sr = radius * (s / steps);
            const jx = (Math.random() - 0.5) * sr * 0.4;
            const jy = (Math.random() - 0.5) * sr * 0.4;
            s === 1 ? ctx.moveTo(cx2, cy2) : null;
            cx2 = Math.cos(a) * sr + jx; cy2 = Math.sin(a) * sr + jy;
            ctx.lineTo(cx2, cy2);
          }
          ctx.stroke();
        }
        // Flash core
        ctx.globalAlpha = alpha * 0.6;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(0, 0, radius * 0.2, 0, Math.PI*2); ctx.fill();
        break;
      }

      case 'ice': {
        // Shattering hex shards radiating outward
        const shards = 6;
        ctx.fillStyle = ef.color;
        for (let i = 0; i < shards; i++) {
          const a = (i / shards) * Math.PI * 2;
          const sr = radius * 0.75;
          ctx.save();
          ctx.translate(Math.cos(a) * sr, Math.sin(a) * sr);
          ctx.rotate(a + progress * 2);
          ctx.globalAlpha = alpha * 0.8;
          ctx.beginPath();
          ctx.moveTo(0, -radius * 0.22);
          ctx.lineTo(radius * 0.12, radius * 0.12);
          ctx.lineTo(-radius * 0.12, radius * 0.12);
          ctx.closePath(); ctx.fill();
          ctx.restore();
        }
        // Frost ring
        ctx.globalAlpha = alpha * 0.5;
        ctx.strokeStyle = '#cceeff';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI*2); ctx.stroke();
        ctx.setLineDash([]);
        break;
      }

      case 'arcane': {
        // Rotating rune ring with pulsing glow
        const runes = 8;
        ctx.strokeStyle = ef.color;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = alpha * 0.8;
        ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI*2); ctx.stroke();
        for (let i = 0; i < runes; i++) {
          const a = (i / runes) * Math.PI * 2 + progress * 3;
          const rx = Math.cos(a) * radius, ry = Math.sin(a) * radius;
          ctx.save();
          ctx.translate(rx, ry); ctx.rotate(a + Math.PI / 2);
          ctx.globalAlpha = alpha * 0.7;
          ctx.strokeRect(-4, -6, 8, 12);
          ctx.restore();
        }
        ctx.globalAlpha = alpha * 0.2;
        ctx.fillStyle = ef.color;
        ctx.beginPath(); ctx.arc(0, 0, radius * 0.6, 0, Math.PI*2); ctx.fill();
        break;
      }

      case 'metal': {
        // Geometric hexagon ring with shockwave lines
        ctx.strokeStyle = ef.color;
        ctx.lineWidth = 3;
        ctx.globalAlpha = alpha * 0.9;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 - Math.PI / 6;
          i === 0 ? ctx.moveTo(Math.cos(a)*radius, Math.sin(a)*radius) : ctx.lineTo(Math.cos(a)*radius, Math.sin(a)*radius);
        }
        ctx.closePath(); ctx.stroke();
        // Inner hex
        ctx.lineWidth = 1; ctx.globalAlpha = alpha * 0.4;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 - Math.PI / 6;
          i === 0 ? ctx.moveTo(Math.cos(a)*radius*0.5, Math.sin(a)*radius*0.5) : ctx.lineTo(Math.cos(a)*radius*0.5, Math.sin(a)*radius*0.5);
        }
        ctx.closePath(); ctx.stroke();
        break;
      }

      case 'nature': {
        // Blooming petal burst
        const petals = 6;
        ctx.fillStyle = ef.color;
        for (let i = 0; i < petals; i++) {
          const a = (i / petals) * Math.PI * 2 + progress;
          ctx.save();
          ctx.rotate(a);
          ctx.globalAlpha = alpha * 0.65;
          ctx.beginPath();
          ctx.ellipse(radius * 0.5, 0, radius * 0.35, radius * 0.18, 0, 0, Math.PI*2);
          ctx.fill();
          ctx.restore();
        }
        // Green centre glow
        ctx.globalAlpha = alpha * 0.4;
        ctx.fillStyle = '#88ffaa';
        ctx.beginPath(); ctx.arc(0, 0, radius * 0.28, 0, Math.PI*2); ctx.fill();
        break;
      }

      default: {
        // Generic fallback — plain ring or fill as before
        if (ef.ring) {
          ctx.strokeStyle = ef.color; ctx.lineWidth = 3; ctx.globalAlpha = alpha;
          ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI*2); ctx.stroke();
        } else {
          ctx.fillStyle = ef.color; ctx.globalAlpha = alpha * 0.4;
          ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI*2); ctx.fill();
        }
        break;
      }
    }

    ctx.restore();
  });

  // Projectiles
  const _projBounds = gs.gates ? getArenaBounds(gs) : null;
  const _projT = performance.now() / 1000;

  // Update projectile trail history — reuse flat arrays, no object allocation
  const TRAIL_LEN = 6;
  gs.projectiles.forEach(proj => {
    if (!proj._tx) { proj._tx = new Float32Array(TRAIL_LEN); proj._ty = new Float32Array(TRAIL_LEN); proj._ti = 0; proj._tc = 0; }
    proj._tx[proj._ti] = proj.x; proj._ty[proj._ti] = proj.y;
    proj._ti = (proj._ti + 1) % TRAIL_LEN;
    if (proj._tc < TRAIL_LEN) proj._tc++;
  });

  // Draw trails behind projectiles
  gs.projectiles.forEach(proj => {
    if (!proj._tc || proj._tc < 2) return;
    const col = proj.heal ? '#44ff88' : proj.color;
    const r = proj.radius;
    ctx.save();
    for (let k = 1; k < proj._tc; k++) {
      const idx = (proj._ti - 1 - k + TRAIL_LEN) % TRAIL_LEN;
      ctx.globalAlpha = (k / proj._tc) * 0.35;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(proj._tx[idx], proj._ty[idx], r * (k / proj._tc) * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  });

  gs.projectiles.forEach(proj => {
    if (_projBounds) {
      if (proj.x < _projBounds.x || proj.x > _projBounds.x2 || proj.y < _projBounds.y || proj.y > _projBounds.y2) return;
    }
    ctx.save();
    const col  = proj.heal ? '#44ff88' : proj.color;
    const elem = proj.casterRef?.hero?.id ?? null;
    const r    = proj.radius;
    const t    = _projT;
    const angle = Math.atan2(proj.vy, proj.vx);

    // ── Melee slash — arc sweep, fades out quickly ───────────────────
    if (proj.isMeleeSlash) {
      const age   = Math.min(1, (performance.now() - proj.slashBorn) / 70);
      const fade  = 1 - age;
      const a     = proj.slashAngle;
      const sweep = Math.PI * 0.72; // ~130° arc
      const reach = r * 0.88;       // arc radius — matches actual hit range
      ctx.translate(proj.x, proj.y);
      // Soft outer glow — thin stroke only
      ctx.globalAlpha = 0.2 * fade;
      ctx.strokeStyle = proj.color;
      ctx.lineWidth   = 8;
      ctx.lineCap     = 'round';
      ctx.beginPath();
      ctx.arc(0, 0, reach + 6, a - sweep/2, a + sweep/2);
      ctx.stroke();
      // Main bright arc
      ctx.globalAlpha = 0.9 * fade;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth   = 3;
      ctx.beginPath();
      ctx.arc(0, 0, reach, a - sweep/2, a + sweep/2);
      ctx.stroke();
      // Colored secondary arc
      ctx.globalAlpha = 0.65 * fade;
      ctx.strokeStyle = proj.color;
      ctx.lineWidth   = 2;
      ctx.beginPath();
      ctx.arc(0, 0, reach - 7, a - sweep/2, a + sweep/2);
      ctx.stroke();
      // Sparkle dots at arc tips
      ctx.globalAlpha = 0.85 * fade;
      ctx.fillStyle = '#ffffff';
      [a - sweep/2, a + sweep/2].forEach(tip => {
        ctx.beginPath();
        ctx.arc(Math.cos(tip) * reach, Math.sin(tip) * reach, 2.5, 0, Math.PI*2);
        ctx.fill();
      });
      ctx.restore();
      return;
    }

    // ── Element-specific projectile renderers ───────────────────────
    if (elem === 'fire') {
      // Comet — solid color trail, no gradient
      const tailLen = r * 3.5;
      const tx = proj.x + Math.cos(angle + Math.PI) * tailLen;
      const ty = proj.y + Math.sin(angle + Math.PI) * tailLen;
      // Trail
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = 'rgba(255,120,20,0.7)';
      ctx.lineWidth = r * 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(proj.x, proj.y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      // Core fireball
      ctx.globalAlpha = 0.22; ctx.fillStyle = '#ff6600';
      ctx.beginPath(); ctx.arc(proj.x, proj.y, r * 2.2, 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha = 1; ctx.fillStyle = '#ffcc44';
      ctx.beginPath(); ctx.arc(proj.x, proj.y, r, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.arc(proj.x, proj.y, r * 0.38, 0, Math.PI*2); ctx.fill();

    } else if (elem === 'water') {
      // Elongated water droplet pointing in direction of travel
      ctx.translate(proj.x, proj.y); ctx.rotate(angle);
      ctx.globalAlpha = 0.2; ctx.fillStyle = '#00ccff';
      ctx.beginPath(); ctx.ellipse(0, 0, r * 2.8, r * 1.3, 0, 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha = 0.85; ctx.fillStyle = '#00aaff';
      ctx.beginPath(); ctx.ellipse(0, 0, r * 1.6, r * 0.85, 0, 0, Math.PI*2); ctx.fill();
      // Highlight shimmer
      ctx.globalAlpha = 0.6; ctx.fillStyle = '#aaeeff';
      ctx.beginPath(); ctx.ellipse(-r * 0.3, -r * 0.25, r * 0.5, r * 0.25, -0.4, 0, Math.PI*2); ctx.fill();

    } else if (elem === 'wind') {
      // Spinning star shape
      const spin = t * 8 + proj.x * 0.1;
      ctx.translate(proj.x, proj.y); ctx.rotate(spin);
      ctx.globalAlpha = 0.15; ctx.fillStyle = '#aaffcc';
      ctx.beginPath(); ctx.arc(0, 0, r * 2.5, 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#ccffdd';
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const b2 = a + Math.PI / 5;
        i === 0 ? ctx.moveTo(Math.cos(a)*r*1.5, Math.sin(a)*r*1.5) : ctx.lineTo(Math.cos(a)*r*1.5, Math.sin(a)*r*1.5);
        ctx.lineTo(Math.cos(b2)*r*0.65, Math.sin(b2)*r*0.65);
      }
      ctx.closePath(); ctx.fill();
      // Wisp trail
      ctx.globalAlpha = 0.35; ctx.strokeStyle = '#aaffcc';
      ctx.lineWidth = r * 0.7; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-Math.cos(angle - spin) * r * 3, -Math.sin(angle - spin) * r * 3);
      ctx.stroke();

    } else if (elem === 'shadow') {
      // Dark void orb with rotating tendrils
      const spin = t * 5;
      ctx.translate(proj.x, proj.y);
      // Outer void aura
      ctx.globalAlpha = 0.12; ctx.fillStyle = '#6600cc';
      ctx.beginPath(); ctx.arc(0, 0, r * 3, 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha = 0.25; ctx.fillStyle = '#330066';
      ctx.beginPath(); ctx.arc(0, 0, r * 2, 0, Math.PI*2); ctx.fill();
      // Tendrils
      ctx.globalAlpha = 0.6; ctx.strokeStyle = '#aa44ff';
      ctx.lineWidth = 1.5; ctx.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        const a = spin + (i / 4) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5);
        ctx.lineTo(Math.cos(a) * r * 2.2, Math.sin(a) * r * 2.2);
        ctx.stroke();
      }
      // Dark core
      ctx.globalAlpha = 0.95; ctx.fillStyle = '#110022';
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha = 0.5; ctx.fillStyle = '#cc66ff';
      ctx.beginPath(); ctx.arc(-r*0.25, -r*0.25, r*0.3, 0, Math.PI*2); ctx.fill();

    } else if (elem === 'lightning') {
      // Jagged electric bolt shape
      ctx.translate(proj.x, proj.y); ctx.rotate(angle);
      // Electric trail
      ctx.globalAlpha = 0.15; ctx.fillStyle = '#ffffaa';
      ctx.beginPath(); ctx.ellipse(-r, 0, r * 3.5, r * 1.1, 0, 0, Math.PI*2); ctx.fill();
      // Bolt body — zigzag polygon
      ctx.globalAlpha = 1; ctx.fillStyle = '#ffee00';
      ctx.beginPath();
      ctx.moveTo(r * 1.4, 0);
      ctx.lineTo(r * 0.2, -r * 0.9);
      ctx.lineTo(r * 0.5, -r * 0.3);
      ctx.lineTo(-r * 0.6, -r * 1.1);
      ctx.lineTo(-r * 1.4, 0);
      ctx.lineTo(-r * 0.2, r * 0.9);
      ctx.lineTo(-r * 0.5, r * 0.3);
      ctx.lineTo(r * 0.6, r * 1.1);
      ctx.closePath(); ctx.fill();
      // White hot core
      ctx.fillStyle = '#ffffff'; ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(r * 0.9, 0);
      ctx.lineTo(r * 0.1, -r * 0.5);
      ctx.lineTo(-r * 0.9, 0);
      ctx.lineTo(-r * 0.1, r * 0.5);
      ctx.closePath(); ctx.fill();
      // Arc flicker
      if (Math.sin(t * 40) > 0.3) {
        ctx.globalAlpha = 0.4; ctx.strokeStyle = '#aaffff';
        ctx.lineWidth = 1; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(r * 1.4, -r * 0.5);
        ctx.lineTo(r * 0.6, r * 0.2);
        ctx.lineTo(r * 1.2, r * 0.6);
        ctx.stroke();
      }

    } else if (elem === 'ice') {
      // Hexagonal snowflake
      const spin = t * 2.5;
      ctx.translate(proj.x, proj.y); ctx.rotate(spin);
      ctx.globalAlpha = 0.18; ctx.fillStyle = '#aaeeff';
      ctx.beginPath(); ctx.arc(0, 0, r * 2.6, 0, Math.PI*2); ctx.fill();
      // Six spokes
      ctx.globalAlpha = 0.9; ctx.strokeStyle = '#cceeff';
      ctx.lineWidth = r * 0.55; ctx.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * r * 1.7, Math.sin(a) * r * 1.7);
        ctx.stroke();
        // Barbs
        ctx.lineWidth = r * 0.3;
        const bx = Math.cos(a) * r; const by = Math.sin(a) * r;
        const bPerp = a + Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(bx - Math.cos(bPerp)*r*0.4, by - Math.sin(bPerp)*r*0.4);
        ctx.lineTo(bx + Math.cos(bPerp)*r*0.4, by + Math.sin(bPerp)*r*0.4);
        ctx.stroke();
        ctx.lineWidth = r * 0.55;
      }
      // Center hex
      ctx.fillStyle = '#eef9ff'; ctx.globalAlpha = 0.95;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        i === 0 ? ctx.moveTo(Math.cos(a)*r*0.55, Math.sin(a)*r*0.55) : ctx.lineTo(Math.cos(a)*r*0.55, Math.sin(a)*r*0.55);
      }
      ctx.closePath(); ctx.fill();

    } else if (elem === 'arcane') {
      // Rotating diamond with sparkle trail
      const spin = t * 6;
      ctx.translate(proj.x, proj.y); ctx.rotate(spin);
      ctx.globalAlpha = 0.2; ctx.fillStyle = '#ff44aa';
      ctx.beginPath(); ctx.arc(0, 0, r * 2.4, 0, Math.PI*2); ctx.fill();
      // Diamond shape
      ctx.globalAlpha = 0.9; ctx.fillStyle = '#ff66cc';
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.4); ctx.lineTo(r * 1.0, 0);
      ctx.lineTo(0, r * 1.4); ctx.lineTo(-r * 1.0, 0);
      ctx.closePath(); ctx.fill();
      // Inner bright diamond
      ctx.fillStyle = '#ffaaee'; ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.7); ctx.lineTo(r * 0.5, 0);
      ctx.lineTo(0, r * 0.7); ctx.lineTo(-r * 0.5, 0);
      ctx.closePath(); ctx.fill();
      // Sparkle dots at tips
      ctx.fillStyle = '#ffffff'; ctx.globalAlpha = 0.7;
      [[0, -r*1.5],[r*1.1, 0],[0, r*1.5],[-r*1.1, 0]].forEach(([sx, sy]) => {
        ctx.beginPath(); ctx.arc(sx, sy, r * 0.22, 0, Math.PI*2); ctx.fill();
      });

    } else if (elem === 'metal') {
      // Spinning disc/gear
      const spin = t * 9;
      ctx.translate(proj.x, proj.y); ctx.rotate(spin);
      ctx.globalAlpha = 0.15; ctx.fillStyle = '#aabbcc';
      ctx.beginPath(); ctx.arc(0, 0, r * 2.4, 0, Math.PI*2); ctx.fill();
      // Gear teeth
      ctx.globalAlpha = 0.9;
      const teeth = 8;
      ctx.fillStyle = '#ccd5dd';
      ctx.beginPath();
      for (let i = 0; i < teeth; i++) {
        const a1 = (i / teeth) * Math.PI * 2 - 0.2;
        const a2 = a1 + 0.4;
        ctx.moveTo(Math.cos(a1)*r*0.9, Math.sin(a1)*r*0.9);
        ctx.lineTo(Math.cos(a1)*r*1.5, Math.sin(a1)*r*1.5);
        ctx.lineTo(Math.cos(a2)*r*1.5, Math.sin(a2)*r*1.5);
        ctx.lineTo(Math.cos(a2)*r*0.9, Math.sin(a2)*r*0.9);
      }
      ctx.closePath(); ctx.fill();
      // Disc body
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI*2); ctx.fill();
      // Metallic highlight
      ctx.fillStyle = '#eef2f5'; ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.ellipse(-r*0.2, -r*0.25, r*0.45, r*0.22, -0.5, 0, Math.PI*2); ctx.fill();
      // Center hole
      ctx.fillStyle = '#445566'; ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.3, 0, Math.PI*2); ctx.fill();

    } else if (elem === 'nature') {
      // Leaf shape pointing in travel direction
      ctx.translate(proj.x, proj.y); ctx.rotate(angle + Math.PI / 2);
      ctx.globalAlpha = 0.18; ctx.fillStyle = '#44cc88';
      ctx.beginPath(); ctx.arc(0, 0, r * 2.4, 0, Math.PI*2); ctx.fill();
      // Leaf body
      ctx.globalAlpha = 0.9; ctx.fillStyle = '#44ee88';
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.5);
      ctx.bezierCurveTo(r * 1.2, -r * 0.8, r * 1.2, r * 0.8, 0, r * 1.5);
      ctx.bezierCurveTo(-r * 1.2, r * 0.8, -r * 1.2, -r * 0.8, 0, -r * 1.5);
      ctx.fill();
      // Vein
      ctx.strokeStyle = '#22aa55'; ctx.lineWidth = r * 0.35; ctx.lineCap = 'round';
      ctx.globalAlpha = 0.7;
      ctx.beginPath(); ctx.moveTo(0, -r * 1.3); ctx.lineTo(0, r * 1.3); ctx.stroke();
      ctx.lineWidth = r * 0.2;
      ctx.beginPath(); ctx.moveTo(0, -r * 0.4); ctx.lineTo(r * 0.7, r * 0.3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -r * 0.4); ctx.lineTo(-r * 0.7, r * 0.3); ctx.stroke();

    } else {
      // ── Fallback (earth, heal, unknown) ─────────────────────────
      ctx.globalAlpha = 0.18; ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(proj.x, proj.y, r * 2.4, 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha = 0.9; ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(proj.x, proj.y, r, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = 'white'; ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.arc(proj.x, proj.y, r * 0.4, 0, Math.PI*2); ctx.fill();
    }

    ctx.restore();
  });

  // Characters — in split mode show chars relevant to this pane
  // Rift pane: chars in rift. Arena pane: chars not in rift (or all if single screen)
  const _drawChars = !isSplit
    ? [...(gs.players ?? [gs.player]), ...gs.enemies]
    : inRift
      ? [...(gs.players ?? []).filter(p => p._inRift), ...gs.enemies.filter(e => e._inRift)]
      : [...(gs.players ?? []).filter(p => !p._inRift), ...gs.enemies.filter(e => !e._inRift)];
  _drawChars.forEach(c => { if (c) drawChar(c, gs); });

  // Rift crafting progress arc — only in the Rift pane
  if (inRift) drawRiftWorldOverlays(gs);

  // Float damage — filter per pane in split mode
  gs.floatDmgs.forEach(f => {
    // In split mode, only show floats whose attached char is in this pane
    if (gs._splitScreen && f.char) {
      const charInRift = f.char._inRift ?? false;
      if (charInRift !== inRift) return;
    }
    const maxLife = f.maxLife || 1.2;
    const fadeStart = maxLife * 0.65;
    const alpha = f.life > fadeStart ? 1 : f.life / fadeStart;
    if (alpha <= 0) return;
    ctx.save();

    const size       = f.size || 18;
    const riseSpeed  = f.riseSpeed || 50;
    const elapsed    = maxLife - f.life;
    const fallDir    = f.fallDir ?? -1; // -1 = up, +1 = down
    const ry         = f.y + elapsed * riseSpeed * fallDir;
    const cat        = f.cat || 'damage';
    const isMega     = cat === 'mega';
    const isPriority = cat === 'priority' || isMega;
    const isCC       = cat === 'cc';
    const isDamage   = cat === 'damage' || cat === 'label';

    // Damage numbers are intentionally subdued — informational not dramatic
    const baseAlpha  = isDamage ? alpha * 0.72 : alpha;
    ctx.globalAlpha  = baseAlpha;

    // Font weight + size
    const weight = isPriority ? '900' : (isCC ? '700' : 'bold');
    ctx.font = `${weight} ${size}px 'Orbitron',monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Outline thickness
    const lw = isMega ? 6 : (isPriority ? 4 : (isCC ? 2 : 3));
    ctx.lineWidth = lw;

    // Mega: multi-layer glow for maximum drama
    if (isMega) {
      ctx.globalAlpha = baseAlpha * 0.25;
      ctx.strokeStyle = f.color;
      ctx.lineWidth = lw * 5;
      ctx.strokeText(f.text, f.x, ry);
      ctx.globalAlpha = baseAlpha * 0.45;
      ctx.lineWidth = lw * 2.5;
      ctx.strokeText(f.text, f.x, ry);
      ctx.globalAlpha = baseAlpha;
      ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.lineWidth = lw;
      ctx.strokeText(f.text, f.x, ry);
    } else if (isPriority) {
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(f.text, f.x, ry);
      ctx.globalAlpha = baseAlpha * 0.4;
      ctx.strokeStyle = f.color;
      ctx.lineWidth = lw * 2.5;
      ctx.strokeText(f.text, f.x, ry);
      ctx.globalAlpha = baseAlpha;
      ctx.lineWidth = lw;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(f.text, f.x, ry);
    } else {
      ctx.strokeStyle = isDamage ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.75)';
      ctx.strokeText(f.text, f.x, ry);
    }

    // Scale-in pop for priority/mega on first 0.12s
    if ((isPriority || isMega) && elapsed < 0.12) {
      const scale = isMega
        ? 0.5 + (elapsed / 0.12) * 0.5
        : 0.7 + (elapsed / 0.1)  * 0.3;
      ctx.translate(f.x, ry);
      ctx.scale(scale, scale);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, 0, 0);
    } else {
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, ry);
    }

    ctx.restore();
  });

        // Storm zone labels — last in world space
        drawWeatherZoneLabels(gs);

      } finally { ctx.restore(); } // world transform
    } finally { ctx.restore(); } // pane clip
  } // end _renderPane

  // ── Dispatch panes ──
  for (const pane of panes) {
    const cam = isSplit ? cameras[pane.playerIdx] : camera;
    _renderPane(pane, cam);
  }

  // ── Split-screen per-player colored pane borders + dividers ──
  if (isSplit && panes.length > 1) {
    ctx.save();

    const n      = panes.length;
    const hw_px  = Math.round(VIEW_W / 2 * baseScale);
    const hh_px  = Math.round(VIEW_H / 2 * baseScale);
    const bw     = Math.max(3, Math.round(baseScale * 2.5));
    const lblFs  = Math.max(9, VIEW_H * 0.016 * baseScale);
    const PCOLS  = ['#ffee44', '#44eeff', '#ff6644', '#88ff44'];

    // Colored inset border around each pane
    for (const pane of panes) {
      const col = PCOLS[pane.playerIdx] ?? '#ffffff';
      const px  = offsetX + Math.round(pane.x * baseScale);
      const py  = offsetY + Math.round(pane.y * baseScale);
      const pw  = Math.round(pane.w * baseScale);
      const ph  = Math.round(pane.h * baseScale);
      ctx.strokeStyle = col;
      ctx.lineWidth   = bw;
      ctx.globalAlpha = 0.5;
      ctx.strokeRect(px + bw / 2, py + bw / 2, pw - bw, ph - bw);
    }

    ctx.globalAlpha = 1;

    // Divider lines — gradient between adjacent player colors
    ctx.lineWidth = Math.max(2, baseScale * 1.5);
    if (n === 2) {
      const mx = offsetX + hw_px;
      const grad = ctx.createLinearGradient(mx, offsetY, mx, offsetY + hh_px * 2);
      grad.addColorStop(0, PCOLS[0] + '99');
      grad.addColorStop(0.5, 'rgba(255,255,255,0.5)');
      grad.addColorStop(1, PCOLS[1] + '99');
      ctx.strokeStyle = grad;
      ctx.beginPath(); ctx.moveTo(mx, offsetY); ctx.lineTo(mx, offsetY + hh_px * 2); ctx.stroke();
    } else if (n === 3) {
      const mx = offsetX + hw_px;
      const my = offsetY + hh_px;
      const vGrad = ctx.createLinearGradient(mx, offsetY, mx, my);
      vGrad.addColorStop(0, PCOLS[0] + '99'); vGrad.addColorStop(1, PCOLS[1] + '99');
      ctx.strokeStyle = vGrad;
      ctx.beginPath(); ctx.moveTo(mx, offsetY); ctx.lineTo(mx, my); ctx.stroke();
      const hGrad = ctx.createLinearGradient(offsetX, my, offsetX + hw_px * 2, my);
      hGrad.addColorStop(0, PCOLS[0] + '77'); hGrad.addColorStop(0.5, 'rgba(255,255,255,0.4)'); hGrad.addColorStop(1, PCOLS[2] + '77');
      ctx.strokeStyle = hGrad;
      ctx.beginPath(); ctx.moveTo(offsetX, my); ctx.lineTo(offsetX + hw_px * 2, my); ctx.stroke();
    } else {
      const mx = offsetX + hw_px;
      const my = offsetY + hh_px;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath(); ctx.moveTo(mx, offsetY); ctx.lineTo(mx, offsetY + hh_px * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(offsetX, my); ctx.lineTo(offsetX + hw_px * 2, my); ctx.stroke();
    }

    // Pane corner labels — colored to match player
    ctx.font = `700 ${lblFs}px "Orbitron",monospace`;
    ctx.textBaseline = 'top';
    for (const pane of panes) {
      const col    = PCOLS[pane.playerIdx] ?? '#ffffff';
      const px     = offsetX + Math.round(pane.x * baseScale);
      const py     = offsetY + Math.round(pane.y * baseScale);
      const pLabel = `P${pane.playerIdx + 1}${pane.inRift ? ' · RIFT' : ''}`;
      ctx.globalAlpha = 0.75;
      ctx.fillStyle   = col;
      ctx.textAlign   = 'left';
      ctx.fillText(pLabel, px + (bw + 5) * baseScale, py + (bw + 4) * baseScale);
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }


  // Screen-space HUD (HP bars, abilities, kill feed) — drawn over full canvas
  drawHUD(gs);

  // Convergence Rift HUD — screen-space overlay (header, crafting panel)
  drawRiftHUD(gs);
}

// ========== OFF-SCREEN INDICATORS ==========
// Draws edge arrows + name + HP bar for any enemy not visible in viewport.
// Rendered in SCREEN space (after world transform restored) so always visible.
let showOffScreenIndicators = true;

function renderOffScreenIndicators(gs) {
  if (!showOffScreenIndicators) return;
  // Suppress all off-screen arrows while the local player is inside the rift
  const localPlayer = (gs.players ?? []).find(p => p.isPlayer);
  if (localPlayer?._inRift) return;
  const baseScale = canvas._worldScale   || 1;
  const offsetX   = canvas._worldOffsetX || 0;
  const offsetY   = canvas._worldOffsetY || 0;
  const zoom      = gs?._cameraZoom ?? 1.0;
  const scale     = baseScale / zoom;
  const zoomOffsetX = offsetX + (VIEW_W * baseScale - VIEW_W * scale) / 2;
  const zoomOffsetY = offsetY + (VIEW_H * baseScale - VIEW_H * scale) / 2;

  const vx1 = camera.x, vy1 = camera.y;  // kept for potential future use
  const vx2 = camera.x + VIEW_W, vy2 = camera.y + VIEW_H;
  const margin = 28; // px from edge in screen space
  const arrowSize = 10;

  gs.enemies.forEach(e => {
    if (!e.alive) return;
    if (e._inRift) return; // inside rift — not visible in main arena

    // Enemy is off-screen — compute shortest warp-aware delta from viewport center
    const vcx = camera.x + VIEW_W / 2;
    const vcy = camera.y + VIEW_H / 2;

    // Always use warp-aware delta so position near edges doesn't flip sign
    let rawDx = e.x - vcx;
    let rawDy = e.y - vcy;
    if (Math.abs(rawDx - 3200) < Math.abs(rawDx)) rawDx -= 3200;
    else if (Math.abs(rawDx + 3200) < Math.abs(rawDx)) rawDx += 3200;
    if (Math.abs(rawDy - 1800) < Math.abs(rawDy)) rawDy -= 1800;
    else if (Math.abs(rawDy + 1800) < Math.abs(rawDy)) rawDy += 1800;

    // Is enemy visible in viewport? Use warp-aware coords, not raw world pos
    const warpEx = vcx + rawDx;
    const warpEy = vcy + rawDy;
    if (warpEx >= camera.x && warpEx <= camera.x + VIEW_W &&
        warpEy >= camera.y && warpEy <= camera.y + VIEW_H) return;

    // Smooth the angle — slow lerp prevents jitter when AI wobbles near boundary
    const rawAngle = Math.atan2(rawDy, rawDx);
    if (e._indicatorAngle === undefined) e._indicatorAngle = rawAngle;
    let da = rawAngle - e._indicatorAngle;
    if (da > Math.PI)  da -= Math.PI * 2;
    if (da < -Math.PI) da += Math.PI * 2;
    e._indicatorAngle += da * 0.08; // gentle lerp — stable even with boundary wobble
    const angle = e._indicatorAngle;

    // Drive clamp from smoothed angle so edge selection is stable
    const cosA = Math.cos(angle), sinA = Math.sin(angle);

    // Clamp indicator position to viewport edge using smoothed direction
    const hw = VIEW_W / 2 - margin, hh = VIEW_H / 2 - margin;
    let ix, iy;
    if (Math.abs(cosA) * hh > Math.abs(sinA) * hw) {
      ix = cosA > 0 ? hw : -hw;
      iy = ix * (sinA / (cosA || 0.0001));
    } else {
      iy = sinA > 0 ? hh : -hh;
      ix = iy * (cosA / (sinA || 0.0001));
    }

    // Convert to screen coords
    const sx = zoomOffsetX + (VIEW_W / 2 + ix) * scale;
    const sy = zoomOffsetY + (VIEW_H / 2 + iy) * scale;

    ctx.save();

    // Arrow body
    const col = e.hero.color;
    ctx.translate(sx, sy);
    ctx.rotate(angle);
    ctx.fillStyle = col;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(arrowSize, 0);
    ctx.lineTo(-arrowSize * 0.6,  arrowSize * 0.55);
    ctx.lineTo(-arrowSize * 0.2, 0);
    ctx.lineTo(-arrowSize * 0.6, -arrowSize * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.rotate(-angle); // unrotate for text

    // Name label
    const labelSize = Math.max(8, 10 * scale);
    ctx.font = `bold ${labelSize}px "Orbitron",monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 2.5;
    ctx.strokeText(e.hero.name, 0, -arrowSize - 2);
    ctx.fillText(e.hero.name, 0, -arrowSize - 2);

    // Mini HP bar
    const barW = 36 * scale, barH = 4 * scale;
    const bx = -barW / 2, by = arrowSize + 4;
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(bx, by, barW, barH);
    const miniHpPct = e.hp / e.maxHp;
    ctx.fillStyle = miniHpPct > 0.35 ? (e.hero?.color ?? '#44ff88') : miniHpPct > 0.18 ? '#ffaa44' : '#ff4444';
    ctx.shadowBlur = 0;
    ctx.fillRect(bx, by, barW * miniHpPct, barH);

    // Distance = shortest warp-aware distance
    const dist = Math.round(Math.hypot(rawDx, rawDy) / 10);
    ctx.font = `${Math.max(7, 8 * scale)}px "Orbitron",monospace`;
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.globalAlpha = 0.6;
    ctx.fillText(`${dist}m`, 0, by + barH + labelSize + 1);

    ctx.restore();
  });
}

// ── Cached hex grid offscreen canvas ─────────────────────────────────────
let _hexCache = null, _hexCacheW = 0, _hexCacheH = 0;
function _buildHexCache(W, H) {
  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  const oc = off.getContext('2d');
  const HEX_R = 48, HEX_W = HEX_R * 2, HEX_H = Math.sqrt(3) * HEX_R;
  oc.strokeStyle = 'rgba(25,55,85,0.4)'; oc.lineWidth = 0.8;
  const cols = Math.ceil(W / (HEX_W * 0.75)) + 2;
  const rows = Math.ceil(H / HEX_H) + 2;
  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      const hx = col * HEX_W * 0.75;
      const hy = row * HEX_H + (col % 2 ? HEX_H * 0.5 : 0);
      oc.beginPath();
      for (let i = 0; i < 6; i++) {
        const ang = (Math.PI / 180) * (60 * i - 30);
        i === 0 ? oc.moveTo(hx + HEX_R * Math.cos(ang), hy + HEX_R * Math.sin(ang))
                : oc.lineTo(hx + HEX_R * Math.cos(ang), hy + HEX_R * Math.sin(ang));
      }
      oc.closePath(); oc.stroke();
    }
  }
  return off;
}

function drawArena(W, H) {
  const t = gameState?.time ?? 0;

  // ── Base floor ────────────────────────────────────────────────────────────
  ctx.fillStyle = '#06080d';
  ctx.fillRect(-10, -10, W + 20, H + 20);

  // ── Hex grid — static world-space, never moves ───────────────────────────
  // Build cache once at the full arena size so it's pixel-perfect and never shifts
  if (!_hexCache || _hexCacheW !== W || _hexCacheH !== H) {
    _hexCache = _buildHexCache(W, H);
    _hexCacheW = W; _hexCacheH = H;
  }
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.drawImage(_hexCache, 0, 0);
  ctx.restore();

  // ── Zone light bleeding — simple low-alpha circle, no composite switch ────
  if (gameState?.weatherZones?.length) {
    ctx.save();
    for (const z of gameState.weatherZones) {
      if (!z || z.intensity < 0.15) continue;
      const def = z.converged ? z.comboDef : (WEATHER_TYPES?.[z.type]);
      if (!def) continue;
      // Soft radial gradient — full color at center, fades to transparent edge (no hard blob)
      const g = ctx.createRadialGradient(z.x, z.y, 0, z.x, z.y, z.radius);
      const col = def.color ?? '#4488ff';
      g.addColorStop(0,   col + '22'); // faint center tint
      g.addColorStop(0.5, col + '18');
      g.addColorStop(1,   col + '00'); // fully transparent at edge
      ctx.fillStyle = g;
      ctx.globalAlpha = z.intensity;
      ctx.beginPath(); ctx.arc(z.x, z.y, z.radius, 0, Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ── Arena boundary — simple glowing rect, no shadowBlur ──────────────────
  ctx.save();
  const borderPulse = 0.3 + 0.2 * Math.sin(t * 0.8);
  ctx.strokeStyle = `rgba(0,180,255,${borderPulse})`; ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W-2, H-2);
  ctx.strokeStyle = `rgba(0,100,200,0.08)`; ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, W-10, H-10);
  ctx.restore();
}


// ========== ELEMENTAL SPRITE DRAWERS ==========
// ── High-resolution sprite helper ──────────────────────────────────────────
// Renders a SPRITE_DRAWER into a cached offscreen canvas at SCALE× then
// composites it back. This gives crisp sprites regardless of on-screen radius.
const _spriteCache = {};
const SPRITE_SCALE  = 4;
const SPRITE_BUF_R  = 64; // offscreen "radius" — draw at this size, scale down

// Per-hero offscreen canvas cache — each hero gets its own buffer, redrawn every 2nd frame
const _spritePerHero = {};
let _spriteFrameCount = 0;

function drawSpriteHiRes(ctx, drawer, cx, cy, r, t, facing, heroId) {
  const bufSz = Math.round(SPRITE_BUF_R * 2 * SPRITE_SCALE);

  // Each hero gets a dedicated offscreen canvas so we can cache the last frame
  let entry = _spritePerHero[heroId];
  if (!entry) {
    const off = document.createElement('canvas');
    off.width = off.height = bufSz;
    entry = { off, octx: off.getContext('2d'), lastT: -99, lastFacing: -99 };
    _spritePerHero[heroId] = entry;
  }

  // Only re-render if facing changed OR on even frames (throttle to 30fps redraw)
  const facingChanged = entry.lastFacing !== facing;
  const shouldRedraw = facingChanged || (_spriteFrameCount & 1) === 0;

  if (shouldRedraw) {
    entry.octx.clearRect(0, 0, bufSz, bufSz);
    entry.octx.save();
    entry.octx.scale(SPRITE_SCALE, SPRITE_SCALE);
    drawer(entry.octx, SPRITE_BUF_R, SPRITE_BUF_R, SPRITE_BUF_R * 0.82, t, facing);
    entry.octx.restore();
    entry.lastT = t;
    entry.lastFacing = facing;
  }

  const drawSz = r * 2.4;
  ctx.drawImage(entry.off, cx - drawSz / 2, cy - drawSz / 2, drawSz, drawSz);
}

const SPRITE_DRAWERS = {

  fire: (ctx, cx, cy, r, t, facing) => {
    // Roiling flame body — teardrop flames stacked
    const flicker = Math.sin(t*8)*0.12;
    for(let layer=0; layer<4; layer++) {
      const lf = 1 - layer*0.18;
      const lh = r*(1.4+layer*0.15+flicker*layer*0.1);
      const lw = r*(0.75-layer*0.08);
      const ly = cy + r*0.3 - layer*r*0.28;
      const hue = layer===0?'255,80,20':layer===1?'255,140,20':layer===2?'255,200,60':'255,240,180';
      const g = ctx.createRadialGradient(cx,ly,0,cx,ly,lw);
      g.addColorStop(0,`rgba(${hue},${0.9-layer*0.15})`);
      g.addColorStop(0.5,`rgba(${hue},${0.6-layer*0.1})`);
      g.addColorStop(1,`rgba(${hue},0)`);
      ctx.save();
      ctx.globalAlpha=lf;
      ctx.beginPath();
      ctx.ellipse(cx+Math.sin(t*6+layer)*r*0.08*layer, ly, lw, lh*0.7, 0, 0, Math.PI*2);
      ctx.fillStyle=g; ctx.fill();
      ctx.restore();
    }
    // ember sparks
    for(let i=0;i<5;i++){
      const ang=t*3+i*1.26; const sr=r*(0.3+Math.sin(t*4+i)*0.3);
      const sx=cx+Math.cos(ang)*sr*0.6, sy=cy-r*0.2+Math.sin(ang+t)*sr*0.8-i*3;
      ctx.save(); ctx.globalAlpha=0.6+Math.sin(t*5+i)*0.4;
      ctx.fillStyle=i%2?'#ffcc44':'#ff6622';
      ctx.beginPath(); ctx.arc(sx,sy,1.5,0,Math.PI*2); ctx.fill(); ctx.restore();
    }
    // glowing core
    const core=ctx.createRadialGradient(cx,cy,0,cx,cy,r*0.4);
    core.addColorStop(0,'rgba(255,255,200,0.9)'); core.addColorStop(1,'rgba(255,100,0,0)');
    ctx.save(); ctx.globalAlpha=0.8;
    ctx.beginPath(); ctx.arc(cx,cy,r*0.4,0,Math.PI*2); ctx.fillStyle=core; ctx.fill(); ctx.restore();
  },

  water: (ctx, cx, cy, r, t, facing) => {
    // Fluid shifting blob — organic wave distortion
    ctx.save();
    const pts=12;
    ctx.beginPath();
    for(let i=0;i<=pts;i++){
      const ang=(i/pts)*Math.PI*2;
      const wave=r*(0.85+Math.sin(ang*3+t*2)*0.1+Math.sin(ang*2-t*3)*0.08);
      const x=cx+Math.cos(ang)*wave, y=cy+Math.sin(ang)*wave*1.1;
      i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
    }
    ctx.closePath();
    const wg=ctx.createRadialGradient(cx-r*0.2,cy-r*0.3,r*0.05,cx,cy,r);
    wg.addColorStop(0,'rgba(120,220,255,0.95)');
    wg.addColorStop(0.4,'rgba(0,160,255,0.8)');
    wg.addColorStop(0.8,'rgba(0,80,200,0.6)');
    wg.addColorStop(1,'rgba(0,40,120,0.1)');
    ctx.fillStyle=wg; ctx.fill();
    // inner caustic shimmer
    for(let i=0;i<3;i++){
      const sx=cx+Math.cos(t*2+i*2.1)*r*0.3, sy=cy+Math.sin(t*1.7+i*1.8)*r*0.25;
      const sg=ctx.createRadialGradient(sx,sy,0,sx,sy,r*0.25);
      sg.addColorStop(0,'rgba(200,240,255,0.5)'); sg.addColorStop(1,'rgba(200,240,255,0)');
      ctx.beginPath(); ctx.arc(sx,sy,r*0.25,0,Math.PI*2); ctx.fillStyle=sg; ctx.fill();
    }
    ctx.restore();
    // droplet crown
    for(let i=0;i<4;i++){
      const da=(i/4)*Math.PI*2+t; const dr=r*0.9+Math.sin(t*3+i)*r*0.15;
      const dx=cx+Math.cos(da)*dr, dy=cy+Math.sin(da)*dr*0.7;
      ctx.save(); ctx.globalAlpha=0.5+Math.sin(t*4+i)*0.3;
      ctx.fillStyle='rgba(150,230,255,0.8)';
      ctx.beginPath(); ctx.arc(dx,dy,2.5,0,Math.PI*2); ctx.fill(); ctx.restore();
    }
  },

  earth: (ctx, cx, cy, r, t, facing) => {
    ctx.save();

    // ── Body — squat hexagonal boulder silhouette ──
    // Flat-topped, wider than tall, clearly geometric/rocky
    const bw = r * 1.0;
    const bh = r * 0.88;
    const pts = [
      [ 0.0, -1.0],  // top centre
      [ 0.7, -0.6],  // top-right
      [ 1.0,  0.1],  // mid-right
      [ 0.65, 0.85], // bot-right
      [-0.65, 0.85], // bot-left
      [-1.0,  0.1],  // mid-left
      [-0.7, -0.6],  // top-left
    ];

    // Stone gradient — grey-brown, lit from upper-left
    const g = ctx.createRadialGradient(cx - bw*0.3, cy - bh*0.35, r*0.05, cx + bw*0.1, cy + bh*0.2, r*1.1);
    g.addColorStop(0,   'rgba(185,175,155,0.97)'); // warm highlight
    g.addColorStop(0.35,'rgba(135,125,108,0.95)'); // mid stone
    g.addColorStop(0.7, 'rgba(88, 80, 65, 0.92)'); // shadowed stone
    g.addColorStop(1,   'rgba(52, 46, 36, 0.88)'); // deep shadow

    ctx.beginPath();
    pts.forEach(([px, py], i) => {
      const x = cx + px * bw, y = cy + py * bh;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();

    // ── Hard facet edge lines — makes it read as carved stone ──
    ctx.strokeStyle = 'rgba(40,34,25,0.55)';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // ── Interior facet lines — catches light differently ──
    ctx.strokeStyle = 'rgba(200,190,165,0.22)';
    ctx.lineWidth = 1.0;
    // Left face divide
    ctx.beginPath();
    ctx.moveTo(cx - bw*0.0,  cy - bh*1.0);
    ctx.lineTo(cx - bw*0.18, cy + bh*0.05);
    ctx.lineTo(cx - bw*0.0,  cy + bh*0.85);
    ctx.stroke();
    // Right face divide
    ctx.beginPath();
    ctx.moveTo(cx + bw*0.0,  cy - bh*1.0);
    ctx.lineTo(cx + bw*0.18, cy + bh*0.05);
    ctx.lineTo(cx + bw*0.0,  cy + bh*0.85);
    ctx.stroke();

    // ── Crack lines — sharp, angular, not organic ──
    ctx.strokeStyle = 'rgba(30,25,18,0.65)';
    ctx.lineWidth = 1.1;
    [
      [[-0.28, -0.42], [-0.05, -0.1], [-0.18, 0.22]],   // left crack
      [[ 0.15, -0.55], [ 0.32,  0.0], [ 0.22, 0.30]],   // right crack
      [[-0.08,  0.1 ], [ 0.25,  0.35]],                  // horizontal shard
    ].forEach(segs => {
      ctx.beginPath();
      segs.forEach(([px, py], i) => {
        const x = cx + px * bw, y = cy + py * bh;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
    });

    // ── Rim highlight — top edge catches light ──
    ctx.strokeStyle = 'rgba(220,210,190,0.45)';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(cx + pts[6][0]*bw, cy + pts[6][1]*bh);
    ctx.lineTo(cx + pts[0][0]*bw, cy + pts[0][1]*bh);
    ctx.lineTo(cx + pts[1][0]*bw, cy + pts[1][1]*bh);
    ctx.stroke();

    // ── Eyes — narrow glowing slits, not round blobs ──
    [[-0.28, -0.18], [0.28, -0.18]].forEach(([ox, oy]) => {
      const ex = cx + ox * r, ey = cy + oy * r;
      // Slit shape
      ctx.save();
      ctx.translate(ex, ey);
      ctx.scale(1, 0.38); // flatten to a slit
      const eg = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.16);
      eg.addColorStop(0, 'rgba(160,255,60,1.0)');
      eg.addColorStop(0.5,'rgba(100,200,30,0.7)');
      eg.addColorStop(1, 'rgba(50,120,10,0)');
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.14, 0, Math.PI * 2);
      ctx.fillStyle = eg;
      ctx.fill();
      ctx.restore();
    });

    ctx.restore();
  },


  wind: (ctx, cx, cy, r, t, facing) => {
    // Near-invisible — motion blur streaks and a translucent vortex core
    ctx.save();
    // outer wind rings
    for(let i=0;i<3;i++){
      const ri=r*(0.6+i*0.2); const alpha=(0.25-i*0.07)*(0.6+Math.sin(t*3+i)*0.4);
      ctx.strokeStyle=`rgba(200,255,220,${alpha})`; ctx.lineWidth=1.5-i*0.3;
      ctx.setLineDash([r*0.4,r*0.3]); ctx.lineDashOffset=-t*80;
      ctx.beginPath(); ctx.arc(cx,cy,ri,0,Math.PI*2); ctx.stroke();
    }
    ctx.setLineDash([]);
    // swirl streaks
    for(let i=0;i<6;i++){
      const ang=t*4+i*(Math.PI/3);
      const x1=cx+Math.cos(ang)*r*0.2, y1=cy+Math.sin(ang)*r*0.2;
      const x2=cx+Math.cos(ang+0.8)*r*0.85, y2=cy+Math.sin(ang+0.8)*r*0.85;
      ctx.strokeStyle=`rgba(210,255,230,${0.15+Math.sin(t*3+i)*0.1})`; ctx.lineWidth=1.2;
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.quadraticCurveTo(cx,cy,x2,y2); ctx.stroke();
    }
    // translucent core
    const wc=ctx.createRadialGradient(cx,cy,0,cx,cy,r*0.45);
    wc.addColorStop(0,'rgba(200,255,220,0.35)'); wc.addColorStop(0.5,'rgba(150,240,180,0.15)'); wc.addColorStop(1,'rgba(150,240,180,0)');
    ctx.beginPath(); ctx.arc(cx,cy,r*0.45,0,Math.PI*2); ctx.fillStyle=wc; ctx.fill();
    // eye
    const eyeG=ctx.createRadialGradient(cx,cy,0,cx,cy,r*0.15);
    eyeG.addColorStop(0,'rgba(240,255,245,0.9)'); eyeG.addColorStop(1,'rgba(100,220,150,0)');
    ctx.beginPath(); ctx.arc(cx,cy,r*0.15,0,Math.PI*2); ctx.fillStyle=eyeG; ctx.fill();
    ctx.restore();
  },

  shadow: (ctx, cx, cy, r, t, facing) => {
    // Void entity — writhing dark tendrils, glowing magenta eyes
    ctx.save();
    // dark void core
    const sc=ctx.createRadialGradient(cx,cy,r*0.1,cx,cy,r*1.1);
    sc.addColorStop(0,'rgba(60,10,80,0.98)');
    sc.addColorStop(0.4,'rgba(30,0,50,0.85)');
    sc.addColorStop(0.8,'rgba(10,0,25,0.5)');
    sc.addColorStop(1,'rgba(0,0,0,0)');
    ctx.beginPath(); ctx.arc(cx,cy,r*1.1,0,Math.PI*2); ctx.fillStyle=sc; ctx.fill();
    // writhing tendrils
    for(let i=0;i<6;i++){
      const baseAng=(i/6)*Math.PI*2+t*0.8;
      const waveAng=baseAng+Math.sin(t*3+i)*0.4;
      const tx2=cx+Math.cos(waveAng)*(r*0.5+Math.sin(t*2+i)*r*0.4);
      const ty2=cy+Math.sin(waveAng)*(r*0.5+Math.cos(t*2.3+i)*r*0.3);
      const tg=ctx.createLinearGradient(cx,cy,tx2,ty2);
      tg.addColorStop(0,'rgba(136,68,204,0.7)'); tg.addColorStop(1,'rgba(60,0,100,0)');
      ctx.strokeStyle=tg; ctx.lineWidth=2+Math.sin(t*3+i);
      ctx.beginPath(); ctx.moveTo(cx,cy);
      ctx.quadraticCurveTo(cx+Math.cos(waveAng+0.5)*r*0.6, cy+Math.sin(waveAng+0.5)*r*0.6, tx2,ty2);
      ctx.stroke();
    }
    // glowing eye pair
    [[-0.25,-0.15],[0.25,-0.15]].forEach(([ox,oy])=>{
      const pulse=0.7+Math.sin(t*4)*0.3;
      const eg=ctx.createRadialGradient(cx+ox*r,cy+oy*r,0,cx+ox*r,cy+oy*r,r*0.15);
      eg.addColorStop(0,`rgba(255,80,200,${pulse})`); eg.addColorStop(0.5,`rgba(180,40,160,${pulse*0.6})`); eg.addColorStop(1,'rgba(100,0,100,0)');
      
      ctx.beginPath(); ctx.arc(cx+ox*r,cy+oy*r,r*0.12,0,Math.PI*2); ctx.fillStyle=eg; ctx.fill();
    });
    ctx.restore();
  },

  arcane: (ctx, cx, cy, r, t, facing) => {
    // Rune sigil being — orbiting glyphs, pulsing arcane core
    ctx.save();
    // core sphere
    const ag=ctx.createRadialGradient(cx,cy,0,cx,cy,r*0.8);
    ag.addColorStop(0,'rgba(255,180,255,0.9)');
    ag.addColorStop(0.3,'rgba(255,80,180,0.7)');
    ag.addColorStop(0.7,'rgba(180,20,120,0.5)');
    ag.addColorStop(1,'rgba(100,0,80,0.1)');
    ctx.beginPath(); ctx.arc(cx,cy,r*0.8,0,Math.PI*2);
    
    ctx.fillStyle=ag; ctx.fill();
    // orbiting rune marks
    const runes=['*','+','O','@','#'];
    for(let i=0;i<5;i++){
      const ang=t*1.5+i*(Math.PI*2/5);
      const or=r*0.9; const ox=cx+Math.cos(ang)*or, oy=cy+Math.sin(ang)*or*0.6;
      ctx.save(); ctx.globalAlpha=0.55+Math.sin(t*3+i)*0.35;
      ctx.fillStyle='rgba(255,150,230,0.9)';
      ctx.font=`${r*0.28}px serif`; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(runes[i],ox,oy); ctx.restore();
    }
    // inner sigil
    ctx.save(); ctx.globalAlpha=0.4+Math.sin(t*2)*0.2;
    ctx.strokeStyle='rgba(255,180,230,0.8)'; ctx.lineWidth=1;
    for(let i=0;i<6;i++){
      const a1=(i/6)*Math.PI*2, a2=((i+2)/6)*Math.PI*2;
      ctx.beginPath(); ctx.moveTo(cx+Math.cos(a1)*r*0.4,cy+Math.sin(a1)*r*0.4);
      ctx.lineTo(cx+Math.cos(a2)*r*0.4,cy+Math.sin(a2)*r*0.4); ctx.stroke();
    }
    ctx.restore();
    ctx.restore();
  },

  lightning: (ctx, cx, cy, r, t, facing) => {
    // Jagged electric being — crackling arcs, electric core
    ctx.save();
    // electric body
    const lg=ctx.createRadialGradient(cx,cy,r*0.1,cx,cy,r*0.85);
    lg.addColorStop(0,'rgba(255,255,150,0.95)');
    lg.addColorStop(0.3,'rgba(255,220,0,0.8)');
    lg.addColorStop(0.7,'rgba(200,160,0,0.4)');
    lg.addColorStop(1,'rgba(100,80,0,0)');
    ctx.beginPath(); ctx.arc(cx,cy,r*0.85,0,Math.PI*2);
    
    ctx.fillStyle=lg; ctx.fill();
    // lightning bolt arcs radiating out
    for(let bolt=0;bolt<5;bolt++){
      const bAng=(bolt/5)*Math.PI*2+t*5+Math.sin(t*8)*0.3;
      ctx.strokeStyle=`rgba(255,240,80,${0.5+Math.random()*0.5})`; ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.moveTo(cx,cy);
      let bx=cx,by=cy;
      for(let seg=0;seg<4;seg++){
        const sr=r*(0.2+seg*0.2);
        bx+=Math.cos(bAng+(Math.random()-0.5)*1.2)*sr*0.4;
        by+=Math.sin(bAng+(Math.random()-0.5)*1.2)*sr*0.4;
        ctx.lineTo(bx,by);
      }
      ctx.stroke();
    }
    // bright core flash
    const flash=0.7+Math.sin(t*12)*0.3;
    const fc=ctx.createRadialGradient(cx,cy,0,cx,cy,r*0.3);
    fc.addColorStop(0,`rgba(255,255,255,${flash})`); fc.addColorStop(1,'rgba(255,240,0,0)');
    ctx.beginPath(); ctx.arc(cx,cy,r*0.3,0,Math.PI*2); ctx.fillStyle=fc; ctx.fill();
    ctx.restore();
  },

  ice: (ctx, cx, cy, r, t, facing) => {
    // Crystalline form — hexagonal shards, inner frost glow
    ctx.save();
    // crystal facets
    const shards=6;
    for(let i=0;i<shards;i++){
      const ang=(i/shards)*Math.PI*2+t*0.3;
      const sr=r*(0.7+Math.sin(t*1.5+i)*0.12);
      const innerR=r*0.25;
      ctx.beginPath();
      ctx.moveTo(cx+Math.cos(ang)*innerR, cy+Math.sin(ang)*innerR);
      ctx.lineTo(cx+Math.cos(ang-0.35)*sr, cy+Math.sin(ang-0.35)*sr*0.9);
      ctx.lineTo(cx+Math.cos(ang)*sr*1.1, cy+Math.sin(ang)*sr*0.95);
      ctx.lineTo(cx+Math.cos(ang+0.35)*sr, cy+Math.sin(ang+0.35)*sr*0.9);
      ctx.closePath();
      const ig=ctx.createLinearGradient(cx,cy-r,cx,cy+r);
      ig.addColorStop(0,'rgba(200,240,255,0.85)');
      ig.addColorStop(0.5,'rgba(100,200,240,0.7)');
      ig.addColorStop(1,'rgba(40,120,200,0.5)');
      ctx.fillStyle=ig; ctx.globalAlpha=0.75+Math.sin(t*2+i)*0.15; ctx.fill();
      ctx.strokeStyle='rgba(180,230,255,0.6)'; ctx.lineWidth=0.8; ctx.stroke();
    }
    // frosty core
    const fc=ctx.createRadialGradient(cx,cy,0,cx,cy,r*0.35);
    fc.addColorStop(0,'rgba(240,250,255,0.95)'); fc.addColorStop(0.5,'rgba(160,220,255,0.6)'); fc.addColorStop(1,'rgba(80,160,220,0)');
    ctx.globalAlpha=1;
    ctx.beginPath(); ctx.arc(cx,cy,r*0.35,0,Math.PI*2); ctx.fillStyle=fc; ctx.fill();
    ctx.restore();
  },

  metal: (ctx, cx, cy, r, t, facing) => {
    // Plated armored form — interlocking chrome panels, reflective highlights
    ctx.save();
    // base plate shape (octagon-ish)
    const sides=8;
    ctx.beginPath();
    for(let i=0;i<sides;i++){
      const ang=(i/sides)*Math.PI*2 - Math.PI/8;
      const rad=r*(0.82+Math.cos(ang*4)*0.05);
      i===0?ctx.moveTo(cx+Math.cos(ang)*rad,cy+Math.sin(ang)*rad):ctx.lineTo(cx+Math.cos(ang)*rad,cy+Math.sin(ang)*rad);
    }
    ctx.closePath();
    const mg=ctx.createLinearGradient(cx-r,cy-r,cx+r,cy+r);
    mg.addColorStop(0,'rgba(200,215,230,0.95)');
    mg.addColorStop(0.25,'rgba(140,160,180,0.9)');
    mg.addColorStop(0.5,'rgba(180,195,210,0.85)');
    mg.addColorStop(0.75,'rgba(100,120,140,0.9)');
    mg.addColorStop(1,'rgba(60,80,100,0.8)');
    ctx.fillStyle=mg; ctx.fill();
    // plate lines
    ctx.strokeStyle='rgba(230,240,255,0.5)'; ctx.lineWidth=1;
    for(let i=0;i<4;i++){
      const a=(i/4)*Math.PI;
      ctx.beginPath(); ctx.moveTo(cx+Math.cos(a)*r*0.8,cy+Math.sin(a)*r*0.8);
      ctx.lineTo(cx+Math.cos(a+Math.PI)*r*0.8,cy+Math.sin(a+Math.PI)*r*0.8); ctx.stroke();
    }
    // chrome specular highlights
    [[-.3,-.35,.14],[.1,-.4,.09]].forEach(([ox,oy,size])=>{
      const hg=ctx.createRadialGradient(cx+ox*r,cy+oy*r,0,cx+ox*r,cy+oy*r,r*size);
      hg.addColorStop(0,'rgba(255,255,255,0.9)'); hg.addColorStop(1,'rgba(255,255,255,0)');
      ctx.beginPath(); ctx.arc(cx+ox*r,cy+oy*r,r*size,0,Math.PI*2); ctx.fillStyle=hg; ctx.fill();
    });
    // energy core
    const ec=ctx.createRadialGradient(cx,cy,0,cx,cy,r*0.22);
    ec.addColorStop(0,`rgba(100,180,255,${0.8+Math.sin(t*4)*0.2})`); ec.addColorStop(1,'rgba(50,100,180,0)');
    ctx.beginPath(); ctx.arc(cx,cy,r*0.22,0,Math.PI*2); ctx.fillStyle=ec; ctx.fill();
    ctx.restore();
  },

  nature: (ctx, cx, cy, r, t, facing) => {
    // Vine & blossom being — organic vines, flower blooms, bark texture
    ctx.save();
    // bark core body
    const ng=ctx.createRadialGradient(cx,cy,r*0.1,cx,cy,r*0.85);
    ng.addColorStop(0,'rgba(100,180,80,0.9)');
    ng.addColorStop(0.4,'rgba(60,130,40,0.85)');
    ng.addColorStop(0.8,'rgba(40,90,20,0.8)');
    ng.addColorStop(1,'rgba(20,60,10,0.3)');
    ctx.beginPath(); ctx.arc(cx,cy,r*0.85,0,Math.PI*2);
    
    ctx.fillStyle=ng; ctx.fill();
    // bark texture lines
    ctx.strokeStyle='rgba(20,60,10,0.4)'; ctx.lineWidth=1;
    for(let i=0;i<5;i++){
      const by=cy-r*0.6+i*r*0.28;
      ctx.beginPath(); ctx.moveTo(cx-r*0.5+Math.sin(i)*r*0.1,by);
      ctx.quadraticCurveTo(cx,by+r*0.07,cx+r*0.5+Math.cos(i)*r*0.1,by); ctx.stroke();
    }
    // vine tendrils
    for(let i=0;i<5;i++){
      const va=(i/5)*Math.PI*2+t*0.5;
      const wave=Math.sin(t*2+i)*0.3;
      ctx.strokeStyle=`rgba(80,200,60,${0.5+Math.sin(t+i)*0.3})`; ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(cx,cy);
      ctx.bezierCurveTo(cx+Math.cos(va+wave)*r*0.5, cy+Math.sin(va)*r*0.4,
        cx+Math.cos(va-wave)*r*0.8, cy+Math.sin(va+wave)*r*0.6,
        cx+Math.cos(va)*r, cy+Math.sin(va)*r*0.85); ctx.stroke();
      // blossom at tip
      const bx=cx+Math.cos(va)*r, by2=cy+Math.sin(va)*r*0.85;
      for(let p=0;p<5;p++){
        const pa=p*(Math.PI*2/5)+t;
        ctx.fillStyle=p%2?'rgba(255,160,200,0.8)':'rgba(255,100,150,0.7)';
        ctx.beginPath(); ctx.arc(bx+Math.cos(pa)*r*0.12,by2+Math.sin(pa)*r*0.09,r*0.07,0,Math.PI*2); ctx.fill();
      }
    }
    // glowing nature core
    const nc=ctx.createRadialGradient(cx,cy,0,cx,cy,r*0.3);
    nc.addColorStop(0,'rgba(180,255,120,0.9)'); nc.addColorStop(1,'rgba(80,200,40,0)');
    ctx.beginPath(); ctx.arc(cx,cy,r*0.3,0,Math.PI*2); ctx.fillStyle=nc; ctx.fill();
    ctx.restore();
  },
};

function drawChar(c, gs) {
  if (!c.alive) return;
  ctx.save();

  // ── Spawn invulnerability flicker ──
  if ((c.spawnInvuln ?? 0) > 0) {
    // Flicker faster as invuln expires; fully visible at 0
    const flickRate = c.spawnInvuln > 1 ? 8 : 16;
    if (Math.floor(performance.now() / (1000 / flickRate)) % 2 === 0) {
      ctx.restore();
      return; // skip this frame = flicker
    }
    ctx.globalAlpha = 0.75;
  }

  const bob = Math.sin(c.animTick*3)*2.5;
  const cx=c.x, cy=c.y+bob;
  const r=c.radius;
  const t=c.animTick;

  // ── Sprint afterimage trail ──
  if ((c.sprintTimer ?? 0) > 0) {
    const vel = Math.hypot(c.velX||c.vx||0, c.velY||c.vy||0);
    if (vel > 0.5) {
      const nx = (c.velX||c.vx||0) / vel;
      const ny = (c.velY||c.vy||0) / vel;
      const trailCount = 3;
      for (let ti = 1; ti <= trailCount; ti++) {
        const tx2 = cx - nx * r * ti * 0.9;
        const ty2 = cy - ny * r * ti * 0.9;
        const alpha = 0.18 - ti * 0.05;
        ctx.save();
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.beginPath();
        ctx.arc(tx2, ty2, r * (1 - ti * 0.1), 0, Math.PI * 2);
        ctx.fillStyle = c.hero?.color ?? '#ffdc32';
        ctx.fill();
        ctx.restore();
      }
    }
    // Golden speed-ring pulse
    const pulse = 0.3 + 0.2 * Math.sin(t * 12);
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffdc32';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();
  }

  // Velocity tilt — lean into movement direction
  const speed = Math.hypot(c.velX||c.vx||0, c.velY||c.vy||0);
  const maxTilt = 0.18; // radians (~10°)
  const tiltX = c.isPlayer
    ? Math.max(-maxTilt, Math.min(maxTilt, (c.velX||0) * 0.015))
    : Math.max(-maxTilt, Math.min(maxTilt, (c.vx||0) * 0.012));
  const tiltY = c.isPlayer
    ? Math.max(-maxTilt*0.6, Math.min(maxTilt*0.6, (c.velY||0) * 0.010))
    : 0;
  if (Math.abs(tiltX) > 0.005 || Math.abs(tiltY) > 0.005) {
    ctx.translate(cx, cy);
    ctx.rotate(tiltX);
    ctx.translate(-cx, -cy);
  }

  // Weather zone rings — one ring per active zone, offset outward
  if (c.inWeatherAll?.length) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 5);
    c.inWeatherAll.filter(w => w.intensity > 0.2).forEach((w, i) => {
      ctx.save();
      ctx.strokeStyle = w.def.color;
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = w.intensity * 0.6 * pulse;
      ctx.beginPath();
      ctx.arc(cx, cy, r + 10 + i * 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    });
  }

  // ── Passive visual state ring ──
  {
    const heroId = c.hero?.id;
    const passive = PASSIVES[heroId];
    if (passive) {
      // EMBER: heat stacks — orange pip dots above head
      if (heroId === 'fire' && (c.passiveStacks ?? 0) > 0) {
        ctx.save();
        for (let s = 0; s < c.passiveStacks; s++) {
          const px = cx - 6 + s * 12;
          const py = cy - r - 26;
          ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI*2);
          ctx.fillStyle = '#ff6622';
          ctx.globalAlpha = 0.9 + 0.1*Math.sin(t*8+s);
          ctx.fill();
        }
        ctx.restore();
      }
      // TIDE: shield ready — bright blue outer ring
      if (heroId === 'water' && c.passiveReady) {
        ctx.save();
        ctx.globalAlpha = 0.5 + 0.4*Math.sin(t*4);
        ctx.strokeStyle = '#00aaff';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(cx, cy, r+16, 0, Math.PI*2); ctx.stroke();
        ctx.restore();
      }
      // VOID: shadow strike primed — purple crackling ring
      if (heroId === 'shadow' && c.passiveReady) {
        ctx.save();
        ctx.globalAlpha = 0.55 + 0.35*Math.sin(t*6);
        ctx.strokeStyle = '#cc66ff';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([4,3]);
        ctx.lineDashOffset = -t*20;
        ctx.beginPath(); ctx.arc(cx, cy, r+18, 0, Math.PI*2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
      // FORGE: iron will active — silver shielding ring
      if (heroId === 'metal' && (c.passiveActive ?? 0) > 0) {
        ctx.save();
        ctx.globalAlpha = 0.6 + 0.3*Math.sin(t*5);
        ctx.strokeStyle = '#ddeeff';
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(cx, cy, r+14, 0, Math.PI*2); ctx.stroke();
        ctx.restore();
      }
    }
  }

  // Target lock rings — drawn for each human player who has this char locked
  if (!c.isPlayer && gameState?.players) {
    for (const hp of gameState.players) {
      if (hp._lockedTarget !== c) continue;
      const isSolo = gameState.players.length === 1;
      const pColor = isSolo ? '#ff4444' : (PLAYER_COLORS[hp._playerIdx ?? 0] ?? '#ffee44');
      const lockPulse = 0.7 + Math.sin(t * 5) * 0.3;
      ctx.save();

      if (isSolo) {
        // Solo: prominent red target reticle — thick pulsing ring + corner brackets + HP label
        // Outer pulsing ring
        ctx.strokeStyle = `rgba(255,60,60,${lockPulse})`;
        ctx.lineWidth = 2.5;
        ctx.setLineDash([8, 4]);
        ctx.lineDashOffset = -t * 35;
        ctx.beginPath(); ctx.arc(cx, cy, r + 18, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);

        // Corner brackets — brighter and bigger
        ctx.lineWidth = 3;
        ctx.strokeStyle = `rgba(255,80,80,${0.8 + Math.sin(t * 5) * 0.2})`;
        const bSize = 10, bGap = r + 11;
        [[1,1],[-1,1],[1,-1],[-1,-1]].forEach(([sx,sy]) => {
          ctx.beginPath();
          ctx.moveTo(cx + sx*bGap, cy + sy*(bGap+bSize));
          ctx.lineTo(cx + sx*bGap, cy + sy*bGap);
          ctx.lineTo(cx + sx*(bGap+bSize), cy + sy*bGap);
          ctx.stroke();
        });

        // HP% label above the ring — stays in world space, no need to look away
        const hpPct = c.hp / c.maxHp;
        const hpCol = hpPct > 0.5 ? '#44ff88' : hpPct > 0.25 ? '#ffaa44' : '#ff4444';
        const labelY = cy - r - 34;
        const fs = Math.max(9, r * 0.48);
        ctx.font = `900 ${fs}px "Orbitron",monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = 3;
        ctx.fillStyle = hpCol;
        const hpStr = `${Math.ceil(hpPct * 100)}%`;
        ctx.strokeText(hpStr, cx, labelY);
        ctx.fillText(hpStr, cx, labelY);

        // Flux badge — only when solo player AND target are both in the Rift
        const soloPlayer = gameState?.player ?? gameState?.players?.[0];
        if (soloPlayer?._inRift && c._inRift) {
          const fluxTotal = Object.values(c._flux ?? {}).reduce((a, b) => a + b, 0);
          const fluxStr = `⬡ ${fluxTotal > 0 ? fluxTotal : '0'}`;
          const fluxCol = fluxTotal > 0 ? '#44ffcc' : '#336655';
          const ffs = Math.max(8, r * 0.4);
          ctx.font = `700 ${ffs}px "Orbitron",monospace`;
          ctx.fillStyle = fluxCol;
          ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.lineWidth = 2.5;
          ctx.strokeText(fluxStr, cx, labelY - fs - 2);
          ctx.fillText(fluxStr, cx, labelY - fs - 2);
        }
      } else {
        // MP: existing player-colored ring
        ctx.strokeStyle = `rgba(${hexToRgb(pColor)},${lockPulse})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 3]);
        ctx.lineDashOffset = -t * 40;
        ctx.beginPath(); ctx.arc(cx, cy, r + 22, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 2.5;
        const bSize = 8, bGap = r + 14;
        [[1,1],[-1,1],[1,-1],[-1,-1]].forEach(([sx,sy]) => {
          ctx.beginPath();
          ctx.moveTo(cx + sx*bGap, cy + sy*(bGap+bSize));
          ctx.lineTo(cx + sx*bGap, cy + sy*bGap);
          ctx.lineTo(cx + sx*(bGap+bSize), cy + sy*bGap);
          ctx.stroke();
        });
      }
      ctx.restore();
    }
  }

  // Ground shadow — single cheap dark ellipse
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = 'rgba(0,0,0,1)';
  ctx.beginPath(); ctx.ellipse(cx + r*0.1, cy + r + 2, r * 0.9, r * 0.22, 0, 0, Math.PI*2); ctx.fill();
  ctx.restore();

  // ── Team ring — solid colored ring at base for instant friend/foe read ──
  {
    const allChars = [...(gs.players ?? [gs.player]), ...gs.enemies].filter(Boolean);
    const _isFFA = gs.teamIds && gs.teamIds.length > 1 && gs.teamIds.every(tid =>
      allChars.filter(x => x.teamId === tid).length <= 1
    );
    // In FFA use hero color; in team play use the team's color from TEAM_COLORS
    const ringColor = _isFFA
      ? (c.hero?.color ?? '#fff')
      : (TEAM_COLORS[c.teamId ?? 0]?.color ?? c.hero?.color ?? '#fff');
    ctx.save();
    ctx.globalAlpha = c.isPlayer ? 0.85 : 0.70;
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = Math.max(2.5, r * 0.18);
    ctx.shadowColor = ringColor;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.ellipse(cx + r*0.1, cy + r + 2, r * 0.78, r * 0.18, 0, 0, Math.PI*2);
    ctx.stroke();
    ctx.restore();
  }

  // Status rings
  if(c.frozen>0) {
    ctx.save(); ctx.strokeStyle='rgba(136,221,255,0.8)'; ctx.lineWidth=3;
    ctx.setLineDash([5,3]); ctx.beginPath(); ctx.arc(cx,cy,r+8,0,Math.PI*2); ctx.stroke(); ctx.restore();
  }
  // Critical HP slow indicator — pulsing red ring below 25% HP
  if(c.hp / c.maxHp < 0.25) {
    ctx.save();
    const pulse = 0.4 + 0.4 * Math.sin(t * 7);
    ctx.strokeStyle = `rgba(255,60,60,${pulse})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.arc(cx, cy, r + 6, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
  if(c.silenced>0) {
    ctx.save(); ctx.strokeStyle='rgba(180,100,255,0.7)'; ctx.lineWidth=2.5;
    ctx.setLineDash([3,5]); ctx.beginPath(); ctx.arc(cx,cy,r+14,0,Math.PI*2); ctx.stroke();
    ctx.setLineDash([]); ctx.font='11px serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.globalAlpha=0.7+Math.sin(t*6)*0.3; ctx.fillText('SLN',cx,cy-r-22); ctx.restore();
  }
  if(c.shielded>0) {
    ctx.save();
    const pulse=0.4+Math.sin(t*4)*0.2;
    ctx.strokeStyle=`rgba(200,220,255,${pulse})`; ctx.lineWidth=2.5;
    ctx.beginPath(); ctx.arc(cx,cy,r+12,0,Math.PI*2); ctx.stroke();
    ctx.strokeStyle=`rgba(200,220,255,${pulse*0.4})`; ctx.lineWidth=6;
    ctx.beginPath(); ctx.arc(cx,cy,r+12,0,Math.PI*2); ctx.stroke();
    ctx.restore();
  }

  // Draw unique elemental sprite — rendered offscreen at 4× for crispness
  const drawer = SPRITE_DRAWERS[c.hero.id];
  if (drawer) {
    drawSpriteHiRes(ctx, drawer, cx, cy, r, t, c.facing, c.hero.id);
  }

  // Player indicator dashes
  if(c.isPlayer) {
    ctx.save();
    ctx.strokeStyle='rgba(0,212,255,0.45)'; ctx.lineWidth=1.5;
    ctx.setLineDash([5,5]); ctx.lineDashOffset=-t*30;
    ctx.beginPath(); ctx.arc(cx,cy,r+17,0,Math.PI*2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // HP bar — scaled up for couch readability
  const bw=r*3.2, bh=Math.max(7, window.innerWidth*0.009);
  const bx=cx-bw/2, by=cy-r-20;
  ctx.fillStyle='rgba(0,0,0,0.55)';
  // ── Player identifier (P1/P2/etc.) — human players only, above hero name ──
  if (c.isPlayer && (c._playerIdx ?? -1) >= 0 && gs.players && gs.players.length > 1) {
    const pColor = PLAYER_COLORS[c._playerIdx] ?? '#ffee44';
    const ps = Math.max(6, r * 0.38);
    ctx.save();
    ctx.font = `900 ${ps}px "Orbitron",monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = pColor;
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 2.5;
    const label = `P${c._playerIdx + 1}`;
    ctx.strokeText(label, cx, by - 2 - Math.max(8, r * 0.52) - 2);
    ctx.fillText(label, cx, by - 2 - Math.max(8, r * 0.52) - 2);
    ctx.restore();
  }

  // ── Hero name label above HP bar ──
  const heroCol = c.hero?.color ?? '#44ff88';
  {
    const ns = Math.max(8, r * 0.52);
    ctx.save();
    ctx.font = `700 ${ns}px "Orbitron",monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.lineWidth = 3;
    ctx.globalAlpha = c.isPlayer ? 0.95 : 0.75;
    const displayName = c._tutorialLabel ?? c.hero.name;
    const nameColor = c._tutorialKillable ? '#ff4444' : c._tutorialImmortal ? '#aaccff' : heroCol;
    ctx.strokeText(displayName, cx, by - 2);
    ctx.fillStyle = nameColor;
    ctx.fillText(displayName, cx, by - 2);
    ctx.restore();
  }

  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx,by,bw,bh,2) : ctx.fillRect(bx,by,bw,bh); ctx.fill();
  const hpPct=c.hp/c.maxHp;
  // In team matches, HP bar uses team color at full health so teammates are instantly readable
  const isFFA = gs.teamIds && gs.teamIds.length > 2 && gs.teamIds.every(tid => {
    const membersOnTeam = [...(gs.players??[gs.player]),...gs.enemies].filter(x=>x.teamId===tid);
    return membersOnTeam.length <= 1;
  });
  const teamCol = TEAM_COLORS[c.teamId ?? 0]?.color ?? heroCol;
  const baseBarCol = isFFA ? heroCol : teamCol;
  const hpColor = hpPct > 0.35 ? baseBarCol : hpPct > 0.18 ? '#ffaa44' : '#ff4444';
  ctx.fillStyle=hpColor;
  ctx.fillRect(bx,by,bw*hpPct,bh);

  // Team color strip below HP bar — always shows team color regardless of HP level
  // Makes it instantly readable who is friend/foe in a fight
  if (!isFFA) {
    const stripH = Math.max(2, bh * 0.35);
    const stripY = by + bh + 1;
    ctx.fillStyle = teamCol;
    ctx.globalAlpha = 0.7;
    ctx.fillRect(bx, stripY, bw, stripH);
    ctx.globalAlpha = 1;
  }

  // Mana bar — sits 3px below HP bar, slightly thinner
  const mbh = Math.max(4, bh * 0.65);
  const mby = by + bh + 3;
  const manaPct = Math.min(1, (c.mana ?? 0) / (c.maxMana ?? 80));
  ctx.fillStyle='rgba(0,0,0,0.45)';
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx,mby,bw,mbh,2) : ctx.fillRect(bx,mby,bw,mbh); ctx.fill();
  ctx.fillStyle='#4488ff';
  ctx.fillRect(bx, mby, bw * manaPct, mbh);

  // Flux is shown in the controller HUD strip, not on the sprite

  // Combat class badge (small pill under name for player only)
  if (c.isPlayer) {
    const cls = c.combatClass || 'hybrid';
    const clsCfg = COMBAT_CLASS[cls];
    ctx.save();
    ctx.font=`bold ${Math.max(7,r*0.38)}px "Orbitron",monospace`;
    ctx.textAlign='center'; ctx.textBaseline='top';
    ctx.fillStyle=clsCfg?.color||'#fff';
    ctx.globalAlpha=0.65;
    ctx.fillText(clsCfg?.label||cls.toUpperCase(), cx, by+bh+3);
    ctx.restore();
  }

  // ── Weather buff pills — glowing pill badges below character ──
  const activeZones = c.inWeatherAll?.length ? c.inWeatherAll.filter(w => w.intensity > 0.2) : [];
  if (activeZones.length) {
    const t_now = performance.now() / 1000;
    const bob = Math.sin(t_now * 2.5) * 2;
    const pillFs = Math.max(7, Math.min(9, r * 0.48));
    ctx.save();
    ctx.font = `700 ${pillFs}px "Orbitron",monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let pillY = cy + r + 18 + bob;

    for (const w of activeZones) {
      const def = w.def;
      if (!def) continue;
      const u   = def?.universal;
      const eff = def?.effects;
      const intensity = w.intensity;
      const parts = [];

      if (u) {
        if (u.dmgMult) {
          const actual = Math.round((Math.pow(u.dmgMult, intensity) - 1) * 100);
          parts.push(actual >= 0 ? `DMG +${actual}%` : `DMG ${actual}%`);
        }
        if (u.rangeMult) {
          const actual = Math.round((Math.pow(u.rangeMult, intensity) - 1) * 100);
          parts.push(actual >= 0 ? `RNG +${actual}%` : `RNG ${actual}%`);
        }
        if (u.speedMult) {
          const actual = Math.round((Math.pow(u.speedMult, intensity) - 1) * 100);
          parts.push(actual >= 0 ? `SPD +${actual}%` : `SPD ${actual}%`);
        }
        if (u.cooldownMult) {
          const drainMult = 1 / (1 - (1 - u.cooldownMult) * intensity);
          parts.push(`CD ×${drainMult.toFixed(1)}`);
        }
        if (u.healRate)       parts.push(`+${Math.round(u.healRate * intensity)}HP/s`);
        if (u.voidPull)       parts.push(`PULL`);
        if (u.meleeDmgMult)   parts.push(`MELEE ×${((1+(u.meleeDmgMult-1)*intensity)).toFixed(1)}`);
        if (u.lifesteal)      parts.push(`LIFESTEAL ${Math.round(u.lifesteal*intensity*100)}%`);
        if (u.killSpeedBurst) parts.push(`KILL BURST`);
        if (u.firstHitBonus)  parts.push(`1ST HIT ×${u.firstHitBonus.mult.toFixed(1)}`);
        if (u.abilityChain)   parts.push(`CHAIN ${Math.round(u.abilityChain.pct*100)}%`);
      } else if (eff) {
        if (eff.dmgMult)          parts.push(`DMG ×${eff.dmgMult.toFixed(1)}`);
        if (eff.cooldownMult)     parts.push(`CD ×${(1/eff.cooldownMult).toFixed(1)}`);
        if (eff.speedMult)        parts.push(eff.speedMult > 1 ? `SPD +${Math.round((eff.speedMult-1)*100)}%` : `SPD ${Math.round((eff.speedMult-1)*100)}%`);
        if (eff.healRate)         parts.push(`+${eff.healRate}HP/s`);
        if (eff.projSpeedMult)    parts.push(`PROJ ×${eff.projSpeedMult.toFixed(1)}`);
        if (eff.abilityPowerMult) parts.push(`PWR ×${eff.abilityPowerMult.toFixed(1)}`);
        if (eff.reflectDmgPct)    parts.push(`REFLECT ${Math.round(eff.reflectDmgPct*100)}%`);
        if (eff.knockbackMult)    parts.push(`KB ×${eff.knockbackMult.toFixed(0)}`);
        if (eff.chainRange)       parts.push(`CHAIN`);
        if (eff.voidPull)         parts.push(`PULL`);
        if (eff.damageRate)       parts.push(`-${eff.damageRate}HP/s`);
        if (eff.defBonus)         parts.push(`ARM +${Math.round(eff.defBonus*100)}%`);
        if (eff.detonateInterval) parts.push(`DETONATE`);
        if (eff.freezeInterval)   parts.push(`FREEZE`);
        if (eff.killResetCooldowns) parts.push(`KILL=RESET`);
        if (eff.hideEnemyBars)    parts.push(`BLIND`);
      }
      if (!parts.length) continue;

      const isMega   = w.zone?.comboDef?.isMega;
      const defColor = def.color ?? '#ffffff';
      const defIcon  = def.icon  ?? '⚡';
      const pillText = (isMega ? '✦ ' : '') + parts.join(' · ');
      const alpha    = 0.5 + 0.5 * intensity;
      const pulseAlpha = alpha * (0.82 + 0.18 * Math.sin(t_now * 3));

      // Measure pill
      const textW = ctx.measureText(pillText).width;
      const iconW = pillFs + 4;
      const totalW = textW + iconW + 20; // padding
      const pillH  = pillFs + 10;
      const pillX  = cx - totalW / 2;

      // Pill background
      ctx.globalAlpha = pulseAlpha * 0.85;
      ctx.fillStyle = 'rgba(0,0,0,0.78)';
      ctx.beginPath();
      ctx.roundRect(pillX, pillY - pillH/2, totalW, pillH, pillH/2);
      ctx.fill();

      // Pill border glow
      ctx.globalAlpha = pulseAlpha * (0.7 + 0.3 * Math.sin(t_now * 3 + 1));
      ctx.strokeStyle = defColor;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(pillX, pillY - pillH/2, totalW, pillH, pillH/2);
      ctx.stroke();

      // Icon
      ctx.globalAlpha = pulseAlpha;
      ctx.font = `${pillFs + 1}px sans-serif`;
      ctx.fillStyle = defColor;
      ctx.fillText(defIcon, pillX + iconW * 0.6, pillY);

      // Text
      ctx.font = `700 ${pillFs}px "Orbitron",monospace`;
      ctx.fillStyle = defColor;
      ctx.fillText(pillText, pillX + iconW + textW / 2 + 8, pillY);

      pillY += pillH + 4;
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  ctx.restore(); // balance ctx.save() at top of drawChar

  // ── Pack need arrows — orbit around human players only ──────────────────
  // Show a pulsing directional arrow pointing to nearest pack when resources are low
  if (c.isPlayer && gs.items?.length) {
    const hpFrac   = c.hp   / c.maxHp;
    const manaFrac = (c.mana ?? 0) / (c.maxMana ?? 80);
    const t = performance.now() / 1000;

    const tryDrawPackArrow = (packType, threshold, frac, color) => {
      if (frac >= threshold) return; // not needed
      const packs = gs.items.filter(i => i.type === packType);
      if (!packs.length) return;
      // Find nearest pack
      const nearest = packs.reduce((best, p) => {
        const d = Math.hypot(p.x - c.x, p.y - c.y);
        return (!best || d < best.dist) ? { pack: p, dist: d } : best;
      }, null);
      if (!nearest) return;

      const angle = Math.atan2(nearest.pack.y - c.y, nearest.pack.x - c.x);
      const orbitR = r + 26; // distance from char centre
      const ax = cx + Math.cos(angle) * orbitR;
      const ay = cy + Math.sin(angle) * orbitR;
      const aSize = 13;

      // Pulse alpha: faster and more urgent the lower the resource
      const urgency = 1 - frac / threshold; // 0 → 1 as resource drops
      const pulseSpeed = 2 + urgency * 4;
      const alpha = 0.55 + 0.45 * Math.abs(Math.sin(t * pulseSpeed));

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(ax, ay);
      ctx.rotate(angle);
      ctx.fillStyle = color;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(aSize, 0);
      ctx.lineTo(-aSize * 0.6,  aSize * 0.55);
      ctx.lineTo(-aSize * 0.2, 0);
      ctx.lineTo(-aSize * 0.6, -aSize * 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    };

    tryDrawPackArrow('healthpack', 0.20, hpFrac,   '#ff4444');
    tryDrawPackArrow('manapack',   0.20, manaFrac, '#4488ff');
  }
}

function drawHUD(gs) {
  // ── Screen-space layout variables ──
  const W   = canvas.width;
  const H   = canvas.height;
  // Use viewport center (letterbox-aware) not raw canvas center
  const offsetX  = canvas._worldOffsetX || 0;
  const offsetY  = canvas._worldOffsetY || 0;
  const baseScale = canvas._worldScale  || 1;
  const vpW = VIEW_W * baseScale;
  const vpH = VIEW_H * baseScale;
  const cx  = offsetX + vpW / 2;
  const pad = offsetY + Math.round(vpH * 0.014);
  const nameSize = Math.max(9, Math.round(H * 0.018));
  const barH     = Math.max(10, Math.round(vpH * 0.016));
  const barGap   = Math.max(3,  Math.round(H * 0.006));

  ctx.save();

  // Sync forge-open cursor class — any human player has forge panel open
  const anyForgeOpen = (gs.players ?? [gs.player]).some(p => p?._craftPanelOpen);
  document.body.classList.toggle('forge-open', anyForgeOpen);

  // ── Spectator mode indicator ──────────────────────────────────────────────
  if (gs.spectator) {
    const sz = Math.max(9, Math.round(H * 0.014));
    ctx.font = `700 ${sz}px "Orbitron",monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(255,220,80,0.6)';
    ctx.fillText('👁 SPECTATING', pad, pad);
    ctx.textBaseline = 'alphabetic';
  }

  // ── Countdown overlay ────────────────────────────────────────────────────
  if (gs.countdown > 0) {
    const cd = gs.countdown;
    const digit = cd > 3 ? '3' : cd > 2 ? '2' : cd > 1 ? '1' : 'GO!';
    // Each digit gets exactly 1 second — pop in on appearance, hold, fade out at end
    const frac = cd % 1; // 0→1 within each second (1 = just appeared, 0 = about to change)
    const isGo = digit === 'GO!';
    // Pop scale: big on appearance, settle to 1.0
    const scale = 1 + frac * 0.35;
    const alpha = isGo ? Math.min(1, cd * 3) : 1; // GO! fades in fast then holds

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(W / 2, H / 2);
    ctx.scale(scale, scale);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${Math.round(H * 0.22)}px 'Orbitron', monospace`;

    // Cheap glow: draw text twice — offset shadow layer then crisp top layer
    const glowColor = isGo ? '#44ff88' : '#00d4ff';
    const mainColor = isGo ? '#44ff88' : '#ffffff';
    ctx.globalAlpha = 0.25 * alpha;
    ctx.fillStyle = glowColor;
    for (const [ox, oy] of [[-3,-3],[3,-3],[-3,3],[3,3],[0,-4],[0,4],[-4,0],[4,0]]) {
      ctx.fillText(digit, ox, oy);
    }
    ctx.globalAlpha = alpha;
    ctx.fillStyle = mainColor;
    ctx.fillText(digit, 0, 0);

    // Subtext
    if (!isGo) {
      ctx.fillStyle  = 'rgba(255,255,255,0.45)';
      ctx.font       = `700 ${Math.round(H * 0.028)}px 'Orbitron', monospace`;
      ctx.fillText('GET READY', 0, Math.round(H * 0.14));
    }
    ctx.restore();
  }

  // ── Target panes: solo = single centred frame, MP = per-player panes ──
  const isMP = gs.players && gs.players.length > 1;

  function updateTargetPane(paneEl, playerChar, labelText, playerColor) {
    if (!paneEl) return;
    const tgt = (playerChar?._lockedTarget?.alive ? playerChar._lockedTarget : null)
               || (gs.enemies?.[0]?.alive ? gs.enemies[0] : null);
    if (!tgt || !tgt.alive) { paneEl.style.display = 'none'; return; }
    paneEl.style.display = 'block';
    paneEl.style.borderColor = playerColor ?? tgt.hero.color;

    // Show Flux badge only when both viewer and target are inside the Rift
    const bothInRift = playerChar?._inRift && tgt._inRift;
    const fluxTotal  = bothInRift ? Object.values(tgt._flux ?? {}).reduce((a, b) => a + b, 0) : 0;

    // Rebuild when target, label, or Rift/Flux state changes
    if (paneEl._lastHeroId !== tgt.hero.id || paneEl._lastLabel !== labelText || paneEl._lastFlux !== fluxTotal) {
      paneEl._lastHeroId = tgt.hero.id;
      paneEl._lastLabel  = labelText;
      paneEl._lastFlux   = fluxTotal;
      const fluxBadge = bothInRift
        ? `<div style="font-family:'Orbitron',monospace;font-size:9px;font-weight:700;
             color:${fluxTotal > 0 ? '#44ffcc' : '#334433'};letter-spacing:1px;margin-top:3px;text-align:center;">
             ⬡ ${fluxTotal > 0 ? fluxTotal + ' FLUX' : 'NO FLUX'}
           </div>`
        : '';
      paneEl.innerHTML = `
        <div class="tf-pane-header">
          <div class="tf-pane-label">${labelText}</div>
          <div class="tf-pane-name" style="color:${tgt.hero.color};">${tgt.hero.name}</div>
        </div>
        ${fluxBadge}
      `;
    }
  }

  if (isMP) {
    // Hide solo frame, show per-player panes
    const tf = gs._tfEl || document.getElementById('target-frame');
    if (tf) tf.style.display = 'none';
    const p1 = gs.players?.[0];
    const p2 = gs.players?.[1];
    const p3 = gs.players?.[2];
    const p4 = gs.players?.[3];
    const tfEls = gs._tfEls || ['tf-p1','tf-p2','tf-p3','tf-p4'].map(id => document.getElementById(id));
    updateTargetPane(tfEls[0], p1, 'P1 TARGET', 'rgba(255,238,68,0.5)');
    updateTargetPane(tfEls[1], p2, 'P2 TARGET', 'rgba(68,238,255,0.5)');
    if (p3) updateTargetPane(tfEls[2], p3, 'P3 TARGET', 'rgba(255,102,68,0.5)');
    if (p4) updateTargetPane(tfEls[3], p4, 'P4 TARGET', 'rgba(136,255,68,0.5)');
  } else {
    // Solo: hide the DOM target frame — target is shown on canvas directly
    const tf = gs._tfEl || document.getElementById('target-frame');
    if (tf) tf.style.display = 'none';
    const tfEls = gs._tfEls || ['tf-p1','tf-p2','tf-p3','tf-p4'].map(id => document.getElementById(id));
    tfEls.forEach(el => { if (el) el.style.display = 'none'; });
  }

  // Per-player mini HUD removed — character HP/mana bars are visible above each sprite on canvas

  // ── Flux wallet HUD — drawn above controller UI for each player ──
  {
    const FLUX_COLORS = { ember:'#ff6622', storm:'#aa88ff', frost:'#88eeff', void:'#9944cc', gale:'#ddcc44', tide:'#4488ff', wildcard:'#44ffcc' };
    const FLUX_ICONS  = { ember:'🔥', storm:'⚡', frost:'❄', void:'◉', gale:'🌪', tide:'💧', wildcard:'⬡' };
    const ctrlIds = ['controls', 'controls-p2', 'controls-p3', 'controls-p4'];
    const dpr = canvas._dpr || 1;
    const players = isMP ? (gs.players ?? []) : (gs.player ? [gs.player] : []);

    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      if (!p) continue;
      const fluxEntries = Object.entries(p._flux ?? {}).filter(([,v]) => v > 0);
      if (fluxEntries.length === 0) continue;

      // Anchor to controller element
      const ctrlEl = document.getElementById(ctrlIds[i]);
      if (!ctrlEl) continue;
      const rect = ctrlEl.getBoundingClientRect();
      if (rect.width === 0) continue;

      // Scale relative to controller width
      const ctrlW  = rect.width * dpr;
      const scale  = Math.min(1.0, ctrlW / (W * 0.5));
      const fs     = Math.max(8, Math.round(vpH * 0.013 * scale));
      const itemW  = fs * 3.6;
      const stripW = fluxEntries.length * itemW;
      const stripH = fs + 6;

      // Position: centered above the controller, just above the warp bar area
      const stripCX = (rect.left + rect.width / 2) * dpr;
      // Stack above warp bar — estimate warp bar height and position
      const warpBarH = Math.round(vpH * 0.016 * Math.min(2.25, ctrlW / (W * 0.16 * 1.33)));
      const stripY   = rect.top * dpr - warpBarH - fs * 2.8;
      if (stripY < 0) continue;

      ctx.save();

      // Subtle pill background
      ctx.globalAlpha = 0.72;
      ctx.fillStyle = 'rgba(0,8,16,0.85)';
      ctx.strokeStyle = 'rgba(68,255,204,0.25)';
      ctx.lineWidth = 1;
      const bgX = stripCX - stripW / 2 - 6;
      const bgW = stripW + 12;
      ctx.beginPath();
      ctx.roundRect(bgX, stripY - stripH / 2, bgW, stripH, stripH / 2);
      ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 1;

      // ⬡ FLUX label
      ctx.font = `700 ${Math.max(6, fs - 2)}px "Orbitron",monospace`;
      ctx.fillStyle = 'rgba(68,255,204,0.5)';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('FLUX', stripCX, stripY - stripH - 1);

      // Flux entries
      ctx.font = `700 ${fs}px "Orbitron",monospace`;
      ctx.textBaseline = 'middle';
      let fx = stripCX - stripW / 2;
      for (const [fType, fAmt] of fluxEntries) {
        const col = FLUX_COLORS[fType] ?? '#44ffcc';
        ctx.fillStyle = col;
        ctx.shadowColor = col; ctx.shadowBlur = 3;
        ctx.textAlign = 'left';
        ctx.fillText(FLUX_ICONS[fType] ?? '⬡', fx, stripY);
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(`×${fAmt}`, fx + fs * 1.15, stripY);
        fx += itemW;
      }

      ctx.restore();
    }
  }

  // ── Warp timer ──
  // Single player: bottom-center of screen (unchanged)
  // MP: one bar per player, centered in their column of the screen
  {
    const WARP_CD = 4.5;
    const now = performance.now() / 1000;

    const RETURN_WINDOW = 1.5;

    const drawWarpBar = (p, barCX, barBottomY, scale = 1) => {
      if (!p || !p.alive) return;
      const elapsed      = now - ((p._lastWarp) || 0);
      const onCooldown   = elapsed < WARP_CD;
      const inReturn     = (p._returnWindowTimer ?? 0) > 0;
      const nearEdge     = p.x < 280 || p.x > gs.W - 280 || p.y < 280 || p.y > gs.H - 280;
      if (!onCooldown && !nearEdge && !inReturn) return;

      const bh      = Math.round(vpH * 0.016 * scale);
      const bw      = Math.round(W * 0.16 * scale);
      const labelSz = Math.max(6, Math.round(vpH * 0.012 * scale));
      const bx      = barCX - bw / 2;
      const by      = barBottomY;

      ctx.font = `700 ${labelSz}px "Orbitron",monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.lineWidth = 2.5;

      if (inReturn) {
        // ── RETURN window — fast teal bar draining down ──
        const returnProgress = (p._returnWindowTimer ?? 0) / RETURN_WINDOW; // 1=just opened, 0=expired
        ctx.fillStyle  = 'rgba(68,255,204,0.90)';
        ctx.strokeStyle = 'rgba(0,80,60,0.7)';
        ctx.strokeText('RETURN', barCX, by - 3);
        ctx.fillText('RETURN', barCX, by - 3);

        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.beginPath(); roundRect(bx, by, bw, bh, bh / 2); ctx.fill();

        // Teal fill draining as window closes
        const pulse = 0.8 + 0.2 * Math.sin(now * 12);
        ctx.fillStyle = `rgba(68,255,204,${0.85 * pulse})`;
        ctx.beginPath(); roundRect(bx, by, Math.max(bh, bw * returnProgress), bh, bh / 2); ctx.fill();

        // Tick marks
        ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1;
        [0.25, 0.5, 0.75].forEach(t => {
          const tx = bx + bw * t;
          ctx.beginPath(); ctx.moveTo(tx, by + 2); ctx.lineTo(tx, by + bh - 2); ctx.stroke();
        });
      } else {
        // ── Normal CD bar — fills up orange to ready ──
        const progress = Math.min(1, elapsed / WARP_CD);
        ctx.fillStyle  = onCooldown ? 'rgba(255,120,80,0.85)' : 'rgba(80,220,255,0.7)';
        ctx.strokeStyle = onCooldown ? 'rgba(100,20,0,0.7)' : 'rgba(0,60,100,0.7)';
        ctx.strokeText('WARP', barCX, by - 3);
        ctx.fillText('WARP', barCX, by - 3);

        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.beginPath(); roundRect(bx, by, bw, bh, bh / 2); ctx.fill();

        const fillColor = onCooldown
          ? `rgba(255,${Math.round(120 + 80 * progress)},60,0.85)`
          : 'rgba(80,220,255,0.75)';
        ctx.fillStyle = fillColor;
        ctx.beginPath(); roundRect(bx, by, Math.max(bh, onCooldown ? bw * progress : bw), bh, bh / 2); ctx.fill();

        ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1;
        [0.25, 0.5, 0.75].forEach(t => {
          const tx = bx + bw * t;
          ctx.beginPath(); ctx.moveTo(tx, by + 2); ctx.lineTo(tx, by + bh - 2); ctx.stroke();
        });

        if (!onCooldown && elapsed < WARP_CD + 0.5) {
          const flashAlpha = Math.max(0, 1 - (elapsed - WARP_CD) / 0.5);
          ctx.font = `900 ${labelSz + 2}px "Orbitron",monospace`;
          ctx.fillStyle = `rgba(80,220,255,${flashAlpha})`;
          ctx.strokeStyle = 'rgba(0,80,120,0.7)'; ctx.lineWidth = 2.5;
          ctx.strokeText('READY', barCX, by - 3);
          ctx.fillText('READY', barCX, by - 3);
        }
      }
    };

    if (isMP) {
      const players = gs.players ?? [];
      const ctrlIds = ['controls', 'controls-p2', 'controls-p3', 'controls-p4'];
      const dpr = canvas._dpr || 1;
      for (let i = 0; i < players.length; i++) {
        const ctrlEl = document.getElementById(ctrlIds[i]);
        if (!ctrlEl) continue;
        const rect = ctrlEl.getBoundingClientRect();
        const barCX = (rect.left + rect.width / 2) * dpr;
        const barBy = rect.top * dpr - Math.round(6 * dpr);
        if (barBy < 0) continue;
        // Scale bar to fit controls element — 2.25× previous size
        const mpScale = Math.min(2.25, (rect.width * dpr) / (W * 0.16 * 1.33));
        drawWarpBar(players[i], barCX, barBy, mpScale);
      }
    } else {
      // Single player — original size (scale = 1)
      const p = gs.player;
      const elapsed = now - ((p?._lastWarp) || 0);
      const onCooldown = elapsed < WARP_CD;
      const nearEdge = p && p.alive && (p.x < 280 || p.x > gs.W - 280 || p.y < 280 || p.y > gs.H - 280);
      if (p && p.alive && (onCooldown || nearEdge)) {
        drawWarpBar(p, cx, H - pad - Math.round(vpH * 0.016) - Math.round(H * 0.01), 1);
      }
    }
  }

  // ── Match timer — pinned to top of window, y-cursor stacks sub-items cleanly ──
  if (!gs.isTutorial) {
    const isUnlimitedTime = !isFinite(MATCH_DURATION);
    const remaining = isUnlimitedTime ? Infinity : Math.max(0, MATCH_DURATION - gs.time);
    const timerStr = isUnlimitedTime
      ? `${String(Math.floor(gs.time / 60)).padStart(2, '0')}:${String(Math.floor(gs.time % 60)).padStart(2, '0')}`
      : `${Math.floor(remaining / 60)}:${String(Math.floor(remaining % 60)).padStart(2, '0')}`;
    const urgent = !isUnlimitedTime && remaining <= 30;
    const timerSize = Math.max(11, Math.round(vpH * 0.022));

    // ── All items pinned to top of canvas window, stacking downward ──
    const PAD_TOP = 8;
    let subY = PAD_TOP;

    // ── Timer — top-most item ──
    ctx.font = `900 ${timerSize}px "Orbitron",monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    if (urgent) {
      const pulse = 0.6 + 0.4 * Math.abs(Math.sin(gs.time * 6));
      ctx.fillStyle = `rgba(255,80,60,${pulse})`;
      ctx.strokeStyle = 'rgba(180,0,0,0.7)'; ctx.lineWidth = 3;
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 3;
    }
    ctx.strokeText(timerStr, cx, subY);
    ctx.fillText(timerStr, cx, subY);
    subY += timerSize + 4;

    // ── Team score pills — below timer ──
    if (gs.maxKills < 999 && gs.teamIds?.length > 0) {
      const scoreSize = Math.max(9, Math.round(vpH * 0.016));
      const pillW = scoreSize * 2.4, pillH = scoreSize * 1.5, pillGap = 6;
      ctx.font = `900 ${scoreSize}px "Orbitron",monospace`;
      ctx.textBaseline = 'top';
      const totalW = gs.teamIds.length * pillW + (gs.teamIds.length - 1) * pillGap;
      let sx = cx - totalW / 2;
      for (const tid of gs.teamIds) {
        const tc = TEAM_COLORS[tid] || TEAM_COLORS[0];
        const kills = gs.teamKills[tid] ?? 0;
        const isLeading = kills === Math.max(...Object.values(gs.teamKills));
        ctx.globalAlpha = isLeading ? 0.5 : 0.3;
        ctx.fillStyle = tc.color;
        ctx.beginPath(); ctx.roundRect(sx, subY, pillW, pillH, 4); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.textAlign = 'center';
        ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 2.5;
        ctx.fillStyle = isLeading ? '#ffffff' : tc.color;
        ctx.strokeText(kills, sx + pillW / 2, subY + 2);
        ctx.fillText(kills, sx + pillW / 2, subY + 2);
        sx += pillW + pillGap;
      }
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.globalAlpha = 1;
      subY += pillH + 5;
    }

    // ── Unlimited ∞ ──
    if (isUnlimitedTime) {
      const infSize = Math.max(8, Math.round(vpH * 0.013));
      ctx.font = `700 ${infSize}px "Orbitron",monospace`;
      ctx.textBaseline = 'top'; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2;
      ctx.strokeText('∞', cx, subY); ctx.fillText('∞', cx, subY);
      ctx.textBaseline = 'alphabetic';
      subY += infSize + 4;
    }

    // ── Maelstrom cooldown ──
    if (gs._lastMaelstromTime !== undefined) {
      const cdRemaining = Math.max(0, 90 - (gs.time - gs._lastMaelstromTime));
      const mSize = Math.max(8, Math.round(vpH * 0.012));
      ctx.font = `700 ${mSize}px "Orbitron",monospace`;
      ctx.textBaseline = 'top'; ctx.textAlign = 'center';
      if (cdRemaining > 0) {
        ctx.fillStyle = 'rgba(180,180,255,0.55)';
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2;
        ctx.strokeText(`🌀 ${Math.ceil(cdRemaining)}s`, cx, subY);
        ctx.fillText(`🌀 ${Math.ceil(cdRemaining)}s`, cx, subY);
      } else {
        const pulse = 0.5 + 0.5 * Math.abs(Math.sin(gs.time * 3));
        ctx.fillStyle = `rgba(255,255,255,${pulse * 0.8})`;
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2;
        ctx.strokeText('🌀 READY', cx, subY); ctx.fillText('🌀 READY', cx, subY);
      }
      ctx.textBaseline = 'alphabetic';
      subY += mSize + 4;
    }

    // ── Sudden death ──
    if (gs.suddenDeath) {
      const sdSize = Math.max(9, Math.round(vpH * 0.015));
      const pulse = 0.7 + 0.3 * Math.abs(Math.sin(gs.time * 4));
      ctx.font = `900 ${sdSize}px "Orbitron",monospace`;
      ctx.textBaseline = 'top'; ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(255,220,0,${pulse})`;
      ctx.strokeStyle = 'rgba(120,60,0,0.8)'; ctx.lineWidth = 2.5;
      ctx.strokeText('⚡ SUDDEN DEATH ⚡', cx, subY);
      ctx.fillText('⚡ SUDDEN DEATH ⚡', cx, subY);
      ctx.textBaseline = 'alphabetic';
    }
  }

  // ── Zone entry screen flash ───────────────────────────────────────────────
  if (window._zoneEntryFlash && window._zoneEntryFlash.t > 0) {
    const fl = window._zoneEntryFlash;
    const dt_fl = 0.016; // ~60fps decay
    fl.t = Math.max(0, fl.t - dt_fl * 2.5);
    const flashA = fl.alpha * (fl.t / 0.55);
    if (flashA > 0.005) {
      const rgb = hexToRgb(fl.color);
      // Vignette-style edge flash — inner transparent, edge colored
      const grad = ctx.createRadialGradient(cx, offsetY + vpH/2, vpH * 0.25, cx, offsetY + vpH/2, vpH * 0.72);
      grad.addColorStop(0, `rgba(${rgb},0)`);
      grad.addColorStop(1, `rgba(${rgb},${flashA.toFixed(3)})`);
      ctx.fillStyle = grad;
      ctx.fillRect(offsetX, offsetY, vpW, vpH);
    }
    if (fl.t <= 0) window._zoneEntryFlash = null;
  }

  // ── Debug overlay (only when ?debug in URL) ──
  if (window._debugMode) drawDebugOverlay(gs);

  ctx.restore();
}
function hexToRgb(hex) {
  const c = hex.replace('#','');
  const n = parseInt(c.length===3 ? c[0]+c[0]+c[1]+c[1]+c[2]+c[2] : c, 16);
  return `${(n>>16)&255},${(n>>8)&255},${n&255}`;
}
function hexWithAlpha(hex, alpha) {
  try {
    const c = hex.replace('#','');
    const n = parseInt(c.length===3 ? c[0]+c[0]+c[1]+c[1]+c[2]+c[2] : c, 16);
    return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${alpha})`;
  } catch { return `rgba(255,255,255,${alpha})`; }
}

function roundRect(x, y, w, h, r) {
  r = Math.min(r, w/2, h/2);
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w, y, x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x, y+h, r);
  ctx.arcTo(x, y+h, x, y, r);
  ctx.arcTo(x, y, x+w, y, r);
  ctx.closePath();
}

function updateHUDNames() { /* now drawn on canvas — no-op */ }
function updateHUD(gs) { /* now drawn on canvas via drawHUD — no-op */ }

function updateAbilityIcons() {
  const h = (gameState && gameState.player) ? gameState.player.hero : selectedHero;
  const slotLabels = ['Strong Ability', 'CC Ability', 'Ultimate'];
  const keys = ['q','e','r'];
  h.abilities.forEach((ab, i) => {
    const k = keys[i];
    const nameEl = document.getElementById(`ab-name-${k}`);
    const descEl = document.getElementById(`ab-desc-${k}`);
    if (nameEl) nameEl.textContent = ab.name;
    if (descEl) descEl.textContent = slotLabels[i];
    // Gamepad desc panel — uses actual ability description
    const gpDescEl = document.getElementById(`gp-desc-${k}`);
    if (gpDescEl) gpDescEl.textContent = ab.desc || slotLabels[i];
  });
  // Special ability desc
  const gpSpecialEl = document.getElementById('gp-desc-special');
  if (gpSpecialEl) {
    const cls = h.combatClass;
    const SPECIAL_DESCS = { melee: 'AOE ground-pound, stuns nearby', hybrid: 'Dash + slow first target', ranged: 'Long-range charged shot' };
    gpSpecialEl.textContent = SPECIAL_DESCS[cls] || 'Special ability';
  }
}

// ── Match timer expiry ────────────────────────────────────────────────────
function handleTimeUp(gs) {
  // Find team with most kills
  let topKills = -1, topTeam = null, tied = false;
  for (const [tid, k] of Object.entries(gs.teamKills)) {
    if (k > topKills) { topKills = k; topTeam = Number(tid); tied = false; }
    else if (k === topKills) { tied = true; }
  }

  if (!tied && topTeam !== null) {
    endGame(gs, topTeam);
    return;
  }

  // Tied — sudden death
  // (notification rendered persistently in drawHUD, not as float text)

  // Eliminate anyone on teams below the tie kill count
  const allChars = [...(gs.players ?? [gs.player]), ...gs.enemies];
  allChars.forEach(c => {
    const teamK = gs.teamKills[c.teamId] || 0;
    if (teamK < topKills) {
      c.alive = false;
      c.respawnTimer = 9999;
      showFloatText(c.x, c.y - 40, 'ELIMINATED', '#ff4444');
      gs.effects.push({x:c.x, y:c.y, r:0, maxR:80, life:0.6, maxLife:0.6, color:'#ff4444'});
    }
  });

  gs.suddenDeath = true;
  Audio.sfx.suddenDeath();
  gs.maxKills = topKills + 1;
}

// ========== GAME OVER ==========
// Returns winning teamId if a team has reached maxKills, else null
function checkWinCondition(gs) {
  if (gs.maxKills >= 999) return null; // unlimited kills — no kill-limit win
  for (const [teamId, kills] of Object.entries(gs.teamKills)) {
    if (kills >= gs.maxKills) return Number(teamId);
  }
  return null;
}

function endGame(gs, winningTeam) {
  if (gs.isTutorial) return; // tutorial never ends via kill limit
  gs.over = true;
  gs.winner = winningTeam;
  cancelAnimationFrame(animFrame);
  animFrame = null;
  // Always dismiss pause overlay so it doesn't bleed into the win screen
  const po = document.getElementById('pause-overlay');
  if (po) po.style.display = 'none';
  const tf = document.getElementById('target-frame');
  if (tf) tf.style.display = 'none';
  ['tf-p1','tf-p2','tf-p3','tf-p4'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });

  // ── Game Over sequence ──
  const canvas   = document.getElementById('game-canvas');
  const overlay  = document.getElementById('game-over-overlay');
  const isMP     = gs.players && gs.players.length > 1;
  const playerWon = !isMP && (gs.player?.teamId ?? 0) === winningTeam;
  const tc = TEAM_COLORS[winningTeam] || TEAM_COLORS[0];

  // Build title + subtitle text
  let titleText = 'GAME OVER';
  let subText   = '';
  let titleColor = '#ffffff';
  if (isMP) {
    const winningHumans = gs.players.filter(p => p.teamId === winningTeam);
    if (winningHumans.length > 0) {
      const labels = winningHumans.map(p => `P${(p._playerIdx ?? 0) + 1}`).join(' + ');
      titleText = `${labels} WINS`;
      titleColor = PLAYER_COLORS[winningHumans[0]._playerIdx ?? 0] ?? '#ffee44';
    } else {
      const winChar = [...(gs.players ?? []), ...gs.enemies].find(c => c?.teamId === winningTeam);
      titleText = `${winChar?.hero?.name ?? 'CPU'} WINS`;
      titleColor = winChar?.hero?.color ?? '#ff4444';
    }
  } else {
    titleText  = playerWon ? 'VICTORY' : 'DEFEAT';
    titleColor = playerWon ? '#00d4ff' : '#ff4444';
    const winKills = gs.teamKills[winningTeam] || 0;
    const isFFA = gs.teamIds && gs.teamIds.length > 2;
    if (isFFA) {
      const winChar = [...(gs.players ?? [gs.player]), ...gs.enemies].find(c => c?.teamId === winningTeam);
      subText = `${winChar?.hero?.name ?? tc.name} wins with ${winKills} kills`;
    } else {
      subText = playerWon ? `Your team wins with ${winKills} kills` : `${tc.name} team wins`;
    }
  }

  if (overlay) {
    overlay.innerHTML = `
      <div class="go-title" style="color:${titleColor}">${titleText}</div>
      ${subText ? `<div class="go-sub" style="color:rgba(255,255,255,0.6)">${subText}</div>` : ''}
    `;
    overlay.classList.add('active');
  }

  // Greyscale the canvas
  if (canvas) canvas.classList.add('game-over-canvas-anim');

  // After 3.2s fade overlay out then show win screen
  setTimeout(() => {
    if (overlay) {
      overlay.classList.add('go-fadeout');
    }
    setTimeout(() => {
      if (overlay) { overlay.classList.remove('active','go-fadeout'); overlay.innerHTML = ''; }
      if (canvas)  { canvas.classList.remove('game-over-canvas-anim'); canvas.style.filter = ''; }
      _buildWinScreen(gs, winningTeam);
    }, 620);
  }, 3200);
}

function _buildWinScreen(gs, winningTeam) {
  setTimeout(()=>{
    try {
    const isMP = gs.players && gs.players.length > 1;
    const tc = TEAM_COLORS[winningTeam] || TEAM_COLORS[0];
    const winKills = gs.teamKills[winningTeam] || 0;
    const isFFA = gs.teamIds && gs.teamIds.length > 2;
    const allMatchChars = [...new Set([...(gs.players ?? [gs.player]), ...gs.enemies])].filter(c => c);
    const titleEl = document.getElementById('win-title');
    const subEl   = document.getElementById('win-sub');

    if (isMP) {
      const winningHumans = gs.players.filter(p => p.teamId === winningTeam);
      const losingHumans  = gs.players.filter(p => p.teamId !== winningTeam);
      const bannerEl = document.getElementById('win-winner-banner');
      if (winningHumans.length > 0) {
        const labels = winningHumans.map(p => {
          const color = PLAYER_COLORS[p._playerIdx ?? 0] ?? '#ffee44';
          return `<span style="color:${color}">P${(p._playerIdx ?? 0) + 1}</span>`;
        }).join(' + ');
        titleEl.innerHTML = `${labels} WINS!`;
        titleEl.style.color = '';
        subEl.textContent = `${winningHumans.map(p => p.hero.name).join(' & ')} — ${winKills} kills.`;
        // Winner banner — colored by first winner's player color
        if (bannerEl) {
          const winColor = PLAYER_COLORS[winningHumans[0]._playerIdx ?? 0] ?? '#ffee44';
          bannerEl.style.display = 'block';
          bannerEl.style.borderColor = winColor;
          bannerEl.style.color = winColor;
          bannerEl.style.background = `${winColor}18`;
          bannerEl.innerHTML = `${winningHumans.map(p => {
            const c = PLAYER_COLORS[p._playerIdx ?? 0] ?? '#ffee44';
            return `<span style="color:${c}">P${(p._playerIdx ?? 0) + 1} ${p.hero.name}</span>`;
          }).join(' <span style="opacity:0.4">+</span> ')} &nbsp;·&nbsp; ${winKills} KILLS`;
        }
      } else {
        const winChar = allMatchChars.find(c => c.teamId === winningTeam);
        titleEl.textContent = `${winChar?.hero?.name ?? 'CPU'} WINS!`;
        titleEl.style.color = winChar?.hero?.color ?? '#ff4444';
        const losingLabels = losingHumans.map(p => `P${(p._playerIdx ?? 0) + 1}`).join(' & ');
        subEl.textContent = `${losingLabels || 'You'} ${losingHumans.length > 1 ? 'were' : 'was'} eliminated!`;
        if (bannerEl) bannerEl.style.display = 'none';
      }
    } else {
      const playerTeam = gs.player?.teamId ?? 0;
      const playerWon  = winningTeam === playerTeam;
      titleEl.textContent = playerWon ? 'VICTORY' : 'DEFEAT';
      titleEl.style.color = playerWon ? 'var(--accent)' : '#ff4444';
      if (isFFA) {
        const winChar = allMatchChars.find(c => c.teamId === winningTeam);
        const name = winChar?.hero?.name ?? tc.name;
        subEl.textContent = playerWon
          ? `${name} — ${winKills} kills. No contest.`
          : `${name} wins with ${winKills} kills.`;
      } else {
        subEl.textContent = playerWon
          ? `${winKills} kills. Well fought.`
          : `${tc.name} team wins with ${winKills} kills.`;
      }
    }

    // Stat boxes: solo only (MP uses scoreboard)
    const statsEl = document.querySelector('.win-stats');
    if (statsEl) statsEl.style.display = isMP ? 'none' : '';
    // Winner banner: MP only
    const winBanner = document.getElementById('win-winner-banner');
    if (winBanner && !isMP) winBanner.style.display = 'none';
    if (!isMP) {
      const p = gs.player;
      document.getElementById('ws-kills').textContent   = p?.kills || 0;
      document.getElementById('ws-assists').textContent = p?.assists || 0;
      document.getElementById('ws-deaths').textContent  = gs.playerDeaths || 0;
    }
    const mm=String(Math.floor(gs.time/60)).padStart(2,'0');
    const ss=String(Math.floor(gs.time%60)).padStart(2,'0');
    document.getElementById('ws-time').textContent = `${mm}:${ss}`;

    // Build full scoreboard
    const allChars = allMatchChars.sort((a, b) => {
      const aScore = (a.kills||0)*3 + (a.assists||0) - (a.deaths||0);
      const bScore = (b.kills||0)*3 + (b.assists||0) - (b.deaths||0);
      return bScore - aScore;
    });
    const wrap = document.getElementById('win-scoreboard-wrap');
    if (wrap) {
      // Only show Maelstrom column if anyone died to it this match
      const showMaelstromCol = (gs._maelstromKillCount || 0) > 0;
      const rows = allChars.filter(c => c?.hero).map(c => {
        const k = c.kills || 0, a = c.assists || 0, d = c.deaths || 0;
        const kda = d > 0 ? ((k + a * 0.5) / d).toFixed(1) : (k + a * 0.5).toFixed(1);
        const teamCol = TEAM_COLORS[c.teamId ?? 0]?.color || '#fff';
        const teamName = TEAM_COLORS[c.teamId ?? 0]?.name || '';
        const typeTag = c.hero?.combatClass ? c.hero.combatClass.toUpperCase() : '';
        const heroColor = c.hero?.color || '#fff';
        const heroName = c.hero?.name || '?';
        let playerTag = '';
        if (c.isPlayer) {
          if (isMP && (c._playerIdx ?? -1) >= 0) {
            const pColor = PLAYER_COLORS[c._playerIdx] ?? '#ffee44';
            playerTag = ` <span style="color:${pColor};font-size:0.75em">P${c._playerIdx + 1}</span>`;
          } else if (!isMP) {
            playerTag = ` <span style="color:var(--accent);font-size:0.75em">YOU</span>`;
          }
        }
        return `<tr class="${c.isPlayer ? 'is-player' : ''}">
          <td><div class="wsb-hero">
            <div class="wsb-dot" style="background:${heroColor}"></div>
            <div>
              <div class="wsb-name" style="color:${heroColor}">${heroName}${playerTag}</div>
              <div class="wsb-type">${typeTag}</div>
            </div>
          </div></td>
          <td style="color:${teamCol};font-weight:700;font-size:0.8em;letter-spacing:1px;white-space:nowrap;vertical-align:middle">${teamName}</td>
          <td class="wsb-kills">${k}</td>
          <td class="wsb-assists">${a}</td>
          <td class="wsb-deaths">${d}</td>
          <td class="wsb-kda">${kda}</td>
          ${showMaelstromCol ? `<td style="color:${(c.maelstromDeaths||0)>0?'#ffffff':'rgba(255,255,255,0.2)'};text-align:center">${(c.maelstromDeaths||0)>0?'☄ '+c.maelstromDeaths:'—'}</td>` : ''}
        </tr>`;
      }).join('');
      wrap.innerHTML = `<table class="win-scoreboard">
        <thead><tr>
          <th>HERO</th>
          <th>TEAM</th>
          <th>KILLS</th>
          <th>ASSISTS</th>
          <th>DEATHS</th>
          <th>KDA</th>
          ${showMaelstromCol ? '<th style="color:#ffffff;opacity:0.7">☄</th>' : ''}
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    }

    // ── Win screen celebration burst ──────────────────────────────────────
    const _winnerColor = (() => {
      if (isMP) {
        const wh = gs.players?.find(p => p.teamId === winningTeam);
        return wh ? (PLAYER_COLORS[wh._playerIdx ?? 0] ?? '#ffee44') : '#ffee44';
      }
      const pw = gs.player?.teamId === winningTeam;
      return pw ? '#00d4ff' : '#ff4444';
    })();
    setTimeout(() => {
      const cvs = document.getElementById('game-canvas');
      if (!cvs) return;
      const W = cvs.offsetWidth, H = cvs.offsetHeight;
      const overlay = document.createElement('canvas');
      overlay.style.cssText = `position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:98;`;
      overlay.width  = W * (window.devicePixelRatio || 1);
      overlay.height = H * (window.devicePixelRatio || 1);
      document.getElementById('game')?.appendChild(overlay);
      const octx = overlay.getContext('2d');
      const dpr  = window.devicePixelRatio || 1;
      octx.scale(dpr, dpr);
      const secondaryColors = ['#ffee44','#ff44aa','#44ffcc','#ff6644','#88ff44','#ffffff'];
      const particles = Array.from({length: 55}, (_, i) => ({
        x: W * (0.3 + Math.random() * 0.4),
        y: H * 0.55,
        vx: (Math.random() - 0.5) * 14,
        vy: -(5 + Math.random() * 12),
        r: 3 + Math.random() * 5,
        color: i < 20 ? _winnerColor : secondaryColors[i % secondaryColors.length],
        life: 1, decay: 0.018 + Math.random() * 0.012,
        gravity: 0.28,
      }));
      let raf;
      function tick() {
        octx.clearRect(0, 0, W, H);
        let any = false;
        for (const p of particles) {
          if (p.life <= 0) continue;
          any = true;
          p.x  += p.vx; p.y += p.vy; p.vy += p.gravity;
          p.vx *= 0.985; p.life -= p.decay;
          octx.globalAlpha = Math.max(0, p.life);
          octx.fillStyle = p.color;
          octx.beginPath();
          octx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          octx.fill();
        }
        octx.globalAlpha = 1;
        if (any) { raf = requestAnimationFrame(tick); }
        else { overlay.remove(); }
      }
      raf = requestAnimationFrame(tick);
      // Safety cleanup after 4s
      setTimeout(() => { cancelAnimationFrame(raf); overlay.remove(); }, 4000);
    }, 80);

    showScreen('win-screen');
    } catch(err) {
      console.error('[endGame] win screen build error:', err, err?.stack);
      try { showScreen('win-screen'); } catch(_) {
        try { showScreen('menu'); } catch(__) {}
      }
    }
  }, 0);
}


// ── Rift pocket arena background ─────────────────────────────────────────
// Called instead of drawArena() when local player is in the pocket dimension.
// Renders at the pocket's world coordinates with a unique void aesthetic.
function drawRiftArena() {
  const t = performance.now() / 1000;
  // Full pocket — used for background fill and grid
  const X = RIFT_POCKET_X, Y = RIFT_POCKET_Y;
  const W = RIFT_POCKET_W, H = RIFT_POCKET_H;
  // Play area — used for boundaries, crystal orbits, beam, crafting point
  const PX = RIFT_PLAY_X, PY = RIFT_PLAY_Y;
  const PW = RIFT_PLAY_W, PH = RIFT_PLAY_H;
  const cx = RIFT_CRAFT_X, cy = RIFT_CRAFT_Y;

  // Deep void background — fill generously beyond pocket bounds so no black edge shows
  ctx.fillStyle = '#03050f';
  ctx.fillRect(X - 200, Y - 200, W + 400, H + 400);

  // Animated teal grid — covers full pocket background
  ctx.save();
  ctx.strokeStyle = 'rgba(0,210,150,0.07)';
  ctx.lineWidth = 1;
  const gridSize = 60;
  for (let gx = X; gx <= X + W; gx += gridSize) {
    ctx.beginPath(); ctx.moveTo(gx, Y); ctx.lineTo(gx, Y + H); ctx.stroke();
  }
  for (let gy = Y; gy <= Y + H; gy += gridSize) {
    ctx.beginPath(); ctx.moveTo(X, gy); ctx.lineTo(X + W, gy); ctx.stroke();
  }
  ctx.restore();

  // Dark vignette outside play area — darkens the border region
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  // Top strip
  ctx.fillRect(X, Y, W, PY - Y);
  // Bottom strip
  ctx.fillRect(X, PY + PH, W, (Y + H) - (PY + PH));
  // Left strip
  ctx.fillRect(X, PY, PX - X, PH);
  // Right strip
  ctx.fillRect(PX + PW, PY, (X + W) - (PX + PW), PH);
  ctx.restore();

  // Floating crystal shards — orbiting the craft point, scaled to play area
  ctx.save();
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2 + t * 0.22;
    const orR   = Math.min(PW, PH) * 0.28 + Math.sin(t * 1.1 + i * 0.9) * 12;
    const sx    = cx + Math.cos(angle) * orR;
    const sy    = cy + Math.sin(angle) * orR;
    const sz    = 6 + Math.sin(t * 2 + i) * 2;
    ctx.globalAlpha = 0.35 + 0.25 * Math.sin(t * 1.8 + i * 1.3);
    ctx.fillStyle = i % 2 === 0 ? '#44ffcc' : '#8844ff';
    ctx.save();
    ctx.translate(sx, sy); ctx.rotate(t * 0.6 + i * 0.8);
    ctx.beginPath();
    ctx.moveTo(0, -sz); ctx.lineTo(sz * 0.5, 0);
    ctx.lineTo(0, sz);  ctx.lineTo(-sz * 0.5, 0);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  // Outer slow-drifting larger shards
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2 + t * 0.08;
    const orR   = Math.min(PW, PH) * 0.44 + Math.sin(t * 0.7 + i * 1.4) * 16;
    const sx    = cx + Math.cos(angle) * orR;
    const sy    = cy + Math.sin(angle) * orR;
    const sz    = 9 + Math.sin(t * 1.2 + i) * 3;
    ctx.globalAlpha = 0.18 + 0.10 * Math.sin(t + i);
    ctx.fillStyle = '#33bbff';
    ctx.save();
    ctx.translate(sx, sy); ctx.rotate(t * 0.3 + i * 1.2);
    ctx.beginPath();
    ctx.moveTo(0, -sz); ctx.lineTo(sz * 0.4, 0);
    ctx.lineTo(0, sz);  ctx.lineTo(-sz * 0.4, 0);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // Central energy column — vertical beam scoped to play area
  ctx.save();
  const beamAlpha = 0.12 + 0.06 * Math.sin(t * 3);
  const beamGrad = ctx.createLinearGradient(cx, PY, cx, PY + PH);
  beamGrad.addColorStop(0,   'rgba(0,0,0,0)');
  beamGrad.addColorStop(0.3, `rgba(68,255,204,${beamAlpha})`);
  beamGrad.addColorStop(0.5, `rgba(68,255,204,${beamAlpha * 1.5})`);
  beamGrad.addColorStop(0.7, `rgba(68,255,204,${beamAlpha})`);
  beamGrad.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.fillStyle = beamGrad;
  ctx.fillRect(cx - 18, PY, 36, PH);
  ctx.restore();

  // Crafting point
  const craftPulse = 0.6 + 0.4 * Math.sin(t * 3.5);
  ctx.save();
  ctx.globalAlpha = craftPulse * 0.22;
  ctx.fillStyle = '#44ffcc';
  ctx.beginPath(); ctx.arc(cx, cy, RIFT_CRAFT_R * 2.0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = craftPulse * 0.40;
  ctx.beginPath(); ctx.arc(cx, cy, RIFT_CRAFT_R * 1.3, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = craftPulse * 0.5;
  ctx.fillStyle = '#001a10';
  ctx.beginPath(); ctx.arc(cx, cy, RIFT_CRAFT_R, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = craftPulse;
  ctx.strokeStyle = '#44ffcc'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(cx, cy, RIFT_CRAFT_R, 0, Math.PI * 2); ctx.stroke();
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(t * 0.9);
  ctx.strokeStyle = 'rgba(68,255,204,0.55)'; ctx.lineWidth = 1.5;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * RIFT_CRAFT_R * 0.80, Math.sin(a) * RIFT_CRAFT_R * 0.80);
    ctx.lineTo(Math.cos(a) * RIFT_CRAFT_R * 0.62, Math.sin(a) * RIFT_CRAFT_R * 0.62);
    ctx.stroke();
  }
  ctx.restore();
  ctx.globalAlpha = craftPulse * 0.9;
  ctx.fillStyle = '#44ffcc';
  ctx.font = `700 ${Math.max(10, RIFT_CRAFT_R * 0.40)}px "Orbitron",monospace`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('CRAFT', cx, cy);
  ctx.globalAlpha = 1;
  ctx.restore();

  // Exit portal — bottom-right corner of play area
  {
    const exitX = RIFT_PLAY_X + RIFT_PLAY_W - RIFT_EXIT_R - 10;
    const exitY = RIFT_PLAY_Y + RIFT_PLAY_H - RIFT_EXIT_R - 10;
    const exitPulse = 0.6 + 0.4 * Math.sin(t * 2.8);
    ctx.save();
    // Outer glow
    ctx.globalAlpha = exitPulse * 0.20;
    ctx.fillStyle = '#ffcc44';
    ctx.beginPath(); ctx.arc(exitX, exitY, RIFT_EXIT_R * 1.8, 0, Math.PI * 2); ctx.fill();
    // Disc
    ctx.globalAlpha = exitPulse * 0.45;
    ctx.fillStyle = '#1a1000';
    ctx.beginPath(); ctx.arc(exitX, exitY, RIFT_EXIT_R, 0, Math.PI * 2); ctx.fill();
    // Border — yellow/amber to distinguish from craft point
    ctx.globalAlpha = exitPulse;
    ctx.strokeStyle = '#ffcc44';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(exitX, exitY, RIFT_EXIT_R, 0, Math.PI * 2); ctx.stroke();
    // Rotating dashes
    ctx.save();
    ctx.translate(exitX, exitY); ctx.rotate(-t * 1.1);
    ctx.strokeStyle = 'rgba(255,200,68,0.5)'; ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 8]);
    ctx.beginPath(); ctx.arc(0, 0, RIFT_EXIT_R * 0.72, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    // Label
    ctx.globalAlpha = exitPulse * 0.9;
    ctx.fillStyle = '#ffcc44';
    ctx.font = `700 ${Math.max(8, RIFT_EXIT_R * 0.32)}px "Orbitron",monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('EXIT', exitX, exitY);
    ctx.restore();
  }

  // Play area boundary walls — drawn at RIFT_PLAY_X/Y bounds, clearly visible
  ctx.save();
  const borderPulse = 0.5 + 0.3 * Math.sin(t * 1.2);
  // Solid bright border
  ctx.strokeStyle = `rgba(68,255,204,${borderPulse})`;
  ctx.lineWidth = 3;
  ctx.strokeRect(PX + 1, PY + 1, PW - 2, PH - 2);
  // Soft inner glow band
  ctx.strokeStyle = `rgba(0,200,140,0.18)`;
  ctx.lineWidth = 14;
  ctx.strokeRect(PX + 7, PY + 7, PW - 14, PH - 14);
  // Corner accents
  const corner = 32;
  ctx.strokeStyle = `rgba(68,255,204,${Math.min(1, borderPulse * 1.5)})`;
  ctx.lineWidth = 2.5;
  const corners = [[PX, PY], [PX + PW, PY], [PX, PY + PH], [PX + PW, PY + PH]];
  const dirs    = [[1,1],    [-1,1],          [1,-1],         [-1,-1]];
  for (let i = 0; i < 4; i++) {
    const [bx, by] = corners[i];
    const [dx, dy] = dirs[i];
    ctx.beginPath();
    ctx.moveTo(bx + dx * corner, by);
    ctx.lineTo(bx, by);
    ctx.lineTo(bx, by + dy * corner);
    ctx.stroke();
  }
  ctx.restore();
}

// ── Rift world-space overlays (crafting progress arc, drawn above characters) ──
function drawRiftWorldOverlays(gs) {
  if (!gs._riftChars || gs._riftChars.length === 0) return;
  const t = performance.now() / 1000;
  const localPlayer = gs.players?.[0];
  if (!localPlayer?._inRift) return;

  // Crafting progress arc
  if ((localPlayer._craftTimer ?? 0) > 0 && localPlayer._craftTarget) {
    const prog = Math.min(1, localPlayer._craftTimer / RIFT_CRAFT_TIME);
    ctx.save();
    ctx.strokeStyle = localPlayer._craftTarget.color ?? '#44ffcc';
    ctx.lineWidth = 6;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(RIFT_CRAFT_X, RIFT_CRAFT_Y,
      RIFT_CRAFT_R + 12, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

// ── Rift HUD overlays — screen-space, drawn after world transform ─────────
function drawRiftHUD(gs) {
  if (!gs._riftChars?.some(c => c.isPlayer)) {
    gs._riftPanelHitAreas = [];
    return;
  }
  const baseScale = canvas._worldScale || 1;
  const offsetX   = canvas._worldOffsetX || 0;
  const offsetY   = canvas._worldOffsetY || 0;
  const t   = performance.now() / 1000;
  const isSplit = gs._splitScreen ?? false;
  const panes   = getSplitPanes(gs);

  // Clear hit areas — will be rebuilt per-player below
  gs._riftPanelHitAreas = [];

  for (const pane of panes) {
    const p = (gs.players ?? [])[pane.playerIdx];
    if (!p?._inRift) continue;

    // Pane bounds in screen pixels
    const px = offsetX + Math.round(pane.x * baseScale);
    const py = offsetY + Math.round(pane.y * baseScale);
    const pw = Math.round(pane.w * baseScale);
    const ph = Math.round(pane.h * baseScale);

    ctx.save();
    ctx.beginPath(); ctx.rect(px, py, pw, ph); ctx.clip();

    // RIFT header — top center of this pane
    const hdrPulse = 0.8 + 0.2 * Math.sin(t * 2);
    ctx.font = `900 ${Math.max(10, ph * 0.026)}px "Orbitron",monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = 3;
    ctx.fillStyle = `rgba(68,255,204,${hdrPulse})`;
    const hdrX = px + pw / 2;
    const hdrY = py + ph * 0.022;
    ctx.strokeText('⬡ CONVERGENCE RIFT', hdrX, hdrY);
    ctx.fillText('⬡ CONVERGENCE RIFT', hdrX, hdrY);

    if (gs.riftPortal) {
      const secsLeft = Math.ceil(gs.riftPortal.life);
      ctx.font = `700 ${Math.max(8, ph * 0.016)}px "Orbitron",monospace`;
      ctx.fillStyle = secsLeft <= 5 ? '#ff6644' : 'rgba(180,255,220,0.7)';
      ctx.strokeText(`CLOSES IN ${secsLeft}s`, hdrX, hdrY + ph * 0.036);
      ctx.fillText(`CLOSES IN ${secsLeft}s`, hdrX, hdrY + ph * 0.036);
    }

    if (p._craftPanelOpen) {
      _drawRiftCraftingPanel(gs, p, px, py, pw, ph, t);
    } else if (p._onCraftPoint) {
      _drawCraftPrompt(px, py, pw, ph, t);
    }

    ctx.restore();
  }
}

function _drawCraftPrompt(offsetX, offsetY, vpW, vpH, t) {
  const pulse = 0.7 + 0.3 * Math.sin(t * 3);
  const bindLabel = typeof getBindLabel !== 'undefined' ? getBindLabel('craft') : 'C';
  const label = `[${bindLabel}] OPEN FORGE`;
  const fs   = Math.max(10, vpH * 0.018);
  ctx.save();
  ctx.font = `700 ${fs}px "Orbitron",monospace`;
  const tw   = ctx.measureText(label).width;
  const pw   = tw + 32, ph = fs + 18;
  const px   = offsetX + (vpW - pw) / 2;
  const py   = offsetY + vpH * 0.80;
  ctx.globalAlpha = pulse * 0.92;
  ctx.fillStyle = 'rgba(0,12,18,0.90)';
  ctx.strokeStyle = '#44ffcc'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(px, py, pw, ph, ph / 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#44ffcc';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, offsetX + vpW / 2, py + ph / 2);
  ctx.globalAlpha = 1;
  ctx.restore();
}

function _drawRiftCraftingPanel(gs, p, offsetX, offsetY, vpW, vpH, t) {
  const dpr      = canvas._dpr || 1;
  const hitAreas = [];

  // ── Panel sizing — vpW/vpH are canvas pixels; work in CSS pixels throughout ──
  const vpWcss = vpW / dpr;
  const vpHcss = vpH / dpr;
  // Panel in CSS pixels — fills viewport generously
  const panelWcss = Math.min(480, Math.max(300, vpWcss * 0.90));
  const panelHcss = Math.min(580, Math.max(360, vpHcss * 0.88));
  // Convert to canvas pixels for drawing
  const panelW = Math.round(panelWcss * dpr);
  const panelH = Math.round(panelHcss * dpr);
  const panelX = offsetX + (vpW - panelW) / 2;
  const panelY = offsetY + (vpH - panelH) / 2;
  const pad    = Math.round(12 * dpr);
  // Font sizes: fixed comfortable CSS px values * dpr for canvas
  const titleFs = 15 * dpr;
  const tabFs   = 13 * dpr;
  const itemFs  = 12 * dpr;
  const hintFs  = 10 * dpr;
  const FOOTER_H = Math.round(42 * dpr);

  // ── Dim backdrop ──
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(offsetX, offsetY, vpW, vpH);

  // ── Panel bg + border ──
  ctx.globalAlpha = 0.98;
  ctx.fillStyle = 'rgba(4,12,22,0.99)';
  ctx.strokeStyle = 'rgba(0,200,140,0.6)';
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath(); ctx.roundRect(panelX, panelY, panelW, panelH, 8 * dpr);
  ctx.fill(); ctx.stroke();
  ctx.globalAlpha = 1;

  let curY = panelY + pad + 2;

  // ── Title ──
  ctx.fillStyle = '#44ffcc';
  ctx.font = `900 ${titleFs}px "Orbitron",monospace`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('⬡ CONVERGENCE FORGE', panelX + panelW / 2, curY);
  curY += titleFs + 5;

  // ── Flux wallet ──
  const FLUX_COLORS = { ember:'#ff6622', storm:'#aa88ff', frost:'#88eeff', void:'#9944cc', gale:'#ddcc44', tide:'#4488ff', wildcard:'#44ffcc' };
  const FLUX_ICONS  = { ember:'🔥', storm:'⚡', frost:'❄', void:'◉', gale:'🌪', tide:'💧', wildcard:'⬡' };
  const fluxOrder   = ['ember','storm','frost','void','gale','tide','wildcard'];
  const walletEntries = fluxOrder.filter(k => (p._flux?.[k] ?? 0) > 0);
  const wfs = Math.min(10, Math.max(8, panelW * 0.020));
  if (walletEntries.length > 0) {
    const iw  = Math.min(wfs * 3.2, (panelW - pad * 2) / walletEntries.length);
    const tw  = walletEntries.length * iw;
    let wdx   = panelX + (panelW - tw) / 2;
    ctx.font = `700 ${wfs}px "Orbitron",monospace`;
    ctx.textBaseline = 'middle';
    for (const fType of walletEntries) {
      const amt = p._flux[fType];
      const col = FLUX_COLORS[fType] ?? '#44ffcc';
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 3;
      ctx.textAlign = 'left';
      ctx.fillText(FLUX_ICONS[fType] ?? '⬡', wdx, curY + wfs / 2);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`×${amt}`, wdx + wfs * 1.1, curY + wfs / 2);
      wdx += iw;
    }
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = 'rgba(100,150,130,0.5)';
    ctx.font = `600 ${wfs}px "Orbitron",monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('NO FLUX — EARN IN STORMS', panelX + panelW / 2, curY + wfs / 2);
  }
  curY += wfs + 8;

  // ── Tabs ──
  const activeTab = p._craftTab ?? 'relics';
  const tabH  = Math.max(20, tabFs + 10);
  const tabW  = panelW - pad * 2;
  const tabs  = [{ id:'relics', label:'💎 RELICS', color:'#cc88ff' }];
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    const tx  = panelX + pad + i * (tabW + 6);
    const isActive = activeTab === tab.id;
    ctx.globalAlpha = isActive ? 1 : 0.45;
    ctx.fillStyle = isActive ? (i === 0 ? 'rgba(50,40,0,0.95)' : 'rgba(35,0,55,0.95)') : 'rgba(0,15,10,0.7)';
    ctx.beginPath(); ctx.roundRect(tx, curY, tabW, tabH, 4 * dpr); ctx.fill();
    ctx.strokeStyle = isActive ? tab.color : 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath(); ctx.roundRect(tx, curY, tabW, tabH, 4 * dpr); ctx.stroke();
    ctx.fillStyle = isActive ? tab.color : 'rgba(180,200,190,0.5)';
    ctx.font = `700 ${tabFs}px "Orbitron",monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(tab.label, tx + tabW / 2, curY + tabH / 2);
    ctx.globalAlpha = 1;
    hitAreas.push({ x: tx * dpr, y: curY * dpr, w: tabW * dpr, h: tabH * dpr, type: 'tab', tab: tab.id });
  }
  curY += tabH + 4;

  // ── Item rows ──
  const listTop    = curY;
  const listBottom = panelY + panelH - FOOTER_H - 2;
  const tabItems = RELIC_DEFS;
  const itemH      = Math.max(Math.round(34 * dpr), Math.min(Math.round(50 * dpr), (listBottom - listTop) / tabItems.length));
  const rowW       = panelW - pad * 2;

  // Clip to list area
  ctx.save();
  ctx.beginPath(); ctx.rect(panelX + pad, listTop - 1, rowW, listBottom - listTop + 2); ctx.clip();

  let itemCount = 0;
  let iy = listTop;
  for (const def of tabItems) {
    if (iy + itemH > listBottom + 2) break;
    const canAfford  = canAffordCraft(p, def.cost);
    const isSelected = p._craftSelectedId === def.id;
    const isNavHover = (p._riftNavIdx ?? -1) === itemCount;

    // Row bg — always visible, dim if unaffordable
    ctx.globalAlpha = 1;
    ctx.fillStyle = isSelected
      ? 'rgba(0,90,55,0.95)'
      : isNavHover ? 'rgba(20,50,35,0.90)'
      : canAfford  ? 'rgba(8,22,16,0.90)'
      : 'rgba(8,14,12,0.70)';
    ctx.beginPath(); ctx.roundRect(panelX + pad, iy, rowW, itemH - 2, 4 * dpr); ctx.fill();

    if (isSelected) {
      ctx.strokeStyle = def.color ?? '#44ffcc'; ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.roundRect(panelX + pad, iy, rowW, itemH - 2, 4 * dpr); ctx.stroke();
    }
    if (isNavHover && !isSelected) {
      ctx.globalAlpha = 0.55 + 0.3 * Math.sin(t * 4);
      ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1 * dpr;
      ctx.setLineDash([3 * dpr, 3 * dpr]);
      ctx.beginPath(); ctx.roundRect(panelX + pad, iy, rowW, itemH - 2, 4); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }

    // Measure cost width first
    ctx.font = `700 ${itemFs}px "Orbitron",monospace`;
    let costTotalW = 0;
    const costParts = [];
    for (const [fType, fAmt] of def.cost) {
      const lbl = `${FLUX_ICONS[fType] ?? '⬡'}×${fAmt}`;
      const lw  = ctx.measureText(lbl).width + 6;
      costParts.push({ lbl, lw, col: FLUX_COLORS[fType] ?? '#44ffcc' });
      costTotalW += lw;
    }

    // Always full alpha — use color to distinguish affordable vs not
    ctx.globalAlpha = 1;

    // Icon
    const iconX = panelX + pad + 5;
    const midY  = iy + itemH / 2;
    ctx.font = `${itemFs + 2}px sans-serif`;
    ctx.fillStyle = canAfford ? (def.color ?? '#44ffcc') : 'rgba(120,140,130,0.6)';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(def.icon, iconX, midY);

    // Name (top) + desc (bottom) — clipped to avoid cost overlap
    const textX    = iconX + itemFs + 8;
    const textMaxW = rowW - (itemFs + 10) - costTotalW - (isSelected ? itemFs + 4 : 2) - 4;
    ctx.save();
    ctx.beginPath(); ctx.rect(textX, iy, Math.max(20, textMaxW), itemH); ctx.clip();

    ctx.font = `700 ${itemFs}px "Orbitron",monospace`;
    ctx.fillStyle = canAfford ? '#ffffff' : 'rgba(160,180,170,0.7)';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(def.label, textX, iy + itemH * 0.32);

    ctx.font = `500 ${Math.max(7, itemFs - 2)}px "Rajdhani",sans-serif`;
    ctx.fillStyle = canAfford ? 'rgba(170,210,190,0.75)' : 'rgba(120,150,135,0.55)';
    ctx.textBaseline = 'middle';
    ctx.fillText(def.desc ?? '', textX, iy + itemH * 0.72);
    ctx.restore();

    // Cost — right-aligned, grey if can't afford
    let cx2 = panelX + pad + rowW - (isSelected ? itemFs + 4 : 2);
    for (let ci = costParts.length - 1; ci >= 0; ci--) {
      const cp = costParts[ci];
      cx2 -= cp.lw;
      ctx.font = `700 ${itemFs}px "Orbitron",monospace`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillStyle = canAfford ? cp.col : 'rgba(120,130,125,0.6)';
      ctx.shadowColor = canAfford ? cp.col : 'transparent';
      ctx.shadowBlur  = canAfford ? 3 : 0;
      ctx.fillText(cp.lbl, cx2, midY);
      ctx.shadowBlur = 0;
    }
    if (isSelected) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = def.color ?? '#44ffcc';
      ctx.font = `${itemFs + 1}px sans-serif`;
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText('✓', panelX + pad + rowW, midY);
    }

    ctx.globalAlpha = 1;
    hitAreas.push({ x: (panelX + pad) * dpr, y: iy * dpr, w: rowW * dpr, h: (itemH - 2) * dpr, type: 'item', id: def.id });
    itemCount++;
    iy += itemH;
  }
  ctx.restore(); // unclip list

  // ── Footer ──
  const footerY = panelY + panelH - FOOTER_H;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath(); ctx.roundRect(panelX + dpr, footerY, panelW - 2 * dpr, FOOTER_H, [0,0,6*dpr,6*dpr]); ctx.fill();

  const allItems   = RELIC_DEFS;
  const selDef     = allItems.find(d => d.id === p._craftSelectedId);
  const footerMidY = footerY + FOOTER_H * 0.40;
  ctx.textAlign = 'center';

  if (p._craftTarget && (p._craftTimer ?? 0) > 0) {
    const prog = Math.min(1, p._craftTimer / RIFT_CRAFT_TIME);
    const pbW  = panelW * 0.72, pbH = 6 * dpr;
    const pbX  = panelX + (panelW - pbW) / 2;
    const pbY  = footerY + FOOTER_H - pbH - 5 * dpr;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath(); ctx.roundRect(pbX, pbY, pbW, pbH, 3 * dpr); ctx.fill();
    ctx.fillStyle = p._craftTarget.color ?? '#44ffcc';
    ctx.globalAlpha = 0.9 + 0.1 * Math.sin(t * 10);
    ctx.beginPath(); ctx.roundRect(pbX, pbY, pbW * prog, pbH, 3 * dpr); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffffff'; ctx.font = `700 ${itemFs}px "Orbitron",monospace`;
    ctx.textBaseline = 'middle';
    ctx.fillText(`CRAFTING ${p._craftTarget.label}…`, panelX + panelW / 2, footerMidY - 2);
  } else if (selDef) {
    const affordable = canAffordCraft(p, selDef.cost);
    ctx.fillStyle = affordable ? '#44ffcc' : '#ff8844';
    ctx.font = `700 ${itemFs}px "Orbitron",monospace`;
    ctx.textBaseline = 'middle';
    ctx.fillText(affordable ? `STAND STILL → ${selDef.label}` : 'NOT ENOUGH FLUX', panelX + panelW / 2, footerMidY);
  } else {
    ctx.fillStyle = 'rgba(140,190,170,0.6)';
    ctx.font = `600 ${itemFs}px "Orbitron",monospace`;
    ctx.textBaseline = 'middle';
    ctx.fillText('SELECT AN ITEM TO CRAFT', panelX + panelW / 2, footerMidY);
  }

  // Input hints
  ctx.globalAlpha = 0.40;
  ctx.fillStyle = '#aaccbb';
  ctx.font = `600 ${hintFs}px "Orbitron",monospace`;
  ctx.textBaseline = 'bottom';
  if (gamepadState?.connected) {
    ctx.fillText('↕ NAV   L1/R1 TABS   A SELECT', panelX + panelW / 2, panelY + panelH - 3);
  } else {
    ctx.fillText('↑↓ NAV   ←→ TABS   ENTER SELECT', panelX + panelW / 2, panelY + panelH - 3);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  gs._riftPanelHitAreas = hitAreas;
}

// ── Debug overlay (only active when ?debug is in the URL) ────────────────
function drawDebugOverlay(gs) {
  if (!gs) return;
  const baseScale = canvas._worldScale || 1;
  const offsetX   = canvas._worldOffsetX || 0;
  const offsetY   = canvas._worldOffsetY || 0;
  const vpW = VIEW_W * baseScale;
  const vpH = VIEW_H * baseScale;
  const t   = performance.now() / 1000;

  ctx.save();

  const panW = 300, panH = 260;
  const panX = offsetX + 10, panY = offsetY + vpH - panH - 10;
  ctx.globalAlpha = 0.82;
  ctx.fillStyle = 'rgba(0,10,8,0.92)';
  ctx.strokeStyle = '#44ffcc';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(panX, panY, panW, panH, 6); ctx.fill(); ctx.stroke();
  ctx.globalAlpha = 1;

  const lh = 17, fs = 11;
  let ly = panY + 14;
  const lx = panX + 10;

  ctx.font = `900 ${fs + 1}px "Orbitron",monospace`;
  ctx.fillStyle = '#44ffcc';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('⬡ DEBUG', lx, ly); ly += lh + 4;

  ctx.strokeStyle = 'rgba(0,200,140,0.3)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(panX + 8, ly); ctx.lineTo(panX + panW - 8, ly); ctx.stroke();
  ly += 6;

  ctx.font = `600 ${fs}px "Orbitron",monospace`;

  const riftSecsLeft = gs.riftOpen
    ? `OPEN — ${Math.ceil(gs.riftPortal?.life ?? 0)}s left`
    : `spawns in ${Math.ceil(gs.riftTimer ?? 0)}s`;
  ctx.fillStyle = gs.riftOpen ? '#44ffcc' : '#88aa99';
  ctx.fillText(`RIFT: ${riftSecsLeft}`, lx, ly); ly += lh;

  const inRift = gs._riftChars?.length ?? 0;
  ctx.fillStyle = inRift > 0 ? '#ffcc44' : '#556655';
  ctx.fillText(`IN RIFT: ${inRift} char${inRift !== 1 ? 's' : ''}`, lx, ly); ly += lh;

  ly += 4;
  ctx.strokeStyle = 'rgba(0,200,140,0.2)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(panX + 8, ly); ctx.lineTo(panX + panW - 8, ly); ctx.stroke();
  ly += 6;

  const p = gs.players?.[0] ?? gs.player;
  if (p?._flux) {
    ctx.fillStyle = '#aaccbb';
    ctx.fillText('FLUX WALLET:', lx, ly); ly += lh;
    const fluxOrder = ['ember','storm','frost','void','gale','tide','wildcard'];
    for (const fType of fluxOrder) {
      const amt = p._flux[fType] ?? 0;
      const col = FLUX_COLORS[fType] ?? '#44ffcc';
      const icon = FLUX_ICONS[fType] ?? '⬡';
      ctx.fillStyle = amt > 0 ? col : '#334433';
      const bar = '█'.repeat(amt) + '░'.repeat(Math.max(0, FLUX_MAX - amt));
      ctx.fillText(`${icon} ${FLUX_LABELS[fType] ?? fType}: ${bar} ${amt}`, lx + 8, ly);
      ly += lh;
    }
  }

  ly += 4;
  ctx.strokeStyle = 'rgba(0,200,140,0.2)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(panX + 8, ly); ctx.lineTo(panX + panW - 8, ly); ctx.stroke();
  ly += 6;

  if (p) {
    ctx.fillStyle = p._relic ? '#cc88ff' : '#445544';
    ctx.fillText(`RELIC: ${p._relic ? p._relic.label : 'none'}`, lx, ly); ly += lh;
  }

  ctx.fillStyle = 'rgba(150,220,190,0.55)';
  ctx.font = `600 ${fs - 1}px "Orbitron",monospace`;
  ctx.textBaseline = 'bottom';
  ctx.fillText('⇧R rift  ⇧F flux  ⇧T rift 5s  ⇧W storms', lx, panY + panH - 10);

  ctx.restore();
}
