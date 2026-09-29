# Design

## Boundary

SillyTavern is the message host. MultiTTS Narrator owns narration state. MultiTTS owns voice/upstream selection.

```text
SillyTavern public context/events
  -> host adapter
  -> normalize / segment
  -> one narrator controller
  -> bounded AudioSlot preload
  -> ordered HTML audio playback
  -> http://127.0.0.1:8774/forward
```

Core rules:

- no SillyTavern TTS provider registration, Voice Map or native TTS queues;
- no DOM scraping for canonical message text;
- all SillyTavern access stays in `src/host.js`;
- `voice` is omitted and `/voices` is not used in normal operation;
- pause preserves the current media element/time; stop destroys the session;
- stale media callbacks are rejected by session/generation identity;
- full chat text is never written to Narrator storage or diagnostics;
- non-loopback endpoints require an explicit confirmation before saving;
- background browser execution is best-effort, not a foreground service.

## Source shape

- `index.js` — lifecycle wiring only.
- `src/host.js` — SillyTavern public context/events adapter.
- `src/settings.js` — versioned settings and minimal checkpoint storage.
- `src/text.js` — pure normalization, hashing and segmentation.
- `src/media.js` — URL construction, `AudioSlot`, Media Session integration.
- `src/narrator.js` — single authoritative session/scheduler/controller.
- `src/ui.js` — settings and compact controls; no direct media ownership.

No runtime dependencies are required. Browser/platform APIs are used directly; tests use Node's built-in test runner.

## Playback policy

Each segment is `queued → loading → ready → playing → ended`, with `error`, `skipped`, or `canceled` terminal alternatives. Readiness can complete out of order; playback cannot.

Alpha keeps one active narration plus at most one latest pending automatic message. Manual narration has explicit priority. A segment gets at most one automatic retry; exhausted failures require Retry / Skip / Stop.

The recovery checkpoint stores only chat/message identifiers, revision hash, segment index/time, settings hash, status and timestamp. Restore reconstructs text from SillyTavern and waits for an explicit Resume action.
