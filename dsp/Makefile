CC = emcc
CFLAGS = -O3 -std=c++17
EXPORTED_FUNCS = "['_create_engine','_destroy_engine','_reset_engine','_set_parameters','_set_compressor','_process_audio','_malloc','_free']"

all: hrtf_engine.wasm

hrtf_engine.wasm: hrtf_engine.cpp
	$(CC) $(CFLAGS) \
		-s WASM=1 \
		-s STANDALONE_WASM=1 \
		-s EXPORTED_FUNCTIONS=$(EXPORTED_FUNCS) \
		-s ALLOW_MEMORY_GROWTH=1 \
		--no-entry \
		-o $@ $<

clean:
	rm -f hrtf_engine.wasm

.PHONY: all clean
