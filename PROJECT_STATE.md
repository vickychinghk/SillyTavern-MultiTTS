# Project State

**Date:** 2026-09-29  
**Phase:** Architecture freeze / pre-implementation  
**Planned line:** 2.0.0-alpha

## Decision

The prior architecture — registering MultiTTS as a SillyTavern TTS provider — is retired from `main`.

It is preserved intact at:

`archive/st-tts-provider-v1.2.2-final`

The new product is an **independent narrator/player extension**. It consumes SillyTavern messages/events but owns its own segmentation, synthesis scheduling, media elements, playback queue, controls, recovery state, and diagnostics.

## Why the reset exists

Three independent limitations were established:

1. **SillyTavern native TTS control semantics**
   - the core playback control is a full stop, not a true pause;
   - stopping clears current jobs and queues;
   - restarting can narrate the last message from the beginning.

2. **SillyTavern core chunk playback**
   - current playback is strictly sequential;
   - direct URL chunks are assigned to the single audio element only when their turn starts;
   - the next MultiTTS request therefore starts too late in the proven direct-URL path;
   - upstream issue #6031 independently identifies source-swap / canplay gaps as a core player concern.

3. **Android/browser lifecycle**
   - a browser extension cannot guarantee execution after Chrome freezes/discards the page or Android kills the browser;
   - chat generation can also abort if the browser connection closes;
   - this is outside the scope of a TTS player rewrite.

## Hard boundaries

Implementation must not:

- import or register with SillyTavern's TTS provider API;
- call `registerTtsProvider()`;
- depend on SillyTavern Voice Map;
- modify SillyTavern TTS settings;
- reuse SillyTavern `ttsJobQueue` or `audioJobQueue`;
- use `/voices` in normal operation;
- fetch MultiTTS WAV bytes through JavaScript;
- require a server-side localhost proxy;
- persist full chat text outside SillyTavern by default.

## What is allowed

The extension may use:

- SillyTavern public events;
- SillyTavern canonical chat/message state;
- normal extension settings persistence;
- HTML media elements;
- Media Session API when available;
- Page Visibility / lifecycle signals;
- local, non-content diagnostics.

## Implementation gate

Do not start production code until all items below remain accepted:

- [x] old architecture archived;
- [x] product scope defined;
- [x] integration contract defined;
- [x] playback state model defined;
- [x] error / recovery policy defined;
- [x] mobile lifecycle boundary documented;
- [x] security/privacy rules documented;
- [x] test matrix and release gates defined;
- [x] future source layout defined;
- [ ] repository owner explicitly starts implementation.

The repository is intentionally non-installable at this commit.
