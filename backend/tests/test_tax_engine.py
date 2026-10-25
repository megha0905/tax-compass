"""Test profiles from the build guide. Run: python -m pytest -q (from backend/)."""
from app.db import RULES
from app.tax_engine import compare, slab_tax


def make_rules():
    slabs = lambda t: sorted(
        [(l, r) for c, rt, l, r, d in RULES if rt == t],
        key=lambda s: s[0] if s[0] is not None else float("inf"),
    )
    by = {c: (l, r) for c, rt, l, r, d in RULES}
    return {
        "tax_period": "2025-26",
        "act_version": "Income-tax Act, 1961",
        "SLAB_NEW": slabs("SLAB_NEW"),
        "SLAB_OLD": slabs("SLAB_OLD"),
        "STD_NEW": by["STD_NEW"][0],
        "STD_OLD": by["STD_OLD"][0],
        "REBATE_NEW": by["REBATE_NEW"],
        "REBATE_OLD": by["REBATE_OLD"],
        "CESS": by["CESS"][1],
        "HP_STD": by["HP_STD"][1],
        "LIMITS": {c: l for c, rt, l, r, d in RULES if rt == "DEDUCTION_LIMIT"},
    }


R = make_rules()


def inc(t, amt):
    return {"income_type": t, "amount": amt}


def ded(code, amt):
    return {"section_code": code, "claimed_amount": amt}


def run(incomes, deductions=(), profile=None):
    return compare(list(incomes), list(deductions), R, profile or {})


def test_slab_tax():
    assert slab_tax(925000, R["SLAB_NEW"]) == 32500


def test_profile_a():
    r = run([inc("SALARY", 1000000)], [ded("80C", 150000), ded("80D", 25000)])
    assert r["new"]["total_tax"] == 0
    assert r["old"]["total_tax"] == 70200
    assert r["recommended_regime"] == "new"
    assert r["recommended_itr"] == "ITR-1"


def test_profile_b():
    r = run(
        [inc("SALARY", 1800000)],
        [ded("80C", 150000), ded("80D", 25000), ded("80CCD1B", 50000), ded("24B", 200000)],
    )
    assert r["new"]["total_tax"] == 150800
    assert r["old"]["total_tax"] == 218400


def test_profile_c():
    assert run([inc("SALARY", 1275000)])["new"]["total_tax"] == 0


def test_profile_d_marginal_relief():
    r = run([inc("SALARY", 1285000)])
    assert r["new"]["total_tax"] == 10400
    assert r["old"]["total_tax"] == 190320
    assert any(f["code"] == "MARGINAL_RELIEF" for f in r["new"]["flags"])


def test_profile_e_cap():
    r = run([inc("SALARY", 600000)], [ded("80C", 200000)])
    assert r["new"]["total_tax"] == 0
    assert r["old"]["total_tax"] == 0
    assert any(f["code"] == "CAP_80C" for f in r["old"]["flags"])


def test_profile_f_capital_gains_itr2():
    r = run([inc("SALARY", 800000), inc("CAPITAL_GAINS", 100000)])
    assert r["recommended_itr"] == "ITR-2"
    assert any(f["code"] == "CG_SPECIAL_RATE" for f in r["flags"])


def test_profile_g_presumptive_itr4():
    r = run([inc("BUSINESS", 900000)], profile={"presumptive": True})
    assert r["recommended_itr"] == "ITR-4"


def test_business_itr3():
    assert run([inc("BUSINESS", 900000)])["recommended_itr"] == "ITR-3"
