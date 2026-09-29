# Architecture Decision Records

## ADR-001 — Retire SillyTavern native TTS provider integration

**Status:** Accepted

Decision:

The new product will not register as a SillyTavern TTS provider.

Reason:

- native TTS owns queue/control semantics that conflict with required pause/resume;
- direct URL path starts later requests too late;
- old architecture accumulated diagnostics and provider-specific workarounds;
- independence creates a clean product boundary.

Consequence:

SillyTavern native TTS may be disabled and Narrator still functions.

---

## ADR-002 — Use SillyTavern events + canonical state, not DOM scraping

**Status:** Accepted

Decision:

Host adapter listens to supported events and resolves canonical messages from SillyTavern state.

Reason:

DOM markup is a presentation detail and high-maintenance integration surface.

Consequence:

All host-specific access is isolated to one adapter.

---

## ADR-003 — Use direct HTML media loading, not fetch/blob

**Status:** Accepted

Decision:

Each segment is loaded through an HTML audio element pointed at MultiTTS `/forward`.

Reason:

Current browser diagnostics prove media loading works while CORS-readable fetch does not.

Consequence:

Audio bytes remain opaque; WebAudio/AudioWorklet processing is not available in the initial architecture.

---

## ADR-004 — One preloaded media element per segment

**Status:** Accepted for alpha

Decision:

The element used to preload a segment is retained and later used to play that same segment.

Reason:

Avoids dependence on HTTP cache reuse and avoids a second network/decode path.

Consequence:

Must strictly dispose ended/canceled elements and cap look-ahead.

---

## ADR-005 — Completed-message narration first

**Status:** Accepted

Decision:

v2 alpha narrates finalized assistant replies, not live streaming tokens.

Reason:

Streaming speech multiplies stale-text, resegmentation and cancellation complexity.

Consequence:

Time-to-first-speech begins after finalized reply in alpha. Progressive speech can be evaluated later.

---

## ADR-006 — Pause is non-destructive

**Status:** Accepted

Decision:

Pause preserves active session, segment index and current media time.

Reason:

Restart-from-beginning was a major user pain point in native TTS behavior.

Consequence:

Stop remains the only destructive playback action.

---

## ADR-007 — No full chat text persistence

**Status:** Accepted

Decision:

Narrator checkpoints store identifiers/hash/position only.

Reason:

SillyTavern already owns the canonical message; duplicating private content increases privacy risk.

---

## ADR-008 — Browser background survival is not guaranteed

**Status:** Accepted

Decision:

Narrator will not claim reliable execution after Chrome/Android freezes, discards or kills the page.

Reason:

This requires native/server task ownership beyond browser extension authority.

Consequence:

Background reliability tests are reported as platform behavior, not promised product capability.

---

## ADR-009 — No voice catalog in normal operation

**Status:** Accepted

Decision:

Narrator omits `voice=` and does not call `/voices`.

Reason:

User wants MultiTTS to own narrator selection, and `/voices` is not CORS-readable in the proven environment.

---

## ADR-010 — Five-segment look-ahead is a target, not an untested guarantee

**Status:** Accepted

Decision:

Architecture supports a look-ahead and in-flight ceiling of five.

Production default is finalized only after real MultiTTS concurrency calibration.

Reason:

The desired UX requires ahead-of-playback work, while the active upstream may have its own concurrency limits.
