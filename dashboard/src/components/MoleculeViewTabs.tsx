// Tabbed view component for molecule views
import React, { useState } from "react";
import {
  Box,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  Button,
  IconButton,
  Input,
  HStack,
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

  const activeIndex = views.findIndex((v) => v.id === activeViewId);

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

  return (
    <Box>
      <Tabs
        index={activeIndex === -1 ? 0 : activeIndex}
        onChange={(index) => onViewChange(views[index]?.id)}
        variant="enclosed"
        colorScheme="blue"
      >
        <HStack justify="space-between" mb={2}>
          <TabList>
            {views.map((view) => (
              <Tab
                key={view.id}
                _selected={{
                  color: "#00a2ff",
                  borderColor: "rgba(0, 162, 255, 0.6)",
                  bg: "rgba(0, 162, 255, 0.1)",
                }}
              >
                {view.name}
                {view.is_default && " ⭐"}
              </Tab>
            ))}
          </TabList>

          <HStack>
            <Button
              size="sm"
              leftIcon={<AddIcon />}
              onClick={onCreateOpen}
              colorScheme="blue"
              variant="ghost"
            >
              New View
            </Button>
          </HStack>
        </HStack>

        <TabPanels>
          {views.map((view) => (
            <TabPanel key={view.id} p={0}>
              <HStack justify="flex-end" mt={2} mb={2}>
                <Menu>
                  <MenuButton
                    as={IconButton}
                    icon={<SettingsIcon />}
                    size="sm"
                    variant="ghost"
                    aria-label="View options"
                  />
                  <MenuList>
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
              </HStack>
            </TabPanel>
          ))}
        </TabPanels>
      </Tabs>

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
