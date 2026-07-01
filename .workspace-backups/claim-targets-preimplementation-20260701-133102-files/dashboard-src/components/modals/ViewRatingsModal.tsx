import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalCloseButton,
  VStack,
  HStack,
  Box,
  Text,
  Badge,
} from "@chakra-ui/react";
import { PublisherRating } from "../../../../shared/entities/types";
import React from "react";

interface ViewRatingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  ratings: PublisherRating[];
  publisherName?: string;
}

const confidenceColor = (c?: string) => {
  switch (c) {
    case "high":   return "green";
    case "medium": return "yellow";
    case "low":    return "orange";
    default:       return "gray";
  }
};

const biasScheme = (label?: string) => {
  if (!label) return "gray";
  const l = label.toLowerCase();
  if (l.includes("far left"))  return "purple";
  if (l.includes("left"))      return "blue";
  if (l.includes("far right")) return "red";
  if (l.includes("right"))     return "orange";
  if (l.includes("center") || l.includes("least")) return "green";
  return "gray";
};

// ── 3D section title badge ────────────────────────────────────────────────────
const SectionBadge: React.FC<{ children: React.ReactNode; color: string; glow: string; border: string }> = ({
  children, color, glow, border,
}) => (
  <Box
    display="inline-flex"
    alignItems="center"
    px={3}
    py={1}
    mb={3}
    borderRadius="md"
    style={{
      background: `linear-gradient(180deg, ${glow} 0%, rgba(0,0,0,0.3) 100%)`,
      border: `1px solid ${border}`,
      boxShadow: `0 4px 12px rgba(0,0,0,0.5), 0 0 16px ${glow}, inset 0 1px 0 rgba(255,255,255,0.15), inset 0 -1px 0 rgba(0,0,0,0.3)`,
      backdropFilter: "blur(10px)",
    }}
  >
    <Text
      fontSize="xs"
      fontWeight="800"
      textTransform="uppercase"
      letterSpacing="0.14em"
      style={{
        color,
        textShadow: `0 0 10px ${color}, 0 1px 2px rgba(0,0,0,0.8)`,
      }}
    >
      {children}
    </Text>
  </Box>
);

// ── 3D glass rating card ──────────────────────────────────────────────────────
const RatingCard: React.FC<{ accentColor: string; glowColor: string; children: React.ReactNode }> = ({
  accentColor, glowColor, children,
}) => (
  <Box
    position="relative"
    borderRadius="xl"
    p={4}
    overflow="hidden"
    style={{
      background: `linear-gradient(145deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 50%, rgba(0,0,0,0.2) 100%)`,
      border: `1px solid ${accentColor}`,
      boxShadow: `0 8px 32px rgba(0,0,0,0.5), 0 0 20px ${glowColor}, inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -1px 0 rgba(0,0,0,0.2)`,
      backdropFilter: "blur(20px)",
    }}
  >
    {/* Top-left glass highlight */}
    <Box
      position="absolute"
      top={0}
      left={0}
      right={0}
      h="40%"
      borderTopRadius="xl"
      pointerEvents="none"
      style={{
        background: "linear-gradient(180deg, rgba(255,255,255,0.07) 0%, transparent 100%)",
      }}
    />
    {/* Left accent bar */}
    <Box
      position="absolute"
      left={0}
      top="10%"
      bottom="10%"
      w="2px"
      borderRadius="full"
      style={{
        background: `linear-gradient(180deg, transparent, ${accentColor}, transparent)`,
        boxShadow: `0 0 8px ${accentColor}`,
      }}
    />
    <Box position="relative" zIndex={1} pl={2}>
      {children}
    </Box>
  </Box>
);

// ── Veracity score bar (0–100) ────────────────────────────────────────────────
const ScoreBar: React.FC<{ value: number; label: string }> = ({ value, label }) => {
  const pct = Math.min(100, Math.max(0, Math.round(value)));
  const color = pct >= 70 ? "#48bb78" : pct >= 40 ? "#f6ad55" : "#fc8181";
  const glow  = pct >= 70 ? "rgba(72,187,120,0.4)" : pct >= 40 ? "rgba(246,173,85,0.4)" : "rgba(252,129,129,0.4)";
  return (
    <Box w="100%" mt={2}>
      <HStack justify="space-between" mb="3px">
        <Text fontSize="2xs" color="var(--mr-text-muted)" textTransform="uppercase" letterSpacing="0.06em">{label}</Text>
        <Text fontSize="xs" fontWeight="800" style={{ color, textShadow: `0 0 8px ${color}` }}>{pct}%</Text>
      </HStack>
      <Box h="5px" borderRadius="full" overflow="hidden"
        style={{ background: "rgba(255,255,255,0.06)", boxShadow: "inset 0 1px 3px rgba(0,0,0,0.4)" }}>
        <Box h="100%" w={`${pct}%`} borderRadius="full" transition="width 0.5s cubic-bezier(0.4,0,0.2,1)"
          style={{ background: `linear-gradient(90deg, ${color}cc, ${color})`, boxShadow: `0 0 8px ${glow}` }} />
      </Box>
    </Box>
  );
};

// ── Bias bar (−10 … 0 … +10), center-anchored ────────────────────────────────
// value=4 → 40% of the right half; value=-4 → 40% of the left half
const BiasBar: React.FC<{ value: number }> = ({ value }) => {
  const clamped  = Math.max(-10, Math.min(10, value));
  const isLeft   = clamped < 0;
  const isCenter = clamped === 0;
  const fillPct  = `${(Math.abs(clamped) / 10) * 50}%`; // 0–50% of track
  const color    = isCenter ? "#68d391" : isLeft ? "#63b3ed" : "#fc8181";
  const glow     = isCenter ? "rgba(104,211,145,0.4)" : isLeft ? "rgba(99,179,237,0.4)" : "rgba(252,129,129,0.4)";
  const display  = isCenter ? "0" : clamped > 0 ? `+${clamped}` : `${clamped}`;
  return (
    <Box w="100%" mt={2}>
      <HStack justify="space-between" mb="3px">
        <Text fontSize="2xs" color="var(--mr-text-muted)" textTransform="uppercase" letterSpacing="0.06em">Bias</Text>
        <Text fontSize="xs" fontWeight="800" style={{ color, textShadow: `0 0 8px ${color}` }}>{display}</Text>
      </HStack>
      <Box h="5px" borderRadius="full" overflow="hidden" position="relative"
        style={{ background: "rgba(255,255,255,0.06)", boxShadow: "inset 0 1px 3px rgba(0,0,0,0.4)" }}>
        {/* center tick */}
        <Box position="absolute" left="50%" top={0} bottom={0} w="1px"
          style={{ background: "rgba(255,255,255,0.25)", transform: "translateX(-50%)" }} />
        {isLeft ? (
          <Box position="absolute" right="50%" top={0} bottom={0} w={fillPct} borderLeftRadius="full"
            transition="width 0.5s cubic-bezier(0.4,0,0.2,1)"
            style={{ background: `linear-gradient(270deg, ${color}cc, ${color})`, boxShadow: `0 0 8px ${glow}` }} />
        ) : !isCenter ? (
          <Box position="absolute" left="50%" top={0} bottom={0} w={fillPct} borderRightRadius="full"
            transition="width 0.5s cubic-bezier(0.4,0,0.2,1)"
            style={{ background: `linear-gradient(90deg, ${color}cc, ${color})`, boxShadow: `0 0 8px ${glow}` }} />
        ) : null}
      </Box>
    </Box>
  );
};

// ── Modal ─────────────────────────────────────────────────────────────────────
const ViewRatingsModal: React.FC<ViewRatingsModalProps> = ({ isOpen, onClose, ratings, publisherName }) => {
  const sourced     = ratings.filter(r => r.user_id == null);
  const userEntered = ratings.filter(r => r.user_id != null);

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" isCentered scrollBehavior="inside">
      <ModalOverlay bg="rgba(0,0,0,0.45)" backdropFilter="blur(4px)" />
      <ModalContent
        borderRadius="2xl"
        overflow="hidden"
        style={{
          background: "linear-gradient(145deg, rgba(10,16,30,0.98) 0%, rgba(5,8,18,0.99) 100%)",
          border: "1px solid rgba(0,162,255,0.3)",
          boxShadow: "0 0 80px rgba(0,162,255,0.12), 0 32px 64px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.08)",
          backdropFilter: "blur(40px)",
        }}
      >
        <div className="mr-glow-bar mr-glow-bar-blue" />
        <div className="mr-scanlines" />

        <ModalHeader position="sticky" top={0} zIndex={10} pb={2} pt={5}
          style={{
            background: "linear-gradient(145deg, rgba(10,16,30,0.98) 0%, rgba(5,8,18,0.99) 100%)",
            borderBottom: "1px solid rgba(0,162,255,0.12)",
          }}
        >
          <Text className="mr-heading" fontSize="sm" letterSpacing="0.12em" textTransform="uppercase"
            style={{ textShadow: "0 0 20px var(--mr-blue-glow)" }}>
            Publisher Ratings
          </Text>
          {publisherName && (
            <Text fontSize="xs" color="var(--mr-text-muted)" mt="2px" letterSpacing="0.04em">
              {publisherName}
            </Text>
          )}
        </ModalHeader>
        <ModalCloseButton
          color="var(--mr-text-muted)"
          zIndex={10}
          borderRadius="md"
          _hover={{ color: "var(--mr-blue)", bg: "rgba(0,162,255,0.1)" }}
        />

        <ModalBody pb={6} position="relative" zIndex={1}>
          <VStack spacing={4} align="stretch">

            {/* ── Sourced ratings ── */}
            {sourced.length > 0 && (
              <Box>
                <SectionBadge
                  color="var(--mr-blue)"
                  glow="rgba(0,162,255,0.25)"
                  border="rgba(0,162,255,0.4)"
                >
                  Sourced Ratings
                </SectionBadge>
                <VStack spacing={3} align="stretch">
                  {sourced.map((r, i) => (
                    <RatingCard
                      key={i}
                      accentColor="rgba(0,162,255,0.35)"
                      glowColor="rgba(0,162,255,0.08)"
                    >
                      {/* Source name + confidence */}
                      <HStack justify="space-between" mb={2} flexWrap="wrap" gap={1}>
                        <Text
                          fontSize="sm"
                          fontWeight="800"
                          textTransform="uppercase"
                          letterSpacing="0.1em"
                          style={{
                            color: "var(--mr-blue)",
                            textShadow: "0 0 12px rgba(0,162,255,0.6)",
                          }}
                        >
                          {r.source}
                        </Text>
                        {r.confidence && (
                          <Badge
                            colorScheme={confidenceColor(r.confidence)}
                            variant="subtle"
                            fontSize="2xs"
                            px={2}
                          >
                            {r.confidence} confidence
                          </Badge>
                        )}
                      </HStack>

                      {/* Bias label badge */}
                      {r.rating_label && (
                        <HStack mb={1} spacing={2} flexWrap="wrap">
                          <Badge
                            colorScheme={biasScheme(r.rating_label)}
                            fontSize="xs"
                            px={3}
                            py={1}
                            borderRadius="md"
                            style={{
                              boxShadow: "0 2px 8px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.15)",
                            }}
                          >
                            {r.rating_label}
                          </Badge>
                          {r.rating_type && (
                            <Text fontSize="2xs" color="var(--mr-text-muted)" letterSpacing="0.05em">
                              {r.rating_type}
                            </Text>
                          )}
                        </HStack>
                      )}

                      {/* Score bars */}
                      {r.bias_score != null && <BiasBar value={r.bias_score} />}
                      {r.veracity_score != null && (
                        <ScoreBar value={r.veracity_score} label="Veracity score" />
                      )}

                      {/* Evidence quote */}
                      {r.evidence_quote && (
                        <Box
                          mt={3}
                          pl={3}
                          style={{
                            borderLeft: "2px solid rgba(0,162,255,0.4)",
                            boxShadow: "-4px 0 12px rgba(0,162,255,0.08)",
                          }}
                        >
                          <Text
                            fontSize="2xs"
                            color="var(--mr-text-muted)"
                            fontStyle="italic"
                            noOfLines={3}
                            lineHeight="1.6"
                          >
                            "{r.evidence_quote}"
                          </Text>
                        </Box>
                      )}
                    </RatingCard>
                  ))}
                </VStack>
              </Box>
            )}

            {/* Gradient divider */}
            {sourced.length > 0 && userEntered.length > 0 && (
              <Box
                h="1px"
                style={{
                  background: "linear-gradient(90deg, transparent, rgba(139,92,246,0.5), transparent)",
                  boxShadow: "0 0 8px rgba(139,92,246,0.3)",
                }}
              />
            )}

            {/* ── User ratings ── */}
            {userEntered.length > 0 && (
              <Box>
                <SectionBadge
                  color="var(--mr-purple)"
                  glow="rgba(139,92,246,0.25)"
                  border="rgba(139,92,246,0.4)"
                >
                  User Ratings
                </SectionBadge>
                <VStack spacing={2} align="stretch">
                  {userEntered.map((r, i) => (
                    <RatingCard
                      key={i}
                      accentColor="rgba(139,92,246,0.35)"
                      glowColor="rgba(139,92,246,0.08)"
                    >
                      <HStack justify="space-between" flexWrap="wrap" gap={2}>
                        <Text fontSize="xs" fontWeight="700" color="var(--mr-text-primary)">
                          {r.source || "—"}
                          {r.topic_name && (
                            <Text as="span" fontSize="2xs" color="var(--mr-text-muted)" ml={1}>
                              ({r.topic_name})
                            </Text>
                          )}
                        </Text>
                        <HStack spacing={2}>
                          {r.bias_score != null && (
                            <Box
                              px={2}
                              py="2px"
                              borderRadius="md"
                              fontSize="2xs"
                              fontWeight="700"
                              style={{
                                background: "rgba(139,92,246,0.15)",
                                color: "var(--mr-purple)",
                                border: "1px solid rgba(139,92,246,0.4)",
                                boxShadow: "0 2px 8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1)",
                              }}
                            >
                              Bias {r.bias_score.toFixed(1)}
                            </Box>
                          )}
                          {r.veracity_score != null && (
                            <Box
                              px={2}
                              py="2px"
                              borderRadius="md"
                              fontSize="2xs"
                              fontWeight="700"
                              style={{
                                background: "rgba(72,187,120,0.12)",
                                color: "#68d391",
                                border: "1px solid rgba(72,187,120,0.35)",
                                boxShadow: "0 2px 8px rgba(0,0,0,0.3), 0 0 8px rgba(72,187,120,0.1), inset 0 1px 0 rgba(255,255,255,0.1)",
                              }}
                            >
                              Veracity {r.veracity_score.toFixed(1)}
                            </Box>
                          )}
                        </HStack>
                      </HStack>
                    </RatingCard>
                  ))}
                </VStack>
              </Box>
            )}

            {/* Empty state */}
            {ratings.length === 0 && (
              <RatingCard accentColor="rgba(0,162,255,0.2)" glowColor="rgba(0,162,255,0.04)">
                <Text color="var(--mr-text-muted)" fontSize="sm" textAlign="center" py={4}>
                  No ratings yet.
                </Text>
              </RatingCard>
            )}
          </VStack>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
};

export default ViewRatingsModal;
