export const strictSemver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function assertStableReleaseVersion(version) {
  if (typeof version !== "string") {
    throw new Error(`Release version "${String(version)}" is not valid strict SemVer.`);
  }

  const match = strictSemver.exec(version);
  if (!match || match[0] !== version) {
    throw new Error(`Release version "${version}" is not valid strict SemVer.`);
  }

  if (match[4]) {
    throw new Error(
      `Prerelease version "${version}" is not publishable until an explicit npm dist-tag is supported.`,
    );
  }

  if (match[5]) {
    throw new Error(
      `Build-metadata version "${version}" is not publishable because npm ignores SemVer build metadata when comparing versions.`,
    );
  }

  return version;
}
