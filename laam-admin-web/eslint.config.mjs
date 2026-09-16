import nextConfig from "eslint-config-next";

const eslintConfig = [
  ...nextConfig,
  {
    ignores: [".next/**", "playwright-report/**", "test-results/**"],
  },
];

export default eslintConfig;
