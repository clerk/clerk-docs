module.exports = {
  env: {
    browser: true,
    es2021: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:mdx/recommended",
    "plugin:prettier/recommended",
  ],
  settings: {
    "mdx/code-blocks": true,
  },
  plugins: ["prettier"],
  overrides: [
    {
      env: {
        node: true,
      },
      files: [".eslintrc.{js,cjs}"],
      parserOptions: {
        sourceType: "script",
      },
    },
  ],
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
  rules: {
    indent: ["off", "tab"],
    "prefer-arrow-callback": "off",
    "prettier/prettier": [
      "error",
      {
        trailingComma: `es5`,
        semi: true,
        singleQuote: false,
        printWidth: 80,
        endOfLine: "auto",
      },
    ],
  },
};
