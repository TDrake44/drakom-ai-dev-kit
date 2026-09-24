import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const root = new URL('..', import.meta.url);

/** @typedef {{ name?: string, uses?: string, with?: Record<string, unknown>, env?: unknown }} WorkflowStep */
/** @typedef {{ if?: string, steps: WorkflowStep[] }} WorkflowJob */
/** @typedef {{ jobs: Record<string, WorkflowJob>, permissions: Record<string, string> }} Workflow */

/**
 * @param {string} name
 * @returns {Promise<Workflow>}
 */
async function readWorkflow(name) {
  const source = await readFile(new URL(`.github/workflows/${name}`, root), 'utf8');
  return /** @type {Workflow} */ (yaml.load(source, { schema: yaml.JSON_SCHEMA }));
}

/**
 * @param {Workflow} workflow
 * @param {string} name
 * @returns {WorkflowStep}
 */
function findStep(workflow, name) {
  const job = workflow.jobs[Object.keys(workflow.jobs)[0]];
  assert.ok(job, 'workflow must contain a job');
  const step = job.steps.find(
    (step) => step.name === name,
  );
  assert.ok(step, `workflow must contain the ${name} step`);
  return step;
}

/**
 * @param {Workflow} workflow
 * @returns {string[]}
 */
function actionReferences(workflow) {
  return Object.values(workflow.jobs)
    .flatMap((job) => job.steps)
    .flatMap((step) => step.uses ? [step.uses] : []);
}

test('CI uses the supported Node 24 LTS toolchain and exposes the sole verify gate', async () => {
  const workflow = await readWorkflow('ci.yml');
  const job = workflow.jobs.verify;

  await assert.rejects(
    readFile(new URL('.github/workflows/verify.yml', root)),
    { code: 'ENOENT' },
    'the legacy duplicate verify workflow must be removed',
  );
  assert.ok(job, 'CI must expose the required verify job');
  assert.equal(workflow.permissions.contents, 'read');
  assert.equal(
    'version' in (findStep(workflow, 'Setup pnpm').with ?? {}),
    false,
    'pnpm/action-setup must use the packageManager version from package.json',
  );
  assert.equal(findStep(workflow, 'Setup Node.js 24').with?.['node-version'], 24);
});

test('release uses Changesets v3 automation and npm OIDC trusted publishing', async () => {
  const workflow = await readWorkflow('release.yml');
  const job = workflow.jobs.release;
  const step = findStep(workflow, 'Create Draft Release Pull Request or Publish');

  assert.equal(job.if, "vars.RELEASE_AUTOMATION_ENABLED == 'true'");
  assert.equal(
    'version' in (findStep(workflow, 'Setup pnpm').with ?? {}),
    false,
    'pnpm/action-setup must use the packageManager version from package.json',
  );
  assert.equal(findStep(workflow, 'Setup Node.js 24').with?.['node-version'], 24);
  assert.equal(step.uses, 'changesets/action@ae32849d5ba541f9ae29e40e22a623bc13562f51');
  assert.equal(step.with?.['publish-script'], 'pnpm changeset publish');
  assert.equal(step.with?.['pr-title'], 'Prepare next release');
  assert.equal(step.with?.['pr-draft'], 'create');
  assert.equal(step.with?.['create-github-releases'], true);
  assert.equal(step.with?.['push-git-tags'], true);
  assert.equal(workflow.permissions['id-token'], 'write');
  assert.equal('env' in step, false, 'trusted publishing must not use a long-lived npm token');
});

test('release versioning keeps the packaged payload version aligned with the package', async () => {
  const packageManifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  const payloadManifest = JSON.parse(await readFile(new URL('payload/v1/payload.json', root), 'utf8'));
  const workflow = await readWorkflow('release.yml');
  const step = findStep(workflow, 'Create Draft Release Pull Request or Publish');

  assert.equal(payloadManifest.kitVersion, packageManifest.version);
  assert.equal(step.with?.['version-script'], 'pnpm version-packages');
  assert.equal(packageManifest.scripts['version-packages'], 'changeset version && node scripts/sync-payload-version.mjs');

  const fixture = await mkdtemp(path.join(os.tmpdir(), 'drakom-version-'));
  try {
    await mkdir(path.join(fixture, 'payload', 'v1'), { recursive: true });
    await writeFile(path.join(fixture, 'package.json'), JSON.stringify({ version: '0.2.0' }));
    await writeFile(path.join(fixture, 'payload', 'v1', 'payload.json'), JSON.stringify({ kitVersion: '0.1.0' }));

    const result = spawnSync(process.execPath, [fileURLToPath(new URL('scripts/sync-payload-version.mjs', root))], {
      cwd: fixture,
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    const updated = JSON.parse(await readFile(path.join(fixture, 'payload', 'v1', 'payload.json'), 'utf8'));
    assert.equal(updated.kitVersion, '0.2.0');
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test('workflows use immutable third-party action revisions', async () => {
  const ci = await readWorkflow('ci.yml');
  const release = await readWorkflow('release.yml');

  assert.deepEqual(actionReferences(ci), [
    'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
    'pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413',
    'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
  ]);
  assert.deepEqual(actionReferences(release), [
    'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
    'pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413',
    'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
    'changesets/action@ae32849d5ba541f9ae29e40e22a623bc13562f51',
  ]);
});

test('security policy directs vulnerabilities to GitHub private reporting', async () => {
  const policy = await readFile(new URL('../SECURITY.md', import.meta.url), 'utf8');

  assert.match(policy, /^# Security Policy$/m);
  assert.match(
    policy,
    /https:\/\/github\.com\/TDrake44\/drakom-ai-dev-kit\/security\/advisories\/new/,
  );
  assert.match(policy, /Do not report vulnerabilities through public issues/i);
});

test('Node 24 is the minimum runtime for users, contributors, and release tooling', async () => {
  const nodeVersion = await readFile(new URL('.nvmrc', root), 'utf8');
  const readme = await readFile(new URL('README.md', root), 'utf8');
  const packageManifest = await readFile(new URL('package.json', root), 'utf8');

  assert.equal(nodeVersion.trim(), '24');
  assert.match(packageManifest, /"node": ">=24"/);
  assert.match(packageManifest, /"@types\/node": "\^24\.0\.0"/);
  assert.match(readme, /Package users: Node\.js >= 24\./);
  assert.match(readme, /Contributors and release automation require Node\.js 24 LTS\./);
});
