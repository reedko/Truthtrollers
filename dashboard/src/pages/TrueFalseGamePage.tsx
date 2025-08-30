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

      <Box mt={6} bg="gray.900" p={6} borderRadius="xl">
        <Heading color="teal.300">🧠 True or False Quiz</Heading>
        <Text color="gray.400" mt={2}>
          Decide whether each claim is TRUE or FALSE based on what you know.
          Your answers will be compared to the TruthTrollers rating database.
        </Text>
      </Box>

      <VStack spacing={4} align="stretch" mt={8}>
        {claims.map((claim, index) => (
          <Box
            key={claim.claim_id}
            bg="gray.800"
            p={4}
            borderRadius="md"
            borderLeft="6px solid teal"
          >
            <Text color="teal.200" fontWeight="bold">
              Claim #{index + 1}:
            </Text>
            <Text color="white" mb={3}>
              {claim.claim_text}
            </Text>
            <VStack spacing={2} direction="row">
              <Button
                colorScheme="green"
                variant={answers[claim.claim_id] === true ? "solid" : "outline"}
                onClick={() => handleAnswer(claim.claim_id, true)}
                isDisabled={submitted}
              >
                ✅ True
              </Button>
              <Button
                colorScheme="red"
                variant={
                  answers[claim.claim_id] === false ? "solid" : "outline"
                }
                onClick={() => handleAnswer(claim.claim_id, false)}
                isDisabled={submitted}
              >
                ❌ False
              </Button>
            </VStack>
          </Box>
        ))}
      </VStack>

      <Box textAlign="center" mt={10}>
        {!submitted ? (
          <Button colorScheme="teal" size="lg" onClick={handleSubmit}>
            Submit Quiz
          </Button>
        ) : (
          <Text color="teal.200" fontSize="xl">
            🎉 Final Score: {score} / {claims.length}
          </Text>
        )}
      </Box>
    </Box>
  );
};

export default TrueFalseQuizGame;
