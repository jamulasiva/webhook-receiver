import 'dotenv/config';
import crypto from 'node:crypto';
import { Octokit } from '@octokit/rest';

const token = process.env.GITHUB_TOKEN;
const repoFullName = process.env.GITHUB_REPO ?? 'jamulasiva/webhook-receiver';

if (!token) throw new Error('GITHUB_TOKEN is required');
const [owner, repo] = repoFullName.split('/');
if (!owner || !repo) throw new Error('GITHUB_REPO must be in owner/repo format');

const octokit = new Octokit({ auth: token });
const ts = Date.now();
const branch = `event-gen/${ts}`;
const sampleDir = `event-samples/event-gen-${ts}`;
const labelName = `event-gen-${ts}`;
const milestoneTitle = `event-gen-${ts}`;

const log = (msg: string) => console.log(`[generator] ${msg}`);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main() {
  log(`targeting ${owner}/${repo}`);
  log(`throwaway branch: ${branch}`);
  log(`sandbox dir:      ${sampleDir}`);

  const { data: repoInfo } = await octokit.repos.get({ owner, repo });
  const defaultBranch = repoInfo.default_branch;
  const originalDescription = repoInfo.description ?? '';
  log(`default branch:   ${defaultBranch}`);

  // === repository.edited ===
  log('-> repository.edited');
  await octokit.repos.update({
    owner,
    repo,
    description: `${originalDescription} [event-gen ${ts}]`.trim(),
  });

  // === label.created + label.edited ===
  log('-> label.created');
  await octokit.issues.createLabel({
    owner,
    repo,
    name: labelName,
    color: 'ededed',
    description: 'event-gen disposable label',
  });
  log('-> label.edited');
  await octokit.issues.updateLabel({ owner, repo, name: labelName, color: 'ff0000' });

  // === milestone.created + .edited + .closed ===
  log('-> milestone.created');
  const { data: milestone } = await octokit.issues.createMilestone({
    owner,
    repo,
    title: milestoneTitle,
    description: 'event-gen disposable milestone',
  });
  log('-> milestone.edited');
  await octokit.issues.updateMilestone({
    owner,
    repo,
    milestone_number: milestone.number,
    description: 'edited',
  });
  log('-> milestone.closed');
  await octokit.issues.updateMilestone({
    owner,
    repo,
    milestone_number: milestone.number,
    state: 'closed',
  });

  // === create (branch) ===
  log('-> create (branch)');
  const { data: baseRef } = await octokit.git.getRef({
    owner,
    repo,
    ref: `heads/${defaultBranch}`,
  });
  await octokit.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branch}`,
    sha: baseRef.object.sha,
  });

  // === push (add file) + push (update file) ===
  log('-> push (add file)');
  const { data: createdFile } = await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    branch,
    path: `${sampleDir}/note.md`,
    message: 'event-gen: add note.md',
    content: Buffer.from(`# Event sample ${ts}\n`).toString('base64'),
  });
  const noteSha = createdFile.content?.sha;
  if (!noteSha) throw new Error('expected sha on createOrUpdateFileContents response');

  log('-> push (update file)');
  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    branch,
    path: `${sampleDir}/note.md`,
    message: 'event-gen: update note.md',
    content: Buffer.from(`# Event sample ${ts}\n\nUpdated by event-gen.\n`).toString('base64'),
    sha: noteSha,
  });

  // === issues: opened, edited, labeled, unlabeled, milestoned, demilestoned,
  //             pinned, unpinned, locked, unlocked, closed, reopened ===
  log('-> issues.opened');
  const { data: issue } = await octokit.issues.create({
    owner,
    repo,
    title: `event-gen issue ${ts}`,
    body: 'opened by event-gen',
  });

  log('-> issues.edited');
  await octokit.issues.update({
    owner,
    repo,
    issue_number: issue.number,
    body: 'edited by event-gen',
  });

  log('-> issues.labeled');
  await octokit.issues.addLabels({
    owner,
    repo,
    issue_number: issue.number,
    labels: [labelName],
  });

  log('-> issues.unlabeled');
  await octokit.issues.removeLabel({
    owner,
    repo,
    issue_number: issue.number,
    name: labelName,
  });

  log('-> issues.milestoned');
  await octokit.issues.update({
    owner,
    repo,
    issue_number: issue.number,
    milestone: milestone.number,
  });

  log('-> issues.demilestoned');
  await octokit.issues.update({
    owner,
    repo,
    issue_number: issue.number,
    milestone: null,
  });

  log('-> issues.pinned (GraphQL)');
  await tryRun(() =>
    octokit.graphql(
      `mutation($id: ID!) { pinIssue(input: { issueId: $id }) { issue { id } } }`,
      { id: issue.node_id },
    ),
  );

  log('-> issues.unpinned (GraphQL)');
  await tryRun(() =>
    octokit.graphql(
      `mutation($id: ID!) { unpinIssue(input: { issueId: $id }) { issue { id } } }`,
      { id: issue.node_id },
    ),
  );

  log('-> issues.locked');
  await octokit.issues.lock({ owner, repo, issue_number: issue.number });

  log('-> issues.unlocked');
  await octokit.issues.unlock({ owner, repo, issue_number: issue.number });

  // === issue_comment: created, edited, deleted ===
  log('-> issue_comment.created');
  const { data: issueComment } = await octokit.issues.createComment({
    owner,
    repo,
    issue_number: issue.number,
    body: 'comment from event-gen',
  });

  log('-> issue_comment.edited');
  await octokit.issues.updateComment({
    owner,
    repo,
    comment_id: issueComment.id,
    body: 'edited comment',
  });

  log('-> issue_comment.deleted');
  await octokit.issues.deleteComment({ owner, repo, comment_id: issueComment.id });

  log('-> issues.closed');
  await octokit.issues.update({
    owner,
    repo,
    issue_number: issue.number,
    state: 'closed',
  });

  log('-> issues.reopened');
  await octokit.issues.update({
    owner,
    repo,
    issue_number: issue.number,
    state: 'open',
  });

  // === pull_request: opened, edited, labeled, unlabeled, closed (merged) ===
  log('-> pull_request.opened');
  const { data: pr } = await octokit.pulls.create({
    owner,
    repo,
    head: branch,
    base: defaultBranch,
    title: `event-gen PR ${ts}`,
    body: 'opened by event-gen',
  });
  const prHeadSha = pr.head.sha;

  log('-> pull_request.edited');
  await octokit.pulls.update({
    owner,
    repo,
    pull_number: pr.number,
    body: 'edited by event-gen',
  });

  log('-> pull_request.labeled');
  await octokit.issues.addLabels({
    owner,
    repo,
    issue_number: pr.number,
    labels: [labelName],
  });

  log('-> pull_request.unlabeled');
  await octokit.issues.removeLabel({
    owner,
    repo,
    issue_number: pr.number,
    name: labelName,
  });

  // === pull_request_review_comment: created, edited, deleted ===
  log('-> pull_request_review_comment.created');
  const { data: reviewComment } = await octokit.pulls.createReviewComment({
    owner,
    repo,
    pull_number: pr.number,
    commit_id: prHeadSha,
    path: `${sampleDir}/note.md`,
    line: 1,
    side: 'RIGHT',
    body: 'review comment from event-gen',
  });

  log('-> pull_request_review_comment.edited');
  await octokit.pulls.updateReviewComment({
    owner,
    repo,
    comment_id: reviewComment.id,
    body: 'edited review comment',
  });

  // === pull_request_review_thread: resolved + unresolved ===
  // Give GitHub a moment to materialize the review thread for our comment.
  await sleep(1500);
  log('-> pull_request_review_thread.resolved (GraphQL)');
  const threadId = await getFirstReviewThreadId(pr.number);
  if (threadId) {
    await tryRun(() =>
      octokit.graphql(
        `mutation($id: ID!) { resolveReviewThread(input: { threadId: $id }) { thread { id } } }`,
        { id: threadId },
      ),
    );
    log('-> pull_request_review_thread.unresolved (GraphQL)');
    await tryRun(() =>
      octokit.graphql(
        `mutation($id: ID!) { unresolveReviewThread(input: { threadId: $id }) { thread { id } } }`,
        { id: threadId },
      ),
    );
  } else {
    log('   skip: no review thread found');
  }

  log('-> pull_request_review_comment.deleted');
  await octokit.pulls.deleteReviewComment({ owner, repo, comment_id: reviewComment.id });

  // === pull_request_review: submitted (COMMENT only — self-review can't APPROVE) ===
  log('-> pull_request_review.submitted');
  await octokit.pulls.createReview({
    owner,
    repo,
    pull_number: pr.number,
    event: 'COMMENT',
    body: 'self-review from event-gen',
  });

  // === commit_comment.created ===
  log('-> commit_comment.created');
  await octokit.repos.createCommitComment({
    owner,
    repo,
    commit_sha: prHeadSha,
    body: 'commit comment from event-gen',
  });

  // === pull_request.closed (merged=true) ===
  log('-> pull_request.closed (merged)');
  await tryRun(
    () =>
      octokit.pulls.merge({
        owner,
        repo,
        pull_number: pr.number,
        commit_title: `event-gen merge ${ts}`,
        merge_method: 'merge',
      }),
    () =>
      octokit.pulls.update({
        owner,
        repo,
        pull_number: pr.number,
        state: 'closed',
      }),
  );

  // === workflow_run + workflow_job + check_suite + check_run ===
  // Push a tiny workflow file to the event-gen branch. GitHub Actions will
  // fire these four event types over the next 30-60 seconds. We sleep below,
  // before cleanup, to give them time to enqueue.
  log('-> queueing workflow_run / workflow_job / check_suite / check_run (async)');
  const workflowYaml = [
    'name: Event Sample',
    'on:',
    '  push:',
    "    branches: ['event-gen/**']",
    'jobs:',
    '  hello:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    `      - run: echo "hello from event-gen ${ts}"`,
  ].join('\n');
  await tryRun(() =>
    octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      branch,
      path: '.github/workflows/event-sample.yml',
      message: 'event-gen: add workflow',
      content: Buffer.from(workflowYaml).toString('base64'),
    }),
  );

  // === release: published, edited, deleted ===
  const tag = `event-gen-${ts}`;
  log('-> release.published');
  const { data: release } = await octokit.repos.createRelease({
    owner,
    repo,
    tag_name: tag,
    name: tag,
    body: 'event-gen release',
    target_commitish: branch,
  });
  log('-> release.edited');
  await octokit.repos.updateRelease({
    owner,
    repo,
    release_id: release.id,
    body: 'edited release notes',
  });
  log('-> release.deleted');
  await octokit.repos.deleteRelease({ owner, repo, release_id: release.id });
  await tryRun(() => octokit.git.deleteRef({ owner, repo, ref: `tags/${tag}` }));

  // === deploy_key: created, deleted ===
  log('-> deploy_key.created');
  const publicKey = generateSshEd25519PublicKey();
  const { data: deployKey } = await octokit.repos.createDeployKey({
    owner,
    repo,
    title: `event-gen-${ts}`,
    key: publicKey,
    read_only: true,
  });
  // Brief pause so the `created` webhook isn't racing the `deleted` webhook
  // through a cold-starting Vercel function.
  await sleep(2000);
  log('-> deploy_key.deleted');
  await octokit.repos.deleteDeployKey({ owner, repo, key_id: deployKey.id });

  // === deployment.created + deployment_status.created ===
  log('-> deployment.created');
  const deploymentResp = await octokit.repos.createDeployment({
    owner,
    repo,
    ref: defaultBranch,
    environment: `event-gen-${ts}`,
    auto_merge: false,
    required_contexts: [],
    description: 'event-gen deployment',
  });
  if ('id' in deploymentResp.data) {
    log('-> deployment_status.created');
    await octokit.repos.createDeploymentStatus({
      owner,
      repo,
      deployment_id: deploymentResp.data.id,
      state: 'success',
      environment: `event-gen-${ts}`,
      description: 'deployed',
    });
  } else {
    log(`   deployment skipped: ${JSON.stringify(deploymentResp.data)}`);
  }

  // === status (commit status, no action subtype) ===
  log('-> status');
  const { data: mainRef } = await octokit.git.getRef({
    owner,
    repo,
    ref: `heads/${defaultBranch}`,
  });
  await octokit.repos.createCommitStatus({
    owner,
    repo,
    sha: mainRef.object.sha,
    state: 'success',
    context: 'event-gen/check',
    description: 'event-gen status check',
  });

  // === branch_protection_rule: created + deleted (back-to-back, with paranoid safety net) ===
  log('-> branch_protection_rule.created');
  await tryRun(async () => {
    await octokit.repos.updateBranchProtection({
      owner,
      repo,
      branch: defaultBranch,
      required_status_checks: null,
      enforce_admins: false,
      required_pull_request_reviews: null,
      restrictions: null,
      allow_force_pushes: false,
      allow_deletions: false,
    });
    try {
      log('-> branch_protection_rule.deleted');
      await octokit.repos.deleteBranchProtection({ owner, repo, branch: defaultBranch });
    } catch (err) {
      log(`   CRITICAL: branch protection created but delete failed: ${(err as Error).message}`);
      log(`   manually remove in Settings -> Branches before pushing to ${defaultBranch} again.`);
    }
  });

  // === repository_ruleset: created + deleted ===
  log('-> repository_ruleset.created');
  await tryRun(async () => {
    const { data: ruleset } = await octokit.request('POST /repos/{owner}/{repo}/rulesets', {
      owner,
      repo,
      name: `event-gen-${ts}`,
      target: 'branch',
      enforcement: 'active',
      // Pattern can never match a real branch, so the ruleset never enforces.
      conditions: {
        ref_name: { include: ['refs/heads/event-gen-never-matches-anything'], exclude: [] },
      },
      rules: [{ type: 'creation' }],
    });
    log('-> repository_ruleset.deleted');
    await octokit.request('DELETE /repos/{owner}/{repo}/rulesets/{ruleset_id}', {
      owner,
      repo,
      ruleset_id: ruleset.id,
    });
  });

  // === star: created + deleted ===
  log('-> star.created');
  await tryRun(() => octokit.activity.starRepoForAuthenticatedUser({ owner, repo }));
  log('-> star.deleted');
  await tryRun(() => octokit.activity.unstarRepoForAuthenticatedUser({ owner, repo }));

  // === CLEANUP ===
  log('--- cleanup ---');

  log('cleanup: restore repo description');
  await tryRun(() => octokit.repos.update({ owner, repo, description: originalDescription }));

  log('cleanup: close + lock throwaway issue');
  await tryRun(async () => {
    await octokit.issues.update({ owner, repo, issue_number: issue.number, state: 'closed' });
    await octokit.issues.lock({ owner, repo, issue_number: issue.number });
  });

  log('cleanup: delete throwaway label');
  await tryRun(() => octokit.issues.deleteLabel({ owner, repo, name: labelName }));

  log('cleanup: delete throwaway milestone');
  await tryRun(() =>
    octokit.issues.deleteMilestone({ owner, repo, milestone_number: milestone.number }),
  );

  // Wait for the workflow run we triggered above to actually start, otherwise
  // deleting the branch can cancel it before workflow_run.requested fires.
  log('   waiting 25s for workflow events to start firing before deleting branch...');
  await sleep(25000);

  log('cleanup: delete throwaway branch (removes workflow file + sandbox dir)');
  await tryRun(() => octokit.git.deleteRef({ owner, repo, ref: `heads/${branch}` }));

  log('done. workflow_run / workflow_job / check_suite / check_run may still arrive over the next minute.');
}

async function getFirstReviewThreadId(prNumber: number): Promise<string | null> {
  try {
    const result = await octokit.graphql<{
      repository: { pullRequest: { reviewThreads: { nodes: Array<{ id: string }> } } };
    }>(
      `query($owner: String!, $repo: String!, $number: Int!) {
         repository(owner: $owner, name: $repo) {
           pullRequest(number: $number) {
             reviewThreads(first: 10) { nodes { id } }
           }
         }
       }`,
      { owner, repo, number: prNumber },
    );
    return result.repository.pullRequest.reviewThreads.nodes[0]?.id ?? null;
  } catch (err) {
    log(`   getFirstReviewThreadId failed: ${(err as Error).message}`);
    return null;
  }
}

async function tryRun(
  fn: () => Promise<unknown>,
  onError?: () => Promise<unknown>,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    log(`   WARN: ${(err as Error).message}`);
    if (onError) {
      try {
        await onError();
      } catch (err2) {
        log(`   WARN (fallback also failed): ${(err2 as Error).message}`);
      }
    }
  }
}

function generateSshEd25519PublicKey(): string {
  const { publicKey } = crypto.generateKeyPairSync('ed25519');
  const spki = publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  // SPKI for ed25519 is exactly 12 bytes of ASN.1 header + 32 bytes of raw key.
  const rawKey = spki.subarray(12);

  const algoBuf = Buffer.from('ssh-ed25519');
  const algoLen = Buffer.alloc(4);
  algoLen.writeUInt32BE(algoBuf.length, 0);
  const keyLen = Buffer.alloc(4);
  keyLen.writeUInt32BE(rawKey.length, 0);

  const sshKey = Buffer.concat([algoLen, algoBuf, keyLen, rawKey]);
  return `ssh-ed25519 ${sshKey.toString('base64')} event-gen@disposable`;
}

main().catch((err) => {
  console.error('[generator] failed:', err);
  process.exit(1);
});
