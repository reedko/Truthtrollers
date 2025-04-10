import React, { useState } from "react";
import {
  Box,
  Button,
  HStack,
  Input,
  Radio,
  RadioGroup,
  Textarea,
  Tooltip,
  VStack,
  useDisclosure,
} from "@chakra-ui/react";
import ReferenceModal from "./modals/ReferenceModal";
import { postDiscussionEntry } from "../services/useDashboardAPI";
import { LitReference } from "../../../shared/entities/types";

interface DiscussionComposerProps {
  contentId: number;
  linkedClaimId?: number;
  onSubmit: (entry: any) => void;
}

const DiscussionComposer: React.FC<DiscussionComposerProps> = ({
  contentId,
  linkedClaimId,
  onSubmit,
}) => {
  const [text, setText] = useState("");
  const [side, setSide] = useState<"pro" | "con">("pro");
  const [citationUrl, setCitationUrl] = useState<string | null>(null);
  const { isOpen, onOpen, onClose } = useDisclosure();

  const handleSubmit = async () => {
    if (!text.trim()) return;

    const newEntry = {
      content_id: contentId,
      side: side as "pro" | "con",
      text,
      citation_url: citationUrl || undefined,
      created_by: "guest", // TODO: replace with real user
      linked_claim_id: linkedClaimId || undefined,
    };

    try {
      const saved = await postDiscussionEntry(newEntry);
      onSubmit(saved);
      setText("");
      setCitationUrl(null);
    } catch (err) {
      console.error("Failed to submit discussion:", err);
    }
  };

  return (
    <Box bg="gray.800" p={4} borderRadius="md">
      <RadioGroup
        onChange={(val) => setSide(val as "pro" | "con")}
        value={side}
      >
        <HStack spacing={4} mb={3}>
          <Radio value="pro" colorScheme="green">
            Supporting
          </Radio>
          <Radio value="con" colorScheme="red">
            Challenging
          </Radio>
        </HStack>
      </RadioGroup>

      <Textarea
        placeholder="What’s your reasoning?"
        value={text}
        onChange={(e) => setText(e.target.value)}
        bg="gray.700"
        color="white"
        mb={3}
      />

      {citationUrl && (
        <Tooltip label={citationUrl}>
          <Box fontSize="sm" color="blue.300" isTruncated>
            🔗 {citationUrl}
          </Box>
        </Tooltip>
      )}

      <HStack spacing={3} mt={2}>
        <Button size="sm" onClick={onOpen} variant="outline" colorScheme="blue">
          Cite
        </Button>
        <Button size="sm" onClick={handleSubmit} colorScheme="green">
          Submit
        </Button>
      </HStack>

      {/* 🧠 Reference Picker Modal */}
      <ReferenceModal
        isOpen={isOpen}
        onClose={onClose}
        taskId={contentId}
        onSelectReference={(ref: LitReference) => {
          setCitationUrl(ref.url || "");
          onClose();
        }}
      />
    </Box>
  );
};

export default DiscussionComposer;
