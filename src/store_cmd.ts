/**
 * `csagent store migrate` — sqlite → postgres (I-28).
 */
import { loadConfig, ConfigError } from "./config.js";
import { migrateSqliteToPostgres } from "./storeMigrate.js";
import { EXIT, type ExitCode } from "./exit.js";

export async function cmdStoreMigrate(
  pgUrl: string | undefined,
  dir: string = process.cwd()
): Promise<ExitCode> {
  const url = pgUrl?.trim() || process.env.CSAGENT_DATABASE_URL?.trim();
  if (!url) {
    console.error("store migrate: set CSAGENT_DATABASE_URL or pass postgres URL");
    return EXIT.config;
  }
  try {
    loadConfig(dir);
    const result = await migrateSqliteToPostgres(dir, url);
    console.log(
      `store migrate: sessions=${result.sessions} runs=${result.runs} (sqlite → postgres)`
    );
    return EXIT.ok;
  } catch (e) {
    console.error(
      "store migrate: " + (e instanceof ConfigError ? e.message : (e as Error).message)
    );
    return EXIT.config;
  }
}

export async function cmdStore(argv: string[], dir: string = process.cwd()): Promise<ExitCode> {
  const [sub, ...rest] = argv;
  switch (sub) {
    case "migrate":
      return cmdStoreMigrate(rest[0], dir);
    case undefined:
    case "help":
    case "-h":
    case "--help":
      console.log(`Usage:
  csagent store migrate [postgres-url]   copy sqlite sessions/runs to PG
`);
      return EXIT.ok;
    default:
      console.error(`unknown store subcommand: ${sub}`);
      return EXIT.usage;
  }
}
