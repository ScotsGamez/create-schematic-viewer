import assert from "node:assert/strict";
import test from "node:test";

import { piiKinds } from "../../tools/check_pii.js";

test("PII scan detects common repository leak shapes", () => {
  assert.deepEqual(piiKinds(`contact person${"@"}corp.test`), ["email address"]);
  assert.deepEqual(piiKinds(`call (212) 555-${"0187"}`), [
    "formatted phone number",
  ]);
  assert.deepEqual(piiKinds(`C:${"\\"}Users\\private-name\\repo`), [
    "user home path",
  ]);
  assert.deepEqual(piiKinds(`/${"home"}/private-name/repo`), ["user home path"]);
});

test("PII scan allows the approved GitHub no-reply identity", () => {
  assert.deepEqual(piiKinds("ScotsGamez@users.noreply.github.com"), []);
});
