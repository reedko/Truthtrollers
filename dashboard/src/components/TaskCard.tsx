import { useNavigate } from "react-router-dom";
import {
  Box,
  Image,
  Text,
  Progress,
  Button,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  Center,
  useDisclosure,
  Link,
  HStack,
} from "@chakra-ui/react";
import { BiChevronDown } from "react-icons/bi";
import AssignUserModal from "./modals/AssignUserModal";
import ReferenceModal from "./modals/ReferenceModal";
import { useTaskStore } from "../store/useTaskStore";
import { memo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

interface TaskCardProps {
  task: any;
  useStore?: boolean;
  compact?: boolean;
}

const TaskCard: React.FC<TaskCardProps> = ({ task, compact = false }) => {
  const navigate = useNavigate();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [modalPosition, setModalPosition] = useState({ top: 0, left: 0 });
  const redirectTo = useTaskStore((s) => s.selectedRedirect);
  compact = false;
  const {
    isOpen: isAssignOpen,
    onOpen: onAssignOpen,
    onClose: onAssignClose,
  } = useDisclosure();

  const {
    isOpen: isReferenceModalOpen,
    onOpen: onReferenceModalOpen,
    onClose: onReferenceModalClose,
  } = useDisclosure();

  const fetchAssignedUsers = useTaskStore((state) => state.fetchAssignedUsers);

  // 🧠 Direct, flat Zustand access (no wrapper)
  const author = useTaskStore(
    useShallow((state) => state.authors?.[task?.content_id] || [])
  );
  const publisher = useTaskStore(
    useShallow((state) => state.publishers?.[task?.content_id] || [])
  );
  const assignedUsers = useTaskStore(
    useShallow((state) => state.assignedUsers?.[task?.content_id] || [])
  );

  const handleDrillDown = () => {
    navigate(`/tasks/${task.content_id}`, { state: { task } });
  };

  const handleAssignedUsersOpen = async () => {
    if (task?.content_id) {
      await fetchAssignedUsers(task.content_id);
    }
  };

  const handleOpenModal = (openModal: () => void) => {
    if (cardRef.current) {
      const { top, left } = cardRef.current.getBoundingClientRect();
      const newTop = top - 70;
      const newLeft = left >= 740 ? left - 400 : left + 200;
      setModalPosition({ top: newTop, left: newLeft });
    }
    openModal();
  };

  const { setSelectedTask } = useTaskStore();

  const handleSelect = () => {
    setSelectedTask(task);
    navigate(redirectTo || "/dashboard");
  };

  if (!task || !task.content_id) return null;

  return (
    <Center>
      <Box
        ref={cardRef}
        bg={isAssignOpen || isReferenceModalOpen ? "blue.200" : "stat2Gradient"}
        borderWidth="1px"
        borderRadius="lg"
        overflow="hidden"
        boxShadow="md"
        p={3}
        w="250px"
        h="405px"
        display="flex"
        flexDirection="column"
        justifyContent="space-between"
        margin="10px"
      >
        <Center>
          <Text fontWeight="bold" fontSize="md" mb={0}>
            Content Details
          </Text>
        </Center>
        <Text
          fontWeight="bold"
          mt={2}
          bg="whiteAlpha.700"
          color="gray.800"
          borderRadius="md"
          noOfLines={2}
          fontSize={compact ? "sm" : "md"}
          textAlign="center"
          marginBottom={"4px"}
        >
          <Link href={task.url} target="_blank">
            {task.content_name}
          </Link>
        </Text>
        <Box flex="1">
          <Box w="100%" h="150px" overflow="hidden" borderRadius="md" mb={2}>
            <Image
              src={`${API_BASE_URL}/${task.thumbnail}`}
              alt="Thumbnail"
              borderRadius="md"
              w="100%"
              h="100%"
              objectFit="cover"
              mx="auto"
            />
          </Box>

          {author.length > 0 && (
            <Text fontSize={compact ? "xs" : "sm"} mt={1}>
              <strong>Author:</strong>{" "}
              {author
                .map((a) => `${a.author_first_name} ${a.author_last_name}`)
                .join(", ")}
            </Text>
          )}

          {publisher.length > 0 && (
            <Text fontSize={compact ? "xs" : "sm"} mt={1}>
              <strong>Publisher:</strong>{" "}
              {publisher.map((p) => p.publisher_name).join(", ")}
            </Text>
          )}

          <Progress
            value={
              task.progress === "Completed"
                ? 100
                : task.progress === "Partially Complete"
                ? 50
                : 25
            }
            colorScheme={
              task.progress === "Completed"
                ? "green"
                : task.progress === "Partially Complete"
                ? "yellow"
                : "red"
            }
            mt={2}
          />
        </Box>
        <Center>
          <HStack>
            <Button colorScheme="blue" onClick={handleSelect}>
              Select
            </Button>

            <Menu>
              <MenuButton as={Button} colorScheme="teal">
                Actions
              </MenuButton>
              <MenuList>
                <Menu onOpen={handleAssignedUsersOpen}>
                  <MenuButton as={Button} rightIcon={<BiChevronDown />}>
                    Users
                  </MenuButton>
                  <MenuList>
                    {assignedUsers.length > 0 ? (
                      assignedUsers.map((user) => (
                        <MenuItem key={user.user_id}>{user.username}</MenuItem>
                      ))
                    ) : (
                      <MenuItem>No Users Assigned</MenuItem>
                    )}
                  </MenuList>
                </Menu>
                <MenuItem onClick={() => handleOpenModal(onAssignOpen)}>
                  Assign User
                </MenuItem>
                <MenuItem onClick={() => handleOpenModal(onReferenceModalOpen)}>
                  Manage References
                </MenuItem>
                <MenuItem onClick={handleDrillDown}>Drill Down</MenuItem>
              </MenuList>
            </Menu>
          </HStack>
        </Center>
        {isAssignOpen && (
          <AssignUserModal
            isOpen={isAssignOpen}
            onClose={onAssignClose}
            taskId={task.content_id}
            taskName={task.content_name}
            position={modalPosition}
          />
        )}

        {isReferenceModalOpen && (
          <ReferenceModal
            isOpen={isReferenceModalOpen}
            onClose={onReferenceModalClose}
            taskId={task.content_id}
          />
        )}
      </Box>
    </Center>
  );
};

export default memo(TaskCard);
