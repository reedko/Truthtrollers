/**
 * Create Thread Modal
 *
 * Modal for creating new TT Live threads or importing X threads
 */

import React, { useState } from 'react';
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  Button,
  VStack,
  FormControl,
  FormLabel,
  Input,
  Textarea,
  Select,
  Alert,
  AlertIcon,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  useToast,
} from '@chakra-ui/react';

interface CreateThreadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const CreateThreadModal: React.FC<CreateThreadModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [activeTab, setActiveTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  // Native TT thread fields
  const [threadTitle, setThreadTitle] = useState('');

  // Import X thread fields
  const [xThreadUrl, setXThreadUrl] = useState('');

  const handleCreateNative = async () => {
    if (!threadTitle.trim()) {
      toast({
        title: 'Title required',
        status: 'error',
        duration: 3000,
      });
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/ttlive/threads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('jwt')}`,
        },
        body: JSON.stringify({
          thread_title: threadTitle,
          thread_type: 'native_tt',
          source_platform: 'native',
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create thread');
      }

      toast({
        title: 'Thread created!',
        status: 'success',
        duration: 3000,
      });

      onSuccess();
    } catch (error) {
      console.error('Error creating thread:', error);
      toast({
        title: 'Failed to create thread',
        description: error instanceof Error ? error.message : 'Unknown error',
        status: 'error',
        duration: 5000,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleImportX = async () => {
    if (!xThreadUrl.trim()) {
      toast({
        title: 'X thread URL required',
        status: 'error',
        duration: 3000,
      });
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/ttlive/import/x', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('jwt')}`,
        },
        body: JSON.stringify({
          x_thread_url: xThreadUrl,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to import thread');
      }

      const data = await response.json();

      if (data.already_imported) {
        toast({
          title: 'Thread already imported',
          description: 'This X thread was previously imported.',
          status: 'info',
          duration: 3000,
        });
      } else {
        toast({
          title: 'Thread imported!',
          description: `Imported ${data.imported_count} posts from X.`,
          status: 'success',
          duration: 3000,
        });
      }

      onSuccess();
    } catch (error) {
      console.error('Error importing thread:', error);
      toast({
        title: 'Failed to import thread',
        description: error instanceof Error ? error.message : 'Unknown error',
        status: 'error',
        duration: 5000,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Create or Import Thread</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Tabs index={activeTab} onChange={setActiveTab}>
            <TabList>
              <Tab>Create Native TT Thread</Tab>
              <Tab>Import from X</Tab>
            </TabList>

            <TabPanels>
              {/* Create Native Thread */}
              <TabPanel px={0} pt={4}>
                <VStack spacing={4} align="stretch">
                  <FormControl isRequired>
                    <FormLabel>Thread Title</FormLabel>
                    <Input
                      placeholder="What's this thread about?"
                      value={threadTitle}
                      onChange={(e) => setThreadTitle(e.target.value)}
                    />
                  </FormControl>

                  <Alert status="info">
                    <AlertIcon />
                    Create a new TruthTrollers discussion thread. You can link it
                    to a task or content after creation.
                  </Alert>
                </VStack>
              </TabPanel>

              {/* Import from X */}
              <TabPanel px={0} pt={4}>
                <VStack spacing={4} align="stretch">
                  <FormControl isRequired>
                    <FormLabel>X Thread URL</FormLabel>
                    <Input
                      placeholder="https://x.com/username/status/123456789"
                      value={xThreadUrl}
                      onChange={(e) => setXThreadUrl(e.target.value)}
                    />
                  </FormControl>

                  <Alert status="info">
                    <AlertIcon />
                    Import an existing X/Twitter thread to discuss it in TruthTrollers.
                    Requires X account connection.
                  </Alert>
                </VStack>
              </TabPanel>
            </TabPanels>
          </Tabs>
        </ModalBody>

        <ModalFooter>
          <Button variant="ghost" mr={3} onClick={onClose}>
            Cancel
          </Button>
          <Button
            colorScheme="blue"
            onClick={activeTab === 0 ? handleCreateNative : handleImportX}
            isLoading={loading}
          >
            {activeTab === 0 ? 'Create Thread' : 'Import Thread'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default CreateThreadModal;
