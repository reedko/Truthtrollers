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
  /** NEW: small/medium sizing (default "md") */
  size?: "sm" | "md";
  /** NEW: hide non-essential rows for compact header usage */
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
  const isSm = size === "sm";
  const container = {
    p: isSm ? 3 : 5,
    w: isSm ? "220px" : "250px",
    // if dense we shorten height; otherwise keep your original height
    h: isSm ? (dense ? "210px" : "300px") : dense ? "300px" : "405px",
  };
  const titleFont = isSm ? "sm" : "md";
  const labelFont = isSm ? "xs" : "sm";
  const verimeterGaugeSize = isSm ? { w: 130, h: 70 } : { w: 150, h: 82 };
  const trollGaugeSize = isSm ? { w: 130, h: 70 } : { w: 150, h: 82 };
  const miniGaugeSize = isSm ? { w: 70, h: 58 } : { w: 90, h: 70 };
  const stackSpacing = isSm ? 4 : 6;

  return (
    <Box
      bg="stat2Gradient"
      borderRadius="lg"
      boxShadow="2xl"
      p={container.p}
      w={container.w}
      h={container.h}
      position="relative"
      margin="10px"
    >
      <Center>
        <Text
          fontWeight="bold"
          fontSize={titleFont}
          color="white"
          mb={isSm ? 2 : 3}
        >
          Veracity Gauges
        </Text>
      </Center>
      {loading ? (
        <Center h={`calc(${container.h} - 40px)`}>
          <Spinner color="teal.300" size={isSm ? "md" : "xl"} />
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
            <HStack spacing={isSm ? 4 : 6} mt={isSm ? 2 : 3} justify="center">
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
