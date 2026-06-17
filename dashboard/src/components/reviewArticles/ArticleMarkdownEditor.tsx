import React from "react";
import { Box, FormLabel, Textarea } from "@chakra-ui/react";

interface ArticleMarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
}

const ArticleMarkdownEditor: React.FC<ArticleMarkdownEditorProps> = ({ value, onChange }) => (
  <Box>
    <FormLabel color="cyan.300" fontSize="sm">
      Markdown Article Text
    </FormLabel>
    <Textarea
      className="mr-input"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      minH="620px"
      fontFamily="Menlo, Consolas, monospace"
      fontSize="sm"
      resize="vertical"
    />
  </Box>
);

export default ArticleMarkdownEditor;
