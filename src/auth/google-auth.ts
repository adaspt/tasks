/**
 * Google access tokens, obtained from this app's own `/api/token` endpoint.
 *
 * The refresh token lives on the server in an httpOnly cookie, so renewing is
 * an ordinary same-origin fetch: no popup, no user gesture, nothing for the
 * page's JavaScript to leak. Renewal can therefore happen on a background sync
 * trigger, which is the entire point — signing in stops being an hourly ritual
 * and becomes something that happens roughly once a year.
 *
 * Access tokens are held in memory only. They last about an hour and cost one
 * request to replace, so persisting them would trade a real XSS exposure for
 * nothing worth having.
 *
 * Failing to get a token is *not* an error state. Everything reads from Dexie,
 * so no token only means syncing is deferred.
 */

/** Renew this far ahead of expiry, so a sync can't start on a dying token. */
const REFRESH_MARGIN_MS = 60_000

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

/**
 * Set only when the server has said the grant is gone. Kept separate from
 * "we have no token right now", because those need opposite responses: the
 * first needs the user, the second just needs a fetch.
 */
let needsConsent = false

let snapshot: AuthState = { status: 'unknown', expiresAt: null }
const listeners = new Set<() => void>()

function isUsable(): boolean {
  return accessToken !== null && Date.now() < expiresAt - REFRESH_MARGIN_MS
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

/* --- token requests ------------------------------------------------------- */

interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
}

let inFlight: Promise<string> | null = null

async function fetchToken(): Promise<string> {
  let response: Response
  try {
    response = await fetch('/api/token', {
      // The whole mechanism is the cookie; an omitted credential mode would
      // silently make every request anonymous.
      credentials: 'same-origin',
      cache: 'no-store',
    })
  } catch {
    // Offline, or the function is unreachable. Retryable without the user.
    throw new AuthError('Could not reach the server', false)
  }

  if (response.status === 401) {
    needsConsent = true
    publish('signed-out')
    throw new AuthError('Not connected to Google')
  }

  if (!response.ok) {
    // A 5xx is the server's problem, not a missing grant — don't send the user
    // through a consent screen that would not fix anything.
    throw new AuthError('Could not refresh access', false)
  }

  const body = (await response.json()) as TokenResponse
  if (!body.access_token) throw new AuthError('Could not refresh access', false)

  accessToken = body.access_token
  expiresAt = Date.now() + (body.expires_in ?? 3600) * 1000
  needsConsent = false
  publish('signed-in')
  return body.access_token
}

/** Shared so a burst of sync triggers makes one request, not five. */
function requestToken(): Promise<string> {
  if (inFlight) return inFlight

  const request = fetchToken()
  inFlight = request
  void request.catch(() => {}).then(() => {
    if (inFlight === request) inFlight = null
  })

  return request
}

/** The cached token, or a fresh one. Throws when the app must ask the user. */
export async function getAccessToken(): Promise<string> {
  if (isUsable()) return accessToken as string
  return requestToken()
}

/**
 * Whether a sync is worth starting, without a network call.
 *
 * Optimistic by design: it only says no once the server has actually reported a
 * dead grant. Being wrong costs one failed request, whereas being pessimistic
 * would leave a perfectly good session unsynced.
 */
export async function canSyncNow(): Promise<boolean> {
  return isUsable() || !needsConsent
}

/**
 * Interactive sign-in — a full-page navigation to Google, which means this
 * never returns. Nothing may be scheduled after awaiting it.
 *
 * A redirect rather than a popup: popups need a live user gesture and get
 * blocked in installed PWAs, and there is no longer any reason to use one now
 * that the server owns the exchange.
 */
export async function signIn(returnTo?: string): Promise<never> {
  const target = returnTo ?? window.location.pathname + window.location.search
  window.location.assign(`/api/auth/start?return=${encodeURIComponent(target)}`)

  // Unloading is not instant; resolving here would let callers run code that is
  // about to be thrown away mid-flight.
  return new Promise<never>(() => {})
}

export async function signOut(): Promise<void> {
  accessToken = null
  expiresAt = 0
  needsConsent = true
  publish('signed-out')
  await fetch('/api/auth/signout', { method: 'POST', credentials: 'same-origin' }).catch(
    () => undefined,
  )
}
