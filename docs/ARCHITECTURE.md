# Architecture

## 1. System context

```text
┌──────────────────────────────┐
│ SillyTavern                  │
│ - chat canonical state       │
│ - eventSource / event_types  │
└───────────────┬──────────────┘
                │ supported events + state reads
                ▼
┌──────────────────────────────┐
│ MultiTTS Narrator            │
│                              │
│ Host Adapter                 │
│   ↓                          │
│ Message Gate / Dedupe        │
│   ↓                          │
│ Normalizer                   │
│   ↓                          │
│ Segmenter                    │
│   ↓                          │
│ Narration Session Controller │
│   ├─ Scheduler               │
│   ├─ Segment Registry        │
│   ├─ Playback Controller     │
│   ├─ Recovery Checkpoint     │
│   └─ Diagnostics             │
└───────────────┬──────────────┘
                │ audio.src = localhost URL
                ▼
┌──────────────────────────────┐
│ Android Browser Media Stack  │
└───────────────┬──────────────┘
                ▼
┌──────────────────────────────┐
│ MultiTTS :8774               │
│ GET /forward                 │
└───────────────┬──────────────┘
                ▼
        selected upstream voice
```

## 2. Architectural layers

### 2.1 Host Adapter

Responsibilities:

- subscribe/unsubscribe SillyTavern events;
- obtain canonical current chat/message state;
- translate host events into stable internal commands;
- never own playback state.

Inputs of interest:

- `MESSAGE_RECEIVED`
- `CHARACTER_MESSAGE_RENDERED`
- `GENERATION_STARTED`
- `GENERATION_STOPPED`
- `GENERATION_ENDED`
- `MESSAGE_EDITED`
- `MESSAGE_UPDATED`
- `MESSAGE_SWIPED`
- `MESSAGE_DELETED`
- `CHAT_CHANGED`

The adapter must not scrape message DOM.

### 2.2 Message Gate

Responsibilities:

- assistant-only eligibility for v2 alpha;
- ignore system/empty/sentinel messages;
- identify message revision;
- deduplicate events that refer to the same final reply;
- reject stale work after swipe/edit/chat switch.

A narration request identity should be based on host identifiers plus a content revision/hash, not just visible text.

### 2.3 Normalizer

Conservative transformation only.

Allowed examples:

- normalize line endings;
- remove unsupported embedded image markdown if the host state still contains it;
- trim pathological outer whitespace;
- apply explicitly configured exclusions.

Do not collapse all newlines into spaces. Paragraph boundaries are useful synthesis boundaries.

### 2.4 Segmenter

Pure function. No networking or UI.

Priority:

1. paragraph boundary;
2. sentence-ending punctuation;
3. clause punctuation near target size;
4. hard code-point boundary only as final fallback.

Segmentation must be deterministic for the same input + settings.

### 2.5 Narration Session Controller

Single source of truth.

Owns:

- session id;
- message identity/revision;
- segment list;
- current playback index;
- per-segment state;
- current media time;
- pause/stop flags;
- retry budget;
- cancellation generation/token.

No other module may directly mutate session state.

### 2.6 Scheduler

Purpose: keep future audio prepared without losing order.

Concepts:

- `lookAhead`: desired number of future segments prepared/being prepared;
- `maxInFlight`: hard limit of simultaneous media loads;
- playback order: always segment index order;
- readiness order: arbitrary.

The scheduler fills capacity whenever:

- a session starts;
- a load becomes READY/ERROR;
- playback advances;
- resume occurs.

### 2.7 Media Slot

One segment owns one HTML media element while it is loading/ready/playing.

Why:

- no CORS-readable bytes are required;
- preloaded element can later be the actual playback element;
- no second fetch or cache assumption is necessary;
- currentTime can be paused/resumed directly.

Rules:

- no `crossorigin` attribute for the proven direct media path;
- `preload="auto"`;
- source is one `/forward` URL;
- listeners are one-shot/cleanly removed;
- ended/error/canplay lifecycle is routed back through the controller;
- ended slots are disposed promptly.

### 2.8 Playback Controller

Only one segment may be PLAYING.

Responsibilities:

- start earliest READY segment whose predecessors are complete/skipped;
- pause current element without clearing it;
- resume current element;
- stop all slots;
- skip a failed/current segment only via explicit controller transition;
- update Media Session metadata/actions if supported.

### 2.9 Recovery Checkpoint

Persistence is intentionally small.

Persist:

- chat identity;
- message identity;
- revision/hash;
- segment index;
- approximate currentTime;
- narration settings hash;
- session status timestamp.

Do not persist full message text. After page restore, reconstruct from SillyTavern canonical chat state and verify hash/revision before offering resume.

## 3. Dependency direction

Allowed:

```text
UI -> Controller
Host Adapter -> Controller
Controller -> Segmenter
Controller -> Scheduler
Scheduler -> Media Slot factory
Media Slot -> Controller events
Controller -> Checkpoint
Controller -> Diagnostics
```

Forbidden:

```text
UI -> raw Audio element
Host Adapter -> raw Audio element
Segmenter -> network/media
Media Slot -> SillyTavern chat mutation
Diagnostics -> controller mutation
```

## 4. SillyTavern TTS isolation

The following are explicitly outside the new dependency graph:

- `registerTtsProvider`
- `initVoiceMap`
- SillyTavern TTS `generateTts()`
- native TTS audio element
- native TTS queues
- native TTS settings UI
- TTS playback control

A future code review should reject these dependencies automatically.

## 5. Lifecycle

### Extension load

- load settings;
- install host subscriptions;
- install controls;
- remain IDLE.

No MultiTTS network request is required on extension load.

### New completed reply

- host adapter emits candidate;
- message gate resolves canonical message;
- previous stale auto session is canceled according to policy;
- new session is segmented;
- scheduler fills look-ahead;
- earliest READY segment starts when playback is permitted.

### Swipe/edit

If affected message equals active session source:

- increment cancellation generation;
- stop/dispose all old slots;
- re-resolve canonical message;
- either start a replacement session or remain stopped according to user action policy.

### Chat change

Always stop active narration and clear transient state. Never let audio from another chat continue silently.

## 6. Concurrency model

JavaScript remains single-threaded; "concurrency" means multiple independent browser media requests in flight.

Required invariant:

```text
number(LOADING) <= maxInFlight
```

Desired invariant while session has enough future work:

```text
number(LOADING or READY after current index) ~= lookAhead
```

Playback invariant:

```text
at most one segment == PLAYING
```

## 7. Complexity budget

The v2 alpha architecture deliberately avoids:

- WebAudio;
- AudioWorklet;
- MediaSource;
- Service Worker media proxy;
- server proxy;
- IndexedDB audio caching;
- voice discovery;
- adaptive ML-style scheduling.

Those may be revisited only with evidence that HTML media slots cannot meet acceptance criteria.
