import mongoose, { Document, Schema } from 'mongoose';
import { tenantPlugin } from '../plugins/tenantPlugin';
import { changeCapturePlugin } from '../services/channex/changeCapture';

export type RateSelectionReason = 'manual' | 'contract' | 'promo' | 'default' | 'cheapest' | 'restricted';

// ── Reservation Item (service or room line item) ─────────────
export interface IReservationItem {
  kind: 'room' | 'service';
  // Room-specific (kind='room')
  roomTypeId?: mongoose.Types.ObjectId;
  ratePlanId?: mongoose.Types.ObjectId;
  /** Name of the rate plan when the room was booked (the plan may be renamed or deleted later) */
  ratePlanName?: string;
  /**
   * How the rate plan was chosen: 'manual' (staff or guest picked it), or the automatic
   * pre-selection that applied — 'contract' (guest/company rule), 'promo' (promo code),
   * 'default' (room type's default plan), 'cheapest' (cheapest open plan), 'restricted'
   * (no plan was open; staff booked anyway). Not set on OTA bookings (the OTA chose).
   */
  rateSelection?: RateSelectionReason;
  checkIn?: Date;
  checkOut?: Date;
  // Service-specific (kind='service')
  serviceId?: mongoose.Types.ObjectId;
  servicePriceId?: mongoose.Types.ObjectId;
  /** Admin override — skips service pricing look-up */
  manualPriceOverride?: number;
  /** For service company pricing */
  companyId?: mongoose.Types.ObjectId;
  guestEmail?: string;
  // Common
  date?: Date;
  adults?: number;
  children?: number;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  taxes: Array<{ name: string; type: string; amount: number; isInclusive: boolean }>;
  totalTaxes: number;
  total: number;
}

export interface IReservation extends Document {
  user?: mongoose.Types.ObjectId; // Optional for guest bookings

  // Guest identification (required when user is not logged in)
  guestName?: {
    firstName: string;
    lastName: string;
  };

  // Unique confirmation token for guest access
  confirmationToken?: string;

  // Human-friendly reservation code (e.g., B25AB12)
  reservationCode?: string;

  // Reservation type - determines which fields are required
  type: 'room' | 'daypass' | 'PasaTarde' | 'event';

  // Room-specific fields (required for room reservations)
  room?: mongoose.Types.ObjectId; // Specific room assigned by admin
  rooms?: mongoose.Types.ObjectId[]; // Multiple rooms assigned (optional)
  roomCount?: number; // Number of rooms requested at booking time

  // Event-specific fields (required for event reservations)
  // Accept any identifier matching EventType.type (e.g., 'boda')
  eventType?: string;
  eventDescription?: string;
  expectedAttendees?: number;

  // Common date fields
  checkInDate: Date;
  checkOutDate?: Date; // Optional for day pass and some events

  // Operational timestamps
  actualCheckInAt?: Date;
  actualCheckOutAt?: Date;

  // Identification document provided at check-in (e.g., ID number or file reference)
  identificationDocument?: string;
  identificationType?: 'cedula' | 'pasaporte' | 'rnc';

  // Guest information
  guests: number;
  guestDetails: {
    adults: number;
    children: number;
    infants: number;
  };

  // Line items — each room stay or service is represented as an item.
  // Optional for backward compat: legacy reservations without items still work.
  items?: IReservationItem[];

  /** Derived from items: 'room' | 'service' | 'mixed' | 'unknown' */
  primaryKind?: 'room' | 'service' | 'mixed' | 'unknown';

  // Pricing and payment
  // Immutable snapshot of pricing calculated at booking time (tiered rate plan)
  pricingSnapshot?: {
    ratePlanId: string;
    ratePlanName: string;
    roomTypeName: string;
    basePrice: number;
    occupancyCost: number;
    subtotal: number;
    adjustedSubtotal: number;
    taxes: Array<{ name: string; type: 'percentage' | 'fixed'; amount: number; isInclusive: boolean }>;
    totalTaxes: number;
    finalTotal: number;
    nights: number;
  };
  estimatedTotal: number;
  totalPrice?: number; // compatibility alias (virtual)
  /** Absolute amount discounted from the calculated total. Immutable after creation. */
  discountAmount?: number;
  /** Percentage applied to derive discountAmount. For audit only. */
  discountPercent?: number;
  /** Staff-entered reason for the discount. */
  discountReason?: string;
  /** Promo code that unlocked a private rate plan on this reservation (upper case) */
  promoCode?: string;
  totalPayments: number;
  status: 'pending' | 'confirmed' | 'cancelled' | 'checked-in' | 'completed';

  // Contact and requests
  contactInfo: {
    phone?: string;
    email: string;
    emergencyContact?: string;
  };
  specialRequests?: string;

  // Calculated fields
  totalNights?: number; // For room reservations
  totalDays?: number; // For multi-day events

  // Corporate booking
  isCorporate?: boolean;
  company?: mongoose.Types.ObjectId; // ref: 'Company'
  /** Corporate price approval flow: pending → approved | declined */
  corporatePriceStatus?: 'pending' | 'approved' | 'declined';
  /** Company requested by the guest when isCorporate is pending */
  requestedCompany?: mongoose.Types.ObjectId; // ref: 'Company'

  // Linked guest record (auto-created/upserted from contactInfo.email)
  guestRecord?: mongoose.Types.ObjectId; // ref: 'Guest'

  // Administrative fields
  cancellationReason?: string;
  assignedBy?: mongoose.Types.ObjectId; // Admin who assigned the room/approved event
  assignedAt?: Date;

  // Channel source — set only for reservations that arrived from an OTA
  // (Channex booking revisions, or legacy iCal imports migrated as 'ical_legacy')
  channelSource?: {
    provider: 'channex' | 'ical_legacy';
    otaName?: string;                 // e.g. 'Booking.com', 'airbnb'
    otaCode?: string;                 // prefix of uniqueId, e.g. 'BDC'
    otaReservationCode?: string;
    uniqueId?: string;                // Channex unique_id, e.g. 'BDC-123456'
    channexBookingId?: string;
    channexPropertyId?: string;
    channelId?: string;
    lastRevisionId?: string;
    lastRevisionInsertedAt?: Date;
    paymentCollect?: 'property' | 'ota';
    paymentType?: string;
    otaCommission?: number;
    currency?: string;
    /** Masked guarantee only — never full card data */
    guaranteeSummary?: {
      cardType?: string;
      last4?: string;
      expirationDate?: string;
      isVirtual?: boolean;
      virtualCardCurrency?: string;
      virtualCardBalance?: number;
      virtualCardActivationDate?: string;
    };
    importedAt?: Date;
  };

  createdAt: Date;
  updatedAt: Date;
}

const reservationItemSchema = new Schema<IReservationItem>(
  {
    kind: { type: String, enum: ['room', 'service'], required: true },
    roomTypeId: { type: Schema.Types.ObjectId, ref: 'RoomType' },
    ratePlanId: { type: Schema.Types.ObjectId, ref: 'RatePlan' },
    ratePlanName: { type: String, trim: true, maxlength: 200 },
    rateSelection: { type: String, enum: ['manual', 'contract', 'promo', 'default', 'cheapest', 'restricted'] },
    checkIn: { type: Date },
    checkOut: { type: Date },
    serviceId: { type: Schema.Types.ObjectId, ref: 'Service' },
    servicePriceId: { type: Schema.Types.ObjectId, ref: 'ServicePrice' },
    manualPriceOverride: { type: Number, min: 0 },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company' },
    guestEmail: { type: String },
    date: { type: Date },
    adults: { type: Number, min: 0 },
    children: { type: Number, min: 0 },
    quantity: { type: Number, required: true, min: 1, default: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    subtotal: { type: Number, required: true, min: 0 },
    // `type` is a field here, so it needs `{ type: String }` (a bare `type: String` makes the array [String])
    taxes: [{ name: String, type: { type: String }, amount: Number, isInclusive: Boolean }],
    totalTaxes: { type: Number, required: true, min: 0, default: 0 },
    total: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const reservationSchema = new Schema<IReservation>({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: false // Allow null for guest bookings
  },

  // Guest identification (required when user is not provided)
  guestName: {
    firstName: {
      type: String,
      required: false,
      trim: true
    },
    lastName: {
      type: String,
      required: false,
      trim: true
    }
  },

  // Unique confirmation token for guest bookings
  confirmationToken: {
    type: String,
    unique: true,
    sparse: true, // Allow multiple null values
    // unique implies an index; no need for additional index flag
  },

  // Human-friendly reservation code
  reservationCode: {
    type: String,
    unique: true,
    sparse: true,
    // unique implies an index; no need for additional index flag
  },

  // Reservation type
  type: {
    type: String,
    enum: ['room', 'daypass', 'PasaTarde', 'event'],
    required: true
  },

  // Room-specific fields
  room: {
    type: Schema.Types.ObjectId,
    ref: 'Room',
    required: false // Optional - assigned by admin later for room reservations
  },
  rooms: [{
    type: Schema.Types.ObjectId,
    ref: 'Room',
    required: false
  }],
  roomCount: {
    type: Number,
    min: 1,
    required: false,
  },

  // Event-specific fields
  eventType: {
    type: String,
    required: false // Only required for event reservations
  },
  eventDescription: {
    type: String,
    required: false
  },
  expectedAttendees: {
    type: Number,
    min: 1,
    required: false // Only for events
  },

  // Common date fields
  checkInDate: {
    type: Date,
    required: true
  },
  checkOutDate: {
    type: Date,
    required: false, // Optional for day pass and some events
    validate: {
      validator: function (this: IReservation, value: Date) {
        return !value || value > this.checkInDate;
      },
      message: 'Check-out date must be after check-in date'
    }
  },

  // Operational timestamps
  actualCheckInAt: {
    type: Date,
    required: false
  },
  actualCheckOutAt: {
    type: Date,
    required: false
  },

  identificationDocument: {
    type: String,
    trim: true,
    maxlength: 200,
    required: false
  },
  identificationType: {
    type: String,
    enum: ['cedula', 'pasaporte', 'rnc'],
    required: false
  },

  // Guest information
  guests: {
    type: Number,
    required: true,
    min: 1
  },

  // Pricing and payment
  pricingSnapshot: {
    ratePlanId: { type: String },
    ratePlanName: { type: String },
    roomTypeName: { type: String },
    basePrice: { type: Number },
    occupancyCost: { type: Number },
    subtotal: { type: Number },
    adjustedSubtotal: { type: Number },
    // `type` is a field here, so it needs `{ type: String }` (a bare `type: String` makes the array [String])
    taxes: [{ name: String, type: { type: String }, amount: Number, isInclusive: Boolean }],
    totalTaxes: { type: Number },
    finalTotal: { type: Number },
    nights: { type: Number },
  },
  estimatedTotal: {
    type: Number,
    required: true,
    min: 0
  },
  discountAmount:  { type: Number, min: 0, default: 0 },
  discountPercent: { type: Number, min: 0, max: 100, default: 0 },
  discountReason:  { type: String, trim: true, maxlength: 300, default: '' },
  promoCode:       { type: String, trim: true, uppercase: true, maxlength: 30 },
  totalPayments: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'cancelled', 'checked-in', 'completed'],
    default: 'pending'
  },

  // Contact and requests
  specialRequests: {
    type: String,
    maxlength: 1000 // Increased for events
  },
  guestDetails: {
    adults: {
      type: Number,
      required: true,
      min: 1
    },
    children: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    infants: {
      type: Number,
      default: 0,
      min: 0,
      max: 50
    }
  },
  contactInfo: {
    phone: {
      type: String,
      required: false,
      // No strict format validation
    },
    email: {
      type: String,
      required: true,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
    },
    emergencyContact: {
      type: String,
      // No strict format validation
    },
    country: {
      type: String,
      trim: true
    }
  },

  // Calculated fields
  totalNights: {
    type: Number,
    min: 0 // Optional field, calculated for room reservations
  },
  totalDays: {
    type: Number,
    min: 1 // For multi-day events
  },
  cancellationReason: {
    type: String,
    maxlength: 500
  },
  assignedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  assignedAt: {
    type: Date,
    required: false
  },

  // Channel source (OTA bookings)
  channelSource: {
    type: new Schema(
      {
        provider:               { type: String, enum: ['channex', 'ical_legacy'], required: true },
        otaName:                { type: String, maxlength: 80 },
        otaCode:                { type: String, maxlength: 20 },
        otaReservationCode:     { type: String, maxlength: 120 },
        uniqueId:               { type: String, maxlength: 120 },
        channexBookingId:       { type: String, maxlength: 64 },
        channexPropertyId:      { type: String, maxlength: 64 },
        channelId:              { type: String, maxlength: 64 },
        lastRevisionId:         { type: String, maxlength: 64 },
        lastRevisionInsertedAt: { type: Date },
        paymentCollect:         { type: String, enum: ['property', 'ota'] },
        paymentType:            { type: String, maxlength: 40 },
        otaCommission:          { type: Number },
        currency:               { type: String, maxlength: 3 },
        guaranteeSummary: {
          cardType:                  { type: String, maxlength: 40 },
          last4:                     { type: String, maxlength: 4 },
          expirationDate:            { type: String, maxlength: 10 },
          isVirtual:                 { type: Boolean },
          virtualCardCurrency:       { type: String, maxlength: 3 },
          virtualCardBalance:        { type: Number },
          virtualCardActivationDate: { type: String, maxlength: 10 },
        },
        importedAt:             { type: Date },
      },
      {
        _id: false,
        // White-label (architecture §18): API responses never carry Channex ids. Code reading
        // the document (booking mapper, platform console) still sees them.
        toJSON: {
          transform: (_doc: unknown, ret: Record<string, unknown>) => {
            delete ret.channexBookingId;
            delete ret.channexPropertyId;
            delete ret.channelId;
            delete ret.lastRevisionId;
            return ret;
          },
        },
      }
    ),
    required: false,
  },

  // Corporate booking
  isCorporate: {
    type: Boolean,
    default: false
  },
  company: {
    type: Schema.Types.ObjectId,
    ref: 'Company',
    required: false
  },
  corporatePriceStatus: {
    type: String,
    enum: ['pending', 'approved', 'declined'],
    required: false
  },
  requestedCompany: {
    type: Schema.Types.ObjectId,
    ref: 'Company',
    required: false
  },

  // Linked guest record
  guestRecord: {
    type: Schema.Types.ObjectId,
    ref: 'Guest',
    required: false
  },

  // Line items — optional, enables multi-item pricing for service reservations
  items: {
    type: [reservationItemSchema],
    default: undefined,
  },
}, {
  timestamps: true
});

// Pre-save middleware to calculate total nights/days and validate based on type
reservationSchema.pre('save', function (next) {
  // Calculate totalNights for room reservations
  if (this.type === 'room' && this.checkInDate && this.checkOutDate) {
    const timeDiff = this.checkOutDate.getTime() - this.checkInDate.getTime();
    this.totalNights = Math.ceil(timeDiff / (1000 * 3600 * 24));
  }

  // Calculate totalDays for events (or set to 1 for single-day events)
  if (this.type === 'event') {
    if (this.checkInDate && this.checkOutDate) {
      const timeDiff = this.checkOutDate.getTime() - this.checkInDate.getTime();
      this.totalDays = Math.ceil(timeDiff / (1000 * 3600 * 24)) + 1; // Include both start and end days
    } else {
      this.totalDays = 1; // Single-day event
    }
  }

  // For day pass and PasaTarde, no additional calculations needed
  if (this.type === 'daypass' || this.type === 'PasaTarde') {
    this.totalNights = 0;
    this.totalDays = 1;
  }

  // Type-specific validations
  // Room type is optional; admin assigns specific room later.

  if (this.type === 'event' && !this.eventType) {
    return next(new Error('Event type is required for event reservations'));
  }

  if (this.type === 'room' && !this.checkOutDate) {
    return next(new Error('Check-out date is required for room reservations'));
  }
  next();
});

// Index for efficient queries
reservationSchema.index({ user: 1, createdAt: -1 });
reservationSchema.index({ room: 1, checkInDate: 1, checkOutDate: 1 });
reservationSchema.index({ rooms: 1, checkInDate: 1, checkOutDate: 1 });
reservationSchema.index({ status: 1 });
reservationSchema.index({ checkInDate: 1, checkOutDate: 1 });
reservationSchema.index({ actualCheckInAt: 1 });
reservationSchema.index({ actualCheckOutAt: 1 });
reservationSchema.index({ 'channelSource.channexBookingId': 1 }, { sparse: true });
// reservationCode already has a unique index via field definition; avoid duplicate index

// Backward-compat alias during transition: totalPrice -> estimatedTotal
reservationSchema.virtual('totalPrice')
  .get(function (this: IReservation) {
    return this.estimatedTotal;
  })
  .set(function (this: IReservation, value: number) {
    this.estimatedTotal = value;
  });

// Derive primaryKind from items array
reservationSchema.virtual('primaryKind').get(function (this: IReservation) {
  if (!this.items || this.items.length === 0) return 'unknown';
  const kinds = new Set(this.items.map(i => i.kind));
  if (kinds.size === 1) return kinds.has('room') ? 'room' : 'service';
  return 'mixed';
});

// ── Status normalization ─────────────────────────────────────
// Ensures status is always consistent with actualCheckInAt/actualCheckOutAt.
// This guards against code paths that set timestamps without updating status.
reservationSchema.pre('save', function (next) {
  if (this.status === 'cancelled') { next(); return; }
  if (this.actualCheckOutAt) {
    this.status = 'completed';
  } else if (this.actualCheckInAt && (this.status === 'pending' || this.status === 'confirmed')) {
    this.status = 'checked-in';
  }
  next();
});

// ── Multi-tenancy ────────────────────────────────────────────
reservationSchema.plugin(tenantPlugin);
reservationSchema.plugin(changeCapturePlugin, { model: 'Reservation' });

const ReservationModel = mongoose.model<IReservation>('Reservation', reservationSchema);

/**
 * One-time migration: fix documents where check-in/check-out timestamps were
 * recorded but the status field was never updated (legacy data from before
 * the status-normalization hook was added).
 */
export async function migrateReservationStatuses(): Promise<void> {
  const [checkedIn, checkedOut] = await Promise.all([
    ReservationModel.updateMany(
      {
        actualCheckInAt: { $exists: true, $ne: null },
        actualCheckOutAt: { $exists: false },
        status: { $in: ['pending', 'confirmed'] },
      },
      { $set: { status: 'checked-in' } },
    ),
    ReservationModel.updateMany(
      {
        actualCheckOutAt: { $exists: true, $ne: null },
        status: { $in: ['pending', 'confirmed', 'checked-in'] },
      },
      { $set: { status: 'completed' } },
    ),
  ]);
  const total = checkedIn.modifiedCount + checkedOut.modifiedCount;
  if (total > 0) {
    console.log(`🔄 Reservation status migration: fixed ${checkedIn.modifiedCount} checked-in, ${checkedOut.modifiedCount} completed document(s)`);
  }
}

export default ReservationModel;
