/**
 * SpatialWave 3D - Low-Latency AudioWorklet Processor (<15ms latency)
 * Runs on the dedicated high-priority Web Audio rendering thread.
 * 
 * Executes the audiophile 3D binaural HRTF spatialization algorithm,
 * utilizing WebAssembly (WASM) when available, with a synchronized,
 * bit-accurate JavaScript DSP engine.
 */

// Math constants
const PI = Math.PI;
const TWO_PI = Math.PI * 2;
const SPEED_OF_SOUND = 343.0; // m/s
const HEAD_RADIUS = 0.0875;    // 8.75 cm
const DELAY_BUF_SIZE = 4096;

/**
 * 2nd-Order Minimum-Phase Biquad Filter
 */
class WorkletBiquad {
  constructor() {
    this.b0 = 1.0;
    this.b1 = 0.0;
    this.b2 = 0.0;
    this.a1 = 0.0;
    this.a2 = 0.0;
    this.z1 = 0.0;
    this.z2 = 0.0;
  }

  reset() {
    this.z1 = 0.0;
    this.z2 = 0.0;
  }

  process(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }

  setHighShelf(fc, gainDb, fs) {
    const A = Math.pow(10.0, gainDb / 40.0);
    const w0 = (TWO_PI * fc) / fs;
    const cosw0 = Math.cos(w0);
    const sinw0 = Math.sin(w0);
    const alpha = (sinw0 * 0.5) * Math.SQRT2;

    const a0 = (A + 1.0) - (A - 1.0) * cosw0 + 2.0 * Math.sqrt(A) * alpha;
    this.b0 = (A * ((A + 1.0) + (A - 1.0) * cosw0 + 2.0 * Math.sqrt(A) * alpha)) / a0;
    this.b1 = (-2.0 * A * ((A - 1.0) + (A + 1.0) * cosw0)) / a0;
    this.b2 = (A * ((A + 1.0) + (A - 1.0) * cosw0 - 2.0 * Math.sqrt(A) * alpha)) / a0;
    this.a1 = (2.0 * ((A - 1.0) - (A + 1.0) * cosw0)) / a0;
    this.a2 = ((A + 1.0) - (A - 1.0) * cosw0 - 2.0 * Math.sqrt(A) * alpha) / a0;
  }

  setNotch(fc, q, fs) {
    const w0 = (TWO_PI * fc) / fs;
    const alpha = Math.sin(w0) / (2.0 * q);
    const cosw0 = Math.cos(w0);

    const a0 = 1.0 + alpha;
    this.b0 = 1.0 / a0;
    this.b1 = (-2.0 * cosw0) / a0;
    this.b2 = 1.0 / a0;
    this.a1 = (-2.0 * cosw0) / a0;
    this.a2 = (1.0 - alpha) / a0;
  }

  setPeaking(fc, gainDb, q, fs) {
    const A = Math.pow(10.0, gainDb / 40.0);
    const w0 = (TWO_PI * fc) / fs;
    const alpha = Math.sin(w0) / (2.0 * q);
    const cosw0 = Math.cos(w0);

    const a0 = 1.0 + alpha / A;
    this.b0 = (1.0 + alpha * A) / a0;
    this.b1 = (-2.0 * cosw0) / a0;
    this.b2 = (1.0 - alpha * A) / a0;
    this.a1 = (-2.0 * cosw0) / a0;
    this.a2 = (1.0 - alpha / A) / a0;
  }

  setLowpass(fc, q, fs) {
    const w0 = (TWO_PI * fc) / fs;
    const alpha = Math.sin(w0) / (2.0 * q);
    const cosw0 = Math.cos(w0);

    const a0 = 1.0 + alpha;
    this.b0 = ((1.0 - cosw0) * 0.5) / a0;
    this.b1 = (1.0 - cosw0) / a0;
    this.b2 = ((1.0 - cosw0) * 0.5) / a0;
    this.a1 = (-2.0 * cosw0) / a0;
    this.a2 = (1.0 - alpha) / a0;
  }
}

/**
 * Fractional Delay Line with 4-point Hermite cubic interpolation
 */
class WorkletDelayLine {
  constructor(size = DELAY_BUF_SIZE) {
    this.size = size;
    this.mask = size - 1;
    this.buffer = new Float32Array(size);
    this.writeIdx = 0;
  }

  reset() {
    this.buffer.fill(0);
    this.writeIdx = 0;
  }

  write(sample) {
    this.buffer[this.writeIdx] = sample;
    this.writeIdx = (this.writeIdx + 1) & this.mask;
  }

  readDelay(delaySamples) {
    if (delaySamples < 0) delaySamples = 0;
    if (delaySamples > this.size - 4) delaySamples = this.size - 4;

    let readPos = this.writeIdx - delaySamples - 1.0;
    while (readPos < 0) readPos += this.size;

    const i1 = Math.floor(readPos);
    const frac = readPos - i1;

    const i0 = (i1 - 1) & this.mask;
    const i2 = (i1 + 1) & this.mask;
    const i3 = (i1 + 2) & this.mask;
    const safeI1 = i1 & this.mask;

    const y0 = this.buffer[i0];
    const y1 = this.buffer[safeI1];
    const y2 = this.buffer[i2];
    const y3 = this.buffer[i3];

    // Hermite interpolation
    const c0 = y1;
    const c1 = 0.5 * (y2 - y0);
    const c2 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
    const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);

    return ((c3 * frac + c2) * frac + c1) * frac + c0;
  }
}

class HRTFAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this.fs = sampleRate || 48000.0;
    this.currentTimeSec = 0.0;
    this.enabled = true;

    // Movement & spatial parameters
    this.mode = 1; // 1 = Orbit 360
    this.intensity = 0.85;
    this.speedHz = 0.12;
    this.userDistance = 1.4;
    this.stereoWidth = 1.2;

    // Smoothed target parameters to prevent audio clicks
    this.targetIntensity = 0.85;
    this.targetSpeedHz = 0.12;
    this.targetDistance = 1.4;
    this.targetWidth = 1.2;

    // Delay lines for Left / Right ear ITD
    this.delayL = new WorkletDelayLine();
    this.delayR = new WorkletDelayLine();

    // Filters for Head Shadow & Pinna cues
    this.hsL = new WorkletBiquad();
    this.hsR = new WorkletBiquad();
    this.notchL = new WorkletBiquad();
    this.notchR = new WorkletBiquad();
    this.peakL = new WorkletBiquad();
    this.peakR = new WorkletBiquad();
    this.airL = new WorkletBiquad();
    this.airR = new WorkletBiquad();

    // Compressor settings
    this.compThresholdDb = -12.0;
    this.compRatio = 2.5;
    this.compAttackMs = 12.0;
    this.compReleaseMs = 120.0;
    this.compMakeupGain = 1.15;
    this.compEnvelope = 0.0;

    // Ceiling limiter (-1.0 dBFS)
    this.HARD_CEILING = 0.89125;

    // WASM Engine integration
    this.wasmInstance = null;
    this.wasmEnginePtr = 0;
    this.wasmInLPtr = 0;
    this.wasmInRPtr = 0;
    this.wasmOutLPtr = 0;
    this.wasmOutRPtr = 0;

    // Listen for control messages from main offscreen thread
    this.port.onmessage = (event) => {
      this.handleMessage(event.data);
    };
  }

  async handleMessage(data) {
    if (!data) return;

    switch (data.type) {
      case 'UPDATE_PARAMS':
        if (typeof data.enabled === 'boolean') this.enabled = data.enabled;
        if (typeof data.mode === 'number') this.mode = data.mode;
        if (typeof data.intensity === 'number') this.targetIntensity = Math.max(0, Math.min(1, data.intensity));
        if (typeof data.speedHz === 'number') this.targetSpeedHz = Math.max(0.01, Math.min(3, data.speedHz));
        if (typeof data.distance === 'number') this.targetDistance = Math.max(0.3, Math.min(5, data.distance));
        if (typeof data.width === 'number') this.targetWidth = Math.max(0, Math.min(2.5, data.width));
        break;

      case 'UPDATE_COMPRESSOR':
        if (typeof data.thresholdDb === 'number') this.compThresholdDb = data.thresholdDb;
        if (typeof data.ratio === 'number') this.compRatio = data.ratio;
        if (typeof data.attackMs === 'number') this.compAttackMs = data.attackMs;
        if (typeof data.releaseMs === 'number') this.compReleaseMs = data.releaseMs;
        if (typeof data.makeupGain === 'number') this.compMakeupGain = data.makeupGain;
        break;

      case 'INIT_WASM':
        if (data.wasmBytes) {
          try {
            const module = await WebAssembly.compile(data.wasmBytes);
            const instance = await WebAssembly.instantiate(module, {
              env: {
                memory: new WebAssembly.Memory({ initial: 256, maximum: 512 })
              }
            });
            this.setupWasm(instance);
          } catch (err) {
            // Falls back safely to high-fidelity JS DSP engine
          }
        }
        break;

      case 'RESET':
        this.delayL.reset();
        this.delayR.reset();
        this.currentTimeSec = 0.0;
        this.compEnvelope = 0.0;
        break;
    }
  }

  setupWasm(instance) {
    const exports = instance.exports;
    if (exports && exports._create_engine && exports._process_audio) {
      this.wasmInstance = instance;
      this.wasmEnginePtr = exports._create_engine(this.fs);
      this.wasmInLPtr = exports._malloc(128 * 4);
      this.wasmInRPtr = exports._malloc(128 * 4);
      this.wasmOutLPtr = exports._malloc(128 * 4);
      this.wasmOutRPtr = exports._malloc(128 * 4);
    }
  }

  /**
   * Trajectory calculation for dynamic 3D binaural paths
   */
  getTrajectory(t, outPos) {
    const r = this.userDistance * (0.6 + 0.4 * this.intensity);
    const omega = TWO_PI * this.speedHz;

    switch (this.mode) {
      case 0: // Static Center
        outPos.x = 0.0;
        outPos.y = r;
        outPos.z = r * 0.1;
        break;
      case 1: // Orbit 360
        outPos.x = r * Math.sin(omega * t);
        outPos.y = r * Math.cos(omega * t);
        outPos.z = r * 0.25 * Math.sin(omega * 0.5 * t);
        break;
      case 2: // Figure-8
        outPos.x = r * Math.sin(omega * t);
        outPos.y = r * Math.sin(2.0 * omega * t) * 0.85;
        outPos.z = r * 0.18 * Math.cos(omega * t);
        break;
      case 3: // Front Stage
        {
          const angle = (PI / 3.0) * Math.sin(omega * t);
          outPos.x = r * Math.sin(angle);
          outPos.y = r * Math.cos(angle);
          outPos.z = 0.05 * r;
        }
        break;
      case 4: // Concert Hall
        {
          const angle = (PI * 0.45) * Math.sin(omega * 0.7 * t);
          outPos.x = r * 1.3 * Math.sin(angle);
          outPos.y = r * (1.1 + 0.3 * Math.cos(angle));
          outPos.z = r * (0.35 + 0.15 * Math.sin(omega * 0.35 * t));
        }
        break;
      case 5: // Cinema
        {
          const angle = (PI * 0.75) * Math.sin(omega * 0.5 * t);
          outPos.x = r * 1.4 * Math.sin(angle);
          outPos.y = r * (0.9 + 0.4 * Math.cos(angle));
          outPos.z = r * 0.15;
        }
        break;
      case 6: // Wide Studio
        {
          const lateral = 1.0 + 0.4 * Math.sin(omega * t);
          outPos.x = r * 1.2 * Math.sin(omega * 0.3 * t) * lateral;
          outPos.y = r * 0.9;
          outPos.z = 0.0;
        }
        break;
      case 7: // Random Ambient
        outPos.x = r * (0.7 * Math.sin(omega * 0.8 * t) + 0.3 * Math.sin(omega * 1.9 * t));
        outPos.y = r * (0.7 * Math.cos(omega * 0.6 * t) + 0.3 * Math.cos(omega * 1.3 * t));
        outPos.z = r * 0.3 * Math.sin(omega * 0.4 * t);
        break;
      default:
        outPos.x = 0;
        outPos.y = r;
        outPos.z = 0;
    }
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || input.length === 0 || !output || output.length === 0) {
      return true;
    }

    const inL = input[0];
    const inR = input[1] || input[0];
    const outL = output[0];
    const outR = output[1] || output[0];
    const numSamples = inL.length;

    if (!this.enabled) {
      // Pure passthrough bypass
      outL.set(inL);
      outR.set(inR);
      return true;
    }

    // Smooth parameters towards targets
    const smoothFactor = 0.02;
    this.intensity += (this.targetIntensity - this.intensity) * smoothFactor;
    this.speedHz += (this.targetSpeedHz - this.speedHz) * smoothFactor;
    this.userDistance += (this.targetDistance - this.userDistance) * smoothFactor;
    this.stereoWidth += (this.targetWidth - this.stereoWidth) * smoothFactor;

    // Execute via compiled WASM if initialized
    if (this.wasmInstance && this.wasmEnginePtr) {
      const mem = new Float32Array(this.wasmInstance.exports.memory.buffer);
      const exports = this.wasmInstance.exports;

      mem.set(inL, this.wasmInLPtr >> 2);
      mem.set(inR, this.wasmInRPtr >> 2);

      exports._set_parameters(
        this.wasmEnginePtr,
        this.mode,
        this.intensity,
        this.speedHz,
        this.userDistance,
        this.stereoWidth,
        1
      );
      exports._process_audio(
        this.wasmEnginePtr,
        this.wasmInLPtr,
        this.wasmInRPtr,
        this.wasmOutLPtr,
        this.wasmOutRPtr,
        numSamples
      );

      outL.set(mem.subarray(this.wasmOutLPtr >> 2, (this.wasmOutLPtr >> 2) + numSamples));
      outR.set(mem.subarray(this.wasmOutRPtr >> 2, (this.wasmOutRPtr >> 2) + numSamples));
      return true;
    }

    // High-performance direct JS DSP spatialization engine
    const pos = { x: 0, y: 0, z: 0 };
    this.getTrajectory(this.currentTimeSec, pos);
    this.currentTimeSec += numSamples / this.fs;

    // Send spatial coordinate feedback for the UI radar periodically
    if (Math.random() < 0.08) {
      this.port.postMessage({
        type: 'COORDINATES',
        x: pos.x,
        y: pos.y,
        z: pos.z,
        mode: this.mode
      });
    }

    const distance = Math.max(0.2, Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z));
    const azimuth = Math.atan2(pos.x, pos.y);
    const elevation = Math.asin(Math.max(-0.99, Math.min(0.99, pos.z / distance)));

    // 1. Woodworth-Schlosser ITD calculation
    const absAz = Math.abs(azimuth);
    const maxDelaySec = (HEAD_RADIUS / SPEED_OF_SOUND) * (Math.sin(absAz) + absAz);
    const itdSamples = maxDelaySec * this.fs * this.intensity;

    let delayL = 0.0;
    let delayR = 0.0;
    if (azimuth > 0) {
      delayL = itdSamples;
      delayR = 0.0;
    } else {
      delayL = 0.0;
      delayR = itdSamples;
    }

    // 2. Head Shadow ILD
    const cosAz = Math.cos(azimuth);
    const ildGainLDb = -6.0 * (1.0 - Math.cos(azimuth - PI * 0.5)) * 0.5 * this.intensity;
    const ildGainRDb = -6.0 * (1.0 - Math.cos(azimuth + PI * 0.5)) * 0.5 * this.intensity;
    this.hsL.setHighShelf(2400.0, ildGainLDb, this.fs);
    this.hsR.setHighShelf(2400.0, ildGainRDb, this.fs);

    // 3. Pinna Notches & Elevation cues
    let notchFcL = 6800.0 + 2400.0 * Math.sin(elevation) + 600.0 * Math.sin(azimuth);
    let notchFcR = 6800.0 + 2400.0 * Math.sin(elevation) - 600.0 * Math.sin(azimuth);
    notchFcL = Math.max(4000.0, Math.min(12000.0, notchFcL));
    notchFcR = Math.max(4000.0, Math.min(12000.0, notchFcR));

    this.notchL.setNotch(notchFcL, 2.8, this.fs);
    this.notchR.setNotch(notchFcR, 2.8, this.fs);

    const rearDampL = cosAz < 0.0 ? cosAz * 3.5 * this.intensity : 0.8;
    const rearDampR = cosAz < 0.0 ? cosAz * 3.5 * this.intensity : 0.8;
    this.peakL.setPeaking(4200.0, rearDampL, 1.4, this.fs);
    this.peakR.setPeaking(4200.0, rearDampR, 1.4, this.fs);

    // 4. Distance Attenuation & Air Absorption
    const distAtten = Math.min(1.25, 1.0 / (0.8 + 0.2 * distance));
    const airCutoff = Math.max(3000.0, Math.min(20000.0, 22000.0 / Math.sqrt(distance)));
    this.airL.setLowpass(airCutoff, 0.707, this.fs);
    this.airR.setLowpass(airCutoff, 0.707, this.fs);

    // Compressor constants
    const attCoeff = Math.exp(-1.0 / (this.compAttackMs * 0.001 * this.fs));
    const relCoeff = Math.exp(-1.0 / (this.compReleaseMs * 0.001 * this.fs));
    const thresholdLin = Math.pow(10.0, this.compThresholdDb / 20.0);

    for (let i = 0; i < numSamples; ++i) {
      const sL = inL[i];
      const sR = inR[i];

      // Stereo Width (Mid-Side matrix)
      const mid = (sL + sR) * 0.5;
      const side = (sR - sL) * 0.5 * this.stereoWidth;
      const procL = mid - side;
      const procR = mid + side;

      // Fractional Delay ITD
      this.delayL.write(procL);
      this.delayR.write(procR);
      const delL = this.delayL.readDelay(delayL);
      const delR = this.delayR.readDelay(delayR);

      // Head Shadow ILD
      const hl = this.hsL.process(delL);
      const hr = this.hsR.process(delR);

      // Pinna Notch & Elevation
      const pl = this.peakL.process(this.notchL.process(hl));
      const pr = this.peakR.process(this.notchR.process(hr));

      // Distance & Air
      const wetL = this.airL.process(pl) * distAtten;
      const wetR = this.airR.process(pr) * distAtten;

      // Intensity Dry/Wet Blend
      const spatL = (1.0 - this.intensity * 0.7) * procL + (this.intensity * 0.7) * wetL;
      const spatR = (1.0 - this.intensity * 0.7) * procR + (intensityBlend => (this.intensity * 0.7) * wetR)();

      // Bus Compressor
      const peak = Math.max(Math.abs(spatL), Math.abs(spatR));
      if (peak > this.compEnvelope) {
        this.compEnvelope = attCoeff * this.compEnvelope + (1.0 - attCoeff) * peak;
      } else {
        this.compEnvelope = relCoeff * this.compEnvelope + (1.0 - relCoeff) * peak;
      }

      let compGain = 1.0;
      if (this.compEnvelope > thresholdLin) {
        const envDb = 20.0 * Math.log10(this.compEnvelope + 1e-6);
        const overDb = envDb - this.compThresholdDb;
        const reductionDb = overDb * (1.0 - 1.0 / this.compRatio);
        compGain = Math.pow(10.0, -reductionDb / 20.0);
      }

      let finalL = spatL * compGain * this.compMakeupGain;
      let finalR = spatR * compGain * this.compMakeupGain;

      // Hard-Ceiling Limiter (-1.0 dBFS)
      const LIMIT_THRESH = 0.80;
      if (Math.abs(finalL) > LIMIT_THRESH) {
        const sign = finalL > 0 ? 1.0 : -1.0;
        const excess = Math.abs(finalL) - LIMIT_THRESH;
        finalL = sign * (LIMIT_THRESH + (this.HARD_CEILING - LIMIT_THRESH) * Math.tanh(excess / (this.HARD_CEILING - LIMIT_THRESH)));
      }
      if (Math.abs(finalR) > LIMIT_THRESH) {
        const sign = finalR > 0 ? 1.0 : -1.0;
        const excess = Math.abs(finalR) - LIMIT_THRESH;
        finalR = sign * (LIMIT_THRESH + (this.HARD_CEILING - LIMIT_THRESH) * Math.tanh(excess / (this.HARD_CEILING - LIMIT_THRESH)));
      }

      outL[i] = Math.max(-this.HARD_CEILING, Math.min(this.HARD_CEILING, finalL));
      outR[i] = Math.max(-this.HARD_CEILING, Math.min(this.HARD_CEILING, finalR));
    }

    return true;
  }
}

registerProcessor('spatial-hrtf-processor', HRTFAudioProcessor);
