/**
 * TruthTrollers Live Feed Page
 *
 * X-inspired feed UI for browsing and participating in discussions
 */

import React, { useState, useEffect } from 'react';
import {
  Box,
  Container,
  VStack,
  HStack,
  Heading,
  Text,
  Button,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  useColorModeValue,
  Spinner,
  Alert,
  AlertIcon,
  Input,
  InputGroup,
  InputLeftElement,
} from '@chakra-ui/react';
import { FiHome, FiUsers, FiTrendingUp, FiSearch, FiPlus } from 'react-icons/fi';
import { TTLiveThread, TTLiveTimelinePost } from '../../../shared/entities/types';
import TTLiveThreadCard from '../components/ttlive/TTLiveThreadCard';
import CreateThreadModal from '../components/ttlive/CreateThreadModal';

const TTLiveFeedPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState(0);
  const [threads, setThreads] = useState<TTLiveThread[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  const bgColor = useColorModeValue('gray.50', 'gray.900');
  const cardBgColor = useColorModeValue('white', 'gray.800');
  const borderColor = useColorModeValue('gray.200', 'gray.700');

  useEffect(() => {
    loadThreads();
  }, [activeTab]);

  const loadThreads = async () => {
    setLoading(true);
    try {
      let endpoint = '/api/ttlive/threads';

      if (activeTab === 1) {
        // Your Threads
        endpoint = '/api/ttlive/threads/user';
      } else if (activeTab === 2) {
        // Trending (pinned threads first, then by activity)
        endpoint = '/api/ttlive/threads?order_by=last_activity_at';
      }

      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('jwt')}`,
        },
      });

      const data = await response.json();
      setThreads(data.threads || []);
    } catch (error) {
      console.error('Failed to load threads:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      loadThreads();
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(
        `/api/ttlive/threads/search?q=${encodeURIComponent(searchQuery)}`,
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('jwt')}`,
          },
        }
      );

      const data = await response.json();
      setThreads(data.threads || []);
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box bg={bgColor} minH="100vh">
      <Container maxW="container.xl" py={4}>
        <VStack spacing={6} align="stretch">
          {/* Header */}
          <HStack justify="space-between">
            <Heading size="lg">TT Live Feed</Heading>
            <Button
              leftIcon={<FiPlus />}
              colorScheme="blue"
              onClick={() => setShowCreateModal(true)}
            >
              New Thread
            </Button>
          </HStack>

          {/* Search */}
          <InputGroup>
            <InputLeftElement pointerEvents="none">
              <FiSearch color="gray" />
            </InputLeftElement>
            <Input
              placeholder="Search threads..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
            />
          </InputGroup>

          {/* Tabs */}
          <Tabs
            index={activeTab}
            onChange={setActiveTab}
            colorScheme="blue"
            variant="soft-rounded"
          >
            <TabList>
              <Tab>
                <HStack>
                  <FiHome />
                  <Text>All Threads</Text>
                </HStack>
              </Tab>
              <Tab>
                <HStack>
                  <FiUsers />
                  <Text>Your Threads</Text>
                </HStack>
              </Tab>
              <Tab>
                <HStack>
                  <FiTrendingUp />
                  <Text>Trending</Text>
                </HStack>
              </Tab>
            </TabList>

            <TabPanels>
              <TabPanel px={0}>
                {loading ? (
                  <Box textAlign="center" py={8}>
                    <Spinner size="xl" />
                  </Box>
                ) : threads.length === 0 ? (
                  <Alert status="info">
                    <AlertIcon />
                    No threads found. Create the first one!
                  </Alert>
                ) : (
                  <VStack spacing={4} align="stretch">
                    {threads.map((thread) => (
                      <TTLiveThreadCard key={thread.thread_id} thread={thread} />
                    ))}
                  </VStack>
                )}
              </TabPanel>

              <TabPanel px={0}>
                {loading ? (
                  <Box textAlign="center" py={8}>
                    <Spinner size="xl" />
                  </Box>
                ) : threads.length === 0 ? (
                  <Alert status="info">
                    <AlertIcon />
                    You haven't participated in any threads yet.
                  </Alert>
                ) : (
                  <VStack spacing={4} align="stretch">
                    {threads.map((thread) => (
                      <TTLiveThreadCard key={thread.thread_id} thread={thread} />
                    ))}
                  </VStack>
                )}
              </TabPanel>

              <TabPanel px={0}>
                {loading ? (
                  <Box textAlign="center" py={8}>
                    <Spinner size="xl" />
                  </Box>
                ) : threads.length === 0 ? (
                  <Alert status="info">
                    <AlertIcon />
                    No trending threads right now.
                  </Alert>
                ) : (
                  <VStack spacing={4} align="stretch">
                    {threads.map((thread) => (
                      <TTLiveThreadCard key={thread.thread_id} thread={thread} />
                    ))}
                  </VStack>
                )}
              </TabPanel>
            </TabPanels>
          </Tabs>
        </VStack>
      </Container>

      {/* Create Thread Modal */}
      {showCreateModal && (
        <CreateThreadModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            loadThreads();
          }}
        />
      )}
    </Box>
  );
};

export default TTLiveFeedPage;
