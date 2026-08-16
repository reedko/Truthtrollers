import React from "react";
import {
  Button,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Portal,
  Text,
} from "@chakra-ui/react";
import { ChevronDownIcon } from "@chakra-ui/icons";
import { Author } from "../../../shared/entities/types";

interface ReferenceAuthorsProps {
  authors?: Author[];
  fallbackName?: string | null;
}

function authorName(author: Author) {
  return [author.author_first_name, author.author_other_name, author.author_last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
}

const ReferenceAuthors: React.FC<ReferenceAuthorsProps> = ({ authors = [], fallbackName }) => {
  const names = authors.map(authorName).filter(Boolean);
  if (names.length === 0 && fallbackName?.trim()) names.push(fallbackName.trim());

  if (names.length <= 1) {
    return (
      <Text as="span" color={names[0] ? "rgba(0,162,255,0.9)" : "rgba(255,255,255,0.3)"}>
        {names[0] || "—"}
      </Text>
    );
  }

  return (
    <Menu placement="bottom-start">
      <MenuButton
        as={Button}
        rightIcon={<ChevronDownIcon />}
        size="xs"
        height="20px"
        px={1.5}
        minW="auto"
        variant="ghost"
        color="rgba(0,162,255,0.9)"
        fontWeight="normal"
        onClick={(event) => event.stopPropagation()}
      >
        {names.length} authors
      </MenuButton>
      <Portal>
        <MenuList minW="220px" zIndex={30000} bg="#07182b" borderColor="rgba(0,162,255,0.35)">
          {names.map((name, index) => (
            <MenuItem key={`${name}-${index}`} bg="#07182b" _hover={{ bg: "rgba(0,162,255,0.16)" }}>
              {name}
            </MenuItem>
          ))}
        </MenuList>
      </Portal>
    </Menu>
  );
};

export default ReferenceAuthors;
