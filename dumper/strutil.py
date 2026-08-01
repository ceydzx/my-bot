import re
import ast
from typing import Dict, List, Any


class StrDecode:
    def __init__(self):
        self.cache = {}
        self.hits = []

    def unescape(self, s: str) -> str:
        def oct_sub(m):
            return chr(int(m.group(1), 8))

        def hex_sub(m):
            return chr(int(m.group(1), 16))

        subs = [
            (r'\\([0-7]{1,3})', oct_sub),
            (r'\\x([0-9a-fA-F]{2})', hex_sub),
            (r'\\n', '\n'),
            (r'\\r', '\r'),
            (r'\\t', '\t'),
            (r'\\"', '"'),
            (r"\\'", "'"),
            (r'\\\\', '\\'),
        ]

        for pat, rep in subs:
            if callable(rep):
                s = re.sub(pat, rep, s)
            else:
                s = s.replace(pat, rep)

        return s

    def eval_expr(self, expr: str) -> Any:
        try:
            expr = expr.strip()

            if expr.startswith('"') and expr.endswith('"'):
                return self.unescape(expr[1:-1])
            if expr.startswith("'") and expr.endswith("'"):
                return self.unescape(expr[1:-1])

            tree = ast.parse(expr, mode='eval')

            def walk(node):
                if isinstance(node, ast.Constant):
                    return node.value
                if isinstance(node, ast.BinOp):
                    l = walk(node.left)
                    r = walk(node.right)
                    if isinstance(node.op, ast.Add): return l + r
                    if isinstance(node.op, ast.Sub): return l - r
                    if isinstance(node.op, ast.Mult): return l * r
                    if isinstance(node.op, ast.Div): return l / r if r != 0 else 0
                return None

            return walk(tree.body)
        except:
            return None

    def pull_tables(self, src: str) -> List[Dict]:
        pats = [
            r'local\s+(\w+)\s*=\s*\{([^}]+)\}',
            r'(\w+)\s*=\s*\{([^}]+)\}',
            r'table\.create.*?\{([^}]+)\}',
        ]

        out = []
        for pat in pats:
            for m in re.finditer(pat, src, re.DOTALL):
                name = m.group(1) if len(m.groups()) > 1 else "unnamed"
                body = m.group(2) if len(m.groups()) > 1 else m.group(1)
                if '"' in body or "'" in body:
                    out.append({'name': name, 'content': body, 'type': 'strtable'})

        return out

    def scan(self, path: str) -> Dict[str, Any]:
        with open(path, 'r', encoding='utf-8', errors='ignore') as f:
            src = f.read()

        result = {
            'file': path,
            'size': len(src),
            'tables_found': self.pull_tables(src),
            'strings': [],
            'ops': [],
        }

        for m in re.finditer(r'["\'](.*?)["\']', src):
            result['strings'].append({
                'raw': m.group(0),
                'decoded': self.unescape(m.group(0)),
                'pos': m.start(),
            })

        return result


class PatternScan:
    def __init__(self):
        self.pats = {
            'b64': r'[A-Za-z0-9+/]+={0,2}',
            'hex': r'[0-9A-Fa-f]{8,}',
            'call': r'\w+\([^)]*\)',
            'arr': r'\[[^\]]+\]',
        }

    def run(self, src: str) -> List[Dict]:
        found = []
        for label, pat in self.pats.items():
            for m in re.finditer(pat, src):
                if len(m.group()) > 6:
                    found.append({
                        'type': label,
                        'match': m.group(),
                        'pos': m.start(),
                    })
        return found
