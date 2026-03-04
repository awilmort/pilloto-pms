export type PricingRule = {
  _id?: string;
  service: 'daypass' | 'pasatarde' | 'hospedaje';
  category: 'standard' | 'special' | 'guest';
  validity: 'everyday' | 'weekdays' | 'weekend' | 'custom';
  startDate?: string;
  endDate?: string;
  guestEmail?: string; // Set when category === 'guest'
  adultPrice: number;
  childrenPrice: number;
  roomPrice?: number; // Flat per-room nightly rate (used when accommodationPricingModel === 'perRoom')
  isActive?: boolean;
};

function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6; // Sunday:0, Saturday:6
}

function inRange(date: Date, start?: string, end?: string): boolean {
  if (!start || !end) return false;
  const d = new Date(date.toDateString());
  const s = new Date(new Date(start).toDateString());
  const e = new Date(new Date(end).toDateString());
  return d >= s && d <= e;
}

export function findApplicablePricing(rules: PricingRule[], date: Date, email?: string): PricingRule | null {
  const active = rules.filter(r => r.isActive !== false);
  // 0) Guest pricing (highest priority when email matches and date is in range)
  if (email) {
    const guestRule = active
      .filter(r => r.category === 'guest' && r.guestEmail === email)
      .find(r => inRange(date, r.startDate, r.endDate));
    if (guestRule) return guestRule;
  }
  // 1) Special pricing within date range takes precedence
  const specials = active.filter(r => r.category === 'special');
  const specialForDate = specials.find(r => inRange(date, r.startDate, r.endDate));
  if (specialForDate) return specialForDate;

  // 2) Standard pricing fallback
  const standards = active.filter(r => r.category === 'standard');
  // everyday
  const everyday = standards.find(r => r.validity === 'everyday');
  if (everyday) return everyday;
  // weekday/weekend
  const weekend = standards.find(r => r.validity === 'weekend');
  const weekdays = standards.find(r => r.validity === 'weekdays');
  if (isWeekend(date) && weekend) return weekend;
  if (!isWeekend(date) && weekdays) return weekdays;
  // custom window
  const customs = standards.filter(r => r.validity === 'custom');
  const customForDate = customs.find(r => inRange(date, r.startDate, r.endDate));
  if (customForDate) return customForDate;

  return null;
}

/**
 * Returns the best standard (date-independent) pricing rule for a service.
 * Priority: everyday > weekdays > weekend > custom > any active standard.
 * Used when no check-in date is available or when special pricing does not apply.
 */
export function findStandardPricing(rules: PricingRule[]): PricingRule | null {
  const active = rules.filter(r => r.isActive !== false && r.category === 'standard');
  return (
    active.find(r => r.validity === 'everyday') ??
    active.find(r => r.validity === 'weekdays') ??
    active.find(r => r.validity === 'weekend') ??
    active[0] ??
    null
  );
}
