export class PatternScan {
  constructor() {
    // Patterns to look for in Luau/ Lua-like source
    this.pats = {
      // base64-ish sequences (minimum length to reduce false positives)
      b64: /[A-Za-z0-9+/]{8,}={0,2}/g,
      // hex numbers or long hex-like strings
      hex: /0x[a-fA-F0-9]+|[0-9A-Fa-f]{8,}/g,
      // function calls like foo(...) or foo.bar(...)
      call: /\b[\w$.]+\([^)]*\)/g,
      // array/table index or literal slices
      arr: /\[[^\]]+\]/g,
      // simple table assignment patterns
      table: /\b\w+\s*=\s*\{[^}]*\}/g,
    };
  }

  run(src) {
    const found = [];

    for (const [label, pat] of Object.entries(this.pats)) {
      // reset global regex state
      pat.lastIndex = 0;
      let match;
      while ((match = pat.exec(src)) !== null) {
        // filter out tiny matches
        if (match[0].length >= 4) {
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
