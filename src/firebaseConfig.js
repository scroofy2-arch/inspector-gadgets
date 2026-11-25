/**
 * Firebase web config.
 *
 * >>> CONFIG PLACEHOLDER — DO NOT COMMIT REAL KEYS <<<
 *
 * The Firebase project for this hackathon entry is created separately.
 * Fill in the config by copying `.env.example` to `.env.local` and setting
 * the VITE_FIREBASE_* variables from the Firebase console
 * (Project settings > Your apps > Web app). The values are public web-app
 * identifiers (not secrets), but keep them out of source control anyway.
 *
 * If no config is present, the app renders a setup screen and never
 * initializes Firebase (same pattern as the ATLAS Explain entry).
 */

const env = import.meta.env;

export const FIREBASE_CONFIG = {
  apiKey: env.VITE_FIREBASE_API_KEY || "",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || "",
  projectId: env.VITE_FIREBASE_PROJECT_ID || "",
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: env.VITE_FIREBASE_APP_ID || "",
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID || "",
};

/** reCAPTCHA Enterprise site key for App Check (production). Optional in dev. */
export const RECAPTCHA_SITE_KEY = env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY || "";

/** Optional App Check debug token, only honoured in dev (see README). */
export const APPCHECK_DEBUG_TOKEN = env.VITE_APPCHECK_DEBUG_TOKEN || "";

export function isFirebaseConfigured() {
  return Boolean(
    FIREBASE_CONFIG.apiKey &&
      FIREBASE_CONFIG.projectId &&
      FIREBASE_CONFIG.appId
  );
}
