// Display mode switcher for molecule visualization
import React from "react";
import {
  Box,
  Text,
  Select,
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

  const modes: Array<{ value: DisplayMode; label: string; icon: string }> = [
    {
      value: "circles",
      label: "⚪ Circles",
      icon: "⚪",
    },
    {
      value: "compact",
      label: "📊 Compact",
      icon: "📊",
    },
    {
      value: "mr_cards",
      label: "🎴 Detailed",
      icon: "🎴",
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
      <Select
        size="sm"
        width="150px"
        value={currentMode}
        onChange={(e) => {
          console.log("🎛️ Mode dropdown changed:", e.target.value);
          onChange(e.target.value as DisplayMode);
        }}
        bg={colorMode === "dark" ? "gray.700" : "white"}
      >
        {modes.map((mode) => (
          <option key={mode.value} value={mode.value}>
            {mode.label}
          </option>
        ))}
      </Select>
    </Box>
  );
};

export default DisplayModeSwitcher;
