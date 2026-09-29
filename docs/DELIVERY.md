# Delivery and Release Plan

## 1. Version strategy

Historic line:

- 1.x — SillyTavern TTS provider architecture, archived.

New line:

- 2.0.0-alpha.1 — first independent Narrator implementation;
- 2.0.0-alpha.N — functional stabilization;
- 2.0.0-beta.1 — defaults calibrated and failure handling complete;
- 2.0.0 — only after target-device acceptance.

## 2. Branch strategy

Permanent:

- `main` — current product line;
- `archive/st-tts-provider-v1.2.2-final` — frozen final old architecture;
- `diagnostic-v1.2.2` — older diagnostic snapshot.

Implementation work:

- small feature branches;
- merge only when architecture invariants remain intact.

Do not revive 1.x implementation by copying old `index.js` back into main.

## 3. Commit discipline

Prefer commits that each have one reason:

- scaffold;
- host adapter;
- pure segmenter;
- controller/state;
- media slot;
- scheduler;
- controls;
- diagnostics;
- tests.

Do not land "everything works" monoliths.

## 4. Proposed implementation sequence

### Milestone A — inert extension shell

- manifest;
- settings namespace;
- UI placeholder;
- host subscription install/uninstall;
- no speech yet.

### Milestone B — pure core

- message identity;
- normalizer;
- segmenter;
- session model;
- unit tests.

### Milestone C — one-segment media path

- MultiTTS URL builder;
- one media slot;
- play/pause/stop;
- autoplay handling.

### Milestone D — scheduler

- look-ahead;
- bounded concurrency;
- ordered readiness/playback;
- cleanup.

### Milestone E — host mutation handling

- swipe/edit/delete/chat change;
- dedupe;
- pending message policy.

### Milestone F — recovery/media session

- checkpoint;
- visibility reconciliation;
- Media Session.

### Milestone G — diagnostics/calibration

- privacy-safe health panel;
- threshold test;
- concurrency test;
- timing metrics.

### Milestone H — release hardening

- failure circuit breaker;
- target device matrix;
- docs;
- install/update verification.

## 5. Rollback

If v2 work blocks production use, old implementation remains available on the archive branch.

Do not mix rollback code into v2.

## 6. Documentation gate

Every behavior exposed in UI must exist in one of:

- product spec;
- state/recovery spec;
- test plan.

Undocumented hidden modes are discouraged.

## 7. License decision

Repository owner must choose licensing separately.

Do not infer that the previous lack of a license means a specific new commercial/open-source policy.
