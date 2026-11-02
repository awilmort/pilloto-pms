/**
 * Throwaway-database helper for DB-backed Channex tests. Connects to the local Mongo
 * (MONGODB_TEST_URI or mongodb://127.0.0.1:27017) with a random database name that is
 * dropped afterwards. `connectTestDb()` returns false when Mongo is unreachable so the
 * suite can skip instead of fail.
 */
import mongoose from 'mongoose';

export async function connectTestDb(prefix: string): Promise<boolean> {
  const base = process.env.MONGODB_TEST_URI || 'mongodb://127.0.0.1:27017';
  const name = `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  try {
    await mongoose.connect(`${base.replace(/\/+$/, '')}/${name}`, { serverSelectionTimeoutMS: 2000 });
    return true;
  } catch {
    return false;
  }
}

export async function dropTestDb(): Promise<void> {
  try {
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
  } finally {
    await mongoose.disconnect();
  }
}
