# BGM を WAV に書き出す（PC 上の gcc でビルド・実行）
CC     ?= gcc
CFLAGS := -std=c99 -O2 -Wall -Wextra -I../../source

all: run

render_music: render_music.c ../../source/music.c ../../source/music.h
	$(CC) $(CFLAGS) -o $@ render_music.c ../../source/music.c -lm

run: render_music
	mkdir -p out
	./render_music

clean:
	rm -rf render_music out

.PHONY: all run clean
