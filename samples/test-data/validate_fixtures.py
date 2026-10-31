import csv,json
from pathlib import Path
from decimal import Decimal as D
from datetime import date,timedelta
from collections import defaultdict,Counter
p=Path(__file__).resolve().parent
def j(n): return json.loads((p/n).read_text())
def c(n): return list(csv.DictReader((p/n).open()))
units={u['id']:u for u in j('seed/org-units.json')}
employees={e['id'] for e in j('seed/employees.json')}
for u in units.values():
 if u['parent_id']: assert units[u['parent_id']]['organization_id']==u['organization_id']
internal=c('reconciliation/internal-transactions.csv');external=c('reconciliation/external-transactions.csv')
for row in internal+external:
 assert units[row['unit_id']]['organization_id']==row['organization_id']
 assert D(row['amount'])>0
 date.fromisoformat(row['transaction_date'])
groups=defaultdict(lambda:[[],[]])
for side,rows in enumerate([internal,external]):
 for r in rows:
  if r['unit_id']=='BR-A': groups[r['reference']][side].append(r)
expected=j('reconciliation/expected-results.json');actual=[];revenue=D(0);ia=D(0);ea=D(0);delta=D(0)
for ref,(a,b) in sorted(groups.items()):
 if len(a)>1 or len(b)>1: status,reason='Mismatched','DUPLICATE_REFERENCE'
 elif not a: status,reason='Missing in Internal','NO_INTERNAL'
 elif not b: status,reason='Missing in External','NO_EXTERNAL'
 elif D(a[0]['amount'])!=D(b[0]['amount']): status,reason='Mismatched','AMOUNT_DIFFERENCE'
 elif abs((date.fromisoformat(a[0]['transaction_date'])-date.fromisoformat(b[0]['transaction_date'])).days)>1: status,reason='Mismatched','DATE_OUTSIDE_TOLERANCE'
 else: status,reason='Matched',None
 actual.append(dict(reference=ref,status=status,reason=reason,internal_ids=[r['transaction_id'] for r in a],external_ids=[r['transaction_id'] for r in b]))
 if status=='Matched': revenue+=D(a[0]['amount'])
 else:
  ia+=sum((D(r['amount']) for r in a),D(0));ea+=sum((D(r['amount']) for r in b),D(0))
  if len(a)==len(b)==1: delta+=abs(D(a[0]['amount'])-D(b[0]['amount']))
assert actual==expected['results']
s=expected['summary'];assert revenue==D(s['verified_revenue']);assert ia==D(s['anomalous_internal_total']);assert ea==D(s['anomalous_external_total']);assert delta==D(s['unique_pair_amount_difference_total'])
assert len(actual)==s['groups'];assert sum(r['status']=='Matched' for r in actual)==s['matched_ratio_numerator']
days=Counter();seen=set()
for a in j('seed/employee-assignments.json'):
 assert a['employee_id'] in employees
 start=max(date(2026,9,1),date.fromisoformat(a['start_date']));end=min(date(2026,10,1),date.fromisoformat(a['end_date_exclusive']) if a['end_date_exclusive'] else date(2026,10,1))
 while start<end:
  key=(a['employee_id'],start);assert key not in seen;seen.add(key);days[a['unit_id']]+=1;start+=timedelta(days=1)
hr=j('hr/expected-results.json')
for b in hr['branches']:
 assert days[b['unit_id']]==b['employee_days'];head=D(days[b['unit_id']])/30;assert head==D(b['average_headcount'])
 assert (D(b['verified_revenue'])/head if head else None)==(D(b['rpe']) if b['rpe'] else None)
kpis=j('hr/kpi-assignments.json');assert sum(D(k['weight']) for k in kpis)==100
score=sum(min((revenue if k['source']=='VERIFIED_UNIT_REVENUE' else D(k['actual']))/D(k['target'])*100,D(120))*D(k['weight'])/100 for k in kpis)
assert score==D(hr['employee_review']['total_score'])
users={u['id'] for u in j('seed/users.json')}
for g in j('seed/access-grants.json'):
 assert g['user_id'] in users
 if g['unit_id']: assert units[g['unit_id']]['organization_id']==g['organization_id']
for r in j('approval/requests.json'): assert r['requester_id'] in users and D(r['amount'])>0
print('PASS: references, matching outcomes, anomaly totals, headcount, RPE, KPI and approval fixtures.')
print('Application concurrency/security tests still require the implemented backend and PostgreSQL.')
