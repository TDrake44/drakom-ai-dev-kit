import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseCliArgs } from '../dist/cli-arguments.js';
import { DRAKOM_DIR } from '../dist/constants.js';
import { inspectTarget } from '../dist/inspect-target.js';
import { buildInitPlan } from '../dist/operation-plan.js';
import { loadPackagePayload } from '../dist/package-payload.js';
import { renderPlan } from '../dist/render-plan.js';
import { runCli } from '../dist/run-cli.js';
import { compareVersions, loadState } from '../dist/state.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(repositoryRoot, 'dist', 'cli.js');

test('publishes the strict TypeScript CLI from compiled dist output', async () => {
  const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
  const sourceFiles = await readdir(path.join(repositoryRoot, 'src'));

  assert.equal(packageJson.bin['drakom-ai'], 'dist/cli.js');
  assert.equal(sourceFiles.some((file) => file.endsWith('.mjs')), false);
  assert.equal(sourceFiles.every((file) => file.endsWith('.ts')), true);
});

test('exports DRAKOM_DIR constant representing the project-specific AI context directory', () => {
  assert.equal(DRAKOM_DIR, '.drakom-ai');
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

test('parses global and command-specific help without requiring a target path', () => {
  assert.deepEqual(parseCliArgs(['--help']), { command: 'help', topic: 'global' });
  assert.deepEqual(parseCliArgs(['-h']), { command: 'help', topic: 'global' });
  assert.deepEqual(parseCliArgs(['init', '--help']), { command: 'help', topic: 'init' });
  assert.deepEqual(parseCliArgs(['sync', '-h']), { command: 'help', topic: 'sync' });
  assert.deepEqual(parseCliArgs(['init', '.', '--help']), { command: 'help', topic: 'init' });
});

test('renders help successfully before inspecting targets or prompting', async () => {
  /** @type {string[]} */
  const stdout = [];
  /** @type {string[]} */
  const stderr = [];
  const result = await runCli(['init', '\0', '--help'], {
    stdout: { write: (content) => (stdout.push(content), true) },
    stderr: { write: (content) => (stderr.push(content), true) },
    confirm: async () => {
      throw new Error('help must not prompt');
    },
  });

  assert.equal(result, 0);
  assert.equal(stderr.join(''), '');
  assert.match(stdout.join(''), /Usage: drakom-ai init \[path\]/);
  assert.match(stdout.join(''), /--skip-mcp/);
});

test('the compiled executable prints global help and exits successfully', () => {
  const result = spawnSync(process.execPath, [cliPath, '--help'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: drakom-ai <command>/);
  assert.match(result.stdout, /init/);
  assert.match(result.stdout, /sync/);
  assert.equal(result.stderr, '');
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
  const stateDirectory = path.join(root, DRAKOM_DIR);
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
  await assert.rejects(loadState(root), new RegExp(`${DRAKOM_DIR}/state\\.json.*valid JSON`));

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
      `${DRAKOM_DIR}/.gitignore`,
      `${DRAKOM_DIR}/mcp-servers.yaml`,
      `${DRAKOM_DIR}/rules/README.md`,
      `${DRAKOM_DIR}/specs/README.md`,
      '.agents/skills/drakom-ai-setup/SKILL.md',
      '.agents/skills/drakom-ai-setup/references/assessment-plan-template.md',
      'AGENTS.md',
      'CLAUDE.md',
      '.worktreeinclude',
      `${DRAKOM_DIR}/state.json`,
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
  assert.match(skill, new RegExp(`${DRAKOM_DIR}/plans/`));
  assert.match(skill, /drakom-ai sync/);
  assert.match(skill, /verify.*path.*command.*reference/is);
  assert.match(skill, /Do not assume.*custom rules.*skills/is);
  assert.match(skill, new RegExp(`create.*${DRAKOM_DIR}/rules/`, 'is'));
  assert.match(skill, /AGENTS\.md.*Standards Index/is);
  assert.match(skill, /remove or revise.*stale.*route/is);
  assert.match(skill, /not.*globally.*load/is);
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
  assert.equal(
    await readFile(path.join(root, '.worktreeinclude'), 'utf8'),
    `${DRAKOM_DIR}/plans/*\n${DRAKOM_DIR}/assets/*\n`,
  );
  assert.equal(await readFile(path.join(root, DRAKOM_DIR, 'mcp-servers.yaml'), 'utf8'), 'servers: {}\n');
  assert.match(
    await readFile(path.join(root, DRAKOM_DIR, 'rules', 'README.md'), 'utf8'),
    /project-specific policies.*\$drakom-ai-setup/is,
  );
  assert.match(
    await readFile(path.join(root, DRAKOM_DIR, 'specs', 'README.md'), 'utf8'),
    /git-tracked.*specifications/i,
  );
  await readdir(path.join(root, DRAKOM_DIR, 'rules'));
  await readdir(path.join(root, DRAKOM_DIR, 'plans'));
  await readdir(path.join(root, DRAKOM_DIR, 'specs'));
  await readdir(path.join(root, DRAKOM_DIR, 'assets'));
  const state = JSON.parse(await readFile(path.join(root, DRAKOM_DIR, 'state.json'), 'utf8'));
  assert.equal(state.schemaVersion, 1);
  assert.deepEqual(Object.keys(state.managedFiles), [
    `${DRAKOM_DIR}/rules/README.md`,
    `${DRAKOM_DIR}/specs/README.md`,
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
  assert.equal(installed[`${DRAKOM_DIR}/mcp-servers.yaml`], undefined);
  const state = JSON.parse(installed[`${DRAKOM_DIR}/state.json`]);
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

test('init appends local AI context to existing .worktreeinclude', async () => {
  const root = await createFixture();
  await writeFile(path.join(root, '.worktreeinclude'), '.env\n.data/*\n', 'utf8');

  const result = spawnSync(process.execPath, [cliPath, 'init', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    input: 'y\n',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    await readFile(path.join(root, '.worktreeinclude'), 'utf8'),
    `.env\n.data/*\n${DRAKOM_DIR}/plans/*\n${DRAKOM_DIR}/assets/*\n`,
  );
});

test('init preserves existing .worktreeinclude when local AI context is already present', async () => {
  const root = await createFixture();
  const existing = `.env\n${DRAKOM_DIR}/plans/*\n${DRAKOM_DIR}/assets/*\n`;
  await writeFile(path.join(root, '.worktreeinclude'), existing, 'utf8');

  const result = spawnSync(process.execPath, [cliPath, 'init', root, '--dry-run'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PRESERVE \.worktreeinclude/);
});

test('init appends only missing local AI context entry to .worktreeinclude', async () => {
  const root = await createFixture();
  await writeFile(path.join(root, '.worktreeinclude'), `.env\n${DRAKOM_DIR}/plans/*\n`, 'utf8');

  const result = spawnSync(process.execPath, [cliPath, 'init', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    input: 'y\n',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    await readFile(path.join(root, '.worktreeinclude'), 'utf8'),
    `.env\n${DRAKOM_DIR}/plans/*\n${DRAKOM_DIR}/assets/*\n`,
  );
});

test('init reports conflict when .worktreeinclude is a directory', async () => {
  const root = await createFixture();
  await mkdir(path.join(root, '.worktreeinclude'), { recursive: true });

  const result = spawnSync(process.execPath, [cliPath, 'init', root, '--dry-run'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /CONFLICT \.worktreeinclude/);
});

test('init on an initialized repository scaffolds missing .worktreeinclude', async () => {
  const root = await createFixture();
  const initResult = spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  assert.equal(initResult.status, 0);

  const { unlink } = await import('node:fs/promises');
  await unlink(path.join(root, '.worktreeinclude'));

  const adoptResult = spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  assert.equal(adoptResult.status, 0);
  assert.match(adoptResult.stdout, /CREATE\s+\.worktreeinclude/);
  assert.equal(
    await readFile(path.join(root, '.worktreeinclude'), 'utf8'),
    `${DRAKOM_DIR}/plans/*\n${DRAKOM_DIR}/assets/*\n`,
  );

  const thirdResult = spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  assert.equal(thirdResult.status, 0);
  assert.match(thirdResult.stdout, /already initialized; no changes made/);
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

test('sync rejects uninitialized target directories with a clear message', async () => {
  const root = await createFixture();
  const result = spawnSync(process.execPath, [cliPath, 'sync', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not an initialized Drakom installation.*run init/i);
});

test('sync --dry-run previews updates and makes zero filesystem changes', async () => {
  const root = await createFixture();
  const initResult = spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  assert.equal(initResult.status, 0);

  const customSkillDir = path.join(root, '.agents', 'skills', 'custom');
  await mkdir(customSkillDir, { recursive: true });
  await writeFile(
    path.join(customSkillDir, 'SKILL.md'),
    '---\nname: custom\ndescription: Custom skill\n---\n\n# Custom\n',
    'utf8',
  );

  const before = await snapshot(root);
  const dryRunResult = spawnSync(process.execPath, [cliPath, 'sync', root, '--dry-run'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.equal(dryRunResult.status, 0, dryRunResult.stderr);
  assert.match(dryRunResult.stdout, /Drakom AI sync plan/);
  assert.match(dryRunResult.stdout, /CREATE.*\.claude\/skills\/custom\/SKILL\.md/);
  assert.deepEqual(await snapshot(root), before);
});

test('sync --check reports drift and exits nonzero when sync is needed, and exits 0 when clean', async () => {
  const root = await createFixture();
  spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], { cwd: repositoryRoot });

  const customSkillDir = path.join(root, '.agents', 'skills', 'custom');
  await mkdir(customSkillDir, { recursive: true });
  await writeFile(
    path.join(customSkillDir, 'SKILL.md'),
    '---\nname: custom\ndescription: Custom skill\n---\n\n# Custom\n',
    'utf8',
  );

  const before = await snapshot(root);
  const checkResult = spawnSync(process.execPath, [cliPath, 'sync', root, '--check'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  assert.notEqual(checkResult.status, 0);
  assert.deepEqual(await snapshot(root), before);

  const syncResult = spawnSync(process.execPath, [cliPath, 'sync', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  assert.equal(syncResult.status, 0, syncResult.stderr);

  const cleanCheck = spawnSync(process.execPath, [cliPath, 'sync', root, '--check'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  assert.equal(cleanCheck.status, 0, cleanCheck.stderr);
});

test('sync updates unchanged managed files and records state last with updated fingerprints', async () => {
  const root = await createFixture();
  spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], { cwd: repositoryRoot });

  const statePath = path.join(root, DRAKOM_DIR, 'state.json');
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  const setupSkillPath = path.join(root, '.agents', 'skills', 'drakom-ai-setup', 'SKILL.md');

  const oldContent = '# Old Setup Skill Content\n';
  await writeFile(setupSkillPath, oldContent, 'utf8');
  const crypto = await import('node:crypto');
  const oldFp = `sha256:${crypto.createHash('sha256').update(oldContent).digest('hex')}`;
  state.kitVersion = '0.0.9';
  state.managedFiles['.agents/skills/drakom-ai-setup/SKILL.md'].fingerprint = oldFp;
  await writeFile(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');

  const syncResult = spawnSync(process.execPath, [cliPath, 'sync', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  assert.equal(syncResult.status, 0, syncResult.stderr);

  const payload = await loadPackagePayload();
  assert.equal(await readFile(setupSkillPath, 'utf8'), payload.files.setupSkill);

  const updatedState = JSON.parse(await readFile(statePath, 'utf8'));
  assert.equal(updatedState.kitVersion, payload.manifest.kitVersion);
  assert.notEqual(updatedState.managedFiles['.agents/skills/drakom-ai-setup/SKILL.md'].fingerprint, oldFp);

  const snapshotBefore = await snapshot(root);
  const secondSync = spawnSync(process.execPath, [cliPath, 'sync', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  assert.equal(secondSync.status, 0, secondSync.stderr);
  assert.deepEqual(await snapshot(root), snapshotBefore);
});

test('sync stops all writes when a managed file was locally modified', async () => {
  const root = await createFixture();
  spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], { cwd: repositoryRoot });

  const setupSkillPath = path.join(root, '.agents', 'skills', 'drakom-ai-setup', 'SKILL.md');
  await writeFile(setupSkillPath, '# Hand edited setup skill\n', 'utf8');

  const before = await snapshot(root);
  const syncResult = spawnSync(process.execPath, [cliPath, 'sync', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.notEqual(syncResult.status, 0);
  assert.match(syncResult.stdout, /CONFLICT.*drakom-ai-setup\/SKILL\.md/);
  assert.deepEqual(await snapshot(root), before);
});

test('sync stops all writes when a managed block in AGENTS.md was locally modified', async () => {
  const root = await createFixture();
  spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], { cwd: repositoryRoot });

  const agentsPath = path.join(root, 'AGENTS.md');
  const agentsContent = await readFile(agentsPath, 'utf8');
  const modifiedAgents = agentsContent.replace('Drakom AI Development Context', 'Modified Context Heading');
  await writeFile(agentsPath, modifiedAgents, 'utf8');

  const before = await snapshot(root);
  const syncResult = spawnSync(process.execPath, [cliPath, 'sync', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.notEqual(syncResult.status, 0);
  assert.match(syncResult.stdout, /CONFLICT.*AGENTS\.md/);
  assert.deepEqual(await snapshot(root), before);
});

test('sync handles Claude skill mirrors, preserves Claude-only skills, and removes stale mirrors', async () => {
  const root = await createFixture();
  spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], { cwd: repositoryRoot });

  const canonicalDir = path.join(root, '.agents', 'skills', 'tester');
  await mkdir(canonicalDir, { recursive: true });
  await writeFile(
    path.join(canonicalDir, 'SKILL.md'),
    '---\nname: tester\n---\n\n# Tester Skill\n',
    'utf8',
  );

  const claudeOnlyDir = path.join(root, '.claude', 'skills', 'claude-special');
  await mkdir(claudeOnlyDir, { recursive: true });
  await writeFile(
    path.join(claudeOnlyDir, 'SKILL.md'),
    '---\nname: claude-special\n---\n\n# Claude Only Hand Authored\n',
    'utf8',
  );

  const staleDir = path.join(root, '.claude', 'skills', 'old-skill');
  await mkdir(staleDir, { recursive: true });
  const notice = '<!-- GENERATED MIRROR from .agents/skills/. DO NOT EDIT DIRECTLY. Run "drakom-ai sync ." through your package runner to update. -->';
  const staleContent = `${notice}\n\n# Old Skill\n`;
  await writeFile(
    path.join(staleDir, 'SKILL.md'),
    staleContent,
    'utf8',
  );
  await writeFile(
    path.join(staleDir, 'extra.txt'),
    'Extra supporting file\n',
    'utf8',
  );

  const statePath = path.join(root, DRAKOM_DIR, 'state.json');
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  const crypto = await import('node:crypto');
  state.managedSkillMirrors = {
    '.claude/skills/old-skill/SKILL.md': {
      fingerprint: `sha256:${crypto.createHash('sha256').update(staleContent).digest('hex')}`,
    },
  };
  await writeFile(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');

  const syncResult = spawnSync(process.execPath, [cliPath, 'sync', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  assert.equal(syncResult.status, 0, syncResult.stderr);

  const testerMirror = await readFile(path.join(root, '.claude', 'skills', 'tester', 'SKILL.md'), 'utf8');
  assert.match(testerMirror, /GENERATED MIRROR/);

  const claudeOnly = await readFile(path.join(claudeOnlyDir, 'SKILL.md'), 'utf8');
  assert.match(claudeOnly, /# Claude Only Hand Authored/);

  const oldFiles = await readdir(staleDir);
  assert.deepEqual(oldFiles, ['extra.txt']);
});

test('sync stops all writes on collision between canonical skill and hand-authored Claude skill', async () => {
  const root = await createFixture();
  spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], { cwd: repositoryRoot });

  const canonicalDir = path.join(root, '.agents', 'skills', 'tester');
  await mkdir(canonicalDir, { recursive: true });
  await writeFile(
    path.join(canonicalDir, 'SKILL.md'),
    '---\nname: tester\n---\n\n# Tester Skill\n',
    'utf8',
  );

  const claudeDir = path.join(root, '.claude', 'skills', 'tester');
  await mkdir(claudeDir, { recursive: true });
  await writeFile(
    path.join(claudeDir, 'SKILL.md'),
    '---\nname: tester\n---\n\n# Hand Authored Tester\n',
    'utf8',
  );

  const before = await snapshot(root);
  const syncResult = spawnSync(process.execPath, [cliPath, 'sync', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.notEqual(syncResult.status, 0);
  assert.match(syncResult.stdout, /CONFLICT.*\.claude\/skills\/tester/);
  assert.deepEqual(await snapshot(root), before);
});

test('sync rejects projects created with a newer kitVersion than the CLI', async () => {
  const root = await createFixture();
  spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], { cwd: repositoryRoot });

  const statePath = path.join(root, DRAKOM_DIR, 'state.json');
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  state.kitVersion = '99.0.0';
  await writeFile(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');

  const syncResult = spawnSync(process.execPath, [cliPath, 'sync', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.notEqual(syncResult.status, 0);
  assert.match(syncResult.stderr, /newer than CLI kitVersion.*upgrade/i);
});

test('sync stops all writes when a generated Claude skill mirror was locally modified', async () => {
  const root = await createFixture();
  spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], { cwd: repositoryRoot });

  const canonicalDir = path.join(root, '.agents', 'skills', 'tester');
  await mkdir(canonicalDir, { recursive: true });
  await writeFile(
    path.join(canonicalDir, 'SKILL.md'),
    '---\nname: tester\n---\n\n# Tester Skill\n',
    'utf8',
  );

  const sync1 = spawnSync(process.execPath, [cliPath, 'sync', root], { cwd: repositoryRoot });
  assert.equal(sync1.status, 0);

  const mirrorPath = path.join(root, '.claude', 'skills', 'tester', 'SKILL.md');
  const mirrorContent = await readFile(mirrorPath, 'utf8');
  await writeFile(mirrorPath, mirrorContent + '\n# Local edit\n', 'utf8');

  const before = await snapshot(root);
  const sync2 = spawnSync(process.execPath, [cliPath, 'sync', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.notEqual(sync2.status, 0);
  assert.match(sync2.stdout, /CONFLICT.*\.claude\/skills\/tester\/SKILL\.md/);
  assert.deepEqual(await snapshot(root), before);
});

test('sync stops all writes when a stale Claude skill mirror was locally modified', async () => {
  const root = await createFixture();
  spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], { cwd: repositoryRoot });

  const canonicalDir = path.join(root, '.agents', 'skills', 'tester');
  await mkdir(canonicalDir, { recursive: true });
  await writeFile(
    path.join(canonicalDir, 'SKILL.md'),
    '---\nname: tester\n---\n\n# Tester Skill\n',
    'utf8',
  );

  const sync1 = spawnSync(process.execPath, [cliPath, 'sync', root], { cwd: repositoryRoot });
  assert.equal(sync1.status, 0);

  const rm = await import('node:fs/promises');
  await rm.unlink(path.join(canonicalDir, 'SKILL.md'));
  await rm.rmdir(canonicalDir);

  const mirrorPath = path.join(root, '.claude', 'skills', 'tester', 'SKILL.md');
  const mirrorContent = await readFile(mirrorPath, 'utf8');
  await writeFile(mirrorPath, mirrorContent + '\n# Local modification to stale mirror\n', 'utf8');

  const before = await snapshot(root);
  const sync2 = spawnSync(process.execPath, [cliPath, 'sync', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.notEqual(sync2.status, 0);
  assert.match(sync2.stdout, /CONFLICT.*\.claude\/skills\/tester\/SKILL\.md/);
  assert.deepEqual(await snapshot(root), before);
});

test('sync rejects operations that escape target root through a symlinked directory', async () => {
  const root = await createFixture();
  spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], { cwd: repositoryRoot });

  const outsideDir = await createFixture();
  const canaryFile = path.join(outsideDir, 'canary.txt');
  await writeFile(canaryFile, 'CANARY\n', 'utf8');

  const symlink = (await import('node:fs/promises')).symlink;
  await symlink(outsideDir, path.join(root, '.claude'), 'dir');

  const canonicalDir = path.join(root, '.agents', 'skills', 'tester');
  await mkdir(canonicalDir, { recursive: true });
  await writeFile(path.join(canonicalDir, 'SKILL.md'), '# Tester\n', 'utf8');

  const result = spawnSync(process.execPath, [cliPath, 'sync', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /escapes the target through a symlink/i);
  assert.equal(await readFile(canaryFile, 'utf8'), 'CANARY\n');
  const outsideFiles = await readdir(outsideDir);
  assert.deepEqual(outsideFiles, ['canary.txt']);
});

test('sync reports conflict and refuses state update when managed file source is missing in payload', async () => {
  const root = await createFixture();
  spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], { cwd: repositoryRoot });

  const statePath = path.join(root, DRAKOM_DIR, 'state.json');
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  const crypto = await import('node:crypto');
  const obsoleteContent = '# Obsolete\n';
  const obsoleteFp = `sha256:${crypto.createHash('sha256').update(obsoleteContent).digest('hex')}`;
  const obsoletePath = '.agents/skills/obsolete/SKILL.md';
  await mkdir(path.join(root, '.agents', 'skills', 'obsolete'), { recursive: true });
  await writeFile(path.join(root, obsoletePath), obsoleteContent, 'utf8');
  state.managedFiles[obsoletePath] = {
    source: 'skills/obsolete/SKILL.md',
    fingerprint: obsoleteFp,
  };
  state.kitVersion = '0.0.9';
  await writeFile(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');

  const before = await snapshot(root);
  const syncResult = spawnSync(process.execPath, [cliPath, 'sync', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.notEqual(syncResult.status, 0);
  assert.match(syncResult.stdout, /CONFLICT.*obsolete.*missing from package payload/i);
  assert.deepEqual(await snapshot(root), before);
  const stateAfter = JSON.parse(await readFile(statePath, 'utf8'));
  assert.equal(stateAfter.kitVersion, '0.0.9');
});

test('sync --dry-run --check renders preview and exits nonzero when drift exists', async () => {
  const root = await createFixture();
  spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], { cwd: repositoryRoot });

  const canonicalDir = path.join(root, '.agents', 'skills', 'tester');
  await mkdir(canonicalDir, { recursive: true });
  await writeFile(path.join(canonicalDir, 'SKILL.md'), '# Tester\n', 'utf8');

  const before = await snapshot(root);
  const result = spawnSync(process.execPath, [cliPath, 'sync', root, '--dry-run', '--check'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /Drakom AI sync plan/);
  assert.match(result.stderr, /Drift detected/);
  assert.deepEqual(await snapshot(root), before);
});

test('sync upgrades unchanged managed AGENTS.md block while preserving surrounding content', async () => {
  const root = await createFixture();
  spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], { cwd: repositoryRoot });

  const agentsPath = path.join(root, 'AGENTS.md');
  const statePath = path.join(root, DRAKOM_DIR, 'state.json');
  const state = JSON.parse(await readFile(statePath, 'utf8'));

  const oldBlock = `<!-- drakom-ai:start -->
## Drakom AI Development Context

Old instruction body.
<!-- drakom-ai:end -->
`;
  const crypto = await import('node:crypto');
  const oldBlockFp = `sha256:${crypto.createHash('sha256').update(oldBlock).digest('hex')}`;
  state.managedBlocks['AGENTS.md#drakom-ai'] = { fingerprint: oldBlockFp };
  await writeFile(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');

  const agentsContent = `# User Policy Header\n\n${oldBlock}\n## User Policy Footer\n`;
  await writeFile(agentsPath, agentsContent, 'utf8');

  const result = spawnSync(process.execPath, [cliPath, 'sync', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const updatedAgents = await readFile(agentsPath, 'utf8');
  assert.match(updatedAgents, /^# User Policy Header/);
  assert.match(updatedAgents, /## User Policy Footer\n$/);
  assert.match(updatedAgents, /Use `\$drakom-ai-setup` to assess or revise/);
  assert.doesNotMatch(updatedAgents, /Old instruction body/);

  const updatedState = JSON.parse(await readFile(statePath, 'utf8'));
  assert.notEqual(updatedState.managedBlocks['AGENTS.md#drakom-ai'].fingerprint, oldBlockFp);
});

test('sync reports conflict and makes zero writes when an unrecorded Claude skill mirror has local edits', async () => {
  const root = await createFixture();
  spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], { cwd: repositoryRoot });

  const canonicalDir = path.join(root, '.agents', 'skills', 'tester');
  await mkdir(canonicalDir, { recursive: true });
  await writeFile(
    path.join(canonicalDir, 'SKILL.md'),
    '---\nname: tester\n---\n\n# Canonical Tester\n',
    'utf8',
  );

  const notice = '<!-- GENERATED MIRROR from .agents/skills/. DO NOT EDIT DIRECTLY. Run "drakom-ai sync ." through your package runner to update. -->';
  const mirrorDir = path.join(root, '.claude', 'skills', 'tester');
  await mkdir(mirrorDir, { recursive: true });
  await writeFile(
    path.join(mirrorDir, 'SKILL.md'),
    `---\nname: tester\n---\n${notice}\n\n# Locally edited unrecorded mirror\n`,
    'utf8',
  );

  const before = await snapshot(root);
  const syncResult = spawnSync(process.execPath, [cliPath, 'sync', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.notEqual(syncResult.status, 0);
  assert.match(syncResult.stdout, /CONFLICT.*\.claude\/skills\/tester\/SKILL\.md.*unrecorded and does not match expected content/i);
  assert.deepEqual(await snapshot(root), before);
});

test('sync cleanly adopts an unrecorded Claude skill mirror when its content matches expected canonical mirror content', async () => {
  const root = await createFixture();
  spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], { cwd: repositoryRoot });

  const canonicalDir = path.join(root, '.agents', 'skills', 'tester');
  await mkdir(canonicalDir, { recursive: true });
  const canonicalContent = '---\nname: tester\n---\n\n# Canonical Tester\n';
  await writeFile(path.join(canonicalDir, 'SKILL.md'), canonicalContent, 'utf8');

  const notice = '<!-- GENERATED MIRROR from .agents/skills/. DO NOT EDIT DIRECTLY. Run "drakom-ai sync ." through your package runner to update. -->';
  const mirrorDir = path.join(root, '.claude', 'skills', 'tester');
  await mkdir(mirrorDir, { recursive: true });
  const frontmatter = canonicalContent.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0];
  assert(frontmatter);
  const expectedMirrorContent = `${frontmatter}\n${notice}\n\n${canonicalContent.slice(frontmatter.length)}`;
  await writeFile(path.join(mirrorDir, 'SKILL.md'), expectedMirrorContent, 'utf8');

  const stateBefore = JSON.parse(await readFile(path.join(root, DRAKOM_DIR, 'state.json'), 'utf8'));
  assert.equal(stateBefore.managedSkillMirrors?.['.claude/skills/tester/SKILL.md'], undefined);

  const syncResult = spawnSync(process.execPath, [cliPath, 'sync', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.equal(syncResult.status, 0, syncResult.stderr);
  const stateAfter = JSON.parse(await readFile(path.join(root, DRAKOM_DIR, 'state.json'), 'utf8'));
  const crypto = await import('node:crypto');
  const expectedFp = `sha256:${crypto.createHash('sha256').update(expectedMirrorContent).digest('hex')}`;
  assert.equal(stateAfter.managedSkillMirrors?.['.claude/skills/tester/SKILL.md']?.fingerprint, expectedFp);
});

test('sync reports conflict and makes zero writes when a stale Claude skill mirror is unrecorded', async () => {
  const root = await createFixture();
  spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], { cwd: repositoryRoot });

  const notice = '<!-- GENERATED MIRROR from .agents/skills/. DO NOT EDIT DIRECTLY. Run "drakom-ai sync ." through your package runner to update. -->';
  const staleDir = path.join(root, '.claude', 'skills', 'stale-skill');
  await mkdir(staleDir, { recursive: true });
  await writeFile(
    path.join(staleDir, 'SKILL.md'),
    `${notice}\n\n# Stale Skill\n`,
    'utf8',
  );

  const before = await snapshot(root);
  const syncResult = spawnSync(process.execPath, [cliPath, 'sync', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.notEqual(syncResult.status, 0);
  assert.match(syncResult.stdout, /CONFLICT.*\.claude\/skills\/stale-skill\/SKILL\.md.*is unrecorded/i);
  assert.deepEqual(await snapshot(root), before);
});

test('sync rejects invalid SemVer kitVersion in state', async () => {
  const root = await createFixture();
  spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], { cwd: repositoryRoot });

  const statePath = path.join(root, DRAKOM_DIR, 'state.json');
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  state.kitVersion = '1.0';
  await writeFile(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');

  const syncResult = spawnSync(process.execPath, [cliPath, 'sync', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.notEqual(syncResult.status, 0);
  assert.match(syncResult.stderr, /invalid SemVer kitVersion/i);
});

test('SemVer compareVersions adheres to SemVer 2.0.0 precedence', () => {
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('2.0.0', '1.9.9'), 1);
  assert.equal(compareVersions('1.1.0', '1.0.9'), 1);
  assert.equal(compareVersions('1.0.1', '1.0.0'), 1);
  assert.equal(compareVersions('0.9.9', '1.0.0'), -1);

  // Normal vs pre-release
  assert.equal(compareVersions('1.0.0', '1.0.0-beta'), 1);
  assert.equal(compareVersions('1.0.0-rc.1', '1.0.0'), -1);

  // Pre-release precedence ordering
  assert.equal(compareVersions('1.0.0-alpha', '1.0.0-alpha.1'), -1);
  assert.equal(compareVersions('1.0.0-alpha.1', '1.0.0-alpha.beta'), -1);
  assert.equal(compareVersions('1.0.0-alpha.beta', '1.0.0-beta'), -1);
  assert.equal(compareVersions('1.0.0-beta', '1.0.0-beta.2'), -1);
  assert.equal(compareVersions('1.0.0-beta.2', '1.0.0-beta.11'), -1);
  assert.equal(compareVersions('1.0.0-beta.11', '1.0.0-rc.1'), -1);

  // Build metadata is ignored in precedence
  assert.equal(compareVersions('1.0.0+build.1', '1.0.0+build.2'), 0);
  assert.equal(compareVersions('1.0.0-alpha+001', '1.0.0-alpha'), 0);

  // Large numeric identifiers exceeding Number.MAX_SAFE_INTEGER
  assert.equal(compareVersions('9007199254740993.0.0', '9007199254740992.0.0'), 1);
  assert.equal(compareVersions('9007199254740992.0.0', '9007199254740993.0.0'), -1);
  assert.equal(compareVersions('1.9007199254740993.0', '1.9007199254740992.0'), 1);
  assert.equal(compareVersions('1.0.9007199254740993', '1.0.9007199254740992'), 1);
  assert.equal(compareVersions('1.0.0-9007199254740993', '1.0.0-9007199254740992'), 1);
  assert.equal(compareVersions('1.0.0-9007199254740992', '1.0.0-9007199254740993'), -1);

  // Invalid SemVer strings throw
  assert.throws(() => compareVersions('1.0', '1.0.0'), /Invalid SemVer/);
  assert.throws(() => compareVersions('1.0.0', '1.0.0-01'), /Invalid SemVer/);
  assert.throws(() => compareVersions('v1.0.0', '1.0.0'), /Invalid SemVer/);
  assert.throws(() => compareVersions('1.0.0.0', '1.0.0'), /Invalid SemVer/);
});
