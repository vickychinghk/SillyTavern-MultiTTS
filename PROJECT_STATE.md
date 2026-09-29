# Project State

**Line:** 2.0.0-alpha.1  
**Status:** Installable alpha implementation

The v2 narrator is implemented as an independent SillyTavern extension. It uses SillyTavern public context/events for message state and owns its own segmentation, preload, ordered playback, controls, recovery and diagnostics.

Automated tests and syntax checks are required by CI. The next product step is real-device calibration on Android Chrome + the target MultiTTS setup. See `docs/TESTING.md`.
