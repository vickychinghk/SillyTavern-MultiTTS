# State, Cancellation and Recovery

## 1. Session states

Top-level session state:

- IDLE
- PREPARING
- BUFFERING
- PLAYING
- PAUSED
- ACTION_REQUIRED
- COMPLETED
- STOPPED
- CANCELED

Only the controller changes state.

## 2. Session record

Conceptual fields:

- sessionId
- chatId
- messageId
- messageRevisionHash
- createdAt
- sourceMode: auto | manual
- settingsSnapshot
- segments[]
- currentIndex
- currentTime
- status
- cancellationGeneration
- lastError

This is a design schema, not implementation code.

## 3. Cancellation generation

Every session/revision owns a monotonic cancellation generation/token.

Async media callbacks must verify that they still belong to the current generation before mutating state.

This prevents stale `canplay`, `ended` or `error` events from a canceled swipe/edit session from corrupting the replacement session.

## 4. Replacement rules

### New assistant message

Default alpha policy:

- if no active narration: start;
- if current narration is auto and a newer assistant message appears: queue policy is configurable later;
- alpha should prefer one active message at a time and avoid unbounded conversation narration backlog.

Recommended initial behavior:

- finish current active message;
- keep at most one pending latest auto message;
- replace older pending auto message with newer one.

Manual narration always has explicit user priority.

### Swipe/edit of active source

Immediately cancel stale session and rebuild from canonical new revision.

### Delete active source

Stop and clear.

### Chat switch

Stop and clear.

## 5. Checkpoint persistence

Purpose: recover UI/narration position after a normal page reload/return, not to create a shadow chat database.

Persist only:

- host chat id;
- host message id/index;
- message hash;
- segment index;
- approximate currentTime;
- settings hash;
- status;
- timestamp.

Never persist full source text by default.

## 6. Restore

On extension load:

1. read checkpoint;
2. resolve current host chat/message;
3. compute current message hash;
4. if mismatch, discard checkpoint;
5. if match, re-run deterministic normalization/segmentation;
6. verify segment index exists;
7. offer or automatically resume only according to explicit setting.

Do not auto-speak unexpectedly on page load before browser media permission is satisfied.

## 7. Crash consistency

Checkpoint writes should occur at meaningful boundaries:

- session created;
- segment play start;
- pause;
- segment ended;
- stop/cancel;
- page hidden.

Do not write on every timeupdate event.

## 8. Page visibility

On `visibilitychange` to hidden:

- persist checkpoint;
- do not intentionally stop active audio;
- do not start risky extra work solely because page is hidden.

On visible:

- reconcile actual media state with controller;
- detect stale checkpoint/session;
- resume scheduler if permitted.

## 9. Browser freeze/discard

No JavaScript design can guarantee callbacks while the page is frozen or absent.

The product contract is:

- preserve recoverable state before likely suspension when possible;
- continue browser-managed audio when the platform allows it;
- reconcile when execution resumes;
- never claim native background guarantees.

## 10. Storage hygiene

All stored keys should be namespaced and versioned.

Schema migration must be explicit.

Old incompatible checkpoint schemas should be discarded rather than guessed.
