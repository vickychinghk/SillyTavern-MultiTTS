# Testing

Run `npm test && npm run check`.

Unit tests cover segmentation and HTML comments, bounded persistent diagnostics, native media URL handling, strict playback order, gap telemetry, pause/resume, retries, mutations and checkpoints.

## Manual Android / SillyTavern acceptance

1. Drag the headphones icon to all screen edges, refresh, and confirm its position persists. Open/close the panel and verify no interaction with the underlying chat is blocked.
2. Confirm playback, settings and logs stay inside the panel; disabled narration must still allow settings access.
3. Play a mixed-format assistant reply containing hidden `<!-- comments -->`, visible styled `<p>` elements and plain text. Verify the comments/markup are not narrated, visible paragraphs are.
4. Play multi-segment replies; compare `segment-ended` to the following `segment-playing.gapMs`, inspect `loadMs`, `startDelayMs`, `stalledMs`, and buffered-ahead samples. Test foreground/background and failed endpoints.
5. Refresh and confirm logs persist, then copy the complete report; clear and confirm the journal resets. Review the endpoint metadata before sharing logs.

No browser unit test substitutes for real device audio timing.
