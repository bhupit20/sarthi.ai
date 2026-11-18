import type { ProviderId } from '../shared/types';
import { claude, listClaudeModels } from './claude';
import { gemini, listGeminiModels } from './gemini';
import { listNvidiaModels, listOpenAiModels, nvidia, openai } from './openai';
import type { Provider } from './types';

export * from './types';

export const PROVIDERS: Record<ProviderId, Provider> = { claude, openai, gemini, nvidia };

/** The models a key can use, straight from the provider, sorted by name. */
export async function listModels(provider: ProviderId, apiKey: string, fetchFn?: typeof fetch): Promise<string[]> {
  const list = { claude: listClaudeModels, openai: listOpenAiModels, gemini: listGeminiModels, nvidia: listNvidiaModels }[provider];
  return (await list(apiKey, fetchFn)).sort();
}
