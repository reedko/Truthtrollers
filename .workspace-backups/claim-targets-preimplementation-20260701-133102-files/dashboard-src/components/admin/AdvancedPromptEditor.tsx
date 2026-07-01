import React, { useState, useEffect, useRef } from "react";
import {
  Box,
  VStack,
  HStack,
  Text,
  Button,
  Spinner,
  useToast,
  Divider,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Badge,
  IconButton,
  Collapse,
  Textarea,
  Input,
  FormLabel,
  FormControl,
  Grid,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
} from "@chakra-ui/react";
import {
  FiRefreshCw,
  FiSave,
  FiEdit,
  FiCheck,
  FiX,
  FiChevronDown,
  FiChevronUp,
  FiPlus,
  FiTrash2,
} from "react-icons/fi";
import { api } from "../../services/api";

interface LLMPrompt {
  prompt_id: number;
  prompt_name: string;
  prompt_type: string;
  prompt_text?: string;
  prompt_preview?: string;
  max_claims?: number;
  min_sources?: number;
  max_sources?: number;
  version: number;
  is_active: boolean;
  parameters?: any;
}

// Human-readable titles and descriptions for each prompt name
const PROMPT_LABELS: Record<string, { title: string; desc: string }> = {
  "claim_extraction_stack_system": {
    title: "Claim Extraction — Reasoning Stack · System",
    desc: "Preferred system prompt for case/source reasoning-stack extraction",
  },
  "claim_extraction_stack_with_topics": {
    title: "Claim Extraction — Reasoning Stack · With Topics",
    desc: "Preferred user prompt for reasoning-stack extraction when topics/testimonials are included",
  },
  "claim_extraction_stack_no_topics": {
    title: "Claim Extraction — Reasoning Stack · No Topics",
    desc: "Preferred user prompt for reasoning-stack extraction on later chunks",
  },
  "evidence_query_generation_system": {
    title: "Evidence Search — System Instructions",
    desc: "Instructs the AI how to generate targeted web search queries for each claim",
  },
  "evidence_query_generation_user": {
    title: "Evidence Search — Standard Queries",
    desc: "Generates queries to find supporting and refuting sources (standard / fringe modes)",
  },
  "evidence_query_generation_user_balanced": {
    title: "Evidence Search — Balanced Queries",
    desc: "Generates queries seeking equal support and counter-evidence (balanced mode)",
  },
  "claim_extraction_edge_system": {
    title: "Claim Extraction — Edge · System Instructions",
    desc: "System prompt for Edge mode: extract only the sharpest, most impactful claims",
  },
  "claim_extraction_edge_no_topics": {
    title: "Claim Extraction — Edge · Main Batches",
    desc: "Edge mode: extract 3–5 key claims per chunk, no topic taxonomy",
  },
  "claim_extraction_edge_with_topics": {
    title: "Claim Extraction — Edge · First Batch (+ topics)",
    desc: "Edge mode first pass: claims + topic classification + testimonials",
  },
  "claim_extraction_ranked_system": {
    title: "Claim Extraction — Ranked / Comprehensive · System Instructions",
    desc: "System prompt shared by Ranked and Comprehensive modes",
  },
  "claim_extraction_ranked_no_topics": {
    title: "Claim Extraction — Ranked · Main Batches",
    desc: "Ranked mode: extract and rank claims by importance, no topic taxonomy",
  },
  "claim_extraction_ranked_with_topics": {
    title: "Claim Extraction — Ranked · First Batch (+ topics)",
    desc: "Ranked mode first pass: ranked claims + topic classification + testimonials",
  },
  "claim_extraction_comprehensive_no_topics": {
    title: "Claim Extraction — Comprehensive · Main Batches",
    desc: "Comprehensive mode: extract every verifiable claim for user-side ranking",
  },
  "claim_extraction_comprehensive_with_topics": {
    title: "Claim Extraction — Comprehensive · First Batch (+ topics)",
    desc: "Comprehensive mode first pass: all claims + topic classification + testimonials",
  },
  "claim_matching_system": {
    title: "Claim Matching — System Instructions",
    desc: "Instructs the AI how to align source claims against case claims",
  },
  "claim_matching_user": {
    title: "Claim Matching — Score & Relate",
    desc: "Match each source claim to a case claim; label as supports / refutes / related",
  },
  "claim_relevance_assessment_system": {
    title: "Relevance Assessment — System Instructions",
    desc: "Instructs the AI how to score claim relevance",
  },
  "claim_relevance_assessment_user": {
    title: "Relevance Assessment — Score",
    desc: "Rate how relevant each matched claim is to the case (0–100)",
  },
  "claim_triage_system": {
    title: "Claim Triage — System Instructions",
    desc: "Instructs the AI how to classify claims for keep / reject / review",
  },
  "claim_triage_user": {
    title: "Claim Triage — Classify",
    desc: "Decide each claim: keep as a strong finding, reject (weak/redundant), or flag for review",
  },
  "source_quality_evaluation_system": {
    title: "Source Quality — System Instructions",
    desc: "Instructs the AI how to evaluate source credibility",
  },
  "source_quality_evaluation_user": {
    title: "Source Quality — Rate Credibility",
    desc: "Rate the source on bias, factual accuracy, transparency, and subject expertise",
  },
  "claim_properties_evaluation_system": {
    title: "Claim Properties — System Instructions",
    desc: "Instructs the AI how to classify claim characteristics",
  },
  "claim_properties_evaluation_user": {
    title: "Claim Properties — Classify",
    desc: "Tag claim properties: verifiability, specificity, type, sentiment, political lean",
  },
};

// Pipeline stages in execution order
interface PipelinePromptRef { name: string; note?: string }
interface PipelineStage {
  step: number; name: string; desc: string; color: string;
  prompts: PipelinePromptRef[];
}
const PIPELINE_STAGES: PipelineStage[] = [
  {
    step: 1, color: "cyan",
    name: "CASE Article — Extract Claims",
    desc: "Extracts the case/article reasoning stack. Runs in text chunks; first chunk can also capture topic taxonomy + testimonials. EDIT THESE PROMPTS to change how case claims are extracted.",
    prompts: [
      { name: "claim_extraction_stack_system", note: "preferred" },
      { name: "claim_extraction_stack_with_topics", note: "preferred · first batch" },
      { name: "claim_extraction_stack_no_topics", note: "preferred · later batches" },
      { name: "claim_extraction_edge_system", note: "edge mode" },
      { name: "claim_extraction_ranked_system", note: "ranked / comprehensive mode" },
      { name: "claim_extraction_edge_with_topics", note: "edge · 1st batch" },
      { name: "claim_extraction_edge_no_topics", note: "edge · later batches" },
      { name: "claim_extraction_ranked_with_topics", note: "ranked · 1st batch" },
      { name: "claim_extraction_ranked_no_topics", note: "ranked · later batches" },
      { name: "claim_extraction_comprehensive_with_topics", note: "comprehensive · 1st batch" },
      { name: "claim_extraction_comprehensive_no_topics", note: "comprehensive · later batches" },
    ],
  },
  {
    step: 2, color: "purple",
    name: "Generate Evidence Search Queries",
    desc: "For each case claim, generates web search queries to find supporting or refuting sources. Style depends on evidence mode.",
    prompts: [
      { name: "evidence_query_generation_system" },
      { name: "evidence_query_generation_user", note: "standard / fringe modes" },
      { name: "evidence_query_generation_user_balanced", note: "balanced mode" },
    ],
  },
  {
    step: 3, color: "teal",
    name: "SOURCE Articles — Extract Claims (reuses Step 1 prompts)",
    desc: "For each found source/reference article, extracts its claims using the source-aware reasoning-stack prompts first, with legacy Step 1 prompts kept as fallback.",
    prompts: [
      { name: "claim_extraction_stack_system", note: "preferred" },
      { name: "claim_extraction_stack_with_topics", note: "preferred · first batch" },
      { name: "claim_extraction_stack_no_topics", note: "preferred · later batches" },
      { name: "claim_extraction_edge_system", note: "edge mode" },
      { name: "claim_extraction_ranked_system", note: "ranked / comprehensive mode" },
      { name: "claim_extraction_edge_with_topics", note: "edge · 1st batch" },
      { name: "claim_extraction_edge_no_topics", note: "edge · later batches" },
      { name: "claim_extraction_ranked_with_topics", note: "ranked · 1st batch" },
      { name: "claim_extraction_ranked_no_topics", note: "ranked · later batches" },
      { name: "claim_extraction_comprehensive_with_topics", note: "comprehensive · 1st batch" },
      { name: "claim_extraction_comprehensive_no_topics", note: "comprehensive · later batches" },
    ],
  },
  {
    step: 4, color: "blue",
    name: "Claim Matching",
    desc: "Match each source claim against every case claim and score the relationship.",
    prompts: [
      { name: "claim_matching_system" },
      { name: "claim_matching_user" },
    ],
  },
  {
    step: 5, color: "green",
    name: "Relevance Assessment",
    desc: "Score how strongly each matched claim supports or challenges the case claim (0–100).",
    prompts: [
      { name: "claim_relevance_assessment_system" },
      { name: "claim_relevance_assessment_user" },
    ],
  },
  {
    step: 6, color: "yellow",
    name: "Claim Triage",
    desc: "Classify each claim: keep as a strong finding, reject as weak/redundant, or flag for human review.",
    prompts: [
      { name: "claim_triage_system" },
      { name: "claim_triage_user" },
    ],
  },
  {
    step: 7, color: "orange",
    name: "Source Quality Scoring",
    desc: "Rate each source's credibility: bias, factual accuracy, transparency, and expertise.",
    prompts: [
      { name: "source_quality_evaluation_system" },
      { name: "source_quality_evaluation_user" },
    ],
  },
  {
    step: 8, color: "pink",
    name: "Claim Properties Evaluation",
    desc: "Tag each claim's characteristics: verifiability, specificity, type, sentiment, political lean.",
    prompts: [
      { name: "claim_properties_evaluation_system" },
      { name: "claim_properties_evaluation_user" },
    ],
  },
];

// All prompt names referenced anywhere in the pipeline (for "IN PIPELINE" badge)
const PIPELINE_PROMPT_NAMES = new Set(
  PIPELINE_STAGES.flatMap((s) => s.prompts.map((p) => p.name))
);

// Given the active evidence + extraction mode, return which prompts are actually called RIGHT NOW
function computeActivePrompts(evidenceMode: string, extractionMode: string): Set<string> {
  const active = new Set<string>();
  active.add("claim_extraction_stack_system");
  active.add("claim_extraction_stack_with_topics");
  active.add("claim_extraction_stack_no_topics");
  const sysKey = extractionMode === "comprehensive"
    ? "claim_extraction_ranked_system"
    : `claim_extraction_${extractionMode}_system`;
  active.add(sysKey);
  active.add(`claim_extraction_${extractionMode}_no_topics`);
  active.add(`claim_extraction_${extractionMode}_with_topics`);
  active.add("evidence_query_generation_system");
  active.add(
    evidenceMode.includes("balanced")
      ? "evidence_query_generation_user_balanced"
      : "evidence_query_generation_user"
  );
  [
    "claim_matching_system", "claim_matching_user",
    "claim_relevance_assessment_system", "claim_relevance_assessment_user",
    "claim_triage_system", "claim_triage_user",
    "source_quality_evaluation_system", "source_quality_evaluation_user",
    "claim_properties_evaluation_system", "claim_properties_evaluation_user",
  ].forEach((n) => active.add(n));
  return active;
}

interface AdvancedPromptEditorProps {
  evidenceMode?: string;
  extractionMode?: string;
}

export default function AdvancedPromptEditor({
  evidenceMode = "fringe_on_support",
  extractionMode = "edge",
}: AdvancedPromptEditorProps) {
  const [prompts, setPrompts] = useState<LLMPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [expandedPrompt, setExpandedPrompt] = useState<string | null>(null);
  const [editingPrompt, setEditingPrompt] = useState<LLMPrompt | null>(null);
  const [editText, setEditText] = useState("");
  const [configEditMode, setConfigEditMode] = useState<string | null>(null);
  const [configValues, setConfigValues] = useState<Partial<LLMPrompt>>({});
  const [creatingNew, setCreatingNew] = useState(false);
  const [pipelineExpanded, setPipelineExpanded] = useState(true);
  const [newPromptData, setNewPromptData] = useState({
    promptName: "",
    promptType: "claim_extraction",
    promptText: "",
    maxClaims: 12,
    minSources: 2,
    maxSources: 4,
  });
  const toast = useToast();

  const activePromptNames = computeActivePrompts(evidenceMode, extractionMode);
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadPrompts();
  }, []);

  useEffect(() => {
    if (expandedPrompt && editorRef.current) {
      editorRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [expandedPrompt]);

  const loadPrompts = async () => {
    try {
      setLoading(true);
      const response = await api.get("/api/prompts");
      if (response.data.success) {
        setPrompts(response.data.prompts || []);
      }
    } catch (error: any) {
      console.error("Failed to load prompts:", error);
      toast({
        title: "Failed to load prompts",
        status: "error",
        duration: 3000,
      });
    } finally {
      setLoading(false);
    }
  };

  const loadFullPrompt = async (promptName: string, version: number) => {
    try {
      const response = await api.get(`/api/prompts/${promptName}`);
      if (response.data.success) {
        const fullPrompt = response.data.versions.find(
          (v: LLMPrompt) => v.version === version
        );
        if (fullPrompt) {
          setEditingPrompt(fullPrompt);
          setEditText(fullPrompt.prompt_text || "");
        }
      }
    } catch (error) {
      toast({
        title: "Failed to load prompt details",
        status: "error",
        duration: 3000,
      });
    }
  };

  const handleUpdateConfig = async (promptName: string) => {
    try {
      setSaving(promptName);
      await api.put(`/api/llm-prompts/${promptName}/config`, {
        max_claims: configValues.max_claims,
        min_sources: configValues.min_sources,
        max_sources: configValues.max_sources,
      });

      toast({
        title: "Configuration Updated",
        status: "success",
        duration: 2000,
      });

      setConfigEditMode(null);
      setConfigValues({});
      loadPrompts();
    } catch (error: any) {
      console.error("Failed to update config:", error);
      toast({
        title: "Failed to update configuration",
        description: error.response?.data?.error || "Unknown error",
        status: "error",
        duration: 3000,
      });
    } finally {
      setSaving(null);
    }
  };

  const handleUpdatePromptText = async () => {
    if (!editingPrompt) return;

    try {
      setSaving(editingPrompt.prompt_name);
      const response = await api.post("/api/prompts", {
        promptName: editingPrompt.prompt_name,
        promptType: editingPrompt.prompt_type,
        promptText: editText,
        parameters: editingPrompt.parameters || {},
      });

      if (response.data.success) {
        toast({
          title: "Prompt Updated",
          description: "New version created successfully",
          status: "success",
          duration: 2000,
        });

        setEditingPrompt(null);
        setEditText("");
        loadPrompts();
      }
    } catch (error: any) {
      console.error("Failed to update prompt:", error);
      toast({
        title: "Failed to update prompt",
        description: error.response?.data?.error || "Unknown error",
        status: "error",
        duration: 3000,
      });
    } finally {
      setSaving(null);
    }
  };

  const handleActivateVersion = async (promptName: string, version: number) => {
    try {
      const response = await api.put(
        `/api/prompts/${promptName}/activate/${version}`
      );

      if (response.data.success) {
        toast({
          title: "Version Activated",
          description: `${promptName} v${version} is now active`,
          status: "success",
          duration: 2000,
        });
        loadPrompts();
      }
    } catch (error) {
      toast({
        title: "Failed to activate version",
        status: "error",
        duration: 3000,
      });
    }
  };

  const handleClearCache = async () => {
    try {
      const response = await api.post("/api/prompts/clear-cache");
      if (response.data.success) {
        toast({
          title: "Cache Cleared",
          description: "Prompt cache cleared successfully",
          status: "success",
          duration: 2000,
        });
      }
    } catch (error) {
      toast({
        title: "Failed to clear cache",
        status: "error",
        duration: 3000,
      });
    }
  };

  const handleCreateNewPrompt = async () => {
    try {
      if (!newPromptData.promptName || !newPromptData.promptText) {
        toast({
          title: "Missing Fields",
          description: "Prompt name and text are required",
          status: "error",
          duration: 3000,
        });
        return;
      }

      setSaving("new");
      const response = await api.post("/api/prompts", {
        promptName: newPromptData.promptName,
        promptType: newPromptData.promptType,
        promptText: newPromptData.promptText,
        parameters: {
          max_claims: newPromptData.maxClaims,
          min_sources: newPromptData.minSources,
          max_sources: newPromptData.maxSources,
        },
        isActive: false, // Don't activate by default
      });

      if (response.data.success) {
        // Also update the config columns
        await api.put(`/api/llm-prompts/${newPromptData.promptName}/config`, {
          max_claims: newPromptData.maxClaims,
          min_sources: newPromptData.minSources,
          max_sources: newPromptData.maxSources,
        });

        toast({
          title: "Prompt Created",
          description: "New prompt created successfully",
          status: "success",
          duration: 2000,
        });

        setCreatingNew(false);
        setNewPromptData({
          promptName: "",
          promptType: "claim_extraction",
          promptText: "",
          maxClaims: 12,
          minSources: 2,
          maxSources: 4,
        });
        loadPrompts();
      }
    } catch (error: any) {
      console.error("Failed to create prompt:", error);
      toast({
        title: "Failed to create prompt",
        description: error.response?.data?.error || "Unknown error",
        status: "error",
        duration: 3000,
      });
    } finally {
      setSaving(null);
    }
  };

  const getPromptCategory = (promptType: string) => {
    if (promptType.includes("claim_extraction")) return "extraction";
    if (promptType.includes("evidence")) return "evidence";
    if (promptType.includes("quality")) return "quality";
    return "other";
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case "extraction": return "cyan";
      case "evidence": return "purple";
      case "quality": return "green";
      default: return "gray";
    }
  };

  const getExtractionMode = (promptName: string): string | null => {
    const lowerName = promptName.toLowerCase();
    if (lowerName.includes("_edge_") || lowerName.includes("_edge")) return "edge";
    if (lowerName.includes("_ranked_") || lowerName.includes("_ranked")) return "ranked";
    if (lowerName.includes("_comprehensive_") || lowerName.includes("_comprehensive")) return "comprehensive";
    return null;
  };

  const getExtractionModeColor = (mode: string) => {
    switch (mode) {
      case "edge": return "teal";
      case "ranked": return "orange";
      case "comprehensive": return "blue";
      default: return "gray";
    }
  };

  const getExtractionModeLabel = (mode: string) => {
    switch (mode) {
      case "edge": return "EDGE";
      case "ranked": return "RANKED";
      case "comprehensive": return "COMPREHENSIVE";
      default: return mode.toUpperCase();
    }
  };

  // Group prompts by name (to show all versions together)
  const groupedPrompts = prompts.reduce((acc, prompt) => {
    if (!acc[prompt.prompt_name]) {
      acc[prompt.prompt_name] = [];
    }
    acc[prompt.prompt_name].push(prompt);
    return acc;
  }, {} as Record<string, LLMPrompt[]>);

  if (loading) {
    return (
      <Box textAlign="center" py={10}>
        <Spinner color="cyan.400" size="xl" />
      </Box>
    );
  }

  // If editing prompt text, show the editor
  if (editingPrompt) {
    const extractionMode = getExtractionMode(editingPrompt.prompt_name);
    const modeColor = extractionMode ? getExtractionModeColor(extractionMode) : "gray";
    const modeLabel = extractionMode ? getExtractionModeLabel(extractionMode) : null;

    return (
      <VStack spacing={6} align="stretch">
        <HStack justify="space-between">
          <VStack align="start" spacing={1}>
            <HStack>
              <Text fontSize="xl" fontWeight="bold" color="cyan.300">
                Editing: {editingPrompt.prompt_name}
              </Text>
              {modeLabel && (
                <Badge colorScheme={modeColor} fontSize="sm" fontWeight="bold">
                  {modeLabel}
                </Badge>
              )}
            </HStack>
            <Text fontSize="sm" color="gray.400">
              Type: {editingPrompt.prompt_type} | Version: {editingPrompt.version}
            </Text>
          </VStack>
          <HStack>
            <Button
              size="sm"
              variant="ghost"
              colorScheme="gray"
              leftIcon={<FiX />}
              onClick={() => {
                setEditingPrompt(null);
                setEditText("");
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              colorScheme="green"
              leftIcon={<FiSave />}
              onClick={handleUpdatePromptText}
              isLoading={saving === editingPrompt.prompt_name}
            >
              Save New Version
            </Button>
          </HStack>
        </HStack>

        <Divider borderColor="cyan.700" opacity={0.3} />

        <FormControl>
          <FormLabel color="cyan.300" fontSize="sm">
            Prompt Text
          </FormLabel>
          <Textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            rows={20}
            fontFamily="monospace"
            fontSize="sm"
            bg="rgba(0, 0, 0, 0.4)"
            borderColor="cyan.500"
            color="gray.100"
            _hover={{ borderColor: "cyan.400" }}
            _focus={{ borderColor: "cyan.400", boxShadow: "0 0 0 1px var(--chakra-colors-cyan-400)" }}
          />
        </FormControl>

        <Text fontSize="xs" color="gray.500" fontStyle="italic">
          Template variables: {`{{minClaims}}`}, {`{{maxClaims}}`}, {`{{minSources}}`}, {`{{maxSources}}`}
        </Text>
      </VStack>
    );
  }

  // If creating new prompt, show the creation form
  if (creatingNew) {
    return (
      <VStack spacing={6} align="stretch">
        <HStack justify="space-between">
          <VStack align="start" spacing={1}>
            <Text fontSize="xl" fontWeight="bold" color="cyan.300">
              Create New Prompt
            </Text>
            <Text fontSize="sm" color="gray.400">
              Define a custom LLM prompt for your workflow
            </Text>
          </VStack>
          <HStack>
            <Button
              size="sm"
              variant="ghost"
              colorScheme="gray"
              leftIcon={<FiX />}
              onClick={() => {
                setCreatingNew(false);
                setNewPromptData({
                  promptName: "",
                  promptType: "claim_extraction",
                  promptText: "",
                  maxClaims: 12,
                  minSources: 2,
                  maxSources: 4,
                });
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              colorScheme="green"
              leftIcon={<FiSave />}
              onClick={handleCreateNewPrompt}
              isLoading={saving === "new"}
            >
              Create Prompt
            </Button>
          </HStack>
        </HStack>

        <Divider borderColor="cyan.700" opacity={0.3} />

        <Grid templateColumns="repeat(2, 1fr)" gap={4}>
          <FormControl>
            <FormLabel color="cyan.300" fontSize="sm">Prompt Name</FormLabel>
            <Input
              value={newPromptData.promptName}
              onChange={(e) => setNewPromptData({ ...newPromptData, promptName: e.target.value })}
              placeholder="e.g., my_custom_extraction_prompt"
              size="sm"
              bg="rgba(0, 0, 0, 0.4)"
              borderColor="cyan.500"
              color="gray.100"
            />
          </FormControl>

          <FormControl>
            <FormLabel color="cyan.300" fontSize="sm">Prompt Type</FormLabel>
            <Input
              value={newPromptData.promptType}
              onChange={(e) => setNewPromptData({ ...newPromptData, promptType: e.target.value })}
              placeholder="e.g., claim_extraction"
              size="sm"
              bg="rgba(0, 0, 0, 0.4)"
              borderColor="cyan.500"
              color="gray.100"
            />
          </FormControl>

          <FormControl>
            <FormLabel color="cyan.300" fontSize="sm">Max Claims</FormLabel>
            <Input
              type="number"
              value={newPromptData.maxClaims}
              onChange={(e) => setNewPromptData({ ...newPromptData, maxClaims: parseInt(e.target.value) })}
              size="sm"
              bg="rgba(0, 0, 0, 0.4)"
              borderColor="cyan.500"
              color="gray.100"
            />
          </FormControl>

          <FormControl>
            <FormLabel color="cyan.300" fontSize="sm">Min Sources</FormLabel>
            <Input
              type="number"
              value={newPromptData.minSources}
              onChange={(e) => setNewPromptData({ ...newPromptData, minSources: parseInt(e.target.value) })}
              size="sm"
              bg="rgba(0, 0, 0, 0.4)"
              borderColor="cyan.500"
              color="gray.100"
            />
          </FormControl>

          <FormControl>
            <FormLabel color="cyan.300" fontSize="sm">Max Sources</FormLabel>
            <Input
              type="number"
              value={newPromptData.maxSources}
              onChange={(e) => setNewPromptData({ ...newPromptData, maxSources: parseInt(e.target.value) })}
              size="sm"
              bg="rgba(0, 0, 0, 0.4)"
              borderColor="cyan.500"
              color="gray.100"
            />
          </FormControl>
        </Grid>

        <FormControl>
          <FormLabel color="cyan.300" fontSize="sm">Prompt Text</FormLabel>
          <Textarea
            value={newPromptData.promptText}
            onChange={(e) => setNewPromptData({ ...newPromptData, promptText: e.target.value })}
            rows={15}
            fontFamily="monospace"
            fontSize="sm"
            placeholder="Enter your LLM prompt here..."
            bg="rgba(0, 0, 0, 0.4)"
            borderColor="cyan.500"
            color="gray.100"
          />
        </FormControl>

        <Text fontSize="xs" color="gray.500" fontStyle="italic">
          Template variables: {`{{minClaims}}`}, {`{{maxClaims}}`}, {`{{minSources}}`}, {`{{maxSources}}`}
        </Text>
      </VStack>
    );
  }

  // Inline prompt editor — rendered directly under the clicked pipeline row
  const renderPromptEditor = (selName: string) => {
    const versions = groupedPrompts[selName];
    if (!versions) return (
      <Box ref={editorRef} p={4} bg="rgba(0,0,0,0.3)" borderRadius="md" color="gray.400" fontSize="sm" mt={1}>
        Prompt <Text as="span" color="cyan.300">"{selName}"</Text> is not yet in the database.
      </Box>
    );
    const activeVersion = versions.find((v) => v.is_active) || versions[0];
    const isEditingConfig = configEditMode === selName;
    const label = PROMPT_LABELS[selName];
    const isActive = activePromptNames.has(selName);

    return (
      <Box
        ref={editorRef}
        mt={1}
        bg="rgba(0, 15, 40, 0.95)"
        borderWidth="2px"
        borderColor={isActive ? "green.600" : "rgba(0, 162, 255, 0.4)"}
        borderRadius="md"
        overflow="hidden"
      >
        <HStack
          p={3}
          bg={isActive ? "rgba(0,255,150,0.07)" : "rgba(0,162,255,0.07)"}
          justify="space-between"
        >
          <VStack align="start" spacing={0}>
            <HStack>
              {isActive && <Badge colorScheme="green" variant="solid" fontSize="xs">🟢 RUNNING NOW</Badge>}
              <Badge colorScheme="gray" fontSize="xs">v{activeVersion.version}</Badge>
              {versions.length > 1 && <Badge colorScheme="purple" fontSize="xs">{versions.length} versions</Badge>}
            </HStack>
            <Text fontWeight="bold" color="cyan.300" fontSize="sm">{selName}</Text>
            {label && <Text fontSize="xs" color="gray.400" fontStyle="italic">{label.desc}</Text>}
          </VStack>
          <Button size="xs" variant="ghost" leftIcon={<FiX />}
            onClick={() => setExpandedPrompt(null)}>
            Close
          </Button>
        </HStack>

        <Box p={4}>
          <Tabs size="sm" variant="soft-rounded" colorScheme="cyan">
            <TabList>
              <Tab fontSize="xs">Configuration</Tab>
              <Tab fontSize="xs">Versions ({versions.length})</Tab>
              <Tab fontSize="xs">Preview & Edit</Tab>
            </TabList>
            <TabPanels>
              <TabPanel>
                <VStack spacing={4} align="stretch">
                  {!isEditingConfig ? (
                    <>
                      <Grid templateColumns="repeat(3, 1fr)" gap={4}>
                        <Box>
                          <Text fontSize="xs" color="gray.400" mb={1}>Max Claims</Text>
                          <Text color="cyan.300" fontWeight="bold">{activeVersion.max_claims || "N/A"}</Text>
                        </Box>
                        <Box>
                          <Text fontSize="xs" color="gray.400" mb={1}>Min Sources</Text>
                          <Text color="cyan.300" fontWeight="bold">{activeVersion.min_sources || "N/A"}</Text>
                        </Box>
                        <Box>
                          <Text fontSize="xs" color="gray.400" mb={1}>Max Sources</Text>
                          <Text color="cyan.300" fontWeight="bold">{activeVersion.max_sources || "N/A"}</Text>
                        </Box>
                      </Grid>
                      <Button size="sm" leftIcon={<FiEdit />} colorScheme="cyan"
                        onClick={() => {
                          setConfigEditMode(selName);
                          setConfigValues({
                            max_claims: activeVersion.max_claims,
                            min_sources: activeVersion.min_sources,
                            max_sources: activeVersion.max_sources,
                          });
                        }}>
                        Edit Configuration
                      </Button>
                    </>
                  ) : (
                    <>
                      <Grid templateColumns="repeat(3, 1fr)" gap={4}>
                        <FormControl>
                          <FormLabel fontSize="xs" color="gray.400">Max Claims</FormLabel>
                          <Input type="number" value={configValues.max_claims || ""}
                            onChange={(e) => setConfigValues({ ...configValues, max_claims: parseInt(e.target.value) })}
                            size="sm" bg="rgba(0,0,0,0.4)" borderColor="cyan.500" />
                        </FormControl>
                        <FormControl>
                          <FormLabel fontSize="xs" color="gray.400">Min Sources</FormLabel>
                          <Input type="number" value={configValues.min_sources || ""}
                            onChange={(e) => setConfigValues({ ...configValues, min_sources: parseInt(e.target.value) })}
                            size="sm" bg="rgba(0,0,0,0.4)" borderColor="cyan.500" />
                        </FormControl>
                        <FormControl>
                          <FormLabel fontSize="xs" color="gray.400">Max Sources</FormLabel>
                          <Input type="number" value={configValues.max_sources || ""}
                            onChange={(e) => setConfigValues({ ...configValues, max_sources: parseInt(e.target.value) })}
                            size="sm" bg="rgba(0,0,0,0.4)" borderColor="cyan.500" />
                        </FormControl>
                      </Grid>
                      <HStack>
                        <Button size="sm" leftIcon={<FiX />} variant="ghost"
                          onClick={() => { setConfigEditMode(null); setConfigValues({}); }}>
                          Cancel
                        </Button>
                        <Button size="sm" leftIcon={<FiSave />} colorScheme="green"
                          onClick={() => handleUpdateConfig(selName)} isLoading={saving === selName}>
                          Save
                        </Button>
                      </HStack>
                    </>
                  )}
                </VStack>
              </TabPanel>

              <TabPanel>
                <Table size="sm" variant="simple">
                  <Thead>
                    <Tr>
                      <Th color="cyan.400" fontSize="xs">Version</Th>
                      <Th color="cyan.400" fontSize="xs">Status</Th>
                      <Th color="cyan.400" fontSize="xs">Actions</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {versions.map((version, idx) => (
                      <Tr key={`${version.prompt_id}-${version.version}-${idx}`}>
                        <Td color="gray.300" fontSize="xs">v{version.version}</Td>
                        <Td>
                          {version.is_active
                            ? <Badge colorScheme="green" fontSize="xs">Active</Badge>
                            : <Badge colorScheme="gray" fontSize="xs">Inactive</Badge>}
                        </Td>
                        <Td>
                          <HStack spacing={1}>
                            <IconButton aria-label="Edit" icon={<FiEdit />} size="xs" variant="ghost"
                              color="cyan.300" onClick={() => loadFullPrompt(selName, version.version)} />
                            {!version.is_active && (
                              <IconButton aria-label="Activate" icon={<FiCheck />} size="xs" variant="ghost"
                                color="green.300" onClick={() => handleActivateVersion(selName, version.version)} />
                            )}
                          </HStack>
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </TabPanel>

              <TabPanel>
                <Box p={3} bg="rgba(0,0,0,0.4)" borderRadius="md" maxH="300px" overflowY="auto">
                  <Text fontSize="xs" fontFamily="monospace" color="gray.300" whiteSpace="pre-wrap">
                    {activeVersion.prompt_preview || "No preview available"}
                  </Text>
                </Box>
                <Button size="sm" mt={2} leftIcon={<FiEdit />} colorScheme="cyan"
                  onClick={() => loadFullPrompt(selName, activeVersion.version)}>
                  Edit Full Prompt Text
                </Button>
              </TabPanel>
            </TabPanels>
          </Tabs>
        </Box>
      </Box>
    );
  };

  // Main view: list of prompts
  return (
    <VStack spacing={6} align="stretch">
      {/* Header */}
      <HStack justify="space-between">
        <VStack align="start" spacing={1}>
          <Text fontSize="xl" fontWeight="bold" color="cyan.300">
            Advanced Prompt Editor
          </Text>
          <Text fontSize="sm" color="gray.400">
            Full control over LLM prompts, versions, and configuration
          </Text>
        </VStack>
        <HStack>
          <Button
            leftIcon={<FiPlus />}
            size="sm"
            colorScheme="green"
            onClick={() => setCreatingNew(true)}
          >
            New Prompt
          </Button>
          <Button
            leftIcon={<FiRefreshCw />}
            size="sm"
            variant="ghost"
            colorScheme="cyan"
            onClick={handleClearCache}
          >
            Clear Cache
          </Button>
          <Button
            leftIcon={<FiRefreshCw />}
            size="sm"
            variant="ghost"
            colorScheme="cyan"
            onClick={loadPrompts}
          >
            Refresh
          </Button>
        </HStack>
      </HStack>

      <Divider borderColor="cyan.700" opacity={0.3} />

      {/* Legend */}
      <HStack spacing={3} px={1} flexWrap="wrap">
        <Badge colorScheme="green" variant="solid" fontSize="xs">🟢 RUNNING NOW</Badge>
        <Text fontSize="xs" color="gray.400">= called with current mode settings</Text>
        <Badge colorScheme="yellow" variant="outline" fontSize="xs">⚡ IN PIPELINE</Badge>
        <Text fontSize="xs" color="gray.400">= in code, inactive for current mode</Text>
        <Badge colorScheme="green" fontSize="xs">ACTIVE</Badge>
        <Text fontSize="xs" color="gray.400">= DB version loaded (vs older saved versions)</Text>
      </HStack>

      {/* Pipeline Flow Overview */}
      <Box
        bg="rgba(0, 30, 60, 0.5)"
        borderWidth="1px"
        borderColor="rgba(0, 162, 255, 0.25)"
        borderRadius="md"
        overflow="hidden"
      >
        <HStack
          p={3}
          cursor="pointer"
          justify="space-between"
          onClick={() => setPipelineExpanded(!pipelineExpanded)}
          bg="rgba(0, 162, 255, 0.07)"
          _hover={{ bg: "rgba(0, 162, 255, 0.12)" }}
        >
          <VStack align="start" spacing={0}>
            <Text fontWeight="bold" color="cyan.300" fontSize="sm">
              🔄 Scrape Pipeline — live view
            </Text>
            <Text fontSize="xs" color="gray.400">
              Extraction mode:{" "}
              <Text as="span" color="teal.300" fontWeight="bold">{extractionMode}</Text>
              {"  ·  "}Evidence mode:{" "}
              <Text as="span" color="purple.300" fontWeight="bold">{evidenceMode.replace(/_/g, " ")}</Text>
            </Text>
          </VStack>
          <IconButton
            aria-label="toggle pipeline"
            icon={pipelineExpanded ? <FiChevronUp /> : <FiChevronDown />}
            size="xs" variant="ghost" color="cyan.300"
          />
        </HStack>
        <Collapse in={pipelineExpanded} animateOpacity>
          <VStack spacing={2} align="stretch" p={3}>
            {PIPELINE_STAGES.map((stage) => {
              // Dedupe (step 3 reuses step 1 prompts by name+note)
              const seen = new Set<string>();
              const allStagePrompts = stage.prompts.filter((p) => {
                const key = p.name + (p.note ?? "");
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
              });
              // Only show prompts that are actually called with current mode settings
              const activeStagePrompts = allStagePrompts.filter((p) => activePromptNames.has(p.name));
              const sysPrompts = activeStagePrompts.filter((p) => p.name.endsWith("_system"));
              const userPrompts = activeStagePrompts.filter((p) => !p.name.endsWith("_system"));
              const anyActive = activeStagePrompts.length > 0;

              const renderPromptRow = (pRef: PipelinePromptRef) => {
                const label = PROMPT_LABELS[pRef.name];
                const isSelected = expandedPrompt === pRef.name;
                return (
                  <React.Fragment key={pRef.name + (pRef.note ?? "")}>
                    <HStack
                      p={2}
                      borderRadius="sm"
                      bg={isSelected ? "rgba(0,162,255,0.18)" : "rgba(0,255,150,0.05)"}
                      cursor="pointer"
                      onClick={() => setExpandedPrompt(isSelected ? null : pRef.name)}
                      _hover={{ bg: "rgba(0,162,255,0.15)" }}
                      borderLeft="2px solid"
                      borderLeftColor={isSelected ? "cyan.400" : "green.500"}
                    >
                      <Badge colorScheme="green" variant="solid" fontSize="9px" px={1}>🟢</Badge>
                      <Text fontSize="xs" color="gray.200" flex={1} noOfLines={2}>
                        {label?.title ?? pRef.name}
                      </Text>
                      {pRef.note && (
                        <Text fontSize="9px" color="gray.500" fontStyle="italic" whiteSpace="nowrap">
                          {pRef.note}
                        </Text>
                      )}
                      <Badge fontSize="9px" colorScheme="cyan" variant="outline" minW="28px" textAlign="center">
                        edit
                      </Badge>
                    </HStack>
                    {isSelected && renderPromptEditor(pRef.name)}
                  </React.Fragment>
                );
              };

              // Step 3 just re-uses Step 1 prompts — show a reference instead of duplicating
              const isStep3 = stage.step === 3;

              return (
                <Box
                  key={stage.step}
                  p={3}
                  bg="rgba(0,0,0,0.3)"
                  borderRadius="md"
                  borderLeft="4px solid"
                  borderLeftColor={anyActive ? `${stage.color}.500` : "gray.600"}
                  opacity={anyActive ? 1 : 0.45}
                >
                  <HStack mb={2} align="start">
                    <Badge colorScheme={anyActive ? stage.color : "gray"} minW="24px" textAlign="center">
                      {stage.step}
                    </Badge>
                    <VStack align="start" spacing={0} flex={1}>
                      <Text fontSize="sm" fontWeight="bold" color={anyActive ? `${stage.color}.300` : "gray.400"}>
                        {stage.name}
                      </Text>
                      <Text fontSize="xs" color="gray.500">{stage.desc}</Text>
                    </VStack>
                  </HStack>

                  {isStep3 ? (
                    <Box pl={2}>
                      <Text fontSize="xs" color="teal.400" fontStyle="italic">
                        ↑ Same 3 prompts as Step 1 — edit them there to affect both case and source extraction.
                      </Text>
                    </Box>
                  ) : anyActive && (
                    <VStack spacing={2} align="stretch" pl={2}>
                      {sysPrompts.length > 0 && (
                        <Box>
                          <Text fontSize="9px" color="gray.500" fontWeight="bold" letterSpacing="1px" mb={1}>
                            SYSTEM PROMPT (role instructions)
                          </Text>
                          {sysPrompts.map(renderPromptRow)}
                        </Box>
                      )}
                      {userPrompts.length > 0 && (
                        <Box>
                          <HStack mb={1} spacing={2}>
                            <Text fontSize="9px" color="gray.500" fontWeight="bold" letterSpacing="1px">
                              USER PROMPT (the actual task)
                            </Text>
                            {userPrompts.length > 1 && (
                              <Text fontSize="9px" color="yellow.600" fontStyle="italic">
                                {userPrompts.length} variants — 1st batch captures topic taxonomy, later batches skip it
                              </Text>
                            )}
                          </HStack>
                          {userPrompts.map(renderPromptRow)}
                        </Box>
                      )}
                    </VStack>
                  )}
                </Box>
              );
            })}
          </VStack>
        </Collapse>
      </Box>

    </VStack>
  );
}
