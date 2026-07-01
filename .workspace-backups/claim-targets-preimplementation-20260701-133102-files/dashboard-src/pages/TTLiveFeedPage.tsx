/**
 * TT Live Feed Page - REFACTORED
 *
 * Viewing-first architecture: Social media feed with TT overlay
 * NOT a composer, NOT a form - a FEED
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Container,
  VStack,
  HStack,
  Heading,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  Spinner,
  Alert,
  AlertIcon,
  useColorModeValue,
  Text,
  IconButton,
  Button,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  Input,
  FormControl,
  FormLabel,
  useDisclosure,
  useToast,
} from '@chakra-ui/react';
import { FiHome, FiEye, FiActivity, FiRefreshCw, FiExternalLink, FiPlus, FiClock } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';
import TTLiveFeedItemCard from '../components/ttlive/TTLiveFeedItemCard';

interface FeedItem {
  item_type: 'live_feed' | 'imported' | 'monitored' | 'tt_activity';
  post_id: string;
  thread_id?: string | null;
  platform: string;
  post_url?: string | null;
  author_username: string;
  author_display_name: string;
  author_avatar_url?: string | null;
  author_verified: boolean;
  post_text: string;
  media_urls?: string[];
  created_at: string;
  engagement: {
    likes: number;
    shares: number;
    replies: number;
    views: number;
  };
  tt_metadata?: {
    discussion_count?: number;
    evidence_count?: number;
    is_monitored?: boolean;
    stance?: string;
    verimeter_score?: number;
  };
}

const TTLiveFeedPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState(0);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasAuth, setHasAuth] = useState(false);
  const [authStatus, setAuthStatus] = useState<any>(null);
  const [importUrl, setImportUrl] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Per-tab cache so switching back is instant
  const feedCache = useRef<Record<number, FeedItem[]>>({});
  const nextTokenCache = useRef<Record<number, string | null>>({});
  const hasMoreCache = useRef<Record<number, boolean>>({});
  const activeTabRef = useRef(activeTab);

  const bgColor = useColorModeValue('gray.50', 'gray.900');
  const { isOpen, onOpen, onClose } = useDisclosure();
  const { isOpen: isXConnectModalOpen, onOpen: onXConnectModalOpen, onClose: onXConnectModalClose } = useDisclosure();
  const toast = useToast();
  const navigate = useNavigate();

  // Auth check — once on mount only
  useEffect(() => {
    checkAuth();

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('connected') === 'true') {
      toast({
        title: 'X Account Connected!',
        description: `Connected as @${urlParams.get('username')}`,
        status: 'success',
        duration: 5000,
      });
      window.history.replaceState({}, '', '/ttlive');
    }
  }, []);

  // Tab change: show cache immediately, then silently refresh
  useEffect(() => {
    activeTabRef.current = activeTab;
    const cached = feedCache.current[activeTab];
    if (cached && cached.length > 0) {
      setFeed(cached);
      setNextToken(nextTokenCache.current[activeTab] ?? null);
      setHasMore(hasMoreCache.current[activeTab] ?? false);
      fetchForTab(activeTab, false); // background refresh, no spinner
    } else {
      fetchForTab(activeTab, true); // first load — show spinner
    }
  }, [activeTab]);

  // Auto-refresh every 30s — silent background refresh of active tab only
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => fetchForTab(activeTabRef.current, false), 30000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const checkAuth = async () => {
    try {
      const response = await fetch('/api/x-auth/status', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('jwt')}`,
        },
      });
      const data = await response.json();
      console.log('X Auth Status:', data);
      setAuthStatus(data);

      // Show modal only if not connected
      // (mismatch is just a warning, not a blocker)
      if (!data.connected) {
        console.log('Showing connection modal - Not connected');
        setHasAuth(false);
        onXConnectModalOpen();
      } else {
        console.log('Already connected as:', data.x_username);
        setHasAuth(true);

        // Show warning toast if there's a username mismatch (but still allow access)
        if (data.possible_mismatch) {
          toast({
            title: 'Username Mismatch Notice',
            description: `Connected as @${data.x_username}. This doesn't match your Truthtrollers account (${data.truthtrollers_email}), but you can still use TTLive.`,
            status: 'info',
            duration: 8000,
            isClosable: true,
          });
        }
      }
    } catch (error) {
      console.error('Auth check failed:', error);
    }
  };

  const handleConnectX = async () => {
    try {
      const response = await fetch('/api/x-auth/connect?redirect=ttlive', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('jwt')}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to initiate X connection');
      }

      const data = await response.json();

      if (data.auth_url) {
        // Redirect to X OAuth
        window.location.href = data.auth_url;
      }
    } catch (error) {
      console.error('X connection error:', error);
      toast({
        title: 'Connection Failed',
        description: 'Could not connect to X. Please try again.',
        status: 'error',
        duration: 5000,
      });
    }
  };

  const fetchForTab = async (tab: number, showSpinner: boolean, paginationToken: string | null = null) => {
    if (showSpinner) setLoading(true);

    try {
      const endpoint = tab === 1 ? '/api/ttlive/feed/monitored' : '/api/ttlive/feed';
      const params = new URLSearchParams({ limit: '20', platform: 'x' });
      if (paginationToken) params.append('pagination_token', paginationToken);

      const response = await fetch(`${endpoint}?${params}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('jwt')}` },
      });
      const data = await response.json();

      const incoming: FeedItem[] = tab === 1 ? (data.monitored || []) : (data.feed || []);
      const newFeed = paginationToken
        ? [...(feedCache.current[tab] || []), ...incoming]
        : incoming;

      // Always update cache
      feedCache.current[tab] = newFeed;
      nextTokenCache.current[tab] = tab !== 1 ? (data.next_token || null) : null;
      hasMoreCache.current[tab] = tab !== 1 ? (data.has_more || false) : false;

      // Only push to state if still on this tab
      if (tab === activeTabRef.current) {
        setFeed(newFeed);
        setNextToken(nextTokenCache.current[tab]);
        setHasMore(hasMoreCache.current[tab] ?? false);
      }
    } catch (error) {
      console.error('Failed to load feed:', error);
    } finally {
      if (showSpinner) setLoading(false);
      setLoadingMore(false);
    }
  };

  // Kept for external callers (import success, manual refresh button)
  const loadFeed = (showSpinner = true) => fetchForTab(activeTabRef.current, showSpinner);

  const loadMore = async () => {
    if (!nextToken || loadingMore) return;
    setLoadingMore(true);
    await fetchForTab(activeTabRef.current, false, nextToken);
  };

  const handleImportThread = async () => {
    if (!importUrl) {
      toast({
        title: 'URL Required',
        description: 'Please enter a Twitter/X thread URL',
        status: 'warning',
        duration: 3000,
      });
      return;
    }

    setIsImporting(true);
    try {
      const response = await fetch('/api/ttlive/import/x', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('jwt')}`,
        },
        body: JSON.stringify({
          x_thread_url: importUrl,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to import thread');
      }

      const data = await response.json();

      toast({
        title: 'Thread Imported!',
        description: 'Opening thread...',
        status: 'success',
        duration: 2000,
      });

      onClose();
      setImportUrl('');

      // Navigate to the imported thread
      if (data.thread_id) {
        navigate(`/ttlive/thread/${data.thread_id}`);
      } else {
        loadFeed(); // Refresh feed
      }
    } catch (error) {
      console.error('Import error:', error);
      toast({
        title: 'Import Failed',
        description: error instanceof Error ? error.message : 'Could not import thread',
        status: 'error',
        duration: 5000,
      });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Box bg={bgColor} minH="100vh">
      {/* Fixed Header */}
      <Box
        position="sticky"
        top={0}
        zIndex={10}
        bg={useColorModeValue('white', 'gray.800')}
        borderBottomWidth="1px"
        borderColor={useColorModeValue('gray.200', 'gray.700')}
      >
        <Container maxW="container.lg">
          <HStack justify="space-between" py={3}>
            <Heading size="md">TT Live</Heading>
            <HStack spacing={2}>
              <Button
                leftIcon={<FiClock />}
                size="sm"
                variant={autoRefresh ? 'solid' : 'outline'}
                colorScheme={autoRefresh ? 'green' : 'gray'}
                onClick={() => setAutoRefresh(!autoRefresh)}
              >
                {autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
              </Button>
              <Button
                leftIcon={<FiPlus />}
                colorScheme="blue"
                size="sm"
                onClick={onOpen}
              >
                Import Thread
              </Button>
              <IconButton
                aria-label="Refresh feed"
                icon={<FiRefreshCw />}
                variant="ghost"
                onClick={() => loadFeed()}
                isLoading={loading}
              />
            </HStack>
          </HStack>
        </Container>
      </Box>

      {/* X Connection Modal */}
      <Modal isOpen={isXConnectModalOpen} onClose={onXConnectModalClose} isCentered size="lg">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Connect Your X Account</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <VStack spacing={4} align="start">
              <Text>
                TT Live requires connecting your X (Twitter) account to display your personalized social media feed.
              </Text>
              <Text fontSize="sm" color="gray.600">
                You'll be redirected to X to authorize access. We'll only access your public timeline and basic profile information.
              </Text>
              <Alert status="warning" variant="left-accent">
                <AlertIcon />
                <VStack align="start" spacing={2} fontSize="sm">
                  <Text fontWeight="bold">Important - Connecting YOUR X Account:</Text>
                  <Text>
                    You're logged into Truthtrollers as: <strong>{authStatus?.truthtrollers_email}</strong>
                  </Text>
                  <Text>
                    Make sure to connect YOUR matching X account, not someone else's!
                  </Text>
                  <Text fontWeight="semibold" pl={4}>
                    If X shows the wrong account, log out of X first (button below), then reconnect.
                  </Text>
                </VStack>
              </Alert>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" mr={3} onClick={onXConnectModalClose}>
              Skip for Now
            </Button>
            <Button
              as="a"
              href="https://twitter.com/logout"
              target="_blank"
              variant="outline"
              colorScheme="gray"
              size="sm"
              mr={3}
            >
              Log Out of X First
            </Button>
            <Button
              colorScheme="twitter"
              leftIcon={<FiExternalLink />}
              onClick={handleConnectX}
            >
              Connect My X Account
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Import Thread Modal */}
      <Modal isOpen={isOpen} onClose={onClose}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Import Twitter/X Thread</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <VStack spacing={4}>
              <Text fontSize="sm" color="gray.600">
                Paste a Twitter/X thread URL to import it into TT Live for structured discussion.
              </Text>
              <FormControl>
                <FormLabel>Thread URL</FormLabel>
                <Input
                  value={importUrl}
                  onChange={(e) => setImportUrl(e.target.value)}
                  placeholder="https://twitter.com/user/status/123456..."
                  autoFocus
                />
              </FormControl>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" mr={3} onClick={onClose}>
              Cancel
            </Button>
            <Button
              colorScheme="blue"
              onClick={handleImportThread}
              isLoading={isImporting}
            >
              Import
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Container maxW="container.lg" py={0}>
        {/* Auth Warning */}
        {!hasAuth && (
          <Alert status="warning" mt={4} borderRadius="md">
            <AlertIcon />
            <VStack align="start" spacing={2} flex={1}>
              <Text fontWeight="bold">Connect X Account for Live Feed</Text>
              <Text fontSize="sm">
                Connect your X (Twitter) account to see live social media content in your feed.
                For now, showing imported and monitored content.
              </Text>
              <Button
                as="a"
                href="/social-media"
                colorScheme="twitter"
                size="sm"
                leftIcon={<FiExternalLink />}
              >
                Go to Social Media Page to Connect
              </Button>
            </VStack>
          </Alert>
        )}

        {/* Feed Tabs */}
        <Tabs
          index={activeTab}
          onChange={setActiveTab}
          variant="enclosed"
          colorScheme="blue"
        >
          <TabList>
            <Tab>
              <HStack>
                <FiHome />
                <Text>Feed</Text>
              </HStack>
            </Tab>
            <Tab>
              <HStack>
                <FiEye />
                <Text>Monitored</Text>
              </HStack>
            </Tab>
            <Tab>
              <HStack>
                <FiActivity />
                <Text>TT Activity</Text>
              </HStack>
            </Tab>
          </TabList>

          <TabPanels>
            {/* All Feed */}
            <TabPanel px={0}>
              {loading ? (
                <Box textAlign="center" py={12}>
                  <Spinner size="xl" />
                  <Text mt={4}>Loading feed...</Text>
                </Box>
              ) : feed.length === 0 ? (
                <Alert status="info" mt={4}>
                  <AlertIcon />
                  <VStack align="start">
                    <Text fontWeight="bold">No feed items</Text>
                    <Text fontSize="sm">
                      Connect X account or import some threads to see content here.
                    </Text>
                  </VStack>
                </Alert>
              ) : (
                <VStack spacing={0} align="stretch">
                  {feed.map((item) => (
                    <TTLiveFeedItemCard key={item.post_id} item={item} onUpdate={loadFeed} />
                  ))}
                  {hasMore && (
                    <Box py={4} textAlign="center">
                      <Button
                        onClick={loadMore}
                        isLoading={loadingMore}
                        variant="outline"
                        size="lg"
                        width="full"
                      >
                        Load More
                      </Button>
                    </Box>
                  )}
                </VStack>
              )}
            </TabPanel>

            {/* Monitored */}
            <TabPanel px={0}>
              {loading ? (
                <Box textAlign="center" py={12}>
                  <Spinner size="xl" />
                </Box>
              ) : feed.length === 0 ? (
                <Alert status="info" mt={4}>
                  <AlertIcon />
                  <Text>No monitored threads. Import threads to start monitoring.</Text>
                </Alert>
              ) : (
                <VStack spacing={0} align="stretch">
                  {feed.map((item) => (
                    <TTLiveFeedItemCard key={item.post_id || item.thread_id} item={item} onUpdate={loadFeed} />
                  ))}
                </VStack>
              )}
            </TabPanel>

            {/* TT Activity */}
            <TabPanel px={0}>
              {loading ? (
                <Box textAlign="center" py={12}>
                  <Spinner size="xl" />
                </Box>
              ) : feed.length === 0 ? (
                <Alert status="info" mt={4}>
                  <AlertIcon />
                  <Text>No recent TT activity.</Text>
                </Alert>
              ) : (
                <VStack spacing={0} align="stretch">
                  {feed.map((item) => (
                    <TTLiveFeedItemCard key={item.post_id} item={item} onUpdate={loadFeed} />
                  ))}
                </VStack>
              )}
            </TabPanel>
          </TabPanels>
        </Tabs>
      </Container>
    </Box>
  );
};

export default TTLiveFeedPage;
