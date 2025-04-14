import React, { useEffect, useState } from "react";
import {
  Box,
  Heading,
  Select,
  Spinner,
  VStack,
  Divider,
  Grid,
  GridItem,
  Text,
} from "@chakra-ui/react";
import { useSearchParams } from "react-router-dom";
import { useTaskStore } from "../store/useTaskStore";
import { useShallow } from "zustand/react/shallow";
import TaskCard from "./TaskCard";
import PubCard from "./PubCard";
import AuthCard from "./AuthCard";
import DiscussionBoard from "./DiscussionBoard";
import UnifiedHeader from "./UnifiedHeader";
import VerimeterGauge from "./VerimeterGauge";
import TrollmeterGauge from "./TrollmeterGauge";
import CustomVerimeterGauge from "./CustomVerimeterGauge";
import TrollSupportBar from "./TrollSupportBar";
import ModernTrollmeterGauge from "./ModernTrollmeterGauge";
import ModernArcGauge from "./ModernArcGauge";
import BoolCard from "./BoolCard";
import ProgressCard from "./ProgressCard";

// 🚀 MOCK USER TYPE
type UserType = "casual" | "troller";
const Dashboard: React.FC = () => {
  const [searchParams] = useSearchParams();

  const rawUserType = searchParams.get("userType");
  const userType: UserType = rawUserType === "troller" ? "troller" : "casual";

  const tasks = useTaskStore(useShallow((state) => state.filteredTasks));
  const fetchTasks = useTaskStore((state) => state.fetchTasks);
  const fetchAuthors = useTaskStore((state) => state.fetchAuthors);
  const fetchPublishers = useTaskStore((state) => state.fetchPublishers);

  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);

  useEffect(() => {
    const taskParam = searchParams.get("task") || "9715"; // fallback demo
    setSelectedTaskId(Number(taskParam));
  }, [searchParams]);

  useEffect(() => {
    if (tasks.length === 0) {
      fetchTasks();
    }
  }, [tasks.length, fetchTasks]);

  const selectedTask = tasks.find((t) => t.content_id === selectedTaskId);
  const authors = useTaskStore(
    useShallow((state) =>
      selectedTaskId ? state.authors?.[selectedTaskId] || [] : []
    )
  );
  const publishers = useTaskStore(
    useShallow((state) =>
      selectedTaskId ? state.publishers?.[selectedTaskId] || [] : []
    )
  );
  console.log(publishers, "pub oin load");
  useEffect(() => {
    if (selectedTaskId) {
      fetchAuthors(selectedTaskId);
      fetchPublishers(selectedTaskId);
    }
  }, [selectedTaskId, fetchAuthors, fetchPublishers]);

  return (
    <Box p={6} maxW="100%">
      <Heading size="xl" mb={4}>
        🧭 Your Dashboard
      </Heading>

      {!selectedTask ? (
        <Spinner />
      ) : (
        <VStack align="stretch" spacing={8}>
          <BoolCard
            verimeterScore={-0.6}
            trollmeterScore={0.9}
            pro={27}
            con={94}
          />
          <ModernArcGauge score={0} label={"VERACIMETER"} />
          <ModernArcGauge score={0.9} label={"TROLLMETER"} />
          <VerimeterGauge score={0.83} />
          <TrollmeterGauge score={-0.85} pro={27} con={77} />
          <TrollSupportBar value={27} label="Agree" />
          <TrollSupportBar value={87} label="Disagree" />
          <ModernTrollmeterGauge score={-0.85} pro={27} con={77} />
          <Grid templateColumns={{ base: "1fr", md: "repeat(5, 1fr)" }} gap={4}>
            <GridItem>
              <BoolCard
                verimeterScore={-0.6}
                trollmeterScore={0.2}
                pro={27}
                con={94}
              />
            </GridItem>

            <GridItem>
              <TaskCard task={selectedTask} useStore={false} />
            </GridItem>

            <GridItem>
              <PubCard publishers={publishers} />
            </GridItem>

            <GridItem>
              <AuthCard authors={authors} />
            </GridItem>
            <GridItem>
              <ProgressCard
                ProgressScore={0.2}
                totalClaims={90}
                verifiedClaims={27}
                totalReferences={20}
                verifiedReferences={10}
              />
            </GridItem>
          </Grid>

          <Divider />

          <Box borderWidth="1px" borderRadius="lg" p={4}>
            <Heading size="md" mb={2}>
              💬 Discussion Board
            </Heading>
            <DiscussionBoard contentId={selectedTask.content_id} />
          </Box>

          {userType === "troller" && (
            <Box borderWidth="1px" borderRadius="lg" p={4}>
              <Heading size="md">⚙️ Troller Tools (Coming Soon)</Heading>
              <Text>Assigned tasks, claim ratings, moderation queue...</Text>
            </Box>
          )}
        </VStack>
      )}
    </Box>
  );
};

export default Dashboard;
