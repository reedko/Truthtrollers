// src/components/overlays/panels/VerifyClaimPanel.tsx
import React, { useState } from "react";
import {
  Box,
  VStack,
  HStack,
  Text,
  Textarea,
  Button,
  RadioGroup,
  Radio,
  Slider,
  SliderTrack,
  SliderFilledTrack,
  SliderThumb,
  useToast,
} from "@chakra-ui/react";
import { Claim } from "../../../../../shared/entities/types";
import { useOverlayStore } from "../../../store/useOverlayStore";
import { useTaskStore } from "../../../store/useTaskStore";
import {
  // implement this in your API file if not present yet
  saveClaimVerification,
  updateScoresForContent,
  fetchContentScores,
} from "../../../services/useDashboardAPI";

type Props = {
  claim: Claim;
  contentId: number;
  viewerId?: number | null;
  defaultVerdict?: "true" | "false" | "uncertain";
  defaultConfidence?: number; // 0..1
  defaultNotes?: string;
};

export default function VerifyClaimPanel({
  claim,
  contentId,
  viewerId: viewerIdProp = null,
  defaultVerdict = "true",
  defaultConfidence = 0.6,
  defaultNotes = "",
}: Props) {
  const close = useOverlayStore((s) => s.close);
  const toast = useToast();
  const viewerIdFromStore = useTaskStore((s) => s.viewingUserId);
  const setVerimeterScore = useTaskStore((s) => s.setVerimeterScore);

  const viewerId = viewerIdProp ?? viewerIdFromStore ?? undefined;

  const [verdict, setVerdict] = useState<"true" | "false" | "uncertain">(
    defaultVerdict
  );
  const [confidence, setConfidence] = useState<number>(defaultConfidence);
  const [notes, setNotes] = useState<string>(defaultNotes);

  const onSave = async () => {
    try {
      // Normalize payload for your API
      await saveClaimVerification({
        claim_id: claim.claim_id,
        user_id: viewerId, // can be undefined if anon; adjust API as needed
        verdict, // "true" | "false" | "uncertain"
        confidence, // 0..1
        notes,
      });

      // Refresh scores and store
      await updateScoresForContent(contentId, viewerId ?? null);
      const scores = await fetchContentScores(contentId, viewerId ?? null);
      setVerimeterScore(contentId, scores?.verimeterScore ?? null);
      window.dispatchEvent(
        new CustomEvent("verimeter:updated", { detail: { contentId } })
      );

      toast({ title: "Verification saved", status: "success", duration: 2000 });
      close();
    } catch (e) {
      console.error(e);
      toast({
        title: "Failed to save verification",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
    }
  };

  return (
    <VStack align="stretch" spacing={4}>
      <Box>
        <Text fontWeight="bold" mb={1}>
          Verify claim
        </Text>
        <Text fontSize="sm" color="gray.500">
          Content #{contentId}
        </Text>
      </Box>

      <Box p={3} borderWidth="1px" borderRadius="md" bg="blackAlpha.50">
        <Text fontSize="sm">{claim.claim_text}</Text>
      </Box>

      <Box>
        <Text fontSize="sm" fontWeight="semibold" mb={2}>
          Verdict
        </Text>
        <RadioGroup
          value={verdict}
          onChange={(v) => setVerdict(v as typeof verdict)}
        >
          <HStack spacing={4}>
            <Radio value="true">True / Accurate</Radio>
            <Radio value="false">False / Inaccurate</Radio>
            <Radio value="uncertain">Uncertain</Radio>
          </HStack>
        </RadioGroup>
      </Box>

      <Box>
        <Text fontSize="sm" fontWeight="semibold">
          Confidence: {Math.round(confidence * 100)}%
        </Text>
        <Slider
          mt={2}
          value={confidence}
          min={0}
          max={1}
          step={0.05}
          onChange={setConfidence}
        >
          <SliderTrack>
            <SliderFilledTrack />
          </SliderTrack>
          <SliderThumb />
        </Slider>
      </Box>

      <Box>
        <Text fontSize="sm" fontWeight="semibold" mb={2}>
          Notes
        </Text>
        <Textarea
          placeholder="Optional notes or rationale…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
        />
      </Box>

      <HStack justify="flex-end">
        <Button variant="ghost" onClick={close}>
          Cancel
        </Button>
        <Button colorScheme="blue" onClick={onSave}>
          Save
        </Button>
      </HStack>
    </VStack>
  );
}
