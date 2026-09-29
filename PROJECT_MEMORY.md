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



## Mobile/browser background lifecycle and TTS architecture — follow-up

The user reported a second, separate reliability problem beyond MultiTTS request latency:

- when SillyTavern is opened in an Android browser and the browser is backgrounded / the user returns to the home screen, text generation can sometimes stop;
- TTS is even more likely to stop;
- after TTS stops, pressing SillyTavern's TTS playback control can restart narration from the beginning instead of resuming.

This is now treated as **two distinct engineering problems**:

1. **background chat generation survival**
2. **TTS generation/playback continuity and resume UX**

Do not conflate them.

### Android/browser lifecycle is a real upstream constraint

Chrome's Page Lifecycle documentation confirms that hidden pages may become frozen or discarded. In the frozen state, freezable JavaScript tasks such as timers and fetch callbacks are suspended. On mobile, an OS can also stop applications to reclaim resources.

Relevant Chrome references:

- https://developer.chrome.com/docs/web-platform/page-lifecycle-api/
- https://developer.chrome.com/blog/timer-throttling-in-chrome-88/

Chrome also documents that pages observed playing audio are less likely to be discarded except under extreme resource pressure. However, Chrome's timer-throttling documentation explicitly says a **silent audio track does not count as making noise** for its "recently audible" timer exemption. Therefore any silence-player workaround must be treated as a mitigation, not a guarantee.

### SillyTavern has an official Silence Player mitigation

SillyTavern's official content index includes:

- repository: https://github.com/SillyTavern/Extension-Silence
- description: "Can help if the browser tab is being killed in a background."

The current extension is intentionally tiny: it adds a looping HTML audio element playing a bundled silence.m4a.

Community reports in 2025-2026 repeatedly recommend it for Android background generation, but reports are mixed: some users say it helps with app/tab switching, while others still see failures after minutes or when the phone locks.

Conclusion: test it before building anything larger, but do not design the project around it as a guaranteed keep-alive mechanism.

### SillyTavern generation can intentionally abort when the browser connection closes

Current SillyTavern backend source for many chat-completion providers creates an AbortController and attaches it to the client request socket close event, for example:

```js
request.socket.on('close', function () {
    controller.abort();
});
```

This pattern appears across multiple provider paths in:

https://github.com/SillyTavern/SillyTavern/blob/release/src/endpoints/backends/chat-completions.js

Therefore if Android backgrounding causes the browser connection/socket to close, upstream model generation may be intentionally aborted by SillyTavern.

Important architectural consequence:

> A browser-only TTS extension cannot make chat generation survive a dead browser connection.

A custom narrator can improve TTS after text exists, but it cannot solve this upstream generation-lifecycle problem.

### SillyTavern's TTS playback button is Stop, not Pause

Current TTS core explicitly describes its control as a full stop rather than a pause. The stop/reset path:

- cancels system TTS;
- clears current TTS/audio jobs;
- clears both queues;
- resets the audio element to time 0;
- clears the audio source.

When playback is idle and the user presses the control again, SillyTavern queues the latest message again.

This explains the user's observed behavior: after interruption, pressing play can restart the last message from the beginning. It is consistent with the current core design, not specific to MultiTTS.

Source:

https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/extensions/tts/index.js

Official docs also call the control the lower-right **Stop** button:

https://docs.sillytavern.app/extensions/tts/

### Current upstream also recognizes the gapless-player problem

Open SillyTavern issue #6031 (2026-09-13):

https://github.com/SillyTavern/SillyTavern/issues/6031

Title:

`[FEATURE_REQUEST] Gapless playback for streaming TTS providers (mechanism already exists in-tree)`

The report independently identifies the same core behavior we found:

- the player is strictly sequential;
- the next chunk is not taken until the current one ends;
- repeated audio-element `.src` changes cause fresh decode / `canplay` delays on mobile;
- provider-side prefetch alone cannot remove those source-swap gaps.

The issue proposes moving an existing AudioContext + AudioWorklet PCM sink from provider-specific code into the TTS core.

For our MultiTTS path, this mechanism is **not directly usable yet**, because the remote SillyTavern page cannot CORS-read MultiTTS's WAV response. AudioWorklet/PCM buffering requires readable audio bytes (or a different local bridge), while our proven path is an opaque direct media URL.

### Native clients show what a robust background solution actually requires

TauriTavern is a useful architecture reference, not a recommendation to migrate blindly.

Its Android implementation explicitly moves chat-completion ownership outside the WebView:

- a native Android `dataSync` Foreground Service is started for generation tasks;
- Rust `ChatCompletionService` owns the task and background execution lease;
- the WebView only consumes stream events;
- its documentation explicitly says the native task lifecycle must not be tied to WebView callbacks, because the WebView may be suspended.

Reference:

https://github.com/Darkatse/TauriTavern/blob/main/docs/AndroidDevelopment.md

This matches the general Android pattern: truly reliable background execution requires a native foreground-service/app layer or a server-side persistent job, not just more JavaScript inside a browser tab.

### Revised architecture boundary

The earlier recommendation "do not create a parallel custom playback queue" is now qualified:

- **For the thin MultiTTS provider:** still avoid adding a second player/queue unless testing proves it necessary.
- **As a separate narrator/player extension:** a custom queue is a legitimate design option if we deliberately want better TTS UX than SillyTavern core currently provides.

A separate narrator/player extension could own:

- text segmentation;
- controlled MultiTTS pre-generation/preloading;
- ordered playback;
- true pause/resume state;
- current chunk and current-time persistence;
- retry/skip behavior;
- Media Session integration;
- independent diagnostics.

But because it still runs inside the same browser page, it **cannot guarantee survival when Chrome freezes/discards the page or the OS kills the browser**.

To solve background chat generation as well, the long-running generation task must move outside the page: native Android foreground service / native wrapper / persistent server-side job.

### Low-risk test order before major redevelopment

1. Test SillyTavern's official Silence Player.
2. Give the browser unrestricted/background battery permission where Android/OEM permits it.
3. Give MultiTTS its own background/keep-alive permissions where available.
4. Test four states separately:
   - another browser tab;
   - another app/home screen;
   - screen off/lock;
   - return after several minutes.
5. Record separately whether:
   - chat generation survives;
   - MultiTTS service survives;
   - current audio survives;
   - next TTS chunk starts.
6. Only after that, decide whether to build a separate resume-capable narrator/player.
7. If **background chat generation itself** must be guaranteed, evaluate a native-wrapper/foreground-service architecture rather than trying to solve it solely inside the browser plugin.



### Independent narrator can use SillyTavern events, not DOM scraping

Current SillyTavern exposes stable event names in `public/scripts/events.js`, including:

- `MESSAGE_RECEIVED`
- `CHARACTER_MESSAGE_RENDERED`
- `STREAM_TOKEN_RECEIVED`
- `GENERATION_STARTED`
- `GENERATION_STOPPED`
- `GENERATION_ENDED`
- `MESSAGE_EDITED`, `MESSAGE_UPDATED`, `MESSAGE_SWIPED`, `CHAT_CHANGED`

Reference:
https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/events.js

Therefore, if we later build a separate narrator/player extension, the preferred integration is to subscribe to SillyTavern's event bus and read the canonical chat/message state. Do **not** scrape rendered DOM text unless a missing event forces it. This materially reduces coupling to UI markup.


## Community evidence: Android background survival and extension scope

Research follow-up on 2026-09-29 clarified the distinction between a SillyTavern UI extension and a native app.

### "Independent narrator" means a normal SillyTavern UI extension unless explicitly stated otherwise

The proposed independent narrator/player is still installed through SillyTavern's Extensions panel (stacked-blocks/cube UI), exactly like other third-party UI extensions. It is JavaScript/HTML/CSS loaded inside the SillyTavern web page. It can create its own UI, dialogs, audio elements, Web Audio graph, Media Session handlers, and subscribe to SillyTavern events. It does **not** need to be a separate Android app.

Official extension docs confirm UI extensions can add/change behavior, and current official/community examples include:
- Dynamic Audio
- Live2D / VRM
- EmulatorJS
- Screen Share
- Guinevere UI (direct custom HTML/CSS/JavaScript)
- Code Runner

References:
- https://docs.sillytavern.app/extensions/
- https://docs.sillytavern.app/for-contributors/writing-extensions/
- https://github.com/SillyTavern/SillyTavern-Content/blob/main/extensions.json

Important limit: because the extension shares the browser page/WebView lifecycle, it is frozen/discarded together with that page. A larger UI extension improves TTS state/queue UX but does not become a native Android background service.

### Community workarounds for mobile background generation

Repeated Android user reports (2025-2026) describe the same failure: generation aborts when the browser is backgrounded or the screen locks.

Commonly reported mitigations:
1. Set the browser (and Termux if local) to unrestricted/background battery usage.
2. Try a browser less aggressively suspended by the device/OEM. Community reports mention Opera and Hermit positively on some devices; results vary.
3. Use SillyTavern's official Silence Player extension.
4. Keep SillyTavern visibly active with split-screen or Android floating-window mode.
5. Increase screen timeout / prevent screen lock for long generations.
6. For stronger reliability, move to a native/wrapped client (e.g. TauriTavern) rather than a normal browser tab.

Community references:
- https://www.reddit.com/r/SillyTavernAI/comments/1jqetc7/
- https://www.reddit.com/r/SillyTavernAI/comments/1smvyr4/
- https://www.reddit.com/r/SillyTavernAI/comments/1unyn1c/
- https://www.reddit.com/r/SillyTavernAI/comments/1u5uqiy/

There is no universal browser-only fix in these reports. Device/OEM behavior varies significantly.

### Existing SillyTavern issue confirms focus/background abort

Issue #2690 reported that on Android Firefox, merely losing focus caused inference to abort. It was later closed as inactive/not planned:
https://github.com/SillyTavern/SillyTavern/issues/2690

Feature request #4007 proposed moving chat-generation ownership to the SillyTavern backend so that it could keep buffering the model response while a mobile client disconnects, then resynchronize on reconnect. It describes exactly the architectural remedy for background mobile interruption but was closed as not planned:
https://github.com/SillyTavern/SillyTavern/issues/4007

### "Play music continuously" has real browser-level basis, but is still only a mitigation

Chrome's documented background rules are important:

- A page that has made actual sound within the past 30 seconds gets minimal timer throttling.
- A **silent** audio track specifically does not count as actual sound for this timer exemption.
- Chrome's Page Lifecycle heuristics state that pages observed **playing audio** or using **WebRTC** are less likely to be frozen/discarded, except under extreme resource pressure.

References:
- https://developer.chrome.com/blog/timer-throttling-in-chrome-88
- https://developer.chrome.com/docs/web-platform/page-lifecycle-api/

Therefore an always-playing **actual low-volume audio/BGM** track is technically more meaningful than a mathematically silent track, and the idea is worth A/B testing. However this is not a guarantee against Android/OEM process killing.

Do not silently introduce fake audible noise to production. If tested, make it an explicit diagnostic/experimental mode.

### PWA is not equivalent to a native foreground service

Installing SillyTavern as a PWA improves launcher/fullscreen UX but does not fundamentally free the page from browser lifecycle limits. Community reports say Hermit/PWA can extend background survival, but durations vary.

Web background APIs/service workers also do not provide a general solution for keeping an arbitrary long-lived streaming chat request running forever. Background Sync is not intended for long-running streaming tasks.

Reference:
https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation

### Native implementations show the robust architecture

TauriTavern's current frontend-host contract keeps chat-completion sessions in the Rust/native process, not the WebView. The frontend consumes sequenced events and can replay missing events after WebView suspension as long as the native process/session survives.

Reference:
https://github.com/Darkatse/TauriTavern/blob/main/docs/FrontendHostContract.md

Its releases also explicitly mention improved Android/iOS background keep-alive:
https://github.com/Darkatse/TauriTavern/releases

This is the architecture class required for genuinely stronger background generation. Merely packaging the same browser page in a WebView wrapper does not automatically provide the same guarantee; the task itself has to be owned outside the WebView.

### Development implication

Keep the project options clearly separated:

A. Thin MultiTTS provider:
- smallest code;
- uses SillyTavern native TTS semantics;
- best compatibility, weakest control over queue/resume.

B. Independent narrator **UI extension**:
- still installed from SillyTavern Extensions;
- can own segmentation, 5-wide preloading, ordered playback, true pause/resume, Media Session, diagnostics;
- can use SillyTavern eventSource instead of DOM scraping;
- still shares browser/WebView lifecycle.

C. Native/background-capable client or companion:
- generation/audio task ownership outside WebView;
- substantially larger scope;
- relevant only if reliable screen-off/background operation is a hard requirement.

