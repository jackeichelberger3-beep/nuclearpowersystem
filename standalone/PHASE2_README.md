Phase2 Milestone C - EEPROM (started)

This branch (phase2/wiring-memory) now includes an implementation of EEPROM gates (8-bit and 16-bit) and UI inspector controls to manually read/write and persist a shared backing store via localStorage.

What's new:
- New gate types: EEPROM8, EEPROM16
- EEPROM behavior: read/write by address, RESET, SET, SAVE (persist to localStorage if shared name provided)
- Inspector UI provides controls for manual read/write and persisting to localStorage
- Template: eeprom-demo (demo of writing a value and reading it back to an LED)

Notes & next steps:
- EEPROM storage size is 256 entries (address width = 8 bits). For larger address widths we can parameterize later.
- Shared backing: use localStorage key 'eeprom_<sharedName>' when sharedName is set. Last-writer-wins policy is used.
- Next: Grouping/presets and expanding EEPROM param options (address width, file import/export of contents), plus template library expansion.
