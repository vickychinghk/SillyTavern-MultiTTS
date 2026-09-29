# SillyTavern MultiTTS

Use an Android phone's local **MultiTTS forwarding service** as a native SillyTavern TTS provider.

## Current version

**v1.1.0**

This version is designed specifically for the case where:

- SillyTavern is hosted on a remote server
- SillyTavern is opened in Chrome/Chromium on the Android phone
- MultiTTS is installed on that same phone
- MultiTTS forwarding service is enabled on port 8774

## MultiTTS endpoints

- `GET http://127.0.0.1:8774/voices`
- `GET http://127.0.0.1:8774/forward?text=...&speed=...&volume=...&pitch=...&voice=...`

## Why v1.1 works differently

Opening `/forward` in the browser can work even when JavaScript `fetch()` from a remote SillyTavern page is blocked by CORS/local-network browser rules.

SillyTavern's TTS core accepts a **direct audio URL string**, so v1.1 returns the `/forward?... ` URL directly to SillyTavern's audio player instead of fetching the WAV with JavaScript.

That means actual TTS playback does not require CORS permission to read the audio response.

The `/voices` endpoint is still fetched with JavaScript because the provider needs to read the JSON. If that is blocked, the provider falls back to:

**MultiTTS 默认声音（使用 APP 当前旁白）**

This fallback omits the `voice=` parameter, so MultiTTS uses the narrator/default voice currently selected in the Android app.

## Real MultiTTS voice-list format

v1.1 supports the format used by existing MultiTTS integrations:

```text
{
  "success": true,
  "data": {
    "catalog": {
      "...group...": [
        {
          "id": "...",
          "name": "...",
          "gender": "...",
          "locale": "..."
        }
      ]
    }
  }
}
```

It flattens all groups in `data.catalog` and exposes them to SillyTavern's Voice Map.

## Install / update from SillyTavern

Repository URL:

`https://github.com/vickychinghk/SillyTavern-MultiTTS`

For a new install:

1. Open **Extensions**
2. Choose **Install Extension**
3. Paste the repository URL
4. If asked for a branch, use `main`
5. On a multi-user server, choose **current user only**
6. Install and refresh the SillyTavern page

For an existing install:

1. Open **Extensions**
2. Open **Manage extensions**
3. Find **MultiTTS (Android Local)**
4. Use its update action to pull the latest commit
5. Refresh the page

## Use

1. Enable MultiTTS's forwarding service on Android.
2. Confirm this opens in the same phone browser:
   `http://127.0.0.1:8774/forward?text=你好&speed=50&volume=100&pitch=50`
3. In SillyTavern, open **TTS**
4. Select **MultiTTS**
5. Keep endpoint:
   `http://127.0.0.1:8774`
6. Press **测试默认声音**
7. If that works, the audio path is working.
8. Press **尝试读取音色列表**
9. If voice reading fails but default audio works, simply choose **MultiTTS 默认声音（使用 APP 当前旁白）** in Voice Map.

## Settings

- Endpoint
- Speed: 0-100
- Volume: 0-100
- Pitch: 0-100
- Test default audio
- Try to load voice list

## Notes

If Chrome asks whether the site may access the local network or local devices, allow it.

If `/voices` cannot be read from the SillyTavern page but opens correctly in a separate browser tab, that usually indicates a browser cross-origin/local-network restriction rather than a MultiTTS server failure.
