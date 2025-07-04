// src/components/TopStatsPanel.tsx
import {
  Box,
  Grid,
  GridItem,
  Stat,
  StatLabel,
  StatNumber,
  Card,
  CardBody,
  CardHeader,
  Heading,
  Text,
  VStack,
  Spacer,
  Center,
} from "@chakra-ui/react";
import VisionTheme from "./themes/VisionTheme";
import StatCard from "./StatCard";
import TruthGauge from "./ModernArcGauge";
import GlowGauge from "./ModernCircleGauge";
import {
  Task,
  Claim,
  ClaimReferenceMap,
  ClaimsByTaskMap,
} from "../../../shared/entities/types";

interface TopStatsPanelProps {
  tasks: Task[];
  claimsByTask: ClaimsByTaskMap;
  claimReferences: ClaimReferenceMap;
  username?: string;
}

const TopStatsPanel: React.FC<TopStatsPanelProps> = ({
  tasks,
  claimsByTask,
  claimReferences,
  username,
}) => {
  const verificationTasks = tasks.flatMap((task) => {
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
    <Grid
      templateColumns={{
        base: "1fr",
        md: "repeat(2, 1fr)",
        lg: "100fr 55fr 75fr",
      }}
      gap={4}
      alignItems="stretch"
    >
      {/* Welcome Card */}
      <GridItem colSpan={{ base: 1, md: 2, lg: 1 }}>
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
                Welcome, {username} 👋
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
      </GridItem>

      {/* Progress Card */}
      <GridItem>
        <Card
          height="380px"
          borderRadius="2xl"
          overflow="hidden"
          boxShadow="xl"
          bg="stat2Gradient"
          position="relative"
        >
          <CardHeader>
            <VStack spacing={2} align="center" mb={2} mt={2}>
              <Spacer />
              <Heading size="lg" color="teal.200">
                Progress Overview
              </Heading>
              <TruthGauge
                score={tasks.length / 10}
                label="PROGRESS"
                size={{ w: 220, h: 140 }}
                normalize={true}
              />
            </VStack>
          </CardHeader>

          <CardBody>
            <VStack spacing={4}>
              <StatCard label="Assigned Tasks" value={tasks.length} />
              <StatCard
                label="Verification Tasks"
                value={verificationTasks.length}
              />
            </VStack>
          </CardBody>
        </Card>
      </GridItem>

      {/* Claims Verified Card */}
      <GridItem>
        <Card
          height="380px"
          borderRadius="2xl"
          overflow="hidden"
          boxShadow="xl"
          bg="statGradient"
          position="relative"
          p={4}
        >
          <Box display="flex" flexDirection="column" height="100%">
            <Heading size="lg" color="teal.200" mb={4}>
              Claims Verified
            </Heading>

            <Grid templateColumns="1fr 1fr" flex="1" gap={4}>
              <Box
                display="flex"
                flexDirection="column"
                justifyContent="flex-end"
                gap={2}
              >
                <StatCard label="Verified Claims" value={verifiedCount} />
                <StatCard
                  label="Claim Evaluation Rate"
                  value={`${evalRate}%`}
                />
              </Box>

              <Center>
                <GlowGauge score={0.75} label="Verified" />
              </Center>
            </Grid>
          </Box>
        </Card>
      </GridItem>
    </Grid>
  );
};

export default TopStatsPanel;
