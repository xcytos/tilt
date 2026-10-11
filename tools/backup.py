#!/usr/bin/env python3
"""Copy the project database into data/backups/ with the sqlite backup API.

The live file is never opened for writing: sqlite3.Connection.backup reads
it through its own snapshot and checkpoints the WAL into the copy, so each
backup is one self-contained .db. The newest 10 are kept.
"""
import os
import sqlite3
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.environ.get('DB_PATH') or os.path.join(ROOT, 'data', 'o2tilt.db')
BACKUPS = os.path.join(ROOT, 'data', 'backups')

if not os.path.exists(DB):
    print(f'no database at {DB} - nothing to back up')
    sys.exit(0)

os.makedirs(BACKUPS, exist_ok=True)
stamp = time.strftime('%Y%m%d-%H%M%S')
dest = os.path.join(BACKUPS, f'tilt-{stamp}.db')

src = sqlite3.connect(DB)
out = sqlite3.connect(dest)
try:
    src.backup(out)
finally:
    out.close()
    src.close()

print(f'backed up {DB} -> {dest} ({os.path.getsize(dest)} bytes)')

kept = sorted(f for f in os.listdir(BACKUPS) if f.endswith('.db'))
for old in kept[:-10]:
    os.unlink(os.path.join(BACKUPS, old))
    print(f'pruned {old}')
