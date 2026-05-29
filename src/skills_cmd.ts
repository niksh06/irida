/**
 * `csagent skills list|search` — discover local Markdown skills (issue 015).
 */
import { loadConfig, ConfigError } from "./config.js";
import { listSkills, searchSkills } from "./skills.js";
import { EXIT, type ExitCode } from "./exit.js";
import { relative } from "node:path";

export interface SkillsCmdOptions {
  dir?: string;
}

function formatSkill(s: { name: string; description: string; tags: string[]; path: string }, cwd: string): string {
  const tags = s.tags.length ? `[${s.tags.join(", ")}]` : "[]";
  const rel = relative(cwd, s.path);
  const desc = s.description || "—";
  return `${s.name.padEnd(16)} ${desc.slice(0, 40).padEnd(40)} ${tags.padEnd(14)} ${rel}`;
}

export function cmdSkillsList(opts: SkillsCmdOptions = {}): ExitCode {
  const dir = opts.dir ?? process.cwd();
  let cfg;
  try {
    cfg = loadConfig(dir);
  } catch (e) {
    console.error("skills: " + (e instanceof ConfigError ? e.message : String(e)));
    return EXIT.config;
  }
  const all = listSkills(dir, cfg.skillsPath);
  if (all.length === 0) {
    console.log(`No skills found under ${cfg.skillsPath}/`);
    return EXIT.ok;
  }
  console.log("NAME             DESCRIPTION                              TAGS           PATH");
  for (const s of all) console.log(formatSkill(s, dir));
  return EXIT.ok;
}

export function cmdSkillsSearch(query: string, opts: SkillsCmdOptions = {}): ExitCode {
  const dir = opts.dir ?? process.cwd();
  if (!query || !query.trim()) {
    console.error('skills search: a query is required, e.g. csagent skills search "review"');
    return EXIT.usage;
  }
  let cfg;
  try {
    cfg = loadConfig(dir);
  } catch (e) {
    console.error("skills: " + (e instanceof ConfigError ? e.message : String(e)));
    return EXIT.config;
  }
  const hits = searchSkills(dir, cfg.skillsPath, query);
  if (hits.length === 0) {
    console.log(`No skills match "${query.trim()}" under ${cfg.skillsPath}/`);
    return EXIT.ok;
  }
  console.log(`NAME             DESCRIPTION                              TAGS           PATH`);
  for (const s of hits) console.log(formatSkill(s, dir));
  return EXIT.ok;
}

export function cmdSkills(argv: string[], opts: SkillsCmdOptions = {}): ExitCode {
  const [sub, ...rest] = argv;
  switch (sub) {
    case "list":
      return cmdSkillsList(opts);
    case "search":
      return cmdSkillsSearch(rest.join(" "), opts);
    case undefined:
    case "-h":
    case "--help":
    case "help":
      console.log(`Usage:
  csagent skills list              list local skills
  csagent skills search <query>    search name/description/tags
`);
      return EXIT.ok;
    default:
      console.error(`unknown skills subcommand: ${sub}\n\nRun: csagent skills help`);
      return EXIT.usage;
  }
}
