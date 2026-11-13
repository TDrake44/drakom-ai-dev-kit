import {
  MCP_CLIENTS,
  type BaseServerConfig,
  type ClientOverrideConfig,
  type HttpConfig,
  type McpClient,
  type McpRegistry,
  type OverrideHttpConfig,
  type RemovableStringMap,
  type StringMap,
} from './mcp-types.js';
import { isRecord } from './util.js';
import { findUnsupportedVarRefInValue } from './mcp-variables.js';

const ROOT_KEYS = new Set(['clients', 'servers']);
const SERVER_KEYS = new Set(['command', 'args', 'env', 'http', 'overrides', 'skip', 'notSecret']);
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
  'timeoutSeconds',
]);
const HTTP_KEYS = new Set(['url', 'type', 'headers']);
const CLIENTS = new Set<string>(MCP_CLIENTS);
// The field paths the credential check prints for the values it judges by name.
const NOT_SECRET_PATH_REGEX = new RegExp(`^(?:overrides\\.(${MCP_CLIENTS.join('|')})\\.)?(env|headers)\\.(.+)$`);

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

/** A map as an override may give it: `null`, for the whole map or for one value, removes it. */
function isRemovableStringMap(value: unknown): value is RemovableStringMap | null {
  return (
    value === null ||
    (isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string' || entry === null))
  );
}

function copyStringMap(value: StringMap): StringMap {
  return { ...value };
}

function copyRemovableStringMap(value: RemovableStringMap | null): RemovableStringMap | null {
  return value === null ? null : { ...value };
}

function validateHttp(value: unknown, label: string, inOverride = false): string | undefined {
  if (!isRecord(value)) return `${label} must be an object`;
  const key = unsupportedKey(value, HTTP_KEYS);
  if (key) return `${label} contains unsupported field "${key}"`;
  if (!isNonEmptyString(value.url)) return `${label}.url must be a non-empty string`;
  if (value.type !== undefined && typeof value.type !== 'string') return `${label}.type must be a string`;
  if (inOverride) {
    if (value.headers !== undefined && !isRemovableStringMap(value.headers)) {
      return `${label}.headers must be a mapping of string to string or null`;
    }
  } else if (value.headers !== undefined && !isStringMap(value.headers)) {
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

function toOverrideHttpConfig(value: Record<string, unknown>, url: string): OverrideHttpConfig {
  const http: OverrideHttpConfig = { url };
  if (typeof value.type === 'string') http.type = value.type;
  if (value.headers !== undefined && isRemovableStringMap(value.headers)) {
    http.headers = copyRemovableStringMap(value.headers);
  }
  return http;
}

/** Reads a list of client names. A string result is the problem, worded to follow the field name. */
function readClientList(value: unknown): McpClient[] | string {
  if (!isStringArray(value)) return 'must be a list of client names';
  const clients: McpClient[] = [];
  for (const entry of value) {
    if (!isMcpClient(entry)) return `contains unknown client "${entry}"; the clients are ${MCP_CLIENTS.join(', ')}`;
    if (clients.includes(entry)) return `lists "${entry}" more than once`;
    clients.push(entry);
  }
  return clients;
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
  if (value.env !== undefined && !isRemovableStringMap(value.env)) return `${label} env must be a mapping of string to string or null`;
  if (value.http !== undefined) {
    const error = validateHttp(value.http, `${label} http`, true);
    if (error) return error;
  }
  for (const field of ['url', 'serverUrl', 'type', 'transport'] as const) {
    if (value[field] !== undefined && !isNonEmptyString(value[field])) return `${label} ${field} must be a non-empty string`;
  }
  if (value.timeout !== undefined && (typeof value.timeout !== 'number' || !Number.isFinite(value.timeout) || value.timeout < 0)) {
    return `${label} timeout must be a non-negative number`;
  }
  if (value.timeoutSeconds !== undefined) {
    if (client !== 'antigravity') return `${label} timeoutSeconds is only supported in overrides.antigravity`;
    if (typeof value.timeoutSeconds !== 'number' || !Number.isFinite(value.timeoutSeconds)) {
      return `${label} timeoutSeconds must be a finite number of seconds`;
    }
  }
  if (value.headers !== undefined && !isRemovableStringMap(value.headers)) return `${label} headers must be a mapping of string to string or null`;

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
  if (value.env !== undefined && isRemovableStringMap(value.env)) override.env = copyRemovableStringMap(value.env);
  if (isRecord(value.http) && isNonEmptyString(value.http.url)) {
    override.http = toOverrideHttpConfig(value.http, value.http.url);
  }
  if (typeof value.url === 'string') override.url = value.url;
  if (typeof value.serverUrl === 'string') override.serverUrl = value.serverUrl;
  if (typeof value.type === 'string') override.type = value.type;
  if (typeof value.transport === 'string') override.transport = value.transport;
  if (typeof value.timeout === 'number') override.timeout = value.timeout;
  if (typeof value.timeoutSeconds === 'number') override.timeoutSeconds = value.timeoutSeconds;
  if (value.headers !== undefined && isRemovableStringMap(value.headers)) {
    override.headers = copyRemovableStringMap(value.headers);
  }
  return override;
}

function setsString(map: RemovableStringMap | null | undefined, key: string): boolean {
  return map !== null && map !== undefined && Object.hasOwn(map, key) && typeof map[key] === 'string';
}

/** True when a path already matched by NOT_SECRET_PATH_REGEX names a value the server sets. */
function notSecretPathMatchesField(server: BaseServerConfig, match: RegExpMatchArray): boolean {
  const [, client, kind, name] = match;
  if (name === undefined) return false;
  if (client === undefined) {
    return kind === 'env' ? setsString(server.env, name) : setsString(server.http?.headers, name);
  }
  const override = server.overrides !== undefined && Object.hasOwn(server.overrides, client) ? server.overrides[client] : undefined;
  if (override === undefined) return false;
  if (kind === 'env') return setsString(override.env, name);
  return setsString(override.headers, name) || setsString(override.http?.headers, name);
}

function validateNotSecret(serverName: string, value: unknown, server: BaseServerConfig): string[] | string {
  const label = `MCP server "${serverName}" notSecret`;
  if (!isStringArray(value)) return `${label} must be a list of field paths such as env.NAME`;
  for (const entry of value) {
    const match = entry.match(NOT_SECRET_PATH_REGEX);
    if (!match) {
      return `${label} entry "${entry}" is not supported; use env.NAME or headers.NAME, or overrides.<client>.env.NAME or overrides.<client>.headers.NAME for a value set in an override`;
    }
    if (!notSecretPathMatchesField(server, match)) {
      return `${label} lists "${entry}", which matches no field of this server; write the path exactly as the credential conflict prints it`;
    }
  }
  return [...value];
}

/** The path of the first mapping, anywhere in a server definition, that has a "__proto__" key. */
function findReservedKey(value: unknown, field: string): string | undefined {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = findReservedKey(item, `${field}[${index}]`);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  if (Object.hasOwn(value, '__proto__')) return field;
  for (const [key, item] of Object.entries(value)) {
    const found = findReservedKey(item, field ? `${field}.${key}` : key);
    if (found !== undefined) return found;
  }
  return undefined;
}

function validateServer(
  serverName: string,
  value: unknown,
  selectedClients: readonly McpClient[],
): BaseServerConfig | string {
  if (!isRecord(value)) return `MCP server "${serverName}" definition must be an object`;
  // Merging and translating maps assign by key, which would drop such an entry without a trace.
  const reservedIn = findReservedKey(value, '');
  if (reservedIn !== undefined) {
    return `MCP server "${serverName}" uses "__proto__" as a name${reservedIn ? ` in ${reservedIn}` : ''}; that name is reserved, so rename it`;
  }
  const key = unsupportedKey(value, SERVER_KEYS);
  if (key) return `MCP server "${serverName}" contains unsupported field "${key}"`;
  const unsupportedRef = findUnsupportedVarRefInValue(value, '');
  if (unsupportedRef) {
    return `MCP server "${serverName}" ${unsupportedRef.field} uses unsupported variable reference ${unsupportedRef.token}; use \${NAME}, \${env:NAME}, or $NAME where NAME starts with a letter or underscore and contains only letters, digits, and underscores`;
  }

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
  if (value.skip !== undefined) {
    const skip = readClientList(value.skip);
    if (typeof skip === 'string') return `MCP server "${serverName}" skip ${skip}`;
    if (selectedClients.every((client) => skip.includes(client))) {
      return `MCP server "${serverName}" skips every selected client (${selectedClients.join(', ')}), so no client would get it; remove the server or shorten its skip list`;
    }
    typed.skip = skip;
  }
  if (value.notSecret !== undefined) {
    const notSecret = validateNotSecret(serverName, value.notSecret, typed);
    if (typeof notSecret === 'string') return notSecret;
    typed.notSecret = notSecret;
  }
  return typed;
}

export function validateMcpRegistry(raw: unknown): McpValidationResult {
  if (raw === null || raw === undefined) return { valid: true, registry: { servers: {} } };
  if (!isRecord(raw)) return validationError('MCP registry must be a YAML mapping or empty');
  const rootKey = unsupportedKey(raw, ROOT_KEYS);
  if (rootKey) return validationError(`unsupported field "${rootKey}" at registry root`);

  const registry: McpRegistry = { servers: {} };
  if (raw.clients !== undefined) {
    if (!isStringArray(raw.clients) || raw.clients.length === 0) {
      return validationError(`clients must be a non-empty list of client names (${MCP_CLIENTS.join(', ')})`);
    }
    const clients = readClientList(raw.clients);
    if (typeof clients === 'string') return validationError(`clients ${clients}`);
    registry.clients = clients;
  }
  if (raw.servers === null || raw.servers === undefined) return { valid: true, registry };
  if (!isRecord(raw.servers)) return validationError('servers must be a mapping of server names to definitions');

  for (const [name, definition] of Object.entries(raw.servers)) {
    if (name.trim().length === 0) return validationError('server name must be a non-empty string');
    // Plain assignment would set the prototype instead of adding the server, silently dropping it.
    if (name === '__proto__') return validationError('server name "__proto__" is reserved; rename the server');
    const server = validateServer(name, definition, registry.clients ?? MCP_CLIENTS);
    if (typeof server === 'string') return validationError(server);
    registry.servers[name] = server;
  }
  return { valid: true, registry };
}
