import React, { useState } from "react";
import {
  Box, Table, Thead, Tbody, Tr, Th, Td, Input, NumberInput, NumberInputField,
  HStack, VStack, Text, Badge, IconButton, useToast, Tooltip,
} from "@chakra-ui/react";
import { api } from "../../../services/api";

interface AdFontesEntry {
  name: string;
  domain: string;
  quality: number;   // 0–64
  bias: number;      // −42 to +42
}

const BLANK: AdFontesEntry = { name: "", domain: "", quality: 32, bias: 0 };

function reliabilityLabel(q: number): { label: string; color: string } {
  if (q >= 48) return { label: "High",   color: "#38a169" };
  if (q >= 32) return { label: "Medium", color: "#ecc94b" };
  if (q >= 16) return { label: "Mixed",  color: "#ed8936" };
  return              { label: "Low",    color: "#e53e3e" };
}

function biasLabel(b: number): { label: string; color: string } {
  if (b <= -20) return { label: "Left",        color: "#e53e3e" };
  if (b <= -8)  return { label: "Lean Left",   color: "#ed8936" };
  if (b <=  8)  return { label: "Center",      color: "#38a169" };
  if (b <= 20)  return { label: "Lean Right",  color: "#3182ce" };
  return               { label: "Right",       color: "#805ad5" };
}

interface Props {
  entries: AdFontesEntry[];
  onRefresh: () => void;
}

export default function AdFontesEditor({ entries, onRefresh }: Props) {
  const [filter, setFilter] = useState("");
  const [form, setForm] = useState<AdFontesEntry>(BLANK);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const filtered = entries.filter(e =>
    !filter || e.domain.includes(filter) || (e.name ?? "").toLowerCase().includes(filter.toLowerCase())
  );

  async function save() {
    if (!form.domain || !form.name) {
      toast({ title: "Domain and name are required", status: "warning", duration: 2000 });
      return;
    }
    setSaving(true);
    try {
      await api.post("/api/admin/seeds/adfontes/entry", form);
      toast({ title: "Saved", status: "success", duration: 1500 });
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
      await api.delete("/api/admin/seeds/adfontes/entry", { data: { domain } });
      toast({ title: "Removed", status: "info", duration: 1500 });
      onRefresh();
    } catch {
      toast({ title: "Delete failed", status: "error", duration: 3000 });
    }
  }

  function startEdit(entry: AdFontesEntry) {
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
        <Tooltip label="Quality: 0–64 (higher = more reliable). Bias: −42 (Left) to +42 (Right)." placement="top">
          <Text fontSize="xs" color="var(--tt-accent)" cursor="help">ⓘ Scoring guide</Text>
        </Tooltip>
      </HStack>

      <Box className="mr-card" p={3}>
        <Text fontSize="xs" color="var(--tt-accent)" mb={2} fontWeight="bold" textTransform="uppercase" letterSpacing="wider">
          {editing ? `Editing ${editing}` : "Add Entry"}
        </Text>
        <HStack gap={2} flexWrap="wrap">
          <Input size="sm" placeholder="Publisher name" value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="mr-input" flex={1} minW="140px" />
          <Input size="sm" placeholder="domain.com" value={form.domain}
            onChange={e => setForm(f => ({ ...f, domain: e.target.value }))} className="mr-input" flex={1} minW="140px" />
          <Box>
            <Text fontSize="xs" color="var(--tt-muted)" mb={0.5}>Quality (0–64)</Text>
            <NumberInput size="sm" value={form.quality} min={0} max={64}
              onChange={v => setForm(f => ({ ...f, quality: Number(v) || 0 }))}>
              <NumberInputField className="mr-input" w="80px" />
            </NumberInput>
          </Box>
          <Box>
            <Text fontSize="xs" color="var(--tt-muted)" mb={0.5}>Bias (−42 to +42)</Text>
            <NumberInput size="sm" value={form.bias} min={-42} max={42}
              onChange={v => setForm(f => ({ ...f, bias: Number(v) || 0 }))}>
              <NumberInputField className="mr-input" w="80px" />
            </NumberInput>
          </Box>
          <button className="mr-button" onClick={save} disabled={saving} style={{ fontSize: "0.8rem", padding: "4px 12px", alignSelf: "flex-end" }}>
            {saving ? "Saving…" : editing ? "Update" : "Add"}
          </button>
          {editing && (
            <button className="mr-button" onClick={() => { setForm(BLANK); setEditing(null); }}
              style={{ fontSize: "0.8rem", padding: "4px 12px", opacity: 0.7, alignSelf: "flex-end" }}>
              Cancel
            </button>
          )}
        </HStack>
      </Box>

      <Box overflowX="auto">
        <Table size="sm" variant="unstyled">
          <Thead>
            <Tr>
              <Th color="var(--tt-muted)" fontSize="xs">Publisher</Th>
              <Th color="var(--tt-muted)" fontSize="xs">Domain</Th>
              <Th color="var(--tt-muted)" fontSize="xs">Quality</Th>
              <Th color="var(--tt-muted)" fontSize="xs">Reliability</Th>
              <Th color="var(--tt-muted)" fontSize="xs">Bias Score</Th>
              <Th color="var(--tt-muted)" fontSize="xs">Lean</Th>
              <Th />
            </Tr>
          </Thead>
          <Tbody>
            {filtered.map(entry => {
              const rel = reliabilityLabel(entry.quality);
              const bias = biasLabel(entry.bias);
              return (
                <Tr key={entry.domain} _hover={{ bg: "rgba(255,255,255,0.04)" }}
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  <Td py={1} color="var(--tt-text)" fontSize="sm">{entry.name}</Td>
                  <Td py={1} color="var(--tt-muted)" fontSize="xs" fontFamily="mono">{entry.domain}</Td>
                  <Td py={1} color="var(--tt-text)" fontSize="xs" textAlign="center">{entry.quality}</Td>
                  <Td py={1}>
                    <Badge fontSize="xs" px={2} py={0.5} borderRadius="full"
                      style={{ background: `${rel.color}22`, color: rel.color, border: `1px solid ${rel.color}55` }}>
                      {rel.label}
                    </Badge>
                  </Td>
                  <Td py={1} color="var(--tt-text)" fontSize="xs" textAlign="center">{entry.bias > 0 ? `+${entry.bias}` : entry.bias}</Td>
                  <Td py={1}>
                    <Badge fontSize="xs" px={2} py={0.5} borderRadius="full"
                      style={{ background: `${bias.color}22`, color: bias.color, border: `1px solid ${bias.color}55` }}>
                      {bias.label}
                    </Badge>
                  </Td>
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
