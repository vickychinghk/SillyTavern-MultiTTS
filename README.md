# MultiTTS Narrator for SillyTavern

Lightweight narration extension for SillyTavern + Android MultiTTS. It uses its own HTML audio playback, not SillyTavern's built-in TTS provider or voice map.

## Install and use

1. In **Extensions → Install Extension**, install this GitHub repository (or choose the development branch to preview changes).
2. Click the floating headphones icon to open the player. Drag the icon anywhere on the screen; its position is saved on this device.
3. Open **设置**, enable narration, and verify the MultiTTS address (default: `http://127.0.0.1:8774`).
4. Run **测试语音服务**, then choose **播放最新回复** or the button beside an assistant message. Automatic narration is optional.

Player, settings, and diagnostic log all live in the floating panel. The plugin does not add an extension settings drawer.

## Playback and diagnostics

- Visible paragraphs and styled text from mixed HTML/preset responses are narratable; hidden HTML comments are excluded.
- Newlines and punctuation guide sentence segmentation (20–1000 characters).
- Bounded concurrent preload, in-order playback, pause/resume, skip, retry, message changes, and checkpoint recovery are supported.
- The **日志** tab shows the last 30 events; **复制完整日志** exports up to 2000 locally persisted events including segment loading, readiness, playback start/stop, gap timings, buffering and media state.
- Diagnostics do **not** include chat text or synthesis URLs, but do include timing metadata and your configured endpoint. Review before sharing. **清空日志** erases the local journal.

Android/Chrome can suspend or discard background pages. This browser extension cannot provide native Android foreground-service guarantees.

Developer notes: [Design](./docs/DESIGN.md) · [Testing](./docs/TESTING.md). Run `npm test && npm run check`.
