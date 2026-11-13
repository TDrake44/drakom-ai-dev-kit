import { createHash } from 'node:crypto';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Text with every CRLF line ending turned into LF. */
export function toLf(content: string): string {
  return content.replaceAll('\r\n', '\n');
}

/** The line ending a file uses: CRLF when it has any, otherwise LF. */
export function lineEnding(content: string): '\r\n' | '\n' {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

/** Text with every line ending set to `eol`. */
export function withLineEnding(content: string, eol: '\r\n' | '\n'): string {
  const lf = toLf(content);
  return eol === '\n' ? lf : lf.replaceAll('\n', '\r\n');
}

/** Whether two texts differ at most in CRLF versus LF line endings. */
export function sameText(left: string, right: string): boolean {
  return left === right || toLf(left) === toLf(right);
}

/**
 * Fingerprint of a text with CRLF line endings read as LF, so a checkout that converts line endings
 * does not change it. For text without CRLF, this is the SHA-256 of the bytes, as it always was.
 */
export function fingerprint(content: string): string {
  return `sha256:${createHash('sha256').update(toLf(content)).digest('hex')}`;
}

/**
 * Whether a recorded fingerprint matches the text. Earlier versions hashed the bytes as they were,
 * so a fingerprint they recorded over CRLF text still matches that exact text.
 */
export function matchesFingerprint(content: string, recorded: string | undefined): boolean {
  if (recorded === undefined) return false;
  return recorded === fingerprint(content) || recorded === `sha256:${createHash('sha256').update(content).digest('hex')}`;
}
