import React, { useState } from "react";
import {
  Box, Table, Thead, Tbody, Tr, Th, Td, Input, Select,
  HStack, VStack, Text, Badge, IconButton, useToast,
} from "@chakra-ui/react";
import { api } from "../../../services/api";

interface MBFCEntry {
  name: string;
  domain: string;
  bias: string;
  factual_reporting: string;
  credibility: string;
  url?: string;
}

const FACTUAL_OPTIONS = ["Very High", "High", "Mostly Factual", "Mixed", "Low", "Very Low"];
const BIAS_OPTIONS = ["Left", "Left-Center", "Least Biased", "Right-Center", "Right",
  "Conspiracy-Pseudoscience", "Questionable Sources", "Pro-Science", "Satire"];
const CREDIBILITY_OPTIONS = ["High Credibility", "Medium Credibility", "Low Credibility"];

const FACTUAL_COLOR: Record<string, string> = {
  "Very High":     "#38a169",
  "High":          "#68d391",
  "Mostly Factual":"#ecc94b",
  "Mixed":         "#ed8936",
  "Low":           "#e53e3e",
  "Very Low":      "#9b2c2c",
};

const BLANK: MBFCEntry = { name: "", domain: "", bias: "Least Biased", factual_reporting: "High", credibility: "High Credibility", url: "" };

interface Props {
  entries: MBFCEntry[];
  onRefresh: () => void;
}

export default function MBFCEditor({ entries, onRefresh }: Props) {
  const [filter, setFilter] = useState("");
  const [form, setForm] = useState<MBFCEntry>(BLANK);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const filtered = entries.filter(e =>
    !filter || e.domain.includes(filter) || e.name.toLowerCase().includes(filter.toLowerCase())
  );

  async function save() {
    if (!form.domain || !form.name) {
      toast({ title: "Domain and name are required", status: "warning", duration: 2000 });
      return;
    }
    setSaving(true);
    try {
      await api.post("/api/admin/seeds/mbfc/entry", form);
      toast({ title: "Saved", status: "success", duration: 1500, isClosable: true });
      setForm(BLANK);
      setEditing(null);
      onRefresh();
    } catch {
      toast({ title: "Save failed", status: "error", duration: 3000 });
    } finally {
      setSaving(false);
    }
  }

  async function remove(domain: string) {
    try {
      await api.delete("/api/admin/seeds/mbfc/entry", { data: { domain } });
      toast({ title: "Removed", status: "info", duration: 1500 });
      onRefresh();
    } catch {
      toast({ title: "Delete failed", status: "error", duration: 3000 });
    }
  }

  function startEdit(entry: MBFCEntry) {
    setForm({ ...entry });
    setEditing(entry.domain);
  }

  return (
    <VStack align="stretch" gap={4}>
      <HStack gap={2} flexWrap="wrap">
        <Input placeholder="Filter…" value={filter} onChange={e => setFilter(e.target.value)}
          size="sm" maxW="260px" className="mr-input" />
        <Box flex={1} />
        <Text fontSize="xs" color="var(--tt-muted)" whiteSpace="nowrap">
          {filtered.length} / {entries.length} entries
        </Text>
      </HStack>

      <Box className="mr-card" p={3}>
        <Text fontSize="xs" color="var(--tt-accent)" mb={2} fontWeight="bold" textTransform="uppercase" letterSpacing="wider">
          {editing ? `Editing ${editing}` : "Add Entry"}
        </Text>
        <VStack align="stretch" gap={2}>
          <HStack gap={2} flexWrap="wrap">
            <Input size="sm" placeholder="Publisher name" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="mr-input" flex={1} minW="140px" />
            <Input size="sm" placeholder="domain.com" value={form.domain}
              onChange={e => setForm(f => ({ ...f, domain: e.target.value }))} className="mr-input" flex={1} minW="140px" />
          </HStack>
          <HStack gap={2} flexWrap="wrap">
            <Select size="sm" value={form.factual_reporting}
              onChange={e => setForm(f => ({ ...f, factual_reporting: e.target.value }))}
              className="mr-input" flex={1} minW="140px">
              {FACTUAL_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </Select>
            <Select size="sm" value={form.bias}
              onChange={e => setForm(f => ({ ...f, bias: e.target.value }))}
              className="mr-input" flex={1} minW="160px">
              {BIAS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </Select>
            <Select size="sm" value={form.credibility}
              onChange={e => setForm(f => ({ ...f, credibility: e.target.value }))}
              className="mr-input" flex={1} minW="160px">
              {CREDIBILITY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </Select>
          </HStack>
          <HStack gap={2}>
            <Input size="sm" placeholder="https://mediabiasfactcheck.com/…" value={form.url ?? ""}
              onChange={e => setForm(f => ({ ...f, url: e.target.value }))} className="mr-input" flex={1} />
            <button className="mr-button" onClick={save} disabled={saving} style={{ fontSize: "0.8rem", padding: "4px 12px" }}>
              {saving ? "Saving…" : editing ? "Update" : "Add"}
            </button>
            {editing && (
              <button className="mr-button" onClick={() => { setForm(BLANK); setEditing(null); }}
                style={{ fontSize: "0.8rem", padding: "4px 12px", opacity: 0.7 }}>
                Cancel
              </button>
            )}
          </HStack>
        </VStack>
      </Box>

      <Box overflowX="auto">
        <Table size="sm" variant="unstyled">
          <Thead>
            <Tr>
              <Th color="var(--tt-muted)" fontSize="xs">Publisher</Th>
              <Th color="var(--tt-muted)" fontSize="xs">Domain</Th>
              <Th color="var(--tt-muted)" fontSize="xs">Factual</Th>
              <Th color="var(--tt-muted)" fontSize="xs">Bias</Th>
              <Th color="var(--tt-muted)" fontSize="xs">Credibility</Th>
              <Th />
            </Tr>
          </Thead>
          <Tbody>
            {filtered.map(entry => {
              const fc = FACTUAL_COLOR[entry.factual_reporting] ?? "#718096";
              return (
                <Tr key={entry.domain} _hover={{ bg: "rgba(255,255,255,0.04)" }}
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  <Td py={1} color="var(--tt-text)" fontSize="sm">{entry.name}</Td>
                  <Td py={1} color="var(--tt-muted)" fontSize="xs" fontFamily="mono">{entry.domain}</Td>
                  <Td py={1}>
                    <Badge fontSize="xs" px={2} py={0.5} borderRadius="full"
                      style={{ background: `${fc}22`, color: fc, border: `1px solid ${fc}55` }}>
                      {entry.factual_reporting}
                    </Badge>
                  </Td>
                  <Td py={1} color="var(--tt-muted)" fontSize="xs">{entry.bias}</Td>
                  <Td py={1} color="var(--tt-muted)" fontSize="xs">{entry.credibility}</Td>
                  <Td py={1} textAlign="right">
                    <HStack gap={1} justify="flex-end">
                      <IconButton aria-label="Edit" size="xs" variant="ghost" color="var(--tt-accent)"
                        icon={<span style={{ fontSize: "0.7rem" }}>✏️</span>} onClick={() => startEdit(entry)} />
                      <IconButton aria-label="Delete" size="xs" variant="ghost" color="#e53e3e"
                        icon={<span style={{ fontSize: "0.7rem" }}>🗑</span>} onClick={() => remove(entry.domain)} />
                    </HStack>
                  </Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      </Box>
    </VStack>
  );
}
