# Testing

## Automated

```bash
npm test
npm run check
```

Tests cover segmentation, Unicode code points, URL safety, ordered out-of-order readiness, pause/resume, retry exhaustion, stale-message replacement, deletion invalidation and checkpoint privacy.

## Android acceptance

Use current SillyTavern 1.19.x release, Android Chrome stable, remote HTTPS SillyTavern and local MultiTTS.

1. **Health:** enable Narrator and run Health test.
2. **Basic:** Narrate current; verify play/pause/resume/stop.
3. **Ordering:** use an 8+ segment reply; verify no duplicate/reordered speech.
4. **Mutation:** while speaking, swipe/edit/delete/change chat; stale audio must stop.
5. **Failure:** stop MultiTTS; verify one retry then actionable Retry/Skip/Stop without a retry storm.
6. **Autoplay:** fresh browser session; blocked playback must preserve the session until Resume is tapped.
7. **Privacy:** copied diagnostics and browser storage must not contain the test sentence or a `/forward?text=...` URL.
8. **Background:** separately test another tab, Home, another app, screen lock, and 1/5/15 minutes hidden. Record current audio, next-segment transition and return recovery separately.

## Calibration

The shipped alpha defaults are intentionally conservative: 70 code points, look-ahead 3, max in-flight 3. Test segment sizes 40/60/70/80/100/120 and concurrency 1/2/3/5 on the target MultiTTS voice/upstream before changing defaults.

For each run record first playable latency, load-to-canplay, inter-segment gap, failures and whether MultiTTS remains healthy after a failed request. Do not turn a single successful run into a new default.
