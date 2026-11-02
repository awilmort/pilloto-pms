/**
 * Airbnb booking requests (CHANNEX_ARCHITECTURE.md §7.7; plan Phase 9.2).
 *
 * `reservation_request`, `alteration_request` and `inquiry` webhooks become critical alerts
 * with a 24 h deadline (webhookHandler.ts). Staff answer from the Channel Alerts page:
 *
 *   reservation request  accept → {accept: true}; decline → {accept: false, reason,
 *                        decline_message_to_guest?, decline_message_to_airbnb?}
 *   alteration request   accept/decline → {accept: "accept" | "decline"}
 *   inquiry              pre-approve → {type: "preapproval"} (there is no decline call: an
 *                        unanswered inquiry lapses, so "decline" only closes the alert)
 *
 * sent as `POST /live_feed/:id/resolve` with `{resolution: …}`. Resolving an event that was
 * already answered (e.g. from the Airbnb app) returns it unchanged; Pilloto then records
 * Channex's resolution instead of its own. An accepted request arrives afterwards as a normal
 * `new` booking revision.
 *
 * When the webhook did not carry the live feed event id, it is looked up in the live feed
 * (`GET /live_feed`, newest first, same property and event kind, not resolved).
 */

import mongoose from 'mongoose';
import ChannelAlert, { ChannelAlertType, IChannelAlert } from '../../models/ChannelAlert';
import ChannexEntityMap from '../../models/ChannexEntityMap';
import ChannexProperty from '../../models/ChannexProperty';
import RoomType from '../../models/RoomType';
import { ChannexClient, ChannexError, ChannexRetryableError, ChannexValidationError } from './channexClient';
import { airbnbRequestFacts } from './alerts.service';
import { getChannexConfig } from './config';
import { eachNight, fromChannexDate } from './dates';
import { getAvailability } from './inventory.service';

export const AIRBNB_DECLINE_REASONS = ['dates_not_available', 'not_a_good_fit', 'waiting_for_better_reservation', 'not_comfortable'] as const;
export type AirbnbDeclineReason = typeof AIRBNB_DECLINE_REASONS[number];
export type AirbnbDecision = 'accept' | 'decline';

const EVENT_OF: Partial<Record<ChannelAlertType, string>> = {
  airbnb_reservation_request: 'reservation_request',
  airbnb_alteration_request: 'alteration_request',
  airbnb_inquiry: 'inquiry',
};
export const isAirbnbRequestType = (t: string): t is 'airbnb_reservation_request' | 'airbnb_alteration_request' | 'airbnb_inquiry' => t in EVENT_OF;

export interface DecisionInput {
  decision: AirbnbDecision;
  reason?: string;
  messageToGuest?: string;
  messageToAirbnb?: string;
}

/** Validated `resolution` object for the request kind, or null when nothing is sent (declining an inquiry). */
export function resolutionBody(type: ChannelAlertType, input: DecisionInput): { resolution: Record<string, unknown> } | null | { error: string } {
  if (input.decision !== 'accept' && input.decision !== 'decline') return { error: 'decision must be accept or decline.' };
  if (type === 'airbnb_reservation_request') {
    if (input.decision === 'accept') return { resolution: { accept: true } };
    const reason = input.reason ?? 'not_comfortable';
    if (!(AIRBNB_DECLINE_REASONS as readonly string[]).includes(reason)) return { error: `reason must be one of ${AIRBNB_DECLINE_REASONS.join(', ')}.` };
    const toGuest = input.messageToGuest?.trim().slice(0, 1000);
    const toAirbnb = input.messageToAirbnb?.trim().slice(0, 1000);
    return { resolution: { accept: false, reason, ...(toGuest ? { decline_message_to_guest: toGuest } : {}), ...(toAirbnb ? { decline_message_to_airbnb: toAirbnb } : {}) } };
  }
  if (type === 'airbnb_alteration_request') return { resolution: { accept: input.decision } };
  if (type === 'airbnb_inquiry') return input.decision === 'accept' ? { resolution: { type: 'preapproval' } } : null;
  return { error: 'This alert is not an Airbnb request.' };
}

/** Channex's answer state of a live feed event (`payload.resolved` / `payload.resolution`). */
export function liveFeedState(body: any): { resolved: boolean; resolution?: string } {
  const res = body?.data ?? body;
  const payload = res?.attributes?.payload ?? res?.payload ?? {};
  const resolution = typeof payload.resolution === 'string' ? payload.resolution
    : typeof payload.status === 'string' ? payload.status.toLowerCase() : undefined;
  return { resolved: payload.resolved === true || Boolean(resolution && resolution !== 'pending'), resolution };
}

/** Find the live feed event of a request alert when the webhook did not carry its id. */
async function findLiveFeedEventId(client: ChannexClient, alert: IChannelAlert, channexPropertyId: string): Promise<string | undefined> {
  const event = EVENT_OF[alert.type];
  const body = await client.get('/live_feed', {
    'filter[property_id]': channexPropertyId, 'filter[event]': event, 'order[inserted_at]': 'desc', 'pagination[limit]': 25,
  });
  const facts = airbnbRequestFacts(alert.details);
  const items: any[] = Array.isArray(body?.data) ? body.data : [];
  const candidates = items.filter((e) => !liveFeedState(e).resolved);
  const factsOf = (e: any) => airbnbRequestFacts({ payload: e?.attributes?.payload ?? e?.payload });
  // Strongest evidence first: booking id, then OTA code, then same stay and guest
  const tests: ((e: any) => boolean)[] = [
    (e) => Boolean(alert.channexBookingId) && (e?.attributes?.payload?.bms?.booking_id ?? e?.payload?.bms?.booking_id) === alert.channexBookingId,
    (e) => Boolean(facts.otaReservationCode) && factsOf(e).otaReservationCode === facts.otaReservationCode,
    (e) => Boolean(facts.checkIn) && factsOf(e).checkIn === facts.checkIn && factsOf(e).guestName === facts.guestName,
  ];
  let match: any;
  for (const test of tests) { match = candidates.find(test); if (match) break; }
  if (!match && candidates.length === 1) match = candidates[0];
  return typeof match?.id === 'string' ? match.id : undefined;
}

export type AirbnbAnswerResult =
  | { ok: true; alreadyResolved: boolean; resolution?: string; sent: boolean }
  | { ok: false; reason: 'not_found' | 'invalid' | 'not_request' | 'closed' | 'not_active' | 'rejected' | 'unavailable' | 'not_supported'; message: string };

/**
 * Answer an Airbnb request from its alert (tenant scope). On success (or when it was already
 * answered elsewhere) the alert is resolved with the decision in `details.decision`.
 */
export async function answerAirbnbRequest(
  alertId: string, input: DecisionInput, deps: { client: ChannexClient; userId?: unknown; now?: Date },
): Promise<AirbnbAnswerResult> {
  if (!mongoose.Types.ObjectId.isValid(alertId)) return { ok: false, reason: 'not_found', message: 'Alert not found.' };
  const alert = await ChannelAlert.findById(alertId);
  if (!alert) return { ok: false, reason: 'not_found', message: 'Alert not found.' };
  if (!isAirbnbRequestType(alert.type)) return { ok: false, reason: 'not_request', message: 'This alert is not an Airbnb request.' };
  if (alert.status === 'resolved' || alert.status === 'dismissed') return { ok: false, reason: 'closed', message: 'This request was already answered.' };
  const body = resolutionBody(alert.type, input);
  if (body && 'error' in body) return { ok: false, reason: 'invalid', message: body.error };
  const now = deps.now ?? new Date();

  const finish = async (outcome: { alreadyResolved: boolean; resolution?: string; sent: boolean }) => {
    alert.status = 'resolved';
    alert.resolvedAt = now;
    alert.resolvedBy = deps.userId ? new mongoose.Types.ObjectId(String(deps.userId)) : undefined;
    alert.autoResolved = false;
    alert.emailPending = false;
    alert.details = {
      ...(alert.details ?? {}),
      decision: {
        decision: input.decision, ...(input.reason && input.decision === 'decline' ? { reason: input.reason } : {}),
        at: now, alreadyResolved: outcome.alreadyResolved, resolution: outcome.resolution, sent: outcome.sent,
      },
    };
    alert.markModified('details');
    await alert.save();
    return { ok: true as const, ...outcome };
  };

  // Declining an inquiry: nothing to send, the inquiry simply lapses
  if (body === null) return finish({ alreadyResolved: false, sent: false });

  const property = await ChannexProperty.findOne({ environment: deps.client.config.environment });
  if (!property?.channexPropertyId) return { ok: false, reason: 'not_active', message: 'The channel manager is not active.' };

  try {
    let id = alert.liveFeedEventId;
    if (!id) {
      id = await findLiveFeedEventId(deps.client, alert, property.channexPropertyId);
      if (!id) return { ok: false, reason: 'not_found', message: 'The request could not be found on the channel any more. Answer it from the Airbnb app.' };
      alert.liveFeedEventId = id;
    }
    const res = await deps.client.post(`/live_feed/${encodeURIComponent(id)}/resolve`, body);
    const state = liveFeedState(res);
    const ours = input.decision === 'accept' ? /accept|preapprov|approved/i : /declin|reject|denied/i;
    const alreadyResolved = Boolean(state.resolution) && !ours.test(state.resolution!);
    return finish({ alreadyResolved, resolution: state.resolution, sent: true });
  } catch (err) {
    if (err instanceof ChannexError && err.status === 404) {
      return { ok: false, reason: 'not_found', message: 'The request could not be found on the channel any more. Answer it from the Airbnb app.' };
    }
    if (err instanceof ChannexValidationError) {
      const notSupported = err.code === 'not_supported';
      return {
        ok: false, reason: notSupported ? 'not_supported' : 'rejected',
        message: notSupported ? 'This request cannot be answered from Pilloto. Answer it from the Airbnb app.' : 'Airbnb did not accept the answer. It may have expired; check it in the Airbnb app.',
      };
    }
    if (err instanceof ChannexRetryableError) return { ok: false, reason: 'unavailable', message: 'Airbnb could not be reached. Try again in a minute.' };
    throw err;
  }
}

/** Availability of the requested nights (the requested room type when it is mapped, else every type). */
export async function requestAvailability(alert: Pick<IChannelAlert, 'details'>) {
  const facts = airbnbRequestFacts(alert.details);
  if (!facts.checkIn || !facts.checkOut || facts.checkOut <= facts.checkIn) return null;
  const nights = eachNight(fromChannexDate(facts.checkIn), fromChannexDate(facts.checkOut));
  if (!nights.length || nights.length > 60) return null;
  const map = facts.channexRoomTypeId
    ? await ChannexEntityMap.findOne({ environment: getChannexConfig().environment, kind: 'room_type', channexId: facts.channexRoomTypeId }).select('localId').lean()
    : null;
  const types = await RoomType.find(map ? { _id: map.localId } : { isActive: true }).select('_id name').sort({ name: 1 }).lean();
  if (!types.length) return null;
  const grid = await getAvailability({ dateFrom: nights[0], dateTo: nights[nights.length - 1], roomTypeIds: types.map((t) => String(t._id)) });
  return {
    nights,
    requestedRoomType: Boolean(map),
    roomTypes: types.map((t) => {
      const perNight = nights.map((d) => ({ date: d, available: grid[String(t._id)]?.[d] ?? 0 }));
      return { roomTypeId: String(t._id), name: t.name, nights: perNight, bookable: perNight.every((n) => n.available > 0) };
    }),
  };
}
