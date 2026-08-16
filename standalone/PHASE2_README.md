Phase2 Milestone B - Memory gates

This file documents the Milestone B changes pushed to branch phase2/wiring-memory.

What's included:
- SR latch (SR)
- Gated SR latch (GATED_SR) - responds when CLK/enable is asserted
- D latch (DLATCH)
- Logic Memory gate (MEMORY) with pins DATA, ENABLE, RESET; has a storage indicator and can optionally require "power" via meta flags
- Inspector UI now displays interactive test-input toggles and allows toggling stored state for stateful gates
- Templates updated with SR and D-latch demos

How to test:
- Checkout phase2/wiring-memory and open standalone/index.html
- Use Templates -> SR Demo or D-Latch Demo or create gates and wire them
- Use the inspector to toggle test inputs when no wire is connected
- Use Run/Step to simulate; stateful gates persist state in their .meta.storage property

Next: EEPROM (8-bit -> 16-bit) and grouping/presets
