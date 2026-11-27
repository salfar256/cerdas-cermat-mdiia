"""Pasang nomor versi pada semua file JS/CSS agar HP & laptop selalu memuat versi terbaru.
Jalankan setiap kali selesai mengubah kode:  python3 tools/versi.py
"""
import re, time, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
v = time.strftime("%Y%m%d%H%M%S")
pat = re.compile(r'((?:\./|js/|css/)[\w\-]+\.(?:js|css))(?:\?v=\w+)?"')
for f in list(root.glob("*.html")) + list((root / "js").glob("*.js")):
    s = f.read_text(encoding="utf-8")
    n = pat.sub(lambda m: f'{m.group(1)}?v={v}"', s)
    if n != s:
        f.write_text(n, encoding="utf-8")
print("versi", v)
