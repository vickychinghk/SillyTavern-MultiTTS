# Testing

## Automated

```bash
npm test
npm run check
```

Tests cover semantic segmentation, Unicode limits, text-only/request-parameter URLs, ordered preload playback, pause/resume, previous/next, explicit message selection, retry exhaustion, stale-message replacement, deletion invalidation and checkpoint privacy.

## Android acceptance

Use current SillyTavern 1.19.x release, Android Chrome stable, remote HTTPS SillyTavern and local MultiTTS.

1. **Basic:** health test, per-message play button, play/pause/resume/stop.
2. **Parameters:** toggle request parameters off and confirm `/forward` still works with text only.
3. **Segmentation:** test newline-heavy text and long semantic sentences at several limits up to 1000.
4. **Ordering:** verify automatic transitions and manual next reuse prepared audio without duplicate/reordered speech.
5. **Navigation:** previous restarts the prior segment; next advances once.
6. **Mutation/failure/privacy/background:** keep the alpha.1 regression checks for stale audio, retry storms, diagnostic text leakage and Android lifecycle behavior.

The default 70-character segment size and 3-way preload remain conservative calibration defaults; do not change them from one successful device run.
