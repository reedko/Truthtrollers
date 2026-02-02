// src/components/DiscussionCard.tsx
import React from "react";
import { DiscussionEntry } from "../../../shared/entities/types";
import { Box, Text } from "@chakra-ui/react";

interface Props {
  entry: DiscussionEntry;
}

const DiscussionCard: React.FC<Props> = ({ entry }) => {
  const isPro = entry.side === "pro";

  return (
    <Box position="relative">
      <Box
        className="mr-card"
        p={4}
        position="relative"
        background={
          isPro
            ? "linear-gradient(135deg, rgba(34, 197, 94, 0.15), rgba(34, 197, 94, 0.05))"
            : "linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(239, 68, 68, 0.05))"
        }
        backdropFilter="blur(20px)"
        border={`2px solid ${isPro ? "rgba(34, 197, 94, 0.3)" : "rgba(239, 68, 68, 0.3)"}`}
        borderRadius="12px"
        boxShadow={`0 8px 32px rgba(0, 0, 0, 0.6), 0 0 40px ${isPro ? "rgba(34, 197, 94, 0.2)" : "rgba(239, 68, 68, 0.2)"}`}
        overflow="hidden"
      >
        {/* Side Indicator Glow Bar */}
        <Box
          position="absolute"
          top={0}
          left={0}
          width="4px"
          height="100%"
          background={
            isPro
              ? "linear-gradient(180deg, #4ade80, transparent)"
              : "linear-gradient(180deg, #f87171, transparent)"
          }
          boxShadow={`0 0 10px ${isPro ? "#4ade80" : "#f87171"}`}
          zIndex={1}
        />

        {/* Scanlines overlay */}
        <Box
          position="absolute"
          top={0}
          left={0}
          right={0}
          bottom={0}
          background="repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0, 162, 255, 0.03) 2px, rgba(0, 162, 255, 0.03) 4px)"
          pointerEvents="none"
          borderRadius="12px"
          zIndex={2}
        />

        {/* Content */}
        <Box position="relative" zIndex={3}>
          {/* Side Badge */}
          <Box
            display="inline-block"
            px={3}
            py={1}
            mb={3}
            background={isPro ? "rgba(34, 197, 94, 0.2)" : "rgba(239, 68, 68, 0.2)"}
            border={`1px solid ${isPro ? "rgba(34, 197, 94, 0.4)" : "rgba(239, 68, 68, 0.4)"}`}
            borderRadius="8px"
            fontSize="0.7rem"
            fontWeight="700"
            textTransform="uppercase"
            letterSpacing="1.5px"
            color={isPro ? "#4ade80" : "#f87171"}
          >
            {isPro ? "✓ SUPPORT" : "✗ CHALLENGE"}
          </Box>

          {/* Entry Text */}
          <Text
            className="mr-text-primary"
            fontSize="0.95rem"
            fontWeight="400"
            whiteSpace="pre-wrap"
            lineHeight="1.6"
            color="#e2e8f0"
            mb={entry.citation_url ? 3 : 0}
          >
            {entry.text}
          </Text>

          {/* Citation */}
          {entry.citation_url && (
            <Box
              mt={3}
              pt={3}
              borderTop="1px solid rgba(100, 116, 139, 0.2)"
            >
              <Box
                display="inline-flex"
                alignItems="center"
                gap={2}
                px={3}
                py={2}
                background="rgba(59, 130, 246, 0.1)"
                border="1px solid rgba(59, 130, 246, 0.3)"
                borderRadius="8px"
                fontSize="0.75rem"
                color="#60a5fa"
                _hover={{
                  background: "rgba(59, 130, 246, 0.15)",
                  borderColor: "rgba(59, 130, 246, 0.5)",
                }}
                as="a"
                href={entry.citation_url}
                target="_blank"
                rel="noreferrer"
              >
                <Text>🔗</Text>
                <Text noOfLines={1} maxW="300px">
                  {entry.citation_url}
                </Text>
              </Box>
            </Box>
          )}

          {/* Timestamp */}
          <Text
            mt={3}
            fontSize="0.65rem"
            color="#64748b"
            fontWeight="500"
            textTransform="uppercase"
            letterSpacing="1px"
          >
            {new Date(entry.created_at).toLocaleString()}
          </Text>
        </Box>
      </Box>
    </Box>
  );
};

export default DiscussionCard;
