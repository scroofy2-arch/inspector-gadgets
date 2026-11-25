/**
 * Firebase AI Logic hybrid wiring for Seeking Tools.
 *
 * Docs:
 *   Get started (web hybrid):  https://firebase.google.com/docs/ai-logic/hybrid/web/get-started
 *   Configuration options:      https://firebase.google.com/docs/ai-logic/hybrid/web/configuration-options
 *   Structured output:          https://firebase.google.com/docs/ai-logic/hybrid/web/generate-structured-output
 *
 * API surface used (verified against those docs, SDK firebase@13.3.0):
 *   getAI(app, { backend: new GoogleAIBackend() })
 *   getGenerativeModel(ai, { mode, inCloudParams, onDeviceParams })
 *   InferenceMode: PREFER_ON_DEVICE | ONLY_ON_DEVICE | PREFER_IN_CLOUD | ONLY_IN_CLOUD
 *   model.initializeDeviceModel(progressCallback)  — call after a user gesture,
 *     before generateContent; progress is a 0..1 fraction.
 *   model.generateContent(prompt) -> result.response.text(),
 *     result.response.inferenceSource ("ON_DEVICE" | "IN_CLOUD")
 *
 * Routing (see src/tools.js):
 *   local tools  -> PREFER_ON_DEVICE (Gemini Nano first, cloud fallback)
 *   cloud tools  -> PREFER_IN_CLOUD  (Gemini Flash first, device fallback)
 *   private-only -> ONLY_ON_DEVICE  (never leaves the device; throws if Nano
 *     is unavailable — the UI reports that honestly)
 *   input > LOCAL_MAX_CHARS -> forced to cloud (Nano context ~9,216 tokens)
 */

import { initializeApp } from "firebase/app";
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
} from "firebase/app-check";
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
} from "firebase/ai";

import {
  FIREBASE_CONFIG,
  RECAPTCHA_SITE_KEY,
  isFirebaseConfigured,
} from "./firebaseConfig.js";
import { ANALYSIS_SCHEMA, LOCAL_MAX_CHARS, buildPrompt } from "./tools.js";

export const CLOUD_MODEL = "gemini-3.5-flash-lite"; // SDK 13 default fallback model

let firebaseApp = null;
let ai = null;
const modelCache = new Map();

export function isConfigured() {
  return isFirebaseConfigured();
}

/** Initialize Firebase + AI Logic. Returns false when no config is present. */
export function initFirebase() {
  if (!isFirebaseConfigured()) return false;
  if (firebaseApp) return true;

  firebaseApp = initializeApp(FIREBASE_CONFIG);
  initAppCheck(firebaseApp);
  ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });
  return true;
}

/**
 * App Check: the Firebase console's AI Logic setup workflow enforces it.
 * Local dev uses the debug provider (register the printed token in the
 * console: Security > App Check > Apps > Manage debug tokens). Production
 * uses a score-based reCAPTCHA Enterprise key. Without either, cloud calls
 * are rejected when enforcement is on — see README.
 */
function initAppCheck(app) {
  try {
    if (import.meta.env.DEV) {
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
      initializeAppCheck(app, { isTokenAutoRefreshEnabled: true });
      return;
    }
    if (RECAPTCHA_SITE_KEY) {
      initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_SITE_KEY),
        isTokenAutoRefreshEnabled: true,
      });
      return;
    }
    console.warn(
      "[Seeking Tools] App Check is not configured; cloud calls may be rejected while App Check is enforced. See README."
    );
  } catch (err) {
    console.warn("[Seeking Tools] App Check setup failed (continuing):", err);
  }
}

const SYSTEM_PROMPT =
  "You are the Silence Listener inside Seeking Tools, an investigation workbench. " +
  "Question every narrative, even official ones, and look at what is NOT confirmed. " +
  "Distinguish what the text actually says from what it implies. " +
  "Report only what the text supports; mark anything you cannot verify as unconfirmed. " +
  "Be specific and concrete. Answer with JSON only, matching the provided schema. No markdown, no extra text.";

function modelParams(mode) {
  return {
    mode,
    inCloudParams: {
      model: CLOUD_MODEL,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: ANALYSIS_SCHEMA,
      },
    },
    onDeviceParams: {
      createOptions: {
        expectedInputs: [{ type: "text", languages: ["en"] }],
        expectedOutputs: [{ type: "text", languages: ["en"] }],
        initialPrompts: [
          {
            role: "system",
            content: [{ type: "text", value: SYSTEM_PROMPT }],
          },
        ],
      },
      promptOptions: {
        responseConstraint: ANALYSIS_SCHEMA,
      },
    },
  };
}

function getModel(mode) {
  if (!ai) throw new Error("Firebase AI Logic is not initialized.");
  if (!modelCache.has(mode)) {
    modelCache.set(mode, getGenerativeModel(ai, modelParams(mode)));
  }
  return modelCache.get(mode);
}

function modeUsesDevice(mode) {
  return (
    mode === InferenceMode.PREFER_ON_DEVICE ||
    mode === InferenceMode.ONLY_ON_DEVICE
  );
}

/**
 * Run one tool on the pasted text.
 *
 * @param {object} tool - a tool definition from src/tools.js
 * @param {string} text - the pasted text to investigate
 * @param {object} opts - { privateOnly: boolean, onProgress: (fraction|null) => void }
 * @returns {Promise<{ data, inferenceSource, mode, forcedCloud }>}
 *   inferenceSource is "ON_DEVICE" or "IN_CLOUD" (docs) — normalized here
 *   to "on_device" | "in_cloud" for display.
 */
export async function analyze(tool, text, opts = {}) {
  const { privateOnly = false, onProgress = () => {} } = opts;
  const forcedCloud = text.length > LOCAL_MAX_CHARS;

  let mode;
  if (privateOnly && !forcedCloud) {
    mode = InferenceMode.ONLY_ON_DEVICE;
  } else if (forcedCloud) {
    // Long input does not fit Gemini Nano's ~9,216-token context.
    mode = InferenceMode.ONLY_IN_CLOUD;
  } else if (tool.route === "local") {
    mode = InferenceMode.PREFER_ON_DEVICE;
  } else {
    mode = InferenceMode.PREFER_IN_CLOUD;
  }

  const model = getModel(mode);

  // initializeDeviceModel must run after a user gesture (the Run click) and
  // before generateContent. Awaiting it surfaces download progress; if the
  // device model is unavailable, PREFER_* modes fall back to the cloud and
  // ONLY_ON_DEVICE throws, which the caller reports honestly.
  if (modeUsesDevice(mode)) {
    onProgress(0);
    await model.initializeDeviceModel((val) => onProgress(val));
    onProgress(null);
  }

  const prompt = buildPrompt(tool, text);
  const result = await model.generateContent(prompt);
  const response = result.response;

  const rawSource = String(response.inferenceSource || "").toUpperCase();
  const inferenceSource =
    rawSource === "ON_DEVICE" ? "on_device" : "in_cloud";

  let data;
  try {
    data = JSON.parse(response.text());
  } catch (err) {
    throw new Error(
      `The model did not return valid JSON (${err.message}). Raw output: ${response.text().slice(0, 500)}`
    );
  }

  return { data, inferenceSource, mode, forcedCloud };
}
