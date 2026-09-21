@echo off
echo ============================================================
echo  SpatialWave 3D - Compiling C++ HRTF DSP Engine to WASM
echo ============================================================

where emcc >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Emscripten (emcc) was not found in your PATH.
    echo Please install or activate Emscripten SDK:
    echo   git clone https://github.com/emscripten-core/emsdk.git
    echo   cd emsdk ^&^& emsdk install latest ^&^& emsdk activate latest
    echo   emsdk_env.bat
    pause
    exit /b 1
)

echo Found emcc. Compiling hrtf_engine.cpp to hrtf_engine.wasm...
emcc -O3 -std=c++17 ^
  -s WASM=1 ^
  -s STANDALONE_WASM=1 ^
  -s EXPORTED_FUNCTIONS="['_create_engine','_destroy_engine','_reset_engine','_set_parameters','_set_compressor','_process_audio','_malloc','_free']" ^
  -s ALLOW_MEMORY_GROWTH=1 ^
  --no-entry ^
  -o hrtf_engine.wasm ^
  hrtf_engine.cpp

if %ERRORLEVEL% equ 0 (
    echo [SUCCESS] hrtf_engine.wasm compiled successfully!
) else (
    echo [FAILED] Compilation failed.
)
pause
