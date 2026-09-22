# Tennis AI Vision + IMU HUD

Browser HUD for a XIAO nRF52840/LSM6DS3 tennis sensor, MediaPipe pose tracking, and optional JEV swing classification.

## JEV setup

The browser calls `/api/jev`; the API key stays in the Vercel serverless function. Node.js 20 or newer is required by `@typesafe-ai/sdk`.

```powershell
npm install
Copy-Item .env.example .env
```

Set `TYPESAFE_API_KEY` in `.env` for local serverless development and in the Vercel project's environment variables for deployment. Do not put the key in `app.js`, `jev-service.js`, or any browser-visible variable.

Run through Vercel so `/api/jev` is available:

```powershell
npx vercel dev
```

Open the URL printed by Vercel. A plain static server still works, but JEV requests fall back to the existing local classifier because it has no `/api/jev` function.

## Behavior

Each impact updates Peak G, Max Gyro, Racket Speed, and Racket Face immediately. JEV then evaluates five questions in one request: stroke type, junk motion, contact quality, face advice, and whether the event should count.

- Confidence above `0.8`: use the JEV stroke automatically.
- Confidence from `0.5` through `0.8`: display the stroke with `?`.
- Confidence below `0.5`: retain the local classifier.
- Every BLE impact increments Total Hits immediately, exactly as in offline mode.
- JEV refines stroke type and coaching only; its junk and count answers never remove sensor-detected hits.
- MediaPipe stroke side is authoritative. Signed sensor angles are folded before JEV classification, so flipping the racket to its opposite face does not change the model input.
- Offline, missing API configuration, or failed fetch: use the local classifier at zero API cost.

The browser and server each cap JEV work at eight concurrent requests. HTTP 429 and 529 responses use exponential backoff.

## Contact quality estimate

The 20-byte firmware packet adds two compact post-impact measurements while preserving the existing field offsets:

- Bytes 8-9: vibration decay time in milliseconds
- Byte 18: torsional gyro kick in 4 deg/s steps
- Byte 19: residual vibration in 0.02 G steps

The firmware samples for 120 ms after impact. The browser combines torsional kick, residual vibration, and decay time into a session-relative score:

- `75-100`: Centered
- `50-74`: Near Center
- `0-49`: Off Center

The first five hits establish the racket/player baseline. Confidence increases after that learning period. Impacts at or above `15.5 G` are marked lower-confidence because the accelerometer may clip at its `16 G` range.

This is an IMU-only estimate of centered contact, not an exact ball coordinate. Racket construction, string tension, dampeners, grip, and sensor mounting affect the vibration signature. Clearing the session log also resets the learned contact baseline.

## Cost

JEV input costs `$0.042` per million tokens and output is free. At the estimated request size, one swing costs about `$0.0000126`. The `$5` free credit covers roughly `120M` input tokens, or approximately `500,000` swings.

## Test 10 simulated swings

The test mocks `/api/jev`, so it uses no API key or credits. It sends ten swings concurrently and verifies the eight-request limit, answer shape, latency, model, and token metadata.

```powershell
npm test
```

For an end-to-end live test, start `npx vercel dev`, connect the BLE sensor, perform ten swings, and confirm Total Hits changes only for responses where `should_count >= 0.8`.
