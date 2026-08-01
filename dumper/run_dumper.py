#!/usr/bin/env python3
import os
import sys
import json

# ensure package imports work when this script is invoked from repo root
sys.path.append(os.path.dirname(__file__))
from Main import Pipeline


def main():
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'usage: run_dumper.py <file> [mode]'}))
        sys.exit(2)

    path = sys.argv[1]
    mode = sys.argv[2] if len(sys.argv) > 2 else 'full'

    pipe = Pipeline()
    try:
        res = pipe.analyze(path, mode=mode)
        sm = pipe.summary([res])
        out = {'summary': sm, 'result': res}
        print(json.dumps(out, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()
