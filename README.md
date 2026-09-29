# SillyTavern MultiTTS

> Project continuity: read [PROJECT_MEMORY.md](./PROJECT_MEMORY.md) first. Detailed 2026-09-29 investigation: [docs/SESSION_2026-09-29.md](./docs/SESSION_2026-09-29.md). Diagnostic build is preserved on branch `diagnostic-v1.2.2`.

Use the Android **MultiTTS** local forwarding service as a SillyTavern TTS provider.

## Current release

**v1.2.0 Diagnostic**

This release intentionally contains extra diagnostics. Once the browser/SillyTavern/MultiTTS interaction is fully understood, the diagnostic UI can be reduced.

## Confirmed MultiTTS API

Evidence used for this integration:

1. MultiTTS app's own forwarding-service help text:
   - `GET http://localhost:8774/forward`
   - parameters: `text`, `speed`, `volume`, `pitch`, `voice`
   - `GET http://localhost:8774/voices`
2. BaiTTS-CLI-rs, a community tool explicitly built on the MultiTTS API:
   - base URL example: `http://127.0.0.1:8774`
   - `/voices` response parsed as `{ success, data: { catalog: { provider: Voice[] } } }`
   - Voice fields: `id`, `name`, `gender`, `locale`, `type`
   - speech generation uses GET `/forward` with optional `voice`, `volume`, `speed`, `pitch` and required `text`

BaiTTS-CLI-rs is not claimed to be the official MultiTTS source repository; it is used only as an independent implementation confirming the public API shape.

## Why the diagnostic release exists

A URL opened directly in a browser tab and the same URL accessed by JavaScript from a remote SillyTavern page are different security contexts.

For a remote SillyTavern origin such as HTTPS -> `http://127.0.0.1:8774`, possible blockers include:

- CORS
- browser Local Network / loopback permissions
- CSP `connect-src`
- browser mixed-content / local-network rules
- media-loading policy

v1.2 tests those paths separately.

## Important design rule

The provider's normal `fetchTtsVoiceObjects()` does **not** automatically call the network. It returns cached voices plus a permanent fallback:

**MultiTTS 默认声音（使用 APP 当前旁白）**

This prevents SillyTavern's own Voice Map initialization from failing just because `/voices` cannot be read through JavaScript.

Actual TTS generation returns a direct `/forward?... ` URL string to SillyTavern's native audio player, so it can work even when JavaScript cannot read the WAV response because of CORS.

## Diagnostic tools

The provider UI contains:

1. **测试默认声音（真正播放）**
   - Loads `/forward` through an HTML audio element.
   - Does not require JavaScript to read the WAV response.

2. **读取 /voices 并导入音色**
   - Performs a CORS fetch of `/voices`.
   - Parses `data.catalog`, caches voices, and refreshes SillyTavern Voice Map.

3. **运行完整诊断**
   Tests:
   - page origin / protocol / secure-context state
   - browser user agent
   - local/loopback permission APIs when exposed
   - Permissions Policy checks when exposed
   - `/voices` with `no-cors`
   - `/voices` with `cors`
   - JSON parsing and voice count
   - `/forward` with `no-cors`
   - `/forward` with `cors`
   - direct HTML audio loading of `/forward`
   - CSP violation events that mention localhost / 127.0.0.1 / port 8774

4. **新标签页打开 /voices**
5. **新标签页打开 /forward**

These distinguish top-level navigation from page JavaScript and media loading.

6. **手动粘贴 /voices JSON**
   - If direct browser navigation can display `/voices` but the remote page cannot read it because of CORS, copy the returned JSON and paste it into the provider.
   - Parsed voices are cached in SillyTavern settings and become available in Voice Map.

7. **复制诊断报告 / 下载诊断报告**
   - Logs environment and network-test results.
   - Does not intentionally log chat message contents; TTS log entries record text length only.

## Installation

Repository:

`https://github.com/vickychinghk/SillyTavern-MultiTTS`

For existing installs:

1. Open **Extensions**
2. Open **Manage extensions**
3. Find **MultiTTS (Android Local)**
4. Update it
5. Refresh the SillyTavern page
6. Confirm version **1.2.0**

## Recommended test order

1. Enable MultiTTS forwarding service.
2. In the same Android browser, confirm `http://127.0.0.1:8774/forward?text=你好&speed=50&volume=100&pitch=50` plays/downloads audio.
3. Select **MultiTTS** in SillyTavern TTS.
4. Run **③ 运行完整诊断** first.
5. Then run **① 测试默认声音（真正播放）**.
6. Then run **② 读取 /voices 并导入音色**.
7. If voice reading fails but direct `/voices` navigation works, paste the complete `/voices` JSON into the manual-import box.
8. Copy the diagnostic report and provide it when troubleshooting.

## Normal API behavior

```text
GET /voices

GET /forward
  ?text=<required>
  &voice=<optional>
  &volume=0..100
  &speed=0..100
  &pitch=0..100
```

When `voice` is omitted, MultiTTS's current/default narrator is used.
