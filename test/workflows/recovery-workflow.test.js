import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowPath = new URL(
  "../../.github/workflows/recover-v1.0.0-attestation.yml",
  import.meta.url,
);

async function recoveryWorkflow() {
  return readFile(workflowPath, "utf8");
}

test("v1.0.0 recovery is manual, fixed-subject, and least privilege", async () => {
  const workflow = await recoveryWorkflow();

  assert.match(workflow, /on:\s*\n\s+workflow_dispatch:/);
  assert.doesNotMatch(workflow, /pull_request:|push:|release:/);
  assert.match(workflow, /github\.repository == 'ScotsGamez\/create-schematic-viewer'/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /inputs\.confirm == true/);
  assert.match(workflow, /permissions: \{\}/);
  assert.match(workflow, /actions: read\s*\n\s+contents: read\s*\n\s+packages: write/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /attestations: write/);
  assert.doesNotMatch(workflow, /contents: write|actions: write/);
  assert.match(
    workflow,
    /EXPECTED_DIGEST: sha256:d8dcef565e7da6c7536b591cc9cbe0471637364ffc22ae40590cd2c0910484a3/,
  );
  assert.match(
    workflow,
    /SOURCE_COMMIT: f7a4a5b06db10d3974cdea270e4fe92a3721b4b0/,
  );
  assert.match(
    workflow,
    /PLATFORM_DIGEST: sha256:d0553e08cf50e10cd51d774cad84576dd155c6de5de081ef27a10a2ecb450473/,
  );
  assert.match(workflow, /confirm:\s*\n\s+description:/);
  assert.doesNotMatch(workflow, /digest:\s*\n\s+description:|subject:\s*\n\s+description:/);
});

test("recovery cannot rebuild, republish, or move release tags", async () => {
  const workflow = await recoveryWorkflow();

  assert.doesNotMatch(workflow, /build-push-action|metadata-action/);
  const mutations = [
    /^\s+docker\s+(?:build|push|tag)(?:\s|$)/m,
    /^\s+docker\s+buildx\s+(?:build|bake)(?:\s|$)/m,
    /^\s+docker\s+buildx\s+imagetools\s+create(?:\s|$)/m,
    /^\s+docker\s+manifest\s+(?:create|annotate|push)(?:\s|$)/m,
    /^\s+git\s+(?:tag|push)(?:\s|$)/m,
    /^\s+gh\s+release\s+(?:create|edit|delete|upload)(?:\s|$)/m,
  ];
  for (const mutation of mutations) {
    assert.doesNotMatch(workflow, mutation);
  }
  assert.match(workflow, /Confirm tags were not moved/);
  assert.match(workflow, /test .*EXPECTED_DIGEST/);
});

test("recovery publishes exactly one release attestation for the immutable image index", async () => {
  const workflow = await recoveryWorkflow();
  const attestInvocations = workflow.match(/uses:\s+actions\/attest@/g) ?? [];

  assert.equal(attestInvocations.length, 1);
  assert.match(workflow, /Sign the existing image index as the v1\.0\.0 release/);
  assert.match(workflow, /subject-digest: \$\{\{ env\.EXPECTED_DIGEST \}\}/);
  assert.match(workflow, /predicate-type: \$\{\{ env\.RELEASE_PREDICATE_TYPE \}\}/);
  assert.doesNotMatch(workflow, /Sign the validated platform build provenance/);
});

test("recovery refuses an existing or indeterminate release attestation before signing", async () => {
  const workflow = await recoveryWorkflow();
  const duplicateCheck = workflow.indexOf(
    "Refuse existing or indeterminate release attestation",
  );
  const login = workflow.indexOf("docker/login-action@");
  const signing = workflow.indexOf("actions/attest@");

  assert.ok(duplicateCheck >= 0);
  assert.ok(duplicateCheck < login && duplicateCheck < signing);
  assert.match(
    workflow,
    /repos\/\$GITHUB_REPOSITORY\/attestations\/\$EXPECTED_DIGEST/,
  );
  assert.match(
    workflow,
    /--data-urlencode "predicate_type=\$RELEASE_PREDICATE_TYPE"/,
  );
  assert.match(workflow, /case "\$http_status" in\s+404\)\s+;;/s);
  assert.match(workflow, /\*\)\s+printf[\s\S]+?exit 1/s);
  assert.doesNotMatch(workflow, /\|\| true/);
  assert.equal(
    (workflow.match(/X-GitHub-Api-Version: 2026-03-10/g) ?? []).length,
    2,
  );
  assert.doesNotMatch(workflow, /X-GitHub-Api-Version: 2022-11-28/);
});

test("duplicate preflight proves repository access before accepting absence", async () => {
  const workflow = await recoveryWorkflow();
  const repositoryCheck = workflow.indexOf(
    '"https://api.github.com/repos/$GITHUB_REPOSITORY"',
  );
  const attestationCheck = workflow.indexOf(
    '"https://api.github.com/repos/$GITHUB_REPOSITORY/attestations/$EXPECTED_DIGEST"',
  );

  assert.ok(repositoryCheck >= 0);
  assert.ok(repositoryCheck < attestationCheck);
  assert.match(workflow, /repository_status.*%\{http_code\}/s);
  assert.match(workflow, /"\$repository_status" != 200/);
  assert.match(workflow, /\.full_name == \$repository/);
});

test("recovery validates original provenance and signs the release after security checks", async () => {
  const workflow = await recoveryWorkflow();
  const provenance = workflow.indexOf("Validate immutable tags, labels, and original provenance");
  const pii = workflow.indexOf("npm run check:pii");
  const gitleaks = workflow.indexOf("ghcr.io/gitleaks/gitleaks:");
  const smoke = workflow.indexOf("tools/smoke_container.sh");
  const login = workflow.indexOf("docker/login-action@");
  const attest = workflow.indexOf("actions/attest@");

  assert.ok(provenance >= 0 && provenance < pii);
  assert.ok(pii < gitleaks && gitleaks < smoke);
  assert.ok(smoke < login && login < attest);
  assert.match(workflow, /environment: attestation-recovery/);
  assert.match(workflow, /can_admins_bypass == false/);
  assert.match(workflow, /prevent_self_review == true/);
  assert.match(workflow, /required_reviewers/);
  assert.match(workflow, /Provenance\.SLSA/);
  assert.match(workflow, /github_run_id ==|runDetails\.builder\.id ==/);
  assert.doesNotMatch(workflow, /subject-digest: \$\{\{ env\.PLATFORM_DIGEST \}\}/);
  assert.doesNotMatch(workflow, /predicate-type: https:\/\/slsa\.dev\/provenance\/v1/);
  assert.match(workflow, /subject-digest: \$\{\{ env\.EXPECTED_DIGEST \}\}/);
  assert.match(workflow, /https:\/\/in-toto\.io\/attestation\/release\/v0\.1/);
  assert.match(workflow, /create-storage-record: false/);
  assert.match(workflow, /--signer-workflow/);
  assert.match(workflow, /--source-ref refs\/heads\/main/);
  assert.match(workflow, /--source-digest "\$GITHUB_SHA"/);
  assert.match(workflow, /--signer-digest "\$GITHUB_SHA"/);
  assert.match(workflow, /--deny-self-hosted-runners/);
  assert.match(workflow, /--bundle-from-oci/);
});

test("every recovery action is pinned to an immutable commit", async () => {
  const workflow = await recoveryWorkflow();
  const uses = [...workflow.matchAll(/uses:\s+([^\s@]+)@([^\s#]+)/g)];

  assert.ok(uses.length > 0);
  for (const [, action, revision] of uses) {
    assert.match(action, /^(?:actions|docker)\//);
    assert.match(revision, /^[0-9a-f]{40}$/);
  }

  const actions = uses.map(([, action]) => action);
  for (const required of [
    "actions/checkout",
    "actions/setup-node",
    "docker/setup-buildx-action",
    "docker/login-action",
    "actions/attest",
  ]) {
    assert.ok(actions.includes(required), `missing required action ${required}`);
  }
});
