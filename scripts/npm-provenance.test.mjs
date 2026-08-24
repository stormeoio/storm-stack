// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { verifyPublishedPackageProvenance } from "./npm-provenance.mjs";

const headCommit = "a".repeat(40);
const integrityDigest = Buffer.alloc(64, 0xab);
const integrityHex = integrityDigest.toString("hex");
const packageInfo = {
  name: "@stormstack/core",
  version: "0.1.1",
};
const packageSpec = `${packageInfo.name}@${packageInfo.version}`;
const workflowRef =
  "stormeoio/storm-stack/.github/workflows/publish.yml@refs/tags/v0.1.1";

function createStatement(overrides = {}) {
  const statement = {
    _type: "https://in-toto.io/Statement/v1",
    subject: [
      {
        digest: { sha512: integrityHex },
        name: "pkg:npm/%40stormstack/core@0.1.1",
      },
    ],
    predicateType: "https://slsa.dev/provenance/v1",
    predicate: {
      buildDefinition: {
        buildType:
          "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
        externalParameters: {
          workflow: {
            path: ".github/workflows/publish.yml",
            ref: "refs/tags/v0.1.1",
            repository: "https://github.com/stormeoio/storm-stack",
          },
        },
        resolvedDependencies: [
          {
            digest: { gitCommit: headCommit },
            uri:
              "git+https://github.com/stormeoio/storm-stack@refs/tags/v0.1.1",
          },
        ],
      },
      runDetails: {
        builder: { id: "https://github.com/actions/runner/github-hosted" },
        metadata: {
          invocationId:
            "https://github.com/stormeoio/storm-stack/actions/runs/12345/attempts/1",
        },
      },
    },
  };
  return overrides.mutate ? overrides.mutate(structuredClone(statement)) : statement;
}

function createBundle(statement = createStatement()) {
  return {
    dsseEnvelope: {
      payload: Buffer.from(JSON.stringify(statement), "utf8").toString("base64"),
      payloadType: "application/vnd.in-toto+json",
      signatures: [{ keyid: "", sig: "test-signature" }],
    },
    mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
    verificationMaterial: {},
  };
}

function createMetadata() {
  return {
    "dist.attestations": {
      provenance: { predicateType: "https://slsa.dev/provenance/v1" },
      url:
        "https://registry.npmjs.org/-/npm/v1/attestations/@stormstack%2fcore@0.1.1",
    },
    "dist.integrity": `sha512-${integrityDigest.toString("base64")}`,
  };
}

function verificationOptions(statement = createStatement(), overrides = {}) {
  const bundle = createBundle(statement);
  const fetchImpl = vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      attestations: [
        { bundle, predicateType: "https://slsa.dev/provenance/v1" },
      ],
    }),
  }));
  const verifyBundle = vi.fn(async () => undefined);
  return {
    context: { headCommit, workflowRef },
    fetchImpl,
    metadata: createMetadata(),
    verifyBundle,
    ...overrides,
  };
}

async function verifyFixture(fixture) {
  return verifyPublishedPackageProvenance(
    packageInfo,
    fixture.metadata,
    fixture.context,
    {
      fetchImpl: fixture.fetchImpl,
      verifyBundle: fixture.verifyBundle,
    },
  );
}

describe("npm provenance verification", () => {
  it("rejects an existing package without npm provenance metadata", async () => {
    const fixture = verificationOptions();
    fixture.metadata = { "dist.integrity": fixture.metadata["dist.integrity"] };

    await expect(verifyFixture(fixture)).rejects.toThrow(
      `${packageSpec} exists without an npm provenance attestation`,
    );
    expect(fixture.fetchImpl).not.toHaveBeenCalled();
    expect(fixture.verifyBundle).not.toHaveBeenCalled();
  });

  it("rejects a provenance certificate outside the exact repository workflow identity", async () => {
    const fixture = verificationOptions();
    fixture.verifyBundle.mockRejectedValue(new Error("certificate identity mismatch"));

    await expect(verifyFixture(fixture)).rejects.toThrow(
      "signature or GitHub workflow certificate identity is invalid",
    );
  });

  it("rejects signed provenance naming another repository or workflow", async () => {
    const statement = createStatement({
      mutate(value) {
        value.predicate.buildDefinition.externalParameters.workflow.path =
          ".github/workflows/other.yml";
        return value;
      },
    });
    const fixture = verificationOptions(statement);

    await expect(verifyFixture(fixture)).rejects.toThrow(
      "does not identify the trusted repository, workflow, and ref",
    );
  });

  it("rejects a provenance subject digest that differs from npm dist.integrity", async () => {
    const statement = createStatement({
      mutate(value) {
        value.subject[0].digest.sha512 = "b".repeat(128);
        return value;
      },
    });
    const fixture = verificationOptions(statement);

    await expect(verifyFixture(fixture)).rejects.toThrow(
      "subject digest does not match npm dist.integrity",
    );
  });

  it("rejects provenance whose resolved Git commit differs from release HEAD", async () => {
    const statement = createStatement({
      mutate(value) {
        value.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit =
          "b".repeat(40);
        return value;
      },
    });
    const fixture = verificationOptions(statement);

    await expect(verifyFixture(fixture)).rejects.toThrow(
      "does not resolve the trusted ref to release HEAD",
    );
  });

  it("accepts a verified exact subject, digest, workflow identity, and release commit", async () => {
    const fixture = verificationOptions();

    await expect(verifyFixture(fixture)).resolves.toMatchObject({
      workflowIdentity:
        "https://github.com/stormeoio/storm-stack/.github/workflows/publish.yml@refs/tags/v0.1.1",
    });
    expect(fixture.fetchImpl).toHaveBeenCalledWith(
      new URL(
        "https://registry.npmjs.org/-/npm/v1/attestations/@stormstack%2fcore@0.1.1",
      ),
      expect.objectContaining({ redirect: "error" }),
    );
    expect(fixture.verifyBundle).toHaveBeenCalledWith(
      expect.any(Object),
      {
        certificateIdentityURI:
          "^https://github\\.com/stormeoio/storm-stack/\\.github/workflows/publish\\.yml@refs/tags/v0\\.1\\.1$",
        certificateIssuer: "https://token.actions.githubusercontent.com",
        ctLogThreshold: 1,
        tlogThreshold: 1,
      },
    );
  });

  it("accepts an earlier publish attempt when rerunning the same exact tag", async () => {
    const statement = createStatement({
      mutate(value) {
        value.predicate.runDetails.metadata.invocationId =
          "https://github.com/stormeoio/storm-stack/actions/runs/12345/attempts/1";
        return value;
      },
    });
    const fixture = verificationOptions(statement, {
      context: {
        headCommit,
        runAttempt: "2",
        workflowRef,
      },
    });

    await expect(verifyFixture(fixture)).resolves.toMatchObject({
      workflowIdentity:
        "https://github.com/stormeoio/storm-stack/.github/workflows/publish.yml@refs/tags/v0.1.1",
    });
    expect(fixture.verifyBundle).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        certificateIdentityURI:
          "^https://github\\.com/stormeoio/storm-stack/\\.github/workflows/publish\\.yml@refs/tags/v0\\.1\\.1$",
      }),
    );
  });
});
