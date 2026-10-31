"""Phase 00 — cross-check fixture vs aturan bisnis di docs/business-rules.md.

Melengkapi samples/test-data/validate_fixtures.py untuk hal yang belum dicek di sana:
rule v2, agregasi divisi, pembulatan rasio, edge case KPI, invalid CSV, routing approval,
konsistensi file scoped, dan sifat fingerprint (reorder-invariant, multiplicity dipertahankan).
Ini BUKAN test aplikasi; hanya membuktikan aturan tertulis konsisten dengan angka fixture.
Jalankan: python3 -I scripts/phase00_crosscheck.py
"""
import csv
import hashlib
import json
from collections import Counter, defaultdict
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal as D, InvalidOperation
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "samples" / "test-data"
CHECKS = []


def j(name):
    return json.loads((ROOT / name).read_text())


def c(name):
    return list(csv.DictReader((ROOT / name).open(encoding="utf-8")))


def check(name, cond):
    CHECKS.append((name, bool(cond)))


def q2(x):
    return x.quantize(D("0.01"), rounding=ROUND_HALF_UP)


units = {u["id"]: u for u in j("seed/org-units.json")}
internal = c("reconciliation/internal-transactions.csv")
external = c("reconciliation/external-transactions.csv")


def reconcile(rows_i, rows_e, tolerance_days):
    groups = defaultdict(lambda: ([], []))
    for side, rows in ((0, rows_i), (1, rows_e)):
        for r in rows:
            key = (r["organization_id"], r["unit_id"], r["account_id"], r["currency"], r["reference"].strip())
            groups[key][side].append(r)
    out = []
    for key, (a, b) in sorted(groups.items()):
        if len(a) > 1 or len(b) > 1:
            status = ("Mismatched", "DUPLICATE_REFERENCE")
        elif not a:
            status = ("Missing in Internal", "NO_INTERNAL")
        elif not b:
            status = ("Missing in External", "NO_EXTERNAL")
        elif D(a[0]["amount"]) != D(b[0]["amount"]):
            status = ("Mismatched", "AMOUNT_DIFFERENCE")
        elif abs((date.fromisoformat(a[0]["transaction_date"]) - date.fromisoformat(b[0]["transaction_date"])).days) > tolerance_days:
            status = ("Mismatched", "DATE_OUTSIDE_TOLERANCE")
        else:
            status = ("Matched", None)
        out.append((key, status, a, b))
    return out


def verified(results):
    return sum((D(a[0]["amount"]) for _, s, a, _ in results if s[0] == "Matched"), D(0))


def scope(rows, org, unit):
    return [r for r in rows if r["organization_id"] == org and r["unit_id"] == unit]


# 1. Rekonsiliasi per scope + v2
bra_v1 = reconcile(scope(internal, "ORG-1", "BR-A"), scope(external, "ORG-1", "BR-A"), 1)
bra_v2 = reconcile(scope(internal, "ORG-1", "BR-A"), scope(external, "ORG-1", "BR-A"), 2)
brb = reconcile(scope(internal, "ORG-1", "BR-B"), scope(external, "ORG-1", "BR-B"), 1)
brx = reconcile(scope(internal, "ORG-2", "BR-X"), scope(external, "ORG-2", "BR-X"), 1)
check("BR-A v1 verified = 15000000", verified(bra_v1) == D("15000000"))
check("BR-A v2 verified = 17000000 (REF-004 Matched)", verified(bra_v2) == D("17000000"))
check("BR-A v2 REF-004 Matched", [s for k, s, _, _ in bra_v2 if k[4] == "REF-004"] == [("Matched", None)])
check("BR-B verified = 6000000", verified(brb) == D("6000000"))
check("ORG-2 BR-X verified = 9000000", verified(brx) == D("9000000"))
check("REF-001 ORG-1 dan ORG-2 grup terpisah", len({k for k, *_ in bra_v1 + brx if k[4] == "REF-001"}) == 2)
ratio = D(sum(s[0] == "Matched" for _, s, _, _ in bra_v1)) / D(len(bra_v1)) * 100
check("Rasio 2/7 HALF_UP = 28.57", str(q2(ratio)) == "28.57")
exp = j("reconciliation/expected-results.json")
for o in exp["other_scopes"]:
    res = {"BR-B": brb, "BR-X": brx}[o["unit_id"]]
    check(f"other_scope {o['unit_id']} status+revenue", res[0][1][0] == o["status"] and verified(res) == D(o["verified_revenue"]))

# 2. File scoped == hasil filter file gabungan
for org, unit in (("ORG-1", "BR-A"), ("ORG-1", "BR-B"), ("ORG-2", "BR-X")):
    check(f"scoped {org}-{unit} internal == filter gabungan", c(f"reconciliation/scoped/{org}-{unit}-internal.csv") == scope(internal, org, unit))
    check(f"scoped {org}-{unit} external == filter gabungan", c(f"reconciliation/scoped/{org}-{unit}-external.csv") == scope(external, org, unit))
check("transaction_id unik dalam tiap sisi", all(len({r["transaction_id"] for r in rows}) == len(rows) for rows in (internal, external)))


# 3. Fingerprint: reorder-invariant, multiplicity dipertahankan
def fingerprint(scope_key, side, rows):
    canon = sorted(
        "|".join([r["transaction_id"], r["reference"].strip(), date.fromisoformat(r["transaction_date"]).isoformat(),
                  format(D(r["amount"]).normalize(), "f"), r["currency"], r["transaction_type"]])
        for r in rows)
    return hashlib.sha256(("\n".join([scope_key, side] + canon)).encode()).hexdigest()


bra_i = c("reconciliation/scoped/ORG-1-BR-A-internal.csv")
fp = fingerprint("ORG-1/BR-A/ACC-1", "INTERNAL", bra_i)
check("Fingerprint reorder sama", fp == fingerprint("ORG-1/BR-A/ACC-1", "INTERNAL", list(reversed(bra_i))))
check("Fingerprint beda sisi beda", fp != fingerprint("ORG-1/BR-A/ACC-1", "EXTERNAL", bra_i))
check("Multiplicity: duplikat referensi REF-007 tetap 2 baris", sum(r["reference"] == "REF-007" for r in bra_i) == 2)
check("Nominal 700000 dan 700000.00 canonical sama", format(D("700000").normalize(), "f") == format(D("700000.00").normalize(), "f"))

# 4. Headcount, RPE, divisi
days = Counter()
for a in j("seed/employee-assignments.json"):
    s = max(date(2026, 9, 1), date.fromisoformat(a["start_date"]))
    e = min(date(2026, 10, 1), date.fromisoformat(a["end_date_exclusive"]) if a["end_date_exclusive"] else date(2026, 10, 1))
    while s < e:
        days[a["unit_id"]] += 1
        s += timedelta(days=1)


def descendants(uid):
    out = {uid}
    for u in units.values():
        if u["parent_id"] == uid:
            out |= descendants(u["id"])
    return out


div = descendants("DIV-1")
div_days = sum(days[u] for u in div)
div_rev = verified(bra_v1) + verified(brb)
check("DIV-1 employee-days = 105", div_days == 105)
check("DIV-1 avg headcount = 3.5", D(div_days) / 30 == D("3.5"))
check("DIV-1 RPE = 21000000/3.5 = 6000000", div_rev / (D(div_days) / 30) == D("6000000"))
check("DIV-1 RPE bukan rata-rata RPE cabang (5750000)", (D("7500000") + D("4000000")) / 2 != D("6000000"))
check("BR-X (ORG-2) di luar DIV-1", "BR-X" not in div)
check("BR-ZERO employee_days 0 -> RPE null", days["BR-ZERO"] == 0)

# 5. KPI edge cases
for e in j("hr/edge-cases.json"):
    if e["id"] == "KPI-CAP":
        sc = min(D(e["actual"]) / D(e["target"]) * 100, D(120)) * D(e["weight"]) / 100
        check("KPI-CAP skor 120", sc == D(e["expected_score"]))
    elif e["id"] in ("KPI-ZERO", "KPI-NEGATIVE"):
        check(f"{e['id']} ditolak (target <= 0)", not D(e["target"]) > 0)
    elif e["id"] == "BAD-WEIGHTS":
        check("BAD-WEIGHTS total != 100 -> finalize ditolak", sum(D(w) for w in e["weights"]) != 100)

# 6. Invalid CSV: urutan validasi menghasilkan reason yang diharapkan
ALLOWED_CURRENCY = {"IDR"}


def validate_row(r, dataset_org="ORG-1"):
    try:
        amount = D(r["amount"])
        if not amount.is_finite():
            raise InvalidOperation
    except InvalidOperation:
        return "INVALID_AMOUNT"
    try:
        date.fromisoformat(r["transaction_date"])
    except ValueError:
        return "INVALID_DATE"
    if not r["reference"].strip():
        return "REQUIRED_REFERENCE"
    if r["currency"] not in ALLOWED_CURRENCY:
        return "UNSUPPORTED_CURRENCY"
    if r["unit_id"] not in units:
        return "UNKNOWN_UNIT"
    if units[r["unit_id"]]["organization_id"] != r["organization_id"] or r["organization_id"] != dataset_org:
        return "UNIT_ORG_MISMATCH"
    if r["transaction_type"] == "REVENUE" and amount <= 0:
        return "NEGATIVE_REVENUE"
    return None


for case in j("invalid/expected.json")["cases"]:
    rows = c(f"invalid/{case['file']}")
    check(f"invalid {case['file']} -> {case['reason']}", [validate_row(r) for r in rows] == [case["reason"]])
check("Semua baris fixture valid lolos validasi", all(validate_row(r, r["organization_id"]) is None for r in internal + external))

# 7. Approval routing
wf = j("approval/workflow.json")


def steps_for(amount):
    return [s for s in wf["steps"] if s["condition"] == "always" or (s["condition"] == "amount > 10000000" and D(amount) > D("10000000"))]


reqs = {r["id"]: r for r in j("approval/requests.json")}
for sc in j("approval/test-scenarios.json"):
    if "expected_steps" in sc:
        check(f"approval {sc['id']} jumlah step {sc['expected_steps']}", len(steps_for(reqs[sc["request_id"]]["amount"])) == sc["expected_steps"])
check("REQ-RACE butuh 2 step (status PENDING step 2 setelah approve step 1)", len(steps_for(reqs["REQ-RACE"]["amount"])) == 2)
check("REQ-LOW 1 step", len(steps_for(reqs["REQ-LOW"]["amount"])) == 1)

# 8. Akses
grants = j("seed/access-grants.json")
g_by_user = defaultdict(list)
for g in grants:
    g_by_user[g["user_id"]].append(g)
check("NO-GRANT tanpa grant", not g_by_user["NO-GRANT"])
check("MANAGER-A tidak punya grant FINANCE (import -> 403)", all(g["role"] != "FINANCE" for g in g_by_user["MANAGER-A"]))
check("MANAGER-B scope BR-B tidak kompatibel dengan BR-A (delegasi -> 403)", "BR-A" not in descendants(g_by_user["MANAGER-B"][0]["unit_id"]))
check("MANAGER-A2 MANAGER di BR-A (delegasi valid)", any(g["role"] == "MANAGER" and g["unit_id"] == "BR-A" for g in g_by_user["MANAGER-A2"]))
check("MANAGER-A tidak punya REQUESTER (skenario SELF perlu grant test-only)", all(g["role"] != "REQUESTER" for g in g_by_user["MANAGER-A"]))
check("ADMIN hanya ORG-1", {g["organization_id"] for g in g_by_user["ADMIN"]} == {"ORG-1"})

failed = [n for n, ok in CHECKS if not ok]
for n, ok in CHECKS:
    print(("PASS " if ok else "FAIL ") + n)
print(f"\n{len(CHECKS) - len(failed)}/{len(CHECKS)} PASS")
raise SystemExit(1 if failed else 0)
