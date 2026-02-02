import React, { useEffect, useState } from "react";
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalCloseButton,
  ModalBody,
  ModalFooter,
  Button,
  Input,
  VStack,
  Text,
  HStack,
  useToast,
} from "@chakra-ui/react";
import { fetchAllReferences } from "../services/useDashboardAPI";
import { useTaskStore } from "../store/useTaskStore"; // ✅ Import store
import { useLastVisitedURL } from "../hooks/useLastVisitedUrl";

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "https://localhost:5001";

const ScrapeReferenceModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  taskId: string;
  onUpdateReferences?: () => void;
  initialUrl?: string; // NEW: Pre-fill URL (for retry scrapes)
}> = ({ isOpen, onClose, taskId, onUpdateReferences, initialUrl }) => {
  const [url, setUrl] = useState<string>("");
  const [isScraping, setIsScraping] = useState(false);
  const toast = useToast();
  const lastVisitedURL = useLastVisitedURL(); // ✅ Fetches URL when returning to tab

  useEffect(() => {
    if (isOpen) {
      // Priority: 1) initialUrl (from retry button), 2) lastVisitedURL
      if (initialUrl) {
        setUrl(initialUrl);
      } else if (lastVisitedURL) {
        setUrl(lastVisitedURL);
      }
    }
  }, [isOpen, lastVisitedURL, initialUrl]);

  // ✅ Handle scraping request using the messageService

  // ✅ Updated scrape function using scrape job queue
  const handleScrape = async () => {
    if (!url.trim()) {
      toast({
        title: "No URL Provided",
        description: "Please enter or confirm a URL to scrape.",
        status: "warning",
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    setIsScraping(true);

    try {
      console.log("🚀 Creating scrape job for:", url);

      // Create scrape job
      const response = await fetch(`${BASE_URL}/api/scrape-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          mode: 'scrape_specific_url',
          url: url,
          taskContentId: taskId
        })
      });

      if (!response.ok) {
        throw new Error('Failed to create scrape job');
      }

      const result = await response.json();

      toast({
        title: "Scrape Job Created!",
        description: "The extension will scrape the page from your open tab. Make sure the page is loaded.",
        status: "info",
        duration: 5000,
        isClosable: true,
      });

      // Poll for job completion
      const checkJobStatus = async () => {
        const statusResponse = await fetch(
          `${BASE_URL}/api/scrape-jobs/${result.scrape_job_id}/status`,
          { credentials: 'include' }
        );

        if (statusResponse.ok) {
          const jobStatus = await statusResponse.json();

          if (jobStatus.status === 'completed') {
            // ✅ Add to store
            useTaskStore
              .getState()
              .addReferenceToTask(Number(taskId), Number(jobStatus.content_id));

            // ✅ Re-fetch the latest references
            await useTaskStore.getState().fetchReferences(Number(taskId));

            toast({
              title: "Reference Added!",
              description: "The reference has been successfully scraped and linked.",
              status: "success",
              duration: 3000,
              isClosable: true,
            });
            onUpdateReferences?.();
            onClose();
            setIsScraping(false);
            return true;
          } else if (jobStatus.status === 'failed') {
            toast({
              title: "Scrape Failed",
              description: jobStatus.error_message || "The extension failed to scrape the page.",
              status: "error",
              duration: 5000,
              isClosable: true,
            });
            setIsScraping(false);
            return true;
          }
        }
        return false;
      };

      // Poll every 2 seconds for up to 30 seconds
      let attempts = 0;
      const maxAttempts = 15;
      const pollInterval = setInterval(async () => {
        attempts++;
        const done = await checkJobStatus();

        if (done || attempts >= maxAttempts) {
          clearInterval(pollInterval);
          if (attempts >= maxAttempts) {
            toast({
              title: "Timeout",
              description: "Scrape job is taking longer than expected. Check extension console.",
              status: "warning",
              duration: 5000,
              isClosable: true,
            });
            setIsScraping(false);
          }
        }
      }, 2000);
    } catch (error) {
      console.error("❌ Error in scraping reference:", error);
      toast({
        title: "Scrape Error",
        description: `Error: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        status: "error",
        duration: 3000,
        isClosable: true,
      });
    }

    setIsScraping(false);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <ModalOverlay />
      <ModalContent className="mr-modal">
        <ModalHeader className="mr-modal-header">
          {initialUrl ? "🔄 Retry Failed Scrape" : "Scrape a New Reference"}
        </ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <VStack align="start" spacing={4} width="100%">
            {/* ✅ Show source of URL */}
            {url && (
              <Text fontSize="sm" color={initialUrl ? "orange.600" : "gray.500"}>
                {initialUrl ? "⚠️ Failed Reference:" : "Last Visited:"}{" "}
                <Text as="span" fontWeight="bold" color={initialUrl ? "orange.700" : "blue.600"}>
                  {url}
                </Text>
              </Text>
            )}

            {/* ✅ User confirms or changes URL */}
            <Input
              className="mr-input"
              placeholder="Enter or confirm the URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </VStack>
        </ModalBody>
        <ModalFooter>
          <HStack>
            <Button
              className="mr-button"
              colorScheme="blue"
              onClick={handleScrape}
              isLoading={isScraping}
            >
              Scrape Reference
            </Button>
            <Button colorScheme="red" onClick={onClose}>
              Cancel
            </Button>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default ScrapeReferenceModal;
