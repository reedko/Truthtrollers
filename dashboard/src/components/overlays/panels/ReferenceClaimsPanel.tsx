// src/components/overlays/panels/ReferenceClaimsPanel.tsx
import React from "react";
import { Box, VStack, Text, Badge } from "@chakra-ui/react";
import {
  ReferenceWithClaims,
  Claim,
} from "../../../../../shared/entities/types";
import { useOverlayStore } from "../../../store/useOverlayStore";

export default function ReferenceClaimsPanel({
  reference,
}: {
  reference: ReferenceWithClaims;
}) {
  const open = useOverlayStore((s) => s.open);
  const claims: Claim[] = (reference as any)?.claims ?? [];

  return (
    <VStack align="stretch" spacing={3}>
      {claims.length === 0 ? (
        <Box opacity={0.7}>No claims extracted for this reference yet.</Box>
      ) : (
        claims.map((c) => (
          <Box
            key={c.claim_id}
            borderWidth="1px"
            borderColor="gray.600"
            borderRadius="lg"
            p={3}
          >
            <Text fontSize="sm" noOfLines={8}>
              {c.claim_text}
            </Text>
            <Badge
              mt={2}
              onClick={() => open("verify-claim", { claim: c })}
              cursor="pointer"
              colorScheme="purple"
            >
              Verify
            </Badge>
            <Badge
              mt={2}
              ml={2}
              onClick={() => open("link-claims", { sourceClaim: c })}
              cursor="pointer"
              colorScheme="blue"
            >
              Link
            </Badge>
          </Box>
        ))
      )}
    </VStack>
  );
}
