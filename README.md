# Tasks

A personal task app for Android, backed by Google Tasks.

It is a thin client, not a new task system. Every task lives in Google Tasks and stays
fully usable from the official Google app — this is just a better way to *look* at
them. Notifications, sharing, and everything else remain Google's job.

## Why

Google Tasks stores tasks perfectly well but shows them badly. Its lists are flat,
its date handling is an afterthought, and there is no way to say "not yet, but don't
let me forget". This app replaces the views, keeps the storage.

## The model

A task has a **start date**, meaning *the day it should start bothering me*. That is
the only date. There is no separate deadline, because Google Tasks only has one date
field, and start date is the more useful of the two — it also means Google's own
notifications fire on the day the task becomes relevant.

A task is either **high priority** or normal. Nothing in between.

Everything else — title, notes, list, checklist — is ordinary Google Tasks data.

## Views

Three views, no configuration, no custom filters.

| View        | Contains                       | Sorted by                     |
| ----------- | ------------------------------ | ----------------------------- |
| **Today**   | start date today or in the past | high priority first, then date |
| **Later**   | start date in the future        | date                          |
| **Backlog** | no start date                   | high priority first            |

**Today** is the opening screen. **Later** is a flat list sorted by date — no day
headers, no grouping.

Overdue tasks are not pulled out into their own section — they just show their date in
red and sort naturally. If something has been red for weeks, the answer is to move it
to Backlog, not to shout about it.

Any view can be filtered to a single list. For now task rows carry no list indicator of
their own, and filtering is how you find out where something lives; showing list names
on rows is a likely later addition. Nothing is colour-coded by list — the red on an
overdue date is the only colour in the app that carries meaning.

**Subtasks never appear in these views.** Checklists exist, but they belong to their
parent task and are only visible when you open it. A parent shows a small `3/5` badge
so you can tell at a glance that a checklist is there.

## Done

Completing a task makes it vanish from the other views, so **Done** exists to undo
that. It lists the last hundred completed tasks, newest first. Restoring one leaves its
start date untouched, so it returns to whichever view it came from.

It is a view like the others — same shell, same list filter — differing only in that
its rows offer restore instead of complete, and that nothing can be added to it. That
last part is in the types rather than a comment: quick-add takes an `AddableViewId`,
which is every view except this one.

## Adding and editing

Quick-add sits above the navigation. **The view supplies the start date**, which keeps
a date picker out of the common case entirely: added in Today means today, in Later
means tomorrow, in Backlog means no date at all. Typing `! Buy milk` sets priority,
the same convention as everywhere else.

New tasks go to whichever list is currently filtered, and to your Google default list
when the filter is off. The input names the destination so it is never a guess.

Tapping a task opens a sheet holding everything else: start date, priority, notes,
delete, and the checklist. Snoozing something is just changing its start date, which
with one date per task is a single field write.

## Mapping onto Google Tasks

The Google Tasks API has no priority field, no start date, and no concept of stars
(the star in Google's own app is not exposed to the API at all). Two conventions
bridge the gap:

**Priority is a `!` prefix on the title.** `! Renew passport` is high priority. The
app strips the prefix for display and re-adds it when saving. This was chosen over
hidden metadata because it works in both directions — you can set priority from the
official Google app by typing the same prefix, and it survives on every device without
any syncing of its own.

**Start date is Google's `due` field.** The API only records the date, never the time.

Dates are therefore **floating** `YYYY-MM-DD` strings and must never be
timezone-converted. Google returns `due` as something like `2026-08-13T00:00:00.000Z`,
and putting that through a `Date` gives the wrong day for anyone not on UTC. Compare
the date substring against the local date and nothing else.

Consequence: don't use Google's star. The API can't see it, so it would be a second,
invisible notion of "important".

## First run

Signing in is required before the app can be used at all. Until it has synced there
are no task lists, and a task cannot be created without a list to put it in.

The gate keys off **having completed a sync**, not off holding a valid token. Access
tokens come and go — they last an hour and are replaced in the background — so gating
on one would throw you back to a sign-in screen with a database full of your tasks
sitting right there. Once lists exist locally the app opens straight into Today,
whether or not it can currently reach Google.

## Offline

The phone is the only device that writes, so the app is optimistic and simple.

IndexedDB (via Dexie) is the source of truth for reading. Every change is written
locally first and pushed immediately if the network allows; if it doesn't, the row
keeps a dirty flag and goes out with the next sync. There is no queue table — the
pending set is just a query over flagged rows.

Each row carries a local uuid as its primary key plus a nullable `remoteId`. The local
id never changes, so nothing has to be rewritten when a task is created for the first
time, and a row with no `remoteId` can be deleted without ever contacting the server.

Pulling uses `updatedMin` with a watermark derived from the highest `updated`
timestamp the server returned — a server clock compared against itself, so device
clock drift can't silently drop changes. Once a week the app does a full pull instead,
which catches deletions whose tombstones Google has already purged.

Conflicts resolve in one rule: a locally modified task wins and gets pushed; anything
else is overwritten from the server. A task deleted on the server stays deleted.

When work is not reaching Google — no valid token, or a sync that failed — a banner
says so, and how many changes are waiting. It sits at the bottom, directly above the
add row, and the whole bar reconnects when tapped: the banner exists to be tapped, and
the bottom of a phone is where tapping is cheap. Ordinary pending changes are not
announced: they clear within seconds of an edit, and a banner that appeared on every
keystroke would teach you to ignore it. The header keeps a plain refresh control, so a
sync can always be forced.

## Non-goals

- **Notifications.** Google Tasks already does this.
- **Recurring tasks.** Not exposed by the API. Repeating tasks created in Google's app
  show up here as ordinary tasks.
- **Times of day.** The Tasks API cannot store them, so a task is never more precise
  than a day.
- **Desktop.** Other devices use the official Google Tasks app.
- **Multiple users, sharing, collaboration.**

## Planned

**Calendar events**, read-only, in a compact strip above the tasks in Today and Later —
never interleaved with them, since tasks have no time of day. Designed but deliberately
deferred: it is the one feature the app does not need in order to be useful.

The sketch, so it does not have to be rederived: every calendar with `selected` set, a
rolling 14-day window fetched with `singleEvents=true`, declined events always hidden,
no colour-coding. Replace the window wholesale on each refresh rather than syncing
incrementally — Calendar sync tokens require identical query parameters on every
request, which a rolling window breaks by definition. Adding it means adding the
`calendar.readonly` scope, and therefore one re-consent.

Also likely: **list names on task rows**, and **search**, once the backlog is big enough
to need it.

## Stack

Vite · TypeScript · TanStack Router · Tailwind · shadcn/ui · Dexie · vite-plugin-pwa

One backend endpoint, and only for authentication. Everything else is browser-side.

Google issues refresh tokens only to a client that can keep a secret, which a browser
cannot — so `functions/` holds a single Cloud Function that owns the OAuth exchange.
Sign-in is a full-page redirect to Google; the callback seals the refresh token with
AES-256-GCM and puts it in an httpOnly cookie. There is no database: one user means
one token, and the cookie is where it lives. Chrome caps cookie lifetime at 400 days,
which is the real re-authentication interval.

That cookie is named `__session` because it has to be. Firebase Hosting strips every
other cookie from requests before they reach the backend, so that static responses stay
cacheable at the CDN — and it does not touch responses, so `Set-Cookie` appears to work
perfectly while the function never sees anything come back. The sign-in CSRF state
therefore shares the same cookie, as a sealed JSON blob.

`/api/token` trades that cookie for a fresh access token. Because it is an ordinary
same-origin fetch rather than a popup, renewal needs no user gesture and can happen on
a background sync — which is the entire point. The earlier browser-only setup used the
GIS token client, whose popup could only be opened from a tap, so an expired token
meant tapping "Connect" about once an hour.

Access tokens are held in memory only. They last an hour and cost one request to
replace, so persisting them would trade a real XSS exposure for nothing.

There is no CORS header on `/api`, and the cookie is `SameSite=Lax`. Together those
are the CSRF defence: a hostile page cannot make the browser send the cookie, and
could not read the response if it did.

A missing or expired token never blocks use. The app stays fully readable and
editable, and defers syncing until it has one.

## Development

```sh
npm install
npm run dev     # http://localhost:5173
npm run build
npm test
npm run lint
```

`npm run dev` alone serves the app but not `/api`, so anything touching sign-in needs
the functions emulator alongside it. Vite proxies `/api` there, deliberately without
`changeOrigin` — the function derives its OAuth redirect URI from the incoming host,
and rewriting that host produces a URI Google has never heard of.

```sh
cd functions && npm install && npm run serve
```

**The auth path cannot be fully trusted locally.** Nothing sits in front of the function
in the emulator, whereas in production Firebase Hosting rewrites the `Host` header and
strips cookies. Both of those broke sign-in in ways no local run could reproduce. Treat
a working emulator as necessary, not sufficient.

`src/routeTree.gen.ts` is generated by the TanStack Router plugin whenever Vite
runs, and is committed so a fresh checkout builds without a Vite run first —
`npm run build` starts with `tsc`, which would otherwise fail on the missing
file. Don't edit it by hand; adding or renaming a route rewrites it.

Tests cover the parts with real edge cases — floating dates, the `!` title
convention, and the view filters and sort orders. There are no component tests.

## Deployment

Firebase Hosting, in the same Google Cloud project as the OAuth client, so there is
one project rather than two. Pushing to `main` runs lint, tests and the build, and
deploys only if all three pass — a broken build should not reach the phone that holds
the only copy of anything unsynced.

`firebase.json` does two things that matter. It rewrites everything to `index.html`,
because `/today` is a route rather than a file and the service worker's own fallback
only exists once it is installed. Ahead of that sits a rewrite of `/api/**` to the
function — order matters, since the first matching rewrite wins and `**` matches
everything.

And it defaults everything to `no-cache`, overriding that for the content-hashed
`/assets/**` which can never go stale. Note the default has to be a catch-all: Firebase
matches header rules against the *request* path rather than the file eventually served,
so a rule for `/index.html` never fires for `/` or `/today`. Getting this wrong leaves
an installed app serving a stale service worker, unaware a deploy happened. Where two
rules match, the later one wins — which is also how `/api/**` gets `no-store`, a
stronger claim than `no-cache` and the right one for a response carrying a token.

The function is pinned to the hosting release (`pinTag`), which keeps the two rolling
forward and back together. The practical consequence: **deploying functions alone
changes nothing users hit** — hosting keeps serving the previously pinned revision until
hosting is redeployed too. Deploy both, always.

A green deploy is also not proof the function shipped. Firebase skips functions whose
source hash is unchanged and still reports success, logging only
`Skipped (No changes detected)`.

App icons are generated from `public/icon.svg`:

```sh
rsvg-convert -w 192 -h 192 public/icon.svg -o public/icon-192.png
rsvg-convert -w 512 -h 512 public/icon.svg -o public/icon-512.png
```

## Setting it up from scratch

**Billing.** Cloud Functions needs the Blaze plan. Real usage sits inside the free tier
— the endpoint is called about once an hour while the app is open — but Blaze has no
hard spending cap, so pair it with a budget alert. `maxInstances: 1` on the function is
the other half of that guard.

**OAuth client**, Web application type, scope `https://www.googleapis.com/auth/tasks`.
Its id is a constant in `functions/src/index.ts` — public by design, since it reaches
the browser in the redirect either way, and protected by the registered origins rather
than by being hidden. The client *secret* is the half that matters, and that lives only
in Secret Manager. The client needs both:

- *Authorized JavaScript origins* — every origin the app is served from.
- *Authorized redirect URIs* — the same origins plus `/api/auth/callback`, and
  `http://localhost:5173/api/auth/callback` for the emulator.

Unrecognised hosts fall back to the canonical origin rather than being trusted, so a
spoofed `x-forwarded-host` can only ever name a URI Google already accepts. It also
means Firebase preview channels, which get their own URLs, bounce sign-in back to the
live site. Only `main` is deployed, to `live`.

**Publishing status must be "In production", not "Testing".** This is the one setting
the whole design hangs on: an external-audience app in Testing issues refresh tokens
that expire in *exactly seven days*, so the entire backend would buy nothing. Published
but unverified is fine for a single user — you get the "Google hasn't verified this app"
interstitial once at consent, and a cap of 100 users. The scope is classed as sensitive,
so full verification would mean a demo video and a privacy policy for no benefit here.

**Two secrets** in Secret Manager, neither of which belongs in the repo:

```sh
firebase functions:secrets:set GOOGLE_CLIENT_SECRET
openssl rand -base64 32 | firebase functions:secrets:set TOKEN_ENC_KEY --data-file -
```

Google no longer lets you view an existing client secret, so unless it was saved at
creation, add a new one on the OAuth client — both can be active at once, so there is no
downtime. Rotating `TOKEN_ENC_KEY` invalidates the cookie and costs one sign-in.

**CI service account** needs, beyond what `firebase init` grants: Service Account User
(to deploy a function that runs as the compute service account), Artifact Registry
Administrator, and Secret Manager *Viewer* — Viewer rather than Admin deliberately, since
Admin can read secret values and CI only needs to confirm a binding exists.
