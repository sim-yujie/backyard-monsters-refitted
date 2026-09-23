/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute server origin, or empty/undefined for same-origin via the dev proxy. */
  readonly VITE_SERVER_URL?: string;
  /** Client build string used as the `:apiVersion` path segment. */
  readonly VITE_API_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
