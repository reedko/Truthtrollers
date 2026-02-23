// src/components/DiscussionBoard.tsx
// THE ARENA - Minority Report Style Discussion Board
import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Text,
  VStack,
  Button,
  HStack,
  Badge,
  Flex,
} from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import DiscussionCard from "./DiscussionCard";
import DiscussionComposer from "./DiscussionComposer";
import { Claim, DiscussionEntry } from "../../../shared/entities/types";
import {
  fetchClaimsForTask,
  fetchDiscussionEntries,
} from "../services/useDashboardAPI";
import { useAuthStore } from "../store/useAuthStore";
import { Link as RouterLink } from "react-router-dom";
import { useTaskStore } from "../store/useTaskStore";

interface DiscussionBoardProps {
  contentId: number;
}

// Animations
const pulseGlow = keyframes`
  0%, 100% { box-shadow: 0 0 20px rgba(0, 162, 255, 0.4), 0 0 40px rgba(0, 162, 255, 0.2); }
  50% { box-shadow: 0 0 30px rgba(0, 162, 255, 0.6), 0 0 60px rgba(0, 162, 255, 0.3); }
`;

const floatParticles = keyframes`
  0% { transform: translateY(0) translateX(0); opacity: 0; }
  50% { opacity: 0.6; }
  100% { transform: translateY(-100px) translateX(20px); opacity: 0; }
`;

const slideInLeft = keyframes`
  from { transform: translateX(-100%) rotate(-10deg); opacity: 0; }
  to { transform: translateX(0) rotate(0deg); opacity: 1; }
`;

const slideInRight = keyframes`
  from { transform: translateX(100%) rotate(10deg); opacity: 0; }
  to { transform: translateX(0) rotate(0deg); opacity: 1; }
`;

const energyPulse = keyframes`
  0%, 100% {
    transform: scaleY(1);
    opacity: 0.3;
  }
  50% {
    transform: scaleY(1.2);
    opacity: 0.6;
  }
`;

const DiscussionBoard: React.FC<DiscussionBoardProps> = ({ contentId }) => {
  const [entries, setEntries] = useState<DiscussionEntry[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [linkedClaimId, setLinkedClaimId] = useState<number | null>(null);
  const viewerId = useTaskStore((s) => s.viewingUserId);
  const user = useAuthStore((s) => s.user);
  const readOnly = !user || user.can_post === false;

  useEffect(() => {
    const load = async () => {
      const [allEntries, allClaims] = await Promise.all([
        fetchDiscussionEntries(contentId, viewerId),
        fetchClaimsForTask(contentId, viewerId),
      ]);
      setEntries(allEntries);
      setClaims(allClaims);
    };
    load();
  }, [contentId, viewerId]);

  const handleNewEntry = (entry: DiscussionEntry) =>
    setEntries((prev) => [...prev, entry]);

  // counts per-claim
  const claimCounts = useMemo(() => {
    const map: Record<number, { total: number; pro: number; con: number }> = {};
    for (const c of claims) map[c.claim_id] = { total: 0, pro: 0, con: 0 };
    for (const e of entries) {
      if (!e.linked_claim_id) continue;
      const slot =
        map[e.linked_claim_id] ||
        (map[e.linked_claim_id] = { total: 0, pro: 0, con: 0 });
      slot.total += 1;
      if (e.side === "pro") slot.pro += 1;
      if (e.side === "con") slot.con += 1;
    }
    return map;
  }, [claims, entries]);

  // filtering
  const filteredEntries = entries.filter((e) => {
    if (linkedClaimId === null) return true;
    if (linkedClaimId === -1) return !e.linked_claim_id;
    return e.linked_claim_id === linkedClaimId;
  });
  const proEntries = filteredEntries.filter((e) => e.side === "pro");
  const conEntries = filteredEntries.filter((e) => e.side === "con");

  // summary chips
  const totalReplies = filteredEntries.length;
  const totalSources = new Set(
    filteredEntries.flatMap((e) => e.source_urls || [])
  ).size;

  return (
    <Box
      width="100%"
      minHeight="100vh"
      background="#000000"
      position="relative"
      overflow="hidden"
      pb={8}
    >
      {/* BACKGROUND: Holographic Grid with Perspective */}
      <Box
        position="absolute"
        top={0}
        left={0}
        right={0}
        bottom={0}
        backgroundImage="linear-gradient(rgba(0, 162, 255, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 162, 255, 0.1) 1px, transparent 1px)"
        backgroundSize="50px 50px"
        transform="perspective(1000px) rotateX(60deg)"
        transformOrigin="center top"
        pointerEvents="none"
        zIndex={0}
        opacity={0.3}
      />

      {/* Energy Particles - Support Side (Green) */}
      {[...Array(8)].map((_, i) => (
        <Box
          key={`particle-left-${i}`}
          position="absolute"
          left={`${Math.random() * 20}%`}
          bottom="0"
          width="4px"
          height="4px"
          borderRadius="50%"
          background="rgba(34, 197, 94, 0.8)"
          boxShadow="0 0 10px rgba(34, 197, 94, 0.8)"
          zIndex={1}
          sx={{
            animation: `${floatParticles} ${3 + Math.random() * 3}s linear infinite`,
            animationDelay: `${Math.random() * 2}s`,
          }}
        />
      ))}

      {/* Energy Particles - Refute Side (Red) */}
      {[...Array(8)].map((_, i) => (
        <Box
          key={`particle-right-${i}`}
          position="absolute"
          right={`${Math.random() * 20}%`}
          bottom="0"
          width="4px"
          height="4px"
          borderRadius="50%"
          background="rgba(239, 68, 68, 0.8)"
          boxShadow="0 0 10px rgba(239, 68, 68, 0.8)"
          zIndex={1}
          sx={{
            animation: `${floatParticles} ${3 + Math.random() * 3}s linear infinite`,
            animationDelay: `${Math.random() * 2}s`,
          }}
        />
      ))}

      <Box position="relative" zIndex={2} px={8} pt={8}>
        {/* ========== HOLOGRAPHIC CLAIM TABS ========== */}
        <Box
          mb={8}
          background="rgba(0, 0, 0, 0.6)"
          backdropFilter="blur(20px)"
          border="2px solid rgba(0, 162, 255, 0.4)"
          borderRadius="16px"
          p={4}
          boxShadow="0 8px 32px rgba(0, 0, 0, 0.8), 0 0 40px rgba(0, 162, 255, 0.3)"
          animation={`${pulseGlow} 3s ease-in-out infinite`}
        >
          <Text
            color="#00a2ff"
            fontSize="0.75rem"
            fontWeight="600"
            textTransform="uppercase"
            letterSpacing="3px"
            mb={3}
            textAlign="center"
            textShadow="0 0 10px rgba(0, 162, 255, 0.8)"
          >
            ◈ Select Claim Context ◈
          </Text>

          <Flex gap={3} overflowX="auto" pb={2} justifyContent="center" flexWrap="wrap">
            {/* All Button */}
            <Box
              as="button"
              onClick={() => setLinkedClaimId(null)}
              px={4}
              py={2}
              background={
                linkedClaimId === null
                  ? "linear-gradient(135deg, rgba(0, 162, 255, 0.3), rgba(0, 162, 255, 0.1))"
                  : "rgba(15, 23, 42, 0.6)"
              }
              border={
                linkedClaimId === null
                  ? "2px solid rgba(0, 162, 255, 0.8)"
                  : "1px solid rgba(100, 116, 139, 0.3)"
              }
              borderRadius="10px"
              color={linkedClaimId === null ? "#00a2ff" : "#94a3b8"}
              fontSize="0.85rem"
              fontWeight="600"
              textTransform="uppercase"
              letterSpacing="1px"
              transition="all 0.3s ease"
              _hover={{
                transform: "translateY(-2px)",
                boxShadow: "0 0 20px rgba(0, 162, 255, 0.5)",
                border: "2px solid rgba(0, 162, 255, 0.6)",
              }}
              boxShadow={
                linkedClaimId === null
                  ? "0 0 20px rgba(0, 162, 255, 0.4)"
                  : "0 4px 12px rgba(0, 0, 0, 0.4)"
              }
            >
              🗂️ All Claims
            </Box>

            {/* No Claim Button */}
            <Box
              as="button"
              onClick={() => setLinkedClaimId(-1)}
              px={4}
              py={2}
              background={
                linkedClaimId === -1
                  ? "linear-gradient(135deg, rgba(139, 92, 246, 0.3), rgba(139, 92, 246, 0.1))"
                  : "rgba(15, 23, 42, 0.6)"
              }
              border={
                linkedClaimId === -1
                  ? "2px solid rgba(139, 92, 246, 0.8)"
                  : "1px solid rgba(100, 116, 139, 0.3)"
              }
              borderRadius="10px"
              color={linkedClaimId === -1 ? "#a78bfa" : "#94a3b8"}
              fontSize="0.85rem"
              fontWeight="600"
              textTransform="uppercase"
              letterSpacing="1px"
              transition="all 0.3s ease"
              _hover={{
                transform: "translateY(-2px)",
                boxShadow: "0 0 20px rgba(139, 92, 246, 0.5)",
                border: "2px solid rgba(139, 92, 246, 0.6)",
              }}
              boxShadow={
                linkedClaimId === -1
                  ? "0 0 20px rgba(139, 92, 246, 0.4)"
                  : "0 4px 12px rgba(0, 0, 0, 0.4)"
              }
            >
              ❓ General
            </Box>

            {/* Claim Pills */}
            {claims.map((c) => (
              <Box key={c.claim_id} position="relative">
                <Box
                  as="button"
                  onClick={() => setLinkedClaimId(c.claim_id)}
                  px={4}
                  py={3}
                  background={
                    linkedClaimId === c.claim_id
                      ? "linear-gradient(135deg, rgba(34, 197, 94, 0.3), rgba(34, 197, 94, 0.1))"
                      : "rgba(15, 23, 42, 0.6)"
                  }
                  border={
                    linkedClaimId === c.claim_id
                      ? "2px solid rgba(34, 197, 94, 0.8)"
                      : "1px solid rgba(100, 116, 139, 0.3)"
                  }
                  borderRadius="12px"
                  maxW="300px"
                  transition="all 0.3s ease"
                  _hover={{
                    transform: "translateY(-3px) perspective(500px) rotateX(5deg)",
                    boxShadow: "0 0 30px rgba(34, 197, 94, 0.5)",
                    border: "2px solid rgba(34, 197, 94, 0.6)",
                  }}
                  boxShadow={
                    linkedClaimId === c.claim_id
                      ? "0 0 25px rgba(34, 197, 94, 0.4)"
                      : "0 4px 12px rgba(0, 0, 0, 0.4)"
                  }
                >
                  <Text
                    color={linkedClaimId === c.claim_id ? "#4ade80" : "#cbd5e1"}
                    fontSize="0.8rem"
                    fontWeight="500"
                    noOfLines={2}
                    textAlign="left"
                  >
                    {c.claim_text}
                  </Text>

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
                  />
                </Box>

                {/* Badge Counters */}
                {claimCounts[c.claim_id]?.total > 0 && (
                  <HStack mt={2} spacing={2} justify="center">
                    <Badge
                      colorScheme="blue"
                      fontSize="0.65rem"
                      px={2}
                      borderRadius="6px"
                      background="rgba(59, 130, 246, 0.2)"
                      border="1px solid rgba(59, 130, 246, 0.4)"
                    >
                      {claimCounts[c.claim_id].total} replies
                    </Badge>
                    {claimCounts[c.claim_id]?.pro > 0 && (
                      <Badge
                        colorScheme="green"
                        fontSize="0.65rem"
                        px={2}
                        borderRadius="6px"
                        background="rgba(34, 197, 94, 0.2)"
                        border="1px solid rgba(34, 197, 94, 0.4)"
                      >
                        {claimCounts[c.claim_id].pro} ✓
                      </Badge>
                    )}
                    {claimCounts[c.claim_id]?.con > 0 && (
                      <Badge
                        colorScheme="red"
                        fontSize="0.65rem"
                        px={2}
                        borderRadius="6px"
                        background="rgba(239, 68, 68, 0.2)"
                        border="1px solid rgba(239, 68, 68, 0.4)"
                      >
                        {claimCounts[c.claim_id].con} ✗
                      </Badge>
                    )}
                  </HStack>
                )}
              </Box>
            ))}
          </Flex>
        </Box>

        {/* ========== COMPOSER - Holographic Control Panel ========== */}
        {!readOnly && (
          <Box mb={8}>
            <DiscussionComposer
              contentId={contentId}
              linkedClaimId={
                linkedClaimId && linkedClaimId > 0 ? linkedClaimId : undefined
              }
              onSubmit={handleNewEntry}
            />
          </Box>
        )}

        {readOnly && (
          <Box
            border="2px solid rgba(251, 191, 36, 0.4)"
            background="rgba(251, 191, 36, 0.1)"
            backdropFilter="blur(20px)"
            p={4}
            mb={6}
            borderRadius="12px"
            textAlign="center"
          >
            <Text mb={2} color="#fbbf24" fontWeight="600">
              ⚠️ Read-Only Mode - Login Required
            </Text>
            <Button
              as={RouterLink}
              to="/login"
              size="sm"
              background="linear-gradient(135deg, rgba(251, 191, 36, 0.3), rgba(251, 191, 36, 0.1))"
              border="1px solid rgba(251, 191, 36, 0.6)"
              color="#fbbf24"
              _hover={{
                background: "linear-gradient(135deg, rgba(251, 191, 36, 0.4), rgba(251, 191, 36, 0.2))",
                boxShadow: "0 0 20px rgba(251, 191, 36, 0.4)",
              }}
            >
              Log In to Participate
            </Button>
          </Box>
        )}

        {/* Summary Stats */}
        <HStack mb={6} spacing={4} justify="center">
          <Badge
            fontSize="0.85rem"
            px={4}
            py={2}
            borderRadius="10px"
            background="rgba(139, 92, 246, 0.2)"
            border="1px solid rgba(139, 92, 246, 0.4)"
            color="#a78bfa"
          >
            🔥 {totalReplies} Total Arguments
          </Badge>
          <Badge
            fontSize="0.85rem"
            px={4}
            py={2}
            borderRadius="10px"
            background="rgba(6, 182, 212, 0.2)"
            border="1px solid rgba(6, 182, 212, 0.4)"
            color="#22d3ee"
          >
            🔗 {totalSources} Sources
          </Badge>
        </HStack>

        {/* ========== THE ARENA - Point vs Counterpoint ========== */}
        <Box position="relative">
          {/* Center Energy Divider */}
          <Box
            position="absolute"
            left="50%"
            top="0"
            bottom="0"
            width="4px"
            transform="translateX(-50%)"
            background="linear-gradient(180deg, transparent, rgba(0, 162, 255, 0.6), transparent)"
            boxShadow="0 0 20px rgba(0, 162, 255, 0.8), 0 0 40px rgba(0, 162, 255, 0.4)"
            animation={`${energyPulse} 2s ease-in-out infinite`}
            zIndex={1}
          />

          {/* Arena Grid */}
          <Box
            display="grid"
            gridTemplateColumns="1fr 1fr"
            gap={8}
            position="relative"
            zIndex={2}
          >
            {/* LEFT SIDE - SUPPORT COLUMN */}
            <Box>
              <Box
                mb={4}
                textAlign="center"
                background="linear-gradient(90deg, rgba(34, 197, 94, 0.2), transparent)"
                border="1px solid rgba(34, 197, 94, 0.3)"
                borderRadius="10px"
                p={3}
              >
                <Text
                  fontSize="1.2rem"
                  fontWeight="700"
                  color="#4ade80"
                  textTransform="uppercase"
                  letterSpacing="2px"
                  textShadow="0 0 10px rgba(34, 197, 94, 0.8)"
                >
                  ✓ Supporting Evidence
                </Text>
              </Box>

              <VStack spacing={4} align="stretch">
                {proEntries.map((entry, index) => (
                  <Box
                    key={entry.id}
                    transition="all 0.3s ease"
                    _hover={{
                      transform: "translateX(10px) perspective(500px) rotateY(-5deg) translateZ(10px)",
                    }}
                    sx={{
                      animation: `${slideInLeft} 0.5s ease-out`,
                      animationDelay: `${index * 0.1}s`,
                      animationFillMode: "both",
                    }}
                  >
                    <DiscussionCard entry={entry} />
                  </Box>
                ))}
                {proEntries.length === 0 && (
                  <Text color="#64748b" textAlign="center" py={8} fontStyle="italic">
                    No supporting arguments yet
                  </Text>
                )}
              </VStack>
            </Box>

            {/* RIGHT SIDE - REFUTE COLUMN */}
            <Box>
              <Box
                mb={4}
                textAlign="center"
                background="linear-gradient(90deg, transparent, rgba(239, 68, 68, 0.2))"
                border="1px solid rgba(239, 68, 68, 0.3)"
                borderRadius="10px"
                p={3}
              >
                <Text
                  fontSize="1.2rem"
                  fontWeight="700"
                  color="#f87171"
                  textTransform="uppercase"
                  letterSpacing="2px"
                  textShadow="0 0 10px rgba(239, 68, 68, 0.8)"
                >
                  ✗ Challenging Evidence
                </Text>
              </Box>

              <VStack spacing={4} align="stretch">
                {conEntries.map((entry, index) => (
                  <Box
                    key={entry.id}
                    transition="all 0.3s ease"
                    _hover={{
                      transform: "translateX(-10px) perspective(500px) rotateY(5deg) translateZ(10px)",
                    }}
                    sx={{
                      animation: `${slideInRight} 0.5s ease-out`,
                      animationDelay: `${index * 0.1}s`,
                      animationFillMode: "both",
                    }}
                  >
                    <DiscussionCard entry={entry} />
                  </Box>
                ))}
                {conEntries.length === 0 && (
                  <Text color="#64748b" textAlign="center" py={8} fontStyle="italic">
                    No challenging arguments yet
                  </Text>
                )}
              </VStack>
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default DiscussionBoard;
