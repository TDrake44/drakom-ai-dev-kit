import {
  applyEdits,
  type FormattingOptions,
  modify,
  type Node,
  type ParseError,
  parseTree,
} from 'jsonc-parser';

function parseJsoncTree(text: string): Node | undefined {
  const errors: ParseError[] = [];
  const root = parseTree(text, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    throw new SyntaxError('Invalid JSONC syntax');
  }
  return root;
}

// Builds values with own properties, matching JSON.parse for keys such as "__proto__".
function nodeValue(node: Node): unknown {
  if (node.type === 'array') {
    return (node.children ?? []).map(nodeValue);
  }
  if (node.type !== 'object') {
    return node.value;
  }
  const result: Record<string, unknown> = {};
  for (const property of node.children ?? []) {
    const [keyNode, valueNode] = property.children ?? [];
    if (keyNode === undefined || valueNode === undefined) continue;
    Object.defineProperty(result, String(keyNode.value), {
      value: nodeValue(valueNode),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return result;
}

/** Parses JSON with comments and trailing commas, throwing on any syntax error. */
export function parseJsonc(text: string): unknown {
  const root = parseJsoncTree(text);
  return root === undefined ? undefined : nodeValue(root);
}

// Uses the indentation of the first top-level property, so comment lines never count.
function detectFormatting(text: string): FormattingOptions {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const firstProperty = parseJsoncTree(text)?.children?.[0];
  const lineStart = firstProperty === undefined ? 0 : text.lastIndexOf('\n', firstProperty.offset - 1) + 1;
  const indent = firstProperty === undefined ? '' : text.slice(lineStart, firstProperty.offset);
  if (!/^[ \t]+$/.test(indent)) {
    return { insertSpaces: true, tabSize: 2, eol };
  }
  if (indent.startsWith('\t')) {
    return { insertSpaces: false, tabSize: 1, eol };
  }
  return { insertSpaces: true, tabSize: indent.length, eol };
}

/**
 * Sets (or, with `undefined`, removes) the value at `path` as a minimal text
 * edit, so comments, key order, and formatting elsewhere in the file survive.
 */
export function setJsonValue(text: string, path: readonly string[], value: unknown): string {
  const edits = modify(text, [...path], value, { formattingOptions: detectFormatting(text) });
  return applyEdits(text, edits);
}
