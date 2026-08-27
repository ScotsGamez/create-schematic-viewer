import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const RULES = [
  {
    kind: "email address",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu,
    allowed: (value) => value.toLowerCase().endsWith("@users.noreply.github.com"),
  },
  {
    kind: "formatted phone number",
    pattern:
      /(?<!\d)(?:\+?1[ .-])?(?:\(\d{3}\)|\d{3})[ .-]\d{3}[ .-]\d{4}(?!\d)/gu,
  },
  {
    kind: "user home path",
    pattern: /(?:[A-Z]:\\Users\\[^\\/\s]+|\/home\/[^/\s]+)/giu,
  },
];

export function piiKinds(text) {
  const kinds = new Set();
  for (const rule of RULES) {
    for (const match of text.matchAll(rule.pattern)) {
      if (!rule.allowed?.(match[0])) {
        kinds.add(rule.kind);
      }
    }
  }
  return [...kinds];
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function main() {
  const findings = [];
  const files = git(["ls-files", "-z"]).split("\0").filter(Boolean);
  let textFiles = 0;

  for (const file of files) {
    const content = readFileSync(file);
    if (content.includes(0)) {
      continue;
    }
    textFiles += 1;
    const lines = content.toString("utf8").split(/\r?\n/u);
    lines.forEach((line, index) => {
      for (const kind of piiKinds(line)) {
        findings.push(`${file}:${index + 1} (${kind}; value redacted)`);
      }
    });
  }

  const authors = git(["log", "--all", "--format=%H%x09%ae"])
    .split(/\r?\n/u)
    .filter(Boolean);
  for (const entry of authors) {
    const [commit, email = ""] = entry.split("\t", 2);
    if (piiKinds(email).includes("email address")) {
      findings.push(`${commit} (commit-author email address; value redacted)`);
    }
  }

  if (findings.length > 0) {
    console.error("Potential PII found:");
    findings.forEach((finding) => console.error(`- ${finding}`));
    process.exitCode = 1;
    return;
  }

  console.log(
    `PII heuristic scan passed (${textFiles} text files, ${authors.length} commits).`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
