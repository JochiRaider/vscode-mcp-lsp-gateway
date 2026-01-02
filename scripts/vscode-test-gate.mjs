const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on']);

export const FORCE_ENV_VAR = 'MCP_LSP_GATEWAY_FORCE_INTEGRATION_TESTS';

const isTruthy = (value) => {
  if (!value) {
    return false;
  }
  return TRUTHY_VALUES.has(String(value).trim().toLowerCase());
};

export const shouldSkipIntegrationTests = (env) => {
  if (isTruthy(env[FORCE_ENV_VAR])) {
    return { shouldSkip: false, reason: null };
  }

  if (isTruthy(env.CI)) {
    return { shouldSkip: true, reason: 'ci' };
  }

  return { shouldSkip: false, reason: null };
};
