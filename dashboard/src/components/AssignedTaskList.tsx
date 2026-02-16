// src/components/AssignedTaskList.tsx
import React, { useState } from "react";
import {
  Box,
  VStack,
  HStack,
  Text,
  Button,
  Badge,
  Heading,
  Select,
  Tooltip,
} from "@chakra-ui/react";
import { Task } from "../../../shared/entities/types";
import { useNavigate } from "react-router-dom";
import { useTaskStore } from "../store/useTaskStore";

interface AssignedTaskListProps {
  tasks: Task[];
}

type EvaluationInterface = "workspace" | "gamespace" | "molecule";

const AssignedTaskList: React.FC<AssignedTaskListProps> = ({ tasks }) => {
  const navigate = useNavigate();
  const setSelectedTask = useTaskStore((s) => s.setSelectedTask);
  const [defaultInterface, setDefaultInterface] = useState<EvaluationInterface>("workspace");

  const handleEvaluate = (task: Task) => {
    setSelectedTask(task);

    switch (defaultInterface) {
      case "workspace":
        navigate(`/workspace/${task.content_id}`);
        break;
      case "gamespace":
        navigate(`/gamespace`);
        break;
      case "molecule":
        navigate(`/molecule`);
        break;
    }
  };

  const handleSelect = (task: Task) => {
    setSelectedTask(task);
  };

  return (
    <VStack spacing={4} align="stretch">
      {/* Interface Selector */}
      <HStack justify="space-between" align="center">
        <Heading size="sm" className="mr-text-primary">
          Assigned Tasks ({tasks.length})
        </Heading>
        <HStack spacing={2}>
          <Text className="mr-text-muted" fontSize="xs">
            Evaluate in:
          </Text>
          <Select
            size="sm"
            value={defaultInterface}
            onChange={(e) => setDefaultInterface(e.target.value as EvaluationInterface)}
            className="mr-input"
            w="140px"
            fontSize="sm"
          >
            <option value="workspace">Workspace</option>
            <option value="gamespace">GameSpace</option>
            <option value="molecule">Molecule</option>
          </Select>
        </HStack>
      </HStack>

      {/* Task List */}
      <Box maxH="500px" overflowY="auto" pr={2}>
        <VStack spacing={3} align="stretch">
          {tasks.length === 0 ? (
            <Box textAlign="center" py={8}>
              <Text className="mr-text-secondary">
                No tasks assigned yet
              </Text>
            </Box>
          ) : (
            tasks.map((task) => (
              <Box
                key={task.content_id}
                className="mr-card mr-card-blue"
                p={4}
                position="relative"
                transition="all 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
                _hover={{
                  transform: "translateY(-2px)",
                  boxShadow: "0 8px 32px var(--mr-blue-glow)",
                }}
              >
                <div className="mr-glow-bar mr-glow-bar-blue" />
                <HStack justify="space-between" position="relative" zIndex={1}>
                  <VStack align="start" spacing={1} flex={1} minW={0}>
                    <Tooltip label={task.content_name} placement="top">
                      <Text
                        className="mr-text-primary"
                        fontSize="sm"
                        fontWeight="bold"
                        noOfLines={1}
                      >
                        {task.content_name}
                      </Text>
                    </Tooltip>
                    {task.media_source && (
                      <Badge
                        fontSize="xs"
                        bg="var(--mr-purple-border)"
                        color="var(--mr-purple)"
                      >
                        {task.media_source}
                      </Badge>
                    )}
                    <Text
                      className="mr-text-muted"
                      fontSize="xs"
                      noOfLines={1}
                    >
                      {task.url}
                    </Text>
                  </VStack>
                  <HStack spacing={2} flexShrink={0}>
                    <Button
                      className="mr-button"
                      size="sm"
                      onClick={() => handleSelect(task)}
                      bg="var(--mr-purple-border)"
                      color="var(--mr-purple)"
                      _hover={{
                        bg: "var(--mr-purple)",
                        color: "black",
                      }}
                    >
                      Select
                    </Button>
                    <Button
                      className="mr-button"
                      size="sm"
                      onClick={() => handleEvaluate(task)}
                      bg="var(--mr-blue-border)"
                      color="var(--mr-blue)"
                      _hover={{
                        bg: "var(--mr-blue)",
                        color: "black",
                      }}
                    >
                      Evaluate →
                    </Button>
                  </HStack>
                </HStack>
              </Box>
            ))
          )}
        </VStack>
      </Box>
    </VStack>
  );
};

export default AssignedTaskList;
