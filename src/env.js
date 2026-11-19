import { existsSync } from 'node:fs';

const PREFIX = '/opt/homebrew';

/**
 * Return a copy of env with Homebrew on PATH (if brew is installed). Lets commands later in the
 * same run find `brew` without a new shell. Idempotent.
 */
export function brewEnv(env, exists = existsSync) {
  if (!exists(`${PREFIX}/bin/brew`)) return env;
  const add = [`${PREFIX}/bin`, `${PREFIX}/sbin`];
  const rest = (env.PATH ?? '').split(':').filter((p) => p && !add.includes(p));
  return { ...env, PATH: [...add, ...rest].join(':'), HOMEBREW_PREFIX: PREFIX };
}
