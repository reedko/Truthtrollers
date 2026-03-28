import React, { useState, useEffect } from "react";
import {
  Box,
  VStack,
  HStack,
  Text,
  Button,
  Input,
  Textarea,
  Select,
  Spinner,
  useToast,
  Collapse,
  IconButton,
  Badge,
  Divider,
} from "@chakra-ui/react";
import { FiChevronDown, FiChevronUp, FiSave, FiRefreshCw } from "react-icons/fi";
import { api } from "../../services/api";

interface LLMPrompt {
  prompt_id: number;
  prompt_name: string;
  prompt_type: string;
  prompt_text?: string;
  parameters?: any;
  max_claims?: number;
  min_sources?: number;
  max_sources?: number;
  version: number;
  is_active: boolean;
}

export default function LLMPromptsEditor() {
  const [prompts, setPrompts] = useState<LLMPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedPrompt, setExpandedPrompt] = useState<string | null>(null);
  const [editingPrompt, setEditingPrompt] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Partial<LLMPrompt>>({});
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    loadPrompts();
  }, []);

  const loadPrompts = async () => {
    try {
      setLoading(true);
      const response = await api.get("/api/llm-prompts");
      setPrompts(response.data.prompts || []);
    } catch (error) {
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

  const handleExpand = async (promptName: string) => {
    if (expandedPrompt === promptName) {
      setExpandedPrompt(null);
      setEditingPrompt(null);
      return;
    }

    try {
      // Fetch full prompt details including prompt_text
      const response = await api.get(`/api/llm-prompts/${promptName}`);
      const fullPrompt = response.data.prompt;

      // Update the prompt in the list
      setPrompts(prev => prev.map(p =>
        p.prompt_name === promptName ? { ...p, ...fullPrompt } : p
      ));

      setExpandedPrompt(promptName);
      setEditValues(fullPrompt);
    } catch (error) {
      console.error("Failed to load prompt details:", error);
      toast({
        title: "Failed to load prompt details",
        status: "error",
        duration: 3000,
      });
    }
  };

  const handleEdit = (promptName: string) => {
    const prompt = prompts.find(p => p.prompt_name === promptName);
    if (prompt) {
      setEditingPrompt(promptName);
      setEditValues(prompt);
    }
  };

  const handleSave = async (promptName: string) => {
    try {
      setSaving(true);

      // Save config (max_claims, min_sources, max_sources)
      await api.put(`/api/llm-prompts/${promptName}/config`, {
        max_claims: editValues.max_claims,
        min_sources: editValues.min_sources,
        max_sources: editValues.max_sources,
      });

      // Update local state
      setPrompts(prev => prev.map(p =>
        p.prompt_name === promptName
          ? { ...p, ...editValues }
          : p
      ));

      setEditingPrompt(null);

      toast({
        title: "Prompt updated successfully",
        description: `Updated ${promptName}`,
        status: "success",
        duration: 3000,
      });

      // Reload prompts to get fresh data
      await loadPrompts();
    } catch (error: any) {
      console.error("Failed to save prompt:", error);
      toast({
        title: "Failed to save prompt",
        description: error.response?.data?.error || "Unknown error",
        status: "error",
        duration: 5000,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditingPrompt(null);
    setEditValues({});
  };

  const getPromptTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      system: "purple",
      user: "cyan",
      combined: "blue",
    };
    return colors[type] || "gray";
  };

  const getPromptCategoryBadge = (promptName: string) => {
    if (promptName.includes("claim_extraction")) {
      return <Badge colorScheme="green" fontSize="xs">Claim Extraction</Badge>;
    }
    if (promptName.includes("evidence")) {
      return <Badge colorScheme="blue" fontSize="xs">Evidence Search</Badge>;
    }
    return <Badge colorScheme="gray" fontSize="xs">Other</Badge>;
  };

  if (loading) {
    return (
      <Box textAlign="center" py={10}>
        <Spinner color="cyan.400" size="xl" />
      </Box>
    );
  }

  return (
    <VStack spacing={4} align="stretch">
      {/* Header */}
      <HStack justify="space-between">
        <VStack align="start" spacing={1}>
          <Text fontSize="xl" fontWeight="bold" color="cyan.300">
            LLM Prompts Configuration
          </Text>
          <Text fontSize="sm" color="gray.400">
            Configure claim extraction and evidence search parameters
          </Text>
        </VStack>
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

      <Divider borderColor="cyan.700" opacity={0.3} />

      {/* Prompts List */}
      {prompts.length === 0 ? (
        <Box textAlign="center" py={8} color="gray.500">
          No prompts found
        </Box>
      ) : (
        <VStack spacing={3} align="stretch">
          {prompts.map((prompt) => {
            const isExpanded = expandedPrompt === prompt.prompt_name;
            const isEditing = editingPrompt === prompt.prompt_name;

            return (
              <Box
                key={prompt.prompt_id}
                bg="linear-gradient(135deg, rgba(15, 23, 42, 0.6), rgba(30, 41, 59, 0.5))"
                backdropFilter="blur(10px)"
                borderWidth="1px"
                borderColor={isExpanded ? "cyan.500" : "rgba(0, 162, 255, 0.3)"}
                borderRadius="md"
                overflow="hidden"
                transition="all 0.3s"
                _hover={{
                  borderColor: "cyan.400",
                  boxShadow: "0 0 20px rgba(0, 162, 255, 0.2)",
                }}
              >
                {/* Prompt Header (always visible) */}
                <HStack
                  p={4}
                  justify="space-between"
                  cursor="pointer"
                  onClick={() => handleExpand(prompt.prompt_name)}
                  _hover={{ bg: "rgba(0, 162, 255, 0.05)" }}
                >
                  <HStack spacing={3} flex={1}>
                    <IconButton
                      aria-label="Expand"
                      icon={isExpanded ? <FiChevronUp /> : <FiChevronDown />}
                      size="sm"
                      variant="ghost"
                      colorScheme="cyan"
                    />
                    <VStack align="start" spacing={1} flex={1}>
                      <HStack>
                        <Text fontWeight="bold" color="cyan.200" fontSize="sm">
                          {prompt.prompt_name}
                        </Text>
                        {getPromptCategoryBadge(prompt.prompt_name)}
                        <Badge colorScheme={getPromptTypeColor(prompt.prompt_type)} fontSize="xs">
                          {prompt.prompt_type}
                        </Badge>
                        <Badge colorScheme="gray" fontSize="xs">
                          v{prompt.version}
                        </Badge>
                      </HStack>
                    </VStack>
                  </HStack>

                  {/* Quick Config View */}
                  <HStack spacing={4} fontSize="xs" color="gray.400">
                    {prompt.max_claims !== null && prompt.max_claims !== undefined && (
                      <Text>
                        <Text as="span" color="cyan.400" fontWeight="semibold">Max Claims:</Text> {prompt.max_claims}
                      </Text>
                    )}
                    {prompt.min_sources !== null && prompt.min_sources !== undefined && (
                      <Text>
                        <Text as="span" color="cyan.400" fontWeight="semibold">Min Sources:</Text> {prompt.min_sources}
                      </Text>
                    )}
                    {prompt.max_sources !== null && prompt.max_sources !== undefined && (
                      <Text>
                        <Text as="span" color="cyan.400" fontWeight="semibold">Max Sources:</Text> {prompt.max_sources}
                      </Text>
                    )}
                  </HStack>
                </HStack>

                {/* Expanded Details */}
                <Collapse in={isExpanded} animateOpacity>
                  <Box p={4} pt={0} borderTop="1px solid" borderColor="rgba(0, 162, 255, 0.2)">
                    <VStack spacing={4} align="stretch">
                      {/* Configuration Fields */}
                      <Box
                        p={4}
                        bg="rgba(0, 162, 255, 0.05)"
                        borderRadius="md"
                        borderWidth="1px"
                        borderColor="cyan.700"
                      >
                        <Text fontSize="sm" fontWeight="bold" color="cyan.300" mb={3}>
                          Configuration
                        </Text>
                        <HStack spacing={4}>
                          <Box flex={1}>
                            <Text fontSize="xs" color="gray.400" mb={1}>Max Claims</Text>
                            <Input
                              type="number"
                              value={isEditing ? editValues.max_claims ?? "" : prompt.max_claims ?? ""}
                              onChange={(e) => setEditValues({ ...editValues, max_claims: parseInt(e.target.value) || undefined })}
                              isDisabled={!isEditing}
                              size="sm"
                              bg="gray.800"
                              borderColor="cyan.600"
                              _focus={{ borderColor: "cyan.400", boxShadow: "0 0 0 1px var(--chakra-colors-cyan-400)" }}
                            />
                          </Box>
                          <Box flex={1}>
                            <Text fontSize="xs" color="gray.400" mb={1}>Min Sources</Text>
                            <Input
                              type="number"
                              value={isEditing ? editValues.min_sources ?? "" : prompt.min_sources ?? ""}
                              onChange={(e) => setEditValues({ ...editValues, min_sources: parseInt(e.target.value) || undefined })}
                              isDisabled={!isEditing}
                              size="sm"
                              bg="gray.800"
                              borderColor="cyan.600"
                              _focus={{ borderColor: "cyan.400", boxShadow: "0 0 0 1px var(--chakra-colors-cyan-400)" }}
                            />
                          </Box>
                          <Box flex={1}>
                            <Text fontSize="xs" color="gray.400" mb={1}>Max Sources</Text>
                            <Input
                              type="number"
                              value={isEditing ? editValues.max_sources ?? "" : prompt.max_sources ?? ""}
                              onChange={(e) => setEditValues({ ...editValues, max_sources: parseInt(e.target.value) || undefined })}
                              isDisabled={!isEditing}
                              size="sm"
                              bg="gray.800"
                              borderColor="cyan.600"
                              _focus={{ borderColor: "cyan.400", boxShadow: "0 0 0 1px var(--chakra-colors-cyan-400)" }}
                            />
                          </Box>
                        </HStack>
                      </Box>

                      {/* Prompt Text (Read-only for now) */}
                      {prompt.prompt_text && (
                        <Box
                          p={4}
                          bg="rgba(0, 0, 0, 0.3)"
                          borderRadius="md"
                          borderWidth="1px"
                          borderColor="gray.700"
                        >
                          <Text fontSize="sm" fontWeight="bold" color="cyan.300" mb={2}>
                            Prompt Text
                          </Text>
                          <Textarea
                            value={prompt.prompt_text}
                            isReadOnly
                            size="sm"
                            fontFamily="monospace"
                            fontSize="xs"
                            minH="200px"
                            maxH="400px"
                            bg="gray.900"
                            borderColor="gray.700"
                            color="gray.300"
                            resize="vertical"
                          />
                          <Text fontSize="xs" color="gray.500" mt={2}>
                            Prompt text editing coming soon. For now, edit directly in database.
                          </Text>
                        </Box>
                      )}

                      {/* Action Buttons */}
                      <HStack justify="flex-end" spacing={3}>
                        {isEditing ? (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={handleCancel}
                            >
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              colorScheme="cyan"
                              leftIcon={<FiSave />}
                              onClick={() => handleSave(prompt.prompt_name)}
                              isLoading={saving}
                            >
                              Save Changes
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            colorScheme="cyan"
                            variant="outline"
                            onClick={() => handleEdit(prompt.prompt_name)}
                          >
                            Edit Config
                          </Button>
                        )}
                      </HStack>
                    </VStack>
                  </Box>
                </Collapse>
              </Box>
            );
          })}
        </VStack>
      )}
    </VStack>
  );
}
