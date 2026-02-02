// src/components/Beacon/BoolCard.tsx
import React, { useEffect, useState } from "react";
import { Box, VStack, HStack, Text, Center, Spinner } from "@chakra-ui/react";
import TruthGauge from "./ModernArcGauge";
import MiniVoteArcGauge from "./MiniVoteArcGauge";
import { tealGaugeTheme } from "./themes/tealGaugeTheme";
import { fetchContentScores } from "../services/useDashboardAPI";

interface BoolCardProps {
  verimeterScore?: number | null;
  trollmeterScore?: number;
  pro?: number;
  con?: number;
  contentId?: number | string;
  /** NEW: extra small for phones */
  size?: "xs" | "sm" | "md";
  /** Hide non-essential rows for compact header usage */
  dense?: boolean;
}

type Scores = {
  verimeterScore: number;
  trollmeterScore: number;
  pro: number;
  con: number;
  contentId: number;
};

const BoolCard: React.FC<BoolCardProps> = ({
  verimeterScore,
  trollmeterScore,
  pro,
  con,
  contentId,
  size = "md",
  dense = false,
}) => {
  const [scores, setScores] = useState<Scores | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // If no scores are provided, but contentId is, fetch them
  useEffect(() => {
    let ignore = false;
    if (
      verimeterScore === undefined &&
      trollmeterScore === undefined &&
      pro === undefined &&
      con === undefined &&
      contentId
    ) {
      setLoading(true);
      setFetchError(null);
      fetchContentScores(Number(contentId), null)
        .then((data) => {
          if (!ignore) setScores(data);
        })
        .catch((err) => {
          if (!ignore) setFetchError(err.message || "Failed to load scores");
        })
        .finally(() => {
          if (!ignore) setLoading(false);
        });
    }
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line
  }, [verimeterScore, trollmeterScore, pro, con, contentId]);

  // Use props if provided, else fetched scores
  const vScore =
    verimeterScore !== undefined ? verimeterScore : scores?.verimeterScore ?? 0;
  const tScore =
    trollmeterScore !== undefined
      ? trollmeterScore
      : scores?.trollmeterScore ?? 0;
  const proScore = pro !== undefined ? pro : scores?.pro ?? 0;
  const conScore = con !== undefined ? con : scores?.con ?? 0;
  const totalVotes = proScore + conScore;

  // ---------- sizing controls ----------
  const isXs = size === "xs";
  const isSm = size === "sm";

  // Parent (UnifiedHeader) should control width; we go full-width inside the slot.
  const container = {
    p: isXs ? 2 : isSm ? 3 : 5,
    w: "100%",
    h: isXs
      ? dense
        ? "190px"
        : "240px"
      : isSm
      ? dense
        ? "210px"
        : "300px"
      : dense
      ? "300px"
      : "405px",
  };

  const titleFont = isXs ? "xs" : isSm ? "sm" : "md";
  const labelFont = isXs ? "xs" : isSm ? "xs" : "sm";

  // Dial sizes — tiny in xs
  const verimeterGaugeSize = isXs
    ? { w: 90, h: 50 }
    : isSm
    ? { w: 130, h: 70 }
    : { w: 150, h: 82 };
  const trollGaugeSize = verimeterGaugeSize;

  const miniGaugeSize = isXs
    ? { w: 64, h: 52 }
    : isSm
    ? { w: 70, h: 58 }
    : { w: 90, h: 70 };

  const stackSpacing = isXs ? 3 : isSm ? 4 : 6;

  return (
    <Box
      className="mr-card mr-card-green"
      p={container.p}
      w={container.w}
      h={container.h}
      position="relative"
      m={0}
    >
      <div className="mr-glow-bar mr-glow-bar-green" />
      <div className="mr-scanlines" />
      <Center>
        <Text
          className="mr-badge mr-badge-green"
          fontSize={titleFont}
          mb={isXs ? 1 : isSm ? 2 : 3}
        >
          Veracity Gauges
        </Text>
      </Center>

      {loading ? (
        <Center h={`calc(${container.h} - 40px)`}>
          <Spinner color="teal.300" size={isXs ? "sm" : isSm ? "md" : "xl"} />
        </Center>
      ) : fetchError ? (
        <Center h={`calc(${container.h} - 40px)`}>
          <Text color="red.400" fontWeight="bold">
            Error: {fetchError}
          </Text>
        </Center>
      ) : (
        <VStack spacing={stackSpacing}>
          {/* Verimeter */}
          <Box w="100%">
            <Text
              fontSize={labelFont}
              fontWeight="semibold"
              color={tealGaugeTheme.colors.parchment}
              mb={1}
              textAlign="center"
              background="whiteAlpha.200"
              borderRadius="md"
              px={2}
            >
              Expert Rating
            </Text>
            <Center>
              <TruthGauge
                score={vScore ?? 0}
                label="VERIMETER"
                size={verimeterGaugeSize}
              />
            </Center>
          </Box>

          {/* Trollmeter (hidden in dense mode) */}
          {!dense && (
            <Box w="100%">
              <Text
                fontSize={labelFont}
                fontWeight="semibold"
                color={tealGaugeTheme.colors.parchment}
                mb={1}
                textAlign="center"
                background="whiteAlpha.200"
                borderRadius="md"
                px={2}
              >
                Popular Vote
              </Text>
              <Center>
                <TruthGauge
                  score={tScore}
                  label="TROLLMETER"
                  size={trollGaugeSize}
                />
              </Center>
            </Box>
          )}

          {/* Tiny vote gauges (hidden in dense mode) */}
          {!dense && (
            <HStack
              spacing={isXs ? 3 : isSm ? 4 : 6}
              mt={isXs ? 1 : isSm ? 2 : 3}
              justify="center"
            >
              <MiniVoteArcGauge
                label="Agree"
                value={proScore}
                total={totalVotes}
                color={tealGaugeTheme.colors.green}
                size={miniGaugeSize}
              />
              <MiniVoteArcGauge
                label="Disagree"
                value={conScore}
                total={totalVotes}
                color={tealGaugeTheme.colors.red}
                size={miniGaugeSize}
              />
            </HStack>
          )}
        </VStack>
      )}
    </Box>
  );
};

export default BoolCard;
