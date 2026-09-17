# Testing Standards & Quality Bars

## 1. Scope
Applies to all test files, test fixtures, and mock configurations.

## 2. Required Patterns
- Unit tests must be hermetic and execute with zero external network dependency.
- Test suites must follow the Arrange-Act-Assert structure.
- Coverage bars: Ensure new logic contains corresponding unit or integration test paths.

## 3. Prohibited Patterns
- **No Production Test Mocks**: Never add mock switches or testing bypass logic inside production application code.
- **No Suppressed Failures**: Never catch errors in test assertions to artificially force tests to pass.
- **No Sleep-Based Waits**: Never use arbitrary `sleep()` or timeout delays in place of deterministic condition polling.

## 4. Verification
Run:
```bash
pnpm test
```
