"""Build a full bid workbook from a list of scope ids and the job's numbers.

make_bid(scope_ids, job, inputs, title) -> openpyxl Workbook
  job    : {'field_sf': 12000, 'deck': 'METAL', ...}            (keys of engine.JOB)
  inputs : {'walls': {'len1': 200, 'par1': 3, ...}, 'tpo_ma': {'lf.men': 4, 'lf.rate': 30}, ...}
           key forms:  'k' (input / table cell)  ·  'k.men' / 'k.rate' (labor)  ·
                       'k.driver' / 'k.factor' / 'k.price' (a buy line's blue cells)
"""
import json, os
from .engine import build_workbook
from .scopes import BUILDERS, ORDER

HERE = os.path.dirname(__file__)


def prices():
    return json.load(open(os.path.join(HERE, 'prices.json')))


def make_bid(scope_ids, job=None, inputs=None, title=None):
    ids = [s for s in ORDER if s in scope_ids]
    TPO = {'iso_flat', 'iso_taper_quarter', 'iso_taper_eighth', 'kickers', 'crickets', 'tpo_ma', 'tpo_fa',
           'tpo_rhinobond', 'walls', 'base_flashing', 'curbs', 'pitch_pans', 'pipe_boots'}
    if TPO & set(ids) and 'tpo_basics' not in ids:
        ids.insert(0, 'tpo_basics')
    scopes = [BUILDERS[s]() for s in ids]
    wb, lays = build_workbook(scopes, 'assembled', prices(), job_values=job or {}, title=title)
    fill(wb, lays, inputs or {})
    return wb


def fill(wb, lays, inputs):
    for lay in lays:
        vals = inputs.get(lay.s.sid, {})
        ws = wb[lay.s.tab]
        for k, v in vals.items():
            if '.' in k:
                key, f = k.split('.', 1)
            else:
                key, f = k, 'v'
            if key not in lay.cell or lay.cell[key] is None:
                raise KeyError(f'{lay.s.sid}: no input called {k}')
            ws[lay.cell[key][f]] = v
