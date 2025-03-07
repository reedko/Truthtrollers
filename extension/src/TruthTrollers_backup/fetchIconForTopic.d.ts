declare module "../services/fetchIconForTopic" {
  const fetchIconForTopic: (query: string) => Promise<string | null>;
  export = fetchIconForTopic;
}
