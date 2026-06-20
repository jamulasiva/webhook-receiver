import 'dotenv/config';
import { Octokit } from '@octokit/rest';

const token = process.env.GITHUB_TOKEN;
const owner = process.env.GITHUB_OWNER;
const prefix = process.env.SANDBOX_REPO_PREFIX ?? 'gitaudit-sandbox';
const cleanup = (process.env.CLEANUP_AFTER_RUN ?? 'true').toLowerCase() === 'true';

if (!token) throw new Error('GITHUB_TOKEN is required');
if (!owner) throw new Error('GITHUB_OWNER is required');

const octokit = new Octokit({ auth: token });
const repo = `${prefix}-${Date.now()}`;

const log = (msg: string) => console.log(`[generator] ${msg}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function detectIsOrg(name: string): Promise<boolean> {
  try {
    const { data } = await octokit.users.getByUsername({ username: name });
    return data.type === 'Organization';
  } catch {
    return false;
  }
}

async function main() {
  const ownerName = owner!;
  const isOrg = await detectIsOrg(ownerName);

  log(`creating sandbox repo ${ownerName}/${repo} (${isOrg ? 'org' : 'user'}) -> repository.created`);
  if (isOrg) {
    await octokit.repos.createInOrg({
      org: ownerName,
      name: repo,
      description: 'Disposable sandbox for capturing GitHub webhook events.',
      auto_init: true,
      private: false,
    });
  } else {
    await octokit.repos.createForAuthenticatedUser({
      name: repo,
      description: 'Disposable sandbox for capturing GitHub webhook events.',
      auto_init: true,
      private: false,
    });
  }
  await sleep(2000);

  log('editing repo description -> repository.edited');
  await octokit.repos.update({ owner: ownerName, repo, description: 'Updated description.' });

  log('creating label -> label.created');
  await octokit.issues.createLabel({
    owner: ownerName,
    repo,
    name: 'audit-test',
    color: 'ededed',
    description: 'created by event-generator',
  });

  log('editing label -> label.edited');
  await octokit.issues.updateLabel({
    owner: ownerName,
    repo,
    name: 'audit-test',
    new_name: 'audit-test-renamed',
    color: 'ff0000',
  });

  log('creating milestone -> milestone.created');
  const { data: milestone } = await octokit.issues.createMilestone({
    owner: ownerName,
    repo,
    title: 'M1 - audit test',
  });

  log('closing milestone -> milestone.closed');
  await octokit.issues.updateMilestone({
    owner: ownerName,
    repo,
    milestone_number: milestone.number,
    state: 'closed',
  });

  log('opening issue -> issues.opened');
  const { data: issue } = await octokit.issues.create({
    owner: ownerName,
    repo,
    title: 'Audit generator issue',
    body: 'created by event-generator',
    labels: ['audit-test-renamed'],
  });

  log('editing issue -> issues.edited');
  await octokit.issues.update({
    owner: ownerName,
    repo,
    issue_number: issue.number,
    body: 'edited by event-generator',
  });

  log('commenting on issue -> issue_comment.created');
  const { data: issueComment } = await octokit.issues.createComment({
    owner: ownerName,
    repo,
    issue_number: issue.number,
    body: 'first comment',
  });

  log('editing issue comment -> issue_comment.edited');
  await octokit.issues.updateComment({
    owner: ownerName,
    repo,
    comment_id: issueComment.id,
    body: 'edited comment',
  });

  log('deleting issue comment -> issue_comment.deleted');
  await octokit.issues.deleteComment({
    owner: ownerName,
    repo,
    comment_id: issueComment.id,
  });

  log('closing issue -> issues.closed');
  await octokit.issues.update({
    owner: ownerName,
    repo,
    issue_number: issue.number,
    state: 'closed',
  });

  log('reopening issue -> issues.reopened');
  await octokit.issues.update({
    owner: ownerName,
    repo,
    issue_number: issue.number,
    state: 'open',
  });

  log('resolving default branch HEAD sha');
  const { data: repoInfo } = await octokit.repos.get({ owner: ownerName, repo });
  const defaultBranch = repoInfo.default_branch;
  const { data: baseRef } = await octokit.git.getRef({
    owner: ownerName,
    repo,
    ref: `heads/${defaultBranch}`,
  });
  const baseSha = baseRef.object.sha;

  const featureBranch = 'feature/audit-test';
  log(`creating branch ${featureBranch} -> create event`);
  await octokit.git.createRef({
    owner: ownerName,
    repo,
    ref: `refs/heads/${featureBranch}`,
    sha: baseSha,
  });

  log('committing file on feature branch -> push event');
  await octokit.repos.createOrUpdateFileContents({
    owner: ownerName,
    repo,
    branch: featureBranch,
    path: 'audit-note.md',
    message: 'add audit note',
    content: Buffer.from('# audit note\nAdded by event-generator.\n').toString('base64'),
  });

  log('opening PR -> pull_request.opened');
  const { data: pr } = await octokit.pulls.create({
    owner: ownerName,
    repo,
    title: 'Audit generator PR',
    head: featureBranch,
    base: defaultBranch,
    body: 'created by event-generator',
  });

  log('editing PR -> pull_request.edited');
  await octokit.pulls.update({
    owner: ownerName,
    repo,
    pull_number: pr.number,
    body: 'edited by event-generator',
  });

  log('labeling PR -> pull_request.labeled');
  await octokit.issues.addLabels({
    owner: ownerName,
    repo,
    issue_number: pr.number,
    labels: ['audit-test-renamed'],
  });

  log('commenting on PR -> issue_comment.created (on PR)');
  await octokit.issues.createComment({
    owner: ownerName,
    repo,
    issue_number: pr.number,
    body: 'PR comment from generator',
  });

  log('submitting COMMENT review -> pull_request_review.submitted');
  await octokit.pulls.createReview({
    owner: ownerName,
    repo,
    pull_number: pr.number,
    event: 'COMMENT',
    body: 'self-review comment',
  });

  log('merging PR -> pull_request.closed (merged=true)');
  try {
    await octokit.pulls.merge({
      owner: ownerName,
      repo,
      pull_number: pr.number,
      commit_title: 'merge audit PR',
      merge_method: 'merge',
    });
  } catch (err) {
    console.warn('[generator] merge failed, closing PR instead', err);
    await octokit.pulls.update({
      owner: ownerName,
      repo,
      pull_number: pr.number,
      state: 'closed',
    });
  }

  log(`deleting branch ${featureBranch} -> delete event`);
  try {
    await octokit.git.deleteRef({ owner: ownerName, repo, ref: `heads/${featureBranch}` });
  } catch (err) {
    console.warn('[generator] branch delete failed (may already be gone)', err);
  }

  log('commenting on default branch HEAD commit -> commit_comment.created');
  const { data: headRef } = await octokit.git.getRef({
    owner: ownerName,
    repo,
    ref: `heads/${defaultBranch}`,
  });
  await octokit.repos.createCommitComment({
    owner: ownerName,
    repo,
    commit_sha: headRef.object.sha,
    body: 'commit comment from generator',
  });

  log('creating release -> release.published');
  const { data: release } = await octokit.repos.createRelease({
    owner: ownerName,
    repo,
    tag_name: `v0.0.1-${Date.now()}`,
    name: 'audit test',
    body: 'release notes',
  });

  log('editing release -> release.edited');
  await octokit.repos.updateRelease({
    owner: ownerName,
    repo,
    release_id: release.id,
    body: 'edited release notes',
  });

  log('deleting release -> release.deleted');
  await octokit.repos.deleteRelease({
    owner: ownerName,
    repo,
    release_id: release.id,
  });

  log('privatizing repo -> repository.privatized');
  await octokit.repos.update({ owner: ownerName, repo, private: true });

  log('publicizing repo -> repository.publicized & public');
  await octokit.repos.update({ owner: ownerName, repo, private: false });

  log('archiving repo -> repository.archived');
  await octokit.repos.update({ owner: ownerName, repo, archived: true });

  log('unarchiving repo -> repository.unarchived');
  await octokit.repos.update({ owner: ownerName, repo, archived: false });

  if (cleanup) {
    log('deleting milestone');
    try {
      await octokit.issues.deleteMilestone({
        owner: ownerName,
        repo,
        milestone_number: milestone.number,
      });
    } catch (err) {
      console.warn('[generator] milestone delete failed', err);
    }

    log('deleting label');
    try {
      await octokit.issues.deleteLabel({ owner: ownerName, repo, name: 'audit-test-renamed' });
    } catch (err) {
      console.warn('[generator] label delete failed', err);
    }

    log(`deleting sandbox repo -> repository.deleted`);
    await octokit.repos.delete({ owner: ownerName, repo });
  } else {
    log(`leaving sandbox repo in place: https://github.com/${ownerName}/${repo}`);
  }

  log('done.');
}

main().catch((err) => {
  console.error('[generator] failed:', err);
  process.exit(1);
});
