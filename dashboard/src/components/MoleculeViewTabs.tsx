// View selector component for molecule views
import React, { useState } from "react";
import {
  Box,
  Button,
  IconButton,
  Input,
  useToast,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  useDisclosure,
  useColorMode,
} from "@chakra-ui/react";
import { AddIcon, EditIcon, DeleteIcon, SettingsIcon } from "@chakra-ui/icons";
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
      {/* Consolidated View Selector Menu */}
      <Menu>
        <MenuButton
          as={Button}
          size="sm"
          variant="outline"
          colorScheme="blue"
          rightIcon={<span>▼</span>}
        >
          {activeView?.name || "Select View"}
          {activeView?.is_default && " ⭐"}
        </MenuButton>
        <MenuList
          bg={colorMode === "dark" ? "gray.800" : "white"}
          borderColor={colorMode === "dark" ? "whiteAlpha.200" : "gray.200"}
          zIndex={2500}
        >
          {views.map((view) => (
            <MenuItem
              key={view.id}
              as="div"
              onClick={() => onViewChange(view.id)}
              bg={view.id === activeViewId ? (colorMode === "dark" ? "rgba(0, 162, 255, 0.2)" : "rgba(71, 85, 105, 0.1)") : undefined}
              fontWeight={view.id === activeViewId ? "bold" : "normal"}
              display="flex"
              justifyContent="space-between"
              cursor="pointer"
            >
              <span>
                {view.name}
                {view.is_default && " ⭐"}
              </span>
              {/* Settings submenu for each view */}
              <Menu>
                <MenuButton
                  as={Box}
                  cursor="pointer"
                  display="inline-flex"
                  alignItems="center"
                  justifyContent="center"
                  w="24px"
                  h="24px"
                  borderRadius="md"
                  _hover={{ bg: colorMode === "dark" ? "whiteAlpha.200" : "gray.100" }}
                  onClick={(e) => {
                    e.stopPropagation(); // Prevent view selection when clicking gear
                  }}
                >
                  <SettingsIcon boxSize={3} />
                </MenuButton>
                <MenuList
                  bg={colorMode === "dark" ? "gray.800" : "white"}
                  borderColor={colorMode === "dark" ? "whiteAlpha.200" : "gray.200"}
                  zIndex={2600}
                >
                  <MenuItem icon={<EditIcon />} onClick={() => openEditModal(view)}>
                    Rename View
                  </MenuItem>
                  <MenuItem
                    icon={<span>⭐</span>}
                    onClick={() => onSetDefault(view.id)}
                    isDisabled={view.is_default}
                  >
                    Set as Default
                  </MenuItem>
                  <MenuItem
                    icon={<DeleteIcon />}
                    onClick={() => handleDeleteView(view.id)}
                    color="red.500"
                    isDisabled={views.length <= 1}
                  >
                    Delete View
                  </MenuItem>
                </MenuList>
              </Menu>
            </MenuItem>
          ))}

          {/* Add New View Option */}
          <MenuItem
            icon={<AddIcon />}
            onClick={onCreateOpen}
            borderTop="1px solid"
            borderColor={colorMode === "dark" ? "whiteAlpha.200" : "gray.200"}
            mt={1}
            pt={2}
            fontWeight="semibold"
          >
            + New View
          </MenuItem>
        </MenuList>
      </Menu>

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
              onKeyPress={(e) => {
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
              onKeyPress={(e) => {
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
