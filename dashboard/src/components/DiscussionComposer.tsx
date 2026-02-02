import React, { useState } from "react";
import {
  Box,
  Button,
  HStack,
  Textarea,
  Tooltip,
  Text,
  useDisclosure,
} from "@chakra-ui/react";
import ReferenceModal from "./modals/ReferenceModal";
import { postDiscussionEntry } from "../services/useDashboardAPI";
import { LitReference } from "../../../shared/entities/types";
import { keyframes } from "@emotion/react";

interface DiscussionComposerProps {
  contentId: number;
  linkedClaimId?: number;
  onSubmit: (entry: any) => void;
}

// Pulsing glow animation
const pulseGlow = keyframes`
  0%, 100% { box-shadow: 0 0 20px rgba(0, 162, 255, 0.3), inset 0 0 10px rgba(0, 162, 255, 0.1); }
  50% { box-shadow: 0 0 30px rgba(0, 162, 255, 0.5), inset 0 0 15px rgba(0, 162, 255, 0.2); }
`;

const DiscussionComposer: React.FC<DiscussionComposerProps> = ({
  contentId,
  linkedClaimId,
  onSubmit,
}) => {
  const [text, setText] = useState("");
  const [side, setSide] = useState<"pro" | "con">("pro");
  const [citationUrl, setCitationUrl] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);
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
    <Box
      background="rgba(0, 0, 0, 0.6)"
      backdropFilter="blur(20px)"
      border="2px solid rgba(0, 162, 255, 0.4)"
      borderRadius="16px"
      p={6}
      boxShadow="0 8px 32px rgba(0, 0, 0, 0.8), 0 0 40px rgba(0, 162, 255, 0.3)"
      position="relative"
      overflow="hidden"
    >
      {/* Scanlines overlay */}
      <Box
        position="absolute"
        top={0}
        left={0}
        right={0}
        bottom={0}
        background="repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0, 162, 255, 0.03) 2px, rgba(0, 162, 255, 0.03) 4px)"
        pointerEvents="none"
        borderRadius="16px"
        zIndex={1}
      />

      <Box position="relative" zIndex={2}>
        {/* Header */}
        <Text
          color="#00a2ff"
          fontSize="0.75rem"
          fontWeight="600"
          textTransform="uppercase"
          letterSpacing="3px"
          mb={4}
          textAlign="center"
          textShadow="0 0 10px rgba(0, 162, 255, 0.8)"
        >
          ◈ Contribute Your Analysis ◈
        </Text>

        {/* Side Selector */}
        <HStack spacing={3} mb={4} justify="center">
          <Box
            as="button"
            onClick={() => setSide("pro")}
            px={6}
            py={3}
            background={
              side === "pro"
                ? "linear-gradient(135deg, rgba(34, 197, 94, 0.3), rgba(34, 197, 94, 0.1))"
                : "rgba(15, 23, 42, 0.6)"
            }
            border={
              side === "pro"
                ? "2px solid rgba(34, 197, 94, 0.8)"
                : "1px solid rgba(100, 116, 139, 0.3)"
            }
            borderRadius="12px"
            color={side === "pro" ? "#4ade80" : "#94a3b8"}
            fontSize="0.9rem"
            fontWeight="700"
            textTransform="uppercase"
            letterSpacing="1.5px"
            transition="all 0.3s ease"
            _hover={{
              transform: "translateY(-2px)",
              boxShadow: "0 0 20px rgba(34, 197, 94, 0.5)",
            }}
            boxShadow={
              side === "pro"
                ? "0 0 20px rgba(34, 197, 94, 0.4)"
                : "0 4px 12px rgba(0, 0, 0, 0.4)"
            }
          >
            ✓ Supporting
          </Box>

          <Box
            as="button"
            onClick={() => setSide("con")}
            px={6}
            py={3}
            background={
              side === "con"
                ? "linear-gradient(135deg, rgba(239, 68, 68, 0.3), rgba(239, 68, 68, 0.1))"
                : "rgba(15, 23, 42, 0.6)"
            }
            border={
              side === "con"
                ? "2px solid rgba(239, 68, 68, 0.8)"
                : "1px solid rgba(100, 116, 139, 0.3)"
            }
            borderRadius="12px"
            color={side === "con" ? "#f87171" : "#94a3b8"}
            fontSize="0.9rem"
            fontWeight="700"
            textTransform="uppercase"
            letterSpacing="1.5px"
            transition="all 0.3s ease"
            _hover={{
              transform: "translateY(-2px)",
              boxShadow: "0 0 20px rgba(239, 68, 68, 0.5)",
            }}
            boxShadow={
              side === "con"
                ? "0 0 20px rgba(239, 68, 68, 0.4)"
                : "0 4px 12px rgba(0, 0, 0, 0.4)"
            }
          >
            ✗ Challenging
          </Box>
        </HStack>

        {/* Text Input */}
        <Textarea
          placeholder="Enter your argument or analysis..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          minH="120px"
          mb={3}
          background="rgba(15, 23, 42, 0.8)"
          border={
            isFocused
              ? "2px solid rgba(0, 162, 255, 0.6)"
              : "1px solid rgba(100, 116, 139, 0.3)"
          }
          borderRadius="10px"
          color="#e2e8f0"
          fontSize="0.9rem"
          _placeholder={{ color: "#64748b" }}
          _focus={{
            outline: "none",
            boxShadow: "0 0 20px rgba(0, 162, 255, 0.4)",
          }}
          sx={
            isFocused
              ? {
                  animation: `${pulseGlow} 2s ease-in-out infinite`,
                }
              : {}
          }
        />

        {/* Citation Display */}
        {citationUrl && (
          <Tooltip label={citationUrl}>
            <Box
              mb={3}
              px={3}
              py={2}
              background="rgba(59, 130, 246, 0.1)"
              border="1px solid rgba(59, 130, 246, 0.3)"
              borderRadius="8px"
              fontSize="0.75rem"
              color="#60a5fa"
              isTruncated
              display="flex"
              alignItems="center"
              gap={2}
            >
              <Text>🔗</Text>
              <Text isTruncated>{citationUrl}</Text>
            </Box>
          </Tooltip>
        )}

        {/* Action Buttons */}
        <HStack spacing={3} justify="flex-end">
          <Button
            size="sm"
            onClick={onOpen}
            background="rgba(59, 130, 246, 0.2)"
            border="1px solid rgba(59, 130, 246, 0.4)"
            color="#60a5fa"
            _hover={{
              background: "rgba(59, 130, 246, 0.3)",
              boxShadow: "0 0 15px rgba(59, 130, 246, 0.4)",
            }}
            fontWeight="600"
            textTransform="uppercase"
            letterSpacing="1px"
          >
            📎 Add Source
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            background={
              side === "pro"
                ? "linear-gradient(135deg, rgba(34, 197, 94, 0.3), rgba(34, 197, 94, 0.1))"
                : "linear-gradient(135deg, rgba(239, 68, 68, 0.3), rgba(239, 68, 68, 0.1))"
            }
            border={`2px solid ${side === "pro" ? "rgba(34, 197, 94, 0.6)" : "rgba(239, 68, 68, 0.6)"}`}
            color={side === "pro" ? "#4ade80" : "#f87171"}
            _hover={{
              boxShadow: `0 0 20px ${side === "pro" ? "rgba(34, 197, 94, 0.5)" : "rgba(239, 68, 68, 0.5)"}`,
              transform: "translateY(-2px)",
            }}
            fontWeight="700"
            textTransform="uppercase"
            letterSpacing="1.5px"
            isDisabled={!text.trim()}
          >
            ⚡ Submit
          </Button>
        </HStack>
      </Box>

      {/* Reference Picker Modal */}
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
