import React from "react";
import { Box, Heading, Text, VStack } from "@chakra-ui/react";
import ArticleModuleToggle from "./ArticleModuleToggle";
import { ReviewArticleModule } from "./types";

interface ArticleModuleSidebarProps {
  modules: ReviewArticleModule[];
  onToggle: (id: string, enabled: boolean) => void;
}

const ArticleModuleSidebar: React.FC<ArticleModuleSidebarProps> = ({ modules, onToggle }) => (
  <Box
    className="mr-card mr-card-purple"
    p={4}
    position="sticky"
    top="88px"
  >
    <Heading size="sm" className="mr-heading" mb={1}>
      Article Modules
    </Heading>
    <Text fontSize="xs" className="mr-text-muted" mb={4}>
      Toggle sections for the public article and Substack-ready Markdown.
    </Text>
    <VStack align="stretch" spacing={2}>
      {[...modules]
        .filter((module) => !module.hidden && module.id !== "publisher_admiralty_crests")
        .sort((a, b) => a.order - b.order)
        .map((module) => (
          <ArticleModuleToggle key={module.id} module={module} onToggle={onToggle} />
        ))}
    </VStack>
  </Box>
);

export default ArticleModuleSidebar;
