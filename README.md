# Seeking Tools — Hybrid AI Investigation Workbench

Entry for Google's **#BuildHybridAI 2026** hackathon (Devpost).
Deadline: **Monday, November 30, 2026, 5:00 PM EST**.

## What it is

An investigation workbench for questioning narratives. Paste a claim, a news
story, or a corporate statement, pick a tool, and get a structured analysis:

| Tool | What it does | Routing |
| --- | --- | --- |
| **Silence Listener** | What is NOT said / what is missing | Quick check · on-device first |
| **Omission Reading** | Claims vs. evidence gaps | Quick check · on-device first |
| **Damage-Control Reader** | Deflection, minimization, framing | Deep synthesis · cloud first |
| **Question Everything** | The hard questions the narrative does not answer | Deep synthesis · cloud first |

Every analysis visibly shows **which path actually ran** — `ON-DEVICE · Gemini Nano`
(nothing left the device) or `IN-CLOUD · Gemini Flash` — via
`result.response.inferenceSource`. Transparency is the point: the user always
knows where their text went.

A **Private only** toggle forces `ONLY_ON_DEVICE` so the text never leaves
the device; it fails honestly if Gemini Nano is unavailable. Past analyses
are kept only in the browser (localStorage); nothing is uploaded.

## How the hybrid inference works

All AI inference runs through **Firebase AI Logic** — no other model APIs
are called.

- Backend: `getAI(app, { backend: new GoogleAIBackend() })` (Gemini Developer API).
- Quick tools use `InferenceMode.PREFER_ON_DEVICE`; deep tools use
  `InferenceMode.PREFER_IN_CLOUD`; Private only uses `ONLY_ON_DEVICE`.
- Both paths return the **same JSON schema** (see `src/tools.js`):
  - cloud: `inCloudParams.generationConfig` with
    `responseMimeType: "application/json"` and `responseSchema`
  - on-device: `onDeviceParams.promptOptions.responseConstraint` with the
    same schema
- Cloud model: `gemini-3.5-flash-lite` (the SDK 13 default).
- `model.initializeDeviceModel(progress)` is called from the Run click
  (Chrome requires a user gesture) before `generateContent()`.
- Inputs over 5,000 characters are forced to the cloud: Gemini Nano's
  context is about 9,216 tokens.

Reference implementation pattern: ATLAS Explain
(`#BuildHybridAI 2026` entry) — it names the path that ran and keeps private
notes on-device only. Seeking Tools follows the same pattern.

## Requirements

- Node.js 20+ (developed on Node 24)
- A Firebase project (Spark plan is enough) with AI Logic set up
- Desktop Chrome 139+ with the Prompt API flag, for the on-device path:
  `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` → Enabled,
  then restart Chrome. The first run downloads the Gemini Nano model
  (several minutes); check with `await LanguageModel.availability()` in
  DevTools.

## Setup

1. **Firebase project** (created separately — do not commit real keys):
   - Create a project in the [Firebase console](https://console.firebase.google.com).
   - Register a **Web** app and copy its config.
   - Open **AI Services → AI Logic** and finish **Get started** with the
     **Gemini Developer API** (free, no billing). Leave App Check enforced.

2. **Config**:
   ```sh
   cp .env.example .env.local
   # fill in the VITE_FIREBASE_* values from the console
   ```

3. **Install and run**:
   ```sh
   npm install
   npm run dev        # http://127.0.0.1:5173
   npm run build      # production build into dist/
   npm run preview    # serve the production build locally
   ```

4. **App Check (local dev)**: the AI Logic setup workflow enforces App Check.
   In dev the app uses the debug provider. On first load, open DevTools and
   copy the printed `AppCheck debug token`, then register it in the console
   (Security → App Check → Apps → Manage debug tokens) and reload. Cloud
   calls stay blocked until the token is registered. For production, create a
   score-based reCAPTCHA Enterprise key and set
   `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`.

## Known limits (from the Firebase docs)

- On-device inference is **Desktop Chrome 139+ only**; it is not available
  on mobile or other browsers. The app falls back to the cloud there and
  says so on the badge.
- On-device supports **single-turn text generation only** (no chat), text
  and JPEG/PNG image input, and structured JSON/enum output. No tools,
  function calling, grounding, audio/video/PDF input, or image generation
  on-device.
- `countTokens` is unreliable across the two paths and is not used.
- On-device model download needs storage space and a first-run download.
- Temperature is not sent: the SDK marks it unsupported on Gemini 3.x+.

## Files

| File | What it does |
| --- | --- |
| `package.json` | `firebase@13.3.0` + Vite; `dev` / `build` / `preview` scripts |
| `index.html` | Single-page UI: input, tool cards, private toggle, results, log |
| `src/styles.css` | Dark, readable, mobile-friendly styling |
| `src/firebaseConfig.js` | **Config placeholder** — reads `VITE_FIREBASE_*` env vars; setup check |
| `src/tools.js` | The 4 tools, their prompts, the shared JSON schema, routing labels |
| `src/analyze.js` | Firebase AI Logic wiring: getAI, getGenerativeModel, initializeDeviceModel, generateContent, inferenceSource |
| `src/main.js` | UI wiring, result cards, path badge, localStorage findings log |
| `.env.example` | Config variable names (copy to `.env.local`) |

## Status / not yet verified

- The code is syntax-checked and builds with Vite, but **live inference has
  not been run**: it needs a real Firebase project config (being created
  separately) and Desktop Chrome 139+ with the Prompt API flag for the
  on-device path.
- `inferenceSource` values are documented as `ON_DEVICE` / `IN_CLOUD`; the
  code normalizes case defensively.
- No auth and no database in v1 (localStorage only). App Check is wired for
  dev (debug provider) and production (reCAPTCHA Enterprise key) — see
  Setup step 4.
