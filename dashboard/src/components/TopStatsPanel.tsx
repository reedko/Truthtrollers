// src/components/TopStatsPanel.tsx
import {
  Box,
  SimpleGrid,
  Stat,
  StatLabel,
  StatNumber,
  Card,
  CardBody,
  CardHeader,
  Heading,
  Text,
  Flex,
  Grid,
  VStack,
  HStack,
  Spacer,
  Center,
} from "@chakra-ui/react";
import { useAuthStore } from "../store/useAuthStore";
import { useTaskStore } from "../store/useTaskStore";
import VisionTheme from "./themes/VisionTheme";
import StatCard from "./StatCard";
import TruthGauge from "./ModernArcGauge";
import GlowGauge from "./ModernCircleGauge";
import BareGauge from "./BareGauge";

const TopStatsPanel: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const assignedTasks = useTaskStore((s) => s.content);
  const claimReferences = useTaskStore((s) => s.claimReferences);
  const claimsByTask = useTaskStore((s) => s.claimsByTask);

  const verificationTasks = assignedTasks.flatMap((task) => {
    const claims = claimsByTask[task.content_id] || [];
    return claims.filter((claim) => {
      const refs = claimReferences[claim.claim_id] || [];
      return refs.length === 0 || refs.some((r) => r.supportLevel < 0.5);
    });
  });

  const verifiedCount = Object.values(claimReferences).filter(
    (refs) => refs.length > 0 && refs.every((r) => r.supportLevel >= 0.5)
  ).length;

  const evalRate = Math.round(
    (Object.values(claimReferences).filter((r) => r.length > 0).length /
      Object.values(claimsByTask).flat().length) *
      100 || 0
  );

  return (
    <Flex
      justify="space-between"
      align="start"
      wrap="wrap"
      mb={3}
      gap={1}
      flexDirection={{ base: "column", md: "row" }}
    >
      {/* Welcome Card - wide and left-aligned */}
      <Box flex="1" maxW="700px">
        <Card
          height="380px"
          borderRadius="2xl"
          overflow="hidden"
          boxShadow="xl"
          bg="stackGradient"
          position="relative"
        >
          <CardBody
            display="flex"
            flexDirection="row"
            justifyContent="space-between"
            alignItems="center"
            height="100%"
            px={8}
            py={6}
            bgGradient="linear(to-r, rgba(0,0,0,0.6), rgba(0,0,0,0.2))"
            backdropFilter="blur(2px)"
          >
            <Box maxW="50%">
              <Heading size="lg" mb={3} color="teal.200">
                Welcome, {user?.username} 👋
              </Heading>
              <Text fontSize="md" color="gray.200">
                Track your tasks, verify claims, and rate references.
              </Text>
            </Box>

            <Box
              maxW="300px"
              height="100%"
              display="flex"
              alignItems="center"
              justifyContent="center"
            >
              <img
                src={`${VisionTheme.textures.backgroundImage}`}
                alt="The Truth is Sweet"
                style={{ maxHeight: "100%", maxWidth: "100%" }}
              />
            </Box>
          </CardBody>
        </Card>
      </Box>

      <Card
        height="380px"
        width="380px"
        borderRadius="2xl"
        overflow="hidden"
        boxShadow="xl"
        bg="stat2Gradient"
        position="relative"
        minW={{ base: "100%", md: "300px" }}
      >
        <CardHeader>
          <VStack spacing={2} align="center" mb={2} mt={2}>
            <Spacer />
            <Heading size="lg" color="teal.200">
              Progress Overview
            </Heading>
            <TruthGauge
              score={assignedTasks.length / 10}
              label="PROGRESS"
              size={{ w: 220, h: 140 }}
              normalize={true}
            />
          </VStack>
        </CardHeader>

        <CardBody>
          <VStack spacing={4}>
            <StatCard label="Assigned Tasks" value={assignedTasks.length} />
            <StatCard
              label="Verification Tasks"
              value={verificationTasks.length}
            />
          </VStack>
        </CardBody>
      </Card>
      <Card
        height="380px"
        width="500px"
        borderRadius="2xl"
        overflow="hidden"
        boxShadow="xl"
        bg="statGradient"
        position="relative"
        p={4}
      >
        <Flex direction="column" height="100%">
          {/* Header */}
          <Heading size="lg" color="teal.200" mb={4}>
            Claims Verified
          </Heading>

          <Grid templateColumns="1fr 1fr" flex="1" gap={4}>
            {/* Left: Stat Cards stacked at bottom */}
            <Flex direction="column" justify="flex-end" gap={2}>
              <StatCard
                label="Verified Claims"
                value={
                  Object.values(claimReferences).filter(
                    (refs) =>
                      refs.length > 0 &&
                      refs.every((r) => r.supportLevel >= 0.5)
                  ).length
                }
              />
              <StatCard
                label="Claim Evaluation Rate"
                value={`${Math.round(
                  (Object.values(claimReferences).filter((r) => r.length > 0)
                    .length /
                    Object.values(claimsByTask).flat().length) *
                    100 || 0
                )}%`}
              />
            </Flex>

            {/* Right: Gauge Centered Vertically */}
            <Center>
              <GlowGauge score={0.75} label="Verified" />
            </Center>
          </Grid>
        </Flex>
      </Card>
    </Flex>
  );
};

export default TopStatsPanel;
