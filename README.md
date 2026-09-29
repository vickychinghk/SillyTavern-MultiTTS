# MultiTTS Narrator for SillyTavern

> Repository reboot — design baseline only. No production code is present on `main`.

This repository is being rebuilt as an **independent narration engine for SillyTavern**, using the Android **MultiTTS** local forwarding service.

The repository name is historical. The new product **does not use SillyTavern's native TTS provider, TTS queue, audio queue, Voice Map, or TTS playback controls**.

## Product direction

The new architecture is intentionally narrow:

```text
SillyTavern
  └─ canonical chat state + public events
       ↓
MultiTTS Narrator extension
  ├─ message selection
  ├─ text normalization
  ├─ segmentation
  ├─ synthesis scheduling / preload window
  ├─ ordered playback
  ├─ pause / resume / stop / skip
  ├─ recovery checkpoints
  └─ diagnostics
       ↓
Android Chrome media loader
       ↓
http://127.0.0.1:8774/forward
       ↓
MultiTTS
       ↓
voice/upstream selected inside MultiTTS
```

## Core rules

- SillyTavern is the **host and message source**, not the TTS engine.
- Integration is event-driven; DOM scraping is prohibited unless a future upstream regression leaves no supported alternative.
- Normal operation never calls `/voices`.
- Normal operation omits `voice=`; MultiTTS owns narrator selection.
- Audio is loaded through native HTML media elements, because the current MultiTTS service is reachable as media but is not CORS-readable from the remote SillyTavern page.
- Narration state belongs to this extension: pause means pause, stop means stop, and the current segment/time are not intentionally discarded on pause.
- Background browser survival is a separate platform problem. The extension must degrade honestly and must not claim to defeat Android/Chrome process suspension.

## Current status

**Architecture complete enough to begin implementation; implementation has intentionally not started.**

The previous SillyTavern TTS-provider implementation is frozen at:

- `archive/st-tts-provider-v1.2.2-final`
- older diagnostic snapshot: `diagnostic-v1.2.2`

The next implementation line is planned as **2.0.0-alpha**.

Start here:

1. [PROJECT_STATE.md](./PROJECT_STATE.md)
2. [Product specification](./docs/PRODUCT.md)
3. [Architecture](./docs/ARCHITECTURE.md)
4. [Implementation blueprint](./docs/IMPLEMENTATION_BLUEPRINT.md)
5. [Test plan](./docs/TEST_PLAN.md)

## Non-goals

This project does not attempt to:

- patch or replace SillyTavern's core TTS subsystem;
- keep LLM generation alive after the browser connection is killed;
- implement an Android foreground service inside a browser extension;
- scrape rendered chat text from the DOM;
- manage MultiTTS voice catalogs;
- proxy private chat text through a remote server;
- promise uninterrupted playback after Chrome/Android freezes or discards the page.

## License

No new license decision is made by this architecture reset. Do not add a license as part of implementation without the repository owner's explicit choice.
