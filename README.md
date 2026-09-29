# SillyTavern MultiTTS

A lightweight third-party TTS provider for using an Android phone's local **MultiTTS forwarding service** from SillyTavern.

## What it does

The extension runs in the browser and talks directly to MultiTTS on the same Android phone:

- `GET http://127.0.0.1:8774/voices`
- `GET http://127.0.0.1:8774/forward?text=...&speed=...&volume=...&pitch=...&voice=...`

This is specifically useful when SillyTavern itself is hosted on a remote server. The remote SillyTavern server does **not** need to reach the phone; the browser on the phone makes the localhost request.

## Install from SillyTavern UI

Open SillyTavern's **Extensions** panel, choose **Install Extension**, and install from:

`https://github.com/vickychinghk/SillyTavern-MultiTTS`

On a multi-user server, choose the option that installs the extension only for the current user if that option is shown.

Refresh the SillyTavern page after installation.

## Use

1. Open MultiTTS on Android and enable its forwarding service.
2. In the phone browser, verify that `http://127.0.0.1:8774/voices` opens successfully.
3. In SillyTavern, open **Extensions -> TTS**.
4. Select **MultiTTS** as the Provider.
5. Keep the endpoint as `http://127.0.0.1:8774`.
6. Press **测试连接 / 刷新音色**.
7. Use SillyTavern's normal Voice Map to assign voices to characters.

If Chrome/Chromium asks for permission to access the local network or local devices, allow it.

## Settings

The provider exposes:

- Local endpoint
- Speed (0-100)
- Volume (0-100)
- Pitch (0-100)
- Test connection / refresh voices

## Voice list compatibility

The extension attempts to parse common `/voices` JSON shapes, including:

- arrays of strings
- arrays of objects using fields such as `id`, `voice_id`, `voiceId`, `voice`, `value`, `name`, or `label`
- wrappers such as `{ "voices": [...] }`, `{ "data": [...] }`, and similar
- ID-to-name object maps

If `/voices` opens correctly but the extension says it cannot recognize voices, open an issue and paste a small sample of the returned JSON.

## Compatibility

This extension uses SillyTavern's third-party TTS registration API `registerTtsProvider()`, which is available in recent SillyTavern releases.

Version: **1.0.0**
