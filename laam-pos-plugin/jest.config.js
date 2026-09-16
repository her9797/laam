module.exports = {
  rootDir: "src",
  transform: {
    "^.+\\.ts$": "ts-jest"
  },
  testMatch: ["**/*.test.ts"],
  testEnvironment: "node"
};
