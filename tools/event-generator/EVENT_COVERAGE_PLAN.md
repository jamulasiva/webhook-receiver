# Event Coverage Plan

Goal: capture at least one sample payload for every webhook event type GitHub fires
at the repository level, using `jamulasiva/webhook-receiver` as the test repo
(no separate sandbox repo).

All file-system operations the generator performs land in a single sandbox folder
inside the repo (`event-samples/` at repo root) on a throwaway branch
(`event-gen/<timestamp>`), so the real codebase is never touched.

---

## Architecture change (vs. original event-generator)

| Before                                          | After                                                          |
| ----------------------------------------------- | -------------------------------------------------------------- |
| Creates a brand-new sandbox repo per run        | Operates on the existing `jamulasiva/webhook-receiver` repo    |
| Creates files at repo root                      | Creates files under `event-samples/` on branch `event-gen/<ts>`|
| Deletes the entire repo at the end              | Leaves repo intact; deletes only the throwaway branch + label + milestone, closes throwaway issue |
| Required `repo` + `delete_repo` PAT scopes      | Needs only `repo` scope (no `delete_repo`)                     |
| Webhook had to be created per sandbox repo      | Webhook is configured once on `webhook-receiver` (done already)|

---

## Coverage categories

- **A. AUTO** — generator script triggers it via Octokit. No human action needed.
- **B. MANUAL** — needs a one-time UI click or feature toggle. Step-by-step below.
- **C. SKIP** — genuinely not feasible (paid feature, second account required, or destructive).

---

## A. AUTO — handled by the generator script

| # | Webhook event                  | Octokit call(s)                                                                          | Actions captured                                                                                  |
| - | ------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1 | `label`                        | `issues.createLabel`, `updateLabel`, `deleteLabel`                                       | created, edited, deleted                                                                          |
| 2 | `milestone`                    | `issues.createMilestone`, `updateMilestone`, `deleteMilestone`                           | created, edited, closed, deleted                                                                  |
| 3 | `issues`                       | `issues.create`, `update`, `addLabels`, `removeLabel`, `lock`, `unlock`, `pin`, `unpin`  | opened, edited, labeled, unlabeled, pinned, unpinned, locked, unlocked, closed, reopened          |
| 4 | `issue_comment`                | `issues.createComment`, `updateComment`, `deleteComment`                                 | created, edited, deleted                                                                          |
| 5 | `create`                       | `git.createRef`                                                                          | branch created (`event-gen/<ts>`)                                                                 |
| 6 | `push`                         | `repos.createOrUpdateFileContents`                                                       | adds `event-samples/event-gen-<ts>/note.md` then updates it (two pushes)                          |
| 7 | `pull_request`                 | `pulls.create`, `update`, `merge`, label changes                                         | opened, edited, labeled, unlabeled, closed (merged=true)                                          |
| 8 | `pull_request_review`          | `pulls.createReview` (event=COMMENT)                                                     | submitted (COMMENT — self-review limitation; APPROVE needs 2nd account)                           |
| 9 | `pull_request_review_comment`  | `pulls.createReviewComment`, `updateReviewComment`, `deleteReviewComment`                | created, edited, deleted                                                                          |
| 10| `pull_request_review_thread`   | GraphQL `resolveReviewThread` / `unresolveReviewThread`                                  | resolved, unresolved                                                                              |
| 11| `commit_comment`               | `repos.createCommitComment`                                                              | created                                                                                           |
| 12| `release`                      | `repos.createRelease`, `updateRelease`, `deleteRelease`                                  | published, edited, deleted                                                                        |
| 13| `repository`                   | `repos.update` (description change only — never archive/visibility)                      | edited                                                                                            |
| 14| `delete`                       | `git.deleteRef`                                                                          | branch deleted (`event-gen/<ts>`)                                                                 |
| 15| `deployment`                   | `repos.createDeployment`                                                                 | created                                                                                           |
| 16| `deployment_status`            | `repos.createDeploymentStatus`                                                           | created                                                                                           |
| 17| `status`                       | `repos.createCommitStatus`                                                               | (no action subtype — fires once)                                                                  |
| 18| `deploy_key`                   | `repos.createDeployKey`, `deleteDeployKey`                                               | created, deleted                                                                                  |
| 19| `star`                         | `activity.starRepoForAuthenticatedUser`, `unstarRepoForAuthenticatedUser`                | created, deleted                                                                                  |
| 20| `branch_protection_rule`       | `repos.updateBranchProtection`, `deleteBranchProtection`                                 | created, deleted                                                                                  |
| 21| `repository_ruleset`           | `repos.createRepoRuleset`, `deleteRepoRuleset`                                           | created, deleted                                                                                  |
| 22| `workflow_run`                 | committing `.github/workflows/event-sample.yml` (via `createOrUpdateFileContents`)       | requested, in_progress, completed (fires automatically after the workflow runs)                   |
| 23| `workflow_job`                 | same — fires per job in the workflow run                                                 | queued, in_progress, completed                                                                    |
| 24| `check_suite`                  | same — fires automatically alongside `workflow_run`                                      | requested, completed                                                                              |
| 25| `check_run`                    | same — fires per check produced by the workflow                                          | created, completed                                                                                |

**Expected after one run:** ~25 distinct webhook event types, ~45 deliveries.

> Note on the workflow: events 22–25 are fired by GitHub Actions *after* the script
> commits a trivial workflow file. The script doesn't wait for them — they'll trickle
> in over ~30–60 seconds after the run finishes. Re-query Supabase a minute later to see all four.

---

## B. MANUAL — events that require a UI toggle or a second person

Each takes < 2 minutes. Do these once; the events flow into Supabase the same way.

### B.1 — `gollum` (wiki edits)
1. Repo → **Settings** → **Features** section → check **Wikis**.
2. Top tabs → **Wiki** → **Create the first page**.
3. Title: `Test`. Content: anything. Click **Save page**.
4. Edit the page once more → Save. (Captures edited action too.)

### B.2 — `discussion` + `discussion_comment`
1. Repo → **Settings** → **Features** → check **Discussions** → click **Set up discussions** if prompted.
2. Top tabs → **Discussions** → **New discussion** → pick **General** → title `Test`, body anything → **Start discussion**.
3. Reply to your own discussion → **Comment**.
4. Edit the comment.
5. Mark the discussion as answered (if "Q&A" category) OR just close it.

### B.3 — `security_and_analysis`
1. Repo → **Settings** → **Code security** (left sidebar).
2. Toggle **Dependabot alerts** → **Enable**. (Or toggle any other off/on.)
3. Toggle **Secret scanning** if available (free for public repos only).

### B.4 — `page_build`
1. Repo → **Settings** → **Pages** (left sidebar).
2. Source: **Deploy from a branch** → Branch: `main` → Folder: `/ (root)` → **Save**.
3. GitHub builds the page → fires `page_build` once complete (~1 min).
4. **Optional cleanup:** Source → **None** → **Save** (disables Pages).

### B.5 — `watch`
1. Repo → top right **Watch** button (or **Unwatch** if already watching).
2. Pick **All Activity** → **Apply**.
3. Switch back to **Participating and @mentions** → **Apply**.

### B.6 — `member`
Requires a second GitHub account.
1. Repo → **Settings** → **Collaborators** → **Add people** → invite another GitHub user.
2. That user accepts the invite → `member` action=`added` fires.
3. Remove the user → `member` action=`removed` fires.

### B.7 — `fork`
Requires a second GitHub account or org.
1. From the *second* account: open `https://github.com/jamulasiva/webhook-receiver` → **Fork** → **Create fork**.
2. Delete the fork afterwards if you don't need it.

### B.8 — `dependabot_alert` (only if B.3 done and there are vulnerabilities)
The receiver's `node_modules` (and several deps) have known CVEs. Once Dependabot alerts are enabled (B.3), GitHub will scan and fire `dependabot_alert` action=`created` for each finding within minutes.

### B.9 — `check_run` action=`rerequested`
After the AUTO workflow runs once, go to **Actions** tab → click the latest run → **Re-run all jobs**. Fires `check_run` with action=`rerequested` and another full `workflow_run` cycle.

---

## C. SKIP — genuinely not feasible without major setup

| Webhook event                              | Why skipped                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| `code_scanning_alert`                      | Needs CodeQL workflow + an actual finding.                              |
| `secret_scanning_alert` / `_location` / `_scan` | Requires secret scanning enabled (paid for private repos).         |
| `repository_advisory`                      | Niche security workflow (manual draft → publish).                       |
| `repository_import`                        | Only fires when importing an existing repo via importer UI.             |
| `package`, `registry_package`              | Requires publishing to GitHub Packages registry (npm/Docker/etc.).      |
| `merge_group`                              | Requires GitHub Merge Queue (Enterprise plan).                          |
| `team_add`                                 | Organization-only event; this is a personal account.                    |
| `public`                                   | Would permanently change repo to public — **don't trigger**.            |
| `*_bypass_request`, `*_dismissal_request`  | Enterprise security review workflows.                                   |
| `issue_dependencies`, `sub_issues`         | Newer GitHub features; UI-only and still evolving.                      |
| `meta`                                     | Fires when the webhook itself is deleted — **never trigger**.           |

---

## Execution plan

### Phase 1 — Rewrite the script
- Read `GITHUB_REPO=jamulasiva/webhook-receiver` from env (defaults to that value).
- Confine writes to `event-samples/event-gen-<ts>/` on branch `event-gen/<ts>`.
- Implement all 25 AUTO event triggers (table A above) in deterministic order.
- Always clean up at end of run, in this order, with try/catch on each:
  1. Delete repository ruleset
  2. Delete branch protection rule
  3. Delete deploy key
  4. Delete release (if any survived)
  5. Close + lock the throwaway issue (not delete — GitHub keeps issues forever)
  6. Delete throwaway label + milestone
  7. Delete throwaway branch `event-gen/<ts>` (this removes all sandbox files too)
- Never touch the real codebase, never archive, never change visibility, never delete the repo.

### Phase 2 — Run it
```powershell
cd tools/event-generator
Copy-Item .env.example .env   # if .env doesn't exist
# edit .env: set GITHUB_TOKEN (classic PAT, scope: repo) and leave GITHUB_REPO default
npm install
npm start
```
Watch the Vercel logs + Supabase `raw_events` table populate live.

### Phase 3 — Wait ~60s after script finishes
This lets GitHub Actions complete and fire workflow/check events.

### Phase 4 — Verify AUTO coverage
```sql
select event_type, payload->>'action' as action, count(*) as n
from raw_events
group by event_type, payload->>'action'
order by event_type, action;
```
Expect ~25 `event_type` values.

### Phase 5 — Run through MANUAL list (section B)
Pick which ones you want; each takes < 2 min.

### Phase 6 — Sample collection complete
Move on to designing the real audit application against the captured payloads.

