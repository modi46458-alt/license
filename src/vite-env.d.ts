/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** License server origin, e.g. https://license.example.com (set at build time). */
  readonly VITE_LICENSE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
