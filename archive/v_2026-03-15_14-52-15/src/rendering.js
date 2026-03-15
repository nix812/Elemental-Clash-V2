// ========== RENDER ==========
function render(gs) {
  const {W,H} = gs;
  const scale   = canvas._worldScale   || 1;
  const offsetX = canvas._worldOffsetX || 0;
  const offsetY = canvas._worldOffsetY || 0;

  // Clear full canvas (including letterbox bars)
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Apply viewport clip so nothing renders outside the letterbox
  ctx.save();
  ctx.beginPath();
  ctx.rect(offsetX, offsetY, VIEW_W * scale, VIEW_H * scale);
  ctx.clip();

  // Apply world transform: letterbox offset + scale + camera pan
  ctx.save();
  ctx.translate(offsetX - camera.x * scale, offsetY - camera.y * scale);
  ctx.scale(scale, scale);

  // Background — full world arena
  drawArena(W, H);

  // Edge warp availability indicator
  drawWarpEdges(gs);

  // Weather zones — drawn above terrain, below items/characters
  drawWeatherZones(gs);

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

  // Effects
  gs.effects.forEach(ef => {
    const progress = 1 - ef.life / ef.maxLife; // 0=just spawned, 1=dying
    const alpha = ef.life / ef.maxLife;
    const radius = ef.r + progress * ef.maxR;
    const t = performance.now() / 1000;
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
  gs.projectiles.forEach(proj => {
    if (gs.gates) {
      const b = getArenaBounds(gs);
      if (proj.x < b.x || proj.x > b.x2 || proj.y < b.y || proj.y > b.y2) return;
    }
    ctx.save();
    const col  = proj.heal ? '#44ff88' : proj.color;
    const elem = proj.casterRef?.hero?.id ?? null;
    const r    = proj.radius;
    const t    = performance.now() / 1000;
    const angle = Math.atan2(proj.vy, proj.vx);

    // ── Element-specific projectile renderers ───────────────────────
    if (elem === 'fire') {
      // Comet — teardrop with trailing sparks
      const tailLen = r * 3.5;
      const grad = ctx.createLinearGradient(
        proj.x + Math.cos(angle + Math.PI) * tailLen, proj.y + Math.sin(angle + Math.PI) * tailLen,
        proj.x, proj.y
      );
      grad.addColorStop(0, 'rgba(255,80,0,0)');
      grad.addColorStop(0.5, 'rgba(255,140,20,0.5)');
      grad.addColorStop(1, 'rgba(255,220,60,0.95)');
      ctx.beginPath();
      ctx.moveTo(proj.x + Math.cos(angle) * r, proj.y + Math.sin(angle) * r);
      ctx.lineTo(proj.x + Math.cos(angle + Math.PI) * tailLen, proj.y + Math.sin(angle + Math.PI) * tailLen);
      ctx.lineWidth = r * 2;
      ctx.strokeStyle = grad;
      ctx.lineCap = 'round';
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

  // Characters
  [gs.player, ...gs.enemies].forEach(c => drawChar(c,gs));

  // Float damage
  gs.floatDmgs.forEach(f => {
    const maxLife = f.maxLife || 1.2;
    const fadeStart = maxLife * 0.65;
    const alpha = f.life > fadeStart ? 1 : f.life / fadeStart;
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;

    const size       = f.size || 18;
    const riseSpeed  = f.riseSpeed || 50;
    const elapsed    = maxLife - f.life;
    const ry         = f.y - elapsed * riseSpeed;
    const cat        = f.cat || 'damage';
    const isPriority = cat === 'priority';
    const isCC       = cat === 'cc';

    // Font weight + size
    const weight = isPriority ? '900' : (isCC ? '700' : 'bold');
    ctx.font = `${weight} ${size}px 'Orbitron',monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Outline thickness — thicker for priority, lighter for CC
    const lw = isPriority ? 4 : (isCC ? 2 : 3);
    ctx.lineWidth = lw;

    // Priority: glow effect via double stroke
    if (isPriority) {
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(f.text, f.x, ry);
      // Inner coloured glow
      ctx.globalAlpha = alpha * 0.4;
      ctx.strokeStyle = f.color;
      ctx.lineWidth = lw * 2.5;
      ctx.strokeText(f.text, f.x, ry);
      ctx.globalAlpha = alpha;
      ctx.lineWidth = lw;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(f.text, f.x, ry);
    } else {
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(f.text, f.x, ry);
    }

    // Scale-in pop for priority on first 0.1s
    if (isPriority && elapsed < 0.1) {
      const scale = 0.7 + (elapsed / 0.1) * 0.3;
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

  // Restore world transform
  ctx.restore();
  // Restore viewport clip
  ctx.restore();
}

// ========== OFF-SCREEN INDICATORS ==========
// Draws edge arrows + name + HP bar for any enemy not visible in viewport.
// Rendered in SCREEN space (after world transform restored) so always visible.
let showOffScreenIndicators = true;

function renderOffScreenIndicators(gs) {
  if (!showOffScreenIndicators) return;
  const scale   = canvas._worldScale   || 1;
  const offsetX = canvas._worldOffsetX || 0;
  const offsetY = canvas._worldOffsetY || 0;

  const vx1 = camera.x, vy1 = camera.y;  // kept for potential future use
  const vx2 = camera.x + VIEW_W, vy2 = camera.y + VIEW_H;
  const margin = 28; // px from edge in screen space
  const arrowSize = 10;

  gs.enemies.forEach(e => {
    if (!e.alive) return;

    // Enemy is off-screen — compute shortest warp-aware delta from viewport center
    const vcx = camera.x + VIEW_W / 2;
    const vcy = camera.y + VIEW_H / 2;

    // Always use warp-aware delta so position near edges doesn't flip sign
    let rawDx = e.x - vcx;
    let rawDy = e.y - vcy;
    if (Math.abs(rawDx - WORLD_W) < Math.abs(rawDx)) rawDx -= WORLD_W;
    else if (Math.abs(rawDx + WORLD_W) < Math.abs(rawDx)) rawDx += WORLD_W;
    if (Math.abs(rawDy - WORLD_H) < Math.abs(rawDy)) rawDy -= WORLD_H;
    else if (Math.abs(rawDy + WORLD_H) < Math.abs(rawDy)) rawDy += WORLD_H;

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
    const sx = offsetX + (VIEW_W / 2 + ix) * scale;
    const sy = offsetY + (VIEW_H / 2 + iy) * scale;

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

function drawArena(W, H) {
  const GRID_SIZE = 200;
  const cx1 = Math.floor(camera.x / GRID_SIZE) - 1;
  const cy1 = Math.floor(camera.y / GRID_SIZE) - 1;
  const cx2 = Math.ceil((camera.x + VIEW_W) / GRID_SIZE) + 1;
  const cy2 = Math.ceil((camera.y + VIEW_H) / GRID_SIZE) + 1;

  // Fill flat background
  for (let c = cx1; c <= cx2; c++) {
    for (let r = cy1; r <= cy2; r++) {
      const px = c * GRID_SIZE, py = r * GRID_SIZE;
      ctx.fillStyle = '#080c10';
      ctx.fillRect(px, py, GRID_SIZE, GRID_SIZE);
    }
  }

  // Subtle grid lines
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  for (let c = cx1; c <= cx2; c++) {
    const px = c * GRID_SIZE;
    ctx.moveTo(px, cy1 * GRID_SIZE);
    ctx.lineTo(px, (cy2 + 1) * GRID_SIZE);
  }
  for (let r = cy1; r <= cy2; r++) {
    const py = r * GRID_SIZE;
    ctx.moveTo(cx1 * GRID_SIZE, py);
    ctx.lineTo((cx2 + 1) * GRID_SIZE, py);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.stroke();

  // World boundary glow (warp indicators)
  ctx.save();
  ctx.strokeStyle = 'rgba(0,212,255,0.2)';
  ctx.lineWidth = 3;
  ctx.setLineDash([12, 8]);
  ctx.strokeRect(0, 0, W, H);
  ctx.setLineDash([]);
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
      ctx.fillStyle=ig; ctx.shadowColor='#88ddff'; ctx.shadowBlur=i===0?20:8;
      ctx.globalAlpha=0.75+Math.sin(t*2+i)*0.15; ctx.fill();
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

  // Target lock ring (shown on locked enemy)
  if (!c.isPlayer && c === lockedTarget) {
    ctx.save();
    const lockPulse = 0.6 + Math.sin(t * 6) * 0.4;
    ctx.strokeStyle = `rgba(255, 238, 68, ${lockPulse})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 3]);
    ctx.lineDashOffset = -t * 40;
    ctx.beginPath(); ctx.arc(cx, cy, r + 22, 0, Math.PI * 2); ctx.stroke();
    // Corner brackets
    ctx.setLineDash([]);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = `rgba(255,238,68,${lockPulse})`;
    const bSize = 8, bGap = r + 14;
    [[1,1],[-1,1],[1,-1],[-1,-1]].forEach(([sx,sy]) => {
      ctx.beginPath();
      ctx.moveTo(cx + sx*bGap, cy + sy*(bGap+bSize));
      ctx.lineTo(cx + sx*bGap, cy + sy*bGap);
      ctx.lineTo(cx + sx*(bGap+bSize), cy + sy*bGap);
      ctx.stroke();
    });
    ctx.restore();
  }

  // Ground shadow
  ctx.save();
  ctx.fillStyle='rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(cx,cy+r+3,r*0.75,4,0,0,Math.PI*2); ctx.fill();
  ctx.restore();

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

  // HP bar
  const bw=r*2.8, bh=Math.max(4, window.innerWidth*0.006);
  const bx=cx-bw/2, by=cy-r-18;
  ctx.fillStyle='rgba(0,0,0,0.55)';
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
    ctx.strokeText(c.hero.name, cx, by - 2);
    ctx.fillStyle = heroCol;
    ctx.fillText(c.hero.name, cx, by - 2);
    ctx.restore();
  }

  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx,by,bw,bh,2) : ctx.fillRect(bx,by,bw,bh); ctx.fill();
  const hpPct=c.hp/c.maxHp;
  // HP bar uses hero color at full health, blends to red as HP drops
  const hpColor = hpPct > 0.35 ? heroCol : hpPct > 0.18 ? '#ffaa44' : '#ff4444';
  ctx.fillStyle=hpColor;
  ctx.fillRect(bx,by,bw*hpPct,bh);

  // Mana bar — sits 2px below HP bar
  const mbh = Math.max(3, bh * 0.65);
  const mby = by + bh + 2;
  const manaPct = Math.min(1, (c.mana ?? 0) / (c.maxMana ?? 80));
  ctx.fillStyle='rgba(0,0,0,0.45)';
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx,mby,bw,mbh,2) : ctx.fillRect(bx,mby,bw,mbh); ctx.fill();
  ctx.fillStyle='#4488ff';
  ctx.fillRect(bx, mby, bw * manaPct, mbh);

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

  // ── Weather buff labels — one row per active zone, stacked below character ──
  const activeZones = c.inWeatherAll?.length ? c.inWeatherAll.filter(w => w.intensity > 0.2) : [];
  if (activeZones.length) {
    const fs = Math.max(8, r * 0.45);
    ctx.save();
    ctx.font = `700 ${fs}px "Orbitron",monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    let labelY = cy + r + 22;
    for (const w of activeZones) {
      const def = w.def;
      const u = def.universal;
      const parts = [];
      if (u) {
        if (u.dmgMult)      parts.push(u.dmgMult > 1 ? `DMG +${Math.round((u.dmgMult-1)*100)}%` : `DMG ${Math.round((u.dmgMult-1)*100)}%`);
        if (u.rangeMult)    parts.push(u.rangeMult > 1 ? `RNG +${Math.round((u.rangeMult-1)*100)}%` : `RNG ${Math.round((u.rangeMult-1)*100)}%`);
        if (u.speedMult)    parts.push(u.speedMult > 1 ? `SPD +${Math.round((u.speedMult-1)*100)}%` : `SPD ${Math.round((u.speedMult-1)*100)}%`);
        if (u.cooldownMult) parts.push(`CD ×${(1/u.cooldownMult).toFixed(1)}`);
        if (u.healRate)     parts.push(`+${u.healRate}HP/s`);
        if (u.voidPull)     parts.push(`PULL`);
      }
      if (!parts.length) continue;
      ctx.globalAlpha = 0.55 + 0.35 * w.intensity;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 3;
      // Icon + label on same row
      const iconFs = Math.max(10, r * 0.55);
      ctx.font = `${iconFs}px sans-serif`;
      ctx.strokeText(def.icon ?? '⚡', cx - ctx.measureText(parts.join(' · ')).width / 2 - iconFs, labelY);
      ctx.fillStyle = def.color;
      ctx.fillText(def.icon ?? '⚡', cx - ctx.measureText(parts.join(' · ')).width / 2 - iconFs, labelY);
      ctx.font = `700 ${fs}px "Orbitron",monospace`;
      ctx.strokeText(parts.join(' · '), cx, labelY);
      ctx.fillStyle = def.color;
      ctx.fillText(parts.join(' · '), cx, labelY);
      labelY += fs + 6; // next zone below
    }
    ctx.restore();
  }

  ctx.restore(); // balance ctx.save() at top of drawChar
}

function drawHUD(gs) {
  // ── Screen-space layout variables ──
  const W   = canvas.width;
  const H   = canvas.height;
  const cx  = W / 2;
  const pad = Math.round(H * 0.014);
  const nameSize = Math.max(9, Math.round(H * 0.018));
  const barH     = Math.max(10, Math.round(H * 0.016));
  const barGap   = Math.max(3,  Math.round(H * 0.006));

  ctx.save();

  // ── Countdown overlay ────────────────────────────────────────────────────
  if (gs.countdown > 0) {
    const cd = gs.countdown;
    const digit = cd > 2 ? '3' : cd > 1 ? '2' : cd > 0.15 ? '1' : 'GO!';
    // Pulse scale: big pop on each new number
    const frac  = cd % 1; // 0→1 within each second
    const scale = digit === 'GO!' ? 1 + (1 - cd / 0.15) * 0.4
                                  : 1 + frac * 0.35;
    const alpha = digit === 'GO!' ? Math.max(0, cd / 0.15) : 1;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(W / 2, H / 2);
    ctx.scale(scale, scale);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Shadow / glow
    ctx.shadowColor = digit === 'GO!' ? '#44ff88' : '#00d4ff';
    ctx.shadowBlur  = 40;
    ctx.fillStyle   = digit === 'GO!' ? '#44ff88' : '#ffffff';
    ctx.font        = `900 ${Math.round(H * 0.22)}px 'Orbitron', monospace`;
    ctx.fillText(digit, 0, 0);

    // Subtext
    if (digit !== 'GO!') {
      ctx.shadowBlur = 10;
      ctx.fillStyle  = 'rgba(255,255,255,0.45)';
      ctx.font       = `700 ${Math.round(H * 0.028)}px 'Orbitron', monospace`;
      ctx.fillText('GET READY', 0, Math.round(H * 0.14));
    }
    ctx.restore();
  }

  // ── Target frame: fixed DOM element in lower-left ──
  const target = lockedTarget || (gs.enemies && gs.enemies[0]);
  const tf = document.getElementById('target-frame');
  if (tf) {
    if (target && target.alive) {
      const hpPct   = target.hp / target.maxHp;
      const hpCol   = hpPct > 0.5 ? '#44ff88' : hpPct > 0.25 ? '#ffaa44' : '#ff4444';
      const manaPct = Math.min(1, (target.mana ?? 0) / (target.maxMana ?? 80));
      document.getElementById('tf-name').textContent  = target.hero.name;
      document.getElementById('tf-name').style.color  = target.hero.color;
      const bar = document.getElementById('tf-hpbar');
      bar.style.width      = `${Math.max(0, hpPct * 100)}%`;
      bar.style.background = hpCol;
      document.getElementById('tf-hpval').textContent =
        `${Math.ceil(target.hp)} / ${Math.ceil(target.maxHp)}`;
      document.getElementById('tf-manabar').style.width =
        `${Math.max(0, manaPct * 100)}%`;
      document.getElementById('tf-manaval').textContent =
        `${Math.floor(target.mana ?? 0)} / ${Math.floor(target.maxMana ?? 80)} MP`;
      document.getElementById('target-frame').style.borderColor = target.hero.color;
      tf.style.display = 'block';
    } else {
      tf.style.display = 'none';
    }
  }

  // ── Warp timer (bottom-center) ──
  {
    const WARP_CD = 4.5;
    const now = performance.now() / 1000;
    const elapsed = now - (gs.player._lastWarp || 0);
    const onCooldown = elapsed < WARP_CD;
    const progress = Math.min(1, elapsed / WARP_CD);
    const p = gs.player;
    const nearEdge = p && p.alive && (p.x < 280 || p.x > gs.W - 280 || p.y < 280 || p.y > gs.H - 280);

    // Weather pill hidden — buff drawn on canvas in drawChar
    { const pill = document.getElementById("weather-player-pill"); if (pill) pill.style.display = "none"; }

    if (p && p.alive && (onCooldown || nearEdge)) {
      const bw = Math.round(W * 0.16);
      const bh = Math.round(H * 0.016);
      const bx = cx - bw / 2;
      const by = H - pad - bh - Math.round(H * 0.01);
      const labelSz = Math.max(8, Math.round(H * 0.012));

      // Label
      ctx.font = `700 ${labelSz}px "Orbitron",monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = onCooldown ? 'rgba(255,120,80,0.85)' : 'rgba(80,220,255,0.7)';
      ctx.strokeStyle = onCooldown ? 'rgba(100,20,0,0.7)' : 'rgba(0,60,100,0.7)';
      ctx.lineWidth = 2.5;
      ctx.strokeText('WARP', cx, by - 3);
      ctx.fillText('WARP', cx, by - 3);

      // Track
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath(); roundRect(bx, by, bw, bh, bh / 2); ctx.fill();

      // Fill
      const fillColor = onCooldown
        ? `rgba(255,${Math.round(120 + 80 * progress)},60,0.85)`
        : 'rgba(80,220,255,0.75)';
      const fillW = onCooldown ? bw * progress : bw;
      ctx.fillStyle = fillColor;
      ctx.beginPath(); roundRect(bx, by, Math.max(bh, fillW), bh, bh / 2); ctx.fill();

      // Tick marks at 25/50/75%
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 1;
      [0.25, 0.5, 0.75].forEach(t => {
        const tx = bx + bw * t;
        ctx.beginPath(); ctx.moveTo(tx, by + 2); ctx.lineTo(tx, by + bh - 2); ctx.stroke();
      });

      // "READY" flash when cooldown just cleared
      if (!onCooldown && elapsed < WARP_CD + 0.5) {
        const flashAlpha = Math.max(0, 1 - (elapsed - WARP_CD) / 0.5);
        ctx.font = `900 ${labelSz + 2}px "Orbitron",monospace`;
        ctx.fillStyle = `rgba(80,220,255,${flashAlpha})`;
        ctx.strokeStyle = 'rgba(0,80,120,0.7)'; ctx.lineWidth = 2.5;
        ctx.strokeText('READY', cx, by - 3);
        ctx.fillText('READY', cx, by - 3);
      }
    }
  }

  // ── Match timer — top center ──
  {
    const remaining = Math.max(0, MATCH_DURATION - gs.time);
    const mm = Math.floor(remaining / 60);
    const ss = String(Math.floor(remaining % 60)).padStart(2, '0');
    const timerStr = `${mm}:${ss}`;
    const urgent = remaining <= 30;
    const timerSize = Math.max(11, Math.round(H * 0.022));
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
    ctx.strokeText(timerStr, cx, pad);
    ctx.fillText(timerStr, cx, pad);
    ctx.textBaseline = 'alphabetic';
  }

  ctx.restore();
}


// roundRect helper (used by drawHUD)
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
  // Abilities — name from hero data, slot label as subtitle
  const slotLabels = ['Strong Ability', 'CC Ability', 'Ultimate'];
  const keys = ['q','e','r'];
  h.abilities.forEach((ab, i) => {
    const k = keys[i];
    const nameEl = document.getElementById(`ab-name-${k}`);
    const descEl = document.getElementById(`ab-desc-${k}`);
    if (nameEl) nameEl.textContent = ab.name;
    if (descEl) descEl.textContent = slotLabels[i];
  });
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
  showFloatText(gs.W/2, gs.H/2 - 60, 'SUDDEN DEATH', '#ffee00');

  // Eliminate anyone on teams below the tie kill count
  const allChars = [gs.player, ...gs.enemies];
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
  gs.maxKills = topKills + 1;
}

// ========== GAME OVER ==========
// Returns winning teamId if a team has reached maxKills, else null
function checkWinCondition(gs) {
  for (const [teamId, kills] of Object.entries(gs.teamKills)) {
    if (kills >= gs.maxKills) return Number(teamId);
  }
  return null;
}

function endGame(gs, winningTeam) {
  gs.over = true;
  gs.winner = winningTeam;
  cancelAnimationFrame(animFrame);
  animFrame = null;
  // Always dismiss pause overlay so it doesn't bleed into the win screen
  const po = document.getElementById('pause-overlay');
  if (po) po.style.display = 'none';
  const tf = document.getElementById('target-frame');
  if (tf) tf.style.display = 'none';
  setTimeout(()=>{
    const playerTeam = gs.player.teamId ?? 0;
    const playerWon  = winningTeam === playerTeam;
    const tc = TEAM_COLORS[winningTeam] || TEAM_COLORS[0];
    const winKills = gs.teamKills[winningTeam] || 0;
    const isFFA = gs.teamIds && gs.teamIds.length > 2;

    document.getElementById('win-title').textContent = playerWon ? 'VICTORY' : 'DEFEAT';
    document.getElementById('win-title').style.color = playerWon ? 'var(--accent)' : '#ff4444';

    if (isFFA) {
      const winChar = [gs.player, ...gs.enemies].find(c => c.teamId === winningTeam);
      const winName = winChar ? winChar.hero.name : tc.name;
      document.getElementById('win-sub').textContent = `${winName} wins with ${winKills} kills!`;
    } else {
      const teamLabel = tc.name + ' TEAM';
      document.getElementById('win-sub').textContent = playerWon
        ? `Your team wins with ${winKills} kills!`
        : `${teamLabel} wins with ${winKills} kills!`;
    }

    const p = gs.player;
    document.getElementById('ws-kills').textContent   = p.kills || 0;
    document.getElementById('ws-assists').textContent = p.assists || 0;
    document.getElementById('ws-deaths').textContent  = gs.playerDeaths || 0;
    const mm=String(Math.floor(gs.time/60)).padStart(2,'0');
    const ss=String(Math.floor(gs.time%60)).padStart(2,'0');
    document.getElementById('ws-time').textContent = `${mm}:${ss}`;

    // Build full scoreboard
    const allChars = [gs.player, ...gs.enemies].sort((a, b) => {
      const aScore = (a.kills||0)*3 + (a.assists||0) - (a.deaths||0);
      const bScore = (b.kills||0)*3 + (b.assists||0) - (b.deaths||0);
      return bScore - aScore;
    });
    const wrap = document.getElementById('win-scoreboard-wrap');
    if (wrap) {
      const rows = allChars.map(c => {
        const k = c.kills || 0, a = c.assists || 0, d = c.deaths || 0;
        const kda = d > 0 ? ((k + a * 0.5) / d).toFixed(1) : (k + a * 0.5).toFixed(1);
        const teamCol = TEAM_COLORS[c.teamId]?.color || '#fff';
        const isPlayer = c.isPlayer;
        const typeTag = c.hero.combatClass ? c.hero.combatClass.toUpperCase() : '';
        return `<tr class="${isPlayer ? 'is-player' : ''}">
          <td><div class="wsb-hero">
            <div class="wsb-dot" style="background:${c.hero.color}"></div>
            <div>
              <div class="wsb-name" style="color:${c.hero.color}">${c.hero.name}${isPlayer ? ' <span style="color:var(--accent);font-size:0.75em">YOU</span>' : ''}</div>
              <div class="wsb-type">${typeTag}${isFFA ? '' : ` · <span style="color:${teamCol}">${TEAM_COLORS[c.teamId]?.name||''}</span>`}</div>
            </div>
          </div></td>
          <td class="wsb-kills">${k}</td>
          <td class="wsb-assists">${a}</td>
          <td class="wsb-deaths">${d}</td>
          <td class="wsb-kda">${kda}</td>
        </tr>`;
      }).join('');
      wrap.innerHTML = `<table class="win-scoreboard">
        <thead><tr>
          <th>HERO</th>
          <th>KILLS</th>
          <th>ASSISTS</th>
          <th>DEATHS</th>
          <th>KDA</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    }

    showScreen('win-screen');
  },1500);
}

