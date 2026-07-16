import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";

const contractDirectory = new URL("../contracts/kisnet/", import.meta.url);
const destinations = [
  new URL("../packages/node/.kisnet-contract-sha256", import.meta.url),
  new URL("../packages/python/.kisnet-contract-sha256", import.meta.url)
];

const hash = createHash("sha256");
for (const filename of (await readdir(contractDirectory)).sort()) {
  hash.update(`${filename}\0`);
  hash.update(await readFile(new URL(filename, contractDirectory)));
  hash.update("\0");
}
const expected = `${hash.digest("hex")}\n`;

if (process.argv.includes("--check")) {
  const stale = [];
  for (const destination of destinations) {
    const actual = await readFile(destination, "utf8");
    if (actual !== expected) stale.push(destination.pathname);
  }
  if (stale.length > 0) {
    console.error(`Shared contract release hashes are stale: ${stale.join(", ")}`);
    console.error("Run `bun run contracts:sync` and commit both package hash files.");
    process.exit(1);
  }
  console.log("shared contract release hashes match");
} else {
  await Promise.all(destinations.map((destination) => writeFile(destination, expected)));
  console.log("shared contract release hashes updated");
}
