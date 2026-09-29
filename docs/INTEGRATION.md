# Integration Contract

## 1. Host contract: SillyTavern

Narrator integrates with SillyTavern as a normal third-party extension, but **not as a TTS provider**.

### Required host capabilities

- public event source;
- event type constants;
- canonical chat context access;
- extension settings persistence;
- normal extension UI mounting.

### Event strategy

The event bus is a signal, not necessarily the complete data payload.

For any narration-affecting event:

1. receive event;
2. resolve canonical chat/message from SillyTavern state;
3. compute current message revision identity;
4. compare with active/pending session;
5. transition controller.

This avoids making correctness depend on subtle event payload differences between versions.

### Preferred trigger for v2 alpha

Narrate **completed assistant replies**.

Do not attempt token-by-token speech in the first implementation.

Reason:

- simpler stale-message handling;
- no repeated re-segmentation during streaming;
- no premature synthesis of text later rewritten by streaming;
- lower load on MultiTTS;
- much smaller recovery surface.

Streaming narration is a separate future feature.

## 2. MultiTTS contract

Known local service:

```text
GET http://127.0.0.1:8774/forward
```

Parameters used by this product:

- `text` — required;
- `speed` — 0..100;
- `volume` — 0..100;
- `pitch` — 0..100.

Normal operation omits:

- `voice`

because voice selection belongs to MultiTTS.

Normal operation does not call:

- `/voices`

### Media loading contract

JavaScript fetch is not a requirement.

The browser is asked to load:

```text
http://127.0.0.1:8774/forward?...encoded parameters...
```

as the media source of an HTML audio element.

The product treats audio bytes as opaque.

## 3. Endpoint safety

Default endpoint is loopback only.

If custom endpoint editing is implemented:

- normalize trailing slash;
- reject obvious malformed URLs;
- prominently warn when host is not loopback/localhost;
- never attach SillyTavern cookies or credentials;
- never send authorization headers automatically.

Chat text is sensitive. A non-loopback endpoint means chat content leaves the device/browser and must be an explicit user decision.

## 4. Host-version compatibility

Target baseline at design time:

- SillyTavern 1.19.x release line;
- Android Chrome/Chromium;
- remote SillyTavern page + local Android MultiTTS.

Compatibility layer rules:

- import host APIs through one adapter module only;
- never scatter SillyTavern-specific imports through core logic;
- feature-detect optional browser APIs;
- fail visibly if required event/context APIs disappear.

## 5. Message identity

A message identity should include enough information to detect replacement:

- chat id;
- message index/id;
- assistant/character identity where relevant;
- swipe/revision indicator if exposed;
- stable content hash.

Hash is for local consistency, not security.

If current canonical content no longer matches active session content hash, old audio is stale and must be canceled.

## 6. Autoplay contract

Browser media policies vary.

The extension must have an explicit user enable/play interaction path.

If `play()` rejects due to autoplay policy:

- transition to BLOCKED_BY_AUTOPLAY;
- preserve prepared segments;
- show one concise action to continue;
- do not discard the session;
- resume after a user gesture.

## 7. Media Session contract

When `navigator.mediaSession` exists, map:

- play -> resume/start;
- pause -> pause;
- stop -> stop;
- nexttrack -> skip current segment, if product UI exposes equivalent semantics.

Do not make Media Session a required dependency.

## 8. Host actions that invalidate narration

Always invalidate active session on:

- chat change;
- source message deletion;
- source message swipe/replacement;
- source message edit/update that changes hash.

Generation stopped without changing the already finalized source message does not automatically invalidate already prepared narration.
