// TextPadPage.tsx
import React, { useState } from "react";
import {
  Box,
  Button,
  Container,
  Heading,
  Textarea,
  Input,
  VStack,
  useToast,
  Text,
  FormControl,
  FormLabel,
  Card,
  CardBody,
} from "@chakra-ui/react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/useAuthStore";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "https://localhost:5001";

export default function TextPadPage() {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  const handleSubmit = async () => {
    // Prevent double submission
    if (isSubmitting) {
      return;
    }

    if (!text.trim()) {
      toast({
        title: "Text required",
        description: "Please enter some text to analyze",
        status: "warning",
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    // Get user ID from auth store
    if (!user?.user_id) {
      toast({
        title: "Not logged in",
        description: "Please log in to submit text",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/submit-text`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          title: title || "Untitled Text Submission",
          userId: user.user_id,
        }),
      });

      const data = await response.json();

      if (data.success) {
        toast({
          title: "Success!",
          description: "Your text has been submitted and is being analyzed",
          status: "success",
          duration: 4000,
          isClosable: true,
        });

        // Navigate to the task page or molecule view
        setTimeout(() => {
          navigate(`/gamespace?contentId=${data.content_id}`);
        }, 1000);
      } else {
        throw new Error(data.error || "Submission failed");
      }
    } catch (error: any) {
      console.error("Error submitting text:", error);
      toast({
        title: "Submission failed",
        description: error.message || "An error occurred while submitting your text",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Container maxW="container.lg" py={8}>
      <VStack spacing={6} align="stretch">
        <Box>
          <Heading size="lg" mb={2}>
            TextPad
          </Heading>
          <Text color="gray.400">
            Submit any text for fact-checking and evidence analysis. The AI will extract claims
            and find supporting or contradicting evidence.
          </Text>
        </Box>

        <Card bg="rgba(15, 23, 42, 0.6)" borderColor="rgba(99, 102, 241, 0.3)" borderWidth="1px">
          <CardBody>
            <VStack spacing={4} align="stretch">
              <FormControl>
                <FormLabel>Title (optional)</FormLabel>
                <Input
                  placeholder="e.g., Article excerpt, Statement to verify, etc."
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  bg="rgba(15, 23, 42, 0.8)"
                  borderColor="rgba(99, 102, 241, 0.3)"
                  _hover={{ borderColor: "rgba(99, 102, 241, 0.5)" }}
                  _focus={{ borderColor: "rgba(99, 102, 241, 0.7)", boxShadow: "0 0 0 1px rgba(99, 102, 241, 0.7)" }}
                />
              </FormControl>

              <FormControl isRequired>
                <FormLabel>Text to Analyze</FormLabel>
                <Textarea
                  placeholder="Paste or type the text you want to fact-check..."
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  minH="300px"
                  bg="rgba(15, 23, 42, 0.8)"
                  borderColor="rgba(99, 102, 241, 0.3)"
                  _hover={{ borderColor: "rgba(99, 102, 241, 0.5)" }}
                  _focus={{ borderColor: "rgba(99, 102, 241, 0.7)", boxShadow: "0 0 0 1px rgba(99, 102, 241, 0.7)" }}
                  fontFamily="mono"
                />
                <Text fontSize="sm" color="gray.500" mt={2}>
                  {text.length} characters
                </Text>
              </FormControl>

              <Button
                colorScheme="purple"
                size="lg"
                onClick={handleSubmit}
                isLoading={isSubmitting}
                loadingText="Processing..."
                isDisabled={!text.trim()}
              >
                Submit for Analysis
              </Button>
            </VStack>
          </CardBody>
        </Card>

        <Box>
          <Text fontSize="sm" color="gray.500">
            How it works:
          </Text>
          <VStack align="start" mt={2} spacing={1}>
            <Text fontSize="sm" color="gray.400">
              1. The AI extracts factual claims from your text
            </Text>
            <Text fontSize="sm" color="gray.400">
              2. Searches for evidence supporting or contradicting each claim
            </Text>
            <Text fontSize="sm" color="gray.400">
              3. Creates a task card with all findings for your review
            </Text>
          </VStack>
        </Box>
      </VStack>
    </Container>
  );
}
