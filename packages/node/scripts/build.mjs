import { mkdir, copyFile, chmod } from "node:fs/promises";

await mkdir("dist", { recursive: true });
await copyFile("src/nexacro.js", "dist/nexacro.js");
await copyFile("src/toolset.js", "dist/toolset.js");
await copyFile("src/toolset.d.ts", "dist/toolset.d.ts");
await copyFile("src/cli.js", "dist/cli.js");
await chmod("dist/cli.js", 0o755);
