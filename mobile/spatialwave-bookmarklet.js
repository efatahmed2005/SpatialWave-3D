/**
 * SpatialWave 3D - Mobile In-Page Audio Injector (Bookmarklet & Userscript)
 * Compatible with Brave Browser on iOS & Android (as well as desktop browsers).
 * 
 * Intercepts active <video> and <audio> elements on YouTube, SoundCloud, Twitch, etc.,
 * routes them through a pure Web Audio 3D binaural HRTF spatialization engine,
 * and renders a touch-friendly floating glassmorphism control panel.
 */

(function() {
  // Prevent duplicate injection
  if (window.__spatialWaveActive) {
    const existingHud = document.getElementById('spatialwave-mobile-hud');
    if (existingHud) {
      existingHud.style.display = existingHud.style.display === 'none' ? 'flex' : 'none';
      return;
    }
  }
  window.__spatialWaveActive = true;

  // --- 1. Audio DSP Engine ---
  let audioCtx = null;
  let sourceNode = null;
  let preampNode = null;
  let bassLp = null;
  let spatHp = null;
  let haasDelayL = null;
  let haasDelayR = null;
  let haasDampL = null;
  let haasDampR = null;
  let crossGainL = null;
  let crossGainR = null;
  let splitterNode = null;
  let delayL = null;
  let delayR = null;
  let hsL = null;
  let hsR = null;
  let notchL = null;
  let notchR = null;
  let peakL = null;
  let peakR = null;
  let airL = null;
  let airR = null;
  let mergerNode = null;
  let compressorNode = null;
  let volumeNode = null;
  let analyserNode = null;
  let hookedMediaEl = null;

  // DSP Parameters
  let isEnabled = true;
  let mode = 1; // 1 = 8D In-Head Traveling Orbit
  let intensity = 0.90;
  let speedHz = 0.12;
  let userDistance = 1.4;
  let stereoWidth = 1.35;
  let bassShelfGain = 0;
  let trebleShelfGain = 0;
  let currentTimeSec = 0;
  let animFrameId = null;

  // Constants
  const TWO_PI = Math.PI * 2;
  const SPEED_OF_SOUND = 343.0;
  const HEAD_RADIUS = 0.0875;

  function initAudioContext() {
    if (audioCtx) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContextClass({ latencyHint: 'interactive' });
  }

  function findActiveMediaElement() {
    const media = Array.from(document.querySelectorAll('video, audio')).filter(el => {
      return el.duration > 0 && !el.paused && !el.ended && el.readyState > 2;
    });
    if (media.length > 0) return media[0];
    // Fallback: any video/audio on page
    return document.querySelector('video') || document.querySelector('audio');
  }

  function setupDspPipeline(mediaEl) {
    if (!mediaEl || mediaEl.__spatialWaveHooked) return;
    initAudioContext();

    try {
      sourceNode = audioCtx.createMediaElementSource(mediaEl);
    } catch (e) {
      console.warn('[SpatialWave Mobile] Media element could not be captured (already captured or CORS):', e);
      return;
    }
    mediaEl.__spatialWaveHooked = true;
    hookedMediaEl = mediaEl;

    preampNode = audioCtx.createGain();
    preampNode.gain.value = 0.85;

    // Sub-Bass 110Hz Crossover (centers punch without ear fatigue)
    bassLp = audioCtx.createBiquadFilter();
    bassLp.type = 'lowpass';
    bassLp.frequency.value = 110;
    bassLp.Q.value = 0.707;

    spatHp = audioCtx.createBiquadFilter();
    spatHp.type = 'highpass';
    spatHp.frequency.value = 110;
    spatHp.Q.value = 0.707;

    // Filters for Head Shadow ILD
    hsL = audioCtx.createBiquadFilter();
    hsR = audioCtx.createBiquadFilter();
    hsL.type = 'highshelf';
    hsR.type = 'highshelf';
    hsL.frequency.value = 2200;
    hsR.frequency.value = 2200;

    // Pinna Notches
    notchL = audioCtx.createBiquadFilter();
    notchR = audioCtx.createBiquadFilter();
    notchL.type = 'notch';
    notchR.type = 'notch';
    notchL.Q.value = 3.2;
    notchR.Q.value = 3.2;

    // Pinna Presence & Rear Occlusion Peaking
    peakL = audioCtx.createBiquadFilter();
    peakR = audioCtx.createBiquadFilter();
    peakL.type = 'peaking';
    peakR.type = 'peaking';
    peakL.frequency.value = 3800;
    peakR.frequency.value = 3800;
    peakL.Q.value = 1.4;
    peakR.Q.value = 1.4;

    // Air Absorption Lowpass
    airL = audioCtx.createBiquadFilter();
    airR = audioCtx.createBiquadFilter();
    airL.type = 'lowpass';
    airR.type = 'lowpass';
    airL.frequency.value = 18000;
    airR.frequency.value = 18000;

    // Fractional Delay Nodes for ITD
    delayL = audioCtx.createDelay(0.015);
    delayR = audioCtx.createDelay(0.015);

    // Cross-Ear Haas Slapback (~18ms room wall bounce)
    haasDelayL = audioCtx.createDelay(0.05);
    haasDelayR = audioCtx.createDelay(0.05);
    haasDelayL.delayTime.value = 0.018;
    haasDelayR.delayTime.value = 0.018;

    haasDampL = audioCtx.createBiquadFilter();
    haasDampR = audioCtx.createBiquadFilter();
    haasDampL.type = 'lowpass';
    haasDampR.type = 'lowpass';
    haasDampL.frequency.value = 3600;
    haasDampR.frequency.value = 3600;

    crossGainL = audioCtx.createGain();
    crossGainR = audioCtx.createGain();
    crossGainL.gain.value = 0.0;
    crossGainR.gain.value = 0.0;

    // Channel routing
    splitterNode = audioCtx.createChannelSplitter(2);
    mergerNode = audioCtx.createChannelMerger(2);

    // Compressor & Limiter
    compressorNode = audioCtx.createDynamicsCompressor();
    compressorNode.threshold.value = -12.0;
    compressorNode.ratio.value = 2.5;
    compressorNode.attack.value = 0.012;
    compressorNode.release.value = 0.12;

    volumeNode = audioCtx.createGain();
    volumeNode.gain.value = 1.0;

    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 64;

    // Connect Graph
    sourceNode.connect(preampNode);

    // Sub-bass anchor (<110Hz) stays centered in both ears
    preampNode.connect(bassLp);
    bassLp.connect(mergerNode, 0, 0);
    bassLp.connect(mergerNode, 0, 1);

    // Spatial mids/highs (>110Hz) feed splitter
    preampNode.connect(spatHp);
    spatHp.connect(splitterNode);

    // Left Ear: Splitter[0] -> DelayL -> HeadShadowL -> NotchL -> PeakL -> AirL -> Merger[0]
    splitterNode.connect(delayL, 0);
    delayL.connect(hsL);
    hsL.connect(notchL);
    notchL.connect(peakL);
    peakL.connect(airL);
    airL.connect(mergerNode, 0, 0);

    // Right Ear: Splitter[1] -> DelayR -> HeadShadowR -> NotchR -> PeakR -> AirR -> Merger[1]
    splitterNode.connect(delayR, 1);
    delayR.connect(hsR);
    hsR.connect(notchR);
    notchR.connect(peakR);
    peakR.connect(airR);
    airR.connect(mergerNode, 0, 1);

    // Cross-Ear Haas Slapback reflections
    splitterNode.connect(haasDelayR, 1);
    haasDelayR.connect(haasDampR);
    haasDampR.connect(crossGainL);
    crossGainL.connect(mergerNode, 0, 0);

    splitterNode.connect(haasDelayL, 0);
    haasDelayL.connect(haasDampL);
    haasDampL.connect(crossGainR);
    crossGainR.connect(mergerNode, 0, 1);

    mergerNode.connect(compressorNode);
    compressorNode.connect(volumeNode);
    volumeNode.connect(analyserNode);
    analyserNode.connect(audioCtx.destination);

    // Resume on mobile user interaction
    if (audioCtx.state === 'suspended') {
      const resumeAudio = () => {
        audioCtx.resume();
        document.removeEventListener('touchstart', resumeAudio);
        document.removeEventListener('click', resumeAudio);
      };
      document.addEventListener('touchstart', resumeAudio, { once: true });
      document.addEventListener('click', resumeAudio, { once: true });
    }

    startSpatialLoop();
  }

  // Real-time dynamic trajectory loop with 8D in-head traveling
  function startSpatialLoop() {
    if (animFrameId) cancelAnimationFrame(animFrameId);

    const pos = { x: 0, y: 1.4, z: 0 };

    function step() {
      if (isEnabled && audioCtx && delayL && delayR) {
        currentTimeSec += 0.02;
        const r = userDistance * (0.6 + 0.4 * intensity);
        const omega = TWO_PI * speedHz;

        if (mode === 1) { // Professional 8D In-Head Traveling Orbit
          const sinPhase = Math.sin(omega * currentTimeSec);
          const cosPhase = Math.cos(omega * currentTimeSec);
          const halfPhase = omega * currentTimeSec * 0.5;

          // In-head contraction when crossing x=0
          const depthMod = 0.38 + 0.62 * Math.pow(Math.abs(sinPhase), 1.2);
          const rCur = r * depthMod;

          pos.x = r * sinPhase;
          pos.y = rCur * cosPhase * (0.65 + 0.35 * Math.sin(halfPhase));
          pos.z = r * 0.18 * Math.sin(halfPhase);
        } else if (mode === 2) { // Fig-8
          pos.x = r * Math.sin(omega * currentTimeSec);
          pos.y = r * Math.sin(2.0 * omega * currentTimeSec) * 0.85;
          pos.z = r * 0.18 * Math.cos(omega * currentTimeSec);
        } else if (mode === 3) { // Front Arc
          const angle = (Math.PI / 3.0) * Math.sin(omega * currentTimeSec);
          pos.x = r * Math.sin(angle);
          pos.y = r * Math.cos(angle);
          pos.z = 0.05 * r;
        } else {
          pos.x = 0; pos.y = r; pos.z = 0;
        }

        const distance = Math.max(0.18, Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z));
        const azimuth = Math.atan2(pos.x, pos.y);
        const cosAz = Math.cos(azimuth);
        const sinAz = Math.sin(azimuth);
        const absAz = Math.abs(azimuth);

        // ITD (Woodworth)
        const maxDelaySec = (HEAD_RADIUS / SPEED_OF_SOUND) * (Math.sin(absAz) + absAz) * intensity;
        const now = audioCtx.currentTime;
        if (azimuth > 0) {
          delayL.delayTime.setTargetAtTime(maxDelaySec, now, 0.02);
          delayR.delayTime.setTargetAtTime(0.0001, now, 0.02);
        } else {
          delayL.delayTime.setTargetAtTime(0.0001, now, 0.02);
          delayR.delayTime.setTargetAtTime(maxDelaySec, now, 0.02);
        }

        // ILD (-11dB contralateral)
        const ildL = -11.0 * (1.0 - Math.cos(azimuth - Math.PI * 0.5)) * 0.5 * intensity;
        const ildR = -11.0 * (1.0 - Math.cos(azimuth + Math.PI * 0.5)) * 0.5 * intensity;
        hsL.gain.setTargetAtTime(ildL, now, 0.02);
        hsR.gain.setTargetAtTime(ildR, now, 0.02);

        // Rear pinna notch & occlusion
        const isRear = cosAz < 0;
        const rearDamp = isRear ? (cosAz * 5.5 * intensity) : 1.2;
        peakL.gain.setTargetAtTime(rearDamp, now, 0.02);
        peakR.gain.setTargetAtTime(rearDamp, now, 0.02);

        const notchFcL = Math.max(4000, Math.min(10000, 6800 + 700 * sinAz));
        const notchFcR = Math.max(4000, Math.min(10000, 6800 - 700 * sinAz));
        notchL.frequency.setTargetAtTime(notchFcL, now, 0.02);
        notchR.frequency.setTargetAtTime(notchFcR, now, 0.02);

        // Haas cross-ear slapback bounce weighting
        const panAngle = (azimuth / Math.PI) * 0.5 + 0.5;
        const directL = Math.cos(panAngle * (Math.PI * 0.5));
        const directR = Math.sin(panAngle * (Math.PI * 0.5));
        if (crossGainL && crossGainR) {
          crossGainL.gain.setTargetAtTime(directR * 0.22 * intensity, now, 0.02);
          crossGainR.gain.setTargetAtTime(directL * 0.22 * intensity, now, 0.02);
        }

        // Draw radar
        drawRadar(pos.x, pos.y);
      }
      animFrameId = requestAnimationFrame(step);
    }
    animFrameId = requestAnimationFrame(step);
  }

  // --- 2. Floating Mobile Glassmorphism UI ---
  const container = document.createElement('div');
  container.id = 'spatialwave-mobile-hud';
  container.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    user-select: none;
  `;

  // Floating trigger button
  const fab = document.createElement('button');
  fab.id = 'spatialwave-fab';
  fab.innerHTML = `
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00f5d4" stroke-width="2.2">
      <circle cx="12" cy="12" r="9"></circle>
      <circle cx="12" cy="12" r="3" fill="#00f5d4"></circle>
      <path d="M12 3a9 9 0 0 1 9 9" stroke="#7b2cbf" stroke-width="2.5"></path>
    </svg>
  `;
  fab.style.cssText = `
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: rgba(11, 14, 24, 0.92);
    border: 1.5px solid #00f5d4;
    box-shadow: 0 4px 20px rgba(0, 245, 212, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  `;

  // Expandable Glassmorphism Panel
  const panel = document.createElement('div');
  panel.id = 'spatialwave-panel';
  panel.style.cssText = `
    display: none;
    position: fixed;
    bottom: 80px;
    right: 16px;
    width: 320px;
    max-width: calc(100vw - 32px);
    background: rgba(14, 18, 32, 0.94);
    border: 1px solid rgba(0, 245, 212, 0.3);
    border-radius: 16px;
    padding: 14px;
    color: #f0f4fc;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.8);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    flex-direction: column;
    gap: 10px;
  `;

  panel.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.08); padding-bottom:6px;">
      <div style="font-weight:800; font-size:13px; color:#00f5d4; letter-spacing:0.8px;">SPATIALWAVE 3D MOBILE</div>
      <button id="sw-close-btn" style="background:transparent; border:none; color:#8b9bb4; font-size:18px; cursor:pointer;">&times;</button>
    </div>

    <!-- 3D Radar Canvas -->
    <div style="display:flex; justify-content:center; background:rgba(6,9,16,0.7); border-radius:8px; padding:4px;">
      <canvas id="sw-radar" width="280" height="90"></canvas>
    </div>

    <!-- Presets -->
    <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:5px;">
      <button class="sw-preset-btn" data-preset="8d" style="background:#1b2238; color:#00f5d4; border:1px solid #00f5d4; border-radius:6px; padding:6px; font-size:10px; font-weight:700;">8D Orbit</button>
      <button class="sw-preset-btn" data-preset="gaming" style="background:#1b2238; color:#fff; border:1px solid rgba(255,255,255,0.1); border-radius:6px; padding:6px; font-size:10px;">CS2 Game</button>
      <button class="sw-preset-btn" data-preset="audiophile" style="background:#1b2238; color:#fff; border:1px solid rgba(255,255,255,0.1); border-radius:6px; padding:6px; font-size:10px;">Audiophile</button>
    </div>

    <!-- Touch Sliders -->
    <div style="display:flex; flex-direction:column; gap:8px; font-size:11px;">
      <div style="display:flex; justify-content:space-between;">
        <span>3D Intensity</span>
        <span id="sw-intensity-val" style="color:#00f5d4; font-weight:bold;">85%</span>
      </div>
      <input type="range" id="sw-slider-intensity" min="0" max="100" value="85" style="width:100%; accent-color:#00f5d4;">

      <div style="display:flex; justify-content:space-between;">
        <span>Rotation Speed</span>
        <span id="sw-speed-val" style="color:#00f5d4; font-weight:bold;">0.12 Hz</span>
      </div>
      <input type="range" id="sw-slider-speed" min="2" max="60" value="12" style="width:100%; accent-color:#00f5d4;">
    </div>

    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px;">
      <span style="font-size:10px; color:#8b9bb4;">Profile: <strong>KZ EDX Pro (AutoEQ)</strong></span>
      <button id="sw-hook-btn" style="background:linear-gradient(135deg,#00f5d4,#00b4d8); color:#080a11; font-size:10px; font-weight:bold; border:none; padding:5px 10px; border-radius:6px; cursor:pointer;">Attach Audio</button>
    </div>
  `;

  container.appendChild(fab);
  container.appendChild(panel);
  document.body.appendChild(container);

  // Toggle Panel
  fab.addEventListener('click', () => {
    panel.style.display = panel.style.display === 'flex' ? 'none' : 'flex';
    if (!hookedMediaEl) {
      const target = findActiveMediaElement();
      if (target) setupDspPipeline(target);
    }
  });

  panel.querySelector('#sw-close-btn').addEventListener('click', () => {
    panel.style.display = 'none';
  });

  // Attach button
  panel.querySelector('#sw-hook-btn').addEventListener('click', () => {
    const target = findActiveMediaElement();
    if (target) {
      setupDspPipeline(target);
      alert('SpatialWave 3D attached to: ' + (target.tagName.toLowerCase()));
    } else {
      alert('No media playing on this tab yet. Start playback and tap Attach.');
    }
  });

  // Slider events
  const sliderInt = panel.querySelector('#sw-slider-intensity');
  const valInt = panel.querySelector('#sw-intensity-val');
  sliderInt.addEventListener('input', (e) => {
    intensity = e.target.value / 100;
    valInt.textContent = e.target.value + '%';
  });

  const sliderSpd = panel.querySelector('#sw-slider-speed');
  const valSpd = panel.querySelector('#sw-speed-val');
  sliderSpd.addEventListener('input', (e) => {
    speedHz = e.target.value / 100;
    valSpd.textContent = speedHz.toFixed(2) + ' Hz';
  });

  // Preset Buttons
  panel.querySelectorAll('.sw-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = btn.dataset.preset;
      panel.querySelectorAll('.sw-preset-btn').forEach(b => {
        b.style.borderColor = 'rgba(255,255,255,0.1)';
        b.style.color = '#fff';
      });
      btn.style.borderColor = '#00f5d4';
      btn.style.color = '#00f5d4';

      if (p === '8d') {
        mode = 1; intensity = 0.90; speedHz = 0.12;
      } else if (p === 'gaming') {
        mode = 0; intensity = 0.95; speedHz = 0.05;
      } else if (p === 'audiophile') {
        mode = 0; intensity = 0.35; speedHz = 0.05;
      }
      sliderInt.value = Math.round(intensity * 100);
      valInt.textContent = sliderInt.value + '%';
      sliderSpd.value = Math.round(speedHz * 100);
      valSpd.textContent = speedHz.toFixed(2) + ' Hz';
    });
  });

  // Radar rendering
  const radarCanvas = panel.querySelector('#sw-radar');
  const rCtx = radarCanvas.getContext('2d');

  function drawRadar(x, y) {
    if (panel.style.display === 'none') return;
    const w = radarCanvas.width;
    const h = radarCanvas.height;
    const cx = w / 2;
    const cy = h / 2;

    rCtx.fillStyle = '#060910';
    rCtx.fillRect(0, 0, w, h);

    // Range circle
    rCtx.strokeStyle = 'rgba(255,255,255,0.1)';
    rCtx.beginPath();
    rCtx.arc(cx, cy, 30, 0, Math.PI * 2);
    rCtx.stroke();

    // Center Head
    rCtx.fillStyle = '#ffffff';
    rCtx.beginPath();
    rCtx.arc(cx, cy, 5, 0, Math.PI * 2);
    rCtx.fill();

    // Orbiting Sound Source
    const scale = 22;
    const ex = cx + x * scale;
    const ey = cy - y * scale;

    rCtx.fillStyle = '#00f5d4';
    rCtx.shadowColor = '#00f5d4';
    rCtx.shadowBlur = 8;
    rCtx.beginPath();
    rCtx.arc(ex, ey, 4, 0, Math.PI * 2);
    rCtx.fill();
    rCtx.shadowBlur = 0;
  }

  // Auto-hook on load if media is already present
  setTimeout(() => {
    const activeEl = findActiveMediaElement();
    if (activeEl) setupDspPipeline(activeEl);
  }, 1000);

  console.log('[SpatialWave 3D] Mobile In-Page Engine injected.');
})();
