import { expect } from 'chai';
import { FORCE_ENV_VAR, shouldSkipIntegrationTests } from '../../scripts/vscode-test-gate.mjs';

describe('shouldSkipIntegrationTests', () => {
  it('skips when CI is set and no force override is present', () => {
    const decision = shouldSkipIntegrationTests({ CI: '1' });

    expect(decision.shouldSkip).to.equal(true);
    expect(decision.reason).to.equal('ci');
  });

  it('does not skip when force override is set', () => {
    const decision = shouldSkipIntegrationTests({
      CI: '1',
      [FORCE_ENV_VAR]: '1',
    });

    expect(decision.shouldSkip).to.equal(false);
    expect(decision.reason).to.equal(null);
  });

  it('does not skip when CI is unset', () => {
    const decision = shouldSkipIntegrationTests({});

    expect(decision.shouldSkip).to.equal(false);
    expect(decision.reason).to.equal(null);
  });
});
