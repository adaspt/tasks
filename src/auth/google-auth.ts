/**
 * Browser-side Google OAuth, via the Google Identity Services token client.
 *
 * With no backend there is nowhere safe to keep a refresh token, so this holds
 * a ~1 hour access token in memory and asks for a new one when it expires.
 * Nothing is persisted: an access token in localStorage would outlive the tab
 * for no benefit, since it expires anyway and can always be re-requested.
 *
 * Failing to get a token is *not* an error state for the app. Everything reads
 * from Dexie, so a missing token only means syncing is deferred.
 */

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
const SCOPE = 'https://www.googleapis.com/auth/tasks'
const GIS_SRC = 'https://accounts.google.com/gsi/client'

/** Renew this far ahead of expiry, so a sync can't start on a dying token. */
const REFRESH_MARGIN_MS = 60_000

/* --- the sliver of GIS we use --------------------------------------------- */

interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void
}

interface GisErrorEvent {
  type?: string
  message?: string
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string
            scope: string
            callback: (response: TokenResponse) => void
            error_callback?: (error: GisErrorEvent) => void
          }): TokenClient
          revoke(token: string, done?: () => void): void
        }
      }
    }
  }
}

export class AuthError extends Error {
  /** True when only a user gesture can fix this — i.e. show a sign-in button. */
  readonly needsInteraction: boolean

  constructor(message: string, needsInteraction = true) {
    super(message)
    this.name = 'AuthError'
    this.needsInteraction = needsInteraction
  }
}

/* --- state ---------------------------------------------------------------- */

export interface AuthState {
  /** `unknown` until the first token attempt resolves either way. */
  status: 'unknown' | 'signed-in' | 'signed-out'
  expiresAt: number | null
}

let accessToken: string | null = null
let expiresAt = 0
let snapshot: AuthState = { status: 'unknown', expiresAt: null }
const listeners = new Set<() => void>()

function publish(status: AuthState['status']) {
  snapshot = { status, expiresAt: accessToken ? expiresAt : null }
  for (const listener of listeners) listener()
}

export function subscribeToAuth(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getAuthSnapshot(): AuthState {
  return snapshot
}

/* --- script loading ------------------------------------------------------- */

let gisScript: Promise<void> | null = null

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  if (gisScript) return gisScript

  gisScript = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GIS_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => {
      // Offline, most likely. Retryable, so don't cache the rejection.
      gisScript = null
      reject(new AuthError('Could not reach Google to sign in', false))
    }
    document.head.appendChild(script)
  })

  return gisScript
}

/* --- token requests ------------------------------------------------------- */

let tokenClient: TokenClient | null = null
let pending: { resolve: (token: string) => void; reject: (error: Error) => void } | null = null
let inFlight: Promise<string> | null = null

async function ensureTokenClient(): Promise<TokenClient> {
  if (!CLIENT_ID) {
    throw new AuthError('VITE_GOOGLE_CLIENT_ID is not set — see the README', false)
  }
  await loadGis()

  const oauth2 = window.google?.accounts?.oauth2
  if (!oauth2) throw new AuthError('Google Identity Services did not load', false)

  tokenClient ??= oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPE,
    callback: (response) => {
      if (response.access_token) {
        accessToken = response.access_token
        expiresAt = Date.now() + (response.expires_in ?? 3600) * 1000
        publish('signed-in')
        pending?.resolve(response.access_token)
      } else {
        publish('signed-out')
        pending?.reject(new AuthError(response.error_description ?? response.error ?? 'Sign-in failed'))
      }
      pending = null
    },
    // Fires when the popup is blocked or dismissed, where `callback` never runs.
    error_callback: (error) => {
      publish('signed-out')
      pending?.reject(new AuthError(error.message ?? error.type ?? 'Sign-in was dismissed'))
      pending = null
    },
  })

  return tokenClient
}

/**
 * `prompt: ''` means "don't ask unless you have to". With an active Google
 * session and a previous grant it resolves without any UI; otherwise it opens
 * the consent popup, which browsers only allow during a user gesture. That is
 * the whole difference between this succeeding in the background and needing
 * the sign-in button.
 */
function requestToken(): Promise<string> {
  if (inFlight) return inFlight

  const request = (async () => {
    const client = await ensureTokenClient()
    return new Promise<string>((resolve, reject) => {
      pending = { resolve, reject }
      client.requestAccessToken({ prompt: '' })
    })
  })()

  inFlight = request
  void request.catch(() => {}).then(() => {
    if (inFlight === request) inFlight = null
  })

  return request
}

/** A valid token, renewing if needed. Throws rather than returning null. */
export async function getAccessToken(): Promise<string> {
  if (accessToken && Date.now() < expiresAt - REFRESH_MARGIN_MS) {
    return accessToken
  }
  return requestToken()
}

/** Interactive sign-in. Must be called from a user gesture, or the popup dies. */
export async function signIn(): Promise<void> {
  await requestToken()
}

export function signOut(): void {
  const current = accessToken
  accessToken = null
  expiresAt = 0
  publish('signed-out')
  if (current) window.google?.accounts.oauth2.revoke(current)
}
