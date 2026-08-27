import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const publicFile = (name) => readFileSync(
  new URL(`../../public/${name}`, import.meta.url),
  "utf8"
);

test("read-only capability hides the complete Asset Admin panel", () => {
  const html = publicFile("index.html");
  const css = `${publicFile("styles.css")}\n${publicFile("style.css")}`;
  const app = publicFile("app.js");

  assert.ok(
    /\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important\s*;?[^}]*\}/s.test(css),
    "the author stylesheet must preserve the platform-wide hidden contract"
  );

  const panelTag = html.match(/<section\b(?=[^>]*\bclass="[^"]*\badmin-panel\b[^"]*")[^>]*>/)?.[0];
  assert.ok(panelTag, "the Asset Admin section must exist");
  assert.match(panelTag, /\bid="assetAdminPanel"/, "the complete Asset Admin section needs a stable hook");
  assert.match(panelTag, /\bhidden\b/, "the complete Asset Admin section must start hidden");

  assert.match(
    app,
    /assetAdminPanel:\s*document\.querySelector\("#assetAdminPanel"\)/,
    "the capability handler must address the complete Asset Admin section"
  );
  assert.match(
    app,
    /elements\.assetAdminPanel\.toggleAttribute\("hidden",\s*!canWrite\)/,
    "read-only capability must hide the complete Asset Admin section"
  );
});
