module.exports = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['@testing-library/jest-dom'],
  collectCoverageFrom: ['src/**/*.{js,jsx}', '!src/main.jsx'],
};
