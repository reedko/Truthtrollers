import React, { useState, useEffect, useCallback } from "react";
import {
  Box, HStack, VStack, Text, Tabs, TabList, TabPanels, Tab, TabPanel,
  Textarea, useToast, Spinner,
} from "@chakra-ui/react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/useAuthStore";
import { api } from "../services/api";
import AllSidesEditor from "../components/admin/seeds/AllSidesEditor";
import MBFCEditor from "../components/admin/seeds/MBFCEditor";
import AdFontesEditor from "../components/admin/seeds/AdFontesEditor";
import OpenSourcesEditor from "../components/admin/seeds/OpenSourcesEditor";

type SourceKey = "allsides" | "mbfc" | "adfontes" | "opensources";

const SOURCES: { key: SourceKey; label: string; description: string }[] = [
  { key: "allsides",    label: "AllSides",    description: "Political bias ratings (Left → Right scale)" },
  { key: "mbfc",        label: "MBFC",        description: "Media Bias/Fact Check — factual reporting & credibility" },
  { key: "adfontes",    label: "Ad Fontes",   description: "Reliability quality score (0–64) and bias (−42 to +42)" },
  { key: "opensources", label: "OpenSources", description: "Flagged unreliable / problematic domains" },
];

export default function PublisherSeedsPage() {
  const navigate = useNavigate();
  const user = useAuthStore(s => s.user);
  const toast = useToast();

  const [seedData, setSeedData] = useState<Record<SourceKey, any>>({
    allsides: [], mbfc: [], adfontes: [], opensources: {},
  });
  const [loading, setLoading] = useState<Record<SourceKey, boolean>>({
    allsides: false, mbfc: false, adfontes: false, opensources: false,
  });
  const [tabIndex, setTabIndex] = useState(0);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);

  // Gate: super_admin only
  useEffect(() => {
    if (user && user.role !== "super_admin") navigate("/dashboard");
  }, [user, navigate]);

  const fetchSource = useCallback(async (key: SourceKey) => {
    setLoading(l => ({ ...l, [key]: true }));
    try {
      const res = await api.get(`/api/admin/seeds/${key}`);
      setSeedData(d => ({ ...d, [key]: res.data.data }));
    } catch (err) {
      toast({ title: `Failed to load ${key}`, status: "error", duration: 3000 });
    } finally {
      setLoading(l => ({ ...l, [key]: false }));
    }
  }, [toast]);

  // Load all sources on mount
  useEffect(() => {
    SOURCES.forEach(s => fetchSource(s.key));
  }, [fetchSource]);

  const currentSource = SOURCES[tabIndex];

  async function handleImport() {
    if (!importText.trim()) return;
    let parsed: any;
    try {
      parsed = JSON.parse(importText.trim());
    } catch {
      toast({ title: "Invalid JSON", status: "error", duration: 3000 });
      return;
    }
    setImporting(true);
    try {
      const res = await api.post(`/api/admin/seeds/${currentSource.key}/import`, { data: parsed });
      toast({ title: `Imported ${res.data.count} entries into ${currentSource.label}`, status: "success", duration: 3000 });
      setImportText("");
      fetchSource(currentSource.key);
    } catch {
      toast({ title: "Import failed", status: "error", duration: 3000 });
    } finally {
      setImporting(false);
    }
  }

  function renderEditor(key: SourceKey) {
    if (loading[key]) {
      return (
        <Box p={8} textAlign="center">
          <Spinner color="var(--tt-accent)" />
          <Text mt={3} color="var(--tt-muted)" fontSize="sm">Loading {key}…</Text>
        </Box>
      );
    }
    const data = seedData[key];
    const onRefresh = () => fetchSource(key);
    switch (key) {
      case "allsides":    return <AllSidesEditor entries={data} onRefresh={onRefresh} />;
      case "mbfc":        return <MBFCEditor entries={data} onRefresh={onRefresh} />;
      case "adfontes":    return <AdFontesEditor entries={data} onRefresh={onRefresh} />;
      case "opensources": {
        // Convert object to array for editor
        const arr = Object.entries(data).map(([domain, v]: [string, any]) => ({ domain, ...v }));
        return <OpenSourcesEditor entries={arr} onRefresh={onRefresh} />;
      }
    }
  }

  const entryCount = (key: SourceKey) => {
    const d = seedData[key];
    return Array.isArray(d) ? d.length : Object.keys(d).length;
  };

  return (
    <Box minH="100vh" p={{ base: 4, md: 8 }} bg="var(--tt-bg)">
      {/* Header */}
      <VStack align="flex-start" gap={1} mb={6}>
        <HStack gap={3} align="center">
          <button className="mr-button" onClick={() => navigate("/admin")}
            style={{ fontSize: "0.75rem", padding: "3px 10px", opacity: 0.7 }}>
            ← Admin
          </button>
          <h1 className="mr-heading" style={{ fontSize: "1.4rem", margin: 0 }}>
            Publisher Seed Data
          </h1>
        </HStack>
        <Text color="var(--tt-muted)" fontSize="sm">
          Manage bias / reliability reference data used by the Admiralty evaluation pipeline.
          Changes take effect on the next publisher lookup — no restart required.
        </Text>
      </VStack>

      {/* Source summary cards */}
      <HStack gap={3} mb={6} flexWrap="wrap">
        {SOURCES.map((s, i) => (
          <Box key={s.key} className="mr-card" px={4} py={3} cursor="pointer"
            onClick={() => setTabIndex(i)}
            style={{
              borderColor: i === tabIndex ? "var(--tt-accent)" : undefined,
              minWidth: "140px",
              flex: "1 1 140px",
            }}>
            <Text fontSize="xs" color="var(--tt-accent)" fontWeight="bold" textTransform="uppercase" letterSpacing="wider">
              {s.label}
            </Text>
            <Text fontSize="1.4rem" fontWeight="bold" color="var(--tt-text)" lineHeight={1.2} mt={0.5}>
              {loading[s.key] ? "…" : entryCount(s.key)}
            </Text>
            <Text fontSize="xs" color="var(--tt-muted)" mt={0.5} noOfLines={2}>{s.description}</Text>
          </Box>
        ))}
      </HStack>

      {/* Main tabs */}
      <Box className="mr-card" p={0} overflow="hidden">
        <Tabs index={tabIndex} onChange={setTabIndex} variant="unstyled">
          <TabList borderBottom="1px solid rgba(255,255,255,0.08)" px={4} gap={0}>
            {SOURCES.map(s => (
              <Tab key={s.key} px={4} py={3} fontSize="sm" fontWeight="medium"
                color="var(--tt-muted)" _selected={{ color: "var(--tt-accent)", borderBottom: "2px solid var(--tt-accent)" }}>
                {s.label}
              </Tab>
            ))}
          </TabList>

          <TabPanels>
            {SOURCES.map(s => (
              <TabPanel key={s.key} p={4}>
                {renderEditor(s.key)}
              </TabPanel>
            ))}
          </TabPanels>
        </Tabs>
      </Box>

      {/* Bulk import panel */}
      <Box className="mr-card" mt={4} p={4}>
        <Text fontSize="xs" color="var(--tt-accent)" fontWeight="bold" textTransform="uppercase" letterSpacing="wider" mb={2}>
          Bulk Import JSON → {currentSource.label}
        </Text>
        <Text fontSize="xs" color="var(--tt-muted)" mb={3}>
          Paste a full JSON array (for AllSides/MBFC/AdFontes) or object (for OpenSources) to replace all data in the current tab.
          Existing entries not in the payload will be removed.
        </Text>
        <Textarea
          value={importText}
          onChange={e => setImportText(e.target.value)}
          placeholder={`Paste JSON here… (${currentSource.key === "opensources" ? '{"domain.com": {"types": [...]}' : '[{"name": "…", "domain": "…", …}]'})`}
          rows={6}
          resize="vertical"
          className="mr-input"
          fontFamily="mono"
          fontSize="xs"
          mb={2}
        />
        <button className="mr-button" onClick={handleImport} disabled={importing || !importText.trim()}
          style={{ fontSize: "0.8rem", padding: "5px 16px" }}>
          {importing ? "Importing…" : `Import into ${currentSource.label}`}
        </button>
      </Box>
    </Box>
  );
}
