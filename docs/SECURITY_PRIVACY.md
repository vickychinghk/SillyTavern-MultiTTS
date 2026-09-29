# Security and Privacy

## 1. Data classification

Narrated assistant text is private chat content.

Treat every synthesis request as sensitive user data.

## 2. Default data path

Expected normal path:

```text
remote SillyTavern page
  -> browser JavaScript builds local media URL
  -> 127.0.0.1:8774
  -> MultiTTS
  -> MultiTTS-selected upstream
```

Narrator itself should not introduce another remote service.

## 3. Endpoint policy

Default endpoint is loopback.

If user chooses a non-loopback endpoint:

- show a privacy warning;
- make the choice explicit;
- do not attach host credentials;
- do not assume TLS or trustworthiness.

## 4. Logging

Production logs must never include:

- chat text;
- query strings containing text;
- signed upstream URLs;
- cookies;
- authentication tokens;
- voice-provider secrets.

Allowed diagnostics:

- text length;
- segment count;
- segment length;
- timings;
- state transitions;
- media error code;
- endpoint origin/host after redaction of query.

## 5. Persistence

Do not duplicate full chat content in localStorage/IndexedDB.

Checkpoint stores identifiers, hash and playback position only.

The canonical text remains in SillyTavern.

## 6. Network APIs

Normal product must not require:

- `/voices`;
- CORS-readable `/forward`;
- server-side proxy;
- third-party analytics.

## 7. Content URL handling

Never print a full `/forward?text=...` URL to logs.

If a debug report needs the endpoint, report only base endpoint plus parameter names/lengths.

## 8. Custom endpoint injection

All query parameters must be constructed through URL APIs, not string concatenation.

Text must be encoded once.

Do not permit arbitrary header/script injection through endpoint settings.

## 9. Supply-chain surface

Keep dependency count near zero.

A browser extension of this size should prefer platform APIs and SillyTavern host APIs over npm runtime dependencies.

Any future dependency must justify:

- security exposure;
- bundle size;
- maintenance;
- browser compatibility.

## 10. No telemetry by default

No remote telemetry is planned for v2 alpha/beta.

If crash analytics is ever proposed, it requires a separate privacy decision and explicit opt-in design.
