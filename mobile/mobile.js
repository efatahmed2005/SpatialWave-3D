/**
 * SpatialWave 3D - Mobile PWA Controller
 * Handles local audio playback, demo synthesizer, Web Audio 3D binaural DSP,
 * touch-optimized visualizers, and AutoEQ headphone profiles.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const powerToggle = document.getElementById('mobilePowerToggle');
  const fileInput = document.getElementById('audioFileInput');
  const btnPlayDemo = document.getElementById('btnPlayDemo');
  const audioPlayer = document.getElementById('nativeAudioPlayer');
  const nowPlayingText = document.getElementById('nowPlayingText');

  const radarCanvas = document.getElementById('mobileRadarCanvas');
  const radarCtx = radarCanvas.getContext('2d');
  const spectrumCanvas = document.getElementById('mobileSpectrumCanvas');
  const spectrumCtx = spectrumCanvas.getContext('2d');
  const peqCanvas = document.getElementById('mobilePeqCanvas');
  const peqCtx = peqCanvas.getContext('2d');

  const profileSelect = document.getElementById('mobileProfileSelect');
  const trajectorySelect = document.getElementById('mobileTrajectorySelect');
  const radarBadge = document.getElementById('mobileRadarBadge');
  const presetPills = document.querySelectorAll('.preset-pill');

  // Sliders
  const sIntensity = document.getElementById('mSliderIntensity');
  const sSpeed = document.getElementById('mSliderSpeed');
  const sDistance = document.getElementById('mSliderDistance');
  const sWidth = document.getElementById('mSliderWidth');
  const sVolume = document.getElementById('mSliderVolume');

  const valIntensity = document.getElementById('mValIntensity');
  const valSpeed = document.getElementById('mValSpeed');
  const valDistance = document.getElementById('mValDistance');
  const valWidth = document.getElementById('mValWidth');
  const valVolume = document.getElementById('mValVolume');

  // DSP Graph State
  let audioCtx = null;
  let sourceNode = null;
  let preampNode = null;
  let peqFilterNodes = [];
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
  let compNode = null;
  let volNode = null;
  let analyserNode = null;

  // Parameters
  let isEnabled = true;
  let mode = 1;
  let intensity = 0.85;
  let speedHz = 0.12;
  let userDistance = 1.4;
  let stereoWidth = 1.2;
  let currentTimeSec = 0;
  let isDemoPlaying = false;
  let demoInterval = null;

  const TWO_PI = Math.PI * 2;
  const SPEED_OF_SOUND = 343.0;
  const HEAD_RADIUS = 0.0875;

  function initAudioEngine() {
    if (audioCtx) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContextClass({ latencyHint: 'interactive' });

    preampNode = audioCtx.createGain();
    preampNode.gain.value = 0.85;

    // Head Shadow
    hsL = audioCtx.createBiquadFilter();
    hsR = audioCtx.createBiquadFilter();
    hsL.type = 'highshelf';
    hsR.type = 'highshelf';
    hsL.frequency.value = 2400;
    hsR.frequency.value = 2400;

    // Pinna Notches
    notchL = audioCtx.createBiquadFilter();
    notchR = audioCtx.createBiquadFilter();
    notchL.type = 'notch';
    notchR.type = 'notch';
    notchL.Q.value = 2.8;
    notchR.Q.value = 2.8;

    // Presence Peaking
    peakL = audioCtx.createBiquadFilter();
    peakR = audioCtx.createBiquadFilter();
    peakL.type = 'peaking';
    peakR.type = 'peaking';
    peakL.frequency.value = 4200;
    peakR.frequency.value = 4200;
    peakL.Q.value = 1.4;

    // Air Absorption
    airL = audioCtx.createBiquadFilter();
    airR = audioCtx.createBiquadFilter();
    airL.type = 'lowpass';
    airR.type = 'lowpass';
    airL.frequency.value = 18000;
    airR.frequency.value = 18000;

    // Fractional Delays
    delayL = audioCtx.createDelay(0.01);
    delayR = audioCtx.createDelay(0.01);

    splitterNode = audioCtx.createChannelSplitter(2);
    mergerNode = audioCtx.createChannelMerger(2);

    compNode = audioCtx.createDynamicsCompressor();
    compNode.threshold.value = -12.0;
    compNode.ratio.value = 2.5;

    volNode = audioCtx.createGain();
    volNode.gain.value = 1.0;

    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 64;

    // Left chain
    splitterNode.connect(delayL, 0);
    delayL.connect(hsL);
    hsL.connect(notchL);
    notchL.connect(peakL);
    peakL.connect(airL);
    airL.connect(mergerNode, 0, 0);

    // Right chain
    splitterNode.connect(delayR, 1);
    delayR.connect(hsR);
    hsR.connect(notchR);
    notchR.connect(peakR);
    peakR.connect(airR);
    airR.connect(mergerNode, 0, 1);

    mergerNode.connect(compNode);
    compNode.connect(volNode);
    volNode.connect(analyserNode);
    analyserNode.connect(audioCtx.destination);

    applyHeadphoneProfile();
    startTrajectoryLoop();
  }

  function applyHeadphoneProfile() {
    if (!audioCtx || !preampNode) return;
    const profileId = profileSelect.value;
    const prof = HEADPHONE_PROFILES[profileId] || HEADPHONE_PROFILES.kz_edx_pro;

    const now = audioCtx.currentTime;
    const preampGain = Math.pow(10.0, (prof.preampDb || 0) / 20.0);
    preampNode.gain.setTargetAtTime(preampGain, now, 0.02);

    // Disconnect old PEQ nodes
    preampNode.disconnect();
    peqFilterNodes.forEach(n => n.disconnect());
    peqFilterNodes = [];

    let lastNode = preampNode;
    prof.filters.forEach(f => {
      if (!f.enabled) return;
      const biquad = audioCtx.createBiquadFilter();
      biquad.type = f.type || 'peaking';
      biquad.frequency.value = f.freq;
      biquad.Q.value = f.q || 1.0;
      biquad.gain.value = f.gain || 0.0;

      lastNode.connect(biquad);
      peqFilterNodes.push(biquad);
      lastNode = biquad;
    });

    lastNode.connect(splitterNode);
    renderMobilePeqPlot();
  }

  function startTrajectoryLoop() {
    const pos = { x: 0, y: 1.4, z: 0 };

    function frame() {
      if (isEnabled && audioCtx && delayL && delayR) {
        currentTimeSec += 0.02;
        const r = userDistance * (0.6 + 0.4 * intensity);
        const omega = TWO_PI * speedHz;

        if (mode === 1) { // Orbit 360
          pos.x = r * Math.sin(omega * currentTimeSec);
          pos.y = r * Math.cos(omega * currentTimeSec);
          pos.z = r * 0.2 * Math.sin(omega * 0.5 * currentTimeSec);
        } else if (mode === 2) { // Fig-8
          pos.x = r * Math.sin(omega * currentTimeSec);
          pos.y = r * Math.sin(2.0 * omega * currentTimeSec) * 0.85;
          pos.z = r * 0.15 * Math.cos(omega * currentTimeSec);
        } else if (mode === 3) { // Front Arc
          const angle = (Math.PI / 3.0) * Math.sin(omega * currentTimeSec);
          pos.x = r * Math.sin(angle);
          pos.y = r * Math.cos(angle);
          pos.z = 0.05 * r;
        } else {
          pos.x = 0; pos.y = r; pos.z = 0;
        }

        const distance = Math.max(0.2, Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z));
        const azimuth = Math.atan2(pos.x, pos.y);
        const absAz = Math.abs(azimuth);

        const maxDelaySec = (HEAD_RADIUS / SPEED_OF_SOUND) * (Math.sin(absAz) + absAz) * intensity;
        const now = audioCtx.currentTime;

        if (azimuth > 0) {
          delayL.delayTime.setTargetAtTime(maxDelaySec, now, 0.02);
          delayR.delayTime.setTargetAtTime(0.0001, now, 0.02);
        } else {
          delayL.delayTime.setTargetAtTime(0.0001, now, 0.02);
          delayR.delayTime.setTargetAtTime(maxDelaySec, now, 0.02);
        }

        const ildL = -6.0 * (1.0 - Math.cos(azimuth - Math.PI * 0.5)) * 0.5 * intensity;
        const ildR = -6.0 * (1.0 - Math.cos(azimuth + Math.PI * 0.5)) * 0.5 * intensity;
        hsL.gain.setTargetAtTime(ildL, now, 0.02);
        hsR.gain.setTargetAtTime(ildR, now, 0.02);

        drawRadar(pos.x, pos.y);
      }
      drawSpectrum();
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // --- Local Audio File & Demo Loader ---
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    initAudioEngine();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const fileUrl = URL.createObjectURL(file);
    audioPlayer.src = fileUrl;
    audioPlayer.style.display = 'block';
    audioPlayer.play();
    nowPlayingText.textContent = `Playing: ${file.name}`;

    if (!sourceNode) {
      sourceNode = audioCtx.createMediaElementSource(audioPlayer);
      sourceNode.connect(preampNode);
    }
  });

  // Demo Synthesizer in 3D Orbit
  btnPlayDemo.addEventListener('click', () => {
    initAudioEngine();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    if (isDemoPlaying) {
      isDemoPlaying = false;
      if (demoInterval) clearInterval(demoInterval);
      btnPlayDemo.textContent = '🎵 Play 3D Demo';
      nowPlayingText.textContent = 'Demo stopped.';
      return;
    }

    isDemoPlaying = true;
    btnPlayDemo.textContent = '⏹ Stop Demo';
    nowPlayingText.textContent = 'Playing: 3D Spatial Melodic Demo (Stereo Orbit)';

    let step = 0;
    const notes = [220, 261.63, 329.63, 392.0, 523.25, 659.25, 783.99, 1046.5];

    demoInterval = setInterval(() => {
      if (!audioCtx || !isDemoPlaying) return;
      const now = audioCtx.currentTime;

      if (step % 4 === 0) {
        const kick = audioCtx.createOscillator();
        const kickG = audioCtx.createGain();
        kick.frequency.setValueAtTime(120, now);
        kick.frequency.exponentialRampToValueAtTime(35, now + 0.12);
        kickG.gain.setValueAtTime(0.6, now);
        kickG.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        kick.connect(kickG);
        kickG.connect(preampNode);
        kick.start(now);
        kick.stop(now + 0.22);
      }

      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(notes[step % notes.length], now);
      g.gain.setValueAtTime(0.25, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc.connect(g);
      g.connect(preampNode);
      osc.start(now);
      osc.stop(now + 0.18);
      step++;
    }, 140);
  });

  // Power switch
  powerToggle.addEventListener('change', () => {
    isEnabled = powerToggle.checked;
    if (volNode && audioCtx) {
      volNode.gain.setTargetAtTime(isEnabled ? (sVolume.value / 100) : 0, audioCtx.currentTime, 0.02);
    }
  });

  // Profile select
  profileSelect.addEventListener('change', () => {
    applyHeadphoneProfile();
  });

  // Trajectory select
  trajectorySelect.addEventListener('change', () => {
    mode = parseInt(trajectorySelect.value, 10);
    const names = ['Static Center', 'Orbit 360°', 'Figure-8', 'Front Stage', 'Concert Hall', 'Cinema Arc', 'Wide Studio', 'Random Ambient'];
    radarBadge.textContent = names[mode] || 'Orbit 360°';
  });

  // Presets Pills
  presetPills.forEach(pill => {
    pill.addEventListener('click', () => {
      presetPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');

      const pKey = pill.dataset.preset;
      const preset = TARGET_PRESETS[pKey];
      if (preset) {
        mode = preset.mode;
        trajectorySelect.value = mode;
        intensity = preset.intensity;
        speedHz = preset.speedHz;
        userDistance = preset.distance;
        stereoWidth = preset.width;

        sIntensity.value = Math.round(intensity * 100);
        valIntensity.textContent = sIntensity.value + '%';
        sSpeed.value = Math.round(speedHz * 100);
        valSpeed.textContent = (sSpeed.value / 100).toFixed(2) + ' Hz';
        sDistance.value = Math.round(userDistance * 10);
        valDistance.textContent = (sDistance.value / 10).toFixed(1) + ' m';
        sWidth.value = Math.round(stereoWidth * 100);
        valWidth.textContent = sWidth.value + '%';

        const names = ['Static Center', 'Orbit 360°', 'Figure-8', 'Front Stage', 'Concert Hall', 'Cinema Arc', 'Wide Studio', 'Random Ambient'];
        radarBadge.textContent = names[mode] || 'Orbit 360°';
      }
    });
  });

  // Touch Sliders
  sIntensity.addEventListener('input', (e) => {
    intensity = e.target.value / 100;
    valIntensity.textContent = e.target.value + '%';
  });
  sSpeed.addEventListener('input', (e) => {
    speedHz = e.target.value / 100;
    valSpeed.textContent = speedHz.toFixed(2) + ' Hz';
  });
  sDistance.addEventListener('input', (e) => {
    userDistance = e.target.value / 10;
    valDistance.textContent = userDistance.toFixed(1) + ' m';
  });
  sWidth.addEventListener('input', (e) => {
    stereoWidth = e.target.value / 100;
    valWidth.textContent = e.target.value + '%';
  });
  sVolume.addEventListener('input', (e) => {
    const val = e.target.value / 100;
    valVolume.textContent = e.target.value + '%';
    if (volNode && audioCtx) volNode.gain.setTargetAtTime(val, audioCtx.currentTime, 0.02);
  });

  // --- Visualizers ---
  function drawRadar(x, y) {
    const w = radarCanvas.width;
    const h = radarCanvas.height;
    const cx = w / 2;
    const cy = h / 2;

    radarCtx.fillStyle = '#080a11';
    radarCtx.fillRect(0, 0, w, h);

    // Range rings
    radarCtx.strokeStyle = 'rgba(255,255,255,0.08)';
    [25, 45, 60].forEach(r => {
      radarCtx.beginPath();
      radarCtx.arc(cx, cy, r, 0, Math.PI * 2);
      radarCtx.stroke();
    });

    // Center Head
    radarCtx.fillStyle = '#ffffff';
    radarCtx.beginPath();
    radarCtx.arc(cx, cy, 6, 0, Math.PI * 2);
    radarCtx.fill();

    // Headphones
    radarCtx.fillStyle = '#7b2cbf';
    radarCtx.fillRect(cx - 9, cy - 3, 2, 6);
    radarCtx.fillRect(cx + 7, cy - 3, 2, 6);

    // Orbiting Sound Source
    const scale = 28;
    const ex = cx + x * scale;
    const ey = cy - y * scale;

    radarCtx.fillStyle = '#00f5d4';
    radarCtx.shadowColor = '#00f5d4';
    radarCtx.shadowBlur = 10;
    radarCtx.beginPath();
    radarCtx.arc(ex, ey, 4.5, 0, Math.PI * 2);
    radarCtx.fill();
    radarCtx.shadowBlur = 0;
  }

  function drawSpectrum() {
    const w = spectrumCanvas.width;
    const h = spectrumCanvas.height;
    spectrumCtx.fillStyle = '#080a11';
    spectrumCtx.fillRect(0, 0, w, h);

    if (!analyserNode) return;
    const data = new Uint8Array(32);
    analyserNode.getByteFrequencyData(data);

    const barW = (w / 32) - 2;
    for (let i = 0; i < 32; i++) {
      const val = data[i] / 255.0;
      const barH = Math.max(2, val * (h - 4));
      spectrumCtx.fillStyle = '#00f5d4';
      spectrumCtx.fillRect(i * (barW + 2), h - barH, barW, barH);
    }
  }

  function renderMobilePeqPlot() {
    const w = peqCanvas.width;
    const h = peqCanvas.height;
    peqCtx.fillStyle = '#080a11';
    peqCtx.fillRect(0, 0, w, h);

    // Grid lines
    peqCtx.strokeStyle = 'rgba(255,255,255,0.08)';
    peqCtx.beginPath();
    peqCtx.moveTo(0, h * 0.5);
    peqCtx.lineTo(w, h * 0.5);
    peqCtx.stroke();

    const prof = HEADPHONE_PROFILES[profileSelect.value] || HEADPHONE_PROFILES.kz_edx_pro;
    const points = [];
    for (let i = 0; i < 60; i++) {
      const norm = i / 59;
      const freq = 20 * Math.pow(20000 / 20, norm);
      let gainDb = prof.preampDb || 0;
      prof.filters.forEach(f => {
        if (!f.enabled) return;
        const diff = Math.log2(freq / f.freq);
        const bw = 1.0 / (f.q || 1.0);
        gainDb += f.gain * Math.exp(-0.5 * Math.pow(diff / (bw * 0.7), 2));
      });
      const y = h * 0.5 - (gainDb / 18.0) * (h * 0.45);
      points.push({ x: norm * w, y: Math.max(2, Math.min(h - 2, y)) });
    }

    peqCtx.strokeStyle = '#00f5d4';
    peqCtx.lineWidth = 1.6;
    peqCtx.beginPath();
    peqCtx.moveTo(points[0].x, points[0].y);
    points.forEach(p => peqCtx.lineTo(p.x, p.y));
    peqCtx.stroke();
  }

  renderMobilePeqPlot();
});
