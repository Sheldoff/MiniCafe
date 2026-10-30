"""Build the online variant from the canonical UI, without touching Android assets."""
from pathlib import Path
import sys
import shutil
import json

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / 'work/cafe'))
from frontend_build import build_html

out = HERE / 'dist'
out.mkdir(exist_ok=True)
html = build_html()
# Opt in to Android Chrome edge-to-edge; otherwise Chrome adds a native bottom
# chin outside the DOM, even when body and fixed overlays fill their viewport.
html = html.replace('content="width=device-width,initial-scale=1"',
                    'content="width=device-width,initial-scale=1,viewport-fit=cover"', 1)
html = html.replace('</style>', (HERE / 'src/cloud.css').read_text(encoding='utf-8') + '</style>', 1)
html = html.replace('<script>', '<script>window.CafeCloud=__CLOUD_CONTEXT__;</script><script>', 1)
html += '<script>' + (HERE / 'src/cloud-ui.js').read_text(encoding='utf-8') + '</script>'
for source in ['staff-ui.js','online-layout.js','guest-admin-ui.js']:
    html += '<script>' + (HERE / 'src' / source).read_text(encoding='utf-8') + '</script>'
(out / 'private').mkdir(exist_ok=True)
(out / 'private/admin.html').write_text(html, encoding='utf-8')
(out / 'index.html').write_text((HERE / 'src/guest.html').read_text(encoding='utf-8'), encoding='utf-8')
for name in ['guest.js','guest.css']:
    shutil.copyfile(HERE / 'src' / name,out / name)
(out / 'login.html').write_text((HERE / 'src/login.html').read_text(encoding='utf-8'), encoding='utf-8')
(out / 'images').mkdir(exist_ok=True)
source = ROOT / 'work/android/assets/default-menu'
menu = json.loads((source / 'menu.json').read_text(encoding='utf-8'))['items']
rows = []
for i, item in enumerate(menu, 1):
    shutil.copyfile(source / item['image'], out / 'images' / item['image'])
    rows.append({'id': i, 'name': item['name'], 'category': 'Напої', 'route': 'bar', 'price': 5000,
                 'active': 1, 'sold_out': False, 'image_version': 'default-1', 'image_asset': '/images/' + item['image']})
for i, name in enumerate(['Круасан (тест)', 'Сендвіч (тест)', 'Мафін (тест)'], 9):
    rows.append({'id': i, 'name': name, 'category': 'Їжа', 'route': 'instant', 'price': 5000, 'active': 1, 'sold_out': False})
seed = '\n'.join('INSERT OR IGNORE INTO products(id,data) VALUES (%d,\'%s\');' % (p['id'], json.dumps(p,ensure_ascii=False).replace("'", "''")) for p in rows)
(HERE / 'migrations/0002_seed.sql').write_text(seed + '\n', encoding='utf-8')
(out / 'vendor').mkdir(exist_ok=True)
for file, target in [('pdf-lib/dist/pdf-lib.min.js','pdf-lib.js'), ('@pdf-lib/fontkit/dist/fontkit.umd.min.js','fontkit.js')]:
    shutil.copyfile(HERE / 'node_modules' / file, out / 'vendor' / target)
shutil.copyfile(ROOT / 'work/android/assets/fonts/DejaVuSans.ttf', out / 'vendor/font.ttf')
shutil.copyfile(ROOT / 'work/android/assets/fonts/LICENSE-DejaVu.txt', out / 'vendor/LICENSE-DejaVu.txt')
for package, name in [('pdf-lib','LICENSE-pdf-lib.txt'),('@pdf-lib/fontkit','LICENSE-fontkit.txt')]:
    license_file = next((HERE / 'node_modules' / package).glob('LICENSE*'), HERE / 'licenses' / name)
    shutil.copyfile(license_file, out / 'vendor' / name)
(out / 'robots.txt').write_text('User-agent: *\nDisallow: /\n', encoding='utf-8')
(out / '_headers').write_text('/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  X-Frame-Options: DENY\n', encoding='utf-8')
print('Built online UI; seed: 8 drinks and 3 test food items. Existing products never overwritten.')
