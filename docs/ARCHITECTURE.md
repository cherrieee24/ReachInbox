# Architecture Notes

Working notes for the ReachInbox Email Scheduler. Updated as features land.

## Current state

- Full dashboard UI on a reusable design system.
- Real Google OAuth 2.0 sign-in, with users persisted in PostgreSQL via Prisma.
- Full relational schema: users, senders, email jobs, recipients, Slack links.
- REST API: campaigns, recipient lists, file validation, dashboard stats — all
  Zod-validated, all scoped to the authenticated user.
- BullMQ scheduler: one delayed job per recipient, with retries, backoff,
  graceful drain and restart recovery.
- Distributed throttle: per-sender hourly limit and minimum spacing, enforced
  by atomic Redis Lua scripts.
- Elasticsearch search over scheduled and sent email, with a database fallback.
- Slack OAuth v2 with encrypted token storage and rate-limit notifications.
- Bull Board queue monitoring at /admin/queues, behind role-based authorization.
- Frontend fully connected to the API via TanStack Query; no fixture data left.
- Docker Compose skeleton for PostgreSQL, Redis and Elasticsearch.

Every area listed above is implemented and covered by tests.

## Components

| Area           | Approach                                                       |
| -------------- | -------------------------------------------------------------- |
| Scheduling     | **Done** — BullMQ delayed jobs on Redis. No cron, anywhere.      |
| Persistence    | **Done** — PostgreSQL via Prisma ORM; the source of truth.       |
| Email delivery | **Done** — Nodemailer over Ethereal only. Never a real SMTP.     |
| Search         | **Done** — Elasticsearch index over email recipients.           |
| Auth           | **Done** — Google OAuth 2.0 sign-in, Slack OAuth v2 install.     |
| Frontend data  | **Done** — TanStack Query over a shared Axios client.            |

## Backend layering

`routes → controllers → services → models/integrations`

Controllers stay thin: parse and validate input, delegate to a service, shape
the response. Services hold business logic and are the only layer that talks to
Prisma, queues, or third-party integrations.

## Session design

The session is a JWT in an httpOnly, `SameSite=Lax` cookie rather than a token
in `localStorage`:

- XSS cannot read an httpOnly cookie, so a script injection cannot exfiltrate
  the session.
- `SameSite=Lax` still permits the top-level OAuth callback redirect to carry
  the cookie, while blocking cross-site POSTs.
- `secure` is enabled in production, and `trust proxy` is set so it works behind
  a load balancer.

`requireAuth` re-reads the user from the database on every request, so a deleted
user is rejected immediately rather than at token expiry. The trade-off is one
query per authenticated request; if that becomes hot, cache it in Redis rather
than trusting the token alone.

The CSRF defence on the OAuth round trip is a random `state` stored in its own
short-lived cookie and compared with `timingSafeEqual`.

## Data model

```
User ─┬─< Sender ──< EmailJob >── (sender, RESTRICT)
      ├─< EmailJob ──< EmailRecipient
      ├─< EmailRecipient        (denormalised userId)
      └─< SlackConnection
```

Deliberate choices:

- **`EmailRecipient.idempotencyKey` is globally unique.** This is what makes
  delivery exactly-once: a redelivered job finds the key taken and stops rather
  than emailing the person twice. It is the schema's single most important
  constraint, and it works whether the duplicate comes from a queue retry, a
  crashed worker, or a manual replay.
- **`userId` is denormalised onto `EmailRecipient`.** One redundant column buys
  user-scoped history queries that never join. Verified at 4,000 rows: both
  "scheduled by user" and "sent by user" are index-only, no sort, ~0.02 ms.
- **`EmailJob.senderId` is `RESTRICT`, not `CASCADE`.** Deleting a sender must
  not erase the record of what it sent. Everything owned by a user cascades.
- **Counters (`sentCount`, `failedCount`) live on the job.** A campaign list
  should never aggregate over millions of recipient rows.
- **Recipient rows are pre-computed with their own `scheduledAt`.** The
  durable schedule exists before any queue does, so BullMQ becomes a projection
  of the database rather than the source of truth — a Redis flush costs
  throughput, never data.

Secrets in the database (`Sender.password`, `SlackConnection.accessToken`,
`SlackConnection.webhookUrl`) are encrypted with AES-256-GCM before they are
written, and decrypted only at the moment of use. Values are stored as
`v1:iv:tag:ciphertext`; the version prefix leaves room to rotate the scheme
without having to guess at old rows, and the GCM tag makes tampering fail
loudly rather than silently decrypting to garbage. The key comes from
`ENCRYPTION_KEY`.

## Scheduling

```
API → PostgreSQL → BullMQ queue → Redis → worker → mail transport → PostgreSQL
```

Every send is one BullMQ **delayed job**, its delay being the distance from now
to that recipient's own `scheduledAt`. Nothing polls the database. There is no
cron, `setInterval`, or repeatable job anywhere — the only `setTimeout` calls in
the codebase are shutdown watchdogs.

**Redis holds ids, never content.** A job payload is exactly
`{ emailRecipientId, emailJobId, userId, senderId }`; the worker loads the
subject, body, address and sender from PostgreSQL. Redis is not encrypted at
rest and is routinely dumped for debugging, so no message content or credential
is written to it.

**Two layers of idempotency.** The BullMQ job id *is* the recipient's
`idempotencyKey`, so Redis rejects a duplicate enqueue outright. Because a
crash can still redeliver an existing job, the worker also claims each row with
a conditional `UPDATE ... WHERE status IN ('PENDING','SCHEDULED')` — only one
worker can win, so a given address is emailed exactly once.

**Writes commit before enqueue.** PostgreSQL is the source of truth and Redis
is a projection of it. If enqueueing fails, the rows survive and are recovered;
the reverse order would risk a job pointing at a row that was never written.

**Restart behaviour.** Delayed jobs live in Redis with AOF persistence, so they
survive a restart on their own. `recoverPendingSends()` runs once at boot as
reconciliation — not a scheduler — and re-enqueues anything the database still
considers pending. It is a no-op in the normal case and earns its keep when
Redis was flushed or the process died between commit and enqueue. Because the
job id is the idempotency key, recovery cannot duplicate work: a campaign
resumes where it stopped instead of restarting.

**Shutdown order** on SIGTERM/SIGINT: HTTP server (no new work) → worker drain
(finish in-flight sends) → queue and Redis → PostgreSQL last, since the earlier
steps still write to it. A 30-second watchdog forces exit if draining stalls.

## Email delivery

Ethereal is the **only** transport. It is a capture-only sandbox: it accepts a
message, publishes it at a preview URL, and never delivers to a real inbox.
There is no production SMTP code path, so a stray campaign cannot reach a real
person — a property worth keeping until sending is genuinely wanted.

Credentials come from `ETHEREAL_HOST` / `PORT` / `USER` / `PASSWORD`. Leaving
user and password blank provisions a throwaway account at first send and logs
it, so a fresh clone works without setup; filling them in keeps one account
across restarts.

**Multiple senders.** Transporters are cached per `Sender.id`. A sender row may
carry its own SMTP settings, and anything it omits falls back to the shared
account — so each identity can have its own mailbox without a code change. The
sender is always resolved from the database and always scoped to the
authenticated user; naming another user's sender returns `SENDER_NOT_FOUND`.

**On success** the recipient stores `sentAt`, `providerMessageId` and
`previewUrl`. The preview URL is surfaced through the API for development and
demos.

**Idempotency is enforced in the database, not just the queue.** The job id
being the idempotency key stops a duplicate *enqueue*, but a crashed or stalled
worker can still have its job redelivered with the original id. The processor
therefore re-reads the row and returns early when the status is already `SENT`.
Verified by force-enqueueing delivered sends under fresh job ids — both were
skipped, and `providerMessageId` and `sentAt` were unchanged.

## Throttling

The full algorithm is in the README and in `rateLimiter.service.ts`. The
decisions worth recording:

- **Redis, not memory.** An in-memory counter is wrong the moment a second
  worker exists and resets on restart — which would hand out a fresh budget
  every deploy. Verified: the counter survived a SIGTERM/restart cycle at 10/10
  and granted no extra sends.
- **One Lua script per decision.** Check-then-reserve as two round trips is a
  race. Folding both into one script makes the outcome exact under contention:
  500 concurrent acquires against a limit of 100 granted exactly 100, and three
  separate worker *processes* sharing a budget of 10 sent exactly 10.
- **Keyed by sender, not user or campaign.** Deliverability reputation belongs
  to the sending mailbox, so that is the thing worth protecting. A user running
  three campaigns from one sender shares one budget, which is the correct
  behaviour.
- **Defer, never fail.** Hitting a limit is an expected condition, not an
  error. Throwing would consume a BullMQ retry attempt and eventually mark a
  perfectly good email as permanently failed.
- **Slots are released on send failure**, so a retry is not charged twice
  against the hourly budget.
- **Deferral lands one minute into the next window** rather than exactly on the
  boundary, so a small clock skew between instances cannot land a job in the
  window it was just rejected from.

## Search indexing

```
PostgreSQL (truth) ──write──> Elasticsearch (projection) ──read──> /emails/search
        └────────────────── fallback read ─────────────────────────────┘
```

- **The index is never authoritative.** Every document can be rebuilt from
  PostgreSQL by `npm run search:reindex`, so a lost cluster costs query
  performance and nothing else.
- **Indexing is fire-and-forget.** It happens after a campaign is scheduled,
  after each send resolves, and after a cancellation. A failed index write is
  logged and dropped rather than propagated — an unreachable search cluster
  must never fail a send that already happened.
- **Every failure path degrades rather than breaks.** `withSearch()` wraps each
  call with a fallback value, and a circuit breaker skips the cluster for a
  cooldown after a failure so a hard-down cluster is not retried on every
  request. Search itself falls back to a `LIKE` query against PostgreSQL, which
  is slower but keeps the feature working.
- **Health treats search as non-critical**: `/api/health` reports it, but only
  the database and Redis can mark an instance unhealthy.
- **Isolation is a mandatory filter**, not a post-filter: `userId` is a `term`
  filter on every query, sourced from the session.

## Slack

The install is OAuth v2 with the same CSRF pattern as Google sign-in: a random
state in a short-lived httpOnly cookie, compared with `timingSafeEqual`. The
state also carries the user id, because Slack sends the browser back on a fresh
navigation and the callback must know whose connection it is.

Notifications prefer the **incoming webhook** Slack returns at install time
over `chat.postMessage`, because the webhook is bound to the channel the
installer chose and needs no channel membership — one fewer way for an alert to
silently not arrive. `chat.postMessage` with the bot token is the fallback.

Two properties matter more than the feature itself:

- **One alert per sender per hour.** A full window defers every remaining
  email, so a naive implementation would post one message per deferred
  recipient. `SET NX` on `slack_notified:{senderId}:{window}` means exactly one
  caller wins, however many workers are running. Verified: 6 deferred emails
  produced exactly 1 Slack request.
- **Slack can never break sending.** `notify()` catches everything and returns
  a boolean; the worker calls it fire-and-forget. A disconnected workspace, a
  revoked token or a Slack outage is logged and ignored. Verified by triggering
  the limit with Slack disconnected: 3 sent, 6 deferred, zero errors, worker
  alive.

A `token_revoked` or `account_inactive` response marks the connection REVOKED
so a dead install is not retried forever. Disconnecting sets the same status
rather than deleting the row, keeping the audit trail of who connected what.

## Queue monitoring

Bull Board is a viewer over the real `Queue` instance, not a second source of
truth — it opens no separate bookkeeping and stores nothing. Two details worth
recording:

- **Authorization is a distinct layer from authentication.** `requireAdmin`
  runs after `requireAuth` and checks `req.user.role`. It returns 403 rather
  than 404, unlike campaign lookups: the existence of the dashboard is not a
  secret, and a signed-in user is better told they lack access than shown a
  confusing not-found.
- **CSP is relaxed for that path only.** Bull Board ships inline styles and
  scripts that the default policy blocks. Rather than weakening helmet
  globally, the middleware picks a CSP-free instance for `/admin/queues` and
  the strict one everywhere else.

`ADMIN_EMAILS` is a bootstrap for the first administrator — it promotes on
sign-in and never demotes, so removing an address is not a silent revoke.

## Consistency model

**PostgreSQL is the source of truth. Redis holds queue state and is a
projection.** Losing Redis costs throughput; it never costs data, because
`recoverPendingSends()` rebuilds the queue from the database at boot.

Four guarantees, each enforced by a database or Redis primitive rather than by
application state — nothing here relies on an in-memory variable, so every
property survives a restart and holds across multiple processes:

| Guarantee | Mechanism |
| --------- | --------- |
| A recipient is enqueued once | BullMQ job id **is** `EmailRecipient.idempotencyKey`; Redis rejects a duplicate add |
| A recipient is sent at most once | Conditional `UPDATE` lease on the row; terminal rows are never claimable |
| A crashed worker's row is recoverable | The lease expires after `DELIVERY_LEASE_MS`, then anyone may reclaim it |
| No row can be orphaned mid-send | Boot recovery re-enqueues PROCESSING rows whose lease has expired |
| A scheduling request creates one campaign | `@@unique([userId, idempotencyKey])` on `EmailJob` |

### Delivery leases

A status flag alone cannot distinguish "I crashed and am resuming" from
"another worker is sending this right now" — and treating `PROCESSING` as
resumable let a second worker send a duplicate whenever it read the row after
the first had claimed it. Ownership is therefore explicit: `lockedBy` plus
`lockedAt`. A claim matches a row that is PENDING/SCHEDULED, or PROCESSING with
a lease older than the expiry window. PostgreSQL serialises the concurrent
updates, so exactly one caller sees `count: 1`.

Releases are also owner-checked, so a straggler waking after its lease expired
cannot clear a lease that has since been handed to someone else — including
the attempt refund that a throttled deferral performs, which would otherwise
let a stale worker decrement somebody else's retry budget.

### Why recovery includes PROCESSING rows

BullMQ's stalled-job detection normally redelivers work abandoned by a dead
worker, but it can only do so while the job still exists in Redis. If Redis
lost it — a flush, an eviction, or retries exhausted while the row was
mid-flight — a row left in PROCESSING would be picked up by nothing at all and
its campaign would hang forever.

Boot recovery therefore also selects PROCESSING rows whose lease has expired.
Because the lease has already lapsed, re-enqueueing one cannot interrupt a live
send, and a fresh lease is deliberately left alone. `recoverPendingSends()`
reports these separately as `reclaimedFromDeadWorkers`: a non-zero value means
workers died mid-send and is worth alerting on.

### Request idempotency

`POST /api/emails/schedule` accepts an `Idempotency-Key` header; the frontend
sends a fresh UUID per submission attempt, so a double-click or a retry of the
same click resolves to the campaign the first attempt created. A replay answers
**200** with `deduplicated: true`, not 201.

Without a header, a fingerprint of the payload within a one-minute bucket is
used instead. That catches an accidental double submit while still allowing the
same campaign to be sent again deliberately later — a permanent content hash
would wrongly block a legitimate resend.

The fast-path lookup is only an optimisation. Under a true race no read can
help, and the unique index is what actually arbitrates: the losing transaction
takes a `P2002`, which is caught and resolved to the winner's campaign.

### Deferral rewrites the scheduled time

When the throttle defers a send, the new run time is written back to
`EmailRecipient.scheduledAt`, not just to the BullMQ job. Otherwise the row
would keep a time that has already passed while the real one lived only in
Redis — the UI would show a stale send time, and a rebuild from the database
after a Redis loss would re-enqueue everything as overdue. The database has to
be the source of truth for *when*, not only for *what*.

### Dispatch pacing is measured at the start of a send

`MIN_EMAIL_DELAY_MS` paces when a send is *started*. `sentAt` records
completion, and with concurrency above one, completions overlap: two sends
dispatched a second apart can finish 400 ms apart if the first is slower.
`lockedAt` is therefore preserved on terminal rows as the dispatch timestamp,
which makes the pacing guarantee directly observable instead of inferred from
completion times.

### Assumptions

- Clocks are roughly synchronised across instances. Lease expiry and hourly
  windows both assume this; skew beyond the lease window could let a row be
  reclaimed early.
- Redis persistence is on (AOF, as in the compose file). Without it a crash
  loses delayed jobs until the next boot-time reconciliation.
- Lease expiry is longer than the slowest plausible send. Too short and a live
  send could be reclaimed; `DELIVERY_LEASE_MS` defaults to 5 minutes.
- At-least-once delivery is the floor. Exactly-once across an SMTP boundary is
  not achievable in general — a crash between the provider accepting a message
  and the row being marked SENT is unobservable. The lease plus terminal-status
  check narrows this to that one window.

## Security posture

Enforcement points, and what each is actually relied on for:

| Concern | Control |
| ------- | ------- |
| Authentication | JWT in an httpOnly, `SameSite=Lax` cookie; `secure` in production |
| Authorization | `requireAuth` then `requireAdmin`; ownership is a `WHERE userId` clause |
| CSRF | `SameSite=Lax` blocks cross-site non-GET; OAuth flows add a state cookie compared with `timingSafeEqual` |
| CORS | Explicit origin allow-list with credentials; no wildcard |
| Injection | Prisma parameterises everything; the one raw query is a static `SELECT 1` |
| XSS | React escapes by default; no `dangerouslySetInnerHTML`; outbound links are scheme-checked |
| Secrets at rest | AES-256-GCM for Slack tokens and sender passwords |
| Secrets in transit | Client secrets are used server-side only and never reach the browser |
| Logging | Request URLs are redacted before they are written |
| Rate limiting | Per-user (or per-IP) HTTP limits, tighter on auth and heavy endpoints |

### Cross-user access returns 404, not 403

Ownership is folded into the query rather than checked after loading the row,
so another user's campaign is indistinguishable from one that does not exist.
403 would confirm the id is real.

### Logs are redacted at the source

OAuth authorization codes travel in query strings, and morgan's stock formats
print `req.originalUrl` verbatim — so every Google and Slack callback wrote a
live authorization code into the log. A custom token redacts `code`, `state`,
`token`, `key`, `secret`, `password` and friends before the line is formatted,
rather than relying on log scrubbing downstream.

### Datastore ports are bound to loopback

Redis ships without a password and Elasticsearch runs with security disabled,
which is fine for a container that nothing outside the host can reach — and
not fine on `0.0.0.0`. The compose file binds all three to `127.0.0.1`.
`REDIS_PASSWORD` is wired through for any environment where that is not enough.

## Frontend data flow

Every screen is server-state-first: TanStack Query owns fetching, caching and
invalidation, and the Axios client normalises failures into `ApiError` before
they reach a component. Notes worth keeping:

- **Scheduling is deliberately not optimistic.** A campaign either exists on
  the server or it does not, and a premature "Scheduled" is a claim the user
  would act on. The success toast fires in `onSuccess`, after 201; the lists and
  dashboard are invalidated at the same moment. Verified by forcing the request
  to fail — no success toast appeared, and the dialog stayed open for a retry.
- **Optimistic updates are used nowhere else either.** The remaining mutations
  (cancel, Slack disconnect) are cheap and immediately verifiable, so the extra
  rollback machinery would buy nothing.
- **Pagination and filtering are server-side**, driven by the API's own `meta`.
  `keepPreviousData` stops a table flashing empty between pages, and the search
  input is debounced so typing does not fire a request per keystroke.
- **Errors are mapped once**, in `apiErrorMessage` / `apiFieldErrors`. A 400
  with `error.details` is folded back into the compose form field by field;
  everything else becomes a toast. A 401 anywhere clears the cached user and
  drops the app back to `/login`.
- **Notifications are derived from dashboard statistics**, not a fabricated
  feed — there is no notifications endpoint, and inventing one would mean
  showing the user events that never happened.

## API conventions

- One response envelope everywhere (`success` / `data` / `message` / `meta`, or
  `success: false` with a coded `error`). Clients switch on `error.code`, never
  on the message text.
- Zod schemas in `src/types/*.schema.ts` are the single source of truth: they
  validate at runtime and `z.infer` produces the compile-time types, so the two
  cannot drift.
- `asyncHandler` wraps async routes. Express 4 does not await handlers, so
  without it a rejected promise becomes an unhandled rejection instead of a
  500 — the wrapper is what makes the central error handler actually central.
- Controllers throw; only the error middleware formats a response. Unknown
  errors are logged in full and reported as a generic 500.
- Ownership is a `WHERE userId` clause in the service layer, not a check after
  loading the row. Another user's record is invisible (404), not forbidden
  (403), so the API never confirms that it exists.

## Open questions

- Timezone handling for scheduled sends (store UTC, render in user timezone).
- Retry and backoff policy for failed sends.
- Elasticsearch index refresh strategy relative to write path.
- Whether to add refresh-token rotation, or keep re-authenticating through
  Google when the 7-day session expires.
- Multi-tenancy: users are currently standalone, with no organisation model.
- Where to hold the encryption key for sender passwords and Slack tokens (env
  var vs a KMS), and how to rotate it.
- Whether one default sender per user should become a Postgres partial unique
  index applied via raw SQL, rather than an application invariant.
