// src/components/tiles/ScoreTile.tsx
import React from "react";
import { Box, Center, Text, Badge, useBreakpointValue } from "@chakra-ui/react";
import TruthGauge from "../ModernArcGauge";

type Props = {
  value?: number | null; // 0..1
  label?: string; // defaults to "Verimeter"
  compact?: boolean; // even smaller for tight tiles
};

export default function ScoreTile({
  value,
  label = "Verimeter",
  compact = false,
}: Props) {
  const size = useBreakpointValue<{ w: number; h: number }>({
    base: compact ? { w: 84, h: 46 } : { w: 100, h: 56 },
    sm: compact ? { w: 96, h: 52 } : { w: 120, h: 64 },
    md: compact ? { w: 110, h: 58 } : { w: 140, h: 74 },
  });

  const v = typeof value === "number" ? value : 0;
  const pct = typeof value === "number" ? Math.round(v * 100) : null;

  return (
    <Center flexDir="column" gap={compact ? 1 : 2}>
      <Box w="100%" maxW={compact ? "120px" : "160px"}>
        <TruthGauge score={v} label="" size={size!} />
      </Box>

      <Text fontSize={compact ? "lg" : "2xl"} fontWeight="bold" lineHeight="1">
        {pct == null ? "–" : pct}
      </Text>

      <Badge mt={1} colorScheme="purple">
        {label}
      </Badge>
    </Center>
  );
}
