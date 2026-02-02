import { HStack, Switch, Text } from "@chakra-ui/react";
import { useUIStore } from "../store/useUIStore";

const HeaderToggleSwitch = () => {
  const isHeaderVisible = useUIStore((s) => s.isHeaderVisible);
  const toggleHeaderVisibility = useUIStore((s) => s.toggleHeaderVisibility);

  return (
    <HStack>
      <Switch
        colorScheme="cyan"
        isChecked={isHeaderVisible}
        onChange={toggleHeaderVisibility}
      />
      <Text whiteSpace="nowrap">Header</Text>
    </HStack>
  );
};

export default HeaderToggleSwitch;
