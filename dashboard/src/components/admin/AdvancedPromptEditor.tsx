import React, { useState, useEffect } from "react";
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

export default function AdvancedPromptEditor() {
  const [prompts, setPrompts] = useState<LLMPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [expandedPrompt, setExpandedPrompt] = useState<string | null>(null);
  const [editingPrompt, setEditingPrompt] = useState<LLMPrompt | null>(null);
  const [editText, setEditText] = useState("");
  const [configEditMode, setConfigEditMode] = useState<string | null>(null);
  const [configValues, setConfigValues] = useState<Partial<LLMPrompt>>({});
  const [creatingNew, setCreatingNew] = useState(false);
  const [newPromptData, setNewPromptData] = useState({
    promptName: "",
    promptType: "claim_extraction",
    promptText: "",
    maxClaims: 12,
    minSources: 2,
    maxSources: 4,
  });
  const toast = useToast();

  useEffect(() => {
    loadPrompts();
  }, []);

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
    return (
      <VStack spacing={6} align="stretch">
        <HStack justify="space-between">
          <VStack align="start" spacing={1}>
            <Text fontSize="xl" fontWeight="bold" color="cyan.300">
              Editing: {editingPrompt.prompt_name}
            </Text>
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

      {/* Prompts List */}
      <VStack spacing={4} align="stretch">
        {Object.entries(groupedPrompts).map(([promptName, versions]) => {
          const activeVersion = versions.find(v => v.is_active) || versions[0];
          const isExpanded = expandedPrompt === promptName;
          const isEditingConfig = configEditMode === promptName;
          const category = getPromptCategory(activeVersion.prompt_type);
          const categoryColor = getCategoryColor(category);

          return (
            <Box
              key={promptName}
              bg="rgba(0, 162, 255, 0.05)"
              borderWidth="1px"
              borderColor="rgba(0, 162, 255, 0.3)"
              borderRadius="md"
              overflow="hidden"
              transition="all 0.2s"
              _hover={{ borderColor: "rgba(0, 162, 255, 0.5)" }}
            >
              {/* Header */}
              <HStack
                p={4}
                justify="space-between"
                cursor="pointer"
                onClick={() => setExpandedPrompt(isExpanded ? null : promptName)}
                bg={isExpanded ? "rgba(0, 162, 255, 0.08)" : "transparent"}
                transition="all 0.2s"
              >
                <HStack flex={1}>
                  <Badge colorScheme={categoryColor} fontSize="xs">
                    {category}
                  </Badge>
                  <Text fontWeight="bold" color="cyan.300">{promptName}</Text>
                  <Badge colorScheme="gray" fontSize="xs">
                    v{activeVersion.version}
                  </Badge>
                  {activeVersion.is_active && (
                    <Badge colorScheme="green" fontSize="xs">ACTIVE</Badge>
                  )}
                  {versions.length > 1 && (
                    <Badge colorScheme="purple" fontSize="xs">
                      {versions.length} versions
                    </Badge>
                  )}
                </HStack>

                <HStack>
                  <Text fontSize="xs" color="gray.400">
                    Claims: {activeVersion.max_claims || "N/A"} |
                    Sources: {activeVersion.min_sources || "N/A"}-{activeVersion.max_sources || "N/A"}
                  </Text>
                  <IconButton
                    aria-label="Expand"
                    icon={isExpanded ? <FiChevronUp /> : <FiChevronDown />}
                    size="sm"
                    variant="ghost"
                    color="cyan.300"
                  />
                </HStack>
              </HStack>

              {/* Expanded Content */}
              <Collapse in={isExpanded} animateOpacity>
                <Box p={4} borderTop="1px solid" borderColor="rgba(0, 162, 255, 0.2)">
                  <Tabs size="sm" variant="soft-rounded" colorScheme="cyan">
                    <TabList>
                      <Tab fontSize="xs">Configuration</Tab>
                      <Tab fontSize="xs">Versions ({versions.length})</Tab>
                      <Tab fontSize="xs">Preview</Tab>
                    </TabList>

                    <TabPanels>
                      {/* Configuration Tab */}
                      <TabPanel>
                        <VStack spacing={4} align="stretch">
                          {!isEditingConfig ? (
                            <>
                              <Grid templateColumns="repeat(3, 1fr)" gap={4}>
                                <Box>
                                  <Text fontSize="xs" color="gray.400" mb={1}>Max Claims</Text>
                                  <Text color="cyan.300" fontWeight="bold">
                                    {activeVersion.max_claims || "N/A"}
                                  </Text>
                                </Box>
                                <Box>
                                  <Text fontSize="xs" color="gray.400" mb={1}>Min Sources</Text>
                                  <Text color="cyan.300" fontWeight="bold">
                                    {activeVersion.min_sources || "N/A"}
                                  </Text>
                                </Box>
                                <Box>
                                  <Text fontSize="xs" color="gray.400" mb={1}>Max Sources</Text>
                                  <Text color="cyan.300" fontWeight="bold">
                                    {activeVersion.max_sources || "N/A"}
                                  </Text>
                                </Box>
                              </Grid>
                              <Button
                                size="sm"
                                leftIcon={<FiEdit />}
                                colorScheme="cyan"
                                onClick={() => {
                                  setConfigEditMode(promptName);
                                  setConfigValues({
                                    max_claims: activeVersion.max_claims,
                                    min_sources: activeVersion.min_sources,
                                    max_sources: activeVersion.max_sources,
                                  });
                                }}
                              >
                                Edit Configuration
                              </Button>
                            </>
                          ) : (
                            <>
                              <Grid templateColumns="repeat(3, 1fr)" gap={4}>
                                <FormControl>
                                  <FormLabel fontSize="xs" color="gray.400">Max Claims</FormLabel>
                                  <Input
                                    type="number"
                                    value={configValues.max_claims || ""}
                                    onChange={(e) => setConfigValues({
                                      ...configValues,
                                      max_claims: parseInt(e.target.value)
                                    })}
                                    size="sm"
                                    bg="rgba(0, 0, 0, 0.4)"
                                    borderColor="cyan.500"
                                  />
                                </FormControl>
                                <FormControl>
                                  <FormLabel fontSize="xs" color="gray.400">Min Sources</FormLabel>
                                  <Input
                                    type="number"
                                    value={configValues.min_sources || ""}
                                    onChange={(e) => setConfigValues({
                                      ...configValues,
                                      min_sources: parseInt(e.target.value)
                                    })}
                                    size="sm"
                                    bg="rgba(0, 0, 0, 0.4)"
                                    borderColor="cyan.500"
                                  />
                                </FormControl>
                                <FormControl>
                                  <FormLabel fontSize="xs" color="gray.400">Max Sources</FormLabel>
                                  <Input
                                    type="number"
                                    value={configValues.max_sources || ""}
                                    onChange={(e) => setConfigValues({
                                      ...configValues,
                                      max_sources: parseInt(e.target.value)
                                    })}
                                    size="sm"
                                    bg="rgba(0, 0, 0, 0.4)"
                                    borderColor="cyan.500"
                                  />
                                </FormControl>
                              </Grid>
                              <HStack>
                                <Button
                                  size="sm"
                                  leftIcon={<FiX />}
                                  variant="ghost"
                                  onClick={() => {
                                    setConfigEditMode(null);
                                    setConfigValues({});
                                  }}
                                >
                                  Cancel
                                </Button>
                                <Button
                                  size="sm"
                                  leftIcon={<FiSave />}
                                  colorScheme="green"
                                  onClick={() => handleUpdateConfig(promptName)}
                                  isLoading={saving === promptName}
                                >
                                  Save
                                </Button>
                              </HStack>
                            </>
                          )}
                        </VStack>
                      </TabPanel>

                      {/* Versions Tab */}
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
                            {versions.map((version) => (
                              <Tr key={version.version}>
                                <Td color="gray.300" fontSize="xs">v{version.version}</Td>
                                <Td>
                                  {version.is_active ? (
                                    <Badge colorScheme="green" fontSize="xs">Active</Badge>
                                  ) : (
                                    <Badge colorScheme="gray" fontSize="xs">Inactive</Badge>
                                  )}
                                </Td>
                                <Td>
                                  <HStack spacing={1}>
                                    <IconButton
                                      aria-label="Edit"
                                      icon={<FiEdit />}
                                      size="xs"
                                      variant="ghost"
                                      color="cyan.300"
                                      onClick={() => loadFullPrompt(promptName, version.version)}
                                    />
                                    {!version.is_active && (
                                      <IconButton
                                        aria-label="Activate"
                                        icon={<FiCheck />}
                                        size="xs"
                                        variant="ghost"
                                        color="green.300"
                                        onClick={() => handleActivateVersion(promptName, version.version)}
                                      />
                                    )}
                                  </HStack>
                                </Td>
                              </Tr>
                            ))}
                          </Tbody>
                        </Table>
                      </TabPanel>

                      {/* Preview Tab */}
                      <TabPanel>
                        <Box
                          p={3}
                          bg="rgba(0, 0, 0, 0.4)"
                          borderRadius="md"
                          maxH="300px"
                          overflowY="auto"
                        >
                          <Text
                            fontSize="xs"
                            fontFamily="monospace"
                            color="gray.300"
                            whiteSpace="pre-wrap"
                          >
                            {activeVersion.prompt_preview || "No preview available"}
                          </Text>
                        </Box>
                        <Button
                          size="sm"
                          mt={2}
                          leftIcon={<FiEdit />}
                          colorScheme="cyan"
                          onClick={() => loadFullPrompt(promptName, activeVersion.version)}
                        >
                          Edit Full Prompt
                        </Button>
                      </TabPanel>
                    </TabPanels>
                  </Tabs>
                </Box>
              </Collapse>
            </Box>
          );
        })}
      </VStack>

      {Object.keys(groupedPrompts).length === 0 && (
        <Box textAlign="center" py={10}>
          <Text color="gray.500">No prompts found</Text>
        </Box>
      )}
    </VStack>
  );
}
