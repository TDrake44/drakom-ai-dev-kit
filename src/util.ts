import { createHash } from 'node:crypto';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Text with every CRLF line ending turned into LF. */
export function toLf(content: string): string {
  return content.replaceAll('\r\n', '\n');
}

function countLineEndings(content: string): { crlf: number; lf: number } {
  const crlf = content.split('\r\n').length - 1;
  return { crlf, lf: content.split('\n').length - 1 - crlf };
}

/** The line ending most lines of a file use; LF on a tie or with no line ending at all. */
export function lineEnding(content: string): '\r\n' | '\n' {
  const { crlf, lf } = countLineEndings(content);
  return crlf > lf ? '\r\n' : '\n';
}

/** Whether a text uses both CRLF and LF line endings. */
export function hasMixedLineEndings(content: string): boolean {
  const { crlf, lf } = countLineEndings(content);
  return crlf > 0 && lf > 0;
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
 * How a recorded fingerprint matches the text: `current` for the fingerprint this version records,
 * `legacy` for a hash of the exact bytes that earlier versions recorded over CRLF text, or undefined.
 * A `legacy` match only holds while the file keeps those exact bytes, so callers record the current
 * fingerprint in its place.
 */
export function fingerprintMatch(content: string, recorded: string | undefined): 'current' | 'legacy' | undefined {
  if (recorded === undefined) return undefined;
  if (recorded === fingerprint(content)) return 'current';
  return recorded === `sha256:${createHash('sha256').update(content).digest('hex')}` ? 'legacy' : undefined;
}

/** Whether a recorded fingerprint matches the text, in either form `fingerprintMatch` accepts. */
export function matchesFingerprint(content: string, recorded: string | undefined): boolean {
  return fingerprintMatch(content, recorded) !== undefined;
}
