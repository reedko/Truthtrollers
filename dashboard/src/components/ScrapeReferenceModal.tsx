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
import { dashboardScraper } from "../services/dashboardScraper";

import { useLastVisitedURL } from "../hooks/useLastVisitedUrl";
//import { sendMessageToExtension } from "../services/messageService"; // ✅ New service

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "https://localhost:5001";

const ScrapeReferenceModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  taskId: string;
}> = ({ isOpen, onClose, taskId }) => {
  const [url, setUrl] = useState<string>("");
  const [isScraping, setIsScraping] = useState(false);
  const toast = useToast();
  const lastVisitedURL = useLastVisitedURL(); // ✅ Fetches URL when returning to tab

  useEffect(() => {
    if (isOpen && lastVisitedURL) {
      // ✅ Only update if input is empty to prevent overwriting user edits
      setUrl(lastVisitedURL);
    }
  }, [isOpen, lastVisitedURL]);

  // ✅ Handle scraping request using the messageService

  // ✅ Updated scrape function using DashboardScraper
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
      console.log("🚀 Scraping reference:", url);
      const scrapedContentId = await dashboardScraper(
        url,
        "",
        "reference",
        taskId
      );

      if (scrapedContentId) {
        toast({
          title: "Reference Added!",
          description:
            "The reference has been successfully scraped and linked.",
          status: "success",
          duration: 3000,
          isClosable: true,
        });
        onClose();
      } else {
        toast({
          title: "Scrape Failed",
          description: "Something went wrong while scraping the reference.",
          status: "error",
          duration: 3000,
          isClosable: true,
        });
      }
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
      <ModalContent>
        <ModalHeader>Scrape a New Reference</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <VStack align="start" spacing={4} width="100%">
            {/* ✅ Show last visited page */}
            {url && (
              <Text fontSize="sm" color="gray.500">
                Last Visited:{" "}
                <Text as="span" fontWeight="bold" color="blue.600">
                  {url}
                </Text>
              </Text>
            )}

            {/* ✅ User confirms or changes URL */}
            <Input
              placeholder="Enter or confirm the URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </VStack>
        </ModalBody>
        <ModalFooter>
          <HStack>
            <Button
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
