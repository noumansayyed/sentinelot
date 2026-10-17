"""
Replace all hardcoded dark-mode hex/rgba literals with CSS-variable references.
Idempotent — running twice is safe.
"""
import re
import pathlib

FILES = ["HistoryView.tsx", "AuditView.tsx", "AlertsView.tsx",
         "RowActions.tsx", "OperationsView.tsx", "App.tsx"]

# Literal string → literal string
REPLACEMENTS = [
    # backgrounds
    ('"#1C1C1E"', 'var(--glass-1)'),
    ('"#202022"', 'var(--glass-1)'),
    ('"#242426"', 'var(--glass-2)'),
    ('"#2C2C2E"', 'var(--glass-2)'),
    ('"#3A3A3C"', 'var(--hairline-light)'),
    ('"#48484A"', 'var(--hairline-light)'),
    ('"#0A0A0A"', 'var(--bg-0)'),
    ('"#000000"', 'var(--bg-0)'),
    ('"#000"',    'var(--bg-0)'),
    # text
    ('"#F5F5F7"', 'var(--text-1)'),
    ('"#D1D1D6"', 'var(--text-2)'),
    ('"#8E8E93"', 'var(--text-3)'),
    ('"#C7C7CC"', 'var(--text-3)'),
    # semantic
    ('"#32D74B"', 'var(--success)'),
    ('"#34C759"', 'var(--success)'),
    ('"#FF9F0A"', 'var(--warning)'),
    ('"#FF9500"', 'var(--warning)'),
    ('"#FF6B61"', 'var(--danger)'),
    ('"#FF453A"', 'var(--danger)'),
    ('"#FF3B30"', 'var(--danger)'),
    ('"#FFD60A"', 'var(--warning)'),
    ('"#007AFF"', 'var(--accent)'),
    ('"#AF52DE"', 'var(--violet)'),
    ('"#BF5AF2"', 'var(--violet)'),
    ('"#666"',    'var(--text-3)'),
    # rgba
    ('"rgba(0,122,255,0.08)"',  'var(--accent-bg)'),
    ('"rgba(0,122,255,0.10)"',  'rgba(10,132,255,0.10)'),
    ('"rgba(0,122,255,0.15)"',  'rgba(10,132,255,0.15)'),
    ('"rgba(52,199,89,0.1)"',   'rgba(48,209,88,0.12)'),
    ('"rgba(52,199,89,0.06)"',  'rgba(48,209,88,0.08)'),
    ('"rgba(255,59,48,0.1)"',   'rgba(255,69,58,0.12)'),
    ('"rgba(255,59,48,0.07)"',  'rgba(255,69,58,0.08)'),
    ('"rgba(255,59,48,0.08)"',  'rgba(255,69,58,0.10)'),
    ('"rgba(255,59,48,0.3)"',   'rgba(255,69,58,0.35)'),
    ('"rgba(255,149,0,0.07)"',  'rgba(255,159,10,0.10)'),
    ('"rgba(255,214,10,0.07)"', 'rgba(255,214,10,0.10)'),
]

# Template-literal `#${color}15` → replace with safe rgba; keep the value but drop the alpha hack
TEMPLATE_RGBA = re.compile(r'`\$\{([^}]+)\}15`')
TEMPLATE_RGBA2 = re.compile(r'`\$\{([^}]+)\}10`')

def migrate(path: pathlib.Path):
    s = path.read_text()
    before = s

    # Literal replacements
    for old, new in REPLACEMENTS:
        s = s.replace(old, new)

    # Template-literal rgba hacks → transparent (blend with glass)
    s = TEMPLATE_RGBA.sub(lambda m: '`rgba(255,255,255,0.08)`', s)
    s = TEMPLATE_RGBA2.sub(lambda m: '`rgba(255,255,255,0.05)`', s)

    # Bare strings: `color:"#F5F5F7"` may be missing quotes → catch bare hex values in string positions
    # Only if surrounded by quotes or whitespace after colon
    s = re.sub(r'(?<=: )"#[0-9A-Fa-f]{3,6}"', 'var(--text-1)', s)  # safety net

    if s != before:
        path.write_text(s)
        return True
    return False

changed = 0
for fname in FILES:
    p = pathlib.Path(fname)
    if not p.exists():
        print(f"SKIP {fname} (not found)")
        continue
    if migrate(p):
        print(f"PATCHED {fname}")
        changed += 1
    else:
        print(f"NO-CHANGE {fname}")

print(f"\nTotal files changed: {changed}")

# Report remaining hardcoded hex
print("\n=== remaining hex literals ===")
for fname in FILES:
    p = pathlib.Path(fname)
    if not p.exists(): continue
    txt = p.read_text()
    hits = re.findall(r'"#[0-9A-Fa-f]{3,6}"', txt)
    if hits:
        print(f"{fname}: {len(hits)} -> {sorted(set(hits))[:10]}")
    else:
        print(f"{fname}: 0")
