import fs from "node:fs/promises";
import { compile as _compile } from "@mdx-js/mdx";
import glob from "fast-glob";
import * as prettier from "prettier";

const files = await glob("docs/**/*.mdx");

function normalizeNewline(str) {
  return str.replace(/\\r\\n/g, "\\n");
}

function removeFrontmatter(source) {
  return source.replace(
    /^---(?:\r?\n|\r)(?:([\s\S]*?)(?:\r?\n|\r))?---(?:\r?\n|\r|$)/,
    "",
  );
}

async function compile(source) {
  return normalizeNewline(String(await _compile(removeFrontmatter(source))));
}

for (let filename of files) {
  let source = await fs.readFile(filename, "utf-8");
  let options = await prettier.resolveConfig(filename);
  let formatted = await prettier.format(source, options);

  if ((await compile(source)) !== (await compile(formatted))) {
    console.log("Compiled output does not match:", filename);
  }
}
