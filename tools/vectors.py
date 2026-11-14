# Reference implementation of the loan money rules (integer cents, basis points, round half up).
from datetime import date
import calendar

def rnd(n, d):  # round half up, positive ints
    return (2 * n + d) // (2 * d)

def pct(amount, bps):
    return rnd(amount * bps, 10000)

def add_months(d, n):
    m = d.month - 1 + n
    y = d.year + m // 12
    m = m % 12 + 1
    day = min(d.day, calendar.monthrange(y, m)[1])
    return date(y, m, day)

def penalties(total_due, original_due, bps, periods, base):
    out, owed = [], total_due
    for i in range(1, periods + 1):
        b = owed if base == 'outstanding_total' else original_due
        p = pct(b, bps)
        owed += p
        out.append((i, b, p, owed))
    return out

def allocate(pay, pen, intr, prin):
    a = {}
    for k, v in (('penalty', pen), ('interest', intr), ('principal', prin)):
        x = min(pay, v); a[k] = x; pay -= x
    a['unallocated'] = pay
    return a

P = 100000  # $1,000.00
I = pct(P, 2000 * 1)  # 1 month
print('interest', I, 'total', P + I)
print('due date 31 Jan + 1m:', add_months(date(2026, 1, 31), 1), '| 5 Jan +1m:', add_months(date(2026, 1, 5), 1))
for base in ('outstanding_total', 'original_due'):
    print(base)
    for r in penalties(P + I, P + I, 2000, 4, base):
        print('  wk', r[0], 'base', r[1], 'pen', r[2], 'owed', r[3])
# partial payment after wk1 (outstanding_total base)
owed_pen = pct(P + I, 2000)
print('alloc 500 after wk1:', allocate(50000, owed_pen, I, P))
# then wk2 penalty on remaining 940
rem = P - 6000
print('remaining principal', rem, 'wk2 pen', pct(rem, 2000), 'owed', rem + pct(rem, 2000))
# extension: 1000 principal outstanding, +1 month
print('extension interest', pct(P, 2000))
# rounding case
print('round 33.33 * 20%', pct(3333, 2000), '| 0.05 half up', pct(25, 2000))
# collateral sale: owed after wk4 2488.32, sale 2000 -> allocate
print('sale 2000 vs 2488.32 (pen 1288.32,int 200,prin 1000):', allocate(200000, 128832, 20000, 100000))
print('sale 3000:', allocate(300000, 128832, 20000, 100000))

# T-33 oracle: late accrual run equals daily run for penalty amounts and total outstanding
k1 = pct(P + I, 2000)
a = allocate(50000, k1, I, P); prinA = P - a['principal']; k2A = pct(prinA, 2000)
b = allocate(50000, 0, I, P); prinB = P - b['principal']; k2B = pct(prinB + k1, 2000)
print('T-33 run A owed', prinA + k2A, '| run B owed', prinB + k1 + k2B, '| k2', k2A, k2B)
assert k2A == k2B == 18800 and prinA + k2A == prinB + k1 + k2B == 112800

# T-33b oracle (B-15): the job first runs three periods late. Daily: k1 on the full 120000, the
# payment of 50000 after k1 pays penalty, interest, then principal; k2 and k3 on what is then owed.
# Late: each base is what was owed at the end of its charge date, earlier penalties included.
k1 = pct(P + I, 2000)
a = allocate(50000, k1, I, P); owed = (P - a['principal'])
k2 = pct(owed, 2000); owed += k2
k3 = pct(owed, 2000); owed += k3
late_owed2 = (P + I - 50000) + k1; late_k2 = pct(late_owed2, 2000)
late_k3 = pct(late_owed2 + late_k2, 2000)
print('T-33b daily', k1, k2, k3, 'owed', owed, '| late', k1, late_k2, late_k3)
assert (k2, k3, owed) == (late_k2, late_k3, 135360) == (18800, 22560, 135360)

# Installment loans (SPEC addendum, agreed with MSI 2026-11-14). Interest is charged ONCE:
# principal x rate, whatever the number of months. The total is split into n equal monthly
# installments of floor(total / n) cents; the last takes the remainder. Installment k falls due
# k months after payout (month-end clamped from the payout day). Penalties start only after the
# final due date, by the same rule as one-payment loans.
from datetime import timedelta

def interest_once(principal, bps):
    return pct(principal, bps)

def schedule(total, n, start):
    base = total // n
    return [(k, add_months(start, k), base if k < n else total - base * (n - 1)) for k in range(1, n + 1)]

IL = [  # (principal, months, interest, total, installments)
    (200000, 4, 40000, 240000, [60000] * 4),
    (150000, 3, 30000, 180000, [60000] * 3),
    (100000, 7, 20000, 120000, [17142] * 6 + [17148]),
    (75000, 2, 15000, 90000, [45000] * 2),
]
for principal, n, interest, total, amounts in IL:
    i = interest_once(principal, 2000)
    s = schedule(principal + i, n, date(2026, 1, 15))
    print('IL', principal, n, 'months: interest', i, 'total', principal + i, 'installments', [a for _, _, a in s])
    assert (i, principal + i, [a for _, _, a in s]) == (interest, total, amounts)
    assert sum(a for _, _, a in s) == total

# Month-end clamping: paid out 31 Jan 2026 -> 28 Feb, 31 Mar, 30 Apr, 31 May.
dates = [d for _, d, _ in schedule(180000, 4, date(2026, 1, 31))]
print('IL dates from 31 Jan:', dates)
assert dates == [date(2026, 2, 28), date(2026, 3, 31), date(2026, 4, 30), date(2026, 5, 31)]

# Default example: $2,000 over 4 months paid out 15 Jan 2026; $1,800 paid by 15 May (interest
# first, then principal), so $600 of principal is owed after the final due date. Penalties: 20% of
# everything still owed every 7 days (outstanding_total base), at most 4; recovery from due + 30.
s = schedule(240000, 4, date(2026, 1, 15))
assert [d for _, d, _ in s] == [date(2026, 2, 15), date(2026, 3, 15), date(2026, 4, 15), date(2026, 5, 15)]
final_due = s[-1][1]
a = allocate(180000, 0, 40000, 200000)
owed = 200000 - a['principal']
pens = penalties(owed, owed, 2000, 4, 'outstanding_total')
print('IL default: owed', owed, 'penalties', [(final_due + timedelta(days=7 * k), p) for k, _, p, _ in pens],
      'recovery from', final_due + timedelta(days=30))
assert owed == 60000
assert [p for _, _, p, _ in pens] == [12000, 14400, 17280, 20736] and pens[-1][3] == 124416
assert final_due + timedelta(days=7) == date(2026, 5, 22) and final_due + timedelta(days=30) == date(2026, 6, 14)
