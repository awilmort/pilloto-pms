import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  clearMocks: true,
  // Many suites run against a throwaway local Mongo DB in parallel; 5 s is too tight under that load
  testTimeout: 30_000,
  collectCoverageFrom: ['src/routes/booking.ts'],
};

export default config;
