import type {SuccessCondition} from '@incident/shared';
import {shellArg, shellPathSegment} from './pathSafety.js';

export type SuccessConditionCommandBuilder = (
  condition: SuccessCondition
) => string;

/**
 * Real process patterns per startup id / sandbox daemon id. process_running
 * and process_absent check the live process table instead of a marker file,
 * so a killed, crashed, or still-running process is judged on real state.
 */
const PROCESS_PATTERNS: Record<string, string> = {
  api: 'yamabiko-api/server\\.mjs',
  'fake-db': 'fake-db/server\\.mjs',
  'monitor-agent': 'monitor-agent/agent\\.mjs',
  'alert-flood-daemon': 'alert-flood-daemon\\.mjs',
  loadgen: 'loadgen\\.mjs',
};

export const successConditionBuilders: Record<
  string,
  SuccessConditionCommandBuilder
> = {
  http_status: (condition) => {
    if (condition.type !== 'http_status') return invalidCondition(condition);
    const script = `fetch(${JSON.stringify(condition.url)},{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.status===${String(condition.status)}?0:1)).catch(()=>process.exit(1))`;
    return `node -e ${shellArg(script)}`;
  },

  process_running: (condition) => {
    if (condition.type !== 'process_running') {
      return invalidCondition(condition);
    }
    const pattern = PROCESS_PATTERNS[condition.processId];
    if (pattern) {
      return `pgrep -f ${shellArg(pattern)} > /dev/null`;
    }
    return `test ! -f /workspace/run/${shellPathSegment(condition.processId)}.down`;
  },

  process_absent: (condition) => {
    if (condition.type !== 'process_absent') return invalidCondition(condition);
    const pattern = PROCESS_PATTERNS[condition.processId];
    if (pattern) {
      return `! pgrep -f ${shellArg(pattern)} > /dev/null`;
    }
    return `test -f /workspace/run/${shellPathSegment(condition.processId)}.down`;
  },

  disk_usage_below: (condition) => {
    if (condition.type !== 'disk_usage_below') {
      return invalidCondition(condition);
    }
    const script = [
      'const {execFileSync}=require("child_process");',
      'const fs=require("fs");const path=require("path");',
      `const target=${JSON.stringify(condition.path)};`,
      'let used=0;',
      'try{const out=execFileSync("df",["-P",target],{encoding:"utf8"});const line=out.trim().split("\\n")[1];const df=Number(line.split(/\\s+/)[4].replace("%",""));if(Number.isFinite(df))used=df;}catch{}',
      'let quota=536870912;',
      'try{const cfg=JSON.parse(fs.readFileSync("/workspace/etc/yamabiko-api.json","utf8"));if(Number.isFinite(cfg.logQuotaBytes))quota=cfg.logQuotaBytes;}catch{}',
      'let bytes=0;',
      'try{for(const entry of fs.readdirSync("/workspace/logs")){try{const info=fs.statSync(path.join("/workspace/logs",entry));if(info.isFile())bytes+=info.size;}catch{}}}catch{}',
      'const logPercent=quota>0?Math.min(100,Math.round((bytes/quota)*100)):0;',
      'if(logPercent>used)used=logPercent;',
      `process.exit(used<${String(condition.valuePercent)}?0:1)`,
    ].join('');
    return `node -e ${shellArg(script)}`;
  },

  log_absent: (condition) => {
    if (condition.type !== 'log_absent') return invalidCondition(condition);
    const script = `const fs=require("fs");const p=${JSON.stringify(condition.path)};const text=fs.existsSync(p)?fs.readFileSync(p,"utf8"):"";process.exit(text.includes(${JSON.stringify(condition.pattern)})?1:0)`;
    return `node -e ${shellArg(script)}`;
  },

  kodama_batch_ok: () =>
    'node /workspace/bin/kodama.mjs run /workspace/services/batch/sales.kdm',
};

export function buildSuccessCheckCommand(condition: SuccessCondition) {
  const builder = successConditionBuilders[condition.type];
  if (!builder) {
    throw new Error(`unknown success condition type: ${condition.type}`);
  }
  return builder(condition);
}

function invalidCondition(condition: SuccessCondition): never {
  throw new Error(`invalid success condition builder input: ${condition.type}`);
}
