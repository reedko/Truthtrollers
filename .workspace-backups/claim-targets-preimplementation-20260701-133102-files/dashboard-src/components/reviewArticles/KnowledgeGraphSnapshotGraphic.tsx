import React from "react";
import { Box, Grid, HStack, Text, VStack } from "@chakra-ui/react";
import { ClaimLinkArticleData } from "./types";

interface KnowledgeGraphSnapshotGraphicProps {
  contentTitle?: string;
  author?: string;
  publisher?: string;
  claimLinks?: ClaimLinkArticleData[];
  sourcesUsed?: number;
}

const NodeBox: React.FC<{ label: string; value: string; tone?: "blue" | "green" | "gold" | "purple" }> = ({ label, value, tone = "blue" }) => {
  const color = tone === "green" ? "var(--mr-green)" : tone === "gold" ? "var(--mr-gold)" : tone === "purple" ? "var(--mr-purple)" : "var(--mr-blue)";
  const border = tone === "green" ? "var(--mr-green-border)" : tone === "purple" ? "var(--mr-purple-border)" : "var(--mr-blue-border)";
  return (
    <Box border={`1px solid ${border}`} bg="rgba(255,255,255,0.05)" borderRadius="var(--mr-radius-sm)" p={3} minH="76px">
      <Text fontSize="10px" color={color} textTransform="uppercase" letterSpacing="0.06em">{label}</Text>
      <Text fontSize="sm" color="var(--mr-text-primary)" noOfLines={3}>{value}</Text>
    </Box>
  );
};

const KnowledgeGraphSnapshotGraphic: React.FC<KnowledgeGraphSnapshotGraphicProps> = ({
  contentTitle,
  author,
  publisher,
  claimLinks = [],
  sourcesUsed,
}) => {
  const sourcePublishers = Array.from(new Set(claimLinks.map((link) => link.source_publisher).filter(Boolean))).slice(0, 3);
  const relationships = claimLinks.reduce<Record<string, number>>((acc, link) => {
    const rel = (link.relationship || "unclear").toLowerCase();
    acc[rel] = (acc[rel] || 0) + 1;
    return acc;
  }, {});

  return (
    <Box className="mr-card mr-card-purple" p={4}>
      <VStack align="stretch" spacing={4}>
        <Box>
          <Text fontSize="xs" color="var(--mr-purple)" textTransform="uppercase" letterSpacing="0.08em">
            Knowledge Graph Snapshot
          </Text>
          <Text color="var(--mr-text-muted)" fontSize="sm">
            Content, source, publisher, and claim-link relationships in this review
          </Text>
        </Box>

        <Grid templateColumns={{ base: "1fr", md: "1fr 1.2fr 1fr" }} gap={3} alignItems="center">
          <VStack align="stretch" spacing={3}>
            <NodeBox label="Author" value={author || "Unknown"} tone="gold" />
            <NodeBox label="Publisher" value={publisher || "Unknown"} tone="purple" />
          </VStack>

          <Box border="1px solid var(--mr-blue-border)" bg="rgba(0,162,255,0.08)" borderRadius="var(--mr-radius-sm)" p={4} textAlign="center" boxShadow="0 0 18px var(--mr-blue-border)">
            <Text fontSize="10px" color="var(--mr-blue)" textTransform="uppercase" letterSpacing="0.06em">Reviewed Content</Text>
            <Text color="var(--mr-text-primary)" fontWeight={700} noOfLines={4}>{contentTitle || "Untitled content"}</Text>
          </Box>

          <VStack align="stretch" spacing={3}>
            <NodeBox label="Claims Reviewed" value={String(claimLinks.length)} tone="blue" />
            <NodeBox label="Sources Used" value={String(sourcesUsed ?? sourcePublishers.length)} tone="green" />
          </VStack>
        </Grid>

        <HStack spacing={2} flexWrap="wrap">
          {Object.entries(relationships).map(([relationship, count]) => (
            <Box key={relationship} border="1px solid var(--mr-glass-border)" borderRadius="var(--mr-radius-sm)" px={3} py={2} bg="rgba(255,255,255,0.045)">
              <Text fontSize="xs" color="var(--mr-text-muted)" textTransform="capitalize">{relationship}: {count}</Text>
            </Box>
          ))}
          {sourcePublishers.map((source) => (
            <Box key={source} border="1px solid var(--mr-green-border)" borderRadius="var(--mr-radius-sm)" px={3} py={2} bg="rgba(34,197,94,0.08)">
              <Text fontSize="xs" color="var(--mr-green)">{source}</Text>
            </Box>
          ))}
        </HStack>
      </VStack>
    </Box>
  );
};

export default KnowledgeGraphSnapshotGraphic;
