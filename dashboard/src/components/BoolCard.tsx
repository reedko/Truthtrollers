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

  return (
    <Box
      bg="stat2Gradient"
      borderRadius="lg"
      boxShadow="2xl"
      p={5}
      w="250px"
      h="405px"
      position="relative"
      margin="10px"
    >
      <Center>
        <Text fontWeight="bold" fontSize="md" color="white" mb={3}>
          Veracity Gauges
        </Text>
      </Center>
      {loading ? (
        <Center h="340px">
          <Spinner color="teal.300" size="xl" />
        </Center>
      ) : fetchError ? (
        <Center h="340px">
          <Text color="red.400" fontWeight="bold">
            Error: {fetchError}
          </Text>
        </Center>
      ) : (
        <VStack spacing={6}>
          {/* Verimeter */}
          <Box w="100%">
            <Text
              fontSize="sm"
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
                size={{ w: 150, h: 82 }}
              />
            </Center>
          </Box>

          {/* Trollmeter */}
          <Box w="100%">
            <Text
              fontSize="sm"
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
                size={{ w: 150, h: 82 }}
              />
            </Center>
          </Box>

          {/* Tiny vote gauges */}
          <HStack spacing={6} mt={3} justify="center">
            <MiniVoteArcGauge
              label="Agree"
              value={proScore}
              total={totalVotes}
              color={tealGaugeTheme.colors.green}
              size={{ w: 90, h: 70 }}
            />
            <MiniVoteArcGauge
              label="Disagree"
              value={conScore}
              total={totalVotes}
              color={tealGaugeTheme.colors.red}
              size={{ w: 90, h: 70 }}
            />
          </HStack>
        </VStack>
      )}
    </Box>
  );
};

export default BoolCard;
