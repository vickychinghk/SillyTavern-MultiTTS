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
- `src/ui.js` — settings and compact controls; no direct media ownership.

No runtime dependencies are required. Browser/platform APIs are used directly; tests use Node's built-in test runner.

## Playback policy

Each segment is `queued → loading → ready → playing → ended`, with `error`, `skipped`, or `canceled` terminal alternatives. Readiness can complete out of order; playback cannot.

Alpha keeps one active narration plus at most one latest pending automatic message. Manual narration has explicit priority. A segment gets at most one automatic retry; exhausted failures require Retry / Skip / Stop.

The recovery checkpoint stores only chat/message identifiers, revision hash, segment index/time, settings hash, status and timestamp. Restore reconstructs text from SillyTavern and waits for an explicit Resume action.

## Current UX

- Chinese-only UI; optional speed/volume/pitch request parameters.
- 20–1000 code-point semantic segmentation: newline first, then complete sentence, then late clause/whitespace fallback.
- Prepared audio remains ordered and gap-minimized; previous/next transport does not replace the preload path.
- Each assistant message keeps the right-side MultiTTS action and also gets the same cloned control immediately after `.name_text` when that standard name node exists.
- Optional “skip code blocks” and “skip tagged blocks” mirror SillyTavern TTS preprocessing semantics before normalization/segmentation.
- Rendered-text highlighting/click-to-seek remains deferred.
