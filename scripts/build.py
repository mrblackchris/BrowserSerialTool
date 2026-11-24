#!/usr/bin/env python3
"""Build a portable, offline HTML artifact using only Python's standard library."""
from pathlib import Path
import argparse
root = Path(__file__).resolve().parent.parent
page = (root / 'src/page.html').read_text()
for marker, filename in [('STYLES', 'style.css'), ('CORE', 'core.js'), ('APP', 'app.js')]:
    page = page.replace(f'/* {marker} */', (root / 'src' / filename).read_text())
parser = argparse.ArgumentParser()
parser.add_argument('--check', action='store_true')
args = parser.parse_args()
for name in ['index.html', 'BrowserSerialTool.html']:
    path = root / name
    if args.check:
        if not path.exists() or path.read_text() != page:
            raise SystemExit(f'{name} is stale. Run python3 scripts/build.py')
    else:
        path.write_text(page)
        print(f'Built {name}')
