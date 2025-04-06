import React, { useState, useEffect } from "react";
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
import {
  LitReference,
  ReferenceWithClaims,
} from "../../../shared/entities/types";
import ReferenceModal from "./modals/ReferenceModal";
import ReferenceClaimsModal from "./modals/ReferenceClaimsModal";

interface ReferenceListProps {
  references: ReferenceWithClaims[];
  onEditReference: (referenceId: number, title: string) => void;
  onDeleteReference: (referenceId: number) => void;
  taskId: number;
  onReferenceClick: (ref: ReferenceWithClaims) => void;
  selectedReference: ReferenceWithClaims | null; // 👈 add this!
}

const ReferenceList: React.FC<ReferenceListProps> = ({
  references,
  onEditReference,
  onDeleteReference,
  taskId,
  onReferenceClick,
  selectedReference,
}) => {
  const [isReferenceModalOpen, setIsReferenceModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingReference, setEditingReference] =
    useState<ReferenceWithClaims | null>(null);
  const [newTitle, setNewTitle] = useState("");

  return (
    <>
      <VStack
        align="start"
        spacing={2}
        borderLeft="1px solid gray"
        alignSelf="flex-start"
        pl={4}
        width="100%"
      >
        <Heading size="sm">References</Heading>

        {/* 🔥 Button to Open ReferenceModal */}
        <Button
          colorScheme="blue"
          onClick={() => setIsReferenceModalOpen(true)}
        >
          + Add Reference
        </Button>

        {references.length === 0 ? (
          <Text>No References Found</Text>
        ) : (
          references.map((ref) => (
            <HStack key={ref.reference_content_id} width="100%" spacing={2}>
              <Tooltip label={ref.content_name} hasArrow>
                <Button
                  variant={
                    selectedReference?.reference_content_id ===
                    ref.reference_content_id
                      ? "solid"
                      : "outline"
                  }
                  colorScheme="blue"
                  width="100%"
                  overflow="hidden"
                  textOverflow="ellipsis"
                  whiteSpace="nowrap"
                  onClick={() => {
                    console.log("📘 Reference clicked:", ref);

                    onReferenceClick(ref); // ✅ add this line
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (ref.url) {
                      window.open(ref.url, "_blank");
                    }
                  }}
                >
                  {ref.content_name}
                </Button>
              </Tooltip>

              <Button
                size="sm"
                onClick={() => {
                  setEditingReference(ref);
                  setNewTitle(ref.content_name);
                  setIsEditModalOpen(true);
                }}
              >
                ✏️
              </Button>

              <Button
                size="sm"
                colorScheme="red"
                onClick={() => onDeleteReference(ref.reference_content_id)}
              >
                🗑️
              </Button>
            </HStack>
          ))
        )}
      </VStack>

      {/* 🔥 Reference Modal for Adding References */}
      <ReferenceModal
        isOpen={isReferenceModalOpen}
        onClose={() => setIsReferenceModalOpen(false)}
        taskId={taskId} // Pass actual taskId from parent
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
                    editingReference?.reference_content_id as number,
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
    </>
  );
};

export default ReferenceList;
