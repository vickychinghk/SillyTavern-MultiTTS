# PROJECT MEMORY — SillyTavern MultiTTS

> Canonical handoff file for future conversations.
>
> **Future assistant instruction:** read this file first, then read `docs/SESSION_2026-09-29.md`, then inspect the current `main` branch before changing code. Update this file after every meaningful debugging/design session.

Last updated: 2026-09-29

## Goal

Use the Android app **MultiTTS** as the TTS engine for a remotely-hosted SillyTavern opened in Chrome on the same Android phone.

The desired production path is deliberately simple:

```text
remote SillyTavern page
    -> Android Chrome
    -> http://127.0.0.1:8774/forward
    -> MultiTTS Android app
    -> upstream voice selected/managed inside MultiTTS
    -> WAV audio
    -> SillyTavern playback
```

The user prefers MultiTTS itself to manage the actual voice. The production plugin therefore should **not require /voices** and should normally omit the `voice=` query parameter.

## User environment confirmed

- SillyTavern is hosted on a server the user does not control.
- Browser origin observed during diagnostics: `https://a.dongshixishi.com`
- Phone browser: Chrome/Chromium on Android.
- Diagnostic UA observed: Chrome 153 / Android 10.
- MultiTTS runs locally on the same phone.
- MultiTTS forwarding service: `http://127.0.0.1:8774`
- Browser can open MultiTTS endpoints directly in another tab.
- The user can install SillyTavern third-party extensions through the UI from a public GitHub repository.
- Repository: `https://github.com/vickychinghk/SillyTavern-MultiTTS`

## MultiTTS facts confirmed

### Official/community identity

User-provided official channels:

- Official Chat: `@MultiTTS`
- Chinese group/channel references:
  - `t.me/MultiTTS_channel`
  - `t.me/MultiTTS_resource`

No official public MultiTTS Android source GitHub repository has been identified so far. Do **not** describe unrelated Android TTS projects as the official MultiTTS source.

### API documented by the MultiTTS app itself

```text
GET http://localhost:8774/forward

parameters:
  text    text to synthesize
  speed   0..100
  volume  0..100
  pitch   0..100
  voice   voice id, optional for our intended usage

GET http://localhost:8774/voices
```

Direct browser navigation to `/forward?... ` returns/plays a WAV named `forward.wav`.

### Independent API confirmation

The community project `Doraemonsan/BaiTTS-CLI-rs`, explicitly described as using the MultiTTS API, confirms:

- base URL `http://127.0.0.1:8774`
- GET `/voices`
- GET `/forward`
- parameters `text`, optional `voice`, `volume`, `speed`, `pitch`
- `/voices` shape includes:
  `{ success, data: { catalog: { provider: [ { id, name, gender, locale, type } ] } } }`

Koodo Reader also has a MultiTTS integration with the same `/forward` + `/voices` API and `data.catalog` flattening. Treat it as third-party corroboration, not official source.

## Browser/network diagnostics — definitive result

Diagnostic plugin v1.2.0 produced:

```text
Origin: https://a.dongshixishi.com
Endpoint: http://127.0.0.1:8774

loopback-network permission: granted
local-network-access permission: granted

/voices no-cors  -> success, opaque response
/voices cors     -> TypeError: Failed to fetch

/forward no-cors -> success, opaque response
/forward cors    -> TypeError: Failed to fetch

<audio src="/forward?..."> -> canplay / playback success
```

Conclusion:

1. MultiTTS localhost service is reachable from the page.
2. Chrome permits localhost/loopback access.
3. MultiTTS currently does **not** expose a CORS-readable response to the remote SillyTavern page.
4. JavaScript `fetch()` cannot read `/voices` or WAV content.
5. HTML audio can load `/forward` directly.
6. Therefore the correct normal integration is **direct audio URL**, not fetch-then-blob.

No relevant CSP block was observed in the diagnostic run.

## SillyTavern internals confirmed from current source

### Third-party provider API

Recent SillyTavern exposes `registerTtsProvider()`; the extension registers as provider `MultiTTS`.

### Direct audio URL support

A provider may return a string URL from `generateTts()`. SillyTavern puts that string into its audio job queue and eventually assigns it directly to the native `<audio>` element.

This is the core reason MultiTTS works despite CORS failure.

### Voice Map

SillyTavern itself requires characters to resolve through its Voice Map before it calls the provider.

The user previously saw:

```text
Assistant not in voicemap. Configure character in extension settings voice map
```

v1.2.1 fixed this by seeding:

```text
[Default Voice] -> MultiTTS 默认声音（使用 APP 当前旁白）
current character / Assistant -> same provider voice
```

That provider voice maps to a sentinel ID, and the provider omits the actual `voice=` parameter so MultiTTS chooses the voice internally.

### Native paragraph splitting

SillyTavern already has **Narrate by paragraphs**.

Current implementation:

- when disabled: whole message is one TTS job
- when enabled: message is split on newline `\n`
- empty lines are ignored
- it does **not** impose a configurable maximum character length
- it does **not** sentence-split a long single paragraph

Therefore production design should reuse this native paragraph feature and only perform an additional split when the individual text passed to the provider is still too long.

### Native queues

SillyTavern already has:

- `ttsJobQueue`
- `audioJobQueue`
- one current audio job
- playback only advances after the previous audio item's `ended` event

The provider does not need to implement its own playback queue.

SillyTavern also supports provider `generateTts()` returning an async generator. Each yielded audio URL is pushed into SillyTavern's existing audio queue.

Important consequence for direct MultiTTS URLs:

- URLs may be queued quickly as strings.
- The actual HTTP request for the next URL occurs when SillyTavern assigns that URL to the single audio element.
- Because the audio queue waits for the previous item to finish, actual audio loads are effectively sequential.
- Current MultiTTS CORS prevents us from reliably pre-fetching WAV blobs into a custom cache in page JavaScript.
- Do not add a second custom playback/cache queue unless new evidence justifies it.

## Long-text failure discovered

A short test sentence plays correctly.

A long body message reached MultiTTS successfully but MultiTTS logged an upstream failure:

```text
onFailure
error=request failed
code=504
msg=request timeout 10s
upstream=https://peiyin.xunfei.cn/synth
```

The signed query URL is intentionally not stored in this public repository.

Observed behavior:

1. MultiTTS restarted cleanly.
2. Short diagnostic audio worked.
3. Long SillyTavern body was sent successfully into MultiTTS.
4. MultiTTS's selected Xunfei/peiyin upstream timed out after 10 seconds.
5. After that failure, even subsequent short local `/forward` tests stopped working.
6. Killing/restarting the MultiTTS app restored service.

Current interpretation:

- The main plugin/browser path is working.
- The immediate failure is inside MultiTTS/upstream synthesis for long requests.
- MultiTTS may enter a stuck state after that upstream timeout.
- The role of Android/OPPO background process management is still unproven and should be tested separately, after long-text behavior is stabilized.

## Plugin version history

### v1.0.0
- first browser-side SillyTavern TTS provider
- GET `/voices`
- GET `/forward`
- assumed readable JSON/audio through fetch
- insufficient for remote HTTPS origin because MultiTTS does not provide readable CORS responses

### v1.1.0
- switched normal audio generation to return direct `/forward` URL string
- added default voice fallback
- added MultiTTS `data.catalog` parsing

### v1.2.0 Diagnostic
- extensive browser/network diagnostics
- CORS/no-cors/media tests
- permissions/CSP observations
- manual voice JSON import
- report copy/download
- proved direct media path works and fetch CORS path does not

### v1.2.1
- seeded SillyTavern native Voice Map to APP-default voice
- added `checkReady()`
- fixed diagnostic buttons by making them `type="button"` so normal buttons no longer accidentally submit/open tabs

### v1.2.2
- experimental long-text chunking
- default heuristic 70 characters
- provider uses async generator and SillyTavern's native audio queue

**Important:** 70 is only an experimental heuristic. It is **not a measured safe maximum**. Do not bake 70 into the final production design without testing.

Current diagnostics are preserved on branch:

`diagnostic-v1.2.2`

## Production design direction

The production provider should be much smaller than the diagnostic build.

Preferred behavior:

1. One provider: MultiTTS.
2. One local endpoint default: `http://127.0.0.1:8774`.
3. Voice Map exposes one provider voice: APP default.
4. Always omit `voice=` for normal use.
5. Return direct `/forward?... ` URL(s).
6. Reuse SillyTavern's native Voice Map, TTS queue, audio queue, playback rate and **Narrate by paragraphs**.
7. Do not fetch `/voices` during normal operation.
8. Do not create a parallel custom audio queue.
9. Only split text further when the text passed to the provider exceeds a validated threshold.
10. When further splitting is necessary, prefer natural sentence punctuation over hard character cuts.
11. Keep diagnostic tooling separate from the production path/branch.

## Threshold status

We do **not yet know the maximum safe request length** for the user's current MultiTTS + Xunfei voice.

Known only:

- short diagnostic text succeeds
- one long message of several hundred Chinese characters produced upstream 504 timeout after 10 seconds
- v1.2.2's 70-character value has not yet been validated as optimal

Next testing should determine a useful threshold empirically (for example by trying controlled 40/60/80/100/... character samples with a clean MultiTTS process), rather than guessing.

## Caching / prefetch decision

Current recommendation: **do not prefetch WAVs in plugin JavaScript**.

Reason:

- MultiTTS does not permit CORS-readable WAV responses from the remote SillyTavern origin.
- Direct audio URL is the path proven to work.
- SillyTavern already serializes actual audio playback/loads.
- Prefetching several hidden audio resources could create concurrent upstream synthesis and may make the timeout/stuck-state problem worse.

If a future local server provides CORS and is robust under parallel requests, prefetch/cache can be reconsidered.

## TTS Server (jing332/tts-server-android) comparison

Repository: `https://github.com/jing332/tts-server-android`

Facts confirmed from source:

- open source
- README shows MIT license badge
- active public GitHub repository
- Android TTS application
- supports Microsoft demo interfaces, custom HTTP requests, imported local TTS engines, retry/fallback/text replacement features
- current server code installs CORS with `anyHost()`
- forward server provides:
  - GET/POST `/api/tts`
  - GET `/api/engines`
  - GET `/api/voices?engine=...`
- TTS response is `audio/x-wav`

Compared with the user's MultiTTS:

### MultiTTS advantages
- user already has it configured
- desired voices/rules already live inside the app
- very simple `/forward` API
- direct media path has been proven on the user's phone

### MultiTTS disadvantages observed
- official source repo not identified
- `/voices` and WAV are not CORS-readable from remote SillyTavern page
- selected Xunfei upstream timed out on a long request
- app appeared to remain stuck after that timeout until process restart

### jing332 TTS Server advantages
- open source and inspectable
- built-in CORS `anyHost()` in current server code
- explicit engines/voices/tts REST API
- retry/fallback/custom-request capabilities may make it easier to diagnose and recover
- likely easier to build a full-featured browser-side SillyTavern provider because JavaScript can read the REST responses

### jing332 TTS Server disadvantages / unknowns
- requires separate setup/migration of the user's preferred voices/rules
- its API is not the same as MultiTTS, so our MultiTTS provider cannot be reused unchanged
- no completed official SillyTavern integration has been confirmed

SillyTavern issue #3462 requests an Android TTS-server option and remains open.
jing332/tts-server-android issue #287 requests SillyTavern TTS interface support and remains open.
A GitHub repository search did not find a clear existing SillyTavern extension specifically for `jing332/tts-server-android`.

Bottom line: both are local HTTP TTS bridges at the architectural level, but TTS Server exposes a more developer-friendly/open/CORS-enabled API. MultiTTS remains the shortest path because it is already configured and its direct audio route is proven.

## Next recommended work

1. Preserve diagnostic v1.2.2 branch (done).
2. Do not keep expanding diagnostic code on production main.
3. Decide whether to:
   - finish MultiTTS production path first, or
   - run a short proof-of-concept with jing332 TTS Server for comparison.
4. For MultiTTS:
   - validate maximum safe single-request text length
   - verify whether SillyTavern's own `Narrate by paragraphs` is sufficient for most messages
   - only split paragraphs that still exceed the validated maximum
   - test MultiTTS foreground vs background separately
5. After results, replace diagnostic main implementation with a minimal production provider and retain diagnostics only on the diagnostic branch.

## New-chat handoff

In a new ChatGPT conversation, give this repository URL and say:

> Read `PROJECT_MEMORY.md` and `docs/SESSION_2026-09-29.md` first, inspect the current repository, and continue from the recorded next steps. Do not restart the investigation from scratch.

