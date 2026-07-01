import React from "react";
import { Badge, Box, Divider, HStack, Link, Text, VStack } from "@chakra-ui/react";
import ClaimLinkMiniGraph from "./ClaimLinkMiniGraph";
import { ClaimLinkArticleData } from "./types";

interface ClaimLinkArticleCardProps {
  link: ClaimLinkArticleData;
  index: number;
}

const relationshipTone = (relationship?: string) => {
  const rel = (relationship || "unclear").toLowerCase();
  if (rel === "supports") return { color: "var(--mr-green)", border: "var(--mr-green-border)", bg: "rgba(34,197,94,0.12)" };
  if (rel === "refutes") return { color: "var(--mr-red)", border: "rgba(248,113,113,0.35)", bg: "rgba(248,113,113,0.12)" };
  if (rel === "qualifies") return { color: "var(--mr-gold)", border: "rgba(251,191,36,0.35)", bg: "rgba(251,191,36,0.12)" };
  return { color: "var(--mr-text-muted)", border: "var(--mr-glass-border)", bg: "rgba(255,255,255,0.06)" };
};

const ClaimLinkArticleCard: React.FC<ClaimLinkArticleCardProps> = ({ link, index }) => {
  const relationship = link.relationship || "unclear";
  const tone = relationshipTone(relationship);
  const strength = link.support_level ?? "Not rated";
  const rationale = (link.rationale || "").trim() || "No rationale provided yet.";
  const sourceTitle = link.source_title || link.source_publisher || "Source";

  return (
    <Box className="mr-card" p={4}>
      <VStack align="stretch" spacing={3}>
        <HStack justify="space-between" align="start" spacing={3}>
          <Text fontSize="xs" color="var(--mr-blue)" textTransform="uppercase" letterSpacing="0.08em">
            Claim Link {index + 1}
          </Text>
          <HStack spacing={2} flexWrap="wrap" justify="flex-end">
            <Badge
              bg={tone.bg}
              color={tone.color}
              border={`1px solid ${tone.border}`}
              borderRadius="var(--mr-radius-sm)"
              px={2}
              textTransform="capitalize"
            >
              {relationship}
            </Badge>
            <Badge
              bg="rgba(0,162,255,0.10)"
              color="var(--mr-blue)"
              border="1px solid var(--mr-blue-border)"
              borderRadius="var(--mr-radius-sm)"
              px={2}
            >
              {strength}
            </Badge>
          </HStack>
        </HStack>

        <ClaimLinkMiniGraph
          relationship={relationship}
          strength={link.support_level}
          caseClaimLabel={link.case_claim_text}
          sourceClaimLabel={link.source_claim_text}
        />

        <Box>
          <Text fontSize="11px" color="var(--mr-text-muted)" textTransform="uppercase" letterSpacing="0.06em">
            Case claim
          </Text>
          <Text color="var(--mr-text-primary)" fontSize="sm">
            {link.case_claim_text || "No case claim text recorded."}
          </Text>
        </Box>

        <Box>
          <Text fontSize="11px" color="var(--mr-text-muted)" textTransform="uppercase" letterSpacing="0.06em">
            Source claim
          </Text>
          <Text color="var(--mr-text-primary)" fontSize="sm">
            {link.source_claim_text || "No source claim text recorded."}
          </Text>
        </Box>

        <Divider borderColor="var(--mr-glass-border)" />

        <HStack align="start" justify="space-between" spacing={4} flexWrap="wrap">
          <Box>
            <Text fontSize="11px" color="var(--mr-text-muted)" textTransform="uppercase" letterSpacing="0.06em">
              Source
            </Text>
            <Box>
              {link.source_url ? (
                <Link href={link.source_url} isExternal color="var(--mr-blue)" fontSize="sm">
                  {sourceTitle}
                </Link>
              ) : (
                <Text color="var(--mr-text-primary)" fontSize="sm">{sourceTitle}</Text>
              )}
              {link.source_publisher && (
                <Text color="var(--mr-text-muted)" fontSize="xs">
                  {link.source_publisher}
                </Text>
              )}
            </Box>
          </Box>
          <Box maxW={{ base: "100%", md: "55%" }}>
            <Text fontSize="11px" color="var(--mr-text-muted)" textTransform="uppercase" letterSpacing="0.06em">
              Rationale
            </Text>
            <Text color="var(--mr-text-primary)" fontSize="sm">
              {rationale}
            </Text>
          </Box>
        </HStack>
      </VStack>
    </Box>
  );
};

export default ClaimLinkArticleCard;
