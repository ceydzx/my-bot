import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class LuaRunner {
  constructor() {
    // Generate a unique temporary directory
    this.tmp = fs.mkdtemp(path.join(os.tmpdir(), 'lrun_'));
    this.cache = {};
  }

  /**
   * Constructs the Lua execution harness.
   */
  buildHarness(code, tag = 'analysis') {
    const tpl = `
local _tag = "${tag}"
local _t0 = os.clock()

local function _log(kind, msg)
    print(string.format("[%s] %s", kind, msg))
end

local _env = {}
setmetatable(_env, {
    __index = function(t, k)
        if k == "print" then
            return function(...)
                local parts = {...}
                _log("OUT", table.concat(parts, "\\t"))
            end
        end
        return nil
    end
})

${code}

_log("DONE", string.format("%.3fs", os.clock() - _t0))
`;
    return tpl;
  }

  /**
   * Executes the Lua code using the host system's lua/luau binary.
   */
  async execLua(code) {
    const tmpDir = await this.tmp;
    const fpath = path.join(tmpDir, 'run.lua');

    await fs.writeFile(fpath, code, 'utf-8');

    try {
      // Use execFile to run the Lua CLI safely with a 10s timeout
      const { stdout, stderr } = await execFileAsync('lua', [fpath], {
        timeout: 10000,
        maxBuffer: 1024 * 1024 * 10, // 10MB buffer limit
      });

      return {
        ok: true,
        out: stdout || '',
        err: stderr || '',
        code: 0,
      };
    } catch (err) {
      if (err.killed && err.signal === 'SIGTERM') {
        return {
          ok: false,
          out: '',
          err: 'Lua execution timeout (10s)',
          code: -1,
        };
      }
      if (err.code === 'ENOENT') {
        return {
          ok: false,
          out: '',
          err: 'Lua interpreter not found',
          code: -1,
        };
      }
      return {
        ok: false,
        out: err.stdout || '',
        err: err.stderr || err.message || String(err),
        code: typeof err.code === 'number' ? err.code : -1,
      };
    }
  }

  /**
   * Scans function signatures via Regex.
   */
  getFuncs(src) {
    const pats = [
      /function\s+(\w+)\(([^)]*)\)/g,
      /local\s+function\s+(\w+)\(([^)]*)\)/g,
      /(\w+)\s*=\s*function\(([^)]*)\)/g,
    ];
    const out = [];

    for (const pat of pats) {
      const matches = src.matchAll(pat);
      for (const m of matches) {
        const rawParams = m[2] ? m[2].trim() : '';
        out.push({
          name: m[1],
          params: rawParams ? rawParams.split(',').map((p) => p.trim()) : [],
          sig: m[0],
        });
      }
    }
    return out;
  }

  /**
   * Calculates string and hash metrics for the source code.
   */
  metrics(src) {
    const lines = src.split('\n');
    const totalChars = lines.reduce((acc, l) => acc + l.length, 0);

    return {
      lines: lines.length,
      chars: src.length,
      funcs: this.getFuncs(src).length,
      md5: crypto.createHash('md5').update(src).digest('hex'),
      sha256: crypto.createHash('sha256').update(src).digest('hex'),
      avg_len: totalChars / Math.max(lines.length, 1),
    };
  }

  /**
   * Processes a target file and caches results.
   */
  async process(filePath) {
    let src;
    try {
      src = await fs.readFile(filePath, { encoding: 'utf-8' });
    } catch (e) {
      return {
        file: filePath,
        error: `Failed to read file: ${e.message}`,
        metrics: null,
        functions: [],
        run: null,
      };
    }

    const m = this.metrics(src);
    const harness = this.buildHarness(src, 'full');
    const run = await this.execLua(harness);

    const result = {
      file: filePath,
      metrics: m,
      functions: this.getFuncs(src),
      run: run,
    };

    this.cache[filePath] = result;
    return result;
  }

  /**
   * Dumps accumulated cache results into a JSON file.
   */
  async dump(outPath) {
    const report = {
      version: '2.0.0',
      files: Object.keys(this.cache).length,
      results: this.cache,
    };

    await fs.writeFile(outPath, JSON.stringify(report, null, 2), 'utf-8');
    return outPath;
  }
}
