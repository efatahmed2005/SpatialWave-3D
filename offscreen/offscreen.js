/**
 * SpatialWave 3D - Offscreen Document Audio Engine Host
 * Intercepts the raw tab MediaStream, hosts the AudioContext, builds the
 * Parametric EQ / Reverb / Worklet pipeline, and routes spatialized audio to the user's headphones.
 */

// Global audio graph state
let audioCtx = null;
let mediaStream = null;
let sourceNode = null;
let preampNode = null;
let peqFilterNodes = [];
let bassShelfNode = null;
let trebleShelfNode = null;
let workletNode = null;
let convolverNode = null;
let dryGainNode = null;
let wetGainNode = null;
let masterSumNode = null;
let volumeNode = null;
let analyserNode = null;

let isCapturing = false;
let isBypassed = false;
let currentTabId = null;

// Telemetry channel to stream spectrum & 3D radar data to popup
const telemetryChannel = new BroadcastChannel('spatialwave_telemetry');
let telemetryIntervalId = null;
let currentCoords = { x: 0, y: 1.4, z: 0.1, mode: 1 };

// Cache for procedural convolution impulse buffers
const irBufferCache = {};

/**
 * Procedural Impulse Response Generator for ConvolverNode
 * Creates pristine stereo acoustics without external WAV dependencies.
 */
function createSyntheticImpulseResponse(ctx, type) {
  if (irBufferCache[type]) return irBufferCache[type];

  let duration = 1.0;
  let decayRate = 3.0;
  let preDelay = 0.01;
  let hfDamping = 0.5;

  switch (type) {
    case 'studio':
      duration = 0.35;
      decayRate = 6.0;
      preDelay = 0.005;
      hfDamping = 0.3;
      break;
    case 'small_room':
      duration = 0.70;
      decayRate = 4.2;
      preDelay = 0.012;
      hfDamping = 0.4;
      break;
    case 'concert_hall':
      duration = 2.40;
      decayRate = 1.8;
      preDelay = 0.024;
      hfDamping = 0.65;
      break;
    case 'arena':
      duration = 3.80;
      decayRate = 1.2;
      preDelay = 0.040;
      hfDamping = 0.75;
      break;
    case 'cathedral':
      duration = 5.20;
      decayRate = 0.8;
      preDelay = 0.050;
      hfDamping = 0.85;
      break;
    case 'cinema':
      duration = 1.80;
      decayRate = 2.4;
      preDelay = 0.018;
      hfDamping = 0.55;
      break;
    default:
      duration = 1.2;
      decayRate = 2.5;
  }

  const sampleRate = ctx.sampleRate;
  const numFrames = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(2, numFrames, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  const preDelayFrames = Math.floor(sampleRate * preDelay);

  // Generate diffuse stereo exponential decay with high-frequency absorption
  let lFilter = 0;
  let rFilter = 0;

  for (let i = 0; i < numFrames; i++) {
    if (i < preDelayFrames) {
      left[i] = 0;
      right[i] = 0;
      continue;
    }

    const t = (i - preDelayFrames) / sampleRate;
    const envelope = Math.exp(-decayRate * t);

    // Filtered white noise for stereo diffusion
    const whiteL = (Math.random() * 2 - 1);
    const whiteR = (Math.random() * 2 - 1);

    // High-frequency absorption over distance
    const damp = Math.min(0.95, hfDamping * (t / duration));
    lFilter = lFilter * damp + whiteL * (1 - damp);
    rFilter = rFilter * damp + whiteR * (1 - damp);

    // Add discrete early reflections
    let earlyL = 0;
    let earlyR = 0;
    if (i === Math.floor(preDelayFrames * 1.8)) { earlyL = 0.7; earlyR = 0.3; }
    if (i === Math.floor(preDelayFrames * 2.6)) { earlyL = 0.2; earlyR = 0.6; }
    if (i === Math.floor(preDelayFrames * 4.1)) { earlyL = 0.5; earlyR = 0.4; }

    left[i] = (lFilter * envelope * 0.7 + earlyL) * 0.8;
    right[i] = (rFilter * envelope * 0.7 + earlyR) * 0.8;
  }

  irBufferCache[type] = buffer;
  return buffer;
}

/**
 * Initializes the captured audio stream and AudioWorklet DSP pipeline
 */
async function initializeStream(streamId, tabId) {
  try {
    currentTabId = tabId;

    // Acquire raw tab audio stream bypassing CORS & DRM
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      },
      video: false
    });

    // Create AudioContext matching native hardware sample rate (e.g. 48000Hz, 96000Hz)
    audioCtx = new AudioContext({
      latencyHint: 'interactive'
    });

    console.log(`[SpatialWave Offscreen] AudioContext created. Native SampleRate: ${audioCtx.sampleRate} Hz`);

    // Load AudioWorklet module
    const workletUrl = chrome.runtime.getURL('dsp/processor.js');
    await audioCtx.audioWorklet.addModule(workletUrl);

    // Create WorkletNode
    workletNode = new AudioWorkletNode(audioCtx, 'spatial-hrtf-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2]
    });

    // Listen for coordinate telemetry from AudioWorklet
    workletNode.port.onmessage = (e) => {
      if (e.data && e.data.type === 'COORDINATES') {
        currentCoords = e.data;
      }
    };

    // Load WASM bytecode if available
    try {
      const wasmUrl = chrome.runtime.getURL('dsp/hrtf_engine.wasm');
      const response = await fetch(wasmUrl);
      if (response.ok) {
        const wasmBytes = await response.arrayBuffer();
        workletNode.port.postMessage({ type: 'INIT_WASM', wasmBytes });
        console.log('[SpatialWave Offscreen] WASM module dispatched to AudioWorklet.');
      }
    } catch (wasmErr) {
      console.warn('[SpatialWave Offscreen] WASM fetch error (running in JS DSP mode):', wasmErr);
    }

    // Build the DSP Graph:
    // Source -> Preamp -> PEQ Filters -> Bass/Treble -> Worklet -> Reverb/Dry -> Sum -> Volume -> Analyser -> Destination
    sourceNode = audioCtx.createMediaStreamSource(mediaStream);
    preampNode = audioCtx.createGain();
    preampNode.gain.value = 1.0;

    bassShelfNode = audioCtx.createBiquadFilter();
    bassShelfNode.type = 'lowshelf';
    bassShelfNode.frequency.value = 120;
    bassShelfNode.gain.value = 0.0;

    trebleShelfNode = audioCtx.createBiquadFilter();
    trebleShelfNode.type = 'highshelf';
    trebleShelfNode.frequency.value = 10000;
    trebleShelfNode.gain.value = 0.0;

    convolverNode = audioCtx.createConvolver();
    convolverNode.buffer = createSyntheticImpulseResponse(audioCtx, 'studio');

    dryGainNode = audioCtx.createGain();
    wetGainNode = audioCtx.createGain();
    dryGainNode.gain.value = 0.85;
    wetGainNode.gain.value = 0.15;

    masterSumNode = audioCtx.createGain();
    volumeNode = audioCtx.createGain();
    volumeNode.gain.value = 1.0;

    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 256;
    analyserNode.smoothingTimeConstant = 0.82;

    // Connect Source -> Preamp
    sourceNode.connect(preampNode);

    // Initial direct connect (PEQ filter insertion happens in applySettings)
    preampNode.connect(bassShelfNode);
    bassShelfNode.connect(trebleShelfNode);
    trebleShelfNode.connect(workletNode);

    // Worklet output splits to Dry & Reverb Wet
    workletNode.connect(dryGainNode);
    workletNode.connect(convolverNode);
    convolverNode.connect(wetGainNode);

    dryGainNode.connect(masterSumNode);
    wetGainNode.connect(masterSumNode);

    masterSumNode.connect(volumeNode);
    volumeNode.connect(analyserNode);
    analyserNode.connect(audioCtx.destination);

    isCapturing = true;
    isBypassed = false;

    // Load initial settings from storage
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['globalSettings'], (res) => {
        if (res.globalSettings) {
          applySettings(res.globalSettings);
        }
      });
    }

    startTelemetryLoop();
    console.log('[SpatialWave Offscreen] DSP Pipeline fully engaged.');

  } catch (err) {
    console.error('[SpatialWave Offscreen] initializeStream error:', err);
  }
}

/**
 * Tears down the active audio stream and releases AudioContext
 */
function stopStream() {
  isCapturing = false;
  stopTelemetryLoop();

  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop());
    mediaStream = null;
  }

  if (audioCtx) {
    audioCtx.close().catch(() => {});
    audioCtx = null;
  }

  console.log('[SpatialWave Offscreen] Stream stopped and AudioContext closed.');
}

/**
 * Applies updated DSP parameters to the audio graph
 */
function applySettings(settings) {
  if (!audioCtx || !workletNode) return;

  const now = audioCtx.currentTime;

  // Master Power / Bypass
  if (typeof settings.masterPower === 'boolean') {
    isBypassed = !settings.masterPower;
    workletNode.port.postMessage({
      type: 'UPDATE_PARAMS',
      enabled: settings.masterPower
    });
  }

  // Volume
  if (typeof settings.volume === 'number' && volumeNode) {
    volumeNode.gain.setTargetAtTime(settings.volume, now, 0.02);
  }

  // Bass & Treble Shelving
  if (typeof settings.bassShelf === 'number' && bassShelfNode) {
    bassShelfNode.gain.setTargetAtTime(settings.bassShelf, now, 0.02);
  }
  if (typeof settings.trebleShelf === 'number' && trebleShelfNode) {
    trebleShelfNode.gain.setTargetAtTime(settings.trebleShelf, now, 0.02);
  }

  // Reverb Room Preset & Wet/Dry mix
  if (settings.room && convolverNode) {
    convolverNode.buffer = createSyntheticImpulseResponse(audioCtx, settings.room);
  }
  if (typeof settings.reverbWet === 'number' && dryGainNode && wetGainNode) {
    const wet = Math.max(0, Math.min(1, settings.reverbWet));
    // Constant power crossfade
    dryGainNode.gain.setTargetAtTime(Math.cos(wet * Math.PI * 0.5), now, 0.02);
    wetGainNode.gain.setTargetAtTime(Math.sin(wet * Math.PI * 0.5), now, 0.02);
  }

  // AudioWorklet 3D parameters
  workletNode.port.postMessage({
    type: 'UPDATE_PARAMS',
    mode: settings.mode,
    intensity: settings.intensity,
    speedHz: settings.speedHz,
    distance: settings.distance,
    width: settings.width
  });

  // Dynamic Bus Compressor
  if (settings.compressor) {
    workletNode.port.postMessage({
      type: 'UPDATE_COMPRESSOR',
      thresholdDb: settings.compressor.thresholdDb,
      ratio: settings.compressor.ratio,
      attackMs: settings.compressor.attackMs,
      releaseMs: settings.compressor.releaseMs,
      makeupGain: settings.compressor.makeupGain
    });
  }

  // Parametric EQ Filters
  if (settings.peqFilters && Array.isArray(settings.peqFilters)) {
    updatePeqChain(settings.peqFilters, settings.peqPreamp || 0.0);
  }
}

/**
 * Reconfigures the cascaded Biquad Parametric EQ chain
 */
function updatePeqChain(filters, preampDb) {
  if (!audioCtx || !preampNode || !bassShelfNode) return;

  const now = audioCtx.currentTime;

  // Set Preamp gain to prevent digital clipping from EQ boosts
  const preampGain = Math.pow(10.0, (preampDb || 0.0) / 20.0);
  preampNode.gain.setTargetAtTime(preampGain, now, 0.02);

  // Disconnect existing PEQ nodes
  preampNode.disconnect();
  for (const node of peqFilterNodes) {
    node.disconnect();
  }
  peqFilterNodes = [];

  // Rebuild cascade
  let lastNode = preampNode;

  for (const f of filters) {
    if (!f.enabled) continue;

    const biquad = audioCtx.createBiquadFilter();
    biquad.type = f.type || 'peaking';
    biquad.frequency.value = f.freq;
    biquad.Q.value = f.q || 1.0;
    biquad.gain.value = f.gain || 0.0;

    lastNode.connect(biquad);
    peqFilterNodes.push(biquad);
    lastNode = biquad;
  }

  // Connect last PEQ node into bass shelf
  lastNode.connect(bassShelfNode);
}

/**
 * Starts 60fps telemetry stream to broadcast spectrum and radar data to popup
 */
function startTelemetryLoop() {
  if (telemetryIntervalId) return;

  const freqData = new Uint8Array(128);

  telemetryIntervalId = setInterval(() => {
    if (!analyserNode || !isCapturing) return;

    analyserNode.getByteFrequencyData(freqData);

    telemetryChannel.postMessage({
      type: 'TELEMETRY',
      sampleRate: audioCtx ? audioCtx.sampleRate : 48000,
      isCapturing,
      isBypassed,
      freqData: Array.from(freqData),
      coords: currentCoords
    });
  }, 33); // ~30 fps update rate is smooth and lightweight
}

function stopTelemetryLoop() {
  if (telemetryIntervalId) {
    clearInterval(telemetryIntervalId);
    telemetryIntervalId = null;
  }
}

// Handle runtime messages from background service worker or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;

  switch (message.action) {
    case 'INIT_STREAM':
      initializeStream(message.streamId, message.tabId);
      sendResponse({ status: 'ok' });
      break;

    case 'STOP_STREAM':
      stopStream();
      sendResponse({ status: 'ok' });
      break;

    case 'UPDATE_DSP_SETTINGS':
      applySettings(message.settings);
      sendResponse({ status: 'ok' });
      break;

    case 'TOGGLE_POWER':
      isBypassed = !isBypassed;
      if (workletNode) {
        workletNode.port.postMessage({
          type: 'UPDATE_PARAMS',
          enabled: !isBypassed
        });
      }
      sendResponse({ isBypassed });
      break;

    case 'GET_TELEMETRY_SYNC':
      sendResponse({
        isCapturing,
        isBypassed,
        sampleRate: audioCtx ? audioCtx.sampleRate : 48000,
        coords: currentCoords
      });
      break;

    default:
      break;
  }
  return true;
});
