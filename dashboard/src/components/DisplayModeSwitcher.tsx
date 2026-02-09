// Display mode switcher for molecule visualization
import React from "react";
import {
  ButtonGroup,
  Button,
  Tooltip,
  Box,
  Text,
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
    <Box>
      <Text fontSize="xs" mb={2} color="gray.500" textTransform="uppercase" letterSpacing="1px">
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
              _active={{
                bg: "rgba(0, 162, 255, 0.2)",
                borderColor: "#00a2ff",
                color: "#00a2ff",
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
