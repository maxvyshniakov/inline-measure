export const MAX_TMPDIR_LENGTH = 60;

export function normalizeTmpdir(env = process.env) {
  if (env.TMPDIR && env.TMPDIR.length > MAX_TMPDIR_LENGTH) {
    env.TMPDIR = "/tmp";
  }
  return env.TMPDIR;
}

normalizeTmpdir();
