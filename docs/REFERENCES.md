# References

These references informed the architecture. They are evidence/context, not runtime dependencies.

## SillyTavern

### Event types

Current event definitions include message, generation, rendering and TTS events:

https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/events.js

Narrator uses message/generation events, not TTS events.

### Current native TTS core

Used only to understand and deliberately avoid native queue/control semantics:

https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/extensions/tts/index.js

### Gapless playback issue

Open issue describing sequential chunk playback and source-swap gaps:

https://github.com/SillyTavern/SillyTavern/issues/6031

### Official Silence Player extension

Background-tab mitigation reference:

https://github.com/SillyTavern/Extension-Silence

## Chrome / Web platform

### Page Lifecycle

https://developer.chrome.com/docs/web-platform/page-lifecycle-api/

### Timer throttling

https://developer.chrome.com/blog/timer-throttling-in-chrome-88/

These explain why background browser execution cannot be treated as guaranteed service execution.

## Android-native architecture reference

TauriTavern Android development notes, including generation ownership through a native foreground service:

https://github.com/Darkatse/TauriTavern/blob/main/docs/AndroidDevelopment.md

This is cited to define the boundary of what a browser-only extension cannot guarantee.

## MultiTTS API evidence

The project relies on the locally observed MultiTTS forwarding API:

```text
GET /forward
  text
  speed
  volume
  pitch
  voice (optional)

GET /voices
```

Normal Narrator operation uses only `/forward` and omits `voice`.

Community corroboration of the MultiTTS API shape:

https://github.com/Doraemonsan/BaiTTS-CLI-rs

No public repository is claimed here as the official source code of the user's MultiTTS Android app.
