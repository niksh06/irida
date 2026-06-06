/**
 * TParser daily digest — five topic delegate runs + synthesizer (parent merge).
 */
import { loadCronJobPromptText } from "./cronPrompt.js";
import { buildSeenPostsPromptSection } from "./memoryDedup.js";
import { runDelegate } from "./delegateRun.js";
import { runPrompt } from "./run.js";
import { TPARSE_DAILY_TOPICS, topicTagHintLine, type TparserTopic } from "./tparserTopics.js";
import type { CronJob } from "./cronJobs.js";
import type { SdkLike } from "./host.js";
import type { SdkCreateLike, SdkResumeLike } from "./host.js";
import { EXIT, type ExitCode } from "./exit.js";

export interface TopicDigestResult {
  ok: boolean;
  exitCode: ExitCode;
  message: string;
  output?: string;
  topicSummaries: Array<{ topicId: string; title: string; ok: boolean; summary: string }>;
}

function loadPromptFile(job: CronJob, dir: string, field: "topicPromptFile" | "synthesizePromptFile"): string {
  const rel = field === "topicPromptFile" ? job.topicPromptFile : job.synthesizePromptFile;
  if (!rel?.trim()) throw new Error(`${field} is required for topicDelegates jobs`);
  return loadCronJobPromptText({ ...job, promptFile: rel.trim(), prompt: undefined }, dir);
}

function fillTopicTemplate(template: string, topic: TparserTopic, windowHours: number): string {
  const now = new Date();
  const end = now.toISOString();
  const start = new Date(now.getTime() - windowHours * 3600_000).toISOString();
  return template
    .replaceAll("{TOPIC_ID}", topic.id)
    .replaceAll("{TOPIC_TITLE}", topic.title)
    .replaceAll("{TAG_HINTS}", topicTagHintLine(topic))
    .replaceAll("{WINDOW_HOURS}", String(windowHours))
    .replaceAll("{WINDOW_START}", start)
    .replaceAll("{WINDOW_END}", end);
}

function fillSynthesizeTemplate(
  template: string,
  sections: Array<{ topicId: string; title: string; body: string }>,
  windowHours: number
): string {
  const now = new Date();
  const end = now.toISOString();
  const start = new Date(now.getTime() - windowHours * 3600_000).toISOString();
  const block = sections
    .map((s) => `## TOPIC:${s.topicId} (${s.title})\n\n${s.body.trim()}`)
    .join("\n\n---\n\n");
  return template
    .replaceAll("{WINDOW_HOURS}", String(windowHours))
    .replaceAll("{WINDOW_START}", start)
    .replaceAll("{WINDOW_END}", end)
    .replaceAll("{TOPIC_SECTIONS}", block);
}

export async function executeTopicDigestJob(
  job: CronJob,
  dir: string,
  opts: {
    sdk?: SdkLike & SdkCreateLike & SdkResumeLike;
    windowHours?: number;
    onLog?: (line: string) => void;
  } = {}
): Promise<TopicDigestResult> {
  const workDir = job.cwd ?? dir;
  const windowHours = opts.windowHours ?? job.topicWindowHours ?? 24;
  const log = opts.onLog ?? ((s: string) => console.error(s));

  const topicTemplate = loadPromptFile(job, dir, "topicPromptFile");
  const synthTemplate = loadPromptFile(job, dir, "synthesizePromptFile");

  let seenBlock = "";
  if (job.memoryFactsSubject === "seen_post") {
    seenBlock = await buildSeenPostsPromptSection(dir, { limit: job.memoryFactsLimit ?? 200 });
  }

  const topicSummaries: TopicDigestResult["topicSummaries"] = [];

  for (const topic of TPARSE_DAILY_TOPICS) {
    log(`[cron] topic delegate start topic=${topic.id}`);
    let prompt = fillTopicTemplate(topicTemplate, topic, windowHours);
    if (seenBlock) prompt = `${seenBlock}\n\n${prompt}`;
    const out = await runDelegate({
      dir,
      cwd: workDir,
      prompt,
      skills: job.skills,
      yesIUnderstand: job.yesIUnderstand,
      sdk: opts.sdk,
    });
    topicSummaries.push({
      topicId: topic.id,
      title: topic.title,
      ok: out.ok,
      summary: out.summary,
    });
    log(`[cron] topic delegate done topic=${topic.id} ok=${out.ok} chars=${out.summary.length}`);
  }

  const sections = topicSummaries.map((t) => ({
    topicId: t.topicId,
    title: t.title,
    body: t.ok ? t.summary : `(delegate failed: ${t.summary})`,
  }));
  let synthPrompt = fillSynthesizeTemplate(synthTemplate, sections, windowHours);
  if (seenBlock) synthPrompt = `${seenBlock}\n\n${synthPrompt}`;

  log(`[cron] topic digest synthesize start`);
  const synth = await runPrompt(synthPrompt, {
    dir,
    cwd: workDir,
    sdk: opts.sdk,
    skills: job.skills,
    yesIUnderstand: job.yesIUnderstand,
  });

  return {
    ok: synth.exitCode === EXIT.ok,
    exitCode: synth.exitCode,
    message: synth.exitCode === EXIT.ok ? synth.text.slice(0, 200) || "finished" : `synthesize exited ${synth.exitCode}`,
    output: synth.text,
    topicSummaries,
  };
}

/** Resolve topic/synthesize prompt paths relative to CSAGENT_ROOT when missing in cwd. */
export function resolveTopicDigestPromptPaths(job: CronJob, dir: string): { ok: boolean; error?: string } {
  for (const field of ["topicPromptFile", "synthesizePromptFile"] as const) {
    const rel = job[field];
    if (!rel?.trim()) return { ok: false, error: `${field} required when topicDelegates=true` };
    try {
      loadCronJobPromptText({ ...job, promptFile: rel.trim() }, dir);
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
  return { ok: true };
}
