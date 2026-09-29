# Test Plan and Release Gates

## 1. Philosophy

No architecture claim becomes a production default until tested on the target Android/browser/MultiTTS path.

Tests are divided into:

- deterministic unit tests;
- browser integration tests;
- real-device acceptance tests;
- failure-injection tests.

## 2. Unit tests

### Segmenter

Cover:

- empty input;
- Chinese punctuation;
- English punctuation;
- mixed Chinese/English;
- emoji / surrogate pairs;
- long paragraph without punctuation;
- repeated whitespace;
- newlines;
- exact threshold;
- threshold + 1;
- deterministic output.

### State machine

Cover legal/illegal transitions:

- prepare -> ready -> play -> end;
- play -> pause -> resume;
- stop from every active state;
- cancel on swipe/edit/chat change;
- stale callback rejected by cancellation generation;
- error -> retry -> ready;
- retry exhausted -> action required -> skip.

### Dedupe

Multiple host events for one final message must create one narration session.

## 3. Browser integration tests

Use controllable fake media adapters where possible.

Verify:

- in-flight semaphore;
- readiness completion out of order;
- playback remains ordered;
- pause keeps current index/time;
- stop disposes all;
- stale media callback cannot affect replacement session;
- pending latest-message policy;
- autoplay rejection preserves session.

## 4. Real MultiTTS calibration

On a clean MultiTTS process, controlled samples:

- 40 chars
- 60
- 70
- 80
- 100
- 120
- longer if stable

Record:

- load start -> canplay;
- playback duration;
- failure;
- whether app becomes stuck after failure.

Repeat for concurrency:

- 1
- 2
- 3
- 5 simultaneous segments.

A release default must be based on repeated successful trials, not one run.

## 5. Ordered concurrency acceptance

Create 8+ segments.

Force/observe out-of-order readiness.

Pass condition:

- actual spoken order remains 1..N;
- no duplicate segment;
- no skipped segment unless explicitly marked;
- no more than configured max in flight.

## 6. Pause/resume acceptance

During a long segment:

1. pause around middle;
2. wait at least 10 seconds;
3. resume.

Pass:

- same segment resumes;
- playback time is near paused point;
- future READY segments remain usable;
- narration does not restart from segment 1.

## 7. Mutation tests

While narrating:

- swipe assistant response;
- edit assistant response;
- delete message;
- change chat.

Pass:

- stale session stops;
- stale prepared audio never later plays;
- replacement follows documented policy.

## 8. MultiTTS failure tests

Test:

- app killed;
- localhost service disabled;
- upstream timeout;
- media error;
- one segment failure among ready future segments.

Pass:

- no retry storm;
- state becomes understandable;
- Retry/Skip/Stop behaves deterministically;
- old listeners/elements are released.

## 9. Autoplay tests

Test fresh browser session with no prior media permission.

Pass:

- blocked play does not destroy session;
- UI clearly asks for user action;
- one user action starts/resumes narration.

## 10. Mobile lifecycle matrix

Required matrix is defined in MOBILE_RELIABILITY.md.

Results must distinguish:

- model generation;
- local MultiTTS survival;
- current audio;
- segment transition;
- return/recovery.

## 11. Privacy tests

Search logs/storage for:

- known test sentence;
- encoded test sentence;
- full `text=` query.

Pass:

- no plaintext/encoded chat body in production logs or Narrator checkpoint storage.

## 12. Performance gate

Before beta define measured SLOs for:

- first playable latency;
- READY-to-play transition gap;
- scheduler overhead;
- memory/element cleanup.

No SLO number should be frozen before target-device measurement.

## 13. Compatibility gate

Minimum required acceptance:

- current SillyTavern release branch;
- Android Chrome stable;
- remote HTTPS SillyTavern origin;
- local HTTP loopback MultiTTS.

Desktop support is best-effort unless separately tested.

## 14. Release checklist

Alpha implementation cannot be called beta until:

- [ ] segment threshold calibrated;
- [ ] concurrency default calibrated;
- [ ] five-way capability result documented;
- [ ] pause/resume passes;
- [ ] swipe/edit/chat invalidation passes;
- [ ] no content logging passes;
- [ ] failure circuit breaker passes;
- [ ] mobile lifecycle matrix recorded;
- [ ] install/update path verified;
- [ ] rollback branch documented.
