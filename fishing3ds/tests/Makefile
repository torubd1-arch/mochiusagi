# ゲームロジックの自動テスト（PC 上の gcc でビルド・実行）
CC      ?= gcc
CFLAGS  := -std=c99 -O2 -Wall -Wextra -I../source
TARGET  := test_game

all: run

$(TARGET): test_game.c ../source/game.c ../source/game.h
	$(CC) $(CFLAGS) -o $@ test_game.c ../source/game.c -lm

run: $(TARGET)
	./$(TARGET)

clean:
	rm -f $(TARGET)

.PHONY: all run clean
