import fs from "node:fs";
import path from "node:path";

type PathSnapshot =
  | { kind: "missing" }
  | { kind: "file"; content: Buffer; mode: number }
  | { kind: "directory"; mode: number; entries: Map<string, PathSnapshot> }
  | { kind: "symlink"; target: string };

/** In-memory snapshots for the small set of project paths mutated by a CLI command. */
export class ProjectFileTransaction {
  private readonly snapshots: Array<{ target: string; snapshot: PathSnapshot }>;

  constructor(targets: string[]) {
    const uniqueTargets = [...new Set(targets.map((target) => path.resolve(target)))];
    this.snapshots = uniqueTargets.map((target) => ({
      target,
      snapshot: capturePath(target),
    }));
  }

  rollback(): void {
    const errors: unknown[] = [];
    for (const entry of [...this.snapshots].reverse()) {
      try {
        restorePath(entry.target, entry.snapshot);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "Impossible de restaurer tous les fichiers du projet");
    }
  }
}

function capturePath(target: string): PathSnapshot {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
    throw error;
  }
  if (stat.isSymbolicLink()) {
    return { kind: "symlink", target: fs.readlinkSync(target) };
  }
  if (stat.isDirectory()) {
    const entries = new Map<string, PathSnapshot>();
    for (const name of fs.readdirSync(target)) {
      entries.set(name, capturePath(path.join(target, name)));
    }
    return { kind: "directory", mode: stat.mode, entries };
  }
  if (stat.isFile()) {
    return { kind: "file", content: fs.readFileSync(target), mode: stat.mode };
  }
  throw new Error(`Type de fichier non pris en charge pour le snapshot: ${target}`);
}

function restorePath(target: string, snapshot: PathSnapshot): void {
  fs.rmSync(target, { recursive: true, force: true });
  if (snapshot.kind === "missing") return;

  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (snapshot.kind === "file") {
    fs.writeFileSync(target, snapshot.content);
    fs.chmodSync(target, snapshot.mode);
    return;
  }
  if (snapshot.kind === "symlink") {
    fs.symlinkSync(snapshot.target, target);
    return;
  }

  fs.mkdirSync(target, { recursive: true });
  for (const [name, child] of snapshot.entries) {
    restorePath(path.join(target, name), child);
  }
  fs.chmodSync(target, snapshot.mode);
}
