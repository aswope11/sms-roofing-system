"""
The scope-of-work library.  Every number, factor and rule here was carried over from the
owner's own bid templates (01–07, Drive folder "SMS BID TEMPLATES (current)").  Where two
templates disagreed, the newest edit wins — 03 (last changed 10/8/26) — and the system-only
pieces come from the template that owns that system.  Nothing here is invented.
"""
from .engine import Scope, labor_header

SRC03 = '03 TPO MA ISO + MA TPO — NEW CONSTRUCTION (10/8/26)'
SRC04 = '04 TPO MA ISO + FA TPO — NEW CONSTRUCTION'
SRC02 = '02 TPO MA ISO + RHINOBOND TPO — TEAR-OFF'
SRC01 = '01 TPO MA ISO + MA TPO — TEAR-OFF'
SRC05 = '05 TPO MA 1/4″ TAPERED ISO + MA TPO'
SRC06 = '06 TPO MA 1/8″ TAPERED ISO + MA TPO'
SRC07 = '07 TPO MA ISO + MA TPO — KICKERS'

# labels for numbers that travel between scopes (shown as blue cells when a page runs alone)
SUM_LABELS = {
    'total_sq': 'Total squares  (field + kickers)',
    'kicker_sq': 'Kicker squares',
    'seam_field': 'Field seam plates  (before the x 1.1)',
    'seam_wall': 'Wall + base flashing seam plates  (before the x 1.1)',
    'iso_plates': 'ISO plates  (boards x plates per board)',
    'screws_extra': 'Extra 5″ #15 screws  (Rhinobond plates)',
    'screws_out': 'Screws taken out of the field count  (7″ / 8″ cricket boxes)',
    'screw_pct3': 'Share of the roof on 3″ screws  (tapered tracer)',
    'screw_pct6': 'Share of the roof on 6″ screws  (tapered tracer)',
    'adhesive_sq': 'Squares that get bonding adhesive',
    'wall_lf': 'Parapet wall LF  (walls with a developed height)',
    'perim_lf': 'Building perimeter LF  (walls marked IN PERIMETER = Y)',
    'wall_sf': 'Wall face  (sq ft)',
    'wall_sq': 'Wall squares',
    'curb_lf': 'Curb flashing LF',
    'hatches': 'Roof hatches',
    'gs_lf': 'Gravel stop LF',
}

QUARTER = 'quarter'


def tpo_basics():
    s = Scope('tpo_basics', 'TPO roof', 'TPO ROOF  —  every TPO roof buys this',
              'The buys every TPO roof makes no matter what else is on it: one seam plate buy, one screw buy, one adhesive buy, '
              'the consumables that run off total squares, and delivery. Every other scope page feeds its share in here.',
              SRC03, 'TPO — every roof',
              provides={'total_sq': ('Total squares  (field + kickers)', '{total_sq}')})
    s.h('1 · SQUARES')
    s.calc('field_sq', 'Field squares', 'IFERROR(IF({job.field_sf}="","",ROUNDUP(N({job.field_sf})/100,0)),"")', 'sq',
           'Job page field sq ft ÷ 100, rounded UP')
    s.link('kicker_sq', 'Kicker squares', 'kicker_sq', 'sq', 'from the Kickers page — ISO only, but it is roof')
    s.calc('total_sq', 'TOTAL SQUARES  (field + kickers)', 'N({field_sq})+N({kicker_sq})', 'sq',
           'walls are NOT in this number — they price on their own')
    s.h('2 · FASTENER LENGTH  —  falls out of the deck, never typed')
    s.calc('fl', 'Field fastener LENGTH',
           'IFERROR(ROUNDUP(N({job.insul_thk})+N({job.cover_thk})+IF(UPPER({job.deck})="WOOD",0.5,0)+1,0),"")', 'in',
           'insulation + cover boards + (wood deck +½″, metal +0) + 1″ through the deck, rounded up')
    s.calc('fg', 'Field fastener GAUGE', 'IFERROR(IF(UPPER({job.deck})="METAL",15,14),"")', 'gauge',
           'metal deck takes a #15; wood takes a #14')
    s.h('3 · SEAM PLATES  —  every seam plate on the roof is the same plate, bought as one number')
    s.link('seam_field', 'Field seam plates  (rolls, boots, pans)', 'seam_field', 'plate',
           'TPO membrane page (rolls x plates per roll) + pipe boots x 4 + pitch pans x 4')
    s.link('seam_wall', 'Wall seam plates  (wall rows + base flashing)', 'seam_wall', 'plate',
           'Walls page fastener rows + Base flashing page')
    s.calc('fp', '   field plates  x 1.1', 'N({seam_field})*1.1', 'plate', '', fmt='#,##0.00')
    s.calc('wp', '   wall plates  x 1.1', 'N({seam_wall})*1.1', 'plate', '', fmt='#,##0.00')
    s.cols('Item', 'Driver', 'Unit', 'Per box', 'RAW', 'QTY', 'Pkg', '$ each', 'Line $', 'How it is figured')
    s.buy('seam_plates', 'Seam plates', '{fp}+{wp}', 1000, '/', driver_unit='plate', price='Seam plates',
          note='="All of it added up, then x 1.1 = "&TEXT(N({fp})+N({wp}),"#,##0")&" seam plates — one number, one buy."')
    s.h('4 · ISO PLATES')
    s.link('iso_plates', 'ISO plates  (boards x plates per board)', 'iso_plates', 'plate', 'ISO and Kickers pages')
    s.cols('Item', 'Driver', 'Unit', 'Per box', 'RAW', 'QTY', 'Pkg', '$ each', 'Line $', 'How it is figured')
    s.buy('isop', 'ISO plates', '{iso_plates}', 500, '/', driver_unit='plate', price='ISO plates',
          note='="ISO plates bought = "&TEXT(N({iso_plates}),"#,##0")&" plates, 500 a box."')
    s.h('5 · SCREWS  —  one screw per plate')
    s.link('xs', 'Extra 5″ #15 screws  (Rhinobond plates)', 'screws_extra', 'screw', 'Rhinobond page — one #15 per Rhinobond plate')
    s.link('out', 'Screws out of the field count  (7″ / 8″ cricket boxes)', 'screws_out', 'screw',
           'Crickets page — those boxes come OUT of the field count, not on top of it')
    s.link('p3', 'Share of the roof on 3″ screws', 'screw_pct3', '%', 'Tapered page tracer split — 0 on a flat roof')
    s.link('p6', 'Share of the roof on 6″ screws', 'screw_pct6', '%', 'Tapered page tracer split — 0 on a flat roof')
    s.calc('fsc', 'Field screws  (ISO plates + field seam plates)', 'N({iso_plates})+N({fp})', 'screw',
           'ISO plates (no overage) + field seam plates (x 1.1)', fmt='#,##0')
    s.cols('Item', 'Driver', 'Unit', 'Per box', 'RAW', 'QTY', 'Pkg', '$ each', 'Line $', 'How it is figured')
    s.buy('scr_field', 'Fasteners  —  field', '{fsc}', 500, '/', driver_unit='screw', price='Fasteners  —  field',
          raw='IFERROR(IF(N({fsc})+N({xs})=0,"",(ROUNDUP(N({fsc})*(1-N({p3})-N({p6})),0)+N({xs})-N({out}))/N({scr_field.factor})),"")',
          note='="Field "&TEXT(N({fl}),"0")&"″ #"&TEXT(N({fg}),"0")&":  "&TEXT(ROUNDUP(N({fsc})*(1-N({p3})-N({p6})),0)+N({xs})-N({out}),"#,##0")&" screws, 500 a box."')
    s.buy('scr_6', 'Fasteners  —  field 6″', '{fsc}', 500, '/', driver_unit='screw', price='Fasteners  —  field 6″',
          raw='IFERROR(IF(N({p6})=0,"",ROUNDUP(N({fsc})*N({p6}),0)/N({scr_6.factor})),"")',
          note='tapered roofs only — the deep part of the taper')
    s.buy('scr_3', 'Fasteners  —  walls + base flashing  (3″ #14)', '{wp}', 1000, '/', driver_unit='screw',
          price='Fasteners  —  walls + base flashing',
          raw='IFERROR(IF(N({wp})+N({p3})=0,"",(N({wp})+ROUNDUP(N({fsc})*N({p3}),0))/N({scr_3.factor})),"")',
          note='="Walls and base flashing "&TEXT(N({wp}),"#,##0")&" + tapered field 3″ "&TEXT(ROUNDUP(N({fsc})*N({p3}),0),"#,##0")&" — 3″ screws are ONE buy, 1000 a box."')
    s.h('6 · ADHESIVE  —  bonding adhesive, rollers and cages run on the squares that get glued')
    s.link('adh', 'Squares that get bonding adhesive', 'adhesive_sq', 'sq',
           'walls + curbs (curb LF x 2 ft ÷ 100) — plus the whole field on a fully adhered roof')
    s.cols('Item', 'Driver', 'Unit', 'Divisor', 'RAW', 'QTY', 'Pkg', '$ each', 'Line $', 'How it is figured')
    s.buy('bond', 'Bonding adhesive', '{adh}', 3, '/', driver_unit='sq', price='Bonding adhesive', note='squares per pail')
    s.buy('rollers', 'Rollers', '{adh}', 3, '/', driver_unit='sq', price='Rollers', note='one roller every 3 squares of adhesive')
    s.buy('cages', 'Cages', '{adh}', 3, '/', driver_unit='sq', price='Cages', note='one cage every 3 squares of adhesive')
    s.h('7 · CONSUMABLES  —  every one is TOTAL SQUARES ÷ DIVISOR')
    s.cols('Item', 'Driver', 'Unit', 'Divisor', 'RAW', 'QTY', 'Pkg', '$ each', 'Line $', 'How it is figured')
    for k, lab, d, rnd, pr, n in [
        ('unsup', 'Unsupported flashing', 150, QUARTER, 'Unsupported flashing', 'one roll every 150 squares'),
        ('cleaner', 'TPO cleaner 5g', 50, QUARTER, 'TPO cleaner 5g', 'one 5-gallon can every 50 squares'),
        ('tj', 'TPO T-joints', 100, QUARTER, 'TPO T-joints', 'one box of 100 every 100 squares'),
        ('ces', 'TPO cut-edge sealant', 20, QUARTER, 'TPO cut-edge sealant', '5 tubes every 100 squares'),
        ('lvoc', 'TPO LVOC all-purpose', 10, 'up', 'TPO LVOC all-purpose', 'one tube every 10 squares'),
        ('wb', 'Water block', 10, 'up', 'Water block', 'same as the LVOC on this system'),
        ('rags', 'Rags', 30, 'up', 'Rags', 'one box every 30 squares — new construction'),
        ('hose', 'Hose clamps', 300, 'up', 'Hose clamps', 'one box every 300 squares'),
        ('sticks', 'Sticks', 50, 'up', 'Sticks', 'one stick every 50 squares'),
    ]:
        s.buy(k, lab, '{total_sq}', d, '/', rnd=rnd, driver_unit='sq', price=pr,
              note=n + ('  ·  a part of .25 or less rounds DOWN' if rnd == QUARTER else ''))
    s.h('8 · DELIVERY  —  on every bid, no exceptions')
    s.cols('Item', 'Driver', 'Unit', 'Factor', 'RAW', 'QTY', 'Pkg', '$ each', 'Line $', 'How it is figured')
    s.buy('mdel', 'Material delivery', '{total_sq}', 50, '/', driver_unit='sq', price='Material delivery',
          note='one delivery every 50 squares')
    s.inp('mtrips', 'Metal delivery  —  trips', 'trips', 1,
          'NORMALLY 1 — it all fits on one truck. Out of town can take more; type the trips here.')
    s.buy('metdel', 'Metal delivery', '{mtrips}', None, '=', driver_unit='trips', price='Metal delivery', note='')
    return s


def iso_flat():
    s = Scope('iso_flat', 'ISO flat', 'ISO  —  FLAT POLYISO, MECHANICALLY ATTACHED',
              'Squares x 3 = boards. Flat. 100 squares is 300 boards — no waste factor, because in the field those boards never get cut.',
              SRC03, 'TPO — insulation',
              provides={'iso_plates': ('ISO plates', '{isoplates}')})
    s.calc('sq', 'Field squares', 'IFERROR(IF({job.field_sf}="","",ROUNDUP(N({job.field_sf})/100,0)),"")', 'sq', 'Job page field ÷ 100, rounded UP')
    s.cols('Item', 'Driver', 'Unit', 'Factor', 'RAW', 'QTY', 'Pkg', '$ each', 'Line $', 'How it is figured')
    s.buy('poly', 'Polyiso  —  field of the roof', '{sq}', 3, 'x', driver_unit='sq', price='Polyiso  —  field of the roof',
          note='="3 boards a square. Flat — no waste added.   "&TEXT(N({sq}),"0")&" sq x 3 = "&TEXT(N({poly.qty}),"0")&" boards"')
    s.calc('isoplates', 'ISO plates  (goes to the TPO roof page)', 'IFERROR(N({poly.qty})*N({job.iso_ppb}),"")', 'plate',
           'boards x ISO plates per board (Job page) — bought once, on the TPO roof page', fmt='#,##0')
    return s


def kickers():
    s = Scope('kickers', 'Kickers', 'KICKERS  —  ISO UNDER THE PERIMETER KICKERS',
              'The perimeter kicker zone is ISO only. Kicker run and rise go on the Walls page, one per wall — the developed height picks them up there.',
              SRC07, 'TPO — insulation',
              provides={'kicker_sq': ('Kicker squares', '{ksq}'), 'iso_plates': ('ISO plates', '{kplates}')})
    s.inp('ksf', 'Under kickers', 'sf', None, 'perimeter kicker zone — ISO only')
    s.calc('ksq', 'Kicker squares', 'IFERROR(IF({ksf}="","",ROUNDUP(N({ksf})/100,0)),"")', 'sq', 'rounded UP')
    s.cols('Item', 'Driver', 'Unit', 'Factor', 'RAW', 'QTY', 'Pkg', '$ each', 'Line $', 'How it is figured')
    s.buy('kpoly', 'Polyiso  —  under kickers', '{ksq}', 3, 'x', driver_unit='sq', price='Polyiso  —  under kickers',
          note='="Same 3 a square, counted on its own.   "&TEXT(N({ksq}),"0")&" sq x 3 = "&TEXT(N({kpoly.qty}),"0")&" boards"')
    s.calc('kplates', 'ISO plates  (goes to the TPO roof page)', 'IFERROR(N({kpoly.qty})*N({job.iso_ppb}),"")', 'plate',
           'boards x ISO plates per board', fmt='#,##0')
    labor_header(s)
    s.labor('lk', 'ISO under kickers', '{ksq}', 'sq')
    return s


def crickets():
    s = Scope('crickets', 'Crickets', 'CRICKETS  —  Q BOARD',
              'THE LAYOUT WINS: if the tracer drew the crickets, its board count is the number. Only when there is no layout does the '
              'cricket LF run: read it like the pitch of a roof — LF x 1.2 ÷ 4 ft board.',
              f'{SRC03} (LF rule) · {SRC01} (layout wins, 7″/8″ boxes)', 'TPO — insulation',
              provides={'screws_out': ('Screws out of the field count', '{outs}')})
    s.inp('layout', 'Q board FROM THE LAYOUT  (tracer count)', 'board', None, 'if the tracer drew it, this number wins')
    s.inp('clf', 'Length of cricket wall', 'LF', None, 'the scupper wall — only used when there is no layout')
    s.cols('Item', 'Driver', 'Unit', 'Pitch factor', 'RAW', 'QTY', 'Pkg', '$ each', 'Line $', 'How it is figured')
    s.buy('q', 'Q board', '{clf}', 1.2, 'x', driver_unit='LF', price='Q board',
          raw='IFERROR(IF({layout}<>"",N({layout}),IF({clf}="","",N({clf})*N({q.factor})/4)),"")',
          note='=IF({layout}<>"","From the layout: "&TEXT(N({layout}),"0")&" boards","Cricket wall "&TEXT(N({clf}),"#,##0")&" LF x "&TEXT(N({q.factor}),"0.0")&" ÷ 4 ft board = "&TEXT(N({q.qty}),"0")&" boards")')
    s.h('SCREWS FOR THE CRICKETS  —  these boxes come OUT of the field count, not on top of it')
    s.cols('Item', 'Boxes', 'Unit', 'Per box', 'RAW', 'QTY', 'Pkg', '$ each', 'Line $', 'How it is figured')
    s.buy('s7', 'Seam fasteners  #15  —  7"', '', 500, '=', rnd='none', price='Seam fasteners  #15  —  7"',
          raw='IFERROR(IF({s7.driver}="","",N({s7.driver})),"")',
          note='for the crickets — the crickets build the insulation up and a 5 in. screw stops short')
    s.buy('s8', 'Seam fasteners  #15  —  8"', '', 500, '=', rnd='none', price='Seam fasteners  #15  —  8"',
          raw='IFERROR(IF({s8.driver}="","",N({s8.driver})),"")', note='for the deepest part of the crickets')
    s.calc('outs', 'Screws taken out of the field count', '(N({s7.qty})+N({s8.qty}))*500', 'screw',
           'goes to the TPO roof page', fmt='#,##0')
    return s


def tpo_ma():
    s = Scope('tpo_ma', 'TPO MA', 'TPO  —  MECHANICALLY ATTACHED  ·  60-MIL  ·  5 FT ROLLS',
              'A true 5 ft roll gives 5 squares. On a mechanically attached system 6 inches of it is the selvage edge — that is what gets '
              'fastened down and lapped over, so 10% of every roll is gone before waste.',
              SRC03, 'TPO — membrane',
              provides={'seam_field': ('Field seam plates', '{rollplates}')})
    s.calc('sq', 'Field squares', 'IFERROR(IF({job.field_sf}="","",ROUNDUP(N({job.field_sf})/100,0)),"")', 'sq', 'Job page field ÷ 100, rounded UP')
    s.cols('Item', 'Driver', 'Unit', 'Waste %', 'RAW', 'QTY', 'Pkg', '$ each', 'Line $', 'How it is figured')
    s.buy('fm', "TPO field membrane 5'", '{sq}', 0.1, 'x', driver_unit='sq', price="TPO field membrane 5'",
          raw='IFERROR(IF(OR({fm.driver}="",{fm.factor}=""),"",N({fm.driver})*(1+0.1+N({fm.factor}))/5),"")',
          note='="5 ft roll = 5 squares. 10% selvage + "&TEXT(N({fm.factor}),"0%")&" waste.   "&TEXT(N({sq}),"0")&" sq x "&TEXT(1.1+N({fm.factor}),"0.00")&" ÷ 5 = "&TEXT(N({fm.qty}),"0")&" rolls"')
    s.calc('ppr', 'Seam plates per roll', 'IFERROR(IF(N({job.field_seam})=0,"",100/(N({job.field_seam})/12)),"")', 'plate',
           'a roll is 100 ft long — 12″ o.c. is 100 plates a roll, 6″ doubles it')
    s.calc('rollplates', 'Field seam plates  (goes to the TPO roof page)', 'IFERROR(N({fm.qty})*N({ppr}),0)', 'plate',
           'rolls x plates per roll — the x 1.1 happens on the TPO roof page', fmt='#,##0')
    labor_header(s)
    s.labor('lf', 'Field', '{sq}', 'sq')
    s.labor('lfd', 'Field details', '{sq}', 'sq')
    return s


def tpo_fa():
    s = Scope('tpo_fa', 'TPO FA', 'TPO  —  FULLY ADHERED  ·  60-MIL  ·  10 FT ROLLS',
              'FULLY ADHERED — the field takes 10 ft sheets over the whole field and is glued, not fastened: no seam plates in the field. '
              'A 10 ft roll is 10 squares. 5% salvage edge + waste of the 10 ft sheet. Under 30 squares the field rounds to the half roll.',
              SRC04, 'TPO — membrane',
              provides={'adhesive_sq': ('Squares that get bonding adhesive', '{sq}')})
    s.calc('sq', 'Field squares', 'IFERROR(IF({job.field_sf}="","",ROUNDUP(N({job.field_sf})/100,0)),"")', 'sq', 'Job page field ÷ 100, rounded UP')
    s.cols('Item', 'Driver', 'Unit', 'Waste %', 'RAW', 'QTY', 'Pkg', '$ each', 'Line $', 'How it is figured')
    s.buy('fm', "TPO field membrane 10'", '{sq}', 0.1, 'x', driver_unit='sq', price="TPO field membrane 10'",
          raw='IFERROR(IF(OR({fm.driver}="",{fm.factor}=""),"",N({fm.driver})*(1+(0.5/10)+N({fm.factor}))/10),"")',
          qty='IFERROR(IF({fm.raw}="","",IF(N({sq})<30,CEILING({fm.raw},0.5),ROUNDUP({fm.raw},0))),"")',
          note='="10 ft roll = 10 squares. 5% salvage edge + "&TEXT(N({fm.factor}),"0%")&" waste.   "&TEXT(N({sq}),"0")&" sq = "&TEXT(N({fm.qty}),"0.0")&" rolls"')
    s.note('The field squares also go to the TPO roof page for bonding adhesive, rollers and cages — the field takes the same adhesive as the walls.')
    labor_header(s)
    s.labor('lf', 'Field', '{sq}', 'sq')
    s.labor('lfd', 'Field details', '{sq}', 'sq')
    return s


def tpo_rhinobond():
    s = Scope('tpo_rhinobond', 'TPO Rhinobond', 'TPO  —  RHINOBOND  (INDUCTION-WELDED)  ·  10 FT ROLLS',
              'The membrane is welded to the plates, so wind uplift lives in the plate layout: 6 plates a board in the field, '
              '10 a board inside the perimeter band, x 1.1. Every plate takes a 5″ #15. Field is all 10 ft rolls — no seam screws in the field.',
              SRC02, 'TPO — membrane',
              provides={'screws_extra': ('Extra 5″ #15 screws', '{rb.raw}')})
    s.calc('sq', 'Field squares', 'IFERROR(IF({job.field_sf}="","",ROUNDUP(N({job.field_sf})/100,0)),"")', 'sq', 'Job page field ÷ 100, rounded UP')
    s.cols('Item', 'Driver', 'Unit', 'Waste %', 'RAW', 'QTY', 'Pkg', '$ each', 'Line $', 'How it is figured')
    s.buy('fm', "TPO field membrane 10'", '{sq}', 0.1, 'x', driver_unit='sq', price="TPO field membrane 10'",
          raw='IFERROR(IF(OR({fm.driver}="",{fm.factor}=""),"",N({fm.driver})*(1+(0.5/10)+N({fm.factor}))/10),"")',
          note='10 ft roll = 10 squares — 5% salvage edge + waste')
    s.h('PERIMETER BAND  —  where the plates go 10 a board')
    s.inp('band', 'Perimeter band width', 'ft', None, 'VARIABLE — how far in from the edge the 10-a-board plate zone runs on THIS roof')
    s.inp('run', 'Perimeter run  (gravel stop LF)', 'LF', None, 'the roof edge the band runs along')
    s.calc('psf', 'Perimeter area', 'IFERROR(IF(OR({band}="",{run}=""),"",N({band})*N({run})),"")', 'sf', 'run x band width')
    s.calc('psq', 'Perimeter squares', 'IFERROR(IF({psf}="","",ROUNDUP(N({psf})/100,0)),"")', 'sq', 'rounded UP')
    s.inp('bps', 'Boards per square', 'board', 3, 'same 3 a square as the polyiso')
    s.cols('Item', 'Driver', 'Unit', 'Per box', 'RAW', 'QTY', 'Pkg', '$ each', 'Line $', 'How it is figured')
    s.buy('rb', 'Rhinobond plates', '{sq}', 500, '/', driver_unit='sq', price='Rhinobond plates',
          raw='IFERROR((MAX(0,N({sq})-N({psq}))*N({bps})*6+N({psq})*N({bps})*10)*1.1,"")',
          qty='IFERROR(IF({rb.raw}="","",ROUNDUP(N({rb.raw})/N({rb.factor}),0)),"")',
          note='="Field "&TEXT(MAX(0,N({sq})-N({psq})),"0")&" sq x 3 x 6  +  perimeter "&TEXT(N({psq}),"0")&" sq x 3 x 10, all x 1.1 = "&TEXT(N({rb.raw}),"#,##0")&" plates (RAW is plates; QTY is boxes of 500)"')
    labor_header(s)
    s.labor('lf', 'Field', '{sq}', 'sq')
    s.labor('lrb', 'Rhinobond', '{sq}', 'sq')
    s.labor('lfd', 'Field details', '{sq}', 'sq')
    return s


def walls():
    s = Scope('walls', 'Walls', 'PARAPET WALLS  —  WALL MEMBRANE + WALL FASTENING',
              'DEVELOPED = kicker face (if any) + the parapet above it + the cap width. That is the face the membrane has to cover. '
              'Mark IN PERIMETER = N for anything that is not the building (a dumpster enclosure carries coping but is not the perimeter).',
              f'{SRC03} · kicker run/rise from {SRC07}', 'TPO — walls & edges',
              provides={'wall_sq': ('Wall squares', '{wsq}'), 'adhesive_sq': ('Adhesive squares', '{wsq}'),
                        'seam_wall': ('Wall seam plates', '{wfast}'), 'wall_lf': ('Parapet wall LF', '{len_total}'),
                        'perim_lf': ('Building perimeter LF', '{perim_total}'), 'wall_sf': ('Wall face sq ft', '{sqft_total}')})
    s.table('w', 8, [
        ('len', 'Length (ft)', 'in', None),
        ('par', 'Parapet above deck (ft)', 'in', None),
        ('cap', 'Cap width (ft)', 'in', None),
        ('kr', 'Kicker run (ft)', 'in', None),
        ('kz', 'Kicker rise (ft)', 'in', None),
        ('dev', 'DEVELOPED (ft)', 'f', 'IFERROR(IF(AND({par[i]}="",{cap[i]}=""),"",SQRT(N({kr[i]})^2+N({kz[i]})^2)+MAX(0,N({par[i]})-N({kz[i]}))+N({cap[i]})),"")'),
        ('sqft', 'Sq Ft', 'f', 'IFERROR(IF(OR({len[i]}="",{dev[i]}=""),0,N({len[i]})*N({dev[i]})),"")'),
        ('perim', 'In perimeter?  (Y/N)', 'in', None),
        ('rows', 'Rows of fasteners', 'f', 'IFERROR(IF(OR({dev[i]}="",N({job.sheet_width})=0),"",MAX(0,ROUNDDOWN((N({dev[i]})-N({cap[i]})-N({var}))/N({job.sheet_width}),0))),"")'),
        ('fast', 'Fasteners', 'f', 'IFERROR(IF(OR({len[i]}="",{rows[i]}="",N({job.wall_spacing})=0),"",N({rows[i]})*N({len[i]})/(N({job.wall_spacing})/12)),"")'),
    ], total={'len': 'IFERROR(SUMIF({dev:range},">0",{len:range}),"")', 'sqft': 'IFERROR(SUM({sqft:range}),"")',
              'perim': 'IFERROR(SUMIFS({len:range},{perim:range},"Y"),"")', 'fast': 'IFERROR(IF(COUNT({fast:range})=0,"",SUM({fast:range})),"")'})
    s.note('Rows = the WALL run (developed, no cap) ÷ the sheet width — a seam every sheet width, LAW — dropping any row that lands inside the variance of the top. '
           'Fasteners = rows x length ÷ (spacing ÷ 12).  The cap is NOT in the run: the membrane goes over the cap and terminates.')
    s.inp('var', 'Variance off the top', 'ft', 2, 'a row that lands inside this of the top is not worth putting in. 11 ft wall = 1 row, 12 ft wall = 2.')
    s.calc('wsq', 'Wall squares', 'IFERROR(ROUNDUP(N({sqft_total})/100,0),"")', 'sq', 'total wall sq ft ÷ 100, rounded UP')
    s.calc('wfast', 'Wall fasteners  (goes to the TPO roof page as seam plates)', 'IFERROR(N({fast_total}),0)', 'ea',
           'one plate per fastener — the x 1.1 happens on the TPO roof page', fmt='#,##0')
    s.cols('Item', 'Driver', 'Unit', 'Waste %', 'RAW', 'QTY', 'Pkg', '$ each', 'Line $', 'How it is figured')
    s.buy('wm', "TPO wall membrane 5'", '{wsq}', 0.15, 'x', driver_unit='sq', price="TPO wall membrane 5'",
          raw='IFERROR(IF(OR({wm.driver}="",{wm.factor}=""),"",N({wm.driver})*(1+0.1+N({wm.factor}))/5),"")',
          note='="Same roll. Walls take "&TEXT(N({wm.factor}),"0%")&" for cuts.   "&TEXT(N({wsq}),"0")&" sq x "&TEXT(1.1+N({wm.factor}),"0.00")&" ÷ 5 = "&TEXT(N({wm.qty}),"0")&" rolls"')
    labor_header(s)
    s.labor('lw', 'Walls', '{wsq}', 'sq')
    s.labor('lwd', 'Wall details', '{wsq}', 'sq')
    return s


# keys the walls table publishes (len_total etc.) are table totals
def _fix_wall_keys(s):
    return s


def base_flashing():
    s = Scope('base_flashing', 'Base flashing', 'PERIMETER BASE FLASHING  —  3″ #14 + SEAM PLATE',
              'Perimeter base flashing = the parapet wall total + the curb flashing. Curb flashing and wall base flashing are the same thing — '
              'never count the curb a second time in seam plates.',
              f'{SRC03} (10/8/26 rule)', 'TPO — walls & edges',
              provides={'seam_wall': ('Base flashing seam plates', '{bff}')})
    s.link('wlf', 'Parapet wall LF', 'wall_lf', 'LF', 'Walls page — walls with a developed height')
    s.link('clf', 'Curb flashing LF', 'curb_lf', 'LF', 'Curbs page')
    s.calc('drv', 'Base flashing run', 'N({wlf})+N({clf})', 'LF', 'parapet wall total + curb flashing')
    s.calc('bff', 'Base flashing fasteners  (goes to the TPO roof page)',
           'IFERROR(IF(OR(N({drv})=0,N({job.bf_spacing})=0),0,ROUNDUP(N({drv})/(N({job.bf_spacing})/12),0)),0)', 'ea',
           '="Base flashing "&TEXT(N({drv}),"#,##0")&" LF at "&TEXT(N({job.bf_spacing}),"0")&"″ o.c. = "&TEXT(N({bff}),"#,##0")&" fasteners and the same number of seam plates"',
           fmt='#,##0')
    return s


def curbs():
    s = Scope('curbs', 'Curbs', 'CURB FLASHING',
              'Total curb perimeter off the takeoff — every curb added up. The COUNT drives the corners: 4 on every curb.',
              SRC03, 'TPO — roof items',
              provides={'curb_lf': ('Curb flashing LF', '{clf}'), 'adhesive_sq': ('Curb adhesive squares', '{csq}')})
    s.inp('clf', 'Curb flashing', 'LF', None, 'total curb perimeter — every curb added up')
    s.inp('cnt', 'Curbs  (count)', 'ea', None, 'drives the corners')
    s.inp('ch', 'Curb flashing height', 'ft', 2, 'turns the curb LF into square feet for the adhesive')
    s.calc('csq', 'Curb squares for adhesive  (goes to the TPO roof page)', 'IFERROR(N({clf})*N({ch})/100,0)', 'sq', 'curb LF x height ÷ 100', fmt='0.00')
    s.cols('Item', 'Driver', 'Unit', 'Factor', 'RAW', 'QTY', 'Pkg', '$ each', 'Line $', 'How it is figured')
    s.buy('corners', 'TPO corners', '{cnt}', 4, 'x', driver_unit='curbs', price='TPO corners',
          note='4 corners on every curb. Unsupported still carries the odd details.')
    labor_header(s)
    s.labor('lc', 'Curb flashing', '{clf}', 'LF', mode='unit')
    return s


def pitch_pans():
    s = Scope('pitch_pans', 'Pitch pans', 'PITCH PANS',
              'One pocket per pitch pan, one kit of pourable sealer every 2 pockets, 4 seam plates each.',
              SRC03, 'TPO — roof items',
              provides={'seam_field': ('Pitch pan seam plates', '{pp}')})
    s.inp('n', 'Pitch pans', 'ea', None, '')
    s.cols('Item', 'Driver', 'Unit', 'Factor', 'RAW', 'QTY', 'Pkg', '$ each', 'Line $', 'How it is figured')
    s.buy('pk', 'Pitch pockets', '{n}', 1, 'x', driver_unit='ea', price='Pitch pockets', note='one pocket per pitch pan')
    s.buy('ps', 'Pourable sealer', '{n}', 2, '/', driver_unit='ea', price='Pourable sealer', note='one kit every 2 pitch pockets')
    s.calc('pp', 'Seam plates  (goes to the TPO roof page)', 'N({n})*4', 'plate', '4 a pan')
    labor_header(s)
    s.labor('lp', 'Pitch pans', '{n}', 'ea', mode='unit')
    return s


def pipe_boots():
    s = Scope('pipe_boots', 'Pipe boots', 'PIPE BOOTS',
              'One molded boot per pipe, 4 seam plates each.', SRC03, 'TPO — roof items',
              provides={'seam_field': ('Pipe boot seam plates', '{bp}')})
    s.inp('n', 'Pipe boots', 'ea', None, '')
    s.cols('Item', 'Driver', 'Unit', 'Factor', 'RAW', 'QTY', 'Pkg', '$ each', 'Line $', 'How it is figured')
    s.buy('mb', 'TPO molded pipe boots', '{n}', 1, 'x', driver_unit='ea', price='TPO molded pipe boots', note='one molded boot per pipe')
    s.calc('bp', 'Seam plates  (goes to the TPO roof page)', 'N({n})*4', 'plate', '4 a boot')
    labor_header(s)
    s.labor('lb', 'Pipe boots', '{n}', 'ea', mode='unit')
    return s


def roof_hatch():
    s = Scope('roof_hatch', 'Roof hatch', 'ROOF HATCH ASSEMBLY  —  hatch, safety post and railing are three separate buys',
              'Price here is BRAND and SIZE driven — a Bilco is not a Babcock-Davis, and 30x36 is not 48x48. If the GC changes the hatch, only the price cells move.',
              SRC03, 'TPO — roof items',
              provides={'hatches': ('Roof hatches', '{n}')})
    s.inp('n', 'Roof hatches', 'ea', None, '')
    s.cols('Item', 'Driver', 'Unit', 'Per hatch', 'RAW', 'QTY', 'Pkg', '$ each', 'Line $', 'How it is figured')
    s.buy('h', 'Roof hatch', '{n}', 1, 'x', driver_unit='hatch', price='Roof hatch', note='one hatch per opening')
    s.buy('post', 'Safety ladder-up post', '{n}', 1, 'x', driver_unit='hatch', price='Safety ladder-up post',
          note='almost always required — set to 0 if the spec does not call for it')
    s.buy('rail', 'Railing / guardrail set', '{n}', None, 'x', driver_unit='hatch', price='Railing / guardrail set',
          note='NOT always required — set to 1 per hatch when the spec calls for it')
    s.buy('br', 'Backer rod', '{n}', 1, '/', driver_unit='hatch', price='Backer rod', note='one bag per roof hatch')
    return s


def walkpads():
    s = Scope('walkpads', 'Walkpads', 'WALKPADS  —  a roll is 50 ft; partial rolls buy in quarters',
              'A roof hatch always needs walkpad. Plan LF + 10 ft per hatch = what you actually need. Then: up to a quarter of a roll buys a quarter, '
              'up to a half buys a half, anything over buys the whole roll.',
              SRC03, 'TPO — roof items')
    s.inp('lf', 'Walkpad from the roof plan', 'LF', None, '')
    s.link('hat', 'Hatches on this roof', 'hatches', 'ea', 'Roof hatch page')
    s.inp('ph', 'Walkpad per roof hatch', 'LF', 10, 'added automatically for every hatch')
    s.calc('need', 'TOTAL walkpad needed', 'N({lf})+N({hat})*N({ph})', 'LF', 'plan LF + hatch allowance')
    s.cols('Item', 'Driver', 'Unit', 'Roll length', 'RAW', 'QTY', 'Pkg', '$ each', 'Line $', 'How it is figured')
    s.buy('wp', 'Walkpad', '{need}', 50, '/', rnd='walkpad', driver_unit='LF', price='Walkpad',
          note='full rolls, then the partial rounded UP to a quarter / half / whole')
    return s


def _metal(sid, tab, title, sub, price_metal, price_prefab, price_cleat, cleat_default, cleat_so_formula,
           labor_lab, cleat_lab, extra=None):
    s = Scope(sid, tab, title, sub, SRC03, 'Metal',
              provides={'gs_lf': ('Gravel stop LF', '{len_total}')} if sid == 'gravel_stop' else {})
    s.inp('fab', 'Fabricate in-house?', 'Y / N', 'Y', 'if N — who supplies it. It buys by the foot instead (prefab line).')
    s.inp('tk', 'From my takeoff (LF)', 'LF', None, 'the LF this piece shows on the takeoff app — the table builds its own; the two should agree')
    s.table('m', 8, [
        ('len', 'Length (ft)', 'in', None),
        ('so', 'Stretch-out (in)', 'in', None),
        ('st', 'Strips', 'f', 'IFERROR(IF(UPPER({fab})<>"Y","",IF({so[i]}="","",ROUNDDOWN(48/N({so[i]}),0))),"")'),
        ('fps', 'Ft / sheet', 'f', 'IFERROR(IF(UPPER({fab})<>"Y","",IF({st[i]}="","",N({st[i]})*10)),"")'),
        ('raw', 'RAW sheets', 'f', 'IFERROR(IF(UPPER({fab})<>"Y","",IF(OR({len[i]}="",{fps[i]}="",N({fps[i]})=0),"",N({len[i]})/N({fps[i]}))),"")'),
        ('sh', 'Sheets', 'f', 'IFERROR(IF(UPPER({fab})<>"Y","",IF({raw[i]}="","",ROUNDUP({raw[i]},0))),"")'),
    ], total={'len': 'IFERROR(IF(COUNT({so:range})=0,"",SUMIF({so:range},"<>",{len:range})),"")',
              'raw': 'IFERROR(IF(COUNT({raw:range})=0,"",SUM({raw:range})),"")',
              'sh': 'IFERROR(IF(OR(UPPER({fab})<>"Y",COUNT({sh:range})=0),"",SUM({sh:range})),"")'},
        label_fmt='Wall {i}')
    s.note('48 ÷ stretch-out = strips across (round DOWN) · x 10 = ft per sheet · LF ÷ that = sheets (round UP). LF counts only rows with a stretch-out. '
           'Rows line up with Wall 1–8 on the Walls page.')
    s.check('tkck', 'Takeoff LF vs this table', 'OR({tk}="",ROUND(N({tk})-N({len_total}),2)=0)', 'OK when the two agree (or no takeoff LF typed)')
    s.h('CLEAT  —  its own metal, its own stretch-out, its own sheets')
    s.inp('cl', 'Cleat?', 'Y / N', cleat_default,
          'LAW — coping always gets one' if sid == 'coping' else 'needs a cleat at a face over 3½″')
    if cleat_so_formula:
        s.calc('cso', 'Cleat stretch-out', 'IFERROR(IF(MAX({so:range})=0,"",MAX({so:range})),"")', 'in',
               'LAW — the cleat runs the SAME stretch-out as the coping')
    else:
        s.inp('cso', 'Cleat stretch-out', 'in', None, 'asked fresh every job')
    s.calc('cfps', 'Cleat ft / sheet', 'IFERROR(IF({cso}="","",ROUNDDOWN(48/N({cso}),0)*10),"")', 'ft', '')
    s.calc('csh', 'Cleat sheets', 'IFERROR(IF(UPPER({fab})<>"Y","",IF(OR(UPPER({cl})<>"Y",{cfps}="",N({cfps})=0),"",ROUNDUP(N({len_total})/N({cfps}),0))),"")',
           'sheet', 'blanks out if the piece is prefab')
    s.cols('Item', 'Driver', 'Unit', 'Factor', 'RAW', 'QTY', 'Pkg', '$ each', 'Line $', 'How it is figured')
    s.buy('metal', price_metal, '{len_total}', None, '=', driver_unit='LF', price=price_metal,
          raw='IFERROR(IF(UPPER({fab})<>"Y","",{raw_total}),"")', qty='IFERROR(IF(UPPER({fab})<>"Y","",{sh_total}),"")',
          note='="Fabricate: "&TEXT(N({sh_total}),"0")&" sheets (each wall rounds up on its own)"', pkg='sheet')
    s.buy('prefab', price_prefab, '{len_total}', None, '=', driver_unit='LF', price=price_prefab,
          raw='IFERROR(IF(UPPER({fab})="Y","",N({len_total})),"")', qty='IFERROR(IF(UPPER({fab})="Y","",N({len_total})),"")',
          note='only when Fabricate = N — bought by the foot', pkg='LF')
    s.buy('cleat', price_cleat, '{csh}', None, '=', driver_unit='sheet', price=price_cleat,
          raw='IFERROR(IF({csh}="","",N({csh})),"")', note='cleat sheets', pkg='sheet')
    if extra: extra(s)
    labor_header(s)
    s.labor('lm', labor_lab, '{len_total}', 'LF')
    s.labor('lcl', cleat_lab, 'IFERROR(IF(N({csh})=0,"",{len_total}),"")', 'LF')
    s.labor('shop', 'Shop fabrication — flat metal', 'N({sh_total})+N({csh})', 'sheet', mode='shop', travel=False)
    return s


def coping():
    return _metal('coping', 'Coping', 'COPING CAP  +  CLEAT',
                  'Coping ALWAYS gets a cleat — 100% of the time — and its cleat runs the same stretch-out as the coping.',
                  'Coping metal', 'Coping metal  —  prefab, per LF', 'Coping cleat', 'Y', True, 'Coping cap', 'Coping cleat')


def _gs_extra(s):
    s.h('GRAVEL STOP PRIMER, BRUSHES & COVER TAPE  —  run off the gravel stop LF')
    s.cols('Item', 'Driver', 'Unit', 'Divisor', 'RAW', 'QTY', 'Pkg', '$ each', 'Line $', 'How it is figured')
    s.buy('primer', 'Primer', '{len_total}', 300, '/', rnd=QUARTER, driver_unit='LF', price='Primer',
          note='one 3-gallon can every 300 ft of gravel stop  ·  a part of .25 or less rounds DOWN')
    s.buy('brush', 'Brushes', '{len_total}', 50, '/', driver_unit='LF', price='Brushes', note='one brush every 50 ft of gravel stop')
    s.buy('tape', 'TPO cover tape', '{len_total}', 100, '/', driver_unit='LF', price='TPO cover tape', note='100 ft roll — gravel stop LF ÷ 100')


def gravel_stop():
    return _metal('gravel_stop', 'Gravel stop', 'GRAVEL STOP  +  CLEAT',
                  'Gravel stop needs a cleat at a face over 3½″. Primer, brushes and cover tape for the stripping run off the gravel stop LF.',
                  'Gravel stop metal', 'Gravel stop metal  —  prefab, per LF', 'Gravel stop cleat', 'Y', False,
                  'Gravel stop', 'Gravel stop cleat', extra=_gs_extra)


def counter_flashing():
    return _metal('counter_flashing', 'Counter flashing', 'COUNTER FLASHING  +  CLEAT',
                  'Counter flashing gets a cleat only at a face over 3½″ — answer Cleat? on this job.',
                  'Counter flashing metal', 'Counter flashing metal  —  prefab, per LF', 'Counter flashing cleat', None, False,
                  'Counter flashing', 'Counter flashing cleat')


def _gd(sid, tab, title, price_metal, price_prefab, lab):
    s = Scope(sid, tab, title, 'Straight from the takeoff, one line. Add a row only if a job runs two different profiles.',
              SRC03, 'Metal')
    s.inp('lf', 'LF', 'LF', None, '')
    s.inp('so', 'Stretch-out (in)', 'in', None, '')
    s.inp('fab', 'Fabricate?', 'Y / N', 'Y', 'if N — who supplies. Buys by the foot instead.')
    s.calc('st', 'Strips', 'IFERROR(IF(UPPER({fab})<>"Y","",IF({so}="","",ROUNDDOWN(48/N({so}),0))),"")', '', '48 ÷ stretch-out, round DOWN')
    s.calc('fps', 'Ft / sheet', 'IFERROR(IF(UPPER({fab})<>"Y","",IF({st}="","",N({st})*10)),"")', 'ft', 'x 10')
    s.cols('Item', 'Driver', 'Unit', 'Factor', 'RAW', 'QTY', 'Pkg', '$ each', 'Line $', 'How it is figured')
    s.buy('metal', price_metal, '{lf}', None, '=', driver_unit='LF', price=price_metal, pkg='sheet',
          raw='IFERROR(IF(UPPER({fab})<>"Y","",IF(OR({lf}="",{fps}="",N({fps})=0),"",N({lf})/N({fps}))),"")',
          note='LF ÷ ft per sheet, round UP')
    s.buy('prefab', price_prefab, '{lf}', None, '=', driver_unit='LF', price=price_prefab, pkg='LF',
          raw='IFERROR(IF(UPPER({fab})="Y","",N({lf})),"")', note='only when Fabricate = N — bought by the foot')
    labor_header(s)
    s.labor('lm', lab, '{lf}', 'LF')
    s.labor('shop', 'Shop fabrication — flat metal', '{metal.qty}', 'sheet', mode='shop', travel=False)
    return s


def gutters():
    return _gd('gutters', 'Gutters', 'GUTTERS', 'Gutter metal', 'Gutter metal  —  prefab, per LF', 'Gutters')


def downspouts():
    return _gd('downspouts', 'Downspouts', 'DOWNSPOUTS', 'Downspout metal', 'Downspout metal  —  prefab, per LF', 'Downspouts')


def scuppers_collectors():
    s = Scope('scuppers_collectors', 'Scuppers', 'SCUPPERS & COLLECTOR HEADS',
              'FINAL all-in prices each (labor-loaded) — never taxed, never marked up.', SRC03, 'Metal')
    s.inp('sc', 'Scuppers', 'ea', None, '')
    s.inp('ch', 'Collector heads', 'ea', None, '')
    s.cols('Item', 'Driver', 'Unit', 'Factor', 'RAW', 'QTY', 'Pkg', '$ each', 'Line $', 'How it is figured')
    s.buy('s', 'Scuppers', '{sc}', 1, 'x', driver_unit='ea', price='Scuppers', taxable=False)
    s.buy('c', 'Collector heads', '{ch}', 1, 'x', driver_unit='ea', price='Collector heads', taxable=False)
    return s


def tearoff():
    s = Scope('tearoff', 'Tear-off', 'TEAR-OFF  —  EXISTING ROOF, TEAR-OFF LABOR, DUMPSTERS, RETRO DRAINS',
              'Answer the existing roof first. Dumpsters: $700 a dumpster, one load every 10 squares — tear-off only. '
              'On a full bid the dumpsters land on the Totals page under BEFORE THIS GOES OUT (with the misc markup).',
              SRC01, 'Tear-off',
              provides={})
    s.h('EXISTING CONDITIONS')
    s.inp('ctype', 'Construction type', '', 'Tear off', 'Tear off · Recover · Retrofit — Recover is not set yet')
    s.inp('decking', 'Decking', '', None, '')
    s.table('lay', 3, [
        ('rt', 'Roof type', 'in', None), ('att', 'Attachment', 'in', None), ('grav', 'Gravel?', 'in', None),
        ('bd', 'Board', 'in', None), ('batt', 'Board attachment', 'in', None), ('thk', 'Thickness (in)', 'in', None),
    ], label_fmt='Layer {i}')
    s.h('TEAR-OFF')
    s.calc('sq', 'Field squares', 'IFERROR(IF({job.field_sf}="","",ROUNDUP(N({job.field_sf})/100,0)),"")', 'sq', 'Job page field ÷ 100')
    s.link('wsq', 'Wall squares', 'wall_sq', 'sq', 'Walls page')
    s.calc('dumpsters', 'Dumpsters', 'IFERROR(IF(ISNUMBER(SEARCH("TEAR",UPPER({ctype}))),ROUNDUP((N({sq})+N({wsq}))/10,0)*700,0),0)', '$',
           '="$700 a dumpster, one load every 10 squares (field + walls): "&TEXT(ROUNDUP((N({sq})+N({wsq}))/10,0),"0")&" loads"', fmt='$#,##0.00')
    s.inp('drains', 'Existing drains', 'ea', None, '')
    s.cols('Item', 'Driver', 'Unit', 'Per drain', 'RAW', 'QTY', 'Pkg', '$ each', 'Line $', 'How it is figured')
    s.buy('rd', 'Retro drains', 'IF(ISNUMBER(SEARCH("TEAR",UPPER({ctype}))),N({drains}),0)', 1, '/', driver_unit='drains',
          price='Retro drains', note='one retro drain per existing drain, tear-off only')
    labor_header(s)
    s.labor('lt', 'Tear-off', 'IF(ISNUMBER(SEARCH("TEAR",UPPER({ctype}))),{sq},"")', 'sq')
    return s


def concrete_walls():
    s = Scope('concrete_walls_osb', 'Concrete walls', 'CONCRETE WALLS  —  2 x 8 NAILER + 7/16″ OSB',
              'CONCRETE WALLS. A 2 x 8 nailer runs the whole perimeter and 7/16 in. OSB sheathes the wall face, so the membrane and the base flashing '
              'have wood to bite into. ONE SCREW, ONE BUY — the nailer and the OSB take the same 3 in. #14.',
              SRC01, 'TPO — walls & edges')
    s.link('per', 'Building perimeter LF', 'perim_lf', 'LF', 'Walls page — walls marked IN PERIMETER = Y')
    s.link('wsf', 'Wall face', 'wall_sf', 'sf', 'Walls page — total wall sq ft')
    s.cols('Item', 'Driver', 'Unit', 'Factor', 'RAW', 'QTY', 'Pkg', '$ each', 'Line $', 'How it is figured')
    s.buy('nail', '2 x 8 nailer', '{per}', 1, '/', driver_unit='LF', price='2 x 8 nailer', note='the whole perimeter, one continuous nailer')
    s.buy('osb', '7/16" OSB  —  wall face', '{wsf}', 32, '/', driver_unit='sf', price='7/16" OSB  —  wall face', note='a 4 ft x 8 ft sheet covers 32 sf')
    s.inp('spl', 'Nailer screws per LF', 'ea', 1, 'one screw every foot, straight into the concrete wall')
    s.inp('burn', 'Concrete screw burn', '%', 0.3, 'you burn screws drilling concrete — rides on the NAILER screws only, never on the OSB')
    s.inp('spb', 'OSB screws per board', 'ea', 16, '16 fasteners a board')
    s.calc('ns', '3″ #14 — nailer into the concrete', 'N({nail.qty})*N({spl})', 'screw', '', fmt='#,##0')
    s.calc('bs', '3″ #14 — burn on the concrete screws', 'N({ns})*N({burn})', 'screw', '', fmt='#,##0')
    s.calc('os', '3″ #14 — OSB boards', 'N({osb.qty})*N({spb})', 'screw', '', fmt='#,##0')
    s.cols('Item', 'Driver', 'Unit', 'Per box', 'RAW', 'QTY', 'Pkg', '$ each', 'Line $', 'How it is figured')
    s.buy('scr', 'Fasteners  3" #14  —  blocking & sheathing', 'N({ns})+N({bs})+N({os})', 1000, '/', driver_unit='screw',
          price='Fasteners  3" #14  —  blocking & sheathing', note='nailer + burn + OSB add up before anything rounds')
    labor_header(s)
    s.labor('ln', '2 x 8 nailer', '{nail.qty}', 'LF')
    s.labor('lo', '7/16" OSB install', '{osb.qty}', 'sheet', mode='unit')
    return s


def _taper(sid, tab, title, letters, bands, src, prices):
    s = Scope(sid, tab, title,
              'Board counts are typed per level, by letter, straight off the tracer layout — the tracer counts the boards. '
              'The flat base ISO is bought on the ISO page. Section B splits the field screws by how thick the insulation is where they land.',
              src, 'TPO — insulation',
              provides={'screw_pct3': ('3″ share', '{p3}'), 'screw_pct6': ('6″ share', '{p6}')})
    s.h('A · BOARDS BY LEVEL AND LETTER  —  typed off the tracer')
    s.table('lv', 5, [(f'b{j}', L, 'in', None) for j, L in enumerate(letters)],
            total={f'b{j}': f'IFERROR(SUM({{b{j}:range}}),"")' for j in range(len(letters))}, label_fmt='L{i}', head='Level')
    s.cols('Item', 'Boards', 'Unit', '', 'RAW', 'QTY', 'Pkg', '$ each', 'Line $', 'How it is figured')
    for j, L in enumerate(letters):
        s.buy(f'tb{j}', prices[j], f'{{b{j}_total}}', None, '=', driver_unit='board', price=prices[j],
              note=f'L1–L5 added up, rounded UP')
    s.h('B · SCREW LENGTH BY INSULATION THICKNESS  —  area off the tracer')
    s.table('bd', len(bands), [
        ('ar', 'Area (sf)', 'in', None),
        ('pc', '% of roof', 'f', 'IFERROR({ar[i]}/SUM({ar:range}),"")'),
        ('nb', 'Boards (4x8)', 'f', 'IF({ar[i]}="","",ROUNDUP(N({ar[i]})/32,0))'),
        ('pl', 'Plates', 'f', 'IF({nb[i]}="","",N({nb[i]})*N({job.iso_ppb}))'),
        ('sl', 'Screw (in)', 'in', [sl for _, sl in bands]),
    ], total={'ar': 'SUM({ar:range})', 'pc': 'SUM({pc:range})'}, label_fmt=[b for b, _ in bands], head='Insulation at that point')
    s.note('Boards = area ÷ 32 sf (4x8), round up. Plates = boards x plates per board. Screw = the stock screw for that thickness (3″ · 5″ · 6″).')
    s.calc('p3', 'Share of the roof on 3″ screws  (goes to the TPO roof page)', 'IFERROR(SUMIF({sl:range},3,{pc:range}),0)', '%', '', fmt='0.0%')
    s.calc('p6', 'Share of the roof on 6″ screws  (goes to the TPO roof page)', 'IFERROR(SUMIF({sl:range},6,{pc:range}),0)', '%', '', fmt='0.0%')
    return s


def iso_taper_quarter():
    s = _taper('iso_taper_quarter', 'Taper 1-4', 'TAPERED ISO  —  1/4″ PER FOOT', ['X', 'Y', '2" flat (4x4)', '4" flat (4x4)'],
               [('0.5″ – 1.5″', 3), ('1.5″ – 2.5″', 5), ('2.5″ – 3.5″', 5), ('3.5″ – 4.5″', 6), ('4.5″ – 5.5″', 6)], SRC05,
               ['Tapered ISO  —  X', 'Tapered ISO  —  Y', 'Tapered ISO  —  2" flat (4x4)', 'Tapered ISO  —  4" flat (4x4)'])
    return s


def iso_taper_eighth():
    s = _taper('iso_taper_eighth', 'Taper 1-8', 'TAPERED ISO  —  1/8″ PER FOOT', ['AA', 'A', 'B', 'C', '2" flat (4x4)', '4" flat (4x4)'],
               [('0.5″ – 1.0″', 3), ('1.0″ – 1.5″', 3), ('1.5″ – 2.0″', 5), ('2.0″ – 2.5″', 5), ('2.5″ – 3.0″', 5)], SRC06,
               ['Tapered ISO  —  AA', 'Tapered ISO  —  A', 'Tapered ISO  —  B', 'Tapered ISO  —  C',
                'Tapered ISO  —  2" flat (4x4)', 'Tapered ISO  —  4" flat (4x4)'])
    return s


BUILDERS = {
    'tpo_basics': tpo_basics, 'iso_flat': iso_flat, 'iso_taper_quarter': iso_taper_quarter,
    'iso_taper_eighth': iso_taper_eighth, 'kickers': kickers, 'crickets': crickets,
    'tpo_ma': tpo_ma, 'tpo_fa': tpo_fa, 'tpo_rhinobond': tpo_rhinobond, 'tearoff': tearoff,
    'walls': walls, 'base_flashing': base_flashing, 'concrete_walls_osb': concrete_walls,
    'coping': coping, 'gravel_stop': gravel_stop, 'counter_flashing': counter_flashing,
    'gutters': gutters, 'downspouts': downspouts, 'scuppers_collectors': scuppers_collectors,
    'curbs': curbs, 'pitch_pans': pitch_pans, 'pipe_boots': pipe_boots, 'roof_hatch': roof_hatch,
    'walkpads': walkpads,
}
ORDER = list(BUILDERS)

# Scopes that already exist as their own finished templates — used as-is, never rebuilt.
EXISTING = {
    'ledge': ('08 ADD-ON — LEDGE', '1GkYPikUMVwSUS0zfNI59PvAcZ1oni7WRWL8AqtFaj2M'),
    'skirt_flashing': ('09 ADD-ON — SKIRT FLASHING', '16mdUPr9aCm0WROhnBT91nyOxANk42Va2NqL6w2oz3Wk'),
    'counter_flashing_addon': ('10 ADD-ON — COUNTER FLASHING', '1or0oEB-0szleVURPyqhxit8hEPCZ3pj8KdnnQfCvW8E'),
    'cover_board': ('11 ADD-ON — DENSDECK VE', '156n6vZQUx0UllHVdGTcipUSMJCTjwuLAx2Gm6qTCd1w'),
    'coping_addon': ('12 ADD-ON — COPING + CLEAT + ICE & WATER', '1HD52odl1tEKhkNQhKIXvZOEcBeJ0uQJsj05jhNvKs8k'),
    'fascia': ('13 FASCIA', '1XSFcqy7Ek9fgybma8Gt5oaOMHi_Gz0TkSp0v1eY1nnY'),
    'gutters_standalone': ('14 GUTTERS & DOWNSPOUTS', '1n5AMgYlUquFaSvsoVgHCRFrxkjmoX7EWzP3I3XGSNPQ'),
    'nail_base': ('15 NAIL BASE', '1WZYeJN_r09Uhi0Kc2hEAJ-wqtq3pzjBLya1KOB3ehIQ'),
    'ss_ceelok': ('16 STANDING SEAM — CEE-LOK', '1SlsWlgP4B4CpJYyKXn6Npe4a2zi5ck3MttEnpd2UpdI'),
    'ss_zeelock': ('17 STANDING SEAM — ZEE-LOCK', '1H33cb4Gj8XG1qi9WmmenYAI9vw9k-hVkrZz6agYrxMI'),
}
