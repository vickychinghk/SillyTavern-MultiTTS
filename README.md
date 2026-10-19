# MultiTTS Narrator for SillyTavern

Lightweight narration extension for SillyTavern + Android MultiTTS. It uses its own HTML audio playback, not SillyTavern's built-in TTS provider or voice map.

## Install and use

1. In **Extensions → Install Extension**, install this GitHub repository (or choose the development branch to preview changes).
2. Click the floating headphones icon to open the player. Drag the icon anywhere on the screen; its position is saved on this device.
3. Open **设置**, enable narration, and verify the MultiTTS address (default: `http://127.0.0.1:8774`).
4. Run **测试语音服务**, then choose **播放最新回复** or the button beside an assistant message. Automatic narration is optional.

Player, settings, and diagnostic log all live in the floating panel. Control icons are built-in SVGs and do not require Font Awesome or Tavern Helper. The plugin does not add an extension settings drawer.

## Playback and diagnostics

- Visible paragraphs and styled text from mixed HTML/preset responses are narratable; hidden HTML comments, reasoning blocks, and <details> summaries are excluded. Model <content> wrappers keep their narrative body even when custom-tag skipping is enabled.
- Newlines and punctuation guide sentence segmentation (20–1000 characters).
- Demand-first **serialized** loading: only the selected segment is requested first; after it is ready, future segments are requested one by one (up to 5 ahead). Playback never waits for look-ahead.
- Single-step navigation settles after 300 ms; repeated jumps within 2 seconds coalesce to the final target. In-flight speculative loads are canceled. Ready/played audio is retained in a 12-slot LRU memory cache and can be replayed without a fresh request until evicted.
- Audio load timeouts default to 60 seconds (configurable 30–120 seconds), followed by one retry if enabled. The largest successful load in the supplied Oct 19 diagnostic log was 42.574 s; therefore 30 s is not a safe default.
- In-order playback, pause/resume, retry, message changes, and checkpoint recovery remain supported. Serial browser requests cannot guarantee that server-side synthesis has been canceled if the server ignores client aborts.
- The **日志** tab shows the last 30 events and can copy the active session's exact numbered segments. **复制最新回复纯文本** reads the latest assistant message from SillyTavern and copies the exact filtered plain text sent for segmentation, without storing it. **复制完整日志** exports up to 2000 locally persisted events including source filter character counts, segment timing and media state.
- Diagnostics do **not** include chat text or synthesis URLs, but do include timing metadata and your configured endpoint. Review before sharing. **清空日志** erases the local journal.

Android/Chrome can suspend or discard background pages. This browser extension cannot provide native Android foreground-service guarantees.

Developer notes: [Design](./docs/DESIGN.md) · [Testing](./docs/TESTING.md). Run `npm test && npm run check`.
