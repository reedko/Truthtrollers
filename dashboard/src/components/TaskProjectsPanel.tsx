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
    <Card height="100%" bg="blackAlpha.600" color="white" overflow="hidden">
      <CardBody>
        <Heading size="md" mb={4} color="teal.200">
          Task Projects
        </Heading>

        {/* Column headers */}
        <Grid
          templateColumns="180px 150px 100px 1fr 40px"
          gap={3}
          pb={2}
          borderBottom="1px solid #444"
        >
          <Text fontSize="sm" color="gray.400">
            Publisher
          </Text>
          <Text fontSize="sm" color="gray.400">
            Authors
          </Text>
          <Text fontSize="sm" color="gray.400">
            Date
          </Text>
          <Text fontSize="sm" color="gray.400">
            Progress
          </Text>
          <Box /> {/* spacer for % */}
        </Grid>

        <VStack spacing={4} align="stretch" mt={2}>
          {projects.map((proj, i) => (
            <Grid
              key={i}
              templateColumns="180px 150px 100px 1fr 40px"
              gap={3}
              alignItems="center"
              borderBottom="1px solid #222"
              pb={1}
              pr={1}
            >
              {/* Publisher column */}
              <HStack>
                <Image
                  src={proj.publisher.logo}
                  boxSize="32px"
                  borderRadius="md"
                  alt={proj.publisher.name}
                />
                <Text fontSize="sm" fontWeight="bold">
                  {proj.publisher.name}
                </Text>
              </HStack>

              {/* Authors */}
              <HStack spacing={-1}>
                {proj.authors.map((src, j) => (
                  <Avatar key={j} src={src} size="xs" border="1px solid #222" />
                ))}
              </HStack>

              {/* Date */}
              <Text fontSize="sm" color="gray.400">
                {proj.date}
              </Text>

              {/* Progress bar */}
              <Progress
                value={proj.progress}
                size="sm"
                colorScheme="teal"
                borderRadius="md"
                bg="gray.700"
                hasStripe
                isAnimated
              />

              {/* % text */}
              <Text fontSize="xs" textAlign="right" color="gray.300">
                {proj.progress}%
              </Text>
            </Grid>
          ))}
        </VStack>
      </CardBody>
    </Card>
  );
};

export default TaskProjectsPanel;
