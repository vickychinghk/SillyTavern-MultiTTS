# Playback and Scheduling Specification

## 1. Goal

Keep enough future speech prepared that playback is limited by synthesis speed rather than by a deliberately sequential request pipeline.

## 2. Segment states

Each segment is exactly one of:

- QUEUED
- LOADING
- READY
- PLAYING
- PAUSED
- ENDED
- ERROR
- SKIPPED
- CANCELED

Transitions are controlled centrally.

## 3. Preload window

Two separate settings must exist conceptually:

### Look-ahead

How many upcoming segments should be loaded or ready.

Product target: **5**.

### Max in-flight

How many media loads may simultaneously be in LOADING.

Product hard ceiling: **5** until device testing justifies another value.

Keeping these separate avoids confusing queue depth with real network concurrency.

## 4. Ordering

Synthesis readiness may complete:

```text
3, 1, 5, 2, 4
```

Playback must remain:

```text
1 -> 2 -> 3 -> 4 -> 5
```

A READY segment may never bypass an earlier non-terminal segment.

## 5. Loading

For each scheduled segment:

- allocate one audio element;
- set preload to auto;
- assign direct MultiTTS URL;
- call load;
- observe media lifecycle.

Readiness signal for alpha:

- `canplay` is sufficient to mark READY for initial testing;
- `canplaythrough` may be collected as a diagnostic but must not be required because browsers estimate it inconsistently.

The same element that becomes READY should be the one eventually played.

## 6. Playback transition

When current segment ends:

1. mark ENDED;
2. dispose old slot after checkpoint update;
3. advance expected index;
4. if next index is READY, start immediately;
5. if next index is LOADING, remain BUFFERING;
6. refill scheduler capacity.

There is no artificial inter-segment delay.

## 7. Pause

Pause:

- calls pause on current media element;
- records currentTime;
- transitions PLAYING -> PAUSED;
- keeps READY and LOADING future work by default;
- does not clear the session.

Optionally, future loads may be allowed to finish while paused.

## 8. Resume

Resume:

- validates current session/revision;
- uses existing current media element if valid;
- restores currentTime if the browser reset it unexpectedly and seek is supported;
- calls play;
- transitions PAUSED -> PLAYING.

If current media resource was evicted, reload only that segment and remain BUFFERING until ready.

## 9. Stop

Stop is destructive by design:

- cancel current session generation token;
- pause current media;
- dispose all slots;
- mark remaining work CANCELED;
- clear recovery checkpoint;
- return to IDLE.

UI text must say Stop, not Pause.

## 10. Skip

Skip is explicit.

Allowed for:

- user action;
- unrecoverable segment after retry budget is exhausted, if user chooses continue.

Skipping one segment must not renumber segment ids; it only makes the segment terminal so later playback can proceed.

## 11. Error policy

HTML media errors do not expose rich upstream HTTP diagnostics.

Therefore retry policy must be conservative.

Initial policy:

- one automatic retry for a segment;
- recreate only that media slot;
- no retry storm;
- if retry fails, set session to ACTION_REQUIRED;
- offer Retry / Skip / Stop.

Circuit breaker:

- if two distinct segments fail in a short window, stop launching new loads;
- keep already READY segments;
- surface MultiTTS health warning;
- require explicit recovery action or successful health test before refilling.

Exact time window is implementation-tuning work.

## 12. Timeout policy

Do not invent a short browser-side timeout that races legitimate synthesis.

Collect:

- request/load start time;
- metadata/canplay time;
- play start time;
- ended/error time.

A watchdog may be introduced after real latency distribution is measured.

## 13. Segmentation

### Requirements

- count Unicode code points, not UTF-16 code units;
- preserve paragraph information;
- prefer natural punctuation;
- avoid tiny fragments where reasonable;
- deterministic output;
- no empty segments.

### Priority

1. paragraph boundary;
2. `。！？!?；;` near target;
3. `，,、：:` if necessary;
4. hard boundary.

### Threshold

The production hard maximum is not yet known.

Historic 70-character chunking is retained only as a calibration reference.

Before beta, run controlled 40/60/70/80/100/... tests against the intended MultiTTS voice/upstream and choose a measured default.

## 14. Performance metrics

Collect locally in debug mode:

- segment chars;
- queue time;
- load-to-canplay;
- canplay-to-play;
- playback duration;
- inter-segment transition gap;
- in-flight count;
- ready depth;
- retries/errors.

Do not log segment text.

### Release target

When the next segment is already READY:

- no intentional delay;
- p95 transition gap should be established on the target phone/browser and then used as the release SLO.

Do not publish a fabricated millisecond guarantee before device measurements exist.

## 15. Resource bounds

At target look-ahead 5:

- one current slot;
- up to five future loading/ready slots;
- ended slots disposed promptly;
- canceled slots release listeners/source.

The extension must never accumulate one media element per historical segment indefinitely.
