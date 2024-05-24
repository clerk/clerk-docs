export default {
  overrides: [
    {
      files: ["*.mdx"],
      options: {
        parser: "remark",
        plugins: ["./prettier-remark.mjs"],
      },
    },
  ],
};
