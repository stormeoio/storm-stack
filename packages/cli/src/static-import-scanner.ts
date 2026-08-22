interface StaticImportRange {
  start: number;
  end: number;
}

export interface StaticNamedImportBinding {
  source: string;
  importedName: string;
  localName: string;
  typeOnly: boolean;
}

/** Returns the insertion offset immediately after the last static import. */
export function findLastStaticImportEnd(content: string): number {
  return findStaticImportRanges(content).reduce(
    (lastImportEnd, range) => Math.max(lastImportEnd, range.end),
    -1,
  );
}

/** Parses active named bindings from static imports, preserving aliases and type-only status. */
export function findStaticNamedImportBindings(content: string): StaticNamedImportBinding[] {
  const bindings: StaticNamedImportBinding[] = [];

  for (const range of findStaticImportRanges(content)) {
    const declaration = maskCommentsPreservingLayout(content.slice(range.start, range.end));
    const importMatch = /^\s*import\s+(type\s+)?([\s\S]*?)\s+from\s*(["'])([^"']+)\3/.exec(
      declaration,
    );
    if (!importMatch) continue;

    const namedImports = /\{([\s\S]*?)\}/.exec(importMatch[2]!);
    if (!namedImports) continue;
    const declarationIsTypeOnly = importMatch[1] !== undefined;

    for (const rawBinding of namedImports[1]!.split(",")) {
      let binding = rawBinding.trim();
      if (!binding) continue;
      let typeOnly = declarationIsTypeOnly;
      if (/^type\b/.test(binding)) {
        typeOnly = true;
        binding = binding.replace(/^type\s+/, "");
      }

      const bindingMatch = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(binding);
      if (!bindingMatch) continue;
      bindings.push({
        source: importMatch[4]!,
        importedName: bindingMatch[1]!,
        localName: bindingMatch[2] ?? bindingMatch[1]!,
        typeOnly,
      });
    }
  }

  return bindings;
}

/** A generated runtime binding is safe to reuse only when it is the sole local binding. */
export function hasUniqueRuntimeNamedImport(
  content: string,
  source: string,
  importedName: string,
  localName = importedName,
): boolean {
  const localBindings = findStaticNamedImportBindings(content)
    .filter((binding) => binding.localName === localName);
  return localBindings.length === 1
    && localBindings[0]!.source === source
    && localBindings[0]!.importedName === importedName
    && !localBindings[0]!.typeOnly;
}

export function findNamedImportBinding(
  content: string,
  localName: string,
): StaticNamedImportBinding | null {
  return findStaticNamedImportBindings(content)
    .find((binding) => binding.localName === localName) ?? null;
}

/** Replaces comments with spaces while keeping source offsets and string contents intact. */
export function maskCommentsPreservingLayout(content: string): string {
  const masked = content.split("");

  for (let index = 0; index < content.length; index++) {
    const character = content[index]!;
    const next = content[index + 1];

    if (character === "\"" || character === "'" || character === "`") {
      const closing = skipQuotedValue(content, index, character);
      if (closing === -1) break;
      index = closing;
      continue;
    }
    if (character === "/" && next === "/") {
      const newline = content.indexOf("\n", index + 2);
      const commentEnd = newline === -1 ? content.length : newline;
      for (let cursor = index; cursor < commentEnd; cursor++) {
        if (masked[cursor] !== "\r") masked[cursor] = " ";
      }
      index = commentEnd - 1;
      continue;
    }
    if (character === "/" && next === "*") {
      const closing = content.indexOf("*/", index + 2);
      const commentEnd = closing === -1 ? content.length : closing + 2;
      for (let cursor = index; cursor < commentEnd; cursor++) {
        if (masked[cursor] !== "\n" && masked[cursor] !== "\r") masked[cursor] = " ";
      }
      index = commentEnd - 1;
    }
  }

  return masked.join("");
}

export function isActiveCodePosition(source: string, targetIndex: number): boolean {
  return isCodePosition(source, targetIndex);
}

function findStaticImportRanges(content: string): StaticImportRange[] {
  const ranges: StaticImportRange[] = [];
  const importPattern = /^[ \t]*import\b/gm;
  let match: RegExpExecArray | null;

  while ((match = importPattern.exec(content)) !== null) {
    if (!isCodePosition(content, match.index)) continue;
    let afterKeyword = match.index + match[0].length;
    while (content[afterKeyword] === " " || content[afterKeyword] === "\t") afterKeyword++;

    // `import()` and `import.meta` are expressions, not declarations.
    if (content[afterKeyword] === "(" || content[afterKeyword] === ".") continue;

    const declarationEnd = findImportDeclarationEnd(content, match.index);
    if (declarationEnd !== -1) {
      ranges.push({ start: match.index, end: declarationEnd });
      importPattern.lastIndex = Math.max(importPattern.lastIndex, declarationEnd);
    }
  }

  return ranges;
}

// Scan static imports across lines; unrecognised declarations are ignored so
// the caller safely prepends the new import instead of splitting old syntax.
function findImportDeclarationEnd(content: string, start: number): number {
  let parentheses = 0;
  let braces = 0;
  let brackets = 0;
  let sawModuleSpecifier = false;

  for (let index = start; index < content.length; index++) {
    const character = content[index]!;
    const next = content[index + 1];

    if (character === "\"" || character === "'") {
      const closing = skipQuotedValue(content, index, character);
      if (closing === -1) return -1;
      if (parentheses === 0 && braces === 0 && brackets === 0) sawModuleSpecifier = true;
      index = closing;
      continue;
    }
    if (character === "`") {
      const closing = skipQuotedValue(content, index, character);
      if (closing === -1) return -1;
      index = closing;
      continue;
    }
    if (character === "/" && next === "/") {
      const newline = content.indexOf("\n", index + 2);
      if (newline === -1) {
        return sawModuleSpecifier && parentheses === 0 && braces === 0 && brackets === 0
          ? content.length
          : -1;
      }
      if (sawModuleSpecifier && parentheses === 0 && braces === 0 && brackets === 0) return newline + 1;
      index = newline - 1;
      continue;
    }
    if (character === "/" && next === "*") {
      const closing = content.indexOf("*/", index + 2);
      if (closing === -1) return -1;
      index = closing + 1;
      continue;
    }

    if (character === "(") parentheses++;
    else if (character === ")") parentheses--;
    else if (character === "{") braces++;
    else if (character === "}") braces--;
    else if (character === "[") brackets++;
    else if (character === "]") brackets--;

    if (parentheses < 0 || braces < 0 || brackets < 0) return -1;
    const atTopLevel = parentheses === 0 && braces === 0 && brackets === 0;

    if (character === ";" && atTopLevel && sawModuleSpecifier) {
      return consumeImportLineEnding(content, index + 1);
    }

    if ((character === "\n" || character === "\r") && atTopLevel && sawModuleSpecifier) {
      const nextToken = nextSignificantToken(content, index + 1);
      if (nextToken === ";" || nextToken === "with" || nextToken === "assert") continue;
      return character === "\r" && next === "\n" ? index + 2 : index + 1;
    }
  }

  return sawModuleSpecifier && parentheses === 0 && braces === 0 && brackets === 0
    ? content.length
    : -1;
}

function consumeImportLineEnding(content: string, start: number): number {
  let cursor = start;
  while (content[cursor] === " " || content[cursor] === "\t") cursor++;

  if (content[cursor] === "/" && content[cursor + 1] === "/") {
    const newline = content.indexOf("\n", cursor + 2);
    return newline === -1 ? content.length : newline + 1;
  }

  while (content[cursor] === "/" && content[cursor + 1] === "*") {
    const closing = content.indexOf("*/", cursor + 2);
    if (closing === -1) return start;
    cursor = closing + 2;
    while (content[cursor] === " " || content[cursor] === "\t") cursor++;
  }

  if (content[cursor] === "\r" && content[cursor + 1] === "\n") return cursor + 2;
  if (content[cursor] === "\n" || content[cursor] === "\r") return cursor + 1;
  return start;
}

function nextSignificantToken(content: string, start: number): string | null {
  let cursor = start;
  while (cursor < content.length) {
    if (/\s/.test(content[cursor]!)) {
      cursor++;
      continue;
    }
    if (content[cursor] === "/" && content[cursor + 1] === "/") {
      const newline = content.indexOf("\n", cursor + 2);
      if (newline === -1) return null;
      cursor = newline + 1;
      continue;
    }
    if (content[cursor] === "/" && content[cursor + 1] === "*") {
      const closing = content.indexOf("*/", cursor + 2);
      if (closing === -1) return null;
      cursor = closing + 2;
      continue;
    }
    if (content[cursor] === ";") return ";";
    return /^[A-Za-z_$][\w$]*/.exec(content.slice(cursor))?.[0] ?? content[cursor]!;
  }
  return null;
}

function isCodePosition(source: string, targetIndex: number): boolean {
  for (let index = 0; index < targetIndex; index++) {
    const character = source[index]!;
    const next = source[index + 1];

    if (character === "\"" || character === "'" || character === "`") {
      const closing = skipQuotedValue(source, index, character);
      if (closing === -1 || closing >= targetIndex) return false;
      index = closing;
      continue;
    }
    if (character === "/" && next === "/") {
      const newline = source.indexOf("\n", index + 2);
      if (newline === -1 || newline >= targetIndex) return false;
      index = newline;
      continue;
    }
    if (character === "/" && next === "*") {
      const closing = source.indexOf("*/", index + 2);
      if (closing === -1 || closing + 1 >= targetIndex) return false;
      index = closing + 1;
    }
  }

  return true;
}

function skipQuotedValue(source: string, openingIndex: number, quote: string): number {
  for (let index = openingIndex + 1; index < source.length; index++) {
    if (source[index] === "\\") {
      index++;
      continue;
    }
    if (source[index] === quote) return index;
  }
  return -1;
}
