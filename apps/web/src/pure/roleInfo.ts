import type {ParticipantRole} from '@incident/shared';

/**
 * Human-facing description of each participant role, shown in the lobby so
 * players understand what their role can and cannot do before play starts.
 * `canOperateTerminal` must stay in sync with the ops/facilitator gate in
 * apps/web/src/pure/rolePermissions.ts `canOperateSandbox` (mirrored from
 * apps/worker/src/pure/exerciseRoom.ts `canOperateSandbox`, the source of
 * truth) — see tests/unit/role-info.test.mjs for the cross-check.
 */
export interface RoleInfo {
  role: ParticipantRole;
  label: string;
  tagline: string;
  can: string[];
  cannot: string[];
  /** Mirrors canOperateSandbox's ops/facilitator gate for this role. */
  canOperateTerminal: boolean;
}

const RECORD_CONTRIBUTION = 'タスクやタイムラインへの記録';
const TERMINAL_OPERATION = 'ターミナル・エディタの操作';

export const ROLE_INFO: Record<ParticipantRole, RoleInfo> = {
  incident_commander: {
    role: 'incident_commander',
    label: 'IC',
    tagline: '指揮。状況を整理し、意思決定に専念する深夜の指揮官。',
    can: [RECORD_CONTRIBUTION],
    cannot: [TERMINAL_OPERATION],
    canOperateTerminal: false,
  },
  ops: {
    role: 'ops',
    label: 'Ops',
    tagline: '実働。手を動かしてターミナルとエディタで復旧にあたる。',
    can: [TERMINAL_OPERATION, RECORD_CONTRIBUTION],
    cannot: [],
    canOperateTerminal: true,
  },
  scribe: {
    role: 'scribe',
    label: 'Scribe',
    tagline: '書記。タイムラインと証跡を記録し、夜勤の記憶を残す。',
    can: [RECORD_CONTRIBUTION],
    cannot: [TERMINAL_OPERATION],
    canOperateTerminal: false,
  },
  comms: {
    role: 'comms',
    label: 'Comms',
    tagline: '広報。関係者への状況共有を担い、外への窓口となる。',
    can: [RECORD_CONTRIBUTION],
    cannot: [TERMINAL_OPERATION],
    canOperateTerminal: false,
  },
  facilitator: {
    role: 'facilitator',
    label: 'Facilitator',
    tagline: '進行役。訓練の進行とインジェクトを担い、ターミナル操作も可。',
    can: [TERMINAL_OPERATION, RECORD_CONTRIBUTION],
    cannot: [],
    canOperateTerminal: true,
  },
  observer: {
    role: 'observer',
    label: 'Observer',
    tagline: '見学。ガラス越しに深夜のNOCを見守る閲覧専用の役割。',
    can: [],
    cannot: [TERMINAL_OPERATION, RECORD_CONTRIBUTION],
    canOperateTerminal: false,
  },
};

export function roleInfoFor(role: ParticipantRole): RoleInfo {
  return ROLE_INFO[role];
}

export const roleInfoList: RoleInfo[] = Object.values(ROLE_INFO);
