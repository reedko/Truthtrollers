// Display mode switcher for molecule visualization
import React from "react";
import {
  ButtonGroup,
  Button,
  Tooltip,
  Box,
  Text,
  useColorMode,
} from "@chakra-ui/react";
import type { DisplayMode } from "../services/moleculeViewsAPI";

interface DisplayModeSwitcherProps {
  currentMode: DisplayMode;
  onChange: (mode: DisplayMode) => void;
}

const DisplayModeSwitcher: React.FC<DisplayModeSwitcherProps> = ({
  currentMode,
  onChange,
}) => {
  const { colorMode } = useColorMode();
  console.log("🎛️ DisplayModeSwitcher render with currentMode:", currentMode);

  const modes: Array<{ value: DisplayMode; label: string; icon: string; description: string }> = [
    {
      value: "circles",
      label: "Circles",
      icon: "⚪",
      description: "Simple circles - clean and organized",
    },
    {
      value: "compact",
      label: "Compact",
      icon: "📊",
      description: "Compact cards with key metrics",
    },
    {
      value: "mr_cards",
      label: "Detailed",
      icon: "🎴",
      description: "Full Minority Report style cards",
    },
  ];

  return (
    <Box display="flex" alignItems="center" gap={2}>
      <Text
        fontSize="xs"
        color={colorMode === "dark" ? "gray.400" : "gray.600"}
        textTransform="uppercase"
        letterSpacing="1px"
        whiteSpace="nowrap"
      >
        Display Mode
      </Text>
      <ButtonGroup size="sm" isAttached variant="outline">
        {modes.map((mode) => (
          <Tooltip key={mode.value} label={mode.description} placement="top">
            <Button
              onClick={() => {
                console.log("🎛️ Mode button clicked:", mode.value);
                onChange(mode.value);
              }}
              isActive={currentMode === mode.value}
              _active={colorMode === "dark" ? {
                bg: "rgba(0, 162, 255, 0.2)",
                borderColor: "#00a2ff",
                color: "#00a2ff",
              } : {
                bg: "rgba(71, 85, 105, 0.15)",
                borderColor: "#475569",
                color: "#475569",
              }}
            >
              <span style={{ marginRight: "6px" }}>{mode.icon}</span>
              {mode.label}
            </Button>
          </Tooltip>
        ))}
      </ButtonGroup>
    </Box>
  );
};

export default DisplayModeSwitcher;
