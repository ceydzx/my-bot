const fs = require('fs');
const crypto = require('crypto');

class LuaDumper {
  constructor() {
    this.cache = {};
  }

  // Extract strings from Lua code (handles both quoted and escaped strings)
  extractStrings(src) {
    const strings = [];
    // Match single and double quoted strings
    const stringPattern = /(['"])(?:(?=(\\?))\2.)*?\1/g;
    let match;
    while ((match = stringPattern.exec(src)) !== null) {
      strings.push({
        value: match[0],
        position: match.index,
      });
    }
    return strings;
  }

  // Find function definitions
  getFunctions(src) {
    const patterns = [
      /function\s+(\w+)\s*\(\s*([^)]*)\s*\)/g,
      /local\s+function\s+(\w+)\s*\(\s*([^)]*)\s*\)/g,
      /(\w+)\s*=\s*function\s*\(\s*([^)]*)\s*\)/g,
    ];

    const functions = [];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(src)) !== null) {
        const name = match[1];
        const params = match[2]
          .split(',')
          .map(p => p.trim())
          .filter(p => p);

        functions.push({
          name,
          params,
          signature: match[0],
          position: match.index,
        });
      }
    }

    // Remove duplicates
    return functions.filter((f, i, arr) => 
      arr.findIndex(x => x.name === f.name && x.position === f.position) === i
    );
  }

  // Find patterns like table definitions, assignments, etc
  scanPatterns(src) {
    const patterns = {
      tables: [],
      assignments: [],
      comments: [],
      loops: [],
      conditionals: [],
    };

    // Table definitions
    const tablePattern = /(\w+)\s*=\s*\{[^}]*\}/g;
    let match;
    while ((match = tablePattern.exec(src)) !== null) {
      patterns.tables.push({
        name: match[1],
        signature: match[0].substring(0, 50) + '...',
        position: match.index,
      });
    }

    // Assignments
    const assignPattern = /local\s+(\w+)\s*=\s*([^\n;]+)/g;
    while ((match = assignPattern.exec(src)) !== null) {
      patterns.assignments.push({
        variable: match[1],
        value: match[2].substring(0, 50),
        position: match.index,
      });
    }

    // Comments
    const commentPattern = /--(.*?)$/gm;
    while ((match = commentPattern.exec(src)) !== null) {
      patterns.comments.push({
        text: match[1].trim(),
        position: match.index,
      });
    }

    // Loops
    const loopPattern = /(for|while|repeat)\s+[^\n]+/g;
    while ((match = loopPattern.exec(src)) !== null) {
      patterns.loops.push({
        type: match[1],
        signature: match[0].substring(0, 50),
        position: match.index,
      });
    }

    // Conditionals
    const condPattern = /(if|elseif|else)\s+[^\n]+/g;
    while ((match = condPattern.exec(src)) !== null) {
      patterns.conditionals.push({
        type: match[1],
        signature: match[0].substring(0, 50),
        position: match.index,
      });
    }

    return patterns;
  }

  // Calculate metrics about the code
  getMetrics(src) {
    const lines = src.split('\n');
    return {
      lines: lines.length,
      chars: src.length,
      functions: this.getFunctions(src).length,
      strings: this.extractStrings(src).length,
      md5: crypto.createHash('md5').update(src).digest('hex'),
      sha256: crypto.createHash('sha256').update(src).digest('hex'),
      avg_line_length: Math.round(src.length / Math.max(lines.length, 1)),
      is_obfuscated: this.detectObfuscation(src),
    };
  }

  // Detect if code appears to be obfuscated
  detectObfuscation(src) {
    const indicators = {
      longVariableNames: (src.match(/_[a-zA-Z0-9_]{20,}/g) || []).length,
      hexStrings: (src.match(/0x[a-f0-9]+/gi) || []).length,
      minifiedWhitespace: src.split('\n').filter(l => l.length > 200).length,
      singleCharVars: (src.match(/\s[a-z]\s*=/g) || []).length,
      noComments: src.match(/--/g) === null,
    };

    const score = Object.values(indicators).reduce((a, b) => a + (b > 0 ? 1 : 0), 0);
    return {
      suspected: score >= 3,
      indicators,
      confidence: Math.round((score / 5) * 100),
    };
  }

  // Main analysis function
  analyze(filepath, mode = 'full') {
    try {
      const src = fs.readFileSync(filepath, 'utf-8');

      const result = {
        file: filepath,
        mode,
        timestamp: new Date().toISOString(),
        metrics: this.getMetrics(src),
        functions: this.getFunctions(src),
        strings: null,
        patterns: null,
      };

      if (mode === 'full' || mode === 'strings') {
        result.strings = this.extractStrings(src);
      }

      if (mode === 'full' || mode === 'patterns') {
        result.patterns = this.scanPatterns(src);
      }

      return result;
    } catch (error) {
      return {
        file: filepath,
        error: error.message,
        stack: error.stack,
      };
    }
  }

  // Generate summary
  summary(results) {
    const totalFuncs = results.reduce((sum, r) => sum + (r.functions?.length || 0), 0);
    const totalStrings = results.reduce((sum, r) => sum + (r.strings?.length || 0), 0);
    const obfuscatedCount = results.filter(r => r.metrics?.is_obfuscated?.suspected).length;

    return {
      files_analyzed: results.length,
      total_functions: totalFuncs,
      total_strings: totalStrings,
      obfuscated_files: obfuscatedCount,
      errors: results.filter(r => r.error).length,
      timestamp: new Date().toISOString(),
    };
  }
}

module.exports = LuaDumper;
