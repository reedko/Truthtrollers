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
      label: "⚪",
      icon: "⚪",
    },
    {
      value: "compact",
      label: "📊",
      icon: "📊",
    },
    {
      value: "mr_cards",
      label: "🎴",
      icon: "🎴",
    },
  ];

  return (
    <Box
      display="flex"
      alignItems="center"
      gap={{ base: 0.5, md: 1 }}
      bg={colorMode === "dark" ? "rgba(15, 23, 42, 0.6)" : "rgba(255, 255, 255, 0.6)"}
      px={{ base: 1.5, md: 2 }}
      py={{ base: 0.5, md: 1 }}
      borderRadius="full"
      border="1px solid"
      borderColor={colorMode === "dark" ? "rgba(113, 219, 255, 0.2)" : "rgba(71, 85, 105, 0.2)"}
      boxShadow="inset 0 2px 4px rgba(0, 0, 0, 0.15)"
    >
      <Text
        className="mr-text-muted"
        fontSize={{ base: "8px", md: "9px", lg: "10px" }}
        textTransform="uppercase"
        letterSpacing="0.3px"
        whiteSpace="nowrap"
        display={{ base: "none", lg: "block" }}
      >
        Display
      </Text>
      <Select
        size="xs"
        width={{ base: "75px", md: "90px", lg: "110px" }}
        fontSize={{ base: "9px", md: "10px", lg: "11px" }}
        height={{ base: "20px", md: "24px" }}
        value={currentMode}
        onChange={(e) => {
          console.log("🎛️ Mode dropdown changed:", e.target.value);
          onChange(e.target.value as DisplayMode);
        }}
        bg={colorMode === "dark" ? "rgba(15, 23, 42, 0.9)" : "white"}
        border="1px solid"
        borderColor={colorMode === "dark" ? "var(--mr-blue-border)" : "rgba(71, 85, 105, 0.3)"}
        color={colorMode === "dark" ? "var(--mr-text-primary)" : "gray.800"}
        borderRadius="full"
        boxShadow="inset 0 2px 4px rgba(0, 0, 0, 0.4)"
        _hover={{
          borderColor: colorMode === "dark" ? "var(--mr-blue)" : "rgba(71, 85, 105, 0.5)",
        }}
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
