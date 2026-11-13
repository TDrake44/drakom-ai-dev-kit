import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { renderCliHelp } from '../dist/cli-help.js';
import { DRAKOM_DIR } from '../dist/constants.js';
import { inspectTarget } from '../dist/inspect-target.js';
import { checkLiteralCredentials, discoverMcp, isSensitiveName } from '../dist/mcp-discovery.js';
import { validateMcpRegistry } from '../dist/mcp-registry.js';
import {
  generateAntigravityServer,
  generateClaudeServer,
  generateCodexServerSnippet,
  generateVscodeServer,
} from '../dist/mcp-renderers.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(repositoryRoot, 'dist', 'cli.js');
const REGISTRY = `${DRAKOM_DIR}/mcp-servers.yaml`;
const CLAUDE = '.mcp.json';
const VSCODE = '.vscode/mcp.json';
const ANTIGRAVITY = '.agents/mcp_config.json';
const CODEX = '.codex/config.toml';
// Built at run time so that no token-shaped literal sits in the repository.
const FAKE_TOKEN = ['sk', 'fakefakefakefake0000'].join('-');

/**
 * @param {string} command
 * @param {string} root
 * @param {string[]} [options]
 */
function drakom(command, root, options = []) {
  return spawnSync(process.execPath, [cliPath, command, root, ...options], { encoding: 'utf8' });
}

/** @param {string} root @param {string} relativePath */
function read(root, relativePath) {
  return readFile(path.join(root, ...relativePath.split('/')), 'utf8');
}

/** @param {string} root @param {string} relativePath @param {string} content */
async function write(root, relativePath, content) {
  const absolutePath = path.join(root, ...relativePath.split('/'));
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, 'utf8');
}

/** @param {string} root @param {string} relativePath */
async function exists(root, relativePath) {
  try {
    await access(path.join(root, ...relativePath.split('/')));
    return true;
  } catch {
    return false;
  }
}

/** @param {string} root @param {string} relativePath */
async function readJson(root, relativePath) {
  return JSON.parse(await read(root, relativePath));
}

/** @param {string} root */
function readState(root) {
  return readJson(root, `${DRAKOM_DIR}/state.json`);
}

/**
 * An initialized target with the given registry, not yet synchronized.
 * @param {string} registry
 * @param {string[]} [initOptions]
 */
async function createTarget(registry, initOptions = []) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'drakom-mcp-selection-'));
  const init = drakom('init', root, ['--yes', ...initOptions]);
  assert.equal(init.status, 0, init.stderr);
  await write(root, REGISTRY, registry);
  return root;
}

/** @param {string} root @param {string[]} [options] */
function syncOk(root, options = []) {
  const result = drakom('sync', root, options);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result;
}

/** @param {string} root */
function assertInSync(root) {
  const check = drakom('sync', root, ['--check']);
  assert.equal(check.status, 0, `${check.stdout}\n${check.stderr}`);
  assert.doesNotMatch(check.stdout, /^(CONFLICT|WARNING)/m);
}

/** @param {unknown} raw */
function validationErrorOf(raw) {
  const result = validateMcpRegistry(raw);
  assert.equal(result.valid, false, 'expected the registry to be rejected');
  return result.valid ? '' : result.error;
}

/** @param {unknown} raw @param {string} name */
function validServer(raw, name) {
  const result = validateMcpRegistry(raw);
  assert.ok(result.valid, result.valid ? '' : result.error);
  const server = result.registry.servers[name];
  assert.ok(server);
  return server;
}

const TWO_SERVERS = `servers:
  alpha:
    command: node
    args: ['./alpha.mjs']
  beta:
    command: node
    args: ['./beta.mjs']
`;

// ---------------------------------------------------------------------------
// Existing registries
// ---------------------------------------------------------------------------

test('a registry without the new keys produces the same bytes and state as before', async () => {
  const root = await createTarget(`servers:
  project-tools:
    command: node
    args: ['./scripts/mcp/server.mjs']
    env:
      LOG_LEVEL: info
  documentation:
    http:
      url: https://mcp.example.com/docs
      headers:
        X-Client: drakom-ai-dev-kit
    overrides:
      antigravity:
        serverUrl: https://mcp.example.com/docs
        transport: http
        timeout: 30000
      codex:
        headers:
          X-Extra: codex
`);

  syncOk(root);

  // Captured from the release before client selection existed.
  assert.equal(
    await read(root, CLAUDE),
    '{\n  "mcpServers": {\n    "project-tools": {\n      "command": "node",\n      "args": [\n        "./scripts/mcp/server.mjs"\n      ],\n      "env": {\n        "LOG_LEVEL": "info"\n      }\n    },\n    "documentation": {\n      "type": "http",\n      "url": "https://mcp.example.com/docs",\n      "headers": {\n        "X-Client": "drakom-ai-dev-kit"\n      }\n    }\n  }\n}\n',
  );
  assert.equal(
    await read(root, VSCODE),
    '{\n  "servers": {\n    "project-tools": {\n      "type": "stdio",\n      "command": "node",\n      "args": [\n        "./scripts/mcp/server.mjs"\n      ],\n      "env": {\n        "LOG_LEVEL": "info"\n      }\n    },\n    "documentation": {\n      "type": "http",\n      "url": "https://mcp.example.com/docs",\n      "headers": {\n        "X-Client": "drakom-ai-dev-kit"\n      }\n    }\n  }\n}\n',
  );
  assert.equal(
    await read(root, ANTIGRAVITY),
    '{\n  "mcpServers": {\n    "project-tools": {\n      "command": "node",\n      "args": [\n        "./scripts/mcp/server.mjs"\n      ],\n      "env": {\n        "LOG_LEVEL": "info"\n      }\n    },\n    "documentation": {\n      "serverUrl": "https://mcp.example.com/docs",\n      "transport": "http",\n      "timeout": 30000,\n      "headers": {\n        "X-Client": "drakom-ai-dev-kit"\n      }\n    }\n  }\n}\n',
  );
  assert.equal(
    await read(root, CODEX),
    '# BEGIN Drakom AI Development Context MCP servers\n[mcp_servers.project-tools]\ncommand = "node"\nargs = ["./scripts/mcp/server.mjs"]\n\n[mcp_servers.project-tools.env]\nLOG_LEVEL = "info"\n\n[mcp_servers.documentation]\nurl = "https://mcp.example.com/docs"\n\n[mcp_servers.documentation.http_headers]\nX-Client = "drakom-ai-dev-kit"\nX-Extra = "codex"\n\n# END Drakom AI Development Context MCP servers\n',
  );
  const state = await readState(root);
  assert.equal(state.features.mcp, true);
  assert.equal(
    JSON.stringify(state.managedMcpServers),
    JSON.stringify({
      'project-tools': {
        sourceFingerprint: 'sha256:b62712e4bf3f17fe9abfeb4079be30837d0c4f87251661d9f3b8c08731c66312',
        targetFingerprints: {
          '.mcp.json': 'sha256:b62712e4bf3f17fe9abfeb4079be30837d0c4f87251661d9f3b8c08731c66312',
          '.vscode/mcp.json': 'sha256:3fb56954539b6d0bf77bfcd19eae3f4045cd43f6d7ee1b6310f6bb431e025294',
          '.agents/mcp_config.json': 'sha256:b62712e4bf3f17fe9abfeb4079be30837d0c4f87251661d9f3b8c08731c66312',
          '.codex/config.toml': 'sha256:b62712e4bf3f17fe9abfeb4079be30837d0c4f87251661d9f3b8c08731c66312',
        },
      },
      documentation: {
        sourceFingerprint: 'sha256:8da7a7a34ebb7d8c06235f2fe42ef6b9d41851b431f4b91435b5490f00605226',
        targetFingerprints: {
          '.mcp.json': 'sha256:4f97a08f13934887924d738cf9b8dbd57fc4876c427674f2fdaa7c4cd08a75dc',
          '.vscode/mcp.json': 'sha256:4f97a08f13934887924d738cf9b8dbd57fc4876c427674f2fdaa7c4cd08a75dc',
          '.agents/mcp_config.json': 'sha256:9bc88f670a82385536c1b044c7d13d1efe7b402ba24ece622837494ae7f00118',
          '.codex/config.toml': 'sha256:a7b3f561305646e92a6e9a786994fb39d027a96aa1f02c2bb3fe4526d78da61d',
        },
      },
    }),
  );
  assertInSync(root);
});

test('a managed server missing from a selected client file is still a conflict', async () => {
  const root = await createTarget(TWO_SERVERS);
  syncOk(root);
  await rm(path.join(root, '.agents', 'mcp_config.json'));

  const result = drakom('sync', root);

  assert.equal(result.status, 2);
  assert.match(result.stdout, /CONFLICT\s+\.agents\/mcp_config\.json.*removed or edited manually/);
});

// ---------------------------------------------------------------------------
// Registry validation of clients and skip
// ---------------------------------------------------------------------------

test('validateMcpRegistry accepts clients and skip and leaves them out when not given', () => {
  const plain = validateMcpRegistry({ servers: { a: { command: 'node' } } });
  assert.ok(plain.valid);
  assert.deepEqual(plain.registry, { servers: { a: { command: 'node' } } });

  const selected = validateMcpRegistry({
    clients: ['claude', 'codex'],
    servers: { a: { command: 'node', skip: ['codex', 'antigravity'] } },
  });
  assert.ok(selected.valid);
  assert.deepEqual(selected.registry.clients, ['claude', 'codex']);
  assert.deepEqual(selected.registry.servers.a?.skip, ['codex', 'antigravity']);
});

test('validateMcpRegistry rejects a malformed clients list', () => {
  const servers = { a: { command: 'node' } };
  assert.match(validationErrorOf({ clients: [], servers }), /clients must be a non-empty list/);
  assert.match(validationErrorOf({ clients: 'claude', servers }), /clients must be a non-empty list/);
  assert.match(validationErrorOf({ clients: ['claude', 'cursor'], servers }), /clients contains unknown client "cursor".*claude, vscode, antigravity, codex/);
  assert.match(validationErrorOf({ clients: ['claude', 'claude'], servers }), /clients lists "claude" more than once/);
  assert.match(validationErrorOf({ clients: [1], servers }), /clients must be a non-empty list/);
});

test('validateMcpRegistry rejects a malformed skip list', () => {
  /** @param {unknown} skip @param {unknown} [clients] */
  const errorFor = (skip, clients) =>
    validationErrorOf({ ...(clients === undefined ? {} : { clients }), servers: { a: { command: 'node', skip } } });

  assert.match(errorFor('antigravity'), /MCP server "a" skip must be a list of client names/);
  assert.match(errorFor(['cursor']), /MCP server "a" skip contains unknown client "cursor"/);
  assert.match(errorFor(['codex', 'codex']), /MCP server "a" skip lists "codex" more than once/);
  assert.match(
    errorFor(['claude', 'vscode', 'antigravity', 'codex']),
    /MCP server "a" skips every selected client.*remove the server/,
  );
  assert.match(errorFor(['claude'], ['claude']), /MCP server "a" skips every selected client/);
});

test('a skip entry may name a client that the clients list already leaves out', () => {
  const result = validateMcpRegistry({
    clients: ['claude', 'vscode'],
    servers: { a: { command: 'node', skip: ['antigravity', 'vscode'] } },
  });
  assert.ok(result.valid);
});

// ---------------------------------------------------------------------------
// Per-server skip
// ---------------------------------------------------------------------------

const TOKEN_SERVER = `servers:
  github:
    http:
      url: https://mcp.example.com/github
      headers:
        Authorization: "Bearer \${GITHUB_TOKEN}"
    skip: [antigravity]
  local:
    command: node
    env:
      GITHUB_TOKEN: \${GITHUB_TOKEN}
    skip: [antigravity]
  plain:
    command: node
`;

test('a server that uses a variable reference is generated for three clients when it skips antigravity', async () => {
  const root = await createTarget(TOKEN_SERVER);

  syncOk(root);

  const claude = await readJson(root, CLAUDE);
  assert.equal(claude.mcpServers.github.headers.Authorization, 'Bearer ${GITHUB_TOKEN}');
  assert.equal(claude.mcpServers.local.env.GITHUB_TOKEN, '${GITHUB_TOKEN}');
  const vscode = await readJson(root, VSCODE);
  assert.equal(vscode.servers.github.headers.Authorization, 'Bearer ${env:GITHUB_TOKEN}');
  const codex = await read(root, CODEX);
  assert.match(codex, /\[mcp_servers\.github\]/);
  assert.match(codex, /bearer_token_env_var = "GITHUB_TOKEN"/);
  assert.match(codex, /env_vars = \["GITHUB_TOKEN"\]/);
  const antigravity = await readJson(root, ANTIGRAVITY);
  assert.deepEqual(Object.keys(antigravity.mcpServers), ['plain']);

  const state = await readState(root);
  assert.deepEqual(Object.keys(state.managedMcpServers.github.targetFingerprints), [CLAUDE, VSCODE, CODEX]);
  assert.deepEqual(Object.keys(state.managedMcpServers.plain.targetFingerprints), [CLAUDE, VSCODE, ANTIGRAVITY, CODEX]);
  assertInSync(root);
});

test('no file is created for a client that every server skips', async () => {
  const root = await createTarget(`servers:
  github:
    command: node
    env:
      GITHUB_TOKEN: \${GITHUB_TOKEN}
    skip: [antigravity]
`);

  syncOk(root);

  assert.equal(await exists(root, ANTIGRAVITY), false);
  assert.equal(await exists(root, CLAUDE), true);
  assertInSync(root);
});

test('the Antigravity refusal names fixes that work', async () => {
  const root = await createTarget(`servers:
  github:
    command: node
    env:
      GITHUB_TOKEN: \${GITHUB_TOKEN}
`);

  const result = drakom('sync', root);

  assert.equal(result.status, 2);
  assert.match(result.stdout, /CONFLICT.*MCP server "github": Antigravity env\.GITHUB_TOKEN uses \$\{GITHUB_TOKEN\}/);
  assert.match(result.stdout, /skip: \[antigravity\]/);
  assert.match(result.stdout, /overrides\.antigravity.*null/);
  assert.doesNotMatch(result.stdout, /reference-free/);
  assert.equal(await exists(root, CLAUDE), false);
});

test('an override that removes the field with null also satisfies Antigravity', async () => {
  const root = await createTarget(`servers:
  github:
    command: node
    env:
      GITHUB_TOKEN: \${GITHUB_TOKEN}
      LOG_LEVEL: info
    overrides:
      antigravity:
        env:
          GITHUB_TOKEN: null
`);

  syncOk(root);

  assert.deepEqual((await readJson(root, ANTIGRAVITY)).mcpServers.github, { command: 'node', env: { LOG_LEVEL: 'info' } });
  assert.deepEqual((await readJson(root, CLAUDE)).mcpServers.github.env, {
    GITHUB_TOKEN: '${GITHUB_TOKEN}',
    LOG_LEVEL: 'info',
  });
  assertInSync(root);
});

test('adding skip removes the untouched entry from that client only', async () => {
  const root = await createTarget(TWO_SERVERS);
  syncOk(root);
  await write(root, REGISTRY, TWO_SERVERS.replace("args: ['./alpha.mjs']", "args: ['./alpha.mjs']\n    skip: [antigravity, codex]"));

  const result = syncOk(root);

  assert.doesNotMatch(result.stdout, /^(CONFLICT|WARNING)/m);
  assert.deepEqual(Object.keys((await readJson(root, ANTIGRAVITY)).mcpServers), ['beta']);
  const codex = await read(root, CODEX);
  assert.doesNotMatch(codex, /mcp_servers\.alpha/);
  assert.match(codex, /\[mcp_servers\.beta\]/);
  assert.deepEqual(Object.keys((await readJson(root, CLAUDE)).mcpServers), ['alpha', 'beta']);
  const state = await readState(root);
  assert.deepEqual(Object.keys(state.managedMcpServers.alpha.targetFingerprints), [CLAUDE, VSCODE]);
  assertInSync(root);
});

// ---------------------------------------------------------------------------
// Registry-level clients
// ---------------------------------------------------------------------------

test('a client left out of clients gets no file and no state record', async () => {
  const root = await createTarget(`clients: [claude, vscode, codex]\n${TWO_SERVERS}`);

  syncOk(root);

  assert.equal(await exists(root, ANTIGRAVITY), false);
  assert.equal(await exists(root, CLAUDE), true);
  assert.equal(await exists(root, VSCODE), true);
  assert.equal(await exists(root, CODEX), true);
  const state = await readState(root);
  assert.deepEqual(Object.keys(state.managedMcpServers.alpha.targetFingerprints), [CLAUDE, VSCODE, CODEX]);
  assertInSync(root);
});

test('a variable reference no longer blocks sync once antigravity is left out of clients', async () => {
  const root = await createTarget(`clients: [claude, vscode, codex]
servers:
  github:
    command: node
    env:
      GITHUB_TOKEN: \${GITHUB_TOKEN}
`);

  syncOk(root);

  assert.equal((await readJson(root, CLAUDE)).mcpServers.github.env.GITHUB_TOKEN, '${GITHUB_TOKEN}');
  assert.equal(await exists(root, ANTIGRAVITY), false);
});

test('deleting an unused client file and then deselecting the client ends in a clean sync', async () => {
  const root = await createTarget(TWO_SERVERS);
  syncOk(root);
  await rm(path.join(root, '.agents', 'mcp_config.json'));
  assert.equal(drakom('sync', root).status, 2);
  await write(root, REGISTRY, `clients: [claude, vscode, codex]\n${TWO_SERVERS}`);

  const result = syncOk(root);

  assert.doesNotMatch(result.stdout, /^(CONFLICT|WARNING)/m);
  assert.equal(await exists(root, ANTIGRAVITY), false);
  const state = await readState(root);
  assert.deepEqual(Object.keys(state.managedMcpServers.alpha.targetFingerprints), [CLAUDE, VSCODE, CODEX]);
  assert.deepEqual(Object.keys(state.managedMcpServers.beta.targetFingerprints), [CLAUDE, VSCODE, CODEX]);
  assertInSync(root);
});

test('deselecting a client removes only the entries the kit wrote and keeps the rest of the file', async () => {
  const root = await createTarget(TWO_SERVERS);
  await write(root, ANTIGRAVITY, `${JSON.stringify({ theme: 'dark', mcpServers: { mine: { command: 'python' } } }, null, 2)}\n`);
  syncOk(root);
  assert.deepEqual(Object.keys((await readJson(root, ANTIGRAVITY)).mcpServers), ['mine', 'alpha', 'beta']);
  await write(root, REGISTRY, `clients: [claude, vscode, codex]\n${TWO_SERVERS}`);

  const dryRun = drakom('sync', root, ['--dry-run']);
  assert.match(dryRun.stdout, /UPDATE\s+\.agents\/mcp_config\.json/);
  assert.equal(drakom('sync', root, ['--check']).status, 2);
  const result = syncOk(root);

  assert.doesNotMatch(result.stdout, /^(CONFLICT|WARNING)/m);
  assert.deepEqual(await readJson(root, ANTIGRAVITY), { theme: 'dark', mcpServers: { mine: { command: 'python' } } });
  assert.deepEqual(Object.keys((await readJson(root, CLAUDE)).mcpServers), ['alpha', 'beta']);
  assertInSync(root);

  // Selecting the client again brings the entries back.
  await write(root, REGISTRY, TWO_SERVERS);
  syncOk(root);
  assert.deepEqual(Object.keys((await readJson(root, ANTIGRAVITY)).mcpServers), ['mine', 'alpha', 'beta']);
  assertInSync(root);
});

test('deselecting a client leaves an edited entry alone, stops tracking it, and says so without blocking', async () => {
  const root = await createTarget(TWO_SERVERS);
  syncOk(root);
  const edited = await readJson(root, ANTIGRAVITY);
  edited.mcpServers.alpha.args = ['./edited.mjs'];
  await write(root, ANTIGRAVITY, `${JSON.stringify(edited, null, 2)}\n`);
  await write(root, REGISTRY, `clients: [claude, vscode, codex]\n${TWO_SERVERS}`);

  const result = syncOk(root);

  assert.match(result.stdout, /WARNING\s+\.agents\/mcp_config\.json.*"alpha".*edited.*no longer managed/);
  assert.doesNotMatch(result.stdout, /^CONFLICT/m);
  assert.deepEqual(await readJson(root, ANTIGRAVITY), { mcpServers: { alpha: { command: 'node', args: ['./edited.mjs'] } } });
  const state = await readState(root);
  assert.deepEqual(Object.keys(state.managedMcpServers.alpha.targetFingerprints), [CLAUDE, VSCODE, CODEX]);
  assertInSync(root);
});

test('a deselected client file is never a conflict, whatever it holds', async () => {
  const registry = `clients: [claude]\n${TWO_SERVERS}`;

  const broken = await createTarget(registry);
  await write(broken, ANTIGRAVITY, '{ not json');
  await write(broken, CODEX, 'not = [toml');
  await write(broken, VSCODE, '[]');
  const brokenResult = syncOk(broken);
  assert.doesNotMatch(brokenResult.stdout, /^(CONFLICT|WARNING)/m);
  assert.equal(await read(broken, ANTIGRAVITY), '{ not json');
  assert.equal(await read(broken, CODEX), 'not = [toml');
  assertInSync(broken);

  const sameName = await createTarget(registry);
  const mine = `${JSON.stringify({ mcpServers: { alpha: { command: 'python' } } }, null, 2)}\n`;
  await write(sameName, ANTIGRAVITY, mine);
  await write(sameName, CODEX, '[mcp_servers.alpha]\ncommand = "python"\n');
  syncOk(sameName);
  assert.equal(await read(sameName, ANTIGRAVITY), mine);
  assert.equal(await read(sameName, CODEX), '[mcp_servers.alpha]\ncommand = "python"\n');
  assertInSync(sameName);
});

test('a client file that became unreadable is left alone when its client is deselected', async () => {
  const root = await createTarget(TWO_SERVERS);
  syncOk(root);
  await write(root, ANTIGRAVITY, '{ not json');
  await write(root, REGISTRY, `clients: [claude, vscode, codex]\n${TWO_SERVERS}`);

  const result = syncOk(root);

  assert.doesNotMatch(result.stdout, /^CONFLICT/m);
  assert.match(result.stdout, /WARNING\s+\.agents\/mcp_config\.json.*no longer managed/);
  assert.equal(await read(root, ANTIGRAVITY), '{ not json');
  assertInSync(root);
});

test('deselecting codex removes the managed block and keeps the rest of the file', async () => {
  const root = await createTarget(TWO_SERVERS);
  await write(root, CODEX, 'model = "example"\n\n[profiles.mine]\nmodel = "other"\n');
  syncOk(root);
  assert.match(await read(root, CODEX), /\[mcp_servers\.alpha\]/);
  await write(root, REGISTRY, `clients: [claude, vscode, antigravity]\n${TWO_SERVERS}`);

  const result = syncOk(root);

  assert.doesNotMatch(result.stdout, /^(CONFLICT|WARNING)/m);
  const codex = await read(root, CODEX);
  assert.equal(codex, 'model = "example"\n\n[profiles.mine]\nmodel = "other"\n');
  const state = await readState(root);
  assert.deepEqual(Object.keys(state.managedMcpServers.alpha.targetFingerprints), [CLAUDE, VSCODE, ANTIGRAVITY]);
  assertInSync(root);

  // The file can then be deleted without the kit recreating it or reporting drift.
  await rm(path.join(root, '.codex', 'config.toml'));
  assertInSync(root);
  syncOk(root);
  assert.equal(await exists(root, CODEX), false);
});

test('deselecting codex keeps an edited entry as an unmanaged one and says so', async () => {
  const root = await createTarget(TWO_SERVERS);
  syncOk(root);
  await write(root, CODEX, (await read(root, CODEX)).replace('args = ["./alpha.mjs"]', 'args = ["./edited.mjs"]\nstartup_timeout_sec = 20'));
  await write(root, REGISTRY, `clients: [claude, vscode, antigravity]\n${TWO_SERVERS}`);

  const result = syncOk(root);

  assert.match(result.stdout, /WARNING\s+\.codex\/config\.toml.*"alpha".*edited.*no longer managed/);
  assert.doesNotMatch(result.stdout, /^CONFLICT/m);
  const codex = await read(root, CODEX);
  assert.equal(codex, '[mcp_servers.alpha]\ncommand = "node"\nargs = ["./edited.mjs"]\nstartup_timeout_sec = 20\n');
  assertInSync(root);
});

test('skipping codex for one server keeps an edited entry and regenerates the rest of the block', async () => {
  const root = await createTarget(TWO_SERVERS);
  syncOk(root);
  await write(root, CODEX, (await read(root, CODEX)).replace('args = ["./alpha.mjs"]', 'args = ["./edited.mjs"]'));
  await write(root, REGISTRY, TWO_SERVERS.replace("args: ['./alpha.mjs']", "args: ['./alpha.mjs']\n    skip: [codex]"));

  const result = syncOk(root);

  assert.match(result.stdout, /WARNING\s+\.codex\/config\.toml.*"alpha"/);
  const codex = await read(root, CODEX);
  assert.match(codex, /\[mcp_servers\.alpha\]\ncommand = "node"\nargs = \["\.\/edited\.mjs"\]\n/);
  assert.match(codex, /# BEGIN Drakom AI[^\n]*\n\[mcp_servers\.beta\]/);
  assertInSync(root);
});

// ---------------------------------------------------------------------------
// Overrides that remove a key
// ---------------------------------------------------------------------------

test('an override removes one env key with null', () => {
  const server = validServer(
    {
      servers: {
        s: {
          command: 'node',
          env: { AUTH_MODE: 'oauth', LOG_LEVEL: 'info' },
          overrides: { codex: { env: { AUTH_MODE: null, EXTRA: 'yes' } } },
        },
      },
    },
    's',
  );

  assert.deepEqual(generateClaudeServer(server).env, { AUTH_MODE: 'oauth', LOG_LEVEL: 'info' });
  const codex = generateCodexServerSnippet('s', server);
  assert.doesNotMatch(codex, /AUTH_MODE/);
  assert.match(codex, /LOG_LEVEL = "info"/);
  assert.match(codex, /EXTRA = "yes"/);
});

test('an override removes the whole env map with null', () => {
  const server = validServer(
    { servers: { s: { command: 'node', env: { A: '1', B: '2' }, overrides: { vscode: { env: null } } } } },
    's',
  );

  assert.deepEqual(generateVscodeServer(server), { type: 'stdio', command: 'node' });
  assert.deepEqual(generateClaudeServer(server).env, { A: '1', B: '2' });
});

test('an override removes one header with null, under headers or http.headers', () => {
  const base = { http: { url: 'https://mcp.example.com/a', headers: { Authorization: 'Bearer ${TOKEN}', 'X-Client': 'kit' } } };
  const viaHeaders = validServer(
    { servers: { s: { ...base, overrides: { antigravity: { headers: { Authorization: null } } } } } },
    's',
  );
  const viaHttp = validServer(
    {
      servers: {
        s: { ...base, overrides: { antigravity: { http: { url: 'https://mcp.example.com/a', headers: { Authorization: null } } } } },
      },
    },
    's',
  );

  for (const server of [viaHeaders, viaHttp]) {
    assert.deepEqual(generateAntigravityServer(server), {
      serverUrl: 'https://mcp.example.com/a',
      headers: { 'X-Client': 'kit' },
    });
    assert.deepEqual(generateClaudeServer(server).headers, { Authorization: 'Bearer ${TOKEN}', 'X-Client': 'kit' });
  }
});

test('an override removes the whole header map with null, under headers or http.headers', () => {
  const base = { http: { url: 'https://mcp.example.com/a', headers: { Authorization: 'Bearer ${TOKEN}', 'X-Client': 'kit' } } };
  const viaHeaders = validServer({ servers: { s: { ...base, overrides: { antigravity: { headers: null } } } } }, 's');
  const viaHttp = validServer(
    { servers: { s: { ...base, overrides: { antigravity: { http: { url: 'https://mcp.example.com/a', headers: null } } } } } },
    's',
  );

  for (const server of [viaHeaders, viaHttp]) {
    assert.deepEqual(generateAntigravityServer(server), { serverUrl: 'https://mcp.example.com/a' });
    assert.equal(generateCodexServerSnippet('s', server).includes('bearer_token_env_var = "TOKEN"'), true);
  }
});

test('null is rejected outside overrides', () => {
  assert.match(
    validationErrorOf({ servers: { s: { command: 'node', env: { A: null } } } }),
    /MCP server "s" env must be a mapping of string to string/,
  );
  assert.match(
    validationErrorOf({ servers: { s: { command: 'node', env: null } } }),
    /MCP server "s" env must be a mapping of string to string/,
  );
  assert.match(
    validationErrorOf({ servers: { s: { http: { url: 'https://mcp.example.com/a', headers: { A: null } } } } }),
    /MCP server "s" http\.headers must be a mapping of string to string/,
  );
  assert.match(
    validationErrorOf({ servers: { s: { http: { url: 'https://mcp.example.com/a', headers: null } } } }),
    /MCP server "s" http\.headers must be a mapping of string to string/,
  );
});

test('an override still rejects values that are neither a string nor null', () => {
  assert.match(
    validationErrorOf({ servers: { s: { command: 'node', overrides: { codex: { env: { A: 1 } } } } } }),
    /override for "codex" env must be a mapping of string to string or null/,
  );
  assert.match(
    validationErrorOf({
      servers: { s: { http: { url: 'https://mcp.example.com/a' }, overrides: { codex: { headers: { A: false } } } } },
    }),
    /override for "codex" headers must be a mapping of string to string or null/,
  );
});

test('removing a key through an override reaches the generated client file', async () => {
  const root = await createTarget(`servers:
  api:
    command: node
    env:
      AUTH_MODE: oauth
      LOG_LEVEL: info
    overrides:
      codex:
        env:
          AUTH_MODE: null
`);

  syncOk(root);

  assert.doesNotMatch(await read(root, CODEX), /AUTH_MODE/);
  assert.equal((await readJson(root, CLAUDE)).mcpServers.api.env.AUTH_MODE, 'oauth');
  assertInSync(root);
});

// ---------------------------------------------------------------------------
// Credential check
// ---------------------------------------------------------------------------

test('name matching trips on credential names and not on names that describe one', () => {
  const trips = [
    'API_KEY',
    'GITHUB_TOKEN',
    'TOKEN',
    'DB_PASSWORD',
    'CLIENT_SECRET',
    'X_API_KEY',
    'PRIVATE_KEY',
    'AUTH',
    'JWT',
    'api_key',
    'GitHub_Token',
    'APIKEY',
    'PASSWD',
    'AWS_CREDENTIALS',
    'SERVICE_CREDENTIAL',
    'AUTH_TOKEN',
    'TOKEN_SECRET',
    'SECRET_KEY',
    'GITHUB_TOKEN_2',
    'TOKEN_VALUE',
    'AUTH_HEADER',
    'SECRET_ID',
    'TOKEN_URL_SECRET',
    'AUTH_MODE_TOKEN',
  ];
  const passes = [
    'AUTH_MODE',
    'AUTH_TYPE',
    'OAUTH_TOKEN_TYPE',
    'X_TOKEN_TYPE',
    'TOKEN_URL',
    'PASSWORD_FILE',
    'SECRET_NAME',
    'OIDC_AUTH_URL',
    'KEYCLOAK_AUTH_URL',
    'auth_mode',
    'TOKEN_ENDPOINT',
    'PRIVATE_KEY_PATH',
    'API_KEY_FILE',
    'AUTH_METHOD',
    'LOG_LEVEL',
    'AUTHOR',
    'TOKENIZER',
    'SECRETARY_NAME',
  ];

  for (const name of trips) assert.equal(isSensitiveName(name), true, `${name} should trip`);
  for (const name of passes) assert.equal(isSensitiveName(name), false, `${name} should not trip`);
});

test('a descriptive name is refused when its value carries URL credentials', () => {
  const withUserinfo = ['https://', 'user', ':', 'placeholder', '@auth.example.com/token'].join('');

  assert.deepEqual(checkLiteralCredentials({ command: 'node', env: { TOKEN_URL: 'https://auth.example.com/token' } }), {
    hasCredentials: false,
  });
  const refused = checkLiteralCredentials({ command: 'node', env: { TOKEN_URL: withUserinfo } });
  assert.equal(refused.hasCredentials, true);
  assert.equal(refused.field, 'env.TOKEN_URL');
});

test('sync accepts descriptive env names that used to be refused', async () => {
  const root = await createTarget(`servers:
  api:
    command: node
    env:
      AUTH_MODE: oauth
      OAUTH_TOKEN_TYPE: bearer
      PASSWORD_FILE: /run/secrets/db
      TOKEN_URL: https://auth.example.com/token
`);

  syncOk(root);

  assert.equal((await readJson(root, CLAUDE)).mcpServers.api.env.AUTH_MODE, 'oauth');
});

test('the credential conflict names both ways out', async () => {
  const root = await createTarget(`servers:
  api:
    command: node
    env:
      AUTH: basic
`);

  const result = drakom('sync', root);

  assert.equal(result.status, 2);
  assert.match(result.stdout, /CONFLICT.*MCP registry server "api" contains literal credentials in env\.AUTH\./);
  assert.match(result.stdout, /\$\{VAR\} reference/);
  assert.match(result.stdout, /add "env\.AUTH" to the server's notSecret list/);
  assert.equal(await exists(root, CLAUDE), false);
});

test('notSecret lets a plain value through the name check', async () => {
  const root = await createTarget(`servers:
  api:
    command: node
    notSecret: [env.AUTH]
    env:
      AUTH: basic
  docs:
    http:
      url: https://mcp.example.com/docs
      headers:
        Token: none
    notSecret: [headers.Token]
`);

  syncOk(root);

  const claude = await readJson(root, CLAUDE);
  assert.equal(claude.mcpServers.api.env.AUTH, 'basic');
  assert.equal(claude.mcpServers.docs.headers.Token, 'none');
  assert.equal('notSecret' in claude.mcpServers.api, false);
  assertInSync(root);
});

test('notSecret names an override field by the path the conflict prints', async () => {
  const registry = `servers:
  api:
    command: node
    env:
      LOG_LEVEL: info
    overrides:
      codex:
        env:
          AUTH: basic
`;
  const root = await createTarget(registry);
  const refused = drakom('sync', root);
  assert.equal(refused.status, 2);
  assert.match(refused.stdout, /literal credentials in overrides\.codex\.env\.AUTH\./);
  assert.match(refused.stdout, /add "overrides\.codex\.env\.AUTH" to the server's notSecret list/);

  await write(root, REGISTRY, registry.replace('    command: node\n', '    command: node\n    notSecret: [overrides.codex.env.AUTH]\n'));
  syncOk(root);

  assert.match(await read(root, CODEX), /AUTH = "basic"/);
});

test('a base notSecret path does not cover the same key set by an override', () => {
  const server = validServer(
    {
      servers: {
        s: { command: 'node', env: { AUTH: 'basic' }, notSecret: ['env.AUTH'], overrides: { codex: { env: { AUTH: 'digest' } } } },
      },
    },
    's',
  );

  const result = checkLiteralCredentials(server, '', new Set(server.notSecret));

  assert.equal(result.hasCredentials, true);
  assert.equal(result.field, 'overrides.codex.env.AUTH');
});

test('a notSecret path that matches no field is a validation error', async () => {
  assert.match(
    validationErrorOf({ servers: { s: { command: 'node', env: { AUTH_MODE: 'x' }, notSecret: ['env.AUTH_MOED'] } } }),
    /MCP server "s" notSecret lists "env\.AUTH_MOED", which matches no field of this server/,
  );
  assert.match(
    validationErrorOf({ servers: { s: { command: 'node', env: { AUTH: 'x' }, notSecret: ['headers.AUTH'] } } }),
    /matches no field/,
  );
  assert.match(
    validationErrorOf({ servers: { s: { command: 'node', env: { AUTH: 'x' }, notSecret: ['overrides.codex.env.AUTH'] } } }),
    /matches no field/,
  );
  assert.match(
    validationErrorOf({
      servers: { s: { command: 'node', overrides: { codex: { env: { AUTH: null } } }, notSecret: ['overrides.codex.env.AUTH'] } },
    }),
    /matches no field/,
  );

  const root = await createTarget(`servers:
  api:
    command: node
    notSecret: [env.AUTH_MOED]
    env:
      AUTH_MODE: oauth
`);
  const result = drakom('sync', root);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /CONFLICT.*Invalid MCP configuration: MCP server "api" notSecret lists "env\.AUTH_MOED"/);
});

test('notSecret must be a list of env or header paths', () => {
  /** @param {unknown} notSecret */
  const errorFor = (notSecret) => validationErrorOf({ servers: { s: { command: 'node', args: ['x'], env: { A: 'b' }, notSecret } } });

  assert.match(errorFor('env.A'), /MCP server "s" notSecret must be a list of field paths/);
  assert.match(errorFor([1]), /MCP server "s" notSecret must be a list of field paths/);
  assert.match(errorFor(['args[0]']), /notSecret entry "args\[0\]" is not supported.*env\.NAME.*headers\.NAME/);
  assert.match(errorFor(['A']), /notSecret entry "A" is not supported/);
  assert.match(errorFor(['overrides.cursor.env.A']), /notSecret entry "overrides\.cursor\.env\.A" is not supported/);
});

test('a token-shaped value is refused even when the field is listed under notSecret', async () => {
  const root = await createTarget(`servers:
  api:
    command: node
    notSecret: [env.API_KEY, env.LABEL]
    env:
      API_KEY: ${FAKE_TOKEN}
      LABEL: ${FAKE_TOKEN}
`);

  const result = drakom('sync', root);

  assert.equal(result.status, 2);
  assert.match(result.stdout, /CONFLICT.*MCP registry server "api" contains literal credentials in env\.API_KEY\./);
  assert.match(result.stdout, /looks like a token.*notSecret does not apply/);
  assert.doesNotMatch(result.stdout, /add "env\.API_KEY" to the server's notSecret list/);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(FAKE_TOKEN));
  assert.equal(await exists(root, CLAUDE), false);
});

test('URL credentials are refused whatever notSecret lists', () => {
  const url = ['https://', 'user', ':', 'placeholder', '@mcp.example.com/a'].join('');
  const server = { http: { url, headers: { Token: 'none' } }, notSecret: ['headers.Token'] };

  const result = checkLiteralCredentials(server, '', new Set(server.notSecret));

  assert.equal(result.hasCredentials, true);
  assert.equal(result.field, 'url.userinfo');
});

test('discovery ignores a notSecret key written into a client file', () => {
  const result = checkLiteralCredentials({ command: 'node', env: { API_KEY: 'plain-value' }, notSecret: ['env.API_KEY'] });

  assert.equal(result.hasCredentials, true);
});

// ---------------------------------------------------------------------------
// Turning MCP on after init --skip-mcp
// ---------------------------------------------------------------------------

test('sync without a registry leaves a --skip-mcp project as it is', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'drakom-mcp-selection-'));
  assert.equal(drakom('init', root, ['--yes', '--skip-mcp']).status, 0);
  const before = await read(root, `${DRAKOM_DIR}/state.json`);

  const result = syncOk(root);

  assert.match(result.stdout, /Installation is already up to date/);
  assert.equal(await read(root, `${DRAKOM_DIR}/state.json`), before);
  assert.equal((await readState(root)).features.mcp, false);
  assert.equal(await exists(root, CLAUDE), false);
  assertInSync(root);
});

test('sync turns MCP on when a registry appears in a --skip-mcp project', async () => {
  const root = await createTarget(TWO_SERVERS, ['--skip-mcp']);
  assert.equal((await readState(root)).features.mcp, false);

  const dryRun = drakom('sync', root, ['--dry-run']);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.match(dryRun.stdout, /CREATE\s+\.mcp\.json/);
  assert.match(dryRun.stdout, /UPDATE\s+\.drakom-ai\/state\.json — Turn on MCP management/);
  assert.equal(await exists(root, CLAUDE), false);
  assert.equal((await readState(root)).features.mcp, false);

  const check = drakom('sync', root, ['--check']);
  assert.equal(check.status, 2);

  syncOk(root);

  assert.equal((await readState(root)).features.mcp, true);
  assert.deepEqual(Object.keys((await readJson(root, CLAUDE)).mcpServers), ['alpha', 'beta']);
  assert.equal(await exists(root, CODEX), true);
  assertInSync(root);
});

test('an empty registry is enough to turn MCP on', async () => {
  const root = await createTarget('servers: {}\n', ['--skip-mcp']);

  syncOk(root);

  assert.equal((await readState(root)).features.mcp, true);
  assert.equal(await exists(root, CLAUDE), false);
  assertInSync(root);
});

test('MCP stays off while the new registry is invalid', async () => {
  const root = await createTarget('servers: [unclosed\n', ['--skip-mcp']);

  const result = drakom('sync', root);

  assert.equal(result.status, 2);
  assert.match(result.stdout, /CONFLICT\s+\.drakom-ai\/mcp-servers\.yaml/);
  assert.equal((await readState(root)).features.mcp, false);
});

test('init help says how to turn MCP on after --skip-mcp', () => {
  assert.match(renderCliHelp('init'), /--skip-mcp[\s\S]*mcp-servers\.yaml[\s\S]*sync/);
});

// ---------------------------------------------------------------------------
// Shipped example
// ---------------------------------------------------------------------------

test('the example registry synchronizes cleanly and shows the new keys at work', async () => {
  const example = await readFile(path.join(repositoryRoot, 'examples', 'mcp-servers.yaml'), 'utf8');
  const root = await createTarget(example);

  syncOk(root);

  const antigravity = (await readJson(root, ANTIGRAVITY)).mcpServers;
  assert.equal('issue-tracker' in antigravity, false);
  assert.deepEqual(antigravity.search.env, { AUTH: 'none' });
  const claude = (await readJson(root, CLAUDE)).mcpServers;
  assert.equal(claude['issue-tracker'].headers.Authorization, 'Bearer ${ISSUE_TRACKER_TOKEN}');
  assert.deepEqual(claude.search.env, { SEARCH_API_KEY: '${SEARCH_API_KEY}', AUTH: 'none' });
  assertInSync(root);
});

// ---------------------------------------------------------------------------
// Review round: unchanged output for references and client overrides
// ---------------------------------------------------------------------------

test('a URL reference with Claude and VS Code overrides produces the same bytes and state as before', async () => {
  const root = await createTarget(`servers:
  regional:
    http:
      url: https://\${MCP_HOST}/mcp
      headers:
        X-Client: kit
    overrides:
      claude:
        headers:
          X-Agent: claude
      vscode:
        http:
          url: https://\${MCP_HOST}/vscode
          type: sse
          headers:
            X-Agent: vscode
      antigravity:
        serverUrl: https://mcp.example.com/mcp
      codex:
        url: https://mcp.example.com/mcp
`);

  syncOk(root);

  // Captured from the build before client selection existed.
  assert.equal(
    await read(root, CLAUDE),
    '{\n  "mcpServers": {\n    "regional": {\n      "type": "http",\n      "url": "https://${MCP_HOST}/mcp",\n      "headers": {\n        "X-Client": "kit",\n        "X-Agent": "claude"\n      }\n    }\n  }\n}\n',
  );
  assert.equal(
    await read(root, VSCODE),
    '{\n  "servers": {\n    "regional": {\n      "type": "sse",\n      "url": "https://${env:MCP_HOST}/vscode",\n      "headers": {\n        "X-Client": "kit",\n        "X-Agent": "vscode"\n      }\n    }\n  }\n}\n',
  );
  assert.equal(
    await read(root, ANTIGRAVITY),
    '{\n  "mcpServers": {\n    "regional": {\n      "serverUrl": "https://mcp.example.com/mcp",\n      "headers": {\n        "X-Client": "kit"\n      }\n    }\n  }\n}\n',
  );
  assert.equal(
    await read(root, CODEX),
    '# BEGIN Drakom AI Development Context MCP servers\n[mcp_servers.regional]\nurl = "https://mcp.example.com/mcp"\n\n[mcp_servers.regional.http_headers]\nX-Client = "kit"\n\n# END Drakom AI Development Context MCP servers\n',
  );
  assert.equal(
    JSON.stringify((await readState(root)).managedMcpServers),
    JSON.stringify({
      regional: {
        sourceFingerprint: 'sha256:9543e0b985031edbaea8f9bfbba0a1a155a2167a1d7d09362325457ea4c7a3e7',
        targetFingerprints: {
          '.mcp.json': 'sha256:7da22e8f10cd18d8d24303fd9bee2174ec6e17a11662460a93abe9faef006c5c',
          '.vscode/mcp.json': 'sha256:4bae3c7117cab34c2cadbdfbc019d845994d326d1844d0b7cfbca4d325389863',
          '.agents/mcp_config.json': 'sha256:74e339537207875c191ed56f0e8d77620aca5ff75a05223d21ab40f4e14aeb46',
          '.codex/config.toml': 'sha256:ca12c447ea8af49c5cd053840ee24d228944a292baf64fdb97950635697c2427',
        },
      },
    }),
  );
});

test('env references render for Claude, VS Code and Codex exactly as before', () => {
  const server = validServer(
    {
      servers: {
        gh: {
          command: 'node',
          args: ['--host', '${MCP_HOST}'],
          env: { GITHUB_TOKEN: '${GITHUB_TOKEN}', REGION: '${env:AWS_REGION}', PLAIN: 'x' },
          overrides: { codex: { args: ['--host', 'fixed'], env: { REGION: 'eu' } } },
        },
      },
    },
    'gh',
  );

  // Captured from the build before client selection existed.
  assert.equal(
    JSON.stringify(generateClaudeServer(server)),
    '{"command":"node","args":["--host","${MCP_HOST}"],"env":{"GITHUB_TOKEN":"${GITHUB_TOKEN}","REGION":"${AWS_REGION}","PLAIN":"x"}}',
  );
  assert.equal(
    JSON.stringify(generateVscodeServer(server)),
    '{"type":"stdio","command":"node","args":["--host","${env:MCP_HOST}"],"env":{"GITHUB_TOKEN":"${env:GITHUB_TOKEN}","REGION":"${env:AWS_REGION}","PLAIN":"x"}}',
  );
  assert.equal(
    generateCodexServerSnippet('gh', server),
    '[mcp_servers.gh]\ncommand = "node"\nargs = ["--host","fixed"]\nenv_vars = ["GITHUB_TOKEN"]\n\n[mcp_servers.gh.env]\nREGION = "eu"\nPLAIN = "x"\n',
  );
});

// ---------------------------------------------------------------------------
// Review round: credentials under descriptive names and in merged header maps
// ---------------------------------------------------------------------------

// Placeholders assembled at run time; none is a real credential.
const USER_INFO = ['user', 'placeholder'].join(':');
const QUERY_SECRET = ['token', 'placeholder000000'].join('=');

test('a descriptive name does not excuse a value that carries a credential', () => {
  /** @type {Array<[string, string]>} */
  const refused = [
    ['AUTH_URL', `https://auth.example.com/x?${QUERY_SECRET}&api_key=placeholder`],
    ['AUTH_URL', `https://auth.example.com/x?api_key=placeholder`],
    ['AUTH_URL', `${USER_INFO}@auth.example.com/x`],
    ['AUTH_URL', `https://${USER_INFO}@auth.example.com/x`],
    ['TOKEN_ENDPOINT', `auth.example.com/x?${QUERY_SECRET}`],
    ['PASSWORD_FILE', `sftp://${USER_INFO}@files.example.com/run/secrets/pw`],
    ['SECRET_NAME', FAKE_TOKEN],
    ['TOKEN_TYPE', FAKE_TOKEN],
  ];
  /** @type {Array<[string, string]>} */
  const accepted = [
    ['AUTH_MODE', 'oauth'],
    ['AUTH_TYPE', 'basic'],
    ['TOKEN_URL', 'https://auth.example.com/token'],
    ['TOKEN_URL', 'https://auth.example.com/token?grant_type=client_credentials&scope=read'],
    ['TOKEN_URL', 'https://auth.example.com/token?token=${REFRESH_TOKEN}'],
    ['OIDC_AUTH_URL', 'https://auth.example.com:8443/authorize'],
    ['PASSWORD_FILE', '/run/secrets/pw'],
    ['SECRET_NAME', 'my-secret'],
    ['AUTH_NAME', 'team@example.com'],
  ];

  for (const [name, value] of refused) {
    const listed = new Set([`env.${name}`]);
    for (const notSecret of [undefined, listed]) {
      const result = checkLiteralCredentials({ command: 'node', env: { [name]: value } }, '', notSecret);
      assert.deepEqual(result, { hasCredentials: true, field: `env.${name}`, reason: 'value' }, `${name} should be refused`);
    }
  }
  for (const [name, value] of accepted) {
    assert.deepEqual(
      checkLiteralCredentials({ command: 'node', env: { [name]: value } }),
      { hasCredentials: false },
      `${name}=${value} should pass`,
    );
  }
});

test('sync refuses a credential in a descriptively named env value and writes nothing', async () => {
  const root = await createTarget(`servers:
  api:
    command: node
    notSecret: [env.AUTH_URL]
    env:
      AUTH_URL: "https://auth.example.com/x?${QUERY_SECRET}"
`);

  const result = drakom('sync', root);

  assert.equal(result.status, 2);
  assert.match(result.stdout, /CONFLICT.*MCP registry server "api" contains literal credentials in env\.AUTH_URL\./);
  assert.match(result.stdout, /notSecret does not apply/);
  assert.doesNotMatch(result.stdout + result.stderr, /placeholder000000/);
  assert.equal(await exists(root, CLAUDE), false);
});

test('init discovery flags a credential in a descriptively named env value', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'drakom-mcp-selection-'));
  await write(
    root,
    CLAUDE,
    JSON.stringify({
      mcpServers: {
        leaky: { command: 'node', env: { AUTH_URL: `https://auth.example.com/x?${QUERY_SECRET}` } },
        schemeless: { command: 'node', env: { AUTH_URL: `${USER_INFO}@auth.example.com/x` } },
        fine: { command: 'node', env: { AUTH_MODE: 'oauth', TOKEN_URL: 'https://auth.example.com/token' } },
      },
    }),
  );

  const discovered = discoverMcp(await inspectTarget(root));

  assert.equal(discovered.servers.get('leaky')?.classification, 'literal_credentials');
  assert.equal(discovered.servers.get('schemeless')?.classification, 'literal_credentials');
  assert.equal(discovered.servers.get('fine')?.classification, 'identical');
  const init = drakom('init', root, ['--dry-run']);
  assert.doesNotMatch(init.stdout + init.stderr, /placeholder000000/);
});

test('every header map an override merges is checked for credentials', async () => {
  const literal = ['Bearer', 'placeholder-literal-value'].join(' ');
  const direct = checkLiteralCredentials({
    http: { url: 'https://mcp.example.com/a', headers: { Authorization: literal } },
    headers: { 'X-A': 'a' },
  });
  assert.deepEqual(direct, { hasCredentials: true, field: 'headers.Authorization', reason: 'name' });

  const root = await createTarget(`servers:
  docs:
    http:
      url: https://mcp.example.com/docs
    overrides:
      claude:
        headers:
          X-A: a
        http:
          url: https://mcp.example.com/docs
          headers:
            Authorization: "${literal}"
`);

  const result = drakom('sync', root);

  assert.equal(result.status, 2);
  assert.match(result.stdout, /CONFLICT.*literal credentials in overrides\.claude\.headers\.Authorization\./);
  assert.doesNotMatch(result.stdout + result.stderr, /placeholder-literal-value/);
  assert.equal(await exists(root, CLAUDE), false);
});

test('notSecret on a header does not clear a token-shaped value or URL credentials', () => {
  const notSecret = new Set(['headers.Authorization']);
  const url = 'https://mcp.example.com/a';

  for (const value of [`https://${USER_INFO}@auth.example.com`, `${USER_INFO}@auth.example.com`, FAKE_TOKEN, `https://auth.example.com/x?${QUERY_SECRET}`]) {
    assert.deepEqual(
      checkLiteralCredentials({ http: { url, headers: { Authorization: value } } }, '', notSecret),
      { hasCredentials: true, field: 'headers.Authorization', reason: 'value' },
    );
  }
  assert.deepEqual(checkLiteralCredentials({ http: { url, headers: { Authorization: 'none' } } }, '', notSecret), {
    hasCredentials: false,
  });
});

// ---------------------------------------------------------------------------
// Review round: releasing Codex entries, and warnings while MCP is held back
// ---------------------------------------------------------------------------

test('a released, edited Codex entry keeps the comment lines directly above it', async () => {
  const root = await createTarget(TWO_SERVERS);
  syncOk(root);
  await write(
    root,
    CODEX,
    (await read(root, CODEX))
      .replace('[mcp_servers.alpha]', '# first note\n# second note\n[mcp_servers.alpha]')
      .replace('args = ["./alpha.mjs"]', 'args = ["./edited.mjs"]')
      .replace('[mcp_servers.beta]', '# about beta\n[mcp_servers.beta]'),
  );
  await write(root, REGISTRY, TWO_SERVERS.replace("args: ['./alpha.mjs']", "args: ['./alpha.mjs']\n    skip: [codex]"));

  syncOk(root);

  const codex = await read(root, CODEX);
  assert.ok(
    codex.startsWith('# first note\n# second note\n[mcp_servers.alpha]\ncommand = "node"\nargs = ["./edited.mjs"]\n\n# BEGIN Drakom AI'),
    codex,
  );
  assert.equal(codex.split('# about beta').length, 1, 'a comment above another server does not travel with the entry');
  assertInSync(root);
});

test('a released, edited Codex entry keeps the line endings of its file', async () => {
  const root = await createTarget(TWO_SERVERS);
  await write(root, CODEX, 'model = "example"\r\n');
  syncOk(root);
  await write(
    root,
    CODEX,
    (await read(root, CODEX))
      .replace('[mcp_servers.alpha]', '# note\n[mcp_servers.alpha]')
      .replace('args = ["./alpha.mjs"]', 'args = ["./edited.mjs"]')
      .replace(/\r?\n/g, '\r\n'),
  );
  await write(root, REGISTRY, `clients: [claude, vscode, antigravity]\n${TWO_SERVERS}`);

  syncOk(root);

  assert.equal(
    await read(root, CODEX),
    'model = "example"\r\n\r\n# note\r\n[mcp_servers.alpha]\r\ncommand = "node"\r\nargs = ["./edited.mjs"]\r\n',
  );
  assertInSync(root);
});

test('no release warning is shown while another MCP conflict holds MCP state back', async () => {
  const root = await createTarget(TWO_SERVERS);
  syncOk(root);
  const antigravity = await readJson(root, ANTIGRAVITY);
  antigravity.mcpServers.alpha.args = ['./edited.mjs'];
  await write(root, ANTIGRAVITY, `${JSON.stringify(antigravity, null, 2)}\n`);
  const claude = await readJson(root, CLAUDE);
  claude.mcpServers.beta.args = ['./edited.mjs'];
  await write(root, CLAUDE, `${JSON.stringify(claude, null, 2)}\n`);
  const stateBefore = await read(root, `${DRAKOM_DIR}/state.json`);
  await write(root, REGISTRY, `clients: [claude, vscode, codex]\n${TWO_SERVERS}`);

  const result = drakom('sync', root);

  assert.equal(result.status, 2);
  assert.match(result.stdout, /CONFLICT\s+\.mcp\.json.*"beta" was edited manually/);
  assert.doesNotMatch(result.stdout, /^WARNING/m);
  assert.doesNotMatch(result.stdout, /no longer managed/);
  assert.equal(await read(root, `${DRAKOM_DIR}/state.json`), stateBefore);
});

test('the Codex refusals also offer skip', () => {
  assert.throws(
    () => generateCodexServerSnippet('api', { command: 'node', args: ['--token=${TOKEN}'] }),
    /Codex.*cannot expand.*skip: \[codex\]/,
  );
  assert.throws(
    () => generateCodexServerSnippet('api', { http: { url: 'https://${env:HOST}/mcp' } }),
    /Codex.*cannot expand.*skip: \[codex\]/,
  );
  assert.throws(
    () => generateCodexServerSnippet('api', { command: 'node', env: { API_KEY: '${OTHER_KEY}' } }),
    /Codex cannot rename.*skip: \[codex\]/,
  );
});
