import fs from "node:fs";
import readdirp from "readdirp";
import path from "node:path";
import remarkMdx from "remark-mdx";
import { remark } from "remark";
import reporter from "vfile-reporter";
import { visit } from "unist-util-visit";

const ERRORS = {
  RELATIVE_LINK(url) {
    return `Relative link detected: ${url}. Relative links are not valid, make sure the link is absolute and starts with \`/docs/\`.`;
  },
  FILE_NOT_FOUND(url) {
    return `Matching file not found for path: ${url}. Expected file to exist at \`${
      url.split("#")[0]
    }.mdx\`.`;
  },
};

const fileCheckCache = new Map();

// Iterates over each link in the markdown file and checks if the link is valid by checking if the file exists locally.
const remarkPluginValidateLinks = () => (tree, file) => {
  visit(tree, "link", (node) => {
    if ("url" in node) {
      const { url } = node;
      const isRelative = url.startsWith(".");
      const isAbsolute = url.startsWith("/");

      if (isRelative) {
        file.message(ERRORS.RELATIVE_LINK(url), node.position);
      } else if (isAbsolute) {
        const cleanedUrl = url.split("#")[0];
        if (!fileCheckCache.has(cleanedUrl)) {
          const filePath = path.join("docs", `${cleanedUrl}.mdx`);
          fileCheckCache.set(url, fs.existsSync(filePath));
        }

        const exists = fileCheckCache.get(cleanedUrl);

        if (!exists) {
          file.message(ERRORS.FILE_NOT_FOUND(url), node.position);
        }
      }
    }
  });
};

const processor = remark().use(remarkMdx).use(remarkPluginValidateLinks);

async function main() {
  console.log("🔎 Checking for broken links...");

  const files = readdirp("docs", {
    fileFilter: "*.mdx",
    type: "files",
  });

  const checkedFiles = [];

  for await (const file of files) {
    const contents = await fs.promises.readFile(file.fullPath, "utf8");
    const result = await processor.process({
      path: file.path,
      value: contents,
    });

    if (result.messages.length > 0) {
      checkedFiles.push(result);
    }
  }

  console.log(reporter(checkedFiles, { quiet: true }));
}

main();
