import { OpenAIProvider } from "@openai/agents";

export type ModelProviderConfig = {
  apiKey: string;
};

export function createModelProvider(config: ModelProviderConfig): OpenAIProvider {
  return new OpenAIProvider({
    apiKey: config.apiKey,
    useResponses: true,
  });
}
