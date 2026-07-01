import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  HStack,
  VStack,
  Text,
  Badge,
  Icon,
  Button,
  useToast,
} from '@chakra-ui/react';
import {
  FiMessageCircle,
  FiExternalLink,
  FiEye,
  FiShield,
  FiArrowRight,
  FiDownload,
} from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';
import '../../styles/minorityReport.css';

interface FeedItemProps {
  item: any;
  onUpdate?: () => void;
}

const TTLiveFeedItemCard: React.FC<FeedItemProps> = ({ item, onUpdate }) => {
  const navigate = useNavigate();
  const toast = useToast();
  const [isImporting, setIsImporting] = useState(false);
  // Start tall enough for most tweets (images, long text).
  // Twitter's resize postMessage will shrink it if the tweet is shorter.
  const [iframeHeight, setIframeHeight] = useState(600);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      try {
        // e.source comparison works cross-origin with postMessage
        if (
          iframeRef.current &&
          e.source === iframeRef.current.contentWindow &&
          e.data?.eventName === 'twttr.private.resize' &&
          typeof e.data?.data?.height === 'number'
        ) {
          setIframeHeight(e.data.data.height + 8); // +8px breathing room
        }
      } catch {
        // ignore cross-origin messages we don't own
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []); // single listener per card instance

  const handleOpenThread = () => {
    if (item.thread_id) navigate(`/ttlive/thread/${item.thread_id}`);
  };

  const handleImportThread = async () => {
    if (!item.post_url) {
      toast({ title: 'Cannot Import', description: 'No source URL', status: 'warning', duration: 3000 });
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
        body: JSON.stringify({ x_thread_url: item.post_url }),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to import thread');
      }
      const data = await response.json();
      toast({ title: 'Thread Imported!', description: 'Opening thread...', status: 'success', duration: 2000 });
      if (data.thread_id) navigate(`/ttlive/thread/${data.thread_id}`);
      if (onUpdate) onUpdate();
    } catch (error) {
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

  // Use pre-stored tweet ID from import if available, otherwise parse URL
  const tweetId: string | undefined =
    item.tweet_id || item.post_url?.split('/status/')[1]?.split('?')[0];

  // Only load the iframe once the card scrolls into view
  const cardRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = cardRef.current;
    if (!el || !tweetId) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setInView(true); observer.disconnect(); } },
      { rootMargin: '200px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [tweetId]);

  return (
    <Box
      ref={cardRef}
      position="relative"
      mb={4}
      cursor={item.thread_id ? 'pointer' : 'default'}
      onClick={item.thread_id ? handleOpenThread : undefined}
    >
      {tweetId && (
        <Box
          className="mr-card mr-card-blue"
          position="relative"
          maxW="550px"
          mx="auto"
          overflow="visible"
        >
          {/* Keep decorations clipped to the card border */}
          <Box position="absolute" inset={0} borderRadius="inherit" overflow="hidden" pointerEvents="none" zIndex={1}>
            <div className="mr-glow-bar mr-glow-bar-blue" />
            <div className="mr-scanlines" />
          </Box>

          <Box position="relative" zIndex={2} minH="80px">
            {inView && (
              <iframe
                ref={iframeRef}
                src={`https://platform.twitter.com/embed/Tweet.html?id=${tweetId}&theme=dark&dnt=true&chrome=nofooter`}
                width="100%"
                height={iframeHeight}
                style={{ border: 'none', display: 'block' }}
                title={`Tweet ${tweetId}`}
              />
            )}
          </Box>

          <HStack
            spacing={2}
            justify="flex-end"
            px={3}
            py={2}
            position="relative"
            zIndex={3}
            borderTop="1px solid rgba(0,162,255,0.12)"
          >
            {item.post_url && (
              <Button
                as="a"
                href={item.post_url}
                target="_blank"
                size="xs"
                variant="ghost"
                colorScheme="blue"
                leftIcon={<FiExternalLink />}
                onClick={(e) => e.stopPropagation()}
              >
                View on X
              </Button>
            )}
            {!item.thread_id && item.post_url && (
              <Button
                size="xs"
                colorScheme="blue"
                variant="outline"
                leftIcon={<FiDownload />}
                onClick={(e) => { e.stopPropagation(); handleImportThread(); }}
                isLoading={isImporting}
              >
                Import
              </Button>
            )}
          </HStack>
        </Box>
      )}

      {/* TT Analysis overlay */}
      {item.tt_metadata && (item.tt_metadata.discussion_count > 0 || item.tt_metadata.evidence_count > 0 || item.tt_metadata.verimeter_score) && (
        <Box
          className="mr-card mr-card-blue"
          position="relative"
          overflow="hidden"
          mt={2}
          maxW="550px"
          mx="auto"
        >
          <div className="mr-glow-bar mr-glow-bar-blue" />
          <div className="mr-scanlines" />
          <Box p={3} position="relative" zIndex={3}>
            <VStack align="stretch" spacing={2}>
              <HStack justify="space-between">
                <Text fontSize="xs" fontWeight="bold" className="mr-text-primary">
                  TRUTHTROLLERS ANALYSIS
                </Text>
                {item.tt_metadata.is_monitored && (
                  <Badge colorScheme="green" fontSize="xs">
                    <Icon as={FiEye} mr={1} />
                    Monitored
                  </Badge>
                )}
              </HStack>
              <HStack spacing={4} fontSize="sm" flexWrap="wrap">
                {item.tt_metadata.discussion_count > 0 && (
                  <HStack>
                    <Icon as={FiMessageCircle} color="blue.400" />
                    <Text fontWeight="semibold" className="mr-text-primary">{item.tt_metadata.discussion_count}</Text>
                    <Text className="mr-text-secondary">TT discussions</Text>
                  </HStack>
                )}
                {item.tt_metadata.evidence_count > 0 && (
                  <HStack>
                    <Icon as={FiShield} color="green.400" />
                    <Text fontWeight="semibold" className="mr-text-primary">{item.tt_metadata.evidence_count}</Text>
                    <Text className="mr-text-secondary">evidence links</Text>
                  </HStack>
                )}
                {item.tt_metadata.verimeter_score && (
                  <HStack>
                    <Icon as={FiShield} color="teal.400" />
                    <Text fontWeight="semibold" className="mr-text-primary">{item.tt_metadata.verimeter_score.toFixed(1)}</Text>
                    <Text className="mr-text-secondary">verimeter</Text>
                  </HStack>
                )}
              </HStack>
              {item.thread_id && (
                <Button
                  size="sm"
                  colorScheme="blue"
                  variant="solid"
                  rightIcon={<FiArrowRight />}
                  onClick={(e) => { e.stopPropagation(); handleOpenThread(); }}
                >
                  Open in TT Discussion
                </Button>
              )}
            </VStack>
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default TTLiveFeedItemCard;
