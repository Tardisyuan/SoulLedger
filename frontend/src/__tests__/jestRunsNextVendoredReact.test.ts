/**
 * The React jest runs must be the React production runs: Next's vendored copy
 * (see the `moduleNameMapper` note in jest.config.js).
 *
 * The expected version is not written here. The vendored package.json has no
 * `version` field (it is `react-builtin`), so it is read from the vendored
 * module itself, loaded by absolute path — a specifier the `^react$` mapping
 * cannot match, so this load is the vendored file whatever the mapping says.
 * Mutation-checked: with the four react/react-dom lines removed from the
 * mapper, `React.version` becomes the installed 19.2.3 and this goes red.
 */
import path from "path";
import React from "react";
import ReactDOM from "react-dom";
import fs from "fs";

const nextDir = path.dirname(require.resolve("next/package.json"));
const vendoredReact = require(path.join(nextDir, "dist/compiled/react/index.js")) as { version: string };
const vendoredDom = require(path.join(nextDir, "dist/compiled/react-dom/index.js")) as { version: string };

describe("jest runs Next's vendored React", () => {
  it("react is the vendored copy", () => {
    expect(vendoredReact.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(React.version).toBe(vendoredReact.version);
  });

  it("react-dom is the vendored copy", () => {
    expect(ReactDOM.version).toBe(vendoredDom.version);
    expect(ReactDOM.version).toBe(React.version);
  });

  it("is not vacuous: the installed react differs from the vendored one", () => {
    // Read by file, not `require("react/package.json")`, which the mapper
    // would send to the vendored (version-less) package.json. If a future Next
    // vendors exactly the installed version, the two tests above can no longer
    // tell a working mapping from a missing one — this goes red to say so.
    const rootDir = path.resolve(nextDir, "..", "..");
    const installed = JSON.parse(fs.readFileSync(path.join(rootDir, "node_modules/react/package.json"), "utf8")) as {
      version: string;
    };
    expect(installed.version).not.toBe(vendoredReact.version);
  });
});
