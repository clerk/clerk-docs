import { remark } from "remark";
import remarkFrontmatter from "remark-frontmatter";
import remarkMdx from "remark-mdx";

export const parsers = {
  remark: {
    astFormat: "remark",
    parse(text) {
      return { text };
    },
  },
};

export const printers = {
  remark: {
    async print(ast) {
      let text = ast.stack[0].text;
      let file = await remark()
        .data("settings", {
          bullet: "-",
          bulletOther: "*",
          rule: "-",
          emphasis: "_",
          quote: "'",
        })
        .use(remarkFrontmatter)
        .use(remarkMdx, { printWidth: 120 })
        .process(text);
      return String(file);
    },
  },
};
