from html import escape
from pathlib import Path
import re
source = Path('essay_good_earth.md')
out = Path('Good_Earth_Cross_Cultural_Representation_Essay.doc')
text = source.read_text(encoding='utf-8')

def inline(s: str) -> str:
    parts = re.split(r'(\*\*[^*]+\*\*|\*[^*]+\*)', s)
    html = []
    for part in parts:
        if not part:
            continue
        if part.startswith('**') and part.endswith('**'):
            html.append(f'<b>{escape(part[2:-2])}</b>')
        elif part.startswith('*') and part.endswith('*'):
            html.append(f'<i>{escape(part[1:-1])}</i>')
        else:
            html.append(escape(part))
    return ''.join(html)

body = []
for raw in text.splitlines():
    line = raw.strip()
    if not line:
        continue
    if line.startswith('# '):
        body.append(f'<h1>{inline(line[2:])}</h1>')
    elif line.startswith('## '):
        body.append(f'<h2>{inline(line[3:])}</h2>')
    else:
        body.append(f'<p>{inline(line)}</p>')

html = f'''<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Good Earth Cross-Cultural Representation Essay</title>
<style>
@page {{ size: A4; margin: 2.54cm; }}
body {{ font-family: "Times New Roman", serif; font-size: 12pt; line-height: 20pt; }}
h1 {{ font-family: "Times New Roman", serif; font-size: 18pt; text-align: center; font-weight: bold; line-height: 20pt; margin: 0 0 20pt 0; }}
h2 {{ font-family: "Times New Roman", serif; font-size: 14pt; font-weight: bold; line-height: 20pt; margin: 14pt 0 6pt 0; }}
p {{ margin: 0 0 6pt 0; text-indent: 2em; line-height: 20pt; }}
</style>
</head>
<body>
{chr(10).join(body)}
</body>
</html>
'''
out.write_text(html, encoding='utf-8')
print(f'Wrote {out}')
