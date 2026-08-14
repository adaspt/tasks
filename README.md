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

The gate keys off **having completed a sync**, not off holding a valid token — keying
it to the token would lock you out every hour when one expires. Once lists exist
locally the app opens straight into Today, whether or not it can currently reach
Google.

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
says so, and how many changes are waiting. Ordinary pending changes are not announced:
they clear within seconds of an edit, and a banner that appeared on every keystroke
would teach you to ignore it. The header keeps a plain refresh control, so a sync can
always be forced.

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

No backend. Authentication is browser-side Google OAuth (Google Identity Services),
which means an access token good for about an hour and no refresh token.

The token is cached, and **a new one is only ever requested from a tap**. Both follow
from the same awkward detail: the GIS token client always opens a popup window, even
when it could issue a token silently — it opens one and closes it again. Requesting a
token on load would flash a popup on every launch, and doing it from a background
timer would flash one at random. So a page load inside the token's lifetime talks to
Google not at all, and once it expires the app says "Not connected" and waits to be
tapped.

The cost is an access token sitting in IndexedDB, where a successful XSS could read
it. It is scoped to Tasks alone and expires within the hour.

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
only exists once it is installed.

And it defaults everything to `no-cache`, overriding that for the content-hashed
`/assets/**` which can never go stale. Note the default has to be a catch-all: Firebase
matches header rules against the *request* path rather than the file eventually served,
so a rule for `/index.html` never fires for `/` or `/today`. Getting this wrong leaves
an installed app serving a stale service worker, unaware a deploy happened. Where two
rules match, the later one wins.

Every origin the app is served from must be an authorized JavaScript origin on the
OAuth client, including `https://<project>.web.app` and
`https://<project>.firebaseapp.com`. Firebase preview channels get their own URLs, so
sign-in does not work on them; only `main` is deployed, to `live`.

App icons are generated from `public/icon.svg`:

```sh
rsvg-convert -w 192 -h 192 public/icon.svg -o public/icon-192.png
rsvg-convert -w 512 -h 512 public/icon.svg -o public/icon-512.png
```

Requires a Google Cloud OAuth client (Web application type) with the local dev origin
and the deployed origin registered as authorized JavaScript origins, and the
`https://www.googleapis.com/auth/tasks` scope.

The project can stay in Testing mode with your own account as a test user. The scope is
classed as sensitive, so publishing would otherwise require verification.
