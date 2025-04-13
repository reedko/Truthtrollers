// src/components/dashboard/BeaconPanel.tsx

import {
  Box,
  Center,
  Grid,
  GridItem,
  Spinner,
  useToast,
} from "@chakra-ui/react";
import { useEffect, useState } from "react";
import {
  fetchVerimeterData,
  fetchTrollmeterData,
} from "../../services/useDashboardAPI";
import { VerimeterData, TrollmeterData } from "../../types";

import TaskCard from "./TaskCard";
import PubCard from "./PubCard";
import AuthCard from "./AuthCard";
import VerimeterGauge from "./VerimeterGauge";
import TrollmeterGauge from "./TrollmeterGauge";
import ProgressMeter from "./ProgressMeter";

interface BeaconPanelProps {
  task: any; // from props or Zustand store
  publisherList: any[];
  authorList: any[];
}

const BeaconPanel: React.FC<BeaconPanelProps> = ({
  task,
  publisherList,
  authorList,
}) => {
  const [verimeter, setVerimeter] = useState<VerimeterData | null>(null);
  const [trollmeter, setTrollmeter] = useState<TrollmeterData | null>(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  useEffect(() => {
    const loadData = async () => {
      try {
        const [veri, troll] = await Promise.all([
          fetchVerimeterData(task.content_id),
          fetchTrollmeterData(task.content_id),
        ]);
        setVerimeter(veri);
        setTrollmeter(troll);
      } catch (err) {
        toast({
          title: "Error loading Beacon data",
          status: "error",
          duration: 3000,
          isClosable: true,
        });
      } finally {
        setLoading(false);
      }
    };
    if (task?.content_id) loadData();
  }, [task]);

  if (loading || !verimeter || !trollmeter) {
    return (
      <Center h="300px">
        <Spinner size="xl" />
      </Center>
    );
  }

  return (
    <Box p={4}>
      <Grid templateColumns="repeat(5, 1fr)" gap={4} alignItems="start">
        <GridItem>
          <TaskCard task={task} />
        </GridItem>

        <GridItem>
          <VerimeterGauge
            score={verimeter.verimeter_score}
            mood={verimeter.verimeter_mood}
          />
        </GridItem>

        <GridItem>
          <PubCard publishers={publisherList} />
        </GridItem>

        <GridItem>
          <ProgressMeter progress={task.progress} />
        </GridItem>

        <GridItem>
          <AuthCard authors={authorList} />
        </GridItem>
      </Grid>

      <Box mt={6}>
        <TrollmeterGauge trollmeter={trollmeter} />
      </Box>
    </Box>
  );
};

export default BeaconPanel;
