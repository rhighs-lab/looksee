const NAME = /^[A-Za-z0-9_.-]{1,64}$/;

export const resolveActor = (
  flags: Record<string, string | boolean>,
  env: NodeJS.ProcessEnv
): string => {
  const as = flags['as'];
  const actor =
    (typeof as === 'string' && as) || env['LOOKSEE_ACTOR'] || 'agent';
  if (actor === 'user')
    throw new Error('actor "user" is reserved for the browser');
  if (!NAME.test(actor)) throw new Error(`invalid actor: ${actor}`);
  return actor;
};
