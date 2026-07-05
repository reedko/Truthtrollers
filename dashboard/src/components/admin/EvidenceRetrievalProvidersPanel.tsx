import React, { useEffect, useState } from "react";
import {
  Alert, AlertIcon, Badge, Box, Button, Checkbox, FormControl, FormLabel,
  HStack, NumberInput, NumberInputField, Select, Spinner, Stack, Text,
  VStack, useToast,
} from "@chakra-ui/react";
import { api } from "../../services/api";

type ProviderName = "tavily" | "brave" | "serpapi" | "bing";
type ProviderStatus = { enabled: boolean; configured: boolean; status: string; lastError?: string; lastSuccessfulCall?: string };
type GatewayConfig = {
  mode: "single" | "fallback" | "ensemble";
  provider: ProviderName;
  providers: ProviderName[];
  fallbacks: ProviderName[];
  retrievalStrategy: "cost_saver" | "best_bearing_pool" | "diagnostic_bakeoff";
  minHighBearingClaimsPerTarget: number;
  maxResultsPerQuery: number;
  providerBudgetPerTargetUsd: number;
  maxProvidersPerTarget: number;
  maxSourcesToScrapePerTarget: number;
  captureProviderMetadata: boolean;
  metadataInSnippetFallback: boolean;
  providerEnabled: Record<ProviderName, boolean>;
};

export default function EvidenceRetrievalProvidersPanel() {
  const [config, setConfig] = useState<GatewayConfig | null>(null);
  const [providers, setProviders] = useState<Record<string, ProviderStatus>>({});
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const load = async () => {
    const response = await api.get("/api/admin/evidence-retrieval-providers");
    setConfig(response.data.config);
    setProviders(response.data.providers || {});
  };

  useEffect(() => { load().catch(() => toast({ title: "Could not load retrieval providers", status: "error" })); }, []);

  if (!config) return <Spinner color="cyan.300" />;
  const update = (patch: Partial<GatewayConfig>) => setConfig({ ...config, ...patch });
  const toggleProvider = (name: ProviderName, enabled: boolean) => {
    if (enabled && providers[name] && !providers[name].configured) {
      toast({ title: `${name} API key is missing`, description: `Add the ${name} key to the backend environment before enabling this provider.`, status: "warning", duration: 5000 });
    }
    update({ providerEnabled: { ...config.providerEnabled, [name]: enabled } });
  };
  const save = async () => {
    setSaving(true);
    try {
      const response = await api.put("/api/admin/evidence-retrieval-providers", { config });
      setConfig(response.data.config);
      setProviders(response.data.providers || providers);
      toast({ title: "Evidence retrieval settings saved", status: response.data.warnings?.length ? "warning" : "success", description: response.data.warnings?.join(". ") });
    } finally { setSaving(false); }
  };

  return (
    <VStack align="stretch" spacing={5}>
      <Box>
        <Text fontSize="lg" fontWeight="bold" color="cyan.300">Evidence Retrieval Providers</Text>
        <Text fontSize="sm" color="gray.400">Best-bearing-pool searches enabled providers first, then scrapes only the strongest merged candidates.</Text>
      </Box>
      <Stack direction={{ base: "column", md: "row" }} spacing={4}>
        {(["tavily", "brave", "serpapi", "bing"] as ProviderName[]).map((name) => {
          const status = providers[name];
          return <Box key={name} p={3} borderWidth="1px" borderColor="whiteAlpha.300" borderRadius="md" minW="160px">
            <Checkbox isChecked={config.providerEnabled[name]} onChange={(event) => toggleProvider(name, event.target.checked)} textTransform="capitalize">{name}</Checkbox>
            <Badge ml={2} colorScheme={status?.configured ? "green" : status?.enabled ? "red" : "gray"}>{status?.status || "unknown"}</Badge>
            {status?.lastError && <Text mt={2} fontSize="xs" color="red.300">{status.lastError}</Text>}
            {status?.lastSuccessfulCall && <Text mt={2} fontSize="xs" color="gray.500">Last success: {status.lastSuccessfulCall}</Text>}
          </Box>;
        })}
      </Stack>
      <HStack align="start" spacing={4} flexWrap="wrap">
        <FormControl maxW="220px"><FormLabel>Retrieval strategy</FormLabel><Select value={config.retrievalStrategy} onChange={(e) => update({ retrievalStrategy: e.target.value as GatewayConfig["retrievalStrategy"] })}><option value="best_bearing_pool">Best bearing pool</option><option value="cost_saver">Cost saver</option><option value="diagnostic_bakeoff">Diagnostic bakeoff</option></Select></FormControl>
        <FormControl maxW="180px"><FormLabel>Provider mode</FormLabel><Select value={config.mode} onChange={(e) => update({ mode: e.target.value as GatewayConfig["mode"] })}><option value="single">Single</option><option value="fallback">Fallback</option><option value="ensemble">Ensemble</option></Select></FormControl>
        <FormControl maxW="180px"><FormLabel>Default provider</FormLabel><Select value={config.provider} onChange={(e) => update({ provider: e.target.value as ProviderName })}>{(["tavily", "brave", "serpapi", "bing"] as ProviderName[]).map((name) => <option key={name} value={name}>{name}</option>)}</Select></FormControl>
      </HStack>
      <HStack align="start" spacing={4} flexWrap="wrap">
        {[
          ["High-bearing assertions", "minHighBearingClaimsPerTarget", config.minHighBearingClaimsPerTarget, 1, 20],
          ["Max results/query", "maxResultsPerQuery", config.maxResultsPerQuery, 1, 50],
          ["Max providers/target", "maxProvidersPerTarget", config.maxProvidersPerTarget, 1, 20],
          ["Max sources/target", "maxSourcesToScrapePerTarget", config.maxSourcesToScrapePerTarget, 1, 100],
        ].map(([label, key, value, min, max]) => <FormControl key={String(key)} maxW="180px"><FormLabel>{String(label)}</FormLabel><NumberInput value={Number(value)} min={Number(min)} max={Number(max)} onChange={(_, number) => update({ [String(key)]: number } as Partial<GatewayConfig>)}><NumberInputField /></NumberInput></FormControl>)}
        <FormControl maxW="200px"><FormLabel>Provider budget/target USD</FormLabel><NumberInput value={config.providerBudgetPerTargetUsd} min={0} precision={2} step={0.01} onChange={(_, number) => update({ providerBudgetPerTargetUsd: number })}><NumberInputField /></NumberInput></FormControl>
      </HStack>
      <HStack><Checkbox isChecked={config.captureProviderMetadata} onChange={(e) => update({ captureProviderMetadata: e.target.checked })}>Capture provider metadata</Checkbox><Checkbox isChecked={config.metadataInSnippetFallback} onChange={(e) => update({ metadataInSnippetFallback: e.target.checked })}>Allow bounded snippet metadata fallback</Checkbox></HStack>
      {Object.entries(providers).some(([, value]) => value.enabled && !value.configured) && <Alert status="warning"><AlertIcon />An enabled provider is missing its API key and will be skipped rather than failing the evidence run.</Alert>}
      <Button alignSelf="start" colorScheme="cyan" isLoading={saving} onClick={save}>Save retrieval settings</Button>
    </VStack>
  );
}
