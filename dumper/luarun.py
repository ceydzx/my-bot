import subprocess
import tempfile
import os
import json
import hashlib
import re
from typing import Dict, List


class LuaRunner:
    def __init__(self):
        self.tmp = tempfile.mkdtemp(prefix="lrun_")
        self.cache = {}

    def build_harness(self, code: str, tag: str = "analysis") -> str:
        tpl = """
local _tag = "{tag}"
local _t0 = os.clock()

local function _log(kind, msg)
    print(string.format("[%s] %s", kind, msg))
end

local _env = {{}}
setmetatable(_env, {{
    __index = function(t, k)
        if k == "print" then
            return function(...)
                local parts = {{...}}
                _log("OUT", table.concat(parts, "\\t"))
            end
        end
        return nil
    end
}})

{code}

_log("DONE", string.format("%.3fs", os.clock() - _t0))
"""
        return tpl.format(tag=tag, code=code)

    def exec_lua(self, code: str) -> Dict:
        fpath = os.path.join(self.tmp, "run.lua")
        with open(fpath, 'w', encoding='utf-8') as f:
            f.write(code)

        try:
            r = subprocess.run(
                ['lua', fpath],
                capture_output=True,
                text=True,
                timeout=10
            )
            return {
                'ok': r.returncode == 0,
                'out': r.stdout if r.stdout else '',
                'err': r.stderr if r.stderr else '',
                'code': r.returncode,
            }
        except subprocess.TimeoutExpired:
            return {'ok': False, 'out': '', 'err': 'Lua execution timeout (10s)', 'code': -1}
        except FileNotFoundError:
            return {'ok': False, 'out': '', 'err': 'Lua interpreter not found', 'code': -1}
        except Exception as e:
            return {'ok': False, 'out': '', 'err': str(e), 'code': -1}

    def get_funcs(self, src: str) -> List[Dict]:
        pats = [
            r'function\s+(\w+)\(([^)]*)\)',
            r'local\s+function\s+(\w+)\(([^)]*)\)',
            r'(\w+)\s*=\s*function\(([^)]*)\)',
        ]
        out = []
        for pat in pats:
            for m in re.finditer(pat, src):
                out.append({
                    'name': m.group(1),
                    'params': [p.strip() for p in m.group(2).split(',')] if m.group(2).strip() else [],
                    'sig': m.group(0),
                })
        return out

    def metrics(self, src: str) -> Dict:
        lines = src.split('\n')
        return {
            'lines': len(lines),
            'chars': len(src),
            'funcs': len(self.get_funcs(src)),
            'md5': hashlib.md5(src.encode()).hexdigest(),
            'sha256': hashlib.sha256(src.encode()).hexdigest(),
            'avg_len': sum(len(l) for l in lines) / max(len(lines), 1),
        }

    def process(self, path: str) -> Dict:
        try:
            with open(path, 'r', encoding='utf-8', errors='ignore') as f:
                src = f.read()
        except Exception as e:
            return {
                'file': path,
                'error': f'Failed to read file: {str(e)}',
                'metrics': None,
                'functions': [],
                'run': None,
            }

        m = self.metrics(src)
        harness = self.build_harness(src, "full")
        run = self.exec_lua(harness)

        result = {
            'file': path,
            'metrics': m,
            'functions': self.get_funcs(src),
            'run': run,
        }

        self.cache[path] = result
        return result

    def dump(self, out_path: str):
        report = {
            'version': '2.0.0',
            'files': len(self.cache),
            'results': self.cache,
        }
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(report, f, indent=2, ensure_ascii=False)
        return out_path
