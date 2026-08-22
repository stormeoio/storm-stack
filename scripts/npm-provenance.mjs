export const npmRegistry = "https://registry.npmjs.org/";

const githubActionsBuildType =
  "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1";
const githubActionsBuilder = "https://github.com/actions/runner/github-hosted";
const githubOidcIssuer = "https://token.actions.githubusercontent.com";
const inTotoStatementType = "https://in-toto.io/Statement/v1";
const maxAttestationResponseBytes = 2 * 1024 * 1024;
const provenancePredicateType = "https://slsa.dev/provenance/v1";
const trustedGitHubRepository = "stormeoio/storm-stack";
const trustedRepositoryUrl = `https://github.com/${trustedGitHubRepository}`;
const trustedWorkflowPath = ".github/workflows/publish.yml";
const trustedWorkflowPrefix = `${trustedGitHubRepository}/${trustedWorkflowPath}@`;

function readDistField(metadata, field) {
  return metadata?.[`dist.${field}`] ?? metadata?.dist?.[field];
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeCanonicalBase64(value, description) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    throw new Error(`${description} is not canonical base64.`);
  }

  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    throw new Error(`${description} is not canonical base64.`);
  }
  return decoded;
}

function sha512IntegrityHex(integrity, packageSpec) {
  if (typeof integrity !== "string") {
    throw new Error(`${packageSpec} has no npm dist.integrity value.`);
  }

  const sha512Tokens = integrity
    .trim()
    .split(/\s+/)
    .filter((token) => token.startsWith("sha512-"));
  if (sha512Tokens.length !== 1) {
    throw new Error(`${packageSpec} must expose exactly one sha512 npm integrity digest.`);
  }

  const digest = decodeCanonicalBase64(
    sha512Tokens[0].slice("sha512-".length),
    `${packageSpec} sha512 integrity digest`,
  );
  if (digest.length !== 64) {
    throw new Error(`${packageSpec} npm integrity is not a SHA-512 digest.`);
  }
  return digest.toString("hex");
}

function npmPackagePurl(name, version) {
  if (name.startsWith("@")) {
    const separator = name.indexOf("/");
    if (separator < 2 || separator === name.length - 1) {
      throw new Error(`Invalid scoped npm package name: ${name}`);
    }
    return `pkg:npm/${encodeURIComponent(name.slice(0, separator))}/${encodeURIComponent(name.slice(separator + 1))}@${version}`;
  }
  return `pkg:npm/${encodeURIComponent(name)}@${version}`;
}

function resolveTrustedWorkflow(workflowRef) {
  if (typeof workflowRef !== "string" || !workflowRef.startsWith(trustedWorkflowPrefix)) {
    throw new Error("The GitHub workflow identity is not the trusted publish workflow.");
  }

  const ref = workflowRef.slice(trustedWorkflowPrefix.length);
  if (!ref.startsWith("refs/heads/") && !ref.startsWith("refs/tags/")) {
    throw new Error("The trusted publish workflow identity has an invalid Git ref.");
  }

  return {
    identity: `https://github.com/${workflowRef}`,
    ref,
  };
}

async function defaultVerifyBundle(bundle, options) {
  const { verify } = await import("sigstore");
  return verify(bundle, options);
}

async function fetchAttestationDocument(url, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("Unable to fetch the npm provenance attestation document.");
  }

  if (!response?.ok) {
    throw new Error(
      `The npm provenance attestation endpoint returned HTTP ${response?.status ?? "unknown"}.`,
    );
  }

  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > maxAttestationResponseBytes) {
    throw new Error("The npm provenance attestation document exceeds the size limit.");
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new Error("The npm provenance attestation endpoint returned invalid JSON.");
  }
}

function parseVerifiedStatement(bundle, packageSpec) {
  if (bundle?.dsseEnvelope?.payloadType !== "application/vnd.in-toto+json") {
    throw new Error(`${packageSpec} provenance is not an in-toto DSSE statement.`);
  }

  const payload = decodeCanonicalBase64(
    bundle.dsseEnvelope.payload,
    `${packageSpec} provenance payload`,
  );
  try {
    return JSON.parse(payload.toString("utf8"));
  } catch {
    throw new Error(`${packageSpec} provenance payload is not valid JSON.`);
  }
}

function assertStatementIdentity(packageInfo, statement, context, expectedWorkflow) {
  const packageSpec = `${packageInfo.name}@${packageInfo.version}`;
  if (statement?._type !== inTotoStatementType) {
    throw new Error(`${packageSpec} provenance has an unsupported in-toto statement type.`);
  }
  if (statement.predicateType !== provenancePredicateType) {
    throw new Error(`${packageSpec} provenance has an unsupported predicate type.`);
  }

  const expectedPurl = npmPackagePurl(packageInfo.name, packageInfo.version);
  if (!Array.isArray(statement.subject) || statement.subject.length !== 1) {
    throw new Error(`${packageSpec} provenance must contain exactly one package subject.`);
  }
  const [subject] = statement.subject;
  if (subject?.name !== expectedPurl) {
    throw new Error(`${packageSpec} provenance subject does not match ${expectedPurl}.`);
  }

  const expectedDigest = sha512IntegrityHex(
    readDistField(context.metadata, "integrity"),
    packageSpec,
  );
  if (subject?.digest?.sha512 !== expectedDigest) {
    throw new Error(`${packageSpec} provenance subject digest does not match npm dist.integrity.`);
  }

  const buildDefinition = statement.predicate?.buildDefinition;
  if (buildDefinition?.buildType !== githubActionsBuildType) {
    throw new Error(`${packageSpec} provenance was not produced by the GitHub Actions workflow build type.`);
  }

  const workflow = buildDefinition.externalParameters?.workflow;
  if (
    workflow?.repository !== trustedRepositoryUrl
    || workflow?.path !== trustedWorkflowPath
    || workflow?.ref !== expectedWorkflow.ref
  ) {
    throw new Error(`${packageSpec} provenance does not identify the trusted repository, workflow, and ref.`);
  }

  const expectedDependencyUri = `git+${trustedRepositoryUrl}@${expectedWorkflow.ref}`;
  const matchingDependencies = Array.isArray(buildDefinition.resolvedDependencies)
    ? buildDefinition.resolvedDependencies.filter(
      (dependency) => dependency?.uri === expectedDependencyUri,
    )
    : [];
  if (
    matchingDependencies.length !== 1
    || matchingDependencies[0]?.digest?.gitCommit !== context.headCommit
  ) {
    throw new Error(`${packageSpec} provenance does not resolve the trusted ref to release HEAD.`);
  }

  if (statement.predicate?.runDetails?.builder?.id !== githubActionsBuilder) {
    throw new Error(`${packageSpec} provenance does not identify the GitHub-hosted Actions builder.`);
  }

  const invocationId = statement.predicate?.runDetails?.metadata?.invocationId;
  const invocationPattern = new RegExp(
    `^${escapeRegularExpression(trustedRepositoryUrl)}/actions/runs/[0-9]+/attempts/[0-9]+$`,
  );
  if (typeof invocationId !== "string" || !invocationPattern.test(invocationId)) {
    throw new Error(`${packageSpec} provenance invocation does not belong to the trusted repository.`);
  }
}

export async function verifyPublishedPackageProvenance(
  packageInfo,
  metadata,
  context,
  options = {},
) {
  const packageSpec = `${packageInfo.name}@${packageInfo.version}`;
  const attestationMetadata = readDistField(metadata, "attestations");
  if (
    !attestationMetadata
    || attestationMetadata.provenance?.predicateType !== provenancePredicateType
    || typeof attestationMetadata.url !== "string"
  ) {
    throw new Error(`${packageSpec} exists without an npm provenance attestation.`);
  }

  let attestationUrl;
  try {
    attestationUrl = new URL(attestationMetadata.url);
  } catch {
    throw new Error(`${packageSpec} exposes an invalid npm attestation URL.`);
  }
  const registry = new URL(npmRegistry);
  if (
    attestationUrl.origin !== registry.origin
    || !attestationUrl.pathname.startsWith("/-/npm/v1/attestations/")
    || attestationUrl.search
    || attestationUrl.hash
  ) {
    throw new Error(`${packageSpec} npm attestation URL is outside the trusted registry endpoint.`);
  }

  const document = await fetchAttestationDocument(
    attestationUrl,
    options.fetchImpl ?? globalThis.fetch,
  );
  const provenanceAttestations = Array.isArray(document?.attestations)
    ? document.attestations.filter(
      (attestation) => attestation?.predicateType === provenancePredicateType,
    )
    : [];
  if (provenanceAttestations.length !== 1) {
    throw new Error(`${packageSpec} must expose exactly one SLSA v1 provenance attestation.`);
  }

  const expectedWorkflow = resolveTrustedWorkflow(context.workflowRef);
  const [{ bundle }] = provenanceAttestations;
  try {
    await (options.verifyBundle ?? defaultVerifyBundle)(bundle, {
      certificateIdentityURI:
        `^${escapeRegularExpression(expectedWorkflow.identity)}$`,
      certificateIssuer: githubOidcIssuer,
      ctLogThreshold: 1,
      tlogThreshold: 1,
    });
  } catch {
    throw new Error(
      `${packageSpec} npm provenance signature or GitHub workflow certificate identity is invalid.`,
    );
  }

  const statement = parseVerifiedStatement(bundle, packageSpec);
  assertStatementIdentity(
    packageInfo,
    statement,
    { headCommit: context.headCommit, metadata },
    expectedWorkflow,
  );

  return { statement, workflowIdentity: expectedWorkflow.identity };
}
