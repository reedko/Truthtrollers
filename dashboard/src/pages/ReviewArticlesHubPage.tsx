import React from "react";
import { Box, Button, Container, HStack, Heading, Text, VStack } from "@chakra-ui/react";
import { FiArrowRight, FiFileText } from "react-icons/fi";
import { useNavigate } from "react-router-dom";
import { useTaskStore } from "../store/useTaskStore";
import GeneratePublicReviewButton from "../components/reviewArticles/GeneratePublicReviewButton";

const ReviewArticlesHubPage: React.FC = () => {
  const navigate = useNavigate();
  const selectedTaskId = useTaskStore((s) => s.selectedTaskId);
  const selectedTask = useTaskStore((s) => s.selectedTask);

  return (
    <Box className="mr-container" py={8}>
      <Container className="mr-content" maxW="980px">
        <VStack align="stretch" spacing={5}>
          <Box className="mr-card mr-card-blue" p={6}>
            <HStack spacing={3} mb={2}>
              <Box as={FiFileText} color="var(--mr-blue)" />
              <Heading size="lg" className="mr-heading">
                Public Review Articles
              </Heading>
            </HStack>
            <Text className="mr-text-secondary" maxW="760px">
              Generate editable public VeriStrata articles from completed evidence reviews.
              Articles preserve claim-to-source relationships, rationales, ratings, reviewer
              attribution, and canonical review links for manual external publishing.
            </Text>
          </Box>

          <Box className="mr-card mr-card-purple" p={6}>
            <Heading size="md" className="mr-heading" mb={2}>
              Article Builder
            </Heading>
            {selectedTaskId ? (
              <VStack align="start" spacing={4}>
                <Text className="mr-text-muted" fontSize="sm">
                  Current review: {selectedTask?.content_name || `Content ${selectedTaskId}`}
                </Text>
                <HStack flexWrap="wrap">
                  <GeneratePublicReviewButton contentId={selectedTaskId} />
                  <Button
                    className="mr-button"
                    rightIcon={<FiArrowRight />}
                    onClick={() => navigate(`/workspace/${selectedTaskId}`)}
                  >
                    Open Workspace
                  </Button>
                </HStack>
              </VStack>
            ) : (
              <VStack align="start" spacing={4}>
                <Text className="mr-text-muted" fontSize="sm">
                  Select or open a review in Workspace first, then generate a public article.
                </Text>
                <Button className="mr-button" rightIcon={<FiArrowRight />} onClick={() => navigate("/tasks")}>
                  Choose Content
                </Button>
              </VStack>
            )}
          </Box>
        </VStack>
      </Container>
    </Box>
  );
};

export default ReviewArticlesHubPage;
