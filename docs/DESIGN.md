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

## 工程约束

> 文档和代码都要精简，不要膨胀。文档尽可能的最精简化，不要重复。代码尽可能商业成熟，用一些组件，不要用一些手写，奇怪的手写。以及有问题的话，要先提出来。

## Source shape

- `index.js` — lifecycle wiring only.
- `src/host.js` — SillyTavern public context/events adapter.
- `src/settings.js` — versioned settings and minimal checkpoint storage.
- `src/text.js` — pure normalization, hashing and segmentation.
- `src/media.js` — URL construction, `AudioSlot`, Media Session integration.
- `src/narrator.js` — single authoritative session/scheduler/controller.
- `src/ui.js` — draggable launcher with integrated player/settings/logs; no direct media ownership.

No runtime dependencies are required. Browser/platform APIs are used directly; tests use Node's built-in test runner.

## Playback policy

Each segment is `queued → loading → ready → playing → ended`, with `error`, `skipped`, or `canceled` terminal alternatives. Readiness can complete out of order; playback cannot.

Alpha keeps one active narration plus at most one latest pending automatic message. Manual narration has explicit priority. A segment gets at most one automatic retry; exhausted failures require Retry / Skip / Stop.

The recovery checkpoint stores only chat/message identifiers, revision hash, segment index/time, settings hash, status and timestamp. Restore reconstructs text from SillyTavern and waits for an explicit Resume action.

## Current UX

- A movable floating icon opens one panel with playback, settings and persistent logs. The original extension settings drawer is removed.
- Each assistant message retains a MultiTTS play action; the host remains the sole source of message text.
- Hidden HTML comments are discarded; visible styled paragraphs remain speakable. Optional code/custom-tag skipping runs before punctuation-aware segmentation.
- Each stage records safe timing metrics: segment load/ready, audio play request/start/end, stalls, buffer state, and end-to-next-start gap. The journal keeps up to 2000 recent events across reloads with batched storage writes.
- No full chat text, /forward URL or waveform is persisted. Exported settings include the configured endpoint, which should be reviewed before sharing.
- Highlighting and click-to-seek remain deferred.
