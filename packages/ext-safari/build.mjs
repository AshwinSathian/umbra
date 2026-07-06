// Rebuilds the shared web-extension bundle (packages/ext-chrome/dist) and
// copies it into the generated Xcode project's Resources folders, then
// invokes xcodebuild. The Xcode project itself (Umbra.xcodeproj + the two
// Swift files) is committed source, generated once via:
//   xcrun safari-web-extension-converter packages/ext-chrome/dist \
//     --project-location packages/ext-safari --app-name Umbra \
//     --bundle-identifier com.umbra.darkmode --swift --macos-only \
//     --copy-resources --no-open --no-prompt
// The *.js/.map/.html/manifest.json files it copied into
// "Umbra/Umbra Extension/Resources" are build output, not source — this
// script keeps them in sync with packages/ext-chrome/dist rather than
// requiring them to be committed and manually kept up to date.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const chromeDistDir = path.join(dir, "../ext-chrome/dist");
const resourcesDir = path.join(dir, "Umbra/Umbra Extension/Resources");
const xcodeprojDir = path.join(dir, "Umbra");

if (!existsSync(chromeDistDir)) {
  console.log("Building packages/ext-chrome first (Safari resources are the same bundle)...");
  execFileSync("node", [path.join(dir, "../ext-chrome/build.mjs")], { stdio: "inherit" });
}

mkdirSync(resourcesDir, { recursive: true });
for (const file of readdirSync(chromeDistDir)) {
  cpSync(path.join(chromeDistDir, file), path.join(resourcesDir, file), { recursive: true });
}
console.log(`Synced ${readdirSync(chromeDistDir).length} files into "${resourcesDir}"`);

if (!existsSync(path.join(xcodeprojDir, "Umbra.xcodeproj"))) {
  console.log(
    "\nNo Xcode project found. Generate it once with:\n" +
      "  xcrun safari-web-extension-converter packages/ext-chrome/dist \\\n" +
      "    --project-location packages/ext-safari --app-name Umbra \\\n" +
      "    --bundle-identifier com.umbra.darkmode --swift --macos-only \\\n" +
      "    --copy-resources --no-open --no-prompt\n" +
      "Then re-run this script.",
  );
  process.exit(1);
}

if (process.argv.includes("--build")) {
  execFileSync(
    "xcodebuild",
    ["-project", "Umbra.xcodeproj", "-scheme", "Umbra", "-configuration", "Debug", "build"],
    { cwd: xcodeprojDir, stdio: "inherit" },
  );
}
