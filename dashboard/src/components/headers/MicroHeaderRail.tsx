import React, { useMemo, useState } from "react";
import {
  Box,
  HStack,
  VStack,
  Text,
  Image,
  Avatar,
  Badge,
  Drawer,
  DrawerOverlay,
  DrawerContent,
  DrawerCloseButton,
  DrawerHeader,
  DrawerBody,
  useDisclosure,
  Center,
  Button,
} from "@chakra-ui/react";
import BoolCard from "../BoolCard";
import TaskCard from "../TaskCard";
import PubCard from "../PubCard";
import AuthCard from "../AuthCard";
import ProgressCard from "../ProgressCard";
import { Author, Publisher, Task } from "../../../../shared/entities/types";
import ScoreTile from "../tiles/ScoreTile";
type TileKind = "score" | "task" | "publisher" | "author" | "progress";

type Props = {
  score: number | null | undefined;
  tasks: Task[];
  pivotTask: Task | null;
  authors: Author[];
  publishers: Publisher[];
  onSelectTask?: (t: Task) => void;
};

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

export default function MicroHeaderRail({
  score,
  tasks,
  pivotTask,
  authors,
  publishers,
  onSelectTask,
}: Props) {
  const [open, setOpen] = useState<TileKind | null>(null);
  const { isOpen, onOpen, onClose } = useDisclosure();

  const contentId = pivotTask?.content_id;

  const openTile = (k: TileKind) => {
    setOpen(k);
    onOpen();
  };

  const closeTile = () => {
    onClose();
    setOpen(null);
  };

  // tiny helpers for the tiles
  const taskThumb = useMemo(
    () =>
      pivotTask?.thumbnail ? `${API_BASE_URL}/${pivotTask.thumbnail}` : "",
    [pivotTask]
  );
  const publisher = publishers?.[0];
  const author = authors?.[0];

  return (
    <>
      {/* Horizontal, swipeable rail (no stagger, snap) */}
      <HStack
        as="section"
        spacing={3}
        px={3}
        py={2}
        overflowX="auto"
        overflowY="hidden" // ⬅ keep vertical from affecting layout
        align="stretch"
        h="calc(88px + 16px)" // ⬅ tile height (88) + vertical padding (8+8)
        sx={{
          scrollSnapType: "x mandatory",
          WebkitOverflowScrolling: "touch",
          touchAction: "pan-x", // ⬅ only horizontal gestures on the rail
          overscrollBehaviorX: "contain",
          overscrollBehaviorY: "none", // ⬅ don’t bubble vertical scroll through the rail
          "::-webkit-scrollbar": { display: "none" },
          msOverflowStyle: "none",
          scrollbarWidth: "none",
        }}
      >
        {/* …the Tile children stay the same… */}

        <Tile onClick={() => openTile("score")} label="Score">
          <Center flexDir="column" h="100%" overflow="hidden" gap={1}>
            <Box boxSize="110px" flex="0 0 auto" overflow="hidden">
              <ScoreTile value={score} />
            </Box>
            <Text fontSize="2xl" fontWeight="bold" lineHeight="1" noOfLines={1}>
              {score == null ? "–" : Math.round(score * 100)}
            </Text>
            <Badge mt={1} colorScheme="purple" flex="0 0 auto">
              Verimeter
            </Badge>
          </Center>
        </Tile>

        <Tile onClick={() => openTile("task")} label="Task">
          <HStack w="100%" align="center" spacing={3}>
            {taskThumb ? (
              <Image
                src={taskThumb}
                alt="thumb"
                boxSize="44px"
                borderRadius="md"
                objectFit="cover"
              />
            ) : (
              <Box boxSize="44px" borderRadius="md" bg="whiteAlpha.300" />
            )}
            <VStack spacing={0} align="start" flex={1}>
              <Text fontSize="xs" noOfLines={2}>
                {pivotTask?.content_name ?? "No task"}
              </Text>
              <Badge mt={1} variant="subtle">
                #{contentId ?? "—"}
              </Badge>
            </VStack>
          </HStack>
        </Tile>

        <Tile onClick={() => openTile("publisher")} label="Publisher">
          <Center flexDir="column" gap={2}>
            {publisher?.publisher_icon ? (
              <Image
                src={`${API_BASE_URL}/${publisher.publisher_icon}`}
                alt={publisher.publisher_name}
                boxSize="44px"
                borderRadius="full"
                objectFit="cover"
              />
            ) : (
              <Avatar name={publisher?.publisher_name} size="sm" />
            )}
            <Text fontSize="xs" noOfLines={1}>
              {publisher?.publisher_name ?? "—"}
            </Text>
          </Center>
        </Tile>

        <Tile onClick={() => openTile("author")} label="Author">
          <Center flexDir="column" gap={2}>
            {author?.author_profile_pic ? (
              <Image
                src={`${API_BASE_URL}/${author.author_profile_pic}`}
                alt="author"
                boxSize="44px"
                borderRadius="full"
                objectFit="cover"
              />
            ) : (
              <Avatar
                name={`${author?.author_first_name ?? ""} ${
                  author?.author_last_name ?? ""
                }`}
                size="sm"
              />
            )}
            <Text fontSize="xs" noOfLines={1}>
              {(author &&
                `${author.author_first_name} ${author.author_last_name}`) ||
                "—"}
            </Text>
          </Center>
        </Tile>

        <Tile onClick={() => openTile("progress")} label="Progress">
          <Center flexDir="column" gap={1}>
            <Text fontSize="lg" fontWeight="bold">
              ▰▱▱
            </Text>
            <Text fontSize="xs" color="whiteAlpha.800">
              Gauges
            </Text>
          </Center>
        </Tile>
      </HStack>

      {/* Sheet with the full existing cards */}
      <Drawer
        isOpen={isOpen}
        onClose={closeTile}
        placement="bottom"
        size="full"
      >
        <DrawerOverlay />
        <DrawerContent>
          <DrawerCloseButton />
          <DrawerHeader>
            {open === "score" && "Score"}
            {open === "task" && "Content Details"}
            {open === "publisher" && "Publisher Details"}
            {open === "author" && "Author Details"}
            {open === "progress" && "Progress"}
          </DrawerHeader>
          <DrawerBody>
            {open === "score" && (
              <BoolCard
                verimeterScore={score ?? null}
                size="sm"
                dense
                contentId={contentId ?? undefined}
              />
            )}

            {open === "task" && (
              <Box>
                <TaskCard
                  task={tasks?.length ? tasks : pivotTask ? [pivotTask] : null}
                  useStore={false}
                  onSelect={(t) => onSelectTask?.(t)}
                  compact
                  hideMeta
                />
                {pivotTask?.url && (
                  <Center mt={4}>
                    <Button
                      as="a"
                      href={pivotTask.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open Source
                    </Button>
                  </Center>
                )}
              </Box>
            )}

            {open === "publisher" && (
              <PubCard publishers={publishers} compact />
            )}

            {open === "author" && <AuthCard authors={authors} compact />}

            {open === "progress" && (
              <ProgressCard
                ProgressScore={0.2}
                totalClaims={90}
                verifiedClaims={27}
                totalReferences={20}
                verifiedReferences={10}
              />
            )}
          </DrawerBody>
        </DrawerContent>
      </Drawer>
    </>
  );
}

/** A tiny, uniform tile */
function Tile({
  children,
  onClick,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
}) {
  return (
    <Box
      onClick={onClick}
      bg="stat2Gradient"
      border="1px solid"
      borderColor="whiteAlpha.300"
      borderRadius="lg"
      p={3}
      minW="180px"
      maxW="220px"
      h="88px"
      cursor="pointer"
      userSelect="none"
      boxShadow="md"
      scrollSnapAlign="start"
      _active={{ transform: "scale(0.98)" }}
    >
      <VStack align="stretch" spacing={1} h="100%">
        <Text fontSize="xs" color="whiteAlpha.700">
          {label}
        </Text>
        <Box flex="1" display="flex" alignItems="center">
          {children}
        </Box>
      </VStack>
    </Box>
  );
}
