import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Box,
  Spinner,
  Center,
} from "@chakra-ui/react";
import GameSpace from "../components/GameSpace";
import UnifiedHeader from "../components/UnifiedHeader";
import StickyTitleBar from "../components/StickyTitleBar";
import { useTaskStore, ViewScope } from "../store/useTaskStore";
import {
  fetchClaimsWithEvidence,
  fetchReferencesWithClaimsForTask,
  fetchClaimsAndLinkedReferencesForTask,
} from "../services/useDashboardAPI";
import {
  Claim,
  ReferenceWithClaims,
} from "../../../shared/entities/types";

const GameSpacePage = () => {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [references, setReferences] = useState<ReferenceWithClaims[]>([]);
  const [claimLinks, setClaimLinks] = useState<Array<{
    task_claim_id: number;
    reference_content_id: number;
    reference_claim_id?: number;
  }>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();

  const navigate = useNavigate();
  const taskId = useTaskStore((s) => s.selectedTaskId);
  const task = useTaskStore((s) => s.selectedTask);
  const setSelectedTask = useTaskStore((s) => s.setSelectedTask);
  const setRedirect = useTaskStore((s) => s.setRedirect);
  const selectedRedirect = useTaskStore((s) => s.selectedRedirect);
  const viewerId = useTaskStore((s) => s.viewingUserId);
  const scope = useTaskStore((s) => s.viewScope);
  const setViewingUserId = useTaskStore((s) => s.setViewingUserId);
  const setViewScope = useTaskStore((s) => s.setViewScope);

  // Phase 5: Read URL params on mount
  useEffect(() => {
    const viewerParam = searchParams.get('viewer');
    const scopeParam = searchParams.get('scope') as ViewScope | null;

    if (viewerParam) {
      const viewerNum = viewerParam === 'null' ? null : parseInt(viewerParam, 10);
      if (!isNaN(viewerNum as number) || viewerNum === null) {
        setViewingUserId(viewerNum);
      }
    }

    if (scopeParam && (scopeParam === 'user' || scopeParam === 'all' || scopeParam === 'admin')) {
      setViewScope(scopeParam);
    }
  }, []);

  // Phase 5: Update URL params when viewer/scope changes
  useEffect(() => {
    if (!taskId) return;

    const newParams = new URLSearchParams();
    if (viewerId !== null && viewerId !== undefined) {
      newParams.set('viewer', viewerId.toString());
    }
    if (scope && scope !== 'user') {
      newParams.set('scope', scope);
    }

    setSearchParams(newParams, { replace: true });
  }, [viewerId, scope, taskId]);

  // Set this as the active redirect target when mounted
  useEffect(() => {
    setRedirect("/gamespace");
  }, [setRedirect]);

  // Try to restore selectedTask from content
  useEffect(() => {
    if (taskId && !task) {
      const all = useTaskStore.getState().content;
      const match = all.find((t) => t.content_id === taskId);
      if (match) {
        console.log("🔁 Restoring task from content list", match);
        setSelectedTask(match);
      }
    }
  }, [taskId, task, setSelectedTask]);

  // Redirect if no taskId
  useEffect(() => {
    if (!taskId) {
      console.warn("⛔ No taskId — redirecting to /tasks");
      if (!selectedRedirect) setRedirect("/gamespace");
      navigate("/tasks");
    }
  }, [taskId, navigate, setRedirect, selectedRedirect]);

  // Fetch claims and references
  useEffect(() => {
    if (taskId) {
      setIsLoading(true);
      Promise.all([
        fetchClaimsWithEvidence(taskId, viewerId, scope),
        fetchReferencesWithClaimsForTask(taskId, viewerId, scope),
        fetchClaimsAndLinkedReferencesForTask(taskId, viewerId, scope),
      ])
        .then(([claimsData, referencesData, linksData]) => {
          setClaims(claimsData);
          setReferences(referencesData);

          // Map the links data to the format we need
          const formattedLinks = linksData.map(link => ({
            task_claim_id: link.left_claim_id,
            reference_content_id: link.right_reference_id,
            reference_claim_id: link.source_claim_id,
          }));
          setClaimLinks(formattedLinks);

          setIsLoading(false);
        })
        .catch((error) => {
          console.error("Error fetching data:", error);
          setIsLoading(false);
        });
    }
  }, [taskId, viewerId, scope]);

  // viewerId can be null for "View All" mode
  const isReady = taskId != null && task != null;

  if (!isReady || isLoading) {
    return (
      <Center h="100vh" bg="linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))">
        <Box textAlign="center">
          <Spinner
            size="xl"
            color="#a5b4fc"
            thickness="4px"
            speed="0.8s"
            emptyColor="rgba(99, 102, 241, 0.2)"
            mb={4}
          />
          <Box
            color="#a5b4fc"
            fontSize="18px"
            fontWeight="500"
            textShadow="0 0 10px rgba(165, 180, 252, 0.6)"
          >
            Loading Game Space...
          </Box>
        </Box>
      </Center>
    );
  }

  return (
    <Box>
      {/* Sticky Title Bar - Always visible initially */}
      <StickyTitleBar alwaysVisible={true} />

      {/* UnifiedHeader */}
      <Box className="mr-card mr-card-blue" mb={6} p={4} position="relative">
        <div className="mr-glow-bar mr-glow-bar-blue" />
        <div className="mr-scanlines" />
        <UnifiedHeader />
      </Box>

      {/* GameSpace */}
      <GameSpace
        contentId={taskId}
        claims={claims}
        references={references}
        claimLinks={claimLinks}
      />
    </Box>
  );
};

export default GameSpacePage;
