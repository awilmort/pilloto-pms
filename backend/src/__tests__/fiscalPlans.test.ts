/**
 * Which BillingSoft plan each Pilloto plan includes, what a tenant pays on top, and how the
 * month's statement is computed.
 */
import { includedFiscalPlan } from '../config/fiscal';
import { planChangeKind, planCharge, selectablePlans, statementFigures } from '../services/fiscal/fiscalPlans';
import { PLANS } from './helpers/fakeBillingSoft';

const tenant = (over: any = {}) => ({ products: ['pms'], plan: 'basic', plans: {}, ...over });

describe('includedFiscalPlan', () => {
  it.each([
    [{ products: ['pms'], plan: 'basic' }, null],
    [{ products: ['pms'], plan: 'pro' }, 'essential'],
    [{ products: ['pms'], plan: 'enterprise' }, 'pro'],
    [{ products: ['accounting'], plan: 'enterprise', plans: { accounting: 'starter' } }, null], // the PMS plan does not count without PMS
    [{ products: ['accounting'], plans: { accounting: 'pro' } }, 'essential'],
    [{ products: ['accounting'], plans: { accounting: 'plus' } }, 'pro'],
  ])('%j → %s', (t, expected) => {
    expect(includedFiscalPlan(tenant(t) as any)).toBe(expected);
  });

  it('gives a tenant with both products the larger of the two', () => {
    expect(includedFiscalPlan(tenant({ products: ['pms', 'accounting'], plan: 'pro', plans: { accounting: 'plus' } }) as any)).toBe('pro');
    expect(includedFiscalPlan(tenant({ products: ['pms', 'accounting'], plan: 'enterprise', plans: { accounting: 'pro' } }) as any)).toBe('pro');
    expect(includedFiscalPlan(tenant({ products: ['pms', 'accounting'], plan: 'basic', plans: { accounting: 'starter' } }) as any)).toBeNull();
  });
});

describe('planCharge — the tenant pays the plan less what its Pilloto plan includes', () => {
  it('charges nothing for the included plan itself', () => {
    expect(planCharge(PLANS, 'essential', 'essential')).toMatchObject({ planPrice: 475, includedPlanPrice: 475, planCharge: 0 });
  });

  it('charges the price difference for a larger plan', () => {
    expect(planCharge(PLANS, 'max', 'essential').planCharge).toBe(1025); // 1,500 − 475
    expect(planCharge(PLANS, 'pro', 'essential').planCharge).toBe(325); // 800 − 475
    expect(planCharge(PLANS, 'max', 'pro').planCharge).toBe(700);
  });

  it('charges the full price when nothing is included', () => {
    expect(planCharge(PLANS, 'essential', null)).toMatchObject({ includedPlanPrice: 0, planCharge: 475 });
    expect(planCharge(PLANS, 'pro', null).planCharge).toBe(800);
  });
});

describe('statementFigures — overage on transactions beyond the plan', () => {
  const charge = planCharge(PLANS, 'essential', 'essential');

  it('has no overage within the allowance, even at the limit', () => {
    expect(statementFigures(charge, 120)).toMatchObject({ used: 120, extra: 0, overageAmount: 0, total: 0 });
    expect(statementFigures(charge, 300)).toMatchObject({ extra: 0, overageAmount: 0 });
  });

  it('charges each extra transaction at the plan\'s published rate', () => {
    // 350 used, 300 included → 50 extra × 4.75
    expect(statementFigures(charge, 350)).toMatchObject({ extra: 50, overageAmount: 237.5, total: 237.5 });
  });

  it('adds the overage to what the tenant pays for the plan', () => {
    const upgraded = planCharge(PLANS, 'pro', 'essential'); // pays 325, allowance 1,000
    expect(statementFigures(upgraded, 1100)).toMatchObject({ planCharge: 325, extra: 100, overageAmount: 240, total: 565 });
  });

  it('rounds money to the centavo', () => {
    const f = statementFigures(planCharge(PLANS, 'max', null), 3007); // 7 × 1.5
    expect(f.overageAmount).toBe(10.5);
    expect(f.total).toBe(1510.5);
  });
});

describe('selectablePlans — never below what the Pilloto plan includes', () => {
  it('offers every plan when nothing is included', () => {
    expect(selectablePlans(tenant() as any, PLANS)).toEqual(['essential', 'pro', 'max']);
  });
  it('offers the included plan and larger ones', () => {
    expect(selectablePlans(tenant({ plan: 'pro' }) as any, PLANS)).toEqual(['essential', 'pro', 'max']);
    expect(selectablePlans(tenant({ plan: 'enterprise' }) as any, PLANS)).toEqual(['pro', 'max']);
  });
});

describe('planChangeKind', () => {
  it('tells upgrades, downgrades and no change apart', () => {
    expect(planChangeKind('essential', 'pro')).toBe('upgrade');
    expect(planChangeKind('max', 'pro')).toBe('downgrade');
    expect(planChangeKind('pro', 'pro')).toBe('none');
  });
});
