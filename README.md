# ATG-GitAudit

GitHub audit / data-lake project. The eventual goal is an application that consumes GitHub webhook events and exposes auditing views over them.

This repo currently contains two **disposable data-collection tools** under [tools/](tools/). Their only job is to populate a Supabase table with a comprehensive library of real GitHub webhook payloads. Once payload coverage is good, these tools become obsolete and the real audit application will be built fresh against the captured samples.

## Layout

```
tools/
├── webhook-receiver/   # Vercel serverless functions; stores raw payloads in Supabase
├── event-generator/    # Octokit script; triggers GitHub actions to fire events
└── db/
    └── schema.sql      # Supabase / Postgres table for captured events
```

## One-time setup

### 1. Supabase

1. Create a project at https://supabase.com.
2. Open the SQL editor and run [tools/db/schema.sql](tools/db/schema.sql).
3. Copy the project URL and the `service_role` API key from **Settings → API**.

### 2. GitHub token (for the event-generator)

Create a classic Personal Access Token with scopes:
- `repo`
- `delete_repo`
- `admin:org` *(only if `GITHUB_OWNER` is an organization)*

Use a sandbox or throwaway account. The generator creates and deletes repos under this owner.

### 3. Webhook shared secret

Generate a long random string. In PowerShell:

```powershell
[Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

Use the **same** value for the receiver's `GITHUB_WEBHOOK_SECRET` and the secret you configure on the GitHub webhook.

## Deploy the receiver to Vercel

The receiver is a pair of Vercel serverless functions ([api/webhook.ts](tools/webhook-receiver/api/webhook.ts) and [api/health.ts](tools/webhook-receiver/api/health.ts)) — no servers to manage, free tier is sufficient, no cold-start issues for GitHub's 10 s timeout.

1. Push this repo to GitHub.
2. Go to https://vercel.com → **Add New → Project** → import your GitHub repo.
3. On the import screen:
   - **Root Directory:** `tools/webhook-receiver`
   - Framework Preset: `Other`
   - Build & Output Settings: leave defaults
4. **Environment Variables** — add all three from [tools/webhook-receiver/.env.example](tools/webhook-receiver/.env.example):
   - `GITHUB_WEBHOOK_SECRET` (generate a **fresh** value for production; do not reuse your local-dev value)
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
5. Click **Deploy**. Vercel assigns a URL like `https://your-project.vercel.app`.
6. Verify: `curl https://your-project.vercel.app/api/health` → `{"ok":true}`.

## Configure the GitHub webhook

Pick **one**:

- **Org-level webhook (recommended):** Org Settings → Webhooks → Add webhook. Fires for every repo in the org, current and future.
- **Repo-level webhook:** Repo Settings → Webhooks → Add webhook.

| Field            | Value                                                  |
| ---------------- | ------------------------------------------------------ |
| Payload URL      | `https://your-project.vercel.app/api/webhook`          |
| Content type     | `application/json`                                     |
| Secret           | The same value as `GITHUB_WEBHOOK_SECRET`              |
| SSL verification | Enabled                                                |
| Which events     | **Send me everything**                                 |

GitHub sends a `ping` event right after creation — you should see a row in `raw_events` within seconds.

## Run the event-generator

The generator creates a throwaway sandbox repo, exercises every common GitHub action (issues, PRs, labels, milestones, releases, archive/unarchive, etc.), then deletes the sandbox. Every action fires a webhook to the deployed receiver, which lands as a row in Supabase.

```powershell
cd tools/event-generator
Copy-Item .env.example .env
# edit .env with your GITHUB_TOKEN and GITHUB_OWNER
npm install
npm start
```

Re-run any time to refresh / extend the payload library.

## Inspect captured events

In the Supabase SQL editor:

```sql
-- Distinct event types captured so far
select event_type, count(*) as n
from raw_events
group by event_type
order by n desc;

-- Most recent 20 events
select received_at, event_type, delivery_id
from raw_events
order by received_at desc
limit 20;

-- Full sample for a specific event type
select payload
from raw_events
where event_type = 'pull_request'
order by received_at desc
limit 1;
```

## Local development of the receiver

The receiver runs locally with `vercel dev`, but GitHub cannot reach `localhost` so live webhooks require the deployed URL. For offline iteration, [tools/webhook-receiver/scripts/send-test-event.ps1](tools/webhook-receiver/scripts/send-test-event.ps1) builds a signed sample payload and POSTs it to your local instance.

```powershell
cd tools/webhook-receiver
Copy-Item .env.example .env
# fill in values
npm install
npm run dev   # runs `vercel dev --listen 3000`
```

The first `vercel dev` invocation will prompt you to log in to Vercel and link the directory to a project. After that, the local server is available at `http://localhost:3000/api/webhook`. Send a test event from a second terminal:

```powershell
cd tools/webhook-receiver
.\scripts\send-test-event.ps1
```

## What's intentionally NOT covered

- Some admin / audit events (org settings changes, OAuth app authorizations, certain member events on Enterprise) are **not delivered as webhooks** and require GitHub's Audit Log API (Enterprise Cloud / Server). Out of scope for the collection phase.
- Events that need a second account / external trigger (`fork`, `star`, `watch`, `member` added by invite) are not generated automatically — trigger them manually if you want samples.
