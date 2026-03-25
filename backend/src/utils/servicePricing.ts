import ServicePrice, { IServicePrice } from '../models/ServicePrice';
import Service from '../models/Service';
import TaxModel from '../models/Tax';
import type { TaxBreakdown } from './pricing';

export interface ServicePriceInput {
  serviceId: string;
  date: Date;
  adults: number;
  children: number;
  /** Number of rooms — used when chargeBasis = 'perRoom' */
  rooms?: number;
  companyId?: string;
  guestEmail?: string;
}

export interface ServicePriceResult {
  service: { _id: string; name: string; kind: string; chargeBasis: string } | null;
  servicePrice: { _id: string; category: string; adultPrice: number; childrenPrice: number } | null;
  quantity: number;
  unitPrice: number;
  baseSubtotal: number;
  taxes: TaxBreakdown[];
  totalTaxes: number;
  finalTotal: number;
}

/**
 * Resolve the best ServicePrice for the given inputs.
 *
 * Priority (highest → lowest):
 *   1. guest   — exact email match within valid date range
 *   2. company — company match within valid date range
 *   3. special — date-range price (no guest/company filter)
 *   4. standard — everyday / weekdays / weekend
 */
async function resolveBestServicePrice(
  serviceId: string,
  date: Date,
  companyId?: string,
  guestEmail?: string
): Promise<IServicePrice | null> {
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);

  const dayOfWeek = date.getDay(); // 0 = Sunday ... 6 = Saturday

  // Helper: is a custom-validity price active on this date?
  const customDateFilter = {
    validity: 'custom',
    startDate: { $lte: dayEnd },
    endDate: { $gte: dayStart },
  };

  // Helper: does a standard price match the day-of-week?
  const standardValidityFilter = {
    $or: [
      { validity: 'everyday' },
      { validity: 'weekdays', $expr: { $and: [{ $gte: [dayOfWeek, 1] }, { $lte: [dayOfWeek, 5] }] } },
      { validity: 'weekend', $expr: { $in: [dayOfWeek, [0, 6]] } },
      customDateFilter,
    ],
  };

  const base = { serviceId, isActive: true };

  // 1. Guest price
  if (guestEmail) {
    const p = await ServicePrice.findOne({
      ...base,
      category: 'guest',
      guestEmail: guestEmail.toLowerCase().trim(),
      ...customDateFilter,
    }).exec();
    if (p) return p;
  }

  // 2. Company price
  if (companyId) {
    const p = await ServicePrice.findOne({
      ...base,
      category: 'company',
      companyId,
      ...customDateFilter,
    }).exec();
    if (p) return p;
  }

  // 3. Special price (date-range, no guest/company)
  const special = await ServicePrice.findOne({
    ...base,
    category: 'special',
    ...customDateFilter,
  }).exec();
  if (special) return special;

  // 4. Standard price matching validity
  const standard = await ServicePrice.findOne({
    ...base,
    category: 'standard',
    ...(standardValidityFilter as any),
  }).exec();
  return standard;
}

/**
 * Calculate the full price for a service, including taxes.
 * Mirrors `calculateTieredPrice` for rooms.
 */
export async function calculateServicePrice(
  input: ServicePriceInput
): Promise<ServicePriceResult> {
  const {
    serviceId,
    date,
    adults,
    children,
    rooms = 1,
    companyId,
    guestEmail,
  } = input;

  // ── Load service ──────────────────────────────────────────
  const service = await Service.findById(serviceId).exec();
  if (!service) {
    return {
      service: null,
      servicePrice: null,
      quantity: 0,
      unitPrice: 0,
      baseSubtotal: 0,
      taxes: [],
      totalTaxes: 0,
      finalTotal: 0,
    };
  }

  // ── Resolve best price ────────────────────────────────────
  const resolved = await resolveBestServicePrice(serviceId, date, companyId, guestEmail);

  if (!resolved) {
    return {
      service: { _id: String(service._id), name: service.name, kind: service.kind, chargeBasis: service.chargeBasis },
      servicePrice: null,
      quantity: 0,
      unitPrice: 0,
      baseSubtotal: 0,
      taxes: [],
      totalTaxes: 0,
      finalTotal: 0,
    };
  }

  // ── Determine quantity & unit price based on chargeBasis ──
  let quantity = 1;
  let unitPrice = 0;

  switch (service.chargeBasis) {
    case 'perPerson':
      // Adults and children each count as a person at their respective price
      quantity = adults + children;
      // Weighted average unit price (calcs subtotal correctly below)
      unitPrice = adults > 0 || children > 0
        ? (adults * resolved.adultPrice + children * resolved.childrenPrice) / (adults + children)
        : resolved.adultPrice;
      break;

    case 'perRoom':
      quantity = Math.max(1, rooms);
      unitPrice = resolved.adultPrice; // adultPrice = price per room
      break;

    case 'perStay':
    case 'perEvent':
      quantity = 1;
      unitPrice = resolved.adultPrice * adults + resolved.childrenPrice * children;
      break;
  }

  // For perPerson, subtotal = adults * adultPrice + children * childrenPrice
  let baseSubtotal: number;
  if (service.chargeBasis === 'perPerson') {
    baseSubtotal = adults * resolved.adultPrice + children * resolved.childrenPrice;
  } else {
    baseSubtotal = quantity * unitPrice;
  }

  // ── Apply taxes ───────────────────────────────────────────
  const activeTaxes = await TaxModel.find({ isActive: true }).sort({ priority: -1 }).exec();
  const taxBreakdowns: TaxBreakdown[] = [];
  let totalExclusiveTaxes = 0;

  for (const tax of activeTaxes) {
    let taxAmount = 0;

    if (tax.type === 'percentage') {
      taxAmount = baseSubtotal * (tax.value / 100);
    } else {
      // fixed
      if (tax.appliesTo === 'guest') {
        taxAmount = (adults + children) * tax.value;
      } else if (tax.appliesTo === 'room') {
        taxAmount = tax.value * Math.max(1, rooms);
      } else {
        taxAmount = tax.value;
      }
    }

    taxBreakdowns.push({
      name: tax.name,
      type: tax.type,
      amount: taxAmount,
      isInclusive: tax.isInclusive,
    });

    if (!tax.isInclusive) {
      totalExclusiveTaxes += taxAmount;
    }
  }

  const finalTotal = baseSubtotal + totalExclusiveTaxes;

  return {
    service: {
      _id: String(service._id),
      name: service.name,
      kind: service.kind,
      chargeBasis: service.chargeBasis,
    },
    servicePrice: {
      _id: String(resolved._id),
      category: resolved.category,
      adultPrice: resolved.adultPrice,
      childrenPrice: resolved.childrenPrice,
    },
    quantity,
    unitPrice,
    baseSubtotal,
    taxes: taxBreakdowns,
    totalTaxes: totalExclusiveTaxes,
    finalTotal,
  };
}
