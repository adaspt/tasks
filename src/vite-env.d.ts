/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /**
   * OAuth client id for the Google Identity Services token client. Public by
   * design — a web OAuth client id is not a secret, it is protected by the
   * authorized JavaScript origins on the client, not by being hidden.
   */
  readonly VITE_GOOGLE_CLIENT_ID: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
