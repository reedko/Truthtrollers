import React, { useState } from "react";
import {
  Box,
  Button,
  Text,
  VStack,
  HStack,
} from "@chakra-ui/react";
import "./Popup.css";
import "../styles/minorityReport.css";
import resizeImage from "../services/image-url";
import TruthGauge from "./ModernArcGauge";
import ClaimPairsDetail from "./ClaimPairsDetail";
import UserConsensusBar from "./UserConsensusBar";

const TestCard: React.FC = () => {
  const logo = "/assets/images/miniLogo.png";

  // Mock completed task with claim pairs data
  const mockClaimPairsData = {
    overall_verimeter: 0.75,
    claim_pairs: [
      {
        caseClaim: {
          claim_id: 1,
          claim_text: "Global temperatures have risen by 1.1°C since pre-industrial times",
          publisher: "nasa.gov",
          url: "https://nasa.gov/climate",
        },
        sourceClaim: {
          claim_id: 2,
          claim_text: "Multiple studies confirm warming trend across all continents",
          publisher: "ipcc.ch",
          url: "https://ipcc.ch/report",
          relationship: "supports",
        },
        verimeter_score: 0.85,
        support_level: 0.9,
        rationale: "Multiple independent temperature records show consistent warming patterns.",
      },
      {
        caseClaim: {
          claim_id: 7,
          claim_text: "Climate change is a natural cycle not caused by humans",
          publisher: "skeptic-blog.com",
          url: "https://skeptic-blog.com/climate",
        },
        sourceClaim: {
          claim_id: 8,
          claim_text: "97% of climate scientists agree human activity is primary cause",
          publisher: "science.org",
          url: "https://science.org/consensus",
          relationship: "refutes",
        },
        verimeter_score: -0.88,
        support_level: 0.05,
        rationale: "Overwhelming scientific consensus contradicts the claim that climate change is purely natural.",
      },
      {
        caseClaim: {
          claim_id: 3,
          claim_text: "Arctic sea ice is declining at unprecedented rates",
          publisher: "noaa.gov",
          url: "https://noaa.gov/arctic",
        },
        sourceClaim: {
          claim_id: 4,
          claim_text: "Satellite observations show 13% decline per decade since 1979",
          publisher: "nsidc.org",
          url: "https://nsidc.org/data",
          relationship: "supports",
        },
        verimeter_score: 0.78,
        support_level: 0.85,
        rationale: "Satellite data provides direct measurement of ice extent showing consistent decline.",
      },
      {
        caseClaim: {
          claim_id: 5,
          claim_text: "CO2 levels are at highest point in 800,000 years",
          publisher: "climate.gov",
          url: "https://climate.gov/co2",
        },
        sourceClaim: {
          claim_id: 6,
          claim_text: "Ice core data shows current levels exceed natural variation",
          publisher: "nature.com",
          url: "https://nature.com/articles/climate",
          relationship: "supports",
        },
        verimeter_score: 0.92,
        support_level: 0.95,
        rationale: "Ice core samples provide historical CO2 records showing unprecedented modern levels.",
      },
    ],
  };

  return (
    <Box
      className="popup-box"
      width="300px"
      position="relative"
      sx={{
        backgroundImage: `
          linear-gradient(135deg, rgba(10, 30, 60, 0.75), rgba(20, 50, 80, 0.7)),
          repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0, 162, 255, 0.08) 2px, rgba(0, 162, 255, 0.08) 4px)
        `,
      }}
      border="1px solid rgba(0, 162, 255, 0.6)"
      borderRadius="12px"
      boxShadow="0 10px 40px rgba(0, 0, 0, 0.7), 0 0 50px rgba(0, 162, 255, 0.6), inset 0 2px 0 rgba(255, 255, 255, 0.2)"
      overflow="hidden"
      p={3}
    >
      <Box
        position="absolute"
        left={0}
        top={0}
        width="50px"
        height="100%"
        background="linear-gradient(90deg, rgba(0, 217, 255, 0.6) 0%, rgba(0, 217, 255, 0.4) 25%, rgba(0, 217, 255, 0.25) 50%, rgba(0, 217, 255, 0.1) 75%, transparent 100%)"
        pointerEvents="none"
      />
      <Box
        position="relative"
        zIndex={1}
        style={{ background: "none" }}
        width="100%"
      >
        {/* Logo box */}
        <Box
          className="logo-box"
          position="relative"
          background="linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))"
          border="1px solid rgba(0, 162, 255, 0.4)"
          borderRadius="12px"
          boxShadow="0 8px 32px rgba(0, 0, 0, 0.6), 0 0 40px rgba(0, 162, 255, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)"
          overflow="hidden"
          p={2}
          width="100%"
          mb={2}
        >
          <Box
            position="absolute"
            left={0}
            top={0}
            width="30px"
            height="100%"
            background="linear-gradient(90deg, rgba(0, 162, 255, 0.6) 0%, transparent 100%)"
            pointerEvents="none"
          />
          <Box
            display="flex"
            justifyContent="space-between"
            alignItems="center"
            position="relative"
            zIndex={1}
          >
            <Box flexShrink={0}>{logo && resizeImage(40, logo)}</Box>
            <Box
              color="#00a2ff"
              fontWeight="400"
              letterSpacing="2px"
              textTransform="uppercase"
              fontSize="lg"
              fontFamily="Futura, 'Century Gothic', 'Avenir Next', sans-serif"
            >
              TruthTrollers
            </Box>
          </Box>
        </Box>

        {/* Meters */}
        <Box display="flex" gap={1} justifyContent="space-between" alignItems="flex-start" mt={2} px={1}>
          <Box flexShrink={0}>
            <TruthGauge
              score={0.75}
              label="VERIMETER"
              size={{ w: 170, h: 90 }}
              normalize={false}
            />
          </Box>
          <Box
            position="relative"
            background="linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))"
            border="1px solid rgba(0, 162, 255, 0.5)"
            borderRadius="12px"
            boxShadow="0 10px 40px rgba(0, 0, 0, 0.7), 0 0 50px rgba(0, 162, 255, 0.5), inset 0 2px 0 rgba(255, 255, 255, 0.15)"
            overflow="hidden"
            flexShrink={0}
            width="70px"
            height="180px"
            display="flex"
            alignItems="center"
            justifyContent="center"
          >
            <Box
              position="absolute"
              left={0}
              top={0}
              width="15px"
              height="100%"
              background="linear-gradient(90deg, rgba(0, 162, 255, 0.6) 0%, transparent 100%)"
              pointerEvents="none"
            />
            <Box
              position="relative"
              zIndex={1}
              transform="scale(0.85)"
              ml={-35}
              mr={-35}
            >
              <UserConsensusBar
                trueCount={21}
                falseCount={71}
                total={121}
              />
            </Box>
          </Box>
        </Box>

        {/* Claim Pairs Detail */}
        <Box width="100%" mt={2}>
          <ClaimPairsDetail claimPairsData={mockClaimPairsData} />
        </Box>

        {/* Title and Buttons */}
        <Box width="280px" mt={2}>
          <Box
            fontSize="lg"
            fontWeight="bold"
            color="white"
            px={1}
            mb={2}
            fontFamily="Futura, 'Century Gothic', 'Avenir Next', sans-serif"
          >
            Test Article: Climate Change Evidence
          </Box>

          <Box display="flex" gap={3} justifyContent="center" mt={3}>
            <button className="mr-button" onClick={() => alert("Discuss clicked")}>
              <span style={{ position: "relative", zIndex: 1 }}>Discuss</span>
            </button>
            <button className="mr-button" onClick={() => alert("Close clicked")}>
              <span style={{ position: "relative", zIndex: 1 }}>Close</span>
            </button>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default TestCard;
