import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  {
    // *.nosync: node_modules and .next live there on iCloud-synced folders (see .gitignore).
    ignores: [".next/**", "node_modules/**", "*.nosync/**", "public/**", "next-env.d.ts", "coverage/**"],
  },
];

export default config;
