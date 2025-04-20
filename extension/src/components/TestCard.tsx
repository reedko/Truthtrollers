import React, { useEffect, useState } from "react";
import {
  Box,
  Button,
  GridItem,
  Progress,
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
import "./Popup.css";
import UserConsensusBar from "./UserConsensusBar";
import resizeImage from "../services/image-url";

import VerimeterGauge from "./VerimeterGauge";
import StatCard from "./StatCard";
import TruthGauge from "./ModernArcGauge";

const BASE_URL = process.env.REACT_APP_BASE_URL || "https://localhost:5001";

const getProgressColor = (progress: string | null) => {
  switch (progress) {
    case "Completed":
      return "green";
    case "Partially Complete":
      return "yellow";
    case "Awaiting Evaluation":
      return "blue";
    default:
      return "red";
  }
};

const TaskCard: React.FC = () => {
  const imageUrl = "";

  const meter = `${BASE_URL}/assets/images/meter3.png`;
  const logo = `${BASE_URL}/assets/images/miniLogo.png`;

  return (
    <Box className="popup-box" width="300px" bg="stat5Gradient">
      <VStack spacing={3} align="start">
        <Box bg="cardGradient" className="logo-box" position="relative">
          <HStack spacing="130">
            <Box>{resizeImage(40, logo)}</Box>
            <Text color="white">TruthTrollers</Text>
          </HStack>
        </Box>

        {imageUrl ? (
          <VStack spacing={1} align="center" width="100%">
            <Card
              width="100%"
              borderRadius="2xl"
              overflow="hidden"
              boxShadow="xl"
              bg="stat6Gradient"
              position="relative"
              minW={{ base: "100%", md: "300px" }}
            >
              <CardHeader>
                <VStack spacing={0} align="center" mb={0} mt={0}>
                  <Spacer />

                  <TruthGauge
                    score={-0.73}
                    label="VERIMETER"
                    size={{ w: 220, h: 140 }}
                    normalize={false}
                  />
                </VStack>
              </CardHeader>

              <CardBody>
                <VStack spacing={0}>
                  <Box w="100%" p={0}>
                    <UserConsensusBar
                      trueCount={21}
                      falseCount={71}
                      total={121}
                    />
                  </Box>
                </VStack>
              </CardBody>
            </Card>
          </VStack>
        ) : (
          imageUrl && (
            <Box position="relative" left="25%">
              {resizeImage(120, imageUrl)}
              <VerimeterGauge score={-0.83} />
            </Box>
          )
        )}

        {imageUrl ? (
          <Box width="280px">
            <Text fontWeight="bold" fontSize="l" wrap="yes">
              {"THIS IS WHERE THE TITLE GOES"}
            </Text>
            <Grid templateRows="repeat(2, 1fr)">
              <GridItem>
                <Text color="gray.600" fontSize="sm">
                  Progress: {"Completed"}
                </Text>
              </GridItem>
              <GridItem>
                <Progress
                  value={100}
                  colorScheme={getProgressColor("Completed")}
                  mt={2}
                />
              </GridItem>
            </Grid>
            <Text color="gray.600" fontSize="sm">
              Media Source: {"SHIT FFACTORY"}
            </Text>

            <Center>
              <HStack spacing={5}>
                <Button variant="surface" bg="cardGradient" color="white">
                  <a
                    href={"google.com"}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <div>Argue</div>
                  </a>
                </Button>
                <Button
                  variant="solid"
                  bg="cardGradient"
                  color="white"
                  onClick={() => {}}
                >
                  <div>Close</div>
                </Button>
              </HStack>
            </Center>
          </Box>
        ) : (
          <Box width="280px">
            <Text fontWeight="bold" fontSize="l" wrap="yes">
              {"CONTENT"}
            </Text>

            <Stat
              p={2}
              px={3}
              py={1}
              borderRadius="2xl"
              shadow="md"
              color="white"
              bg="cardGradient"
              w="full"
            >
              <Text color="white" fontSize="md" align="center">
                This document has not been added to Truthtrollers.
              </Text>
              <Text mt={4} color="white" fontSize="lg" align="center">
                Would you like to Add?
              </Text>
            </Stat>

            <Center>
              <HStack spacing={5} mt={2}>
                <Button variant="surface" bg="cardGradient" color="black">
                  <div>Add</div>
                </Button>
                <Button
                  variant="solid"
                  bg="cardGradient"
                  color="black"
                  onClick={() => {}}
                >
                  <div>Close</div>
                </Button>
              </HStack>
            </Center>
          </Box>
        )}
      </VStack>
    </Box>
  );
};

export default TaskCard;
