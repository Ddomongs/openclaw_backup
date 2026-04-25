import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { execFile } from "child_process";
import { access } from "fs/promises";
import { constants } from "fs";

const DEFAULT_OMX = "/opt/homebrew/bin/omx";
const SAFE_WORKSPACE = "/Users/dh/.openclaw/workspace";
const DEFAULT_TIMEOUT_SECONDS = 120;
const DEFAULT_MAX_TIMEOUT_SECONDS = 1800;
const DEFAULT_MAX_OUTPUT_CHARS = 60000;

type Config = {
  command?: string;
  defaultTimeoutSeconds?: number;
  maxTimeoutSeconds?: number;
  maxOutputChars?: number;
};

type RunInput = {
  prompt?: string;
  query?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  timeoutSeconds?: number;
  json?: boolean;
  extraArgs?: string[];
};

type OmxResult = {
  command: string;
  args: string[];
  cwd: string;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  truncated: boolean;
};

function cfg(raw: unknown): Required<Config> {
  const c = (raw ?? {}) as Config;
  const maxTimeoutSeconds = clampNumber(c.maxTimeoutSeconds, 30, 7200, DEFAULT_MAX_TIMEOUT_SECONDS);
  return {
    command: c.command || DEFAULT_OMX,
    defaultTimeoutSeconds: clampNumber(c.defaultTimeoutSeconds, 5, maxTimeoutSeconds, DEFAULT_TIMEOUT_SECONDS),
    maxTimeoutSeconds,
    maxOutputChars: clampNumber(c.maxOutputChars, 1000, 200000, DEFAULT_MAX_OUTPUT_CHARS),
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function safeCwd(cwd?: string) {
  if (!cwd) return SAFE_WORKSPACE;
  const s = String(cwd).trim();
  if (!s) return SAFE_WORKSPACE;
  return s;
}

function sanitizeArgs(args?: unknown) {
  if (!Array.isArray(args)) return [];
  return args.map((v) => String(v)).filter((v) => v.length > 0).slice(0, 40);
}

function trimOutput(text: string, maxChars: number) {
  if (text.length <= maxChars) return { text, truncated: false };
  const head = text.slice(0, Math.floor(maxChars * 0.55));
  const tail = text.slice(text.length - Math.floor(maxChars * 0.4));
  return { text: `${head}\n\n[… omitted ${text.length - head.length - tail.length} chars …]\n\n${tail}`, truncated: true };
}

async function ensureOmx(command: string) {
  if (command.includes("/")) await access(command, constants.X_OK);
}

function runOmx(command: string, args: string[], opts: { cwd: string; timeoutSeconds: number; maxOutputChars: number }): Promise<OmxResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    execFile(command, args, {
      cwd: opts.cwd,
      timeout: opts.timeoutSeconds * 1000,
      maxBuffer: Math.max(opts.maxOutputChars * 4, 1024 * 1024),
      env: process.env,
    }, (error: any, stdoutRaw, stderrRaw) => {
      const stdoutTrim = trimOutput(String(stdoutRaw ?? ""), opts.maxOutputChars);
      const stderrTrim = trimOutput(String(stderrRaw ?? ""), Math.max(4000, Math.floor(opts.maxOutputChars / 3)));
      const timedOut = Boolean(error?.killed || error?.signal === "SIGTERM") && Date.now() - started >= opts.timeoutSeconds * 1000 - 1000;
      resolve({
        command,
        args,
        cwd: opts.cwd,
        exitCode: typeof error?.code === "number" ? error.code : error ? null : 0,
        timedOut,
        stdout: stdoutTrim.text,
        stderr: stderrTrim.text,
        truncated: stdoutTrim.truncated || stderrTrim.truncated,
      });
    });
  });
}

function toolText(result: OmxResult) {
  const status = result.exitCode === 0 ? "ok" : result.timedOut ? "timeout" : "error";
  return [
    `omx status: ${status}`,
    `command: ${result.command} ${result.args.map((a) => JSON.stringify(a)).join(" ")}`,
    `cwd: ${result.cwd}`,
    `exitCode: ${result.exitCode}`,
    result.truncated ? "output: truncated" : "output: full",
    result.stdout ? `\nstdout:\n${result.stdout}` : "",
    result.stderr ? `\nstderr:\n${result.stderr}` : "",
  ].filter(Boolean).join("\n");
}

async function executeOmx(api: any, subcommand: string, input: RunInput, fixedArgs: string[] = []) {
  const c = cfg(api.pluginConfig);
  await ensureOmx(c.command);
  const timeoutSeconds = clampNumber(input.timeoutSeconds, 5, c.maxTimeoutSeconds, c.defaultTimeoutSeconds);
  const cwd = safeCwd(input.cwd);
  const extraArgs = sanitizeArgs(input.extraArgs);
  const prompt = String(input.prompt ?? input.query ?? "").trim();
  const args = [subcommand, ...fixedArgs, ...extraArgs];
  if (prompt) args.push(prompt);
  const result = await runOmx(c.command, args, { cwd, timeoutSeconds, maxOutputChars: c.maxOutputChars });
  return {
    content: [{ type: "text", text: toolText(result) }],
    details: result,
  };
}

const commonPromptProps = {
  prompt: { type: "string", description: "Prompt/query/task to pass to the real omx CLI." },
  cwd: { type: "string", description: "Working directory. Defaults to the OpenClaw workspace." },
  timeoutSeconds: { type: "number", description: "Timeout for this OMX call." },
  extraArgs: { type: "array", items: { type: "string" }, description: "Additional safe argv entries passed before the prompt." },
};

export default definePluginEntry({
  id: "omx",
  name: "OMX Bridge",
  description: "Expose the real oh-my-codex CLI (`omx`) as OpenClaw tools.",
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      command: { type: "string", default: DEFAULT_OMX },
      defaultTimeoutSeconds: { type: "number", minimum: 5, maximum: 1800, default: DEFAULT_TIMEOUT_SECONDS },
      maxTimeoutSeconds: { type: "number", minimum: 30, maximum: 7200, default: DEFAULT_MAX_TIMEOUT_SECONDS },
      maxOutputChars: { type: "number", minimum: 1000, maximum: 200000, default: DEFAULT_MAX_OUTPUT_CHARS },
    },
  },
  register(api) {
    api.registerTool({
      name: "omx_status",
      label: "OMX Status",
      description: "Show the real oh-my-codex status via `omx status`.",
      parameters: { type: "object", properties: { cwd: commonPromptProps.cwd, timeoutSeconds: commonPromptProps.timeoutSeconds } },
      async execute(_toolCallId: string, input: RunInput = {}) {
        return executeOmx(api, "status", input);
      },
    });

    api.registerTool({
      name: "omx_hud",
      label: "OMX HUD",
      description: "Show the real oh-my-codex HUD via `omx hud --json`.",
      parameters: { type: "object", properties: { cwd: commonPromptProps.cwd, timeoutSeconds: commonPromptProps.timeoutSeconds } },
      async execute(_toolCallId: string, input: RunInput = {}) {
        return executeOmx(api, "hud", input, ["--json"]);
      },
    });

    api.registerTool({
      name: "omx_doctor",
      label: "OMX Doctor",
      description: "Run `omx doctor` to verify the real oh-my-codex installation.",
      parameters: { type: "object", properties: { cwd: commonPromptProps.cwd, timeoutSeconds: commonPromptProps.timeoutSeconds } },
      async execute(_toolCallId: string, input: RunInput = {}) {
        return executeOmx(api, "doctor", input);
      },
    });

    api.registerTool({
      name: "omx_explore",
      label: "OMX Explore",
      description: "Use real `omx explore` for read-only codebase/repository exploration.",
      parameters: { type: "object", required: ["prompt"], properties: commonPromptProps },
      async execute(_toolCallId: string, input: RunInput) {
        return executeOmx(api, "explore", input);
      },
    });

    api.registerTool({
      name: "omx_exec",
      label: "OMX Exec",
      description: "Use real `omx exec` for non-interactive Codex execution with OMX overlays.",
      parameters: { type: "object", required: ["prompt"], properties: commonPromptProps },
      async execute(_toolCallId: string, input: RunInput) {
        return executeOmx(api, "exec", input);
      },
    });

    api.registerTool({
      name: "omx_team",
      label: "OMX Team",
      description: "Use real `omx team` for parallel worker orchestration. May run longer; set timeoutSeconds as needed.",
      parameters: { type: "object", required: ["prompt"], properties: commonPromptProps },
      async execute(_toolCallId: string, input: RunInput) {
        return executeOmx(api, "team", input);
      },
    });

    api.registerTool({
      name: "omx_ralph",
      label: "OMX Ralph",
      description: "Use real `omx ralph` for persistent finish-the-task mode. Use only when explicitly requested.",
      parameters: { type: "object", required: ["prompt"], properties: commonPromptProps },
      async execute(_toolCallId: string, input: RunInput) {
        return executeOmx(api, "ralph", input);
      },
    });

    api.on("before_prompt_build", (event: any) => {
      const text = String(event?.prompt || "").toLowerCase();
      if (!text) return;
      if (text.includes("omx") || text.includes("oh-my-codex") || text.includes("오엠엑스")) {
        return {
          appendSystemContext:
            "The user is asking for real OMX/oh-my-codex. Prefer the omx_* tools registered by the OMX Bridge plugin (omx_explore for read-only exploration, omx_exec for one-shot work, omx_team/omx_ralph only when explicitly requested). Do not use the disabled ohmyclaw skill for OMX requests.",
        };
      }
    });

    api.logger.info("OMX Bridge plugin registered");
  },
});
