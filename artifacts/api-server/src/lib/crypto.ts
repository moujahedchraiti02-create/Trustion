import { createHash } from "crypto";

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function computeRawHash(data: Record<string, unknown>): string {
  return sha256(JSON.stringify(data));
}

export function computeChainHash(rawHash: string, prevHash: string | null): string {
  return sha256(`${rawHash}:${prevHash ?? "GENESIS"}`);
}

export function buildMerkleProof(entries: { chainHash: string }[], targetIndex: number): string[] {
  if (entries.length === 0) return [];
  const hashes = entries.map((e) => e.chainHash);
  const proof: string[] = [];
  let idx = targetIndex;
  let levelHashes = [...hashes];

  while (levelHashes.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < levelHashes.length; i += 2) {
      const left = levelHashes[i];
      const right = levelHashes[i + 1] ?? left;
      next.push(sha256(`${left}${right}`));
    }
    const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
    if (siblingIdx < levelHashes.length) {
      proof.push(levelHashes[siblingIdx]);
    }
    idx = Math.floor(idx / 2);
    levelHashes = next;
  }
  return proof;
}
