import { readFile } from "node:fs/promises";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

const [rootPackage, nodePackage, manifest, config, pyproject, uvLock, bunLock, npmWorkflow, pypiWorkflow, nodeChangelog, pythonChangelog] = await Promise.all([
  readJson("package.json"),
  readJson("packages/node/package.json"),
  readJson(".release-please-manifest.json"),
  readJson("release-please-config.json"),
  readFile("packages/python/pyproject.toml", "utf8"),
  readFile("packages/python/uv.lock", "utf8"),
  readFile("bun.lock", "utf8"),
  readFile(".github/workflows/release.yml", "utf8"),
  readFile(".github/workflows/release-python.yml", "utf8"),
  readFile("packages/node/CHANGELOG.md", "utf8"),
  readFile("packages/python/CHANGELOG.md", "utf8")
]);

const pythonVersion = /^version = "([^"]+)"$/m.exec(pyproject)?.[1];
const uvVersion = /\[\[package\]\]\nname = "kisnet-ytm"\nversion = "([^"]+)"/.exec(uvLock)?.[1];
const bunVersion = /"packages\/node"\s*:\s*\{[\s\S]*?"version":\s*"([^"]+)"/.exec(bunLock)?.[1];
const versions = [nodePackage.version, pythonVersion, uvVersion, bunVersion, ...Object.values(manifest)];

check(rootPackage.private === true, "root package must remain private");
check(rootPackage.version === undefined, "root package must not become a release component");
check(JSON.stringify(rootPackage.workspaces) === JSON.stringify(["packages/*"]), "root workspaces must remain packages/*");
check(versions.every((version) => version === nodePackage.version), `all package, lock, and manifest versions must match: ${versions.join(", ")}`);
check(uvLock.includes(`version = "${nodePackage.version}" # x-release-please-version`), "uv.lock package version must retain its Release Please annotation");
check(bunLock.includes(`"version": "${nodePackage.version}", // x-release-please-version`), "bun.lock workspace version must retain its Release Please annotation");

const packagePaths = Object.keys(config.packages || {}).sort();
check(JSON.stringify(packagePaths) === JSON.stringify(["packages/node", "packages/python"]), "Release Please must manage exactly the Node and Python package paths");
check(config["bootstrap-sha"] === "7f837f20deb08008361ed2c280f8342dff42da98", "Release Please must bootstrap from the historical v0.1.1 release commit");
check(config["include-component-in-tag"] === true, "Release Please tags must include components");
check(config["include-v-in-tag"] === true, "Release Please component tags must retain the v prefix");
check(!Object.hasOwn(config, "release-as") && packagePaths.every((path) => !Object.hasOwn(config.packages[path], "release-as")), "the first shared release version must not be selected in repository config");
const nodeRelease = config.packages?.["packages/node"];
const pythonRelease = config.packages?.["packages/python"];
check(nodeRelease?.["release-type"] === "node" && nodeRelease?.component === "node", "Node Release Please component must use the node strategy and component");
check(pythonRelease?.["release-type"] === "python" && pythonRelease?.component === "python", "Python Release Please component must use the python strategy and component");
check(nodeRelease?.["changelog-path"] === "CHANGELOG.md" && nodeChangelog.startsWith("# Changelog"), "Node must own a package-local changelog");
check(pythonRelease?.["changelog-path"] === "CHANGELOG.md" && pythonChangelog.startsWith("# Changelog"), "Python must own a package-local changelog");
check(JSON.stringify(nodeRelease?.["extra-files"]) === JSON.stringify(["/bun.lock"]), "Node release must update the root Bun lock");
check(JSON.stringify(pythonRelease?.["extra-files"]) === JSON.stringify(["/packages/python/uv.lock"]), "Python release must update its uv lock");
const linked = config.plugins?.find((plugin) => plugin.type === "linked-versions");
check(linked?.groupName === "ytm", "Release Please must use the ytm linked-version group");
check(JSON.stringify([...(linked?.components || [])].sort()) === JSON.stringify(["node", "python"]), "linked-version group must contain node and python");

check(npmWorkflow.includes('"node-v*.*.*"'), "npm workflow must trigger only from Node component tags");
check(npmWorkflow.includes('"node-v$PACKAGE_VERSION"'), "npm workflow must verify its component tag and version");
check(npmWorkflow.includes("working-directory: packages/node"), "npm publish must run from packages/node");
check(npmWorkflow.includes("id-token: write"), "npm trusted publishing must request OIDC");
check(npmWorkflow.includes("name: npm"), "npm publish job must use the npm GitHub environment");
check(pypiWorkflow.includes('"python-v*.*.*"'), "PyPI workflow must trigger only from Python component tags");
check(pypiWorkflow.includes('"python-v$PACKAGE_VERSION"'), "PyPI workflow must verify its component tag and version");
check(pypiWorkflow.includes("actions/upload-artifact@") && pypiWorkflow.includes("actions/download-artifact@"), "PyPI workflow must promote the validated distributions");
check(pypiWorkflow.includes("uv publish --check-url https://pypi.org/simple/kisnet-ytm/ --trusted-publishing always dist/*"), "PyPI workflow must publish idempotently with trusted publishing");
check(pypiWorkflow.includes("id-token: write"), "PyPI trusted publishing must request OIDC");
check(pypiWorkflow.includes("name: pypi"), "PyPI publish job must use the pypi GitHub environment");

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
console.log(`release configuration valid at shared baseline ${nodePackage.version}`);
