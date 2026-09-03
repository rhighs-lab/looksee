export const resolveActor = (
  flags: Record<string, string | boolean>,
  env: NodeJS.ProcessEnv
): string => {
  const as = flags['as'];
  const actor =
    (typeof as === 'string' && as) || env['LOOKSEE_ACTOR'] || 'agent';
  if (actor === 'user')
    throw new Error('actor "user" is reserved for the browser');
  return actor;
};
