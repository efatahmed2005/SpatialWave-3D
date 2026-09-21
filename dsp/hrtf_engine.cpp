/**
 * SpatialWave 3D - Audiophile C++ DSP Spatialization Engine
 * Compiled to WebAssembly (WASM) for ultra-low latency (<15ms) execution inside an AudioWorklet.
 * 
 * Features:
 * - Woodworth-Schlosser Spherical Head Model Interaural Time Difference (ITD)
 * - Directional Spherical Head Shadow Interaural Level Difference (ILD)
 * - Pinna Elevation & Front-Back Spectral Notch Cues
 * - Sine-Interpolated Dynamic 3D Trajectory Movement Engine
 * - Minimum-Phase Cascaded Distance Attenuation & Air Absorption
 * - Master Bus Compressor & Hard-Ceiling Peak Limiter (-1.0 dBFS)
 */

#include <cmath>
#include <cstring>
#include <algorithm>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define KEEPALIVE EMSCRIPTEN_KEEPALIVE
#else
#define KEEPALIVE
#endif

// Constants for physical acoustics
static constexpr float PI = 3.14159265358979323846f;
static constexpr float TWO_PI = 6.28318530717958647692f;
static constexpr float SPEED_OF_SOUND = 343.0f; // m/s
static constexpr float HEAD_RADIUS = 0.0875f;    // 8.75 cm average human head radius
static constexpr int DELAY_BUFFER_SIZE = 4096;   // Max delay buffer samples (sufficient for up to 96kHz)

/**
 * Standard 2nd-order Biquad Filter structure for minimum-phase filtering
 */
struct Biquad {
    float b0 = 1.0f, b1 = 0.0f, b2 = 0.0f;
    float a1 = 0.0f, a2 = 0.0f;
    float z1 = 0.0f, z2 = 0.0f;

    void reset() {
        z1 = 0.0f;
        z2 = 0.0f;
    }

    inline float process(float in) {
        float out = b0 * in + z1;
        z1 = b1 * in - a1 * out + z2;
        z2 = b2 * in - a2 * out;
        return out;
    }

    void setLowpass(float fc, float q, float fs) {
        float w0 = TWO_PI * fc / fs;
        float alpha = std::sin(w0) / (2.0f * q);
        float cosw0 = std::cos(w0);

        float a0 = 1.0f + alpha;
        b0 = ((1.0f - cosw0) * 0.5f) / a0;
        b1 = (1.0f - cosw0) / a0;
        b2 = ((1.0f - cosw0) * 0.5f) / a0;
        a1 = (-2.0f * cosw0) / a0;
        a2 = (1.0f - alpha) / a0;
    }

    void setHighShelf(float fc, float gainDb, float fs) {
        float A = std::pow(10.0f, gainDb / 40.0f);
        float w0 = TWO_PI * fc / fs;
        float cosw0 = std::cos(w0);
        float sinw0 = std::sin(w0);
        float alpha = sinw0 * 0.5f * std::sqrt(2.0f);

        float a0 = (A + 1.0f) - (A - 1.0f) * cosw0 + 2.0f * std::sqrt(A) * alpha;
        b0 = (A * ((A + 1.0f) + (A - 1.0f) * cosw0 + 2.0f * std::sqrt(A) * alpha)) / a0;
        b1 = (-2.0f * A * ((A - 1.0f) + (A + 1.0f) * cosw0)) / a0;
        b2 = (A * ((A + 1.0f) + (A - 1.0f) * cosw0 - 2.0f * std::sqrt(A) * alpha)) / a0;
        a1 = (2.0f * ((A - 1.0f) - (A + 1.0f) * cosw0)) / a0;
        a2 = ((A + 1.0f) - (A - 1.0f) * cosw0 - 2.0f * std::sqrt(A) * alpha) / a0;
    }

    void setNotch(float fc, float q, float fs) {
        float w0 = TWO_PI * fc / fs;
        float alpha = std::sin(w0) / (2.0f * q);
        float cosw0 = std::cos(w0);

        float a0 = 1.0f + alpha;
        b0 = 1.0f / a0;
        b1 = (-2.0f * cosw0) / a0;
        b2 = 1.0f / a0;
        a1 = (-2.0f * cosw0) / a0;
        a2 = (1.0f - alpha) / a0;
    }

    void setPeaking(float fc, float gainDb, float q, float fs) {
        float A = std::pow(10.0f, gainDb / 40.0f);
        float w0 = TWO_PI * fc / fs;
        float alpha = std::sin(w0) / (2.0f * q);
        float cosw0 = std::cos(w0);

        float a0 = 1.0f + alpha / A;
        b0 = (1.0f + alpha * A) / a0;
        b1 = (-2.0f * cosw0) / a0;
        b2 = (1.0f - alpha * A) / a0;
        a1 = (-2.0f * cosw0) / a0;
        a2 = (1.0f - alpha / A) / a0;
    }
};

/**
 * Fractional delay line with cubic Hermite interpolation
 */
struct FractionalDelayLine {
    float buffer[DELAY_BUFFER_SIZE];
    int writeIndex = 0;

    void reset() {
        std::memset(buffer, 0, sizeof(buffer));
        writeIndex = 0;
    }

    inline void write(float sample) {
        buffer[writeIndex] = sample;
        writeIndex = (writeIndex + 1) & (DELAY_BUFFER_SIZE - 1);
    }

    inline float readDelay(float delaySamples) {
        if (delaySamples < 0.0f) delaySamples = 0.0f;
        if (delaySamples > DELAY_BUFFER_SIZE - 4) delaySamples = DELAY_BUFFER_SIZE - 4;

        float readPos = (float)writeIndex - delaySamples - 1.0f;
        while (readPos < 0.0f) readPos += DELAY_BUFFER_SIZE;

        int i1 = (int)readPos;
        float frac = readPos - (float)i1;

        int i0 = (i1 - 1) & (DELAY_BUFFER_SIZE - 1);
        int i2 = (i1 + 1) & (DELAY_BUFFER_SIZE - 1);
        int i3 = (i1 + 2) & (DELAY_BUFFER_SIZE - 1);
        i1 = i1 & (DELAY_BUFFER_SIZE - 1);

        float y0 = buffer[i0];
        float y1 = buffer[i1];
        float y2 = buffer[i2];
        float y3 = buffer[i3];

        // 4-point Hermite cubic interpolation
        float c0 = y1;
        float c1 = 0.5f * (y2 - y0);
        float c2 = y0 - 2.5f * y1 + 2.0f * y2 - 0.5f * y3;
        float c3 = 0.5f * (y3 - y0) + 1.5f * (y1 - y2);

        return ((c3 * frac + c2) * frac + c1) * frac + c0;
    }
};

/**
 * Dynamic 3D Trajectory Modes
 */
enum TrajectoryMode {
    MODE_STATIC_CENTER = 0,
    MODE_ORBIT_360     = 1,
    MODE_FIGURE_8      = 2,
    MODE_FRONT_STAGE   = 3,
    MODE_CONCERT_HALL  = 4,
    MODE_CINEMA        = 5,
    MODE_WIDE_STUDIO   = 6,
    MODE_RANDOM_AMBIENT= 7
};

/**
 * Audiophile DSP Spatial Engine Instance
 */
class HRTFSpatialEngine {
public:
    float sampleRate = 48000.0f;

    // Movement parameters
    TrajectoryMode mode = MODE_ORBIT_360;
    float intensity = 0.85f;    // Spatial field spread (0.0 to 1.0)
    float speedHz = 0.12f;      // Rotation cycle frequency
    float userDistance = 1.4f;  // Virtual listener distance (meters)
    float stereoWidth = 1.2f;   // Stereo widener multiplier
    float elevationAngle = 0.0f;// Base elevation in radians
    bool powerEnabled = true;

    // Delay lines for Woodworth ITD model
    FractionalDelayLine delayL;
    FractionalDelayLine delayR;

    // Head shadow & Pinna spectral biquads
    Biquad headShadowL;
    Biquad headShadowR;
    Biquad pinnaNotchL;
    Biquad pinnaNotchR;
    Biquad pinnaPeakingL;
    Biquad pinnaPeakingR;
    Biquad airAbsorptionL;
    Biquad airAbsorptionR;

    // Time counter for trajectories
    double currentTimeSec = 0.0;

    // Dynamic Compressor state
    float compThresholdDb = -12.0f;
    float compRatio = 2.5f;
    float compAttackMs = 12.0f;
    float compReleaseMs = 120.0f;
    float compMakeupGain = 1.2f;
    float compEnvelope = 0.0f;

    // Hard ceiling limiter state
    static constexpr float HARD_LIMITER_CEILING = 0.89125f; // -1.0 dBFS

    HRTFSpatialEngine(float fs) : sampleRate(fs > 8000.0f ? fs : 48000.0f) {
        reset();
    }

    void reset() {
        delayL.reset();
        delayR.reset();
        headShadowL.reset();
        headShadowR.reset();
        pinnaNotchL.reset();
        pinnaNotchR.reset();
        pinnaPeakingL.reset();
        pinnaPeakingR.reset();
        airAbsorptionL.reset();
        airAbsorptionR.reset();
        currentTimeSec = 0.0;
        compEnvelope = 0.0f;
    }

    /**
     * Updates Cartesian 3D coordinates based on active trajectory mode
     */
    void calculateTrajectory(double t, float& x, float& y, float& z) {
        float r = userDistance * (0.6f + 0.4f * intensity);
        float omega = TWO_PI * speedHz;

        switch (mode) {
            case MODE_STATIC_CENTER:
                x = 0.0f;
                y = r;
                z = r * 0.1f;
                break;

            case MODE_ORBIT_360:
                // Smooth 360-degree circular orbit with subtle altitude breathing
                x = r * std::sin((float)(omega * t));
                y = r * std::cos((float)(omega * t));
                z = r * 0.25f * std::sin((float)(omega * 0.5 * t));
                break;

            case MODE_FIGURE_8:
                // Lemniscate of Bernoulli path around the ears
                x = r * std::sin((float)(omega * t));
                y = r * std::sin((float)(2.0 * omega * t)) * 0.85f;
                z = r * 0.18f * std::cos((float)(omega * t));
                break;

            case MODE_FRONT_STAGE:
                // Sweeping stereo arc in front of the listener (-60 deg to +60 deg)
                {
                    float angle = (PI / 3.0f) * std::sin((float)(omega * t));
                    x = r * std::sin(angle);
                    y = r * std::cos(angle);
                    z = r * 0.05f;
                }
                break;

            case MODE_CONCERT_HALL:
                // Deep curved semi-circle with elevated acoustics
                {
                    float angle = (PI * 0.45f) * std::sin((float)(omega * 0.7 * t));
                    x = r * 1.3f * std::sin(angle);
                    y = r * (1.1f + 0.3f * std::cos(angle));
                    z = r * (0.35f + 0.15f * std::sin((float)(omega * 0.35 * t)));
                }
                break;

            case MODE_CINEMA:
                // Wide theatrical frontal arc with gentle rear surround presence
                {
                    float angle = (PI * 0.75f) * std::sin((float)(omega * 0.5 * t));
                    x = r * 1.4f * std::sin(angle);
                    y = r * (0.9f + 0.4f * std::cos(angle));
                    z = r * 0.15f;
                }
                break;

            case MODE_WIDE_STUDIO:
                // Expanding and contracting lateral studio stage
                {
                    float lateral = 1.0f + 0.4f * std::sin((float)(omega * t));
                    x = r * 1.2f * std::sin((float)(omega * 0.3 * t)) * lateral;
                    y = r * 0.9f;
                    z = 0.0f;
                }
                break;

            case MODE_RANDOM_AMBIENT:
                // Multi-frequency smooth harmonic wandering
                x = r * (0.7f * std::sin((float)(omega * 0.8 * t)) + 0.3f * std::sin((float)(omega * 1.9 * t)));
                y = r * (0.7f * std::cos((float)(omega * 0.6 * t)) + 0.3f * std::cos((float)(omega * 1.3 * t)));
                z = r * 0.3f * std::sin((float)(omega * 0.4 * t));
                break;

            default:
                x = 0.0f;
                y = r;
                z = 0.0f;
                break;
        }
    }

    /**
     * Main audio processing loop for 1 block (e.g. 128 samples)
     */
    void process(const float* inL, const float* inR, float* outL, float* outR, int numSamples) {
        if (!powerEnabled) {
            // Passthrough bypass
            std::memcpy(outL, inL, numSamples * sizeof(float));
            std::memcpy(outR, inR, numSamples * sizeof(float));
            return;
        }

        // Calculate 3D position for the start of the block
        float x, y, z;
        calculateTrajectory(currentTimeSec, x, y, z);
        currentTimeSec += (double)numSamples / (double)sampleRate;

        // Spherical coordinates
        float distance = std::sqrt(x * x + y * y + z * z);
        if (distance < 0.2f) distance = 0.2f;

        // Azimuth (-PI to +PI, 0 is front, +PI/2 is right, -PI/2 is left)
        float azimuth = std::atan2(x, y);

        // Elevation (-PI/2 to +PI/2)
        float elevation = std::asin(std::clamp(z / distance, -0.99f, 0.99f));

        // 1. Woodworth-Schlosser ITD calculation
        // Delay on contralateral ear
        float absAzimuth = std::abs(azimuth);
        float maxDelaySeconds = (HEAD_RADIUS / SPEED_OF_SOUND) * (std::sin(absAzimuth) + absAzimuth);
        float itdSamples = maxDelaySeconds * sampleRate * intensity;

        float delaySamplesL = 0.0f;
        float delaySamplesR = 0.0f;

        if (azimuth > 0.0f) {
            // Sound is on the right -> Left ear is delayed
            delaySamplesL = itdSamples;
            delaySamplesR = 0.0f;
        } else {
            // Sound is on the left -> Right ear is delayed
            delaySamplesL = 0.0f;
            delaySamplesR = itdSamples;
        }

        // 2. ILD & Head Shadow filter coefficients
        // High frequencies attenuated on contralateral side, boosted slightly on ipsilateral
        float cosAz = std::cos(azimuth);
        float ildGainLeftDb  = -6.0f * (1.0f - std::cos(azimuth - PI * 0.5f)) * 0.5f * intensity;
        float ildGainRightDb = -6.0f * (1.0f - std::cos(azimuth + PI * 0.5f)) * 0.5f * intensity;

        headShadowL.setHighShelf(2400.0f, ildGainLeftDb, sampleRate);
        headShadowR.setHighShelf(2400.0f, ildGainRightDb, sampleRate);

        // 3. Pinna elevation notch & front/back cue
        // Notch moves from 5.8kHz (down/rear) to 9.2kHz (up/front)
        float notchFcL = 6800.0f + 2400.0f * std::sin(elevation) + 600.0f * std::sin(azimuth);
        float notchFcR = 6800.0f + 2400.0f * std::sin(elevation) - 600.0f * std::sin(azimuth);
        notchFcL = std::clamp(notchFcL, 4000.0f, 12000.0f);
        notchFcR = std::clamp(notchFcR, 4000.0f, 12000.0f);

        pinnaNotchL.setNotch(notchFcL, 2.8f, sampleRate);
        pinnaNotchR.setNotch(notchFcR, 2.8f, sampleRate);

        // Front-Back presence boost/cut (rear has reduced 4kHz presence)
        float rearDampL = (cosAz < 0.0f) ? (cosAz * 3.5f * intensity) : 0.8f;
        float rearDampR = (cosAz < 0.0f) ? (cosAz * 3.5f * intensity) : 0.8f;
        pinnaPeakingL.setPeaking(4200.0f, rearDampL, 1.4f, sampleRate);
        pinnaPeakingR.setPeaking(4200.0f, rearDampR, 1.4f, sampleRate);

        // 4. Distance Attenuation & Air Absorption
        float distAtten = 1.0f / (0.8f + 0.2f * distance);
        if (distAtten > 1.25f) distAtten = 1.25f;

        float airCutoff = 22000.0f / std::sqrt(distance);
        airCutoff = std::clamp(airCutoff, 3000.0f, 20000.0f);
        airAbsorptionL.setLowpass(airCutoff, 0.707f, sampleRate);
        airAbsorptionR.setLowpass(airCutoff, 0.707f, sampleRate);

        // Time constants for mastering compressor
        float attCoeff = std::exp(-1.0f / (compAttackMs * 0.001f * sampleRate));
        float relCoeff = std::exp(-1.0f / (compReleaseMs * 0.001f * sampleRate));
        float thresholdLin = std::pow(10.0f, compThresholdDb / 20.0f);

        for (int i = 0; i < numSamples; ++i) {
            float sL = inL[i];
            float sR = inR[i];

            // Stereo Widener matrix (Mid/Side processing)
            float mid  = (sL + sR) * 0.5f;
            float side = (sR - sL) * 0.5f * stereoWidth;
            float procL = mid - side;
            float procR = mid + side;

            // Feed fractional delay lines
            delayL.write(procL);
            delayR.write(procR);

            // Read with Woodworth ITD delay
            float delayedL = delayL.readDelay(delaySamplesL);
            float delayedR = delayR.readDelay(delaySamplesR);

            // Apply Head Shadow ILD
            float hsL = headShadowL.process(delayedL);
            float hsR = headShadowR.process(delayedR);

            // Apply Pinna Notch & Elevation cues
            float pinnaL = pinnaPeakingL.process(pinnaNotchL.process(hsL));
            float pinnaR = pinnaPeakingR.process(pinnaNotchR.process(hsR));

            // Apply Distance Attenuation & Air Absorption
            float wetL = airAbsorptionL.process(pinnaL) * distAtten;
            float wetR = airAbsorptionR.process(pinnaR) * distAtten;

            // Blend with original direct sound based on intensity
            float spatL = (1.0f - intensity * 0.7f) * procL + (intensity * 0.7f) * wetL;
            float spatR = (1.0f - intensity * 0.7f) * procR + (intensity * 0.7f) * wetR;

            // --- Mastering Compressor Stage ---
            float peak = std::max(std::abs(spatL), std::abs(spatR));
            if (peak > compEnvelope) {
                compEnvelope = attCoeff * compEnvelope + (1.0f - attCoeff) * peak;
            } else {
                compEnvelope = relCoeff * compEnvelope + (1.0f - relCoeff) * peak;
            }

            float compGain = 1.0f;
            if (compEnvelope > thresholdLin) {
                float envDb = 20.0f * std::log10(compEnvelope + 1e-6f);
                float overDb = envDb - compThresholdDb;
                float gainReductionDb = overDb * (1.0f - 1.0f / compRatio);
                compGain = std::pow(10.0f, -gainReductionDb / 20.0f);
            }

            float finalL = spatL * compGain * compMakeupGain;
            float finalR = spatR * compGain * compMakeupGain;

            // --- Hard-Ceiling Limiter (-1.0 dBFS) ---
            // Transparent soft-knee tanh saturation above -1.2 dBFS to prevent digital clipping
            constexpr float LIMIT_THRESH = 0.80f;
            if (std::abs(finalL) > LIMIT_THRESH) {
                float sign = (finalL > 0.0f) ? 1.0f : -1.0f;
                float excess = (std::abs(finalL) - LIMIT_THRESH);
                finalL = sign * (LIMIT_THRESH + (HARD_LIMITER_CEILING - LIMIT_THRESH) * std::tanh(excess / (HARD_LIMITER_CEILING - LIMIT_THRESH)));
            }
            if (std::abs(finalR) > LIMIT_THRESH) {
                float sign = (finalR > 0.0f) ? 1.0f : -1.0f;
                float excess = (std::abs(finalR) - LIMIT_THRESH);
                finalR = sign * (LIMIT_THRESH + (HARD_LIMITER_CEILING - LIMIT_THRESH) * std::tanh(excess / (HARD_LIMITER_CEILING - LIMIT_THRESH)));
            }

            // Hard clamp ceiling at -1.0 dBFS (0.89125)
            outL[i] = std::clamp(finalL, -HARD_LIMITER_CEILING, HARD_LIMITER_CEILING);
            outR[i] = std::clamp(finalR, -HARD_LIMITER_CEILING, HARD_LIMITER_CEILING);
        }
    }
};

// C ABI Export Wrappers for WebAssembly
extern "C" {

KEEPALIVE
HRTFSpatialEngine* create_engine(float sampleRate) {
    return new HRTFSpatialEngine(sampleRate);
}

KEEPALIVE
void destroy_engine(HRTFSpatialEngine* engine) {
    if (engine) delete engine;
}

KEEPALIVE
void reset_engine(HRTFSpatialEngine* engine) {
    if (engine) engine->reset();
}

KEEPALIVE
void set_parameters(
    HRTFSpatialEngine* engine,
    int mode,
    float intensity,
    float speedHz,
    float distance,
    float stereoWidth,
    int enabled
) {
    if (!engine) return;
    engine->mode = static_cast<TrajectoryMode>(mode);
    engine->intensity = std::clamp(intensity, 0.0f, 1.0f);
    engine->speedHz = std::clamp(speedHz, 0.01f, 3.0f);
    engine->userDistance = std::clamp(distance, 0.3f, 5.0f);
    engine->stereoWidth = std::clamp(stereoWidth, 0.0f, 2.5f);
    engine->powerEnabled = (enabled != 0);
}

KEEPALIVE
void set_compressor(
    HRTFSpatialEngine* engine,
    float thresholdDb,
    float ratio,
    float attackMs,
    float releaseMs,
    float makeupGain
) {
    if (!engine) return;
    engine->compThresholdDb = thresholdDb;
    engine->compRatio = ratio;
    engine->compAttackMs = attackMs;
    engine->compReleaseMs = releaseMs;
    engine->compMakeupGain = makeupGain;
}

KEEPALIVE
void process_audio(
    HRTFSpatialEngine* engine,
    const float* inL,
    const float* inR,
    float* outL,
    float* outR,
    int numSamples
) {
    if (engine) {
        engine->process(inL, inR, outL, outR, numSamples);
    }
}

} // extern "C"
