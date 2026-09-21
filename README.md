# SpatialWave 3D — Audiophile Binaural & 8D Spatial Audio Engine

> **Production-Ready 3D Spatial Audio Engine for Desktop (Brave & Chrome MV3) and Mobile (iOS & Android Brave)**  
> Transforms audio from any website (YouTube, Spotify Web, Netflix, Twitch, SoundCloud, Vimeo, etc.) or local music files into an immersive 3D binaural and 8D spatial audio experience for headphones.

---

## Key Highlights & Architectural Advantages

- **DRM & CORS Bypass via `chrome.tabCapture` (Desktop)**:  
  Standard Web Audio extensions break on protected DRM streams (Netflix Widevine, Spotify Web, copyrighted YouTube streams). **SpatialWave 3D** captures the raw tab audio stream at the browser subsystem level using `chrome.tabCapture`, ensuring 100% compatibility across all streaming platforms.

- **Persistent Execution via `chrome.offscreen`**:  
  Prevents Manifest V3 service worker suspension during multi-hour listening sessions by routing captured audio to a dedicated offscreen audio host.

- **C++ WebAssembly (WASM) & AudioWorklet DSP Engine (<15ms Latency)**:  
  All 3D spatialization, Woodworth spherical head model ITD, head-shadow ILD biquads, pinna elevation filters, trajectory calculations, mastering bus compression, and peak limiting are executed inside an `AudioWorkletProcessor` on the dedicated audio rendering thread.

- **Minimum-Phase Parametric EQ (PEQ) & AutoEQ Importer**:  
  Includes pre-calibrated audiophile profiles for the **KZ EDX Pro**, **Sennheiser HD 600/650**, **Sony WH-1000XM4/XM5**, and the **Harman 2019 Target**. Features a built-in parser for standard AutoEQ `.txt` profiles so you can flatten any of the 4,000+ headphones measured in the AutoEq database.

- **Zero Digital Clipping (-1.0 dBFS Hard-Ceiling Limiter)**:  
  Mastering chain features a soft-knee bus compressor paired with a hard-ceiling peak limiter capped strictly at -1.0 dBFS ($10^{-1/20} \approx 0.891$) with smooth hyperbolic tangent saturation.

- **System-Native Sample Rate Indicator**:  
  Real-time sample rate badge displays the exact hardware sample rate (e.g. `48,000 Hz • WASAPI / PipeWire Bit-Perfect`) to verify that the browser is matching your OS audio subsystem without low-quality software resampling.

- **Cross-Platform Mobile Support (iOS & Android Brave Browser)**:  
  Includes a Mobile In-Page Injector (Bookmarklet) to spatialize YouTube/SoundCloud in Brave on mobile, plus a standalone touch-optimized Progressive Web App (PWA).

---

## Project Structure

```
spatial-audio-extension/
├── manifest.json                  # Manifest V3 extension configuration
├── background.js                 # Service worker: handles tabCapture & offscreen lifecycle
├── offscreen/
│   ├── offscreen.html            # Persistent audio host HTML document
│   └── offscreen.js              # getUserMedia stream handler, PEQ cascade & telemetry
├── dsp/
│   ├── processor.js              # Low-latency AudioWorkletProcessor (<15ms)
│   ├── hrtf_engine.cpp           # C++ audiophile DSP spatialization engine
│   ├── hrtf_engine.wasm          # Standalone WebAssembly binary
│   ├── Makefile                  # Make build for WebAssembly
│   ├── build.sh                  # Bash build script (Linux/macOS)
│   └── build_wasm.bat            # Windows Emscripten batch build script
├── popup/
│   ├── popup.html                # Modern glassmorphism UI
│   ├── popup.css                 # Dark obsidian theme & glowing neon styling
│   └── popup.js                  # Radar visualizer, spectrum, PEQ plot & controls
├── presets.js                    # Target presets & AutoEQ headphone profiles
├── storage.js                    # Per-domain storage persistence manager
├── mobile/
│   ├── spatialwave-bookmarklet.js# Mobile in-page injector for Brave on iOS & Android
│   ├── bookmarklet_code.txt      # One-click copyable bookmarklet URL
│   ├── spatialwave.user.js       # Userscript format for mobile script managers
│   ├── index.html                # Mobile Progressive Web App (PWA)
│   ├── mobile.css                # Touch-optimized glassmorphism styling
│   ├── mobile.js                 # Mobile audio engine controller
│   └── manifest.webmanifest      # PWA install manifest
├── test/
│   └── test_spatial_audio.html   # Diagnostic test harness and 3D synth demo
├── icons/
│   ├── icon.svg                  # High-resolution vector icon
│   ├── icon16.png                # 16x16 icon
│   ├── icon32.png                # 32x32 icon
│   ├── icon48.png                # 48x48 icon
│   └── icon128.png               # 128x128 icon
├── .gitignore                    # Standard git ignore rules
├── LICENSE                       # MIT License with trademark disclaimer
└── README.md
```

---

## Desktop Installation Guide (Brave & Chrome)

1. Open **Brave** (or Google Chrome / Chromium-based browser).
2. Navigate to `brave://extensions` (or `chrome://extensions`).
3. Toggle on **Developer mode** in the top-right corner.
4. Click **Load unpacked** in the top-left corner.
5. Select this project repository folder.
6. SpatialWave 3D will appear in your extension toolbar. Pin it for quick access!

---

## Mobile Installation Guide (Brave on iOS & Android)

Mobile browsers (such as Brave on iOS and Android) do not support desktop Chrome Web Store extensions. SpatialWave 3D provides **two dedicated mobile solutions**:

### Method 1: Mobile In-Page Injector (Bookmarklet)
*Use this to spatialize audio directly inside YouTube, SoundCloud, or any web player in Brave on iOS & Android.*

1. Open **Brave** on your iPhone, iPad, or Android phone.
2. Bookmark any webpage (name it `SpatialWave 3D`).
3. Edit the bookmark:
   - Copy the one-line code from [`mobile/bookmarklet_code.txt`](mobile/bookmarklet_code.txt) (or copy `javascript:(function(){...})()`).
   - Paste it into the **URL** field of the bookmark and save.
4. Go to **YouTube** or **SoundCloud** in Brave and start playing any song or video.
5. Tap your browser address bar or bookmarks, and tap **SpatialWave 3D**.
6. A floating glowing HUD will appear on the bottom-right of the page with the 3D Radar and acoustic controls!

---

### Method 2: Standalone Mobile PWA (Add to Home Screen)
*Use this for listening to local audio files (MP3, FLAC, WAV) or streams in full 3D spatial audio.*

1. Open the `mobile/index.html` page in **Brave** on your mobile device (or host it on GitHub Pages / local network).
2. Tap the **Share** button in iOS Brave (or the three dots menu on Android Brave).
3. Select **"Add to Home Screen"** (or **"Install App"**).
4. Launch SpatialWave 3D from your home screen like a native app!

---

## Audiophile Presets

| Preset | Target | Acoustic Profile |
|---|---|---|
| **CS2 Gaming** | Competitive FPS | Ultra-low latency, heightened 1.5–4.5 kHz footstep crunch, scooped low-mids (320 Hz) to eliminate mud, zero reverb. |
| **Audiophile** | FLAC / High-Res | Structural HRTF crossfeed only (0.35 intensity) for natural headphone stage width, bit-perfect linear response, zero artificial reverb. |
| **Cinema Surround** | Movies / Netflix | Theatrical wide stage (1.6x), deep sub-bass boost (<45 Hz), controlled dialogue presence at 3.2 kHz, large hall acoustic convolution. |
| **ASMR / Vocal** | Podcasts / ASMR | Extreme close-proximity binaural effect (0.5m), whisper clarity (2.8 kHz & 6.5 kHz air boost), highpass rumble filter at 60 Hz. |
| **8D Orbit** | Immersive Music | Continuous 360-degree orbital rotation with subtle altitude breathing and concert hall acoustic reflection. |
| **Music Master** | All Genres | Balanced studio acoustics, stereo widening, smooth high-end air, and gentle mastering bus glue. |

---

## AutoEQ Headphone Profile Import

To load a measurement profile for your specific headphone model:
1. Visit the [AutoEq Database](https://github.com/jaakkopasanen/AutoEq).
2. Find your headphone model and open the **ParametricEQ.txt** file.
3. In the SpatialWave 3D popup, click **`+ Import AutoEQ`**.
4. Paste the raw text (e.g., `Filter 1: ON PK Fc 32 Hz Gain -2.1 dB Q 1.41...`).
5. Click **Parse & Apply Profile**. The interactive PEQ curve will update immediately, applying minimum-phase biquad compensation before spatial processing.

---

## Keyboard Shortcuts (Desktop)

- **`Alt+Shift+S`**: Toggle 3D Spatial Audio processing on/off.
- **`Alt+Shift+Up`**: Increase 3D Spatial Intensity (+10%).
- **`Alt+Shift+Down`**: Decrease 3D Spatial Intensity (-10%).
- **`Alt+Shift+A`**: Open the extension popup window.
