// src/components/PromptManager.tsx
// UI for managing LLM prompts stored in database

import React, { useState, useEffect } from "react";
import {
  Box,
  Heading,
  VStack,
  HStack,
  Button,
  Text,
  Textarea,
  Select,
  useToast,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Badge,
  IconButton,
  Collapse,
  Input,
  FormLabel,
  FormControl,
} from "@chakra-ui/react";
import { ChevronDownIcon, ChevronUpIcon, EditIcon, CheckIcon, DeleteIcon } from "@chakra-ui/icons";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

interface Prompt {
  prompt_id: number;
  prompt_name: string;
  prompt_type: string;
  prompt_text: string;
  prompt_preview?: string;
  parameters: any;
  version: number;
  is_active: number;
}

const PromptManager: React.FC = () => {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null);
  const [editText, setEditText] = useState("");
  const toast = useToast();

  // Fetch all prompts
  const fetchPrompts = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE_URL}/api/prompts`, {
        credentials: "include",
      });
      const data = await response.json();
      if (data.success) {
        setPrompts(data.prompts);
      }
    } catch (err) {
      console.error("Error fetching prompts:", err);
      toast({
        title: "Error",
        description: "Failed to load prompts",
        status: "error",
        duration: 3000,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isExpanded) {
      fetchPrompts();
    }
  }, [isExpanded]);

  // Activate a specific version
  const activateVersion = async (promptName: string, version: number) => {
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/prompts/${promptName}/activate/${version}`,
        {
          method: "PUT",
          credentials: "include",
        }
      );
      const data = await response.json();
      if (data.success) {
        toast({
          title: "Success",
          description: `Activated ${promptName} version ${version}`,
          status: "success",
          duration: 2000,
        });
        fetchPrompts();
      }
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to activate version",
        status: "error",
        duration: 3000,
      });
    }
  };

  // Update prompt with new version
  const updatePrompt = async () => {
    if (!editingPrompt) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/prompts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          promptName: editingPrompt.prompt_name,
          promptType: editingPrompt.prompt_type,
          promptText: editText,
          parameters: editingPrompt.parameters,
        }),
      });
      const data = await response.json();
      if (data.success) {
        toast({
          title: "Success",
          description: "Prompt updated successfully",
          status: "success",
          duration: 2000,
        });
        setEditingPrompt(null);
        setEditText("");
        fetchPrompts();
      }
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to update prompt",
        status: "error",
        duration: 3000,
      });
    }
  };

  // Clear cache
  const clearCache = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/prompts/clear-cache`, {
        method: "POST",
        credentials: "include",
      });
      const data = await response.json();
      if (data.success) {
        toast({
          title: "Success",
          description: "Prompt cache cleared",
          status: "success",
          duration: 2000,
        });
      }
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to clear cache",
        status: "error",
        duration: 3000,
      });
    }
  };

  return (
    <Box className="mr-card mr-card-cyan" p={4} position="relative">
      <div className="mr-glow-bar mr-glow-bar-cyan" />
      <div className="mr-scanlines" />

      <HStack justify="space-between" mb={isExpanded ? 4 : 0}>
        <Heading size="md" className="mr-heading">
          🤖 LLM Prompt Manager
        </Heading>
        <HStack>
          {isExpanded && (
            <Button
              size="sm"
              className="mr-button"
              onClick={clearCache}
              isLoading={loading}
            >
              Clear Cache
            </Button>
          )}
          <IconButton
            aria-label="Toggle prompt manager"
            icon={isExpanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
            onClick={() => setIsExpanded(!isExpanded)}
            size="sm"
            variant="ghost"
            color="cyan.300"
          />
        </HStack>
      </HStack>

      <Collapse in={isExpanded} animateOpacity>
        {editingPrompt ? (
          // Edit Mode
          <VStack align="stretch" spacing={4}>
            <HStack>
              <Button
                size="sm"
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
                leftIcon={<CheckIcon />}
                onClick={updatePrompt}
              >
                Save New Version
              </Button>
            </HStack>

            <FormControl>
              <FormLabel className="mr-text-primary" fontSize="sm">
                Prompt Name: {editingPrompt.prompt_name}
              </FormLabel>
              <FormLabel className="mr-text-primary" fontSize="sm" mt={2}>
                Type: {editingPrompt.prompt_type}
              </FormLabel>
            </FormControl>

            <FormControl>
              <FormLabel className="mr-text-primary" fontSize="sm">
                Prompt Text
              </FormLabel>
              <Textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                rows={15}
                fontFamily="monospace"
                fontSize="sm"
                className="mr-input"
              />
            </FormControl>

            <Text className="mr-text-secondary" fontSize="xs">
              Use {`{{minClaims}}`} and {`{{maxClaims}}`} as template variables
            </Text>
          </VStack>
        ) : (
          // List Mode
          <VStack align="stretch" spacing={4}>
            {loading ? (
              <Text className="mr-text-secondary">Loading prompts...</Text>
            ) : prompts.length === 0 ? (
              <Text className="mr-text-secondary">No prompts found</Text>
            ) : (
              <Box overflowX="auto">
                <Table size="sm" variant="simple">
                  <Thead>
                    <Tr>
                      <Th color="cyan.300">Name</Th>
                      <Th color="cyan.300">Type</Th>
                      <Th color="cyan.300">Version</Th>
                      <Th color="cyan.300">Status</Th>
                      <Th color="cyan.300">Actions</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {prompts.map((prompt) => (
                      <Tr key={`${prompt.prompt_name}-${prompt.version}`}>
                        <Td className="mr-text-primary" fontSize="xs">
                          {prompt.prompt_name}
                        </Td>
                        <Td className="mr-text-secondary" fontSize="xs">
                          {prompt.prompt_type}
                        </Td>
                        <Td className="mr-text-secondary" fontSize="xs">
                          v{prompt.version}
                        </Td>
                        <Td>
                          {prompt.is_active ? (
                            <Badge colorScheme="green" fontSize="xs">
                              Active
                            </Badge>
                          ) : (
                            <Badge colorScheme="gray" fontSize="xs">
                              Inactive
                            </Badge>
                          )}
                        </Td>
                        <Td>
                          <HStack spacing={1}>
                            <IconButton
                              aria-label="Edit prompt"
                              icon={<EditIcon />}
                              size="xs"
                              variant="ghost"
                              color="cyan.300"
                              onClick={() => {
                                // Fetch full prompt text first
                                fetch(
                                  `${API_BASE_URL}/api/prompts/${prompt.prompt_name}`,
                                  { credentials: "include" }
                                )
                                  .then((r) => r.json())
                                  .then((data) => {
                                    const fullPrompt = data.versions.find(
                                      (v: Prompt) =>
                                        v.version === prompt.version
                                    );
                                    if (fullPrompt) {
                                      setEditingPrompt(fullPrompt);
                                      setEditText(fullPrompt.prompt_text);
                                    }
                                  });
                              }}
                            />
                            {!prompt.is_active && (
                              <IconButton
                                aria-label="Activate version"
                                icon={<CheckIcon />}
                                size="xs"
                                variant="ghost"
                                color="green.300"
                                onClick={() =>
                                  activateVersion(
                                    prompt.prompt_name,
                                    prompt.version
                                  )
                                }
                              />
                            )}
                          </HStack>
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </Box>
            )}
          </VStack>
        )}
      </Collapse>
    </Box>
  );
};

export default PromptManager;
