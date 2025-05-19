import React from "react";
import {
  Box,
  Heading,
  Text,
  VStack,
  HStack,
  Card,
  CardHeader,
  CardBody,
  Badge,
  Button,
  Avatar,
  Progress,
  useBreakpointValue,
} from "@chakra-ui/react";
import { Task } from "../../../shared/entities/types";

interface GamePreviewProps {
  task?: Task;
}

const sampleClaims = [
  {
    id: 1,
    text: "Vaccines contain microchips for tracking.",
    reference: "Refuted by multiple scientific journals.",
  },
  {
    id: 2,
    text: "5G radiation weakens the immune system.",
    reference: "No clinical evidence found in WHO report.",
  },
  {
    id: 3,
    text: "Bill Gates owns the WHO.",
    reference: "False. WHO is funded by 194 member states and various donors.",
  },
];

const fakeUsers = [
  {
    name: "InfoHunter42",
    score: 1450,
    badge: "🔥 Truth Tier",
    color: "orange.400",
  },
  {
    name: "SkeptiKat",
    score: 1320,
    badge: "🧠 Logical Elite",
    color: "blue.300",
  },
  {
    name: "Debunklord",
    score: 1600,
    badge: "⚔️ Claim Slayer",
    color: "purple.300",
  },
];

const GamePreview: React.FC<GamePreviewProps> = ({ task }) => {
  const sampleTask = task || {
    content_name:
      "Operation DebunkStorm – Viral Misinformation Threat Level Orange",
  };

  const isMobile = useBreakpointValue({ base: true, md: false });

  return (
    <Box p={6} minH="100vh" bg="gray.950" position="relative" overflow="hidden">
      {/* Molecule-style SVG background */}
      <Box
        position="absolute"
        top="0"
        left="0"
        w="100%"
        h="100%"
        opacity={0.05}
        zIndex={0}
        pointerEvents="none"
      >
        <svg width="100%" height="100%">
          <circle cx="20%" cy="30%" r="60" fill="teal" />
          <circle cx="40%" cy="50%" r="40" fill="blue" />
          <circle cx="70%" cy="25%" r="30" fill="purple" />
          <line
            x1="20%"
            y1="30%"
            x2="40%"
            y2="50%"
            stroke="white"
            strokeWidth="2"
          />
          <line
            x1="40%"
            y1="50%"
            x2="70%"
            y2="25%"
            stroke="white"
            strokeWidth="2"
          />
        </svg>
      </Box>

      <VStack spacing={6} align="stretch" zIndex={1} position="relative">
        <Box bg="gray.900" p={6} rounded="xl" boxShadow="xl">
          <Heading size="lg" color="teal.300">
            🕵️ Mission Briefing
          </Heading>
          <Text mt={2} color="gray.300">
            As a certified TruthTroller, your mission is to infiltrate a viral
            thread and assess the credibility of high-impact claims.
          </Text>
          <Text mt={1} fontSize="sm" color="gray.400">
            Task: <strong>{sampleTask.content_name}</strong>
          </Text>
        </Box>

        <HStack justify="space-between">
          <Text color="gray.300">🧑 Player: You (anonymous)</Text>
          <Text color="gray.300">Streak: 3 | Accuracy: 87%</Text>
        </HStack>

        <VStack spacing={4} align="stretch">
          {sampleClaims.map((claim) => (
            <Card key={claim.id} bg="gray.800" borderLeft="6px solid teal">
              <CardHeader>
                <Heading size="md" color="teal.200">
                  ⚔️ Battle Claim #{claim.id}
                </Heading>
              </CardHeader>
              <CardBody>
                <Text color="white" fontSize="lg">
                  {claim.text}
                </Text>
                <Text fontSize="sm" color="gray.400" mt={2}>
                  Intel: {claim.reference}
                </Text>
                <HStack spacing={4} mt={4} justify="center">
                  <Button colorScheme="green" variant="solid">
                    ✅ Defend
                  </Button>
                  <Button colorScheme="yellow" variant="outline">
                    🤔 Investigate
                  </Button>
                  <Button colorScheme="red" variant="ghost">
                    ❌ Expose
                  </Button>
                </HStack>
              </CardBody>
            </Card>
          ))}
        </VStack>

        <Box bg="gray.800" p={4} rounded="lg" mt={8}>
          <Heading size="md" color="teal.200" mb={2}>
            🧑‍🤝‍🧑 Leaderboard Snapshot
          </Heading>
          <VStack spacing={2} align="stretch">
            {fakeUsers.map((u) => (
              <HStack key={u.name} justify="space-between">
                <HStack>
                  <Avatar size="sm" name={u.name} />
                  <Text color="gray.200">{u.name}</Text>
                </HStack>
                <HStack>
                  <Badge colorScheme="purple" bg={u.color} color="black">
                    {u.badge}
                  </Badge>
                  <Text color="teal.200">Score: {u.score}</Text>
                </HStack>
              </HStack>
            ))}
          </VStack>
        </Box>

        <Box mt={8} textAlign="center">
          <Button size="lg" colorScheme="teal" isDisabled>
            🚧 Next Battle Coming Soon...
          </Button>
        </Box>
      </VStack>
    </Box>
  );
};

export default GamePreview;
