import React, { useState } from "react";
import {
  Box, Table, Thead, Tbody, Tr, Th, Td, Input, Select,
  HStack, VStack, Text, Badge, IconButton, useToast,
} from "@chakra-ui/react";
import { api } from "../../../services/api";

interface AllSidesEntry {
  name: string;
  domain: string;
  bias: string;
}

const BIAS_OPTIONS = ["Left", "Lean Left", "Center", "Lean Right", "Right", "Mixed"];

const BIAS_COLOR: Record<string, string> = {
  "Left":       "#e53e3e",
  "Lean Left":  "#ed8936",
  "Center":     "#38a169",
  "Lean Right": "#3182ce",
  "Right":      "#805ad5",
  "Mixed":      "#718096",
};

const BLANK: AllSidesEntry = { name: "", domain: "", bias: "Center" };

interface Props {
  entries: AllSidesEntry[];
  onRefresh: () => void;
}

export default function AllSidesEditor({ entries, onRefresh }: Props) {
  const [filter, setFilter] = useState("");
  const [form, setForm] = useState<AllSidesEntry>(BLANK);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const filtered = entries.filter(e =>
    !filter || e.domain.includes(filter) || e.name.toLowerCase().includes(filter.toLowerCase())
  );

  async function save() {
    if (!form.domain || !form.name || !form.bias) {
      toast({ title: "Domain, name, and bias are required", status: "warning", duration: 2000 });
      return;
    }
    setSaving(true);
    try {
      await api.post("/api/admin/seeds/allsides/entry", form);
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
      await api.delete("/api/admin/seeds/allsides/entry", { data: { domain } });
      toast({ title: "Removed", status: "info", duration: 1500 });
      onRefresh();
    } catch {
      toast({ title: "Delete failed", status: "error", duration: 3000 });
    }
  }

  function startEdit(entry: AllSidesEntry) {
    setForm({ ...entry });
    setEditing(entry.domain);
  }

  return (
    <VStack align="stretch" gap={4}>
      {/* Filter + Add row */}
      <HStack gap={2} flexWrap="wrap">
        <Input
          placeholder="Filter by domain or name…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          size="sm"
          maxW="260px"
          className="mr-input"
        />
        <Box flex={1} />
        <Text fontSize="xs" color="var(--tt-muted)" whiteSpace="nowrap">
          {filtered.length} / {entries.length} entries
        </Text>
      </HStack>

      {/* Add / Edit form */}
      <Box className="mr-card" p={3}>
        <Text fontSize="xs" color="var(--tt-accent)" mb={2} fontWeight="bold" textTransform="uppercase" letterSpacing="wider">
          {editing ? `Editing ${editing}` : "Add Entry"}
        </Text>
        <HStack gap={2} flexWrap="wrap">
          <Input size="sm" placeholder="Publisher name" value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="mr-input" flex={1} minW="140px" />
          <Input size="sm" placeholder="domain.com" value={form.domain}
            onChange={e => setForm(f => ({ ...f, domain: e.target.value }))} className="mr-input" flex={1} minW="140px" />
          <Select size="sm" value={form.bias}
            onChange={e => setForm(f => ({ ...f, bias: e.target.value }))}
            className="mr-input" w="140px">
            {BIAS_OPTIONS.map(b => <option key={b} value={b}>{b}</option>)}
          </Select>
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
      </Box>

      {/* Table */}
      <Box overflowX="auto">
        <Table size="sm" variant="unstyled">
          <Thead>
            <Tr>
              <Th color="var(--tt-muted)" fontSize="xs">Publisher</Th>
              <Th color="var(--tt-muted)" fontSize="xs">Domain</Th>
              <Th color="var(--tt-muted)" fontSize="xs">Bias</Th>
              <Th />
            </Tr>
          </Thead>
          <Tbody>
            {filtered.map(entry => (
              <Tr key={entry.domain}
                _hover={{ bg: "rgba(255,255,255,0.04)" }}
                style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <Td py={1} color="var(--tt-text)" fontSize="sm">{entry.name}</Td>
                <Td py={1} color="var(--tt-muted)" fontSize="xs" fontFamily="mono">{entry.domain}</Td>
                <Td py={1}>
                  <Badge fontSize="xs" px={2} py={0.5} borderRadius="full"
                    style={{ background: `${BIAS_COLOR[entry.bias] ?? "#718096"}22`, color: BIAS_COLOR[entry.bias] ?? "#718096", border: `1px solid ${BIAS_COLOR[entry.bias] ?? "#718096"}55` }}>
                    {entry.bias}
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
            ))}
          </Tbody>
        </Table>
      </Box>
    </VStack>
  );
}
