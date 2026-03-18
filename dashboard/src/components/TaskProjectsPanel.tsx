// src/components/TaskProjectsPanel.tsx
import {
  Box,
  Card,
  CardBody,
  Heading,
  Progress,
  HStack,
  Avatar,
  Text,
  Grid,
  GridItem,
  Image,
  VStack,
} from "@chakra-ui/react";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "https://localhost:5001";

// Mock data
const projects = [
  {
    publisher: {
      name: "National Daily",
      logo: `${API_BASE_URL}/assets/images/publishers/publisher_id_99.jpg`,
    },
    authors: [
      `${API_BASE_URL}/assets/images/authors/author_id_333.avif`,
      `${API_BASE_URL}/assets/images/authors/author_id_115.png`,
    ],
    date: "2024-11-03",
    progress: 75,
  },
  {
    publisher: {
      name: "Children's Health Defense",
      logo: `${API_BASE_URL}/assets/images/publishers/publisher_id_100.png`,
    },
    authors: [
      `${API_BASE_URL}/assets/images/authors/author_id_529.jpeg`,
      `${API_BASE_URL}/assets/images/authors/author_id_333.avif`,
      `${API_BASE_URL}/assets/images/authors/author_id_117.png`,
    ],
    date: "2024-12-12",
    progress: 35,
  },
  {
    publisher: {
      name: "CNN",
      logo: `${API_BASE_URL}/assets/images/publishers/publisher_id_104.png`,
    },
    authors: [
      `${API_BASE_URL}/assets/images/authors/author_id_117.png`,
      `${API_BASE_URL}/assets/images/authors/author_id_529.jpeg`,
      `${API_BASE_URL}/assets/images/authors/author_id_115.png`,
      `${API_BASE_URL}/assets/images/authors/author_id_333.avif`,
    ],
    date: "2025-01-10",
    progress: 92,
  },
  {
    publisher: {
      name: "Washington Post",
      logo: `${API_BASE_URL}/assets/images/publishers/publisher_id_127.png`,
    },
    authors: [
      `${API_BASE_URL}/assets/images/authors/author_id_333.avif`,
      `${API_BASE_URL}/assets/images/authors/author_id_115.png`,
      `${API_BASE_URL}/assets/images/authors/author_id_529.jpeg`,
    ],
    date: "2025-02-01",
    progress: 60,
  },
];

const TaskProjectsPanel: React.FC = () => {
  return (
    <Box className="mr-card mr-card-green" height="100%" p={4} position="relative">
      <div className="mr-glow-bar mr-glow-bar-green" />
      <div className="mr-scanlines" />

      <Heading size="md" mb={4} className="mr-heading">
        TASK PROJECTS
      </Heading>

      {/* Column headers */}
      <Grid
        templateColumns="180px 150px 100px 1fr 40px"
        gap={3}
        pb={2}
        borderBottom="1px solid rgba(0, 255, 200, 0.3)"
      >
        <Text fontSize="xs" className="mr-text-secondary" textTransform="uppercase">
          Publisher
        </Text>
        <Text fontSize="xs" className="mr-text-secondary" textTransform="uppercase">
          Authors
        </Text>
        <Text fontSize="xs" className="mr-text-secondary" textTransform="uppercase">
          Date
        </Text>
        <Text fontSize="xs" className="mr-text-secondary" textTransform="uppercase">
          Progress
        </Text>
        <Box /> {/* spacer for % */}
      </Grid>

      <VStack spacing={3} align="stretch" mt={2}>
        {projects.map((proj, i) => (
          <Grid
            key={i}
            templateColumns="180px 150px 100px 1fr 40px"
            gap={3}
            alignItems="center"
            borderBottom="1px solid rgba(0, 255, 200, 0.1)"
            pb={2}
            pr={1}
          >
            {/* Publisher column */}
            <HStack>
              <Image
                src={proj.publisher.logo}
                boxSize="28px"
                borderRadius="md"
                alt={proj.publisher.name}
              />
              <Text fontSize="xs" className="mr-text-primary" fontWeight="bold">
                {proj.publisher.name}
              </Text>
            </HStack>

            {/* Authors */}
            <HStack spacing={-1}>
              {proj.authors.map((src, j) => (
                <Avatar key={j} src={src} size="xs" border="1px solid rgba(0, 255, 200, 0.3)" />
              ))}
            </HStack>

            {/* Date */}
            <Text fontSize="xs" className="mr-text-secondary">
              {proj.date}
            </Text>

            {/* Progress bar */}
            <Progress
              value={proj.progress}
              size="sm"
              colorScheme="cyan"
              borderRadius="sm"
              bg="rgba(0, 0, 0, 0.3)"
              sx={{
                '& > div': {
                  background: 'linear-gradient(90deg, rgba(0, 255, 200, 0.6), rgba(0, 200, 255, 0.8))',
                }
              }}
            />

            {/* % text */}
            <Text fontSize="xs" textAlign="right" className="mr-text-primary" fontWeight="bold">
              {proj.progress}%
            </Text>
          </Grid>
        ))}
      </VStack>
    </Box>
  );
};

export default TaskProjectsPanel;
