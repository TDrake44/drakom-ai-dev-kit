import {
  applyEdits,
  createScanner,
  type Edit,
  findNodeAtLocation,
  type FormattingOptions,
  modify,
  type Node,
  type ParseError,
  parseTree,
  SyntaxKind,
} from 'jsonc-parser';

const BYTE_ORDER_MARK = '\uFEFF';

function splitByteOrderMark(text: string): { bom: string; body: string } {
  return text.startsWith(BYTE_ORDER_MARK)
    ? { bom: BYTE_ORDER_MARK, body: text.slice(BYTE_ORDER_MARK.length) }
    : { bom: '', body: text };
}

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

/** Parses JSON with comments, trailing commas, and a leading byte-order mark, throwing on any syntax error. */
export function parseJsonc(text: string): unknown {
  const root = parseJsoncTree(splitByteOrderMark(text).body);
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

// Offset of the next comma or closing token after `offset`, skipping whitespace and comments.
function nextToken(text: string, offset: number): { kind: SyntaxKind; offset: number } {
  const scanner = createScanner(text, true);
  scanner.setPosition(offset);
  const kind = scanner.scan();
  return { kind, offset: scanner.getTokenOffset() };
}

function lineStartOf(text: string, offset: number): number {
  return text.lastIndexOf('\n', offset - 1) + 1;
}

// Deletes a comma. When it begins its line, also deletes the spaces after it, or the whole line if nothing else is on it.
function commaDeletion(text: string, offset: number): Edit {
  const lineStart = lineStartOf(text, offset);
  if (!/^[ \t]*$/.test(text.slice(lineStart, offset))) {
    return { offset, length: 1, content: '' };
  }
  const rest = /^[ \t]*(\r?\n|$)?/.exec(text.slice(offset + 1));
  const restLength = rest?.[0].length ?? 0;
  return rest?.[1] === undefined
    ? { offset, length: 1 + restLength, content: '' }
    : { offset: lineStart, length: offset + 1 + restLength - lineStart, content: '' };
}

/**
 * Deletes only the property and one separating comma. jsonc-parser's `modify`
 * also deletes any comments between the property and its next sibling.
 */
function removeProperty(text: string, path: readonly string[]): string {
  const root = parseJsoncTree(text);
  const property = root === undefined ? undefined : findNodeAtLocation(root, [...path])?.parent;
  const siblings = property?.parent?.children;
  if (property === undefined || siblings === undefined) return text;

  const propertyEnd = property.offset + property.length;
  const following = nextToken(text, propertyEnd);
  let start = property.offset;
  let end = propertyEnd;
  let separateComma: number | undefined;
  if (following.kind === SyntaxKind.CommaToken) {
    if (/^\s*$/.test(text.slice(propertyEnd, following.offset))) {
      end = following.offset + 1;
    } else {
      // Keep comments between the value and comma outside the property deletion.
      separateComma = following.offset;
    }
  } else {
    const previous = siblings[siblings.indexOf(property) - 1];
    if (previous !== undefined) {
      separateComma = nextToken(text, previous.offset + previous.length).offset;
    }
  }

  // A leading comma on the property's own line is removed together with the property.
  if (
    separateComma !== undefined &&
    separateComma < start &&
    /^[ \t]*$/.test(text.slice(lineStartOf(text, separateComma), separateComma)) &&
    /^[ \t]*$/.test(text.slice(separateComma + 1, start))
  ) {
    start = separateComma;
    separateComma = undefined;
  }

  // Remove whole lines when the property occupies them; otherwise keep trailing comments in place.
  const lineStart = lineStartOf(text, start);
  const restOfLine = /^[ \t]*(?:\r?\n|$)/.exec(text.slice(end));
  if (/^[ \t]*$/.test(text.slice(lineStart, start)) && restOfLine !== null) {
    start = lineStart;
    end += restOfLine[0].length;
  } else {
    end += /^[ \t]*/.exec(text.slice(end))?.[0].length ?? 0;
  }

  const edits: Edit[] = [{ offset: start, length: end - start, content: '' }];
  if (separateComma !== undefined) {
    edits.push(commaDeletion(text, separateComma));
  }
  return applyEdits(text, edits);
}

/**
 * Sets (or, with `undefined`, removes) the value at `path` as a minimal text
 * edit, so comments, key order, formatting, and any byte-order mark survive.
 */
export function setJsonValue(text: string, path: readonly string[], value: unknown): string {
  const { bom, body } = splitByteOrderMark(text);
  if (value === undefined) {
    return bom + removeProperty(body, path);
  }
  const edits = modify(body, [...path], value, { formattingOptions: detectFormatting(body) });
  return bom + applyEdits(body, edits);
}
