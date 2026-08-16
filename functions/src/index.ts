/**
 * The only server this app has: it holds the Google refresh token, and hands
 * the browser a short-lived access token on demand.
 *
 * Why it exists at all: a refresh token can only be obtained with a client
 * secret, and there is nowhere in a browser to keep one. Without it the app is
 * limited to the ~1 hour access tokens the Google Identity Services token
 * client issues, which means tapping "Connect" roughly once an hour forever.
 *
 * There is no database. One user means one refresh token, so the token itself
 * — sealed with AES-256-GCM — travels in an httpOnly cookie. A cookie jar
 * lifted off the device is inert without the server key, and the page's own
 * JavaScript cannot read it at any point. Chrome caps cookie lifetime at 400
 * days, and that is the real re-authentication interval.
 */

import { onRequest } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import type { Request } from 'firebase-functions/v2/https'
import crypto from 'node:crypto'

/**
 * The Express response the handler is given. Read off onRequest's own signature
 * rather than imported from `@types/express`: firebase-functions ships a nested
 * copy of those types, and adding a second top-level copy yields two
 * structurally identical `Response` types that TypeScript refuses to unify.
 */
type Response = Parameters<Parameters<typeof onRequest>[0]>[1]

const clientSecret = defineSecret('GOOGLE_CLIENT_SECRET')
const encKey = defineSecret('TOKEN_ENC_KEY')

/**
 * Public by design — it already ships inside the browser bundle, so there is
 * nothing gained by hiding it here. The *secret* is the half that matters, and
 * that one lives in Secret Manager and never touches the repo.
 */
const CLIENT_ID = '604708647169-g1qknpd8rvaiq2revd28ncrt2u48q5pk.apps.googleusercontent.com'

const SCOPE = 'https://www.googleapis.com/auth/tasks'
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'

const RT_COOKIE = 'rt'
const STATE_COOKIE = 'oauth_state'
const RT_MAX_AGE_S = 400 * 24 * 60 * 60 // Chrome's ceiling; longer is silently clamped.
const STATE_MAX_AGE_S = 600

/* --- sealing --------------------------------------------------------------- */

/** `iv.tag.ciphertext`, all base64url. */
function seal(plain: string, keyB64: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'), iv)
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString('base64url')).join('.')
}

/** Returns null rather than throwing: a malformed cookie is just "signed out". */
function unseal(sealed: string, keyB64: string): string | null {
  try {
    const parts = sealed.split('.')
    if (parts.length !== 3) return null
    const [iv, tag, body] = parts.map((p) => Buffer.from(p, 'base64url'))
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'), iv!)
    decipher.setAuthTag(tag!)
    return Buffer.concat([decipher.update(body!), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

/* --- request helpers ------------------------------------------------------- */

/** Every origin registered as a redirect URI on the OAuth client. */
const ALLOWED_ORIGINS = [
  'https://tasks-505418.web.app',
  'https://tasks-505418.firebaseapp.com',
]

const CANONICAL_ORIGIN = ALLOWED_ORIGINS[0]!

/**
 * The origin the user is actually on, which is *not* simply the Host header.
 *
 * Hosting forwards to Cloud Run with Host set to the function's own run.app
 * name — with pinTag, a per-revision one — and building a redirect_uri from
 * that earns a redirect_uri_mismatch from Google, since no such URI is or could
 * usefully be registered. The original host arrives in x-forwarded-host.
 *
 * Anything unrecognised falls back to the canonical origin rather than being
 * trusted: a spoofed header can then only ever produce a URI Google already
 * accepts, never a new one.
 */
function originOf(req: Request): string {
  const host = req.get('x-forwarded-host') ?? req.get('host') ?? ''

  // The emulator behind Vite's proxy, where there is no TLS to speak of.
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return `http://${host}`

  const candidate = `https://${host}`
  return ALLOWED_ORIGINS.includes(candidate) ? candidate : CANONICAL_ORIGIN
}

function isSecure(req: Request): boolean {
  return originOf(req).startsWith('https://')
}

function cookie(
  name: string,
  value: string,
  opts: { maxAge: number; secure: boolean },
): string {
  const bits = [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    // Lax, not Strict: the OAuth callback arrives as a cross-site top-level
    // navigation from accounts.google.com, and Strict would withhold the state
    // cookie exactly when it is needed to verify.
    'SameSite=Lax',
    `Max-Age=${opts.maxAge}`,
  ]
  // Omitted over plain HTTP, or the emulator could never set a cookie at all.
  if (opts.secure) bits.push('Secure')
  return bits.join('; ')
}

function readCookie(req: Request, name: string): string | null {
  const header = req.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return null
}

/** Only same-origin paths, so `?return=` can never become an open redirect. */
function safeReturnPath(raw: unknown): string {
  if (typeof raw !== 'string') return '/'
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/'
  return raw
}

interface FormResult {
  ok: boolean
  body: TokenBody
}

async function postForm(url: string, form: Record<string, string>): Promise<FormResult> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  })
  return { ok: res.ok, body: (await res.json().catch(() => ({}))) as TokenBody }
}

interface TokenBody {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

/* --- routes ---------------------------------------------------------------- */

/**
 * Sends the browser to Google's consent screen.
 *
 * `access_type=offline` is what earns a refresh token at all, and
 * `prompt=consent` forces a fresh one — Google only returns a refresh token on
 * the first authorization otherwise, so a re-auth after revocation would
 * silently come back with an access token and nothing to renew it with.
 */
function authStart(req: Request, res: Response): void {
  const state = crypto.randomBytes(16).toString('hex')
  const returnTo = safeReturnPath(req.query.return)

  const url = new URL(AUTH_URL)
  url.searchParams.set('client_id', CLIENT_ID)
  url.searchParams.set('redirect_uri', `${originOf(req)}/api/auth/callback`)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', SCOPE)
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('state', `${state}:${returnTo}`)

  res.setHeader('Set-Cookie', cookie(STATE_COOKIE, state, {
    maxAge: STATE_MAX_AGE_S,
    secure: isSecure(req),
  }))
  res.redirect(302, url.toString())
}

async function authCallback(req: Request, res: Response): Promise<void> {
  const raw = typeof req.query.state === 'string' ? req.query.state : ''
  const separator = raw.indexOf(':')
  const state = separator === -1 ? raw : raw.slice(0, separator)
  const returnTo = separator === -1 ? '/' : safeReturnPath(raw.slice(separator + 1))

  const expected = readCookie(req, STATE_COOKIE)
  if (!state || !expected || state !== expected) {
    res.status(400).send('Sign-in could not be verified. Please try again.')
    return
  }

  const code = req.query.code
  if (typeof code !== 'string') {
    // The user declined at the consent screen, most likely.
    res.redirect(302, returnTo)
    return
  }

  const exchanged = await postForm(TOKEN_URL, {
    code,
    client_id: CLIENT_ID,
    client_secret: clientSecret.value(),
    redirect_uri: `${originOf(req)}/api/auth/callback`,
    grant_type: 'authorization_code',
  })

  if (!exchanged.ok || !exchanged.body.refresh_token) {
    res
      .status(502)
      .send('Google did not return a refresh token. Please try signing in again.')
    return
  }

  res.setHeader('Set-Cookie', [
    cookie(RT_COOKIE, seal(exchanged.body.refresh_token, encKey.value()), {
      maxAge: RT_MAX_AGE_S,
      secure: isSecure(req),
    }),
    cookie(STATE_COOKIE, '', { maxAge: 0, secure: isSecure(req) }),
  ])
  res.redirect(302, returnTo)
}

/**
 * The endpoint the app actually lives on. No CORS headers anywhere here: a
 * hostile page cannot read the response, and SameSite=Lax already withholds the
 * cookie from cross-site fetches. That combination is the CSRF defence — do not
 * add `Access-Control-Allow-Origin` to make some debugging easier.
 */
async function mintToken(req: Request, res: Response): Promise<void> {
  res.setHeader('Cache-Control', 'no-store')

  const sealed = readCookie(req, RT_COOKIE)
  const refreshToken = sealed ? unseal(sealed, encKey.value()) : null
  if (!refreshToken) {
    res.status(401).json({ error: 'not_connected' })
    return
  }

  const refreshed = await postForm(TOKEN_URL, {
    client_id: CLIENT_ID,
    client_secret: clientSecret.value(),
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })

  if (!refreshed.ok || !refreshed.body.access_token) {
    // invalid_grant means revoked, password-changed, or expired for good. The
    // cookie is dead weight from here, so drop it and make the app ask again.
    if (refreshed.body.error === 'invalid_grant') {
      res.setHeader('Set-Cookie', cookie(RT_COOKIE, '', { maxAge: 0, secure: isSecure(req) }))
      res.status(401).json({ error: 'invalid_grant' })
      return
    }
    res.status(502).json({ error: refreshed.body.error ?? 'refresh_failed' })
    return
  }

  res.status(200).json({
    access_token: refreshed.body.access_token,
    expires_in: refreshed.body.expires_in ?? 3600,
  })
}

async function signOut(req: Request, res: Response): Promise<void> {
  const sealed = readCookie(req, RT_COOKIE)
  const refreshToken = sealed ? unseal(sealed, encKey.value()) : null

  res.setHeader('Set-Cookie', cookie(RT_COOKIE, '', { maxAge: 0, secure: isSecure(req) }))

  if (refreshToken) {
    // Best effort: the cookie is already gone, so a failure here is not worth
    // reporting to a user who has, from their side, signed out.
    await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken }).toString(),
    }).catch(() => undefined)
  }

  res.status(204).send('')
}

/* --- entry ----------------------------------------------------------------- */

export const api = onRequest(
  {
    region: 'us-central1',
    secrets: [clientSecret, encKey],
    // A hard ceiling on what a runaway loop can cost. One user needs exactly
    // one instance, and queueing beats a surprise bill.
    maxInstances: 1,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (req, res) => {
    // Hosting passes the original path through, so `/api` is still on the front
    // of it. The emulator, hit directly, is not — hence the tolerant strip.
    const path = req.path.replace(/^\/api/, '') || '/'

    try {
      switch (path) {
        case '/auth/start':
          authStart(req, res)
          return
        case '/auth/callback':
          await authCallback(req, res)
          return
        case '/token':
          await mintToken(req, res)
          return
        case '/auth/signout':
          await signOut(req, res)
          return
        default:
          res.status(404).json({ error: 'not_found' })
      }
    } catch (error) {
      console.error('api error', path, error)
      if (!res.headersSent) res.status(500).json({ error: 'internal' })
    }
  },
)
