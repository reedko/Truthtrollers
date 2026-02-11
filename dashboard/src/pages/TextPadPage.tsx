// TextPadPage.tsx
import React, { useState, useEffect } from "react";
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
  Spinner,
  Center,
} from "@chakra-ui/react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuthStore } from "../store/useAuthStore";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "https://localhost:5001";

export default function TextPadPage() {
  const [searchParams] = useSearchParams();
  const contentId = searchParams.get("contentId");

  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isViewMode, setIsViewMode] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  // Load existing content if contentId is provided
  useEffect(() => {
    if (contentId) {
      loadContent(parseInt(contentId));
    }
  }, [contentId]);

  const loadContent = async (id: number) => {
    setIsLoading(true);
    try {
      // Fetch content metadata
      const metaResponse = await fetch(`${API_BASE_URL}/api/content/${id}`);
      if (!metaResponse.ok) throw new Error("Failed to load content");

      const metadata = await metaResponse.json();
      setTitle(metadata.content_name || "");

      // Check if this is a TextPad submission
      if (metadata.media_source === "TextPad") {
        // Construct the expected text file path
        const textFilePath = `assets/documents/tasks/content_id_${id}.txt`;

        try {
          // Try to fetch the text file
          const textResponse = await fetch(`${API_BASE_URL}/${textFilePath}`);
          if (!textResponse.ok) throw new Error("Text file not found");

          const textContent = await textResponse.text();
          setText(textContent);
          setIsViewMode(true);

          toast({
            title: "Document loaded",
            description: "Viewing existing TextPad submission",
            status: "info",
            duration: 3000,
            isClosable: true,
          });
        } catch (textError) {
          console.error("Error loading text file:", textError);
          toast({
            title: "Text file not found",
            description: "The original text file could not be loaded",
            status: "warning",
            duration: 3000,
            isClosable: true,
          });
        }
      } else {
        toast({
          title: "Not a TextPad document",
          description: "This content was not created with TextPad",
          status: "warning",
          duration: 3000,
          isClosable: true,
        });
      }
    } catch (error: any) {
      console.error("Error loading content:", error);
      toast({
        title: "Failed to load",
        description: error.message || "Could not load the document",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setIsLoading(false);
    }
  };

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

  if (isLoading) {
    return (
      <Container maxW="container.lg" py={8}>
        <Center minH="60vh">
          <VStack spacing={4}>
            <Spinner size="xl" color="purple.500" />
            <Text color="gray.400">Loading document...</Text>
          </VStack>
        </Center>
      </Container>
    );
  }

  return (
    <Container maxW="container.lg" py={8}>
      <VStack spacing={6} align="stretch">
        <Box>
          <Heading size="lg" mb={2}>
            TextPad {isViewMode && <Text as="span" fontSize="md" color="gray.500">(Viewing)</Text>}
          </Heading>
          <Text color="gray.400">
            {isViewMode
              ? "Viewing your TextPad submission. Edit and resubmit if needed."
              : "Submit any text for fact-checking and evidence analysis. The AI will extract claims and find supporting or contradicting evidence."}
          </Text>
          {isViewMode && (
            <Button
              mt={3}
              size="sm"
              colorScheme="blue"
              onClick={() => {
                navigate("/textpad");
                setIsViewMode(false);
                setText("");
                setTitle("");
              }}
            >
              Create New Document
            </Button>
          )}
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
