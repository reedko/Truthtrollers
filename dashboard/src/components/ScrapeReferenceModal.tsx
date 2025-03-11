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
import { scrapeContent } from "../../../extension/src/services/scrapeContent"; // ✅ Import the scrape function
import { useLastVisitedURL } from "../hooks/useLastVisitedUrl";

const ScrapeReferenceModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  taskId: number;
}> = ({ isOpen, onClose, taskId }) => {
  const lastVisitedURL = useLastVisitedURL();
  const [url, setUrl] = useState<string>("");
  const [isScraping, setIsScraping] = useState(false);
  const toast = useToast();
  console.log(lastVisitedURL, ":lastone");
  // ✅ Detect last visited page when modal opens
  // ✅ Load last visited URL when the modal opens
  useEffect(() => {
    if (isOpen) {
      chrome.storage.local.get("lastVisitedURL", (data) => {
        if (data.lastVisitedURL) {
          setUrl(data.lastVisitedURL);
          console.log(`✅ Loaded last visited URL: ${data.lastVisitedURL}`);
        }
      });
    }
  }, [isOpen]);

  // ✅ Handle scraping request
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
    const scrapedContentId = await scrapeContent(
      url,
      "",
      "reference",
      taskId.toString()
    );

    setIsScraping(false);

    if (scrapedContentId) {
      toast({
        title: "Reference Added!",
        description: "The reference has been successfully scraped and linked.",
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
