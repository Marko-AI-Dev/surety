import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// One JSON document on disk, rewritten atomically (temp file then rename) on every change.
// Single-process only; the signer is one process by design.
export class JsonFile<T> {
  private value: T;

  constructor(
    private readonly file: string,
    initial: T,
  ) {
    mkdirSync(dirname(file), { recursive: true });
    this.value = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : initial;
  }

  get(): T {
    return this.value;
  }

  update(change: (current: T) => T): void {
    const next = change(this.value);
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(next, null, 1));
    renameSync(tmp, this.file);
    this.value = next;
  }
}
