import type {SuccessCondition} from '@incident/shared';
import {
  normalizeWorkspaceMarkerPath,
  shellArg,
  shellPathSegment,
} from './pathSafety.js';

export type SuccessConditionCommandBuilder = (
  condition: SuccessCondition
) => string;

export const successConditionBuilders: Record<
  string,
  SuccessConditionCommandBuilder
> = {
  http_status: (condition) => {
    if (condition.type !== 'http_status') return invalidCondition(condition);
    const script = `fetch(${JSON.stringify(condition.url)}).then(r=>process.exit(r.status===${String(condition.status)}?0:1)).catch(()=>process.exit(1))`;
    return `node -e ${shellArg(script)}`;
  },

  process_running: (condition) => {
    if (condition.type !== 'process_running') {
      return invalidCondition(condition);
    }
    return `test ! -f /workspace/run/${shellPathSegment(condition.processId)}.down`;
  },

  marker_absent: (condition) => {
    if (condition.type !== 'marker_absent') return invalidCondition(condition);
    return `test ! -e ${shellArg(normalizeWorkspaceMarkerPath(condition.path))}`;
  },

  disk_usage_below: (condition) => {
    if (condition.type !== 'disk_usage_below') {
      return invalidCondition(condition);
    }
    const script = `const {execFileSync}=require("child_process");const target=${JSON.stringify(condition.path)};let used=100;try{const out=execFileSync("df",["-P",target],{encoding:"utf8"});const line=out.trim().split("\\n")[1];used=Number(line.split(/\\s+/)[4].replace("%",""));}catch{}process.exit(used<${String(condition.valuePercent)}?0:1)`;
    return `node -e ${shellArg(script)}`;
  },

  log_absent: (condition) => {
    if (condition.type !== 'log_absent') return invalidCondition(condition);
    const script = `const fs=require("fs");const p=${JSON.stringify(condition.path)};const text=fs.existsSync(p)?fs.readFileSync(p,"utf8"):"";process.exit(text.includes(${JSON.stringify(condition.pattern)})?1:0)`;
    return `node -e ${shellArg(script)}`;
  },

  unlang_batch_ok: () =>
    'node /workspace/bin/unlang.mjs run /workspace/services/batch/sales.un',
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
