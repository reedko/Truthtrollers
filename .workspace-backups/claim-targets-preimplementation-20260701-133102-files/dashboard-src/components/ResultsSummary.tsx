import React, { useState } from "react";
import {
  Box,
  Text,
  VStack,
  HStack,
  Badge,
  Button,
  Grid,
  GridItem,
} from "@chakra-ui/react";
import BoolCard from "./BoolCard";
import ClaimCard from "./ClaimCard";
import { GameResult } from "../../../shared/entities/types";
import { fetchLiveVerimeterScore } from "../services/useDashboardAPI";

interface ResultsSummaryProps {
  results: GameResult[];
  onRetry: (questionsToRetry: GameResult[]) => void;
  viewerId: number | null;
}

const ResultsSummary: React.FC<ResultsSummaryProps> = ({
  results,
  onRetry,
  viewerId,
}) => {
  const [selectedResult, setSelectedResult] = useState<GameResult | null>(null);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const incorrect = results.filter((r) => !r.isCorrect);
  const correctCount = results.length - incorrect.length;
  console.log(results, "RESOUL");
  const cardGradient =
    "radial-gradient(circle at 70% 70%, rgba(72, 187, 215, 0.25), rgba(45, 55, 72, 1))";
  const redCardGradient =
    "radial-gradient(circle at 70% 70%, rgba(255, 80, 80, 0.2), rgba(60, 0, 0, 1))";
  const [verimeterScore, setVerimeterScore] = useState<number | null>(null); //
  return (
    <Box
      p={6}
      borderRadius="2xl"
      bg="linear-gradient(to top right,rgba(0, 100, 90, 1),rgba(0, 0, 0, 1))"
      boxShadow="xl"
      color="white"
    >
      <Text fontSize="2xl" fontWeight="bold" mb={6}>
        You got {correctCount} out of {results.length} right!
      </Text>

      <VStack spacing={4} align="stretch">
        {results.map((res, idx) => (
          <Box
            key={idx}
            p={4}
            borderRadius="lg"
            bg={res.isCorrect ? cardGradient : redCardGradient}
          >
            <Grid templateColumns="1fr auto" alignItems="center">
              <Box>
                <Text fontSize="md" fontWeight="medium">
                  {res.question}
                </Text>
              </Box>
              <VStack spacing={2} align="end" ml={4}>
                <Badge
                  px={2}
                  py={1}
                  borderRadius="md"
                  bg={res.isCorrect ? "#00C9A7" : "#FF4B4B"}
                  color="white"
                >
                  {res.isCorrect ? "Correct" : "Incorrect"}
                </Badge>

                <HStack spacing={2}>
                  <Button
                    size="sm"
                    sx={{
                      bg: cardGradient,
                      color: "white",
                      border: "1px solid rgba(72, 187, 215, 0.6)",
                      _hover: {
                        boxShadow: "0 0 10px rgba(72, 187, 215, 0.7)",
                        transform: "scale(1.05)",
                      },
                      _active: {
                        transform: "scale(0.98)",
                      },
                    }}
                    onClick={async () => {
                      try {
                        const result = await fetchLiveVerimeterScore(
                          res.targetClaim.claim_id,
                          viewerId
                        );
                        if (
                          Array.isArray(result) &&
                          result[0]?.verimeter_score !== undefined
                        ) {
                          setVerimeterScore(result[0].verimeter_score);
                        } else {
                          setVerimeterScore(null);
                        }
                      } catch (err) {
                        console.error(
                          "Error fetching live verimeter score:",
                          err
                        );
                        setVerimeterScore(null);
                      }
                      setSelectedResult(res);
                    }}
                  >
                    Details
                  </Button>

                  {selectedResult === res && (
                    <Button
                      size="sm"
                      variant="outline"
                      colorScheme="gray"
                      onClick={() => setSelectedResult(null)}
                    >
                      Close
                    </Button>
                  )}
                </HStack>
              </VStack>
            </Grid>

            {selectedResult === res && (
              <Box mt={4}>
                <Grid
                  mt={4}
                  templateColumns={["1fr", "1fr 2fr"]}
                  gap={6}
                  alignItems="start"
                >
                  <Box>
                    <BoolCard
                      contentId={res.targetClaim.content_id}
                      verimeterScore={verimeterScore ? verimeterScore * 10 : 0}
                    />
                  </Box>
                  <Box>
                    <Text mb={3} fontSize="md" fontWeight="bold">
                      Supporting & Refuting Claims
                    </Text>
                    <Grid templateColumns={["1fr", "1fr 1fr"]} gap={4}>
                      {res.references?.map((ref, i) => (
                        <ClaimCard
                          key={i}
                          claimId={ref.sourceClaim.claim_id}
                          claimText={ref.sourceClaim.claim_text}
                          supportLevel={ref.confidence}
                          notes={ref.notes || ""}
                          viewerId={viewerId || 1}
                          sourceClaim={ref.sourceClaim}
                          targetClaim={res.targetClaim}
                        />
                      ))}
                    </Grid>
                  </Box>
                </Grid>
              </Box>
            )}
          </Box>
        ))}
      </VStack>

      {incorrect.length > 0 && (
        <Button
          mt={6}
          alignSelf="center"
          sx={{
            bg: redCardGradient,
            color: "white",
            border: "1px solid rgba(255, 80, 80, 0.6)",
            _hover: {
              boxShadow: "0 0 10px rgba(255, 80, 80, 0.7)",
              transform: "scale(1.05)",
            },
            _active: {
              transform: "scale(0.98)",
            },
          }}
          onClick={() => onRetry(incorrect)}
        >
          Retry Missed Questions
        </Button>
      )}
    </Box>
  );
};

export default ResultsSummary;
