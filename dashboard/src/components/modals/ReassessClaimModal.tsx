// src/components/modals/ReassessClaimModal.tsx
import React, { useState } from "react";
import {
  Box,
  Button,
  FormLabel,
  Text,
  Textarea,
  useToast,
  VStack,
} from "@chakra-ui/react";
import ResponsiveOverlay from "../overlays/ResponsiveOverlay";

interface ReassessClaimModalProps {
  isOpen: boolean;
  onClose: () => void;
  referenceClaimId: number;
  taskClaimId: number;
  referenceClaimText: string;
  taskClaimText: string;
  currentAssessment?: {
    stance: string;
    confidence: number;
    support_level: number;
    rationale?: string;
  };
  onReassessComplete?: () => void;
}

const DEFAULT_SYSTEM_PROMPT = `You are assessing whether a reference claim is relevant to a task claim.

Guidelines:
- "support": Reference claim provides evidence FOR the task claim
- "refute": Reference claim provides evidence AGAINST the task claim
- "nuance": Reference claim adds context or partial support/refutation
- "insufficient": Reference claim is not relevant or doesn't provide meaningful evidence

- confidence: 0-1 (how certain you are of the stance)
- quality: 0-1.2 (how strong/useful the reference claim is as evidence)
- rationale: 1-2 sentences explaining WHY this stance applies`;

const ReassessClaimModal: React.FC<ReassessClaimModalProps> = ({
  isOpen,
  onClose,
  referenceClaimId,
  taskClaimId,
  referenceClaimText,
  taskClaimText,
  currentAssessment,
  onReassessComplete,
}) => {
  const toast = useToast();
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [customInstructions, setCustomInstructions] = useState("");
  const [isReassessing, setIsReassessing] = useState(false);

  const handleReassess = async () => {
    try {
      setIsReassessing(true);

      const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

      // Delete existing assessment and create new one with custom prompts
      const response = await fetch(`${API_BASE_URL}/api/reassess-claim-relevance`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          referenceClaimId,
          taskClaimId,
          referenceClaimText,
          taskClaimText,
          systemPrompt: systemPrompt || DEFAULT_SYSTEM_PROMPT,
          customInstructions: customInstructions || null,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to reassess claim");
      }

      const result = await response.json();

      toast({
        title: "Re-assessment complete!",
        description: `New stance: ${result.assessment.stance}`,
        status: "success",
        duration: 3000,
        isClosable: true,
      });

      onReassessComplete?.();
      onClose();
    } catch (err) {
      console.error("Re-assessment error:", err);
      toast({
        title: "Re-assessment failed",
        description: err instanceof Error ? err.message : "Unknown error",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setIsReassessing(false);
    }
  };

  const footer = (
    <>
      <Button
        className="mr-button"
        mr={3}
        onClick={handleReassess}
        isLoading={isReassessing}
        loadingText="Re-assessing..."
      >
        Re-assess
      </Button>
      <Button onClick={onClose} isDisabled={isReassessing}>
        Cancel
      </Button>
    </>
  );

  return (
    <ResponsiveOverlay
      isOpen={isOpen}
      onClose={onClose}
      title="Re-assess Claim Relationship"
      footer={footer}
      size="xl"
    >
      <VStack spacing={4} align="stretch">
        {/* Current Assessment */}
        {currentAssessment && (
          <Box
            p={4}
            bg="rgba(139, 92, 246, 0.1)"
            border="1px solid rgba(139, 92, 246, 0.3)"
            borderRadius="md"
          >
            <Text className="mr-text-primary" fontWeight="bold" mb={2}>
              Current Assessment:
            </Text>
            <Text className="mr-text-secondary">
              Stance: <strong>{currentAssessment.stance}</strong> | Confidence:{" "}
              <strong>{Math.round(currentAssessment.confidence * 100)}%</strong> | Support Level:{" "}
              <strong>{currentAssessment.support_level.toFixed(2)}</strong>
            </Text>
            {currentAssessment.rationale && (
              <Text className="mr-text-secondary" mt={2} fontSize="sm" fontStyle="italic">
                "{currentAssessment.rationale}"
              </Text>
            )}
          </Box>
        )}

        {/* Claims */}
        <Box>
          <Text className="mr-text-primary" fontWeight="bold" mb={2}>
            Task Claim:
          </Text>
          <Text className="mr-text-secondary" fontSize="sm" p={2} bg="rgba(0,0,0,0.2)" borderRadius="md">
            {taskClaimText}
          </Text>
        </Box>

        <Box>
          <Text className="mr-text-primary" fontWeight="bold" mb={2}>
            Reference Claim:
          </Text>
          <Text className="mr-text-secondary" fontSize="sm" p={2} bg="rgba(0,0,0,0.2)" borderRadius="md">
            {referenceClaimText}
          </Text>
        </Box>

        {/* System Prompt */}
        <Box>
          <FormLabel className="mr-text-primary">System Prompt</FormLabel>
          <Textarea
            className="mr-input"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={10}
            fontSize="sm"
            fontFamily="monospace"
          />
        </Box>

        {/* Custom Instructions */}
        <Box>
          <FormLabel className="mr-text-primary">
            Custom Instructions (optional)
          </FormLabel>
          <Textarea
            className="mr-input"
            value={customInstructions}
            onChange={(e) => setCustomInstructions(e.target.value)}
            placeholder="Add specific guidance for this assessment (e.g., 'Pay attention to the context of COVID-19 vaccines vs. all vaccines')"
            rows={3}
            fontSize="sm"
          />
        </Box>
      </VStack>
    </ResponsiveOverlay>
  );
};

export default ReassessClaimModal;
