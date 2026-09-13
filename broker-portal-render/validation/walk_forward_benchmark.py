import csv, math
from collections import defaultdict, deque

PILOT_CELLS = {
    ('Turkish Black Sea','5-7k'),
    ('Turkish Black Sea','10-15k'),
    ('Marmara, Turkey','5-7k'),
    ('Marmara, Turkey','10-15k'),
    ('East Mediterranean','5-7k'),
}

rows=[]
with open('stribrok_2026_time_series.csv', newline='', encoding='utf-8') as f:
    for r in csv.DictReader(f):
        r['week']=int(r['week']); r['mid']=float(r['mid'])
        if (r['route'],r['size']) in PILOT_CELLS:
            rows.append(r)

by_cell=defaultdict(list)
for r in rows:
    by_cell[(r['route'],r['size'])].append(r)
for v in by_cell.values():
    v.sort(key=lambda r:r['week'])

def score(pairs):
    errors=[p-a for a,p in pairs]
    return {
        'n':len(errors),
        'mae':sum(abs(e) for e in errors)/len(errors),
        'rmse':math.sqrt(sum(e*e for e in errors)/len(errors)),
        'bias':sum(errors)/len(errors),
    }

prev=[]; rolling3=[]
for cell, seq in by_cell.items():
    by_week={r['week']:r['mid'] for r in seq}
    for r in seq:
        w=r['week']; actual=r['mid']
        if w-1 in by_week:
            prev.append((actual,by_week[w-1]))
        if all(x in by_week for x in (w-1,w-2,w-3)):
            rolling3.append((actual,sum(by_week[x] for x in (w-1,w-2,w-3))/3.0))

print('Previous-week:', score(prev))
print('Rolling-3:', score(rolling3))

# W37 prospective comparison using only information available before W37.
w37=[]
for cell, seq in by_cell.items():
    by_week={r['week']:r['mid'] for r in seq}
    if 37 in by_week:
        actual=by_week[37]
        if 36 in by_week: w37.append(('previous-week',cell,actual,by_week[36]))
        if all(x in by_week for x in (34,35,36)):
            w37.append(('rolling-3',cell,actual,sum(by_week[x] for x in (34,35,36))/3.0))
for name in ('previous-week','rolling-3'):
    pairs=[(a,p) for n,c,a,p in w37 if n==name]
    print('W37 '+name+':',score(pairs))
