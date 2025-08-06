module.exports = {
  testEnvironment: 'node',
  collectCoverageFrom: [
    'server/**/*.js',
    '!server/index.js',
    '!**/node_modules/**'
  ],
  testMatch: [
    '**/tests/**/*.test.js',
    '**/__tests__/**/*.js'
  ],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js']
};