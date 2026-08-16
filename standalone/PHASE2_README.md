# Phase 2 branch: phase2/wiring-memory

This branch implements Milestone A (Phase 2):
- Click-to-connect wiring (output -> input)
- Temporary wire preview while connecting
- Wire selection and deletion (Delete key)
- Port hit-testing
- Panning (middle mouse or Shift+drag) and zoom (mouse wheel)

Files changed:
- standalone/app.js (major update)

Next steps (after you review and test Milestone A):
- Implement Memory gates (SR latch, gated SR, D latch, Logic Memory)
- EEPROM (8-bit/16-bit)
- Grouping/presets

How to test:
1. Checkout branch `phase2/wiring-memory`
2. Open `standalone/index.html` in a browser
3. Add gates from the palette, click an output port (right side) to start a wire, then click an input port (left side) to connect.
4. Select a wire by clicking near it; press Delete to remove it.
5. Pan with middle mouse button or Shift+drag. Zoom with mouse wheel.

Once you confirm this behavior, I'll proceed to Milestone B.
