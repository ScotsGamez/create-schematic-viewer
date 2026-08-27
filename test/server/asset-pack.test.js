import assert from "node:assert/strict";
import test from "node:test";

import { localTextureUrl } from "../../src/asset-pack.js";

test("keeps generated texture URLs relative to the mounted viewer", () => {
  const url = localTextureUrl("create:block/brass_casing");

  assert.equal(url, "./api/assets/textures/create%3Ablock%2Fbrass_casing");
  assert.equal(url.startsWith("/api/"), false);
  assert.equal(
    new URL(url, "http://lantern.local:8093/schematics/").pathname,
    "/schematics/api/assets/textures/create%3Ablock%2Fbrass_casing"
  );
});
