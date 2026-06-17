import React from "react";
import { Badge, Box, HStack, Link, Text, VStack } from "@chakra-ui/react";
import { ClaimLinkArticleData } from "./types";

interface PublicationEvidenceMapProps {
  claimLinks?: ClaimLinkArticleData[];
  canonicalUrl?: string | null;
}

const toneForRelationship = (relationship?: string) => {
  const rel = (relationship || "unclear").toLowerCase();
  if (rel === "supports") return { stroke: "#22c55e", bg: "rgba(34,197,94,0.14)", label: "Supports" };
  if (rel === "refutes") return { stroke: "#f87171", bg: "rgba(248,113,113,0.14)", label: "Refutes" };
  if (rel === "qualifies") return { stroke: "#fbbf24", bg: "rgba(251,191,36,0.14)", label: "Qualifies" };
  return { stroke: "#94a3b8", bg: "rgba(148,163,184,0.14)", label: "Unclear" };
};

const truncate = (value?: string | null, max = 64) => {
  const clean = (value || "").trim();
  if (!clean) return "Claim";
  return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean;
};

const PublicationEvidenceMap: React.FC<PublicationEvidenceMapProps> = ({ claimLinks = [], canonicalUrl }) => {
  const links = claimLinks.slice(0, 6);

  return (
    <Box className="mr-card mr-card-blue" p={4}>
      <VStack align="stretch" spacing={3}>
        <HStack justify="space-between" align="start">
          <Box>
            <Text fontSize="xs" color="var(--mr-blue)" textTransform="uppercase" letterSpacing="0.08em">
              Evidence Map Snapshot
            </Text>
            <Text color="var(--mr-text-muted)" fontSize="sm">
              Claim-to-source links selected for publication
            </Text>
          </Box>
          <Badge
            bg="rgba(0,162,255,0.12)"
            color="var(--mr-blue)"
            border="1px solid var(--mr-blue-border)"
            borderRadius="var(--mr-radius-sm)"
          >
            {claimLinks.length} links
          </Badge>
        </HStack>

        <Box position="relative" minH={`${Math.max(links.length, 1) * 72}px`} overflow="hidden">
          <svg width="100%" height={Math.max(links.length, 1) * 72} viewBox={`0 0 720 ${Math.max(links.length, 1) * 72}`} preserveAspectRatio="none">
            {links.map((link, index) => {
              const y = 36 + index * 72;
              const tone = toneForRelationship(link.relationship);
              return (
                <g key={link.id || link.claim_link_id || index}>
                  <line x1="210" y1={y} x2="510" y2={y} stroke={tone.stroke} strokeWidth="2" strokeDasharray={link.relationship === "unclear" ? "6 6" : "0"} opacity="0.85" />
                  <circle cx="210" cy={y} r="7" fill={tone.stroke} opacity="0.9" />
                  <circle cx="510" cy={y} r="7" fill={tone.stroke} opacity="0.9" />
                </g>
              );
            })}
          </svg>

          <VStack position="absolute" inset={0} align="stretch" spacing={2}>
            {links.length ? links.map((link, index) => {
              const tone = toneForRelationship(link.relationship);
              return (
                <HStack key={link.id || link.claim_link_id || index} h="64px" spacing={3}>
                  <Box flex="1" p={2} border="1px solid var(--mr-blue-border)" bg="rgba(0,162,255,0.08)" borderRadius="var(--mr-radius-sm)">
                    <Text fontSize="10px" color="var(--mr-blue)" textTransform="uppercase">Case</Text>
                    <Text fontSize="xs" color="var(--mr-text-primary)" noOfLines={2}>{truncate(link.case_claim_text)}</Text>
                  </Box>
                  <Badge minW="88px" textAlign="center" justifyContent="center" bg={tone.bg} color={tone.stroke} border={`1px solid ${tone.stroke}`} borderRadius="var(--mr-radius-sm)">
                    {tone.label}
                  </Badge>
                  <Box flex="1" p={2} border="1px solid var(--mr-green-border)" bg="rgba(34,197,94,0.08)" borderRadius="var(--mr-radius-sm)">
                    <Text fontSize="10px" color="var(--mr-green)" textTransform="uppercase">Source</Text>
                    <Text fontSize="xs" color="var(--mr-text-primary)" noOfLines={2}>{truncate(link.source_claim_text)}</Text>
                  </Box>
                </HStack>
              );
            }) : (
              <Text color="var(--mr-text-muted)" fontSize="sm">No user-created claim links are available for the snapshot.</Text>
            )}
          </VStack>
        </Box>

        {canonicalUrl && (
          <Link href={canonicalUrl} color="var(--mr-blue)" fontSize="sm">
            Open live evidence map
          </Link>
        )}
      </VStack>
    </Box>
  );
};

export default PublicationEvidenceMap;
