import React, { useState } from "react";
import { Button, useToast } from "@chakra-ui/react";
import { FiFileText } from "react-icons/fi";
import { useNavigate } from "react-router-dom";
import { api } from "../../services/api";

interface GeneratePublicReviewButtonProps {
  contentId: number;
}

const GeneratePublicReviewButton: React.FC<GeneratePublicReviewButtonProps> = ({ contentId }) => {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();

  const handleGenerate = async () => {
    try {
      setLoading(true);
      const response = await api.post("/api/review-articles/generate", { content_id: contentId });
      const id = response.data.article.id;
      navigate(`/review-articles/${id}/composer`);
    } catch (error: any) {
      toast({
        title: "Could not generate public review",
        description: error.response?.data?.error || error.message,
        status: "error",
        duration: 5000,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      className="mr-button"
      size="sm"
      leftIcon={<FiFileText />}
      onClick={handleGenerate}
      isLoading={loading}
      loadingText="Generating"
      isDisabled={!contentId}
      position="relative"
      zIndex={500}
    >
      Generate Public Review
    </Button>
  );
};

export default GeneratePublicReviewButton;
