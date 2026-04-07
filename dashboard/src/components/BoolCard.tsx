// src/components/Beacon/BoolCard.tsx
import React, { useEffect, useState } from "react";
import { Box, VStack, HStack, Text, Center, Spinner } from "@chakra-ui/react";
import TruthGauge from "./ModernArcGauge";
import MiniVoteArcGauge from "./MiniVoteArcGauge";
import { tealGaugeTheme } from "./themes/tealGaugeTheme";
import { fetchContentScores } from "../services/useDashboardAPI";
import { useVerimeterMode } from "../contexts/VerimeterModeContext";

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
  // Phase 4: Split scores
  personalVerimeter?: number;
  globalVerimeter?: number;
  delta?: number;
  deltaPercent?: number;
  sentiment?: "more_truthy" | "more_skeptical" | "aligned";
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
  const { mode, aiWeight } = useVerimeterMode();
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
      fetchContentScores(Number(contentId), null, mode, aiWeight)
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
  }, [verimeterScore, trollmeterScore, pro, con, contentId, mode, aiWeight]);

  // Use props if provided, else fetched scores
  const vScore =
    verimeterScore !== undefined
      ? verimeterScore
      : (scores?.verimeterScore ?? 0);
  const tScore =
    trollmeterScore !== undefined
      ? trollmeterScore
      : (scores?.trollmeterScore ?? 0);
  const proScore = pro !== undefined ? pro : (scores?.pro ?? 0);
  const conScore = con !== undefined ? con : (scores?.con ?? 0);
  const totalVotes = proScore + conScore;

  // Phase 4: Split scores
  const personalScore = scores?.personalVerimeter ?? vScore;
  const globalScore = scores?.globalVerimeter ?? vScore;
  const delta = scores?.delta ?? 0;
  const deltaPercent = scores?.deltaPercent ?? 0;
  const sentiment = scores?.sentiment || "aligned";

  const getSentimentMessage = () => {
    if (sentiment === "more_truthy") {
      return `You're ${Math.abs(deltaPercent)}% more truthy than consensus`;
    } else if (sentiment === "more_skeptical") {
      return `You're ${Math.abs(deltaPercent)}% more skeptical than consensus`;
    } else {
      return "Aligned with consensus";
    }
  };

  const getSentimentColor = () => {
    if (sentiment === "more_truthy") return "green.300";
    if (sentiment === "more_skeptical") return "orange.300";
    return "teal.300";
  };

  // ---------- sizing controls ----------
  const isXs = size === "xs";
  const isSm = size === "sm";

  // Parent (UnifiedHeader) should control width; we go full-width inside the slot.
  const container = {
    p: isXs ? 1 : isSm ? 2 : 3,
    w: "100%",
    h: isXs
      ? dense
        ? "130px"
        : "240px"
      : isSm
        ? dense
          ? "210px"
          : "300px"
        : dense
          ? "300px"
          : "405px",
  };

  const titleFont = isXs ? "9px" : isSm ? "xs" : "sm";
  const labelFont = isXs ? "8px" : isSm ? "xs" : "sm";

  // Dial sizes — tiny in xs, extra compact for dense
  const verimeterGaugeSize = isXs
    ? dense
      ? { w: 71, h: 39 }
      : { w: 90, h: 50 }
    : isSm
      ? { w: 130, h: 70 }
      : { w: 150, h: 82 };
  const trollGaugeSize = verimeterGaugeSize;

  const miniGaugeSize = isXs
    ? { w: 64, h: 52 }
    : isSm
      ? { w: 70, h: 58 }
      : { w: 90, h: 70 };

  const stackSpacing = isXs ? (dense ? 1 : 3) : isSm ? 4 : 6;

  return (
    <Box
      className="mr-card mr-card-green"
      p={container.p}
      w={container.w}
      h={container.h}
      position="relative"
      m={0}
      display="flex"
      flexDirection="column"
      justifyContent={dense ? "flex-start" : "space-between"}
    >
      <div className="mr-glow-bar mr-glow-bar-green" />
      <div className="mr-scanlines" />
      <Center mb={dense ? 0 : 1}>
        <Text
          className="mr-badge mr-badge-green"
          fontSize={dense ? "7px" : titleFont}
          mb={0}
          lineHeight={dense ? "1" : "normal"}
        >
          Veracity Gauges
        </Text>
      </Center>

      {loading ? (
        <Center flex="1">
          <Spinner color="teal.300" size={isXs ? "sm" : isSm ? "md" : "xl"} />
        </Center>
      ) : fetchError ? (
        <Center flex="1">
          <Text color="red.400" fontWeight="bold">
            Error: {fetchError}
          </Text>
        </Center>
      ) : dense ? (
        // Dense mode: Simple layout with just Verimeter, centered with spacing
        <Box
          flex="1"
          w="100%"
          display="flex"
          alignItems="center"
          justifyContent="center"
          pb={2}
        >
          <TruthGauge
            score={vScore ?? 0}
            label="VERIMETER"
            size={verimeterGaugeSize}
            dense={true}
          />
        </Box>
      ) : (
        // Normal mode: Full VStack with all gauges
        <VStack
          spacing={stackSpacing}
          flex="1"
          justify="flex-start"
          align="center"
        >
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
            {/* Phase 4: Split score delta */}
            {Math.abs(deltaPercent) > 5 && (
              <Text
                fontSize="2xs"
                textAlign="center"
                color={getSentimentColor()}
                mt={1}
                px={2}
                background="blackAlpha.300"
                borderRadius="md"
              >
                {getSentimentMessage()}
              </Text>
            )}
          </Box>

          {/* Trollmeter */}
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

          {/* Tiny vote gauges */}
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
        </VStack>
      )}
    </Box>
  );
};

export default BoolCard;
