/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SECRET_KEY: string | undefined
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
