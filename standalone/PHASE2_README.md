Phase2 Milestone D - Grouping & Counters

This commit adds grouping/preset support and several counter/shifter gates to the phase2/wiring-memory branch.

New features implemented in this milestone:
- Marquee selection (Ctrl + drag) to select multiple nodes.
- Save Group as Preset: select nodes then click "Save Group as Preset" in the palette to store the selection as a reusable preset.
  - Presets are stored in localStorage under key 'logic_presets' and appear under the Presets section in the palette.
  - Click a preset to instantiate its contents on the canvas.
- New gates: COUNTER4 (4-bit up/down counter), SHIFTER4 (4-bit shift register), SHIFTER8 (8-bit shift register).
- Templates: Counters Demo (shows 4-bit counter and 4-bit shifter example).

How to test:
- Checkout branch phase2/wiring-memory and open standalone/index.html
- Use Ctrl + left-drag to marquee-select multiple nodes. Click "Save Group as Preset" to save.
- Presets will show in the left palette; click to place them.
- Add a COUNTER4 or SHIFTER4 from the palette and use the inspector to toggle inputs or wire buttons to them; Run/Step to simulate.

Next suggestions:
- Add a UI for multi-bit bus wiring and visual bundles in the canvas (makes connecting data buses easier).
- Add more presets/examples using the new grouping feature.
