import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowPath = new URL("../../.github/workflows/release.yml", import.meta.url);
const ciWorkflowPath = new URL("../../.github/workflows/ci.yml", import.meta.url);
const smokeScriptPath = new URL("../../tools/smoke_container.sh", import.meta.url);

async function releaseWorkflow() {
  return readFile(workflowPath, "utf8");
}

test("release publishing is explicit and least privilege", async () => {
  const workflow = await releaseWorkflow();

  assert.match(workflow, /release:\s*\n\s+types:\s*\[published\]/);
  assert.doesNotMatch(workflow, /workflow_dispatch:/);
  assert.match(workflow, /permissions:\s*\n\s+contents: read\s*\n\s+packages: write/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /attestations: write/);
  assert.match(workflow, /prerelease == false/);
  assert.match(workflow, /\^v\[0-9\]/);
  assert.match(workflow, /package\.json/);
  assert.match(workflow, /Release tag must match package\.json version/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /git fetch/);
  assert.match(workflow, /npm run check:pii/);
  assert.ok(
    workflow.indexOf("npm run check:pii") <
      workflow.indexOf("Authenticate to GitHub Container Registry"),
  );
});

test("release supply-chain actions are commit pinned", async () => {
  const workflow = await releaseWorkflow();
  const uses = [...workflow.matchAll(/uses:\s+([^\s@]+)@([^\s#]+)/g)];

  assert.equal(uses.length, 7);
  for (const [, action, revision] of uses) {
    assert.match(action, /^(?:actions|docker)\//);
    assert.match(revision, /^[0-9a-f]{40}$/);
  }
});

test("release image is attested and verified by immutable digest", async () => {
  const workflow = await releaseWorkflow();
  const ciWorkflow = await readFile(ciWorkflowPath, "utf8");
  const smokeScript = await readFile(smokeScriptPath, "utf8");

  assert.match(workflow, /type=raw,value=\$\{\{ env\.RELEASE_TAG \}\}/);
  assert.match(workflow, /type=sha,format=long/);
  assert.match(workflow, /provenance: mode=max/);
  assert.match(workflow, /sbom: true/);
  assert.match(workflow, /actions\/attest@[0-9a-f]{40}/);
  assert.match(workflow, /create-storage-record: false/);
  assert.match(workflow, /steps\.build\.outputs\.digest/);
  assert.match(workflow, /tools\/smoke_container\.sh "\$image"/);
  assert.match(ciWorkflow, /tools\/smoke_container\.sh create-schematic-viewer:ci/);
  assert.match(smokeScript, /docker pull "\$image"/);
  assert.match(smokeScript, /--read-only/);
  assert.match(smokeScript, /127\.0\.0\.1:\$\{host_port\}:4173/);
});
