import { channelText, otaLabel, otaShortTag } from '../channels';

describe('channel labels', () => {
  it('names OTAs as hoteliers write them', () => {
    expect(otaLabel('BookingCom')).toBe('Booking.com');
    expect(otaLabel('AirBNB')).toBe('Airbnb');
    expect(otaLabel('airbnb')).toBe('Airbnb'); // legacy iCal import
    expect(otaLabel('Booking.com')).toBe('Booking.com');
    expect(otaLabel('SomeNewOta')).toBe('SomeNewOta');
    expect(otaLabel(undefined)).toBe('—');
  });

  it('short tag and badge text', () => {
    expect(otaShortTag({ otaCode: 'BDC', otaName: 'Booking.com' })).toBe('BDC');
    expect(otaShortTag({ otaName: 'airbnb' })).toBe('AIR');
    expect(channelText({ otaName: 'Booking.com', otaReservationCode: '4021337' })).toBe('Booking.com 4021337');
    expect(channelText({ otaName: 'Expedia' })).toBe('Expedia');
  });
});
