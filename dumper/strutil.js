import fs from 'fs';

export class StrDecode {
  constructor() {
    this.cache = {};
    this.hits = [];
  }

  unescape(s) {
    if (typeof s !== 'string') return s;

    // Convert octal escape sequences (\123)
    s = s.replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));

    // Convert hex escape sequences (\xAA)
    s = s.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

    // Standard character replacements
    return s
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, '\\');
  }

  evalExpr(expr) {
    try {
      expr = expr.trim();

      // Handle raw single or double-quoted strings
      if (
        (expr.startsWith('"') && expr.endsWith('"')) ||
        (expr.startsWith("'") && expr.endsWith("'"))
      ) {
        return this.unescape(expr.slice(1, -1));
      }

      // Safe arithmetic evaluator for numbers and standard math (+, -, *, /)
      if (/^[\d\s\+\-\*\/\(\)\.]+$/.test(expr)) {
        // Simple safe numeric expression evaluation
        const fn = new Function(`return (${expr});`);
        const result = fn();
        return isFinite(result) ? result : 0;
      }

      return null;
    } catch {
      return null;
    }
  }

  pullTables(src) {
    const patterns = [
      /local\s+(\w+)\s*=\s*\{([^}]+)\}/g,
      /(\w+)\s*=\s*\{([^}]+)\}/g,
      /table\.create.*?\{([^}]+)\}/g,
    ];

    const out = [];

    for (const pat of patterns) {
      let match;
      while ((match = pat.exec(src)) !== null) {
        const name = match.length > 2 ? match[1] : 'unnamed';
        const body = match.length > 2 ? match[2] : match[1];

        if (body.includes('"') || body.includes("'")) {
          out.push({
            name,
            content: body,
            type: 'strtable',
          });
        }
      }
    }

    return out;
  }

  scanSource(src, filePath = 'inline') {
    const result = {
      file: filePath,
      size: src.length,
      tables_found: this.pullTables(src),
      strings: [],
      ops: [],
    };

    // Match double or single quoted Luau string literals
    const stringRegex = /(["'])(?:(?=(\\?))\2[\s\S])*?\1/g;
    let match;

    while ((match = stringRegex.exec(src)) !== null) {
      const raw = match[0];
      const innerStr = raw.slice(1, -1);

      result.strings.push({
        raw,
        decoded: this.unescape(innerStr),
        pos: match.index,
      });
    }

    return result;
  }

  scan(filePath) {
    const src = fs.readFileSync(filePath, { encoding: 'utf-8', flag: 'r' });
    return this.scanSource(src, filePath);
  }
}

export class PatternScan {
  constructor() {
    this.pats = {
      b64: /[A-Za-z0-9+/]+={0,2}/g,
      hex: /[0-9A-Fa-f]{8,}/g,
      call: /\w+\([^)]*\)/g,
      arr: /\[[^\]]+\]/g,
    };
  }

  run(src) {
    const found = [];

    for (const [label, pat] of Object.entries(this.pats)) {
      // Reset stateful global regex search index
      pat.lastIndex = 0;

      let match;
      while ((match = pat.exec(src)) !== null) {
        if (match[0].length > 6) {
          found.push({
            type: label,
            match: match[0],
            pos: match.index,
          });
        }
      }
    }

    return found;
  }
}
