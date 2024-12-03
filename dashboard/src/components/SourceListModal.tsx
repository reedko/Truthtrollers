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
} from "@chakra-ui/react";
import axios from "axios";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";
const SourceListModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  taskId: number;
}> = ({ isOpen, onClose, taskId }) => {
  const [sources, setSources] = useState<
    { lit_reference_id: number; lit_reference_link: string }[]
  >([]);
  const [selectedSources, setSelectedSources] = useState<number[]>([]);
  const [newSource, setNewSource] = useState("");

  useEffect(() => {
    const fetchSources = async () => {
      try {
        const response = await axios.get(
          `${API_BASE_URL}/api/tasks/${taskId}/source-references`
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
      await axios.post(`${API_BASE_URL}/api/tasks/${taskId}/remove-sources`, {
        sources: selectedSources,
      });
      setSources((prev) =>
        prev.filter(
          (source) => !selectedSources.includes(source.lit_reference_id)
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
        `${API_BASE_URL}/api/tasks/${taskId}/add-source`,
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
      <ModalContent>
        <ModalHeader>Manage Sources</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <VStack align="start">
            {sources.map((source) => (
              <Checkbox
                key={source.lit_reference_id}
                isChecked={selectedSources.includes(source.lit_reference_id)}
                onChange={() => handleToggleSource(source.lit_reference_id)}
              >
                {source.lit_reference_link}
              </Checkbox>
            ))}
          </VStack>
          <Input
            placeholder="Add a new source"
            value={newSource}
            onChange={(e) => setNewSource(e.target.value)}
            mt={4}
          />
        </ModalBody>
        <ModalFooter>
          <Button onClick={handleAddSource} colorScheme="blue" mr={3}>
            Add Source
          </Button>
          <Button onClick={handleRemoveSources} colorScheme="red" mr={3}>
            Remove Selected
          </Button>
          <Button onClick={onClose}>Close</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default SourceListModal;
