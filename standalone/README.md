# Logic System v1 - Prototype

This repository contains a starting prototype of the 2D logic editor you requested. I pushed a Phase 1 prototype into the `standalone/` folder on the `main` branch.

What is included (Phase 1 prototype)
- Minimal dark UI (black/grey) with a palette, canvas, and inspector
- Block-like gates: AND, OR, NOT, NAND, NOR, XOR, XNOR, Splitter, Button, LED, Text Panel, Keyboard
- Wiring system: draw wires between outputs and inputs (simple model implemented)
- Save / Load (download/upload JSON)
- Templates modal with a few skeleton templates (basic adder, 8-bit/16-bit skeletons, OS demo)
- Run / Pause and Step debugger (advances one tick)
- Minimap placeholder
- Grouping placeholder (UI only)

How to run
1. Open `standalone/index.html` in a modern browser.
2. Use the palette to add gates. Drag gates by clicking and moving.
3. Double-click BUTTON gates to toggle them. Select a KEYBOARD gate and type to send characters to connected TEXT panels.
4. Save your designs using Save, and load them back with Load.

Next steps (after you confirm)
- Expand wiring UI to allow click-to-connect wires and deletion
- Implement many advanced gates (CPUs, EEPROMs, counters, SR/D-latches, WiFi gate, fans, etc.)
- Create 20+ full templates and an advanced terminal OS with many commands
- Fix UX issues and polish visuals to match Upload Labs more closely

I pushed these files to the `main` branch as requested. If you'd like, I can now:
- Continue implementing more gates and templates (I will work phase-by-phase), or
- Open a development branch instead of main for iterative work (recommended), or
- Add a GitHub Pages demo

Tell me which to do next and confirm whether to continue adding the Phase 2 features directly on `main` or on a feature branch.
