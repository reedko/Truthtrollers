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
  Checkbox,
  Input,
  VStack,
  Text,
  Link,
  Box,
  Center,
} from "@chakra-ui/react";
import axios from "axios";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "https://localhost:5001";
const SourceListModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  taskId: number;
  taskName: string;
  position: any; // Pass the task name
}> = ({ isOpen, onClose, taskId, taskName, position }) => {
  const [sources, setSources] = useState<
    {
      reference_content_id: number;
      url: string;
      content_name: string;
    }[]
  >([]);
  const [selectedSources, setSelectedSources] = useState<number[]>([]);
  const [newSource, setNewSource] = useState("");

  useEffect(() => {
    const fetchSources = async () => {
      try {
        const response = await axios.get(
          `${API_BASE_URL}/api/content/${taskId}/source-references`
        );
        setSources(response.data);
      } catch (error) {
        console.error("Error fetching sources:", error);
      }
    };

    if (isOpen) fetchSources();
  }, [isOpen, taskId]);

  const handleToggleSource = (sourceId: number) => {
    setSelectedSources((prev) =>
      prev.includes(sourceId)
        ? prev.filter((id) => id !== sourceId)
        : [...prev, sourceId]
    );
  };

  const handleRemoveSources = async () => {
    try {
      await axios.post(`${API_BASE_URL}/api/content/${taskId}/remove-sources`, {
        sources: selectedSources,
      });
      setSources((prev) =>
        prev.filter(
          (source) => !selectedSources.includes(source.reference_content_id)
        )
      );
      setSelectedSources([]);
    } catch (error) {
      console.error("Error removing sources:", error);
    }
  };

  const handleAddSource = async () => {
    try {
      const response = await axios.post(
        `${API_BASE_URL}/api/content/${taskId}/add-source`,
        { name: newSource }
      );
      setSources((prev) => [...prev, response.data]);
      setNewSource("");
    } catch (error) {
      console.error("Error adding source:", error);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <ModalOverlay />
      <ModalContent
        className="mr-modal"
        bg="transparent"
        boxShadow="none"
        position="absolute"
        top={`${position.top}px`}
        left={`${position.left}px`}
        transform="translate(-50%, -50%)"
      >
        <Box
          borderWidth="1px"
          borderRadius="lg"
          overflow="hidden"
          boxShadow="md"
          p={4}
          width="400px"
          margin="10px auto"
          bg="blue.600"
        >
          <ModalHeader className="mr-modal-header">
            Manage Sources for{" "}
            <Text as="span" fontStyle="italic" color="yellow.200">
              {taskName}
            </Text>
          </ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <VStack align="start">
              {sources.map((source) => (
                <Checkbox
                  color={"blue"}
                  key={source.reference_content_id}
                  isChecked={selectedSources.includes(
                    source.reference_content_id
                  )}
                  onChange={() =>
                    handleToggleSource(source.reference_content_id)
                  }
                >
                  <Link href={source.url} isExternal color="black">
                    {source.content_name}
                  </Link>
                </Checkbox>
              ))}
            </VStack>
            <Input
              className="mr-input"
              placeholder="Add a new source"
              value={newSource}
              onChange={(e) => setNewSource(e.target.value)}
              mt={4}
            />
          </ModalBody>
          <ModalFooter>
            <Button className="mr-button" onClick={handleAddSource} colorScheme="blue" mr={3}>
              Add Source
            </Button>
            <Button onClick={handleRemoveSources} colorScheme="red" mr={3}>
              Remove Selected
            </Button>
            <Button colorScheme="red" onClick={onClose}>
              Close
            </Button>
          </ModalFooter>
        </Box>
      </ModalContent>
    </Modal>
  );
};

export default SourceListModal;
