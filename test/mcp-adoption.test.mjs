import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { inspectTarget } from '../dist/inspect-target.js';
import {
  discoverMcp,
  renderMcpComparisonReport,
  applyMcpImport,
} from '../dist/mcp-discovery.js';
import { validateMcpRegistry } from '../dist/mcp-generation.js';
import { buildSyncPlan } from '../dist/operation-plan.js';
import { loadPackagePayload } from '../dist/package-payload.js';
import { loadState } from '../dist/state.js';
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(repositoryRoot, 'dist', 'cli.js');

const createFixture = () => mkdtemp(path.join(os.tmpdir(), 'drakom-mcp-adoption-'));

/**
 * @param {string} root @param {'init' | 'sync'} command @param {string[]} [options]
 */
function runMcpCli(root, command, options = []) {
  return spawnSync(process.execPath, [cliPath, command, root, ...options], { cwd: repositoryRoot, encoding: 'utf8' });
}

async function createInitializedMcpFixture() {
  const root = await createFixture();
  runMcpCli(root, 'init', ['--yes']);
  return root;
}

/** @param {string} root @param {string} relativePath @param {string} contents @param {BufferEncoding} [encoding] */
async function writeFixture(root, relativePath, contents, encoding = 'utf8') {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents, encoding);
}

/** @param {string} root @param {string} relativePath */
async function readFixtureJson(root, relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
}

/** @param {string} root @param {string} relativePath */
function readFixtureText(root, relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

/** @param {string} root */
async function snapshot(root) {
  /** @type {Record<string, string>} */
  const result = {};
  async function visit(/** @type {string} */ directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(root, absolutePath);
      if (entry.isDirectory()) {
        result[`${relativePath}/`] = 'directory';
        await visit(absolutePath);
      } else result[relativePath] = await readFile(absolutePath, 'utf8');
    }
  }
  await visit(root);
  return result;
}

test('MCP discovery inspects repository-local MCP configuration and parses supported client formats', async () => {
  const root = await createFixture();
  await writeFixture(
    root,
    '.mcp.json',
    JSON.stringify({
      mcpServers: {
        'claude-server': {
          command: 'node',
          args: ['./server.js'],
          env: { NODE_ENV: 'production' },
        },
      },
    }),
    'utf8',
  );

  await writeFixture(
    root,
    '.vscode/mcp.json',
    JSON.stringify({
      servers: {
        'vscode-server': {
          type: 'stdio',
          command: 'python',
          args: ['-m', 'server'],
        },
      },
    }),
    'utf8',
  );

  await writeFixture(
    root,
    '.agents/mcp_config.json',
    JSON.stringify({
      mcpServers: {
        'antigravity-server': {
          serverUrl: 'https://mcp.example.com/agy',
          headers: { 'X-Custom': 'header' },
        },
      },
    }),
    'utf8',
  );

  await writeFixture(
    root,
    '.codex/config.toml',
    `[mcp_servers.codex-server]
command = "uvx"
args = ["mcp-server-fetch"]
`,
    'utf8',
  );

  const inventory = await inspectTarget(root);
  const discovered = discoverMcp(inventory);

  assert.equal(discovered.servers.size, 4);
  assert.ok(discovered.servers.has('claude-server'));
  assert.ok(discovered.servers.has('vscode-server'));
  assert.ok(discovered.servers.has('antigravity-server'));
  assert.ok(discovered.servers.has('codex-server'));
});

test('MCP comparison model classifies entries: identical, equivalent with overrides, conflicting, unsupported, and literal credentials', async () => {
  const root = await createFixture();
  // 1. Identical across clients (.mcp.json and .vscode/mcp.json)
  await writeFixture(
    root,
    '.mcp.json',
    JSON.stringify({
      mcpServers: {
        'shared-tools': { command: 'node', args: ['./shared.js'] },
        'override-tools': { command: 'node', args: ['./main.js'] },
        'conflict-tools': { command: 'node', args: ['./version-a.js'] },
        'unsupported-entry': { command: 12345 },
        'secret-bearing': { command: 'node', env: { API_KEY: 'sk-live-secret123456789' } },
      },
    }),
    'utf8',
  );

  await writeFixture(
    root,
    '.vscode/mcp.json',
    JSON.stringify({
      servers: {
        'shared-tools': { type: 'stdio', command: 'node', args: ['./shared.js'] },
        'override-tools': { type: 'stdio', command: 'node', args: ['./main.js', '--vscode'] },
        'conflict-tools': { type: 'stdio', command: 'python', args: ['./other.py'] },
      },
    }),
    'utf8',
  );

  const inventory = await inspectTarget(root);
  const discovered = discoverMcp(inventory);

  const shared = discovered.servers.get('shared-tools');
  assert.ok(shared);
  assert.equal(shared.classification, 'identical');

  const override = discovered.servers.get('override-tools');
  assert.ok(override);
  assert.equal(override.classification, 'equivalent_override');

  const conflict = discovered.servers.get('conflict-tools');
  assert.ok(conflict);
  assert.equal(conflict.classification, 'conflicting');

  const unsupported = discovered.servers.get('unsupported-entry');
  assert.ok(unsupported);
  assert.equal(unsupported.classification, 'unsupported');

  const secret = discovered.servers.get('secret-bearing');
  assert.ok(secret);
  assert.equal(secret.classification, 'literal_credentials');
});

test('MCP credential detection never echoes literal secrets in reports, diagnostics, or import output', async () => {
  const root = await createFixture();
  const rawSecret = 'super-secret-password-xyz-987';
  await writeFixture(
    root,
    '.mcp.json',
    JSON.stringify({
      mcpServers: {
        'secret-server': {
          command: 'node',
          env: {
            DB_PASSWORD: rawSecret,
            SAFE_VAR: '${DB_PASSWORD}',
          },
        },
      },
    }),
    'utf8',
  );

  const inventory = await inspectTarget(root);
  const discovered = discoverMcp(inventory);
  const report = renderMcpComparisonReport(discovered);

  assert.match(report, /secret-server/);
  assert.match(report, /literal credential/i);
  assert.doesNotMatch(report, new RegExp(rawSecret));

  // Refuses import
  assert.throws(
    () =>
      applyMcpImport(
        'servers: {}\n',
        { 'secret-server': 'import' },
        discovered,
      ),
    /literal credential/i,
  );
});

test('renderMcpComparisonReport presents import choices: import, import with overrides, leave unmanaged, skip', async () => {
  const root = await createFixture();
  await writeFixture(
    root,
    '.mcp.json',
    JSON.stringify({
      mcpServers: {
        'clean-server': { command: 'node', args: ['./clean.js'] },
        'override-server': { command: 'node' },
      },
    }),
    'utf8',
  );

  await writeFixture(
    root,
    '.vscode/mcp.json',
    JSON.stringify({
      servers: {
        'override-server': { type: 'stdio', command: 'node', args: ['--vscode-only'] },
      },
    }),
    'utf8',
  );

  const inventory = await inspectTarget(root);
  const discovered = discoverMcp(inventory);
  const report = renderMcpComparisonReport(discovered);

  assert.match(report, /Import into \.drakom-ai\/mcp-servers\.yaml/);
  assert.match(report, /Import with explicit client overrides/);
  assert.match(report, /Leave unmanaged/);
  assert.match(report, /Skip MCP management/);
});

test('safe approved import writes valid entries to registry YAML and refuses unsafe operations', async () => {
  const root = await createFixture();
  await writeFixture(
    root,
    '.mcp.json',
    JSON.stringify({
      mcpServers: {
        'my-server': { command: 'node', args: ['./server.js'] },
        'conflict-server': { command: 'node' },
      },
    }),
    'utf8',
  );

  await writeFixture(
    root,
    '.vscode/mcp.json',
    JSON.stringify({
      servers: {
        'conflict-server': { type: 'stdio', command: 'python' },
      },
    }),
    'utf8',
  );

  const inventory = await inspectTarget(root);
  const discovered = discoverMcp(inventory);

  const initialYaml = 'servers:\n  existing-server:\n    command: existing\n';
  const updatedYaml = applyMcpImport(
    initialYaml,
    { 'my-server': 'import', 'conflict-server': 'leave_unmanaged' },
    discovered,
  );

  assert.match(updatedYaml, /existing-server:/);
  assert.match(updatedYaml, /my-server:/);
  assert.doesNotMatch(updatedYaml, /conflict-server:/);

  // Attempting to import a conflicting server must throw
  assert.throws(
    () =>
      applyMcpImport(
        initialYaml,
        { 'conflict-server': 'import' },
        discovered,
      ),
    /conflicting/i,
  );
});

test('sync generates managed MCP entries into all supported client targets and updates state fingerprints', async () => {
  const root = await createFixture();
  const initResult = runMcpCli(root, 'init', ['--yes']);
  assert.equal(initResult.status, 0, initResult.stderr);

  await writeFixture(
    root,
    '.drakom-ai/mcp-servers.yaml',
    `servers:
  local-tools:
    command: node
    args: ['./server.mjs']
    env:
      LOG_LEVEL: info
      TOKEN: "\${TOKEN}"
  docs:
    http:
      url: https://mcp.example.com/docs
      headers:
        X-Client: drakom
`,
    'utf8',
  );

  const syncResult = runMcpCli(root, 'sync');
  assert.equal(syncResult.status, 0, syncResult.stderr);

  // Verify .mcp.json
  const claude = await readFixtureJson(root, '.mcp.json');
  assert.deepEqual(claude.mcpServers['local-tools'], {
    command: 'node',
    args: ['./server.mjs'],
    env: { LOG_LEVEL: 'info', TOKEN: '${TOKEN}' },
  });
  assert.deepEqual(claude.mcpServers.docs, {
    type: 'http',
    url: 'https://mcp.example.com/docs',
    headers: { 'X-Client': 'drakom' },
  });

  // Verify .vscode/mcp.json
  const vscode = await readFixtureJson(root, '.vscode/mcp.json');
  assert.equal(vscode.servers['local-tools'].type, 'stdio');
  assert.equal(vscode.servers.docs.type, 'http');

  // Verify .agents/mcp_config.json
  const antigravity = await readFixtureJson(root, '.agents/mcp_config.json');
  assert.equal(antigravity.mcpServers.docs.serverUrl, 'https://mcp.example.com/docs');

  // Verify .codex/config.toml
  const codex = await readFixtureText(root, '.codex/config.toml');
  assert.match(codex, /BEGIN Drakom AI Development Context MCP servers/);
  assert.match(codex, /\[mcp_servers\.local-tools\]/);
  assert.match(codex, /\[mcp_servers\.docs\]/);

  // Verify state.json records managedMcpServers with per-server fingerprints
  const state = await loadState(root);
  assert.ok(state);
  assert.ok(state.managedMcpServers['local-tools']);
  assert.ok(state.managedMcpServers['local-tools'].sourceFingerprint.startsWith('sha256:'));
  assert.ok(state.managedMcpServers['local-tools'].targetFingerprints['.mcp.json']);
  assert.ok(state.managedMcpServers['local-tools'].targetFingerprints['.vscode/mcp.json']);
  assert.ok(state.managedMcpServers['local-tools'].targetFingerprints['.agents/mcp_config.json']);
  assert.ok(state.managedMcpServers['local-tools'].targetFingerprints['.codex/config.toml']);

  // Idempotency: second sync produces no changes
  const snapshotBefore = await snapshot(root);
  const secondSync = runMcpCli(root, 'sync');
  assert.equal(secondSync.status, 0, secondSync.stderr);
  assert.deepEqual(await snapshot(root), snapshotBefore);
});

test('sync cleanly adopts identical existing unmanaged servers without destructive rewrites', async () => {
  const root = await createInitializedMcpFixture();

  // Pre-existing unmanaged .mcp.json with an unmanaged setting and the server
  await writeFile(
    path.join(root, '.mcp.json'),
    JSON.stringify({
      projectCustomSetting: 'keep-me',
      mcpServers: {
        'fetch-tool': {
          command: 'uvx',
          args: ['mcp-server-fetch'],
        },
      },
    }, null, 2) + '\n',
    'utf8',
  );

  // Now the server is added to .drakom-ai/mcp-servers.yaml
  await writeFile(
    path.join(root, '.drakom-ai', 'mcp-servers.yaml'),
    `servers:
  fetch-tool:
    command: uvx
    args:
      - mcp-server-fetch
`,
    'utf8',
  );

  const syncResult = runMcpCli(root, 'sync');
  assert.equal(syncResult.status, 0, syncResult.stderr);

  // Custom setting is preserved
  const claude = JSON.parse(await readFile(path.join(root, '.mcp.json'), 'utf8'));
  assert.equal(claude.projectCustomSetting, 'keep-me');
  assert.deepEqual(claude.mcpServers['fetch-tool'], {
    command: 'uvx',
    args: ['mcp-server-fetch'],
  });

  // State now tracks fetch-tool as managed
  const state = await loadState(root);
  assert.ok(state?.managedMcpServers['fetch-tool']);
});

test('sync preserves unrelated settings and unmanaged MCP servers in all client files', async () => {
  const root = await createInitializedMcpFixture();

  await mkdir(path.join(root, '.vscode'), { recursive: true });
  await mkdir(path.join(root, '.codex'), { recursive: true });

  await writeFile(
    path.join(root, '.vscode', 'mcp.json'),
    JSON.stringify({
      $schema: 'https://example.com/schema',
      servers: {
        'unmanaged-vscode-server': {
          type: 'stdio',
          command: 'personal-binary',
        },
      },
    }),
    'utf8',
  );

  await writeFile(
    path.join(root, '.codex', 'config.toml'),
    `# Unmanaged Codex settings
model = "o3-mini"

[mcp_servers.unmanaged-codex]
command = "personal-codex"
`,
    'utf8',
  );

  await writeFile(
    path.join(root, '.drakom-ai', 'mcp-servers.yaml'),
    `servers:
  managed-server:
    command: node
    args: ['./managed.js']
`,
    'utf8',
  );

  const syncResult = runMcpCli(root, 'sync');
  assert.equal(syncResult.status, 0, syncResult.stderr);

  const vscode = JSON.parse(await readFile(path.join(root, '.vscode', 'mcp.json'), 'utf8'));
  assert.equal(vscode.$schema, 'https://example.com/schema');
  assert.ok(vscode.servers['unmanaged-vscode-server']);
  assert.ok(vscode.servers['managed-server']);

  const codex = await readFile(path.join(root, '.codex', 'config.toml'), 'utf8');
  assert.match(codex, /model = "o3-mini"/);
  assert.match(codex, /\[mcp_servers\.unmanaged-codex\]/);
  assert.match(codex, /\[mcp_servers\.managed-server\]/);
});

test('sync detects conflict and refuses all writes when a generated entry is manually edited', async () => {
  const root = await createInitializedMcpFixture();

  await writeFile(
    path.join(root, '.drakom-ai', 'mcp-servers.yaml'),
    `servers:
  tools:
    command: node
    args: ['./tools.js']
`,
    'utf8',
  );

  const sync1 = runMcpCli(root, 'sync');
  assert.equal(sync1.status, 0, sync1.stderr);

  // Manually edit the generated server in .mcp.json
  const claudePath = path.join(root, '.mcp.json');
  const claude = JSON.parse(await readFile(claudePath, 'utf8'));
  claude.mcpServers.tools.command = 'hacked-command';
  await writeFile(claudePath, JSON.stringify(claude, null, 2) + '\n', 'utf8');

  const before = await snapshot(root);
  const sync2 = runMcpCli(root, 'sync');

  assert.notEqual(sync2.status, 0);
  assert.match(sync2.stdout, /CONFLICT.*\.mcp\.json.*tools.*edited manually/i);
  assert.deepEqual(await snapshot(root), before);
});

test('sync stops before any mutation on same-name conflict with an existing unmanaged server', async () => {
  const root = await createInitializedMcpFixture();

  await writeFile(
    path.join(root, '.mcp.json'),
    JSON.stringify({
      mcpServers: {
        'my-tool': {
          command: 'existing-different-tool',
        },
      },
    }),
    'utf8',
  );

  await writeFile(
    path.join(root, '.drakom-ai', 'mcp-servers.yaml'),
    `servers:
  my-tool:
    command: newly-defined-tool
`,
    'utf8',
  );

  const before = await snapshot(root);
  const syncResult = runMcpCli(root, 'sync');

  assert.notEqual(syncResult.status, 0);
  assert.match(syncResult.stdout, /CONFLICT.*\.mcp\.json.*replace an existing unmanaged MCP server "my-tool"/i);
  assert.deepEqual(await snapshot(root), before);
});

test('sync updates target files when registry source changes and targets were not manually edited', async () => {
  const root = await createInitializedMcpFixture();

  const mcpYaml = path.join(root, '.drakom-ai', 'mcp-servers.yaml');
  await writeFile(
    mcpYaml,
    `servers:
  tools:
    command: node
    args: ['v1']
`,
    'utf8',
  );

  const sync1 = runMcpCli(root, 'sync');
  assert.equal(sync1.status, 0, sync1.stderr);

  // Update source
  await writeFile(
    mcpYaml,
    `servers:
  tools:
    command: node
    args: ['v2']
`,
    'utf8',
  );

  const sync2 = runMcpCli(root, 'sync');
  assert.equal(sync2.status, 0, sync2.stderr);

  const claude = JSON.parse(await readFile(path.join(root, '.mcp.json'), 'utf8'));
  assert.deepEqual(claude.mcpServers.tools.args, ['v2']);
});

test('sync safely removes deleted servers from targets while preserving unmanaged entries', async () => {
  const root = await createInitializedMcpFixture();

  const mcpYaml = path.join(root, '.drakom-ai', 'mcp-servers.yaml');
  await writeFile(
    mcpYaml,
    `servers:
  server-one:
    command: one
  server-two:
    command: two
`,
    'utf8',
  );

  const sync1 = runMcpCli(root, 'sync');
  assert.equal(sync1.status, 0, sync1.stderr);

  // Add an unmanaged server
  const claudePath = path.join(root, '.mcp.json');
  const claude = JSON.parse(await readFile(claudePath, 'utf8'));
  claude.mcpServers['unmanaged-extra'] = { command: 'extra' };
  await writeFile(claudePath, JSON.stringify(claude, null, 2) + '\n', 'utf8');

  // Remove server-one from mcp-servers.yaml
  await writeFile(
    mcpYaml,
    `servers:
  server-two:
    command: two
`,
    'utf8',
  );

  const sync2 = runMcpCli(root, 'sync');
  assert.equal(sync2.status, 0, sync2.stderr);

  const claudeAfter = JSON.parse(await readFile(claudePath, 'utf8'));
  assert.equal(claudeAfter.mcpServers['server-one'], undefined);
  assert.ok(claudeAfter.mcpServers['server-two']);
  assert.ok(claudeAfter.mcpServers['unmanaged-extra']);

  const state = await loadState(root);
  assert.equal(state?.managedMcpServers['server-one'], undefined);
  assert.ok(state?.managedMcpServers['server-two']);
});

test('sync --dry-run and sync --check verify MCP drift without modifying filesystem', async () => {
  const root = await createInitializedMcpFixture();

  await writeFile(
    path.join(root, '.drakom-ai', 'mcp-servers.yaml'),
    `servers:
  dry-tool:
    command: node
`,
    'utf8',
  );

  const before = await snapshot(root);

  // dry-run
  const dryRun = runMcpCli(root, 'sync', ['--dry-run']);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.match(dryRun.stdout, /CREATE.*\.mcp\.json/);
  assert.deepEqual(await snapshot(root), before);

  // check detects drift
  const check = runMcpCli(root, 'sync', ['--check']);
  assert.equal(check.status, 2);
  assert.match(check.stderr, /Drift detected/i);
  assert.deepEqual(await snapshot(root), before);
});

test('MCP credential detection catches literal secrets inside client overrides and refuses generation', async () => {
  const root = await createInitializedMcpFixture();

  const rawSecret = 'sk-live-override-secret-key-999';
  const mcpYaml = path.join(root, '.drakom-ai', 'mcp-servers.yaml');
  await writeFile(
    mcpYaml,
    `servers:
  codex-tool:
    command: node
    overrides:
      codex:
        env:
          API_KEY: "${rawSecret}"
`,
    'utf8',
  );

  const before = await snapshot(root);
  const syncResult = runMcpCli(root, 'sync');

  assert.notEqual(syncResult.status, 0);
  assert.match(syncResult.stdout, /CONFLICT.*\.drakom-ai\/mcp-servers\.yaml.*literal credentials in overrides\.codex\.env\.API_KEY/i);
  assert.doesNotMatch(syncResult.stdout, new RegExp(rawSecret));
  assert.doesNotMatch(syncResult.stderr, new RegExp(rawSecret));
  assert.deepEqual(await snapshot(root), before);
});

test('sync detects conflict when a managed Codex entry is manually edited inside the block', async () => {
  const root = await createInitializedMcpFixture();

  await writeFile(
    path.join(root, '.drakom-ai', 'mcp-servers.yaml'),
    `servers:
  tools:
    command: node
    args: ['./tools.js']
`,
    'utf8',
  );

  const sync1 = runMcpCli(root, 'sync');
  assert.equal(sync1.status, 0, sync1.stderr);

  // Manually edit the generated server in .codex/config.toml
  const codexPath = path.join(root, '.codex', 'config.toml');
  const codexContent = await readFile(codexPath, 'utf8');
  assert.match(codexContent, /command = "node"/);
  const modifiedCodex = codexContent.replace('command = "node"', 'command = "hacked"');
  await writeFile(codexPath, modifiedCodex, 'utf8');

  const before = await snapshot(root);
  const sync2 = runMcpCli(root, 'sync');

  assert.notEqual(sync2.status, 0);
  assert.match(sync2.stdout, /CONFLICT.*\.codex\/config\.toml.*tools.*edited manually/i);
  assert.deepEqual(await snapshot(root), before);
});

test('sync cleanly adopts identical existing unmanaged Codex servers without duplicate table errors', async () => {
  const root = await createInitializedMcpFixture();

  await mkdir(path.join(root, '.codex'), { recursive: true });
  await writeFile(
    path.join(root, '.codex', 'config.toml'),
    `# Unmanaged settings
model = "o3-mini"

[mcp_servers.fetch]
command = "uvx"
args = ["mcp-server-fetch"]
`,
    'utf8',
  );

  // Add identical definition to .drakom-ai/mcp-servers.yaml
  await writeFile(
    path.join(root, '.drakom-ai', 'mcp-servers.yaml'),
    `servers:
  fetch:
    command: uvx
    args:
      - mcp-server-fetch
`,
    'utf8',
  );

  const syncResult = runMcpCli(root, 'sync');
  assert.equal(syncResult.status, 0, syncResult.stderr);

  // Check .codex/config.toml content
  const codexAfter = await readFile(path.join(root, '.codex', 'config.toml'), 'utf8');
  assert.match(codexAfter, /model = "o3-mini"/);
  assert.match(codexAfter, /BEGIN Drakom AI Development Context MCP servers/);
  assert.match(codexAfter, /\[mcp_servers\.fetch\]/);

  // Verify TOML parses without duplicate table errors
  const { parse: parseToml } = await import('smol-toml');
  const parsed = parseToml(codexAfter);
  assert.equal(parsed.model, 'o3-mini');
  assert.ok(parsed.mcp_servers);

  const state = await loadState(root);
  assert.ok(state?.managedMcpServers.fetch);
});

test('sync preserves legacy Codex blueprint block byte-for-byte when no servers are managed by Drakom AI', async () => {
  const root = await createInitializedMcpFixture();
  // Synchronize initial setup skill mirror so fixture is in a clean, drift-free state
  const initialSync = runMcpCli(root, 'sync');
  assert.equal(initialSync.status, 0, initialSync.stderr);

  await mkdir(path.join(root, '.codex'), { recursive: true });
  const initialCodex = `# Global Codex configuration
model = "o3-mini"

# BEGIN AI Framework Blueprint MCP servers
[mcp_servers.legacy_blueprint_server]
command = "node"
args = ["legacy-server.js"]
# END AI Framework Blueprint MCP servers
`;
  await writeFile(path.join(root, '.codex', 'config.toml'), initialCodex, 'utf8');

  // Ensure .drakom-ai/mcp-servers.yaml has no generated servers
  await writeFile(path.join(root, '.drakom-ai', 'mcp-servers.yaml'), 'servers: {}\n', 'utf8');
  const stateBefore = await loadState(root);
  assert.deepEqual(stateBefore?.managedMcpServers, {});

  // 1. sync --check exits successfully without reporting drift
  const checkResult = runMcpCli(root, 'sync', ['--check']);
  assert.equal(checkResult.status, 0, checkResult.stderr);
  assert.match(checkResult.stdout, /PRESERVE \.codex\/config\.toml/);
  assert.doesNotMatch(checkResult.stdout, /Drift detected/);

  // 2. sync exits cleanly and leaves legacy block and file byte-for-byte unchanged
  const syncResult = runMcpCli(root, 'sync');
  assert.equal(syncResult.status, 0, syncResult.stderr);
  assert.match(syncResult.stdout, /PRESERVE \.codex\/config\.toml/);

  const codexAfter = await readFile(path.join(root, '.codex', 'config.toml'), 'utf8');
  assert.equal(codexAfter, initialCodex, 'Legacy Codex config must remain byte-for-byte identical');

  // 3. Verify unrelated configuration and legacy block contents are intact
  assert.match(codexAfter, /model = "o3-mini"/);
  assert.match(codexAfter, /BEGIN AI Framework Blueprint MCP servers/);
  assert.match(codexAfter, /\[mcp_servers\.legacy_blueprint_server\]/);
  assert.match(codexAfter, /END AI Framework Blueprint MCP servers/);

  // 4. Managed state remains empty
  const stateAfter = await loadState(root);
  assert.deepEqual(stateAfter?.managedMcpServers, {});
});

test('sync strictly validates MCP registry schema and rejects invalid shapes before generation', async () => {
  const invalidConfigs = [
    { source: 'servers:\n  bad:\n    args: [42]\n', error: /command or http/i },
    { source: 'servers:\n  empty: {}\n', error: /command or http/i },
    { source: 'servers:\n  both:\n    command: node\n    http:\n      url: https://example.com\n', error: /exactly one of command or http/i },
    { source: 'servers:\n  unknown:\n    commmand: node\n', error: /unsupported field "commmand"/i },
    { source: 'servers:\n  bad-override:\n    command: node\n    overrides:\n      invalid-client:\n        command: node\n', error: /unsupported override "invalid-client"/i },
    { source: 'servers:\n  empty-override:\n    command: node\n    overrides:\n      claude: {}\n', error: /cannot be empty/i },
    { source: 'servers:\n  number-override-cmd:\n    command: node\n    overrides:\n      claude:\n        command: 42\n', error: /command must be a non-empty string/i },
    { source: 'servers:\n  bad-override-url:\n    command: node\n    overrides:\n      claude:\n        http:\n          url: 42\n', error: /http\.url must be a non-empty string/i },
    { source: 'servers:\n  both-override:\n    command: node\n    overrides:\n      claude:\n        command: node\n        url: https://example.com\n', error: /specifies both command and http/i },
  ];

  for (const { source, error } of invalidConfigs) {
    const root = await createInitializedMcpFixture();

    await writeFile(path.join(root, '.drakom-ai', 'mcp-servers.yaml'), source, 'utf8');
    const before = await snapshot(root);

    const result = runMcpCli(root, 'sync');

    assert.notEqual(result.status, 0, `Expected error for:\n${source}`);
    assert.match(result.stdout, /CONFLICT.*\.drakom-ai\/mcp-servers\.yaml/);
    assert.match(result.stdout, error);
    assert.deepEqual(await snapshot(root), before);
  }
});

test('MCP discovery captures malformed client file syntax errors and renders actionable diagnostics', async () => {
  const root = await createFixture();
  await mkdir(path.join(root, '.codex'), { recursive: true });

  await writeFile(path.join(root, '.mcp.json'), '{\n  "unclosed":\n', 'utf8');
  await writeFile(path.join(root, '.codex', 'config.toml'), '[invalid =\n', 'utf8');

  const inventory = await inspectTarget(root);
  const discovered = discoverMcp(inventory);

  assert.ok(discovered.fileErrors);
  assert.ok(discovered.fileErrors['.mcp.json']);
  assert.ok(discovered.fileErrors['.codex/config.toml']);

  const report = renderMcpComparisonReport(discovered);
  assert.match(report, /Configuration Errors/);
  assert.match(report, /\.mcp\.json/);
  assert.match(report, /\.codex\/config\.toml/);
});

test('malformed TOML does not leak literal secrets in CLI output or comparison reports', async () => {
  const root = await createFixture();
  await mkdir(path.join(root, '.codex'), { recursive: true });
  const rawSecret = 'super-secret-token-12345';
  await writeFile(path.join(root, '.codex', 'config.toml'), `api_key = "${rawSecret}\n`, 'utf8');

  const inventory = await inspectTarget(root);
  const discovered = discoverMcp(inventory);
  const report = renderMcpComparisonReport(discovered);

  assert.doesNotMatch(report, new RegExp(rawSecret));
  assert.match(report, /Configuration Errors/);
  assert.match(report, /\.codex\/config\.toml/);

  // Also verify via CLI init --dry-run
  const dryRun = runMcpCli(root, 'init', ['--dry-run']);
  assert.doesNotMatch(dryRun.stdout, new RegExp(rawSecret));
  assert.doesNotMatch(dryRun.stderr, new RegExp(rawSecret));
});

test('init outputs MCP comparison report when unmanaged client files are discovered', async () => {
  const root = await createFixture();
  await writeFile(
    path.join(root, '.mcp.json'),
    JSON.stringify({
      mcpServers: {
        'existing-tool': {
          command: 'node',
          args: ['./tool.js'],
        },
      },
    }),
    'utf8',
  );

  const dryRun = runMcpCli(root, 'init', ['--dry-run']);

  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.match(dryRun.stdout, /Drakom AI MCP Comparison Report/);
  assert.match(dryRun.stdout, /existing-tool/);
  assert.match(dryRun.stdout, /Import into \.drakom-ai\/mcp-servers\.yaml/);
});

test('init --yes preserves unmanaged MCP servers and does not take over ownership into mcp-servers.yaml without approval', async () => {
  const root = await createFixture();
  await writeFile(
    path.join(root, '.mcp.json'),
    JSON.stringify({
      mcpServers: {
        'unmanaged-tool': {
          command: 'node',
          args: ['./tool.js'],
        },
      },
    }),
    'utf8',
  );

  const initResult = runMcpCli(root, 'init', ['--yes']);
  assert.equal(initResult.status, 0, initResult.stderr);

  // Check initial mcp-servers.yaml does NOT take over ownership (remains empty default template)
  const yamlContent = await readFile(path.join(root, '.drakom-ai', 'mcp-servers.yaml'), 'utf8');
  assert.doesNotMatch(yamlContent, /unmanaged-tool/);
  assert.match(yamlContent, /servers:\s*\{\}/);

  // .mcp.json is preserved untouched
  const mcpContent = JSON.parse(await readFile(path.join(root, '.mcp.json'), 'utf8'));
  assert.ok(mcpContent.mcpServers['unmanaged-tool']);

  // Subsequent sync preserves unmanaged server without conflicts
  const syncResult = runMcpCli(root, 'sync');
  assert.equal(syncResult.status, 0, syncResult.stderr);

  const state = await loadState(root);
  assert.equal(state?.managedMcpServers['unmanaged-tool'], undefined);
});

test('init --skip-mcp suppresses MCP report and omits mcp-servers.yaml', async () => {
  const root = await createFixture();
  await writeFile(
    path.join(root, '.mcp.json'),
    JSON.stringify({
      mcpServers: {
        'existing-tool': { command: 'node' },
      },
    }),
    'utf8',
  );

  const initResult = runMcpCli(root, 'init', ['--skip-mcp', '--yes']);
  assert.equal(initResult.status, 0, initResult.stderr);
  assert.doesNotMatch(initResult.stdout, /Drakom AI MCP Comparison Report/);

  // Syncing a skip-mcp project does not attempt MCP generation and succeeds cleanly
  const syncResult = runMcpCli(root, 'sync');
  assert.equal(syncResult.status, 0, syncResult.stderr);
});

test('sync reports conflict when mcp-servers.yaml is missing in an initialized project', async () => {
  const root = await createInitializedMcpFixture();

  const { rm } = await import('node:fs/promises');
  await rm(path.join(root, '.drakom-ai', 'mcp-servers.yaml'));

  const syncResult = runMcpCli(root, 'sync');
  assert.notEqual(syncResult.status, 0);
  assert.match(syncResult.stdout, /CONFLICT.*\.drakom-ai\/mcp-servers\.yaml.*missing/i);
});

test('sync reports conflict on malformed YAML syntax in mcp-servers.yaml', async () => {
  const root = await createInitializedMcpFixture();

  await writeFile(path.join(root, '.drakom-ai', 'mcp-servers.yaml'), 'servers: [unclosed\n', 'utf8');

  const syncResult = runMcpCli(root, 'sync');
  assert.notEqual(syncResult.status, 0);
  assert.match(syncResult.stdout, /CONFLICT.*\.drakom-ai\/mcp-servers\.yaml.*invalid.*yaml syntax at line \d+, column \d+/i);
});

test('sync reports all servers with literal credentials in a single pass', async () => {
  const root = await createInitializedMcpFixture();

  await writeFile(
    path.join(root, '.drakom-ai', 'mcp-servers.yaml'),
    `servers:
  server-one:
    command: node
    env:
      API_KEY: "sk-live-secret-1"
  server-two:
    command: python
    env:
      API_KEY: "sk-live-secret-2"
`,
    'utf8',
  );

  const syncResult = runMcpCli(root, 'sync');
  assert.notEqual(syncResult.status, 0);
  assert.match(syncResult.stdout, /server-one.*literal credentials/i);
  assert.match(syncResult.stdout, /server-two.*literal credentials/i);
  assert.doesNotMatch(syncResult.stdout, /sk-live-secret-1/);
  assert.doesNotMatch(syncResult.stdout, /sk-live-secret-2/);
});

test('sync correctly merges non-empty partial overrides without erasing base transport', async () => {
  const root = await createInitializedMcpFixture();

  await writeFile(
    path.join(root, '.drakom-ai', 'mcp-servers.yaml'),
    `servers:
  stdio-tool:
    command: npx
    args: ["-y", "filesystem-server"]
    env:
      SHARED_VAR: "shared"
    overrides:
      claude:
        args: ["-y", "filesystem-server", "/custom"]
      codex:
        env:
          CODEX_VAR: "codex_only"
  http-tool:
    http:
      url: "https://api.example.com/mcp"
      type: "sse"
      headers:
        Authorization: "Bearer \${BASE_KEY}"
    overrides:
      antigravity:
        headers:
          Authorization: "Bearer \${AG_KEY}"
          X-Tool: "antigravity"
      vscode:
        url: "https://vscode.example.com/mcp"
`,
    'utf8',
  );

  const syncResult = runMcpCli(root, 'sync');
  assert.equal(syncResult.status, 0, syncResult.stderr);

  // 1. Claude: stdio-tool has overridden args, base command and env preserved
  //            http-tool has base URL, type, and headers preserved
  const claudeConfig = JSON.parse(await readFile(path.join(root, '.mcp.json'), 'utf8'));
  assert.deepEqual(claudeConfig.mcpServers['stdio-tool'], {
    command: 'npx',
    args: ['-y', 'filesystem-server', '/custom'],
    env: { SHARED_VAR: 'shared' },
  });
  assert.deepEqual(claudeConfig.mcpServers['http-tool'], {
    type: 'sse',
    url: 'https://api.example.com/mcp',
    headers: { Authorization: 'Bearer ${BASE_KEY}' },
  });

  // 2. Codex: stdio-tool has base command, base args, merged env
  //           http-tool has base URL and base headers
  const codexConfig = await readFile(path.join(root, '.codex', 'config.toml'), 'utf8');
  assert.match(codexConfig, /command = "npx"/);
  assert.match(codexConfig, /SHARED_VAR = "shared"/);
  assert.match(codexConfig, /CODEX_VAR = "codex_only"/);
  assert.match(codexConfig, /url = "https:\/\/api\.example\.com\/mcp"/);
  assert.match(codexConfig, /Authorization = "Bearer \$\{BASE_KEY\}"/);

  // 3. Antigravity: http-tool has base URL and type, overridden headers
  const agyConfig = JSON.parse(await readFile(path.join(root, '.agents', 'mcp_config.json'), 'utf8'));
  assert.deepEqual(agyConfig.mcpServers['http-tool'], {
    serverUrl: 'https://api.example.com/mcp',
    transport: 'sse',
    headers: {
      Authorization: 'Bearer ${AG_KEY}',
      'X-Tool': 'antigravity',
    },
  });

  // 4. VS Code: http-tool has overridden URL, base type and headers preserved
  const vscodeConfig = JSON.parse(await readFile(path.join(root, '.vscode', 'mcp.json'), 'utf8'));
  assert.deepEqual(vscodeConfig.servers['http-tool'], {
    type: 'sse',
    url: 'https://vscode.example.com/mcp',
    headers: { Authorization: 'Bearer ${BASE_KEY}' },
  });
});

test('validateMcpRegistry rejects mismatched partial overrides that contradict base transport', () => {
  // Command base with HTTP fields (no URL)
  const res1 = validateMcpRegistry({
    servers: {
      srv: {
        command: 'node',
        overrides: {
          claude: {
            headers: { 'X-Key': '123' },
          },
        },
      },
    },
  });
  assert.equal(res1.valid, false);
  assert.match(res1.error, /specifies HTTP fields \(headers\) without an HTTP URL or transport/i);

  // HTTP base with stdio args (no command)
  const res2 = validateMcpRegistry({
    servers: {
      srv: {
        http: { url: 'https://example.com' },
        overrides: {
          claude: {
            args: ['--flag'],
          },
        },
      },
    },
  });
  assert.equal(res2.valid, false);
  assert.match(res2.error, /specifies stdio fields \(args\) without a command/i);

  // HTTP base with stdio env (no command)
  const res3 = validateMcpRegistry({
    servers: {
      srv: {
        http: { url: 'https://example.com' },
        overrides: {
          claude: {
            env: { FOO: 'bar' },
          },
        },
      },
    },
  });
  assert.equal(res3.valid, false);
  assert.match(res3.error, /specifies stdio fields \(env\) without a command/i);
});

test('init outputs MCP comparison report when client files exist with only syntax errors', async () => {
  const root = await createFixture();
  await mkdir(path.join(root, '.codex'), { recursive: true });
  await writeFile(path.join(root, '.codex', 'config.toml'), 'invalid_toml = [unclosed\n', 'utf8');

  const initResult = runMcpCli(root, 'init', ['--dry-run']);
  assert.equal(initResult.status, 0, initResult.stderr);
  assert.match(initResult.stdout, /Drakom AI MCP Comparison Report/);
  assert.match(initResult.stdout, /Configuration Errors/);
  assert.match(initResult.stdout, /\*\*\.codex\/config\.toml\*\*:\s*Syntax error parsing TOML/);
});

test('buildSyncPlan Phase 3 catches defensive throw during MCP generation', async () => {
  const root = await createInitializedMcpFixture();

  const inventory = await inspectTarget(root);
  inventory.contents['.drakom-ai/mcp-servers.yaml'] = 'servers:\n  test:\n    command: "node"\n';
  Object.defineProperty(inventory.contents, '.codex/config.toml', {
    get() {
      throw new Error('Simulated generator failure');
    },
    enumerable: true,
    configurable: true,
  });

  const payload = await loadPackagePayload();
  const plan = buildSyncPlan(inventory, payload);
  assert.equal(plan.hasConflicts, true);
  const conflictOp = plan.operations.find(
    (op) => op.path === '.drakom-ai/mcp-servers.yaml' && op.action === 'conflict',
  );
  assert.ok(conflictOp);
  assert.match(conflictOp.summary, /MCP generation failed: Simulated generator failure/);
});
