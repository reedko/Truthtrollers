// View selector component for molecule views
import React, { useState } from "react";
import {
  Box,
  Button,
  Input,
  useToast,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  useDisclosure,
  useColorMode,
  Select,
} from "@chakra-ui/react";
import type { MoleculeView } from "../services/moleculeViewsAPI";

interface MoleculeViewTabsProps {
  views: MoleculeView[];
  activeViewId: number | null;
  onViewChange: (viewId: number) => void;
  onCreateView: (name: string) => Promise<void>;
  onRenameView: (viewId: number, newName: string) => Promise<void>;
  onDeleteView: (viewId: number) => Promise<void>;
  onSetDefault: (viewId: number) => Promise<void>;
}

const MoleculeViewTabs: React.FC<MoleculeViewTabsProps> = ({
  views,
  activeViewId,
  onViewChange,
  onCreateView,
  onRenameView,
  onDeleteView,
  onSetDefault,
}) => {
  const { colorMode } = useColorMode();
  const [newViewName, setNewViewName] = useState("");
  const [editingViewId, setEditingViewId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const toast = useToast();

  const {
    isOpen: isCreateOpen,
    onOpen: onCreateOpen,
    onClose: onCreateClose,
  } = useDisclosure();

  const {
    isOpen: isEditOpen,
    onOpen: onEditOpen,
    onClose: onEditClose,
  } = useDisclosure();

  const handleCreateView = async () => {
    if (!newViewName.trim()) {
      toast({
        title: "Name required",
        description: "Please enter a name for the view",
        status: "warning",
        duration: 2000,
      });
      return;
    }

    try {
      await onCreateView(newViewName.trim());
      setNewViewName("");
      onCreateClose();
      toast({
        title: "View created",
        status: "success",
        duration: 2000,
      });
    } catch (error) {
      toast({
        title: "Failed to create view",
        description: error instanceof Error ? error.message : "Unknown error",
        status: "error",
        duration: 3000,
      });
    }
  };

  const handleRenameView = async () => {
    if (!editingViewId || !editingName.trim()) return;

    try {
      await onRenameView(editingViewId, editingName.trim());
      setEditingViewId(null);
      setEditingName("");
      onEditClose();
      toast({
        title: "View renamed",
        status: "success",
        duration: 2000,
      });
    } catch (error) {
      toast({
        title: "Failed to rename view",
        description: error instanceof Error ? error.message : "Unknown error",
        status: "error",
        duration: 3000,
      });
    }
  };

  const handleDeleteView = async (viewId: number) => {
    if (views.length <= 1) {
      toast({
        title: "Cannot delete",
        description: "You must have at least one view",
        status: "warning",
        duration: 2000,
      });
      return;
    }

    try {
      await onDeleteView(viewId);
      toast({
        title: "View deleted",
        status: "success",
        duration: 2000,
      });
    } catch (error) {
      toast({
        title: "Failed to delete view",
        description: error instanceof Error ? error.message : "Unknown error",
        status: "error",
        duration: 3000,
      });
    }
  };

  const openEditModal = (view: MoleculeView) => {
    setEditingViewId(view.id);
    setEditingName(view.name);
    onEditOpen();
  };

  const activeView = views.find((v) => v.id === activeViewId);

  return (
    <Box>
      <Select
        size="xs"
        width={{ base: "80px", md: "95px", lg: "115px" }}
        fontSize={{ base: "9px", md: "10px", lg: "11px" }}
        height={{ base: "20px", md: "24px" }}
        value={activeViewId?.toString() || ''}
        onChange={(e) => {
          const val = e.target.value;
          if (val === 'create') {
            onCreateOpen();
          } else if (val === 'manage') {
            // Open edit for active view
            if (activeView) openEditModal(activeView);
          } else {
            onViewChange(parseInt(val, 10));
          }
        }}
        bg={colorMode === "dark" ? "rgba(15, 23, 42, 0.9)" : "white"}
        border="1px solid"
        borderColor={colorMode === "dark" ? "var(--mr-blue-border)" : "rgba(71, 85, 105, 0.3)"}
        color={colorMode === "dark" ? "var(--mr-text-primary)" : "gray.800"}
        borderRadius="full"
        boxShadow="inset 0 2px 4px rgba(0, 0, 0, 0.4)"
        _hover={{
          borderColor: colorMode === "dark" ? "var(--mr-blue)" : "rgba(71, 85, 105, 0.5)",
        }}
      >
        {views.map((view) => (
          <option key={view.id} value={view.id.toString()}>
            {view.name}{view.is_default ? ' ⭐' : ''}
          </option>
        ))}
        <option value="create">➕ New</option>
        <option value="manage">⚙️ Edit</option>
      </Select>

      {/* Create View Modal */}
      <Modal isOpen={isCreateOpen} onClose={onCreateClose}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Create New View</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Input
              placeholder="View name (e.g., 'Climate Focus', 'Top Sources')"
              value={newViewName}
              onChange={(e) => setNewViewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateView();
              }}
              autoFocus
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" mr={3} onClick={onCreateClose}>
              Cancel
            </Button>
            <Button colorScheme="blue" onClick={handleCreateView}>
              Create
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Edit View Modal */}
      <Modal isOpen={isEditOpen} onClose={onEditClose}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Rename View</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Input
              placeholder="View name"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRenameView();
              }}
              autoFocus
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" mr={3} onClick={onEditClose}>
              Cancel
            </Button>
            <Button colorScheme="blue" onClick={handleRenameView}>
              Save
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
};

export default MoleculeViewTabs;
