// ========== AUDIO SYSTEM ==========
const Audio = (() => {
  let ctx = null;
  let masterGain, sfxGain, humGain;
  let humOscs = [];
  let menuBuffer = null, matchBuffer = null;
  let activeSource = null, activeGainNode = null;
  let activeTrack = null;
  let _pendingMatchPlay = false;
  let _pendingMenuPlay  = false;

  const settings = (() => {
    try {
      const s = JSON.parse(localStorage.getItem('ec_audio') || '{}');
      // Migrate old flat keys to new per-track keys
      if (s.musicOn !== undefined && s.menuMusicOn === undefined)  s.menuMusicOn  = s.musicOn;
      if (s.musicOn !== undefined && s.matchMusicOn === undefined) s.matchMusicOn = s.musicOn;
      if (s.musicVol !== undefined && s.menuMusicVol === undefined)  s.menuMusicVol  = s.musicVol;
      if (s.musicVol !== undefined && s.matchMusicVol === undefined) s.matchMusicVol = s.musicVol;
      return s;
    } catch { return {}; }
  })();
  if (settings.sfxVol        === undefined) settings.sfxVol        = 0.8;
  if (settings.menuMusicVol  === undefined) settings.menuMusicVol  = 0.6;
  if (settings.matchMusicVol === undefined) settings.matchMusicVol = 0.6;
  if (settings.menuMusicOn   === undefined) settings.menuMusicOn   = true;
  if (settings.matchMusicOn  === undefined) settings.matchMusicOn  = true;
  if (settings.sfxOn         === undefined) settings.sfxOn         = true;

  function save() {
    try { localStorage.setItem('ec_audio', JSON.stringify(settings)); } catch {}
  }

  function init() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain(); masterGain.gain.value = 1.0; masterGain.connect(ctx.destination);
    sfxGain    = ctx.createGain(); sfxGain.gain.value    = settings.sfxOn ? settings.sfxVol : 0; sfxGain.connect(masterGain);
    humGain    = ctx.createGain(); humGain.gain.value    = settings.sfxOn ? 0.07 * settings.sfxVol : 0; humGain.connect(masterGain);
    startHum();
    // Start menu BGM if on a menu screen
    const active = document.querySelector('.screen.active');
    if (active && ['menu','hero-select','how-to-play','options'].includes(active.id)) {
      playMenuBGM();
    }
  }

  // ── Utility ──────────────────────────────────────────────────────
  function osc(type, freq, dur, gainVal, destination, opts = {}) {
    if (!ctx) return;
    const g  = ctx.createGain();
    const o  = ctx.createOscillator();
    o.type     = type;
    o.frequency.setValueAtTime(freq, ctx.currentTime);
    if (opts.freqEnd !== undefined)
      o.frequency.exponentialRampToValueAtTime(Math.max(0.01, opts.freqEnd), ctx.currentTime + dur);
    g.gain.setValueAtTime(gainVal, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g); g.connect(destination || sfxGain);
    o.start(); o.stop(ctx.currentTime + dur + 0.02);
  }

  function noise(dur, gainVal, destination, opts = {}) {
    if (!ctx) return;
    const bufSize = ctx.sampleRate * Math.min(dur + 0.1, 2);
    const buf  = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src  = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type            = opts.filterType || 'bandpass';
    filt.frequency.value = opts.freq       || 800;
    filt.Q.value         = opts.Q          || 1.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gainVal, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    src.connect(filt); filt.connect(g); g.connect(destination || sfxGain);
    src.start(); src.stop(ctx.currentTime + dur + 0.02);
  }

  function distort(amount = 40) {
    const ws   = ctx.createWaveShaper();
    const n    = 256, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
    }
    ws.curve = curve;
    return ws;
  }

  // ── Arena hum — always on ─────────────────────────────────────────
  function startHum() {
    if (!settings.sfxOn) return;
    stopHum();
    // Gentle sine drones — barely perceptible, no pulsing
    [55, 110].forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.value = i === 0 ? 0.08 : 0.03;
      o.connect(g); g.connect(humGain);
      o.start();
      humOscs.push(o);
    });
  }

  function stopHum() {
    humOscs.forEach(o => { try { o.stop(); } catch {} });
    humOscs = [];
  }

  // ── BGM ───────────────────────────────────────────────────────────
  // Use HTML Audio elements for BGM — far more reliable for MP3 streaming
  // than WebAudio decodeAudioData which can fail on large files
  const _bgmEls = {
    menu:  null,
    match: null,
  };
  let _activeBgm = null;

  function _ensureBgmEl(trackId) {
    if (_bgmEls[trackId]) return _bgmEls[trackId];
    const el = document.createElement('audio');
    el.loop = true;
    el.volume = trackId === 'menu' ? settings.menuMusicVol : settings.matchMusicVol;
    el.src = trackId === 'menu'
      ? 'https://raw.githubusercontent.com/nix812/Elemental-Clash-V2/main/audio/bgm-menu.mp3'
      : 'https://raw.githubusercontent.com/nix812/Elemental-Clash-V2/main/audio/bgm-battle.mp3';
    _bgmEls[trackId] = el;
    return el;
  }

  function loadMenuBGM()  { _ensureBgmEl('menu'); }
  function loadMatchBGM() { _ensureBgmEl('match'); }

  function _playBgm(trackId) {
    if (_activeBgm === trackId) return;
    // Stop current
    Object.entries(_bgmEls).forEach(([id, el]) => {
      if (el && id !== trackId) {
        el.pause();
        el.currentTime = 0;
      }
    });
    const el = _ensureBgmEl(trackId);
    if (!el) return;
    const on = trackId === 'menu' ? settings.menuMusicOn : settings.matchMusicOn;
    if (!on) return;
    el.volume = trackId === 'menu' ? settings.menuMusicVol : settings.matchMusicVol;
    el.play().catch(() => {});
    _activeBgm = trackId;
  }

  function _stopBgmEl() {
    Object.values(_bgmEls).forEach(el => { if (el) { el.pause(); el.currentTime = 0; } });
    _activeBgm = null;
  }



  function playMenuBGM()  { _playBgm('menu'); }
  function playMatchBGM() { _playBgm('match'); }
  function stopBGM()      { _pendingMatchPlay = false; _pendingMenuPlay = false; _stopBgmEl(); }

  // ── Settings API ─────────────────────────────────────────────────
  function setSFXVol(v) { settings.sfxVol = v; save(); if (sfxGain) sfxGain.gain.value = settings.sfxOn ? v : 0; if (humGain) humGain.gain.value = settings.sfxOn ? 0.07*v : 0; }

  function setMenuMusicVol(v) {
    settings.menuMusicVol = v; save();
    if (_bgmEls.menu) _bgmEls.menu.volume = v;
  }
  function setMatchMusicVol(v) {
    settings.matchMusicVol = v; save();
    if (_bgmEls.match) _bgmEls.match.volume = v;
  }
  function setMenuMusicOn(on) {
    settings.menuMusicOn = on; save();
    if (!on && _activeBgm === 'menu') _stopBgmEl();
    else if (on && _activeBgm !== 'match') playMenuBGM();
  }
  function setMatchMusicOn(on) {
    settings.matchMusicOn = on; save();
    if (!on && _activeBgm === 'match') _stopBgmEl();
  }
  // Legacy alias used elsewhere
  function setMusicVol(v) { setMenuMusicVol(v); setMatchMusicVol(v); }
  function setMusicOn(on) { setMenuMusicOn(on); setMatchMusicOn(on); }

  function setSFXOn(on) {
    settings.sfxOn = on; save();
    if (!ctx) return;
    sfxGain.gain.value = on ? settings.sfxVol : 0;
    humGain.gain.value = on ? 0.07 * settings.sfxVol : 0;
    if (on) startHum(); else stopHum();
  }

  // ── SFX: UI ──────────────────────────────────────────────────────
  function uiClick() {
    if (!ctx) return;
    osc('square', 880, 0.06, 0.15);
    osc('square', 1320, 0.04, 0.08);
  }

  function uiConfirm() {
    if (!ctx) return;
    osc('square', 440, 0.08, 0.12);
    setTimeout(() => osc('square', 660, 0.12, 0.18), 80);
    setTimeout(() => osc('square', 880, 0.15, 0.22), 160);
  }

  function uiBack() {
    if (!ctx) return;
    osc('square', 660, 0.06, 0.12);
    setTimeout(() => osc('square', 440, 0.1, 0.1), 60);
  }

  // ── SFX: Kill / Momentum ─────────────────────────────────────────
  function kill() {
    if (!ctx) return;
    // Punchy low thud
    osc('sine', 180, 0.18, 0.5, null, { freqEnd: 40 });
    noise(0.12, 0.35, null, { filterType:'highpass', freq:2000, Q:1 });
    // Rising sting
    setTimeout(() => {
      osc('sawtooth', 330, 0.25, 0.3, null, { freqEnd: 880 });
      osc('square',   440, 0.2,  0.2, null, { freqEnd: 1100 });
    }, 100);
  }

  function onFire() {
    if (!ctx) return;
    // Power surge — rising sweep
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        osc('sawtooth', 220 * (i+1), 0.35, 0.4, null, { freqEnd: 440 * (i+1) });
      }, i * 80);
    }
    noise(0.4, 0.25, null, { filterType:'highpass', freq:3000, Q:0.8 });
  }

  function death() {
    if (!ctx) return;
    osc('sawtooth', 220, 0.4, 0.4, null, { freqEnd: 55 });
    noise(0.3, 0.2, null, { filterType:'lowpass', freq:400, Q:1 });
  }

  // ── SFX: Weather zone entry ───────────────────────────────────────
  function weatherEnter(element) {
    if (!ctx) return;
    const freqMap = { storm:660, rain:440, blizzard:520, sandstorm:330, heatwave:550 };
    const freq = freqMap[element] || 440;
    osc('sine', freq * 0.5, 0.6, 0.15, null, { freqEnd: freq });
    osc('sine', freq,       0.8, 0.1,  null, { freqEnd: freq * 2 });
    noise(0.5, 0.12, null, { filterType:'bandpass', freq: freq * 1.5, Q: 2 });
  }

  // ── SFX: Abilities by element ─────────────────────────────────────
  const ELEM_SFX = {

    fire(idx) {
      // Aggressive whoosh + crackle distortion
      const ds = distort(60);
      ds.connect(sfxGain);
      noise(0.25, 0.55, ds, { filterType:'bandpass', freq: idx===2?2800:1800, Q:1.2 });
      osc('sawtooth', idx===2?320:220, 0.3, 0.4, null, { freqEnd: idx===2?80:50 });
    },

    water(idx) {
      // Fluid sweep — low rumble with watery filter
      noise(0.35, 0.4, null, { filterType:'lowpass', freq:600, Q:3 });
      osc('sine', idx===2?180:140, 0.4, 0.3, null, { freqEnd: idx===2?60:40 });
      osc('sine', 880, 0.15, 0.12, null, { freqEnd: 440 });
    },

    earth(idx) {
      // Deep thud + rumble
      osc('sine', 80, 0.45, 0.55, null, { freqEnd: 30 });
      osc('sine', 120, 0.3, 0.4, null, { freqEnd: 40 });
      noise(0.2, 0.5, null, { filterType:'lowpass', freq:300, Q:1 });
    },

    wind(idx) {
      // Airy sharp rush
      noise(0.3, 0.35, null, { filterType:'highpass', freq: idx===2?4000:2500, Q:0.8 });
      osc('sine', idx===2?660:440, 0.25, 0.15, null, { freqEnd: idx===2?1320:880 });
    },

    shadow(idx) {
      // Dark low pulse + high-end hiss
      osc('sawtooth', 110, 0.4, 0.45, null, { freqEnd: 55 });
      const ds = distort(80);
      ds.connect(sfxGain);
      noise(0.3, 0.3, ds, { filterType:'lowpass', freq:400, Q:2 });
    },

    arcane(idx) {
      // Crystalline digital burst
      osc('square', idx===2?1320:880, 0.2, 0.25, null, { freqEnd: idx===2?2640:1760 });
      osc('sine',   idx===2?660:440,  0.15, 0.2, null, { freqEnd: idx===2?1320:880 });
      noise(0.15, 0.2, null, { filterType:'highpass', freq:5000, Q:1 });
    },

    lightning(idx) {
      // Sharp crack + electric buzz
      noise(0.08, 0.7, null, { filterType:'highpass', freq:6000, Q:0.5 });
      osc('sawtooth', 440, 0.15, 0.35, null, { freqEnd: idx===2?1760:880 });
      const ds = distort(100);
      ds.connect(sfxGain);
      noise(0.12, 0.4, ds, { filterType:'bandpass', freq:3000, Q:2 });
    },

    ice(idx) {
      // Crisp high ping + freeze hiss
      osc('sine', idx===2?1760:1320, 0.2, 0.3, null, { freqEnd: idx===2?440:330 });
      noise(0.2, 0.3, null, { filterType:'highpass', freq:4500, Q:1.5 });
      osc('triangle', 220, 0.15, 0.2, null, { freqEnd: 110 });
    },

    metal(idx) {
      // Heavy clang + metallic ring
      osc('square', idx===2?330:220, 0.3, 0.5, null, { freqEnd: idx===2?165:110 });
      osc('sine',   idx===2?880:660, 0.25, 0.4, null, { freqEnd: idx===2?1760:1320 });
      noise(0.15, 0.3, null, { filterType:'bandpass', freq:2000, Q:4 });
    },

    nature(idx) {
      // Organic snap + vine whip
      noise(0.15, 0.45, null, { filterType:'bandpass', freq:800, Q:2 });
      osc('sine', idx===2?330:220, 0.25, 0.35, null, { freqEnd: idx===2?165:110 });
      osc('triangle', 660, 0.1, 0.15, null, { freqEnd: 220 });
    },
  };

  function ability(elementId, abilityIdx) {
    if (!ctx) return;
    const fn = ELEM_SFX[elementId];
    if (fn) fn(abilityIdx);
  }

  // ── Public ───────────────────────────────────────────────────────
  return {
    init, loadMenuBGM, loadMatchBGM,
    playMenuBGM, playMatchBGM, stopBGM,
    setSFXVol, setMusicVol, setMusicOn,
    setMenuMusicVol, setMatchMusicVol,
    setMenuMusicOn, setMatchMusicOn,
    setSFXOn,
    get sfxVol()        { return settings.sfxVol; },
    get menuMusicVol()  { return settings.menuMusicVol; },
    get matchMusicVol() { return settings.matchMusicVol; },
    get menuMusicOn()   { return settings.menuMusicOn; },
    get matchMusicOn()  { return settings.matchMusicOn; },
    // legacy
    get musicVol() { return settings.menuMusicVol; },
    get musicOn()  { return settings.menuMusicOn; },
    get sfxOn()    { return settings.sfxOn; },
    sfx: { uiClick, uiConfirm, uiBack, kill, onFire, death, weatherEnter, ability },
  };
})();

// Init audio on first user interaction
['click','keydown','touchstart'].forEach(ev =>
  document.addEventListener(ev, () => Audio.init(), { once: true, passive: true })
);


// Pre-warm BGM elements so they're ready when needed
Audio.loadMenuBGM();
Audio.loadMatchBGM();

