import fs from 'node:fs/promises';
import { StrDecode } from './strutil.js';
import { PatternScan } from './patternscan.js';
import { LuaRunner } from './luarun.js'; // Luau execution engine wrapper

export class Pipeline {
  constructor() {
    this.decoder = new StrDecode();
    this.scanner = new PatternScan();
    this.runner = new LuaRunner();
    this.started = Date.now();
  }

  /**
   * Analyzes a Luau file with selected detection modes.
   * @param {string} path - Path to the Luau script.
   * @param {"full" | "strings" | "patterns" | "execute"} mode - Analysis mode.
   * @returns {Promise<Object>}
   */
  async analyze(path, mode = "full") {
    const res = {
      file: path,
      mode: mode,
      strings: null,
      patterns: null,
      exec: null,
    };

    // Read the Luau source file asynchronously
    const src = await fs.readFile(path, { encoding: 'utf-8' });

    if (mode === "strings" || mode === "full") {
      res.strings = await this.decoder.scan(path);
    }

    if (mode === "patterns" || mode === "full") {
      res.patterns = await this.scanner.run(src);
    }

    if (mode === "execute" || mode === "full") {
      res.exec = await this.runner.process(path);
    }

    return res;
  }

  /**
   * Generates a summary from an array of analysis results.
   * @param {Array<Object>} results 
   * @returns {Object}
   */
  summary(results) {
    let totalStr = 0;
    let totalPat = 0;

    for (const r of results) {
      if (r?.strings?.strings) {
        totalStr += r.strings.strings.length;
      }
      if (r?.patterns) {
        totalPat += r.patterns.length;
      }
    }

    const elapsedMs = Date.now() - this.started;

    return {
      files: results.length,
      strings: totalStr,
      patterns: totalPat,
      elapsed: `${(elapsedMs / 1000).toFixed(3)}s`,
    };
  }
}
