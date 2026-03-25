// ========== AUDIO SYSTEM — Dr Sound Guru III Edition ==========
// Full FM synthesis, convolution reverb, chorus, stereo field,
// compressor chains, unique sonic identity per hero element.
const Audio = (() => {
  let ctx = null;
  let masterGain, sfxGain, humGain, masterComp;
  let humOscs = [];
  let reverbBuffer = null;

  const settings = (() => {
    try {
      const s = JSON.parse(localStorage.getItem('ec_audio') || '{}');
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

  // ── Impulse response reverb (synthetic room) ──────────────────────────────
  function buildReverb(duration = 1.2, decay = 3.0, reverse = false) {
    if (!ctx) return null;
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * duration);
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = reverse ? (len - i) / len : i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return buf;
  }

  function makeReverb(amount = 0.25, duration = 1.0, decay = 2.5) {
    if (!ctx) return null;
    const conv = ctx.createConvolver();
    conv.buffer = buildReverb(duration, decay);
    const wet = ctx.createGain(); wet.gain.value = amount;
    const dry = ctx.createGain(); dry.gain.value = 1 - amount * 0.5;
    const out  = ctx.createGain(); out.gain.value = 1;
    conv.connect(wet); wet.connect(out); out.connect(sfxGain);
    return { input: conv, dry, out,
      connect(src) { src.connect(conv); src.connect(dry); dry.connect(sfxGain); } };
  }

  // ── Compressor ────────────────────────────────────────────────────────────
  function makeComp(threshold=-18, knee=6, ratio=4, attack=0.003, release=0.15) {
    if (!ctx) return null;
    const c = ctx.createDynamicsCompressor();
    c.threshold.value = threshold;
    c.knee.value = knee;
    c.ratio.value = ratio;
    c.attack.value = attack;
    c.release.value = release;
    c.connect(sfxGain);
    return c;
  }

  // ── Stereo panner ─────────────────────────────────────────────────────────
  function pan(val) {
    if (!ctx) return null;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) { p.pan.value = val; p.connect(sfxGain); }
    return p;
  }

  function init() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterComp = ctx.createDynamicsCompressor();
    masterComp.threshold.value = -6;
    masterComp.knee.value = 12;
    masterComp.ratio.value = 3;
    masterComp.attack.value = 0.001;
    masterComp.release.value = 0.1;
    masterGain = ctx.createGain(); masterGain.gain.value = 1.0;
    masterComp.connect(masterGain); masterGain.connect(ctx.destination);
    sfxGain = ctx.createGain(); sfxGain.gain.value = settings.sfxOn ? settings.sfxVol : 0;
    sfxGain.connect(masterComp);
    humGain = ctx.createGain(); humGain.gain.value = settings.sfxOn ? 0.05 * settings.sfxVol : 0;
    humGain.connect(masterComp);
    startHum();
    const active = document.querySelector('.screen.active');
    if (active && ['menu','hero-select','how-to-play','options'].includes(active.id)) playMenuBGM();
  }

  // ── Core synthesis primitives ─────────────────────────────────────────────

  // Oscillator with full ADSR envelope
  function osc(type, freq, dur, gainVal, destination, opts = {}) {
    if (!ctx) return null;
    const dest = destination || sfxGain;
    const g = ctx.createGain();
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, ctx.currentTime);
    if (opts.freqEnd !== undefined)
      o.frequency.exponentialRampToValueAtTime(Math.max(0.01, opts.freqEnd), ctx.currentTime + dur);
    if (opts.freqMod) { // vibrato
      const lfo = ctx.createOscillator();
      const lfoG = ctx.createGain();
      lfo.frequency.value = opts.freqMod.rate || 5;
      lfoG.gain.value = opts.freqMod.depth || 5;
      lfo.connect(lfoG); lfoG.connect(o.frequency);
      lfo.start(); lfo.stop(ctx.currentTime + dur + 0.05);
    }
    // ADSR
    const atk  = opts.attack  ?? 0.004;
    const dec  = opts.decay   ?? dur * 0.2;
    const sus  = opts.sustain ?? gainVal * 0.7;
    const rel  = opts.release ?? dur * 0.4;
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(gainVal, ctx.currentTime + atk);
    g.gain.linearRampToValueAtTime(sus, ctx.currentTime + atk + dec);
    g.gain.setValueAtTime(sus, ctx.currentTime + dur - rel);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g); g.connect(dest);
    o.start(); o.stop(ctx.currentTime + dur + 0.05);
    return { osc: o, gain: g };
  }

  // FM synthesis — carrier modulated by modulator
  function fm(carrierFreq, modRatio, modIndex, dur, gainVal, destination, opts = {}) {
    if (!ctx) return;
    const dest = destination || sfxGain;
    const carrier = ctx.createOscillator();
    const modulator = ctx.createOscillator();
    const modGain = ctx.createGain();
    const outGain = ctx.createGain();
    carrier.type = opts.carrierType || 'sine';
    modulator.type = opts.modType || 'sine';
    const modFreq = carrierFreq * modRatio;
    carrier.frequency.setValueAtTime(carrierFreq, ctx.currentTime);
    modulator.frequency.setValueAtTime(modFreq, ctx.currentTime);
    if (opts.carrierFreqEnd)
      carrier.frequency.exponentialRampToValueAtTime(Math.max(0.01, opts.carrierFreqEnd), ctx.currentTime + dur);
    modGain.gain.setValueAtTime(modFreq * modIndex, ctx.currentTime);
    if (opts.modIndexEnd !== undefined)
      modGain.gain.exponentialRampToValueAtTime(Math.max(0.01, modFreq * opts.modIndexEnd), ctx.currentTime + dur);
    modulator.connect(modGain); modGain.connect(carrier.frequency);
    const atk = opts.attack ?? 0.005;
    outGain.gain.setValueAtTime(0, ctx.currentTime);
    outGain.gain.linearRampToValueAtTime(gainVal, ctx.currentTime + atk);
    outGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    carrier.connect(outGain); outGain.connect(dest);
    carrier.start(); carrier.stop(ctx.currentTime + dur + 0.05);
    modulator.start(); modulator.stop(ctx.currentTime + dur + 0.05);
  }

  // Filtered noise burst
  function noise(dur, gainVal, destination, opts = {}) {
    if (!ctx) return;
    const bufSize = ctx.sampleRate * Math.min(dur + 0.1, 3);
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = opts.filterType || 'bandpass';
    filt.frequency.value = opts.freq || 800;
    filt.Q.value = opts.Q || 1.5;
    if (opts.freqEnd) filt.frequency.exponentialRampToValueAtTime(opts.freqEnd, ctx.currentTime + dur);
    const g = ctx.createGain();
    const atk = opts.attack ?? 0.003;
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(gainVal, ctx.currentTime + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    src.connect(filt); filt.connect(g); g.connect(destination || sfxGain);
    src.start(); src.stop(ctx.currentTime + dur + 0.05);
  }

  // Waveshaper distortion
  function distort(amount = 40) {
    const ws = ctx.createWaveShaper();
    const n = 512; const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
    }
    ws.curve = curve; ws.oversample = '4x';
    return ws;
  }

  // Chorus effect — slight detune + delay for width
  function makeChorus(rate = 1.5, depth = 0.003, delay = 0.02) {
    if (!ctx) return null;
    const delayNode = ctx.createDelay(0.1);
    delayNode.delayTime.value = delay;
    const lfo = ctx.createOscillator(); lfo.frequency.value = rate;
    const lfoG = ctx.createGain(); lfoG.gain.value = depth;
    lfo.connect(lfoG); lfoG.connect(delayNode.delayTime);
    lfo.start();
    return delayNode;
  }

  // Pitched percussive body (for kicks/toms)
  function kick(freq, dur, gainVal, destination) {
    if (!ctx) return;
    const dest = destination || sfxGain;
    const o = ctx.createOscillator(); o.type = 'sine';
    const g = ctx.createGain();
    o.frequency.setValueAtTime(freq * 3, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(freq * 0.5, ctx.currentTime + dur * 0.08);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * 0.15), ctx.currentTime + dur);
    g.gain.setValueAtTime(gainVal, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g); g.connect(dest);
    o.start(); o.stop(ctx.currentTime + dur + 0.05);
  }

  // Delay line for echo/slap
  function makeDelay(time = 0.12, feedback = 0.3, mix = 0.35) {
    if (!ctx) return null;
    const delay = ctx.createDelay(1.0);
    delay.delayTime.value = time;
    const fb = ctx.createGain(); fb.gain.value = feedback;
    const wet = ctx.createGain(); wet.gain.value = mix;
    delay.connect(fb); fb.connect(delay);
    delay.connect(wet); wet.connect(sfxGain);
    return delay;
  }

  // ── Arena hum ─────────────────────────────────────────────────────────────
  function startHum() {
    if (!settings.sfxOn) return;
    stopHum();
    [55, 110, 165].forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = i === 0 ? 'sine' : 'triangle';
      o.frequency.value = freq;
      g.gain.value = i === 0 ? 0.06 : i === 1 ? 0.025 : 0.01;
      // Subtle LFO tremolo
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.08 + i * 0.03;
      const lfoG = ctx.createGain(); lfoG.gain.value = 0.008;
      lfo.connect(lfoG); lfoG.connect(g.gain);
      lfo.start(); o.connect(g); g.connect(humGain); o.start();
      humOscs.push(o, lfo);
    });
  }

  function stopHum() {
    humOscs.forEach(o => { try { o.stop(); } catch {} });
    humOscs = [];
  }

  // ── Rift ambience ─────────────────────────────────────────────────────────
  // Layered creepy drone: sub-bass hum + detuned whistle + void rumble + sparse pings
  let _riftNodes = [];
  let _riftGain  = null;
  let _riftPingTimer = null;

  function startRiftAmbience() {
    if (!ctx || _riftNodes.length > 0) return;

    // Duck the BGM while in the rift — 30% of normal (audible but clearly secondary)
    const bgmEl = _bgmEls['match'];
    if (bgmEl) {
      bgmEl._preDuckVol = bgmEl.volume;
      bgmEl.volume = Math.max(0, bgmEl.volume * 0.30);
    }

    _riftGain = ctx.createGain();
    _riftGain.gain.setValueAtTime(0, ctx.currentTime);
    _riftGain.gain.linearRampToValueAtTime(settings.sfxOn ? settings.sfxVol * 0.72 : 0, ctx.currentTime + 2.5);
    _riftGain.connect(masterComp);

    // Layer 1: sub-bass drone — two slightly detuned sines for beating
    [42, 44.2].forEach((freq, i) => {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.value = freq;
      const g = ctx.createGain(); g.gain.value = i === 0 ? 0.80 : 0.55;
      // Slow tremolo LFO
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.12 + i * 0.07;
      const lfoG = ctx.createGain(); lfoG.gain.value = 0.06;
      lfo.connect(lfoG); lfoG.connect(g.gain);
      lfo.start(); o.connect(g); g.connect(_riftGain); o.start();
      _riftNodes.push(o, lfo);
    });

    // Layer 2: eerie upper whistle — detuned sawtooth pair, slow pitch wobble
    [880, 887.5].forEach((freq, i) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.value = freq;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.18 + i * 0.11;
      const lfoG = ctx.createGain(); lfoG.gain.value = 6 + i * 3;
      lfo.connect(lfoG); lfoG.connect(o.frequency);
      lfo.start();
      const filt = ctx.createBiquadFilter(); filt.type = 'lowpass';
      filt.frequency.value = 1200; filt.Q.value = 0.8;
      const g = ctx.createGain(); g.gain.value = 0.09;
      o.connect(filt); filt.connect(g); g.connect(_riftGain); o.start();
      _riftNodes.push(o, lfo);
    });

    // Layer 3: void rumble — bandpass filtered noise
    const bufSize = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noiseSrc = ctx.createBufferSource(); noiseSrc.buffer = buf; noiseSrc.loop = true;
    const bandFilt = ctx.createBiquadFilter(); bandFilt.type = 'bandpass';
    bandFilt.frequency.value = 80; bandFilt.Q.value = 0.6;
    const noiseGain = ctx.createGain(); noiseGain.gain.value = 0.45;
    const noiseLfo = ctx.createOscillator(); noiseLfo.frequency.value = 0.05;
    const noiseLfoG = ctx.createGain(); noiseLfoG.gain.value = 25;
    noiseLfo.connect(noiseLfoG); noiseLfoG.connect(bandFilt.frequency);
    noiseLfo.start(); noiseSrc.connect(bandFilt); bandFilt.connect(noiseGain);
    noiseGain.connect(_riftGain); noiseSrc.start();
    _riftNodes.push(noiseSrc, noiseLfo);

    // Layer 4: sparse eerie pings
    function schedulePing() {
      if (!_riftGain || _riftNodes.length === 0) return;
      const delay = 3.5 + Math.random() * 6.5;
      _riftPingTimer = setTimeout(() => {
        if (!ctx || _riftNodes.length === 0) return;
        const pingFreq = 600 + Math.random() * 800;
        const carrier = ctx.createOscillator(); carrier.type = 'sine';
        carrier.frequency.value = pingFreq;
        const mod = ctx.createOscillator(); mod.type = 'sine';
        mod.frequency.value = pingFreq * 2.8;
        const modG = ctx.createGain(); modG.gain.value = pingFreq * 1.2;
        const pingG = ctx.createGain();
        pingG.gain.setValueAtTime(0.12, ctx.currentTime);
        pingG.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.8);
        mod.connect(modG); modG.connect(carrier.frequency);
        carrier.connect(pingG); pingG.connect(_riftGain);
        carrier.start(); carrier.stop(ctx.currentTime + 2.0);
        mod.start(); mod.stop(ctx.currentTime + 2.0);
        schedulePing();
      }, delay * 1000);
    }
    schedulePing();
  }

  function stopRiftAmbience() {
    clearTimeout(_riftPingTimer);
    _riftPingTimer = null;
    if (!_riftGain && _riftNodes.length === 0) return; // already stopped

    const FADE = 1.8;

    // Fade rift audio out
    if (_riftGain) {
      _riftGain.gain.setValueAtTime(_riftGain.gain.value, ctx.currentTime);
      _riftGain.gain.linearRampToValueAtTime(0, ctx.currentTime + FADE);
    }

    // Restore BGM AFTER the rift audio has fully faded — not before
    const bgmEl = _bgmEls['match'];
    const savedVol = bgmEl?._preDuckVol;
    setTimeout(() => {
      _riftNodes.forEach(n => { try { n.stop(); } catch {} });
      _riftNodes = [];
      try { _riftGain?.disconnect(); } catch {}
      _riftGain = null;
      // Restore BGM now that rift audio is silent
      if (bgmEl && savedVol !== undefined) {
        bgmEl.volume = savedVol;
        bgmEl._preDuckVol = undefined;
      }
    }, (FADE + 0.1) * 1000);
  }

  // ── BGM ───────────────────────────────────────────────────────────────────
  const _bgmEls = { menu: null, match: null };
  let _wantBgm = null;
  let _unlocked = false;

  function _ensureBgmEl(trackId) {
    if (_bgmEls[trackId]) return _bgmEls[trackId];
    const el = document.createElement('audio'); el.loop = true;
    el.src = trackId === 'menu'
      ? 'https://raw.githubusercontent.com/nix812/Elemental-Clash-V2/main/audio/bgm-menu.mp3'
      : 'https://raw.githubusercontent.com/nix812/Elemental-Clash-V2/main/audio/bgm-battle.mp3';
    document.body.appendChild(el);
    _bgmEls[trackId] = el; return el;
  }

  function loadMenuBGM()  { _ensureBgmEl('menu'); }
  function loadMatchBGM() { _ensureBgmEl('match'); }

  function _applyBgmState() {
    Object.entries(_bgmEls).forEach(([id, el]) => {
      if (!el) return;
      if (id !== _wantBgm) { if (!el.paused) { el.pause(); el.currentTime = 0; } }
    });
    if (!_wantBgm) return;
    const el = _bgmEls[_wantBgm];
    if (!el) return;
    const on = _wantBgm === 'menu' ? settings.menuMusicOn : settings.matchMusicOn;
    el.volume = _wantBgm === 'menu' ? settings.menuMusicVol : settings.matchMusicVol;
    if (!on) return;
    if (el.paused) el.play().catch(() => {});
  }

  function unlockBGM() {
    if (_unlocked) return;
    const probe = _ensureBgmEl('menu');
    probe.muted = true;
    probe.play().then(() => {
      probe.pause(); probe.muted = false; _unlocked = true; _applyBgmState();
    }).catch(() => {});
  }

  function playMenuBGM()  { _ensureBgmEl('menu');  _wantBgm = 'menu';  _applyBgmState(); }
  function playMatchBGM() { _ensureBgmEl('match'); _wantBgm = 'match'; _applyBgmState(); }
  function stopBGM()      { _wantBgm = null; _applyBgmState(); }

  // ── Settings ──────────────────────────────────────────────────────────────
  function setSFXVol(v)        { settings.sfxVol = v; save(); if (sfxGain) sfxGain.gain.value = settings.sfxOn ? v : 0; if (humGain) humGain.gain.value = settings.sfxOn ? 0.05*v : 0; }
  function setMenuMusicVol(v)  { settings.menuMusicVol = v; save(); if (_bgmEls.menu) _bgmEls.menu.volume = v; }
  function setMatchMusicVol(v) { settings.matchMusicVol = v; save(); if (_bgmEls.match) _bgmEls.match.volume = v; }
  function setMenuMusicOn(on)  { settings.menuMusicOn = on; save(); if (!on && _wantBgm === 'menu') _wantBgm = null; else if (on && _wantBgm !== 'match') _wantBgm = 'menu'; _applyBgmState(); }
  function setMatchMusicOn(on) { settings.matchMusicOn = on; save(); if (!on && _wantBgm === 'match') _wantBgm = null; _applyBgmState(); }
  function setMusicVol(v)      { setMenuMusicVol(v); setMatchMusicVol(v); }
  function setMusicOn(on)      { setMenuMusicOn(on); setMatchMusicOn(on); }
  function setSFXOn(on)        { settings.sfxOn = on; save(); if (!ctx) return; sfxGain.gain.value = on ? settings.sfxVol : 0; humGain.gain.value = on ? 0.05*settings.sfxVol : 0; if (on) startHum(); else stopHum(); }

  // ── UI SFX ────────────────────────────────────────────────────────────────
  function uiClick() {
    if (!ctx) return;
    fm(1200, 2, 0.3, 0.07, 0.12);
    osc('sine', 1800, 0.05, 0.06, null, { attack: 0.001 });
  }

  function uiConfirm() {
    if (!ctx) return;
    [0, 80, 160].forEach((d, i) => {
      setTimeout(() => {
        const freqs = [523, 659, 784];
        fm(freqs[i], 1.5, 0.4, 0.15, 0.2 + i*0.02);
      }, d);
    });
  }

  function uiBack() {
    if (!ctx) return;
    fm(659, 1.5, 0.3, 0.07, 0.12);
    setTimeout(() => fm(523, 1.5, 0.2, 0.06, 0.1), 60);
  }

  // ── Countdown ─────────────────────────────────────────────────────────────
  function countdownBeep(isFinal) {
    if (!ctx) return;
    if (isFinal) {
      // GO! — big kick-off hit: punchy kick + rising FM chord + reverb burst
      const comp = makeComp(-8, 6, 4);
      kick(80, 0.5, 0.7, comp);   // deep body thud
      kick(160, 0.3, 0.4, comp);  // tight snap on top
      noise(0.15, 0.5, comp, { filterType:'bandpass', freq:2500, Q:1.2, attack:0.001 });
      // Rising chord — three voices sweeping up
      setTimeout(() => {
        fm(440, 2, 1.5, 0.5, 0.45, comp, { attack:0.002, carrierFreqEnd:880 });
        fm(660, 2, 1.0, 0.45, 0.40, comp, { attack:0.003, carrierFreqEnd:1320 });
        fm(880, 1.5, 0.6, 0.4, 0.35, comp, { attack:0.004, carrierFreqEnd:1760 });
      }, 40);
      // Reverb tail — big room feel
      const rev = makeReverb(0.5, 0.8, 3.5);
      if (rev) setTimeout(() => {
        fm(440, 2, 1.0, 0.6, 0.5, rev.input, { attack:0.01, carrierFreqEnd:880 });
      }, 60);
    } else {
      // 3, 2, 1 — clean tick beep
      fm(440, 2, 0.4, 0.2, 0.2, null, { attack: 0.001 });
    }
  }

  // ── Kill / Death / OnFire ─────────────────────────────────────────────────
  function kill(chain) {
    if (!ctx) return;
    const n = Math.min(chain || 1, 5);
    const comp = makeComp(-14 + n, 6, 5);

    if (n === 1) {
      // Single kill — punchy, clean
      kick(120, 0.35, 0.6, comp);
      noise(0.12, 0.4, comp, { filterType:'highpass', freq:3500, Q:0.8, attack:0.001 });
      setTimeout(() => {
        fm(440, 2.5, 1.2, 0.35, 0.3, comp, { attack:0.002, carrierFreqEnd:880 });
        fm(660, 2, 0.8, 0.25, 0.25, comp, { attack:0.003, carrierFreqEnd:1320 });
      }, 80);

    } else if (n === 2) {
      // Double kill — two punches, rising sting
      kick(140, 0.4, 0.65, comp);
      noise(0.14, 0.45, comp, { filterType:'highpass', freq:4000, Q:0.9, attack:0.001 });
      setTimeout(() => { kick(130, 0.3, 0.5, comp); }, 120);
      setTimeout(() => {
        fm(550, 2.5, 1.5, 0.4, 0.35, comp, { attack:0.002, carrierFreqEnd:1100 });
        fm(825, 2, 1.0, 0.3, 0.3, comp, { attack:0.002, carrierFreqEnd:1650 });
      }, 100);

    } else if (n === 3) {
      // Triple kill — three punches, bright fanfare
      for (let i = 0; i < 3; i++) {
        setTimeout(() => { kick(150 + i * 10, 0.35, 0.5, comp); }, i * 90);
      }
      noise(0.16, 0.5, comp, { filterType:'highpass', freq:5000, Q:1.0, attack:0.001 });
      setTimeout(() => {
        fm(660, 2.5, 2.0, 0.45, 0.4, comp, { attack:0.002, carrierFreqEnd:1320 });
        fm(990, 2, 1.2, 0.35, 0.35, comp, { attack:0.002, carrierFreqEnd:1980 });
        fm(440, 3, 0.8, 0.3, 0.2, comp, { attack:0.005, carrierFreqEnd:880 });
      }, 120);

    } else if (n === 4) {
      // Quad kill — heavy impact + soaring sting + reverb
      kick(160, 0.5, 0.7, comp);
      kick(80, 0.4, 0.8, comp);
      noise(0.2, 0.55, comp, { filterType:'bandpass', freq:3000, Q:1.2, attack:0.001 });
      setTimeout(() => {
        for (let i = 0; i < 4; i++) {
          fm(880 * Math.pow(1.25, i), 2, 1.8, 0.5, 0.35 - i * 0.05, comp, { attack:0.002 + i * 0.01, carrierFreqEnd:880 * Math.pow(1.25, i) * 2 });
        }
      }, 80);
      const rev = makeReverb(0.5, 0.7, 2.5);
      if (rev) setTimeout(() => { fm(880, 2.5, 1.5, 0.6, 0.45, rev.input, { attack:0.01, carrierFreqEnd:1760 }); }, 100);

    } else {
      // RAMPAGE (5) — full orchestral hit, everything fires
      kick(180, 0.6, 0.8, comp);
      kick(90, 0.5, 1.0, comp);
      noise(0.25, 0.6, comp, { filterType:'bandpass', freq:2500, Q:1.5, attack:0.001 });
      setTimeout(() => {
        for (let i = 0; i < 5; i++) {
          setTimeout(() => {
            fm(440 * Math.pow(1.3, i), 2.5, 2.5, 0.6, 0.4 - i * 0.04, comp, { attack:0.002, carrierFreqEnd:440 * Math.pow(1.3, i) * 2.5 });
          }, i * 40);
        }
      }, 60);
      const rev2 = makeReverb(0.6, 0.8, 4.0);
      if (rev2) {
        setTimeout(() => { fm(1320, 2, 2.0, 0.8, 0.5, rev2.input, { attack:0.005, carrierFreqEnd:2640 }); }, 80);
        setTimeout(() => { fm(660, 3, 1.5, 0.7, 0.4, rev2.input, { attack:0.01, carrierFreqEnd:1320 }); }, 140);
      }
    }
  }

  function onFire() {
    if (!ctx) return;
    const comp = makeComp(-10, 8, 6);
    // Power surge with FM harmonics
    for (let i = 0; i < 4; i++) {
      setTimeout(() => {
        fm(110 * (i+1), 3, 2.0 - i*0.3, 0.4 - i*0.05, 0.5, comp, {
          attack: 0.002, carrierFreqEnd: 220 * (i+1), modIndexEnd: 0.1
        });
      }, i * 60);
    }
    noise(0.5, 0.3, comp, { filterType:'bandpass', freq:3000, Q:1.5, attack:0.003 });
    // Reverb tail
    const rev = makeReverb(0.4, 0.6, 3.0);
    if (rev) fm(440, 2, 0.5, 0.2, 0.4, rev.input, { attack:0.01, carrierFreqEnd:880 });
  }

  function death() {
    if (!ctx) return;
    const comp = makeComp(-16, 6, 5);
    // Falling FM tone
    fm(300, 1.5, 3.0, 0.5, 0.6, comp, { attack:0.003, carrierFreqEnd:40, modIndexEnd:0.2 });
    noise(0.4, 0.3, comp, { filterType:'lowpass', freq:600, Q:1.5, freqEnd:100, attack:0.002 });
    // Reverse reverb feel
    setTimeout(() => {
      osc('sine', 80, 0.5, 0.35, comp, { attack:0.01, freqEnd:30 });
    }, 100);
  }

  // ── Weather zone entry ────────────────────────────────────────────────────
  function weatherEnter(element) {
    if (!ctx) return;
    const freqMap = { storm:660, rain:440, blizzard:520, sandstorm:330, heatwave:550 };
    const freq = freqMap[element?.toLowerCase()] || 440;
    const rev = makeReverb(0.5, 0.8, 2.5);
    const dest = rev ? rev.input : null;
    fm(freq * 0.5, 2, 0.6, 0.2, 0.18, dest, { attack:0.02, carrierFreqEnd:freq });
    noise(0.6, 0.12, dest, { filterType:'bandpass', freq:freq*1.2, Q:2, attack:0.01 });
  }

  // ── Auto-attack ───────────────────────────────────────────────────────────
  function autoAttack(elementId) {
    if (!ctx) return;
    // Short element-tuned burst — distinct per hero
    const configs = {
      fire:      () => { noise(0.07, 0.25, null, { filterType:'bandpass', freq:2200, Q:2, attack:0.001 }); fm(180, 3, 1.5, 0.15, 0.06, null, { attack:0.001, carrierFreqEnd:80 }); },
      water:     () => { noise(0.09, 0.18, null, { filterType:'lowpass', freq:800, Q:3, attack:0.002 }); osc('sine', 660, 0.05, 0.1, null, { attack:0.001, freqEnd:330 }); },
      earth:     () => { kick(60, 0.1, 0.3, null); noise(0.05, 0.3, null, { filterType:'lowpass', freq:300, Q:1, attack:0.001 }); },
      wind:      () => { noise(0.06, 0.2, null, { filterType:'highpass', freq:3500, Q:0.8, attack:0.001 }); osc('sine', 1200, 0.04, 0.08, null, { attack:0.001, freqEnd:2400 }); },
      shadow:    () => { fm(120, 4, 2.0, 0.2, 0.08, null, { attack:0.002, carrierFreqEnd:60 }); noise(0.05, 0.15, null, { filterType:'lowpass', freq:400, Q:2, attack:0.001 }); },
      arcane:    () => { fm(1200, 1.5, 0.4, 0.15, 0.07, null, { attack:0.001, carrierFreqEnd:1800 }); noise(0.04, 0.12, null, { filterType:'highpass', freq:5000, Q:1, attack:0.001 }); },
      lightning: () => { noise(0.04, 0.4, null, { filterType:'highpass', freq:7000, Q:0.5, attack:0.001 }); fm(600, 5, 3.0, 0.2, 0.05, null, { attack:0.001, carrierFreqEnd:200 }); },
      ice:       () => { osc('sine', 1760, 0.06, 0.15, null, { attack:0.001, freqEnd:880 }); noise(0.05, 0.15, null, { filterType:'highpass', freq:5000, Q:2, attack:0.001 }); },
      metal:     () => { fm(300, 5.5, 2.0, 0.2, 0.08, null, { attack:0.001, carrierFreqEnd:150 }); noise(0.04, 0.2, null, { filterType:'bandpass', freq:3000, Q:4, attack:0.001 }); },
      nature:    () => { noise(0.07, 0.2, null, { filterType:'bandpass', freq:900, Q:2.5, attack:0.002 }); osc('triangle', 440, 0.06, 0.1, null, { attack:0.002, freqEnd:220 }); },
    };
    const fn = configs[elementId];
    if (fn) fn();
  }

  function autoAttackHit() {
    if (!ctx) return;
    kick(80, 0.06, 0.2, null);
    noise(0.04, 0.22, null, { filterType:'highpass', freq:4000, Q:0.8, attack:0.001 });
  }

  // ── Hit received ──────────────────────────────────────────────────────────
  function hitReceived(isCritical) {
    if (!ctx) return;
    const comp = makeComp(-18, 6, 8, 0.001, 0.08);
    if (isCritical) {
      kick(60, 0.2, 0.55, comp);
      const ds = distort(120); ds.connect(comp);
      noise(0.25, 0.6, ds, { filterType:'lowpass', freq:500, Q:1.5, attack:0.001 });
      noise(0.15, 0.3, comp, { filterType:'highpass', freq:3000, Q:1, attack:0.001 });
    } else {
      kick(90, 0.1, 0.3, comp);
      noise(0.08, 0.2, comp, { filterType:'lowpass', freq:900, Q:1, attack:0.001 });
    }
  }

  // ── Sprint ────────────────────────────────────────────────────────────────
  function sprint() {
    if (!ctx) return;
    noise(0.12, 0.32, null, { filterType:'highpass', freq:1800, Q:0.7, attack:0.002, freqEnd:4000 });
    fm(330, 2, 0.8, 0.15, 0.1, null, { attack:0.003, carrierFreqEnd:660 });
  }

  // ── Warp gate ─────────────────────────────────────────────────────────────
  function warp() {
    if (!ctx) return;
    const rev = makeReverb(0.45, 0.7, 2.8);
    if (rev) {
      fm(880, 3, 2.0, 0.35, 0.2, rev.input, { attack:0.003, carrierFreqEnd:220, modIndexEnd:0.05 });
      noise(0.2, 0.2, rev.input, { filterType:'bandpass', freq:1500, Q:2, attack:0.003 });
      setTimeout(() => {
        fm(220, 2, 1.5, 0.3, 0.25, rev.input, { attack:0.004, carrierFreqEnd:1760, modIndexEnd:0.1 });
      }, 130);
    }
  }

  // ── Rock sounds ───────────────────────────────────────────────────────────
  function rockHit() {
    if (!ctx) return;
    kick(55, 0.08, 0.28, null);
    noise(0.08, 0.38, null, { filterType:'bandpass', freq:400, Q:1.5, attack:0.001 });
  }

  function rockDestroy() {
    if (!ctx) return;
    const comp = makeComp(-14, 6, 5);
    kick(45, 0.3, 0.55, comp);
    kick(70, 0.2, 0.4, comp);
    noise(0.45, 0.7, comp, { filterType:'lowpass', freq:700, Q:1, attack:0.001 });
    setTimeout(() => {
      noise(0.3, 0.5, comp, { filterType:'highpass', freq:1800, Q:0.8, attack:0.001 });
      noise(0.25, 0.35, comp, { filterType:'bandpass', freq:3500, Q:1.5, attack:0.01 });
    }, 50);
    // Reverb tail for arena feel
    const rev = makeReverb(0.3, 0.5, 2.0);
    if (rev) noise(0.4, 0.3, rev.input, { filterType:'lowpass', freq:500, Q:1, attack:0.003 });
  }

  // ── Pickups ───────────────────────────────────────────────────────────────
  function pickupHealth() {
    if (!ctx) return;
    const rev = makeReverb(0.3, 0.4, 2.0);
    if (rev) {
      [0, 60, 110].forEach((d, i) => {
        const freqs = [523, 659, 784];
        setTimeout(() => fm(freqs[i], 2, 0.3, 0.18 - i*0.02, 0.2, rev.input, { attack:0.003 }), d);
      });
    }
  }

  function pickupMana() {
    if (!ctx) return;
    const rev = makeReverb(0.35, 0.4, 2.5);
    if (rev) {
      [0, 70].forEach((d, i) => {
        const freqs = [440, 660];
        setTimeout(() => {
          fm(freqs[i], 1.5, 0.4, 0.18 - i*0.03, 0.2, rev.input, { attack:0.003 });
          osc('sine', freqs[i] * 2, 0.15, 0.06, rev.input, { attack:0.003 });
        }, d);
      });
    }
  }

  // ── HERO ABILITY SFX — Dr Sound Guru III signatures ──────────────────────
  // Each hero has three ability sounds (Q=0, E=1, R=2/ult)
  // Built from scratch to match elemental identity

  const ELEM_SFX = {

    // EMBER 🔥 — Aggressive, crackling, dangerous
    // Q: fireball burst — explosive pop with crackling tail
    // E: ring of fire — sustained roar with oscillating heat
    // R: inferno — massive wall of flame, distorted fury
    fire(idx) {
      const comp = makeComp(-16, 6, 5);
      if (idx === 0) {
        kick(120, 0.12, 0.4, comp);
        const ds = distort(70); ds.connect(comp);
        noise(0.25, 0.55, ds, { filterType:'bandpass', freq:1800, Q:1.5, attack:0.002 });
        fm(200, 3.5, 2.5, 0.3, 0.22, comp, { attack:0.004, carrierFreqEnd:60, modIndexEnd:0.1 });
        noise(0.4, 0.35, comp, { filterType:'highpass', freq:3000, Q:0.8, attack:0.005 });
      } else if (idx === 1) {
        const ds = distort(50); ds.connect(comp);
        noise(0.6, 0.5, ds, { filterType:'bandpass', freq:900, Q:2, attack:0.01, freqEnd:1800 });
        fm(140, 4, 3.0, 0.35, 0.55, comp, { attack:0.01, carrierFreqEnd:80,
          modIndexEnd:0.5, modType:'sawtooth' });
        noise(0.5, 0.25, comp, { filterType:'highpass', freq:2500, Q:1, attack:0.015 });
      } else {
        // ULT — inferno
        const rev = makeReverb(0.4, 1.0, 3.5);
        if (rev) {
          const ds = distort(100); ds.connect(rev.input);
          noise(1.2, 0.7, ds, { filterType:'lowpass', freq:1200, Q:1.5, attack:0.005, freqEnd:600 });
          fm(80, 5, 4.0, 0.5, 0.9, rev.input, { attack:0.008, carrierFreqEnd:40, modIndexEnd:0.3, modType:'sawtooth' });
          noise(0.8, 0.5, rev.input, { filterType:'highpass', freq:2000, Q:0.8, attack:0.01 });
          setTimeout(() => kick(40, 0.5, 0.7, rev.input), 150);
        }
      }
    },

    // TIDE 🌊 — Deep, fluid, pressure
    // Q: water bolt — hollow rush with deep rumble
    // E: whirlpool — spinning filter sweep
    // R: tidal wave — enormous low-end pressure wave
    water(idx) {
      const comp = makeComp(-18, 8, 4);
      if (idx === 0) {
        noise(0.3, 0.45, comp, { filterType:'lowpass', freq:700, Q:3, attack:0.005, freqEnd:400 });
        fm(160, 2, 1.5, 0.3, 0.28, comp, { attack:0.008, carrierFreqEnd:50 });
        osc('sine', 1200, 0.18, 0.08, comp, { attack:0.003, freqEnd:600 });
      } else if (idx === 1) {
        // Whirlpool — spinning filter sweep with LFO
        const rev = makeReverb(0.5, 0.8, 3.0);
        if (rev) {
          noise(0.7, 0.4, rev.input, { filterType:'bandpass', freq:400, Q:4, attack:0.01, freqEnd:1200 });
          fm(100, 3, 2.0, 0.35, 0.65, rev.input, { attack:0.01, carrierFreqEnd:200,
            modIndexEnd:0.3, freqMod:{ rate:2.5, depth:40 } });
        }
      } else {
        // TIDAL WAVE — enormous pressure
        const rev = makeReverb(0.55, 1.2, 4.0);
        if (rev) {
          kick(35, 0.6, 0.7, rev.input);
          noise(1.5, 0.65, rev.input, { filterType:'lowpass', freq:500, Q:2, attack:0.003, freqEnd:150 });
          fm(60, 2.5, 4.0, 0.5, 1.0, rev.input, { attack:0.005, carrierFreqEnd:25, modIndexEnd:0.5 });
          setTimeout(() => noise(0.8, 0.4, rev.input, { filterType:'bandpass', freq:300, Q:3, attack:0.01 }), 200);
        }
      }
    },

    // STONE 🪨 — Heavy, seismic, brutal
    // Q: boulder throw — massive thud with debris
    // E: shockwave — ground rumble pulse
    // R: earthquake — earth-splitting seismic event
    earth(idx) {
      const comp = makeComp(-12, 6, 6);
      if (idx === 0) {
        kick(55, 0.18, 0.55, comp);
        kick(80, 0.12, 0.35, comp);
        noise(0.25, 0.6, comp, { filterType:'lowpass', freq:400, Q:1.5, attack:0.002 });
        noise(0.2, 0.4, comp, { filterType:'highpass', freq:1500, Q:1, attack:0.01 });
      } else if (idx === 1) {
        kick(40, 0.25, 0.6, comp);
        noise(0.5, 0.55, comp, { filterType:'lowpass', freq:300, Q:2, attack:0.003, freqEnd:150 });
        fm(70, 1.5, 3.0, 0.4, 0.5, comp, { attack:0.005, carrierFreqEnd:30, modIndexEnd:0.2,
          freqMod:{ rate:8, depth:15 } });
      } else {
        // EARTHQUAKE
        const rev = makeReverb(0.6, 1.5, 5.0);
        if (rev) {
          for (let i = 0; i < 4; i++) {
            setTimeout(() => {
              kick(35 + i*5, 0.4, 0.7, rev.input);
              noise(0.3, 0.5, rev.input, { filterType:'lowpass', freq:250, Q:1.5, attack:0.002 });
            }, i * 120);
          }
          fm(50, 2, 5.0, 0.5, 1.2, rev.input, { attack:0.01, carrierFreqEnd:20, modIndexEnd:0.8,
            freqMod:{ rate:12, depth:20 } });
        }
      }
    },

    // GALE 💨 — Airy, fast, slicing
    // Q: wind blade — sharp hiss with cutting edge
    // E: tailwind dash — doppler rush
    // R: tornado — cyclonic roar building to peak
    wind(idx) {
      const comp = makeComp(-18, 8, 4);
      if (idx === 0) {
        noise(0.18, 0.45, comp, { filterType:'highpass', freq:3000, Q:1, attack:0.002, freqEnd:6000 });
        fm(800, 3, 1.0, 0.25, 0.15, comp, { attack:0.002, carrierFreqEnd:2400, modIndexEnd:0.05 });
        osc('sawtooth', 1200, 0.08, 0.08, comp, { attack:0.001, freqEnd:2800 });
      } else if (idx === 1) {
        // Doppler rush past
        noise(0.3, 0.5, comp, { filterType:'highpass', freq:1500, Q:0.8, attack:0.001, freqEnd:8000 });
        fm(600, 2, 0.8, 0.3, 0.25, comp, { attack:0.002, carrierFreqEnd:1800 });
      } else {
        // TORNADO
        const rev = makeReverb(0.45, 1.0, 3.0);
        if (rev) {
          noise(1.5, 0.6, rev.input, { filterType:'bandpass', freq:600, Q:2, attack:0.02, freqEnd:2400 });
          fm(300, 4, 3.0, 0.4, 1.2, rev.input, { attack:0.015, carrierFreqEnd:800,
            freqMod:{ rate:6, depth:80 } });
          osc('sawtooth', 800, 0.5, 0.2, rev.input, { attack:0.02,
            freqEnd:2000, freqMod:{ rate:4, depth:100 } });
        }
      }
    },

    // VOID 🌀 — Dark, subterranean, unnatural
    // Q: void bolt — deep hollow resonance with high end tear
    // E: phase step — digital glitch warble
    // R: singularity — black hole suction with collapsing tone
    shadow(idx) {
      const comp = makeComp(-14, 6, 6);
      if (idx === 0) {
        const ds = distort(90); ds.connect(comp);
        fm(90, 6, 4.0, 0.4, 0.35, ds, { attack:0.003, carrierFreqEnd:45, modIndexEnd:0.3, modType:'square' });
        noise(0.25, 0.35, comp, { filterType:'lowpass', freq:500, Q:2, attack:0.003 });
        osc('sine', 3000, 0.08, 0.06, comp, { attack:0.001, freqEnd:200 });
      } else if (idx === 1) {
        // Digital glitch — rapid pitch flutter
        for (let i = 0; i < 6; i++) {
          setTimeout(() => {
            const f = 200 + Math.random() * 1800;
            fm(f, 3 + Math.random()*2, 2.0, 0.15, 0.05, comp, { attack:0.001, carrierFreqEnd:f*0.3 });
          }, i * 25);
        }
        noise(0.15, 0.3, comp, { filterType:'bandpass', freq:2000, Q:3, attack:0.002 });
      } else {
        // SINGULARITY — suction into void
        const rev = makeReverb(0.5, 1.0, 4.0);
        if (rev) {
          const ds = distort(150); ds.connect(rev.input);
          fm(200, 8, 6.0, 0.5, 1.5, ds, { attack:0.005, carrierFreqEnd:15, modIndexEnd:0.5,
            modType:'sawtooth', freqMod:{ rate:0.5, depth:30 } });
          noise(1.2, 0.5, ds, { filterType:'lowpass', freq:800, Q:2, attack:0.005, freqEnd:50 });
          osc('sine', 60, 0.7, 0.8, rev.input, { attack:0.01, freqEnd:15 });
        }
      }
    },

    // MYST ✨ — Crystalline, precise, otherworldly
    // Q: arcane bolt — glass-like resonance with shimmer
    // E: arcane echo — layered crystalline chime
    // R: arcane nova — kaleidoscopic burst with reverb bloom
    arcane(idx) {
      const comp = makeComp(-18, 6, 4);
      if (idx === 0) {
        fm(1800, 1.5, 0.5, 0.3, 0.15, comp, { attack:0.002, carrierFreqEnd:3200 });
        osc('sine', 2400, 0.12, 0.08, comp, { attack:0.001, freqEnd:1200 });
        noise(0.1, 0.2, comp, { filterType:'highpass', freq:6000, Q:1.5, attack:0.002 });
      } else if (idx === 1) {
        // Layered echo shimmer
        const rev = makeReverb(0.5, 0.5, 3.5);
        if (rev) {
          [0, 40, 80].forEach((d, i) => {
            setTimeout(() => {
              const base = 1320 * (1 + i * 0.5);
              fm(base, 2, 0.4, 0.2 - i*0.04, 0.2, rev.input, { attack:0.002, carrierFreqEnd:base*1.5 });
            }, d);
          });
        }
      } else {
        // ARCANE NOVA — kaleidoscopic
        const rev = makeReverb(0.6, 0.8, 4.0);
        if (rev) {
          [1, 1.25, 1.5, 2, 2.5].forEach((ratio, i) => {
            setTimeout(() => {
              fm(880 * ratio, 2, 0.5 - i*0.05, 0.3 - i*0.04, 0.5, rev.input,
                { attack:0.003, carrierFreqEnd:880*ratio*1.5 });
            }, i * 40);
          });
          noise(0.5, 0.25, rev.input, { filterType:'highpass', freq:5000, Q:1, attack:0.005 });
        }
      }
    },

    // VOLT ⚡ — Electric, snappy, violent
    // Q: lightning bolt — instant crack with electric haze
    // E: static charge — buzzing tension building
    // R: thunderstrike — massive electric slam
    lightning(idx) {
      const comp = makeComp(-12, 4, 8);
      if (idx === 0) {
        // Instant crack — zero attack
        noise(0.06, 0.8, comp, { filterType:'highpass', freq:8000, Q:0.5, attack:0.001 });
        const ds = distort(120); ds.connect(comp);
        fm(800, 7, 5.0, 0.5, 0.05, ds, { attack:0.001, carrierFreqEnd:100, modIndexEnd:0.1 });
        noise(0.15, 0.4, ds, { filterType:'bandpass', freq:4000, Q:2, attack:0.001 });
      } else if (idx === 1) {
        // Static charge building
        const ds = distort(80); ds.connect(comp);
        noise(0.4, 0.45, ds, { filterType:'bandpass', freq:2500, Q:3, attack:0.005, freqEnd:5000 });
        fm(200, 6, 3.0, 0.3, 0.35, ds, { attack:0.01, carrierFreqEnd:800,
          freqMod:{ rate:15, depth:50 } });
      } else {
        // THUNDERSTRIKE — massive electric slam
        const rev = makeReverb(0.4, 0.8, 3.0);
        if (rev) {
          const ds = distort(180); ds.connect(rev.input);
          noise(0.05, 1.0, ds, { filterType:'highpass', freq:6000, Q:0.4, attack:0.001 });
          kick(50, 0.15, 0.8, rev.input);
          fm(1200, 10, 8.0, 0.6, 0.1, ds, { attack:0.001, carrierFreqEnd:30, modIndexEnd:0.2 });
          setTimeout(() => {
            noise(0.6, 0.5, ds, { filterType:'bandpass', freq:3000, Q:1.5, attack:0.003 });
            fm(400, 5, 3.0, 0.4, 0.5, rev.input, { attack:0.005, carrierFreqEnd:100 });
          }, 40);
        }
      }
    },

    // FROST ❄️ — Crisp, crystalline, slowing
    // Q: ice shard — high glass ping with freeze hiss
    // E: frost nova — expanding ice burst ring
    // R: blizzard — howling cold wall
    ice(idx) {
      const comp = makeComp(-18, 6, 4);
      if (idx === 0) {
        fm(2200, 1.5, 0.3, 0.3, 0.12, comp, { attack:0.001, carrierFreqEnd:880 });
        osc('sine', 3500, 0.08, 0.06, comp, { attack:0.001, freqEnd:1760 });
        noise(0.18, 0.3, comp, { filterType:'highpass', freq:5500, Q:2, attack:0.002 });
        // Freeze tail
        const rev = makeReverb(0.4, 0.4, 4.0);
        if (rev) osc('sine', 1760, 0.08, 0.15, rev.input, { attack:0.01, freqEnd:440 });
      } else if (idx === 1) {
        // Expanding ring — pitch sweeps outward
        const rev = makeReverb(0.55, 0.6, 3.5);
        if (rev) {
          fm(800, 2, 0.5, 0.3, 0.4, rev.input, { attack:0.003, carrierFreqEnd:2400,
            modIndexEnd:0.05 });
          noise(0.4, 0.35, rev.input, { filterType:'bandpass', freq:2000, Q:3,
            attack:0.005, freqEnd:6000 });
          osc('triangle', 4400, 0.08, 0.2, rev.input, { attack:0.005, freqEnd:220 });
        }
      } else {
        // BLIZZARD — howling cold wall
        const rev = makeReverb(0.65, 1.5, 5.0);
        if (rev) {
          noise(1.8, 0.55, rev.input, { filterType:'highpass', freq:1200, Q:0.7,
            attack:0.02, freqEnd:3000 });
          fm(400, 3, 2.0, 0.4, 1.5, rev.input, { attack:0.02, carrierFreqEnd:600,
            freqMod:{ rate:3, depth:60 } });
          noise(1.0, 0.4, rev.input, { filterType:'bandpass', freq:800, Q:2,
            attack:0.03, freqEnd:2000 });
        }
      }
    },

    // FORGE ⚙️ — Industrial, heavy metal, clanging
    // Q: hammer strike — metallic clang with ring decay
    // E: iron will — grinding power activation
    // R: molten slam — superheated metal impact
    metal(idx) {
      const comp = makeComp(-14, 5, 6);
      if (idx === 0) {
        // Metallic clang
        fm(350, 5.5, 3.0, 0.5, 0.18, comp, { attack:0.001, carrierFreqEnd:175,
          modIndexEnd:0.1 });
        fm(1400, 4, 1.5, 0.3, 0.25, comp, { attack:0.001, carrierFreqEnd:700,
          modIndexEnd:0.05 });
        noise(0.1, 0.4, comp, { filterType:'bandpass', freq:3500, Q:4, attack:0.001 });
      } else if (idx === 1) {
        // Grinding power activation — rising industrial hum
        const ds = distort(60); ds.connect(comp);
        fm(110, 7, 4.0, 0.4, 0.5, ds, { attack:0.01, carrierFreqEnd:220,
          modIndexEnd:0.5, modType:'sawtooth', freqMod:{ rate:3, depth:20 } });
        noise(0.5, 0.35, ds, { filterType:'bandpass', freq:1500, Q:2, attack:0.01, freqEnd:3000 });
      } else {
        // MOLTEN SLAM — superheated impact
        const rev = makeReverb(0.35, 0.8, 3.0);
        if (rev) {
          kick(40, 0.3, 0.65, rev.input);
          const ds = distort(80); ds.connect(rev.input);
          fm(200, 6, 5.0, 0.55, 0.25, ds, { attack:0.002, carrierFreqEnd:50,
            modIndexEnd:0.3, modType:'sawtooth' });
          noise(0.4, 0.6, ds, { filterType:'lowpass', freq:1200, Q:1.5, attack:0.003 });
          fm(600, 4, 2.0, 0.3, 0.5, rev.input, { attack:0.005, carrierFreqEnd:2400,
            modIndexEnd:0.1 });
        }
      }
    },

    // FLORA 🌿 — Organic, lush, resonant
    // Q: thorn whip — woody snap with green resonance
    // E: overgrowth — wet organic burst with leafy texture
    // R: entangle — deep root rumble with vine creep
    nature(idx) {
      const comp = makeComp(-18, 7, 4);
      if (idx === 0) {
        noise(0.12, 0.5, comp, { filterType:'bandpass', freq:1000, Q:3, attack:0.001 });
        fm(280, 2.5, 1.5, 0.3, 0.1, comp, { attack:0.002, carrierFreqEnd:140 });
        osc('triangle', 800, 0.1, 0.06, comp, { attack:0.002, freqEnd:400 });
      } else if (idx === 1) {
        // Wet burst — swelling organic texture
        const rev = makeReverb(0.45, 0.6, 3.0);
        if (rev) {
          noise(0.5, 0.5, rev.input, { filterType:'bandpass', freq:600, Q:2.5,
            attack:0.005, freqEnd:1800 });
          fm(200, 2, 1.5, 0.35, 0.45, rev.input, { attack:0.008, carrierFreqEnd:400,
            freqMod:{ rate:4, depth:30 } });
          osc('triangle', 1200, 0.1, 0.2, rev.input, { attack:0.01, freqEnd:300 });
        }
      } else {
        // ENTANGLE — deep root rumble
        const rev = makeReverb(0.6, 1.2, 4.5);
        if (rev) {
          kick(50, 0.3, 0.6, rev.input);
          fm(100, 2, 2.5, 0.45, 1.0, rev.input, { attack:0.008, carrierFreqEnd:200,
            modIndexEnd:0.3, freqMod:{ rate:1.5, depth:25 } });
          noise(0.7, 0.4, rev.input, { filterType:'bandpass', freq:800, Q:2,
            attack:0.01, freqEnd:300 });
          // Vine creep — ascending woody pops
          for (let i = 0; i < 4; i++) {
            setTimeout(() => {
              noise(0.08, 0.3, rev.input, { filterType:'bandpass', freq:1200 + i*300,
                Q:3, attack:0.001 });
            }, 100 + i * 80);
          }
        }
      }
    },
  };

  function ability(elementId, abilityIdx) {
    if (!ctx) return;
    const fn = ELEM_SFX[elementId];
    if (fn) fn(abilityIdx);
  }

  // ── Maelstrom ─────────────────────────────────────────────────────────────
  function maelstromSpawn() {
    if (!ctx) return;
    const rev = makeReverb(0.7, 2.5, 6.0);
    const comp = makeComp(-8, 10, 8);
    if (rev) {
      // Sub bass surge
      osc('sine', 30, 2.5, 0.7, rev.input, { attack:0.02, freqEnd:55 });
      kick(25, 0.5, 0.9, rev.input);
      // Mid rumble
      fm(80, 4, 5.0, 0.6, 1.5, rev.input, { attack:0.01, carrierFreqEnd:40, modIndexEnd:0.5,
        freqMod:{ rate:0.3, depth:15 } });
      // High chaos noise
      noise(1.5, 0.45, rev.input, { filterType:'lowpass', freq:600, Q:1.5, attack:0.005, freqEnd:200 });
      // Rising sting at 400ms
      setTimeout(() => {
        fm(220, 3, 2.0, 0.5, 0.8, rev.input, { attack:0.01, carrierFreqEnd:880, modIndexEnd:0.1 });
        noise(0.8, 0.4, rev.input, { filterType:'highpass', freq:1500, Q:1, attack:0.01 });
      }, 400);
    }
  }

  function maelstromImplode() {
    if (!ctx) return;
    const rev = makeReverb(0.65, 1.5, 5.0);
    if (rev) {
      // Everything collapses to silence — descending crash
      fm(400, 5, 6.0, 0.7, 0.8, rev.input, { attack:0.003, carrierFreqEnd:10, modIndexEnd:0.8,
        modType:'sawtooth' });
      noise(0.6, 0.7, rev.input, { filterType:'lowpass', freq:1000, Q:1, attack:0.003, freqEnd:30 });
      osc('sine', 55, 0.9, 0.7, rev.input, { attack:0.005, freqEnd:10 });
      setTimeout(() => {
        // Aftershock
        kick(25, 0.3, 0.8, rev.input);
        noise(0.4, 0.35, rev.input, { filterType:'highpass', freq:3000, Q:1, attack:0.001 });
      }, 300);
    }
  }

  // ── Sprint / Warp / Hit / Pickup / Rock ───────────────────────────────────
  function sprint() {
    if (!ctx) return;
    noise(0.14, 0.35, null, { filterType:'highpass', freq:1800, Q:0.7, attack:0.002, freqEnd:4500 });
    fm(330, 2, 0.8, 0.18, 0.1, null, { attack:0.003, carrierFreqEnd:660 });
  }

  function warp() {
    if (!ctx) return;
    const rev = makeReverb(0.45, 1.0, 3.0);
    const dest = rev ? rev.input : sfxGain;
    // Phase 1 — entry: sub thump + dimensional tear
    kick(55, 0.25, 0.5, dest);
    fm(320, 4, 0.6, 0.4, 0.22, dest, { attack: 0.001, carrierFreqEnd: 80, modIndexEnd: 0.1 });
    noise(0.18, 0.25, dest, { filterType: 'lowpass', freq: 600, Q: 1.5, attack: 0.001 });
    // Phase 2 (80ms later) — exit: rising shimmer + spatial pop
    setTimeout(() => {
      if (!ctx) return;
      fm(110, 2.5, 1.8, 0.45, 0.30, dest, { attack: 0.005, carrierFreqEnd: 2200, modIndexEnd: 0.08 });
      osc('sine', 880, 0.5, 0.25, dest, { attack: 0.003, freqEnd: 2640, decay: 0.05, sustain: 0.08, release: 0.25 });
      noise(0.12, 0.2, dest, { filterType: 'highpass', freq: 4000, Q: 1.5, attack: 0.005 });
    }, 80);
  }

  function warpReturn() {
    if (!ctx) return;
    // Quick bright snap — distinct from full warp, feels like a rebound
    const comp = makeComp(-12, 5, 4);
    osc('sine', 1320, 0.25, 0.5, comp, { attack: 0.002, freqEnd: 880, decay: 0.04, sustain: 0.1, release: 0.15 });
    osc('triangle', 660, 0.2, 0.35, comp, { attack: 0.001, freqEnd: 440, decay: 0.03, sustain: 0.05, release: 0.12 });
    noise(0.15, 0.18, comp, { filterType: 'bandpass', freq: 3500, Q: 3, attack: 0.001 });
  }

  function warpRift() {
    if (!ctx) return;
    // Creepy dimensional portal entry — atonal, unsettling, distinctly different from gate warp
    const rev = makeReverb(0.7, 2.2, 4.5);
    const dest = rev ? rev.input : sfxGain;
    // Low atonal drone — two detuned sines that beat against each other
    osc('sine', 48,  2.5, 0.4, dest, { attack: 0.08, freqEnd: 28,  decay: 0.3, sustain: 0.15, release: 0.8 });
    osc('sine', 51,  2.5, 0.3, dest, { attack: 0.10, freqEnd: 30,  decay: 0.3, sustain: 0.12, release: 0.8 });
    // Descending pitch bend — reality collapsing
    fm(440, 2, 2.2, 0.35, 0.28, dest, { attack: 0.02, carrierFreqEnd: 55, modIndexEnd: 0.5,
      modType: 'sawtooth', freqMod: { rate: 2.5, depth: 25 } });
    // Void shimmer — high eerie wash
    osc('triangle', 1760, 1.8, 0.18, dest, { attack: 0.15, freqEnd: 440, decay: 0.2, sustain: 0.05, release: 0.7,
      freqMod: { rate: 3.8, depth: 40 } });
    noise(0.08, 1.5, dest, { filterType: 'bandpass', freq: 250, Q: 1.2, attack: 0.05 });
  }

  function hitReceived(isCritical) {
    if (!ctx) return;
    const comp = makeComp(-16, 6, 8, 0.001, 0.08);
    if (isCritical) {
      kick(55, 0.2, 0.6, comp);
      const ds = distort(130); ds.connect(comp);
      noise(0.28, 0.65, ds, { filterType:'lowpass', freq:500, Q:1.5, attack:0.001 });
      noise(0.18, 0.35, comp, { filterType:'highpass', freq:3000, Q:1, attack:0.001 });
    } else {
      kick(90, 0.1, 0.3, comp);
      noise(0.09, 0.22, comp, { filterType:'lowpass', freq:900, Q:1, attack:0.001 });
    }
  }

  function rockHit() {
    if (!ctx) return;
    kick(52, 0.09, 0.28, null);
    noise(0.09, 0.42, null, { filterType:'bandpass', freq:400, Q:1.5, attack:0.001 });
    noise(0.06, 0.2, null, { filterType:'highpass', freq:2500, Q:1, attack:0.002 });
  }

  function rockDestroy() {
    if (!ctx) return;
    const comp = makeComp(-12, 6, 5);
    const rev = makeReverb(0.35, 0.6, 2.5);
    kick(42, 0.32, 0.6, comp); kick(65, 0.22, 0.45, comp);
    noise(0.5, 0.75, comp, { filterType:'lowpass', freq:700, Q:1, attack:0.001 });
    if (rev) {
      noise(0.5, 0.55, rev.input, { filterType:'lowpass', freq:500, Q:1, attack:0.003 });
      setTimeout(() => {
        noise(0.35, 0.5, rev.input, { filterType:'highpass', freq:2000, Q:0.8, attack:0.001 });
        noise(0.28, 0.4, rev.input, { filterType:'bandpass', freq:4000, Q:1.5, attack:0.01 });
      }, 55);
    }
  }

  function pickupHealth() {
    if (!ctx) return;
    const rev = makeReverb(0.35, 0.5, 2.5);
    if (rev) {
      [0, 65, 120].forEach((d, i) => {
        const freqs = [523, 659, 784];
        setTimeout(() => {
          fm(freqs[i], 2, 0.35, 0.2 - i*0.03, 0.22, rev.input, { attack:0.003 });
          osc('sine', freqs[i]*2, 0.06, 0.08, rev.input, { attack:0.003 });
        }, d);
      });
    }
  }

  function pickupMana() {
    if (!ctx) return;
    const rev = makeReverb(0.4, 0.5, 3.0);
    if (rev) {
      [0, 75].forEach((d, i) => {
        const freqs = [440, 660];
        setTimeout(() => {
          fm(freqs[i], 1.5, 0.45, 0.2 - i*0.04, 0.22, rev.input, { attack:0.003 });
          osc('triangle', freqs[i]*2, 0.06, 0.1, rev.input, { attack:0.003, freqEnd:freqs[i]*3 });
        }, d);
      });
    }
  }

  function countdownBeep(isFinal) {
    if (!ctx) return;
    if (isFinal) {
      const comp = makeComp(-10, 4, 6);
      fm(880, 2, 0.5, 0.35, 0.45, comp, { attack:0.001 });
      fm(1320, 1.5, 0.3, 0.28, 0.38, comp, { attack:0.001 });
      setTimeout(() => fm(1760, 1, 0.2, 0.22, 0.55, comp, { attack:0.002 }), 65);
      noise(0.35, 0.18, comp, { filterType:'highpass', freq:4500, Q:0.8, attack:0.003 });
    } else {
      fm(440, 2, 0.4, 0.22, 0.22, null, { attack:0.001 });
    }
  }

  function autoAttackHit() {
    if (!ctx) return;
    kick(80, 0.07, 0.22, null);
    noise(0.05, 0.25, null, { filterType:'highpass', freq:4500, Q:0.8, attack:0.001 });
  }

  function autoAttackHit() {
    if (!ctx) return;
    kick(80, 0.07, 0.22, null);
    noise(0.05, 0.25, null, { filterType:'highpass', freq:4500, Q:0.8, attack:0.001 });
  }

  // ── Respawn ───────────────────────────────────────────────────────────────
  function respawn() {
    if (!ctx) return;
    const rev = makeReverb(0.4, 0.6, 2.5);
    if (rev) {
      // Rising pulse — coming back to life
      fm(220, 2, 1.5, 0.3, 0.5, rev.input, { attack:0.01, carrierFreqEnd:880, modIndexEnd:0.1 });
      noise(0.4, 0.2, rev.input, { filterType:'highpass', freq:2000, Q:1, attack:0.01 });
      setTimeout(() => {
        fm(440, 1.5, 0.5, 0.25, 0.35, rev.input, { attack:0.005, carrierFreqEnd:1320 });
      }, 200);
    }
  }

  // ── CC applied to player ──────────────────────────────────────────────────
  function stunned() {
    if (!ctx) return;
    // Sharp impact — bells ringing
    fm(800, 5, 2.0, 0.3, 0.4, null, { attack:0.001, carrierFreqEnd:200, modIndexEnd:0.1 });
    noise(0.2, 0.25, null, { filterType:'highpass', freq:3000, Q:1, attack:0.001 });
  }

  function frozen() {
    if (!ctx) return;
    // Ice lock — high crystalline freeze
    osc('sine', 2400, 0.12, 0.25, null, { attack:0.001, freqEnd:400 });
    noise(0.2, 0.3, null, { filterType:'highpass', freq:5000, Q:2, attack:0.002 });
    fm(600, 2, 0.3, 0.15, 0.2, null, { attack:0.002, carrierFreqEnd:1200 });
  }

  function silenced() {
    if (!ctx) return;
    // Muffled cut — ability suppressed
    noise(0.15, 0.25, null, { filterType:'lowpass', freq:400, Q:2, attack:0.002 });
    osc('sine', 300, 0.1, 0.15, null, { attack:0.002, freqEnd:100 });
  }

  // ── Kill streak moments ───────────────────────────────────────────────────
  function firstBlood() {
    if (!ctx) return;
    const comp = makeComp(-10, 6, 5);
    const rev = makeReverb(0.4, 0.6, 2.5);
    if (rev) {
      // Dramatic low hit then rising announcement
      kick(60, 0.25, 0.5, comp);
      noise(0.15, 0.4, comp, { filterType:'highpass', freq:3000, Q:1, attack:0.001 });
      setTimeout(() => {
        fm(440, 2, 0.8, 0.35, 0.45, rev.input, { attack:0.005, carrierFreqEnd:880 });
        fm(660, 1.5, 0.5, 0.28, 0.38, rev.input, { attack:0.008, carrierFreqEnd:1320 });
      }, 120);
    }
  }

  function doubleKill() {
    if (!ctx) return;
    const rev = makeReverb(0.35, 0.5, 2.0);
    if (rev) {
      [0, 90].forEach((d, i) => {
        setTimeout(() => {
          fm(660 * (i+1), 2, 0.6, 0.3, 0.3, rev.input, { attack:0.003, carrierFreqEnd:1320*(i+1)*0.5 });
        }, d);
      });
      noise(0.25, 0.2, rev.input, { filterType:'highpass', freq:4000, Q:1, attack:0.005 });
    }
  }

  function tripleKill() {
    if (!ctx) return;
    const rev = makeReverb(0.45, 0.7, 2.5);
    if (rev) {
      [0, 70, 140].forEach((d, i) => {
        setTimeout(() => {
          fm(440 + i*220, 2.5, 0.8, 0.35, 0.35, rev.input, { attack:0.003, carrierFreqEnd:(440+i*220)*1.5 });
        }, d);
      });
      noise(0.35, 0.25, rev.input, { filterType:'highpass', freq:3500, Q:1, attack:0.005 });
    }
  }

  function unstoppable() {
    if (!ctx) return;
    const rev = makeReverb(0.55, 1.0, 3.0);
    const comp = makeComp(-10, 8, 6);
    if (rev) {
      // Four-chord power surge
      [0, 60, 120, 180].forEach((d, i) => {
        setTimeout(() => {
          fm(330 * Math.pow(1.25, i), 3, 1.5, 0.4 - i*0.04, 0.5, rev.input,
            { attack:0.003, carrierFreqEnd:660 * Math.pow(1.25, i) });
        }, d);
      });
      noise(0.6, 0.3, rev.input, { filterType:'highpass', freq:2500, Q:1, attack:0.01 });
      setTimeout(() => kick(40, 0.25, 0.6, comp), 200);
    }
  }

  function nuked() {
    if (!ctx) return;
    const rev = makeReverb(0.5, 0.8, 3.5);
    if (rev) {
      // Massive descending slam
      kick(40, 0.35, 0.7, rev.input);
      fm(800, 8, 6.0, 0.6, 0.15, rev.input, { attack:0.001, carrierFreqEnd:20, modIndexEnd:0.4 });
      noise(0.4, 0.6, rev.input, { filterType:'lowpass', freq:1500, Q:1, attack:0.002 });
      noise(0.25, 0.4, rev.input, { filterType:'highpass', freq:4000, Q:1, attack:0.003 });
    }
  }

  // ── Sudden Death ──────────────────────────────────────────────────────────
  function suddenDeath() {
    if (!ctx) return;
    const rev = makeReverb(0.6, 1.5, 5.0);
    if (rev) {
      // Ominous toll — low bell drone
      fm(110, 3, 4.0, 0.5, 1.5, rev.input, { attack:0.02, carrierFreqEnd:55, modIndexEnd:0.5 });
      osc('sine', 220, 0.3, 0.8, rev.input, { attack:0.02, freqEnd:110 });
      noise(1.0, 0.25, rev.input, { filterType:'lowpass', freq:300, Q:1.5, attack:0.01, freqEnd:100 });
      setTimeout(() => {
        fm(55, 2, 5.0, 0.4, 0.8, rev.input, { attack:0.05, carrierFreqEnd:30 });
      }, 500);
    }
  }

  // ── Warp blocked ──────────────────────────────────────────────────────────
  function warpBlocked() {
    if (!ctx) return;
    osc('square', 220, 0.12, 0.15, null, { attack:0.001, freqEnd:110 });
    noise(0.1, 0.2, null, { filterType:'lowpass', freq:600, Q:2, attack:0.001 });
  }

  // ── Combo hit ─────────────────────────────────────────────────────────────
  function combo() {
    if (!ctx) return;
    fm(880, 2, 0.5, 0.25, 0.15, null, { attack:0.002, carrierFreqEnd:1320 });
    osc('sine', 1320, 0.08, 0.08, null, { attack:0.001, freqEnd:1760 });
  }

  // ── Storm zone convergence (non-Maelstrom) ────────────────────────────────
  function stormConverge() {
    if (!ctx) return;
    const rev = makeReverb(0.5, 0.8, 3.0);
    if (rev) {
      fm(300, 3, 2.0, 0.35, 0.6, rev.input, { attack:0.01, carrierFreqEnd:600, modIndexEnd:0.3 });
      noise(0.5, 0.3, rev.input, { filterType:'bandpass', freq:800, Q:2, attack:0.01, freqEnd:1600 });
      setTimeout(() => {
        fm(600, 2, 1.0, 0.3, 0.4, rev.input, { attack:0.005, carrierFreqEnd:1200 });
      }, 250);
    }
  }

  // ── Low mana warning ─────────────────────────────────────────────────────
  function lowMana() {
    if (!ctx) return;
    osc('sine', 330, 0.06, 0.2, null, { attack:0.005, freqEnd:220 });
    setTimeout(() => osc('sine', 330, 0.05, 0.15, null, { attack:0.005, freqEnd:220 }), 250);
  }

  // ── Sprint collision hit ──────────────────────────────────────────────────
  function sprintHit() {
    if (!ctx) return;
    kick(100, 0.1, 0.25, null);
    noise(0.1, 0.35, null, { filterType:'bandpass', freq:1200, Q:2, attack:0.001 });
  }

  // ── CRAFT RELIC — unique sound per relic ─────────────────────────────────
  function craftRelic(relicId) {
    if (!ctx) return;
    const rev = makeReverb(0.35, 1.2, 2.5);
    const dest = rev ? rev.input : sfxGain;
    const comp = makeComp(-14, 6, 4);
    const out = comp || sfxGain;

    switch (relicId) {
      case 'plasma': {
        // Power surge — rising electric whine + crackling burst
        osc('sawtooth', 180, 0.8, 0.4, out, { attack:0.01, freqEnd:1400, decay:0.1, sustain:0.15, release:0.3 });
        osc('sine',     360, 0.6, 0.25, out, { attack:0.02, freqEnd:2800, decay:0.1, sustain:0.1, release:0.2 });
        noise(0.2, 0.4, out, { filterType:'bandpass', freq:4000, Q:3, attack:0.01, freqEnd:8000 });
        break;
      }
      case 'singularity': {
        // Ghostly phase — descending hollow whoosh, fades to silence
        const rv2 = makeReverb(0.6, 1.8, 3.5);
        const d2 = rv2 ? rv2.input : out;
        osc('sine',     880, 1.4, 0.35, d2, { attack:0.08, freqEnd:110, decay:0.2, sustain:0.08, release:0.6 });
        osc('triangle', 440, 1.2, 0.2,  d2, { attack:0.12, freqEnd:55,  decay:0.2, sustain:0.06, release:0.5 });
        noise(0.06, 0.8, d2, { filterType:'highpass', freq:6000, Q:1, attack:0.05 });
        break;
      }
      case 'arctic': {
        // Ice crystallise — high glassy chime cluster, sharp attack
        for (let i = 0; i < 4; i++) {
          const delay = i * 0.06;
          setTimeout(() => {
            osc('sine', 1200 + i * 340, 0.9, 0.22, dest, { attack:0.002, freqEnd:900 + i * 200, decay:0.05, sustain:0.04, release:0.4 });
          }, delay * 1000);
        }
        noise(0.08, 0.3, out, { filterType:'highpass', freq:8000, Q:2, attack:0.002 });
        break;
      }
      case 'shadow_cap': {
        // Sharp zap + silence — electric snap then dead air
        const ds = distort(80); if (ds) ds.connect(out);
        const d3 = ds || out;
        fm(600, 8, 0.15, 0.5, 0.2, d3, { attack:0.001, carrierFreqEnd:200, modIndexEnd:0.2 });
        noise(0.3, 0.12, out, { filterType:'bandpass', freq:5000, Q:3, attack:0.001 });
        osc('sine', 80, 0.6, 0.3, out, { attack:0.002, freqEnd:20, decay:0.05, sustain:0.0, release:0.2 });
        break;
      }
      case 'permafrost': {
        // Heavy armour clank + low thud — weight, solidity
        kick(55, 0.35, 0.7, out);
        fm(220, 4, 1.2, 0.4, 0.3, out, { attack:0.003, carrierFreqEnd:110, modIndexEnd:0.3 });
        noise(0.12, 0.5, out, { filterType:'lowpass', freq:600, Q:2, attack:0.004 });
        break;
      }
      case 'firestorm': {
        // Ignition whoosh — quick air rush + crackle tail
        noise(0.35, 0.5, dest, { filterType:'bandpass', freq:2000, Q:1.2, attack:0.01, freqEnd:400 });
        osc('sawtooth', 120, 0.6, 0.3, out, { attack:0.005, freqEnd:60, decay:0.1, sustain:0.05, release:0.3,
          freqMod:{ rate:14, depth:30 } });
        noise(0.15, 0.35, out, { filterType:'highpass', freq:3000, Q:1.5, attack:0.001 });
        break;
      }
      case 'tempest': {
        // Wind rush — fast airy sweep, light and quick
        noise(0.4, 0.55, dest, { filterType:'bandpass', freq:800, Q:0.8, attack:0.02, freqEnd:3200 });
        osc('sine', 300, 0.5, 0.2, out, { attack:0.03, freqEnd:1200, decay:0.08, sustain:0.04, release:0.2 });
        break;
      }
      case 'flashpoint': {
        // Death save — dramatic heartbeat thump + sharp rising sting
        kick(70, 0.3, 0.5, out);
        setTimeout(() => {
          kick(70, 0.25, 0.4, out);
          osc('sine', 440, 0.8, 0.35, dest, { attack:0.005, freqEnd:1760, decay:0.1, sustain:0.1, release:0.4 });
          noise(0.1, 0.3, out, { filterType:'bandpass', freq:2000, Q:2, attack:0.005 });
        }, 280);
        break;
      }
      case 'supercell': {
        // Electric expansion — rising electric chord with wide stereo spread
        const rv3 = makeReverb(0.4, 1.0, 2.0);
        const d4 = rv3 ? rv3.input : out;
        fm(220,  6, 1.1, 0.3, 0.35, d4, { attack:0.01, carrierFreqEnd:880,  modIndexEnd:0.4 });
        fm(330,  5, 0.9, 0.25, 0.3, d4, { attack:0.02, carrierFreqEnd:1320, modIndexEnd:0.3 });
        noise(0.08, 0.4, out, { filterType:'bandpass', freq:3500, Q:2, attack:0.015, freqEnd:7000 });
        break;
      }
      case 'abyssal': {
        // Deep void reveal — low sub rumble + eerie high shimmer
        const rv4 = makeReverb(0.55, 2.0, 4.0);
        const d5 = rv4 ? rv4.input : out;
        osc('sine',     55,  1.5, 0.45, d5, { attack:0.05, freqEnd:28,  decay:0.1, sustain:0.15, release:0.7 });
        osc('triangle', 880, 1.2, 0.18, d5, { attack:0.12, freqEnd:440, decay:0.15, sustain:0.06, release:0.6,
          freqMod:{ rate:2.5, depth:15 } });
        noise(0.05, 1.0, d5, { filterType:'bandpass', freq:200, Q:1.5, attack:0.04 });
        break;
      }
      default: {
        // Generic fallback — simple chime
        osc('sine', 660, 0.6, 0.3, out, { attack:0.005, freqEnd:440, decay:0.1, sustain:0.1, release:0.3 });
      }
    }
  }

  return {
    init, unlockBGM, loadMenuBGM, loadMatchBGM,
    playMenuBGM, playMatchBGM, stopBGM,
    startRiftAmbience, stopRiftAmbience,
    setSFXVol, setMusicVol, setMusicOn,
    setMenuMusicVol, setMatchMusicVol,
    setMenuMusicOn, setMatchMusicOn,
    setSFXOn,
    get sfxVol()        { return settings.sfxVol; },
    get menuMusicVol()  { return settings.menuMusicVol; },
    get matchMusicVol() { return settings.matchMusicVol; },
    get menuMusicOn()   { return settings.menuMusicOn; },
    get matchMusicOn()  { return settings.matchMusicOn; },
    get musicVol()      { return settings.menuMusicVol; },
    get musicOn()       { return settings.menuMusicOn; },
    get sfxOn()         { return settings.sfxOn; },
    sfx: { uiClick, uiConfirm, uiBack, kill, onFire, death, weatherEnter, ability,
           countdownBeep, autoAttack, autoAttackHit, hitReceived, sprint, warp, warpReturn, warpRift,
           rockHit, rockDestroy, pickupHealth, pickupMana, maelstromSpawn, maelstromImplode,
           respawn, stunned, frozen, silenced, firstBlood, doubleKill, tripleKill,
           unstoppable, nuked, suddenDeath, warpBlocked, combo, stormConverge, lowMana, sprintHit,
           craftRelic },
  };
})();

['click','keydown','touchstart'].forEach(ev =>
  document.addEventListener(ev, () => { Audio.init(); Audio.unlockBGM(); }, { once: true, passive: true })
);
document.addEventListener('click', () => Audio.unlockBGM(), { passive: true });
Audio.loadMenuBGM();
Audio.loadMatchBGM();
