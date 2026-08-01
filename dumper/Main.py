import os
import json
from datetime import datetime
from typing import Dict, List
from .strutil import StrDecode, PatternScan
from .luarun import LuaRunner


class Pipeline:
    def __init__(self):
        self.decoder = StrDecode()
        self.scanner = PatternScan()
        self.runner = LuaRunner()
        self.started = datetime.now()

    def analyze(self, path: str, mode: str = "full") -> Dict:
        res = {
            'file': path,
            'mode': mode,
            'strings': None,
            'patterns': None,
            'exec': None,
        }

        with open(path, 'r', encoding='utf-8', errors='ignore') as f:
            src = f.read()

        if mode in ("strings", "full"):
            res['strings'] = self.decoder.scan(path)

        if mode in ("patterns", "full"):
            res['patterns'] = self.scanner.run(src)

        if mode in ("execute", "full"):
            res['exec'] = self.runner.process(path)

        return res

    def summary(self, results: List[Dict]) -> Dict:
        total_str = 0
        total_pat = 0

        for r in results:
            if r.get('strings'):
                total_str += len(r['strings'].get('strings', []))
            if r.get('patterns'):
                total_pat += len(r['patterns'])

        return {
            'files': len(results),
            'strings': total_str,
            'patterns': total_pat,
            'elapsed': str(datetime.now() - self.started),
        }
