import {
  applyEdits,
  type FormattingOptions,
  modify,
  type ParseError,
  parse,
} from 'jsonc-parser';

/** Parses JSON with comments and trailing commas, throwing on any syntax error. */
export function parseJsonc(text: string): unknown {
  const errors: ParseError[] = [];
  const value: unknown = parse(text, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    throw new SyntaxError('Invalid JSONC syntax');
  }
  return value;
}

function detectFormatting(text: string): FormattingOptions {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const indent = text.match(/^[ \t]+(?=\S)/m)?.[0];
  if (indent?.startsWith('\t')) {
    return { insertSpaces: false, tabSize: 1, eol };
  }
  return { insertSpaces: true, tabSize: indent?.length ?? 2, eol };
}

/**
 * Sets (or, with `undefined`, removes) the value at `path` as a minimal text
 * edit, so comments, key order, and formatting elsewhere in the file survive.
 */
export function setJsonValue(text: string, path: readonly string[], value: unknown): string {
  const edits = modify(text, [...path], value, { formattingOptions: detectFormatting(text) });
  return applyEdits(text, edits);
}
