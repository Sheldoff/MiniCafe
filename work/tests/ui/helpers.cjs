const path = require("path");
const search = [
  process.env.PLAYWRIGHT_MODULE,
  path.join(__dirname, "../../tooling/node_modules/playwright"),
  path.join(
    process.env.USERPROFILE || process.env.HOME,
    ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
  ),
].filter(Boolean);
let playwright;
for (let location of search) {
  try {
    playwright = require(location);
    break;
  } catch {}
}
if (!playwright)
  throw Error("Set PLAYWRIGHT_MODULE to the installed Playwright package");
module.exports = {
  ...playwright,
  base: process.env.CAFE_TEST_URL || "http://127.0.0.1:8768",
  key: process.env.CAFE_TEST_KEY || "phone-test-key",
  chromeOptions: process.env.CHROME_EXECUTABLE
    ? { executablePath: process.env.CHROME_EXECUTABLE }
    : { channel: "chrome" },
};
