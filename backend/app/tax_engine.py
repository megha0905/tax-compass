"""Tax Intelligence Agent: deterministic tax computation.

No AI here. Every number comes from the tax_rules table, so a change in the
law means new rows, not new code.
"""
from collections import defaultdict

VI_A_SECTIONS = ("80C", "80D", "80CCD1B", "80TTA")
SURCHARGE_THRESHOLD = 5_000_000
ITR1_INCOME_LIMIT = 5_000_000


def _num(value):
    return float(value) if value is not None else None


def load_rules(conn, tax_period):
    """Turn tax_rules rows into a dict the engine can use."""
    rows = conn.execute(
        "SELECT * FROM tax_rules WHERE tax_period = %s", (tax_period,)
    ).fetchall()
    if not rows:
        raise ValueError(f"No tax rules found for tax period {tax_period}")

    def slabs(rtype):
        items = [(_num(r["limit_amount"]), _num(r["rate"])) for r in rows if r["rule_type"] == rtype]
        return sorted(items, key=lambda s: s[0] if s[0] is not None else float("inf"))

    by_code = {r["section_code"]: r for r in rows}
    return {
        "tax_period": tax_period,
        "act_version": rows[0]["act_version"],
        "SLAB_NEW": slabs("SLAB_NEW"),
        "SLAB_OLD": slabs("SLAB_OLD"),
        "STD_NEW": _num(by_code["STD_NEW"]["limit_amount"]),
        "STD_OLD": _num(by_code["STD_OLD"]["limit_amount"]),
        "REBATE_NEW": (_num(by_code["REBATE_NEW"]["limit_amount"]), _num(by_code["REBATE_NEW"]["rate"])),
        "REBATE_OLD": (_num(by_code["REBATE_OLD"]["limit_amount"]), _num(by_code["REBATE_OLD"]["rate"])),
        "CESS": _num(by_code["CESS"]["rate"]),
        "HP_STD": _num(by_code["HP_STD"]["rate"]),
        "LIMITS": {
            r["section_code"]: _num(r["limit_amount"])
            for r in rows if r["rule_type"] == "DEDUCTION_LIMIT"
        },
    }


def slab_tax(income, slabs):
    """Progressive tax: each slab taxes only the part of income inside it."""
    tax, prev = 0.0, 0.0
    for upper, rate in slabs:
        top = income if upper is None else min(income, upper)
        if top > prev:
            tax += (top - prev) * rate
        if upper is None or income <= upper:
            break
        prev = upper
    return tax


def round_to_10(amount):
    """Section 288A: round taxable income to the nearest multiple of 10."""
    return float(int((amount + 5) // 10 * 10))


def _flag(code, message, severity="warning"):
    return {"code": code, "message": message, "severity": severity}


def _rupees(x):
    """Indian digit grouping, e.g. 1285000 -> '12,85,000'."""
    s = str(int(round(x)))
    if len(s) <= 3:
        return s
    head, tail = s[:-3], s[-3:]
    parts = []
    while len(head) > 2:
        parts.insert(0, head[-2:])
        head = head[:-2]
    if head:
        parts.insert(0, head)
    return ",".join(parts) + "," + tail


def compute_regime(regime, incomes, deductions, rules):
    """Compute one regime. regime is 'old' or 'new'."""
    key = regime.upper()
    totals = defaultdict(float)
    for inc in incomes:
        totals[inc["income_type"]] += float(inc["amount"])
    claims = defaultdict(float)
    for d in deductions:
        claims[d["section_code"]] += float(d["claimed_amount"])

    flags, rules_applied = [], []

    # 1. Salary after standard deduction
    std = rules[f"STD_{key}"]
    salary = totals["SALARY"]
    std_used = min(std, salary)
    salary_net = salary - std_used
    if salary:
        rules_applied.append(f"STD_{key}")

    # 2. House property: rent x (1 - 30%), less home-loan interest (old regime)
    rent = totals["HOUSE_PROPERTY"]
    hp_income = rent * (1 - rules["HP_STD"]) if rent else 0.0
    if rent:
        rules_applied.append("HP_STD")
    interest_allowed = 0.0
    if claims["24B"]:
        if regime == "old":
            cap = rules["LIMITS"]["24B"]
            interest_allowed = min(claims["24B"], cap)
            rules_applied.append("24B")
            if claims["24B"] > cap:
                flags.append(_flag("CAP_24B", f"Home loan interest claimed ₹{_rupees(claims['24B'])}, capped at ₹{_rupees(cap)}"))
        else:
            flags.append(_flag("NEW_24B", "Home loan interest on self-occupied property is not allowed in the new regime", "info"))
    hp_income -= interest_allowed

    # 3. Other heads at slab rates (prototype)
    gross = salary_net + hp_income + totals["OTHER"] + totals["CAPITAL_GAINS"] + totals["BUSINESS"]
    gross = max(0.0, gross)

    # 4. Chapter VI-A deductions (old regime only)
    via_allowed = 0.0
    deduction_detail = []
    for code in VI_A_SECTIONS:
        claimed = claims[code]
        if not claimed:
            continue
        if regime == "old":
            cap = rules["LIMITS"][code]
            allowed = min(claimed, cap)
            via_allowed += allowed
            rules_applied.append(code)
            if claimed > cap:
                flags.append(_flag(f"CAP_{code}", f"{code} claimed ₹{_rupees(claimed)}, capped at ₹{_rupees(cap)}"))
        else:
            allowed = 0.0
        deduction_detail.append({"section_code": code, "claimed": claimed, "allowed": allowed})
    if regime == "new" and deduction_detail:
        flags.append(_flag("NEW_VIA", "80C/80D and other Chapter VI-A deductions are not allowed in the new regime", "info"))
    via_allowed = min(via_allowed, gross)

    # 5. Taxable income
    taxable = round_to_10(max(0.0, gross - via_allowed))

    # 6. Slab tax
    tax = slab_tax(taxable, rules[f"SLAB_{key}"])
    slab_amount = tax
    rules_applied.append(f"SLAB_{key}")

    # 7. Rebate 87A
    rebate = 0.0
    limit, max_rebate = rules[f"REBATE_{key}"]
    if taxable <= limit:
        rebate = min(tax, max_rebate)
        tax -= rebate
        if rebate:
            rules_applied.append(f"REBATE_{key}")

    # 8. Marginal relief (new regime, just above the rebate limit)
    marginal_relief = 0.0
    if regime == "new" and taxable > limit and tax > taxable - limit:
        marginal_relief = tax - (taxable - limit)
        tax = taxable - limit
        flags.append(_flag("MARGINAL_RELIEF", f"Marginal relief of ₹{_rupees(marginal_relief)} applied (income just above ₹{_rupees(limit)})", "info"))

    # 9. Cess
    cess = tax * rules["CESS"]
    rules_applied.append("CESS")
    total = round(tax + cess)

    if gross > SURCHARGE_THRESHOLD:
        flags.append(_flag("SURCHARGE", "Income above ₹50 lakh: surcharge not computed in this prototype — reviewer must check", "critical"))

    return {
        "regime": regime,
        "salary": salary,
        "standard_deduction": std_used,
        "house_property_income": hp_income,
        "other_income": totals["OTHER"],
        "capital_gains": totals["CAPITAL_GAINS"],
        "business_income": totals["BUSINESS"],
        "gross_total_income": gross,
        "deductions": deduction_detail,
        "home_loan_interest_allowed": interest_allowed,
        "total_deductions": via_allowed + interest_allowed + std_used,
        "chapter_via_allowed": via_allowed,
        "taxable_income": taxable,
        "slab_tax": round(slab_amount, 2),
        "rebate_87a": round(rebate, 2),
        "marginal_relief": round(marginal_relief, 2),
        "tax_after_rebate": round(tax, 2),
        "cess": round(cess, 2),
        "total_tax": total,
        "flags": flags,
        "rules_applied": rules_applied,
    }


def recommend_itr(profile, gross_total, has_capital_gains, has_business):
    """Return (form, reason, flags). First matching rule wins."""
    profile = profile or {}
    resident = profile.get("residential_status", "Resident") == "Resident"
    presumptive = bool(profile.get("presumptive"))
    hp_count = int(profile.get("house_property_count") or 0)
    foreign = bool(profile.get("has_foreign_assets"))

    if has_business and presumptive and resident and gross_total <= ITR1_INCOME_LIMIT:
        return "ITR-4", "Presumptive business/professional income (44AD/44ADA)", []
    if has_business:
        return "ITR-3", "Business or professional income needs ITR-3", []
    reasons = []
    if has_capital_gains:
        reasons.append("capital gains")
    if hp_count > 1:
        reasons.append("more than one house property")
    if foreign:
        reasons.append("foreign assets")
    if not resident:
        reasons.append("non-resident status")
    if gross_total > ITR1_INCOME_LIMIT:
        reasons.append("income above ₹50 lakh")
    if reasons:
        flags = []
        if has_capital_gains:
            flags.append(_flag("ITR2_LTCG", "Reviewer may downgrade to ITR-1 if the only gain is small LTCG under 112A (up to ₹1.25 lakh)", "info"))
        return "ITR-2", "Not allowed in ITR-1: " + ", ".join(reasons), flags
    return "ITR-1", "Resident with salary, one house property and other income up to ₹50 lakh", []


def compare(incomes, deductions, rules, profile=None):
    """Run both regimes, pick the cheaper one, recommend an ITR form."""
    old = compute_regime("old", incomes, deductions, rules)
    new = compute_regime("new", incomes, deductions, rules)
    regime = "new" if new["total_tax"] <= old["total_tax"] else "old"

    types = {i["income_type"] for i in incomes}
    has_cg = "CAPITAL_GAINS" in types
    has_business = "BUSINESS" in types
    gross = max(old["gross_total_income"], new["gross_total_income"])
    itr, reason, itr_flags = recommend_itr(profile, gross, has_cg, has_business)

    flags = []
    if not incomes:
        flags.append(_flag("NO_INCOME", "No income entered yet", "critical"))
    if has_cg:
        flags.append(_flag("CG_SPECIAL_RATE", "Capital gains taxed at slab rates in this prototype — special rates under 111A/112A need reviewer check"))
    if has_business:
        flags.append(_flag("BUSINESS", "Business income — reviewer must check books or presumptive computation"))
    # Flags from both regimes: the reviewer should see a capped claim even if
    # the recommended regime ignores it.
    flags += new["flags"] + old["flags"] + itr_flags

    # Remove duplicates by code
    seen, unique = set(), []
    for f in flags:
        if f["code"] not in seen:
            seen.add(f["code"])
            unique.append(f)

    return {
        "old": old,
        "new": new,
        "recommended_regime": regime,
        "saving": abs(old["total_tax"] - new["total_tax"]),
        "recommended_itr": itr,
        "itr_reason": reason,
        "flags": unique,
        "tax_period": rules["tax_period"],
        "act_version": rules["act_version"],
    }


def template_explanation(result):
    """Plain-language explanation built only from engine numbers."""
    r = result
    chosen = r[r["recommended_regime"]]
    other_key = "old" if r["recommended_regime"] == "new" else "new"
    other = r[other_key]
    lines = [
        f"Under the {r['recommended_regime']} regime your taxable income is ₹{_rupees(chosen['taxable_income'])}.",
        f"Slab tax on it is ₹{_rupees(chosen['slab_tax'])}.",
    ]
    if chosen["rebate_87a"]:
        lines.append(f"A section 87A rebate of ₹{_rupees(chosen['rebate_87a'])} applies because taxable income is within the rebate limit.")
    if chosen["marginal_relief"]:
        lines.append(f"Marginal relief of ₹{_rupees(chosen['marginal_relief'])} keeps the tax from exceeding the income above ₹12 lakh.")
    lines.append(f"After 4% cess, total tax is ₹{_rupees(chosen['total_tax'])}.")
    if r["saving"]:
        lines.append(
            f"The {other_key} regime would cost ₹{_rupees(other['total_tax'])}, "
            f"so the {r['recommended_regime']} regime saves you ₹{_rupees(r['saving'])}."
        )
    else:
        lines.append(f"The {other_key} regime gives the same tax, so the new regime (the default) is suggested.")
    lines.append(f"Recommended form: {r['recommended_itr']} ({r['itr_reason']}).")
    lines.append("A qualified reviewer will check this before it is ready to file.")
    return " ".join(lines)
