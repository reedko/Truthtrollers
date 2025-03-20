import React, { useState } from "react";
import {
  VStack,
  Heading,
  Button,
  HStack,
  Tooltip,
  Box,
  Text,
  Input,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
} from "@chakra-ui/react";
import { ReferenceWithClaims } from "../../../shared/entities/types";
import ReferenceModal from "./ReferenceModal";

interface ReferenceListProps {
  references: ReferenceWithClaims[];
  onEditReference: (referenceId: number, title: string) => void;
  onDeleteReference: (referenceId: number) => void;
}

const ReferenceList: React.FC<ReferenceListProps> = ({
  references,
  onEditReference,
  onDeleteReference,
}) => {
  const [isReferenceModalOpen, setIsReferenceModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingReference, setEditingReference] =
    useState<ReferenceWithClaims | null>(null);
  const [newTitle, setNewTitle] = useState("");

  return (
    <VStack
      align="start"
      spacing={2}
      borderLeft="1px solid gray"
      pl={4}
      overflowY="auto"
      maxHeight="800px"
    >
      <Heading size="sm">References</Heading>

      {/* 🔥 Button to Open ReferenceModal */}
      <Button colorScheme="blue" onClick={() => setIsReferenceModalOpen(true)}>
        + Add Reference
      </Button>

      {references.length === 0 ? (
        <Text>No References Found</Text>
      ) : (
        references.map((ref) => (
          <Box key={ref.reference_content_id}>
            <HStack spacing={2} width="100%">
              <Tooltip label={ref.content_name} hasArrow>
                <Button variant="outline" colorScheme="blue" width="100%">
                  {ref.content_name}
                </Button>
              </Tooltip>

              {/* 🔥 Edit Reference Title */}
              <Button
                size="sm"
                onClick={() => {
                  setEditingReference(ref);
                  setNewTitle(ref.content_name);
                  setIsEditModalOpen(true);
                }}
              >
                Edit Title
              </Button>

              {/* 🔥 Delete Reference */}
              <Button
                size="sm"
                colorScheme="red"
                onClick={() => onDeleteReference(ref.reference_content_id)}
              >
                🗑️
              </Button>
            </HStack>
          </Box>
        ))
      )}

      {/* 🔥 Reference Modal for Adding References */}
      <ReferenceModal
        isOpen={isReferenceModalOpen}
        onClose={() => setIsReferenceModalOpen(false)}
        taskId={1} // Pass actual taskId from parent
      />

      {/* 🔥 Modal for Editing Reference Title */}
      <Modal isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Edit Reference Title</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Enter new title"
            />
          </ModalBody>
          <ModalFooter>
            <Button
              colorScheme="green"
              onClick={() => {
                if (editingReference) {
                  onEditReference(
                    editingReference.reference_content_id,
                    newTitle
                  );
                  setIsEditModalOpen(false);
                }
              }}
              isDisabled={!newTitle.trim()}
            >
              Save
            </Button>
            <Button onClick={() => setIsEditModalOpen(false)} ml={2}>
              Cancel
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </VStack>
  );
};

export default ReferenceList;
