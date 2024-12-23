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
} from "@chakra-ui/react";
import { BiChevronDown } from "react-icons/bi";
import AssignUserModal from "./AssignUserModal";
import SourceListModal from "./SourceListModal";
import { useTaskStore } from "../store/useTaskStore";
import { memo, useEffect, useMemo, useRef, useState } from "react";

import { useShallow } from "zustand/react/shallow";
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

const TaskCard: React.FC<{ task: any }> = ({ task }) => {
  const fetchAuthors = useTaskStore((state) => state.fetchAuthors);
  const fetchPublishers = useTaskStore((state) => state.fetchPublishers);
  const author = useTaskStore((state) => state.authors[task.task_id]);
  const publisher = useTaskStore((state) => state.publishers[task.task_id]);
  const navigate = useNavigate();
  const fetchAssignedUsers = useTaskStore((state) => state.fetchAssignedUsers);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const [modalPosition, setModalPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    // Fetch author and publisher for the task
    if (!author) fetchAuthors(task.task_id);

    if (!publisher) fetchPublishers(task.task_id);
  }, [task.task_id, fetchAuthors, fetchPublishers, author, publisher]);

  const assignedUsers = useTaskStore(
    useShallow((state) => state.assignedUsers[task.task_id] || [])
  );

  const {
    isOpen: isAssignOpen,
    onOpen: onAssignOpen,
    onClose: onAssignClose,
  } = useDisclosure();

  const {
    isOpen: isReferencesOpen,
    onOpen: onReferencesOpen,
    onClose: onReferencesClose,
  } = useDisclosure();

  const handleDrillDown = () => {
    navigate(`/tasks/${task.task_id}`, { state: { task } });
  };
  const handleAssignedUsersOpen = async () => {
    try {
      console.log(`Fetching assigned users for task ${task.task_id}`);
      await fetchAssignedUsers(task.task_id); // This updates the store
    } catch (err) {
      console.error("Error fetching assigned users:", err);
    }
  };
  const handleOpenModal = (openModal: () => void) => {
    if (cardRef.current) {
      const { top, left, height } = cardRef.current.getBoundingClientRect();
      let newtop = 0;
      let newleft = 0;
      left >= 740 ? (newleft = left - 400) : (newleft = left + 200);
      newtop = top - 70;
      setModalPosition({
        top: newtop,
        left: newleft, // Adjust for modal width
      });
      console.log("MP:", { modalPosition });
    }

    openModal();
  };
  return (
    <Center>
      <Box
        ref={cardRef}
        bg={isAssignOpen ? "blue.200" : isReferencesOpen ? "blue.200" : "teal"}
        borderWidth="1px"
        borderRadius="lg"
        overflow="hidden"
        boxShadow="md"
        p={4}
        width="250px"
        margin="10px"
      >
        <Image
          src={`${API_BASE_URL}/${task.thumbnail}`}
          alt="Thumbnail"
          borderRadius="md"
          boxSize="200px"
          objectFit="cover"
        />
        <Text fontWeight="bold" mt={2} noOfLines={2}>
          <Link href={task.url} target="_blank">
            {task.task_name}
          </Link>
        </Text>
        {author && (
          <Text fontSize="sm" mt={1}>
            <strong>Author:</strong>{" "}
            {`${author[0]?.author_first_name} ${author[0]?.author_last_name}`}
          </Text>
        )}
        {publisher && (
          <Text fontSize="sm" mt={1}>
            <strong>Publisher:</strong> {publisher[0]?.publisher_name}
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

        <Menu>
          <MenuButton as={Button} colorScheme="teal">
            Actions
          </MenuButton>
          <MenuList>
            <MenuItem onClick={() => handleOpenModal(onAssignOpen)}>
              Assign User
            </MenuItem>
            <MenuItem onClick={() => handleOpenModal(onReferencesOpen)}>
              Source List
            </MenuItem>
            <MenuItem onClick={handleDrillDown}>Drill Down</MenuItem>
          </MenuList>
        </Menu>

        {/* Assign User Modal */}
        {isAssignOpen && (
          <AssignUserModal
            isOpen={isAssignOpen}
            onClose={onAssignClose}
            taskId={task.task_id}
            taskName={task.task_name}
            position={modalPosition} // Pass modal position
          />
        )}

        {/* Source List Modal */}
        {isReferencesOpen && (
          <SourceListModal
            isOpen={isReferencesOpen}
            onClose={onReferencesClose}
            taskId={task.task_id}
            taskName={task.task_name}
            position={modalPosition} // Pass modal position
          />
        )}
      </Box>
    </Center>
  );
};

export default memo(TaskCard);
