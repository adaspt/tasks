/**
 * Browser-side Google OAuth, via the Google Identity Services token client.
 *
 * With no backend there is nowhere safe to keep a refresh token, so this works
 * with the ~1 hour access token GIS hands out.
 *
 * Two rules keep it from being irritating:
 *
 * 1. The token is **persisted**, so a page load inside its lifetime needs no
 *    call to Google at all. This matters because the GIS token client always
 *    opens a popup window — even when it could issue the token silently, it
 *    opens one and closes it again, which flashes on screen every single load.
 *
 * 2. A token is **only ever requested from a user gesture**. Nothing in the
 *    background asks for one. When the cached token expires the app says "Not
 *    connected" and waits to be tapped, rather than throwing up a popup on its
 *    own schedule.
 *
 * The cost of persisting is that an access token sits in IndexedDB where a
 * successful XSS could read it. It is scoped to Tasks alone and expires within
 * the hour, which for a single-user personal app is the better trade against a
 * popup on every launch.
 *
 * Failing to get a token is *not* an error state. Everything reads from Dexie,
 * so no token only means syncing is deferred.
 */

import { db, getMeta, setMeta } from '@/db/db'

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

const TOKEN_KEY = 'googleAccessToken'

interface StoredToken {
  accessToken: string
  expiresAt: number
}

function isUsable(): boolean {
  return accessToken !== null && Date.now() < expiresAt - REFRESH_MARGIN_MS
}

/** Reads the cached token once per page load. Later calls join the first. */
let restoring: Promise<void> | null = null

function restoreToken(): Promise<void> {
  restoring ??= (async () => {
    const stored = await getMeta<StoredToken>(TOKEN_KEY)

    if (stored && Date.now() < stored.expiresAt - REFRESH_MARGIN_MS) {
      accessToken = stored.accessToken
      expiresAt = stored.expiresAt
      publish('signed-in')
      return
    }

    if (stored) await db.meta.delete(TOKEN_KEY)
    publish('signed-out')
  })()

  return restoring
}

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
        void setMeta(TOKEN_KEY, { accessToken, expiresAt } satisfies StoredToken)
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

/**
 * The cached token, or an error. Deliberately never asks Google for a new one:
 * that call opens a popup, and every caller here is a background sync. When
 * this throws, the app carries on from Dexie and the UI offers a reconnect.
 */
export async function getAccessToken(): Promise<string> {
  await restoreToken()
  if (isUsable()) return accessToken as string
  throw new AuthError('Not connected to Google')
}

/** True without any network call, so callers can skip a doomed sync. */
export async function canSyncNow(): Promise<boolean> {
  await restoreToken()
  return isUsable()
}

/**
 * Interactive sign-in — the only thing that talks to GIS. Must be called from
 * a user gesture: the popup is blocked otherwise, and it is the whole reason
 * nothing else is allowed to trigger this.
 */
export async function signIn(): Promise<void> {
  await requestToken()
}

export function signOut(): void {
  const current = accessToken
  accessToken = null
  expiresAt = 0
  void db.meta.delete(TOKEN_KEY)
  publish('signed-out')
  if (current) window.google?.accounts.oauth2.revoke(current)
}
