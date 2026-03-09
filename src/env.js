// Remove CLAUDECODE env var so subprocess doesn't refuse to start
// when NightyTidy is invoked from within a Claude Code session.
// Safe because NightyTidy only uses non-interactive `claude -p` calls.
export function cleanEnv() {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  return env;
}
