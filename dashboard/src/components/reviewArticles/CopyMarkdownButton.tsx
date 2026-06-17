import React from "react";
import { Button, useToast } from "@chakra-ui/react";
import { FiCopy } from "react-icons/fi";

interface CopyMarkdownButtonProps {
  markdown: string;
}

const CopyMarkdownButton: React.FC<CopyMarkdownButtonProps> = ({ markdown }) => {
  const toast = useToast();

  const handleCopy = async () => {
    await navigator.clipboard.writeText(markdown);
    toast({ title: "Markdown copied", status: "success", duration: 2500 });
  };

  return (
    <Button className="mr-button" leftIcon={<FiCopy />} onClick={handleCopy}>
      Copy Markdown
    </Button>
  );
};

export default CopyMarkdownButton;
