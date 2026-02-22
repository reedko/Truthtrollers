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
  Progress,
  HStack,
  Badge,
} from "@chakra-ui/react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuthStore } from "../store/useAuthStore";
import { useTaskStore } from "../store/useTaskStore";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "https://localhost:5001";

export default function TextPadPage() {
  const [searchParams] = useSearchParams();
  const contentId = searchParams.get("contentId");

  const [title, setTitle] = useState("");
  const [text, setText] = useState("");

  // Listen for tour fill events
  useEffect(() => {
    const fillTitle = (e: Event) => setTitle((e as CustomEvent).detail.title);
    const fillText = (e: Event) => setText((e as CustomEvent).detail.text);
    window.addEventListener("tourFillTitle", fillTitle);
    window.addEventListener("tourFillText", fillText);
    return () => {
      window.removeEventListener("tourFillTitle", fillTitle);
      window.removeEventListener("tourFillText", fillText);
    };
  }, []);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [submitProgress, setSubmitProgress] = useState<{ message: string; percent: number; stage: string } | null>(null);
  const [isViewMode, setIsViewMode] = useState(false);
  const [currentTask, setCurrentTask] = useState<any>(null);
  const toast = useToast();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const setSelectedTask = useTaskStore((s) => s.setSelectedTask);

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
      setCurrentTask(metadata);

      // Set this task as the selected task
      setSelectedTask(metadata);

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

  const handleGoToWorkspace = () => {
    if (currentTask) {
      setSelectedTask(currentTask);
      navigate("/workspace");
    }
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;

    if (!text.trim()) {
      toast({ title: "Text required", description: "Please enter some text to analyze", status: "warning", duration: 3000, isClosable: true });
      return;
    }
    if (!user?.user_id) {
      toast({ title: "Not logged in", description: "Please log in to submit text", status: "error", duration: 3000, isClosable: true });
      return;
    }

    setIsSubmitting(true);
    setSubmitProgress({ stage: "setup", message: "Starting…", percent: 0 });

    try {
      const response = await fetch(`${API_BASE_URL}/api/submit-text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, title: title || "Untitled Text Submission", userId: user.user_id }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`Server error: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let contentId: number | null = null;
      let documentPath: string | null = null;
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // keep incomplete line in buffer

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.stage === "error") {
              throw new Error(event.message);
            }
            setSubmitProgress({ stage: event.stage, message: event.message, percent: event.percent });
            if (event.stage === "done") {
              contentId = event.content_id;
              documentPath = event.document_path;
            }
          } catch (parseErr) {
            // ignore malformed lines
          }
        }
      }

      if (contentId) {
        const taskResponse = await fetch(`${API_BASE_URL}/api/content/${contentId}`);
        if (taskResponse.ok) {
          const taskData = await taskResponse.json();
          setSelectedTask(taskData);
        }
        toast({ title: "Analysis complete!", description: "Your text has been processed.", status: "success", duration: 4000, isClosable: true });
        setTimeout(() => navigate(`/textpad?contentId=${contentId}`), 800);
      }
    } catch (error: any) {
      console.error("Error submitting text:", error);
      toast({ title: "Submission failed", description: error.message || "An error occurred", status: "error", duration: 5000, isClosable: true });
    } finally {
      setIsSubmitting(false);
      setSubmitProgress(null);
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
          <Heading size="lg" mb={2} className="textpad-title">
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
                <FormLabel>Title {isViewMode && "(Read-only)"}</FormLabel>
                <Input
                  className="textpad-title-input"
                  placeholder="e.g., Article excerpt, Statement to verify, etc."
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  bg={isViewMode ? "rgba(15, 23, 42, 0.5)" : "rgba(15, 23, 42, 0.8)"}
                  color="white"
                  _placeholder={{ color: "gray.400" }}
                  borderColor="rgba(99, 102, 241, 0.3)"
                  _hover={{ borderColor: "rgba(99, 102, 241, 0.5)" }}
                  _focus={{ borderColor: "rgba(99, 102, 241, 0.7)", boxShadow: "0 0 0 1px rgba(99, 102, 241, 0.7)" }}
                  isReadOnly={isViewMode}
                  cursor={isViewMode ? "default" : "text"}
                />
              </FormControl>

              <FormControl isRequired>
                <FormLabel>Text to Analyze</FormLabel>
                <Textarea
                  placeholder="Paste or type the text you want to fact-check..."
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  minH="300px"
                  bg={isViewMode ? "rgba(15, 23, 42, 0.5)" : "rgba(15, 23, 42, 0.8)"}
                  color="white"
                  _placeholder={{ color: "gray.400" }}
                  borderColor="rgba(99, 102, 241, 0.3)"
                  _hover={{ borderColor: "rgba(99, 102, 241, 0.5)" }}
                  _focus={{ borderColor: "rgba(99, 102, 241, 0.7)", boxShadow: "0 0 0 1px rgba(99, 102, 241, 0.7)" }}
                  fontFamily="mono"
                  className="textpad-textarea"
                  isReadOnly={isViewMode}
                  cursor={isViewMode ? "default" : "text"}
                />
                <Text fontSize="sm" color="gray.500" mt={2}>
                  {text.length} characters {isViewMode && "(Read-only)"}
                </Text>
              </FormControl>

              {isViewMode ? (
                <VStack spacing={3} w="100%">
                  <Button
                    className="textpad-evaluate-button"
                    colorScheme="teal"
                    size="lg"
                    onClick={handleGoToWorkspace}
                    w="100%"
                    leftIcon={<span>📊</span>}
                  >
                    Evaluate in Workspace
                  </Button>
                  <Text fontSize="sm" color="gray.400" textAlign="center">
                    Your text has been analyzed. Click above to inspect claims and evidence.
                  </Text>
                </VStack>
              ) : (
                <VStack spacing={3} w="100%" align="stretch">
                  <Button
                    className="textpad-submit"
                    colorScheme="purple"
                    size="lg"
                    onClick={handleSubmit}
                    isLoading={isSubmitting && !submitProgress}
                    loadingText="Starting…"
                    isDisabled={!text.trim() || isSubmitting}
                  >
                    Submit for Analysis
                  </Button>

                  {submitProgress && (
                    <Box
                      bg="rgba(99, 102, 241, 0.08)"
                      border="1px solid rgba(99, 102, 241, 0.25)"
                      borderRadius="md"
                      p={4}
                    >
                      <HStack justify="space-between" mb={2}>
                        <HStack spacing={2}>
                          <Spinner size="xs" color="purple.400" />
                          <Text fontSize="sm" color="white">
                            {submitProgress.message}
                          </Text>
                        </HStack>
                        <Badge
                          colorScheme={submitProgress.stage === "done" ? "green" : "purple"}
                          fontSize="xs"
                        >
                          {submitProgress.percent}%
                        </Badge>
                      </HStack>
                      <Progress
                        value={submitProgress.percent}
                        colorScheme={submitProgress.stage === "done" ? "green" : "purple"}
                        size="sm"
                        borderRadius="full"
                        hasStripe={submitProgress.stage !== "done"}
                        isAnimated={submitProgress.stage !== "done"}
                      />
                    </Box>
                  )}
                </VStack>
              )}
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
