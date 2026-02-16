import { HStack, Switch, Text, useColorMode, useBreakpointValue, Tooltip } from "@chakra-ui/react";
import { MoonIcon, SunIcon } from "@chakra-ui/icons";

const ColorModeSwitch = () => {
  const { toggleColorMode, colorMode } = useColorMode();
  const showLabel = useBreakpointValue({ base: false, md: true });

  const isDark = colorMode === "dark";

  return (
    <Tooltip label={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"} hasArrow>
      <HStack spacing={2}>
        <Switch
          colorScheme="purple"
          isChecked={isDark}
          onChange={toggleColorMode}
          size="sm"
        />
        {showLabel ? (
          <Text fontSize="sm" whiteSpace="nowrap">
            {isDark ? "Dark" : "Light"}
          </Text>
        ) : (
          isDark ? <MoonIcon boxSize={3} color="purple.300" /> : <SunIcon boxSize={3} color="yellow.400" />
        )}
      </HStack>
    </Tooltip>
  );
};

export default ColorModeSwitch;
