import React from 'react';
import RoomIllustration from './RoomIllustration';
import AmenityIllustration from './AmenityIllustration';
import ServiceIllustration from './ServiceIllustration';
import EventIllustration from './EventIllustration';
import GuestIllustration from './GuestIllustration';
import MediaIllustration from './MediaIllustration';
import PoolIllustration from './PoolIllustration';
import FoodIllustration from './FoodIllustration';
import BasketballIllustration from './BasketballIllustration';
import BarIllustration from './BarIllustration';
import RestaurantIllustration from './RestaurantIllustration';
import SpaIllustration from './SpaIllustration';
import GymIllustration from './GymIllustration';
import BeachIllustration from './BeachIllustration';
import ParkingIllustration from './ParkingIllustration';
import WifiIllustration from './WifiIllustration';
import LaundryIllustration from './LaundryIllustration';
import KidsIllustration from './KidsIllustration';
import MeetingRoomIllustration from './MeetingRoomIllustration';
import GardenIllustration from './GardenIllustration';

export interface IllustrationEntry {
  key: string;
  label: string;
  component: React.FC<{ width?: number | string; height?: number | string; className?: string }>;
}

export const ILLUSTRATION_CATALOG: IllustrationEntry[] = [
  { key: 'room', label: 'Room', component: RoomIllustration },
  { key: 'amenity', label: 'Amenity', component: AmenityIllustration },
  { key: 'service', label: 'Service', component: ServiceIllustration },
  { key: 'event', label: 'Event', component: EventIllustration },
  { key: 'guest', label: 'Guest', component: GuestIllustration },
  { key: 'media', label: 'Media', component: MediaIllustration },
  { key: 'pool', label: 'Pool', component: PoolIllustration },
  { key: 'food', label: 'Food & Dining', component: FoodIllustration },
  { key: 'basketball', label: 'Basketball Court', component: BasketballIllustration },
  { key: 'bar', label: 'Bar', component: BarIllustration },
  { key: 'restaurant', label: 'Restaurant', component: RestaurantIllustration },
  { key: 'spa', label: 'Spa & Wellness', component: SpaIllustration },
  { key: 'gym', label: 'Gym & Fitness', component: GymIllustration },
  { key: 'beach', label: 'Beach', component: BeachIllustration },
  { key: 'parking', label: 'Parking', component: ParkingIllustration },
  { key: 'wifi', label: 'Wi-Fi', component: WifiIllustration },
  { key: 'laundry', label: 'Laundry', component: LaundryIllustration },
  { key: 'kids', label: 'Kids Area', component: KidsIllustration },
  { key: 'meeting-room', label: 'Meeting Room', component: MeetingRoomIllustration },
  { key: 'garden', label: 'Garden', component: GardenIllustration },
];

/**
 * Look up an illustration component by its catalog key.
 * Returns MediaIllustration as fallback when key is not found.
 */
export function getIllustrationByKey(key: string): React.FC<{ width?: number | string; height?: number | string; className?: string }> {
  const entry = ILLUSTRATION_CATALOG.find((e) => e.key === key);
  return entry ? entry.component : MediaIllustration;
}

/**
 * Check whether a URL string is an illustration reference (e.g. "illustration:pool").
 */
export function isIllustrationUrl(url: string | undefined): boolean {
  return typeof url === 'string' && url.startsWith('illustration:');
}

/**
 * Extract the catalog key from an illustration URL.
 * e.g. "illustration:pool" → "pool"
 */
export function getIllustrationKey(url: string): string {
  return url.replace('illustration:', '');
}
