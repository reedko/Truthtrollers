import React from "react";
import { Checkbox, HStack, Image, Text, Badge, VStack } from "@chakra-ui/react";
import { ReviewArticleModule, moduleLabels } from "./types";

interface ArticleModuleToggleProps {
  module: ReviewArticleModule;
  onToggle: (id: string, enabled: boolean) => void;
}

const ArticleModuleToggle: React.FC<ArticleModuleToggleProps> = ({ module, onToggle }) => (
  <HStack
    className={module.enabled ? "mr-selected" : ""}
    justify="space-between"
    p={3}
    border="1px solid var(--mr-blue-border)"
    borderRadius="var(--mr-radius-sm)"
    bg={module.enabled ? "rgba(0,162,255,0.12)" : "rgba(15,23,42,0.42)"}
    backdropFilter="blur(12px)"
    boxShadow="inset 0 1px 0 rgba(255,255,255,0.08)"
  >
    <Checkbox
      isChecked={module.enabled}
      onChange={(event) => onToggle(module.id, event.target.checked)}
      sx={{
        ".chakra-checkbox__control": {
          borderColor: "var(--mr-blue-border)",
          bg: module.enabled ? "rgba(0,162,255,0.2)" : "rgba(15,23,42,0.55)",
          boxShadow: module.enabled ? "0 0 12px var(--mr-blue-border)" : "none",
        },
      }}
    >
      <HStack align="start" spacing={2}>
        {(module.asset?.image_url || module.asset?.public_image_url) && (
          <Image
            src={module.asset.image_url || module.asset.public_image_url}
            alt={module.asset.alt || module.title}
            boxSize="36px"
            objectFit="cover"
            borderRadius="var(--mr-radius-sm)"
            border="1px solid var(--mr-blue-border)"
          />
        )}
        <VStack align="start" spacing={0}>
          <Text fontSize="sm" color="var(--mr-text-primary)">
            {moduleLabels[module.id] || moduleLabels[module.type] || module.title}
          </Text>
          {module.description && (
            <Text fontSize="xs" color="var(--mr-text-muted)" noOfLines={2}>
              {module.description}
            </Text>
          )}
        </VStack>
      </HStack>
    </Checkbox>
    <Badge
      bg={module.enabled ? "rgba(0,162,255,0.14)" : "rgba(100,116,139,0.14)"}
      color={module.enabled ? "var(--mr-blue)" : "var(--mr-text-muted)"}
      border="1px solid"
      borderColor={module.enabled ? "var(--mr-blue-border)" : "rgba(100,116,139,0.24)"}
    >
      {module.order}
    </Badge>
  </HStack>
);

export default ArticleModuleToggle;
