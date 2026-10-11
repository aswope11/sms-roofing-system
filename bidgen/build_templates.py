"""Write one blank standalone .xlsx per scope into an output folder."""
import json, os, sys
from bidgen.engine import build_workbook
from bidgen.scopes import BUILDERS, ORDER
here = os.path.dirname(__file__)
prices = json.load(open(os.path.join(here, 'prices.json')))
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
for i, sid in enumerate(ORDER, 1):
    s = BUILDERS[sid]()
    wb, _ = build_workbook([s], 'standalone', prices)
    fn = os.path.join(out, f'SCOPE {i:02d} - {s.tab}.xlsx')
    wb.save(fn); print(fn)
