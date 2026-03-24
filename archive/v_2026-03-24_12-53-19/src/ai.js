// ========== AI ==========
// (warpDelta and warpDist2 live in controls.js — loaded before ai.js in build order)
function updateAI(e, gs, dt) {
  if (!e.alive) {
    e.respawnTimer -= dt;
    if (e.respawnTimer <= 0) respawnChar(e, gs);
    return;
  }
  // Tutorial mode — dummies stand still, never attack
  if (gs?.isTutorial) {
    e.velX = 0; e.velY = 0;
    e.vx = 0; e.vy = 0;
    e.autoAtkTimer = 99;
    for (let i = 0; i < 3; i++) e.cooldowns[i] = 99;
    // Restore immortal dummy HP if damaged
    if (e._tutorialImmortal && e.hp < e.maxHp) { e.hp = e.maxHp; }
    return;
  }
  e.stunned  = Math.max(0, e.stunned - dt);
  const _prevFrozen = e.frozen;
  e.frozen   = Math.max(0, e.frozen  - dt);
  // ── FROST — thaw-root when freeze expires ──
  if (_prevFrozen > 0 && e.frozen <= 0 && (e._frozenByFrost ?? false)) {
    e._frozenByFrost = false;
    e.ccedTimer = Math.max(e.ccedTimer ?? 0, 0.5);
    if (!e._baseSpeed) e._baseSpeed = e.speed;
    e.speed = e._baseSpeed * 0.55;
    spawnFloat(e.x, e.y - 30, 'THAW LOCK', '#88ddff', { char: e });
  }
  if ((e.spawnInvuln ?? 0) > 0) e.spawnInvuln = Math.max(0, e.spawnInvuln - dt);
  e.mana     = Math.min(e.maxMana, e.mana + (e.stats?.manaRegen ?? 3) * dt);
  // Heal-over-time from health packs
  if (e.healRemaining > 0 && e.healDuration > 0) {
    const tick = Math.min(e.healRemaining, (e.healRemaining / e.healDuration) * dt);
    e.hp = Math.min(e.maxHp, e.hp + tick);
    e.healRemaining -= tick;
    e.healDuration   = Math.max(0, e.healDuration - dt);
    if (e.healDuration <= 0) e.healRemaining = 0;
  }
  for (let i = 0; i < 3; i++) e.cooldowns[i] = Math.max(0, e.cooldowns[i] - dt);
  e.autoAtkTimer = Math.max(0, (e.autoAtkTimer ?? 0) - dt);
  e.animTick += dt;
  // ── New mechanic timers ──
  if (e.ccedTimer    > 0) {
    e.ccedTimer = Math.max(0, e.ccedTimer - dt);
    if (e.ccedTimer <= 0 && e._baseSpeed && e.speed < e._baseSpeed) e.speed = e._baseSpeed;
  }
  if (e.weaveWindow  > 0) e.weaveWindow  = Math.max(0, e.weaveWindow  - dt);
  if (e.momentumTimer > 0) {
    e.momentumTimer = Math.max(0, e.momentumTimer - dt);
    if (e.momentumTimer <= 0) e.momentumStacks = 0;
  }
  // ── Flee / re-engage cooldown timer (hard only) ──
  if ((e._reengageTimer ?? 0) > 0) e._reengageTimer = Math.max(0, e._reengageTimer - dt);
  // ── Passive tick ──
  PASSIVES[e.hero?.id]?.onTick?.(e, dt, gs);

  // ── Shadow Corruption DoT (Void passive on auto hit) ──
  if ((e._shadowCorruptTimer ?? 0) > 0) {
    e._shadowCorruptTimer -= dt;
    e.hp = Math.max(0, e.hp - e._shadowCorruptDps * dt);
    if (e._shadowCorruptTimer <= 0) {
      if ((e._shadowCorruptSilence ?? 0) > 0) {
        e.silenced = Math.max(e.silenced ?? 0, e._shadowCorruptSilence);
        e.ccedTimer = Math.max(e.ccedTimer ?? 0, e._shadowCorruptSilence);
        spawnFloat(e.x, e.y - 40, 'CORRUPTED', '#8844cc', { char: e });
      }
      e._shadowCorruptDps = 0;
    }
    if (e.hp <= 0 && e.alive) {
      const caster = e._shadowCorruptCaster;
      killChar(e, caster?.isPlayer ?? false, gs, caster);
    }
  }

  const allChars = [...(gs.players ?? [gs.player]), ...gs.enemies];
  const enemies = allChars.filter(c => c.alive && c.teamId !== e.teamId);
  if (!enemies.length) return;
  if (e.stunned > 0 || e.frozen > 0) return;
  if (e.silenced > 0) e.silenced = Math.max(0, e.silenced - dt);

  // ── Spawn invulnerability — hold position, skip all combat ───────────
  if ((e.spawnInvuln ?? 0) > 0) {
    // Gentle drift toward arena center so bot isn't stationary at spawn edge
    const cx = gs.W / 2, cy = gs.H / 2;
    const toCx = cx - e.x, toCy = cy - e.y;
    const toCd = Math.hypot(toCx, toCy) || 1;
    if (toCd > 120) {
      const spd = e.speed * 0.6 * (e.weatherSpeedMult ?? 1);
      const alpha = Math.min(1, dt / 0.3);
      e.velX = (e.velX ?? 0) + ((toCx / toCd) * spd - (e.velX ?? 0)) * alpha;
      e.velY = (e.velY ?? 0) + ((toCy / toCd) * spd - (e.velY ?? 0)) * alpha;
      e.x += e.velX; e.y += e.velY;
      warpChar(e, gs.W, gs.H);
      resolveObstacleCollisions(e, gs);
      e.vx = e.velX; e.vy = e.velY;
    }
    return; // no combat, no abilities, no autos while invulnerable
  }

  // ── Difficulty config ──────────────────────────────────────────────────
  const diff = aiDifficulty || 'normal';

  // Passive mode: bot stands still and does nothing — for testing
  if (diff === 'passive') {
    e.velX = 0; e.velY = 0;
    e.vx   = 0; e.vy   = 0;
    return;
  }

  const cfg = {
    easy:   {
      warpAware: false, reactionMin: 2.0, reactionMax: 3.2, rangeMult: 0.80,
      kite: false, abilityMode: 'random', autoChance: 0.15,
      strafeStrength: 0.10, strafePeriod: 2.2, dodgeChance: 0.00,
      packSeekHpPct: 0, packSeekRange: 0, packOpportunistic: false,
      fleeHpPct: 0, manaReserve: 0, targetMode: 'nearest',
      reengageCooldown: 0, roamRadius: 300,
      warpGateUse: 'none',
      fleeMode: 'none',         // never retreats
      fleeReengageHp: 0,
    },
    normal: {
      warpAware: true,  reactionMin: 0.8, reactionMax: 1.6, rangeMult: 1.00,
      kite: true, abilityMode: 'damage', autoChance: 0.45,
      strafeStrength: 0.30, strafePeriod: 1.6, dodgeChance: 0.20,
      packSeekHpPct: 0.40, packSeekRange: 600, packOpportunistic: false,
      fleeHpPct: 0.25, manaReserve: 0.15, targetMode: 'killshot',
      reengageCooldown: 0, roamRadius: 180,
      warpGateUse: 'reactive',
      fleeMode: 'retreat',      // maintain distance, circle, strong center pull
      fleeTargetDist: 420,      // desired distance from enemy during retreat
      fleeCenterPull: 0.55,     // how strongly to pull toward center while fleeing
      fleeReengageHp: 0.42,     // re-engage when HP recovers to this fraction
    },
    hard:   {
      warpAware: true,  reactionMin: 0.2, reactionMax: 0.6, rangeMult: 1.15,
      kite: true, abilityMode: 'optimal', autoChance: 0.85,
      strafeStrength: 0.55, strafePeriod: 1.1, dodgeChance: 0.45,
      packSeekHpPct: 0.55, packSeekRange: 1200, packOpportunistic: true,
      fleeHpPct: 0.28, manaReserve: 0.20, targetMode: 'threat',
      reengageCooldown: 0.8, roamRadius: 80,
      warpGateUse: 'strategic',
      fleeMode: 'tactical',     // kite-retreat above 20% HP, full disengage below
      fleeTargetDist: 500,
      fleeCenterPull: 0.65,
      fleeReengageHp: 0.42,     // hard bots re-engage at same threshold as normal
      fleeCriticalHp: 0.20,     // below this = full disengage to safe quadrant
    },
  }[diff];

  // ── Apply personality modifiers ───────────────────────────────────────
  // Each AI has a randomized personality that shifts their flee threshold
  // and aggression, making matches feel different each time.
  const personality = e.personality;
  if (personality && cfg.fleeHpPct > 0) {
    cfg.fleeHpPct = Math.min(0.85, cfg.fleeHpPct * personality.fleeHpMult);
  } else if (personality && personality.fleeHpMult === 0) {
    cfg.fleeHpPct = 0; // berserker — never flees regardless of base config
  }
  if (personality) {
    cfg.strafeStrength = Math.min(0.9, cfg.strafeStrength * personality.aggrMult);
    cfg.autoChance     = Math.min(1.0, cfg.autoChance     * personality.aggrMult);
  }

  // ── Init movement state on first tick ────────────────────────────────
  if (e.velX === undefined) { e.velX = 0; e.velY = 0; }
  if (e.aiState === undefined) e.aiState = 'chase';
  if (e.aiTimer === undefined) e.aiTimer = cfg.reactionMin + Math.random() * (cfg.reactionMax - cfg.reactionMin);

  // ── Warp-aware delta to nearest enemy (used as fallback) ─────────────
  const nearestEnemy = enemies.reduce((best, c) =>
    warpDist2(e.x, e.y, c.x, c.y) < warpDist2(e.x, e.y, best.x, best.y) ? c : best
  );

  // ── TARGET SELECTION (feature 3) ──────────────────────────────────────
  let target = nearestEnemy;
  if (cfg.targetMode === 'killshot') {
    // Normal: switch to a low-HP enemy in attack range if killable
    const attackRange0 = 180 * (COMBAT_CLASS[e.combatClass]?.rangeMult ?? 1.0) * cfg.rangeMult;
    const killable = enemies.filter(c =>
      c.hp / c.maxHp < 0.20 && warpDist2(e.x, e.y, c.x, c.y) < attackRange0 * attackRange0
    );
    if (killable.length) target = killable.reduce((b, c) => c.hp < b.hp ? c : b);
  } else if (cfg.targetMode === 'threat') {
    // Hard: hunt lowest-HP in range first, else nearest attacker, else nearest
    const attackRange0 = 180 * (COMBAT_CLASS[e.combatClass]?.rangeMult ?? 1.0) * cfg.rangeMult;
    const inRange = enemies.filter(c => warpDist2(e.x, e.y, c.x, c.y) < attackRange0 * attackRange0 * 2.25);
    if (inRange.length) {
      target = inRange.reduce((b, c) => (c.hp / c.maxHp) < (b.hp / b.maxHp) ? c : b);
    }
    // Respond to attacker: if someone just damaged us and is in range, target them
    if (e._lastAttackerId) {
      const attacker = allChars.find(c => c.alive && c.hero?.id === e._lastAttackerId && c.teamId !== e.teamId);
      if (attacker && warpDist2(e.x, e.y, attacker.x, attacker.y) < attackRange0 * attackRange0 * 4) {
        target = attacker;
      }
      e._lastAttackerId = null;
    }
  }
  if (!target?.alive) target = nearestEnemy;

  // ── Delta to target ───────────────────────────────────────────────────
  let dx, dy, dist;
  if (cfg.warpAware) {
    ({ dx, dy, dist } = warpDelta(e.x, e.y, target.x, target.y));
  } else {
    dx = target.x - e.x; dy = target.y - e.y;
    dist = Math.sqrt(dx*dx + dy*dy) || 1;
  }

  const attackRange = 180 * (COMBAT_CLASS[e.combatClass]?.rangeMult ?? 1.0) * cfg.rangeMult;

  e.aiTimer -= dt;

  // ── HEALTH PACK SEEKING (feature 1) ───────────────────────────────────
  // Evaluate before movement — overrides aiState if a pack should be sought
  if (e.aiState === undefined) e.aiState = 'chase';
  const hpFrac = e.hp / e.maxHp;

  let packTarget = null;
  if (cfg.packSeekHpPct > 0 && gs.items?.length) {
    const packs = gs.items.filter(i => i.type === 'healthpack');
    for (const pack of packs) {
      const pd2 = warpDist2(e.x, e.y, pack.x, pack.y);
      const inSeekRange = pd2 < cfg.packSeekRange * cfg.packSeekRange;
      const opportunistic = cfg.packOpportunistic && pd2 < 200 * 200;
      if ((hpFrac < cfg.packSeekHpPct && inSeekRange) || opportunistic) {
        if (!packTarget || pd2 < warpDist2(e.x, e.y, packTarget.x, packTarget.y)) {
          packTarget = pack;
        }
      }
    }
  }

  // Mana pack seeking — only if no health pack already targeted, and HP is safe
  const manaFrac = (e.mana ?? 0) / (e.maxMana ?? 100);
  if (!packTarget && hpFrac > cfg.fleeHpPct + 0.15 && gs.items?.length) {
    const manaPacks = gs.items.filter(i => i.type === 'manapack');
    for (const pack of manaPacks) {
      const pd2 = warpDist2(e.x, e.y, pack.x, pack.y);
      const wantsIt = manaFrac < 0.30 && pd2 < cfg.packSeekRange * cfg.packSeekRange;
      const opportunistic = cfg.packOpportunistic && pd2 < 200 * 200;
      if (wantsIt || opportunistic) {
        if (!packTarget || pd2 < warpDist2(e.x, e.y, packTarget.x, packTarget.y)) {
          packTarget = pack;
        }
      }
    }
  }

  // Flee always wins over item seeking — don't chase packs while being hunted
  const shouldFlee = cfg.fleeHpPct > 0 && cfg.fleeMode !== 'none' && hpFrac < cfg.fleeHpPct;
  if (packTarget && shouldFlee) {
    // Only allow health pack seeking during flee if it's very close (opportunistic grab)
    const pd2 = warpDist2(e.x, e.y, packTarget.x, packTarget.y);
    if (pd2 > 150 * 150) packTarget = null; // too far — flee first, pack can wait
  }

  if (packTarget) {
    // Route toward the pack — override normal movement state
    e.aiState = 'seek_item';
    const { dx: pdx, dy: pdy, dist: pd } = warpDelta(e.x, e.y, packTarget.x, packTarget.y);
    const spd = e.speed * 2.2 * (e.weatherSpeedMult ?? 1);
    // Obstacle avoidance for pack-seek path
    let psAvoidX = 0, psAvoidY = 0;
    if (gs.obstacles?.length) {
      const lk = e.speed * 2.8 + 80;
      for (const ob of gs.obstacles) {
        const odx = e.x - ob.x, ody = e.y - ob.y;
        const odist = Math.hypot(odx, ody) || 1;
        if (odist < ob.size + e.radius + lk) {
          const s = Math.pow(1 - odist / (ob.size + e.radius + lk), 2);
          psAvoidX += (odx / odist) * s;
          psAvoidY += (ody / odist) * s;
        }
      }
      const am = Math.hypot(psAvoidX, psAvoidY);
      if (am > 0) { psAvoidX = (psAvoidX/am)*e.speed*1.4; psAvoidY = (psAvoidY/am)*e.speed*1.4; }
    }
    const alpha2 = Math.min(1, dt / 0.14);
    e.velX += (pdx/pd * spd + psAvoidX - e.velX) * alpha2;
    e.velY += (pdy/pd * spd + psAvoidY - e.velY) * alpha2;
    e.x += e.velX; e.y += e.velY;
    warpChar(e, gs.W, gs.H);
    resolveObstacleCollisions(e, gs);
    e.vx = e.velX; e.vy = e.velY;
    // Still auto-attack while routing if target is in range
    if (e.autoAtkTimer <= 0 && dist < attackRange && Math.random() < cfg.autoChance && !e.silenced) {
      const atkSpd = e.stats?.atkSpeed ?? 1.0;
      e.autoAtkTimer = 1 / atkSpd;
      const _autoMult = e.combatClass === 'melee' ? 0.65 : e.combatClass === 'hybrid' ? 0.75 : 0.52;
      const autoDmg = Math.round((e.stats?.damage ?? 60) * _autoMult);
      const { dx: adx, dy: ady, dist: ad } = safeAimDelta(e.x, e.y, target.x, target.y, gs);
      gs.projectiles.push({
        x: e.x, y: e.y, vx: (adx/ad)*9, vy: (ady/ad)*9,
        damage: autoDmg, radius: 5, life: attackRange/(9*60),
        color: e.hero.color, teamId: e.teamId, isAutoAttack: true,
        stun:0, freeze:0, slow:0, silence:0, knockback:0,
        kbDirX: adx, kbDirY: ady, casterStats: e.stats, casterRef: e,
      });
    }
    // Stuck detection — if seeking for >3s without getting close, give up
    e._seekTimer = (e._seekTimer ?? 0) + dt;
    if (e._seekTimer > 3.0) { e.aiState = 'chase'; e._seekTimer = 0; packTarget = null; }
    return; // skip rest of movement/ability logic this tick
  } else if (e.aiState === 'seek_item') {
    // Pack is gone or gave up — resume normal AI
    e.aiState = 'chase';
    e._seekTimer = 0;
  }

  // ── LOW HP DISENGAGE ──────────────────────────────────────────────────
  // Checked every frame — not gated behind aiTimer so AI reacts immediately
  const canFlee = cfg.fleeHpPct > 0 && cfg.fleeMode !== 'none' && e.combatClass !== 'melee';
  const wantsToFlee = canFlee && hpFrac < cfg.fleeHpPct && (e._reengageTimer ?? 0) <= 0;

  // Hard: also check cooldown state before re-engaging
  const allCooldownsDry = diff === 'hard' &&
    e.cooldowns.every(cd => cd > 0) &&
    e.mana / e.maxMana < cfg.manaReserve + 0.10;

  // Determine flee sub-mode for hard: kite-retreat vs full disengage
  const isCriticalHp = diff === 'hard' && hpFrac < (cfg.fleeCriticalHp ?? 0.20);
  e._fleeSubMode = isCriticalHp ? 'disengage' : 'retreat';

  if (wantsToFlee || (diff === 'hard' && e.aiState === 'flee' && allCooldownsDry)) {
    if (e.aiState !== 'flee') e.aiTimer = 0;
    e.aiState = 'flee';
  } else if (e.aiState === 'flee') {
    // Re-engage once HP has recovered enough
    const reengageHp = cfg.fleeReengageHp ?? cfg.fleeHpPct + 0.15;
    const hpRecovered = hpFrac >= reengageHp;
    if (hpRecovered && (e._reengageTimer ?? 0) <= 0) {
      if (diff === 'hard') e._reengageTimer = cfg.reengageCooldown;
      e.aiState = 'chase';
    }
  }

  // ── Strafe / dodge timer ───────────────────────────────────────────────
  if (e._strafeTimer === undefined) { e._strafeTimer = Math.random() * cfg.strafePeriod; e._strafeDir = 1; }
  e._strafeTimer -= dt;
  if (e._strafeTimer <= 0) {
    e._strafeTimer = cfg.strafePeriod * (0.7 + Math.random() * 0.6);
    e._strafeDir = Math.random() < 0.5 ? 1 : -1;
    // Hard AI adds random micro-flips so the pattern isn't readable
    if (diff === 'hard') {
      e._strafeTimer *= 0.6 + Math.random() * 0.8; // irregular timing
      if (Math.random() < 0.4) e._strafeDir *= -1;
    }
  }

  // Dodge incoming projectiles (normal/hard)
  if (cfg.dodgeChance > 0) {
    for (const proj of gs.projectiles) {
      if (proj.teamId === e.teamId) continue;
      const pdx = e.x - proj.x, pdy = e.y - proj.y;
      const pd = Math.sqrt(pdx*pdx+pdy*pdy);
      if (pd > 180) continue;
      const closing = proj.vx*(e.x-proj.x) + proj.vy*(e.y-proj.y);
      if (closing > 0 && Math.random() < cfg.dodgeChance * dt * 6) {
        e._strafeDir *= -1;
        e._strafeTimer = cfg.strafePeriod * (0.3 + Math.random() * 0.4);
        break;
      }
    }
  }

  // ── Roam toward centre when no enemies nearby ─────────────────────────
  // Prevents AI from standing idle — keeps pressure on and makes the arena
  // feel active. Roam radius scales with difficulty (easy wanders, hard hunts).
  const noEnemiesNearby = dist > attackRange * 3;
  if (noEnemiesNearby && cfg.roamRadius && e.aiState === 'chase') {
    const cx = gs.W / 2, cy = gs.H / 2;
    const toCx = cx - e.x, toCy = cy - e.y;
    const toCd = Math.hypot(toCx, toCy) || 1;
    // Only roam if not already near centre
    if (toCd > cfg.roamRadius) {
      // Stuck detection — if barely moving for >1s, add random nudge to break free
      e._roamStuckTimer = (e._roamStuckTimer ?? 0) + dt;
      const vel = Math.hypot(e.velX ?? 0, e.velY ?? 0);
      if (vel < 0.3) {
        if (e._roamStuckTimer > 0.8) {
          // Random nudge to break obstacle lock
          e.velX = (Math.random() - 0.5) * e.speed * 3;
          e.velY = (Math.random() - 0.5) * e.speed * 3;
          e._roamStuckTimer = 0;
        }
      } else {
        e._roamStuckTimer = 0;
      }
      const roamSpd = e.speed * 1.2 * (e.weatherSpeedMult ?? 1);
      const alpha3 = Math.min(1, dt / 0.2);
      e.velX = (e.velX ?? 0) + ((toCx / toCd) * roamSpd - (e.velX ?? 0)) * alpha3;
      e.velY = (e.velY ?? 0) + ((toCy / toCd) * roamSpd - (e.velY ?? 0)) * alpha3;
      e.x += e.velX; e.y += e.velY;
      warpChar(e, gs.W, gs.H);
      resolveObstacleCollisions(e, gs);
      e.vx = e.velX; e.vy = e.velY;
      // Don't return — still fall through to auto-attack and ability logic
    }
  }

  // ── Movement state machine ────────────────────────────────────────────
  // Class-aware engagement ranges
  const meleeEngageRange  = attackRange * 0.85;  // melee wants to be close
  const rangedIdealRange  = attackRange * 0.80;  // ranged optimal firing distance
  const rangedPanicRange  = attackRange * 0.30;  // ranged backs away if enemy inside this
  const hybridComboRange  = attackRange * 0.50;  // hybrid closes for auto chain
  const hybridAbilRange   = attackRange * 0.85;  // hybrid backs to this for abilities

  if (e.aiState !== 'flee') {
    if (e.combatClass === 'melee') {
      // Melee: always close, never kite — just chase or hold at point-blank
      if (e.aiState === 'kite') e.aiState = 'hold';
      if (e.aiState === 'chase' && dist <= meleeEngageRange) e.aiState = 'hold';
      if (e.aiState === 'hold'  && dist > meleeEngageRange * 1.1) e.aiState = 'chase';
    } else if (e.combatClass === 'ranged') {
      // Ranged: maintain ideal range, back away if enemy too close
      if (e.aiState === 'chase' && dist <= rangedIdealRange)       e.aiState = 'hold';
      if (e.aiState === 'hold'  && dist > rangedIdealRange * 1.05) e.aiState = 'chase';
      if ((e.aiState === 'hold' || e.aiState === 'chase') && dist < rangedPanicRange && cfg.kite) e.aiState = 'kite';
      if (e.aiState === 'kite'  && dist >= rangedPanicRange * 1.4) e.aiState = 'hold';
    } else {
      // Hybrid: close for auto chain, pull back for abilities
      if (e.aiState === 'chase' && dist <= hybridComboRange)       e.aiState = 'hold';
      if (e.aiState === 'hold'  && dist > hybridAbilRange * 1.05)  e.aiState = 'chase';
      if (e.aiState === 'hold'  && dist < attackRange * 0.40 && cfg.kite) e.aiState = 'kite';
      if (e.aiState === 'kite'  && dist >= hybridComboRange * 1.2) e.aiState = 'hold';
    }
  }

  const toTx = dx / dist, toTy = dy / dist;
  const strafeX = -toTy * e._strafeDir;
  const strafeY =  toTx * e._strafeDir;

  // Low HP melee behaviour — desperate charge (unchanged for melee)
  const lowHp = hpFrac < 0.30 && e.combatClass === 'melee';

  // ── Gate-aware routing ─────────────────────────────────────────────────
  // ── Gate / warp awareness — scaled by difficulty ───────────────────────
  //
  // Easy:   No awareness. Walls are walls.
  // Normal: Reactive — steer to nearest gate when near edge on chase/flee.
  //         On flee: actively route through a gate to shake pursuit.
  // Hard:   Strategic — evaluate warp shortcut vs direct path each tick.
  //         On chase: use gates to flank or close distance faster.
  //         On flee:  sprint through nearest gate, then re-evaluate.
  //         Remembers which gate it committed to until through or situation changes.

  // Helper: find the best open gate on a given edge, returns world-space {x,y} or null
  function _bestGateOnEdge(edgeIdx, b, gateSize) {
    const edgeGates = gs.gates[edgeIdx];
    if (!edgeGates?.length) return null;
    const horiz = (edgeIdx === 0 || edgeIdx === 2);
    const edgeLen = horiz ? b.w : b.h;
    const halfGate = (gateSize / edgeLen) / 2;
    let best = null, bestD = Infinity;
    for (const g of edgeGates) {
      if (g.pos - halfGate < 0.01 || g.pos + halfGate > 0.99) continue; // skip corner-clipped
      const wx = horiz ? b.x + g.pos * b.w : (edgeIdx === 3 ? b.x : b.x2);
      const wy = horiz ? (edgeIdx === 0 ? b.y : b.y2) : b.y + g.pos * b.h;
      const d = Math.hypot(e.x - wx, e.y - wy);
      if (d < bestD) { bestD = d; best = { x: wx, y: wy, dist: d }; }
    }
    return best;
  }

  // Helper: estimate travel distance going through a specific warp gate
  // (distance to gate entry + distance from exit to target)
  function _warpRouteDist(gateEntry, exitEdgeIdx, targetX, targetY, b, gateSize) {
    const toGate = Math.hypot(e.x - gateEntry.x, e.y - gateEntry.y);
    // Exit lands on opposite edge — pick nearest gate there too
    const exitGate = _bestGateOnEdge(exitEdgeIdx, b, gateSize);
    if (!exitGate) return Infinity;
    const fromExit = Math.hypot(exitGate.x - targetX, exitGate.y - targetY);
    return toGate + fromExit;
  }

  function _gateWaypoint() {
    if (!gs.gates) return null;
    const b = getArenaBounds(gs);
    const progress = Math.min(1, gs.time / MATCH_DURATION);
    const gateSize = GATE_SIZE_BASE - (GATE_SIZE_BASE - GATE_SIZE_MIN) * progress;
    const EDGE_THRESH = 100;

    // ── EASY: no gate awareness ─────────────────────────────────────────
    if (!cfg.warpAware) return null;

    // ── HARD: strategic evaluation ──────────────────────────────────────
    if (diff === 'hard') {
      if (!e._gateStrategy) e._gateStrategy = { waypoint: null, timer: 0, state: null };
      const gs2 = e._gateStrategy;

      // Clear committed waypoint if we just warped (don't chain immediately)
      if (gs2.waypoint && !warpReady && warpCdRemaining > WARP_CD - 0.3) {
        gs2.waypoint = null;
      }

      // Only re-evaluate when warp is ready — no point planning a warp route on CD
      if (warpReady) {
        gs2.timer -= dt;
        if (gs2.timer <= 0 || gs2.state !== e.aiState) {
          gs2.timer = 0.4 + Math.random() * 0.4;
          gs2.state = e.aiState;
          gs2.waypoint = null;

          if (e.aiState === 'flee') {
            // Flee: find the gate that maximises distance from ALL nearby enemies
            let bestGate = null, bestScore = -Infinity;
            const EDGES = [0,1,2,3];
            for (const ei of EDGES) {
              const g = _bestGateOnEdge(ei, b, gateSize);
              if (!g) continue;
              const distToUs = g.dist;
              const minDistToEnemy = enemies.reduce((min, en) =>
                Math.min(min, Math.hypot(en.x - g.x, en.y - g.y)), Infinity);
              const score = minDistToEnemy - distToUs * 0.8;
              if (score > bestScore) { bestScore = score; bestGate = g; }
            }
            // Only commit if gate is reachable before target arrives
            if (bestGate && bestGate.dist < 400) {
              const travelTime = bestGate.dist / (e.speed * 2.2);
              const enemyArrivalTime = Math.hypot(nearestEnemy.x - bestGate.x, nearestEnemy.y - bestGate.y) / ((nearestEnemy.speed ?? 4) * 2.0);
              if (travelTime < enemyArrivalTime + 0.5) gs2.waypoint = bestGate;
            }
          } else if (e.aiState === 'chase') {
            // Chase: compare direct dist vs best warp route
            const directDist = dist;
            const PAIRS = [[0,2],[2,0],[1,3],[3,1]];
            let bestWarpDist = Infinity, bestEntry = null;
            for (const [entryEdge, exitEdge] of PAIRS) {
              const entry = _bestGateOnEdge(entryEdge, b, gateSize);
              if (!entry) continue;
              const warpDist = _warpRouteDist(entry, exitEdge, target.x, target.y, b, gateSize);
              // Only warp if meaningfully shorter AND gate is reachable in reasonable time
              const travelTime = entry.dist / (e.speed * 2.2);
              if (warpDist < directDist * 0.80 && warpDist < bestWarpDist && directDist > 350 && travelTime < 2.5) {
                bestWarpDist = warpDist; bestEntry = entry;
              }
            }
            if (bestEntry) gs2.waypoint = bestEntry;
          }
        }
      } else {
        // Warp on CD — pause the re-evaluation timer, keep any existing waypoint null
        gs2.waypoint = null;
      }
      // If we have a committed waypoint, check if we've passed through (near exit side)
      if (gs2.waypoint) {
        const toWP = Math.hypot(e.x - gs2.waypoint.x, e.y - gs2.waypoint.y);
        if (toWP < 30) gs2.waypoint = null; // reached gate, clear
      }
      if (gs2.waypoint) return gs2.waypoint;
    }

    // ── NORMAL: reactive awareness ───────────────────────────────────────
    // Chase: steer to nearest gate when near edge and moving toward it
    // Flee: route through nearest gate to break line of sight
    if (e.aiState === 'flee') {
      let bestGate = null, bestScore = -Infinity;
      const EDGES = [0,1,2,3];
      for (const ei of EDGES) {
        const g = _bestGateOnEdge(ei, b, gateSize);
        if (!g || g.dist > 500) continue;
        // Use min distance to any enemy from this gate
        const minDistToEnemy = enemies.reduce((min, en) =>
          Math.min(min, Math.hypot(en.x - g.x, en.y - g.y)), Infinity);
        const score = minDistToEnemy - g.dist;
        if (score > bestScore) { bestScore = score; bestGate = g; }
      }
      if (bestGate && bestGate.dist < 350) return bestGate;
    }

    // Chase: existing reactive near-edge steering
    if (e.aiState !== 'chase') return null;
    let bestGate = null, bestDist2 = Infinity;
    if (e.x - b.x < EDGE_THRESH && dx < 0) {
      const g = _bestGateOnEdge(3, b, gateSize);
      if (g && g.dist < bestDist2) { bestDist2 = g.dist; bestGate = { x: b.x + 2, y: g.y }; }
    }
    if (b.x2 - e.x < EDGE_THRESH && dx > 0) {
      const g = _bestGateOnEdge(1, b, gateSize);
      if (g && g.dist < bestDist2) { bestDist2 = g.dist; bestGate = { x: b.x2 - 2, y: g.y }; }
    }
    if (e.y - b.y < EDGE_THRESH && dy < 0) {
      const g = _bestGateOnEdge(0, b, gateSize);
      if (g && g.dist < bestDist2) { bestDist2 = g.dist; bestGate = { x: g.x, y: b.y + 2 }; }
    }
    if (b.y2 - e.y < EDGE_THRESH && dy > 0) {
      const g = _bestGateOnEdge(2, b, gateSize);
      if (g && g.dist < bestDist2) { bestDist2 = g.dist; bestGate = { x: g.x, y: b.y2 - 2 }; }
    }
    if (bestGate && bestDist2 > gateSize * 0.5) return bestGate;
    return null;
  }

  // ── Warp cooldown state — used by multiple behaviours below ──────────
  const WARP_CD = 4.5;
  const now_ai  = performance.now() / 1000;
  const warpReady = (now_ai - (e._lastWarp || 0)) >= WARP_CD;
  const warpCdRemaining = warpReady ? 0 : WARP_CD - (now_ai - (e._lastWarp || 0));

  // Compute gate waypoint once per tick (cheap — only active near edges)
  // When warp is on CD, suppress gate waypoints entirely — bot can't go through anyway
  const gateWP = warpReady ? _gateWaypoint() : null;
  // Effective direction to move toward — gate waypoint overrides target when rerouting
  let moveDx = dx, moveDy = dy, moveDist = dist;
  let moveToTx = toTx, moveToTy = toTy;
  if (gateWP) {
    const gdx = gateWP.x - e.x, gdy = gateWP.y - e.y;
    const gd = Math.sqrt(gdx*gdx + gdy*gdy) || 1;
    moveDx = gdx; moveDy = gdy; moveDist = gd;
    moveToTx = gdx / gd; moveToTy = gdy / gd;
  }
  // Easy: none. Normal: basic seek/avoid. Hard: full tactical evaluation.
  if (diff !== 'easy' && gs.weatherZones?.length) {
    if ((e._weatherEvalTimer ?? 0) > 0) {
      e._weatherEvalTimer -= dt;
    } else {
      // Re-evaluate every 1.5s (normal) or 0.8s (hard)
      e._weatherEvalTimer = diff === 'hard' ? 0.8 : 1.5;

      // Score a position in world space for this bot right now
      function scoreZoneForBot(zone) {
        const u = zone.def?.universal;
        if (!u) return 0;
        let score = 0;

        if (u.healRate) {
          // Downpour heals — very attractive when low HP, neutral when healthy
          score += hpFrac < 0.50 ? 18 * (1 - hpFrac)  // desperate: very attractive
                 : hpFrac < 0.75 ? 6                    // moderate: mildly attractive
                 : -2;                                   // healthy: slight negative (give up zone)
        }
        if (u.dmgMult) {
          // Heatwave — attractive when healthy and ready to fight
          score += hpFrac > 0.60 ? 10 : -8; // avoid when low HP — fights are lethal inside
        }
        if (u.cooldownMult) {
          // Thunderstorm — attractive when abilities are on CD
          const avgCd = e.cooldowns.reduce((a, b) => a + b, 0) / (e.cooldowns.length || 1);
          score += avgCd > 1.5 ? 12 : 4; // great when draining CDs, decent otherwise
        }
        if (u.speedMult) {
          // Blizzard — melee hates it (can't close), ranged loves it (enemy can't escape)
          score += e.combatClass === 'melee'  ? -12
                 : e.combatClass === 'ranged' ?  10
                 :                               2; // hybrid: slight positive
        }
        if (u.rangeMult) {
          // Sandstorm — ranged/hybrid avoid (range collapses), melee seeks (forces brawl)
          score += e.combatClass === 'melee'  ?  10
                 : e.combatClass === 'ranged' ? -14
                 :                              -6;
        }
        if (u.voidPull) {
          // Blackhole — always avoid unless hard bot wants to use it tactically
          if (diff === 'hard') {
            // Hard: seek blackhole only if enemy is nearby and we want to trap them
            const enemyNearZone = enemies.some(en =>
              Math.hypot(en.x - zone.zone.x, en.y - zone.zone.y) < zone.zone.radius * 0.8
            );
            score += enemyNearZone ? -4 : -20; // still generally avoid, just less so if enemy already in it
          } else {
            score += -25; // normal: hard avoid
          }
        }

        // Scale score by zone intensity and proximity
        score *= zone.intensity;
        return score;
      }

      // Evaluate zones — find best one to seek (beneficial only, no escape waypoints)
      let bestZoneTarget = null, bestZoneScore = diff === 'hard' ? 5 : 8;
      let currentZoneScore = 0;

      const currentWeather = getWeatherAt(e.x, e.y, gs);
      if (currentWeather?.length) {
        currentZoneScore = currentWeather.reduce((sum, w) => sum + scoreZoneForBot(w), 0);
      }

      for (const zone of gs.weatherZones) {
        if (zone.intensity < 0.3) continue;
        const zoneW = getWeatherAt(zone.x, zone.y, gs);
        if (!zoneW?.length) continue;
        const zScore = zoneW.reduce((sum, w) => sum + scoreZoneForBot(w), 0);
        const zd = Math.hypot(e.x - zone.x, e.y - zone.y);
        if (zd > 800) continue;
        const travelPenalty = diff === 'hard' ? zd * 0.008 : zd * 0.012;
        const netScore = zScore - travelPenalty;
        if (netScore > bestZoneScore && netScore > currentZoneScore + 3) {
          bestZoneScore = netScore; bestZoneTarget = { x: zone.x, y: zone.y, score: netScore };
        }
      }
      // Store zone repulsion — computed per-frame below, not as a waypoint
      e._currentZoneScore = currentZoneScore;
      e._weatherWaypoint = bestZoneTarget; // seek only, never escape

      // Pre-compute repulsion vectors — only truly dangerous zones, difficulty-gated
      // Normal/easy: only flee blackhole/maelstrom. Hard: flee high-negative zones too.
      e._zoneRepulseX = 0; e._zoneRepulseY = 0;
      const avoidThreshold = diff === 'hard' ? -12 : -30; // easy/normal only avoid extreme zones
      for (const zone of gs.weatherZones) {
        if (!zone || zone.intensity < 0.2) continue;
        const zoneW = getWeatherAt(zone.x, zone.y, gs);
        if (!zoneW?.length) continue;
        const zScore = zoneW.reduce((sum, w) => scoreZoneForBot(w), 0);
        if (zScore >= avoidThreshold) continue; // not dangerous enough to avoid
        const zdx = e.x - zone.x, zdy = e.y - zone.y;
        const zd = Math.hypot(zdx, zdy) || 1;
        // Only push when already well inside the zone (not skirting the edge)
        const margin = diff === 'hard' ? zone.radius * 0.70 : zone.radius * 0.45;
        if (zd > margin) continue;
        const strength = (1 - zd / margin) * Math.abs(zScore) * 0.015 * zone.intensity;
        e._zoneRepulseX += (zdx / zd) * strength;
        e._zoneRepulseY += (zdy / zd) * strength;
      }
    }

    // Clear seek waypoint if arrived
    if (e._weatherWaypoint) {
      if (Math.hypot(e.x - e._weatherWaypoint.x, e.y - e._weatherWaypoint.y) < 80)
        e._weatherWaypoint = null;
    }

    // Beneficial zone seek — gentle nudge toward good zones when not in combat
    if (e._weatherWaypoint && !gateWP) {
      // Seek beneficial zones when not in direct combat or fleeing toward one
      const inCombat = dist < attackRange * 1.5;
      const canSeekZone = !inCombat || (e.aiState === 'flee' && e._weatherWaypoint.score > 15);
      if (canSeekZone) {
        const wdx = e._weatherWaypoint.x - e.x, wdy = e._weatherWaypoint.y - e.y;
        const wd  = Math.hypot(wdx, wdy) || 1;
        const blend = diff === 'hard' ? 0.18 : 0.08; // softer nudge — don't abandon fights for storms
        moveToTx = moveToTx * (1 - blend) + (wdx/wd) * blend;
        moveToTy = moveToTy * (1 - blend) + (wdy/wd) * blend;
        const ml = Math.hypot(moveToTx, moveToTy) || 1;
        moveToTx /= ml; moveToTy /= ml;
      }
    }
  }

  // ── AI Sprint ──────────────────────────────────────────────────────────
  if ((e.sprintTimer ?? 0) > 0) {
    e.sprintTimer = Math.max(0, e.sprintTimer - dt);
    if (e.sprintTimer <= 0) e.sprintMult = 1;
  }
  if ((e.sprintCd ?? 0) > 0) e.sprintCd = Math.max(0, e.sprintCd - dt);
  if ((e.sprintCd ?? 0) <= 0) {
    const sprintCfg = SPRINT_CONFIG[e.combatClass] ?? SPRINT_CONFIG.hybrid;
    let shouldSprint = false;
    if (e.aiState === 'chase') {
      if (e.combatClass === 'melee')                                          shouldSprint = true;            // melee always sprints to close
      if (e.combatClass === 'hybrid' && dist > attackRange * 1.0)             shouldSprint = Math.random() < 0.4 * dt;
      if (e.combatClass === 'ranged' && dist > attackRange * 1.2)             shouldSprint = Math.random() < 0.15 * dt; // ranged rarely chases
    }
    if (e.aiState === 'kite') {
      if (e.combatClass === 'ranged')  shouldSprint = Math.random() < 0.35 * dt; // ranged sprints away from melee
      if (e.combatClass === 'hybrid')  shouldSprint = Math.random() < 0.20 * dt;
    }
    if (e.aiState === 'flee'   && Math.random() < 0.5 * dt) shouldSprint = true;
    // Hard AI: sprint when committed to a gate waypoint — only if warp is ready
    if (diff === 'hard' && gateWP && warpReady) {
      const toGate = Math.hypot(e.x - gateWP.x, e.y - gateWP.y);
      if (toGate < 280) shouldSprint = true;
    }
    if (shouldSprint) {
      e.sprintTimer = sprintCfg.duration;
      e.sprintCd    = sprintCfg.cd;
      e.sprintMult  = sprintCfg.mult;
    }
  }
  const eSprintMult = (e.sprintTimer ?? 0) > 0 ? (e.sprintMult ?? 1) : 1;

  let targetVX = 0, targetVY = 0;

  // ── Black hole / Singularity pull escape override ─────────────────────
  // When a bot is being actively pulled, forget about enemies entirely and
  // run directly away from the pull center. Sprint is forced every frame
  // until the bot is clear — the reaction timer in state.js still gates
  // the first sprint trigger, but once clear this kicks in immediately.
  if (e.weatherBlackholePull && !e.isPlayer) {
    const vp = e.weatherBlackholePull;
    const pdx = e.x - vp.x, pdy = e.y - vp.y;
    const pd  = Math.hypot(pdx, pdy) || 1;
    const spd = e.speed * 2.5 * (e.weatherSpeedMult ?? 1) * eSprintMult;
    targetVX = (pdx / pd) * spd;
    targetVY = (pdy / pd) * spd;

    // Force sprint on every frame while inside pull — don't wait for cooldown
    if ((e.sprintCd ?? 0) <= 0 || (e.sprintTimer ?? 0) <= 0) {
      const sprintCfg = SPRINT_CONFIG[e.combatClass] ?? SPRINT_CONFIG.hybrid;
      e.sprintTimer = sprintCfg.duration;
      e.sprintCd    = sprintCfg.cd;
      e.sprintMult  = sprintCfg.mult;
    }

    // Apply velocity and skip the rest of the movement state machine
    const accelT = 0.08;
    const alpha = Math.min(1, dt / accelT);
    e.velX = (e.velX ?? 0) + (targetVX - (e.velX ?? 0)) * alpha;
    e.velY = (e.velY ?? 0) + (targetVY - (e.velY ?? 0)) * alpha;
    e.x += e.velX;
    e.y += e.velY;
    warpChar(e, gs.W, gs.H);
    resolveObstacleCollisions(e, gs);
    e.vx = e.velX; e.vy = e.velY;
    e.facing = e.velX > 0 ? 1 : -1;
    return; // skip the rest of AI movement this frame
  }

  if (e.aiState === 'flee') {
    // Flee away from centroid of all nearby enemies — crucial in 4-player FFA
    const nearbyEnemies = enemies.filter(en => Math.hypot(en.x - e.x, en.y - e.y) < 600);
    const fleeFromX = nearbyEnemies.length
      ? nearbyEnemies.reduce((s, en) => s + en.x, 0) / nearbyEnemies.length
      : nearestEnemy.x;
    const fleeFromY = nearbyEnemies.length
      ? nearbyEnemies.reduce((s, en) => s + en.y, 0) / nearbyEnemies.length
      : nearestEnemy.y;
    const { dx: fdx, dy: fdy } = warpDelta(e.x, e.y, fleeFromX, fleeFromY);
    const fd  = Math.sqrt(fdx*fdx+fdy*fdy) || 1;
    const spd = e.speed * 2.2 * (e.weatherSpeedMult ?? 1) * eSprintMult;
    const b   = getArenaBounds(gs);
    const cx  = gs.W / 2, cy = gs.H / 2;

    // ── Wall proximity — smooth center pull when near edges ──────────
    // Reduced from 280 — was causing bots to steer away from walls too early
    // and creating oscillation as flee direction + wall push fought each other
    const wallMargin = 160;
    const wallDistL = e.x - b.x, wallDistR = b.x2 - e.x;
    const wallDistT = e.y - b.y, wallDistB = b.y2 - e.y;
    const wallPushX = wallDistL < wallMargin ? (wallMargin - wallDistL) / wallMargin * 0.8
                    : wallDistR < wallMargin ? -(wallMargin - wallDistR) / wallMargin * 0.8 : 0;
    const wallPushY = wallDistT < wallMargin ? (wallMargin - wallDistT) / wallMargin * 0.8
                    : wallDistB < wallMargin ? -(wallMargin - wallDistB) / wallMargin * 0.8 : 0;

    if (!warpReady) {
      // Warp on CD — always pull toward center, blended with flee direction
      // Do NOT do lateral wall sliding — it creates wall-hugging loops
      const margin = 200;
      const nearWall = e.x - b.x < margin || b.x2 - e.x < margin ||
                       e.y - b.y < margin || b.y2 - e.y < margin;
      const toCx2 = cx - e.x, toCy2 = cy - e.y;
      const toCd2 = Math.hypot(toCx2, toCy2) || 1;
      const centerPullWarp = nearWall ? 0.80 : (cfg.fleeCenterPull ?? 0.55);
      const fleeDirX = -(fdx/fd);
      const fleeDirY = -(fdy/fd);
      const blendX = fleeDirX * (1-centerPullWarp) + (toCx2/toCd2) * centerPullWarp;
      const blendY = fleeDirY * (1-centerPullWarp) + (toCy2/toCd2) * centerPullWarp;
      const blendLen = Math.hypot(blendX, blendY) || 1;
      // Skip additive wallPush here — centerPullWarp already handles edge avoidance
      // Adding wallPush on top caused oscillation/edge-spam when near corners
      targetVX = (blendX/blendLen) * spd;
      targetVY = (blendY/blendLen) * spd;
      // Re-engage early if warp almost ready and not critically low
      if (diff === 'hard' && warpCdRemaining < 1.0 && hpFrac > cfg.fleeCriticalHp) {
        e.aiState = 'chase';
        e._reengageTimer = warpCdRemaining + 0.3;
      }

    } else if (cfg.fleeMode === 'tactical' && e._fleeSubMode === 'disengage') {
      // ── Hard / critical HP: find safest quadrant ──────────────────────
      // Score each quadrant center by distance from ALL enemies
      if (!e._safeTarget || (e._safeTargetTimer ?? 0) <= 0) {
        e._safeTargetTimer = 1.5; // re-evaluate every 1.5s
        const quadrants = [
          { x: b.x + b.w * 0.25, y: b.y + b.h * 0.25 },
          { x: b.x + b.w * 0.75, y: b.y + b.h * 0.25 },
          { x: b.x + b.w * 0.25, y: b.y + b.h * 0.75 },
          { x: b.x + b.w * 0.75, y: b.y + b.h * 0.75 },
        ];
        let best = null, bestScore = -Infinity;
        for (const q of quadrants) {
          // Score = distance from CLOSEST enemy (maximise safety floor, not average)
          const minEnemyDist = enemies.reduce((min, en) =>
            Math.min(min, Math.hypot(q.x - en.x, q.y - en.y)), Infinity);
          // Penalise quadrants near walls
          const wallPenalty = Math.min(q.x - b.x, b.x2 - q.x, q.y - b.y, b.y2 - q.y);
          const score = minEnemyDist + wallPenalty * 0.5;
          if (score > bestScore) { bestScore = score; best = q; }
        }
        e._safeTarget = best;
      }
      if ((e._safeTargetTimer ?? 0) > 0) e._safeTargetTimer -= dt;

      if (e._safeTarget) {
        const stx = e._safeTarget.x - e.x, sty = e._safeTarget.y - e.y;
        const std = Math.hypot(stx, sty) || 1;
        if (std > 60) {
          targetVX = (stx/std) * spd;
          targetVY = (sty/std) * spd;
        } else {
          // Reached safe spot — hold position with slight enemy-away bias
          targetVX = -(fdx/fd) * spd * 0.3;
          targetVY = -(fdy/fd) * spd * 0.3;
        }
      }

    } else if (cfg.fleeMode === 'retreat' || cfg.fleeMode === 'tactical') {
      // ── Normal/Hard retreat: maintain target distance, circle laterally ─
      const targetDist = cfg.fleeTargetDist ?? 420;
      const centerPull = cfg.fleeCenterPull ?? 0.55;

      // If a beneficial weather waypoint exists (e.g. DOWNPOUR to heal), bias toward it
      const weatherBias = e._weatherWaypoint && hpFrac < 0.60;

      if (fd >= targetDist && hpFrac >= (cfg.fleeReengageHp ?? 0.40)) {
        e.aiState = 'chase';
      } else {
        const toCx = cx - e.x, toCy = cy - e.y;
        const toCd = Math.hypot(toCx, toCy) || 1;
        const awayX = -(fdx/fd), awayY = -(fdy/fd);
        const latX = -awayY * e._strafeDir;
        const latY =  awayX * e._strafeDir;
        const lateralBlend = fd > targetDist * 0.7 ? 0.30 : 0.10;

        let blendX, blendY;
        if (weatherBias) {
          // Pull toward healing/beneficial zone while retreating
          const wdx2 = e._weatherWaypoint.x - e.x, wdy2 = e._weatherWaypoint.y - e.y;
          const wd2  = Math.hypot(wdx2, wdy2) || 1;
          const weatherPull = 0.35;
          blendX = awayX * (1 - centerPull - lateralBlend - weatherPull)
                 + (toCx/toCd) * centerPull
                 + latX * lateralBlend
                 + (wdx2/wd2) * weatherPull;
          blendY = awayY * (1 - centerPull - lateralBlend - weatherPull)
                 + (toCy/toCd) * centerPull
                 + latY * lateralBlend
                 + (wdy2/wd2) * weatherPull;
        } else {
          blendX = awayX * (1 - centerPull - lateralBlend)
                 + (toCx/toCd) * centerPull
                 + latX * lateralBlend;
          blendY = awayY * (1 - centerPull - lateralBlend)
                 + (toCy/toCd) * centerPull
                 + latY * lateralBlend;
        }
        const blendLen = Math.hypot(blendX, blendY) || 1;
        targetVX = (blendX/blendLen) * spd + wallPushX * spd * 0.5;
        targetVY = (blendY/blendLen) * spd + wallPushY * spd * 0.5;
      }

    } else if (gateWP) {
      // Warp ready + gate waypoint
      const gdx = gateWP.x - e.x, gdy = gateWP.y - e.y;
      const gd  = Math.hypot(gdx, gdy) || 1;
      targetVX = (gdx/gd) * spd;
      targetVY = (gdy/gd) * spd;
    } else {
      // Fallback: flee away with center pull
      const toCx = cx - e.x, toCy = cy - e.y;
      const toCd = Math.hypot(toCx, toCy) || 1;
      const centerPull = cfg.fleeCenterPull ?? 0.35;
      const blendX = -(fdx/fd) * (1-centerPull) + (toCx/toCd) * centerPull;
      const blendY = -(fdy/fd) * (1-centerPull) + (toCy/toCd) * centerPull;
      const blendLen = Math.hypot(blendX, blendY) || 1;
      targetVX = (blendX/blendLen) * spd + wallPushX * spd * 0.5;
      targetVY = (blendY/blendLen) * spd + wallPushY * spd * 0.5;
    }
  } else if (e.aiState === 'chase') {
    let eSpdMult = 2.0;
    if (lowHp) eSpdMult *= 1.12;
    const spd = e.speed * eSpdMult * (e.weatherSpeedMult ?? 1) * eSprintMult;
    const sf  = cfg.strafeStrength * (lowHp ? 1.4 : 1.0);
    const strafeScale = gateWP ? 0.15 : 1.0;
    if (e.combatClass === 'melee') {
      // Melee charges straight — minimal strafe, maximum forward pressure
      targetVX = moveToTx * spd + strafeX * spd * sf * 0.20 * strafeScale;
      targetVY = moveToTy * spd + strafeY * spd * sf * 0.20 * strafeScale;
    } else {
      targetVX = moveToTx * spd + strafeX * spd * sf * strafeScale;
      targetVY = moveToTy * spd + strafeY * spd * sf * strafeScale;
    }
    e.facing = moveDx > 0 ? 1 : -1;
  } else if (e.aiState === 'kite') {
    const spd = e.speed * 1.5 * (e.weatherSpeedMult ?? 1) * eSprintMult;
    const sf  = cfg.strafeStrength;
    if (e.combatClass === 'ranged') {
      // Ranged: sprint AWAY from enemy and strafe — priority escape
      targetVX = -toTx * spd * 0.85 + strafeX * spd * (0.15 + sf * 0.4);
      targetVY = -toTy * spd * 0.85 + strafeY * spd * (0.15 + sf * 0.4);
    } else {
      // Hybrid: back off more gently while staying ready to re-engage
      targetVX = -toTx * spd * 0.6 + strafeX * spd * (0.4 + sf * 0.6);
      targetVY = -toTy * spd * 0.6 + strafeY * spd * (0.4 + sf * 0.6);
    }
  } else if (e.aiState === 'hold') {
    const spd = e.speed * (e.weatherSpeedMult ?? 1);
    const sf  = cfg.strafeStrength * 0.8;
    // Hard bots in hold state still push slightly toward target to prevent standing still
    const holdForward = diff === 'hard' ? 0.4 : 0.1;
    targetVX = strafeX * spd * sf + moveToTx * spd * holdForward;
    targetVY = strafeY * spd * sf + moveToTy * spd * holdForward;
  }

  // ── Obstacle avoidance steering ────────────────────────────────────────
  // Compute a repulsion vector when the bot is close to any obstacle.
  // Applied as an additive bias on targetVX/targetVY before velocity smoothing.
  let obsAvoidX = 0, obsAvoidY = 0;
  if (gs.obstacles?.length) {
    const lookAhead = e.speed * 1.4 + 40; // tighter sense radius — less over-avoidance
    const movDir = Math.hypot(targetVX, targetVY) > 0.1 ? {x:targetVX, y:targetVY} : null;
    for (const ob of gs.obstacles) {
      const odx = e.x - ob.x, ody = e.y - ob.y;
      const odist = Math.hypot(odx, ody) || 1;
      const threshold = ob.size + e.radius + lookAhead;
      if (odist < threshold) {
        // Only avoid obstacles that are ahead of us (dot product with movement dir)
        if (movDir) {
          const movLen = Math.hypot(movDir.x, movDir.y) || 1;
          const dot = (-odx/odist)*(movDir.x/movLen) + (-ody/odist)*(movDir.y/movLen);
          if (dot < -0.2) continue; // only skip obstacles clearly behind
        }
        const strength = Math.pow(1 - odist / threshold, 2) * 0.7; // softer push
        obsAvoidX += (odx / odist) * strength;
        obsAvoidY += (ody / odist) * strength;
      }
    }
    // Normalise and scale — keep it gentle so bots push through to targets
    const avoidMag = Math.hypot(obsAvoidX, obsAvoidY);
    if (avoidMag > 0) {
      const avoidScale = e.speed * 1.6; // reduced from 2.5
      obsAvoidX = (obsAvoidX / avoidMag) * avoidScale;
      obsAvoidY = (obsAvoidY / avoidMag) * avoidScale;
    }
  }

  const moving = Math.hypot(targetVX, targetVY) > 0.1;
  const alpha = Math.min(1, dt / (moving ? 0.14 : 0.10));
  // Zone repulsion applied additively alongside obstacle avoidance
  // Per-frame maelstrom/dangerous zone escape — always active, all states
  let urgentRepX = 0, urgentRepY = 0;
  if (gs.weatherZones?.length) {
    for (const zone of gs.weatherZones) {
      if (!zone || zone.intensity < 0.15) continue;
      const zd = Math.hypot(e.x - zone.x, e.y - zone.y);
      const dangerRadius = (zone.radius ?? 120) * 1.4;
      if (zd > dangerRadius) continue;
      // Check if this zone is dangerous
      const zoneW = getWeatherAt(zone.x, zone.y, gs);
      if (!zoneW?.length) continue;
      const isDangerous = zoneW.some(w => {
        const u = w.def?.universal;
        return (u?.voidPull && u.voidPull > 100)   // maelstrom — always flee
            || (u?.dmgMult  && hpFrac < 0.35)       // heatwave when low HP
            || (u?.speedMult && e.combatClass === 'melee' && hpFrac < 0.50); // blizzard melee
      });
      if (!isDangerous) continue;
      const zdx = e.x - zone.x, zdy = e.y - zone.y;
      const zdist = Math.hypot(zdx, zdy) || 1;
      // Escape strength ramps sharply inside the zone
      const inside = Math.max(0, 1 - zd / dangerRadius);
      const escapeStr = inside * inside * e.speed * 4.0;
      urgentRepX += (zdx / zdist) * escapeStr;
      urgentRepY += (zdy / zdist) * escapeStr;
    }
  }

  const zrx = e._zoneRepulseX ?? 0, zry = e._zoneRepulseY ?? 0;
  const totalRepX = zrx + urgentRepX;
  const totalRepY = zry + urgentRepY;
  e.velX += (targetVX + obsAvoidX + totalRepX - e.velX) * alpha;
  e.velY += (targetVY + obsAvoidY + totalRepY - e.velY) * alpha;
  if (!moving && Math.hypot(e.velX, e.velY) < 0.05) { e.velX = 0; e.velY = 0; }

  e.x += e.velX;
  e.y += e.velY;
  warpChar(e, gs.W, gs.H);
  resolveObstacleCollisions(e, gs);
  e.vx = e.velX; e.vy = e.velY;

  // ── Global stuck-break — catches any freeze the state machine misses ──
  // If a bot hasn't moved meaningfully in 1.5s while supposed to be active,
  // give it a random nudge toward the target to break out of obstacle locks.
  e._stuckTimer = (e._stuckTimer ?? 0) + dt;
  if (Math.hypot(e.velX, e.velY) > 0.5) {
    e._stuckTimer = 0; // moving fine — reset
  } else if (e._stuckTimer > 1.5 && e.aiState !== 'hold') {
    const nudgeDx = target.x - e.x + (Math.random() - 0.5) * 200;
    const nudgeDy = target.y - e.y + (Math.random() - 0.5) * 200;
    const nudgeD = Math.hypot(nudgeDx, nudgeDy) || 1;
    e.velX = (nudgeDx / nudgeD) * e.speed * 2;
    e.velY = (nudgeDy / nudgeD) * e.speed * 2;
    e._stuckTimer = 0;
  }

  e.meleeTerrainDefBonus = 0;

  // ── Melee collision damage ─────────────────────────────────────────────
  if (e.combatClass === 'melee') {
    const eVel = Math.sqrt((e.vx||0)**2 + (e.vy||0)**2);
    if (eVel > 0.8 && target.alive) {
      const { dx: cdx, dy: cdy, dist: cdist } = warpDelta(e.x, e.y, target.x, target.y);
      if (cdist < e.radius + target.radius + 4) {
        const dot = (e.vx * cdx + e.vy * cdy) / (cdist * eVel);
        if (dot > 0.3) applyMeleeCollision(e, target, eVel, gs);
      }
    }
  }

  // ── Auto-attack (normal/hard AI) ───────────────────────────────────────
  // Hard bots auto-attack even while fleeing if target happens to be in range
  const canAutoAtk = e.aiState !== 'flee' || (diff === 'hard' && dist < attackRange * 0.7);
  if (canAutoAtk && e.autoAtkTimer <= 0 && dist < attackRange && Math.random() < cfg.autoChance && !e.silenced) {
    const atkSpd = e.stats?.atkSpeed ?? 1.0;
    e.autoAtkTimer = 1 / atkSpd;
    const _autoMult2 = e.combatClass === 'melee' ? 0.65 : e.combatClass === 'hybrid' ? 0.75 : 0.52;
    const autoDmg = Math.round((e.stats?.damage ?? 60) * _autoMult2);
    const { dx: adx, dy: ady, dist: ad } = safeAimDelta(e.x, e.y, target.x, target.y, gs);
    gs.projectiles.push({
      x: e.x, y: e.y,
      vx: (adx/ad)*9, vy: (ady/ad)*9,
      damage: autoDmg, radius: 5,
      life: attackRange / (9*60),
      color: e.hero.color,
      teamId: e.teamId,
      isAutoAttack: true,
      stun:0, freeze:0, slow:0, silence:0, knockback:0,
      kbDirX: adx, kbDirY: ady,
      casterStats: e.stats, casterRef: e,
    });
  }

  // ── Ability use ────────────────────────────────────────────────────────
  // Class-aware ability range: melee only fires when in melee, ranged fires from max range
  const abilityFireRange = e.combatClass === 'melee'  ? attackRange * 0.75
                         : e.combatClass === 'ranged' ? attackRange * 1.10
                         : attackRange * 0.90; // hybrid: mid-range
  if (e.aiState !== 'flee' && e.aiTimer <= 0 && dist < abilityFireRange && !e.silenced) {
    e.aiTimer = cfg.reactionMin + Math.random() * (cfg.reactionMax - cfg.reactionMin);

    let abIdx;
    if (cfg.abilityMode === 'random') {
      // Easy: pick any ready ability at random, no mana reserve
      const ready = [0,1,2].filter(i => e.cooldowns[i]===0 && e.mana >= e.hero.abilities[i].manaCost);
      abIdx = ready.length ? ready[Math.floor(Math.random()*ready.length)] : undefined;

    } else if (cfg.abilityMode === 'damage') {
      // Normal: highest-damage ready ability, respects mana reserve
      const manaFloor = e.maxMana * cfg.manaReserve;
      abIdx = [2,1,0].find(i =>
        e.cooldowns[i] === 0 &&
        e.mana >= e.hero.abilities[i].manaCost &&
        e.mana - e.hero.abilities[i].manaCost >= manaFloor
      );

    } else {
      // Hard: ult if ready (hold if target above 60% HP and ult has no CC) →
      //       then highest-damage ready ability, with mana reserve
      const manaFloor = e.maxMana * cfg.manaReserve;
      const ultAb = e.hero.abilities[2];
      const ultHasCc = !!ultAb.cc;
      const ultReady = e.cooldowns[2] === 0 && e.mana >= ultAb.manaCost;
      const targetHurtEnough = target.hp / target.maxHp < 0.60;

      if (ultReady && (targetHurtEnough || ultHasCc)) {
        abIdx = 2;
      } else {
        // Pick highest-damage ready ability that respects mana floor
        abIdx = [1, 0].find(i =>
          e.cooldowns[i] === 0 &&
          e.mana >= e.hero.abilities[i].manaCost &&
          e.mana - e.hero.abilities[i].manaCost >= manaFloor
        );
        // Fall back to ult even if target is healthy, rather than do nothing
        if (abIdx === undefined && ultReady) abIdx = 2;
      }
    }
    if (abIdx !== undefined) castAbility(e, abIdx, target, gs);
  }

  // ── AI Special Ability (SLAM / SURGE / FOCUS) ──────────────────────────
  // Easy: never uses specials. Normal: reactive. Hard: tactical.
  if (diff !== 'easy' && (e.specialCd ?? 0) > 0) e.specialCd = Math.max(0, e.specialCd - dt);
  if (diff !== 'easy' && (e.specialCd ?? 0) <= 0 && !e.silenced && !e.stunned && !e.frozen) {
    const sCfg  = SPECIAL_CONFIG[e.combatClass] ?? SPECIAL_CONFIG.hybrid;
    const sDmg  = Math.round((e.stats?.damage ?? 60) * (e.stats?.abilityPower ?? 1.0));
    const col   = e.hero.color;
    const targetCCd = (target.frozen ?? 0) > 0 || (target.ccedTimer ?? 0) > 0 || (target.stunned ?? 0) > 0;
    const targetLowHp = target.hp / target.maxHp < 0.40;

    // Melee — SLAM: AOE stun burst
    // Normal: fire when target is in slam range
    // Hard: prioritise when target is CC'd (free hit), low HP, or multiple enemies nearby
    if (e.combatClass === 'melee' && e.aiState !== 'flee') {
      const charSpeed = e.speed ?? 4.0;
      const heaviness = 1 - (charSpeed - 2.8) / (6.2 - 2.8);
      const slamRange = 140 + heaviness * 40;
      const slamThresh = diff === 'hard' ? slamRange * 1.1 : slamRange;

      // Check all enemies in slam range for opportunity (not just primary target)
      const inSlamRange = enemies.filter(en => Math.hypot(en.x - e.x, en.y - e.y) < slamThresh);
      const anyTargetCCd = inSlamRange.some(en => (en.frozen??0)>0 || (en.ccedTimer??0)>0 || (en.stunned??0)>0);
      const anyTargetLowHp = inSlamRange.some(en => en.hp / en.maxHp < 0.40);
      const multiTarget = inSlamRange.length >= 2; // hard AI values AOE on groups

      const shouldSlam = diff === 'hard'
        ? dist < slamThresh && (anyTargetCCd || anyTargetLowHp || multiTarget || dist < slamRange * 0.7)
        : dist < slamRange;
      if (shouldSlam) {
        e.specialCd = sCfg.cd;
        const slamDmg = Math.round(sDmg * (0.55 + heaviness * 0.25));
        // Hit ALL enemies in slam range — true AOE
        for (const en of enemies) {
          const tDx = en.x - e.x, tDy = en.y - e.y;
          if (tDx*tDx + tDy*tDy < slamRange * slamRange) {
            applyHit(en, { damage: slamDmg, flatBonus:0, color: col, teamId: e.teamId,
              radius:0, stun:1.0, freeze:0, slow:0, silence:0, knockback:0,
              kbDirX: tDx, kbDirY: tDy, casterStats: e.stats, casterRef: e }, gs);
          }
        }
        showFloatText(e.x, e.y - 50, 'SLAM!', col, e);
        gs.effects.push({ x:e.x, y:e.y, r:0, maxR:slamRange,     life:0.35, maxLife:0.35, color:col, ring:true });
        gs.effects.push({ x:e.x, y:e.y, r:0, maxR:slamRange*0.6, life:0.20, maxLife:0.20, color:col });
        // ── PASSIVE: STONE Aftershock ──
        PASSIVES[e.hero?.id]?.onSlam?.(e, gs);
        if (gs.obstacles) {
          for (let _oi = gs.obstacles.length - 1; _oi >= 0; _oi--) {
            const _ob = gs.obstacles[_oi];
            const _dx = _ob.x - e.x, _dy = _ob.y - e.y;
            if (_ob.hp !== null && _dx*_dx + _dy*_dy < (slamRange + _ob.size) * (slamRange + _ob.size)) {
              _ob.hp = Math.max(0, _ob.hp - Math.max(1, Math.round(2 + heaviness * 3)));
              _ob._hitFlash = 0.3;
              if (_ob.hp <= 0) { spawnObstacleFragments(_ob, gs); gs.obstacles.splice(_oi, 1); }
            }
          }
        }
      }

    // Hybrid — SURGE: dash toward target to engage or escape
    // Normal: engage dash when in mid range
    // Hard: also uses SURGE to escape when fleeing (dash away from enemy)
    } else if (e.combatClass === 'hybrid') {
      const surgeThresh = diff === 'hard' ? 320 : 280;
      const shouldSurge = e.aiState === 'flee'
        ? diff === 'hard' && Math.random() < 0.4  // hard only: surge away when fleeing
        : dist < surgeThresh && dist > 60;
      if (shouldSurge) {
        e.specialCd = sCfg.cd;
        const surgeDist = 200;
        // When fleeing: dash AWAY from nearest enemy; when chasing: dash toward target
        const surgeTarget = e.aiState === 'flee' ? nearestEnemy : target;
        const { dx: sdx, dy: sdy } = warpDelta(e.x, e.y, surgeTarget.x, surgeTarget.y);
        const sLen = Math.sqrt(sdx*sdx + sdy*sdy) || 1;
        const dirMult = e.aiState === 'flee' ? -1 : 1;
        const dirX = (sdx / sLen) * dirMult, dirY = (sdy / sLen) * dirMult;
        const steps = 10;
        let hit = false;
        for (let _s = 1; _s <= steps && !hit; _s++) {
          const sx = e.x + dirX * (surgeDist / steps) * _s;
          const sy = e.y + dirY * (surgeDist / steps) * _s;
          if (!hit && target.alive && e.aiState !== 'flee') {
            const hitDist = Math.hypot(sx - target.x, sy - target.y);
            if (hitDist < e.radius + target.radius + 22) {
              hit = true;
              applyHit(target, { damage: Math.round(sDmg * 0.6), flatBonus:0, color:col, teamId:e.teamId,
                radius:0, stun:0, freeze:0, slow:0.35, silence:0, knockback:6,
                kbDirX: dirX, kbDirY: dirY, casterStats: e.stats, casterRef: e }, gs);
            }
          }
          if (!hit && _s === steps) { e.x = sx; e.y = sy; }
        }
        e.x += dirX * surgeDist; e.y += dirY * surgeDist;
        showFloatText(e.x, e.y - 50, 'SURGE!', col, e);
        gs.effects.push({ x:e.x, y:e.y, r:0, maxR:40, life:0.25, maxLife:0.25, color:col });
      }

    // Ranged — FOCUS: fast skillshot
    // Normal: fire when target is within comfortable range
    // Hard: prefer when target is CC'd (guaranteed hit), otherwise standard usage
    } else if (e.combatClass === 'ranged' && e.aiState !== 'flee') {
      const focusThresh = diff === 'hard' ? attackRange * 2.0 : attackRange * 1.8;
      const shouldFocus = dist < focusThresh &&
        (diff === 'normal' || targetCCd || dist < attackRange * 1.2 || Math.random() < 0.5);
      if (shouldFocus) {
        e.specialCd = sCfg.cd;
        const { dx: fdx, dy: fdy } = warpDelta(e.x, e.y, target.x, target.y);
        const fLen = Math.sqrt(fdx*fdx + fdy*fdy) || 1;
        gs.projectiles.push({
          x: e.x, y: e.y,
          vx: (fdx/fLen)*13, vy: (fdy/fLen)*13,
          damage: Math.round(sDmg * 0.7), radius: 7,
          life: (attackRange * 1.8) / (13 * 60),
          color: col, teamId: e.teamId, isAutoAttack: false,
          stun:0, freeze:0, slow:0.2, silence:0, knockback:3,
          kbDirX: fdx, kbDirY: fdy, casterStats: e.stats, casterRef: e,
          isFocus: true,
        });
        showFloatText(e.x, e.y - 50, 'FOCUS!', col, e);
      }
    }
  }

  // ── AI Rock Buster ─────────────────────────────────────────────────────
  // Easy: never. Normal: reactive (blocking path or blocking escape).
  // Hard: tactical scoring — prioritises obstacles that actually improve situation.
  // Both normal + hard: aware that large rocks can drop health pots when low HP.
  if (diff !== 'easy' && !e.stunned && !e.frozen) {
    if ((e._rbCd ?? 0) > 0) e._rbCd = Math.max(0, e._rbCd - dt);

    if ((e._rbCd ?? 0) <= 0) {
      const obs = (gs.obstacles ?? []).filter(o => o.hp !== null); // destructible only
      if (obs.length > 0) {
        const RB_RANGE = 520;
        // Rock buster can be spammed — AI fires much more aggressively at rocks
        const RB_CD = diff === 'hard' ? 0.5 : diff === 'normal' ? 0.9 : 1.4;

        // Pre-compute: rock busting for health
        const noNearbyPacks = !(gs.items ?? []).some(i =>
          i.type === 'healthpack' && Math.hypot(i.x - e.x, i.y - e.y) < 400
        );
        // wantsHealth: fleeing with no nearby pack = primary trigger
        // Also true if half-health on hard with no packs — proactive hunting
        const wantsHealth = noNearbyPacks && (
          (e.aiState === 'flee' && hpFrac < cfg.fleeHpPct) ||
          (diff === 'hard' && hpFrac < 0.50)
        );

        // Persist target: if we already started busting a rock, keep hammering it
        // until it's dead or out of range — prevents single-shot-and-forget
        if (e._rbTarget && !e._rbTarget.alive) e._rbTarget = null;
        if (e._rbTarget) {
          const td = Math.hypot(e._rbTarget.x - e.x, e._rbTarget.y - e.y);
          if (td > RB_RANGE * 1.2) e._rbTarget = null; // wandered too far
        }

        // Score each obstacle by how useful blasting it would be
        let bestOb = null, bestScore = -Infinity;

        for (const ob of obs) {
          const odx = ob.x - e.x, ody = ob.y - e.y;
          const od  = Math.hypot(odx, ody);
          if (od > RB_RANGE) continue;

          let score = 0;

          // ── Health pot hunting — large rocks can drop health packs ──
          if (wantsHealth && ob.size >= 40) {
            const potScore = diff === 'hard'
              ? (1 - hpFrac) * 28 * (1 - od / RB_RANGE) // hard: aggressive drive
              : (1 - hpFrac) * 14 * (1 - od / RB_RANGE); // normal: meaningful nudge
            score += potScore;
          }
          // Persistence bonus: already targeting this rock — commit to finishing it
          if (e._rbTarget === ob) score += 12;
          // Wounded rock bonus — close to death, don't waste it
          if (ob.hp !== null && ob.maxHp && ob.hp < ob.maxHp * 0.5) score += 8;

          if (diff === 'normal') {
            // Reactive: only care if obstacle is roughly between us and target (chase)
            // or between us and the closest chasing enemy (flee)
            const chaser = enemies.reduce((best, en) =>
              Math.hypot(en.x - e.x, en.y - e.y) < Math.hypot(best.x - e.x, best.y - e.y) ? en : best
            , nearestEnemy);
            if (e.aiState === 'flee') {
              // Obstacle between me and chaser = blast it to slow their path
              const edx = chaser.x - e.x, edy = chaser.y - e.y;
              const ed  = Math.hypot(edx, edy) || 1;
              const dot = (odx/od) * (edx/ed) + (ody/od) * (edy/ed);
              if (dot > 0.6 && od < 200) score = dot * 10; // in chaser's direction and close
            } else {
              // Obstacle between me and target = blast to clear path
              const tdx2 = target.x - e.x, tdy2 = target.y - e.y;
              const td2  = Math.hypot(tdx2, tdy2) || 1;
              const dot  = (odx/od) * (tdx2/td2) + (ody/od) * (tdy2/td2);
              if (dot > 0.65 && od < td2 && od < 250) score = dot * 10;
            }
          } else {
            // Hard: multi-factor scoring
            // 1. Is it blocking my path to target?
            const tdx2 = target.x - e.x, tdy2 = target.y - e.y;
            const td2  = Math.hypot(tdx2, tdy2) || 1;
            const dotToTarget = (odx/od) * (tdx2/td2) + (ody/od) * (tdy2/td2);
            if (dotToTarget > 0.6 && od < td2 * 0.8) score += dotToTarget * 15;

            // 2. Is it blocking nearest chaser's path toward me?
            const chaser = enemies.reduce((best, en) =>
              Math.hypot(en.x - e.x, en.y - e.y) < Math.hypot(best.x - e.x, best.y - e.y) ? en : best
            , nearestEnemy);
            const edx = chaser.x - e.x, edy = chaser.y - e.y;
            const ed  = Math.hypot(edx, edy) || 1;
            // Obstacle between enemy and me — good for fleeing
            const obToMe = Math.hypot(ob.x - e.x, ob.y - e.y);
            const dotBlock = ((e.x - ob.x)/obToMe) * (edx/ed) + ((e.y - ob.y)/obToMe) * (edy/ed);
            if (e.aiState === 'flee' && dotBlock > 0.5 && obToMe < 180) score += dotBlock * 12;

            // 3. Proximity bonus — closer is easier to hit
            score += Math.max(0, (RB_RANGE - od) / RB_RANGE) * 5;

            // 4. Low HP obstacle — easy finish, conserves future shots
            if (ob.hp < ob.maxHp * 0.4) score += 6;

            // Lower threshold — rock buster is spammable, AI fires freely at rocks
            if (score < (diff === 'hard' ? 3 : diff === 'normal' ? 5 : 7)) score = -Infinity;
          }

          if (score > bestScore) { bestScore = score; bestOb = ob; }
        }

        if (bestOb && bestScore > 0) {
          e._rbTarget = bestOb; // persist target until dead
          // Fire rock buster at chosen obstacle
          const fdx = bestOb.x - e.x, fdy = bestOb.y - e.y;
          const fd  = Math.max(1, Math.hypot(fdx, fdy));
          const autoMult = e.combatClass === 'melee' ? 0.65 : e.combatClass === 'hybrid' ? 0.75 : 0.52;
          const dmg = Math.round((e.stats?.damage ?? 60) * autoMult);
          gs.projectiles.push({
            x: e.x, y: e.y,
            vx: (fdx/fd) * 10,
            vy: (fdy/fd) * 10,
            damage: dmg, radius: 6,
            life: 520 / (10 * 60),
            color: '#ff9933',
            teamId: e.teamId,
            isRockBuster: true,
            isAutoAttack: false,
            stun:0, freeze:0, slow:0, silence:0, knockback:0,
            kbDirX: fdx, kbDirY: fdy,
            casterStats: e.stats, casterRef: e,
          });
          e.facing = fdx > 0 ? 1 : -1;
          e._rbCd = RB_CD;
        }
      }
    }
  }

  // ── RIFT AI: Flux awareness, portal entry, crafting decisions ────────────
  _updateRiftAI(e, gs, dt);
}

function _updateRiftAI(e, gs, dt) {
  if (!e.alive) return;
  const diff = aiDifficulty || 'normal';

  // Scale AI rift engagement by difficulty
  // easy: mostly ignores rift, hard: actively hunts Flux and enters
  const riftEngagement = diff === 'hard' ? 0.85 : diff === 'normal' ? 0.50 : 0.20;

  // Seed per-enemy rift personality so not all AIs behave identically
  if (e._riftPersonality === undefined) e._riftPersonality = Math.random();
  if (e._riftPersonality > riftEngagement) return; // this AI ignores rifts

  // ── If inside the Rift: navigate toward craft point and craft if able ──
  if (e._inRift) {
    e._riftInTimer = (e._riftInTimer ?? 0) + dt;

    // Move toward craft point
    const dx = RIFT_CRAFT_X - e.x, dy = RIFT_CRAFT_Y - e.y;
    const dist = Math.hypot(dx, dy) || 1;

    if (dist > RIFT_CRAFT_R * 1.5) {
      const spd = (e.speed ?? 160) * 0.8;
      e.velX = (dx / dist) * spd;
      e.velY = (dy / dist) * spd;
    } else {
      // On craft point — try to select and craft something
      e.velX = 0; e.velY = 0;
      e._onCraftPoint = true;

      if (!e._craftSelectedId) {
        const allItems = RELIC_DEFS;
        const affordable = allItems.filter(d => canAffordCraft(e, d.cost));
        if (affordable.length > 0) {
          // Pick highest-cost item first (most powerful)
          affordable.sort((a, b) => {
            const costA = a.cost.reduce((s, [,v]) => s + v, 0);
            const costB = b.cost.reduce((s, [,v]) => s + v, 0);
            return costB - costA;
          });
          e._craftSelectedId = affordable[0].id;
          e._craftPanelOpen = true;
        }
      }

      // Channel crafting
      if (e._craftSelectedId && !e._craftTarget) {
        const allItems = RELIC_DEFS;
        const sel = allItems.find(d => d.id === e._craftSelectedId);
        if (sel && canAffordCraft(e, sel.cost)) e._craftTarget = sel;
      }
    }

    // Attack human players in the Rift — kill them to steal their Flux
    // Hard AI actively hunts players in the Rift for the robbery bonus
    if (diff === 'hard' || diff === 'normal') {
      const riftPlayers = (gs.players ?? []).filter(p => p._inRift && p.alive);
      if (riftPlayers.length > 0 && dist > RIFT_CRAFT_R * 2) {
        // If we have enough Flux to craft, prioritise craft over combat
        const allItems = RELIC_DEFS;
        const canCraft = allItems.some(d => canAffordCraft(e, d.cost));
        if (!canCraft) {
          // Hunt player for Flux robbery
          const target = riftPlayers.reduce((a, b) =>
            Math.hypot(a.x - e.x, a.y - e.y) < Math.hypot(b.x - e.x, b.y - e.y) ? a : b
          );
          e._aiTarget = target;
        }
      }
    }
    return;
  }

  // ── Outside Rift: decide whether to enter portal ──
  const portal = gs.riftPortal;
  if (!portal || portal.life <= 0) { e._wantsRift = false; return; }
  if (e._lastRiftId === portal.id) return; // already used this rift

  // Decide to enter based on: Flux earned, time left on portal, difficulty
  const fluxTotal = Object.values(e._flux ?? {}).reduce((a, b) => a + b, 0);
  const allItems = RELIC_DEFS;
  const canCraft = allItems.some(d => canAffordCraft(e, d.cost));
  const portalTimeLeft = portal.life;
  const urgency = 1 - (portalTimeLeft / (gs.riftPortal?.maxLife ?? 25));

  // Hard AI enters if: can craft OR has decent Flux and portal still open
  // Normal AI enters if: can craft
  // Easy AI: rarely enters (controlled by personality filter above)
  const shouldEnter = canCraft
    || (diff === 'hard' && fluxTotal >= 3 && urgency < 0.7)
    || (diff === 'normal' && fluxTotal >= 4);

  if (shouldEnter) {
    const pdx = portal.x - e.x, pdy = portal.y - e.y;
    const pd = Math.hypot(pdx, pdy) || 1;
    // Move toward portal
    const spd = (e.speed ?? 160) * 0.9;
    e.velX = (pdx / pd) * spd;
    e.velY = (pdy / pd) * spd;
    e._wantsRift = true;
    e._riftOverrideMovement = true; // signal to main AI not to override this
  } else {
    e._wantsRift = false;
  }
}

