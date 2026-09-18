import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseCliArgs } from '../dist/cli-arguments.js';
import { inspectTarget } from '../dist/inspect-target.js';
import { buildInitPlan } from '../dist/operation-plan.js';
import { loadPackagePayload } from '../dist/package-payload.js';
import { renderPlan } from '../dist/render-plan.js';
import { loadState } from '../dist/state.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(repositoryRoot, 'dist', 'cli.js');

test('publishes the strict TypeScript CLI from compiled dist output', async () => {
  const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
  const sourceFiles = await readdir(path.join(repositoryRoot, 'src'));

  assert.equal(packageJson.bin['drakom-ai'], 'dist/cli.js');
  assert.equal(sourceFiles.some((file) => file.endsWith('.mjs')), false);
  assert.equal(sourceFiles.every((file) => file.endsWith('.ts')), true);
});

async function createFixture() {
  return mkdtemp(path.join(os.tmpdir(), 'drakom-adoption-'));
}

/** @param {string} root */
async function snapshot(root) {
  /** @type {Record<string, string>} */
  const result = {};

  /** @param {string} directory */
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(root, absolutePath);
      if (entry.isDirectory()) {
        result[`${relativePath}/`] = 'directory';
        await visit(absolutePath);
      } else {
        result[relativePath] = await readFile(absolutePath, 'utf8');
      }
    }
  }

  await visit(root);
  return result;
}

test('parses the documented init and sync command surfaces', () => {
  assert.deepEqual(parseCliArgs(['init', 'project', '--dry-run', '--yes', '--skip-mcp']), {
    command: 'init',
    targetPath: 'project',
    dryRun: true,
    yes: true,
    skipMcp: true,
  });
  assert.deepEqual(parseCliArgs(['sync', '--check']), {
    command: 'sync',
    targetPath: '.',
    dryRun: false,
    check: true,
  });
  assert.throws(() => parseCliArgs(['init', '--check']), /--check.*sync/);
  assert.throws(() => parseCliArgs(['sync', '--yes']), /--yes.*init/);
  assert.throws(() => parseCliArgs(['unknown']), /Expected "init" or "sync"/);
});

test('inventories existing AI context and MCP targets', async () => {
  const root = await createFixture();
  await mkdir(path.join(root, 'packages', 'api'), { recursive: true });
  await mkdir(path.join(root, '.agents', 'skills', 'custom'), { recursive: true });
  await mkdir(path.join(root, '.vscode'), { recursive: true });
  await writeFile(path.join(root, 'AGENTS.md'), '# Existing\n', 'utf8');
  await writeFile(path.join(root, 'packages', 'api', 'CLAUDE.md'), '# Nested\n', 'utf8');
  await writeFile(path.join(root, '.agents', 'skills', 'custom', 'SKILL.md'), '# Custom\n', 'utf8');
  await writeFile(path.join(root, '.vscode', 'mcp.json'), '{"servers":{}}\n', 'utf8');

  const inventory = await inspectTarget(root);

  assert.equal(inventory.status, 'existing');
  assert.deepEqual(inventory.contextFiles, ['AGENTS.md', 'packages/api/CLAUDE.md']);
  assert.deepEqual(inventory.skillFiles, ['.agents/skills/custom/SKILL.md']);
  assert.deepEqual(inventory.mcpFiles, ['.vscode/mcp.json']);
  assert.equal(inventory.state, null);
});

test('loads valid state and rejects malformed or future state with an actionable path', async () => {
  const root = await createFixture();
  const stateDirectory = path.join(root, '.drakom-ai');
  await mkdir(stateDirectory);
  await writeFile(
    path.join(stateDirectory, 'state.json'),
    JSON.stringify({
      schemaVersion: 1,
      kitVersion: '0.1.0',
      features: { mcp: true, skillMirrors: true },
      managedFiles: {},
      managedMcpServers: {},
    }),
    'utf8',
  );

  assert.equal((await loadState(root))?.schemaVersion, 1);

  await writeFile(path.join(stateDirectory, 'state.json'), '{', 'utf8');
  await assert.rejects(loadState(root), /\.drakom-ai\/state\.json.*valid JSON/);

  await writeFile(
    path.join(stateDirectory, 'state.json'),
    JSON.stringify({ schemaVersion: 2 }),
    'utf8',
  );
  await assert.rejects(loadState(root), /schemaVersion 2.*newer.*upgrade/i);
});

test('builds and renders deterministic fresh-project plans', async () => {
  const root = await createFixture();
  const inventory = await inspectTarget(root);
  const payload = await loadPackagePayload();

  const firstPlan = buildInitPlan(inventory, { skipMcp: false }, payload);
  const secondPlan = buildInitPlan(inventory, { skipMcp: false }, payload);

  assert.deepEqual(firstPlan, secondPlan);
  assert.equal(renderPlan(firstPlan), renderPlan(secondPlan));
  assert.deepEqual(
    firstPlan.operations.filter((operation) => operation.action === 'create').map(({ path: value }) => value),
    [
      '.drakom-ai/.gitignore',
      '.drakom-ai/mcp-servers.yaml',
      '.agents/skills/drakom-ai-setup/SKILL.md',
      '.agents/skills/drakom-ai-setup/references/assessment-plan-template.md',
      'AGENTS.md',
      'CLAUDE.md',
      '.drakom-ai/state.json',
    ],
  );
  assert.match(renderPlan(firstPlan), /CREATE .*drakom-ai-setup\/SKILL\.md/);
  assert.match(renderPlan(firstPlan), /PRESERVE .*existing files/i);
});

test('init --dry-run is deterministic and makes zero filesystem changes', async () => {
  const root = await createFixture();
  await writeFile(path.join(root, 'README.md'), '# Keep me\n', 'utf8');
  const before = await snapshot(root);

  const first = spawnSync(process.execPath, [cliPath, 'init', root, '--dry-run'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  const second = spawnSync(process.execPath, [cliPath, 'init', root, '--dry-run'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(first.stdout, second.stdout);
  assert.deepEqual(await snapshot(root), before);
});

test('init --dry-run rejects missing targets without creating them', () => {
  const target = path.join(os.tmpdir(), `drakom-missing-${process.pid}-${Date.now()}`);
  const result = spawnSync(process.execPath, [cliPath, 'init', target, '--dry-run'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Target path does not exist/);
});

test('packages a complete approval-gated setup workflow and assessment template', async () => {
  const payload = await loadPackagePayload();
  const skill = payload.files.setupSkill;
  const assessment = payload.files.assessmentTemplate;

  assert.match(skill, /languages, manifests, package managers/i);
  assert.match(skill, /keep.*refine.*add.*omit/is);
  assert.match(skill, /stable policy.*rule/is);
  assert.match(skill, /recurring multi-step workflow.*skill/is);
  assert.match(skill, /explicit approval/i);
  assert.match(skill, /\.drakom-ai\/plans\//);
  assert.match(skill, /drakom-ai sync/);
  assert.match(skill, /verify.*path.*command.*reference/is);
  assert.match(skill, /Do not assume.*custom rules.*skills/is);
  assert.doesNotMatch(skill, /legacy|\.ai\//i);
  assert.match(assessment, /## Keep/);
  assert.match(assessment, /## Refine/);
  assert.match(assessment, /## Add/);
  assert.match(assessment, /## Omit/);
  assert.match(assessment, /## Approval Gate/);
  assert.doesNotMatch(assessment, /legacy|\.ai\//i);
});

test('init --yes creates fresh scaffolding, records state last, and is idempotent', async () => {
  const root = await createFixture();

  const first = spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /Ask your coding agent to use \$drakom-ai-setup/);
  assert.equal(await readFile(path.join(root, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n');
  assert.equal(await readFile(path.join(root, '.drakom-ai', 'mcp-servers.yaml'), 'utf8'), 'servers: {}\n');
  await readdir(path.join(root, '.drakom-ai', 'rules'));
  await readdir(path.join(root, '.drakom-ai', 'plans'));
  await readdir(path.join(root, '.drakom-ai', 'specs'));
  await readdir(path.join(root, '.drakom-ai', 'assets'));
  const state = JSON.parse(await readFile(path.join(root, '.drakom-ai', 'state.json'), 'utf8'));
  assert.equal(state.schemaVersion, 1);
  assert.deepEqual(Object.keys(state.managedFiles), [
    '.agents/skills/drakom-ai-setup/SKILL.md',
    '.agents/skills/drakom-ai-setup/references/assessment-plan-template.md',
  ]);
  const afterFirst = await snapshot(root);
  assert.equal((await inspectTarget(root)).status, 'initialized');

  const second = spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(await snapshot(root), afterFirst);
});

test('init --skip-mcp omits the registry and records the disabled feature', async () => {
  const root = await createFixture();

  const result = spawnSync(process.execPath, [cliPath, 'init', root, '--yes', '--skip-mcp'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const installed = await snapshot(root);
  assert.equal(installed['.drakom-ai/mcp-servers.yaml'], undefined);
  const state = JSON.parse(installed['.drakom-ai/state.json']);
  assert.equal(state.features.mcp, false);
});

test('init --yes refuses structured merges and makes zero changes', async () => {
  const root = await createFixture();
  await writeFile(path.join(root, 'AGENTS.md'), '# Existing policy\n', 'utf8');
  const before = await snapshot(root);

  const result = spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--yes.*create-only.*interactive/i);
  assert.deepEqual(await snapshot(root), before);
});

test('interactive init preserves and extends existing entry points exactly as previewed', async () => {
  const root = await createFixture();
  await writeFile(path.join(root, 'AGENTS.md'), '# Existing policy\n', 'utf8');
  await writeFile(path.join(root, 'CLAUDE.md'), '# Claude-only note\n', 'utf8');

  const result = spawnSync(process.execPath, [cliPath, 'init', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    input: 'y\n',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(await readFile(path.join(root, 'AGENTS.md'), 'utf8'), /^# Existing policy\n\n<!-- drakom-ai:start -->/);
  assert.equal(
    await readFile(path.join(root, 'CLAUDE.md'), 'utf8'),
    '# Claude-only note\n\n@AGENTS.md\n',
  );
});

test('preflight conflicts prevent every initialization mutation', async () => {
  const root = await createFixture();
  const collision = path.join(root, '.agents', 'skills', 'drakom-ai-setup');
  await mkdir(collision, { recursive: true });
  await writeFile(path.join(collision, 'SKILL.md'), '# Project-owned\n', 'utf8');
  const before = await snapshot(root);

  const result = spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /CONFLICT.*drakom-ai-setup\/SKILL\.md/);
  assert.deepEqual(await snapshot(root), before);
});
