/**
 * Unit tests for the iCal → channelSource migration helpers
 * (scripts/migrate-ical-to-channel-source.ts). The script's database side is
 * exercised by its dry run / --apply against a local copy (plan Phase 1.1).
 */

import mongoose from 'mongoose';
import { toChannelSource, buildReservationUpdate, OTA_COLLECTIONS } from '../scripts/migrate-ical-to-channel-source';
import Reservation from '../models/Reservation';

describe('toChannelSource', () => {
  it('maps provider and importedAt to an ical_legacy channelSource', () => {
    const importedAt = new Date('2026-05-01T12:00:00Z');
    expect(toChannelSource({
      provider: 'airbnb',
      importedAt,
      externalEventId: new mongoose.Types.ObjectId(),
      mappingId: new mongoose.Types.ObjectId(),
      externalUid: 'abc@airbnb.com',
    })).toEqual({ provider: 'ical_legacy', otaName: 'airbnb', importedAt });
  });

  it('omits missing fields instead of writing undefined', () => {
    const result = toChannelSource({});
    expect(result).toEqual({ provider: 'ical_legacy' });
    expect(Object.keys(result)).toEqual(['provider']);
  });
});

describe('buildReservationUpdate', () => {
  it('sets channelSource and unsets otaSource', () => {
    expect(buildReservationUpdate({ otaSource: { provider: 'vrbo' } })).toEqual({
      $set: { channelSource: { provider: 'ical_legacy', otaName: 'vrbo' } },
      $unset: { otaSource: '' },
    });
  });

  it('never overwrites an existing channelSource, but still removes otaSource', () => {
    expect(buildReservationUpdate({
      otaSource: { provider: 'airbnb' },
      channelSource: { provider: 'channex', otaName: 'Airbnb' },
    })).toEqual({ $unset: { otaSource: '' } });
  });
});

describe('migration targets', () => {
  it('covers exactly the four iCal collections', () => {
    expect([...OTA_COLLECTIONS].sort()).toEqual(['otaconflicts', 'otaexternalevents', 'otalistingmappings', 'otasyncruns']);
  });

  it('produces a channelSource the Reservation schema accepts', () => {
    const { $set } = buildReservationUpdate({ otaSource: { provider: 'booking', importedAt: new Date() } });
    const doc = new Reservation({ channelSource: $set!.channelSource });
    const err = doc.validateSync(['channelSource']);
    expect(err?.errors?.['channelSource.provider']).toBeUndefined();
    expect(doc.channelSource?.provider).toBe('ical_legacy');
    expect(doc.channelSource?.otaName).toBe('booking');
  });

  it('rejects an unknown channelSource provider', () => {
    const doc = new Reservation({ channelSource: { provider: 'ical' } });
    const err = doc.validateSync(['channelSource.provider']);
    expect(err?.errors?.['channelSource.provider']).toBeDefined();
  });
});
