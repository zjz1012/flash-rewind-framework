#!/usr/bin/env python3
"""B站Toy 140MB (decimal) package gate. Usage: python 06_容量审核.py ./dist [./package.zip]"""
from pathlib import Path
import sys
LIMIT=140_000_000
INTERNAL=125_000_000

def fmt(n): return f'{n/1_000_000:.2f} MB ({n:,} bytes)'

def check(path):
 p=Path(path)
 if not p.exists():
  print('ERROR: path does not exist:', p); return False
 size=sum(f.stat().st_size for f in p.rglob('*') if f.is_file()) if p.is_dir() else p.stat().st_size
 name='dist total' if p.is_dir() else 'package'
 print(f'{name}: {fmt(size)}')
 if size>LIMIT:
  print('FAIL: above the absolute 140,000,000 byte limit');return False
 if size>INTERNAL: print('WARN: above internal 125MB warning threshold')
 else: print('PASS: within internal 125MB budget')
 if p.is_dir():
  large=sorted((f for f in p.rglob('*') if f.is_file()),key=lambda f:f.stat().st_size,reverse=True)[:12]
  for f in large: print('  ',fmt(f.stat().st_size),f.relative_to(p))
 return True
if __name__=='__main__':
 if len(sys.argv)<2: print(__doc__);sys.exit(2)
 sys.exit(0 if all(check(x) for x in sys.argv[1:]) else 1)
