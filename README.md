# MultiTTS Narrator for SillyTavern

Independent narration extension for SillyTavern + Android MultiTTS. It does **not** use SillyTavern's native TTS provider, Voice Map, TTS queue, or TTS playback controls.

## Install

1. In SillyTavern, install a third-party extension from this repository URL.
2. Open **Extensions → MultiTTS Narrator**.
3. Enable Narrator.
4. Keep the default endpoint `http://127.0.0.1:8774` unless your MultiTTS service uses another address.
5. Run **Health test**. You should hear a short test sentence.
6. Use **Narrate current**, then enable automatic narration when ready.

## What v2 alpha does

- narrates completed assistant replies from SillyTavern canonical chat state;
- deterministic paragraph/punctuation-aware segmentation;
- bounded concurrent preload with strict in-order playback;
- real pause/resume, stop, retry and skip;
- one-latest-message auto queue while current narration is active;
- cancels stale audio after edits/swipes/deletes/chat changes;
- Media Session controls when supported;
- privacy-safe recovery checkpoint and diagnostics;
- direct `<audio>` loading from MultiTTS `/forward`, with `voice` omitted.

The initial defaults (70 characters, 3 look-ahead / 3 simultaneous loads) are calibration defaults, not claimed device limits. Advanced settings allow testing up to 5 simultaneous loads.

## Important limits

Android/Chrome may freeze or discard a background page. This extension improves narration continuity but cannot provide Android foreground-service guarantees or keep LLM generation alive after the browser connection is killed.

No full chat text is stored by Narrator. A non-loopback custom endpoint is explicitly warned because narration text will leave the local device/browser for that host.

Developer notes: [Design](./docs/DESIGN.md) · [Testing](./docs/TESTING.md)
