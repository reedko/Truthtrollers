// src/components/overlays/panels/LinkClaimsPanel.tsx
import React, { useState } from "react";
import {
  Box,
  VStack,
  HStack,
  Button,
  Select,
  Slider,
  SliderTrack,
  SliderThumb,
  SliderFilledTrack,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { Claim } from "../../../../../shared/entities/types";
import { useOverlayStore } from "../../../store/useOverlayStore";
import { useTaskStore } from "../../../store/useTaskStore";
import { addClaimLink } from "../../../services/useDashboardAPI";

type Props = {
  sourceClaim?: Claim;
  taskClaims?: Claim[]; // if not passed, you can fetch by contentId upstream
  contentId?: number;
  initialNotes?: string;
  viewerId?: number; // optional override
};

export default function LinkClaimsPanel({
  sourceClaim,
  taskClaims = [],
  contentId,
  initialNotes = "",
  viewerId,
}: Props) {
  const close = useOverlayStore((s) => s.close);
  const storeViewerId = useTaskStore((s) => s.viewingUserId) ?? 0;
  const userId = viewerId ?? storeViewerId;

  const [source] = useState<Claim | undefined>(sourceClaim);
  const [targetId, setTargetId] = useState<number | undefined>(undefined);

  // ✅ Use the API’s exact union spelling
  const [relation, setRelation] = useState<"supports" | "refutes">("supports");

  // ✅ Keep the same scale as your modal: -1..1
  const [conf, setConf] = useState<number>(0);

  // ✅ Notes bound to state, prefilled from initialNotes
  const [notes, setNotes] = useState<string>(initialNotes);

  const submit = async () => {
    if (!source || !targetId) return;

    await addClaimLink({
      source_claim_id: source.claim_id,
      target_claim_id: targetId,
      user_id: userId,
      relationship: relation, // "supports" | "refutes"
      support_level: conf, // -1..1, same as modal
      notes, // editable notes (prefilled)
    });

    close();
    if (contentId != null) {
      window.dispatchEvent(
        new CustomEvent("verimeter:updated", { detail: { contentId } })
      );
    }
  };

  return (
    <VStack align="stretch" spacing={4}>
      {!source && (
        <Text fontWeight="bold">
          Pick a source claim (tap a ref claim first to prefill)
        </Text>
      )}

      {source && (
        <Box p={3} borderWidth="1px" borderRadius="md" bg="blackAlpha.100">
          <Text fontSize="sm" noOfLines={6}>
            {source.claim_text}
          </Text>
        </Box>
      )}

      <Select
        placeholder="Select a target task claim"
        value={targetId ?? ""}
        onChange={(e) => setTargetId(Number(e.target.value))}
      >
        {taskClaims.map((t) => (
          <option value={t.claim_id} key={t.claim_id}>
            {t.claim_text.slice(0, 80)}
          </option>
        ))}
      </Select>

      <HStack>
        {/* ✅ exact union values */}
        <Select
          value={relation}
          onChange={(e) =>
            setRelation(e.target.value as "supports" | "refutes")
          }
          w="50%"
        >
          <option value="supports">Supports</option>
          <option value="refutes">Refutes</option>
        </Select>

        <Box flex="1">
          <Text fontSize="xs">
            Support level: {(conf >= 0 ? conf : -conf).toFixed(1)}{" "}
            {conf > 0 ? "(pro)" : conf < 0 ? "(con)" : "(neutral)"}
          </Text>
          <Slider value={conf} min={-1} max={1} step={0.1} onChange={setConf}>
            <SliderTrack>
              <SliderFilledTrack />
            </SliderTrack>
            <SliderThumb />
          </Slider>
        </Box>
      </HStack>

      {/* ✅ Notes, same as your modal UX */}
      <Box>
        <Text fontSize="sm" mb={1}>
          Notes (optional)
        </Text>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional notes about this link…"
          rows={3}
        />
      </Box>

      <HStack justify="flex-end">
        <Button onClick={close} variant="ghost">
          Cancel
        </Button>
        <Button
          colorScheme="blue"
          onClick={submit}
          isDisabled={!source || !targetId}
        >
          Save Link
        </Button>
      </HStack>
    </VStack>
  );
}
