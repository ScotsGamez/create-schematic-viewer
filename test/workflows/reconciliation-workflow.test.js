import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowPath = new URL(
  "../../.github/workflows/reconcile-v1.0.0-attestation.yml",
  import.meta.url,
);

async function reconciliationWorkflow() {
  return readFile(workflowPath, "utf8");
}

test("v1.0.0 reconciliation is manual, fixed-subject, and cannot sign", async () => {
  const workflow = await reconciliationWorkflow();

  assert.match(workflow, /on:\s*\n\s+workflow_dispatch:/);
  assert.doesNotMatch(workflow, /pull_request:|push:|release:/);
  assert.match(workflow, /github\.repository == 'ScotsGamez\/create-schematic-viewer'/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /inputs\.confirm == true/);
  assert.match(workflow, /confirm_registry_quiescent:/);
  assert.match(workflow, /inputs\.confirm_registry_quiescent == true/);
  assert.match(workflow, /environment: attestation-recovery/);
  assert.match(workflow, /permissions: \{\}/);
  assert.match(workflow, /actions: read\s*\n\s+contents: read/);
  assert.match(workflow, /attestations: read/);
  assert.match(workflow, /packages: write/);
  assert.doesNotMatch(
    workflow,
    /id-token: write|attestations: write|contents: write|actions: write/,
  );
  assert.doesNotMatch(workflow, /actions\/attest@|cosign\s+attest/);
  assert.match(
    workflow,
    /EXPECTED_DIGEST: sha256:d8dcef565e7da6c7536b591cc9cbe0471637364ffc22ae40590cd2c0910484a3/,
  );
  assert.match(
    workflow,
    /ATTESTATION_SOURCE_COMMIT: 8ce0edb3c2ddbfed4eb4f0282eaa2e3383471720/,
  );
  assert.match(
    workflow,
    /RELEASE_PREDICATE_TYPE: https:\/\/in-toto\.io\/attestation\/release\/v0\.1/,
  );
});

test("reconciliation proves protected approval and the exact failed run", async () => {
  const workflow = await reconciliationWorkflow();
  const approval = workflow.indexOf("Require independent environment review");
  const failedRun = workflow.indexOf("Validate the failed recovery run");
  const registryAuth = workflow.indexOf("Authenticate to GHCR for reconciliation");

  assert.ok(approval >= 0 && failedRun > approval);
  assert.ok(registryAuth === -1 || failedRun < registryAuth);
  assert.match(workflow, /can_admins_bypass == false/);
  assert.match(workflow, /prevent_self_review == true/);
  assert.match(workflow, /required_reviewers/);
  assert.match(
    workflow,
    /repos\/\$GITHUB_REPOSITORY\/actions\/runs\/\$FAILED_RUN_ID/,
  );
  assert.match(workflow, /\.head_sha == \$source/);
  assert.match(workflow, /\.run_attempt == 1/);
  assert.match(workflow, /\.conclusion == "failure"/);
  assert.match(workflow, /actions\/runs\/\$FAILED_RUN_ID\/attempts\/1\/jobs/);
  assert.match(workflow, /Sign the existing image index as the v1\.0\.0 release/);
});

test("reconciliation revalidates release and security evidence before registry mutation", async () => {
  const workflow = await reconciliationWorkflow();
  const release = workflow.indexOf("Validate immutable release evidence");
  const pii = workflow.indexOf("npm run check:pii");
  const gitleaks = workflow.indexOf("ghcr.io/gitleaks/gitleaks:");
  const smoke = workflow.indexOf("tools/smoke_container.sh");
  const registryAuth = workflow.indexOf("Authenticate to GHCR for reconciliation");
  const attach = workflow.indexOf("oras attach");

  assert.ok(release >= 0 && release < pii);
  assert.ok(pii < gitleaks && gitleaks < smoke);
  assert.ok(registryAuth === -1 || smoke < registryAuth);
  assert.ok(attach === -1 || smoke < attach);
  assert.match(workflow, /sha-\$SOURCE_COMMIT/);
  assert.match(workflow, /Provenance\.SLSA/);
  assert.match(workflow, /runDetails\.builder\.id/);
  assert.match(workflow, /github_workflow_sha == \$revision/);
  assert.match(workflow, /Scan tracked files and commit authors for PII/);
  assert.match(workflow, /Scan complete Git history for secrets/);
  assert.match(workflow, /Pull anonymously and smoke-test the existing digest/);
});

test("reconciliation accepts and verifies only the exact existing GitHub bundle", async () => {
  const workflow = await reconciliationWorkflow();
  const bundle = workflow.indexOf("Download and verify the existing GitHub bundle");
  const registryAuth = workflow.indexOf("Authenticate to GHCR for reconciliation");

  assert.ok(bundle >= 0);
  assert.ok(registryAuth === -1 || bundle < registryAuth);
  assert.match(
    workflow,
    /repos\/\$GITHUB_REPOSITORY\/attestations\/\$EXPECTED_DIGEST/,
  );
  assert.match(workflow, /predicate_type=\$RELEASE_PREDICATE_TYPE/);
  assert.match(workflow, /\.attestations \| length == 1/);
  assert.match(workflow, /gh attestation download/);
  assert.match(workflow, /--limit 2/);
  assert.match(workflow, /gh attestation verify "\$subject" --bundle "\$bundle"/);
  assert.match(workflow, /--signer-workflow "\$signer"/);
  assert.match(workflow, /--source-ref refs\/heads\/main/);
  assert.match(workflow, /--source-digest "\$ATTESTATION_SOURCE_COMMIT"/);
  assert.match(workflow, /--signer-digest "\$ATTESTATION_SOURCE_COMMIT"/);
  assert.match(workflow, /--deny-self-hosted-runners/);
  assert.match(
    workflow,
    /actions\/runs\/\$FAILED_RUN_ID\/attempts\/1/,
  );
  assert.match(workflow, /runInvocationURI == \$run/);
  assert.match(workflow, /\._type == "https:\/\/in-toto\.io\/Statement\/v1"/);
  assert.match(workflow, /\.predicate\.purl == env\.EXPECTED_PURL/);
});

test("reconciliation attaches only an absent bundle and fails closed on conflicts", async () => {
  const workflow = await reconciliationWorkflow();
  const plan = workflow.indexOf("Plan registry reconciliation");
  const auth = workflow.indexOf("Authenticate to GHCR for reconciliation");
  const recheck = workflow.indexOf("Confirm registry snapshot before attachment");
  const attach = workflow.indexOf("Attach the verified bundle to GHCR");
  const attachInvocations = workflow.match(/^\s+oras attach /gm) ?? [];

  assert.ok(plan >= 0 && plan < auth && auth < recheck && recheck < attach);
  assert.equal(attachInvocations.length, 1);
  assert.match(workflow, /oras-project\/setup-oras@[0-9a-f]{40}/);
  const actions = [...workflow.matchAll(/^\s*uses:\s+(\S+)/gm)].map(
    ([, action]) => action,
  );
  assert.ok(actions.length > 0);
  for (const action of actions) {
    assert.match(action, /@[0-9a-f]{40}$/);
  }
  assert.match(workflow, /version: 1\.3\.3/);
  assert.match(workflow, /oras login ghcr\.io/);
  assert.match(workflow, /--password-stdin/);
  assert.match(workflow, /--registry-config "\$ORAS_CONFIG"/);
  assert.equal((workflow.match(/^\s+oras discover /gm) ?? []).length, 3);
  assert.equal((workflow.match(/--depth 1/g) ?? []).length, 3);
  assert.equal((workflow.match(/--artifact-type "\$BUNDLE_MEDIA_TYPE"/g) ?? []).length, 1);
  assert.equal((workflow.match(/--distribution-spec v1\.1-referrers-tag/g) ?? []).length, 4);
  assert.doesNotMatch(workflow, /v1\.1-referrers-api/);
  assert.match(
    workflow,
    /REFERRERS_TAG: sha256-d8dcef565e7da6c7536b591cc9cbe0471637364ffc22ae40590cd2c0910484a3/,
  );
  assert.match(workflow, /test "\$REFERRERS_TAG" = "\$\{EXPECTED_DIGEST\/:\/-\}"/);
  assert.match(workflow, /select\(\.artifactType == \$bundle_type\)/);
  assert.doesNotMatch(
    workflow,
    /release_count=\$\(jq[\s\S]{0,300}dev\.sigstore\.bundle\.predicateType/,
  );
  assert.match(workflow, /case "\$release_count" in\s+0\)/s);
  assert.match(workflow, /1\)[\s\S]+cmp --silent/s);
  assert.match(workflow, /\*\)[\s\S]+exit 1/s);
  assert.equal((workflow.match(/if: steps\.registry_plan\.outputs\.action == 'attach'/g) ?? []).length, 3);
  assert.match(
    workflow,
    /Confirm registry snapshot before attachment[\s\S]+cmp --silent[\s\S]+registry-before-canonical\.json[\s\S]+registry-pre-attach-canonical\.json/,
  );
  assert.match(
    workflow,
    /cd "\$RECONCILIATION_WORK"[\s\S]+oras attach[\s\S]+"\$IMAGE_NAME@\$EXPECTED_DIGEST"[\s\S]+"bundle\.json:\$BUNDLE_MEDIA_TYPE"/,
  );
  assert.doesNotMatch(workflow, /"\$GITHUB_BUNDLE:\$BUNDLE_MEDIA_TYPE"/);
  assert.match(workflow, /dev\.sigstore\.bundle\.content=dsse-envelope/);
  assert.match(
    workflow,
    /dev\.sigstore\.bundle\.predicateType=\$RELEASE_PREDICATE_TYPE/,
  );
});

test("reconciliation has no release, image, discovery-tag, or signing mutation path", async () => {
  const workflow = await reconciliationWorkflow();
  const forbidden = [
    /actions\/attest@/,
    /cosign\s+(?:attest|sign)/,
    /^\s+docker\s+(?:build|push|tag)(?:\s|$)/m,
    /^\s+docker\s+buildx\s+(?:build|bake)(?:\s|$)/m,
    /^\s+docker\s+buildx\s+imagetools\s+create(?:\s|$)/m,
    /^\s+docker\s+manifest\s+(?:create|annotate|push)(?:\s|$)/m,
    /^\s+git\s+(?:tag|push)(?:\s|$)/m,
    /^\s+gh\s+release\s+(?:create|edit|delete|upload)(?:\s|$)/m,
    /^\s+oras\s+(?:push|tag|cp)(?:\s|$)/m,
    /^\s+oras\s+manifest\s+(?:push|delete)(?:\s|$)/m,
  ];

  for (const mutation of forbidden) {
    assert.doesNotMatch(workflow, mutation);
  }
});

test("reconciliation preserves complete OCI descriptors during comparison", async () => {
  const workflow = await reconciliationWorkflow();
  const canonicalizers = [...workflow.matchAll(/del\(([^)]*)\)/g)].map(
    ([, fields]) => fields.split(",").map((field) => field.trim().replace(/^\./, "")),
  );
  const descriptor = {
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    digest: `sha256:${"a".repeat(64)}`,
    size: 123,
    artifactType: "example/referrer",
    annotations: { "example/key": "value" },
    urls: ["https://example.invalid/blob"],
    data: "ZXhhbXBsZQ==",
    platform: { architecture: "amd64", os: "linux" },
    "example.extension": { retained: true },
    reference: "presentation-only",
    referrers: [{ recursion: "presentation-only" }],
  };
  const expected = structuredClone(descriptor);
  delete expected.reference;
  delete expected.referrers;

  assert.equal(canonicalizers.length, 5);
  for (const deletedFields of canonicalizers) {
    const canonical = structuredClone(descriptor);
    for (const field of deletedFields) delete canonical[field];
    assert.deepEqual(canonical, expected);
  }
});

test("reconciliation proves both stores, unchanged release discovery tags, and cleans credentials", async () => {
  const workflow = await reconciliationWorkflow();
  const attach = workflow.indexOf("Attach the verified bundle to GHCR");
  const verify = workflow.indexOf("Verify the reconciled registry state");
  const summary = workflow.indexOf("Record reconciliation evidence");
  const preserve = workflow.indexOf("Preserve reconciliation recovery evidence");
  const cleanup = workflow.indexOf("Remove registry credentials");

  assert.ok(
    attach >= 0 &&
      verify > attach &&
      summary > verify &&
      cleanup > summary &&
      preserve > cleanup,
  );
  assert.match(workflow, /release_count_after.*!= 1/s);
  assert.doesNotMatch(
    workflow,
    /release_count_after=.*dev\.sigstore\.bundle\.predicateType/,
  );
  assert.match(workflow, /oras manifest fetch/);
  assert.match(workflow, /"\$IMAGE_NAME:\$REFERRERS_TAG"/);
  assert.match(workflow, /\.schemaVersion == 2/);
  assert.match(workflow, /\.mediaType == "application\/vnd\.oci\.image\.index\.v1\+json"/);
  assert.match(workflow, /unique_by\(\.digest\)/);
  assert.equal((workflow.match(/del\(\.reference, \.referrers\)/g) ?? []).length, 5);
  assert.match(workflow, /\.artifactType == \$bundle_type/);
  assert.match(workflow, /\.config\.mediaType == "application\/vnd\.oci\.empty\.v1\+json"/);
  assert.match(workflow, /\(\.layers \| length\) == 1/);
  assert.match(workflow, /\.layers\[0\]\.mediaType == \$bundle_type/);
  assert.match(workflow, /\.subject\.digest == \$subject_digest/);
  assert.match(workflow, /cmp --silent[\s\S]+github-canonical\.json[\s\S]+registry-canonical\.json/);
  assert.match(
    workflow,
    /REGISTRY_ACTION[\s\S]+attach\)[\s\S]+attach\.json[\s\S]+registry-expected-after-canonical\.json[\s\S]+registry-after-canonical\.json/,
  );
  assert.match(
    workflow,
    /REGISTRY_ACTION[\s\S]+verify-only\)[\s\S]+registry-before-canonical\.json[\s\S]+registry-after-canonical\.json/,
  );
  assert.equal((workflow.match(/gh attestation verify /g) ?? []).length, 3);
  assert.match(workflow, /--bundle-from-oci/);
  assert.match(workflow, /--signer-workflow "\$signer"/);
  assert.match(workflow, /--source-digest "\$ATTESTATION_SOURCE_COMMIT"/);
  assert.match(workflow, /--signer-digest "\$ATTESTATION_SOURCE_COMMIT"/);
  assert.match(workflow, /release_digest_after.*EXPECTED_DIGEST/s);
  assert.match(workflow, /sha_digest_after.*EXPECTED_DIGEST/s);
  assert.match(workflow, /pre_index_digest=.*GITHUB_OUTPUT/);
  assert.match(workflow, /attach_digest=.*GITHUB_OUTPUT/);
  assert.match(workflow, /PRE_INDEX_DIGEST/);
  assert.match(workflow, /post_index_digest/);
  assert.match(workflow, /VALIDATION_OUTCOME/);
  assert.match(workflow, /GITHUB_STEP_SUMMARY/);
  assert.match(workflow, /name: Record reconciliation evidence\s+if: always\(\)/);
  assert.match(
    workflow,
    /Record reconciliation evidence[\s\S]+set -euo pipefail[\s\S]+install --directory --mode=700[\s\S]+printf 'path=%s\\n'[\s\S]+collection-status\.txt[\s\S]+evidence\.json/,
  );
  assert.match(
    workflow,
    /uses: actions\/upload-artifact@[0-9a-f]{40}[\s\S]+retention-days: 7/,
  );
  assert.doesNotMatch(
    workflow,
    /path:\s*\$\{\{\s*env\.(?:GITHUB_BUNDLE|ORAS_CONFIG)/,
  );
  assert.match(workflow, /\$\{ORAS_CONFIG:-\}/);
  assert.match(workflow, /oras logout ghcr\.io/);
  assert.match(workflow, /Remove-Item|rm --force "\$ORAS_CONFIG"/);
});
