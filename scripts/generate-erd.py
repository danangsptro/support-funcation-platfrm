#!/usr/bin/env python3
"""Hasilkan ERD Mermaid dari backend/prisma/schema.prisma (nama tabel/kolom database via @@map/@map).
Pemakaian: python3 -I scripts/generate-erd.py > /tmp/erd.md  (blok disalin ke docs/architecture.md §5)."""
import re, sys, pathlib

src = pathlib.Path(__file__).resolve().parent.parent / 'backend/prisma/schema.prisma'
text = src.read_text()
models = {m.group(1): m.group(2) for m in re.finditer(r'^model (\w+) \{\n(.*?)^\}', text, re.S | re.M)}
enums = set(re.findall(r'^enum (\w+)', text, re.M))
table = {name: (re.search(r'@@map\("(\w+)"\)', body) or [None, name])[1] for name, body in models.items()}

def snake(s): return re.sub(r'(?<!^)(?=[A-Z])', '_', s).lower()
out = ['```mermaid', 'erDiagram']
rels = []
for name, body in models.items():
    out.append(f'  {table[name]} {{')
    fks = {c.strip() for r in re.findall(r'fields: \[([^\]]+)\]', body) for c in r.split(',')}
    for line in body.splitlines():
        m = re.match(r'\s+(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)', line)
        if not m or line.strip().startswith('@@') or line.strip().startswith('//'): continue
        field, typ, many, opt, attrs = m.groups()
        if typ in models:
            rm = re.search(r'fields: \[([^\]]+)\]', attrs)
            if rm:
                card = '|o' if opt else '||'
                rels.append(f'  {table[typ]} {card}--o{{ {table[name]} : "{field}"')
            continue
        col = (re.search(r'@map\("(\w+)"\)', attrs) or [None, snake(field)])[1]
        t = 'enum' if typ in enums else {'String': 'text', 'Int': 'int', 'Decimal': 'numeric', 'DateTime': 'timestamptz', 'Boolean': 'bool', 'Json': 'jsonb'}.get(typ, typ)
        if '@db.Uuid' in attrs: t = 'uuid'
        if '@db.Date' in attrs: t = 'date'
        key = ','.join(k for k, on in (('PK', '@id' in attrs), ('FK', field in fks)) if on)
        out.append(f'    {t} {col} {key}'.rstrip() + ('' if not opt else ' "nullable"'))
    out.append('  }')
out += sorted(set(rels))
out.append('```')
print('\n'.join(out))
