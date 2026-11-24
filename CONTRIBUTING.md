# Contributing

Keep the runtime dependency-free and the standalone HTML usable offline. Explain the problem, browser/OS, reproduction steps, and expected behavior when reporting a bug. Do not attach device logs containing secrets.

Edit `src/`, rebuild with `python3 scripts/build.py`, and include both generated HTML files in your pull request. Run `node --test tests/core.test.cjs` and `python3 scripts/build.py --check`. Add meaningful tests for transport or parsing changes. For interface or recording changes, also run `npm ci`, `npx playwright install chromium`, and `npm run test:browser`. Browser tests use mocked device/file access; retain manual hardware checks. Describe validation and any hardware used; do not claim hardware support based only on mocks.
