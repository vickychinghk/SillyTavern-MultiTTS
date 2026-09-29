# Testing

## Automated

```bash
npm test
npm run check
```

Tests cover semantic segmentation, code/tag filtering, URL parameters, ordered preload playback, pause/resume, previous/next, explicit message selection, retry, mutation recovery and checkpoint privacy.

## Android acceptance

1. **Message controls:** each assistant message keeps the right-side MultiTTS action; standard layouts also show the same action immediately after the username.
2. **Filters:** verify “跳过代码块” removes ``` / ~~~ fenced blocks and “跳过标签块里的内容” removes paired tagged content such as `<Tag>跳过这里</Tag>`.
3. **Regression:** verify text-only requests, semantic segmentation up to 1000, gap-free prepared-segment transitions, previous/next, failures, privacy and background recovery.

The default 70-character segment size and 3-way preload remain conservative calibration defaults.
