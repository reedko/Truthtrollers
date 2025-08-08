// components/TrueFalseGame.tsx

import React, { useEffect, useState } from "react";
import { Box, Button, VStack, Text, Heading, HStack } from "@chakra-ui/react";
import { useTaskStore } from "../store/useTaskStore";
import ResultsSummary from "./ResultsSummary";
import {
  fetchClaimsForTask,
  fetchClaimScoresForTask,
  fetchLinkedClaimsForTaskClaim,
} from "../services/useDashboardAPI";

import {
  GameResult,
  LinkedClaim,
  ClaimLink,
  Claim,
} from "../../../shared/entities/types";

const TrueFalseGame: React.FC = () => {
  const taskId = useTaskStore((s) => s.selectedTask?.content_id);
  const viewerId = useTaskStore((s) => s.viewingUserId);

  const [claims, setClaims] = useState<any[]>([]);
  const [claimScores, setClaimScores] = useState<{ [id: number]: number }>({});
  const [selectedClaimId, setSelectedClaimId] = useState<number | null>(null);
  const [lockedIn, setLockedIn] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [userAnswers, setUserAnswers] = useState<{
    [id: number]: boolean | null;
  }>({});
  const [step, setStep] = useState<"quiz" | "results">("quiz");
  const [gameResults, setGameResults] = useState<GameResult[]>([]);

  const handleAnswer = (claimId: number, choice: boolean | null) => {
    if (selectedClaimId !== claimId || lockedIn) {
      setSelectedClaimId(claimId);
      setLockedIn(false);
      setCountdown(1);
    }
    setUserAnswers((prev) => ({ ...prev, [claimId]: choice }));
  };

  useEffect(() => {
    if (countdown === null || lockedIn) return;
    if (countdown === 0) {
      setLockedIn(true);
      setTimeout(() => {
        const currentIndex = claims.findIndex(
          (c) => c.claim_id === selectedClaimId
        );
        const nextClaim = claims[currentIndex + 1];
        if (nextClaim) {
          setSelectedClaimId(nextClaim.claim_id);
          setCountdown(null);
          setLockedIn(false);
        }
      }, 1000);
      return;
    }
    const timer = setTimeout(() => {
      setCountdown((prev) => (prev ?? 1) - 1);
    }, 1000);
    return () => clearTimeout(timer);
  }, [countdown, lockedIn, claims, selectedClaimId]);

  useEffect(() => {
    if (!taskId) return;
    (async () => {
      const fetchedClaims = await fetchClaimsForTask(taskId, viewerId);
      const scores = await fetchClaimScoresForTask(taskId, viewerId);
      setClaims(fetchedClaims);
      setClaimScores(scores);
    })();
  }, [taskId, viewerId]);

  const handleSubmitQuiz = async () => {
    const enrichedResults: GameResult[] = await Promise.all(
      claims.map(async (claim) => {
        const userAnswer = userAnswers[claim.claim_id];
        const verimeter = claimScores[claim.claim_id] ?? 0;
        const correctAnswer =
          verimeter > 0.1 ? true : verimeter < -0.1 ? false : false;
        const isCorrect = userAnswer === correctAnswer;

        const linkedRaw = await fetchLinkedClaimsForTaskClaim(
          claim.claim_id,
          viewerId
        );
        console.log("LinkedRaw:", linkedRaw);
        const references = linkedRaw
          .filter((link) => link.sourceClaim && link.sourceClaim.claim_id)
          .map((link) => {
            const sc = link.sourceClaim;
            return {
              sourceClaim: {
                claim_id: sc.claim_id,
                claim_text: sc.claim_text,
                veracity_score: sc.veracity_score ?? 0,
                confidence_level: sc.confidence_level ?? 0,
                last_verified: sc.last_verified ?? new Date().toISOString(),
              } satisfies Claim,
              confidence: Number(link.confidence) ?? 0,
              notes: link.notes ?? "",
            };
          });

        return {
          question: claim.claim_text,
          userAnswer,
          correctAnswer,
          isCorrect,
          sourceClaim: claim,
          targetClaim: claim,
          claimLink: null,
          references, // ✅ now matches expected GameResult.references shape
        };
      })
    );

    setGameResults(enrichedResults);
    setStep("results");
  };

  if (step === "results") {
    return (
      <ResultsSummary
        results={gameResults}
        onRetry={(missed) => {
          setClaims(missed.map((r) => r.targetClaim));
          setUserAnswers({});
          setStep("quiz");
        }}
        viewerId={viewerId}
      />
    );
  }

  return (
    <VStack spacing={6} align="stretch">
      <Heading mb={4}>True or False?</Heading>
      {claims.map((claim) => (
        <Box key={claim.claim_id} p={4} bg="gray.800" borderRadius="md">
          <Text fontSize="lg" fontWeight="bold">
            {claim.claim_text}
          </Text>

          <HStack mt={2} spacing={4}>
            <Button
              colorScheme="green"
              variant={
                userAnswers[claim.claim_id] === true ? "solid" : "outline"
              }
              onClick={() => handleAnswer(claim.claim_id, true)}
            >
              True
            </Button>

            <Button
              colorScheme="red"
              variant={
                userAnswers[claim.claim_id] === false ? "solid" : "outline"
              }
              onClick={() => handleAnswer(claim.claim_id, false)}
            >
              False
            </Button>

            <Button
              colorScheme="yellow"
              variant={
                userAnswers[claim.claim_id] === null ? "solid" : "outline"
              }
              onClick={() => handleAnswer(claim.claim_id, null)}
            >
              Mixed
            </Button>

            {selectedClaimId === claim.claim_id &&
              countdown !== null &&
              !lockedIn && <Text ml={3}>⏳ {countdown}</Text>}
          </HStack>
        </Box>
      ))}

      <Button colorScheme="blue" onClick={handleSubmitQuiz} alignSelf="center">
        Submit Quiz
      </Button>
    </VStack>
  );
};

export default TrueFalseGame;
