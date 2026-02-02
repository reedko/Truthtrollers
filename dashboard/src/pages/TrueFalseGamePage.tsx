import React, { useEffect, useState } from "react";
import { Box, Heading, Text, VStack, Button, useToast } from "@chakra-ui/react";
import { fetchLinkedClaimsForTask } from "../services/useDashboardAPI";
import { useTaskStore } from "../store/useTaskStore";
import UnifiedHeader from "../components/UnifiedHeader";

interface ClaimItem {
  claim_id: number;
  claim_text: string;
  verimeter_score: number | null; // from -1 to 1, used to determine 'true' or 'false'
}

const TrueFalseQuizGame: React.FC = () => {
  const selectedTask = useTaskStore((s) => s.selectedTask);
  const viewerId = useTaskStore((s) => s.viewingUserId);
  const toast = useToast();

  const [claims, setClaims] = useState<ClaimItem[]>([]);
  const [answers, setAnswers] = useState<{ [id: number]: boolean }>({});
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState<number | null>(null);

  useEffect(() => {
    const loadClaims = async () => {
      if (!selectedTask || !viewerId) return;
      const result = await fetchLinkedClaimsForTask(
        selectedTask.content_id,
        viewerId
      );
      setClaims(result);
    };
    loadClaims();
  }, [selectedTask, viewerId]);

  const handleAnswer = (claimId: number, answer: boolean) => {
    if (submitted) return;
    setAnswers((prev) => ({ ...prev, [claimId]: answer }));
  };

  const handleSubmit = () => {
    if (submitted || claims.length === 0) return;
    let correct = 0;
    claims.forEach((claim) => {
      const predictedTrue =
        claim.verimeter_score !== null && claim.verimeter_score > 0;
      if (answers[claim.claim_id] === predictedTrue) correct++;
    });
    setScore(correct);
    setSubmitted(true);
    toast({
      title: "Quiz submitted",
      description: `You scored ${correct} out of ${claims.length}`,
      status: "success",
      duration: 4000,
      isClosable: true,
    });
  };

  return (
    <Box p={6} minH="100vh" bg="gray.950">
      <UnifiedHeader />

      <Box
        mt={6}
        position="relative"
        background="linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))"
        backdropFilter="blur(20px)"
        border="1px solid rgba(0, 162, 255, 0.4)"
        borderRadius="12px"
        boxShadow="0 8px 32px rgba(0, 0, 0, 0.6), 0 0 40px rgba(0, 162, 255, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)"
        overflow="hidden"
        p={6}
      >
        <Box
          position="absolute"
          left={0}
          top={0}
          width="30px"
          height="100%"
          background="linear-gradient(90deg, rgba(0, 162, 255, 0.6) 0%, transparent 100%)"
          pointerEvents="none"
        />
        <VStack spacing={2} align="start" position="relative" zIndex={1}>
          <Heading color="#00a2ff" fontFamily="Futura, 'Century Gothic', sans-serif" letterSpacing="2px">
            TRUE OR FALSE QUIZ
          </Heading>
          <Text color="#f1f5f9" mt={2}>
            Decide whether each claim is TRUE or FALSE based on what you know.
            Your answers will be compared to the TruthTrollers rating database.
          </Text>
        </VStack>
      </Box>

      <VStack spacing={4} align="stretch" mt={8}>
        {claims.map((claim, index) => (
          <Box
            key={claim.claim_id}
            position="relative"
            background="linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))"
            backdropFilter="blur(20px)"
            border="1px solid rgba(0, 162, 255, 0.4)"
            borderRadius="12px"
            boxShadow="0 8px 32px rgba(0, 0, 0, 0.6), 0 0 40px rgba(0, 162, 255, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)"
            overflow="hidden"
            p={4}
          >
            <Box
              position="absolute"
              left={0}
              top={0}
              width="30px"
              height="100%"
              background="linear-gradient(90deg, rgba(0, 162, 255, 0.6) 0%, transparent 100%)"
              pointerEvents="none"
            />
            <VStack align="start" spacing={3} position="relative" zIndex={1}>
              <Text color="#00a2ff" fontWeight="bold" fontSize="lg">
                Claim #{index + 1}:
              </Text>
              <Text color="#f1f5f9" mb={2}>
                {claim.claim_text}
              </Text>
              <VStack spacing={2} width="100%">
                <button
                  className="mr-button"
                  style={{
                    width: "100%",
                    background: answers[claim.claim_id] === true
                      ? "linear-gradient(135deg, rgba(0, 255, 100, 0.3), rgba(0, 255, 100, 0.2))"
                      : undefined,
                    borderColor: answers[claim.claim_id] === true ? "rgba(0, 255, 100, 0.8)" : undefined,
                    opacity: submitted ? 0.6 : 1,
                  }}
                  onClick={() => handleAnswer(claim.claim_id, true)}
                  disabled={submitted}
                >
                  <span style={{ position: "relative", zIndex: 1 }}>✓ TRUE</span>
                </button>
                <button
                  className="mr-button"
                  style={{
                    width: "100%",
                    background: answers[claim.claim_id] === false
                      ? "linear-gradient(135deg, rgba(255, 50, 50, 0.3), rgba(255, 50, 50, 0.2))"
                      : undefined,
                    borderColor: answers[claim.claim_id] === false ? "rgba(255, 50, 50, 0.8)" : undefined,
                    opacity: submitted ? 0.6 : 1,
                  }}
                  onClick={() => handleAnswer(claim.claim_id, false)}
                  disabled={submitted}
                >
                  <span style={{ position: "relative", zIndex: 1 }}>✗ FALSE</span>
                </button>
              </VStack>
            </VStack>
          </Box>
        ))}
      </VStack>

      <Box textAlign="center" mt={10}>
        {!submitted ? (
          <button
            className="mr-button"
            onClick={handleSubmit}
            style={{ padding: "14px 48px", fontSize: "1.1rem" }}
          >
            <span style={{ position: "relative", zIndex: 1 }}>SUBMIT QUIZ</span>
          </button>
        ) : (
          <Box
            position="relative"
            background="linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))"
            backdropFilter="blur(20px)"
            border="1px solid rgba(0, 162, 255, 0.4)"
            borderRadius="12px"
            boxShadow="0 8px 32px rgba(0, 0, 0, 0.6), 0 0 40px rgba(0, 162, 255, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)"
            overflow="hidden"
            p={6}
            display="inline-block"
          >
            <Box
              position="absolute"
              left={0}
              top={0}
              width="30px"
              height="100%"
              background="linear-gradient(90deg, rgba(0, 162, 255, 0.6) 0%, transparent 100%)"
              pointerEvents="none"
            />
            <Text color="#00a2ff" fontSize="2xl" fontWeight="bold" position="relative" zIndex={1}>
              FINAL SCORE: {score} / {claims.length}
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default TrueFalseQuizGame;
