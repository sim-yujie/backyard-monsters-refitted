/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute server origin, or empty/undefined for same-origin via the dev proxy. */
  readonly VITE_SERVER_URL?: string;
  /** Client build string used as the `:apiVersion` path segment. */
  readonly VITE_API_VERSION?: string;
  /**
   * Cloudflare Turnstile site key for the sign-up form's bot check, or empty for
   * none. Exposed without the VITE_ prefix by `envPrefix` in vite.config.ts.
   */
  readonly TURNSTILE_SITE_KEY?: string;
  /** Where the sign-up form's Terms link goes. */
  readonly VITE_TERMS_URL?: string;
  /** Where the sign-up form's Privacy Policy link goes. */
  readonly VITE_PRIVACY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
