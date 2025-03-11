/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BASE_URL: string;
  readonly VITE_ANOTHER_ENV_VAR?: string; // Add other env vars here
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
