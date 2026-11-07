// Shared helpers for the database maintenance scripts (backup, restore, tenancy checks).

export function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** Host and database name only — never the user or password. */
export function describeTarget(connectionString) {
  const url = new URL(connectionString);
  return `${url.hostname}:${url.port || 5432}${url.pathname}`;
}

/**
 * Connection string from --url, DIRECT_DATABASE_URL or DATABASE_URL. Anything that is not on this machine
 * (for example Neon) is refused unless --confirm-remote is passed, so a script cannot reach the live
 * database by accident.
 */
export function connectionFromEnv(args) {
  const connectionString = args.url || process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Set DATABASE_URL (or DIRECT_DATABASE_URL, or pass --url).");
  if (!/^postgres(ql)?:\/\//.test(connectionString)) throw new Error("Only PostgreSQL connection strings are supported.");
  const { hostname } = new URL(connectionString);
  if (!LOCAL_HOSTS.has(hostname) && !args["confirm-remote"]) {
    throw new Error(`Refusing to use the remote database ${hostname} without --confirm-remote.`);
  }
  console.log(`Database: ${describeTarget(connectionString)}`);
  return connectionString;
}
