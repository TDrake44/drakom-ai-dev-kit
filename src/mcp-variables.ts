import { isRecord } from './util.js';

// Single grammar for MCP variable references, shared by registry validation,
// credential detection, and client renderers so they cannot disagree.
// Names follow POSIX environment variable rules; `${input:id}` is VS Code's prompt syntax.
const NAME = '[A-Za-z_][A-Za-z0-9_]*';

export const VAR_REF_REGEX = new RegExp(`^\\$(?:\\{(?:env:)?(${NAME})\\}|(${NAME}))$`);
export const VAR_REFS_REGEX = new RegExp(`\\$(?:\\{(?:env:)?(${NAME})\\}|(${NAME}))`, 'g');
export const INPUT_REF_REGEX = /\$\{input:[^}]+\}/;

const INPUT_REF_EXACT_REGEX = /^\$\{input:[^}]+\}$/;
// Anything that looks like a reference: a braced token (closed or not) or a bare name,
// including trailing hyphens so `$API-KEY` is judged as a whole rather than as `$API` + `-KEY`.
const REF_CANDIDATES_REGEX = /\$\{[^}]*\}?|\$[A-Za-z_][A-Za-z0-9_-]*/g;

/** True when the entire value is one supported variable reference. */
export function isVariableReference(value: string): boolean {
  return VAR_REF_REGEX.test(value) || INPUT_REF_EXACT_REGEX.test(value);
}

/** Returns the first reference-like token in `value` that the renderers cannot translate. */
export function findUnsupportedVarRef(value: string): string | undefined {
  for (const [candidate] of value.matchAll(REF_CANDIDATES_REGEX)) {
    if (!isVariableReference(candidate)) return candidate;
  }
  return undefined;
}

/** Walks every string in a registry server definition and reports the first unsupported reference. */
export function findUnsupportedVarRefInValue(value: unknown, field: string): { field: string; token: string } | undefined {
  if (typeof value === 'string') {
    const token = findUnsupportedVarRef(value);
    return token === undefined ? undefined : { field, token };
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = findUnsupportedVarRefInValue(item, `${field}[${index}]`);
      if (found) return found;
    }
    return undefined;
  }
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      const found = findUnsupportedVarRefInValue(item, field ? `${field}.${key}` : key);
      if (found) return found;
    }
  }
  return undefined;
}
