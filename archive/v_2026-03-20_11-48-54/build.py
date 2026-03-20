#!/usr/bin/env python3
"""
Elemental Clash — build.py
Concatenates source modules into a single index.html.

Usage:
    python build.py

Output: index.html + index-vVERSION.html  (versioned copy for Drive archive)
"""

import os
import re

# ── Version — read from template so it's always in sync ─────────────
TEMPLATE = 'index-template.html'
with open(TEMPLATE, 'r', encoding='utf-8') as _f:
    _tmpl = _f.read()
_vm = re.search(r'>v([\d.]+)<', _tmpl)
VERSION = _vm.group(1) if _vm else 'dev'

# ── Source files — ORDER MATTERS (defines before uses) ──────────────
JS_FILES = [
    'src/heroes.js',       # stat system, hero data, passives, combat class
    'src/input.js',        # keybindings, gamepad
    'src/state.js',        # game state, weather system
    'src/audio.js',        # audio/SFX (BGM commented out)
    'src/ui.js',           # screen nav, options, hero grid, lobby
    'src/arena.js',        # obstacles, shrinking arena, warp gates
    'src/game-loop.js',    # initGame, main loop
    'src/ai.js',           # AI system
    'src/abilities.js',    # all abilities, sprint, special
    'src/rendering.js',    # render, sprites, drawChar, drawHUD, game over
    'src/controls.js',     # joystick, fullscreen, UI navigation
]

OUTPUT      = 'index.html'
OUTPUT_VER  = f'index-v{VERSION}.html'
INJECT_TAG  = '---INJECT_SCRIPTS_HERE---'

# ── Read template ────────────────────────────────────────────────────
# (already read above for version detection)

if INJECT_TAG not in _tmpl:
    raise RuntimeError(f"Injection marker '{INJECT_TAG}' not found in {TEMPLATE}")

# ── Concatenate JS modules ───────────────────────────────────────────
js_parts = []
total_lines = 0
for path in JS_FILES:
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    lines = content.count('\n')
    total_lines += lines
    js_parts.append(f'\n// ━━━━━ {path} ━━━━━\n{content}')
    print(f'  ✓  {path:<28} {lines:>5} lines')

js_block = '<script>' + ''.join(js_parts) + '\n</script>'

# ── Inject and write ─────────────────────────────────────────────────
output = _tmpl.replace(INJECT_TAG, js_block)

with open(OUTPUT, 'w', encoding='utf-8') as f:
    f.write(output)

with open(OUTPUT_VER, 'w', encoding='utf-8') as f:
    f.write(output)

out_lines = output.count('\n')
print(f'\n✅  Built {OUTPUT} + {OUTPUT_VER}  ({out_lines:,} lines total, {len(output):,} bytes)')
print(f'📦  Zip as: elemental-clash-v{VERSION}.zip')
