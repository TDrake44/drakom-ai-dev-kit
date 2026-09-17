import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import yaml from 'js-yaml';
import { parse as parseToml } from 'smol-toml';

/** @typedef {Record<string, string>} StringMap */
/**
 * @typedef {object} HttpConfig
 * @property {string} url
 * @property {string} [type]
 * @property {StringMap} [headers]
 */
/**
 * @typedef {object} ServerConfig
 * @property {string} [command]
 * @property {string[]} [args]
 * @property {StringMap} [env]
 * @property {HttpConfig} [http]
 * @property {string} [url]
 * @property {string} [serverUrl]
 * @property {string} [httpUrl]
 * @property {string} [type]
 * @property {StringMap} [headers]
 * @property {Record<string, ServerConfig>} [overrides]
 */

const isCheck = process.argv.includes('--check');
const rootDir = process.cwd();
const sourcePath = path.join(rootDir, '.ai', 'mcp-servers.yaml');

if (!fs.existsSync(sourcePath)) {
  console.error(`Missing MCP source file: ${sourcePath}`);
  process.exit(1);
}

const rawYaml = fs.readFileSync(sourcePath, 'utf8');
/** @type {unknown} */
let parsed;

try {
  parsed = yaml.load(rawYaml) || {};
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Invalid MCP registry YAML: ${message}`);
  process.exit(1);
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @param {string} location
 * @returns {asserts value is StringMap}
 */
function assertStringMap(value, location) {
  if (!isRecord(value) || Object.values(value).some((entry) => typeof entry !== 'string')) {
    throw new TypeError(`${location} must be a mapping of string keys to string values`);
  }
}

const supportedBaseFields = new Set(['command', 'args', 'env', 'http', 'overrides']);
const supportedOverrideNames = new Set(['claude', 'vscode', 'antigravity', 'codex']);
const supportedCodexOverrideFields = new Set(['command', 'args', 'env', 'http', 'url', 'headers']);

/**
 * @param {Record<string, unknown>} value
 * @param {Set<string>} supportedFields
 * @param {string} location
 */
function assertSupportedFields(value, supportedFields, location) {
  for (const field of Object.keys(value)) {
    if (!supportedFields.has(field)) {
      throw new TypeError(`${location} contains unsupported field "${field}"`);
    }
  }
}

/**
 * @param {Record<string, unknown>} definition
 * @param {string} location
 */
function validateCommonFields(definition, location) {
  if ('command' in definition && typeof definition.command !== 'string') {
    throw new TypeError(`${location}.command must be a string`);
  }
  if (
    'args' in definition &&
    (!Array.isArray(definition.args) || definition.args.some((arg) => typeof arg !== 'string'))
  ) {
    throw new TypeError(`${location}.args must be an array of strings`);
  }
  if ('env' in definition) assertStringMap(definition.env, `${location}.env`);
  if ('headers' in definition) assertStringMap(definition.headers, `${location}.headers`);
  if ('http' in definition) {
    if (!isRecord(definition.http) || typeof definition.http.url !== 'string') {
      throw new TypeError(`${location}.http.url must be a string`);
    }
    const supportedHttpFields = new Set(['url', 'type', 'headers']);
    assertSupportedFields(definition.http, supportedHttpFields, `${location}.http`);
    if ('type' in definition.http && typeof definition.http.type !== 'string') {
      throw new TypeError(`${location}.http.type must be a string`);
    }
    if ('headers' in definition.http) {
      assertStringMap(definition.http.headers, `${location}.http.headers`);
    }
  }
  for (const key of ['url', 'serverUrl', 'httpUrl', 'type', 'transport']) {
    if (key in definition && typeof definition[key] !== 'string') {
      throw new TypeError(`${location}.${key} must be a string`);
    }
  }
}

/**
 * @param {unknown} override
 * @param {string} tool
 * @param {string} location
 */
function validateOverride(override, tool, location) {
  if (!isRecord(override)) throw new TypeError(`${location} must be a mapping`);
  validateCommonFields(override, location);

  if (tool === 'codex') {
    assertSupportedFields(override, supportedCodexOverrideFields, location);
    const connectionCount = ['command', 'http', 'url'].filter((field) => field in override).length;
    if (connectionCount !== 1) {
      throw new TypeError(`${location} must define exactly one of command, http, or url`);
    }
    return;
  }

  const connectionCount = ['command', 'http', 'url', 'serverUrl', 'httpUrl'].filter(
    (field) => field in override,
  ).length;
  if (connectionCount !== 1) {
    throw new TypeError(
      `${location} must define exactly one of command, http, url, serverUrl, or httpUrl`,
    );
  }
}

/**
 * @param {unknown} server
 * @param {string} location
 * @returns {asserts server is ServerConfig}
 */
function validateServer(server, location) {
  if (!isRecord(server)) throw new TypeError(`${location} must be a mapping`);
  assertSupportedFields(server, supportedBaseFields, location);
  validateCommonFields(server, location);

  const connectionCount = ['command', 'http'].filter((field) => field in server).length;
  if (connectionCount !== 1) {
    throw new TypeError(`${location} must define exactly one of command or http`);
  }
  if ('http' in server && ('args' in server || 'env' in server)) {
    throw new TypeError(`${location} HTTP servers cannot define args or env`);
  }

  if ('overrides' in server) {
    if (!isRecord(server.overrides)) throw new TypeError(`${location}.overrides must be a mapping`);
    for (const [tool, override] of Object.entries(server.overrides)) {
      if (!supportedOverrideNames.has(tool)) {
        throw new TypeError(`${location} contains unsupported override "${tool}"`);
      }
      validateOverride(override, tool, `${location}.overrides.${tool}`);
    }
  }
}

try {
  if (!isRecord(parsed) || !isRecord(parsed.servers)) {
    throw new TypeError('servers must be a mapping');
  }
  for (const [name, server] of Object.entries(parsed.servers)) {
    if (name.length === 0) throw new TypeError('server names must not be empty');
    validateServer(server, `servers.${name}`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Invalid MCP registry: ${message}`);
  process.exit(1);
}

const servers = /** @type {Record<string, ServerConfig>} */ (parsed.servers);

/** @param {string} value */
function tomlKey(value) {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : JSON.stringify(value);
}

/** @param {string} value */
function tomlString(value) {
  return JSON.stringify(value);
}

/**
 * @param {string} name
 * @param {string} tool
 * @returns {ServerConfig | null}
 */
function resolveServer(name, tool) {
  const s = servers[name];
  if (!s) return null;
  if (s.overrides && s.overrides[tool]) {
    return s.overrides[tool];
  }
  const result = {};
  if (s.command) result.command = s.command;
  if (s.args) result.args = s.args;
  if (s.env) result.env = s.env;
  if (s.http) result.http = s.http;
  return result;
}

/**
 * @param {string} name
 * @param {string} tool
 * @returns {ServerConfig | null}
 */
function getOverride(name, tool) {
  return servers[name].overrides?.[tool] || null;
}

// 1. Claude Code / GitHub Copilot CLI: .mcp.json
//    Claude Code expects { type: "http", url: "..." } or stdio { command, args, env }
/** @type {{mcpServers: Record<string, ServerConfig>}} */
const claudeConfig = { mcpServers: {} };
for (const name of Object.keys(servers)) {
  const override = getOverride(name, 'claude');
  if (override) {
    claudeConfig.mcpServers[name] = override;
    continue;
  }
  const resolved = resolveServer(name, 'claude');
  if (!resolved) continue;
  if (resolved.http) {
    /** @type {ServerConfig} */
    const entry = { type: resolved.http.type || 'http', url: resolved.http.url };
    if (resolved.http.headers) entry.headers = resolved.http.headers;
    claudeConfig.mcpServers[name] = entry;
  } else if (resolved.url) {
    /** @type {ServerConfig} */
    const entry = { type: resolved.type || 'http', url: resolved.url };
    if (resolved.headers) entry.headers = resolved.headers;
    claudeConfig.mcpServers[name] = entry;
  } else {
    /** @type {ServerConfig} */
    const entry = {};
    if (resolved.command) entry.command = resolved.command;
    if (resolved.args) entry.args = resolved.args;
    if (resolved.env) entry.env = resolved.env;
    claudeConfig.mcpServers[name] = entry;
  }
}

// 2. VS Code Copilot: .vscode/mcp.json
//    VS Code requires "type" field and uses top-level "url" for HTTP servers.
/** @type {{servers: Record<string, ServerConfig>}} */
const vscodeConfig = { servers: {} };
for (const name of Object.keys(servers)) {
  const override = getOverride(name, 'vscode');
  if (override) {
    vscodeConfig.servers[name] = override;
    continue;
  }
  const resolved = resolveServer(name, 'vscode');
  if (!resolved) continue;
  if (resolved.http) {
    // HTTP/SSE server: VS Code expects { type: "http", url: "..." }
    /** @type {ServerConfig} */
    const entry = { type: resolved.http.type || 'http', url: resolved.http.url };
    if (resolved.http.headers) entry.headers = resolved.http.headers;
    vscodeConfig.servers[name] = entry;
  } else if (resolved.url) {
    /** @type {ServerConfig} */
    const entry = { type: resolved.type || 'http', url: resolved.url };
    if (resolved.headers) entry.headers = resolved.headers;
    vscodeConfig.servers[name] = entry;
  } else {
    // stdio server: VS Code expects { type: "stdio", command, args, env }
    /** @type {ServerConfig} */
    const entry = { type: 'stdio' };
    if (resolved.command) entry.command = resolved.command;
    if (resolved.args) entry.args = resolved.args;
    if (resolved.env) entry.env = resolved.env;
    vscodeConfig.servers[name] = entry;
  }
}

// 3. Antigravity CLI: .agents/mcp_config.json
/** @type {{mcpServers: Record<string, ServerConfig>}} */
const antigravityConfig = { mcpServers: {} };
for (const name of Object.keys(servers)) {
  const override = getOverride(name, 'antigravity');
  if (override) {
    antigravityConfig.mcpServers[name] = override;
    continue;
  }
  const resolved = resolveServer(name, 'antigravity');
  if (!resolved) continue;
  if (resolved.serverUrl) {
    /** @type {ServerConfig} */
    const entry = { serverUrl: resolved.serverUrl };
    if (resolved.headers) entry.headers = resolved.headers;
    antigravityConfig.mcpServers[name] = entry;
  } else if (resolved.http && resolved.http.url) {
    /** @type {ServerConfig} */
    const entry = { serverUrl: resolved.http.url };
    if (resolved.http.headers) entry.headers = resolved.http.headers;
    antigravityConfig.mcpServers[name] = entry;
  } else {
    /** @type {ServerConfig} */
    const entry = {};
    if (resolved.command) entry.command = resolved.command;
    if (resolved.args) entry.args = resolved.args;
    if (resolved.env) entry.env = resolved.env;
    antigravityConfig.mcpServers[name] = entry;
  }
}

// 4. OpenAI Codex CLI: .codex/config.toml
let codexToml = '# Auto-generated from .ai/mcp-servers.yaml. Do not edit.\n\n';
for (const name of Object.keys(servers)) {
  const s = resolveServer(name, 'codex');
  if (!s) continue;
  const serverTable = `mcp_servers.${tomlKey(name)}`;
  codexToml += `[${serverTable}]\n`;
  if (s.command) codexToml += `command = ${tomlString(s.command)}\n`;
  if (s.args) codexToml += `args = ${JSON.stringify(s.args)}\n`;
  const url = (s.http && s.http.url) || s.url;
  if (url) codexToml += `url = ${tomlString(url)}\n`;
  if (s.env && Object.keys(s.env).length > 0) {
    codexToml += `\n[${serverTable}.env]\n`;
    for (const [key, value] of Object.entries(s.env)) {
      codexToml += `${tomlKey(key)} = ${tomlString(value)}\n`;
    }
  }
  const headers = (s.http && s.http.headers) || s.headers;
  if (headers && Object.keys(headers).length > 0) {
    codexToml += `\n[${serverTable}.http_headers]\n`;
    for (const [key, value] of Object.entries(headers)) {
      codexToml += `${tomlKey(key)} = ${tomlString(value)}\n`;
    }
  }
  codexToml += '\n';
}

const statePath = path.join(rootDir, '.ai', 'mcp-generation-state.json');
const codexBlockStart = '# BEGIN AI Framework Blueprint MCP servers';
const codexBlockEnd = '# END AI Framework Blueprint MCP servers';

/** @param {unknown} value @returns {unknown} */
function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

/** @param {unknown} left @param {unknown} right */
function jsonEqual(left, right) {
  return isDeepStrictEqual(left, right);
}

/** @param {string} targetPath */
function stateKey(targetPath) {
  return path.relative(rootDir, targetPath).split(path.sep).join('/');
}

/** @returns {Record<string, unknown>} */
function readState() {
  if (!fs.existsSync(statePath)) return {};
  try {
    const value = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (!isRecord(value) || value.version !== 1 || !isRecord(value.targets)) {
      throw new TypeError('must contain version 1 and a targets mapping');
    }
    return value;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid MCP generation state: ${message}`);
  }
}

/**
 * @param {string} targetPath
 * @param {string} containerKey
 * @param {Record<string, ServerConfig>} generatedServers
 * @param {Record<string, unknown>} state
 */
function prepareJsonTarget(targetPath, containerKey, generatedServers, state) {
  const relativePath = stateKey(targetPath);
  /** @type {Record<string, unknown>} */
  let existing = {};
  if (fs.existsSync(targetPath)) {
    try {
      const parsedConfig = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
      if (!isRecord(parsedConfig)) throw new TypeError('top level must be an object');
      existing = parsedConfig;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Cannot safely update ${relativePath}: invalid JSON (${message})`);
    }
  }

  const currentServers = existing[containerKey] === undefined ? {} : existing[containerKey];
  if (!isRecord(currentServers)) {
    throw new Error(`Cannot safely update ${relativePath}: ${containerKey} must be an object`);
  }
  const targetState = isRecord(state.targets) && isRecord(state.targets[relativePath])
    ? state.targets[relativePath]
    : {};
  const previousServers = targetState.servers === undefined ? {} : targetState.servers;
  if (!isRecord(previousServers)) {
    throw new Error(`Invalid MCP generation state for ${relativePath}: servers must be an object`);
  }

  for (const [name, previousServer] of Object.entries(previousServers)) {
    if (!(name in currentServers) || !jsonEqual(currentServers[name], previousServer)) {
      throw new Error(`Cannot safely update ${relativePath}: managed MCP server "${name}" was edited`);
    }
  }
  for (const [name, generatedServer] of Object.entries(generatedServers)) {
    if (name in currentServers && !(name in previousServers) && !jsonEqual(currentServers[name], generatedServer)) {
      throw new Error(`Cannot safely update ${relativePath}: would replace an existing MCP server "${name}"`);
    }
  }

  const mergedServers = { ...currentServers };
  for (const name of Object.keys(previousServers)) delete mergedServers[name];
  Object.assign(mergedServers, generatedServers);
  const content = JSON.stringify({ ...existing, [containerKey]: mergedServers }, null, 2) + '\n';
  return { path: targetPath, content, state: { servers: cloneJson(generatedServers) } };
}

/** @param {string} text */
function extractCodexBlock(text) {
  const start = text.indexOf(codexBlockStart);
  const end = text.indexOf(codexBlockEnd);
  if (start === -1 && end === -1) return null;
  if (start === -1 || end === -1 || end < start) {
    throw new Error('Cannot safely update .codex/config.toml: generated MCP block is malformed');
  }
  const endWithNewline = text.indexOf('\n', end);
  const blockEnd = endWithNewline === -1 ? text.length : endWithNewline + 1;
  return { block: text.slice(start, blockEnd), unmanaged: text.slice(0, start) + text.slice(blockEnd) };
}

/**
 * @param {Record<string, unknown>} state
 * @param {Record<string, ServerConfig>} generatedServers
 */
function prepareCodexTarget(state, generatedServers) {
  const targetPath = path.join(rootDir, '.codex', 'config.toml');
  const relativePath = stateKey(targetPath);
  const existing = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : '';
  parseToml(existing);
  const targetState = isRecord(state.targets) && isRecord(state.targets[relativePath])
    ? state.targets[relativePath]
    : {};
  const previousBlock = targetState.block;
  const extracted = extractCodexBlock(existing);
  let unmanaged = existing;
  if (extracted) {
    if (typeof previousBlock !== 'string' || extracted.block !== previousBlock) {
      throw new Error('Cannot safely update .codex/config.toml: managed MCP block was edited');
    }
    unmanaged = extracted.unmanaged;
  } else if (typeof previousBlock === 'string') {
    throw new Error('Cannot safely update .codex/config.toml: managed MCP block is missing');
  } else if (existing === codexToml) {
    unmanaged = '';
  }

  const unmanagedConfig = parseToml(unmanaged);
  const unmanagedServers = unmanagedConfig.mcp_servers;
  for (const name of Object.keys(generatedServers)) {
    if (isRecord(unmanagedServers) && Object.hasOwn(unmanagedServers, name)) {
      throw new Error(`Cannot safely update .codex/config.toml: would replace an existing MCP server "${name}"`);
    }
  }
  const block = `${codexBlockStart}\n${codexToml.slice(codexToml.indexOf('\n\n') + 2)}${codexBlockEnd}\n`;
  const separator = unmanaged.length > 0 && !unmanaged.endsWith('\n\n') ? '\n' : '';
  const content = `${unmanaged}${separator}${block}`;
  parseToml(content);
  return { path: targetPath, content, state: { block } };
}

/** @type {Record<string, unknown>} */
let state;
/** @type {{path: string, content: string, state: Record<string, unknown>}[]} */
let targets;
try {
  state = readState();
  targets = [
    prepareJsonTarget(path.join(rootDir, '.mcp.json'), 'mcpServers', claudeConfig.mcpServers, state),
    prepareJsonTarget(path.join(rootDir, '.vscode', 'mcp.json'), 'servers', vscodeConfig.servers, state),
    prepareJsonTarget(path.join(rootDir, '.agents', 'mcp_config.json'), 'mcpServers', antigravityConfig.mcpServers, state),
    prepareCodexTarget(state, /** @type {Record<string, ServerConfig>} */ (Object.fromEntries(Object.keys(servers).map((name) => [name, resolveServer(name, 'codex')]).filter(([, server]) => server)))),
  ];
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}

const nextState = {
  version: 1,
  targets: Object.fromEntries(targets.map((target) => [stateKey(target.path), target.state])),
};
const stateContent = JSON.stringify(nextState, null, 2) + '\n';
let hasDrift = false;

for (const target of [...targets, { path: statePath, content: stateContent }]) {
  if (isCheck) {
    if (!fs.existsSync(target.path)) {
      console.error(`[DRIFT] Missing config file: ${path.relative(rootDir, target.path)}`);
      hasDrift = true;
    } else if (fs.readFileSync(target.path, 'utf8') !== target.content) {
      console.error(`[DRIFT] Config out of sync: ${path.relative(rootDir, target.path)}`);
      hasDrift = true;
    }
  }
}

if (isCheck && hasDrift) {
  console.error('\nMCP drift detected. Run "pnpm mcp:gen" to update configurations.');
  process.exit(1);
}

if (!isCheck) {
  for (const target of [...targets, { path: statePath, content: stateContent }]) {
    fs.mkdirSync(path.dirname(target.path), { recursive: true });
    fs.writeFileSync(target.path, target.content, 'utf8');
    console.log(`Generated ${path.relative(rootDir, target.path)}`);
  }
}
