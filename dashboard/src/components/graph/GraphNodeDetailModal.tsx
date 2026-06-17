import React from "react";
import { createPortal } from "react-dom";
import {
  Badge,
  Box,
  Button,
  CloseButton,
  HStack,
  Link,
  Text,
  VStack,
} from "@chakra-ui/react";
import { FiExternalLink } from "react-icons/fi";
import { ReferenceWithClaims } from "../../../../shared/entities/types";
import SourceCrest from "../SourceCrest";
import { normalizeSourceProfile } from "../../utils/normalizeSourceProfile";

export interface GraphNodeDetailSourceClaim {
  id?: string | number;
  label?: string;
  text: string;
  relation?: string;
  rationale?: string;
  sourceName?: string;
  sourceUrl?: string;
  reference?: ReferenceWithClaims;
}

export interface GraphNodeDetailStatus {
  label: string;
  value: React.ReactNode;
  tone?: "cyan" | "green" | "red" | "purple" | "amber" | "gray";
}

interface GraphNodeDetailModalProps {
  isOpen: boolean;
  title: string;
  kicker?: string;
  subtitle?: string;
  caseClaim?: string;
  sourceClaim?: string;
  rationale?: string | null;
  relation?: string;
  detail?: string | null;
  url?: string | null;
  reference?: ReferenceWithClaims | null;
  sourceClaims?: GraphNodeDetailSourceClaim[];
  statusItems?: GraphNodeDetailStatus[];
  onClose: () => void;
  onSourceCrestClick?: (reference: ReferenceWithClaims) => void;
}

const TONES = {
  cyan: { rgb: "113, 219, 255", hex: "#71dbff" },
  green: { rgb: "97, 239, 184", hex: "#61efb8" },
  red: { rgb: "255, 108, 136", hex: "#ff6c88" },
  purple: { rgb: "167, 139, 250", hex: "#a78bfa" },
  amber: { rgb: "251, 191, 36", hex: "#fbbf24" },
  gray: { rgb: "138, 169, 191", hex: "#8aa9bf" },
};

function normalizeRelation(relation?: string) {
  if (!relation) return "Related";
  if (relation === "support" || relation === "supports") return "Supports";
  if (relation === "refute" || relation === "refutes") return "Refutes";
  if (relation === "nuance") return "Qualifies";
  if (relation === "insufficient") return "Insufficient";
  return relation.replace(/_/g, " ");
}

function relationTone(relation?: string): GraphNodeDetailStatus["tone"] {
  if (relation === "support" || relation === "supports") return "green";
  if (relation === "refute" || relation === "refutes") return "red";
  if (relation === "nuance" || relation === "related") return "purple";
  return "cyan";
}

function StatusPill({ item }: { item: GraphNodeDetailStatus }) {
  const tone = TONES[item.tone || "cyan"];
  return (
    <Box
      border="1px solid"
      borderColor={`rgba(${tone.rgb}, 0.34)`}
      bg={`linear-gradient(180deg, rgba(${tone.rgb}, 0.18), rgba(${tone.rgb}, 0.08))`}
      boxShadow={`inset 0 2px 5px rgba(0,0,0,0.55), 0 0 16px rgba(${tone.rgb}, 0.14)`}
      borderRadius="8px"
      px={2.5}
      py={1.5}
      minW="86px"
    >
      <Text fontSize="8px" color="rgba(228,244,255,0.7)" textTransform="uppercase" letterSpacing="0.08em" lineHeight="1">
        {item.label}
      </Text>
      <Text fontSize="12px" fontWeight="800" color={tone.hex} lineHeight="1.2" mt={1} noOfLines={1}>
        {item.value}
      </Text>
    </Box>
  );
}

function DetailBox({
  label,
  children,
  tone = "cyan",
}: {
  label: string;
  children: React.ReactNode;
  tone?: keyof typeof TONES;
}) {
  const c = TONES[tone];
  return (
    <Box
      position="relative"
      border="1px solid"
      borderColor={`rgba(${c.rgb}, 0.24)`}
      bg={`linear-gradient(180deg, rgba(${c.rgb}, 0.10), rgba(3, 10, 24, 0.52))`}
      borderRadius="8px"
      boxShadow={`inset 0 1px 0 rgba(255,255,255,0.05), 0 12px 30px rgba(0,0,0,0.24), 0 0 16px rgba(${c.rgb}, 0.08)`}
      overflow="hidden"
      px={3}
      py={2.5}
    >
      <Box
        position="absolute"
        left={0}
        top={0}
        bottom={0}
        w="16px"
        bg={`linear-gradient(90deg, rgba(${c.rgb}, 0.28), transparent)`}
        pointerEvents="none"
      />
      <Text
        position="relative"
        fontSize="9px"
        fontWeight="900"
        color={c.hex}
        textTransform="uppercase"
        letterSpacing="0.12em"
        mb={1.5}
      >
        {label}
      </Text>
      <Box position="relative" color="var(--mr-text-secondary, #dbeafe)" fontSize="13px" lineHeight="1.55" whiteSpace="pre-wrap">
        {children}
      </Box>
    </Box>
  );
}

export default function GraphNodeDetailModal({
  isOpen,
  title,
  kicker = "Node Detail",
  subtitle,
  caseClaim,
  sourceClaim,
  rationale,
  relation,
  detail,
  url,
  reference,
  sourceClaims = [],
  statusItems = [],
  onClose,
  onSourceCrestClick,
}: GraphNodeDetailModalProps) {
  if (!isOpen) return null;

  const relationLabel = normalizeRelation(relation);
  const effectiveStatusItems = [
    ...(relation ? [{ label: "Relation", value: relationLabel, tone: relationTone(relation) }] : []),
    ...statusItems,
  ];

  return createPortal(
    <Box
      position="fixed"
      inset={0}
      zIndex={2400}
      bg="rgba(0, 6, 18, 0.58)"
      backdropFilter="blur(8px)"
      display="flex"
      alignItems="center"
      justifyContent="center"
      p={{ base: 3, md: 5 }}
      onClick={onClose}
    >
      <Box
        role="dialog"
        aria-modal="true"
        w="min(94vw, 720px)"
        maxH="min(86vh, 760px)"
        overflow="hidden"
        border="1px solid rgba(113, 219, 255, 0.32)"
        borderRadius="10px"
        bg="linear-gradient(145deg, rgba(4, 15, 34, 0.98), rgba(10, 28, 54, 0.96))"
        color="var(--mr-text-primary, #eaf6ff)"
        boxShadow="0 28px 80px rgba(0,0,0,0.62), 0 0 42px rgba(0,162,255,0.18), inset 0 1px 0 rgba(255,255,255,0.08)"
        position="relative"
        onClick={(event) => event.stopPropagation()}
      >
        <Box position="absolute" left={0} top={0} bottom={0} w="24px" bg="linear-gradient(90deg, rgba(113,219,255,0.35), transparent)" />
        <Box position="absolute" inset={0} bg="repeating-linear-gradient(0deg, transparent, transparent 5px, rgba(113,219,255,0.035) 5px, rgba(113,219,255,0.035) 7px)" pointerEvents="none" />

        <Box position="relative" px={{ base: 4, md: 5 }} pt={4} pb={3} borderBottom="1px solid rgba(113,219,255,0.18)">
          <HStack justify="space-between" align="start" spacing={4}>
            <VStack align="start" spacing={2} minW={0}>
              <HStack spacing={3} align="center" wrap="wrap">
                <Text fontSize="10px" fontWeight="900" letterSpacing="0.16em" textTransform="uppercase" color="#71dbff">
                  {kicker}
                </Text>
                {reference && (
                  <SourceCrest
                    {...normalizeSourceProfile({
                      publisher_name: reference.publisher_name,
                      is_primary_source: reference.is_primary_source,
                      media_source: reference.media_source,
                      veracity_score: reference.publisher_veracity ?? undefined,
                      rating_label: reference.rating_label ?? undefined,
                      rating_type: reference.rating_type ?? undefined,
                      admiralty_code: reference.admiralty_code ?? undefined,
                    })}
                    size="sm"
                    onClick={(event) => {
                      event?.stopPropagation();
                      onSourceCrestClick?.(reference);
                    }}
                  />
                )}
              </HStack>
              <Text fontSize={{ base: "18px", md: "22px" }} fontWeight="900" lineHeight="1.2" color="#f4fbff">
                {title}
              </Text>
              {subtitle && (
                <Text fontSize="12px" color="var(--mr-text-muted, #8aa9bf)" lineHeight="1.4">
                  {subtitle}
                </Text>
              )}
            </VStack>
            <CloseButton color="#71dbff" onClick={onClose} />
          </HStack>

          {effectiveStatusItems.length > 0 && (
            <HStack spacing={2} mt={3} wrap="wrap">
              {effectiveStatusItems.map((item, index) => (
                <StatusPill key={`${item.label}-${index}`} item={item} />
              ))}
            </HStack>
          )}
        </Box>

        <VStack
          align="stretch"
          spacing={3}
          position="relative"
          px={{ base: 4, md: 5 }}
          py={4}
          maxH="calc(min(86vh, 760px) - 132px)"
          overflowY="auto"
          sx={{ WebkitOverflowScrolling: "touch" }}
        >
          {caseClaim && (
            <DetailBox label="Case Claim" tone="purple">
              {caseClaim}
            </DetailBox>
          )}

          {sourceClaim && (
            <DetailBox label="Source Claim" tone="green">
              {sourceClaim}
            </DetailBox>
          )}

          {rationale && (
            <DetailBox label="Rationale" tone="amber">
              {rationale}
            </DetailBox>
          )}

          {detail && !caseClaim && !sourceClaim && (
            <DetailBox label="Detail" tone="cyan">
              {detail}
            </DetailBox>
          )}

          {url && (
            <DetailBox label="Link" tone="cyan">
              <Link href={url} isExternal color="#71dbff" fontWeight="800" display="inline-flex" alignItems="center" gap={2} wordBreak="break-all">
                <FiExternalLink size={15} />
                {url}
              </Link>
            </DetailBox>
          )}

          {sourceClaims.length > 0 && (
            <DetailBox label={`Source Claims (${sourceClaims.length})`} tone="green">
              <VStack align="stretch" spacing={2} maxH="260px" overflowY="auto" pr={1}>
                {sourceClaims.map((claim, index) => (
                  <Box
                    key={claim.id ?? index}
                    border="1px solid rgba(97,239,184,0.18)"
                    bg="rgba(3,10,24,0.44)"
                    borderRadius="8px"
                    p={3}
                  >
                    <HStack justify="space-between" align="start" spacing={3} mb={2}>
                      <HStack spacing={2} minW={0}>
                        <Badge bg="rgba(97,239,184,0.14)" color="#61efb8" border="1px solid rgba(97,239,184,0.22)" borderRadius="6px">
                          {claim.label || `S${index + 1}`}
                        </Badge>
                        {claim.relation && (
                          <Badge bg="rgba(113,219,255,0.12)" color="#71dbff" border="1px solid rgba(113,219,255,0.2)" borderRadius="6px">
                            {normalizeRelation(claim.relation)}
                          </Badge>
                        )}
                      </HStack>
                      {claim.reference && (
                        <SourceCrest
                          {...normalizeSourceProfile({
                            publisher_name: claim.reference.publisher_name,
                            is_primary_source: claim.reference.is_primary_source,
                            media_source: claim.reference.media_source,
                            veracity_score: claim.reference.publisher_veracity ?? undefined,
                            rating_label: claim.reference.rating_label ?? undefined,
                            rating_type: claim.reference.rating_type ?? undefined,
                            admiralty_code: claim.reference.admiralty_code ?? undefined,
                          })}
                          size="xs"
                          onClick={(event) => {
                            event?.stopPropagation();
                            onSourceCrestClick?.(claim.reference!);
                          }}
                        />
                      )}
                    </HStack>
                    <Text color="#eaf6ff" fontSize="13px" lineHeight="1.5">
                      {claim.text}
                    </Text>
                    {claim.rationale && (
                      <Text mt={2} color="#fbbf24" fontSize="12px" lineHeight="1.45" fontStyle="italic">
                        {claim.rationale}
                      </Text>
                    )}
                    {(claim.sourceName || claim.sourceUrl) && (
                      <Text mt={2} color="var(--mr-text-muted, #8aa9bf)" fontSize="11px" lineHeight="1.35" noOfLines={2}>
                        {claim.sourceName || claim.sourceUrl}
                      </Text>
                    )}
                  </Box>
                ))}
              </VStack>
            </DetailBox>
          )}

          <Button className="mr-button" alignSelf="stretch" onClick={onClose} size="sm">
            Close
          </Button>
        </VStack>
      </Box>
    </Box>,
    document.body,
  );
}
