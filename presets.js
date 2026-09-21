/**
 * SpatialWave 3D - Presets and AutoEQ Database
 * Includes audiophile target presets and pre-calibrated Parametric EQ profiles
 * (such as KZ EDX Pro, Sennheiser HD600, Sony XM4, Harman Target).
 */

const TARGET_PRESETS = {
  gaming: {
    name: 'Tactical Gaming (CS2)',
    description: 'Ultra-low latency, crisp footstep directional cues (1.5-4.5kHz boost, scooped low-mids, zero reverb).',
    mode: 0, // Static Center with directional panning
    intensity: 0.95,
    speedHz: 0.1,
    distance: 1.0,
    width: 1.35,
    room: 'studio',
    reverbWet: 0.0, // Zero reverb for tactical clarity
    bassShelf: -1.5,
    trebleShelf: 3.5,
    compressor: {
      thresholdDb: -18.0,
      ratio: 3.2,
      attackMs: 5.0,
      releaseMs: 80.0,
      makeupGain: 1.25
    },
    peq: [
      { type: 'lowshelf', freq: 120, gain: -2.0, q: 0.71, enabled: true },
      { type: 'peaking',  freq: 320, gain: -3.5, q: 1.4, enabled: true }, // scoop mud
      { type: 'peaking',  freq: 2200, gain: 4.0, q: 1.8, enabled: true }, // footstep crunch
      { type: 'peaking',  freq: 4100, gain: 3.0, q: 2.0, enabled: true }, // reload/pin cues
      { type: 'highshelf', freq: 8000, gain: 2.0, q: 0.71, enabled: true }
    ]
  },

  audiophile: {
    name: 'Lossless / Audiophile',
    description: 'Minimal-phase bit-perfect listening. Structural HRTF crossfeed only, zero artificial reverb, flat curve.',
    mode: 0, // Static Center
    intensity: 0.40,
    speedHz: 0.05,
    distance: 1.8,
    width: 1.10,
    room: 'studio',
    reverbWet: 0.0, // Reverb bypassed for purist FLAC listening
    bassShelf: 0.0,
    trebleShelf: 0.0,
    compressor: {
      thresholdDb: -6.0,
      ratio: 1.5,
      attackMs: 30.0,
      releaseMs: 250.0,
      makeupGain: 1.0
    },
    peq: [
      { type: 'peaking', freq: 1000, gain: 0.0, q: 1.0, enabled: true }
    ]
  },

  cinema: {
    name: 'Cinema Surround',
    description: 'Expansive theatrical soundstage, deep sub-bass impact, large hall acoustic convolution.',
    mode: 5, // Cinema Front Arc
    intensity: 0.90,
    speedHz: 0.08,
    distance: 2.2,
    width: 1.60,
    room: 'cinema',
    reverbWet: 0.28,
    bassShelf: 4.0,
    trebleShelf: 1.5,
    compressor: {
      thresholdDb: -14.0,
      ratio: 2.8,
      attackMs: 15.0,
      releaseMs: 150.0,
      makeupGain: 1.2
    },
    peq: [
      { type: 'lowshelf', freq: 45, gain: 4.5, q: 0.8, enabled: true },  // Sub impact
      { type: 'peaking', freq: 150, gain: -1.5, q: 1.2, enabled: true },
      { type: 'peaking', freq: 3200, gain: 2.0, q: 1.5, enabled: true }, // Dialogue clarity
      { type: 'highshelf', freq: 10000, gain: 1.5, q: 0.71, enabled: true }
    ]
  },

  asmr: {
    name: 'ASMR / Intimate Vocal',
    description: 'Extreme binaural proximity (0.5m), whisper-close stage, center channel vocal extraction.',
    mode: 1, // Orbit 360
    intensity: 1.0,
    speedHz: 0.06,
    distance: 0.5, // intimate close proximity
    width: 1.80,
    room: 'small_room',
    reverbWet: 0.12,
    bassShelf: 1.0,
    trebleShelf: 2.5,
    compressor: {
      thresholdDb: -20.0,
      ratio: 3.5,
      attackMs: 8.0,
      releaseMs: 90.0,
      makeupGain: 1.35
    },
    peq: [
      { type: 'highpass', freq: 60, gain: 0, q: 0.71, enabled: true }, // Cut handling rumble
      { type: 'peaking', freq: 2800, gain: 3.5, q: 2.0, enabled: true }, // Vocal whisper presence
      { type: 'peaking', freq: 6500, gain: 2.5, q: 2.5, enabled: true }, // Ear tingling air
      { type: 'highshelf', freq: 12000, gain: 3.0, q: 0.71, enabled: true }
    ]
  },

  orbit8d: {
    name: '8D Orbital Immersion',
    description: 'Continuous 360-degree binaural rotation around the listener head with dynamic distance breathing.',
    mode: 1, // Orbit 360
    intensity: 0.90,
    speedHz: 0.12,
    distance: 1.5,
    width: 1.45,
    room: 'concert_hall',
    reverbWet: 0.22,
    bassShelf: 2.0,
    trebleShelf: 1.0,
    compressor: {
      thresholdDb: -12.0,
      ratio: 2.5,
      attackMs: 12.0,
      releaseMs: 120.0,
      makeupGain: 1.15
    },
    peq: [
      { type: 'lowshelf', freq: 80, gain: 2.5, q: 0.71, enabled: true },
      { type: 'highshelf', freq: 11000, gain: 1.5, q: 0.71, enabled: true }
    ]
  },

  music: {
    name: 'Music Master Studio',
    description: 'Balanced studio acoustics, natural stereo widening, smooth high-end air, and master bus polish.',
    mode: 6, // Wide Studio
    intensity: 0.75,
    speedHz: 0.08,
    distance: 1.4,
    width: 1.30,
    room: 'studio',
    reverbWet: 0.16,
    bassShelf: 1.5,
    trebleShelf: 1.0,
    compressor: {
      thresholdDb: -10.0,
      ratio: 2.0,
      attackMs: 20.0,
      releaseMs: 180.0,
      makeupGain: 1.1
    },
    peq: [
      { type: 'lowshelf', freq: 65, gain: 1.5, q: 0.71, enabled: true },
      { type: 'peaking', freq: 3500, gain: 1.0, q: 1.4, enabled: true },
      { type: 'highshelf', freq: 12000, gain: 1.5, q: 0.71, enabled: true }
    ]
  }
};

/**
 * Pre-calibrated Headphone Parametric EQ Profiles
 */
const HEADPHONE_PROFILES = {
  kz_edx_pro: {
    id: 'kz_edx_pro',
    name: 'KZ EDX Pro (Audiophile Calibration)',
    description: 'Tames the piercing 4.5kHz & 8kHz peaks, clears the 180Hz mid-bass boom, and extends 35Hz sub-bass.',
    preampDb: -3.5,
    filters: [
      { type: 'peaking', freq: 35, gain: 3.2, q: 1.2, enabled: true },
      { type: 'peaking', freq: 180, gain: -2.8, q: 1.4, enabled: true },
      { type: 'peaking', freq: 1200, gain: 1.5, q: 1.6, enabled: true },
      { type: 'peaking', freq: 4600, gain: -5.2, q: 2.8, enabled: true }, // sharp peak fix
      { type: 'peaking', freq: 8300, gain: -4.0, q: 3.2, enabled: true }, // sibilance fix
      { type: 'highshelf', freq: 11000, gain: 1.2, q: 0.71, enabled: true }
    ]
  },

  hd600: {
    id: 'hd600',
    name: 'Sennheiser HD 600 / HD 650',
    description: 'Adds sub-bass extension (<60Hz) and aligns upper mids with the Harman audiophile target.',
    preampDb: -4.0,
    filters: [
      { type: 'lowshelf', freq: 55, gain: 4.8, q: 0.71, enabled: true },
      { type: 'peaking', freq: 160, gain: -1.2, q: 1.2, enabled: true },
      { type: 'peaking', freq: 3500, gain: -1.5, q: 2.0, enabled: true },
      { type: 'highshelf', freq: 9500, gain: 1.0, q: 0.71, enabled: true }
    ]
  },

  sony_xm4: {
    id: 'sony_xm4',
    name: 'Sony WH-1000XM4 / XM5',
    description: 'Cuts muddy 150-250Hz lower-mid bleed and reveals vocal presence and acoustic sparkle.',
    preampDb: -3.0,
    filters: [
      { type: 'peaking', freq: 180, gain: -4.5, q: 1.2, enabled: true }, // remove mud
      { type: 'peaking', freq: 1100, gain: 2.0, q: 1.5, enabled: true },
      { type: 'peaking', freq: 3200, gain: 2.5, q: 1.8, enabled: true },
      { type: 'highshelf', freq: 8500, gain: 2.0, q: 0.71, enabled: true }
    ]
  },

  harman_target: {
    id: 'harman_target',
    name: 'Harman 2019 Target (Universal)',
    description: 'Golden reference target curve with controlled Harman sub-bass shelf and linear pinna compensation.',
    preampDb: -2.5,
    filters: [
      { type: 'lowshelf', freq: 105, gain: 4.5, q: 0.71, enabled: true },
      { type: 'peaking', freq: 200, gain: -1.0, q: 1.0, enabled: true },
      { type: 'peaking', freq: 2800, gain: 2.0, q: 1.5, enabled: true },
      { type: 'highshelf', freq: 10000, gain: 1.0, q: 0.71, enabled: true }
    ]
  },

  flat: {
    id: 'flat',
    name: 'Flat Reference / Bypass',
    description: 'Zero coloration, bit-perfect linear frequency response.',
    preampDb: 0.0,
    filters: [
      { type: 'peaking', freq: 1000, gain: 0.0, q: 1.0, enabled: true }
    ]
  }
};

/**
 * Parses AutoEQ Parametric EQ .txt exports into filter arrays
 * Format example:
 * Preamp: -5.4 dB
 * Filter 1: ON PK Fc 32 Hz Gain -2.1 dB Q 1.41
 * Filter 2: ON LSC Fc 105 Hz Gain 5.5 dB Q 0.71
 * Filter 3: ON HSC Fc 10000 Hz Gain -3.0 dB Q 0.71
 */
function parseAutoEQText(text) {
  if (!text || typeof text !== 'string') return null;

  const lines = text.split(/\r?\n/);
  let preampDb = 0.0;
  const filters = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    // Check for Preamp
    const preampMatch = line.match(/^Preamp:\s*([+-]?\d+(?:\.\d+)?)\s*dB/i);
    if (preampMatch) {
      preampDb = parseFloat(preampMatch[1]);
      continue;
    }

    // Match filter line: Filter N: ON/OFF TYPE Fc XXX Hz Gain XXX dB Q XXX
    const filterRegex = /Filter\s+\d+:\s+(ON|OFF)\s+([A-Z]+)\s+Fc\s+([\d.]+)\s*Hz\s+Gain\s+([+-]?[\d.]+)\s*dB\s+Q\s+([\d.]+)/i;
    const match = line.match(filterRegex);
    if (match) {
      const enabled = match[1].toUpperCase() === 'ON';
      const rawType = match[2].toUpperCase();
      const freq = parseFloat(match[3]);
      const gain = parseFloat(match[4]);
      const q = parseFloat(match[5]);

      let type = 'peaking';
      if (rawType === 'PK') type = 'peaking';
      else if (rawType === 'LSC') type = 'lowshelf';
      else if (rawType === 'HSC') type = 'highshelf';
      else if (rawType === 'LP' || rawType === 'LPQ') type = 'lowpass';
      else if (rawType === 'HP' || rawType === 'HPQ') type = 'highpass';

      filters.push({
        type,
        freq,
        gain,
        q,
        enabled
      });
    }
  }

  if (filters.length === 0) return null;

  return {
    name: 'Imported AutoEQ Profile',
    preampDb,
    filters
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TARGET_PRESETS, HEADPHONE_PROFILES, parseAutoEQText };
}
