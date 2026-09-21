#!/usr/bin/env bash
set -e

echo "Compiling C++ HRTF DSP Engine to WebAssembly..."
emcc -O3 -std=c++17 \
  -s WASM=1 \
  -s STANDALONE_WASM=1 \
  -s EXPORTED_FUNCTIONS="['_create_engine','_destroy_engine','_reset_engine','_set_parameters','_set_compressor','_process_audio','_malloc','_free']" \
  -s ALLOW_MEMORY_GROWTH=1 \
  --no-entry \
  -o hrtf_engine.wasm \
  hrtf_engine.cpp

echo "Build complete: hrtf_engine.wasm"
