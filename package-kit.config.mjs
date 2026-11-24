// The gate (bun run verify), the pre-push hook, release and publish:
// @maxvyshniakov/package-kit (README.md there).

// Minutes one browser script may run before verify stops its whole process
// tree. Each takes seconds (docs/performance/README.md).
const BROWSER_SCRIPT_TIMEOUT = 2;
const ENGINES = ["chromium", "firefox", "webkit"];
// GiB a script's process tree may use (measured 2026-11-24: Firefox 2.1, the others under 0.6;
// Firefox is the installed stable over BiDi).
const ENGINE_MEMORY = { chromium: 1, firefox: 3, webkit: 1 };
// What the browser scripts read: a change elsewhere (docs) plans none of them.
const BROWSER_INPUTS = ["src/**", "scripts/perf/**", "package.json", "bun.lock"];
const SCRIPTS = { browser: "check:browser:engine", fonts: "check:fonts:engine", boxes: "check:boxes:engine" };

export default {
  verify: {
    // `bun run verify:browser`, and package-kit's local release gate after
    // `verify --release`. Not in `steps`: hosted CI (check.yml, release-npm.yml's
    // check job) runs plain verify on a runner with no Firefox or WebKit.
    // Nine independent steps: the first failure stops the run, --keep-going
    // reports every engine's. One slot runs them one at a time.
    browser: ENGINES.flatMap((engine) => Object.entries(SCRIPTS).map(([check, script]) => ({
      name: `${check} ${engine}`,
      command: ["run", script, "--", "--browser", engine],
      slots: 1,
      timeout: BROWSER_SCRIPT_TIMEOUT,
      memory: ENGINE_MEMORY[engine],
      inputs: BROWSER_INPUTS,
    }))),
    browserSlots: 1,
    // Paths no check reads, so a change to them alone plans no check.
    inert: ["**/*.md", "docs/**", "LICENSE"],
    steps: ({ release }) => [
      { name: "changelog", command: ["run", "check:changelogs", ...(release ? ["--", "--release"] : [])] },
      { name: "kit", command: ["run", "check:kit"] },
      { name: "build", command: ["run", "build"] },
      { name: "packed consumer", command: ["run", "check:consumer"], needs: ["build"] },
      { name: "lint", command: ["run", "lint"] },
      { name: "test", command: ["run", "test"], usesCores: true },
      { name: "typecheck", command: ["run", "typecheck"] },
    ],
  },
  publish: {
    // npmjs.org with trusted publishing and provenance, from .github/workflows/release-npm.yml.
    registry: "npm",
    access: "public",
    // Data Grid adopts the release through its catalog dependency workflow.
    notify: [{ repository: "maxvyshniakov/data-grid", workflow: "update-catalog-dependencies.yml", ref: "main" }],
  },
};
