import React from "react";
import {
  Box,
  Heading,
  HStack,
  Select,
  Text,
  useColorMode,
} from "@chakra-ui/react";
import { GraphEntityScope, GraphLinkFilter, useTaskStore } from "../store/useTaskStore";
import { useVerimeterMode } from "../contexts/VerimeterModeContext";

interface GraphControlBarProps {
  title: string;
  showLinkFilter?: boolean;
  showEntityScope?: boolean;
  children?: React.ReactNode;
  metrics?: React.ReactNode;
}

function ControlPill({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const { colorMode } = useColorMode();

  return (
    <Box
      display="flex"
      alignItems="center"
      gap={1.5}
      bg={colorMode === "dark" ? "rgba(15, 23, 42, 0.6)" : "rgba(255, 255, 255, 0.6)"}
      px={2.5}
      py={1}
      borderRadius="full"
      border="1px solid"
      borderColor={colorMode === "dark" ? "rgba(113, 219, 255, 0.2)" : "rgba(71, 85, 105, 0.2)"}
      boxShadow="inset 0 2px 4px rgba(0, 0, 0, 0.15)"
      position="relative"
      zIndex={500}
      flexShrink={0}
    >
      <Text
        className="mr-text-muted"
        fontSize={{ base: "8px", md: "9px", lg: "10px" }}
        textTransform="uppercase"
        letterSpacing="0.5px"
        whiteSpace="nowrap"
        display={{ base: "none", lg: "block" }}
      >
        {label}
      </Text>
      {children}
    </Box>
  );
}

const METRIC_TONES: Record<string, { hex: string; rgb: string }> = {
  cyan: { hex: "#71dbff", rgb: "113, 219, 255" },
  blue: { hex: "#7ba3ff", rgb: "123, 163, 255" },
  purple: { hex: "#b79cff", rgb: "183, 156, 255" },
  green: { hex: "#63f0b0", rgb: "99, 240, 176" },
  red: { hex: "#ff7a7a", rgb: "255, 122, 122" },
};

export function GraphMetricPill({
  label,
  value,
  tone = "cyan",
}: {
  label: string;
  value: React.ReactNode;
  tone?: keyof typeof METRIC_TONES | string;
}) {
  const c = METRIC_TONES[tone] || METRIC_TONES.cyan;
  return (
    <Box
      position="relative"
      overflow="hidden"
      borderRadius="10px"
      px={2.5}
      py={1}
      minH="30px"
      display="flex"
      alignItems="center"
      gap={1.5}
      bg="rgba(8, 22, 58, 0.58)"
      border="1px solid rgba(113, 219, 255, 0.18)"
      boxShadow={`inset 0 0 0 1px rgba(${c.rgb}, 0.08), 0 8px 20px rgba(0, 0, 0, 0.18)`}
      flexShrink={0}
    >
      <Box
        position="absolute"
        left={0}
        top={0}
        width="10px"
        height="100%"
        background={`linear-gradient(90deg, rgba(${c.rgb}, 0.38) 0%, transparent 100%)`}
        pointerEvents="none"
      />
      <Text
        position="relative"
        zIndex={1}
        fontSize="9px"
        textTransform="uppercase"
        letterSpacing="0.04em"
        color="rgba(228, 244, 255, 0.78)"
        lineHeight="1"
        noOfLines={1}
        whiteSpace="nowrap"
      >
        {label}
      </Text>
      <Text
        position="relative"
        zIndex={1}
        fontSize="12px"
        fontWeight="800"
        color={c.hex}
        lineHeight="1"
        noOfLines={1}
        whiteSpace="nowrap"
      >
        {value}
      </Text>
    </Box>
  );
}

export default function GraphControlBar({
  title,
  showLinkFilter = true,
  showEntityScope = false,
  children,
  metrics,
}: GraphControlBarProps) {
  const { colorMode } = useColorMode();
  const { setMode } = useVerimeterMode();
  const graphLinkFilter = useTaskStore((s) => s.graphLinkFilter);
  const setGraphLinkFilter = useTaskStore((s) => s.setGraphLinkFilter);
  const graphEntityScope = useTaskStore((s) => s.graphEntityScope);
  const setGraphEntityScope = useTaskStore((s) => s.setGraphEntityScope);

  const selectSx = {
    bg: colorMode === "dark" ? "rgba(15, 23, 42, 0.9)" : "white",
    border: "1px solid",
    borderColor: colorMode === "dark" ? "var(--mr-blue-border)" : "rgba(71, 85, 105, 0.3)",
    color: colorMode === "dark" ? "var(--mr-text-primary)" : "gray.800",
    borderRadius: "full",
    boxShadow: "inset 0 2px 4px rgba(0, 0, 0, 0.4)",
    height: "30px",
    fontSize: "12px",
  } as const;

  const handleLinkFilterChange = (next: GraphLinkFilter) => {
    setGraphLinkFilter(next);
    if (next === "user") setMode("user");
    if (next === "ai") setMode("ai");
    if (next === "all") setMode("combined");
  };

  return (
    <Box
      className="mr-card mr-card-purple"
      bg="transparent"
      mb={2}
      px={{ base: 2, md: 3 }}
      py={{ base: 1.5, md: 2 }}
      position="relative"
      zIndex={2}
      borderLeftRadius="24px"
      overflowX="visible"
      overflowY="visible"
      sx={{
        "&::before": {
          content: '""',
          position: "absolute",
          left: 0,
          top: 0,
          width: "20px",
          height: "100%",
          background: "linear-gradient(90deg, rgba(113, 219, 255, 0.3) 0%, transparent 100%)",
          borderLeftRadius: "24px",
          pointerEvents: "none",
          zIndex: -1,
        },
      }}
    >
    <HStack
      px={{ base: 1, md: 2 }}
      py={0}
      spacing={{ base: 1.5, md: 2 }}
      alignItems="center"
      justifyContent="flex-start"
      flexWrap="wrap"
    >
      <Heading size={{ base: "xs", md: "sm" }} className="mr-text-primary" whiteSpace="nowrap" flexShrink={0}>
        {title}
      </Heading>

      {showLinkFilter && (
        <ControlPill label="Link Filter">
          <Select
            size="sm"
            width={{ base: "108px", md: "126px" }}
            value={graphLinkFilter}
            onChange={(e) => handleLinkFilterChange(e.target.value as GraphLinkFilter)}
            sx={selectSx}
          >
            <option value="all">All Links</option>
            <option value="user">User Links</option>
            <option value="ai">AI Links</option>
          </Select>
        </ControlPill>
      )}

      {showEntityScope && (
        <ControlPill label="Authors">
          <Select
            size="sm"
            width={{ base: "108px", md: "126px" }}
            value={graphEntityScope}
            onChange={(e) => setGraphEntityScope(e.target.value as GraphEntityScope)}
            sx={selectSx}
          >
            <option value="task">Task Only</option>
            <option value="all">All Sources</option>
          </Select>
        </ControlPill>
      )}

      {children}
      {metrics && (
        <HStack
          spacing={{ base: 1.5, md: 2 }}
          justifyContent="space-evenly"
          alignItems="center"
          flex={{ base: "1 0 100%", xl: "1 1 360px" }}
          minW={{ base: "100%", xl: "360px" }}
          maxW={{ base: "100%", xl: "none" }}
          mt={{ base: 1, xl: 0 }}
          flexWrap="wrap"
          rowGap={1.5}
        >
          {metrics}
        </HStack>
      )}
    </HStack>
    </Box>
  );
}
