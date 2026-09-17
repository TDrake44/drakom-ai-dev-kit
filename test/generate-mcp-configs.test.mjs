import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(repositoryRoot, 'scripts', 'generate-mcp-configs.mjs');

/** @param {string} source */
async function createFixture(source) {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'drakom-mcp-'));
  await mkdir(path.join(fixtureRoot, '.ai'), { recursive: true });
  await writeFile(path.join(fixtureRoot, '.ai', 'mcp-servers.yaml'), source, 'utf8');
  return fixtureRoot;
}

/**
 * @param {string} cwd
 * @param {...string} args
 */
function runGenerator(cwd, ...args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    encoding: 'utf8',
  });
}

test('generates each supported tool configuration from one registry', async () => {
  const fixtureRoot = await createFixture(`
servers:
  local-tools:
    command: node
    args: ['./server.mjs']
    env:
      LOG_LEVEL: info
      TOKEN_REFERENCE: "\${TOKEN_REFERENCE}"
  docs:
    http:
      url: https://mcp.example.com/docs
      headers:
        X-Client: drakom
  native-override:
    command: node
    overrides:
      antigravity:
        serverUrl: https://mcp.example.com/native
        transport: http
        timeout: 30000
`);

  const result = runGenerator(fixtureRoot);
  assert.equal(result.status, 0, result.stderr);

  const claude = JSON.parse(await readFile(path.join(fixtureRoot, '.mcp.json'), 'utf8'));
  assert.deepEqual(claude.mcpServers['local-tools'], {
    command: 'node',
    args: ['./server.mjs'],
    env: { LOG_LEVEL: 'info', TOKEN_REFERENCE: '${TOKEN_REFERENCE}' },
  });
  assert.deepEqual(claude.mcpServers.docs, {
    type: 'http',
    url: 'https://mcp.example.com/docs',
    headers: { 'X-Client': 'drakom' },
  });

  const vscode = JSON.parse(await readFile(path.join(fixtureRoot, '.vscode', 'mcp.json'), 'utf8'));
  assert.equal(vscode.servers['local-tools'].type, 'stdio');

  const antigravity = JSON.parse(
    await readFile(path.join(fixtureRoot, '.agents', 'mcp_config.json'), 'utf8'),
  );
  assert.deepEqual(antigravity.mcpServers.docs, {
    serverUrl: 'https://mcp.example.com/docs',
    headers: { 'X-Client': 'drakom' },
  });
  assert.deepEqual(antigravity.mcpServers['native-override'], {
    serverUrl: 'https://mcp.example.com/native',
    transport: 'http',
    timeout: 30000,
  });

  const codex = await readFile(path.join(fixtureRoot, '.codex', 'config.toml'), 'utf8');
  assert.match(codex, /\[mcp_servers\.local-tools\]/);
  assert.match(codex, /\[mcp_servers\.docs\.http_headers\]/);
  assert.match(codex, /X-Client = "drakom"/);
});

test('quotes TOML keys and escapes TOML string values', async () => {
  const fixtureRoot = await createFixture(`
servers:
  "docs.prod":
    command: "node\\\"runtime"
    env:
      "API TOKEN": "line\\nvalue"
`);

  const result = runGenerator(fixtureRoot);
  assert.equal(result.status, 0, result.stderr);

  const codex = await readFile(path.join(fixtureRoot, '.codex', 'config.toml'), 'utf8');
  assert.match(codex, /\[mcp_servers\."docs\.prod"\]/);
  assert.match(codex, /command = "node\\\"runtime"/);
  assert.match(codex, /"API TOKEN" = "line\\nvalue"/);
});

test('reports invalid registry shapes with a clear error', async () => {
  const fixtureRoot = await createFixture('servers: []\n');
  const result = runGenerator(fixtureRoot);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid MCP registry/);
});

test('reports malformed YAML with a clear error', async () => {
  const fixtureRoot = await createFixture('servers: [\n');
  const result = runGenerator(fixtureRoot);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid MCP registry YAML/);
});

test('rejects definitions that would otherwise generate invalid or empty targets', async () => {
  const invalidRegistries = [
    {
      source: 'servers:\n  typo:\n    commmand: node\n',
      message: /unsupported field "commmand"/,
    },
    {
      source: 'servers:\n  empty: {}\n',
      message: /must define exactly one of command or http/,
    },
    {
      source:
        'servers:\n  ambiguous:\n    command: node\n    http:\n      url: https:\/\/mcp.example.com\n',
      message: /must define exactly one of command or http/,
    },
    {
      source:
        'servers:\n  tools:\n    command: node\n    overrides:\n      unknown-tool:\n        command: node\n',
      message: /unsupported override "unknown-tool"/,
    },
  ];

  for (const fixture of invalidRegistries) {
    const fixtureRoot = await createFixture(fixture.source);
    const result = runGenerator(fixtureRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, fixture.message);
  }
});

test('check mode detects generated configuration drift', async () => {
  const fixtureRoot = await createFixture('servers: {}\n');
  assert.equal(runGenerator(fixtureRoot).status, 0);
  await writeFile(path.join(fixtureRoot, '.mcp.json'), '{}\n', 'utf8');

  const result = runGenerator(fixtureRoot, '--check');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Config out of sync: \.mcp\.json/);
});

test('preserves unrelated existing settings and is idempotent', async () => {
  const fixtureRoot = await createFixture('servers:\n  local-tools:\n    command: node\n');
  await mkdir(path.join(fixtureRoot, '.vscode'), { recursive: true });
  await mkdir(path.join(fixtureRoot, '.agents'), { recursive: true });
  await mkdir(path.join(fixtureRoot, '.codex'), { recursive: true });
  await writeFile(
    path.join(fixtureRoot, '.mcp.json'),
    JSON.stringify({ projectSetting: true, mcpServers: { personal: { command: 'personal' } } }, null, 2),
    'utf8',
  );
  await writeFile(
    path.join(fixtureRoot, '.vscode', 'mcp.json'),
    JSON.stringify({ schema: 'https://example.com/schema', servers: { personal: { type: 'stdio', command: 'personal' } } }, null, 2),
    'utf8',
  );
  await writeFile(
    path.join(fixtureRoot, '.agents', 'mcp_config.json'),
    JSON.stringify({ mcpServers: { personal: { command: 'personal' } } }, null, 2),
    'utf8',
  );
  await writeFile(path.join(fixtureRoot, '.codex', 'config.toml'), 'model = "gpt-5"\n', 'utf8');

  const first = runGenerator(fixtureRoot);
  assert.equal(first.status, 0, first.stderr);
  const claude = JSON.parse(await readFile(path.join(fixtureRoot, '.mcp.json'), 'utf8'));
  assert.equal(claude.projectSetting, true);
  assert.deepEqual(claude.mcpServers.personal, { command: 'personal' });
  assert.deepEqual(claude.mcpServers['local-tools'], { command: 'node' });
  const codexPath = path.join(fixtureRoot, '.codex', 'config.toml');
  const generated = await readFile(codexPath, 'utf8');
  assert.match(generated, /^model = "gpt-5"/);
  assert.match(generated, /BEGIN AI Framework Blueprint MCP servers/);

  const second = runGenerator(fixtureRoot);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(await readFile(codexPath, 'utf8'), generated);
  assert.equal(runGenerator(fixtureRoot, '--check').status, 0);
});

test('preflights every target and does not write when a generated server conflicts', async () => {
  const fixtureRoot = await createFixture('servers:\n  local-tools:\n    command: node\n');
  await mkdir(path.join(fixtureRoot, '.codex'), { recursive: true });
  await writeFile(path.join(fixtureRoot, '.mcp.json'), '{"untouched":true}\n', 'utf8');
  await writeFile(
    path.join(fixtureRoot, '.codex', 'config.toml'),
    '[mcp_servers.local-tools]\ncommand = "personal"\n',
    'utf8',
  );

  const result = runGenerator(fixtureRoot);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /would replace an existing MCP server "local-tools"/);
  assert.equal(await readFile(path.join(fixtureRoot, '.mcp.json'), 'utf8'), '{"untouched":true}\n');
});

test('updates and removes previously managed servers while preserving unmanaged servers', async () => {
  const fixtureRoot = await createFixture('servers:\n  old-server:\n    command: old\n');
  assert.equal(runGenerator(fixtureRoot).status, 0);
  const mcpPath = path.join(fixtureRoot, '.mcp.json');
  const firstConfig = JSON.parse(await readFile(mcpPath, 'utf8'));
  firstConfig.mcpServers.personal = { command: 'personal' };
  await writeFile(mcpPath, JSON.stringify(firstConfig, null, 2) + '\n', 'utf8');
  await writeFile(
    path.join(fixtureRoot, '.ai', 'mcp-servers.yaml'),
    'servers:\n  new-server:\n    command: new\n',
    'utf8',
  );

  const result = runGenerator(fixtureRoot);
  assert.equal(result.status, 0, result.stderr);
  const updatedConfig = JSON.parse(await readFile(mcpPath, 'utf8'));
  assert.equal(updatedConfig.mcpServers['old-server'], undefined);
  assert.deepEqual(updatedConfig.mcpServers['new-server'], { command: 'new' });
  assert.deepEqual(updatedConfig.mcpServers.personal, { command: 'personal' });
});

test('rejects edits to previously managed JSON before writing any target', async () => {
  const fixtureRoot = await createFixture('servers:\n  local-tools:\n    command: node\n');
  assert.equal(runGenerator(fixtureRoot).status, 0);
  const vscodePath = path.join(fixtureRoot, '.vscode', 'mcp.json');
  const previousVscode = await readFile(vscodePath, 'utf8');
  await writeFile(
    path.join(fixtureRoot, '.mcp.json'),
    JSON.stringify({ mcpServers: { 'local-tools': { command: 'personal' } } }, null, 2) + '\n',
    'utf8',
  );

  const result = runGenerator(fixtureRoot);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /managed MCP server "local-tools" was edited/);
  assert.equal(await readFile(vscodePath, 'utf8'), previousVscode);
});

test('detects equivalent TOML server keys and invalid TOML before any writes', async () => {
  const configurations = [
    '[mcp_servers."tools"]\ncommand = "custom"\n',
    "['mcp_servers' . 'tools']\ncommand = 'custom'\n",
    '[mcp_servers.tools.env]\nTOKEN = "custom"\n',
    'mcp_servers = { tools = { command = "custom" } }\n',
    'invalid = [\n',
  ];
  for (const content of configurations) {
    const fixtureRoot = await createFixture('servers:\n  tools:\n    command: node\n');
    await mkdir(path.join(fixtureRoot, '.codex'), { recursive: true });
    await writeFile(path.join(fixtureRoot, '.codex/config.toml'), content);
    const result = runGenerator(fixtureRoot);
    assert.notEqual(result.status, 0, content);
    assert.equal(await readFile(path.join(fixtureRoot, '.codex/config.toml'), 'utf8'), content);
    await assert.rejects(readFile(path.join(fixtureRoot, '.mcp.json')));
  }
});

test('updates an owned server while preserving unmanaged TOML and rejects manual block edits', async () => {
  const fixtureRoot = await createFixture('servers:\n  tools:\n    command: old\n');
  await mkdir(path.join(fixtureRoot, '.codex'), { recursive: true });
  const unmanaged = '# My settings\nmodel = "custom"\n[mcp_servers.personal]\ncommand = "personal"\n';
  const codexPath = path.join(fixtureRoot, '.codex/config.toml');
  await writeFile(codexPath, unmanaged);
  assert.equal(runGenerator(fixtureRoot).status, 0);
  await writeFile(path.join(fixtureRoot, '.ai/mcp-servers.yaml'), 'servers:\n  tools:\n    command: new\n');
  const update = runGenerator(fixtureRoot);
  assert.equal(update.status, 0, update.stderr);
  const updated = await readFile(codexPath, 'utf8');
  assert.ok(updated.startsWith(unmanaged));
  assert.match(updated, /command = "new"/);
  const mcpBefore = await readFile(path.join(fixtureRoot, '.mcp.json'), 'utf8');
  await writeFile(codexPath, updated.replace('command = "new"', 'command = "manual"'));
  const conflict = runGenerator(fixtureRoot);
  assert.notEqual(conflict.status, 0);
  assert.match(conflict.stderr, /managed MCP block was edited/);
  assert.equal(await readFile(path.join(fixtureRoot, '.mcp.json'), 'utf8'), mcpBefore);
});
