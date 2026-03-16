// ========== ABILITIES ==========
// ── Target lock helpers ───────────────────────────────────────────────────
function getLockedTarget(gs) {
  const p = gs.player;
  const opponents = gs.enemies.filter(e => e.alive && e.teamId !== p.teamId);
  if (!opponents.length) return null;
  if (lockedTarget && lockedTarget.alive && lockedTarget.teamId !== p.teamId) return lockedTarget;
  // Auto-lock nearest opponent
  lockedTarget = opponents.reduce((best, e) =>
    (!best || dist2(p, e) < dist2(p, best)) ? e : best, null);
  return lockedTarget;
}

function cycleTarget(gs) {
  const p = gs.player;
  // Always pick the closest opponent that isn't the current lock
  const opponents = gs.enemies
    .filter(e => e.alive && e.teamId !== p.teamId)
    .sort((a, b) => dist2(p, a) - dist2(p, b));
  if (!opponents.length) return;
  const idx = opponents.indexOf(lockedTarget);
  lockedTarget = opponents[(idx + 1) % opponents.length];
  showFloatText(lockedTarget.x, lockedTarget.y - 50, 'LOCKED', '#ffee44');
}

function useAbility(idx, event) {
  if (event) { event.stopPropagation(); event.preventDefault(); }
  const p = gameState?.player;
  if (!p || !p.alive || gameState.over || (gameState.countdown > 0)) return;
  if ((p.spawnInvuln ?? 0) > 0) return;
  const ab = p.hero.abilities[idx];
  if (p.cooldowns[idx] > 0) return;
  if (p.silenced > 0) { showFloatText(p.x, p.y-40, 'SILENCED!', '#cc88ff', p); return; }
  if (p.mana < ab.manaCost) { showFloatText(p.x, p.y-40, 'LOW MANA', '#4488ff', p); return; }
  const target = getLockedTarget(gameState);
  castAbility(p, idx, target, gameState);
}

// ========== ROCK BUSTER ==========
// Fires a single independent shot at the nearest obstacle.
// Completely separate from auto-attack cooldown — dedicated keybind only.
function activateRockBuster(event) {
  if (event) { event.stopPropagation(); event.preventDefault(); }
  const p = gameState?.player;
  const gs = gameState;
  if (!p || !p.alive || !gs || gs.over || gs.countdown > 0) return;
  if ((p.spawnInvuln ?? 0) > 0) return;
  if (p.stunned > 0 || p.frozen > 0) return;

  // Find nearest obstacle with HP (destructible)
  const obs = gs.obstacles ?? [];
  let nearest = null, nearestDist = Infinity;
  for (const ob of obs) {
    if (ob.hp === null) continue; // indestructible fragment
    const dx = ob.x - p.x, dy = ob.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d < nearestDist) { nearestDist = d; nearest = ob; }
  }
  if (!nearest) return; // no valid obstacle

  const dx = nearest.x - p.x;
  const dy = nearest.y - p.y;
  const dist = Math.max(1, Math.hypot(dx, dy));
  const speed = 10;
  const range = 600; // generous range — you're aiming at terrain not a moving target

  // Damage: same as a normal auto-attack
  const autoMult = p.combatClass === 'melee' ? 0.65 : p.combatClass === 'hybrid' ? 0.55 : 0.52;
  const dmg = Math.round((p.stats?.damage ?? 60) * autoMult);

  gs.projectiles.push({
    x: p.x, y: p.y,
    vx: (dx / dist) * speed,
    vy: (dy / dist) * speed,
    damage: dmg,
    radius: 6,
    life: range / (speed * 60),
    color: '#ff9933',       // distinct orange tint — not an auto, not an ability
    teamId: p.teamId,
    isRockBuster: true,     // flag: hits obstacles only, ignores characters
    isAutoAttack: false,
    stun:0, freeze:0, slow:0, silence:0, knockback:0,
    kbDirX: dx, kbDirY: dy,
    casterStats: p.stats, casterRef: p,
  });
  p.facing = dx > 0 ? 1 : -1;
  showFloatText(p.x, p.y - 45, 'ROCK BUSTER!', '#ff9933', p);
}


// Each AI gets a randomized personality on spawn that modifies their base
// difficulty config — makes matches feel different each time.
const AI_PERSONALITIES = [
  { id:'berserker',  fleeHpMult: 0.0,  aggrMult: 1.4,  label:'Berserker'  }, // never retreats, attacks harder
  { id:'aggressive', fleeHpMult: 0.4,  aggrMult: 1.2,  label:'Aggressive' }, // retreats very late, high pressure
  { id:'balanced',   fleeHpMult: 1.0,  aggrMult: 1.0,  label:'Balanced'   }, // default behavior
  { id:'cautious',   fleeHpMult: 1.5,  aggrMult: 0.85, label:'Cautious'   }, // retreats earlier, plays safe
  { id:'coward',     fleeHpMult: 2.2,  aggrMult: 0.70, label:'Coward'     }, // retreats at high HP, pokes from range
];

function rollPersonality() {
  return AI_PERSONALITIES[Math.floor(Math.random() * AI_PERSONALITIES.length)];
}

// ========== SPRINT SYSTEM ==========
// Per-class: { cd (cooldown), duration, mult (speed multiplier) }
const SPRINT_CONFIG = {
  melee:  { cd: 8,  duration: 2.5, mult: 1.80 },
  hybrid: { cd: 10, duration: 1.8, mult: 1.60 },
  ranged: { cd: 12, duration: 1.2, mult: 1.40 },
};

function activateSprint(event) {
  if (event) { event.stopPropagation(); event.preventDefault(); }
  const p = gameState?.player;
  if (!p || !p.alive || gameState.over || gameState.paused || gameState.countdown > 0) return;
  if ((p.spawnInvuln ?? 0) > 0) return;
  if ((p.sprintCd ?? 0) > 0) return;
  // Frozen = ultimate-tier CC, stays punishing — can't sprint out of it
  if (p.frozen > 0) return;

  const cfg = SPRINT_CONFIG[p.combatClass] ?? SPRINT_CONFIG.hybrid;
  p.sprintTimer = cfg.duration;
  p.sprintCd    = cfg.cd;
  p.sprintMult  = cfg.mult;

  // ── CC break — clears minor CCs (stun, slow, silence) but NOT freeze ──
  let brokeCc = false;
  if (p.stunned > 0)    { p.stunned = 0;    brokeCc = true; }
  if (p.ccedTimer > 0)  { p.ccedTimer = 0; p.speed = p._baseSpeed ?? p.speed; brokeCc = true; }
  if (p.silenced > 0)   { p.silenced = 0;   brokeCc = true; }
  if (brokeCc) {
    spawnFloat(p.x, p.y - 55, 'UNSTOPPABLE!', '#ffdc32', { char: p, size: 26, life: 1.4 });
    gameState.effects.push({ x:p.x, y:p.y, r:0, maxR:70, life:0.3, maxLife:0.3, color:'#ffdc32' });
  }

  // Visual pop
  showFloatText(p.x, p.y - 45, 'SPRINT!', '#ffdc32', p);
  gameState.effects.push({ x:p.x, y:p.y, r:0, maxR:50, life:0.25, maxLife:0.25, color:'#ffdc32' });
  // ── PASSIVE: GALE Tailwind ──
  PASSIVES[p.hero?.id]?.onSprint?.(p);
}

// ========== SPECIAL ABILITY ==========
// Melee  — SLAM:  AOE burst around caster, damages enemies and obstacles
// Hybrid — SURGE: Short forward dash, damages first enemy/obstacle it touches
// Ranged — FOCUS: Long-range charged skillshot, range scales with hero auto range

const SPECIAL_CONFIG = {
  melee:  { cd: 6,  label:'SLAM',  color:'#ff6644' },
  hybrid: { cd: 8,  label:'SURGE', color:'#ffee44' },
  ranged: { cd: 10, label:'FOCUS', color:'#44ccff' },
};

function activateSpecial(event) {
  if (event) { event.stopPropagation(); event.preventDefault(); }
  const p = gameState?.player;
  const gs = gameState;
  if (!p || !p.alive || !gs || gs.over || gs.paused || gs.countdown > 0) return;
  if ((p.spawnInvuln ?? 0) > 0) return;
  if ((p.specialCd ?? 0) > 0) return;
  if (p.stunned > 0 || p.frozen > 0) return;

  const cfg = SPECIAL_CONFIG[p.combatClass] ?? SPECIAL_CONFIG.hybrid;
  p.specialCd = cfg.cd;

  const col = p.hero.color;
  const dmgStat = p.stats?.damage ?? 60;
  const ap = p.stats?.abilityPower ?? 1.0;
  const allChars = gs._allCharsAlive ?? [gs.player, ...gs.enemies].filter(c => c?.alive);

  // ── MELEE: SLAM ──────────────────────────────────────────────────────────
  // Ground slam AOE — damages enemies and knocks obstacle hp in radius
  if (p.combatClass === 'melee') {
    const charSpeed = p.speed ?? 4.0;
    const heaviness = 1 - (charSpeed - 2.8) / (6.2 - 2.8);
    const slamRange = 140 + heaviness * 40; // heavier = wider slam: 140–180
    const slamDmg   = Math.round(dmgStat * ap * (0.55 + heaviness * 0.25)); // 0.55–0.80× ap

    // Hit enemies in range
    const targets = allChars.filter(c => c !== p && c.teamId !== p.teamId);
    for (const t of targets) {
      const dx = t.x - p.x, dy = t.y - p.y;
      if (dx*dx + dy*dy < slamRange * slamRange) {
        applyHit(t, { damage: slamDmg, flatBonus: 0, color: col, teamId: p.teamId,
          radius:0, stun:1.0, freeze:0, slow:0, silence:0, knockback:0,
          kbDirX: dx, kbDirY: dy, casterStats: p.stats, casterRef: p }, gs);
      }
    }

    // Damage nearby obstacles
    if (gs.obstacles) {
      for (let i = gs.obstacles.length - 1; i >= 0; i--) {
        const ob = gs.obstacles[i];
        const dx = ob.x - p.x, dy = ob.y - p.y;
        if (ob.hp !== null && dx*dx + dy*dy < (slamRange + ob.size) * (slamRange + ob.size)) {
          const obDmg = Math.max(1, Math.round(2 + heaviness * 3)); // 2–5 hp off per slam
          ob.hp = Math.max(0, ob.hp - obDmg);
          ob._hitFlash = 0.3;
          if (ob.hp <= 0) { spawnObstacleFragments(ob, gs); gs.obstacles.splice(i, 1); }
        }
      }
    }

    showFloatText(p.x, p.y - 50, 'SLAM!', col, p);
    gs.effects.push({ x:p.x, y:p.y, r:0, maxR:slamRange, life:0.35, maxLife:0.35, color:col, ring:true, elem:p.hero?.id });
    gs.effects.push({ x:p.x, y:p.y, r:0, maxR:slamRange*0.6, life:0.2, maxLife:0.2, color:col, elem:p.hero?.id });
    // ── PASSIVE: STONE Aftershock ──
    PASSIVES[p.hero?.id]?.onSlam?.(p, gs);
  }

  // ── HYBRID: SURGE ────────────────────────────────────────────────────────
  // Short forward shockwave dash — hits first enemy or obstacle in path
  else if (p.combatClass === 'hybrid') {
    const surgeDist = 220;
    const surgeSpd  = 28; // fast dash
    const surgeDmg  = Math.round(dmgStat * ap * 0.6);

    // Direction: toward locked target, else facing direction
    let dirX = p.facing ?? 1, dirY = 0;
    const lockedT = lockedTarget?.alive ? lockedTarget : null;
    if (lockedT) {
      const { dx: ldx, dy: ldy, dist: ld } = warpDelta(p.x, p.y, lockedT.x, lockedT.y);
      dirX = ldx / ld; dirY = ldy / ld;
    }

    // Step through path looking for first hit
    const steps = 12;
    let hit = false;
    for (let s = 1; s <= steps && !hit; s++) {
      const sx = p.x + dirX * (surgeDist / steps) * s;
      const sy = p.y + dirY * (surgeDist / steps) * s;

      // Enemy hit
      const targets = allChars.filter(c => c !== p && c.teamId !== p.teamId);
      for (const t of targets) {
        const dx = t.x - sx, dy = t.y - sy;
        if (dx*dx + dy*dy < (t.radius + 20) * (t.radius + 20)) {
          applyHit(t, { damage: surgeDmg, flatBonus: 0, color: col, teamId: p.teamId,
            radius: 0, stun: 0, freeze: 0, slow: 0.8, silence: 0, knockback: 0,
            kbDirX: dirX, kbDirY: dirY, casterStats: p.stats, casterRef: p }, gs);
          hit = true; break;
        }
      }
      // Obstacle hit
      if (!hit && gs.obstacles) {
        for (let i = gs.obstacles.length - 1; i >= 0; i--) {
          const ob = gs.obstacles[i];
          const dx = ob.x - sx, dy = ob.y - sy;
          if (dx*dx + dy*dy < (ob.size + 18) * (ob.size + 18)) {
            if (ob.hp !== null) {
              ob.hp = Math.max(0, ob.hp - 2);
              ob._hitFlash = 0.3;
              if (ob.hp <= 0) { spawnObstacleFragments(ob, gs); gs.obstacles.splice(i, 1); }
            }
            // Shove obstacle
            const od = Math.hypot(dx, dy) || 1;
            ob.vx = (ob.vx ?? 0) + (dirX) * 30;
            ob.vy = (ob.vy ?? 0) + (dirY) * 30;
            hit = true; break;
          }
        }
      }
    }

    // Teleport player along surge path (up to first hit, or full distance)
    const finalDist = hit ? surgeDist * 0.7 : surgeDist;
    p.x += dirX * finalDist;
    p.y += dirY * finalDist;
    p.x = clamp(p.x, p.radius, gs.W - p.radius);
    p.y = clamp(p.y, p.radius, gs.H - p.radius);
    resolveObstacleCollisions(p, gs);
    p.velX = dirX * surgeSpd; p.velY = dirY * surgeSpd;

    showFloatText(p.x, p.y - 45, 'SURGE!', col, p);
    gs.effects.push({ x:p.x, y:p.y, r:0, maxR:70, life:0.3, maxLife:0.3, color:col, elem:p.hero?.id });
  }

  // ── RANGED: FOCUS ────────────────────────────────────────────────────────
  // High-damage charged skillshot — range scales with hero's auto-attack range
  else {
    const classMult  = COMBAT_CLASS[p.combatClass]?.rangeMult ?? 1.2;
    const autoRange  = 180 * classMult; // base auto range for this hero
    const focusRange = autoRange * 2.4; // bumped from 1.8 — gives ranged meaningful map presence // focused shot flies significantly further
    const focusDmg   = Math.round(dmgStat * ap * 0.9);
    const focusSpd   = 13; // faster than normal projectiles (7–9.5)

    // Direction: toward locked target or crosshair direction (use last move direction fallback)
    let dirX = p.facing ?? 1, dirY = 0;
    const lockedT = lockedTarget?.alive ? lockedTarget : null;
    if (lockedT) {
      const { dx: ldx, dy: ldy, dist: ld } = warpDelta(p.x, p.y, lockedT.x, lockedT.y);
      dirX = ldx / ld; dirY = ldy / ld;
    }

    gs.projectiles.push({
      x: p.x, y: p.y,
      vx: dirX * focusSpd, vy: dirY * focusSpd,
      damage: focusDmg,
      radius: 9,
      life: focusRange / (focusSpd * 60),
      color: col,
      teamId: p.teamId,
      isAutoAttack: false,
      isFocusShot: true, // damages obstacles for 2hp instead of 1
      stun: 0, freeze: 0, slow: 0.4, silence: 0, knockback: 0,
      kbDirX: dirX, kbDirY: dirY,
      casterStats: p.stats, casterRef: p,
    });

    showFloatText(p.x, p.y - 45, 'FOCUS!', col, p);
    gs.effects.push({ x:p.x, y:p.y, r:0, maxR:30, life:0.2, maxLife:0.2, color:col, elem:p.hero?.id });
    p.facing = dirX > 0 ? 1 : -1;
  }
}

function castAbility(caster, idx, target, gs) {
  const ab = caster.hero.abilities[idx];
  caster.mana -= ab.manaCost;
  const cdrMult = (1 - Math.min(0.40, (caster.stats?.cdr ?? 0) / 100)) * (caster.weatherCooldownMult ?? 1);
  caster.cooldowns[idx] = +(ab.cd * cdrMult).toFixed(2);
  const casterTeam = caster.teamId;
  if (caster.isPlayer) Audio.sfx.ability(caster.hero.id, idx);

  // ── PASSIVE: flat damage bonus on cast (EMBER Ignition / VOID Shadow Strike / VOLT Static) ──
  // GALE is intentionally excluded here — its onAbilityCast returns a range/speed multiplier,
  // not a flat damage bonus. It is handled separately below.
  let _passiveAbBonus = 0;
  if (PASSIVES[caster.hero?.id]?.onAbilityCast && caster.hero.id !== 'wind') {
    _passiveAbBonus = PASSIVES[caster.hero.id].onAbilityCast(caster, ab);
  }
  // Track last ability index for MYST Arcane Echo
  // _castId increments on every cast so the echo guard can distinguish multi-kills
  caster._lastAbIdx = idx;
  caster._castId = (caster._castId ?? 0) + 1;

  // ── PASSIVE: GALE Tailwind — speed/range multiplier (single call, correct variable) ──
  let _tailwindMult = 1.0;
  if (caster.hero?.id === 'wind') {
    _tailwindMult = PASSIVES.wind.onAbilityCast(caster, ab);
  }

  const tx = target ? target.x : caster.x + caster.facing*200;
  const ty = target ? target.y : caster.y;
  const { dx, dy } = target
    ? warpDelta(caster.x, caster.y, target.x, target.y)
    : { dx: tx - caster.x, dy: ty - caster.y };
  const d = Math.sqrt(dx*dx+dy*dy)||1;

  // Range multiplier: combat class × weather × tailwind
  const classMult = COMBAT_CLASS[caster.combatClass]?.rangeMult ?? 1.0;
  const rangeMult = classMult * (caster.weatherRangeMult ?? 1) * _tailwindMult;

  const spd = ab.type==='projectile' ? (ab.projSpeed ?? 7.0) * _tailwindMult : 0;
  const color = caster.hero.color;
  const allChars = gs._allChars ?? [gs.player, ...gs.enemies];

  if (ab.type === 'projectile') {
    const count = idx===2?3:1;
    for(let i=0;i<count;i++) {
      const spread = (i-Math.floor(count/2))*0.15;
      // _passiveAbBonus is flat (not AP-scaled) — stored in proj for post-AP addition in applyHit
      gs.projectiles.push({ x:caster.x, y:caster.y, vx:(dx/d+spread)*spd, vy:(dy/d+spread)*spd,
        damage:ab.damage, flatBonus: (_passiveAbBonus > 0 && i===0 ? _passiveAbBonus : 0), radius:8+(idx===2?4:0), life:(ab.range*rangeMult)/(spd*60),
        color, teamId: casterTeam,
        isUlt: idx === 2,
        stun: ab.cc&&ab.cc.type==='stun' ? ab.cc.duration : 0,
        freeze: ab.cc&&ab.cc.type==='root' ? ab.cc.duration : 0,
        slow: ab.cc&&ab.cc.type==='slow' ? ab.cc.duration : 0,
        silence: ab.cc&&ab.cc.type==='silence' ? ab.cc.duration : 0,
        knockback: ab.cc&&ab.cc.type==='knockback' ? ab.cc.duration : 0,
        kbDirX: dx, kbDirY: dy,
        heal:ab.type==='heal', piercing:idx===2&&caster.hero.id==='lightning',
        casterStats: caster.stats, casterRef: caster });
    }
  }
  if (ab.type === 'aoe' || ab.type === 'heal') {
    const range = ab.range * 1.1 * rangeMult;
    const tgts = friendlyFire
      ? allChars.filter(c => c !== caster)
      : allChars.filter(c => c.teamId !== casterTeam);
    tgts.forEach(t => {
      if(!t.alive) return;
      if(dist2(caster,t) < range*range) {
        const hitObj = {damage:ab.damage, flatBonus:_passiveAbBonus, color, teamId: casterTeam, radius:0,
          stun: ab.cc&&ab.cc.type==='stun' ? ab.cc.duration : 0,
          freeze: ab.cc&&ab.cc.type==='root' ? ab.cc.duration : 0,
          slow: ab.cc&&ab.cc.type==='slow' ? ab.cc.duration : 0,
          silence: ab.cc&&ab.cc.type==='silence' ? ab.cc.duration : 0,
          knockback: ab.cc&&ab.cc.type==='knockback' ? ab.cc.duration : 0,
          pull: ab.cc&&ab.cc.type==='pull' ? ab.cc.duration : 0,
          kbDirX: t.x-caster.x, kbDirY: t.y-caster.y,
          heal: ab.type==='heal',
          casterStats: caster.stats, casterRef: caster};
        applyHit(t, hitObj, gs);
      }
    });
    if (ab.healAmt) {
      caster.hp = Math.min(caster.maxHp, caster.hp + ab.healAmt);
      showFloatText(caster.x, caster.y-40, `+${ab.healAmt} HEAL`, '#44ff88', caster);
      // ── PASSIVE: FLORA — Overgrowth ──
      PASSIVES[caster.hero?.id]?.onHeal?.(caster, ab.healAmt, gs);
    }
    if (ab.type==='heal') {
      caster.hp = Math.min(caster.maxHp, caster.hp + Math.abs(ab.damage));
      showFloatText(caster.x, caster.y-40, `+${Math.abs(ab.damage)}`, '#44ff88', caster);
    }
    gs.effects.push({x:caster.x,y:caster.y,r:0,maxR:range,life:0.4,maxLife:0.4,color,ring:true,elem:caster.hero?.id});

    // ── TIDE mechanic twist — Whirlpool (idx 1) leaves a persistent pull zone ──
    if (caster.hero?.id === 'water' && idx === 1) {
      gs.hazards.push({
        type: 'whirlpool', x: caster.x, y: caster.y,
        radius: 160, dps: 12, pull: 3.5,
        life: 3.0, maxLife: 3.0,
        teamId: caster.teamId, ownerRef: caster,
      });
    }
  }
  if (ab.type === 'dash') {
    const dashDist = Math.min(ab.range, d);
    const dirX = dx / d, dirY = dy / d;
    // Step-trace the dash so it stops at the first obstacle in its path —
    // prevents dashes from phasing through cover.
    const STEP = caster.radius * 0.8;
    const steps = Math.ceil(dashDist / STEP);
    let traveled = 0;
    let blocked = false;
    for (let s = 1; s <= steps && !blocked; s++) {
      const stepDist = Math.min(s * STEP, dashDist);
      const nx = caster.x + dirX * stepDist;
      const ny = caster.y + dirY * stepDist;
      if (gs.obstacles) {
        for (const ob of gs.obstacles) {
          const odx = nx - ob.x, ody = ny - ob.y;
          if (odx*odx + ody*ody < (ob.size + caster.radius) * (ob.size + caster.radius)) {
            traveled = Math.max(0, stepDist - STEP);
            blocked = true;
            ob.vx = (ob.vx ?? 0) + dirX * 8;
            ob.vy = (ob.vy ?? 0) + dirY * 8;
            break;
          }
        }
      }
      if (!blocked) traveled = stepDist;
    }
    caster.x += dirX * traveled;
    caster.y += dirY * traveled;
    caster.x = clamp(caster.x, caster.radius, gs.W - caster.radius);
    caster.y = clamp(caster.y, caster.radius, gs.H - caster.radius);
    if (target && dist2(caster, target) < 50*50) {
      applyHit(target, {damage:ab.damage, flatBonus:_passiveAbBonus, color, teamId:casterTeam, radius:0, cc:ab.cc, caster}, gs);
      // ── PASSIVE: GALE — Windrunner (dash hit refunds sprint cd) ──
      PASSIVES[caster.hero?.id]?.onDashHit?.(caster);
    }
    gs.effects.push({x:caster.x, y:caster.y, r:0, maxR:60, life:0.3, maxLife:0.3, color, elem:caster.hero?.id});
  }
  if (ab.type === 'line') {
    // Stagger 6 projectiles over ~400ms using a frame-delay queue (not setTimeout)
    // so timing is frame-rate accurate and shots always fire from caster's live position
    gs._pendingShots = gs._pendingShots ?? [];
    for (let i = 0; i < 6; i++) {
      gs._pendingShots.push({
        delay: i * 0.067, // ~67ms between shots → 400ms total spread
        casterRef: caster,
        teamId: casterTeam,
        damage: Math.floor(ab.damage / 3),
        dx, dy, d,
        rangeMult,
        color,
      });
    }
  }
}


