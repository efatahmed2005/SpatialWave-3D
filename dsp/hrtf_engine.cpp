/**
 * SpatialWave 3D - Audiophile C++ DSP Spatialization Engine
 * Professional 8D / 9D / 16D Head-Traveling Binaural DSP Engine
 * 
 * Features:
 * - Sub-Bass Mono Anchor (<110 Hz Crossover) for grounded punch without ear fatigue
 * - True Binaural Crossfeed Matrix with Woodworth Spherical ITD Fractional Delay Lines
 * - Alternating In-Head Tunneling & Rear Occlusion 3D Orbit Trajectory
 * - Rear Pinna Concha Notch (-9 dB at 7.2 kHz) for authentic behind-the-head perception
 * - Dynamic Cross-Ear Haas Room Reflections (18ms early slapback bounce)
 * - Master Bus Compressor and -1.0 dBFS Hard-Ceiling Peak Limiter
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
static constexpr int DELAY_BUFFER_SIZE = 8192;   // Ring buffer size for ITD + Haas slapback

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

    void setHighpass(float fc, float q, float fs) {
        float w0 = TWO_PI * fc / fs;
        float alpha = std::sin(w0) / (2.0f * q);
        float cosw0 = std::cos(w0);

        float a0 = 1.0f + alpha;
        b0 = ((1.0f + cosw0) * 0.5f) / a0;
        b1 = (-(1.0f + cosw0)) / a0;
        b2 = ((1.0f + cosw0) * 0.5f) / a0;
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
    float intensity = 0.90f;    // Spatial field spread (0.0 to 1.0)
    float speedHz = 0.12f;      // Rotation cycle frequency
    float userDistance = 1.4f;  // Virtual listener distance (meters)
    float stereoWidth = 1.35f;  // Stereo widener multiplier
    bool powerEnabled = true;

    // Sub-Bass 110Hz Crossover
    Biquad bassLpL;
    Biquad bassLpR;
    Biquad spatHpL;
    Biquad spatHpR;

    // Delay lines for Woodworth ITD model
    FractionalDelayLine delayL;
    FractionalDelayLine delayR;

    // Cross-Ear Haas Slapback (~18ms)
    FractionalDelayLine haasDelayL;
    FractionalDelayLine haasDelayR;
    float haasSamples = 864.0f; // 18ms at 48kHz
    Biquad haasDampL;
    Biquad haasDampR;

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
    float compMakeupGain = 1.15f;
    float compEnvelope = 0.0f;

    // Hard ceiling limiter state (-1.0 dBFS)
    static constexpr float HARD_LIMITER_CEILING = 0.89125f;

    HRTFSpatialEngine(float fs) : sampleRate(fs > 8000.0f ? fs : 48000.0f) {
        haasSamples = 0.018f * sampleRate;
        bassLpL.setLowpass(110.0f, 0.707f, sampleRate);
        bassLpR.setLowpass(110.0f, 0.707f, sampleRate);
        spatHpL.setHighpass(110.0f, 0.707f, sampleRate);
        spatHpR.setHighpass(110.0f, 0.707f, sampleRate);
        haasDampL.setLowpass(3600.0f, 0.707f, sampleRate);
        haasDampR.setLowpass(3600.0f, 0.707f, sampleRate);
        reset();
    }

    void reset() {
        delayL.reset();
        delayR.reset();
        haasDelayL.reset();
        haasDelayR.reset();
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
     * Professional 8D Head-Penetrating Trajectory Calculation
     */
    void calculateTrajectory(double t, float& x, float& y, float& z) {
        float baseR = userDistance * (0.6f + 0.4f * intensity);
        float omega = TWO_PI * speedHz;
        float phase = (float)(omega * t);

        switch (mode) {
            case MODE_STATIC_CENTER:
                x = 0.0f;
                y = baseR;
                z = baseR * 0.1f;
                break;

            case MODE_ORBIT_360:
                {
                    // Alternating cycle: sweeps through the head center and around the back
                    float sinPhase = std::sin(phase);
                    float cosPhase = std::cos(phase);
                    float halfPhase = phase * 0.5f;

                    // Variable penetration depth (contracts down to 0.38m when crossing X=0)
                    float depthMod = 0.38f + 0.62f * std::pow(std::abs(sinPhase), 1.2f);
                    float r = baseR * depthMod;

                    x = baseR * sinPhase;
                    y = r * cosPhase * (0.65f + 0.35f * std::sin(halfPhase));
                    z = baseR * 0.18f * std::sin(halfPhase);
                }
                break;

            case MODE_FIGURE_8:
                x = baseR * std::sin(phase);
                y = baseR * std::sin(2.0f * phase) * 0.85f;
                z = baseR * 0.18f * std::cos(phase);
                break;

            case MODE_FRONT_STAGE:
                {
                    float angle = (PI / 3.0f) * std::sin(phase);
                    x = baseR * std::sin(angle);
                    y = baseR * std::cos(angle);
                    z = 0.05f * baseR;
                }
                break;

            case MODE_CONCERT_HALL:
                {
                    float angle = (PI * 0.45f) * std::sin(phase * 0.7f);
                    x = baseR * 1.3f * std::sin(angle);
                    y = baseR * (1.1f + 0.3f * std::cos(angle));
                    z = baseR * (0.35f + 0.15f * std::sin(phase * 0.35f));
                }
                break;

            case MODE_CINEMA:
                {
                    float angle = (PI * 0.75f) * std::sin(phase * 0.5f);
                    x = baseR * 1.4f * std::sin(angle);
                    y = baseR * (0.9f + 0.4f * std::cos(angle));
                    z = 0.15f * baseR;
                }
                break;

            case MODE_WIDE_STUDIO:
                {
                    float lateral = 1.0f + 0.4f * std::sin(phase);
                    x = baseR * 1.2f * std::sin(phase * 0.3f) * lateral;
                    y = baseR * 0.9f;
                    z = 0.0f;
                }
                break;

            case MODE_RANDOM_AMBIENT:
                x = baseR * (0.7f * std::sin(phase * 0.8f) + 0.3f * std::sin(phase * 1.9f));
                y = baseR * (0.7f * std::cos(phase * 0.6f) + 0.3f * std::cos(phase * 1.3f));
                z = baseR * 0.3f * std::sin(phase * 0.4f);
                break;

            default:
                x = 0.0f;
                y = baseR;
                z = 0.0f;
                break;
        }
    }

    /**
     * Main audio processing loop for 1 block (e.g. 128 samples)
     */
    void process(const float* inL, const float* inR, float* outL, float* outR, int numSamples) {
        if (!powerEnabled) {
            std::memcpy(outL, inL, numSamples * sizeof(float));
            std::memcpy(outR, inR, numSamples * sizeof(float));
            return;
        }

        // Calculate 3D position
        float x, y, z;
        calculateTrajectory(currentTimeSec, x, y, z);
        currentTimeSec += (double)numSamples / (double)sampleRate;

        float distance = std::sqrt(x * x + y * y + z * z);
        if (distance < 0.18f) distance = 0.18f;

        float azimuth = std::atan2(x, y);
        float elevation = std::asin(std::clamp(z / distance, -0.99f, 0.99f));

        // 1. Woodworth ITD
        float absAz = std::abs(azimuth);
        float maxDelaySec = (HEAD_RADIUS / SPEED_OF_SOUND) * (std::sin(absAz) + absAz);
        float itdSamples = maxDelaySec * sampleRate * intensity;

        float delayL_s = 0.0f;
        float delayR_s = 0.0f;
        if (azimuth > 0.0f) {
            delayL_s = itdSamples;
            delayR_s = 0.0f;
        } else {
            delayL_s = 0.0f;
            delayR_s = itdSamples;
        }

        // 2. Anatomical Head Shadow ILD (-11 dB at 90 deg)
        float cosAz = std::cos(azimuth);
        float sinAz = std::sin(azimuth);
        float ildGainLDb = -11.0f * (1.0f - std::cos(azimuth - PI * 0.5f)) * 0.5f * intensity;
        float ildGainRDb = -11.0f * (1.0f - std::cos(azimuth + PI * 0.5f)) * 0.5f * intensity;
        headShadowL.setHighShelf(2200.0f, ildGainLDb, sampleRate);
        headShadowR.setHighShelf(2200.0f, ildGainRDb, sampleRate);

        // 3. Pinna Concha Notch (-9 dB rear occlusion)
        float notchFcL = 6800.0f + 2200.0f * std::sin(elevation) + 700.0f * sinAz;
        float notchFcR = 6800.0f + 2200.0f * std::sin(elevation) - 700.0f * sinAz;
        notchFcL = std::clamp(notchFcL, 4000.0f, 11000.0f);
        notchFcR = std::clamp(notchFcR, 4000.0f, 11000.0f);
        pinnaNotchL.setNotch(notchFcL, 3.2f, sampleRate);
        pinnaNotchR.setNotch(notchFcR, 3.2f, sampleRate);

        bool isRear = (cosAz < 0.0f);
        float rearDampLDb = isRear ? (cosAz * 5.5f * intensity) : 1.2f;
        float rearDampRDb = isRear ? (cosAz * 5.5f * intensity) : 1.2f;
        pinnaPeakingL.setPeaking(3800.0f, rearDampLDb, 1.4f, sampleRate);
        pinnaPeakingR.setPeaking(3800.0f, rearDampRDb, 1.4f, sampleRate);

        // 4. Distance Attenuation & Air
        float distAtten = std::min(1.35f, 1.0f / (0.75f + 0.25f * distance));
        float airCutoff = std::clamp(22000.0f / std::sqrt(distance), 3500.0f, 22000.0f);
        airAbsorptionL.setLowpass(airCutoff, 0.707f, sampleRate);
        airAbsorptionR.setLowpass(airCutoff, 0.707f, sampleRate);

        float panAngle = (azimuth / PI) * 0.5f + 0.5f;
        float directL = std::cos(panAngle * (PI * 0.5f));
        float directR = std::sin(panAngle * (PI * 0.5f));

        float attCoeff = std::exp(-1.0f / (compAttackMs * 0.001f * sampleRate));
        float relCoeff = std::exp(-1.0f / (compReleaseMs * 0.001f * sampleRate));
        float thresholdLin = std::pow(10.0f, compThresholdDb / 20.0f);

        for (int i = 0; i < numSamples; ++i) {
            float sL = inL[i];
            float sR = inR[i];

            // Sub-Bass Mono Anchor (<110 Hz)
            float bassL = bassLpL.process(sL);
            float bassR = bassLpR.process(sR);
            float subBassMono = (bassL + bassR) * 0.5f;

            // Spatial highpass (>110 Hz)
            float highL = spatHpL.process(sL);
            float highR = spatHpR.process(sR);

            float mid  = (highL + highR) * 0.5f;
            float side = (highR - highL) * 0.5f * stereoWidth;
            float procL = mid - side;
            float procR = mid + side;
            float objEnergy = (procL + procR) * 0.5f;

            // Binaural Crossfeed
            delayL.write(procL * 0.75f + objEnergy * 0.25f);
            delayR.write(procR * 0.75f + objEnergy * 0.25f);
            float delL = delayL.readDelay(delayL_s);
            float delR = delayR.readDelay(delayR_s);

            float hsL = headShadowL.process(delL);
            float hsR = headShadowR.process(delR);

            float pinnaL = pinnaPeakingL.process(pinnaNotchL.process(hsL));
            float pinnaR = pinnaPeakingR.process(pinnaNotchR.process(hsR));

            float spatAirL = airAbsorptionL.process(pinnaL) * distAtten;
            float spatAirR = airAbsorptionR.process(pinnaR) * distAtten;

            // Cross-Ear Haas reflection (~18ms)
            haasDelayL.write(procL);
            haasDelayR.write(procR);
            float haasRefL = haasDampL.process(haasDelayL.readDelay(haasSamples));
            float haasRefR = haasDampR.process(haasDelayR.readDelay(haasSamples));

            float crossBounceL = haasRefR * (directR * 0.22f * intensity);
            float crossBounceR = haasRefL * (directL * 0.22f * intensity);

            float spatL = (spatAirL * directL * 1.25f) + crossBounceL;
            float spatR = (spatAirR * directR * 1.25f) + crossBounceR;

            float mixL = spatL + subBassMono;
            float mixR = spatR + subBassMono;

            // Bus Compressor
            float peak = std::max(std::abs(mixL), std::abs(mixR));
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

            float finalL = mixL * compGain * compMakeupGain;
            float finalR = mixR * compGain * compMakeupGain;

            // Hard-Ceiling Limiter (-1.0 dBFS)
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
