import {progressEventRatio, type AssistAvailability} from '../pure/aiAssist.js';
import {NPC_SYSTEM_PROMPT} from '../pure/npcColleague.js';

interface LanguageModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LanguageModelExpectation {
  type: 'text' | 'image' | 'audio';
  languages?: string[];
}

interface LanguageModelPromptOptions {
  /** JSON Schema による structured output 制約(Prompt API)。 */
  responseConstraint?: Record<string, unknown>;
}

export interface NpcSession {
  prompt(
    input: string | LanguageModelMessage[],
    options?: LanguageModelPromptOptions
  ): Promise<string>;
  destroy(): void;
}

interface LanguageModelCreateOptions {
  initialPrompts?: LanguageModelMessage[];
  expectedInputs?: LanguageModelExpectation[];
  expectedOutputs?: LanguageModelExpectation[];
  monitor?(monitor: EventTarget): void;
}

interface LanguageModelEntry {
  availability(
    options?: Omit<LanguageModelCreateOptions, 'initialPrompts' | 'monitor'>
  ): Promise<Exclude<AssistAvailability, 'unsupported'>>;
  create(options?: LanguageModelCreateOptions): Promise<NpcSession>;
}

const EXPECTED_INPUTS: LanguageModelExpectation[] = [
  {type: 'text', languages: ['ja', 'en']},
];
const EXPECTED_OUTPUTS: LanguageModelExpectation[] = [
  {type: 'text', languages: ['ja']},
];

function promptApiEntry(): LanguageModelEntry | undefined {
  return (globalThis as {LanguageModel?: LanguageModelEntry}).LanguageModel;
}

export async function checkNpcAvailability(): Promise<AssistAvailability> {
  const entry = promptApiEntry();
  if (!entry) return 'unsupported';
  try {
    return await entry.availability({
      expectedInputs: EXPECTED_INPUTS,
      expectedOutputs: EXPECTED_OUTPUTS,
    });
  } catch {
    return 'unavailable';
  }
}

export async function createNpcSession(
  onDownloadProgress?: (loaded: number) => void
): Promise<NpcSession> {
  const entry = promptApiEntry();
  if (!entry) throw new Error('Prompt API is not available');
  return entry.create({
    initialPrompts: [{role: 'system', content: NPC_SYSTEM_PROMPT}],
    expectedInputs: EXPECTED_INPUTS,
    expectedOutputs: EXPECTED_OUTPUTS,
    monitor(monitor) {
      monitor.addEventListener('downloadprogress', (event) => {
        const ratio = progressEventRatio(event as ProgressEvent);
        if (ratio !== undefined) onDownloadProgress?.(ratio);
      });
    },
  });
}

/** JSON Schema 制約付きで NPC に状況を渡し、生の出力文字列を返す。 */
export function promptNpc(
  session: NpcSession,
  userPrompt: string,
  responseConstraint: Record<string, unknown>
): Promise<string> {
  return session.prompt(userPrompt, {responseConstraint});
}
