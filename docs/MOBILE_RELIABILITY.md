# Mobile Reliability Boundary

## 1. Separate the two problems

### Problem A — LLM generation survival

If Chrome/Android closes the browser connection, SillyTavern may abort upstream generation through request-socket close handlers.

A narration extension cannot fix this.

### Problem B — narration continuity

Once final text exists, Narrator can materially improve:

- preloading;
- ordered playback;
- pause/resume;
- stale-audio cancellation;
- recovery after ordinary page return.

This is the product scope.

## 2. Chrome lifecycle

A mobile page can progress through:

- active;
- passive/hidden;
- frozen;
- discarded.

While frozen, freezable JavaScript work is suspended.

When discarded or the process is killed, extension runtime no longer exists.

Therefore:

- "works after switching apps" and
- "guaranteed after lock screen / OS kill"

are not equivalent requirements.

## 3. Audio as a practical mitigation

Active media playback often improves a page's chance of remaining active, but it is not a service-level guarantee.

SillyTavern maintains an official Silence Player extension specifically as a background-tab mitigation. It should be treated as optional environment support, not a dependency of Narrator.

Narrator should not secretly run an endless silent track in v2 alpha.

## 4. Battery/background settings

Documentation/testing should instruct users to evaluate:

- browser battery optimization;
- browser background activity restrictions;
- MultiTTS battery/background restrictions;
- OEM-specific task killing.

The extension cannot change those settings.

## 5. Media Session

Media Session may improve OS-level media controls and help the browser classify the page as active media.

Use it where available, but:

- feature detect;
- do not rely on it for correctness;
- do not equate it with a foreground service.

## 6. Native escalation path

If the future product requirement becomes:

> generation and narration must continue reliably after the browser is backgrounded, locked, or suspended

then the correct architecture is outside a browser-only extension.

Candidate layer:

- Android native wrapper/companion;
- Foreground Service;
- task ownership outside WebView;
- explicit IPC/event bridge back to SillyTavern UI.

TauriTavern demonstrates this class of architecture by placing Android generation work under a native foreground service rather than trusting WebView lifetime.

That is a separate product, not v2 Narrator scope.

## 7. Required background test matrix

Every release candidate must record results for:

- same tab foreground;
- different browser tab;
- browser background/home;
- another app foreground;
- screen locked;
- 1 minute hidden;
- 5 minutes hidden;
- 15 minutes hidden where practical.

For each case separately record:

- did LLM generation finish?
- did MultiTTS localhost remain alive?
- did current audio keep playing?
- did next prepared segment start?
- did controller recover correctly on return?

Do not collapse those into one "background works" checkbox.
