import React, { useEffect, useState } from "react";
import { Box, Grid, Heading, useColorModeValue } from "@chakra-ui/react";
import {
  fetchClaimsForTask,
  fetchReferencesWithClaimsForTask,
  updateReference,
  deleteReferenceFromTask,
} from "../services/useDashboardAPI";
import TaskClaims from "./TaskClaims";
import ReferenceList from "./ReferenceList";
import { Claim, ReferenceWithClaims } from "../../../shared/entities/types";

const Workspace: React.FC<{ contentId: number }> = ({ contentId }) => {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [references, setReferences] = useState<ReferenceWithClaims[]>([]);
  const [refreshReferences, setRefreshReferences] = useState(false);

  useEffect(() => {
    fetchClaimsForTask(contentId).then(setClaims);
  }, [contentId]);

  useEffect(() => {
    fetchReferencesWithClaimsForTask(contentId).then((data) => {
      console.log("Fetched References:", data); // 🔥 Debugging Log
      setReferences(data);
    });
  }, [contentId, refreshReferences]);

  const handleUpdateReference = async (
    referenceId: number,
    title: string
  ): Promise<void> => {
    await updateReference(title, referenceId);
    setRefreshReferences((prev) => !prev);
  };

  return (
    <Box
      borderWidth="1px"
      borderRadius="lg"
      p={4}
      bg={useColorModeValue("gray.50", "gray.800")}
      borderColor="gray.300"
      height="900px"
    >
      <Heading size="md" mb={2}>
        Claim Analysis
      </Heading>
      <Grid templateColumns="2fr 2fr 2fr" gap={4} height="100%">
        {/* Task Claims Column */}
        <TaskClaims
          claims={claims}
          onAddClaim={(claimText) =>
            setClaims([
              ...claims,
              {
                claim_id: Math.floor(Math.random() * 100000), // Temporary ID
                claim_text: claimText,
                veracity_score: 0,
                confidence_level: 0,
                last_verified: new Date().toISOString(),
                references: [],
              },
            ])
          }
          onEditClaim={(claim) => console.log("Edit claim:", claim)}
          onDeleteClaim={(claimId) =>
            setClaims(claims.filter((claim) => claim.claim_id !== claimId))
          }
          //onDropReferenceClaim={(taskClaimId: number, refClaimId: number) =>
          // console.log(`Link reference ${refClaimId} to task ${taskClaimId}`)
          //}
          taskId={contentId}
        />

        {/* Middle Column: Support/Refutation */}
        <Box> {/* Placeholder for Support/Refute Box */} </Box>

        {/* References Column */}
        <ReferenceList
          references={references}
          onEditReference={handleUpdateReference} // ✅ Now correctly typed
          onDeleteReference={(refId) =>
            deleteReferenceFromTask(contentId, refId)
          }
          taskId={contentId}
        />
      </Grid>
    </Box>
  );
};

export default Workspace;
