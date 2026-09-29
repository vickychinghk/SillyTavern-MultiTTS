# Implementation Blueprint

> This document defines the future code shape. The directories below are **not created yet**. The repository intentionally stops before implementation.

## 1. Planned source layout

```text
manifest.json
index.js

src/
  app/
    narrator-controller.js
    settings.js

  host/
    sillytavern-adapter.js
    message-identity.js

  text/
    normalize.js
    segment.js

  session/
    session-model.js
    transitions.js
    checkpoint.js

  media/
    multitts-url.js
    audio-slot.js
    scheduler.js
    playback.js
    media-session.js
    visibility.js

  ui/
    settings-view.js
    controls-view.js
    status-view.js

  diagnostics/
    metrics.js
    health.js
    report.js

tests/
  unit/
  integration/
  fixtures/
```

Names may change during implementation, but ownership boundaries should not.

## 2. Entry point responsibilities

Future `index.js` should be boring:

- instantiate app/controller;
- install extension UI;
- subscribe host adapter;
- dispose on extension lifecycle if supported.

It should not contain segmentation, networking, scheduler logic or diagnostics.

## 3. Controller API

Conceptual commands:

- enable
- disable
- narrateMessage(messageIdentity)
- pause
- resume
- stop
- skip
- retry
- onHostMutation
- onMediaEvent
- dispose

UI and adapters send commands. They do not manipulate media directly.

## 4. Pure modules

The following should be testable without DOM/browser:

- message revision identity/hash;
- normalization;
- segmentation;
- state transition validation;
- scheduler selection logic;
- pending-message policy.

This is where most correctness should live.

## 5. Media abstraction

Even though production initially uses HTMLAudioElement, controller should depend on a narrow media-slot interface rather than DOM methods everywhere.

Required conceptual operations:

- load
- play
- pause
- seek
- dispose
- getCurrentTime
- getState

Required events:

- ready
- playing
- ended
- error

This permits deterministic fake slots in integration tests.

## 6. Settings model

Use one versioned settings object.

Do not read UI controls directly from core logic.

Categories:

- endpoint;
- synthesis controls;
- segmentation;
- scheduler;
- behavior;
- diagnostics.

Migration function must exist from first public alpha onward.

## 7. UI design

### Compact controls

Show only when Narrator is enabled:

- play/pause;
- stop;
- skip when applicable;
- current segment / total;
- short state label.

### Settings

Keep primary settings short.

Put segmentation/concurrency/debug behind Advanced.

### Error presentation

One actionable message, not a diagnostic dump.

Examples of categories:

- MultiTTS unreachable;
- playback blocked by browser;
- segment failed;
- source message changed;
- background execution interrupted.

## 8. Diagnostics separation

Diagnostics may observe controller/media metrics.

Diagnostics must not own production transitions.

Manual health tests may create isolated test media slots outside active session and must clean them up completely.

## 9. Prohibited shortcuts during coding

Reject PR/change if it:

- imports SillyTavern TTS internals;
- adds a second uncontrolled session state object;
- stores Audio elements in UI components;
- logs a `/forward` URL with text;
- makes DOM message text the canonical source;
- adds arbitrary retry loops;
- hardcodes 70 as "safe";
- assumes five-way concurrency is safe without test;
- treats hidden-page keepalive as guaranteed;
- adds third-party runtime dependencies without need.

## 10. First implementation commit

The first code commit after this architecture freeze should contain only:

- minimal manifest;
- minimal entry point;
- inert settings namespace;
- no TTS provider registration;
- no synthesis;
- no playback.

That creates a reviewable foundation before behavior is added.
