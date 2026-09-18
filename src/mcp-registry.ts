import type { BaseServerConfig, ClientOverrideConfig, HttpConfig, McpClient, McpRegistry, StringMap } from './mcp-types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const SERVER_KEYS = new Set(['command', 'args', 'env', 'http', 'overrides']);
const OVERRIDE_KEYS = new Set([
  'command',
  'args',
  'env',
  'http',
  'type',
  'url',
  'headers',
  'serverUrl',
  'transport',
  'timeout',
]);
const HTTP_KEYS = new Set(['url', 'type', 'headers']);
const CLIENTS = new Set<string>(['claude', 'vscode', 'antigravity', 'codex']);

export type McpValidationResult =
  | { valid: true; registry: McpRegistry }
  | { valid: false; error: string };

function validationError(error: string): McpValidationResult {
  return { valid: false, error };
}

function unsupportedKey(value: Record<string, unknown>, allowed: Set<string>): string | undefined {
  return Object.keys(value).find((key) => !allowed.has(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isMcpClient(value: string): value is McpClient {
  return CLIENTS.has(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isStringMap(value: unknown): value is StringMap {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');
}

function copyStringMap(value: StringMap): StringMap {
  return { ...value };
}

function validateHttp(value: unknown, label: string): string | undefined {
  if (!isRecord(value)) return `${label} must be an object`;
  const key = unsupportedKey(value, HTTP_KEYS);
  if (key) return `${label} contains unsupported field "${key}"`;
  if (!isNonEmptyString(value.url)) return `${label}.url must be a non-empty string`;
  if (value.type !== undefined && typeof value.type !== 'string') return `${label}.type must be a string`;
  if (value.headers !== undefined && !isStringMap(value.headers)) {
    return `${label}.headers must be a mapping of string to string`;
  }
  return undefined;
}

function toHttpConfig(value: Record<string, unknown>, url: string): HttpConfig {
  const http: HttpConfig = { url };
  if (typeof value.type === 'string') http.type = value.type;
  if (isStringMap(value.headers)) http.headers = copyStringMap(value.headers);
  return http;
}

function validateOverride(
  serverName: string,
  client: McpClient,
  value: unknown,
  baseIsStdio: boolean,
): string | undefined {
  const label = `MCP server "${serverName}" override for "${client}"`;
  if (!isRecord(value)) return `${label} must be an object`;
  if (Object.keys(value).length === 0) return `${label} cannot be empty`;
  const key = unsupportedKey(value, OVERRIDE_KEYS);
  if (key) return `${label} contains unsupported field "${key}"`;
  if (value.command !== undefined && !isNonEmptyString(value.command)) return `${label} command must be a non-empty string`;
  if (value.args !== undefined && !isStringArray(value.args)) return `${label} args must be an array of strings`;
  if (value.env !== undefined && !isStringMap(value.env)) return `${label} env must be a mapping of string to string`;
  if (value.http !== undefined) {
    const error = validateHttp(value.http, `${label} http`);
    if (error) return error;
  }
  for (const field of ['url', 'serverUrl', 'type', 'transport'] as const) {
    if (value[field] !== undefined && !isNonEmptyString(value[field])) return `${label} ${field} must be a non-empty string`;
  }
  if (value.timeout !== undefined && (typeof value.timeout !== 'number' || !Number.isFinite(value.timeout) || value.timeout < 0)) {
    return `${label} timeout must be a non-negative number`;
  }
  if (value.headers !== undefined && !isStringMap(value.headers)) return `${label} headers must be a mapping of string to string`;

  const hasCommand = typeof value.command === 'string';
  const hasHttp = value.http !== undefined || typeof value.url === 'string' || typeof value.serverUrl === 'string';
  if (hasCommand && hasHttp) return `${label} specifies both command and http/url; must specify at most one`;
  if (baseIsStdio && !hasHttp) {
    const fields = ['headers', 'type', 'transport', 'timeout'].filter((field) => field in value);
    if (fields.length > 0) return `${label} specifies HTTP fields (${fields.join(', ')}) without an HTTP URL or transport`;
  }
  if (!baseIsStdio && !hasCommand) {
    const fields = ['args', 'env'].filter((field) => field in value);
    if (fields.length > 0) return `${label} specifies stdio fields (${fields.join(', ')}) without a command`;
  }
  return undefined;
}

function toOverrideConfig(value: Record<string, unknown>): ClientOverrideConfig {
  const override: ClientOverrideConfig = {};
  if (typeof value.command === 'string') override.command = value.command;
  if (isStringArray(value.args)) override.args = [...value.args];
  if (isStringMap(value.env)) override.env = copyStringMap(value.env);
  if (isRecord(value.http) && isNonEmptyString(value.http.url)) {
    override.http = toHttpConfig(value.http, value.http.url);
  }
  if (typeof value.url === 'string') override.url = value.url;
  if (typeof value.serverUrl === 'string') override.serverUrl = value.serverUrl;
  if (typeof value.type === 'string') override.type = value.type;
  if (typeof value.transport === 'string') override.transport = value.transport;
  if (typeof value.timeout === 'number') override.timeout = value.timeout;
  if (isStringMap(value.headers)) override.headers = copyStringMap(value.headers);
  return override;
}

function validateServer(serverName: string, value: unknown): BaseServerConfig | string {
  if (!isRecord(value)) return `MCP server "${serverName}" definition must be an object`;
  const key = unsupportedKey(value, SERVER_KEYS);
  if (key) return `MCP server "${serverName}" contains unsupported field "${key}"`;

  const hasCommand = isNonEmptyString(value.command);
  const hasHttp = isRecord(value.http);
  if (hasCommand && hasHttp) {
    return `MCP server "${serverName}" specifies both command and http; must specify exactly one of command or http`;
  }
  if (!hasCommand && !hasHttp) return `MCP server "${serverName}" must specify command or http`;
  if (value.command !== undefined && !isNonEmptyString(value.command)) return `MCP server "${serverName}" command must be a non-empty string`;
  if (value.args !== undefined && !isStringArray(value.args)) return `MCP server "${serverName}" args must be an array of strings`;
  if (value.env !== undefined && !isStringMap(value.env)) return `MCP server "${serverName}" env must be a mapping of string to string`;
  if (value.http !== undefined) {
    const error = validateHttp(value.http, `MCP server "${serverName}" http`);
    if (error) return error;
  }

  const typed: BaseServerConfig = {};
  if (typeof value.command === 'string') typed.command = value.command;
  if (isStringArray(value.args)) typed.args = [...value.args];
  if (isStringMap(value.env)) typed.env = copyStringMap(value.env);
  if (isRecord(value.http) && isNonEmptyString(value.http.url)) {
    typed.http = toHttpConfig(value.http, value.http.url);
  }
  if (value.overrides !== undefined) {
    if (!isRecord(value.overrides)) return `MCP server "${serverName}" overrides must be an object`;
    const overrides: Record<string, ClientOverrideConfig> = {};
    for (const [clientName, override] of Object.entries(value.overrides)) {
      if (!isMcpClient(clientName)) return `MCP server "${serverName}" contains unsupported override "${clientName}"`;
      const client = clientName;
      const error = validateOverride(serverName, client, override, hasCommand);
      if (error) return error;
      if (isRecord(override)) overrides[client] = toOverrideConfig(override);
    }
    typed.overrides = overrides;
  }
  return typed;
}

export function validateMcpRegistry(raw: unknown): McpValidationResult {
  if (raw === null || raw === undefined) return { valid: true, registry: { servers: {} } };
  if (!isRecord(raw)) return validationError('MCP registry must be a YAML mapping or empty');
  const rootKey = unsupportedKey(raw, new Set(['servers']));
  if (rootKey) return validationError(`unsupported field "${rootKey}" at registry root`);
  if (raw.servers === null || raw.servers === undefined) return { valid: true, registry: { servers: {} } };
  if (!isRecord(raw.servers)) return validationError('servers must be a mapping of server names to definitions');

  const servers: Record<string, BaseServerConfig> = {};
  for (const [name, definition] of Object.entries(raw.servers)) {
    if (name.trim().length === 0) return validationError('server name must be a non-empty string');
    const server = validateServer(name, definition);
    if (typeof server === 'string') return validationError(server);
    servers[name] = server;
  }
  return { valid: true, registry: { servers } };
}
