# Release Dependency Audit

Audit date: 2026-08-03

## Runtime Dependencies

`npm audit --omit=dev` reports zero known vulnerabilities. Packaged production dependencies remain separate from build and test tooling.

## Development And Build Dependencies

Two high-severity transitive advisories were found and resolved without `npm audit fix --force`:

- `brace-expansion` below 1.1.17 was present only through Electron packaging utilities. The lockfile now resolves the affected 1.x paths to 1.1.18, within their existing compatible ranges.
- `postcss` through Vite was below the fixed release. The lockfile now resolves it to 8.5.25, within Vite's existing compatible range.

`npm audit` reports zero known vulnerabilities after these lockfile updates. CI runs both the production-only audit and the complete development/build audit at high severity.

`npm ci` still reports deprecation notices for `inflight`, `glob@7`, `rimraf@2`, and `boolean`. They are transitive development-only dependencies of the maintained Electron Builder 26.15.3 toolchain, including its Windows packaging path; they are not packaged production dependencies and currently have no audit finding. They are temporarily accepted for 0.1.0 rather than overridden across incompatible major versions. Reassess them when Electron Builder provides a compatible upstream replacement.

## Node Toolchain

The application supports Node.js 22.13.0 or newer within the Node 22 LTS line. `.nvmrc`, `.node-version`, `package.json`, CI, and the source-build documentation use that requirement. Root Node typings are kept on the Node 22 family.

## Windows Signing

The Windows 0.1.0 portable executable is not code-signed. An unknown-publisher or SmartScreen warning is expected until a future release process is configured with a trusted signing certificate. Release documentation must not describe the artifact as signed.

## Package Cleanup Measurement

Measured on the Linux x64 0.1.0 package before and after excluding development-only maps, declarations, TypeScript sources, tests, benchmarks, examples, and fixtures from ASAR:

| Artifact | Before | After | Change |
| --- | ---: | ---: | ---: |
| `app.asar` | 50,619,630 bytes | 30,553,585 bytes | 20,066,045 bytes smaller (39.6%) |
| AppImage | 303,357,226 bytes | 301,471,436 bytes | 1,885,790 bytes smaller (0.6%) |

The full AppImage changes less because the separately bundled Chromium runtime is the largest component and remains required for browser adapter sessions.
