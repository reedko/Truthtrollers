import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Card,
  CardBody,
  Text,
  Button,
  VStack,
  HStack,
  Badge,
  Progress,
  Divider,
  Heading,
  Icon,
  Flex,
  useColorModeValue,
  Kbd,
  useToast,
  IconButton,
  Drawer,
  DrawerBody,
  DrawerHeader,
  DrawerOverlay,
  DrawerContent,
  DrawerCloseButton,
  useDisclosure,
  useBreakpointValue
} from '@chakra-ui/react';
import { keyframes } from '@emotion/react';
import {
  FaThumbsUp,
  FaThumbsDown,
  FaInfoCircle,
  FaCopy,
  FaStepForward,
  FaStar,
  FaChartLine,
  FaLink,
  FaArrowLeft,
  FaArrowRight,
  FaBars
} from 'react-icons/fa';
import { useTaskStore } from '../store/useTaskStore';
import { useAuthStore } from '../store/useAuthStore';
import { addClaimLink, fetchLiveVerimeterScore, fetchClaimScoresForTask } from '../services/useDashboardAPI';
import { fetchReferenceClaimTaskLinks } from '../services/referenceClaimRelevance';
import ClaimLinkModal from '../components/modals/ClaimLinkModal';
import VerimeterMeter from '../components/VerimeterMeter';

const API_BASE_URL = import.meta.env.VITE_BASE_URL || 'https://localhost:5001';

interface FocusClaim {
  claim_id: number;
  claim_text: string;
  claim_type: 'case' | 'evidence';
  verimeter_score?: number;
  support_count: number;
  refute_count: number;
  context_count: number;
  evidence_count: number;
  stance_distribution: {
    support: number;
    refute: number;
    context: number;
  };
}

interface CandidateClaim {
  claim_id: number;
  claim_text: string;
  source_name: string;
  source_url?: string; // URL of the source content
  relevance_score: number;
  claim_type: 'evidence';
  reference_content_id: number;
  source_claim_id: number; // Individual reference claim ID
  source_reliability?: number; // Verimeter score of the source claim (-100 to 100)
  ai_confidence?: number; // AI's confidence in the link assessment (0-1)
  ai_stance?: string; // AI's stance: support, refute, nuance, insufficient
  ai_support_level?: number; // AI's support level from reference_claim_task_links (-1 to 1)
  ai_rationale?: string; // AI's rationale from reference_claim_task_links
  existing_link?: {
    relationship_type: string;
    created_at: string;
  };
}

export default function ClaimDuelPage() {
  const { selectedTask } = useTaskStore(); // ✅ FIX: Use selectedTask, not currentTask
  const { user } = useAuthStore();
  const toast = useToast();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const isMobile = useBreakpointValue({ base: true, md: false });

  // Debug: Log current task on mount and when it changes
  useEffect(() => {
    console.log('🎯 ClaimDuelPage mounted/updated');
    console.log('   Selected case:', selectedTask);
    console.log('   Case ID:', selectedTask?.content_id);
    console.log('   User:', user?.user_id);
  }, [selectedTask, user]);

  const [focusClaim, setFocusClaim] = useState<FocusClaim | null>(null);
  const [candidates, setCandidates] = useState<CandidateClaim[]>([]);
  const [currentCandidateIndex, setCurrentCandidateIndex] = useState(0);
  const [isLinking, setIsLinking] = useState(false);
  const [score, setScore] = useState(0);
  const [totalLinked, setTotalLinked] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [availableCaseClaims, setAvailableCaseClaims] = useState<any[]>([]);

  // Modal state for claim linking
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalRelationship, setModalRelationship] = useState<'supports' | 'refutes'>('supports');
  const [modalSupportLevel, setModalSupportLevel] = useState(0);

  // Refs for syncing claim box heights
  const caseClaimBoxRef = useRef<HTMLDivElement>(null);
  const sourceClaimBoxRef = useRef<HTMLDivElement>(null);

  // Minority Report aesthetic colors with strong 3D depth and enhanced transparency
  const bgGradient = 'linear(to-br, #0a0e27, #1a1f3a, #0f1129)';
  const glassCardBg = 'rgba(15, 20, 40, 0.25)'; // More transparent
  const glassCardBgDeep = 'rgba(10, 14, 30, 0.35)'; // More transparent
  const glassBorder = 'rgba(0, 212, 255, 0.4)'; // Slightly more visible
  const accentGlow = '0 0 20px rgba(0, 212, 255, 0.3), 0 0 40px rgba(0, 212, 255, 0.1)';
  const textGlow = '0 0 10px rgba(0, 212, 255, 0.5)';

  // Enhanced 3D shadow system
  const cardShadow3D = '0 8px 32px 0 rgba(0, 0, 0, 0.5), 0 4px 16px 0 rgba(0, 212, 255, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1)';
  const cardShadowDeep = '0 12px 48px 0 rgba(0, 0, 0, 0.6), 0 6px 24px 0 rgba(0, 212, 255, 0.3), inset 0 2px 0 rgba(255, 255, 255, 0.15)';
  const buttonShadow3D = '0 4px 16px rgba(0, 0, 0, 0.4), 0 2px 8px rgba(0, 212, 255, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1)';
  const accentBg = 'rgba(0, 212, 255, 0.05)';

  // Holographic animations
  const pulseGlow = keyframes`
    0%, 100% { box-shadow: 0 0 20px rgba(0, 212, 255, 0.3), 0 0 40px rgba(0, 212, 255, 0.1); }
    50% { box-shadow: 0 0 30px rgba(0, 212, 255, 0.5), 0 0 60px rgba(0, 212, 255, 0.2); }
  `;

  const scanLine = keyframes`
    0% { transform: translateY(-100%); opacity: 0.1; }
    50% { opacity: 0.3; }
    100% { transform: translateY(200%); opacity: 0.1; }
  `;

  const shimmer = keyframes`
    0% { background-position: -1000px 0; }
    100% { background-position: 1000px 0; }
  `;

  // Sync claim box heights
  useEffect(() => {
    const syncHeights = () => {
      if (caseClaimBoxRef.current && sourceClaimBoxRef.current) {
        // Reset heights first
        caseClaimBoxRef.current.style.minHeight = 'auto';
        sourceClaimBoxRef.current.style.minHeight = 'auto';

        // Get natural heights
        const caseHeight = caseClaimBoxRef.current.scrollHeight;
        const sourceHeight = sourceClaimBoxRef.current.scrollHeight;

        // Set both to max height
        const maxHeight = Math.max(caseHeight, sourceHeight);
        caseClaimBoxRef.current.style.minHeight = `${maxHeight}px`;
        sourceClaimBoxRef.current.style.minHeight = `${maxHeight}px`;
      }
    };

    // Sync on mount and when content changes
    syncHeights();

    // Also sync on window resize
    window.addEventListener('resize', syncHeights);
    return () => window.removeEventListener('resize', syncHeights);
  }, [focusClaim, currentCandidateIndex, candidates]);

  // Load available case claims when case changes
  useEffect(() => {
    if (selectedTask?.content_id) {
      loadAvailableCaseClaims();
    }
  }, [selectedTask?.content_id]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case 's':
          handleLink('supports');
          break;
        case 'r':
          handleLink('refutes');
          break;
        case 'c':
          handleLink('context');
          break;
        case 'd':
          handleLink('duplicate');
          break;
        case ' ':
          e.preventDefault();
          handleSkip();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [isLinking]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadAvailableCaseClaims = async () => {
    if (!selectedTask?.content_id) {
      console.log('⚠️ No case selected, cannot load claims');
      return;
    }

    console.log('📋 Loading case claims for case:', selectedTask.content_id);
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/case-claim-expansion/${selectedTask.content_id}`);
      console.log('📡 Case claims response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Failed to load case claims:', errorText);
        throw new Error('Failed to load case claims');
      }

      const data = await response.json();
      console.log('✅ Case claims data:', data);
      console.log('📊 Found', data.caseClaims?.length || 0, 'case claims');

      setAvailableCaseClaims(data.caseClaims || []);

      // Don't auto-load - let user select
      // if (data.caseClaims && data.caseClaims.length > 0) {
      //   await loadFocusClaim(data.caseClaims[0].claim_id);
      // }
    } catch (error) {
      console.error('❌ Error loading case claims:', error);
      toast({
        title: 'Error loading claims',
        description: error instanceof Error ? error.message : 'Failed to load case claims for this task',
        status: 'error',
        duration: 5000,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const loadFocusClaim = async (claimId: number) => {
    if (!selectedTask?.content_id || !user?.user_id) return;

    setIsLoading(true);
    try {
      // Get existing linked claims to calculate stance distribution
      console.log('🔍 Fetching linked claims for claimId:', claimId, 'viewerId:', user.user_id);
      const linkedResponse = await fetch(`${API_BASE_URL}/api/linked-claims-for-claim/${claimId}?viewerId=${user.user_id}`);
      const linkedClaims = linkedResponse.ok ? await linkedResponse.json() : [];
      console.log('📊 Linked claims response:', linkedClaims);
      console.log('📊 Total linked claims found:', linkedClaims.length);

      // Fetch verimeter score using the proper API that calls the stored procedure
      console.log('🔍 Fetching verimeter scores via SP for contentId:', selectedTask.content_id, 'userId:', user.user_id);
      const claimScores = await fetchClaimScoresForTask(selectedTask.content_id, user.user_id);
      console.log('📊 All claim scores returned:', claimScores);
      const verimeterScore = claimScores[claimId] ?? null;
      console.log('📊 Verimeter score for claim', claimId, ':', verimeterScore);
      console.log('📊 Type of verimeter score:', typeof verimeterScore);

      const verimeterData = {
        verimeter_score: verimeterScore,
        num_links: linkedClaims.length,
        num_references: 0,
        avg_reference_veracity: null,
        avg_reference_bias: null
      };

      // Calculate stance distribution
      // Note: Backend returns "relation" field with values "support", "refute", etc.
      const supportCount = linkedClaims.filter((lc: any) => lc.relation === 'support' || lc.relationship === 'supports').length;
      const refuteCount = linkedClaims.filter((lc: any) => lc.relation === 'refute' || lc.relationship === 'refutes').length;
      const contextCount = linkedClaims.filter((lc: any) => lc.relation === 'nuance' || lc.relation === 'context' || lc.relationship === 'related').length;
      const total = supportCount + refuteCount + contextCount || 1;
      console.log('📊 Counts - Support:', supportCount, 'Refute:', refuteCount, 'Context:', contextCount);

      // Find the claim in available claims to get text
      const claimData = availableCaseClaims.find(c => c.claim_id === claimId);

      const focus: FocusClaim = {
        claim_id: claimId,
        claim_text: claimData?.label || 'Loading...',
        claim_type: 'case',
        verimeter_score: verimeterData?.verimeter_score !== null && verimeterData?.verimeter_score !== undefined
          ? Math.round(verimeterData.verimeter_score * 100)
          : 50, // Default to 50% if no links yet
        support_count: supportCount,
        refute_count: refuteCount,
        context_count: contextCount,
        evidence_count: verimeterData?.num_links || 0,
        stance_distribution: {
          support: Math.round((supportCount / total) * 100),
          refute: Math.round((refuteCount / total) * 100),
          context: Math.round((contextCount / total) * 100),
        }
      };

      setFocusClaim(focus);
      await loadCandidates(claimId);
    } catch (error) {
      console.error('Error loading focus claim:', error);
      toast({
        title: 'Error loading claim',
        description: 'Failed to load claim details',
        status: 'error',
        duration: 3000,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const loadCandidates = async (focusClaimId: number) => {
    if (!selectedTask?.content_id || !user?.user_id) return;

    console.log('🎯 Loading candidates for claim:', focusClaimId);
    setIsLoading(true);

    try {
      // DEEP SCAN: Get ALL reference claims from ALL sources for this case
      const refsResponse = await fetch(
        `${API_BASE_URL}/api/content/${selectedTask.content_id}/references-with-claims?viewerId=${user.user_id}`
      );

      if (!refsResponse.ok) {
        throw new Error('Failed to load references');
      }

      const references = await refsResponse.json();
      console.log('📚 Found', references.length, 'references with claims');

      // Get existing AI links for INDIVIDUAL CLAIMS (not just documents)
      // Uses the same service as workspace deep scan
      const existingLinks = await fetchReferenceClaimTaskLinks(focusClaimId);
      console.log('🔗 Existing claim-to-claim links:', existingLinks.length);
      console.log('🔗 Links breakdown:', {
        total: existingLinks.length,
        from_reference_claim_task_links: existingLinks.filter(l => l.source_table === 'reference_claim_task_links').length,
        from_claim_links_manual: existingLinks.filter(l => l.source_table?.includes('claim_links')).length,
      });

      // Flatten all reference claims into candidates
      const allCandidates: any[] = [];

      for (const ref of references) {
        const refClaims = Array.isArray(ref.claims)
          ? ref.claims
          : (typeof ref.claims === 'string' ? JSON.parse(ref.claims) : []);

        console.log(`   📦 Source "${ref.content_name}" has ${refClaims.length} claims`);

        for (const claim of refClaims) {
          // Check if THIS SPECIFIC CLAIM is already linked (match by reference_claim_id)
          const existingLink = existingLinks.find((link: any) =>
            link.reference_claim_id === claim.claim_id
          );

          allCandidates.push({
            claim_id: focusClaimId,
            claim_text: claim.claim_text,
            source_name: ref.content_name,
            source_url: ref.url, // Add the source URL
            relevance_score: existingLink?.score || 0, // Use AI score if exists, otherwise 0
            claim_type: 'evidence' as const,
            reference_content_id: ref.reference_content_id,
            source_claim_id: claim.claim_id,
            ai_confidence: existingLink?.confidence, // AI's confidence from reference_claim_task_links
            ai_stance: existingLink?.stance, // AI's stance: support, refute, nuance, insufficient
            ai_support_level: existingLink?.support_level, // AI's support level (-1 to 1)
            ai_rationale: existingLink?.rationale, // AI's rationale from reference_claim_task_links
            existing_link: existingLink?.verified_by_user_id ? {
              relationship_type: existingLink.stance,
              created_at: existingLink.created_at
            } : undefined
          });
        }
      }

      console.log('📊 Total candidates from deep scan:', allCandidates.length);
      console.log('📊 Unique sources:', new Set(allCandidates.map(c => c.reference_content_id)).size);
      console.log('📊 AI-suggested (score > 0):', allCandidates.filter(c => c.relevance_score > 0).length);
      console.log('📊 Has existing link:', allCandidates.filter(c => c.existing_link).length);

      // 🎯 SHOW ALL CLAIMS: Allow users to review all candidates, not just AI-suggested ones
      // Sort by: 1) Already linked, 2) AI-suggested (score > 0), 3) All others
      const relevantCandidates = allCandidates.sort((a, b) => {
        // Already linked claims first
        if (a.existing_link && !b.existing_link) return -1;
        if (!a.existing_link && b.existing_link) return 1;

        // Then AI-suggested claims (score > 0)
        if (a.relevance_score > 0 && b.relevance_score === 0) return -1;
        if (a.relevance_score === 0 && b.relevance_score > 0) return 1;

        // Within AI-suggested, sort by score descending
        if (a.relevance_score > 0 && b.relevance_score > 0) {
          return b.relevance_score - a.relevance_score;
        }

        // All others maintain their order
        return 0;
      });

      console.log('📊 After sorting: ' + relevantCandidates.length + ' total candidates (all claims available for review)');

      // Fetch Verimeter scores for all source claims to show reliability
      console.log('🎯 Fetching Verimeter scores for source claims...');
      const uniqueSourceClaimIds = Array.from(new Set(relevantCandidates.map(c => c.source_claim_id)));
      console.log(`   📊 Fetching scores for ${uniqueSourceClaimIds.length} unique source claims`);

      const scorePromises = uniqueSourceClaimIds.map(claimId =>
        fetchLiveVerimeterScore(claimId, user.user_id).catch(err => {
          console.warn(`Failed to fetch score for claim ${claimId}:`, err);
          return null;
        })
      );

      const scores = await Promise.all(scorePromises);
      const scoreMap = new Map();

      uniqueSourceClaimIds.forEach((claimId, index) => {
        if (scores[index] !== null) {
          // Extract the verimeter_score from the returned object
          scoreMap.set(claimId, scores[index].verimeter_score);
        }
      });

      console.log(`   ✅ Loaded ${scoreMap.size} Verimeter scores`);

      // Add reliability scores to candidates
      relevantCandidates.forEach(candidate => {
        candidate.source_reliability = scoreMap.get(candidate.source_claim_id);
      });

      // Sort by relevance score (AI-suggested first, then alphabetically)
      relevantCandidates.sort((a, b) => {
        // Prioritize AI-suggested (those with relevance_score > 0)
        if (a.relevance_score > 0 && b.relevance_score === 0) return -1;
        if (b.relevance_score > 0 && a.relevance_score === 0) return 1;
        if (a.relevance_score !== b.relevance_score) return b.relevance_score - a.relevance_score;
        // Then by source name
        return a.source_name.localeCompare(b.source_name);
      });

      setCandidates(relevantCandidates);
      setCurrentCandidateIndex(0);

      if (allCandidates.length === 0) {
        toast({
          title: 'No evidence found',
          description: 'This case doesn\'t have any reference sources yet',
          status: 'info',
          duration: 3000,
        });
      } else {
        console.log('✅ Loaded', allCandidates.length, 'candidates (AI-suggested first, then all others)');
      }
    } catch (error) {
      console.error('❌ Error loading candidates:', error);
      toast({
        title: 'Error loading evidence',
        description: 'Failed to load candidate evidence',
        status: 'error',
        duration: 3000,
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Open the claim link modal with pre-filled AI data
  const handleLink = (relationshipType: 'supports' | 'refutes' | 'context' | 'duplicate') => {
    if (!focusClaim || !currentCandidate) return;

    // Map relationship types to modal format
    const relationshipMap: Record<string, 'supports' | 'refutes'> = {
      supports: 'supports',
      refutes: 'refutes',
      context: 'supports', // Context/nuance defaults to supports
      duplicate: 'supports'
    };

    // Calculate support level based on relationship and AI confidence
    let supportLevel = 0;
    if (relationshipType === 'supports') supportLevel = currentCandidate.ai_confidence || 1.0;
    else if (relationshipType === 'refutes') supportLevel = -(currentCandidate.ai_confidence || 1.0);
    else if (relationshipType === 'context') supportLevel = currentCandidate.ai_confidence ? currentCandidate.ai_confidence * 0.5 : 0.5;
    else if (relationshipType === 'duplicate') supportLevel = 1.0;

    setModalRelationship(relationshipMap[relationshipType]);
    setModalSupportLevel(supportLevel);
    setIsModalOpen(true);
  };

  // Navigation functions
  const handlePrevious = () => {
    if (currentCandidateIndex > 0) {
      setCurrentCandidateIndex(currentCandidateIndex - 1);
    }
  };

  const handleNext = () => {
    if (currentCandidateIndex < candidates.length - 1) {
      setCurrentCandidateIndex(currentCandidateIndex + 1);
    } else {
      // Loop back to the beginning to allow continuous review
      setCurrentCandidateIndex(0);
    }
  };

  // Called when modal link is created
  const handleModalLinkCreated = async () => {
    const pointsEarned = 10 * (currentCandidate!.relevance_score / 100);
    setScore(Math.round(score + pointsEarned));
    setTotalLinked(totalLinked + 1);

    // Reload focus claim to update verimeter score
    if (focusClaim?.claim_id) {
      await loadFocusClaim(focusClaim.claim_id);
    }

    // Move to next candidate
    handleNext();
    setIsModalOpen(false);
  };

  const handleSkip = () => {
    if (currentCandidateIndex < candidates.length - 1) {
      setCurrentCandidateIndex(currentCandidateIndex + 1);
    } else {
      // Loop back to the beginning to allow continuous review
      setCurrentCandidateIndex(0);
      toast({
        title: 'Looped back to start',
        description: 'You can continue reviewing all candidates',
        status: 'info',
        duration: 2000,
      });
    }
  };

  const handleSelectClaim = async (claimId: number) => {
    await loadFocusClaim(claimId);
  };

  const currentCandidate = candidates[currentCandidateIndex];
  const progressPercent = candidates.length > 0 ? ((currentCandidateIndex + 1) / candidates.length) * 100 : 0;

  // Show appropriate message if no case selected
  if (!selectedTask?.content_id) {
    return (
      <Flex h="calc(100vh - 64px)" align="center" justify="center" bgGradient={bgGradient}>
        <Card
          maxW="500px"
          p={8}
          bg={glassCardBg}
          backdropFilter="blur(20px)"
          border="1px solid"
          borderColor={glassBorder}
          boxShadow={cardShadow3D}
        >
          <VStack spacing={4}>
            <Icon as={FaInfoCircle} boxSize={16} color="cyan.400" filter="drop-shadow(0 0 8px rgba(0, 212, 255, 0.6))" />
            <Heading size="lg" color="cyan.300" textShadow={textGlow}>No Case Selected</Heading>
            <Text textAlign="center" color="gray.400">
              Please select a case from your workspace before using Claim Duel
            </Text>
            <Button
              as="a"
              href="/workspace"
              bg="rgba(0, 212, 255, 0.2)"
              color="cyan.300"
              border="1px solid"
              borderColor="cyan.500"
              _hover={{ bg: 'rgba(0, 212, 255, 0.3)', boxShadow: accentGlow }}
              leftIcon={<Icon as={FaStar} />}
            >
              Go to Workspace
            </Button>
          </VStack>
        </Card>
      </Flex>
    );
  }

  return (
    <Flex
      h="calc(100vh - 64px)"
      overflow="hidden"
      direction="column"
      bg="radial-gradient(circle at bottom left, rgba(20, 184, 255, 0.35) 0%, rgba(6, 78, 130, 0.5) 50%, rgba(10, 25, 47, 0.8) 100%)"
      position="relative"
    >
      {/* CLAIM SELECTOR BAR */}
      {!focusClaim && availableCaseClaims.length > 0 && (
        <Box
          bg="transparent"
          p={6}
          position="relative"
        >
          <VStack spacing={3} align="stretch">
            <HStack>
              <Icon
                as={FaStar}
                color="cyan.400"
                boxSize={5}
                filter="drop-shadow(0 0 8px rgba(0, 212, 255, 0.6))"
              />
              <Heading size="md" color="cyan.300" textShadow={textGlow}>Select a Case Claim to Start</Heading>
            </HStack>
            <Text fontSize="sm" color="gray.500">
              Choose a claim to link evidence and improve its verimeter score
            </Text>
            <VStack spacing={3} align="stretch" maxH="300px" overflowY="auto">
              {availableCaseClaims.map((claim) => (
                <Card
                  key={claim.claim_id}
                  cursor="pointer"
                  bg={glassCardBg}
                  backdropFilter="blur(15px)"
                  border="2px solid"
                  borderColor={glassBorder}
                  borderRadius="16px"
                  boxShadow={cardShadow3D}
                  transform="translateZ(0)"
                  position="relative"
                  overflow="visible"
                  _hover={{
                    bg: 'rgba(0, 212, 255, 0.15)',
                    transform: 'translateY(-4px) translateZ(0)',
                    boxShadow: '0 12px 40px rgba(0, 0, 0, 0.6), 0 0 40px rgba(0, 212, 255, 0.5), inset 0 2px 0 rgba(255, 255, 255, 0.2)',
                    borderColor: 'cyan.400'
                  }}
                  _active={{
                    transform: 'translateY(-1px)',
                    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4), 0 0 20px rgba(0, 212, 255, 0.4)'
                  }}
                  transition="all 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
                  onClick={() => handleSelectClaim(claim.claim_id)}
                >
                  {/* Curved left edge gradient */}
                  <Box
                    position="absolute"
                    left={0}
                    top={0}
                    width="24px"
                    height="100%"
                    background="linear-gradient(90deg, rgba(0, 212, 255, 0.5) 0%, transparent 100%)"
                    borderLeftRadius="16px"
                    pointerEvents="none"
                    zIndex={0}
                  />
                  <CardBody p={4} position="relative" zIndex={1}>
                    <HStack justify="space-between">
                      <Text fontSize="sm" flex="1" color="gray.100" fontWeight="medium">{claim.label}</Text>
                      <Badge
                        colorScheme="purple"
                        bg="rgba(138, 43, 226, 0.3)"
                        color="purple.200"
                        border="1px solid"
                        borderColor="purple.400"
                        px={3}
                        py={1}
                      >
                        {claim.linkedSourceCount} sources
                      </Badge>
                    </HStack>
                  </CardBody>
                </Card>
              ))}
            </VStack>
          </VStack>
        </Box>
      )}

      {/* LOADING STATE */}
      {!focusClaim && isLoading && (
        <Flex flex="1" align="center" justify="center">
          <VStack spacing={4}>
            <Progress size="xs" isIndeterminate w="200px" colorScheme="purple" />
            <Text color="gray.500">Loading claims...</Text>
          </VStack>
        </Flex>
      )}

      {/* NO CLAIMS FOUND */}
      {!focusClaim && !isLoading && availableCaseClaims.length === 0 && (
        <Flex flex="1" align="center" justify="center">
          <Card maxW="500px" p={8}>
            <VStack spacing={4}>
              <Icon as={FaInfoCircle} boxSize={16} color="gray.400" />
              <Heading size="lg">No Claims Found</Heading>
              <Text textAlign="center" color="gray.500">
                This case doesn't have any claims yet. Add some claims in the workspace first.
              </Text>
              <Button
                as="a"
                href="/workspace"
                colorScheme="purple"
                leftIcon={<Icon as={FaStar} />}
              >
                Go to Workspace
              </Button>
            </VStack>
          </Card>
        </Flex>
      )}

      {/* MOBILE HEADER - Only show when claim is selected on mobile */}
      {focusClaim && isMobile && (
        <Box
          bg={glassCardBg}
          backdropFilter="blur(30px)"
          borderBottom="2px solid"
          borderColor={glassBorder}
          p={4}
          boxShadow={cardShadow3D}
        >
          <HStack spacing={3} mb={3}>
            <IconButton
              aria-label="Menu"
              icon={<Icon as={FaBars} />}
              onClick={onOpen}
              variant="ghost"
              color="cyan.300"
              _hover={{ bg: 'rgba(0, 212, 255, 0.2)' }}
            />
            <Heading size="sm" color="cyan.300" textShadow={textGlow} flex="1">
              Claim Duel
            </Heading>
            <Badge colorScheme="purple" px={2}>
              {currentCandidateIndex + 1}/{candidates.length}
            </Badge>
          </HStack>
          {/* Current case claim being dueled */}
          <Box
            p={3}
            bg="rgba(138, 43, 226, 0.1)"
            backdropFilter="blur(20px)"
            borderRadius="12px"
            border="1px solid"
            borderColor="rgba(138, 43, 226, 0.4)"
            position="relative"
            overflow="visible"
          >
            <Box
              position="absolute"
              left={0}
              top={0}
              width="20px"
              height="100%"
              background="linear-gradient(90deg, rgba(167, 139, 250, 0.6) 0%, transparent 100%)"
              borderLeftRadius="12px"
              pointerEvents="none"
            />
            <Text fontSize="xs" color="purple.300" mb={1} fontWeight="bold" position="relative" zIndex={1}>
              FOCUS CLAIM
            </Text>
            <Text fontSize="lg" lineHeight="tall" fontWeight="medium" color="gray.100" noOfLines={2} mb={2} position="relative" zIndex={1}>
              {focusClaim.claim_text}
            </Text>
            {/* Mobile stats */}
            <HStack spacing={2} flexWrap="wrap" position="relative" zIndex={1}>
              <Badge colorScheme="gray" fontSize="xs">
                <Icon as={FaLink} boxSize={2} mr={1} />
                {focusClaim.evidence_count}
              </Badge>
              <Badge colorScheme="green" fontSize="xs">
                <Icon as={FaThumbsUp} boxSize={2} mr={1} />
                {focusClaim.support_count}
              </Badge>
              <Badge colorScheme="red" fontSize="xs">
                <Icon as={FaThumbsDown} boxSize={2} mr={1} />
                {focusClaim.refute_count}
              </Badge>
              <Badge colorScheme="blue" fontSize="xs">
                <Icon as={FaInfoCircle} boxSize={2} mr={1} />
                {focusClaim.context_count}
              </Badge>
            </HStack>
            {/* Verimeter Bar for Mobile */}
            <Box mt={2} position="relative" zIndex={1}>
              <VerimeterMeter
                score={focusClaim.verimeter_score / 100}
                width="100%"
                showInterpretation={false}
              />
            </Box>
          </Box>
        </Box>
      )}

      {/* MAIN DUEL INTERFACE */}
      <Flex flex="1" overflow="hidden" direction={{ base: 'column', md: 'row' }}>
        {/* LEFT RAIL - FOCUS CLAIM (FIXED) - Hidden on mobile when claim selected */}
        <Box
          display={{ base: focusClaim ? 'none' : 'block', md: 'block' }}
          w={{ base: '100%', md: '40%' }}
          borderRight={{ base: 'none', md: '3px solid' }}
          borderColor={glassBorder}
          p={6}
          overflowY="auto"
          overflowX="hidden"
          bg="transparent"
          position="relative"
          willChange="transform"
          sx={{
            '&::-webkit-scrollbar': {
              width: '8px',
              display: 'none', // Hide scrollbar completely to prevent flicker
            },
            '&::-webkit-scrollbar-track': {
              background: 'transparent',
            },
            '&::-webkit-scrollbar-thumb': {
              background: 'rgba(0, 212, 255, 0.3)',
              borderRadius: '4px',
            },
            '&::-webkit-scrollbar-thumb:hover': {
              background: 'rgba(0, 212, 255, 0.5)',
            },
            '&:hover::-webkit-scrollbar': {
              display: 'block', // Show scrollbar on hover
            },
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(0, 212, 255, 0.3) transparent',
          }}
        >
          <VStack spacing={4} align="stretch">
            {/* Header - Matching CANDIDATE EVIDENCE */}
            <Box mb={4}>
              <HStack justify="space-between" align="center" mb={2} flexWrap={{ base: "wrap", md: "nowrap" }}>
                {focusClaim && availableCaseClaims.length > 1 ? (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      console.log('🔘 Button clicked!');
                      setFocusClaim(null);
                    }}
                    _hover={{
                      bg: 'rgba(0, 212, 255, 0.15)',
                      transform: 'translateY(-1px)',
                    }}
                    transition="all 0.2s ease"
                    px={3}
                    py={2}
                    height="auto"
                    minH="28px"
                    fontSize="xs"
                    fontWeight="bold"
                    color="cyan.300"
                    textTransform="uppercase"
                    letterSpacing="2px"
                    position="relative"
                    zIndex={10}
                    cursor="pointer"
                  >
                    CASE CLAIM (Change)
                  </Button>
                ) : (
                  <Text fontSize="xs" fontWeight="bold" color="cyan.300" textTransform="uppercase" letterSpacing="2px">
                    CASE CLAIM
                  </Text>
                )}
                {/* Verimeter Bar - positioned to the right of Case Claim button on desktop, below on mobile */}
                {focusClaim && focusClaim.verimeter_score !== undefined && (
                  <Box
                    flex={{ base: "0 0 100%", md: "1" }}
                    ml={{ base: 0, md: 2 }}
                    mt={{ base: 2, md: 0 }}
                    maxW={{ base: "100%", md: "400px" }}
                    order={{ base: 3, md: 2 }}
                  >
                    <VerimeterMeter
                      score={focusClaim.verimeter_score / 100}
                      width="100%"
                      showInterpretation={false}
                    />
                  </Box>
                )}
              </HStack>

              {/* Stance Distribution Progress Bar */}
              <Progress
                value={(score / 100) * 100}
                size="sm"
                colorScheme="cyan"
                borderRadius="full"
                bg="rgba(0, 212, 255, 0.1)"
              />
            </Box>

          {/* Focus Claim - Mirroring Candidate Card Structure */}
          {focusClaim && (
            <Card
              bg={glassCardBg}
              backdropFilter="blur(10px)"
              borderTop="4px solid"
              borderTopColor="cyan.500"
              border="2px solid"
              borderColor={glassBorder}
              borderRadius="16px"
              boxShadow={cardShadowDeep}
              minH={{ base: 'auto', md: '500px' }}
              position="relative"
              overflow="visible"
              transform="translateZ(0)"
              willChange="transform"
            >
              {/* Curved left edge gradient */}
              <Box
                position="absolute"
                left={0}
                top={0}
                width="24px"
                height="100%"
                background="linear-gradient(90deg, rgba(0, 162, 255, 0.5) 0%, transparent 100%)"
                borderLeftRadius="16px"
                pointerEvents="none"
                zIndex={0}
              />
              <CardBody position="relative" zIndex={1}>
                {/* Case Name and Metadata */}
                <Box mb={4}>
                  {/* Case Name Label */}
                  <Box mb={3}>
                    <Badge
                      variant="outline"
                      fontSize="md"
                      fontWeight="bold"
                      py={1}
                      px={2}
                      maxW="100%"
                      overflow="hidden"
                      textOverflow="ellipsis"
                      whiteSpace="nowrap"
                    >
                      {selectedTask?.content_name || 'Current Case'}
                    </Badge>
                  </Box>

                  {/* Metadata Row: Supports, Refutes, Nuances */}
                  <HStack spacing={3} wrap="nowrap" justify="center">
                    <Badge
                      colorScheme="green"
                      fontSize="lg"
                      px={4}
                      py={2}
                    >
                      {focusClaim.support_count} Supports
                    </Badge>

                    <Badge
                      colorScheme="red"
                      fontSize="lg"
                      px={4}
                      py={2}
                    >
                      {focusClaim.refute_count} Refutes
                    </Badge>

                    <Badge
                      colorScheme="blue"
                      fontSize="lg"
                      px={4}
                      py={2}
                    >
                      {focusClaim.context_count} Nuances
                    </Badge>
                  </HStack>
                </Box>

                {/* Claim Text Box - Matching source claim style */}
                <Box
                  ref={caseClaimBoxRef}
                  p={5}
                  bg="rgba(0, 212, 255, 0.08)"
                  backdropFilter="blur(25px)"
                  borderRadius="16px"
                  border="2px solid"
                  borderColor="rgba(0, 212, 255, 0.4)"
                  boxShadow="0 6px 24px rgba(0, 0, 0, 0.4), 0 0 30px rgba(0, 212, 255, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1)"
                  mb={4}
                  transform="translateZ(0)"
                  transition="all 0.3s ease"
                  position="relative"
                  overflow="visible"
                  _hover={{
                    transform: 'translateY(-2px) translateZ(0)',
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5), 0 0 40px rgba(0, 212, 255, 0.3), inset 0 2px 0 rgba(255, 255, 255, 0.15)'
                  }}
                >
                  {/* Curved left edge gradient */}
                  <Box
                    position="absolute"
                    left={0}
                    top={0}
                    width="24px"
                    height="100%"
                    background="linear-gradient(90deg, rgba(0, 212, 255, 0.6) 0%, transparent 100%)"
                    borderLeftRadius="16px"
                    pointerEvents="none"
                    zIndex={0}
                  />
                  <Text fontSize="3xl" lineHeight="tall" fontWeight="medium" color="gray.100" position="relative" zIndex={1}>
                    {focusClaim.claim_text}
                  </Text>
                </Box>

                {/* Evidence Summary - Matching AI Rationale exactly */}
                <Box
                  p={5}
                  bg="rgba(167, 139, 250, 0.1)"
                  backdropFilter="blur(25px)"
                  borderRadius="16px"
                  border="2px solid"
                  borderColor="rgba(167, 139, 250, 0.4)"
                  boxShadow="0 6px 24px rgba(0, 0, 0, 0.4), 0 0 25px rgba(167, 139, 250, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1)"
                  transform="translateZ(0)"
                  transition="all 0.3s ease"
                  position="relative"
                  overflow="visible"
                  _hover={{
                    transform: 'translateY(-2px) translateZ(0)',
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5), 0 0 35px rgba(167, 139, 250, 0.4), inset 0 2px 0 rgba(255, 255, 255, 0.15)'
                  }}
                >
                  {/* Curved left edge gradient */}
                  <Box
                    position="absolute"
                    left={0}
                    top={0}
                    width="24px"
                    height="100%"
                    background="linear-gradient(90deg, rgba(167, 139, 250, 0.6) 0%, transparent 100%)"
                    borderLeftRadius="16px"
                    pointerEvents="none"
                    zIndex={0}
                  />
                  <Box position="relative" zIndex={1}>
                    <Text fontSize="xs" fontWeight="bold" color="purple.300" mb={2} textTransform="uppercase" letterSpacing="2px">
                      Evidence Summary
                    </Text>
                    <Text fontSize="md" color="gray.200" lineHeight="tall">
                      This case claim has {focusClaim.evidence_count} pieces of evidence: {focusClaim.support_count} supporting, {focusClaim.refute_count} refuting, and {focusClaim.context_count} providing nuanced context. The verimeter score is {focusClaim.verimeter_score}%.
                    </Text>
                  </Box>
                </Box>
              </CardBody>
            </Card>
          )}

          {/* Action Guide */}
          <Card
            bg={accentBg}
            backdropFilter="blur(20px)"
            border="2px solid"
            borderColor={glassBorder}
            borderRadius="16px"
            boxShadow={cardShadow3D}
            transform="translateZ(0)"
            transition="all 0.3s ease"
            position="relative"
            overflow="visible"
            _hover={{
              transform: 'translateY(-2px) translateZ(0)',
              boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5), 0 0 30px rgba(0, 212, 255, 0.3)'
            }}
          >
            {/* Curved left edge gradient */}
            <Box
              position="absolute"
              left={0}
              top={0}
              width="24px"
              height="100%"
              background="linear-gradient(90deg, rgba(6, 182, 212, 0.5) 0%, transparent 100%)"
              borderLeftRadius="16px"
              pointerEvents="none"
              zIndex={0}
            />
            <CardBody position="relative" zIndex={1}>
              <Text fontSize="xs" fontWeight="bold" color="cyan.400" mb={2} letterSpacing="2px">QUICK GUIDE</Text>
              <VStack spacing={1} align="stretch">
                <HStack fontSize="xs">
                  <Icon as={FaThumbsUp} color="green.400" />
                  <Text color="gray.300">Support - Evidence backs up this claim</Text>
                </HStack>
                <HStack fontSize="xs">
                  <Icon as={FaThumbsDown} color="red.400" />
                  <Text color="gray.300">Refute - Evidence contradicts this claim</Text>
                </HStack>
                <HStack fontSize="xs">
                  <Icon as={FaInfoCircle} color="cyan.400" />
                  <Text color="gray.300">Context - Related background info</Text>
                </HStack>
                <HStack fontSize="xs">
                  <Icon as={FaCopy} color="gray.400" />
                  <Text color="gray.300">Duplicate - Says the same thing</Text>
                </HStack>
              </VStack>
            </CardBody>
          </Card>
        </VStack>
        </Box>

        {/* RIGHT PANEL - CANDIDATE CLAIMS */}
        <Box
          display={{ base: !focusClaim ? 'none' : 'block', md: 'block' }}
          flex="1"
          p={{ base: 4, md: 6 }}
          overflowY="auto"
          overflowX="hidden"
          bg="transparent"
          sx={{
            '&::-webkit-scrollbar': {
              width: '8px',
            },
            '&::-webkit-scrollbar-track': {
              background: 'transparent',
            },
            '&::-webkit-scrollbar-thumb': {
              background: 'rgba(0, 212, 255, 0.3)',
              borderRadius: '4px',
            },
            '&::-webkit-scrollbar-thumb:hover': {
              background: 'rgba(0, 212, 255, 0.5)',
            },
          }}
        >
        <VStack spacing={4} align="stretch">
          {/* Progress - Hidden on mobile (shown in header) */}
          <Box display={{ base: 'none', md: 'block' }} mb={4}>
            <HStack justify="space-between" align="center" mb={2}>
              <Box px={3} py={2} minH="28px" display="flex" alignItems="center">
                <Text fontSize="xs" fontWeight="bold" color="cyan.300" textTransform="uppercase" letterSpacing="2px">
                  CANDIDATE EVIDENCE
                </Text>
              </Box>
              <Badge colorScheme="purple" fontSize="xs">
                {currentCandidateIndex + 1} of {candidates.length}
              </Badge>
            </HStack>
            <Progress
              value={progressPercent}
              size="sm"
              colorScheme="cyan"
              borderRadius="full"
              bg="rgba(0, 212, 255, 0.1)"
            />
          </Box>

          {/* Current Candidate */}
          {currentCandidate ? (
            <Card
              bg={glassCardBg}
              backdropFilter="blur(10px)"
              borderTop="4px solid"
              borderTopColor="cyan.500"
              border="2px solid"
              borderColor={glassBorder}
              borderRadius="16px"
              boxShadow={cardShadowDeep}
              minH={{ base: 'auto', md: '500px' }}
              position="relative"
              overflow="visible"
              transform="translateZ(0)"
              willChange="transform"
            >
              {/* Curved left edge gradient */}
              <Box
                position="absolute"
                left={0}
                top={0}
                width="24px"
                height="100%"
                background="linear-gradient(90deg, rgba(0, 162, 255, 0.5) 0%, transparent 100%)"
                borderLeftRadius="16px"
                pointerEvents="none"
                zIndex={0}
              />
              <CardBody position="relative" zIndex={1}>
                {/* Source Name and Metadata */}
                <Box mb={4}>
                  {/* Source Name (clickable) */}
                  <Box mb={3}>
                    {currentCandidate.source_url ? (
                      <Badge
                        as="a"
                        href={currentCandidate.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        variant="outline"
                        fontSize="md"
                        fontWeight="bold"
                        cursor="pointer"
                        _hover={{ bg: 'blue.50', borderColor: 'blue.500' }}
                        py={1}
                        px={2}
                        maxW="100%"
                        overflow="hidden"
                        textOverflow="ellipsis"
                        whiteSpace="nowrap"
                        display="block"
                      >
                        {currentCandidate.source_name}
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        fontSize="md"
                        fontWeight="bold"
                        py={1}
                        px={2}
                        maxW="100%"
                        overflow="hidden"
                        textOverflow="ellipsis"
                        whiteSpace="nowrap"
                        display="block"
                      >
                        {currentCandidate.source_name}
                      </Badge>
                    )}
                  </Box>

                  {/* Metadata Row: Relevance, AI Confidence, AI Stance */}
                  <HStack spacing={3} wrap="nowrap" justify="center" overflowX="auto">
                    <Badge
                      colorScheme="purple"
                      display="flex"
                      alignItems="center"
                      gap={2}
                      fontSize="lg"
                      px={4}
                      py={2}
                    >
                      <Icon as={FaStar} />
                      {currentCandidate.relevance_score}% Relevance
                    </Badge>

                    {currentCandidate.ai_confidence !== undefined && (
                      <Badge
                        colorScheme="blue"
                        fontSize="lg"
                        px={4}
                        py={2}
                      >
                        {Math.round(currentCandidate.ai_confidence * 100)}% Confidence
                      </Badge>
                    )}

                    {currentCandidate.ai_stance && (
                      <Badge
                        colorScheme={
                          currentCandidate.ai_stance === 'support' ? 'green' :
                          currentCandidate.ai_stance === 'refute' ? 'red' :
                          currentCandidate.ai_stance === 'nuance' ? 'cyan' :
                          'gray'
                        }
                        fontSize="lg"
                        px={4}
                        py={2}
                      >
                        {currentCandidate.ai_stance}
                        {currentCandidate.ai_support_level !== undefined &&
                          ` (${currentCandidate.ai_support_level > 0 ? '+' : ''}${currentCandidate.ai_support_level.toFixed(2)})`
                        }
                      </Badge>
                    )}
                  </HStack>
                </Box>

                {/* Claim Text */}
                <Box
                  ref={sourceClaimBoxRef}
                  p={5}
                  bg="rgba(0, 212, 255, 0.08)"
                  backdropFilter="blur(25px)"
                  borderRadius="16px"
                  border="2px solid"
                  borderColor="rgba(0, 212, 255, 0.4)"
                  boxShadow="0 6px 24px rgba(0, 0, 0, 0.4), 0 0 30px rgba(0, 212, 255, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1)"
                  mb={4}
                  transform="translateZ(0)"
                  transition="all 0.3s ease"
                  position="relative"
                  overflow="visible"
                  _hover={{
                    transform: 'translateY(-2px) translateZ(0)',
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5), 0 0 40px rgba(0, 212, 255, 0.3), inset 0 2px 0 rgba(255, 255, 255, 0.15)'
                  }}
                >
                  {/* Curved left edge gradient */}
                  <Box
                    position="absolute"
                    left={0}
                    top={0}
                    width="24px"
                    height="100%"
                    background="linear-gradient(90deg, rgba(0, 212, 255, 0.6) 0%, transparent 100%)"
                    borderLeftRadius="16px"
                    pointerEvents="none"
                    zIndex={0}
                  />
                  <Text fontSize="2xl" lineHeight="tall" fontWeight="medium" color="gray.100" position="relative" zIndex={1}>
                    {currentCandidate.claim_text}
                  </Text>
                </Box>

                {/* AI Rationale */}
                {currentCandidate.ai_rationale && (
                  <Box
                    p={5}
                    bg="rgba(138, 43, 226, 0.1)"
                    backdropFilter="blur(25px)"
                    borderRadius="16px"
                    border="2px solid"
                    borderColor="rgba(138, 43, 226, 0.4)"
                    boxShadow="0 6px 24px rgba(0, 0, 0, 0.4), 0 0 25px rgba(138, 43, 226, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1)"
                    mb={6}
                    transform="translateZ(0)"
                    transition="all 0.3s ease"
                    position="relative"
                    overflow="visible"
                    _hover={{
                      transform: 'translateY(-2px) translateZ(0)',
                      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5), 0 0 35px rgba(138, 43, 226, 0.4), inset 0 2px 0 rgba(255, 255, 255, 0.15)'
                    }}
                  >
                    {/* Curved left edge gradient */}
                    <Box
                      position="absolute"
                      left={0}
                      top={0}
                      width="24px"
                      height="100%"
                      background="linear-gradient(90deg, rgba(138, 43, 226, 0.6) 0%, transparent 100%)"
                      borderLeftRadius="16px"
                      pointerEvents="none"
                      zIndex={0}
                    />
                    <Box position="relative" zIndex={1}>
                      <Text fontSize="xs" fontWeight="bold" color="purple.300" mb={2} textTransform="uppercase" letterSpacing="2px">
                        AI Analysis
                      </Text>
                      <Text fontSize="md" color="gray.200" lineHeight="tall">
                        {currentCandidate.ai_rationale}
                      </Text>
                    </Box>
                  </Box>
                )}

                {/* Action Buttons */}
                <Box>
                  <Text fontSize="xs" fontWeight="bold" color="gray.500" textTransform="uppercase" mb={3}>
                    How does this evidence relate?
                  </Text>

                  <VStack spacing={3}>
                    {/* Primary Actions */}
                    <HStack spacing={{ base: 2, md: 3 }} w="full">
                      <Button
                        bg="rgba(16, 185, 129, 0.25)"
                        color="green.200"
                        border="3px solid"
                        borderColor="green.400"
                        size={{ base: 'md', md: 'lg' }}
                        flex="1"
                        leftIcon={<Icon as={FaThumbsUp} />}
                        onClick={() => handleLink('supports')}
                        isDisabled={isLinking}
                        fontSize={{ base: 'md', md: 'lg' }}
                        fontWeight="bold"
                        boxShadow={buttonShadow3D}
                        transform="translateZ(0)"
                        _hover={{
                          bg: 'rgba(16, 185, 129, 0.35)',
                          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5), 0 0 40px rgba(16, 185, 129, 0.6), inset 0 2px 0 rgba(255, 255, 255, 0.2)',
                          transform: 'translateY(-4px) translateZ(0)',
                          borderColor: 'green.300'
                        }}
                        _active={{
                          transform: 'translateY(-1px)',
                          boxShadow: '0 2px 12px rgba(0, 0, 0, 0.4), 0 0 20px rgba(16, 185, 129, 0.5)'
                        }}
                        transition="all 0.2s cubic-bezier(0.4, 0, 0.2, 1)"
                      >
                        <Text display={{ base: 'none', sm: 'block' }}>Support</Text>
                        <Icon as={FaThumbsUp} display={{ base: 'block', sm: 'none' }} />
                      </Button>
                      <Button
                        bg="rgba(239, 68, 68, 0.25)"
                        color="red.200"
                        border="3px solid"
                        borderColor="red.400"
                        size={{ base: 'md', md: 'lg' }}
                        flex="1"
                        leftIcon={<Icon as={FaThumbsDown} />}
                        onClick={() => handleLink('refutes')}
                        isDisabled={isLinking}
                        fontSize={{ base: 'md', md: 'lg' }}
                        fontWeight="bold"
                        boxShadow={buttonShadow3D}
                        transform="translateZ(0)"
                        _hover={{
                          bg: 'rgba(239, 68, 68, 0.35)',
                          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5), 0 0 40px rgba(239, 68, 68, 0.6), inset 0 2px 0 rgba(255, 255, 255, 0.2)',
                          transform: 'translateY(-4px) translateZ(0)',
                          borderColor: 'red.300'
                        }}
                        _active={{
                          transform: 'translateY(-1px)',
                          boxShadow: '0 2px 12px rgba(0, 0, 0, 0.4), 0 0 20px rgba(239, 68, 68, 0.5)'
                        }}
                        transition="all 0.2s cubic-bezier(0.4, 0, 0.2, 1)"
                      >
                        <Text display={{ base: 'none', sm: 'block' }}>Refute</Text>
                        <Icon as={FaThumbsDown} display={{ base: 'block', sm: 'none' }} />
                      </Button>
                    </HStack>

                    {/* Secondary Actions */}
                    <HStack spacing={3} w="full">
                      <Button
                        bg="rgba(0, 212, 255, 0.25)"
                        color="cyan.200"
                        border="3px solid"
                        borderColor="cyan.400"
                        size="lg"
                        flex="1"
                        leftIcon={<Icon as={FaInfoCircle} />}
                        onClick={() => handleLink('context')}
                        isDisabled={isLinking}
                        fontSize="lg"
                        fontWeight="bold"
                        boxShadow={buttonShadow3D}
                        transform="translateZ(0)"
                        _hover={{
                          bg: 'rgba(0, 212, 255, 0.35)',
                          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5), 0 0 40px rgba(0, 212, 255, 0.6), inset 0 2px 0 rgba(255, 255, 255, 0.2)',
                          transform: 'translateY(-4px) translateZ(0)',
                          borderColor: 'cyan.300'
                        }}
                        _active={{
                          transform: 'translateY(-1px)'
                        }}
                        transition="all 0.2s cubic-bezier(0.4, 0, 0.2, 1)"
                      >
                        Nuance
                      </Button>
                      <Button
                        bg="rgba(100, 116, 139, 0.25)"
                        color="gray.200"
                        border="3px solid"
                        borderColor="gray.500"
                        size="lg"
                        flex="1"
                        leftIcon={<Icon as={FaCopy} />}
                        onClick={() => handleLink('duplicate')}
                        isDisabled={isLinking}
                        boxShadow={buttonShadow3D}
                        transform="translateZ(0)"
                        _hover={{
                          bg: 'rgba(100, 116, 139, 0.35)',
                          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5), 0 0 30px rgba(100, 116, 139, 0.5), inset 0 2px 0 rgba(255, 255, 255, 0.2)',
                          transform: 'translateY(-4px) translateZ(0)',
                          borderColor: 'gray.400'
                        }}
                        _active={{
                          transform: 'translateY(-1px)'
                        }}
                        transition="all 0.2s cubic-bezier(0.4, 0, 0.2, 1)"
                      >
                        Duplicate
                      </Button>
                    </HStack>

                    {/* Navigation: Previous / Skip / Next */}
                    <HStack spacing={2} w="full">
                      <Button
                        bg="transparent"
                        color="gray.400"
                        border="1px solid"
                        borderColor="gray.600"
                        size="lg"
                        flex="1"
                        leftIcon={<Icon as={FaArrowLeft} />}
                        onClick={handlePrevious}
                        isDisabled={currentCandidateIndex === 0}
                        _hover={{
                          bg: 'rgba(100, 116, 139, 0.2)',
                          borderColor: 'gray.400',
                          color: 'gray.200'
                        }}
                      >
                        Previous
                      </Button>
                      <Button
                        bg="transparent"
                        color="gray.400"
                        size="lg"
                        flex="1"
                        leftIcon={<Icon as={FaStepForward} />}
                        onClick={handleNext}
                        isDisabled={currentCandidateIndex >= candidates.length - 1}
                        _hover={{
                          bg: 'rgba(100, 116, 139, 0.1)',
                          color: 'gray.200'
                        }}
                      >
                        Skip
                      </Button>
                      <Button
                        bg="transparent"
                        color="gray.400"
                        border="1px solid"
                        borderColor="gray.600"
                        size="lg"
                        flex="1"
                        rightIcon={<Icon as={FaArrowRight} />}
                        onClick={handleNext}
                        isDisabled={currentCandidateIndex >= candidates.length - 1}
                        _hover={{
                          bg: 'rgba(100, 116, 139, 0.2)',
                          borderColor: 'gray.400',
                          color: 'gray.200'
                        }}
                      >
                        Next
                      </Button>
                    </HStack>
                  </VStack>
                </Box>

                {/* Existing Link Warning */}
                {currentCandidate.existing_link && (
                  <Card bg="yellow.50" borderColor="yellow.400" borderWidth="1px" mt={4}>
                    <CardBody>
                      <Text fontSize="xs" fontWeight="bold">
                        Already linked as: {currentCandidate.existing_link.relationship_type}
                      </Text>
                    </CardBody>
                  </Card>
                )}
              </CardBody>
            </Card>
          ) : focusClaim ? (
            <Card p={12} textAlign="center">
              <VStack spacing={4}>
                <Icon as={FaStar} boxSize={12} color="purple.500" />
                <Text fontSize="lg" fontWeight="bold">
                  All evidence reviewed!
                </Text>
                <Text fontSize="md" color="gray.500">
                  You've reviewed all candidate evidence for this claim
                </Text>
                {availableCaseClaims.length > 1 && (
                  <Button colorScheme="purple" onClick={() => setFocusClaim(null)}>
                    Choose Another Claim
                  </Button>
                )}
              </VStack>
            </Card>
          ) : (
            <Card p={12} textAlign="center">
              <VStack spacing={4}>
                <Icon as={FaInfoCircle} boxSize={12} color="gray.400" />
                <Text fontSize="lg" color="gray.500">
                  Select a claim to start linking evidence
                </Text>
              </VStack>
            </Card>
          )}

          {/* Keyboard Shortcuts Hint */}
          <Card
            bg={accentBg}
            backdropFilter="blur(20px)"
            border="2px solid"
            borderColor={glassBorder}
            borderRadius="16px"
            boxShadow={cardShadow3D}
            transform="translateZ(0)"
            transition="all 0.3s ease"
            position="relative"
            overflow="visible"
            _hover={{
              transform: 'translateY(-2px) translateZ(0)',
              boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5), 0 0 30px rgba(0, 212, 255, 0.3)'
            }}
          >
            {/* Curved left edge gradient */}
            <Box
              position="absolute"
              left={0}
              top={0}
              width="24px"
              height="100%"
              background="linear-gradient(90deg, rgba(74, 222, 128, 0.5) 0%, transparent 100%)"
              borderLeftRadius="16px"
              pointerEvents="none"
              zIndex={0}
            />
            <CardBody position="relative" zIndex={1}>
              <Text fontSize="xs" fontWeight="bold" color="cyan.400" mb={2} letterSpacing="2px">
                KEYBOARD SHORTCUTS
              </Text>
              <HStack spacing={4} flexWrap="wrap">
                <HStack fontSize="xs">
                  <Kbd>S</Kbd>
                  <Text>Support</Text>
                </HStack>
                <HStack fontSize="xs">
                  <Kbd>R</Kbd>
                  <Text>Refute</Text>
                </HStack>
                <HStack fontSize="xs">
                  <Kbd>C</Kbd>
                  <Text>Context</Text>
                </HStack>
                <HStack fontSize="xs">
                  <Kbd>D</Kbd>
                  <Text>Duplicate</Text>
                </HStack>
                <HStack fontSize="xs">
                  <Kbd>Space</Kbd>
                  <Text>Skip</Text>
                </HStack>
              </HStack>
            </CardBody>
          </Card>
        </VStack>
        </Box>
      </Flex>

      {/* Claim Link Modal */}
      {currentCandidate && focusClaim && (
        <ClaimLinkModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          sourceClaim={{
            claim_id: currentCandidate.source_claim_id,
            claim_text: currentCandidate.claim_text
          }}
          targetClaim={focusClaim as any}
          onLinkCreated={handleModalLinkCreated}
          initialNotes={currentCandidate.ai_rationale}
          initialRelationship={modalRelationship}
          initialSupportLevel={modalSupportLevel}
        />
      )}

      {/* Mobile Drawer Menu */}
      <Drawer isOpen={isOpen} placement="left" onClose={onClose}>
        <DrawerOverlay />
        <DrawerContent bg={glassCardBgDeep} backdropFilter="blur(30px)">
          <DrawerCloseButton color="cyan.300" />
          <DrawerHeader color="cyan.300" textShadow={textGlow}>
            Claim Duel Stats
          </DrawerHeader>
          <DrawerBody>
            <VStack spacing={4} align="stretch">
              {/* Score Card */}
              <Card
                bg="linear-gradient(135deg, rgba(0, 212, 255, 0.15), rgba(138, 43, 226, 0.15))"
                backdropFilter="blur(25px)"
                border="2px solid"
                borderColor="cyan.500"
                borderRadius="16px"
                boxShadow={cardShadow3D}
                position="relative"
                overflow="visible"
              >
                <Box
                  position="absolute"
                  left={0}
                  top={0}
                  width="24px"
                  height="100%"
                  background="linear-gradient(90deg, rgba(138, 43, 226, 0.6) 0%, transparent 100%)"
                  borderLeftRadius="16px"
                  pointerEvents="none"
                />
                <CardBody position="relative" zIndex={1}>
                  <HStack justify="space-between">
                    <Box>
                      <Heading size="xl" color="cyan.300" textShadow={textGlow}>{score}</Heading>
                      <Text fontSize="xs" color="cyan.400">Points</Text>
                    </Box>
                    <Box textAlign="right">
                      <Heading size="md" color="cyan.300" textShadow={textGlow}>{totalLinked}</Heading>
                      <Text fontSize="xs" color="cyan.400">Links</Text>
                    </Box>
                  </HStack>
                </CardBody>
              </Card>

              {/* Focus Claim Stats */}
              {focusClaim && (
                <Card
                  bg={glassCardBg}
                  backdropFilter="blur(25px)"
                  border="2px solid"
                  borderColor={glassBorder}
                  borderRadius="16px"
                  boxShadow={cardShadow3D}
                  position="relative"
                  overflow="visible"
                >
                  <Box
                    position="absolute"
                    left={0}
                    top={0}
                    width="24px"
                    height="100%"
                    background="linear-gradient(90deg, rgba(167, 139, 250, 0.5) 0%, transparent 100%)"
                    borderLeftRadius="16px"
                    pointerEvents="none"
                  />
                  <CardBody position="relative" zIndex={1}>
                    <Text fontSize="xs" color="purple.300" mb={2} fontWeight="bold">FOCUS CLAIM</Text>
                    <Text fontSize="sm" color="gray.100" mb={3} noOfLines={3}>
                      {focusClaim.claim_text}
                    </Text>
                    <HStack spacing={2} flexWrap="wrap">
                      <Badge colorScheme="gray" fontSize="xs">
                        <Icon as={FaLink} boxSize={2} mr={1} />
                        {focusClaim.evidence_count}
                      </Badge>
                      <Badge colorScheme="green" fontSize="xs">
                        <Icon as={FaThumbsUp} boxSize={2} mr={1} />
                        {focusClaim.support_count}
                      </Badge>
                      <Badge colorScheme="red" fontSize="xs">
                        <Icon as={FaThumbsDown} boxSize={2} mr={1} />
                        {focusClaim.refute_count}
                      </Badge>
                    </HStack>
                  </CardBody>
                </Card>
              )}

              {/* Change Claim Button */}
              {availableCaseClaims.length > 1 && (
                <Button
                  bg="rgba(0, 212, 255, 0.2)"
                  color="cyan.300"
                  border="2px solid"
                  borderColor="cyan.500"
                  _hover={{ bg: 'rgba(0, 212, 255, 0.3)' }}
                  onClick={() => {
                    setFocusClaim(null);
                    onClose();
                  }}
                >
                  Change Claim
                </Button>
              )}
            </VStack>
          </DrawerBody>
        </DrawerContent>
      </Drawer>
    </Flex>
  );
}
