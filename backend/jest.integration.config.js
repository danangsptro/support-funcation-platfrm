/** Integration test: PostgreSQL nyata pada database *_test (lihat test/setup). */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/integration/**/*.int-spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  globalSetup: '<rootDir>/test/setup/global-setup.ts',
  testTimeout: 30000,
};
