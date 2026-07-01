import { HStack, Switch, Text, useBreakpointValue, Tooltip } from "@chakra-ui/react";
import { ViewIcon, ViewOffIcon } from "@chakra-ui/icons";
import { useUIStore } from "../store/useUIStore";

const HeaderToggleSwitch = () => {
  const isHeaderVisible = useUIStore((s) => s.isHeaderVisible);
  const toggleHeaderVisibility = useUIStore((s) => s.toggleHeaderVisibility);
  const showLabel = useBreakpointValue({ base: false, md: true });

  return (
    <Tooltip label={isHeaderVisible ? "Hide Header" : "Show Header"} hasArrow>
      <HStack spacing={2}>
        <Switch
          colorScheme="cyan"
          isChecked={isHeaderVisible}
          onChange={toggleHeaderVisibility}
          size="sm"
        />
        {showLabel ? (
          <Text fontSize="sm" whiteSpace="nowrap">
            Header
          </Text>
        ) : (
          isHeaderVisible ? <ViewIcon boxSize={3} color="cyan.300" /> : <ViewOffIcon boxSize={3} color="gray.500" />
        )}
      </HStack>
    </Tooltip>
  );
};

export default HeaderToggleSwitch;
