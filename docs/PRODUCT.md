# Product Specification

## 1. Product name

Working name: **MultiTTS Narrator**

Host: SillyTavern  
Speech engine: Android MultiTTS local forwarding service

## 2. User problem

The desired experience is not "make SillyTavern support one more TTS provider."

The desired experience is:

- automatically narrate completed assistant replies;
- start quickly;
- keep several upcoming segments prepared;
- play strictly in text order even if synthesis finishes out of order;
- avoid multi-second silence between segments;
- provide real pause/resume instead of reset-and-restart;
- recover gracefully from a temporary MultiTTS failure;
- remain simple enough to maintain through SillyTavern upgrades.

## 3. Primary use case

Environment:

- SillyTavern is remotely hosted;
- user opens it in Chrome/Chromium on Android;
- MultiTTS runs on the same Android device;
- MultiTTS local service is available at `http://127.0.0.1:8774`;
- MultiTTS itself decides the active narrator/voice.

Primary flow:

1. User sends a chat message.
2. SillyTavern completes an assistant reply.
3. Narrator identifies the final assistant message through supported events/state.
4. Narrator creates one narration session.
5. Text is normalized and segmented.
6. A bounded number of segment media requests are started in parallel.
7. Segments become READY in any order.
8. Playback always occurs in index order.
9. While one segment plays, the scheduler replenishes the look-ahead window.
10. Pause preserves current segment and current time.
11. Resume continues from the preserved point.
12. Stop ends the session deliberately and clears it.

## 4. Product principles

### 4.1 Minimal host coupling

SillyTavern owns chat data. Narrator observes it.

No dependency on native TTS internals.

### 4.2 Explicit ownership

Narrator owns all narration state. There must be exactly one authoritative session controller.

### 4.3 Direct media first

The proven browser path to MultiTTS is media loading, not CORS-readable fetch.

The product should not introduce a proxy merely to make architecture look cleaner.

### 4.4 Measured limits, not folklore

Text length, concurrency and timeout defaults must be validated on-device.

The historic value "70 characters" is an experiment, not a product truth.

### 4.5 Honest mobile behavior

The product may improve background playback probability, but must never represent browser JavaScript as an Android foreground service.

## 5. v2 alpha scope

Included:

- assistant-message auto narration;
- manual narrate-current-message action;
- direct MultiTTS default voice;
- deterministic segmentation;
- preload/look-ahead scheduler;
- bounded concurrent media loading;
- ordered playback;
- pause/resume;
- stop;
- next/skip failed segment;
- basic progress/status;
- Media Session integration when supported;
- in-memory session recovery;
- minimal checkpoint for page return;
- compact diagnostics;
- privacy-safe logs.

Deferred:

- narrating streaming tokens before generation completes;
- multi-character / quoted-dialogue voices;
- voice browser;
- RVC integration;
- audio waveform / visualization;
- persistent audio files;
- cloud sync;
- server-side synthesis;
- native Android companion service;
- background LLM generation.

## 6. User-facing settings

Default surface should remain small:

- Enable Narrator
- Auto narrate assistant replies
- MultiTTS endpoint
- Speed
- Volume
- Pitch

Advanced:

- Maximum segment size
- Look-ahead segment count
- Maximum simultaneous synthesis loads
- One-retry policy
- Debug logging
- Mobile health test

Do not expose settings that are not actionable.

## 7. Planned defaults

Defaults below are product targets, not validated production constants:

- endpoint: `http://127.0.0.1:8774`
- voice parameter: omitted
- speed: 50
- volume: 100
- pitch: 50
- look-ahead target: 5 segments
- hard maximum concurrent loads: 5
- maximum segment size: **TBD by calibration**
- retry count: 1
- auto narrate: on after explicit user enable

If five-way concurrency proves unstable with the active MultiTTS upstream, release must ship a measured lower default rather than pretend the requirement is satisfied.

## 8. Experience goals

When segment N+1 is READY before segment N ends:

- there must be no intentional scheduling delay;
- player transition should start immediately after N ends;
- software-added transition latency should be measured and reported during QA.

Pause/resume must be semantically different from stop.

A failure in segment N must not silently destroy the rest of the narration session.

## 9. Success criteria

The architecture is successful when:

- changing SillyTavern's native TTS settings has no effect on Narrator;
- native TTS can be disabled and Narrator still works;
- five segments can be loaded concurrently on a validated MultiTTS configuration;
- out-of-order READY completion still plays in-order;
- pause at mid-segment resumes from approximately the same media time;
- swipe/edit/chat change cannot make stale audio continue unnoticed;
- no full chat text appears in logs or persistent Narrator storage;
- Chrome background limitations are surfaced accurately, not hidden.
