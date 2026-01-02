export const FORCE_ENV_VAR: string;
export function shouldSkipIntegrationTests(env: NodeJS.ProcessEnv): {
  shouldSkip: boolean;
  reason: 'ci' | null;
};
