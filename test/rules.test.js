const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..', 'hide-test-files.src.js');
const src = fs.readFileSync(SRC, 'utf8');
const block = src.match(/const BUILT_IN_RULES = \[[\s\S]*?\n    \];/)[0];
const rules = eval(block.replace('const BUILT_IN_RULES =', '(') .replace(/;$/, ')'));
const match = p => { for (const [n, re] of rules) if (re.test(p)) return n; return null; };

const SHOULD_HIDE = [
    'test/api_test/spec/checkoutFlow.js',
    'test/api_test/run-suite.js',
    'client/app/widgets/gauge/gauge.component.spec.ts',
    'server/lib/pricing/rateTable.spec.js',
    'src/__tests__/utils.tsx',
    'src/__snapshots__/Button.test.tsx.snap',
    'src/components/Button.test.jsx',
    'cypress/e2e/login.cy.ts',
    'e2e/app.e2e-spec.ts',
    'api/tests/test_views.py',
    'api/test_views.py',
    'api/views_test.py',
    'api/conftest.py',
    'pkg/server/handler_test.go',
    'spec/models/user_spec.rb',
    'src/test/java/com/acme/UserServiceTest.java',
    'src/test/kotlin/com/acme/UserSpec.kt',
    'src/it/java/com/acme/SmokeIT.java',
    'Acme.Api/UserServiceTests.cs',
    'tests/Unit/UserTest.php',
    'features/checkout.feature',
    'jest.config.js',
    'vitest.setup.ts',
    'playwright.config.ts',
    '__mocks__/fs.js',
    'testdata/sample.json',
    'packages/react-devtools-shared/src/__tests__/profilingCommitTreeBuilder-test.js',
    'src/utils/format-test.ts',
    'src/utils/format_test.tsx',
    'app/api/route.cy.tsx',
    'src/legacy/app.e2e-spec.ts',
];
const SHOULD_KEEP = [
    'server/lib/pricing/rateTable.js',
    'client/app/widgets/gauge/gauge.component.ts',
    'packages/test-utils/src/render.ts',
    'src/latest/version.ts',
    'docs/testing-conventions.md',
    'src/protest/manifest.json',
    'migrations/20260903120000-add-column.js',
    'Contest.java',
    'src/greatest.py',
    'webpack.config.js',
    'tsconfig.json',
    'server/routes/attest.js',
    'lib/manifest.rb',
    'src/utils/latest.ts',
    'src/api/request.ts',
    'client/app/manifest.mjs',
    'src/greatest.tsx',
    'lib/protest.cjs',
];

let fail = 0;
for (const p of SHOULD_HIDE) {
    const r = match(p);
    if (!r) { console.log('MISS  (should hide) ' + p); fail++; }
    else console.log('hide  [' + r + '] ' + p);
}
console.log('');
for (const p of SHOULD_KEEP) {
    const r = match(p);
    if (r) { console.log('FALSE POSITIVE [' + r + '] ' + p); fail++; }
    else console.log('keep  ' + p);
}
console.log('\n' + (fail === 0 ? 'ALL ' + (SHOULD_HIDE.length + SHOULD_KEEP.length) + ' PATH CASES PASS' : fail + ' FAILURES'));
process.exit(fail ? 1 : 0);
