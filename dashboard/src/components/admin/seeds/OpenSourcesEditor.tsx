import React, { useState } from "react";
import {
  Box, Table, Thead, Tbody, Tr, Th, Td, Input, Textarea,
  HStack, VStack, Text, Badge, IconButton, useToast, Wrap, WrapItem, Checkbox,
} from "@chakra-ui/react";
import { api } from "../../../services/api";

interface OpenSourcesEntry {
  domain: string;
  types: string[];
  source_notes?: string;
}

const ALL_TYPES = [
  "fake", "conspiracy", "disinformation", "propaganda", "hate",
  "junk science", "bias", "clickbait", "misleading", "satire",
  "unreliable", "credible",
];

const TYPE_COLOR: Record<string, string> = {
  fake:          "#e53e3e",
  conspiracy:    "#e53e3e",
  disinformation:"#e53e3e",
  propaganda:    "#c05621",
  hate:          "#9b2c2c",
  "junk science":"#d69e2e",
  bias:          "#ed8936",
  clickbait:     "#d69e2e",
  misleading:    "#dd6b20",
  satire:        "#805ad5",
  unreliable:    "#718096",
  credible:      "#38a169",
};

const BLANK: OpenSourcesEntry = { domain: "", types: [], source_notes: "" };

interface Props {
  entries: OpenSourcesEntry[];
  onRefresh: () => void;
}

export default function OpenSourcesEditor({ entries, onRefresh }: Props) {
  const [filter, setFilter] = useState("");
  const [form, setForm] = useState<OpenSourcesEntry>(BLANK);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const filtered = entries.filter(e =>
    !filter || e.domain.includes(filter)
      || e.types.some(t => t.includes(filter.toLowerCase()))
  );

  function toggleType(t: string) {
    setForm(f => ({
      ...f,
      types: f.types.includes(t) ? f.types.filter(x => x !== t) : [...f.types, t],
    }));
  }

  async function save() {
    if (!form.domain) {
      toast({ title: "Domain is required", status: "warning", duration: 2000 });
      return;
    }
    setSaving(true);
    try {
      await api.post("/api/admin/seeds/opensources/entry", form);
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
      await api.delete("/api/admin/seeds/opensources/entry", { data: { domain } });
      toast({ title: "Removed", status: "info", duration: 1500 });
      onRefresh();
    } catch {
      toast({ title: "Delete failed", status: "error", duration: 3000 });
    }
  }

  function startEdit(entry: OpenSourcesEntry) {
    setForm({ ...entry });
    setEditing(entry.domain);
  }

  return (
    <VStack align="stretch" gap={4}>
      <HStack gap={2} flexWrap="wrap">
        <Input placeholder="Filter by domain or type…" value={filter}
          onChange={e => setFilter(e.target.value)} size="sm" maxW="260px" className="mr-input" />
        <Box flex={1} />
        <Text fontSize="xs" color="var(--tt-muted)" whiteSpace="nowrap">
          {filtered.length} / {entries.length} flagged domains
        </Text>
      </HStack>

      <Box className="mr-card" p={3}>
        <Text fontSize="xs" color="var(--tt-accent)" mb={2} fontWeight="bold" textTransform="uppercase" letterSpacing="wider">
          {editing ? `Editing ${editing}` : "Flag Domain"}
        </Text>
        <VStack align="stretch" gap={2}>
          <Input size="sm" placeholder="problematic-domain.com" value={form.domain}
            onChange={e => setForm(f => ({ ...f, domain: e.target.value }))} className="mr-input" />
          <Text fontSize="xs" color="var(--tt-muted)">Types:</Text>
          <Wrap gap={2}>
            {ALL_TYPES.map(t => (
              <WrapItem key={t}>
                <Checkbox
                  isChecked={form.types.includes(t)}
                  onChange={() => toggleType(t)}
                  size="sm"
                  sx={{
                    ".chakra-checkbox__control": {
                      borderColor: form.types.includes(t) ? TYPE_COLOR[t] : "rgba(255,255,255,0.3)",
                      bg: form.types.includes(t) ? `${TYPE_COLOR[t]}33` : "transparent",
                    },
                  }}
                >
                  <Text fontSize="xs" color={form.types.includes(t) ? TYPE_COLOR[t] : "var(--tt-muted)"}>{t}</Text>
                </Checkbox>
              </WrapItem>
            ))}
          </Wrap>
          <Textarea size="sm" placeholder="Source notes (optional)…" value={form.source_notes ?? ""}
            onChange={e => setForm(f => ({ ...f, source_notes: e.target.value }))}
            className="mr-input" rows={2} resize="none" />
          <HStack gap={2}>
            <button className="mr-button" onClick={save} disabled={saving} style={{ fontSize: "0.8rem", padding: "4px 12px" }}>
              {saving ? "Saving…" : editing ? "Update" : "Flag"}
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
              <Th color="var(--tt-muted)" fontSize="xs">Domain</Th>
              <Th color="var(--tt-muted)" fontSize="xs">Flags</Th>
              <Th color="var(--tt-muted)" fontSize="xs">Notes</Th>
              <Th />
            </Tr>
          </Thead>
          <Tbody>
            {filtered.map(entry => (
              <Tr key={entry.domain} _hover={{ bg: "rgba(255,255,255,0.04)" }}
                style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <Td py={1} color="var(--tt-text)" fontSize="xs" fontFamily="mono">{entry.domain}</Td>
                <Td py={1}>
                  <Wrap gap={1}>
                    {entry.types.map(t => (
                      <WrapItem key={t}>
                        <Badge fontSize="xs" px={1.5} py={0.5} borderRadius="full"
                          style={{ background: `${TYPE_COLOR[t] ?? "#718096"}22`, color: TYPE_COLOR[t] ?? "#718096", border: `1px solid ${TYPE_COLOR[t] ?? "#718096"}55` }}>
                          {t}
                        </Badge>
                      </WrapItem>
                    ))}
                  </Wrap>
                </Td>
                <Td py={1} color="var(--tt-muted)" fontSize="xs" maxW="300px"
                  overflow="hidden" style={{ textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {entry.source_notes}
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
