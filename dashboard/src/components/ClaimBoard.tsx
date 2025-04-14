// src/components/ClaimBoard.tsx
import React, { useState } from "react";
import { Box, VStack, useDisclosure, Text, Button } from "@chakra-ui/react";
import { useTaskStore } from "../store/useTaskStore";
import { Claim } from "../../../shared/entities/types";
import ClaimModal from "./modals/ClaimModal";
import ClaimEvaluationModal from "./modals/ClaimEvaluationModal";
import MicroTaskCard from "./MicroTaskCard";

const ClaimBoard: React.FC = () => {
  const allClaims = useTaskStore((s) => s.claimsByTask);
  const tasks = useTaskStore((s) => s.content);
  const selectedTask = useTaskStore((s) => s.selectedTask);
  const claimReferences = useTaskStore((s) => s.claimReferences);

  const [editingClaim, setEditingClaim] = useState<Claim | null>(null);
  const [evaluatingClaim, setEvaluatingClaim] = useState<Claim | null>(null);

  const handleEvalClick = (claim: Claim) => setEvaluatingClaim(claim);

  const visibleTasks = selectedTask
    ? [selectedTask]
    : tasks.filter((t) => allClaims[t.content_id]);

  return (
    <Box
      maxW="100%"
      maxH="850px"
      overflowX="auto"
      border="1px solid"
      borderColor="gray.600"
      borderRadius="md"
      p={1}
      bg="gray.900"
    >
      <Box display="flex" gap={1} maxW="700">
        {visibleTasks.map((task) => {
          const claims = allClaims[task.content_id] || [];

          return (
            <Box
              key={task.content_id}
              minW="200px"
              maxW="250px"
              height="660px"
              overflowY="auto"
              display="flex"
              flexDirection="column"
              position="relative"
              flexShrink={0}
            >
              <Box
                height="200px"
                width="220px"
                bg="gray.800"
                borderRadius="md"
                p={3}
                boxShadow="md"
                position="sticky"
                top={0}
                zIndex={1}
              >
                <Text
                  fontSize="sm"
                  fontWeight="bold"
                  color="teal.300"
                  noOfLines={4}
                >
                  {task.content_name}
                </Text>
              </Box>
              {claims.map((claim) => {
                const refs = claimReferences[claim.claim_id] || [];
                const isEvaluated = refs.length > 0;

                return (
                  <Box
                    key={claim.claim_id}
                    width="220px"
                    height="200px"
                    overflow="auto"
                    flexShrink={0}
                  >
                    <MicroTaskCard
                      title={isEvaluated ? "✅ Evaluated" : "❗ Unevaluated"}
                      description={claim.claim_text}
                      status={isEvaluated ? "complete" : "pending"}
                      //relatedTask={task}
                      actionLabel="Evaluate"
                      actionLink="#"
                      onClick={() => handleEvalClick(claim)}
                    />
                  </Box>
                );
              })}
            </Box>
          );
        })}
      </Box>

      {editingClaim && (
        <ClaimModal
          isOpen={true}
          onClose={() => setEditingClaim(null)}
          editingClaim={editingClaim}
          onSave={() => setEditingClaim(null)}
        />
      )}

      {evaluatingClaim && (
        <ClaimEvaluationModal
          isOpen={true}
          onClose={() => setEvaluatingClaim(null)}
          claim={evaluatingClaim}
          onSaveVerification={() => setEvaluatingClaim(null)}
        />
      )}
    </Box>
  );
};

export default ClaimBoard;
