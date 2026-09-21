/**
 * SpatialWave 3D - Popup Interface Controller
 * Manages telemetry, interactive 3D spatial radar, spectrum visualizer,
 * PEQ frequency response plot, AutoEQ profile importer, and DSP parameter synchronization.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const masterPowerToggle = document.getElementById('masterPowerToggle');
  const btnCaptureToggle = document.getElementById('btnCaptureToggle');
  const btnCaptureText = document.getElementById('btnCaptureText');
  const sampleRateText = document.getElementById('sampleRateText');
  const engineTag = document.getElementById('engineTag');
  const domainTag = document.getElementById('domainTag');
  const radarModeBadge = document.getElementById('radarModeBadge');

  const radarCanvas = document.getElementById('radarCanvas');
  const radarCtx = radarCanvas.getContext('2d');
  const spectrumCanvas = document.getElementById('spectrumCanvas');
  const spectrumCtx = spectrumCanvas.getContext('2d');
  const peqPlotCanvas = document.getElementById('peqPlotCanvas');
  const peqPlotCtx = peqPlotCanvas.getContext('2d');

  const trajectoryModeSelect = document.getElementById('trajectoryModeSelect');
  const headphoneProfileSelect = document.getElementById('headphoneProfileSelect');
  const roomSelect = document.getElementById('roomSelect');
  const peqDesc = document.getElementById('peqDesc');

  // Sliders
  const sliderIntensity = document.getElementById('sliderIntensity');
  const sliderSpeed = document.getElementById('sliderSpeed');
  const sliderDistance = document.getElementById('sliderDistance');
  const sliderWidth = document.getElementById('sliderWidth');
  const sliderReverbWet = document.getElementById('sliderReverbWet');
  const sliderBass = document.getElementById('sliderBass');
  const sliderTreble = document.getElementById('sliderTreble');
  const sliderVolume = document.getElementById('sliderVolume');

  // Value Displays
  const valIntensity = document.getElementById('valIntensity');
  const valSpeed = document.getElementById('valSpeed');
  const valDistance = document.getElementById('valDistance');
  const valWidth = document.getElementById('valWidth');
  const valReverbWet = document.getElementById('valReverbWet');
  const valBass = document.getElementById('valBass');
  const valTreble = document.getElementById('valTreble');
  const valVolume = document.getElementById('valVolume');

  // Modal elements
  const autoEqModal = document.getElementById('autoEqModal');
  const btnOpenAutoEqModal = document.getElementById('btnOpenAutoEqModal');
  const btnCloseAutoEqModal = document.getElementById('btnCloseAutoEqModal');
  const btnCancelAutoEq = document.getElementById('btnCancelAutoEq');
  const btnApplyAutoEq = document.getElementById('btnApplyAutoEq');
  const txtAutoEqInput = document.getElementById('txtAutoEqInput');
  const customOption = document.getElementById('customOption');

  // Preset Buttons
  const presetButtons = document.querySelectorAll('.preset-btn');

  // Local state
  let currentTab = null;
  let currentDomain = null;
  let isCapturing = false;
  let activeSettings = null;
  let latestCoords = { x: 0, y: 1.4, z: 0.1, mode: 1 };
  let latestFreqData = new Array(64).fill(0);
  let customPeqProfile = null;

  // 1. Detect Active Tab and Domain
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      currentTab = tab;
      currentDomain = StorageManager.getDomainFromUrl(tab.url) || 'web audio';
      domainTag.textContent = currentDomain;
    }
  } catch (err) {
    domainTag.textContent = 'Active Tab';
  }

  // 2. Load Settings from Storage
  activeSettings = await StorageManager.getSettings(currentDomain);
  syncUiWithSettings(activeSettings);

  // 3. Query Active Capture Status from Background Service Worker
  chrome.runtime.sendMessage({ target: 'background', action: 'GET_STATUS' }, (res) => {
    if (res) {
      isCapturing = res.isCapturing;
      updateCaptureButtonUi(isCapturing);
    }
  });

  // 4. Connect Telemetry BroadcastChannel (FFT & 3D Radar)
  const telemetryChannel = new BroadcastChannel('spatialwave_telemetry');
  telemetryChannel.onmessage = (event) => {
    const data = event.data;
    if (!data || data.type !== 'TELEMETRY') return;

    if (data.sampleRate) {
      sampleRateText.textContent = `${data.sampleRate.toLocaleString()} Hz`;
    }
    if (data.isCapturing !== undefined && data.isCapturing !== isCapturing) {
      isCapturing = data.isCapturing;
      updateCaptureButtonUi(isCapturing);
    }
    if (data.coords) {
      latestCoords = data.coords;
    }
    if (data.freqData) {
      latestFreqData = data.freqData;
    }
  };

  // 5. Update Capture Button UI
  function updateCaptureButtonUi(capturing) {
    if (capturing) {
      btnCaptureToggle.classList.add('capturing');
      btnCaptureText.textContent = 'Release Tab Audio';
    } else {
      btnCaptureToggle.classList.remove('capturing');
      btnCaptureText.textContent = 'Capture & Spatialise Tab';
    }
  }

  // 6. Sync UI Controls with Settings Object
  function syncUiWithSettings(s) {
    masterPowerToggle.checked = s.masterPower !== false;
    trajectoryModeSelect.value = s.mode !== undefined ? s.mode : 1;
    headphoneProfileSelect.value = s.headphoneProfile || 'kz_edx_pro';
    roomSelect.value = s.room || 'studio';

    sliderIntensity.value = Math.round((s.intensity || 0.85) * 100);
    valIntensity.textContent = `${sliderIntensity.value}%`;

    sliderSpeed.value = Math.round((s.speedHz || 0.12) * 100);
    valSpeed.textContent = `${(sliderSpeed.value / 100).toFixed(2)} Hz`;

    sliderDistance.value = Math.round((s.distance || 1.4) * 10);
    valDistance.textContent = `${(sliderDistance.value / 10).toFixed(1)} m`;

    sliderWidth.value = Math.round((s.width || 1.2) * 100);
    valWidth.textContent = `${sliderWidth.value}%`;

    sliderReverbWet.value = Math.round((s.reverbWet !== undefined ? s.reverbWet : 0.15) * 100);
    valReverbWet.textContent = `${sliderReverbWet.value}%`;

    sliderBass.value = Math.round((s.bassShelf || 0) * 10);
    valBass.textContent = `${s.bassShelf >= 0 ? '+' : ''}${(s.bassShelf || 0).toFixed(1)} dB`;

    sliderTreble.value = Math.round((s.trebleShelf || 0) * 10);
    valTreble.textContent = `${s.trebleShelf >= 0 ? '+' : ''}${(s.trebleShelf || 0).toFixed(1)} dB`;

    sliderVolume.value = Math.round((s.volume !== undefined ? s.volume : 1.0) * 100);
    valVolume.textContent = `${sliderVolume.value}%`;

    // Highlight target preset button
    presetButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.preset === s.targetPreset);
    });

    updateTrajectoryBadge(s.mode);
    renderPeqCurve();
  }

  function updateTrajectoryBadge(mode) {
    const modes = [
      'Static Center',
      'Orbit 360°',
      'Figure-8',
      'Front Stage',
      'Concert Hall',
      'Cinema Arc',
      'Wide Studio',
      'Random Ambient'
    ];
    radarModeBadge.textContent = modes[mode] || 'Orbit 360°';
  }

  // 7. Dispatch Settings Changes
  function commitSettings() {
    activeSettings.masterPower = masterPowerToggle.checked;
    activeSettings.mode = parseInt(trajectoryModeSelect.value, 10);
    activeSettings.headphoneProfile = headphoneProfileSelect.value;
    activeSettings.room = roomSelect.value;

    activeSettings.intensity = parseInt(sliderIntensity.value, 10) / 100;
    activeSettings.speedHz = parseInt(sliderSpeed.value, 10) / 100;
    activeSettings.distance = parseInt(sliderDistance.value, 10) / 10;
    activeSettings.width = parseInt(sliderWidth.value, 10) / 100;
    activeSettings.reverbWet = parseInt(sliderReverbWet.value, 10) / 100;
    activeSettings.bassShelf = parseInt(sliderBass.value, 10) / 10;
    activeSettings.trebleShelf = parseInt(sliderTreble.value, 10) / 10;
    activeSettings.volume = parseInt(sliderVolume.value, 10) / 100;

    // Attach active PEQ filters
    const profile = getActiveHeadphoneProfile();
    if (profile) {
      activeSettings.peqPreamp = profile.preampDb;
      activeSettings.peqFilters = profile.filters;
    }

    // Save locally and send to offscreen
    StorageManager.saveSettings(activeSettings, currentDomain);
    chrome.runtime.sendMessage({
      target: 'background',
      action: 'UPDATE_SETTINGS',
      settings: activeSettings
    });

    updateTrajectoryBadge(activeSettings.mode);
    renderPeqCurve();
  }

  function getActiveHeadphoneProfile() {
    const id = headphoneProfileSelect.value;
    if (id === 'custom' && customPeqProfile) {
      return customPeqProfile;
    }
    return HEADPHONE_PROFILES[id] || HEADPHONE_PROFILES.kz_edx_pro;
  }

  // --- Event Listeners ---

  // Capture Toggle Button
  btnCaptureToggle.addEventListener('click', () => {
    if (isCapturing) {
      chrome.runtime.sendMessage({ target: 'background', action: 'STOP_CAPTURE' });
      isCapturing = false;
      updateCaptureButtonUi(false);
    } else {
      chrome.runtime.sendMessage({
        target: 'background',
        action: 'START_CAPTURE',
        tabId: currentTab ? currentTab.id : null
      });
      isCapturing = true;
      updateCaptureButtonUi(true);
    }
  });

  // Master Power
  masterPowerToggle.addEventListener('change', () => {
    commitSettings();
  });

  // Mode & Room selects
  trajectoryModeSelect.addEventListener('change', commitSettings);
  roomSelect.addEventListener('change', commitSettings);

  // Headphone Profile Select
  headphoneProfileSelect.addEventListener('change', () => {
    const prof = getActiveHeadphoneProfile();
    if (prof) {
      peqDesc.textContent = prof.name;
    }
    commitSettings();
  });

  // Sliders Input Bindings
  sliderIntensity.addEventListener('input', (e) => {
    valIntensity.textContent = `${e.target.value}%`;
    commitSettings();
  });
  sliderSpeed.addEventListener('input', (e) => {
    valSpeed.textContent = `${(e.target.value / 100).toFixed(2)} Hz`;
    commitSettings();
  });
  sliderDistance.addEventListener('input', (e) => {
    valDistance.textContent = `${(e.target.value / 10).toFixed(1)} m`;
    commitSettings();
  });
  sliderWidth.addEventListener('input', (e) => {
    valWidth.textContent = `${e.target.value}%`;
    commitSettings();
  });
  sliderReverbWet.addEventListener('input', (e) => {
    valReverbWet.textContent = `${e.target.value}%`;
    commitSettings();
  });
  sliderBass.addEventListener('input', (e) => {
    const val = e.target.value / 10;
    valBass.textContent = `${val >= 0 ? '+' : ''}${val.toFixed(1)} dB`;
    commitSettings();
  });
  sliderTreble.addEventListener('input', (e) => {
    const val = e.target.value / 10;
    valTreble.textContent = `${val >= 0 ? '+' : ''}${val.toFixed(1)} dB`;
    commitSettings();
  });
  sliderVolume.addEventListener('input', (e) => {
    valVolume.textContent = `${e.target.value}%`;
    commitSettings();
  });

  // Target Preset Buttons
  presetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const presetKey = btn.dataset.preset;
      const preset = TARGET_PRESETS[presetKey];
      if (!preset) return;

      activeSettings.targetPreset = presetKey;
      activeSettings.mode = preset.mode;
      activeSettings.intensity = preset.intensity;
      activeSettings.speedHz = preset.speedHz;
      activeSettings.distance = preset.distance;
      activeSettings.width = preset.width;
      activeSettings.room = preset.room;
      activeSettings.reverbWet = preset.reverbWet;
      activeSettings.bassShelf = preset.bassShelf;
      activeSettings.trebleShelf = preset.trebleShelf;
      if (preset.compressor) activeSettings.compressor = preset.compressor;

      syncUiWithSettings(activeSettings);
      commitSettings();
    });
  });

  // AutoEQ Modal Handlers
  btnOpenAutoEqModal.addEventListener('click', () => {
    autoEqModal.style.display = 'flex';
    txtAutoEqInput.focus();
  });
  btnCloseAutoEqModal.addEventListener('click', () => autoEqModal.style.display = 'none');
  btnCancelAutoEq.addEventListener('click', () => autoEqModal.style.display = 'none');

  btnApplyAutoEq.addEventListener('click', () => {
    const text = txtAutoEqInput.value.trim();
    if (!text) return;

    const parsed = parseAutoEQText(text);
    if (!parsed) {
      alert('Unable to parse AutoEQ format. Please ensure you copied a valid Parametric EQ .txt export.');
      return;
    }

    customPeqProfile = parsed;
    customOption.style.display = 'block';
    customOption.selected = true;
    peqDesc.textContent = `Custom: ${parsed.filters.length} filters (Preamp ${parsed.preampDb} dB)`;
    autoEqModal.style.display = 'none';

    commitSettings();
  });

  // --- Visualizer Rendering Loops (60fps) ---

  function renderVisualizers() {
    drawRadar();
    drawSpectrum();
    requestAnimationFrame(renderVisualizers);
  }
  requestAnimationFrame(renderVisualizers);

  /**
   * 1. Draws the 3D Spatial Acoustic Radar
   */
  function drawRadar() {
    const w = radarCanvas.width;
    const h = radarCanvas.height;
    const cx = w / 2;
    const cy = h / 2;

    radarCtx.clearRect(0, 0, w, h);

    // Dark grid background
    radarCtx.fillStyle = '#090c14';
    radarCtx.fillRect(0, 0, w, h);

    // Range rings
    radarCtx.lineWidth = 1;
    [25, 45, 62].forEach((r, idx) => {
      radarCtx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
      radarCtx.beginPath();
      radarCtx.arc(cx, cy, r, 0, Math.PI * 2);
      radarCtx.stroke();
    });

    // Crosshairs
    radarCtx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    radarCtx.beginPath();
    radarCtx.moveTo(cx, 10); radarCtx.lineTo(cx, h - 10);
    radarCtx.moveTo(20, cy); radarCtx.lineTo(w - 20, cy);
    radarCtx.stroke();

    // Direction labels (F, B, L, R)
    radarCtx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    radarCtx.font = '8px monospace';
    radarCtx.textAlign = 'center';
    radarCtx.fillText('FRONT', cx, 14);
    radarCtx.fillText('REAR', cx, h - 6);
    radarCtx.fillText('L', 26, cy + 3);
    radarCtx.fillText('R', w - 26, cy + 3);

    // Draw active trajectory path outline
    const mode = activeSettings ? activeSettings.mode : 1;
    drawTrajectoryGuide(radarCtx, cx, cy, mode);

    // Draw Listener Head at center
    radarCtx.fillStyle = '#ffffff';
    radarCtx.beginPath();
    radarCtx.arc(cx, cy, 7, 0, Math.PI * 2);
    radarCtx.fill();

    // Head orientation nose tick
    radarCtx.strokeStyle = '#00f5d4';
    radarCtx.lineWidth = 2;
    radarCtx.beginPath();
    radarCtx.moveTo(cx, cy - 7);
    radarCtx.lineTo(cx, cy - 12);
    radarCtx.stroke();

    // Headphones (Left / Right ears)
    radarCtx.fillStyle = '#7b2cbf';
    radarCtx.fillRect(cx - 10, cy - 3, 2, 6);
    radarCtx.fillRect(cx + 8, cy - 3, 2, 6);

    // Draw Orbiting Emitter
    const scale = 32; // pixels per meter
    const ex = cx + (latestCoords.x || 0) * scale;
    const ey = cy - (latestCoords.y || 0) * scale; // Inverted Y (Y > 0 is front)

    // Glowing emitter halo
    const emitterGrad = radarCtx.createRadialGradient(ex, ey, 2, ex, ey, 14);
    emitterGrad.addColorStop(0, 'rgba(0, 245, 212, 0.9)');
    emitterGrad.addColorStop(0.5, 'rgba(123, 44, 191, 0.4)');
    emitterGrad.addColorStop(1, 'transparent');

    radarCtx.fillStyle = emitterGrad;
    radarCtx.beginPath();
    radarCtx.arc(ex, ey, 14, 0, Math.PI * 2);
    radarCtx.fill();

    // Core Emitter Point
    radarCtx.fillStyle = '#00f5d4';
    radarCtx.beginPath();
    radarCtx.arc(ex, ey, 3.5, 0, Math.PI * 2);
    radarCtx.fill();
  }

  function drawTrajectoryGuide(ctx, cx, cy, mode) {
    ctx.strokeStyle = 'rgba(0, 245, 212, 0.15)';
    ctx.setLineDash([2, 4]);
    ctx.beginPath();

    const r = 45;
    if (mode === 1) { // Orbit
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
    } else if (mode === 2) { // Fig-8
      for (let a = 0; a <= Math.PI * 2; a += 0.1) {
        const x = cx + r * Math.sin(a);
        const y = cy - (r * 0.85) * Math.sin(2 * a);
        if (a === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    } else if (mode === 3) { // Front Arc
      ctx.arc(cx, cy, r, -Math.PI * 0.75, -Math.PI * 0.25);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /**
   * 2. Draws the Real-time Audio Spectrum
   */
  function drawSpectrum() {
    const w = spectrumCanvas.width;
    const h = spectrumCanvas.height;

    spectrumCtx.clearRect(0, 0, w, h);
    spectrumCtx.fillStyle = '#080a11';
    spectrumCtx.fillRect(0, 0, w, h);

    const numBars = 48;
    const barWidth = (w / numBars) - 1.5;

    for (let i = 0; i < numBars; i++) {
      const val = (latestFreqData[i] || 0) / 255.0;
      const barHeight = Math.max(2, val * (h - 4));

      const grad = spectrumCtx.createLinearGradient(0, h, 0, 0);
      grad.addColorStop(0, '#7b2cbf');
      grad.addColorStop(0.6, '#00f5d4');
      grad.addColorStop(1, '#ffffff');

      spectrumCtx.fillStyle = grad;
      spectrumCtx.fillRect(i * (barWidth + 1.5), h - barHeight, barWidth, barHeight);
    }
  }

  /**
   * 3. Draws the Interactive Parametric EQ Frequency Response Plot
   */
  function renderPeqCurve() {
    const w = peqPlotCanvas.width;
    const h = peqPlotCanvas.height;

    peqPlotCtx.clearRect(0, 0, w, h);
    peqPlotCtx.fillStyle = '#090c14';
    peqPlotCtx.fillRect(0, 0, w, h);

    // Draw dB Grid Lines (+12dB, +6dB, 0dB, -6dB, -12dB)
    peqPlotCtx.lineWidth = 1;
    const dbLines = [12, 6, 0, -6, -12];
    peqPlotCtx.font = '8px monospace';
    peqPlotCtx.textAlign = 'right';

    dbLines.forEach(db => {
      const y = h * 0.5 - (db / 18.0) * (h * 0.45);
      peqPlotCtx.strokeStyle = db === 0 ? 'rgba(255, 255, 255, 0.18)' : 'rgba(255, 255, 255, 0.05)';
      peqPlotCtx.beginPath();
      peqPlotCtx.moveTo(0, y);
      peqPlotCtx.lineTo(w, y);
      peqPlotCtx.stroke();

      if (db === 0 || db === 12 || db === -12) {
        peqPlotCtx.fillStyle = 'rgba(255, 255, 255, 0.25)';
        peqPlotCtx.fillText(`${db > 0 ? '+' : ''}${db}`, 20, y + 3);
      }
    });

    // Draw Frequency Grid Lines (100Hz, 1kHz, 10kHz)
    const freqMarkers = [100, 1000, 10000];
    freqMarkers.forEach(f => {
      const x = (Math.log10(f / 20) / Math.log10(20000 / 20)) * w;
      peqPlotCtx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      peqPlotCtx.beginPath();
      peqPlotCtx.moveTo(x, 0);
      peqPlotCtx.lineTo(x, h);
      peqPlotCtx.stroke();

      peqPlotCtx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      peqPlotCtx.textAlign = 'center';
      peqPlotCtx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x, h - 3);
    });

    // Calculate Composite Frequency Response Curve
    const profile = getActiveHeadphoneProfile();
    if (!profile || !profile.filters) return;

    const points = [];
    const numPoints = 120;
    const preamp = profile.preampDb || 0;
    const bassShelf = (activeSettings ? activeSettings.bassShelf : 0) || 0;
    const trebleShelf = (activeSettings ? activeSettings.trebleShelf : 0) || 0;

    for (let i = 0; i < numPoints; i++) {
      const norm = i / (numPoints - 1);
      const freq = 20 * Math.pow(20000 / 20, norm);

      let totalGainDb = preamp;

      // Add bass shelf response
      if (bassShelf !== 0) {
        const fRatio = freq / 120.0;
        totalGainDb += bassShelf / (1.0 + Math.pow(fRatio, 2));
      }

      // Add treble shelf response
      if (trebleShelf !== 0) {
        const fRatio = freq / 10000.0;
        totalGainDb += trebleShelf * (Math.pow(fRatio, 2) / (1.0 + Math.pow(fRatio, 2)));
      }

      // Add PEQ filters
      for (const f of profile.filters) {
        if (!f.enabled) continue;
        const diff = Math.log2(freq / f.freq);
        const bw = 1.0 / (f.q || 1.0);
        // Gaussian approximation for interactive visual display
        const filterEffect = f.gain * Math.exp(-0.5 * Math.pow(diff / (bw * 0.7), 2));
        totalGainDb += filterEffect;
      }

      const y = h * 0.5 - (totalGainDb / 18.0) * (h * 0.45);
      points.push({ x: norm * w, y: Math.max(2, Math.min(h - 2, y)) });
    }

    // Draw PEQ Curve Glow & Fill
    peqPlotCtx.beginPath();
    peqPlotCtx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      peqPlotCtx.lineTo(points[i].x, points[i].y);
    }

    peqPlotCtx.strokeStyle = '#00f5d4';
    peqPlotCtx.lineWidth = 1.8;
    peqPlotCtx.shadowColor = '#00f5d4';
    peqPlotCtx.shadowBlur = 6;
    peqPlotCtx.stroke();
    peqPlotCtx.shadowBlur = 0; // reset
  }
});
